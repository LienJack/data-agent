\set ON_ERROR_STOP on

begin;

select pg_catalog.set_config(
  'data_agent.app_id',
  '00000000-0000-4000-8000-00000000da01',
  true
);
select pg_catalog.set_config(
  'data_agent.tenant_id',
  '00000000-0000-4000-8000-00000000aa11',
  true
);
select pg_catalog.set_config('data_agent.environment', 'test', true);
select pg_catalog.set_config(
  'data_agent.principal_id',
  '00000000-0000-4000-8000-000000001001',
  true
);
select pg_catalog.set_config('data_agent.role', 'owner', true);
select pg_catalog.set_config(
  'data_agent.deployment_id',
  '00000000-0000-4000-8000-00000000de01',
  true
);

insert into app_data_agent.runs (
  app_id,
  tenant_id,
  environment,
  run_id,
  principal_id,
  status,
  active_fence,
  question,
  next_queue_sequence,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test',
  '00000000-0000-4000-8000-00000000a2e0',
  '00000000-0000-4000-8000-000000001001',
  'WAITING',
  1,
  'U4 concurrent resume counter probe',
  2,
  '2026-07-25T00:02:00.000Z',
  '2026-07-25T00:02:00.000Z'
);

insert into app_data_agent.commands (
  app_id,
  tenant_id,
  environment,
  command_id,
  run_id,
  principal_id,
  idempotency_key,
  payload_json,
  payload_hash,
  status,
  created_at
)
values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test',
  '00000000-0000-4000-8000-00000000c2e0',
  '00000000-0000-4000-8000-00000000a2e0',
  '00000000-0000-4000-8000-000000001001',
  'runtime-u4-concurrent-resume-base',
  '{"kind":"START_L2_RESEARCH","mode":"L2"}'::jsonb,
  platform.canonical_sha256(
    '{"kind":"START_L2_RESEARCH","mode":"L2"}'::jsonb
  ),
  'SUCCEEDED',
  '2026-07-25T00:02:00.000Z'
);

insert into app_data_agent.outbox (
  app_id,
  tenant_id,
  environment,
  outbox_id,
  run_id,
  command_id,
  topic,
  payload_json,
  status,
  attempt_count,
  available_at,
  lease_token,
  run_fence,
  published_at,
  created_at,
  queue_sequence
)
values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test',
  '00000000-0000-4000-8000-00000000b2e0',
  '00000000-0000-4000-8000-00000000a2e0',
  '00000000-0000-4000-8000-00000000c2e0',
  'run.command.accepted',
  '{"fixture":"concurrent-resume-base"}'::jsonb,
  'PUBLISHED',
  1,
  '2026-07-25T00:02:00.000Z',
  1,
  1,
  '2026-07-25T00:02:00.000Z',
  '2026-07-25T00:02:00.000Z',
  1
);

insert into app_data_agent.run_events (
  app_id,
  tenant_id,
  environment,
  event_id,
  run_id,
  sequence,
  event_type,
  payload_json,
  command_id,
  dedupe_key,
  worker_fence,
  created_at
)
values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test',
  '00000000-0000-4000-8000-00000000e2e0',
  '00000000-0000-4000-8000-00000000a2e0',
  1,
  'run.suspended',
  pg_catalog.jsonb_build_object(
    'command_id',
    '00000000-0000-4000-8000-00000000c2e0'
  ),
  '00000000-0000-4000-8000-00000000c2e0',
  'runtime-u4-concurrent-resume-base-event',
  1,
  '2026-07-25T00:02:00.000Z'
);

