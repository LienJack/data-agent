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
