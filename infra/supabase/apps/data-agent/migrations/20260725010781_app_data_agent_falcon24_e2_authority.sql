-- falcon24_e2_authority_migration_checksum: sha256:344233d3112d9154a78083b5821f866976e3f6a580f7ebbed35347860c4597b5
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare relation_name text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010780_app_data_agent_falcon24_e1_runtime_profile')
  then raise exception using errcode='P0001',
    message='FALCON24_E2_AUTHORITY_BASELINE_DRIFT'; end if;

  foreach relation_name in array array[
    'falcon24_e1_staging_sessions','falcon24_e1_staging_receipts',
    'falcon24_authority_baselines','falcon24_e1_activation_attempts',
    'falcon24_current_authority_epoch','falcon24_e1_ui_receipts',
    'falcon24_e1_gate_attempt_history','falcon24_qualifications',
    'falcon24_qualification_slots','falcon24_acceptance_campaigns',
    'falcon24_acceptance_campaign_runs','e1_analysis_publications',
    'e1_analysis_publication_artifacts','e1_analysis_publication_current',
    'e1_analysis_publication_outbox','runs','effective_run_config_receipts','artifacts'
  ]::text[] loop
    if pg_catalog.to_regclass('app_data_agent.'||relation_name) is null
    then raise exception using errcode='P0001',
      message='FALCON24_E2_AUTHORITY_INVENTORY_DRIFT'; end if;
  end loop;

  foreach relation_name in array array[
    'falcon24_authority_staging_sessions','falcon24_authority_staging_receipts',
    'falcon24_authority_activation_attempts','falcon24_ui_receipts',
    'falcon24_gate_attempt_history','falcon24_analysis_publications',
    'falcon24_analysis_publication_artifacts','falcon24_analysis_publication_current',
    'falcon24_analysis_publication_outbox'
  ]::text[] loop
    if pg_catalog.to_regclass('app_data_agent.'||relation_name) is not null
    then raise exception using errcode='P0001',
      message='FALCON24_E2_SECOND_AUTHORITY_TRUTH_DETECTED'; end if;
  end loop;

  if exists(select 1 from app_data_agent.falcon24_authority_baselines
      where authority_epoch<>'E1')
    or exists(select 1 from app_data_agent.falcon24_current_authority_epoch
      where authority_epoch<>'E1')
    or exists(select 1 from app_data_agent.runs where authority_epoch<>'E1')
  then raise exception using errcode='P0001',
    message='FALCON24_E2_PREDECESSOR_IDENTITY_DRIFT'; end if;
end
$preflight$;

create temporary table falcon24_e1_relation_snapshot(
  relation_name text primary key,
  relation_oid oid not null,
  excluded_columns text[] not null,
  row_count bigint not null,
  row_digest text not null
) on commit drop;

do $snapshot$
declare item record; observed_count bigint; observed_digest text; relation_id regclass;
begin
  for item in select * from (values
    ('falcon24_e1_staging_sessions',array['authority_epoch']::text[]),
    ('falcon24_e1_staging_receipts',array['authority_epoch']::text[]),
    ('falcon24_authority_baselines',array[]::text[]),
    ('falcon24_e1_activation_attempts',array['authority_epoch']::text[]),
    ('falcon24_current_authority_epoch',array[]::text[]),
    ('falcon24_e1_ui_receipts',array[]::text[]),
    ('falcon24_e1_gate_attempt_history',array[]::text[]),
    ('falcon24_qualifications',array[]::text[]),
    ('falcon24_qualification_slots',array['authority_epoch']::text[]),
    ('falcon24_acceptance_campaigns',array[]::text[]),
    ('falcon24_acceptance_campaign_runs',array['authority_epoch']::text[]),
    ('e1_analysis_publications',array[]::text[]),
    ('e1_analysis_publication_artifacts',array[]::text[]),
    ('e1_analysis_publication_current',array[]::text[]),
    ('e1_analysis_publication_outbox',array[]::text[]),
    ('runs',array[]::text[]),
    ('effective_run_config_receipts',array[]::text[]),
    ('artifacts',array[]::text[])
  ) snapshot(relation_name,excluded_columns) loop
    relation_id:=pg_catalog.to_regclass('app_data_agent.'||item.relation_name);
    execute pg_catalog.format(
      'select pg_catalog.count(*),app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(source)-$1 order by '
      ||'(to_jsonb(source)-$1)::text),''[]''::jsonb)) from %s source',relation_id)
      into strict observed_count,observed_digest using item.excluded_columns;
    insert into falcon24_e1_relation_snapshot(
      relation_name,relation_oid,excluded_columns,row_count,row_digest)
    values(item.relation_name,relation_id::oid,item.excluded_columns,
      observed_count,observed_digest);
  end loop;
end
$snapshot$;
alter table app_data_agent.falcon24_e1_staging_sessions
  rename to falcon24_authority_staging_sessions;
alter table app_data_agent.falcon24_e1_staging_receipts
  rename to falcon24_authority_staging_receipts;
alter table app_data_agent.falcon24_e1_activation_attempts
  rename to falcon24_authority_activation_attempts;
alter table app_data_agent.falcon24_e1_ui_receipts rename to falcon24_ui_receipts;
alter table app_data_agent.falcon24_e1_gate_attempt_history
  rename to falcon24_gate_attempt_history;

alter table app_data_agent.e1_analysis_publications
  rename to falcon24_analysis_publications;
alter table app_data_agent.e1_analysis_publication_artifacts
  rename to falcon24_analysis_publication_artifacts;
alter table app_data_agent.e1_analysis_publication_current
  rename to falcon24_analysis_publication_current;
alter table app_data_agent.e1_analysis_publication_outbox
  rename to falcon24_analysis_publication_outbox;

drop trigger falcon24_e1_staging_session_state_fence
  on app_data_agent.falcon24_authority_staging_sessions;
drop trigger falcon24_e1_staging_receipt_immutable
  on app_data_agent.falcon24_authority_staging_receipts;
drop trigger falcon24_e1_activation_attempt_state_fence
  on app_data_agent.falcon24_authority_activation_attempts;
drop trigger falcon24_000_e1_qualification_slot_attempt_fence
  on app_data_agent.falcon24_qualification_slots;
drop trigger falcon24_000_e1_campaign_run_attempt_fence
  on app_data_agent.falcon24_acceptance_campaign_runs;

alter table app_data_agent.falcon24_authority_staging_sessions
  add column authority_epoch text;
alter table app_data_agent.falcon24_authority_staging_receipts
  add column authority_epoch text;
alter table app_data_agent.falcon24_authority_activation_attempts
  add column authority_epoch text;

update app_data_agent.falcon24_authority_staging_sessions set authority_epoch='E1';
update app_data_agent.falcon24_authority_staging_receipts set authority_epoch='E1';
update app_data_agent.falcon24_authority_activation_attempts set authority_epoch='E1';

alter table app_data_agent.falcon24_authority_staging_sessions
  alter column authority_epoch set not null,
  add constraint falcon24_authority_staging_session_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$'),
  add constraint falcon24_authority_staging_session_epoch_key unique(
    app_id,tenant_id,environment,staging_id,authority_epoch);
alter table app_data_agent.falcon24_authority_staging_receipts
  alter column authority_epoch set not null,
  add constraint falcon24_authority_staging_receipt_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$');
alter table app_data_agent.falcon24_authority_activation_attempts
  alter column authority_epoch set not null,
  add constraint falcon24_authority_activation_attempt_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$'),
  add constraint falcon24_authority_activation_attempt_epoch_key unique(
    app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash,authority_epoch);

alter table app_data_agent.falcon24_authority_staging_receipts
  drop constraint falcon24_e1_staging_receipts_app_id_tenant_id_environment__fkey,
  drop constraint falcon24_e1_staging_receipts_check,
  add constraint falcon24_authority_staging_receipt_session_fk foreign key(
    app_id,tenant_id,environment,staging_id,authority_epoch)
    references app_data_agent.falcon24_authority_staging_sessions(
      app_id,tenant_id,environment,staging_id,authority_epoch) on delete restrict,
  add constraint falcon24_authority_staging_receipt_document_check check(
    component in('AGENT_PROFILES','DATASET','LLM_CONFIGURATION','OPERATOR_REGISTRY',
      'SANDBOX_RUNTIME','SEMANTIC_RELEASE')
    and subject_hash~'^sha256:[0-9a-f]{64}$'
    and evidence_hash~'^sha256:[0-9a-f]{64}$'
    and receipt_hash~'^sha256:[0-9a-f]{64}$'
    and (component='SANDBOX_RUNTIME' or not production_isolation_proven)
    and receipt_hash=app_data_agent.u2_canonical_sha256(receipt_document-'receipt_hash')
    and ((authority_epoch='E1'
        and receipt_document->>'schema_version'='falcon24-e1-staging-receipt@1.0.0'
        and not receipt_document?'authority_epoch')
      or (authority_epoch<>'E1'
        and receipt_document->>'schema_version'='falcon24-staging-receipt@2.0.0'
        and receipt_document->>'authority_epoch'=authority_epoch)));

alter table app_data_agent.falcon24_authority_baselines
  drop constraint falcon24_authority_baselines_app_id_tenant_id_environment__fkey,
  drop constraint falcon24_authority_baselines_authority_epoch_check,
  add constraint falcon24_authority_baseline_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$'),
  add constraint falcon24_authority_baseline_document_version_check check(
    ((authority_epoch='E1'
        and baseline_document->>'schema_version'='falcon24-authority-baseline@1.0.0')
      or (authority_epoch<>'E1'
        and baseline_document->>'schema_version'='falcon24-authority-baseline@2.0.0'))
    and baseline_document->>'authority_epoch'=authority_epoch),
  add constraint falcon24_authority_baseline_epoch_identity_key unique(
    app_id,tenant_id,environment,baseline_id,authority_epoch),
  add constraint falcon24_authority_baseline_staging_fk foreign key(
    app_id,tenant_id,environment,staging_id,authority_epoch)
    references app_data_agent.falcon24_authority_staging_sessions(
      app_id,tenant_id,environment,staging_id,authority_epoch) on delete restrict;

drop index app_data_agent.falcon24_authority_one_active_baseline;
create unique index falcon24_authority_one_active_baseline_per_epoch
on app_data_agent.falcon24_authority_baselines(app_id,tenant_id,environment,authority_epoch)
where status='ACTIVE';

alter table app_data_agent.falcon24_authority_activation_attempts
  drop constraint falcon24_e1_activation_attemp_app_id_tenant_id_environment_fkey,
  add constraint falcon24_authority_activation_attempt_baseline_fk foreign key(
    app_id,tenant_id,environment,baseline_id,authority_epoch)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,authority_epoch) on delete restrict;

alter table app_data_agent.falcon24_current_authority_epoch
  drop constraint falcon24_current_authority_epoch_authority_epoch_check,
  add constraint falcon24_current_authority_epoch_canonical_check
    check(authority_epoch~'^E[1-9][0-9]*$');

alter table app_data_agent.runs
  drop constraint runs_falcon24_e1_epoch_check,
  add constraint runs_falcon24_authority_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$');
alter table app_data_agent.effective_run_config_receipts
  drop constraint effective_config_falcon24_e1_epoch_check,
  add constraint effective_config_falcon24_authority_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$');
alter table app_data_agent.artifacts
  drop constraint artifacts_falcon24_e1_epoch_check,
  add constraint artifacts_falcon24_authority_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$');

alter table app_data_agent.falcon24_ui_receipts
  drop constraint falcon24_e1_ui_receipts_authority_epoch_check,
  add constraint falcon24_ui_receipt_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$'),
  add constraint falcon24_ui_receipt_document_version_check check(
    (authority_epoch='E1' and receipt_json->>'schema_version' in(
      'falcon24-qa-e2e-receipt@1.0.0','falcon24-trace-ui-receipt@1.0.0'))
    or (authority_epoch<>'E1' and receipt_json->>'schema_version' in(
      'falcon24-qa-e2e-receipt@2.0.0','falcon24-trace-ui-receipt@2.0.0')));

alter table app_data_agent.falcon24_gate_attempt_history
  drop constraint falcon24_e1_gate_attempt_history_authority_epoch_check,
  drop constraint falcon24_e1_gate_attempt_history_check,
  add constraint falcon24_gate_attempt_history_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$'),
  add constraint falcon24_gate_attempt_history_identity_check check(
    (gate_kind='QUALIFICATION' and gate_id=authority_epoch||'-Q1'
      and pg_catalog.jsonb_array_length(slot_snapshots)=16)
    or (gate_kind='CAMPAIGN' and gate_id=authority_epoch||'-C1'
      and pg_catalog.jsonb_array_length(slot_snapshots)=30));

alter table app_data_agent.falcon24_qualifications
  drop constraint falcon24_qualification_e1_epoch_check,
  drop constraint falcon24_e1_qualification_identity_check,
  add constraint falcon24_qualification_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$'),
  add constraint falcon24_qualification_identity_check check(
    qualification_id=authority_epoch||'-Q1'
    and qualification_version between 1 and 1000000
    and model_id~'^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
    and (status='HOLD')=(first_failure_run_id is not null)
    and (status='HOLD')=(first_failure_layer is not null)
    and (status='HOLD')=(first_failure_code is not null)
    and (first_failure_layer is null or first_failure_layer in(
      'ROOT_ROUTING','SQL_DATA_PREPARATION','GOVERNED_OPERATOR','ORACLE','PUBLISHER',
      'SANDBOX_RECLAMATION'))
    and (first_failure_code is null or first_failure_code~'^[A-Z][A-Z0-9_]{2,127}$'));

alter table app_data_agent.falcon24_qualifications
  drop constraint falcon24_qualifications_app_id_tenant_id_environment_princi_key,
  add constraint falcon24_qualification_epoch_version_key unique(
    app_id,tenant_id,environment,principal_id,authority_epoch,qualification_version),
  add constraint falcon24_qualification_epoch_identity_key unique(
    app_id,tenant_id,environment,principal_id,qualification_id,authority_epoch);

alter table app_data_agent.falcon24_qualification_slots add column authority_epoch text;
update app_data_agent.falcon24_qualification_slots set authority_epoch='E1';
alter table app_data_agent.falcon24_qualification_slots
  alter column authority_epoch set not null,
  add constraint falcon24_qualification_slot_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$'),
  add constraint falcon24_qualification_slot_epoch_parent_fk foreign key(
    app_id,tenant_id,environment,principal_id,qualification_id,authority_epoch)
    references app_data_agent.falcon24_qualifications(
      app_id,tenant_id,environment,principal_id,qualification_id,authority_epoch)
    on delete restrict;

alter table app_data_agent.falcon24_acceptance_campaigns
  drop constraint falcon24_campaign_e1_epoch_check,
  drop constraint falcon24_e1_campaign_identity_check,
  add constraint falcon24_campaign_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$'),
  add constraint falcon24_campaign_identity_check check(
    campaign_id=authority_epoch||'-C1'
    and campaign_version between 1 and 1000000
    and policy_id='falcon24-strict-zero-retry@1.0.0'
    and (status='HOLD')=(first_failure_run_id is not null)
    and (status='HOLD')=(first_failure_layer is not null)
    and (status='HOLD')=(first_failure_code is not null));

alter table app_data_agent.falcon24_acceptance_campaigns
  drop constraint falcon24_acceptance_campaigns_app_id_tenant_id_environment__key,
  add constraint falcon24_campaign_epoch_version_key unique(
    app_id,tenant_id,environment,principal_id,authority_epoch,campaign_version),
  add constraint falcon24_campaign_epoch_identity_key unique(
    app_id,tenant_id,environment,principal_id,campaign_id,authority_epoch);

