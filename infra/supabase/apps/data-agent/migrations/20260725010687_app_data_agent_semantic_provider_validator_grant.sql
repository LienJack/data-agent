-- semantic_provider_validator_grant_migration_checksum: sha256:447b17db55553736e6178b250dc84bf59485434d4d117f5ffcbd12ec4d6453b6
-- 10687 grants the semantic Provider RPC owner its exact shared validator dependency.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_PROVIDER_VALIDATOR_GRANT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_PROVIDER_VALIDATOR_GRANT_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010686_app_data_agent_knowledge_evidence_revision_repair')
  then raise exception using errcode='P0001',message='SEMANTIC_PROVIDER_VALIDATOR_GRANT_BASELINE_10686_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
grant usage on schema app_data_agent to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.provider_json_object_has_exact_keys(jsonb,text[])
  to data_agent_u6_rpc_owner;
do $postconditions$
begin
  if not pg_catalog.has_schema_privilege('data_agent_u6_rpc_owner','app_data_agent','USAGE')
    or not pg_catalog.has_function_privilege(
      'data_agent_u6_rpc_owner',
      'app_data_agent.provider_json_object_has_exact_keys(jsonb,text[])',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon','semantic.commit_authoring_provider_intent(uuid,uuid,text,uuid,text,uuid,integer,uuid,uuid,text,jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='SEMANTIC_PROVIDER_VALIDATOR_GRANT_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010687_app_data_agent_semantic_provider_validator_grant',
  'sha256:447b17db55553736e6178b250dc84bf59485434d4d117f5ffcbd12ec4d6453b6'
);
commit;
