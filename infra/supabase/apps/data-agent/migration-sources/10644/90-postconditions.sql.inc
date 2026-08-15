do $postconditions$
declare
  function_oid regprocedure := pg_catalog.to_regprocedure(
    'semantic.list_semantic_authoring_events(uuid,uuid,text,uuid,text,uuid,bigint,integer)'
  );
  function_definition text;
  function_record record;
begin
  function_definition := pg_catalog.pg_get_functiondef(function_oid);
  select procedure.prosecdef, procedure.proconfig, owner.rolname as owner_name
  into function_record
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
  where procedure.oid = function_oid::oid;

  if pg_catalog.strpos(function_definition, 'pg_catalog.greatest') > 0
    or pg_catalog.strpos(function_definition, 'pg_catalog.least') > 0
    or pg_catalog.strpos(pg_catalog.lower(function_definition), 'limit least(greatest(') = 0
    or not function_record.prosecdef
    or function_record.owner_name <> 'data_agent_u6_rpc_owner'
    or pg_catalog.array_to_string(function_record.proconfig, ',') not in (
      'search_path=', 'search_path=""'
    )
    or not has_function_privilege(
      'data_agent_backend',
      'semantic.list_semantic_authoring_events(uuid,uuid,text,uuid,text,uuid,bigint,integer)',
      'EXECUTE'
    )
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_EVENTS_FUNCTION_HARDENING_FAILED';
  end if;
end
$postconditions$;
