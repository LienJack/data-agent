-- provider_task_validator_grant_repair_migration_checksum: sha256:4c38e37bb403a2dbe02494fd7b9919f5dbd773b8a341b0e8c1c3855702b8b16f
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using
      errcode = '0A000',
      message = 'PROVIDER_TASK_VALIDATOR_GRANT_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'PROVIDER_TASK_VALIDATOR_GRANT_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1
    from platform.migration_ledger
    where owner_kind = 'app'
      and app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version = '20260725010699_app_data_agent_analysis_artifact_authority'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'PROVIDER_TASK_VALIDATOR_GRANT_REPAIR_BASELINE_10699_MISSING';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);

grant execute on function app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)
to data_agent_provider_invocation_rpc_owner;

do $postconditions$
begin
  if (
      select pg_catalog.pg_get_userbyid(proowner)
      from pg_catalog.pg_proc
      where oid = 'app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)'::regprocedure
    ) <> 'data_agent_u19_team_owner'
    or not pg_catalog.has_function_privilege('data_agent_provider_invocation_rpc_owner',
      'app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)', 'EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_effective_config_rpc_owner',
      'app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)', 'EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)', 'EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)', 'EXECUTE')
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.command_payload_is_valid(jsonb)'::regprocedure),
      'app_data_agent.subagent_catalog_snapshot_is_valid') = 0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.assert_provider_active_worker_lease(jsonb)'::regprocedure),
      'app_data_agent.command_payload_is_valid') = 0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.commit_provider_task_artifact(jsonb,jsonb)'::regprocedure),
      'app_data_agent.assert_provider_active_worker_lease') = 0
  then
    raise exception using
      errcode = 'P0001',
      message = 'PROVIDER_TASK_VALIDATOR_GRANT_REPAIR_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010700_app_data_agent_provider_task_validator_grant_repair',
  'sha256:4c38e37bb403a2dbe02494fd7b9919f5dbd773b8a341b0e8c1c3855702b8b16f'
);

commit;
