\set ON_ERROR_STOP on

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000001006"}',
  false
);
select api.data_agent__accept_run_command(
  '00000000-0000-4000-8000-00000000de01'::uuid,
  '00000000-0000-4000-8000-00000000aa11'::uuid,
  '00000000-0000-4000-8000-00000000a250'::uuid,
  '00000000-0000-4000-8000-00000000c250'::uuid,
  'runtime-u4-resume-start',
  'U4 suspend resume complete smoke',
  '{"kind":"START_L2_RESEARCH","mode":"L2"}'::jsonb,
  'sha256:a51cad25baa6916772c6e63149ac066d5059dc6c5d721a66c2d35fa3121bd418'
);
reset role;

begin;
set local role data_agent_backend;
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
  '00000000-0000-4000-8000-000000001006',
  true
);
select pg_catalog.set_config('data_agent.role', 'analyst', true);
select pg_catalog.set_config(
  'data_agent.deployment_id',
  '00000000-0000-4000-8000-00000000de01',
  true
);

select test_support.assert_true(
  (
    select
      function_definition !~
        'control_at timestamptz[[:space:]]*:='
      and function_definition ~ (
        'into current_projection(.|\n)*for update;(.|\n)*' ||
        'control_at := pg_catalog\.clock_timestamp\(\);'
      )
      and function_definition ~ (
        'control_at := pg_catalog\.clock_timestamp\(\);(.|\n)*' ||
        'insert into app_data_agent\.commands'
      )
    from (
      select pg_catalog.pg_get_functiondef(
        pg_catalog.to_regprocedure(
          'app_data_agent.request_run_control(jsonb,jsonb,text,text,jsonb,text)'
        )
      ) as function_definition
    ) as runtime_control
  ),
  'Run Control 必须在锁定 target Run 与 Projection 后签发 mutation clock'
);

create temporary table u4_resume_prior_fixture_lease
on commit drop
as
select *
from app_data_agent.claim_run_work(
  'runtime-resume-prior-fixture-isolation',
  1,
  900
);

select test_support.assert_true(
  (
    select
      pg_catalog.count(*) = 1
      and pg_catalog.bool_and(
        lease.run_id =
          '00000000-0000-4000-8000-00000000a208'::uuid
      )
    from u4_resume_prior_fixture_lease as lease
  ),
  'Resume 测试必须先隔离 20 号 Analyst 接收契约留下的更早队列项'
);

create temporary table u4_resume_first_lease
on commit drop
as
select
  claimed.*,
  test_support.runtime_lease_document(
    pg_catalog.to_jsonb(claimed)
  ) as lease_document
from app_data_agent.claim_run_work(
  'runtime-worker-resume-a',
  1,
  30
) as claimed;

select test_support.assert_true(
  (
    select
      pg_catalog.count(*) = 1
      and pg_catalog.bool_and(lease.attempt_no = 1)
      and pg_catalog.bool_and(lease.delivery_attempt_no = 1)
      and pg_catalog.bool_and(lease.lease_duration_ms = 30000)
      and pg_catalog.bool_and(
        lease.lease_document ->> 'delivery_attempt_no' = '1'
      )
      and pg_catalog.bool_and(
        lease.lease_document ->> 'lease_duration_ms' = '30000'
      )
    from u4_resume_first_lease as lease
  ),
  '首次领取必须同时返回 Run Attempt 1 与 Outbox Delivery Attempt 1'
);

select test_support.append_run_event_canonical(
  lease.lease_document,
  pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'event_id',
    '00000000-0000-4000-8000-00000000e250',
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
    '00000000-0000-4000-8000-00000000a250',
    'sequence',
    2,
    'worker_fence',
    lease.worker_fence,
    'idempotency_key',
    'runtime-u4-resume-lease-1',
    'occurred_at',
    '2026-07-26T00:01:00.000Z',
    'event_type',
    'run.leased',
    'payload',
    pg_catalog.jsonb_build_object(
      'command_id',
      lease.command_id,
      'lease_id',
      lease.attempt_id::text,
      'worker_id',
      lease.worker_id,
      'attempt',
      lease.attempt_no
    )
  ),
  projection.projection_hash,
  projection.projection_json || pg_catalog.jsonb_build_object(
    'status',
    'RUNNING',
    'version',
    2,
    'worker_fence',
    lease.worker_fence,
    'attempt_count',
    1,
    'last_event_id',
    '00000000-0000-4000-8000-00000000e250',
    'last_occurred_at',
    '2026-07-26T00:01:00.000Z'
  )
)
from u4_resume_first_lease as lease
join app_data_agent.run_projections as projection
  on projection.run_id = lease.run_id
 and projection.version = 1;

