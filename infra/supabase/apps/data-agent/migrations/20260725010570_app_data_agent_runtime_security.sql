begin;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010570_app_data_agent_runtime_security',
  'sha256:bae916d2b3b95ce1b5f7b810fe4403a73c9bf95c2e0b1908b62cc7f2f6609f48'
);

alter table app_data_agent.run_attempts enable row level security;
alter table app_data_agent.run_attempts force row level security;
alter table app_data_agent.run_projections enable row level security;
alter table app_data_agent.run_projections force row level security;
alter table app_data_agent.run_checkpoints enable row level security;
alter table app_data_agent.run_checkpoints force row level security;
alter table app_data_agent.run_effect_receipts enable row level security;
alter table app_data_agent.run_effect_receipts force row level security;

create or replace function app_data_agent.lock_owned_run_fence(
  requested_run_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  locked_fence bigint;
  locked_status text;
  latest_projection_status text;
  latest_projection_fence bigint;
  latest_terminal_event_id text;
  attempt_lease_expires_at timestamptz;
  message_lease_expires_at timestamptz;
  lease_checked_at timestamptz;
begin
  if requested_run_id is null then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_FENCE_INPUT_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(true);

  select
    run.active_fence,
    run.status
  into
    locked_fence,
    locked_status
  from app_data_agent.runs as run
  where run.app_id = current_authority.app_id
    and run.tenant_id = current_authority.tenant_id
    and run.environment = current_authority.environment
    and run.run_id = requested_run_id
    and run.principal_id = current_authority.principal_id
  for update;
  if not found or locked_status <> 'RUNNING' then
    return null;
  end if;

  select
    projection.status,
    projection.worker_fence,
    projection.projection_json ->> 'terminal_event_id'
  into
    latest_projection_status,
    latest_projection_fence,
    latest_terminal_event_id
  from app_data_agent.run_projections as projection
  where projection.app_id = current_authority.app_id
    and projection.tenant_id = current_authority.tenant_id
    and projection.environment = current_authority.environment
    and projection.run_id = requested_run_id
  order by projection.version desc
  limit 1;
  if not found
    or latest_projection_status <> 'RUNNING'
    or latest_projection_fence <> locked_fence
    or latest_terminal_event_id is not null
  then
    return null;
  end if;

  select
    attempt.lease_expires_at,
    message.lease_expires_at
  into
    attempt_lease_expires_at,
    message_lease_expires_at
  from app_data_agent.run_attempts as attempt
  join app_data_agent.outbox as message
    on message.app_id = attempt.app_id
   and message.tenant_id = attempt.tenant_id
   and message.environment = attempt.environment
   and message.run_id = attempt.run_id
   and message.outbox_id = attempt.outbox_id
   and message.command_id = attempt.command_id
   and message.active_attempt_id = attempt.attempt_id
  where attempt.app_id = current_authority.app_id
    and attempt.tenant_id = current_authority.tenant_id
    and attempt.environment = current_authority.environment
    and attempt.run_id = requested_run_id
    and attempt.worker_fence = locked_fence
    and attempt.status = 'ACTIVE'
    and message.status = 'LEASED'
    and message.lease_owner = attempt.worker_id
    and message.lease_token = attempt.lease_token
    and message.run_fence = attempt.worker_fence
  for update of attempt, message;
  if not found then
    return null;
  end if;

  lease_checked_at := pg_catalog.clock_timestamp();
  if attempt_lease_expires_at < lease_checked_at
    or message_lease_expires_at < lease_checked_at
  then
    return null;
  end if;
  return locked_fence;
end
$$;

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

create policy run_attempts_backend_select
on app_data_agent.run_attempts
for select
to data_agent_backend
using (
  platform.backend_run_object_matches(
    app_id,
    tenant_id,
    environment,
    run_id,
    false
  )
);

create policy run_projections_backend_select
on app_data_agent.run_projections
for select
to data_agent_backend
using (
  platform.backend_run_object_matches(
    app_id,
    tenant_id,
    environment,
    run_id,
    false
  )
);

create policy run_checkpoints_backend_select
on app_data_agent.run_checkpoints
for select
to data_agent_backend
using (
  platform.backend_run_object_matches(
    app_id,
    tenant_id,
    environment,
    run_id,
    false
  )
);

create policy run_effect_receipts_backend_select
on app_data_agent.run_effect_receipts
for select
to data_agent_backend
using (
  platform.backend_run_object_matches(
    app_id,
    tenant_id,
    environment,
    run_id,
    false
  )
);

revoke all privileges on table
  app_data_agent.run_attempts,
  app_data_agent.run_projections,
  app_data_agent.run_checkpoints,
  app_data_agent.run_effect_receipts
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;

revoke all privileges on function app_data_agent.lock_owned_run_fence(
  uuid
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on function app_data_agent.runtime_canonical_json(
  jsonb
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on function app_data_agent.runtime_canonical_sha256(
  jsonb
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on function app_data_agent.runtime_iso_timestamp(
  timestamptz
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on function
  app_data_agent.reduce_run_projection_document(jsonb, jsonb)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on function
  app_data_agent.prepare_run_event_insert()
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on function
  app_data_agent.create_initial_run_projection()
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on function app_data_agent.claim_run_work(
  text,
  integer,
  integer
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on function app_data_agent.heartbeat_run_work(
  uuid,
  uuid,
  text,
  bigint,
  bigint,
  integer
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on function app_data_agent.append_run_event(
  jsonb,
  jsonb,
  text,
  text,
  jsonb,
  text
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on function app_data_agent.complete_run_work(
  uuid,
  uuid,
  text,
  bigint,
  bigint,
  bigint
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on function app_data_agent.retry_run_work(
  uuid,
  uuid,
  text,
  bigint,
  bigint,
  bigint,
  text,
  bigint
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on function app_data_agent.commit_run_checkpoint(
  jsonb,
  jsonb
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on function app_data_agent.commit_run_effect_receipt(
  jsonb,
  jsonb
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on function app_data_agent.request_run_control(
  jsonb,
  jsonb,
  text,
  text,
  jsonb,
  text
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;
revoke all privileges on function app_data_agent.accept_backend_run_command(
  jsonb,
  text,
  jsonb,
  text
) from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_secret_authority;

grant select on table
  app_data_agent.run_attempts,
  app_data_agent.run_projections,
  app_data_agent.run_checkpoints,
  app_data_agent.run_effect_receipts
to data_agent_backend;

grant execute on function app_data_agent.runtime_canonical_sha256(
  jsonb
) to data_agent_backend;
grant execute on function app_data_agent.runtime_iso_timestamp(
  timestamptz
) to data_agent_backend;
grant execute on function app_data_agent.lock_owned_run_fence(
  uuid
) to data_agent_backend;

grant execute on function app_data_agent.claim_run_work(
  text,
  integer,
  integer
) to data_agent_backend;
grant execute on function app_data_agent.heartbeat_run_work(
  uuid,
  uuid,
  text,
  bigint,
  bigint,
  integer
) to data_agent_backend;
grant execute on function app_data_agent.append_run_event(
  jsonb,
  jsonb,
  text,
  text,
  jsonb,
  text
) to data_agent_backend;
grant execute on function app_data_agent.complete_run_work(
  uuid,
  uuid,
  text,
  bigint,
  bigint,
  bigint
) to data_agent_backend;
grant execute on function app_data_agent.retry_run_work(
  uuid,
  uuid,
  text,
  bigint,
  bigint,
  bigint,
  text,
  bigint
) to data_agent_backend;
grant execute on function app_data_agent.commit_run_checkpoint(
  jsonb,
  jsonb
) to data_agent_backend;
grant execute on function app_data_agent.commit_run_effect_receipt(
  jsonb,
  jsonb
) to data_agent_backend;
grant execute on function app_data_agent.request_run_control(
  jsonb,
  jsonb,
  text,
  text,
  jsonb,
  text
) to data_agent_backend;
grant execute on function app_data_agent.accept_backend_run_command(
  jsonb,
  text,
  jsonb,
  text
) to data_agent_backend;
grant execute on function api.data_agent__accept_run_command(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  text
) to authenticated;
commit;
