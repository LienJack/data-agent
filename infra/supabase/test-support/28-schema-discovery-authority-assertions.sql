\set ON_ERROR_STOP on

begin;
set local role data_agent_backend;

select * from platform.revalidate_backend_authority(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,
  'test',
  '00000000-0000-4000-8000-00000000de01'::uuid,
  '00000000-0000-4000-8000-000000001003'::uuid,
  'owner',
  1,
  1,
  true
);
select pg_catalog.set_config('data_agent.app_id', '00000000-0000-4000-8000-00000000da01', true);
select pg_catalog.set_config('data_agent.tenant_id', '00000000-0000-4000-8000-00000000aa22', true);
select pg_catalog.set_config('data_agent.environment', 'test', true);
select pg_catalog.set_config('data_agent.principal_id', '00000000-0000-4000-8000-000000001003', true);
select pg_catalog.set_config('data_agent.role', 'owner', true);
select pg_catalog.set_config('data_agent.deployment_id', '00000000-0000-4000-8000-00000000de01', true);

do $authority$
declare
  first_snapshot jsonb;
  second_snapshot jsonb;
  first_result jsonb;
  replay_result jsonb;
  failure_result jsonb;
  drift_event jsonb;
  drift_result jsonb;
  read_snapshot jsonb;
begin
  first_snapshot := pg_catalog.jsonb_build_object(
    'schema_version', 'physical-schema-snapshot@1.0.0',
    'snapshot_id', '00000000-0000-4000-8000-000000003101',
    'scan_run_id', '00000000-0000-4000-8000-000000003201',
    'snapshot_content_hash', 'sha256:' || pg_catalog.repeat('a', 64),
    'captured_at', '2026-08-09T00:00:00.000Z',
    'content', pg_catalog.jsonb_build_object(
      'schema_version', 'physical-schema-content@1.0.0',
      'datasource_id', 'warehouse-primary',
      'datasource_fingerprint', 'sha256:' || pg_catalog.repeat('f', 64),
      'engine', 'postgresql',
      'engine_version', pg_catalog.jsonb_build_object('major', 17, 'minor', 10),
      'database_identity', pg_catalog.jsonb_build_object(
        'database_name', 'warehouse',
        'database_oid', 16384
      ),
      'included_schemas', pg_catalog.jsonb_build_array('public'),
      'relations', '[]'::jsonb
    )
  );
  first_result := catalog.commit_schema_scan_success(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'warehouse-primary',
    '00000000-0000-4000-8000-000000003301'::uuid,
    'sha256:' || pg_catalog.repeat('1', 64),
    first_snapshot
  );
  replay_result := catalog.commit_schema_scan_success(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'warehouse-primary',
    '00000000-0000-4000-8000-000000003301'::uuid,
    'sha256:' || pg_catalog.repeat('1', 64),
    first_snapshot
  );
  if first_result ->> 'created' <> 'true'
    or replay_result ->> 'created' <> 'false'
    or first_result - 'created' <> replay_result - 'created'
  then
    raise exception 'SCHEMA_DISCOVERY_REPLAY_ASSERTION_FAILED';
  end if;

  begin
    perform catalog.commit_schema_scan_success(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa22'::uuid,
      'test',
      '00000000-0000-4000-8000-000000001003'::uuid,
      'warehouse-primary',
      '00000000-0000-4000-8000-000000003301'::uuid,
      'sha256:' || pg_catalog.repeat('2', 64),
      first_snapshot
    );
    raise exception 'SCHEMA_DISCOVERY_CONFLICT_WAS_NOT_REJECTED';
  exception
    when unique_violation then
      if sqlerrm <> 'SCHEMA_SCAN_IDEMPOTENCY_CONFLICT' then
        raise;
      end if;
  end;

  second_snapshot := pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(
        first_snapshot,
        '{snapshot_id}',
        '"00000000-0000-4000-8000-000000003102"'::jsonb
      ),
      '{scan_run_id}',
      '"00000000-0000-4000-8000-000000003202"'::jsonb
    ),
    '{snapshot_content_hash}',
    ('"sha256:' || pg_catalog.repeat('b', 64) || '"')::jsonb
  );
  perform catalog.commit_schema_scan_success(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'warehouse-primary',
    '00000000-0000-4000-8000-000000003302'::uuid,
    'sha256:' || pg_catalog.repeat('2', 64),
    second_snapshot
  );

  failure_result := catalog.commit_schema_scan_failure(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'warehouse-primary',
    'sha256:' || pg_catalog.repeat('f', 64),
    '00000000-0000-4000-8000-000000003203'::uuid,
    '00000000-0000-4000-8000-000000003303'::uuid,
    'sha256:' || pg_catalog.repeat('3', 64),
    'SCHEMA_SCAN_TIMEOUT',
    '2026-08-09T00:02:00.000Z'::timestamptz
  );
  if failure_result ->> 'terminal' <> 'SCHEMA_SCAN_TIMEOUT' then
    raise exception 'SCHEMA_DISCOVERY_FAILURE_TERMINAL_ASSERTION_FAILED';
  end if;

  drift_event := pg_catalog.jsonb_build_object(
    'schema_version', 'schema-drift-event@1.0.0',
    'drift_event_id', '00000000-0000-4000-8000-000000003401',
    'datasource_id', 'warehouse-primary',
    'datasource_fingerprint', 'sha256:' || pg_catalog.repeat('f', 64),
    'base_snapshot_content_hash', 'sha256:' || pg_catalog.repeat('a', 64),
    'current_snapshot_content_hash', 'sha256:' || pg_catalog.repeat('b', 64),
    'observed_at', '2026-08-09T00:03:00.000Z',
    'severity', 'NONE',
    'binding_impact', 'UNKNOWN',
    'operations', '[]'::jsonb
  );
  drift_result := catalog.commit_schema_drift(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    drift_event
  );
  if drift_result ->> 'created' <> 'true' then
    raise exception 'SCHEMA_DISCOVERY_DRIFT_ASSERTION_FAILED';
  end if;

  read_snapshot := catalog.get_physical_schema_snapshot(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    '00000000-0000-4000-8000-000000003101'::uuid
  );
  if read_snapshot - 'captured_at' <> first_snapshot - 'captured_at'
    or (read_snapshot ->> 'captured_at')::timestamptz
      is distinct from (first_snapshot ->> 'captured_at')::timestamptz
    or catalog.get_schema_drift(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa22'::uuid,
      'test',
      '00000000-0000-4000-8000-000000001003'::uuid,
      'warehouse-primary',
      '00000000-0000-4000-8000-000000003401'::uuid
    ) <> drift_event
  then
    raise exception 'SCHEMA_DISCOVERY_READ_ASSERTION_FAILED';
  end if;

  begin
    perform 1 from catalog.schema_scan_run;
    raise exception 'SCHEMA_DISCOVERY_DIRECT_TABLE_READ_WAS_NOT_REJECTED';
  exception
    when insufficient_privilege then
      null;
  end;
