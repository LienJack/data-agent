\set ON_ERROR_STOP on

begin isolation level repeatable read read only;
do $surface$
declare
  relation_name text;
  accept_definition text;
  defaults_definition text;
  worker_definition text;
  bootstrap_definition text;
  optional_binding_definition text;
  datasource_guard_definition text;
  request_validator_definition text;
begin
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010653_app_data_agent_effective_run_config'
  ) then
    raise exception 'EFFECTIVE_CONFIG_LEDGER_ASSERTION_FAILED';
  end if;
  foreach relation_name in array array[
    'workspace_run_defaults','workspace_run_default_revisions',
    'effective_run_config_receipts','effective_run_config_resource_bindings',
    'effective_config_context_receipts'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app_data_agent'
        and relation.relname = relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend',pg_catalog.format('app_data_agent.%I',relation_name),
      'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception 'EFFECTIVE_CONFIG_RELATION_SURFACE_ASSERTION_FAILED:%',relation_name;
    end if;
  end loop;
  if pg_catalog.has_function_privilege(
    'authenticated',
    'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.resolve_semantic_bootstrap_job_config(jsonb)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.consume_worker_effective_run_config(uuid,uuid,bigint,text,uuid,text,uuid,text,bigint,bigint,uuid,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.revalidate_effective_run_config_internal(uuid,bigint,text,uuid,boolean)',
    'EXECUTE'
  ) then
    raise exception 'EFFECTIVE_CONFIG_FUNCTION_SURFACE_ASSERTION_FAILED';
  end if;

  select pg_catalog.pg_get_functiondef(procedure.oid) into strict accept_definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'accept_question_run_with_effective_config';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict defaults_definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'update_workspace_run_defaults';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict worker_definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'consume_worker_effective_run_config';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict bootstrap_definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'resolve_semantic_bootstrap_job_config';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict optional_binding_definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'build_requested_optional_resource_bindings';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict datasource_guard_definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'guard_datasource_resource_version_update';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict request_validator_definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'effective_config_request_is_valid';
  if accept_definition not like '%app_data_agent.u2_canonical_sha256%'
    or accept_definition not like '%platform.canonical_sha256%'
    or accept_definition not like '%BOOTSTRAP_REQUIRED%'
    or accept_definition not like '%accept_backend_run_command%'
    or accept_definition not like '%effective_config_ref%'
    or accept_definition not like '%runtime_canonical_sha256%'
    or accept_definition not like '%RESOURCE_NOT_FOUND_OR_FORBIDDEN%'
    or accept_definition not like '%for share%'
    or accept_definition not like '%outbox_id%requested_context_receipt_id%'
    or accept_definition not like '%command_id%requested_config_id%'
    or accept_definition not like '%btrim%question%'
    or accept_definition not like '%accepted_event.event_id = requested_resolution_id%'
    or accept_definition not like '%accepted_context.context_receipt_id = requested_context_receipt_id%'
    or accept_definition not like '%accepted_outbox.outbox_id = requested_context_receipt_id%'
    or accept_definition not like '%accepted_audit.audit_id = (requested_command ->> ''audit_id'')::uuid%'
    or accept_definition not like '%nullif(requested_config #> ''{overrides,egress}'',''null''::jsonb)%'
    or accept_definition not like '%conversation_record.resource_version <> requested_conversation_version%'
    or accept_definition not like '%insert into app_data_agent.workspace_run_bindings%'
    or accept_definition not like '%insert into app_data_agent.qa_messages%'
    or accept_definition not like '%conversation_binding%resource_version%'
    or accept_definition like '%distinct on%'
    or accept_definition not like '%datasource_record.resource_version%'
    or defaults_definition not like '%list_active_model_catalog%'
    or defaults_definition not like '%semantic.semantic_active_pointer%'
    or defaults_definition not like '%catalog.schema_scan_run%'
    or defaults_definition not like '%requested_defaults := resolved_defaults%'
    or defaults_definition not like '%WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE%'
    or defaults_definition not like '%datasource_record.resource_version%'
    or defaults_definition not like '%app_data_agent.u2_canonical_sha256%'
    or worker_definition not like '%lock_owned_run_fence%'
    or worker_definition not like '%EFFECTIVE_CONFIG_WORKER_FENCE_STALE%'
    or worker_definition not like '%consumer_id%requested_consumer_id%'
    or worker_definition not like '%attempt_id%requested_attempt_id%'
    or worker_definition not like '%lease_token%requested_lease_token%'
    or worker_definition not like '%worker_fence%requested_worker_fence%'
    or worker_definition not like '%outbox_id%requested_outbox_id%'
    or worker_definition not like '%command_id%requested_command_id%'
    or bootstrap_definition not like '%source_resources%'
    or bootstrap_definition not like '%mention_id%'
    or bootstrap_definition not like '%EFFECTIVE_CONFIG_RESOURCE_DUPLICATE%'
    or optional_binding_definition not like '%union all%'
    or optional_binding_definition like '%distinct%'
    or request_validator_definition not like '%having pg_catalog.count(*) > 1%'
    or datasource_guard_definition not like '%new.resource_version := old.resource_version + 1%'
    or datasource_guard_definition not like '%DATASOURCE_RESOURCE_VERSION_IMMUTABLE%'
  then
    raise exception 'EFFECTIVE_CONFIG_AUTHORITY_DEFINITION_ASSERTION_FAILED';
  end if;
  if exists (
    select 1 from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname in (
        'workspace_run_defaults','workspace_run_default_revisions',
        'effective_run_config_receipts','effective_run_config_resource_bindings',
        'effective_config_context_receipts'
      )
      and not attribute.attisdropped
      and attribute.attname ~ '(billing|price|credit|cost|settlement)'
  ) then
    raise exception 'EFFECTIVE_CONFIG_COMMERCIAL_COLUMN_ASSERTION_FAILED';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname = 'effective_config_context_receipts'
      and attribute.attname = 'consumer_id'
      and attribute.atttypid = 'text'::pg_catalog.regtype
  ) or not exists (
    select 1 from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname = 'effective_run_config_resource_bindings'
      and attribute.attname = 'mention_id'
      and attribute.atttypid = 'uuid'::pg_catalog.regtype
  ) then
    raise exception 'EFFECTIVE_CONFIG_FINAL_COLUMN_WIRE_ASSERTION_FAILED';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'app_data_agent.datasource_connections'::pg_catalog.regclass
      and attribute.attname = 'resource_version'
      and attribute.atttypid = 'bigint'::pg_catalog.regtype
      and attribute.attnotnull
  ) or not exists (
    select 1 from pg_catalog.pg_trigger as trigger
    where trigger.tgrelid = 'app_data_agent.datasource_connections'::pg_catalog.regclass
      and trigger.tgname = 'zz_datasource_resource_version_guard'
      and not trigger.tgisinternal
  ) then
    raise exception 'EFFECTIVE_CONFIG_DATASOURCE_VERSION_AUTHORITY_ASSERTION_FAILED';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint as constraint_record
    where constraint_record.conrelid = 'app_data_agent.effective_config_context_receipts'::pg_catalog.regclass
      and constraint_record.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid)
        like '%contains_potential_plaintext_secret((receipt_json - ''lease_token''::text))%'
  ) then
    raise exception 'EFFECTIVE_CONFIG_LEASE_TOKEN_RECEIPT_GUARD_ASSERTION_FAILED';
  end if;
  if exists (
    select 1 from pg_catalog.pg_constraint as constraint_record
    join pg_catalog.pg_class as relation on relation.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'catalog'
      and relation.relname = 'physical_schema_snapshot'
      and constraint_record.conname = 'physical_schema_snapshot_connection_identity_key'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint as constraint_record
    join pg_catalog.pg_class as relation on relation.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname = 'effective_run_config_receipts'
      and constraint_record.contype = 'f'
      and pg_catalog.pg_get_constraintdef(constraint_record.oid)
        like '%defaults_id, defaults_revision, defaults_hash)%'
  ) then
    raise exception 'EFFECTIVE_CONFIG_GREENFIELD_FK_ASSERTION_FAILED';
  end if;