alter table app_data_agent.falcon24_acceptance_campaign_runs add column authority_epoch text;
update app_data_agent.falcon24_acceptance_campaign_runs set authority_epoch='E1';
alter table app_data_agent.falcon24_acceptance_campaign_runs
  alter column authority_epoch set not null,
  add constraint falcon24_campaign_run_epoch_check
    check(authority_epoch~'^E[1-9][0-9]*$'),
  add constraint falcon24_campaign_run_epoch_parent_fk foreign key(
    app_id,tenant_id,environment,principal_id,campaign_id,authority_epoch)
    references app_data_agent.falcon24_acceptance_campaigns(
      app_id,tenant_id,environment,principal_id,campaign_id,authority_epoch)
    on delete restrict;

alter policy falcon24_e1_staging_session_authority
  on app_data_agent.falcon24_authority_staging_sessions
  rename to falcon24_authority_staging_session_rpc;
alter policy falcon24_e1_staging_receipt_authority
  on app_data_agent.falcon24_authority_staging_receipts
  rename to falcon24_authority_staging_receipt_rpc;
alter policy falcon24_e1_activation_attempt_authority
  on app_data_agent.falcon24_authority_activation_attempts
  rename to falcon24_authority_activation_attempt_rpc;
alter policy falcon24_e1_ui_receipts_rpc on app_data_agent.falcon24_ui_receipts
  rename to falcon24_ui_receipts_rpc;
alter policy falcon24_e1_ui_receipts_rpc_insert on app_data_agent.falcon24_ui_receipts
  rename to falcon24_ui_receipts_rpc_insert;
alter policy falcon24_e1_gate_attempt_history_authority
  on app_data_agent.falcon24_gate_attempt_history
  rename to falcon24_gate_attempt_history_rpc;
alter policy e1_analysis_publications_rpc
  on app_data_agent.falcon24_analysis_publications
  rename to falcon24_analysis_publications_rpc;
alter policy e1_analysis_publications_rpc_insert
  on app_data_agent.falcon24_analysis_publications
  rename to falcon24_analysis_publications_rpc_insert;
alter policy e1_analysis_publication_artifacts_rpc
  on app_data_agent.falcon24_analysis_publication_artifacts
  rename to falcon24_analysis_publication_artifacts_rpc;
alter policy e1_analysis_publication_artifacts_rpc_insert
  on app_data_agent.falcon24_analysis_publication_artifacts
  rename to falcon24_analysis_publication_artifacts_rpc_insert;
alter policy e1_analysis_publication_current_rpc
  on app_data_agent.falcon24_analysis_publication_current
  rename to falcon24_analysis_publication_current_rpc;
alter policy e1_analysis_publication_current_rpc_insert
  on app_data_agent.falcon24_analysis_publication_current
  rename to falcon24_analysis_publication_current_rpc_insert;
alter policy e1_analysis_publication_outbox_rpc
  on app_data_agent.falcon24_analysis_publication_outbox
  rename to falcon24_analysis_publication_outbox_rpc;
alter policy e1_analysis_publication_outbox_rpc_insert
  on app_data_agent.falcon24_analysis_publication_outbox
  rename to falcon24_analysis_publication_outbox_rpc_insert;

alter trigger e1_analysis_publications_immutable
  on app_data_agent.falcon24_analysis_publications
  rename to falcon24_analysis_publications_immutable;
alter trigger e1_analysis_publication_artifacts_immutable
  on app_data_agent.falcon24_analysis_publication_artifacts
  rename to falcon24_analysis_publication_artifacts_immutable;
alter trigger e1_analysis_publication_current_immutable
  on app_data_agent.falcon24_analysis_publication_current
  rename to falcon24_analysis_publication_current_immutable;

alter table app_data_agent.falcon24_authority_staging_sessions force row level security;
alter table app_data_agent.falcon24_authority_staging_receipts force row level security;
alter table app_data_agent.falcon24_authority_activation_attempts force row level security;
alter table app_data_agent.falcon24_ui_receipts force row level security;
alter table app_data_agent.falcon24_gate_attempt_history force row level security;
alter table app_data_agent.falcon24_analysis_publications force row level security;
alter table app_data_agent.falcon24_analysis_publication_artifacts force row level security;
alter table app_data_agent.falcon24_analysis_publication_current force row level security;
alter table app_data_agent.falcon24_analysis_publication_outbox force row level security;
create function app_data_agent.falcon24_authority_epoch_is_canonical(authority_epoch text)
returns boolean language sql immutable strict security definer set search_path='' as $function$
  select authority_epoch~'^E[1-9][0-9]*$'
$function$;

create function app_data_agent.falcon24_authority_binding_document(
  current_epoch app_data_agent.falcon24_current_authority_epoch)
returns jsonb language sql immutable strict security definer set search_path='' as $function$
  select pg_catalog.jsonb_build_object(
    'schema_version',case when current_epoch.authority_epoch='E1'
      then 'falcon24-authority-binding@1.0.0'
      else 'falcon24-authority-binding@2.0.0' end,
    'authority_epoch',current_epoch.authority_epoch,
    'baseline_id',current_epoch.baseline_id,
    'baseline_hash',current_epoch.baseline_hash,
    'activation_attempt_id',current_epoch.activation_attempt_id)
$function$;

create function app_data_agent.falcon24_activation_attempt_document(
  attempt app_data_agent.falcon24_authority_activation_attempts)
returns jsonb language sql immutable strict security definer set search_path='' as $function$
  select pg_catalog.jsonb_build_object(
    'schema_version',case when attempt.authority_epoch='E1'
      then 'falcon24-e1-activation-attempt@1.0.0'
      else 'falcon24-activation-attempt@2.0.0' end,
    'authority_epoch',case when attempt.authority_epoch='E1' then null
      else attempt.authority_epoch end,
    'attempt_id',attempt.attempt_id,'baseline_id',attempt.baseline_id,
    'expected_baseline_hash',attempt.expected_baseline_hash,
    'status',attempt.status,'failure_code',attempt.failure_code)
    - case when attempt.authority_epoch='E1' then 'authority_epoch' else '' end
$function$;

create function app_data_agent.begin_falcon24_authority_staging_session(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record; current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  existing app_data_agent.falcon24_authority_staging_sessions%rowtype;
  requested_staging_id uuid; requested_epoch text; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','authority_epoch','staging_id','retained_assets_hash','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-staging-session@2.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(command->>'authority_epoch')
      is distinct from true
    or command->>'authority_epoch'='E1'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'staging_id') is distinct from true
    or command->>'retained_assets_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.contains_potential_plaintext_secret(command)
  then raise exception using errcode='22023',message='FALCON24_AUTHORITY_STAGING_SESSION_INVALID'; end if;
  requested_epoch:=command->>'authority_epoch';
  requested_staging_id:=(command->>'staging_id')::uuid;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-authority-staging:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for share;
  if not found then raise exception using errcode='55000',
    message='FALCON24_CURRENT_AUTHORITY_NOT_FOUND'; end if;
  if pg_catalog.substr(requested_epoch,2)::numeric
      <>pg_catalog.substr(current_epoch.authority_epoch,2)::numeric+1
  then raise exception using errcode='55000',message='FALCON24_AUTHORITY_EPOCH_NOT_SUCCESSOR'; end if;
  select * into existing from app_data_agent.falcon24_authority_staging_sessions session
    where session.app_id=authority.app_id and session.tenant_id=authority.tenant_id
      and session.environment=authority.environment and session.staging_id=requested_staging_id
    for update;
  if found then
    if existing.authority_epoch is distinct from requested_epoch
      or existing.retained_assets_hash is distinct from command->>'retained_assets_hash'
    then raise exception using errcode='23505',
      message='FALCON24_AUTHORITY_STAGING_IDENTITY_CONFLICT'; end if;
  else
    now_at:=pg_catalog.clock_timestamp();
    insert into app_data_agent.falcon24_authority_staging_sessions(
      app_id,tenant_id,environment,staging_id,authority_epoch,retained_assets_hash,status,
      created_by,created_at,updated_at)
    values(authority.app_id,authority.tenant_id,authority.environment,requested_staging_id,
      requested_epoch,command->>'retained_assets_hash','STAGED',authority.principal_id,now_at,now_at)
    returning * into strict existing;
  end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-staging-session@2.0.0',
    'authority_epoch',existing.authority_epoch,'staging_id',existing.staging_id,
    'retained_assets_hash',existing.retained_assets_hash,'status',existing.status);
end
$function$;

create function app_data_agent.record_falcon24_authority_staging_receipt(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record; session app_data_agent.falcon24_authority_staging_sessions%rowtype;
  existing app_data_agent.falcon24_authority_staging_receipts%rowtype;
  receipt jsonb; requested_staging_id uuid; requested_epoch text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','authority_epoch','receipt','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-staging-receipt-record@2.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(command->>'authority_epoch')
      is distinct from true
    or command->>'authority_epoch'='E1'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'receipt') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_AUTHORITY_STAGING_RECEIPT_INVALID'; end if;
  requested_epoch:=command->>'authority_epoch';receipt:=command->'receipt';
  if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','authority_epoch','staging_id','component','subject_hash','evidence_hash',
      'production_isolation_proven','receipt_hash']::text[]) is distinct from true
    or receipt->>'schema_version' is distinct from 'falcon24-staging-receipt@2.0.0'
    or receipt->>'authority_epoch' is distinct from requested_epoch
    or app_data_agent.canonical_uuid_json_string_is_valid(receipt->'staging_id') is distinct from true
    or receipt->>'component' not in('AGENT_PROFILES','DATASET','LLM_CONFIGURATION',
      'OPERATOR_REGISTRY','SANDBOX_RUNTIME','SEMANTIC_RELEASE')
    or receipt->>'subject_hash'!~'^sha256:[0-9a-f]{64}$'
    or receipt->>'evidence_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(receipt->'production_isolation_proven') is distinct from 'boolean'
    or ((receipt->>'production_isolation_proven')::boolean
      and receipt->>'component'<>'SANDBOX_RUNTIME')
    or receipt->>'receipt_hash' is distinct from
      app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
    or app_data_agent.contains_potential_plaintext_secret(receipt)
  then raise exception using errcode='22023',message='FALCON24_AUTHORITY_STAGING_RECEIPT_INVALID'; end if;
  requested_staging_id:=(receipt->>'staging_id')::uuid;
  select * into strict authority from platform.current_backend_authority(true);
  select * into session from app_data_agent.falcon24_authority_staging_sessions row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.staging_id=requested_staging_id
      and row.authority_epoch=requested_epoch for update;
  if not found then raise exception using errcode='02000',
    message='FALCON24_AUTHORITY_STAGING_SESSION_NOT_FOUND'; end if;
  if session.status<>'STAGED' then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_STAGING_SESSION_TERMINAL'; end if;
  select * into existing from app_data_agent.falcon24_authority_staging_receipts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.staging_id=requested_staging_id
      and row.authority_epoch=requested_epoch and row.component=receipt->>'component' for update;
  if found then
    if existing.receipt_hash is distinct from receipt->>'receipt_hash'
      or existing.receipt_document is distinct from receipt
    then raise exception using errcode='23505',
      message='FALCON24_AUTHORITY_STAGING_RECEIPT_CONFLICT'; end if;
  else
    insert into app_data_agent.falcon24_authority_staging_receipts(
      app_id,tenant_id,environment,staging_id,authority_epoch,component,subject_hash,
      evidence_hash,production_isolation_proven,receipt_hash,receipt_document,created_at)
    values(authority.app_id,authority.tenant_id,authority.environment,requested_staging_id,
      requested_epoch,receipt->>'component',receipt->>'subject_hash',receipt->>'evidence_hash',
      (receipt->>'production_isolation_proven')::boolean,receipt->>'receipt_hash',receipt,
      pg_catalog.clock_timestamp()) returning * into strict existing;
  end if;
  return existing.receipt_document;
end
$function$;

create function app_data_agent.stage_falcon24_authority_baseline(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record; session app_data_agent.falcon24_authority_staging_sessions%rowtype;
  existing app_data_agent.falcon24_authority_baselines%rowtype;
  baseline jsonb; requested_staging_id uuid; requested_baseline_id uuid; requested_epoch text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','authority_epoch','staging_id','baseline','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-stage-baseline-request@2.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(command->>'authority_epoch')
      is distinct from true
    or command->>'authority_epoch'='E1'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'staging_id') is distinct from true
    or pg_catalog.jsonb_typeof(command->'baseline') is distinct from 'object'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',message='FALCON24_AUTHORITY_BASELINE_INVALID'; end if;
  requested_epoch:=command->>'authority_epoch';
  requested_staging_id:=(command->>'staging_id')::uuid;baseline:=command->'baseline';
  if app_data_agent.provider_json_object_has_exact_keys(baseline,array[
      'schema_version','baseline_id','authority_epoch','source_commit','retained_assets_hash',
      'web_build_hash','staging_receipts','acceptance_contracts','production_isolation_proven',
      'production_gate','baseline_hash']::text[]) is distinct from true
    or baseline->>'schema_version' is distinct from 'falcon24-authority-baseline@2.0.0'
    or baseline->>'authority_epoch' is distinct from requested_epoch
    or app_data_agent.canonical_uuid_json_string_is_valid(baseline->'baseline_id') is distinct from true
    or baseline->>'source_commit'!~'^[0-9a-f]{40}$'
    or baseline->>'retained_assets_hash'!~'^sha256:[0-9a-f]{64}$'
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
  then raise exception using errcode='22023',message='FALCON24_AUTHORITY_BASELINE_INVALID'; end if;
  requested_baseline_id:=(baseline->>'baseline_id')::uuid;
  select * into strict authority from platform.current_backend_authority(true);
  select * into session from app_data_agent.falcon24_authority_staging_sessions row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.staging_id=requested_staging_id
      and row.authority_epoch=requested_epoch for update;
  if not found then raise exception using errcode='02000',
    message='FALCON24_AUTHORITY_STAGING_SESSION_NOT_FOUND'; end if;
  if session.status<>'STAGED'
    or session.retained_assets_hash is distinct from baseline->>'retained_assets_hash'
    or (select pg_catalog.count(*) from app_data_agent.falcon24_authority_staging_receipts receipt
      where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
        and receipt.environment=authority.environment and receipt.staging_id=requested_staging_id
        and receipt.authority_epoch=requested_epoch)<>6
    or exists(select 1 from (values
        ('DATASET','dataset'),('SEMANTIC_RELEASE','semantic_release'),
        ('LLM_CONFIGURATION','llm_configuration'),('AGENT_PROFILES','agent_profiles'),
        ('OPERATOR_REGISTRY','operator_registry'),('SANDBOX_RUNTIME','sandbox_runtime'))
      expected(component,baseline_key)
      left join app_data_agent.falcon24_authority_staging_receipts receipt
        on receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
        and receipt.environment=authority.environment and receipt.staging_id=requested_staging_id
        and receipt.authority_epoch=requested_epoch and receipt.component=expected.component
      where receipt.receipt_hash is distinct from
        baseline#>>array['staging_receipts',expected.baseline_key])
    or not exists(select 1 from app_data_agent.falcon24_authority_staging_receipts receipt
      where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
        and receipt.environment=authority.environment and receipt.staging_id=requested_staging_id
        and receipt.authority_epoch=requested_epoch and receipt.component='SANDBOX_RUNTIME'
        and receipt.production_isolation_proven=
          (baseline->>'production_isolation_proven')::boolean)
  then raise exception using errcode='55000',message='FALCON24_AUTHORITY_STAGING_INCOMPLETE'; end if;
  select * into existing from app_data_agent.falcon24_authority_baselines row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.baseline_id=requested_baseline_id for update;
  if found then
    if existing.authority_epoch is distinct from requested_epoch
      or existing.staging_id is distinct from requested_staging_id
      or existing.baseline_hash is distinct from baseline->>'baseline_hash'
      or existing.baseline_document is distinct from baseline
    then raise exception using errcode='23505',
      message='FALCON24_AUTHORITY_BASELINE_IDENTITY_CONFLICT'; end if;
  else
    insert into app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,authority_epoch,staging_id,baseline_hash,
      baseline_document,source_commit,retained_assets_hash,web_build_hash,
      production_isolation_proven,production_gate,status,created_by,created_at)
    values(authority.app_id,authority.tenant_id,authority.environment,requested_baseline_id,
      requested_epoch,requested_staging_id,baseline->>'baseline_hash',baseline,
      baseline->>'source_commit',baseline->>'retained_assets_hash',baseline->>'web_build_hash',
      (baseline->>'production_isolation_proven')::boolean,baseline->>'production_gate','STAGED',
      authority.principal_id,pg_catalog.clock_timestamp()) returning * into strict existing;
  end if;
  return existing.baseline_document;
