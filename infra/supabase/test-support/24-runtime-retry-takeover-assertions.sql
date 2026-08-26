\set ON_ERROR_STOP on

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
  '00000000-0000-4000-8000-000000001001',
  true
);
select pg_catalog.set_config('data_agent.role', 'owner', true);
select pg_catalog.set_config(
  'data_agent.deployment_id',
  '00000000-0000-4000-8000-00000000de01',
  true
);
create temporary table u4_retry_acceptance
on commit drop
as
select test_support.accept_backend_start_run(
  '00000000-0000-4000-8000-00000000a260'::uuid,
  '00000000-0000-4000-8000-00000000c260'::uuid,
  '00000000-0000-4000-8000-00000000e260'::uuid,
  '00000000-0000-4000-8000-00000000b260'::uuid,
  '00000000-0000-4000-8000-00000000d260'::uuid,
  'runtime-u4-retry-start',
  'U4 retry atomic settlement smoke'
) as result;

select test_support.assert_true(
  (
    select
      (acceptance.result ->> 'created')::boolean
      and acceptance.result ->> 'run_id' =
        '00000000-0000-4000-8000-00000000a260'
      and acceptance.result ->> 'command_id' =
        '00000000-0000-4000-8000-00000000c260'
      and acceptance.result ->> 'outbox_id' =
        '00000000-0000-4000-8000-00000000b260'
      and acceptance.result ->> 'payload_hash' =
        'sha256:a51cad25baa6916772c6e63149ac066d5059dc6c5d721a66c2d35fa3121bd418'
    from u4_retry_acceptance as acceptance
  ),
  'Backend 首写 RPC 必须原子使用调用方提供的 Run/Command/Event/Outbox/Audit IDs'
);
select test_support.assert_true(
  (
    select run.next_queue_sequence = 2
      and message.queue_sequence = 1
    from app_data_agent.runs as run
    join app_data_agent.outbox as message
      on message.app_id = run.app_id
     and message.tenant_id = run.tenant_id
     and message.environment = run.environment
     and message.run_id = run.run_id
    where run.run_id =
        '00000000-0000-4000-8000-00000000a260'::uuid
      and message.outbox_id =
        '00000000-0000-4000-8000-00000000b260'::uuid
  ),
  'Backend 首写必须原子落库 qseq=1，并把 Run Counter 推进到 2'
);
select test_support.assert_true(
  not (
    test_support.accept_backend_start_run(
      '00000000-0000-4000-8000-00000000a260'::uuid,
      '00000000-0000-4000-8000-00000000c260'::uuid,
      '00000000-0000-4000-8000-00000000e260'::uuid,
      '00000000-0000-4000-8000-00000000b260'::uuid,
      '00000000-0000-4000-8000-00000000d260'::uuid,
      'runtime-u4-retry-start',
      'U4 retry atomic settlement smoke'
    ) ->> 'created'
  )::boolean,
  'Backend 首写后的同请求 replay 必须返回 created=false'
);
select test_support.assert_raises(
  $assert$
    select test_support.accept_backend_start_run(
      '00000000-0000-4000-8000-00000000a26f'::uuid,
      '00000000-0000-4000-8000-00000000c26f'::uuid,
      '00000000-0000-4000-8000-00000000e26f'::uuid,
      '00000000-0000-4000-8000-00000000b26f'::uuid,
      '00000000-0000-4000-8000-00000000d26f'::uuid,
      'password=plaintext-must-fail',
      'U4 secret idempotency rejection'
    )
  $assert$,
  'DA_COMMAND_ACCEPTANCE_INPUT_INVALID'
);
select test_support.assert_true(
  not exists (
    select 1
    from app_data_agent.runs as run
    where run.run_id = '00000000-0000-4000-8000-00000000a26f'::uuid
  ),
  'Backend 首写输入拒绝必须保持六张权威表零写入'
);

create temporary table u4_retry_first_lease
on commit drop
as
select
  claimed.*,
  test_support.runtime_lease_document(
    pg_catalog.to_jsonb(claimed)
  ) as lease_document
from app_data_agent.claim_run_work(
  'runtime-worker-retry-a',
  1,
  30
) as claimed;

select test_support.assert_true(
  (
    select
      pg_catalog.count(*) = 1
      and pg_catalog.bool_and(
        lease.run_id = '00000000-0000-4000-8000-00000000a260'::uuid
      )
      and pg_catalog.bool_and(lease.attempt_no = 1)
      and pg_catalog.bool_and(lease.delivery_attempt_no = 1)
      and pg_catalog.bool_and(lease.lease_duration_ms = 30000)
      and pg_catalog.bool_and(
        lease.lease_document ->> 'delivery_attempt_no' = '1'
      )
      and pg_catalog.bool_and(
        lease.lease_document ->> 'lease_duration_ms' = '30000'
      )
      and pg_catalog.bool_and(lease.worker_fence = 1)
    from u4_retry_first_lease as lease
  ),
  'Retry smoke 的第一次领取必须创建 Attempt 1/Fence 1'
);

