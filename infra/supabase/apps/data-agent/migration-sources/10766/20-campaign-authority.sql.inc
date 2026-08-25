create table app_data_agent.falcon24_acceptance_campaigns(
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  principal_id uuid not null,campaign_id text not null,campaign_version integer not null,
  source_fingerprint text not null check(source_fingerprint~'^sha256:[0-9a-f]{64}$'),
  frozen_contract_hash text not null check(frozen_contract_hash~'^sha256:[0-9a-f]{64}$'),
  runtime_attestation_hash text not null check(runtime_attestation_hash~'^sha256:[0-9a-f]{64}$'),
  manifest_hash text not null check(manifest_hash~'^sha256:[0-9a-f]{64}$'),
  policy_id text not null,run_count integer not null check(run_count=30),
  next_run_ordinal integer not null default 0 check(next_run_ordinal between 0 and 30),
  status text not null check(status in('READY','RUNNING','HOLD','PASSED')),
  first_failure_run_id uuid,first_failure_layer text,first_failure_code text,
  created_at timestamptz not null,updated_at timestamptz not null,
  primary key(app_id,tenant_id,environment,principal_id,campaign_id),
  unique(app_id,tenant_id,environment,principal_id,campaign_version),
  check(campaign_id~'^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$'
    and pg_catalog.length(campaign_id) between 8 and 80
    and campaign_version between 1 and 1000000
    and policy_id='falcon24-strict-zero-retry@1.0.0'
    and ((status='HOLD')=(first_failure_run_id is not null))
    and ((status='HOLD')=(first_failure_layer is not null))
    and ((status='HOLD')=(first_failure_code is not null)))
);

create table app_data_agent.falcon24_acceptance_campaign_runs(
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  principal_id uuid not null,campaign_id text not null,run_ordinal integer not null,
  run_id uuid not null,case_id text not null,run_variant text not null,repetition integer not null,
  status text not null check(status in('PLANNED','CLAIMED','VERIFIED','HOLD')),
  trace_closure_hash text,result_hash text,result_document jsonb,
  sandbox_reclamation_hash text,sandbox_reclamation_receipt jsonb,
  claimed_at timestamptz,completed_at timestamptz,
  primary key(app_id,tenant_id,environment,principal_id,campaign_id,run_ordinal),
  unique(app_id,tenant_id,environment,principal_id,run_id),
  unique(app_id,tenant_id,environment,principal_id,campaign_id,case_id,run_variant,repetition),
  foreign key(app_id,tenant_id,environment,principal_id,campaign_id)
    references app_data_agent.falcon24_acceptance_campaigns(
      app_id,tenant_id,environment,principal_id,campaign_id) on delete restrict,
  check(run_ordinal between 0 and 29 and repetition between 1 and 3
    and run_variant in('COLD','WARM')
    and case_id in('falcon24-business-review-18m','falcon24-delivery-experience-12m',
      'falcon24-inventory-damage-12m','falcon24-marketing-lag-effect',
      'falcon24-cohort-retention-m0-m6')
    and (status<>'PLANNED' or (claimed_at is null and result_hash is null
      and result_document is null))
    and (status='PLANNED' or claimed_at is not null)
    and ((status='VERIFIED')=(trace_closure_hash is not null and result_hash is not null
      and result_document is not null and sandbox_reclamation_hash is not null
      and sandbox_reclamation_receipt is not null and completed_at is not null))
    and (trace_closure_hash is null or trace_closure_hash~'^sha256:[0-9a-f]{64}$')
    and (result_hash is null or result_hash~'^sha256:[0-9a-f]{64}$')
    and (sandbox_reclamation_hash is null
      or sandbox_reclamation_hash~'^sha256:[0-9a-f]{64}$'))
);

alter table app_data_agent.falcon24_acceptance_campaigns enable row level security;
alter table app_data_agent.falcon24_acceptance_campaigns force row level security;
alter table app_data_agent.falcon24_acceptance_campaign_runs enable row level security;
alter table app_data_agent.falcon24_acceptance_campaign_runs force row level security;

