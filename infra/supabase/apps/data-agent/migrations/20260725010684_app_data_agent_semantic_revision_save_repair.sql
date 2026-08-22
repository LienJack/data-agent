-- semantic_revision_save_repair_migration_checksum: sha256:b7a3b242f8c8d3787d3b10ea962fc3b2e480981e21a8d55db146893a924308cf
-- 10684 aligns explicit Revision validation and authorizes its exact audit append.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_REVISION_SAVE_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_REVISION_SAVE_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010683_app_data_agent_semantic_manual_audit_policy')
  then raise exception using errcode='P0001',message='SEMANTIC_REVISION_SAVE_REPAIR_BASELINE_10683_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $repair$
declare function_definition text;
begin
  function_definition:=pg_catalog.pg_get_functiondef(
    'semantic.save_semantic_candidate_revision(jsonb)'::pg_catalog.regprocedure
  );
  if (pg_catalog.length(function_definition)-pg_catalog.length(
    pg_catalog.replace(function_definition,'platform.canonical_sha256','')
  ))/pg_catalog.length('platform.canonical_sha256')<>3
  then raise exception using errcode='P0001',message='SEMANTIC_REVISION_SAVE_DIGEST_REPAIR_SOURCE_DRIFT'; end if;
  execute pg_catalog.replace(
    function_definition,'platform.canonical_sha256','semantic.authoring_sha256'
  );
end
$repair$;

create policy audit_log_semantic_revision_save_rpc_insert
  on app_data_agent.audit_log
  for insert
  to data_agent_u6_rpc_owner
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id', true), '')::uuid
    and action = 'SEMANTIC_CANDIDATE_REVISION_SAVED'
    and resource_type = 'semantic_candidate_revision'
  );
do $postconditions$
declare function_definition text;
begin
  function_definition:=pg_catalog.pg_get_functiondef(
    'semantic.save_semantic_candidate_revision(jsonb)'::pg_catalog.regprocedure
  );
  if pg_catalog.strpos(function_definition,'platform.canonical_sha256')>0
    or (pg_catalog.length(function_definition)-pg_catalog.length(
      pg_catalog.replace(function_definition,'semantic.authoring_sha256','')
    ))/pg_catalog.length('semantic.authoring_sha256')<>3
    or not exists(select 1 from pg_catalog.pg_policy policy
      where policy.polrelid='app_data_agent.audit_log'::pg_catalog.regclass
        and policy.polname='audit_log_semantic_revision_save_rpc_insert')
  then raise exception using errcode='P0001',message='SEMANTIC_REVISION_SAVE_REPAIR_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010684_app_data_agent_semantic_revision_save_repair',
  'sha256:b7a3b242f8c8d3787d3b10ea962fc3b2e480981e21a8d55db146893a924308cf'
);
commit;