create temporary table u4_retry_lease_event
on commit drop
as
select
  lease.lease_document,
  pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'event_id',
    '00000000-0000-4000-8000-00000000e261',
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
    lease.run_id,
    'sequence',
    2,
    'worker_fence',
    lease.worker_fence,
    'idempotency_key',
    'runtime-u4-retry-lease-1',
    'occurred_at',
    app_data_agent.runtime_iso_timestamp(pg_catalog.clock_timestamp()),
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
  ) as event_document
from u4_retry_first_lease as lease;

select test_support.assert_raises(
  $assert$
    select test_support.append_reduced_run_event(
      candidate.lease_document,
      pg_catalog.jsonb_set(
        candidate.event_document,
        '{payload,lease_id}',
        pg_catalog.to_jsonb(
          (candidate.lease_document ->> 'outbox_id')::text
        )
      )
    )
    from u4_retry_lease_event as candidate
  $assert$,
  'DA_RUN_EVENT_TRANSITION_INVALID'
);

select test_support.append_reduced_run_event(
  candidate.lease_document,
  candidate.event_document
)
from u4_retry_lease_event as candidate;

create temporary table u4_retry_schedule
on commit drop
as
select
  1000::bigint as retry_delay_ms,
  pg_catalog.clock_timestamp() as requested_at;

create temporary table u4_retry_event
on commit drop
as
select
  lease.lease_document,
  pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'event_id',
    '00000000-0000-4000-8000-00000000e262',
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
    lease.run_id,
    'sequence',
    3,
    'worker_fence',
    lease.worker_fence,
    'idempotency_key',
    'runtime-u4-retry-scheduled',
    'occurred_at',
    app_data_agent.runtime_iso_timestamp(pg_catalog.clock_timestamp()),
    'event_type',
    'run.retry_scheduled',
    'payload',
    pg_catalog.jsonb_build_object(
      'command_id',
      lease.command_id,
      'error_code',
      'MODEL_RATE_LIMIT',
      'retry_delay_ms',
      schedule.retry_delay_ms
    )
  ) as event_document
from u4_retry_first_lease as lease
cross join u4_retry_schedule as schedule;

select test_support.assert_raises(
  $assert$
    select test_support.append_reduced_run_event(
      candidate.lease_document,
      pg_catalog.jsonb_set(
        candidate.event_document,
        '{payload,retry_delay_ms}',
        '999'::jsonb
      )
    )
    from u4_retry_event as candidate
  $assert$,
  'DA_RUN_EVENT_TRANSITION_INVALID'
);
select test_support.assert_true(
  (
    select
      attempt.status = 'ACTIVE'
      and message.status = 'LEASED'
      and run.status = 'RUNNING'
      and projection.status = 'RUNNING'
      and not exists (
        select 1
        from app_data_agent.run_events as rejected
        where rejected.run_id = lease.run_id
          and rejected.sequence = 3
      )
    from u4_retry_first_lease as lease
    join app_data_agent.run_attempts as attempt
      on attempt.attempt_id = lease.attempt_id
    join app_data_agent.outbox as message
      on message.outbox_id = lease.outbox_id
    join app_data_agent.runs as run
      on run.run_id = lease.run_id
    join app_data_agent.run_projections as projection
      on projection.run_id = lease.run_id
     and projection.version = 2
  ),
  '小于 1000ms 的 Retry Delay 必须失败关闭且保持 Lease 状态零写入'
);

select test_support.append_reduced_run_event(
  candidate.lease_document,
  candidate.event_document
)
from u4_retry_event as candidate;

