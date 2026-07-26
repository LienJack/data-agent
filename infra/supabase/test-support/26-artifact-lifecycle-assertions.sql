\set ON_ERROR_STOP on

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
values (
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa11'::uuid,
  'test',
  '00000000-0000-4000-8000-00000000a101'::uuid,
  '00000000-0000-4000-8000-00000000f101'::uuid,
  'ResearchPlan',
  1,
  'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  '{"revision":1}'::jsonb,
  1
);
update app_data_agent.artifacts
set is_active = false
where artifact_id = '00000000-0000-4000-8000-00000000f101'::uuid
  and revision = 1;
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
  parent_revision,
  parent_content_hash
)
values (
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa11'::uuid,
  'test',
  '00000000-0000-4000-8000-00000000a101'::uuid,
  '00000000-0000-4000-8000-00000000f101'::uuid,
  'ResearchPlan',
  2,
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  '{"revision":2}'::jsonb,
  2,
  1,
  'sha256:1111111111111111111111111111111111111111111111111111111111111111'
);
select test_support.assert_raises(
  $assert$
    update app_data_agent.artifacts
    set document_json = '{"tampered":true}'::jsonb
    where artifact_id = '00000000-0000-4000-8000-00000000f101'::uuid
      and revision = 2
  $assert$,
  'DA_ARTIFACT_REVISION_IMMUTABLE'
);

select test_support.assert_raises(
  $assert$
    select platform.transition_app_lifecycle(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      'test',
      'ACTIVE',
      'FROZEN',
      'FREEZE',
      '00000000-0000-4000-8000-00000000f009'::uuid,
      platform.compute_lifecycle_receipt_hash(
        '00000000-0000-4000-8000-00000000f009'::uuid,
        '00000000-0000-4000-8000-00000000da01'::uuid,
        'prod',
        'ACTIVE',
        'FROZEN',
        'FREEZE',
        '{"reason":"cross-environment-replay"}'::jsonb
      ),
      '{"reason":"cross-environment-replay"}'::jsonb
    )
  $assert$,
  'DA_BOUNDARY_RECEIPT_HASH_INVALID'
);
select test_support.assert_raises(
  $assert$
    select platform.transition_app_lifecycle(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      'test',
      'ACTIVE',
      'FROZEN',
      'FREEZE',
      '00000000-0000-4000-8000-00000000f000'::uuid,
      'sha256:3333333333333333333333333333333333333333333333333333333333333333',
      '{"reason":"forged-hash"}'::jsonb
    )
  $assert$,
  'DA_BOUNDARY_RECEIPT_HASH_INVALID'
);

select platform.transition_app_lifecycle(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'test',
  'ACTIVE',
  'FROZEN',
  'FREEZE',
  '00000000-0000-4000-8000-00000000f001'::uuid,
  platform.compute_lifecycle_receipt_hash(
    '00000000-0000-4000-8000-00000000f001'::uuid,
    '00000000-0000-4000-8000-00000000da01'::uuid,
    'test',
    'ACTIVE',
    'FROZEN',
    'FREEZE',
    '{"reason":"smoke-freeze"}'::jsonb
  ),
  '{"reason":"smoke-freeze"}'::jsonb
);

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000001001"}',
  false
);
select test_support.assert_raises(
  $assert$
    select api.data_agent__accept_run_command(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000a205'::uuid,
      '00000000-0000-4000-8000-00000000c205'::uuid,
      'frozen-write',
      'frozen app must reject writes',
      '{"kind":"frozen"}'::jsonb,
      'sha256:ebb04375de669f2f70fb447117705096dd4a8ea8b1928315def7bf11f5b18e4e'
    )
  $assert$,
  'DA_WRITE_FORBIDDEN'
);
reset role;

begin;
set local role data_agent_backend;
select test_support.assert_raises(
  $assert$
    select *
    from platform.revalidate_backend_authority(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      'test',
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-000000001001'::uuid,
      'owner',
      1,
      1,
      true
    )
  $assert$,
  'DA_AUTHORITY_STALE_OR_FORBIDDEN'
);
select test_support.assert_raises(
  $assert$
    select platform.cleanup_scope_authority(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      'test',
      'ENUMERATE'
    )
  $assert$,
  'permission denied'
);
rollback;

