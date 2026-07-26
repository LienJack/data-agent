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

create temporary table u4_cross_entry_replay
on commit drop
as
select
  request.requested_command,
  'sha256:a51cad25baa6916772c6e63149ac066d5059dc6c5d721a66c2d35fa3121bd418'::text
    as payload_hash,
  event.requested_event,
  app_data_agent.runtime_canonical_sha256(event.requested_event)
    as event_hash
from (
  select pg_catalog.jsonb_build_object(
    'run_id',
    '00000000-0000-4000-8000-00000000a240',
    'command_id',
    '00000000-0000-4000-8000-00000000c240',
    'event_id',
    '00000000-0000-4000-8000-00000000e24a',
    'outbox_id',
    '00000000-0000-4000-8000-00000000b24a',
    'audit_id',
    '00000000-0000-4000-8000-00000000d24a',
    'idempotency_key',
    'runtime-u4-start',
    'question',
    'U4 durable runtime smoke',
    'payload',
    '{"kind":"START_L2_RESEARCH","mode":"L2"}'::jsonb
  ) as requested_command
) as request
cross join lateral (
  select pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'event_id',
    request.requested_command ->> 'event_id',
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
    request.requested_command ->> 'run_id',
    'sequence',
    1,
    'worker_fence',
    0,
    'idempotency_key',
    'event:' || (request.requested_command ->> 'event_id'),
    'occurred_at',
    '2026-07-26T00:00:00.000Z',
    'event_type',
    'run.accepted',
    'payload',
    pg_catalog.jsonb_build_object(
      'command_id',
      request.requested_command ->> 'command_id',
      'payload_hash',
      'sha256:a51cad25baa6916772c6e63149ac066d5059dc6c5d721a66c2d35fa3121bd418'
    )
  ) as requested_event
) as event;

select test_support.assert_true(
  (
    select
      not (replay.result ->> 'created')::boolean
      and replay.result ->> 'run_id' =
        request.requested_command ->> 'run_id'
      and replay.result ->> 'command_id' =
        request.requested_command ->> 'command_id'
      and replay.result ->> 'outbox_id' = (
        select message.outbox_id::text
        from app_data_agent.outbox as message
        where message.run_id =
          (request.requested_command ->> 'run_id')::uuid
          and message.command_id =
            (request.requested_command ->> 'command_id')::uuid
          and message.topic = 'run.command.accepted'
        order by message.created_at, message.outbox_id
        limit 1
      )
      and replay.result ->> 'outbox_id'
        <> request.requested_command ->> 'outbox_id'
    from u4_cross_entry_replay as request
    cross join lateral (
      select app_data_agent.accept_backend_run_command(
        request.requested_command,
        request.payload_hash,
        request.requested_event,
        request.event_hash
      ) as result
    ) as replay
  ),
  'Browser 首写后 Backend 必须跨入口 replay，并返回权威既存 Outbox ID'
);

create temporary table u4_prior_fixture_lease
on commit drop
as
select *
from app_data_agent.claim_run_work(
  'runtime-prior-fixture-isolation',
  1,
  900
);

select test_support.assert_true(
  (
    select
      pg_catalog.count(*) = 1
      and pg_catalog.bool_and(
        lease.run_id =
          '00000000-0000-4000-8000-00000000a201'::uuid
      )
    from u4_prior_fixture_lease as lease
  ),
  'Runtime 测试必须先隔离 20 号接收契约留下的更早队列项'
);

create temporary table u4_runtime_lease
on commit drop
as
select
  claimed.*,
  test_support.runtime_lease_document(
    pg_catalog.to_jsonb(claimed)
  ) as lease_document
from app_data_agent.claim_run_work(
  'runtime-worker-a',
  1,
  30
) as claimed;