end
$surface$;
commit;

begin;
set local role data_agent_effective_config_rpc_owner;
do $contract_hash$
declare
  command_without_hash jsonb := '{
    "schema_version":"workspace-defaults-cas-update@1.0.0",
    "operation_id":"00000000-0000-4000-8000-000000000010",
    "workspace_id":"00000000-0000-4000-8000-000000000003",
    "expected_defaults_revision":0,
    "idempotency_key":"defaults:first",
    "defaults":{
      "model":{"resource_id":"00000000-0000-4000-8000-000000000008","expected_revision":1},
      "datasource":{"resource_id":"00000000-0000-4000-8000-000000000009","expected_revision":1},
      "files":[{"resource_id":"00000000-0000-4000-8000-00000000000a","expected_revision":1}],
      "knowledge":[],"mcp_servers":[],"skills":[],
      "semantic_release":{"resource_id":"00000000-0000-4000-8000-00000000000b","expected_revision":3},
      "schema_snapshot":{"resource_id":"00000000-0000-4000-8000-00000000000c","expected_revision":7},
      "context_policy":{"resource_id":"00000000-0000-4000-8000-00000000000d","expected_revision":2},
      "egress_policy":{"resource_id":"00000000-0000-4000-8000-00000000000e","expected_revision":4},
      "execution_safety_policy":{"resource_id":"00000000-0000-4000-8000-00000000000f","expected_revision":6}
    }
  }'::jsonb;
  full_json_fixture jsonb := pg_catalog.jsonb_build_object(
    U&'\+010000','supp',U&'\E000','bmp',
    'fraction',1.5,'small',1e-7::numeric,'threshold',1e-6::numeric,
    'big',1e20::numeric,'exponent',1e21::numeric,
    'precise',1.2345678901234567::numeric,
    'sum',0.30000000000000004::numeric,'tiny',5e-324::numeric,
    'max',1.7976931348623157e308::numeric,
    'largeInteger',140751465587434200::numeric,'negativeZero',-0.0::numeric,
    'string',U&'quote" slash\\ control\000A emoji\+01F600 line\2028separator');
