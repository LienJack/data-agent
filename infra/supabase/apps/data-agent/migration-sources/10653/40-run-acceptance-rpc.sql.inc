create function app_data_agent.build_question_run_config_resolution(
  requested_resolution_id uuid,
  requested_scope jsonb,
  requested_run_id uuid,
  requested_conversation_ref jsonb,
  requested_request_hash text,
  requested_defaults_ref jsonb,
  requested_authority_binding jsonb,
  requested_resource_bindings jsonb,
  requested_config jsonb,
  requested_resolved_at timestamptz,
  requested_admission text,
  requested_unavailable_reason text,
  requested_effective_config_ref jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  resolution_document jsonb;
  unavailable_reasons jsonb := '[]'::jsonb;
begin
  if requested_admission not in ('READY','BLOCKED','BOOTSTRAP_REQUIRED') then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_RESOLUTION_INVALID';
  end if;
  if requested_unavailable_reason is not null and not exists (
    select 1 from pg_catalog.jsonb_array_elements(requested_resource_bindings) binding(document)
    where binding.document ->> 'resource_kind' in (
      'MODEL_PROFILE','DATASOURCE','SEMANTIC_RELEASE','SCHEMA_SNAPSHOT',
      'CONTEXT_POLICY','EGRESS_POLICY','EXECUTION_SAFETY_POLICY'
    )
      and binding.document ->> 'availability' = 'UNAVAILABLE'
      and binding.document ->> 'unavailable_reason' = requested_unavailable_reason
  ) then
    requested_resource_bindings := requested_resource_bindings ||
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'resource_kind',case requested_unavailable_reason
        when 'MODEL_NOT_AVAILABLE' then 'MODEL_PROFILE'
        when 'SEMANTIC_RELEASE_NOT_PUBLISHED' then 'SEMANTIC_RELEASE'
        when 'SCHEMA_SNAPSHOT_STALE' then 'SCHEMA_SNAPSHOT'
        when 'POLICY_REJECTED' then 'EGRESS_POLICY'
        when 'EGRESS_PROVIDER_DENIED' then 'EGRESS_POLICY'
        when 'EGRESS_AUDIENCE_DENIED' then 'EGRESS_POLICY'
        else 'DATASOURCE' end,
      'mention_id',null,
      'requested_resource_id',null,'requested_revision',null,'effective_resource',null,
      'source',case when requested_unavailable_reason = 'SEMANTIC_RELEASE_NOT_PUBLISHED'
        then 'ACTIVE_POINTER' when requested_unavailable_reason like '%POLICY%'
        or requested_unavailable_reason like 'EGRESS_%' then 'POLICY' else 'DEFAULT' end,
      'availability','UNAVAILABLE','unavailable_reason',requested_unavailable_reason));
  end if;
  select coalesce(pg_catalog.jsonb_agg(binding.document order by
    binding.document ->> 'resource_kind',
    coalesce(binding.document #>> '{effective_resource,resource_id}',
      binding.document ->> 'requested_resource_id','NONE')),'[]'::jsonb)
    into requested_resource_bindings
  from pg_catalog.jsonb_array_elements(requested_resource_bindings) binding(document);
  if requested_admission <> 'READY' then
    select coalesce(pg_catalog.jsonb_agg(reason.name order by reason.ordinal),'[]'::jsonb)
      into unavailable_reasons
    from (values
      ('EXPLICITLY_CLEARED',1),('DEFAULT_NOT_CONFIGURED',2),('DEFAULT_REMOVED',3),
      ('RESOURCE_NOT_FOUND_OR_FORBIDDEN',4),('RESOURCE_DISABLED',5),
      ('RESOURCE_REVISION_MISMATCH',6),('RESOURCE_REVOKED',7),
      ('RESOURCE_KIND_MISMATCH',8),('MODEL_NOT_AVAILABLE',9),
      ('SEMANTIC_RELEASE_NOT_PUBLISHED',10),('SCHEMA_SNAPSHOT_STALE',11),
      ('POLICY_REJECTED',12),('EGRESS_PROVIDER_DENIED',13),
      ('EGRESS_AUDIENCE_DENIED',14),('MENTION_RESOURCE_ID_REQUIRED',15)
    ) reason(name,ordinal)
    where exists (
      select 1
      from pg_catalog.jsonb_array_elements(requested_resource_bindings) binding(document)
      where binding.document ->> 'availability' = 'UNAVAILABLE'
        and binding.document ->> 'unavailable_reason' = reason.name
    );
    if requested_admission = 'BOOTSTRAP_REQUIRED'
      and unavailable_reasons <> pg_catalog.jsonb_build_array('SEMANTIC_RELEASE_NOT_PUBLISHED')
    then
      requested_admission := 'BLOCKED';
    end if;
  end if;
  resolution_document := pg_catalog.jsonb_build_object(
    'schema_version','run-config-resolution-receipt@1.0.0',
    'resolution_id',requested_resolution_id,
    'scope',requested_scope,
    'request_hash',requested_request_hash,
    'defaults_ref',requested_defaults_ref,
    'authority_binding',requested_authority_binding,
    'resource_bindings',requested_resource_bindings,
    'optional_selection_evaluations',app_data_agent.build_optional_selection_evaluations(
      requested_config,requested_defaults_ref,requested_resource_bindings),
    'resolved_at',app_data_agent.runtime_iso_timestamp(requested_resolved_at),
    'run_id',requested_run_id,
    'operation','QUESTION_RUN',
    'conversation_ref',requested_conversation_ref,
    'admission',requested_admission,
    'unavailable_reasons',unavailable_reasons,
    'effective_config_ref',requested_effective_config_ref,
    'required_action',case when requested_admission = 'BOOTSTRAP_REQUIRED'
      then pg_catalog.to_jsonb('SEMANTIC_BOOTSTRAP'::text) else 'null'::jsonb end,
    'bootstrap_job_config',null
  );
  return pg_catalog.jsonb_build_object(
    'resolution',resolution_document || pg_catalog.jsonb_build_object(
      'resolution_hash',app_data_agent.u2_canonical_sha256(resolution_document)),
    'effective_config',null);
end
$function$;