select test_support.assert_true(
  (
    select
      pg_catalog.count(*) = 1
      and pg_catalog.bool_and(lease.command_kind = 'START_L2_RESEARCH')
      and pg_catalog.bool_and(lease.attempt_no = 1)
      and pg_catalog.bool_and(lease.delivery_attempt_no = 1)
      and pg_catalog.bool_and(lease.lease_duration_ms = 30000)
      and pg_catalog.bool_and(
        lease.lease_document ->> 'delivery_attempt_no' = '1'
      )
      and pg_catalog.bool_and(
        lease.lease_document ->> 'lease_duration_ms' = '30000'
      )
      and pg_catalog.bool_and(lease.lease_token = 1)
      and pg_catalog.bool_and(lease.worker_fence = 1)
    from u4_runtime_lease as lease
  ),
  'claim_run_work 必须原子创建 Attempt，并同时提升 Lease Token 与 Run Fence'
);
select test_support.assert_true(
  (
    select
      run.status = 'RUNNING'
      and run.active_fence = lease.worker_fence
      and message.active_attempt_id = lease.attempt_id
      and message.run_fence = lease.worker_fence
      and attempt.status = 'ACTIVE'
    from u4_runtime_lease as lease
    join app_data_agent.runs as run
      on run.run_id = lease.run_id
    join app_data_agent.outbox as message
      on message.outbox_id = lease.outbox_id
    join app_data_agent.run_attempts as attempt
      on attempt.attempt_id = lease.attempt_id
  ),
  'Run、Outbox 与 Attempt 必须共享同一个 Active Fence'
);
create temporary table u4_runtime_heartbeats
on commit drop
as
select
  app_data_agent.heartbeat_run_work(
    lease.outbox_id,
    lease.attempt_id,
    lease.worker_id,
    lease.lease_token,
    lease.worker_fence,
    30
  ) as first_expires_at,
  null::timestamptz as second_expires_at
from u4_runtime_lease as lease;

update u4_runtime_heartbeats as heartbeat
set second_expires_at = app_data_agent.heartbeat_run_work(
  lease.outbox_id,
  lease.attempt_id,
  lease.worker_id,
  lease.lease_token,
  lease.worker_fence,
  30
)
from u4_runtime_lease as lease;

select test_support.assert_true(
  (
    select
      heartbeat.first_expires_at > lease.expires_at
      and heartbeat.second_expires_at > heartbeat.first_expires_at
      and heartbeat.second_expires_at <
        heartbeat.first_expires_at + interval '5 seconds'
      and heartbeat.second_expires_at <
        pg_catalog.clock_timestamp() + interval '31 seconds'
    from u4_runtime_lease as lease
    cross join u4_runtime_heartbeats as heartbeat
  ),
  'Heartbeat 必须从当前时刻续租，连续调用不得把过期时间累计到远未来'
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.heartbeat_run_work(
      lease.outbox_id,
      lease.attempt_id,
      lease.worker_id,
      lease.lease_token,
      lease.worker_fence + 1,
      10
    )
    from u4_runtime_lease as lease
  $assert$,
  'DA_RUN_LEASE_STALE'
);

create temporary table u4_runtime_lease_event
on commit drop
as
select
  lease.lease_document,
  candidate.event_document,
  projection.projection_hash as expected_projection_hash,
  test_support.reduce_run_projection(
    projection.projection_json,
    candidate.event_document
  ) as projection_document
from u4_runtime_lease as lease
join app_data_agent.run_projections as projection
  on projection.run_id = lease.run_id
 and projection.version = 1
cross join lateral (
  select pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'event_id',
    '00000000-0000-4000-8000-00000000e240',
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
    'runtime-u4-lease-event',
    'occurred_at',
    '2026-07-26T00:00:00.000Z',
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
) as candidate;