begin
  if app_data_agent.u2_canonical_sha256(command_without_hash) <>
    'sha256:f8063ee530e5b8692939fbf265aab438af58f802ab5bd05ecc2430b14a3c2a15'
  then
    raise exception 'U2_CONTRACT_CANONICAL_HASH_FIXTURE_MISMATCH';
  end if;
  if app_data_agent.u2_contract_canonical_json('1.0'::jsonb) <> '1'
    or app_data_agent.u2_contract_canonical_json('-0.0'::jsonb) <> '0'
    or app_data_agent.u2_contract_canonical_json('0.000001'::jsonb) <> '0.000001'
    or app_data_agent.u2_contract_canonical_json('0.0000001'::jsonb) <> '1e-7'
    or app_data_agent.u2_contract_canonical_json('100000000000000000000'::jsonb) <>
      '100000000000000000000'
    or app_data_agent.u2_contract_canonical_json('1000000000000000000000'::jsonb) <> '1e+21'
  then
    raise exception 'U2_CONTRACT_CANONICAL_NUMBER_RENDERING_MISMATCH';
  end if;
  if app_data_agent.u2_canonical_sha256(full_json_fixture) <>
    'sha256:95bd3a69717839cfafdc376ce4b64b3c6c0d9eefd17f07f94891451c42e4b706'
  then
    raise exception 'U2_CONTRACT_CANONICAL_FULL_JSON_FIXTURE_MISMATCH:%',
      app_data_agent.u2_contract_canonical_json(full_json_fixture);
  end if;
  if app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'n',1e-7::numeric,U&'\+010000','supplementary',U&'\E000','bmp'
    )) <> 'sha256:dc67784b5dab2ea74956f3c1c916cf497cfcc2895565d16ef2138dceb8e951ac'
  then
    raise exception 'U2_CONTRACT_CANONICAL_UTF16_FIXTURE_MISMATCH';
  end if;
