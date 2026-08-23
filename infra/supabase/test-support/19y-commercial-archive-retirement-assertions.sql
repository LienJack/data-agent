-- Commercial capabilities are retired; historical rows are frozen and Model Control is independent.

begin;

select test_support.assert_true(
  (
    select (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(relation_snapshots)
      ) = 22
      and (relation_snapshots #>> '{pricing_control_state,row_count}')::bigint >= 1
    from app_data_agent.commercial_archive_retirement_receipts
    where migration_version =
      '20260725010703_app_data_agent_commercial_archive_retirement'
  ),
  'commercial archive receipt must close over all 22 historical relations'
);

select test_support.assert_true(
  (
    select pg_catalog.count(*) = 22
    from pg_catalog.pg_trigger as archive_trigger
    join pg_catalog.pg_class as archive_relation
      on archive_relation.oid = archive_trigger.tgrelid
    where archive_trigger.tgfoid =
      'app_data_agent.reject_commercial_archive_mutation()'::regprocedure
      and not archive_trigger.tgisinternal
      and archive_relation.relname <>
        'commercial_archive_retirement_receipts'
  ),
  'every historical commercial relation must be frozen by the retirement trigger'
);

select test_support.assert_true(
  not pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.pricing_control_state',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.credit_accounts',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  and not pg_catalog.has_table_privilege(
    'data_agent_backend', 'app_data_agent.model_bills',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  'backend role must not directly access the commercial archive'
);

select test_support.assert_raises(
  $assert$
    update app_data_agent.pricing_control_state
    set pricing_epoch = pricing_epoch + 1
    where environment = 'u5-history-probe'
  $assert$,
  'COMMERCIAL_ARCHIVE_READ_ONLY'
);

select test_support.assert_true(
  pg_catalog.to_regprocedure(
    'app_data_agent.submit_pricing_sync(uuid,uuid,jsonb)'
  ) is null
  and pg_catalog.to_regprocedure(
    'app_data_agent.apply_credit_adjustment(uuid,uuid,jsonb)'
  ) is null
  and pg_catalog.to_regprocedure(
    'app_data_agent.authorize_model_billing(uuid,uuid,jsonb)'
  ) is null
  and pg_catalog.to_regprocedure(
    'platform.list_model_price_candidates(uuid,uuid)'
  ) is null
  and pg_catalog.to_regprocedure(
    'platform.list_credit_accounts(uuid,uuid)'
  ) is null
  and pg_catalog.to_regprocedure(
    'platform.get_billing_runtime_state(uuid,uuid)'
  ) is null,
  'retired commercial RPCs must not remain as wrappers or redirects'
);

do $assert_model_control_decoupled$
declare
  target regprocedure;
  definition text;
begin
  foreach target in array array[
    'app_data_agent.apply_model_catalog_command(uuid,uuid,jsonb)'::regprocedure,
    'app_data_agent.apply_model_provider_connection_command(uuid,uuid,jsonb)'::regprocedure,
    'app_data_agent.apply_model_provider_selection(uuid,uuid,jsonb)'::regprocedure,
    'platform.list_active_model_catalog(uuid,uuid)'::regprocedure,
    'platform.sync_environment_model_catalog(uuid,uuid,jsonb)'::regprocedure,
    'platform.sync_environment_model_catalog_unlocked(uuid,uuid,jsonb)'::regprocedure,
    'platform.record_model_api_authentication(uuid,uuid,jsonb)'::regprocedure
  ] loop
    definition := pg_catalog.lower(pg_catalog.pg_get_functiondef(target));
    if definition ~ '(billing|pricing|credit_|model_price|fx_rate|unbillable)' then
      raise exception 'MODEL_CONTROL_COMMERCIAL_DEPENDENCY_REMAINS';
    end if;
  end loop;
end
$assert_model_control_decoupled$;

insert into data_agent_auth."user" (
  "id", "name", "email", "emailVerified", "username", "displayUsername"
) values
  (
    '00000000-0000-4000-8000-00000000a501', 'Model Admin',
    'model-admin@example.test', true, 'model.admin', 'model.admin'
  ),
  (
    '00000000-0000-4000-8000-00000000a502', 'Model User',
    'model-user@example.test', true, 'model.user', 'model.user'
  );

insert into app_data_agent.app_users (
  app_id, environment, principal_id, auth_user_id, email, display_name, system_role
) values
  (
    '00000000-0000-4000-8000-00000000da01', 'test',
    '00000000-0000-4000-8000-00000000a511',
    '00000000-0000-4000-8000-00000000a501',
    'model-admin@example.test', 'Model Admin', 'SUPER_ADMIN'
  ),
  (
    '00000000-0000-4000-8000-00000000da01', 'test',
    '00000000-0000-4000-8000-00000000a512',
    '00000000-0000-4000-8000-00000000a502',
    'model-user@example.test', 'Model User', 'USER'
  );

set local role data_agent_backend;

select app_data_agent.apply_model_catalog_command(
  '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000a511',
  '{
    "schema_version":"model-catalog-upsert@1.0.0",
    "operation_id":"00000000-0000-4000-8000-00000000a521",
    "idempotency_key":"model-control-create",
    "model_profile_id":"00000000-0000-4000-8000-00000000a531",
    "provider":"openai",
    "model_id":"gpt-model-control-smoke",
    "display_name":"Model Control Smoke",
    "base_url":"https://api.openai.com/v1",
    "capabilities":{"structured_output":true,"tool_calling":true,"streaming":true,"reasoning":true,"vision":false},
    "credential_ref":null,
    "status":"ACTIVE",
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
    "idempotency_key":"model-control-create",
    "model_profile_id":"00000000-0000-4000-8000-00000000a531",
    "provider":"openai",
    "model_id":"gpt-model-control-smoke",
    "display_name":"Model Control Smoke",
    "base_url":"https://api.openai.com/v1",
    "capabilities":{"structured_output":true,"tool_calling":true,"streaming":true,"reasoning":true,"vision":false},
    "credential_ref":null,
    "status":"ACTIVE",
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
        "idempotency_key":"model-user-denied",
        "model_profile_id":"00000000-0000-4000-8000-00000000a531",
        "status":"DISABLED",
        "expected_config_version":1
      }'::jsonb
    );
    raise exception 'MODEL_NON_ADMIN_MUTATION_WAS_NOT_REJECTED';
  exception when insufficient_privilege then
    if sqlerrm <> 'SUPER_ADMIN_REQUIRED' then raise; end if;
  end;
end
$assert_non_admin$;

reset role;

select test_support.assert_true(
  (
    select status = 'ACTIVE' and config_version = 1
    from app_data_agent.model_catalog_entries
    where model_profile_id = '00000000-0000-4000-8000-00000000a531'
  )
  and (
    select pg_catalog.count(*) = 1
    from app_data_agent.model_config_versions
    where model_profile_id = '00000000-0000-4000-8000-00000000a531'
  )
  and (
    select pg_catalog.count(*) = 1
    from app_data_agent.model_control_operations
    where operation_id = '00000000-0000-4000-8000-00000000a521'
  )
  and (
    select pg_catalog.count(*) = 1
    from app_data_agent.model_control_audit_log
    where operation_id = '00000000-0000-4000-8000-00000000a521'
  ),
  'Model Control must activate without commercial state and replay idempotently'
);

select test_support.assert_raises(
  $assert$
    update app_data_agent.model_control_operations
    set result_payload = '{}'::jsonb
    where operation_id = '00000000-0000-4000-8000-00000000a521'
  $assert$,
  'MODEL_CONTROL_HISTORY_IMMUTABLE'
);

rollback;
