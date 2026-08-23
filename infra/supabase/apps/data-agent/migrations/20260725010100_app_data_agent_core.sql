begin;

select platform.register_app(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000da02'::uuid,
  'data-agent',
  'Data Agent',
  'app_data_agent',
  'data_agent__',
  'postgres'
);

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010100_app_data_agent_core',
  'sha256:dadb5c8866da9af6014844c1e0c1df738640cef1da00ae2584e7528df533ab00'
);

create schema app_data_agent authorization postgres;

revoke all privileges on schema app_data_agent
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;

create or replace function app_data_agent.contains_potential_plaintext_secret(
  requested_value jsonb,
  requested_key text default ''
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  normalized_key text := pg_catalog.lower(coalesce(requested_key, ''));
  value_kind text;
  text_value text;
  child_key text;
  child_value jsonb;
  sensitive_key boolean;
  secret_reference_key boolean;
  secret_reference_collection_key boolean;
  non_credential_token_key boolean;
begin
  if requested_value is null then
    return false;
  end if;

  sensitive_key := normalized_key ~
    '(^|[_-])(secret|client[_-]?secret|consumer[_-]?secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|provider[_-]?token|password|passwd|credential|authorization|cookie|api[_-]?key|private[_-]?key|access[_-]?key[_-]?id|secret[_-]?access[_-]?key)($|[_-])';
  secret_reference_key := normalized_key ~
    '(^|[_-])(secret|credential)[_-]?refs?$';
  secret_reference_collection_key := normalized_key ~
    '(^|[_-])(secret|credential)[_-]?refs$';
  non_credential_token_key := normalized_key ~
    '^(snapshot|fencing)_token$';
  value_kind := pg_catalog.jsonb_typeof(requested_value);
  if non_credential_token_key then
    if value_kind = 'null' then
      return false;
    end if;
    if value_kind <> 'string' then
      return true;
    end if;
    text_value := requested_value #>> '{}';
    return text_value ~*
      '(^bearer[[:space:]]+[^[:space:]]+|^sk-[A-Za-z0-9_-]{12,}|^gh[pousr]_[A-Za-z0-9_]{20,}|^glpat-[A-Za-z0-9_-]{20,}|^xox[baprs]-[A-Za-z0-9-]{10,}|^(AKIA|ASIA)[A-Z0-9]{16}|^AIza[A-Za-z0-9_-]{20,}|^eyJ[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}|^-----BEGIN [A-Z ]*PRIVATE KEY-----|^([a-z][a-z0-9+.-]*:)+//[^/[:space:]:@]*:[^@[:space:]]+@|(password|token|secret|api[_-]?key|authorization)[[:space:]]*[:=][[:space:]]*[^[:space:]]+)';
  end if;
  if sensitive_key and not secret_reference_key then
    return true;
  end if;

  if secret_reference_key
    and value_kind <> 'string'
    and not (secret_reference_collection_key and value_kind = 'array')
  then
    return true;
  end if;
  if value_kind = 'string' then
    text_value := requested_value #>> '{}';
    if secret_reference_key then
      return text_value !~*
        '^secretref:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
    end if;
    return text_value ~*
      '(^bearer[[:space:]]+[^[:space:]]+|^sk-[A-Za-z0-9_-]{12,}|^gh[pousr]_[A-Za-z0-9_]{20,}|^glpat-[A-Za-z0-9_-]{20,}|^xox[baprs]-[A-Za-z0-9-]{10,}|^(AKIA|ASIA)[A-Z0-9]{16}|^AIza[A-Za-z0-9_-]{20,}|^eyJ[A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}[.][A-Za-z0-9_-]{8,}|^-----BEGIN [A-Z ]*PRIVATE KEY-----|^([a-z][a-z0-9+.-]*:)+//[^/[:space:]:@]*:[^@[:space:]]+@|(password|token|secret|api[_-]?key|authorization)[[:space:]]*[:=][[:space:]]*[^[:space:]]+)';
  end if;
  if value_kind = 'array' then
    if secret_reference_collection_key
      and pg_catalog.jsonb_array_length(requested_value) = 0
    then
      return true;
    end if;
    for child_value in
      select element.value
      from pg_catalog.jsonb_array_elements(requested_value) as element(value)
    loop
      if app_data_agent.contains_potential_plaintext_secret(
        child_value,
        requested_key
      ) then
        return true;
      end if;
    end loop;
    return false;
  end if;
  if value_kind = 'object' then
    for child_key, child_value in
      select entry.key, entry.value
      from pg_catalog.jsonb_each(requested_value) as entry(key, value)
    loop
      if app_data_agent.contains_potential_plaintext_secret(
        child_value,
        child_key
      ) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end
$$;

create or replace function app_data_agent.command_payload_is_valid(
  requested_payload jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
begin
  if requested_payload is null
    or pg_catalog.jsonb_typeof(requested_payload) <> 'object'
    or app_data_agent.contains_potential_plaintext_secret(requested_payload)
  then
    return false;
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(requested_payload) as payload_key(key)
    where payload_key.key not in (
      'kind',
      'mode',
      'question_version',
      'dataset_id',
      'secret_refs'
    )
  ) then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(requested_payload -> 'kind') is distinct from 'string'
    or requested_payload ->> 'kind'
      !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
  then
    return false;
  end if;
  if requested_payload ? 'mode' and (
    pg_catalog.jsonb_typeof(requested_payload -> 'mode') is distinct from 'string'
    or requested_payload ->> 'mode' <> 'L2'
  ) then
    return false;
  end if;
  if requested_payload ? 'question_version' and (
    pg_catalog.jsonb_typeof(requested_payload -> 'question_version')
      is distinct from 'string'
    or requested_payload ->> 'question_version'
      !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
  ) then
    return false;
  end if;
  if requested_payload ? 'dataset_id' and (
    pg_catalog.jsonb_typeof(requested_payload -> 'dataset_id') is distinct from 'string'
    or requested_payload ->> 'dataset_id'
      !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
  ) then
    return false;
  end if;
  if requested_payload ? 'secret_refs' then
    if pg_catalog.jsonb_typeof(requested_payload -> 'secret_refs')
      is distinct from 'array'
      or pg_catalog.jsonb_array_length(requested_payload -> 'secret_refs')
        not between 1 and 32
    then
      return false;
    end if;
    for item in
      select element.value
      from pg_catalog.jsonb_array_elements(
        requested_payload -> 'secret_refs'
      ) as element(value)
    loop
      if pg_catalog.jsonb_typeof(item) is distinct from 'string'
        or item #>> '{}'
          !~* '^secretref:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then
        return false;
      end if;
    end loop;
  end if;
  return true;
end
$$;

create table app_data_agent.memberships (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  principal_id uuid not null,
  membership_role text not null
    check (membership_role in ('owner', 'analyst', 'viewer', 'demo')),
  membership_version bigint not null default 1 check (membership_version >= 1),
  revoked_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, principal_id)
);

create table app_data_agent.runs (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  principal_id uuid not null,
  status text not null default 'QUEUED'
    check (
      status in (
        'QUEUED',
        'RUNNING',
        'WAITING',
        'SUCCEEDED',
        'FAILED',
        'CANCELLED'
      )
    ),
  active_fence bigint not null default 0 check (active_fence >= 0),
  question text not null
    check (
      pg_catalog.length(pg_catalog.btrim(question)) between 1 and 4000
      and not app_data_agent.contains_potential_plaintext_secret(
        pg_catalog.to_jsonb(question),
        'question'
      )
    ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id),
  foreign key (app_id, tenant_id, environment, principal_id)
    references app_data_agent.memberships (
      app_id,
      tenant_id,
      environment,
      principal_id
    )
    on delete restrict
);

create table app_data_agent.commands (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  command_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null
    check (pg_catalog.length(idempotency_key) between 1 and 256),
  payload_json jsonb not null
    check (app_data_agent.command_payload_is_valid(payload_json)),
  payload_hash text not null
    check (
      payload_hash ~ '^sha256:[0-9a-f]{64}$'
      and payload_hash = platform.canonical_sha256(payload_json)
    ),
  status text not null default 'ACCEPTED'
    check (status in ('ACCEPTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REJECTED')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, command_id),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id)
    on delete restrict,
  foreign key (app_id, tenant_id, environment, principal_id)
    references app_data_agent.memberships (
      app_id,
      tenant_id,
      environment,
      principal_id
    )
    on delete restrict,
  unique (app_id, tenant_id, environment, command_id, principal_id),
  unique (app_id, tenant_id, environment, command_id, run_id),
  unique (
    app_id,
    tenant_id,
    environment,
    command_id,
    principal_id,
    payload_hash
  ),
  unique (app_id, tenant_id, environment, principal_id, idempotency_key)
);

create table app_data_agent.idempotency_records (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  principal_id uuid not null,
  idempotency_key text not null,
  command_id uuid not null,
  payload_hash text not null
    check (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, principal_id, idempotency_key),
  foreign key (
    app_id,
    tenant_id,
    environment,
    command_id,
    principal_id,
    payload_hash
  )
    references app_data_agent.commands (
      app_id,
      tenant_id,
      environment,
      command_id,
      principal_id,
      payload_hash
    )
    on delete restrict
    deferrable initially deferred
);

comment on column app_data_agent.commands.principal_id is
  '发起命令并拥有幂等命名空间的 requester；Owner 代发时可与 Run owner 不同。';
comment on column app_data_agent.idempotency_records.principal_id is
  '幂等键 requester；必须与关联 Command 的 requester 一致。';

