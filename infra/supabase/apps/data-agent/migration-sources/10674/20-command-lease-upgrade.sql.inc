do $patch_functions$
declare definition text; repaired text; adaptive_branch text;
begin
  select pg_catalog.pg_get_functiondef('app_data_agent.command_payload_is_valid(jsonb)'::regprocedure)
    into definition;
  adaptive_branch:=E'  if requested_payload ?& array[''schema_version'',''kind'',''executor_version'',''effective_config_ref'',''profile_refs'',''dispatch_plan'',''dispatch_binding'']\n    and (select pg_catalog.count(*)=7 from pg_catalog.jsonb_object_keys(requested_payload))\n    and requested_payload->>''schema_version''=''effective-config-team-lease@2.0.0''\n    and requested_payload->>''kind''=''START_DATA_AGENT_TEAM''\n    and requested_payload->>''executor_version''=requested_payload#>>''{dispatch_binding,effective_executor_version}''\n    and requested_payload->''profile_refs''=requested_payload#>''{dispatch_binding,selected_profile_refs}''\n    and app_data_agent.agent_dispatch_binding_is_valid(requested_payload->''dispatch_plan'',requested_payload->''dispatch_binding'',requested_payload#>>''{dispatch_binding,run_id}'')\n  then return true; end if;\n';
  repaired:=pg_catalog.replace(definition,
    E'  payload_kind:=requested_payload->>''kind'';',adaptive_branch||E'  payload_kind:=requested_payload->>''kind'';');
  if repaired=definition then raise exception using errcode='P0001',message='AGENT_DISPATCH_COMMAND_VALIDATOR_DRIFT'; end if;
  execute repaired;

  select pg_catalog.pg_get_functiondef(
    'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure)
    into definition;
  repaired:=pg_catalog.replace(definition,
    E'or (select pg_catalog.count(*) <> 7 from pg_catalog.jsonb_object_keys(requested_command))',
    E'or (select pg_catalog.count(*) not in (7,9) from pg_catalog.jsonb_object_keys(requested_command))');
  repaired:=pg_catalog.replace(repaired,
    E'where key.name not in (''run_id'',''command_id'',''event_id'',''outbox_id'',''audit_id'',''idempotency_key'',''question''))',
    E'where key.name not in (''run_id'',''command_id'',''event_id'',''outbox_id'',''audit_id'',''idempotency_key'',''question'',''dispatch_admission'',''shadow_dispatch_plan''))');
  repaired:=pg_catalog.replace(repaired,
    E'or requested_command ? ''payload''',
    E'or requested_command ? ''payload''\n    or ((select pg_catalog.count(*)=9 from pg_catalog.jsonb_object_keys(requested_command))\n      and (not requested_command ?& array[''dispatch_admission'',''shadow_dispatch_plan'']\n        or not app_data_agent.agent_dispatch_execute_receipt_is_valid(requested_command->''dispatch_admission'',requested_command->''shadow_dispatch_plan'',requested_config->>''run_id'')))');
  repaired:=pg_catalog.replace(repaired,
    E'  accepted_payload := pg_catalog.jsonb_build_object(\n    ''kind'',''START_L2_RESEARCH'',''effective_config_ref'',config_ref);\n  accepted_payload_hash := platform.canonical_sha256(accepted_payload);\n  accepted_command := requested_command || pg_catalog.jsonb_build_object(''payload'',accepted_payload);',
    E'  if requested_command ? ''dispatch_admission'' then\n    perform app_data_agent.commit_agent_dispatch_execute_internal(requested_idempotency_key,requested_command->''dispatch_admission'',requested_command->''shadow_dispatch_plan'');\n    accepted_payload := pg_catalog.jsonb_build_object(\n      ''schema_version'',''effective-config-team-lease@2.0.0'',''kind'',''START_DATA_AGENT_TEAM'',\n      ''executor_version'',requested_command#>>''{dispatch_admission,binding,effective_executor_version}'',\n      ''effective_config_ref'',config_ref,\n      ''profile_refs'',requested_command#>''{dispatch_admission,binding,selected_profile_refs}'',\n      ''dispatch_plan'',requested_command#>''{dispatch_admission,plan}'',\n      ''dispatch_binding'',requested_command#>''{dispatch_admission,binding}'');\n    accepted_command := (requested_command-''dispatch_admission''::text-''shadow_dispatch_plan''::text) || pg_catalog.jsonb_build_object(''payload'',accepted_payload);\n  else\n    accepted_payload := pg_catalog.jsonb_build_object(\n      ''kind'',''START_L2_RESEARCH'',''effective_config_ref'',config_ref);\n    accepted_command := requested_command || pg_catalog.jsonb_build_object(''payload'',accepted_payload);\n  end if;\n  accepted_payload_hash := platform.canonical_sha256(accepted_payload);');
  if repaired=definition then raise exception using errcode='P0001',message='AGENT_DISPATCH_ACCEPTANCE_FUNCTION_DRIFT'; end if;
  execute repaired;
end
$patch_functions$;
