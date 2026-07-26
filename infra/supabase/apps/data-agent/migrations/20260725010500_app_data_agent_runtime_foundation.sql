begin;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010500_app_data_agent_runtime_foundation',
  'sha256:e4b86650889a456f2911073e49d61356e5b58467f80ab01986518c5c06aa7185'
);

set local lock_timeout = '5s';

do $$
begin
  if exists (select 1 from app_data_agent.runs limit 1)
    or exists (select 1 from app_data_agent.commands limit 1)
    or exists (select 1 from app_data_agent.run_events limit 1)
    or exists (select 1 from app_data_agent.outbox limit 1)
  then
    raise exception using
      errcode = '55000',
      message = 'DA_U4_RESET_REQUIRES_EMPTY_RUNTIME',
      detail =
        'U4 是 reset-only schema contract，不支持把旧 Run/Command/Event/Outbox 原地升级。',
      hint =
        '导出并归档旧 Runtime 数据，在新的 App Scope/Environment 安装；不要重放旧事件为新 L2 交付证据。';
  end if;
end
$$;

-- Database-owned canonical form for persisted Runtime envelopes. Callers
-- propagate the returned digest; they do not reproduce it with JSON.stringify.
create or replace function app_data_agent.runtime_canonical_json(
  requested_value jsonb
)
returns text
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  canonical_value text;
begin
  case pg_catalog.jsonb_typeof(requested_value)
    when 'object' then
      select
        '{' || coalesce(
          pg_catalog.string_agg(
            pg_catalog.to_json(entry.key)::text || ':' ||
              app_data_agent.runtime_canonical_json(entry.value),
            ','
            order by (
              select coalesce(
                pg_catalog.string_agg(
                  case
                    when pg_catalog.ascii(
                      pg_catalog.substr(
                        entry.key,
                        character.codepoint_index,
                        1
                      )
                    ) <= 65535
                    then pg_catalog.lpad(
                      pg_catalog.to_hex(
                        pg_catalog.ascii(
                          pg_catalog.substr(
                            entry.key,
                            character.codepoint_index,
                            1
                          )
                        )
                      ),
                      4,
                      '0'
                    )
                    else
                      pg_catalog.lpad(
                        pg_catalog.to_hex(
                          55296 + (
                            (
                              pg_catalog.ascii(
                                pg_catalog.substr(
                                  entry.key,
                                  character.codepoint_index,
                                  1
                                )
                              ) - 65536
                            ) / 1024
                          )
                        ),
                        4,
                        '0'
                      ) ||
                      pg_catalog.lpad(
                        pg_catalog.to_hex(
                          56320 + (
                            (
                              pg_catalog.ascii(
                                pg_catalog.substr(
                                  entry.key,
                                  character.codepoint_index,
                                  1
                                )
                              ) - 65536
                            ) % 1024
                          )
                        ),
                        4,
                        '0'
                      )
                  end,
                  ''
                  order by character.codepoint_index
                ),
                ''
              )
              from pg_catalog.generate_series(
                1,
                pg_catalog.char_length(entry.key)
              ) as character(codepoint_index)
            ) collate pg_catalog."C"
          ),
          ''
        ) || '}'
      into canonical_value
      from pg_catalog.jsonb_each(requested_value) as entry(key, value);
    when 'array' then
      select
        '[' || coalesce(
          pg_catalog.string_agg(
            app_data_agent.runtime_canonical_json(element.value),
            ','
            order by element.ordinality
          ),
          ''
        ) || ']'
      into canonical_value
      from pg_catalog.jsonb_array_elements(requested_value)
        with ordinality as element(value, ordinality);
    else
      canonical_value := requested_value::text;
  end case;
  return canonical_value;
end
$$;

create or replace function app_data_agent.runtime_canonical_sha256(
  requested_value jsonb
)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select 'sha256:' || pg_catalog.encode(
    pg_catalog.sha256(
      pg_catalog.convert_to(
        app_data_agent.runtime_canonical_json(requested_value),
        'UTF8'
      )
    ),
    'hex'
  )
