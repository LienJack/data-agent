-- falcon24_four_layer_gate_migration_checksum: sha256:ff25d3e347e3645634f280bec34f26d0718ce727a0638e7f9316b9155b351892
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010802_app_data_agent_falcon24_e10_versioned_profile_authority')
    or pg_catalog.to_regclass(
      'app_data_agent.falcon24_four_layer_gate_attempts') is not null
    or pg_catalog.to_regclass(
      'app_data_agent.falcon24_four_layer_gate_turns') is not null
    or pg_catalog.to_regprocedure(
      'app_data_agent.begin_falcon24_four_layer_gate(jsonb)') is not null
    or pg_catalog.to_regclass('app_data_agent.falcon24_current_authority_epoch') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_authority_baselines') is null
  then raise exception using errcode='P0001',
    message='FALCON24_FOUR_LAYER_BASELINE_DRIFT'; end if;
end
$preflight$;

create temporary table falcon24_10803_history_snapshot(
  relation_name text primary key,row_count bigint not null,row_digest text not null
) on commit drop;

do $snapshot$
declare relation_name text;schema_name text;table_name text;
  before_count bigint;before_digest text;
begin
  foreach relation_name in array array[
    'app_data_agent.falcon24_current_authority_epoch',
    'app_data_agent.falcon24_authority_staging_sessions',
    'app_data_agent.falcon24_authority_staging_receipts',
    'app_data_agent.falcon24_authority_baselines',
    'app_data_agent.falcon24_authority_activation_attempts',
    'app_data_agent.falcon24_diagnostic_attempts',
    'app_data_agent.falcon24_diagnostic_receipts',
    'app_data_agent.falcon24_epoch_closure_failure_receipts',
    'app_data_agent.falcon24_finalization_failure_receipts',
    'app_data_agent.falcon24_qualifications',
    'app_data_agent.falcon24_qualification_slots',
    'app_data_agent.falcon24_acceptance_campaigns',
    'app_data_agent.falcon24_acceptance_campaign_runs',
    'app_data_agent.runs','app_data_agent.run_events','app_data_agent.run_attempts',
    'app_data_agent.artifacts','app_data_agent.falcon24_llm_execution_certification_stage',
    'semantic.semantic_source_release','semantic.semantic_executable_projection',
    'semantic.semantic_relationship_projection','semantic.semantic_runtime_restriction_projection',
    'semantic.semantic_graph_projection','semantic.semantic_source_release_graph_projection',
    'semantic.semantic_active_pointer','semantic.semantic_runtime_activation',
    'app_data_agent.workspace_run_defaults','app_data_agent.workspace_run_default_revisions'
  ]::text[] loop
    schema_name:=pg_catalog.split_part(relation_name,'.',1);
    table_name:=pg_catalog.split_part(relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by to_jsonb(row_value)::text),'
      ||'''[]''::jsonb)) from %I.%I as row_value',schema_name,table_name)
      into strict before_count,before_digest;
    insert into falcon24_10803_history_snapshot
    values(relation_name,before_count,before_digest);
  end loop;
end
$snapshot$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
create table app_data_agent.falcon24_four_layer_gate_attempts(
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  principal_id uuid not null,gate_id text not null,attempt_id uuid not null,
  authority_epoch text not null,authority_baseline_id uuid not null,
  authority_baseline_hash text not null,authority_activation_attempt_id uuid not null,
  source_commit text not null,worker_build_hash text not null,
  worker_generation_hash text not null,web_build_hash text not null,
  web_generation_hash text not null,semantic_release_hash text not null,
  datasource_binding_hash text not null,model_config_hash text not null,
  runtime_attestation_hash text not null,manifest_hash text not null,
  manifest_document jsonb not null,status text not null,current_layer text not null,
  next_turn_ordinal integer not null,attempt_version bigint not null default 1,
  first_failure_turn_ordinal integer,first_failure_run_id uuid,first_failure_code text,
  terminal_receipt_hash text,terminal_receipt jsonb,
  created_at timestamptz not null,updated_at timestamptz not null,
  primary key(app_id,tenant_id,environment,principal_id,attempt_id),
  unique(app_id,tenant_id,environment,principal_id,gate_id,attempt_id),
  foreign key(app_id,tenant_id,environment,authority_baseline_id,
    authority_baseline_hash,authority_epoch)
  references app_data_agent.falcon24_authority_baselines(
    app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch)
  on delete restrict,
  foreign key(app_id,tenant_id,environment,authority_activation_attempt_id,
    authority_baseline_id,authority_baseline_hash)
  references app_data_agent.falcon24_authority_activation_attempts(
    app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash)
  on delete restrict,
  check(gate_id=authority_epoch||'-FL1' and authority_epoch~'^E[1-9][0-9]*$'
    and source_commit~'^[0-9a-f]{40}$'
    and authority_baseline_hash~'^sha256:[0-9a-f]{64}$'
    and worker_build_hash~'^sha256:[0-9a-f]{64}$'
    and worker_generation_hash~'^sha256:[0-9a-f]{64}$'
    and web_build_hash~'^sha256:[0-9a-f]{64}$'
    and web_generation_hash~'^sha256:[0-9a-f]{64}$'
    and semantic_release_hash~'^sha256:[0-9a-f]{64}$'
    and datasource_binding_hash~'^sha256:[0-9a-f]{64}$'
    and model_config_hash~'^sha256:[0-9a-f]{64}$'
    and runtime_attestation_hash~'^sha256:[0-9a-f]{64}$'
    and manifest_hash~'^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(manifest_document)='object'
    and status in('READY','RUNNING','FINALIZING','FAILED','PASSED')
    and current_layer in('L1','L2','L3','L4','COMPLETE')
    and next_turn_ordinal between 0 and 15 and attempt_version>0
    and ((first_failure_turn_ordinal is null)=(first_failure_run_id is null))
    and ((first_failure_turn_ordinal is null)=(first_failure_code is null))
    and (first_failure_turn_ordinal is null or first_failure_turn_ordinal between 0 and 14)
    and (first_failure_code is null or first_failure_code~'^[A-Z][A-Z0-9_]{2,127}$')
    and ((status='FAILED')=(first_failure_code is not null))
    and ((terminal_receipt_hash is null)=(terminal_receipt is null))
    and (terminal_receipt_hash is null or terminal_receipt_hash~'^sha256:[0-9a-f]{64}$')
    and (status<>'PASSED' or (next_turn_ordinal=15 and current_layer='COMPLETE'
      and terminal_receipt is not null)))
);

create unique index falcon24_four_layer_one_active_attempt
on app_data_agent.falcon24_four_layer_gate_attempts(
  app_id,tenant_id,environment,principal_id)
where status in('READY','RUNNING','FINALIZING');

create table app_data_agent.falcon24_four_layer_gate_turns(
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  principal_id uuid not null,attempt_id uuid not null,turn_ordinal integer not null,
  turn_id text not null,layer text not null,scenario_id text not null,
  scenario_turn_index integer not null,conversation_group text,
  conversation_mode text not null,question text not null,question_hash text not null,
  expected_agents jsonb not null,rubric jsonb not null,status text not null,
  turn_version bigint not null default 1,conversation_id uuid,
  conversation_resource_version bigint,run_id uuid,claim_command_hash text,
  business_receipt_hash text,business_receipt jsonb,
  qa_ui_receipt_hash text,qa_ui_receipt jsonb,
  trace_ui_receipt_hash text,trace_ui_receipt jsonb,
  terminal_receipt_hash text,terminal_receipt jsonb,
  claimed_at timestamptz,completed_at timestamptz,
  created_at timestamptz not null,updated_at timestamptz not null,
  primary key(app_id,tenant_id,environment,principal_id,attempt_id,turn_ordinal),
  unique(app_id,tenant_id,environment,principal_id,attempt_id,turn_id),
  foreign key(app_id,tenant_id,environment,principal_id,attempt_id)
  references app_data_agent.falcon24_four_layer_gate_attempts(
    app_id,tenant_id,environment,principal_id,attempt_id) on delete restrict,
  check(turn_ordinal between 0 and 14 and turn_id~'^L[1-4](-[AB])?-0[1-5]$'
    and layer in('L1','L2','L3','L4')
    and scenario_id~'^l[1-4]-[a-z0-9-]+$' and scenario_turn_index between 0 and 2
    and conversation_group is null or conversation_group in('L4-A','L4-B')
    and conversation_mode in('INDEPENDENT','SHARED_SCENARIO')
    and ((layer='L4')=(conversation_group is not null))
    and ((layer='L4')=(conversation_mode='SHARED_SCENARIO'))
    and pg_catalog.length(pg_catalog.btrim(question)) between 1 and 8000
    and question_hash~'^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(expected_agents)='object'
    and pg_catalog.jsonb_typeof(rubric)='object'
    and status in('PLANNED','CLAIMED','BUSINESS_PASSED','BUSINESS_FAILED',
      'QA_PASSED','QA_FAILED','TRACE_PASSED','TRACE_FAILED','PASSED','FAILED')
    and turn_version>0
    and ((conversation_id is null)=(conversation_resource_version is null))
    and ((conversation_id is null)=(run_id is null))
    and ((conversation_id is null)=(claim_command_hash is null))
    and (conversation_resource_version is null or conversation_resource_version>0)
    and (claim_command_hash is null or claim_command_hash~'^sha256:[0-9a-f]{64}$')
    and ((business_receipt_hash is null)=(business_receipt is null))
    and ((qa_ui_receipt_hash is null)=(qa_ui_receipt is null))
    and ((trace_ui_receipt_hash is null)=(trace_ui_receipt is null))
    and ((terminal_receipt_hash is null)=(terminal_receipt is null))
    and (business_receipt_hash is null or business_receipt_hash~'^sha256:[0-9a-f]{64}$')
    and (qa_ui_receipt_hash is null or qa_ui_receipt_hash~'^sha256:[0-9a-f]{64}$')
    and (trace_ui_receipt_hash is null or trace_ui_receipt_hash~'^sha256:[0-9a-f]{64}$')
    and (terminal_receipt_hash is null or terminal_receipt_hash~'^sha256:[0-9a-f]{64}$')
    and (qa_ui_receipt is null or business_receipt->>'status'='PASS')
    and (trace_ui_receipt is null or qa_ui_receipt->>'status'='PASS')
    and (status not in('PASSED','FAILED') or completed_at is not null)
  )
);

create unique index falcon24_four_layer_run_unique
on app_data_agent.falcon24_four_layer_gate_turns(
  app_id,tenant_id,environment,principal_id,run_id)
where run_id is not null;

alter table app_data_agent.falcon24_four_layer_gate_attempts enable row level security;
alter table app_data_agent.falcon24_four_layer_gate_attempts force row level security;
alter table app_data_agent.falcon24_four_layer_gate_turns enable row level security;
alter table app_data_agent.falcon24_four_layer_gate_turns force row level security;

create policy falcon24_four_layer_attempt_authority
on app_data_agent.falcon24_four_layer_gate_attempts for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and principal_id=(select principal_id from platform.current_backend_authority(false)))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and principal_id=(select principal_id from platform.current_backend_authority(true)));

create policy falcon24_four_layer_turn_authority
on app_data_agent.falcon24_four_layer_gate_turns for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and principal_id=(select principal_id from platform.current_backend_authority(false)))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and principal_id=(select principal_id from platform.current_backend_authority(true)));
create function app_data_agent.falcon24_four_layer_receipt_identity_matches(
  attempt_document jsonb,turn_document jsonb,receipt jsonb,expected_schema text,
  include_web_build boolean)
returns boolean language sql stable set search_path='' as $function$
  select receipt is not null and pg_catalog.jsonb_typeof(receipt)='object'
    and receipt->>'schema_version'=expected_schema
    and receipt->>'receipt_hash'=app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
    and receipt->>'gate_id'=attempt_document->>'gate_id'
    and receipt->>'attempt_id'=attempt_document->>'attempt_id'
    and receipt->>'manifest_hash'=attempt_document->>'manifest_hash'
    and receipt->>'turn_ordinal'=turn_document->>'turn_ordinal'
    and receipt->>'turn_id'=turn_document->>'turn_id'
    and receipt->>'layer'=turn_document->>'layer'
    and receipt->>'scenario_id'=turn_document->>'scenario_id'
    and receipt->>'scenario_turn_index'=turn_document->>'scenario_turn_index'
    and receipt->>'conversation_id'=turn_document->>'conversation_id'
    and receipt->>'conversation_resource_version'=
      turn_document->>'conversation_resource_version'
    and receipt->>'run_id'=turn_document->>'run_id'
    and receipt->>'question_hash'=turn_document->>'question_hash'
    and receipt->>'worker_build_hash'=attempt_document->>'worker_build_hash'
    and receipt->>'worker_generation_hash'=attempt_document->>'worker_generation_hash'
    and receipt->>'semantic_release_hash'=attempt_document->>'semantic_release_hash'
    and (not include_web_build or (
      receipt->>'web_build_hash'=attempt_document->>'web_build_hash'
      and receipt->>'web_generation_hash'=attempt_document->>'web_generation_hash'))
$function$;

create function app_data_agent.falcon24_four_layer_agent_contract_matches(
  expected_agents jsonb,actual_profile_ids jsonb)
returns boolean language sql immutable set search_path='' as $function$
  with actual as (
    select value profile_id,ordinality::integer position
    from pg_catalog.jsonb_array_elements_text(actual_profile_ids)
      with ordinality actual_entry(value,ordinality)
  ), required as (
    select value profile_id,ordinality::integer position
    from pg_catalog.jsonb_array_elements_text(expected_agents->'required_profile_ids')
      with ordinality required_entry(value,ordinality)
  ), required_positions as (
    select required.position,pg_catalog.min(actual.position) actual_position
    from required join actual using(profile_id) group by required.position
  )
  select pg_catalog.jsonb_typeof(expected_agents)='object'
    and pg_catalog.jsonb_typeof(actual_profile_ids)='array'
    and pg_catalog.jsonb_array_length(actual_profile_ids)
      between (expected_agents->>'min_agent_tasks')::integer
        and (expected_agents->>'max_agent_tasks')::integer
    and not exists(select 1 from actual
      where not (expected_agents->'allowed_profile_ids' ? profile_id))
    and case when expected_agents->>'mode'='EXACT'
      then actual_profile_ids=expected_agents->'required_profile_ids'
      else (select pg_catalog.count(*) from required_positions)=
          pg_catalog.jsonb_array_length(expected_agents->'required_profile_ids')
        and not exists(select 1 from required_positions current_position
          join required_positions previous_position
            on previous_position.position=current_position.position-1
          where current_position.actual_position<=previous_position.actual_position)
      end
$function$;

create function app_data_agent.load_falcon24_four_layer_gate_attempt(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record;attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','attempt_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-attempt-load@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_COMMAND_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into attempt from app_data_agent.falcon24_four_layer_gate_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(command->>'attempt_id')::uuid;
  if not found then return null; end if;
  return pg_catalog.to_jsonb(attempt);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID';
end
$function$;

create function app_data_agent.load_falcon24_four_layer_gate_turn(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record;turn app_data_agent.falcon24_four_layer_gate_turns%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','attempt_id','turn_ordinal','command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-turn-load@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or command->>'turn_ordinal'!~'^(0|[1-9][0-9]*)$'
    or (command->>'turn_ordinal')::integer not between 0 and 14
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_COMMAND_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into turn from app_data_agent.falcon24_four_layer_gate_turns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(command->>'attempt_id')::uuid
      and row.turn_ordinal=(command->>'turn_ordinal')::integer;
  if not found then return null; end if;
  return pg_catalog.to_jsonb(turn);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID';
end
$function$;

create function app_data_agent.begin_falcon24_four_layer_gate(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record;current_authority app_data_agent.falcon24_current_authority_epoch%rowtype;
  attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;manifest jsonb;
  now_at timestamptz;layer_counts integer[];
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','manifest','command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-gate-begin@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'manifest') is distinct from 'object'
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_COMMAND_INVALID'; end if;
  manifest:=command->'manifest';
  select array[pg_catalog.count(*) filter(where item->>'layer'='L1'),
      pg_catalog.count(*) filter(where item->>'layer'='L2'),
      pg_catalog.count(*) filter(where item->>'layer'='L3'),
      pg_catalog.count(*) filter(where item->>'layer'='L4')]::integer[]
    into strict layer_counts from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(manifest->'turns')='array'
        then manifest->'turns' else '[]'::jsonb end) item;
  if app_data_agent.provider_json_object_has_exact_keys(manifest,array[
      'schema_version','gate_id','attempt_id','authority_epoch','authority_baseline_id',
      'authority_baseline_hash','authority_activation_attempt_id','source_commit',
      'worker_build_hash','worker_generation_hash','web_build_hash','web_generation_hash',
      'semantic_release_hash','datasource_binding_hash','model_config_hash',
      'runtime_attestation_hash','turns','manifest_hash']::text[]) is distinct from true
    or manifest->>'schema_version'<>'falcon24-four-layer-gate-manifest@1.0.0'
    or manifest->>'manifest_hash'<>app_data_agent.u2_canonical_sha256(manifest-'manifest_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(manifest->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      manifest->'authority_baseline_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      manifest->'authority_activation_attempt_id') is distinct from true
    or manifest->>'authority_epoch'!~'^E[1-9][0-9]*$'
    or manifest->>'gate_id'<>manifest->>'authority_epoch'||'-FL1'
    or manifest->>'source_commit'!~'^[0-9a-f]{40}$'
    or exists(select 1 from pg_catalog.unnest(array[
      'authority_baseline_hash','worker_build_hash','worker_generation_hash','web_build_hash',
      'web_generation_hash','semantic_release_hash','datasource_binding_hash',
      'model_config_hash','runtime_attestation_hash','manifest_hash']::text[]) hash_key
      where manifest->>hash_key!~'^sha256:[0-9a-f]{64}$')
    or pg_catalog.jsonb_typeof(manifest->'turns') is distinct from 'array'
    or pg_catalog.jsonb_array_length(manifest->'turns')<>15
    or layer_counts<>array[5,2,2,6]::integer[]
    or app_data_agent.u2_canonical_sha256(manifest->'turns')<>
      'sha256:c01c7944368ebdd0ae9fb2e69c9b809cb0cb24a2de65076da934e95a23c396e9'
    or app_data_agent.contains_potential_plaintext_secret(manifest)
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_MANIFEST_INVALID'; end if;

  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:falcon24-four-layer:'||authority.app_id::text||':'||
    authority.tenant_id::text||':'||authority.environment||':'||authority.principal_id::text,0));
  select * into current_authority from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for share;
  if not found or current_authority.authority_epoch<>manifest->>'authority_epoch'
    or current_authority.baseline_id::text<>manifest->>'authority_baseline_id'
    or current_authority.baseline_hash<>manifest->>'authority_baseline_hash'
    or current_authority.activation_attempt_id::text<>
      manifest->>'authority_activation_attempt_id'
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_AUTHORITY_MISMATCH'; end if;

  select * into attempt from app_data_agent.falcon24_four_layer_gate_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(manifest->>'attempt_id')::uuid for update;
  if found then
    if attempt.manifest_hash<>manifest->>'manifest_hash'
      or attempt.worker_build_hash<>manifest->>'worker_build_hash'
      or attempt.web_build_hash<>manifest->>'web_build_hash'
    then raise exception using errcode='55000',
      message='FALCON24_FOUR_LAYER_REPLAY_MISMATCH'; end if;
    return pg_catalog.jsonb_build_object('attempt',pg_catalog.to_jsonb(attempt));
  end if;
  if exists(select 1 from app_data_agent.falcon24_four_layer_gate_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.status in('READY','RUNNING','FINALIZING'))
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_ACTIVE_ATTEMPT_EXISTS'; end if;
  now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.falcon24_four_layer_gate_attempts(
    app_id,tenant_id,environment,principal_id,gate_id,attempt_id,authority_epoch,
    authority_baseline_id,authority_baseline_hash,authority_activation_attempt_id,
    source_commit,worker_build_hash,worker_generation_hash,web_build_hash,
    web_generation_hash,semantic_release_hash,datasource_binding_hash,model_config_hash,
    runtime_attestation_hash,manifest_hash,manifest_document,status,current_layer,
    next_turn_ordinal,created_at,updated_at)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    manifest->>'gate_id',(manifest->>'attempt_id')::uuid,manifest->>'authority_epoch',
    (manifest->>'authority_baseline_id')::uuid,manifest->>'authority_baseline_hash',
    (manifest->>'authority_activation_attempt_id')::uuid,manifest->>'source_commit',
    manifest->>'worker_build_hash',manifest->>'worker_generation_hash',
    manifest->>'web_build_hash',manifest->>'web_generation_hash',
    manifest->>'semantic_release_hash',manifest->>'datasource_binding_hash',
    manifest->>'model_config_hash',manifest->>'runtime_attestation_hash',
    manifest->>'manifest_hash',manifest,'READY','L1',0,now_at,now_at)
  returning * into strict attempt;
  insert into app_data_agent.falcon24_four_layer_gate_turns(
    app_id,tenant_id,environment,principal_id,attempt_id,turn_ordinal,turn_id,layer,
    scenario_id,scenario_turn_index,conversation_group,conversation_mode,question,
    question_hash,expected_agents,rubric,status,created_at,updated_at)
  select authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    attempt.attempt_id,(entry.ordinality-1)::integer,entry.item->>'turn_id',
    entry.item->>'layer',entry.item->>'scenario_id',
    (entry.item->>'scenario_turn_index')::integer,entry.item->>'conversation_group',
    entry.item->>'conversation_mode',entry.item->>'question',entry.item->>'question_hash',
    entry.item->'expected_agents',entry.item->'rubric','PLANNED',now_at,now_at
  from pg_catalog.jsonb_array_elements(manifest->'turns')
    with ordinality entry(item,ordinality);
  return pg_catalog.jsonb_build_object('attempt',pg_catalog.to_jsonb(attempt));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID';
end
$function$;

create function app_data_agent.claim_falcon24_four_layer_gate_turn(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record;attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;
  turn app_data_agent.falcon24_four_layer_gate_turns%rowtype;
  previous_turn app_data_agent.falcon24_four_layer_gate_turns%rowtype;now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','attempt_id','turn_ordinal','conversation_id',
      'conversation_resource_version','run_id','idempotency_key',
      'expected_attempt_version','expected_turn_version','command_hash']::text[])
      is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-turn-claim@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'conversation_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'run_id') is distinct from true
    or pg_catalog.jsonb_typeof(command->'idempotency_key') is distinct from 'string'
    or command->>'turn_ordinal'!~'^(0|[1-9][0-9]*)$'
    or command->>'conversation_resource_version'!~'^[1-9][0-9]*$'
    or command->>'expected_attempt_version'!~'^[1-9][0-9]*$'
    or command->>'expected_turn_version'!~'^[1-9][0-9]*$'
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_COMMAND_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:falcon24-four-layer-attempt:'||command->>'attempt_id',0));
  select * into attempt from app_data_agent.falcon24_four_layer_gate_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(command->>'attempt_id')::uuid for update;
  select * into turn from app_data_agent.falcon24_four_layer_gate_turns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(command->>'attempt_id')::uuid
      and row.turn_ordinal=(command->>'turn_ordinal')::integer for update;
  if attempt.attempt_id is null or turn.attempt_id is null
  then raise exception using errcode='02000',message='FALCON24_FOUR_LAYER_NOT_FOUND'; end if;
  if turn.status<>'PLANNED' then
    if turn.claim_command_hash=command->>'command_hash'
      and turn.conversation_id::text=command->>'conversation_id'
      and turn.conversation_resource_version::text=command->>'conversation_resource_version'
      and turn.run_id::text=command->>'run_id'
    then return pg_catalog.jsonb_build_object(
      'attempt',pg_catalog.to_jsonb(attempt),'turn',pg_catalog.to_jsonb(turn)); end if;
    raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_REPLAY_MISMATCH';
  end if;
  if attempt.attempt_version<>(command->>'expected_attempt_version')::bigint
    or turn.turn_version<>(command->>'expected_turn_version')::bigint
  then raise exception using errcode='40001',
    message='FALCON24_FOUR_LAYER_VERSION_CONFLICT'; end if;
  if attempt.status<>'READY' or attempt.next_turn_ordinal<>turn.turn_ordinal
    or attempt.current_layer<>turn.layer
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_ORDER_INVALID'; end if;
  if not exists(select 1 from app_data_agent.qa_conversations conversation
    where conversation.app_id=authority.app_id and conversation.tenant_id=authority.tenant_id
      and conversation.environment=authority.environment
      and conversation.owner_principal_id=authority.principal_id
      and conversation.conversation_id=(command->>'conversation_id')::uuid
      and conversation.resource_version=(command->>'conversation_resource_version')::bigint)
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_CONVERSATION_MISMATCH'; end if;
  if turn.layer<>'L4' and exists(select 1
    from app_data_agent.falcon24_four_layer_gate_turns earlier
    where earlier.app_id=turn.app_id and earlier.tenant_id=turn.tenant_id
      and earlier.environment=turn.environment and earlier.principal_id=turn.principal_id
      and earlier.attempt_id=turn.attempt_id and earlier.turn_ordinal<turn.turn_ordinal
      and earlier.conversation_id=(command->>'conversation_id')::uuid)
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_CONVERSATION_MISMATCH'; end if;
  if turn.layer='L4' and turn.scenario_turn_index=0 and exists(select 1
    from app_data_agent.falcon24_four_layer_gate_turns earlier
    where earlier.app_id=turn.app_id and earlier.tenant_id=turn.tenant_id
      and earlier.environment=turn.environment and earlier.principal_id=turn.principal_id
      and earlier.attempt_id=turn.attempt_id and earlier.turn_ordinal<turn.turn_ordinal
      and earlier.conversation_id=(command->>'conversation_id')::uuid)
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_CONVERSATION_MISMATCH'; end if;
  if turn.layer='L4' and turn.scenario_turn_index>0 then
    select * into previous_turn from app_data_agent.falcon24_four_layer_gate_turns row
      where row.app_id=turn.app_id and row.tenant_id=turn.tenant_id
        and row.environment=turn.environment and row.principal_id=turn.principal_id
        and row.attempt_id=turn.attempt_id and row.conversation_group=turn.conversation_group
        and row.scenario_turn_index=turn.scenario_turn_index-1;
    if previous_turn.status<>'PASSED'
      or previous_turn.conversation_id::text<>command->>'conversation_id'
      or previous_turn.conversation_resource_version>=
        (command->>'conversation_resource_version')::bigint
    then raise exception using errcode='55000',
      message='FALCON24_FOUR_LAYER_CONVERSATION_MISMATCH'; end if;
  end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_four_layer_gate_turns set status='CLAIMED',
    conversation_id=(command->>'conversation_id')::uuid,
    conversation_resource_version=(command->>'conversation_resource_version')::bigint,
    run_id=(command->>'run_id')::uuid,claim_command_hash=command->>'command_hash',
    claimed_at=now_at,updated_at=now_at,turn_version=turn_version+1
    where app_id=turn.app_id and tenant_id=turn.tenant_id and environment=turn.environment
      and principal_id=turn.principal_id and attempt_id=turn.attempt_id
      and turn_ordinal=turn.turn_ordinal and status='PLANNED'
    returning * into strict turn;
  update app_data_agent.falcon24_four_layer_gate_attempts set status='RUNNING',
    updated_at=now_at,attempt_version=attempt_version+1
    where app_id=attempt.app_id and tenant_id=attempt.tenant_id
      and environment=attempt.environment and principal_id=attempt.principal_id
      and attempt_id=attempt.attempt_id and status='READY'
    returning * into strict attempt;
  return pg_catalog.jsonb_build_object(
    'attempt',pg_catalog.to_jsonb(attempt),'turn',pg_catalog.to_jsonb(turn));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID';
end
$function$;
create function app_data_agent.record_falcon24_four_layer_business_receipt(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record;attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;
  turn app_data_agent.falcon24_four_layer_gate_turns%rowtype;receipt jsonb;
  now_at timestamptz;rubric_check_ids jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','receipt','expected_attempt_version','expected_turn_version',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-business-record@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'receipt') is distinct from 'object'
    or command->>'expected_attempt_version'!~'^[1-9][0-9]*$'
    or command->>'expected_turn_version'!~'^[1-9][0-9]*$'
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_COMMAND_INVALID'; end if;
  receipt:=command->'receipt';
  if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','gate_id','attempt_id','manifest_hash','turn_ordinal','turn_id',
      'layer','scenario_id','scenario_turn_index','conversation_id',
      'conversation_resource_version','run_id','question_hash','worker_build_hash',
      'worker_generation_hash','semantic_release_hash','answer_hash','public_event_hash',
      'actual_profile_ids','accepted_artifact_refs','rubric_results','status','failure_code',
      'evaluated_at','receipt_hash']::text[]) is distinct from true
    or receipt->>'status' not in('PASS','FAIL')
    or ((receipt->>'status'='PASS')<>(receipt->'failure_code'='null'::jsonb))
    or receipt->>'answer_hash'!~'^sha256:[0-9a-f]{64}$'
    or receipt->>'public_event_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(receipt->'actual_profile_ids')<>'array'
    or pg_catalog.jsonb_typeof(receipt->'accepted_artifact_refs')<>'array'
    or pg_catalog.jsonb_typeof(receipt->'rubric_results')<>'array'
    or app_data_agent.contains_potential_plaintext_secret(receipt)
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_BUSINESS_RECEIPT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:falcon24-four-layer-attempt:'||receipt->>'attempt_id',0));
  select * into attempt from app_data_agent.falcon24_four_layer_gate_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(receipt->>'attempt_id')::uuid for update;
  select * into turn from app_data_agent.falcon24_four_layer_gate_turns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(receipt->>'attempt_id')::uuid
      and row.turn_ordinal=(receipt->>'turn_ordinal')::integer for update;
  if attempt.attempt_id is null or turn.attempt_id is null
  then raise exception using errcode='02000',message='FALCON24_FOUR_LAYER_NOT_FOUND'; end if;
  if turn.business_receipt is not null then
    if turn.business_receipt_hash=receipt->>'receipt_hash'
      and turn.business_receipt=receipt
    then return pg_catalog.jsonb_build_object(
      'attempt',pg_catalog.to_jsonb(attempt),'turn',pg_catalog.to_jsonb(turn)); end if;
    raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_REPLAY_MISMATCH';
  end if;
  if attempt.attempt_version<>(command->>'expected_attempt_version')::bigint
    or turn.turn_version<>(command->>'expected_turn_version')::bigint
  then raise exception using errcode='40001',message='FALCON24_FOUR_LAYER_VERSION_CONFLICT'; end if;
  if receipt->>'worker_build_hash'<>attempt.worker_build_hash
    or receipt->>'worker_generation_hash'<>attempt.worker_generation_hash
    or receipt->>'semantic_release_hash'<>attempt.semantic_release_hash
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_BUILD_MISMATCH'; end if;
  if app_data_agent.falcon24_four_layer_receipt_identity_matches(
      pg_catalog.to_jsonb(attempt),pg_catalog.to_jsonb(turn),receipt,
      'falcon24-four-layer-business-receipt@1.0.0',false) is distinct from true
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_RECEIPT_IDENTITY_MISMATCH'; end if;
  if attempt.status<>'RUNNING' or turn.status<>'CLAIMED'
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_ORDER_INVALID'; end if;
  if not exists(select 1 from app_data_agent.runs run
      join app_data_agent.workspace_run_bindings binding
        on binding.app_id=run.app_id and binding.tenant_id=run.tenant_id
        and binding.environment=run.environment and binding.run_id=run.run_id
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.run_id=turn.run_id and run.question=turn.question
      and run.status not in('QUEUED','RUNNING','WAITING')
      and binding.principal_id=authority.principal_id
      and binding.conversation_id=turn.conversation_id)
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_RUN_MISMATCH'; end if;
  if not app_data_agent.falcon24_four_layer_agent_contract_matches(
      turn.expected_agents,receipt->'actual_profile_ids')
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_AGENT_CONTRACT_MISMATCH'; end if;
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(result->'check_id' order by ordinality),
      '[]'::jsonb) into strict rubric_check_ids
    from pg_catalog.jsonb_array_elements(receipt->'rubric_results')
      with ordinality rubric_result(result,ordinality);
  if rubric_check_ids<>turn.rubric->'required_checks'
    or (receipt->>'status'='PASS' and exists(select 1
      from pg_catalog.jsonb_array_elements(receipt->'rubric_results') result
      where result->>'status'<>'PASS'
        or result->>'evidence_hash'!~'^sha256:[0-9a-f]{64}$'))
    or exists(select 1 from pg_catalog.jsonb_array_elements(
      receipt->'accepted_artifact_refs') reference
      where reference->>'run_id'<>turn.run_id::text)
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_RUBRIC_CLOSURE_INVALID'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_four_layer_gate_turns set
    business_receipt_hash=receipt->>'receipt_hash',business_receipt=receipt,
    status=case when receipt->>'status'='PASS' then 'BUSINESS_PASSED'
      else 'BUSINESS_FAILED' end,updated_at=now_at,turn_version=turn_version+1
    where app_id=turn.app_id and tenant_id=turn.tenant_id and environment=turn.environment
      and principal_id=turn.principal_id and attempt_id=turn.attempt_id
      and turn_ordinal=turn.turn_ordinal and status='CLAIMED'
    returning * into strict turn;
  update app_data_agent.falcon24_four_layer_gate_attempts set
    status=case when receipt->>'status'='PASS' then status else 'FAILED' end,
    first_failure_turn_ordinal=case when receipt->>'status'='FAIL'
      then turn.turn_ordinal else null end,
    first_failure_run_id=case when receipt->>'status'='FAIL' then turn.run_id else null end,
    first_failure_code=case when receipt->>'status'='FAIL'
      then receipt->>'failure_code' else null end,
    updated_at=now_at,attempt_version=attempt_version+1
    where app_id=attempt.app_id and tenant_id=attempt.tenant_id
      and environment=attempt.environment and principal_id=attempt.principal_id
      and attempt_id=attempt.attempt_id and status='RUNNING'
    returning * into strict attempt;
  return pg_catalog.jsonb_build_object(
    'attempt',pg_catalog.to_jsonb(attempt),'turn',pg_catalog.to_jsonb(turn));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID';
end
$function$;
create function app_data_agent.record_falcon24_four_layer_qa_ui_receipt(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record;attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;
  turn app_data_agent.falcon24_four_layer_gate_turns%rowtype;receipt jsonb;now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','receipt','expected_attempt_version','expected_turn_version',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-qa-ui-record@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'receipt') is distinct from 'object'
    or command->>'expected_attempt_version'!~'^[1-9][0-9]*$'
    or command->>'expected_turn_version'!~'^[1-9][0-9]*$'
  then raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID'; end if;
  receipt:=command->'receipt';
  if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','gate_id','attempt_id','manifest_hash','turn_ordinal','turn_id',
      'layer','scenario_id','scenario_turn_index','conversation_id',
      'conversation_resource_version','run_id','question_hash','worker_build_hash',
      'worker_generation_hash','semantic_release_hash','answer_hash','web_build_hash',
      'web_generation_hash','composer_submission_count','terminal_answer_visible',
      'error_banner','dom_snapshot_hash','screenshot_hash','status','failure_code',
      'observed_at','receipt_hash']::text[]) is distinct from true
    or receipt->>'status' not in('PASS','FAIL')
    or ((receipt->>'status'='PASS')<>(receipt->'failure_code'='null'::jsonb))
    or receipt->>'composer_submission_count'<>'1'
    or (receipt->>'status'='PASS' and (receipt->>'terminal_answer_visible'<>'true'
      or receipt->'error_banner'<>'null'::jsonb))
    or receipt->>'dom_snapshot_hash'!~'^sha256:[0-9a-f]{64}$'
    or receipt->>'screenshot_hash'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.contains_potential_plaintext_secret(receipt)
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_QA_UI_RECEIPT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:falcon24-four-layer-attempt:'||receipt->>'attempt_id',0));
  select * into attempt from app_data_agent.falcon24_four_layer_gate_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(receipt->>'attempt_id')::uuid for update;
  select * into turn from app_data_agent.falcon24_four_layer_gate_turns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(receipt->>'attempt_id')::uuid
      and row.turn_ordinal=(receipt->>'turn_ordinal')::integer for update;
  if attempt.attempt_id is null or turn.attempt_id is null
  then raise exception using errcode='02000',message='FALCON24_FOUR_LAYER_NOT_FOUND'; end if;
  if turn.qa_ui_receipt is not null then
    if turn.qa_ui_receipt_hash=receipt->>'receipt_hash' and turn.qa_ui_receipt=receipt
    then return pg_catalog.jsonb_build_object(
      'attempt',pg_catalog.to_jsonb(attempt),'turn',pg_catalog.to_jsonb(turn)); end if;
    raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_REPLAY_MISMATCH';
  end if;
  if attempt.attempt_version<>(command->>'expected_attempt_version')::bigint
    or turn.turn_version<>(command->>'expected_turn_version')::bigint
  then raise exception using errcode='40001',message='FALCON24_FOUR_LAYER_VERSION_CONFLICT'; end if;
  if receipt->>'web_build_hash'<>attempt.web_build_hash
    or receipt->>'web_generation_hash'<>attempt.web_generation_hash
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_BUILD_MISMATCH'; end if;
  if app_data_agent.falcon24_four_layer_receipt_identity_matches(
      pg_catalog.to_jsonb(attempt),pg_catalog.to_jsonb(turn),receipt,
      'falcon24-four-layer-qa-ui-receipt@1.0.0',true) is distinct from true
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_RECEIPT_IDENTITY_MISMATCH'; end if;
  if turn.status='BUSINESS_FAILED' or attempt.status='FAILED'
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_UI_AFTER_BUSINESS_FAILURE'; end if;
  if turn.status<>'BUSINESS_PASSED' or receipt->>'answer_hash'<>
    turn.business_receipt->>'answer_hash'
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_ORDER_INVALID'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_four_layer_gate_turns set
    qa_ui_receipt_hash=receipt->>'receipt_hash',qa_ui_receipt=receipt,
    status=case when receipt->>'status'='PASS' then 'QA_PASSED' else 'QA_FAILED' end,
    updated_at=now_at,turn_version=turn_version+1
    where app_id=turn.app_id and tenant_id=turn.tenant_id and environment=turn.environment
      and principal_id=turn.principal_id and attempt_id=turn.attempt_id
      and turn_ordinal=turn.turn_ordinal and status='BUSINESS_PASSED'
    returning * into strict turn;
  update app_data_agent.falcon24_four_layer_gate_attempts set
    status=case when receipt->>'status'='PASS' then status else 'FAILED' end,
    first_failure_turn_ordinal=case when receipt->>'status'='FAIL'
      then turn.turn_ordinal else null end,
    first_failure_run_id=case when receipt->>'status'='FAIL' then turn.run_id else null end,
    first_failure_code=case when receipt->>'status'='FAIL'
      then receipt->>'failure_code' else null end,
    updated_at=now_at,attempt_version=attempt_version+1
    where app_id=attempt.app_id and tenant_id=attempt.tenant_id
      and environment=attempt.environment and principal_id=attempt.principal_id
      and attempt_id=attempt.attempt_id and status='RUNNING'
    returning * into strict attempt;
  return pg_catalog.jsonb_build_object(
    'attempt',pg_catalog.to_jsonb(attempt),'turn',pg_catalog.to_jsonb(turn));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID';
end
$function$;

create function app_data_agent.record_falcon24_four_layer_trace_ui_receipt(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record;attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;
  turn app_data_agent.falcon24_four_layer_gate_turns%rowtype;receipt jsonb;now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','receipt','expected_attempt_version','expected_turn_version',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-trace-ui-record@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'receipt') is distinct from 'object'
    or command->>'expected_attempt_version'!~'^[1-9][0-9]*$'
    or command->>'expected_turn_version'!~'^[1-9][0-9]*$'
  then raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID'; end if;
  receipt:=command->'receipt';
  if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','gate_id','attempt_id','manifest_hash','turn_ordinal','turn_id',
      'layer','scenario_id','scenario_turn_index','conversation_id',
      'conversation_resource_version','run_id','question_hash','worker_build_hash',
      'worker_generation_hash','semantic_release_hash','web_build_hash','web_generation_hash',
      'answer_entry_clicked','exact_run_focused','public_event_hash',
      'accepted_artifact_refs_hash','dom_snapshot_hash','screenshot_hash','status',
      'failure_code','observed_at','receipt_hash']::text[]) is distinct from true
    or receipt->>'status' not in('PASS','FAIL')
    or ((receipt->>'status'='PASS')<>(receipt->'failure_code'='null'::jsonb))
    or (receipt->>'status'='PASS' and (receipt->>'answer_entry_clicked'<>'true'
      or receipt->>'exact_run_focused'<>'true'))
    or exists(select 1 from pg_catalog.unnest(array[
      'public_event_hash','accepted_artifact_refs_hash','dom_snapshot_hash',
      'screenshot_hash']::text[]) hash_key where receipt->>hash_key!~'^sha256:[0-9a-f]{64}$')
    or app_data_agent.contains_potential_plaintext_secret(receipt)
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_TRACE_UI_RECEIPT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:falcon24-four-layer-attempt:'||receipt->>'attempt_id',0));
  select * into attempt from app_data_agent.falcon24_four_layer_gate_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(receipt->>'attempt_id')::uuid for update;
  select * into turn from app_data_agent.falcon24_four_layer_gate_turns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(receipt->>'attempt_id')::uuid
      and row.turn_ordinal=(receipt->>'turn_ordinal')::integer for update;
  if attempt.attempt_id is null or turn.attempt_id is null
  then raise exception using errcode='02000',message='FALCON24_FOUR_LAYER_NOT_FOUND'; end if;
  if turn.trace_ui_receipt is not null then
    if turn.trace_ui_receipt_hash=receipt->>'receipt_hash' and turn.trace_ui_receipt=receipt
    then return pg_catalog.jsonb_build_object(
      'attempt',pg_catalog.to_jsonb(attempt),'turn',pg_catalog.to_jsonb(turn)); end if;
    raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_REPLAY_MISMATCH';
  end if;
  if attempt.attempt_version<>(command->>'expected_attempt_version')::bigint
    or turn.turn_version<>(command->>'expected_turn_version')::bigint
  then raise exception using errcode='40001',message='FALCON24_FOUR_LAYER_VERSION_CONFLICT'; end if;
  if receipt->>'web_build_hash'<>attempt.web_build_hash
    or receipt->>'web_generation_hash'<>attempt.web_generation_hash
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_BUILD_MISMATCH'; end if;
  if app_data_agent.falcon24_four_layer_receipt_identity_matches(
      pg_catalog.to_jsonb(attempt),pg_catalog.to_jsonb(turn),receipt,
      'falcon24-four-layer-trace-ui-receipt@1.0.0',true) is distinct from true
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_RECEIPT_IDENTITY_MISMATCH'; end if;
  if turn.status<>'QA_PASSED' or attempt.status<>'RUNNING'
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_TRACE_BEFORE_QA_PASS'; end if;
  if receipt->>'public_event_hash'<>turn.business_receipt->>'public_event_hash'
  then raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_ORDER_INVALID'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_four_layer_gate_turns set
    trace_ui_receipt_hash=receipt->>'receipt_hash',trace_ui_receipt=receipt,
    status=case when receipt->>'status'='PASS' then 'TRACE_PASSED' else 'TRACE_FAILED' end,
    updated_at=now_at,turn_version=turn_version+1
    where app_id=turn.app_id and tenant_id=turn.tenant_id and environment=turn.environment
      and principal_id=turn.principal_id and attempt_id=turn.attempt_id
      and turn_ordinal=turn.turn_ordinal and status='QA_PASSED'
    returning * into strict turn;
  update app_data_agent.falcon24_four_layer_gate_attempts set
    status=case when receipt->>'status'='PASS' then status else 'FAILED' end,
    first_failure_turn_ordinal=case when receipt->>'status'='FAIL'
      then turn.turn_ordinal else null end,
    first_failure_run_id=case when receipt->>'status'='FAIL' then turn.run_id else null end,
    first_failure_code=case when receipt->>'status'='FAIL'
      then receipt->>'failure_code' else null end,
    updated_at=now_at,attempt_version=attempt_version+1
    where app_id=attempt.app_id and tenant_id=attempt.tenant_id
      and environment=attempt.environment and principal_id=attempt.principal_id
      and attempt_id=attempt.attempt_id and status='RUNNING'
    returning * into strict attempt;
  return pg_catalog.jsonb_build_object(
    'attempt',pg_catalog.to_jsonb(attempt),'turn',pg_catalog.to_jsonb(turn));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID';
end
$function$;
create function app_data_agent.finalize_falcon24_four_layer_gate_turn(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record;attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;
  turn app_data_agent.falcon24_four_layer_gate_turns%rowtype;receipt jsonb;
  now_at timestamptz;next_layer text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','receipt','expected_attempt_version','expected_turn_version',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-turn-finalize@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'receipt') is distinct from 'object'
    or command->>'expected_attempt_version'!~'^[1-9][0-9]*$'
    or command->>'expected_turn_version'!~'^[1-9][0-9]*$'
  then raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID'; end if;
  receipt:=command->'receipt';
  if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','gate_id','attempt_id','manifest_hash','turn_ordinal','turn_id',
      'layer','scenario_id','scenario_turn_index','conversation_id',
      'conversation_resource_version','run_id','question_hash','worker_build_hash',
      'worker_generation_hash','semantic_release_hash','business_receipt_hash',
      'qa_ui_receipt_hash','trace_ui_receipt_hash','status','failure_code','finalized_at',
      'receipt_hash']::text[]) is distinct from true
    or receipt->>'status' not in('PASS','FAILED')
    or ((receipt->>'status'='PASS')<>(receipt->'failure_code'='null'::jsonb))
    or receipt->>'business_receipt_hash'!~'^sha256:[0-9a-f]{64}$'
    or (receipt->>'status'='PASS' and (
      receipt->>'qa_ui_receipt_hash'!~'^sha256:[0-9a-f]{64}$'
      or receipt->>'trace_ui_receipt_hash'!~'^sha256:[0-9a-f]{64}$'))
    or app_data_agent.contains_potential_plaintext_secret(receipt)
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_TERMINAL_RECEIPT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:falcon24-four-layer-attempt:'||receipt->>'attempt_id',0));
  select * into attempt from app_data_agent.falcon24_four_layer_gate_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(receipt->>'attempt_id')::uuid for update;
  select * into turn from app_data_agent.falcon24_four_layer_gate_turns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(receipt->>'attempt_id')::uuid
      and row.turn_ordinal=(receipt->>'turn_ordinal')::integer for update;
  if attempt.attempt_id is null or turn.attempt_id is null
  then raise exception using errcode='02000',message='FALCON24_FOUR_LAYER_NOT_FOUND'; end if;
  if turn.terminal_receipt is not null then
    if turn.terminal_receipt_hash=receipt->>'receipt_hash' and turn.terminal_receipt=receipt
    then return pg_catalog.jsonb_build_object(
      'attempt',pg_catalog.to_jsonb(attempt),'turn',pg_catalog.to_jsonb(turn)); end if;
    raise exception using errcode='55000',message='FALCON24_FOUR_LAYER_REPLAY_MISMATCH';
  end if;
  if attempt.attempt_version<>(command->>'expected_attempt_version')::bigint
    or turn.turn_version<>(command->>'expected_turn_version')::bigint
  then raise exception using errcode='40001',message='FALCON24_FOUR_LAYER_VERSION_CONFLICT'; end if;
  if app_data_agent.falcon24_four_layer_receipt_identity_matches(
      pg_catalog.to_jsonb(attempt),pg_catalog.to_jsonb(turn),receipt,
      'falcon24-four-layer-turn-terminal-receipt@1.0.0',false) is distinct from true
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_RECEIPT_IDENTITY_MISMATCH'; end if;
  if receipt->>'business_receipt_hash'<>turn.business_receipt_hash
    or receipt->'qa_ui_receipt_hash' is distinct from
      pg_catalog.coalesce(pg_catalog.to_jsonb(turn.qa_ui_receipt_hash),'null'::jsonb)
    or receipt->'trace_ui_receipt_hash' is distinct from
      pg_catalog.coalesce(pg_catalog.to_jsonb(turn.trace_ui_receipt_hash),'null'::jsonb)
    or (receipt->>'status'='PASS' and turn.status<>'TRACE_PASSED')
    or (receipt->>'status'='FAILED' and turn.status not in(
      'BUSINESS_FAILED','QA_FAILED','TRACE_FAILED'))
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_TERMINAL_CLOSURE_INVALID'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_four_layer_gate_turns set
    terminal_receipt_hash=receipt->>'receipt_hash',terminal_receipt=receipt,
    status=case when receipt->>'status'='PASS' then 'PASSED' else 'FAILED' end,
    completed_at=now_at,updated_at=now_at,turn_version=turn_version+1
    where app_id=turn.app_id and tenant_id=turn.tenant_id and environment=turn.environment
      and principal_id=turn.principal_id and attempt_id=turn.attempt_id
      and turn_ordinal=turn.turn_ordinal
    returning * into strict turn;
  if receipt->>'status'='PASS' then
    next_layer:=case
      when turn.turn_ordinal<4 then 'L1'
      when turn.turn_ordinal<6 then 'L2'
      when turn.turn_ordinal<8 then 'L3'
      when turn.turn_ordinal<14 then 'L4'
      else 'COMPLETE' end;
    update app_data_agent.falcon24_four_layer_gate_attempts set
      next_turn_ordinal=turn.turn_ordinal+1,current_layer=next_layer,
      status=case when turn.turn_ordinal=14 then 'FINALIZING' else 'READY' end,
      updated_at=now_at,attempt_version=attempt_version+1
      where app_id=attempt.app_id and tenant_id=attempt.tenant_id
        and environment=attempt.environment and principal_id=attempt.principal_id
        and attempt_id=attempt.attempt_id and status='RUNNING'
        and next_turn_ordinal=turn.turn_ordinal
      returning * into strict attempt;
  else
    update app_data_agent.falcon24_four_layer_gate_attempts set
      updated_at=now_at,attempt_version=attempt_version+1
      where app_id=attempt.app_id and tenant_id=attempt.tenant_id
        and environment=attempt.environment and principal_id=attempt.principal_id
        and attempt_id=attempt.attempt_id and status='FAILED'
      returning * into strict attempt;
  end if;
  return pg_catalog.jsonb_build_object(
    'attempt',pg_catalog.to_jsonb(attempt),'turn',pg_catalog.to_jsonb(turn));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID';
end
$function$;

create function app_data_agent.finalize_falcon24_four_layer_gate_attempt(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record;attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;
  now_at timestamptz;turn_receipt_hashes jsonb;receipt jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','attempt_id','expected_attempt_version','command_hash']::text[])
      is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-attempt-finalize@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or command->>'expected_attempt_version'!~'^[1-9][0-9]*$'
  then raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:falcon24-four-layer-attempt:'||command->>'attempt_id',0));
  select * into attempt from app_data_agent.falcon24_four_layer_gate_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(command->>'attempt_id')::uuid for update;
  if attempt.attempt_id is null
  then raise exception using errcode='02000',message='FALCON24_FOUR_LAYER_NOT_FOUND'; end if;
  if attempt.status='PASSED' then return pg_catalog.to_jsonb(attempt); end if;
  if attempt.attempt_version<>(command->>'expected_attempt_version')::bigint
  then raise exception using errcode='40001',message='FALCON24_FOUR_LAYER_VERSION_CONFLICT'; end if;
  select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row.terminal_receipt_hash)
      order by row.turn_ordinal) into strict turn_receipt_hashes
    from app_data_agent.falcon24_four_layer_gate_turns row
    where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
      and row.environment=attempt.environment and row.principal_id=attempt.principal_id
      and row.attempt_id=attempt.attempt_id and row.status='PASSED';
  if attempt.status<>'FINALIZING' or attempt.next_turn_ordinal<>15
    or attempt.current_layer<>'COMPLETE'
    or pg_catalog.jsonb_array_length(turn_receipt_hashes)<>15
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_ATTEMPT_FINALIZATION_INVALID'; end if;
  now_at:=pg_catalog.clock_timestamp();
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-four-layer-attempt-terminal-receipt@1.0.0',
    'gate_id',attempt.gate_id,'attempt_id',attempt.attempt_id,
    'manifest_hash',attempt.manifest_hash,'worker_build_hash',attempt.worker_build_hash,
    'worker_generation_hash',attempt.worker_generation_hash,
    'web_build_hash',attempt.web_build_hash,'web_generation_hash',attempt.web_generation_hash,
    'semantic_release_hash',attempt.semantic_release_hash,
    'turn_receipt_hashes',turn_receipt_hashes,'status','PASS','failure_code',null,
    'finalized_at',now_at);
  receipt:=receipt||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(receipt));
  update app_data_agent.falcon24_four_layer_gate_attempts set status='PASSED',
    terminal_receipt_hash=receipt->>'receipt_hash',terminal_receipt=receipt,
    updated_at=now_at,attempt_version=attempt_version+1
    where app_id=attempt.app_id and tenant_id=attempt.tenant_id
      and environment=attempt.environment and principal_id=attempt.principal_id
      and attempt_id=attempt.attempt_id and status='FINALIZING'
    returning * into strict attempt;
  return pg_catalog.to_jsonb(attempt);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID';
end
$function$;
create function app_data_agent.falcon24_four_layer_attempt_state_fence()
returns trigger language plpgsql set search_path='' as $function$
begin
  if tg_op='DELETE' then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_ATTEMPT_IMMUTABLE'; end if;
  if new.app_id<>old.app_id or new.tenant_id<>old.tenant_id
    or new.environment<>old.environment or new.principal_id<>old.principal_id
    or new.gate_id<>old.gate_id or new.attempt_id<>old.attempt_id
    or new.authority_epoch<>old.authority_epoch
    or new.authority_baseline_id<>old.authority_baseline_id
    or new.authority_baseline_hash<>old.authority_baseline_hash
    or new.authority_activation_attempt_id<>old.authority_activation_attempt_id
    or new.source_commit<>old.source_commit or new.worker_build_hash<>old.worker_build_hash
    or new.worker_generation_hash<>old.worker_generation_hash
    or new.web_build_hash<>old.web_build_hash or new.web_generation_hash<>old.web_generation_hash
    or new.semantic_release_hash<>old.semantic_release_hash
    or new.datasource_binding_hash<>old.datasource_binding_hash
    or new.model_config_hash<>old.model_config_hash
    or new.runtime_attestation_hash<>old.runtime_attestation_hash
    or new.manifest_hash<>old.manifest_hash or new.manifest_document<>old.manifest_document
    or new.created_at<>old.created_at or new.attempt_version<>old.attempt_version+1
    or new.next_turn_ordinal not in(old.next_turn_ordinal,old.next_turn_ordinal+1)
    or (old.first_failure_code is not null and (
      new.first_failure_turn_ordinal<>old.first_failure_turn_ordinal
      or new.first_failure_run_id<>old.first_failure_run_id
      or new.first_failure_code<>old.first_failure_code))
    or (old.terminal_receipt is not null and (
      new.terminal_receipt_hash<>old.terminal_receipt_hash
      or new.terminal_receipt<>old.terminal_receipt))
    or not ((new.status=old.status)
      or (old.status='READY' and new.status='RUNNING')
      or (old.status='RUNNING' and new.status in('READY','FINALIZING','FAILED'))
      or (old.status='FAILED' and new.status='FAILED')
      or (old.status='FINALIZING' and new.status='PASSED'))
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_ATTEMPT_STATE_INVALID'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_four_layer_turn_state_fence()
returns trigger language plpgsql set search_path='' as $function$
begin
  if tg_op='DELETE' then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_TURN_IMMUTABLE'; end if;
  if new.app_id<>old.app_id or new.tenant_id<>old.tenant_id
    or new.environment<>old.environment or new.principal_id<>old.principal_id
    or new.attempt_id<>old.attempt_id or new.turn_ordinal<>old.turn_ordinal
    or new.turn_id<>old.turn_id or new.layer<>old.layer or new.scenario_id<>old.scenario_id
    or new.scenario_turn_index<>old.scenario_turn_index
    or new.conversation_group is distinct from old.conversation_group
    or new.conversation_mode<>old.conversation_mode or new.question<>old.question
    or new.question_hash<>old.question_hash or new.expected_agents<>old.expected_agents
    or new.rubric<>old.rubric or new.created_at<>old.created_at
    or new.turn_version<>old.turn_version+1
    or (old.conversation_id is not null and (
      new.conversation_id<>old.conversation_id
      or new.conversation_resource_version<>old.conversation_resource_version
      or new.run_id<>old.run_id or new.claim_command_hash<>old.claim_command_hash
      or new.claimed_at<>old.claimed_at))
    or (old.business_receipt is not null and (
      new.business_receipt_hash<>old.business_receipt_hash
      or new.business_receipt<>old.business_receipt))
    or (old.qa_ui_receipt is not null and (
      new.qa_ui_receipt_hash<>old.qa_ui_receipt_hash or new.qa_ui_receipt<>old.qa_ui_receipt))
    or (old.trace_ui_receipt is not null and (
      new.trace_ui_receipt_hash<>old.trace_ui_receipt_hash
      or new.trace_ui_receipt<>old.trace_ui_receipt))
    or (old.terminal_receipt is not null and (
      new.terminal_receipt_hash<>old.terminal_receipt_hash
      or new.terminal_receipt<>old.terminal_receipt))
    or not ((old.status='PLANNED' and new.status='CLAIMED')
      or (old.status='CLAIMED' and new.status in('BUSINESS_PASSED','BUSINESS_FAILED'))
      or (old.status='BUSINESS_PASSED' and new.status in('QA_PASSED','QA_FAILED'))
      or (old.status='QA_PASSED' and new.status in('TRACE_PASSED','TRACE_FAILED'))
      or (old.status='TRACE_PASSED' and new.status='PASSED')
      or (old.status in('BUSINESS_FAILED','QA_FAILED','TRACE_FAILED') and new.status='FAILED'))
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_TURN_STATE_INVALID'; end if;
  return new;
end
$function$;

create trigger falcon24_four_layer_attempt_state_fence
before update or delete on app_data_agent.falcon24_four_layer_gate_attempts
for each row execute function app_data_agent.falcon24_four_layer_attempt_state_fence();
create trigger falcon24_four_layer_turn_state_fence
before update or delete on app_data_agent.falcon24_four_layer_gate_turns
for each row execute function app_data_agent.falcon24_four_layer_turn_state_fence();

alter table app_data_agent.falcon24_four_layer_gate_attempts owner to data_agent_u6_data_owner;
alter table app_data_agent.falcon24_four_layer_gate_turns owner to data_agent_u6_data_owner;
alter function app_data_agent.falcon24_four_layer_attempt_state_fence()
  owner to data_agent_u6_data_owner;
alter function app_data_agent.falcon24_four_layer_turn_state_fence()
  owner to data_agent_u6_data_owner;

alter function app_data_agent.falcon24_four_layer_receipt_identity_matches(
  jsonb,jsonb,jsonb,text,boolean) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_four_layer_agent_contract_matches(jsonb,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_four_layer_gate_attempt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_four_layer_gate_turn(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_four_layer_gate(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.claim_falcon24_four_layer_gate_turn(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_falcon24_four_layer_qa_ui_receipt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_falcon24_four_layer_trace_ui_receipt(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.finalize_falcon24_four_layer_gate_turn(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.finalize_falcon24_four_layer_gate_attempt(jsonb)
  owner to data_agent_u6_rpc_owner;

grant select,insert,update on table
  app_data_agent.falcon24_four_layer_gate_attempts,
  app_data_agent.falcon24_four_layer_gate_turns to data_agent_u6_rpc_owner;
grant select on table app_data_agent.falcon24_current_authority_epoch,
  app_data_agent.qa_conversations,app_data_agent.runs,
  app_data_agent.workspace_run_bindings to data_agent_u6_rpc_owner;

revoke all on table app_data_agent.falcon24_four_layer_gate_attempts,
  app_data_agent.falcon24_four_layer_gate_turns
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function
  app_data_agent.falcon24_four_layer_attempt_state_fence(),
  app_data_agent.falcon24_four_layer_turn_state_fence(),
  app_data_agent.falcon24_four_layer_receipt_identity_matches(jsonb,jsonb,jsonb,text,boolean),
  app_data_agent.falcon24_four_layer_agent_contract_matches(jsonb,jsonb)
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function
  app_data_agent.load_falcon24_four_layer_gate_attempt(jsonb),
  app_data_agent.load_falcon24_four_layer_gate_turn(jsonb),
  app_data_agent.begin_falcon24_four_layer_gate(jsonb),
  app_data_agent.claim_falcon24_four_layer_gate_turn(jsonb),
  app_data_agent.record_falcon24_four_layer_business_receipt(jsonb),
  app_data_agent.record_falcon24_four_layer_qa_ui_receipt(jsonb),
  app_data_agent.record_falcon24_four_layer_trace_ui_receipt(jsonb),
  app_data_agent.finalize_falcon24_four_layer_gate_turn(jsonb),
  app_data_agent.finalize_falcon24_four_layer_gate_attempt(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
grant execute on function
  app_data_agent.load_falcon24_four_layer_gate_attempt(jsonb),
  app_data_agent.load_falcon24_four_layer_gate_turn(jsonb),
  app_data_agent.begin_falcon24_four_layer_gate(jsonb),
  app_data_agent.claim_falcon24_four_layer_gate_turn(jsonb),
  app_data_agent.record_falcon24_four_layer_business_receipt(jsonb),
  app_data_agent.record_falcon24_four_layer_qa_ui_receipt(jsonb),
  app_data_agent.record_falcon24_four_layer_trace_ui_receipt(jsonb),
  app_data_agent.finalize_falcon24_four_layer_gate_turn(jsonb),
  app_data_agent.finalize_falcon24_four_layer_gate_attempt(jsonb)
  to data_agent_backend;
do $postconditions$
declare relation_name text;schema_name text;table_name text;
  after_count bigint;after_digest text;before_row record;definition text;
begin
  if not exists(select 1 from pg_catalog.pg_class relation
      where relation.oid='app_data_agent.falcon24_four_layer_gate_attempts'::regclass
        and relation.relrowsecurity and relation.relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class relation
      where relation.oid='app_data_agent.falcon24_four_layer_gate_turns'::regclass
        and relation.relrowsecurity and relation.relforcerowsecurity)
    or (select pg_catalog.count(*) from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgname in('falcon24_four_layer_attempt_state_fence',
        'falcon24_four_layer_turn_state_fence') and not trigger_row.tgisinternal)<>2
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_four_layer_gate_attempts','SELECT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_four_layer_gate_turns','SELECT')
  then raise exception using errcode='P0001',
    message='FALCON24_FOUR_LAYER_GATE_POSTCONDITION_FAILED'; end if;
  foreach definition in array array[
    'app_data_agent.load_falcon24_four_layer_gate_attempt(jsonb)',
    'app_data_agent.load_falcon24_four_layer_gate_turn(jsonb)',
    'app_data_agent.begin_falcon24_four_layer_gate(jsonb)',
    'app_data_agent.claim_falcon24_four_layer_gate_turn(jsonb)',
    'app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)',
    'app_data_agent.record_falcon24_four_layer_qa_ui_receipt(jsonb)',
    'app_data_agent.record_falcon24_four_layer_trace_ui_receipt(jsonb)',
    'app_data_agent.finalize_falcon24_four_layer_gate_turn(jsonb)',
    'app_data_agent.finalize_falcon24_four_layer_gate_attempt(jsonb)']::text[] loop
    if pg_catalog.to_regprocedure(definition) is null
      or pg_catalog.has_function_privilege('public',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('anon',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('service_role',definition,'EXECUTE')
      or not pg_catalog.has_function_privilege('data_agent_backend',definition,'EXECUTE')
    then raise exception using errcode='P0001',
      message='FALCON24_FOUR_LAYER_GATE_POSTCONDITION_FAILED'; end if;
  end loop;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.begin_falcon24_four_layer_gate(jsonb)'::regprocedure)
    into strict definition;
  if pg_catalog.strpos(definition,
      'sha256:c01c7944368ebdd0ae9fb2e69c9b809cb0cb24a2de65076da934e95a23c396e9')=0
    or pg_catalog.strpos(definition,'array[5,2,2,6]::integer[]')=0
  then raise exception using errcode='P0001',
    message='FALCON24_FOUR_LAYER_GATE_POSTCONDITION_FAILED'; end if;
  for before_row in select * from falcon24_10803_history_snapshot order by relation_name loop
    relation_name:=before_row.relation_name;
    schema_name:=pg_catalog.split_part(relation_name,'.',1);
    table_name:=pg_catalog.split_part(relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by to_jsonb(row_value)::text),'
      ||'''[]''::jsonb)) from %I.%I as row_value',schema_name,table_name)
      into strict after_count,after_digest;
    if after_count<>before_row.row_count or after_digest<>before_row.row_digest
    then raise exception using errcode='P0001',
      message='FALCON24_FOUR_LAYER_HISTORY_DRIFT'; end if;
  end loop;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010803_app_data_agent_falcon24_four_layer_gate',
  'sha256:ff25d3e347e3645634f280bec34f26d0718ce727a0638e7f9316b9155b351892');

commit;