create table app_data_agent.run_events (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  event_id uuid not null,
  run_id uuid not null,
  sequence bigint not null check (sequence >= 1),
  event_type text not null
    check (event_type ~ '^[a-z][a-z0-9_.-]{1,126}$'),
  payload_json jsonb not null
    check (
      pg_catalog.jsonb_typeof(payload_json) = 'object'
      and not app_data_agent.contains_potential_plaintext_secret(payload_json)
    ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, event_id),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id)
    on delete restrict,
  unique (app_id, tenant_id, environment, run_id, sequence)
);

create table app_data_agent.artifacts (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  artifact_id uuid not null,
  artifact_type text not null
    check (artifact_type ~ '^[A-Za-z][A-Za-z0-9_.-]{1,126}$'),
  revision integer not null check (revision >= 1),
  content_hash text not null
    check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  document_json jsonb not null
    check (
      pg_catalog.jsonb_typeof(document_json) = 'object'
      and not app_data_agent.contains_potential_plaintext_secret(document_json)
    ),
  worker_fence bigint not null check (worker_fence >= 0),
  is_active boolean not null default true,
  parent_revision integer,
  parent_content_hash text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, artifact_id, revision),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id)
    on delete restrict,
  unique (
    app_id,
    tenant_id,
    environment,
    run_id,
    artifact_id,
    revision,
    content_hash
  ),
  foreign key (
    app_id,
    tenant_id,
    environment,
    run_id,
    artifact_id,
    parent_revision,
    parent_content_hash
  )
    references app_data_agent.artifacts (
      app_id,
      tenant_id,
      environment,
      run_id,
      artifact_id,
      revision,
      content_hash
    )
    on delete restrict,
  check (
    (parent_revision is null and parent_content_hash is null and revision = 1)
    or (
      parent_revision is not null
      and parent_content_hash is not null
      and parent_revision = revision - 1
    )
  )
);

create unique index artifacts_one_active_revision
on app_data_agent.artifacts (
  app_id,
  tenant_id,
  environment,
  run_id,
  artifact_id
)
where is_active;

create table app_data_agent.outbox (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  outbox_id uuid not null,
  run_id uuid not null,
  command_id uuid not null,
  topic text not null check (topic ~ '^[a-z][a-z0-9_.-]{1,126}$'),
  payload_json jsonb not null
    check (
      pg_catalog.jsonb_typeof(payload_json) = 'object'
      and not app_data_agent.contains_potential_plaintext_secret(payload_json)
    ),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'LEASED', 'PUBLISHED', 'FAILED', 'DEAD_LETTER')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default pg_catalog.clock_timestamp(),
  lease_owner text,
  lease_token bigint not null default 0 check (lease_token >= 0),
  lease_expires_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, outbox_id),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id)
    on delete restrict,
  foreign key (app_id, tenant_id, environment, command_id, run_id)
    references app_data_agent.commands (
      app_id,
      tenant_id,
      environment,
      command_id,
      run_id
    )
    on delete restrict,
  check (
    (status = 'LEASED' and lease_owner is not null and lease_expires_at is not null)
    or (status <> 'LEASED')
  ),
  check (
    (status = 'PUBLISHED' and published_at is not null)
    or (status <> 'PUBLISHED' and published_at is null)
  )
);

create index outbox_dispatch_ready
on app_data_agent.outbox (status, available_at, created_at)
where status in ('PENDING', 'FAILED', 'LEASED');

create table app_data_agent.datasets (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  dataset_id uuid not null,
  dataset_name text not null check (pg_catalog.length(dataset_name) between 1 and 128),
  data_classification text not null
    check (data_classification in ('SYNTHETIC', 'PUBLIC', 'PRIVATE', 'RESTRICTED')),
  artifact_manifest jsonb not null default '{}'::jsonb
    check (
      pg_catalog.jsonb_typeof(artifact_manifest) = 'object'
      and not app_data_agent.contains_potential_plaintext_secret(
        artifact_manifest
      )
    ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, dataset_id),
  unique (app_id, tenant_id, environment, dataset_name)
);

create table app_data_agent.eval_cases (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  eval_case_id uuid not null,
  dataset_id uuid not null,
  benchmark_suite text not null
    check (benchmark_suite in ('InsightBench', 'DAB', 'RCAEval', 'CONTROLLED')),
  case_key text not null check (pg_catalog.length(case_key) between 1 and 256),
  prompt text not null
    check (
      pg_catalog.length(pg_catalog.btrim(prompt)) >= 1
      and not app_data_agent.contains_potential_plaintext_secret(
        pg_catalog.to_jsonb(prompt),
        'prompt'
      )
    ),
  expected_json jsonb not null
    check (
      pg_catalog.jsonb_typeof(expected_json) = 'object'
      and not app_data_agent.contains_potential_plaintext_secret(expected_json)
    ),
  is_demo_eligible boolean not null default false,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, eval_case_id),
  foreign key (app_id, tenant_id, environment, dataset_id)
    references app_data_agent.datasets (app_id, tenant_id, environment, dataset_id)
    on delete restrict,
  unique (app_id, tenant_id, environment, benchmark_suite, case_key)
);

create table app_data_agent.eval_runs (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  eval_run_id uuid not null,
  eval_case_id uuid not null,
  run_id uuid not null,
  evaluator_version text not null check (pg_catalog.length(evaluator_version) between 1 and 128),
  status text not null check (status in ('QUEUED', 'RUNNING', 'SCORED', 'FAILED')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  primary key (app_id, tenant_id, environment, eval_run_id),
  foreign key (app_id, tenant_id, environment, eval_case_id)
    references app_data_agent.eval_cases (
      app_id,
      tenant_id,
      environment,
      eval_case_id
    )
    on delete restrict,
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id)
    on delete restrict
);

create table app_data_agent.scorecards (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  scorecard_id uuid not null,
  eval_run_id uuid not null,
  scorer text not null check (pg_catalog.length(scorer) between 1 and 128),
  score numeric not null check (score >= 0 and score <= 1),
  evidence_json jsonb not null
    check (
      pg_catalog.jsonb_typeof(evidence_json) = 'object'
      and not app_data_agent.contains_potential_plaintext_secret(evidence_json)
    ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, scorecard_id),
  foreign key (app_id, tenant_id, environment, eval_run_id)
    references app_data_agent.eval_runs (
      app_id,
      tenant_id,
      environment,
      eval_run_id
    )
    on delete restrict
);

create table app_data_agent.audit_log (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  audit_id uuid not null,
  principal_id uuid not null,
  action text not null check (action ~ '^[A-Z][A-Z0-9_]{1,126}$'),
  resource_type text not null check (pg_catalog.length(resource_type) between 1 and 128),
  resource_id text not null check (pg_catalog.length(resource_id) between 1 and 256),
  details jsonb not null default '{}'::jsonb
    check (
      pg_catalog.jsonb_typeof(details) = 'object'
      and not app_data_agent.contains_potential_plaintext_secret(details)
    ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, audit_id),
  foreign key (app_id, tenant_id, environment, principal_id)
    references app_data_agent.memberships (
      app_id,
      tenant_id,
      environment,
      principal_id
    )
    on delete restrict
);

