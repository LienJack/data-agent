-- ============================================================
-- 10645: Semantic authoring review submission policy
-- ============================================================
-- Depends on: 20260725010644_app_data_agent_semantic_authoring_events

begin;

do $bootstrap$
declare
  baseline_migration record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_AUTHORING_REVIEW_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_AUTHORING_REVIEW_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010644_app_data_agent_semantic_authoring_events';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_REVIEW_BASELINE_10644_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010645_app_data_agent_semantic_authoring_review'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_REVIEW_MIGRATION_10645_ALREADY_RECORDED';
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
-- The backend has no direct table privilege. This policy only lets the u6 RPC
-- owner transition an in-scope DRAFT candidate to the terminal review state.
create policy semantic_candidate_authoring_review_update
  on semantic.semantic_candidate
  for update
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
    and candidate_status = 'DRAFT'
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
    and candidate_status = 'REVIEW_SUBMITTED'
  );
do $postconditions$
declare
  policy_record record;
begin
  select policy.cmd, policy.roles, policy.qual, policy.with_check
  into policy_record
  from pg_catalog.pg_policies as policy
  where policy.schemaname = 'semantic'
    and policy.tablename = 'semantic_candidate'
    and policy.policyname = 'semantic_candidate_authoring_review_update';

  if not found
    or policy_record.cmd <> 'UPDATE'
    or policy_record.roles <> array['data_agent_u6_rpc_owner']::name[]
    or pg_catalog.strpos(policy_record.qual, 'candidate_status = ''DRAFT''') = 0
    or pg_catalog.strpos(policy_record.with_check, 'candidate_status = ''REVIEW_SUBMITTED''') = 0
    or pg_catalog.has_table_privilege(
      'data_agent_backend', 'semantic.semantic_candidate', 'UPDATE'
    )
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_REVIEW_POLICY_INVALID';
  end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010645_app_data_agent_semantic_authoring_review',
  'sha256:b08d1757959680befbbd1dfc229e90a459f77e031c539f15fc41090387596607'
);

commit;
