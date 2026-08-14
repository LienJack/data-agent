-- Phase 3: app-global model, price and FX authority is database-revalidated.

begin;

insert into data_agent_auth."user" ("id", "name", "email", "emailVerified") values
  ('00000000-0000-4000-8000-00000000a501', 'Pricing Admin', 'pricing-admin@example.test', true),
  ('00000000-0000-4000-8000-00000000a502', 'Pricing User', 'pricing-user@example.test', true);

insert into app_data_agent.app_users (
  app_id, environment, principal_id, auth_user_id, email, display_name, system_role
) values
  (
    '00000000-0000-4000-8000-00000000da01', 'test',
    '00000000-0000-4000-8000-00000000a511',
    '00000000-0000-4000-8000-00000000a501',
    'pricing-admin@example.test', 'Pricing Admin', 'SUPER_ADMIN'
  ),
  (
    '00000000-0000-4000-8000-00000000da01', 'test',
    '00000000-0000-4000-8000-00000000a512',
    '00000000-0000-4000-8000-00000000a502',
    'pricing-user@example.test', 'Pricing User', 'USER'
  );

set local role data_agent_backend;

select test_support.assert_true(
  (
    select pg_catalog.count(*) = 0
    from platform.list_model_price_candidates(
      '00000000-0000-4000-8000-00000000de01',
      '00000000-0000-4000-8000-00000000a511'
    )
  ),
  '空库价格候选列表必须返回空集合而不是失败'
);

select app_data_agent.apply_model_catalog_command(
  '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000a511',
  '{
    "schema_version":"model-catalog-upsert@1.0.0",
    "operation_id":"00000000-0000-4000-8000-00000000a521",
    "idempotency_key":"pricing-model-create",
    "model_profile_id":"00000000-0000-4000-8000-00000000a531",
    "provider":"openai",
    "model_id":"gpt-pricing-smoke",
    "display_name":"Pricing Smoke Model",
    "base_url":"https://api.openai.com/v1",
    "capabilities":{"structured_output":true,"tool_calling":true,"streaming":true,"reasoning":true,"vision":false},
    "credential_ref":null,
    "status":"UNBILLABLE",
    "is_system_default":false,
    "expected_config_version":0
  }'::jsonb
);

select app_data_agent.apply_model_catalog_command(
  '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000a511',
  '{
    "schema_version":"model-catalog-upsert@1.0.0",
    "operation_id":"00000000-0000-4000-8000-00000000a521",
    "idempotency_key":"pricing-model-create",
    "model_profile_id":"00000000-0000-4000-8000-00000000a531",
    "provider":"openai",
    "model_id":"gpt-pricing-smoke",
    "display_name":"Pricing Smoke Model",
    "base_url":"https://api.openai.com/v1",
    "capabilities":{"structured_output":true,"tool_calling":true,"streaming":true,"reasoning":true,"vision":false},
    "credential_ref":null,
    "status":"UNBILLABLE",
    "is_system_default":false,
    "expected_config_version":0
  }'::jsonb
);

do $assert_non_admin$
begin
  begin
    perform app_data_agent.apply_model_catalog_command(
      '00000000-0000-4000-8000-00000000de01',
      '00000000-0000-4000-8000-00000000a512',
      '{
        "schema_version":"model-catalog-status@1.0.0",
        "operation_id":"00000000-0000-4000-8000-00000000a522",
        "idempotency_key":"pricing-user-denied",
        "model_profile_id":"00000000-0000-4000-8000-00000000a531",
        "status":"DISABLED",
        "expected_config_version":1
      }'::jsonb
    );
    raise exception 'PRICING_NON_ADMIN_MUTATION_WAS_NOT_REJECTED';
  exception when insufficient_privilege then
    if sqlerrm <> 'SUPER_ADMIN_REQUIRED' then raise; end if;
  end;
end
$assert_non_admin$;

select app_data_agent.submit_pricing_sync(
  '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000a511',
  '{
    "schema_version":"fx-rate-sync-submit@1.0.0",
    "operation_id":"00000000-0000-4000-8000-00000000a541",
    "source_adapter":"cfets-official-fx@1.0.0",
    "source_url":"https://www.chinamoney.com.cn/chinese/bkccpr/index.html?tab=2",
    "evidence_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "parser_version":"cfets-official-fx@1.0.0",
    "fetched_at":"2026-08-14T00:00:00.000Z",
    "raw_evidence":"official fx fixture",
    "candidates":[{
      "candidate_id":"00000000-0000-4000-8000-00000000a542",
      "base_currency":"USD","quote_currency":"CNY","rate":"7.1","official_date":"2026-08-14"
    }]
  }'::jsonb
);

select app_data_agent.decide_pricing_candidate(
  '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000a511',
  'FX_RATE',
  pg_catalog.jsonb_build_object(
    'schema_version','pricing-candidate-decision@1.0.0',
    'operation_id','00000000-0000-4000-8000-00000000a543',
    'idempotency_key','pricing-fx-approve',
    'candidate_id','00000000-0000-4000-8000-00000000a542',
    'decision','APPROVE','reason','verified CFETS fixture',
    'effective_from',pg_catalog.clock_timestamp() - interval '1 minute'
  )
);

select app_data_agent.record_pricing_sync_failure(
  '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000a511',
  '{
    "operation_id":"00000000-0000-4000-8000-00000000a545",
    "source_kind":"FX_RATE",
    "source_adapter":"pboc-official-fx@1.0.0",
    "source_url":"https://www.pbc.gov.cn/zhengcehuobisi/125207/125217/125925/17105-2.html",
    "parser_version":"pboc-official-fx@1.0.0",
    "fetched_at":"2026-08-14T00:00:00.000Z",
    "raw_evidence":"unparseable fixture",
    "error_code":"PRICING_SOURCE_JSON_INVALID"
  }'::jsonb
);