end
$contract_hash$;
rollback;

do $strict_candidate_contract$
begin
  if app_data_agent.workspace_run_defaults_document_is_valid(
    '{
      "schema_version":"workspace-run-defaults@1.0.0",
      "model":{"mode":"EXPLICIT_NONE","resource_ids":[]},
      "datasource":{"mode":"EXPLICIT_NONE","resource_ids":[]},
      "files":{"mode":"EXPLICIT_NONE","resource_ids":[]},
      "knowledge":{"mode":"EXPLICIT_NONE","resource_ids":[]},
      "mcp_servers":{"mode":"EXPLICIT_NONE","resource_ids":[]},
      "skills":{"mode":"EXPLICIT_NONE","resource_ids":[]},
      "semantic_release":{"mode":"EXPLICIT_NONE","resource_ids":[]},
      "context_policy":{"mode":"EXPLICIT_NONE","resource_ids":[]},
      "egress_policy":{"mode":"EXPLICIT_NONE","resource_ids":[]},
      "safety_bounds":{"mode":"EXPLICIT_NONE","resource_ids":[]},
      "provider_eligibility":true
    }'::jsonb
  ) then
    raise exception 'EFFECTIVE_CONFIG_CLIENT_AUTHORITY_CLAIM_ACCEPTED';
  end if;
  if app_data_agent.effective_config_request_is_valid(
    '{
      "schema_version":"effective-run-config-request@1.0.0",
      "operation":"QUESTION_RUN",
      "config_id":"00000000-0000-4000-8000-000000005301",
      "config_revision":1,
      "defaults_revision":1,
      "request_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "overrides":{},"mentions":[],
      "context_receipt_id":"00000000-0000-4000-8000-000000005302",
      "semantic_release_status":"PUBLISHED"
    }'::jsonb
  ) then
    raise exception 'EFFECTIVE_CONFIG_CLIENT_SEMANTIC_CLAIM_ACCEPTED';
  end if;
end
$strict_candidate_contract$;

do $final_wire_contract$
declare
  question_request jsonb;
  inherited_request jsonb;
  bootstrap_request jsonb;
  blocked_resolution jsonb;
  semantic_only_resolution jsonb;
  semantic_and_controlled_resolution jsonb;
  semantic_and_inherited_resolution jsonb;
  optional_evaluations jsonb;
