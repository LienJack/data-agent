create function app_data_agent.falcon24_e1_runtime_surface_is_empty()
returns boolean language plpgsql stable security definer set search_path='' as $function$
declare authority record; relation_name text; relation_id regclass; has_rows boolean;
  runtime_relations constant text[]:=array[
    'app_data_agent.runs','app_data_agent.commands','app_data_agent.idempotency_records',
    'app_data_agent.run_events',
    'app_data_agent.run_attempts','app_data_agent.run_projections','app_data_agent.run_checkpoints',
    'app_data_agent.run_effect_receipts','app_data_agent.run_interruptions',
    'app_data_agent.run_interruption_replies','app_data_agent.outbox','app_data_agent.artifacts',
    'app_data_agent.artifact_export_receipts',
    'app_data_agent.qa_conversations','app_data_agent.qa_messages',
    'app_data_agent.qa_resource_switch_operations','app_data_agent.qa_directory_operation_receipts',
    'app_data_agent.qa_admin_conversation_audit_receipts',
    'app_data_agent.qa_conversation_retention_claims',
    'app_data_agent.workspace_run_bindings','app_data_agent.effective_run_config_receipts',
    'app_data_agent.effective_run_config_resource_bindings',
    'app_data_agent.effective_config_context_receipts','app_data_agent.agent_team_tasks',
    'app_data_agent.agent_team_handoffs','app_data_agent.agent_team_context_epochs',
    'app_data_agent.agent_team_completion_receipts','app_data_agent.agent_team_events',
    'app_data_agent.agent_team_verifier_decisions','app_data_agent.agent_team_task_capabilities',
    'app_data_agent.agent_team_acceptance_receipts',
    'app_data_agent.agent_team_accepted_sibling_output_attachments',
    'app_data_agent.provider_invocation_intents',
    'app_data_agent.provider_invocation_dispatch_permits',
    'app_data_agent.provider_invocation_outcomes',
    'app_data_agent.provider_invocation_usage_receipts',
    'app_data_agent.analysis_python_sources','app_data_agent.analysis_operator_results',
    'app_data_agent.analysis_context_journal','app_data_agent.analysis_result_stages',
    'app_data_agent.analysis_result_stage_artifacts',
    'app_data_agent.analysis_stage_oracle_records',
    'app_data_agent.analysis_stage_explanation_records',
    'app_data_agent.analysis_result_stage_cleanup_receipts',
    'app_data_agent.analysis_authority_commits','app_data_agent.analysis_authority_current',
    'app_data_agent.analysis_authority_outbox','app_data_agent.analysis_system_artifacts',
    'app_data_agent.text2sql_system_artifacts','app_data_agent.text2sql_sandbox_claims',
    'app_data_agent.text2sql_sandbox_execution_events',
    'app_data_agent.text2sql_sandbox_execution_records',
    'app_data_agent.sensitive_execution_artifacts',
    'app_data_agent.sensitive_execution_artifact_access_audit',
    'app_data_agent.falcon24_acceptance_campaigns',
    'app_data_agent.falcon24_acceptance_campaign_runs',
    'app_data_agent.falcon24_qualifications','app_data_agent.falcon24_qualification_slots']::text[];
begin
  select * into strict authority from platform.current_backend_authority(true);
  for relation_name in
    select explicit_relation.name
    from pg_catalog.unnest(runtime_relations) explicit_relation(name)
    union
    select pg_catalog.format('%I.%I',column_row.table_schema,column_row.table_name)
    from information_schema.columns column_row
    join information_schema.tables table_row
      on table_row.table_schema=column_row.table_schema
      and table_row.table_name=column_row.table_name
      and table_row.table_type='BASE TABLE'
    where column_row.table_schema='app_data_agent' and column_row.column_name='run_id'
  loop
    relation_id:=pg_catalog.to_regclass(relation_name);
    if relation_id is null then return false; end if;
    execute pg_catalog.format(
      'select exists(select 1 from %s where app_id=$1 and tenant_id=$2 and environment=$3 limit 1)',
      relation_id)
      into strict has_rows using authority.app_id,authority.tenant_id,authority.environment;
    if has_rows then return false; end if;
  end loop;
  return true;
