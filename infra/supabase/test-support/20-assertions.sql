\set ON_ERROR_STOP on

grant usage on schema test_support to data_agent_backend;
grant execute on all functions in schema test_support to data_agent_backend;
grant usage on schema test_support to data_agent_job_authority, data_agent_secret_authority;
grant execute on all functions in schema test_support
to data_agent_job_authority, data_agent_secret_authority;

select test_support.assert_true(
  (
    select pg_catalog.count(*) = 2
    from platform.apps
  ),
  '共享 Supabase 必须登记两个相互隔离的应用'
);

select test_support.assert_true(
  (
    select
      pg_catalog.count(distinct registry.private_schema_name) = 2
      and pg_catalog.count(distinct registry.api_prefix) = 2
    from platform.schema_registry as registry
  ),
  '每个应用必须拥有唯一 private schema 与 API prefix'
);

select test_support.assert_true(
  (
    select pg_catalog.count(*) = 2
    from app_data_agent.memberships as membership
    where membership.membership_role = 'owner'
      and membership.environment = 'test'
  ),
  'Data Agent fixture 必须覆盖两个租户'
);

select test_support.assert_true(
  (
    select pg_catalog.count(distinct membership.tenant_id) = 2
    from app_fixture_other.memberships as membership
  ),
  '第二应用 fixture 必须覆盖两个租户'
);

select test_support.assert_true(
  (
    select constraint_row.condeferrable and constraint_row.condeferred
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid =
      'app_data_agent.idempotency_records'::pg_catalog.regclass
      and constraint_row.contype = 'f'
  ),
  '幂等记录到命令的 FK 必须 DEFERRABLE INITIALLY DEFERRED'
);

select test_support.assert_true(
  pg_catalog.to_regclass('app_data_agent.outbox_dispatch_ready') is not null,
  'outbox 必须有 status + available_at dispatch index'
);

select test_support.assert_true(
  (
    select pg_catalog.count(*) = 5
    from platform.migration_ledger
  ),
  'platform 与四个 app migration 必须分别记账'
);

