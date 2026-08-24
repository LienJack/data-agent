-- semantic_relationship_projection_reuse_epoch_migration_checksum: sha256:4192e58930b741d318b5246c63ff779927ef789830ccf19344e6b58161ea6c66
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_RELATIONSHIP_REUSE_EPOCH_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_RELATIONSHIP_REUSE_EPOCH_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010741_app_data_agent_analysis_python_hash_grant')
  then raise exception using errcode='P0001',message='SEMANTIC_RELATIONSHIP_REUSE_EPOCH_BASELINE_10741_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);

create or replace function semantic.reuse_semantic_relationship_projection()
returns trigger
language plpgsql
volatile
security definer
set search_path=''
as $function$
declare existing_record semantic.semantic_relationship_projection%rowtype;
begin
  select projection.* into existing_record
  from semantic.semantic_relationship_projection projection
  where projection.app_id=new.app_id
    and projection.tenant_id=new.tenant_id
    and projection.environment=new.environment
    and projection.semantic_domain=new.semantic_domain
    and projection.projection_digest=new.projection_digest;
  if not found then return new; end if;
  if existing_record.projection_payload<>new.projection_payload
    or existing_record.datasource_id<>new.datasource_id
  then
    raise exception using errcode='P0001',message='SEMANTIC_RELATIONSHIP_PROJECTION_DIGEST_COLLISION';
  end if;
  return null;
end
$function$;

revoke all on function semantic.reuse_semantic_relationship_projection()
from public,anon,authenticated,service_role,data_agent_backend;

do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef('semantic.reuse_semantic_relationship_projection()'::regprocedure)
  into definition;
  if definition is null
    or definition like '%existing_record.catalog_epoch<>new.catalog_epoch%'
    or not exists(select 1 from pg_catalog.pg_trigger
      where tgrelid='semantic.semantic_relationship_projection'::regclass
        and tgname='semantic_relationship_projection_reuse' and not tgisinternal)
  then
    raise exception using errcode='P0001',message='SEMANTIC_RELATIONSHIP_REUSE_EPOCH_NOT_INSTALLED';
  end if;
end
$postconditions$;

select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010742_app_data_agent_semantic_relationship_projection_reuse_epoch',
  'sha256:4192e58930b741d318b5246c63ff779927ef789830ccf19344e6b58161ea6c66');
commit;
