-- falcon24_e1_authority_migration_checksum: sha256:4f491c61860f41715c8225e0316deb3cd758ba50a0f91b8ee7538c9d26d1d9f1
begin;

do $bootstrap$
declare relation_name text; relation_id regclass; has_rows boolean;
  runtime_relations constant text[]:=array[
    'app_data_agent.runs','app_data_agent.commands','app_data_agent.idempotency_records',
    'app_data_agent.run_events','app_data_agent.run_attempts','app_data_agent.run_projections',
    'app_data_agent.run_checkpoints','app_data_agent.run_effect_receipts',
    'app_data_agent.run_interruptions','app_data_agent.run_interruption_replies',
    'app_data_agent.outbox','app_data_agent.artifacts','app_data_agent.artifact_export_receipts',
    'app_data_agent.qa_conversations','app_data_agent.qa_messages',
    'app_data_agent.qa_resource_switch_operations','app_data_agent.qa_directory_operation_receipts',
    'app_data_agent.qa_admin_conversation_audit_receipts',
    'app_data_agent.qa_conversation_retention_claims','app_data_agent.workspace_run_bindings',
    'app_data_agent.effective_run_config_receipts',
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
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='FALCON24_E1_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='FALCON24_E1_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010774_app_data_agent_falcon24_qualification_authority')
  then raise exception using errcode='P0001',message='FALCON24_E1_BASELINE_10774_MISSING'; end if;
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
    if relation_id is null then
      raise exception using errcode='P0001',message='FALCON24_E1_RUNTIME_RELATION_MISSING',
        detail=relation_name;
    end if;
    execute pg_catalog.format('select exists(select 1 from %s limit 1)',relation_id)
      into strict has_rows;
    if has_rows then
      raise exception using errcode='55000',message='FALCON24_E1_LEGACY_RUNTIME_STATE_PRESENT',
        detail=relation_name;
    end if;
  end loop;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create table app_data_agent.falcon24_e1_staging_sessions(
  app_id uuid not null check(app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,environment text not null,staging_id uuid not null,
  retained_assets_hash text not null check(retained_assets_hash~'^sha256:[0-9a-f]{64}$'),
  status text not null check(status in('STAGED','HOLD','CONSUMED')),
  failure_code text,created_by uuid not null,created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key(app_id,tenant_id,environment,staging_id),
  check((status='HOLD')=(failure_code is not null)
    and (failure_code is null or failure_code~'^[A-Z][A-Z0-9_]{2,127}$'))
);

create table app_data_agent.falcon24_e1_staging_receipts(
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  staging_id uuid not null,component text not null,subject_hash text not null,
  evidence_hash text not null,production_isolation_proven boolean not null,
  receipt_hash text not null,receipt_document jsonb not null,created_at timestamptz not null,
  primary key(app_id,tenant_id,environment,staging_id,component),
  foreign key(app_id,tenant_id,environment,staging_id)
    references app_data_agent.falcon24_e1_staging_sessions(
      app_id,tenant_id,environment,staging_id) on delete restrict,
  check(component in('AGENT_PROFILES','DATASET','LLM_CONFIGURATION','OPERATOR_REGISTRY',
      'SANDBOX_RUNTIME','SEMANTIC_RELEASE')
    and subject_hash~'^sha256:[0-9a-f]{64}$'
    and evidence_hash~'^sha256:[0-9a-f]{64}$'
    and receipt_hash~'^sha256:[0-9a-f]{64}$'
    and (component='SANDBOX_RUNTIME' or not production_isolation_proven)
    and receipt_hash=app_data_agent.u2_canonical_sha256(receipt_document-'receipt_hash'))
);

create table app_data_agent.falcon24_authority_baselines(
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  baseline_id uuid not null,authority_epoch text not null check(authority_epoch='E1'),
  staging_id uuid not null,baseline_hash text not null,baseline_document jsonb not null,
  source_commit text not null,retained_assets_hash text not null,web_build_hash text not null,
  production_isolation_proven boolean not null,production_gate text not null,
  status text not null check(status in('STAGED','ACTIVE','HOLD')),
  created_by uuid not null,activation_attempt_id uuid,created_at timestamptz not null,
  activated_at timestamptz,
  primary key(app_id,tenant_id,environment,baseline_id),
  unique(app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch),
  foreign key(app_id,tenant_id,environment,staging_id)
    references app_data_agent.falcon24_e1_staging_sessions(
      app_id,tenant_id,environment,staging_id) on delete restrict,
  check(baseline_hash~'^sha256:[0-9a-f]{64}$'
    and retained_assets_hash~'^sha256:[0-9a-f]{64}$'
    and web_build_hash~'^sha256:[0-9a-f]{64}$' and source_commit~'^[0-9a-f]{40}$'
    and production_gate in('GO','HOLD')
    and production_isolation_proven=(production_gate='GO')
    and baseline_hash=app_data_agent.u2_canonical_sha256(baseline_document-'baseline_hash')
    and ((status='ACTIVE')=(activation_attempt_id is not null and activated_at is not null)))
);

create unique index falcon24_authority_one_active_baseline
on app_data_agent.falcon24_authority_baselines(app_id,tenant_id,environment)
where status='ACTIVE';

create table app_data_agent.falcon24_e1_activation_attempts(
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  attempt_id uuid not null,baseline_id uuid not null,expected_baseline_hash text not null,
  status text not null check(status in('OPEN','HOLD','ACTIVATED')),failure_code text,
  created_by uuid not null,created_at timestamptz not null,decided_at timestamptz,
  primary key(app_id,tenant_id,environment,attempt_id),
  unique(app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash),
  foreign key(app_id,tenant_id,environment,baseline_id)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id) on delete restrict,
  check(expected_baseline_hash~'^sha256:[0-9a-f]{64}$'
    and ((status='OPEN')=(decided_at is null))
    and ((status='HOLD')=(failure_code is not null))
    and (status='OPEN' or decided_at is not null)
    and (failure_code is null or failure_code~'^[A-Z][A-Z0-9_]{2,127}$'))
);

create unique index falcon24_e1_one_open_activation_attempt
on app_data_agent.falcon24_e1_activation_attempts(app_id,tenant_id,environment,baseline_id)
where status='OPEN';

alter table app_data_agent.falcon24_authority_baselines
  add constraint falcon24_authority_baseline_activation_attempt_fk foreign key(
    app_id,tenant_id,environment,activation_attempt_id,baseline_id,baseline_hash)
  references app_data_agent.falcon24_e1_activation_attempts(
    app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash)
  on delete restrict;

create table app_data_agent.falcon24_current_authority_epoch(
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  authority_epoch text not null check(authority_epoch='E1'),baseline_id uuid not null,
  baseline_hash text not null,activation_attempt_id uuid not null,activated_at timestamptz not null,
  primary key(app_id,tenant_id,environment),
  foreign key(app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch) on delete restrict,
  foreign key(app_id,tenant_id,environment,activation_attempt_id,baseline_id,baseline_hash)
    references app_data_agent.falcon24_e1_activation_attempts(
      app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash)
    on delete restrict,
  check(baseline_hash~'^sha256:[0-9a-f]{64}$')
);

alter table app_data_agent.falcon24_e1_staging_sessions enable row level security;
alter table app_data_agent.falcon24_e1_staging_sessions force row level security;
alter table app_data_agent.falcon24_e1_staging_receipts enable row level security;
alter table app_data_agent.falcon24_e1_staging_receipts force row level security;
alter table app_data_agent.falcon24_authority_baselines enable row level security;
alter table app_data_agent.falcon24_authority_baselines force row level security;
alter table app_data_agent.falcon24_e1_activation_attempts enable row level security;
alter table app_data_agent.falcon24_e1_activation_attempts force row level security;
alter table app_data_agent.falcon24_current_authority_epoch enable row level security;
alter table app_data_agent.falcon24_current_authority_epoch force row level security;

create policy falcon24_e1_staging_session_authority
on app_data_agent.falcon24_e1_staging_sessions for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy falcon24_e1_staging_receipt_authority
on app_data_agent.falcon24_e1_staging_receipts for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy falcon24_e1_baseline_authority
on app_data_agent.falcon24_authority_baselines for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy falcon24_e1_activation_attempt_authority
on app_data_agent.falcon24_e1_activation_attempts for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy falcon24_e1_current_authority
on app_data_agent.falcon24_current_authority_epoch for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create function app_data_agent.begin_falcon24_e1_staging_session(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; existing app_data_agent.falcon24_e1_staging_sessions%rowtype;
  requested_staging_id uuid; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','staging_id','retained_assets_hash','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-e1-staging-session-begin@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'staging_id') is distinct from true
    or pg_catalog.jsonb_typeof(command->'retained_assets_hash') is distinct from 'string'
    or command->>'retained_assets_hash'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.contains_potential_plaintext_secret(command)
  then raise exception using errcode='22023',message='FALCON24_E1_STAGING_SESSION_INVALID'; end if;
  requested_staging_id:=(command->>'staging_id')::uuid;
  select * into strict authority from platform.current_backend_authority(true);
  if exists(select 1 from app_data_agent.falcon24_current_authority_epoch current_epoch
    where current_epoch.app_id=authority.app_id and current_epoch.tenant_id=authority.tenant_id
      and current_epoch.environment=authority.environment)
  then raise exception using errcode='55000',message='FALCON24_E1_ALREADY_ACTIVE'; end if;
  select * into existing from app_data_agent.falcon24_e1_staging_sessions session
    where session.app_id=authority.app_id and session.tenant_id=authority.tenant_id
      and session.environment=authority.environment and session.staging_id=requested_staging_id
    for update;
  if found then
    if existing.retained_assets_hash is distinct from command->>'retained_assets_hash'
    then raise exception using errcode='23505',message='FALCON24_E1_STAGING_IDENTITY_CONFLICT'; end if;
  else
    now_at:=pg_catalog.clock_timestamp();
    insert into app_data_agent.falcon24_e1_staging_sessions(
      app_id,tenant_id,environment,staging_id,retained_assets_hash,status,created_by,
      created_at,updated_at)
    values(authority.app_id,authority.tenant_id,authority.environment,requested_staging_id,
      command->>'retained_assets_hash','STAGED',authority.principal_id,now_at,now_at)
    returning * into strict existing;
  end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-staging-session@1.0.0',
    'staging_id',existing.staging_id,'retained_assets_hash',existing.retained_assets_hash,
    'status',existing.status);
