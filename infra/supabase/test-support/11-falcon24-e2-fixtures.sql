\set ON_ERROR_STOP on

create or replace function test_support.activate_falcon24_e1_fixture(
  requested_tenant_id uuid,requested_environment text,requested_principal_id uuid,
  requested_deployment_id uuid,requested_production_isolation_proven boolean,
  requested_seed integer)
returns void language plpgsql volatile security definer set search_path='' as $function$
declare source_tenant_id constant uuid:='00000000-0000-4000-8000-00000000aa11'::uuid;
  source_environment text:=case when requested_production_isolation_proven then 'prod' else 'test' end;
  source_current app_data_agent.falcon24_current_authority_epoch%rowtype;
  source_baseline app_data_agent.falcon24_authority_baselines%rowtype;
  source_session app_data_agent.falcon24_authority_staging_sessions%rowtype;
  source_attempt app_data_agent.falcon24_authority_activation_attempts%rowtype;
  now_at timestamptz:=pg_catalog.clock_timestamp();
begin
  if requested_deployment_id is null or requested_seed<1 then
    raise exception 'FALCON24_TEST_FIXTURE_INPUT_INVALID';
  end if;
  perform pg_catalog.set_config('data_agent.app_id',
    '00000000-0000-4000-8000-00000000da01',true);
  perform pg_catalog.set_config('data_agent.tenant_id',requested_tenant_id::text,true);
  perform pg_catalog.set_config('data_agent.environment',requested_environment,true);
  perform pg_catalog.set_config('data_agent.principal_id',requested_principal_id::text,true);
  perform pg_catalog.set_config('data_agent.role','owner',true);
  perform pg_catalog.set_config('data_agent.deployment_id',requested_deployment_id::text,true);
  select * into strict source_current
  from app_data_agent.falcon24_current_authority_epoch current_row
  where current_row.app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and current_row.tenant_id=source_tenant_id
    and current_row.environment=source_environment
    and current_row.authority_epoch='E1';
  select * into strict source_baseline
  from app_data_agent.falcon24_authority_baselines baseline
  where baseline.app_id=source_current.app_id
    and baseline.tenant_id=source_current.tenant_id
    and baseline.environment=source_current.environment
    and baseline.baseline_id=source_current.baseline_id;
  select * into strict source_session
  from app_data_agent.falcon24_authority_staging_sessions session_row
  where session_row.app_id=source_baseline.app_id
    and session_row.tenant_id=source_baseline.tenant_id
    and session_row.environment=source_baseline.environment
    and session_row.staging_id=source_baseline.staging_id;
  select * into strict source_attempt
  from app_data_agent.falcon24_authority_activation_attempts attempt
  where attempt.app_id=source_current.app_id
    and attempt.tenant_id=source_current.tenant_id
    and attempt.environment=source_current.environment
    and attempt.attempt_id=source_current.activation_attempt_id;

  insert into app_data_agent.falcon24_authority_staging_sessions(
    app_id,tenant_id,environment,staging_id,retained_assets_hash,status,failure_code,
    created_by,created_at,updated_at,authority_epoch)
  values(source_session.app_id,requested_tenant_id,requested_environment,
    source_session.staging_id,source_session.retained_assets_hash,'STAGED',null,
    requested_principal_id,now_at,now_at,'E1');

  insert into app_data_agent.falcon24_authority_staging_receipts(
    app_id,tenant_id,environment,staging_id,component,subject_hash,evidence_hash,
    production_isolation_proven,receipt_hash,receipt_document,created_at,authority_epoch)
  select receipt.app_id,requested_tenant_id,requested_environment,receipt.staging_id,
    receipt.component,receipt.subject_hash,receipt.evidence_hash,
    receipt.production_isolation_proven,receipt.receipt_hash,receipt.receipt_document,now_at,'E1'
  from app_data_agent.falcon24_authority_staging_receipts receipt
  where receipt.app_id=source_session.app_id
    and receipt.tenant_id=source_session.tenant_id
    and receipt.environment=source_session.environment
    and receipt.staging_id=source_session.staging_id
    and receipt.authority_epoch='E1';

  insert into app_data_agent.falcon24_authority_baselines(
    app_id,tenant_id,environment,baseline_id,authority_epoch,staging_id,baseline_hash,
    baseline_document,source_commit,retained_assets_hash,web_build_hash,
    production_isolation_proven,production_gate,status,created_by,
    activation_attempt_id,created_at,activated_at)
  values(source_baseline.app_id,requested_tenant_id,requested_environment,
    source_baseline.baseline_id,'E1',source_baseline.staging_id,source_baseline.baseline_hash,
    source_baseline.baseline_document,source_baseline.source_commit,
    source_baseline.retained_assets_hash,source_baseline.web_build_hash,
    source_baseline.production_isolation_proven,source_baseline.production_gate,'STAGED',
    requested_principal_id,null,now_at,null);

  insert into app_data_agent.falcon24_authority_activation_attempts(
    app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash,status,
    failure_code,created_by,created_at,decided_at,authority_epoch)
  values(source_attempt.app_id,requested_tenant_id,requested_environment,
    source_attempt.attempt_id,source_attempt.baseline_id,source_attempt.expected_baseline_hash,
    'OPEN',null,requested_principal_id,now_at,null,'E1');

  update app_data_agent.falcon24_authority_activation_attempts
  set status='ACTIVATED',decided_at=now_at
  where app_id=source_attempt.app_id and tenant_id=requested_tenant_id
    and environment=requested_environment and attempt_id=source_attempt.attempt_id;
  update app_data_agent.falcon24_authority_baselines
  set status='ACTIVE',activation_attempt_id=source_attempt.attempt_id,activated_at=now_at
  where app_id=source_baseline.app_id and tenant_id=requested_tenant_id
    and environment=requested_environment and baseline_id=source_baseline.baseline_id;
  update app_data_agent.falcon24_authority_staging_sessions
  set status='CONSUMED',updated_at=now_at
  where app_id=source_session.app_id and tenant_id=requested_tenant_id
    and environment=requested_environment and staging_id=source_session.staging_id;

  insert into app_data_agent.falcon24_current_authority_epoch(
    app_id,tenant_id,environment,authority_epoch,baseline_id,baseline_hash,
    activation_attempt_id,activated_at)
  values(source_current.app_id,requested_tenant_id,requested_environment,'E1',
    source_current.baseline_id,source_current.baseline_hash,
    source_current.activation_attempt_id,now_at);
end
$function$;
