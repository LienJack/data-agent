\set ON_ERROR_STOP on

begin;

select pg_catalog.set_config(
  'data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config(
  'data_agent.tenant_id','00000000-0000-4000-8000-00000000aa22',true);
select pg_catalog.set_config('data_agent.environment','test',true);
select pg_catalog.set_config(
  'data_agent.principal_id','00000000-0000-4000-8000-000000001003',true);
select pg_catalog.set_config('data_agent.role','owner',true);
select pg_catalog.set_config(
  'data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',true);

insert into app_data_agent.runs(
  app_id,tenant_id,environment,run_id,principal_id,status,question)
values(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,
  'test','00000000-0000-4000-8000-000000005401'::uuid,
  '00000000-0000-4000-8000-000000001003'::uuid,
  'RUNNING','Falcon24 non-terminal campaign authority assertion'),(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,
  'test','00000000-0000-4000-8000-000000005411'::uuid,
  '00000000-0000-4000-8000-000000001003'::uuid,
  'SUCCEEDED','Falcon24 successful campaign authority assertion');

insert into app_data_agent.falcon24_acceptance_campaigns(
  app_id,tenant_id,environment,principal_id,campaign_id,campaign_version,
  source_fingerprint,frozen_contract_hash,runtime_attestation_hash,manifest_hash,
  policy_id,run_count,next_run_ordinal,status,created_at,updated_at)
values(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,'test',
  '00000000-0000-4000-8000-000000001003'::uuid,
  'falcon24-test-v13-authority',13,
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'falcon24-strict-zero-retry@1.0.0',30,0,'RUNNING',
  pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()),(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,'test',
  '00000000-0000-4000-8000-000000001003'::uuid,
  'falcon24-test-v14-authority',14,
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  'falcon24-strict-zero-retry@1.0.0',30,0,'RUNNING',
  pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp());

insert into app_data_agent.falcon24_acceptance_campaign_runs(
  app_id,tenant_id,environment,principal_id,campaign_id,run_ordinal,run_id,
  case_id,run_variant,repetition,status,claimed_at)
values(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,'test',
  '00000000-0000-4000-8000-000000001003'::uuid,
  'falcon24-test-v13-authority',0,
  '00000000-0000-4000-8000-000000005401'::uuid,
  'falcon24-business-review-18m','COLD',1,'CLAIMED',pg_catalog.clock_timestamp()),(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,'test',
  '00000000-0000-4000-8000-000000001003'::uuid,
  'falcon24-test-v14-authority',0,
  '00000000-0000-4000-8000-000000005411'::uuid,
  'falcon24-business-review-18m','COLD',1,'CLAIMED',pg_catalog.clock_timestamp());

do $assertion$
declare observation jsonb; receipt jsonb; command jsonb; result_document jsonb; result_hash text;
  recorded jsonb; completed jsonb;
