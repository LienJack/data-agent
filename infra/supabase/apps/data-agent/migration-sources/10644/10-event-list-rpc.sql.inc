create or replace function semantic.list_semantic_authoring_events(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_authoring_run_id uuid,
  p_after_sequence bigint,
  p_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_events jsonb;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  if not exists (
    select 1 from semantic.semantic_authoring_run as run
    where run.app_id = p_app_id and run.tenant_id = p_tenant_id
      and run.environment = p_environment and run.semantic_domain = p_semantic_domain
      and run.authoring_run_id = p_authoring_run_id
  ) then
    return '[]'::jsonb;
  end if;
  select coalesce(pg_catalog.jsonb_agg(event.event_payload order by event.sequence), '[]'::jsonb)
  into v_events
  from (
    select item.sequence, item.event_payload
    from semantic.semantic_authoring_event as item
    where item.app_id = p_app_id and item.tenant_id = p_tenant_id
      and item.environment = p_environment and item.semantic_domain = p_semantic_domain
      and item.authoring_run_id = p_authoring_run_id
      and item.sequence > coalesce(p_after_sequence, 0)
    order by item.sequence
    limit least(greatest(coalesce(p_limit, 1000), 1), 5000)
  ) as event;
  return v_events;
end;
$function$;

alter function semantic.list_semantic_authoring_events(uuid,uuid,text,uuid,text,uuid,bigint,integer)
  owner to data_agent_u6_rpc_owner;
revoke all on function semantic.list_semantic_authoring_events(uuid,uuid,text,uuid,text,uuid,bigint,integer)
  from public;
grant execute on function semantic.list_semantic_authoring_events(uuid,uuid,text,uuid,text,uuid,bigint,integer)
  to data_agent_backend;
