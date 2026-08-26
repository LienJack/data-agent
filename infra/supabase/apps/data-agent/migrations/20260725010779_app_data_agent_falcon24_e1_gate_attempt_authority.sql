-- falcon24_e1_gate_attempt_migration_checksum: sha256:b0c0e427add89881035cc699bcabb7c1a894b1ecee72174d36c63bbedabb78c6
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
begin
  if not exists(select 1 from platform.migration_ledger
    where migration_version='20260725010778_app_data_agent_e1_legacy_runtime_retirement')
  then raise exception using errcode='P0001',message='FALCON24_E1_GATE_BASELINE_10778_MISSING'; end if;
  if exists(select 1 from app_data_agent.falcon24_qualifications)
    or exists(select 1 from app_data_agent.falcon24_qualification_slots)
    or exists(select 1 from app_data_agent.falcon24_acceptance_campaigns)
    or exists(select 1 from app_data_agent.falcon24_acceptance_campaign_runs)
  then raise exception using errcode='55000',message='FALCON24_E1_GATE_LEGACY_STATE_PRESENT'; end if;
end
$preflight$;
alter table app_data_agent.falcon24_qualifications
  add column attempt_id uuid not null;
alter table app_data_agent.falcon24_acceptance_campaigns
  add column attempt_id uuid not null,
  add column winning_qualification_attempt_id uuid not null;

do $replace_identity_checks$
declare constraint_row record;
begin
  for constraint_row in
    select constraint_definition.conrelid,constraint_definition.conname
    from pg_catalog.pg_constraint constraint_definition
    where constraint_definition.contype='c'
      and constraint_definition.conrelid in(
        'app_data_agent.falcon24_qualifications'::pg_catalog.regclass,
        'app_data_agent.falcon24_acceptance_campaigns'::pg_catalog.regclass)
      and pg_catalog.pg_get_constraintdef(constraint_definition.oid) like '%_id ~%falcon24-%'
  loop
    execute pg_catalog.format('alter table %s drop constraint %I',
      constraint_row.conrelid::pg_catalog.regclass,constraint_row.conname);
  end loop;
end
$replace_identity_checks$;

alter table app_data_agent.falcon24_qualifications
  add constraint falcon24_e1_qualification_identity_check check(
    qualification_id='E1-Q1' and qualification_version between 1 and 1000000
    and model_id~'^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
    and ((status='HOLD')=(first_failure_run_id is not null))
    and ((status='HOLD')=(first_failure_layer is not null))
    and ((status='HOLD')=(first_failure_code is not null))
    and (first_failure_layer is null or first_failure_layer in(
      'ROOT_ROUTING','SQL_DATA_PREPARATION','GOVERNED_OPERATOR','ORACLE','PUBLISHER',
      'SANDBOX_RECLAMATION'))
    and (first_failure_code is null or first_failure_code~'^[A-Z][A-Z0-9_]{2,127}$')),
  add constraint falcon24_e1_qualification_attempt_unique unique(
    app_id,tenant_id,environment,principal_id,attempt_id);

alter table app_data_agent.falcon24_acceptance_campaigns
  add constraint falcon24_e1_campaign_identity_check check(
    campaign_id='E1-C1' and campaign_version between 1 and 1000000
    and policy_id='falcon24-strict-zero-retry@1.0.0'
    and ((status='HOLD')=(first_failure_run_id is not null))
    and ((status='HOLD')=(first_failure_layer is not null))
    and ((status='HOLD')=(first_failure_code is not null))),
  add constraint falcon24_e1_campaign_attempt_unique unique(
    app_id,tenant_id,environment,principal_id,attempt_id);

