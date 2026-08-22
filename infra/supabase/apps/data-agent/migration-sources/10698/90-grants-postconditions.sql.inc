alter function app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)
  owner to data_agent_u19_team_owner;
revoke all on function app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)
  from public,data_agent_backend,data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)
  to data_agent_effective_config_rpc_owner;

do $postconditions$
begin
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
      and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010696_app_data_agent_model_driven_subagent_harness'
      and migration_checksum='sha256:8e74cfd247270428117ffed554f6020ba0c752881d19012d3ad64438acecdac2')
    or (select pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc
      where oid='app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)'::regprocedure)
      <>'data_agent_u19_team_owner'
    or not pg_catalog.has_function_privilege('data_agent_effective_config_rpc_owner',
      'app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)','EXECUTE')
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.list_agent_profile_revisions_v2(boolean)'::regprocedure),
      'skill_signer_revocations')=0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.command_payload_is_valid(jsonb)'::regprocedure),
      'visible_message_refs')=0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure),
      'visible_message_refs')=0
  then raise exception using errcode='P0001',message='SUBAGENT_HARNESS_RUNTIME_REPAIR_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