select test_support.assert_raises(
  $assert$
    select app_data_agent.append_run_event(
      candidate.lease_document,
      candidate.event_document,
      'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      candidate.expected_projection_hash,
      candidate.projection_document,
      app_data_agent.runtime_canonical_sha256(
        candidate.projection_document
      )
    )
    from u4_runtime_lease_event as candidate
  $assert$,
  'DA_RUN_EVENT_HASH_MISMATCH'
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.append_run_event(
      candidate.lease_document,
      candidate.event_document,
      app_data_agent.runtime_canonical_sha256(candidate.event_document),
      candidate.expected_projection_hash,
      candidate.projection_document,
      'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    )
    from u4_runtime_lease_event as candidate
  $assert$,
  'DA_RUN_PROJECTION_HASH_MISMATCH'
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.append_run_event(
      candidate.lease_document,
      candidate.event_document,
      app_data_agent.runtime_canonical_sha256(candidate.event_document),
      candidate.expected_projection_hash,
      semantic_tamper.projection_document,
      app_data_agent.runtime_canonical_sha256(
        semantic_tamper.projection_document
      )
    )
    from u4_runtime_lease_event as candidate
    cross join lateral (
      select candidate.projection_document ||
        '{"attempt_count":99}'::jsonb as projection_document
    ) as semantic_tamper
  $assert$,
  'DA_RUN_PROJECTION_SEMANTIC_MISMATCH'
);
select test_support.assert_raises(
  $assert$
    select test_support.append_run_event_canonical(
      candidate.lease_document || pg_catalog.jsonb_build_object(
        'lease_token',
        (candidate.lease_document ->> 'lease_token')::bigint + 1
      ),
      candidate.event_document,
      candidate.expected_projection_hash,
      candidate.projection_document
    )
    from u4_runtime_lease_event as candidate
  $assert$,
  'DA_RUN_EVENT_LEASE_STALE'
);

select test_support.append_run_event_canonical(
  candidate.lease_document,
  candidate.event_document,
  candidate.expected_projection_hash,
  candidate.projection_document
)
from u4_runtime_lease_event as candidate;

insert into app_data_agent.artifacts (
  app_id,
  tenant_id,
  environment,
  run_id,
  artifact_id,
  artifact_type,
  revision,
  content_hash,
  document_json,
  worker_fence
)
select
  (lease.lease_document -> 'scope' ->> 'app_id')::uuid,
  (lease.lease_document -> 'scope' ->> 'tenant_id')::uuid,
  lease.lease_document -> 'scope' ->> 'environment',
  lease.run_id,
  artifact.artifact_id,
  'AnalysisReport',
  1,
  artifact.content_hash,
  artifact.document_json,
  lease.worker_fence
from u4_runtime_lease as lease
cross join (
  values
    (
      '00000000-0000-4000-8000-00000000f24a'::uuid,
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '{"fixture":"checkpoint-artifact-a"}'::jsonb
    ),
    (
      '00000000-0000-4000-8000-00000000f24b'::uuid,
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      '{"fixture":"checkpoint-artifact-b"}'::jsonb
    )
) as artifact(artifact_id, content_hash, document_json);

create temporary table u4_runtime_checkpoint
on commit drop
as
select
  lease.lease_document,
  binding.document as binding_document
from u4_runtime_lease as lease
cross join lateral (
  select pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'authority',
    'EXECUTION_SNAPSHOT_ONLY',
    'snapshot_id',
    '00000000-0000-4000-8000-00000000f240',
    'scope',
    lease.lease_document -> 'scope',
    'run_id',
    lease.run_id,
    'workflow_id',
    'l2-research',
    'workflow_definition_revision',
    'sha256:3333333333333333333333333333333333333333333333333333333333333333',
    'mastra_core_version',
    '1.52.1',
    'mastra_run_id',
    'mastra-u4-run',
    'attempt_id',
    lease.attempt_id,
    'snapshot_version',
    1,
    'event_sequence',
    2,
    'worker_fence',
    lease.worker_fence,
    'active_artifact_ref',
    pg_catalog.jsonb_build_object(
      'artifact_id',
      '00000000-0000-4000-8000-00000000f24a',
      'artifact_type',
      'AnalysisReport',
      'app_id',
      '00000000-0000-4000-8000-00000000da01',
      'tenant_id',
      '00000000-0000-4000-8000-00000000aa11',
      'environment',
      'test',
      'run_id',
      lease.run_id,
      'revision',
      1,
      'content_hash',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    ),
    'mastra_snapshot',
    pg_catalog.jsonb_build_object(
      'runId',
      'mastra-u4-run',
      'status',
      'running'
    ),
    'created_at',
    '2026-07-26T00:00:00.500Z'
  ) as document
) as binding;