create table app_data_agent.secret_refs (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  secret_ref_id uuid not null,
  owner_principal_id uuid not null,
  secret_name text not null
    check (secret_name ~ '^[A-Za-z][A-Za-z0-9_.-]{1,126}$'),
  provider_ref_hash text not null
    check (provider_ref_hash ~ '^sha256:[0-9a-f]{64}$'),
  version bigint not null default 1 check (version >= 1),
  status text not null default 'ACTIVE'
    check (
      status in (
        'ACTIVE',
        'ROTATION_PENDING',
        'REVOCATION_PENDING',
        'REVOKED'
      )
    ),
  pending_request_id uuid,
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (
    secret_ref_id::text ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  primary key (app_id, tenant_id, environment, secret_ref_id),
  foreign key (app_id, tenant_id, environment, owner_principal_id)
    references app_data_agent.memberships (
      app_id,
      tenant_id,
      environment,
      principal_id
    )
    on delete restrict,
  check (
    (status in ('ROTATION_PENDING', 'REVOCATION_PENDING') and pending_request_id is not null)
    or (status in ('ACTIVE', 'REVOKED') and pending_request_id is null)
  ),
  check (
    (status = 'REVOKED' and revoked_at is not null)
    or (status <> 'REVOKED' and revoked_at is null)
  )
);

create unique index secret_refs_active_name
on app_data_agent.secret_refs (
  app_id,
  tenant_id,
  environment,
  secret_name
)
where status <> 'REVOKED';

create table app_data_agent.secret_provider_effect_receipts (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  provider_receipt_id uuid not null,
  secret_ref_id uuid not null,
  request_id uuid not null,
  operation text not null check (operation in ('ROTATE', 'REVOKE')),
  expected_version bigint not null check (expected_version >= 1),
  result text not null check (result in ('SUCCEEDED', 'FAILED')),
  resulting_provider_ref_hash text
    check (
      resulting_provider_ref_hash is null
      or resulting_provider_ref_hash ~ '^sha256:[0-9a-f]{64}$'
    ),
  provider_receipt_hash text not null unique
    check (provider_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  authority_key_id text not null
    check (authority_key_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  signature text not null
    check (signature ~ '^ed25519:[A-Za-z0-9_-]{32,192}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, provider_receipt_id),
  foreign key (app_id, tenant_id, environment, secret_ref_id)
    references app_data_agent.secret_refs (
      app_id,
      tenant_id,
      environment,
      secret_ref_id
    )
    on delete restrict,
  unique (app_id, tenant_id, environment, secret_ref_id, request_id),
  check (
    (operation = 'ROTATE' and result = 'SUCCEEDED' and resulting_provider_ref_hash is not null)
    or (operation = 'REVOKE' and result = 'SUCCEEDED' and resulting_provider_ref_hash is null)
    or (result = 'FAILED' and resulting_provider_ref_hash is null)
  )
);

create or replace function app_data_agent.reject_artifact_payload_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'P0001',
      message = 'DA_ARTIFACT_REVISION_IMMUTABLE';
  end if;

  if (
    old.is_active
    and not new.is_active
    and (pg_catalog.to_jsonb(new) - 'is_active')
      = (pg_catalog.to_jsonb(old) - 'is_active')
  ) then
    return new;
  end if;

  raise exception using
    errcode = 'P0001',
    message = 'DA_ARTIFACT_REVISION_IMMUTABLE';
end
$$;

create trigger artifact_revision_guard
before update or delete on app_data_agent.artifacts
for each row execute function app_data_agent.reject_artifact_payload_mutation();

create or replace function app_data_agent.guard_run_fence_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.active_fence = old.active_fence + 1
    and new.updated_at > old.updated_at
    and (
      pg_catalog.to_jsonb(new) - array['active_fence', 'updated_at']
    ) = (
      pg_catalog.to_jsonb(old) - array['active_fence', 'updated_at']
    )
  then
    return new;
  end if;
  raise exception using
    errcode = 'P0001',
    message = 'DA_RUN_IMMUTABLE';
end
$$;

create trigger run_immutable_guard
before update or delete on app_data_agent.runs
for each row execute function app_data_agent.guard_run_fence_transition();

create or replace function app_data_agent.guard_command_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'P0001',
      message = 'DA_COMMAND_IMMUTABLE';
  end if;

  if (pg_catalog.to_jsonb(new) - 'status')
    is distinct from (pg_catalog.to_jsonb(old) - 'status')
  then
    raise exception using
      errcode = 'P0001',
      message = 'DA_COMMAND_IMMUTABLE';
  end if;

  if new.status = old.status then
    return new;
  end if;
  if not (
    (old.status = 'ACCEPTED' and new.status in ('PROCESSING', 'REJECTED'))
    or (
      old.status = 'PROCESSING'
      and new.status in ('SUCCEEDED', 'FAILED')
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'DA_COMMAND_STATUS_TRANSITION_INVALID';
  end if;

  return new;
end
$$;

create trigger command_transition_guard
before update or delete on app_data_agent.commands
for each row execute function app_data_agent.guard_command_transition();

create trigger idempotency_records_immutable
before update or delete on app_data_agent.idempotency_records
for each row execute function platform.reject_immutable_mutation();

create trigger run_events_immutable
before update or delete on app_data_agent.run_events
for each row execute function platform.reject_immutable_mutation();

create trigger scorecards_immutable
before update or delete on app_data_agent.scorecards
for each row execute function platform.reject_immutable_mutation();

create trigger audit_log_immutable
before update or delete on app_data_agent.audit_log
for each row execute function platform.reject_immutable_mutation();

create or replace function app_data_agent.guard_secret_ref_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  immutable_fields_unchanged boolean;
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'P0001',
      message = 'DA_SECRET_REF_IMMUTABLE';
  end if;

  immutable_fields_unchanged :=
    new.app_id = old.app_id
    and new.tenant_id = old.tenant_id
    and new.environment = old.environment
    and new.secret_ref_id = old.secret_ref_id
    and new.owner_principal_id = old.owner_principal_id
    and new.secret_name = old.secret_name
    and new.created_at = old.created_at;
  if not immutable_fields_unchanged then
    raise exception using
      errcode = 'P0001',
      message = 'DA_SECRET_REF_IDENTITY_IMMUTABLE';
  end if;

  if (
    old.status = 'ACTIVE'
    and new.status in ('ROTATION_PENDING', 'REVOCATION_PENDING')
    and new.version = old.version
    and new.provider_ref_hash = old.provider_ref_hash
    and new.pending_request_id is not null
    and new.rotated_at is not distinct from old.rotated_at
    and new.revoked_at is null
  ) then
    return new;
  end if;
  if (
    old.status = 'ROTATION_PENDING'
    and new.status = 'ACTIVE'
    and new.version = old.version + 1
    and new.pending_request_id is null
    and new.rotated_at is not null
    and new.revoked_at is null
  ) then
    return new;
  end if;
  if (
    old.status in ('ROTATION_PENDING', 'REVOCATION_PENDING')
    and new.status = 'ACTIVE'
    and new.version = old.version
    and new.provider_ref_hash = old.provider_ref_hash
    and new.pending_request_id is null
    and new.rotated_at is not distinct from old.rotated_at
    and new.revoked_at is null
  ) then
    return new;
  end if;
  if (
    old.status = 'REVOCATION_PENDING'
    and new.status = 'REVOKED'
    and new.version = old.version + 1
    and new.provider_ref_hash = old.provider_ref_hash
    and new.pending_request_id is null
    and new.revoked_at is not null
  ) then
    return new;
  end if;

  raise exception using
    errcode = 'P0001',
    message = 'DA_SECRET_REF_TRANSITION_INVALID';
end
$$;

create trigger secret_ref_transition_guard
before update or delete on app_data_agent.secret_refs
for each row execute function app_data_agent.guard_secret_ref_transition();

create trigger secret_provider_effect_receipts_immutable
before update or delete on app_data_agent.secret_provider_effect_receipts
for each row execute function platform.reject_immutable_mutation();

create or replace function app_data_agent.guard_outbox_fence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    new.status = 'LEASED'
    and (
      old.status <> 'LEASED'
      or new.lease_owner is distinct from old.lease_owner
      or new.lease_expires_at is distinct from old.lease_expires_at
    )
    and (
      new.lease_token <> old.lease_token + 1
      or new.attempt_count <> old.attempt_count + 1
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'DA_OUTBOX_FENCE_REQUIRED';
  end if;
  if new.lease_token < old.lease_token then
    raise exception using
      errcode = 'P0001',
      message = 'DA_OUTBOX_FENCE_REGRESSION';
  end if;
  if new.attempt_count < old.attempt_count then
    raise exception using
      errcode = 'P0001',
      message = 'DA_OUTBOX_ATTEMPT_REGRESSION';
  end if;
  if (
    new.attempt_count <> old.attempt_count
    and new.lease_token = old.lease_token
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'DA_OUTBOX_ATTEMPT_WITHOUT_FENCE';
  end if;
  if new.status = 'PUBLISHED' and old.status <> 'LEASED' then
    raise exception using
      errcode = 'P0001',
      message = 'DA_OUTBOX_PUBLISH_WITHOUT_LEASE';
  end if;
  if new.lease_token > old.lease_token and (
    new.lease_token <> old.lease_token + 1
    or new.attempt_count <> old.attempt_count + 1
    or new.status <> 'LEASED'
    or new.lease_owner is null
    or new.lease_expires_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'DA_OUTBOX_FENCE_INVALID';
  end if;
  if old.status in ('PUBLISHED', 'DEAD_LETTER') and new is distinct from old then
    raise exception using
      errcode = 'P0001',
      message = 'DA_OUTBOX_TERMINAL';
  end if;
  return new;
end
$$;

create trigger outbox_fence_guard
before update on app_data_agent.outbox
for each row execute function app_data_agent.guard_outbox_fence();

create or replace function platform.provision_membership(
  requested_deployment_id uuid,
  requested_tenant_id uuid,
  requested_principal_id uuid,
  requested_role text
)
returns app_data_agent.memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_app_id uuid;
  resolved_environment text;
  provisioned_membership app_data_agent.memberships%rowtype;
begin
  if requested_role is null
    or requested_role not in ('owner', 'analyst', 'viewer', 'demo')
  then
    raise exception using
      errcode = '22023',
      message = 'DA_MEMBERSHIP_ROLE_INVALID';
  end if;

  select deployment.app_id, deployment.environment
  into resolved_app_id, resolved_environment
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id
   and lifecycle.environment = deployment.environment
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active
    and lifecycle.lifecycle_state <> 'DELETED';
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_DEPLOYMENT_NOT_FOUND';
  end if;
  if resolved_app_id <> '00000000-0000-4000-8000-00000000da01'::uuid then
    raise exception using
      errcode = '42501',
      message = 'DA_APP_SCHEMA_MISMATCH';
  end if;

  insert into app_data_agent.memberships (
    app_id,
    tenant_id,
    environment,
    principal_id,
    membership_role
  )
  values (
    resolved_app_id,
    requested_tenant_id,
    resolved_environment,
    requested_principal_id,
    requested_role
  )
  on conflict (app_id, tenant_id, environment, principal_id)
  do update set
    membership_role = excluded.membership_role,
    membership_version = app_data_agent.memberships.membership_version + 1,
    revoked_at = null,
    updated_at = pg_catalog.clock_timestamp()
  returning * into provisioned_membership;

  return provisioned_membership;
end
$$;

create or replace function platform.revoke_membership(
  requested_deployment_id uuid,
  requested_tenant_id uuid,
  requested_principal_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_app_id uuid;
  resolved_environment text;
begin
  select deployment.app_id, deployment.environment
  into resolved_app_id, resolved_environment
  from platform.deployment_mappings as deployment
  where deployment.deployment_id = requested_deployment_id;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_DEPLOYMENT_NOT_FOUND';
  end if;

  update app_data_agent.memberships
  set revoked_at = pg_catalog.clock_timestamp(),
      membership_version = membership_version + 1,
      updated_at = pg_catalog.clock_timestamp()
  where app_id = resolved_app_id
    and tenant_id = requested_tenant_id
    and environment = resolved_environment
    and principal_id = requested_principal_id
    and revoked_at is null;
  return found;
end
$$;

create or replace function platform.resolve_backend_authority(
  requested_deployment_id uuid,
  requested_tenant_id uuid,
  requested_principal_id uuid,
  require_write boolean default false
)
returns table (
  app_id uuid,
  tenant_id uuid,
  environment text,
  deployment_id uuid,
  principal_id uuid,
  membership_role text,
  membership_version bigint,
  app_epoch bigint,
  lifecycle_state text,
  can_write boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  lock_app_id uuid;
  lock_environment text;
begin
  if not pg_catalog.pg_has_role(
    session_user,
    'data_agent_backend',
    'USAGE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if require_write is null then
    raise exception using
      errcode = '22023',
      message = 'DA_AUTHORITY_MODE_INVALID';
  end if;

  if require_write then
    select deployment.app_id, deployment.environment
    into lock_app_id, lock_environment
    from platform.deployment_mappings as deployment
    where deployment.deployment_id = requested_deployment_id
      and deployment.is_active;
    if found then
      perform platform.acquire_lifecycle_shared_lock(
        lock_app_id,
        lock_environment
      );
    end if;
  end if;

  return query
  select
    deployment.app_id,
    membership.tenant_id,
    deployment.environment,
    deployment.deployment_id,
    membership.principal_id,
    membership.membership_role,
    membership.membership_version,
    lifecycle.authority_epoch,
    lifecycle.lifecycle_state,
    (
      lifecycle.lifecycle_state = 'ACTIVE'
      and membership.membership_role in ('owner', 'analyst')
    )
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id
   and lifecycle.environment = deployment.environment
  join app_data_agent.memberships as membership
    on membership.app_id = deployment.app_id
   and membership.environment = deployment.environment
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active
    and membership.tenant_id = requested_tenant_id
    and membership.principal_id = requested_principal_id
    and membership.membership_role <> 'demo'
    and membership.revoked_at is null
    and lifecycle.lifecycle_state <> 'DELETED'
    and (
      not require_write
      or (
        lifecycle.lifecycle_state = 'ACTIVE'
        and membership.membership_role in ('owner', 'analyst')
      )
    );
  if not found then
    raise exception using
      errcode = '42501',
      message = 'DA_SCOPE_FORBIDDEN';
  end if;
end
$$;

create or replace function platform.revalidate_backend_authority(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  requested_deployment_id uuid,
  requested_principal_id uuid,
  requested_role text,
  requested_membership_version bigint,
  requested_app_epoch bigint,
  require_write boolean default false
)
returns table (
  app_id uuid,
  tenant_id uuid,
  environment text,
  deployment_id uuid,
  principal_id uuid,
  membership_role text,
  membership_version bigint,
  app_epoch bigint,
  lifecycle_state text,
  can_write boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not pg_catalog.pg_has_role(
    session_user,
    'data_agent_backend',
    'USAGE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if require_write is null then
    raise exception using
      errcode = '22023',
      message = 'DA_AUTHORITY_MODE_INVALID';
  end if;
  if require_write then
    perform platform.acquire_lifecycle_shared_lock(
      requested_app_id,
      requested_environment
    );
  end if;

  return query
  select
    deployment.app_id,
    membership.tenant_id,
    deployment.environment,
    deployment.deployment_id,
    membership.principal_id,
    membership.membership_role,
    membership.membership_version,
    lifecycle.authority_epoch,
    lifecycle.lifecycle_state,
    (
      lifecycle.lifecycle_state = 'ACTIVE'
      and membership.membership_role in ('owner', 'analyst')
    )
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id
   and lifecycle.environment = deployment.environment
  join app_data_agent.memberships as membership
    on membership.app_id = deployment.app_id
   and membership.environment = deployment.environment
  where deployment.app_id = requested_app_id
    and membership.tenant_id = requested_tenant_id
    and deployment.environment = requested_environment
    and deployment.deployment_id = requested_deployment_id
    and membership.principal_id = requested_principal_id
    and membership.membership_role = requested_role
    and membership.membership_version = requested_membership_version
    and lifecycle.authority_epoch = requested_app_epoch
    and deployment.is_active
    and membership.membership_role <> 'demo'
    and membership.revoked_at is null
    and lifecycle.lifecycle_state <> 'DELETED'
    and (
      not require_write
      or (
        lifecycle.lifecycle_state = 'ACTIVE'
        and membership.membership_role in ('owner', 'analyst')
      )
    );
  if not found then
    raise exception using
      errcode = '42501',
      message = 'DA_AUTHORITY_STALE_OR_FORBIDDEN';
  end if;
end
$$;

create or replace function platform.current_backend_authority(
  require_write boolean default false
)
returns table (
  app_id uuid,
  tenant_id uuid,
  environment text,
  deployment_id uuid,
  principal_id uuid,
  membership_role text,
  membership_version bigint,
  app_epoch bigint,
  lifecycle_state text,
  can_write boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  context_app_id uuid;
  context_tenant_id uuid;
  context_environment text;
  context_deployment_id uuid;
  context_principal_id uuid;
  context_role text;
begin
  if require_write is null then
    raise exception using
      errcode = '22023',
      message = 'DA_AUTHORITY_MODE_INVALID';
  end if;

  context_app_id := platform.try_uuid(
    pg_catalog.current_setting('data_agent.app_id', true)
  );
  context_tenant_id := platform.try_uuid(
    pg_catalog.current_setting('data_agent.tenant_id', true)
  );
  context_environment := nullif(
    pg_catalog.current_setting('data_agent.environment', true),
    ''
  );
  context_deployment_id := platform.try_uuid(
    pg_catalog.current_setting('data_agent.deployment_id', true)
  );
  context_principal_id := platform.try_uuid(
    pg_catalog.current_setting('data_agent.principal_id', true)
  );
  context_role := nullif(
    pg_catalog.current_setting('data_agent.role', true),
    ''
  );

  return query
  select resolved.*
  from platform.resolve_backend_authority(
    context_deployment_id,
    context_tenant_id,
    context_principal_id,
    require_write
  ) as resolved
  where resolved.app_id = context_app_id
    and resolved.environment = context_environment
    and resolved.membership_role = context_role;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'DA_CONTEXT_FORBIDDEN';
  end if;
end
$$;

create or replace function platform.backend_context_matches(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  require_write boolean default false
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_authority record;
begin
  select *
  into current_authority
  from platform.current_backend_authority(require_write);
  return current_authority.app_id = requested_app_id
    and current_authority.tenant_id = requested_tenant_id
    and current_authority.environment = requested_environment;
exception
  when others then
    return false;
end
$$;

create or replace function platform.backend_principal_object_matches(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  object_principal_id uuid,
  require_write boolean default false
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_authority record;
begin
  select *
  into current_authority
  from platform.current_backend_authority(require_write);
  return current_authority.app_id = requested_app_id
    and current_authority.tenant_id = requested_tenant_id
    and current_authority.environment = requested_environment
    and (
      current_authority.membership_role = 'owner'
      or current_authority.principal_id = object_principal_id
    );
exception
  when others then
    return false;
end
$$;

create or replace function platform.backend_exact_principal_object_matches(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  object_principal_id uuid,
  require_write boolean default false
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_authority record;
begin
  select *
  into current_authority
  from platform.current_backend_authority(require_write);
  return current_authority.app_id = requested_app_id
    and current_authority.tenant_id = requested_tenant_id
    and current_authority.environment = requested_environment
    and current_authority.principal_id = object_principal_id;
exception
  when others then
    return false;
end
$$;

create or replace function platform.backend_run_object_matches(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  requested_run_id uuid,
  require_write boolean default false
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  run_principal_id uuid;
begin
  if not platform.backend_context_matches(
    requested_app_id,
    requested_tenant_id,
    requested_environment,
    require_write
  ) then
    return false;
  end if;

  select run.principal_id
  into run_principal_id
  from app_data_agent.runs as run
  where run.app_id = requested_app_id
    and run.tenant_id = requested_tenant_id
    and run.environment = requested_environment
    and run.run_id = requested_run_id;
  if not found then
    return false;
  end if;
  return platform.backend_principal_object_matches(
    requested_app_id,
    requested_tenant_id,
    requested_environment,
    run_principal_id,
    require_write
  );
exception
  when others then
    return false;
end
$$;

create or replace function platform.backend_eval_run_object_matches(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  requested_eval_run_id uuid,
  require_write boolean default false
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  linked_run_id uuid;
begin
  select eval_run.run_id
  into linked_run_id
  from app_data_agent.eval_runs as eval_run
  where eval_run.app_id = requested_app_id
    and eval_run.tenant_id = requested_tenant_id
    and eval_run.environment = requested_environment
    and eval_run.eval_run_id = requested_eval_run_id;
  if not found then
    return false;
  end if;
  return platform.backend_run_object_matches(
    requested_app_id,
    requested_tenant_id,
    requested_environment,
    linked_run_id,
    require_write
  );
exception
  when others then
    return false;
end
$$;

create or replace function platform.backend_command_object_matches(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  requested_command_id uuid,
  require_write boolean default false
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  linked_run_id uuid;
begin
  select command.run_id
  into linked_run_id
  from app_data_agent.commands as command
  where command.app_id = requested_app_id
    and command.tenant_id = requested_tenant_id
    and command.environment = requested_environment
    and command.command_id = requested_command_id;
  if not found then
    return false;
  end if;
  return platform.backend_run_object_matches(
    requested_app_id,
    requested_tenant_id,
    requested_environment,
    linked_run_id,
    require_write
  );
exception
  when others then
    return false;
end
$$;

create or replace function app_data_agent.advance_run_fence(
  requested_run_id uuid,
  expected_active_fence bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  next_active_fence bigint;
begin
  if requested_run_id is null
    or expected_active_fence is null
    or expected_active_fence < 0
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_FENCE_INPUT_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(true);

  update app_data_agent.runs as run
  set active_fence = run.active_fence + 1,
      updated_at = pg_catalog.clock_timestamp()
  where run.app_id = current_authority.app_id
    and run.tenant_id = current_authority.tenant_id
    and run.environment = current_authority.environment
    and run.run_id = requested_run_id
    and run.active_fence = expected_active_fence
    and (
      current_authority.membership_role = 'owner'
      or run.principal_id = current_authority.principal_id
    )
  returning run.active_fence into next_active_fence;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_FENCE_STALE_OR_FORBIDDEN';
  end if;
  return next_active_fence;
end
$$;

create or replace function app_data_agent.compute_secret_provider_receipt_hash(
  requested_provider_receipt_id uuid,
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  requested_secret_ref_id uuid,
  requested_request_id uuid,
  requested_operation text,
  requested_expected_version bigint,
  requested_result text,
  requested_resulting_provider_ref_hash text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select platform.canonical_sha256(
    pg_catalog.jsonb_build_object(
      'providerReceiptId', requested_provider_receipt_id,
      'appId', requested_app_id,
      'tenantId', requested_tenant_id,
      'environment', requested_environment,
      'secretRefId', requested_secret_ref_id,
      'requestId', requested_request_id,
      'operation', requested_operation,
      'expectedVersion', requested_expected_version,
      'result', requested_result,
      'resultingProviderRefHash', requested_resulting_provider_ref_hash
    )
  )
$$;

create or replace function app_data_agent.register_secret_ref(
  requested_secret_ref_id uuid,
  requested_secret_name text,
  requested_provider_ref_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  registered_ref app_data_agent.secret_refs%rowtype;
begin
  select *
  into current_authority
  from platform.current_backend_authority(true);
  if requested_secret_ref_id is null
    or requested_secret_ref_id::text !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception using
      errcode = '22023',
      message = 'DA_SECRET_REF_ID_INVALID';
  end if;
  if requested_provider_ref_hash is null
    or requested_provider_ref_hash !~ '^sha256:[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'DA_SECRET_PROVIDER_REF_HASH_INVALID';
  end if;

  insert into app_data_agent.secret_refs (
    app_id,
    tenant_id,
    environment,
    secret_ref_id,
    owner_principal_id,
    secret_name,
    provider_ref_hash
  )
  values (
    current_authority.app_id,
    current_authority.tenant_id,
    current_authority.environment,
    requested_secret_ref_id,
    current_authority.principal_id,
    requested_secret_name,
    requested_provider_ref_hash
  )
  returning * into registered_ref;

  insert into app_data_agent.audit_log (
    app_id,
    tenant_id,
    environment,
    audit_id,
    principal_id,
    action,
    resource_type,
    resource_id,
    details
  )
  values (
    current_authority.app_id,
    current_authority.tenant_id,
    current_authority.environment,
    pg_catalog.gen_random_uuid(),
    current_authority.principal_id,
    'SECRET_REGISTERED',
    'secret_ref',
    requested_secret_ref_id::text,
    pg_catalog.jsonb_build_object('version', 1)
  );
  return pg_catalog.to_jsonb(registered_ref);
end
$$;

create or replace function app_data_agent.request_secret_provider_effect(
  requested_secret_ref_id uuid,
  requested_expected_version bigint,
  requested_request_id uuid,
  requested_operation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  current_ref app_data_agent.secret_refs%rowtype;
  target_status text;
begin
  select *
  into current_authority
  from platform.current_backend_authority(true);
  target_status := case requested_operation
    when 'ROTATE' then 'ROTATION_PENDING'
    when 'REVOKE' then 'REVOCATION_PENDING'
    else null
  end;
  if target_status is null then
    raise exception using
      errcode = '22023',
      message = 'DA_SECRET_OPERATION_INVALID';
  end if;

  select secret_ref.*
  into current_ref
  from app_data_agent.secret_refs as secret_ref
  where secret_ref.app_id = current_authority.app_id
    and secret_ref.tenant_id = current_authority.tenant_id
    and secret_ref.environment = current_authority.environment
    and secret_ref.secret_ref_id = requested_secret_ref_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_SECRET_REF_NOT_FOUND';
  end if;
  if (
    current_authority.membership_role <> 'owner'
    and current_ref.owner_principal_id <> current_authority.principal_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'DA_OBJECT_FORBIDDEN';
  end if;
  if (
    current_ref.status <> 'ACTIVE'
    or current_ref.version is distinct from requested_expected_version
  ) then
    raise exception using
      errcode = '40001',
      message = 'DA_SECRET_VERSION_STALE';
  end if;

  update app_data_agent.secret_refs
  set status = target_status,
      pending_request_id = requested_request_id,
      updated_at = pg_catalog.clock_timestamp()
  where app_id = current_ref.app_id
    and tenant_id = current_ref.tenant_id
    and environment = current_ref.environment
    and secret_ref_id = current_ref.secret_ref_id
  returning * into current_ref;

  insert into app_data_agent.audit_log (
    app_id,
    tenant_id,
    environment,
    audit_id,
    principal_id,
    action,
    resource_type,
    resource_id,
    details
  )
  values (
    current_ref.app_id,
    current_ref.tenant_id,
    current_ref.environment,
    pg_catalog.gen_random_uuid(),
    current_authority.principal_id,
    case requested_operation
      when 'ROTATE' then 'SECRET_ROTATION_REQUESTED'
      else 'SECRET_REVOCATION_REQUESTED'
    end,
    'secret_ref',
    requested_secret_ref_id::text,
    pg_catalog.jsonb_build_object(
      'requestId', requested_request_id,
      'expectedVersion', requested_expected_version
    )
  );
  return pg_catalog.to_jsonb(current_ref);
end
$$;

create or replace function app_data_agent.record_secret_provider_effect(
  requested_provider_receipt_id uuid,
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  requested_secret_ref_id uuid,
  requested_request_id uuid,
  requested_operation text,
  requested_expected_version bigint,
  requested_result text,
  requested_resulting_provider_ref_hash text,
  requested_provider_receipt_hash text,
  requested_authority_key_id text,
  requested_signature text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_ref app_data_agent.secret_refs%rowtype;
  expected_hash text;
  recorded_receipt app_data_agent.secret_provider_effect_receipts%rowtype;
begin
  if not pg_catalog.pg_has_role(
    session_user,
    'data_agent_secret_authority',
    'USAGE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'DA_SECRET_AUTHORITY_REQUIRED';
  end if;

  select secret_ref.*
  into current_ref
  from app_data_agent.secret_refs as secret_ref
  where secret_ref.app_id = requested_app_id
    and secret_ref.tenant_id = requested_tenant_id
    and secret_ref.environment = requested_environment
    and secret_ref.secret_ref_id = requested_secret_ref_id;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_SECRET_REF_NOT_FOUND';
  end if;
  if (
    current_ref.version is distinct from requested_expected_version
    or current_ref.pending_request_id <> requested_request_id
    or (
      requested_operation = 'ROTATE'
      and current_ref.status <> 'ROTATION_PENDING'
    )
    or (
      requested_operation = 'REVOKE'
      and current_ref.status <> 'REVOCATION_PENDING'
    )
  ) then
    raise exception using
      errcode = '40001',
      message = 'DA_SECRET_PROVIDER_EFFECT_STALE';
  end if;

  expected_hash := app_data_agent.compute_secret_provider_receipt_hash(
    requested_provider_receipt_id,
    requested_app_id,
    requested_tenant_id,
    requested_environment,
    requested_secret_ref_id,
    requested_request_id,
    requested_operation,
    requested_expected_version,
    requested_result,
    requested_resulting_provider_ref_hash
  );
  if requested_provider_receipt_hash is distinct from expected_hash then
    raise exception using
      errcode = '22023',
      message = 'DA_SECRET_PROVIDER_RECEIPT_HASH_INVALID';
  end if;
  if requested_result = 'SUCCEEDED' then
    raise exception using
      errcode = '55000',
      message = 'DA_EXTERNAL_SECRET_VERIFIER_UNAVAILABLE';
  end if;

  insert into app_data_agent.secret_provider_effect_receipts (
    app_id,
    tenant_id,
    environment,
    provider_receipt_id,
    secret_ref_id,
    request_id,
    operation,
    expected_version,
    result,
    resulting_provider_ref_hash,
    provider_receipt_hash,
    authority_key_id,
    signature
  )
  values (
    requested_app_id,
    requested_tenant_id,
    requested_environment,
    requested_provider_receipt_id,
    requested_secret_ref_id,
    requested_request_id,
    requested_operation,
    requested_expected_version,
    requested_result,
    requested_resulting_provider_ref_hash,
    requested_provider_receipt_hash,
    requested_authority_key_id,
    requested_signature
  )
  returning * into recorded_receipt;
  return pg_catalog.to_jsonb(recorded_receipt);
end
$$;

create or replace function app_data_agent.finalize_secret_provider_effect(
  requested_secret_ref_id uuid,
  requested_expected_version bigint,
  requested_provider_receipt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  current_ref app_data_agent.secret_refs%rowtype;
  provider_receipt app_data_agent.secret_provider_effect_receipts%rowtype;
begin
  select *
  into current_authority
  from platform.current_backend_authority(true);

  select secret_ref.*
  into current_ref
  from app_data_agent.secret_refs as secret_ref
  where secret_ref.app_id = current_authority.app_id
    and secret_ref.tenant_id = current_authority.tenant_id
    and secret_ref.environment = current_authority.environment
    and secret_ref.secret_ref_id = requested_secret_ref_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_SECRET_REF_NOT_FOUND';
  end if;
  if (
    current_authority.membership_role <> 'owner'
    and current_ref.owner_principal_id <> current_authority.principal_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'DA_OBJECT_FORBIDDEN';
  end if;
  if current_ref.version is distinct from requested_expected_version then
    raise exception using
      errcode = '40001',
      message = 'DA_SECRET_VERSION_STALE';
  end if;

  select receipt.*
  into provider_receipt
  from app_data_agent.secret_provider_effect_receipts as receipt
  where receipt.app_id = current_ref.app_id
    and receipt.tenant_id = current_ref.tenant_id
    and receipt.environment = current_ref.environment
    and receipt.provider_receipt_id = requested_provider_receipt_id
    and receipt.secret_ref_id = current_ref.secret_ref_id
    and receipt.request_id = current_ref.pending_request_id
    and receipt.expected_version = requested_expected_version;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_SECRET_PROVIDER_RECEIPT_NOT_FOUND';
  end if;
  if provider_receipt.result <> 'SUCCEEDED' then
    raise exception using
      errcode = 'P0001',
      message = 'DA_SECRET_PROVIDER_EFFECT_FAILED';
  end if;
  if (
    (current_ref.status = 'ROTATION_PENDING' and provider_receipt.operation <> 'ROTATE')
    or (
      current_ref.status = 'REVOCATION_PENDING'
      and provider_receipt.operation <> 'REVOKE'
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'DA_SECRET_PROVIDER_RECEIPT_OPERATION_MISMATCH';
  end if;

  if provider_receipt.operation = 'ROTATE' then
    update app_data_agent.secret_refs
    set provider_ref_hash = provider_receipt.resulting_provider_ref_hash,
        version = version + 1,
        status = 'ACTIVE',
        pending_request_id = null,
        rotated_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where app_id = current_ref.app_id
      and tenant_id = current_ref.tenant_id
      and environment = current_ref.environment
      and secret_ref_id = current_ref.secret_ref_id
    returning * into current_ref;
  else
    update app_data_agent.secret_refs
    set version = version + 1,
        status = 'REVOKED',
        pending_request_id = null,
        revoked_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where app_id = current_ref.app_id
      and tenant_id = current_ref.tenant_id
      and environment = current_ref.environment
      and secret_ref_id = current_ref.secret_ref_id
    returning * into current_ref;
  end if;

  insert into app_data_agent.audit_log (
    app_id,
    tenant_id,
    environment,
    audit_id,
    principal_id,
    action,
    resource_type,
    resource_id,
    details
  )
  values (
    current_ref.app_id,
    current_ref.tenant_id,
    current_ref.environment,
    pg_catalog.gen_random_uuid(),
    current_authority.principal_id,
    case provider_receipt.operation
      when 'ROTATE' then 'SECRET_ROTATED'
      else 'SECRET_REVOKED'
    end,
    'secret_ref',
    requested_secret_ref_id::text,
    pg_catalog.jsonb_build_object(
      'providerReceiptId', requested_provider_receipt_id,
      'version', current_ref.version
    )
  );
  return pg_catalog.to_jsonb(current_ref);
end
$$;

create or replace function app_data_agent.acknowledge_failed_secret_provider_effect(
  requested_secret_ref_id uuid,
  requested_expected_version bigint,
  requested_provider_receipt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  current_ref app_data_agent.secret_refs%rowtype;
  provider_receipt app_data_agent.secret_provider_effect_receipts%rowtype;
begin
  select *
  into current_authority
  from platform.current_backend_authority(true);

  select secret_ref.*
  into current_ref
  from app_data_agent.secret_refs as secret_ref
  where secret_ref.app_id = current_authority.app_id
    and secret_ref.tenant_id = current_authority.tenant_id
    and secret_ref.environment = current_authority.environment
    and secret_ref.secret_ref_id = requested_secret_ref_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_SECRET_REF_NOT_FOUND';
  end if;
  if (
    current_authority.membership_role <> 'owner'
    and current_ref.owner_principal_id <> current_authority.principal_id
  ) then
    raise exception using
      errcode = '42501',
      message = 'DA_OBJECT_FORBIDDEN';
  end if;
  if (
    current_ref.version is distinct from requested_expected_version
    or current_ref.status not in ('ROTATION_PENDING', 'REVOCATION_PENDING')
  ) then
    raise exception using
      errcode = '40001',
      message = 'DA_SECRET_VERSION_STALE';
  end if;

  select receipt.*
  into provider_receipt
  from app_data_agent.secret_provider_effect_receipts as receipt
  where receipt.app_id = current_ref.app_id
    and receipt.tenant_id = current_ref.tenant_id
    and receipt.environment = current_ref.environment
    and receipt.provider_receipt_id = requested_provider_receipt_id
    and receipt.secret_ref_id = current_ref.secret_ref_id
    and receipt.request_id = current_ref.pending_request_id
    and receipt.expected_version = requested_expected_version;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_SECRET_PROVIDER_RECEIPT_NOT_FOUND';
  end if;
  if provider_receipt.result <> 'FAILED' then
    raise exception using
      errcode = '22023',
      message = 'DA_SECRET_PROVIDER_EFFECT_NOT_FAILED';
  end if;
  if (
    (current_ref.status = 'ROTATION_PENDING' and provider_receipt.operation <> 'ROTATE')
    or (
      current_ref.status = 'REVOCATION_PENDING'
      and provider_receipt.operation <> 'REVOKE'
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'DA_SECRET_PROVIDER_RECEIPT_OPERATION_MISMATCH';
  end if;

  update app_data_agent.secret_refs
  set status = 'ACTIVE',
      pending_request_id = null,
      updated_at = pg_catalog.clock_timestamp()
  where app_id = current_ref.app_id
    and tenant_id = current_ref.tenant_id
    and environment = current_ref.environment
    and secret_ref_id = current_ref.secret_ref_id
  returning * into current_ref;

  insert into app_data_agent.audit_log (
    app_id,
    tenant_id,
    environment,
    audit_id,
    principal_id,
    action,
    resource_type,
    resource_id,
    details
  )
  values (
    current_ref.app_id,
    current_ref.tenant_id,
    current_ref.environment,
    pg_catalog.gen_random_uuid(),
    current_authority.principal_id,
    'SECRET_PROVIDER_FAILURE_ACKNOWLEDGED',
    'secret_ref',
    requested_secret_ref_id::text,
    pg_catalog.jsonb_build_object(
      'providerReceiptId', requested_provider_receipt_id,
      'requestId', provider_receipt.request_id,
      'operation', provider_receipt.operation,
      'version', current_ref.version
    )
  );
  return pg_catalog.to_jsonb(current_ref);
end
$$;

create or replace function platform.authorize_browser_context(
  requested_deployment_id uuid,
  requested_tenant_id uuid,
  require_write boolean default false
)
returns table (
  app_id uuid,
  tenant_id uuid,
  environment text,
  principal_id uuid,
  membership_role text,
  deployment_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_principal uuid;
  resolved_app_id uuid;
  resolved_environment text;
  resolved_role text;
  lifecycle_state text;
begin
  perform pg_catalog.set_config('data_agent.app_id', '', true);
  perform pg_catalog.set_config('data_agent.tenant_id', '', true);
  perform pg_catalog.set_config('data_agent.environment', '', true);
  perform pg_catalog.set_config('data_agent.principal_id', '', true);
  perform pg_catalog.set_config('data_agent.role', '', true);
  perform pg_catalog.set_config('data_agent.deployment_id', '', true);

  if require_write is null then
    raise exception using
      errcode = '22023',
      message = 'DA_AUTHORITY_MODE_INVALID';
  end if;

  authenticated_principal := auth.uid();
  if authenticated_principal is null then
    raise exception using
      errcode = '42501',
      message = 'DA_AUTH_REQUIRED';
  end if;

  if require_write then
    select deployment.app_id, deployment.environment
    into resolved_app_id, resolved_environment
    from platform.deployment_mappings as deployment
    join app_data_agent.memberships as membership
      on membership.app_id = deployment.app_id
     and membership.environment = deployment.environment
    where deployment.deployment_id = requested_deployment_id
      and deployment.is_active
      and membership.tenant_id = requested_tenant_id
      and membership.principal_id = authenticated_principal
      and membership.revoked_at is null;
    if not found then
      raise exception using
        errcode = '42501',
        message = 'DA_SCOPE_FORBIDDEN';
    end if;
    perform platform.acquire_lifecycle_shared_lock(
      resolved_app_id,
      resolved_environment
    );
  end if;

  select
    deployment.app_id,
    deployment.environment,
    membership.membership_role,
    lifecycle.lifecycle_state
  into
    resolved_app_id,
    resolved_environment,
    resolved_role,
    lifecycle_state
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id
   and lifecycle.environment = deployment.environment
  join app_data_agent.memberships as membership
    on membership.app_id = deployment.app_id
   and membership.environment = deployment.environment
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active
    and membership.tenant_id = requested_tenant_id
    and membership.principal_id = authenticated_principal
    and membership.revoked_at is null;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'DA_SCOPE_FORBIDDEN';
  end if;
  if lifecycle_state = 'DELETED' then
    raise exception using
      errcode = '42501',
      message = 'DA_APP_DELETED';
  end if;
  if resolved_role = 'demo' then
    raise exception using
      errcode = '42501',
      message = 'DA_DEMO_SCOPE_ONLY';
  end if;
  if require_write and (
    lifecycle_state <> 'ACTIVE'
    or resolved_role not in ('owner', 'analyst')
  ) then
    raise exception using
      errcode = '42501',
      message = 'DA_WRITE_FORBIDDEN';
  end if;

  perform pg_catalog.set_config('data_agent.app_id', resolved_app_id::text, true);
  perform pg_catalog.set_config('data_agent.tenant_id', requested_tenant_id::text, true);
  perform pg_catalog.set_config('data_agent.environment', resolved_environment, true);
  perform pg_catalog.set_config(
    'data_agent.principal_id',
    authenticated_principal::text,
    true
  );
  perform pg_catalog.set_config('data_agent.role', resolved_role, true);
  perform pg_catalog.set_config(
    'data_agent.deployment_id',
    requested_deployment_id::text,
    true
  );

  return query
  select
    resolved_app_id,
    requested_tenant_id,
    resolved_environment,
    authenticated_principal,
    resolved_role,
    requested_deployment_id;
end
$$;

create or replace function platform.storage_object_allowed(
  requested_bucket_id text,
  requested_name text,
  require_write boolean default false
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  path_parts text[];
  path_app_id uuid;
  path_tenant_id uuid;
  path_environment text;
  path_principal_id uuid;
  path_run_id uuid;
  artifact_kind text;
  digest_name text;
  authenticated_principal uuid;
  context_environment text;
begin
  if require_write is null then
    return false;
  end if;
  if requested_bucket_id <> 'data-agent-artifacts' then
    return false;
  end if;

  path_parts := storage.foldername(requested_name);
  if pg_catalog.cardinality(path_parts) <> 6 then
    return false;
  end if;
  path_app_id := platform.try_uuid(path_parts[1]);
  path_tenant_id := platform.try_uuid(path_parts[2]);
  path_environment := path_parts[3];
  path_principal_id := platform.try_uuid(path_parts[4]);
  path_run_id := platform.try_uuid(path_parts[5]);
  artifact_kind := path_parts[6];
  digest_name := storage.filename(requested_name);
  authenticated_principal := auth.uid();

  if (
    path_app_id is null
    or path_tenant_id is null
    or path_principal_id is null
    or path_run_id is null
    or path_environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or artifact_kind !~ '^[a-z][a-z0-9_-]{1,62}$'
    or digest_name !~ '^sha256-[0-9a-f]{64}$'
  ) then
    return false;
  end if;

  if require_write then
    perform platform.acquire_lifecycle_shared_lock(
      path_app_id,
      path_environment
    );
  end if;

  if authenticated_principal is null then
    context_environment := nullif(
      pg_catalog.current_setting('data_agent.environment', true),
      ''
    );
    if context_environment is null or context_environment <> path_environment then
      return false;
    end if;
    return exists (
      select 1
      from app_data_agent.runs as run
      where run.app_id = path_app_id
        and run.tenant_id = path_tenant_id
        and run.environment = path_environment
        and run.run_id = path_run_id
        and run.principal_id = path_principal_id
        and platform.backend_run_object_matches(
          path_app_id,
          path_tenant_id,
          path_environment,
          path_run_id,
          require_write
        )
    );
  end if;

  return exists (
    select 1
    from platform.app_environment_lifecycle as lifecycle
    join platform.deployment_mappings as deployment
      on deployment.app_id = lifecycle.app_id
     and deployment.environment = lifecycle.environment
     and deployment.is_active
    join app_data_agent.memberships as membership
      on membership.app_id = deployment.app_id
     and membership.environment = deployment.environment
    join app_data_agent.runs as run
      on run.app_id = membership.app_id
     and run.tenant_id = membership.tenant_id
     and run.environment = membership.environment
    where lifecycle.app_id = path_app_id
      and lifecycle.environment = path_environment
      and lifecycle.lifecycle_state <> 'DELETED'
      and membership.tenant_id = path_tenant_id
      and membership.environment = path_environment
      and membership.principal_id = authenticated_principal
      and membership.revoked_at is null
      and membership.membership_role <> 'demo'
      and run.run_id = path_run_id
      and run.principal_id = path_principal_id
      and (
        membership.membership_role = 'owner'
        or membership.principal_id = run.principal_id
      )
      and (
        not require_write
        or (
          lifecycle.lifecycle_state = 'ACTIVE'
          and membership.membership_role in ('owner', 'analyst')
        )
      )
  );
exception
  when others then
    return false;
end
$$;

create or replace function app_data_agent.claim_outbox(
  requested_worker_id text,
  requested_limit integer default 25,
  requested_lease_seconds integer default 60
)
returns setof app_data_agent.outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  if requested_worker_id is null
    or pg_catalog.length(requested_worker_id) not between 1 and 128
  then
    raise exception using
      errcode = '22023',
      message = 'DA_OUTBOX_WORKER_INVALID';
  end if;
  if requested_limit is null or requested_limit not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'DA_OUTBOX_LIMIT_INVALID';
  end if;
  if requested_lease_seconds is null
    or requested_lease_seconds not between 5 and 900
  then
    raise exception using
      errcode = '22023',
      message = 'DA_OUTBOX_LEASE_INVALID';
  end if;

  return query
  with candidates as (
    select
      candidate.app_id,
      candidate.tenant_id,
      candidate.environment,
      candidate.outbox_id
    from app_data_agent.outbox as candidate
    where candidate.available_at <= pg_catalog.clock_timestamp()
      and platform.backend_run_object_matches(
        candidate.app_id,
        candidate.tenant_id,
        candidate.environment,
        candidate.run_id,
        true
      )
      and (
        candidate.status in ('PENDING', 'FAILED')
        or (
          candidate.status = 'LEASED'
          and candidate.lease_expires_at < pg_catalog.clock_timestamp()
        )
      )
    order by candidate.available_at, candidate.created_at
    for update skip locked
    limit requested_limit
  )
  update app_data_agent.outbox as claimed
  set status = 'LEASED',
      attempt_count = claimed.attempt_count + 1,
      lease_owner = requested_worker_id,
      lease_token = claimed.lease_token + 1,
      lease_expires_at = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => requested_lease_seconds),
      published_at = null
  from candidates
  where claimed.app_id = candidates.app_id
    and claimed.tenant_id = candidates.tenant_id
    and claimed.environment = candidates.environment
    and claimed.outbox_id = candidates.outbox_id
  returning claimed.*;
end
$$;

create or replace function app_data_agent.publish_outbox(
  requested_outbox_id uuid,
  requested_worker_id text,
  expected_lease_token bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update app_data_agent.outbox
  set status = 'PUBLISHED',
      published_at = pg_catalog.clock_timestamp(),
      lease_owner = null,
      lease_expires_at = null
  where outbox_id = requested_outbox_id
    and platform.backend_run_object_matches(
      app_id,
      tenant_id,
      environment,
      run_id,
      true
    )
    and status = 'LEASED'
    and lease_owner = requested_worker_id
    and lease_token = expected_lease_token
    and lease_expires_at >= pg_catalog.clock_timestamp();
  return found;
end
$$;

create or replace function app_data_agent.retry_outbox(
  requested_outbox_id uuid,
  requested_worker_id text,
  expected_lease_token bigint,
  requested_retry_delay_ms bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if requested_retry_delay_ms is null
    or requested_retry_delay_ms not between 0 and 86400000
  then
    raise exception using
      errcode = '22023',
      message = 'DA_OUTBOX_RETRY_DELAY_INVALID';
  end if;

  update app_data_agent.outbox
  set status = 'PENDING',
      available_at = pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(
          secs => requested_retry_delay_ms::double precision / 1000.0
        ),
      lease_owner = null,
      lease_expires_at = null,
      published_at = null
  where outbox_id = requested_outbox_id
    and platform.backend_run_object_matches(
      app_id,
      tenant_id,
      environment,
      run_id,
      true
    )
    and status = 'LEASED'
    and lease_owner = requested_worker_id
    and lease_token = expected_lease_token
    and lease_expires_at >= pg_catalog.clock_timestamp();
  return found;
end
$$;

do $$
declare
  table_name text;
  select_predicate text;
  write_predicate text;
  governed_tables constant text[] := array[
    'memberships',
    'runs',
    'commands',
    'idempotency_records',
    'run_events',
    'artifacts',
    'outbox',
    'datasets',
    'eval_cases',
    'eval_runs',
    'scorecards',
    'audit_log',
    'secret_refs'
  ];
begin
  foreach table_name in array governed_tables loop
    select_predicate := case
      when table_name = 'runs' then
        'platform.backend_principal_object_matches(app_id, tenant_id, environment, principal_id, false)'
      when table_name in ('memberships', 'audit_log') then
        'platform.backend_principal_object_matches(app_id, tenant_id, environment, principal_id, false)'
      when table_name = 'secret_refs' then
        'platform.backend_principal_object_matches(app_id, tenant_id, environment, owner_principal_id, false)'
      when table_name in ('commands', 'run_events', 'artifacts', 'outbox', 'eval_runs') then
        'platform.backend_run_object_matches(app_id, tenant_id, environment, run_id, false)'
      when table_name = 'scorecards' then
        'platform.backend_eval_run_object_matches(app_id, tenant_id, environment, eval_run_id, false)'
      when table_name = 'idempotency_records' then
        'platform.backend_exact_principal_object_matches(app_id, tenant_id, environment, principal_id, false)'
      else
        'platform.backend_context_matches(app_id, tenant_id, environment, false)'
    end;
    write_predicate := case
      when table_name = 'runs' then
        'platform.backend_principal_object_matches(app_id, tenant_id, environment, principal_id, true)'
      when table_name = 'audit_log' then
        'platform.backend_exact_principal_object_matches(app_id, tenant_id, environment, principal_id, true)'
      when table_name = 'memberships' then
        'platform.backend_principal_object_matches(app_id, tenant_id, environment, principal_id, true)'
      when table_name = 'secret_refs' then
        'platform.backend_principal_object_matches(app_id, tenant_id, environment, owner_principal_id, true)'
      when table_name = 'commands' then
        '(' ||
        'platform.backend_run_object_matches(app_id, tenant_id, environment, run_id, true)' ||
        ' and ' ||
        'platform.backend_exact_principal_object_matches(app_id, tenant_id, environment, principal_id, true)' ||
        ')'
      when table_name in ('run_events', 'artifacts', 'outbox', 'eval_runs') then
        'platform.backend_run_object_matches(app_id, tenant_id, environment, run_id, true)'
      when table_name = 'scorecards' then
        'platform.backend_eval_run_object_matches(app_id, tenant_id, environment, eval_run_id, true)'
      when table_name = 'idempotency_records' then
        'platform.backend_exact_principal_object_matches(app_id, tenant_id, environment, principal_id, true)'
      else
        'platform.backend_context_matches(app_id, tenant_id, environment, true)'
    end;

    execute pg_catalog.format(
      'alter table app_data_agent.%I enable row level security',
      table_name
    );
    execute pg_catalog.format(
      'alter table app_data_agent.%I force row level security',
      table_name
    );
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I for select to data_agent_backend using (%s)',
      table_name || '_backend_select',
      table_name,
      select_predicate
    );
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I for insert to data_agent_backend with check (%s)',
      table_name || '_backend_insert',
      table_name,
      write_predicate
    );
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I for update to data_agent_backend using (%s) with check (%s)',
      table_name || '_backend_update',
      table_name,
      write_predicate,
      write_predicate
    );
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I for delete to data_agent_backend using (%s)',
      table_name || '_backend_delete',
      table_name,
      write_predicate
    );
  end loop;
end
$$;

alter table app_data_agent.secret_provider_effect_receipts
enable row level security;
alter table app_data_agent.secret_provider_effect_receipts
force row level security;

revoke all privileges on all tables in schema app_data_agent
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on all sequences in schema app_data_agent
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on all functions in schema app_data_agent
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;

revoke all privileges on function platform.backend_context_matches(
  uuid,
  uuid,
  text,
  boolean
) from public, anon, authenticated, service_role;
revoke all privileges on function platform.resolve_backend_authority(
  uuid,
  uuid,
  uuid,
  boolean
) from public, anon, authenticated, service_role, data_agent_platform_owner;
revoke all privileges on function platform.revalidate_backend_authority(
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  text,
  bigint,
  bigint,
  boolean
) from public, anon, authenticated, service_role, data_agent_platform_owner;
revoke all privileges on function platform.current_backend_authority(
  boolean
) from public, anon, authenticated, service_role, data_agent_platform_owner;
revoke all privileges on function platform.backend_principal_object_matches(
  uuid,
  uuid,
  text,
  uuid,
  boolean
) from public, anon, authenticated, service_role, data_agent_platform_owner;
revoke all privileges on function platform.backend_exact_principal_object_matches(
  uuid,
  uuid,
  text,
  uuid,
  boolean
) from public, anon, authenticated, service_role, data_agent_platform_owner;
revoke all privileges on function platform.backend_run_object_matches(
  uuid,
  uuid,
  text,
  uuid,
  boolean
) from public, anon, authenticated, service_role, data_agent_platform_owner;
revoke all privileges on function platform.backend_eval_run_object_matches(
  uuid,
  uuid,
  text,
  uuid,
  boolean
) from public, anon, authenticated, service_role, data_agent_platform_owner;
revoke all privileges on function platform.backend_command_object_matches(
  uuid,
  uuid,
  text,
  uuid,
  boolean
) from public, anon, authenticated, service_role, data_agent_platform_owner;
revoke all privileges on function platform.authorize_browser_context(
  uuid,
  uuid,
  boolean
) from public, anon, authenticated, service_role, data_agent_backend;
revoke all privileges on function platform.storage_object_allowed(
  text,
  text,
  boolean
) from public, anon, authenticated, service_role, data_agent_backend;
revoke all privileges on function platform.provision_membership(
  uuid,
  uuid,
  uuid,
  text
) from public, anon, authenticated, service_role, data_agent_backend;
revoke all privileges on function platform.revoke_membership(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role, data_agent_backend;

grant usage on schema platform to data_agent_backend, data_agent_secret_authority;
grant usage on schema app_data_agent
to data_agent_backend, data_agent_platform_owner, data_agent_secret_authority;
grant select on all tables in schema app_data_agent to data_agent_backend;
grant execute on function app_data_agent.contains_potential_plaintext_secret(
  jsonb,
  text
) to data_agent_backend;
grant execute on function app_data_agent.command_payload_is_valid(
  jsonb
) to data_agent_backend;
grant execute on function app_data_agent.advance_run_fence(
  uuid,
  bigint
) to data_agent_backend;
grant execute on function platform.canonical_sha256(jsonb) to data_agent_backend;
grant insert on table
  app_data_agent.runs,
  app_data_agent.commands,
  app_data_agent.idempotency_records,
  app_data_agent.run_events,
  app_data_agent.artifacts,
  app_data_agent.outbox,
  app_data_agent.datasets,
  app_data_agent.eval_cases,
  app_data_agent.eval_runs,
  app_data_agent.scorecards,
  app_data_agent.audit_log
to data_agent_backend;
grant update on table
  app_data_agent.artifacts,
  app_data_agent.datasets,
  app_data_agent.eval_cases,
  app_data_agent.eval_runs
to data_agent_backend;
grant update (active_fence) on table app_data_agent.runs to data_agent_backend;
grant update (status) on table app_data_agent.commands to data_agent_backend;
grant execute on function platform.backend_context_matches(
  uuid,
  uuid,
  text,
  boolean
) to data_agent_backend;
grant execute on function platform.resolve_backend_authority(
  uuid,
  uuid,
  uuid,
  boolean
) to data_agent_backend;
grant execute on function platform.revalidate_backend_authority(
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  text,
  bigint,
  bigint,
  boolean
) to data_agent_backend;
grant execute on function platform.current_backend_authority(
  boolean
) to data_agent_backend;
grant execute on function platform.backend_principal_object_matches(
  uuid,
  uuid,
  text,
  uuid,
  boolean
) to data_agent_backend;
grant execute on function platform.backend_exact_principal_object_matches(
  uuid,
  uuid,
  text,
  uuid,
  boolean
) to data_agent_backend;
grant execute on function platform.backend_run_object_matches(
  uuid,
  uuid,
  text,
  uuid,
  boolean
) to data_agent_backend;
grant execute on function platform.backend_eval_run_object_matches(
  uuid,
  uuid,
  text,
  uuid,
  boolean
) to data_agent_backend;
grant execute on function platform.backend_command_object_matches(
  uuid,
  uuid,
  text,
  uuid,
  boolean
) to data_agent_backend;
grant execute on function app_data_agent.claim_outbox(
  text,
  integer,
  integer
) to data_agent_backend;
grant execute on function app_data_agent.publish_outbox(
  uuid,
  text,
  bigint
) to data_agent_backend;
grant execute on function app_data_agent.retry_outbox(
  uuid,
  text,
  bigint,
  bigint
) to data_agent_backend;
grant execute on function app_data_agent.register_secret_ref(
  uuid,
  text,
  text
) to data_agent_backend;
grant execute on function app_data_agent.request_secret_provider_effect(
  uuid,
  bigint,
  uuid,
  text
) to data_agent_backend;
grant execute on function app_data_agent.finalize_secret_provider_effect(
  uuid,
  bigint,
  uuid
) to data_agent_backend;
grant execute on function app_data_agent.acknowledge_failed_secret_provider_effect(
  uuid,
  bigint,
  uuid
) to data_agent_backend;
grant execute on function platform.canonical_sha256(
  jsonb
) to data_agent_secret_authority;
grant execute on function app_data_agent.compute_secret_provider_receipt_hash(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  text,
  bigint,
  text,
  text
) to data_agent_secret_authority;
grant execute on function app_data_agent.record_secret_provider_effect(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  text,
  bigint,
  text,
  text,
  text,
  text,
  text
) to data_agent_secret_authority;
grant execute on function platform.provision_membership(
  uuid,
  uuid,
  uuid,
  text
) to data_agent_platform_owner;
grant execute on function platform.revoke_membership(
  uuid,
  uuid,
  uuid
) to data_agent_platform_owner;

alter default privileges in schema app_data_agent revoke all privileges on tables from public;
alter default privileges in schema app_data_agent revoke all privileges on sequences from public;
alter default privileges in schema app_data_agent revoke execute on functions from public;

commit;
