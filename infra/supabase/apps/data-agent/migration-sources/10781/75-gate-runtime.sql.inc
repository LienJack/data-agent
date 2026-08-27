do $generalize_campaign_identity_validators$
declare function_row record;function_definition text;rewritten_definition text;
  rewritten_count integer:=0;
begin
  for function_row in
    select procedure.oid
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='app_data_agent'
      and procedure.prosrc like '%is distinct from ''E1-C1''%'
  loop
    function_definition:=pg_catalog.pg_get_functiondef(function_row.oid);
    rewritten_definition:=pg_catalog.replace(function_definition,
      $$command->>'campaign_id' is distinct from 'E1-C1'$$,
      $$command->>'campaign_id'!~'^E[1-9][0-9]*-C1$'$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$submit_fence_command->>'campaign_id' is distinct from 'E1-C1'$$,
      $$submit_fence_command->>'campaign_id'!~'^E[1-9][0-9]*-C1$'$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$manifest->>'campaign_id' is distinct from 'E1-C1'$$,
      $$manifest->>'campaign_id'!~'^E[1-9][0-9]*-C1$'$$);
    if rewritten_definition=function_definition then
      raise exception using errcode='P0001',
        message='FALCON24_CAMPAIGN_VALIDATOR_REWRITE_MISSED'; end if;
    execute rewritten_definition;rewritten_count:=rewritten_count+1;
  end loop;
  if rewritten_count<>13 then raise exception using errcode='P0001',
    message='FALCON24_CAMPAIGN_VALIDATOR_INVENTORY_DRIFT',
    detail=pg_catalog.jsonb_build_object('observed',rewritten_count)::text; end if;
end
$generalize_campaign_identity_validators$;