select test_support.assert_raises(
  $assert$
    select app_data_agent.commit_run_checkpoint(
      checkpoint.lease_document,
      checkpoint.binding_document || pg_catalog.jsonb_build_object(
        'snapshot_hash',
        'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      )
    )
    from u4_runtime_checkpoint as checkpoint
  $assert$,
  'DA_RUN_CHECKPOINT_INPUT_INVALID'
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.commit_run_checkpoint(
      checkpoint.lease_document || pg_catalog.jsonb_build_object(
        'lease_token',
        (checkpoint.lease_document ->> 'lease_token')::bigint + 1
      ),
      checkpoint.binding_document
    )
    from u4_runtime_checkpoint as checkpoint
  $assert$,
  'DA_RUN_CHECKPOINT_STALE_LEASE'
);
select test_support.assert_true(
  (
    select (
      app_data_agent.commit_run_checkpoint(
        checkpoint.lease_document,
        checkpoint.binding_document
      ) ->> 'created'
    )::boolean
    from u4_runtime_checkpoint as checkpoint
  ),
  'Checkpoint 必须绑定当前 Lease、Attempt、Fence 与 Event Sequence'
);
select test_support.assert_true(
  (
    select
      persisted.snapshot_hash =
        app_data_agent.runtime_canonical_sha256(
          checkpoint.binding_document
        )
      and persisted.binding_json - 'snapshot_hash' =
        checkpoint.binding_document
      and persisted.binding_json ->> 'snapshot_hash' =
        persisted.snapshot_hash
    from u4_runtime_checkpoint as checkpoint
    join app_data_agent.run_checkpoints as persisted
      on persisted.snapshot_id =
        (checkpoint.binding_document ->> 'snapshot_id')::uuid
  ),
  'Checkpoint Hash 必须由数据库 canonical hash 重算并持久化'
);
update app_data_agent.artifacts as artifact
set is_active = false
where artifact.run_id = '00000000-0000-4000-8000-00000000a240'::uuid
  and artifact.artifact_id = '00000000-0000-4000-8000-00000000f24a'::uuid
  and artifact.revision = 1
  and artifact.is_active;
insert into app_data_agent.artifacts (
  app_id,
  tenant_id,
  environment,
  run_id,
  artifact_id,
  artifact_type,
  revision,
  content_hash,
  document_json,
  worker_fence,
  is_active,
  parent_revision,
  parent_content_hash
)
select
  (lease.lease_document -> 'scope' ->> 'app_id')::uuid,
  (lease.lease_document -> 'scope' ->> 'tenant_id')::uuid,
  lease.lease_document -> 'scope' ->> 'environment',
  lease.run_id,
  '00000000-0000-4000-8000-00000000f24a'::uuid,
  'AnalysisReport',
  2,
  'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  '{"fixture":"checkpoint-artifact-a-revision-2"}'::jsonb,
  lease.worker_fence,
  true,
  1,
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
from u4_runtime_lease as lease;
select test_support.assert_raises(
  $assert$
    select test_support.append_run_event_canonical(
      checkpoint.lease_document,
      candidate.event_document,
      projection.projection_hash,
      test_support.reduce_run_projection(
        projection.projection_json,
        candidate.event_document
      )
    )
    from u4_runtime_checkpoint as checkpoint
    join app_data_agent.run_checkpoints as persisted
      on persisted.snapshot_id =
        (checkpoint.binding_document ->> 'snapshot_id')::uuid
    join app_data_agent.run_projections as projection
      on projection.run_id = persisted.run_id
     and projection.version = 2
    cross join lateral (
      select pg_catalog.jsonb_build_object(
        'schema_version',
        '1.0.0',
        'event_id',
        '00000000-0000-4000-8000-00000000e247',
        'scope',
        checkpoint.lease_document -> 'scope',
        'run_id',
        persisted.run_id,
        'sequence',
        3,
        'worker_fence',
        persisted.worker_fence,
        'idempotency_key',
        'runtime-u4-checkpoint-artifact-rebound',
        'occurred_at',
        '2026-07-26T00:00:00.625Z',
        'event_type',
        'run.checkpointed',
        'payload',
        pg_catalog.jsonb_build_object(
          'snapshot_ref',
          pg_catalog.jsonb_build_object(
            'snapshot_id',
            persisted.snapshot_id,
            'snapshot_version',
            persisted.snapshot_version,
            'snapshot_hash',
            persisted.snapshot_hash
          ),
          'active_artifact_ref',
          persisted.binding_json -> 'active_artifact_ref'
        )
      ) as event_document
    ) as candidate
  $assert$,
  'DA_RUN_EVENT_TRANSITION_INVALID'
);
select test_support.assert_raises(
  $assert$
    select test_support.append_run_event_canonical(
      checkpoint.lease_document,
      candidate.event_document,
      projection.projection_hash,
      test_support.reduce_run_projection(
        projection.projection_json,
        candidate.event_document
      )
    )
    from u4_runtime_checkpoint as checkpoint
    join app_data_agent.run_checkpoints as persisted
      on persisted.snapshot_id =
        (checkpoint.binding_document ->> 'snapshot_id')::uuid
    join app_data_agent.run_projections as projection
      on projection.run_id = persisted.run_id
     and projection.version = 2
    cross join lateral (
      select pg_catalog.jsonb_build_object(
        'schema_version',
        '1.0.0',
        'event_id',
        '00000000-0000-4000-8000-00000000e244',
        'scope',
        checkpoint.lease_document -> 'scope',
        'run_id',
        persisted.run_id,
        'sequence',
        3,
        'worker_fence',
        persisted.worker_fence,
        'idempotency_key',
        'runtime-u4-checkpoint-artifact-mismatch',
        'occurred_at',
        '2026-07-26T00:00:00.750Z',
        'event_type',
        'run.checkpointed',
        'payload',
        pg_catalog.jsonb_build_object(
          'snapshot_ref',
          pg_catalog.jsonb_build_object(
            'snapshot_id',
            persisted.snapshot_id,
            'snapshot_version',
            persisted.snapshot_version,
            'snapshot_hash',
            persisted.snapshot_hash
          ),
          'active_artifact_ref',
          pg_catalog.jsonb_build_object(
            'artifact_id',
            '00000000-0000-4000-8000-00000000f24b',
            'artifact_type',
            'AnalysisReport',
            'app_id',
            persisted.app_id,
            'tenant_id',
            persisted.tenant_id,
            'environment',
            persisted.environment,
            'run_id',
            persisted.run_id,
            'revision',
            1,
            'content_hash',
            'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
          )
        )
      ) as event_document
    ) as candidate
  $assert$,
  'DA_RUN_EVENT_TRANSITION_INVALID'
);

create temporary table u4_runtime_effect
on commit drop
as
select
  lease.lease_document,
  pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'receipt_id',
    '00000000-0000-4000-8000-00000000f241',
    'scope',
    lease.lease_document -> 'scope',
    'run_id',
    lease.run_id,
    'effect_kind',
    'SQL',
    'input_hash',
    'sha256:5555555555555555555555555555555555555555555555555555555555555555',
    'output_hash',
    'sha256:6666666666666666666666666666666666666666666666666666666666666666',
    'worker_fence',
    lease.worker_fence,
    'committed_at',
    '2026-07-26T00:00:01.000Z'
  ) as receipt_document