select test_support.assert_raises(
  $assert$
    select platform.assert_migration_checksum(
      'app',
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '20260725010100_app_data_agent_core',
      'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    )
  $assert$,
  'DA_MIGRATION_CHECKSUM_MISMATCH'
);

select test_support.assert_raises(
  $assert$
    select platform.register_api_operation(
      '00000000-0000-4000-8000-00000000bb01'::uuid,
      'get_run',
      'data_agent__get_run'
    )
  $assert$,
  'DA_API_OPERATION_PREFIX_INVALID'
);

select test_support.assert_true(
  not pg_catalog.has_schema_privilege('authenticated', 'app_data_agent', 'USAGE'),
  'authenticated 不得直接进入 private schema'
);

select test_support.assert_true(
  not pg_catalog.has_table_privilege(
    'data_agent_platform_owner',
    'platform.apps',
    'UPDATE'
  ),
  'platform owner 也必须通过 lifecycle RPC 写状态并生成 receipt'
);

select test_support.assert_true(
  not pg_catalog.has_table_privilege(
    'authenticated',
    'app_data_agent.runs',
    'SELECT'
  ),
  'authenticated 不得直接读取 private table'
);

select test_support.assert_true(
  app_data_agent.contains_potential_plaintext_secret(
    '{"nested":[{"password":"plaintext"}]}'::jsonb
  ),
  '数据库边界必须递归识别嵌套明文 Credential'
);
select test_support.assert_true(
  not app_data_agent.contains_potential_plaintext_secret(
    '{"credential_ref":"secretref:00000000-0000-4000-8000-00000000ec01"}'::jsonb
  ),
  '数据库边界必须允许规范 SecretRef，而不是拒绝所有 Secret 元数据'
);
select test_support.assert_true(
  app_data_agent.contains_potential_plaintext_secret(
    '{"credential_ref":"secretref:hunter2"}'::jsonb
  ),
  'SecretRef 字段不能用任意字符串绕过明文 Credential 检测'
);
select test_support.assert_true(
  app_data_agent.contains_potential_plaintext_secret(
    '{"credential_ref":"secretref:00000000-0000-0000-0000-000000000000"}'::jsonb
  ),
  'SecretRef 必须满足 UUID version/variant，而不只是 36 字符外形'
);
select test_support.assert_true(
  app_data_agent.contains_potential_plaintext_secret(
    '{"datasource":"mysql://reader:hunter2@db.example.com/warehouse"}'::jsonb
  ),
  '通用 URI userinfo 中的数据库密码必须被识别'
);
select test_support.assert_true(
  app_data_agent.contains_potential_plaintext_secret(
    '{"endpoint":"redis://:hunter2@cache.example.com:6379"}'::jsonb
  ),
  '空用户名 URI userinfo 也不能绕过 Credential 检测'
);
select test_support.assert_true(
  app_data_agent.contains_potential_plaintext_secret(
    '{"value":"ghp_abcdefghijklmnopqrstuvwxyz123456"}'::jsonb
  ),
  '常见 GitHub PAT 形态必须被识别'
);
select test_support.assert_true(
  app_data_agent.contains_potential_plaintext_secret(
    '{"accessKeyId":"AKIAABCDEFGHIJKLMNOP","secretAccessKey":"plaintext"}'::jsonb
  ),
  'camelCase 云凭据别名必须被识别'
);
select test_support.assert_true(
  app_data_agent.contains_potential_plaintext_secret(
    '{"datasource":"jdbc:postgresql://reader:hunter2@db.example.com/warehouse"}'::jsonb
  ),
  'JDBC 多段 scheme URI 中的数据库密码必须被识别'
);
select test_support.assert_true(
  not app_data_agent.contains_potential_plaintext_secret(
    '{"secret_refs":["secretref:00000000-0000-4000-8000-00000000ec01"],"snapshot_token":null,"fencing_token":"fence-42"}'::jsonb
  ),
  '规范 SecretRef 数组与非凭据 snapshot/fencing token 必须可通过'
);
select test_support.assert_true(
  app_data_agent.contains_potential_plaintext_secret(
    '{"secret_refs":[]}'::jsonb
  ),
  '空 SecretRef 数组必须 fail closed'
);
select test_support.assert_true(
  app_data_agent.contains_potential_plaintext_secret(
    '{"snapshot_token":"sk-abcdefghijklmnop"}'::jsonb
  ),
  'snapshot_token 仍必须拒绝明显 Credential 值'
);
select test_support.assert_true(
  app_data_agent.command_payload_is_valid(
    '{"kind":"START_L2_RESEARCH","mode":"L2","question_version":"v1:bench/case-01","dataset_id":"insightbench/synthetic-01","secret_refs":["secretref:00000000-0000-4000-8000-00000000ec01"]}'::jsonb
  ),
  'SQL typed command payload 必须与 TypeScript authoritative schema 对齐'
);
select test_support.assert_true(
  not app_data_agent.command_payload_is_valid(
    '{"kind":"START_L2_RESEARCH","notes":"unexpected"}'::jsonb
  ),
  'typed command payload 必须拒绝未知字段'
);
select test_support.assert_true(
  not app_data_agent.is_public_egress_address('169.254.169.254/0'::inet)
    and not app_data_agent.is_public_egress_address('fd00::1/0'::inet),
  'egress 地址必须是单主机且不能用宽掩码伪装公网地址'
);

select test_support.assert_true(
  pg_catalog.has_column_privilege(
    'data_agent_backend',
    'app_data_agent.commands',
    'status',
    'UPDATE'
  )
  and not pg_catalog.has_column_privilege(
    'data_agent_backend',
    'app_data_agent.commands',
    'payload_json',
    'UPDATE'
  ),
  '后台只能推进 Command status，不能改写命令身份或 payload'
);
select test_support.assert_true(
  pg_catalog.has_column_privilege(
    'data_agent_backend',
    'app_data_agent.runs',
    'active_fence',
    'UPDATE'
  )
  and not pg_catalog.has_column_privilege(
    'data_agent_backend',
    'app_data_agent.runs',
    'question',
    'UPDATE'
  ),
  'Run 只保留 SELECT FOR UPDATE 所需的窄列权限，实际 mutation 由 guard 拒绝'
);

select test_support.assert_true(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'api.data_agent__create_run(uuid,uuid,uuid,text)',
    'EXECUTE'
  ),
  'create_run 不能作为首版客户端入口'
);

select test_support.assert_true(
  pg_catalog.has_function_privilege(
    'authenticated',
    'api.data_agent__accept_run_command(uuid,uuid,uuid,uuid,text,text,jsonb,text)',
    'EXECUTE'
  ),
  'authenticated 只能通过原子 accept_run_command 首次提交'
);

select test_support.assert_true(
  not pg_catalog.has_function_privilege(
    'public',
    'api.data_agent__accept_run_command(uuid,uuid,uuid,uuid,text,text,jsonb,text)',
    'EXECUTE'
  ),
  'PUBLIC 不得执行写 RPC'
);

