-- semantic_provider_preflight_failure_recovery_migration_checksum: sha256:cf69df556ddcfb3a7e7cf2def300a46ed4074e0b101cd4af9d85e511e4ac1688
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_PROVIDER_PREFLIGHT_FAILURE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_PROVIDER_PREFLIGHT_FAILURE_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010694_app_data_agent_semantic_provider_pending_attempt_recovery')
  then raise exception using errcode='P0001',message='SEMANTIC_PROVIDER_PREFLIGHT_FAILURE_BASELINE_10694_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
alter table semantic.semantic_authoring_turn
  drop constraint semantic_authoring_provider_dispatch_closure,
  add constraint semantic_authoring_provider_dispatch_closure check(
    (provider_status='INTENT_COMMITTED')=(provider_dispatched_at is null)
    or (provider_status in ('RESPONSE_OBSERVED','FAILED')
      and provider_terminal_kind='FAILED' and provider_dispatched_at is null)
    or provider_status is null
  );
do $postconditions$
declare v_constraint text;
begin
  select pg_catalog.pg_get_constraintdef(item.oid)
    into strict v_constraint
  from pg_catalog.pg_constraint as item
  where item.conrelid='semantic.semantic_authoring_turn'::pg_catalog.regclass
    and item.conname='semantic_authoring_provider_dispatch_closure';
  if pg_catalog.strpos(v_constraint, 'provider_terminal_kind = ''FAILED''')=0
    or pg_catalog.strpos(v_constraint, 'provider_dispatched_at IS NULL')=0
  then raise exception using errcode='P0001',message='SEMANTIC_PROVIDER_PREFLIGHT_FAILURE_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010695_app_data_agent_semantic_provider_preflight_failure_recovery',
  'sha256:cf69df556ddcfb3a7e7cf2def300a46ed4074e0b101cd4af9d85e511e4ac1688'
);
commit;