create policy falcon24_acceptance_campaign_authority
on app_data_agent.falcon24_acceptance_campaigns for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid)
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid);
create policy falcon24_acceptance_campaign_run_authority
on app_data_agent.falcon24_acceptance_campaign_runs for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid)
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid);

create function app_data_agent.begin_falcon24_acceptance_campaign(command jsonb)
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
    if (select pg_catalog.count(*)
        from app_data_agent.falcon24_acceptance_campaign_runs run
        where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
          and run.environment=authority.environment and run.principal_id=authority.principal_id
          and run.campaign_id=existing.campaign_id)<>30
      or exists(
        select 1
        from pg_catalog.jsonb_array_elements(manifest->'runs') with ordinality entry(item,ordinality)
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
  now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.falcon24_acceptance_campaigns(
    app_id,tenant_id,environment,principal_id,campaign_id,campaign_version,
    source_fingerprint,frozen_contract_hash,runtime_attestation_hash,manifest_hash,policy_id,run_count,
    next_run_ordinal,status,created_at,updated_at)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    manifest->>'campaign_id',(manifest->>'campaign_version')::integer,
    manifest->>'source_fingerprint',manifest->>'frozen_contract_hash',
    manifest->>'runtime_attestation_hash',manifest->>'manifest_hash',
    command->>'policy_id',30,0,'READY',now_at,now_at)
  returning * into strict existing;
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

create function app_data_agent.claim_falcon24_acceptance_run(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
  claimed app_data_agent.falcon24_acceptance_campaign_runs%rowtype; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_ordinal','run_id','case_id','run_variant',
      'repetition','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-acceptance-run-claim@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_ordinal') is distinct from 'number'
    or command->>'run_ordinal'!~'^(0|[1-9][0-9]*)$'
    or (command->>'run_ordinal')::integer not between 0 and 29
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'case_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_variant') is distinct from 'string'
    or command->>'run_variant' not in('COLD','WARM')
    or pg_catalog.jsonb_typeof(command->'repetition') is distinct from 'number'
    or command->>'repetition'!~'^[1-3]$'
  then raise exception using errcode='22023',message='FALCON24_RUN_CLAIM_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;
  if campaign.status='HOLD' then raise exception using errcode='55000',message='FALCON24_CAMPAIGN_HOLD'; end if;
  if campaign.status<>'READY'
    or campaign.next_run_ordinal<>(command->>'run_ordinal')::integer
    or exists(select 1 from app_data_agent.falcon24_acceptance_campaign_runs run
      where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
        and run.environment=authority.environment and run.principal_id=authority.principal_id
        and run.campaign_id=campaign.campaign_id and run.status='CLAIMED')
  then raise exception using errcode='55000',message='FALCON24_RUN_ORDER_OR_STATE_INVALID'; end if;
  select * into claimed from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=campaign.campaign_id
      and run.run_ordinal=(command->>'run_ordinal')::integer for update;
  if not found or claimed.status<>'PLANNED'
    or claimed.run_id is distinct from (command->>'run_id')::uuid
    or claimed.case_id is distinct from command->>'case_id'
    or claimed.run_variant is distinct from command->>'run_variant'
    or claimed.repetition is distinct from (command->>'repetition')::integer
  then raise exception using errcode='55000',message='FALCON24_RUN_SCHEDULE_MISMATCH'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_acceptance_campaign_runs set
    status='CLAIMED',claimed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id and run_ordinal=claimed.run_ordinal
    returning * into strict claimed;
  update app_data_agent.falcon24_acceptance_campaigns set status='RUNNING',updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id;
  return pg_catalog.to_jsonb(claimed);
exception when unique_violation then
  raise exception using errcode='55000',message='FALCON24_RUN_ALREADY_CLAIMED';
when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_RUN_CLAIM_INVALID';
end
$function$;