$$;

create or replace function app_data_agent.runtime_iso_timestamp(
  requested_value timestamptz
)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select pg_catalog.to_char(
    requested_value at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  )
$$;

create or replace function app_data_agent.reduce_run_projection_document(
  current_projection jsonb,
  requested_event jsonb
)
returns jsonb
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  event_type text;
  payload jsonb;
  expected_projection jsonb;
begin
  if pg_catalog.jsonb_typeof(current_projection) <> 'object'
    or pg_catalog.jsonb_typeof(requested_event) <> 'object'
    or pg_catalog.jsonb_typeof(requested_event -> 'payload') <> 'object'
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_PROJECTION_REDUCER_INPUT_INVALID';
  end if;

  event_type := requested_event ->> 'event_type';
  payload := requested_event -> 'payload';

  expected_projection := current_projection || pg_catalog.jsonb_build_object(
    'version',
    (requested_event ->> 'sequence')::bigint,
    'worker_fence',
    (requested_event ->> 'worker_fence')::bigint,
    'last_event_id',
    requested_event ->> 'event_id',
    'last_occurred_at',
    requested_event -> 'occurred_at'
  );

  case event_type
    when 'run.leased' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object(
          'status',
          'RUNNING',
          'attempt_count',
          (payload ->> 'attempt')::bigint
        );
    when 'run.checkpointed' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object(
          'active_artifact_ref',
          payload -> 'active_artifact_ref',
          'active_snapshot_ref',
          payload -> 'snapshot_ref'
        );
    when 'run.side_effect_committed' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object(
          'last_side_effect_receipt_id',
          payload ->> 'receipt_id'
        );
    when 'run.suspended' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object('status', 'WAITING');
    when 'run.resumed' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object('status', 'QUEUED');
    when 'run.retry_scheduled' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object('status', 'QUEUED');
    when 'run.cancel_requested' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object(
          'status',
          'CANCELLED',
          'terminal_event_id',
          requested_event ->> 'event_id'
        );
    when 'run.completed' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object(
          'status',
          'COMPLETED',
          'terminal_event_id',
          requested_event ->> 'event_id'
        );
    when 'run.failed' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object(
          'status',
          'FAILED',
          'terminal_event_id',
          requested_event ->> 'event_id'
        );
    else
      raise exception using
        errcode = '22023',
        message = 'DA_RUN_PROJECTION_REDUCER_EVENT_INVALID';
  end case;

  return expected_projection;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_PROJECTION_REDUCER_INPUT_INVALID';
end
$$;

create table app_data_agent.run_attempts (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  outbox_id uuid not null,
  command_id uuid not null,
  attempt_id uuid not null,
  attempt_no integer not null check (attempt_no >= 1),
  worker_id text not null
    check (
      worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
      and not app_data_agent.contains_potential_plaintext_secret(
        pg_catalog.to_jsonb(worker_id),
        'worker_id'
      )
    ),
  lease_token bigint not null check (lease_token >= 1),
  worker_fence bigint not null check (worker_fence >= 1),
  status text not null default 'ACTIVE'
    check (
      status in (
        'ACTIVE',
        'SUCCEEDED',
        'FAILED',
        'RETRY_SCHEDULED',
        'SUSPENDED',
        'CANCELLED',
        'EXPIRED'
      )
    ),
  lease_expires_at timestamptz not null,
  last_heartbeat_at timestamptz not null,
  error_code text
    check (
      error_code is null
      or error_code ~ '^[A-Za-z][A-Za-z0-9._:@/-]{0,127}$'
    ),
  retry_at timestamptz,
  started_at timestamptz not null default pg_catalog.clock_timestamp(),
  finished_at timestamptz,
  primary key (app_id, tenant_id, environment, attempt_id),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id)
    on delete restrict,
  foreign key (app_id, tenant_id, environment, outbox_id)
    references app_data_agent.outbox (
      app_id,
      tenant_id,
      environment,
      outbox_id
    )
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
  unique (app_id, tenant_id, environment, run_id, attempt_no),
  unique (
    app_id,
    tenant_id,
    environment,
    attempt_id,
    outbox_id,
    run_id
  ),
  check (
    (status = 'ACTIVE' and finished_at is null)
    or (status <> 'ACTIVE' and finished_at is not null)
  ),
  check (
    (status = 'RETRY_SCHEDULED' and retry_at is not null and error_code is not null)
    or (status <> 'RETRY_SCHEDULED')
  )
);

