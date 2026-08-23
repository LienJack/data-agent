-- research_authority_rowtype_repair_migration_checksum: sha256:6fb38e8cdffd3d4c8f55ce022e54978ab6167db6ecf3f038516280b8bd3f62dc
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='RESEARCH_AUTHORITY_ROWTYPE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='RESEARCH_AUTHORITY_ROWTYPE_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010717_app_data_agent_research_authority_provisioning_row_lock')
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_ROWTYPE_BASELINE_10717_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $rowtype_repair$
declare
  definition text;
  rewritten text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'  current_head record;')=0
    or pg_catalog.strpos(definition,'  current_capability record;')=0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_ROWTYPE_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(
    definition,'  current_head record;',
    '  current_head app_data_agent.research_authority_capability_heads%rowtype;'
  );
  rewritten:=pg_catalog.replace(
    rewritten,'  current_capability record;',
    '  current_capability app_data_agent.research_authority_capabilities%rowtype;'
  );
  execute rewritten;
end
$rowtype_repair$;
do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'current_head app_data_agent.research_authority_capability_heads%rowtype')=0
    or pg_catalog.strpos(definition,'current_capability app_data_agent.research_authority_capabilities%rowtype')=0
    or pg_catalog.strpos(definition,'current_head record')>0
    or pg_catalog.strpos(definition,'current_capability record')>0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_ROWTYPE_NOT_INSTALLED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010718_app_data_agent_research_authority_rowtype_repair',
  'sha256:6fb38e8cdffd3d4c8f55ce022e54978ab6167db6ecf3f038516280b8bd3f62dc');
commit;