end
$function$;

create function app_data_agent.record_falcon24_e1_staging_receipt(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; session app_data_agent.falcon24_e1_staging_sessions%rowtype;
  existing app_data_agent.falcon24_e1_staging_receipts%rowtype; receipt jsonb;
  requested_staging_id uuid;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','receipt','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-e1-staging-receipt-record@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'receipt') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_E1_STAGING_RECEIPT_INVALID'; end if;
  receipt:=command->'receipt';
  if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','staging_id','component','subject_hash','evidence_hash',
      'production_isolation_proven','receipt_hash']::text[]) is distinct from true
    or receipt->>'schema_version' is distinct from 'falcon24-e1-staging-receipt@1.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(receipt->'staging_id') is distinct from true
    or pg_catalog.jsonb_typeof(receipt->'component') is distinct from 'string'
    or receipt->>'component' not in('AGENT_PROFILES','DATASET','LLM_CONFIGURATION',
      'OPERATOR_REGISTRY','SANDBOX_RUNTIME','SEMANTIC_RELEASE')
    or pg_catalog.jsonb_typeof(receipt->'subject_hash') is distinct from 'string'
    or receipt->>'subject_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(receipt->'evidence_hash') is distinct from 'string'
    or receipt->>'evidence_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(receipt->'production_isolation_proven') is distinct from 'boolean'
    or (receipt->>'production_isolation_proven')::boolean
      and receipt->>'component'<>'SANDBOX_RUNTIME'
    or pg_catalog.jsonb_typeof(receipt->'receipt_hash') is distinct from 'string'
    or receipt->>'receipt_hash' is distinct from
      app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
    or app_data_agent.contains_potential_plaintext_secret(receipt)
  then raise exception using errcode='22023',message='FALCON24_E1_STAGING_RECEIPT_INVALID'; end if;
  requested_staging_id:=(receipt->>'staging_id')::uuid;
  select * into strict authority from platform.current_backend_authority(true);
  select * into session from app_data_agent.falcon24_e1_staging_sessions row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.staging_id=requested_staging_id
    for update;
  if not found then raise exception using errcode='02000',message='FALCON24_E1_STAGING_SESSION_NOT_FOUND'; end if;
  if session.status<>'STAGED' then
    raise exception using errcode='55000',message='FALCON24_E1_STAGING_SESSION_TERMINAL'; end if;
  select * into existing from app_data_agent.falcon24_e1_staging_receipts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.staging_id=requested_staging_id
      and row.component=receipt->>'component' for update;
  if found then
    if existing.receipt_hash is distinct from receipt->>'receipt_hash'
      or existing.receipt_document is distinct from receipt
    then raise exception using errcode='23505',message='FALCON24_E1_STAGING_RECEIPT_CONFLICT'; end if;
  else
    insert into app_data_agent.falcon24_e1_staging_receipts(
      app_id,tenant_id,environment,staging_id,component,subject_hash,evidence_hash,
      production_isolation_proven,receipt_hash,receipt_document,created_at)
    values(authority.app_id,authority.tenant_id,authority.environment,requested_staging_id,
      receipt->>'component',receipt->>'subject_hash',receipt->>'evidence_hash',
      (receipt->>'production_isolation_proven')::boolean,receipt->>'receipt_hash',receipt,
      pg_catalog.clock_timestamp()) returning * into strict existing;
  end if;
  return existing.receipt_document;
