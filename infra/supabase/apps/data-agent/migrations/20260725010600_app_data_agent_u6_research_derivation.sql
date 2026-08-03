-- u6_c2_migration_checksum: sha256:b435ef8e3a918b9e99781b6fd49767d7ea21ff5df781ddd7efe78a122b50ba6d
begin;

do $bootstrap$
declare
  session_arm_ms bigint;
  arm_now timestamptz;
  window_expires_at timestamptz;
  effective_budget_ms bigint;
  rearm_verified_at timestamptz;
  requested_deployment_id uuid;
  observed_database_identity_hash text;
  expected_database_identity_hash text;
  executor record;
  transaction_setting bigint;
  baseline_migration record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'U6_MIGRATION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'U6_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'U6_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_extension as extension
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = extension.extnamespace
    where extension.extname = 'pgcrypto'
      and namespace.nspname = 'extensions'
  ) then
    raise exception using errcode = '0A000', message = 'U6_MIGRATION_PGCRYPTO_REQUIRED';
  end if;

  if pg_catalog.current_setting('app.u6_maintenance_manifest_hash', true)
       is distinct from 'sha256:d28f8ac324e5453961c2636a7741c1feb36709908f84c7f03f9b9454ed87cced'
    or pg_catalog.current_setting('app.u6_maintenance_window_id', true)
       is distinct from '00000000-0000-4000-8000-000000001600'
  then
    raise exception using errcode = '22023', message = 'U6_MIGRATION_MAINTENANCE_BINDING_INVALID';
  end if;

  begin
    session_arm_ms :=
      pg_catalog.current_setting('app.u6_maintenance_session_arm_ms', true)::bigint;
    window_expires_at :=
      pg_catalog.current_setting('app.u6_maintenance_window_expires_at', true)::timestamptz;
    requested_deployment_id :=
      pg_catalog.current_setting('app.u6_maintenance_deployment_id', true)::uuid;
    observed_database_identity_hash :=
      pg_catalog.current_setting('app.u6_maintenance_database_identity_hash', true);
  exception
    when invalid_text_representation or null_value_not_allowed then
      raise exception using errcode = '22023', message = 'U6_MIGRATION_MAINTENANCE_BINDING_INVALID';
  end;

  select setting::bigint
  into transaction_setting
  from pg_catalog.pg_settings
  where name = 'transaction_timeout' and unit = 'ms';
  if not found or transaction_setting <> session_arm_ms then
    raise exception using errcode = '22023', message = 'U6_MIGRATION_TRANSACTION_ARM_INVALID';
  end if;

  arm_now := pg_catalog.clock_timestamp();
  effective_budget_ms :=
    pg_catalog.floor(
      pg_catalog.date_part('epoch', window_expires_at - arm_now) * 1000
    )::bigint - 5000;
  if effective_budget_ms not between 30000 and 600000 then
    raise exception using errcode = '57014', message = 'U6_MIGRATION_WINDOW_EXPIRED';
  end if;

  perform pg_catalog.set_config('transaction_timeout', '0', true);
  select setting::bigint
  into transaction_setting
  from pg_catalog.pg_settings
  where name = 'transaction_timeout' and unit = 'ms';
  if transaction_setting <> 0 then
    raise exception using errcode = '22023', message = 'U6_MIGRATION_TRANSACTION_REARM_FAILED';
  end if;
  perform pg_catalog.set_config(
    'transaction_timeout',
    effective_budget_ms::text || 'ms',
    true
  );
  select setting::bigint
  into transaction_setting
  from pg_catalog.pg_settings
  where name = 'transaction_timeout' and unit = 'ms';
  if transaction_setting <> effective_budget_ms then
    raise exception using errcode = '22023', message = 'U6_MIGRATION_TRANSACTION_REARM_FAILED';
  end if;
  rearm_verified_at := pg_catalog.clock_timestamp();
  if rearm_verified_at + effective_budget_ms * interval '1 millisecond' > window_expires_at then
    raise exception using errcode = '57014', message = 'U6_MIGRATION_WINDOW_EXPIRED';
  end if;

  -- Verify 10590 baseline is installed and immutable
  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010590_app_data_agent_u6_research_authority';
  if not found then
    raise exception using errcode = 'P0001', message = 'U6_MIGRATION_BASELINE_MISSING';
  end if;
  if exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010600_app_data_agent_u6_research_derivation'
  ) then
    raise exception using errcode = 'P0001', message = 'U6_MIGRATION_ALREADY_RECORDED';
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
              requested_deployment_id::text,
              baseline_migration.migration_checksum
            )
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
  if observed_database_identity_hash is distinct from expected_database_identity_hash then
    raise exception using errcode = '22023', message = 'U6_MIGRATION_DATABASE_BINDING_INVALID';
  end if;
  if not exists (
    select 1
    from platform.deployment_mappings as deployment
    join platform.app_environment_lifecycle as lifecycle
      on lifecycle.app_id = deployment.app_id
     and lifecycle.environment = deployment.environment
    where deployment.deployment_id = requested_deployment_id
      and deployment.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and deployment.is_active
      and lifecycle.lifecycle_state = 'ACTIVE'
  ) then
    raise exception using errcode = '42501', message = 'U6_MIGRATION_DEPLOYMENT_INACTIVE';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';

do $executor_visibility$
declare
  qualified_name text;
  relation_owner name;
begin
  foreach qualified_name in array array[
    'app_data_agent.artifacts',
    'app_data_agent.memberships',
    'app_data_agent.outbox',
    'app_data_agent.run_attempts',
    'app_data_agent.runs',
    'app_data_agent.research_artifact_commit_operations',
    'app_data_agent.research_authority_capabilities',
    'app_data_agent.research_domain_terminals',
    'app_data_agent.research_resource_reservations',
    'app_data_agent.research_resource_run_heads',
    'app_data_agent.research_stop_terminal_commits',
    'platform.app_environment_lifecycle',
    'platform.deployment_mappings'
  ]
  loop
    select owner.rolname
    into relation_owner
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    join pg_catalog.pg_roles as owner on owner.oid = relation.relowner
    where namespace.nspname || '.' || relation.relname = qualified_name
      and relation.relkind = 'r';
    if not found
      or not pg_catalog.has_table_privilege(session_user, qualified_name, 'SELECT')
      or not pg_catalog.pg_has_role(session_user, relation_owner, 'USAGE')
    then
      raise exception using errcode = '42501', message = 'U6_MIGRATION_EXECUTOR_UNSAFE';
    end if;
  end loop;
end
$executor_visibility$;

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);

lock table
  app_data_agent.artifacts,
  app_data_agent.memberships,
  app_data_agent.outbox,
  app_data_agent.run_attempts,
  app_data_agent.runs,
  app_data_agent.research_artifact_commit_operations,
  app_data_agent.research_authority_capabilities,
  app_data_agent.research_domain_terminals,
  app_data_agent.research_resource_reservations,
  app_data_agent.research_resource_run_heads,
  app_data_agent.research_stop_terminal_commits,
  platform.app_environment_lifecycle,
  platform.deployment_mappings
in access exclusive mode nowait;
-- ============================================================
-- 10600: Existing table alterations (11 tables, 6 DDL changes)
-- ============================================================

-- Preflight: Add operation_json to research_stop_terminal_commits (needed by preflight check and RPCs)
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname = 'research_stop_terminal_commits'
      and attribute.attname = 'operation_json'
  ) then
    alter table app_data_agent.research_stop_terminal_commits
      add column operation_json jsonb;
  end if;
end $$;

-- Preflight: Add document_json to research_artifact_commit_operations (needed by preflight check and backfill)
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname = 'research_artifact_commit_operations'
      and attribute.attname = 'document_json'
  ) then
    alter table app_data_agent.research_artifact_commit_operations
      add column document_json jsonb;
  end if;
end $$;

-- Backfill document_json from candidate_json for existing rows
do $$
begin
  update app_data_agent.research_artifact_commit_operations as operation
  set document_json = operation.candidate_json
  where operation.document_json is null;
end $$;

do $capacity_and_data_preflight$
declare
  violation_count bigint;
begin
  if pg_catalog.pg_total_relation_size('app_data_agent.artifacts'::regclass) > 1073741824
    or pg_catalog.pg_total_relation_size('app_data_agent.memberships'::regclass) > 1073741824
    or pg_catalog.pg_total_relation_size('app_data_agent.outbox'::regclass) > 1073741824
    or pg_catalog.pg_total_relation_size('app_data_agent.run_attempts'::regclass) > 1073741824
    or pg_catalog.pg_total_relation_size('app_data_agent.runs'::regclass) > 1073741824
    or pg_catalog.pg_total_relation_size('app_data_agent.research_artifact_commit_operations'::regclass) > 536870912
    or pg_catalog.pg_total_relation_size('app_data_agent.research_authority_capabilities'::regclass) > 536870912
    or pg_catalog.pg_total_relation_size('app_data_agent.research_domain_terminals'::regclass) > 536870912
    or pg_catalog.pg_total_relation_size('app_data_agent.research_resource_reservations'::regclass) > 536870912
    or pg_catalog.pg_total_relation_size('app_data_agent.research_resource_run_heads'::regclass) > 536870912
    or pg_catalog.pg_total_relation_size('app_data_agent.research_stop_terminal_commits'::regclass) > 536870912
    or pg_catalog.pg_total_relation_size('platform.app_environment_lifecycle'::regclass) > 1073741824
    or pg_catalog.pg_total_relation_size('platform.deployment_mappings'::regclass) > 1073741824
  then
    raise exception using
      errcode = '54000',
      message = 'U6_MIGRATION_RELATION_LIMIT_EXCEEDED';
  end if;

  if (select pg_catalog.count(*) from app_data_agent.artifacts) > 1000000
    or (select pg_catalog.count(*) from app_data_agent.memberships) > 1000000
    or (select pg_catalog.count(*) from app_data_agent.outbox) > 1000000
    or (select pg_catalog.count(*) from app_data_agent.run_attempts) > 1000000
    or (select pg_catalog.count(*) from app_data_agent.runs) > 1000000
    or (select pg_catalog.count(*) from app_data_agent.research_artifact_commit_operations) > 500000
    or (select pg_catalog.count(*) from app_data_agent.research_authority_capabilities) > 500000
    or (select pg_catalog.count(*) from app_data_agent.research_domain_terminals) > 500000
    or (select pg_catalog.count(*) from app_data_agent.research_resource_reservations) > 500000
    or (select pg_catalog.count(*) from app_data_agent.research_resource_run_heads) > 500000
    or (select pg_catalog.count(*) from app_data_agent.research_stop_terminal_commits) > 500000
    or (select pg_catalog.count(*) from platform.app_environment_lifecycle) > 1000000
    or (select pg_catalog.count(*) from platform.deployment_mappings) > 1000000
  then
    raise exception using
      errcode = '54000',
      message = 'U6_MIGRATION_RELATION_LIMIT_EXCEEDED';
  end if;

  -- Preflight: No pre-C2 stop terminal commits with non-null v2 operation columns
  if exists (
    select 1
    from app_data_agent.research_stop_terminal_commits as stop
    where stop.operation_json #>> '{payload,protocol_version}' in (
      'research-stop@2.0.0',
      'research-stop-derivation-receipt@2.0.0'
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'U6_MIGRATION_PREFLIGHT_V2_STOP_OPERATION_EXISTS';
  end if;

  -- Preflight: No pre-C2 research_domain_terminals with RESEARCH_STOP authority_kind
  if exists (
    select 1
    from app_data_agent.research_domain_terminals as terminal
    where terminal.authority_kind = 'RESEARCH_STOP'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'U6_MIGRATION_PREFLIGHT_RESEARCH_STOP_TERMINAL_EXISTS';
  end if;

  -- Preflight: No artifact commit operations with v2 wire protocol
  if exists (
    select 1
    from app_data_agent.research_artifact_commit_operations as operation
    where operation.document_json #>> '{payload,protocol_version}' in (
      'candidate-enumeration-receipt@2.0.0',
      'research-stop-derivation-receipt@2.0.0'
    )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'U6_MIGRATION_PREFLIGHT_V2_ARTIFACT_EXISTS';
  end if;
end
$capacity_and_data_preflight$;

-- ============================================================
-- 1. outbox: Add UQ (S, outbox_id, run_id)
-- ============================================================
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_index as idx
    join pg_catalog.pg_class as relation on relation.oid = idx.indrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    join pg_catalog.pg_class as index_class on index_class.oid = idx.indexrelid
    where namespace.nspname = 'app_data_agent'
      and relation.relname = 'outbox'
      and index_class.relname = 'uq_outbox_outbox_id_run_id'
  ) then
    create unique index if not exists
      uq_outbox_outbox_id_run_id
      on app_data_agent.outbox (app_id, tenant_id, environment, outbox_id, run_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint as con
    join pg_catalog.pg_class as relation on relation.oid = con.conrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname = 'outbox'
      and con.contype = 'u'
      and con.conname = 'uq_outbox_outbox_id_run_id'
  ) then
    alter table app_data_agent.outbox
      add constraint uq_outbox_outbox_id_run_id
      unique using index uq_outbox_outbox_id_run_id;
  end if;
end $$;

-- ============================================================
-- 2. research_artifact_commit_operations: Add wire_protocol_version,
--    budget_receipt_id, budget_receipt_hash
-- ============================================================
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname = 'research_artifact_commit_operations'
      and attribute.attname = 'wire_protocol_version'
  ) then
    alter table app_data_agent.research_artifact_commit_operations
      add column wire_protocol_version text;

    -- Backfill from existing JSON
    update app_data_agent.research_artifact_commit_operations as operation
    set wire_protocol_version =
      operation.document_json #>> '{payload,protocol_version}';

    -- Backfill budget_receipt_id and budget_receipt_hash for v2 operations
    alter table app_data_agent.research_artifact_commit_operations
      add column budget_receipt_id uuid,
      add column budget_receipt_hash text;

    update app_data_agent.research_artifact_commit_operations as operation
    set
      budget_receipt_id = (operation.document_json #>> '{payload,budget_receipt_id}')::uuid,
      budget_receipt_hash = operation.document_json #>> '{payload,budget_receipt_hash}'
    where operation.document_json #>> '{payload,protocol_version}' in (
      'candidate-enumeration-receipt@2.0.0',
      'research-stop-derivation-receipt@2.0.0'
    );

    -- Add NOT NULL constraint and CHECK after backfill
    alter table app_data_agent.research_artifact_commit_operations
      alter column wire_protocol_version set not null,
      add constraint chk_artifact_commit_budget_receipt_pair
        check (
          (budget_receipt_id is not null and budget_receipt_hash is not null)
          or (budget_receipt_id is null and budget_receipt_hash is null)
        );
  end if;
end $$;

-- ============================================================
-- 3. research_resource_run_heads: Add budget epoch/seq columns
-- ============================================================
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname = 'research_resource_run_heads'
      and attribute.attname = 'budget_epoch'
  ) then
    alter table app_data_agent.research_resource_run_heads
      add column next_step_seq bigint check (next_step_seq between 0 and 9007199254740991),
      add column next_budget_event_seq bigint check (next_budget_event_seq between 0 and 9007199254740991),
      add column budget_epoch bigint check (budget_epoch between 0 and 9007199254740991),
      add column budget_epoch_state text check (budget_epoch_state in ('ACTIVE', 'LEGACY')),
      add column budget_started_at timestamptz,
      add column last_budget_event_hash text;

    -- Backfill legacy rows: epoch=0, state=LEGACY, nullable budget_started_at/last_budget_event_hash
    update app_data_agent.research_resource_run_heads as head
    set
      budget_epoch = 0,
      budget_epoch_state = 'LEGACY',
      next_step_seq = 0,
      next_budget_event_seq = 0
    where head.budget_epoch is null;
  end if;
end $$;

-- ============================================================
-- 4. research_resource_reservations: Add budget_epoch, logical_step_id, UQs
-- ============================================================
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname = 'research_resource_reservations'
      and attribute.attname = 'budget_epoch'
  ) then
    alter table app_data_agent.research_resource_reservations
      add column budget_epoch bigint not null default 0
        check (budget_epoch between 0 and 9007199254740991),
      add column logical_step_id uuid;

    -- Backfill legacy rows: epoch=0, logical_step_id=NULL
    update app_data_agent.research_resource_reservations as reservation
    set budget_epoch = 0
    where reservation.budget_epoch is null;

    -- Add UQs
    create unique index if not exists
      uq_reservation_budget_epoch
      on app_data_agent.research_resource_reservations (app_id, tenant_id, environment, run_id, reservation_id, budget_epoch);

    create unique index if not exists
      uq_reservation_budget_epoch_step
      on app_data_agent.research_resource_reservations (app_id, tenant_id, environment, run_id, reservation_id, budget_epoch, logical_step_id);
  end if;
end $$;

-- ============================================================
-- 5. research_stop_terminal_commits: Add stop_derivation_receipt_id/hash
-- ============================================================
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname = 'research_stop_terminal_commits'
      and attribute.attname = 'stop_derivation_receipt_id'
  ) then
    alter table app_data_agent.research_stop_terminal_commits
      add column stop_derivation_receipt_id uuid not null,
      add column stop_derivation_receipt_hash text not null,
      add constraint chk_stop_terminal_receipt_pair
        check (
          (stop_derivation_receipt_id is not null and stop_derivation_receipt_hash is not null)
        );
  end if;
end $$;

-- ============================================================
-- 6. research_domain_terminals: Add Stop Receipt pair
-- ============================================================
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname = 'research_domain_terminals'
      and attribute.attname = 'stop_derivation_receipt_id'
  ) then
    alter table app_data_agent.research_domain_terminals
      add column stop_derivation_receipt_id uuid,
      add column stop_derivation_receipt_hash text,
      add constraint chk_domain_terminal_stop_receipt_branch
        check (
          (authority_kind = 'RESEARCH_STOP'
           and terminal in ('PARTIAL', 'NEEDS_MORE_RESEARCH', 'INCONCLUSIVE')
           and stop_derivation_receipt_id is not null
           and stop_derivation_receipt_hash is not null)
          or (authority_kind != 'RESEARCH_STOP'
              and stop_derivation_receipt_id is null
              and stop_derivation_receipt_hash is null)
          or (terminal in ('READY', 'STALE')
              and stop_derivation_receipt_id is null
              and stop_derivation_receipt_hash is null)
        );
  end if;
end $$;
-- ============================================================
-- 10600: Budget policy, enumerator, event, and step tables
-- ============================================================

create table app_data_agent.research_budget_policy_versions (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  tenant_policy_version bigint not null
    check (tenant_policy_version between 1 and 9007199254740991),
  limits_json jsonb not null,
  top_up_allowed boolean not null default false,
  tenant_policy_hash text not null
    check (tenant_policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  provision_operation_id uuid not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, tenant_policy_version)
);

-- 2. research_budget_policy_heads: mutable current head
create table app_data_agent.research_budget_policy_heads (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  current_tenant_policy_version bigint not null
    check (current_tenant_policy_version between 1 and 9007199254740991),
  current_tenant_policy_hash text not null
    check (current_tenant_policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  head_version bigint not null
    check (head_version between 1 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment)
);

-- 3. research_enumerator_versions: immutable version
create table app_data_agent.research_enumerator_versions (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  enumerator_version bigint not null
    check (enumerator_version between 1 and 9007199254740991),
  eig_policy_version bigint not null
    check (eig_policy_version between 1 and 9007199254740991),
  input_schema_version text not null,
  implementation_digest text not null
    check (implementation_digest ~ '^sha256:[0-9a-f]{64}$'),
  enumerator_version_hash text not null
    check (enumerator_version_hash ~ '^sha256:[0-9a-f]{64}$'),
  provision_operation_id uuid not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, enumerator_version)
);

-- 4. research_enumerator_version_heads: mutable current head
create table app_data_agent.research_enumerator_version_heads (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  current_enumerator_version bigint not null
    check (current_enumerator_version between 1 and 9007199254740991),
  current_enumerator_version_hash text not null
    check (current_enumerator_version_hash ~ '^sha256:[0-9a-f]{64}$'),
  head_version bigint not null
    check (head_version between 1 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment)
);

-- 5. research_budget_events: append event
create table app_data_agent.research_budget_events (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  budget_epoch bigint not null
    check (budget_epoch between 0 and 9007199254740991),
  budget_event_seq bigint not null
    check (budget_event_seq between 0 and 9007199254740991),
  event_kind text not null
    check (event_kind in (
      'RESERVE', 'RELEASE', 'CONSUME', 'EXPIRY', 'TOP_UP',
      'EPOCH_ADVANCE', 'ADJUST', 'CANCEL', 'BUDGET_RESET'
    )),
  source_operation_kind text not null
    check (source_operation_kind in (
      'STEP', 'RESOURCE', 'ADMIN', 'POLICY', 'RECOVERY', 'EPOCH'
    )),
  source_operation_id uuid not null,
  reservation_id uuid,
  logical_step_id uuid,
  actual_before_json jsonb not null,
  actual_after_json jsonb not null,
  hold_before_json jsonb,
  hold_after_json jsonb,
  uncertainty_before_json jsonb,
  uncertainty_after_json jsonb,
  previous_event_hash text,
  event_hash text not null
    check (event_hash ~ '^sha256:[0-9a-f]{64}$'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, budget_epoch, budget_event_seq),
  unique (app_id, tenant_id, environment, run_id, budget_epoch, budget_event_seq, event_hash)
);