end
$function$;
create function app_data_agent.falcon24_authority_staging_session_state_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if tg_op='DELETE'
    or new.app_id is distinct from old.app_id
    or new.tenant_id is distinct from old.tenant_id
    or new.environment is distinct from old.environment
    or new.staging_id is distinct from old.staging_id
    or new.authority_epoch is distinct from old.authority_epoch
    or new.retained_assets_hash is distinct from old.retained_assets_hash
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or not (old.status='STAGED' and new.status in('HOLD','CONSUMED'))
    or new.updated_at<old.updated_at
  then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_STAGING_STATE_IMMUTABLE'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_authority_activation_attempt_state_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if tg_op='DELETE'
    or new.app_id is distinct from old.app_id
    or new.tenant_id is distinct from old.tenant_id
    or new.environment is distinct from old.environment
    or new.attempt_id is distinct from old.attempt_id
    or new.baseline_id is distinct from old.baseline_id
    or new.expected_baseline_hash is distinct from old.expected_baseline_hash
    or new.authority_epoch is distinct from old.authority_epoch
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or not (old.status='OPEN' and new.status in('HOLD','ACTIVATED'))
  then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_ACTIVATION_ATTEMPT_IMMUTABLE'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_authority_baseline_state_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if tg_op='DELETE'
    or new.app_id is distinct from old.app_id
    or new.tenant_id is distinct from old.tenant_id
    or new.environment is distinct from old.environment
    or new.baseline_id is distinct from old.baseline_id
    or new.authority_epoch is distinct from old.authority_epoch
    or new.staging_id is distinct from old.staging_id
    or new.baseline_hash is distinct from old.baseline_hash
    or new.baseline_document is distinct from old.baseline_document
    or new.source_commit is distinct from old.source_commit
    or new.retained_assets_hash is distinct from old.retained_assets_hash
    or new.web_build_hash is distinct from old.web_build_hash
    or new.production_isolation_proven is distinct from old.production_isolation_proven
    or new.production_gate is distinct from old.production_gate
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or not (old.status='STAGED' and new.status in('HOLD','ACTIVE'))
  then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_BASELINE_STATE_IMMUTABLE'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_current_authority_successor_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if tg_op='DELETE'
    or new.app_id is distinct from old.app_id
    or new.tenant_id is distinct from old.tenant_id
    or new.environment is distinct from old.environment
    or app_data_agent.falcon24_authority_epoch_is_canonical(new.authority_epoch)
      is distinct from true
    or pg_catalog.substr(new.authority_epoch,2)::numeric
      <>pg_catalog.substr(old.authority_epoch,2)::numeric+1
    or new.activated_at<=old.activated_at
  then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_POINTER_NOT_SUCCESSOR'; end if;
  return new;
end
$function$;

drop trigger falcon24_e1_baseline_state_fence
  on app_data_agent.falcon24_authority_baselines;
drop trigger falcon24_e1_current_authority_immutable
  on app_data_agent.falcon24_current_authority_epoch;

create trigger falcon24_authority_staging_session_state_fence
before update or delete on app_data_agent.falcon24_authority_staging_sessions
for each row execute function app_data_agent.falcon24_authority_staging_session_state_fence();
create trigger falcon24_authority_staging_receipt_immutable
before update or delete on app_data_agent.falcon24_authority_staging_receipts
for each row execute function app_data_agent.analysis_governed_state_immutable();
create trigger falcon24_authority_activation_attempt_state_fence
before update or delete on app_data_agent.falcon24_authority_activation_attempts
for each row execute function app_data_agent.falcon24_authority_activation_attempt_state_fence();
create trigger falcon24_authority_baseline_state_fence
before update or delete on app_data_agent.falcon24_authority_baselines
for each row execute function app_data_agent.falcon24_authority_baseline_state_fence();
create trigger falcon24_current_authority_successor_fence
before update or delete on app_data_agent.falcon24_current_authority_epoch
for each row execute function app_data_agent.falcon24_current_authority_successor_fence();

create function app_data_agent.begin_falcon24_authority_activation_attempt(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record; current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  baseline app_data_agent.falcon24_authority_baselines%rowtype;
  existing app_data_agent.falcon24_authority_activation_attempts%rowtype;
  requested_attempt_id uuid; requested_baseline_id uuid; requested_epoch text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','authority_epoch','attempt_id','baseline_id','expected_baseline_hash',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-activation-request@2.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(command->>'authority_epoch')
      is distinct from true
    or command->>'authority_epoch'='E1'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'baseline_id') is distinct from true
    or command->>'expected_baseline_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',
    message='FALCON24_AUTHORITY_ACTIVATION_ATTEMPT_INVALID'; end if;
  requested_epoch:=command->>'authority_epoch';
  requested_attempt_id:=(command->>'attempt_id')::uuid;
  requested_baseline_id:=(command->>'baseline_id')::uuid;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-authority-activation:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for share;
  if not found then raise exception using errcode='55000',
    message='FALCON24_CURRENT_AUTHORITY_NOT_FOUND'; end if;
  if pg_catalog.substr(requested_epoch,2)::numeric
      <>pg_catalog.substr(current_epoch.authority_epoch,2)::numeric+1
  then raise exception using errcode='55000',message='FALCON24_AUTHORITY_EPOCH_NOT_SUCCESSOR'; end if;
  select * into baseline from app_data_agent.falcon24_authority_baselines row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.baseline_id=requested_baseline_id
      and row.authority_epoch=requested_epoch for update;
  if not found then raise exception using errcode='02000',
    message='FALCON24_AUTHORITY_BASELINE_NOT_FOUND'; end if;
  if baseline.status<>'STAGED'
    or baseline.baseline_hash is distinct from command->>'expected_baseline_hash'
  then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_BASELINE_NOT_STAGED'; end if;
  select * into existing from app_data_agent.falcon24_authority_activation_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.attempt_id=requested_attempt_id for update;
  if found then
    if existing.authority_epoch is distinct from requested_epoch
      or existing.baseline_id is distinct from requested_baseline_id
      or existing.expected_baseline_hash is distinct from command->>'expected_baseline_hash'
    then raise exception using errcode='23505',
      message='FALCON24_AUTHORITY_ACTIVATION_ATTEMPT_CONFLICT'; end if;
  else
    insert into app_data_agent.falcon24_authority_activation_attempts(
      app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash,
      authority_epoch,status,created_by,created_at)
    values(authority.app_id,authority.tenant_id,authority.environment,requested_attempt_id,
      requested_baseline_id,command->>'expected_baseline_hash',requested_epoch,'OPEN',
      authority.principal_id,pg_catalog.clock_timestamp()) returning * into strict existing;
  end if;
  return app_data_agent.falcon24_activation_attempt_document(existing);
end
$function$;

create function app_data_agent.hold_falcon24_authority_activation_attempt(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record; attempt app_data_agent.falcon24_authority_activation_attempts%rowtype;
  now_at timestamptz; requested_epoch text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','authority_epoch','attempt_id','baseline_id','expected_baseline_hash',
      'failure_code','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-activation-request@2.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(command->>'authority_epoch')
      is distinct from true
    or command->>'authority_epoch'='E1'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'baseline_id') is distinct from true
    or command->>'expected_baseline_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'failure_code'!~'^[A-Z][A-Z0-9_]{2,127}$'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',message='FALCON24_AUTHORITY_ACTIVATION_HOLD_INVALID'; end if;
  requested_epoch:=command->>'authority_epoch';
  select * into strict authority from platform.current_backend_authority(true);
  select * into attempt from app_data_agent.falcon24_authority_activation_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.attempt_id=(command->>'attempt_id')::uuid
      and row.authority_epoch=requested_epoch for update;
  if not found then raise exception using errcode='02000',
    message='FALCON24_AUTHORITY_ACTIVATION_ATTEMPT_NOT_FOUND'; end if;
  if attempt.baseline_id is distinct from (command->>'baseline_id')::uuid
    or attempt.expected_baseline_hash is distinct from command->>'expected_baseline_hash'
  then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_ACTIVATION_ATTEMPT_MISMATCH'; end if;
  if attempt.status='ACTIVATED' then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_ACTIVATION_ATTEMPT_TERMINAL';
  elsif attempt.status='HOLD' then
    if attempt.failure_code is distinct from command->>'failure_code'
    then raise exception using errcode='23505',
      message='FALCON24_AUTHORITY_ACTIVATION_HOLD_CONFLICT'; end if;
    return app_data_agent.falcon24_activation_attempt_document(attempt);
  end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_authority_activation_attempts set
    status='HOLD',failure_code=command->>'failure_code',decided_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and attempt_id=attempt.attempt_id and status='OPEN'
    returning * into strict attempt;
  update app_data_agent.falcon24_authority_baselines set status='HOLD'
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and baseline_id=attempt.baseline_id and status='STAGED';
  update app_data_agent.falcon24_authority_staging_sessions session set
    status='HOLD',failure_code=command->>'failure_code',updated_at=now_at
    from app_data_agent.falcon24_authority_baselines baseline
    where baseline.app_id=authority.app_id and baseline.tenant_id=authority.tenant_id
      and baseline.environment=authority.environment and baseline.baseline_id=attempt.baseline_id
      and baseline.authority_epoch=requested_epoch
      and session.app_id=baseline.app_id and session.tenant_id=baseline.tenant_id
      and session.environment=baseline.environment and session.staging_id=baseline.staging_id
      and session.authority_epoch=requested_epoch and session.status='STAGED';
  return app_data_agent.falcon24_activation_attempt_document(attempt);
end
$function$;

