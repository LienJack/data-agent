create or replace function app_data_agent.begin_falcon24_qualification(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;current_epoch record;baseline record;
  existing app_data_agent.falcon24_qualifications%rowtype;manifest jsonb;
  attempt_number integer;now_at timestamptz;slot_snapshots jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','manifest','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-qualification-begin@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'manifest') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_COMMAND_INVALID'; end if;
  manifest:=command->'manifest';
  if app_data_agent.provider_json_object_has_exact_keys(manifest,array[
      'schema_version','qualification_id','attempt_id','authority_baseline_hash',
      'source_commit','source_fingerprint','frozen_contract_hash','semantic_release_hash',
      'schema_snapshot_hash','operator_registry_digest','model_config_hash','web_build_hash',
      'runtime_attestation_hash','model_provider','model_id','slots','manifest_hash']::text[])
      is distinct from true
    or manifest->>'schema_version' is distinct from 'falcon24-qualification-manifest@1.0.0'
    or manifest->>'qualification_id' is distinct from 'E1-Q1'
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
  select current_authority.baseline_id,current_authority.baseline_hash,
    current_authority.activation_attempt_id into strict current_epoch
  from app_data_agent.falcon24_current_authority_epoch current_authority
  where current_authority.app_id=authority.app_id
    and current_authority.tenant_id=authority.tenant_id
    and current_authority.environment=authority.environment for share;
  select authority_baseline.source_commit,authority_baseline.web_build_hash,
    authority_baseline.status into strict baseline
  from app_data_agent.falcon24_authority_baselines authority_baseline
  where authority_baseline.app_id=authority.app_id
    and authority_baseline.tenant_id=authority.tenant_id
    and authority_baseline.environment=authority.environment
    and authority_baseline.baseline_id=current_epoch.baseline_id
    and authority_baseline.baseline_hash=current_epoch.baseline_hash for share;
  if current_epoch.baseline_hash<>manifest->>'authority_baseline_hash'
    or baseline.status<>'ACTIVE'
    or baseline.source_commit<>manifest->>'source_commit'
    or baseline.web_build_hash<>manifest->>'web_build_hash'
  then raise exception using errcode='55000',message='FALCON24_E1_GATE_BASELINE_MISMATCH'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:E1-Q1:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
    authority.environment||':'||authority.principal_id::text,0));
  if exists(select 1 from app_data_agent.falcon24_e1_gate_attempt_history history
    where history.app_id=authority.app_id and history.tenant_id=authority.tenant_id
      and history.environment=authority.environment and history.principal_id=authority.principal_id
      and history.gate_kind='QUALIFICATION'
      and history.attempt_id=(manifest->>'attempt_id')::uuid)
  then raise exception using errcode='55000',message='FALCON24_E1_GATE_ATTEMPT_IMMUTABLE'; end if;
  select * into existing from app_data_agent.falcon24_qualifications row
  where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
    and row.environment=authority.environment and row.principal_id=authority.principal_id
    and row.qualification_id='E1-Q1' for update;
  if found and existing.attempt_id=(manifest->>'attempt_id')::uuid then
    if existing.manifest_hash<>manifest->>'manifest_hash'
    then raise exception using errcode='23505',message='FALCON24_QUALIFICATION_IDENTITY_CONFLICT'; end if;
    return pg_catalog.to_jsonb(existing);
  elsif found and existing.status<>'HOLD' then
    raise exception using errcode='55000',message=case when existing.status='PASSED'
      then 'FALCON24_QUALIFICATION_ALREADY_PASSED' else 'FALCON24_PREVIOUS_QUALIFICATION_ACTIVE' end;
  elsif found then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(slot)
      order by slot.ordinal),'[]'::jsonb) into slot_snapshots
    from app_data_agent.falcon24_qualification_slots slot
    where slot.app_id=existing.app_id and slot.tenant_id=existing.tenant_id
      and slot.environment=existing.environment and slot.principal_id=existing.principal_id
      and slot.qualification_id=existing.qualification_id;
    insert into app_data_agent.falcon24_e1_gate_attempt_history(
      app_id,tenant_id,environment,principal_id,gate_kind,gate_id,attempt_id,attempt_number,
      authority_epoch,authority_baseline_id,authority_baseline_hash,manifest_hash,status,parent_snapshot,
      slot_snapshots,archived_at)
    values(existing.app_id,existing.tenant_id,existing.environment,existing.principal_id,
      'QUALIFICATION',existing.qualification_id,existing.attempt_id,
      existing.qualification_version,'E1',existing.authority_baseline_id,
      existing.authority_baseline_hash,existing.manifest_hash,'HOLD',
      pg_catalog.to_jsonb(existing),slot_snapshots,pg_catalog.clock_timestamp());
    delete from app_data_agent.falcon24_qualification_slots slot
    where slot.app_id=existing.app_id and slot.tenant_id=existing.tenant_id
      and slot.environment=existing.environment and slot.principal_id=existing.principal_id
      and slot.qualification_id=existing.qualification_id;
    delete from app_data_agent.falcon24_qualifications row
    where row.app_id=existing.app_id and row.tenant_id=existing.tenant_id
      and row.environment=existing.environment and row.principal_id=existing.principal_id
      and row.qualification_id=existing.qualification_id;
  end if;
  select 1+pg_catalog.count(*)::integer into attempt_number
  from app_data_agent.falcon24_e1_gate_attempt_history history
  where history.app_id=authority.app_id and history.tenant_id=authority.tenant_id
    and history.environment=authority.environment and history.principal_id=authority.principal_id
    and history.gate_kind='QUALIFICATION';
  now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.falcon24_qualifications(
    app_id,tenant_id,environment,principal_id,qualification_id,qualification_version,attempt_id,
    source_commit,source_fingerprint,frozen_contract_hash,semantic_release_hash,
    schema_snapshot_hash,operator_registry_digest,model_config_hash,web_build_hash,
    runtime_attestation_hash,model_provider,model_id,manifest_hash,slot_count,
    next_slot_ordinal,status,created_at,updated_at)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    'E1-Q1',attempt_number,(manifest->>'attempt_id')::uuid,manifest->>'source_commit',
    manifest->>'source_fingerprint',manifest->>'frozen_contract_hash',
    manifest->>'semantic_release_hash',manifest->>'schema_snapshot_hash',
    manifest->>'operator_registry_digest',manifest->>'model_config_hash',
    manifest->>'web_build_hash',manifest->>'runtime_attestation_hash',
    manifest->>'model_provider',manifest->>'model_id',manifest->>'manifest_hash',16,0,'READY',
    now_at,now_at) returning * into strict existing;
  insert into app_data_agent.falcon24_qualification_slots(
    app_id,tenant_id,environment,principal_id,qualification_id,ordinal,run_id,slot_id,stage,
    case_id,prompt,prompt_hash,run_variant,expected_path,status)
  select authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    'E1-Q1',(entry.ordinality-1)::integer,(entry.item->>'run_id')::uuid,
    entry.item->>'slot_id',entry.item->>'stage',entry.item->>'case_id',entry.item->>'prompt',
    entry.item->>'prompt_hash',entry.item->>'run_variant',entry.item->'expected_path','PLANNED'
  from pg_catalog.jsonb_array_elements(manifest->'slots') with ordinality entry(item,ordinality);
  return pg_catalog.to_jsonb(existing);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_BEGIN_INVALID';
end
$function$;