create function app_data_agent.resolve_semantic_bootstrap_job_config(requested_config jsonb)
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
  defaults_pointer app_data_agent.workspace_run_defaults%rowtype;
  defaults_revision app_data_agent.workspace_run_default_revisions%rowtype;
  datasource_record app_data_agent.datasource_connections%rowtype;
  snapshot_record catalog.physical_schema_snapshot%rowtype;
  requested_job_id uuid;
  selected_datasource_id uuid;
  selected_datasource_revision bigint;
  request_hash text;
  scope_document jsonb;
  defaults_ref jsonb;
  authority_binding jsonb;
  datasource_selection jsonb;
  datasource_reference jsonb;
  snapshot_reference jsonb;
  datasource_hash text;
  resource_bindings jsonb := '[]'::jsonb;
  source_resources jsonb := '[]'::jsonb;
  bootstrap_document jsonb;
  resolution_document jsonb;
  unavailable_reasons jsonb := '[]'::jsonb;
  resolved_at timestamptz;
  blocked_reason text;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if not app_data_agent.effective_config_request_is_valid(requested_config)
    or requested_config ->> 'operation' <> 'SEMANTIC_BOOTSTRAP_JOB' then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_REQUEST_INVALID';
  end if;
  begin
    requested_job_id := (requested_config ->> 'job_id')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_REQUEST_INVALID';
  end;
  request_hash := requested_config ->> 'request_hash';
  defaults_ref := requested_config -> 'defaults_ref';
  datasource_selection := requested_config #> '{overrides,datasource}';
  if request_hash <> app_data_agent.u2_canonical_sha256(requested_config - 'request_hash') then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_REQUEST_INVALID';
  end if;
  resource_bindings := app_data_agent.build_requested_optional_resource_bindings(requested_config);
  select * into strict authority from platform.current_backend_authority(true);
  if requested_config ->> 'workspace_id' <> authority.tenant_id::text then
    raise exception using errcode = '42501', message = 'EFFECTIVE_CONFIG_REQUEST_SCOPE_MISMATCH';
  end if;
  select * into strict app_user_record from app_data_agent.app_users as app_user
  where app_user.app_id = authority.app_id and app_user.environment = authority.environment
    and app_user.principal_id = authority.principal_id and app_user.status = 'ACTIVE' for share;
  select * into strict workspace_record from app_data_agent.workspaces as workspace
  where workspace.app_id = authority.app_id and workspace.workspace_id = authority.tenant_id
    and workspace.environment = authority.environment and workspace.lifecycle = 'ACTIVE' for share;
  scope_document := pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment,
    'workspace_id',authority.tenant_id,'principal_id',authority.principal_id);
  authority_binding := pg_catalog.jsonb_build_object(
    'authz_epoch',app_user_record.authz_epoch,'membership_version',authority.membership_version,
    'workspace_lifecycle_version',workspace_record.lifecycle_version,
    'route_resolution_id',requested_job_id,
    'route_resolution_hash',app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'schema_version','effective-config-route-resolution@1.0.0','route_resolution_id',requested_job_id,
      'scope',scope_document,'operation','SEMANTIC_BOOTSTRAP_JOB','request_hash',request_hash)),
    'resolver_policy_version','effective-config-resolver@1.0.0');
  resolved_at := pg_catalog.clock_timestamp();

  select pointer.* into defaults_pointer from app_data_agent.workspace_run_defaults as pointer
  where pointer.app_id = authority.app_id and pointer.tenant_id = authority.tenant_id
    and pointer.environment = authority.environment for share;
  if not found then blocked_reason := 'DEFAULT_NOT_CONFIGURED';
  elsif defaults_pointer.defaults_id::text <> requested_config #>> '{defaults_ref,defaults_id}'
    or defaults_pointer.defaults_revision::text <> requested_config #>> '{defaults_ref,defaults_revision}'
    or defaults_pointer.defaults_hash <> requested_config #>> '{defaults_ref,defaults_hash}'
  then blocked_reason := 'DEFAULT_REMOVED';
  end if;
  if blocked_reason is null then
    select revision.* into strict defaults_revision from app_data_agent.workspace_run_default_revisions revision
    where revision.app_id = defaults_pointer.app_id and revision.tenant_id = defaults_pointer.tenant_id
      and revision.environment = defaults_pointer.environment and revision.defaults_id = defaults_pointer.defaults_id
      and revision.defaults_revision = defaults_pointer.defaults_revision
      and revision.defaults_hash = defaults_pointer.defaults_hash for share;
    select resource_bindings || coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'resource_kind',source.resource_kind,'mention_id',null,
        'requested_resource_id',item.document -> 'resource_id',
        'requested_revision',(item.document ->> 'resource_revision')::bigint,
        'effective_resource',null,'source','DEFAULT','availability','UNAVAILABLE',
        'unavailable_reason','RESOURCE_NOT_FOUND_OR_FORBIDDEN'
      ) order by source.resource_kind,item.document ->> 'resource_id'), '[]'::jsonb)
      into resource_bindings
    from (values ('files','FILE'),('knowledge','KNOWLEDGE')) source(selection_name,resource_kind)
    cross join lateral pg_catalog.jsonb_array_elements(case
      when requested_config #>> array['overrides',source.selection_name,'mode'] = 'INHERIT_DEFAULT'
        then defaults_revision.defaults_json -> source.selection_name
      else '[]'::jsonb end) item(document);
    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
      group by binding.document ->> 'resource_kind',binding.document ->> 'requested_resource_id'
      having pg_catalog.count(*) > 1
    ) then
      raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_RESOURCE_DUPLICATE';
    end if;
    if datasource_selection ->> 'mode' = 'EXPLICIT_NONE' then blocked_reason := 'EXPLICITLY_CLEARED';
    else
      datasource_reference := case when datasource_selection ->> 'mode' = 'RESOURCE_IDS'
        then pg_catalog.jsonb_build_object(
          'resource_id',datasource_selection #>> '{resources,0,resource_id}',
          'resource_revision',(datasource_selection #>> '{resources,0,expected_revision}')::bigint,
          'resource_hash','sha256:' || pg_catalog.repeat('0',64))
        else defaults_revision.defaults_json -> 'datasource' end;
      snapshot_reference := defaults_revision.defaults_json -> 'schema_snapshot';
      if datasource_reference is null or datasource_reference = 'null'::jsonb
        or snapshot_reference is null or snapshot_reference = 'null'::jsonb then
        blocked_reason := 'DEFAULT_NOT_CONFIGURED';
      end if;
    end if;
  end if;
  if blocked_reason is null then
    begin
      selected_datasource_id := (datasource_reference ->> 'resource_id')::uuid;
      selected_datasource_revision := (datasource_reference ->> 'resource_revision')::bigint;
    exception when others then
      raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_RESOURCE_REVISION_INVALID';
    end;
    select datasource.* into datasource_record from app_data_agent.datasource_connections datasource
    where datasource.app_id = authority.app_id and datasource.tenant_id = authority.tenant_id
      and datasource.environment = authority.environment and datasource.datasource_id = selected_datasource_id for share;
    if not found then blocked_reason := 'RESOURCE_NOT_FOUND_OR_FORBIDDEN';
    elsif datasource_record.status <> 'ACTIVE' then blocked_reason := 'RESOURCE_DISABLED';
    else
      datasource_hash := app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
        'datasource_id',datasource_record.datasource_id,'datasource_type',datasource_record.datasource_type,
        'status',datasource_record.status,'resource_version',datasource_record.resource_version));
      if selected_datasource_revision <> datasource_record.resource_version
        or (datasource_selection ->> 'mode' = 'INHERIT_DEFAULT'
          and datasource_reference ->> 'resource_hash' <> datasource_hash) then
        blocked_reason := 'RESOURCE_REVISION_MISMATCH';
      elsif datasource_selection ->> 'mode' = 'RESOURCE_IDS' then
        datasource_reference := datasource_reference || pg_catalog.jsonb_build_object(
          'resource_hash',datasource_hash);
      end if;
    end if;
  end if;
  if blocked_reason is null then
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('resource_kind','DATASOURCE','mention_id',null,
        'requested_resource_id',selected_datasource_id,
        'requested_revision',selected_datasource_revision,
        'effective_resource',datasource_reference,'source',
        case when datasource_selection ->> 'mode' = 'RESOURCE_IDS' then 'OVERRIDE' else 'DEFAULT' end,
        'availability','AVAILABLE','unavailable_reason',null));
  end if;
  if blocked_reason is null then
    select snapshot.* into snapshot_record from catalog.physical_schema_snapshot snapshot
    where snapshot.app_id = authority.app_id and snapshot.tenant_id = authority.tenant_id
      and snapshot.environment = authority.environment and snapshot.datasource_connection_id = selected_datasource_id
      and snapshot.snapshot_content_hash = snapshot_reference ->> 'resource_hash'
      and (snapshot_reference ->> 'resource_revision')::bigint = 1
      and exists (select 1 from catalog.schema_scan_run scan
        where scan.app_id = snapshot.app_id and scan.tenant_id = snapshot.tenant_id
          and scan.environment = snapshot.environment and scan.datasource_id = snapshot.datasource_id
          and scan.datasource_fingerprint = snapshot.datasource_fingerprint
          and scan.snapshot_content_hash = snapshot.snapshot_content_hash and scan.terminal = 'SUCCEEDED'
          and scan.snapshot_id = (snapshot_reference ->> 'resource_id')::uuid)
    order by snapshot.committed_at desc limit 1 for share;
    if not found then blocked_reason := 'SCHEMA_SNAPSHOT_STALE'; end if;
  end if;

  if blocked_reason is null then
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('resource_kind','SCHEMA_SNAPSHOT','mention_id',null,
        'requested_resource_id',snapshot_reference -> 'resource_id',
        'requested_revision',(snapshot_reference ->> 'resource_revision')::bigint,
        'effective_resource',snapshot_reference,'source','DEFAULT',
        'availability','AVAILABLE','unavailable_reason',null));
    if exists (
      select 1 from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
      where binding.document ->> 'resource_kind' in ('FILE','KNOWLEDGE')
    ) then
      -- U9/U10 file/knowledge Authority is not present in U2. Never turn caller
      -- references into AVAILABLE bootstrap input merely because they are well formed.
      blocked_reason := 'RESOURCE_NOT_FOUND_OR_FORBIDDEN';
      bootstrap_document := null;
    else
      source_resources := '[]'::jsonb;
      bootstrap_document := pg_catalog.jsonb_build_object(
        'schema_version','semantic-bootstrap-job-config@1.0.0','scope',scope_document,
        'job_id',requested_job_id,'operation','SEMANTIC_BOOTSTRAP_JOB','request_hash',request_hash,
        'defaults_ref',defaults_ref,'authority_binding',authority_binding,'datasource',datasource_reference,
        'semantic_release',null,'schema_snapshot',snapshot_reference || pg_catalog.jsonb_build_object(
          'datasource_id',selected_datasource_id),'source_resources',source_resources,
        'resource_bindings',resource_bindings);
      if requested_config ? 'trigger_question_run_id' then
        bootstrap_document := bootstrap_document || pg_catalog.jsonb_build_object(
          'trigger_question_run_id',(requested_config ->> 'trigger_question_run_id')::uuid);
      end if;
    end if;
  end if;
  if blocked_reason is not null
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
      where binding.document ->> 'availability' = 'UNAVAILABLE'
        and binding.document ->> 'resource_kind' in ('DATASOURCE','SCHEMA_SNAPSHOT')
        and binding.document ->> 'unavailable_reason' = blocked_reason
    )
    and not (
      blocked_reason = 'RESOURCE_NOT_FOUND_OR_FORBIDDEN'
      and exists (
        select 1
        from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
        where binding.document ->> 'availability' = 'UNAVAILABLE'
          and binding.document ->> 'resource_kind' in ('FILE','KNOWLEDGE')
          and binding.document ->> 'unavailable_reason' = blocked_reason
      )
    )
  then
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(case
      when blocked_reason = 'SCHEMA_SNAPSHOT_STALE' then pg_catalog.jsonb_build_object(
        'resource_kind','SCHEMA_SNAPSHOT','mention_id',null,
        'requested_resource_id',snapshot_reference -> 'resource_id',
        'requested_revision',case when snapshot_reference is null then null
          else (snapshot_reference ->> 'resource_revision')::bigint end,
        'effective_resource',null,'source','DEFAULT','availability','UNAVAILABLE',
        'unavailable_reason',blocked_reason)
      else app_data_agent.build_unavailable_singleton_resource_binding(
        datasource_selection,datasource_reference,'DATASOURCE',blocked_reason)
      end);
  end if;
  select coalesce(pg_catalog.jsonb_agg(binding.document order by
    binding.document ->> 'resource_kind',
    coalesce(binding.document #>> '{effective_resource,resource_id}',
      binding.document ->> 'requested_resource_id','NONE')),'[]'::jsonb)
    into resource_bindings
  from pg_catalog.jsonb_array_elements(resource_bindings) binding(document);
  if bootstrap_document is not null then
    bootstrap_document := pg_catalog.jsonb_set(
      bootstrap_document,'{resource_bindings}',resource_bindings);
  end if;
  if blocked_reason is not null then
    select coalesce(pg_catalog.jsonb_agg(reason.name order by reason.ordinal),'[]'::jsonb)
      into unavailable_reasons
    from (values
      ('EXPLICITLY_CLEARED',1),('DEFAULT_NOT_CONFIGURED',2),('DEFAULT_REMOVED',3),
      ('RESOURCE_NOT_FOUND_OR_FORBIDDEN',4),('RESOURCE_DISABLED',5),
      ('RESOURCE_REVISION_MISMATCH',6),('RESOURCE_REVOKED',7),
      ('RESOURCE_KIND_MISMATCH',8),('MODEL_NOT_AVAILABLE',9),
      ('SEMANTIC_RELEASE_NOT_PUBLISHED',10),('SCHEMA_SNAPSHOT_STALE',11),
      ('POLICY_REJECTED',12),('EGRESS_PROVIDER_DENIED',13),
      ('EGRESS_AUDIENCE_DENIED',14),('MENTION_RESOURCE_ID_REQUIRED',15)
    ) reason(name,ordinal)
    where exists (
      select 1 from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
      where binding.document ->> 'availability' = 'UNAVAILABLE'
        and binding.document ->> 'unavailable_reason' = reason.name
    );
  end if;
  resolution_document := pg_catalog.jsonb_build_object(
    'schema_version','run-config-resolution-receipt@1.0.0','resolution_id',requested_job_id,
    'scope',scope_document,'request_hash',request_hash,'defaults_ref',defaults_ref,
    'authority_binding',authority_binding,'resource_bindings',resource_bindings,
    'optional_selection_evaluations',app_data_agent.build_optional_selection_evaluations(
      requested_config,defaults_ref,resource_bindings),
    'resolved_at',app_data_agent.runtime_iso_timestamp(resolved_at),
    'job_id',requested_job_id,'operation','SEMANTIC_BOOTSTRAP_JOB',
    'admission',case when blocked_reason is null then 'READY' else 'BLOCKED' end,
    'unavailable_reasons',unavailable_reasons,
    'effective_config_ref',null,'required_action',null,
    'bootstrap_job_config',bootstrap_document);
  if requested_config ? 'trigger_question_run_id' then
    resolution_document := resolution_document || pg_catalog.jsonb_build_object(
      'trigger_question_run_id',(requested_config ->> 'trigger_question_run_id')::uuid);
  end if;
  return resolution_document || pg_catalog.jsonb_build_object(
    'resolution_hash',app_data_agent.u2_canonical_sha256(resolution_document));