create function app_data_agent.activate_falcon24_authority(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record; attempt app_data_agent.falcon24_authority_activation_attempts%rowtype;
  baseline app_data_agent.falcon24_authority_baselines%rowtype;
  session app_data_agent.falcon24_authority_staging_sessions%rowtype;
  current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  now_at timestamptz; requested_epoch text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','authority_epoch','attempt_id','baseline_id','expected_baseline_hash',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-activation-request@2.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(command->>'authority_epoch')
      is distinct from true
    or command->>'authority_epoch'='E1'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'baseline_id') is distinct from true
    or command->>'expected_baseline_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',message='FALCON24_AUTHORITY_ACTIVATION_INVALID'; end if;
  requested_epoch:=command->>'authority_epoch';
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-authority-activation:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for update;
  if not found then raise exception using errcode='55000',
    message='FALCON24_CURRENT_AUTHORITY_NOT_FOUND'; end if;
  if pg_catalog.substr(requested_epoch,2)::numeric
      <>pg_catalog.substr(current_epoch.authority_epoch,2)::numeric+1
  then raise exception using errcode='55000',message='FALCON24_AUTHORITY_EPOCH_NOT_SUCCESSOR'; end if;
  select * into attempt from app_data_agent.falcon24_authority_activation_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.attempt_id=(command->>'attempt_id')::uuid
      and row.authority_epoch=requested_epoch for update;
  if not found then raise exception using errcode='02000',
    message='FALCON24_AUTHORITY_ACTIVATION_ATTEMPT_NOT_FOUND'; end if;
  if attempt.status<>'OPEN' or attempt.baseline_id is distinct from (command->>'baseline_id')::uuid
    or attempt.expected_baseline_hash is distinct from command->>'expected_baseline_hash'
  then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_ACTIVATION_ATTEMPT_TERMINAL'; end if;
  select * into strict baseline from app_data_agent.falcon24_authority_baselines row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.baseline_id=attempt.baseline_id
      and row.authority_epoch=requested_epoch for update;
  select * into strict session from app_data_agent.falcon24_authority_staging_sessions row
    where row.app_id=baseline.app_id and row.tenant_id=baseline.tenant_id
      and row.environment=baseline.environment and row.staging_id=baseline.staging_id
      and row.authority_epoch=requested_epoch for update;
  perform 1 from app_data_agent.falcon24_authority_staging_receipts receipt
    where receipt.app_id=baseline.app_id and receipt.tenant_id=baseline.tenant_id
      and receipt.environment=baseline.environment and receipt.staging_id=baseline.staging_id
      and receipt.authority_epoch=requested_epoch order by receipt.component for share;
  if baseline.status<>'STAGED' or session.status<>'STAGED'
    or baseline.baseline_hash is distinct from attempt.expected_baseline_hash
    or (select pg_catalog.count(*) from app_data_agent.falcon24_authority_staging_receipts receipt
      where receipt.app_id=baseline.app_id and receipt.tenant_id=baseline.tenant_id
        and receipt.environment=baseline.environment and receipt.staging_id=baseline.staging_id
        and receipt.authority_epoch=requested_epoch)<>6
    or exists(select 1 from (values
        ('DATASET','dataset'),('SEMANTIC_RELEASE','semantic_release'),
        ('LLM_CONFIGURATION','llm_configuration'),('AGENT_PROFILES','agent_profiles'),
        ('OPERATOR_REGISTRY','operator_registry'),('SANDBOX_RUNTIME','sandbox_runtime'))
      expected(component,baseline_key)
      left join app_data_agent.falcon24_authority_staging_receipts receipt
        on receipt.app_id=baseline.app_id and receipt.tenant_id=baseline.tenant_id
        and receipt.environment=baseline.environment and receipt.staging_id=baseline.staging_id
        and receipt.authority_epoch=requested_epoch and receipt.component=expected.component
      where receipt.receipt_hash is distinct from
        baseline.baseline_document#>>array['staging_receipts',expected.baseline_key])
    or not exists(select 1 from app_data_agent.falcon24_authority_staging_receipts receipt
      where receipt.app_id=baseline.app_id and receipt.tenant_id=baseline.tenant_id
        and receipt.environment=baseline.environment and receipt.staging_id=baseline.staging_id
        and receipt.authority_epoch=requested_epoch and receipt.component='SANDBOX_RUNTIME'
        and receipt.production_isolation_proven=baseline.production_isolation_proven)
    or authority.environment='prod'
      and (baseline.production_gate<>'GO' or not baseline.production_isolation_proven)
    or exists(select 1 from app_data_agent.runs row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch=requested_epoch)
    or exists(select 1 from app_data_agent.effective_run_config_receipts row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch=requested_epoch)
    or exists(select 1 from app_data_agent.artifacts row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch=requested_epoch)
    or exists(select 1 from app_data_agent.falcon24_qualifications row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch=requested_epoch)
    or exists(select 1 from app_data_agent.falcon24_acceptance_campaigns row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch=requested_epoch)
  then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_ACTIVATION_PREFLIGHT_FAILED'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_authority_activation_attempts set
    status='ACTIVATED',decided_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and attempt_id=attempt.attempt_id and status='OPEN'
    returning * into strict attempt;
  update app_data_agent.falcon24_authority_baselines set
    status='ACTIVE',activation_attempt_id=attempt.attempt_id,activated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and baseline_id=baseline.baseline_id and status='STAGED'
    returning * into strict baseline;
  update app_data_agent.falcon24_authority_staging_sessions set
    status='CONSUMED',updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and staging_id=session.staging_id
      and authority_epoch=requested_epoch and status='STAGED';
  update app_data_agent.falcon24_current_authority_epoch set
    authority_epoch=requested_epoch,baseline_id=baseline.baseline_id,
    baseline_hash=baseline.baseline_hash,activation_attempt_id=attempt.attempt_id,
    activated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and authority_epoch=current_epoch.authority_epoch
    returning * into strict current_epoch;
  return app_data_agent.falcon24_authority_binding_document(current_epoch);
end
$function$;

create or replace function app_data_agent.load_falcon24_current_authority_epoch()
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
begin
  select * into strict authority from platform.current_backend_authority(false);
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment;
  if not found then return null; end if;
  return app_data_agent.falcon24_authority_binding_document(current_epoch);
end
$function$;

create or replace function app_data_agent.load_falcon24_run_authority_binding(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; authority_run app_data_agent.runs%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','run_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-run-authority-load@2.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'run_id') is distinct from true
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',message='FALCON24_RUN_AUTHORITY_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into authority_run from app_data_agent.runs row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.run_id=(command->>'run_id')::uuid
      and row.principal_id=authority.principal_id;
  if not found then raise exception using errcode='02000',message='FALCON24_RUN_NOT_FOUND'; end if;
  return pg_catalog.jsonb_build_object(
    'schema_version',case when authority_run.authority_epoch='E1'
      then 'falcon24-authority-binding@1.0.0'
      else 'falcon24-authority-binding@2.0.0' end,
    'authority_epoch',authority_run.authority_epoch,
    'baseline_id',authority_run.authority_baseline_id,
    'baseline_hash',authority_run.authority_baseline_hash,
    'activation_attempt_id',authority_run.authority_activation_attempt_id);
end
$function$;
create function app_data_agent.falcon24_bind_current_authority()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
begin
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=new.app_id and row.tenant_id=new.tenant_id
      and row.environment=new.environment for share;
  if not found then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_NOT_ACTIVE'; end if;
  if (new.authority_epoch is not null
      and new.authority_epoch is distinct from current_epoch.authority_epoch)
    or (new.authority_baseline_id is not null
      and new.authority_baseline_id is distinct from current_epoch.baseline_id)
    or (new.authority_baseline_hash is not null
      and new.authority_baseline_hash is distinct from current_epoch.baseline_hash)
    or (new.authority_activation_attempt_id is not null
      and new.authority_activation_attempt_id is distinct from current_epoch.activation_attempt_id)
  then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_BINDING_MISMATCH'; end if;
  new.authority_epoch:=current_epoch.authority_epoch;
  new.authority_baseline_id:=current_epoch.baseline_id;
  new.authority_baseline_hash:=current_epoch.baseline_hash;
  new.authority_activation_attempt_id:=current_epoch.activation_attempt_id;
  return new;
end
$function$;

create function app_data_agent.falcon24_bind_artifact_to_run()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare authority_run app_data_agent.runs%rowtype;
begin
  select * into authority_run from app_data_agent.runs row
    where row.app_id=new.app_id and row.tenant_id=new.tenant_id
      and row.environment=new.environment and row.run_id=new.run_id for share;
  if not found then raise exception using errcode='55000',
    message='FALCON24_ARTIFACT_RUN_NOT_FOUND'; end if;
  if (new.authority_epoch is not null
      and new.authority_epoch is distinct from authority_run.authority_epoch)
    or (new.authority_baseline_id is not null
      and new.authority_baseline_id is distinct from authority_run.authority_baseline_id)
    or (new.authority_baseline_hash is not null
      and new.authority_baseline_hash is distinct from authority_run.authority_baseline_hash)
    or (new.authority_activation_attempt_id is not null
      and new.authority_activation_attempt_id is distinct from
        authority_run.authority_activation_attempt_id)
  then raise exception using errcode='55000',
    message='FALCON24_ARTIFACT_AUTHORITY_MISMATCH'; end if;
  new.authority_epoch:=authority_run.authority_epoch;
  new.authority_baseline_id:=authority_run.authority_baseline_id;
  new.authority_baseline_hash:=authority_run.authority_baseline_hash;
  new.authority_activation_attempt_id:=authority_run.authority_activation_attempt_id;
  return new;
end
$function$;

create function app_data_agent.falcon24_binding_immutable()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if new.authority_epoch is distinct from old.authority_epoch
    or new.authority_baseline_id is distinct from old.authority_baseline_id
    or new.authority_baseline_hash is distinct from old.authority_baseline_hash
    or new.authority_activation_attempt_id is distinct from old.authority_activation_attempt_id
  then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_BINDING_IMMUTABLE'; end if;
  return new;
end
$function$;

drop trigger runs_falcon24_e1_bind on app_data_agent.runs;
drop trigger effective_config_falcon24_e1_bind
  on app_data_agent.effective_run_config_receipts;
drop trigger artifacts_falcon24_e1_bind on app_data_agent.artifacts;
drop trigger falcon24_campaign_e1_bind on app_data_agent.falcon24_acceptance_campaigns;
drop trigger falcon24_qualification_e1_bind on app_data_agent.falcon24_qualifications;
drop trigger runs_falcon24_e1_immutable on app_data_agent.runs;
drop trigger effective_config_falcon24_e1_immutable
  on app_data_agent.effective_run_config_receipts;
drop trigger artifacts_falcon24_e1_immutable on app_data_agent.artifacts;
drop trigger falcon24_campaign_e1_immutable on app_data_agent.falcon24_acceptance_campaigns;
drop trigger falcon24_qualification_e1_immutable on app_data_agent.falcon24_qualifications;

create trigger runs_falcon24_authority_bind before insert on app_data_agent.runs
for each row execute function app_data_agent.falcon24_bind_current_authority();
create trigger effective_config_falcon24_authority_bind before insert
on app_data_agent.effective_run_config_receipts
for each row execute function app_data_agent.falcon24_bind_current_authority();
create trigger artifacts_falcon24_authority_bind before insert on app_data_agent.artifacts
for each row execute function app_data_agent.falcon24_bind_artifact_to_run();
create trigger falcon24_campaign_authority_bind before insert
on app_data_agent.falcon24_acceptance_campaigns
for each row execute function app_data_agent.falcon24_bind_current_authority();
create trigger falcon24_qualification_authority_bind before insert
on app_data_agent.falcon24_qualifications
for each row execute function app_data_agent.falcon24_bind_current_authority();

create trigger runs_falcon24_authority_immutable before update on app_data_agent.runs
for each row execute function app_data_agent.falcon24_binding_immutable();
create trigger effective_config_falcon24_authority_immutable before update
on app_data_agent.effective_run_config_receipts
for each row execute function app_data_agent.falcon24_binding_immutable();
create trigger artifacts_falcon24_authority_immutable before update on app_data_agent.artifacts
for each row execute function app_data_agent.falcon24_binding_immutable();
create trigger falcon24_campaign_authority_immutable before update
on app_data_agent.falcon24_acceptance_campaigns
for each row execute function app_data_agent.falcon24_binding_immutable();
create trigger falcon24_qualification_authority_immutable before update
on app_data_agent.falcon24_qualifications
for each row execute function app_data_agent.falcon24_binding_immutable();
alter trigger falcon24_e1_ui_receipts_immutable on app_data_agent.falcon24_ui_receipts
  rename to falcon24_ui_receipts_immutable;

create function app_data_agent.commit_falcon24_ui_receipt(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record; authority_run record; receipt jsonb; existing record;
  requested_kind text; requested_run_id uuid; requested_width integer;
  requested_height integer; required_type text; reference jsonb; requested_epoch text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','run_id','receipt_kind','receipt','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-ui-receipt-commit@2.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'run_id') is distinct from true
    or command->>'receipt_kind' not in('QA_E2E','TRACE_UI')
    or pg_catalog.jsonb_typeof(command->'receipt') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_UI_RECEIPT_COMMAND_INVALID'; end if;
  requested_kind:=command->>'receipt_kind';requested_run_id:=(command->>'run_id')::uuid;
  receipt:=command->'receipt';requested_epoch:=receipt#>>'{authority,authority_epoch}';
  if receipt->>'run_id' is distinct from requested_run_id::text
    or receipt->>'receipt_hash' is distinct from
      app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
    or pg_catalog.jsonb_typeof(receipt->'authority') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(receipt->'authority',array[
      'schema_version','authority_epoch','baseline_id','baseline_hash','activation_attempt_id']::text[])
      is distinct from true
    or receipt#>>'{authority,schema_version}' is distinct from 'falcon24-authority-binding@2.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(requested_epoch) is distinct from true
    or requested_epoch='E1'
    or app_data_agent.canonical_uuid_json_string_is_valid(receipt#>'{authority,baseline_id}')
      is distinct from true
    or receipt#>>'{authority,baseline_hash}'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(
      receipt#>'{authority,activation_attempt_id}') is distinct from true
    or pg_catalog.jsonb_typeof(receipt->'web_build') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(receipt->'web_build',array[
      'build_id','generation_id']::text[]) is distinct from true
    or exists(select 1 from pg_catalog.unnest(array[
      receipt#>>'{web_build,build_id}',receipt#>>'{web_build,generation_id}',
      receipt->>'dom_snapshot_hash',receipt->>'screenshot_hash']::text[]) value
      where value!~'^sha256:[0-9a-f]{64}$')
    or pg_catalog.jsonb_typeof(receipt->'viewport') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(receipt->'viewport',array[
      'width','height']::text[]) is distinct from true
    or receipt#>>'{viewport,width}'!~'^[0-9]+$'
    or receipt#>>'{viewport,height}'!~'^[0-9]+$'
    or (receipt#>>'{viewport,width}')::integer not in(390,1440)
    or (receipt#>>'{viewport,height}')::integer not between 640 and 2400
    or receipt->>'browser_harness_version' is distinct from
      'falcon24-agent-browser-trace-gate@2.0.0'
    or receipt->'error_banner' is distinct from 'null'::jsonb
    or pg_catalog.jsonb_typeof(receipt->'observed_at') is distinct from 'string'
    or (receipt->>'observed_at')::timestamptz is null
  then raise exception using errcode='22023',message='FALCON24_UI_RECEIPT_INVALID'; end if;
  requested_width:=(receipt#>>'{viewport,width}')::integer;
  requested_height:=(receipt#>>'{viewport,height}')::integer;
  if requested_kind='QA_E2E' then
    if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
        'schema_version','run_id','conversation_id','authority','web_build',
        'browser_harness_version','viewport','entry_path','question_hash','terminal_status',
        'answer_visible','table_visible','chart_rendered','report_visible','error_banner',
        'dom_snapshot_hash','screenshot_hash','observed_at','receipt_hash']::text[])
        is distinct from true
      or receipt->>'schema_version' is distinct from 'falcon24-qa-e2e-receipt@2.0.0'
      or receipt->>'entry_path' is distinct from 'QUESTION_COMPOSER_SUBMIT_TO_RESULT'
      or receipt->>'question_hash'!~'^sha256:[0-9a-f]{64}$'
      or receipt->>'terminal_status' is distinct from 'COMPLETED'
      or receipt->'answer_visible' is distinct from 'true'::jsonb
      or receipt->'table_visible' is distinct from 'true'::jsonb
      or receipt->'chart_rendered' is distinct from 'true'::jsonb
      or receipt->'report_visible' is distinct from 'true'::jsonb
    then raise exception using errcode='22023',message='FALCON24_QA_E2E_RECEIPT_INVALID'; end if;
  else
    if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
        'schema_version','run_id','conversation_id','trace_hash','authority','web_build',
        'browser_harness_version','viewport','entry_path','opened_nodes','opened_artifact_refs',
        'chart_ref','chart_rendered','source_table_visible','returned_to_result','error_banner',
        'dom_snapshot_hash','screenshot_hash','observed_at','receipt_hash']::text[])
        is distinct from true
      or receipt->>'schema_version' is distinct from 'falcon24-trace-ui-receipt@2.0.0'
      or receipt->>'entry_path' is distinct from 'RESULT_TRACE_ENTRY_TO_EXACT_RUN'
      or receipt->>'trace_hash'!~'^sha256:[0-9a-f]{64}$'
      or receipt->'chart_rendered' is distinct from 'true'::jsonb
      or receipt->'source_table_visible' is distinct from 'true'::jsonb
      or receipt->'returned_to_result' is distinct from 'true'::jsonb
      or pg_catalog.jsonb_typeof(receipt->'opened_nodes') is distinct from 'array'
      or pg_catalog.jsonb_array_length(receipt->'opened_nodes')<1
      or pg_catalog.jsonb_typeof(receipt->'opened_artifact_refs') is distinct from 'array'
      or pg_catalog.jsonb_array_length(receipt->'opened_artifact_refs')<>5
      or pg_catalog.jsonb_typeof(receipt->'chart_ref') is distinct from 'object'
      or receipt->'chart_ref'->>'artifact_type' is distinct from 'ArtifactWorkspaceDocument'
      or not receipt->'opened_artifact_refs' @> pg_catalog.jsonb_build_array(receipt->'chart_ref')
      or exists(with elements as (
          select item,ordinality,
            pg_catalog.concat_ws(chr(31),item->>'artifact_type',item->>'artifact_id',
              item->>'revision',item->>'content_hash') identity,
            pg_catalog.lag(pg_catalog.concat_ws(chr(31),item->>'artifact_type',item->>'artifact_id',
              item->>'revision',item->>'content_hash')) over(order by ordinality) previous_identity
          from pg_catalog.jsonb_array_elements(receipt->'opened_artifact_refs')
            with ordinality element(item,ordinality))
        select 1 from elements where
          app_data_agent.provider_json_object_has_exact_keys(item,array[
            'artifact_id','artifact_type','app_id','tenant_id','environment','run_id',
            'revision','content_hash']::text[]) is distinct from true
          or app_data_agent.canonical_uuid_json_string_is_valid(item->'artifact_id') is distinct from true
          or app_data_agent.canonical_uuid_json_string_is_valid(item->'app_id') is distinct from true
          or app_data_agent.canonical_uuid_json_string_is_valid(item->'tenant_id') is distinct from true
          or app_data_agent.canonical_uuid_json_string_is_valid(item->'run_id') is distinct from true
          or item->>'run_id' is distinct from requested_run_id::text
          or item->>'revision'!~'^[1-9][0-9]*$'
          or item->>'content_hash'!~'^sha256:[0-9a-f]{64}$'
          or (previous_identity is not null and previous_identity>=identity))
    then raise exception using errcode='22023',message='FALCON24_TRACE_UI_RECEIPT_INVALID'; end if;
    foreach required_type in array array['AnalysisReport','ArtifactWorkspaceDocument',
        'DerivedAnalysisEvidence','QueryEvidence','SqlArtifact']::text[] loop
      if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(
          receipt->'opened_artifact_refs') item where item->>'artifact_type'=required_type)<>1
      then raise exception using errcode='22023',message='FALCON24_TRACE_UI_RECEIPT_INVALID'; end if;
    end loop;
  end if;
  select * into strict authority from platform.current_backend_authority(true);
  select run.authority_epoch,run.authority_baseline_id,run.authority_baseline_hash,
    run.authority_activation_attempt_id,current_epoch.authority_epoch as current_authority_epoch,
    current_epoch.baseline_id as current_baseline_id,current_epoch.baseline_hash as current_baseline_hash,
    current_epoch.activation_attempt_id as current_activation_attempt_id,baseline.web_build_hash
  into authority_run from app_data_agent.runs run
  join app_data_agent.falcon24_current_authority_epoch current_epoch
    on current_epoch.app_id=run.app_id and current_epoch.tenant_id=run.tenant_id
      and current_epoch.environment=run.environment
  join app_data_agent.falcon24_authority_baselines baseline
    on baseline.app_id=current_epoch.app_id and baseline.tenant_id=current_epoch.tenant_id
      and baseline.environment=current_epoch.environment and baseline.baseline_id=current_epoch.baseline_id
      and baseline.baseline_hash=current_epoch.baseline_hash
      and baseline.authority_epoch=current_epoch.authority_epoch
  where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
    and run.environment=authority.environment and run.run_id=requested_run_id
    and run.principal_id=authority.principal_id and run.status='SUCCEEDED' for share of run;
  if not found then raise exception using errcode='02000',
    message='FALCON24_UI_RECEIPT_RUN_NOT_READY'; end if;
  if authority_run.authority_epoch<>requested_epoch
    or authority_run.authority_epoch<>authority_run.current_authority_epoch
    or authority_run.authority_baseline_id<>authority_run.current_baseline_id
    or authority_run.authority_baseline_hash<>authority_run.current_baseline_hash
    or authority_run.authority_activation_attempt_id<>authority_run.current_activation_attempt_id
    or receipt#>>'{authority,baseline_id}'<>authority_run.current_baseline_id::text
    or receipt#>>'{authority,baseline_hash}'<>authority_run.current_baseline_hash
    or receipt#>>'{authority,activation_attempt_id}'<>authority_run.current_activation_attempt_id::text
    or receipt#>>'{web_build,build_id}'<>authority_run.web_build_hash
  then raise exception using errcode='55000',message='FALCON24_UI_RECEIPT_AUTHORITY_MISMATCH'; end if;
  if requested_kind='TRACE_UI' then
    for reference in select item from pg_catalog.jsonb_array_elements(
        receipt->'opened_artifact_refs') artifact(item) loop
      if not exists(select 1 from app_data_agent.artifacts row
        where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
          and row.environment=authority.environment and row.run_id=requested_run_id
          and row.artifact_id=(reference->>'artifact_id')::uuid
          and row.artifact_type=reference->>'artifact_type'
          and row.revision=(reference->>'revision')::integer
          and row.content_hash=reference->>'content_hash' and row.is_active
          and row.authority_epoch=authority_run.authority_epoch
          and row.authority_baseline_id=authority_run.current_baseline_id
          and row.authority_baseline_hash=authority_run.current_baseline_hash
          and row.authority_activation_attempt_id=authority_run.current_activation_attempt_id)
      then raise exception using errcode='55000',
        message='FALCON24_UI_RECEIPT_ARTIFACT_MISMATCH'; end if;
    end loop;
  end if;
  select * into existing from app_data_agent.falcon24_ui_receipts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.run_id=requested_run_id
      and row.receipt_kind=requested_kind and row.viewport_width=requested_width;
  if found then
    if existing.receipt_hash<>receipt->>'receipt_hash' or existing.receipt_json<>receipt
    then raise exception using errcode='55000',message='FALCON24_UI_RECEIPT_REPLAY_MISMATCH'; end if;
    return pg_catalog.jsonb_build_object('disposition','REPLAYED','receipt',existing.receipt_json);
  end if;
  insert into app_data_agent.falcon24_ui_receipts(
    app_id,tenant_id,environment,run_id,receipt_kind,viewport_width,viewport_height,
    authority_epoch,baseline_id,baseline_hash,activation_attempt_id,web_build_hash,
    dom_snapshot_hash,screenshot_hash,receipt_hash,receipt_json,observed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,requested_run_id,
    requested_kind,requested_width,requested_height,requested_epoch,
    authority_run.current_baseline_id,authority_run.current_baseline_hash,
    authority_run.current_activation_attempt_id,authority_run.web_build_hash,
    receipt->>'dom_snapshot_hash',receipt->>'screenshot_hash',receipt->>'receipt_hash',receipt,
    (receipt->>'observed_at')::timestamptz);
  return pg_catalog.jsonb_build_object('disposition','CREATED','receipt',receipt);
end
$function$;

create function app_data_agent.load_falcon24_ui_receipts(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; requested_run_id uuid; authority_run record; receipts jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','run_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-ui-receipts-load@2.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'run_id') is distinct from true
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',message='FALCON24_UI_RECEIPT_LOAD_INVALID'; end if;
  requested_run_id:=(command->>'run_id')::uuid;
  select * into strict authority from platform.current_backend_authority(false);
  select run.authority_epoch,run.authority_baseline_id,run.authority_baseline_hash,
    run.authority_activation_attempt_id into authority_run from app_data_agent.runs run
  where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
    and run.environment=authority.environment and run.run_id=requested_run_id
    and run.principal_id=authority.principal_id;
  if not found then raise exception using errcode='02000',message='FALCON24_RUN_NOT_FOUND'; end if;
  select coalesce(pg_catalog.jsonb_agg(row.receipt_json order by
    row.receipt_kind,row.viewport_width),'[]'::jsonb) into receipts
  from app_data_agent.falcon24_ui_receipts row
  where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
    and row.environment=authority.environment and row.run_id=requested_run_id
    and row.authority_epoch=authority_run.authority_epoch
    and row.baseline_id=authority_run.authority_baseline_id
    and row.baseline_hash=authority_run.authority_baseline_hash
    and row.activation_attempt_id=authority_run.authority_activation_attempt_id;
  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-ui-receipt-set@2.0.0','run_id',requested_run_id,
    'authority',pg_catalog.jsonb_build_object(
      'schema_version',case when authority_run.authority_epoch='E1'
        then 'falcon24-authority-binding@1.0.0'
        else 'falcon24-authority-binding@2.0.0' end,
      'authority_epoch',authority_run.authority_epoch,
      'baseline_id',authority_run.authority_baseline_id,
      'baseline_hash',authority_run.authority_baseline_hash,
      'activation_attempt_id',authority_run.authority_activation_attempt_id),
    'receipts',receipts);