from u4_runtime_lease as lease;

select test_support.assert_raises(
  $assert$
    select app_data_agent.commit_run_effect_receipt(
      effect.lease_document || pg_catalog.jsonb_build_object(
        'worker_id',
        'runtime-worker-wrong'
      ),
      effect.receipt_document
    )
    from u4_runtime_effect as effect
  $assert$,
  'DA_RUN_EFFECT_STALE_LEASE'
);
select test_support.assert_true(
  (
    select (
      app_data_agent.commit_run_effect_receipt(
        effect.lease_document,
        effect.receipt_document
      ) ->> 'created'
    )::boolean
    from u4_runtime_effect as effect
  ),
  'Side Effect Receipt 首次内容寻址提交必须 created=true'
);
select test_support.assert_true(
  (
    select not (
      app_data_agent.commit_run_effect_receipt(
        effect.lease_document,
        effect.receipt_document
      ) ->> 'created'
    )::boolean
    from u4_runtime_effect as effect
  ),
  '同一 Side Effect Receipt 重放必须 created=false'
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.commit_run_effect_receipt(
      effect.lease_document,
      effect.receipt_document || pg_catalog.jsonb_build_object(
        'receipt_id',
        '00000000-0000-4000-8000-00000000f242',
        'output_hash',
        'sha256:7777777777777777777777777777777777777777777777777777777777777777',
        'committed_at',
        '2026-07-26T00:00:01.500Z'
      )
    )
    from u4_runtime_effect as effect
  $assert$,
  'DA_RUN_EFFECT_IDEMPOTENCY_CONFLICT'
);
create temporary table u4_runtime_side_effect_event
on commit drop
as
select
  effect.lease_document,
  candidate.event_document,
  projection.projection_hash as expected_projection_hash,
  test_support.reduce_run_projection(
    projection.projection_json,
    candidate.event_document
  ) as projection_document
from u4_runtime_effect as effect
join app_data_agent.run_projections as projection
  on projection.run_id =
    (effect.receipt_document ->> 'run_id')::uuid
 and projection.version = 2
