-- falcon24_qualification_authority_migration_checksum: sha256:94be5d83047992f0153d8e186e0a1e0a81b9c26c3a77d200b64ae8ca89fb189c
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='FALCON24_QUALIFICATION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='FALCON24_QUALIFICATION_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010773_app_data_agent_falcon24_ui_trace_gate')
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_BASELINE_10773_MISSING'; end if;
  if pg_catalog.to_regprocedure(
      'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.begin_falcon24_acceptance_campaign(jsonb)') is null
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_BASELINE_AUTHORITY_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create table app_data_agent.falcon24_qualifications(
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  principal_id uuid not null,qualification_id text not null,qualification_version integer not null,
  source_commit text not null check(source_commit~'^[0-9a-f]{40}$'),
  source_fingerprint text not null check(source_fingerprint~'^sha256:[0-9a-f]{64}$'),
  frozen_contract_hash text not null check(frozen_contract_hash~'^sha256:[0-9a-f]{64}$'),
  semantic_release_hash text not null check(semantic_release_hash~'^sha256:[0-9a-f]{64}$'),
  schema_snapshot_hash text not null check(schema_snapshot_hash~'^sha256:[0-9a-f]{64}$'),
  operator_registry_digest text not null check(operator_registry_digest~'^sha256:[0-9a-f]{64}$'),
  model_config_hash text not null check(model_config_hash~'^sha256:[0-9a-f]{64}$'),
  web_build_hash text not null check(web_build_hash~'^sha256:[0-9a-f]{64}$'),
  runtime_attestation_hash text not null check(runtime_attestation_hash~'^sha256:[0-9a-f]{64}$'),
  model_provider text not null check(model_provider='deepseek'),model_id text not null,
  manifest_hash text not null check(manifest_hash~'^sha256:[0-9a-f]{64}$'),
  slot_count integer not null check(slot_count=16),
  next_slot_ordinal integer not null default 0 check(next_slot_ordinal between 0 and 16),
  status text not null check(status in('READY','RUNNING','HOLD','PASSED')),
  first_failure_run_id uuid,first_failure_layer text,first_failure_code text,
  created_at timestamptz not null,updated_at timestamptz not null,
  primary key(app_id,tenant_id,environment,principal_id,qualification_id),
  unique(app_id,tenant_id,environment,principal_id,qualification_version),
  check(qualification_id~'^falcon24-[a-z0-9._-]*qualification[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    and pg_catalog.length(qualification_id) between 8 and 80
    and qualification_version between 1 and 1000000
    and model_id~'^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
    and ((status='HOLD')=(first_failure_run_id is not null))
    and ((status='HOLD')=(first_failure_layer is not null))
    and ((status='HOLD')=(first_failure_code is not null))
    and (first_failure_layer is null or first_failure_layer in(
      'ROOT_ROUTING','SQL_DATA_PREPARATION','GOVERNED_OPERATOR','ORACLE','PUBLISHER',
      'SANDBOX_RECLAMATION'))
    and (first_failure_code is null or first_failure_code~'^[A-Z][A-Z0-9_]{2,127}$'))
);

create table app_data_agent.falcon24_qualification_slots(
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  principal_id uuid not null,qualification_id text not null,ordinal integer not null,
  run_id uuid not null,slot_id text not null,stage text not null,case_id text not null,
  prompt text not null,prompt_hash text not null,run_variant text not null,expected_path jsonb not null,
  status text not null check(status in('PLANNED','CLAIMED','VERIFIED','HOLD')),
  claim_fence_hash text,claim_fence_consumed_at timestamptz,claimed_at timestamptz,
  result_hash text,result_document jsonb,
  trace_closure_hash text,trace_gate_receipt_hash text,trace_gate_receipt jsonb,
  ui_trace_gate_receipt_hash text,ui_trace_gate_receipt jsonb,
  sandbox_reclamation_claim_hash text,sandbox_reclamation_claim_consumed_at timestamptz,
  sandbox_reclamation_hash text,sandbox_reclamation_receipt jsonb,
  forced_cleanup_claim_hash text,forced_cleanup_claimed_at timestamptz,
  forced_cleanup_resolved_at timestamptz,forced_cleanup_receipt_hash text,
  forced_cleanup_receipt jsonb,secondary_failure_layer text,secondary_failure_code text,
  completed_at timestamptz,
  primary key(app_id,tenant_id,environment,principal_id,qualification_id,ordinal),
  unique(app_id,tenant_id,environment,principal_id,run_id),
  unique(app_id,tenant_id,environment,principal_id,qualification_id,slot_id),
  foreign key(app_id,tenant_id,environment,principal_id,qualification_id)
    references app_data_agent.falcon24_qualifications(
      app_id,tenant_id,environment,principal_id,qualification_id) on delete restrict,
  check(ordinal between 0 and 15 and slot_id~'^G[1-4]-0[1-5]$'
    and stage in('G1','G2','G3','G4')
    and case_id in('falcon24-business-review-18m','falcon24-delivery-experience-12m',
      'falcon24-inventory-damage-12m','falcon24-marketing-lag-effect',
      'falcon24-cohort-retention-m0-m6')
    and pg_catalog.length(prompt) between 1 and 8000 and pg_catalog.length(pg_catalog.btrim(prompt))>0
    and prompt_hash~'^sha256:[0-9a-f]{64}$' and run_variant in('COLD','WARM')
    and expected_path='["ROOT_ROUTING","SQL_DATA_PREPARATION","GOVERNED_OPERATOR","ORACLE","PUBLISHER","SANDBOX_RECLAMATION"]'::jsonb
    and (status<>'PLANNED' or (claimed_at is null and claim_fence_hash is null))
    and (status not in('CLAIMED','VERIFIED') or (claimed_at is not null
      and claim_fence_hash is not null))
    and (claim_fence_hash is null or claimed_at is not null)
    and (claim_fence_hash is null or claim_fence_hash~'^sha256:[0-9a-f]{64}$')
    and (claim_fence_consumed_at is null or claim_fence_hash is not null)
    and ((result_hash is null)=(result_document is null))
    and (result_hash is null or result_hash~'^sha256:[0-9a-f]{64}$')
    and ((trace_gate_receipt_hash is null)=(trace_gate_receipt is null))
    and (trace_closure_hash is null or trace_closure_hash~'^sha256:[0-9a-f]{64}$')
    and (trace_gate_receipt_hash is null or trace_gate_receipt_hash~'^sha256:[0-9a-f]{64}$')
    and ((ui_trace_gate_receipt_hash is null)=(ui_trace_gate_receipt is null))
    and (ui_trace_gate_receipt_hash is null
      or ui_trace_gate_receipt_hash~'^sha256:[0-9a-f]{64}$')
    and (ui_trace_gate_receipt is null or trace_gate_receipt is not null)
    and (sandbox_reclamation_claim_hash is null
      or sandbox_reclamation_claim_hash~'^sha256:[0-9a-f]{64}$')
    and ((sandbox_reclamation_hash is null)=(sandbox_reclamation_receipt is null))
    and (sandbox_reclamation_hash is null
      or sandbox_reclamation_hash~'^sha256:[0-9a-f]{64}$')
    and (sandbox_reclamation_claim_hash is null or ui_trace_gate_receipt is not null)
    and ((forced_cleanup_claim_hash is null)=(forced_cleanup_claimed_at is null))
    and (forced_cleanup_claim_hash is null
      or forced_cleanup_claim_hash~'^sha256:[0-9a-f]{64}$')
    and ((forced_cleanup_resolved_at is null)=(forced_cleanup_receipt_hash is null
      and forced_cleanup_receipt is null and secondary_failure_layer is null
      and secondary_failure_code is null))
    and (forced_cleanup_resolved_at is null or (
      ((forced_cleanup_receipt_hash is not null)=(forced_cleanup_receipt is not null))
      and ((forced_cleanup_receipt is not null) <> (secondary_failure_code is not null))))
    and (forced_cleanup_receipt_hash is null
      or forced_cleanup_receipt_hash~'^sha256:[0-9a-f]{64}$')
    and ((secondary_failure_layer is null)=(secondary_failure_code is null))
    and (secondary_failure_layer is null or secondary_failure_layer='SANDBOX_RECLAMATION')
    and (secondary_failure_code is null
      or secondary_failure_code~'^[A-Z][A-Z0-9_]{2,127}$')
    and (status<>'VERIFIED' or (claim_fence_consumed_at is not null
      and result_document is not null and trace_gate_receipt is not null
      and ui_trace_gate_receipt is not null and sandbox_reclamation_receipt is not null
      and completed_at is not null)))
);

alter table app_data_agent.falcon24_qualifications enable row level security;
alter table app_data_agent.falcon24_qualifications force row level security;
alter table app_data_agent.falcon24_qualification_slots enable row level security;
alter table app_data_agent.falcon24_qualification_slots force row level security;

create policy falcon24_qualification_authority
on app_data_agent.falcon24_qualifications for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid)
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid);
create policy falcon24_qualification_slot_authority
on app_data_agent.falcon24_qualification_slots for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid)
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid);