select platform.transition_app_lifecycle(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'test',
  'FROZEN',
  'EXPORT_PENDING',
  'EXPORT_REQUESTED',
  '00000000-0000-4000-8000-00000000f002'::uuid,
  platform.compute_lifecycle_receipt_hash(
    '00000000-0000-4000-8000-00000000f002'::uuid,
    '00000000-0000-4000-8000-00000000da01'::uuid,
    'test',
    'FROZEN',
    'EXPORT_PENDING',
    'EXPORT_REQUESTED',
    '{"scope":"all-app-resources"}'::jsonb
  ),
  '{"scope":"all-app-resources"}'::jsonb
);

select test_support.assert_true(
  not pg_catalog.has_table_privilege(
    'data_agent_job_authority',
    'app_data_agent.runs',
    'DELETE'
  )
  and not pg_catalog.has_table_privilege(
    'data_agent_job_authority',
    'storage.objects',
    'DELETE'
  ),
  'Job Authority 不能直接写业务表或 Storage'
);
set role data_agent_job_authority;
select test_support.assert_true(
  (
    platform.cleanup_scope_authority(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      'test',
      'EXPORT'
    ) ->> 'capability'
  ) = 'LIFECYCLE_CLEANUP',
  'EXPORT_PENDING 只签发窄 cleanup capability'
);
select test_support.assert_raises(
  $assert$
    select platform.cleanup_scope_authority(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      'test',
      'DELETE'
    )
  $assert$,
  'DA_CLEANUP_ACTION_FORBIDDEN'
);
select test_support.assert_raises(
  $assert$
    select platform.record_resource_manifest(
      '00000000-0000-4000-8000-00000000fb09'::uuid,
      '00000000-0000-4000-8000-00000000da01'::uuid,
      'prod',
      'EXPORT_PENDING',
      3,
      7,
      2,
      1,
      '{"database":["app_data_agent"],"storage":["data-agent-artifacts"],"redis":["data-agent:prod"]}'::jsonb,
      'sha256:9999999999999999999999999999999999999999999999999999999999999999',
      '00000000-0000-4000-8000-00000000fa01'::uuid,
      'smoke-job-key-v1',
      'ed25519:9999999999999999999999999999999999999999999999999999999999999999'
    )
  $assert$,
  'DA_CLEANUP_ACTION_FORBIDDEN'
);
select test_support.assert_raises(
  $assert$
    select platform.record_resource_manifest(
      '00000000-0000-4000-8000-00000000fb01'::uuid,
      '00000000-0000-4000-8000-00000000da01'::uuid,
      'test',
      'EXPORT_PENDING',
      3,
      7,
      2,
      1,
      '{"database":["app_data_agent"],"storage":["data-agent-artifacts"],"redis":["data-agent:test"]}'::jsonb,
      'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      '00000000-0000-4000-8000-00000000fa01'::uuid,
      'smoke-job-key-v1',
      'ed25519:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )
  $assert$,
  'DA_JOB_PAYLOAD_HASH_MISMATCH'
);
select platform.record_resource_manifest(
  '00000000-0000-4000-8000-00000000fb01'::uuid,
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'test',
  'EXPORT_PENDING',
  3,
  7,
  2,
  1,
  '{"database":["app_data_agent"],"storage":["data-agent-artifacts"],"redis":["data-agent:test"]}'::jsonb,
  platform.compute_resource_manifest_hash(
    '00000000-0000-4000-8000-00000000fb01'::uuid,
    '00000000-0000-4000-8000-00000000da01'::uuid,
    'test',
    'EXPORT_PENDING',
    3,
    7,
    2,
    1,
    '{"database":["app_data_agent"],"storage":["data-agent-artifacts"],"redis":["data-agent:test"]}'::jsonb
  ),
  '00000000-0000-4000-8000-00000000fa01'::uuid,
  'smoke-job-key-v1',
  'ed25519:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
);
select test_support.assert_raises(
  $assert$
    select platform.record_resource_operation_receipt(
      '00000000-0000-4000-8000-00000000fb09'::uuid,
      '00000000-0000-4000-8000-00000000da01'::uuid,
      'prod',
      3,
      'EXPORT',
      'EXPORT_PENDING',
      'FROZEN',
      '00000000-0000-4000-8000-00000000fb01'::uuid,
      null,
      7,
      2,
      1,
      7,
      2,
      1,
      'sha256:9999999999999999999999999999999999999999999999999999999999999999',
      '00000000-0000-4000-8000-00000000fa01'::uuid,
      'smoke-job-key-v1',
      'ed25519:9999999999999999999999999999999999999999999999999999999999999999'
    )
  $assert$,
  'DA_CLEANUP_ACTION_FORBIDDEN'
);
select platform.record_resource_operation_receipt(
  '00000000-0000-4000-8000-00000000fb02'::uuid,
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'test',
  3,
  'EXPORT',
  'EXPORT_PENDING',
  'FROZEN',
  '00000000-0000-4000-8000-00000000fb01'::uuid,
  null,
  7,
  2,
  1,
  7,
  2,
  1,
  platform.compute_resource_operation_hash(
    '00000000-0000-4000-8000-00000000fb02'::uuid,
    '00000000-0000-4000-8000-00000000da01'::uuid,
    'test',
    3,
    'EXPORT',
    'EXPORT_PENDING',
    'FROZEN',
    '00000000-0000-4000-8000-00000000fb01'::uuid,
    null,
    7,
    2,
    1,
    7,
    2,
    1
  ),
  '00000000-0000-4000-8000-00000000fa01'::uuid,
  'smoke-job-key-v1',
  'ed25519:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
);
reset role;

select test_support.assert_raises(
  $assert$
    select platform.transition_app_lifecycle(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      'test',
      'EXPORT_PENDING',
      'FROZEN',
      'EXPORT_COMPLETED',
      '00000000-0000-4000-8000-00000000f008'::uuid,
      platform.compute_lifecycle_receipt_hash(
        '00000000-0000-4000-8000-00000000f008'::uuid,
        '00000000-0000-4000-8000-00000000da01'::uuid,
        'test',
        'EXPORT_PENDING',
        'FROZEN',
        'EXPORT_COMPLETED',
        pg_catalog.jsonb_build_object(
          'operation_receipt_id',
          '00000000-0000-4000-8000-00000000fb02',
          'resource_manifest_hash',
          (
            select manifest.payload_hash
            from platform.resource_manifests as manifest
            where manifest.manifest_id =
              '00000000-0000-4000-8000-00000000fb01'::uuid
          )
        )
      ),
      pg_catalog.jsonb_build_object(
        'operation_receipt_id',
        '00000000-0000-4000-8000-00000000fb02',
        'resource_manifest_hash',
        (
          select manifest.payload_hash
          from platform.resource_manifests as manifest
          where manifest.manifest_id =
            '00000000-0000-4000-8000-00000000fb01'::uuid
        )
      )
    )
  $assert$,
  'DA_EXTERNAL_EXPORT_VERIFIER_UNAVAILABLE'
);
select platform.transition_app_lifecycle(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'test',
  'EXPORT_PENDING',
  'FROZEN',
  'EXPORT_CANCELLED',
  '00000000-0000-4000-8000-00000000f003'::uuid,
  platform.compute_lifecycle_receipt_hash(
    '00000000-0000-4000-8000-00000000f003'::uuid,
    '00000000-0000-4000-8000-00000000da01'::uuid,
    'test',
    'EXPORT_PENDING',
    'FROZEN',
    'EXPORT_CANCELLED',
    '{"reason":"external-verifier-unavailable"}'::jsonb
  ),
  '{"reason":"external-verifier-unavailable"}'::jsonb
);
select platform.transition_app_lifecycle(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'test',
  'FROZEN',
  'DELETE_PENDING',
  'DELETE_REQUESTED',
  '00000000-0000-4000-8000-00000000f004'::uuid,
  platform.compute_lifecycle_receipt_hash(
    '00000000-0000-4000-8000-00000000f004'::uuid,
    '00000000-0000-4000-8000-00000000da01'::uuid,
    'test',
    'FROZEN',
    'DELETE_PENDING',
    'DELETE_REQUESTED',
    '{"reason":"smoke-delete"}'::jsonb
  ),
  '{"reason":"smoke-delete"}'::jsonb
);

set role data_agent_job_authority;
select test_support.assert_true(
  (
    platform.cleanup_scope_authority(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      'test',
      'DELETE'
    ) ->> 'action'
  ) = 'DELETE',
  'DELETE cleanup capability 只能在 DELETE_PENDING 签发'
);
select platform.record_resource_manifest(
  '00000000-0000-4000-8000-00000000fb03'::uuid,
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'test',
  'DELETE_PENDING',
  5,
  7,
  2,
  1,
  '{"database":["app_data_agent"],"storage":["data-agent-artifacts"],"redis":["data-agent:test"]}'::jsonb,
  platform.compute_resource_manifest_hash(
    '00000000-0000-4000-8000-00000000fb03'::uuid,
    '00000000-0000-4000-8000-00000000da01'::uuid,
    'test',
    'DELETE_PENDING',
    5,
    7,
    2,
    1,
    '{"database":["app_data_agent"],"storage":["data-agent-artifacts"],"redis":["data-agent:test"]}'::jsonb
  ),
  '00000000-0000-4000-8000-00000000fa01'::uuid,
  'smoke-job-key-v1',
  'ed25519:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
);
select platform.record_resource_operation_receipt(
  '00000000-0000-4000-8000-00000000fb04'::uuid,
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'test',
  5,
  'DELETE',
  'DELETE_PENDING',
  'DELETED',
  '00000000-0000-4000-8000-00000000fb03'::uuid,
  '00000000-0000-4000-8000-00000000fb02'::uuid,
  7,
  2,
  1,
  0,
  1,
  0,
  platform.compute_resource_operation_hash(
    '00000000-0000-4000-8000-00000000fb04'::uuid,
    '00000000-0000-4000-8000-00000000da01'::uuid,
    'test',
    5,
    'DELETE',
    'DELETE_PENDING',
    'DELETED',
    '00000000-0000-4000-8000-00000000fb03'::uuid,
    '00000000-0000-4000-8000-00000000fb02'::uuid,
    7,
    2,
    1,
    0,
    1,
    0
  ),
  '00000000-0000-4000-8000-00000000fa01'::uuid,
  'smoke-job-key-v1',
  'ed25519:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
);
select platform.record_resource_operation_receipt(
  '00000000-0000-4000-8000-00000000fb05'::uuid,
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'test',
  5,
  'DELETE',
  'DELETE_PENDING',
  'DELETED',
  '00000000-0000-4000-8000-00000000fb03'::uuid,
  '00000000-0000-4000-8000-00000000fb02'::uuid,
  7,
  2,
  1,
  0,
  0,
  0,
  platform.compute_resource_operation_hash(
    '00000000-0000-4000-8000-00000000fb05'::uuid,
    '00000000-0000-4000-8000-00000000da01'::uuid,
    'test',
    5,
    'DELETE',
    'DELETE_PENDING',
    'DELETED',
    '00000000-0000-4000-8000-00000000fb03'::uuid,
    '00000000-0000-4000-8000-00000000fb02'::uuid,
    7,
    2,
    1,
    0,
    0,
    0
  ),
  '00000000-0000-4000-8000-00000000fa01'::uuid,
  'smoke-job-key-v1',
  'ed25519:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
);
reset role;

select test_support.assert_raises(
  $assert$
    select platform.transition_app_lifecycle(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      'test',
      'DELETE_PENDING',
      'DELETED',
      'DELETE_CONFIRMED',
      '00000000-0000-4000-8000-00000000f005'::uuid,
      platform.compute_lifecycle_receipt_hash(
        '00000000-0000-4000-8000-00000000f005'::uuid,
        '00000000-0000-4000-8000-00000000da01'::uuid,
        'test',
        'DELETE_PENDING',
        'DELETED',
        'DELETE_CONFIRMED',
        '{"operation_receipt_id":"00000000-0000-4000-8000-00000000ffff","upstream_export_receipt_id":"00000000-0000-4000-8000-00000000fb02"}'::jsonb
      ),
      '{"operation_receipt_id":"00000000-0000-4000-8000-00000000ffff","upstream_export_receipt_id":"00000000-0000-4000-8000-00000000fb02"}'::jsonb
    )
  $assert$,
  'DA_DELETE_OPERATION_RECEIPT_INVALID'
);
select test_support.assert_raises(
  $assert$
    select platform.transition_app_lifecycle(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      'test',
      'DELETE_PENDING',
      'DELETED',
      'DELETE_CONFIRMED',
      '00000000-0000-4000-8000-00000000f005'::uuid,
      platform.compute_lifecycle_receipt_hash(
        '00000000-0000-4000-8000-00000000f005'::uuid,
        '00000000-0000-4000-8000-00000000da01'::uuid,
        'test',
        'DELETE_PENDING',
        'DELETED',
        'DELETE_CONFIRMED',
        '{"operation_receipt_id":"00000000-0000-4000-8000-00000000fb04","upstream_export_receipt_id":"00000000-0000-4000-8000-00000000fb02"}'::jsonb
      ),
      '{"operation_receipt_id":"00000000-0000-4000-8000-00000000fb04","upstream_export_receipt_id":"00000000-0000-4000-8000-00000000fb02"}'::jsonb
    )
  $assert$,
  'DA_DELETE_OPERATION_RECEIPT_INVALID'
);
select test_support.assert_raises(
  $assert$
    select platform.transition_app_lifecycle(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      'test',
      'DELETE_PENDING',
      'DELETED',
      'DELETE_CONFIRMED',
      '00000000-0000-4000-8000-00000000f005'::uuid,
      platform.compute_lifecycle_receipt_hash(
        '00000000-0000-4000-8000-00000000f005'::uuid,
        '00000000-0000-4000-8000-00000000da01'::uuid,
        'test',
        'DELETE_PENDING',
        'DELETED',
        'DELETE_CONFIRMED',
        '{"operation_receipt_id":"00000000-0000-4000-8000-00000000fb05","upstream_export_receipt_id":"00000000-0000-4000-8000-00000000fb02"}'::jsonb
      ),
      '{"operation_receipt_id":"00000000-0000-4000-8000-00000000fb05","upstream_export_receipt_id":"00000000-0000-4000-8000-00000000fb02"}'::jsonb
    )
  $assert$,
  'DA_EXTERNAL_DELETE_VERIFIER_UNAVAILABLE'
);

select test_support.assert_true(
  exists (
    select 1
    from app_data_agent.runs
    where run_id = '00000000-0000-4000-8000-00000000a101'::uuid
  ),
  '没有真实零残留 receipt 时不得删除业务数据'
);
select test_support.assert_true(
  (
    select lifecycle.lifecycle_state = 'DELETE_PENDING'
      and lifecycle.authority_epoch = 5
    from platform.app_environment_lifecycle as lifecycle
    where lifecycle.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and lifecycle.environment = 'test'
  ),
  '伪造或非零 residual receipt 必须保持 DELETE_PENDING/HOLD'
);
select test_support.assert_true(
  (
    select lifecycle.lifecycle_state = 'ACTIVE'
      and lifecycle.authority_epoch = 1
    from platform.app_environment_lifecycle as lifecycle
    where lifecycle.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and lifecycle.environment = 'prod'
  ),
  'test 环境的冻结与删除流程不得污染同一 App 的 prod 权威'
);
select test_support.assert_true(
  (
    select pg_catalog.count(*) = 2
    from app_fixture_other.records
  ),
  'Data Agent 生命周期操作不得影响第二应用'
);
select test_support.assert_true(
  (
    select lifecycle.lifecycle_state = 'ACTIVE'
    from platform.app_environment_lifecycle as lifecycle
    where lifecycle.app_id = '00000000-0000-4000-8000-00000000bb01'::uuid
      and lifecycle.environment = 'test'
  ),
  '第二应用生命周期必须保持独立'
);

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000001001"}',
  false
);
select test_support.assert_true(
  (
    api.data_agent__get_run(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000a101'::uuid
    ) ->> 'run_id'
  ) = '00000000-0000-4000-8000-00000000a101',
  'DELETE_PENDING/HOLD 保留受权只读恢复能力'
);
reset role;

