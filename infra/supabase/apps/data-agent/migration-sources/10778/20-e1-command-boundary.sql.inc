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