-- 6. research_step_operations: append operation
create table app_data_agent.research_step_operations (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  step_operation_id uuid not null,
  run_id uuid not null,
  budget_epoch bigint not null
    check (budget_epoch between 0 and 9007199254740991),
  logical_step_id uuid not null,
  parent_logical_step_id uuid,
  step_seq bigint not null
    check (step_seq between 0 and 9007199254740991),
  step_kind text not null
    check (step_kind in (
      'PLAN', 'QUERY', 'EVIDENCE', 'CLAIM', 'ASSESSMENT',
      'COVERAGE', 'STOP', 'REPORT', 'CLARIFICATION', 'REPLAN'
    )),
  step_input_hash text not null
    check (step_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  outbox_id uuid not null,
  attempt_id uuid not null,
  worker_fence bigint not null
    check (worker_fence between 0 and 9007199254740991),
  budget_event_seq bigint not null
    check (budget_event_seq between 0 and 9007199254740991),
  budget_event_hash text not null
    check (budget_event_hash ~ '^sha256:[0-9a-f]{64}$'),
  principal_id uuid not null,
  idempotency_key text not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, step_operation_id),
  unique (app_id, tenant_id, environment, run_id, idempotency_key),
  unique (app_id, tenant_id, environment, run_id, budget_epoch, logical_step_id)
);

-- 7. research_budget_ledger_receipts: common Receipt
-- ============================================================
-- 10600: Derivation receipt tables (Budget, Coverage, Attestation, Candidate, Stop)
-- ============================================================