end
$function$;

create function app_data_agent.stage_falcon24_e1_authority_baseline(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; session app_data_agent.falcon24_e1_staging_sessions%rowtype;
  existing app_data_agent.falcon24_authority_baselines%rowtype; baseline jsonb;
  requested_staging_id uuid; requested_baseline_id uuid;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','staging_id','baseline','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-e1-baseline-stage@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'staging_id') is distinct from true
    or pg_catalog.jsonb_typeof(command->'baseline') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_E1_BASELINE_INVALID'; end if;
  requested_staging_id:=(command->>'staging_id')::uuid;
  baseline:=command->'baseline';
  if app_data_agent.provider_json_object_has_exact_keys(baseline,array[
      'schema_version','baseline_id','authority_epoch','source_commit','retained_assets_hash',
      'web_build_hash','staging_receipts','acceptance_contracts','production_isolation_proven',
      'production_gate','baseline_hash']::text[]) is distinct from true
    or baseline->>'schema_version' is distinct from 'falcon24-authority-baseline@1.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(baseline->'baseline_id') is distinct from true
    or baseline->>'authority_epoch' is distinct from 'E1'
    or pg_catalog.jsonb_typeof(baseline->'source_commit') is distinct from 'string'
    or baseline->>'source_commit'!~'^[0-9a-f]{40}$'
    or pg_catalog.jsonb_typeof(baseline->'retained_assets_hash') is distinct from 'string'
    or baseline->>'retained_assets_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(baseline->'web_build_hash') is distinct from 'string'
    or baseline->>'web_build_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(baseline->'staging_receipts') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(baseline->'staging_receipts',array[
      'dataset','semantic_release','llm_configuration','agent_profiles','operator_registry',
      'sandbox_runtime']::text[]) is distinct from true
    or exists(select 1 from pg_catalog.jsonb_each(baseline->'staging_receipts') entry
      where pg_catalog.jsonb_typeof(entry.value) is distinct from 'string'
        or entry.value#>>'{}'!~'^sha256:[0-9a-f]{64}$')
    or pg_catalog.jsonb_typeof(baseline->'acceptance_contracts') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(baseline->'acceptance_contracts',array[
      'oracle','qualification','campaign','qa_e2e','trace_ui','reclamation']::text[])
      is distinct from true
    or exists(select 1 from pg_catalog.jsonb_each(baseline->'acceptance_contracts') entry
      where pg_catalog.jsonb_typeof(entry.value) is distinct from 'string'
        or entry.value#>>'{}'!~'^sha256:[0-9a-f]{64}$')
    or pg_catalog.jsonb_typeof(baseline->'production_isolation_proven') is distinct from 'boolean'
    or baseline->>'production_gate' not in('GO','HOLD')
    or ((baseline->>'production_isolation_proven')::boolean
      is distinct from (baseline->>'production_gate'='GO'))
    or baseline->>'baseline_hash' is distinct from
      app_data_agent.u2_canonical_sha256(baseline-'baseline_hash')
    or app_data_agent.contains_potential_plaintext_secret(baseline)
  then raise exception using errcode='22023',message='FALCON24_E1_BASELINE_INVALID'; end if;
  requested_baseline_id:=(baseline->>'baseline_id')::uuid;
  select * into strict authority from platform.current_backend_authority(true);
  select * into session from app_data_agent.falcon24_e1_staging_sessions row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.staging_id=requested_staging_id
    for update;
  if not found then raise exception using errcode='02000',message='FALCON24_E1_STAGING_SESSION_NOT_FOUND'; end if;
  if session.status<>'STAGED'
    or session.retained_assets_hash is distinct from baseline->>'retained_assets_hash'
    or (select pg_catalog.count(*) from app_data_agent.falcon24_e1_staging_receipts receipt
      where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
        and receipt.environment=authority.environment and receipt.staging_id=requested_staging_id)<>6
    or exists(select 1 from (values
        ('DATASET','dataset'),('SEMANTIC_RELEASE','semantic_release'),
        ('LLM_CONFIGURATION','llm_configuration'),('AGENT_PROFILES','agent_profiles'),
        ('OPERATOR_REGISTRY','operator_registry'),('SANDBOX_RUNTIME','sandbox_runtime'))
      expected(component,baseline_key)
      left join app_data_agent.falcon24_e1_staging_receipts receipt
        on receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
        and receipt.environment=authority.environment and receipt.staging_id=requested_staging_id
        and receipt.component=expected.component
      where receipt.receipt_hash is distinct from
        baseline#>>array['staging_receipts',expected.baseline_key])
    or not exists(select 1 from app_data_agent.falcon24_e1_staging_receipts receipt
      where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
        and receipt.environment=authority.environment and receipt.staging_id=requested_staging_id
        and receipt.component='SANDBOX_RUNTIME'
        and receipt.production_isolation_proven=
          (baseline->>'production_isolation_proven')::boolean)
  then raise exception using errcode='55000',message='FALCON24_E1_STAGING_INCOMPLETE'; end if;
  select * into existing from app_data_agent.falcon24_authority_baselines row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.baseline_id=requested_baseline_id
    for update;
  if found then
    if existing.staging_id is distinct from requested_staging_id
      or existing.baseline_hash is distinct from baseline->>'baseline_hash'
      or existing.baseline_document is distinct from baseline
    then raise exception using errcode='23505',message='FALCON24_E1_BASELINE_IDENTITY_CONFLICT'; end if;
  else
    insert into app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,authority_epoch,staging_id,baseline_hash,
      baseline_document,source_commit,retained_assets_hash,web_build_hash,
      production_isolation_proven,production_gate,status,created_by,created_at)
    values(authority.app_id,authority.tenant_id,authority.environment,requested_baseline_id,'E1',
      requested_staging_id,baseline->>'baseline_hash',baseline,baseline->>'source_commit',
      baseline->>'retained_assets_hash',baseline->>'web_build_hash',
      (baseline->>'production_isolation_proven')::boolean,baseline->>'production_gate','STAGED',
      authority.principal_id,pg_catalog.clock_timestamp()) returning * into strict existing;
  end if;
  return existing.baseline_document;
end
$function$;
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
alter table app_data_agent.runs
  add column authority_epoch text not null,
  add column authority_baseline_id uuid not null,
  add column authority_baseline_hash text not null,
  add column authority_activation_attempt_id uuid not null,
  add constraint runs_falcon24_e1_epoch_check check(authority_epoch='E1'),
  add constraint runs_falcon24_e1_hash_check
    check(authority_baseline_hash~'^sha256:[0-9a-f]{64}$'),
  add constraint runs_falcon24_e1_baseline_fk foreign key(
    app_id,tenant_id,environment,authority_baseline_id,authority_baseline_hash,authority_epoch)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch) on delete restrict,
  add constraint runs_falcon24_e1_attempt_fk foreign key(
    app_id,tenant_id,environment,authority_activation_attempt_id,
    authority_baseline_id,authority_baseline_hash)
    references app_data_agent.falcon24_e1_activation_attempts(
      app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash)
    on delete restrict;

alter table app_data_agent.effective_run_config_receipts
  add column authority_epoch text not null,
  add column authority_baseline_id uuid not null,
  add column authority_baseline_hash text not null,
  add column authority_activation_attempt_id uuid not null,
  add constraint effective_config_falcon24_e1_epoch_check check(authority_epoch='E1'),
  add constraint effective_config_falcon24_e1_hash_check
    check(authority_baseline_hash~'^sha256:[0-9a-f]{64}$'),
  add constraint effective_config_falcon24_e1_baseline_fk foreign key(
    app_id,tenant_id,environment,authority_baseline_id,authority_baseline_hash,authority_epoch)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch) on delete restrict,
  add constraint effective_config_falcon24_e1_attempt_fk foreign key(
    app_id,tenant_id,environment,authority_activation_attempt_id,
    authority_baseline_id,authority_baseline_hash)
    references app_data_agent.falcon24_e1_activation_attempts(
      app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash)
    on delete restrict;

