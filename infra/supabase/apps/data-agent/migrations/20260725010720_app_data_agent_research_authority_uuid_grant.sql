-- research_authority_uuid_grant_migration_checksum: sha256:335d3b6bb46278849cb018b0cd286be93a7f9dea549da8e33e5a69480addec72
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='RESEARCH_AUTHORITY_UUID_GRANT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='RESEARCH_AUTHORITY_UUID_GRANT_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010719_app_data_agent_research_authority_epoch_repair')
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_UUID_GRANT_BASELINE_10719_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
grant execute on function app_data_agent.u6_uuid_v5(uuid,bytea)
to data_agent_u6_provisioner_owner;
do $postconditions$
begin
  if not pg_catalog.has_function_privilege(
    'data_agent_u6_provisioner_owner','app_data_agent.u6_uuid_v5(uuid,bytea)','EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_u6_provisioner','app_data_agent.u6_uuid_v5(uuid,bytea)','EXECUTE'
  ) then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_UUID_GRANT_NOT_INSTALLED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010720_app_data_agent_research_authority_uuid_grant',
  'sha256:335d3b6bb46278849cb018b0cd286be93a7f9dea549da8e33e5a69480addec72');
commit;
