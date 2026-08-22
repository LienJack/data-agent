-- semantic_manual_audit_policy_migration_checksum: sha256:ab443d120fe71c856d80d18c21b924bfa381a14844b9e6e7f7536455e89d46e3
-- 10690 authorizes the exact append-only audit action emitted by manual semantic sessions.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_MANUAL_AUDIT_POLICY_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_MANUAL_AUDIT_POLICY_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010689_app_data_agent_semantic_relationship_retry_repair')
  then raise exception using errcode='P0001',message='SEMANTIC_MANUAL_AUDIT_POLICY_BASELINE_10689_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create policy audit_log_semantic_manual_session_rpc_insert
  on app_data_agent.audit_log
  for insert
  to data_agent_u6_rpc_owner
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id', true), '')::uuid
    and action = 'SEMANTIC_MANUAL_SESSION_STARTED'
    and resource_type = 'semantic_authoring_run'
  );
do $postconditions$
begin
  if not exists(
    select 1 from pg_catalog.pg_policy policy
    where policy.polrelid='app_data_agent.audit_log'::pg_catalog.regclass
      and policy.polname='audit_log_semantic_manual_session_rpc_insert'
  ) or not pg_catalog.has_table_privilege(
    'data_agent_u6_rpc_owner','app_data_agent.audit_log','INSERT'
  )
  then raise exception using errcode='P0001',message='SEMANTIC_MANUAL_AUDIT_POLICY_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010690_app_data_agent_semantic_manual_audit_policy',
  'sha256:ab443d120fe71c856d80d18c21b924bfa381a14844b9e6e7f7536455e89d46e3'
);
commit;
