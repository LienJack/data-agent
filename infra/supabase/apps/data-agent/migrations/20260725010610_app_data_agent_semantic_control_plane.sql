-- semantic_migration_checksum: sha256:dc7ec2f69c4feaa4fee583f40395b312cd050bcae9ec2bab2fcf76fc150392c9
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
    raise exception using errcode = '0A000', message = 'SEMANTIC_MIGRATION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'SEMANTIC_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_extension as extension
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = extension.extnamespace
    where extension.extname = 'pgcrypto'
      and namespace.nspname = 'extensions'
  ) then
    raise exception using errcode = '0A000', message = 'SEMANTIC_MIGRATION_PGCRYPTO_REQUIRED';
  end if;

  if pg_catalog.current_setting('app.semantic_maintenance_manifest_hash', true)
       is distinct from 'sha256:dc7ec2f69c4feaa4fee583f40395b312cd050bcae9ec2bab2fcf76fc150392c9'
    or pg_catalog.current_setting('app.semantic_maintenance_window_id', true)
       is distinct from '00000000-0000-4000-8000-000000001610'
  then
    raise exception using errcode = '22023', message = 'SEMANTIC_MIGRATION_MAINTENANCE_BINDING_INVALID';
  end if;

  begin
    session_arm_ms :=
      pg_catalog.current_setting('app.semantic_maintenance_session_arm_ms', true)::bigint;
    window_expires_at :=
      pg_catalog.current_setting('app.semantic_maintenance_window_expires_at', true)::timestamptz;
    requested_deployment_id :=
      pg_catalog.current_setting('app.semantic_maintenance_deployment_id', true)::uuid;
    observed_database_identity_hash :=
      pg_catalog.current_setting('app.semantic_maintenance_database_identity_hash', true);
  exception
    when invalid_text_representation or null_value_not_allowed then
      raise exception using errcode = '22023', message = 'SEMANTIC_MIGRATION_MAINTENANCE_BINDING_INVALID';
  end;

  select setting::bigint
  into transaction_setting
  from pg_catalog.pg_settings
  where name = 'transaction_timeout' and unit = 'ms';
  if not found or transaction_setting <> session_arm_ms then
    raise exception using errcode = '22023', message = 'SEMANTIC_MIGRATION_TRANSACTION_ARM_INVALID';
  end if;

  arm_now := pg_catalog.clock_timestamp();
  effective_budget_ms :=
    pg_catalog.floor(
      pg_catalog.date_part('epoch', window_expires_at - arm_now) * 1000
    )::bigint - 5000;
  if effective_budget_ms not between 30000 and 600000 then
    raise exception using errcode = '57014', message = 'SEMANTIC_MIGRATION_WINDOW_EXPIRED';
  end if;

  perform pg_catalog.set_config('transaction_timeout', '0', true);
  select setting::bigint
  into transaction_setting
  from pg_catalog.pg_settings
  where name = 'transaction_timeout' and unit = 'ms';
  if transaction_setting <> 0 then
    raise exception using errcode = '22023', message = 'SEMANTIC_MIGRATION_TRANSACTION_REARM_FAILED';
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
    raise exception using errcode = '22023', message = 'SEMANTIC_MIGRATION_TRANSACTION_REARM_FAILED';
  end if;
  rearm_verified_at := pg_catalog.clock_timestamp();
  if rearm_verified_at + effective_budget_ms * interval '1 millisecond' > window_expires_at then
    raise exception using errcode = '57014', message = 'SEMANTIC_MIGRATION_WINDOW_EXPIRED';
  end if;

  -- Verify 10600 baseline is installed and immutable
  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010600_app_data_agent_u6_research_derivation';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_MIGRATION_BASELINE_MISSING';
  end if;
  if exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010610_app_data_agent_semantic_control_plane'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_MIGRATION_ALREADY_RECORDED';
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
    raise exception using errcode = '22023', message = 'SEMANTIC_MIGRATION_DATABASE_BINDING_INVALID';
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
    raise exception using errcode = '42501', message = 'SEMANTIC_MIGRATION_DEPLOYMENT_INACTIVE';
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
    'platform.app_environment_lifecycle',
    'platform.deployment_mappings',
    'app_data_agent.memberships',
    'app_data_agent.runs',
    'app_data_agent.run_attempts'
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
      raise exception using errcode = '42501', message = 'SEMANTIC_MIGRATION_EXECUTOR_UNSAFE';
    end if;
  end loop;
end
$executor_visibility$;

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);

lock table
  platform.app_environment_lifecycle,
  platform.deployment_mappings,
  app_data_agent.memberships,
  app_data_agent.runs,
  app_data_agent.run_attempts
in access exclusive mode nowait;
-- ============================================================
-- 10610: Semantic domain registry, bootstrap, and authority fence
-- ============================================================

-- Create semantic schema (independent from app_data_agent)
create schema if not exists semantic;

-- ============================================================
-- 1. semantic_domain_registry: domain identity and datasource mapping
-- L2 domain ↔ datasource: one-to-one; server-owned
-- ============================================================
create table semantic.semantic_domain_registry (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  datasource_id uuid not null,
  domain_display_name text not null,
  domain_description text,
  domain_version integer not null default 1
    check (domain_version between 1 and 2147483647),
  is_active boolean not null default true,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by text not null,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain),
  unique (app_id, tenant_id, environment, datasource_id)
);

-- ============================================================
-- 2. semantic_domain_bootstrap: one-time bootstrap packet/capability
-- scope-unique CLOSED tombstone; double-owner exact packet; never reopened
-- ============================================================
create table semantic.semantic_domain_bootstrap (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  bootstrap_id uuid not null,
  bootstrap_packet_digest text not null
    check (bootstrap_packet_digest ~ '^sha256:[0-9a-f]{64}$'),
  supersedes_packet_digest text
    check (supersedes_packet_digest ~ '^sha256:[0-9a-f]{64}$'),
  signer_one_principal text not null,
  signer_two_principal text not null,
  signer_one_signature text not null,
  signer_two_signature text not null,
  initial_review_policy_digest text not null
    check (initial_review_policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  initial_catalog_fence_digest text not null
    check (initial_catalog_fence_digest ~ '^sha256:[0-9a-f]{64}$'),
  initial_compiler_dependency_digest text not null
    check (initial_compiler_dependency_digest ~ '^sha256:[0-9a-f]{64}$'),
  bootstrap_nonce uuid not null,
  bootstrap_expires_at timestamptz not null,
  is_closed boolean not null default false,
  closed_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, bootstrap_id),
  unique (app_id, tenant_id, environment, semantic_domain, bootstrap_packet_digest),
  unique (app_id, tenant_id, environment, semantic_domain, bootstrap_nonce)
);

-- ============================================================
-- 3. semantic_authority_fence: per App/Tenant/Environment linearization anchor
-- Exists before bootstrap; must not be missing; shared by all writers
-- ============================================================
create table semantic.semantic_authority_fence (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  fence_epoch bigint not null default 0
    check (fence_epoch between 0 and 9007199254740991),
  last_fence_update_at timestamptz not null default pg_catalog.clock_timestamp(),
  last_fence_update_by text not null default 'system',
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment)
);
-- ============================================================
-- 10610: Review policy, assignment, and policy pointer tables
-- ============================================================

