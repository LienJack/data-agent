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

insert into app_data_agent.workspaces (
  app_id,
  workspace_id,
  environment,
  slug,
  display_name
)
values
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    'test',
    'smoke-aa11-test',
    'Smoke workspace AA11 test'
  ),
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    'smoke-aa22-test',
    'Smoke workspace AA22 test'
  ),
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    'prod',
    'smoke-aa11-prod',
    'Smoke workspace AA11 prod'
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

create function test_support.activate_falcon24_e1_fixture(
  requested_tenant_id uuid,requested_environment text,requested_principal_id uuid,
  requested_deployment_id uuid,requested_production_isolation_proven boolean,
  requested_seed integer)
returns void language plpgsql volatile security definer set search_path='' as $function$
declare staging_id uuid:=pg_catalog.format('00000000-0000-4000-8000-%s',
    pg_catalog.lpad((7100+requested_seed)::text,12,'0'))::uuid;
  baseline_id uuid:=pg_catalog.format('00000000-0000-4000-8000-%s',
    pg_catalog.lpad((7200+requested_seed)::text,12,'0'))::uuid;
  attempt_id uuid:=pg_catalog.format('00000000-0000-4000-8000-%s',
    pg_catalog.lpad((7300+requested_seed)::text,12,'0'))::uuid;
  retained_hash constant text:='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  component text; baseline_key text; receipt jsonb; command jsonb; baseline jsonb;
  receipt_hashes jsonb:='{}'::jsonb;
begin
  perform pg_catalog.set_config('data_agent.app_id',
    '00000000-0000-4000-8000-00000000da01',true);
  perform pg_catalog.set_config('data_agent.tenant_id',requested_tenant_id::text,true);
  perform pg_catalog.set_config('data_agent.environment',requested_environment,true);
  perform pg_catalog.set_config('data_agent.principal_id',requested_principal_id::text,true);
  perform pg_catalog.set_config('data_agent.role','owner',true);
  perform pg_catalog.set_config('data_agent.deployment_id',requested_deployment_id::text,true);

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-staging-session-begin@1.0.0',
    'staging_id',staging_id,'retained_assets_hash',retained_hash);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(command));
  perform app_data_agent.begin_falcon24_e1_staging_session(command);

  foreach component in array array['AGENT_PROFILES','DATASET','LLM_CONFIGURATION',
      'OPERATOR_REGISTRY','SANDBOX_RUNTIME','SEMANTIC_RELEASE']::text[] loop
    baseline_key:=case component when 'AGENT_PROFILES' then 'agent_profiles'
      when 'DATASET' then 'dataset' when 'LLM_CONFIGURATION' then 'llm_configuration'
      when 'OPERATOR_REGISTRY' then 'operator_registry'
      when 'SANDBOX_RUNTIME' then 'sandbox_runtime' else 'semantic_release' end;
    receipt:=pg_catalog.jsonb_build_object(
      'schema_version','falcon24-e1-staging-receipt@1.0.0','staging_id',staging_id,
      'component',component,
      'subject_hash','sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'evidence_hash','sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'production_isolation_proven',
        component='SANDBOX_RUNTIME' and requested_production_isolation_proven);
    receipt:=receipt||pg_catalog.jsonb_build_object(
      'receipt_hash',app_data_agent.u2_canonical_sha256(receipt));
    command:=pg_catalog.jsonb_build_object(
      'schema_version','falcon24-e1-staging-receipt-record@1.0.0','receipt',receipt);
    command:=command||pg_catalog.jsonb_build_object(
      'command_hash',app_data_agent.u2_canonical_sha256(command));
    perform app_data_agent.record_falcon24_e1_staging_receipt(command);
    receipt_hashes:=receipt_hashes||pg_catalog.jsonb_build_object(
      baseline_key,receipt->>'receipt_hash');
  end loop;

  baseline:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-authority-baseline@1.0.0','baseline_id',baseline_id,
    'authority_epoch','E1','source_commit',pg_catalog.repeat('d',40),
    'retained_assets_hash',retained_hash,
    'web_build_hash','sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'staging_receipts',receipt_hashes,
    'acceptance_contracts',pg_catalog.jsonb_build_object(
      'oracle','sha256:1111111111111111111111111111111111111111111111111111111111111111',
      'qualification','sha256:2222222222222222222222222222222222222222222222222222222222222222',
      'campaign','sha256:3333333333333333333333333333333333333333333333333333333333333333',
      'qa_e2e','sha256:4444444444444444444444444444444444444444444444444444444444444444',
      'trace_ui','sha256:5555555555555555555555555555555555555555555555555555555555555555',
      'reclamation','sha256:6666666666666666666666666666666666666666666666666666666666666666'),
    'production_isolation_proven',requested_production_isolation_proven,
    'production_gate',case when requested_production_isolation_proven then 'GO' else 'HOLD' end);
  baseline:=baseline||pg_catalog.jsonb_build_object(
    'baseline_hash',app_data_agent.u2_canonical_sha256(baseline));
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-baseline-stage@1.0.0','staging_id',staging_id,
    'baseline',baseline);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(command));
  perform app_data_agent.stage_falcon24_e1_authority_baseline(command);

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-activation-attempt-begin@1.0.0',
    'attempt_id',attempt_id,'baseline_id',baseline_id,
    'expected_baseline_hash',baseline->>'baseline_hash');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(command));
  perform app_data_agent.begin_falcon24_e1_activation_attempt(command);
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-authority-activate@1.0.0',
    'attempt_id',attempt_id,'baseline_id',baseline_id,
    'expected_baseline_hash',baseline->>'baseline_hash');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(command));
  perform app_data_agent.activate_falcon24_e1_authority(command);
