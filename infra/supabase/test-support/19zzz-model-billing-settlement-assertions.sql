-- Phase 5: price snapshot, Shadow/System funding, Enforced hold and review settlement.

begin;

insert into app_data_agent.memberships (
  app_id,tenant_id,environment,principal_id,membership_role,
  workspace_role,membership_source,system_override
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
  'test','00000000-0000-4000-8000-00000000b411','owner',
  'WORKSPACE_ADMIN','SYSTEM_ROLE',true
);

insert into app_data_agent.datasource_connections (
  app_id,tenant_id,environment,datasource_id,name,datasource_type,file_path,
  status,created_by_principal_id
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
  'test','00000000-0000-4000-8000-00000000c501','Billing Fixture','sqlite',
  '/tmp/data-agent-billing-fixture.sqlite','ACTIVE','00000000-0000-4000-8000-00000000b412'
);

insert into app_data_agent.model_catalog_entries (
  app_id,environment,model_profile_id,provider,model_id,display_name,base_url,
  capabilities,credential_ref,status,config_version,is_system_default,created_by
) values (
  '00000000-0000-4000-8000-00000000da01','test',
  '00000000-0000-4000-8000-00000000c502','openai','gpt-billing-smoke',
  'Billing Smoke Model','https://api.openai.com/v1',
  '{"structured_output":true,"tool_calling":true,"streaming":true,"reasoning":true,"vision":false}',
  '{"schema_version":"global-model-credential-ref@1.0.0","app_id":"00000000-0000-4000-8000-00000000da01","environment":"test","credential_ref_id":"00000000-0000-4000-8000-00000000c503","secret_ref_id":"00000000-0000-4000-8000-00000000c504","secret_version":1,"rotation_state":"ACTIVE"}',
  'ACTIVE',1,false,'00000000-0000-4000-8000-00000000b411'
);
insert into app_data_agent.model_config_versions (
  app_id,environment,model_profile_id,config_version,snapshot,actor_principal_id
) values (
  '00000000-0000-4000-8000-00000000da01','test',
  '00000000-0000-4000-8000-00000000c502',1,
  '{"provider":"openai","model_id":"gpt-billing-smoke","status":"ACTIVE"}',
  '00000000-0000-4000-8000-00000000b411'
);
insert into app_data_agent.pricing_sync_operations (
  app_id,environment,operation_id,actor_principal_id,source_kind,source_adapter,
  source_url,input_hash,evidence_hash,parser_version,status,fetched_at,raw_evidence,
  result_payload,error_code
) values
  (
    '00000000-0000-4000-8000-00000000da01','test',
    '00000000-0000-4000-8000-00000000c505','00000000-0000-4000-8000-00000000b411',
    'MODEL_PRICE','billing-fixture@1.0.0','https://openai.com/api/pricing/',
    'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    'billing-fixture@1.0.0','SUCCEEDED',pg_catalog.clock_timestamp(),
    'billing price fixture','{}',null
  ),
  (
    '00000000-0000-4000-8000-00000000da01','test',
    '00000000-0000-4000-8000-00000000c506','00000000-0000-4000-8000-00000000b411',
    'FX_RATE','billing-fixture@1.0.0','https://www.chinamoney.com.cn/',
    'sha256:3333333333333333333333333333333333333333333333333333333333333333',
    'sha256:4444444444444444444444444444444444444444444444444444444444444444',
    'billing-fixture@1.0.0','SUCCEEDED',pg_catalog.clock_timestamp(),
    'billing fx fixture','{}',null
  );