select test_support.assert_true(
  (
    select pg_catalog.bool_and(
      operation.exposed_name like registry.api_prefix || '%'
    )
    from platform.api_operation_registry as operation
    join platform.schema_registry as registry
      on registry.app_id = operation.app_id
  ),
  '所有公开 API 名称必须服从应用前缀'
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

select test_support.assert_true(
  (
    select authority.membership_version = 1
      and authority.app_epoch = 1
      and authority.membership_role = 'owner'
      and authority.can_write
    from platform.current_backend_authority(true) as authority
  ),
  'current authority 必须返回数据库当前 membership_version 与 app_epoch'
);
select test_support.assert_true(
  (
    select authority.app_id =
      '00000000-0000-4000-8000-00000000da01'::uuid
      and authority.environment = 'test'
    from platform.resolve_backend_authority(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-000000001001'::uuid,
      true
    ) as authority
  ),
  'resolve authority 必须由 deployment + tenant + verified principal 解析'
);
select test_support.assert_true(
  (
    select pg_catalog.count(*) = 1
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
  ),
  'revalidate authority 必须接受精确当前版本'
);
select test_support.assert_raises(
  $assert$
    select * from platform.current_backend_authority(null)
  $assert$,
  'DA_AUTHORITY_MODE_INVALID'
);
select test_support.assert_raises(
  $assert$
    select *
    from platform.revalidate_backend_authority(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      'prod',
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

select test_support.assert_true(
  (
    select pg_catalog.count(*) = 1
    from app_data_agent.runs
  ),
  '后台正确上下文只能看到本租户 Run'
);

select pg_catalog.set_config(
  'data_agent.tenant_id',
  '00000000-0000-4000-8000-00000000aa22',
  true
);
select test_support.assert_true(
  (
    select pg_catalog.count(*) = 0
    from app_data_agent.runs
  ),
  '伪造 tenant GUC 但没有 membership 时必须 fail closed'
);

select pg_catalog.set_config(
  'data_agent.tenant_id',
  '00000000-0000-4000-8000-00000000aa11',
  true
);
select pg_catalog.set_config(
  'data_agent.principal_id',
  '00000000-0000-4000-8000-000000001002',
  true
);
select pg_catalog.set_config('data_agent.role', 'owner', true);
select test_support.assert_true(
  (
    select pg_catalog.count(*) = 0
    from app_data_agent.runs
  ),
  '伪造 role GUC 必须与私有 membership 不匹配并拒绝'
);

select pg_catalog.set_config('data_agent.role', 'viewer', true);
select test_support.assert_true(
  (
    select pg_catalog.count(*) = 0
    from app_data_agent.runs
  ),
  'viewer 只能读取归属自己的对象，不能读取同租户他人 Run'
);
select test_support.assert_raises(
  $assert$
    insert into app_data_agent.runs (
      app_id,
      tenant_id,
      environment,
      run_id,
      principal_id,
      question
    )
    values (
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      'test',
      '00000000-0000-4000-8000-00000000a109'::uuid,
      '00000000-0000-4000-8000-000000001002'::uuid,
      'viewer must not write'
    )
  $assert$,
  'row-level security'
);
rollback;

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000001001","app_id":"00000000-0000-4000-8000-00000000bb01","tenant_id":"00000000-0000-4000-8000-00000000aa22","role":"admin"}',
  false
);

select api.data_agent__accept_run_command(
  '00000000-0000-4000-8000-00000000de01'::uuid,
  '00000000-0000-4000-8000-00000000aa11'::uuid,
  '00000000-0000-4000-8000-00000000a201'::uuid,
  '00000000-0000-4000-8000-00000000c201'::uuid,
  'accept-first-run',
  'first atomic question',
  '{"kind":"start"}'::jsonb,
  'sha256:a2a5648f53b40c87f31893886a2312b94b1f73c6625406d3152e507ebf854567'
);

select test_support.assert_true(
  (
    api.data_agent__accept_run_command(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000a201'::uuid,
      '00000000-0000-4000-8000-00000000c201'::uuid,
      'accept-first-run',
      'first atomic question',
      '{"kind":"start"}'::jsonb,
      'sha256:a2a5648f53b40c87f31893886a2312b94b1f73c6625406d3152e507ebf854567'
    ) ->> 'replayed'
  )::boolean,
  '同 payload 重放必须返回已有原子命令'
);

select test_support.assert_raises(
  $assert$
    select api.data_agent__accept_run_command(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000a207'::uuid,
      '00000000-0000-4000-8000-00000000c207'::uuid,
      'reject-plaintext-secret',
      'this run must not persist',
      '{"nested":[{"password":"plaintext"}]}'::jsonb,
      'sha256:b21d988f027e02085f88dc361fdb7ce86a6a0e477b99a00c4b0ab84e940289aa'
    )
  $assert$,
  'DA_COMMAND_PAYLOAD_INVALID'
);
select test_support.assert_raises(
  $assert$
    select api.data_agent__accept_run_command(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000a209'::uuid,
      '00000000-0000-4000-8000-00000000c209'::uuid,
      'reject-question-secret',
      'jdbc:postgresql://admin:hunter2@db.example.com/warehouse',
      '{"kind":"START_L2_RESEARCH"}'::jsonb,
      'sha256:9b70cc1f348a75528cb84012b2f8b1946594461c0df5f95682e4ea0b5e88dd86'
    )
  $assert$,
  'DA_COMMAND_PAYLOAD_INVALID'
);
select test_support.assert_raises(
  $assert$
    select api.data_agent__accept_run_command(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000a20a'::uuid,
      '00000000-0000-4000-8000-00000000c20a'::uuid,
      'reject-unknown-payload-field',
      'unknown payload field must not persist',
      '{"kind":"START_L2_RESEARCH","notes":"unexpected"}'::jsonb,
      'sha256:3d6fe75ac7517553c9f30f1c25fb32b1d23146daf1dd232a88bb2ad17285d282'
    )
  $assert$,
  'DA_COMMAND_PAYLOAD_INVALID'
);
reset role;
select test_support.assert_true(
  not exists (
    select 1
    from app_data_agent.runs as run
    where run.run_id = '00000000-0000-4000-8000-00000000a207'::uuid
  ),
  '疑似明文 Credential 被拒绝后不得留下 Run'
);
select test_support.assert_true(
  not exists (
    select 1
    from app_data_agent.runs as run
    where run.run_id in (
      '00000000-0000-4000-8000-00000000a209'::uuid,
      '00000000-0000-4000-8000-00000000a20a'::uuid
    )
  ),
  'Question Credential 或未知 payload 字段被拒后不得留下 Run'
);
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000001001","app_id":"00000000-0000-4000-8000-00000000bb01","tenant_id":"00000000-0000-4000-8000-00000000aa22","role":"admin"}',
  false
);

select test_support.assert_raises(
  $assert$
    select api.data_agent__accept_run_command(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000a201'::uuid,
      '00000000-0000-4000-8000-00000000c201'::uuid,
      'accept-first-run',
      'first atomic question',
      '{"kind":"different"}'::jsonb,
      'sha256:aa64df940dffc9f37b8e190c026cad047bf056853ef98c04afb64146f8b4c87e'
    )
  $assert$,
  'DA_IDEMPOTENCY_CONFLICT'
);

select test_support.assert_raises(
  $assert$
    select api.data_agent__accept_run_command(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000a201'::uuid,
      '00000000-0000-4000-8000-00000000c201'::uuid,
      'accept-first-run',
      'first atomic question',
      '{"kind":"same-hash-but-different-payload"}'::jsonb,
      'sha256:a2a5648f53b40c87f31893886a2312b94b1f73c6625406d3152e507ebf854567'
    )
  $assert$,
  'DA_COMMAND_PAYLOAD_INVALID'
);

select test_support.assert_raises(
  $assert$
    select api.data_agent__accept_run_command(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000a203'::uuid,
      '00000000-0000-4000-8000-00000000c201'::uuid,
      'must-rollback-after-run-insert',
      'this run must roll back',
      '{"kind":"forced-command-conflict"}'::jsonb,
      'sha256:f0c80efdcae6450d7ab5694f5f23443b9ff602c9616c01af142206443b0f33cc'
    )
  $assert$,
  'duplicate key'
);

select test_support.assert_true(
  (
    api.data_agent__get_run(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000a201'::uuid
    ) ->> 'question'
  ) = 'first atomic question',
  '同租户读 RPC 必须返回原子创建的 Run'
);

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000001002","role":"owner"}',
  false
);
select test_support.assert_raises(
  $assert$
    select api.data_agent__accept_run_command(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000a204'::uuid,
      '00000000-0000-4000-8000-00000000c204'::uuid,
      'viewer-cannot-write',
      'viewer cannot write',
      '{"kind":"forbidden"}'::jsonb,
      'sha256:079e585afb28ee877afcbdfbbe48dad8ee717bd81552af994ff45f86b9242a4a'
    )
  $assert$,
  'DA_WRITE_FORBIDDEN'
);
select test_support.assert_raises(
  $assert$
    select api.data_agent__get_run(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000a101'::uuid
    )
  $assert$,
  'DA_OBJECT_FORBIDDEN'
);

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000001006"}',
  false
);
select test_support.assert_true(
  (
    select
      not (accepted.result ->> 'replayed')::boolean
      and accepted.result -> 'run' ->> 'principal_id'
        = '00000000-0000-4000-8000-000000001006'
    from (
      select api.data_agent__accept_run_command(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000a208'::uuid,
      '00000000-0000-4000-8000-00000000c208'::uuid,
      'accept-first-run',
      'analyst independent idempotency namespace',
      '{"kind":"start"}'::jsonb,
      'sha256:a2a5648f53b40c87f31893886a2312b94b1f73c6625406d3152e507ebf854567'
      ) as result
    ) as accepted
  ),
  '同 Tenant 不同 requester 可以复用幂等键且不得碰撞'
);
select test_support.assert_raises(
  $assert$
    select api.data_agent__submit_command(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000c206'::uuid,
      '00000000-0000-4000-8000-00000000a101'::uuid,
      'analyst-other-principal-run',
      '{"kind":"inject"}'::jsonb,
      'sha256:f3aa5ad28d5ee437f0ce40b15b0fea1be2bee3cdbbe77aa61c200b9db2a55538'
    )
  $assert$,
  'DA_OBJECT_FORBIDDEN'
);

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000001001","tenant_id":"00000000-0000-4000-8000-00000000aa22"}',
  false
);
select test_support.assert_raises(
  $assert$
    select api.data_agent__get_run(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa22'::uuid,
      '00000000-0000-4000-8000-00000000a102'::uuid
    )
  $assert$,
  'DA_SCOPE_FORBIDDEN'
);

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000001004","role":"owner"}',
  false
);
select test_support.assert_true(
  (
    select pg_catalog.count(*) = 1
    from api.data_agent__list_demo_cases()
  ),
  'demo 只能看到本租户且 synthetic 的题目'
);
select test_support.assert_raises(
  $assert$
    select api.data_agent__get_run(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000a101'::uuid
    )
  $assert$,
  'DA_DEMO_SCOPE_ONLY'
);
reset role;

