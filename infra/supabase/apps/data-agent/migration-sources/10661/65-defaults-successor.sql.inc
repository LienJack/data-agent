create or replace function app_data_agent.update_workspace_run_defaults(command jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  app_user_record app_data_agent.app_users%rowtype;
  workspace_record app_data_agent.workspaces%rowtype;
  current_defaults app_data_agent.workspace_run_defaults%rowtype;
  existing_revision app_data_agent.workspace_run_default_revisions%rowtype;
  model_record app_data_agent.model_catalog_entries%rowtype;
  datasource_record app_data_agent.datasource_connections%rowtype;
  domain_record semantic.semantic_domain_registry%rowtype;
  release_record semantic.semantic_source_release%rowtype;
  snapshot_record catalog.physical_schema_snapshot%rowtype;
  requested_operation_id uuid;
  requested_workspace_id uuid;
  requested_expected_revision bigint;
  requested_idempotency_key text;
  requested_hash text;
  requested_defaults jsonb;
  resolved_defaults jsonb;
  model_reference jsonb := 'null'::jsonb;
  datasource_reference jsonb := 'null'::jsonb;
  semantic_reference jsonb := 'null'::jsonb;
  snapshot_reference jsonb := 'null'::jsonb;
  context_reference jsonb;
  egress_reference jsonb;
  safety_reference jsonb;
  knowledge_reference jsonb := '[]'::jsonb;
  knowledge_selection jsonb;
  knowledge_revision app_data_agent.knowledge_base_revisions%rowtype;
  computed_request_hash text;
  computed_defaults_hash text;
  selected_defaults_id uuid;
  revision_document jsonb;
  parent_revision bigint;
  parent_hash text;
  next_revision bigint;
  commit_at timestamptz;
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if command is null
    or pg_catalog.jsonb_typeof(command) <> 'object'
    or command ->> 'schema_version' <> 'workspace-defaults-cas-update@1.0.0'
    or not command ?& array[
      'schema_version','operation_id','workspace_id','expected_defaults_revision','idempotency_key','request_hash','defaults'
    ]
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(command) as key(name)
      where key.name not in (
        'schema_version','operation_id','workspace_id','expected_defaults_revision','idempotency_key','request_hash','defaults'
      )
    )
    or not app_data_agent.canonical_uuid_json_string_is_valid(command -> 'operation_id')
    or not app_data_agent.canonical_uuid_json_string_is_valid(command -> 'workspace_id')
    or pg_catalog.jsonb_typeof(command -> 'expected_defaults_revision') <> 'number'
    or pg_catalog.jsonb_typeof(command -> 'idempotency_key') <> 'string'
    or pg_catalog.jsonb_typeof(command -> 'request_hash') <> 'string'
    or not app_data_agent.workspace_run_defaults_document_is_valid(command -> 'defaults')
    or app_data_agent.contains_potential_plaintext_secret(command)
  then
    raise exception using errcode = '22023', message = 'WORKSPACE_RUN_DEFAULTS_INPUT_INVALID';
  end if;

  begin
    requested_operation_id := (command ->> 'operation_id')::uuid;
    requested_workspace_id := (command ->> 'workspace_id')::uuid;
    requested_expected_revision := (command ->> 'expected_defaults_revision')::bigint;
  exception when others then
    raise exception using errcode = '22023', message = 'WORKSPACE_RUN_DEFAULTS_INPUT_INVALID';
  end;
  requested_idempotency_key := command ->> 'idempotency_key';
  requested_hash := command ->> 'request_hash';
  requested_defaults := command -> 'defaults';
  computed_request_hash := app_data_agent.u2_canonical_sha256(command - 'request_hash');
  if requested_expected_revision < 0
    or pg_catalog.length(requested_idempotency_key) not between 8 and 128
    or requested_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
    or requested_hash is distinct from computed_request_hash
  then
    raise exception using errcode = '22023', message = 'WORKSPACE_RUN_DEFAULTS_INPUT_INVALID';
  end if;

  select * into strict authority from platform.current_backend_authority(true);
  if requested_workspace_id <> authority.tenant_id then
    raise exception using errcode = '42501', message = 'WORKSPACE_RUN_DEFAULTS_SCOPE_MISMATCH';
  end if;
  if authority.membership_role <> 'owner' then
    raise exception using errcode = '42501', message = 'WORKSPACE_RUN_DEFAULTS_ADMIN_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:workspace-defaults-idempotency:' || authority.app_id::text || ':' ||
    authority.tenant_id::text || ':' || authority.environment || ':' ||
    authority.principal_id::text || ':' || requested_idempotency_key,
    0
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:workspace-defaults:' || authority.app_id::text || ':' ||
    authority.tenant_id::text || ':' || authority.environment,
    0
  ));

  select revision.* into existing_revision
  from app_data_agent.workspace_run_default_revisions as revision
  where revision.app_id = authority.app_id
    and revision.tenant_id = authority.tenant_id
    and revision.environment = authority.environment
    and revision.principal_id = authority.principal_id
    and revision.idempotency_key = requested_idempotency_key;
  if found then
    if existing_revision.request_hash <> requested_hash
      or existing_revision.revision_id <> requested_operation_id
    then
      raise exception using errcode = '23505', message = 'WORKSPACE_RUN_DEFAULTS_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'revision',existing_revision.revision_document || pg_catalog.jsonb_build_object('defaults_hash',existing_revision.defaults_hash),
      'defaults_ref',pg_catalog.jsonb_build_object(
        'defaults_id',existing_revision.defaults_id,'defaults_revision',existing_revision.defaults_revision,
        'defaults_hash',existing_revision.defaults_hash),
      'request_hash',existing_revision.request_hash,
      'committed_at',existing_revision.revision_document ->> 'created_at',
      'replayed',true
    );
  end if;

  select defaults.* into current_defaults
  from app_data_agent.workspace_run_defaults as defaults
  where defaults.app_id = authority.app_id
    and defaults.tenant_id = authority.tenant_id
    and defaults.environment = authority.environment
  for update;
  if found then
    if current_defaults.defaults_revision <> requested_expected_revision then
      raise exception using errcode = '40001', message = 'WORKSPACE_RUN_DEFAULTS_CAS_CONFLICT';
    end if;
    next_revision := current_defaults.defaults_revision + 1;
    selected_defaults_id := current_defaults.defaults_id;
    parent_revision := current_defaults.defaults_revision;
    parent_hash := current_defaults.defaults_hash;
  else
    if requested_expected_revision <> 0 then
      raise exception using errcode = '40001', message = 'WORKSPACE_RUN_DEFAULTS_CAS_CONFLICT';
    end if;
    next_revision := 1;
    selected_defaults_id := requested_operation_id;
    parent_revision := null;
    parent_hash := null;
  end if;

  select * into strict app_user_record
  from app_data_agent.app_users as app_user
  where app_user.app_id = authority.app_id
    and app_user.environment = authority.environment
    and app_user.principal_id = authority.principal_id
    and app_user.status = 'ACTIVE'
  for share;
  select * into strict workspace_record
  from app_data_agent.workspaces as workspace
  where workspace.app_id = authority.app_id
    and workspace.workspace_id = authority.tenant_id
    and workspace.environment = authority.environment
    and workspace.lifecycle = 'ACTIVE'
  for share;

  if pg_catalog.jsonb_array_length(requested_defaults -> 'files') > 0
    or pg_catalog.jsonb_array_length(requested_defaults -> 'mcp_servers') > 0
    or pg_catalog.jsonb_array_length(requested_defaults -> 'skills') > 0
  then
    raise exception using errcode = '23503', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE';
  end if;

  for knowledge_selection in
    select item.value from pg_catalog.jsonb_array_elements(requested_defaults -> 'knowledge') item(value)
    order by item.value ->> 'resource_id'
  loop
    knowledge_revision := null;
    select revision.* into knowledge_revision
    from app_data_agent.knowledge_bases base
    join app_data_agent.knowledge_base_revisions revision
      on revision.app_id=base.app_id and revision.tenant_id=base.tenant_id
      and revision.environment=base.environment and revision.knowledge_base_id=base.knowledge_base_id
      and revision.revision=base.current_revision and revision.revision_hash=base.current_revision_hash
    join app_data_agent.knowledge_embedding_profile_revisions profile
      on profile.app_id=revision.app_id and profile.tenant_id=revision.tenant_id
      and profile.environment=revision.environment and profile.profile_id=revision.profile_id
      and profile.revision=revision.profile_revision and profile.profile_hash=revision.profile_hash
      and profile.status='READY'
    where base.app_id=authority.app_id and base.tenant_id=authority.tenant_id
      and base.environment=authority.environment
      and base.knowledge_base_id=(knowledge_selection ->> 'resource_id')::uuid
      and base.current_revision=(knowledge_selection ->> 'expected_revision')::bigint
      and base.current_status='READY' and revision.status='READY'
      and exists (
        select 1 from app_data_agent.knowledge_index_generations generation
        where generation.app_id=revision.app_id and generation.tenant_id=revision.tenant_id
          and generation.environment=revision.environment
          and generation.knowledge_base_id=revision.knowledge_base_id
          and generation.generation_id=(revision.revision_json#>>'{active_generation_ref,generation_id}')::uuid
          and generation.generation_revision=(revision.revision_json#>>'{active_generation_ref,generation_revision}')::bigint
          and generation.generation_hash=revision.revision_json#>>'{active_generation_ref,generation_hash}'
          and generation.state='READY'
      )
    for share of base;
    if not found then
      raise exception using errcode = '23503', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE';
    end if;
    begin
      perform app_data_agent.knowledge_assert_source_refs(
        knowledge_revision.source_refs_json,authority.app_id,authority.tenant_id,
        authority.environment,authority.principal_id
      );
    exception when others then
      raise exception using errcode = '23503', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE';
    end;
    knowledge_reference:=knowledge_reference||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'resource_id',knowledge_revision.knowledge_base_id,
        'resource_revision',knowledge_revision.revision,
        'resource_hash',knowledge_revision.revision_hash
      )
    );
  end loop;

  if requested_defaults -> 'model' <> 'null'::jsonb then
    select catalog.* into model_record
    from platform.list_active_model_catalog(authority.deployment_id,authority.principal_id) as catalog
    where catalog.model_profile_id = (requested_defaults #>> '{model,resource_id}')::uuid
      and catalog.config_version = (requested_defaults #>> '{model,expected_revision}')::bigint;
    if not found then
      raise exception using errcode = '23503', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE';
    end if;
    model_reference := pg_catalog.jsonb_build_object(
      'resource_id',model_record.model_profile_id,'resource_revision',model_record.config_version,
      'resource_hash',app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb(model_record) - 'credential_ref'));
  end if;

  if requested_defaults -> 'datasource' <> 'null'::jsonb then
    select datasource.* into datasource_record
    from app_data_agent.datasource_connections as datasource
    where datasource.app_id = authority.app_id and datasource.tenant_id = authority.tenant_id
      and datasource.environment = authority.environment
      and datasource.datasource_id = (requested_defaults #>> '{datasource,resource_id}')::uuid
      and datasource.status = 'ACTIVE'
    for share;
    if not found then
      raise exception using errcode = '23503', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE';
    end if;
    if (requested_defaults #>> '{datasource,expected_revision}')::bigint <>
      datasource_record.resource_version then
      raise exception using errcode = '40001', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_REVISION_MISMATCH';
    end if;
    datasource_reference := pg_catalog.jsonb_build_object(
      'resource_id',datasource_record.datasource_id,
      'resource_revision',datasource_record.resource_version,
      'resource_hash',app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
        'datasource_id',datasource_record.datasource_id,'datasource_type',datasource_record.datasource_type,
        'status',datasource_record.status,'resource_version',datasource_record.resource_version)));
  end if;

  if requested_defaults -> 'semantic_release' <> 'null'::jsonb then
    select release.* into release_record
    from semantic.semantic_source_release as release
    join semantic.semantic_domain_registry as domain
      on domain.app_id = release.app_id and domain.tenant_id = release.tenant_id
     and domain.environment = release.environment and domain.semantic_domain = release.semantic_domain
     and domain.is_active
    join semantic.semantic_active_pointer as pointer
      on pointer.app_id = release.app_id and pointer.tenant_id = release.tenant_id
     and pointer.environment = release.environment and pointer.semantic_domain = release.semantic_domain
     and pointer.current_release_id = release.release_id
     and pointer.current_release_generation = release.release_generation
     and pointer.current_release_digest = release.release_digest
    where release.app_id = authority.app_id and release.tenant_id = authority.tenant_id
      and release.environment = authority.environment
      and release.release_id = (requested_defaults #>> '{semantic_release,resource_id}')::uuid
      and release.release_generation = (requested_defaults #>> '{semantic_release,expected_revision}')::bigint
    for share of release,domain,pointer;
    if not found then
      raise exception using errcode = '23503', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE';
    end if;
    select domain.* into strict domain_record
    from semantic.semantic_domain_registry as domain
    where domain.app_id = release_record.app_id and domain.tenant_id = release_record.tenant_id
      and domain.environment = release_record.environment
      and domain.semantic_domain = release_record.semantic_domain and domain.is_active
    for share;
    semantic_reference := pg_catalog.jsonb_build_object(
      'resource_id',release_record.release_id,'resource_revision',release_record.release_generation,
      'resource_hash',release_record.release_digest);
  end if;

  if requested_defaults -> 'schema_snapshot' <> 'null'::jsonb then
    if (requested_defaults #>> '{schema_snapshot,expected_revision}')::bigint <> 1 then
      raise exception using errcode = '40001', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_REVISION_MISMATCH';
    end if;
    select snapshot.* into snapshot_record
    from catalog.physical_schema_snapshot as snapshot
    where snapshot.app_id = authority.app_id and snapshot.tenant_id = authority.tenant_id
      and snapshot.environment = authority.environment
      and exists (
        select 1 from catalog.schema_scan_run as scan
        where scan.app_id = snapshot.app_id and scan.tenant_id = snapshot.tenant_id
          and scan.environment = snapshot.environment and scan.datasource_id = snapshot.datasource_id
          and scan.datasource_fingerprint = snapshot.datasource_fingerprint
          and scan.snapshot_content_hash = snapshot.snapshot_content_hash
          and scan.snapshot_id = (requested_defaults #>> '{schema_snapshot,resource_id}')::uuid
          and scan.terminal = 'SUCCEEDED'
      )
    order by snapshot.committed_at desc limit 1
    for share;
    if not found then
      raise exception using errcode = '23503', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE';
    end if;
    snapshot_reference := pg_catalog.jsonb_build_object(
      'resource_id',(requested_defaults #>> '{schema_snapshot,resource_id}')::uuid,
      'resource_revision',1,'resource_hash',snapshot_record.snapshot_content_hash);
  end if;

  if datasource_reference <> 'null'::jsonb and semantic_reference <> 'null'::jsonb
    and domain_record.datasource_id is distinct from datasource_record.datasource_id then
    raise exception using errcode = '23514', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_BINDING_MISMATCH';
  end if;
  if datasource_reference <> 'null'::jsonb and snapshot_reference <> 'null'::jsonb
    and snapshot_record.datasource_connection_id is distinct from datasource_record.datasource_id then
    raise exception using errcode = '23514', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_BINDING_MISMATCH';
  end if;

  context_reference := app_data_agent.builtin_effective_config_policy('CONTEXT_POLICY')
    - array['max_context_tokens','max_resource_bindings'];
  egress_reference := app_data_agent.builtin_effective_config_policy('EGRESS_POLICY')
    - array['allowed_providers','allowed_audiences','classification'];
  safety_reference := app_data_agent.builtin_effective_config_policy('EXECUTION_SAFETY_POLICY')
    - array['max_tool_calls','max_provider_calls','max_elapsed_ms'];
  if requested_defaults #>> '{context_policy,resource_id}' <> context_reference ->> 'resource_id'
    or (requested_defaults #>> '{context_policy,expected_revision}')::bigint <>
      (context_reference ->> 'resource_revision')::bigint
    or requested_defaults #>> '{egress_policy,resource_id}' <> egress_reference ->> 'resource_id'
    or (requested_defaults #>> '{egress_policy,expected_revision}')::bigint <>
      (egress_reference ->> 'resource_revision')::bigint
    or requested_defaults #>> '{execution_safety_policy,resource_id}' <> safety_reference ->> 'resource_id'
    or (requested_defaults #>> '{execution_safety_policy,expected_revision}')::bigint <>
      (safety_reference ->> 'resource_revision')::bigint
  then
    raise exception using errcode = '40001', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_REVISION_MISMATCH';
  end if;

  resolved_defaults := pg_catalog.jsonb_build_object(
    'model',model_reference,'datasource',datasource_reference,
    'files','[]'::jsonb,'knowledge',knowledge_reference,'mcp_servers','[]'::jsonb,'skills','[]'::jsonb,
    'semantic_release',semantic_reference,'schema_snapshot',snapshot_reference,
    'context_policy',context_reference,'egress_policy',egress_reference,
    'execution_safety_policy',safety_reference);
  requested_defaults := resolved_defaults;

  commit_at := pg_catalog.clock_timestamp();
  revision_document := pg_catalog.jsonb_build_object(
    'schema_version','workspace-defaults-revision@1.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment,'workspace_id',authority.tenant_id),
    'defaults_id',selected_defaults_id,'defaults_revision',next_revision,
    'parent_revision',parent_revision,'parent_hash',parent_hash,
    'defaults',requested_defaults,'created_by_principal_id',authority.principal_id,
    'created_at',app_data_agent.runtime_iso_timestamp(commit_at)
  );
  computed_defaults_hash := app_data_agent.u2_canonical_sha256(revision_document);
  insert into app_data_agent.workspace_run_default_revisions (
    app_id,tenant_id,environment,defaults_id,defaults_revision,revision_id,principal_id,
    idempotency_key,request_hash,defaults_json,revision_document,defaults_hash,membership_version,
    user_authz_epoch,workspace_lifecycle_version,app_epoch,committed_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,selected_defaults_id,next_revision,
    requested_operation_id,authority.principal_id,requested_idempotency_key,requested_hash,
    requested_defaults,revision_document,computed_defaults_hash,authority.membership_version,
    app_user_record.authz_epoch,workspace_record.lifecycle_version,authority.app_epoch,commit_at
  );

  insert into app_data_agent.workspace_run_defaults (
    app_id,tenant_id,environment,defaults_id,defaults_revision,revision_id,defaults_hash,
    updated_by_principal_id,updated_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,selected_defaults_id,next_revision,
    requested_operation_id,computed_defaults_hash,authority.principal_id,commit_at
  ) on conflict (app_id,tenant_id,environment) do update set
    defaults_revision = excluded.defaults_revision,
    revision_id = excluded.revision_id,
    defaults_hash = excluded.defaults_hash,
    updated_by_principal_id = excluded.updated_by_principal_id,
    updated_at = excluded.updated_at;

  return pg_catalog.jsonb_build_object(
    'revision',revision_document || pg_catalog.jsonb_build_object('defaults_hash',computed_defaults_hash),
    'defaults_ref',pg_catalog.jsonb_build_object(
      'defaults_id',selected_defaults_id,'defaults_revision',next_revision,
      'defaults_hash',computed_defaults_hash),
    'request_hash',requested_hash,
    'committed_at',app_data_agent.runtime_iso_timestamp(commit_at),
    'replayed',false
  );
end
$function$;