select test_support.assert_true(
  (
    select
      attempt.status = 'RETRY_SCHEDULED'
      and attempt.error_code = 'MODEL_RATE_LIMIT'
      and attempt.retry_at = message.available_at
      and message.available_at >= schedule.requested_at
        + pg_catalog.make_interval(
          secs => schedule.retry_delay_ms::double precision / 1000.0
        )
      and message.available_at <
        pg_catalog.clock_timestamp() + interval '2 seconds'
      and attempt.finished_at is not null
      and message.status = 'PENDING'
      and message.lease_owner is null
      and message.lease_expires_at is null
      and run.status = 'QUEUED'
      and projection.status = 'QUEUED'
      and event.payload_json ->> 'retry_delay_ms' =
        schedule.retry_delay_ms::text
      and not (event.payload_json ? 'retry_at')
      and projection.projection_hash =
        app_data_agent.runtime_canonical_sha256(
          projection.projection_json
        )
    from u4_retry_first_lease as lease
    cross join u4_retry_schedule as schedule
    join app_data_agent.run_attempts as attempt
      on attempt.attempt_id = lease.attempt_id
    join app_data_agent.outbox as message
      on message.outbox_id = lease.outbox_id
    join app_data_agent.runs as run
      on run.run_id = lease.run_id
    join app_data_agent.run_projections as projection
      on projection.run_id = lease.run_id
     and projection.version = 3
    join app_data_agent.run_events as event
      on event.run_id = lease.run_id
     and event.sequence = 3
  ),
  'run.retry_scheduled append 必须在同一事务原子写入 backoff 与 PENDING'
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.retry_run_work(
      lease.outbox_id,
      lease.attempt_id,
      lease.worker_id,
      lease.lease_token,
      lease.worker_fence,
      3,
      'MODEL_RATE_LIMIT',
      999
    )
    from u4_retry_first_lease as lease
  $assert$,
  'DA_RUN_RETRY_INPUT_INVALID'
);
select test_support.assert_true(
  (
    select app_data_agent.retry_run_work(
      lease.outbox_id,
      lease.attempt_id,
      lease.worker_id,
      lease.lease_token,
      lease.worker_fence,
      3,
      'MODEL_RATE_LIMIT',
      schedule.retry_delay_ms
    )
    from u4_retry_first_lease as lease
    cross join u4_retry_schedule as schedule
  ),
  'Retry Event 已原子结算后 retry_run_work 必须幂等确认成功'
);
select pg_catalog.pg_sleep(
  case
    when message.available_at > pg_catalog.clock_timestamp()
      then extract(
        epoch from message.available_at - pg_catalog.clock_timestamp()
      )::double precision + 0.05
    else 0.05
  end
)
from u4_retry_first_lease as lease
join app_data_agent.outbox as message
  on message.outbox_id = lease.outbox_id;

create temporary table u4_retry_second_lease
on commit drop
as
select
  claimed.*,
  test_support.runtime_lease_document(
    pg_catalog.to_jsonb(claimed)
  ) as lease_document
from app_data_agent.claim_run_work(
  'runtime-worker-retry-b',
  1,
  30
) as claimed;

select test_support.assert_true(
  (
    select
      pg_catalog.count(*) = 1
      and pg_catalog.bool_and(
        lease.run_id = '00000000-0000-4000-8000-00000000a260'::uuid
      )
      and pg_catalog.bool_and(lease.attempt_no = 2)
      and pg_catalog.bool_and(lease.delivery_attempt_no = 2)
      and pg_catalog.bool_and(lease.lease_token = 2)
      and pg_catalog.bool_and(lease.worker_fence = 2)
    from u4_retry_second_lease as lease
  ),
  'Retry backoff 到期后必须以 Attempt 2/Fence 2 重新领取'
);
select test_support.assert_true(
  app_data_agent.lock_owned_run_fence(
    '00000000-0000-4000-8000-00000000a260'::uuid
  ) is null,
  'Artifact Fence 必须拒绝尚未投影 run.leased 的 Retry Lease'
);

select test_support.assert_true(
  (
    test_support.accept_backend_start_run(
      '00000000-0000-4000-8000-00000000a270'::uuid,
      '00000000-0000-4000-8000-00000000c270'::uuid,
      '00000000-0000-4000-8000-00000000e270'::uuid,
      '00000000-0000-4000-8000-00000000b270'::uuid,
      '00000000-0000-4000-8000-00000000d270'::uuid,
      'runtime-u4-expiry-start',
      'U4 expired lease takeover smoke'
    ) ->> 'created'
  )::boolean,
  'Expiry takeover fixture 必须经 Backend 首写窄 RPC 创建'
);

create temporary table u4_expiry_first_lease
on commit drop
as
select
  claimed.*,
  test_support.runtime_lease_document(
    pg_catalog.to_jsonb(claimed)
  ) as lease_document
from app_data_agent.claim_run_work(
  'runtime-worker-expired',
  1,
  5
) as claimed;

select pg_catalog.pg_sleep(5.1);

create temporary table u4_expiry_second_lease
on commit drop
as
select
  claimed.*,
  test_support.runtime_lease_document(
    pg_catalog.to_jsonb(claimed)
  ) as lease_document
from app_data_agent.claim_run_work(
  'runtime-worker-takeover',
  1,
  30
) as claimed;

