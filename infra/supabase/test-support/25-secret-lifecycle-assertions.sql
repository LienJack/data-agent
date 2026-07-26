\set ON_ERROR_STOP on

select test_support.assert_true(
  not pg_catalog.has_table_privilege(
    'data_agent_backend',
    'app_data_agent.secret_refs',
    'UPDATE'
  ),
  'SecretRef metadata 只能通过 CAS 函数更新'
);
select test_support.assert_true(
  not pg_catalog.has_table_privilege(
    'data_agent_secret_authority',
    'app_data_agent.secret_refs',
    'INSERT'
  ),
  'SecretStore authority 只能写 effect receipt，不能改 SecretRef'
);
select test_support.assert_true(
  not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = 'app_data_agent.secret_refs'::pg_catalog.regclass
      and not attribute.attisdropped
      and attribute.attname in (
        'plaintext',
        'secret_value',
        'provider_ref',
        'provider_secret'
      )
  ),
  'SecretRef authority table 不得包含 plaintext/provider ref 列'
);

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

select test_support.assert_raises(
  $assert$
    select app_data_agent.register_secret_ref(
      '00000000-0000-0000-0000-000000000000'::uuid,
      'nil-secret-ref-must-fail',
      'sha256:9999999999999999999999999999999999999999999999999999999999999999'
    )
  $assert$,
  'DA_SECRET_REF_ID_INVALID'
);
select app_data_agent.register_secret_ref(
  '00000000-0000-4000-8000-00000000ec01'::uuid,
  'warehouse-primary',
  'sha256:1111111111111111111111111111111111111111111111111111111111111111'
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.finalize_secret_provider_effect(
      '00000000-0000-4000-8000-00000000ec01'::uuid,
      1,
      '00000000-0000-4000-8000-00000000ec03'::uuid
    )
  $assert$,
  'DA_SECRET_PROVIDER_RECEIPT_NOT_FOUND'
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.request_secret_provider_effect(
      '00000000-0000-4000-8000-00000000ec01'::uuid,
      null,
      '00000000-0000-4000-8000-00000000ec02'::uuid,
      'ROTATE'
    )
  $assert$,
  'DA_SECRET_VERSION_STALE'
);
select test_support.assert_true(
  (
    select secret_ref.status = 'ACTIVE'
      and secret_ref.version = 1
      and secret_ref.pending_request_id is null
    from app_data_agent.secret_refs as secret_ref
    where secret_ref.secret_ref_id =
      '00000000-0000-4000-8000-00000000ec01'::uuid
  ),
  'NULL expected_version 不得绕过 SecretRef CAS 或产生 pending 状态'
);
select app_data_agent.request_secret_provider_effect(
  '00000000-0000-4000-8000-00000000ec01'::uuid,
  1,
  '00000000-0000-4000-8000-00000000ec02'::uuid,
  'ROTATE'
);
select app_data_agent.register_secret_ref(
  '00000000-0000-4000-8000-00000000ec11'::uuid,
  'warehouse-revoke-fixture',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222'
);
select app_data_agent.request_secret_provider_effect(
  '00000000-0000-4000-8000-00000000ec11'::uuid,
  1,
  '00000000-0000-4000-8000-00000000ec12'::uuid,
  'REVOKE'
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.finalize_secret_provider_effect(
      '00000000-0000-4000-8000-00000000ec11'::uuid,
      1,
      '00000000-0000-4000-8000-00000000ec13'::uuid
    )
  $assert$,
  'DA_SECRET_PROVIDER_RECEIPT_NOT_FOUND'
);
commit;