create table app_data_agent.falcon24_e1_gate_attempt_history(
  app_id uuid not null,tenant_id uuid not null,environment text not null,principal_id uuid not null,
  gate_kind text not null check(gate_kind in('QUALIFICATION','CAMPAIGN')),
  gate_id text not null,attempt_id uuid not null,attempt_number integer not null,
  authority_epoch text not null check(authority_epoch='E1'),
  authority_baseline_id uuid not null,authority_baseline_hash text not null,
  manifest_hash text not null,status text not null check(status='HOLD'),
  parent_snapshot jsonb not null,slot_snapshots jsonb not null,archived_at timestamptz not null,
  primary key(app_id,tenant_id,environment,principal_id,gate_kind,attempt_id),
  unique(app_id,tenant_id,environment,principal_id,gate_kind,gate_id,attempt_number),
  foreign key(app_id,tenant_id,environment,authority_baseline_id,authority_baseline_hash,
    authority_epoch)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch) on delete restrict,
  check((gate_kind='QUALIFICATION' and gate_id='E1-Q1'
      and pg_catalog.jsonb_array_length(slot_snapshots)=16)
    or (gate_kind='CAMPAIGN' and gate_id='E1-C1'
      and pg_catalog.jsonb_array_length(slot_snapshots)=30)),
  check(authority_baseline_hash~'^sha256:[0-9a-f]{64}$'
    and manifest_hash~'^sha256:[0-9a-f]{64}$'
    and attempt_number between 1 and 1000000
    and pg_catalog.jsonb_typeof(parent_snapshot)='object'
    and pg_catalog.jsonb_typeof(slot_snapshots)='array')
);

alter table app_data_agent.falcon24_e1_gate_attempt_history enable row level security;
alter table app_data_agent.falcon24_e1_gate_attempt_history force row level security;
create policy falcon24_e1_gate_attempt_history_authority
on app_data_agent.falcon24_e1_gate_attempt_history for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid)
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid);
do $rewrite_campaign_identity_validators$
declare function_row record;function_definition text;rewritten_definition text;
  rewritten_count integer:=0;
begin
  for function_row in
    select procedure.oid
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='app_data_agent'
      and procedure.prosrc like '%^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$%'
  loop
    function_definition:=pg_catalog.pg_get_functiondef(function_row.oid);
    rewritten_definition:=pg_catalog.replace(function_definition,
      $$command->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'$$,
      $$command->>'campaign_id' is distinct from 'E1-C1'$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$submit_fence_command->>'campaign_id'!~
      '^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'$$,
      $$submit_fence_command->>'campaign_id' is distinct from 'E1-C1'$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$manifest->>'campaign_id'!~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'$$,
      $$manifest->>'campaign_id' is distinct from 'E1-C1'$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$or pg_catalog.length(command->>'campaign_id') not between 8 and 80$$,
      $$$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$or pg_catalog.length(submit_fence_command->>'campaign_id') not between 8 and 80$$,
      $$$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$or pg_catalog.length(manifest->>'campaign_id') not between 8 and 80$$,
      $$$$);
    if rewritten_definition=function_definition then
      raise exception using errcode='P0001',message='FALCON24_E1_CAMPAIGN_VALIDATOR_REWRITE_MISSED';
    end if;
    execute rewritten_definition;
    rewritten_count:=rewritten_count+1;
  end loop;
  if rewritten_count<>14 then
    raise exception using errcode='P0001',message='FALCON24_E1_CAMPAIGN_VALIDATOR_INVENTORY_DRIFT',
      detail=pg_catalog.jsonb_build_object('observed',rewritten_count)::text;
  end if;
end
$rewrite_campaign_identity_validators$;
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
create function app_data_agent.falcon24_e1_gate_attempt_history_immutable()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  raise exception using errcode='55000',message='FALCON24_E1_GATE_ATTEMPT_IMMUTABLE';
end
$function$;

create trigger falcon24_e1_gate_attempt_history_immutable
before update or delete on app_data_agent.falcon24_e1_gate_attempt_history
for each row execute function app_data_agent.falcon24_e1_gate_attempt_history_immutable();

