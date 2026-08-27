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