alter table app_data_agent.artifacts
  add column authority_epoch text not null,
  add column authority_baseline_id uuid not null,
  add column authority_baseline_hash text not null,
  add column authority_activation_attempt_id uuid not null,
  add constraint artifacts_falcon24_e1_epoch_check check(authority_epoch='E1'),
  add constraint artifacts_falcon24_e1_hash_check
    check(authority_baseline_hash~'^sha256:[0-9a-f]{64}$'),
  add constraint artifacts_falcon24_e1_baseline_fk foreign key(
    app_id,tenant_id,environment,authority_baseline_id,authority_baseline_hash,authority_epoch)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch) on delete restrict,
  add constraint artifacts_falcon24_e1_attempt_fk foreign key(
    app_id,tenant_id,environment,authority_activation_attempt_id,
    authority_baseline_id,authority_baseline_hash)
    references app_data_agent.falcon24_e1_activation_attempts(
      app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash)
    on delete restrict;

alter table app_data_agent.falcon24_acceptance_campaigns
  add column authority_epoch text not null,
  add column authority_baseline_id uuid not null,
  add column authority_baseline_hash text not null,
  add column authority_activation_attempt_id uuid not null,
  add constraint falcon24_campaign_e1_epoch_check check(authority_epoch='E1'),
  add constraint falcon24_campaign_e1_hash_check
    check(authority_baseline_hash~'^sha256:[0-9a-f]{64}$'),
  add constraint falcon24_campaign_e1_baseline_fk foreign key(
    app_id,tenant_id,environment,authority_baseline_id,authority_baseline_hash,authority_epoch)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch) on delete restrict,
  add constraint falcon24_campaign_e1_attempt_fk foreign key(
    app_id,tenant_id,environment,authority_activation_attempt_id,
    authority_baseline_id,authority_baseline_hash)
    references app_data_agent.falcon24_e1_activation_attempts(
      app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash)
    on delete restrict;