create unique index run_attempts_one_active_per_run
on app_data_agent.run_attempts (app_id, tenant_id, environment, run_id)
where status = 'ACTIVE';

alter table app_data_agent.runs
add column next_queue_sequence bigint not null default 1
  check (next_queue_sequence >= 1);

alter table app_data_agent.outbox
add column active_attempt_id uuid,
add column run_fence bigint not null default 0 check (run_fence >= 0),
add column last_heartbeat_at timestamptz,
add column queue_sequence bigint not null,
add column claimable_at timestamptz generated always as (
  case
    when status = 'LEASED' then lease_expires_at
    else available_at
  end
) stored not null,
add constraint outbox_queue_sequence_positive
check (queue_sequence >= 1);

create index outbox_runtime_normal_claim_scope
on app_data_agent.outbox (
  app_id,
  tenant_id,
  environment,
  claimable_at,
  created_at,
  outbox_id
)
include (
  run_id,
  command_id,
  topic,
  status,
  attempt_count,
  lease_expires_at,
  active_attempt_id,
  queue_sequence
)
where topic in ('run.command.accepted', 'run.work.resume')
  and (
    status in ('PENDING', 'FAILED')
    or (status = 'LEASED' and attempt_count < 5)
  );

create index outbox_runtime_exhausted_claim_scope
on app_data_agent.outbox (
  app_id,
  tenant_id,
  environment,
  claimable_at,
  created_at,
  outbox_id
)
include (
  run_id,
  command_id,
  topic,
  status,
  attempt_count,
  lease_expires_at,
  active_attempt_id,
  queue_sequence
)
where topic in ('run.command.accepted', 'run.work.resume')
  and status = 'LEASED'
  and attempt_count >= 5;

create index outbox_runtime_per_run_order
on app_data_agent.outbox (
  app_id,
  tenant_id,
  environment,
  run_id,
  queue_sequence
)
include (outbox_id, command_id, topic, status)
where topic in ('run.command.accepted', 'run.work.resume')
  and status in ('PENDING', 'FAILED', 'LEASED');

create unique index outbox_runtime_run_sequence_unique
on app_data_agent.outbox (
  app_id,
  tenant_id,
  environment,
  run_id,
  queue_sequence
);

alter table app_data_agent.outbox
add constraint outbox_active_attempt_fk
foreign key (
  app_id,
  tenant_id,
  environment,
  active_attempt_id,
  outbox_id,
  run_id
)
references app_data_agent.run_attempts (
  app_id,
  tenant_id,
  environment,
  attempt_id,
  outbox_id,
  run_id
)
on delete restrict;

alter table app_data_agent.run_events
add column attempt_id uuid,
add column command_id uuid,
add column dedupe_key text,
add column event_hash text,
add column worker_fence bigint not null default 0 check (worker_fence >= 0),
add column event_document jsonb;

alter table app_data_agent.run_events
add constraint run_events_attempt_fk
foreign key (app_id, tenant_id, environment, attempt_id)
references app_data_agent.run_attempts (
  app_id,
  tenant_id,
  environment,
  attempt_id
)
on delete restrict;

