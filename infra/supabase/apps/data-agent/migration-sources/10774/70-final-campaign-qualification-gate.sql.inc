create or replace function app_data_agent.begin_falcon24_acceptance_campaign(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; existing app_data_agent.falcon24_acceptance_campaigns%rowtype;
  latest app_data_agent.falcon24_acceptance_campaigns%rowtype; now_at timestamptz;
  manifest jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','manifest','policy_id','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-acceptance-campaign-begin@1.0.0'
    or command->>'policy_id' is distinct from 'falcon24-strict-zero-retry@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'manifest') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_CAMPAIGN_COMMAND_INVALID'; end if;
  manifest:=command->'manifest';
  if app_data_agent.provider_json_object_has_exact_keys(manifest,array[
      'schema_version','campaign_id','campaign_version','source_fingerprint',
      'frozen_contract_hash','runtime_attestation_hash','runs','manifest_hash']::text[])
      is distinct from true
    or manifest->>'schema_version' is distinct from 'falcon24-analysis-run-manifest@2.0.0'
    or manifest->>'manifest_hash' is distinct from
      app_data_agent.u2_canonical_sha256(manifest-'manifest_hash')
    or pg_catalog.jsonb_typeof(manifest->'campaign_id') is distinct from 'string'
    or manifest->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(manifest->>'campaign_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(manifest->'campaign_version') is distinct from 'number'
    or manifest->>'campaign_version'!~'^[1-9][0-9]*$'
    or (manifest->>'campaign_version')::integer not between 1 and 1000000
    or (select pg_catalog.count(*) from pg_catalog.regexp_matches(
      manifest->>'campaign_id','(?:^|[._-])v([1-9][0-9]*)([._-]|$)','g'))<>1
    or ((pg_catalog.regexp_match(
      manifest->>'campaign_id','(?:^|[._-])v([1-9][0-9]*)([._-]|$)'))[1])::integer
      is distinct from (manifest->>'campaign_version')::integer
    or pg_catalog.jsonb_typeof(manifest->'source_fingerprint') is distinct from 'string'
    or manifest->>'source_fingerprint'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(manifest->'frozen_contract_hash') is distinct from 'string'
    or manifest->>'frozen_contract_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(manifest->'runtime_attestation_hash') is distinct from 'string'
    or manifest->>'runtime_attestation_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(manifest->'runs') is distinct from 'array'
    or pg_catalog.jsonb_typeof(manifest->'manifest_hash') is distinct from 'string'
    or pg_catalog.jsonb_array_length(manifest->'runs')<>30
    or exists(select 1 from pg_catalog.jsonb_array_elements(manifest->'runs') item
      where pg_catalog.jsonb_typeof(item) is distinct from 'object'
        or app_data_agent.provider_json_object_has_exact_keys(
          item,array['run_id','case_id','run_variant','repetition']::text[])
          is distinct from true
        or pg_catalog.jsonb_typeof(item->'run_id') is distinct from 'string'
        or pg_catalog.jsonb_typeof(item->'case_id') is distinct from 'string'
        or item->>'case_id' not in('falcon24-business-review-18m',
          'falcon24-delivery-experience-12m','falcon24-inventory-damage-12m',
          'falcon24-marketing-lag-effect','falcon24-cohort-retention-m0-m6')
        or pg_catalog.jsonb_typeof(item->'run_variant') is distinct from 'string'
        or item->>'run_variant' not in('COLD','WARM')
        or pg_catalog.jsonb_typeof(item->'repetition') is distinct from 'number'
        or item->>'repetition'!~'^[1-3]$'
        or (item->>'repetition')::integer not between 1 and 3)
    or (select pg_catalog.count(distinct item->>'run_id')
      from pg_catalog.jsonb_array_elements(manifest->'runs') item)<>30
    or (select pg_catalog.count(distinct pg_catalog.concat_ws(
        pg_catalog.chr(31),item->>'case_id',item->>'run_variant',item->>'repetition'))
      from pg_catalog.jsonb_array_elements(manifest->'runs') item)<>30
  then raise exception using errcode='22023',message='FALCON24_CAMPAIGN_MANIFEST_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into existing from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=manifest->>'campaign_id' for update;
  if found then
    if existing.campaign_version is distinct from (manifest->>'campaign_version')::integer
      or existing.source_fingerprint is distinct from manifest->>'source_fingerprint'
      or existing.frozen_contract_hash is distinct from manifest->>'frozen_contract_hash'
      or existing.runtime_attestation_hash is distinct from manifest->>'runtime_attestation_hash'
      or existing.manifest_hash is distinct from manifest->>'manifest_hash'
    then raise exception using errcode='23505',message='FALCON24_CAMPAIGN_IDENTITY_CONFLICT'; end if;
    if (select pg_catalog.count(*) from app_data_agent.falcon24_acceptance_campaign_runs run
        where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
          and run.environment=authority.environment and run.principal_id=authority.principal_id
          and run.campaign_id=existing.campaign_id)<>30
      or exists(
        select 1 from pg_catalog.jsonb_array_elements(manifest->'runs')
          with ordinality entry(item,ordinality)
        left join app_data_agent.falcon24_acceptance_campaign_runs run
          on run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
          and run.environment=authority.environment and run.principal_id=authority.principal_id
          and run.campaign_id=existing.campaign_id
          and run.run_ordinal=(entry.ordinality-1)::integer
        where run.run_id is distinct from (entry.item->>'run_id')::uuid
          or run.case_id is distinct from entry.item->>'case_id'
          or run.run_variant is distinct from entry.item->>'run_variant'
          or run.repetition is distinct from (entry.item->>'repetition')::integer)
    then raise exception using errcode='55000',message='FALCON24_RUN_SCHEDULE_MISMATCH'; end if;
    return pg_catalog.to_jsonb(existing);
  end if;
  select * into latest from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
    order by row.campaign_version desc limit 1 for update;
  if not found and (manifest->>'campaign_version')::integer<>13 then
    raise exception using errcode='22023',message='FALCON24_CAMPAIGN_BOOTSTRAP_VERSION_INVALID';
  elsif found and (manifest->>'campaign_version')::integer<>latest.campaign_version+1 then
    raise exception using errcode='22023',message='FALCON24_CAMPAIGN_VERSION_NOT_NEXT';
  elsif found and latest.status not in('HOLD','PASSED') then
    raise exception using errcode='55000',message='FALCON24_PREVIOUS_CAMPAIGN_ACTIVE';
  elsif found and latest.source_fingerprint=manifest->>'source_fingerprint'
    and latest.frozen_contract_hash=manifest->>'frozen_contract_hash'
  then raise exception using errcode='55000',message='FALCON24_CAMPAIGN_CHANGE_REQUIRED'; end if;
  if (manifest->>'campaign_version')::integer>=15 and not exists(
    select 1 from app_data_agent.falcon24_qualifications qualification
    where qualification.app_id=authority.app_id
      and qualification.tenant_id=authority.tenant_id
      and qualification.environment=authority.environment
      and qualification.principal_id=authority.principal_id
      and qualification.status='PASSED'
      and qualification.source_fingerprint=manifest->>'source_fingerprint'
      and qualification.frozen_contract_hash=manifest->>'frozen_contract_hash'
      and qualification.runtime_attestation_hash=manifest->>'runtime_attestation_hash')
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_V15_GATE_REQUIRED'; end if;
  now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.falcon24_acceptance_campaigns(
    app_id,tenant_id,environment,principal_id,campaign_id,campaign_version,
    source_fingerprint,frozen_contract_hash,runtime_attestation_hash,manifest_hash,policy_id,run_count,
    next_run_ordinal,status,created_at,updated_at)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    manifest->>'campaign_id',(manifest->>'campaign_version')::integer,
    manifest->>'source_fingerprint',manifest->>'frozen_contract_hash',
    manifest->>'runtime_attestation_hash',manifest->>'manifest_hash',
    command->>'policy_id',30,0,'READY',now_at,now_at) returning * into strict existing;
  insert into app_data_agent.falcon24_acceptance_campaign_runs(
    app_id,tenant_id,environment,principal_id,campaign_id,run_ordinal,run_id,case_id,
    run_variant,repetition,status,claimed_at)
  select authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    existing.campaign_id,(entry.ordinality-1)::integer,(entry.item->>'run_id')::uuid,
    entry.item->>'case_id',entry.item->>'run_variant',(entry.item->>'repetition')::integer,
    'PLANNED',null
  from pg_catalog.jsonb_array_elements(manifest->'runs') with ordinality entry(item,ordinality);
  return pg_catalog.to_jsonb(existing);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_CAMPAIGN_COMMAND_INVALID';
end
$function$;