select test_support.assert_true(
  (
    select
      old_lease.run_id =
        '00000000-0000-4000-8000-00000000a270'::uuid
      and new_lease.run_id = old_lease.run_id
      and old_attempt.status = 'EXPIRED'
      and old_attempt.finished_at is not null
      and new_attempt.status = 'ACTIVE'
      and new_lease.attempt_no = 2
      and old_lease.delivery_attempt_no = 1
      and new_lease.delivery_attempt_no = 2
      and new_lease.lease_token = 2
      and new_lease.worker_fence = 2
      and new_lease.attempt_id <> old_lease.attempt_id
    from u4_expiry_first_lease as old_lease
    cross join u4_expiry_second_lease as new_lease
    join app_data_agent.run_attempts as old_attempt
      on old_attempt.attempt_id = old_lease.attempt_id
    join app_data_agent.run_attempts as new_attempt
      on new_attempt.attempt_id = new_lease.attempt_id
  ),
  'Lease 过期后 takeover 必须标记旧 Attempt EXPIRED 并提升 Token/Fence'
);
select test_support.assert_raises(
  $assert$
    select test_support.append_reduced_run_event(
      lease.lease_document,
      pg_catalog.jsonb_build_object(
        'schema_version',
        '1.0.0',
        'event_id',
        '00000000-0000-4000-8000-00000000e271',
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
        lease.run_id,
        'sequence',
        2,
        'worker_fence',
        lease.worker_fence,
        'idempotency_key',
        'runtime-u4-expired-worker-late',
        'occurred_at',
        app_data_agent.runtime_iso_timestamp(
          pg_catalog.clock_timestamp()
        ),
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
      )
    )
    from u4_expiry_first_lease as lease
  $assert$,
  'DA_RUN_EVENT_FENCE_STALE'
);

select test_support.append_reduced_run_event(
  lease.lease_document,
  pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'event_id',
    '00000000-0000-4000-8000-00000000e272',
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
    lease.run_id,
    'sequence',
    2,
    'worker_fence',
    lease.worker_fence,
    'idempotency_key',
    'runtime-u4-takeover-lease',
    'occurred_at',
    app_data_agent.runtime_iso_timestamp(pg_catalog.clock_timestamp()),
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
  )
)
from u4_expiry_second_lease as lease;

select test_support.assert_true(
  (
    select
      projection.worker_fence = lease.worker_fence
      and projection.status = 'RUNNING'
      and projection.projection_hash =
        app_data_agent.runtime_canonical_sha256(
          projection.projection_json
        )
    from u4_expiry_second_lease as lease
    join app_data_agent.run_projections as projection
      on projection.run_id = lease.run_id
     and projection.version = 2
  ),
  'Takeover Worker 的新 Fence 必须可提交，旧 Fence 必须保持被拒绝'
);
select test_support.assert_true(
  (
    select app_data_agent.lock_owned_run_fence(lease.run_id) =
      lease.worker_fence
    from u4_expiry_second_lease as lease
  ),
  'Artifact Fence 只允许最新 RUNNING Projection 与活动 Lease'
);

reset role;
set local session_replication_role = replica;
update app_data_agent.run_attempts as attempt
set lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
from u4_expiry_second_lease as lease
where attempt.attempt_id = lease.attempt_id;
update app_data_agent.outbox as message
set lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
from u4_expiry_second_lease as lease
where message.outbox_id = lease.outbox_id;
set local session_replication_role = origin;
set local role data_agent_backend;

select test_support.assert_true(
  app_data_agent.lock_owned_run_fence(
    '00000000-0000-4000-8000-00000000a270'::uuid
  ) is null,
  'Artifact Fence 必须在取得 Lease 行锁后拒绝已过期 Attempt/Outbox'
);
select test_support.assert_true(
  app_data_agent.lock_owned_run_fence(
    '00000000-0000-4000-8000-00000000a250'::uuid
  ) is null,
  'Artifact Fence 必须拒绝已经进入终态的 Run'
);

select pg_catalog.set_config(
  'data_agent.tenant_id',
  '00000000-0000-4000-8000-00000000aa22',
  true
);
select pg_catalog.set_config(
  'data_agent.principal_id',
  '00000000-0000-4000-8000-000000001003',
  true
);

select test_support.assert_true(
  (
    test_support.accept_backend_start_run(
      '00000000-0000-4000-8000-00000000a290'::uuid,
      '00000000-0000-4000-8000-00000000c290'::uuid,
      '00000000-0000-4000-8000-00000000e290'::uuid,
      '00000000-0000-4000-8000-00000000b290'::uuid,
      '00000000-0000-4000-8000-00000000d290'::uuid,
      'runtime-u4-attempt-budget',
      'U4 exhausted attempt budget smoke'
    ) ->> 'created'
  )::boolean,
  'Attempt Budget fixture 必须经 Backend 首写窄 RPC 创建'
);