insert into app_data_agent.model_price_candidates (
  app_id,environment,candidate_id,provider,model_id,status,source_url,evidence_hash,
  parser_version,fetched_at,risk,source_operation_id,reviewed_by,reviewed_at,review_reason
) values (
  '00000000-0000-4000-8000-00000000da01','test',
  '00000000-0000-4000-8000-00000000c507','openai','gpt-billing-smoke','APPROVED',
  'https://openai.com/api/pricing/',
  'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  'billing-fixture@1.0.0',pg_catalog.clock_timestamp(),'NORMAL',
  '00000000-0000-4000-8000-00000000c505','00000000-0000-4000-8000-00000000b411',
  pg_catalog.clock_timestamp(),'fixture approved'
);
insert into app_data_agent.model_price_versions (
  app_id,environment,price_version_id,source_candidate_id,provider,model_id,
  approved_by,approved_at,effective_from
) values (
  '00000000-0000-4000-8000-00000000da01','test',
  '00000000-0000-4000-8000-00000000c508','00000000-0000-4000-8000-00000000c507',
  'openai','gpt-billing-smoke','00000000-0000-4000-8000-00000000b411',
  pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp() - interval '1 minute'
);
insert into app_data_agent.model_price_components (
  app_id,environment,price_version_id,component_id,kind,unit,unit_price,currency,
  tier_min_inclusive,tier_max_exclusive
) values (
  '00000000-0000-4000-8000-00000000da01','test',
  '00000000-0000-4000-8000-00000000c508','00000000-0000-4000-8000-00000000c509',
  'INPUT_TOKENS','PER_MILLION_TOKENS',1.25,'USD',0,null
);
insert into app_data_agent.fx_rate_candidates (
  app_id,environment,candidate_id,base_currency,quote_currency,rate,official_date,
  source_url,evidence_hash,parser_version,fetched_at,status,source_operation_id,
  reviewed_by,reviewed_at,review_reason
) values (
  '00000000-0000-4000-8000-00000000da01','test',
  '00000000-0000-4000-8000-00000000c510','USD','CNY',7.1,'2026-08-14',
  'https://www.chinamoney.com.cn/',
  'sha256:4444444444444444444444444444444444444444444444444444444444444444',
  'billing-fixture@1.0.0',pg_catalog.clock_timestamp(),'APPROVED',
  '00000000-0000-4000-8000-00000000c506','00000000-0000-4000-8000-00000000b411',
  pg_catalog.clock_timestamp(),'fixture approved'
);
insert into app_data_agent.fx_rate_versions (
  app_id,environment,fx_version_id,source_candidate_id,base_currency,quote_currency,
  rate,approved_by,approved_at,effective_from
) values (
  '00000000-0000-4000-8000-00000000da01','test',
  '00000000-0000-4000-8000-00000000c511','00000000-0000-4000-8000-00000000c510',
  'USD','CNY',7.1,'00000000-0000-4000-8000-00000000b411',
  pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp() - interval '1 minute'
);

insert into app_data_agent.runs (
  app_id,tenant_id,environment,run_id,principal_id,question
) values
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test','00000000-0000-4000-8000-00000000c521','00000000-0000-4000-8000-00000000b412','shadow billing fixture'),
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test','00000000-0000-4000-8000-00000000c522','00000000-0000-4000-8000-00000000b412','enforced billing fixture'),
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test','00000000-0000-4000-8000-00000000c523','00000000-0000-4000-8000-00000000b411','system funded fixture');
insert into app_data_agent.workspace_run_bindings (
  app_id,tenant_id,environment,run_id,datasource_id,conversation_id,principal_id
) values
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test','00000000-0000-4000-8000-00000000c521','00000000-0000-4000-8000-00000000c501',null,'00000000-0000-4000-8000-00000000b412'),
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test','00000000-0000-4000-8000-00000000c522','00000000-0000-4000-8000-00000000c501',null,'00000000-0000-4000-8000-00000000b412'),
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test','00000000-0000-4000-8000-00000000c523','00000000-0000-4000-8000-00000000c501',null,'00000000-0000-4000-8000-00000000b411');
insert into app_data_agent.research_resource_reservations (
  app_id,tenant_id,environment,reservation_id,run_id,principal_id,reservation_seq,
  reserve_idempotency_key,reserve_input_hash,research_brief_ref,resource_kind,
  requested_json,reserved_json,state,reservation_expires_at
) values
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test','00000000-0000-4000-8000-00000000c531','00000000-0000-4000-8000-00000000c521','00000000-0000-4000-8000-00000000b412',1,'billing-shadow-reserve','sha256:5555555555555555555555555555555555555555555555555555555555555555','{}','MODEL','{}','{}','RESERVED',pg_catalog.clock_timestamp()+interval '1 hour'),
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test','00000000-0000-4000-8000-00000000c532','00000000-0000-4000-8000-00000000c522','00000000-0000-4000-8000-00000000b412',1,'billing-enforced-reserve','sha256:6666666666666666666666666666666666666666666666666666666666666666','{}','MODEL','{}','{}','RESERVED',pg_catalog.clock_timestamp()+interval '1 hour'),
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test','00000000-0000-4000-8000-00000000c533','00000000-0000-4000-8000-00000000c523','00000000-0000-4000-8000-00000000b411',1,'billing-system-reserve','sha256:7777777777777777777777777777777777777777777777777777777777777777','{}','MODEL','{}','{}','RESERVED',pg_catalog.clock_timestamp()+interval '1 hour');