select app_data_agent.record_pricing_sync_failure(
  '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000a511',
  '{
    "operation_id":"00000000-0000-4000-8000-00000000a545",
    "source_kind":"FX_RATE",
    "source_adapter":"pboc-official-fx@1.0.0",
    "source_url":"https://www.pbc.gov.cn/zhengcehuobisi/125207/125217/125925/17105-2.html",
    "parser_version":"pboc-official-fx@1.0.0",
    "fetched_at":"2026-08-14T00:00:00.000Z",
    "raw_evidence":"unparseable fixture",
    "error_code":"PRICING_SOURCE_JSON_INVALID"
  }'::jsonb
);

do $assert_failure_conflict$
begin
  begin
    perform app_data_agent.record_pricing_sync_failure(
      '00000000-0000-4000-8000-00000000de01',
      '00000000-0000-4000-8000-00000000a511',
      '{
        "operation_id":"00000000-0000-4000-8000-00000000a545",
        "source_kind":"FX_RATE",
        "source_adapter":"pboc-official-fx@1.0.0",
        "source_url":"https://www.pbc.gov.cn/zhengcehuobisi/125207/125217/125925/17105-2.html",
        "parser_version":"pboc-official-fx@1.0.1",
        "fetched_at":"2026-08-14T00:00:00.000Z",
        "raw_evidence":"different payload",
        "error_code":"PRICING_SOURCE_SCHEMA_DRIFT"
      }'::jsonb
    );
    raise exception 'PRICING_SYNC_OPERATION_CONFLICT_WAS_NOT_REJECTED';
  exception when unique_violation then
    if sqlerrm <> 'PRICING_SYNC_OPERATION_CONFLICT' then raise; end if;
  end;
end
$assert_failure_conflict$;

select app_data_agent.submit_pricing_sync(
  '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000a511',
  '{
    "schema_version":"model-price-sync-submit@1.0.0",
    "operation_id":"00000000-0000-4000-8000-00000000a551",
    "source_adapter":"openai-official-pricing@1.0.0",
    "source_url":"https://openai.com/api/pricing/",
    "evidence_hash":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "parser_version":"openai-official-pricing@1.0.0",
    "fetched_at":"2026-08-14T00:00:00.000Z",
    "raw_evidence":"official price fixture",
    "candidates":[{
      "candidate_id":"00000000-0000-4000-8000-00000000a552",
      "provider":"openai","model_id":"gpt-pricing-smoke","risk":"NORMAL",
      "components":[{
        "component_id":"00000000-0000-4000-8000-00000000a553",
        "kind":"INPUT_TOKENS","unit":"PER_MILLION_TOKENS","unit_price":"1.25",
        "currency":"USD","tier_min_inclusive":"0","tier_max_exclusive":null
      }]
    }]
  }'::jsonb
);

select app_data_agent.decide_pricing_candidate(
  '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000a511',
  'MODEL_PRICE',
  pg_catalog.jsonb_build_object(
    'schema_version','pricing-candidate-decision@1.0.0',
    'operation_id','00000000-0000-4000-8000-00000000a554',
    'idempotency_key','pricing-model-price-approve',
    'candidate_id','00000000-0000-4000-8000-00000000a552',
    'decision','APPROVE','reason','verified OpenAI fixture',
    'effective_from',pg_catalog.clock_timestamp() - interval '1 minute'
  )
);

select app_data_agent.apply_model_catalog_command(
  '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000a511',
  '{
    "schema_version":"model-catalog-upsert@1.0.0",
    "operation_id":"00000000-0000-4000-8000-00000000a555",
    "idempotency_key":"pricing-model-activate",
    "model_profile_id":"00000000-0000-4000-8000-00000000a531",
    "provider":"openai","model_id":"gpt-pricing-smoke","display_name":"Pricing Smoke Model",
    "base_url":"https://api.openai.com/v1",
    "capabilities":{"structured_output":true,"tool_calling":true,"streaming":true,"reasoning":true,"vision":false},
    "credential_ref":{
      "schema_version":"global-model-credential-ref@1.0.0",
      "app_id":"00000000-0000-4000-8000-00000000da01","environment":"test",
      "credential_ref_id":"00000000-0000-4000-8000-00000000a556",
      "secret_ref_id":"00000000-0000-4000-8000-00000000a557",
      "secret_version":1,"rotation_state":"ACTIVE"
    },
    "status":"ACTIVE","is_system_default":true,"expected_config_version":1
  }'::jsonb
);

reset role;

select test_support.assert_true(
  (select pg_catalog.count(*) = 1 from app_data_agent.model_catalog_entries),
  '模型目录必须由数据库共享权威记录承载'
);
select test_support.assert_true(
  (select pg_catalog.count(*) = 2 from app_data_agent.model_config_versions),
  '模型命令重放不得重复创建配置版本'
);
select test_support.assert_true(
  (select status = 'ACTIVE' from app_data_agent.model_catalog_entries limit 1),
  '只有完整凭据、价格和汇率链才能激活模型'
);
select test_support.assert_true(
  (select pg_catalog.count(*) = 1 from app_data_agent.model_price_versions where effective_to is null)
  and (select pg_catalog.count(*) = 1 from app_data_agent.fx_rate_versions where effective_to is null),
  '审批必须各自创建一个 active 不可变版本'
);
select test_support.assert_raises(
  $assert$
    update app_data_agent.model_price_components set unit_price = 0.01
  $assert$,
  'PRICING_HISTORY_IMMUTABLE'
);

rollback;