cross join lateral (
  select pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'event_id',
    '00000000-0000-4000-8000-00000000e245',
    'scope',
    effect.lease_document -> 'scope',
    'run_id',
    effect.receipt_document ->> 'run_id',
    'sequence',
    3,
    'worker_fence',
    (effect.lease_document ->> 'worker_fence')::bigint,
    'idempotency_key',
    'runtime-u4-intervening-side-effect',
    'occurred_at',
    '2026-07-26T00:00:01.750Z',
    'event_type',
    'run.side_effect_committed',
    'payload',
    pg_catalog.jsonb_build_object(
      'receipt_id',
      effect.receipt_document ->> 'receipt_id',
      'effect_kind',
      effect.receipt_document ->> 'effect_kind',
      'input_hash',
      effect.receipt_document ->> 'input_hash',
      'output_hash',
      effect.receipt_document ->> 'output_hash'
    )
  ) as event_document
) as candidate;

select test_support.append_run_event_canonical(
  candidate.lease_document,
  candidate.event_document,
  candidate.expected_projection_hash,
  candidate.projection_document
)
from u4_runtime_side_effect_event as candidate;

select test_support.assert_raises(
  $assert$
    select test_support.append_run_event_canonical(
      checkpoint.lease_document,
      candidate.event_document,
      projection.projection_hash,
      test_support.reduce_run_projection(
        projection.projection_json,
        candidate.event_document
      )
    )
    from u4_runtime_checkpoint as checkpoint
    join app_data_agent.run_checkpoints as persisted
      on persisted.snapshot_id =
        (checkpoint.binding_document ->> 'snapshot_id')::uuid
    join app_data_agent.run_projections as projection
      on projection.run_id = persisted.run_id
     and projection.version = 3
    cross join lateral (
      select pg_catalog.jsonb_build_object(
        'schema_version',
        '1.0.0',
        'event_id',
        '00000000-0000-4000-8000-00000000e246',
        'scope',
        checkpoint.lease_document -> 'scope',
        'run_id',
        persisted.run_id,
        'sequence',
        4,
        'worker_fence',
        persisted.worker_fence,
        'idempotency_key',
        'runtime-u4-stale-checkpoint-event',
        'occurred_at',
        '2026-07-26T00:00:01.875Z',
        'event_type',
        'run.checkpointed',
        'payload',
        pg_catalog.jsonb_build_object(
          'snapshot_ref',
          pg_catalog.jsonb_build_object(
            'snapshot_id',
            persisted.snapshot_id,
            'snapshot_version',
            persisted.snapshot_version,
            'snapshot_hash',
            persisted.snapshot_hash
          ),
          'active_artifact_ref',
          persisted.binding_json -> 'active_artifact_ref'
        )
      ) as event_document
    ) as candidate
  $assert$,
  'DA_RUN_EVENT_TRANSITION_INVALID'
);
select test_support.assert_true(
  (
    select
      pg_catalog.max(projection.version) = 3
      and not exists (
        select 1
        from app_data_agent.run_events as rejected
        where rejected.run_id =
            '00000000-0000-4000-8000-00000000a240'::uuid
          and rejected.event_id in (
            '00000000-0000-4000-8000-00000000e244'::uuid,
            '00000000-0000-4000-8000-00000000e246'::uuid
          )
      )
    from app_data_agent.run_projections as projection
    where projection.run_id =
      '00000000-0000-4000-8000-00000000a240'::uuid
  ),
  'Artifact 不匹配与过期 Checkpoint Event 都不得写入 Event/Projection'
);
select test_support.assert_raises(
  $assert$
    update app_data_agent.run_projections
    set projection_hash =
      'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    where run_id = '00000000-0000-4000-8000-00000000a240'::uuid
  $assert$,
  'permission denied'
);

