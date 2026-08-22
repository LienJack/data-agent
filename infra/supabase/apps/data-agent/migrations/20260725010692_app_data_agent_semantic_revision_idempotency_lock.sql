-- semantic_revision_idempotency_lock_migration_checksum: sha256:6b2df07eb076c50b8d052e6e00dd70ae13fa57f259af0c5d953af3c3e4cf7458
-- 10692 grants the row-lock privilege required by the Revision-save idempotency lookup.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_REVISION_IDEMPOTENCY_LOCK_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_REVISION_IDEMPOTENCY_LOCK_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010691_app_data_agent_semantic_revision_save_repair')
  then raise exception using errcode='P0001',message='SEMANTIC_REVISION_IDEMPOTENCY_LOCK_BASELINE_10691_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
grant update on semantic.semantic_candidate_revision_save_idempotency
  to data_agent_u6_rpc_owner;
do $postconditions$
begin
  if not pg_catalog.has_table_privilege(
    'data_agent_u6_rpc_owner','semantic.semantic_candidate_revision_save_idempotency','SELECT,INSERT,UPDATE'
  ) or pg_catalog.has_table_privilege(
    'data_agent_backend','semantic.semantic_candidate_revision_save_idempotency','UPDATE'
  )
  then raise exception using errcode='P0001',message='SEMANTIC_REVISION_IDEMPOTENCY_LOCK_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010692_app_data_agent_semantic_revision_idempotency_lock',
  'sha256:6b2df07eb076c50b8d052e6e00dd70ae13fa57f259af0c5d953af3c3e4cf7458'
);
commit;
