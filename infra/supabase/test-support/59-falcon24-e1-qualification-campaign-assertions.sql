\set ON_ERROR_STOP on

begin;

create function pg_temp.e1_hash(document jsonb)
returns text language sql immutable security definer set search_path='' as $function$
  select app_data_agent.u2_canonical_sha256(document)
$function$;

create function pg_temp.e1_qualification_manifest(requested_attempt uuid,run_base integer)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare baseline record;material jsonb;slots jsonb;
begin
  select authority_baseline.source_commit,authority_baseline.web_build_hash,
    current_epoch.baseline_hash into strict baseline
  from app_data_agent.falcon24_current_authority_epoch current_epoch
  join app_data_agent.falcon24_authority_baselines authority_baseline
    on authority_baseline.app_id=current_epoch.app_id
      and authority_baseline.tenant_id=current_epoch.tenant_id
      and authority_baseline.environment=current_epoch.environment
      and authority_baseline.baseline_id=current_epoch.baseline_id
  where current_epoch.app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and current_epoch.tenant_id='00000000-0000-4000-8000-00000000aa11'::uuid
    and current_epoch.environment='test';
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'ordinal',ordinal,'run_id',
      ('00000000-0000-4000-8000-'||pg_catalog.lpad((run_base+ordinal)::text,12,'0'))::uuid,
    'slot_id',stage||'-'||pg_catalog.lpad((case_index+1)::text,2,'0'),
    'stage',stage,'case_id',(array[
      'falcon24-business-review-18m','falcon24-delivery-experience-12m',
      'falcon24-inventory-damage-12m','falcon24-marketing-lag-effect',
      'falcon24-cohort-retention-m0-m6']::text[])[case_index+1],
    'prompt',prompt,'prompt_hash',pg_temp.e1_hash(pg_catalog.to_jsonb(prompt)),
    'run_variant',case when stage='G4' then 'COLD' else 'WARM' end,
    'expected_path','["ROOT_ROUTING","SQL_DATA_PREPARATION","GOVERNED_OPERATOR",'
      '"ORACLE","PUBLISHER","SANDBOX_RECLAMATION"]'::jsonb) order by ordinal)
    into slots
  from (select ordinal,
      case when ordinal=0 then 'G1' when ordinal<=5 then 'G2'
        when ordinal<=10 then 'G3' else 'G4' end stage,
      case when ordinal=0 then 0 when ordinal<=5 then ordinal-1
        when ordinal<=10 then ordinal-6 else ordinal-11 end case_index,
      'E1 qualification prompt '||ordinal::text prompt
    from pg_catalog.generate_series(0,15) ordinal) generated;
  material:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-qualification-manifest@1.0.0',
    'qualification_id','E1-Q1','attempt_id',requested_attempt,
    'authority_baseline_hash',baseline.baseline_hash,'source_commit',baseline.source_commit,
    'source_fingerprint','sha256:1111111111111111111111111111111111111111111111111111111111111111',
    'frozen_contract_hash','sha256:2222222222222222222222222222222222222222222222222222222222222222',
    'semantic_release_hash','sha256:3333333333333333333333333333333333333333333333333333333333333333',
    'schema_snapshot_hash','sha256:4444444444444444444444444444444444444444444444444444444444444444',
    'operator_registry_digest','sha256:5555555555555555555555555555555555555555555555555555555555555555',
    'model_config_hash','sha256:6666666666666666666666666666666666666666666666666666666666666666',
    'web_build_hash',baseline.web_build_hash,
    'runtime_attestation_hash','sha256:7777777777777777777777777777777777777777777777777777777777777777',
    'model_provider','deepseek','model_id','deepseek-v4-flash','slots',slots);
  return material||pg_catalog.jsonb_build_object('manifest_hash',pg_temp.e1_hash(material));
end
$function$;

create function pg_temp.e1_campaign_manifest(
  requested_attempt uuid,winning_attempt uuid,run_base integer)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare baseline_hash text;material jsonb;runs jsonb;