create temporary table u4_attempt_budget_leases
on commit drop
as
select *
from app_data_agent.claim_run_work(
  'runtime-worker-budget-1',
  1,
  5
);

select pg_catalog.pg_sleep(5.1);
insert into u4_attempt_budget_leases
select *
from app_data_agent.claim_run_work(
  'runtime-worker-budget-2',
  1,
  5
);
select pg_catalog.pg_sleep(5.1);
insert into u4_attempt_budget_leases
select *
from app_data_agent.claim_run_work(
  'runtime-worker-budget-3',
  1,
  5
);
select pg_catalog.pg_sleep(5.1);
insert into u4_attempt_budget_leases
select *
from app_data_agent.claim_run_work(
  'runtime-worker-budget-4',
  1,
  5
);
select pg_catalog.pg_sleep(5.1);
insert into u4_attempt_budget_leases
select *
from app_data_agent.claim_run_work(
  'runtime-worker-budget-5',
  1,
  5
);

select test_support.assert_true(
  (
    select
      pg_catalog.count(*) = 5
      and pg_catalog.min(lease.attempt_no) = 1
      and pg_catalog.max(lease.attempt_no) = 5
      and pg_catalog.min(lease.delivery_attempt_no) = 1
      and pg_catalog.max(lease.delivery_attempt_no) = 5
      and pg_catalog.min(lease.lease_token) = 1
      and pg_catalog.max(lease.lease_token) = 5
      and pg_catalog.min(lease.worker_fence) = 1
      and pg_catalog.max(lease.worker_fence) = 5
    from u4_attempt_budget_leases as lease
  ),
  'Attempt Budget fixture 必须真实签发五个单调 Lease/Attempt/Fence'
);

select pg_catalog.pg_sleep(5.1);
select test_support.assert_true(
  (
    test_support.accept_backend_start_run(
      '00000000-0000-4000-8000-00000000a291'::uuid,
      '00000000-0000-4000-8000-00000000c291'::uuid,
      '00000000-0000-4000-8000-00000000e291'::uuid,
      '00000000-0000-4000-8000-00000000b291'::uuid,
      '00000000-0000-4000-8000-00000000d291'::uuid,
      'runtime-u4-attempt-budget-follower',
      'U4 runnable work behind exhausted budget'
    ) ->> 'created'
  )::boolean,
  'Attempt Budget 活性回归必须创建后继可运行任务'
);

select test_support.assert_true(
  (
    test_support.accept_backend_start_run(
      '00000000-0000-4000-8000-00000000a292'::uuid,
      '00000000-0000-4000-8000-00000000c292'::uuid,
      '00000000-0000-4000-8000-00000000e292'::uuid,
      '00000000-0000-4000-8000-00000000b292'::uuid,
      '00000000-0000-4000-8000-00000000d292'::uuid,
      'runtime-u4-attempt-budget-follower-2',
      'U4 second runnable work behind exhausted budget'
    ) ->> 'created'
  )::boolean,
  'Attempt Budget 忙租户回归必须保持第二条普通任务始终可领取'
);

create temporary table u4_attempt_budget_busy_claim_1
on commit drop
as
select *
from app_data_agent.claim_run_work(
  'runtime-worker-budget-6',
  1,
  5
);

create temporary table u4_attempt_budget_busy_claim_2
on commit drop
as
select *
from app_data_agent.claim_run_work(
  'runtime-worker-budget-7',
  1,
  5
);