do $generalize_gate_receipt_validators$
declare signature regprocedure;function_definition text;rewritten_definition text;
begin
  foreach signature in array array[
    'app_data_agent.stage_falcon24_acceptance_trace(jsonb)'::regprocedure,
    'app_data_agent.stage_falcon24_acceptance_ui_trace(jsonb)'::regprocedure,
    'app_data_agent.record_falcon24_sandbox_reclamation(jsonb)'::regprocedure,
    'app_data_agent.stage_falcon24_qualification_trace(jsonb)'::regprocedure,
    'app_data_agent.stage_falcon24_qualification_ui_trace(jsonb)'::regprocedure
  ]::regprocedure[] loop
    function_definition:=pg_catalog.pg_get_functiondef(signature);
    rewritten_definition:=pg_catalog.replace(function_definition,
      $$provider_json_object_has_exact_keys(receipt,array[
      'schema_version','campaign_id'$$,
      $$provider_json_object_has_exact_keys(receipt,array[
      'schema_version','authority_epoch','campaign_id'$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      'falcon24-resolution-trace-gate-receipt@2.0.0',
      'falcon24-resolution-trace-gate-receipt@3.0.0');
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      'falcon24-resolution-trace-ui-gate-receipt@1.0.0',
      'falcon24-resolution-trace-ui-gate-receipt@2.0.0');
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      'falcon24-sandbox-reclamation-receipt@2.0.0',
      'falcon24-sandbox-reclamation-receipt@3.0.0');
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$or receipt->>'campaign_id' is distinct from command->>'campaign_id'$$,
      $$or receipt->>'campaign_id' is distinct from command->>'campaign_id'
    or receipt->>'authority_epoch' is distinct from
      pg_catalog.split_part(command->>'campaign_id','-',1)$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$or receipt->>'campaign_id' is distinct from command->>'qualification_id'$$,
      $$or receipt->>'campaign_id' is distinct from command->>'qualification_id'
    or receipt->>'authority_epoch' is distinct from
      pg_catalog.split_part(command->>'qualification_id','-',1)$$);
    rewritten_definition:=pg_catalog.replace(rewritten_definition,
      $$'schema_version','campaign_id','run_id','runtime_attestation_hash',
        'management_observation_hash','receipt_hash'$$,
      $$'schema_version','authority_epoch','campaign_id','run_id','runtime_attestation_hash',
        'management_observation_hash','receipt_hash'$$);
    if rewritten_definition=function_definition then
      raise exception using errcode='P0001',
        message='FALCON24_GATE_RECEIPT_VALIDATOR_REWRITE_MISSED'; end if;
    execute rewritten_definition;
  end loop;
end
$generalize_gate_receipt_validators$;

create or replace function app_data_agent.falcon24_qualification_reclamation_receipt_valid(
  receipt jsonb,qualification_id text,requested_run_id uuid,
  runtime_attestation_hash text,expected_receipt_hash text)
returns boolean language plpgsql immutable security definer set search_path='' as $function$
declare authority_epoch text:=pg_catalog.split_part(qualification_id,'-',1);
begin
  return receipt is not null and pg_catalog.jsonb_typeof(receipt)='object'
    and authority_epoch<>'E1'
    and app_data_agent.falcon24_authority_epoch_is_canonical(authority_epoch)
    and app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','authority_epoch','campaign_id','run_id','runtime_attestation_hash',
      'management_observation_schema_version','management_operation_id','observation_source',
      'target_metadata_hash','before_observation','killed','after_observation','residual',
      'completed_at','management_observation_hash','receipt_hash']::text[]) is true
    and receipt->>'schema_version'='falcon24-sandbox-reclamation-receipt@3.0.0'
    and receipt->>'authority_epoch'=authority_epoch
    and receipt->>'campaign_id'=qualification_id
    and receipt->>'run_id'=requested_run_id::text
    and receipt->>'runtime_attestation_hash'=runtime_attestation_hash
    and receipt->>'management_observation_schema_version'=
      'opensandbox-management-reclamation-observation@1.0.0'
    and pg_catalog.jsonb_typeof(receipt->'management_operation_id')='string'
    and (receipt->>'management_operation_id')::uuid is not null
    and receipt->>'observation_source'='OPENSANDBOX_MANAGEMENT_API'
    and receipt->>'target_metadata_hash'~'^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(receipt->'before_observation')='object'
    and app_data_agent.provider_json_object_has_exact_keys(
      receipt->'before_observation',array['active_count','observation_hash']::text[]) is true
    and receipt#>>'{before_observation,active_count}'~'^(0|[1-9][0-9]*)$'
    and receipt#>>'{before_observation,observation_hash}'~'^sha256:[0-9a-f]{64}$'
    and receipt->>'killed'=receipt#>>'{before_observation,active_count}'
    and pg_catalog.jsonb_typeof(receipt->'after_observation')='object'
    and app_data_agent.provider_json_object_has_exact_keys(
      receipt->'after_observation',array['active_count','observation_hash']::text[]) is true
    and receipt#>>'{after_observation,active_count}'='0'
    and receipt#>>'{after_observation,observation_hash}'~'^sha256:[0-9a-f]{64}$'
    and receipt->>'residual'='0'
    and (receipt->>'completed_at')::timestamptz is not null
    and receipt->>'management_observation_hash'=
      app_data_agent.u2_canonical_sha256(receipt-array[
        'schema_version','authority_epoch','campaign_id','run_id','runtime_attestation_hash',
        'management_observation_hash','receipt_hash']::text[])
    and receipt->>'receipt_hash'=expected_receipt_hash
    and receipt->>'receipt_hash'=app_data_agent.u2_canonical_sha256(receipt-'receipt_hash');
exception when invalid_text_representation or numeric_value_out_of_range
  or invalid_datetime_format or datetime_field_overflow then return false;
end
$function$;

create function app_data_agent.falcon24_gate_current_authority_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
begin
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
  where row.app_id=old.app_id and row.tenant_id=old.tenant_id
    and row.environment=old.environment for share;
  if not found or old.authority_epoch<>current_epoch.authority_epoch
    or old.authority_baseline_id<>current_epoch.baseline_id
    or old.authority_baseline_hash<>current_epoch.baseline_hash
    or old.authority_activation_attempt_id<>current_epoch.activation_attempt_id
  then raise exception using errcode='55000',message='FALCON24_GATE_EPOCH_MISMATCH'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_qualification_slot_attempt_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare expected_attempt_id uuid;parent record;current_epoch record;