create function app_data_agent.load_falcon24_qualification(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-qualification-load@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id';
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_NOT_FOUND'; end if;
  return pg_catalog.to_jsonb(qualification);
end
$function$;

create function app_data_agent.load_falcon24_qualification_slot(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; slot app_data_agent.falcon24_qualification_slots%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-qualification-slot-load@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_SLOT_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id'
      and row.run_id=(command->>'run_id')::uuid;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_SLOT_NOT_FOUND'; end if;
  return pg_catalog.to_jsonb(slot);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_SLOT_LOAD_INVALID';
end
$function$;
create function app_data_agent.begin_falcon24_qualification(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; existing app_data_agent.falcon24_qualifications%rowtype;
  latest app_data_agent.falcon24_qualifications%rowtype; manifest jsonb; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','manifest','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-qualification-begin@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'manifest') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_BEGIN_INVALID'; end if;
  manifest:=command->'manifest';
  if app_data_agent.provider_json_object_has_exact_keys(manifest,array[
      'schema_version','qualification_id','qualification_version','source_commit',
      'source_fingerprint','frozen_contract_hash','semantic_release_hash',
      'schema_snapshot_hash','operator_registry_digest','model_config_hash','web_build_hash',
      'runtime_attestation_hash','model_provider','model_id','slots','manifest_hash']::text[])
      is distinct from true
    or manifest->>'schema_version' is distinct from 'falcon24-qualification-manifest@1.0.0'
    or manifest->>'manifest_hash' is distinct from
      app_data_agent.u2_canonical_sha256(manifest-'manifest_hash')
    or pg_catalog.jsonb_typeof(manifest->'qualification_id') is distinct from 'string'
    or manifest->>'qualification_id'!~
      '^falcon24-[a-z0-9._-]*qualification[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    or pg_catalog.length(manifest->>'qualification_id') not between 8 and 80
    or pg_catalog.jsonb_typeof(manifest->'qualification_version') is distinct from 'number'
    or manifest->>'qualification_version'!~'^[1-9][0-9]*$'
    or (manifest->>'qualification_version')::integer not between 1 and 1000000
    or (select pg_catalog.count(*) from pg_catalog.regexp_matches(
      manifest->>'qualification_id','(?:^|[._-])v([1-9][0-9]*)([._-]|$)','g'))<>1
    or ((pg_catalog.regexp_match(
      manifest->>'qualification_id','(?:^|[._-])v([1-9][0-9]*)([._-]|$)'))[1])::integer
      is distinct from (manifest->>'qualification_version')::integer
    or pg_catalog.jsonb_typeof(manifest->'source_commit') is distinct from 'string'
    or manifest->>'source_commit'!~'^[0-9a-f]{40}$'
    or exists(select 1 from pg_catalog.unnest(array[
        'source_fingerprint','frozen_contract_hash','semantic_release_hash',
        'schema_snapshot_hash','operator_registry_digest','model_config_hash','web_build_hash',
        'runtime_attestation_hash','manifest_hash']::text[]) hash_key
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
        or pg_catalog.jsonb_typeof(item->'run_id') is distinct from 'string'
        or (item->>'run_id')::uuid::text is distinct from item->>'run_id'
        or pg_catalog.jsonb_typeof(item->'slot_id') is distinct from 'string'
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
        or pg_catalog.jsonb_typeof(item->'prompt_hash') is distinct from 'string'
        or item->>'prompt_hash' is distinct from
          app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb(item->>'prompt'))
        or item->>'run_variant' is distinct from
          case when expected_stage='G4' then 'COLD' else 'WARM' end
        or item->'expected_path' is distinct from
          '["ROOT_ROUTING","SQL_DATA_PREPARATION","GOVERNED_OPERATOR","ORACLE","PUBLISHER","SANDBOX_RECLAMATION"]'::jsonb)
    or (select pg_catalog.count(distinct item->>'run_id')
      from pg_catalog.jsonb_array_elements(manifest->'slots') item)<>16
    or (select pg_catalog.count(distinct item->>'slot_id')
      from pg_catalog.jsonb_array_elements(manifest->'slots') item)<>16
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_MANIFEST_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:falcon24-qualification:'||authority.app_id::text||':'||
    authority.tenant_id::text||':'||authority.environment||':'||authority.principal_id::text,0));
  select * into existing from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=manifest->>'qualification_id' for update;
  if found then
    if existing.qualification_version is distinct from
        (manifest->>'qualification_version')::integer
      or existing.source_commit is distinct from manifest->>'source_commit'
      or existing.source_fingerprint is distinct from manifest->>'source_fingerprint'
      or existing.frozen_contract_hash is distinct from manifest->>'frozen_contract_hash'
      or existing.semantic_release_hash is distinct from manifest->>'semantic_release_hash'
      or existing.schema_snapshot_hash is distinct from manifest->>'schema_snapshot_hash'
      or existing.operator_registry_digest is distinct from manifest->>'operator_registry_digest'
      or existing.model_config_hash is distinct from manifest->>'model_config_hash'
      or existing.web_build_hash is distinct from manifest->>'web_build_hash'
      or existing.runtime_attestation_hash is distinct from manifest->>'runtime_attestation_hash'
      or existing.model_provider is distinct from manifest->>'model_provider'
      or existing.model_id is distinct from manifest->>'model_id'
      or existing.manifest_hash is distinct from manifest->>'manifest_hash'
    then raise exception using errcode='23505',message='FALCON24_QUALIFICATION_IDENTITY_CONFLICT'; end if;
    if (select pg_catalog.count(*) from app_data_agent.falcon24_qualification_slots slot
        where slot.app_id=authority.app_id and slot.tenant_id=authority.tenant_id
          and slot.environment=authority.environment and slot.principal_id=authority.principal_id
          and slot.qualification_id=existing.qualification_id)<>16
      or exists(
        select 1 from pg_catalog.jsonb_array_elements(manifest->'slots')
          with ordinality entry(item,ordinality)
        left join app_data_agent.falcon24_qualification_slots slot
          on slot.app_id=authority.app_id and slot.tenant_id=authority.tenant_id
          and slot.environment=authority.environment and slot.principal_id=authority.principal_id
          and slot.qualification_id=existing.qualification_id
          and slot.ordinal=(entry.ordinality-1)::integer
        where slot.run_id is distinct from (entry.item->>'run_id')::uuid
          or slot.slot_id is distinct from entry.item->>'slot_id'
          or slot.stage is distinct from entry.item->>'stage'
          or slot.case_id is distinct from entry.item->>'case_id'
          or slot.prompt is distinct from entry.item->>'prompt'
          or slot.prompt_hash is distinct from entry.item->>'prompt_hash'
          or slot.run_variant is distinct from entry.item->>'run_variant'
          or slot.expected_path is distinct from entry.item->'expected_path')
    then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SCHEDULE_MISMATCH'; end if;
    return pg_catalog.to_jsonb(existing);
  end if;
  select * into latest from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
    order by row.qualification_version desc limit 1 for update;
  if not found and (manifest->>'qualification_version')::integer<>1 then
    raise exception using errcode='22023',message='FALCON24_QUALIFICATION_BOOTSTRAP_VERSION_INVALID';
  elsif found and (manifest->>'qualification_version')::integer<>latest.qualification_version+1 then
    raise exception using errcode='22023',message='FALCON24_QUALIFICATION_VERSION_NOT_NEXT';
  elsif found and latest.status not in('HOLD','PASSED') then
    raise exception using errcode='55000',message='FALCON24_PREVIOUS_QUALIFICATION_ACTIVE';
  elsif found and latest.source_commit=manifest->>'source_commit'
    and latest.source_fingerprint=manifest->>'source_fingerprint'
    and latest.frozen_contract_hash=manifest->>'frozen_contract_hash'
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_CHANGE_REQUIRED'; end if;
  now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.falcon24_qualifications(
    app_id,tenant_id,environment,principal_id,qualification_id,qualification_version,
    source_commit,source_fingerprint,frozen_contract_hash,semantic_release_hash,
    schema_snapshot_hash,operator_registry_digest,model_config_hash,web_build_hash,
    runtime_attestation_hash,model_provider,model_id,manifest_hash,slot_count,
    next_slot_ordinal,status,created_at,updated_at)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    manifest->>'qualification_id',(manifest->>'qualification_version')::integer,
    manifest->>'source_commit',manifest->>'source_fingerprint',manifest->>'frozen_contract_hash',
    manifest->>'semantic_release_hash',manifest->>'schema_snapshot_hash',
    manifest->>'operator_registry_digest',manifest->>'model_config_hash',
    manifest->>'web_build_hash',manifest->>'runtime_attestation_hash',
    manifest->>'model_provider',manifest->>'model_id',manifest->>'manifest_hash',16,0,'READY',
    now_at,now_at) returning * into strict existing;
  insert into app_data_agent.falcon24_qualification_slots(
    app_id,tenant_id,environment,principal_id,qualification_id,ordinal,run_id,slot_id,stage,
    case_id,prompt,prompt_hash,run_variant,expected_path,status)
  select authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    existing.qualification_id,(entry.ordinality-1)::integer,(entry.item->>'run_id')::uuid,
    entry.item->>'slot_id',entry.item->>'stage',entry.item->>'case_id',entry.item->>'prompt',
    entry.item->>'prompt_hash',entry.item->>'run_variant',entry.item->'expected_path','PLANNED'
  from pg_catalog.jsonb_array_elements(manifest->'slots') with ordinality entry(item,ordinality);
  return pg_catalog.to_jsonb(existing);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_BEGIN_INVALID';
end
$function$;
create function app_data_agent.claim_falcon24_qualification_slot(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; normalized_fence_token text;
  fence_hash text; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','ordinal','run_id','slot_id','stage','case_id',
      'run_variant','claim_fence_token','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-qualification-slot-claim@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'ordinal') is distinct from 'number'
    or command->>'ordinal'!~'^(0|[1-9][0-9]*)$'
    or (command->>'ordinal')::integer not between 0 and 15
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'slot_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'stage') is distinct from 'string'
    or command->>'stage' not in('G1','G2','G3','G4')
    or pg_catalog.jsonb_typeof(command->'case_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_variant') is distinct from 'string'
    or command->>'run_variant' not in('COLD','WARM')
    or pg_catalog.jsonb_typeof(command->'claim_fence_token') is distinct from 'string'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_SLOT_CLAIM_INVALID'; end if;
  normalized_fence_token:=(command->>'claim_fence_token')::uuid::text;
  if normalized_fence_token is distinct from command->>'claim_fence_token' then
    raise exception using errcode='22023',message='FALCON24_QUALIFICATION_SLOT_CLAIM_INVALID'; end if;
  fence_hash:=app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_object('claim_fence_token',normalized_fence_token));
  select * into strict authority from platform.current_backend_authority(true);
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_NOT_FOUND'; end if;
  if qualification.status='HOLD' then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_HOLD'; end if;
  if qualification.status<>'READY'
    or qualification.next_slot_ordinal<>(command->>'ordinal')::integer
    or exists(select 1 from app_data_agent.falcon24_qualification_slots candidate
      where candidate.app_id=authority.app_id and candidate.tenant_id=authority.tenant_id
        and candidate.environment=authority.environment
        and candidate.principal_id=authority.principal_id
        and candidate.qualification_id=qualification.qualification_id
        and candidate.status='CLAIMED')
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SLOT_ORDER_OR_STATE_INVALID'; end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.ordinal=(command->>'ordinal')::integer for update;
  if not found or slot.status<>'PLANNED'
    or slot.run_id is distinct from (command->>'run_id')::uuid
    or slot.slot_id is distinct from command->>'slot_id'
    or slot.stage is distinct from command->>'stage'
    or slot.case_id is distinct from command->>'case_id'
    or slot.run_variant is distinct from command->>'run_variant'
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SCHEDULE_MISMATCH'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_qualification_slots set status='CLAIMED',claimed_at=now_at,
    claim_fence_hash=fence_hash,claim_fence_consumed_at=null
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and ordinal=slot.ordinal
      and status='PLANNED' returning * into strict slot;
  update app_data_agent.falcon24_qualifications set status='RUNNING',updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and status='READY';
  return pg_catalog.to_jsonb(slot);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_SLOT_CLAIM_INVALID';
end
$function$;