end
$function$;

create function app_data_agent.falcon24_e1_activation_attempt_document(
  attempt app_data_agent.falcon24_e1_activation_attempts)
returns jsonb language sql immutable strict security definer set search_path='' as $function$
  select pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-activation-attempt@1.0.0',
    'attempt_id',attempt.attempt_id,'baseline_id',attempt.baseline_id,
    'expected_baseline_hash',attempt.expected_baseline_hash,'status',attempt.status,
    'failure_code',attempt.failure_code)
$function$;

create function app_data_agent.falcon24_e1_binding_document(
  current_epoch app_data_agent.falcon24_current_authority_epoch)
returns jsonb language sql immutable strict security definer set search_path='' as $function$
  select pg_catalog.jsonb_build_object(
    'schema_version','falcon24-authority-binding@1.0.0',
    'authority_epoch',current_epoch.authority_epoch,'baseline_id',current_epoch.baseline_id,
    'baseline_hash',current_epoch.baseline_hash,
    'activation_attempt_id',current_epoch.activation_attempt_id)
$function$;

create function app_data_agent.begin_falcon24_e1_activation_attempt(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; baseline app_data_agent.falcon24_authority_baselines%rowtype;
  existing app_data_agent.falcon24_e1_activation_attempts%rowtype;
  requested_attempt_id uuid; requested_baseline_id uuid;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','attempt_id','baseline_id','expected_baseline_hash','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-e1-activation-attempt-begin@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'baseline_id') is distinct from true
    or command->>'expected_baseline_hash'!~'^sha256:[0-9a-f]{64}$'
  then raise exception using errcode='22023',message='FALCON24_E1_ACTIVATION_ATTEMPT_INVALID'; end if;
  requested_attempt_id:=(command->>'attempt_id')::uuid;
  requested_baseline_id:=(command->>'baseline_id')::uuid;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-e1-activation:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  if exists(select 1 from app_data_agent.falcon24_current_authority_epoch current_epoch
    where current_epoch.app_id=authority.app_id and current_epoch.tenant_id=authority.tenant_id
      and current_epoch.environment=authority.environment)
  then raise exception using errcode='55000',message='FALCON24_E1_ALREADY_ACTIVE'; end if;
  select * into baseline from app_data_agent.falcon24_authority_baselines row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.baseline_id=requested_baseline_id
    for update;
  if not found then raise exception using errcode='02000',message='FALCON24_E1_BASELINE_NOT_FOUND'; end if;
  if baseline.status<>'STAGED'
    or baseline.baseline_hash is distinct from command->>'expected_baseline_hash'
  then raise exception using errcode='55000',message='FALCON24_E1_BASELINE_NOT_STAGED'; end if;
  select * into existing from app_data_agent.falcon24_e1_activation_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.attempt_id=requested_attempt_id for update;
  if found then
    if existing.baseline_id is distinct from requested_baseline_id
      or existing.expected_baseline_hash is distinct from command->>'expected_baseline_hash'
    then raise exception using errcode='23505',message='FALCON24_E1_ACTIVATION_ATTEMPT_CONFLICT'; end if;
  else
    insert into app_data_agent.falcon24_e1_activation_attempts(
      app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash,status,
      created_by,created_at)
    values(authority.app_id,authority.tenant_id,authority.environment,requested_attempt_id,
      requested_baseline_id,command->>'expected_baseline_hash','OPEN',authority.principal_id,
      pg_catalog.clock_timestamp()) returning * into strict existing;
  end if;
  return app_data_agent.falcon24_e1_activation_attempt_document(existing);
end
$function$;