select test_support.append_run_event_canonical(
  lease.lease_document,
  pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'event_id',
    '00000000-0000-4000-8000-00000000e251',
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
    '00000000-0000-4000-8000-00000000a250',
    'sequence',
    3,
    'worker_fence',
    lease.worker_fence,
    'idempotency_key',
    'runtime-u4-suspended',
    'occurred_at',
    '2026-07-26T00:01:01.000Z',
    'event_type',
    'run.suspended',
    'payload',
    pg_catalog.jsonb_build_object(
      'reason_code',
      'WAITING_FOR_CLARIFICATION',
      'snapshot_id',
      '00000000-0000-4000-8000-00000000f250'
    )
  ),
  projection.projection_hash,
  projection.projection_json || pg_catalog.jsonb_build_object(
    'status',
    'WAITING',
    'version',
    3,
    'last_event_id',
    '00000000-0000-4000-8000-00000000e251',
    'last_occurred_at',
    '2026-07-26T00:01:01.000Z'
  )
)
from u4_resume_first_lease as lease
join app_data_agent.run_projections as projection
  on projection.run_id = lease.run_id
 and projection.version = 2;

select test_support.assert_true(
  (
    select
      run.status = 'WAITING'
      and attempt.status = 'SUSPENDED'
      and message.status = 'PUBLISHED'
    from u4_resume_first_lease as lease
    join app_data_agent.runs as run
      on run.run_id = lease.run_id
    join app_data_agent.run_attempts as attempt
      on attempt.attempt_id = lease.attempt_id
    join app_data_agent.outbox as message
      on message.outbox_id = lease.outbox_id
  ),
  'run.suspended 必须关闭当前 Attempt/Outbox 并进入 WAITING'
);
select test_support.assert_true(
  (
    select app_data_agent.complete_run_work(
      lease.outbox_id,
      lease.attempt_id,
      lease.worker_id,
      lease.lease_token,
      lease.worker_fence,
      3
    )
    from u4_resume_first_lease as lease
  ),
  'run.suspended 原子结算后 runner 的 complete 确认必须幂等成功'
);

create temporary table u4_resume_control_request
on commit drop
as
select
  pg_catalog.jsonb_build_object(
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
    'operation',
    'RESUME',
    'run_id',
    '00000000-0000-4000-8000-00000000a250',
    'command_id',
    '00000000-0000-4000-8000-00000000c251',
    'event_id',
    '00000000-0000-4000-8000-00000000e252',
    'outbox_id',
    '00000000-0000-4000-8000-00000000b251',
    'audit_id',
    '00000000-0000-4000-8000-00000000d251',
    'idempotency_key',
    'runtime-u4-resume',
    'occurred_at',
    '2026-07-26T00:01:02.000Z'
  ) as requested_command,
  pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'event_id',
    '00000000-0000-4000-8000-00000000e252',
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
    '00000000-0000-4000-8000-00000000a250',
    'sequence',
    4,
    'worker_fence',
    lease.worker_fence,
    'idempotency_key',
    'runtime-u4-resume',
    'occurred_at',
    '2026-07-26T00:01:02.000Z',
    'event_type',
    'run.resumed',
    'payload',
    pg_catalog.jsonb_build_object(
      'command_id',
      '00000000-0000-4000-8000-00000000c251'
    )
  ) as requested_event,
  projection.projection_hash as expected_projection_hash,
  projection.projection_json || pg_catalog.jsonb_build_object(
    'status',
    'QUEUED',
    'version',
    4,
    'last_event_id',
    '00000000-0000-4000-8000-00000000e252',
    'last_occurred_at',
    '2026-07-26T00:01:02.000Z'
  ) as requested_projection