select test_support.assert_true(
  (
    select pg_catalog.count(*) = 2
      and pg_catalog.count(distinct record.principal_id) = 2
    from app_data_agent.idempotency_records as record
    where record.tenant_id =
        '00000000-0000-4000-8000-00000000aa11'::uuid
      and record.environment = 'test'
      and record.idempotency_key = 'accept-first-run'
  ),
  '幂等记录必须按 requester principal 分区，而不是 Tenant 全局冲突'
);
select test_support.assert_true(
  not exists (
    select 1
    from app_data_agent.runs as run
    where run.run_id = '00000000-0000-4000-8000-00000000a203'::uuid
  ),
  'accept RPC 后半段失败时不得留下孤儿 Run'
);
select test_support.assert_true(
  not exists (
    select 1
    from app_data_agent.idempotency_records as record
    where record.idempotency_key = 'must-rollback-after-run-insert'
  ),
  'accept RPC 失败时幂等记录也必须回滚'
);
select test_support.assert_true(
  (
    select pg_catalog.count(*) = 1
    from app_data_agent.run_events as event
    where event.run_id = '00000000-0000-4000-8000-00000000a201'::uuid
  ),
  '首次命令必须恰有一个 initial event'
);
select test_support.assert_true(
  (
    select pg_catalog.count(*) = 1
    from app_data_agent.outbox as message
    where message.run_id = '00000000-0000-4000-8000-00000000a201'::uuid
  ),
  '首次命令必须恰有一个 outbox message'
);