set role data_agent_secret_authority;
select test_support.assert_raises(
  $assert$
    select app_data_agent.record_secret_provider_effect(
      '00000000-0000-4000-8000-00000000ec03'::uuid,
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      'test',
      '00000000-0000-4000-8000-00000000ec01'::uuid,
      '00000000-0000-4000-8000-00000000ec02'::uuid,
      'ROTATE',
      1,
      'FAILED',
      null,
      'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      'smoke-secret-key-v1',
      'ed25519:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
  $assert$,
  'DA_SECRET_PROVIDER_RECEIPT_HASH_INVALID'
);
select app_data_agent.record_secret_provider_effect(
  '00000000-0000-4000-8000-00000000ec03'::uuid,
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa11'::uuid,
  'test',
  '00000000-0000-4000-8000-00000000ec01'::uuid,
  '00000000-0000-4000-8000-00000000ec02'::uuid,
  'ROTATE',
  1,
  'FAILED',
  null,
  app_data_agent.compute_secret_provider_receipt_hash(
    '00000000-0000-4000-8000-00000000ec03'::uuid,
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    'test',
    '00000000-0000-4000-8000-00000000ec01'::uuid,
    '00000000-0000-4000-8000-00000000ec02'::uuid,
    'ROTATE',
    1,
    'FAILED',
    null
  ),
  'smoke-secret-key-v1',
  'ed25519:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.record_secret_provider_effect(
      '00000000-0000-4000-8000-00000000ec13'::uuid,
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      'test',
      '00000000-0000-4000-8000-00000000ec11'::uuid,
      '00000000-0000-4000-8000-00000000ec12'::uuid,
      'REVOKE',
      1,
      'SUCCEEDED',
      null,
      app_data_agent.compute_secret_provider_receipt_hash(
        '00000000-0000-4000-8000-00000000ec13'::uuid,
        '00000000-0000-4000-8000-00000000da01'::uuid,
        '00000000-0000-4000-8000-00000000aa11'::uuid,
        'test',
        '00000000-0000-4000-8000-00000000ec11'::uuid,
        '00000000-0000-4000-8000-00000000ec12'::uuid,
        'REVOKE',
        1,
        'SUCCEEDED',
        null
      ),
      'smoke-secret-key-v1',
      'ed25519:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )
  $assert$,
  'DA_EXTERNAL_SECRET_VERIFIER_UNAVAILABLE'
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
  '00000000-0000-4000-8000-000000001001',
  true
);
select pg_catalog.set_config('data_agent.role', 'owner', true);
select pg_catalog.set_config(
  'data_agent.deployment_id',
  '00000000-0000-4000-8000-00000000de01',
  true
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.finalize_secret_provider_effect(
      '00000000-0000-4000-8000-00000000ec01'::uuid,
      1,
      '00000000-0000-4000-8000-00000000ec03'::uuid
    )
  $assert$,
  'DA_SECRET_PROVIDER_EFFECT_FAILED'
);
select test_support.assert_true(
  (
    select secret_ref.version = 1
      and secret_ref.status = 'ROTATION_PENDING'
      and secret_ref.provider_ref_hash =
        'sha256:1111111111111111111111111111111111111111111111111111111111111111'
    from app_data_agent.secret_refs as secret_ref
    where secret_ref.secret_ref_id =
      '00000000-0000-4000-8000-00000000ec01'::uuid
  ),
  'provider FAILED receipt 不得推进 SecretRef version/hash/status'
);
select app_data_agent.acknowledge_failed_secret_provider_effect(
  '00000000-0000-4000-8000-00000000ec01'::uuid,
  1,
  '00000000-0000-4000-8000-00000000ec03'::uuid
);
select test_support.assert_true(
  (
    select secret_ref.version = 1
      and secret_ref.status = 'ACTIVE'
      and secret_ref.pending_request_id is null
      and secret_ref.provider_ref_hash =
        'sha256:1111111111111111111111111111111111111111111111111111111111111111'
    from app_data_agent.secret_refs as secret_ref
    where secret_ref.secret_ref_id =
      '00000000-0000-4000-8000-00000000ec01'::uuid
  ),
  '只有精确 FAILED provider receipt 可清除 pending，且不得推进 version/hash'
);
select test_support.assert_true(
  (
    select secret_ref.version = 1
      and secret_ref.status = 'REVOCATION_PENDING'
      and secret_ref.revoked_at is null
    from app_data_agent.secret_refs as secret_ref
    where secret_ref.secret_ref_id =
      '00000000-0000-4000-8000-00000000ec11'::uuid
  ),
  '没有 revoke provider receipt 时必须停在 REVOCATION_PENDING'
);
commit;
