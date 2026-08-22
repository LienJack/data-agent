-- semantic_revision_evidence_read_migration_checksum: sha256:b69a0c7f01ee8622309b96a368c7b64ae50f08d2e3201dbb22d7a2efd6e1206d
-- 10694 lets the semantic Revision RPC verify immutable evidence-selection references in scope.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_REVISION_EVIDENCE_READ_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_REVISION_EVIDENCE_READ_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010693_app_data_agent_semantic_revision_pointer_read_repair')
  then raise exception using errcode='P0001',message='SEMANTIC_REVISION_EVIDENCE_READ_BASELINE_10693_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
grant select on app_data_agent.knowledge_evidence_selections to data_agent_u6_rpc_owner;

create policy knowledge_evidence_selections_semantic_revision_select
  on app_data_agent.knowledge_evidence_selections
  for select
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and intended_semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );
do $postconditions$
begin
  if not pg_catalog.has_table_privilege(
    'data_agent_u6_rpc_owner','app_data_agent.knowledge_evidence_selections','SELECT'
  ) or not exists(select 1 from pg_catalog.pg_policy policy
    where policy.polrelid='app_data_agent.knowledge_evidence_selections'::pg_catalog.regclass
      and policy.polname='knowledge_evidence_selections_semantic_revision_select')
    or pg_catalog.has_table_privilege(
      'data_agent_backend','app_data_agent.knowledge_evidence_selections','SELECT'
    )
  then raise exception using errcode='P0001',message='SEMANTIC_REVISION_EVIDENCE_READ_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010694_app_data_agent_semantic_revision_evidence_read',
  'sha256:b69a0c7f01ee8622309b96a368c7b64ae50f08d2e3201dbb22d7a2efd6e1206d'
);
commit;
