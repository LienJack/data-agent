-- Phase 4: global credit accounts, immutable ledger, holds and rebuild.

begin;

insert into data_agent_auth."user" ("id", "name", "email", "emailVerified") values
  ('00000000-0000-4000-8000-00000000b401', 'Credit Admin', 'credit-admin@example.test', true),
  ('00000000-0000-4000-8000-00000000b402', 'Credit User', 'credit-user@example.test', true);

insert into app_data_agent.app_users (
  app_id, environment, principal_id, auth_user_id, email, display_name, system_role
) values
  (
    '00000000-0000-4000-8000-00000000da01', 'test',
    '00000000-0000-4000-8000-00000000b411',
    '00000000-0000-4000-8000-00000000b401',
    'credit-admin@example.test', 'Credit Admin', 'SUPER_ADMIN'
  ),
  (
    '00000000-0000-4000-8000-00000000da01', 'test',
    '00000000-0000-4000-8000-00000000b412',
    '00000000-0000-4000-8000-00000000b402',
    'credit-user@example.test', 'Credit User', 'USER'
  );

insert into app_data_agent.memberships (
  app_id, tenant_id, environment, principal_id, membership_role,
  workspace_role, membership_source, system_override
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test', '00000000-0000-4000-8000-00000000b412',
  'analyst', 'ANALYST', 'EXPLICIT', false
);

set local role data_agent_backend;

select app_data_agent.apply_credit_adjustment(
  '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000b411',
  '{
    "schema_version":"credit-adjustment@1.0.0",
    "operation_id":"00000000-0000-4000-8000-00000000b421",
    "idempotency_key":"credit-initial-grant",
    "target_principal_id":"00000000-0000-4000-8000-00000000b412",
    "signed_microcredits":"100000000",
    "reason":"initial 100 credits",
    "expected_account_version":1
  }'::jsonb
);

do $assert_idempotency_payload_conflict$
begin
  begin
    perform app_data_agent.apply_credit_adjustment(
      '00000000-0000-4000-8000-00000000de01',
      '00000000-0000-4000-8000-00000000b411',
      '{
        "schema_version":"credit-adjustment@1.0.0",
        "operation_id":"00000000-0000-4000-8000-00000000b421",
        "idempotency_key":"credit-initial-grant",
        "target_principal_id":"00000000-0000-4000-8000-00000000b412",
        "signed_microcredits":"1",
        "reason":"same key with different payload must fail",
        "expected_account_version":2
      }'::jsonb
    );
    raise exception 'CREDIT_IDEMPOTENCY_PAYLOAD_CONFLICT_WAS_NOT_REJECTED';
  exception when unique_violation then
    if sqlerrm <> 'BILLING_OPERATION_CONFLICT' then raise; end if;
  end;
end
$assert_idempotency_payload_conflict$;

select app_data_agent.apply_credit_adjustment(
  '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000b411',
  '{
    "schema_version":"credit-adjustment@1.0.0",
    "operation_id":"00000000-0000-4000-8000-00000000b421",
    "idempotency_key":"credit-initial-grant",
    "target_principal_id":"00000000-0000-4000-8000-00000000b412",
    "signed_microcredits":"100000000",
    "reason":"initial 100 credits",
    "expected_account_version":1
  }'::jsonb
);

do $assert_non_admin_adjustment$
begin
  begin
    perform app_data_agent.apply_credit_adjustment(
      '00000000-0000-4000-8000-00000000de01',
      '00000000-0000-4000-8000-00000000b412',
      '{
        "schema_version":"credit-adjustment@1.0.0",
        "operation_id":"00000000-0000-4000-8000-00000000b422",
        "idempotency_key":"credit-user-forbidden",
        "target_principal_id":"00000000-0000-4000-8000-00000000b412",
        "signed_microcredits":"1",
        "reason":"must fail",
        "expected_account_version":2
      }'::jsonb
    );
    raise exception 'CREDIT_NON_ADMIN_ADJUSTMENT_WAS_NOT_REJECTED';
  exception when insufficient_privilege then
    if sqlerrm <> 'SUPER_ADMIN_REQUIRED' then raise; end if;
  end;
end
$assert_non_admin_adjustment$;

select app_data_agent.reserve_credit_hold(
  '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000b412',
  '{
    "schema_version":"credit-hold-reserve@1.0.0",
    "operation_id":"00000000-0000-4000-8000-00000000b423",
    "idempotency_key":"credit-hold-reserve",
    "hold_id":"00000000-0000-4000-8000-00000000b424",
    "invocation_id":"00000000-0000-4000-8000-00000000b425",
    "workspace_id":"00000000-0000-4000-8000-00000000aa11",
    "reserved_microcredits":"60000000",
    "expected_account_version":2
  }'::jsonb
);

