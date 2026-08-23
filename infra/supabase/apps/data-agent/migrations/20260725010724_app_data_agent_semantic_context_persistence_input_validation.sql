-- semantic_context_persistence_input_migration_checksum: sha256:7ba1f800e830ea0d9c09a5453a97811866db36e8700472f410d3e9739517f636
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_CONTEXT_PERSISTENCE_INPUT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_CONTEXT_PERSISTENCE_INPUT_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010723_app_data_agent_semantic_context_commit_diagnostics')
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_PERSISTENCE_INPUT_BASELINE_10723_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $persistence_input_validation$
declare
  definition text;
  rewritten text;
  authority_statement constant text :=
    $$  select * into authority from platform.current_backend_authority(true);$$;
  guarded_authority_statement constant text := $$  if not pg_catalog.pg_input_is_valid(requested#>>'{receipt,receipt_id}','uuid') then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_RECEIPT_ID_INVALID';
  end if;
  if not pg_catalog.pg_input_is_valid(requested#>>'{request,request_id}','uuid') then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_REQUEST_ID_INVALID';
  end if;
  if requested#>>'{request,basis,consumer}'='RUN'
    and not pg_catalog.pg_input_is_valid(requested#>>'{request,basis,run_id}','uuid')
  then raise exception using errcode='22023',message='SEMANTIC_CONTEXT_RUN_ID_INVALID'; end if;
  if not pg_catalog.pg_input_is_valid(requested#>>'{package,package_id}','uuid') then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_PACKAGE_ID_INVALID';
  end if;
  if not pg_catalog.pg_input_is_valid(requested#>>'{receipt,resolved_at}','timestamptz') then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_RESOLVED_AT_INVALID';
  end if;
  select * into authority from platform.current_backend_authority(true);$$;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,authority_statement)=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_RECEIPT_ID_INVALID')>0
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_PERSISTENCE_INPUT_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(definition,authority_statement,guarded_authority_statement);
  execute rewritten;
end
$persistence_input_validation$;
do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'pg_catalog.pg_input_is_valid')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_RECEIPT_ID_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_PACKAGE_ID_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_RESOLVED_AT_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_COMMIT_SHAPE_INVALID')=0
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_PERSISTENCE_INPUT_VALIDATION_NOT_INSTALLED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010724_app_data_agent_semantic_context_persistence_input_validation',
  'sha256:7ba1f800e830ea0d9c09a5453a97811866db36e8700472f410d3e9739517f636');
commit;
