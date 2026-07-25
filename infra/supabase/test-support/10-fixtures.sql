\set ON_ERROR_STOP on

select platform.register_app(
  '00000000-0000-4000-8000-00000000bb01'::uuid,
  '00000000-0000-4000-8000-00000000bb02'::uuid,
  'fixture-other',
  'Fixture Other App',
  'app_fixture_other',
  'fixture_other__',
  'postgres'
);

select platform.register_api_operation(
  '00000000-0000-4000-8000-00000000bb01'::uuid,
  'ping',
  'fixture_other__ping'
);

insert into platform.deployment_mappings (
  deployment_id,
  app_id,
  environment,
  deployment_key_hash
)
values
  (
    '00000000-0000-4000-8000-00000000de01'::uuid,
    '00000000-0000-4000-8000-00000000da01'::uuid,
    'test',
    'sha256:' || pg_catalog.repeat('1', 64)
  ),
  (
    '00000000-0000-4000-8000-00000000be01'::uuid,
    '00000000-0000-4000-8000-00000000bb01'::uuid,
    'test',
    'sha256:' || pg_catalog.repeat('2', 64)
  ),
  (
    '00000000-0000-4000-8000-00000000de02'::uuid,
    '00000000-0000-4000-8000-00000000da01'::uuid,
    'prod',
    'sha256:' || pg_catalog.repeat('3', 64)
  );

insert into platform.job_authorities (
  authority_id,
  authority_name,
  public_key_fingerprint
)
values (
  '00000000-0000-4000-8000-00000000fa01'::uuid,
  'smoke-job-authority',
  'sha256:' || pg_catalog.repeat('a', 64)
);

create schema app_fixture_other authorization postgres;

create table app_fixture_other.memberships (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000bb01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  principal_id uuid not null,
  membership_role text not null,
  primary key (app_id, tenant_id, environment, principal_id)
);

create table app_fixture_other.records (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000bb01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  record_id uuid not null,
  value text not null,
  primary key (app_id, tenant_id, environment, record_id)
);

insert into app_fixture_other.memberships (
  app_id,
  tenant_id,
  environment,
  principal_id,
  membership_role
)
values
  (
    '00000000-0000-4000-8000-00000000bb01'::uuid,
    '00000000-0000-4000-8000-00000000bb11'::uuid,
    'test',
    '00000000-0000-4000-8000-000000002001'::uuid,
    'owner'
  ),
  (
    '00000000-0000-4000-8000-00000000bb01'::uuid,
    '00000000-0000-4000-8000-00000000bb22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000002002'::uuid,
    'owner'
  );

insert into app_fixture_other.records (
  app_id,
  tenant_id,
  environment,
  record_id,
  value
)
values
  (
    '00000000-0000-4000-8000-00000000bb01'::uuid,
    '00000000-0000-4000-8000-00000000bb11'::uuid,
    'test',
    '00000000-0000-4000-8000-00000000b101'::uuid,
    'other-app-tenant-one'
  ),
  (
    '00000000-0000-4000-8000-00000000bb01'::uuid,
    '00000000-0000-4000-8000-00000000bb22'::uuid,
    'test',
    '00000000-0000-4000-8000-00000000b102'::uuid,
    'other-app-tenant-two'
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
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001001'::uuid,
    'owner'
  ),
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001002'::uuid,
    'viewer'
  ),
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'owner'
  ),
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001004'::uuid,
    'demo'
  ),
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    'prod',
    '00000000-0000-4000-8000-000000001005'::uuid,
    'owner'
  ),
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001006'::uuid,
    'analyst'
  );

insert into platform.demo_principals (
  principal_id,
  app_id,
  tenant_id,
  environment,
  principal_name,
  rate_limit_per_minute
)
values (
  '00000000-0000-4000-8000-000000001004'::uuid,
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa11'::uuid,
  'test',
  'demo-fixture',
  20
);

insert into app_data_agent.runs (
  app_id,
  tenant_id,
  environment,
  run_id,
  principal_id,
  status,
  question
)
values
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    'test',
    '00000000-0000-4000-8000-00000000a101'::uuid,
    '00000000-0000-4000-8000-000000001001'::uuid,
    'RUNNING',
    'tenant one private question'
  ),
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-00000000a102'::uuid,
    '00000000-0000-4000-8000-000000001003'::uuid,
    'RUNNING',
    'tenant two private question'
  );

insert into app_data_agent.datasets (
  app_id,
  tenant_id,
  environment,
  dataset_id,
  dataset_name,
  data_classification
)
values
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    'test',
    '00000000-0000-4000-8000-00000000d501'::uuid,
    'synthetic-demo',
    'SYNTHETIC'
  ),
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    'test',
    '00000000-0000-4000-8000-00000000d502'::uuid,
    'private-control',
    'PRIVATE'
  ),
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-00000000d503'::uuid,
    'other-tenant-synthetic',
    'SYNTHETIC'
  );

insert into app_data_agent.eval_cases (
  app_id,
  tenant_id,
  environment,
  eval_case_id,
  dataset_id,
  benchmark_suite,
  case_key,
  prompt,
  expected_json,
  is_demo_eligible
)
values
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    'test',
    '00000000-0000-4000-8000-00000000e501'::uuid,
    '00000000-0000-4000-8000-00000000d501'::uuid,
    'CONTROLLED',
    'demo-root-cause',
    '为什么本周订单转化率下降？',
    '{"answer_kind":"root_cause"}'::jsonb,
    true
  ),
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    'test',
    '00000000-0000-4000-8000-00000000e502'::uuid,
    '00000000-0000-4000-8000-00000000d502'::uuid,
    'RCAEval',
    'private-root-cause',
    '私有数据不应进入演示。',
    '{"answer_kind":"private"}'::jsonb,
    true
  ),
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-00000000e503'::uuid,
    '00000000-0000-4000-8000-00000000d503'::uuid,
    'InsightBench',
    'other-tenant-demo',
    '另一个租户的题目不应泄露。',
    '{"answer_kind":"cross_tenant"}'::jsonb,
    true
  );

-- 模拟共享 Project 中另一个应用误建的宽 policy；Data Agent 的 restrictive guard
-- 必须仍阻止 anon/PUBLIC 访问自己的 bucket。
create policy test_shared_project_overbroad_policy
on storage.objects
for all
to public
using (true)
with check (true);
