-- e1_legacy_runtime_retirement_migration_checksum: sha256:b78f8006ef29b0961802852a9bf0cdfd1477bca15053ea5a427f2f3ccff23f5c
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);
do $retirement_preflight$
begin
  if pg_catalog.to_regclass('app_data_agent.agent_dispatch_rollout_policies') is null
    or pg_catalog.to_regclass('app_data_agent.agent_dispatch_deferred_receipts') is null
    or pg_catalog.to_regclass('app_data_agent.agent_dispatch_execute_receipts') is null
  then
    raise exception using errcode='P0001',
      message='E1_LEGACY_RUNTIME_RETIREMENT_SOURCE_DRIFT';
  end if;

  if exists(select 1 from app_data_agent.agent_dispatch_rollout_policies)
    or exists(select 1 from app_data_agent.agent_dispatch_deferred_receipts)
    or exists(select 1 from app_data_agent.agent_dispatch_execute_receipts)
  then
    raise exception using errcode='55000',
      message='E1_LEGACY_RUNTIME_RETIREMENT_REQUIRES_FRESH_DATABASE';
  end if;
end
$retirement_preflight$;
do $patch_e1_command_boundary$
declare
  definition text;
  repaired text;
  adaptive_payload_branch text;
  adaptive_acceptance_branch text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.command_payload_is_valid(jsonb)'::regprocedure)
    into definition;
  adaptive_payload_branch:=E'  if requested_payload ?& array[''schema_version'',''kind'',''executor_version'',''effective_config_ref'',''profile_refs'',''dispatch_plan'',''dispatch_binding'']\n    and (select pg_catalog.count(*)=7 from pg_catalog.jsonb_object_keys(requested_payload))\n    and requested_payload->>''schema_version''=''effective-config-team-lease@2.0.0''\n    and requested_payload->>''kind''=''START_DATA_AGENT_TEAM''\n    and requested_payload->>''executor_version''=requested_payload#>>''{dispatch_binding,effective_executor_version}''\n    and requested_payload->''profile_refs''=requested_payload#>''{dispatch_binding,selected_profile_refs}''\n    and app_data_agent.agent_dispatch_binding_is_valid(requested_payload->''dispatch_plan'',requested_payload->''dispatch_binding'',requested_payload#>>''{dispatch_binding,run_id}'')\n  then return true; end if;\n';
  repaired:=pg_catalog.replace(definition,adaptive_payload_branch,'');
  if repaired=definition then
    raise exception using errcode='P0001',
      message='E1_COMMAND_PAYLOAD_RETIREMENT_DRIFT';
  end if;
  execute repaired;

  select pg_catalog.pg_get_functiondef(
    'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure)
    into definition;
  repaired:=pg_catalog.replace(definition,
    E'or (select pg_catalog.count(*) not in (7,8,9) from pg_catalog.jsonb_object_keys(requested_command))',
    E'or (select pg_catalog.count(*) not in (7,8) from pg_catalog.jsonb_object_keys(requested_command))');
  repaired:=pg_catalog.replace(repaired,
    E'''dispatch_admission'',''shadow_dispatch_plan'',''subagent_catalog_snapshot''))',
    E'''subagent_catalog_snapshot''))');
  repaired:=pg_catalog.replace(repaired,
    E'    or ((select pg_catalog.count(*)=9 from pg_catalog.jsonb_object_keys(requested_command))\n      and (not requested_command ?& array[''dispatch_admission'',''shadow_dispatch_plan'']\n        or not app_data_agent.agent_dispatch_execute_receipt_is_valid(requested_command->''dispatch_admission'',requested_command->''shadow_dispatch_plan'',requested_config->>''run_id'')))\n',
    '');
  adaptive_acceptance_branch:=E'  elsif requested_command ? ''dispatch_admission'' then\n    perform app_data_agent.commit_agent_dispatch_execute_internal(requested_idempotency_key,requested_command->''dispatch_admission'',requested_command->''shadow_dispatch_plan'');\n    accepted_payload := pg_catalog.jsonb_build_object(\n      ''schema_version'',''effective-config-team-lease@2.0.0'',''kind'',''START_DATA_AGENT_TEAM'',\n      ''executor_version'',requested_command#>>''{dispatch_admission,binding,effective_executor_version}'',\n      ''effective_config_ref'',config_ref,\n      ''profile_refs'',requested_command#>''{dispatch_admission,binding,selected_profile_refs}'',\n      ''dispatch_plan'',requested_command#>''{dispatch_admission,plan}'',\n      ''dispatch_binding'',requested_command#>''{dispatch_admission,binding}'');\n    accepted_command := (requested_command-''dispatch_admission''::text-''shadow_dispatch_plan''::text) || pg_catalog.jsonb_build_object(''payload'',accepted_payload);\n';
  repaired:=pg_catalog.replace(repaired,adaptive_acceptance_branch,'');
  if repaired=definition
    or pg_catalog.strpos(repaired,'dispatch_admission')>0
    or pg_catalog.strpos(repaired,'shadow_dispatch_plan')>0
    or pg_catalog.strpos(repaired,'commit_agent_dispatch')>0
  then
    raise exception using errcode='P0001',
      message='E1_QUESTION_ACCEPTANCE_RETIREMENT_DRIFT';
  end if;
  execute repaired;