alter table app_data_agent.run_events
add constraint run_events_command_fk
foreign key (app_id, tenant_id, environment, command_id, run_id)
references app_data_agent.commands (
  app_id,
  tenant_id,
  environment,
  command_id,
  run_id
)
on delete restrict;

create or replace function app_data_agent.prepare_run_event_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  payload_command_id text;
  payload_hash text;
  expected_document jsonb;
begin
  if new.event_type = 'command.accepted' then
    if new.sequence <> 1 or new.worker_fence <> 0 then
      raise exception using
        errcode = '22023',
        message = 'DA_RUN_LEGACY_EVENT_UNSUPPORTED';
    end if;
    payload_command_id := coalesce(
      new.payload_json ->> 'command_id',
      new.payload_json ->> 'commandId'
    );
    payload_hash := coalesce(
      new.payload_json ->> 'payload_hash',
      new.payload_json ->> 'payloadHash'
    );
    if payload_command_id is null
      or payload_command_id !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or payload_hash is null
      or payload_hash !~ '^sha256:[0-9a-f]{64}$'
    then
      raise exception using
        errcode = '22023',
        message = 'DA_RUN_LEGACY_EVENT_INVALID';
    end if;
    new.event_type := 'run.accepted';
    new.command_id := payload_command_id::uuid;
    new.payload_json := pg_catalog.jsonb_build_object(
      'command_id',
      payload_command_id,
      'payload_hash',
      payload_hash
    );
    new.dedupe_key := 'event:' || new.event_id::text;
  end if;

  if new.dedupe_key is null then
    new.dedupe_key := 'event:' || new.event_id::text;
  end if;
  if pg_catalog.length(new.dedupe_key) not between 1 and 256 then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_DEDUPE_INVALID';
  end if;

  if new.command_id is null then
    payload_command_id := coalesce(
      new.payload_json ->> 'command_id',
      new.payload_json ->> 'commandId'
    );
    if payload_command_id is not null
      and payload_command_id ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then
      new.command_id := payload_command_id::uuid;
    end if;
  end if;

  expected_document := pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'event_id',
    new.event_id,
    'scope',
    pg_catalog.jsonb_build_object(
      'app_id',
      new.app_id,
      'tenant_id',
      new.tenant_id,
      'environment',
      new.environment
    ),
    'run_id',
    new.run_id,
    'sequence',
    new.sequence,
    'worker_fence',
    new.worker_fence,
    'idempotency_key',
    new.dedupe_key,
    'occurred_at',
    app_data_agent.runtime_iso_timestamp(new.created_at),
    'event_type',
    new.event_type,
    'payload',
    new.payload_json
  );

  if new.event_document is null then
    new.event_document := expected_document;
  elsif new.event_document <> expected_document then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_DOCUMENT_MISMATCH';
  end if;

  if pg_catalog.jsonb_typeof(new.event_document) <> 'object'
    or app_data_agent.contains_potential_plaintext_secret(new.event_document)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_DOCUMENT_INVALID';
  end if;

  if new.event_type not in (
    'run.accepted',
    'run.leased',
    'run.checkpointed',
    'run.side_effect_committed',
    'run.suspended',
    'run.resumed',
    'run.retry_scheduled',
    'run.cancel_requested',
    'run.completed',
    'run.failed'
  ) then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_TYPE_INVALID';
  end if;
  if new.event_type = 'run.accepted'
    and (new.sequence <> 1 or new.worker_fence <> 0)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_ACCEPTED_EVENT_INVALID';
  end if;
  if current_user = 'data_agent_backend'
    and new.event_type <> 'run.accepted'
  then
    raise exception using
      errcode = '42501',
      message = 'DA_RUN_EVENT_DIRECT_WRITE_FORBIDDEN';
  end if;

  if new.event_hash is null then
    new.event_hash :=
      app_data_agent.runtime_canonical_sha256(new.event_document);
  end if;
  if new.event_hash !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_HASH_INVALID';
  end if;
  if new.event_hash <>
    app_data_agent.runtime_canonical_sha256(new.event_document)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_HASH_MISMATCH';
  end if;
  return new;