end
$function$;

create or replace function app_data_agent.load_falcon24_e1_ui_receipts(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; requested_run_id uuid; authority_run record; receipts jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','run_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-e1-ui-receipts-load@1.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'run_id') is distinct from true
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',message='FALCON24_E1_UI_RECEIPT_LOAD_INVALID'; end if;
  requested_run_id:=(command->>'run_id')::uuid;
  select * into strict authority from platform.current_backend_authority(false);
  select run.authority_epoch,run.authority_baseline_id,run.authority_baseline_hash,
    run.authority_activation_attempt_id into authority_run from app_data_agent.runs run
  where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
    and run.environment=authority.environment and run.run_id=requested_run_id
    and run.principal_id=authority.principal_id and run.authority_epoch='E1';
  if not found then raise exception using errcode='02000',message='FALCON24_E1_RUN_NOT_FOUND'; end if;
  select coalesce(pg_catalog.jsonb_agg(row.receipt_json order by
    row.receipt_kind,row.viewport_width),'[]'::jsonb) into receipts
  from app_data_agent.falcon24_ui_receipts row
  where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
    and row.environment=authority.environment and row.run_id=requested_run_id
    and row.authority_epoch='E1'
    and row.baseline_id=authority_run.authority_baseline_id
    and row.baseline_hash=authority_run.authority_baseline_hash
    and row.activation_attempt_id=authority_run.authority_activation_attempt_id;
  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-ui-receipt-set@1.0.0','run_id',requested_run_id,
    'authority',pg_catalog.jsonb_build_object(
      'schema_version','falcon24-authority-binding@1.0.0','authority_epoch','E1',
      'baseline_id',authority_run.authority_baseline_id,
      'baseline_hash',authority_run.authority_baseline_hash,
      'activation_attempt_id',authority_run.authority_activation_attempt_id),
    'receipts',receipts);
end
$function$;
alter table app_data_agent.falcon24_qualification_slots
  drop constraint falcon24_qualification_slot_trace_binding_check,
  drop constraint falcon24_qualification_slot_ui_trace_binding_check,
  drop constraint falcon24_qualification_slot_reclamation_binding_check,
  add constraint falcon24_qualification_slot_trace_binding_check check(
    trace_gate_receipt is null or (
      trace_closure_hash is not null
      and pg_catalog.jsonb_typeof(trace_gate_receipt)='object'
      and ((authority_epoch='E1'
          and trace_gate_receipt->>'schema_version'=
            'falcon24-resolution-trace-gate-receipt@2.0.0')
        or (authority_epoch<>'E1'
          and trace_gate_receipt->>'schema_version'=
            'falcon24-resolution-trace-gate-receipt@3.0.0'
          and trace_gate_receipt->>'authority_epoch'=authority_epoch))
      and trace_gate_receipt->>'campaign_id'=qualification_id
      and trace_gate_receipt->>'run_id'=run_id::text
      and trace_gate_receipt->>'trace_hash'=trace_closure_hash
      and trace_gate_receipt->>'receipt_hash'=trace_gate_receipt_hash
      and trace_gate_receipt_hash=
        app_data_agent.u2_canonical_sha256(trace_gate_receipt-'receipt_hash'))),
  add constraint falcon24_qualification_slot_ui_trace_binding_check check(
    ui_trace_gate_receipt is null or (
      trace_gate_receipt is not null
      and ((authority_epoch='E1'
          and ui_trace_gate_receipt->>'schema_version'=
            'falcon24-resolution-trace-ui-gate-receipt@1.0.0')
        or (authority_epoch<>'E1'
          and ui_trace_gate_receipt->>'schema_version'=
            'falcon24-resolution-trace-ui-gate-receipt@2.0.0'
          and ui_trace_gate_receipt->>'authority_epoch'=authority_epoch))
      and ui_trace_gate_receipt->>'campaign_id'=qualification_id
      and ui_trace_gate_receipt->>'run_id'=run_id::text
      and ui_trace_gate_receipt->>'workspace_id'=tenant_id::text
      and ui_trace_gate_receipt->>'trace_hash'=trace_closure_hash
      and ui_trace_gate_receipt->>'receipt_hash'=ui_trace_gate_receipt_hash
      and ui_trace_gate_receipt_hash=
        app_data_agent.u2_canonical_sha256(ui_trace_gate_receipt-'receipt_hash'))),
  add constraint falcon24_qualification_slot_reclamation_binding_check check(
    sandbox_reclamation_receipt is null or (
      ((authority_epoch='E1'
          and sandbox_reclamation_receipt->>'schema_version'=
            'falcon24-sandbox-reclamation-receipt@2.0.0')
        or (authority_epoch<>'E1'
          and sandbox_reclamation_receipt->>'schema_version'=
            'falcon24-sandbox-reclamation-receipt@3.0.0'
          and sandbox_reclamation_receipt->>'authority_epoch'=authority_epoch))
      and sandbox_reclamation_receipt->>'campaign_id'=qualification_id
      and sandbox_reclamation_receipt->>'run_id'=run_id::text
      and sandbox_reclamation_receipt->>'receipt_hash'=sandbox_reclamation_hash
      and sandbox_reclamation_hash=
        app_data_agent.u2_canonical_sha256(sandbox_reclamation_receipt-'receipt_hash')));

alter table app_data_agent.falcon24_acceptance_campaign_runs
  drop constraint falcon24_acceptance_campaign_runs_trace_gate_binding_check,
  drop constraint falcon24_acceptance_campaign_runs_ui_trace_gate_check,
  drop constraint falcon24_acceptance_campaign_runs_reclamation_binding_check,
  add constraint falcon24_campaign_run_trace_gate_binding_check check(
    trace_gate_receipt is null or (
      pg_catalog.jsonb_typeof(trace_gate_receipt)='object'
      and ((authority_epoch='E1'
          and trace_gate_receipt->>'schema_version'=
            'falcon24-resolution-trace-gate-receipt@2.0.0')
        or (authority_epoch<>'E1'
          and trace_gate_receipt->>'schema_version'=
            'falcon24-resolution-trace-gate-receipt@3.0.0'
          and trace_gate_receipt->>'authority_epoch'=authority_epoch))
      and trace_gate_receipt->>'campaign_id'=campaign_id
      and trace_gate_receipt->>'run_id'=run_id::text
      and trace_gate_receipt->>'trace_hash'=trace_closure_hash
      and trace_gate_receipt->>'receipt_hash'=trace_gate_receipt_hash
      and trace_gate_receipt_hash=
        app_data_agent.u2_canonical_sha256(trace_gate_receipt-'receipt_hash'))),
  add constraint falcon24_campaign_run_ui_trace_gate_check check(
    (ui_trace_gate_receipt_hash is null)=(ui_trace_gate_receipt is null)
    and (ui_trace_gate_receipt_hash is null
      or ui_trace_gate_receipt_hash~'^sha256:[0-9a-f]{64}$')
    and (ui_trace_gate_receipt is null or (
      trace_closure_hash is not null and trace_gate_receipt_hash is not null
      and trace_gate_receipt is not null
      and pg_catalog.jsonb_typeof(ui_trace_gate_receipt)='object'
      and ((authority_epoch='E1'
          and ui_trace_gate_receipt->>'schema_version'=
            'falcon24-resolution-trace-ui-gate-receipt@1.0.0')
        or (authority_epoch<>'E1'
          and ui_trace_gate_receipt->>'schema_version'=
            'falcon24-resolution-trace-ui-gate-receipt@2.0.0'
          and ui_trace_gate_receipt->>'authority_epoch'=authority_epoch))
      and ui_trace_gate_receipt->>'campaign_id'=campaign_id
      and ui_trace_gate_receipt->>'run_id'=run_id::text
      and ui_trace_gate_receipt->>'workspace_id'=tenant_id::text
      and ui_trace_gate_receipt->>'trace_hash'=trace_closure_hash
      and ui_trace_gate_receipt->>'receipt_hash'=ui_trace_gate_receipt_hash
      and ui_trace_gate_receipt_hash=
        app_data_agent.u2_canonical_sha256(ui_trace_gate_receipt-'receipt_hash')))
    and (sandbox_reclamation_claim_hash is null or ui_trace_gate_receipt is not null)
    and (sandbox_reclamation_hash is null or ui_trace_gate_receipt is not null)
    and (status<>'VERIFIED' or ui_trace_gate_receipt is not null)),
  add constraint falcon24_campaign_run_reclamation_binding_check check(
    sandbox_reclamation_receipt is null or (
      ((authority_epoch='E1'
          and sandbox_reclamation_receipt->>'schema_version'=
            'falcon24-sandbox-reclamation-receipt@2.0.0')
        or (authority_epoch<>'E1'
          and sandbox_reclamation_receipt->>'schema_version'=
            'falcon24-sandbox-reclamation-receipt@3.0.0'
          and sandbox_reclamation_receipt->>'authority_epoch'=authority_epoch))
      and sandbox_reclamation_receipt->>'campaign_id'=campaign_id
      and sandbox_reclamation_receipt->>'run_id'=run_id::text
      and sandbox_reclamation_receipt->>'receipt_hash'=sandbox_reclamation_hash
      and sandbox_reclamation_hash=
        app_data_agent.u2_canonical_sha256(sandbox_reclamation_receipt-'receipt_hash')));
create function app_data_agent.falcon24_archive_historical_gate_attempt(
  target_app_id uuid,target_tenant_id uuid,target_environment text,
  target_principal_id uuid,historical_epoch text)
returns void language plpgsql volatile security definer set search_path='' as $function$
declare qualification app_data_agent.falcon24_qualifications%rowtype;
  campaign app_data_agent.falcon24_acceptance_campaigns%rowtype; snapshots jsonb;