create function app_data_agent.falcon24_e1_qualification_slot_attempt_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare expected_attempt_id uuid;qualification_attempt_id uuid;
begin
  if old.claim_fence_consumed_at is null and new.claim_fence_consumed_at is not null then
    begin
      expected_attempt_id:=pg_catalog.current_setting(
        'data_agent.falcon24_gate_attempt_id',true)::uuid;
    exception when invalid_text_representation then
      raise exception using errcode='22023',message='FALCON24_E1_GATE_ATTEMPT_FENCE_INVALID';
    end;
    select qualification.attempt_id into qualification_attempt_id
    from app_data_agent.falcon24_qualifications qualification
    where qualification.app_id=new.app_id and qualification.tenant_id=new.tenant_id
      and qualification.environment=new.environment and qualification.principal_id=new.principal_id
      and qualification.qualification_id=new.qualification_id;
    if expected_attempt_id is null or expected_attempt_id is distinct from qualification_attempt_id
    then raise exception using errcode='55000',message='FALCON24_E1_GATE_ATTEMPT_MISMATCH'; end if;
  end if;
  if old.status<>'VERIFIED' and new.status='VERIFIED' and not exists(
    select 1 from app_data_agent.falcon24_e1_ui_receipts qa_receipt
    join app_data_agent.falcon24_e1_ui_receipts trace_receipt
      on trace_receipt.app_id=qa_receipt.app_id and trace_receipt.tenant_id=qa_receipt.tenant_id
      and trace_receipt.environment=qa_receipt.environment
      and trace_receipt.run_id=qa_receipt.run_id
      and trace_receipt.viewport_width=qa_receipt.viewport_width
      and trace_receipt.receipt_kind='TRACE_UI'
      and trace_receipt.baseline_id=qa_receipt.baseline_id
      and trace_receipt.baseline_hash=qa_receipt.baseline_hash
      and trace_receipt.activation_attempt_id=qa_receipt.activation_attempt_id
    where qa_receipt.app_id=new.app_id and qa_receipt.tenant_id=new.tenant_id
      and qa_receipt.environment=new.environment and qa_receipt.run_id=new.run_id
      and qa_receipt.receipt_kind='QA_E2E'
      and qa_receipt.baseline_id=(select qualification.authority_baseline_id
        from app_data_agent.falcon24_qualifications qualification
        where qualification.app_id=new.app_id and qualification.tenant_id=new.tenant_id
          and qualification.environment=new.environment
          and qualification.principal_id=new.principal_id
          and qualification.qualification_id=new.qualification_id))
  then raise exception using errcode='55000',message='FALCON24_E1_UI_RECEIPT_PAIR_REQUIRED'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_e1_campaign_run_attempt_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare expected_attempt_id uuid;campaign_attempt_id uuid;
begin
  if old.claim_fence_consumed_at is null and new.claim_fence_consumed_at is not null then
    begin
      expected_attempt_id:=pg_catalog.current_setting(
        'data_agent.falcon24_gate_attempt_id',true)::uuid;
    exception when invalid_text_representation then
      raise exception using errcode='22023',message='FALCON24_E1_GATE_ATTEMPT_FENCE_INVALID';
    end;
    select campaign.attempt_id into campaign_attempt_id
    from app_data_agent.falcon24_acceptance_campaigns campaign
    where campaign.app_id=new.app_id and campaign.tenant_id=new.tenant_id
      and campaign.environment=new.environment and campaign.principal_id=new.principal_id
      and campaign.campaign_id=new.campaign_id;
    if expected_attempt_id is null or expected_attempt_id is distinct from campaign_attempt_id
    then raise exception using errcode='55000',message='FALCON24_E1_GATE_ATTEMPT_MISMATCH'; end if;
  end if;
  if old.status<>'VERIFIED' and new.status='VERIFIED' and not exists(
    select 1 from app_data_agent.falcon24_e1_ui_receipts qa_receipt
    join app_data_agent.falcon24_e1_ui_receipts trace_receipt
      on trace_receipt.app_id=qa_receipt.app_id and trace_receipt.tenant_id=qa_receipt.tenant_id
      and trace_receipt.environment=qa_receipt.environment
      and trace_receipt.run_id=qa_receipt.run_id
      and trace_receipt.viewport_width=qa_receipt.viewport_width
      and trace_receipt.receipt_kind='TRACE_UI'
      and trace_receipt.baseline_id=qa_receipt.baseline_id
      and trace_receipt.baseline_hash=qa_receipt.baseline_hash
      and trace_receipt.activation_attempt_id=qa_receipt.activation_attempt_id
    where qa_receipt.app_id=new.app_id and qa_receipt.tenant_id=new.tenant_id
      and qa_receipt.environment=new.environment and qa_receipt.run_id=new.run_id
      and qa_receipt.receipt_kind='QA_E2E'
      and qa_receipt.baseline_id=(select campaign.authority_baseline_id
        from app_data_agent.falcon24_acceptance_campaigns campaign
        where campaign.app_id=new.app_id and campaign.tenant_id=new.tenant_id
          and campaign.environment=new.environment and campaign.principal_id=new.principal_id
          and campaign.campaign_id=new.campaign_id))
  then raise exception using errcode='55000',message='FALCON24_E1_UI_RECEIPT_PAIR_REQUIRED'; end if;
  return new;