begin
  select current_epoch.baseline_hash into strict baseline_hash
  from app_data_agent.falcon24_current_authority_epoch current_epoch
  where current_epoch.app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and current_epoch.tenant_id='00000000-0000-4000-8000-00000000aa11'::uuid
    and current_epoch.environment='test';
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'run_id',('00000000-0000-4000-8000-'||
      pg_catalog.lpad((run_base+ordinal)::text,12,'0'))::uuid,
    'case_id',(array[
      'falcon24-business-review-18m','falcon24-delivery-experience-12m',
      'falcon24-inventory-damage-12m','falcon24-marketing-lag-effect',
      'falcon24-cohort-retention-m0-m6']::text[])[(ordinal/6)+1],
    'run_variant',case when ordinal%6<3 then 'COLD' else 'WARM' end,
    'repetition',(ordinal%3)+1) order by ordinal) into runs
  from pg_catalog.generate_series(0,29) ordinal;
  material:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-analysis-run-manifest@2.0.0','campaign_id','E1-C1',
    'attempt_id',requested_attempt,'winning_qualification_attempt_id',winning_attempt,
    'authority_baseline_hash',baseline_hash,
    'source_fingerprint','sha256:1111111111111111111111111111111111111111111111111111111111111111',
    'frozen_contract_hash','sha256:2222222222222222222222222222222222222222222222222222222222222222',
    'runtime_attestation_hash','sha256:7777777777777777777777777777777777777777777777777777777777777777',
    'runs',runs);
  return material||pg_catalog.jsonb_build_object('manifest_hash',pg_temp.e1_hash(material));
end
$function$;

create function pg_temp.e1_begin_qualification(requested_attempt uuid,run_base integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare command jsonb;
begin
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-qualification-begin@1.0.0',
    'manifest',pg_temp.e1_qualification_manifest(requested_attempt,run_base));
  command:=command||pg_catalog.jsonb_build_object('command_hash',pg_temp.e1_hash(command));
  return app_data_agent.begin_falcon24_qualification(command);
end
$function$;

create function pg_temp.e1_begin_campaign(
  requested_attempt uuid,winning_attempt uuid,run_base integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare command jsonb;
begin
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-campaign-begin@1.0.0',
    'manifest',pg_temp.e1_campaign_manifest(requested_attempt,winning_attempt,run_base),
    'policy_id','falcon24-strict-zero-retry@1.0.0');
  command:=command||pg_catalog.jsonb_build_object('command_hash',pg_temp.e1_hash(command));
  return app_data_agent.begin_falcon24_acceptance_campaign(command);
end
$function$;

