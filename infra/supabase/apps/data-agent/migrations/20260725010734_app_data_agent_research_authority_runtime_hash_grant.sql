-- research_authority_runtime_hash_grant_migration_checksum: sha256:af72133858501610b272050229b20ad8e4f4de81d6d66e75d07bd7f887d2d9ef
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='RESEARCH_AUTHORITY_RUNTIME_HASH_GRANT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='RESEARCH_AUTHORITY_RUNTIME_HASH_GRANT_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010733_app_data_agent_semantic_change_set_projection')
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_RUNTIME_HASH_GRANT_BASELINE_10733_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);

grant execute on function app_data_agent.runtime_canonical_sha256(jsonb)
to data_agent_u6_rpc_owner;

do $postconditions$
begin
  if not pg_catalog.has_function_privilege(
    'data_agent_u6_rpc_owner',
    'app_data_agent.runtime_canonical_sha256(jsonb)',
    'EXECUTE'
  ) then
    raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_RUNTIME_HASH_GRANT_NOT_INSTALLED';
  end if;
end
$postconditions$;

select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010734_app_data_agent_research_authority_runtime_hash_grant',
  'sha256:af72133858501610b272050229b20ad8e4f4de81d6d66e75d07bd7f887d2d9ef');
commit;