end
$function$;

-- PostgreSQL executes triggers with the same timing/event in name order. Keep the
-- E1 authority fence ahead of legacy row-shape fences so callers receive the
-- E1 attempt/UI-pair rejection before any retained compatibility rejection.
create trigger falcon24_000_e1_qualification_slot_attempt_fence
before update on app_data_agent.falcon24_qualification_slots
for each row execute function app_data_agent.falcon24_e1_qualification_slot_attempt_fence();
create trigger falcon24_000_e1_campaign_run_attempt_fence
before update on app_data_agent.falcon24_acceptance_campaign_runs
for each row execute function app_data_agent.falcon24_e1_campaign_run_attempt_fence();

alter table app_data_agent.falcon24_e1_gate_attempt_history owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_gate_attempt_history_immutable()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_qualification_slot_attempt_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_e1_campaign_run_attempt_fence()
  owner to data_agent_u6_rpc_owner;

revoke all on table app_data_agent.falcon24_e1_gate_attempt_history from public;
revoke all on function app_data_agent.falcon24_e1_gate_attempt_history_immutable(),
  app_data_agent.falcon24_e1_qualification_slot_attempt_fence(),
  app_data_agent.falcon24_e1_campaign_run_attempt_fence() from public;
revoke all on table app_data_agent.falcon24_e1_gate_attempt_history from data_agent_backend;
revoke all on function app_data_agent.falcon24_e1_gate_attempt_history_immutable(),
  app_data_agent.falcon24_e1_qualification_slot_attempt_fence(),
  app_data_agent.falcon24_e1_campaign_run_attempt_fence() from data_agent_backend;
do $postconditions$
begin
  if pg_catalog.to_regclass('app_data_agent.falcon24_e1_gate_attempt_history') is null
    or not exists(select 1 from pg_catalog.pg_attribute
      where attrelid='app_data_agent.falcon24_qualifications'::pg_catalog.regclass
        and attname='attempt_id' and attnotnull and not attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute
      where attrelid='app_data_agent.falcon24_acceptance_campaigns'::pg_catalog.regclass
        and attname='winning_qualification_attempt_id' and attnotnull and not attisdropped)
  then raise exception using errcode='P0001',message='FALCON24_E1_GATE_ATTEMPT_SCHEMA_DRIFT'; end if;
  if (select pg_catalog.count(*) from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgname in('falcon24_e1_gate_attempt_history_immutable',
        'falcon24_000_e1_qualification_slot_attempt_fence',
        'falcon24_000_e1_campaign_run_attempt_fence') and not trigger_row.tgisinternal)<>3
  then raise exception using errcode='P0001',message='FALCON24_E1_GATE_ATTEMPT_TRIGGER_DRIFT'; end if;
  if exists(select 1 from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.prosrc like '%^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$%')
  then raise exception using errcode='P0001',message='FALCON24_E1_LEGACY_GATE_ID_VALIDATOR_PRESENT'; end if;
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.begin_falcon24_qualification(jsonb)'::pg_catalog.regprocedure),'E1-Q1')=0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.begin_falcon24_acceptance_campaign(jsonb)'::pg_catalog.regprocedure),'E1-C1')=0
  then raise exception using errcode='P0001',message='FALCON24_E1_GATE_BEGIN_DEFINITION_DRIFT'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_e1_gate_attempt_history','SELECT')
  then raise exception using errcode='P0001',message='FALCON24_E1_GATE_HISTORY_GRANT_DRIFT'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010779_app_data_agent_falcon24_e1_gate_attempt_authority',
  'sha256:b0c0e427add89881035cc699bcabb7c1a894b1ecee72174d36c63bbedabb78c6');
commit;