create function app_data_agent.hold_falcon24_acceptance_campaign(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
  now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','failure_layer','failure_code','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-acceptance-campaign-hold@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'failure_layer') is distinct from 'string'
    or command->>'failure_layer' not in('ROOT_ROUTING','SQL_DATA_PREPARATION',
      'GOVERNED_OPERATOR','ORACLE','PUBLISHER','SANDBOX_RECLAMATION')
    or pg_catalog.jsonb_typeof(command->'failure_code') is distinct from 'string'
    or command->>'failure_code'!~'^[A-Z][A-Z0-9_]{2,127}$'
  then raise exception using errcode='22023',message='FALCON24_CAMPAIGN_HOLD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;
  if campaign.status='PASSED' then raise exception using errcode='55000',message='FALCON24_CAMPAIGN_ALREADY_PASSED'; end if;
  if campaign.status='HOLD' then
    if campaign.first_failure_run_id is distinct from (command->>'run_id')::uuid
      or campaign.first_failure_layer is distinct from command->>'failure_layer'
      or campaign.first_failure_code is distinct from command->>'failure_code'
    then raise exception using errcode='55000',message='FALCON24_CAMPAIGN_HOLD_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(campaign);
  end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_acceptance_campaign_runs set status='HOLD',completed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id and run_id=(command->>'run_id')::uuid
      and status='CLAIMED';
  if not found then raise exception using errcode='55000',message='FALCON24_RUN_NOT_CLAIMED'; end if;
  update app_data_agent.falcon24_acceptance_campaigns set status='HOLD',
    first_failure_run_id=(command->>'run_id')::uuid,
    first_failure_layer=command->>'failure_layer',first_failure_code=command->>'failure_code',
    updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id returning * into strict campaign;
  return pg_catalog.to_jsonb(campaign);
end
$function$;

create function app_data_agent.stage_falcon24_acceptance_result(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
  campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','result_hash','result_document','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-acceptance-result-stage@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'result_hash') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'result_document') is distinct from 'object'
    or command->>'result_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command->'result_document')
    or command#>>'{result_document,run_id}' is distinct from command->>'run_id'
  then raise exception using errcode='22023',message='FALCON24_RESULT_STAGE_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;
  if campaign.status<>'RUNNING' then
    raise exception using errcode='55000',message='FALCON24_CAMPAIGN_NOT_RUNNING'; end if;
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=campaign.campaign_id and run.run_id=(command->>'run_id')::uuid
    for update;
  if not found or campaign_run.status<>'CLAIMED' then
    raise exception using errcode='55000',message='FALCON24_RUN_NOT_CLAIMED'; end if;
  if not exists(select 1 from app_data_agent.runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.run_id=campaign_run.run_id)
  then raise exception using errcode='55000',message='FALCON24_ACTUAL_RUN_REQUIRED'; end if;
  if campaign_run.result_hash is not null then
    if campaign_run.result_hash<>command->>'result_hash'
      or campaign_run.result_document<>command->'result_document'
    then raise exception using errcode='55000',message='FALCON24_RESULT_STAGE_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(campaign_run);
  end if;
  update app_data_agent.falcon24_acceptance_campaign_runs set
    result_hash=command->>'result_hash',result_document=command->'result_document'
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id and run_id=campaign_run.run_id
    returning * into strict campaign_run;
  return pg_catalog.to_jsonb(campaign_run);
end
$function$;