set local role data_agent_backend;

select app_data_agent.authorize_model_billing(
  '00000000-0000-4000-8000-00000000de01','00000000-0000-4000-8000-00000000b412',
  '{"schema_version":"model-billing-authorize@1.0.0","operation_id":"00000000-0000-4000-8000-00000000c541","idempotency_key":"billing-shadow-authorize","bill_id":"00000000-0000-4000-8000-00000000c542","invocation_id":"00000000-0000-4000-8000-00000000c543","reservation_id":"00000000-0000-4000-8000-00000000c531","workspace_id":"00000000-0000-4000-8000-00000000aa11","run_id":"00000000-0000-4000-8000-00000000c521","conversation_id":null,"datasource_id":"00000000-0000-4000-8000-00000000c501","model_profile_id":"00000000-0000-4000-8000-00000000c502","expected_model_config_version":1,"request_budget":{"input_tokens":"1000","output_tokens":"0","cache_read_tokens":"0","cache_write_tokens":"0","tool_calls":"0"},"expected_account_version":6}'::jsonb
);
select app_data_agent.finalize_model_billing(
  '00000000-0000-4000-8000-00000000de01','00000000-0000-4000-8000-00000000b412',
  '{"schema_version":"model-billing-finalize@1.0.0","operation_id":"00000000-0000-4000-8000-00000000c544","idempotency_key":"billing-shadow-cancel","bill_id":"00000000-0000-4000-8000-00000000c542","terminal_kind":"CANCELLED_BEFORE_START","outcome_usage_record_id":null}'::jsonb
);
select app_data_agent.authorize_model_billing(
  '00000000-0000-4000-8000-00000000de01','00000000-0000-4000-8000-00000000b412',
  '{"schema_version":"model-billing-authorize@1.0.0","operation_id":"00000000-0000-4000-8000-00000000c541","idempotency_key":"billing-shadow-authorize","bill_id":"00000000-0000-4000-8000-00000000c542","invocation_id":"00000000-0000-4000-8000-00000000c543","reservation_id":"00000000-0000-4000-8000-00000000c531","workspace_id":"00000000-0000-4000-8000-00000000aa11","run_id":"00000000-0000-4000-8000-00000000c521","conversation_id":null,"datasource_id":"00000000-0000-4000-8000-00000000c501","model_profile_id":"00000000-0000-4000-8000-00000000c502","expected_model_config_version":1,"request_budget":{"input_tokens":"1000","output_tokens":"0","cache_read_tokens":"0","cache_write_tokens":"0","tool_calls":"0"},"expected_account_version":6}'::jsonb
);

reset role;
create temporary table model_billing_account_baseline on commit drop as
select version,settled_microcredits,active_held_microcredits
from app_data_agent.credit_accounts
where app_id='00000000-0000-4000-8000-00000000da01'
  and environment='test'
  and principal_id='00000000-0000-4000-8000-00000000b412';
grant select on model_billing_account_baseline to data_agent_backend;
set local role data_agent_backend;

