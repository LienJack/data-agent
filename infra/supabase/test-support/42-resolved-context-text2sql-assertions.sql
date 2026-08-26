\set ON_ERROR_STOP on

do $assertions$
declare
  definition text;
begin
  if pg_catalog.to_regprocedure(
    'app_data_agent.verify_semantic_context_text2sql_binding(jsonb,uuid)') is null
  then raise exception 'U13 Semantic Context Text2SQL verifier missing'; end if;
  if not pg_catalog.has_function_privilege('data_agent_backend',
    'app_data_agent.verify_semantic_context_text2sql_binding(jsonb,uuid)','EXECUTE')
  then raise exception 'U13 verifier Backend grant missing'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend',
    'app_data_agent.semantic_context_receipts','SELECT,INSERT,UPDATE,DELETE')
  then raise exception 'U13 verifier must not grant direct Receipt table access'; end if;
  select pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid)) into definition
  from pg_catalog.pg_proc procedure
  where procedure.oid=
    'app_data_agent.verify_semantic_context_text2sql_binding(jsonb,uuid)'::regprocedure;
  if definition not like '%security definer%'
    or definition not like '%semantic_context_receipts%'
    or definition not like '%semantic_active_pointer%'
    or definition not like '%semantic_context_metric_projection%'
    or definition not like '%semantic_context_ontology_projection%'
    or definition not like '%u2_canonical_sha256%'
    or definition not like '%semantic_projection_hashes%'
  then raise exception 'U13 verifier currentness/hash closure incomplete'; end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010708_app_data_agent_semantic_context_cutover')
  then raise exception 'U13 migration ledger entry missing'; end if;
  if not exists(select 1 from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.verify_semantic_context_text2sql_binding(jsonb,uuid)'::regprocedure
      and procedure.provolatile='v')
    or definition not like '%for share%'
  then raise exception 'U13 verifier must lock current authority in a volatile function'; end if;
end
$assertions$;

begin;
set local role data_agent_backend;
select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-00000000aa22',true);
select pg_catalog.set_config('data_agent.environment','test',true);
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-000000001003',true);
select pg_catalog.set_config('data_agent.role','owner',true);
select pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',true);

do $negative_vector$
begin
  begin
    perform app_data_agent.verify_semantic_context_text2sql_binding(
      '{}'::jsonb,'00000000-0000-4000-8000-00000000f013'::uuid);
    raise exception 'U13 invalid binding unexpectedly verified';
  exception when sqlstate '22023' then
    if sqlerrm<>'SEMANTIC_CONTEXT_TEXT2SQL_BINDING_INVALID' then raise; end if;
  end;
end
$negative_vector$;
rollback;

select 'U13_SEMANTIC_CONTEXT_TEXT2SQL_ASSERTIONS_PASSED' as result;