begin
  select qualification.attempt_id,qualification.authority_epoch,
    qualification.authority_baseline_id,qualification.authority_baseline_hash,
    qualification.authority_activation_attempt_id into parent
  from app_data_agent.falcon24_qualifications qualification
  where qualification.app_id=new.app_id and qualification.tenant_id=new.tenant_id
    and qualification.environment=new.environment and qualification.principal_id=new.principal_id
    and qualification.qualification_id=new.qualification_id;
  select row.authority_epoch,row.baseline_id,row.baseline_hash,row.activation_attempt_id
    into current_epoch from app_data_agent.falcon24_current_authority_epoch row
  where row.app_id=new.app_id and row.tenant_id=new.tenant_id
    and row.environment=new.environment;
  if new.authority_epoch is distinct from old.authority_epoch
    or parent.authority_epoch is distinct from new.authority_epoch
    or current_epoch.authority_epoch is distinct from parent.authority_epoch
    or current_epoch.baseline_id is distinct from parent.authority_baseline_id
    or current_epoch.baseline_hash is distinct from parent.authority_baseline_hash
    or current_epoch.activation_attempt_id is distinct from parent.authority_activation_attempt_id
  then raise exception using errcode='55000',message='FALCON24_GATE_EPOCH_MISMATCH'; end if;
  if old.claim_fence_consumed_at is null and new.claim_fence_consumed_at is not null then
    begin expected_attempt_id:=pg_catalog.current_setting(
      'data_agent.falcon24_gate_attempt_id',true)::uuid;
    exception when invalid_text_representation then
      raise exception using errcode='22023',message='FALCON24_GATE_ATTEMPT_FENCE_INVALID'; end;
    if expected_attempt_id is null or expected_attempt_id is distinct from parent.attempt_id
    then raise exception using errcode='55000',message='FALCON24_GATE_ATTEMPT_MISMATCH'; end if;
  end if;
  if old.status<>'VERIFIED' and new.status='VERIFIED' and not exists(
    select 1 from app_data_agent.falcon24_ui_receipts qa_receipt
    join app_data_agent.falcon24_ui_receipts trace_receipt
      on trace_receipt.app_id=qa_receipt.app_id and trace_receipt.tenant_id=qa_receipt.tenant_id
      and trace_receipt.environment=qa_receipt.environment and trace_receipt.run_id=qa_receipt.run_id
      and trace_receipt.viewport_width=qa_receipt.viewport_width
      and trace_receipt.receipt_kind='TRACE_UI'
      and trace_receipt.authority_epoch=qa_receipt.authority_epoch
      and trace_receipt.baseline_id=qa_receipt.baseline_id
      and trace_receipt.baseline_hash=qa_receipt.baseline_hash
      and trace_receipt.activation_attempt_id=qa_receipt.activation_attempt_id
    where qa_receipt.app_id=new.app_id and qa_receipt.tenant_id=new.tenant_id
      and qa_receipt.environment=new.environment and qa_receipt.run_id=new.run_id
      and qa_receipt.receipt_kind='QA_E2E' and qa_receipt.authority_epoch=parent.authority_epoch
      and qa_receipt.baseline_id=parent.authority_baseline_id
      and qa_receipt.baseline_hash=parent.authority_baseline_hash
      and qa_receipt.activation_attempt_id=parent.authority_activation_attempt_id)
  then raise exception using errcode='55000',message='FALCON24_UI_RECEIPT_PAIR_REQUIRED'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_campaign_run_attempt_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare expected_attempt_id uuid;parent record;current_epoch record;
