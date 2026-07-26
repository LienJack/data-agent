begin;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010510_app_data_agent_runtime_projection_invariants',
  'sha256:42513053d9791730a8b75c32cdff5be0310fac352870ec22fcf2dd520cdc32e1'
);

create or replace function app_data_agent.create_initial_run_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  initial_projection jsonb;
begin
  if new.sequence <> 1
    or new.worker_fence <> 0
    or new.event_type <> 'run.accepted'
  then
    return new;
  end if;

  initial_projection := pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
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
    'status',
    'QUEUED',
    'version',
    1,
    'worker_fence',
    0,
    'attempt_count',
    0,
    'last_event_id',
    new.event_id,
    'last_occurred_at',
    new.event_document -> 'occurred_at',
    'active_artifact_ref',
    null,
    'active_snapshot_ref',
    null,
    'last_side_effect_receipt_id',
    null,
    'terminal_event_id',
    null
  );

  insert into app_data_agent.run_projections (
    app_id,
    tenant_id,
    environment,
    run_id,
    version,
    status,
    worker_fence,
    event_id,
    projection_hash,
    projection_json,
    occurred_at
  )
  values (
    new.app_id,
    new.tenant_id,
    new.environment,
    new.run_id,
    1,
    'QUEUED',
    0,
    new.event_id,
    app_data_agent.runtime_canonical_sha256(initial_projection),
    initial_projection,
    new.created_at
  )
  on conflict (app_id, tenant_id, environment, run_id, version)
  do nothing;
  return new;
end
$$;

create trigger run_event_initial_projection
after insert on app_data_agent.run_events
for each row execute function app_data_agent.create_initial_run_projection();

with latest_event as (
  select distinct on (
    event.app_id,
    event.tenant_id,
    event.environment,
    event.run_id
  )
    event.app_id,
    event.tenant_id,
    event.environment,
    event.run_id,
    event.event_id,
    event.sequence,
    event.worker_fence,
    event.created_at,
    run.status as run_status
  from app_data_agent.run_events as event
  join app_data_agent.runs as run
    on run.app_id = event.app_id
   and run.tenant_id = event.tenant_id
   and run.environment = event.environment
   and run.run_id = event.run_id
  order by
    event.app_id,
    event.tenant_id,
    event.environment,
    event.run_id,
    event.sequence desc
),
documents as (
  select
    latest.*,
    pg_catalog.jsonb_build_object(
      'schema_version',
      '1.0.0',
      'scope',
      pg_catalog.jsonb_build_object(
        'app_id',
        latest.app_id,
        'tenant_id',
        latest.tenant_id,
        'environment',
        latest.environment
      ),
      'run_id',
      latest.run_id,
      'status',
      case latest.run_status
        when 'SUCCEEDED' then 'COMPLETED'
        else latest.run_status
      end,
      'version',
      latest.sequence,
      'worker_fence',
      latest.worker_fence,
      'attempt_count',
      0,
      'last_event_id',
      latest.event_id,
      'last_occurred_at',
      app_data_agent.runtime_iso_timestamp(latest.created_at),
      'active_artifact_ref',
      null,
      'active_snapshot_ref',
      null,
      'last_side_effect_receipt_id',
      null,
      'terminal_event_id',
      case
        when latest.run_status in ('SUCCEEDED', 'FAILED', 'CANCELLED')
          then latest.event_id
        else null
      end
    ) as projection_json
  from latest_event as latest
)
insert into app_data_agent.run_projections (
  app_id,
  tenant_id,
  environment,
  run_id,
  version,
  status,
  worker_fence,
  event_id,
  projection_hash,
  projection_json,
  occurred_at
)
select
  document.app_id,
  document.tenant_id,
  document.environment,
  document.run_id,
  document.sequence,
  case document.run_status
    when 'SUCCEEDED' then 'COMPLETED'
    else document.run_status
  end,
  document.worker_fence,
  document.event_id,
  app_data_agent.runtime_canonical_sha256(document.projection_json),
  document.projection_json,
  document.created_at
from documents as document
on conflict (app_id, tenant_id, environment, run_id, version)
do nothing;