alter table app_data_agent.falcon24_qualifications
  add column authority_epoch text not null,
  add column authority_baseline_id uuid not null,
  add column authority_baseline_hash text not null,
  add column authority_activation_attempt_id uuid not null,
  add constraint falcon24_qualification_e1_epoch_check check(authority_epoch='E1'),
  add constraint falcon24_qualification_e1_hash_check
    check(authority_baseline_hash~'^sha256:[0-9a-f]{64}$'),
  add constraint falcon24_qualification_e1_baseline_fk foreign key(
    app_id,tenant_id,environment,authority_baseline_id,authority_baseline_hash,authority_epoch)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch) on delete restrict,
  add constraint falcon24_qualification_e1_attempt_fk foreign key(
    app_id,tenant_id,environment,authority_activation_attempt_id,
    authority_baseline_id,authority_baseline_hash)
    references app_data_agent.falcon24_e1_activation_attempts(
      app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash)
    on delete restrict;

create function app_data_agent.falcon24_e1_bind_current_authority()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
begin
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=new.app_id and row.tenant_id=new.tenant_id
      and row.environment=new.environment for share;
  if not found then raise exception using errcode='55000',message='FALCON24_E1_NOT_ACTIVE'; end if;
  if (new.authority_epoch is not null and new.authority_epoch is distinct from 'E1')
    or (new.authority_baseline_id is not null
      and new.authority_baseline_id is distinct from current_epoch.baseline_id)
    or (new.authority_baseline_hash is not null
      and new.authority_baseline_hash is distinct from current_epoch.baseline_hash)
    or (new.authority_activation_attempt_id is not null
      and new.authority_activation_attempt_id is distinct from current_epoch.activation_attempt_id)
  then raise exception using errcode='55000',message='FALCON24_E1_AUTHORITY_BINDING_MISMATCH'; end if;
  new.authority_epoch:=current_epoch.authority_epoch;
  new.authority_baseline_id:=current_epoch.baseline_id;
  new.authority_baseline_hash:=current_epoch.baseline_hash;
  new.authority_activation_attempt_id:=current_epoch.activation_attempt_id;
  return new;
end
$function$;

create function app_data_agent.falcon24_e1_bind_artifact_to_run()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare authority_run app_data_agent.runs%rowtype;
begin
  select * into authority_run from app_data_agent.runs row
    where row.app_id=new.app_id and row.tenant_id=new.tenant_id
      and row.environment=new.environment and row.run_id=new.run_id for share;
  if not found then raise exception using errcode='55000',message='FALCON24_E1_ARTIFACT_RUN_NOT_FOUND'; end if;
  if (new.authority_epoch is not null
      and new.authority_epoch is distinct from authority_run.authority_epoch)
    or (new.authority_baseline_id is not null
      and new.authority_baseline_id is distinct from authority_run.authority_baseline_id)
    or (new.authority_baseline_hash is not null
      and new.authority_baseline_hash is distinct from authority_run.authority_baseline_hash)
    or (new.authority_activation_attempt_id is not null
      and new.authority_activation_attempt_id is distinct from
        authority_run.authority_activation_attempt_id)
  then raise exception using errcode='55000',message='FALCON24_E1_ARTIFACT_AUTHORITY_MISMATCH'; end if;
  new.authority_epoch:=authority_run.authority_epoch;
  new.authority_baseline_id:=authority_run.authority_baseline_id;
  new.authority_baseline_hash:=authority_run.authority_baseline_hash;
  new.authority_activation_attempt_id:=authority_run.authority_activation_attempt_id;
  return new;
end
$function$;

create function app_data_agent.falcon24_e1_binding_immutable()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if new.authority_epoch is distinct from old.authority_epoch
    or new.authority_baseline_id is distinct from old.authority_baseline_id
    or new.authority_baseline_hash is distinct from old.authority_baseline_hash
    or new.authority_activation_attempt_id is distinct from old.authority_activation_attempt_id
  then raise exception using errcode='55000',message='FALCON24_E1_AUTHORITY_BINDING_IMMUTABLE'; end if;
  return new;
end
$function$;

