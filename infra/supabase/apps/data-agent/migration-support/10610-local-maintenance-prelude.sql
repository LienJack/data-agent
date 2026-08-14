-- Local vanilla PostgreSQL binding for the immutable 10610 maintenance migration.
set session transaction_timeout = 0;
select pg_catalog.set_config('lock_timeout', '2000ms', false);
select pg_catalog.set_config('statement_timeout', '300000ms', false);
select pg_catalog.set_config('idle_in_transaction_session_timeout', '60000ms', false);
select pg_catalog.set_config(
  'app.semantic_maintenance_manifest_hash',
  'sha256:dc7ec2f69c4feaa4fee583f40395b312cd050bcae9ec2bab2fcf76fc150392c9',
  false
);
select pg_catalog.set_config(
  'app.semantic_maintenance_window_id',
  '00000000-0000-4000-8000-000000001610',
  false
);
select pg_catalog.set_config(
  'app.semantic_maintenance_deployment_id',
  '00000000-0000-4000-8000-000000000001',
  false
);
select pg_catalog.set_config(
  'app.semantic_maintenance_window_expires_at',
  (pg_catalog.clock_timestamp() + 600000::bigint * interval '1 millisecond')::text,
  false
);

do $local_maintenance$
declare
  expected_database_identity_hash text;
  remaining_ms bigint;
  arm_ms bigint;
  baseline_checksum text;
begin
  select ledger.migration_checksum
  into baseline_checksum
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010600_app_data_agent_u6_research_derivation';
  if not found then
    raise exception using errcode = 'P0001', message = 'LOCAL_MAINTENANCE_BASELINE_MISSING';
  end if;

  expected_database_identity_hash :=
    'sha256:' || pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to('semantic-migration-database@1.0.0', 'UTF8')
        || pg_catalog.decode('00', 'hex')
        || pg_catalog.convert_to(
          app_data_agent.runtime_canonical_json(
            pg_catalog.jsonb_build_array(
              pg_catalog.current_database(),
              '00000000-0000-4000-8000-00000000da01',
              '00000000-0000-4000-8000-000000000001',
              baseline_checksum
            )
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
  perform pg_catalog.set_config(
    'app.semantic_maintenance_database_identity_hash',
    expected_database_identity_hash,
    false
  );
  remaining_ms := pg_catalog.floor(
    pg_catalog.date_part(
      'epoch',
      pg_catalog.current_setting('app.semantic_maintenance_window_expires_at')::timestamptz
        - pg_catalog.clock_timestamp()
    ) * 1000
  )::bigint;
  arm_ms := remaining_ms - 5000;
  if arm_ms < 30000 then
    raise exception using errcode = '57014', message = 'LOCAL_MAINTENANCE_WINDOW_EXPIRED';
  end if;
  perform pg_catalog.set_config(
    'app.semantic_maintenance_session_arm_ms',
    arm_ms::text,
    false
  );
  perform pg_catalog.set_config('transaction_timeout', arm_ms::text || 'ms', false);
end
$local_maintenance$;