from u4_resume_first_lease as lease
join app_data_agent.run_projections as projection
  on projection.run_id = lease.run_id
 and projection.version = 3;

select pg_catalog.set_config(
  'data_agent.principal_id',
  '00000000-0000-4000-8000-000000001001',
  true
);
select pg_catalog.set_config('data_agent.role', 'owner', true);

select test_support.request_run_control_canonical(
  request.requested_command,
  request.requested_event,
  request.expected_projection_hash,
  request.requested_projection
)
from u4_resume_control_request as request;

select test_support.assert_true(
  (
    select run.next_queue_sequence = 3
      and message.queue_sequence = 2
    from app_data_agent.runs as run
    join app_data_agent.outbox as message
      on message.app_id = run.app_id
     and message.tenant_id = run.tenant_id
     and message.environment = run.environment
     and message.run_id = run.run_id
    where run.run_id =
        '00000000-0000-4000-8000-00000000a250'::uuid
      and message.outbox_id =
        '00000000-0000-4000-8000-00000000b251'::uuid
  ),
  'RESUME 必须在持有 Run 锁时分配 qseq=2，并把 Counter 推进到 3'
);

select pg_catalog.set_config(
  'data_agent.principal_id',
  '00000000-0000-4000-8000-000000001006',
  true
);
select pg_catalog.set_config('data_agent.role', 'analyst', true);

create temporary table u4_resume_second_lease
on commit drop
as
select
  claimed.*,
  test_support.runtime_lease_document(
    pg_catalog.to_jsonb(claimed)
  ) as lease_document
from app_data_agent.claim_run_work(
  'runtime-worker-resume-b',
  1,
  30
) as claimed;

select test_support.assert_true(
  (
    select
      pg_catalog.count(*) = 1
      and pg_catalog.bool_and(lease.command_kind = 'RESUME_RUN')
      and pg_catalog.bool_and(lease.attempt_no = 2)
      and pg_catalog.bool_and(lease.delivery_attempt_no = 1)
      and pg_catalog.bool_and(lease.worker_fence = 2)
    from u4_resume_second_lease as lease
  ),
  'RESUME 必须用新 Outbox 重置交付计数，并提升 Run Fence/Attempt'
);

select test_support.append_run_event_canonical(
  lease.lease_document,
  pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'event_id',
    '00000000-0000-4000-8000-00000000e253',
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
    '00000000-0000-4000-8000-00000000a250',
    'sequence',
    5,
    'worker_fence',
    lease.worker_fence,
    'idempotency_key',
    'runtime-u4-resume-lease-2',
    'occurred_at',
    '2026-07-26T00:01:03.000Z',
    'event_type',
    'run.leased',
    'payload',
    pg_catalog.jsonb_build_object(
      'command_id',
      lease.command_id,
      'lease_id',
      lease.attempt_id::text,
      'worker_id',
      lease.worker_id,
      'attempt',
      lease.attempt_no
    )
  ),
  projection.projection_hash,
  projection.projection_json || pg_catalog.jsonb_build_object(
    'status',
    'RUNNING',
    'version',
    5,
    'worker_fence',
    lease.worker_fence,
    'attempt_count',
    2,
    'last_event_id',
    '00000000-0000-4000-8000-00000000e253',
    'last_occurred_at',
    '2026-07-26T00:01:03.000Z'
  )
)
from u4_resume_second_lease as lease
join app_data_agent.run_projections as projection
  on projection.run_id = lease.run_id
 and projection.version = 4;

