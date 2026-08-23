create function semantic.get_authoring_pending_provider_attempt(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_principal_id uuid,p_semantic_domain text,
  p_authoring_run_id uuid,p_turn_index integer,p_request_id uuid
) returns uuid language plpgsql stable security definer set search_path='' as $function$
declare v_attempt_id uuid;
begin
  perform semantic.assert_explorer_scope(p_app_id,p_tenant_id,p_environment,p_principal_id,p_semantic_domain);
  select turn.provider_attempt_id into v_attempt_id
  from semantic.semantic_authoring_turn as turn
  join semantic.semantic_authoring_run as run
    on run.app_id=turn.app_id and run.tenant_id=turn.tenant_id and run.environment=turn.environment
    and run.semantic_domain=turn.semantic_domain and run.authoring_run_id=turn.authoring_run_id
  where turn.app_id=p_app_id and turn.tenant_id=p_tenant_id and turn.environment=p_environment
    and turn.semantic_domain=p_semantic_domain and turn.authoring_run_id=p_authoring_run_id
    and turn.turn_index=p_turn_index and turn.request_payload#>>'{request_id}'=p_request_id::text
    and run.principal_id=p_principal_id and run.status='RUNNING' and run.lease_token is not null
    and run.lease_expires_at>pg_catalog.clock_timestamp()
    and turn.provider_status='INTENT_COMMITTED';
  return v_attempt_id;
end
$function$;

alter function semantic.get_authoring_pending_provider_attempt(uuid,uuid,text,uuid,text,uuid,integer,uuid)
  owner to data_agent_u6_rpc_owner;
revoke all on function semantic.get_authoring_pending_provider_attempt(uuid,uuid,text,uuid,text,uuid,integer,uuid)
  from public, anon, authenticated, service_role;
grant execute on function semantic.get_authoring_pending_provider_attempt(uuid,uuid,text,uuid,text,uuid,integer,uuid)
  to data_agent_backend;