select test_support.assert_raises(
  $assert$
    update platform.boundary_audit_receipts
    set details = '{"tampered":true}'::jsonb
    where receipt_id = '00000000-0000-4000-8000-00000000f001'::uuid
  $assert$,
  'DA_IMMUTABLE_RECORD'
);
select test_support.assert_raises(
  $assert$
    update platform.resource_operation_receipts
    set storage_residual_count = 0
    where operation_receipt_id =
      '00000000-0000-4000-8000-00000000fb04'::uuid
  $assert$,
  'DA_IMMUTABLE_RECORD'
);

select test_support.assert_true(
  (
    select lifecycle.lifecycle_state = 'DELETE_PENDING'
      and lifecycle.authority_epoch = 5
    from platform.app_environment_lifecycle as lifecycle
    where lifecycle.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and lifecycle.environment = 'test'
  ),
  '缺少外部删除或恢复 verifier 时必须保持 DELETE_PENDING/HOLD'
);

select test_support.assert_true(
  (
    select pg_catalog.count(*) = 4
    from platform.boundary_audit_receipts as receipt
    where receipt.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and receipt.environment = 'test'
  ),
  '失败的 DELETE_CONFIRMED 不得生成 receipt，成功边界按 environment 留存'
);

select test_support.assert_true(
  platform.revoke_membership(
    '00000000-0000-4000-8000-00000000de01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    '00000000-0000-4000-8000-000000001001'::uuid
  ),
  '撤销 membership 必须命中当前有效授权'
);
set role data_agent_backend;
select test_support.assert_raises(
  $assert$
    select *
    from platform.resolve_backend_authority(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-000000001001'::uuid,
      false
    )
  $assert$,
  'DA_SCOPE_FORBIDDEN'
);
reset role;

