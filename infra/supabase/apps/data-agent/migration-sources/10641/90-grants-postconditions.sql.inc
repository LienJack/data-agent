-- ============================================================
-- 10641: Narrow queue grants and postconditions
-- ============================================================

alter function semantic.claim_semantic_authoring_run(uuid,uuid,text,uuid,text,text,integer)
  owner to data_agent_u6_rpc_owner;
alter function semantic.heartbeat_semantic_authoring_run(uuid,uuid,text,uuid,text,uuid,text,uuid,bigint,integer)
  owner to data_agent_u6_rpc_owner;
alter function semantic.release_semantic_authoring_run(uuid,uuid,text,uuid,text,uuid,text,uuid,bigint)
  owner to data_agent_u6_rpc_owner;

revoke all on function semantic.claim_semantic_authoring_run(uuid,uuid,text,uuid,text,text,integer) from public;
revoke all on function semantic.heartbeat_semantic_authoring_run(uuid,uuid,text,uuid,text,uuid,text,uuid,bigint,integer) from public;
revoke all on function semantic.release_semantic_authoring_run(uuid,uuid,text,uuid,text,uuid,text,uuid,bigint) from public;
grant execute on function semantic.claim_semantic_authoring_run(uuid,uuid,text,uuid,text,text,integer)
  to data_agent_backend;
grant execute on function semantic.heartbeat_semantic_authoring_run(uuid,uuid,text,uuid,text,uuid,text,uuid,bigint,integer)
  to data_agent_backend;
grant execute on function semantic.release_semantic_authoring_run(uuid,uuid,text,uuid,text,uuid,text,uuid,bigint)
  to data_agent_backend;

do $postconditions$
declare
  function_name text;
  function_record record;
begin
  if has_table_privilege(
    'data_agent_backend', 'semantic.semantic_authoring_run', 'SELECT,INSERT,UPDATE,DELETE'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_QUEUE_TABLE_PRIVILEGE_LEAK';
  end if;
  foreach function_name in array array[
    'claim_semantic_authoring_run',
    'heartbeat_semantic_authoring_run',
    'release_semantic_authoring_run'
  ] loop
    select procedure.prosecdef, procedure.proconfig, owner.rolname as owner_name
    into function_record
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where namespace.nspname = 'semantic' and procedure.proname = function_name;
    if not found or not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_u6_rpc_owner'
      or pg_catalog.array_to_string(function_record.proconfig, ',') not in ('search_path=', 'search_path=""')
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_QUEUE_FUNCTION_HARDENING_FAILED';
    end if;
  end loop;
end
$postconditions$;
