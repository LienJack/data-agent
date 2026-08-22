do $patch_run_v3$
declare definition text; repaired text; root_payload_branch text; old_acceptance text; new_acceptance text;
begin
  select pg_catalog.pg_get_functiondef('app_data_agent.command_payload_is_valid(jsonb)'::regprocedure)
    into definition;
  root_payload_branch:=E'  if requested_payload ?& array[''schema_version'',''kind'',''executor_version'',''effective_config_ref'',''catalog_snapshot'',''visible_message_refs'']\n    and (select pg_catalog.count(*)=6 from pg_catalog.jsonb_object_keys(requested_payload))\n    and requested_payload->>''schema_version''=''effective-config-team-lease@3.0.0''\n    and requested_payload->>''kind''=''START_DATA_AGENT_TEAM''\n    and requested_payload->>''executor_version''=''ROOT_HARNESS@1''\n    and pg_catalog.jsonb_typeof(requested_payload->''visible_message_refs'')=''array''\n    and pg_catalog.jsonb_array_length(requested_payload->''visible_message_refs'') between 1 and 64\n    and app_data_agent.subagent_catalog_snapshot_is_valid(requested_payload->''catalog_snapshot'',requested_payload#>>''{catalog_snapshot,run_id}'')\n  then return true; end if;\n';
  repaired:=pg_catalog.replace(definition,
    E'  payload_kind:=requested_payload->>''kind'';',root_payload_branch||E'  payload_kind:=requested_payload->>''kind'';');
  if repaired=definition then
    raise exception using errcode='P0001',message='SUBAGENT_HARNESS_COMMAND_VALIDATOR_DRIFT'; end if;
  execute repaired;

  select pg_catalog.pg_get_functiondef(
    'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure)
    into definition;
  repaired:=pg_catalog.replace(definition,
    E'or (select pg_catalog.count(*) not in (7,9) from pg_catalog.jsonb_object_keys(requested_command))',
    E'or (select pg_catalog.count(*) not in (7,8,9) from pg_catalog.jsonb_object_keys(requested_command))');
  repaired:=pg_catalog.replace(repaired,
    E'''dispatch_admission'',''shadow_dispatch_plan''))',
    E'''dispatch_admission'',''shadow_dispatch_plan'',''subagent_catalog_snapshot''))');
  repaired:=pg_catalog.replace(repaired,
    E'or ((select pg_catalog.count(*)=9 from pg_catalog.jsonb_object_keys(requested_command))',
    E'or ((select pg_catalog.count(*)=8 from pg_catalog.jsonb_object_keys(requested_command))\n      and (not requested_command ? ''subagent_catalog_snapshot''\n        or not app_data_agent.subagent_catalog_snapshot_is_valid(requested_command->''subagent_catalog_snapshot'',requested_config->>''run_id'')))\n    or ((select pg_catalog.count(*)=9 from pg_catalog.jsonb_object_keys(requested_command))');
  old_acceptance:=E'  if requested_command ? ''dispatch_admission'' then\n    perform app_data_agent.commit_agent_dispatch_execute_internal(requested_idempotency_key,requested_command->''dispatch_admission'',requested_command->''shadow_dispatch_plan'');\n    accepted_payload := pg_catalog.jsonb_build_object(\n      ''schema_version'',''effective-config-team-lease@2.0.0'',''kind'',''START_DATA_AGENT_TEAM'',\n      ''executor_version'',requested_command#>>''{dispatch_admission,binding,effective_executor_version}'',\n      ''effective_config_ref'',config_ref,\n      ''profile_refs'',requested_command#>''{dispatch_admission,binding,selected_profile_refs}'',\n      ''dispatch_plan'',requested_command#>''{dispatch_admission,plan}'',\n      ''dispatch_binding'',requested_command#>''{dispatch_admission,binding}'');\n    accepted_command := (requested_command-''dispatch_admission''::text-''shadow_dispatch_plan''::text) || pg_catalog.jsonb_build_object(''payload'',accepted_payload);\n  else\n    accepted_payload := pg_catalog.jsonb_build_object(\n      ''kind'',''START_L2_RESEARCH'',''effective_config_ref'',config_ref);\n    accepted_command := requested_command || pg_catalog.jsonb_build_object(''payload'',accepted_payload);\n  end if;';
  new_acceptance:=E'  if requested_command ? ''subagent_catalog_snapshot'' then\n    perform app_data_agent.commit_subagent_catalog_snapshot_internal(requested_idempotency_key,requested_command->''subagent_catalog_snapshot'');\n    accepted_payload := pg_catalog.jsonb_build_object(\n      ''schema_version'',''effective-config-team-lease@3.0.0'',''kind'',''START_DATA_AGENT_TEAM'',\n      ''executor_version'',''ROOT_HARNESS@1'',''effective_config_ref'',config_ref,\n      ''catalog_snapshot'',requested_command->''subagent_catalog_snapshot'',\n      ''visible_message_refs'',pg_catalog.jsonb_build_array(requested_command->>''event_id''));\n    accepted_command := (requested_command-''subagent_catalog_snapshot''::text) || pg_catalog.jsonb_build_object(''payload'',accepted_payload);\n  elsif requested_command ? ''dispatch_admission'' then\n    perform app_data_agent.commit_agent_dispatch_execute_internal(requested_idempotency_key,requested_command->''dispatch_admission'',requested_command->''shadow_dispatch_plan'');\n    accepted_payload := pg_catalog.jsonb_build_object(\n      ''schema_version'',''effective-config-team-lease@2.0.0'',''kind'',''START_DATA_AGENT_TEAM'',\n      ''executor_version'',requested_command#>>''{dispatch_admission,binding,effective_executor_version}'',\n      ''effective_config_ref'',config_ref,\n      ''profile_refs'',requested_command#>''{dispatch_admission,binding,selected_profile_refs}'',\n      ''dispatch_plan'',requested_command#>''{dispatch_admission,plan}'',\n      ''dispatch_binding'',requested_command#>''{dispatch_admission,binding}'');\n    accepted_command := (requested_command-''dispatch_admission''::text-''shadow_dispatch_plan''::text) || pg_catalog.jsonb_build_object(''payload'',accepted_payload);\n  else\n    accepted_payload := pg_catalog.jsonb_build_object(\n      ''kind'',''START_L2_RESEARCH'',''effective_config_ref'',config_ref);\n    accepted_command := requested_command || pg_catalog.jsonb_build_object(''payload'',accepted_payload);\n  end if;';
  repaired:=pg_catalog.replace(repaired,old_acceptance,new_acceptance);
  if repaired=definition then
    raise exception using errcode='P0001',message='SUBAGENT_HARNESS_ACCEPTANCE_FUNCTION_DRIFT'; end if;
  execute repaired;
end
$patch_run_v3$;