create or replace function app_data_agent.guard_run_attempt_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'P0001',
      message = 'DA_RUN_ATTEMPT_IMMUTABLE';
  end if;

  if old.status = 'ACTIVE'
    and new.status = 'ACTIVE'
    and new.lease_expires_at > old.lease_expires_at
    and new.last_heartbeat_at > old.last_heartbeat_at
    and (
      pg_catalog.to_jsonb(new)
        - array['lease_expires_at', 'last_heartbeat_at']
    ) = (
      pg_catalog.to_jsonb(old)
        - array['lease_expires_at', 'last_heartbeat_at']
    )
  then
    return new;
  end if;

  if old.status = 'ACTIVE'
    and new.status in (
      'SUCCEEDED',
      'FAILED',
      'RETRY_SCHEDULED',
      'SUSPENDED',
      'CANCELLED',
      'EXPIRED'
    )
    and new.finished_at is not null
    and (
      pg_catalog.to_jsonb(new)
        - array['status', 'finished_at', 'error_code', 'retry_at']
    ) = (
      pg_catalog.to_jsonb(old)
        - array['status', 'finished_at', 'error_code', 'retry_at']
    )
  then
    return new;
  end if;

  raise exception using
    errcode = 'P0001',
    message = 'DA_RUN_ATTEMPT_IMMUTABLE';
end
$$;

create trigger run_attempts_guard
before update or delete on app_data_agent.run_attempts
for each row execute function app_data_agent.guard_run_attempt_transition();