create function app_data_agent.accept_falcon24_qualification_run_with_config(
  requested_command jsonb,requested_config jsonb,submit_fence_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; slot app_data_agent.falcon24_qualification_slots%rowtype;
  qualification app_data_agent.falcon24_qualifications%rowtype;
  normalized_fence_token text; expected_fence_hash text; now_at timestamptz;
  acceptance jsonb; submit_fence_receipt jsonb;
begin
  if submit_fence_command is null
    or pg_catalog.jsonb_typeof(submit_fence_command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(submit_fence_command,array[
      'schema_version','qualification_id','run_id','claim_fence_token','command_hash']::text[])
      is distinct from true
    or submit_fence_command->>'schema_version' is distinct from
      'falcon24-qualification-question-run-acceptance@1.0.0'
    or submit_fence_command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(submit_fence_command-'command_hash')
    or pg_catalog.jsonb_typeof(submit_fence_command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(submit_fence_command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(submit_fence_command->'claim_fence_token') is distinct from 'string'
    or pg_catalog.jsonb_typeof(requested_command) is distinct from 'object'
    or pg_catalog.jsonb_typeof(requested_config) is distinct from 'object'
    or requested_command->>'run_id' is distinct from submit_fence_command->>'run_id'
    or requested_config->>'run_id' is distinct from submit_fence_command->>'run_id'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_QUESTION_ACCEPTANCE_INVALID'; end if;
  normalized_fence_token:=(submit_fence_command->>'claim_fence_token')::uuid::text;
  if normalized_fence_token is distinct from submit_fence_command->>'claim_fence_token' then
    raise exception using errcode='22023',message='FALCON24_QUALIFICATION_QUESTION_ACCEPTANCE_INVALID'; end if;
  expected_fence_hash:=app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_object('claim_fence_token',normalized_fence_token));
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:run:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
    authority.environment||':'||(submit_fence_command->>'run_id'),0));
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=submit_fence_command->>'qualification_id' for update;
  if not found or qualification.status<>'RUNNING' then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_NOT_RUNNING'; end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.run_id=(submit_fence_command->>'run_id')::uuid for update;
  if not found or slot.status<>'CLAIMED' then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SLOT_NOT_CLAIMED'; end if;
  if slot.claim_fence_hash is distinct from expected_fence_hash then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_FENCE_MISMATCH'; end if;
  if slot.claim_fence_consumed_at is not null then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_FENCE_ALREADY_CONSUMED'; end if;
  if exists(select 1 from app_data_agent.runs actual
      where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
        and actual.environment=authority.environment and actual.principal_id=authority.principal_id
        and actual.run_id=slot.run_id)
    or exists(select 1 from app_data_agent.workspace_run_bindings binding
      where binding.app_id=authority.app_id and binding.tenant_id=authority.tenant_id
        and binding.environment=authority.environment and binding.principal_id=authority.principal_id
        and binding.run_id=slot.run_id)
    or exists(select 1 from app_data_agent.effective_run_config_receipts receipt
      where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
        and receipt.environment=authority.environment and receipt.principal_id=authority.principal_id
        and receipt.run_id=slot.run_id)
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_RUN_PREEXISTS'; end if;
  acceptance:=app_data_agent.accept_question_run_with_effective_config(
    requested_command,requested_config);
  if acceptance#>>'{resolution,operation}' is distinct from 'QUESTION_RUN'
    or acceptance#>>'{resolution,admission}' is distinct from 'READY'
    or acceptance#>>'{resolution,run_id}' is distinct from slot.run_id::text
    or pg_catalog.jsonb_typeof(acceptance->'effective_config') is distinct from 'object'
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_QUESTION_ACCEPTANCE_NOT_READY'; end if;
  if not exists(select 1 from app_data_agent.runs actual
    join app_data_agent.workspace_run_bindings binding
      on binding.app_id=actual.app_id and binding.tenant_id=actual.tenant_id
      and binding.environment=actual.environment and binding.run_id=actual.run_id
      and binding.principal_id=actual.principal_id
    join app_data_agent.effective_run_config_receipts receipt
      on receipt.app_id=actual.app_id and receipt.tenant_id=actual.tenant_id
      and receipt.environment=actual.environment and receipt.run_id=actual.run_id
      and receipt.principal_id=actual.principal_id and receipt.datasource_id=binding.datasource_id
      and receipt.model_profile_id=binding.model_profile_id
      and receipt.model_config_version=binding.model_config_version
      and receipt.provider=binding.provider and receipt.model_id=binding.model_id
      and receipt.datasource_revision_hash=binding.datasource_binding_hash
    where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
      and actual.environment=authority.environment and actual.principal_id=authority.principal_id
      and actual.run_id=slot.run_id and actual.status='QUEUED'
      and receipt.operation_kind='QUESTION_RUN' and receipt.admission='READY')
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_ACCEPTANCE_NOT_ATOMIC'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_qualification_slots set claim_fence_consumed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and run_id=slot.run_id
      and status='CLAIMED' and claim_fence_hash=expected_fence_hash
      and claim_fence_consumed_at is null returning * into strict slot;
  submit_fence_receipt:=pg_catalog.jsonb_build_object(
    'qualification_id',qualification.qualification_id,'run_id',slot.run_id,
    'claim_fence_hash',slot.claim_fence_hash,
    'claim_fence_consumed_at',slot.claim_fence_consumed_at);
  return pg_catalog.jsonb_build_object(
    'acceptance',acceptance,'submit_fence',submit_fence_receipt);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_QUESTION_ACCEPTANCE_INVALID';
end
$function$;

create function app_data_agent.resolve_falcon24_qualification_submit_outcome(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype;
  actual_count bigint; binding_count bigint; receipt_count bigint; exact_triple_count bigint;
  durable_failure_code text; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','observed_failure_code','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-qualification-submit-outcome@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or (command->>'run_id')::uuid::text is distinct from command->>'run_id'
    or pg_catalog.jsonb_typeof(command->'observed_failure_code') is distinct from 'string'
    or command->>'observed_failure_code'!~'^[A-Z][A-Z0-9_]{2,127}$'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_SUBMIT_OUTCOME_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:run:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
    authority.environment||':'||(command->>'run_id'),0));
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_NOT_FOUND'; end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.run_id=(command->>'run_id')::uuid for update;
  if not found or slot.ordinal<>qualification.next_slot_ordinal then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_AUTHORITY_CORRUPT'; end if;
  if qualification.status='HOLD' then
    if qualification.first_failure_run_id is distinct from slot.run_id
      or qualification.first_failure_layer is distinct from 'ROOT_ROUTING'
      or slot.status<>'HOLD'
    then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_AUTHORITY_CORRUPT'; end if;
    return pg_catalog.jsonb_build_object(
      'schema_version','falcon24-qualification-submit-outcome@1.0.0',
      'disposition','HELD','qualification_id',qualification.qualification_id,
      'run_id',slot.run_id,'failure_code',qualification.first_failure_code);
  end if;
  if qualification.status not in('READY','RUNNING') or slot.status not in('PLANNED','CLAIMED') then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_OUTCOME_UNKNOWN'; end if;
  perform 1 from app_data_agent.runs actual
    where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
      and actual.environment=authority.environment and actual.principal_id=authority.principal_id
      and actual.run_id=slot.run_id for update;
  select pg_catalog.count(*) into strict actual_count from app_data_agent.runs actual
    where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
      and actual.environment=authority.environment and actual.principal_id=authority.principal_id
      and actual.run_id=slot.run_id;
  select pg_catalog.count(*) into strict binding_count from app_data_agent.workspace_run_bindings binding
    where binding.app_id=authority.app_id and binding.tenant_id=authority.tenant_id
      and binding.environment=authority.environment and binding.principal_id=authority.principal_id
      and binding.run_id=slot.run_id;
  select pg_catalog.count(*) into strict receipt_count from app_data_agent.effective_run_config_receipts receipt
    where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
      and receipt.environment=authority.environment and receipt.principal_id=authority.principal_id
      and receipt.run_id=slot.run_id;
  select pg_catalog.count(*) into strict exact_triple_count
    from app_data_agent.runs actual
    join app_data_agent.workspace_run_bindings binding
      on binding.app_id=actual.app_id and binding.tenant_id=actual.tenant_id
      and binding.environment=actual.environment and binding.principal_id=actual.principal_id
      and binding.run_id=actual.run_id
    join app_data_agent.effective_run_config_receipts receipt
      on receipt.app_id=actual.app_id and receipt.tenant_id=actual.tenant_id
      and receipt.environment=actual.environment and receipt.principal_id=actual.principal_id
      and receipt.run_id=actual.run_id and receipt.datasource_id=binding.datasource_id
      and receipt.model_profile_id=binding.model_profile_id
      and receipt.model_config_version=binding.model_config_version
      and receipt.provider=binding.provider and receipt.model_id=binding.model_id
      and receipt.datasource_revision_hash=binding.datasource_binding_hash
    where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
      and actual.environment=authority.environment and actual.principal_id=authority.principal_id
      and actual.run_id=slot.run_id
      and receipt.operation_kind='QUESTION_RUN' and receipt.admission='READY';
  if qualification.status='RUNNING' and slot.status='CLAIMED'
    and slot.claim_fence_hash is not null and slot.claim_fence_consumed_at is not null
    and actual_count=1 and binding_count=1 and receipt_count=1 and exact_triple_count=1
  then return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-qualification-submit-outcome@1.0.0',
    'disposition','ACCEPTED','qualification_id',qualification.qualification_id,
    'run_id',slot.run_id,'claim_fence_hash',slot.claim_fence_hash,
    'claim_fence_consumed_at',slot.claim_fence_consumed_at); end if;
  if qualification.status='READY' and slot.status='PLANNED'
    and slot.claim_fence_hash is null and slot.claim_fence_consumed_at is null
    and actual_count=0 and binding_count=0 and receipt_count=0 and exact_triple_count=0
  then durable_failure_code:=command->>'observed_failure_code';
  elsif qualification.status='RUNNING' and slot.status='CLAIMED'
    and slot.claim_fence_hash is not null and slot.claim_fence_consumed_at is null
    and actual_count=0 and binding_count=0 and receipt_count=0 and exact_triple_count=0
  then durable_failure_code:=command->>'observed_failure_code';
  else durable_failure_code:='FALCON24_QUALIFICATION_SUBMIT_AUTHORITY_CORRUPT'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_qualification_slots set status='HOLD',
    claimed_at=coalesce(claimed_at,now_at),completed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and ordinal=slot.ordinal
      and run_id=slot.run_id and status=slot.status returning * into strict slot;
  update app_data_agent.falcon24_qualifications set status='HOLD',
    first_failure_run_id=slot.run_id,first_failure_layer='ROOT_ROUTING',
    first_failure_code=durable_failure_code,updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and status=qualification.status
    returning * into strict qualification;
  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-qualification-submit-outcome@1.0.0',
    'disposition','HELD','qualification_id',qualification.qualification_id,
    'run_id',slot.run_id,'failure_code',qualification.first_failure_code);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_SUBMIT_OUTCOME_INVALID';