begin
  select campaign.attempt_id,campaign.authority_epoch,campaign.authority_baseline_id,
    campaign.authority_baseline_hash,campaign.authority_activation_attempt_id into parent
  from app_data_agent.falcon24_acceptance_campaigns campaign
  where campaign.app_id=new.app_id and campaign.tenant_id=new.tenant_id
    and campaign.environment=new.environment and campaign.principal_id=new.principal_id
    and campaign.campaign_id=new.campaign_id;
  select row.authority_epoch,row.baseline_id,row.baseline_hash,row.activation_attempt_id
    into current_epoch from app_data_agent.falcon24_current_authority_epoch row
  where row.app_id=new.app_id and row.tenant_id=new.tenant_id and row.environment=new.environment;
  if new.authority_epoch is distinct from old.authority_epoch
    or parent.authority_epoch is distinct from new.authority_epoch
    or current_epoch.authority_epoch is distinct from parent.authority_epoch
    or current_epoch.baseline_id is distinct from parent.authority_baseline_id
    or current_epoch.baseline_hash is distinct from parent.authority_baseline_hash
    or current_epoch.activation_attempt_id is distinct from parent.authority_activation_attempt_id
  then raise exception using errcode='55000',message='FALCON24_GATE_EPOCH_MISMATCH'; end if;
  if old.claim_fence_consumed_at is null and new.claim_fence_consumed_at is not null then
    begin expected_attempt_id:=pg_catalog.current_setting(
      'data_agent.falcon24_gate_attempt_id',true)::uuid;
    exception when invalid_text_representation then
      raise exception using errcode='22023',message='FALCON24_GATE_ATTEMPT_FENCE_INVALID'; end;
    if expected_attempt_id is null or expected_attempt_id is distinct from parent.attempt_id
    then raise exception using errcode='55000',message='FALCON24_GATE_ATTEMPT_MISMATCH'; end if;
  end if;
  if old.status<>'VERIFIED' and new.status='VERIFIED' and not exists(
    select 1 from app_data_agent.falcon24_ui_receipts qa_receipt
    join app_data_agent.falcon24_ui_receipts trace_receipt
      on trace_receipt.app_id=qa_receipt.app_id and trace_receipt.tenant_id=qa_receipt.tenant_id
      and trace_receipt.environment=qa_receipt.environment and trace_receipt.run_id=qa_receipt.run_id
      and trace_receipt.viewport_width=qa_receipt.viewport_width
      and trace_receipt.receipt_kind='TRACE_UI'
      and trace_receipt.authority_epoch=qa_receipt.authority_epoch
      and trace_receipt.baseline_id=qa_receipt.baseline_id
      and trace_receipt.baseline_hash=qa_receipt.baseline_hash
      and trace_receipt.activation_attempt_id=qa_receipt.activation_attempt_id
    where qa_receipt.app_id=new.app_id and qa_receipt.tenant_id=new.tenant_id
      and qa_receipt.environment=new.environment and qa_receipt.run_id=new.run_id
      and qa_receipt.receipt_kind='QA_E2E' and qa_receipt.authority_epoch=parent.authority_epoch
      and qa_receipt.baseline_id=parent.authority_baseline_id
      and qa_receipt.baseline_hash=parent.authority_baseline_hash
      and qa_receipt.activation_attempt_id=parent.authority_activation_attempt_id)
  then raise exception using errcode='55000',message='FALCON24_UI_RECEIPT_PAIR_REQUIRED'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_gate_attempt_history_immutable()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  raise exception using errcode='55000',message='FALCON24_GATE_ATTEMPT_IMMUTABLE';
end
$function$;

drop trigger falcon24_e1_gate_attempt_history_immutable
  on app_data_agent.falcon24_gate_attempt_history;

create trigger falcon24_000_qualification_slot_attempt_fence
before update on app_data_agent.falcon24_qualification_slots
for each row execute function app_data_agent.falcon24_qualification_slot_attempt_fence();
create trigger falcon24_000_campaign_run_attempt_fence
before update on app_data_agent.falcon24_acceptance_campaign_runs
for each row execute function app_data_agent.falcon24_campaign_run_attempt_fence();
create trigger falcon24_000_qualification_current_authority_fence
before update on app_data_agent.falcon24_qualifications
for each row execute function app_data_agent.falcon24_gate_current_authority_fence();
create trigger falcon24_000_campaign_current_authority_fence
before update on app_data_agent.falcon24_acceptance_campaigns
for each row execute function app_data_agent.falcon24_gate_current_authority_fence();
create trigger falcon24_gate_attempt_history_immutable
before update or delete on app_data_agent.falcon24_gate_attempt_history
for each row execute function app_data_agent.falcon24_gate_attempt_history_immutable();