select app_data_agent.apply_credit_adjustment(
  '00000000-0000-4000-8000-00000000de01','00000000-0000-4000-8000-00000000b411',
  pg_catalog.jsonb_build_object(
    'schema_version','credit-adjustment@1.0.0',
    'operation_id','00000000-0000-4000-8000-00000000c545',
    'idempotency_key','billing-enforced-grant',
    'target_principal_id','00000000-0000-4000-8000-00000000b412',
    'signed_microcredits','10000000',
    'reason','enforced billing fixture',
    'expected_account_version',(select version from model_billing_account_baseline)
  )
);

reset role;
select pg_catalog.set_config('data_agent.model_billing_projection_write','on',true);
update app_data_agent.billing_runtime_state set mode='ENFORCED',epoch=epoch+1,
  approved_by='00000000-0000-4000-8000-00000000b411',approved_at=pg_catalog.clock_timestamp()
where deployment_id='00000000-0000-4000-8000-00000000de01';
select pg_catalog.set_config('data_agent.model_billing_projection_write','off',true);

set local role data_agent_backend;
select app_data_agent.authorize_model_billing(
  '00000000-0000-4000-8000-00000000de01','00000000-0000-4000-8000-00000000b412',
  '{"schema_version":"model-billing-authorize@1.0.0","operation_id":"00000000-0000-4000-8000-00000000c546","idempotency_key":"billing-enforced-authorize","bill_id":"00000000-0000-4000-8000-00000000c547","invocation_id":"00000000-0000-4000-8000-00000000c548","reservation_id":"00000000-0000-4000-8000-00000000c532","workspace_id":"00000000-0000-4000-8000-00000000aa11","run_id":"00000000-0000-4000-8000-00000000c522","conversation_id":null,"datasource_id":"00000000-0000-4000-8000-00000000c501","model_profile_id":"00000000-0000-4000-8000-00000000c502","expected_model_config_version":1,"request_budget":{"input_tokens":"1000","output_tokens":"0","cache_read_tokens":"0","cache_write_tokens":"0","tool_calls":"0"}}'::jsonb
    || pg_catalog.jsonb_build_object(
      'expected_account_version',(select version+1 from model_billing_account_baseline)
    )
);
reset role;

select pg_catalog.set_config('data_agent.billing_projection_write','on',true);
update app_data_agent.credit_holds set state='REVIEW_REQUIRED'
where hold_id='00000000-0000-4000-8000-00000000c547';
select pg_catalog.set_config('data_agent.billing_projection_write','off',true);
select pg_catalog.set_config('data_agent.model_billing_projection_write','on',true);
update app_data_agent.model_bills set state='REVIEW_REQUIRED',review_reason='PROVIDER_OUTCOME_UNKNOWN'
where bill_id='00000000-0000-4000-8000-00000000c547';
select pg_catalog.set_config('data_agent.model_billing_projection_write','off',true);
insert into app_data_agent.credit_hold_events (
  app_id,environment,hold_id,event_sequence,event_kind,reserved_microcredits,
  actor_principal_id,reason
) values (
  '00000000-0000-4000-8000-00000000da01','test','00000000-0000-4000-8000-00000000c547',
  2,'REVIEW_REQUIRED',887500,'00000000-0000-4000-8000-00000000b412','fixture review'
);
insert into app_data_agent.model_bill_events (
  app_id,environment,bill_id,event_sequence,event_kind,actor_principal_id,reason,details
) values (
  '00000000-0000-4000-8000-00000000da01','test','00000000-0000-4000-8000-00000000c547',
  2,'REVIEW_REQUIRED','00000000-0000-4000-8000-00000000b412','PROVIDER_OUTCOME_UNKNOWN','{}'
);

