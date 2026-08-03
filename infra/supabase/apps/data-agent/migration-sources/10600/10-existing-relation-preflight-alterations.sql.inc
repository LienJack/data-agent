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
