-- research_authority_epoch_repair_migration_checksum: sha256:a47845328906bc3fd6d0ee096e2132b322cc6e6879eaeca7d320f5f1ddd141db
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='RESEARCH_AUTHORITY_EPOCH_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='RESEARCH_AUTHORITY_EPOCH_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010718_app_data_agent_research_authority_rowtype_repair')
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_EPOCH_BASELINE_10718_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $epoch_repair$
declare
  definition text;
  rewritten text;
  old_expression constant text := 'pg_catalog.coalesce(current_head.current_authority_epoch,-1)+1';
  new_expression constant text := 'coalesce(current_head.current_authority_epoch,-1::bigint)+1';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,old_expression)=0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_EPOCH_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(definition,old_expression,new_expression);
  execute rewritten;
end
$epoch_repair$;
do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'coalesce(current_head.current_authority_epoch,-1::bigint)+1')=0
    or pg_catalog.strpos(definition,'pg_catalog.coalesce')>0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_EPOCH_REPAIR_NOT_INSTALLED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010719_app_data_agent_research_authority_epoch_repair',
  'sha256:a47845328906bc3fd6d0ee096e2132b322cc6e6879eaeca7d320f5f1ddd141db');
commit;