end
$authority$;

commit;

do $immutability$
begin
  begin
    update catalog.schema_scan_run
    set captured_at = captured_at + interval '1 second'
    where scan_run_id = '00000000-0000-4000-8000-000000003201'::uuid;
    raise exception 'SCHEMA_DISCOVERY_SCAN_MUTATION_WAS_NOT_REJECTED';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'SCHEMA_DISCOVERY_AUTHORITY_IMMUTABLE' then
        raise;
      end if;
  end;
  begin
    delete from catalog.physical_schema_snapshot
    where snapshot_content_hash = 'sha256:' || pg_catalog.repeat('a', 64);
    raise exception 'SCHEMA_DISCOVERY_SNAPSHOT_DELETE_WAS_NOT_REJECTED';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'SCHEMA_DISCOVERY_AUTHORITY_IMMUTABLE' then
        raise;
      end if;
  end;
  if (
    select pg_catalog.count(*)
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010623_app_data_agent_schema_discovery'
  ) <> 1 then
    raise exception 'SCHEMA_DISCOVERY_LEDGER_ASSERTION_FAILED';
  end if;
end
$immutability$;

begin;
set local role data_agent_u6_rpc_owner;
select pg_catalog.set_config('data_agent.app_id', '00000000-0000-4000-8000-00000000da01', true);
select pg_catalog.set_config('data_agent.tenant_id', '00000000-0000-4000-8000-00000000aa11', true);
select pg_catalog.set_config('data_agent.environment', 'test', true);
select pg_catalog.set_config('data_agent.principal_id', '00000000-0000-4000-8000-000000001001', true);

do $rls$
declare
  visible_rows bigint;
begin
  select pg_catalog.count(*)
  into visible_rows
  from catalog.schema_scan_run
  where tenant_id = '00000000-0000-4000-8000-00000000aa22'::uuid;
  if visible_rows <> 0 then
    raise exception 'SCHEMA_DISCOVERY_RLS_CROSS_SCOPE_ROW_VISIBLE';
  end if;
end
$rls$;
commit;
