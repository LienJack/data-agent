-- ============================================================
-- 10631: Narrow read bridge from Research authority to billing
-- ============================================================

create function app_data_agent.resolve_model_billing_reservation_authority(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  requested_reservation_id uuid,
  requested_run_id uuid,
  requested_principal_id uuid
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  reservation_record record;
begin
  if requested_app_id is distinct from
      nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
    or requested_tenant_id is distinct from
      nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
    or requested_environment is distinct from
      pg_catalog.current_setting('data_agent.environment',true)
  then
    raise exception using errcode = '42501', message = 'MODEL_BILLING_RESEARCH_SCOPE_INVALID';
  end if;
  select reservation.reservation_id,reservation.run_id,reservation.principal_id
  into strict reservation_record
  from app_data_agent.research_resource_reservations as reservation
  where reservation.app_id = requested_app_id
    and reservation.tenant_id = requested_tenant_id
    and reservation.environment = requested_environment
    and reservation.reservation_id = requested_reservation_id
    and reservation.run_id = requested_run_id
    and reservation.principal_id = requested_principal_id
    and reservation.resource_kind = 'MODEL'
    and reservation.state = 'RESERVED'
    and reservation.invocation_id is null
  for share;
  return pg_catalog.jsonb_build_object(
    'reservation_id',reservation_record.reservation_id,
    'run_id',reservation_record.run_id,
    'principal_id',reservation_record.principal_id
  );
exception
  when no_data_found then
    raise exception using errcode = 'P0002', message = 'MODEL_BILLING_RESERVATION_AUTHORITY_MISSING';
end
$function$;

create function app_data_agent.require_model_billing_run_binding(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  requested_run_id uuid,
  requested_principal_id uuid,
  requested_datasource_id uuid,
  requested_conversation_id uuid
)
returns boolean language plpgsql volatile security definer set search_path = '' as $function$
begin
  if requested_app_id is distinct from
      nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
    or requested_tenant_id is distinct from
      nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
    or requested_environment is distinct from
      pg_catalog.current_setting('data_agent.environment',true)
    or requested_principal_id is distinct from
      nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
  then
    raise exception using errcode = '42501', message = 'MODEL_BILLING_RUN_BINDING_SCOPE_INVALID';
  end if;
  if not exists (
    select 1 from app_data_agent.workspace_run_bindings as binding
    where binding.app_id = requested_app_id
      and binding.tenant_id = requested_tenant_id
      and binding.environment = requested_environment
      and binding.run_id = requested_run_id
      and binding.principal_id = requested_principal_id
      and binding.datasource_id = requested_datasource_id
      and binding.conversation_id is not distinct from requested_conversation_id
  ) then
    raise exception using errcode = '42501', message = 'MODEL_BILLING_RUN_BINDING_INVALID';
  end if;
  return true;
end
$function$;

create function app_data_agent.resolve_model_billing_terminal_authority(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  requested_invocation_id uuid,
  requested_reservation_id uuid,
  requested_run_id uuid,
  requested_principal_id uuid,
  requested_usage_record_id uuid
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  invocation_state text := null;
  usage_outcome text := null;
  usage_actual jsonb := null;
  invocation_found boolean := false;
  usage_found boolean := false;
begin
  if requested_app_id is distinct from
      nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
    or requested_tenant_id is distinct from
      nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
    or requested_environment is distinct from
      pg_catalog.current_setting('data_agent.environment',true)
  then
    raise exception using errcode = '42501', message = 'MODEL_BILLING_RESEARCH_SCOPE_INVALID';
  end if;
  select invocation.state
  into invocation_state
  from app_data_agent.research_invocation_commits as invocation
  where invocation.app_id = requested_app_id
    and invocation.tenant_id = requested_tenant_id
    and invocation.environment = requested_environment
    and invocation.invocation_id = requested_invocation_id
    and invocation.reservation_id = requested_reservation_id
    and invocation.run_id = requested_run_id
    and invocation.principal_id = requested_principal_id
    and invocation.resource_kind = 'MODEL'
  for share;
  invocation_found := found;

  if requested_usage_record_id is not null then
    select usage.outcome,usage.actual_json
    into usage_outcome,usage_actual
    from app_data_agent.research_invocation_outcome_usage as usage
    where usage.app_id = requested_app_id
      and usage.tenant_id = requested_tenant_id
      and usage.environment = requested_environment
      and usage.record_id = requested_usage_record_id
      and usage.run_id = requested_run_id
      and usage.principal_id = requested_principal_id
      and usage.invocation_id = requested_invocation_id
      and usage.reservation_id = requested_reservation_id
      and usage.resource_kind = 'MODEL';
    usage_found := found;
  end if;

  return pg_catalog.jsonb_build_object(
    'invocation_found',invocation_found,
    'invocation_state',invocation_state,
    'usage_found',usage_found,
    'usage_outcome',usage_outcome,
    'actual',usage_actual
  );
end
$function$;

create function app_data_agent.list_model_billing_terminal_invocations(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text
)
returns table (invocation_id uuid)
language plpgsql stable security definer set search_path = '' as $function$
begin
  if requested_app_id is distinct from
      nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
    or requested_tenant_id is distinct from
      nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
    or requested_environment is distinct from
      pg_catalog.current_setting('data_agent.environment',true)
  then
    raise exception using errcode = '42501', message = 'MODEL_BILLING_RESEARCH_SCOPE_INVALID';
  end if;
  return query
  select invocation.invocation_id
  from app_data_agent.research_invocation_commits as invocation
  where invocation.app_id = requested_app_id
    and invocation.tenant_id = requested_tenant_id
    and invocation.environment = requested_environment
    and invocation.resource_kind = 'MODEL'
    and invocation.state in ('COMPLETED','FAILED');
end
$function$;