select test_support.append_run_event_canonical(
  lease.lease_document,
  pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'event_id',
    '00000000-0000-4000-8000-00000000e254',
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
    '00000000-0000-4000-8000-00000000a250',
    'sequence',
    6,
    'worker_fence',
    lease.worker_fence,
    'idempotency_key',
    'runtime-u4-completed',
    'occurred_at',
    '2026-07-26T00:01:04.000Z',
    'event_type',
    'run.completed',
    'payload',
    pg_catalog.jsonb_build_object(
      'completion_kind',
      'WORKFLOW_EXECUTION_ONLY'
    )
  ),
  projection.projection_hash,
  projection.projection_json || pg_catalog.jsonb_build_object(
    'status',
    'COMPLETED',
    'version',
    6,
    'last_event_id',
    '00000000-0000-4000-8000-00000000e254',
    'last_occurred_at',
    '2026-07-26T00:01:04.000Z',
    'terminal_event_id',
    '00000000-0000-4000-8000-00000000e254'
  )
)
from u4_resume_second_lease as lease
join app_data_agent.run_projections as projection
  on projection.run_id = lease.run_id
 and projection.version = 5;

select test_support.assert_true(
  (
    select
      run.status = 'SUCCEEDED'
      and attempt.status = 'SUCCEEDED'
      and message.status = 'PUBLISHED'
      and command.status = 'SUCCEEDED'
      and projection.status = 'COMPLETED'
    from u4_resume_second_lease as lease
    join app_data_agent.runs as run
      on run.run_id = lease.run_id
    join app_data_agent.run_attempts as attempt
      on attempt.attempt_id = lease.attempt_id
    join app_data_agent.outbox as message
      on message.outbox_id = lease.outbox_id
    join app_data_agent.commands as command
      on command.command_id = lease.command_id
    join app_data_agent.run_projections as projection
      on projection.run_id = lease.run_id
     and projection.version = 6
  ),
  '终态 Event append 必须原子结算 Attempt、Outbox、Command 与 Run'
);
select test_support.assert_true(
  (
    select app_data_agent.complete_run_work(
      lease.outbox_id,
      lease.attempt_id,
      lease.worker_id,
      lease.lease_token,
      lease.worker_fence,
      6
    )
    from u4_resume_second_lease as lease
  ),
  '终态 Event 已原子结算后 complete_run_work 必须幂等确认成功'
);
select test_support.assert_true(
  (
    select
      run.status = 'SUCCEEDED'
      and attempt.status = 'SUCCEEDED'
      and message.status = 'PUBLISHED'
      and command.status = 'SUCCEEDED'
    from u4_resume_second_lease as lease
    join app_data_agent.runs as run
      on run.run_id = lease.run_id
    join app_data_agent.run_attempts as attempt
      on attempt.attempt_id = lease.attempt_id
    join app_data_agent.outbox as message
      on message.outbox_id = lease.outbox_id
    join app_data_agent.commands as command
      on command.command_id = lease.command_id
  ),
  'Resume 后完成必须原子关闭 Attempt、Outbox、Command 与 Run'
);

reset role;
update app_data_agent.memberships as membership
set membership_role = 'analyst',
    membership_version = membership.membership_version + 1,
    updated_at = pg_catalog.clock_timestamp()
where membership.app_id =
    '00000000-0000-4000-8000-00000000da01'::uuid
  and membership.tenant_id =
    '00000000-0000-4000-8000-00000000aa11'::uuid
  and membership.environment = 'test'
  and membership.principal_id =
    '00000000-0000-4000-8000-000000001001'::uuid;
set local role data_agent_backend;
select pg_catalog.set_config(
  'data_agent.principal_id',
  '00000000-0000-4000-8000-000000001001',
  true
);
select pg_catalog.set_config('data_agent.role', 'analyst', true);

select test_support.assert_raises(
  $statement$
    select test_support.request_run_control_canonical(
      request.requested_command,
      request.requested_event,
      request.expected_projection_hash,
      request.requested_projection
    )
    from u4_resume_control_request as request
  $statement$,
  'DA_RUN_NOT_FOUND'
);

reset role;
update app_data_agent.memberships as membership
set membership_role = 'owner',
    membership_version = membership.membership_version + 1,
    updated_at = pg_catalog.clock_timestamp()
where membership.app_id =
    '00000000-0000-4000-8000-00000000da01'::uuid
  and membership.tenant_id =
    '00000000-0000-4000-8000-00000000aa11'::uuid
  and membership.environment = 'test'
  and membership.principal_id =
    '00000000-0000-4000-8000-000000001001'::uuid;
set local role data_agent_backend;
select pg_catalog.set_config('data_agent.role', 'owner', true);

commit;