select test_support.assert_true(
  (
    select not (
      test_support.request_run_control_canonical(
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
        'CANCEL',
        'run_id',
        '00000000-0000-4000-8000-00000000a240',
        'command_id',
        '00000000-0000-4000-8000-00000000c242',
        'event_id',
        '00000000-0000-4000-8000-00000000e242',
        'outbox_id',
        '00000000-0000-4000-8000-00000000b242',
        'audit_id',
        '00000000-0000-4000-8000-00000000d242',
        'idempotency_key',
        'runtime-u4-cancel',
        'occurred_at',
        '2026-07-26T00:00:02.000Z'
      ),
      pg_catalog.jsonb_build_object(
        'schema_version',
        '1.0.0',
        'event_id',
        '00000000-0000-4000-8000-00000000e242',
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
        '00000000-0000-4000-8000-00000000a240',
        'sequence',
        4,
        'worker_fence',
        lease.worker_fence + 1,
        'idempotency_key',
        'runtime-u4-cancel',
        'occurred_at',
        '2026-07-26T00:00:02.000Z',
        'event_type',
        'run.cancel_requested',
        'payload',
        pg_catalog.jsonb_build_object(
          'command_id',
          '00000000-0000-4000-8000-00000000c242'
        )
      ),
      projection.projection_hash,
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
        'run_id',
        '00000000-0000-4000-8000-00000000a240',
        'status',
        'CANCELLED',
        'version',
        4,
        'worker_fence',
        lease.worker_fence + 1,
        'attempt_count',
        1,
        'last_event_id',
        '00000000-0000-4000-8000-00000000e242',
        'last_occurred_at',
        '2026-07-26T00:00:02.000Z',
        'active_artifact_ref',
        null,
        'active_snapshot_ref',
        null,
        'last_side_effect_receipt_id',
        '00000000-0000-4000-8000-00000000f241',
        'terminal_event_id',
        '00000000-0000-4000-8000-00000000e242'
      )
      ) ->> 'replayed'
    )::boolean
    from u4_runtime_lease as lease
    join app_data_agent.run_projections as projection
      on projection.run_id = lease.run_id
     and projection.version = 3
  ),
  'CANCEL 必须在同一事务提升 Fence、终止 Attempt 并提交终态 Projection'
);

select test_support.assert_raises(
  $assert$
    select test_support.append_run_event_canonical(
      lease.lease_document,
      pg_catalog.jsonb_build_object(
        'schema_version',
        '1.0.0',
        'event_id',
        '00000000-0000-4000-8000-00000000e243',
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
        '00000000-0000-4000-8000-00000000a240',
        'sequence',
        5,
        'worker_fence',
        lease.worker_fence,
        'idempotency_key',
        'runtime-u4-late-success',
        'occurred_at',
        '2026-07-26T00:00:03.000Z',
        'event_type',
        'run.completed',
        'payload',
        pg_catalog.jsonb_build_object(
          'completion_kind',
          'WORKFLOW_EXECUTION_ONLY'
        )
      ),
      projection.projection_hash,
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
        'run_id',
        '00000000-0000-4000-8000-00000000a240',
        'status',
        'COMPLETED',
        'version',
        5,
        'worker_fence',
        lease.worker_fence,
        'attempt_count',
        1,
        'last_event_id',
        '00000000-0000-4000-8000-00000000e243',
        'last_occurred_at',
        '2026-07-26T00:00:03.000Z',
        'active_artifact_ref',
        null,
        'active_snapshot_ref',
        null,
        'last_side_effect_receipt_id',
        '00000000-0000-4000-8000-00000000f241',
        'terminal_event_id',
        '00000000-0000-4000-8000-00000000e243'
      )
    )
    from u4_runtime_lease as lease
    join app_data_agent.run_projections as projection
      on projection.run_id = lease.run_id
     and projection.version = 4
  $assert$,
  'DA_RUN_EVENT_FENCE_STALE'
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.commit_run_checkpoint(
      checkpoint.lease_document,
      checkpoint.binding_document
    )
    from u4_runtime_checkpoint as checkpoint
  $assert$,
  'DA_RUN_CHECKPOINT_STALE_LEASE'
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.commit_run_effect_receipt(
      effect.lease_document,
      effect.receipt_document
    )
    from u4_runtime_effect as effect
  $assert$,
  'DA_RUN_EFFECT_STALE_LEASE'
);
select test_support.assert_true(
  (
    select
      run.status = 'CANCELLED'
      and run.active_fence = lease.worker_fence + 1
      and attempt.status = 'CANCELLED'
      and message.status = 'DEAD_LETTER'
      and projection.status = 'CANCELLED'
    from u4_runtime_lease as lease
    join app_data_agent.runs as run
      on run.run_id = lease.run_id
    join app_data_agent.run_attempts as attempt
      on attempt.attempt_id = lease.attempt_id
    join app_data_agent.outbox as message
      on message.outbox_id = lease.outbox_id
    join app_data_agent.run_projections as projection
      on projection.run_id = lease.run_id
     and projection.version = 4
  ),
  '取消竞态后旧 Worker、旧 Outbox 与迟到 Success 都不得覆盖终态'
);
commit;