set local role data_agent_backend;
select app_data_agent.review_model_billing(
  '00000000-0000-4000-8000-00000000de01','00000000-0000-4000-8000-00000000b411',
  '{"schema_version":"model-billing-review@1.0.0","operation_id":"00000000-0000-4000-8000-00000000c549","idempotency_key":"billing-review-settle","bill_id":"00000000-0000-4000-8000-00000000c547","decision":"SETTLE_VERIFIED","verified_usage":{"input_tokens":"100","output_tokens":"0","cache_read_tokens":"0","cache_write_tokens":"0","tool_calls":"0"},"reason":"provider invoice verified"}'::jsonb
);
select app_data_agent.authorize_model_billing(
  '00000000-0000-4000-8000-00000000de01','00000000-0000-4000-8000-00000000b411',
  '{"schema_version":"model-billing-authorize@1.0.0","operation_id":"00000000-0000-4000-8000-00000000c550","idempotency_key":"billing-system-authorize","bill_id":"00000000-0000-4000-8000-00000000c551","invocation_id":"00000000-0000-4000-8000-00000000c552","reservation_id":"00000000-0000-4000-8000-00000000c533","workspace_id":"00000000-0000-4000-8000-00000000aa11","run_id":"00000000-0000-4000-8000-00000000c523","conversation_id":null,"datasource_id":"00000000-0000-4000-8000-00000000c501","model_profile_id":"00000000-0000-4000-8000-00000000c502","expected_model_config_version":1,"request_budget":{"input_tokens":"1000","output_tokens":"0","cache_read_tokens":"0","cache_write_tokens":"0","tool_calls":"0"},"expected_account_version":1}'::jsonb
);
select app_data_agent.finalize_model_billing(
  '00000000-0000-4000-8000-00000000de01','00000000-0000-4000-8000-00000000b411',
  '{"schema_version":"model-billing-finalize@1.0.0","operation_id":"00000000-0000-4000-8000-00000000c553","idempotency_key":"billing-system-cancel","bill_id":"00000000-0000-4000-8000-00000000c551","terminal_kind":"CANCELLED_BEFORE_START","outcome_usage_record_id":null}'::jsonb
);
reset role;

select test_support.assert_true(
  (select state='RELEASED' and billing_mode='SHADOW' and hold_id is null
   from app_data_agent.model_bills where bill_id='00000000-0000-4000-8000-00000000c542')
  and (select pg_catalog.count(*)=1 from app_data_agent.model_bills
       where bill_id='00000000-0000-4000-8000-00000000c542'),
  'Shadow 必须生成唯一账单但不创建积分 hold，幂等重放不重复'
);
select test_support.assert_true(
  (select state='SETTLED' and charged_microcredits=88750 and cny_cost=0.0008875
   from app_data_agent.model_bills where bill_id='00000000-0000-4000-8000-00000000c547')
  and (select state='SETTLED' and reserved_microcredits=887500
       from app_data_agent.credit_holds where hold_id='00000000-0000-4000-8000-00000000c547')
  and (select account.settled_microcredits=baseline.settled_microcredits+9911250
         and account.active_held_microcredits=baseline.active_held_microcredits
         and account.available_microcredits >= 0 and account.version=baseline.version+3
       from app_data_agent.credit_accounts as account
       cross join model_billing_account_baseline as baseline
       where account.principal_id='00000000-0000-4000-8000-00000000b412'),
  'Enforced 复核结算必须扣实际费用并释放冻结差额且不产生负余额'
);
select test_support.assert_true(
  (select funding_type='SYSTEM_FUNDED' and hold_id is null and state='RELEASED'
   from app_data_agent.model_bills where bill_id='00000000-0000-4000-8000-00000000c551')
  and (select settled_microcredits=0 and active_held_microcredits=0 and version=1
       from app_data_agent.credit_accounts where principal_id='00000000-0000-4000-8000-00000000b411'),
  '超级管理员账单必须保留成本路径但不改变积分账户'
);
select test_support.assert_raises(
  $assert$ update app_data_agent.model_bill_events set reason='tampered' $assert$,
  'BILLING_FACT_IMMUTABLE'
);
select test_support.assert_true(
  not pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.model_bills','SELECT,INSERT,UPDATE,DELETE')
  and pg_catalog.has_function_privilege(
    'data_agent_backend','app_data_agent.authorize_model_billing(uuid,uuid,jsonb)','EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.resolve_model_billing_terminal_authority(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'Backend 只能执行模型计费窄函数，不能直接 CRUD 账单'
);

commit;