begin
  question_request := pg_catalog.jsonb_build_object(
    'schema_version','run-config-request@1.0.0',
    'workspace_id','00000000-0000-4000-8000-00000000aa22',
    'idempotency_key','question:10653:final-wire',
    'defaults_ref',pg_catalog.jsonb_build_object(
      'defaults_id','00000000-0000-4000-8000-000000005311',
      'defaults_revision',1,'defaults_hash','sha256:' || pg_catalog.repeat('a',64)),
    'overrides',pg_catalog.jsonb_build_object(
      'model',pg_catalog.jsonb_build_object('mode','INHERIT_DEFAULT'),
      'datasource',pg_catalog.jsonb_build_object('mode','INHERIT_DEFAULT'),
      'files',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
      'knowledge',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
      'mcp_servers',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
      'skills',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
      'egress',null),
    'mentions','[]'::jsonb,'operation','QUESTION_RUN',
    'conversation_ref',pg_catalog.jsonb_build_object(
      'conversation_id','00000000-0000-4000-8000-000000005310',
      'expected_resource_version',1),
    'run_id','00000000-0000-4000-8000-000000005312',
    'request_hash','sha256:' || pg_catalog.repeat('b',64));
  if not app_data_agent.effective_config_request_is_valid(question_request) then
    raise exception 'EFFECTIVE_CONFIG_FINAL_QUESTION_WIRE_REJECTED';
  end if;
  inherited_request := pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        pg_catalog.jsonb_set(question_request,'{overrides,files}',
          pg_catalog.jsonb_build_object('mode','INHERIT_DEFAULT')),
        '{overrides,knowledge}',pg_catalog.jsonb_build_object('mode','INHERIT_DEFAULT')),
      '{overrides,mcp_servers}',pg_catalog.jsonb_build_object('mode','INHERIT_DEFAULT')),
    '{overrides,skills}',pg_catalog.jsonb_build_object('mode','INHERIT_DEFAULT'));
  if app_data_agent.effective_config_request_is_valid(pg_catalog.jsonb_set(
    question_request,'{mentions}',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'mention_id','00000000-0000-4000-8000-000000005301',
        'resource_kind','FILE','resource_id','00000000-0000-4000-8000-000000005399',
        'expected_revision',1),
      pg_catalog.jsonb_build_object(
        'mention_id','00000000-0000-4000-8000-000000005302',
        'resource_kind','FILE','resource_id','00000000-0000-4000-8000-000000005399',
        'expected_revision',1)))) then
    raise exception 'EFFECTIVE_CONFIG_DUPLICATE_MENTION_RESOURCE_ACCEPTED';
  end if;
  if app_data_agent.effective_config_request_is_valid(pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      question_request,'{mentions}',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'mention_id','00000000-0000-4000-8000-000000005301',
          'resource_kind','FILE','resource_id','00000000-0000-4000-8000-000000005399',
          'expected_revision',1))),
    '{overrides,files}',pg_catalog.jsonb_build_object(
      'mode','RESOURCE_IDS','resources',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'resource_id','00000000-0000-4000-8000-000000005399','expected_revision',1))))) then
    raise exception 'EFFECTIVE_CONFIG_MENTION_OVERRIDE_DUPLICATE_ACCEPTED';
  end if;
  bootstrap_request := (question_request - 'run_id' - 'conversation_ref') || pg_catalog.jsonb_build_object(
    'operation','SEMANTIC_BOOTSTRAP_JOB','job_id','00000000-0000-4000-8000-000000005313',
    'trigger_question_run_id','00000000-0000-4000-8000-000000005312');
  if app_data_agent.effective_config_request_is_valid(bootstrap_request) then
    raise exception 'EFFECTIVE_CONFIG_BOOTSTRAP_MODEL_WAS_NOT_CLEARED';
  end if;
  bootstrap_request := pg_catalog.jsonb_set(bootstrap_request,'{overrides,model}',
    '{"mode":"EXPLICIT_NONE"}'::jsonb);
  if not app_data_agent.effective_config_request_is_valid(bootstrap_request) then
    raise exception 'EFFECTIVE_CONFIG_FINAL_BOOTSTRAP_WIRE_REJECTED';
  end if;
  if app_data_agent.build_unavailable_singleton_resource_binding(
      pg_catalog.jsonb_build_object('mode','RESOURCE_IDS','resources',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('resource_id','00000000-0000-4000-8000-000000005399',
          'expected_revision',7))),null,'DATASOURCE','RESOURCE_REVISION_MISMATCH') <>
    pg_catalog.jsonb_build_object(
      'resource_kind','DATASOURCE','mention_id',null,
      'requested_resource_id','00000000-0000-4000-8000-000000005399',
      'requested_revision',7,'effective_resource',null,'source','OVERRIDE',
      'availability','UNAVAILABLE','unavailable_reason','RESOURCE_REVISION_MISMATCH')
    or app_data_agent.build_unavailable_singleton_resource_binding(
      pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),null,
      'MODEL_PROFILE','DEFAULT_REMOVED') #>> '{source}' <> 'OVERRIDE'
    or app_data_agent.build_unavailable_singleton_resource_binding(
      pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),null,
      'MODEL_PROFILE','DEFAULT_REMOVED') #>> '{unavailable_reason}' <> 'EXPLICITLY_CLEARED'
    or app_data_agent.build_unavailable_singleton_resource_binding(
      pg_catalog.jsonb_build_object('mode','INHERIT_DEFAULT'),
      pg_catalog.jsonb_build_object(
        'resource_id','00000000-0000-4000-8000-000000005398',
        'resource_revision',3,'resource_hash','sha256:' || pg_catalog.repeat('9',64)),
      'DATASOURCE','RESOURCE_DISABLED') #>> '{source}' <> 'DEFAULT'
  then
    raise exception 'EFFECTIVE_CONFIG_MANDATORY_SELECTION_CORRELATION_ASSERTION_FAILED';
  end if;
  if app_data_agent.build_inherited_optional_resource_bindings(
      pg_catalog.jsonb_set(question_request,'{overrides,files}',
        pg_catalog.jsonb_build_object('mode','INHERIT_DEFAULT')),
      pg_catalog.jsonb_build_object(
        'files',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'resource_id','00000000-0000-4000-8000-000000005397',
          'resource_revision',4,'resource_hash','sha256:' || pg_catalog.repeat('8',64))),
        'knowledge','[]'::jsonb,'mcp_servers','[]'::jsonb,'skills','[]'::jsonb)
    ) #>> '{0,source}' <> 'DEFAULT'
    or app_data_agent.build_inherited_optional_resource_bindings(
      inherited_request,
      pg_catalog.jsonb_build_object(
        'files','[]'::jsonb,'knowledge','[]'::jsonb,
        'mcp_servers','[]'::jsonb,'skills','[]'::jsonb)
    ) <> '[]'::jsonb
  then
    raise exception 'EFFECTIVE_CONFIG_INHERITED_OPTIONAL_BINDING_ASSERTION_FAILED';
  end if;
  optional_evaluations := app_data_agent.build_optional_selection_evaluations(
    inherited_request,question_request -> 'defaults_ref',
    app_data_agent.build_inherited_optional_resource_bindings(
      inherited_request,pg_catalog.jsonb_build_object(
        'files',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'resource_id','00000000-0000-4000-8000-000000005397',
          'resource_revision',4,'resource_hash','sha256:' || pg_catalog.repeat('8',64))),
        'knowledge','[]'::jsonb,'mcp_servers','[]'::jsonb,'skills','[]'::jsonb)));
  if pg_catalog.jsonb_array_length(optional_evaluations) <> 4
    or optional_evaluations #>> '{0,resource_kind}' <> 'FILE'
    or optional_evaluations #>> '{0,selection_mode}' <> 'INHERIT_DEFAULT'
    or optional_evaluations #>> '{0,binding_count}' <> '1'
    or optional_evaluations #> '{0,defaults_ref}' <> question_request -> 'defaults_ref'
    or optional_evaluations #>> '{1,binding_count}' <> '0'
    or optional_evaluations #> '{1,defaults_ref}' <> question_request -> 'defaults_ref'
  then
    raise exception 'EFFECTIVE_CONFIG_OPTIONAL_SELECTION_EVALUATION_ASSERTION_FAILED';
  end if;
  if not app_data_agent.command_payload_is_valid(pg_catalog.jsonb_build_object(
      'kind','START_L2_RESEARCH','effective_config_ref',pg_catalog.jsonb_build_object(
        'config_id','00000000-0000-4000-8000-000000005314','config_revision',1,
        'config_hash','sha256:' || pg_catalog.repeat('c',64))))
    or app_data_agent.command_payload_is_valid(pg_catalog.jsonb_build_object(
      'kind','START_L2_RESEARCH','effective_config_ref',pg_catalog.jsonb_build_object(
        'config_id','00000000-0000-4000-8000-000000005314','config_revision',1,
        'config_hash','sha256:' || pg_catalog.repeat('c',64)),
      'datasource_id','00000000-0000-4000-8000-000000005315'))
  then
    raise exception 'EFFECTIVE_CONFIG_COMMAND_PAYLOAD_REF_ONLY_ASSERTION_FAILED';
  end if;
  blocked_resolution := app_data_agent.build_question_run_config_resolution(
    '00000000-0000-4000-8000-000000005316'::uuid,'{}'::jsonb,
    '00000000-0000-4000-8000-000000005317'::uuid,
    pg_catalog.jsonb_build_object('conversation_id','00000000-0000-4000-8000-000000005310',
      'expected_resource_version',1),
    'sha256:' || pg_catalog.repeat('d',64),'{}'::jsonb,'{}'::jsonb,'[]'::jsonb,question_request,
    pg_catalog.clock_timestamp(),'BLOCKED','RESOURCE_NOT_FOUND_OR_FORBIDDEN',null);
  if blocked_resolution -> 'effective_config' <> 'null'::jsonb then
    raise exception 'EFFECTIVE_CONFIG_BLOCKED_ENVELOPE_WROTE_CONFIG';
  end if;
  blocked_resolution := blocked_resolution -> 'resolution';
  if pg_catalog.jsonb_array_length(blocked_resolution -> 'resource_bindings') <> 1
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(blocked_resolution -> 'resource_bindings') binding(document)
      where not binding.document ? 'mention_id' or binding.document -> 'mention_id' <> 'null'::jsonb
    )
    or blocked_resolution #>> '{resource_bindings,0,resource_kind}' <> 'DATASOURCE'
  then
    raise exception 'EFFECTIVE_CONFIG_MANDATORY_CLOSURE_ASSERTION_FAILED';
  end if;
  semantic_only_resolution := app_data_agent.build_question_run_config_resolution(
    '00000000-0000-4000-8000-000000005318'::uuid,'{}'::jsonb,
    '00000000-0000-4000-8000-000000005319'::uuid,
    pg_catalog.jsonb_build_object('conversation_id','00000000-0000-4000-8000-000000005310',
      'expected_resource_version',1),
    'sha256:' || pg_catalog.repeat('e',64),question_request -> 'defaults_ref','{}'::jsonb,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'resource_kind','SEMANTIC_RELEASE','mention_id',null,
      'requested_resource_id',null,'requested_revision',null,'effective_resource',null,
      'source','ACTIVE_POINTER','availability','UNAVAILABLE',
      'unavailable_reason','SEMANTIC_RELEASE_NOT_PUBLISHED')),inherited_request,
    pg_catalog.clock_timestamp(),'BOOTSTRAP_REQUIRED','SEMANTIC_RELEASE_NOT_PUBLISHED',null);
  if semantic_only_resolution -> 'effective_config' <> 'null'::jsonb then
    raise exception 'EFFECTIVE_CONFIG_BOOTSTRAP_ENVELOPE_WROTE_CONFIG';
  end if;
  semantic_only_resolution := semantic_only_resolution -> 'resolution';
  if semantic_only_resolution ->> 'admission' <> 'BOOTSTRAP_REQUIRED'
    or semantic_only_resolution -> 'unavailable_reasons' <>
      '["SEMANTIC_RELEASE_NOT_PUBLISHED"]'::jsonb
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        semantic_only_resolution -> 'optional_selection_evaluations') evaluation(document)
      where evaluation.document ->> 'selection_mode' <> 'INHERIT_DEFAULT'
        or evaluation.document ->> 'binding_count' <> '0'
        or evaluation.document -> 'defaults_ref' <> question_request -> 'defaults_ref'
    )
  then
    raise exception 'EFFECTIVE_CONFIG_SEMANTIC_SOLE_BOOTSTRAP_ASSERTION_FAILED';
  end if;
  semantic_and_inherited_resolution := app_data_agent.build_question_run_config_resolution(
    '00000000-0000-4000-8000-00000000531e'::uuid,'{}'::jsonb,
    '00000000-0000-4000-8000-00000000531f'::uuid,
    pg_catalog.jsonb_build_object('conversation_id','00000000-0000-4000-8000-000000005310',
      'expected_resource_version',1),
    'sha256:' || pg_catalog.repeat('7',64),question_request -> 'defaults_ref','{}'::jsonb,
    (semantic_only_resolution -> 'resource_bindings') || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'resource_kind','FILE','mention_id',null,
        'requested_resource_id','00000000-0000-4000-8000-000000005397',
        'requested_revision',4,'effective_resource',null,'source','DEFAULT',
        'availability','UNAVAILABLE','unavailable_reason','RESOURCE_NOT_FOUND_OR_FORBIDDEN')),
    inherited_request,pg_catalog.clock_timestamp(),'BOOTSTRAP_REQUIRED',
    'SEMANTIC_RELEASE_NOT_PUBLISHED',null);
  semantic_and_inherited_resolution := semantic_and_inherited_resolution -> 'resolution';
  if semantic_and_inherited_resolution ->> 'admission' <> 'BLOCKED'
    or semantic_and_inherited_resolution -> 'unavailable_reasons' <>
      '["RESOURCE_NOT_FOUND_OR_FORBIDDEN","SEMANTIC_RELEASE_NOT_PUBLISHED"]'::jsonb
    or semantic_and_inherited_resolution #>> '{optional_selection_evaluations,0,binding_count}' <> '1'
    or semantic_and_inherited_resolution #>> '{optional_selection_evaluations,1,binding_count}' <> '0'
  then
    raise exception 'EFFECTIVE_CONFIG_SEMANTIC_INHERITED_BLOCKED_ASSERTION_FAILED';
  end if;
  semantic_and_controlled_resolution := app_data_agent.build_question_run_config_resolution(
    '00000000-0000-4000-8000-00000000531a'::uuid,'{}'::jsonb,
    '00000000-0000-4000-8000-00000000531b'::uuid,
    pg_catalog.jsonb_build_object('conversation_id','00000000-0000-4000-8000-000000005310',
      'expected_resource_version',1),
    'sha256:' || pg_catalog.repeat('f',64),question_request -> 'defaults_ref','{}'::jsonb,
    (semantic_only_resolution -> 'resource_bindings') || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'resource_kind','FILE','mention_id','00000000-0000-4000-8000-00000000531c',
        'requested_resource_id','00000000-0000-4000-8000-00000000531d',
        'requested_revision',1,'effective_resource',null,'source','MENTION',
        'availability','UNAVAILABLE','unavailable_reason','RESOURCE_NOT_FOUND_OR_FORBIDDEN')),question_request,
    pg_catalog.clock_timestamp(),'BOOTSTRAP_REQUIRED','SEMANTIC_RELEASE_NOT_PUBLISHED',null);
  semantic_and_controlled_resolution := semantic_and_controlled_resolution -> 'resolution';
  if semantic_and_controlled_resolution ->> 'admission' <> 'BLOCKED'
    or semantic_and_controlled_resolution -> 'unavailable_reasons' <>
      '["RESOURCE_NOT_FOUND_OR_FORBIDDEN","SEMANTIC_RELEASE_NOT_PUBLISHED"]'::jsonb
    or semantic_and_controlled_resolution -> 'required_action' <> 'null'::jsonb
  then
    raise exception 'EFFECTIVE_CONFIG_SEMANTIC_CONTROLLED_BLOCKED_ASSERTION_FAILED';
  end if;