set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000001001"}',
  false
);
insert into storage.objects (id, bucket_id, name, metadata)
values (
  '00000000-0000-4000-8000-00000000c301'::uuid,
  'data-agent-artifacts',
  '00000000-0000-4000-8000-00000000da01/00000000-0000-4000-8000-00000000aa11/test/00000000-0000-4000-8000-000000001001/00000000-0000-4000-8000-00000000a201/result/sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  '{"stage":"inserted"}'::jsonb
);
update storage.objects
set metadata = '{"stage":"updated"}'::jsonb
where id = '00000000-0000-4000-8000-00000000c301'::uuid;
select test_support.assert_true(
  (
    select object.metadata ->> 'stage' = 'updated'
    from storage.objects as object
    where object.id = '00000000-0000-4000-8000-00000000c301'::uuid
  ),
  'owner 对合法 object prefix 具备 select/insert/update'
);

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000001002"}',
  false
);
select test_support.assert_true(
  (
    select pg_catalog.count(*) = 0
    from storage.objects as object
    where object.id = '00000000-0000-4000-8000-00000000c301'::uuid
  ),
  '同 Tenant viewer 不得读取其他 Principal/Run 的 artifact object'
);
select test_support.assert_raises(
  $assert$
    insert into storage.objects (id, bucket_id, name)
    values (
      '00000000-0000-4000-8000-00000000c302'::uuid,
      'data-agent-artifacts',
      '00000000-0000-4000-8000-00000000da01/00000000-0000-4000-8000-00000000aa11/test/00000000-0000-4000-8000-000000001001/00000000-0000-4000-8000-00000000a201/result/sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )
  $assert$,
  'row-level security'
);

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000001001"}',
  false
);
select test_support.assert_raises(
  $assert$
    insert into storage.objects (id, bucket_id, name)
    values (
      '00000000-0000-4000-8000-00000000c303'::uuid,
      'data-agent-artifacts',
      '00000000-0000-4000-8000-00000000da01/00000000-0000-4000-8000-00000000aa22/test/00000000-0000-4000-8000-000000001003/00000000-0000-4000-8000-00000000a102/result/sha256-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    )
  $assert$,
  'row-level security'
);
select test_support.assert_raises(
  $assert$
    insert into storage.objects (id, bucket_id, name)
    values (
      '00000000-0000-4000-8000-00000000c304'::uuid,
      'data-agent-artifacts',
      '00000000-0000-4000-8000-00000000da01/00000000-0000-4000-8000-00000000aa11/test/00000000-0000-4000-8000-000000001001/00000000-0000-4000-8000-00000000a201/result/not-a-digest'
    )
  $assert$,
  'row-level security'
);

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000001004"}',
  false
);
select test_support.assert_true(
  (
    select pg_catalog.count(*) = 0
    from storage.objects
  ),
  'demo principal 不得读取 tenant artifact object'
);

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000001005"}',
  false
);
select test_support.assert_true(
  (
    select pg_catalog.count(*) = 0
    from storage.objects
  ),
  '同 App/Tenant 的 prod principal 不得读取 test environment object'
);