select test_support.assert_true(
  (
    select
      run.status = 'FAILED'
      and run.active_fence = 5
      and command.status = 'FAILED'
      and message.status = 'DEAD_LETTER'
      and message.attempt_count = 5
      and message.lease_token = 5
      and message.run_fence = 5
      and message.lease_owner is null
      and message.lease_expires_at is null
      and projection.version = failed_event.sequence
      and projection.status = 'FAILED'
      and projection.worker_fence = 5
      and projection.event_id = failed_event.event_id
      and projection.projection_json ->> 'attempt_count' = '5'
      and projection.projection_json ->> 'terminal_event_id' =
        failed_event.event_id::text
      and projection.projection_hash =
        app_data_agent.runtime_canonical_sha256(
          projection.projection_json
        )
      and lease_event.sequence = failed_event.sequence - 1
      and lease_event.event_type = 'run.leased'
      and lease_event.attempt_id = message.active_attempt_id
      and lease_event.payload_json ->> 'lease_id' =
        message.active_attempt_id::text
      and lease_event.payload_json ->> 'worker_id' =
        'runtime-worker-budget-5'
      and lease_event.payload_json ->> 'attempt' = '5'
      and lease_event.event_hash =
        app_data_agent.runtime_canonical_sha256(
          lease_event.event_document
        )
      and failed_event.event_type = 'run.failed'
      and failed_event.attempt_id = message.active_attempt_id
      and failed_event.payload_json = pg_catalog.jsonb_build_object(
        'error_code',
        'RUN_ATTEMPT_BUDGET_EXHAUSTED',
        'retryable',
        false
      )
      and failed_event.event_hash =
        app_data_agent.runtime_canonical_sha256(
          failed_event.event_document
        )
      and exhausted_attempt.attempt_no = 5
      and exhausted_attempt.status = 'FAILED'
      and exhausted_attempt.error_code =
        'RUN_ATTEMPT_BUDGET_EXHAUSTED'
      and exhausted_attempt.finished_at is not null
      and (
        select pg_catalog.count(*)
        from u4_attempt_budget_busy_claim_1 as lease
        where lease.run_id in (
            '00000000-0000-4000-8000-00000000a291'::uuid,
            '00000000-0000-4000-8000-00000000a292'::uuid
          )
          and lease.attempt_no = 1
          and lease.delivery_attempt_no = 1
      ) = 1
      and (
        select pg_catalog.count(*)
        from u4_attempt_budget_busy_claim_2 as lease
        where lease.run_id in (
            '00000000-0000-4000-8000-00000000a291'::uuid,
            '00000000-0000-4000-8000-00000000a292'::uuid
          )
          and lease.attempt_no = 1
          and lease.delivery_attempt_no = 1
      ) = 1
      and (
        select pg_catalog.count(distinct lease.run_id)
        from (
          select run_id from u4_attempt_budget_busy_claim_1
          union all
          select run_id from u4_attempt_budget_busy_claim_2
        ) as lease
      ) = 2
      and (
        select pg_catalog.count(*)
        from app_data_agent.run_attempts as attempt
        where attempt.run_id = run.run_id
      ) = 5
      and (
        select pg_catalog.count(*)
        from app_data_agent.run_attempts as attempt
        where attempt.run_id = run.run_id
          and attempt.status = 'EXPIRED'
      ) = 4
      and not exists (
        select 1
        from app_data_agent.run_attempts as forbidden_attempt
        where forbidden_attempt.run_id = run.run_id
          and forbidden_attempt.attempt_no >= 6
      )
      and (
        select pg_catalog.count(*)
        from app_data_agent.run_events as event
        where event.run_id = run.run_id
      ) = 3
    from app_data_agent.runs as run
    join app_data_agent.commands as command
      on command.run_id = run.run_id
    join app_data_agent.outbox as message
      on message.run_id = run.run_id
    join app_data_agent.run_attempts as exhausted_attempt
      on exhausted_attempt.attempt_id = message.active_attempt_id
    join app_data_agent.run_events as failed_event
      on failed_event.run_id = run.run_id
     and failed_event.event_type = 'run.failed'
    join app_data_agent.run_events as lease_event
      on lease_event.run_id = run.run_id
     and lease_event.sequence = failed_event.sequence - 1
    join app_data_agent.run_projections as projection
      on projection.run_id = run.run_id
     and projection.version = failed_event.sequence
    where run.run_id = '00000000-0000-4000-8000-00000000a290'::uuid
  ),
  '忙租户持续存在普通任务时，第五个过期 Attempt 仍须有界结算且不能签发 Attempt 6'
);
select test_support.assert_true(
  app_data_agent.lock_owned_run_fence(
    '00000000-0000-4000-8000-00000000a290'::uuid
  ) is null,
  'Artifact Fence 必须拒绝 Attempt Budget 结算后的 FAILED Run'
);
commit;

begin;
insert into app_data_agent.workspaces (
  app_id,
  workspace_id,
  environment,
  slug,
  display_name
)
values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa33',
  'test',
  'smoke-aa33-test',
  'Smoke workspace AA33 test'
);
insert into app_data_agent.memberships (
  app_id,
  tenant_id,
  environment,
  principal_id,
  membership_role
)
values
  (
    '00000000-0000-4000-8000-00000000da01',
    '00000000-0000-4000-8000-00000000aa33',
    'test',
    '00000000-0000-4000-8000-000000001010',
    'owner'
  ),
  (
    '00000000-0000-4000-8000-00000000da01',
    '00000000-0000-4000-8000-00000000aa33',
    'test',
    '00000000-0000-4000-8000-000000001011',
    'analyst'
  );
select test_support.activate_falcon24_e1_fixture(
  '00000000-0000-4000-8000-00000000aa33'::uuid,'test',
  '00000000-0000-4000-8000-000000001010'::uuid,
  '00000000-0000-4000-8000-00000000de01'::uuid,false,4);
