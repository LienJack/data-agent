create or replace function app_data_agent.begin_falcon24_acceptance_campaign(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;current_epoch record;
  existing app_data_agent.falcon24_acceptance_campaigns%rowtype;
  qualification app_data_agent.falcon24_qualifications%rowtype;
  manifest jsonb;attempt_number integer;now_at timestamptz;slot_snapshots jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','manifest','policy_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-acceptance-campaign-begin@1.0.0'
    or command->>'policy_id' is distinct from 'falcon24-strict-zero-retry@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'manifest') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_CAMPAIGN_COMMAND_INVALID'; end if;
  manifest:=command->'manifest';
  if app_data_agent.provider_json_object_has_exact_keys(manifest,array[
      'schema_version','campaign_id','attempt_id','winning_qualification_attempt_id',
      'authority_baseline_hash','source_fingerprint','frozen_contract_hash',
      'runtime_attestation_hash','runs','manifest_hash']::text[]) is distinct from true
    or manifest->>'schema_version' is distinct from 'falcon24-analysis-run-manifest@2.0.0'
    or manifest->>'campaign_id' is distinct from 'E1-C1'
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
  select current_authority.baseline_id,current_authority.baseline_hash
    into strict current_epoch
  from app_data_agent.falcon24_current_authority_epoch current_authority
  where current_authority.app_id=authority.app_id
    and current_authority.tenant_id=authority.tenant_id
    and current_authority.environment=authority.environment for share;
  if current_epoch.baseline_hash<>manifest->>'authority_baseline_hash'
  then raise exception using errcode='55000',message='FALCON24_E1_GATE_BASELINE_MISMATCH'; end if;
  select * into qualification from app_data_agent.falcon24_qualifications row
  where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
    and row.environment=authority.environment and row.principal_id=authority.principal_id
    and row.qualification_id='E1-Q1' for share;
  if not found or qualification.status<>'PASSED' or qualification.next_slot_ordinal<>16
    or qualification.attempt_id<>(manifest->>'winning_qualification_attempt_id')::uuid
    or qualification.authority_baseline_id<>current_epoch.baseline_id
    or qualification.authority_baseline_hash<>current_epoch.baseline_hash
    or qualification.source_fingerprint<>manifest->>'source_fingerprint'
    or qualification.frozen_contract_hash<>manifest->>'frozen_contract_hash'
    or qualification.runtime_attestation_hash<>manifest->>'runtime_attestation_hash'
  then raise exception using errcode='55000',message='FALCON24_E1_WINNING_QUALIFICATION_REQUIRED'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:E1-C1:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
    authority.environment||':'||authority.principal_id::text,0));
  if exists(select 1 from app_data_agent.falcon24_e1_gate_attempt_history history
    where history.app_id=authority.app_id and history.tenant_id=authority.tenant_id
      and history.environment=authority.environment and history.principal_id=authority.principal_id
      and history.gate_kind='CAMPAIGN' and history.attempt_id=(manifest->>'attempt_id')::uuid)
  then raise exception using errcode='55000',message='FALCON24_E1_GATE_ATTEMPT_IMMUTABLE'; end if;
  select * into existing from app_data_agent.falcon24_acceptance_campaigns row
  where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
    and row.environment=authority.environment and row.principal_id=authority.principal_id
    and row.campaign_id='E1-C1' for update;
  if found and existing.attempt_id=(manifest->>'attempt_id')::uuid then
    if existing.manifest_hash<>manifest->>'manifest_hash'
    then raise exception using errcode='23505',message='FALCON24_CAMPAIGN_IDENTITY_CONFLICT'; end if;
    return pg_catalog.to_jsonb(existing);
  elsif found and existing.status<>'HOLD' then
    raise exception using errcode='55000',message=case when existing.status='PASSED'
      then 'FALCON24_CAMPAIGN_ALREADY_PASSED' else 'FALCON24_PREVIOUS_CAMPAIGN_ACTIVE' end;
  elsif found then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(run)
      order by run.run_ordinal),'[]'::jsonb) into slot_snapshots
    from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=existing.app_id and run.tenant_id=existing.tenant_id
      and run.environment=existing.environment and run.principal_id=existing.principal_id
      and run.campaign_id=existing.campaign_id;
    insert into app_data_agent.falcon24_e1_gate_attempt_history(
      app_id,tenant_id,environment,principal_id,gate_kind,gate_id,attempt_id,attempt_number,
      authority_epoch,authority_baseline_id,authority_baseline_hash,manifest_hash,status,parent_snapshot,
      slot_snapshots,archived_at)
    values(existing.app_id,existing.tenant_id,existing.environment,existing.principal_id,
      'CAMPAIGN',existing.campaign_id,existing.attempt_id,existing.campaign_version,'E1',
      existing.authority_baseline_id,existing.authority_baseline_hash,existing.manifest_hash,
      'HOLD',pg_catalog.to_jsonb(existing),slot_snapshots,pg_catalog.clock_timestamp());
    delete from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=existing.app_id and run.tenant_id=existing.tenant_id
      and run.environment=existing.environment and run.principal_id=existing.principal_id
      and run.campaign_id=existing.campaign_id;
    delete from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=existing.app_id and row.tenant_id=existing.tenant_id
      and row.environment=existing.environment and row.principal_id=existing.principal_id
      and row.campaign_id=existing.campaign_id;
  end if;
  select 1+pg_catalog.count(*)::integer into attempt_number
  from app_data_agent.falcon24_e1_gate_attempt_history history
  where history.app_id=authority.app_id and history.tenant_id=authority.tenant_id
    and history.environment=authority.environment and history.principal_id=authority.principal_id
    and history.gate_kind='CAMPAIGN';
  now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.falcon24_acceptance_campaigns(
    app_id,tenant_id,environment,principal_id,campaign_id,campaign_version,attempt_id,
    winning_qualification_attempt_id,source_fingerprint,frozen_contract_hash,
    runtime_attestation_hash,manifest_hash,policy_id,run_count,next_run_ordinal,status,
    created_at,updated_at)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    'E1-C1',attempt_number,(manifest->>'attempt_id')::uuid,
    (manifest->>'winning_qualification_attempt_id')::uuid,manifest->>'source_fingerprint',
    manifest->>'frozen_contract_hash',manifest->>'runtime_attestation_hash',
    manifest->>'manifest_hash','falcon24-strict-zero-retry@1.0.0',30,0,'READY',now_at,now_at)
  returning * into strict existing;
  insert into app_data_agent.falcon24_acceptance_campaign_runs(
    app_id,tenant_id,environment,principal_id,campaign_id,run_ordinal,run_id,case_id,
    run_variant,repetition,status,claimed_at)
  select authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    'E1-C1',(entry.ordinality-1)::integer,(entry.item->>'run_id')::uuid,
    entry.item->>'case_id',entry.item->>'run_variant',(entry.item->>'repetition')::integer,
    'PLANNED',null
  from pg_catalog.jsonb_array_elements(manifest->'runs') with ordinality entry(item,ordinality);
  return pg_catalog.to_jsonb(existing);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_CAMPAIGN_COMMAND_INVALID';
end
$function$;