reset role;
set role anon;
select pg_catalog.set_config('request.jwt.claims', '', false);
select test_support.assert_true(
  (
    select pg_catalog.count(*) = 0
    from storage.objects
  ),
  '其他应用的 PUBLIC permissive policy 不得 OR 绕过 restrictive guard'
);
select test_support.assert_raises(
  $assert$
    insert into storage.objects (id, bucket_id, name)
    values (
      '00000000-0000-4000-8000-00000000c306'::uuid,
      'data-agent-artifacts',
      '00000000-0000-4000-8000-00000000da01/00000000-0000-4000-8000-00000000aa11/test/00000000-0000-4000-8000-000000001001/00000000-0000-4000-8000-00000000a201/result/sha256-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    )
  $assert$,
  'row-level security'
);

reset role;
set role authenticated;
select pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000001001"}',
  false
);
delete from storage.objects
where id = '00000000-0000-4000-8000-00000000c301'::uuid;
reset role;

begin;
select pg_catalog.set_config('request.jwt.claims', '', true);
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
    select app_data_agent.register_datasource_egress_policy(
      '00000000-0000-4000-8000-00000000ed09'::uuid,
      'warehouse-null-acl',
      array['db.example.com', null]::text[],
      array[443]::integer[],
      array['https:']::text[],
      array['owner']::text[]
    )
  $assert$,
  'DA_DATASOURCE_POLICY_INVALID'
);
select app_data_agent.register_datasource_egress_policy(
  '00000000-0000-4000-8000-00000000ed01'::uuid,
  'warehouse-primary',
  array['db.example.com']::text[],
  array[443]::integer[],
  array['https:']::text[],
  array['analyst', 'owner']::text[]
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.register_datasource_egress_approval(
      '00000000-0000-4000-8000-00000000ed11'::uuid,
      '00000000-0000-4000-8000-00000000ed01'::uuid,
      1,
      'https://evil.example.com/',
      'db.example.com',
      443,
      'https:',
      array['8.8.8.8'::inet],
      pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => 30)
    )
  $assert$,
  'DA_DATASOURCE_APPROVAL_INVALID'
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.register_datasource_egress_approval(
      '00000000-0000-4000-8000-00000000ed12'::uuid,
      '00000000-0000-4000-8000-00000000ed01'::uuid,
      1,
      'https://db.example.com/warehouse',
      'db.example.com',
      443,
      'https:',
      array['8.8.8.8'::inet],
      pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => 30)
    )
  $assert$,
  'DA_DATASOURCE_APPROVAL_INVALID'
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.register_datasource_egress_approval(
      '00000000-0000-4000-8000-00000000ed13'::uuid,
      '00000000-0000-4000-8000-00000000ed01'::uuid,
      1,
      'https://db.example.com/?token=plaintext',
      'db.example.com',
      443,
      'https:',
      array['8.8.8.8'::inet],
      pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => 30)
    )
  $assert$,
  'DA_DATASOURCE_APPROVAL_INVALID'
);
select test_support.assert_true(
  (
    app_data_agent.register_datasource_egress_approval(
      '00000000-0000-4000-8000-00000000ed14'::uuid,
      '00000000-0000-4000-8000-00000000ed01'::uuid,
      1,
      'https://db.example.com/',
      'db.example.com',
      443,
      'https:',
      array['8.8.8.8'::inet],
      pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => 30)
    ) ->> 'status'
  ) = 'PINNED',
  'origin-only 且 host/protocol/port/pinned address 一致时才签发 egress approval'
);
select app_data_agent.register_datasource_egress_approval(
  '00000000-0000-4000-8000-00000000ed15'::uuid,
  '00000000-0000-4000-8000-00000000ed01'::uuid,
  1,
  'https://db.example.com/',
  'db.example.com',
  443,
  'https:',
  array['8.8.8.8'::inet],
  pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => 5)
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.verify_datasource_egress_approval(
      '00000000-0000-4000-8000-00000000ed15'::uuid,
      1,
      array['8.8.8.8'::inet],
      pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => 8)
    )
  $assert$,
  'DA_DATASOURCE_DNS_REBIND'
);
select app_data_agent.register_datasource_egress_approval(
  '00000000-0000-4000-8000-00000000ed16'::uuid,
  '00000000-0000-4000-8000-00000000ed01'::uuid,
  1,
  'https://db.example.com/',
  'db.example.com',
  443,
  'https:',
  array['8.8.8.8'::inet],
  pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => 1.5)
);
select test_support.assert_true(
  (
    app_data_agent.verify_datasource_egress_approval(
      '00000000-0000-4000-8000-00000000ed16'::uuid,
      1,
      array['8.8.8.8'::inet],
      pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => 1)
    ) ->> 'status'
  ) = 'VERIFIED',
  'egress approval 只能在原始 expires_at 内进入 VERIFIED'
);
select pg_catalog.pg_sleep(2);
select test_support.assert_raises(
  $assert$
    select app_data_agent.consume_datasource_egress_approval(
      '00000000-0000-4000-8000-00000000ed16'::uuid,
      1,
      '8.8.8.8'::inet
    )
  $assert$,
  'DA_DATASOURCE_APPROVAL_STALE'
);

