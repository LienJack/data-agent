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
    select pg_catalog.count(distinct membership.tenant_id) = 2
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
    select pg_catalog.count(*) >= 32
      and pg_catalog.bool_or(
        migration_version = '20260725010631_app_data_agent_model_billing_settlement'
      )
    from platform.migration_ledger
  ),
  'Phase 5 migration 必须记账；并允许 dirty worktree 的后续 migration 一并存在'
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
  not pg_catalog.has_column_privilege(
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
  '后台不得直接更新 Command status 或 payload，结算只能经过窄函数'
);
select test_support.assert_true(
  not pg_catalog.has_column_privilege(
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
  '后台不得直接更新 Run fence 或 question，推进只能经过窄函数'
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
    select pg_catalog.count(*) >= 1
      and pg_catalog.bool_and(
        run.tenant_id = '00000000-0000-4000-8000-00000000aa11'::uuid
      )
    from app_data_agent.runs as run
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
  'permission denied for table runs'
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
  '{"kind":"START_L2_RESEARCH"}'::jsonb,
  'sha256:9b70cc1f348a75528cb84012b2f8b1946594461c0df5f95682e4ea0b5e88dd86'
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
      '{"kind":"START_L2_RESEARCH"}'::jsonb,
      'sha256:9b70cc1f348a75528cb84012b2f8b1946594461c0df5f95682e4ea0b5e88dd86'
    ) ->> 'replayed'
  )::boolean,
  '同 payload 重放必须返回已有原子命令'
);
select test_support.assert_true(
  not (
    api.data_agent__accept_run_command(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000a201'::uuid,
      '00000000-0000-4000-8000-00000000c201'::uuid,
      'accept-first-run',
      'first atomic question',
      '{"kind":"START_L2_RESEARCH"}'::jsonb,
      'sha256:9b70cc1f348a75528cb84012b2f8b1946594461c0df5f95682e4ea0b5e88dd86'
    ) -> 'run' ? 'next_queue_sequence'
  ),
  'Authenticated Run 响应不得泄露内部 Queue Counter'
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
      '00000000-0000-4000-8000-00000000a20e'::uuid,
      '00000000-0000-4000-8000-00000000c20e'::uuid,
      'reject-resume-as-initial-command',
      'resume is not an initial command',
      '{"kind":"RESUME_RUN"}'::jsonb,
      'sha256:98091ce0aa87efebe56e04c1fbeedce5b53840c1a4185cc59dab39abef0b6c9c'
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
select test_support.assert_raises(
  $assert$
    select api.data_agent__accept_run_command(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000a20d'::uuid,
      '00000000-0000-4000-8000-00000000c20d'::uuid,
      'token=sk-browser-idempotency-key-should-not-persist',
      'suspicious idempotency key must not persist',
      '{"kind":"START_L2_RESEARCH"}'::jsonb,
      'sha256:9b70cc1f348a75528cb84012b2f8b1946594461c0df5f95682e4ea0b5e88dd86'
    )
  $assert$,
  'DA_COMMAND_PAYLOAD_INVALID'
);
reset role;
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
        '00000000-0000-4000-8000-00000000a201'::uuid
      and message.command_id =
        '00000000-0000-4000-8000-00000000c201'::uuid
  ),
  'Browser 首写必须原子落库 qseq=1，并把 Run Counter 推进到 2'
);
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
select test_support.assert_true(
  not exists (
    select 1
    from app_data_agent.runs as run
    where run.run_id = '00000000-0000-4000-8000-00000000a20e'::uuid
  )
  and not exists (
    select 1
    from app_data_agent.commands as command
    where command.command_id =
      '00000000-0000-4000-8000-00000000c20e'::uuid
  )
  and not exists (
    select 1
    from app_data_agent.idempotency_records as record
    where record.idempotency_key =
      'reject-resume-as-initial-command'
  )
  and not exists (
    select 1
    from app_data_agent.run_events as event
    where event.run_id = '00000000-0000-4000-8000-00000000a20e'::uuid
  )
  and not exists (
    select 1
    from app_data_agent.outbox as message
    where message.run_id = '00000000-0000-4000-8000-00000000a20e'::uuid
  )
  and not exists (
    select 1
    from app_data_agent.audit_log as audit
    where audit.resource_id in (
      '00000000-0000-4000-8000-00000000a20e',
      '00000000-0000-4000-8000-00000000c20e'
    )
  ),
  'RESUME_RUN 作为初始命令被拒后必须保持零持久化'
);
select test_support.assert_true(
  not exists (
    select 1
    from app_data_agent.runs as run
    where run.run_id = '00000000-0000-4000-8000-00000000a20d'::uuid
  )
  and not exists (
    select 1
    from app_data_agent.commands as command
    where command.command_id =
      '00000000-0000-4000-8000-00000000c20d'::uuid
  )
  and not exists (
    select 1
    from app_data_agent.idempotency_records as record
    where record.idempotency_key =
      'token=sk-browser-idempotency-key-should-not-persist'
  )
  and not exists (
    select 1
    from app_data_agent.run_events as event
    where event.run_id = '00000000-0000-4000-8000-00000000a20d'::uuid
  )
  and not exists (
    select 1
    from app_data_agent.outbox as message
    where message.run_id = '00000000-0000-4000-8000-00000000a20d'::uuid
      or message.command_id =
        '00000000-0000-4000-8000-00000000c20d'::uuid
  )
  and not exists (
    select 1
    from app_data_agent.audit_log as audit
    where audit.resource_id in (
      '00000000-0000-4000-8000-00000000a20d',
      '00000000-0000-4000-8000-00000000c20d'
    )
  ),
  'Browser 疑似 token 幂等键被拒后必须保持零持久化'
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
      '{"kind":"START_L2_RESEARCH","mode":"L2"}'::jsonb,
      'sha256:a51cad25baa6916772c6e63149ac066d5059dc6c5d721a66c2d35fa3121bd418'
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
      '{"kind":"START_L2_RESEARCH","mode":"L2"}'::jsonb,
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
      '00000000-0000-4000-8000-00000000a203'::uuid,
      '00000000-0000-4000-8000-00000000c201'::uuid,
      'must-rollback-after-run-insert',
      'this run must roll back',
      '{"kind":"START_L2_RESEARCH"}'::jsonb,
      'sha256:9b70cc1f348a75528cb84012b2f8b1946594461c0df5f95682e4ea0b5e88dd86'
    )
  $assert$,
  'DA_COMMAND_IDENTITY_CONFLICT'
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
select test_support.assert_true(
  not (
    api.data_agent__get_run(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000a201'::uuid
    ) ? 'next_queue_sequence'
  ),
  'Authenticated Run 读取不得暴露内部 Queue Counter'
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
  'DA_RUN_NOT_FOUND'
);
select test_support.assert_raises(
  $assert$
    select api.data_agent__get_run(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000a2ff'::uuid
    )
  $assert$,
  'DA_RUN_NOT_FOUND'
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
      '{"kind":"START_L2_RESEARCH"}'::jsonb,
      'sha256:9b70cc1f348a75528cb84012b2f8b1946594461c0df5f95682e4ea0b5e88dd86'
      ) as result
    ) as accepted
  ),
  '同 Tenant 不同 requester 可以复用幂等键且不得碰撞'
);
select test_support.assert_raises(
  $assert$
    select api.data_agent__accept_run_command(
      '00000000-0000-4000-8000-00000000de01'::uuid,
      '00000000-0000-4000-8000-00000000aa11'::uuid,
      '00000000-0000-4000-8000-00000000a20f'::uuid,
      '00000000-0000-4000-8000-00000000c201'::uuid,
      'cross-principal-command-id-collision',
      'cross principal collision must stay sanitized',
      '{"kind":"START_L2_RESEARCH"}'::jsonb,
      'sha256:9b70cc1f348a75528cb84012b2f8b1946594461c0df5f95682e4ea0b5e88dd86'
    )
  $assert$,
  'DA_COMMAND_IDENTITY_CONFLICT'
);
select test_support.assert_true(
  not pg_catalog.has_function_privilege(
    'authenticated',
    'api.data_agent__submit_command(uuid,uuid,uuid,uuid,text,jsonb,text)',
    'EXECUTE'
  ),
  'U4 必须撤销不兼容的 legacy submit_command'
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
  exists (
    select 1
    from platform.api_operation_registry as operation
    where operation.app_id =
      '00000000-0000-4000-8000-00000000da01'::uuid
      and operation.operation_name = 'submit_command'
  ),
  'Append-only API Registry 必须保留 legacy submit_command 的历史声明'
);

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
    where run.run_id in (
      '00000000-0000-4000-8000-00000000a203'::uuid,
      '00000000-0000-4000-8000-00000000a20f'::uuid
    )
  ),
  '同 Principal 或跨 Principal Command ID 冲突都不得留下孤儿 Run'
);
select test_support.assert_true(
  not exists (
    select 1
    from app_data_agent.idempotency_records as record
    where record.idempotency_key in (
      'must-rollback-after-run-insert',
      'cross-principal-command-id-collision'
    )
  ),
  'Command ID 冲突时幂等记录也必须回滚'
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

select test_support.assert_true(
  app_data_agent.lock_owned_run_fence(
    '00000000-0000-4000-8000-00000000a201'::uuid
  ) is null
  and app_data_agent.lock_owned_run_fence(
    '00000000-0000-4000-8000-00000000a102'::uuid
  ) is null
  and app_data_agent.lock_owned_run_fence(
    '00000000-0000-4000-8000-00000000a208'::uuid
  ) is null,
  'Fence 行锁必须拒绝未领取 Run、跨 Tenant 与同 Tenant 不同 Principal 的 Run'
);

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
  'permission denied'
);
select test_support.assert_raises(
  $assert$
    update app_data_agent.runs
    set active_fence = active_fence + 1
    where run_id = '00000000-0000-4000-8000-00000000a201'::uuid
  $assert$,
  'permission denied'
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.advance_run_fence(
      '00000000-0000-4000-8000-00000000a208'::uuid,
      0
    )
  $assert$,
  'permission denied for function advance_run_fence'
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
      '{"kind":"START_L2_RESEARCH"}'::jsonb,
      'sha256:9b70cc1f348a75528cb84012b2f8b1946594461c0df5f95682e4ea0b5e88dd86'
    )
  $assert$,
  'permission denied for table commands'
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
      '{"kind":"START_L2_RESEARCH"}'::jsonb,
      'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    )
  $assert$,
  'permission denied for table commands'
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
  'permission denied for table outbox'
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
  'permission denied for table run_events'
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
  'permission denied for table outbox'
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
  'permission denied for table audit_log'
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
  'permission denied for table audit_log'
);

