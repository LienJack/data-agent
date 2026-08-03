-- ============================================================
-- 10600: Resolver/Provisioner RPCs
-- ============================================================

create function app_data_agent.grant_issue(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_grant_id uuid;
  v_principal_id uuid;
  v_ttl_seconds integer;
  v_canonical_response_hash text;
  v_readiness record;
  v_now timestamptz;
  v_expires_at timestamptz;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_grant_id := (cmd #>> '{grant_id}')::uuid;
    v_principal_id := (cmd #>> '{principal_id}')::uuid;
    v_ttl_seconds := (cmd #>> '{ttl_seconds}')::integer;
    v_canonical_response_hash := cmd #>> '{canonical_response_hash}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_grant_id is null
    or v_principal_id is null or v_ttl_seconds is null
    or v_canonical_response_hash is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Verify current readiness is CURRENT
  select readiness.*
  into v_readiness
  from app_data_agent.research_current_readiness as readiness
  where readiness.app_id = s_app_id
    and readiness.tenant_id = s_tenant_id
    and readiness.environment = s_environment
    and readiness.run_id = v_run_id
  for share;
  if not found or v_readiness.state <> 'CURRENT' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'READINESS_NOT_CURRENT'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_expires_at := v_now + (v_ttl_seconds || ' seconds')::interval;

  insert into app_data_agent.research_readiness_grants (
    app_id, tenant_id, environment, run_id, grant_id,
    readiness_id, principal_id, state,
    canonical_response_hash, expires_at,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_grant_id,
    v_readiness.readiness_id, v_principal_id, 'ISSUED',
    v_canonical_response_hash, v_expires_at,
    v_now
  );

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'grant_id', v_grant_id,
    'state', 'ISSUED',
    'expires_at', v_expires_at,
    'committed_at', v_now
  ));
end;
$$;

-- ============================================================
-- 5. grant_consume: Consume a Grant (mark as consumed)
-- ============================================================

create function app_data_agent.grant_consume(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  v_grant_id uuid;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_grant record;
  v_readiness record;
  v_now timestamptz;
begin
  if input_json is null or jsonb_typeof(input_json) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (input_json #>> '{scope,app_id}')::uuid;
    s_tenant_id := (input_json #>> '{scope,tenant_id}')::uuid;
    s_environment := input_json #>> '{scope,environment}';
    v_run_id := (input_json #>> '{run_id}')::uuid;
    v_grant_id := (input_json #>> '{grant_id}')::uuid;
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_grant_id is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  select g.*
  into v_grant
  from app_data_agent.research_readiness_grants as g
  where g.app_id = s_app_id
    and g.tenant_id = s_tenant_id
    and g.environment = s_environment
    and g.run_id = v_run_id
    and g.grant_id = v_grant_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'GRANT_NOT_FOUND'));
  end if;

  if v_grant.state <> 'ISSUED' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'GRANT_NOT_ISSUED'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_now >= v_grant.expires_at then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'GRANT_EXPIRED'));
  end if;

  -- Reverify current readiness
  select readiness.*
  into v_readiness
  from app_data_agent.research_current_readiness as readiness
  where readiness.app_id = s_app_id
    and readiness.tenant_id = s_tenant_id
    and readiness.environment = s_environment
    and readiness.run_id = v_run_id
  for share;
  if not found or v_readiness.state <> 'CURRENT' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'READINESS_NOT_CURRENT'));
  end if;

  update app_data_agent.research_readiness_grants as g
  set state = 'CONSUMED',
      responded_at = v_now
  where g.app_id = s_app_id
    and g.tenant_id = s_tenant_id
    and g.environment = s_environment
    and g.run_id = v_run_id
    and g.grant_id = v_grant_id
    and g.state = 'ISSUED';

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'grant_id', v_grant_id,
    'state', 'CONSUMED',
    'committed_at', v_now
  ));
end;
$$;

-- ============================================================
-- 6. grant_response: Authorize a Grant Response
-- ============================================================

create function app_data_agent.grant_response(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  v_grant_id uuid;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_grant record;
  v_readiness record;
  v_now timestamptz;
begin
  if input_json is null or jsonb_typeof(input_json) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (input_json #>> '{scope,app_id}')::uuid;
    s_tenant_id := (input_json #>> '{scope,tenant_id}')::uuid;
    s_environment := input_json #>> '{scope,environment}';
    v_run_id := (input_json #>> '{run_id}')::uuid;
    v_grant_id := (input_json #>> '{grant_id}')::uuid;
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_grant_id is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  select g.*
  into v_grant
  from app_data_agent.research_readiness_grants as g
  where g.app_id = s_app_id
    and g.tenant_id = s_tenant_id
    and g.environment = s_environment
    and g.run_id = v_run_id
    and g.grant_id = v_grant_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'GRANT_NOT_FOUND'));
  end if;

  if v_grant.state <> 'CONSUMED' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'GRANT_NOT_CONSUMED'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_now >= v_grant.expires_at then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'GRANT_EXPIRED'));
  end if;

  -- Reverify current readiness
  select readiness.*
  into v_readiness
  from app_data_agent.research_current_readiness as readiness
  where readiness.app_id = s_app_id
    and readiness.tenant_id = s_tenant_id
    and readiness.environment = s_environment
    and readiness.run_id = v_run_id
  for share;
  if not found or v_readiness.state <> 'CURRENT' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'READINESS_NOT_CURRENT'));
  end if;

  update app_data_agent.research_readiness_grants as g
  set state = 'RESPONDED',
      responded_at = v_now
  where g.app_id = s_app_id
    and g.tenant_id = s_tenant_id
    and g.environment = s_environment
    and g.run_id = v_run_id
    and g.grant_id = v_grant_id
    and g.state = 'CONSUMED';

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'grant_id', v_grant_id,
    'state', 'RESPONDED',
    'committed_at', v_now
  ));
end;
$$;

-- ============================================================
-- 7. grant_expire: Expire a Grant (ISSUED|CONSUMED → EXPIRED)
-- ============================================================

create function app_data_agent.grant_expire(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  v_grant_id uuid;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_now timestamptz;
begin
  if input_json is null or jsonb_typeof(input_json) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (input_json #>> '{scope,app_id}')::uuid;
    s_tenant_id := (input_json #>> '{scope,tenant_id}')::uuid;
    s_environment := input_json #>> '{scope,environment}';
    v_run_id := (input_json #>> '{run_id}')::uuid;
    v_grant_id := (input_json #>> '{grant_id}')::uuid;
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_grant_id is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  v_now := pg_catalog.clock_timestamp();

  update app_data_agent.research_readiness_grants as g
  set state = 'EXPIRED',
      expired_at = v_now
  where g.app_id = s_app_id
    and g.tenant_id = s_tenant_id
    and g.environment = s_environment
    and g.run_id = v_run_id
    and g.grant_id = v_grant_id
    and g.state in ('ISSUED', 'CONSUMED')
    and g.expires_at <= v_now;

  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'GRANT_NOT_FOUND_OR_ACTIVE'));
  end if;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'grant_id', v_grant_id,
    'state', 'EXPIRED',
    'committed_at', v_now
  ));
end;
$$;
