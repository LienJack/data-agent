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

create function pg_temp.falcon24_qualification_hash(document jsonb)
returns text language sql immutable security definer set search_path='' as $function$
  select app_data_agent.u2_canonical_sha256(document)
$function$;

create function pg_temp.falcon24_qualification_manifest()
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare manifest jsonb; slots jsonb;
begin
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'ordinal',ordinal,'run_id',pg_catalog.format(
        '00000000-0000-4000-8000-%s',pg_catalog.lpad((5500+ordinal)::text,12,'0')),
      'slot_id',stage||'-'||pg_catalog.lpad((case_index+1)::text,2,'0'),
      'stage',stage,'case_id',(array[
        'falcon24-business-review-18m','falcon24-delivery-experience-12m',
        'falcon24-inventory-damage-12m','falcon24-marketing-lag-effect',
        'falcon24-cohort-retention-m0-m6']::text[])[case_index+1],
      'prompt','qualification prompt '||ordinal,
      'prompt_hash',pg_temp.falcon24_qualification_hash(
        pg_catalog.to_jsonb('qualification prompt '||ordinal)),
      'run_variant',case when stage='G4' then 'COLD' else 'WARM' end,
      'expected_path','["ROOT_ROUTING","SQL_DATA_PREPARATION","GOVERNED_OPERATOR","ORACLE","PUBLISHER","SANDBOX_RECLAMATION"]'::jsonb)
      order by ordinal) into strict slots
  from (
    select ordinal,
      case when ordinal=0 then 'G1' when ordinal<=5 then 'G2'
        when ordinal<=10 then 'G3' else 'G4' end stage,
      case when ordinal=0 then 0 when ordinal<=5 then ordinal-1
        when ordinal<=10 then ordinal-6 else ordinal-11 end case_index
    from pg_catalog.generate_series(0,15) ordinal) schedule;
  manifest:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-qualification-manifest@1.0.0',
    'qualification_id','falcon24-test-qualification-v1','qualification_version',1,
    'source_commit','1111111111111111111111111111111111111111',
    'source_fingerprint','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'frozen_contract_hash','sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'semantic_release_hash','sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'schema_snapshot_hash','sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'operator_registry_digest','sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'model_config_hash','sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    'web_build_hash','sha256:1212121212121212121212121212121212121212121212121212121212121212',
    'runtime_attestation_hash','sha256:3434343434343434343434343434343434343434343434343434343434343434',
    'model_provider','deepseek','model_id','deepseek-chat','slots',slots);
  return manifest||pg_catalog.jsonb_build_object(
    'manifest_hash',pg_temp.falcon24_qualification_hash(manifest));
end
$function$;

set local role data_agent_backend;

do $qualification_submit_crash_and_forced_cleanup$
declare command jsonb; claim_command jsonb; qualification jsonb; slot jsonb; policy jsonb;
  run_id constant text:='00000000-0000-4000-8000-000000005500';
  fence_token constant text:='00000000-0000-4000-8000-000000005590';
  cleanup_token constant text:='00000000-0000-4000-8000-000000005591';
begin
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-qualification-begin@1.0.0',
    'manifest',pg_temp.falcon24_qualification_manifest());
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_qualification_hash(command));
  qualification:=app_data_agent.begin_falcon24_qualification(command);
  if qualification->>'status'<>'READY' or qualification->>'slot_count'<>'16' then
    raise exception 'FALCON24_QUALIFICATION_BEGIN_ASSERTION_FAILED'; end if;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-qualification-slot-claim@1.0.0',
    'qualification_id','falcon24-test-qualification-v1','ordinal',0,'run_id',run_id,
    'slot_id','G1-01','stage','G1','case_id','falcon24-business-review-18m',
    'run_variant','WARM','claim_fence_token',fence_token);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_qualification_hash(command));
  claim_command:=command;
  slot:=app_data_agent.claim_falcon24_qualification_slot(command);
  if slot->>'status'<>'CLAIMED' then
    raise exception 'FALCON24_QUALIFICATION_CLAIM_ASSERTION_FAILED'; end if;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-qualification-submit-outcome@1.0.0',
    'qualification_id','falcon24-test-qualification-v1','run_id',run_id,
    'observed_failure_code','QUALIFICATION_ACCEPTANCE_CONNECTION_LOST');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_qualification_hash(command));
  qualification:=app_data_agent.resolve_falcon24_qualification_submit_outcome(command);
  if qualification->>'disposition'<>'HELD'
    or qualification->>'failure_code'<>'QUALIFICATION_ACCEPTANCE_CONNECTION_LOST'
  then raise exception 'FALCON24_QUALIFICATION_SUBMIT_RESOLUTION_ASSERTION_FAILED'; end if;

  begin
    perform app_data_agent.claim_falcon24_qualification_slot(claim_command);
    raise exception 'FALCON24_QUALIFICATION_SAME_VERSION_RETRY_ACCEPTED';
  exception when sqlstate '55000' or sqlstate '22023' then null; end;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-qualification-forced-cleanup-claim@1.0.0',
    'qualification_id','falcon24-test-qualification-v1','run_id',run_id,
    'forced_cleanup_token',cleanup_token);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_qualification_hash(command));
  slot:=app_data_agent.claim_falcon24_qualification_forced_cleanup(command);
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-qualification-forced-cleanup-resolve@1.0.0',
    'qualification_id','falcon24-test-qualification-v1','run_id',run_id,
    'forced_cleanup_token',cleanup_token,'forced_cleanup_receipt_hash',null,
    'forced_cleanup_receipt',null,'secondary_failure_code','OPENSANDBOX_CLEANUP_FAILED');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_qualification_hash(command));
  slot:=app_data_agent.resolve_falcon24_qualification_forced_cleanup(command);
  qualification:=app_data_agent.load_falcon24_qualification(
    (select document||pg_catalog.jsonb_build_object(
      'command_hash',pg_temp.falcon24_qualification_hash(document)) from (values(
        pg_catalog.jsonb_build_object('schema_version','falcon24-qualification-load@1.0.0',
          'qualification_id','falcon24-test-qualification-v1'))) request(document)));
  if slot->>'secondary_failure_layer'<>'SANDBOX_RECLAMATION'
    or slot->>'secondary_failure_code'<>'OPENSANDBOX_CLEANUP_FAILED'
    or qualification->>'first_failure_code'<>'QUALIFICATION_ACCEPTANCE_CONNECTION_LOST'
  then raise exception 'FALCON24_QUALIFICATION_FORCED_CLEANUP_ASSERTION_FAILED'; end if;

  policy:=app_data_agent.resolve_falcon24_run_execution_policy(run_id::uuid);
  if policy->>'acceptance_authority_kind'<>'QUALIFICATION'
    or policy->>'max_run_attempts'<>'1'
    or policy->>'analysis_repair_budget_per_category'<>'0'
  then raise exception 'FALCON24_QUALIFICATION_POLICY_ASSERTION_FAILED'; end if;

  if pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_qualifications','UPDATE')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_qualification_slots','UPDATE')
  then raise exception 'FALCON24_QUALIFICATION_DIRECT_TABLE_BYPASS'; end if;
end
$qualification_submit_crash_and_forced_cleanup$;

rollback;