insert into storage.objects (id, bucket_id, name)
values (
  '00000000-0000-4000-8000-00000000c305'::uuid,
  'data-agent-artifacts',
  '00000000-0000-4000-8000-00000000da01/00000000-0000-4000-8000-00000000aa11/test/00000000-0000-4000-8000-000000001001/00000000-0000-4000-8000-00000000a201/result/sha256-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
);
delete from storage.objects
where id = '00000000-0000-4000-8000-00000000c305'::uuid;

select test_support.assert_raises(
  $assert$
    update app_data_agent.outbox
    set status = 'LEASED',
        lease_owner = 'bypass-worker',
        lease_expires_at = pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => 60)
    where run_id = '00000000-0000-4000-8000-00000000a201'::uuid
  $assert$,
  'permission denied'
);
select test_support.assert_raises(
  $assert$
    update app_data_agent.commands
    set payload_json = '{"kind":"tampered"}'::jsonb
    where command_id = '00000000-0000-4000-8000-00000000c201'::uuid
  $assert$,
  'permission denied'
);
select test_support.assert_raises(
  $assert$
    update app_data_agent.commands
    set status = 'SUCCEEDED'
    where command_id = '00000000-0000-4000-8000-00000000c201'::uuid
  $assert$,
  'DA_COMMAND_STATUS_TRANSITION_INVALID'
);
select test_support.assert_raises(
  $assert$
    update app_data_agent.runs
    set active_fence = active_fence + 1
    where run_id = '00000000-0000-4000-8000-00000000a201'::uuid
  $assert$,
  'DA_RUN_IMMUTABLE'
);
select test_support.assert_true(
  app_data_agent.advance_run_fence(
    '00000000-0000-4000-8000-00000000a208'::uuid,
    0
  ) = 1,
  'Run fence 只能通过窄 CAS authority 单调推进'
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.advance_run_fence(
      '00000000-0000-4000-8000-00000000a208'::uuid,
      0
    )
  $assert$,
  'DA_RUN_FENCE_STALE_OR_FORBIDDEN'
);
select test_support.assert_raises(
  $assert$
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
    values (
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      'test',
      '00000000-0000-4000-8000-00000000c20b'::uuid,
      '00000000-0000-4000-8000-00000000a201'::uuid,
      '00000000-0000-4000-8000-000000001006'::uuid,
      'poison-other-requester',
      '{"kind":"start"}'::jsonb,
      'sha256:a2a5648f53b40c87f31893886a2312b94b1f73c6625406d3152e507ebf854567'
    )
  $assert$,
  'row-level security'
);
select test_support.assert_raises(
  $assert$
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
    values (
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      'test',
      '00000000-0000-4000-8000-00000000c20c'::uuid,
      '00000000-0000-4000-8000-00000000a201'::uuid,
      '00000000-0000-4000-8000-000000001001'::uuid,
      'forged-payload-hash',
      '{"kind":"start"}'::jsonb,
      'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    )
  $assert$,
  'check constraint'
);
select test_support.assert_raises(
  $assert$
    insert into app_data_agent.outbox (
      app_id,
      tenant_id,
      environment,
      outbox_id,
      run_id,
      command_id,
      topic,
      payload_json
    )
    values (
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      'test',
      '00000000-0000-4000-8000-00000000c30b'::uuid,
      '00000000-0000-4000-8000-00000000a201'::uuid,
      '00000000-0000-4000-8000-00000000c208'::uuid,
      'command.accepted',
      '{"commandId":"00000000-0000-4000-8000-00000000c208"}'::jsonb
    )
  $assert$,
  'foreign key constraint'
);
select test_support.assert_raises(
  $assert$
    insert into app_data_agent.run_events (
      app_id,
      tenant_id,
      environment,
      event_id,
      run_id,
      sequence,
      event_type,
      payload_json
    )
    values (
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      'test',
      '00000000-0000-4000-8000-00000000e20b'::uuid,
      '00000000-0000-4000-8000-00000000a201'::uuid,
      999,
      'security.probe',
      '{"password":"plaintext"}'::jsonb
    )
  $assert$,
  'check constraint'
);
select test_support.assert_raises(
  $assert$
    insert into app_data_agent.outbox (
      app_id,
      tenant_id,
      environment,
      outbox_id,
      run_id,
      command_id,
      topic,
      payload_json
    )
    values (
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      'test',
      '00000000-0000-4000-8000-00000000c30c'::uuid,
      '00000000-0000-4000-8000-00000000a201'::uuid,
      '00000000-0000-4000-8000-00000000c201'::uuid,
      'security.probe',
      '{"password":"plaintext"}'::jsonb
    )
  $assert$,
  'check constraint'
);
select test_support.assert_raises(
  $assert$
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
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      'test',
      '00000000-0000-4000-8000-00000000ad01'::uuid,
      '00000000-0000-4000-8000-000000001001'::uuid,
      'SECURITY_PROBE',
      'audit',
      'plaintext-secret',
      '{"password":"plaintext"}'::jsonb
    )
  $assert$,
  'check constraint'
);
select test_support.assert_raises(
  $assert$
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
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      'test',
      '00000000-0000-4000-8000-00000000ad02'::uuid,
      '00000000-0000-4000-8000-000000001006'::uuid,
      'FORGED_AUDIT',
      'audit',
      'other-requester',
      '{}'::jsonb
    )
  $assert$,
  'row-level security'
);