end
$patch_e1_command_boundary$;
do $patch_session_recovery_semantic_helper$
declare
  definition text;
  repaired text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.reply_run_interruption(jsonb)'::regprocedure)
    into definition;
  repaired:=pg_catalog.replace(
    definition,
    'app_data_agent.resolved_context_uuid_v8_from_hash',
    'app_data_agent.semantic_context_uuid_v8_from_hash');
  if repaired=definition then
    raise exception using errcode='P0001',
      message='E1_SESSION_RECOVERY_SEMANTIC_HELPER_DRIFT';
  end if;
  execute repaired;
end
$patch_session_recovery_semantic_helper$;
drop function app_data_agent.commit_agent_dispatch_execute_internal(text,jsonb,jsonb);
drop function app_data_agent.commit_agent_dispatch_deferred(text,text,jsonb);
drop function app_data_agent.set_agent_dispatch_rollout_policy(text,bigint);
drop function app_data_agent.resolve_agent_dispatch_rollout_policy(text);
drop function app_data_agent.agent_dispatch_execute_receipt_is_valid(jsonb,jsonb,text);
drop function app_data_agent.agent_dispatch_binding_is_valid(jsonb,jsonb,text);
drop function app_data_agent.agent_dispatch_plan_is_valid(jsonb,text);
drop function app_data_agent.agent_dispatch_direct_receipt_is_valid(jsonb,text,text);
drop function app_data_agent.agent_dispatch_plan_ref_is_valid(jsonb);
drop function app_data_agent.agent_dispatch_profile_refs_are_canonical(jsonb);

drop table app_data_agent.agent_dispatch_execute_receipts;
drop table app_data_agent.agent_dispatch_deferred_receipts;
drop table app_data_agent.agent_dispatch_rollout_policies;
do $postconditions$
declare
  command_definition text;
  acceptance_definition text;
  interruption_reply_definition text;
begin
  if pg_catalog.to_regclass('app_data_agent.agent_dispatch_rollout_policies') is not null
    or pg_catalog.to_regclass('app_data_agent.agent_dispatch_deferred_receipts') is not null
    or pg_catalog.to_regclass('app_data_agent.agent_dispatch_execute_receipts') is not null
    or pg_catalog.to_regprocedure('app_data_agent.resolve_agent_dispatch_rollout_policy(text)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.set_agent_dispatch_rollout_policy(text,bigint)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.commit_agent_dispatch_deferred(text,text,jsonb)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.commit_agent_dispatch_execute_internal(text,jsonb,jsonb)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.agent_dispatch_profile_refs_are_canonical(jsonb)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.agent_dispatch_plan_ref_is_valid(jsonb)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.agent_dispatch_direct_receipt_is_valid(jsonb,text,text)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.agent_dispatch_plan_is_valid(jsonb,text)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.agent_dispatch_binding_is_valid(jsonb,jsonb,text)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.agent_dispatch_execute_receipt_is_valid(jsonb,jsonb,text)') is not null
  then
    raise exception using errcode='P0001',
      message='E1_LEGACY_RUNTIME_RETIREMENT_INCOMPLETE';
  end if;

  select pg_catalog.pg_get_functiondef(
    'app_data_agent.command_payload_is_valid(jsonb)'::regprocedure)
    into command_definition;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure)
    into acceptance_definition;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.reply_run_interruption(jsonb)'::regprocedure)
    into interruption_reply_definition;
  if pg_catalog.strpos(command_definition,'subagent_catalog_snapshot_is_valid')=0
    or pg_catalog.strpos(command_definition,'agent_dispatch')>0
    or pg_catalog.strpos(command_definition,'effective-config-team-lease@2.0.0')>0
    or pg_catalog.strpos(acceptance_definition,'commit_subagent_catalog_snapshot_internal')=0
    or pg_catalog.strpos(acceptance_definition,'effective-config-team-lease@3.0.0')=0
    or pg_catalog.strpos(acceptance_definition,'dispatch_admission')>0
    or pg_catalog.strpos(acceptance_definition,'shadow_dispatch_plan')>0
    or pg_catalog.strpos(acceptance_definition,'commit_agent_dispatch')>0
    or pg_catalog.strpos(interruption_reply_definition,'semantic_context_uuid_v8_from_hash')=0
    or pg_catalog.strpos(interruption_reply_definition,'resolved_context_uuid_v8_from_hash')>0
  then
    raise exception using errcode='P0001',
      message='E1_COMMAND_BOUNDARY_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010778_app_data_agent_e1_legacy_runtime_retirement',
  'sha256:b78f8006ef29b0961802852a9bf0cdfd1477bca15053ea5a427f2f3ccff23f5c');
commit;
