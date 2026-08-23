-- semantic_explorer_projection_reuse_repair_migration_checksum: sha256:54b6bbc05e5142685a5824836fbf47211bbcebc428511b447a6b388a163b28f3
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using
      errcode = '0A000',
      message = 'SEMANTIC_EXPLORER_PROJECTION_REUSE_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'SEMANTIC_EXPLORER_PROJECTION_REUSE_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1
    from platform.migration_ledger
    where owner_kind = 'app'
      and app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version = '20260725010701_app_data_agent_legacy_profile_list_runtime_repair'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'SEMANTIC_EXPLORER_PROJECTION_REUSE_REPAIR_BASELINE_10701_MISSING';
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

do $repair$
declare
  target regprocedure;
  definition text;
  repaired text;
begin
  foreach target in array array[
    'semantic.build_explorer_source(uuid,uuid,text,uuid,text,uuid,text)'::regprocedure,
    'semantic.build_explorer_release_identity(uuid,uuid,text,text,uuid)'::regprocedure
  ]
  loop
    definition := pg_catalog.pg_get_functiondef(target);
    repaired := pg_catalog.regexp_replace(
      definition,
      'v_executable\.release_id[[:space:]]+IS[[:space:]]+DISTINCT[[:space:]]+FROM[[:space:]]+v_release\.release_id[[:space:]]+OR[[:space:]]+',
      '',
      'gi'
    );
    repaired := pg_catalog.regexp_replace(
      repaired,
      'v_relationship\.release_id[[:space:]]+IS[[:space:]]+DISTINCT[[:space:]]+FROM[[:space:]]+v_release\.release_id[[:space:]]+OR[[:space:]]+',
      '',
      'gi'
    );
    repaired := pg_catalog.regexp_replace(
      repaired,
      'v_restriction\.release_id[[:space:]]+IS[[:space:]]+DISTINCT[[:space:]]+FROM[[:space:]]+v_release\.release_id[[:space:]]+OR[[:space:]]+',
      '',
      'gi'
    );
    if repaired = definition then
      raise exception using
        errcode = 'P0001',
        message = 'SEMANTIC_EXPLORER_PROJECTION_REUSE_REPAIR_SOURCE_NOT_FOUND';
    end if;
    execute repaired;
  end loop;
end
$repair$;

do $postconditions$
declare
  source_definition text;
  identity_definition text;
begin
  source_definition := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'semantic.build_explorer_source(uuid,uuid,text,uuid,text,uuid,text)'::regprocedure
  ));
  identity_definition := pg_catalog.lower(pg_catalog.pg_get_functiondef(
    'semantic.build_explorer_release_identity(uuid,uuid,text,text,uuid)'::regprocedure
  ));
  if source_definition like '%v_executable.release_id is distinct from v_release.release_id%'
    or source_definition like '%v_relationship.release_id is distinct from v_release.release_id%'
    or source_definition like '%v_restriction.release_id is distinct from v_release.release_id%'
    or identity_definition like '%v_executable.release_id is distinct from v_release.release_id%'
    or identity_definition like '%v_relationship.release_id is distinct from v_release.release_id%'
    or identity_definition like '%v_restriction.release_id is distinct from v_release.release_id%'
    or source_definition not like '%v_executable.projection_digest is distinct from v_release.executable_projection_hash%'
    or source_definition not like '%v_relationship.projection_digest is distinct from v_release.relationship_projection_hash%'
    or source_definition not like '%v_restriction.projection_digest is distinct from v_release.runtime_restriction_projection_hash%'
    or identity_definition not like '%v_executable.projection_digest is distinct from v_release.executable_projection_hash%'
    or identity_definition not like '%v_relationship.projection_digest is distinct from v_release.relationship_projection_hash%'
    or identity_definition not like '%v_restriction.projection_digest is distinct from v_release.runtime_restriction_projection_hash%'
  then
    raise exception using
      errcode = 'P0001',
      message = 'SEMANTIC_EXPLORER_PROJECTION_REUSE_REPAIR_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010702_app_data_agent_semantic_explorer_projection_reuse_repair',
  'sha256:54b6bbc05e5142685a5824836fbf47211bbcebc428511b447a6b388a163b28f3'
);

commit;