with fixture as (
  select pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'scope',
    pg_catalog.jsonb_build_object(
      'app_id',
      '00000000-0000-4000-8000-00000000da01',
      'tenant_id',
      '00000000-0000-4000-8000-00000000aa11',
      'environment',
      'test'
    ),
    'run_id',
    '00000000-0000-4000-8000-00000000a2e0',
    'status',
    'WAITING',
    'version',
    1,
    'worker_fence',
    1,
    'attempt_count',
    1,
    'last_event_id',
    '00000000-0000-4000-8000-00000000e2e0',
    'last_occurred_at',
    '2026-07-25T00:02:00.000Z',
    'active_artifact_ref',
    null,
    'active_snapshot_ref',
    null,
    'last_side_effect_receipt_id',
    null,
    'terminal_event_id',
    null
  ) as projection_json
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
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test',
  '00000000-0000-4000-8000-00000000a2e0',
  1,
  'WAITING',
  1,
  '00000000-0000-4000-8000-00000000e2e0',
  app_data_agent.runtime_canonical_sha256(fixture.projection_json),
  fixture.projection_json,
  '2026-07-25T00:02:00.000Z'
from fixture;

create or replace function test_support.concurrent_resume_request(
  requested_command_id uuid,
  requested_event_id uuid,
  requested_outbox_id uuid,
  requested_audit_id uuid,
  requested_idempotency_key text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  baseline_projection app_data_agent.run_projections%rowtype;
  requested_scope jsonb;
  requested_command jsonb;
  requested_event jsonb;
  requested_projection jsonb;
begin
  select projection.*
  into strict baseline_projection
  from app_data_agent.run_projections as projection
  where projection.app_id =
      '00000000-0000-4000-8000-00000000da01'::uuid
    and projection.tenant_id =
      '00000000-0000-4000-8000-00000000aa11'::uuid
    and projection.environment = 'test'
    and projection.run_id =
      '00000000-0000-4000-8000-00000000a2e0'::uuid
    and projection.version = 1;

  requested_scope := pg_catalog.jsonb_build_object(
    'app_id',
    '00000000-0000-4000-8000-00000000da01',
    'tenant_id',
    '00000000-0000-4000-8000-00000000aa11',
    'environment',
    'test'
  );
  requested_command := pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'scope',
    requested_scope,
    'operation',
    'RESUME',
    'run_id',
    '00000000-0000-4000-8000-00000000a2e0',
    'command_id',
    requested_command_id,
    'event_id',
    requested_event_id,
    'outbox_id',
    requested_outbox_id,
    'audit_id',
    requested_audit_id,
    'idempotency_key',
    requested_idempotency_key,
    'occurred_at',
    '2026-07-25T00:02:01.000Z'
  );
  requested_event := pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'event_id',
    requested_event_id,
    'scope',
    requested_scope,
    'run_id',
    '00000000-0000-4000-8000-00000000a2e0',
    'sequence',
    2,
    'worker_fence',
    1,
    'idempotency_key',
    requested_idempotency_key,
    'occurred_at',
    '2026-07-25T00:02:01.000Z',
    'event_type',
    'run.resumed',
    'payload',
    pg_catalog.jsonb_build_object(
      'command_id',
      requested_command_id
    )
  );
  requested_projection := test_support.reduce_run_projection(
    baseline_projection.projection_json,
    requested_event
  );

  return test_support.request_run_control_canonical(
    requested_command,
    requested_event,
    baseline_projection.projection_hash,
    requested_projection
  );
end
$$;

revoke all privileges on function test_support.concurrent_resume_request(
  uuid,
  uuid,
  uuid,
  uuid,
  text
) from public;
grant execute on function test_support.concurrent_resume_request(
  uuid,
  uuid,
  uuid,
  uuid,
  text
) to data_agent_backend;

select test_support.assert_true(
  (
    select run.status = 'WAITING'
      and run.active_fence = 1
      and run.next_queue_sequence = 2
      and projection.status = 'WAITING'
      and projection.version = 1
    from app_data_agent.runs as run
    join app_data_agent.run_projections as projection
      on projection.app_id = run.app_id
     and projection.tenant_id = run.tenant_id
     and projection.environment = run.environment
     and projection.run_id = run.run_id
    where run.run_id =
      '00000000-0000-4000-8000-00000000a2e0'::uuid
  ),
  '并发 Resume Fixture 必须从同一 WAITING Projection 与 Counter=2 开始'
);

commit;
