-- analysis_python_hash_grant_migration_checksum: sha256:8d4279eccb02848cecb2f013ac97cc9f00cd10ce4435733bb29946e2924589c9
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='ANALYSIS_PYTHON_HASH_GRANT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='ANALYSIS_PYTHON_HASH_GRANT_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010740_app_data_agent_direct_agent_tool_event_scope')
  then raise exception using errcode='P0001',message='ANALYSIS_PYTHON_HASH_GRANT_BASELINE_10740_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);

grant execute on function app_data_agent.u2_canonical_sha256(jsonb)
to data_agent_u6_rpc_owner;

do $postconditions$
begin
  if not pg_catalog.has_function_privilege(
    'data_agent_u6_rpc_owner',
    'app_data_agent.u2_canonical_sha256(jsonb)',
    'EXECUTE'
  ) then
    raise exception using errcode='P0001',message='ANALYSIS_PYTHON_HASH_GRANT_NOT_INSTALLED';
  end if;
end
$postconditions$;

select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010741_app_data_agent_analysis_python_hash_grant',
  'sha256:8d4279eccb02848cecb2f013ac97cc9f00cd10ce4435733bb29946e2924589c9');
commit;