insert into app_data_agent.runs (
  app_id,
  tenant_id,
  environment,
  run_id,
  principal_id,
  question,
  next_queue_sequence
)
values
  (
    '00000000-0000-4000-8000-00000000da01',
    '00000000-0000-4000-8000-00000000aa33',
    'test',
    '00000000-0000-4000-8000-00000000a2a0',
    '00000000-0000-4000-8000-000000001010',
    'U4 strict FIFO delayed head',
    3
  ),
  (
    '00000000-0000-4000-8000-00000000da01',
    '00000000-0000-4000-8000-00000000aa33',
    'test',
    '00000000-0000-4000-8000-00000000a2b0',
    '00000000-0000-4000-8000-000000001010',
    'U4 strict FIFO independent run',
    2
  ),
  (
    '00000000-0000-4000-8000-00000000da01',
    '00000000-0000-4000-8000-00000000aa33',
    'test',
    '00000000-0000-4000-8000-00000000a2c0',
    '00000000-0000-4000-8000-000000001011',
    'U4 owner must not claim another principal run',
    2
  );

with fixture (
  command_id,
  run_id,
  principal_id,
  idempotency_key,
  payload_json
) as (
  values
    (
      '00000000-0000-4000-8000-00000000c2a0'::uuid,
      '00000000-0000-4000-8000-00000000a2a0'::uuid,
      '00000000-0000-4000-8000-000000001010'::uuid,
      'runtime-u4-fifo-head',
      '{"kind":"START_L2_RESEARCH","mode":"L2"}'::jsonb
    ),
    (
      '00000000-0000-4000-8000-00000000c2a1'::uuid,
      '00000000-0000-4000-8000-00000000a2a0'::uuid,
      '00000000-0000-4000-8000-000000001010'::uuid,
      'runtime-u4-fifo-follower',
      '{"kind":"START_L2_RESEARCH","mode":"L2"}'::jsonb
    ),
    (
      '00000000-0000-4000-8000-00000000c2b0'::uuid,
      '00000000-0000-4000-8000-00000000a2b0'::uuid,
      '00000000-0000-4000-8000-000000001010'::uuid,
      'runtime-u4-fifo-independent',
      '{"kind":"START_L2_RESEARCH","mode":"L2"}'::jsonb
    ),
    (
      '00000000-0000-4000-8000-00000000c2c0'::uuid,
      '00000000-0000-4000-8000-00000000a2c0'::uuid,
      '00000000-0000-4000-8000-000000001011'::uuid,
      'runtime-u4-owner-foreign-principal',
      '{"kind":"START_L2_RESEARCH","mode":"L2"}'::jsonb
    )
)
insert into app_data_agent.commands (
  app_id,
  tenant_id,
  environment,
  command_id,
  run_id,
  principal_id,
  idempotency_key,
  payload_json,
  payload_hash
)
select
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa33',
  'test',
  fixture.command_id,
  fixture.run_id,
  fixture.principal_id,
  fixture.idempotency_key,
  fixture.payload_json,
  platform.canonical_sha256(fixture.payload_json)
from fixture;

insert into app_data_agent.outbox (
  app_id,
  tenant_id,
  environment,
  outbox_id,
  run_id,
  command_id,
  topic,
  payload_json,
  available_at,
  queue_sequence
)
values
  (
    '00000000-0000-4000-8000-00000000da01',
    '00000000-0000-4000-8000-00000000aa33',
    'test',
    '00000000-0000-4000-8000-00000000b2a0',
    '00000000-0000-4000-8000-00000000a2a0',
    '00000000-0000-4000-8000-00000000c2a0',
    'run.command.accepted',
    '{"fixture":"fifo-head"}',
    pg_catalog.clock_timestamp() + interval '1 hour',
    1
  ),
  (
    '00000000-0000-4000-8000-00000000da01',
    '00000000-0000-4000-8000-00000000aa33',
    'test',
    '00000000-0000-4000-8000-00000000b2a1',
    '00000000-0000-4000-8000-00000000a2a0',
    '00000000-0000-4000-8000-00000000c2a1',
    'run.command.accepted',
    '{"fixture":"fifo-follower"}',
    pg_catalog.clock_timestamp() - interval '1 second',
    2
  ),
  (
    '00000000-0000-4000-8000-00000000da01',
    '00000000-0000-4000-8000-00000000aa33',
    'test',
    '00000000-0000-4000-8000-00000000b2b0',
    '00000000-0000-4000-8000-00000000a2b0',
    '00000000-0000-4000-8000-00000000c2b0',
    'run.command.accepted',
    '{"fixture":"fifo-independent"}',
    pg_catalog.clock_timestamp(),
    1
  ),
  (
    '00000000-0000-4000-8000-00000000da01',
    '00000000-0000-4000-8000-00000000aa33',
    'test',
    '00000000-0000-4000-8000-00000000b2c0',
    '00000000-0000-4000-8000-00000000a2c0',
    '00000000-0000-4000-8000-00000000c2c0',
    'run.command.accepted',
    '{"fixture":"owner-foreign-principal"}',
    pg_catalog.clock_timestamp(),
    1
  );

