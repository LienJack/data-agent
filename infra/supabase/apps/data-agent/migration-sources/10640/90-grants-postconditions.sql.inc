alter function semantic.get_active_semantic_graph_studio(uuid,uuid,text,uuid,text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.start_semantic_studio_authoring(uuid,uuid,text,uuid,text,jsonb)
  owner to data_agent_u6_rpc_owner;

revoke all on function semantic.get_active_semantic_graph_studio(uuid,uuid,text,uuid,text) from public;
revoke all on function semantic.start_semantic_studio_authoring(uuid,uuid,text,uuid,text,jsonb) from public;
grant execute on function semantic.get_active_semantic_graph_studio(uuid,uuid,text,uuid,text)
  to data_agent_backend;
grant execute on function semantic.start_semantic_studio_authoring(uuid,uuid,text,uuid,text,jsonb)
  to data_agent_backend;

do $postconditions$
declare
  function_record record;
begin
  if has_table_privilege('data_agent_backend', 'semantic.semantic_graph_projection', 'SELECT')
    or has_table_privilege('data_agent_backend', 'semantic.semantic_authoring_run', 'SELECT')
    or has_table_privilege('data_agent_backend', 'semantic.semantic_candidate', 'INSERT')
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_STUDIO_BACKEND_TABLE_PRIVILEGE_LEAK';
  end if;
  for function_record in
    select procedure.proname as function_name, procedure.provolatile, procedure.prosecdef
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'semantic'
      and procedure.proname in ('get_active_semantic_graph_studio', 'start_semantic_studio_authoring')
  loop
    if not function_record.prosecdef
      or (function_record.function_name = 'get_active_semantic_graph_studio' and function_record.provolatile <> 's')
      or (function_record.function_name = 'start_semantic_studio_authoring' and function_record.provolatile <> 'v')
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_STUDIO_RPC_SECURITY_INVALID';
    end if;
  end loop;
  if (select pg_catalog.count(*) from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'semantic'
        and procedure.proname in ('get_active_semantic_graph_studio', 'start_semantic_studio_authoring')) <> 2
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_STUDIO_RPC_MISSING';
  end if;
end
$postconditions$;
