-- research_artifact_update_grant_migration_checksum: sha256:5ed0ff3240091c65f1e08c0a67e48bac48d400b327ac4a8ea2ef1422b2d07892
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='RESEARCH_ARTIFACT_UPDATE_GRANT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='RESEARCH_ARTIFACT_UPDATE_GRANT_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010734_app_data_agent_research_authority_runtime_hash_grant')
  then raise exception using errcode='P0001',message='RESEARCH_ARTIFACT_UPDATE_GRANT_BASELINE_10734_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);

grant update on table app_data_agent.artifacts to data_agent_u6_rpc_owner;

do $postconditions$
begin
  if not pg_catalog.has_table_privilege(
    'data_agent_u6_rpc_owner',
    'app_data_agent.artifacts',
    'UPDATE'
  ) then
    raise exception using errcode='P0001',message='RESEARCH_ARTIFACT_UPDATE_GRANT_NOT_INSTALLED';
  end if;
end
$postconditions$;

select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010735_app_data_agent_research_artifact_update_grant',
  'sha256:5ed0ff3240091c65f1e08c0a67e48bac48d400b327ac4a8ea2ef1422b2d07892');
commit;
