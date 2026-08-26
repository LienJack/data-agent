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