begin
  if app_data_agent.falcon24_authority_epoch_is_canonical(historical_epoch) is distinct from true
  then raise exception using errcode='22023',message='FALCON24_GATE_EPOCH_MISMATCH'; end if;
  select * into qualification from app_data_agent.falcon24_qualifications row
  where row.app_id=target_app_id and row.tenant_id=target_tenant_id
    and row.environment=target_environment and row.principal_id=target_principal_id
    and row.qualification_id=historical_epoch||'-Q1'
    and row.authority_epoch=historical_epoch and row.status='HOLD' for share;
  if found and not exists(select 1 from app_data_agent.falcon24_gate_attempt_history history
      where history.app_id=qualification.app_id and history.tenant_id=qualification.tenant_id
        and history.environment=qualification.environment
        and history.principal_id=qualification.principal_id
        and history.gate_kind='QUALIFICATION' and history.attempt_id=qualification.attempt_id) then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(slot)-'authority_epoch'
      order by slot.ordinal),'[]'::jsonb) into snapshots
    from app_data_agent.falcon24_qualification_slots slot
    where slot.app_id=qualification.app_id and slot.tenant_id=qualification.tenant_id
      and slot.environment=qualification.environment and slot.principal_id=qualification.principal_id
      and slot.qualification_id=qualification.qualification_id;
    insert into app_data_agent.falcon24_gate_attempt_history(
      app_id,tenant_id,environment,principal_id,gate_kind,gate_id,attempt_id,attempt_number,
      authority_epoch,authority_baseline_id,authority_baseline_hash,manifest_hash,status,
      parent_snapshot,slot_snapshots,archived_at)
    values(qualification.app_id,qualification.tenant_id,qualification.environment,
      qualification.principal_id,'QUALIFICATION',qualification.qualification_id,
      qualification.attempt_id,qualification.qualification_version,qualification.authority_epoch,
      qualification.authority_baseline_id,qualification.authority_baseline_hash,
      qualification.manifest_hash,'HOLD',pg_catalog.to_jsonb(qualification),snapshots,
      pg_catalog.clock_timestamp());
  end if;

  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
  where row.app_id=target_app_id and row.tenant_id=target_tenant_id
    and row.environment=target_environment and row.principal_id=target_principal_id
    and row.campaign_id=historical_epoch||'-C1'
    and row.authority_epoch=historical_epoch and row.status='HOLD' for share;
  if found and not exists(select 1 from app_data_agent.falcon24_gate_attempt_history history
      where history.app_id=campaign.app_id and history.tenant_id=campaign.tenant_id
        and history.environment=campaign.environment and history.principal_id=campaign.principal_id
        and history.gate_kind='CAMPAIGN' and history.attempt_id=campaign.attempt_id) then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(run)-'authority_epoch'
      order by run.run_ordinal),'[]'::jsonb) into snapshots
    from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=campaign.app_id and run.tenant_id=campaign.tenant_id
      and run.environment=campaign.environment and run.principal_id=campaign.principal_id
      and run.campaign_id=campaign.campaign_id;
    insert into app_data_agent.falcon24_gate_attempt_history(
      app_id,tenant_id,environment,principal_id,gate_kind,gate_id,attempt_id,attempt_number,
      authority_epoch,authority_baseline_id,authority_baseline_hash,manifest_hash,status,
      parent_snapshot,slot_snapshots,archived_at)
    values(campaign.app_id,campaign.tenant_id,campaign.environment,campaign.principal_id,
      'CAMPAIGN',campaign.campaign_id,campaign.attempt_id,campaign.campaign_version,
      campaign.authority_epoch,campaign.authority_baseline_id,campaign.authority_baseline_hash,
      campaign.manifest_hash,'HOLD',pg_catalog.to_jsonb(campaign),snapshots,
      pg_catalog.clock_timestamp());
  end if;
end
$function$;

create or replace function app_data_agent.begin_falcon24_qualification(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;current_epoch record;baseline record;
  existing app_data_agent.falcon24_qualifications%rowtype;manifest jsonb;
  now_at timestamptz;requested_epoch text;requested_gate_id text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','manifest','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-qualification-begin@2.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'manifest') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_COMMAND_INVALID'; end if;
  manifest:=command->'manifest';requested_epoch:=manifest->>'authority_epoch';
  requested_gate_id:=requested_epoch||'-Q1';
  if app_data_agent.provider_json_object_has_exact_keys(manifest,array[
      'schema_version','authority_epoch','qualification_id','attempt_id','authority_baseline_hash',
      'source_commit','source_fingerprint','frozen_contract_hash','semantic_release_hash',
      'schema_snapshot_hash','operator_registry_digest','model_config_hash','web_build_hash',
      'runtime_attestation_hash','model_provider','model_id','slots','manifest_hash']::text[])
      is distinct from true
    or manifest->>'schema_version' is distinct from 'falcon24-qualification-manifest@2.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(requested_epoch) is distinct from true
    or requested_epoch='E1'
    or manifest->>'qualification_id' is distinct from requested_gate_id
    or app_data_agent.canonical_uuid_json_string_is_valid(manifest->'attempt_id') is distinct from true
    or manifest->>'manifest_hash' is distinct from
      app_data_agent.u2_canonical_sha256(manifest-'manifest_hash')
    or manifest->>'source_commit'!~'^[0-9a-f]{40}$'
    or exists(select 1 from pg_catalog.unnest(array[
      'authority_baseline_hash','source_fingerprint','frozen_contract_hash',
      'semantic_release_hash','schema_snapshot_hash','operator_registry_digest',
      'model_config_hash','web_build_hash','runtime_attestation_hash','manifest_hash']::text[]) hash_key
      where pg_catalog.jsonb_typeof(manifest->hash_key) is distinct from 'string'
        or manifest->>hash_key!~'^sha256:[0-9a-f]{64}$')
    or manifest->>'model_provider' is distinct from 'deepseek'
    or pg_catalog.jsonb_typeof(manifest->'model_id') is distinct from 'string'
    or manifest->>'model_id'!~'^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
    or pg_catalog.jsonb_typeof(manifest->'slots') is distinct from 'array'
    or pg_catalog.jsonb_array_length(manifest->'slots')<>16
    or exists(
      with entries as (
        select item,(ordinality-1)::integer ordinal
        from pg_catalog.jsonb_array_elements(manifest->'slots')
          with ordinality entry(item,ordinality)), expected as (
        select entries.*,
          case when ordinal=0 then 'G1' when ordinal<=5 then 'G2'
            when ordinal<=10 then 'G3' else 'G4' end expected_stage,
          case when ordinal=0 then 0 when ordinal<=5 then ordinal-1
            when ordinal<=10 then ordinal-6 else ordinal-11 end case_index
        from entries)
      select 1 from expected where
        pg_catalog.jsonb_typeof(item) is distinct from 'object'
        or app_data_agent.provider_json_object_has_exact_keys(item,array[
          'ordinal','run_id','slot_id','stage','case_id','prompt','prompt_hash',
          'run_variant','expected_path']::text[]) is distinct from true
        or pg_catalog.jsonb_typeof(item->'ordinal') is distinct from 'number'
        or item->>'ordinal'!~'^(0|[1-9][0-9]*)$'
        or (item->>'ordinal')::integer<>ordinal
        or app_data_agent.canonical_uuid_json_string_is_valid(item->'run_id') is distinct from true
        or item->>'slot_id' is distinct from
          expected_stage||'-'||pg_catalog.lpad((case_index+1)::text,2,'0')
        or item->>'stage' is distinct from expected_stage
        or item->>'case_id' is distinct from (array[
          'falcon24-business-review-18m','falcon24-delivery-experience-12m',
          'falcon24-inventory-damage-12m','falcon24-marketing-lag-effect',
          'falcon24-cohort-retention-m0-m6']::text[])[case_index+1]
        or pg_catalog.jsonb_typeof(item->'prompt') is distinct from 'string'
        or pg_catalog.length(item->>'prompt') not between 1 and 8000
        or pg_catalog.length(pg_catalog.btrim(item->>'prompt'))=0
        or item->>'prompt_hash' is distinct from
          app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb(item->>'prompt'))
        or item->>'run_variant' is distinct from
          case when expected_stage='G4' then 'COLD' else 'WARM' end
        or item->'expected_path' is distinct from
          '["ROOT_ROUTING","SQL_DATA_PREPARATION","GOVERNED_OPERATOR","ORACLE","PUBLISHER","SANDBOX_RECLAMATION"]'::jsonb)
    or (select pg_catalog.count(distinct item->>'run_id')
      from pg_catalog.jsonb_array_elements(manifest->'slots') item)<>16
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_MANIFEST_INVALID'; end if;

  select * into strict authority from platform.current_backend_authority(true);
  select current_authority.authority_epoch,current_authority.baseline_id,
    current_authority.baseline_hash,current_authority.activation_attempt_id
    into strict current_epoch
  from app_data_agent.falcon24_current_authority_epoch current_authority
  where current_authority.app_id=authority.app_id
    and current_authority.tenant_id=authority.tenant_id
    and current_authority.environment=authority.environment for share;
  if current_epoch.authority_epoch<>requested_epoch
  then raise exception using errcode='55000',message='FALCON24_GATE_EPOCH_MISMATCH'; end if;
  select authority_baseline.source_commit,authority_baseline.web_build_hash,
    authority_baseline.status into strict baseline
  from app_data_agent.falcon24_authority_baselines authority_baseline
  where authority_baseline.app_id=authority.app_id
    and authority_baseline.tenant_id=authority.tenant_id
    and authority_baseline.environment=authority.environment
    and authority_baseline.baseline_id=current_epoch.baseline_id
    and authority_baseline.baseline_hash=current_epoch.baseline_hash
    and authority_baseline.authority_epoch=requested_epoch for share;
  if current_epoch.baseline_hash<>manifest->>'authority_baseline_hash'
    or baseline.status<>'ACTIVE' or baseline.source_commit<>manifest->>'source_commit'
    or baseline.web_build_hash<>manifest->>'web_build_hash'
  then raise exception using errcode='55000',message='FALCON24_GATE_BASELINE_MISMATCH'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:'||requested_gate_id||':'||authority.app_id::text||':'||authority.tenant_id::text||':'||
    authority.environment||':'||authority.principal_id::text,0));
  perform app_data_agent.falcon24_archive_historical_gate_attempt(
    authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,'E1');
  if exists(select 1 from app_data_agent.falcon24_gate_attempt_history history
    where history.app_id=authority.app_id and history.tenant_id=authority.tenant_id
      and history.environment=authority.environment and history.principal_id=authority.principal_id
      and history.gate_kind='QUALIFICATION'
      and history.attempt_id=(manifest->>'attempt_id')::uuid)
  then raise exception using errcode='55000',message='FALCON24_GATE_ATTEMPT_IMMUTABLE'; end if;
  select * into existing from app_data_agent.falcon24_qualifications row
  where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
    and row.environment=authority.environment and row.principal_id=authority.principal_id
    and row.qualification_id=requested_gate_id for update;
  if found then
    if existing.attempt_id=(manifest->>'attempt_id')::uuid
      and existing.manifest_hash=manifest->>'manifest_hash'
    then return pg_catalog.to_jsonb(existing); end if;
    raise exception using errcode='55000',message='FALCON24_GATE_ATTEMPT_IMMUTABLE';
  end if;
  now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.falcon24_qualifications(
    app_id,tenant_id,environment,principal_id,qualification_id,qualification_version,attempt_id,
    source_commit,source_fingerprint,frozen_contract_hash,semantic_release_hash,
    schema_snapshot_hash,operator_registry_digest,model_config_hash,web_build_hash,
    runtime_attestation_hash,model_provider,model_id,manifest_hash,slot_count,
    next_slot_ordinal,status,created_at,updated_at)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    requested_gate_id,1,(manifest->>'attempt_id')::uuid,manifest->>'source_commit',
    manifest->>'source_fingerprint',manifest->>'frozen_contract_hash',
    manifest->>'semantic_release_hash',manifest->>'schema_snapshot_hash',
    manifest->>'operator_registry_digest',manifest->>'model_config_hash',
    manifest->>'web_build_hash',manifest->>'runtime_attestation_hash',
    manifest->>'model_provider',manifest->>'model_id',manifest->>'manifest_hash',16,0,'READY',
    now_at,now_at) returning * into strict existing;
  insert into app_data_agent.falcon24_qualification_slots(
    app_id,tenant_id,environment,principal_id,qualification_id,authority_epoch,ordinal,
    run_id,slot_id,stage,case_id,prompt,prompt_hash,run_variant,expected_path,status)
  select authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    requested_gate_id,requested_epoch,(entry.ordinality-1)::integer,(entry.item->>'run_id')::uuid,
    entry.item->>'slot_id',entry.item->>'stage',entry.item->>'case_id',entry.item->>'prompt',
    entry.item->>'prompt_hash',entry.item->>'run_variant',entry.item->'expected_path','PLANNED'
  from pg_catalog.jsonb_array_elements(manifest->'slots') with ordinality entry(item,ordinality);
  return pg_catalog.to_jsonb(existing);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_BEGIN_INVALID';
end
$function$;