create function app_data_agent.record_falcon24_sandbox_reclamation(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
  campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype; receipt jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','sandbox_reclamation_hash',
      'sandbox_reclamation_receipt','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-sandbox-reclamation-record@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'sandbox_reclamation_hash') is distinct from 'string'
    or command->>'sandbox_reclamation_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'sandbox_reclamation_receipt') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_SANDBOX_RECLAMATION_RECORD_INVALID'; end if;
  receipt:=command->'sandbox_reclamation_receipt';
  if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','campaign_id','run_id','runtime_attestation_hash',
      'management_observation_schema_version','management_operation_id','observation_source',
      'target_metadata_hash','before_observation','killed','after_observation','residual',
      'completed_at','management_observation_hash','receipt_hash']::text[])
      is distinct from true
    or receipt->>'schema_version' is distinct from
      'falcon24-sandbox-reclamation-receipt@2.0.0'
    or receipt->>'campaign_id' is distinct from command->>'campaign_id'
    or receipt->>'run_id' is distinct from command->>'run_id'
    or receipt->>'management_observation_schema_version' is distinct from
      'opensandbox-management-reclamation-observation@1.0.0'
    or pg_catalog.jsonb_typeof(receipt->'management_operation_id') is distinct from 'string'
    or (receipt->>'management_operation_id')::uuid is null
    or receipt->>'observation_source' is distinct from 'OPENSANDBOX_MANAGEMENT_API'
    or pg_catalog.jsonb_typeof(receipt->'target_metadata_hash') is distinct from 'string'
    or receipt->>'target_metadata_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(receipt->'before_observation') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(
      receipt->'before_observation',array['active_count','observation_hash']::text[])
      is distinct from true
    or pg_catalog.jsonb_typeof(receipt#>'{before_observation,active_count}')
      is distinct from 'number'
    or receipt#>>'{before_observation,active_count}'!~'^(0|[1-9][0-9]*)$'
    or pg_catalog.jsonb_typeof(receipt#>'{before_observation,observation_hash}')
      is distinct from 'string'
    or receipt#>>'{before_observation,observation_hash}'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(receipt->'runtime_attestation_hash') is distinct from 'string'
    or receipt->>'runtime_attestation_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(receipt->'killed') is distinct from 'number'
    or receipt->>'killed'!~'^(0|[1-9][0-9]*)$'
    or receipt->>'killed' is distinct from receipt#>>'{before_observation,active_count}'
    or pg_catalog.jsonb_typeof(receipt->'after_observation') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(
      receipt->'after_observation',array['active_count','observation_hash']::text[])
      is distinct from true
    or pg_catalog.jsonb_typeof(receipt#>'{after_observation,active_count}')
      is distinct from 'number'
    or receipt#>>'{after_observation,active_count}' is distinct from '0'
    or pg_catalog.jsonb_typeof(receipt#>'{after_observation,observation_hash}')
      is distinct from 'string'
    or receipt#>>'{after_observation,observation_hash}'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(receipt->'residual') is distinct from 'number'
    or receipt->>'residual' is distinct from '0'
    or pg_catalog.jsonb_typeof(receipt->'completed_at') is distinct from 'string'
    or receipt->>'completed_at'!~
      '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
    or pg_catalog.jsonb_typeof(receipt->'management_observation_hash') is distinct from 'string'
    or receipt->>'management_observation_hash' is distinct from
      app_data_agent.u2_canonical_sha256(receipt-array[
        'schema_version','campaign_id','run_id','runtime_attestation_hash',
        'management_observation_hash','receipt_hash']::text[])
    or pg_catalog.jsonb_typeof(receipt->'receipt_hash') is distinct from 'string'
    or receipt->>'receipt_hash' is distinct from command->>'sandbox_reclamation_hash'
    or receipt->>'receipt_hash' is distinct from
      app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
  then raise exception using errcode='22023',message='FALCON24_SANDBOX_RECLAMATION_RECORD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;
  if campaign.status<>'RUNNING' then
    raise exception using errcode='55000',message='FALCON24_CAMPAIGN_NOT_RUNNING'; end if;
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=campaign.campaign_id and run.run_id=(command->>'run_id')::uuid
    for update;
  if not found or campaign_run.status<>'CLAIMED' then
    raise exception using errcode='55000',message='FALCON24_RUN_NOT_CLAIMED'; end if;
  if not exists(select 1 from app_data_agent.runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.run_id=campaign_run.run_id and run.status='SUCCEEDED')
  then raise exception using errcode='55000',message='FALCON24_ACTUAL_RUN_NOT_SUCCEEDED'; end if;
  if receipt->>'runtime_attestation_hash' is distinct from campaign.runtime_attestation_hash
  then raise exception using errcode='55000',message='FALCON24_SANDBOX_ATTESTATION_MISMATCH'; end if;
  if campaign_run.sandbox_reclamation_hash is not null then
    if campaign_run.sandbox_reclamation_hash<>command->>'sandbox_reclamation_hash'
      or campaign_run.sandbox_reclamation_receipt<>receipt
    then raise exception using errcode='55000',message='FALCON24_SANDBOX_RECLAMATION_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(campaign_run);
  end if;
  update app_data_agent.falcon24_acceptance_campaign_runs set
    sandbox_reclamation_hash=command->>'sandbox_reclamation_hash',
    sandbox_reclamation_receipt=receipt
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id and run_id=campaign_run.run_id and status='CLAIMED'
    returning * into strict campaign_run;
  return pg_catalog.to_jsonb(campaign_run);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_SANDBOX_RECLAMATION_RECORD_INVALID';
end
$function$;

create function app_data_agent.load_falcon24_sandbox_reclamation(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-sandbox-reclamation-load@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
  then raise exception using errcode='22023',message='FALCON24_SANDBOX_RECLAMATION_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=command->>'campaign_id' and run.run_id=(command->>'run_id')::uuid;
  if not found then raise exception using errcode='02000',message='FALCON24_RUN_NOT_FOUND'; end if;
  return campaign_run.sandbox_reclamation_receipt;
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_SANDBOX_RECLAMATION_LOAD_INVALID';
end
$function$;

create function app_data_agent.complete_falcon24_acceptance_run(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
  campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','trace_closure_hash','expected_result_hash',
      'sandbox_reclamation_hash','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-acceptance-run-complete@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'trace_closure_hash') is distinct from 'string'
    or command->>'trace_closure_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'expected_result_hash') is distinct from 'string'
    or command->>'expected_result_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'sandbox_reclamation_hash') is distinct from 'string'
    or command->>'sandbox_reclamation_hash'!~'^sha256:[0-9a-f]{64}$'
  then raise exception using errcode='22023',message='FALCON24_RUN_COMPLETION_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=campaign.campaign_id and run.run_id=(command->>'run_id')::uuid
    for update;
  if not found then raise exception using errcode='55000',message='FALCON24_RUN_NOT_CLAIMED'; end if;
  if campaign_run.status='VERIFIED' then
    if campaign_run.trace_closure_hash<>command->>'trace_closure_hash'
      or campaign_run.result_hash<>command->>'expected_result_hash'
      or campaign_run.sandbox_reclamation_hash<>command->>'sandbox_reclamation_hash'
    then raise exception using errcode='55000',message='FALCON24_RUN_COMPLETION_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(campaign);
  end if;
  if campaign.status<>'RUNNING' then
    raise exception using errcode='55000',message='FALCON24_CAMPAIGN_NOT_RUNNING'; end if;
  if campaign_run.result_hash is null or campaign_run.result_document is null
    or campaign_run.result_hash<>command->>'expected_result_hash'
  then raise exception using errcode='55000',message='FALCON24_RESULT_STAGE_REQUIRED'; end if;
  if campaign_run.sandbox_reclamation_hash is null
    or campaign_run.sandbox_reclamation_receipt is null
    or campaign_run.sandbox_reclamation_hash<>command->>'sandbox_reclamation_hash'
  then raise exception using errcode='55000',message='FALCON24_SANDBOX_RECLAMATION_REQUIRED'; end if;
  if not exists(select 1 from app_data_agent.runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.run_id=campaign_run.run_id and run.status='SUCCEEDED')
  then raise exception using errcode='55000',message='FALCON24_ACTUAL_RUN_NOT_SUCCEEDED'; end if;
  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_acceptance_campaign_runs set status='VERIFIED',
    trace_closure_hash=command->>'trace_closure_hash',
    completed_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id and run_id=(command->>'run_id')::uuid
      and run_ordinal=campaign.next_run_ordinal and status='CLAIMED';
  if not found then raise exception using errcode='55000',message='FALCON24_RUN_NOT_CLAIMED'; end if;
  update app_data_agent.falcon24_acceptance_campaigns set
    next_run_ordinal=next_run_ordinal+1,
    status=case when next_run_ordinal+1=run_count then 'PASSED' else 'READY' end,
    updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and campaign_id=campaign.campaign_id returning * into strict campaign;
  return pg_catalog.to_jsonb(campaign);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_RUN_COMPLETION_INVALID';
end
$function$;

create function app_data_agent.load_falcon24_acceptance_run_result(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; campaign_run app_data_agent.falcon24_acceptance_campaign_runs%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','run_id','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-acceptance-run-result-load@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
  then raise exception using errcode='22023',message='FALCON24_RUN_RESULT_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into campaign_run from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=command->>'campaign_id' and run.run_id=(command->>'run_id')::uuid;
  if not found then raise exception using errcode='02000',message='FALCON24_RUN_NOT_FOUND'; end if;
  if campaign_run.result_document is null then return null; end if;
  return campaign_run.result_document;
exception when invalid_text_representation then
  raise exception using errcode='22023',message='FALCON24_RUN_RESULT_LOAD_INVALID';
end
$function$;

create function app_data_agent.load_falcon24_acceptance_results(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; campaign app_data_agent.falcon24_acceptance_campaigns%rowtype;
  documents jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','campaign_id','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-acceptance-results-load@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'campaign_id') is distinct from 'string'
  then raise exception using errcode='22023',message='FALCON24_RESULTS_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into campaign from app_data_agent.falcon24_acceptance_campaigns row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.campaign_id=command->>'campaign_id';
  if not found then raise exception using errcode='02000',message='FALCON24_CAMPAIGN_NOT_FOUND'; end if;
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(run.result_document order by run.run_ordinal),'[]'::jsonb)
    into strict documents
    from app_data_agent.falcon24_acceptance_campaign_runs run
    where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
      and run.environment=authority.environment and run.principal_id=authority.principal_id
      and run.campaign_id=campaign.campaign_id and run.status='VERIFIED';
  return documents;
end
$function$;

alter table app_data_agent.falcon24_acceptance_campaigns owner to data_agent_u6_rpc_owner;
alter table app_data_agent.falcon24_acceptance_campaign_runs owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_acceptance_campaign(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.claim_falcon24_acceptance_run(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.hold_falcon24_acceptance_campaign(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.stage_falcon24_acceptance_result(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.record_falcon24_sandbox_reclamation(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_sandbox_reclamation(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.complete_falcon24_acceptance_run(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_acceptance_run_result(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_acceptance_results(jsonb)
  owner to data_agent_u6_rpc_owner;
revoke all on table app_data_agent.falcon24_acceptance_campaigns,
  app_data_agent.falcon24_acceptance_campaign_runs from public,data_agent_backend;
revoke all on function app_data_agent.begin_falcon24_acceptance_campaign(jsonb),
  app_data_agent.claim_falcon24_acceptance_run(jsonb),
  app_data_agent.hold_falcon24_acceptance_campaign(jsonb),
  app_data_agent.stage_falcon24_acceptance_result(jsonb),
  app_data_agent.record_falcon24_sandbox_reclamation(jsonb),
  app_data_agent.load_falcon24_sandbox_reclamation(jsonb),
  app_data_agent.complete_falcon24_acceptance_run(jsonb),
  app_data_agent.load_falcon24_acceptance_run_result(jsonb),
  app_data_agent.load_falcon24_acceptance_results(jsonb) from public;
grant execute on function app_data_agent.begin_falcon24_acceptance_campaign(jsonb),
  app_data_agent.claim_falcon24_acceptance_run(jsonb),
  app_data_agent.hold_falcon24_acceptance_campaign(jsonb),
  app_data_agent.stage_falcon24_acceptance_result(jsonb),
  app_data_agent.record_falcon24_sandbox_reclamation(jsonb),
  app_data_agent.load_falcon24_sandbox_reclamation(jsonb),
  app_data_agent.complete_falcon24_acceptance_run(jsonb),
  app_data_agent.load_falcon24_acceptance_run_result(jsonb),
  app_data_agent.load_falcon24_acceptance_results(jsonb) to data_agent_backend;