create trigger runs_falcon24_e1_bind before insert on app_data_agent.runs
for each row execute function app_data_agent.falcon24_e1_bind_current_authority();
create trigger effective_config_falcon24_e1_bind before insert
on app_data_agent.effective_run_config_receipts
for each row execute function app_data_agent.falcon24_e1_bind_current_authority();
create trigger artifacts_falcon24_e1_bind before insert on app_data_agent.artifacts
for each row execute function app_data_agent.falcon24_e1_bind_artifact_to_run();
create trigger falcon24_campaign_e1_bind before insert
on app_data_agent.falcon24_acceptance_campaigns
for each row execute function app_data_agent.falcon24_e1_bind_current_authority();
create trigger falcon24_qualification_e1_bind before insert
on app_data_agent.falcon24_qualifications
for each row execute function app_data_agent.falcon24_e1_bind_current_authority();

create trigger runs_falcon24_e1_immutable before update on app_data_agent.runs
for each row execute function app_data_agent.falcon24_e1_binding_immutable();
create trigger effective_config_falcon24_e1_immutable before update
on app_data_agent.effective_run_config_receipts
for each row execute function app_data_agent.falcon24_e1_binding_immutable();
create trigger artifacts_falcon24_e1_immutable before update on app_data_agent.artifacts
for each row execute function app_data_agent.falcon24_e1_binding_immutable();
create trigger falcon24_campaign_e1_immutable before update
on app_data_agent.falcon24_acceptance_campaigns
for each row execute function app_data_agent.falcon24_e1_binding_immutable();
create trigger falcon24_qualification_e1_immutable before update
on app_data_agent.falcon24_qualifications
for each row execute function app_data_agent.falcon24_e1_binding_immutable();

create function app_data_agent.load_falcon24_run_authority_binding(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; authority_run app_data_agent.runs%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','run_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-run-authority-load@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'run_id') is distinct from true
  then raise exception using errcode='22023',message='FALCON24_E1_RUN_AUTHORITY_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into authority_run from app_data_agent.runs row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.run_id=(command->>'run_id')::uuid
      and row.principal_id=authority.principal_id;
  if not found then raise exception using errcode='02000',message='FALCON24_E1_RUN_NOT_FOUND'; end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-authority-binding@1.0.0',
    'authority_epoch',authority_run.authority_epoch,
    'baseline_id',authority_run.authority_baseline_id,
    'baseline_hash',authority_run.authority_baseline_hash,
    'activation_attempt_id',authority_run.authority_activation_attempt_id);
end
$function$;
create function app_data_agent.falcon24_e1_staging_session_state_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if new.app_id is distinct from old.app_id or new.tenant_id is distinct from old.tenant_id
    or new.environment is distinct from old.environment or new.staging_id is distinct from old.staging_id
    or new.retained_assets_hash is distinct from old.retained_assets_hash
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
    or old.status in('HOLD','CONSUMED') and new is distinct from old
    or old.status='STAGED' and new.status not in('STAGED','HOLD','CONSUMED')
  then raise exception using errcode='55000',message='FALCON24_E1_STAGING_SESSION_IMMUTABLE'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_e1_baseline_state_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if new.app_id is distinct from old.app_id or new.tenant_id is distinct from old.tenant_id
    or new.environment is distinct from old.environment or new.baseline_id is distinct from old.baseline_id
    or new.authority_epoch is distinct from old.authority_epoch
    or new.staging_id is distinct from old.staging_id or new.baseline_hash is distinct from old.baseline_hash
    or new.baseline_document is distinct from old.baseline_document
    or new.source_commit is distinct from old.source_commit
    or new.retained_assets_hash is distinct from old.retained_assets_hash
    or new.web_build_hash is distinct from old.web_build_hash
    or new.production_isolation_proven is distinct from old.production_isolation_proven
    or new.production_gate is distinct from old.production_gate
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
    or old.status in('ACTIVE','HOLD') and new is distinct from old
    or old.status='STAGED' and new.status not in('STAGED','ACTIVE','HOLD')
  then raise exception using errcode='55000',message='FALCON24_E1_BASELINE_IMMUTABLE'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_e1_activation_attempt_state_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if new.app_id is distinct from old.app_id or new.tenant_id is distinct from old.tenant_id
    or new.environment is distinct from old.environment or new.attempt_id is distinct from old.attempt_id
    or new.baseline_id is distinct from old.baseline_id
    or new.expected_baseline_hash is distinct from old.expected_baseline_hash
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
    or old.status in('HOLD','ACTIVATED') and new is distinct from old
    or old.status='OPEN' and new.status not in('OPEN','HOLD','ACTIVATED')
  then raise exception using errcode='55000',message='FALCON24_E1_ACTIVATION_ATTEMPT_IMMUTABLE'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_e1_immutable_row_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  raise exception using errcode='55000',message='FALCON24_E1_IMMUTABLE_ROW';
end
$function$;

create trigger falcon24_e1_staging_session_state_fence before update
on app_data_agent.falcon24_e1_staging_sessions
for each row execute function app_data_agent.falcon24_e1_staging_session_state_fence();
create trigger falcon24_e1_baseline_state_fence before update
on app_data_agent.falcon24_authority_baselines
for each row execute function app_data_agent.falcon24_e1_baseline_state_fence();
create trigger falcon24_e1_activation_attempt_state_fence before update
on app_data_agent.falcon24_e1_activation_attempts
for each row execute function app_data_agent.falcon24_e1_activation_attempt_state_fence();
create trigger falcon24_e1_staging_receipt_immutable before update or delete
on app_data_agent.falcon24_e1_staging_receipts
for each row execute function app_data_agent.falcon24_e1_immutable_row_fence();
create trigger falcon24_e1_current_authority_immutable before update or delete
on app_data_agent.falcon24_current_authority_epoch
for each row execute function app_data_agent.falcon24_e1_immutable_row_fence();
alter table app_data_agent.falcon24_e1_staging_sessions owner to data_agent_u6_rpc_owner;
alter table app_data_agent.falcon24_e1_staging_receipts owner to data_agent_u6_rpc_owner;
alter table app_data_agent.falcon24_authority_baselines owner to data_agent_u6_rpc_owner;
alter table app_data_agent.falcon24_e1_activation_attempts owner to data_agent_u6_rpc_owner;
alter table app_data_agent.falcon24_current_authority_epoch owner to data_agent_u6_rpc_owner;

