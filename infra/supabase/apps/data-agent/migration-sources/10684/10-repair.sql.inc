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
