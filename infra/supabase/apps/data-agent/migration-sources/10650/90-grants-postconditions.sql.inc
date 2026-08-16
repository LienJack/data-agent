alter function app_data_agent.apply_model_provider_connection_command(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;
revoke all on function app_data_agent.apply_model_provider_connection_command(uuid,uuid,jsonb) from public;
grant execute on function app_data_agent.apply_model_provider_connection_command(uuid,uuid,jsonb)
  to data_agent_backend;

do $postconditions$
declare function_definition text;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict function_definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'apply_model_provider_connection_command'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = 'requested_deployment_id uuid, requested_principal_id uuid, command jsonb';
  if function_definition not like '%jsonb_object_keys(command)%'
    or function_definition like '%contains_potential_plaintext_secret(command)%'
  then
    raise exception using errcode = 'P0001', message = 'MODEL_PROVIDER_COMMAND_GUARD_REPLACEMENT_FAILED';
  end if;
end
$postconditions$;