end
$function$;
create function app_data_agent.hold_falcon24_qualification(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; actual_status text; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','failure_layer','failure_code',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-qualification-hold@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'failure_layer') is distinct from 'string'
    or command->>'failure_layer' not in('ROOT_ROUTING','SQL_DATA_PREPARATION',
      'GOVERNED_OPERATOR','ORACLE','PUBLISHER','SANDBOX_RECLAMATION')
    or pg_catalog.jsonb_typeof(command->'failure_code') is distinct from 'string'
    or command->>'failure_code'!~'^[A-Z][A-Z0-9_]{2,127}$'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_HOLD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_NOT_FOUND'; end if;
  if qualification.status='PASSED' then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ALREADY_PASSED'; end if;
  if qualification.status='HOLD' then
    if qualification.first_failure_run_id is distinct from (command->>'run_id')::uuid
      or qualification.first_failure_layer is distinct from command->>'failure_layer'
      or qualification.first_failure_code is distinct from command->>'failure_code'
    then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_HOLD_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(qualification);
  end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.ordinal=qualification.next_slot_ordinal
      and row.run_id=(command->>'run_id')::uuid for update;
  if not found or slot.status not in('PLANNED','CLAIMED')
    or (qualification.status='READY' and slot.status<>'PLANNED')
    or (qualification.status='RUNNING' and slot.status<>'CLAIMED')
    or qualification.status not in('READY','RUNNING')
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SLOT_ORDER_OR_STATE_INVALID'; end if;
  if slot.status='PLANNED' and command->>'failure_layer'<>'ROOT_ROUTING' then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SLOT_NOT_CLAIMED'; end if;
  if slot.status='CLAIMED' then
    if slot.claim_fence_consumed_at is null then
      raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_OUTCOME_REQUIRED'; end if;
    select actual.status into actual_status from app_data_agent.runs actual
      where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
        and actual.environment=authority.environment and actual.principal_id=authority.principal_id
        and actual.run_id=slot.run_id for update;
    if not found then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ACTUAL_RUN_REQUIRED'; end if;
    if actual_status not in('SUCCEEDED','FAILED','CANCELLED') then
      raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ACTUAL_RUN_NOT_TERMINAL'; end if;
  end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_qualification_slots set status='HOLD',
    claimed_at=coalesce(claimed_at,now_at),completed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and ordinal=slot.ordinal
      and status=slot.status returning * into strict slot;
  update app_data_agent.falcon24_qualifications set status='HOLD',
    first_failure_run_id=slot.run_id,first_failure_layer=command->>'failure_layer',
    first_failure_code=command->>'failure_code',updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id returning * into strict qualification;
  return pg_catalog.to_jsonb(qualification);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_HOLD_INVALID';
end
$function$;

create function app_data_agent.stage_falcon24_qualification_result(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; result_document jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','result_hash','result_document',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-qualification-result-stage@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'result_hash') is distinct from 'string'
    or command->>'result_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'result_document') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_RESULT_STAGE_INVALID'; end if;
  result_document:=command->'result_document';
  if result_document->>'run_id' is distinct from command->>'run_id'
    or command->>'result_hash' is distinct from
      app_data_agent.u2_canonical_sha256(result_document)
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_RESULT_STAGE_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_NOT_FOUND'; end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.run_id=(command->>'run_id')::uuid for update;
  if not found or qualification.status<>'RUNNING' or slot.status<>'CLAIMED' then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SLOT_NOT_CLAIMED'; end if;
  if slot.claim_fence_consumed_at is null then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_FENCE_REQUIRED'; end if;
  if not exists(select 1 from app_data_agent.runs actual
    where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
      and actual.environment=authority.environment and actual.principal_id=authority.principal_id
      and actual.run_id=slot.run_id and actual.status='RUNNING')
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ACTUAL_RUN_NOT_RUNNING'; end if;
  if result_document->>'case_id' is distinct from slot.case_id
    or result_document->>'run_variant' is distinct from slot.run_variant
    or result_document->>'provider' is distinct from 'deepseek'
    or result_document->>'model_id' is distinct from qualification.model_id
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID'; end if;
  if slot.result_hash is not null then
    if slot.result_hash<>command->>'result_hash' or slot.result_document<>result_document
    then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_RESULT_STAGE_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(slot);
  end if;
  update app_data_agent.falcon24_qualification_slots set result_hash=command->>'result_hash',
    result_document=result_document
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and run_id=slot.run_id
      and status='CLAIMED' and result_hash is null and result_document is null
    returning * into strict slot;
  return pg_catalog.to_jsonb(slot);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_RESULT_STAGE_INVALID';
end
$function$;
create function app_data_agent.stage_falcon24_qualification_trace(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; receipt jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','trace_closure_hash',
      'trace_gate_receipt_hash','trace_gate_receipt','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-qualification-trace-stage@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'trace_closure_hash') is distinct from 'string'
    or command->>'trace_closure_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'trace_gate_receipt_hash') is distinct from 'string'
    or command->>'trace_gate_receipt_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'trace_gate_receipt') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID'; end if;
  receipt:=command->'trace_gate_receipt';
  if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','campaign_id','run_id','trace_hash','node_count','edge_count',
      'detail_count','sql_node_count','query_evidence_node_count',
      'analysis_evidence_node_count','chart_node_count','report_node_count',
      'detail_closure','verified_at','receipt_hash']::text[]) is distinct from true
    or receipt->>'schema_version' is distinct from
      'falcon24-resolution-trace-gate-receipt@2.0.0'
    or receipt->>'campaign_id' is distinct from command->>'qualification_id'
    or receipt->>'run_id' is distinct from command->>'run_id'
    or receipt->>'trace_hash' is distinct from command->>'trace_closure_hash'
    or receipt->>'receipt_hash' is distinct from command->>'trace_gate_receipt_hash'
    or receipt->>'receipt_hash' is distinct from
      app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
    or exists(select 1 from pg_catalog.unnest(array[
        'node_count','edge_count','detail_count','sql_node_count',
        'query_evidence_node_count','analysis_evidence_node_count','chart_node_count',
        'report_node_count']::text[]) count_key
      where pg_catalog.jsonb_typeof(receipt->count_key) is distinct from 'number'
        or receipt->>count_key!~'^[1-9][0-9]*$'
        or (receipt->>count_key)::numeric not between 1 and 9007199254740991)
    or receipt->>'detail_count' is distinct from receipt->>'node_count'
    or (receipt->>'node_count')::numeric <
      (receipt->>'sql_node_count')::numeric+(receipt->>'query_evidence_node_count')::numeric
      +(receipt->>'analysis_evidence_node_count')::numeric
      +(receipt->>'chart_node_count')::numeric+(receipt->>'report_node_count')::numeric
    or pg_catalog.jsonb_typeof(receipt->'detail_closure') is distinct from 'array'
    or pg_catalog.jsonb_array_length(receipt->'detail_closure')<1
    or pg_catalog.jsonb_array_length(receipt->'detail_closure')<>
      (receipt->>'detail_count')::integer
    or exists(
      with elements as (
        select item,ordinality,
          pg_catalog.lag(item->>'node_id') over(order by ordinality) previous_node_id
        from pg_catalog.jsonb_array_elements(receipt->'detail_closure')
          with ordinality element(item,ordinality))
      select 1 from elements where
        app_data_agent.provider_json_object_has_exact_keys(item,array[
          'node_id','detail_hash']::text[]) is distinct from true
        or pg_catalog.jsonb_typeof(item->'node_id') is distinct from 'string'
        or pg_catalog.length(item->>'node_id') not between 1 and 320
        or pg_catalog.jsonb_typeof(item->'detail_hash') is distinct from 'string'
        or item->>'detail_hash'!~'^sha256:[0-9a-f]{64}$'
        or (previous_node_id is not null and previous_node_id>=item->>'node_id'))
    or pg_catalog.jsonb_typeof(receipt->'verified_at') is distinct from 'string'
    or (receipt->>'verified_at')::timestamptz is null
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_NOT_FOUND'; end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.run_id=(command->>'run_id')::uuid for update;
  if not found or qualification.status<>'RUNNING' or slot.status<>'CLAIMED' then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ORDER_OR_STATE_INVALID'; end if;
  if slot.claim_fence_consumed_at is null then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_FENCE_INVALID'; end if;
  if not exists(select 1 from app_data_agent.runs actual
    where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
      and actual.environment=authority.environment and actual.principal_id=authority.principal_id
      and actual.run_id=slot.run_id and actual.status='SUCCEEDED')
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ORDER_OR_STATE_INVALID'; end if;
  if slot.trace_gate_receipt_hash is not null then
    if slot.trace_closure_hash<>command->>'trace_closure_hash'
      or slot.trace_gate_receipt_hash<>command->>'trace_gate_receipt_hash'
      or slot.trace_gate_receipt<>receipt
    then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_STAGE_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(slot);
  end if;
  update app_data_agent.falcon24_qualification_slots set
    trace_closure_hash=command->>'trace_closure_hash',
    trace_gate_receipt_hash=command->>'trace_gate_receipt_hash',trace_gate_receipt=receipt
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and run_id=slot.run_id
      and status='CLAIMED' and trace_gate_receipt_hash is null
    returning * into strict slot;
  return pg_catalog.to_jsonb(slot);
exception when invalid_text_representation or numeric_value_out_of_range
  or invalid_datetime_format or datetime_field_overflow then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID';
end
$function$;

create function app_data_agent.stage_falcon24_qualification_ui_trace(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; receipt jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','trace_closure_hash',
      'ui_trace_gate_receipt_hash','ui_trace_gate_receipt','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-qualification-ui-trace-stage@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'trace_closure_hash') is distinct from 'string'
    or command->>'trace_closure_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'ui_trace_gate_receipt_hash') is distinct from 'string'
    or command->>'ui_trace_gate_receipt_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'ui_trace_gate_receipt') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID'; end if;
  receipt:=command->'ui_trace_gate_receipt';
  if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','campaign_id','run_id','workspace_id','conversation_id','trace_hash',
      'web_build','browser_harness_version','opened_nodes','opened_artifact_refs','chart_ref',
      'chart_renderer_version','chart_rendered','source_table_visible','error_banner',
      'dom_snapshot_hash','screenshot_hash','observed_at','receipt_hash']::text[])
      is distinct from true
    or receipt->>'schema_version' is distinct from
      'falcon24-resolution-trace-ui-gate-receipt@1.0.0'
    or receipt->>'campaign_id' is distinct from command->>'qualification_id'
    or receipt->>'run_id' is distinct from command->>'run_id'
    or receipt->>'trace_hash' is distinct from command->>'trace_closure_hash'
    or receipt->>'receipt_hash' is distinct from command->>'ui_trace_gate_receipt_hash'
    or receipt->>'receipt_hash' is distinct from
      app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
    or pg_catalog.jsonb_typeof(receipt->'workspace_id') is distinct from 'string'
    or (receipt->>'workspace_id')::uuid::text is distinct from receipt->>'workspace_id'
    or pg_catalog.jsonb_typeof(receipt->'conversation_id') is distinct from 'string'
    or (receipt->>'conversation_id')::uuid::text is distinct from receipt->>'conversation_id'
    or pg_catalog.jsonb_typeof(receipt->'web_build') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(receipt->'web_build',array[
      'build_id','generation_id']::text[]) is distinct from true
    or exists(select 1 from pg_catalog.unnest(array[
      receipt->'web_build'->>'build_id',receipt->'web_build'->>'generation_id',
      receipt->>'dom_snapshot_hash',receipt->>'screenshot_hash']::text[]) value
      where value!~'^sha256:[0-9a-f]{64}$')
    or receipt->>'browser_harness_version' is distinct from
      'falcon24-agent-browser-trace-gate@1.0.0'
    or receipt->>'chart_renderer_version' is distinct from 'governed-vchart@1.0.0'
    or receipt->'chart_rendered' is distinct from 'true'::jsonb
    or receipt->'source_table_visible' is distinct from 'true'::jsonb
    or receipt->'error_banner' is distinct from 'null'::jsonb
    or pg_catalog.jsonb_typeof(receipt->'opened_nodes') is distinct from 'array'
    or pg_catalog.jsonb_array_length(receipt->'opened_nodes')<1
    or pg_catalog.jsonb_typeof(receipt->'opened_artifact_refs') is distinct from 'array'
    or pg_catalog.jsonb_array_length(receipt->'opened_artifact_refs')<>5
    or exists(
      with elements as (
        select item,ordinality,
          pg_catalog.concat_ws(chr(31),item->>'app_id',item->>'tenant_id',
            item->>'environment',item->>'run_id',item->>'artifact_id',
            item->>'artifact_type',item->>'revision',item->>'content_hash') identity,
          pg_catalog.lag(pg_catalog.concat_ws(chr(31),item->>'app_id',item->>'tenant_id',
            item->>'environment',item->>'run_id',item->>'artifact_id',
            item->>'artifact_type',item->>'revision',item->>'content_hash'))
            over(order by ordinality) previous_identity
        from pg_catalog.jsonb_array_elements(receipt->'opened_artifact_refs')
          with ordinality element(item,ordinality))
      select 1 from elements where
        app_data_agent.provider_json_object_has_exact_keys(item,array[
          'artifact_id','artifact_type','app_id','tenant_id','environment','run_id',
          'revision','content_hash']::text[]) is distinct from true
        or pg_catalog.jsonb_typeof(item->'artifact_id') is distinct from 'string'
        or (item->>'artifact_id')::uuid::text is distinct from item->>'artifact_id'
        or pg_catalog.jsonb_typeof(item->'app_id') is distinct from 'string'
        or (item->>'app_id')::uuid::text is distinct from item->>'app_id'
        or pg_catalog.jsonb_typeof(item->'tenant_id') is distinct from 'string'
        or (item->>'tenant_id')::uuid::text is distinct from item->>'tenant_id'
        or item->>'tenant_id' is distinct from receipt->>'workspace_id'
        or pg_catalog.jsonb_typeof(item->'environment') is distinct from 'string'
        or pg_catalog.length(item->>'environment') not between 1 and 64
        or pg_catalog.jsonb_typeof(item->'run_id') is distinct from 'string'
        or (item->>'run_id')::uuid::text is distinct from item->>'run_id'
        or item->>'run_id' is distinct from receipt->>'run_id'
        or item->>'artifact_type' not in('SqlArtifact','QueryEvidence',
          'DerivedAnalysisEvidence','ArtifactWorkspaceDocument','AnalysisReport')
        or pg_catalog.jsonb_typeof(item->'revision') is distinct from 'number'
        or item->>'revision'!~'^[1-9][0-9]*$'
        or (item->>'revision')::numeric not between 1 and 9007199254740991
        or pg_catalog.jsonb_typeof(item->'content_hash') is distinct from 'string'
        or item->>'content_hash'!~'^sha256:[0-9a-f]{64}$'
        or (previous_identity is not null and previous_identity>=identity))
    or exists(select 1 from pg_catalog.unnest(array[
        'SqlArtifact','QueryEvidence','DerivedAnalysisEvidence',
        'ArtifactWorkspaceDocument','AnalysisReport']::text[]) required_type
      where (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(
          receipt->'opened_artifact_refs') item
        where item->>'artifact_type'=required_type)<>1)
    or pg_catalog.jsonb_typeof(receipt->'chart_ref') is distinct from 'object'
    or receipt->'chart_ref'->>'artifact_type' is distinct from 'ArtifactWorkspaceDocument'
    or not receipt->'opened_artifact_refs' @> pg_catalog.jsonb_build_array(receipt->'chart_ref')
    or pg_catalog.jsonb_typeof(receipt->'observed_at') is distinct from 'string'
    or (receipt->>'observed_at')::timestamptz is null
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_NOT_FOUND'; end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.run_id=(command->>'run_id')::uuid for update;
  if not found or qualification.status<>'RUNNING' or slot.status<>'CLAIMED' then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ORDER_OR_STATE_INVALID'; end if;
  if slot.trace_closure_hash is null or slot.trace_gate_receipt_hash is null
    or slot.trace_gate_receipt is null
    or slot.trace_closure_hash<>command->>'trace_closure_hash'
    or receipt->>'workspace_id'<>slot.tenant_id::text
    or receipt->'opened_nodes' is distinct from slot.trace_gate_receipt->'detail_closure'
    or app_data_agent.u2_canonical_sha256(receipt->'web_build')
      is distinct from qualification.web_build_hash
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_TRACE_REQUIRED'; end if;
  if slot.ui_trace_gate_receipt_hash is not null then
    if slot.ui_trace_gate_receipt_hash<>command->>'ui_trace_gate_receipt_hash'
      or slot.ui_trace_gate_receipt<>receipt
    then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_STAGE_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(slot);
  end if;
  update app_data_agent.falcon24_qualification_slots set
    ui_trace_gate_receipt_hash=command->>'ui_trace_gate_receipt_hash',
    ui_trace_gate_receipt=receipt
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and run_id=slot.run_id
      and status='CLAIMED' and ui_trace_gate_receipt_hash is null
    returning * into strict slot;
  return pg_catalog.to_jsonb(slot);
