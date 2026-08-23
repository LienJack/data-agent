-- ============================================================
-- 10629: Super-admin authority and atomic control-plane commands
-- ============================================================

create function platform.resolve_super_admin_scope(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns table (app_id uuid, environment text)
language plpgsql volatile security definer set search_path = '' as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  perform platform.acquire_lifecycle_shared_lock(deployment.app_id, deployment.environment)
  from platform.deployment_mappings as deployment
  where deployment.deployment_id = requested_deployment_id and deployment.is_active;

  return query
  select deployment.app_id, deployment.environment
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id
   and lifecycle.environment = deployment.environment
  join app_data_agent.app_users as app_user
    on app_user.app_id = deployment.app_id
   and app_user.environment = deployment.environment
   and app_user.principal_id = requested_principal_id
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active
    and lifecycle.lifecycle_state = 'ACTIVE'
    and app_user.status = 'ACTIVE'
    and app_user.system_role = 'SUPER_ADMIN';
  if not found then
    raise exception using errcode = '42501', message = 'SUPER_ADMIN_REQUIRED';
  end if;
end
$function$;

create function platform.list_model_catalog(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns setof app_data_agent.model_catalog_entries
language plpgsql volatile security definer set search_path = '' as $function$
declare scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  return query
  select catalog.* from app_data_agent.model_catalog_entries as catalog
  where catalog.app_id = scope_record.app_id and catalog.environment = scope_record.environment
  order by catalog.provider, catalog.model_id;
end
$function$;

create function platform.list_active_model_catalog(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns setof app_data_agent.model_catalog_entries
language plpgsql stable security definer set search_path = '' as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  return query
  select catalog.*
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id and lifecycle.environment = deployment.environment
  join app_data_agent.app_users as app_user
    on app_user.app_id = deployment.app_id
   and app_user.environment = deployment.environment
   and app_user.principal_id = requested_principal_id
  join app_data_agent.model_catalog_entries as catalog
    on catalog.app_id = deployment.app_id and catalog.environment = deployment.environment
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active
    and lifecycle.lifecycle_state = 'ACTIVE'
    and app_user.status = 'ACTIVE'
    and catalog.status = 'ACTIVE'
  order by catalog.is_system_default desc, catalog.provider, catalog.model_id;
end
$function$;

create function platform.list_model_price_candidates(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns table (candidate jsonb)
language plpgsql volatile security definer set search_path = '' as $function$
declare scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  return query
  select pg_catalog.jsonb_build_object(
    'candidate', pg_catalog.to_jsonb(price_candidate),
    'components', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(component) order by component.kind, component.component_id)
      from app_data_agent.model_price_candidate_components as component
      where component.app_id = price_candidate.app_id
        and component.environment = price_candidate.environment
        and component.candidate_id = price_candidate.candidate_id
    ), '[]'::jsonb)
  )
  from app_data_agent.model_price_candidates as price_candidate
  where price_candidate.app_id = scope_record.app_id
    and price_candidate.environment = scope_record.environment
  order by price_candidate.fetched_at desc, price_candidate.candidate_id;
end
$function$;

create function platform.list_fx_rate_candidates(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns setof app_data_agent.fx_rate_candidates
language plpgsql volatile security definer set search_path = '' as $function$
declare scope_record record;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  return query
  select candidate.* from app_data_agent.fx_rate_candidates as candidate
  where candidate.app_id = scope_record.app_id and candidate.environment = scope_record.environment
  order by candidate.fetched_at desc, candidate.candidate_id;
end
$function$;

create function app_data_agent.model_price_chain_is_complete(
  requested_app_id uuid,
  requested_environment text,
  requested_provider text,
  requested_model_id text,
  requested_credential_ref jsonb
)
returns boolean language sql stable set search_path = '' as $function$
  select
    requested_credential_ref is not null
    and pg_catalog.jsonb_typeof(requested_credential_ref) = 'object'
    and requested_credential_ref ->> 'rotation_state' = 'ACTIVE'
    and exists (
      select 1
      from app_data_agent.model_price_versions as version
      where version.app_id = requested_app_id
        and version.environment = requested_environment
        and version.provider = requested_provider
        and version.model_id = requested_model_id
        and version.effective_from <= pg_catalog.clock_timestamp()
        and (version.effective_to is null or version.effective_to > pg_catalog.clock_timestamp())
        and exists (
          select 1 from app_data_agent.model_price_components as component
          where component.app_id = version.app_id
            and component.environment = version.environment
            and component.price_version_id = version.price_version_id
        )
        and not exists (
          select 1 from app_data_agent.model_price_components as component
          where component.app_id = version.app_id
            and component.environment = version.environment
            and component.price_version_id = version.price_version_id
            and component.currency <> 'CNY'
            and not exists (
              select 1 from app_data_agent.fx_rate_versions as fx
              where fx.app_id = version.app_id
                and fx.environment = version.environment
                and fx.base_currency = component.currency
                and fx.quote_currency = 'CNY'
                and fx.effective_from <= pg_catalog.clock_timestamp()
                and (fx.effective_to is null or fx.effective_to > pg_catalog.clock_timestamp())
            )
        )
    );
$function$;

create function app_data_agent.apply_model_catalog_command(
  requested_deployment_id uuid,
  requested_principal_id uuid,
  command jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  existing_operation app_data_agent.pricing_control_operations%rowtype;
  existing_catalog app_data_agent.model_catalog_entries%rowtype;
  result_payload jsonb;
  snapshot_payload jsonb;
  input_hash text := platform.canonical_sha256(command);
  requested_version bigint;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  if command ->> 'schema_version' not in ('model-catalog-upsert@1.0.0','model-catalog-status@1.0.0') then
    raise exception using errcode = '22023', message = 'MODEL_CATALOG_COMMAND_INVALID';
  end if;
  select * into existing_operation
  from app_data_agent.pricing_control_operations as operation
  where operation.app_id = scope_record.app_id
    and operation.environment = scope_record.environment
    and operation.actor_principal_id = requested_principal_id
    and operation.idempotency_key = command ->> 'idempotency_key';
  if found then
    if existing_operation.input_hash <> input_hash then
      raise exception using errcode = '23505', message = 'PRICING_OPERATION_CONFLICT';
    end if;
    return existing_operation.result_payload;
  end if;

  select * into existing_catalog
  from app_data_agent.model_catalog_entries as catalog
  where catalog.app_id = scope_record.app_id
    and catalog.environment = scope_record.environment
    and catalog.model_profile_id = (command ->> 'model_profile_id')::uuid
  for update;

  if command ->> 'schema_version' = 'model-catalog-upsert@1.0.0' then
    requested_version := (command ->> 'expected_config_version')::bigint;
    if (not found and requested_version <> 0)
      or (found and existing_catalog.config_version <> requested_version)
    then
      raise exception using errcode = '40001', message = 'MODEL_CONFIG_VERSION_CONFLICT';
    end if;
    if command ->> 'status' = 'ACTIVE' and not app_data_agent.model_price_chain_is_complete(
      scope_record.app_id, scope_record.environment, command ->> 'provider', command ->> 'model_id',
      nullif(command -> 'credential_ref', 'null'::jsonb)
    ) then
      raise exception using errcode = '55000', message = 'MODEL_PRICE_CHAIN_INCOMPLETE';
    end if;
    if (command ->> 'is_system_default')::boolean then
      update app_data_agent.model_catalog_entries set is_system_default = false,
        updated_at = pg_catalog.clock_timestamp()
      where app_id = scope_record.app_id and environment = scope_record.environment
        and is_system_default;
    end if;
    insert into app_data_agent.model_catalog_entries (
      app_id, environment, model_profile_id, provider, model_id, display_name, base_url,
      capabilities, credential_ref, status, config_version, is_system_default, created_by
    ) values (
      scope_record.app_id, scope_record.environment, (command ->> 'model_profile_id')::uuid,
      command ->> 'provider', command ->> 'model_id', command ->> 'display_name',
      command ->> 'base_url', command -> 'capabilities',
      nullif(command -> 'credential_ref', 'null'::jsonb),
      command ->> 'status', requested_version + 1, (command ->> 'is_system_default')::boolean,
      requested_principal_id
    ) on conflict (app_id, environment, model_profile_id) do update set
      provider = excluded.provider, model_id = excluded.model_id,
      display_name = excluded.display_name, base_url = excluded.base_url,
      capabilities = excluded.capabilities, credential_ref = excluded.credential_ref,
      status = excluded.status, config_version = excluded.config_version,
      is_system_default = excluded.is_system_default, updated_at = pg_catalog.clock_timestamp();
  else
    if not found then
      raise exception using errcode = 'P0002', message = 'MODEL_PROFILE_NOT_FOUND';
    end if;
    requested_version := (command ->> 'expected_config_version')::bigint;
    if existing_catalog.config_version <> requested_version then
      raise exception using errcode = '40001', message = 'MODEL_CONFIG_VERSION_CONFLICT';
    end if;
    if command ->> 'status' = 'ACTIVE' and not app_data_agent.model_price_chain_is_complete(
      scope_record.app_id, scope_record.environment, existing_catalog.provider,
      existing_catalog.model_id, existing_catalog.credential_ref
    ) then
      raise exception using errcode = '55000', message = 'MODEL_PRICE_CHAIN_INCOMPLETE';
    end if;
    update app_data_agent.model_catalog_entries set
      status = command ->> 'status',
      is_system_default = case when command ->> 'status' = 'ACTIVE' then is_system_default else false end,
      config_version = config_version + 1,
      updated_at = pg_catalog.clock_timestamp()
    where app_id = scope_record.app_id and environment = scope_record.environment
      and model_profile_id = existing_catalog.model_profile_id;
  end if;

  select pg_catalog.to_jsonb(catalog) into result_payload
  from app_data_agent.model_catalog_entries as catalog
  where catalog.app_id = scope_record.app_id and catalog.environment = scope_record.environment
    and catalog.model_profile_id = (command ->> 'model_profile_id')::uuid;
  snapshot_payload := result_payload - 'credential_ref';
  if result_payload -> 'credential_ref' is not null
    and result_payload -> 'credential_ref' <> 'null'::jsonb
  then
    snapshot_payload := snapshot_payload || pg_catalog.jsonb_build_object(
      'secret_refs', pg_catalog.jsonb_build_array(
        'secretref:' || (result_payload #>> '{credential_ref,secret_ref_id}')
      ),
      'reference_version', (result_payload #>> '{credential_ref,secret_version}')::bigint,
      'rotation_state', result_payload #>> '{credential_ref,rotation_state}'
    );
  end if;
  insert into app_data_agent.model_config_versions (
    app_id, environment, model_profile_id, config_version, snapshot, actor_principal_id
  ) values (
    scope_record.app_id, scope_record.environment, (command ->> 'model_profile_id')::uuid,
    (result_payload ->> 'config_version')::bigint, snapshot_payload, requested_principal_id
  );
  insert into app_data_agent.pricing_control_operations (
    app_id, environment, operation_id, actor_principal_id, idempotency_key,
    operation_kind, input_hash, result_payload
  ) values (
    scope_record.app_id, scope_record.environment, (command ->> 'operation_id')::uuid,
    requested_principal_id, command ->> 'idempotency_key',
    case when command ->> 'schema_version' = 'model-catalog-upsert@1.0.0'
      then 'UPSERT_MODEL' else 'SET_MODEL_STATUS' end,
    input_hash, result_payload
  );
  insert into app_data_agent.pricing_audit_log (
    app_id, environment, operation_id, actor_principal_id, action, resource_type,
    resource_id, reason, details
  ) values (
    scope_record.app_id, scope_record.environment, (command ->> 'operation_id')::uuid,
    requested_principal_id, command ->> 'schema_version', 'MODEL_PROFILE',
    command ->> 'model_profile_id', 'model catalog command', result_payload
  );
  return result_payload;
end
$function$;

create function app_data_agent.submit_pricing_sync(
  requested_deployment_id uuid,
  requested_principal_id uuid,
  submission jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  existing_operation app_data_agent.pricing_sync_operations%rowtype;
  candidate jsonb;
  component jsonb;
  actual_candidate_id uuid;
  actual_candidate_ids jsonb := '[]'::jsonb;
  operation_result jsonb;
  input_hash text := platform.canonical_sha256(submission);
  source_kind text;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  source_kind := case submission ->> 'schema_version'
    when 'model-price-sync-submit@1.0.0' then 'MODEL_PRICE'
    when 'fx-rate-sync-submit@1.0.0' then 'FX_RATE'
    else null end;
  if source_kind is null
    or pg_catalog.octet_length(submission ->> 'raw_evidence') > 65536
    or pg_catalog.jsonb_typeof(submission -> 'candidates') <> 'array'
  then
    raise exception using errcode = '22023', message = 'PRICING_SYNC_INVALID';
  end if;
  select * into existing_operation
  from app_data_agent.pricing_sync_operations as operation
  where operation.app_id = scope_record.app_id
    and operation.environment = scope_record.environment
    and operation.operation_id = (submission ->> 'operation_id')::uuid;
  if found then
    if existing_operation.input_hash <> input_hash then
      raise exception using errcode = '23505', message = 'PRICING_SYNC_OPERATION_CONFLICT';
    end if;
    return existing_operation.result_payload;
  end if;

  insert into app_data_agent.pricing_sync_operations (
    app_id, environment, operation_id, actor_principal_id, source_kind, source_adapter,
    source_url, input_hash, evidence_hash, parser_version, status, fetched_at,
    raw_evidence, result_payload
  ) values (
    scope_record.app_id, scope_record.environment, (submission ->> 'operation_id')::uuid,
    requested_principal_id, source_kind, submission ->> 'source_adapter',
    submission ->> 'source_url', input_hash, submission ->> 'evidence_hash',
    submission ->> 'parser_version', 'SUCCEEDED', (submission ->> 'fetched_at')::timestamptz,
    submission ->> 'raw_evidence', '{}'::jsonb
  );

  for candidate in select value from pg_catalog.jsonb_array_elements(submission -> 'candidates') loop
    if source_kind = 'MODEL_PRICE' then
      insert into app_data_agent.model_price_candidates (
        app_id, environment, candidate_id, provider, model_id, source_url, evidence_hash,
        parser_version, fetched_at, risk, source_operation_id
      ) values (
        scope_record.app_id, scope_record.environment, (candidate ->> 'candidate_id')::uuid,
        candidate ->> 'provider', candidate ->> 'model_id', submission ->> 'source_url',
        submission ->> 'evidence_hash', submission ->> 'parser_version',
        (submission ->> 'fetched_at')::timestamptz, candidate ->> 'risk',
        (submission ->> 'operation_id')::uuid
      ) on conflict (app_id, environment, provider, model_id, evidence_hash) do nothing;
      select price_candidate.candidate_id into strict actual_candidate_id
      from app_data_agent.model_price_candidates as price_candidate
      where price_candidate.app_id = scope_record.app_id
        and price_candidate.environment = scope_record.environment
        and price_candidate.provider = candidate ->> 'provider'
        and price_candidate.model_id = candidate ->> 'model_id'
        and price_candidate.evidence_hash = submission ->> 'evidence_hash';
      for component in select value from pg_catalog.jsonb_array_elements(candidate -> 'components') loop
        insert into app_data_agent.model_price_candidate_components (
          app_id, environment, candidate_id, component_id, kind, unit, unit_price,
          currency, tier_min_inclusive, tier_max_exclusive
        ) values (
          scope_record.app_id, scope_record.environment, actual_candidate_id,
          (component ->> 'component_id')::uuid, component ->> 'kind', component ->> 'unit',
          (component ->> 'unit_price')::numeric, component ->> 'currency',
          nullif(component ->> 'tier_min_inclusive', '')::numeric,
          nullif(component ->> 'tier_max_exclusive', '')::numeric
        ) on conflict do nothing;
      end loop;
    else
      insert into app_data_agent.fx_rate_candidates (
        app_id, environment, candidate_id, base_currency, quote_currency, rate,
        official_date, source_url, evidence_hash, parser_version, fetched_at, source_operation_id
      ) values (
        scope_record.app_id, scope_record.environment, (candidate ->> 'candidate_id')::uuid,
        candidate ->> 'base_currency', candidate ->> 'quote_currency',
        (candidate ->> 'rate')::numeric, (candidate ->> 'official_date')::date,
        submission ->> 'source_url', submission ->> 'evidence_hash',
        submission ->> 'parser_version', (submission ->> 'fetched_at')::timestamptz,
        (submission ->> 'operation_id')::uuid
      ) on conflict (app_id, environment, base_currency, quote_currency, official_date, evidence_hash)
        do nothing;
      select fx_candidate.candidate_id into strict actual_candidate_id
      from app_data_agent.fx_rate_candidates as fx_candidate
      where fx_candidate.app_id = scope_record.app_id
        and fx_candidate.environment = scope_record.environment
        and fx_candidate.base_currency = candidate ->> 'base_currency'
        and fx_candidate.quote_currency = candidate ->> 'quote_currency'
        and fx_candidate.official_date = (candidate ->> 'official_date')::date
        and fx_candidate.evidence_hash = submission ->> 'evidence_hash';
    end if;
    actual_candidate_ids := actual_candidate_ids || pg_catalog.jsonb_build_array(actual_candidate_id);
  end loop;
  operation_result := pg_catalog.jsonb_build_object(
    'operation_id', submission ->> 'operation_id',
    'source_kind', source_kind,
    'candidate_ids', actual_candidate_ids,
    'status', 'SUCCEEDED'
  );
  update app_data_agent.pricing_sync_operations set result_payload = operation_result
  where app_id = scope_record.app_id and environment = scope_record.environment
    and operation_id = (submission ->> 'operation_id')::uuid;
  return operation_result;
end
$function$;

create function app_data_agent.record_pricing_sync_failure(
  requested_deployment_id uuid,
  requested_principal_id uuid,
  failure jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  existing_operation app_data_agent.pricing_sync_operations%rowtype;
  result_payload jsonb;
  input_hash text := platform.canonical_sha256(failure);
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  if pg_catalog.octet_length(failure ->> 'raw_evidence') > 65536 then
    raise exception using errcode = '22023', message = 'PRICING_SYNC_EVIDENCE_TOO_LARGE';
  end if;
  select * into existing_operation
  from app_data_agent.pricing_sync_operations as operation
  where operation.app_id = scope_record.app_id
    and operation.environment = scope_record.environment
    and operation.operation_id = (failure ->> 'operation_id')::uuid;
  if found then
    if existing_operation.input_hash <> input_hash then
      raise exception using errcode = '23505', message = 'PRICING_SYNC_OPERATION_CONFLICT';
    end if;
    return existing_operation.result_payload;
  end if;
  result_payload := pg_catalog.jsonb_build_object(
    'operation_id', failure ->> 'operation_id', 'status', 'FAILED',
    'error_code', failure ->> 'error_code'
  );
  insert into app_data_agent.pricing_sync_operations (
    app_id, environment, operation_id, actor_principal_id, source_kind, source_adapter,
    source_url, input_hash, evidence_hash, parser_version, status, fetched_at,
    raw_evidence, result_payload, error_code
  ) values (
    scope_record.app_id, scope_record.environment, (failure ->> 'operation_id')::uuid,
    requested_principal_id, failure ->> 'source_kind', failure ->> 'source_adapter',
    failure ->> 'source_url', input_hash, null,
    failure ->> 'parser_version', 'FAILED', (failure ->> 'fetched_at')::timestamptz,
    coalesce(failure ->> 'raw_evidence', ''), result_payload, failure ->> 'error_code'
  );
  return result_payload;
end
$function$;

create function app_data_agent.decide_pricing_candidate(
  requested_deployment_id uuid,
  requested_principal_id uuid,
  candidate_kind text,
  decision jsonb
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  scope_record record;
  existing_operation app_data_agent.pricing_control_operations%rowtype;
  price_candidate app_data_agent.model_price_candidates%rowtype;
  fx_candidate app_data_agent.fx_rate_candidates%rowtype;
  result_payload jsonb;
  input_hash text := platform.canonical_sha256(pg_catalog.jsonb_build_object(
    'candidate_kind', candidate_kind, 'decision', decision
  ));
  new_version_id uuid := pg_catalog.gen_random_uuid();
  requested_effective_from timestamptz;
  previous_effective_from timestamptz;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(requested_deployment_id, requested_principal_id);
  if candidate_kind not in ('MODEL_PRICE','FX_RATE')
    or decision ->> 'schema_version' <> 'pricing-candidate-decision@1.0.0'
    or decision ->> 'decision' not in ('APPROVE','REJECT')
  then
    raise exception using errcode = '22023', message = 'PRICING_DECISION_INVALID';
  end if;
  if decision ->> 'decision' = 'APPROVE' and decision ->> 'effective_from' is null then
    raise exception using errcode = '22023', message = 'PRICING_EFFECTIVE_FROM_REQUIRED';
  end if;
  select * into existing_operation
  from app_data_agent.pricing_control_operations as operation
  where operation.app_id = scope_record.app_id
    and operation.environment = scope_record.environment
    and operation.actor_principal_id = requested_principal_id
    and operation.idempotency_key = decision ->> 'idempotency_key';
  if found then
    if existing_operation.input_hash <> input_hash then
      raise exception using errcode = '23505', message = 'PRICING_OPERATION_CONFLICT';
    end if;
    return existing_operation.result_payload;
  end if;
  insert into app_data_agent.pricing_control_state (app_id, environment)
  values (scope_record.app_id, scope_record.environment) on conflict do nothing;
  perform 1 from app_data_agent.pricing_control_state as state
  where state.app_id = scope_record.app_id and state.environment = scope_record.environment
  for update;

  if candidate_kind = 'MODEL_PRICE' then
    select * into strict price_candidate
    from app_data_agent.model_price_candidates as candidate
    where candidate.app_id = scope_record.app_id
      and candidate.environment = scope_record.environment
      and candidate.candidate_id = (decision ->> 'candidate_id')::uuid
    for update;
    if price_candidate.status <> 'PENDING_REVIEW' then
      raise exception using errcode = '55000', message = 'PRICING_CANDIDATE_ALREADY_DECIDED';
    end if;
    if decision ->> 'decision' = 'APPROVE' then
      requested_effective_from := (decision ->> 'effective_from')::timestamptz;
      select version.effective_from into previous_effective_from
      from app_data_agent.model_price_versions as version
      where version.app_id = scope_record.app_id and version.environment = scope_record.environment
        and version.provider = price_candidate.provider and version.model_id = price_candidate.model_id
        and version.effective_to is null for update;
      if found and previous_effective_from >= requested_effective_from then
        raise exception using errcode = '22023', message = 'PRICING_EFFECTIVE_INTERVAL_INVALID';
      end if;
      perform pg_catalog.set_config('data_agent.pricing_activation', 'on', true);
      update app_data_agent.model_price_versions set effective_to = requested_effective_from
      where app_id = scope_record.app_id and environment = scope_record.environment
        and provider = price_candidate.provider and model_id = price_candidate.model_id
        and effective_to is null;
      insert into app_data_agent.model_price_versions (
        app_id, environment, price_version_id, source_candidate_id, provider, model_id,
        approved_by, approved_at, effective_from
      ) values (
        scope_record.app_id, scope_record.environment, new_version_id,
        price_candidate.candidate_id, price_candidate.provider, price_candidate.model_id,
        requested_principal_id, pg_catalog.clock_timestamp(), requested_effective_from
      );
      insert into app_data_agent.model_price_components (
        app_id, environment, price_version_id, component_id, kind, unit, unit_price,
        currency, tier_min_inclusive, tier_max_exclusive
      ) select component.app_id, component.environment, new_version_id, component.component_id,
        component.kind, component.unit, component.unit_price, component.currency,
        component.tier_min_inclusive, component.tier_max_exclusive
      from app_data_agent.model_price_candidate_components as component
      where component.app_id = price_candidate.app_id
        and component.environment = price_candidate.environment
        and component.candidate_id = price_candidate.candidate_id;
    end if;
    update app_data_agent.model_price_candidates set
      status = case when decision ->> 'decision' = 'APPROVE' then 'APPROVED' else 'REJECTED' end,
      reviewed_by = requested_principal_id, reviewed_at = pg_catalog.clock_timestamp(),
      review_reason = decision ->> 'reason'
    where app_id = price_candidate.app_id and environment = price_candidate.environment
      and candidate_id = price_candidate.candidate_id;
  else
    select * into strict fx_candidate
    from app_data_agent.fx_rate_candidates as candidate
    where candidate.app_id = scope_record.app_id
      and candidate.environment = scope_record.environment
      and candidate.candidate_id = (decision ->> 'candidate_id')::uuid
    for update;
    if fx_candidate.status <> 'PENDING_REVIEW' then
      raise exception using errcode = '55000', message = 'PRICING_CANDIDATE_ALREADY_DECIDED';
    end if;
    if decision ->> 'decision' = 'APPROVE' then
      requested_effective_from := (decision ->> 'effective_from')::timestamptz;
      select version.effective_from into previous_effective_from
      from app_data_agent.fx_rate_versions as version
      where version.app_id = scope_record.app_id and version.environment = scope_record.environment
        and version.base_currency = fx_candidate.base_currency
        and version.quote_currency = fx_candidate.quote_currency
        and version.effective_to is null for update;
      if found and previous_effective_from >= requested_effective_from then
        raise exception using errcode = '22023', message = 'PRICING_EFFECTIVE_INTERVAL_INVALID';
      end if;
      perform pg_catalog.set_config('data_agent.pricing_activation', 'on', true);
      update app_data_agent.fx_rate_versions set effective_to = requested_effective_from
      where app_id = scope_record.app_id and environment = scope_record.environment
        and base_currency = fx_candidate.base_currency
        and quote_currency = fx_candidate.quote_currency and effective_to is null;
      insert into app_data_agent.fx_rate_versions (
        app_id, environment, fx_version_id, source_candidate_id, base_currency,
        quote_currency, rate, approved_by, approved_at, effective_from
      ) values (
        scope_record.app_id, scope_record.environment, new_version_id,
        fx_candidate.candidate_id, fx_candidate.base_currency, fx_candidate.quote_currency,
        fx_candidate.rate, requested_principal_id, pg_catalog.clock_timestamp(), requested_effective_from
      );
    end if;
    update app_data_agent.fx_rate_candidates set
      status = case when decision ->> 'decision' = 'APPROVE' then 'APPROVED' else 'REJECTED' end,
      reviewed_by = requested_principal_id, reviewed_at = pg_catalog.clock_timestamp(),
      review_reason = decision ->> 'reason'
    where app_id = fx_candidate.app_id and environment = fx_candidate.environment
      and candidate_id = fx_candidate.candidate_id;
  end if;

  if decision ->> 'decision' = 'APPROVE' then
    update app_data_agent.pricing_control_state set
      pricing_epoch = pricing_epoch + 1, updated_at = pg_catalog.clock_timestamp()
    where app_id = scope_record.app_id and environment = scope_record.environment;
  end if;
  result_payload := pg_catalog.jsonb_build_object(
    'candidate_kind', candidate_kind, 'candidate_id', decision ->> 'candidate_id',
    'decision', decision ->> 'decision',
    'version_id', case when decision ->> 'decision' = 'APPROVE' then new_version_id end
  );
  insert into app_data_agent.pricing_control_operations (
    app_id, environment, operation_id, actor_principal_id, idempotency_key,
    operation_kind, input_hash, result_payload
  ) values (
    scope_record.app_id, scope_record.environment, (decision ->> 'operation_id')::uuid,
    requested_principal_id, decision ->> 'idempotency_key',
    case when candidate_kind = 'MODEL_PRICE' then 'DECIDE_PRICE' else 'DECIDE_FX' end,
    input_hash, result_payload
  );
  insert into app_data_agent.pricing_audit_log (
    app_id, environment, operation_id, actor_principal_id, action, resource_type,
    resource_id, reason, details
  ) values (
    scope_record.app_id, scope_record.environment, (decision ->> 'operation_id')::uuid,
    requested_principal_id, decision ->> 'decision', candidate_kind,
    decision ->> 'candidate_id', decision ->> 'reason', result_payload
  );
  return result_payload;
end
$function$;
