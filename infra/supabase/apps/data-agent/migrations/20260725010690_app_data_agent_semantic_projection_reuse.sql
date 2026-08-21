-- semantic_projection_reuse_migration_checksum: sha256:2869a8ce72c0f1b24c002b93fffa6bfe5c561bb68857b6fe0e88f34d38552bf7
-- 10690 reuses immutable compiled projections when a source-only change leaves them unchanged.
begin;
do $bootstrap$ begin
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_PROJECTION_REUSE_EXECUTOR_UNSAFE'; end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010689_app_data_agent_semantic_self_publish_canonicalizer_grant')
  then raise exception using errcode='P0001',message='SEMANTIC_PROJECTION_REUSE_BASELINE_10689_MISSING'; end if;
end $bootstrap$;
set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create function semantic.reuse_semantic_release_projection_refs()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare projection_id_value uuid;
begin
  select projection.projection_id into projection_id_value
  from semantic.semantic_executable_projection projection
  where projection.app_id=new.app_id and projection.tenant_id=new.tenant_id
    and projection.environment=new.environment and projection.semantic_domain=new.semantic_domain
    and projection.projection_digest=new.executable_projection_hash;
  if found then new.executable_projection_ref:=projection_id_value; end if;

  select projection.projection_id into projection_id_value
  from semantic.semantic_relationship_projection projection
  where projection.app_id=new.app_id and projection.tenant_id=new.tenant_id
    and projection.environment=new.environment and projection.semantic_domain=new.semantic_domain
    and projection.projection_digest=new.relationship_projection_hash;
  if found then new.relationship_projection_ref:=projection_id_value; end if;

  select projection.projection_id into projection_id_value
  from semantic.semantic_runtime_restriction_projection projection
  where projection.app_id=new.app_id and projection.tenant_id=new.tenant_id
    and projection.environment=new.environment and projection.semantic_domain=new.semantic_domain
    and projection.projection_digest=new.runtime_restriction_projection_hash;
  if found then new.runtime_restriction_projection_ref:=projection_id_value; end if;
  return new;
end
$function$;

create function semantic.reuse_semantic_executable_projection()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare existing_record semantic.semantic_executable_projection%rowtype;
begin
  select projection.* into existing_record from semantic.semantic_executable_projection projection
  where projection.app_id=new.app_id and projection.tenant_id=new.tenant_id
    and projection.environment=new.environment and projection.semantic_domain=new.semantic_domain
    and projection.projection_digest=new.projection_digest;
  if not found then return new; end if;
  if existing_record.projection_payload<>new.projection_payload then
    raise exception using errcode='P0001',message='SEMANTIC_EXECUTABLE_PROJECTION_DIGEST_COLLISION'; end if;
  return null;
end
$function$;

create function semantic.reuse_semantic_relationship_projection()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare existing_record semantic.semantic_relationship_projection%rowtype;
begin
  select projection.* into existing_record from semantic.semantic_relationship_projection projection
  where projection.app_id=new.app_id and projection.tenant_id=new.tenant_id
    and projection.environment=new.environment and projection.semantic_domain=new.semantic_domain
    and projection.projection_digest=new.projection_digest;
  if not found then return new; end if;
  if existing_record.projection_payload<>new.projection_payload
    or existing_record.datasource_id<>new.datasource_id
    or existing_record.catalog_epoch<>new.catalog_epoch
  then raise exception using errcode='P0001',message='SEMANTIC_RELATIONSHIP_PROJECTION_DIGEST_COLLISION'; end if;
  return null;
end
$function$;

create function semantic.reuse_semantic_restriction_projection()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare existing_record semantic.semantic_runtime_restriction_projection%rowtype;
begin
  select projection.* into existing_record from semantic.semantic_runtime_restriction_projection projection
  where projection.app_id=new.app_id and projection.tenant_id=new.tenant_id
    and projection.environment=new.environment and projection.semantic_domain=new.semantic_domain
    and projection.projection_digest=new.projection_digest;
  if not found then return new; end if;
  if existing_record.restriction_payload<>new.restriction_payload
    or existing_record.platform_policy_digest<>new.platform_policy_digest
    or existing_record.compiler_bundle_digest<>new.compiler_bundle_digest
  then raise exception using errcode='P0001',message='SEMANTIC_RESTRICTION_PROJECTION_DIGEST_COLLISION'; end if;
  return null;
end
$function$;

create trigger semantic_publish_attempt_projection_reuse
before insert on semantic.semantic_publish_attempt for each row
execute function semantic.reuse_semantic_release_projection_refs();
create trigger semantic_source_release_projection_reuse
before insert on semantic.semantic_source_release for each row
execute function semantic.reuse_semantic_release_projection_refs();
create trigger semantic_executable_projection_reuse
before insert on semantic.semantic_executable_projection for each row
execute function semantic.reuse_semantic_executable_projection();
create trigger semantic_relationship_projection_reuse
before insert on semantic.semantic_relationship_projection for each row
execute function semantic.reuse_semantic_relationship_projection();
create trigger semantic_restriction_projection_reuse
before insert on semantic.semantic_runtime_restriction_projection for each row
execute function semantic.reuse_semantic_restriction_projection();

revoke all on function semantic.reuse_semantic_release_projection_refs(),
  semantic.reuse_semantic_executable_projection(),
  semantic.reuse_semantic_relationship_projection(),
  semantic.reuse_semantic_restriction_projection()
from public,anon,authenticated,service_role,data_agent_backend;
do $postconditions$ begin
  if not exists(select 1 from pg_catalog.pg_trigger
      where tgrelid='semantic.semantic_publish_attempt'::regclass
        and tgname='semantic_publish_attempt_projection_reuse' and not tgisinternal)
    or not exists(select 1 from pg_catalog.pg_trigger
      where tgrelid='semantic.semantic_source_release'::regclass
        and tgname='semantic_source_release_projection_reuse' and not tgisinternal)
    or not exists(select 1 from pg_catalog.pg_trigger
      where tgrelid='semantic.semantic_executable_projection'::regclass
        and tgname='semantic_executable_projection_reuse' and not tgisinternal)
    or not exists(select 1 from pg_catalog.pg_trigger
      where tgrelid='semantic.semantic_relationship_projection'::regclass
        and tgname='semantic_relationship_projection_reuse' and not tgisinternal)
    or not exists(select 1 from pg_catalog.pg_trigger
      where tgrelid='semantic.semantic_runtime_restriction_projection'::regclass
        and tgname='semantic_restriction_projection_reuse' and not tgisinternal)
  then raise exception using errcode='P0001',message='SEMANTIC_PROJECTION_REUSE_POSTCONDITION_FAILED'; end if;
end $postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010690_app_data_agent_semantic_projection_reuse',
  'sha256:2869a8ce72c0f1b24c002b93fffa6bfe5c561bb68857b6fe0e88f34d38552bf7'
);
commit;