exception when invalid_text_representation or numeric_value_out_of_range
  or invalid_datetime_format or datetime_field_overflow then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID';
end
$function$;
create or replace function app_data_agent.resolve_falcon24_run_execution_policy(
  requested_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; execution_policy jsonb; candidate_count bigint;
begin
  if requested_run_id is null then
    raise exception using errcode='22023',message='FALCON24_RUN_EXECUTION_POLICY_INPUT_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(false);
  with candidates as (
    select pg_catalog.jsonb_build_object(
      'schema_version','run-execution-policy@1.0.0',
      'acceptance_authority_kind','CAMPAIGN',
      'campaign_id',campaign_run.campaign_id,'case_id',campaign_run.case_id,
      'run_variant',campaign_run.run_variant,'repetition',campaign_run.repetition,
      'policy_id',campaign.policy_id,'mode','FALCON24_STRICT','max_run_attempts',1,
      'max_provider_attempts_per_call',1,'max_root_turns',1,
      'max_text2sql_candidate_attempts',1,'analysis_repair_budget_per_category',0,
      'max_file_transfer_attempts',1,'allow_stage_recovery',false,'hold_on_failure',true) policy
    from app_data_agent.falcon24_acceptance_campaign_runs campaign_run
    join app_data_agent.falcon24_acceptance_campaigns campaign
      on campaign.app_id=campaign_run.app_id and campaign.tenant_id=campaign_run.tenant_id
      and campaign.environment=campaign_run.environment
      and campaign.principal_id=campaign_run.principal_id
      and campaign.campaign_id=campaign_run.campaign_id
    where campaign_run.app_id=authority.app_id and campaign_run.tenant_id=authority.tenant_id
      and campaign_run.environment=authority.environment
      and campaign_run.principal_id=authority.principal_id
      and campaign_run.run_id=requested_run_id
    union all
    select pg_catalog.jsonb_build_object(
      'schema_version','run-execution-policy@1.0.0',
      'acceptance_authority_kind','QUALIFICATION',
      'campaign_id',slot.qualification_id,'case_id',slot.case_id,
      'run_variant',slot.run_variant,'repetition',1,
      'policy_id','falcon24-strict-zero-retry@1.0.0','mode','FALCON24_STRICT',
      'max_run_attempts',1,'max_provider_attempts_per_call',1,'max_root_turns',1,
      'max_text2sql_candidate_attempts',1,'analysis_repair_budget_per_category',0,
      'max_file_transfer_attempts',1,'allow_stage_recovery',false,'hold_on_failure',true) policy
    from app_data_agent.falcon24_qualification_slots slot
    join app_data_agent.falcon24_qualifications qualification
      on qualification.app_id=slot.app_id and qualification.tenant_id=slot.tenant_id
      and qualification.environment=slot.environment
      and qualification.principal_id=slot.principal_id
      and qualification.qualification_id=slot.qualification_id
    where slot.app_id=authority.app_id and slot.tenant_id=authority.tenant_id
      and slot.environment=authority.environment and slot.principal_id=authority.principal_id
      and slot.run_id=requested_run_id), aggregate_candidates as (
    select pg_catalog.count(*) count_value,pg_catalog.jsonb_agg(policy) policies from candidates)
  select count_value,policies->0 into strict candidate_count,execution_policy
    from aggregate_candidates;
  if candidate_count>1 then
    raise exception using errcode='55000',message='FALCON24_RUN_EXECUTION_POLICY_AMBIGUOUS';
  end if;
  if candidate_count=0 then return null; end if;
  return execution_policy;
end
$function$;

create function app_data_agent.load_falcon24_qualification_pending_failed_run()
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; pending jsonb;
begin
  select * into strict authority from platform.current_backend_authority(false);
  begin
    select pg_catalog.jsonb_build_object(
        'qualification_id',qualification.qualification_id,'run_id',slot.run_id)
      into strict pending
      from app_data_agent.falcon24_qualifications qualification
      join app_data_agent.falcon24_qualification_slots slot
        on slot.app_id=qualification.app_id and slot.tenant_id=qualification.tenant_id
        and slot.environment=qualification.environment
        and slot.principal_id=qualification.principal_id
        and slot.qualification_id=qualification.qualification_id
        and slot.ordinal=qualification.next_slot_ordinal
      join app_data_agent.runs actual
        on actual.app_id=slot.app_id and actual.tenant_id=slot.tenant_id
        and actual.environment=slot.environment and actual.principal_id=slot.principal_id
        and actual.run_id=slot.run_id
      where qualification.app_id=authority.app_id
        and qualification.tenant_id=authority.tenant_id
        and qualification.environment=authority.environment
        and qualification.principal_id=authority.principal_id
        and qualification.status='RUNNING' and slot.status='CLAIMED'
        and slot.claim_fence_consumed_at is not null and actual.status='FAILED';
  exception
    when no_data_found then return null;
    when too_many_rows then raise exception using errcode='55000',
      message='FALCON24_QUALIFICATION_PENDING_FAILED_RUN_AMBIGUOUS';
  end;
  return pending;
end
$function$;
create function app_data_agent.falcon24_qualification_reclamation_receipt_valid(
  receipt jsonb,qualification_id text,requested_run_id uuid,
  runtime_attestation_hash text,expected_receipt_hash text)
returns boolean language plpgsql immutable security definer set search_path='' as $function$
begin
  return receipt is not null and pg_catalog.jsonb_typeof(receipt)='object'
    and app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','campaign_id','run_id','runtime_attestation_hash',
      'management_observation_schema_version','management_operation_id','observation_source',
      'target_metadata_hash','before_observation','killed','after_observation','residual',
      'completed_at','management_observation_hash','receipt_hash']::text[]) is true
    and receipt->>'schema_version'='falcon24-sandbox-reclamation-receipt@2.0.0'
    and receipt->>'campaign_id'=qualification_id
    and receipt->>'run_id'=requested_run_id::text
    and receipt->>'runtime_attestation_hash'=runtime_attestation_hash
    and receipt->>'management_observation_schema_version'=
      'opensandbox-management-reclamation-observation@1.0.0'
    and pg_catalog.jsonb_typeof(receipt->'management_operation_id')='string'
    and (receipt->>'management_operation_id')::uuid is not null
    and receipt->>'observation_source'='OPENSANDBOX_MANAGEMENT_API'
    and pg_catalog.jsonb_typeof(receipt->'target_metadata_hash')='string'
    and receipt->>'target_metadata_hash'~'^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(receipt->'before_observation')='object'
    and app_data_agent.provider_json_object_has_exact_keys(
      receipt->'before_observation',array['active_count','observation_hash']::text[]) is true
    and pg_catalog.jsonb_typeof(receipt#>'{before_observation,active_count}')='number'
    and receipt#>>'{before_observation,active_count}'~'^(0|[1-9][0-9]*)$'
    and receipt#>>'{before_observation,observation_hash}'~'^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(receipt->'killed')='number'
    and receipt->>'killed'~'^(0|[1-9][0-9]*)$'
    and receipt->>'killed'=receipt#>>'{before_observation,active_count}'
    and pg_catalog.jsonb_typeof(receipt->'after_observation')='object'
    and app_data_agent.provider_json_object_has_exact_keys(
      receipt->'after_observation',array['active_count','observation_hash']::text[]) is true
    and pg_catalog.jsonb_typeof(receipt#>'{after_observation,active_count}')='number'
    and receipt#>>'{after_observation,active_count}'='0'
    and receipt#>>'{after_observation,observation_hash}'~'^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(receipt->'residual')='number'
    and receipt->>'residual'='0'
    and pg_catalog.jsonb_typeof(receipt->'completed_at')='string'
    and (receipt->>'completed_at')::timestamptz is not null
    and receipt->>'management_observation_hash'=
      app_data_agent.u2_canonical_sha256(receipt-array[
        'schema_version','campaign_id','run_id','runtime_attestation_hash',
        'management_observation_hash','receipt_hash']::text[])
    and receipt->>'receipt_hash'=expected_receipt_hash
    and receipt->>'receipt_hash'=app_data_agent.u2_canonical_sha256(receipt-'receipt_hash');
exception when invalid_text_representation or numeric_value_out_of_range
  or invalid_datetime_format or datetime_field_overflow then return false;
end
$function$;

create function app_data_agent.claim_falcon24_qualification_sandbox_reclamation(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; claim_hash text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','reclamation_claim_token',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-qualification-sandbox-reclamation-claim@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'reclamation_claim_token') is distinct from 'string'
    or (command->>'reclamation_claim_token')::uuid::text
      is distinct from command->>'reclamation_claim_token'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID'; end if;
  claim_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'reclamation_claim_token',command->>'reclamation_claim_token'));
  select * into strict authority from platform.current_backend_authority(true);
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_NOT_FOUND'; end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.run_id=(command->>'run_id')::uuid for update;
  if not found or qualification.status<>'RUNNING' or slot.status<>'CLAIMED'
    or slot.claim_fence_consumed_at is null or slot.result_document is null
    or slot.trace_gate_receipt is null or slot.ui_trace_gate_receipt is null
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_UI_TRACE_REQUIRED'; end if;
  if slot.sandbox_reclamation_hash is not null then
    if slot.sandbox_reclamation_claim_hash is distinct from claim_hash then
      raise exception using errcode='55000',message='FALCON24_QUALIFICATION_STAGE_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(slot);
  end if;
  if slot.sandbox_reclamation_claim_hash is not null then
    if slot.sandbox_reclamation_claim_hash is distinct from claim_hash then
      raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ORDER_OR_STATE_INVALID'; end if;
    return pg_catalog.to_jsonb(slot);
  end if;
  update app_data_agent.falcon24_qualification_slots set
    sandbox_reclamation_claim_hash=claim_hash
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and run_id=slot.run_id
      and status='CLAIMED' and sandbox_reclamation_claim_hash is null
    returning * into strict slot;
  return pg_catalog.to_jsonb(slot);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID';
end
$function$;

create function app_data_agent.record_falcon24_qualification_sandbox_reclamation(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; receipt jsonb; claim_hash text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','reclamation_claim_token',
      'sandbox_reclamation_hash','sandbox_reclamation_receipt','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-qualification-sandbox-reclamation-record@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'reclamation_claim_token') is distinct from 'string'
    or (command->>'reclamation_claim_token')::uuid::text
      is distinct from command->>'reclamation_claim_token'
    or pg_catalog.jsonb_typeof(command->'sandbox_reclamation_hash') is distinct from 'string'
    or command->>'sandbox_reclamation_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'sandbox_reclamation_receipt') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID'; end if;
  receipt:=command->'sandbox_reclamation_receipt';
  claim_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'reclamation_claim_token',command->>'reclamation_claim_token'));
  select * into strict authority from platform.current_backend_authority(true);
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_NOT_FOUND'; end if;
  if not app_data_agent.falcon24_qualification_reclamation_receipt_valid(
    receipt,qualification.qualification_id,(command->>'run_id')::uuid,
    qualification.runtime_attestation_hash,command->>'sandbox_reclamation_hash')
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID'; end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.run_id=(command->>'run_id')::uuid for update;
  if not found or qualification.status<>'RUNNING' or slot.status<>'CLAIMED'
    or slot.ui_trace_gate_receipt is null
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_UI_TRACE_REQUIRED'; end if;
  if slot.sandbox_reclamation_claim_hash is distinct from claim_hash then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SANDBOX_RECLAMATION_REQUIRED'; end if;
  if slot.sandbox_reclamation_hash is not null then
    if slot.sandbox_reclamation_hash<>command->>'sandbox_reclamation_hash'
      or slot.sandbox_reclamation_receipt<>receipt
    then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_STAGE_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(slot);
  end if;
  update app_data_agent.falcon24_qualification_slots set
    sandbox_reclamation_hash=command->>'sandbox_reclamation_hash',
    sandbox_reclamation_receipt=receipt,
    sandbox_reclamation_claim_consumed_at=pg_catalog.clock_timestamp()
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and run_id=slot.run_id
      and status='CLAIMED' and sandbox_reclamation_claim_hash=claim_hash
      and sandbox_reclamation_claim_consumed_at is null and sandbox_reclamation_hash is null
    returning * into strict slot;
  return pg_catalog.to_jsonb(slot);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID';