select (platform.provision_membership(
  '00000000-0000-4000-8000-00000000de01'::uuid,
  '00000000-0000-4000-8000-00000000aa11'::uuid,
  '00000000-0000-4000-8000-000000001001'::uuid,
  'owner'
)).principal_id;

set role data_agent_backend;
select test_support.assert_raises(
  $assert$
    select *
    from platform.revalidate_backend_authority(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      'test',
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-000000001001'::uuid,
      'owner',
      1,
      1,
      false
    )
  $assert$,
  'DA_AUTHORITY_STALE_OR_FORBIDDEN'
);
select test_support.assert_true(
  (
    select authority.membership_version > 1
      and authority.app_epoch = 5
      and authority.lifecycle_state = 'DELETE_PENDING'
      and not authority.can_write
    from platform.resolve_backend_authority(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-000000001001'::uuid,
      false
    ) as authority
  ),
  '重新授权后取得新 membership_version，但 DELETE_PENDING 仍禁止写入'
);
reset role;

update platform.deployment_mappings
set is_active = false,
    revoked_at = pg_catalog.clock_timestamp()
where deployment_id = '00000000-0000-4000-8000-00000000de01'::uuid;
select test_support.assert_raises(
  $assert$
    update platform.deployment_mappings
    set is_active = true,
        revoked_at = null
    where deployment_id = '00000000-0000-4000-8000-00000000de01'::uuid
  $assert$,
  'DA_DEPLOYMENT_REACTIVATION_FORBIDDEN'
);
set role data_agent_backend;
select test_support.assert_raises(
  $assert$
    select *
    from platform.resolve_backend_authority(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-000000001001'::uuid,
      false
    )
  $assert$,
  'DA_SCOPE_FORBIDDEN'
);
reset role;
