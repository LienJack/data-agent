do $patch_root_harness_visible_messages$
declare definition text; repaired text; old_payload_branch text; new_payload_branch text;
  old_acceptance text; new_acceptance text;
begin
  select pg_catalog.pg_get_functiondef('app_data_agent.command_payload_is_valid(jsonb)'::regprocedure)
    into definition;
  old_payload_branch:=E'  if requested_payload ?& array[''schema_version'',''kind'',''executor_version'',''effective_config_ref'',''catalog_snapshot'']\n    and (select pg_catalog.count(*)=5 from pg_catalog.jsonb_object_keys(requested_payload))\n    and requested_payload->>''schema_version''=''effective-config-team-lease@3.0.0''\n    and requested_payload->>''kind''=''START_DATA_AGENT_TEAM''\n    and requested_payload->>''executor_version''=''ROOT_HARNESS@1''\n    and app_data_agent.subagent_catalog_snapshot_is_valid(requested_payload->''catalog_snapshot'',requested_payload#>>''{catalog_snapshot,run_id}'')\n  then return true; end if;';
  new_payload_branch:=E'  if requested_payload ?& array[''schema_version'',''kind'',''executor_version'',''effective_config_ref'',''catalog_snapshot'',''visible_message_refs'']\n    and (select pg_catalog.count(*)=6 from pg_catalog.jsonb_object_keys(requested_payload))\n    and requested_payload->>''schema_version''=''effective-config-team-lease@3.0.0''\n    and requested_payload->>''kind''=''START_DATA_AGENT_TEAM''\n    and requested_payload->>''executor_version''=''ROOT_HARNESS@1''\n    and pg_catalog.jsonb_typeof(requested_payload->''visible_message_refs'')=''array''\n    and pg_catalog.jsonb_array_length(requested_payload->''visible_message_refs'') between 1 and 64\n    and app_data_agent.subagent_catalog_snapshot_is_valid(requested_payload->''catalog_snapshot'',requested_payload#>>''{catalog_snapshot,run_id}'')\n  then return true; end if;';
  repaired:=pg_catalog.replace(definition,old_payload_branch,new_payload_branch);
  if repaired=definition then
    raise exception using errcode='P0001',message='SUBAGENT_HARNESS_RUNTIME_REPAIR_COMMAND_DRIFT'; end if;
  execute repaired;

  select pg_catalog.pg_get_functiondef(
    'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure)
    into definition;
  old_acceptance:=E'  if requested_command ? ''subagent_catalog_snapshot'' then\n    perform app_data_agent.commit_subagent_catalog_snapshot_internal(requested_idempotency_key,requested_command->''subagent_catalog_snapshot'');\n    accepted_payload := pg_catalog.jsonb_build_object(\n      ''schema_version'',''effective-config-team-lease@3.0.0'',''kind'',''START_DATA_AGENT_TEAM'',\n      ''executor_version'',''ROOT_HARNESS@1'',''effective_config_ref'',config_ref,\n      ''catalog_snapshot'',requested_command->''subagent_catalog_snapshot'');\n    accepted_command := (requested_command-''subagent_catalog_snapshot''::text) || pg_catalog.jsonb_build_object(''payload'',accepted_payload);';
  new_acceptance:=E'  if requested_command ? ''subagent_catalog_snapshot'' then\n    perform app_data_agent.commit_subagent_catalog_snapshot_internal(requested_idempotency_key,requested_command->''subagent_catalog_snapshot'');\n    accepted_payload := pg_catalog.jsonb_build_object(\n      ''schema_version'',''effective-config-team-lease@3.0.0'',''kind'',''START_DATA_AGENT_TEAM'',\n      ''executor_version'',''ROOT_HARNESS@1'',''effective_config_ref'',config_ref,\n      ''catalog_snapshot'',requested_command->''subagent_catalog_snapshot'',\n      ''visible_message_refs'',pg_catalog.jsonb_build_array(requested_command->>''event_id''));\n    accepted_command := (requested_command-''subagent_catalog_snapshot''::text) || pg_catalog.jsonb_build_object(''payload'',accepted_payload);';
  repaired:=pg_catalog.replace(definition,old_acceptance,new_acceptance);
  if repaired=definition then
    raise exception using errcode='P0001',message='SUBAGENT_HARNESS_RUNTIME_REPAIR_ACCEPTANCE_DRIFT'; end if;
  execute repaired;
end
$patch_root_harness_visible_messages$;