end
$function$;

select test_support.activate_falcon24_e1_fixture(
  '00000000-0000-4000-8000-00000000aa11'::uuid,'test',
  '00000000-0000-4000-8000-000000001001'::uuid,
  '00000000-0000-4000-8000-00000000de01'::uuid,false,1);
select test_support.activate_falcon24_e1_fixture(
  '00000000-0000-4000-8000-00000000aa22'::uuid,'test',
  '00000000-0000-4000-8000-000000001003'::uuid,
  '00000000-0000-4000-8000-00000000de01'::uuid,false,2);
select test_support.activate_falcon24_e1_fixture(
  '00000000-0000-4000-8000-00000000aa11'::uuid,'prod',
  '00000000-0000-4000-8000-000000001005'::uuid,
  '00000000-0000-4000-8000-00000000de02'::uuid,true,3);

select pg_catalog.set_config(
  'data_agent.app_id','00000000-0000-4000-8000-00000000da01',false);
select pg_catalog.set_config(
  'data_agent.tenant_id','00000000-0000-4000-8000-00000000aa11',false);
select pg_catalog.set_config('data_agent.environment','test',false);
select pg_catalog.set_config(
  'data_agent.principal_id','00000000-0000-4000-8000-000000001001',false);
select pg_catalog.set_config('data_agent.role','owner',false);
select pg_catalog.set_config(
  'data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',false);
insert into app_data_agent.runs (
  app_id,
  tenant_id,
  environment,
  run_id,
  principal_id,
  status,
  question
)
values (
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa11'::uuid,
  'test',
  '00000000-0000-4000-8000-00000000a101'::uuid,
  '00000000-0000-4000-8000-000000001001'::uuid,
  'RUNNING',
  'tenant one private question'
);

select pg_catalog.set_config(
  'data_agent.tenant_id','00000000-0000-4000-8000-00000000aa22',false);
select pg_catalog.set_config(
  'data_agent.principal_id','00000000-0000-4000-8000-000000001003',false);
insert into app_data_agent.runs (
  app_id,
  tenant_id,
  environment,
  run_id,
  principal_id,
  status,
  question
)
values (
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