create or replace function app_data_agent.begin_falcon24_acceptance_campaign(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;current_epoch record;
  existing app_data_agent.falcon24_acceptance_campaigns%rowtype;
  winning app_data_agent.falcon24_qualifications%rowtype;
  manifest jsonb;now_at timestamptz;requested_epoch text;requested_gate_id text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','manifest','policy_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-acceptance-campaign-begin@2.0.0'
    or command->>'policy_id' is distinct from 'falcon24-strict-zero-retry@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'manifest') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_CAMPAIGN_COMMAND_INVALID'; end if;
  manifest:=command->'manifest';requested_epoch:=manifest->>'authority_epoch';
  requested_gate_id:=requested_epoch||'-C1';
  if app_data_agent.provider_json_object_has_exact_keys(manifest,array[
      'schema_version','authority_epoch','campaign_id','attempt_id',
      'winning_qualification_attempt_id','authority_baseline_hash','source_fingerprint',
      'frozen_contract_hash','runtime_attestation_hash','runs','manifest_hash']::text[])
      is distinct from true
    or manifest->>'schema_version' is distinct from 'falcon24-analysis-run-manifest@3.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(requested_epoch) is distinct from true
    or requested_epoch='E1' or manifest->>'campaign_id' is distinct from requested_gate_id
    or app_data_agent.canonical_uuid_json_string_is_valid(manifest->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      manifest->'winning_qualification_attempt_id') is distinct from true
    or manifest->>'manifest_hash' is distinct from
      app_data_agent.u2_canonical_sha256(manifest-'manifest_hash')
    or exists(select 1 from pg_catalog.unnest(array[
      'authority_baseline_hash','source_fingerprint','frozen_contract_hash',
      'runtime_attestation_hash','manifest_hash']::text[]) hash_key
      where pg_catalog.jsonb_typeof(manifest->hash_key) is distinct from 'string'
        or manifest->>hash_key!~'^sha256:[0-9a-f]{64}$')
    or pg_catalog.jsonb_typeof(manifest->'runs') is distinct from 'array'
    or pg_catalog.jsonb_array_length(manifest->'runs')<>30
    or exists(
      with entries as (
        select item,(ordinality-1)::integer ordinal
        from pg_catalog.jsonb_array_elements(manifest->'runs')
          with ordinality entry(item,ordinality))
      select 1 from entries where
        pg_catalog.jsonb_typeof(item) is distinct from 'object'
        or app_data_agent.provider_json_object_has_exact_keys(item,array[
          'run_id','case_id','run_variant','repetition']::text[]) is distinct from true
        or app_data_agent.canonical_uuid_json_string_is_valid(item->'run_id') is distinct from true
        or item->>'case_id' is distinct from (array[
          'falcon24-business-review-18m','falcon24-delivery-experience-12m',
          'falcon24-inventory-damage-12m','falcon24-marketing-lag-effect',
          'falcon24-cohort-retention-m0-m6']::text[])[(ordinal/6)+1]
        or item->>'run_variant' is distinct from
          case when ordinal%6<3 then 'COLD' else 'WARM' end
        or item->>'repetition' is distinct from ((ordinal%3)+1)::text)
    or (select pg_catalog.count(distinct item->>'run_id')
      from pg_catalog.jsonb_array_elements(manifest->'runs') item)<>30
  then raise exception using errcode='22023',message='FALCON24_CAMPAIGN_MANIFEST_INVALID'; end if;

  select * into strict authority from platform.current_backend_authority(true);
  select current_authority.authority_epoch,current_authority.baseline_id,
    current_authority.baseline_hash into strict current_epoch
  from app_data_agent.falcon24_current_authority_epoch current_authority
  where current_authority.app_id=authority.app_id
    and current_authority.tenant_id=authority.tenant_id
    and current_authority.environment=authority.environment for share;
  if current_epoch.authority_epoch<>requested_epoch
  then raise exception using errcode='55000',message='FALCON24_GATE_EPOCH_MISMATCH'; end if;
  if current_epoch.baseline_hash<>manifest->>'authority_baseline_hash'
  then raise exception using errcode='55000',message='FALCON24_GATE_BASELINE_MISMATCH'; end if;
  select * into winning from app_data_agent.falcon24_qualifications row
  where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
    and row.environment=authority.environment and row.principal_id=authority.principal_id
    and row.qualification_id=requested_epoch||'-Q1'
    and row.authority_epoch=requested_epoch for share;
  if not found or winning.status<>'PASSED' or winning.next_slot_ordinal<>16
    or winning.attempt_id<>(manifest->>'winning_qualification_attempt_id')::uuid
    or current_epoch.authority_epoch<>winning.authority_epoch
    or winning.authority_baseline_id<>current_epoch.baseline_id
    or winning.authority_baseline_hash<>current_epoch.baseline_hash
    or winning.source_fingerprint<>manifest->>'source_fingerprint'
    or winning.frozen_contract_hash<>manifest->>'frozen_contract_hash'
    or winning.runtime_attestation_hash<>manifest->>'runtime_attestation_hash'
  then raise exception using errcode='55000',message='FALCON24_WINNING_QUALIFICATION_REQUIRED'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:'||requested_gate_id||':'||authority.app_id::text||':'||authority.tenant_id::text||':'||
    authority.environment||':'||authority.principal_id::text,0));
  if exists(select 1 from app_data_agent.falcon24_gate_attempt_history history
    where history.app_id=authority.app_id and history.tenant_id=authority.tenant_id
      and history.environment=authority.environment and history.principal_id=authority.principal_id
      and history.gate_kind='CAMPAIGN' and history.attempt_id=(manifest->>'attempt_id')::uuid)
  then raise exception using errcode='55000',message='FALCON24_GATE_ATTEMPT_IMMUTABLE'; end if;
  select * into existing from app_data_agent.falcon24_acceptance_campaigns row
  where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
    and row.environment=authority.environment and row.principal_id=authority.principal_id
    and row.campaign_id=requested_gate_id for update;
  if found then
    if existing.attempt_id=(manifest->>'attempt_id')::uuid
      and existing.manifest_hash=manifest->>'manifest_hash'
    then return pg_catalog.to_jsonb(existing); end if;
    raise exception using errcode='55000',message='FALCON24_GATE_ATTEMPT_IMMUTABLE';
  end if;
  now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.falcon24_acceptance_campaigns(
    app_id,tenant_id,environment,principal_id,campaign_id,campaign_version,attempt_id,
    winning_qualification_attempt_id,source_fingerprint,frozen_contract_hash,
    runtime_attestation_hash,manifest_hash,policy_id,run_count,next_run_ordinal,status,
    created_at,updated_at)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    requested_gate_id,1,(manifest->>'attempt_id')::uuid,
    (manifest->>'winning_qualification_attempt_id')::uuid,manifest->>'source_fingerprint',
    manifest->>'frozen_contract_hash',manifest->>'runtime_attestation_hash',
    manifest->>'manifest_hash','falcon24-strict-zero-retry@1.0.0',30,0,'READY',now_at,now_at)
  returning * into strict existing;
  insert into app_data_agent.falcon24_acceptance_campaign_runs(
    app_id,tenant_id,environment,principal_id,campaign_id,authority_epoch,run_ordinal,
    run_id,case_id,run_variant,repetition,status,claimed_at)
  select authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    requested_gate_id,requested_epoch,(entry.ordinality-1)::integer,
    (entry.item->>'run_id')::uuid,entry.item->>'case_id',entry.item->>'run_variant',
    (entry.item->>'repetition')::integer,'PLANNED',null
  from pg_catalog.jsonb_array_elements(manifest->'runs') with ordinality entry(item,ordinality);
  return pg_catalog.to_jsonb(existing);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_CAMPAIGN_COMMAND_INVALID';
end
$function$;
do $generalize_campaign_identity_validators$
declare function_row record;function_definition text;rewritten_definition text;
  rewritten_count integer:=0;
begin
  for function_row in
    select procedure.oid
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='app_data_agent'
      and procedure.prosrc like '%is distinct from ''E1-C1''%'
  loop
    function_definition:=pg_catalog.pg_get_functiondef(function_row.oid);
    rewritten_definition:=pg_catalog.replace(function_definition,
      $$command->>'campaign_id' is distinct from 'E1-C1'$$,
      $$command->>'campaign_id'!~'^E[1-9][0-9]*-C1$'$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$submit_fence_command->>'campaign_id' is distinct from 'E1-C1'$$,
      $$submit_fence_command->>'campaign_id'!~'^E[1-9][0-9]*-C1$'$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$manifest->>'campaign_id' is distinct from 'E1-C1'$$,
      $$manifest->>'campaign_id'!~'^E[1-9][0-9]*-C1$'$$);
    if rewritten_definition=function_definition then
      raise exception using errcode='P0001',
        message='FALCON24_CAMPAIGN_VALIDATOR_REWRITE_MISSED'; end if;
    execute rewritten_definition;rewritten_count:=rewritten_count+1;
  end loop;
  if rewritten_count<>13 then raise exception using errcode='P0001',
    message='FALCON24_CAMPAIGN_VALIDATOR_INVENTORY_DRIFT',
    detail=pg_catalog.jsonb_build_object('observed',rewritten_count)::text; end if;
end
$generalize_campaign_identity_validators$;

do $generalize_gate_receipt_validators$
declare signature regprocedure;function_definition text;rewritten_definition text;
begin
  foreach signature in array array[
    'app_data_agent.stage_falcon24_acceptance_trace(jsonb)'::regprocedure,
    'app_data_agent.stage_falcon24_acceptance_ui_trace(jsonb)'::regprocedure,
    'app_data_agent.record_falcon24_sandbox_reclamation(jsonb)'::regprocedure,
    'app_data_agent.stage_falcon24_qualification_trace(jsonb)'::regprocedure,
    'app_data_agent.stage_falcon24_qualification_ui_trace(jsonb)'::regprocedure
  ]::regprocedure[] loop
    function_definition:=pg_catalog.pg_get_functiondef(signature);
    rewritten_definition:=pg_catalog.replace(function_definition,
      $$provider_json_object_has_exact_keys(receipt,array[
      'schema_version','campaign_id'$$,
      $$provider_json_object_has_exact_keys(receipt,array[
      'schema_version','authority_epoch','campaign_id'$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      'falcon24-resolution-trace-gate-receipt@2.0.0',
      'falcon24-resolution-trace-gate-receipt@3.0.0');
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      'falcon24-resolution-trace-ui-gate-receipt@1.0.0',
      'falcon24-resolution-trace-ui-gate-receipt@2.0.0');
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      'falcon24-sandbox-reclamation-receipt@2.0.0',
      'falcon24-sandbox-reclamation-receipt@3.0.0');
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$or receipt->>'campaign_id' is distinct from command->>'campaign_id'$$,
      $$or receipt->>'campaign_id' is distinct from command->>'campaign_id'
    or receipt->>'authority_epoch' is distinct from
      pg_catalog.split_part(command->>'campaign_id','-',1)$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$or receipt->>'campaign_id' is distinct from command->>'qualification_id'$$,
      $$or receipt->>'campaign_id' is distinct from command->>'qualification_id'
    or receipt->>'authority_epoch' is distinct from
      pg_catalog.split_part(command->>'qualification_id','-',1)$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$'schema_version','campaign_id','run_id','runtime_attestation_hash',
        'management_observation_hash','receipt_hash'$$,
      $$'schema_version','authority_epoch','campaign_id','run_id','runtime_attestation_hash',
        'management_observation_hash','receipt_hash'$$);
    if rewritten_definition=function_definition then
      raise exception using errcode='P0001',
        message='FALCON24_GATE_RECEIPT_VALIDATOR_REWRITE_MISSED'; end if;
    execute rewritten_definition;
  end loop;
end
$generalize_gate_receipt_validators$;

create or replace function app_data_agent.falcon24_qualification_reclamation_receipt_valid(
  receipt jsonb,qualification_id text,requested_run_id uuid,
  runtime_attestation_hash text,expected_receipt_hash text)
returns boolean language plpgsql immutable security definer set search_path='' as $function$
declare authority_epoch text:=pg_catalog.split_part(qualification_id,'-',1);
begin
  return receipt is not null and pg_catalog.jsonb_typeof(receipt)='object'
    and authority_epoch<>'E1'
    and app_data_agent.falcon24_authority_epoch_is_canonical(authority_epoch)
    and app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','authority_epoch','campaign_id','run_id','runtime_attestation_hash',
      'management_observation_schema_version','management_operation_id','observation_source',
      'target_metadata_hash','before_observation','killed','after_observation','residual',
      'completed_at','management_observation_hash','receipt_hash']::text[]) is true
    and receipt->>'schema_version'='falcon24-sandbox-reclamation-receipt@3.0.0'
    and receipt->>'authority_epoch'=authority_epoch
    and receipt->>'campaign_id'=qualification_id
    and receipt->>'run_id'=requested_run_id::text
    and receipt->>'runtime_attestation_hash'=runtime_attestation_hash
    and receipt->>'management_observation_schema_version'=
      'opensandbox-management-reclamation-observation@1.0.0'
    and pg_catalog.jsonb_typeof(receipt->'management_operation_id')='string'
    and (receipt->>'management_operation_id')::uuid is not null
    and receipt->>'observation_source'='OPENSANDBOX_MANAGEMENT_API'
    and receipt->>'target_metadata_hash'~'^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(receipt->'before_observation')='object'
    and app_data_agent.provider_json_object_has_exact_keys(
      receipt->'before_observation',array['active_count','observation_hash']::text[]) is true
    and receipt#>>'{before_observation,active_count}'~'^(0|[1-9][0-9]*)$'
    and receipt#>>'{before_observation,observation_hash}'~'^sha256:[0-9a-f]{64}$'
    and receipt->>'killed'=receipt#>>'{before_observation,active_count}'
    and pg_catalog.jsonb_typeof(receipt->'after_observation')='object'
    and app_data_agent.provider_json_object_has_exact_keys(
      receipt->'after_observation',array['active_count','observation_hash']::text[]) is true
    and receipt#>>'{after_observation,active_count}'='0'
    and receipt#>>'{after_observation,observation_hash}'~'^sha256:[0-9a-f]{64}$'
    and receipt->>'residual'='0'
    and (receipt->>'completed_at')::timestamptz is not null
    and receipt->>'management_observation_hash'=
      app_data_agent.u2_canonical_sha256(receipt-array[
        'schema_version','authority_epoch','campaign_id','run_id','runtime_attestation_hash',
        'management_observation_hash','receipt_hash']::text[])
    and receipt->>'receipt_hash'=expected_receipt_hash
    and receipt->>'receipt_hash'=app_data_agent.u2_canonical_sha256(receipt-'receipt_hash');
exception when invalid_text_representation or numeric_value_out_of_range
  or invalid_datetime_format or datetime_field_overflow then return false;
end
$function$;

create function app_data_agent.falcon24_gate_current_authority_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
begin
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
  where row.app_id=old.app_id and row.tenant_id=old.tenant_id
    and row.environment=old.environment for share;
  if not found or old.authority_epoch<>current_epoch.authority_epoch
    or old.authority_baseline_id<>current_epoch.baseline_id
    or old.authority_baseline_hash<>current_epoch.baseline_hash
    or old.authority_activation_attempt_id<>current_epoch.activation_attempt_id
  then raise exception using errcode='55000',message='FALCON24_GATE_EPOCH_MISMATCH'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_qualification_slot_attempt_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare expected_attempt_id uuid;parent record;current_epoch record;
begin
  select qualification.attempt_id,qualification.authority_epoch,
    qualification.authority_baseline_id,qualification.authority_baseline_hash,
    qualification.authority_activation_attempt_id into parent
  from app_data_agent.falcon24_qualifications qualification
  where qualification.app_id=new.app_id and qualification.tenant_id=new.tenant_id
    and qualification.environment=new.environment and qualification.principal_id=new.principal_id
    and qualification.qualification_id=new.qualification_id;
  select row.authority_epoch,row.baseline_id,row.baseline_hash,row.activation_attempt_id
    into current_epoch from app_data_agent.falcon24_current_authority_epoch row
  where row.app_id=new.app_id and row.tenant_id=new.tenant_id
    and row.environment=new.environment;
  if new.authority_epoch is distinct from old.authority_epoch
    or parent.authority_epoch is distinct from new.authority_epoch
    or current_epoch.authority_epoch is distinct from parent.authority_epoch
    or current_epoch.baseline_id is distinct from parent.authority_baseline_id
    or current_epoch.baseline_hash is distinct from parent.authority_baseline_hash
    or current_epoch.activation_attempt_id is distinct from parent.authority_activation_attempt_id
  then raise exception using errcode='55000',message='FALCON24_GATE_EPOCH_MISMATCH'; end if;
  if old.claim_fence_consumed_at is null and new.claim_fence_consumed_at is not null then
    begin expected_attempt_id:=pg_catalog.current_setting(
      'data_agent.falcon24_gate_attempt_id',true)::uuid;
    exception when invalid_text_representation then
      raise exception using errcode='22023',message='FALCON24_GATE_ATTEMPT_FENCE_INVALID'; end;
    if expected_attempt_id is null or expected_attempt_id is distinct from parent.attempt_id
    then raise exception using errcode='55000',message='FALCON24_GATE_ATTEMPT_MISMATCH'; end if;
  end if;
  if old.status<>'VERIFIED' and new.status='VERIFIED' and not exists(
    select 1 from app_data_agent.falcon24_ui_receipts qa_receipt
    join app_data_agent.falcon24_ui_receipts trace_receipt
      on trace_receipt.app_id=qa_receipt.app_id and trace_receipt.tenant_id=qa_receipt.tenant_id
      and trace_receipt.environment=qa_receipt.environment and trace_receipt.run_id=qa_receipt.run_id
      and trace_receipt.viewport_width=qa_receipt.viewport_width
      and trace_receipt.receipt_kind='TRACE_UI'
      and trace_receipt.authority_epoch=qa_receipt.authority_epoch
      and trace_receipt.baseline_id=qa_receipt.baseline_id
      and trace_receipt.baseline_hash=qa_receipt.baseline_hash
      and trace_receipt.activation_attempt_id=qa_receipt.activation_attempt_id
    where qa_receipt.app_id=new.app_id and qa_receipt.tenant_id=new.tenant_id
      and qa_receipt.environment=new.environment and qa_receipt.run_id=new.run_id
      and qa_receipt.receipt_kind='QA_E2E' and qa_receipt.authority_epoch=parent.authority_epoch
      and qa_receipt.baseline_id=parent.authority_baseline_id
      and qa_receipt.baseline_hash=parent.authority_baseline_hash
      and qa_receipt.activation_attempt_id=parent.authority_activation_attempt_id)
  then raise exception using errcode='55000',message='FALCON24_UI_RECEIPT_PAIR_REQUIRED'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_campaign_run_attempt_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare expected_attempt_id uuid;parent record;current_epoch record;
