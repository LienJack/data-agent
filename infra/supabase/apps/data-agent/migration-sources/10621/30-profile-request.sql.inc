-- ============================================================
-- 10621: Attribution Profile Request Lifecycle
-- ============================================================
-- Stores profile request lifecycle entries.
-- Status flow: DRAFT → SUBMITTED → DEDUPED|TRIAGED → DECLINED|LINKED → CLOSED
-- Terminal states: DEDUPED, DECLINED, CLOSED, EXPIRED, WITHDRAWN
-- ============================================================

create table app_data_agent.attribution_profile_request (
  id uuid not null default extensions.gen_random_uuid(),
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  request_id uuid not null default extensions.gen_random_uuid(),
  subject_id text not null,
  requester text not null,
  request_type text not null
    constraint attribution_profile_request_type_check
    check (request_type in ('PROFILE_ACCESS')),
  status text not null
    constraint attribution_profile_request_status_check
    check (status in ('DRAFT', 'SUBMITTED', 'DEDUPED', 'TRIAGED', 'LINKED', 'DECLINED', 'CLOSED', 'EXPIRED', 'WITHDRAWN')),
  request_reason text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint attribution_profile_request_pk
    primary key (id),
  constraint attribution_profile_request_unique
    unique (app_id, tenant_id, environment, request_id)
);

comment on table app_data_agent.attribution_profile_request is
  'Attribution profile request: lifecycle for requesting attribution profile access.';

create index idx_attribution_profile_request_requester
  on app_data_agent.attribution_profile_request (app_id, tenant_id, environment, requester);

create index idx_attribution_profile_request_status
  on app_data_agent.attribution_profile_request (app_id, tenant_id, environment, status);

-- ============================================================
-- RPC: create_profile_request
-- ============================================================
create or replace function app_data_agent.create_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_subject_id text,
  p_requester text,
  p_request_type text,
  p_request_reason text default null
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_request_id uuid;
  v_result jsonb;
begin
  v_request_id := extensions.gen_random_uuid();
  insert into app_data_agent.attribution_profile_request (
    app_id, tenant_id, environment, request_id, subject_id,
    requester, request_type, status, request_reason
  ) values (
    p_app_id, p_tenant_id, p_environment, v_request_id, p_subject_id,
    p_requester, p_request_type, 'DRAFT', p_request_reason
  );
  v_result := jsonb_build_object(
    'request_id', v_request_id,
    'status', 'DRAFT',
    'created_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: submit_profile_request
-- DRAFT → SUBMITTED
-- ============================================================
create or replace function app_data_agent.submit_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_request_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_profile_request as target
  set status = 'SUBMITTED',
      updated_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.request_id = p_request_id
    and target.status = 'DRAFT';

  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_REQUEST_NOT_FOUND_OR_NOT_DRAFT';
  end if;

  v_result := jsonb_build_object(
    'request_id', p_request_id,
    'status', 'SUBMITTED',
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: triage_profile_request
-- SUBMITTED → TRIAGED
-- ============================================================
create or replace function app_data_agent.triage_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_request_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_profile_request as target
  set status = 'TRIAGED',
      updated_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.request_id = p_request_id
    and target.status = 'SUBMITTED';

  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_REQUEST_NOT_FOUND_OR_NOT_SUBMITTED';
  end if;

  v_result := jsonb_build_object(
    'request_id', p_request_id,
    'status', 'TRIAGED',
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: dedupe_profile_request
-- SUBMITTED → DEDUPED
-- ============================================================
create or replace function app_data_agent.dedupe_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_request_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_profile_request as target
  set status = 'DEDUPED',
      updated_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.request_id = p_request_id
    and target.status = 'SUBMITTED';

  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_REQUEST_NOT_FOUND_OR_NOT_SUBMITTED';
  end if;

  v_result := jsonb_build_object(
    'request_id', p_request_id,
    'status', 'DEDUPED',
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: link_profile_request
-- TRIAGED → LINKED
-- ============================================================
create or replace function app_data_agent.link_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_request_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_profile_request as target
  set status = 'LINKED',
      updated_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.request_id = p_request_id
    and target.status = 'TRIAGED';

  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_REQUEST_NOT_FOUND_OR_NOT_TRIAGED';
  end if;

  v_result := jsonb_build_object(
    'request_id', p_request_id,
    'status', 'LINKED',
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: decline_profile_request
-- SUBMITTED|TRIAGED → DECLINED
-- ============================================================
create or replace function app_data_agent.decline_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_request_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_profile_request as target
  set status = 'DECLINED',
      updated_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.request_id = p_request_id
    and target.status in ('SUBMITTED', 'TRIAGED');

  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_REQUEST_NOT_FOUND_OR_NOT_ACTIVE';
  end if;

  v_result := jsonb_build_object(
    'request_id', p_request_id,
    'status', 'DECLINED',
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: close_profile_request
-- LINKED|DECLINED → CLOSED
-- ============================================================
create or replace function app_data_agent.close_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_request_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_profile_request as target
  set status = 'CLOSED',
      updated_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.request_id = p_request_id
    and target.status in ('LINKED', 'DECLINED');

  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_REQUEST_NOT_FOUND_OR_NOT_TERMINABLE';
  end if;

  v_result := jsonb_build_object(
    'request_id', p_request_id,
    'status', 'CLOSED',
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: expire_profile_request
-- DRAFT|SUBMITTED|TRIAGED → EXPIRED
-- ============================================================
create or replace function app_data_agent.expire_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_request_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_profile_request as target
  set status = 'EXPIRED',
      updated_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.request_id = p_request_id
    and target.status in ('DRAFT', 'SUBMITTED', 'TRIAGED');

  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_REQUEST_NOT_FOUND_OR_NOT_EXPIRABLE';
  end if;

  v_result := jsonb_build_object(
    'request_id', p_request_id,
    'status', 'EXPIRED',
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: withdraw_profile_request
-- DRAFT|SUBMITTED → WITHDRAWN
-- ============================================================
create or replace function app_data_agent.withdraw_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_request_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_profile_request as target
  set status = 'WITHDRAWN',
      updated_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.request_id = p_request_id
    and target.status in ('DRAFT', 'SUBMITTED');

  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_REQUEST_NOT_FOUND_OR_NOT_WITHDRAWABLE';
  end if;

  v_result := jsonb_build_object(
    'request_id', p_request_id,
    'status', 'WITHDRAWN',
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: get_profile_request
-- ============================================================
create or replace function app_data_agent.get_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_request_id uuid
) returns jsonb
  language plpgsql
  strict
  stable
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'request_id', r.request_id,
    'subject_id', r.subject_id,
    'requester', r.requester,
    'request_type', r.request_type,
    'status', r.status,
    'request_reason', r.request_reason,
    'created_at', r.created_at,
    'updated_at', r.updated_at
  )
  into v_result
  from app_data_agent.attribution_profile_request as r
  where r.app_id = p_app_id
    and r.tenant_id = p_tenant_id
    and r.environment = p_environment
    and r.request_id = p_request_id;

  return v_result;
end;
$function$;
