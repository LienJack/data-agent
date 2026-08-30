-- falcon24_ready_attempt_supersession_migration_checksum: sha256:2204b6f357a3ef32c84e57700944c5929cce7fa16f3327d7dee36dc19813fb3a
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare constraint_definition text;fence_definition text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010809_app_data_agent_falcon24_turn_finalization_coalesce_repair'
        and migration_checksum=
          'sha256:041ec7901f58736da4b9905a6c79566850403d678ca27136519bdb6c63c09e3d')
    or pg_catalog.to_regprocedure(
      'app_data_agent.supersede_falcon24_four_layer_gate_attempt(jsonb)') is not null
  then raise exception using errcode='P0001',
    message='FALCON24_READY_SUPERSESSION_BASELINE_DRIFT'; end if;

  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    into strict constraint_definition
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid=
        'app_data_agent.falcon24_four_layer_gate_attempts'::regclass
      and constraint_row.conname='falcon24_four_layer_gate_attempts_check'
      and constraint_row.contype='c';
  select procedure_row.prosrc into strict fence_definition
    from pg_catalog.pg_proc procedure_row
    where procedure_row.oid=
      'app_data_agent.falcon24_four_layer_attempt_state_fence()'::regprocedure;
  if pg_catalog.strpos(constraint_definition,
      '(first_failure_turn_ordinal IS NULL) = (first_failure_code IS NULL)')=0
    or pg_catalog.strpos(fence_definition,
      '(old.status=''READY'' and new.status=''RUNNING'')')=0
    or pg_catalog.strpos(fence_definition,
      'old.status=''READY'' and new.status=''FAILED''')>0
  then raise exception using errcode='P0001',
    message='FALCON24_READY_SUPERSESSION_SOURCE_MISMATCH'; end if;
end
$preflight$;

create temporary table falcon24_10810_attempt_history_snapshot(
  row_count bigint not null,row_digest text not null
) on commit drop;
insert into falcon24_10810_attempt_history_snapshot
select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256(
  coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_value)
    order by pg_catalog.to_jsonb(row_value)::text),'[]'::jsonb))
from app_data_agent.falcon24_four_layer_gate_attempts row_value;

create temporary table falcon24_10810_turn_history_snapshot(
  row_count bigint not null,row_digest text not null
) on commit drop;
insert into falcon24_10810_turn_history_snapshot
select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256(
  coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_value)
    order by pg_catalog.to_jsonb(row_value)::text),'[]'::jsonb))
from app_data_agent.falcon24_four_layer_gate_turns row_value;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';

alter table app_data_agent.falcon24_four_layer_gate_attempts
  drop constraint falcon24_four_layer_gate_attempts_check;
alter table app_data_agent.falcon24_four_layer_gate_attempts
  add constraint falcon24_four_layer_gate_attempts_check check(
    gate_id=authority_epoch||'-FL1' and authority_epoch~'^E[1-9][0-9]*$'
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
    and (
      (first_failure_turn_ordinal is null and first_failure_code is null)
      or (first_failure_turn_ordinal is null
        and first_failure_code='FALCON24_FROZEN_CLOSURE_BUILD_SUPERSEDED')
      or (first_failure_turn_ordinal is not null and first_failure_code is not null
        and first_failure_code<>'FALCON24_FROZEN_CLOSURE_BUILD_SUPERSEDED')
    )
    and (first_failure_turn_ordinal is null
      or first_failure_turn_ordinal between 0 and 14)
    and (first_failure_code is null or first_failure_code~'^[A-Z][A-Z0-9_]{2,127}$')
    and ((status='FAILED')=(first_failure_code is not null))
    and ((terminal_receipt_hash is null)=(terminal_receipt is null))
    and (terminal_receipt_hash is null
      or terminal_receipt_hash~'^sha256:[0-9a-f]{64}$')
    and (status<>'PASSED' or (next_turn_ordinal=15 and current_layer='COMPLETE'
      and terminal_receipt is not null))
  );

create or replace function app_data_agent.falcon24_four_layer_attempt_state_fence()
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
      or (old.status='READY' and new.status='FAILED'
        and old.next_turn_ordinal=0 and new.next_turn_ordinal=0
        and old.first_failure_code is null
        and new.first_failure_turn_ordinal is null
        and new.first_failure_run_id is null
        and new.first_failure_code='FALCON24_FROZEN_CLOSURE_BUILD_SUPERSEDED'
        and new.terminal_receipt is null)
      or (old.status='RUNNING' and new.status in('READY','FINALIZING','FAILED'))
      or (old.status='FAILED' and new.status='FAILED')
      or (old.status='FINALIZING' and new.status='PASSED'))
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_ATTEMPT_STATE_INVALID'; end if;
  return new;
end
$function$;
alter function app_data_agent.falcon24_four_layer_attempt_state_fence()
  owner to data_agent_u6_data_owner;