begin
  select campaign.attempt_id,campaign.authority_epoch,campaign.authority_baseline_id,
    campaign.authority_baseline_hash,campaign.authority_activation_attempt_id into parent
  from app_data_agent.falcon24_acceptance_campaigns campaign
  where campaign.app_id=new.app_id and campaign.tenant_id=new.tenant_id
    and campaign.environment=new.environment and campaign.principal_id=new.principal_id
    and campaign.campaign_id=new.campaign_id;
  select row.authority_epoch,row.baseline_id,row.baseline_hash,row.activation_attempt_id
    into current_epoch from app_data_agent.falcon24_current_authority_epoch row
  where row.app_id=new.app_id and row.tenant_id=new.tenant_id and row.environment=new.environment;
  if new.authority_epoch is distinct from old.authority_epoch
    or parent.authority_epoch is distinct from new.authority_epoch
    or current_epoch.authority_epoch is distinct from parent.authority_epoch
    or current_epoch.baseline_id is distinct from parent.authority_baseline_id
    or current_epoch.baseline_hash is distinct from parent.authority_baseline_hash
    or current_epoch.activation_attempt_id is distinct from parent.authority_activation_attempt_id
  then raise exception using errcode='55000',message='FALCON24_GATE_EPOCH_MISMATCH'; end if;
  if old.claim_fence_consumed_at is null and new.claim_fence_consumed_at is not null then
    begin expected_attempt_id:=pg_catalog.current_setting(
      'data_agent.falcon24_gate_attempt_id',true)::uuid;
    exception when invalid_text_representation then
      raise exception using errcode='22023',message='FALCON24_GATE_ATTEMPT_FENCE_INVALID'; end;
    if expected_attempt_id is null or expected_attempt_id is distinct from parent.attempt_id
    then raise exception using errcode='55000',message='FALCON24_GATE_ATTEMPT_MISMATCH'; end if;
  end if;
  if old.status<>'VERIFIED' and new.status='VERIFIED' and not exists(
    select 1 from app_data_agent.falcon24_ui_receipts qa_receipt
    join app_data_agent.falcon24_ui_receipts trace_receipt
      on trace_receipt.app_id=qa_receipt.app_id and trace_receipt.tenant_id=qa_receipt.tenant_id
      and trace_receipt.environment=qa_receipt.environment and trace_receipt.run_id=qa_receipt.run_id
      and trace_receipt.viewport_width=qa_receipt.viewport_width
      and trace_receipt.receipt_kind='TRACE_UI'
      and trace_receipt.authority_epoch=qa_receipt.authority_epoch
      and trace_receipt.baseline_id=qa_receipt.baseline_id
      and trace_receipt.baseline_hash=qa_receipt.baseline_hash
      and trace_receipt.activation_attempt_id=qa_receipt.activation_attempt_id
    where qa_receipt.app_id=new.app_id and qa_receipt.tenant_id=new.tenant_id
      and qa_receipt.environment=new.environment and qa_receipt.run_id=new.run_id
      and qa_receipt.receipt_kind='QA_E2E' and qa_receipt.authority_epoch=parent.authority_epoch
      and qa_receipt.baseline_id=parent.authority_baseline_id
      and qa_receipt.baseline_hash=parent.authority_baseline_hash
      and qa_receipt.activation_attempt_id=parent.authority_activation_attempt_id)
  then raise exception using errcode='55000',message='FALCON24_UI_RECEIPT_PAIR_REQUIRED'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_gate_attempt_history_immutable()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  raise exception using errcode='55000',message='FALCON24_GATE_ATTEMPT_IMMUTABLE';
end
$function$;

drop trigger falcon24_e1_gate_attempt_history_immutable
  on app_data_agent.falcon24_gate_attempt_history;

create trigger falcon24_000_qualification_slot_attempt_fence
before update on app_data_agent.falcon24_qualification_slots
for each row execute function app_data_agent.falcon24_qualification_slot_attempt_fence();
create trigger falcon24_000_campaign_run_attempt_fence
before update on app_data_agent.falcon24_acceptance_campaign_runs
for each row execute function app_data_agent.falcon24_campaign_run_attempt_fence();
create trigger falcon24_000_qualification_current_authority_fence
before update on app_data_agent.falcon24_qualifications
for each row execute function app_data_agent.falcon24_gate_current_authority_fence();
create trigger falcon24_000_campaign_current_authority_fence
before update on app_data_agent.falcon24_acceptance_campaigns
for each row execute function app_data_agent.falcon24_gate_current_authority_fence();
create trigger falcon24_gate_attempt_history_immutable
before update or delete on app_data_agent.falcon24_gate_attempt_history
for each row execute function app_data_agent.falcon24_gate_attempt_history_immutable();
alter function app_data_agent.falcon24_authority_epoch_is_canonical(text)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_authority_binding_document(
  app_data_agent.falcon24_current_authority_epoch) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_activation_attempt_document(
  app_data_agent.falcon24_authority_activation_attempts) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_authority_staging_session(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_falcon24_authority_staging_receipt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.stage_falcon24_authority_baseline(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_authority_activation_attempt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.hold_falcon24_authority_activation_attempt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_authority(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_falcon24_ui_receipt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_ui_receipts(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_archive_historical_gate_attempt(
  uuid,uuid,text,uuid,text) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_gate_current_authority_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_qualification_slot_attempt_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_campaign_run_attempt_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_gate_attempt_history_immutable()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_authority_staging_session_state_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_authority_activation_attempt_state_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_authority_baseline_state_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_current_authority_successor_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_bind_current_authority()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_bind_artifact_to_run()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_binding_immutable()
  owner to data_agent_u6_rpc_owner;

revoke all on table
  app_data_agent.falcon24_authority_staging_sessions,
  app_data_agent.falcon24_authority_staging_receipts,
  app_data_agent.falcon24_authority_baselines,
  app_data_agent.falcon24_authority_activation_attempts,
  app_data_agent.falcon24_current_authority_epoch,
  app_data_agent.falcon24_ui_receipts,
  app_data_agent.falcon24_gate_attempt_history,
  app_data_agent.falcon24_analysis_publications,
  app_data_agent.falcon24_analysis_publication_artifacts,
  app_data_agent.falcon24_analysis_publication_current,
  app_data_agent.falcon24_analysis_publication_outbox from public,data_agent_backend;

grant select,insert,update on table
  app_data_agent.falcon24_authority_staging_sessions,
  app_data_agent.falcon24_authority_staging_receipts,
  app_data_agent.falcon24_authority_baselines,
  app_data_agent.falcon24_authority_activation_attempts,
  app_data_agent.falcon24_current_authority_epoch,
  app_data_agent.falcon24_ui_receipts,
  app_data_agent.falcon24_gate_attempt_history,
  app_data_agent.falcon24_analysis_publications,
  app_data_agent.falcon24_analysis_publication_artifacts,
  app_data_agent.falcon24_analysis_publication_current,
  app_data_agent.falcon24_analysis_publication_outbox to data_agent_u6_rpc_owner;

revoke all on function
  app_data_agent.begin_falcon24_authority_staging_session(jsonb),
  app_data_agent.record_falcon24_authority_staging_receipt(jsonb),
  app_data_agent.stage_falcon24_authority_baseline(jsonb),
  app_data_agent.begin_falcon24_authority_activation_attempt(jsonb),
  app_data_agent.hold_falcon24_authority_activation_attempt(jsonb),
  app_data_agent.activate_falcon24_authority(jsonb),
  app_data_agent.load_falcon24_current_authority_epoch(),
  app_data_agent.load_falcon24_run_authority_binding(jsonb),
  app_data_agent.commit_falcon24_ui_receipt(jsonb),
  app_data_agent.load_falcon24_ui_receipts(jsonb) from public;
grant execute on function
  app_data_agent.begin_falcon24_authority_staging_session(jsonb),
  app_data_agent.record_falcon24_authority_staging_receipt(jsonb),
  app_data_agent.stage_falcon24_authority_baseline(jsonb),
  app_data_agent.begin_falcon24_authority_activation_attempt(jsonb),
  app_data_agent.hold_falcon24_authority_activation_attempt(jsonb),
  app_data_agent.activate_falcon24_authority(jsonb),
  app_data_agent.load_falcon24_current_authority_epoch(),
  app_data_agent.load_falcon24_run_authority_binding(jsonb),
  app_data_agent.commit_falcon24_ui_receipt(jsonb),
  app_data_agent.load_falcon24_ui_receipts(jsonb) to data_agent_backend;

revoke execute on function app_data_agent.begin_falcon24_e1_staging_session(jsonb)
  from public,data_agent_backend;
revoke execute on function app_data_agent.record_falcon24_e1_staging_receipt(jsonb)
  from public,data_agent_backend;
revoke execute on function app_data_agent.stage_falcon24_e1_authority_baseline(jsonb)
  from public,data_agent_backend;
revoke execute on function app_data_agent.begin_falcon24_e1_activation_attempt(jsonb)
  from public,data_agent_backend;
revoke execute on function app_data_agent.hold_falcon24_e1_activation_attempt(jsonb)
  from public,data_agent_backend;
revoke execute on function app_data_agent.activate_falcon24_e1_authority(jsonb)
  from public,data_agent_backend;
revoke execute on function app_data_agent.commit_falcon24_e1_ui_receipt(jsonb)
  from public,data_agent_backend;
revoke execute on function app_data_agent.commit_e1_analysis_publication(jsonb)
  from public,data_agent_backend;

revoke all on function
  app_data_agent.falcon24_authority_staging_session_state_fence(),
  app_data_agent.falcon24_authority_activation_attempt_state_fence(),
  app_data_agent.falcon24_authority_baseline_state_fence(),
  app_data_agent.falcon24_current_authority_successor_fence(),
  app_data_agent.falcon24_bind_current_authority(),
  app_data_agent.falcon24_bind_artifact_to_run(),
  app_data_agent.falcon24_binding_immutable(),
  app_data_agent.falcon24_archive_historical_gate_attempt(uuid,uuid,text,uuid,text),
  app_data_agent.falcon24_gate_current_authority_fence(),
  app_data_agent.falcon24_qualification_slot_attempt_fence(),
  app_data_agent.falcon24_campaign_run_attempt_fence(),
  app_data_agent.falcon24_gate_attempt_history_immutable()
from public,data_agent_backend;
do $history_postconditions$
declare snapshot_row record;target_relation_name text;target_relation regclass;
  observed_count bigint;observed_digest text;
begin
  for snapshot_row in select * from falcon24_e1_relation_snapshot order by relation_name loop
    target_relation_name:=case snapshot_row.relation_name
      when 'falcon24_e1_staging_sessions' then 'falcon24_authority_staging_sessions'
      when 'falcon24_e1_staging_receipts' then 'falcon24_authority_staging_receipts'
      when 'falcon24_e1_activation_attempts' then 'falcon24_authority_activation_attempts'
      when 'falcon24_e1_ui_receipts' then 'falcon24_ui_receipts'
      when 'falcon24_e1_gate_attempt_history' then 'falcon24_gate_attempt_history'
      when 'e1_analysis_publications' then 'falcon24_analysis_publications'
      when 'e1_analysis_publication_artifacts' then 'falcon24_analysis_publication_artifacts'
      when 'e1_analysis_publication_current' then 'falcon24_analysis_publication_current'
      when 'e1_analysis_publication_outbox' then 'falcon24_analysis_publication_outbox'
      else snapshot_row.relation_name end;
    target_relation:=pg_catalog.to_regclass('app_data_agent.'||target_relation_name);
    if target_relation is null or target_relation::oid<>snapshot_row.relation_oid
    then raise exception using errcode='P0001',message='FALCON24_E1_HISTORY_DRIFT'; end if;
    execute pg_catalog.format(
      'select pg_catalog.count(*),app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(source)-$1 order by '
      ||'(to_jsonb(source)-$1)::text),''[]''::jsonb)) from %s source',target_relation)
      into strict observed_count,observed_digest using snapshot_row.excluded_columns;
    if observed_count<>snapshot_row.row_count or observed_digest<>snapshot_row.row_digest
    then raise exception using errcode='P0001',message='FALCON24_E1_HISTORY_DRIFT',
      detail=pg_catalog.jsonb_build_object('relation',target_relation_name)::text; end if;
  end loop;
end
$history_postconditions$;

do $authority_postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'falcon24_e1_staging_sessions','falcon24_e1_staging_receipts',
    'falcon24_e1_activation_attempts','falcon24_e1_ui_receipts',
    'falcon24_e1_gate_attempt_history','e1_analysis_publications',
    'e1_analysis_publication_artifacts','e1_analysis_publication_current',
    'e1_analysis_publication_outbox'
  ]::text[] loop
    if pg_catalog.to_regclass('app_data_agent.'||relation_name) is not null
    then raise exception using errcode='P0001',
      message='FALCON24_E2_SECOND_AUTHORITY_TRUTH_DETECTED'; end if;
  end loop;

  foreach relation_name in array array[
    'falcon24_authority_staging_sessions','falcon24_authority_staging_receipts',
    'falcon24_authority_baselines','falcon24_authority_activation_attempts',
    'falcon24_current_authority_epoch','falcon24_ui_receipts',
    'falcon24_gate_attempt_history','falcon24_analysis_publications',
    'falcon24_analysis_publication_artifacts','falcon24_analysis_publication_current',
    'falcon24_analysis_publication_outbox'
  ]::text[] loop
    if not exists(select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='app_data_agent' and relation.relname=relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity)
    then raise exception using errcode='P0001',message='FALCON24_AUTHORITY_RLS_DRIFT'; end if;
  end loop;

  if not exists(select 1 from pg_catalog.pg_indexes
      where schemaname='app_data_agent'
        and indexname='falcon24_authority_one_active_baseline_per_epoch'
        and indexdef like '%app_id, tenant_id, environment, authority_epoch%')
    or exists(select 1 from app_data_agent.falcon24_authority_baselines
      where authority_epoch!~'^E[1-9][0-9]*$')
    or exists(select 1 from app_data_agent.falcon24_current_authority_epoch
      where authority_epoch!~'^E[1-9][0-9]*$')
    or exists(select 1 from app_data_agent.falcon24_qualifications
      where qualification_id<>authority_epoch||'-Q1')
    or exists(select 1 from app_data_agent.falcon24_acceptance_campaigns
      where campaign_id<>authority_epoch||'-C1')
  then raise exception using errcode='P0001',message='FALCON24_AUTHORITY_IDENTITY_DRIFT'; end if;

  if not pg_catalog.has_function_privilege('data_agent_u6_rpc_owner',
      'app_data_agent.activate_falcon24_authority(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.activate_falcon24_authority(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.activate_falcon24_authority(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.activate_falcon24_e1_authority(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.activate_falcon24_e1_authority(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_e1_analysis_publication(jsonb)','EXECUTE')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_authority_baselines','SELECT')
  then raise exception using errcode='P0001',message='FALCON24_AUTHORITY_GRANT_DRIFT'; end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname in(
          'begin_falcon24_authority_staging_session',
          'record_falcon24_authority_staging_receipt',
          'stage_falcon24_authority_baseline',
          'begin_falcon24_authority_activation_attempt',
          'hold_falcon24_authority_activation_attempt',
          'activate_falcon24_authority','load_falcon24_current_authority_epoch',
          'load_falcon24_run_authority_binding','commit_falcon24_ui_receipt',
          'load_falcon24_ui_receipts'))<>10
  then raise exception using errcode='P0001',message='FALCON24_AUTHORITY_RPC_INVENTORY_DRIFT'; end if;
end
$authority_postconditions$;

select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010781_app_data_agent_falcon24_e2_authority',
  'sha256:344233d3112d9154a78083b5821f866976e3f6a580f7ebbed35347860c4597b5');
commit;