create table app_data_agent.research_budget_ledger_receipts (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  protocol_version text not null,
  input_hash text not null
    check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  snapshot_command_hash text not null
    check (snapshot_command_hash ~ '^sha256:[0-9a-f]{64}$'),
  runtime_limits_version bigint not null
    check (runtime_limits_version between 1 and 9007199254740991),
  runtime_limits_hash text not null
    check (runtime_limits_hash ~ '^sha256:[0-9a-f]{64}$'),
  tenant_policy_version bigint not null
    check (tenant_policy_version between 1 and 9007199254740991),
  tenant_policy_hash text not null
    check (tenant_policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  budget_epoch bigint not null
    check (budget_epoch between 0 and 9007199254740991),
  budget_started_at timestamptz not null,
  evaluated_through_reservation_seq bigint not null
    check (evaluated_through_reservation_seq between 0 and 9007199254740991),
  evaluated_through_budget_event_seq bigint not null
    check (evaluated_through_budget_event_seq between 0 and 9007199254740991),
  evaluated_at timestamptz not null,
  valid_until timestamptz not null,
  outstanding_set_hash text not null
    check (outstanding_set_hash ~ '^sha256:[0-9a-f]{64}$'),
  active_count bigint not null
    check (active_count between 0 and 9007199254740991),
  outcome_unknown_count bigint not null
    check (outcome_unknown_count between 0 and 9007199254740991),
  abandoned_count bigint not null
    check (abandoned_count between 0 and 9007199254740991),
  actual_used_json jsonb not null,
  unresolved_hold_json jsonb not null,
  ledger_json jsonb not null,
  research_brief_ref_json jsonb not null,
  research_brief_artifact_id uuid not null,
  research_brief_artifact_type text not null
    check (research_brief_artifact_type = 'ResearchBrief'),
  research_brief_revision integer not null,
  research_brief_content_hash text not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, receipt_id),
  unique (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
);
create unique index if not exists uq_budget_ledger_receipt_protocol_version
  on app_data_agent.research_budget_ledger_receipts (app_id, tenant_id, environment, run_id, input_hash);
-- 8. research_coverage_derivation_receipts: common Receipt
create table app_data_agent.research_coverage_derivation_receipts (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  protocol_version text not null,
  input_hash text not null
    check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  budget_receipt_id uuid not null,
  budget_receipt_hash text not null
    check (budget_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  version_frontier_json jsonb not null,
  version_frontier_hash text not null
    check (version_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  closure_refs_json jsonb not null,
  coverage_input_hash text not null
    check (coverage_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  kernel_version text not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, receipt_id),
  unique (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
);
create unique index if not exists uq_coverage_derivation_receipt_protocol_version
  on app_data_agent.research_coverage_derivation_receipts (app_id, tenant_id, environment, run_id, coverage_input_hash);
-- 9. research_candidate_enumerator_attestations: append Attestation
create table app_data_agent.research_candidate_enumerator_attestations (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  attestation_id uuid not null,
  attestation_hash text not null
    check (attestation_hash ~ '^sha256:[0-9a-f]{64}$'),
  protocol_version text not null,
  issuer_principal_id uuid not null,
  issuer_capability_id uuid not null,
  issuer_authority_epoch bigint not null
    check (issuer_authority_epoch between 0 and 9007199254740991),
  idempotency_key text not null,
  budget_receipt_id uuid not null,
  budget_receipt_hash text not null,
  budget_input_hash text not null
    check (budget_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  enumerator_version bigint not null
    check (enumerator_version between 1 and 9007199254740991),
  eig_policy_version bigint not null
    check (eig_policy_version between 1 and 9007199254740991),
  implementation_digest text not null
    check (implementation_digest ~ '^sha256:[0-9a-f]{64}$'),
  query_contract_universe_refs_json jsonb not null,
  unresolved_obligation_refs_json jsonb not null,
  no_candidate_obligation_refs_json jsonb not null,
  no_candidate_assessments_json jsonb not null,
  candidate_queries_json jsonb not null,
  enumeration_universe_hash text not null
    check (enumeration_universe_hash ~ '^sha256:[0-9a-f]{64}$'),
  candidate_set_hash text not null
    check (candidate_set_hash ~ '^sha256:[0-9a-f]{64}$'),
  attestation_command_hash text not null
    check (attestation_command_hash ~ '^sha256:[0-9a-f]{64}$'),
  input_hash text not null
    check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, attestation_id),
  unique (app_id, tenant_id, environment, run_id, attestation_id, attestation_hash),
  unique (app_id, tenant_id, environment, run_id, issuer_principal_id, idempotency_key),
  unique (app_id, tenant_id, environment, run_id,
          budget_receipt_id, budget_receipt_hash, enumerator_version,
          eig_policy_version, enumeration_universe_hash)
);

-- 10. research_candidate_enumeration_receipts: common Receipt v2
create table app_data_agent.research_candidate_enumeration_receipts (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  protocol_version text not null,
  input_hash text not null
    check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  coverage_receipt_id uuid not null,
  coverage_receipt_hash text not null,
  budget_receipt_id uuid not null,
  budget_receipt_hash text not null,
  enumerator_head_version bigint not null
    check (enumerator_head_version between 1 and 9007199254740991),
  enumerator_version bigint not null
    check (enumerator_version between 1 and 9007199254740991),
  eig_policy_version bigint not null
    check (eig_policy_version between 1 and 9007199254740991),
  enumerator_capability_id uuid not null,
  enumerator_authority_epoch bigint not null
    check (enumerator_authority_epoch between 0 and 9007199254740991),
  enumerator_attestation_id uuid not null,
  enumerator_attestation_hash text not null
    check (enumerator_attestation_hash ~ '^sha256:[0-9a-f]{64}$'),
  unresolved_obligation_refs_json jsonb not null,
  no_candidate_obligation_refs_json jsonb not null,
  no_candidate_assessments_json jsonb not null,
  candidate_queries_json jsonb not null,
  query_contract_universe_refs_json jsonb not null,
  enumeration_universe_hash text not null
    check (enumeration_universe_hash ~ '^sha256:[0-9a-f]{64}$'),
  candidate_set_hash text not null
    check (candidate_set_hash ~ '^sha256:[0-9a-f]{64}$'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, receipt_id),
  unique (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
);

-- 11. research_stop_derivation_receipts: common Receipt v2
create table app_data_agent.research_stop_derivation_receipts (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  protocol_version text not null,
  input_hash text not null
    check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  coverage_receipt_id uuid not null,
  coverage_receipt_hash text not null,
  candidate_receipt_id uuid not null,
  candidate_receipt_hash text not null,
  budget_receipt_id uuid not null,
  budget_receipt_hash text not null,
  supported_subset_json jsonb not null,
  required_disclosures_json jsonb not null,
  pre_stop_readiness_hash text not null
    check (pre_stop_readiness_hash ~ '^sha256:[0-9a-f]{64}$'),
  kernel_version text not null,
  enumerator_version bigint not null
    check (enumerator_version between 1 and 9007199254740991),
  eig_policy_version bigint not null
    check (eig_policy_version between 1 and 9007199254740991),
  decision text not null
    check (decision in (
      'STOP_READY', 'STOP_PARTIAL', 'STOP_NEEDS_MORE_RESEARCH',
      'STOP_INCONCLUSIVE', 'CONTINUE', 'REPLAN',
      'RESEARCH_STOP_INPUT_STALE', 'RESEARCH_STOP_INPUT_INCONSISTENT'
    )),
  decision_input_hash text not null
    check (decision_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, receipt_id),
  unique (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
);

-- 12. research_input_event_heads: mutable head


-- ============================================================
create table app_data_agent.research_budget_ledger_input_bindings (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  canonical_path text not null
    check (canonical_path ~ '^[a-z_]+(\[[*\]])?(\.[a-z_]+(\[[*\]])?)*$'),
  binding_group text not null
    check (binding_group ~ '^(ROOT|REF:|EMBEDDED:)[A-Za-z0-9/:_-]+$'),
  ordinal integer not null
    check (ordinal between 0 and 255),
  binding_kind text not null
    check (binding_kind in ('ARTIFACT_REF', 'BUDGET_EVENT', 'RESERVATION_STATE')),
  strict_ref_json jsonb,
  artifact_id uuid,
  artifact_type text,
  revision integer
    check (revision between 0 and 2147483647),
  content_hash text
    check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  node_id text,
  budget_epoch bigint
    check (budget_epoch between 0 and 9007199254740991),
  budget_event_seq bigint
    check (budget_event_seq between 0 and 9007199254740991),
  event_hash text
    check (event_hash ~ '^sha256:[0-9a-f]{64}$'),
  reservation_id uuid,
  reservation_seq bigint
    check (reservation_seq between 0 and 9007199254740991),
  reservation_state text
    check (reservation_state in ('ACTIVE', 'SETTLED', 'ABANDONED', 'OUTCOME_UNKNOWN')),
  reservation_projection_json jsonb,
  reservation_projection_hash text
    check (reservation_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  primary key (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash, canonical_path, binding_group, ordinal),
  constraint chk_budget_binding_kind_exclusive
    check (
      (binding_kind = 'ARTIFACT_REF'
       and strict_ref_json is not null
       and artifact_id is not null
       and artifact_type is not null
       and revision is not null
       and content_hash is not null
       and budget_epoch is null
       and budget_event_seq is null
       and event_hash is null
       and reservation_id is null
       and reservation_seq is null
       and reservation_state is null
       and reservation_projection_json is null
       and reservation_projection_hash is null)
      or
      (binding_kind = 'BUDGET_EVENT'
       and strict_ref_json is null
       and artifact_id is null
       and artifact_type is null
       and revision is null
       and content_hash is null
       and node_id is null
       and budget_epoch is not null
       and budget_event_seq is not null
       and event_hash is not null
       and reservation_id is null
       and reservation_seq is null
       and reservation_state is null
       and reservation_projection_json is null
       and reservation_projection_hash is null)
      or
      (binding_kind = 'RESERVATION_STATE'
       and strict_ref_json is null
       and artifact_id is null
       and artifact_type is null
       and revision is null
       and content_hash is null
       and node_id is null
       and budget_epoch is null
       and budget_event_seq is null
       and event_hash is null
       and reservation_id is not null
       and reservation_seq is not null
       and reservation_state is not null
       and reservation_projection_json is not null
       and reservation_projection_hash is not null)
    )
);

-- ============================================================
-- 2. research_coverage_derivation_ref_bindings: Ref companion
--    parent FK to Coverage Receipt
-- ============================================================
create table app_data_agent.research_coverage_derivation_ref_bindings (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  canonical_path text not null
    check (canonical_path ~ '^[a-z_]+(\[[*\]])?(\.[a-z_]+(\[[*\]])?)*$'),
  binding_group text not null
    check (binding_group ~ '^(ROOT|REF:|EMBEDDED:)[A-Za-z0-9/:_-]+$'),
  ordinal integer not null
    check (ordinal between 0 and 255),
  strict_ref_json jsonb not null,
  artifact_id uuid not null,
  artifact_type text not null,
  revision integer not null
    check (revision between 0 and 2147483647),
  content_hash text not null
    check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  node_id text,
  constraint chk_coverage_ref_node_id_branch
    check (
      (binding_group like 'EMBEDDED:%' and node_id is not null)
      or (binding_group not like 'EMBEDDED:%' and node_id is null)
    ),
  primary key (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash, canonical_path, binding_group, ordinal)
);

-- ============================================================
-- 3. research_candidate_attestation_ref_bindings: Ref companion
--    parent FK to Attestation
-- ============================================================
create table app_data_agent.research_candidate_attestation_ref_bindings (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  attestation_id uuid not null,
  attestation_hash text not null
    check (attestation_hash ~ '^sha256:[0-9a-f]{64}$'),
  canonical_path text not null
    check (canonical_path ~ '^[a-z_]+(\[[*\]])?(\.[a-z_]+(\[[*\]])?)*$'),
  binding_group text not null
    check (binding_group ~ '^(ROOT|REF:|EMBEDDED:)[A-Za-z0-9/:_-]+$'),
  ordinal integer not null
    check (ordinal between 0 and 255),
  strict_ref_json jsonb not null,
  artifact_id uuid not null,
  artifact_type text not null,
  revision integer not null
    check (revision between 0 and 2147483647),
  content_hash text not null
    check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  node_id text,
  constraint chk_attestation_ref_node_id_branch
    check (
      (binding_group like 'EMBEDDED:%' and node_id is not null)
      or (binding_group not like 'EMBEDDED:%' and node_id is null)
    ),
  primary key (app_id, tenant_id, environment, run_id, attestation_id, attestation_hash, canonical_path, binding_group, ordinal)
);

-- ============================================================
-- 4. research_candidate_enumeration_ref_bindings: Ref companion
--    parent FK to Candidate Receipt v2
-- ============================================================
create table app_data_agent.research_candidate_enumeration_ref_bindings (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  canonical_path text not null
    check (canonical_path ~ '^[a-z_]+(\[[*\]])?(\.[a-z_]+(\[[*\]])?)*$'),
  binding_group text not null
    check (binding_group ~ '^(ROOT|REF:|EMBEDDED:)[A-Za-z0-9/:_-]+$'),
  ordinal integer not null
    check (ordinal between 0 and 255),
  strict_ref_json jsonb not null,
  artifact_id uuid not null,
  artifact_type text not null,
  revision integer not null
    check (revision between 0 and 2147483647),
  content_hash text not null
    check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  node_id text,
  constraint chk_candidate_enumeration_ref_node_id_branch
    check (
      (binding_group like 'EMBEDDED:%' and node_id is not null)
      or (binding_group not like 'EMBEDDED:%' and node_id is null)
    ),
  primary key (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash, canonical_path, binding_group, ordinal)
);

-- ============================================================
-- 5. research_stop_derivation_ref_bindings: Ref companion
--    parent FK to Stop Receipt
-- ============================================================
create table app_data_agent.research_stop_derivation_ref_bindings (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  canonical_path text not null
    check (canonical_path ~ '^[a-z_]+(\[[*\]])?(\.[a-z_]+(\[[*\]])?)*$'),
  binding_group text not null
    check (binding_group ~ '^(ROOT|REF:|EMBEDDED:)[A-Za-z0-9/:_-]+$'),
  ordinal integer not null
    check (ordinal between 0 and 255),
  strict_ref_json jsonb not null,
  artifact_id uuid not null,
  artifact_type text not null,
  revision integer not null
    check (revision between 0 and 2147483647),
  content_hash text not null
    check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  node_id text,
  constraint chk_stop_ref_node_id_branch
    check (
      (binding_group like 'EMBEDDED:%' and node_id is not null)
      or (binding_group not like 'EMBEDDED:%' and node_id is null)
    ),
  primary key (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash, canonical_path, binding_group, ordinal)
);


-- ============================================================
-- 10600: Coverage Derivation / Stop Receipt issuer functions
-- ============================================================

-- ============================================================
-- 1. issue_coverage_derivation_receipt: Issue Coverage Derivation Receipt
--    Validates version frontier, budget epoch, and closure refs
-- ============================================================
create function app_data_agent.issue_coverage_derivation_receipt(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_receipt_id uuid;
  v_receipt_hash text;
  v_budget_receipt_id uuid;
  v_budget_receipt_hash text;
  v_version_frontier_json jsonb;
  v_version_frontier_hash text;
  v_closure_refs_json jsonb;
  v_coverage_input_hash text;
  v_kernel_version text;
  v_principal_id uuid;
  v_idempotency_key text;
  v_existing record;
  v_now timestamptz;
  v_binding record;
  v_budget_receipt record;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_receipt_id := (cmd #>> '{receipt_id}')::uuid;
    v_budget_receipt_id := (cmd #>> '{budget_receipt_id}')::uuid;
    v_budget_receipt_hash := cmd #>> '{budget_receipt_hash}';
    v_version_frontier_json := cmd #> '{version_frontier}';
    v_version_frontier_hash := cmd #>> '{version_frontier_hash}';
    v_closure_refs_json := cmd #> '{closure_refs}';
    v_coverage_input_hash := cmd #>> '{coverage_input_hash}';
    v_kernel_version := cmd #>> '{kernel_version}';
    v_principal_id := (cmd #>> '{principal_id}')::uuid;
    v_idempotency_key := cmd #>> '{idempotency_key}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_receipt_id is null
    or v_budget_receipt_id is null or v_budget_receipt_hash is null
    or v_version_frontier_json is null or v_version_frontier_hash is null
    or v_closure_refs_json is null or v_coverage_input_hash is null
    or v_kernel_version is null
    or v_principal_id is null or v_idempotency_key is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Check idempotency
  select receipt_id, receipt_hash, committed_at
  into v_existing
  from app_data_agent.research_coverage_derivation_receipts as existing
  where existing.app_id = s_app_id
    and existing.tenant_id = s_tenant_id
    and existing.environment = s_environment
    and existing.run_id = v_run_id
    and existing.receipt_id = v_receipt_id;
  if found then
    return jsonb_build_object('ok', true, 'value', jsonb_build_object(
      'receipt_id', v_existing.receipt_id,
      'receipt_hash', v_existing.receipt_hash,
      'committed_at', v_existing.committed_at,
      'created', false
    ));
  end if;

  -- Verify budget receipt exists and is valid
  select receipt.*
  into v_budget_receipt
  from app_data_agent.research_budget_ledger_receipts as receipt
  where receipt.app_id = s_app_id
    and receipt.tenant_id = s_tenant_id
    and receipt.environment = s_environment
    and receipt.run_id = v_run_id
    and receipt.receipt_id = v_budget_receipt_id
    and receipt.receipt_hash = v_budget_receipt_hash;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'BUDGET_RECEIPT_NOT_FOUND'));
  end if;

  v_now := pg_catalog.clock_timestamp();

  -- Compute receipt hash
  v_receipt_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-coverage-derivation-receipt@1.0.0' || '\x00'::bytea ||
        v_receipt_id::text || '\x00'::bytea ||
        v_budget_receipt_id::text || '\x00'::bytea ||
        v_budget_receipt_hash || '\x00'::bytea ||
        v_version_frontier_hash || '\x00'::bytea ||
        v_coverage_input_hash || '\x00'::bytea ||
        v_kernel_version,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Insert receipt
  insert into app_data_agent.research_coverage_derivation_receipts (
    app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
    protocol_version, input_hash,
    budget_receipt_id, budget_receipt_hash,
    version_frontier_json, version_frontier_hash,
    closure_refs_json, coverage_input_hash, kernel_version,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
    'coverage-derivation-receipt@1.0.0', v_coverage_input_hash,
    v_budget_receipt_id, v_budget_receipt_hash,
    v_version_frontier_json, v_version_frontier_hash,
    v_closure_refs_json, v_coverage_input_hash, v_kernel_version,
    v_now
  );

  -- Insert companion ref bindings
  for v_binding in
    select value
    from jsonb_array_elements(cmd #> '{ref_bindings}')
  loop
    insert into app_data_agent.research_coverage_derivation_ref_bindings (
      app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
      canonical_path, binding_group, ordinal,
      strict_ref_json, artifact_id, artifact_type, revision, content_hash, node_id
    ) values (
      s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
      v_binding #>> '{canonical_path}',
      v_binding #>> '{binding_group}',
      (v_binding #>> '{ordinal}')::integer,
      v_binding #> '{strict_ref_json}',
      (v_binding #>> '{artifact_id}')::uuid,
      v_binding #>> '{artifact_type}',
      (v_binding #>> '{revision}')::integer,
      v_binding #>> '{content_hash}',
      v_binding #>> '{node_id}'
    );
  end loop;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_hash', v_receipt_hash,
    'committed_at', v_now,
    'created', true
  ));
end;
$$;

-- ============================================================
-- 2. issue_candidate_enumerator_attestation: Issue Attestation
--    Validates enumerator version, budget receipt, and candidate universe
-- ============================================================
create function app_data_agent.issue_candidate_enumerator_attestation(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_attestation_id uuid;
  v_attestation_hash text;
  v_issuer_principal_id uuid;
  v_issuer_capability_id uuid;
  v_issuer_authority_epoch bigint;
  v_idempotency_key text;
  v_budget_receipt_id uuid;
  v_budget_receipt_hash text;
  v_budget_input_hash text;
  v_enumerator_version bigint;
  v_eig_policy_version bigint;
  v_implementation_digest text;
  v_query_contract_universe_refs_json jsonb;
  v_unresolved_obligation_refs_json jsonb;
  v_no_candidate_obligation_refs_json jsonb;
  v_no_candidate_assessments_json jsonb;
  v_candidate_queries_json jsonb;
  v_enumeration_universe_hash text;
  v_candidate_set_hash text;
  v_attestation_command_hash text;
  v_input_hash text;
  v_existing record;
  v_now timestamptz;
  v_binding record;
  v_enumerator_head record;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_attestation_id := (cmd #>> '{attestation_id}')::uuid;
    v_issuer_principal_id := (cmd #>> '{issuer_principal_id}')::uuid;
    v_issuer_capability_id := (cmd #>> '{issuer_capability_id}')::uuid;
    v_issuer_authority_epoch := (cmd #>> '{issuer_authority_epoch}')::bigint;
    v_idempotency_key := cmd #>> '{idempotency_key}';
    v_budget_receipt_id := (cmd #>> '{budget_receipt_id}')::uuid;
    v_budget_receipt_hash := cmd #>> '{budget_receipt_hash}';
    v_budget_input_hash := cmd #>> '{budget_input_hash}';
    v_enumerator_version := (cmd #>> '{enumerator_version}')::bigint;
    v_eig_policy_version := (cmd #>> '{eig_policy_version}')::bigint;
    v_implementation_digest := cmd #>> '{implementation_digest}';
    v_query_contract_universe_refs_json := cmd #> '{query_contract_universe_refs}';
    v_unresolved_obligation_refs_json := cmd #> '{unresolved_obligation_refs}';
    v_no_candidate_obligation_refs_json := cmd #> '{no_candidate_obligation_refs}';
    v_no_candidate_assessments_json := cmd #> '{no_candidate_assessments}';
    v_candidate_queries_json := cmd #> '{candidate_queries}';
    v_enumeration_universe_hash := cmd #>> '{enumeration_universe_hash}';
    v_candidate_set_hash := cmd #>> '{candidate_set_hash}';
    v_attestation_command_hash := cmd #>> '{attestation_command_hash}';
    v_input_hash := cmd #>> '{input_hash}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_attestation_id is null
    or v_issuer_principal_id is null or v_issuer_capability_id is null
    or v_issuer_authority_epoch is null or v_idempotency_key is null
    or v_budget_receipt_id is null or v_budget_receipt_hash is null
    or v_budget_input_hash is null
    or v_enumerator_version is null or v_eig_policy_version is null
    or v_implementation_digest is null
    or v_enumeration_universe_hash is null or v_candidate_set_hash is null
    or v_attestation_command_hash is null or v_input_hash is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Check idempotency
  select attestation_id, attestation_hash, committed_at
  into v_existing
  from app_data_agent.research_candidate_enumerator_attestations as existing
  where existing.app_id = s_app_id
    and existing.tenant_id = s_tenant_id
    and existing.environment = s_environment
    and existing.run_id = v_run_id
    and existing.attestation_id = v_attestation_id;
  if found then
    return jsonb_build_object('ok', true, 'value', jsonb_build_object(
      'attestation_id', v_existing.attestation_id,
      'attestation_hash', v_existing.attestation_hash,
      'committed_at', v_existing.committed_at,
      'created', false
    ));
  end if;

  -- Verify enumerator version
  select head.*
  into v_enumerator_head
  from app_data_agent.research_enumerator_version_heads as head
  where head.app_id = s_app_id
    and head.tenant_id = s_tenant_id
    and head.environment = s_environment;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'ENUMERATOR_HEAD_NOT_FOUND'));
  end if;
  if v_enumerator_head.current_enumerator_version <> v_enumerator_version then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'ENUMERATOR_VERSION_MISMATCH'));
  end if;

  v_now := pg_catalog.clock_timestamp();

  -- Compute attestation hash
  v_attestation_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-candidate-enumerator-attestation@1.0.0' || '\x00'::bytea ||
        v_attestation_id::text || '\x00'::bytea ||
        v_issuer_principal_id::text || '\x00'::bytea ||
        v_budget_receipt_id::text || '\x00'::bytea ||
        v_budget_receipt_hash || '\x00'::bytea ||
        v_enumerator_version::text || '\x00'::bytea ||
        v_eig_policy_version::text || '\x00'::bytea ||
        v_enumeration_universe_hash || '\x00'::bytea ||
        v_candidate_set_hash || '\x00'::bytea ||
        v_attestation_command_hash || '\x00'::bytea ||
        v_input_hash,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Insert attestation
  insert into app_data_agent.research_candidate_enumerator_attestations (
    app_id, tenant_id, environment, run_id, attestation_id, attestation_hash,
    protocol_version, input_hash,
    issuer_principal_id, issuer_capability_id, issuer_authority_epoch,
    idempotency_key,
    budget_receipt_id, budget_receipt_hash, budget_input_hash,
    enumerator_version, eig_policy_version, implementation_digest,
    query_contract_universe_refs_json, unresolved_obligation_refs_json,
    no_candidate_obligation_refs_json, no_candidate_assessments_json,
    candidate_queries_json,
    enumeration_universe_hash, candidate_set_hash,
    attestation_command_hash, input_hash,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_attestation_id, v_attestation_hash,
    'candidate-enumerator-attestation@1.0.0', v_input_hash,
    v_issuer_principal_id, v_issuer_capability_id, v_issuer_authority_epoch,
    v_idempotency_key,
    v_budget_receipt_id, v_budget_receipt_hash, v_budget_input_hash,
    v_enumerator_version, v_eig_policy_version, v_implementation_digest,
    v_query_contract_universe_refs_json, v_unresolved_obligation_refs_json,
    v_no_candidate_obligation_refs_json, v_no_candidate_assessments_json,
    v_candidate_queries_json,
    v_enumeration_universe_hash, v_candidate_set_hash,
    v_attestation_command_hash, v_input_hash,
    v_now
  );

  -- Insert companion ref bindings
  for v_binding in
    select value
    from jsonb_array_elements(cmd #> '{ref_bindings}')
  loop
    insert into app_data_agent.research_candidate_attestation_ref_bindings (
      app_id, tenant_id, environment, run_id, attestation_id, attestation_hash,
      canonical_path, binding_group, ordinal,
      strict_ref_json, artifact_id, artifact_type, revision, content_hash, node_id
    ) values (
      s_app_id, s_tenant_id, s_environment, v_run_id, v_attestation_id, v_attestation_hash,
      v_binding #>> '{canonical_path}',
      v_binding #>> '{binding_group}',
      (v_binding #>> '{ordinal}')::integer,
      v_binding #> '{strict_ref_json}',
      (v_binding #>> '{artifact_id}')::uuid,
      v_binding #>> '{artifact_type}',
      (v_binding #>> '{revision}')::integer,
      v_binding #>> '{content_hash}',
      v_binding #>> '{node_id}'
    );
  end loop;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'attestation_id', v_attestation_id,
    'attestation_hash', v_attestation_hash,
    'committed_at', v_now,
    'created', true
  ));
end;
$$;

-- ============================================================
-- 3. issue_candidate_enumeration_receipt: Issue Candidate Enumeration Receipt v2
--    Validates attestation, coverage, and budget dependencies
-- ============================================================
create function app_data_agent.issue_candidate_enumeration_receipt(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_receipt_id uuid;
  v_receipt_hash text;
  v_coverage_receipt_id uuid;
  v_coverage_receipt_hash text;
  v_budget_receipt_id uuid;
  v_budget_receipt_hash text;
  v_enumerator_head_version bigint;
  v_enumerator_version bigint;
  v_eig_policy_version bigint;
  v_enumerator_capability_id uuid;
  v_enumerator_authority_epoch bigint;
  v_enumerator_attestation_id uuid;
  v_enumerator_attestation_hash text;
  v_unresolved_obligation_refs_json jsonb;
  v_no_candidate_obligation_refs_json jsonb;
  v_no_candidate_assessments_json jsonb;
  v_candidate_queries_json jsonb;
  v_query_contract_universe_refs_json jsonb;
  v_enumeration_universe_hash text;
  v_candidate_set_hash text;
  v_existing record;
  v_now timestamptz;
  v_binding record;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_receipt_id := (cmd #>> '{receipt_id}')::uuid;
    v_coverage_receipt_id := (cmd #>> '{coverage_receipt_id}')::uuid;
    v_coverage_receipt_hash := cmd #>> '{coverage_receipt_hash}';
    v_budget_receipt_id := (cmd #>> '{budget_receipt_id}')::uuid;
    v_budget_receipt_hash := cmd #>> '{budget_receipt_hash}';
    v_enumerator_head_version := (cmd #>> '{enumerator_head_version}')::bigint;
    v_enumerator_version := (cmd #>> '{enumerator_version}')::bigint;
    v_eig_policy_version := (cmd #>> '{eig_policy_version}')::bigint;
    v_enumerator_capability_id := (cmd #>> '{enumerator_capability_id}')::uuid;
    v_enumerator_authority_epoch := (cmd #>> '{enumerator_authority_epoch}')::bigint;
    v_enumerator_attestation_id := (cmd #>> '{enumerator_attestation_id}')::uuid;
    v_enumerator_attestation_hash := cmd #>> '{enumerator_attestation_hash}';
    v_unresolved_obligation_refs_json := cmd #> '{unresolved_obligation_refs}';
    v_no_candidate_obligation_refs_json := cmd #> '{no_candidate_obligation_refs}';
    v_no_candidate_assessments_json := cmd #> '{no_candidate_assessments}';
    v_candidate_queries_json := cmd #> '{candidate_queries}';
    v_query_contract_universe_refs_json := cmd #> '{query_contract_universe_refs}';
    v_enumeration_universe_hash := cmd #>> '{enumeration_universe_hash}';
    v_candidate_set_hash := cmd #>> '{candidate_set_hash}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_receipt_id is null
    or v_coverage_receipt_id is null or v_coverage_receipt_hash is null
    or v_budget_receipt_id is null or v_budget_receipt_hash is null
    or v_enumerator_head_version is null or v_enumerator_version is null
    or v_eig_policy_version is null or v_enumerator_capability_id is null
    or v_enumerator_authority_epoch is null
    or v_enumerator_attestation_id is null or v_enumerator_attestation_hash is null
    or v_enumeration_universe_hash is null or v_candidate_set_hash is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Check idempotency
  select receipt_id, receipt_hash, committed_at
  into v_existing
  from app_data_agent.research_candidate_enumeration_receipts as existing
  where existing.app_id = s_app_id
    and existing.tenant_id = s_tenant_id
    and existing.environment = s_environment
    and existing.run_id = v_run_id
    and existing.receipt_id = v_receipt_id;
  if found then
    return jsonb_build_object('ok', true, 'value', jsonb_build_object(
      'receipt_id', v_existing.receipt_id,
      'receipt_hash', v_existing.receipt_hash,
      'committed_at', v_existing.committed_at,
      'created', false
    ));
  end if;

  v_now := pg_catalog.clock_timestamp();

  -- Compute receipt hash
  v_receipt_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-candidate-enumeration-receipt@2.0.0' || '\x00'::bytea ||
        v_receipt_id::text || '\x00'::bytea ||
        v_coverage_receipt_id::text || '\x00'::bytea ||
        v_coverage_receipt_hash || '\x00'::bytea ||
        v_budget_receipt_id::text || '\x00'::bytea ||
        v_budget_receipt_hash || '\x00'::bytea ||
        v_enumerator_head_version::text || '\x00'::bytea ||
        v_enumerator_version::text || '\x00'::bytea ||
        v_eig_policy_version::text || '\x00'::bytea ||
        v_enumeration_universe_hash || '\x00'::bytea ||
        v_candidate_set_hash,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Insert receipt
  insert into app_data_agent.research_candidate_enumeration_receipts (
    app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
    protocol_version, input_hash,
    coverage_receipt_id, coverage_receipt_hash,
    budget_receipt_id, budget_receipt_hash,
    enumerator_head_version, enumerator_version, eig_policy_version,
    enumerator_capability_id, enumerator_authority_epoch,
    enumerator_attestation_id, enumerator_attestation_hash,
    unresolved_obligation_refs_json, no_candidate_obligation_refs_json,
    no_candidate_assessments_json, candidate_queries_json,
    query_contract_universe_refs_json,
    enumeration_universe_hash, candidate_set_hash,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
    'candidate-enumeration-receipt@2.0.0', v_candidate_set_hash,
    v_coverage_receipt_id, v_coverage_receipt_hash,
    v_budget_receipt_id, v_budget_receipt_hash,
    v_enumerator_head_version, v_enumerator_version, v_eig_policy_version,
    v_enumerator_capability_id, v_enumerator_authority_epoch,
    v_enumerator_attestation_id, v_enumerator_attestation_hash,
    v_unresolved_obligation_refs_json, v_no_candidate_obligation_refs_json,
    v_no_candidate_assessments_json, v_candidate_queries_json,
    v_query_contract_universe_refs_json,
    v_enumeration_universe_hash, v_candidate_set_hash,
    v_now
  );

  -- Insert companion ref bindings
  for v_binding in
    select value
    from jsonb_array_elements(cmd #> '{ref_bindings}')
  loop
    insert into app_data_agent.research_candidate_enumeration_ref_bindings (
      app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
      canonical_path, binding_group, ordinal,
      strict_ref_json, artifact_id, artifact_type, revision, content_hash, node_id
    ) values (
      s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
      v_binding #>> '{canonical_path}',
      v_binding #>> '{binding_group}',
      (v_binding #>> '{ordinal}')::integer,
      v_binding #> '{strict_ref_json}',
      (v_binding #>> '{artifact_id}')::uuid,
      v_binding #>> '{artifact_type}',
      (v_binding #>> '{revision}')::integer,
      v_binding #>> '{content_hash}',
      v_binding #>> '{node_id}'
    );
  end loop;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_hash', v_receipt_hash,
    'committed_at', v_now,
    'created', true
  ));
end;
$$;

-- ============================================================
-- 4. issue_stop_derivation_receipt: Issue Stop Derivation Receipt v2
--    Validates coverage, candidate, budget, and decision
-- ============================================================
create function app_data_agent.issue_stop_derivation_receipt(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_receipt_id uuid;
  v_receipt_hash text;
  v_coverage_receipt_id uuid;
  v_coverage_receipt_hash text;
  v_candidate_receipt_id uuid;
  v_candidate_receipt_hash text;
  v_budget_receipt_id uuid;
  v_budget_receipt_hash text;
  v_supported_subset_json jsonb;
  v_required_disclosures_json jsonb;
  v_pre_stop_readiness_hash text;
  v_kernel_version text;
  v_enumerator_version bigint;
  v_eig_policy_version bigint;
  v_decision text;
  v_decision_input_hash text;
  v_existing record;
  v_now timestamptz;
  v_binding record;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_receipt_id := (cmd #>> '{receipt_id}')::uuid;
    v_coverage_receipt_id := (cmd #>> '{coverage_receipt_id}')::uuid;
    v_coverage_receipt_hash := cmd #>> '{coverage_receipt_hash}';
    v_candidate_receipt_id := (cmd #>> '{candidate_receipt_id}')::uuid;
    v_candidate_receipt_hash := cmd #>> '{candidate_receipt_hash}';
    v_budget_receipt_id := (cmd #>> '{budget_receipt_id}')::uuid;
    v_budget_receipt_hash := cmd #>> '{budget_receipt_hash}';
    v_supported_subset_json := cmd #> '{supported_subset}';
    v_required_disclosures_json := cmd #> '{required_disclosures}';
    v_pre_stop_readiness_hash := cmd #>> '{pre_stop_readiness_hash}';
    v_kernel_version := cmd #>> '{kernel_version}';
    v_enumerator_version := (cmd #>> '{enumerator_version}')::bigint;
    v_eig_policy_version := (cmd #>> '{eig_policy_version}')::bigint;
    v_decision := cmd #>> '{decision}';
    v_decision_input_hash := cmd #>> '{decision_input_hash}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_receipt_id is null
    or v_coverage_receipt_id is null or v_coverage_receipt_hash is null
    or v_candidate_receipt_id is null or v_candidate_receipt_hash is null
    or v_budget_receipt_id is null or v_budget_receipt_hash is null
    or v_pre_stop_readiness_hash is null or v_kernel_version is null
    or v_enumerator_version is null or v_eig_policy_version is null
    or v_decision is null or v_decision_input_hash is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  if v_decision not in (
    'STOP_READY', 'STOP_PARTIAL', 'STOP_NEEDS_MORE_RESEARCH',
    'STOP_INCONCLUSIVE', 'CONTINUE', 'REPLAN',
    'RESEARCH_STOP_INPUT_STALE', 'RESEARCH_STOP_INPUT_INCONSISTENT'
  ) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_DECISION'));
  end if;

  -- Check idempotency
  select receipt_id, receipt_hash, committed_at
  into v_existing
  from app_data_agent.research_stop_derivation_receipts as existing
  where existing.app_id = s_app_id
    and existing.tenant_id = s_tenant_id
    and existing.environment = s_environment
    and existing.run_id = v_run_id
    and existing.receipt_id = v_receipt_id;
  if found then
    return jsonb_build_object('ok', true, 'value', jsonb_build_object(
      'receipt_id', v_existing.receipt_id,
      'receipt_hash', v_existing.receipt_hash,
      'committed_at', v_existing.committed_at,
      'created', false
    ));
  end if;

  v_now := pg_catalog.clock_timestamp();

  -- Compute receipt hash
  v_receipt_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-stop-derivation-receipt@2.0.0' || '\x00'::bytea ||
        v_receipt_id::text || '\x00'::bytea ||
        v_coverage_receipt_id::text || '\x00'::bytea ||
        v_coverage_receipt_hash || '\x00'::bytea ||
        v_candidate_receipt_id::text || '\x00'::bytea ||
        v_candidate_receipt_hash || '\x00'::bytea ||
        v_budget_receipt_id::text || '\x00'::bytea ||
        v_budget_receipt_hash || '\x00'::bytea ||
        v_pre_stop_readiness_hash || '\x00'::bytea ||
        v_kernel_version || '\x00'::bytea ||
        v_enumerator_version::text || '\x00'::bytea ||
        v_eig_policy_version::text || '\x00'::bytea ||
        v_decision || '\x00'::bytea ||
        v_decision_input_hash,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Insert receipt
  insert into app_data_agent.research_stop_derivation_receipts (
    app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
    protocol_version, input_hash,
    coverage_receipt_id, coverage_receipt_hash,
    candidate_receipt_id, candidate_receipt_hash,
    budget_receipt_id, budget_receipt_hash,
    supported_subset_json, required_disclosures_json,
    pre_stop_readiness_hash, kernel_version,
    enumerator_version, eig_policy_version,
    decision, decision_input_hash,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
    'research-stop-derivation-receipt@2.0.0', v_decision_input_hash,
    v_coverage_receipt_id, v_coverage_receipt_hash,
    v_candidate_receipt_id, v_candidate_receipt_hash,
    v_budget_receipt_id, v_budget_receipt_hash,
    v_supported_subset_json, v_required_disclosures_json,
    v_pre_stop_readiness_hash, v_kernel_version,
    v_enumerator_version, v_eig_policy_version,
    v_decision, v_decision_input_hash,
    v_now
  );

  -- Insert companion ref bindings
  for v_binding in
    select value
    from jsonb_array_elements(cmd #> '{ref_bindings}')
  loop
    insert into app_data_agent.research_stop_derivation_ref_bindings (
      app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
      canonical_path, binding_group, ordinal,
      strict_ref_json, artifact_id, artifact_type, revision, content_hash, node_id
    ) values (
      s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
      v_binding #>> '{canonical_path}',
      v_binding #>> '{binding_group}',
      (v_binding #>> '{ordinal}')::integer,
      v_binding #> '{strict_ref_json}',
      (v_binding #>> '{artifact_id}')::uuid,
      v_binding #>> '{artifact_type}',
      (v_binding #>> '{revision}')::integer,
      v_binding #>> '{content_hash}',
      v_binding #>> '{node_id}'
    );
  end loop;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_hash', v_receipt_hash,
    'committed_at', v_now,
    'created', true
  ));
end;
$$;

-- ============================================================
-- 5. resolve_stop_decision: Resolve Stop Decision from receipt
--    Read-only verifier that returns the decision and metadata
-- ============================================================
create function app_data_agent.resolve_stop_decision(
  input_json jsonb
) returns jsonb
language plpgsql
stable
called on null input
security definer
set search_path = ''
as $$
declare
  v_receipt record;
  v_computed_hash text;
begin
  if input_json is null or jsonb_typeof(input_json) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  select receipt.*
  into v_receipt
  from app_data_agent.research_stop_derivation_receipts as receipt
  where receipt.app_id = (input_json #>> '{scope,app_id}')::uuid
    and receipt.tenant_id = (input_json #>> '{scope,tenant_id}')::uuid
    and receipt.environment = input_json #>> '{scope,environment}'
    and receipt.run_id = (input_json #>> '{run_id}')::uuid
    and receipt.receipt_id = (input_json #>> '{receipt_id}')::uuid;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'RECEIPT_NOT_FOUND'));
  end if;

  v_computed_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-stop-derivation-receipt@2.0.0' || '\x00'::bytea ||
        v_receipt.receipt_id::text || '\x00'::bytea ||
        v_receipt.coverage_receipt_id::text || '\x00'::bytea ||
        v_receipt.coverage_receipt_hash || '\x00'::bytea ||
        v_receipt.candidate_receipt_id::text || '\x00'::bytea ||
        v_receipt.candidate_receipt_hash || '\x00'::bytea ||
        v_receipt.budget_receipt_id::text || '\x00'::bytea ||
        v_receipt.budget_receipt_hash || '\x00'::bytea ||
        v_receipt.pre_stop_readiness_hash || '\x00'::bytea ||
        v_receipt.kernel_version || '\x00'::bytea ||
        v_receipt.enumerator_version::text || '\x00'::bytea ||
        v_receipt.eig_policy_version::text || '\x00'::bytea ||
        v_receipt.decision || '\x00'::bytea ||
        v_receipt.decision_input_hash,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if v_receipt.receipt_hash <> v_computed_hash then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'HASH_MISMATCH'));
  end if;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt.receipt_id,
    'receipt_hash', v_receipt.receipt_hash,
    'decision', v_receipt.decision,
    'committed_at', v_receipt.committed_at
  ));
end;
$$;
-- ============================================================
-- 10600: Input event watermark tables
-- ============================================================

create table app_data_agent.research_input_event_heads (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  next_event_seq bigint not null
    check (next_event_seq between 0 and 9007199254740991),
  head_event_hash text,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id)
);

-- 13. research_input_events: append event
create table app_data_agent.research_input_events (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  event_seq bigint not null
    check (event_seq between 0 and 9007199254740991),
  event_kind text not null
    check (event_kind in (
      'BRIEF_ASSIGNED', 'HYPOTHESIS_SET', 'EVIDENCE_PLAN',
      'QUERY_EVIDENCE', 'CLAIM_ASSESSED', 'COVERAGE_DERIVED',
      'STOP_DECIDED', 'REPORT_READY', 'REVOCATION',
      'CLARIFICATION', 'REPLAN_REQUESTED', 'BUDGET_EVENT',
      'RESOURCE_INVOCATION'
    )),
  subject_identity text not null,
  subject_hash text not null
    check (subject_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_operation_kind text not null
    check (source_operation_kind in (
      'RESEARCH_KERNEL', 'AUTHORITY_RPC', 'WORKER', 'SYSTEM', 'ADMIN'
    )),
  source_operation_id uuid not null,
  previous_event_hash text,
  event_hash text not null
    check (event_hash ~ '^sha256:[0-9a-f]{64}$'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, event_seq),
  unique (app_id, tenant_id, environment, run_id, event_seq, event_hash)
);

-- 14. research_input_event_watermark_receipts: common Receipt
create table app_data_agent.research_input_event_watermark_receipts (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  observed_event_seq bigint not null
    check (observed_event_seq between 0 and 9007199254740991),
  observed_head_hash text not null
    check (observed_head_hash ~ '^sha256:[0-9a-f]{64}$'),
  certificate_input_closure_hash text not null
    check (certificate_input_closure_hash ~ '^sha256:[0-9a-f]{64}$'),
  certificate_ref_json jsonb not null,
  certificate_artifact_id uuid not null,
  certificate_artifact_type text not null
    check (certificate_artifact_type = 'ReportReadyCertificate'),
  certificate_revision integer not null,
  certificate_content_hash text not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, receipt_id),
  unique (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
);

-- 15. research_backend_artifact_commit_operations: append operation
-- ============================================================
-- 10600: Backend artifact commit operations table
-- ============================================================

create table app_data_agent.research_backend_artifact_commit_operations (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  operation_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null,
  commit_mode text not null
    check (commit_mode in ('CREATE', 'UPDATE', 'REVISE', 'SEAL', 'PUBLISH', 'REVOKE')),
  command_hash text not null
    check (command_hash ~ '^sha256:[0-9a-f]{64}$'),
  expected_active_revision integer not null,
  worker_fence bigint not null
    check (worker_fence between 0 and 9007199254740991),
  adopted_legacy boolean not null default false,
  committed_artifact_ref_json jsonb not null,
  committed_artifact_id uuid not null,
  committed_artifact_type text not null,
  committed_revision integer not null,
  committed_content_hash text not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, operation_id),
  unique (app_id, tenant_id, environment, run_id, idempotency_key)
);
-- ============================================================
-- 10600: Cross-table FKs, indexes, and immutable triggers
-- ============================================================

-- ============================================================
-- Part 1: Immutable triggers for append-only tables
-- ============================================================

-- 1. research_budget_policy_versions
create trigger research_budget_policy_versions_immutable
  before update or delete on app_data_agent.research_budget_policy_versions
  for each row execute function platform.reject_immutable_mutation();

-- 2. research_enumerator_versions
create trigger research_enumerator_versions_immutable
  before update or delete on app_data_agent.research_enumerator_versions
  for each row execute function platform.reject_immutable_mutation();

-- 3. research_budget_events
create trigger research_budget_events_immutable
  before update or delete on app_data_agent.research_budget_events
  for each row execute function platform.reject_immutable_mutation();

-- 4. research_step_operations
create trigger research_step_operations_immutable
  before update or delete on app_data_agent.research_step_operations
  for each row execute function platform.reject_immutable_mutation();

-- 5. research_budget_ledger_receipts
create trigger research_budget_ledger_receipts_immutable
  before update or delete on app_data_agent.research_budget_ledger_receipts
  for each row execute function platform.reject_immutable_mutation();

-- 6. research_coverage_derivation_receipts
create trigger research_coverage_derivation_receipts_immutable
  before update or delete on app_data_agent.research_coverage_derivation_receipts
  for each row execute function platform.reject_immutable_mutation();

-- 7. research_candidate_enumerator_attestations
create trigger research_candidate_enumerator_attestations_immutable
  before update or delete on app_data_agent.research_candidate_enumerator_attestations
  for each row execute function platform.reject_immutable_mutation();

-- 8. research_candidate_enumeration_receipts
create trigger research_candidate_enumeration_receipts_immutable
  before update or delete on app_data_agent.research_candidate_enumeration_receipts
  for each row execute function platform.reject_immutable_mutation();

-- 9. research_stop_derivation_receipts
create trigger research_stop_derivation_receipts_immutable
  before update or delete on app_data_agent.research_stop_derivation_receipts
  for each row execute function platform.reject_immutable_mutation();

-- 10. research_input_events
create trigger research_input_events_immutable
  before update or delete on app_data_agent.research_input_events
  for each row execute function platform.reject_immutable_mutation();

-- 11. research_input_event_watermark_receipts
create trigger research_input_event_watermark_receipts_immutable
  before update or delete on app_data_agent.research_input_event_watermark_receipts
  for each row execute function platform.reject_immutable_mutation();

-- 12. research_backend_artifact_commit_operations
create trigger research_backend_artifact_commit_operations_immutable
  before update or delete on app_data_agent.research_backend_artifact_commit_operations
  for each row execute function platform.reject_immutable_mutation();

-- 13. research_budget_ledger_input_bindings (companion)
create trigger research_budget_ledger_input_bindings_immutable
  before update or delete on app_data_agent.research_budget_ledger_input_bindings
  for each row execute function platform.reject_immutable_mutation();

-- 14. research_coverage_derivation_ref_bindings (companion)
create trigger research_coverage_derivation_ref_bindings_immutable
  before update or delete on app_data_agent.research_coverage_derivation_ref_bindings
  for each row execute function platform.reject_immutable_mutation();

-- 15. research_candidate_attestation_ref_bindings (companion)
create trigger research_candidate_attestation_ref_bindings_immutable
  before update or delete on app_data_agent.research_candidate_attestation_ref_bindings
  for each row execute function platform.reject_immutable_mutation();

-- 16. research_candidate_enumeration_ref_bindings (companion)
create trigger research_candidate_enumeration_ref_bindings_immutable
  before update or delete on app_data_agent.research_candidate_enumeration_ref_bindings
  for each row execute function platform.reject_immutable_mutation();

-- 17. research_stop_derivation_ref_bindings (companion)
create trigger research_stop_derivation_ref_bindings_immutable
  before update or delete on app_data_agent.research_stop_derivation_ref_bindings
  for each row execute function platform.reject_immutable_mutation();

-- ============================================================
-- Part 2: FK constraints from companion tables to parent tables
-- ============================================================

-- research_budget_ledger_input_bindings FK to research_budget_ledger_receipts
alter table app_data_agent.research_budget_ledger_input_bindings
  add constraint budget_input_bindings_receipt_fk
  foreign key (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  references app_data_agent.research_budget_ledger_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_coverage_derivation_ref_bindings FK to research_coverage_derivation_receipts
alter table app_data_agent.research_coverage_derivation_ref_bindings
  add constraint coverage_ref_bindings_receipt_fk
  foreign key (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  references app_data_agent.research_coverage_derivation_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_candidate_attestation_ref_bindings FK to research_candidate_enumerator_attestations
alter table app_data_agent.research_candidate_attestation_ref_bindings
  add constraint attestation_ref_bindings_attestation_fk
  foreign key (app_id, tenant_id, environment, run_id, attestation_id, attestation_hash)
  references app_data_agent.research_candidate_enumerator_attestations (app_id, tenant_id, environment, run_id, attestation_id, attestation_hash)
  on delete restrict;

-- research_candidate_enumeration_ref_bindings FK to research_candidate_enumeration_receipts
alter table app_data_agent.research_candidate_enumeration_ref_bindings
  add constraint candidate_enum_ref_bindings_receipt_fk
  foreign key (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  references app_data_agent.research_candidate_enumeration_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_stop_derivation_ref_bindings FK to research_stop_derivation_receipts
alter table app_data_agent.research_stop_derivation_ref_bindings
  add constraint stop_ref_bindings_receipt_fk
  foreign key (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  references app_data_agent.research_stop_derivation_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- ============================================================
-- Part 3: FK constraints from companion tables to artifacts
-- ============================================================

-- Budget companion artifact FK
alter table app_data_agent.research_budget_ledger_input_bindings
  add constraint budget_input_bindings_artifact_fk
  foreign key (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  references app_data_agent.artifacts (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  on delete restrict;

-- Coverage companion artifact FK
alter table app_data_agent.research_coverage_derivation_ref_bindings
  add constraint coverage_ref_bindings_artifact_fk
  foreign key (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  references app_data_agent.artifacts (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  on delete restrict;

-- Attestation companion artifact FK
alter table app_data_agent.research_candidate_attestation_ref_bindings
  add constraint attestation_ref_bindings_artifact_fk
  foreign key (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  references app_data_agent.artifacts (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  on delete restrict;

-- Candidate Enumeration companion artifact FK
alter table app_data_agent.research_candidate_enumeration_ref_bindings
  add constraint candidate_enum_ref_bindings_artifact_fk
  foreign key (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  references app_data_agent.artifacts (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  on delete restrict;

-- Stop companion artifact FK
alter table app_data_agent.research_stop_derivation_ref_bindings
  add constraint stop_ref_bindings_artifact_fk
  foreign key (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  references app_data_agent.artifacts (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  on delete restrict;

-- ============================================================
-- Part 4: FK constraints from new tables to existing tables
-- ============================================================

-- research_budget_events FK to research_resource_run_heads
alter table app_data_agent.research_budget_events
  add constraint budget_events_run_head_fk
  foreign key (app_id, tenant_id, environment, run_id)
  references app_data_agent.research_resource_run_heads (app_id, tenant_id, environment, run_id)
  on delete restrict;

-- research_step_operations FK to research_resource_run_heads
alter table app_data_agent.research_step_operations
  add constraint step_operations_run_head_fk
  foreign key (app_id, tenant_id, environment, run_id)
  references app_data_agent.research_resource_run_heads (app_id, tenant_id, environment, run_id)
  on delete restrict;

-- research_step_operations FK to run_attempts
alter table app_data_agent.research_step_operations
  add constraint step_operations_attempt_fk
  foreign key (app_id, tenant_id, environment, attempt_id, outbox_id, run_id, worker_fence)
  references app_data_agent.run_attempts (app_id, tenant_id, environment, attempt_id, outbox_id, run_id, worker_fence)
  on delete restrict;

-- research_budget_ledger_receipts FK to research_resource_run_heads
alter table app_data_agent.research_budget_ledger_receipts
  add constraint budget_ledger_receipts_run_head_fk
  foreign key (app_id, tenant_id, environment, run_id)
  references app_data_agent.research_resource_run_heads (app_id, tenant_id, environment, run_id)
  on delete restrict;

-- research_coverage_derivation_receipts FK to research_budget_ledger_receipts
alter table app_data_agent.research_coverage_derivation_receipts
  add constraint coverage_receipts_budget_fk
  foreign key (app_id, tenant_id, environment, run_id, budget_receipt_id, budget_receipt_hash)
  references app_data_agent.research_budget_ledger_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_candidate_enumerator_attestations FK to research_budget_ledger_receipts
alter table app_data_agent.research_candidate_enumerator_attestations
  add constraint attestations_budget_fk
  foreign key (app_id, tenant_id, environment, run_id, budget_receipt_id, budget_receipt_hash)
  references app_data_agent.research_budget_ledger_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_candidate_enumeration_receipts FK to research_coverage_derivation_receipts
alter table app_data_agent.research_candidate_enumeration_receipts
  add constraint candidate_receipts_coverage_fk
  foreign key (app_id, tenant_id, environment, run_id, coverage_receipt_id, coverage_receipt_hash)
  references app_data_agent.research_coverage_derivation_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_candidate_enumeration_receipts FK to research_candidate_enumerator_attestations
alter table app_data_agent.research_candidate_enumeration_receipts
  add constraint candidate_receipts_attestation_fk
  foreign key (app_id, tenant_id, environment, run_id, enumerator_attestation_id, enumerator_attestation_hash)
  references app_data_agent.research_candidate_enumerator_attestations (app_id, tenant_id, environment, run_id, attestation_id, attestation_hash)
  on delete restrict;

-- research_candidate_enumeration_receipts FK to research_budget_ledger_receipts
alter table app_data_agent.research_candidate_enumeration_receipts
  add constraint candidate_receipts_budget_fk
  foreign key (app_id, tenant_id, environment, run_id, budget_receipt_id, budget_receipt_hash)
  references app_data_agent.research_budget_ledger_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_stop_derivation_receipts FK to research_coverage_derivation_receipts
alter table app_data_agent.research_stop_derivation_receipts
  add constraint stop_receipts_coverage_fk
  foreign key (app_id, tenant_id, environment, run_id, coverage_receipt_id, coverage_receipt_hash)
  references app_data_agent.research_coverage_derivation_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_stop_derivation_receipts FK to research_candidate_enumeration_receipts
alter table app_data_agent.research_stop_derivation_receipts
  add constraint stop_receipts_candidate_fk
  foreign key (app_id, tenant_id, environment, run_id, candidate_receipt_id, candidate_receipt_hash)
  references app_data_agent.research_candidate_enumeration_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_stop_derivation_receipts FK to research_budget_ledger_receipts
alter table app_data_agent.research_stop_derivation_receipts
  add constraint stop_receipts_budget_fk
  foreign key (app_id, tenant_id, environment, run_id, budget_receipt_id, budget_receipt_hash)
  references app_data_agent.research_budget_ledger_receipts (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash)
  on delete restrict;

-- research_input_events FK to research_input_event_heads
alter table app_data_agent.research_input_events
  add constraint input_events_head_fk
  foreign key (app_id, tenant_id, environment, run_id)
  references app_data_agent.research_input_event_heads (app_id, tenant_id, environment, run_id)
  on delete restrict;

-- research_input_event_watermark_receipts FK to research_input_event_heads
alter table app_data_agent.research_input_event_watermark_receipts
  add constraint watermark_receipts_head_fk
  foreign key (app_id, tenant_id, environment, run_id)
  references app_data_agent.research_input_event_heads (app_id, tenant_id, environment, run_id)
  on delete restrict;

-- research_backend_artifact_commit_operations FK to membership
alter table app_data_agent.research_backend_artifact_commit_operations
  add constraint backend_artifact_ops_membership_fk
  foreign key (app_id, tenant_id, environment, principal_id)
  references app_data_agent.memberships (app_id, tenant_id, environment, principal_id)
  on delete restrict;

-- ============================================================
-- Part 5: Indexes for semantic query paths
-- ============================================================

-- research_budget_policy_versions: lookup by tenant
create index idx_budget_policy_versions_tenant
  on app_data_agent.research_budget_policy_versions (app_id, tenant_id, environment);

-- research_enumerator_versions: lookup by tenant
create index idx_enumerator_versions_tenant
  on app_data_agent.research_enumerator_versions (app_id, tenant_id, environment);

-- research_budget_events: query by run_id, epoch, event_kind
create index idx_budget_events_run_epoch
  on app_data_agent.research_budget_events (app_id, tenant_id, environment, run_id, budget_epoch);
create index idx_budget_events_kind
  on app_data_agent.research_budget_events (app_id, tenant_id, environment, run_id, budget_epoch, event_kind);
create index idx_budget_events_chain
  on app_data_agent.research_budget_events (app_id, tenant_id, environment, run_id, budget_epoch, budget_event_seq, event_hash);

-- research_step_operations: query by run_id, step_kind, idempotency
create index idx_step_operations_run
  on app_data_agent.research_step_operations (app_id, tenant_id, environment, run_id);
create index idx_step_operations_kind
  on app_data_agent.research_step_operations (app_id, tenant_id, environment, run_id, step_kind);
create index idx_step_operations_attempt
  on app_data_agent.research_step_operations (app_id, tenant_id, environment, run_id, attempt_id);
create index idx_step_operations_budget
  on app_data_agent.research_step_operations (app_id, tenant_id, environment, run_id, budget_epoch, logical_step_id);

-- research_budget_ledger_receipts: query by run_id, epoch
create index idx_budget_ledger_receipts_run
  on app_data_agent.research_budget_ledger_receipts (app_id, tenant_id, environment, run_id);
create index idx_budget_ledger_receipts_epoch
  on app_data_agent.research_budget_ledger_receipts (app_id, tenant_id, environment, run_id, budget_epoch);

-- research_coverage_derivation_receipts: query by budget receipt
create index idx_coverage_receipts_budget
  on app_data_agent.research_coverage_derivation_receipts (app_id, tenant_id, environment, run_id, budget_receipt_id, budget_receipt_hash);

-- research_candidate_enumerator_attestations: query by budget receipt
create index idx_attestations_budget
  on app_data_agent.research_candidate_enumerator_attestations (app_id, tenant_id, environment, run_id, budget_receipt_id, budget_receipt_hash);
create index idx_attestations_enumerator
  on app_data_agent.research_candidate_enumerator_attestations (app_id, tenant_id, environment, run_id, enumerator_version);

-- research_candidate_enumeration_receipts: query by coverage/attestation
create index idx_candidate_receipts_coverage
  on app_data_agent.research_candidate_enumeration_receipts (app_id, tenant_id, environment, run_id, coverage_receipt_id, coverage_receipt_hash);
create index idx_candidate_receipts_attestation
  on app_data_agent.research_candidate_enumeration_receipts (app_id, tenant_id, environment, run_id, enumerator_attestation_id, enumerator_attestation_hash);

-- research_stop_derivation_receipts: query by coverage/candidate
create index idx_stop_receipts_coverage
  on app_data_agent.research_stop_derivation_receipts (app_id, tenant_id, environment, run_id, coverage_receipt_id, coverage_receipt_hash);
create index idx_stop_receipts_candidate
  on app_data_agent.research_stop_derivation_receipts (app_id, tenant_id, environment, run_id, candidate_receipt_id, candidate_receipt_hash);
create index idx_stop_receipts_decision
  on app_data_agent.research_stop_derivation_receipts (app_id, tenant_id, environment, run_id, decision);

-- research_input_events: query chain
create index idx_input_events_chain
  on app_data_agent.research_input_events (app_id, tenant_id, environment, run_id, event_seq, event_hash);
create index idx_input_events_kind
  on app_data_agent.research_input_events (app_id, tenant_id, environment, run_id, event_kind);

-- research_input_event_watermark_receipts: query by head
create index idx_watermark_receipts_head
  on app_data_agent.research_input_event_watermark_receipts (app_id, tenant_id, environment, run_id, observed_event_seq);

-- research_backend_artifact_commit_operations: query by run
create index idx_backend_artifact_ops_run
  on app_data_agent.research_backend_artifact_commit_operations (app_id, tenant_id, environment, run_id);
create index idx_backend_artifact_ops_mode
  on app_data_agent.research_backend_artifact_commit_operations (app_id, tenant_id, environment, run_id, commit_mode);

-- Companion tables: query by parent
create index idx_budget_input_bindings_parent
  on app_data_agent.research_budget_ledger_input_bindings (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash);
create index idx_coverage_ref_bindings_parent
  on app_data_agent.research_coverage_derivation_ref_bindings (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash);
create index idx_attestation_ref_bindings_parent
  on app_data_agent.research_candidate_attestation_ref_bindings (app_id, tenant_id, environment, run_id, attestation_id, attestation_hash);
create index idx_candidate_enum_ref_bindings_parent
  on app_data_agent.research_candidate_enumeration_ref_bindings (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash);
create index idx_stop_ref_bindings_parent
  on app_data_agent.research_stop_derivation_ref_bindings (app_id, tenant_id, environment, run_id, receipt_id, receipt_hash);

-- Companion tables: query by artifact
create index idx_budget_input_bindings_artifact
  on app_data_agent.research_budget_ledger_input_bindings (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash)
  where artifact_id is not null;
create index idx_coverage_ref_bindings_artifact
  on app_data_agent.research_coverage_derivation_ref_bindings (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash);
create index idx_attestation_ref_bindings_artifact
  on app_data_agent.research_candidate_attestation_ref_bindings (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash);
create index idx_candidate_enum_ref_bindings_artifact
  on app_data_agent.research_candidate_enumeration_ref_bindings (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash);
create index idx_stop_ref_bindings_artifact
  on app_data_agent.research_stop_derivation_ref_bindings (app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash);
-- ============================================================
-- 10600: Internal helper functions
-- ============================================================

create function app_data_agent.u6_verify_receipt_hash(
  p_domain_prefix text,
  p_receipt_id uuid,
  p_receipt_hash text,
  p_components jsonb
) returns boolean
language plpgsql
stable
called on null input
security definer
set search_path = ''
as $$
declare
  v_computed_hash text;
  v_concatenated text;
  v_component record;
begin
  if p_domain_prefix is null or p_receipt_id is null
    or p_receipt_hash is null or p_components is null
    or jsonb_typeof(p_components) <> 'array'
  then
    return false;
  end if;

  v_concatenated := p_domain_prefix || '\x00'::bytea || p_receipt_id::text;

  for v_component in
    select value
    from jsonb_array_elements(p_components)
  loop
    if jsonb_typeof(v_component.value) = 'null' then
      return false;
    end if;
    v_concatenated := v_concatenated || '\x00'::bytea || (v_component.value #>> '{}');
  end loop;

  v_computed_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(v_concatenated, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  return v_computed_hash = p_receipt_hash;
end;
$$;

-- ============================================================
-- 2. u6_cleanup_environment: Clean up all C2 records for an environment
--    Internal function, called by cleanup job only
-- ============================================================

create function app_data_agent.issue_coverage_derivation_receipt_internal(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_receipt_id uuid;
  v_receipt_hash text;
  v_budget_receipt_id uuid;
  v_budget_receipt_hash text;
  v_version_frontier_json jsonb;
  v_version_frontier_hash text;
  v_closure_refs_json jsonb;
  v_coverage_input_hash text;
  v_kernel_version text;
  v_now timestamptz;
  v_input_hash text;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_receipt_id := (cmd #>> '{receipt_id}')::uuid;
    v_budget_receipt_id := (cmd #>> '{budget_receipt_id}')::uuid;
    v_budget_receipt_hash := cmd #>> '{budget_receipt_hash}';
    v_version_frontier_json := cmd #> '{version_frontier}';
    v_version_frontier_hash := cmd #>> '{version_frontier_hash}';
    v_closure_refs_json := cmd #> '{closure_refs}';
    v_coverage_input_hash := cmd #>> '{coverage_input_hash}';
    v_kernel_version := cmd #>> '{kernel_version}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_receipt_id is null
    or v_budget_receipt_id is null or v_budget_receipt_hash is null
    or v_version_frontier_json is null or v_version_frontier_hash is null
    or v_closure_refs_json is null or v_coverage_input_hash is null
    or v_kernel_version is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_input_hash := v_coverage_input_hash;

  v_receipt_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-coverage-derivation-receipt@1.0.0' || '\x00'::bytea ||
        v_receipt_id::text || '\x00'::bytea ||
        v_budget_receipt_id::text || '\x00'::bytea ||
        v_budget_receipt_hash || '\x00'::bytea ||
        v_version_frontier_hash || '\x00'::bytea ||
        v_coverage_input_hash || '\x00'::bytea ||
        v_kernel_version,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into app_data_agent.research_coverage_derivation_receipts (
    app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
    protocol_version, input_hash,
    budget_receipt_id, budget_receipt_hash,
    version_frontier_json, version_frontier_hash,
    closure_refs_json, coverage_input_hash, kernel_version,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
    'coverage-derivation-receipt@1.0.0', v_input_hash,
    v_budget_receipt_id, v_budget_receipt_hash,
    v_version_frontier_json, v_version_frontier_hash,
    v_closure_refs_json, v_coverage_input_hash, v_kernel_version,
    v_now
  );

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_hash', v_receipt_hash,
    'committed_at', v_now
  ));
end;
$$;

-- ============================================================
-- 4. issue_candidate_enumeration_receipt_internal: Internal Candidate issuer
--    Called from Stop Root RPC, no public GRANT
-- ============================================================

create function app_data_agent.issue_candidate_enumeration_receipt_internal(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_receipt_id uuid;
  v_receipt_hash text;
  v_coverage_receipt_id uuid;
  v_coverage_receipt_hash text;
  v_budget_receipt_id uuid;
  v_budget_receipt_hash text;
  v_enumerator_head_version bigint;
  v_enumerator_version bigint;
  v_eig_policy_version bigint;
  v_enumerator_capability_id uuid;
  v_enumerator_authority_epoch bigint;
  v_enumerator_attestation_id uuid;
  v_enumerator_attestation_hash text;
  v_enumeration_universe_hash text;
  v_candidate_set_hash text;
  v_now timestamptz;
  v_input_hash text;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_receipt_id := (cmd #>> '{receipt_id}')::uuid;
    v_coverage_receipt_id := (cmd #>> '{coverage_receipt_id}')::uuid;
    v_coverage_receipt_hash := cmd #>> '{coverage_receipt_hash}';
    v_budget_receipt_id := (cmd #>> '{budget_receipt_id}')::uuid;
    v_budget_receipt_hash := cmd #>> '{budget_receipt_hash}';
    v_enumerator_head_version := (cmd #>> '{enumerator_head_version}')::bigint;
    v_enumerator_version := (cmd #>> '{enumerator_version}')::bigint;
    v_eig_policy_version := (cmd #>> '{eig_policy_version}')::bigint;
    v_enumerator_capability_id := (cmd #>> '{enumerator_capability_id}')::uuid;
    v_enumerator_authority_epoch := (cmd #>> '{enumerator_authority_epoch}')::bigint;
    v_enumerator_attestation_id := (cmd #>> '{enumerator_attestation_id}')::uuid;
    v_enumerator_attestation_hash := cmd #>> '{enumerator_attestation_hash}';
    v_enumeration_universe_hash := cmd #>> '{enumeration_universe_hash}';
    v_candidate_set_hash := cmd #>> '{candidate_set_hash}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_receipt_id is null
    or v_coverage_receipt_id is null or v_coverage_receipt_hash is null
    or v_budget_receipt_id is null or v_budget_receipt_hash is null
    or v_enumerator_head_version is null or v_enumerator_version is null
    or v_eig_policy_version is null or v_enumerator_capability_id is null
    or v_enumerator_authority_epoch is null
    or v_enumerator_attestation_id is null or v_enumerator_attestation_hash is null
    or v_enumeration_universe_hash is null or v_candidate_set_hash is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_input_hash := v_candidate_set_hash;

  v_receipt_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-candidate-enumeration-receipt@2.0.0' || '\x00'::bytea ||
        v_receipt_id::text || '\x00'::bytea ||
        v_coverage_receipt_id::text || '\x00'::bytea ||
        v_coverage_receipt_hash || '\x00'::bytea ||
        v_budget_receipt_id::text || '\x00'::bytea ||
        v_budget_receipt_hash || '\x00'::bytea ||
        v_enumerator_head_version::text || '\x00'::bytea ||
        v_enumerator_version::text || '\x00'::bytea ||
        v_eig_policy_version::text || '\x00'::bytea ||
        v_enumeration_universe_hash || '\x00'::bytea ||
        v_candidate_set_hash,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into app_data_agent.research_candidate_enumeration_receipts (
    app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
    protocol_version, input_hash,
    coverage_receipt_id, coverage_receipt_hash,
    budget_receipt_id, budget_receipt_hash,
    enumerator_head_version, enumerator_version, eig_policy_version,
    enumerator_capability_id, enumerator_authority_epoch,
    enumerator_attestation_id, enumerator_attestation_hash,
    enumeration_universe_hash, candidate_set_hash,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
    'candidate-enumeration-receipt@2.0.0', v_input_hash,
    v_coverage_receipt_id, v_coverage_receipt_hash,
    v_budget_receipt_id, v_budget_receipt_hash,
    v_enumerator_head_version, v_enumerator_version, v_eig_policy_version,
    v_enumerator_capability_id, v_enumerator_authority_epoch,
    v_enumerator_attestation_id, v_enumerator_attestation_hash,
    v_enumeration_universe_hash, v_candidate_set_hash,
    v_now
  );

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_hash', v_receipt_hash,
    'committed_at', v_now
  ));
end;
$$;

-- ============================================================
-- 5. issue_stop_derivation_receipt_internal: Internal Stop issuer
--    Called from Stop Root RPC, no public GRANT
-- ============================================================

create function app_data_agent.issue_stop_derivation_receipt_internal(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_receipt_id uuid;
  v_receipt_hash text;
  v_coverage_receipt_id uuid;
  v_coverage_receipt_hash text;
  v_candidate_receipt_id uuid;
  v_candidate_receipt_hash text;
  v_budget_receipt_id uuid;
  v_budget_receipt_hash text;
  v_pre_stop_readiness_hash text;
  v_kernel_version text;
  v_enumerator_version bigint;
  v_eig_policy_version bigint;
  v_decision text;
  v_decision_input_hash text;
  v_now timestamptz;
  v_input_hash text;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_receipt_id := (cmd #>> '{receipt_id}')::uuid;
    v_coverage_receipt_id := (cmd #>> '{coverage_receipt_id}')::uuid;
    v_coverage_receipt_hash := cmd #>> '{coverage_receipt_hash}';
    v_candidate_receipt_id := (cmd #>> '{candidate_receipt_id}')::uuid;
    v_candidate_receipt_hash := cmd #>> '{candidate_receipt_hash}';
    v_budget_receipt_id := (cmd #>> '{budget_receipt_id}')::uuid;
    v_budget_receipt_hash := cmd #>> '{budget_receipt_hash}';
    v_pre_stop_readiness_hash := cmd #>> '{pre_stop_readiness_hash}';
    v_kernel_version := cmd #>> '{kernel_version}';
    v_enumerator_version := (cmd #>> '{enumerator_version}')::bigint;
    v_eig_policy_version := (cmd #>> '{eig_policy_version}')::bigint;
    v_decision := cmd #>> '{decision}';
    v_decision_input_hash := cmd #>> '{decision_input_hash}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_receipt_id is null
    or v_coverage_receipt_id is null or v_coverage_receipt_hash is null
    or v_candidate_receipt_id is null or v_candidate_receipt_hash is null
    or v_budget_receipt_id is null or v_budget_receipt_hash is null
    or v_pre_stop_readiness_hash is null or v_kernel_version is null
    or v_enumerator_version is null or v_eig_policy_version is null
    or v_decision is null or v_decision_input_hash is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  if v_decision not in (
    'STOP_READY', 'STOP_PARTIAL', 'STOP_NEEDS_MORE_RESEARCH',
    'STOP_INCONCLUSIVE', 'CONTINUE', 'REPLAN',
    'RESEARCH_STOP_INPUT_STALE', 'RESEARCH_STOP_INPUT_INCONSISTENT'
  ) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_DECISION'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_input_hash := v_decision_input_hash;

  v_receipt_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-stop-derivation-receipt@2.0.0' || '\x00'::bytea ||
        v_receipt_id::text || '\x00'::bytea ||
        v_coverage_receipt_id::text || '\x00'::bytea ||
        v_coverage_receipt_hash || '\x00'::bytea ||
        v_candidate_receipt_id::text || '\x00'::bytea ||
        v_candidate_receipt_hash || '\x00'::bytea ||
        v_budget_receipt_id::text || '\x00'::bytea ||
        v_budget_receipt_hash || '\x00'::bytea ||
        v_pre_stop_readiness_hash || '\x00'::bytea ||
        v_kernel_version || '\x00'::bytea ||
        v_enumerator_version::text || '\x00'::bytea ||
        v_eig_policy_version::text || '\x00'::bytea ||
        v_decision || '\x00'::bytea ||
        v_decision_input_hash,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into app_data_agent.research_stop_derivation_receipts (
    app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
    protocol_version, input_hash,
    coverage_receipt_id, coverage_receipt_hash,
    candidate_receipt_id, candidate_receipt_hash,
    budget_receipt_id, budget_receipt_hash,
    pre_stop_readiness_hash, kernel_version,
    enumerator_version, eig_policy_version,
    decision, decision_input_hash,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
    'research-stop-derivation-receipt@2.0.0', v_input_hash,
    v_coverage_receipt_id, v_coverage_receipt_hash,
    v_candidate_receipt_id, v_candidate_receipt_hash,
    v_budget_receipt_id, v_budget_receipt_hash,
    v_pre_stop_readiness_hash, v_kernel_version,
    v_enumerator_version, v_eig_policy_version,
    v_decision, v_decision_input_hash,
    v_now
  );

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_hash', v_receipt_hash,
    'committed_at', v_now
  ));
end;
$$;
-- ============================================================
-- 10600: Resource/Invocation functions for C2a derivation layer
-- ============================================================

-- ============================================================
-- 1. begin_research_step: Begin a research step
--    Creates step operation, advances budget epoch, ties to outbox/attempt
-- ============================================================
create function app_data_agent.begin_research_step(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_step_operation_id uuid;
  v_budget_epoch bigint;
  v_logical_step_id uuid;
  v_parent_logical_step_id uuid;
  v_step_seq bigint;
  v_step_kind text;
  v_step_input_hash text;
  v_outbox_id uuid;
  v_attempt_id uuid;
  v_worker_fence bigint;
  v_principal_id uuid;
  v_idempotency_key text;
  v_step_operation_id uuid;
  v_head record;
  v_existing record;
  v_now timestamptz;
  v_budget_event_seq bigint;
  v_budget_event_hash text;
  v_attempt record;
  v_outbox record;
  v_run record;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_step_operation_id := (cmd #>> '{step_operation_id}')::uuid;
    v_budget_epoch := (cmd #>> '{budget_epoch}')::bigint;
    v_logical_step_id := (cmd #>> '{logical_step_id}')::uuid;
    v_parent_logical_step_id := (cmd #>> '{parent_logical_step_id}')::uuid;
    v_step_seq := (cmd #>> '{step_seq}')::bigint;
    v_step_kind := cmd #>> '{step_kind}';
    v_step_input_hash := cmd #>> '{step_input_hash}';
    v_outbox_id := (cmd #>> '{outbox_id}')::uuid;
    v_attempt_id := (cmd #>> '{attempt_id}')::uuid;
    v_worker_fence := (cmd #>> '{worker_fence}')::bigint;
    v_principal_id := (cmd #>> '{principal_id}')::uuid;
    v_idempotency_key := cmd #>> '{idempotency_key}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_step_operation_id is null
    or v_budget_epoch is null or v_logical_step_id is null
    or v_step_seq is null or v_step_kind is null
    or v_step_input_hash is null
    or v_outbox_id is null or v_attempt_id is null
    or v_worker_fence is null
    or v_principal_id is null or v_idempotency_key is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  if v_step_kind not in (
    'PLAN', 'QUERY', 'EVIDENCE', 'CLAIM', 'ASSESSMENT',
    'COVERAGE', 'STOP', 'REPORT', 'CLARIFICATION', 'REPLAN'
  ) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_STEP_KIND'));
  end if;

  -- Check idempotency
  select step_operation_id, committed_at
  into v_existing
  from app_data_agent.research_step_operations as existing
  where existing.app_id = s_app_id
    and existing.tenant_id = s_tenant_id
    and existing.environment = s_environment
    and existing.run_id = v_run_id
    and existing.idempotency_key = v_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'value', jsonb_build_object(
      'step_operation_id', v_existing.step_operation_id,
      'committed_at', v_existing.committed_at,
      'created', false
    ));
  end if;

  -- Lock run
  select run.*
  into v_run
  from app_data_agent.runs as run
  where run.app_id = s_app_id
    and run.tenant_id = s_environment
    and run.environment = s_environment
    and run.run_id = v_run_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'RUN_NOT_FOUND'));
  end if;

  -- Lock outbox and attempt
  select outbox.*
  into v_outbox
  from app_data_agent.outbox as outbox
  where outbox.app_id = s_app_id
    and outbox.tenant_id = s_tenant_id
    and outbox.environment = s_environment
    and outbox.outbox_id = v_outbox_id
    and outbox.run_id = v_run_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'OUTBOX_NOT_FOUND'));
  end if;

  select attempt.*
  into v_attempt
  from app_data_agent.run_attempts as attempt
  where attempt.app_id = s_app_id
    and attempt.tenant_id = s_tenant_id
    and attempt.environment = s_environment
    and attempt.attempt_id = v_attempt_id
    and attempt.outbox_id = v_outbox_id
    and attempt.run_id = v_run_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'ATTEMPT_NOT_FOUND'));
  end if;

  if v_attempt.worker_fence <> v_worker_fence then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'WORKER_FENCE_MISMATCH'));
  end if;

  -- Lock resource run head
  select head.*
  into v_head
  from app_data_agent.research_resource_run_heads as head
  where head.app_id = s_app_id
    and head.tenant_id = s_tenant_id
    and head.environment = s_environment
    and head.run_id = v_run_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'RESOURCE_HEAD_NOT_FOUND'));
  end if;

  if v_head.budget_epoch <> v_budget_epoch then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'BUDGET_EPOCH_MISMATCH'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_budget_event_seq := v_head.next_budget_event_seq;
  v_budget_event_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-budget-event@1.0.0' || '\x00'::bytea ||
        v_run_id::text || '\x00'::bytea ||
        v_budget_epoch::text || '\x00'::bytea ||
        v_budget_event_seq::text || '\x00'::bytea ||
        'RESERVE' || '\x00'::bytea ||
        'STEP' || '\x00'::bytea ||
        v_step_operation_id::text || '\x00'::bytea ||
        v_head.last_budget_event_hash,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Insert step operation
  insert into app_data_agent.research_step_operations (
    app_id, tenant_id, environment, step_operation_id,
    run_id, budget_epoch, logical_step_id, parent_logical_step_id,
    step_seq, step_kind, step_input_hash,
    outbox_id, attempt_id, worker_fence,
    budget_event_seq, budget_event_hash,
    principal_id, idempotency_key,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_step_operation_id,
    v_run_id, v_budget_epoch, v_logical_step_id, v_parent_logical_step_id,
    v_step_seq, v_step_kind, v_step_input_hash,
    v_outbox_id, v_attempt_id, v_worker_fence,
    v_budget_event_seq, v_budget_event_hash,
    v_principal_id, v_idempotency_key,
    v_now
  );

  -- Update resource run head
  update app_data_agent.research_resource_run_heads as head
  set
    next_step_seq = v_step_seq + 1,
    next_budget_event_seq = v_budget_event_seq + 1,
    last_budget_event_hash = v_budget_event_hash
  where head.app_id = s_app_id
    and head.tenant_id = s_tenant_id
    and head.environment = s_environment
    and head.run_id = v_run_id;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'step_operation_id', v_step_operation_id,
    'budget_event_seq', v_budget_event_seq,
    'budget_event_hash', v_budget_event_hash,
    'committed_at', v_now,
    'created', true
  ));
end;
$$;

-- ============================================================
-- 2. issue_input_event_watermark_receipt_internal: Issue Input Event Watermark Receipt
--    Internal function, called from Root RPCs only
-- ============================================================
create function app_data_agent.issue_input_event_watermark_receipt_internal(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_receipt_id uuid;
  v_receipt_hash text;
  v_observed_event_seq bigint;
  v_observed_head_hash text;
  v_certificate_input_closure_hash text;
  v_certificate_ref_json jsonb;
  v_certificate_artifact_id uuid;
  v_certificate_artifact_type text;
  v_certificate_revision integer;
  v_certificate_content_hash text;
  v_now timestamptz;
  v_input_hash text;
  v_head record;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_receipt_id := (cmd #>> '{receipt_id}')::uuid;
    v_observed_event_seq := (cmd #>> '{observed_event_seq}')::bigint;
    v_observed_head_hash := cmd #>> '{observed_head_hash}';
    v_certificate_input_closure_hash := cmd #>> '{certificate_input_closure_hash}';
    v_certificate_ref_json := cmd #> '{certificate_ref}';
    v_certificate_artifact_id := (cmd #>> '{certificate_ref,artifact_id}')::uuid;
    v_certificate_artifact_type := cmd #>> '{certificate_ref,artifact_type}';
    v_certificate_revision := (cmd #>> '{certificate_ref,revision}')::integer;
    v_certificate_content_hash := cmd #>> '{certificate_ref,content_hash}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_receipt_id is null
    or v_observed_event_seq is null or v_observed_head_hash is null
    or v_certificate_input_closure_hash is null
    or v_certificate_ref_json is null or v_certificate_artifact_id is null
    or v_certificate_artifact_type is null or v_certificate_revision is null
    or v_certificate_content_hash is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Verify input event head
  select head.*
  into v_head
  from app_data_agent.research_input_event_heads as head
  where head.app_id = s_app_id
    and head.tenant_id = s_tenant_id
    and head.environment = s_environment
    and head.run_id = v_run_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INPUT_EVENT_HEAD_NOT_FOUND'));
  end if;

  if v_head.head_event_hash <> v_observed_head_hash then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'HEAD_HASH_MISMATCH'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_input_hash := v_certificate_input_closure_hash;

  -- Compute receipt hash
  v_receipt_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-input-event-watermark-receipt@1.0.0' || '\x00'::bytea ||
        v_receipt_id::text || '\x00'::bytea ||
        v_observed_event_seq::text || '\x00'::bytea ||
        v_observed_head_hash || '\x00'::bytea ||
        v_certificate_input_closure_hash || '\x00'::bytea ||
        v_certificate_artifact_id::text || '\x00'::bytea ||
        v_certificate_artifact_type || '\x00'::bytea ||
        v_certificate_revision::text || '\x00'::bytea ||
        v_certificate_content_hash,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Insert watermark receipt
  insert into app_data_agent.research_input_event_watermark_receipts (
    app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
    protocol_version, input_hash,
    observed_event_seq, observed_head_hash, certificate_input_closure_hash,
    certificate_ref_json, certificate_artifact_id,
    certificate_artifact_type, certificate_revision, certificate_content_hash,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
    'input-event-watermark-receipt@1.0.0', v_input_hash,
    v_observed_event_seq, v_observed_head_hash, v_certificate_input_closure_hash,
    v_certificate_ref_json, v_certificate_artifact_id,
    v_certificate_artifact_type, v_certificate_revision, v_certificate_content_hash,
    v_now
  );

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_hash', v_receipt_hash,
    'committed_at', v_now,
    'created', true
  ));
end;
$$;
-- ============================================================
-- 10600: Budget Receipt issuer/verifier functions
-- ============================================================

-- ============================================================
-- 1. issue_budget_snapshot_receipt: Issue Budget Ledger Receipt
--    Creates budget snapshot, validates epoch/reservation/event state,
--    writes receipt and companion input bindings.
-- ============================================================
create function app_data_agent.issue_budget_snapshot_receipt(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_schema text;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_receipt_id uuid;
  v_receipt_hash text;
  v_snapshot_command_hash text;
  v_runtime_limits_version bigint;
  v_runtime_limits_hash text;
  v_tenant_policy_version bigint;
  v_tenant_policy_hash text;
  v_budget_epoch bigint;
  v_budget_started_at timestamptz;
  v_evaluated_through_reservation_seq bigint;
  v_evaluated_through_budget_event_seq bigint;
  v_evaluated_at timestamptz;
  v_valid_until timestamptz;
  v_outstanding_set_hash text;
  v_active_count bigint;
  v_outcome_unknown_count bigint;
  v_abandoned_count bigint;
  v_actual_used_json jsonb;
  v_unresolved_hold_json jsonb;
  v_ledger_json jsonb;
  v_brief_ref_json jsonb;
  v_brief_artifact_id uuid;
  v_brief_artifact_type text;
  v_brief_revision integer;
  v_brief_content_hash text;
  v_committed_at timestamptz;
  v_head record;
  v_policy record;
  v_principal_id uuid;
  v_idempotency_key text;
  v_existing record;
  v_input_hash text;
  v_binding record;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  s_schema := 'app_data_agent';
  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_receipt_id := (cmd #>> '{receipt_id}')::uuid;
    v_snapshot_command_hash := cmd #>> '{snapshot_command_hash}';
    v_runtime_limits_version := (cmd #>> '{runtime_limits_version}')::bigint;
    v_runtime_limits_hash := cmd #>> '{runtime_limits_hash}';
    v_tenant_policy_version := (cmd #>> '{tenant_policy_version}')::bigint;
    v_tenant_policy_hash := cmd #>> '{tenant_policy_hash}';
    v_budget_epoch := (cmd #>> '{budget_epoch}')::bigint;
    v_evaluated_through_reservation_seq := (cmd #>> '{evaluated_through_reservation_seq}')::bigint;
    v_evaluated_through_budget_event_seq := (cmd #>> '{evaluated_through_budget_event_seq}')::bigint;
    v_valid_until := (cmd #>> '{valid_until}')::timestamptz;
    v_outstanding_set_hash := cmd #>> '{outstanding_set_hash}';
    v_active_count := (cmd #>> '{active_count}')::bigint;
    v_outcome_unknown_count := (cmd #>> '{outcome_unknown_count}')::bigint;
    v_abandoned_count := (cmd #>> '{abandoned_count}')::bigint;
    v_actual_used_json := cmd #> '{actual_used}';
    v_unresolved_hold_json := cmd #> '{unresolved_hold}';
    v_ledger_json := cmd #> '{ledger}';
    v_brief_ref_json := cmd #> '{research_brief_ref}';
    v_brief_artifact_id := (cmd #>> '{research_brief_ref,artifact_id}')::uuid;
    v_brief_artifact_type := cmd #>> '{research_brief_ref,artifact_type}';
    v_brief_revision := (cmd #>> '{research_brief_ref,revision}')::integer;
    v_brief_content_hash := cmd #>> '{research_brief_ref,content_hash}';
    v_principal_id := (cmd #>> '{principal_id}')::uuid;
    v_idempotency_key := cmd #>> '{idempotency_key}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_receipt_id is null
    or v_snapshot_command_hash is null
    or v_runtime_limits_version is null or v_runtime_limits_hash is null
    or v_tenant_policy_version is null or v_tenant_policy_hash is null
    or v_budget_epoch is null
    or v_evaluated_through_reservation_seq is null
    or v_evaluated_through_budget_event_seq is null
    or v_valid_until is null
    or v_outstanding_set_hash is null
    or v_active_count is null or v_outcome_unknown_count is null or v_abandoned_count is null
    or v_actual_used_json is null or v_unresolved_hold_json is null or v_ledger_json is null
    or v_brief_ref_json is null or v_brief_artifact_id is null
    or v_brief_artifact_type is null or v_brief_revision is null or v_brief_content_hash is null
    or v_principal_id is null or v_idempotency_key is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Verify environment
  if s_environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_ENVIRONMENT'));
  end if;

  -- Check idempotency
  select receipt_id, receipt_hash, committed_at
  into v_existing
  from app_data_agent.research_budget_ledger_receipts as existing
  where existing.app_id = s_app_id
    and existing.tenant_id = s_tenant_id
    and existing.environment = s_environment
    and existing.run_id = v_run_id
    and existing.receipt_id = v_receipt_id;
  if found then
    return jsonb_build_object('ok', true, 'value', jsonb_build_object(
      'receipt_id', v_existing.receipt_id,
      'receipt_hash', v_existing.receipt_hash,
      'committed_at', v_existing.committed_at,
      'created', false
    ));
  end if;

  -- Verify budget epoch state from head
  select head.budget_epoch, head.budget_epoch_state, head.budget_started_at,
         head.next_budget_event_seq, head.last_budget_event_hash
  into v_head
  from app_data_agent.research_resource_run_heads as head
  where head.app_id = s_app_id
    and head.tenant_id = s_tenant_id
    and head.environment = s_environment
    and head.run_id = v_run_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'RUN_HEAD_NOT_FOUND'));
  end if;
  if v_head.budget_epoch_state = 'LEGACY' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'BUDGET_EPOCH_LEGACY'));
  end if;
  if v_head.budget_epoch <> v_budget_epoch then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'BUDGET_EPOCH_MISMATCH'));
  end if;
  if v_head.evaluated_through_budget_event_seq > v_evaluated_through_budget_event_seq then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'BUDGET_EVENT_SEQ_STALE'));
  end if;

  v_budget_started_at := v_head.budget_started_at;
  v_evaluated_at := pg_catalog.clock_timestamp();

  -- Compute receipt hash
  v_receipt_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-budget-ledger-receipt@1.0.0' || '\x00'::bytea ||
        v_snapshot_command_hash || '\x00'::bytea ||
        v_receipt_id::text || '\x00'::bytea ||
        v_budget_epoch::text || '\x00'::bytea ||
        v_evaluated_through_reservation_seq::text || '\x00'::bytea ||
        v_evaluated_through_budget_event_seq::text || '\x00'::bytea ||
        v_outstanding_set_hash || '\x00'::bytea ||
        v_active_count::text || '\x00'::bytea ||
        v_outcome_unknown_count::text || '\x00'::bytea ||
        v_abandoned_count::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Insert receipt
  insert into app_data_agent.research_budget_ledger_receipts (
    app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
    protocol_version, input_hash,
    snapshot_command_hash, runtime_limits_version, runtime_limits_hash,
    tenant_policy_version, tenant_policy_hash,
    budget_epoch, budget_started_at,
    evaluated_through_reservation_seq, evaluated_through_budget_event_seq,
    evaluated_at, valid_until,
    outstanding_set_hash, active_count, outcome_unknown_count, abandoned_count,
    actual_used_json, unresolved_hold_json, ledger_json,
    research_brief_ref_json, research_brief_artifact_id, research_brief_artifact_type,
    research_brief_revision, research_brief_content_hash,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
    'budget-ledger-receipt@1.0.0', v_receipt_hash,
    v_snapshot_command_hash, v_runtime_limits_version, v_runtime_limits_hash,
    v_tenant_policy_version, v_tenant_policy_hash,
    v_budget_epoch, v_budget_started_at,
    v_evaluated_through_reservation_seq, v_evaluated_through_budget_event_seq,
    v_evaluated_at, v_valid_until,
    v_outstanding_set_hash, v_active_count, v_outcome_unknown_count, v_abandoned_count,
    v_actual_used_json, v_unresolved_hold_json, v_ledger_json,
    v_brief_ref_json, v_brief_artifact_id, v_brief_artifact_type,
    v_brief_revision, v_brief_content_hash,
    v_evaluated_at
  );

  -- Insert companion input bindings
  for v_binding in
    select value
    from jsonb_array_elements(cmd #> '{input_bindings}')
  loop
    insert into app_data_agent.research_budget_ledger_input_bindings (
      app_id, tenant_id, environment, run_id, receipt_id, receipt_hash,
      canonical_path, binding_group, ordinal, binding_kind,
      strict_ref_json, artifact_id, artifact_type, revision, content_hash, node_id,
      budget_epoch, budget_event_seq, event_hash,
      reservation_id, reservation_seq, reservation_state,
      reservation_projection_json, reservation_projection_hash
    ) values (
      s_app_id, s_tenant_id, s_environment, v_run_id, v_receipt_id, v_receipt_hash,
      v_binding #>> '{canonical_path}',
      v_binding #>> '{binding_group}',
      (v_binding #>> '{ordinal}')::integer,
      v_binding #>> '{binding_kind}',
      v_binding #> '{strict_ref_json}',
      (v_binding #>> '{artifact_id}')::uuid,
      v_binding #>> '{artifact_type}',
      (v_binding #>> '{revision}')::integer,
      v_binding #>> '{content_hash}',
      v_binding #>> '{node_id}',
      (v_binding #>> '{budget_epoch}')::bigint,
      (v_binding #>> '{budget_event_seq}')::bigint,
      v_binding #>> '{event_hash}',
      (v_binding #>> '{reservation_id}')::uuid,
      (v_binding #>> '{reservation_seq}')::bigint,
      v_binding #>> '{reservation_state}',
      v_binding #> '{reservation_projection}',
      v_binding #>> '{reservation_projection_hash}'
    );
  end loop;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_hash', v_receipt_hash,
    'committed_at', v_evaluated_at,
    'created', true
  ));
end;
$$;

-- ============================================================
-- 2. verify_budget_snapshot_receipt: Verify Budget Ledger Receipt
--    Recomputes hash and validates epoch/event chain integrity
-- ============================================================
create function app_data_agent.verify_budget_snapshot_receipt(
  input_json jsonb
) returns jsonb
language plpgsql
stable
called on null input
security definer
set search_path = ''
as $$
declare
  v_receipt record;
  v_computed_hash text;
  v_binding_count integer;
  v_expected_binding_count integer;
begin
  if input_json is null or jsonb_typeof(input_json) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  select receipt.*
  into v_receipt
  from app_data_agent.research_budget_ledger_receipts as receipt
  where receipt.app_id = (input_json #>> '{scope,app_id}')::uuid
    and receipt.tenant_id = (input_json #>> '{scope,tenant_id}')::uuid
    and receipt.environment = input_json #>> '{scope,environment}'
    and receipt.run_id = (input_json #>> '{run_id}')::uuid
    and receipt.receipt_id = (input_json #>> '{receipt_id}')::uuid;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'RECEIPT_NOT_FOUND'));
  end if;

  v_computed_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-budget-ledger-receipt@1.0.0' || '\x00'::bytea ||
        v_receipt.snapshot_command_hash || '\x00'::bytea ||
        v_receipt.receipt_id::text || '\x00'::bytea ||
        v_receipt.budget_epoch::text || '\x00'::bytea ||
        v_receipt.evaluated_through_reservation_seq::text || '\x00'::bytea ||
        v_receipt.evaluated_through_budget_event_seq::text || '\x00'::bytea ||
        v_receipt.outstanding_set_hash || '\x00'::bytea ||
        v_receipt.active_count::text || '\x00'::bytea ||
        v_receipt.outcome_unknown_count::text || '\x00'::bytea ||
        v_receipt.abandoned_count::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  if v_receipt.receipt_hash <> v_computed_hash then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'HASH_MISMATCH'));
  end if;

  -- Verify companion bindings closed set
  select count(*) into v_binding_count
  from app_data_agent.research_budget_ledger_input_bindings as binding
  where binding.app_id = v_receipt.app_id
    and binding.tenant_id = v_receipt.tenant_id
    and binding.environment = v_receipt.environment
    and binding.run_id = v_receipt.run_id
    and binding.receipt_id = v_receipt.receipt_id
    and binding.receipt_hash = v_receipt.receipt_hash;

  v_expected_binding_count := (input_json #>> '{expected_binding_count}')::integer;
  if v_expected_binding_count is not null and v_binding_count <> v_expected_binding_count then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'BINDING_COUNT_MISMATCH'));
  end if;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'receipt_id', v_receipt.receipt_id,
    'receipt_hash', v_receipt.receipt_hash,
    'committed_at', v_receipt.committed_at,
    'valid_until', v_receipt.valid_until,
    'binding_count', v_binding_count
  ));
end;
$$;

-- ============================================================
-- 3. issue_budget_epoch_advance: Advance budget epoch
--    Creates a new epoch with updated head state
-- ============================================================
create function app_data_agent.issue_budget_epoch_advance(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_new_budget_epoch bigint;
  v_next_budget_event_seq bigint;
  v_next_step_seq bigint;
  v_budget_event_hash text;
  v_principal_id uuid;
  v_idempotency_key text;
  v_head record;
  v_now timestamptz;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_new_budget_epoch := (cmd #>> '{new_budget_epoch}')::bigint;
    v_principal_id := (cmd #>> '{principal_id}')::uuid;
    v_idempotency_key := cmd #>> '{idempotency_key}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_new_budget_epoch is null
    or v_principal_id is null or v_idempotency_key is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  select head.*
  into v_head
  from app_data_agent.research_resource_run_heads as head
  where head.app_id = s_app_id
    and head.tenant_id = s_tenant_id
    and head.environment = s_environment
    and head.run_id = v_run_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'RUN_HEAD_NOT_FOUND'));
  end if;

  if v_head.budget_epoch_state = 'LEGACY' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'BUDGET_EPOCH_LEGACY'));
  end if;

  if v_new_budget_epoch <= v_head.budget_epoch then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'BUDGET_EPOCH_NOT_MONOTONIC'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_next_budget_event_seq := v_head.next_budget_event_seq;
  v_next_step_seq := v_head.next_step_seq;

  -- Compute event hash for EPOCH_ADVANCE
  v_budget_event_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-budget-event@1.0.0' || '\x00'::bytea ||
        v_run_id::text || '\x00'::bytea ||
        v_head.budget_epoch::text || '\x00'::bytea ||
        v_next_budget_event_seq::text || '\x00'::bytea ||
        'EPOCH_ADVANCE' || '\x00'::bytea ||
        v_new_budget_epoch::text || '\x00'::bytea ||
        coalesce(v_head.last_budget_event_hash, 'sha256:0000000000000000000000000000000000000000000000000000000000000000'),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Insert budget event
  insert into app_data_agent.research_budget_events (
    app_id, tenant_id, environment, run_id, budget_epoch, budget_event_seq,
    event_kind, source_operation_kind, source_operation_id,
    actual_before_json, actual_after_json,
    hold_before_json, hold_after_json,
    previous_event_hash, event_hash, committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id,
    v_head.budget_epoch, v_next_budget_event_seq,
    'EPOCH_ADVANCE', 'EPOCH', v_receipt_id,
    '{}'::jsonb, '{}'::jsonb,
    '{}'::jsonb, '{}'::jsonb,
    v_head.last_budget_event_hash, v_budget_event_hash, v_now
  );

  -- Update head to new epoch
  update app_data_agent.research_resource_run_heads as head
  set
    budget_epoch = v_new_budget_epoch,
    budget_epoch_state = 'ACTIVE',
    budget_started_at = v_now,
    next_budget_event_seq = 0,
    last_budget_event_hash = null
  where head.app_id = s_app_id
    and head.tenant_id = s_tenant_id
    and head.environment = s_environment
    and head.run_id = v_run_id;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'previous_budget_epoch', v_head.budget_epoch,
    'new_budget_epoch', v_new_budget_epoch,
    'budget_event_hash', v_budget_event_hash,
    'committed_at', v_now
  ));
end;
$$;

-- ============================================================
-- 4. issue_budget_event: Issue a budget event (RESERVE/RELEASE/CONSUME/etc.)
-- ============================================================
create function app_data_agent.issue_budget_event(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_event_kind text;
  v_source_operation_kind text;
  v_source_operation_id uuid;
  v_reservation_id uuid;
  v_logical_step_id uuid;
  v_actual_before_json jsonb;
  v_actual_after_json jsonb;
  v_hold_before_json jsonb;
  v_hold_after_json jsonb;
  v_uncertainty_before_json jsonb;
  v_uncertainty_after_json jsonb;
  v_head record;
  v_event_seq bigint;
  v_previous_hash text;
  v_event_hash text;
  v_now timestamptz;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_event_kind := cmd #>> '{event_kind}';
    v_source_operation_kind := cmd #>> '{source_operation_kind}';
    v_source_operation_id := (cmd #>> '{source_operation_id}')::uuid;
    v_reservation_id := (cmd #>> '{reservation_id}')::uuid;
    v_logical_step_id := (cmd #>> '{logical_step_id}')::uuid;
    v_actual_before_json := cmd #> '{actual_before}';
    v_actual_after_json := cmd #> '{actual_after}';
    v_hold_before_json := cmd #> '{hold_before}';
    v_hold_after_json := cmd #> '{hold_after}';
    v_uncertainty_before_json := cmd #> '{uncertainty_before}';
    v_uncertainty_after_json := cmd #> '{uncertainty_after}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_event_kind is null
    or v_source_operation_kind is null or v_source_operation_id is null
    or v_actual_before_json is null or v_actual_after_json is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  select head.*
  into v_head
  from app_data_agent.research_resource_run_heads as head
  where head.app_id = s_app_id
    and head.tenant_id = s_tenant_id
    and head.environment = s_environment
    and head.run_id = v_run_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'RUN_HEAD_NOT_FOUND'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_event_seq := v_head.next_budget_event_seq;
  v_previous_hash := v_head.last_budget_event_hash;

  v_event_hash := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'u6-budget-event@1.0.0' || '\x00'::bytea ||
        v_run_id::text || '\x00'::bytea ||
        v_head.budget_epoch::text || '\x00'::bytea ||
        v_event_seq::text || '\x00'::bytea ||
        v_event_kind || '\x00'::bytea ||
        v_source_operation_kind || '\x00'::bytea ||
        v_source_operation_id::text || '\x00'::bytea ||
        v_actual_before_json::text || '\x00'::bytea ||
        v_actual_after_json::text || '\x00'::bytea ||
        coalesce(v_previous_hash, 'sha256:0000000000000000000000000000000000000000000000000000000000000000'),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into app_data_agent.research_budget_events (
    app_id, tenant_id, environment, run_id, budget_epoch, budget_event_seq,
    event_kind, source_operation_kind, source_operation_id,
    reservation_id, logical_step_id,
    actual_before_json, actual_after_json,
    hold_before_json, hold_after_json,
    uncertainty_before_json, uncertainty_after_json,
    previous_event_hash, event_hash, committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id,
    v_head.budget_epoch, v_event_seq,
    v_event_kind, v_source_operation_kind, v_source_operation_id,
    v_reservation_id, v_logical_step_id,
    v_actual_before_json, v_actual_after_json,
    v_hold_before_json, v_hold_after_json,
    v_uncertainty_before_json, v_uncertainty_after_json,
    v_previous_hash, v_event_hash, v_now
  );

  update app_data_agent.research_resource_run_heads as head
  set
    next_budget_event_seq = v_event_seq + 1,
    last_budget_event_hash = v_event_hash
  where head.app_id = s_app_id
    and head.tenant_id = s_tenant_id
    and head.environment = s_environment
    and head.run_id = v_run_id;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'budget_epoch', v_head.budget_epoch,
    'budget_event_seq', v_event_seq,
    'event_hash', v_event_hash,
    'committed_at', v_now
  ));
end;
$$;

-- ============================================================
-- 5. verify_budget_event_chain: Verify budget event chain integrity
-- ============================================================
create function app_data_agent.verify_budget_event_chain(
  input_json jsonb
) returns jsonb
language plpgsql
stable
called on null input
security definer
set search_path = ''
as $$
declare
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_start_epoch bigint;
  v_end_epoch bigint;
  v_event record;
  v_previous_hash text;
  v_computed_hash text;
  v_chain_broken boolean;
  v_checked_count integer;
begin
  if input_json is null or jsonb_typeof(input_json) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (input_json #>> '{scope,app_id}')::uuid;
    s_tenant_id := (input_json #>> '{scope,tenant_id}')::uuid;
    s_environment := input_json #>> '{scope,environment}';
    v_run_id := (input_json #>> '{run_id}')::uuid;
    v_start_epoch := (input_json #>> '{start_epoch}')::bigint;
    v_end_epoch := (input_json #>> '{end_epoch}')::bigint;
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_start_epoch is null or v_end_epoch is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  v_chain_broken := false;
  v_checked_count := 0;
  v_previous_hash := null;

  for v_event in
    select event.*
    from app_data_agent.research_budget_events as event
    where event.app_id = s_app_id
      and event.tenant_id = s_tenant_id
      and event.environment = s_environment
      and event.run_id = v_run_id
      and event.budget_epoch between v_start_epoch and v_end_epoch
    order by event.budget_epoch, event.budget_event_seq
  loop
    v_computed_hash := 'sha256:' || pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          'u6-budget-event@1.0.0' || '\x00'::bytea ||
          v_event.run_id::text || '\x00'::bytea ||
          v_event.budget_epoch::text || '\x00'::bytea ||
          v_event.budget_event_seq::text || '\x00'::bytea ||
          v_event.event_kind || '\x00'::bytea ||
          v_event.source_operation_kind || '\x00'::bytea ||
          v_event.source_operation_id::text || '\x00'::bytea ||
          v_event.actual_before_json::text || '\x00'::bytea ||
          v_event.actual_after_json::text || '\x00'::bytea ||
          coalesce(v_event.previous_event_hash, 'sha256:0000000000000000000000000000000000000000000000000000000000000000'),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    if v_event.event_hash <> v_computed_hash then
      v_chain_broken := true;
      exit;
    end if;

    if v_previous_hash is not null
      and v_event.previous_event_hash is not null
      and v_event.previous_event_hash <> v_previous_hash
    then
      v_chain_broken := true;
      exit;
    end if;

    v_previous_hash := v_event.event_hash;
    v_checked_count := v_checked_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'chain_intact', not v_chain_broken,
    'checked_count', v_checked_count,
    'last_event_hash', v_previous_hash
  ));
end;
$$;
-- ============================================================
-- 10600: Stop Root RPCs
-- ============================================================

create function app_data_agent.commit_research_stop_terminal(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_stop_receipt_id uuid;
  v_stop_receipt_hash text;
  v_terminal_decision text;
  v_principal_id uuid;
  v_idempotency_key text;
  v_stop_receipt record;
  v_existing record;
  v_now timestamptz;
  v_terminal text;
  v_reason_code text;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_stop_receipt_id := (cmd #>> '{stop_receipt_id}')::uuid;
    v_stop_receipt_hash := cmd #>> '{stop_receipt_hash}';
    v_terminal_decision := cmd #>> '{terminal_decision}';
    v_principal_id := (cmd #>> '{principal_id}')::uuid;
    v_idempotency_key := cmd #>> '{idempotency_key}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_stop_receipt_id is null or v_stop_receipt_hash is null
    or v_terminal_decision is null or v_principal_id is null or v_idempotency_key is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Resolve terminal and reason code from decision
  case v_terminal_decision
    when 'STOP_PARTIAL' then
      v_terminal := 'PARTIAL';
      v_reason_code := 'EVIDENCE_PARTIAL';
    when 'STOP_NEEDS_MORE_RESEARCH' then
      v_terminal := 'NEEDS_MORE_RESEARCH';
      v_reason_code := 'EVIDENCE_COVERAGE_INSUFFICIENT';
    when 'STOP_INCONCLUSIVE' then
      v_terminal := 'INCONCLUSIVE';
      v_reason_code := 'ANALYSIS_INCONCLUSIVE';
    else
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_TERMINAL_DECISION'));
  end case;

  -- Check idempotency
  select terminal.*
  into v_existing
  from app_data_agent.research_domain_terminals as terminal
  where terminal.app_id = s_app_id
    and terminal.tenant_id = s_tenant_id
    and terminal.environment = s_environment
    and terminal.run_id = v_run_id
    and terminal.authority_kind = 'RESEARCH_STOP';
  if found then
    return jsonb_build_object('ok', true, 'value', jsonb_build_object(
      'run_id', v_run_id,
      'terminal', v_existing.terminal,
      'reason_code', v_existing.reason_code,
      'committed_at', v_existing.committed_at,
      'created', false
    ));
  end if;

  -- Verify stop receipt exists and hash matches
  select receipt.*
  into v_stop_receipt
  from app_data_agent.research_stop_derivation_receipts as receipt
  where receipt.app_id = s_app_id
    and receipt.tenant_id = s_tenant_id
    and receipt.environment = s_environment
    and receipt.run_id = v_run_id
    and receipt.receipt_id = v_stop_receipt_id
    and receipt.receipt_hash = v_stop_receipt_hash;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'STOP_RECEIPT_NOT_FOUND'));
  end if;

  -- Verify decision matches
  if v_stop_receipt.decision <> v_terminal_decision then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'DECISION_MISMATCH'));
  end if;

  v_now := pg_catalog.clock_timestamp();

  -- Insert stop terminal commit
  insert into app_data_agent.research_stop_terminal_commits (
    app_id, tenant_id, environment, run_id, commit_id, operation_json,
    stop_derivation_receipt_id, stop_derivation_receipt_hash,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id,
    extensions.gen_random_uuid(),
    jsonb_build_object(
      'protocol_version', 'research-stop-terminal-commit@2.0.0',
      'payload', jsonb_build_object(
        'terminal', v_terminal,
        'reason_code', v_reason_code,
        'stop_receipt_id', v_stop_receipt_id,
        'stop_receipt_hash', v_stop_receipt_hash,
        'principal_id', v_principal_id
      )
    ),
    v_stop_receipt_id, v_stop_receipt_hash,
    v_now
  );

  -- Insert domain terminal
  insert into app_data_agent.research_domain_terminals (
    app_id, tenant_id, environment, run_id, terminal_id,
    authority_kind, terminal, reason_code,
    operation_json,
    stop_derivation_receipt_id, stop_derivation_receipt_hash,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id,
    extensions.gen_random_uuid(),
    'RESEARCH_STOP', v_terminal, v_reason_code,
    jsonb_build_object(
      'protocol_version', 'research-domain-terminal@2.0.0',
      'payload', jsonb_build_object(
        'terminal', v_terminal,
        'reason_code', v_reason_code,
        'stop_receipt_id', v_stop_receipt_id,
        'stop_receipt_hash', v_stop_receipt_hash,
        'principal_id', v_principal_id
      )
    ),
    v_stop_receipt_id, v_stop_receipt_hash,
    v_now
  );

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'run_id', v_run_id,
    'terminal', v_terminal,
    'reason_code', v_reason_code,
    'committed_at', v_now,
    'created', true
  ));
end;
$$;

-- ============================================================
-- 2. publish_current_readiness: Publish Current Readiness (CURRENT)
--    Validates frontier, certificate, and creates CURRENT readiness
-- ============================================================

create function app_data_agent.publish_current_readiness(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_readiness_publication_id uuid;
  v_certificate_ref_json jsonb;
  v_certificate_artifact_id uuid;
  v_certificate_artifact_type text;
  v_certificate_revision integer;
  v_certificate_content_hash text;
  v_principal_id uuid;
  v_idempotency_key text;
  v_frontier_hash text;
  v_existing_readiness record;
  v_now timestamptz;
  v_readiness_id uuid;
  v_publication_id uuid;
  v_certificate record;
  v_head record;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_readiness_publication_id := (cmd #>> '{readiness_publication_id}')::uuid;
    v_certificate_ref_json := cmd #> '{certificate_ref}';
    v_certificate_artifact_id := (cmd #>> '{certificate_ref,artifact_id}')::uuid;
    v_certificate_artifact_type := cmd #>> '{certificate_ref,artifact_type}';
    v_certificate_revision := (cmd #>> '{certificate_ref,revision}')::integer;
    v_certificate_content_hash := cmd #>> '{certificate_ref,content_hash}';
    v_principal_id := (cmd #>> '{principal_id}')::uuid;
    v_idempotency_key := cmd #>> '{idempotency_key}';
    v_frontier_hash := cmd #>> '{frontier_hash}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_readiness_publication_id is null
    or v_certificate_ref_json is null or v_certificate_artifact_id is null
    or v_certificate_artifact_type is null or v_certificate_revision is null
    or v_certificate_content_hash is null
    or v_principal_id is null or v_idempotency_key is null
    or v_frontier_hash is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Lock current readiness for CAS
  select readiness.*
  into v_existing_readiness
  from app_data_agent.research_current_readiness as readiness
  where readiness.app_id = s_app_id
    and readiness.tenant_id = s_tenant_id
    and readiness.environment = s_environment
    and readiness.run_id = v_run_id
  for update;

  -- Only ABSENT or REVOKED can become CURRENT
  if found and v_existing_readiness.state = 'CURRENT' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'ALREADY_CURRENT'));
  end if;

  -- Verify domain terminal is READY
  select terminal.*
  into v_head
  from app_data_agent.research_domain_terminals as terminal
  where terminal.app_id = s_app_id
    and terminal.tenant_id = s_tenant_id
    and terminal.environment = s_environment
    and terminal.run_id = v_run_id
    and terminal.terminal = 'READY';
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'NO_READY_TERMINAL'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_readiness_id := extensions.gen_random_uuid();
  v_publication_id := v_readiness_publication_id;

  -- Insert or update current readiness
  if not found then
    insert into app_data_agent.research_current_readiness (
      app_id, tenant_id, environment, run_id, readiness_id,
      state, certificate_ref_json, certificate_artifact_id,
      certificate_artifact_type, certificate_revision, certificate_content_hash,
      frontier_hash, authority_epoch, publication_id,
      committed_at, revoked_at
    ) values (
      s_app_id, s_tenant_id, s_environment, v_run_id, v_readiness_id,
      'CURRENT', v_certificate_ref_json, v_certificate_artifact_id,
      v_certificate_artifact_type, v_certificate_revision, v_certificate_content_hash,
      v_frontier_hash, 0, v_publication_id,
      v_now, null
    );
  else
    update app_data_agent.research_current_readiness as readiness
    set
      state = 'CURRENT',
      readiness_id = v_readiness_id,
      certificate_ref_json = v_certificate_ref_json,
      certificate_artifact_id = v_certificate_artifact_id,
      certificate_artifact_type = v_certificate_artifact_type,
      certificate_revision = v_certificate_revision,
      certificate_content_hash = v_certificate_content_hash,
      frontier_hash = v_frontier_hash,
      authority_epoch = v_existing_readiness.authority_epoch + 1,
      publication_id = v_publication_id,
      committed_at = v_now,
      revoked_at = null
    where readiness.app_id = s_app_id
      and readiness.tenant_id = s_tenant_id
      and readiness.environment = s_environment
      and readiness.run_id = v_run_id;
  end if;

  -- Insert readiness publication
  insert into app_data_agent.research_readiness_publications (
    app_id, tenant_id, environment, run_id, publication_id,
    readiness_id, state, certificate_ref_json, certificate_artifact_id,
    certificate_artifact_type, certificate_revision, certificate_content_hash,
    frontier_hash, authority_epoch, principal_id, idempotency_key,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_publication_id,
    v_readiness_id, 'CURRENT', v_certificate_ref_json, v_certificate_artifact_id,
    v_certificate_artifact_type, v_certificate_revision, v_certificate_content_hash,
    v_frontier_hash, 0, v_principal_id, v_idempotency_key,
    v_now
  );

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'readiness_id', v_readiness_id,
    'publication_id', v_publication_id,
    'state', 'CURRENT',
    'committed_at', v_now,
    'created', true
  ));
end;
$$;

-- ============================================================
-- 3. consume_current_ready: Consume Current Readiness (DOMAIN_TERMINAL)
--    Validates CURRENT state, creates READY domain terminal, marks consumed
-- ============================================================

create function app_data_agent.consume_current_ready(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_consumption_id uuid;
  v_principal_id uuid;
  v_idempotency_key text;
  v_readiness record;
  v_existing_consumption record;
  v_now timestamptz;
  v_terminal_id uuid;
  v_certificate record;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_consumption_id := (cmd #>> '{consumption_id}')::uuid;
    v_principal_id := (cmd #>> '{principal_id}')::uuid;
    v_idempotency_key := cmd #>> '{idempotency_key}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_consumption_id is null
    or v_principal_id is null or v_idempotency_key is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Check for existing consumption
  select consumption.*
  into v_existing_consumption
  from app_data_agent.research_readiness_consumptions as consumption
  where consumption.app_id = s_app_id
    and consumption.tenant_id = s_tenant_id
    and consumption.environment = s_environment
    and consumption.run_id = v_run_id
    and consumption.principal_id = v_principal_id
    and consumption.idempotency_key = v_idempotency_key;
  if found then
    return jsonb_build_object('ok', true, 'value', jsonb_build_object(
      'run_id', v_run_id,
      'terminal', 'READY',
      'committed_at', v_existing_consumption.committed_at,
      'created', false
    ));
  end if;

  -- Lock and verify current readiness
  select readiness.*
  into v_readiness
  from app_data_agent.research_current_readiness as readiness
  where readiness.app_id = s_app_id
    and readiness.tenant_id = s_tenant_id
    and readiness.environment = s_environment
    and readiness.run_id = v_run_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'NO_CURRENT_READINESS'));
  end if;
  if v_readiness.state <> 'CURRENT' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'READINESS_NOT_CURRENT'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_terminal_id := extensions.gen_random_uuid();

  -- Insert domain terminal
  insert into app_data_agent.research_domain_terminals (
    app_id, tenant_id, environment, run_id, terminal_id,
    authority_kind, terminal, reason_code,
    operation_json,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_terminal_id,
    'CURRENT_READINESS', 'READY', 'RUN_READY',
    jsonb_build_object(
      'protocol_version', 'research-domain-terminal@2.0.0',
      'payload', jsonb_build_object(
        'terminal', 'READY',
        'reason_code', 'RUN_READY',
        'principal_id', v_principal_id,
        'readiness_id', v_readiness.readiness_id
      )
    ),
    v_now
  );

  -- Insert consumption
  insert into app_data_agent.research_readiness_consumptions (
    app_id, tenant_id, environment, run_id, consumption_id,
    readiness_id, terminal_id,
    principal_id, idempotency_key,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_consumption_id,
    v_readiness.readiness_id, v_terminal_id,
    v_principal_id, v_idempotency_key,
    v_now
  );

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'run_id', v_run_id,
    'terminal', 'READY',
    'terminal_id', v_terminal_id,
    'committed_at', v_now,
    'created', true
  ));
end;
$$;

-- ============================================================
-- 4. grant_issue: Issue a Report Read Grant
-- ============================================================
-- ============================================================
-- 10600: Resolver/Provisioner RPCs
-- ============================================================

create function app_data_agent.grant_issue(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  cmd jsonb;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_grant_id uuid;
  v_principal_id uuid;
  v_ttl_seconds integer;
  v_canonical_response_hash text;
  v_readiness record;
  v_now timestamptz;
  v_expires_at timestamptz;
begin
  cmd := input_json;
  if cmd is null or jsonb_typeof(cmd) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (cmd #>> '{scope,app_id}')::uuid;
    s_tenant_id := (cmd #>> '{scope,tenant_id}')::uuid;
    s_environment := cmd #>> '{scope,environment}';
    v_run_id := (cmd #>> '{run_id}')::uuid;
    v_grant_id := (cmd #>> '{grant_id}')::uuid;
    v_principal_id := (cmd #>> '{principal_id}')::uuid;
    v_ttl_seconds := (cmd #>> '{ttl_seconds}')::integer;
    v_canonical_response_hash := cmd #>> '{canonical_response_hash}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_grant_id is null
    or v_principal_id is null or v_ttl_seconds is null
    or v_canonical_response_hash is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Verify current readiness is CURRENT
  select readiness.*
  into v_readiness
  from app_data_agent.research_current_readiness as readiness
  where readiness.app_id = s_app_id
    and readiness.tenant_id = s_tenant_id
    and readiness.environment = s_environment
    and readiness.run_id = v_run_id
  for share;
  if not found or v_readiness.state <> 'CURRENT' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'READINESS_NOT_CURRENT'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_expires_at := v_now + (v_ttl_seconds || ' seconds')::interval;

  insert into app_data_agent.research_readiness_grants (
    app_id, tenant_id, environment, run_id, grant_id,
    readiness_id, principal_id, state,
    canonical_response_hash, expires_at,
    committed_at
  ) values (
    s_app_id, s_tenant_id, s_environment, v_run_id, v_grant_id,
    v_readiness.readiness_id, v_principal_id, 'ISSUED',
    v_canonical_response_hash, v_expires_at,
    v_now
  );

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'grant_id', v_grant_id,
    'state', 'ISSUED',
    'expires_at', v_expires_at,
    'committed_at', v_now
  ));
end;
$$;

-- ============================================================
-- 5. grant_consume: Consume a Grant (mark as consumed)
-- ============================================================

create function app_data_agent.grant_consume(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  v_grant_id uuid;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_grant record;
  v_readiness record;
  v_now timestamptz;
begin
  if input_json is null or jsonb_typeof(input_json) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (input_json #>> '{scope,app_id}')::uuid;
    s_tenant_id := (input_json #>> '{scope,tenant_id}')::uuid;
    s_environment := input_json #>> '{scope,environment}';
    v_run_id := (input_json #>> '{run_id}')::uuid;
    v_grant_id := (input_json #>> '{grant_id}')::uuid;
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_grant_id is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  select g.*
  into v_grant
  from app_data_agent.research_readiness_grants as g
  where g.app_id = s_app_id
    and g.tenant_id = s_tenant_id
    and g.environment = s_environment
    and g.run_id = v_run_id
    and g.grant_id = v_grant_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'GRANT_NOT_FOUND'));
  end if;

  if v_grant.state <> 'ISSUED' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'GRANT_NOT_ISSUED'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_now >= v_grant.expires_at then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'GRANT_EXPIRED'));
  end if;

  -- Reverify current readiness
  select readiness.*
  into v_readiness
  from app_data_agent.research_current_readiness as readiness
  where readiness.app_id = s_app_id
    and readiness.tenant_id = s_tenant_id
    and readiness.environment = s_environment
    and readiness.run_id = v_run_id
  for share;
  if not found or v_readiness.state <> 'CURRENT' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'READINESS_NOT_CURRENT'));
  end if;

  update app_data_agent.research_readiness_grants as g
  set state = 'CONSUMED',
      responded_at = v_now
  where g.app_id = s_app_id
    and g.tenant_id = s_tenant_id
    and g.environment = s_environment
    and g.run_id = v_run_id
    and g.grant_id = v_grant_id
    and g.state = 'ISSUED';

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'grant_id', v_grant_id,
    'state', 'CONSUMED',
    'committed_at', v_now
  ));
end;
$$;

-- ============================================================
-- 6. grant_response: Authorize a Grant Response
-- ============================================================

create function app_data_agent.grant_response(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  v_grant_id uuid;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_grant record;
  v_readiness record;
  v_now timestamptz;
begin
  if input_json is null or jsonb_typeof(input_json) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (input_json #>> '{scope,app_id}')::uuid;
    s_tenant_id := (input_json #>> '{scope,tenant_id}')::uuid;
    s_environment := input_json #>> '{scope,environment}';
    v_run_id := (input_json #>> '{run_id}')::uuid;
    v_grant_id := (input_json #>> '{grant_id}')::uuid;
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_grant_id is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  select g.*
  into v_grant
  from app_data_agent.research_readiness_grants as g
  where g.app_id = s_app_id
    and g.tenant_id = s_tenant_id
    and g.environment = s_environment
    and g.run_id = v_run_id
    and g.grant_id = v_grant_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'GRANT_NOT_FOUND'));
  end if;

  if v_grant.state <> 'CONSUMED' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'GRANT_NOT_CONSUMED'));
  end if;

  v_now := pg_catalog.clock_timestamp();
  if v_now >= v_grant.expires_at then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'GRANT_EXPIRED'));
  end if;

  -- Reverify current readiness
  select readiness.*
  into v_readiness
  from app_data_agent.research_current_readiness as readiness
  where readiness.app_id = s_app_id
    and readiness.tenant_id = s_tenant_id
    and readiness.environment = s_environment
    and readiness.run_id = v_run_id
  for share;
  if not found or v_readiness.state <> 'CURRENT' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'READINESS_NOT_CURRENT'));
  end if;

  update app_data_agent.research_readiness_grants as g
  set state = 'RESPONDED',
      responded_at = v_now
  where g.app_id = s_app_id
    and g.tenant_id = s_tenant_id
    and g.environment = s_environment
    and g.run_id = v_run_id
    and g.grant_id = v_grant_id
    and g.state = 'CONSUMED';

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'grant_id', v_grant_id,
    'state', 'RESPONDED',
    'committed_at', v_now
  ));
end;
$$;

-- ============================================================
-- 7. grant_expire: Expire a Grant (ISSUED|CONSUMED → EXPIRED)
-- ============================================================

create function app_data_agent.grant_expire(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  v_grant_id uuid;
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_run_id uuid;
  v_now timestamptz;
begin
  if input_json is null or jsonb_typeof(input_json) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (input_json #>> '{scope,app_id}')::uuid;
    s_tenant_id := (input_json #>> '{scope,tenant_id}')::uuid;
    s_environment := input_json #>> '{scope,environment}';
    v_run_id := (input_json #>> '{run_id}')::uuid;
    v_grant_id := (input_json #>> '{grant_id}')::uuid;
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null
    or v_run_id is null or v_grant_id is null
  then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  v_now := pg_catalog.clock_timestamp();

  update app_data_agent.research_readiness_grants as g
  set state = 'EXPIRED',
      expired_at = v_now
  where g.app_id = s_app_id
    and g.tenant_id = s_tenant_id
    and g.environment = s_environment
    and g.run_id = v_run_id
    and g.grant_id = v_grant_id
    and g.state in ('ISSUED', 'CONSUMED')
    and g.expires_at <= v_now;

  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'GRANT_NOT_FOUND_OR_ACTIVE'));
  end if;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'grant_id', v_grant_id,
    'state', 'EXPIRED',
    'committed_at', v_now
  ));
end;
$$;
-- ============================================================
-- 10600: Lifecycle cleanup
-- ============================================================

create function app_data_agent.u6_cleanup_environment(
  input_json jsonb
) returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $$
declare
  s_app_id uuid;
  s_tenant_id uuid;
  s_environment text;
  v_deleted_records bigint;
  v_total_deleted bigint := 0;
  v_deleted_tables text[];
begin
  if input_json is null or jsonb_typeof(input_json) <> 'object' then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  begin
    s_app_id := (input_json #>> '{scope,app_id}')::uuid;
    s_tenant_id := (input_json #>> '{scope,tenant_id}')::uuid;
    s_environment := input_json #>> '{scope,environment}';
  exception
    when invalid_text_representation or null_value_not_allowed then
      return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end;

  if s_app_id is null or s_tenant_id is null or s_environment is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'INVALID_COMMAND'));
  end if;

  -- Child-first cleanup: companion tables first, then parent tables

  -- 1. Companion tables
  delete from app_data_agent.research_stop_derivation_ref_bindings
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  delete from app_data_agent.research_candidate_enumeration_ref_bindings
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  delete from app_data_agent.research_candidate_attestation_ref_bindings
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  delete from app_data_agent.research_coverage_derivation_ref_bindings
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  delete from app_data_agent.research_budget_ledger_input_bindings
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 2. Watermark receipts
  delete from app_data_agent.research_input_event_watermark_receipts
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 3. Stop receipts
  delete from app_data_agent.research_stop_derivation_receipts
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 4. Candidate receipts
  delete from app_data_agent.research_candidate_enumeration_receipts
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 5. Attestations
  delete from app_data_agent.research_candidate_enumerator_attestations
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 6. Coverage receipts
  delete from app_data_agent.research_coverage_derivation_receipts
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 7. Budget ledger receipts
  delete from app_data_agent.research_budget_ledger_receipts
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 8. Backend artifact commit operations
  delete from app_data_agent.research_backend_artifact_commit_operations
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 9. Input events
  delete from app_data_agent.research_input_events
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 10. Input event heads
  delete from app_data_agent.research_input_event_heads
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 11. Step operations
  delete from app_data_agent.research_step_operations
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 12. Budget events
  delete from app_data_agent.research_budget_events
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 13. Budget policy heads / versions
  delete from app_data_agent.research_budget_policy_heads
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  delete from app_data_agent.research_budget_policy_versions
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  -- 14. Enumerator version heads / versions
  delete from app_data_agent.research_enumerator_version_heads
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  delete from app_data_agent.research_enumerator_versions
  where app_id = s_app_id and tenant_id = s_tenant_id and environment = s_environment;
  get diagnostics v_deleted_records = row_count;
  v_total_deleted := v_total_deleted + v_deleted_records;

  return jsonb_build_object('ok', true, 'value', jsonb_build_object(
    'total_deleted', v_total_deleted,
    'environment', s_environment
  ));
end;
$$;

-- ============================================================
-- 3. issue_coverage_derivation_receipt_internal: Internal Coverage issuer
--    Called from Stop Root RPC, no public GRANT
-- ============================================================
-- ============================================================
-- 10600: RLS, Policy, ACL, and Owner assignments
-- ============================================================

-- ============================================================
-- Part 1: Owner assignments for all 20 new tables
-- ============================================================

alter table app_data_agent.research_budget_policy_versions owner to data_agent_u6_data_owner;
alter table app_data_agent.research_budget_policy_heads owner to data_agent_u6_data_owner;
alter table app_data_agent.research_enumerator_versions owner to data_agent_u6_data_owner;
alter table app_data_agent.research_enumerator_version_heads owner to data_agent_u6_data_owner;
alter table app_data_agent.research_budget_events owner to data_agent_u6_data_owner;
alter table app_data_agent.research_step_operations owner to data_agent_u6_data_owner;
alter table app_data_agent.research_budget_ledger_receipts owner to data_agent_u6_data_owner;
alter table app_data_agent.research_coverage_derivation_receipts owner to data_agent_u6_data_owner;
alter table app_data_agent.research_candidate_enumerator_attestations owner to data_agent_u6_data_owner;
alter table app_data_agent.research_candidate_enumeration_receipts owner to data_agent_u6_data_owner;
alter table app_data_agent.research_stop_derivation_receipts owner to data_agent_u6_data_owner;
alter table app_data_agent.research_input_event_heads owner to data_agent_u6_data_owner;
alter table app_data_agent.research_input_events owner to data_agent_u6_data_owner;
alter table app_data_agent.research_input_event_watermark_receipts owner to data_agent_u6_data_owner;
alter table app_data_agent.research_backend_artifact_commit_operations owner to data_agent_u6_data_owner;
alter table app_data_agent.research_budget_ledger_input_bindings owner to data_agent_u6_data_owner;
alter table app_data_agent.research_coverage_derivation_ref_bindings owner to data_agent_u6_data_owner;
alter table app_data_agent.research_candidate_attestation_ref_bindings owner to data_agent_u6_data_owner;
alter table app_data_agent.research_candidate_enumeration_ref_bindings owner to data_agent_u6_data_owner;
alter table app_data_agent.research_stop_derivation_ref_bindings owner to data_agent_u6_data_owner;

-- ============================================================
-- Part 2: Enable RLS + FORCE RLS for all 20 new tables
-- ============================================================

alter table app_data_agent.research_budget_policy_versions enable row level security;
alter table app_data_agent.research_budget_policy_versions force row level security;

alter table app_data_agent.research_budget_policy_heads enable row level security;
alter table app_data_agent.research_budget_policy_heads force row level security;

alter table app_data_agent.research_enumerator_versions enable row level security;
alter table app_data_agent.research_enumerator_versions force row level security;

alter table app_data_agent.research_enumerator_version_heads enable row level security;
alter table app_data_agent.research_enumerator_version_heads force row level security;

alter table app_data_agent.research_budget_events enable row level security;
alter table app_data_agent.research_budget_events force row level security;

alter table app_data_agent.research_step_operations enable row level security;
alter table app_data_agent.research_step_operations force row level security;

alter table app_data_agent.research_budget_ledger_receipts enable row level security;
alter table app_data_agent.research_budget_ledger_receipts force row level security;

alter table app_data_agent.research_coverage_derivation_receipts enable row level security;
alter table app_data_agent.research_coverage_derivation_receipts force row level security;

alter table app_data_agent.research_candidate_enumerator_attestations enable row level security;
alter table app_data_agent.research_candidate_enumerator_attestations force row level security;

alter table app_data_agent.research_candidate_enumeration_receipts enable row level security;
alter table app_data_agent.research_candidate_enumeration_receipts force row level security;

alter table app_data_agent.research_stop_derivation_receipts enable row level security;
alter table app_data_agent.research_stop_derivation_receipts force row level security;

alter table app_data_agent.research_input_event_heads enable row level security;
alter table app_data_agent.research_input_event_heads force row level security;

alter table app_data_agent.research_input_events enable row level security;
alter table app_data_agent.research_input_events force row level security;

alter table app_data_agent.research_input_event_watermark_receipts enable row level security;
alter table app_data_agent.research_input_event_watermark_receipts force row level security;

alter table app_data_agent.research_backend_artifact_commit_operations enable row level security;
alter table app_data_agent.research_backend_artifact_commit_operations force row level security;

alter table app_data_agent.research_budget_ledger_input_bindings enable row level security;
alter table app_data_agent.research_budget_ledger_input_bindings force row level security;

alter table app_data_agent.research_coverage_derivation_ref_bindings enable row level security;
alter table app_data_agent.research_coverage_derivation_ref_bindings force row level security;

alter table app_data_agent.research_candidate_attestation_ref_bindings enable row level security;
alter table app_data_agent.research_candidate_attestation_ref_bindings force row level security;

alter table app_data_agent.research_candidate_enumeration_ref_bindings enable row level security;
alter table app_data_agent.research_candidate_enumeration_ref_bindings force row level security;

alter table app_data_agent.research_stop_derivation_ref_bindings enable row level security;
alter table app_data_agent.research_stop_derivation_ref_bindings force row level security;

-- ============================================================
-- Part 3: RLS policies for each table
-- ============================================================

-- Common pattern for immutable tables (append-only):
-- - data_owner: full access (owner bypasses RLS)
-- - rpc_owner: SELECT, INSERT
-- - cleanup_owner: SELECT, DELETE
-- - provisioner_owner: SELECT, INSERT (for head tables)

-- 1. research_budget_policy_versions (immutable)
create policy budget_policy_versions_rpc_select
  on app_data_agent.research_budget_policy_versions for select
  to data_agent_u6_rpc_owner using (true);
create policy budget_policy_versions_rpc_insert
  on app_data_agent.research_budget_policy_versions for insert
  to data_agent_u6_rpc_owner with check (true);
create policy budget_policy_versions_cleanup_delete
  on app_data_agent.research_budget_policy_versions for delete
  to data_agent_u6_cleanup_owner using (true);
create policy budget_policy_versions_provisioner_insert
  on app_data_agent.research_budget_policy_versions for insert
  to data_agent_u6_provisioner_owner with check (true);

-- 2. research_budget_policy_heads (mutable head)
create policy budget_policy_heads_rpc_select
  on app_data_agent.research_budget_policy_heads for select
  to data_agent_u6_rpc_owner using (true);
create policy budget_policy_heads_rpc_insert
  on app_data_agent.research_budget_policy_heads for insert
  to data_agent_u6_rpc_owner with check (true);
create policy budget_policy_heads_rpc_update
  on app_data_agent.research_budget_policy_heads for update
  to data_agent_u6_rpc_owner using (true) with check (true);
create policy budget_policy_heads_cleanup_delete
  on app_data_agent.research_budget_policy_heads for delete
  to data_agent_u6_cleanup_owner using (true);
create policy budget_policy_heads_provisioner_insert
  on app_data_agent.research_budget_policy_heads for insert
  to data_agent_u6_provisioner_owner with check (true);
create policy budget_policy_heads_provisioner_update
  on app_data_agent.research_budget_policy_heads for update
  to data_agent_u6_provisioner_owner using (true) with check (true);

-- 3. research_enumerator_versions (immutable)
create policy enumerator_versions_rpc_select
  on app_data_agent.research_enumerator_versions for select
  to data_agent_u6_rpc_owner using (true);
create policy enumerator_versions_rpc_insert
  on app_data_agent.research_enumerator_versions for insert
  to data_agent_u6_rpc_owner with check (true);
create policy enumerator_versions_cleanup_delete
  on app_data_agent.research_enumerator_versions for delete
  to data_agent_u6_cleanup_owner using (true);
create policy enumerator_versions_provisioner_insert
  on app_data_agent.research_enumerator_versions for insert
  to data_agent_u6_provisioner_owner with check (true);

-- 4. research_enumerator_version_heads (mutable head)
create policy enumerator_version_heads_rpc_select
  on app_data_agent.research_enumerator_version_heads for select
  to data_agent_u6_rpc_owner using (true);
create policy enumerator_version_heads_rpc_insert
  on app_data_agent.research_enumerator_version_heads for insert
  to data_agent_u6_rpc_owner with check (true);
create policy enumerator_version_heads_rpc_update
  on app_data_agent.research_enumerator_version_heads for update
  to data_agent_u6_rpc_owner using (true) with check (true);
create policy enumerator_version_heads_cleanup_delete
  on app_data_agent.research_enumerator_version_heads for delete
  to data_agent_u6_cleanup_owner using (true);
create policy enumerator_version_heads_provisioner_insert
  on app_data_agent.research_enumerator_version_heads for insert
  to data_agent_u6_provisioner_owner with check (true);
create policy enumerator_version_heads_provisioner_update
  on app_data_agent.research_enumerator_version_heads for update
  to data_agent_u6_provisioner_owner using (true) with check (true);

-- 5. research_budget_events (immutable)
create policy budget_events_rpc_select
  on app_data_agent.research_budget_events for select
  to data_agent_u6_rpc_owner using (true);
create policy budget_events_rpc_insert
  on app_data_agent.research_budget_events for insert
  to data_agent_u6_rpc_owner with check (true);
create policy budget_events_cleanup_delete
  on app_data_agent.research_budget_events for delete
  to data_agent_u6_cleanup_owner using (true);

-- 6. research_step_operations (immutable)
create policy step_operations_rpc_select
  on app_data_agent.research_step_operations for select
  to data_agent_u6_rpc_owner using (true);
create policy step_operations_rpc_insert
  on app_data_agent.research_step_operations for insert
  to data_agent_u6_rpc_owner with check (true);
create policy step_operations_cleanup_delete
  on app_data_agent.research_step_operations for delete
  to data_agent_u6_cleanup_owner using (true);

-- 7. research_budget_ledger_receipts (immutable receipt)
create policy budget_ledger_receipts_rpc_select
  on app_data_agent.research_budget_ledger_receipts for select
  to data_agent_u6_rpc_owner using (true);
create policy budget_ledger_receipts_rpc_insert
  on app_data_agent.research_budget_ledger_receipts for insert
  to data_agent_u6_rpc_owner with check (true);
create policy budget_ledger_receipts_cleanup_delete
  on app_data_agent.research_budget_ledger_receipts for delete
  to data_agent_u6_cleanup_owner using (true);

-- 8. research_coverage_derivation_receipts (immutable receipt)
create policy coverage_receipts_rpc_select
  on app_data_agent.research_coverage_derivation_receipts for select
  to data_agent_u6_rpc_owner using (true);
create policy coverage_receipts_rpc_insert
  on app_data_agent.research_coverage_derivation_receipts for insert
  to data_agent_u6_rpc_owner with check (true);
create policy coverage_receipts_cleanup_delete
  on app_data_agent.research_coverage_derivation_receipts for delete
  to data_agent_u6_cleanup_owner using (true);

-- 9. research_candidate_enumerator_attestations (immutable)
create policy attestations_rpc_select
  on app_data_agent.research_candidate_enumerator_attestations for select
  to data_agent_u6_rpc_owner using (true);
create policy attestations_rpc_insert
  on app_data_agent.research_candidate_enumerator_attestations for insert
  to data_agent_u6_rpc_owner with check (true);
create policy attestations_cleanup_delete
  on app_data_agent.research_candidate_enumerator_attestations for delete
  to data_agent_u6_cleanup_owner using (true);

-- 10. research_candidate_enumeration_receipts (immutable receipt v2)
create policy candidate_receipts_rpc_select
  on app_data_agent.research_candidate_enumeration_receipts for select
  to data_agent_u6_rpc_owner using (true);
create policy candidate_receipts_rpc_insert
  on app_data_agent.research_candidate_enumeration_receipts for insert
  to data_agent_u6_rpc_owner with check (true);
create policy candidate_receipts_cleanup_delete
  on app_data_agent.research_candidate_enumeration_receipts for delete
  to data_agent_u6_cleanup_owner using (true);

-- 11. research_stop_derivation_receipts (immutable receipt v2)
create policy stop_receipts_rpc_select
  on app_data_agent.research_stop_derivation_receipts for select
  to data_agent_u6_rpc_owner using (true);
create policy stop_receipts_rpc_insert
  on app_data_agent.research_stop_derivation_receipts for insert
  to data_agent_u6_rpc_owner with check (true);
create policy stop_receipts_cleanup_delete
  on app_data_agent.research_stop_derivation_receipts for delete
  to data_agent_u6_cleanup_owner using (true);

-- 12. research_input_event_heads (mutable head)
create policy input_event_heads_rpc_select
  on app_data_agent.research_input_event_heads for select
  to data_agent_u6_rpc_owner using (true);
create policy input_event_heads_rpc_insert
  on app_data_agent.research_input_event_heads for insert
  to data_agent_u6_rpc_owner with check (true);
create policy input_event_heads_rpc_update
  on app_data_agent.research_input_event_heads for update
  to data_agent_u6_rpc_owner using (true) with check (true);
create policy input_event_heads_cleanup_delete
  on app_data_agent.research_input_event_heads for delete
  to data_agent_u6_cleanup_owner using (true);

-- 13. research_input_events (immutable)
create policy input_events_rpc_select
  on app_data_agent.research_input_events for select
  to data_agent_u6_rpc_owner using (true);
create policy input_events_rpc_insert
  on app_data_agent.research_input_events for insert
  to data_agent_u6_rpc_owner with check (true);
create policy input_events_cleanup_delete
  on app_data_agent.research_input_events for delete
  to data_agent_u6_cleanup_owner using (true);

-- 14. research_input_event_watermark_receipts (immutable receipt)
create policy watermark_receipts_rpc_select
  on app_data_agent.research_input_event_watermark_receipts for select
  to data_agent_u6_rpc_owner using (true);
create policy watermark_receipts_rpc_insert
  on app_data_agent.research_input_event_watermark_receipts for insert
  to data_agent_u6_rpc_owner with check (true);
create policy watermark_receipts_cleanup_delete
  on app_data_agent.research_input_event_watermark_receipts for delete
  to data_agent_u6_cleanup_owner using (true);

-- 15. research_backend_artifact_commit_operations (immutable)
create policy backend_artifact_ops_rpc_select
  on app_data_agent.research_backend_artifact_commit_operations for select
  to data_agent_u6_rpc_owner using (true);
create policy backend_artifact_ops_rpc_insert
  on app_data_agent.research_backend_artifact_commit_operations for insert
  to data_agent_u6_rpc_owner with check (true);
create policy backend_artifact_ops_cleanup_delete
  on app_data_agent.research_backend_artifact_commit_operations for delete
  to data_agent_u6_cleanup_owner using (true);

-- 16. research_budget_ledger_input_bindings (companion, immutable)
create policy budget_input_bindings_rpc_select
  on app_data_agent.research_budget_ledger_input_bindings for select
  to data_agent_u6_rpc_owner using (true);
create policy budget_input_bindings_rpc_insert
  on app_data_agent.research_budget_ledger_input_bindings for insert
  to data_agent_u6_rpc_owner with check (true);
create policy budget_input_bindings_cleanup_delete
  on app_data_agent.research_budget_ledger_input_bindings for delete
  to data_agent_u6_cleanup_owner using (true);

-- 17. research_coverage_derivation_ref_bindings (companion, immutable)
create policy coverage_ref_bindings_rpc_select
  on app_data_agent.research_coverage_derivation_ref_bindings for select
  to data_agent_u6_rpc_owner using (true);
create policy coverage_ref_bindings_rpc_insert
  on app_data_agent.research_coverage_derivation_ref_bindings for insert
  to data_agent_u6_rpc_owner with check (true);
create policy coverage_ref_bindings_cleanup_delete
  on app_data_agent.research_coverage_derivation_ref_bindings for delete
  to data_agent_u6_cleanup_owner using (true);

-- 18. research_candidate_attestation_ref_bindings (companion, immutable)
create policy attestation_ref_bindings_rpc_select
  on app_data_agent.research_candidate_attestation_ref_bindings for select
  to data_agent_u6_rpc_owner using (true);
create policy attestation_ref_bindings_rpc_insert
  on app_data_agent.research_candidate_attestation_ref_bindings for insert
  to data_agent_u6_rpc_owner with check (true);
create policy attestation_ref_bindings_cleanup_delete
  on app_data_agent.research_candidate_attestation_ref_bindings for delete
  to data_agent_u6_cleanup_owner using (true);

-- 19. research_candidate_enumeration_ref_bindings (companion, immutable)
create policy candidate_enum_ref_bindings_rpc_select
  on app_data_agent.research_candidate_enumeration_ref_bindings for select
  to data_agent_u6_rpc_owner using (true);
create policy candidate_enum_ref_bindings_rpc_insert
  on app_data_agent.research_candidate_enumeration_ref_bindings for insert
  to data_agent_u6_rpc_owner with check (true);
create policy candidate_enum_ref_bindings_cleanup_delete
  on app_data_agent.research_candidate_enumeration_ref_bindings for delete
  to data_agent_u6_cleanup_owner using (true);

-- 20. research_stop_derivation_ref_bindings (companion, immutable)
create policy stop_ref_bindings_rpc_select
  on app_data_agent.research_stop_derivation_ref_bindings for select
  to data_agent_u6_rpc_owner using (true);
create policy stop_ref_bindings_rpc_insert
  on app_data_agent.research_stop_derivation_ref_bindings for insert
  to data_agent_u6_rpc_owner with check (true);
create policy stop_ref_bindings_cleanup_delete
  on app_data_agent.research_stop_derivation_ref_bindings for delete
  to data_agent_u6_cleanup_owner using (true);

-- ============================================================
-- Part 4: GRANT permissions for RPC owner
-- ============================================================

-- Immutable tables: SELECT, INSERT
grant select, insert on app_data_agent.research_budget_policy_versions to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_enumerator_versions to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_budget_events to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_step_operations to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_budget_ledger_receipts to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_coverage_derivation_receipts to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_candidate_enumerator_attestations to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_candidate_enumeration_receipts to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_stop_derivation_receipts to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_input_events to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_input_event_watermark_receipts to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_backend_artifact_commit_operations to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_budget_ledger_input_bindings to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_coverage_derivation_ref_bindings to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_candidate_attestation_ref_bindings to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_candidate_enumeration_ref_bindings to data_agent_u6_rpc_owner;
grant select, insert on app_data_agent.research_stop_derivation_ref_bindings to data_agent_u6_rpc_owner;

-- Mutable head tables: SELECT, INSERT, UPDATE
grant select, insert, update on app_data_agent.research_budget_policy_heads to data_agent_u6_rpc_owner;
grant select, insert, update on app_data_agent.research_enumerator_version_heads to data_agent_u6_rpc_owner;
grant select, insert, update on app_data_agent.research_input_event_heads to data_agent_u6_rpc_owner;

-- ============================================================
-- Part 5: GRANT permissions for cleanup owner
-- ============================================================

grant select, delete on app_data_agent.research_budget_policy_versions to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_budget_policy_heads to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_enumerator_versions to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_enumerator_version_heads to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_budget_events to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_step_operations to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_budget_ledger_receipts to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_coverage_derivation_receipts to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_candidate_enumerator_attestations to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_candidate_enumeration_receipts to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_stop_derivation_receipts to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_input_event_heads to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_input_events to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_input_event_watermark_receipts to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_backend_artifact_commit_operations to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_budget_ledger_input_bindings to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_coverage_derivation_ref_bindings to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_candidate_attestation_ref_bindings to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_candidate_enumeration_ref_bindings to data_agent_u6_cleanup_owner;
grant select, delete on app_data_agent.research_stop_derivation_ref_bindings to data_agent_u6_cleanup_owner;

-- ============================================================
-- Part 6: GRANT permissions for provisioner owner
-- ============================================================

grant select, insert on app_data_agent.research_budget_policy_versions to data_agent_u6_provisioner_owner;
grant select, insert, update on app_data_agent.research_budget_policy_heads to data_agent_u6_provisioner_owner;
grant select, insert on app_data_agent.research_enumerator_versions to data_agent_u6_provisioner_owner;
grant select, insert, update on app_data_agent.research_enumerator_version_heads to data_agent_u6_provisioner_owner;

-- ============================================================
-- Part 7: REVOKE public/backend/service_role from new tables
-- ============================================================

revoke all on all tables in schema app_data_agent from public;
revoke all on all tables in schema app_data_agent from anon;
revoke all on all tables in schema app_data_agent from authenticated;
revoke all on all tables in schema app_data_agent from service_role;
revoke all on all tables in schema app_data_agent from data_agent_backend;

-- ============================================================
-- Part 8: Revoke artifacts INSERT/UPDATE/DELETE from backend
-- ============================================================

revoke insert, update, delete on app_data_agent.artifacts from data_agent_backend;
revoke insert, update, delete on app_data_agent.artifacts from service_role;
-- ============================================================
-- 10600: Post-conditions, ledger checksum, and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010600_app_data_agent_u6_research_derivation',
  'sha256:b435ef8e3a918b9e99781b6fd49767d7ea21ff5df781ddd7efe78a122b50ba6d'
);

commit;