select test_support.assert_raises(
  $assert$
    select * from app_data_agent.claim_outbox('worker-null-limit', null, 60)
  $assert$,
  'DA_OUTBOX_LIMIT_INVALID'
);
select test_support.assert_raises(
  $assert$
    select * from app_data_agent.claim_outbox(null, 10, 60)
  $assert$,
  'DA_OUTBOX_WORKER_INVALID'
);
select test_support.assert_raises(
  $assert$
    select * from app_data_agent.claim_outbox('worker-null-lease', 10, null)
  $assert$,
  'DA_OUTBOX_LEASE_INVALID'
);
select test_support.assert_true(
  (
    select pg_catalog.count(*) = 2
    from app_data_agent.claim_outbox('worker-one', 10, 60)
  ),
  'owner outbox worker 必须原子领取本 Tenant 可见的 ready messages'
);
select test_support.assert_true(
  (
    select message.lease_token = 1
      and message.attempt_count = 1
      and message.status = 'LEASED'
    from app_data_agent.outbox as message
    where message.run_id = '00000000-0000-4000-8000-00000000a201'::uuid
  ),
  '首次 lease 必须把单调 fence 与 attempt 同时递增'
);
select test_support.assert_true(
  not app_data_agent.publish_outbox(
    (
      select message.outbox_id
      from app_data_agent.outbox as message
      where message.run_id = '00000000-0000-4000-8000-00000000a201'::uuid
    ),
    'worker-one',
    0
  ),
  '过期 fence 不得发布 outbox'
);
select test_support.assert_true(
  not app_data_agent.retry_outbox(
    (
      select message.outbox_id
      from app_data_agent.outbox as message
      where message.run_id = '00000000-0000-4000-8000-00000000a201'::uuid
    ),
    'worker-one',
    0,
    0
  ),
  '过期 fence 不得把 outbox 放回重试队列'
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.retry_outbox(
      (
        select message.outbox_id
        from app_data_agent.outbox as message
        where message.run_id = '00000000-0000-4000-8000-00000000a201'::uuid
      ),
      'worker-one',
      1,
      null
    )
  $assert$,
  'DA_OUTBOX_RETRY_DELAY_INVALID'
);
select test_support.assert_true(
  app_data_agent.retry_outbox(
    (
      select message.outbox_id
      from app_data_agent.outbox as message
      where message.run_id = '00000000-0000-4000-8000-00000000a201'::uuid
    ),
    'worker-one',
    1,
    0
  ),
  '当前 fence 才能把 outbox 放回重试队列'
);
select test_support.assert_true(
  (
    select message.status = 'PENDING'
      and message.lease_token = 1
      and message.attempt_count = 1
      and message.lease_owner is null
    from app_data_agent.outbox as message
    where message.run_id = '00000000-0000-4000-8000-00000000a201'::uuid
  ),
  'retry 必须保留单调 fence 和 attempt，并清空 lease'
);
select test_support.assert_true(
  (
    select pg_catalog.count(*) = 1
    from app_data_agent.claim_outbox('worker-two', 10, 60)
  ),
  'retry 后的 ready message 必须可再次原子领取'
);
select test_support.assert_true(
  (
    select message.lease_token = 2
      and message.attempt_count = 2
      and message.status = 'LEASED'
      and message.lease_owner = 'worker-two'
    from app_data_agent.outbox as message
    where message.run_id = '00000000-0000-4000-8000-00000000a201'::uuid
  ),
  '重新领取必须单调递增 fence 与 attempt'
);
select test_support.assert_true(
  not app_data_agent.publish_outbox(
    (
      select message.outbox_id
      from app_data_agent.outbox as message
      where message.run_id = '00000000-0000-4000-8000-00000000a201'::uuid
    ),
    'worker-two',
    1
  ),
  '重试前的 fence 不得发布重新领取的 outbox'
);
select test_support.assert_true(
  app_data_agent.publish_outbox(
    (
      select message.outbox_id
      from app_data_agent.outbox as message
      where message.run_id = '00000000-0000-4000-8000-00000000a201'::uuid
    ),
    'worker-two',
    2
  ),
  '重新领取后的当前 fence 才能发布 outbox'
);
commit;

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
    select authority.membership_version = 3
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
