-- Local vanilla PostgreSQL binding for the immutable 10590 maintenance migration.
set session transaction_timeout = 0;
select pg_catalog.set_config('lock_timeout', '2000ms', false);
select pg_catalog.set_config('statement_timeout', '300000ms', false);
select pg_catalog.set_config('idle_in_transaction_session_timeout', '60000ms', false);

insert into platform.app_environment_lifecycle (app_id, environment, lifecycle_state)
values ('00000000-0000-4000-8000-00000000da01'::uuid, 'local', 'ACTIVE')
on conflict (app_id, environment) do nothing;

insert into platform.deployment_mappings (
  deployment_id, app_id, environment, deployment_key_hash
)
values (
  '00000000-0000-4000-8000-000000000001'::uuid,
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'local',
  'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
)
on conflict (deployment_id) do nothing;

select pg_catalog.set_config(
  'app.u6_maintenance_manifest_hash',
  'sha256:70b5acaf260521a4b8d8581ca2f33dcebbeb6cd826315d3c246cfa80b35f0723',
  false
);
select pg_catalog.set_config(
  'app.u6_maintenance_window_id',
  '00000000-0000-4000-8000-000000001590',
  false
);
select pg_catalog.set_config(
  'app.u6_maintenance_deployment_id',
  '00000000-0000-4000-8000-000000000001',
  false
);
select pg_catalog.set_config(
  'app.u6_maintenance_window_expires_at',
  (pg_catalog.clock_timestamp() + 600000::bigint * interval '1 millisecond')::text,
  false
);

do $local_maintenance$
declare
  expected_database_identity_hash text;
  remaining_ms bigint;
  arm_ms bigint;
begin
  if not exists (
    select 1
    from platform.deployment_mappings as deployment
    join platform.app_environment_lifecycle as lifecycle
      on lifecycle.app_id = deployment.app_id
     and lifecycle.environment = deployment.environment
    where deployment.deployment_id = '00000000-0000-4000-8000-000000000001'::uuid
      and deployment.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and deployment.environment = 'local'
      and deployment.is_active
      and deployment.revoked_at is null
      and lifecycle.lifecycle_state = 'ACTIVE'
  ) then
    raise exception using errcode = 'P0001', message = 'LOCAL_MAINTENANCE_BINDING_INVALID';
  end if;

  expected_database_identity_hash :=
    'sha256:' || pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to('u6-migration-database@1.0.0', 'UTF8')
        || pg_catalog.decode('00', 'hex')
        || pg_catalog.convert_to(
          app_data_agent.runtime_canonical_json(
            pg_catalog.jsonb_build_array(
              pg_catalog.current_database(),
              '00000000-0000-4000-8000-00000000da01',
              '00000000-0000-4000-8000-000000000001',
              'sha256:28a47b75076c9248621af8dd9d0b16091693a2c44add6f3d0edad6bcff7d0ad4'
            )
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
  perform pg_catalog.set_config(
    'app.u6_maintenance_database_identity_hash',
    expected_database_identity_hash,
    false
  );
  remaining_ms := pg_catalog.floor(
    pg_catalog.date_part(
      'epoch',
      pg_catalog.current_setting('app.u6_maintenance_window_expires_at')::timestamptz
        - pg_catalog.clock_timestamp()
    ) * 1000
  )::bigint;
  arm_ms := remaining_ms - 5000;
  if arm_ms < 30000 then
    raise exception using errcode = '57014', message = 'LOCAL_MAINTENANCE_WINDOW_EXPIRED';
  end if;
  perform pg_catalog.set_config('app.u6_maintenance_session_arm_ms', arm_ms::text, false);
  perform pg_catalog.set_config('transaction_timeout', arm_ms::text || 'ms', false);
end
$local_maintenance$;