-- ============================================================
-- 4. semantic_reviewer_policy_revision: append-only role/quorum/veto/expiry policy
-- scope/domain/versioned
-- ============================================================
create table semantic.semantic_reviewer_policy_revision (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  policy_version bigint not null
    check (policy_version between 1 and 9007199254740991),
  policy_digest text not null
    check (policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  policy_payload jsonb not null,
  quorum_rules jsonb not null,
  veto_rules jsonb not null,
  expiry_rules jsonb not null,
  role_separation_rules jsonb not null,
  min_reviewers integer not null
    check (min_reviewers between 1 and 100),
  decision_timeout_seconds integer not null
    check (decision_timeout_seconds between 60 and 2592000),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by text not null,
  primary key (app_id, tenant_id, environment, semantic_domain, policy_version),
  unique (app_id, tenant_id, environment, semantic_domain, policy_digest)
);

-- ============================================================
-- 5. semantic_reviewer_assignment: eligible principal/semantic role
-- Binds to exact membership version
-- ============================================================
create table semantic.semantic_reviewer_assignment (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  assignment_id uuid not null,
  principal text not null,
  semantic_role text not null
    check (semantic_role in ('domain_reviewer', 'security_reviewer', 'admin_reviewer')),
  membership_version bigint not null
    check (membership_version between 1 and 9007199254740991),
  policy_version bigint not null
    check (policy_version between 1 and 9007199254740991),
  is_active boolean not null default true,
  assigned_at timestamptz not null default pg_catalog.clock_timestamp(),
  assigned_by text not null,
  expires_at timestamptz,
  primary key (app_id, tenant_id, environment, semantic_domain, assignment_id),
  unique (app_id, tenant_id, environment, semantic_domain, principal, semantic_role, policy_version)
);

-- ============================================================
-- 6. semantic_reviewer_policy_pointer: current review policy
-- Single-row generation CAS
-- ============================================================
create table semantic.semantic_reviewer_policy_pointer (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  current_policy_version bigint not null
    check (current_policy_version between 1 and 9007199254740991),
  current_policy_digest text not null
    check (current_policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  pointer_generation bigint not null default 1
    check (pointer_generation between 1 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_by text not null,
  primary key (app_id, tenant_id, environment, semantic_domain)
);
-- ============================================================
-- 10610: Catalog fence and dependency pointer tables
-- ============================================================

-- ============================================================
-- 7. semantic_catalog_fence: datasource schema epoch/digest
-- Adapter can re-verify; invalidation only advances, never resurrects
-- ============================================================
create table semantic.semantic_catalog_fence (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  catalog_epoch bigint not null
    check (catalog_epoch between 0 and 9007199254740991),
  catalog_digest text not null
    check (catalog_digest ~ '^sha256:[0-9a-f]{64}$'),
  schema_digest text not null
    check (schema_digest ~ '^sha256:[0-9a-f]{64}$'),
  is_valid boolean not null default true,
  invalidated_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, catalog_epoch)
);

-- ============================================================
-- 8. semantic_dependency_pointer: current catalog/compiler/closure tuple
-- Fence + immutable refs + generation CAS
-- ============================================================
create table semantic.semantic_dependency_pointer (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  current_catalog_epoch bigint not null
    check (current_catalog_epoch between 0 and 9007199254740991),
  current_catalog_digest text not null
    check (current_catalog_digest ~ '^sha256:[0-9a-f]{64}$'),
  current_compiler_bundle_digest text not null
    check (current_compiler_bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  current_closure_policy_digest text not null
    check (current_closure_policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  pointer_generation bigint not null default 1
    check (pointer_generation between 1 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_by text not null,
  primary key (app_id, tenant_id, environment, semantic_domain)
);
-- ============================================================
-- 10610: Source revision table
-- ============================================================

-- ============================================================
-- 9. semantic_source_revision: complete Source Bundle revision
-- Append-only; base release/generation exact
-- ============================================================
create table semantic.semantic_source_revision (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  revision_id uuid not null,
  revision_number integer not null
    check (revision_number between 1 and 2147483647),
  base_release_id uuid,
  base_release_generation bigint
    check (base_release_generation between 0 and 9007199254740991),
  source_payload jsonb not null,
  source_digest text not null
    check (source_digest ~ '^sha256:[0-9a-f]{64}$'),
  author_principal text not null,
  change_description text,
  change_class text
    check (change_class in ('MINOR', 'MAJOR', 'RUNTIME_AUTHORIZATION', 'SECURITY')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, revision_id),
  unique (app_id, tenant_id, environment, semantic_domain, revision_number),
  unique (app_id, tenant_id, environment, semantic_domain, source_digest)
);
-- ============================================================
-- 10610: Candidate, candidate revision, and validation receipt tables
-- ============================================================

-- ============================================================
-- 10. semantic_candidate: candidate identity and state
-- Proposer immutable; points to exactly one current revision at a time
-- ============================================================
create table semantic.semantic_candidate (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  candidate_id uuid not null,
  proposer_principal text not null,
  current_revision_id uuid not null,
  candidate_status text not null
    check (candidate_status in (
      'DRAFT', 'VALIDATING', 'VALIDATION_FAILED', 'REVIEW_SUBMITTED',
      'WAITING_REVIEW', 'REJECTED', 'REVIEW_EXPIRED', 'APPROVED',
      'PUBLISHING', 'PUBLISHED', 'STALE_REBASE_REQUIRED'
    )),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, candidate_id)
);

-- ============================================================
-- 11. semantic_candidate_revision: candidate content, reason, and author
-- Append-only; payload hash unique; author enters SoD exclusion
-- ============================================================
create table semantic.semantic_candidate_revision (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  candidate_id uuid not null,
  revision_id uuid not null,
  revision_number integer not null
    check (revision_number between 1 and 2147483647),
  source_revision_id uuid not null,
  revision_payload jsonb not null,
  revision_digest text not null
    check (revision_digest ~ '^sha256:[0-9a-f]{64}$'),
  author_principal text not null,
  change_description text,
  change_class text
    check (change_class in ('MINOR', 'MAJOR', 'RUNTIME_AUTHORIZATION', 'SECURITY')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, candidate_id, revision_id),
  unique (app_id, tenant_id, environment, semantic_domain, revision_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, candidate_id)
    references semantic.semantic_candidate (app_id, tenant_id, environment, semantic_domain, candidate_id)
);

-- ============================================================
-- 12. semantic_validation_receipt: compiler/gate/impact results
-- Exact candidate + catalog + compiler
-- ============================================================
create table semantic.semantic_validation_receipt (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  receipt_id uuid not null,
  candidate_id uuid not null,
  revision_id uuid not null,
  catalog_epoch bigint not null,
  compiler_bundle_digest text not null
    check (compiler_bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  validation_outcome text not null
    check (validation_outcome in ('PASS', 'FAIL', 'WARN')),
  validation_details jsonb,
  impact_analysis jsonb,
  receipt_digest text not null
    check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, receipt_id),
  unique (app_id, tenant_id, environment, semantic_domain, receipt_digest)
);
-- ============================================================
-- 10610: Review task and decision tables
-- ============================================================

-- ============================================================
-- 13. semantic_review_task: Candidate/rollback/legacy-closure universal packet
-- packet_kind = CANDIDATE_REVIEW | ROLLBACK_REVIEW | LEGACY_CLOSURE_REVIEW
-- decision_window_status = OPEN | CLOSED
-- review_outcome = PENDING | APPROVED | VETOED | EXPIRED
-- ============================================================
create table semantic.semantic_review_task (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  packet_id uuid not null,
  packet_kind text not null
    check (packet_kind in ('CANDIDATE_REVIEW', 'ROLLBACK_REVIEW', 'LEGACY_CLOSURE_REVIEW')),
  packet_digest text not null
    check (packet_digest ~ '^sha256:[0-9a-f]{64}$'),
  packet_payload jsonb not null,
  candidate_id uuid,
  decision_window_status text not null default 'OPEN'
    check (decision_window_status in ('OPEN', 'CLOSED')),
  review_outcome text not null default 'PENDING'
    check (review_outcome in ('PENDING', 'APPROVED', 'VETOED', 'EXPIRED')),
  decision_expires_at timestamptz not null,
  publish_expires_at timestamptz,
  quorum_rules_snapshot jsonb not null,
  veto_rules_snapshot jsonb not null,
  exclusion_set jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_by text not null,
  closed_at timestamptz,
  primary key (app_id, tenant_id, environment, semantic_domain, packet_id),
  unique (app_id, tenant_id, environment, semantic_domain, packet_digest)
);

-- ============================================================
-- 14. semantic_review_decision: human approve/reject for all three packet kinds
-- (packet, principal, semantic_role) unique, immutable
-- Reject = veto; packet_kind must match parent
-- ============================================================
create table semantic.semantic_review_decision (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  packet_id uuid not null,
  decision_id uuid not null,
  principal text not null,
  semantic_role text not null
    check (semantic_role in ('domain_reviewer', 'security_reviewer', 'admin_reviewer')),
  decision text not null
    check (decision in ('APPROVE', 'REJECT')),
  decision_reason text,
  decision_digest text not null
    check (decision_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, packet_id, decision_id),
  unique (app_id, tenant_id, environment, semantic_domain, packet_id, principal, semantic_role),
  foreign key (app_id, tenant_id, environment, semantic_domain, packet_id)
    references semantic.semantic_review_task (app_id, tenant_id, environment, semantic_domain, packet_id)
);
-- ============================================================
-- 10610: Publish attempt and source release tables
-- ============================================================

-- ============================================================
-- 15. semantic_publish_attempt: A8 durable publish attempt
-- Identity and exact inputs immutable after creation; state CAS only
-- ============================================================
create table semantic.semantic_publish_attempt (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  attempt_id uuid not null,
  packet_id uuid not null,
  candidate_id uuid not null,
  attempt_state text not null
    check (attempt_state in ('PREPARED', 'COMMITTED', 'STALE')),
  compiler_bundle_digest text not null
    check (compiler_bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  catalog_fence_epoch bigint not null,
  dependency_generation bigint not null,
  executable_projection_ref uuid,
  executable_projection_hash text
    check (executable_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  relationship_projection_ref uuid,
  relationship_projection_hash text
    check (relationship_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  runtime_restriction_projection_ref uuid,
  runtime_restriction_projection_hash text
    check (runtime_restriction_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  target_generation bigint not null
    check (target_generation between 0 and 9007199254740991),
  idempotency_digest text not null
    check (idempotency_digest ~ '^sha256:[0-9a-f]{64}$'),
  conditional_legacy_plan jsonb,
  terminal_code text,
  terminal_detail_digest text
    check (terminal_detail_digest ~ '^sha256:[0-9a-f]{64}$'),
  committed_release_ref uuid,
  committed_legacy_attempt_ref uuid,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, attempt_id),
  unique (app_id, tenant_id, environment, semantic_domain, idempotency_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, candidate_id)
    references semantic.semantic_candidate (app_id, tenant_id, environment, semantic_domain, candidate_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, packet_id)
    references semantic.semantic_review_task (app_id, tenant_id, environment, semantic_domain, packet_id)
);

-- ============================================================
-- 16. semantic_source_release: approved and published Source
-- Immutable; exact packet/quorum; binds three core projection digests
-- ============================================================
create table semantic.semantic_source_release (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  release_id uuid not null,
  release_generation bigint not null
    check (release_generation between 1 and 9007199254740991),
  attempt_id uuid not null,
  packet_id uuid not null,
  candidate_id uuid not null,
  release_digest text not null
    check (release_digest ~ '^sha256:[0-9a-f]{64}$'),
  compiler_bundle_digest text not null
    check (compiler_bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  executable_projection_ref uuid not null,
  executable_projection_hash text not null
    check (executable_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  relationship_projection_ref uuid not null,
  relationship_projection_hash text not null
    check (relationship_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  runtime_restriction_projection_ref uuid not null,
  runtime_restriction_projection_hash text not null
    check (runtime_restriction_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  profile_child_manifest jsonb,
  quorum_snapshot jsonb not null,
  decision_set_digest text not null
    check (decision_set_digest ~ '^sha256:[0-9a-f]{64}$'),
  published_at timestamptz not null default pg_catalog.clock_timestamp(),
  published_by text not null,
  primary key (app_id, tenant_id, environment, semantic_domain, release_id),
  unique (app_id, tenant_id, environment, semantic_domain, release_generation),
  unique (app_id, tenant_id, environment, semantic_domain, release_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, attempt_id)
    references semantic.semantic_publish_attempt (app_id, tenant_id, environment, semantic_domain, attempt_id)
);
-- ============================================================
-- 10610: Projection tables (executable, relationship, restriction, profile)
-- ============================================================

-- ============================================================
-- 17. semantic_executable_projection: U5 metric/dimension payload
-- Deterministic hash; belongs to one source release
-- ============================================================
create table semantic.semantic_executable_projection (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  projection_id uuid not null,
  release_id uuid not null,
  projection_digest text not null
    check (projection_digest ~ '^sha256:[0-9a-f]{64}$'),
  projection_payload jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, projection_id),
  unique (app_id, tenant_id, environment, semantic_domain, projection_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_source_release (app_id, tenant_id, environment, semantic_domain, release_id)
);

-- ============================================================
-- 18. semantic_relationship_projection: U5 relationship sidecar
-- Exact release/datasource/catalog/digest
-- ============================================================
create table semantic.semantic_relationship_projection (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  projection_id uuid not null,
  release_id uuid not null,
  datasource_id uuid not null,
  catalog_epoch bigint not null,
  projection_digest text not null
    check (projection_digest ~ '^sha256:[0-9a-f]{64}$'),
  projection_payload jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, projection_id),
  unique (app_id, tenant_id, environment, semantic_domain, projection_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_source_release (app_id, tenant_id, environment, semantic_domain, release_id)
);

-- ============================================================
-- 19. semantic_runtime_restriction_projection: DENY/RESTRICT policy input
-- Exact source/platform policy/compiler/generation/digest; not grantable
-- ============================================================
create table semantic.semantic_runtime_restriction_projection (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  projection_id uuid not null,
  release_id uuid not null,
  projection_digest text not null
    check (projection_digest ~ '^sha256:[0-9a-f]{64}$'),
  platform_policy_digest text not null
    check (platform_policy_digest ~ '^sha256:[0-9a-f]{64}$'),
  compiler_bundle_digest text not null
    check (compiler_bundle_digest ~ '^sha256:[0-9a-f]{64}$'),
  pointer_generation bigint not null,
  restriction_payload jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, projection_id),
  unique (app_id, tenant_id, environment, semantic_domain, projection_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_source_release (app_id, tenant_id, environment, semantic_domain, release_id)
);

-- ============================================================
-- 20. semantic_descriptive_contribution_profile_projection: U13 profile child
-- Content-addressed; exact parent projection/release; no independent pointer
-- ============================================================
create table semantic.semantic_descriptive_contribution_profile_projection (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  projection_id uuid not null,
  parent_projection_id uuid not null,
  release_id uuid not null,
  projection_digest text not null
    check (projection_digest ~ '^sha256:[0-9a-f]{64}$'),
  profile_payload jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, projection_id),
  unique (app_id, tenant_id, environment, semantic_domain, projection_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_source_release (app_id, tenant_id, environment, semantic_domain, release_id)
);
-- ============================================================
-- 10610: Active pointer, issuer draft, and runtime projection binding
-- ============================================================

-- ============================================================
-- 21. semantic_active_pointer: scope's current release
-- Genesis null/0; single-row generation CAS
-- ============================================================
create table semantic.semantic_active_pointer (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  current_release_id uuid,
  current_release_generation bigint not null default 0
    check (current_release_generation between 0 and 9007199254740991),
  current_release_digest text
    check (current_release_digest ~ '^sha256:[0-9a-f]{64}$'),
  pointer_generation bigint not null default 1
    check (pointer_generation between 1 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_by text not null,
  primary key (app_id, tenant_id, environment, semantic_domain)
);

-- ============================================================
-- 22. semantic_grounding_issuer_draft: three issuer sealed inputs
-- Kind/issuer/capability/input/currentness/hash immutable; not consumable until READY
-- ============================================================
create table semantic.semantic_grounding_issuer_draft (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  draft_id uuid not null,
  issuer_kind text not null
    check (issuer_kind in ('AUTHORITY', 'COMPILER', 'MATERIALIZER')),
  issuer_principal text not null,
  capability text not null,
  sealed_input jsonb not null,
  currentness_hash text not null
    check (currentness_hash ~ '^sha256:[0-9a-f]{64}$'),
  draft_hash text not null
    check (draft_hash ~ '^sha256:[0-9a-f]{64}$'),
  is_ready boolean not null default false,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, draft_id),
  unique (app_id, tenant_id, environment, semantic_domain, draft_hash)
);

-- ============================================================
-- 23. semantic_runtime_projection_binding: source to U5 run lineage
-- Exact source/projection/run/U5 refs/hash
-- ============================================================
create table semantic.semantic_runtime_projection_binding (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  binding_id uuid not null,
  release_id uuid not null,
  projection_id uuid not null,
  run_id uuid not null,
  u5_artifact_ref uuid,
  u5_artifact_hash text
    check (u5_artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
  binding_hash text not null
    check (binding_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, binding_id),
  unique (app_id, tenant_id, environment, semantic_domain, binding_hash)
);
-- ============================================================
-- 10610: Runtime activation table
-- ============================================================

-- ============================================================
-- 24. semantic_runtime_activation: per-domain resolver and legacy contract state
-- mode = LEGACY | SHADOW | PUBLISHED_ONLY
-- activation_generation, rollback_window_status = OPEN | CLOSED
-- legacy_contract_status = AVAILABLE | CLOSED
-- ============================================================
create table semantic.semantic_runtime_activation (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  runtime_mode text not null default 'LEGACY'
    check (runtime_mode in ('LEGACY', 'SHADOW', 'PUBLISHED_ONLY')),
  activation_generation bigint not null default 1
    check (activation_generation between 1 and 9007199254740991),
  rollback_window_status text not null default 'OPEN'
    check (rollback_window_status in ('OPEN', 'CLOSED')),
  legacy_contract_status text not null default 'AVAILABLE'
    check (legacy_contract_status in ('AVAILABLE', 'CLOSED')),
  current_release_id uuid,
  current_release_generation bigint not null default 0
    check (current_release_generation between 0 and 9007199254740991),
  last_governance_readiness_receipt_digest text
    check (last_governance_readiness_receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  closure_authorization_digest text
    check (closure_authorization_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain)
);
-- ============================================================
-- 10610: Legacy equivalence attempt, mirror, receipt, and closure authorization
-- ============================================================

-- ============================================================
-- 25. semantic_legacy_equivalence_attempt: legacy equivalence proof
-- Generated before publish, committed only in publish transaction
-- ============================================================
create table semantic.semantic_legacy_equivalence_attempt (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  attempt_id uuid not null,
  release_id uuid not null,
  target_generation bigint not null
    check (target_generation between 0 and 9007199254740991),
  executable_projection_hash text not null
    check (executable_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  relationship_projection_hash text not null
    check (relationship_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  runtime_restriction_projection_hash text not null
    check (runtime_restriction_projection_hash ~ '^sha256:[0-9a-f]{64}$'),
  catalog_fence_epoch bigint not null,
  suite_digest text not null
    check (suite_digest ~ '^sha256:[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, attempt_id),
  unique (app_id, tenant_id, environment, semantic_domain, suite_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_source_release (app_id, tenant_id, environment, semantic_domain, release_id)
);

-- ============================================================
-- 26. semantic_legacy_compatible_mirror: rollback-valid mirror for legacy resolver
-- ============================================================
create table semantic.semantic_legacy_compatible_mirror (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  mirror_id uuid not null,
  attempt_id uuid not null,
  release_id uuid not null,
  target_generation bigint not null
    check (target_generation between 0 and 9007199254740991),
  content_digest text not null
    check (content_digest ~ '^sha256:[0-9a-f]{64}$'),
  minimum_reader_version text not null,
  minimum_materializer_version text not null,
  mirror_payload jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, mirror_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, attempt_id)
    references semantic.semantic_legacy_equivalence_attempt (app_id, tenant_id, environment, semantic_domain, attempt_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_source_release (app_id, tenant_id, environment, semantic_domain, release_id)
);

-- ============================================================
-- 27. semantic_legacy_equivalence_receipt: committed release rollback window proof
-- Only proves hash-pinned suite; committed with release/attempt/mirror/pointer
-- ============================================================
create table semantic.semantic_legacy_equivalence_receipt (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  receipt_id uuid not null,
  release_id uuid not null,
  attempt_id uuid not null,
  suite_digest text not null
    check (suite_digest ~ '^sha256:[0-9a-f]{64}$'),
  receipt_digest text not null
    check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, receipt_id),
  unique (app_id, tenant_id, environment, semantic_domain, receipt_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_source_release (app_id, tenant_id, environment, semantic_domain, release_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, attempt_id)
    references semantic.semantic_legacy_equivalence_attempt (app_id, tenant_id, environment, semantic_domain, attempt_id)
);

-- ============================================================
-- 28. semantic_legacy_closure_authorization: close rollback window multi-signature
-- Exact domain/release/instance/traffic/cache/outbox/rehearsal digest
-- ============================================================
create table semantic.semantic_legacy_closure_authorization (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  authorization_id uuid not null,
  release_id uuid not null,
  closure_digest text not null
    check (closure_digest ~ '^sha256:[0-9a-f]{64}$'),
  instance_digest text not null
    check (instance_digest ~ '^sha256:[0-9a-f]{64}$'),
  traffic_digest text not null
    check (traffic_digest ~ '^sha256:[0-9a-f]{64}$'),
  cache_digest text not null
    check (cache_digest ~ '^sha256:[0-9a-f]{64}$'),
  outbox_digest text not null
    check (outbox_digest ~ '^sha256:[0-9a-f]{64}$'),
  rehearsal_digest text not null
    check (rehearsal_digest ~ '^sha256:[0-9a-f]{64}$'),
  nonce uuid not null,
  expires_at timestamptz not null,
  is_consumed boolean not null default false,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  consumed_at timestamptz,
  primary key (app_id, tenant_id, environment, semantic_domain, authorization_id),
  unique (app_id, tenant_id, environment, semantic_domain, nonce),
  foreign key (app_id, tenant_id, environment, semantic_domain, release_id)
    references semantic.semantic_source_release (app_id, tenant_id, environment, semantic_domain, release_id)
);
-- ============================================================
-- 10610: Rollback authorization and receipt tables
-- ============================================================

-- ============================================================
-- 29. semantic_rollback_authorization: aggregated rollback quorum receipt
-- Exact from/to/current tuple/digest; nonce single-use
-- ============================================================
create table semantic.semantic_rollback_authorization (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  authorization_id uuid not null,
  packet_id uuid not null,
  from_release_id uuid not null,
  from_release_generation bigint not null,
  to_release_id uuid not null,
  to_release_generation bigint not null,
  current_release_id uuid not null,
  current_release_generation bigint not null,
  authorization_digest text not null
    check (authorization_digest ~ '^sha256:[0-9a-f]{64}$'),
  decision_set_digest text not null
    check (decision_set_digest ~ '^sha256:[0-9a-f]{64}$'),
  nonce uuid not null,
  expires_at timestamptz not null,
  is_consumed boolean not null default false,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  consumed_at timestamptz,
  primary key (app_id, tenant_id, environment, semantic_domain, authorization_id),
  unique (app_id, tenant_id, environment, semantic_domain, nonce),
  foreign key (app_id, tenant_id, environment, semantic_domain, packet_id)
    references semantic.semantic_review_task (app_id, tenant_id, environment, semantic_domain, packet_id)
);

-- ============================================================
-- 30. semantic_rollback_receipt: rollback authorization and result
-- Append-only; from/to/reason/decision-set digest
-- ============================================================
create table semantic.semantic_rollback_receipt (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  receipt_id uuid not null,
  authorization_id uuid not null,
  from_release_id uuid not null,
  from_release_generation bigint not null,
  to_release_id uuid not null,
  to_release_generation bigint not null,
  rollback_reason text not null,
  decision_set_digest text not null
    check (decision_set_digest ~ '^sha256:[0-9a-f]{64}$'),
  receipt_digest text not null
    check (receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, receipt_id),
  unique (app_id, tenant_id, environment, semantic_domain, receipt_digest),
  foreign key (app_id, tenant_id, environment, semantic_domain, authorization_id)
    references semantic.semantic_rollback_authorization (app_id, tenant_id, environment, semantic_domain, authorization_id)
);
-- ============================================================
-- 10610: Semantic authority outbox table
-- ============================================================

-- ============================================================
-- 31. semantic_outbox: semantic authority change events
-- envelope: scope/event_id/type, counter_kind=RELEASE|ACTIVATION
-- axis_generation, observed release/activation generation
-- Published with corresponding Authority transaction atomically
-- ============================================================
create table semantic.semantic_outbox (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  event_id uuid not null,
  event_type text not null
    check (event_type in (
      'CANDIDATE_SUBMITTED', 'CANDIDATE_APPROVED', 'CANDIDATE_REJECTED',
      'CANDIDATE_PUBLISHED', 'CANDIDATE_STALE',
      'REVIEW_PACKET_CREATED', 'REVIEW_DECISION_RECORDED',
      'REVIEW_PACKET_CLOSED', 'REVIEW_PACKET_EXPIRED',
      'PUBLISH_ATTEMPT_PREPARED', 'PUBLISH_ATTEMPT_COMMITTED',
      'PUBLISH_ATTEMPT_STALE',
      'SOURCE_RELEASE_CREATED', 'SOURCE_RELEASE_ACTIVATED',
      'ROLLBACK_AUTHORIZED', 'ROLLBACK_EXECUTED',
      'RUNTIME_ACTIVATION_CHANGED', 'APPLICATION_ROLLBACK_EXECUTED',
      'LEGACY_CONTRACT_CLOSED', 'LEGACY_EQUIVALENCE_ATTEMPTED',
      'LEGACY_EQUIVALENCE_COMMITTED', 'LEGACY_CLOSURE_AUTHORIZED',
      'LEGACY_MIRROR_CREATED', 'LEGACY_EQUIVALENCE_RECEIPT_ISSUED'
    )),
  counter_kind text not null
    check (counter_kind in ('RELEASE', 'ACTIVATION')),
  axis_generation bigint not null
    check (axis_generation between 0 and 9007199254740991),
  observed_release_generation bigint
    check (observed_release_generation between 0 and 9007199254740991),
  observed_activation_generation bigint
    check (observed_activation_generation between 1 and 9007199254740991),
  event_payload jsonb not null,
  event_digest text not null
    check (event_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, semantic_domain, event_id),
  unique (app_id, tenant_id, environment, semantic_domain, event_digest)
);

-- Outbox high-water mark index for RELEASE axis
create index if not exists idx_semantic_outbox_release_watermark
  on semantic.semantic_outbox (app_id, tenant_id, environment, semantic_domain, counter_kind, axis_generation)
  where counter_kind = 'RELEASE';

-- Outbox high-water mark index for ACTIVATION axis
create index if not exists idx_semantic_outbox_activation_watermark
  on semantic.semantic_outbox (app_id, tenant_id, environment, semantic_domain, counter_kind, axis_generation)
  where counter_kind = 'ACTIVATION';
-- ============================================================
-- 10610: Internal helper functions for semantic authority
-- ============================================================

-- ============================================================
-- Helper: acquire semantic scope authority fence (transaction advisory lock)
-- All writers must acquire this lock before writing
-- ============================================================
create or replace function semantic.lock_semantic_authority_fence(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text
) returns void
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  lock_key bigint;
begin
  lock_key := ('x' || substr(
    extensions.digest(
      p_app_id::text || p_tenant_id::text || p_environment || p_semantic_domain,
      'sha256'
    ), 1, 16
  ))::bit(64)::bigint;
  perform pg_advisory_xact_lock(lock_key);
end;
$function$;

-- ============================================================
-- Helper: acquire packet-level advisory lock
-- Must be acquired after scope authority fence, in canonical lock order
-- ============================================================
create or replace function semantic.lock_packet(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_packet_id uuid
) returns void
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  lock_key bigint;
begin
  lock_key := ('x' || substr(
    extensions.digest(
      p_app_id::text || p_tenant_id::text || p_environment || p_semantic_domain || p_packet_id::text,
      'sha256'
    ), 1, 16
  ))::bit(64)::bigint;
  perform pg_advisory_xact_lock(lock_key);
end;
$function$;

-- ============================================================
-- Helper: verify current policy/assignment/membership are current
-- Returns true if all checks pass
-- ============================================================
create or replace function semantic.verify_current_review_policy(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_expected_policy_version bigint,
  p_expected_policy_digest text
) returns boolean
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_current_policy_version bigint;
  v_current_policy_digest text;
begin
  select pointer.current_policy_version, pointer.current_policy_digest
  into v_current_policy_version, v_current_policy_digest
  from semantic.semantic_reviewer_policy_pointer as pointer
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.semantic_domain = p_semantic_domain;
  if not found then
    return false;
  end if;
  return v_current_policy_version = p_expected_policy_version
    and v_current_policy_digest = p_expected_policy_digest;
end;
$function$;

-- ============================================================
-- Helper: compute canonical hash for a JSONB value
-- ============================================================
create or replace function semantic.semantic_sha256(
  p_input text,
  p_salt jsonb default '{}'::jsonb
) returns text
  language sql
  immutable
  strict
  set search_path = ''
as $function$
  select 'sha256:' || pg_catalog.encode(
    extensions.digest(
      p_input || '|' || app_data_agent.runtime_canonical_json(p_salt),
      'sha256'
    ),
    'hex'
  );
$function$;

-- ============================================================
-- Helper: assert decision window is still open for a review packet
-- ============================================================
create or replace function semantic.assert_review_packet_open(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_packet_id uuid
) returns void
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_status text;
  v_outcome text;
  v_expires_at timestamptz;
begin
  select task.decision_window_status, task.review_outcome, task.decision_expires_at
  into v_status, v_outcome, v_expires_at
  from semantic.semantic_review_task as task
  where task.app_id = p_app_id
    and task.tenant_id = p_tenant_id
    and task.environment = p_environment
    and task.semantic_domain = p_semantic_domain
    and task.packet_id = p_packet_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_REVIEW_PACKET_NOT_FOUND';
  end if;
  if v_status = 'CLOSED' then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_REVIEW_WINDOW_CLOSED';
  end if;
  if v_outcome != 'PENDING' then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_REVIEW_PACKET_STALE';
  end if;
  if pg_catalog.clock_timestamp() > v_expires_at then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_REVIEW_PACKET_EXPIRED';
  end if;
end;
$function$;

-- ============================================================
-- Helper: verify principal is not in exclusion set
-- ============================================================
create or replace function semantic.verify_principal_not_excluded(
  p_principal text,
  p_exclusion_set jsonb
) returns void
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
begin
  if p_exclusion_set @> to_jsonb(p_principal) then
    raise exception using errcode = '42501', message = 'SEMANTIC_PRINCIPAL_EXCLUDED';
  end if;
end;
$function$;
-- ============================================================
-- 10610: Decision RPC functions
-- Transaction pattern:
--   BEGIN
--     ACQUIRE scope_authority_fence advisory lock
--     ACQUIRE packet advisory lock
--     LOCK semantic_authority_fence FOR UPDATE
--     LOCK semantic_review_task FOR UPDATE
--     ASSERT packet.decision_window_status = OPEN
--     ASSERT review_outcome = PENDING && now < decision_expires_at
--     LOCK current policy/assignment/membership rows in canonical order
--     ASSERT base/policy/membership/principal role/eligibility/exclusion are current
--     INSERT immutable decision UNIQUE(scope, packet, principal, semantic_role)
--     IF veto: UPDATE packet SET decision_window_status=CLOSED, review_outcome=VETOED
--     ELSE IF quorum: UPDATE packet SET decision_window_status=CLOSED, review_outcome=APPROVED
--   COMMIT
-- ============================================================

-- ============================================================
-- Record a review decision (APPROVE or REJECT)
-- A7 Agent: cannot approve/reject (only propose/submit)
-- A2 Human Reviewer: can approve/reject, human session only
-- ============================================================
create or replace function semantic.record_review_decision(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_packet_id uuid,
  p_principal text,
  p_semantic_role text,
  p_decision text,
  p_decision_reason text default null
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_decision_id uuid;
  v_decision_digest text;
  v_current_veto_rules jsonb;
  v_current_quorum_rules jsonb;
  v_exclusion_set jsonb;
  v_packet_kind text;
  v_total_approvals integer;
  v_total_rejections integer;
  v_required_approvals integer;
  v_veto_count integer;
  v_min_reviewers integer;
  v_decision_set_digest text;
  v_result jsonb;
begin
  -- Acquire locks in canonical order
  perform semantic.lock_semantic_authority_fence(p_app_id, p_tenant_id, p_environment, p_semantic_domain);
  perform semantic.lock_packet(p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_packet_id);

  -- Lock authority fence row
  perform 1
  from semantic.semantic_authority_fence as fence
  where fence.app_id = p_app_id
    and fence.tenant_id = p_tenant_id
    and fence.environment = p_environment
  for update;

  -- Assert packet is open
  perform semantic.assert_review_packet_open(p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_packet_id);

  -- Get packet details
  select task.packet_kind, task.veto_rules_snapshot, task.quorum_rules_snapshot, task.exclusion_set
  into v_packet_kind, v_current_veto_rules, v_current_quorum_rules, v_exclusion_set
  from semantic.semantic_review_task as task
  where task.app_id = p_app_id
    and task.tenant_id = p_tenant_id
    and task.environment = p_environment
    and task.semantic_domain = p_semantic_domain
    and task.packet_id = p_packet_id
  for update;

  -- Verify principal not excluded
  perform semantic.verify_principal_not_excluded(p_principal, v_exclusion_set);

  -- Verify principal has valid assignment for this role
  perform 1
  from semantic.semantic_reviewer_assignment as assignment
  where assignment.app_id = p_app_id
    and assignment.tenant_id = p_tenant_id
    and assignment.environment = p_environment
    and assignment.semantic_domain = p_semantic_domain
    and assignment.principal = p_principal
    and assignment.semantic_role = p_semantic_role
    and assignment.is_active = true
    and (assignment.expires_at is null or assignment.expires_at > pg_catalog.clock_timestamp())
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'SEMANTIC_REVIEWER_REQUIRED';
  end if;

  -- Generate decision ID and digest
  v_decision_id := extensions.gen_random_uuid();
  v_decision_digest := semantic.semantic_sha256(
    p_packet_id::text || p_principal || p_semantic_role || p_decision || coalesce(p_decision_reason, ''),
    jsonb_build_object('version', '1.0.0', 'kind', 'review_decision')
  );

  -- Insert immutable decision
  insert into semantic.semantic_review_decision (
    app_id, tenant_id, environment, semantic_domain,
    packet_id, decision_id, principal, semantic_role,
    decision, decision_reason, decision_digest
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    p_packet_id, v_decision_id, p_principal, p_semantic_role,
    p_decision, p_decision_reason, v_decision_digest
  );

  -- Count current approvals and rejections
  select count(*) into v_total_approvals
  from semantic.semantic_review_decision as decision
  where decision.app_id = p_app_id
    and decision.tenant_id = p_tenant_id
    and decision.environment = p_environment
    and decision.semantic_domain = p_semantic_domain
    and decision.packet_id = p_packet_id
    and decision.decision = 'APPROVE';

  select count(*) into v_total_rejections
  from semantic.semantic_review_decision as decision
  where decision.app_id = p_app_id
    and decision.tenant_id = p_tenant_id
    and decision.environment = p_environment
    and decision.semantic_domain = p_semantic_domain
    and decision.packet_id = p_packet_id
    and decision.decision = 'REJECT';

  -- Check veto rules
  v_veto_count := (v_current_veto_rules->>'min_veto_count')::integer;
  if v_veto_count is null then
    v_veto_count := 1;
  end if;

  if p_decision = 'REJECT' and v_total_rejections >= v_veto_count then
    -- Veto: close packet with VETOED
    update semantic.semantic_review_task as task
    set decision_window_status = 'CLOSED',
        review_outcome = 'VETOED',
        closed_at = pg_catalog.clock_timestamp()
    where task.app_id = p_app_id
      and task.tenant_id = p_tenant_id
      and task.environment = p_environment
      and task.semantic_domain = p_semantic_domain
      and task.packet_id = p_packet_id;

    v_result := jsonb_build_object(
      'decision_id', v_decision_id,
      'decision_digest', v_decision_digest,
      'packet_closed', true,
      'outcome', 'VETOED',
      'total_approvals', v_total_approvals,
      'total_rejections', v_total_rejections
    );
  else
    -- Check quorum rules
    v_required_approvals := (v_current_quorum_rules->>'required_approvals')::integer;
    if v_required_approvals is null then
      v_min_reviewers := (v_current_quorum_rules->>'min_reviewers')::integer;
      if v_min_reviewers is null then
        v_required_approvals := 1;
      else
        v_required_approvals := v_min_reviewers;
      end if;
    end if;

    if v_total_approvals >= v_required_approvals then
      -- Quorum reached: compute decision set digest and close
      v_decision_set_digest := semantic.semantic_sha256(
        p_packet_id::text || v_total_approvals::text || v_total_rejections::text,
        jsonb_build_object('version', '1.0.0', 'kind', 'decision_set')
      );

      update semantic.semantic_review_task as task
      set decision_window_status = 'CLOSED',
          review_outcome = 'APPROVED',
          closed_at = pg_catalog.clock_timestamp()
      where task.app_id = p_app_id
        and task.tenant_id = p_tenant_id
        and task.environment = p_environment
        and task.semantic_domain = p_semantic_domain
        and task.packet_id = p_packet_id;

      v_result := jsonb_build_object(
        'decision_id', v_decision_id,
        'decision_digest', v_decision_digest,
        'packet_closed', true,
        'outcome', 'APPROVED',
        'decision_set_digest', v_decision_set_digest,
        'total_approvals', v_total_approvals,
        'total_rejections', v_total_rejections
      );
    else
      v_result := jsonb_build_object(
        'decision_id', v_decision_id,
        'decision_digest', v_decision_digest,
        'packet_closed', false,
        'outcome', 'PENDING',
        'total_approvals', v_total_approvals,
        'total_rejections', v_total_rejections,
        'required_approvals', v_required_approvals
      );
    end if;
  end if;

  return v_result;
end;
$function$;
-- ============================================================
-- 10610: Publish RPC functions
-- A8 Publisher: deterministic publish/rollback, 4 narrow credentials only
-- ============================================================

-- ============================================================
-- Prepare publish attempt: create PREPARED attempt, CAS candidate to PUBLISHING
-- ============================================================
create or replace function semantic.prepare_publish_attempt(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_packet_id uuid,
  p_candidate_id uuid,
  p_compiler_bundle_digest text,
  p_catalog_fence_epoch bigint,
  p_dependency_generation bigint,
  p_target_generation bigint,
  p_idempotency_digest text,
  p_conditional_legacy_plan jsonb default null
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_attempt_id uuid;
  v_result jsonb;
begin
  -- Acquire locks in canonical order
  perform semantic.lock_semantic_authority_fence(p_app_id, p_tenant_id, p_environment, p_semantic_domain);
  perform semantic.lock_packet(p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_packet_id);

  -- Lock authority fence and packet
  perform 1
  from semantic.semantic_authority_fence as fence
  where fence.app_id = p_app_id
    and fence.tenant_id = p_tenant_id
    and fence.environment = p_environment
  for update;

  -- Verify packet is CLOSED + APPROVED
  perform 1
  from semantic.semantic_review_task as task
  where task.app_id = p_app_id
    and task.tenant_id = p_tenant_id
    and task.environment = p_environment
    and task.semantic_domain = p_semantic_domain
    and task.packet_id = p_packet_id
    and task.decision_window_status = 'CLOSED'
    and task.review_outcome = 'APPROVED'
    and (task.publish_expires_at is null or task.publish_expires_at > pg_catalog.clock_timestamp())
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_PUBLISH_CONFLICT';
  end if;

  -- CAS candidate to PUBLISHING
  update semantic.semantic_candidate as candidate
  set candidate_status = 'PUBLISHING',
      updated_at = pg_catalog.clock_timestamp()
  where candidate.app_id = p_app_id
    and candidate.tenant_id = p_tenant_id
    and candidate.environment = p_environment
    and candidate.semantic_domain = p_semantic_domain
    and candidate.candidate_id = p_candidate_id
    and candidate.candidate_status = 'APPROVED';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_CANDIDATE_NOT_PUBLISHED';
  end if;

  -- Create PREPARED attempt
  v_attempt_id := extensions.gen_random_uuid();
  insert into semantic.semantic_publish_attempt (
    app_id, tenant_id, environment, semantic_domain,
    attempt_id, packet_id, candidate_id, attempt_state,
    compiler_bundle_digest, catalog_fence_epoch, dependency_generation,
    target_generation, idempotency_digest, conditional_legacy_plan
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    v_attempt_id, p_packet_id, p_candidate_id, 'PREPARED',
    p_compiler_bundle_digest, p_catalog_fence_epoch, p_dependency_generation,
    p_target_generation, p_idempotency_digest, p_conditional_legacy_plan
  );

  v_result := jsonb_build_object(
    'attempt_id', v_attempt_id,
    'attempt_state', 'PREPARED',
    'target_generation', p_target_generation
  );

  return v_result;
end;
$function$;

-- ============================================================
-- Commit publish attempt: atomically commit release and projections
-- ============================================================
create or replace function semantic.commit_publish_attempt(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_attempt_id uuid,
  p_executable_projection_ref uuid,
  p_executable_projection_hash text,
  p_relationship_projection_ref uuid,
  p_relationship_projection_hash text,
  p_runtime_restriction_projection_ref uuid,
  p_runtime_restriction_projection_hash text,
  p_profile_child_manifest jsonb default null,
  p_committed_legacy_attempt_ref uuid default null
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_release_id uuid;
  v_release_digest text;
  v_packet_id uuid;
  v_candidate_id uuid;
  v_target_generation bigint;
  v_decision_set_digest text;
  v_quorum_snapshot jsonb;
  v_result jsonb;
begin
  -- Acquire locks
  perform semantic.lock_semantic_authority_fence(p_app_id, p_tenant_id, p_environment, p_semantic_domain);

  -- Lock attempt, active pointer, authority fence, packet
  perform 1
  from semantic.semantic_authority_fence as fence
  where fence.app_id = p_app_id
    and fence.tenant_id = p_tenant_id
    and fence.environment = p_environment
  for update;

  -- Verify attempt is PREPARED and lock it
  select attempt.packet_id, attempt.candidate_id, attempt.target_generation,
         attempt.conditional_legacy_plan
  into v_packet_id, v_candidate_id, v_target_generation
  from semantic.semantic_publish_attempt as attempt
  where attempt.app_id = p_app_id
    and attempt.tenant_id = p_tenant_id
    and attempt.environment = p_environment
    and attempt.semantic_domain = p_semantic_domain
    and attempt.attempt_id = p_attempt_id
    and attempt.attempt_state = 'PREPARED'
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_PUBLISH_CONFLICT';
  end if;

  -- Lock active pointer
  perform 1
  from semantic.semantic_active_pointer as pointer
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.semantic_domain = p_semantic_domain
  for update;

  -- Lock runtime activation
  perform 1
  from semantic.semantic_runtime_activation as activation
  where activation.app_id = p_app_id
    and activation.tenant_id = p_tenant_id
    and activation.environment = p_environment
    and activation.semantic_domain = p_semantic_domain
  for update;

  -- Get decision set digest from packet
  select task.review_outcome
  into v_decision_set_digest
  from semantic.semantic_review_task as task
  where task.app_id = p_app_id
    and task.tenant_id = p_tenant_id
    and task.environment = p_environment
    and task.semantic_domain = p_semantic_domain
    and task.packet_id = v_packet_id;
  v_decision_set_digest := semantic.semantic_sha256(
    v_packet_id::text, jsonb_build_object('version', '1.0.0', 'kind', 'decision_set')
  );

  -- Create release
  v_release_id := extensions.gen_random_uuid();
  v_release_digest := semantic.semantic_sha256(
    v_attempt_id::text || v_target_generation::text,
    jsonb_build_object('version', '1.0.0', 'kind', 'source_release')
  );

  insert into semantic.semantic_source_release (
    app_id, tenant_id, environment, semantic_domain,
    release_id, release_generation, attempt_id, packet_id, candidate_id,
    release_digest, compiler_bundle_digest,
    executable_projection_ref, executable_projection_hash,
    relationship_projection_ref, relationship_projection_hash,
    runtime_restriction_projection_ref, runtime_restriction_projection_hash,
    profile_child_manifest,
    decision_set_digest, published_by
  ) select
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    v_release_id, v_target_generation, p_attempt_id, attempt.packet_id, attempt.candidate_id,
    v_release_digest, attempt.compiler_bundle_digest,
    p_executable_projection_ref, p_executable_projection_hash,
    p_relationship_projection_ref, p_relationship_projection_hash,
    p_runtime_restriction_projection_ref, p_runtime_restriction_projection_hash,
    p_profile_child_manifest,
    v_decision_set_digest, pg_catalog.session_user
  from semantic.semantic_publish_attempt as attempt
  where attempt.attempt_id = p_attempt_id;

  -- Update active pointer
  update semantic.semantic_active_pointer as pointer
  set current_release_id = v_release_id,
      current_release_generation = v_target_generation,
      current_release_digest = v_release_digest,
      pointer_generation = pointer.pointer_generation + 1,
      updated_at = pg_catalog.clock_timestamp(),
      updated_by = pg_catalog.session_user
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.semantic_domain = p_semantic_domain;

  -- Update runtime activation
  update semantic.semantic_runtime_activation as activation
  set current_release_id = v_release_id,
      current_release_generation = v_target_generation,
      updated_at = pg_catalog.clock_timestamp()
  where activation.app_id = p_app_id
    and activation.tenant_id = p_tenant_id
    and activation.environment = p_environment
    and activation.semantic_domain = p_semantic_domain;

  -- Mark attempt as COMMITTED
  update semantic.semantic_publish_attempt as attempt
  set attempt_state = 'COMMITTED',
      committed_release_ref = v_release_id,
      committed_legacy_attempt_ref = p_committed_legacy_attempt_ref,
      updated_at = pg_catalog.clock_timestamp()
  where attempt.attempt_id = p_attempt_id;

  -- Update candidate status
  update semantic.semantic_candidate as candidate
  set candidate_status = 'PUBLISHED',
      updated_at = pg_catalog.clock_timestamp()
  where candidate.candidate_id = v_candidate_id;

  v_result := jsonb_build_object(
    'release_id', v_release_id,
    'release_generation', v_target_generation,
    'release_digest', v_release_digest,
    'attempt_state', 'COMMITTED'
  );

  return v_result;
end;
$function$;
-- ============================================================
-- 10610: Rollback RPC functions
-- A8 Publisher: execute rollback with authorized nonce
-- ============================================================

-- ============================================================
-- Execute rollback: consume authorization and create rollback receipt
-- ============================================================
create or replace function semantic.execute_rollback(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_authorization_id uuid,
  p_nonce uuid,
  p_rollback_reason text
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_receipt_id uuid;
  v_receipt_digest text;
  v_from_release_id uuid;
  v_from_release_generation bigint;
  v_to_release_id uuid;
  v_to_release_generation bigint;
  v_authorization_digest text;
  v_decision_set_digest text;
  v_result jsonb;
begin
  -- Acquire scope authority fence
  perform semantic.lock_semantic_authority_fence(p_app_id, p_tenant_id, p_environment, p_semantic_domain);

  -- Lock authority fence
  perform 1
  from semantic.semantic_authority_fence as fence
  where fence.app_id = p_app_id
    and fence.tenant_id = p_tenant_id
    and fence.environment = p_environment
  for update;

  -- Lock runtime activation
  perform 1
  from semantic.semantic_runtime_activation as activation
  where activation.app_id = p_app_id
    and activation.tenant_id = p_tenant_id
    and activation.environment = p_environment
    and activation.semantic_domain = p_semantic_domain
  for update;

  -- Lock active pointer
  perform 1
  from semantic.semantic_active_pointer as pointer
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.semantic_domain = p_semantic_domain
  for update;

  -- Verify and consume authorization
  select auth.from_release_id, auth.from_release_generation,
         auth.to_release_id, auth.to_release_generation,
         auth.authorization_digest, auth.decision_set_digest
  into v_from_release_id, v_from_release_generation,
       v_to_release_id, v_to_release_generation,
       v_authorization_digest, v_decision_set_digest
  from semantic.semantic_rollback_authorization as auth
  where auth.app_id = p_app_id
    and auth.tenant_id = p_tenant_id
    and auth.environment = p_environment
    and auth.semantic_domain = p_semantic_domain
    and auth.authorization_id = p_authorization_id
    and auth.nonce = p_nonce
    and auth.is_consumed = false
    and auth.expires_at > pg_catalog.clock_timestamp()
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_ROLLBACK_CONFLICT';
  end if;

  -- Mark authorization as consumed
  update semantic.semantic_rollback_authorization as auth
  set is_consumed = true,
      consumed_at = pg_catalog.clock_timestamp()
  where auth.authorization_id = p_authorization_id;

  -- Create rollback receipt
  v_receipt_id := extensions.gen_random_uuid();
  v_receipt_digest := semantic.semantic_sha256(
    p_authorization_id::text || p_rollback_reason,
    jsonb_build_object('version', '1.0.0', 'kind', 'rollback_receipt')
  );

  insert into semantic.semantic_rollback_receipt (
    app_id, tenant_id, environment, semantic_domain,
    receipt_id, authorization_id,
    from_release_id, from_release_generation,
    to_release_id, to_release_generation,
    rollback_reason, decision_set_digest, receipt_digest
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    v_receipt_id, p_authorization_id,
    v_from_release_id, v_from_release_generation,
    v_to_release_id, v_to_release_generation,
    p_rollback_reason, v_decision_set_digest, v_receipt_digest
  );

  -- Update active pointer to target release
  update semantic.semantic_active_pointer as pointer
  set current_release_id = v_to_release_id,
      current_release_generation = v_to_release_generation,
      pointer_generation = pointer.pointer_generation + 1,
      updated_at = pg_catalog.clock_timestamp(),
      updated_by = pg_catalog.session_user
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.semantic_domain = p_semantic_domain;

  v_result := jsonb_build_object(
    'receipt_id', v_receipt_id,
    'receipt_digest', v_receipt_digest,
    'from_release_generation', v_from_release_generation,
    'to_release_generation', v_to_release_generation
  );

  return v_result;
end;
$function$;
-- ============================================================
-- 10610: Bootstrap RPC functions
-- A3 Admin: double-signed bootstrap manifest only
-- Independent bootstrap executor
-- ============================================================

-- ============================================================
-- Bootstrap domain: atomically create domain registry, policy, fence, and pointer
-- Requires double-signed packet from two distinct platform+domain owners
-- ============================================================
create or replace function semantic.bootstrap_domain(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_datasource_id uuid,
  p_domain_display_name text,
  p_bootstrap_packet_digest text,
  p_signer_one_principal text,
  p_signer_two_principal text,
  p_signer_one_signature text,
  p_signer_two_signature text,
  p_initial_review_policy_payload jsonb,
  p_initial_review_policy_digest text,
  p_initial_reviewer_assignments jsonb,
  p_initial_catalog_fence_digest text,
  p_initial_compiler_dependency_digest text,
  p_initial_closure_policy_digest text,
  p_bootstrap_nonce uuid,
  p_bootstrap_expires_at timestamptz
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_bootstrap_id uuid;
  v_fence_epoch bigint;
  v_result jsonb;
  v_initial_policy_version bigint;
  v_initial_reviewer_count integer;
  v_assignment record;
begin
  -- Acquire scope authority fence
  perform semantic.lock_semantic_authority_fence(p_app_id, p_tenant_id, p_environment, p_semantic_domain);

  -- Lock authority fence
  perform 1
  from semantic.semantic_authority_fence as fence
  where fence.app_id = p_app_id
    and fence.tenant_id = p_tenant_id
    and fence.environment = p_environment
  for update;

  -- Verify domain not already registered
  perform 1
  from semantic.semantic_domain_registry as registry
  where registry.app_id = p_app_id
    and registry.tenant_id = p_tenant_id
    and registry.environment = p_environment
    and registry.semantic_domain = p_semantic_domain;
  if found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_DOMAIN_BOOTSTRAP_CLOSED';
  end if;

  -- Verify signers are distinct
  if p_signer_one_principal = p_signer_two_principal then
    raise exception using errcode = '42501', message = 'SEMANTIC_MIGRATION_EXECUTOR_UNSAFE';
  end if;

  -- Create bootstrap receipt
  v_bootstrap_id := extensions.gen_random_uuid();
  insert into semantic.semantic_domain_bootstrap (
    app_id, tenant_id, environment, semantic_domain,
    bootstrap_id, bootstrap_packet_digest,
    signer_one_principal, signer_two_principal,
    signer_one_signature, signer_two_signature,
    initial_review_policy_digest,
    initial_catalog_fence_digest,
    initial_compiler_dependency_digest,
    bootstrap_nonce, bootstrap_expires_at
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    v_bootstrap_id, p_bootstrap_packet_digest,
    p_signer_one_principal, p_signer_two_principal,
    p_signer_one_signature, p_signer_two_signature,
    p_initial_review_policy_digest,
    p_initial_catalog_fence_digest,
    p_initial_compiler_dependency_digest,
    p_bootstrap_nonce, p_bootstrap_expires_at
  );

  -- Create domain registry entry
  insert into semantic.semantic_domain_registry (
    app_id, tenant_id, environment, semantic_domain,
    datasource_id, domain_display_name, created_by
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    p_datasource_id, p_domain_display_name, pg_catalog.session_user
  );

  -- Create initial review policy (version 1)
  insert into semantic.semantic_reviewer_policy_revision (
    app_id, tenant_id, environment, semantic_domain,
    policy_version, policy_digest, policy_payload,
    quorum_rules, veto_rules, expiry_rules, role_separation_rules,
    min_reviewers, decision_timeout_seconds, created_by
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    1, p_initial_review_policy_digest, p_initial_review_policy_payload,
    p_initial_review_policy_payload->'quorum_rules',
    p_initial_review_policy_payload->'veto_rules',
    p_initial_review_policy_payload->'expiry_rules',
    p_initial_review_policy_payload->'role_separation_rules',
    (p_initial_review_policy_payload->>'min_reviewers')::integer,
    (p_initial_review_policy_payload->>'decision_timeout_seconds')::integer,
    pg_catalog.session_user
  );

  -- Create reviewer assignments
  for v_assignment in select * from jsonb_to_recordset(p_initial_reviewer_assignments) as x(
    principal text, semantic_role text, membership_version bigint
  )
  loop
    insert into semantic.semantic_reviewer_assignment (
      app_id, tenant_id, environment, semantic_domain,
      assignment_id, principal, semantic_role,
      membership_version, policy_version, assigned_by
    ) values (
      p_app_id, p_tenant_id, p_environment, p_semantic_domain,
      extensions.gen_random_uuid(), v_assignment.principal, v_assignment.semantic_role,
      v_assignment.membership_version, 1, pg_catalog.session_user
    );
    v_initial_reviewer_count := v_initial_reviewer_count + 1;
  end loop;

  -- Verify at least one reviewer is different from both signers
  perform 1
  from semantic.semantic_reviewer_assignment as assignment
  where assignment.app_id = p_app_id
    and assignment.tenant_id = p_tenant_id
    and assignment.environment = p_environment
    and assignment.semantic_domain = p_semantic_domain
    and assignment.principal not in (p_signer_one_principal, p_signer_two_principal);
  if not found then
    raise exception using errcode = '42501', message = 'SEMANTIC_MIGRATION_EXECUTOR_UNSAFE';
  end if;

  -- Create policy pointer (version 1)
  insert into semantic.semantic_reviewer_policy_pointer (
    app_id, tenant_id, environment, semantic_domain,
    current_policy_version, current_policy_digest, updated_by
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    1, p_initial_review_policy_digest, pg_catalog.session_user
  );

  -- Create catalog fence (epoch 0)
  v_fence_epoch := pg_catalog.pg_current_xact_id()::bigint;
  insert into semantic.semantic_catalog_fence (
    app_id, tenant_id, environment, semantic_domain,
    catalog_epoch, catalog_digest, schema_digest
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    0, p_initial_catalog_fence_digest, p_initial_catalog_fence_digest
  );

  -- Create dependency pointer
  insert into semantic.semantic_dependency_pointer (
    app_id, tenant_id, environment, semantic_domain,
    current_catalog_epoch, current_catalog_digest,
    current_compiler_bundle_digest, current_closure_policy_digest, updated_by
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    0, p_initial_catalog_fence_digest,
    p_initial_compiler_dependency_digest, p_initial_closure_policy_digest,
    pg_catalog.session_user
  );

  -- Create genesis active pointer (generation 0, null release)
  insert into semantic.semantic_active_pointer (
    app_id, tenant_id, environment, semantic_domain,
    current_release_generation, updated_by
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    0, pg_catalog.session_user
  );

  -- Create runtime activation (LEGACY mode)
  insert into semantic.semantic_runtime_activation (
    app_id, tenant_id, environment, semantic_domain,
    runtime_mode, activation_generation,
    current_release_generation
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    'LEGACY', 1, 0
  );

  -- Mark bootstrap as CLOSED
  update semantic.semantic_domain_bootstrap as bootstrap
  set is_closed = true,
      closed_at = pg_catalog.clock_timestamp()
  where bootstrap.bootstrap_id = v_bootstrap_id;

  v_result := jsonb_build_object(
    'bootstrap_id', v_bootstrap_id,
    'bootstrap_packet_digest', p_bootstrap_packet_digest,
    'initial_policy_version', 1,
    'initial_reviewer_count', v_initial_reviewer_count,
    'runtime_mode', 'LEGACY'
  );

  return v_result;
end;
$function$;
-- ============================================================
-- 10610: Lifecycle cleanup functions (expiry sweeper)
-- ============================================================

-- ============================================================
-- Expire stale review packets: close expired OPEN review packets
-- ============================================================
create or replace function semantic.expire_stale_review_packets(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_batch_size integer default 100
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_expired_count integer := 0;
  v_packet record;
begin
  perform semantic.lock_semantic_authority_fence(p_app_id, p_tenant_id, p_environment, p_semantic_domain);

  for v_packet in
    select task.packet_id
    from semantic.semantic_review_task as task
    where task.app_id = p_app_id
      and task.tenant_id = p_tenant_id
      and task.environment = p_environment
      and task.semantic_domain = p_semantic_domain
      and task.decision_window_status = 'OPEN'
      and task.decision_expires_at < pg_catalog.clock_timestamp()
    limit p_batch_size
    for update skip locked
  loop
    update semantic.semantic_review_task as task
    set decision_window_status = 'CLOSED',
        review_outcome = 'EXPIRED',
        closed_at = pg_catalog.clock_timestamp()
    where task.packet_id = v_packet.packet_id;
    v_expired_count := v_expired_count + 1;
  end loop;

  return jsonb_build_object('expired_packets', v_expired_count);
end;
$function$;

-- ============================================================
-- Expire stale publish attempts: mark PREPARED attempts as STALE
-- when base dependency has changed
-- ============================================================
create or replace function semantic.expire_stale_publish_attempts(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_batch_size integer default 100
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_stale_count integer := 0;
  v_attempt record;
  v_current_dependency_generation bigint;
begin
  perform semantic.lock_semantic_authority_fence(p_app_id, p_tenant_id, p_environment, p_semantic_domain);

  select pointer.pointer_generation
  into v_current_dependency_generation
  from semantic.semantic_dependency_pointer as pointer
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.semantic_domain = p_semantic_domain;

  for v_attempt in
    select attempt.attempt_id
    from semantic.semantic_publish_attempt as attempt
    where attempt.app_id = p_app_id
      and attempt.tenant_id = p_tenant_id
      and attempt.environment = p_environment
      and attempt.semantic_domain = p_semantic_domain
      and attempt.attempt_state = 'PREPARED'
      and attempt.dependency_generation < v_current_dependency_generation
    limit p_batch_size
    for update skip locked
  loop
    update semantic.semantic_publish_attempt as attempt
    set attempt_state = 'STALE',
        updated_at = pg_catalog.clock_timestamp()
    where attempt.attempt_id = v_attempt.attempt_id;
    v_stale_count := v_stale_count + 1;
  end loop;

  return jsonb_build_object('stale_attempts', v_stale_count);
end;
$function$;

-- ============================================================
-- Expire stale bootstrap packets: close expired non-CLOSED bootstrap packets
-- ============================================================
create or replace function semantic.expire_stale_bootstrap_packets(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_batch_size integer default 100
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_expired_count integer := 0;
  v_bootstrap record;
begin
  perform semantic.lock_semantic_authority_fence(p_app_id, p_tenant_id, p_environment, p_semantic_domain);

  for v_bootstrap in
    select bootstrap.bootstrap_id
    from semantic.semantic_domain_bootstrap as bootstrap
    where bootstrap.app_id = p_app_id
      and bootstrap.tenant_id = p_tenant_id
      and bootstrap.environment = p_environment
      and bootstrap.semantic_domain = p_semantic_domain
      and bootstrap.is_closed = false
      and bootstrap.bootstrap_expires_at < pg_catalog.clock_timestamp()
    limit p_batch_size
    for update skip locked
  loop
    update semantic.semantic_domain_bootstrap as bootstrap
    set is_closed = true,
        closed_at = pg_catalog.clock_timestamp()
    where bootstrap.bootstrap_id = v_bootstrap.bootstrap_id;
    v_expired_count := v_expired_count + 1;
  end loop;

  return jsonb_build_object('expired_bootstrap_packets', v_expired_count);
end;
$function$;
-- ============================================================
-- 10610: RLS, policy, ACL, and owner assignments for semantic schema
-- ============================================================

-- ============================================================
-- Part 1: Owner assignments for all 31 semantic tables
-- ============================================================

alter table semantic.semantic_domain_registry owner to data_agent_u6_data_owner;
alter table semantic.semantic_domain_bootstrap owner to data_agent_u6_data_owner;
alter table semantic.semantic_authority_fence owner to data_agent_u6_data_owner;
alter table semantic.semantic_reviewer_policy_revision owner to data_agent_u6_data_owner;
alter table semantic.semantic_reviewer_assignment owner to data_agent_u6_data_owner;
alter table semantic.semantic_reviewer_policy_pointer owner to data_agent_u6_data_owner;
alter table semantic.semantic_catalog_fence owner to data_agent_u6_data_owner;
alter table semantic.semantic_dependency_pointer owner to data_agent_u6_data_owner;
alter table semantic.semantic_source_revision owner to data_agent_u6_data_owner;
alter table semantic.semantic_candidate owner to data_agent_u6_data_owner;
alter table semantic.semantic_candidate_revision owner to data_agent_u6_data_owner;
alter table semantic.semantic_validation_receipt owner to data_agent_u6_data_owner;
alter table semantic.semantic_review_task owner to data_agent_u6_data_owner;
alter table semantic.semantic_review_decision owner to data_agent_u6_data_owner;
alter table semantic.semantic_publish_attempt owner to data_agent_u6_data_owner;
alter table semantic.semantic_source_release owner to data_agent_u6_data_owner;
alter table semantic.semantic_executable_projection owner to data_agent_u6_data_owner;
alter table semantic.semantic_relationship_projection owner to data_agent_u6_data_owner;
alter table semantic.semantic_runtime_restriction_projection owner to data_agent_u6_data_owner;
alter table semantic.semantic_descriptive_contribution_profile_projection owner to data_agent_u6_data_owner;
alter table semantic.semantic_active_pointer owner to data_agent_u6_data_owner;
alter table semantic.semantic_grounding_issuer_draft owner to data_agent_u6_data_owner;
alter table semantic.semantic_runtime_projection_binding owner to data_agent_u6_data_owner;
alter table semantic.semantic_runtime_activation owner to data_agent_u6_data_owner;
alter table semantic.semantic_legacy_equivalence_attempt owner to data_agent_u6_data_owner;
alter table semantic.semantic_legacy_compatible_mirror owner to data_agent_u6_data_owner;
alter table semantic.semantic_legacy_equivalence_receipt owner to data_agent_u6_data_owner;
alter table semantic.semantic_legacy_closure_authorization owner to data_agent_u6_data_owner;
alter table semantic.semantic_rollback_authorization owner to data_agent_u6_data_owner;
alter table semantic.semantic_rollback_receipt owner to data_agent_u6_data_owner;
alter table semantic.semantic_outbox owner to data_agent_u6_data_owner;

-- ============================================================
-- Part 2: Enable RLS + FORCE RLS for all 31 semantic tables
-- ============================================================

alter table semantic.semantic_domain_registry enable row level security;
alter table semantic.semantic_domain_registry force row level security;

alter table semantic.semantic_domain_bootstrap enable row level security;
alter table semantic.semantic_domain_bootstrap force row level security;

alter table semantic.semantic_authority_fence enable row level security;
alter table semantic.semantic_authority_fence force row level security;

alter table semantic.semantic_reviewer_policy_revision enable row level security;
alter table semantic.semantic_reviewer_policy_revision force row level security;

alter table semantic.semantic_reviewer_assignment enable row level security;
alter table semantic.semantic_reviewer_assignment force row level security;

alter table semantic.semantic_reviewer_policy_pointer enable row level security;
alter table semantic.semantic_reviewer_policy_pointer force row level security;

alter table semantic.semantic_catalog_fence enable row level security;
alter table semantic.semantic_catalog_fence force row level security;

alter table semantic.semantic_dependency_pointer enable row level security;
alter table semantic.semantic_dependency_pointer force row level security;

alter table semantic.semantic_source_revision enable row level security;
alter table semantic.semantic_source_revision force row level security;

alter table semantic.semantic_candidate enable row level security;
alter table semantic.semantic_candidate force row level security;

alter table semantic.semantic_candidate_revision enable row level security;
alter table semantic.semantic_candidate_revision force row level security;

alter table semantic.semantic_validation_receipt enable row level security;
alter table semantic.semantic_validation_receipt force row level security;

alter table semantic.semantic_review_task enable row level security;
alter table semantic.semantic_review_task force row level security;

alter table semantic.semantic_review_decision enable row level security;
alter table semantic.semantic_review_decision force row level security;

alter table semantic.semantic_publish_attempt enable row level security;
alter table semantic.semantic_publish_attempt force row level security;

alter table semantic.semantic_source_release enable row level security;
alter table semantic.semantic_source_release force row level security;

alter table semantic.semantic_executable_projection enable row level security;
alter table semantic.semantic_executable_projection force row level security;

alter table semantic.semantic_relationship_projection enable row level security;
alter table semantic.semantic_relationship_projection force row level security;

alter table semantic.semantic_runtime_restriction_projection enable row level security;
alter table semantic.semantic_runtime_restriction_projection force row level security;

alter table semantic.semantic_descriptive_contribution_profile_projection enable row level security;
alter table semantic.semantic_descriptive_contribution_profile_projection force row level security;

alter table semantic.semantic_active_pointer enable row level security;
alter table semantic.semantic_active_pointer force row level security;

alter table semantic.semantic_grounding_issuer_draft enable row level security;
alter table semantic.semantic_grounding_issuer_draft force row level security;

alter table semantic.semantic_runtime_projection_binding enable row level security;
alter table semantic.semantic_runtime_projection_binding force row level security;

alter table semantic.semantic_runtime_activation enable row level security;
alter table semantic.semantic_runtime_activation force row level security;

alter table semantic.semantic_legacy_equivalence_attempt enable row level security;
alter table semantic.semantic_legacy_equivalence_attempt force row level security;

alter table semantic.semantic_legacy_compatible_mirror enable row level security;
alter table semantic.semantic_legacy_compatible_mirror force row level security;

alter table semantic.semantic_legacy_equivalence_receipt enable row level security;
alter table semantic.semantic_legacy_equivalence_receipt force row level security;

alter table semantic.semantic_legacy_closure_authorization enable row level security;
alter table semantic.semantic_legacy_closure_authorization force row level security;

alter table semantic.semantic_rollback_authorization enable row level security;
alter table semantic.semantic_rollback_authorization force row level security;

alter table semantic.semantic_rollback_receipt enable row level security;
alter table semantic.semantic_rollback_receipt force row level security;

alter table semantic.semantic_outbox enable row level security;
alter table semantic.semantic_outbox force row level security;

-- ============================================================
-- Part 3: RLS policies for semantic tables
-- App/Tenant/Environment/SemanticDomain isolation
-- ============================================================

-- Example RLS policy for semantic_domain_registry
create policy semantic_domain_registry_tenant_isolation
  on semantic.semantic_domain_registry
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

-- Example RLS policy for semantic_authority_fence
create policy semantic_authority_fence_tenant_isolation
  on semantic.semantic_authority_fence
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- Part 4: Function grants
-- ============================================================

-- Grant EXECUTE on internal functions to appropriate roles
grant execute on function semantic.lock_semantic_authority_fence(uuid, uuid, text, text) to data_agent_u6_rpc_owner;
grant execute on function semantic.lock_packet(uuid, uuid, text, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function semantic.verify_current_review_policy(uuid, uuid, text, text, bigint, text) to data_agent_u6_rpc_owner;
grant execute on function semantic.semantic_sha256(text, jsonb) to data_agent_u6_rpc_owner;
grant execute on function semantic.assert_review_packet_open(uuid, uuid, text, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function semantic.verify_principal_not_excluded(text, jsonb) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on decision RPC to A2 Human Reviewer role
grant execute on function semantic.record_review_decision(uuid, uuid, text, text, uuid, text, text, text, text) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on publish RPC to A8 Publisher role
grant execute on function semantic.prepare_publish_attempt(uuid, uuid, text, text, uuid, uuid, text, bigint, bigint, bigint, text, jsonb) to data_agent_u6_rpc_owner;
grant execute on function semantic.commit_publish_attempt(uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid, text, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on rollback RPC to A8 Publisher role
grant execute on function semantic.execute_rollback(uuid, uuid, text, text, uuid, uuid, text) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on bootstrap RPC to A3 Admin role
grant execute on function semantic.bootstrap_domain(
  uuid, uuid, text, text, uuid, text, text, text, text, text, text, jsonb, text, jsonb, text, text, text, uuid, timestamptz
) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on lifecycle cleanup functions
grant execute on function semantic.expire_stale_review_packets(uuid, uuid, text, text, integer) to data_agent_u6_rpc_owner;
grant execute on function semantic.expire_stale_publish_attempts(uuid, uuid, text, text, integer) to data_agent_u6_rpc_owner;
grant execute on function semantic.expire_stale_bootstrap_packets(uuid, uuid, text, text, integer) to data_agent_u6_rpc_owner;

-- ============================================================
-- Part 5: Schema USAGE grants
-- ============================================================
do $semantic_roles$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u6_web_role') then
    create role data_agent_u6_web_role
      nologin nosuperuser nocreatedb nocreaterole noreplication noinherit nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u6_worker_role') then
    create role data_agent_u6_worker_role
      nologin nosuperuser nocreatedb nocreaterole noreplication noinherit nobypassrls;
  end if;
end
$semantic_roles$;

grant usage on schema semantic to data_agent_u6_rpc_owner;
grant usage on schema semantic to data_agent_u6_web_role;
grant usage on schema semantic to data_agent_u6_worker_role;
-- ============================================================
-- 10610: Post-conditions, ledger checksum, and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010610_app_data_agent_semantic_control_plane',
  'sha256:dc7ec2f69c4feaa4fee583f40395b312cd050bcae9ec2bab2fcf76fc150392c9'
);

commit;