do $assert_no_negative_available$
begin
  begin
    perform app_data_agent.apply_credit_adjustment(
      '00000000-0000-4000-8000-00000000de01',
      '00000000-0000-4000-8000-00000000b411',
      '{
        "schema_version":"credit-adjustment@1.0.0",
        "operation_id":"00000000-0000-4000-8000-00000000b426",
        "idempotency_key":"credit-negative-denied",
        "target_principal_id":"00000000-0000-4000-8000-00000000b412",
        "signed_microcredits":"-50000000",
        "reason":"would consume held funds",
        "expected_account_version":3
      }'::jsonb
    );
    raise exception 'CREDIT_NEGATIVE_AVAILABLE_WAS_NOT_REJECTED';
  exception when check_violation then
    if sqlerrm <> 'CREDIT_AVAILABLE_INSUFFICIENT' then raise; end if;
  end;
  begin
    perform app_data_agent.reserve_credit_hold(
      '00000000-0000-4000-8000-00000000de01',
      '00000000-0000-4000-8000-00000000b412',
      '{
        "schema_version":"credit-hold-reserve@1.0.0",
        "operation_id":"00000000-0000-4000-8000-00000000b427",
        "idempotency_key":"credit-second-hold-denied",
        "hold_id":"00000000-0000-4000-8000-00000000b428",
        "invocation_id":"00000000-0000-4000-8000-00000000b429",
        "workspace_id":"00000000-0000-4000-8000-00000000aa11",
        "reserved_microcredits":"50000000",
        "expected_account_version":3
      }'::jsonb
    );
    raise exception 'CREDIT_OVER_RESERVATION_WAS_NOT_REJECTED';
  exception when check_violation then
    if sqlerrm <> 'CREDIT_AVAILABLE_INSUFFICIENT' then raise; end if;
  end;
end
$assert_no_negative_available$;

select app_data_agent.release_credit_hold(
  '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000b412',
  '{
    "schema_version":"credit-hold-release@1.0.0",
    "operation_id":"00000000-0000-4000-8000-00000000b430",
    "idempotency_key":"credit-hold-release",
    "hold_id":"00000000-0000-4000-8000-00000000b424",
    "reason":"invocation cancelled before start",
    "expected_account_version":3
  }'::jsonb
);

select app_data_agent.apply_credit_adjustment(
  '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000b411',
  '{
    "schema_version":"credit-adjustment@1.0.0",
    "operation_id":"00000000-0000-4000-8000-00000000b431",
    "idempotency_key":"credit-balance-to-zero",
    "target_principal_id":"00000000-0000-4000-8000-00000000b412",
    "signed_microcredits":"-100000000",
    "reason":"close development balance",
    "expected_account_version":4
  }'::jsonb
);

do $assert_global_read_denied$
begin
  begin
    perform platform.list_credit_accounts(
      '00000000-0000-4000-8000-00000000de01',
      '00000000-0000-4000-8000-00000000b412'
    );
    raise exception 'CREDIT_GLOBAL_READ_WAS_NOT_REJECTED';
  exception when insufficient_privilege then
    if sqlerrm <> 'SUPER_ADMIN_REQUIRED' then raise; end if;
  end;
end
$assert_global_read_denied$;

reset role;

select test_support.assert_true(
  (
    select settled_microcredits = 0 and active_held_microcredits = 0
      and available_microcredits = 0 and version = 5
    from app_data_agent.credit_accounts
    where principal_id = '00000000-0000-4000-8000-00000000b412'
  ),
  '调账与 hold 生命周期必须保持非负且版本单调'
);
select test_support.assert_true(
  (select pg_catalog.count(*) = 2 from app_data_agent.credit_ledger_entries
    where principal_id = '00000000-0000-4000-8000-00000000b412')
  and (select pg_catalog.count(*) = 2 from app_data_agent.credit_hold_events
    where hold_id = '00000000-0000-4000-8000-00000000b424'),
  '重放不得重复写账本，hold 必须保留追加事件'
);
select test_support.assert_raises(
  $assert$
    update app_data_agent.credit_ledger_entries set reason = 'tampered'
  $assert$,
  'BILLING_FACT_IMMUTABLE'
);

select pg_catalog.set_config('data_agent.billing_projection_write', 'on', true);
update app_data_agent.credit_accounts set settled_microcredits = 1
where principal_id = '00000000-0000-4000-8000-00000000b412';
select pg_catalog.set_config('data_agent.billing_projection_write', 'off', true);

set local role data_agent_backend;
select app_data_agent.rebuild_credit_account_projection(
  '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000b411',
  '{
    "schema_version":"credit-projection-rebuild@1.0.0",
    "operation_id":"00000000-0000-4000-8000-00000000b432",
    "idempotency_key":"credit-projection-rebuild",
    "target_principal_id":"00000000-0000-4000-8000-00000000b412",
    "reason":"repair injected projection drift",
    "expected_account_version":5
  }'::jsonb
);
select app_data_agent.reconcile_credit_account(
  '00000000-0000-4000-8000-00000000de01',
  '00000000-0000-4000-8000-00000000b412',
  '00000000-0000-4000-8000-00000000b412'
);
reset role;

select test_support.assert_true(
  (
    select settled_microcredits = 0 and active_held_microcredits = 0 and version = 6
    from app_data_agent.credit_accounts
    where principal_id = '00000000-0000-4000-8000-00000000b412'
  ),
  'projection rebuild 必须只从账本和 active holds 恢复余额'
);
select test_support.assert_true(
  (select pg_catalog.count(*) = 5 from app_data_agent.billing_operations)
  and (select pg_catalog.count(*) = 5 from app_data_agent.billing_audit_log),
  '每个成功 mutation 必须同事务写 operation 和 audit'
);

commit;