end
$function$;

create function app_data_agent.accept_question_run_with_effective_config(
  requested_command jsonb,
  requested_config jsonb
)
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
  defaults_pointer app_data_agent.workspace_run_defaults%rowtype;
  defaults_revision app_data_agent.workspace_run_default_revisions%rowtype;
  existing_receipt app_data_agent.effective_run_config_receipts%rowtype;
  conversation_record app_data_agent.qa_conversations%rowtype;
  datasource_record app_data_agent.datasource_connections%rowtype;
  model_record app_data_agent.model_catalog_entries%rowtype;
  domain_record semantic.semantic_domain_registry%rowtype;
  active_pointer semantic.semantic_active_pointer%rowtype;
  release_record semantic.semantic_source_release%rowtype;
  snapshot_record catalog.physical_schema_snapshot%rowtype;
  requested_run_id uuid;
  requested_config_id uuid;
  requested_resolution_id uuid;
  requested_context_receipt_id uuid;
  requested_conversation_id uuid;
  requested_conversation_version bigint;
  requested_defaults_id uuid;
  requested_defaults_revision bigint;
  requested_idempotency_key text;
  request_hash text;
  scope_document jsonb;
  defaults_ref jsonb;
  authority_binding jsonb;
  route_resolution_hash text;
  resource_bindings jsonb := '[]'::jsonb;
  resolved_at timestamptz;
  model_selection jsonb;
  datasource_selection jsonb;
  selected_model_reference jsonb;
  selected_datasource_reference jsonb;
  semantic_reference jsonb;
  snapshot_reference jsonb;
  context_reference jsonb;
  egress_reference jsonb;
  safety_reference jsonb;
  effective_model jsonb;
  effective_semantic jsonb;
  effective_snapshot jsonb;
  effective_context jsonb;
  effective_egress_policy jsonb;
  effective_safety jsonb;
  effective_egress jsonb;
  selected_model_profile_id uuid;
  selected_datasource_id uuid;
  model_expected_revision bigint;
  datasource_expected_revision bigint;
  datasource_revision_hash text;
  model_revision_hash text;
  config_document jsonb;
  config_hash text;
  config_ref jsonb;
  context_document jsonb;
  context_resource_refs jsonb;
  context_hash text;
  acceptance_result jsonb;
  accepted_payload jsonb;
  accepted_payload_hash text;
  accepted_command jsonb;
  accepted_event jsonb;
  accepted_event_hash text;
  commit_at timestamptz;
  mandatory_blocked_reason text;
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if not app_data_agent.effective_config_request_is_valid(requested_config)
    or requested_config ->> 'operation' <> 'QUESTION_RUN'
    or pg_catalog.jsonb_typeof(requested_command) <> 'object'
    or not requested_command ?& array[
      'run_id','command_id','event_id','outbox_id','audit_id','idempotency_key','question']
    or (select pg_catalog.count(*) <> 7 from pg_catalog.jsonb_object_keys(requested_command))
    or exists (select 1 from pg_catalog.jsonb_object_keys(requested_command) key(name)
      where key.name not in ('run_id','command_id','event_id','outbox_id','audit_id','idempotency_key','question'))
    or not app_data_agent.canonical_uuid_json_string_is_valid(requested_command -> 'run_id')
    or not app_data_agent.canonical_uuid_json_string_is_valid(requested_command -> 'command_id')
    or not app_data_agent.canonical_uuid_json_string_is_valid(requested_command -> 'event_id')
    or not app_data_agent.canonical_uuid_json_string_is_valid(requested_command -> 'outbox_id')
    or not app_data_agent.canonical_uuid_json_string_is_valid(requested_command -> 'audit_id')
    or pg_catalog.jsonb_typeof(requested_command -> 'question') <> 'string'
    or requested_command ->> 'question' <> pg_catalog.btrim(requested_command ->> 'question')
    or pg_catalog.length(pg_catalog.btrim(requested_command ->> 'question')) not between 1 and 4000
    or requested_command ? 'payload'
  then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_REQUEST_INVALID';
  end if;
  begin
    requested_run_id := (requested_config ->> 'run_id')::uuid;
    requested_config_id := (requested_command ->> 'command_id')::uuid;
    requested_resolution_id := (requested_command ->> 'event_id')::uuid;
    requested_context_receipt_id := (requested_command ->> 'outbox_id')::uuid;
    requested_conversation_id := (requested_config #>> '{conversation_ref,conversation_id}')::uuid;
    requested_conversation_version := (requested_config #>> '{conversation_ref,expected_resource_version}')::bigint;
    requested_defaults_id := (requested_config #>> '{defaults_ref,defaults_id}')::uuid;
    requested_defaults_revision := (requested_config #>> '{defaults_ref,defaults_revision}')::bigint;
    resolved_at := pg_catalog.clock_timestamp();
  exception when others then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_REQUEST_INVALID';
  end;
  requested_idempotency_key := requested_config ->> 'idempotency_key';
  request_hash := requested_config ->> 'request_hash';
  defaults_ref := requested_config -> 'defaults_ref';
  if request_hash <> app_data_agent.u2_canonical_sha256(requested_config - 'request_hash')
    or requested_command ->> 'run_id' <> requested_run_id::text
    or requested_command ->> 'idempotency_key' <> requested_idempotency_key
    or app_data_agent.contains_potential_plaintext_secret(requested_command)
  then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_REQUEST_INVALID';
  end if;
  resource_bindings := app_data_agent.build_requested_optional_resource_bindings(requested_config);
  model_selection := requested_config #> '{overrides,model}';
  datasource_selection := requested_config #> '{overrides,datasource}';

  select * into strict authority from platform.current_backend_authority(true);
  if requested_config ->> 'workspace_id' <> authority.tenant_id::text then
    raise exception using errcode = '42501', message = 'EFFECTIVE_CONFIG_REQUEST_SCOPE_MISMATCH';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:idempotency:' || authority.app_id::text || ':' || authority.tenant_id::text || ':' ||
    authority.environment || ':' || authority.principal_id::text || ':' || requested_idempotency_key,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:run:' || authority.app_id::text || ':' || authority.tenant_id::text || ':' ||
    authority.environment || ':' || requested_run_id::text,0));

  select * into strict app_user_record from app_data_agent.app_users as app_user
  where app_user.app_id = authority.app_id and app_user.environment = authority.environment
    and app_user.principal_id = authority.principal_id and app_user.status = 'ACTIVE' for share;
  select * into strict workspace_record from app_data_agent.workspaces as workspace
  where workspace.app_id = authority.app_id and workspace.workspace_id = authority.tenant_id
    and workspace.environment = authority.environment and workspace.lifecycle = 'ACTIVE' for share;
  select conversation.* into conversation_record
  from app_data_agent.qa_conversations as conversation
  where conversation.app_id = authority.app_id
    and conversation.tenant_id = authority.tenant_id
    and conversation.environment = authority.environment
    and conversation.conversation_id = requested_conversation_id
    and conversation.owner_principal_id = authority.principal_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'CONVERSATION_NOT_FOUND_OR_DENIED';
  end if;
  if conversation_record.resource_version <> requested_conversation_version then
    raise exception using errcode = '40001', message = 'CONVERSATION_RESOURCE_VERSION_CONFLICT';
  end if;

  scope_document := pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment,
    'workspace_id',authority.tenant_id,'principal_id',authority.principal_id);
  route_resolution_hash := app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'schema_version','effective-config-route-resolution@1.0.0',
    'route_resolution_id',requested_config_id,'scope',scope_document,
    'operation','QUESTION_RUN','request_hash',request_hash));
  authority_binding := pg_catalog.jsonb_build_object(
    'authz_epoch',app_user_record.authz_epoch,
    'membership_version',authority.membership_version,
    'workspace_lifecycle_version',workspace_record.lifecycle_version,
    'route_resolution_id',requested_config_id,
    'route_resolution_hash',route_resolution_hash,
    'resolver_policy_version','effective-config-resolver@1.0.0');

  select receipt.* into existing_receipt
  from app_data_agent.effective_run_config_receipts as receipt
  where receipt.app_id = authority.app_id and receipt.tenant_id = authority.tenant_id
    and receipt.environment = authority.environment and receipt.principal_id = authority.principal_id
    and receipt.idempotency_key = requested_idempotency_key;
  if found then
    if existing_receipt.request_hash <> request_hash or existing_receipt.config_id <> requested_config_id
      or existing_receipt.run_id <> requested_run_id
      or not exists (
        select 1 from app_data_agent.runs as accepted_run
        where accepted_run.app_id = existing_receipt.app_id
          and accepted_run.tenant_id = existing_receipt.tenant_id
          and accepted_run.environment = existing_receipt.environment
          and accepted_run.run_id = existing_receipt.run_id
          and accepted_run.principal_id = existing_receipt.principal_id
          and accepted_run.question = requested_command ->> 'question'
      )
      or not exists (
        select 1 from app_data_agent.run_events as accepted_event
        where accepted_event.app_id = existing_receipt.app_id
          and accepted_event.tenant_id = existing_receipt.tenant_id
          and accepted_event.environment = existing_receipt.environment
          and accepted_event.event_id = requested_resolution_id
          and accepted_event.run_id = existing_receipt.run_id
          and accepted_event.command_id = existing_receipt.config_id
          and accepted_event.sequence = 1
          and accepted_event.event_type = 'run.accepted'
      )
      or not exists (
        select 1 from app_data_agent.effective_config_context_receipts as accepted_context
        where accepted_context.app_id = existing_receipt.app_id
          and accepted_context.tenant_id = existing_receipt.tenant_id
          and accepted_context.environment = existing_receipt.environment
          and accepted_context.context_receipt_id = requested_context_receipt_id
          and accepted_context.config_id = existing_receipt.config_id
          and accepted_context.config_revision = existing_receipt.config_revision
          and accepted_context.config_hash = existing_receipt.config_hash
          and accepted_context.run_id = existing_receipt.run_id
          and accepted_context.principal_id = existing_receipt.principal_id
          and accepted_context.consumer_kind = 'RUN_ACCEPTANCE'
          and accepted_context.consumer_id = existing_receipt.config_id::text
          and accepted_context.outbox_id = requested_context_receipt_id
          and accepted_context.command_id = existing_receipt.config_id
      )
      or not exists (
        select 1 from app_data_agent.outbox as accepted_outbox
        where accepted_outbox.app_id = existing_receipt.app_id
          and accepted_outbox.tenant_id = existing_receipt.tenant_id
          and accepted_outbox.environment = existing_receipt.environment
          and accepted_outbox.outbox_id = requested_context_receipt_id
          and accepted_outbox.run_id = existing_receipt.run_id
          and accepted_outbox.command_id = existing_receipt.config_id
          and accepted_outbox.topic = 'run.command.accepted'
      )
      or not exists (
        select 1 from app_data_agent.audit_log as accepted_audit
        where accepted_audit.app_id = existing_receipt.app_id
          and accepted_audit.tenant_id = existing_receipt.tenant_id
          and accepted_audit.environment = existing_receipt.environment
          and accepted_audit.audit_id = (requested_command ->> 'audit_id')::uuid
          and accepted_audit.principal_id = existing_receipt.principal_id
          and accepted_audit.action = 'RUN_COMMAND_ACCEPTED'
          and accepted_audit.resource_type = 'run'
          and accepted_audit.resource_id = existing_receipt.run_id::text
          and accepted_audit.details ->> 'command_id' = existing_receipt.config_id::text
      )
      or not exists (
        select 1 from app_data_agent.workspace_run_bindings as accepted_binding
        where accepted_binding.app_id = existing_receipt.app_id
          and accepted_binding.tenant_id = existing_receipt.tenant_id
          and accepted_binding.environment = existing_receipt.environment
          and accepted_binding.run_id = existing_receipt.run_id
          and accepted_binding.datasource_id = existing_receipt.datasource_id
          and accepted_binding.conversation_id = requested_conversation_id
          and accepted_binding.principal_id = existing_receipt.principal_id
          and accepted_binding.model_profile_id = existing_receipt.model_profile_id
          and accepted_binding.model_config_version = existing_receipt.model_config_version
      )
      or not exists (
        select 1 from app_data_agent.qa_messages as accepted_message
        where accepted_message.app_id = existing_receipt.app_id
          and accepted_message.tenant_id = existing_receipt.tenant_id
          and accepted_message.environment = existing_receipt.environment
          and accepted_message.conversation_id = requested_conversation_id
          and accepted_message.message_id = requested_resolution_id
          and accepted_message.owner_principal_id = existing_receipt.principal_id
          and accepted_message.role = 'user'
          and accepted_message.content = requested_command ->> 'question'
          and accepted_message.message_type = 'text'
          and accepted_message.run_id = existing_receipt.run_id
      ) then
      raise exception using errcode = '23505', message = 'EFFECTIVE_CONFIG_IDEMPOTENCY_CONFLICT';
    end if;
    select coalesce(pg_catalog.jsonb_agg(binding.binding_json order by binding.binding_ordinal),'[]'::jsonb)
      into resource_bindings
    from app_data_agent.effective_run_config_resource_bindings as binding
    where binding.app_id = existing_receipt.app_id and binding.tenant_id = existing_receipt.tenant_id
      and binding.environment = existing_receipt.environment and binding.config_id = existing_receipt.config_id
      and binding.config_revision = existing_receipt.config_revision;
    return pg_catalog.jsonb_set(app_data_agent.build_question_run_config_resolution(
      requested_resolution_id,existing_receipt.effective_config_json -> 'scope',requested_run_id,requested_config -> 'conversation_ref',request_hash,
      existing_receipt.effective_config_json -> 'defaults_ref',
      existing_receipt.effective_config_json -> 'authority_binding',resource_bindings,
      requested_config,existing_receipt.committed_at,'READY',null,
      pg_catalog.jsonb_build_object('config_id',existing_receipt.config_id,
        'config_revision',existing_receipt.config_revision,'config_hash',existing_receipt.config_hash)),
      '{effective_config}',existing_receipt.effective_config_json || pg_catalog.jsonb_build_object(
        'config_hash',existing_receipt.config_hash));
  end if;
  if exists (select 1 from app_data_agent.idempotency_records as idempotency
    where idempotency.app_id = authority.app_id and idempotency.tenant_id = authority.tenant_id
      and idempotency.environment = authority.environment and idempotency.principal_id = authority.principal_id
      and idempotency.idempotency_key = requested_idempotency_key) then
    raise exception using errcode = '23505', message = 'EFFECTIVE_CONFIG_IDEMPOTENCY_CONFLICT';
  end if;

  select pointer.* into defaults_pointer from app_data_agent.workspace_run_defaults as pointer
  where pointer.app_id = authority.app_id and pointer.tenant_id = authority.tenant_id
    and pointer.environment = authority.environment for share;
  if not found then
    resource_bindings := resource_bindings ||
      app_data_agent.build_inherited_optional_resource_bindings(requested_config,null);
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
      app_data_agent.build_unavailable_singleton_resource_binding(
        datasource_selection,null,'DATASOURCE','DEFAULT_NOT_CONFIGURED'),
      app_data_agent.build_unavailable_singleton_resource_binding(
        model_selection,null,'MODEL_PROFILE','DEFAULT_NOT_CONFIGURED'));
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BLOCKED','DEFAULT_NOT_CONFIGURED',null);
  end if;
  if defaults_pointer.defaults_id <> requested_defaults_id
    or defaults_pointer.defaults_revision <> requested_defaults_revision
    or defaults_pointer.defaults_hash <> requested_config #>> '{defaults_ref,defaults_hash}' then
    resource_bindings := resource_bindings ||
      app_data_agent.build_inherited_optional_resource_bindings(requested_config,null);
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
      app_data_agent.build_unavailable_singleton_resource_binding(
        datasource_selection,null,'DATASOURCE','DEFAULT_REMOVED'),
      app_data_agent.build_unavailable_singleton_resource_binding(
        model_selection,null,'MODEL_PROFILE','DEFAULT_REMOVED'));
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BLOCKED','DEFAULT_REMOVED',null);
  end if;
  select revision.* into strict defaults_revision
  from app_data_agent.workspace_run_default_revisions as revision
  where revision.app_id = defaults_pointer.app_id and revision.tenant_id = defaults_pointer.tenant_id
    and revision.environment = defaults_pointer.environment and revision.defaults_id = defaults_pointer.defaults_id
    and revision.defaults_revision = defaults_pointer.defaults_revision
    and revision.revision_id = defaults_pointer.revision_id and revision.defaults_hash = defaults_pointer.defaults_hash
  for share;
  resource_bindings := resource_bindings ||
    app_data_agent.build_inherited_optional_resource_bindings(
      requested_config,defaults_revision.defaults_json);
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
    group by binding.document ->> 'resource_kind',binding.document ->> 'requested_resource_id'
    having pg_catalog.count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_RESOURCE_DUPLICATE';
  end if;

  selected_model_reference := case when model_selection ->> 'mode' = 'EXPLICIT_NONE'
    then null when model_selection ->> 'mode' = 'RESOURCE_IDS'
    then pg_catalog.jsonb_build_object('resource_id',model_selection #>> '{resources,0,resource_id}',
      'resource_revision',(model_selection #>> '{resources,0,expected_revision}')::bigint,
      'resource_hash','sha256:' || pg_catalog.repeat('0',64))
    else defaults_revision.defaults_json -> 'model' end;
  selected_datasource_reference := case when datasource_selection ->> 'mode' = 'EXPLICIT_NONE'
    then null when datasource_selection ->> 'mode' = 'RESOURCE_IDS'
    then pg_catalog.jsonb_build_object('resource_id',datasource_selection #>> '{resources,0,resource_id}',
      'resource_revision',(datasource_selection #>> '{resources,0,expected_revision}')::bigint,
      'resource_hash','sha256:' || pg_catalog.repeat('0',64))
    else defaults_revision.defaults_json -> 'datasource' end;

  if datasource_selection ->> 'mode' = 'EXPLICIT_NONE' then
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
      app_data_agent.build_unavailable_singleton_resource_binding(
        datasource_selection,null,'DATASOURCE','EXPLICITLY_CLEARED'));
    mandatory_blocked_reason := 'EXPLICITLY_CLEARED';
  elsif selected_datasource_reference is null or selected_datasource_reference = 'null'::jsonb then
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
      app_data_agent.build_unavailable_singleton_resource_binding(
        datasource_selection,null,'DATASOURCE','DEFAULT_NOT_CONFIGURED'));
    mandatory_blocked_reason := 'DEFAULT_NOT_CONFIGURED';
  else
    begin
      selected_datasource_id := (selected_datasource_reference ->> 'resource_id')::uuid;
      datasource_expected_revision := (selected_datasource_reference ->> 'resource_revision')::bigint;
    exception when others then
      raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_RESOURCE_REVISION_INVALID';
    end;
    select datasource.* into datasource_record from app_data_agent.datasource_connections as datasource
    where datasource.app_id = authority.app_id and datasource.tenant_id = authority.tenant_id
      and datasource.environment = authority.environment and datasource.datasource_id = selected_datasource_id for share;
    if not found then
      resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
        app_data_agent.build_unavailable_singleton_resource_binding(
          datasource_selection,selected_datasource_reference,
          'DATASOURCE','RESOURCE_NOT_FOUND_OR_FORBIDDEN'));
      mandatory_blocked_reason := 'RESOURCE_NOT_FOUND_OR_FORBIDDEN';
    elsif datasource_record.status <> 'ACTIVE' then
      resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
        app_data_agent.build_unavailable_singleton_resource_binding(
          datasource_selection,selected_datasource_reference,'DATASOURCE','RESOURCE_DISABLED'));
      mandatory_blocked_reason := 'RESOURCE_DISABLED';
    else
      datasource_revision_hash := app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
        'datasource_id',datasource_record.datasource_id,'datasource_type',datasource_record.datasource_type,
        'status',datasource_record.status,'resource_version',datasource_record.resource_version));
      if datasource_expected_revision <> datasource_record.resource_version
        or (datasource_selection ->> 'mode' = 'INHERIT_DEFAULT'
          and selected_datasource_reference ->> 'resource_hash' <> datasource_revision_hash) then
        resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
          app_data_agent.build_unavailable_singleton_resource_binding(
            datasource_selection,selected_datasource_reference,
            'DATASOURCE','RESOURCE_REVISION_MISMATCH'));
        mandatory_blocked_reason := 'RESOURCE_REVISION_MISMATCH';
      else
        if datasource_selection ->> 'mode' = 'RESOURCE_IDS' then
          selected_datasource_reference := selected_datasource_reference || pg_catalog.jsonb_build_object(
            'resource_hash',datasource_revision_hash);
        end if;
        resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'resource_kind','DATASOURCE','mention_id',null,
          'requested_resource_id',selected_datasource_reference -> 'resource_id',
          'requested_revision',(selected_datasource_reference ->> 'resource_revision')::bigint,
          'effective_resource',selected_datasource_reference,'source',
          case when datasource_selection ->> 'mode' = 'RESOURCE_IDS' then 'OVERRIDE' else 'DEFAULT' end,
          'availability','AVAILABLE','unavailable_reason',null));
      end if;
    end if;
  end if;

  if model_selection ->> 'mode' = 'EXPLICIT_NONE' then
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
      app_data_agent.build_unavailable_singleton_resource_binding(
        model_selection,null,'MODEL_PROFILE','EXPLICITLY_CLEARED'));
    mandatory_blocked_reason := coalesce(mandatory_blocked_reason,'EXPLICITLY_CLEARED');
  elsif selected_model_reference is null or selected_model_reference = 'null'::jsonb then
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
      app_data_agent.build_unavailable_singleton_resource_binding(
        model_selection,null,'MODEL_PROFILE','DEFAULT_NOT_CONFIGURED'));
    mandatory_blocked_reason := coalesce(mandatory_blocked_reason,'DEFAULT_NOT_CONFIGURED');
  else
    begin
      selected_model_profile_id := (selected_model_reference ->> 'resource_id')::uuid;
      model_expected_revision := (selected_model_reference ->> 'resource_revision')::bigint;
    exception when others then
      raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_RESOURCE_REVISION_INVALID';
    end;
    select catalog.* into model_record from platform.list_active_model_catalog(
      authority.deployment_id,authority.principal_id) as catalog
    where catalog.model_profile_id = selected_model_profile_id and catalog.config_version = model_expected_revision;
    if not found then
      resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
        app_data_agent.build_unavailable_singleton_resource_binding(
          model_selection,selected_model_reference,'MODEL_PROFILE','MODEL_NOT_AVAILABLE'));
      mandatory_blocked_reason := coalesce(mandatory_blocked_reason,'MODEL_NOT_AVAILABLE');
    else
      model_revision_hash := app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb(model_record) - 'credential_ref');
      if model_selection ->> 'mode' = 'INHERIT_DEFAULT'
        and selected_model_reference ->> 'resource_hash' <> model_revision_hash then
        resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
          app_data_agent.build_unavailable_singleton_resource_binding(
            model_selection,selected_model_reference,'MODEL_PROFILE','RESOURCE_REVISION_MISMATCH'));
        mandatory_blocked_reason := coalesce(mandatory_blocked_reason,'RESOURCE_REVISION_MISMATCH');
      else
        if model_selection ->> 'mode' = 'RESOURCE_IDS' then
          selected_model_reference := selected_model_reference || pg_catalog.jsonb_build_object(
            'resource_hash',model_revision_hash);
        end if;
        resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'resource_kind','MODEL_PROFILE','mention_id',null,
          'requested_resource_id',selected_model_reference -> 'resource_id',
          'requested_revision',(selected_model_reference ->> 'resource_revision')::bigint,
          'effective_resource',selected_model_reference,'source',
          case when model_selection ->> 'mode' = 'RESOURCE_IDS' then 'OVERRIDE' else 'DEFAULT' end,
          'availability','AVAILABLE','unavailable_reason',null));
      end if;
    end if;
  end if;

  if mandatory_blocked_reason is not null then
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BLOCKED',mandatory_blocked_reason,null);
  end if;
  if conversation_record.datasource_id is distinct from selected_datasource_id
    or (conversation_record.model_profile_id is not null
      and conversation_record.model_profile_id is distinct from selected_model_profile_id) then
    raise exception using errcode = '23514', message = 'CONVERSATION_RESOURCE_MISMATCH';
  end if;

  snapshot_reference := defaults_revision.defaults_json -> 'schema_snapshot';
  if snapshot_reference is null or snapshot_reference = 'null'::jsonb then
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'resource_kind','SCHEMA_SNAPSHOT','mention_id',null,
      'requested_resource_id',null,'requested_revision',null,'effective_resource',null,
      'source','DEFAULT','availability','UNAVAILABLE','unavailable_reason','SCHEMA_SNAPSHOT_STALE'));
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BLOCKED','SCHEMA_SNAPSHOT_STALE',null);
  end if;
  select snapshot.* into snapshot_record from catalog.physical_schema_snapshot as snapshot
  where snapshot.app_id = authority.app_id and snapshot.tenant_id = authority.tenant_id
    and snapshot.environment = authority.environment and snapshot.datasource_connection_id = selected_datasource_id
    and snapshot.snapshot_content_hash = snapshot_reference ->> 'resource_hash'
    and (snapshot_reference ->> 'resource_revision')::bigint = 1
    and exists (select 1 from catalog.schema_scan_run scan
      where scan.app_id = snapshot.app_id and scan.tenant_id = snapshot.tenant_id
        and scan.environment = snapshot.environment and scan.datasource_id = snapshot.datasource_id
        and scan.datasource_fingerprint = snapshot.datasource_fingerprint
        and scan.snapshot_content_hash = snapshot.snapshot_content_hash and scan.terminal = 'SUCCEEDED'
        and scan.snapshot_id = (snapshot_reference ->> 'resource_id')::uuid)
  order by snapshot.committed_at desc limit 1 for share;
  if not found then
    resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'resource_kind','SCHEMA_SNAPSHOT','mention_id',null,
      'requested_resource_id',snapshot_reference -> 'resource_id',
      'requested_revision',(snapshot_reference ->> 'resource_revision')::bigint,
      'effective_resource',null,'source','DEFAULT','availability','UNAVAILABLE',
      'unavailable_reason','SCHEMA_SNAPSHOT_STALE'));
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BLOCKED','SCHEMA_SNAPSHOT_STALE',null);
  end if;

  context_reference := defaults_revision.defaults_json -> 'context_policy';
  egress_reference := defaults_revision.defaults_json -> 'egress_policy';
  safety_reference := defaults_revision.defaults_json -> 'execution_safety_policy';
  effective_context := app_data_agent.builtin_effective_config_policy('CONTEXT_POLICY');
  effective_egress_policy := app_data_agent.builtin_effective_config_policy('EGRESS_POLICY');
  effective_safety := app_data_agent.builtin_effective_config_policy('EXECUTION_SAFETY_POLICY');

  resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('resource_kind','CONTEXT_POLICY','mention_id',null,
      'requested_resource_id',null,'requested_revision',null,'effective_resource',context_reference,
      'source','POLICY','availability','AVAILABLE','unavailable_reason',null),
    pg_catalog.jsonb_build_object('resource_kind','EGRESS_POLICY','mention_id',null,
      'requested_resource_id',null,'requested_revision',null,'effective_resource',egress_reference,
      'source','POLICY','availability','AVAILABLE','unavailable_reason',null),
    pg_catalog.jsonb_build_object('resource_kind','EXECUTION_SAFETY_POLICY','mention_id',null,
      'requested_resource_id',null,'requested_revision',null,'effective_resource',safety_reference,
      'source','POLICY','availability','AVAILABLE','unavailable_reason',null),
    pg_catalog.jsonb_build_object('resource_kind','SEMANTIC_RELEASE','mention_id',null,
      'requested_resource_id',null,'requested_revision',null,'effective_resource',null,
      'source','ACTIVE_POINTER','availability','UNAVAILABLE',
      'unavailable_reason','SEMANTIC_RELEASE_NOT_PUBLISHED')
  );

  semantic_reference := defaults_revision.defaults_json -> 'semantic_release';
  if semantic_reference is null or semantic_reference = 'null'::jsonb then
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BOOTSTRAP_REQUIRED','SEMANTIC_RELEASE_NOT_PUBLISHED',null);
  end if;
  select domain.* into domain_record from semantic.semantic_domain_registry as domain
  where domain.app_id = authority.app_id and domain.tenant_id = authority.tenant_id
    and domain.environment = authority.environment and domain.datasource_id = selected_datasource_id
    and domain.is_active for share;
  if not found then
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BOOTSTRAP_REQUIRED','SEMANTIC_RELEASE_NOT_PUBLISHED',null);
  end if;
  select pointer.* into active_pointer from semantic.semantic_active_pointer as pointer
  where pointer.app_id = authority.app_id and pointer.tenant_id = authority.tenant_id
    and pointer.environment = authority.environment and pointer.semantic_domain = domain_record.semantic_domain for share;
  if not found or active_pointer.current_release_id is null then
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BOOTSTRAP_REQUIRED','SEMANTIC_RELEASE_NOT_PUBLISHED',null);
  end if;
  select release.* into release_record from semantic.semantic_source_release as release
  where release.app_id = active_pointer.app_id and release.tenant_id = active_pointer.tenant_id
    and release.environment = active_pointer.environment and release.semantic_domain = active_pointer.semantic_domain
    and release.release_id = active_pointer.current_release_id
    and release.release_generation = active_pointer.current_release_generation
    and release.release_digest = active_pointer.current_release_digest for share;
  if not found or semantic_reference ->> 'resource_id' <> release_record.release_id::text
    or (semantic_reference ->> 'resource_revision')::bigint <> release_record.release_generation
    or semantic_reference ->> 'resource_hash' <> release_record.release_digest then
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BOOTSTRAP_REQUIRED','SEMANTIC_RELEASE_NOT_PUBLISHED',null);
  end if;

  effective_model := selected_model_reference || pg_catalog.jsonb_build_object(
    'provider',model_record.provider,'model_id',model_record.model_id,
    'profile_version','model-profile@' || model_record.config_version::text);
  effective_semantic := semantic_reference || pg_catalog.jsonb_build_object(
    'datasource_id',selected_datasource_id,'semantic_generation',release_record.release_generation,
    'publication_status','PUBLISHED');
  effective_snapshot := snapshot_reference || pg_catalog.jsonb_build_object(
    'datasource_id',selected_datasource_id,'semantic_release_id',release_record.release_id,
    'semantic_generation',release_record.release_generation);
  resource_bindings := resource_bindings || pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('resource_kind','SCHEMA_SNAPSHOT','mention_id',null,
      'requested_resource_id',snapshot_reference -> 'resource_id',
      'requested_revision',(snapshot_reference ->> 'resource_revision')::bigint,
      'effective_resource',snapshot_reference,'source','DEFAULT',
      'availability','AVAILABLE','unavailable_reason',null));
  select pg_catalog.jsonb_agg(case when binding.document ->> 'resource_kind' = 'SEMANTIC_RELEASE'
      then pg_catalog.jsonb_build_object('resource_kind','SEMANTIC_RELEASE','mention_id',null,
        'requested_resource_id',semantic_reference -> 'resource_id',
        'requested_revision',(semantic_reference ->> 'resource_revision')::bigint,
        'effective_resource',semantic_reference,'source','ACTIVE_POINTER',
        'availability','AVAILABLE','unavailable_reason',null)
      else binding.document end order by binding.ordinal)
  into resource_bindings
  from pg_catalog.jsonb_array_elements(resource_bindings) with ordinality binding(document,ordinal);

  effective_egress := coalesce(nullif(requested_config #> '{overrides,egress}','null'::jsonb),
    effective_egress_policy - array['resource_id','resource_revision','resource_hash']);
  if exists (select 1 from pg_catalog.jsonb_array_elements_text(effective_egress -> 'allowed_providers') value(name)
      where not (effective_egress_policy -> 'allowed_providers') ? value.name)
    or exists (select 1 from pg_catalog.jsonb_array_elements_text(effective_egress -> 'allowed_audiences') value(name)
      where not (effective_egress_policy -> 'allowed_audiences') ? value.name)
    or pg_catalog.array_position(array['PUBLIC','INTERNAL','RESTRICTED','SECRET'],
        effective_egress ->> 'classification')
      < pg_catalog.array_position(array['PUBLIC','INTERNAL','RESTRICTED','SECRET'],
        effective_egress_policy ->> 'classification') then
    select pg_catalog.jsonb_agg(case when binding.document ->> 'resource_kind' = 'EGRESS_POLICY'
        then pg_catalog.jsonb_build_object('resource_kind','EGRESS_POLICY','mention_id',null,
          'requested_resource_id',null,'requested_revision',null,'effective_resource',null,
          'source','POLICY','availability','UNAVAILABLE','unavailable_reason','POLICY_REJECTED')
        else binding.document end order by binding.ordinal)
    into resource_bindings
    from pg_catalog.jsonb_array_elements(resource_bindings) with ordinality binding(document,ordinal);
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BLOCKED','POLICY_REJECTED',null);
  end if;
  if not (effective_egress -> 'allowed_providers') ? model_record.provider then
    select pg_catalog.jsonb_agg(case when binding.document ->> 'resource_kind' = 'EGRESS_POLICY'
        then pg_catalog.jsonb_build_object('resource_kind','EGRESS_POLICY','mention_id',null,
          'requested_resource_id',null,'requested_revision',null,'effective_resource',null,
          'source','POLICY','availability','UNAVAILABLE','unavailable_reason','EGRESS_PROVIDER_DENIED')
        else binding.document end order by binding.ordinal)
    into resource_bindings
    from pg_catalog.jsonb_array_elements(resource_bindings) with ordinality binding(document,ordinal);
    return app_data_agent.build_question_run_config_resolution(requested_resolution_id,scope_document,
      requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,authority_binding,resource_bindings,requested_config,resolved_at,
      'BLOCKED','EGRESS_PROVIDER_DENIED',null);
  end if;

  select coalesce(pg_catalog.jsonb_agg(binding.document order by
    binding.document ->> 'resource_kind',
    coalesce(binding.document ->> 'requested_resource_id','NONE'),
    binding.document ->> 'source',
    coalesce(binding.document ->> 'mention_id','')),'[]'::jsonb)
    into resource_bindings
  from pg_catalog.jsonb_array_elements(resource_bindings) binding(document);
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
    where binding.document ->> 'availability' = 'AVAILABLE'
    group by binding.document #>> '{effective_resource,resource_id}'
    having pg_catalog.count(distinct binding.document -> 'effective_resource') > 1
  ) then
    raise exception using errcode = '23514', message = 'EFFECTIVE_CONFIG_RESOURCE_REFERENCE_CONFLICT';
  end if;
  select coalesce(pg_catalog.jsonb_agg(resource.document order by resource.document ->> 'resource_id',
      (resource.document ->> 'resource_revision')::bigint,resource.document ->> 'resource_hash'),'[]'::jsonb)
    into context_resource_refs
  from (
    select binding.document -> 'effective_resource' as document
    from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
    where binding.document ->> 'availability' = 'AVAILABLE'
    group by binding.document -> 'effective_resource'
  ) resource;
  commit_at := pg_catalog.clock_timestamp();
  config_document := pg_catalog.jsonb_build_object(
    'schema_version','effective-run-config-receipt@1.0.0',
    'config_id',requested_config_id,'config_revision',1,'scope',scope_document,
    'run_id',requested_run_id,'operation','QUESTION_RUN','admission','READY',
    'conversation_binding',pg_catalog.jsonb_build_object(
      'conversation_id',requested_conversation_id,'resource_version',requested_conversation_version),
    'request_hash',request_hash,'defaults_ref',defaults_ref,'authority_binding',authority_binding,
    'model',effective_model,'datasource',selected_datasource_reference,
    'semantic_release',effective_semantic,'schema_snapshot',effective_snapshot,
    'context_policy',effective_context,'egress_policy',effective_egress_policy,
    'execution_safety_policy',effective_safety,'resource_bindings',resource_bindings,
    'optional_selection_evaluations',app_data_agent.build_optional_selection_evaluations(
      requested_config,defaults_ref,resource_bindings),
    'effective_egress',effective_egress);
  config_hash := app_data_agent.u2_canonical_sha256(config_document);
  config_ref := pg_catalog.jsonb_build_object(
    'config_id',requested_config_id,'config_revision',1,'config_hash',config_hash);

  insert into app_data_agent.effective_run_config_receipts (
    app_id,tenant_id,environment,config_id,config_revision,config_hash,run_id,principal_id,
    idempotency_key,request_hash,operation_kind,admission,defaults_revision,defaults_id,defaults_hash,
    membership_version,user_authz_epoch,workspace_lifecycle_version,app_epoch,route_resolution_id,
    route_resolution_hash,resolver_policy_version,model_profile_id,model_config_version,provider,model_id,
    datasource_id,datasource_revision_hash,schema_datasource_id,datasource_fingerprint,semantic_domain,
    semantic_release_id,semantic_release_generation,semantic_release_digest,schema_snapshot_hash,
    context_policy_hash,egress_policy_hash,execution_safety_policy_hash,provider_audience,classification,
    effective_config_json,committed_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,requested_config_id,1,config_hash,
    requested_run_id,authority.principal_id,requested_idempotency_key,request_hash,'QUESTION_RUN','READY',
    defaults_revision.defaults_revision,defaults_revision.defaults_id,defaults_revision.defaults_hash,
    authority.membership_version,app_user_record.authz_epoch,workspace_record.lifecycle_version,
    authority.app_epoch,requested_config_id,route_resolution_hash,'effective-config-resolver@1.0.0',
    selected_model_profile_id,model_expected_revision,model_record.provider,model_record.model_id,
    selected_datasource_id,datasource_revision_hash,selected_datasource_id::text,
    snapshot_record.datasource_fingerprint,release_record.semantic_domain,release_record.release_id,
    release_record.release_generation,release_record.release_digest,snapshot_record.snapshot_content_hash,
    context_reference ->> 'resource_hash',egress_reference ->> 'resource_hash',
    safety_reference ->> 'resource_hash',effective_egress #>> '{allowed_audiences,0}',
    effective_egress ->> 'classification',config_document,commit_at);

  insert into app_data_agent.effective_run_config_resource_bindings (
    app_id,tenant_id,environment,config_id,config_revision,binding_ordinal,resource_kind,mention_id,resource_id,
    requested_mode,requested_revision,effective_revision,effective_hash,availability,unavailable_reason,
    binding_json,committed_at)
  select authority.app_id,authority.tenant_id,authority.environment,requested_config_id,1,
    binding.ordinal::integer,binding.document ->> 'resource_kind',
    (binding.document ->> 'mention_id')::uuid,
    coalesce(binding.document #>> '{effective_resource,resource_id}',binding.document ->> 'requested_resource_id','NONE'),
    case when binding.document ->> 'source' = 'MENTION' then 'MENTION'
      when binding.document ->> 'source' = 'OVERRIDE' and binding.document ->> 'requested_resource_id' is null
        then 'EXPLICIT_NONE'
      when binding.document ->> 'source' = 'OVERRIDE' then 'RESOURCE_IDS' else 'INHERIT_DEFAULT' end,
    coalesce(binding.document ->> 'requested_revision',binding.document #>> '{effective_resource,resource_revision}'),
    binding.document #>> '{effective_resource,resource_revision}',
    binding.document #>> '{effective_resource,resource_hash}',binding.document ->> 'availability',
    binding.document ->> 'unavailable_reason',binding.document,commit_at
  from pg_catalog.jsonb_array_elements(resource_bindings) with ordinality binding(document,ordinal);

  context_document := pg_catalog.jsonb_build_object(
    'schema_version','effective-config-context-receipt@1.0.0',
    'receipt_id',requested_context_receipt_id,'consumer','RUN_ACCEPTANCE','scope',scope_document,
    'outbox_id',requested_context_receipt_id,'command_id',requested_config_id,
    'consumer_id',requested_config_id::text,'attempt_id',null,'lease_token',null,'worker_fence',0,
    'run_id',requested_run_id,'config_ref',config_ref,'semantic_release',effective_semantic,
    'schema_snapshot',effective_snapshot,'context_policy',context_reference,
    'provider',model_record.provider,'audiences',effective_egress -> 'allowed_audiences',
    'classification',effective_egress ->> 'classification','resource_refs',context_resource_refs,
    'consumed_at',app_data_agent.runtime_iso_timestamp(commit_at));
  context_hash := app_data_agent.u2_canonical_sha256(context_document);
  insert into app_data_agent.effective_config_context_receipts (
    app_id,tenant_id,environment,context_receipt_id,config_id,config_revision,config_hash,run_id,
    principal_id,consumer_kind,consumer_id,outbox_id,command_id,worker_fence,
    receipt_json,receipt_hash,consumed_at)
  values (authority.app_id,authority.tenant_id,authority.environment,requested_context_receipt_id,
    requested_config_id,1,config_hash,requested_run_id,authority.principal_id,'RUN_ACCEPTANCE',
    requested_config_id::text,requested_context_receipt_id,requested_config_id,0,
    context_document,context_hash,commit_at);

  accepted_payload := pg_catalog.jsonb_build_object(
    'kind','START_L2_RESEARCH','effective_config_ref',config_ref);
  accepted_payload_hash := platform.canonical_sha256(accepted_payload);
  accepted_command := requested_command || pg_catalog.jsonb_build_object('payload',accepted_payload);
  accepted_event := pg_catalog.jsonb_build_object(
    'schema_version','1.0.0','event_id',requested_resolution_id,
    'scope',pg_catalog.jsonb_build_object('app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment),
    'run_id',requested_run_id,'sequence',1,'worker_fence',0,
    'idempotency_key','event:' || requested_resolution_id::text,
    'occurred_at',app_data_agent.runtime_iso_timestamp(commit_at),
    'event_type','run.accepted','payload',pg_catalog.jsonb_build_object(
      'command_id',requested_config_id,'payload_hash',accepted_payload_hash));
  accepted_event_hash := app_data_agent.runtime_canonical_sha256(accepted_event);
  acceptance_result := app_data_agent.accept_backend_run_command(
    accepted_command,accepted_payload_hash,accepted_event,accepted_event_hash);
  insert into app_data_agent.workspace_run_bindings (
    app_id,tenant_id,environment,run_id,datasource_id,conversation_id,principal_id,
    model_profile_id,model_config_version,provider,model_id,datasource_binding_hash,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,requested_run_id,
    selected_datasource_id,requested_conversation_id,authority.principal_id,
    selected_model_profile_id,model_expected_revision,model_record.provider,model_record.model_id,
    datasource_revision_hash,commit_at
  );
  insert into app_data_agent.qa_messages (
    app_id,tenant_id,environment,conversation_id,message_id,owner_principal_id,
    role,content,message_type,run_id,metadata,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,requested_conversation_id,
    requested_resolution_id,authority.principal_id,'user',requested_command ->> 'question',
    'text',requested_run_id,pg_catalog.jsonb_build_object('source','QUESTION_RUN'),commit_at
  );
  return pg_catalog.jsonb_set(app_data_agent.build_question_run_config_resolution(
    requested_resolution_id,scope_document,requested_run_id,requested_config -> 'conversation_ref',request_hash,defaults_ref,
    authority_binding,resource_bindings,requested_config,commit_at,'READY',null,config_ref),
    '{effective_config}',config_document || pg_catalog.jsonb_build_object('config_hash',config_hash));
end
$function$;