create function pg_temp.e1_hold(gate_kind text,run_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare command jsonb;
begin
  command:=pg_catalog.jsonb_build_object(
    'schema_version',case when gate_kind='QUALIFICATION'
      then 'falcon24-qualification-hold@1.0.0'
      else 'falcon24-acceptance-campaign-hold@2.0.0' end,
    case when gate_kind='QUALIFICATION' then 'qualification_id' else 'campaign_id' end,
      case when gate_kind='QUALIFICATION' then 'E1-Q1' else 'E1-C1' end,
    'run_id',run_id,'failure_layer','ROOT_ROUTING','failure_code','FALCON24_TEST_PREFLIGHT_FAILED');
  command:=command||pg_catalog.jsonb_build_object('command_hash',pg_temp.e1_hash(command));
  if gate_kind='QUALIFICATION' then return app_data_agent.hold_falcon24_qualification(command); end if;
  return app_data_agent.hold_falcon24_acceptance_campaign(command);
end
$function$;

select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-00000000aa11',true);
select pg_catalog.set_config('data_agent.environment','test',true);
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-000000001001',true);
select pg_catalog.set_config('data_agent.role','owner',true);
select pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',true);

do $qualification_attempts$
declare first_attempt constant uuid:='00000000-0000-4000-8000-000000009101'::uuid;
  second_attempt constant uuid:='00000000-0000-4000-8000-000000009102'::uuid;
  first_result jsonb;second_result jsonb;
begin
  first_result:=pg_temp.e1_begin_qualification(first_attempt,910100);
  if first_result->>'qualification_id'<>'E1-Q1'
    or first_result->>'attempt_id'<>first_attempt::text
    or (first_result->>'qualification_version')::integer<>1
    or (select pg_catalog.count(*) from app_data_agent.falcon24_qualification_slots
      where qualification_id='E1-Q1')<>16
  then raise exception 'FALCON24_E1_Q1_FIRST_ATTEMPT_INVALID'; end if;
  perform pg_temp.e1_hold('QUALIFICATION','00000000-0000-4000-8000-000000910100'::uuid);
  second_result:=pg_temp.e1_begin_qualification(second_attempt,910200);
  if second_result->>'attempt_id'<>second_attempt::text
    or (second_result->>'qualification_version')::integer<>2
    or (select pg_catalog.jsonb_array_length(history.slot_snapshots)
      from app_data_agent.falcon24_e1_gate_attempt_history history
      where history.gate_kind='QUALIFICATION' and history.attempt_id=first_attempt)<>16
  then raise exception 'FALCON24_E1_Q1_ARCHIVE_INVALID'; end if;
  begin
    perform pg_temp.e1_begin_qualification(first_attempt,910100);
    raise exception 'FALCON24_E1_Q1_HOLD_ATTEMPT_RESUMED';
  exception when sqlstate '55000' then
    if sqlerrm<>'FALCON24_E1_GATE_ATTEMPT_IMMUTABLE' then raise; end if;
  end;
end
$qualification_attempts$;

do $campaign_requires_winner$
begin
  begin
    perform pg_temp.e1_begin_campaign(
      '00000000-0000-4000-8000-000000009201'::uuid,
      '00000000-0000-4000-8000-000000009102'::uuid,920100);
    raise exception 'FALCON24_E1_C1_ACCEPTED_INCOMPLETE_QUALIFICATION';
  exception when sqlstate '55000' then
    if sqlerrm<>'FALCON24_E1_WINNING_QUALIFICATION_REQUIRED' then raise; end if;
  end;
end
$campaign_requires_winner$;

set local session_replication_role=replica;
update app_data_agent.falcon24_qualifications
set status='PASSED',next_slot_ordinal=16,updated_at=pg_catalog.clock_timestamp()
where qualification_id='E1-Q1'
  and attempt_id='00000000-0000-4000-8000-000000009102'::uuid;
set local session_replication_role=origin;
do $campaign_attempts$
declare winning_attempt constant uuid:='00000000-0000-4000-8000-000000009102'::uuid;
  first_attempt constant uuid:='00000000-0000-4000-8000-000000009201'::uuid;
  second_attempt constant uuid:='00000000-0000-4000-8000-000000009202'::uuid;
  first_result jsonb;second_result jsonb;
begin
  first_result:=pg_temp.e1_begin_campaign(first_attempt,winning_attempt,920100);
  if first_result->>'campaign_id'<>'E1-C1'
    or first_result->>'attempt_id'<>first_attempt::text
    or (first_result->>'campaign_version')::integer<>1
    or (select pg_catalog.count(*) from app_data_agent.falcon24_acceptance_campaign_runs
      where campaign_id='E1-C1')<>30
  then raise exception 'FALCON24_E1_C1_FIRST_ATTEMPT_INVALID'; end if;
  perform pg_temp.e1_hold('CAMPAIGN','00000000-0000-4000-8000-000000920100'::uuid);
  second_result:=pg_temp.e1_begin_campaign(second_attempt,winning_attempt,920200);
  if second_result->>'attempt_id'<>second_attempt::text
    or (second_result->>'campaign_version')::integer<>2
    or (select pg_catalog.jsonb_array_length(history.slot_snapshots)
      from app_data_agent.falcon24_e1_gate_attempt_history history
      where history.gate_kind='CAMPAIGN' and history.attempt_id=first_attempt)<>30
  then raise exception 'FALCON24_E1_C1_ARCHIVE_INVALID'; end if;
end
$campaign_attempts$;

do $attempt_and_ui_fences$
begin
  perform pg_catalog.set_config(
    'data_agent.falcon24_gate_attempt_id','00000000-0000-4000-8000-000000009999',true);
  begin
    update app_data_agent.falcon24_acceptance_campaign_runs
    set claim_fence_consumed_at=pg_catalog.clock_timestamp()
    where campaign_id='E1-C1' and run_ordinal=0;
    raise exception 'FALCON24_E1_WRONG_GATE_ATTEMPT_ACCEPTED';
  exception when sqlstate '55000' then
    if sqlerrm<>'FALCON24_E1_GATE_ATTEMPT_MISMATCH' then raise; end if;
  end;
  begin
    update app_data_agent.falcon24_acceptance_campaign_runs set status='VERIFIED'
    where campaign_id='E1-C1' and run_ordinal=0;
    raise exception 'FALCON24_E1_VERIFIED_WITHOUT_UI_RECEIPTS';
  exception when sqlstate '55000' then
    if sqlerrm<>'FALCON24_E1_UI_RECEIPT_PAIR_REQUIRED' then raise; end if;
  end;
  begin
    update app_data_agent.falcon24_e1_gate_attempt_history set status='HOLD'
    where gate_kind='QUALIFICATION';
    raise exception 'FALCON24_E1_GATE_HISTORY_UPDATED';
  exception when sqlstate '55000' then
    if sqlerrm<>'FALCON24_E1_GATE_ATTEMPT_IMMUTABLE' then raise; end if;
  end;
  begin
    delete from app_data_agent.falcon24_e1_gate_attempt_history where gate_kind='CAMPAIGN';
    raise exception 'FALCON24_E1_GATE_HISTORY_DELETED';
  exception when sqlstate '55000' then
    if sqlerrm<>'FALCON24_E1_GATE_ATTEMPT_IMMUTABLE' then raise; end if;
  end;
end
$attempt_and_ui_fences$;

rollback;