alter function app_data_agent.begin_falcon24_e1_staging_session(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_falcon24_e1_staging_receipt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.stage_falcon24_e1_authority_baseline(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_activation_attempt_document(
  app_data_agent.falcon24_e1_activation_attempts) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_binding_document(
  app_data_agent.falcon24_current_authority_epoch) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_e1_activation_attempt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.hold_falcon24_e1_activation_attempt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_e1_authority(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_current_authority_epoch()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_bind_current_authority()
  owner to postgres;
alter function app_data_agent.falcon24_e1_bind_artifact_to_run()
  owner to postgres;
alter function app_data_agent.falcon24_e1_binding_immutable()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_run_authority_binding(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_staging_session_state_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_baseline_state_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_activation_attempt_state_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_immutable_row_fence()
  owner to data_agent_u6_rpc_owner;

revoke all on table app_data_agent.falcon24_e1_staging_sessions,
  app_data_agent.falcon24_e1_staging_receipts,app_data_agent.falcon24_authority_baselines,
  app_data_agent.falcon24_e1_activation_attempts,
  app_data_agent.falcon24_current_authority_epoch
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

revoke all on function app_data_agent.begin_falcon24_e1_staging_session(jsonb),
  app_data_agent.record_falcon24_e1_staging_receipt(jsonb),
  app_data_agent.stage_falcon24_e1_authority_baseline(jsonb),
  app_data_agent.begin_falcon24_e1_activation_attempt(jsonb),
  app_data_agent.hold_falcon24_e1_activation_attempt(jsonb),
  app_data_agent.activate_falcon24_e1_authority(jsonb),
  app_data_agent.load_falcon24_current_authority_epoch(),
  app_data_agent.load_falcon24_run_authority_binding(jsonb)
  from public,anon,authenticated,service_role,data_agent_job_authority;

revoke all on function app_data_agent.falcon24_e1_runtime_surface_is_empty(),
  app_data_agent.falcon24_e1_activation_attempt_document(
    app_data_agent.falcon24_e1_activation_attempts),
  app_data_agent.falcon24_e1_binding_document(
    app_data_agent.falcon24_current_authority_epoch),
  app_data_agent.falcon24_e1_bind_current_authority(),
  app_data_agent.falcon24_e1_bind_artifact_to_run(),
  app_data_agent.falcon24_e1_binding_immutable(),
  app_data_agent.falcon24_e1_staging_session_state_fence(),
  app_data_agent.falcon24_e1_baseline_state_fence(),
  app_data_agent.falcon24_e1_activation_attempt_state_fence(),
  app_data_agent.falcon24_e1_immutable_row_fence()
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

grant execute on function app_data_agent.falcon24_e1_runtime_surface_is_empty()
  to data_agent_u6_rpc_owner;

grant execute on function app_data_agent.begin_falcon24_e1_staging_session(jsonb),
  app_data_agent.record_falcon24_e1_staging_receipt(jsonb),
  app_data_agent.stage_falcon24_e1_authority_baseline(jsonb),
  app_data_agent.begin_falcon24_e1_activation_attempt(jsonb),
  app_data_agent.hold_falcon24_e1_activation_attempt(jsonb),
  app_data_agent.activate_falcon24_e1_authority(jsonb),
  app_data_agent.load_falcon24_current_authority_epoch(),
  app_data_agent.load_falcon24_run_authority_binding(jsonb)
  to data_agent_backend;
do $postconditions$
declare function_name text; definition text;
  public_functions constant text[]:=array[
    'begin_falcon24_e1_staging_session','record_falcon24_e1_staging_receipt',
    'stage_falcon24_e1_authority_baseline','begin_falcon24_e1_activation_attempt',
    'hold_falcon24_e1_activation_attempt','activate_falcon24_e1_authority',
    'load_falcon24_current_authority_epoch','load_falcon24_run_authority_binding']::text[];
begin
  if pg_catalog.to_regclass('app_data_agent.falcon24_e1_staging_sessions') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_e1_staging_receipts') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_authority_baselines') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_e1_activation_attempts') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_current_authority_epoch') is null
    or exists(select 1 from app_data_agent.falcon24_current_authority_epoch)
  then raise exception using errcode='P0001',message='FALCON24_E1_AUTHORITY_SCHEMA_DRIFT'; end if;

  foreach function_name in array public_functions loop
    if (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent' and procedure.proname=function_name)<>1
    then raise exception using errcode='P0001',message='FALCON24_E1_FUNCTION_INVENTORY_DRIFT'; end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='app_data_agent' and procedure.proname=any(public_functions)
      and (pg_catalog.pg_get_userbyid(procedure.proowner)<>'data_agent_u6_rpc_owner'
        or not procedure.prosecdef or not procedure.proconfig@>array['search_path=""']::text[]))
  then raise exception using errcode='P0001',message='FALCON24_E1_FUNCTION_SECURITY_DRIFT'; end if;
  if exists(select 1 from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.falcon24_e1_runtime_surface_is_empty()'::regprocedure
      and (pg_catalog.pg_get_userbyid(procedure.proowner)<>'postgres'
        or not procedure.prosecdef or not procedure.proconfig@>array['search_path=""']::text[]))
    or not pg_catalog.has_function_privilege('data_agent_u6_rpc_owner',
      'app_data_agent.falcon24_e1_runtime_surface_is_empty()','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.falcon24_e1_runtime_surface_is_empty()','EXECUTE')
  then raise exception using errcode='P0001',message='FALCON24_E1_PREFLIGHT_SECURITY_DRIFT'; end if;

  if exists(select 1 from pg_catalog.unnest(array[
      'app_data_agent.falcon24_e1_bind_current_authority()'::regprocedure,
      'app_data_agent.falcon24_e1_bind_artifact_to_run()'::regprocedure])
      function_row(function_oid)
    join pg_catalog.pg_proc procedure on procedure.oid=function_row.function_oid
    where pg_catalog.pg_get_userbyid(procedure.proowner)<>'postgres'
      or not procedure.prosecdef or not procedure.proconfig@>array['search_path=""']::text[])
    or exists(select 1 from pg_catalog.unnest(array[
        'app_data_agent.falcon24_e1_bind_current_authority()'::regprocedure,
        'app_data_agent.falcon24_e1_bind_artifact_to_run()'::regprocedure])
        function_row(function_oid)
      cross join pg_catalog.unnest(array[
        'anon','authenticated','service_role','data_agent_backend',
        'data_agent_job_authority']::text[]) role_name
      where pg_catalog.has_function_privilege(
        role_name,function_row.function_oid,'EXECUTE'))
    or exists(select 1 from pg_catalog.unnest(array[
        'app_data_agent.falcon24_e1_bind_current_authority()'::regprocedure,
        'app_data_agent.falcon24_e1_bind_artifact_to_run()'::regprocedure])
      function_row(function_oid)
      join pg_catalog.pg_proc procedure on procedure.oid=function_row.function_oid
      cross join lateral pg_catalog.aclexplode(coalesce(
        procedure.proacl,pg_catalog.acldefault('f',procedure.proowner))) privilege
      where privilege.grantee=0 and privilege.privilege_type='EXECUTE')
  then raise exception using errcode='P0001',message='FALCON24_E1_BINDING_TRIGGER_SECURITY_DRIFT'; end if;

  if (select pg_catalog.count(*) from information_schema.columns
    where table_schema='app_data_agent'
      and table_name in('runs','effective_run_config_receipts','artifacts',
        'falcon24_acceptance_campaigns','falcon24_qualifications')
      and column_name in('authority_epoch','authority_baseline_id','authority_baseline_hash',
        'authority_activation_attempt_id') and is_nullable='NO')<>20
    or (select pg_catalog.count(*) from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid in('app_data_agent.runs'::regclass,
        'app_data_agent.effective_run_config_receipts'::regclass,
        'app_data_agent.artifacts'::regclass,
        'app_data_agent.falcon24_acceptance_campaigns'::regclass,
        'app_data_agent.falcon24_qualifications'::regclass)
        and trigger_row.tgname in('runs_falcon24_e1_bind','effective_config_falcon24_e1_bind',
          'artifacts_falcon24_e1_bind','falcon24_campaign_e1_bind',
          'falcon24_qualification_e1_bind','runs_falcon24_e1_immutable',
          'effective_config_falcon24_e1_immutable','artifacts_falcon24_e1_immutable',
          'falcon24_campaign_e1_immutable','falcon24_qualification_e1_immutable')
        and not trigger_row.tgisinternal)<>10
  then raise exception using errcode='P0001',message='FALCON24_E1_RUNTIME_BINDING_DRIFT'; end if;

  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.activate_falcon24_e1_authority(jsonb)'::regprocedure;
  if pg_catalog.strpos(definition,'falcon24_e1_runtime_surface_is_empty')=0
    or pg_catalog.strpos(definition,'status=''ACTIVATED''')=0
    or pg_catalog.strpos(definition,'falcon24_current_authority_epoch')=0
    or pg_catalog.strpos(definition,'count(*)')=0
    or pg_catalog.strpos(definition,'production_gate<>''GO''')=0
  then raise exception using errcode='P0001',message='FALCON24_E1_ACTIVATION_CLOSURE_DRIFT'; end if;
  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.falcon24_e1_runtime_surface_is_empty()'::regprocedure;
  if pg_catalog.strpos(definition,'information_schema.columns')=0
    or pg_catalog.strpos(definition,'column_name=''run_id''')=0
    or pg_catalog.strpos(definition,'table_type=''BASE TABLE''')=0
  then raise exception using errcode='P0001',message='FALCON24_E1_RUNTIME_INVENTORY_DRIFT'; end if;

  if exists(select 1 from pg_catalog.unnest(array[
      'falcon24_e1_staging_sessions','falcon24_e1_staging_receipts',
      'falcon24_authority_baselines','falcon24_e1_activation_attempts',
      'falcon24_current_authority_epoch']::text[]) table_name
    cross join pg_catalog.unnest(array['SELECT','INSERT','UPDATE','DELETE']::text[]) privilege_name
    where pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.'||table_name,privilege_name))
    or exists(select 1 from pg_catalog.unnest(public_functions) name
      where not pg_catalog.has_function_privilege('data_agent_backend',
        'app_data_agent.'||name||case when name='load_falcon24_current_authority_epoch'
          then '()' else '(jsonb)' end,'EXECUTE'))
  then raise exception using errcode='P0001',message='FALCON24_E1_AUTHORITY_GRANT_DRIFT'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010775_app_data_agent_falcon24_e1_authority',
  'sha256:4f491c61860f41715c8225e0316deb3cd758ba50a0f91b8ee7538c9d26d1d9f1');
commit;