end
$$;

create trigger run_event_prepare
before insert on app_data_agent.run_events
for each row execute function app_data_agent.prepare_run_event_insert();

do $$
begin
  if exists (
    select 1
    from app_data_agent.run_events as event
    where event.event_type = 'command.accepted'
      and (event.sequence <> 1 or event.worker_fence <> 0)
  ) then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_LEGACY_EVENT_UNSUPPORTED';
  end if;
end
$$;

update app_data_agent.run_events
set event_type = 'run.accepted',
    command_id = coalesce(
      payload_json ->> 'command_id',
      payload_json ->> 'commandId'
    )::uuid,
    payload_json = pg_catalog.jsonb_build_object(
      'command_id',
      coalesce(
        payload_json ->> 'command_id',
        payload_json ->> 'commandId'
      ),
      'payload_hash',
      coalesce(
        payload_json ->> 'payload_hash',
        payload_json ->> 'payloadHash'
      )
    )
where event_type = 'command.accepted';

update app_data_agent.run_events
set dedupe_key = coalesce(dedupe_key, 'event:' || event_id::text),
    event_document = pg_catalog.jsonb_build_object(
      'schema_version',
      '1.0.0',
      'event_id',
      event_id,
      'scope',
      pg_catalog.jsonb_build_object(
        'app_id',
        app_id,
        'tenant_id',
        tenant_id,
        'environment',
        environment
      ),
      'run_id',
      run_id,
      'sequence',
      sequence,
      'worker_fence',
      worker_fence,
      'idempotency_key',
      coalesce(dedupe_key, 'event:' || event_id::text),
      'occurred_at',
      app_data_agent.runtime_iso_timestamp(created_at),
      'event_type',
      event_type,
      'payload',
      payload_json
    );

update app_data_agent.run_events
set event_hash = app_data_agent.runtime_canonical_sha256(event_document);

alter table app_data_agent.run_events
alter column dedupe_key set not null,
alter column event_hash set not null,
alter column event_document set not null;

alter table app_data_agent.run_events
add constraint run_events_event_hash_valid
check (
  event_hash ~ '^sha256:[0-9a-f]{64}$'
  and event_hash =
    app_data_agent.runtime_canonical_sha256(event_document)
),
add constraint run_events_dedupe_key_valid
check (pg_catalog.length(dedupe_key) between 1 and 256),
add constraint run_events_document_valid
check (
  pg_catalog.jsonb_typeof(event_document) = 'object'
  and not app_data_agent.contains_potential_plaintext_secret(event_document)
);

create unique index run_events_dedupe
on app_data_agent.run_events (
  app_id,
  tenant_id,
  environment,
  run_id,
  dedupe_key
);

create unique index run_events_run_event_identity
on app_data_agent.run_events (
  app_id,
  tenant_id,
  environment,
  run_id,
  event_id
);

create table app_data_agent.run_projections (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  version bigint not null check (version >= 1),
  status text not null
    check (
      status in (
        'QUEUED',
        'RUNNING',
        'WAITING',
        'COMPLETED',
        'FAILED',
        'CANCELLED'
      )
    ),
  worker_fence bigint not null check (worker_fence >= 0),
  event_id uuid not null,
  projection_hash text not null
    check (projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  projection_json jsonb not null
    check (
      pg_catalog.jsonb_typeof(projection_json) = 'object'
      and not app_data_agent.contains_potential_plaintext_secret(projection_json)
    ),
  occurred_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (
    projection_hash =
      app_data_agent.runtime_canonical_sha256(projection_json)
  ),
  primary key (app_id, tenant_id, environment, run_id, version),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id)
    on delete restrict,
  foreign key (app_id, tenant_id, environment, run_id, event_id)
    references app_data_agent.run_events (
      app_id,
      tenant_id,
      environment,
      run_id,
      event_id
    )
    on delete restrict,
  unique (
    app_id,
    tenant_id,
    environment,
    run_id,
    projection_hash
  )
);