end
$final_wire_contract$;

begin;
set local role data_agent_backend;
do $backend_dml_denied$
begin
  begin
    insert into app_data_agent.workspace_run_defaults (
      app_id,tenant_id,environment,defaults_id,defaults_revision,revision_id,defaults_hash,
      updated_by_principal_id
    ) values (
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa22'::uuid,'test',
      '00000000-0000-4000-8000-000000005300'::uuid,1,
      '00000000-0000-4000-8000-000000005303'::uuid,
      'sha256:' || pg_catalog.repeat('a',64),
      '00000000-0000-4000-8000-000000001003'::uuid
    );
    raise exception 'EFFECTIVE_CONFIG_BACKEND_DIRECT_DML_WAS_NOT_REJECTED';
  exception when insufficient_privilege then null;
  end;
end
$backend_dml_denied$;
rollback;

do $greenfield_empty$
begin
  if (select pg_catalog.count(*) from app_data_agent.workspace_run_defaults) <> 0
    or (select pg_catalog.count(*) from app_data_agent.workspace_run_default_revisions) <> 0
    or (select pg_catalog.count(*) from app_data_agent.effective_run_config_receipts) <> 0
    or (select pg_catalog.count(*) from app_data_agent.effective_run_config_resource_bindings) <> 0
    or (select pg_catalog.count(*) from app_data_agent.effective_config_context_receipts) <> 0
  then
    raise exception 'EFFECTIVE_CONFIG_GREENFIELD_TABLES_NOT_EMPTY';
  end if;
end
$greenfield_empty$;