create or replace function app_data_agent.guard_run_fence_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'P0001',
      message = 'DA_RUN_IMMUTABLE';
  end if;

  if new.next_queue_sequence = old.next_queue_sequence + 1
    and new.updated_at > old.updated_at
    and (
      pg_catalog.to_jsonb(new)
        - array['next_queue_sequence', 'updated_at']
    ) = (
      pg_catalog.to_jsonb(old)
        - array['next_queue_sequence', 'updated_at']
    )
  then
    return new;
  end if;

  if new.updated_at <= old.updated_at
    or (
      pg_catalog.to_jsonb(new)
        - array['status', 'active_fence', 'updated_at']
    ) is distinct from (
      pg_catalog.to_jsonb(old)
        - array['status', 'active_fence', 'updated_at']
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'DA_RUN_IMMUTABLE';
  end if;

  if new.status = old.status
    and new.active_fence = old.active_fence + 1
  then
    return new;
  end if;
  if old.status in ('QUEUED', 'RUNNING')
    and new.status = 'RUNNING'
    and new.active_fence = old.active_fence + 1
  then
    return new;
  end if;
  if old.status in ('QUEUED', 'RUNNING', 'WAITING')
    and new.status = 'CANCELLED'
    and new.active_fence = old.active_fence + 1
  then
    return new;
  end if;
  if (
    (old.status = 'RUNNING' and new.status in ('QUEUED', 'WAITING', 'SUCCEEDED', 'FAILED'))
    or (old.status = 'WAITING' and new.status = 'QUEUED')
  )
    and new.active_fence = old.active_fence
  then
    return new;
  end if;

  raise exception using
    errcode = 'P0001',
    message = 'DA_RUN_STATUS_TRANSITION_INVALID';
end
$$;

create or replace function app_data_agent.guard_outbox_fence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'P0001',
      message = 'DA_OUTBOX_IMMUTABLE';
  end if;

  if old.status in ('PUBLISHED', 'DEAD_LETTER') then
    raise exception using
      errcode = 'P0001',
      message = 'DA_OUTBOX_TERMINAL';
  end if;

  if new.queue_sequence is distinct from old.queue_sequence then
    raise exception using
      errcode = 'P0001',
      message = 'DA_OUTBOX_QUEUE_SEQUENCE_IMMUTABLE';
  end if;

  if new.status = 'LEASED'
    and new.attempt_count = old.attempt_count + 1
    and new.lease_token = old.lease_token + 1
    and new.run_fence = old.run_fence
    and new.active_attempt_id is not distinct from old.active_attempt_id
    and new.last_heartbeat_at is not distinct from old.last_heartbeat_at
    and new.lease_owner is not null
    and new.lease_expires_at is not null
    and (
      pg_catalog.to_jsonb(new) - array[
        'status',
        'attempt_count',
        'lease_owner',
        'lease_token',
        'lease_expires_at',
        'published_at',
        'claimable_at'
      ]
    ) = (
      pg_catalog.to_jsonb(old) - array[
        'status',
        'attempt_count',
        'lease_owner',
        'lease_token',
        'lease_expires_at',
        'published_at',
        'claimable_at'
      ]
    )
  then
    return new;
  end if;

  if new.status = 'LEASED'
    and new.attempt_count = old.attempt_count + 1
    and new.lease_token = old.lease_token + 1
    and new.run_fence > old.run_fence
    and new.active_attempt_id is not null
    and new.lease_owner is not null
    and new.lease_expires_at is not null
    and new.last_heartbeat_at is not null
    and (
      pg_catalog.to_jsonb(new) - array[
        'status',
        'attempt_count',
        'lease_owner',
        'lease_token',
        'lease_expires_at',
        'published_at',
        'active_attempt_id',
        'run_fence',
        'last_heartbeat_at',
        'claimable_at'
      ]
    ) = (
      pg_catalog.to_jsonb(old) - array[
        'status',
        'attempt_count',
        'lease_owner',
        'lease_token',
        'lease_expires_at',
        'published_at',
        'active_attempt_id',
        'run_fence',
        'last_heartbeat_at',
        'claimable_at'
      ]
    )
  then
    return new;
  end if;

  if old.status = 'LEASED'
    and new.status = 'LEASED'
    and new.lease_expires_at > old.lease_expires_at
    and new.last_heartbeat_at > old.last_heartbeat_at
    and (
      pg_catalog.to_jsonb(new)
        - array['lease_expires_at', 'last_heartbeat_at', 'claimable_at']
    ) = (
      pg_catalog.to_jsonb(old)
        - array['lease_expires_at', 'last_heartbeat_at', 'claimable_at']
    )
  then
    return new;
  end if;

  if old.status = 'LEASED'
    and new.status = 'PUBLISHED'
    and new.published_at is not null
    and new.lease_owner is null
    and new.lease_expires_at is null
    and (
      pg_catalog.to_jsonb(new)
        - array[
          'status',
          'published_at',
          'lease_owner',
          'lease_expires_at',
          'claimable_at'
        ]
    ) = (
      pg_catalog.to_jsonb(old)
        - array[
          'status',
          'published_at',
          'lease_owner',
          'lease_expires_at',
          'claimable_at'
        ]
    )
  then
    return new;
  end if;

  if old.status = 'LEASED'
    and new.status = 'PENDING'
    and new.available_at >= old.available_at
    and new.lease_owner is null
    and new.lease_expires_at is null
    and new.published_at is null
    and (
      pg_catalog.to_jsonb(new) - array[
        'status',
        'available_at',
        'lease_owner',
        'lease_expires_at',
        'published_at',
        'claimable_at'
      ]
    ) = (
      pg_catalog.to_jsonb(old) - array[
        'status',
        'available_at',
        'lease_owner',
        'lease_expires_at',
        'published_at',
        'claimable_at'
      ]
    )
  then
    return new;
  end if;

  if new.status = 'DEAD_LETTER'
    and old.status in ('PENDING', 'FAILED', 'LEASED')
    and new.lease_owner is null
    and new.lease_expires_at is null
    and (
      pg_catalog.to_jsonb(new)
        - array['status', 'lease_owner', 'lease_expires_at', 'claimable_at']
    ) = (
      pg_catalog.to_jsonb(old)
        - array['status', 'lease_owner', 'lease_expires_at', 'claimable_at']
    )
  then
    return new;
  end if;

  raise exception using
    errcode = 'P0001',
    message = 'DA_OUTBOX_IMMUTABLE';
end
$$;

drop trigger outbox_fence_guard on app_data_agent.outbox;
create trigger outbox_fence_guard
before update or delete on app_data_agent.outbox
for each row execute function app_data_agent.guard_outbox_fence();

create trigger run_projections_immutable
before update or delete on app_data_agent.run_projections
for each row execute function platform.reject_immutable_mutation();

create trigger run_checkpoints_immutable
before update or delete on app_data_agent.run_checkpoints
for each row execute function platform.reject_immutable_mutation();

create trigger run_effect_receipts_immutable
before update or delete on app_data_agent.run_effect_receipts
for each row execute function platform.reject_immutable_mutation();

commit;
