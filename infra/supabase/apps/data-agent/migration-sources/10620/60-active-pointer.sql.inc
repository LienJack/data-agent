-- ============================================================
-- 10620: Attribution Active Pointer
-- ============================================================
-- Tracks the current active version for each attribution resource type.
-- Supports pointer_type enum: OWNER_MAP, POLICY, SIGNER_ASSIGNMENT, VERIFICATION_KEY.
-- ============================================================

do $active_pointer_types$
begin
  if not exists (
    select 1 from pg_catalog.pg_type as typ
    join pg_catalog.pg_namespace as ns on ns.oid = typ.typnamespace
    where ns.nspname = 'app_data_agent'
      and typ.typname = 'attribution_pointer_type'
  ) then
    create type app_data_agent.attribution_pointer_type as enum (
      'OWNER_MAP',
      'POLICY',
      'SIGNER_ASSIGNMENT',
      'VERIFICATION_KEY'
    );
  end if;
end
$active_pointer_types$;

create table app_data_agent.attribution_active_pointer (
  id uuid not null default extensions.gen_random_uuid(),
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  pointer_type app_data_agent.attribution_pointer_type not null,
  active_id uuid not null,
  status text not null default 'ACTIVE'
    constraint attribution_active_pointer_status_check
    check (status in ('ACTIVE', 'FROZEN')),
  version integer not null default 1,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint attribution_active_pointer_pk
    primary key (id),
  constraint attribution_active_pointer_unique
    unique (app_id, tenant_id, environment, pointer_type)
);

comment on table app_data_agent.attribution_active_pointer is
  'Active pointer: tracks the current active version for each attribution resource type (OWNER_MAP, POLICY, SIGNER_ASSIGNMENT, VERIFICATION_KEY).';

-- ============================================================
-- RPC: get_active_pointer
-- ============================================================
create or replace function app_data_agent.get_active_pointer(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_pointer_type app_data_agent.attribution_pointer_type
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'pointer_type', p_pointer_type,
    'active_id', pointer.active_id,
    'status', pointer.status,
    'version', pointer.version,
    'updated_at', pointer.updated_at
  )
  into v_result
  from app_data_agent.attribution_active_pointer as pointer
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.pointer_type = p_pointer_type;

  if not found then
    return jsonb_build_object(
      'pointer_type', p_pointer_type,
      'active_id', null::uuid,
      'status', 'UNSET',
      'version', 0
    );
  end if;

  return v_result;
end;
$function$;

-- ============================================================
-- RPC: set_active_pointer
-- ============================================================
create or replace function app_data_agent.set_active_pointer(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_pointer_type app_data_agent.attribution_pointer_type,
  p_active_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
  v_version integer;
begin
  insert into app_data_agent.attribution_active_pointer as target (
    app_id, tenant_id, environment, pointer_type, active_id, version
  ) values (
    p_app_id, p_tenant_id, p_environment, p_pointer_type, p_active_id, 1
  )
  on conflict (app_id, tenant_id, environment, pointer_type)
  do update set
    active_id = p_active_id,
    version = target.version + 1,
    updated_at = pg_catalog.clock_timestamp()
  returning version into v_version;

  v_result := jsonb_build_object(
    'pointer_type', p_pointer_type,
    'active_id', p_active_id,
    'version', v_version,
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;
