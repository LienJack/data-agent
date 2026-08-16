create function app_data_agent.revalidate_effective_run_config_internal(
  requested_config_id uuid,
  requested_config_revision bigint,
  requested_config_hash text,
  requested_run_id uuid,
  require_write boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  receipt app_data_agent.effective_run_config_receipts%rowtype;
  app_user_record app_data_agent.app_users%rowtype;
  workspace_record app_data_agent.workspaces%rowtype;
  defaults_history app_data_agent.workspace_run_default_revisions%rowtype;
  datasource_record app_data_agent.datasource_connections%rowtype;
  model_record app_data_agent.model_catalog_entries%rowtype;
  datasource_current_hash text;
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if requested_config_id is null
    or requested_config_revision <> 1
    or requested_config_hash !~ '^sha256:[0-9a-f]{64}$'
    or requested_run_id is null
    or require_write is null
  then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_REFERENCE_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(require_write);
  select config.* into receipt
  from app_data_agent.effective_run_config_receipts as config
  where config.app_id = authority.app_id
    and config.tenant_id = authority.tenant_id
    and config.environment = authority.environment
    and config.principal_id = authority.principal_id
    and config.config_id = requested_config_id
    and config.config_revision = requested_config_revision
    and config.config_hash = requested_config_hash
    and config.run_id = requested_run_id;
  if not found then
    raise exception using errcode = '42501', message = 'EFFECTIVE_CONFIG_RECEIPT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  if receipt.config_hash <> platform.canonical_sha256(receipt.effective_config_json) then
    raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_RECEIPT_TAMPERED';
  end if;

  select * into app_user_record
  from app_data_agent.app_users as app_user
  where app_user.app_id = receipt.app_id
    and app_user.environment = receipt.environment
    and app_user.principal_id = receipt.principal_id
    and app_user.status = 'ACTIVE'
  for share;
  select * into workspace_record
  from app_data_agent.workspaces as workspace
  where workspace.app_id = receipt.app_id
    and workspace.workspace_id = receipt.tenant_id
    and workspace.environment = receipt.environment
    and workspace.lifecycle = 'ACTIVE'
  for share;
  select * into defaults_history
  from app_data_agent.workspace_run_default_revisions as revision
  where revision.app_id = receipt.app_id
    and revision.tenant_id = receipt.tenant_id
    and revision.environment = receipt.environment
    and revision.defaults_id = receipt.defaults_id
    and revision.defaults_revision = receipt.defaults_revision
    and revision.defaults_hash = receipt.defaults_hash
  for share;
  if app_user_record.principal_id is null
    or workspace_record.workspace_id is null
    or defaults_history.tenant_id is null
    or authority.membership_version <> receipt.membership_version
    or authority.app_epoch <> receipt.app_epoch
    or app_user_record.authz_epoch <> receipt.user_authz_epoch
    or workspace_record.lifecycle_version <> receipt.workspace_lifecycle_version
  then
    raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_RECEIPT_REVOKED';
  end if;

  select datasource.* into datasource_record
  from app_data_agent.datasource_connections as datasource
  where datasource.app_id = receipt.app_id
    and datasource.tenant_id = receipt.tenant_id
    and datasource.environment = receipt.environment
    and datasource.datasource_id = receipt.datasource_id
    and datasource.status = 'ACTIVE'
  for share;
  if not found then
    raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_RECEIPT_REVOKED';
  end if;
  perform 1
  from app_data_agent.model_catalog_entries as catalog
  where catalog.app_id = receipt.app_id
    and catalog.environment = receipt.environment
    and catalog.model_profile_id = receipt.model_profile_id
    and catalog.config_version = receipt.model_config_version
    and catalog.status = 'ACTIVE'
  for share;
  if not found then
    raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_RECEIPT_REVOKED';
  end if;
  datasource_current_hash := platform.canonical_sha256(pg_catalog.jsonb_build_object(
    'datasource_id',datasource_record.datasource_id,
    'datasource_type',datasource_record.datasource_type,
    'status',datasource_record.status,
    'resource_version',datasource_record.resource_version
  ));
  if datasource_current_hash <> receipt.datasource_revision_hash
    or (receipt.effective_config_json #>> '{datasource,resource_revision}')::bigint <>
      datasource_record.resource_version then
    raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_RECEIPT_REVOKED';
  end if;

  select catalog.* into model_record
  from platform.list_active_model_catalog(authority.deployment_id, authority.principal_id) as catalog
  where catalog.model_profile_id = receipt.model_profile_id
    and catalog.config_version = receipt.model_config_version
    and catalog.provider = receipt.provider
    and catalog.model_id = receipt.model_id;
  if not found then
    raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_RECEIPT_REVOKED';
  end if;
  if receipt.effective_config_json #>> '{model,resource_hash}' <>
      platform.canonical_sha256(pg_catalog.to_jsonb(model_record) - 'credential_ref')
    or not (receipt.effective_config_json #> '{effective_egress,allowed_providers}') ? model_record.provider
  then
    raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_RECEIPT_REVOKED';
  end if;

  if not exists (
      select 1 from semantic.semantic_domain_registry domain
      where domain.app_id = receipt.app_id and domain.tenant_id = receipt.tenant_id
        and domain.environment = receipt.environment and domain.semantic_domain = receipt.semantic_domain
        and domain.datasource_id = receipt.datasource_id and domain.is_active
    )
    or not exists (
      select 1 from semantic.semantic_source_release release
      where release.app_id = receipt.app_id and release.tenant_id = receipt.tenant_id
        and release.environment = receipt.environment and release.semantic_domain = receipt.semantic_domain
        and release.release_id = receipt.semantic_release_id
        and release.release_generation = receipt.semantic_release_generation
        and release.release_digest = receipt.semantic_release_digest
    )
    or not exists (
      select 1 from catalog.physical_schema_snapshot as snapshot
      where snapshot.app_id = receipt.app_id
        and snapshot.tenant_id = receipt.tenant_id
        and snapshot.environment = receipt.environment
        and snapshot.datasource_connection_id = receipt.datasource_id
        and snapshot.datasource_fingerprint = receipt.datasource_fingerprint
        and snapshot.snapshot_content_hash = receipt.schema_snapshot_hash
        and (receipt.effective_config_json #>> '{schema_snapshot,resource_revision}')::bigint = 1
        and exists (select 1 from catalog.schema_scan_run scan
          where scan.app_id = snapshot.app_id and scan.tenant_id = snapshot.tenant_id
            and scan.environment = snapshot.environment and scan.datasource_id = snapshot.datasource_id
            and scan.datasource_fingerprint = snapshot.datasource_fingerprint
            and scan.snapshot_content_hash = snapshot.snapshot_content_hash and scan.terminal = 'SUCCEEDED'
            and scan.snapshot_id = (receipt.effective_config_json #>> '{schema_snapshot,resource_id}')::uuid)
    )
    or receipt.effective_config_json -> 'context_policy'
      <> app_data_agent.builtin_effective_config_policy('CONTEXT_POLICY')
    or receipt.effective_config_json -> 'egress_policy'
      <> app_data_agent.builtin_effective_config_policy('EGRESS_POLICY')
    or receipt.effective_config_json -> 'execution_safety_policy'
      <> app_data_agent.builtin_effective_config_policy('EXECUTION_SAFETY_POLICY')
  then
    raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_RECEIPT_REVOKED';
  end if;

  return receipt.effective_config_json || pg_catalog.jsonb_build_object('config_hash',receipt.config_hash);
end
$function$;

create function app_data_agent.load_effective_run_config(
  requested_config_id uuid,
  requested_config_revision bigint,
  requested_config_hash text,
  requested_run_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $function$
  select app_data_agent.revalidate_effective_run_config_internal(
    requested_config_id,requested_config_revision,requested_config_hash,
    requested_run_id,false
  );
$function$;

create function app_data_agent.consume_worker_effective_run_config(
  requested_context_receipt_id uuid,
  requested_config_id uuid,
  requested_config_revision bigint,
  requested_config_hash text,
  requested_run_id uuid,
  requested_consumer_id text,
  requested_attempt_id uuid,
  requested_worker_id text,
  requested_lease_token bigint,
  requested_worker_fence bigint,
  requested_outbox_id uuid,
  requested_command_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  loaded jsonb;
  existing_receipt app_data_agent.effective_config_context_receipts%rowtype;
  attempt_record app_data_agent.run_attempts%rowtype;
  current_fence bigint;
  receipt_document jsonb;
  receipt_hash text;
  consumed_at timestamptz;
  context_resource_refs jsonb;
begin
  if requested_context_receipt_id is null
    or requested_consumer_id is null
    or requested_consumer_id <> requested_worker_id
    or requested_consumer_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or requested_attempt_id is null
    or requested_worker_id is null
    or requested_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or requested_lease_token is null or requested_lease_token < 1
    or requested_worker_fence is null
    or requested_worker_fence < 1
    or requested_outbox_id is null
    or requested_command_id is null
  then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_WORKER_CONSUMPTION_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(true);
  loaded := app_data_agent.revalidate_effective_run_config_internal(
    requested_config_id,requested_config_revision,requested_config_hash,
    requested_run_id,true
  );
  current_fence := app_data_agent.lock_owned_run_fence(requested_run_id);
  if current_fence is null or current_fence <> requested_worker_fence then
    raise exception using errcode = '40001', message = 'EFFECTIVE_CONFIG_WORKER_FENCE_STALE';
  end if;
  select attempt.* into attempt_record
  from app_data_agent.run_attempts attempt
  join app_data_agent.outbox message
    on message.app_id = attempt.app_id and message.tenant_id = attempt.tenant_id
   and message.environment = attempt.environment and message.outbox_id = attempt.outbox_id
   and message.run_id = attempt.run_id and message.command_id = attempt.command_id
  where attempt.app_id = authority.app_id and attempt.tenant_id = authority.tenant_id
    and attempt.environment = authority.environment and attempt.run_id = requested_run_id
    and attempt.attempt_id = requested_attempt_id and attempt.worker_id = requested_worker_id
    and attempt.lease_token = requested_lease_token and attempt.worker_fence = requested_worker_fence
    and attempt.outbox_id = requested_outbox_id and attempt.command_id = requested_command_id
    and attempt.status = 'ACTIVE' and attempt.lease_expires_at > pg_catalog.clock_timestamp()
    and message.status = 'LEASED' and message.active_attempt_id = requested_attempt_id
    and message.lease_owner = requested_worker_id and message.lease_token = requested_lease_token
    and message.run_fence = requested_worker_fence
    and message.lease_expires_at > pg_catalog.clock_timestamp()
  for update of attempt,message;
  if not found then
    raise exception using errcode = '40001', message = 'EFFECTIVE_CONFIG_WORKER_LEASE_STALE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:effective-config-consumption:' || authority.app_id::text || ':' ||
    authority.tenant_id::text || ':' || authority.environment || ':' ||
    requested_config_id::text || ':' || requested_consumer_id || ':' ||
    requested_attempt_id::text || ':' || requested_lease_token::text || ':' ||
    requested_worker_fence::text,
    0
  ));
  select context.* into existing_receipt
  from app_data_agent.effective_config_context_receipts as context
  where context.app_id = authority.app_id
    and context.tenant_id = authority.tenant_id
    and context.environment = authority.environment
    and context.config_id = requested_config_id
    and context.config_revision = requested_config_revision
    and context.consumer_kind = 'WORKER_START'
    and context.consumer_id = requested_consumer_id
    and context.attempt_id = requested_attempt_id
    and context.lease_token = requested_lease_token
    and context.worker_fence = requested_worker_fence;
  if found then
    if existing_receipt.context_receipt_id <> requested_context_receipt_id
      or existing_receipt.config_hash <> requested_config_hash
      or existing_receipt.run_id <> requested_run_id
      or existing_receipt.worker_fence <> requested_worker_fence
      or existing_receipt.attempt_id <> requested_attempt_id
      or existing_receipt.worker_id <> requested_worker_id
      or existing_receipt.lease_token <> requested_lease_token
      or existing_receipt.outbox_id <> requested_outbox_id
      or existing_receipt.command_id <> requested_command_id
    then
      raise exception using errcode = '23505', message = 'EFFECTIVE_CONFIG_WORKER_CONSUMPTION_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'schema_version','effective-config-worker-consumption@1.0.0',
      'replayed',true,
      'context_receipt',existing_receipt.receipt_json || pg_catalog.jsonb_build_object(
        'receipt_hash',existing_receipt.receipt_hash),
      'effective_config',loaded
    );
  end if;

  consumed_at := pg_catalog.clock_timestamp();
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(loaded -> 'resource_bindings') binding(document)
    where binding.document ->> 'availability' = 'AVAILABLE'
    group by binding.document #>> '{effective_resource,resource_id}'
    having pg_catalog.count(distinct binding.document -> 'effective_resource') > 1
  ) then
    raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_RESOURCE_REFERENCE_CONFLICT';
  end if;
  select coalesce(pg_catalog.jsonb_agg(resource.document order by resource.document ->> 'resource_id',
      (resource.document ->> 'resource_revision')::bigint,resource.document ->> 'resource_hash'),'[]'::jsonb)
    into context_resource_refs
  from (
    select binding.document -> 'effective_resource' as document
    from pg_catalog.jsonb_array_elements(loaded -> 'resource_bindings') binding(document)
    where binding.document ->> 'availability' = 'AVAILABLE'
    group by binding.document -> 'effective_resource'
  ) resource;
  receipt_document := pg_catalog.jsonb_build_object(
    'schema_version','effective-config-context-receipt@1.0.0',
    'receipt_id',requested_context_receipt_id,'consumer','WORKER_START',
    'outbox_id',requested_outbox_id,'command_id',requested_command_id,
    'consumer_id',requested_consumer_id,'attempt_id',requested_attempt_id,
    'lease_token',requested_lease_token,'worker_fence',requested_worker_fence,
    'scope',loaded -> 'scope','run_id',requested_run_id,
    'config_ref',pg_catalog.jsonb_build_object(
      'config_id',requested_config_id,'config_revision',requested_config_revision,
      'config_hash',requested_config_hash
    ),
    'semantic_release',loaded -> 'semantic_release',
    'schema_snapshot',loaded -> 'schema_snapshot',
    'context_policy',(loaded -> 'context_policy') - array['max_context_tokens','max_resource_bindings'],
    'provider',loaded #>> '{model,provider}',
    'audiences',loaded #> '{effective_egress,allowed_audiences}',
    'classification',loaded #>> '{effective_egress,classification}',
    'resource_refs',context_resource_refs,
    'consumed_at',app_data_agent.runtime_iso_timestamp(consumed_at)
  );
  receipt_hash := platform.canonical_sha256(receipt_document);
  insert into app_data_agent.effective_config_context_receipts (
    app_id,tenant_id,environment,context_receipt_id,config_id,config_revision,
    config_hash,run_id,principal_id,consumer_kind,consumer_id,attempt_id,worker_id,
    lease_token,outbox_id,command_id,worker_fence,
    receipt_json,receipt_hash,consumed_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,
    requested_context_receipt_id,requested_config_id,requested_config_revision,
    requested_config_hash,requested_run_id,authority.principal_id,'WORKER_START',
    requested_consumer_id,requested_attempt_id,requested_worker_id,requested_lease_token,
    requested_outbox_id,requested_command_id,requested_worker_fence,
    receipt_document,receipt_hash,consumed_at
  );
  return pg_catalog.jsonb_build_object(
    'schema_version','effective-config-worker-consumption@1.0.0',
    'replayed',false,
    'context_receipt',receipt_document || pg_catalog.jsonb_build_object('receipt_hash',receipt_hash),
    'effective_config',loaded
  );
end
$function$;