select test_support.assert_true(
  (
    select
      pg_catalog.max(message.queue_sequence)
        - pg_catalog.min(message.queue_sequence) = 1
      and pg_catalog.count(*) = 2
    from app_data_agent.outbox as message
    where message.run_id =
      '00000000-0000-4000-8000-00000000a2a0'::uuid
  ),
  '同 Run Outbox 必须在 Run 行锁下分配不可变单调 Queue Sequence'
);
select test_support.assert_true(
  not exists (
    select 1
    from app_data_agent.runs as run
    join app_data_agent.outbox as message
      on message.app_id = run.app_id
     and message.tenant_id = run.tenant_id
     and message.environment = run.environment
     and message.run_id = run.run_id
    where run.tenant_id =
        '00000000-0000-4000-8000-00000000aa33'::uuid
      and message.queue_sequence >= run.next_queue_sequence
  ),
  '每 Run Counter 必须始终指向尚未分配的下一个 Queue Sequence'
);
select test_support.assert_raises(
  $assert$
    update app_data_agent.outbox
    set queue_sequence = queue_sequence + 100
    where outbox_id =
      '00000000-0000-4000-8000-00000000b2a1'::uuid
  $assert$,
  'DA_OUTBOX_QUEUE_SEQUENCE_IMMUTABLE'
);
select test_support.assert_raises(
  $assert$
    update app_data_agent.runs
    set next_queue_sequence = next_queue_sequence + 2,
        updated_at = pg_catalog.clock_timestamp()
    where run_id =
      '00000000-0000-4000-8000-00000000a2a0'::uuid
  $assert$,
  'DA_RUN_IMMUTABLE'
);

set local role data_agent_backend;
select pg_catalog.set_config(
  'data_agent.app_id',
  '00000000-0000-4000-8000-00000000da01',
  true
);
select pg_catalog.set_config(
  'data_agent.tenant_id',
  '00000000-0000-4000-8000-00000000aa33',
  true
);
select pg_catalog.set_config('data_agent.environment', 'test', true);
select pg_catalog.set_config(
  'data_agent.principal_id',
  '00000000-0000-4000-8000-000000001010',
  true
);
select pg_catalog.set_config('data_agent.role', 'owner', true);
select pg_catalog.set_config(
  'data_agent.deployment_id',
  '00000000-0000-4000-8000-00000000de01',
  true
);

create temporary table u4_fifo_claim
on commit drop
as
select *
from app_data_agent.claim_run_work(
  'runtime-worker-fifo',
  1,
  30
);

select test_support.assert_true(
  (
    select
      pg_catalog.count(*) = 1
      and pg_catalog.bool_and(
        claim.run_id =
          '00000000-0000-4000-8000-00000000a2b0'::uuid
      )
    from u4_fifo_claim as claim
  ),
  '未来可用的同 Run Head 必须阻止已就绪 Follower，且不能阻塞其他 Run'
);
select test_support.assert_true(
  not exists (
    select 1
    from app_data_agent.claim_run_work(
      'runtime-worker-fifo-second',
      1,
      30
    )
  ),
  'Owner 数据面不得越过 FIFO Head，也不得领取其他 Principal 的 Run'
);
reset role;
select test_support.assert_true(
  (
    select
      message.status = 'PENDING'
      and message.attempt_count = 0
      and message.active_attempt_id is null
    from app_data_agent.outbox as message
    where message.outbox_id =
      '00000000-0000-4000-8000-00000000b2c0'::uuid
  ),
  'Owner 跨 Principal Claim 被拒绝时不得修改目标 Outbox'
);
rollback;

select test_support.assert_raises(
  $assert$
    update app_data_agent.run_projections
    set projection_hash =
      'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    where run_id = '00000000-0000-4000-8000-00000000a240'::uuid
  $assert$,
  'DA_IMMUTABLE_RECORD'
);
select test_support.assert_raises(
  $assert$
    update app_data_agent.run_effect_receipts
    set output_hash =
      'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    where receipt_id = '00000000-0000-4000-8000-00000000f241'::uuid
  $assert$,
  'DA_IMMUTABLE_RECORD'
);