end
$function$;
create function app_data_agent.claim_falcon24_qualification_forced_cleanup(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; cleanup_hash text; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','forced_cleanup_token',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-qualification-forced-cleanup-claim@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'forced_cleanup_token') is distinct from 'string'
    or (command->>'forced_cleanup_token')::uuid::text
      is distinct from command->>'forced_cleanup_token'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_FORCED_CLEANUP_INVALID'; end if;
  cleanup_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'forced_cleanup_token',command->>'forced_cleanup_token'));
  select * into strict authority from platform.current_backend_authority(true);
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_NOT_FOUND'; end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.run_id=(command->>'run_id')::uuid for update;
  if not found or qualification.status<>'HOLD' or slot.status<>'HOLD'
    or qualification.first_failure_run_id is distinct from slot.run_id
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_HOLD'; end if;
  if slot.forced_cleanup_claim_hash is not null then
    if slot.forced_cleanup_claim_hash is distinct from cleanup_hash then
      raise exception using errcode='55000',
        message='FALCON24_QUALIFICATION_FORCED_CLEANUP_ALREADY_CLAIMED'; end if;
    return pg_catalog.to_jsonb(slot);
  end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_qualification_slots set
    forced_cleanup_claim_hash=cleanup_hash,forced_cleanup_claimed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and run_id=slot.run_id
      and status='HOLD' and forced_cleanup_claim_hash is null
    returning * into strict slot;
  return pg_catalog.to_jsonb(slot);
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_FORCED_CLEANUP_INVALID';
end
$function$;

create function app_data_agent.resolve_falcon24_qualification_forced_cleanup(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; cleanup_hash text; receipt jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','forced_cleanup_token',
      'forced_cleanup_receipt_hash','forced_cleanup_receipt','secondary_failure_code',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-qualification-forced-cleanup-resolve@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'forced_cleanup_token') is distinct from 'string'
    or (command->>'forced_cleanup_token')::uuid::text
      is distinct from command->>'forced_cleanup_token'
    or ((command->'forced_cleanup_receipt' is distinct from 'null'::jsonb)
      =(command->'secondary_failure_code' is distinct from 'null'::jsonb))
    or ((command->'forced_cleanup_receipt' is distinct from 'null'::jsonb)
      <> (command->'forced_cleanup_receipt_hash' is distinct from 'null'::jsonb))
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_FORCED_CLEANUP_INVALID'; end if;
  cleanup_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'forced_cleanup_token',command->>'forced_cleanup_token'));
  receipt:=command->'forced_cleanup_receipt';
  if receipt is distinct from 'null'::jsonb and (
    pg_catalog.jsonb_typeof(command->'forced_cleanup_receipt_hash') is distinct from 'string'
    or command->>'forced_cleanup_receipt_hash'!~'^sha256:[0-9a-f]{64}$')
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_FORCED_CLEANUP_INVALID'; end if;
  if command->'secondary_failure_code' is distinct from 'null'::jsonb and (
    pg_catalog.jsonb_typeof(command->'secondary_failure_code') is distinct from 'string'
    or command->>'secondary_failure_code'!~'^[A-Z][A-Z0-9_]{2,127}$')
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_FORCED_CLEANUP_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_NOT_FOUND'; end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.run_id=(command->>'run_id')::uuid for update;
  if not found or qualification.status<>'HOLD' or slot.status<>'HOLD'
    or qualification.first_failure_run_id is distinct from slot.run_id
    or slot.forced_cleanup_claim_hash is distinct from cleanup_hash
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_FORCED_CLEANUP_INVALID'; end if;
  if slot.forced_cleanup_resolved_at is not null then
    if (receipt is distinct from 'null'::jsonb and (
        slot.forced_cleanup_receipt_hash is distinct from command->>'forced_cleanup_receipt_hash'
        or slot.forced_cleanup_receipt is distinct from receipt
        or slot.secondary_failure_code is not null))
      or (command->'secondary_failure_code' is distinct from 'null'::jsonb and (
        slot.secondary_failure_layer is distinct from 'SANDBOX_RECLAMATION'
        or slot.secondary_failure_code is distinct from command->>'secondary_failure_code'
        or slot.forced_cleanup_receipt is not null))
    then raise exception using errcode='55000',
      message='FALCON24_QUALIFICATION_FORCED_CLEANUP_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(slot);
  end if;
  if receipt is distinct from 'null'::jsonb and not
    app_data_agent.falcon24_qualification_reclamation_receipt_valid(
      receipt,qualification.qualification_id,slot.run_id,
      qualification.runtime_attestation_hash,command->>'forced_cleanup_receipt_hash')
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_FORCED_CLEANUP_INVALID'; end if;
  update app_data_agent.falcon24_qualification_slots set
    forced_cleanup_resolved_at=pg_catalog.clock_timestamp(),
    forced_cleanup_receipt_hash=case when receipt is distinct from 'null'::jsonb
      then command->>'forced_cleanup_receipt_hash' else null end,
    forced_cleanup_receipt=case when receipt is distinct from 'null'::jsonb then receipt else null end,
    secondary_failure_layer=case when receipt is distinct from 'null'::jsonb
      then null else 'SANDBOX_RECLAMATION' end,
    secondary_failure_code=case when receipt is distinct from 'null'::jsonb
      then null else command->>'secondary_failure_code' end
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and run_id=slot.run_id
      and status='HOLD' and forced_cleanup_claim_hash=cleanup_hash
      and forced_cleanup_resolved_at is null returning * into strict slot;
  return pg_catalog.to_jsonb(slot);
exception when invalid_text_representation or numeric_value_out_of_range
  or invalid_datetime_format or datetime_field_overflow then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_FORCED_CLEANUP_INVALID';