create function app_data_agent.supersede_falcon24_four_layer_gate_attempt(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record;attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;
  planned_turn_count integer;now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','attempt_id','expected_attempt_version','reason_code','command_hash'
    ]::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-attempt-supersede@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id')
      is distinct from true
    or command->>'expected_attempt_version'!~'^[1-9][0-9]*$'
    or command->>'reason_code'<>'FALCON24_FROZEN_CLOSURE_BUILD_SUPERSEDED'
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_COMMAND_INVALID'; end if;

  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:falcon24-four-layer:'||authority.app_id::text||':'||
    authority.tenant_id::text||':'||authority.environment||':'||authority.principal_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:falcon24-four-layer-attempt:'||(command->>'attempt_id'),0));
  select * into attempt from app_data_agent.falcon24_four_layer_gate_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(command->>'attempt_id')::uuid for update;
  if not found then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_NOT_FOUND'; end if;
  if attempt.attempt_version<>(command->>'expected_attempt_version')::bigint
  then raise exception using errcode='40001',
    message='FALCON24_FOUR_LAYER_VERSION_CONFLICT'; end if;

  select pg_catalog.count(*)::integer into strict planned_turn_count
    from app_data_agent.falcon24_four_layer_gate_turns row
    where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
      and row.environment=attempt.environment and row.principal_id=attempt.principal_id
      and row.attempt_id=attempt.attempt_id and row.status='PLANNED'
      and row.conversation_id is null and row.conversation_resource_version is null
      and row.run_id is null and row.claim_command_hash is null
      and row.business_receipt is null and row.qa_ui_receipt is null
      and row.trace_ui_receipt is null and row.terminal_receipt is null
      and row.claimed_at is null and row.completed_at is null;
  if attempt.status<>'READY' or attempt.current_layer<>'L1'
    or attempt.next_turn_ordinal<>0 or attempt.first_failure_code is not null
    or attempt.terminal_receipt is not null or planned_turn_count<>15
    or exists(select 1 from app_data_agent.falcon24_four_layer_gate_turns row
      where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
        and row.environment=attempt.environment and row.principal_id=attempt.principal_id
        and row.attempt_id=attempt.attempt_id
        and (row.status<>'PLANNED' or row.run_id is not null))
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_SUPERSEDE_INVALID'; end if;

  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_four_layer_gate_attempts set
    status='FAILED',
    first_failure_code='FALCON24_FROZEN_CLOSURE_BUILD_SUPERSEDED',
    updated_at=now_at,attempt_version=attempt_version+1
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id
    and environment=attempt.environment and principal_id=attempt.principal_id
    and attempt_id=attempt.attempt_id and status='READY'
    and attempt_version=attempt.attempt_version
  returning * into strict attempt;
  return pg_catalog.to_jsonb(attempt);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID';
end
$function$;
alter function app_data_agent.supersede_falcon24_four_layer_gate_attempt(jsonb)
  owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.supersede_falcon24_four_layer_gate_attempt(jsonb)
  from public;
grant execute on function app_data_agent.supersede_falcon24_four_layer_gate_attempt(jsonb)
  to data_agent_backend;

do $postconditions$
declare constraint_definition text;fence_definition text;rpc_definition text;
  owner_name text;security_definer boolean;attempt_count bigint;attempt_digest text;
  turn_count bigint;turn_digest text;attempt_before record;turn_before record;
begin
  select pg_catalog.pg_get_constraintdef(constraint_row.oid)
    into strict constraint_definition
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid=
        'app_data_agent.falcon24_four_layer_gate_attempts'::regclass
      and constraint_row.conname='falcon24_four_layer_gate_attempts_check'
      and constraint_row.contype='c';
  select procedure_row.prosrc into strict fence_definition
    from pg_catalog.pg_proc procedure_row
    where procedure_row.oid=
      'app_data_agent.falcon24_four_layer_attempt_state_fence()'::regprocedure;
  select pg_catalog.pg_get_functiondef(procedure_row.oid),owner_role.rolname,
    procedure_row.prosecdef into strict rpc_definition,owner_name,security_definer
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_roles owner_role on owner_role.oid=procedure_row.proowner
    where procedure_row.oid=
      'app_data_agent.supersede_falcon24_four_layer_gate_attempt(jsonb)'::regprocedure;
  if pg_catalog.strpos(constraint_definition,
      'FALCON24_FROZEN_CLOSURE_BUILD_SUPERSEDED')=0
    or pg_catalog.strpos(fence_definition,
      'old.status=''READY'' and new.status=''FAILED''')=0
    or pg_catalog.strpos(rpc_definition,
      'FALCON24_FOUR_LAYER_SUPERSEDE_INVALID')=0
    or owner_name<>'data_agent_u6_rpc_owner' or security_definer is distinct from true
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.supersede_falcon24_four_layer_gate_attempt(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.supersede_falcon24_four_layer_gate_attempt(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',
    message='FALCON24_READY_SUPERSESSION_POSTCONDITION_FAILED'; end if;

  select * into strict attempt_before from falcon24_10810_attempt_history_snapshot;
  select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256(
    coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_value)
      order by pg_catalog.to_jsonb(row_value)::text),'[]'::jsonb))
    into strict attempt_count,attempt_digest
    from app_data_agent.falcon24_four_layer_gate_attempts row_value;
  if attempt_count<>attempt_before.row_count or attempt_digest<>attempt_before.row_digest
  then raise exception using errcode='P0001',
    message='FALCON24_READY_SUPERSESSION_ATTEMPT_HISTORY_DRIFT'; end if;

  select * into strict turn_before from falcon24_10810_turn_history_snapshot;
  select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256(
    coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_value)
      order by pg_catalog.to_jsonb(row_value)::text),'[]'::jsonb))
    into strict turn_count,turn_digest
    from app_data_agent.falcon24_four_layer_gate_turns row_value;
  if turn_count<>turn_before.row_count or turn_digest<>turn_before.row_digest
  then raise exception using errcode='P0001',
    message='FALCON24_READY_SUPERSESSION_TURN_HISTORY_DRIFT'; end if;
end
$postconditions$;

select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010810_app_data_agent_falcon24_ready_attempt_supersession',
  'sha256:2204b6f357a3ef32c84e57700944c5929cce7fa16f3327d7dee36dc19813fb3a');

commit;
