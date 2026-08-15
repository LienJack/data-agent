-- ============================================================
-- 10642: Semantic authoring audit policy closure
-- ============================================================
-- Depends on: 20260725010641_app_data_agent_semantic_authoring_queue

begin;

do $bootstrap$
declare
  baseline_migration record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_AUTHORING_AUDIT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_AUTHORING_AUDIT_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010641_app_data_agent_semantic_authoring_queue';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_AUDIT_BASELINE_10641_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010642_app_data_agent_semantic_authoring_audit'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_AUDIT_MIGRATION_10642_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regclass('app_data_agent.audit_log') is null
    or pg_catalog.to_regprocedure('semantic.claim_semantic_authoring_run(uuid,uuid,text,uuid,text,text,integer)') is null
    or pg_catalog.to_regprocedure('semantic.complete_semantic_authoring(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb,text,jsonb)') is null
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_AUDIT_AUTHORITY_SURFACE_MISSING';
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
-- The RPC owner may append only the two authoring-run audit actions emitted by
-- the fenced queue and completion functions. Direct backend table writes stay denied.
create policy audit_log_semantic_authoring_rpc_insert
  on app_data_agent.audit_log
  for insert
  to data_agent_u6_rpc_owner
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and principal_id = nullif(
      pg_catalog.current_setting('data_agent.principal_id', true),
      ''
    )::uuid
    and action in (
      'SEMANTIC_AUTHORING_WORKER_CLAIMED',
      'SEMANTIC_AUTHORING_READY_FOR_REVIEW'
    )
    and resource_type = 'semantic_authoring_run'
  );
do $postconditions$
declare
  policy_record record;
begin
  select policy.polcmd, policy.polroles, pg_catalog.pg_get_expr(
    policy.polwithcheck,
    policy.polrelid
  ) as check_expression
  into policy_record
  from pg_catalog.pg_policy as policy
  where policy.polrelid = 'app_data_agent.audit_log'::regclass
    and policy.polname = 'audit_log_semantic_authoring_rpc_insert';
  if not found
    or policy_record.polcmd <> 'a'
    or not ('data_agent_u6_rpc_owner'::regrole::oid = any(policy_record.polroles))
    or pg_catalog.strpos(
      policy_record.check_expression, 'SEMANTIC_AUTHORING_WORKER_CLAIMED'
    ) = 0
    or pg_catalog.strpos(
      policy_record.check_expression, 'SEMANTIC_AUTHORING_READY_FOR_REVIEW'
    ) = 0
    or pg_catalog.strpos(policy_record.check_expression, 'semantic_authoring_run') = 0
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_AUDIT_POLICY_INVALID';
  end if;
  if has_table_privilege(
    'data_agent_backend', 'app_data_agent.audit_log', 'INSERT'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_AUDIT_BACKEND_PRIVILEGE_LEAK';
  end if;
  if not has_table_privilege(
    'data_agent_u6_rpc_owner', 'app_data_agent.audit_log', 'INSERT'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_AUDIT_RPC_PRIVILEGE_MISSING';
  end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010642_app_data_agent_semantic_authoring_audit',
  'sha256:f9e30c1379aeed98f210d4c28e0dcd8d5e735cf9c987dcfc56067fda1f80d354'
);

commit;