create index run_projections_latest
on app_data_agent.run_projections (
  app_id,
  tenant_id,
  environment,
  run_id,
  version desc
);

create table app_data_agent.run_checkpoints (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  attempt_id uuid not null,
  snapshot_id uuid not null,
  snapshot_version integer not null check (snapshot_version >= 1),
  snapshot_hash text not null check (snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  event_sequence bigint not null check (event_sequence >= 1),
  worker_fence bigint not null check (worker_fence >= 1),
  binding_json jsonb not null
    check (
      pg_catalog.jsonb_typeof(binding_json) = 'object'
      and not app_data_agent.contains_potential_plaintext_secret(binding_json)
    ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (
    app_id,
    tenant_id,
    environment,
    run_id,
    snapshot_id,
    snapshot_version
  ),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id)
    on delete restrict,
  foreign key (app_id, tenant_id, environment, attempt_id)
    references app_data_agent.run_attempts (
      app_id,
      tenant_id,
      environment,
      attempt_id
    )
    on delete restrict,
  unique (app_id, tenant_id, environment, run_id, snapshot_hash)
);

create index run_checkpoints_latest
on app_data_agent.run_checkpoints (
  app_id,
  tenant_id,
  environment,
  run_id,
  event_sequence desc,
  snapshot_version desc
);

create table app_data_agent.run_effect_receipts (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  attempt_id uuid not null,
  receipt_id uuid not null,
  effect_kind text not null check (effect_kind in ('SQL', 'EVAL')),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  output_hash text not null check (output_hash ~ '^sha256:[0-9a-f]{64}$'),
  worker_fence bigint not null check (worker_fence >= 1),
  receipt_json jsonb not null
    check (
      pg_catalog.jsonb_typeof(receipt_json) = 'object'
      and not app_data_agent.contains_potential_plaintext_secret(receipt_json)
    ),
  committed_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, receipt_id),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id)
    on delete restrict,
  foreign key (app_id, tenant_id, environment, attempt_id)
    references app_data_agent.run_attempts (
      app_id,
      tenant_id,
      environment,
      attempt_id
    )
    on delete restrict,
  unique (
    app_id,
    tenant_id,
    environment,
    run_id,
    effect_kind,
    input_hash
  )
);

-- Fail closed from the first U4 prefix onward. Browser writes, backend direct
-- table mutations, and the legacy outbox/fence APIs stay revoked until the
-- final security migration restores only the intended forward APIs.
revoke all privileges on function api.data_agent__create_run(
  uuid,
  uuid,
  uuid,
  text
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on function api.data_agent__accept_run_command(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  text
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on function api.data_agent__submit_command(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  jsonb,
  text
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on function api.data_agent__get_run(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;

revoke insert on table
  app_data_agent.runs,
  app_data_agent.commands,
  app_data_agent.idempotency_records,
  app_data_agent.run_events,
  app_data_agent.outbox,
  app_data_agent.audit_log
from data_agent_backend;

revoke update (active_fence) on table app_data_agent.runs
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke update (status) on table app_data_agent.commands
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke update (next_queue_sequence) on table app_data_agent.runs
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;

revoke all privileges on function app_data_agent.claim_outbox(
  text,
  integer,
  integer
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;
revoke all privileges on function app_data_agent.publish_outbox(
  uuid,
  text,
  bigint
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;
revoke all privileges on function app_data_agent.retry_outbox(
  uuid,
  text,
  bigint,
  bigint
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;
revoke all privileges on function app_data_agent.advance_run_fence(
  uuid,
  bigint
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_platform_owner, data_agent_job_authority,
  data_agent_secret_authority;

commit;