begin
  observation:=pg_catalog.jsonb_build_object(
    'management_observation_schema_version',
      'opensandbox-management-reclamation-observation@1.0.0',
    'management_operation_id','00000000-0000-4000-8000-000000005402',
    'observation_source','OPENSANDBOX_MANAGEMENT_API',
    'target_metadata_hash',
      'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'before_observation',pg_catalog.jsonb_build_object(
      'active_count',1,'observation_hash',
      'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
    'killed',1,
    'after_observation',pg_catalog.jsonb_build_object(
      'active_count',0,'observation_hash',
      'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
    'residual',0,'completed_at','2026-08-26T00:00:00.000Z');
  observation:=observation||pg_catalog.jsonb_build_object(
    'management_observation_hash',app_data_agent.u2_canonical_sha256(observation));
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-sandbox-reclamation-receipt@2.0.0',
    'campaign_id','falcon24-test-v13-authority',
    'run_id','00000000-0000-4000-8000-000000005401',
    'runtime_attestation_hash',
      'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc')
    ||observation;
  receipt:=receipt||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(receipt));
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-sandbox-reclamation-record@1.0.0',
    'campaign_id','falcon24-test-v13-authority',
    'run_id','00000000-0000-4000-8000-000000005401',
    'sandbox_reclamation_hash',receipt->>'receipt_hash',
    'sandbox_reclamation_receipt',receipt);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(command));
  if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','campaign_id','run_id','runtime_attestation_hash',
      'management_observation_schema_version','management_operation_id','observation_source',
      'target_metadata_hash','before_observation','killed','after_observation','residual',
      'completed_at','management_observation_hash','receipt_hash']::text[])
      is distinct from true
  then raise exception 'FALCON24_RECLAMATION_FIXTURE_KEYS_INVALID'; end if;
  if receipt->>'management_observation_hash' is distinct from
      app_data_agent.u2_canonical_sha256(receipt-array[
        'schema_version','campaign_id','run_id','runtime_attestation_hash',
        'management_observation_hash','receipt_hash']::text[])
  then raise exception 'FALCON24_RECLAMATION_FIXTURE_OBSERVATION_HASH_INVALID'; end if;
  if receipt->>'receipt_hash' is distinct from
      app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
  then raise exception 'FALCON24_RECLAMATION_FIXTURE_RECEIPT_HASH_INVALID'; end if;
  begin
    perform app_data_agent.record_falcon24_sandbox_reclamation(command);
    raise exception 'FALCON24_NON_TERMINAL_RUN_WAS_RECORDED';
  exception when others then
    if sqlerrm<>'FALCON24_ACTUAL_RUN_NOT_SUCCEEDED' then raise; end if;
  end;

  observation:=pg_catalog.jsonb_build_object(
    'management_observation_schema_version',
      'opensandbox-management-reclamation-observation@1.0.0',
    'management_operation_id','00000000-0000-4000-8000-000000005412',
    'observation_source','OPENSANDBOX_MANAGEMENT_API',
    'target_metadata_hash',
      'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'before_observation',pg_catalog.jsonb_build_object(
      'active_count',1,'observation_hash',
      'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
    'killed',1,
    'after_observation',pg_catalog.jsonb_build_object(
      'active_count',0,'observation_hash',
      'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
    'residual',0,'completed_at','2026-08-26T00:00:00.000Z');
  observation:=observation||pg_catalog.jsonb_build_object(
    'management_observation_hash',app_data_agent.u2_canonical_sha256(observation));
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-sandbox-reclamation-receipt@2.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'runtime_attestation_hash',
      'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc')
    ||observation;
  receipt:=receipt||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(receipt));
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-sandbox-reclamation-record@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'sandbox_reclamation_hash',receipt->>'receipt_hash',
    'sandbox_reclamation_receipt',receipt);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(command));

  recorded:=app_data_agent.record_falcon24_sandbox_reclamation(command);
  if recorded#>>'{sandbox_reclamation_receipt,observation_source}'
      is distinct from 'OPENSANDBOX_MANAGEMENT_API'
    or recorded#>>'{sandbox_reclamation_receipt,runtime_attestation_hash}'
      is distinct from
        'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    or recorded#>>'{sandbox_reclamation_receipt,after_observation,active_count}'
      is distinct from '0'
    or recorded#>>'{sandbox_reclamation_receipt,management_observation_hash}'
      is distinct from observation->>'management_observation_hash'
  then raise exception 'FALCON24_RECLAMATION_RECEIPT_NOT_DURABLE'; end if;

  result_document:=pg_catalog.jsonb_build_object(
    'run_id','00000000-0000-4000-8000-000000005411');
  result_hash:=app_data_agent.u2_canonical_sha256(result_document);
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-result-stage@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'result_hash',result_hash,'result_document',result_document);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(command));
  perform app_data_agent.stage_falcon24_acceptance_result(command);

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-run-complete@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'trace_closure_hash',
      'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'expected_result_hash',result_hash,
    'sandbox_reclamation_hash',receipt->>'receipt_hash');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(command));
  completed:=app_data_agent.complete_falcon24_acceptance_run(command);
  if completed->>'status' is distinct from 'READY'
    or completed->>'next_run_ordinal' is distinct from '1'
  then raise exception 'FALCON24_COMPLETION_DID_NOT_ADVANCE_EXACT_RUN'; end if;
end
$assertion$;

rollback;

\echo FALCON24_ACCEPTANCE_CAMPAIGN_ASSERTIONS_PASSED