select test_support.assert_raises(
  $assert$
    select * from app_data_agent.claim_outbox('legacy-worker', 1, 60)
  $assert$,
  'permission denied for function claim_outbox'
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.publish_outbox(
      '00000000-0000-4000-8000-00000000b201'::uuid,
      'legacy-worker',
      1
    )
  $assert$,
  'permission denied for function publish_outbox'
);
select test_support.assert_raises(
  $assert$
    select app_data_agent.retry_outbox(
      '00000000-0000-4000-8000-00000000b201'::uuid,
      'legacy-worker',
      1,
      1000
    )
  $assert$,
  'permission denied for function retry_outbox'
);
commit;

select test_support.assert_true(
  not exists (
    select 1
    from app_data_agent.outbox as message
    join app_data_agent.commands as command
      on command.app_id = message.app_id
     and command.tenant_id = message.tenant_id
     and command.environment = message.environment
     and command.command_id = message.command_id
    where message.topic in ('run.command.accepted', 'run.work.resume')
      and message.status in ('PENDING', 'FAILED', 'LEASED')
      and (
        command.payload_json ->> 'kind' is null
        or command.payload_json ->> 'kind'
          not in ('START_L2_RESEARCH', 'RESUME_RUN')
      )
  ),
  '可领取 Runtime Outbox 不得包含未支持的 Command kind'
);