end
$function$;
create function app_data_agent.falcon24_qualification_repair_evidence_present(
  requested_run_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $function$
declare authority record; detected boolean;
begin
  select * into strict authority from platform.current_backend_authority(false);
  with recursive documents(document) as (
    select event.payload_json from app_data_agent.run_events event
      where event.app_id=authority.app_id and event.tenant_id=authority.tenant_id
        and event.environment=authority.environment and event.run_id=requested_run_id
    union all
    select artifact.document_json from app_data_agent.artifacts artifact
      where artifact.app_id=authority.app_id and artifact.tenant_id=authority.tenant_id
        and artifact.environment=authority.environment and artifact.run_id=requested_run_id
  ), walk(value) as (
    select document from documents
    union all
    select child.value from walk parent
    cross join lateral (
      select object_value value
      from pg_catalog.jsonb_each(case when pg_catalog.jsonb_typeof(parent.value)='object'
        then parent.value else '{}'::jsonb end) object_entry(object_key,object_value)
      union all
      select array_value value
      from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(parent.value)='array'
        then parent.value else '[]'::jsonb end) array_entry(array_value)
    ) child
  )
  select pg_catalog.coalesce(pg_catalog.bool_or(
      (pg_catalog.jsonb_typeof(value)='string'
        and value#>>'{}' like 'provider:text2sql:repair:%')
      or (pg_catalog.jsonb_typeof(value)='object' and value ? 'repair_attempts'
        and pg_catalog.jsonb_typeof(value->'repair_attempts')='object'
        and exists(select 1 from pg_catalog.jsonb_each(value->'repair_attempts') attempt
          where pg_catalog.jsonb_typeof(attempt.value)='number'
            and (attempt.value#>>'{}')::numeric>0))),false)
    into strict detected from walk;
  if detected then return true; end if;
  if pg_catalog.to_regclass('app_data_agent.provider_invocation_intents') is not null then
    execute $query$
      select exists(select 1 from app_data_agent.provider_invocation_intents intent
        where intent.app_id=$1 and intent.tenant_id=$2 and intent.environment=$3
          and intent.principal_id=$4 and intent.run_id=$5
          and (intent.idempotency_key like '%text2sql%repair%'
            or intent.intent_json::text like '%provider:text2sql:repair:%'))
    $query$ into strict detected using authority.app_id,authority.tenant_id,
      authority.environment,authority.principal_id,requested_run_id;
  end if;
  return pg_catalog.coalesce(detected,false);
end
$function$;

create function app_data_agent.complete_falcon24_qualification_slot(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; now_at timestamptz;
  execution_policy jsonb; attempt_count bigint; succeeded_attempt_count bigint;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','expected_result_hash',
      'sandbox_reclamation_hash','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-qualification-slot-complete@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'expected_result_hash') is distinct from 'string'
    or command->>'expected_result_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'sandbox_reclamation_hash') is distinct from 'string'
    or command->>'sandbox_reclamation_hash'!~'^sha256:[0-9a-f]{64}$'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_COMPLETION_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_NOT_FOUND'; end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.run_id=(command->>'run_id')::uuid for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_SLOT_NOT_FOUND'; end if;
  if slot.status='VERIFIED' then
    if slot.result_hash<>command->>'expected_result_hash'
      or slot.sandbox_reclamation_hash<>command->>'sandbox_reclamation_hash'
      or slot.trace_gate_receipt is null or slot.ui_trace_gate_receipt is null
      or slot.sandbox_reclamation_receipt is null
    then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_STAGE_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(qualification);
  end if;
  if qualification.status<>'RUNNING' or slot.status<>'CLAIMED'
    or qualification.next_slot_ordinal<>slot.ordinal
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ORDER_OR_STATE_INVALID'; end if;
  if slot.claim_fence_consumed_at is null or slot.result_hash is null
    or slot.result_document is null or slot.trace_closure_hash is null
    or slot.trace_gate_receipt_hash is null or slot.trace_gate_receipt is null
    or slot.ui_trace_gate_receipt_hash is null or slot.ui_trace_gate_receipt is null
    or slot.sandbox_reclamation_claim_hash is null
    or slot.sandbox_reclamation_claim_consumed_at is null
    or slot.sandbox_reclamation_hash is null or slot.sandbox_reclamation_receipt is null
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SANDBOX_RECLAMATION_REQUIRED'; end if;
  if slot.result_hash<>command->>'expected_result_hash'
    or slot.sandbox_reclamation_hash<>command->>'sandbox_reclamation_hash'
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_STAGE_REPLAY_MISMATCH'; end if;
  if not exists(select 1 from app_data_agent.runs actual
    where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
      and actual.environment=authority.environment and actual.principal_id=authority.principal_id
      and actual.run_id=slot.run_id and actual.status='SUCCEEDED')
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ORDER_OR_STATE_INVALID'; end if;
  execution_policy:=app_data_agent.resolve_falcon24_run_execution_policy(slot.run_id);
  if execution_policy is null
    or execution_policy->>'acceptance_authority_kind' is distinct from 'QUALIFICATION'
    or execution_policy->>'campaign_id' is distinct from qualification.qualification_id
    or execution_policy->>'policy_id' is distinct from 'falcon24-strict-zero-retry@1.0.0'
    or execution_policy->>'mode' is distinct from 'FALCON24_STRICT'
    or execution_policy->>'max_run_attempts' is distinct from '1'
    or execution_policy->>'max_provider_attempts_per_call' is distinct from '1'
    or execution_policy->>'max_root_turns' is distinct from '1'
    or execution_policy->>'max_text2sql_candidate_attempts' is distinct from '1'
    or execution_policy->>'analysis_repair_budget_per_category' is distinct from '0'
    or execution_policy->>'max_file_transfer_attempts' is distinct from '1'
    or execution_policy->>'allow_stage_recovery' is distinct from 'false'
    or execution_policy->>'hold_on_failure' is distinct from 'true'
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_COMPLETION_INVALID'; end if;
  select pg_catalog.count(*),pg_catalog.count(*) filter(
      where attempt.attempt_no=1 and attempt.status='SUCCEEDED')
    into strict attempt_count,succeeded_attempt_count
    from app_data_agent.run_attempts attempt
    where attempt.app_id=authority.app_id and attempt.tenant_id=authority.tenant_id
      and attempt.environment=authority.environment and attempt.run_id=slot.run_id;
  if attempt_count<>1 or succeeded_attempt_count<>1
    or exists(select 1 from app_data_agent.run_events event
      where event.app_id=authority.app_id and event.tenant_id=authority.tenant_id
        and event.environment=authority.environment and event.run_id=slot.run_id
        and event.event_type='run.retry_scheduled')
    or app_data_agent.falcon24_qualification_repair_evidence_present(slot.run_id)
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_COMPLETION_INVALID'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_qualification_slots set status='VERIFIED',completed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and ordinal=slot.ordinal
      and run_id=slot.run_id and status='CLAIMED' returning * into strict slot;
  update app_data_agent.falcon24_qualifications set
    next_slot_ordinal=slot.ordinal+1,
    status=case when slot.ordinal=15 then 'PASSED' else 'READY' end,updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and status='RUNNING'
      and next_slot_ordinal=slot.ordinal returning * into strict qualification;
  return pg_catalog.to_jsonb(qualification);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_COMPLETION_INVALID';
end
$function$;
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
alter table app_data_agent.falcon24_qualification_slots
  add constraint falcon24_qualification_slot_result_binding_check check(
    result_document is null or result_hash=app_data_agent.u2_canonical_sha256(result_document)),
  add constraint falcon24_qualification_slot_trace_binding_check check(
    trace_gate_receipt is null or (
      trace_closure_hash is not null
      and trace_gate_receipt->>'schema_version'='falcon24-resolution-trace-gate-receipt@2.0.0'
      and trace_gate_receipt->>'campaign_id'=qualification_id
      and trace_gate_receipt->>'run_id'=run_id::text
      and trace_gate_receipt->>'trace_hash'=trace_closure_hash
      and trace_gate_receipt->>'receipt_hash'=trace_gate_receipt_hash
      and trace_gate_receipt_hash=
        app_data_agent.u2_canonical_sha256(trace_gate_receipt-'receipt_hash'))),
  add constraint falcon24_qualification_slot_ui_trace_binding_check check(
    ui_trace_gate_receipt is null or (
      trace_gate_receipt is not null
      and ui_trace_gate_receipt->>'schema_version'=
        'falcon24-resolution-trace-ui-gate-receipt@1.0.0'
      and ui_trace_gate_receipt->>'campaign_id'=qualification_id
      and ui_trace_gate_receipt->>'run_id'=run_id::text
      and ui_trace_gate_receipt->>'workspace_id'=tenant_id::text
      and ui_trace_gate_receipt->>'trace_hash'=trace_closure_hash
      and ui_trace_gate_receipt->>'receipt_hash'=ui_trace_gate_receipt_hash
      and ui_trace_gate_receipt_hash=
        app_data_agent.u2_canonical_sha256(ui_trace_gate_receipt-'receipt_hash'))),
  add constraint falcon24_qualification_slot_reclamation_binding_check check(
    sandbox_reclamation_receipt is null or (
      sandbox_reclamation_receipt->>'campaign_id'=qualification_id
      and sandbox_reclamation_receipt->>'run_id'=run_id::text
      and sandbox_reclamation_receipt->>'receipt_hash'=sandbox_reclamation_hash
      and sandbox_reclamation_hash=
        app_data_agent.u2_canonical_sha256(sandbox_reclamation_receipt-'receipt_hash'))),
  add constraint falcon24_qualification_slot_forced_cleanup_binding_check check(
    forced_cleanup_receipt is null or (
      status='HOLD' and forced_cleanup_claim_hash is not null
      and forced_cleanup_receipt->>'campaign_id'=qualification_id
      and forced_cleanup_receipt->>'run_id'=run_id::text
      and forced_cleanup_receipt->>'receipt_hash'=forced_cleanup_receipt_hash
      and forced_cleanup_receipt_hash=
        app_data_agent.u2_canonical_sha256(forced_cleanup_receipt-'receipt_hash'))),
  add constraint falcon24_qualification_slot_forced_cleanup_state_check check(
    forced_cleanup_claim_hash is null or status='HOLD');

create function app_data_agent.falcon24_qualification_state_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if old.status='HOLD' and new is distinct from old then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_HOLD';
  end if;
  if old.status='PASSED' and new is distinct from old then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ALREADY_PASSED';
  end if;
  if (old.status='READY' and new.status not in('READY','RUNNING','HOLD'))
    or (old.status='RUNNING' and new.status not in('RUNNING','READY','PASSED','HOLD'))
    or new.next_slot_ordinal<old.next_slot_ordinal
    or new.next_slot_ordinal>old.next_slot_ordinal+1
    or (new.next_slot_ordinal<>old.next_slot_ordinal
      and not (old.status='RUNNING' and new.status in('READY','PASSED')))
    or (new.status='HOLD' and old.status<>'HOLD' and (
      new.first_failure_run_id is null or new.first_failure_layer is null
      or new.first_failure_code is null))
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ORDER_OR_STATE_INVALID'; end if;
  if old.first_failure_run_id is not null and (
    new.first_failure_run_id is distinct from old.first_failure_run_id
    or new.first_failure_layer is distinct from old.first_failure_layer
    or new.first_failure_code is distinct from old.first_failure_code)
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_HOLD_REPLAY_MISMATCH'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_qualification_slot_state_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if (old.status='PLANNED' and new.status not in('PLANNED','CLAIMED','HOLD'))
    or (old.status='CLAIMED' and new.status not in('CLAIMED','VERIFIED','HOLD'))
    or (old.status in('VERIFIED','HOLD') and new.status<>old.status)
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ORDER_OR_STATE_INVALID'; end if;
  if old.claim_fence_hash is not null and (
    new.claim_fence_hash is distinct from old.claim_fence_hash
    or (old.claim_fence_consumed_at is not null
      and new.claim_fence_consumed_at is distinct from old.claim_fence_consumed_at))
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_FENCE_MISMATCH'; end if;
  if old.result_hash is not null and (
      new.result_hash is distinct from old.result_hash
      or new.result_document is distinct from old.result_document)
    or old.trace_gate_receipt_hash is not null and (
      new.trace_closure_hash is distinct from old.trace_closure_hash
      or new.trace_gate_receipt_hash is distinct from old.trace_gate_receipt_hash
      or new.trace_gate_receipt is distinct from old.trace_gate_receipt)
    or old.ui_trace_gate_receipt_hash is not null and (
      new.ui_trace_gate_receipt_hash is distinct from old.ui_trace_gate_receipt_hash
      or new.ui_trace_gate_receipt is distinct from old.ui_trace_gate_receipt)
    or old.sandbox_reclamation_hash is not null and (
      new.sandbox_reclamation_hash is distinct from old.sandbox_reclamation_hash
      or new.sandbox_reclamation_receipt is distinct from old.sandbox_reclamation_receipt)
    or old.forced_cleanup_resolved_at is not null and new is distinct from old
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_STAGE_REPLAY_MISMATCH'; end if;
  if (new.sandbox_reclamation_claim_hash is not null or new.status='VERIFIED')
    and (new.result_document is null or new.trace_gate_receipt is null
      or new.ui_trace_gate_receipt is null)
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_UI_TRACE_REQUIRED'; end if;
  return new;
end
$function$;

create trigger falcon24_qualifications_state_fence
before update on app_data_agent.falcon24_qualifications
for each row execute function app_data_agent.falcon24_qualification_state_fence();
create trigger falcon24_qualification_slots_state_fence
before update on app_data_agent.falcon24_qualification_slots
for each row execute function app_data_agent.falcon24_qualification_slot_state_fence();
alter table app_data_agent.falcon24_qualifications owner to data_agent_u6_rpc_owner;
alter table app_data_agent.falcon24_qualification_slots owner to data_agent_u6_rpc_owner;

alter function app_data_agent.load_falcon24_qualification(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_qualification_slot(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_qualification(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.claim_falcon24_qualification_slot(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.accept_falcon24_qualification_run_with_config(
  jsonb,jsonb,jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_falcon24_qualification_submit_outcome(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.hold_falcon24_qualification(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.stage_falcon24_qualification_result(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.stage_falcon24_qualification_trace(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.stage_falcon24_qualification_ui_trace(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_falcon24_run_execution_policy(uuid)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_qualification_pending_failed_run()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_qualification_reclamation_receipt_valid(
  jsonb,text,uuid,text,text) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.claim_falcon24_qualification_sandbox_reclamation(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_falcon24_qualification_sandbox_reclamation(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.claim_falcon24_qualification_forced_cleanup(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_falcon24_qualification_forced_cleanup(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_qualification_repair_evidence_present(uuid)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.complete_falcon24_qualification_slot(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_acceptance_campaign(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_qualification_state_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_qualification_slot_state_fence()
  owner to data_agent_u6_rpc_owner;

grant select on table app_data_agent.run_attempts,app_data_agent.run_events,
  app_data_agent.artifacts,app_data_agent.provider_invocation_intents
  to data_agent_u6_rpc_owner;
create policy falcon24_qualification_run_attempt_select
  on app_data_agent.run_attempts for select to data_agent_u6_rpc_owner
  using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy falcon24_qualification_run_event_select
  on app_data_agent.run_events for select to data_agent_u6_rpc_owner
  using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy falcon24_qualification_artifact_select
  on app_data_agent.artifacts for select to data_agent_u6_rpc_owner
  using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy falcon24_qualification_provider_invocation_select
  on app_data_agent.provider_invocation_intents for select to data_agent_u6_rpc_owner
  using(platform.backend_context_matches(app_id,tenant_id,environment,false)
    and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid);

revoke all on function
  app_data_agent.load_falcon24_qualification(jsonb),
  app_data_agent.load_falcon24_qualification_slot(jsonb),
  app_data_agent.begin_falcon24_qualification(jsonb),
  app_data_agent.claim_falcon24_qualification_slot(jsonb),
  app_data_agent.accept_falcon24_qualification_run_with_config(
    jsonb,jsonb,jsonb),
  app_data_agent.resolve_falcon24_qualification_submit_outcome(jsonb),
  app_data_agent.hold_falcon24_qualification(jsonb),
  app_data_agent.stage_falcon24_qualification_result(jsonb),
  app_data_agent.stage_falcon24_qualification_trace(jsonb),
  app_data_agent.stage_falcon24_qualification_ui_trace(jsonb),
  app_data_agent.load_falcon24_qualification_pending_failed_run(),
  app_data_agent.claim_falcon24_qualification_sandbox_reclamation(jsonb),
  app_data_agent.record_falcon24_qualification_sandbox_reclamation(jsonb),
  app_data_agent.claim_falcon24_qualification_forced_cleanup(jsonb),
  app_data_agent.resolve_falcon24_qualification_forced_cleanup(jsonb),
  app_data_agent.complete_falcon24_qualification_slot(jsonb)
  from public,anon,authenticated,service_role,data_agent_job_authority;

revoke all on function
  app_data_agent.falcon24_qualification_reclamation_receipt_valid(jsonb,text,uuid,text,text),
  app_data_agent.falcon24_qualification_repair_evidence_present(uuid),
  app_data_agent.falcon24_qualification_state_fence(),
  app_data_agent.falcon24_qualification_slot_state_fence()
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

grant execute on function
  app_data_agent.load_falcon24_qualification(jsonb),
  app_data_agent.load_falcon24_qualification_slot(jsonb),
  app_data_agent.begin_falcon24_qualification(jsonb),
  app_data_agent.claim_falcon24_qualification_slot(jsonb),
  app_data_agent.accept_falcon24_qualification_run_with_config(
    jsonb,jsonb,jsonb),
  app_data_agent.resolve_falcon24_qualification_submit_outcome(jsonb),
  app_data_agent.hold_falcon24_qualification(jsonb),
  app_data_agent.stage_falcon24_qualification_result(jsonb),
  app_data_agent.stage_falcon24_qualification_trace(jsonb),
  app_data_agent.stage_falcon24_qualification_ui_trace(jsonb),
  app_data_agent.load_falcon24_qualification_pending_failed_run(),
  app_data_agent.claim_falcon24_qualification_sandbox_reclamation(jsonb),
  app_data_agent.record_falcon24_qualification_sandbox_reclamation(jsonb),
  app_data_agent.claim_falcon24_qualification_forced_cleanup(jsonb),
  app_data_agent.resolve_falcon24_qualification_forced_cleanup(jsonb),
  app_data_agent.complete_falcon24_qualification_slot(jsonb)
  to data_agent_backend;
do $postconditions$
declare definition text; function_name text;
  public_functions constant text[]:=array[
    'load_falcon24_qualification','load_falcon24_qualification_slot',
    'begin_falcon24_qualification','claim_falcon24_qualification_slot',
    'accept_falcon24_qualification_run_with_config',
    'resolve_falcon24_qualification_submit_outcome','hold_falcon24_qualification',
    'stage_falcon24_qualification_result','stage_falcon24_qualification_trace',
    'stage_falcon24_qualification_ui_trace','load_falcon24_qualification_pending_failed_run',
    'claim_falcon24_qualification_sandbox_reclamation',
    'record_falcon24_qualification_sandbox_reclamation',
    'claim_falcon24_qualification_forced_cleanup',
    'resolve_falcon24_qualification_forced_cleanup',
    'complete_falcon24_qualification_slot']::text[];
begin
  if pg_catalog.to_regclass('app_data_agent.falcon24_qualifications') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_qualification_slots') is null
    or (select pg_catalog.count(*) from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid in(
        'app_data_agent.falcon24_qualifications'::pg_catalog.regclass,
        'app_data_agent.falcon24_qualification_slots'::pg_catalog.regclass)
        and trigger_row.tgname in('falcon24_qualifications_state_fence',
          'falcon24_qualification_slots_state_fence') and not trigger_row.tgisinternal)<>2
    or (select pg_catalog.count(*) from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid=
        'app_data_agent.falcon24_qualification_slots'::pg_catalog.regclass
        and constraint_row.conname in(
          'falcon24_qualification_slot_result_binding_check',
          'falcon24_qualification_slot_trace_binding_check',
          'falcon24_qualification_slot_ui_trace_binding_check',
          'falcon24_qualification_slot_reclamation_binding_check',
          'falcon24_qualification_slot_forced_cleanup_binding_check',
          'falcon24_qualification_slot_forced_cleanup_state_check'))<>6
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_SCHEMA_DRIFT'; end if;

  foreach function_name in array public_functions loop
    if (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent' and procedure.proname=function_name)<>1
    then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_FUNCTION_INVENTORY_DRIFT'; end if;
  end loop;
  if exists(select 1 from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='app_data_agent'
      and procedure.proname=any(public_functions)
      and (pg_catalog.pg_get_userbyid(procedure.proowner)<>'data_agent_u6_rpc_owner'
        or not procedure.prosecdef or not procedure.proconfig@>array['search_path=""']::text[]))
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_FUNCTION_SECURITY_DRIFT'; end if;

  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.accept_falcon24_qualification_run_with_config(jsonb,jsonb,jsonb)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(definition,'accept_question_run_with_effective_config')=0
    or pg_catalog.strpos(definition,'claim_fence_consumed_at')=0
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_SUBMIT_FENCE_DRIFT'; end if;
  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.resolve_falcon24_run_execution_policy(uuid)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(definition,'''acceptance_authority_kind'',''QUALIFICATION''')=0
    or pg_catalog.strpos(definition,'''acceptance_authority_kind'',''CAMPAIGN''')=0
    or pg_catalog.strpos(definition,'''analysis_repair_budget_per_category'',0')=0
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_EXECUTION_POLICY_DRIFT'; end if;
  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.complete_falcon24_qualification_slot(jsonb)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(definition,'run.retry_scheduled')=0
    or pg_catalog.strpos(definition,'falcon24_qualification_repair_evidence_present')=0
    or pg_catalog.strpos(definition,'ui_trace_gate_receipt')=0
    or pg_catalog.strpos(definition,'sandbox_reclamation_receipt')=0
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_COMPLETION_GATE_DRIFT'; end if;
  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.stage_falcon24_qualification_result(jsonb)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(definition,'actual.status=''RUNNING''')=0
    or pg_catalog.strpos(definition,'actual.status=''SUCCEEDED''')>0
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_RESULT_STAGE_TIMING_DRIFT'; end if;
  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.begin_falcon24_acceptance_campaign(jsonb)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(definition,'>=15')=0
    or pg_catalog.strpos(definition,'FALCON24_QUALIFICATION_V15_GATE_REQUIRED')=0
    or pg_catalog.strpos(definition,'qualification.status=''PASSED''')=0
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_FINAL_GATE_DRIFT'; end if;

  if exists(select 1 from pg_catalog.unnest(array[
      'SELECT','INSERT','UPDATE','DELETE']::text[]) privilege_name
    where pg_catalog.has_table_privilege('data_agent_backend',
        'app_data_agent.falcon24_qualifications',privilege_name)
      or pg_catalog.has_table_privilege('data_agent_backend',
        'app_data_agent.falcon24_qualification_slots',privilege_name))
    or exists(select 1 from pg_catalog.unnest(public_functions) name
      where not pg_catalog.has_function_privilege('data_agent_backend',
        case name
          when 'accept_falcon24_qualification_run_with_config'
            then 'app_data_agent.'||name||'(jsonb,jsonb,jsonb)'
          when 'load_falcon24_qualification_pending_failed_run'
            then 'app_data_agent.'||name||'()'
          else 'app_data_agent.'||name||'(jsonb)' end,'EXECUTE'))
  then raise exception using errcode='P0001',message='FALCON24_QUALIFICATION_GRANT_DRIFT'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010774_app_data_agent_falcon24_qualification_authority',
  'sha256:94be5d83047992f0153d8e186e0a1e0a81b9c26c3a77d200b64ae8ca89fb189c');
commit;