create function app_data_agent.hold_falcon24_e1_activation_attempt(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; attempt app_data_agent.falcon24_e1_activation_attempts%rowtype;
  now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','attempt_id','baseline_id','expected_baseline_hash','failure_code',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-e1-activation-attempt-hold@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'baseline_id') is distinct from true
    or command->>'expected_baseline_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'failure_code'!~'^[A-Z][A-Z0-9_]{2,127}$'
  then raise exception using errcode='22023',message='FALCON24_E1_ACTIVATION_HOLD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into attempt from app_data_agent.falcon24_e1_activation_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.attempt_id=(command->>'attempt_id')::uuid
    for update;
  if not found then raise exception using errcode='02000',message='FALCON24_E1_ACTIVATION_ATTEMPT_NOT_FOUND'; end if;
  if attempt.baseline_id is distinct from (command->>'baseline_id')::uuid
    or attempt.expected_baseline_hash is distinct from command->>'expected_baseline_hash'
  then raise exception using errcode='55000',message='FALCON24_E1_ACTIVATION_ATTEMPT_MISMATCH'; end if;
  if attempt.status='ACTIVATED' then
    raise exception using errcode='55000',message='FALCON24_E1_ACTIVATION_ATTEMPT_TERMINAL';
  elsif attempt.status='HOLD' then
    if attempt.failure_code is distinct from command->>'failure_code' then
      raise exception using errcode='23505',message='FALCON24_E1_ACTIVATION_HOLD_CONFLICT'; end if;
    return app_data_agent.falcon24_e1_activation_attempt_document(attempt);
  end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_e1_activation_attempts set
    status='HOLD',failure_code=command->>'failure_code',decided_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and attempt_id=attempt.attempt_id
      and status='OPEN' returning * into strict attempt;
  update app_data_agent.falcon24_authority_baselines set status='HOLD'
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and baseline_id=attempt.baseline_id and status='STAGED';
  update app_data_agent.falcon24_e1_staging_sessions session set
    status='HOLD',failure_code=command->>'failure_code',updated_at=now_at
    from app_data_agent.falcon24_authority_baselines baseline
    where baseline.app_id=authority.app_id and baseline.tenant_id=authority.tenant_id
      and baseline.environment=authority.environment and baseline.baseline_id=attempt.baseline_id
      and session.app_id=baseline.app_id and session.tenant_id=baseline.tenant_id
      and session.environment=baseline.environment and session.staging_id=baseline.staging_id
      and session.status='STAGED';
  return app_data_agent.falcon24_e1_activation_attempt_document(attempt);
end
$function$;

create function app_data_agent.activate_falcon24_e1_authority(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; attempt app_data_agent.falcon24_e1_activation_attempts%rowtype;
  baseline app_data_agent.falcon24_authority_baselines%rowtype;
  session app_data_agent.falcon24_e1_staging_sessions%rowtype;
  current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','attempt_id','baseline_id','expected_baseline_hash','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-e1-authority-activate@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'baseline_id') is distinct from true
    or command->>'expected_baseline_hash'!~'^sha256:[0-9a-f]{64}$'
  then raise exception using errcode='22023',message='FALCON24_E1_ACTIVATION_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-e1-activation:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  if exists(select 1 from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment)
  then raise exception using errcode='55000',message='FALCON24_E1_ALREADY_ACTIVE'; end if;
  select * into attempt from app_data_agent.falcon24_e1_activation_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.attempt_id=(command->>'attempt_id')::uuid
    for update;
  if not found then raise exception using errcode='02000',message='FALCON24_E1_ACTIVATION_ATTEMPT_NOT_FOUND'; end if;
  if attempt.status<>'OPEN' or attempt.baseline_id is distinct from (command->>'baseline_id')::uuid
    or attempt.expected_baseline_hash is distinct from command->>'expected_baseline_hash'
  then raise exception using errcode='55000',message='FALCON24_E1_ACTIVATION_ATTEMPT_TERMINAL'; end if;
  select * into strict baseline from app_data_agent.falcon24_authority_baselines row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.baseline_id=attempt.baseline_id
    for update;
  select * into strict session from app_data_agent.falcon24_e1_staging_sessions row
    where row.app_id=baseline.app_id and row.tenant_id=baseline.tenant_id
      and row.environment=baseline.environment and row.staging_id=baseline.staging_id for update;
  perform 1 from app_data_agent.falcon24_e1_staging_receipts receipt
    where receipt.app_id=baseline.app_id and receipt.tenant_id=baseline.tenant_id
      and receipt.environment=baseline.environment and receipt.staging_id=baseline.staging_id
    order by receipt.component for share;
  if baseline.status<>'STAGED' or session.status<>'STAGED'
    or baseline.baseline_hash is distinct from attempt.expected_baseline_hash
    or (select pg_catalog.count(*) from app_data_agent.falcon24_e1_staging_receipts receipt
      where receipt.app_id=baseline.app_id and receipt.tenant_id=baseline.tenant_id
        and receipt.environment=baseline.environment and receipt.staging_id=baseline.staging_id)<>6
    or exists(select 1 from (values
        ('DATASET','dataset'),('SEMANTIC_RELEASE','semantic_release'),
        ('LLM_CONFIGURATION','llm_configuration'),('AGENT_PROFILES','agent_profiles'),
        ('OPERATOR_REGISTRY','operator_registry'),('SANDBOX_RUNTIME','sandbox_runtime'))
      expected(component,baseline_key)
      left join app_data_agent.falcon24_e1_staging_receipts receipt
        on receipt.app_id=baseline.app_id and receipt.tenant_id=baseline.tenant_id
        and receipt.environment=baseline.environment and receipt.staging_id=baseline.staging_id
        and receipt.component=expected.component
      where receipt.receipt_hash is distinct from
        baseline.baseline_document#>>array['staging_receipts',expected.baseline_key])
    or not exists(select 1 from app_data_agent.falcon24_e1_staging_receipts receipt
      where receipt.app_id=baseline.app_id and receipt.tenant_id=baseline.tenant_id
        and receipt.environment=baseline.environment and receipt.staging_id=baseline.staging_id
        and receipt.component='SANDBOX_RUNTIME'
        and receipt.production_isolation_proven=baseline.production_isolation_proven)
    or authority.environment='prod'
      and (baseline.production_gate<>'GO' or not baseline.production_isolation_proven)
    or app_data_agent.falcon24_e1_runtime_surface_is_empty() is distinct from true
  then raise exception using errcode='55000',message='FALCON24_E1_ACTIVATION_PREFLIGHT_FAILED'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_e1_activation_attempts set
    status='ACTIVATED',decided_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and attempt_id=attempt.attempt_id and status='OPEN'
    returning * into strict attempt;
  update app_data_agent.falcon24_authority_baselines set
    status='ACTIVE',activation_attempt_id=attempt.attempt_id,activated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and baseline_id=baseline.baseline_id and status='STAGED'
    returning * into strict baseline;
  update app_data_agent.falcon24_e1_staging_sessions set status='CONSUMED',updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and staging_id=session.staging_id and status='STAGED';
  insert into app_data_agent.falcon24_current_authority_epoch(
    app_id,tenant_id,environment,authority_epoch,baseline_id,baseline_hash,
    activation_attempt_id,activated_at)
  values(authority.app_id,authority.tenant_id,authority.environment,'E1',baseline.baseline_id,
    baseline.baseline_hash,attempt.attempt_id,now_at) returning * into strict current_epoch;
  return app_data_agent.falcon24_e1_binding_document(current_epoch);
end
$function$;

create function app_data_agent.load_falcon24_current_authority_epoch()
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
begin
  select * into strict authority from platform.current_backend_authority(false);
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment;
  if not found then return null; end if;
  return app_data_agent.falcon24_e1_binding_document(current_epoch);
end
$function$;
