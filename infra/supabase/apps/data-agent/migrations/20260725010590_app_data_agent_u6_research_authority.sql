-- u6_migration_checksum: sha256:091534f8dae4132700564920f4e3e7316f6f411aff92efb108aa49d6ce255678
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
       is distinct from 'sha256:70b5acaf260521a4b8d8581ca2f33dcebbeb6cd826315d3c246cfa80b35f0723'
    or pg_catalog.current_setting('app.u6_maintenance_window_id', true)
       is distinct from '00000000-0000-4000-8000-000000001590'
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

  if not exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'platform'
      and ledger.app_id is null
      and ledger.migration_version = '20260725000100_platform_foundation'
      and ledger.migration_checksum =
        'sha256:28a47b75076c9248621af8dd9d0b16091693a2c44add6f3d0edad6bcff7d0ad4'
  ) then
    raise exception using errcode = 'P0001', message = 'U6_MIGRATION_PLATFORM_LEDGER_INVALID';
  end if;
  if exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version =
        '20260725010590_app_data_agent_u6_research_authority'
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
              'sha256:28a47b75076c9248621af8dd9d0b16091693a2c44add6f3d0edad6bcff7d0ad4'
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
  platform.app_environment_lifecycle,
  platform.deployment_mappings
in access exclusive mode nowait;
do $capacity_and_data_preflight$
declare
  violation_count bigint;
begin
  if pg_catalog.pg_total_relation_size('app_data_agent.artifacts'::regclass) > 1073741824
    or pg_catalog.pg_total_relation_size('app_data_agent.memberships'::regclass) > 1073741824
    or pg_catalog.pg_total_relation_size('app_data_agent.outbox'::regclass) > 1073741824
    or pg_catalog.pg_total_relation_size('app_data_agent.run_attempts'::regclass) > 1073741824
    or pg_catalog.pg_total_relation_size('app_data_agent.runs'::regclass) > 1073741824
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
    or (select pg_catalog.count(*) from platform.app_environment_lifecycle) > 1000000
    or (select pg_catalog.count(*) from platform.deployment_mappings) > 1000000
  then
    raise exception using
      errcode = '54000',
      message = 'U6_MIGRATION_RELATION_LIMIT_EXCEEDED';
  end if;

  select pg_catalog.count(*)
  into violation_count
  from app_data_agent.artifacts as artifact
  where artifact.artifact_type in (
    'ResearchBrief', 'HypothesisSet', 'EvidencePlan',
    'ObligationExecutionDecision', 'QueryEvidence', 'AtomicClaim',
    'EvidenceRelation', 'EvidenceCheckReceipt', 'SupportDecision',
    'HypothesisAssessment', 'CoverageState', 'ResearchStopDecision',
    'ReportManifest', 'AnalysisReport', 'ReportProjectionReceipt',
    'EvidenceGateReceipt', 'ReportReadyCertificate',
    'ReadinessRevocationReceipt'
  )
    and (
      artifact.document_json #>> '{envelope,schema_version}',
      artifact.document_json #>> '{payload,protocol_version}'
    ) in (
      values
        ('2.0.0', 'research-brief@2.0.0'),
        ('2.0.0', 'hypothesis-set@2.0.0'),
        ('2.0.0', 'evidence-plan@2.0.0'),
        ('2.0.0', 'obligation-execution@2.0.0'),
        ('2.0.0', 'query-evidence@2.0.0'),
        ('2.0.0', 'atomic-claim@2.0.0'),
        ('2.0.0', 'evidence-relation@2.0.0'),
        ('1.0.0', 'evidence-check@1.0.0'),
        ('1.0.0', 'support-decision@1.0.0'),
        ('1.0.0', 'hypothesis-assessment@1.0.0'),
        ('1.0.0', 'coverage-state@1.0.0'),
        ('1.0.0', 'research-stop@1.0.0'),
        ('2.0.0', 'report-manifest@2.0.0'),
        ('2.0.0', 'analysis-report@2.0.0'),
        ('1.0.0', 'report-projection@1.0.0'),
        ('1.0.0', 'evidence-gate@1.0.0'),
        ('3.0.0', 'report-ready@3.0.0'),
        ('1.0.0', 'readiness-revocation@1.0.0')
    );
  if violation_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'U6_MIGRATION_DATA_PREFLIGHT_FAILED';
  end if;
end
$capacity_and_data_preflight$;

do $roles$
declare
  protected_role_names constant text[] := array[
    'data_agent_u6_data_owner',
    'data_agent_u6_platform_lock_owner',
    'data_agent_u6_rpc_owner',
    'data_agent_u6_provisioner_owner',
    'data_agent_u6_cleanup_owner',
    'data_agent_u6_provisioner'
  ];
  membership_violation_count bigint;
  membership_option_violation_count bigint;
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u6_data_owner'
  ) then
    create role data_agent_u6_data_owner
      nologin nosuperuser nocreatedb nocreaterole noreplication noinherit nobypassrls;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u6_platform_lock_owner'
  ) then
    create role data_agent_u6_platform_lock_owner
      nologin nosuperuser nocreatedb nocreaterole noreplication noinherit nobypassrls;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u6_rpc_owner'
  ) then
    create role data_agent_u6_rpc_owner
      nologin nosuperuser nocreatedb nocreaterole noreplication noinherit nobypassrls;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u6_provisioner_owner'
  ) then
    create role data_agent_u6_provisioner_owner
      nologin nosuperuser nocreatedb nocreaterole noreplication noinherit nobypassrls;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u6_cleanup_owner'
  ) then
    create role data_agent_u6_cleanup_owner
      nologin nosuperuser nocreatedb nocreaterole noreplication noinherit nobypassrls;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u6_provisioner'
  ) then
    create role data_agent_u6_provisioner
      nologin nosuperuser nocreatedb nocreaterole noreplication noinherit nobypassrls;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles as role
    where role.rolname in (
      'data_agent_u6_data_owner', 'data_agent_u6_platform_lock_owner',
      'data_agent_u6_rpc_owner', 'data_agent_u6_provisioner_owner',
      'data_agent_u6_cleanup_owner', 'data_agent_u6_provisioner'
    )
      and (
        role.rolcanlogin or role.rolsuper or role.rolcreatedb or role.rolcreaterole
        or role.rolreplication or role.rolinherit or role.rolbypassrls
      )
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_roles as role
    where role.rolname in (
      'data_agent_u6_data_owner', 'data_agent_u6_platform_lock_owner',
      'data_agent_u6_rpc_owner', 'data_agent_u6_provisioner_owner',
      'data_agent_u6_cleanup_owner', 'data_agent_u6_provisioner'
    )
  ) <> 6 then
    raise exception using errcode = '42501', message = 'U6_MIGRATION_ROLE_CONFLICT';
  end if;

  -- 90-rls-owner-grants.sql.inc grants no role membership. Consequently the
  -- five SECURITY DEFINER owner roles and the SET ROLE deployment executor
  -- must all have an empty direct and transitive member closure. PostgreSQL 17
  -- stores INHERIT/SET/ADMIN on each membership edge; inspect every edge in
  -- every reachable path so an existing indirect grant cannot survive
  -- preflight with deceptively safe role attributes.
  with recursive u6_protected_roles(root_role_id, root_role_name) as (
    select protected_role.oid, protected_role.rolname
    from pg_catalog.pg_roles as protected_role
    where protected_role.rolname = any(protected_role_names)
  ),
  u6_member_closure (
    root_role_id,
    root_role_name,
    granted_role_id,
    member_id,
    edge_inherit_option,
    edge_set_option,
    edge_admin_option,
    member_path
  ) as (
    select
      protected_role.root_role_id,
      protected_role.root_role_name,
      membership.roleid,
      membership.member,
      membership.inherit_option,
      membership.set_option,
      membership.admin_option,
      array[protected_role.root_role_id, membership.member]::oid[]
    from u6_protected_roles as protected_role
    join pg_catalog.pg_auth_members as membership
      on membership.roleid = protected_role.root_role_id
    union all
    select
      closure.root_role_id,
      closure.root_role_name,
      membership.roleid,
      membership.member,
      membership.inherit_option,
      membership.set_option,
      membership.admin_option,
      closure.member_path || membership.member
    from u6_member_closure as closure
    join pg_catalog.pg_auth_members as membership
      on membership.roleid = closure.member_id
    where not membership.member = any(closure.member_path)
  )
  select
    pg_catalog.count(*),
    pg_catalog.count(*) filter (
      where closure.edge_inherit_option
        or closure.edge_set_option
        or closure.edge_admin_option
    )
  into membership_violation_count, membership_option_violation_count
  from u6_member_closure as closure;

  if membership_violation_count <> 0
    or membership_option_violation_count <> 0
  then
    raise exception using
      errcode = '42501',
      message = 'U6_MIGRATION_ROLE_MEMBERSHIP_CONFLICT';
  end if;
end
$roles$;

create unique index runs_u6_scope_run_principal_uq_index
on app_data_agent.runs (
  app_id, tenant_id, environment, run_id, principal_id
);
alter table app_data_agent.runs
  add constraint runs_u6_scope_run_principal_uq
  unique using index runs_u6_scope_run_principal_uq_index;

create unique index run_attempts_u6_exact_fence_uq_index
on app_data_agent.run_attempts (
  app_id, tenant_id, environment, attempt_id, outbox_id, run_id, worker_fence
);
alter table app_data_agent.run_attempts
  add constraint run_attempts_u6_exact_fence_uq
  unique using index run_attempts_u6_exact_fence_uq_index;

create unique index outbox_u6_active_attempt_fence_uq_index
on app_data_agent.outbox (
  app_id, tenant_id, environment, outbox_id, run_id, active_attempt_id, run_fence
) nulls not distinct;
alter table app_data_agent.outbox
  add constraint outbox_u6_active_attempt_fence_uq
  unique using index outbox_u6_active_attempt_fence_uq_index;

create unique index artifacts_u6_exact_reference_uq_index
on app_data_agent.artifacts (
  app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash
);
alter table app_data_agent.artifacts
  add constraint artifacts_u6_exact_reference_uq
  unique using index artifacts_u6_exact_reference_uq_index;
create table app_data_agent.research_authority_capabilities (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  capability_id uuid not null,
  assignment_key text not null check (assignment_key ~ '^sha256:[0-9a-f]{64}$'),
  principal_id uuid not null,
  deployment_id uuid not null,
  membership_version bigint not null check (membership_version between 1 and 9007199254740991),
  app_epoch bigint not null check (app_epoch between 1 and 9007199254740991),
  membership_role text not null check (membership_role in ('OWNER', 'ANALYST', 'VIEWER')),
  authority_kind text not null check (
    authority_kind in (
      'SEMANTIC_FRONTIER_AUTHORITY', 'SCHEMA_FRONTIER_AUTHORITY',
      'DATA_SNAPSHOT_FRONTIER_AUTHORITY', 'POLICY_FRONTIER_AUTHORITY',
      'IDENTITY_FRONTIER_AUTHORITY', 'RESEARCH_ARTIFACT_AUTHORITY',
      'RESEARCH_STOP_AUTHORITY', 'CURRENT_READINESS_AUTHORITY',
      'SERVICE_REVOCATION_AUTHORITY', 'REPORT_READ_AUTHORITY',
      'REPORT_READ_EXPIRY_AUTHORITY', 'RESOURCE_AUTHORITY',
      'AGENT_DATA_PROJECTION_AUTHORITY', 'MODEL_INVOCATION_AUTHORITY',
      'SQL_INVOCATION_AUTHORITY', 'TOOL_INVOCATION_AUTHORITY',
      'TOOL_POLICY_AUTHORITY', 'TOOL_POLICY_EXPIRY_AUTHORITY',
      'RESULT_RETENTION_AUTHORITY', 'RESULT_ERASURE_AUTHORITY',
      'RESULT_DECRYPTION_AUTHORITY', 'RELEASE_GO_AUTHORITY'
    )
  ),
  artifact_authority_domain text check (
    artifact_authority_domain is null
    or artifact_authority_domain in (
      'BRIEF_SEMANTIC', 'PLANNING', 'OBLIGATION_EXECUTION', 'EVIDENCE',
      'CLAIM_STRUCTURE', 'RELATION', 'PROOF', 'COVERAGE', 'RESEARCH_STOP',
      'PROJECTION', 'EVIDENCE_GATE', 'READINESS'
    )
  ),
  frontier_kind text check (
    frontier_kind is null or frontier_kind in ('SEMANTIC', 'SCHEMA', 'DATA', 'POLICY', 'IDENTITY')
  ),
  resource_kind text check (resource_kind is null or resource_kind in ('MODEL', 'SQL', 'TOOL')),
  authority_epoch bigint not null check (authority_epoch between 0 and 9007199254740991),
  state text not null check (state in ('ACTIVE', 'REVOKED')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, capability_id),
  unique (app_id, tenant_id, environment, assignment_key, capability_id),
  unique (app_id, tenant_id, environment, capability_id, authority_epoch, principal_id),
  foreign key (app_id, tenant_id, environment, principal_id)
    references app_data_agent.memberships (app_id, tenant_id, environment, principal_id)
    on delete restrict not deferrable,
  foreign key (app_id, environment, deployment_id)
    references platform.deployment_mappings (app_id, environment, deployment_id)
    on delete restrict not deferrable,
  check (
    (
      authority_kind = 'RESEARCH_ARTIFACT_AUTHORITY'
      and artifact_authority_domain is not null
      and frontier_kind is null
      and resource_kind is null
    )
    or (
      authority_kind in (
        'SEMANTIC_FRONTIER_AUTHORITY', 'SCHEMA_FRONTIER_AUTHORITY',
        'DATA_SNAPSHOT_FRONTIER_AUTHORITY', 'POLICY_FRONTIER_AUTHORITY',
        'IDENTITY_FRONTIER_AUTHORITY'
      )
      and artifact_authority_domain is null
      and frontier_kind =
        case authority_kind
          when 'SEMANTIC_FRONTIER_AUTHORITY' then 'SEMANTIC'
          when 'SCHEMA_FRONTIER_AUTHORITY' then 'SCHEMA'
          when 'DATA_SNAPSHOT_FRONTIER_AUTHORITY' then 'DATA'
          when 'POLICY_FRONTIER_AUTHORITY' then 'POLICY'
          when 'IDENTITY_FRONTIER_AUTHORITY' then 'IDENTITY'
        end
      and resource_kind is null
    )
    or (
      authority_kind in (
        'RESOURCE_AUTHORITY', 'MODEL_INVOCATION_AUTHORITY',
        'SQL_INVOCATION_AUTHORITY', 'TOOL_INVOCATION_AUTHORITY'
      )
      and artifact_authority_domain is null
      and frontier_kind is null
      and resource_kind is not null
      and (
        authority_kind = 'RESOURCE_AUTHORITY'
        or resource_kind =
          case authority_kind
            when 'MODEL_INVOCATION_AUTHORITY' then 'MODEL'
            when 'SQL_INVOCATION_AUTHORITY' then 'SQL'
            when 'TOOL_INVOCATION_AUTHORITY' then 'TOOL'
          end
      )
    )
    or (
      authority_kind not in (
        'RESEARCH_ARTIFACT_AUTHORITY',
        'SEMANTIC_FRONTIER_AUTHORITY', 'SCHEMA_FRONTIER_AUTHORITY',
        'DATA_SNAPSHOT_FRONTIER_AUTHORITY', 'POLICY_FRONTIER_AUTHORITY',
        'IDENTITY_FRONTIER_AUTHORITY', 'RESOURCE_AUTHORITY',
        'MODEL_INVOCATION_AUTHORITY', 'SQL_INVOCATION_AUTHORITY',
        'TOOL_INVOCATION_AUTHORITY'
      )
      and artifact_authority_domain is null
      and frontier_kind is null
      and resource_kind is null
    )
  ),
  check (
    (state = 'ACTIVE' and revoked_at is null)
    or (state = 'REVOKED' and revoked_at is not null)
  ),
  check (
    (authority_kind = 'REPORT_READ_AUTHORITY' and membership_role in ('OWNER', 'ANALYST', 'VIEWER'))
    or (authority_kind = 'RELEASE_GO_AUTHORITY' and membership_role = 'OWNER')
    or (
      authority_kind not in ('REPORT_READ_AUTHORITY', 'RELEASE_GO_AUTHORITY')
      and membership_role in ('OWNER', 'ANALYST')
    )
  )
);

create unique index research_authority_capabilities_one_active_assignment
on app_data_agent.research_authority_capabilities (
  app_id, tenant_id, environment, principal_id, authority_kind,
  artifact_authority_domain, frontier_kind, resource_kind
) nulls not distinct
where state = 'ACTIVE';

create table app_data_agent.research_authority_capability_heads (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  assignment_key text not null check (assignment_key ~ '^sha256:[0-9a-f]{64}$'),
  principal_id uuid not null,
  authority_kind text not null,
  artifact_authority_domain text,
  frontier_kind text,
  resource_kind text,
  current_capability_id uuid not null,
  current_authority_epoch bigint not null
    check (current_authority_epoch between 0 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, assignment_key),
  unique nulls not distinct (
    app_id, tenant_id, environment, principal_id, authority_kind,
    artifact_authority_domain, frontier_kind, resource_kind
  ),
  foreign key (app_id, tenant_id, environment, principal_id)
    references app_data_agent.memberships (app_id, tenant_id, environment, principal_id)
    on delete restrict not deferrable,
  foreign key (app_id, tenant_id, environment, assignment_key, current_capability_id)
    references app_data_agent.research_authority_capabilities (
      app_id, tenant_id, environment, assignment_key, capability_id
    )
    on delete restrict
    deferrable initially deferred
);

create table app_data_agent.research_tool_permit_policy_limits (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  policy_version text not null check (pg_catalog.length(policy_version) between 1 and 128),
  policy_limit_hash text not null check (policy_limit_hash ~ '^sha256:[0-9a-f]{64}$'),
  tool_permit_max_ttl_ms bigint not null
    check (tool_permit_max_ttl_ms between 1 and 86400000),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, policy_version),
  unique (app_id, tenant_id, environment, policy_version, policy_limit_hash)
);

create table app_data_agent.research_result_retention_policies (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  policy_id uuid not null,
  policy_version text not null check (pg_catalog.length(policy_version) between 1 and 128),
  policy_hash text not null check (policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  retention_duration_ms bigint not null
    check (retention_duration_ms between 1 and 31536000000),
  legal_hold text not null check (legal_hold in ('NONE', 'ACTIVE')),
  hold_ref_hash text check (hold_ref_hash is null or hold_ref_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, policy_id, policy_version),
  unique (app_id, tenant_id, environment, policy_id, policy_version, policy_hash),
  check (
    (legal_hold = 'NONE' and hold_ref_hash is null)
    or (legal_hold = 'ACTIVE' and hold_ref_hash is not null)
  )
);

create table app_data_agent.research_result_retention_policy_heads (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  policy_id uuid not null,
  policy_version text not null,
  policy_hash text not null,
  head_version bigint not null default 1 check (head_version between 1 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment),
  foreign key (app_id, tenant_id, environment, policy_id, policy_version, policy_hash)
    references app_data_agent.research_result_retention_policies (
      app_id, tenant_id, environment, policy_id, policy_version, policy_hash
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_result_access_audit_retention_policies (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  policy_version text not null check (pg_catalog.length(policy_version) between 1 and 128),
  policy_hash text not null check (policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  online_retention_ms bigint not null check (online_retention_ms between 1 and 31536000000),
  erasure_sla_ms bigint not null check (erasure_sla_ms between 1 and 604800000),
  backup_retention_ms bigint not null check (backup_retention_ms between 0 and 3024000000),
  legal_hold text not null check (legal_hold in ('NONE', 'ACTIVE')),
  hold_ref_hash text check (hold_ref_hash is null or hold_ref_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, policy_version),
  unique (app_id, tenant_id, environment, policy_version, policy_hash),
  check (
    (legal_hold = 'NONE' and hold_ref_hash is null)
    or (legal_hold = 'ACTIVE' and hold_ref_hash is not null)
  )
);

create table app_data_agent.research_result_access_audit_retention_heads (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  policy_version text not null,
  policy_hash text not null,
  head_version bigint not null default 1 check (head_version between 1 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment),
  foreign key (app_id, tenant_id, environment, policy_version, policy_hash)
    references app_data_agent.research_result_access_audit_retention_policies (
      app_id, tenant_id, environment, policy_version, policy_hash
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_result_access_audit_purge_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  operation_id uuid not null,
  policy_version text not null,
  policy_hash text not null,
  purpose text not null check (purpose in ('RETENTION_PURGE', 'SUBJECT_ERASURE')),
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  deleted_count bigint not null check (deleted_count between 0 and 9007199254740991),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, operation_id),
  foreign key (app_id, tenant_id, environment, policy_version, policy_hash)
    references app_data_agent.research_result_access_audit_retention_policies (
      app_id, tenant_id, environment, policy_version, policy_hash
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_result_key_versions (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  key_kind text not null check (key_kind in ('ENCRYPTION', 'COMMITMENT')),
  key_version text not null check (pg_catalog.length(key_version) between 1 and 128),
  key_ref_hash text not null check (key_ref_hash ~ '^sha256:[0-9a-f]{64}$'),
  state text not null check (state in ('STAGED', 'ACTIVE', 'RETIRED', 'COMPROMISED')),
  predecessor_key_version text,
  staged_at timestamptz not null default pg_catalog.clock_timestamp(),
  activated_at timestamptz,
  retired_at timestamptz,
  compromised_at timestamptz,
  primary key (app_id, tenant_id, environment, key_kind, key_version),
  foreign key (app_id, tenant_id, environment, key_kind, predecessor_key_version)
    references app_data_agent.research_result_key_versions (
      app_id, tenant_id, environment, key_kind, key_version
    )
    match simple on delete no action not deferrable,
  check (predecessor_key_version is null or predecessor_key_version <> key_version),
  check (
    (state = 'STAGED' and activated_at is null and retired_at is null and compromised_at is null)
    or (state = 'ACTIVE' and activated_at is not null and retired_at is null and compromised_at is null)
    or (state = 'RETIRED' and activated_at is not null and retired_at is not null and compromised_at is null)
    or (state = 'COMPROMISED' and compromised_at is not null)
  )
);

create unique index research_result_key_versions_one_active
on app_data_agent.research_result_key_versions (app_id, tenant_id, environment, key_kind)
where state = 'ACTIVE';

create unique index research_result_key_versions_one_staged
on app_data_agent.research_result_key_versions (app_id, tenant_id, environment, key_kind)
where state = 'STAGED';

create table app_data_agent.research_result_key_transition_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  operation_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  key_kind text not null check (key_kind in ('ENCRYPTION', 'COMMITMENT')),
  key_version text not null,
  transition text not null check (transition in ('STAGE', 'ACTIVATE', 'RETIRE', 'COMPROMISE')),
  result_state text not null check (result_state in ('STAGED', 'ACTIVE', 'RETIRED', 'COMPROMISED')),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, operation_id),
  unique (app_id, tenant_id, environment, principal_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, key_kind, key_version)
    references app_data_agent.research_result_key_versions (
      app_id, tenant_id, environment, key_kind, key_version
    )
    on delete restrict not deferrable
);
create table app_data_agent.research_artifact_commit_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  commit_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  artifact_authority_domain text not null check (
    artifact_authority_domain in (
      'BRIEF_SEMANTIC', 'PLANNING', 'OBLIGATION_EXECUTION', 'EVIDENCE',
      'CLAIM_STRUCTURE', 'RELATION', 'PROOF', 'COVERAGE', 'RESEARCH_STOP',
      'PROJECTION', 'EVIDENCE_GATE', 'READINESS'
    )
  ),
  artifact_id uuid not null,
  artifact_type text not null,
  revision integer not null check (revision >= 1),
  content_hash text not null check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  parent_ref jsonb,
  candidate_json jsonb not null check (pg_catalog.jsonb_typeof(candidate_json) = 'object'),
  outcome text not null default 'COMMITTED' check (outcome = 'COMMITTED'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, commit_id),
  unique (app_id, tenant_id, environment, run_id, principal_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id)
    on delete restrict not deferrable,
  foreign key (app_id, tenant_id, environment, principal_id)
    references app_data_agent.memberships (app_id, tenant_id, environment, principal_id)
    on delete restrict not deferrable,
  foreign key (
    app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash
  )
    references app_data_agent.artifacts (
      app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_current_evidence_relation_keys (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  claim_ref_identity text not null check (pg_catalog.length(claim_ref_identity) between 1 and 4096),
  evidence_ref_identity text not null
    check (pg_catalog.length(evidence_ref_identity) between 1 and 4096),
  pair_identity_hash text not null check (pair_identity_hash ~ '^sha256:[0-9a-f]{64}$'),
  artifact_id uuid not null,
  artifact_type text not null default 'EvidenceRelation'
    check (artifact_type = 'EvidenceRelation'),
  revision integer not null check (revision >= 1),
  content_hash text not null check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (
    app_id, tenant_id, environment, run_id, claim_ref_identity, evidence_ref_identity
  ),
  unique (app_id, tenant_id, environment, run_id, pair_identity_hash),
  unique (app_id, tenant_id, environment, run_id, artifact_id),
  foreign key (
    app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash
  )
    references app_data_agent.artifacts (
      app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash
    )
    on delete restrict not deferrable
);
create table app_data_agent.research_version_frontiers (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  frontier_kind text not null
    check (frontier_kind in ('SEMANTIC', 'SCHEMA', 'DATA', 'POLICY', 'IDENTITY')),
  frontier_value_json jsonb not null
    check (pg_catalog.jsonb_typeof(frontier_value_json) = 'object'),
  frontier_value_hash text not null check (frontier_value_hash ~ '^sha256:[0-9a-f]{64}$'),
  frontier_version bigint not null check (frontier_version between 0 and 9007199254740991),
  authority_epoch bigint not null check (authority_epoch between 0 and 9007199254740991),
  event_seq bigint not null check (event_seq between 1 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, frontier_kind),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id)
    on delete restrict not deferrable
);

create table app_data_agent.research_frontier_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  operation_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  frontier_kind text not null
    check (frontier_kind in ('SEMANTIC', 'SCHEMA', 'DATA', 'POLICY', 'IDENTITY')),
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  expected_frontier_version bigint
    check (expected_frontier_version is null or expected_frontier_version between 0 and 9007199254740991),
  expected_frontier_hash text
    check (expected_frontier_hash is null or expected_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  requested_frontier_hash text not null check (requested_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  outcome text not null check (outcome in ('COMMITTED', 'REJECTED')),
  committed_frontier_version bigint
    check (committed_frontier_version is null or committed_frontier_version between 0 and 9007199254740991),
  committed_frontier_hash text
    check (committed_frontier_hash is null or committed_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  event_seq bigint check (event_seq is null or event_seq between 1 and 9007199254740991),
  cascaded_revocation_operation_id uuid,
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,126}$'),
  completed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, operation_id),
  unique (
    app_id, tenant_id, environment, run_id, principal_id, frontier_kind, idempotency_key
  ),
  check (
    (
      outcome = 'COMMITTED'
      and committed_frontier_version is not null
      and committed_frontier_hash is not null
      and event_seq is not null
      and error_code is null
    )
    or (
      outcome = 'REJECTED'
      and committed_frontier_version is null
      and committed_frontier_hash is null
      and event_seq is null
      and cascaded_revocation_operation_id is null
      and error_code is not null
    )
  )
);

create table app_data_agent.research_frontier_events (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  event_seq bigint not null check (event_seq between 1 and 9007199254740991),
  operation_id uuid not null,
  frontier_kind text not null
    check (frontier_kind in ('SEMANTIC', 'SCHEMA', 'DATA', 'POLICY', 'IDENTITY')),
  event_kind text not null check (event_kind in ('INITIALIZED', 'ADVANCED')),
  owner_principal_id uuid not null,
  old_frontier_version bigint
    check (old_frontier_version is null or old_frontier_version between 0 and 9007199254740991),
  old_frontier_hash text
    check (old_frontier_hash is null or old_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  new_frontier_version bigint not null check (new_frontier_version between 0 and 9007199254740991),
  new_frontier_hash text not null check (new_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, event_seq),
  unique (app_id, tenant_id, environment, operation_id),
  foreign key (app_id, tenant_id, environment, operation_id)
    references app_data_agent.research_frontier_operations (
      app_id, tenant_id, environment, operation_id
    )
    on delete restrict not deferrable,
  check (
    (event_kind = 'INITIALIZED' and old_frontier_version is null and old_frontier_hash is null)
    or (event_kind = 'ADVANCED' and old_frontier_version is not null and old_frontier_hash is not null)
  )
);

create table app_data_agent.current_report_readiness (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  state text not null check (state in ('CURRENT', 'REVOKED')),
  certificate_ref jsonb not null check (pg_catalog.jsonb_typeof(certificate_ref) = 'object'),
  certificate_identity text not null check (pg_catalog.length(certificate_identity) between 1 and 4096),
  certificate_semantic_hash text not null
    check (certificate_semantic_hash ~ '^sha256:[0-9a-f]{64}$'),
  report_ref jsonb not null check (pg_catalog.jsonb_typeof(report_ref) = 'object'),
  report_identity text not null check (pg_catalog.length(report_identity) between 1 and 4096),
  semantic_frontier_version bigint not null check (semantic_frontier_version >= 0),
  semantic_frontier_hash text not null check (semantic_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  schema_frontier_version bigint not null check (schema_frontier_version >= 0),
  schema_frontier_hash text not null check (schema_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  data_frontier_version bigint not null check (data_frontier_version >= 0),
  data_frontier_hash text not null check (data_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  policy_frontier_version bigint not null check (policy_frontier_version >= 0),
  policy_frontier_hash text not null check (policy_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  identity_frontier_version bigint not null check (identity_frontier_version >= 0),
  identity_frontier_hash text not null check (identity_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  frontier_hash text not null check (frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  authority_epoch bigint not null check (authority_epoch between 0 and 9007199254740991),
  readiness_version bigint not null check (readiness_version between 0 and 9007199254740991),
  revocation_seq bigint not null default 0 check (revocation_seq between 0 and 9007199254740991),
  revocation_receipt_ref jsonb,
  published_at timestamptz not null,
  revoked_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id)
    on delete restrict not deferrable,
  check (
    (state = 'CURRENT' and revocation_receipt_ref is null and revoked_at is null)
    or (
      state = 'REVOKED'
      and pg_catalog.jsonb_typeof(revocation_receipt_ref) = 'object'
      and revoked_at is not null
      and revocation_seq >= 1
    )
  )
);

create table app_data_agent.research_readiness_publications (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  publication_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  certificate_ref jsonb not null check (pg_catalog.jsonb_typeof(certificate_ref) = 'object'),
  report_ref jsonb not null check (pg_catalog.jsonb_typeof(report_ref) = 'object'),
  expected_readiness_version bigint
    check (expected_readiness_version is null or expected_readiness_version >= 0),
  committed_readiness_version bigint not null check (committed_readiness_version >= 0),
  frontier_hash text not null check (frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  outcome text not null default 'CURRENT_PUBLISHED' check (outcome = 'CURRENT_PUBLISHED'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, publication_id),
  unique (app_id, tenant_id, environment, run_id, principal_id, idempotency_key)
);

create table app_data_agent.research_domain_terminals (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  terminal_id uuid not null,
  terminal text not null
    check (terminal in ('READY', 'STALE', 'PARTIAL', 'NEEDS_MORE_RESEARCH', 'INCONCLUSIVE')),
  authority_kind text not null
    check (authority_kind in ('CURRENT_READINESS', 'REVOCATION_CONSUMPTION', 'RESEARCH_STOP')),
  reason_code text not null check (reason_code ~ '^[A-Z][A-Z0-9_]{1,126}$'),
  domain_reason_codes jsonb not null
    check (pg_catalog.jsonb_typeof(domain_reason_codes) = 'array'),
  certificate_ref jsonb,
  revocation_receipt_ref jsonb,
  stop_decision_ref jsonb,
  coverage_ref jsonb,
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id),
  unique (app_id, tenant_id, environment, terminal_id),
  check (
    (terminal = 'READY' and authority_kind = 'CURRENT_READINESS'
      and certificate_ref is not null and revocation_receipt_ref is null and stop_decision_ref is null)
    or (terminal = 'STALE' and authority_kind = 'REVOCATION_CONSUMPTION'
      and certificate_ref is null and revocation_receipt_ref is not null and stop_decision_ref is null)
    or (terminal in ('PARTIAL', 'NEEDS_MORE_RESEARCH', 'INCONCLUSIVE')
      and authority_kind = 'RESEARCH_STOP'
      and certificate_ref is null and revocation_receipt_ref is null
      and stop_decision_ref is not null and coverage_ref is not null)
  )
);

create table app_data_agent.research_readiness_consumptions (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  consumption_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  purpose text not null check (purpose in ('DOMAIN_TERMINAL', 'REPORT_READ')),
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  certificate_ref jsonb not null check (pg_catalog.jsonb_typeof(certificate_ref) = 'object'),
  report_ref jsonb not null check (pg_catalog.jsonb_typeof(report_ref) = 'object'),
  readiness_version bigint not null check (readiness_version >= 0),
  revocation_seq bigint not null check (revocation_seq >= 0),
  frontier_hash text not null check (frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  authority_epoch bigint not null check (authority_epoch >= 0),
  outcome text not null
    check (outcome in ('READY_COMMITTED', 'STALE_COMMITTED', 'GRANT_ISSUED')),
  terminal_id uuid,
  grant_id uuid,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, consumption_id),
  unique (app_id, tenant_id, environment, run_id, principal_id, purpose, idempotency_key),
  check (
    (purpose = 'DOMAIN_TERMINAL' and outcome in ('READY_COMMITTED', 'STALE_COMMITTED')
      and terminal_id is not null and grant_id is null)
    or (purpose = 'REPORT_READ' and outcome = 'GRANT_ISSUED'
      and terminal_id is null and grant_id is not null)
  )
);

create table app_data_agent.research_stop_terminal_commits (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  commit_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  stop_decision_ref jsonb not null check (pg_catalog.jsonb_typeof(stop_decision_ref) = 'object'),
  coverage_ref jsonb not null check (pg_catalog.jsonb_typeof(coverage_ref) = 'object'),
  terminal_id uuid not null,
  outcome text not null default 'COMMITTED' check (outcome = 'COMMITTED'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, commit_id),
  unique (app_id, tenant_id, environment, run_id, principal_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, terminal_id)
    references app_data_agent.research_domain_terminals (
      app_id, tenant_id, environment, terminal_id
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_revocation_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  operation_id uuid not null,
  run_id uuid not null,
  owner_principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  trigger_kind text not null check (trigger_kind in ('SERVICE_REQUEST', 'FRONTIER_ADVANCE')),
  source_operation_id uuid not null,
  reason text not null check (
    reason in (
      'EVIDENCE_REVOKED', 'CERTIFICATE_TAMPERED',
      'SEMANTIC_REVISION_CHANGED', 'SCHEMA_REVISION_CHANGED',
      'DATA_SNAPSHOT_STALE', 'POLICY_CHANGED', 'IDENTITY_AUTHORITY_CHANGED'
    )
  ),
  certificate_ref jsonb not null check (pg_catalog.jsonb_typeof(certificate_ref) = 'object'),
  observed_frontier_hash text not null check (observed_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  authority_epoch bigint not null check (authority_epoch >= 0),
  state text not null check (state in ('REQUESTED', 'COMMITTED', 'FAILED')),
  receipt_ref jsonb,
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,126}$'),
  completed_at timestamptz,
  primary key (app_id, tenant_id, environment, operation_id),
  unique (app_id, tenant_id, environment, run_id, owner_principal_id, idempotency_key),
  check (
    (trigger_kind = 'SERVICE_REQUEST' and reason in ('EVIDENCE_REVOKED', 'CERTIFICATE_TAMPERED'))
    or (trigger_kind = 'FRONTIER_ADVANCE'
      and reason not in ('EVIDENCE_REVOKED', 'CERTIFICATE_TAMPERED'))
  ),
  check (
    (state = 'REQUESTED' and receipt_ref is null and error_code is null and completed_at is null)
    or (state = 'COMMITTED' and receipt_ref is not null and error_code is null and completed_at is not null)
    or (state = 'FAILED' and receipt_ref is null and error_code is not null and completed_at is not null)
  )
);

create table app_data_agent.report_read_grants (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  grant_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  issue_input_hash text not null check (issue_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  certificate_ref jsonb not null check (pg_catalog.jsonb_typeof(certificate_ref) = 'object'),
  report_ref jsonb not null check (pg_catalog.jsonb_typeof(report_ref) = 'object'),
  response_wire jsonb not null check (pg_catalog.jsonb_typeof(response_wire) = 'object'),
  response_wire_hash text not null check (response_wire_hash ~ '^sha256:[0-9a-f]{64}$'),
  issue_readiness_version bigint not null check (issue_readiness_version >= 0),
  issue_revocation_seq bigint not null check (issue_revocation_seq >= 0),
  issue_frontier_hash text not null check (issue_frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  authority_epoch bigint not null check (authority_epoch >= 0),
  state text not null check (state in ('ISSUED', 'CONSUMED', 'RESPONDED', 'EXPIRED', 'REVOKED')),
  expires_at timestamptz not null,
  consume_idempotency_key text,
  consume_input_hash text
    check (consume_input_hash is null or consume_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  consumed_at timestamptz,
  response_idempotency_key text,
  response_input_hash text
    check (response_input_hash is null or response_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  responded_at timestamptz,
  terminal_from_status text check (terminal_from_status is null or terminal_from_status in ('ISSUED', 'CONSUMED')),
  expired_at timestamptz,
  revoked_at timestamptz,
  issued_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, grant_id),
  unique (app_id, tenant_id, environment, run_id, principal_id, idempotency_key),
  check (
    (state = 'ISSUED' and consume_idempotency_key is null and consume_input_hash is null
      and consumed_at is null and response_idempotency_key is null and response_input_hash is null
      and responded_at is null and terminal_from_status is null and expired_at is null and revoked_at is null)
    or (state = 'CONSUMED' and consume_idempotency_key is not null and consume_input_hash is not null
      and consumed_at is not null and response_idempotency_key is null and response_input_hash is null
      and responded_at is null and terminal_from_status is null and expired_at is null and revoked_at is null)
    or (state = 'RESPONDED' and consume_idempotency_key is not null and consume_input_hash is not null
      and consumed_at is not null and response_idempotency_key is not null and response_input_hash is not null
      and responded_at is not null and terminal_from_status is null and expired_at is null and revoked_at is null)
    or (state = 'EXPIRED' and terminal_from_status is not null and expired_at is not null
      and responded_at is null and revoked_at is null)
    or (state = 'REVOKED' and terminal_from_status is not null and revoked_at is not null
      and responded_at is null and expired_at is null)
  )
);

create table app_data_agent.report_read_grant_expiration_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  operation_id uuid not null,
  grant_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  expected_state text not null check (expected_state in ('ISSUED', 'CONSUMED')),
  source_state text not null check (source_state in ('ISSUED', 'CONSUMED')),
  outcome text not null default 'EXPIRED' check (outcome = 'EXPIRED'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, operation_id),
  unique (app_id, tenant_id, environment, grant_id, principal_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, grant_id)
    references app_data_agent.report_read_grants (app_id, tenant_id, environment, grant_id)
    on delete restrict not deferrable
);

create table app_data_agent.research_release_decision_commits (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  decision_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  candidate_input_hash text not null check (candidate_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  decision_hash text not null check (decision_hash ~ '^sha256:[0-9a-f]{64}$'),
  decision text not null default 'GO' check (decision = 'GO'),
  certificate_ref jsonb not null check (pg_catalog.jsonb_typeof(certificate_ref) = 'object'),
  readiness_version bigint not null check (readiness_version >= 0),
  revocation_seq bigint not null check (revocation_seq >= 0),
  frontier_hash text not null check (frontier_hash ~ '^sha256:[0-9a-f]{64}$'),
  authority_epoch bigint not null check (authority_epoch >= 0),
  evidence_refs jsonb not null check (pg_catalog.jsonb_typeof(evidence_refs) = 'object'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, decision_id),
  unique (app_id, tenant_id, environment, run_id, principal_id, idempotency_key)
);
create table app_data_agent.research_resource_run_heads (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  next_reservation_seq bigint not null default 1
    check (next_reservation_seq between 1 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id),
  foreign key (app_id, tenant_id, environment, run_id)
    references app_data_agent.runs (app_id, tenant_id, environment, run_id)
    on delete restrict not deferrable
);

create table app_data_agent.research_resource_reservations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  reservation_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  reservation_seq bigint not null check (reservation_seq between 1 and 9007199254740991),
  reserve_idempotency_key text not null
    check (pg_catalog.length(reserve_idempotency_key) between 1 and 256),
  reserve_input_hash text not null check (reserve_input_hash ~ '^sha256:[0-9a-f]{64}$'),
  research_brief_ref jsonb not null check (pg_catalog.jsonb_typeof(research_brief_ref) = 'object'),
  resource_kind text not null check (resource_kind in ('MODEL', 'SQL', 'TOOL')),
  requested_json jsonb not null check (pg_catalog.jsonb_typeof(requested_json) = 'object'),
  reserved_json jsonb not null check (pg_catalog.jsonb_typeof(reserved_json) = 'object'),
  state text not null check (
    state in (
      'RESERVED', 'IN_USE', 'SETTLED', 'SETTLED_OVER_LIMIT',
      'CANCELLED', 'EXPIRED', 'ABANDONED'
    )
  ),
  reservation_expires_at timestamptz not null,
  invocation_id uuid,
  request_id uuid,
  resource_lease_id uuid,
  canonical_request_digest text
    check (canonical_request_digest is null or canonical_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  attempt_id uuid,
  worker_fence bigint check (worker_fence is null or worker_fence between 1 and 9007199254740991),
  lease_expires_at timestamptz,
  actual_json jsonb,
  invocation_outcome_usage_ref jsonb,
  adapter_termination_receipt_ref jsonb,
  outcome_unknown_hash text
    check (outcome_unknown_hash is null or outcome_unknown_hash ~ '^sha256:[0-9a-f]{64}$'),
  end_reason_code text,
  reserved_at timestamptz not null default pg_catalog.clock_timestamp(),
  begun_at timestamptz,
  ended_at timestamptz,
  primary key (app_id, tenant_id, environment, reservation_id),
  unique (app_id, tenant_id, environment, run_id, reservation_seq),
  unique (
    app_id, tenant_id, environment, run_id, principal_id, reserve_idempotency_key
  ),
  foreign key (app_id, tenant_id, environment, run_id, principal_id)
    references app_data_agent.runs (
      app_id, tenant_id, environment, run_id, principal_id
    )
    on delete restrict not deferrable,
  foreign key (app_id, tenant_id, environment, principal_id)
    references app_data_agent.memberships (
      app_id, tenant_id, environment, principal_id
    )
    on delete restrict not deferrable,
  check (
    (state = 'RESERVED' and invocation_id is null and resource_lease_id is null
      and actual_json is null and begun_at is null and ended_at is null)
    or (state in ('IN_USE', 'ABANDONED') and invocation_id is not null
      and request_id is not null and resource_lease_id is not null
      and canonical_request_digest is not null and attempt_id is not null
      and worker_fence is not null and begun_at is not null)
    or (state in ('SETTLED', 'SETTLED_OVER_LIMIT') and invocation_id is not null
      and resource_lease_id is not null and actual_json is not null
      and invocation_outcome_usage_ref is not null and ended_at is not null)
    or (state in ('CANCELLED', 'EXPIRED') and ended_at is not null)
  )
);

create table app_data_agent.research_resource_transition_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  transition_id uuid not null,
  reservation_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  transition text not null
    check (transition in ('BEGIN', 'SETTLE', 'CANCEL', 'EXPIRE', 'ABANDONED')),
  source_state text not null,
  result_state text not null,
  result_json jsonb not null check (pg_catalog.jsonb_typeof(result_json) = 'object'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, transition_id),
  unique (app_id, tenant_id, environment, reservation_id, principal_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, reservation_id)
    references app_data_agent.research_resource_reservations (
      app_id, tenant_id, environment, reservation_id
    )
    on delete restrict not deferrable
);
create table app_data_agent.research_invocation_request_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  invocation_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  reservation_id uuid not null,
  request_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  resource_kind text not null check (resource_kind in ('MODEL', 'SQL', 'TOOL')),
  canonical_request_digest text not null check (canonical_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_json jsonb not null check (pg_catalog.jsonb_typeof(request_json) = 'object'),
  outcome text not null check (outcome in ('STARTED', 'REJECTED')),
  error_code text check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{1,126}$'),
  completed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, invocation_id),
  unique (app_id, tenant_id, environment, run_id, principal_id, idempotency_key),
  unique (app_id, tenant_id, environment, request_id),
  foreign key (app_id, tenant_id, environment, reservation_id)
    references app_data_agent.research_resource_reservations (
      app_id, tenant_id, environment, reservation_id
    )
    on delete restrict not deferrable,
  check (
    (outcome = 'STARTED' and error_code is null)
    or (outcome = 'REJECTED' and error_code is not null)
  )
);

create table app_data_agent.research_invocation_commits (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  invocation_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  reservation_id uuid not null,
  reservation_seq bigint not null check (reservation_seq >= 1),
  resource_lease_id uuid not null,
  request_id uuid not null,
  attempt_id uuid not null,
  outbox_id uuid not null,
  worker_fence bigint not null check (worker_fence between 1 and 9007199254740991),
  resource_kind text not null check (resource_kind in ('MODEL', 'SQL', 'TOOL')),
  canonical_request_digest text not null check (canonical_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  authority_epoch bigint not null check (authority_epoch >= 0),
  state text not null check (
    state in ('AUTHORIZED', 'STARTED', 'OUTCOME_UNKNOWN', 'COMPLETED', 'FAILED')
  ),
  started_at timestamptz,
  outcome_unknown_hash text
    check (outcome_unknown_hash is null or outcome_unknown_hash ~ '^sha256:[0-9a-f]{64}$'),
  result_ref jsonb,
  secure_execution_receipt_ref jsonb,
  outcome_usage_ref jsonb,
  error_code text,
  terminal_hash text check (terminal_hash is null or terminal_hash ~ '^sha256:[0-9a-f]{64}$'),
  terminal_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, invocation_id),
  unique (
    app_id, tenant_id, environment, run_id, reservation_id, reservation_seq,
    resource_lease_id, invocation_id, request_id
  ),
  foreign key (app_id, tenant_id, environment, reservation_id)
    references app_data_agent.research_resource_reservations (
      app_id, tenant_id, environment, reservation_id
    )
    on delete restrict not deferrable,
  foreign key (
    app_id, tenant_id, environment, attempt_id, outbox_id, run_id, worker_fence
  )
    references app_data_agent.run_attempts (
      app_id, tenant_id, environment, attempt_id, outbox_id, run_id, worker_fence
    )
    on delete restrict not deferrable,
  check (
    (state = 'AUTHORIZED' and started_at is null and terminal_at is null)
    or (state = 'STARTED' and started_at is not null and terminal_at is null)
    or (state = 'OUTCOME_UNKNOWN' and started_at is not null
      and outcome_unknown_hash is not null and terminal_at is null)
    or (state = 'COMPLETED' and started_at is not null
      and result_ref is not null and outcome_usage_ref is not null
      and error_code is null and terminal_hash is not null and terminal_at is not null)
    or (state = 'FAILED' and error_code is not null and terminal_hash is not null
      and terminal_at is not null)
  )
);

create table app_data_agent.research_invocation_transition_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  transition_id uuid not null,
  invocation_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  transition text not null check (
    transition in (
      'START', 'MARK_OUTCOME_UNKNOWN', 'ABORT_PREPARATION',
      'PREPARE_TERMINAL', 'COMMIT_TERMINAL'
    )
  ),
  source_state text not null,
  result_state text not null,
  result_json jsonb not null check (pg_catalog.jsonb_typeof(result_json) = 'object'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, transition_id),
  unique (app_id, tenant_id, environment, invocation_id, transition_id),
  unique (app_id, tenant_id, environment, invocation_id, principal_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, invocation_id)
    references app_data_agent.research_invocation_commits (
      app_id, tenant_id, environment, invocation_id
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_invocation_terminal_preparations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  preparation_id uuid not null,
  invocation_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  resource_kind text not null check (resource_kind in ('MODEL', 'SQL', 'TOOL')),
  state text not null check (state in ('PREPARING', 'PREPARED', 'COMMITTED', 'ABORTED', 'EXPIRED')),
  stage text not null check (
    stage in ('CLAIMED', 'ENCRYPTED', 'RECORDS_WRITTEN', 'COMMITTED', 'ABORTED')
  ),
  claim_token_hash text not null check (claim_token_hash ~ '^sha256:[0-9a-f]{64}$'),
  transition_id uuid not null,
  terminal_input_commitment_json jsonb not null
    check (pg_catalog.jsonb_typeof(terminal_input_commitment_json) = 'object'),
  retention_policy_id uuid not null,
  retention_policy_version text not null,
  retention_policy_hash text not null check (retention_policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  deletion_due_at timestamptz not null,
  expires_at timestamptz not null,
  result_ref jsonb,
  secure_execution_receipt_ref jsonb,
  outcome_usage_ref jsonb,
  committed_at timestamptz,
  primary key (app_id, tenant_id, environment, preparation_id),
  unique (app_id, tenant_id, environment, invocation_id, principal_id, idempotency_key),
  unique (app_id, tenant_id, environment, invocation_id, transition_id),
  foreign key (app_id, tenant_id, environment, invocation_id)
    references app_data_agent.research_invocation_commits (
      app_id, tenant_id, environment, invocation_id
    )
    on delete restrict not deferrable,
  foreign key (app_id, tenant_id, environment, retention_policy_id, retention_policy_version, retention_policy_hash)
    references app_data_agent.research_result_retention_policies (
      app_id, tenant_id, environment, policy_id, policy_version, policy_hash
    )
    on delete restrict not deferrable,
  check (
    (state = 'COMMITTED' and stage = 'COMMITTED' and result_ref is not null
      and outcome_usage_ref is not null and committed_at is not null)
    or (state <> 'COMMITTED' and committed_at is null)
  )
);

create table app_data_agent.research_system_artifacts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  artifact_id uuid not null,
  artifact_type text not null default 'AgentDataProjectionReceipt'
    check (artifact_type = 'AgentDataProjectionReceipt'),
  revision integer not null default 1 check (revision = 1),
  content_hash text not null check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  reservation_id uuid not null,
  invocation_id uuid not null,
  request_profile_hash text not null check (request_profile_hash ~ '^sha256:[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  field_count bigint not null check (field_count between 0 and 9007199254740991),
  byte_count bigint not null check (byte_count between 0 and 9007199254740991),
  token_count bigint not null check (token_count between 0 and 9007199254740991),
  hmac_hash text not null check (hmac_hash ~ '^hmac-sha256:[0-9a-f]{64}$'),
  policy_ref jsonb not null check (pg_catalog.jsonb_typeof(policy_ref) = 'object'),
  payload_json jsonb not null check (pg_catalog.jsonb_typeof(payload_json) = 'object'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, run_id, artifact_id, revision),
  unique (
    app_id, tenant_id, environment, run_id, artifact_id, artifact_type, revision, content_hash
  ),
  unique (app_id, tenant_id, environment, run_id, principal_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, reservation_id)
    references app_data_agent.research_resource_reservations (
      app_id, tenant_id, environment, reservation_id
    )
    on delete restrict not deferrable,
  foreign key (app_id, tenant_id, environment, invocation_id)
    references app_data_agent.research_invocation_commits (
      app_id, tenant_id, environment, invocation_id
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_system_record_identities (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  record_kind text not null check (
    record_kind in (
      'ADAPTER_TERMINATION_RECEIPT', 'INVOCATION_OUTCOME_USAGE',
      'TOOL_INVOCATION_PERMIT', 'MODEL_INVOCATION_RESULT',
      'SQL_INVOCATION_RESULT', 'TOOL_INVOCATION_RESULT',
      'SECURE_SQL_EXECUTION_RECEIPT'
    )
  ),
  record_id uuid not null,
  record_version integer not null default 1 check (record_version = 1),
  run_id uuid not null,
  principal_id uuid not null,
  content_hash text not null check (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  commit_id uuid not null,
  authority_epoch bigint not null check (authority_epoch >= 0),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (
    app_id, tenant_id, environment, record_kind, record_id, record_version
  ),
  unique (
    app_id, tenant_id, environment, run_id, record_kind, record_id,
    record_version, content_hash, commit_id
  ),
  foreign key (app_id, tenant_id, environment, run_id, principal_id)
    references app_data_agent.runs (
      app_id, tenant_id, environment, run_id, principal_id
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_adapter_termination_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  record_id uuid not null,
  record_version integer not null default 1 check (record_version = 1),
  record_kind text not null default 'ADAPTER_TERMINATION_RECEIPT'
    check (record_kind = 'ADAPTER_TERMINATION_RECEIPT'),
  run_id uuid not null,
  principal_id uuid not null,
  invocation_id uuid not null,
  reservation_id uuid not null,
  resource_lease_id uuid not null,
  resource_kind text not null check (resource_kind in ('MODEL', 'SQL', 'TOOL')),
  canonical_request_digest text not null check (canonical_request_digest ~ '^sha256:[0-9a-f]{64}$'),
  termination_digest text not null check (termination_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload_json jsonb not null check (pg_catalog.jsonb_typeof(payload_json) = 'object'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, record_id),
  unique (app_id, tenant_id, environment, invocation_id, termination_digest),
  foreign key (app_id, tenant_id, environment, record_kind, record_id, record_version)
    references app_data_agent.research_system_record_identities (
      app_id, tenant_id, environment, record_kind, record_id, record_version
    )
    on delete restrict not deferrable,
  foreign key (app_id, tenant_id, environment, invocation_id)
    references app_data_agent.research_invocation_commits (
      app_id, tenant_id, environment, invocation_id
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_invocation_outcome_usage (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  record_id uuid not null,
  record_version integer not null default 1 check (record_version = 1),
  record_kind text not null default 'INVOCATION_OUTCOME_USAGE'
    check (record_kind = 'INVOCATION_OUTCOME_USAGE'),
  run_id uuid not null,
  principal_id uuid not null,
  invocation_id uuid not null,
  reservation_id uuid not null,
  resource_lease_id uuid not null,
  resource_kind text not null check (resource_kind in ('MODEL', 'SQL', 'TOOL')),
  outcome text not null check (outcome in ('COMPLETED', 'FAILED')),
  actual_json jsonb not null check (pg_catalog.jsonb_typeof(actual_json) = 'object'),
  completion_binding jsonb,
  error_code text,
  outcome_hash text not null check (outcome_hash ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz not null,
  primary key (app_id, tenant_id, environment, record_id),
  unique (app_id, tenant_id, environment, invocation_id, outcome_hash),
  foreign key (app_id, tenant_id, environment, record_kind, record_id, record_version)
    references app_data_agent.research_system_record_identities (
      app_id, tenant_id, environment, record_kind, record_id, record_version
    )
    on delete restrict not deferrable,
  check (
    (outcome = 'COMPLETED' and completion_binding is not null and error_code is null)
    or (outcome = 'FAILED' and completion_binding is null and error_code is not null)
  )
);

create table app_data_agent.research_tool_invocation_permits (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  record_id uuid not null,
  record_version integer not null default 1 check (record_version = 1),
  record_kind text not null default 'TOOL_INVOCATION_PERMIT'
    check (record_kind = 'TOOL_INVOCATION_PERMIT'),
  run_id uuid not null,
  principal_id uuid not null,
  tool_name text not null check (pg_catalog.length(tool_name) between 1 and 2000),
  tool_version text not null check (pg_catalog.length(tool_version) between 1 and 128),
  arguments_schema_hash text not null check (arguments_schema_hash ~ '^sha256:[0-9a-f]{64}$'),
  arguments_hash text not null check (arguments_hash ~ '^sha256:[0-9a-f]{64}$'),
  policy_receipt_ref jsonb not null check (pg_catalog.jsonb_typeof(policy_receipt_ref) = 'object'),
  tool_policy_version text not null,
  tool_permit_policy_limit_hash text not null
    check (tool_permit_policy_limit_hash ~ '^sha256:[0-9a-f]{64}$'),
  authority_epoch bigint not null check (authority_epoch >= 0),
  status text not null check (status in ('ACTIVE', 'REVOKED', 'EXPIRED')),
  revocation_seq bigint not null default 0 check (revocation_seq >= 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  expired_at timestamptz,
  primary key (app_id, tenant_id, environment, record_id),
  foreign key (app_id, tenant_id, environment, record_kind, record_id, record_version)
    references app_data_agent.research_system_record_identities (
      app_id, tenant_id, environment, record_kind, record_id, record_version
    )
    on delete restrict not deferrable,
  foreign key (
    app_id, tenant_id, environment, tool_policy_version, tool_permit_policy_limit_hash
  )
    references app_data_agent.research_tool_permit_policy_limits (
      app_id, tenant_id, environment, policy_version, policy_limit_hash
    )
    on delete restrict not deferrable,
  check (
    (status = 'ACTIVE' and revoked_at is null and expired_at is null)
    or (status = 'REVOKED' and revoked_at is not null and expired_at is null)
    or (status = 'EXPIRED' and revoked_at is null and expired_at is not null)
  )
);

create table app_data_agent.research_invocation_results (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  record_id uuid not null,
  record_version integer not null default 1 check (record_version = 1),
  record_kind text not null check (
    record_kind in ('MODEL_INVOCATION_RESULT', 'SQL_INVOCATION_RESULT', 'TOOL_INVOCATION_RESULT')
  ),
  run_id uuid not null,
  principal_id uuid not null,
  invocation_id uuid not null,
  reservation_id uuid not null,
  preparation_id uuid not null,
  resource_kind text not null check (resource_kind in ('MODEL', 'SQL', 'TOOL')),
  state text not null check (state in ('AVAILABLE', 'TOMBSTONED')),
  metadata_json jsonb,
  aad_json jsonb,
  aad_hash text not null check (aad_hash ~ '^sha256:[0-9a-f]{64}$'),
  blob_id uuid,
  digest text not null check (digest ~ '^sha256:[0-9a-f]{64}$'),
  byte_length bigint not null check (byte_length between 0 and 8388608),
  retention_policy_id uuid not null,
  retention_policy_version text not null,
  retention_policy_hash text not null check (retention_policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  deletion_due_at timestamptz not null,
  tombstoned_at timestamptz,
  primary key (app_id, tenant_id, environment, record_id),
  unique (app_id, tenant_id, environment, invocation_id, record_kind),
  unique (app_id, tenant_id, environment, record_id, blob_id),
  foreign key (app_id, tenant_id, environment, record_kind, record_id, record_version)
    references app_data_agent.research_system_record_identities (
      app_id, tenant_id, environment, record_kind, record_id, record_version
    )
    on delete restrict not deferrable,
  foreign key (app_id, tenant_id, environment, preparation_id)
    references app_data_agent.research_invocation_terminal_preparations (
      app_id, tenant_id, environment, preparation_id
    )
    on delete restrict not deferrable,
  check (
    (state = 'AVAILABLE' and metadata_json is not null and aad_json is not null
      and blob_id is not null and tombstoned_at is null)
    or (state = 'TOMBSTONED' and metadata_json is null and aad_json is null
      and blob_id is null and tombstoned_at is not null)
  )
);

create table app_data_agent.research_secure_sql_execution_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  record_id uuid not null,
  record_version integer not null default 1 check (record_version = 1),
  record_kind text not null default 'SECURE_SQL_EXECUTION_RECEIPT'
    check (record_kind = 'SECURE_SQL_EXECUTION_RECEIPT'),
  run_id uuid not null,
  principal_id uuid not null,
  invocation_id uuid not null,
  result_record_id uuid not null,
  query_hash text not null check (query_hash ~ '^sha256:[0-9a-f]{64}$'),
  snapshot_hash text not null check (snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  row_count bigint not null check (row_count between 0 and 9007199254740991),
  column_count bigint not null check (column_count between 1 and 256),
  result_digest text not null check (result_digest ~ '^sha256:[0-9a-f]{64}$'),
  payload_json jsonb not null check (pg_catalog.jsonb_typeof(payload_json) = 'object'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, record_id),
  unique (app_id, tenant_id, environment, invocation_id),
  foreign key (app_id, tenant_id, environment, record_kind, record_id, record_version)
    references app_data_agent.research_system_record_identities (
      app_id, tenant_id, environment, record_kind, record_id, record_version
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_invocation_result_blobs (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  blob_id uuid not null,
  invocation_id uuid not null,
  result_record_kind text not null check (
    result_record_kind in ('MODEL_INVOCATION_RESULT', 'SQL_INVOCATION_RESULT', 'TOOL_INVOCATION_RESULT')
  ),
  result_record_id uuid not null,
  preparation_id uuid not null,
  encryption_key_kind text not null default 'ENCRYPTION' check (encryption_key_kind = 'ENCRYPTION'),
  encryption_key_version text not null,
  ciphertext_base64url text not null,
  nonce_base64url text not null,
  tag_base64url text not null,
  encrypted_byte_length bigint not null check (encrypted_byte_length between 1 and 8388608),
  ciphertext_hash text not null check (ciphertext_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, blob_id),
  unique (app_id, tenant_id, environment, invocation_id, result_record_id),
  unique (app_id, tenant_id, environment, result_record_kind, result_record_id, blob_id),
  foreign key (app_id, tenant_id, environment, encryption_key_kind, encryption_key_version)
    references app_data_agent.research_result_key_versions (
      app_id, tenant_id, environment, key_kind, key_version
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_system_record_transition_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  transition_id uuid not null,
  record_kind text not null,
  record_id uuid not null,
  record_version integer not null default 1 check (record_version = 1),
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  transition text not null check (
    transition in ('REVOKE', 'EXPIRE', 'TOMBSTONE', 'SUBJECT_ERASURE')
  ),
  reason_code text not null check (reason_code ~ '^[A-Z][A-Z0-9_]{1,126}$'),
  erasure_request_id uuid,
  result_json jsonb not null check (pg_catalog.jsonb_typeof(result_json) = 'object'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, transition_id),
  unique (
    app_id, tenant_id, environment, record_kind, record_id, principal_id, idempotency_key
  ),
  foreign key (app_id, tenant_id, environment, record_kind, record_id, record_version)
    references app_data_agent.research_system_record_identities (
      app_id, tenant_id, environment, record_kind, record_id, record_version
    )
    on delete restrict not deferrable,
  check (
    (transition = 'SUBJECT_ERASURE' and erasure_request_id is not null)
    or (transition <> 'SUBJECT_ERASURE' and erasure_request_id is null)
  )
);

create table app_data_agent.research_result_ciphertext_access_audits (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  audit_id uuid not null,
  run_id uuid not null,
  principal_id uuid not null,
  attempted_capability_id_hash text not null
    check (attempted_capability_id_hash ~ '^sha256:[0-9a-f]{64}$'),
  attempted_result_identity_hash text not null
    check (attempted_result_identity_hash ~ '^sha256:[0-9a-f]{64}$'),
  resolution_stage text not null check (
    resolution_stage in ('CAPABILITY_UNRESOLVED', 'CAPABILITY_RESOLVED', 'RESULT_RESOLVED')
  ),
  capability_id uuid,
  authority_epoch bigint,
  resolved_record_kind text,
  resolved_record_id uuid,
  resolved_record_version integer,
  blob_id uuid,
  resolved_encryption_key_kind text,
  resolved_encryption_key_version text,
  access_reason text not null check (
    access_reason in ('INVOCATION_RETURN', 'IDEMPOTENT_REPLAY', 'AUTHORIZED_ANALYSIS')
  ),
  outcome text not null check (outcome in ('ALLOWED', 'DENIED', 'RATE_LIMITED')),
  denial_code text,
  retention_policy_version text not null,
  retention_policy_hash text not null check (retention_policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  observed_at timestamptz not null default pg_catalog.clock_timestamp(),
  delete_after timestamptz not null,
  primary key (app_id, tenant_id, environment, audit_id),
  foreign key (app_id, tenant_id, environment, retention_policy_version, retention_policy_hash)
    references app_data_agent.research_result_access_audit_retention_policies (
      app_id, tenant_id, environment, policy_version, policy_hash
    )
    on delete restrict not deferrable,
  check (
    (resolution_stage = 'CAPABILITY_UNRESOLVED' and capability_id is null
      and authority_epoch is null and resolved_record_id is null and blob_id is null)
    or (resolution_stage = 'CAPABILITY_RESOLVED' and capability_id is not null
      and authority_epoch is not null and resolved_record_id is null and blob_id is null)
    or (resolution_stage = 'RESULT_RESOLVED' and capability_id is not null
      and authority_epoch is not null and resolved_record_kind is not null
      and resolved_record_id is not null and resolved_record_version = 1
      and blob_id is not null and resolved_encryption_key_kind = 'ENCRYPTION'
      and resolved_encryption_key_version is not null)
  ),
  check (
    (outcome = 'ALLOWED' and denial_code is null)
    or (outcome in ('DENIED', 'RATE_LIMITED') and denial_code is not null)
  )
);

create index research_result_ciphertext_access_audits_principal_time
on app_data_agent.research_result_ciphertext_access_audits (
  app_id, tenant_id, environment, principal_id, observed_at
);

create index research_result_ciphertext_access_audits_attempted_id_time
on app_data_agent.research_result_ciphertext_access_audits (
  app_id, tenant_id, environment, attempted_result_identity_hash, observed_at
);

create index research_result_ciphertext_access_audits_resolved_identity_time
on app_data_agent.research_result_ciphertext_access_audits (
  app_id, tenant_id, environment, resolved_record_kind, resolved_record_id, observed_at
)
where resolution_stage = 'RESULT_RESOLVED';
alter table app_data_agent.research_invocation_results
  add column secure_sql_receipt_id uuid,
  add constraint research_invocation_results_record_blob_uq
    unique (
      app_id, tenant_id, environment, record_kind, record_id, blob_id
    ),
  add constraint research_invocation_results_record_receipt_uq
    unique (
      app_id, tenant_id, environment, record_id, secure_sql_receipt_id
    ),
  add constraint research_invocation_results_blob_fk
    foreign key (
      app_id, tenant_id, environment, record_kind, record_id, blob_id
    )
    references app_data_agent.research_invocation_result_blobs (
      app_id, tenant_id, environment, result_record_kind, result_record_id, blob_id
    )
    on delete no action
    deferrable initially deferred,
  add constraint research_invocation_results_sql_receipt_fk
    foreign key (app_id, tenant_id, environment, secure_sql_receipt_id)
    references app_data_agent.research_secure_sql_execution_receipts (
      app_id, tenant_id, environment, record_id
    )
    on delete no action
    deferrable initially deferred,
  add constraint research_invocation_results_sql_receipt_shape
    check (
      (record_kind = 'SQL_INVOCATION_RESULT' and secure_sql_receipt_id is not null)
      or (record_kind <> 'SQL_INVOCATION_RESULT' and secure_sql_receipt_id is null)
    );

alter table app_data_agent.research_invocation_result_blobs
  add constraint research_invocation_result_blobs_result_fk
    foreign key (
      app_id, tenant_id, environment, result_record_kind, result_record_id, blob_id
    )
    references app_data_agent.research_invocation_results (
      app_id, tenant_id, environment, record_kind, record_id, blob_id
    )
    on delete no action
    deferrable initially deferred;

alter table app_data_agent.research_secure_sql_execution_receipts
  add constraint research_secure_sql_receipts_result_fk
    foreign key (app_id, tenant_id, environment, result_record_id, record_id)
    references app_data_agent.research_invocation_results (
      app_id, tenant_id, environment, record_id, secure_sql_receipt_id
    )
    on delete no action
    deferrable initially deferred;

alter table app_data_agent.research_invocation_terminal_preparations
  add constraint research_terminal_preparations_transition_fk
    foreign key (app_id, tenant_id, environment, invocation_id, transition_id)
    references app_data_agent.research_invocation_transition_operations (
      app_id, tenant_id, environment, invocation_id, transition_id
    )
    on delete restrict not deferrable;

create index research_authority_capabilities_expiry
on app_data_agent.research_authority_capabilities (
  app_id, tenant_id, environment, expires_at
)
where state = 'ACTIVE';

create index research_artifact_commit_operations_run_time
on app_data_agent.research_artifact_commit_operations (
  app_id, tenant_id, environment, run_id, committed_at
);

create index research_frontier_operations_run_time
on app_data_agent.research_frontier_operations (
  app_id, tenant_id, environment, run_id, completed_at
);

create index report_read_grants_expiry
on app_data_agent.report_read_grants (
  app_id, tenant_id, environment, expires_at, grant_id
)
where state in ('ISSUED', 'CONSUMED');

create index research_resource_reservations_run_state
on app_data_agent.research_resource_reservations (
  app_id, tenant_id, environment, run_id, state, reservation_seq
);

create index research_invocation_commits_run_state
on app_data_agent.research_invocation_commits (
  app_id, tenant_id, environment, run_id, state, invocation_id
);

create index research_invocation_terminal_preparations_expiry
on app_data_agent.research_invocation_terminal_preparations (
  app_id, tenant_id, environment, expires_at, preparation_id
)
where state in ('PREPARING', 'PREPARED');

create trigger research_artifact_commit_operations_immutable
before update or delete on app_data_agent.research_artifact_commit_operations
for each row execute function platform.reject_immutable_mutation();

create trigger research_frontier_events_immutable
before update or delete on app_data_agent.research_frontier_events
for each row execute function platform.reject_immutable_mutation();

create trigger research_readiness_publications_immutable
before update or delete on app_data_agent.research_readiness_publications
for each row execute function platform.reject_immutable_mutation();

create trigger research_readiness_consumptions_immutable
before update or delete on app_data_agent.research_readiness_consumptions
for each row execute function platform.reject_immutable_mutation();

create trigger research_domain_terminals_immutable
before update or delete on app_data_agent.research_domain_terminals
for each row execute function platform.reject_immutable_mutation();

create trigger research_stop_terminal_commits_immutable
before update or delete on app_data_agent.research_stop_terminal_commits
for each row execute function platform.reject_immutable_mutation();

create trigger research_release_decision_commits_immutable
before update or delete on app_data_agent.research_release_decision_commits
for each row execute function platform.reject_immutable_mutation();

create trigger research_result_key_transition_operations_immutable
before update or delete on app_data_agent.research_result_key_transition_operations
for each row execute function platform.reject_immutable_mutation();

create trigger research_resource_transition_operations_immutable
before update or delete on app_data_agent.research_resource_transition_operations
for each row execute function platform.reject_immutable_mutation();

create trigger research_invocation_request_operations_immutable
before update or delete on app_data_agent.research_invocation_request_operations
for each row execute function platform.reject_immutable_mutation();

create trigger research_invocation_transition_operations_immutable
before update or delete on app_data_agent.research_invocation_transition_operations
for each row execute function platform.reject_immutable_mutation();

create trigger research_system_artifacts_immutable
before update or delete on app_data_agent.research_system_artifacts
for each row execute function platform.reject_immutable_mutation();

create trigger research_system_record_identities_immutable
before update or delete on app_data_agent.research_system_record_identities
for each row execute function platform.reject_immutable_mutation();

create trigger research_adapter_termination_receipts_immutable
before update or delete on app_data_agent.research_adapter_termination_receipts
for each row execute function platform.reject_immutable_mutation();

create trigger research_invocation_outcome_usage_immutable
before update or delete on app_data_agent.research_invocation_outcome_usage
for each row execute function platform.reject_immutable_mutation();

create trigger research_result_access_audit_purge_operations_immutable
before update or delete on app_data_agent.research_result_access_audit_purge_operations
for each row execute function platform.reject_immutable_mutation();
create function platform.lock_u6_authority_binding(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  requested_deployment_id uuid,
  requested_principal_id uuid,
  expected_role text,
  requested_mode text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  candidate record;
  deployment record;
  lifecycle record;
  membership record;
begin
  if requested_mode not in ('READ', 'WRITE', 'PROVISION')
    or expected_role not in ('OWNER', 'ANALYST', 'VIEWER')
  then
    raise exception using errcode = '22023', message = 'DA_U6_AUTHORITY_BINDING_INVALID';
  end if;

  if requested_mode in ('READ', 'WRITE') then
    select *
    into candidate
    from platform.current_backend_authority(requested_mode = 'WRITE');
    if candidate.app_id <> requested_app_id
      or candidate.tenant_id <> requested_tenant_id
      or candidate.environment <> requested_environment
      or candidate.deployment_id <> requested_deployment_id
      or candidate.principal_id <> requested_principal_id
      or pg_catalog.upper(candidate.membership_role) <> expected_role
    then
      raise exception using errcode = '42501', message = 'DA_U6_AUTHORITY_STALE_OR_FORBIDDEN';
    end if;
  elsif not pg_catalog.pg_has_role(
    session_user,
    'data_agent_u6_provisioner',
    'SET'
  ) then
    raise exception using errcode = '42501', message = 'DA_U6_PROVISIONER_REQUIRED';
  end if;

  perform platform.acquire_lifecycle_shared_lock(requested_app_id, requested_environment);

  select source.*
  into deployment
  from platform.deployment_mappings as source
  where source.app_id = requested_app_id
    and source.environment = requested_environment
    and source.deployment_id = requested_deployment_id
  for share of source nowait;

  select source.*
  into lifecycle
  from platform.app_environment_lifecycle as source
  where source.app_id = requested_app_id
    and source.environment = requested_environment
  for share of source nowait;

  select source.*
  into membership
  from app_data_agent.memberships as source
  where source.app_id = requested_app_id
    and source.tenant_id = requested_tenant_id
    and source.environment = requested_environment
    and source.principal_id = requested_principal_id
  for share of source nowait;

  if deployment.deployment_id is null
    or not deployment.is_active
    or lifecycle.app_id is null
    or lifecycle.lifecycle_state <> 'ACTIVE'
    or membership.principal_id is null
    or membership.revoked_at is not null
    or pg_catalog.upper(membership.membership_role) <> expected_role
    or (
      requested_mode = 'WRITE'
      and membership.membership_role not in ('owner', 'analyst')
    )
  then
    raise exception using errcode = '42501', message = 'DA_U6_AUTHORITY_STALE_OR_FORBIDDEN';
  end if;

  return pg_catalog.jsonb_build_object(
    'app_id', requested_app_id,
    'tenant_id', requested_tenant_id,
    'environment', requested_environment,
    'deployment_id', requested_deployment_id,
    'principal_id', requested_principal_id,
    'membership_role', pg_catalog.upper(membership.membership_role),
    'membership_version', membership.membership_version,
    'app_epoch', lifecycle.authority_epoch,
    'lifecycle_state', lifecycle.lifecycle_state
  );
end
$function$;

create function platform.lock_u6_cleanup_platform_evidence(
  requested_app_id uuid,
  requested_environment text,
  requested_app_epoch bigint,
  requested_manifest_id uuid,
  requested_manifest_hash text,
  requested_boundary_receipt_id uuid,
  requested_boundary_receipt_hash text,
  requested_export_operation_id uuid,
  requested_export_operation_hash text,
  requested_backup_operation_id uuid,
  requested_backup_operation_hash text
)
returns jsonb
language plpgsql
volatile
strict
security definer
set search_path = ''
as $function$
declare
  lifecycle record;
  manifest record;
  export_event record;
  boundary_receipt record;
  export_operation record;
  backup_operation record;
begin
  select source.*
  into lifecycle
  from platform.app_environment_lifecycle as source
  where source.app_id = requested_app_id
    and source.environment = requested_environment
  for update of source nowait;

  select source.*
  into manifest
  from platform.resource_manifests as source
  where source.manifest_id = requested_manifest_id
    and source.app_id = requested_app_id
    and source.environment = requested_environment
  for key share of source nowait;

  select source.*
  into boundary_receipt
  from platform.boundary_audit_receipts as source
  where source.receipt_id = requested_boundary_receipt_id
    and source.app_id = requested_app_id
    and source.environment = requested_environment
  for key share of source nowait;

  select source.*
  into export_event
  from platform.app_lifecycle_events as source
  where source.receipt_id = requested_boundary_receipt_id
    and source.app_id = requested_app_id
    and source.environment = requested_environment
  for key share of source nowait;

  select source.*
  into export_operation
  from platform.resource_operation_receipts as source
  where source.operation_receipt_id = requested_export_operation_id
    and source.app_id = requested_app_id
    and source.environment = requested_environment
  for key share of source nowait;

  select source.*
  into backup_operation
  from platform.resource_operation_receipts as source
  where source.operation_receipt_id = requested_backup_operation_id
    and source.app_id = requested_app_id
    and source.environment = requested_environment
  for key share of source nowait;

  if lifecycle.app_id is null
    or lifecycle.lifecycle_state <> 'DELETE_PENDING'
    or lifecycle.authority_epoch <> requested_app_epoch
    or manifest.manifest_id is null
    or manifest.authority_epoch <> requested_app_epoch
    or manifest.payload_hash <> requested_manifest_hash
    or boundary_receipt.receipt_id is null
    or boundary_receipt.receipt_hash <> requested_boundary_receipt_hash
    or boundary_receipt.operation <> 'EXPORT_COMPLETED'
    or boundary_receipt.status <> 'SUCCEEDED'
    or boundary_receipt.previous_state <> 'EXPORT_PENDING'
    or boundary_receipt.resulting_state <> 'FROZEN'
    or export_event.event_id is null
    or export_event.operation <> 'EXPORT_COMPLETED'
    or export_event.previous_state <> 'EXPORT_PENDING'
    or export_event.resulting_state <> 'FROZEN'
    or export_operation.operation_receipt_id is null
    or export_operation.operation <> 'EXPORT'
    or export_operation.payload_hash <> requested_export_operation_hash
    or export_operation.manifest_id <> requested_manifest_id
    or backup_operation.operation_receipt_id is null
    or backup_operation.operation <> 'BACKUP'
    or backup_operation.payload_hash <> requested_backup_operation_hash
    or backup_operation.manifest_id <> requested_manifest_id
    or backup_operation.upstream_receipt_id <> requested_export_operation_id
  then
    raise exception using errcode = '42501', message = 'DA_U6_CLEANUP_EVIDENCE_INVALID';
  end if;

  return pg_catalog.jsonb_build_object(
    'app_id', requested_app_id,
    'environment', requested_environment,
    'app_epoch', requested_app_epoch,
    'manifest_id', requested_manifest_id,
    'manifest_hash', requested_manifest_hash,
    'boundary_receipt_id', requested_boundary_receipt_id,
    'boundary_receipt_hash', requested_boundary_receipt_hash,
    'export_operation_id', requested_export_operation_id,
    'export_operation_hash', requested_export_operation_hash,
    'backup_operation_id', requested_backup_operation_id,
    'backup_operation_hash', requested_backup_operation_hash
  );
end
$function$;

create function app_data_agent.u6_domain_sha256(
  requested_domain text,
  requested_payload jsonb
)
returns text
language sql
immutable
strict
set search_path = ''
as $function$
  select 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(requested_domain, 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || pg_catalog.convert_to(
        app_data_agent.runtime_canonical_json(requested_payload),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
$function$;

create function app_data_agent.u6_uuid_v5(
  requested_namespace uuid,
  requested_name bytea
)
returns uuid
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
  raw bytea;
  encoded text;
begin
  raw := pg_catalog.substring(
    extensions.digest(pg_catalog.uuid_send(requested_namespace) || requested_name, 'sha1'),
    1,
    16
  );
  raw := pg_catalog.set_byte(raw, 6, (pg_catalog.get_byte(raw, 6) & 15) | 80);
  raw := pg_catalog.set_byte(raw, 8, (pg_catalog.get_byte(raw, 8) & 63) | 128);
  encoded := pg_catalog.encode(raw, 'hex');
  return (
    pg_catalog.substring(encoded, 1, 8) || '-' ||
    pg_catalog.substring(encoded, 9, 4) || '-' ||
    pg_catalog.substring(encoded, 13, 4) || '-' ||
    pg_catalog.substring(encoded, 17, 4) || '-' ||
    pg_catalog.substring(encoded, 21, 12)
  )::uuid;
end
$function$;

create function app_data_agent.u6_strict_base64url_decode(
  requested_value text
)
returns bytea
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
  decoded bytea;
  padded text;
  round_trip text;
begin
  if requested_value !~ '^[A-Za-z0-9_-]*$'
    or pg_catalog.length(requested_value) % 4 = 1
  then
    raise exception using errcode = '22023', message = 'DA_U6_BASE64URL_INVALID';
  end if;
  padded := pg_catalog.translate(requested_value, '-_', '+/')
    || pg_catalog.repeat('=', (4 - pg_catalog.length(requested_value) % 4) % 4);
  begin
    decoded := pg_catalog.decode(padded, 'base64');
  exception
    when invalid_parameter_value or data_exception then
      raise exception using errcode = '22023', message = 'DA_U6_BASE64URL_INVALID';
  end;
  round_trip := pg_catalog.rtrim(
    pg_catalog.translate(pg_catalog.encode(decoded, 'base64'), '+/', '-_'),
    '='
  );
  if round_trip <> requested_value then
    raise exception using errcode = '22023', message = 'DA_U6_BASE64URL_INVALID';
  end if;
  return decoded;
end
$function$;

create function app_data_agent.u6_constant_time_equal(
  left_value bytea,
  right_value bytea
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $function$
declare
  maximum_length integer;
  difference integer;
  index_value integer;
  left_byte integer;
  right_byte integer;
begin
  maximum_length := pg_catalog.greatest(
    pg_catalog.length(left_value),
    pg_catalog.length(right_value)
  );
  difference := pg_catalog.length(left_value) # pg_catalog.length(right_value);
  if maximum_length = 0 then
    return difference = 0;
  end if;
  for index_value in 0..maximum_length - 1 loop
    left_byte := case
      when index_value < pg_catalog.length(left_value)
        then pg_catalog.get_byte(left_value, index_value)
      else 0
    end;
    right_byte := case
      when index_value < pg_catalog.length(right_value)
        then pg_catalog.get_byte(right_value, index_value)
      else 0
    end;
    difference := difference | (left_byte # right_byte);
  end loop;
  return difference = 0;
end
$function$;

create function app_data_agent.lock_u6_authority_capability(
  envelope_json jsonb,
  expected_authority_kind text,
  expected_artifact_domain text,
  expected_frontier_kind text,
  expected_resource_kind text,
  require_write boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  requested_capability_id uuid;
  requested_app_id uuid;
  requested_tenant_id uuid;
  requested_environment text;
  requested_principal_id uuid;
  candidate record;
  locked_binding jsonb;
  locator_assignment_key text;
  head record;
  capability record;
  db_now timestamptz;
begin
  if envelope_json is null
    or pg_catalog.jsonb_typeof(envelope_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(
        case
          when pg_catalog.jsonb_typeof(envelope_json) = 'object' then envelope_json
          else '{}'::jsonb
        end
      )
    ) <> 3
    or envelope_json ->> 'protocol_version' <> 'u6-db-command@1.0.0'
    or pg_catalog.jsonb_typeof(envelope_json -> 'command') <> 'object'
    or require_write is null
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;

  begin
    requested_capability_id :=
      (envelope_json ->> 'authority_capability_id')::uuid;
    command_json := envelope_json -> 'command';
    scope_json := command_json -> 'scope';
    if pg_catalog.jsonb_typeof(scope_json) <> 'object'
      or (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(
          case
            when pg_catalog.jsonb_typeof(scope_json) = 'object' then scope_json
            else '{}'::jsonb
          end
        )
      ) <> 3
    then
      raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
    end if;
    requested_app_id := (scope_json ->> 'app_id')::uuid;
    requested_tenant_id := (scope_json ->> 'tenant_id')::uuid;
    requested_environment := scope_json ->> 'environment';
    requested_principal_id := (command_json ->> 'principal_id')::uuid;
  exception
    when invalid_text_representation then
      raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end;

  select *
  into candidate
  from platform.current_backend_authority(require_write);

  locked_binding := platform.lock_u6_authority_binding(
    requested_app_id,
    requested_tenant_id,
    requested_environment,
    candidate.deployment_id,
    requested_principal_id,
    pg_catalog.upper(candidate.membership_role),
    case when require_write then 'WRITE' else 'READ' end
  );

  -- This first read only locates the assignment Head. The capability is not
  -- trusted until Head -> Capability have been locked in the frozen order.
  select source.assignment_key
  into locator_assignment_key
  from app_data_agent.research_authority_capabilities as source
  where source.app_id = requested_app_id
    and source.tenant_id = requested_tenant_id
    and source.environment = requested_environment
    and source.capability_id = requested_capability_id;
  if locator_assignment_key is null then
    raise exception using errcode = '42501', message = 'DA_U6_CAPABILITY_REQUIRED';
  end if;

  select source.*
  into head
  from app_data_agent.research_authority_capability_heads as source
  where source.app_id = requested_app_id
    and source.tenant_id = requested_tenant_id
    and source.environment = requested_environment
    and source.assignment_key = locator_assignment_key
  for update of source nowait;

  select source.*
  into capability
  from app_data_agent.research_authority_capabilities as source
  where source.app_id = requested_app_id
    and source.tenant_id = requested_tenant_id
    and source.environment = requested_environment
    and source.capability_id = requested_capability_id
    and source.assignment_key = locator_assignment_key
  for update of source nowait;

  db_now := pg_catalog.clock_timestamp();
  if head.assignment_key is null
    or capability.capability_id is null
    or head.current_capability_id <> capability.capability_id
    or head.current_authority_epoch <> capability.authority_epoch
    or capability.state <> 'ACTIVE'
    or capability.expires_at <= db_now
    or capability.principal_id <> requested_principal_id
    or capability.deployment_id <> candidate.deployment_id
    or capability.membership_version <> (locked_binding ->> 'membership_version')::bigint
    or capability.app_epoch <> (locked_binding ->> 'app_epoch')::bigint
    or capability.membership_role <> (locked_binding ->> 'membership_role')
    or capability.authority_kind <> expected_authority_kind
    or capability.artifact_authority_domain is distinct from expected_artifact_domain
    or capability.frontier_kind is distinct from expected_frontier_kind
    or capability.resource_kind is distinct from expected_resource_kind
  then
    raise exception using errcode = '42501', message = 'DA_U6_CAPABILITY_REQUIRED';
  end if;

  return pg_catalog.to_jsonb(capability);
end
$function$;

create function app_data_agent.commit_research_revocation_receipt(
  input_json jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  document_json jsonb;
  envelope_json jsonb;
  inserted_count bigint;
begin
  if input_json is null
    or pg_catalog.jsonb_typeof(input_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(
        case
          when pg_catalog.jsonb_typeof(input_json) = 'object' then input_json
          else '{}'::jsonb
        end
      )
    ) <> 2
    or pg_catalog.jsonb_typeof(input_json -> 'document') <> 'object'
    or (input_json ->> 'document_checksum') is null
  then
    raise exception using errcode = '22023', message = 'DA_U6_REVOCATION_RECEIPT_INVALID';
  end if;
  document_json := input_json -> 'document';
  envelope_json := document_json -> 'envelope';
  if input_json ->> 'document_checksum'
      <> app_data_agent.runtime_canonical_sha256(document_json)
    or envelope_json ->> 'artifact_type' <> 'ReadinessRevocationReceipt'
    or envelope_json ->> 'schema_version' <> '1.0.0'
    or document_json #>> '{payload,protocol_version}' <> 'readiness-revocation@1.0.0'
    or (envelope_json ->> 'worker_fence')::bigint <> 0
  then
    raise exception using errcode = '23514', message = 'DA_U6_REVOCATION_RECEIPT_INVALID';
  end if;

  insert into app_data_agent.artifacts (
    app_id, tenant_id, environment, run_id, artifact_id, artifact_type,
    revision, content_hash, document_json, worker_fence, is_active,
    parent_revision, parent_content_hash, created_at
  )
  values (
    (envelope_json ->> 'app_id')::uuid,
    (envelope_json ->> 'tenant_id')::uuid,
    envelope_json ->> 'environment',
    (envelope_json ->> 'run_id')::uuid,
    (envelope_json ->> 'artifact_id')::uuid,
    'ReadinessRevocationReceipt',
    (envelope_json ->> 'revision')::integer,
    envelope_json ->> 'content_hash',
    document_json,
    0,
    true,
    nullif(envelope_json #>> '{parent_ref,revision}', '')::integer,
    nullif(envelope_json #>> '{parent_ref,content_hash}', ''),
    pg_catalog.clock_timestamp()
  )
  on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 and not exists (
    select 1
    from app_data_agent.artifacts as artifact
    where artifact.app_id = (envelope_json ->> 'app_id')::uuid
      and artifact.tenant_id = (envelope_json ->> 'tenant_id')::uuid
      and artifact.environment = envelope_json ->> 'environment'
      and artifact.run_id = (envelope_json ->> 'run_id')::uuid
      and artifact.artifact_id = (envelope_json ->> 'artifact_id')::uuid
      and artifact.revision = (envelope_json ->> 'revision')::integer
      and artifact.content_hash = envelope_json ->> 'content_hash'
      and artifact.document_json = document_json
  ) then
    raise exception using errcode = '23505', message = 'DA_U6_REVOCATION_RECEIPT_CONFLICT';
  end if;
  return pg_catalog.jsonb_build_object(
    'created', inserted_count = 1,
    'reference', pg_catalog.jsonb_build_object(
      'app_id', envelope_json ->> 'app_id',
      'tenant_id', envelope_json ->> 'tenant_id',
      'environment', envelope_json ->> 'environment',
      'run_id', envelope_json ->> 'run_id',
      'artifact_id', envelope_json ->> 'artifact_id',
      'artifact_type', 'ReadinessRevocationReceipt',
      'revision', (envelope_json ->> 'revision')::integer,
      'content_hash', envelope_json ->> 'content_hash'
    )
  );
end
$function$;

create function app_data_agent.commit_research_system_artifact(
  input_json jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  created_count bigint;
begin
  if input_json is null or pg_catalog.jsonb_typeof(input_json) <> 'object' then
    raise exception using errcode = '22023', message = 'DA_U6_SYSTEM_ARTIFACT_INVALID';
  end if;
  insert into app_data_agent.research_system_artifacts (
    app_id, tenant_id, environment, run_id, artifact_id, artifact_type,
    revision, content_hash, principal_id, idempotency_key, reservation_id,
    invocation_id, request_profile_hash, request_hash, field_count, byte_count,
    token_count, hmac_hash, policy_ref, payload_json
  )
  values (
    (input_json #>> '{scope,app_id}')::uuid,
    (input_json #>> '{scope,tenant_id}')::uuid,
    input_json #>> '{scope,environment}',
    (input_json ->> 'run_id')::uuid,
    (input_json ->> 'artifact_id')::uuid,
    'AgentDataProjectionReceipt',
    1,
    input_json ->> 'content_hash',
    (input_json ->> 'principal_id')::uuid,
    input_json ->> 'idempotency_key',
    (input_json ->> 'reservation_id')::uuid,
    (input_json ->> 'invocation_id')::uuid,
    input_json ->> 'request_profile_hash',
    input_json ->> 'request_hash',
    (input_json ->> 'field_count')::bigint,
    (input_json ->> 'byte_count')::bigint,
    (input_json ->> 'token_count')::bigint,
    input_json ->> 'hmac_hash',
    input_json -> 'policy_ref',
    input_json -> 'payload'
  )
  on conflict do nothing;
  get diagnostics created_count = row_count;
  if created_count = 0 and not exists (
    select 1
    from app_data_agent.research_system_artifacts as artifact
    where artifact.app_id = (input_json #>> '{scope,app_id}')::uuid
      and artifact.tenant_id = (input_json #>> '{scope,tenant_id}')::uuid
      and artifact.environment = input_json #>> '{scope,environment}'
      and artifact.run_id = (input_json ->> 'run_id')::uuid
      and artifact.artifact_id = (input_json ->> 'artifact_id')::uuid
      and artifact.artifact_type = 'AgentDataProjectionReceipt'
      and artifact.revision = 1
      and artifact.content_hash = input_json ->> 'content_hash'
      and artifact.principal_id = (input_json ->> 'principal_id')::uuid
      and artifact.idempotency_key = input_json ->> 'idempotency_key'
      and artifact.reservation_id = (input_json ->> 'reservation_id')::uuid
      and artifact.invocation_id = (input_json ->> 'invocation_id')::uuid
      and artifact.request_profile_hash = input_json ->> 'request_profile_hash'
      and artifact.request_hash = input_json ->> 'request_hash'
      and artifact.field_count = (input_json ->> 'field_count')::bigint
      and artifact.byte_count = (input_json ->> 'byte_count')::bigint
      and artifact.token_count = (input_json ->> 'token_count')::bigint
      and artifact.hmac_hash = input_json ->> 'hmac_hash'
      and artifact.policy_ref = input_json -> 'policy_ref'
      and artifact.payload_json = input_json -> 'payload'
    for update of artifact
  ) then
    raise exception using
      errcode = '23505',
      message = 'DA_U6_SYSTEM_ARTIFACT_IDEMPOTENCY_CONFLICT';
  end if;
  return pg_catalog.jsonb_build_object(
    'created', created_count = 1,
    'artifact_id', input_json ->> 'artifact_id',
    'revision', 1,
    'content_hash', input_json ->> 'content_hash'
  );
end
$function$;
create function app_data_agent.commit_current_l2_artifact(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  candidate_json jsonb;
  candidate_envelope jsonb;
  candidate_payload jsonb;
  artifact_domain text;
  input_hash text;
  computed_content_hash text;
  db_now timestamptz;
  committed_at text;
  committed_document jsonb;
  target_run record;
  target_attempt record;
  target_outbox record;
  active_artifact record;
  existing_operation record;
  expected_parent jsonb;
  observed_parent jsonb;
  claim_identity text;
  evidence_identity text;
  pair_hash text;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 10
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  candidate_json := command_json -> 'candidate';
  candidate_envelope := candidate_json -> 'envelope';
  candidate_payload := candidate_json -> 'payload';
  if pg_catalog.jsonb_typeof(candidate_json) <> 'object'
    or pg_catalog.jsonb_typeof(candidate_envelope) <> 'object'
    or pg_catalog.jsonb_typeof(candidate_payload) <> 'object'
    or candidate_envelope ->> 'artifact_type' is distinct from candidate_payload ->> 'artifact_type'
    or candidate_envelope ->> 'status' <> 'CANDIDATE'
    or candidate_envelope ->> 'app_id' is distinct from scope_json ->> 'app_id'
    or candidate_envelope ->> 'tenant_id' is distinct from scope_json ->> 'tenant_id'
    or candidate_envelope ->> 'environment' is distinct from scope_json ->> 'environment'
    or candidate_envelope ->> 'run_id' is distinct from command_json ->> 'run_id'
    or candidate_envelope ->> 'attempt_id' is distinct from command_json ->> 'attempt_id'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;

  artifact_domain := case candidate_payload ->> 'artifact_type'
    when 'ResearchBrief' then 'BRIEF_SEMANTIC'
    when 'HypothesisSet' then 'PLANNING'
    when 'EvidencePlan' then 'PLANNING'
    when 'ObligationExecutionDecision' then 'OBLIGATION_EXECUTION'
    when 'QueryEvidence' then 'EVIDENCE'
    when 'AtomicClaim' then 'CLAIM_STRUCTURE'
    when 'EvidenceRelation' then 'RELATION'
    when 'EvidenceCheckReceipt' then 'PROOF'
    when 'SupportDecision' then 'PROOF'
    when 'HypothesisAssessment' then 'PROOF'
    when 'CoverageState' then 'COVERAGE'
    when 'ResearchStopDecision' then 'RESEARCH_STOP'
    when 'ReportManifest' then 'PROJECTION'
    when 'AnalysisReport' then 'PROJECTION'
    when 'ReportProjectionReceipt' then 'PROJECTION'
    when 'EvidenceGateReceipt' then 'EVIDENCE_GATE'
    when 'ReportReadyCertificate' then 'READINESS'
    else null
  end;
  if artifact_domain is null
    or candidate_payload ->> 'artifact_type' = 'ReadinessRevocationReceipt'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'L2_WIRE_VERSION_WRITE_UNSUPPORTED',
        'retryable', false
      )
    );
  end if;

  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESEARCH_ARTIFACT_AUTHORITY',
    artifact_domain,
    null,
    null,
    true
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-artifact-commit-input@1.0.0',
    command_json
  );
  computed_content_hash := app_data_agent.runtime_canonical_sha256(
    pg_catalog.jsonb_build_object(
      'envelope',
      candidate_envelope - 'content_hash' - 'created_at' - 'status',
      'payload',
      candidate_payload
    )
  );
  if computed_content_hash <> candidate_envelope ->> 'content_hash' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READY_CERTIFICATE_TAMPERED',
        'retryable', false
      )
    );
  end if;

  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  if target_run.run_id is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH',
        'retryable', false
      )
    );
  end if;

  select source.*
  into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.run_id = target_run.run_id
    and source.attempt_id = (command_json ->> 'attempt_id')::uuid;
  if target_attempt.attempt_id is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_AUTHORITY_FENCE_MISMATCH',
        'retryable', false
      )
    );
  end if;

  select source.*
  into target_outbox
  from app_data_agent.outbox as source
  where source.app_id = target_attempt.app_id
    and source.tenant_id = target_attempt.tenant_id
    and source.environment = target_attempt.environment
    and source.outbox_id = target_attempt.outbox_id
    and source.run_id = target_attempt.run_id
  for update of source nowait;

  select source.*
  into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_attempt.app_id
    and source.tenant_id = target_attempt.tenant_id
    and source.environment = target_attempt.environment
    and source.attempt_id = target_attempt.attempt_id
  for update of source nowait;

  db_now := pg_catalog.clock_timestamp();
  if target_outbox.outbox_id is null
    or target_attempt.status <> 'ACTIVE'
    or target_attempt.worker_fence <> (command_json ->> 'worker_fence')::bigint
    or target_attempt.lease_expires_at <= db_now
    or target_outbox.active_attempt_id <> target_attempt.attempt_id
    or target_outbox.run_fence <> target_attempt.worker_fence
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_AUTHORITY_FENCE_MISMATCH',
        'retryable', false
      )
    );
  end if;

  select source.*
  into existing_operation
  from app_data_agent.research_artifact_commit_operations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and (
      source.commit_id = (command_json ->> 'commit_id')::uuid
      or (
        source.run_id = target_run.run_id
        and source.principal_id = target_run.principal_id
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  for update of source nowait;
  if existing_operation.commit_id is not null then
    if existing_operation.input_hash <> input_hash
      or existing_operation.commit_id <> (command_json ->> 'commit_id')::uuid
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'READINESS_IDEMPOTENCY_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'reference', pg_catalog.jsonb_build_object(
          'app_id', existing_operation.app_id,
          'tenant_id', existing_operation.tenant_id,
          'environment', existing_operation.environment,
          'run_id', existing_operation.run_id,
          'artifact_id', existing_operation.artifact_id,
          'artifact_type', existing_operation.artifact_type,
          'revision', existing_operation.revision,
          'content_hash', existing_operation.content_hash
        ),
        'created', false
      )
    );
  end if;

  select source.*
  into active_artifact
  from app_data_agent.artifacts as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.run_id = target_run.run_id
    and source.artifact_id = (candidate_envelope ->> 'artifact_id')::uuid
    and source.is_active
  for update of source nowait;

  expected_parent := command_json -> 'expected_parent_ref';
  observed_parent := case
    when active_artifact.artifact_id is null then null
    else pg_catalog.jsonb_build_object(
      'app_id', active_artifact.app_id,
      'tenant_id', active_artifact.tenant_id,
      'environment', active_artifact.environment,
      'run_id', active_artifact.run_id,
      'artifact_id', active_artifact.artifact_id,
      'artifact_type', active_artifact.artifact_type,
      'revision', active_artifact.revision,
      'content_hash', active_artifact.content_hash
    )
  end;
  if observed_parent is distinct from expected_parent
    or (
      active_artifact.artifact_id is null
      and (candidate_envelope ->> 'revision')::integer <> 1
    )
    or (
      active_artifact.artifact_id is not null
      and (candidate_envelope ->> 'revision')::integer <> active_artifact.revision + 1
    )
    or candidate_envelope -> 'parent_ref' is distinct from expected_parent
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT',
        'retryable', false
      )
    );
  end if;

  if candidate_payload ->> 'artifact_type' = 'EvidenceRelation' then
    claim_identity := app_data_agent.runtime_canonical_json(candidate_payload -> 'claim_ref');
    evidence_identity := app_data_agent.runtime_canonical_json(candidate_payload -> 'evidence_ref');
    pair_hash := app_data_agent.u6_domain_sha256(
      'research-evidence-relation-pair@1.0.0',
      pg_catalog.jsonb_build_array(
        candidate_payload -> 'claim_ref',
        candidate_payload -> 'evidence_ref'
      )
    );
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(pair_hash, 0)
    );
    if exists (
      select 1
      from app_data_agent.research_current_evidence_relation_keys as relation_key
      where relation_key.app_id = target_run.app_id
        and relation_key.tenant_id = target_run.tenant_id
        and relation_key.environment = target_run.environment
        and relation_key.run_id = target_run.run_id
        and relation_key.claim_ref_identity = claim_identity
        and relation_key.evidence_ref_identity = evidence_identity
        and relation_key.artifact_id <> (candidate_envelope ->> 'artifact_id')::uuid
    ) then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'EVIDENCE_RELATION_IDENTITY_CONFLICT',
          'retryable', false
        )
      );
    end if;
  end if;

  committed_at := pg_catalog.to_char(
    db_now at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  committed_document := pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      candidate_json,
      '{envelope,status}',
      '"COMMITTED"'::jsonb,
      false
    ),
    '{envelope,created_at}',
    pg_catalog.to_jsonb(committed_at),
    false
  );

  if active_artifact.artifact_id is not null then
    update app_data_agent.artifacts
    set is_active = false
    where app_id = active_artifact.app_id
      and tenant_id = active_artifact.tenant_id
      and environment = active_artifact.environment
      and run_id = active_artifact.run_id
      and artifact_id = active_artifact.artifact_id
      and revision = active_artifact.revision;
  end if;

  insert into app_data_agent.artifacts (
    app_id, tenant_id, environment, run_id, artifact_id, artifact_type,
    revision, content_hash, document_json, worker_fence, is_active,
    parent_revision, parent_content_hash, created_at
  )
  values (
    target_run.app_id,
    target_run.tenant_id,
    target_run.environment,
    target_run.run_id,
    (candidate_envelope ->> 'artifact_id')::uuid,
    candidate_envelope ->> 'artifact_type',
    (candidate_envelope ->> 'revision')::integer,
    candidate_envelope ->> 'content_hash',
    committed_document,
    (command_json ->> 'worker_fence')::bigint,
    true,
    nullif(expected_parent ->> 'revision', '')::integer,
    nullif(expected_parent ->> 'content_hash', ''),
    db_now
  );

  if candidate_payload ->> 'artifact_type' = 'EvidenceRelation' then
    insert into app_data_agent.research_current_evidence_relation_keys (
      app_id, tenant_id, environment, run_id, claim_ref_identity,
      evidence_ref_identity, pair_identity_hash, artifact_id, artifact_type,
      revision, content_hash
    )
    values (
      target_run.app_id, target_run.tenant_id, target_run.environment,
      target_run.run_id, claim_identity, evidence_identity, pair_hash,
      (candidate_envelope ->> 'artifact_id')::uuid, 'EvidenceRelation',
      (candidate_envelope ->> 'revision')::integer,
      candidate_envelope ->> 'content_hash'
    )
    on conflict (
      app_id, tenant_id, environment, run_id,
      claim_ref_identity, evidence_ref_identity
    )
    do update set
      revision = excluded.revision,
      content_hash = excluded.content_hash,
      updated_at = db_now;
  end if;

  insert into app_data_agent.research_artifact_commit_operations (
    app_id, tenant_id, environment, run_id, commit_id, principal_id,
    idempotency_key, input_hash, artifact_authority_domain, artifact_id,
    artifact_type, revision, content_hash, parent_ref, candidate_json
  )
  values (
    target_run.app_id, target_run.tenant_id, target_run.environment,
    target_run.run_id, (command_json ->> 'commit_id')::uuid,
    target_run.principal_id, command_json ->> 'idempotency_key', input_hash,
    artifact_domain, (candidate_envelope ->> 'artifact_id')::uuid,
    candidate_envelope ->> 'artifact_type',
    (candidate_envelope ->> 'revision')::integer,
    candidate_envelope ->> 'content_hash', expected_parent, candidate_json
  );

  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'reference', pg_catalog.jsonb_build_object(
        'app_id', target_run.app_id,
        'tenant_id', target_run.tenant_id,
        'environment', target_run.environment,
        'run_id', target_run.run_id,
        'artifact_id', candidate_envelope ->> 'artifact_id',
        'artifact_type', candidate_envelope ->> 'artifact_type',
        'revision', (candidate_envelope ->> 'revision')::integer,
        'content_hash', candidate_envelope ->> 'content_hash'
      ),
      'created', true
    )
  );
end
$function$;

create function app_data_agent.consume_current_ready(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  certificate_ref jsonb;
  certificate_document jsonb;
  certificate_payload jsonb;
  report_ref jsonb;
  report_document jsonb;
  requested_purpose text;
  expected_authority text;
  require_write boolean;
  input_hash text;
  current_row record;
  terminal_row record;
  grant_row record;
  consumption_row record;
  semantic_frontier record;
  schema_frontier record;
  data_frontier record;
  policy_frontier record;
  identity_frontier record;
  aggregate_frontier_hash text;
  body_bytes bytea;
  body_base64url text;
  response_digest text;
  response_wire jsonb;
  response_binding jsonb;
  response_wire_hash text;
  db_now timestamptz;
  expires_at timestamptz;
  requested_terminal_id uuid;
  requested_grant_id uuid;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 9
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'consumption_id', 'purpose', 'certificate_ref'
      ]
    )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  requested_purpose := command_json ->> 'purpose';
  if (
    requested_purpose = 'DOMAIN_TERMINAL'
    and command_json ? 'terminal_id'
    and not command_json ? 'grant_id'
  ) then
    expected_authority := 'CURRENT_READINESS_AUTHORITY';
    require_write := true;
    requested_terminal_id := (command_json ->> 'terminal_id')::uuid;
  elsif (
    requested_purpose = 'REPORT_READ'
    and command_json ? 'grant_id'
    and not command_json ? 'terminal_id'
  ) then
    expected_authority := 'REPORT_READ_AUTHORITY';
    require_write := false;
    requested_grant_id := (command_json ->> 'grant_id')::uuid;
  else
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;

  scope_json := command_json -> 'scope';
  certificate_ref := command_json -> 'certificate_ref';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, expected_authority, null, null, null, require_write
  );
  -- Coverage derivation, candidate-enumeration, budget-ledger and input-event
  -- watermark receipts are not yet persisted as DB-owned exact inputs.
  -- Without those inputs PostgreSQL cannot replay the frozen Research Kernel,
  -- so neither READY consumption nor ReportRead Grant issue may succeed.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_DATABASE_AUTHORITY_REQUIRED', 'retryable', false
    )
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-readiness-consumption@1.0.0', command_json
  );

  perform 1
  from app_data_agent.runs as run
  where run.app_id = (scope_json ->> 'app_id')::uuid
    and run.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and run.environment = scope_json ->> 'environment'
    and run.run_id = (command_json ->> 'run_id')::uuid
    and (
      requested_purpose = 'REPORT_READ'
      or run.principal_id = (command_json ->> 'principal_id')::uuid
    )
  for update of run nowait;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH', 'retryable', false
      )
    );
  end if;

  select artifact.document_json
  into certificate_document
  from app_data_agent.artifacts as artifact
  where artifact.app_id = (scope_json ->> 'app_id')::uuid
    and artifact.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and artifact.environment = scope_json ->> 'environment'
    and artifact.run_id = (command_json ->> 'run_id')::uuid
    and artifact.artifact_id = (certificate_ref ->> 'artifact_id')::uuid
    and artifact.artifact_type = 'ReportReadyCertificate'
    and artifact.revision = (certificate_ref ->> 'revision')::integer
    and artifact.content_hash = certificate_ref ->> 'content_hash'
    and artifact.is_active
  for update of artifact nowait;
  certificate_payload := certificate_document -> 'payload';
  if certificate_document is null
    or certificate_payload ->> 'protocol_version'
      is distinct from 'report-ready@3.0.0'
    or certificate_document #>> '{envelope,status}'
      is distinct from 'COMMITTED'
    or app_data_agent.runtime_canonical_sha256(
      pg_catalog.jsonb_build_object(
        'envelope',
          (certificate_document -> 'envelope')
            - 'content_hash' - 'created_at' - 'status',
        'payload', certificate_payload
      )
    ) <> certificate_ref ->> 'content_hash'
    or certificate_payload ->> 'certificate_semantic_hash'
      <> app_data_agent.runtime_canonical_sha256(
        certificate_payload - 'certificate_semantic_hash'
      )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READY_CERTIFICATE_TAMPERED', 'retryable', false
      )
    );
  end if;
  report_ref := certificate_payload -> 'analysis_report_ref';
  select artifact.document_json
  into report_document
  from app_data_agent.artifacts as artifact
  where artifact.app_id = (scope_json ->> 'app_id')::uuid
    and artifact.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and artifact.environment = scope_json ->> 'environment'
    and artifact.run_id = (command_json ->> 'run_id')::uuid
    and artifact.artifact_id = (report_ref ->> 'artifact_id')::uuid
    and artifact.artifact_type = 'AnalysisReport'
    and artifact.revision = (report_ref ->> 'revision')::integer
    and artifact.content_hash = report_ref ->> 'content_hash'
    and artifact.is_active
  for update of artifact nowait;
  if report_document is null
    or report_document #>> '{payload,protocol_version}'
      is distinct from 'analysis-report@2.0.0'
    or report_document #>> '{envelope,status}' is distinct from 'COMMITTED'
    or app_data_agent.runtime_canonical_sha256(
      pg_catalog.jsonb_build_object(
        'envelope',
          (report_document -> 'envelope')
            - 'content_hash' - 'created_at' - 'status',
        'payload', report_document -> 'payload'
      )
    ) <> report_ref ->> 'content_hash'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT', 'retryable', false
      )
    );
  end if;

  select source.*
  into current_row
  from app_data_agent.current_report_readiness as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
  for update of source nowait;
  if current_row.run_id is null
    or current_row.certificate_ref is distinct from certificate_ref
    or current_row.report_ref is distinct from report_ref
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT', 'retryable', false
      )
    );
  end if;

  perform 1
  from app_data_agent.research_version_frontiers as frontier
  where frontier.app_id = current_row.app_id
    and frontier.tenant_id = current_row.tenant_id
    and frontier.environment = current_row.environment
    and frontier.run_id = current_row.run_id
  order by case frontier.frontier_kind
    when 'SEMANTIC' then 1 when 'SCHEMA' then 2 when 'DATA' then 3
    when 'POLICY' then 4 when 'IDENTITY' then 5 end
  for update of frontier nowait;
  select source.* into semantic_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'SEMANTIC';
  select source.* into schema_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'SCHEMA';
  select source.* into data_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'DATA';
  select source.* into policy_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'POLICY';
  select source.* into identity_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'IDENTITY';
  if semantic_frontier.frontier_kind is null
    or schema_frontier.frontier_kind is null
    or data_frontier.frontier_kind is null
    or policy_frontier.frontier_kind is null
    or identity_frontier.frontier_kind is null
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'READINESS_FRONTIER_INCOMPLETE', 'retryable', false
      )
    );
  end if;
  aggregate_frontier_hash := app_data_agent.u6_domain_sha256(
    'research-frontier-vector@1.0.0',
    pg_catalog.jsonb_build_object(
      'SEMANTIC', semantic_frontier.frontier_value_json,
      'SCHEMA', schema_frontier.frontier_value_json,
      'DATA', data_frontier.frontier_value_json,
      'POLICY', policy_frontier.frontier_value_json,
      'IDENTITY', identity_frontier.frontier_value_json
    )
  );
  if current_row.state = 'CURRENT'
    and (
      current_row.frontier_hash <> aggregate_frontier_hash
      or current_row.certificate_semantic_hash
        <> certificate_payload ->> 'certificate_semantic_hash'
      or current_row.semantic_frontier_version <> semantic_frontier.frontier_version
      or current_row.semantic_frontier_hash <> semantic_frontier.frontier_value_hash
      or current_row.schema_frontier_version <> schema_frontier.frontier_version
      or current_row.schema_frontier_hash <> schema_frontier.frontier_value_hash
      or current_row.data_frontier_version <> data_frontier.frontier_version
      or current_row.data_frontier_hash <> data_frontier.frontier_value_hash
      or current_row.policy_frontier_version <> policy_frontier.frontier_version
      or current_row.policy_frontier_hash <> policy_frontier.frontier_value_hash
      or current_row.identity_frontier_version <> identity_frontier.frontier_version
      or current_row.identity_frontier_hash <> identity_frontier.frontier_value_hash
      or current_row.authority_epoch <> identity_frontier.authority_epoch
      or certificate_payload #> '{version_frontier,semantic_release_ref}'
        is distinct from semantic_frontier.frontier_value_json -> 'reference'
      or certificate_payload #> '{version_frontier,schema_snapshot_ref}'
        is distinct from schema_frontier.frontier_value_json -> 'reference'
      or certificate_payload #> '{version_frontier,data_snapshot}'
        is distinct from data_frontier.frontier_value_json -> 'data_snapshot'
      or certificate_payload #> '{version_frontier,policy_receipt_ref}'
        is distinct from policy_frontier.frontier_value_json -> 'reference'
      or certificate_payload #> '{version_frontier,identity_binding}'
        is distinct from identity_frontier.frontier_value_json -> 'identity_binding'
    )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'READINESS_FRONTIER_STALE', 'retryable', false
      )
    );
  end if;

  select source.*
  into terminal_row
  from app_data_agent.research_domain_terminals as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
  for update of source nowait;
  if requested_purpose = 'REPORT_READ' then
    select source.*
    into grant_row
    from app_data_agent.report_read_grants as source
    where source.app_id = current_row.app_id
      and source.tenant_id = current_row.tenant_id
      and source.environment = current_row.environment
      and source.grant_id = requested_grant_id
    for update of source nowait;
  end if;
  select source.*
  into consumption_row
  from app_data_agent.research_readiness_consumptions as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and (
      source.consumption_id = (command_json ->> 'consumption_id')::uuid
      or (
        source.run_id = current_row.run_id
        and source.principal_id = (command_json ->> 'principal_id')::uuid
        and source.purpose = requested_purpose
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  for update of source nowait;
  if consumption_row.consumption_id is not null then
    if consumption_row.consumption_id
        <> (command_json ->> 'consumption_id')::uuid
      or consumption_row.input_hash <> input_hash
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'READINESS_IDEMPOTENCY_CONFLICT', 'retryable', false
        )
      );
    end if;
    if consumption_row.outcome = 'STALE_COMMITTED'
      and current_row.state = 'REVOKED'
      and terminal_row.terminal = 'STALE'
      and terminal_row.revocation_receipt_ref
        is not distinct from current_row.revocation_receipt_ref
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
        'value', pg_catalog.jsonb_build_object(
          'purpose', 'DOMAIN_TERMINAL',
          'outcome', 'STALE_COMMITTED',
          'consumption_id', consumption_row.consumption_id,
          'current_state', 'REVOKED',
          'terminal', pg_catalog.jsonb_build_object(
            'terminal_id', terminal_row.terminal_id,
            'terminal', 'STALE',
            'reason_code', 'RUN_STALE',
            'domain_reason_codes', terminal_row.domain_reason_codes,
            'authority_kind', 'REVOCATION_CONSUMPTION',
            'certificate_ref', null,
            'revocation_receipt_ref', terminal_row.revocation_receipt_ref,
            'stop_decision_ref', null,
            'committed_at', terminal_row.committed_at
          )
        )
      );
    elsif consumption_row.outcome = 'READY_COMMITTED'
      and current_row.state = 'CURRENT'
      and terminal_row.terminal = 'READY'
      and terminal_row.certificate_ref is not distinct from certificate_ref
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
        'value', pg_catalog.jsonb_build_object(
          'purpose', 'DOMAIN_TERMINAL',
          'outcome', 'READY_COMMITTED',
          'consumption_id', consumption_row.consumption_id,
          'current_state', 'CURRENT',
          'terminal', pg_catalog.jsonb_build_object(
            'terminal_id', terminal_row.terminal_id,
            'terminal', 'READY',
            'reason_code', 'RUN_READY',
            'domain_reason_codes', terminal_row.domain_reason_codes,
            'authority_kind', 'CURRENT_READINESS',
            'certificate_ref', terminal_row.certificate_ref,
            'revocation_receipt_ref', null,
            'stop_decision_ref', null,
            'committed_at', terminal_row.committed_at
          )
        )
      );
    elsif consumption_row.outcome = 'GRANT_ISSUED'
      and current_row.state = 'CURRENT'
      and grant_row.grant_id = consumption_row.grant_id
      and grant_row.state in ('ISSUED', 'CONSUMED', 'RESPONDED')
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
        'value', pg_catalog.jsonb_build_object(
          'purpose', 'REPORT_READ',
          'outcome', 'GRANT_ISSUED',
          'consumption_id', consumption_row.consumption_id,
          'current_state', 'CURRENT',
          'grant_id', grant_row.grant_id,
          'state', 'ISSUED',
          'response', grant_row.response_wire - 'body_base64url'
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code',
        case when current_row.state = 'REVOKED'
          then 'CURRENT_READINESS_REVOKED'
          else 'AUTHORITY_EVIDENCE_NOT_CURRENT' end,
        'retryable', false
      )
    );
  end if;

  db_now := pg_catalog.clock_timestamp();
  if current_row.state = 'REVOKED' then
    if requested_purpose = 'REPORT_READ' then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'CURRENT_READINESS_REVOKED', 'retryable', false
        )
      );
    end if;
    if terminal_row.run_id is not null
      or current_row.revocation_receipt_ref is null
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'CURRENT_READINESS_REVOKED', 'retryable', false
        )
      );
    end if;
    insert into app_data_agent.research_domain_terminals (
      app_id, tenant_id, environment, run_id, terminal_id, terminal,
      authority_kind, reason_code, domain_reason_codes, certificate_ref,
      revocation_receipt_ref, stop_decision_ref, coverage_ref, input_hash,
      committed_at
    )
    values (
      current_row.app_id, current_row.tenant_id, current_row.environment,
      current_row.run_id, requested_terminal_id, 'STALE',
      'REVOCATION_CONSUMPTION', 'RUN_STALE',
      '["READINESS_REVOKED_DURING_CONSUMPTION"]'::jsonb,
      null, current_row.revocation_receipt_ref, null, null, input_hash, db_now
    );
    insert into app_data_agent.research_readiness_consumptions (
      app_id, tenant_id, environment, consumption_id, run_id, principal_id,
      purpose, idempotency_key, input_hash, certificate_ref, report_ref,
      readiness_version, revocation_seq, frontier_hash, authority_epoch,
      outcome, terminal_id, grant_id, committed_at
    )
    values (
      current_row.app_id, current_row.tenant_id, current_row.environment,
      (command_json ->> 'consumption_id')::uuid, current_row.run_id,
      (command_json ->> 'principal_id')::uuid, 'DOMAIN_TERMINAL',
      command_json ->> 'idempotency_key', input_hash, certificate_ref,
      current_row.report_ref, current_row.readiness_version,
      current_row.revocation_seq, current_row.frontier_hash,
      current_row.authority_epoch, 'STALE_COMMITTED',
      requested_terminal_id, null, db_now
    );
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'purpose', 'DOMAIN_TERMINAL',
        'outcome', 'STALE_COMMITTED',
        'consumption_id', command_json ->> 'consumption_id',
        'current_state', 'REVOKED',
        'terminal', pg_catalog.jsonb_build_object(
          'terminal_id', requested_terminal_id,
          'terminal', 'STALE',
          'reason_code', 'RUN_STALE',
          'domain_reason_codes',
            '["READINESS_REVOKED_DURING_CONSUMPTION"]'::jsonb,
          'authority_kind', 'REVOCATION_CONSUMPTION',
          'certificate_ref', null,
          'revocation_receipt_ref', current_row.revocation_receipt_ref,
          'stop_decision_ref', null,
          'committed_at', db_now
        )
      )
    );
  end if;

  if requested_purpose = 'DOMAIN_TERMINAL' then
    if terminal_row.run_id is not null then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'CURRENT_READY_CONSUMPTION_REQUIRED', 'retryable', false
        )
      );
    end if;
    insert into app_data_agent.research_domain_terminals (
      app_id, tenant_id, environment, run_id, terminal_id, terminal,
      authority_kind, reason_code, domain_reason_codes, certificate_ref,
      revocation_receipt_ref, stop_decision_ref, coverage_ref, input_hash,
      committed_at
    )
    values (
      current_row.app_id, current_row.tenant_id, current_row.environment,
      current_row.run_id, requested_terminal_id, 'READY',
      'CURRENT_READINESS', 'RUN_READY', '[]'::jsonb, certificate_ref,
      null, null, null, input_hash, db_now
    );
    insert into app_data_agent.research_readiness_consumptions (
      app_id, tenant_id, environment, consumption_id, run_id, principal_id,
      purpose, idempotency_key, input_hash, certificate_ref, report_ref,
      readiness_version, revocation_seq, frontier_hash, authority_epoch,
      outcome, terminal_id, grant_id, committed_at
    )
    values (
      current_row.app_id, current_row.tenant_id, current_row.environment,
      (command_json ->> 'consumption_id')::uuid, current_row.run_id,
      (command_json ->> 'principal_id')::uuid, 'DOMAIN_TERMINAL',
      command_json ->> 'idempotency_key', input_hash, certificate_ref,
      current_row.report_ref, current_row.readiness_version,
      current_row.revocation_seq, current_row.frontier_hash,
      current_row.authority_epoch, 'READY_COMMITTED',
      requested_terminal_id, null, db_now
    );
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'purpose', 'DOMAIN_TERMINAL',
        'outcome', 'READY_COMMITTED',
        'consumption_id', command_json ->> 'consumption_id',
        'current_state', 'CURRENT',
        'terminal', pg_catalog.jsonb_build_object(
          'terminal_id', requested_terminal_id,
          'terminal', 'READY',
          'reason_code', 'RUN_READY',
          'domain_reason_codes', '[]'::jsonb,
          'authority_kind', 'CURRENT_READINESS',
          'certificate_ref', certificate_ref,
          'revocation_receipt_ref', null,
          'stop_decision_ref', null,
          'committed_at', db_now
        )
      )
    );
  end if;

  if terminal_row.terminal is distinct from 'READY'
    or terminal_row.authority_kind is distinct from 'CURRENT_READINESS'
    or terminal_row.certificate_ref is distinct from certificate_ref
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_READY_TERMINAL_REQUIRED', 'retryable', false
      )
    );
  end if;
  if grant_row.grant_id is not null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'READINESS_IDEMPOTENCY_CONFLICT', 'retryable', false
      )
    );
  end if;

  body_bytes := pg_catalog.convert_to(
    app_data_agent.runtime_canonical_json(report_document -> 'payload'),
    'UTF8'
  );
  if pg_catalog.octet_length(body_bytes) > 1048576 then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  body_base64url := pg_catalog.rtrim(
    pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.translate(
          pg_catalog.encode(body_bytes, 'base64'),
          '+/',
          '-_'
        ),
        pg_catalog.chr(10),
        ''
      ),
      pg_catalog.chr(13),
      ''
    ),
    '='
  );
  response_digest := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to('canonical-response@1.0.0', 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || pg_catalog.convert_to('application/json; charset=utf-8', 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || pg_catalog.convert_to('inline', 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || body_bytes,
      'sha256'
    ),
    'hex'
  );
  response_wire := pg_catalog.jsonb_build_object(
    'protocol_version', 'canonical-response@1.0.0',
    'media_type', 'application/json; charset=utf-8',
    'content_disposition', 'inline',
    'byte_length', pg_catalog.octet_length(body_bytes),
    'response_digest', response_digest,
    'body_base64url', body_base64url
  );
  response_binding := response_wire - 'body_base64url';
  response_wire_hash := app_data_agent.runtime_canonical_sha256(response_wire);
  expires_at := db_now + pg_catalog.make_interval(secs => 60);
  insert into app_data_agent.report_read_grants (
    app_id, tenant_id, environment, grant_id, run_id, principal_id,
    idempotency_key, issue_input_hash, certificate_ref, report_ref,
    response_wire, response_wire_hash, issue_readiness_version,
    issue_revocation_seq, issue_frontier_hash, authority_epoch, state,
    expires_at, issued_at
  )
  values (
    current_row.app_id, current_row.tenant_id, current_row.environment,
    requested_grant_id, current_row.run_id,
    (command_json ->> 'principal_id')::uuid,
    command_json ->> 'idempotency_key', input_hash, certificate_ref,
    current_row.report_ref, response_wire, response_wire_hash,
    current_row.readiness_version, current_row.revocation_seq,
    current_row.frontier_hash, current_row.authority_epoch, 'ISSUED',
    expires_at, db_now
  );
  insert into app_data_agent.research_readiness_consumptions (
    app_id, tenant_id, environment, consumption_id, run_id, principal_id,
    purpose, idempotency_key, input_hash, certificate_ref, report_ref,
    readiness_version, revocation_seq, frontier_hash, authority_epoch,
    outcome, terminal_id, grant_id, committed_at
  )
  values (
    current_row.app_id, current_row.tenant_id, current_row.environment,
    (command_json ->> 'consumption_id')::uuid, current_row.run_id,
    (command_json ->> 'principal_id')::uuid, 'REPORT_READ',
    command_json ->> 'idempotency_key', input_hash, certificate_ref,
    current_row.report_ref, current_row.readiness_version,
    current_row.revocation_seq, current_row.frontier_hash,
    current_row.authority_epoch, 'GRANT_ISSUED', null,
    requested_grant_id, db_now
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'purpose', 'REPORT_READ',
      'outcome', 'GRANT_ISSUED',
      'consumption_id', command_json ->> 'consumption_id',
      'current_state', 'CURRENT',
      'grant_id', requested_grant_id,
      'state', 'ISSUED',
      'response', response_binding
    )
  );
end
$function$;

create function app_data_agent.revoke_current_readiness(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  certificate_ref jsonb;
  certificate_document jsonb;
  current_row record;
  terminal_row record;
  operation_row record;
  semantic_frontier record;
  schema_frontier record;
  data_frontier record;
  policy_frontier record;
  identity_frontier record;
  input_hash text;
  observed_frontier jsonb;
  observed_frontier_hash text;
  observed_frontier_event_seq bigint;
  receipt_artifact_id uuid;
  receipt_payload jsonb;
  receipt_input_refs jsonb;
  receipt_envelope_material jsonb;
  receipt_envelope jsonb;
  receipt_document jsonb;
  receipt_content_hash text;
  receipt_commit jsonb;
  committed_receipt_ref jsonb;
  next_revocation_seq bigint;
  committed_at timestamptz;
  committed_at_text text;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 9
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'operation_id', 'certificate_ref',
        'observed_frontier_hash', 'reason'
      ]
    )
    or command_json ->> 'reason' is null
    or command_json ->> 'reason'
      not in ('EVIDENCE_REVOKED', 'CERTIFICATE_TAMPERED')
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  certificate_ref := command_json -> 'certificate_ref';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'SERVICE_REVOCATION_AUTHORITY', null, null, null, true
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-readiness-revocation-operation@1.0.0', command_json
  );

  perform 1
  from app_data_agent.runs as run
  where run.app_id = (scope_json ->> 'app_id')::uuid
    and run.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and run.environment = scope_json ->> 'environment'
    and run.run_id = (command_json ->> 'run_id')::uuid
  for update of run nowait;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH', 'retryable', false
      )
    );
  end if;

  receipt_artifact_id := app_data_agent.u6_uuid_v5(
    (command_json ->> 'operation_id')::uuid,
    pg_catalog.convert_to('readiness-revocation-receipt@1.0.0', 'UTF8')
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      app_data_agent.runtime_canonical_json(
        pg_catalog.jsonb_build_array(
          scope_json,
          command_json ->> 'run_id',
          receipt_artifact_id,
          'ReadinessRevocationReceipt'
        )
      ),
      0
    )
  );
  select artifact.document_json
  into certificate_document
  from app_data_agent.artifacts as artifact
  where artifact.app_id = (scope_json ->> 'app_id')::uuid
    and artifact.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and artifact.environment = scope_json ->> 'environment'
    and artifact.run_id = (command_json ->> 'run_id')::uuid
    and artifact.artifact_id = (certificate_ref ->> 'artifact_id')::uuid
    and artifact.artifact_type = 'ReportReadyCertificate'
    and artifact.revision = (certificate_ref ->> 'revision')::integer
    and artifact.content_hash = certificate_ref ->> 'content_hash'
    and artifact.is_active
  for update of artifact nowait;
  if certificate_document is null
    or certificate_document #>> '{payload,protocol_version}'
      is distinct from 'report-ready@3.0.0'
    or certificate_document #>> '{envelope,status}'
      is distinct from 'COMMITTED'
    or app_data_agent.runtime_canonical_sha256(
      pg_catalog.jsonb_build_object(
        'envelope',
          (certificate_document -> 'envelope')
            - 'content_hash' - 'created_at' - 'status',
        'payload', certificate_document -> 'payload'
      )
    ) <> certificate_ref ->> 'content_hash'
    or certificate_document #>> '{payload,certificate_semantic_hash}'
      <> app_data_agent.runtime_canonical_sha256(
        (certificate_document -> 'payload') - 'certificate_semantic_hash'
      )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT', 'retryable', false
      )
    );
  end if;

  select source.*
  into current_row
  from app_data_agent.current_report_readiness as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
  for update of source nowait;
  if current_row.run_id is null
    or current_row.certificate_ref is distinct from certificate_ref
    or current_row.certificate_semantic_hash
      <> certificate_document #>> '{payload,certificate_semantic_hash}'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT', 'retryable', false
      )
    );
  end if;

  perform 1
  from app_data_agent.research_version_frontiers as frontier
  where frontier.app_id = current_row.app_id
    and frontier.tenant_id = current_row.tenant_id
    and frontier.environment = current_row.environment
    and frontier.run_id = current_row.run_id
  order by case frontier.frontier_kind
    when 'SEMANTIC' then 1 when 'SCHEMA' then 2 when 'DATA' then 3
    when 'POLICY' then 4 when 'IDENTITY' then 5 end
  for update of frontier nowait;
  select source.* into semantic_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'SEMANTIC';
  select source.* into schema_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'SCHEMA';
  select source.* into data_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'DATA';
  select source.* into policy_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'POLICY';
  select source.* into identity_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
    and source.frontier_kind = 'IDENTITY';
  if semantic_frontier.frontier_kind is null
    or schema_frontier.frontier_kind is null
    or data_frontier.frontier_kind is null
    or policy_frontier.frontier_kind is null
    or identity_frontier.frontier_kind is null
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'READINESS_FRONTIER_INCOMPLETE', 'retryable', false
      )
    );
  end if;
  observed_frontier := pg_catalog.jsonb_build_object(
    'semantic_release_ref',
      semantic_frontier.frontier_value_json -> 'reference',
    'schema_snapshot_ref',
      schema_frontier.frontier_value_json -> 'reference',
    'data_snapshot',
      data_frontier.frontier_value_json -> 'data_snapshot',
    'policy_receipt_ref',
      policy_frontier.frontier_value_json -> 'reference',
    'identity_binding',
      identity_frontier.frontier_value_json -> 'identity_binding'
  );
  observed_frontier_hash := app_data_agent.u6_domain_sha256(
    'research-frontier-vector@1.0.0',
    pg_catalog.jsonb_build_object(
      'SEMANTIC', semantic_frontier.frontier_value_json,
      'SCHEMA', schema_frontier.frontier_value_json,
      'DATA', data_frontier.frontier_value_json,
      'POLICY', policy_frontier.frontier_value_json,
      'IDENTITY', identity_frontier.frontier_value_json
    )
  );
  if observed_frontier_hash <> command_json ->> 'observed_frontier_hash' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'READINESS_FRONTIER_STALE', 'retryable', false
      )
    );
  end if;
  observed_frontier_event_seq := pg_catalog.greatest(
    semantic_frontier.event_seq,
    schema_frontier.event_seq,
    data_frontier.event_seq,
    policy_frontier.event_seq,
    identity_frontier.event_seq
  );

  select source.*
  into terminal_row
  from app_data_agent.research_domain_terminals as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and source.run_id = current_row.run_id
  for update of source nowait;
  perform 1
  from app_data_agent.report_read_grants as grant_source
  where grant_source.app_id = current_row.app_id
    and grant_source.tenant_id = current_row.tenant_id
    and grant_source.environment = current_row.environment
    and grant_source.run_id = current_row.run_id
  order by grant_source.grant_id
  for update of grant_source nowait;
  select source.*
  into operation_row
  from app_data_agent.research_revocation_operations as source
  where source.app_id = current_row.app_id
    and source.tenant_id = current_row.tenant_id
    and source.environment = current_row.environment
    and (
      source.operation_id = (command_json ->> 'operation_id')::uuid
      or (
        source.run_id = current_row.run_id
        and source.owner_principal_id =
          (command_json ->> 'principal_id')::uuid
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  for update of source nowait;
  if operation_row.operation_id is not null then
    if operation_row.operation_id <> (command_json ->> 'operation_id')::uuid
      or operation_row.input_hash <> input_hash
      or operation_row.trigger_kind <> 'SERVICE_REQUEST'
      or operation_row.state <> 'COMMITTED'
      or operation_row.certificate_ref is distinct from certificate_ref
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'READINESS_IDEMPOTENCY_CONFLICT', 'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'operation_id', operation_row.operation_id,
        'state', 'REVOKED',
        'revocation_seq', current_row.revocation_seq,
        'receipt_ref', operation_row.receipt_ref
      )
    );
  end if;
  if current_row.state = 'REVOKED' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'CURRENT_READINESS_REVOKED', 'retryable', false
      )
    );
  end if;

  committed_at := pg_catalog.clock_timestamp();
  insert into app_data_agent.research_revocation_operations (
    app_id, tenant_id, environment, operation_id, run_id,
    owner_principal_id, idempotency_key, input_hash, trigger_kind,
    source_operation_id, reason, certificate_ref, observed_frontier_hash,
    authority_epoch, state
  )
  values (
    current_row.app_id, current_row.tenant_id, current_row.environment,
    (command_json ->> 'operation_id')::uuid, current_row.run_id,
    (command_json ->> 'principal_id')::uuid,
    command_json ->> 'idempotency_key', input_hash, 'SERVICE_REQUEST',
    (command_json ->> 'operation_id')::uuid, command_json ->> 'reason',
    certificate_ref, observed_frontier_hash,
    identity_frontier.authority_epoch, 'REQUESTED'
  );

  receipt_payload := pg_catalog.jsonb_build_object(
    'artifact_type', 'ReadinessRevocationReceipt',
    'protocol_version', 'readiness-revocation@1.0.0',
    'certificate_ref', certificate_ref,
    'observed_frontier', observed_frontier,
    'reason', command_json ->> 'reason',
    'trigger', 'SERVICE_REQUEST',
    'source_operation_id', command_json ->> 'operation_id',
    'observed_frontier_event_seq', observed_frontier_event_seq
  );
  receipt_payload := receipt_payload || pg_catalog.jsonb_build_object(
    'revocation_semantic_hash',
    app_data_agent.runtime_canonical_sha256(receipt_payload)
  );
  select pg_catalog.jsonb_agg(reference_value order by reference_identity)
  into receipt_input_refs
  from (
    select candidate.reference_value,
      app_data_agent.runtime_canonical_json(
        pg_catalog.jsonb_build_array(
          candidate.reference_value ->> 'app_id',
          candidate.reference_value ->> 'tenant_id',
          candidate.reference_value ->> 'environment',
          candidate.reference_value ->> 'run_id',
          candidate.reference_value ->> 'artifact_id',
          candidate.reference_value ->> 'artifact_type',
          candidate.reference_value -> 'revision',
          candidate.reference_value ->> 'content_hash'
        )
      ) as reference_identity
    from (
      values
        (certificate_ref),
        (observed_frontier -> 'semantic_release_ref'),
        (observed_frontier -> 'schema_snapshot_ref'),
        (observed_frontier -> 'policy_receipt_ref')
    ) as candidate(reference_value)
  ) as ordered_references;
  committed_at_text := pg_catalog.to_char(
    committed_at at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  receipt_envelope_material := pg_catalog.jsonb_build_object(
    'artifact_id', receipt_artifact_id,
    'artifact_type', 'ReadinessRevocationReceipt',
    'app_id', current_row.app_id,
    'tenant_id', current_row.tenant_id,
    'environment', current_row.environment,
    'run_id', current_row.run_id,
    'revision', 1,
    'parent_ref', null,
    'attempt_id', command_json ->> 'operation_id',
    'producer', pg_catalog.jsonb_build_object(
      'kind', 'deterministic',
      'id', 'u6-readiness-revocation-writer'
    ),
    'input_refs', receipt_input_refs,
    'schema_version', '1.0.0',
    'semantic_version', '1.0.0',
    'policy_version', '1.0.0',
    'model_profile_version', '1.0.0'
  );
  receipt_content_hash := app_data_agent.runtime_canonical_sha256(
    pg_catalog.jsonb_build_object(
      'envelope', receipt_envelope_material,
      'payload', receipt_payload
    )
  );
  receipt_envelope := receipt_envelope_material
    || pg_catalog.jsonb_build_object(
      'content_hash', receipt_content_hash,
      'status', 'COMMITTED',
      'created_at', committed_at_text
    );
  receipt_document := pg_catalog.jsonb_build_object(
    'envelope', receipt_envelope,
    'payload', receipt_payload
  );
  receipt_commit := app_data_agent.commit_research_revocation_receipt(
    pg_catalog.jsonb_build_object(
      'document', receipt_document,
      'document_checksum',
        app_data_agent.runtime_canonical_sha256(receipt_document)
    )
  );
  committed_receipt_ref := receipt_commit -> 'reference';
  if committed_receipt_ref is null then
    raise exception using
      errcode = '23514',
      message = 'DA_U6_READINESS_REVOCATION_PROPAGATION_FAILED';
  end if;

  next_revocation_seq := current_row.revocation_seq + 1;
  update app_data_agent.current_report_readiness
  set state = 'REVOKED',
      revocation_seq = next_revocation_seq,
      revocation_receipt_ref = committed_receipt_ref,
      revoked_at = committed_at,
      updated_at = committed_at
  where app_id = current_row.app_id
    and tenant_id = current_row.tenant_id
    and environment = current_row.environment
    and run_id = current_row.run_id
    and state = 'CURRENT';
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_U6_READINESS_REVOCATION_PROPAGATION_FAILED';
  end if;
  update app_data_agent.report_read_grants as target
  set state = 'REVOKED',
      terminal_from_status = target.state,
      revoked_at = committed_at
  where target.app_id = current_row.app_id
    and target.tenant_id = current_row.tenant_id
    and target.environment = current_row.environment
    and target.run_id = current_row.run_id
    and target.state in ('ISSUED', 'CONSUMED');
  update app_data_agent.research_revocation_operations
  set state = 'COMMITTED',
      receipt_ref = committed_receipt_ref,
      completed_at = committed_at
  where app_id = current_row.app_id
    and tenant_id = current_row.tenant_id
    and environment = current_row.environment
    and operation_id = (command_json ->> 'operation_id')::uuid
    and state = 'REQUESTED';
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_U6_READINESS_REVOCATION_PROPAGATION_FAILED';
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'operation_id', command_json ->> 'operation_id',
      'state', 'REVOKED',
      'revocation_seq', next_revocation_seq,
      'receipt_ref', committed_receipt_ref
    )
  );
end
$function$;

create function app_data_agent.consume_report_read_grant(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  input_hash text;
  grant_locator record;
  grant_row record;
  current_row record;
  terminal_row record;
  semantic_frontier record;
  schema_frontier record;
  data_frontier record;
  policy_frontier record;
  identity_frontier record;
  aggregate_frontier_hash text;
  locked_artifact_count bigint;
  decoded_body bytea;
  expected_response_digest text;
  db_now timestamptz;
  transition_at timestamptz;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 6
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'grant_id'
      ]
    )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'REPORT_READ_AUTHORITY', null, null, null, false
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'report-read-grant-consumption@1.0.0', command_json
  );

  perform 1
  from app_data_agent.runs as run
  where run.app_id = (scope_json ->> 'app_id')::uuid
    and run.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and run.environment = scope_json ->> 'environment'
    and run.run_id = (command_json ->> 'run_id')::uuid
  for update of run nowait;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH', 'retryable', false
      )
    );
  end if;

  -- Locator only; the row is re-locked at its frozen rank below.
  select source.*
  into grant_locator
  from app_data_agent.report_read_grants as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.grant_id = (command_json ->> 'grant_id')::uuid
    and source.run_id = (command_json ->> 'run_id')::uuid;
  if grant_locator.grant_id is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_GRANT_NOT_CONSUMABLE', 'retryable', false
      )
    );
  end if;
  perform 1
  from app_data_agent.artifacts as artifact
  where artifact.app_id = grant_locator.app_id
    and artifact.tenant_id = grant_locator.tenant_id
    and artifact.environment = grant_locator.environment
    and artifact.run_id = grant_locator.run_id
    and (
      (
        artifact.artifact_id =
          (grant_locator.certificate_ref ->> 'artifact_id')::uuid
        and artifact.artifact_type = 'ReportReadyCertificate'
        and artifact.revision =
          (grant_locator.certificate_ref ->> 'revision')::integer
        and artifact.content_hash =
          grant_locator.certificate_ref ->> 'content_hash'
      )
      or (
        artifact.artifact_id = (grant_locator.report_ref ->> 'artifact_id')::uuid
        and artifact.artifact_type = 'AnalysisReport'
        and artifact.revision = (grant_locator.report_ref ->> 'revision')::integer
        and artifact.content_hash = grant_locator.report_ref ->> 'content_hash'
      )
    )
    and artifact.is_active
  order by app_data_agent.runtime_canonical_json(
    pg_catalog.jsonb_build_array(
      artifact.app_id, artifact.tenant_id, artifact.environment,
      artifact.run_id, artifact.artifact_id, artifact.artifact_type,
      artifact.revision, artifact.content_hash
    )
  )
  for update of artifact nowait;
  get diagnostics locked_artifact_count = row_count;
  if locked_artifact_count <> 2 then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT', 'retryable', false
      )
    );
  end if;

  select source.*
  into current_row
  from app_data_agent.current_report_readiness as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
  for update of source nowait;
  perform 1
  from app_data_agent.research_version_frontiers as frontier
  where frontier.app_id = grant_locator.app_id
    and frontier.tenant_id = grant_locator.tenant_id
    and frontier.environment = grant_locator.environment
    and frontier.run_id = grant_locator.run_id
  order by case frontier.frontier_kind
    when 'SEMANTIC' then 1 when 'SCHEMA' then 2 when 'DATA' then 3
    when 'POLICY' then 4 when 'IDENTITY' then 5 end
  for update of frontier nowait;
  select source.* into semantic_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'SEMANTIC';
  select source.* into schema_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'SCHEMA';
  select source.* into data_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'DATA';
  select source.* into policy_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'POLICY';
  select source.* into identity_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'IDENTITY';
  if semantic_frontier.frontier_kind is null
    or schema_frontier.frontier_kind is null
    or data_frontier.frontier_kind is null
    or policy_frontier.frontier_kind is null
    or identity_frontier.frontier_kind is null
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'READINESS_FRONTIER_INCOMPLETE', 'retryable', false
      )
    );
  end if;
  aggregate_frontier_hash := app_data_agent.u6_domain_sha256(
    'research-frontier-vector@1.0.0',
    pg_catalog.jsonb_build_object(
      'SEMANTIC', semantic_frontier.frontier_value_json,
      'SCHEMA', schema_frontier.frontier_value_json,
      'DATA', data_frontier.frontier_value_json,
      'POLICY', policy_frontier.frontier_value_json,
      'IDENTITY', identity_frontier.frontier_value_json
    )
  );
  select source.*
  into terminal_row
  from app_data_agent.research_domain_terminals as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
  for update of source nowait;
  select source.*
  into grant_row
  from app_data_agent.report_read_grants as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.grant_id = grant_locator.grant_id
  for update of source nowait;
  if grant_row.grant_id is null
    or grant_row.principal_id <> (command_json ->> 'principal_id')::uuid
    or current_row.run_id is null
    or current_row.state <> 'CURRENT'
    or current_row.certificate_ref is distinct from grant_row.certificate_ref
    or current_row.report_ref is distinct from grant_row.report_ref
    or current_row.readiness_version <> grant_row.issue_readiness_version
    or current_row.revocation_seq <> grant_row.issue_revocation_seq
    or current_row.frontier_hash <> aggregate_frontier_hash
    or current_row.frontier_hash <> grant_row.issue_frontier_hash
    or current_row.authority_epoch <> grant_row.authority_epoch
    or current_row.authority_epoch <> identity_frontier.authority_epoch
    or terminal_row.terminal is distinct from 'READY'
    or terminal_row.certificate_ref is distinct from grant_row.certificate_ref
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code',
        case
          when current_row.state = 'REVOKED' or grant_row.state = 'REVOKED'
            then 'REPORT_READ_GRANT_REVOKED'
          else 'AUTHORITY_EVIDENCE_NOT_CURRENT'
        end,
        'retryable', false
      )
    );
  end if;

  db_now := pg_catalog.clock_timestamp();
  if db_now >= grant_row.expires_at or grant_row.state = 'EXPIRED' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_GRANT_EXPIRED', 'retryable', false
      )
    );
  end if;
  decoded_body := app_data_agent.u6_strict_base64url_decode(
    grant_row.response_wire ->> 'body_base64url'
  );
  expected_response_digest := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to('canonical-response@1.0.0', 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || pg_catalog.convert_to('application/json; charset=utf-8', 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || pg_catalog.convert_to('inline', 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || decoded_body,
      'sha256'
    ),
    'hex'
  );
  if grant_row.response_wire_hash
      <> app_data_agent.runtime_canonical_sha256(grant_row.response_wire)
    or grant_row.response_wire ->> 'protocol_version'
      is distinct from 'canonical-response@1.0.0'
    or grant_row.response_wire ->> 'media_type'
      is distinct from 'application/json; charset=utf-8'
    or grant_row.response_wire ->> 'content_disposition'
      is distinct from 'inline'
    or (grant_row.response_wire ->> 'byte_length')::bigint
      <> pg_catalog.octet_length(decoded_body)
    or grant_row.response_wire ->> 'response_digest'
      <> expected_response_digest
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_RESPONSE_DIGEST_MISMATCH', 'retryable', false
      )
    );
  end if;

  if grant_row.state in ('CONSUMED', 'RESPONDED')
    and grant_row.consume_idempotency_key =
      command_json ->> 'idempotency_key'
    and grant_row.consume_input_hash = input_hash
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'grant_id', grant_row.grant_id,
        'state', 'CONSUMED',
        'report_ref', grant_row.report_ref,
        'response', grant_row.response_wire - 'body_base64url',
        'consumed_at', grant_row.consumed_at
      )
    );
  end if;
  if grant_row.state <> 'ISSUED' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code',
        case when grant_row.state = 'REVOKED'
          then 'REPORT_READ_GRANT_REVOKED'
          else 'REPORT_READ_GRANT_NOT_CONSUMABLE' end,
        'retryable', false
      )
    );
  end if;
  transition_at := db_now;
  update app_data_agent.report_read_grants
  set state = 'CONSUMED',
      consume_idempotency_key = command_json ->> 'idempotency_key',
      consume_input_hash = input_hash,
      consumed_at = transition_at
  where app_id = grant_row.app_id
    and tenant_id = grant_row.tenant_id
    and environment = grant_row.environment
    and grant_id = grant_row.grant_id
    and state = 'ISSUED';
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_GRANT_NOT_CONSUMABLE', 'retryable', false
      )
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'grant_id', grant_row.grant_id,
      'state', 'CONSUMED',
      'report_ref', grant_row.report_ref,
      'response', grant_row.response_wire - 'body_base64url',
      'consumed_at', transition_at
    )
  );
end
$function$;

create function app_data_agent.expire_report_read_grant(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  input_hash text;
  current_row record;
  terminal_row record;
  grant_row record;
  operation_row record;
  db_now timestamptz;
  source_state text;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 9
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'operation_id', 'grant_id',
        'expected_state', 'reason_code'
      ]
    )
    or command_json ->> 'expected_state' is null
    or command_json ->> 'expected_state' not in ('ISSUED', 'CONSUMED')
    or command_json ->> 'reason_code'
      is distinct from 'REPORT_READ_GRANT_TTL_EXPIRED'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'REPORT_READ_EXPIRY_AUTHORITY', null, null, null, true
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'report-read-grant-expiration@1.0.0', command_json
  );

  perform 1
  from app_data_agent.runs as run
  where run.app_id = (scope_json ->> 'app_id')::uuid
    and run.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and run.environment = scope_json ->> 'environment'
    and run.run_id = (command_json ->> 'run_id')::uuid
  for update of run nowait;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH', 'retryable', false
      )
    );
  end if;
  select source.*
  into current_row
  from app_data_agent.current_report_readiness as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
  for update of source nowait;
  perform 1
  from app_data_agent.research_version_frontiers as frontier
  where frontier.app_id = (scope_json ->> 'app_id')::uuid
    and frontier.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and frontier.environment = scope_json ->> 'environment'
    and frontier.run_id = (command_json ->> 'run_id')::uuid
  order by case frontier.frontier_kind
    when 'SEMANTIC' then 1 when 'SCHEMA' then 2 when 'DATA' then 3
    when 'POLICY' then 4 when 'IDENTITY' then 5 end
  for update of frontier nowait;
  select source.*
  into terminal_row
  from app_data_agent.research_domain_terminals as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
  for update of source nowait;
  select source.*
  into grant_row
  from app_data_agent.report_read_grants as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.grant_id = (command_json ->> 'grant_id')::uuid
    and source.run_id = (command_json ->> 'run_id')::uuid
  for update of source nowait;
  select source.*
  into operation_row
  from app_data_agent.report_read_grant_expiration_operations as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and (
      source.operation_id = (command_json ->> 'operation_id')::uuid
      or (
        source.grant_id = (command_json ->> 'grant_id')::uuid
        and source.principal_id =
          (command_json ->> 'principal_id')::uuid
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  for update of source nowait;
  if operation_row.operation_id is not null then
    if operation_row.operation_id <> (command_json ->> 'operation_id')::uuid
      or operation_row.input_hash <> input_hash
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'READINESS_IDEMPOTENCY_CONFLICT', 'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'operation_id', operation_row.operation_id,
        'grant_id', operation_row.grant_id,
        'state', 'EXPIRED',
        'terminal_from_status', operation_row.source_state,
        'expired_at', operation_row.committed_at
      )
    );
  end if;
  if grant_row.grant_id is null
    or grant_row.state = 'REVOKED'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code',
        case when grant_row.state = 'REVOKED'
          then 'REPORT_READ_GRANT_REVOKED'
          else 'REPORT_READ_GRANT_NOT_CONSUMABLE' end,
        'retryable', false
      )
    );
  end if;
  source_state := grant_row.state;
  if source_state <> command_json ->> 'expected_state' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_GRANT_NOT_CONSUMABLE', 'retryable', false
      )
    );
  end if;
  db_now := pg_catalog.clock_timestamp();
  if db_now < grant_row.expires_at then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_GRANT_NOT_CONSUMABLE', 'retryable', false
      )
    );
  end if;

  update app_data_agent.report_read_grants
  set state = 'EXPIRED',
      terminal_from_status = source_state,
      expired_at = db_now
  where app_id = grant_row.app_id
    and tenant_id = grant_row.tenant_id
    and environment = grant_row.environment
    and grant_id = grant_row.grant_id
    and state = source_state;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_GRANT_NOT_CONSUMABLE', 'retryable', false
      )
    );
  end if;
  insert into app_data_agent.report_read_grant_expiration_operations (
    app_id, tenant_id, environment, operation_id, grant_id, principal_id,
    idempotency_key, input_hash, expected_state, source_state, committed_at
  )
  values (
    grant_row.app_id, grant_row.tenant_id, grant_row.environment,
    (command_json ->> 'operation_id')::uuid, grant_row.grant_id,
    (command_json ->> 'principal_id')::uuid,
    command_json ->> 'idempotency_key', input_hash,
    command_json ->> 'expected_state', source_state, db_now
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'operation_id', command_json ->> 'operation_id',
      'grant_id', grant_row.grant_id,
      'state', 'EXPIRED',
      'terminal_from_status', source_state,
      'expired_at', db_now
    )
  );
end
$function$;

create function app_data_agent.commit_report_read_response(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  input_hash text;
  grant_locator record;
  grant_row record;
  current_row record;
  terminal_row record;
  semantic_frontier record;
  schema_frontier record;
  data_frontier record;
  policy_frontier record;
  identity_frontier record;
  aggregate_frontier_hash text;
  locked_artifact_count bigint;
  report_document jsonb;
  body_bytes bytea;
  body_base64url text;
  response_digest text;
  expected_response_wire jsonb;
  expected_response_wire_hash text;
  db_now timestamptz;
  response_at timestamptz;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 6
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'grant_id'
      ]
    )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'REPORT_READ_AUTHORITY', null, null, null, false
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'report-read-response-commit@1.0.0', command_json
  );

  perform 1
  from app_data_agent.runs as run
  where run.app_id = (scope_json ->> 'app_id')::uuid
    and run.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and run.environment = scope_json ->> 'environment'
    and run.run_id = (command_json ->> 'run_id')::uuid
  for update of run nowait;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH', 'retryable', false
      )
    );
  end if;
  select source.*
  into grant_locator
  from app_data_agent.report_read_grants as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.grant_id = (command_json ->> 'grant_id')::uuid
    and source.run_id = (command_json ->> 'run_id')::uuid;
  if grant_locator.grant_id is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_GRANT_NOT_CONSUMABLE', 'retryable', false
      )
    );
  end if;
  perform 1
  from app_data_agent.artifacts as artifact
  where artifact.app_id = grant_locator.app_id
    and artifact.tenant_id = grant_locator.tenant_id
    and artifact.environment = grant_locator.environment
    and artifact.run_id = grant_locator.run_id
    and (
      (
        artifact.artifact_id =
          (grant_locator.certificate_ref ->> 'artifact_id')::uuid
        and artifact.artifact_type = 'ReportReadyCertificate'
        and artifact.revision =
          (grant_locator.certificate_ref ->> 'revision')::integer
        and artifact.content_hash =
          grant_locator.certificate_ref ->> 'content_hash'
      )
      or (
        artifact.artifact_id = (grant_locator.report_ref ->> 'artifact_id')::uuid
        and artifact.artifact_type = 'AnalysisReport'
        and artifact.revision = (grant_locator.report_ref ->> 'revision')::integer
        and artifact.content_hash = grant_locator.report_ref ->> 'content_hash'
      )
    )
    and artifact.is_active
  order by app_data_agent.runtime_canonical_json(
    pg_catalog.jsonb_build_array(
      artifact.app_id, artifact.tenant_id, artifact.environment,
      artifact.run_id, artifact.artifact_id, artifact.artifact_type,
      artifact.revision, artifact.content_hash
    )
  )
  for update of artifact nowait;
  get diagnostics locked_artifact_count = row_count;
  if locked_artifact_count <> 2 then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT', 'retryable', false
      )
    );
  end if;
  select artifact.document_json
  into report_document
  from app_data_agent.artifacts as artifact
  where artifact.app_id = grant_locator.app_id
    and artifact.tenant_id = grant_locator.tenant_id
    and artifact.environment = grant_locator.environment
    and artifact.run_id = grant_locator.run_id
    and artifact.artifact_id = (grant_locator.report_ref ->> 'artifact_id')::uuid
    and artifact.artifact_type = 'AnalysisReport'
    and artifact.revision = (grant_locator.report_ref ->> 'revision')::integer
    and artifact.content_hash = grant_locator.report_ref ->> 'content_hash'
    and artifact.is_active;
  if report_document is null
    or report_document #>> '{payload,protocol_version}'
      is distinct from 'analysis-report@2.0.0'
    or report_document #>> '{envelope,status}' is distinct from 'COMMITTED'
    or app_data_agent.runtime_canonical_sha256(
      pg_catalog.jsonb_build_object(
        'envelope',
          (report_document -> 'envelope')
            - 'content_hash' - 'created_at' - 'status',
        'payload', report_document -> 'payload'
      )
    ) <> grant_locator.report_ref ->> 'content_hash'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT', 'retryable', false
      )
    );
  end if;

  select source.*
  into current_row
  from app_data_agent.current_report_readiness as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
  for update of source nowait;
  perform 1
  from app_data_agent.research_version_frontiers as frontier
  where frontier.app_id = grant_locator.app_id
    and frontier.tenant_id = grant_locator.tenant_id
    and frontier.environment = grant_locator.environment
    and frontier.run_id = grant_locator.run_id
  order by case frontier.frontier_kind
    when 'SEMANTIC' then 1 when 'SCHEMA' then 2 when 'DATA' then 3
    when 'POLICY' then 4 when 'IDENTITY' then 5 end
  for update of frontier nowait;
  select source.* into semantic_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'SEMANTIC';
  select source.* into schema_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'SCHEMA';
  select source.* into data_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'DATA';
  select source.* into policy_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'POLICY';
  select source.* into identity_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
    and source.frontier_kind = 'IDENTITY';
  if semantic_frontier.frontier_kind is null
    or schema_frontier.frontier_kind is null
    or data_frontier.frontier_kind is null
    or policy_frontier.frontier_kind is null
    or identity_frontier.frontier_kind is null
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'READINESS_FRONTIER_INCOMPLETE', 'retryable', false
      )
    );
  end if;
  aggregate_frontier_hash := app_data_agent.u6_domain_sha256(
    'research-frontier-vector@1.0.0',
    pg_catalog.jsonb_build_object(
      'SEMANTIC', semantic_frontier.frontier_value_json,
      'SCHEMA', schema_frontier.frontier_value_json,
      'DATA', data_frontier.frontier_value_json,
      'POLICY', policy_frontier.frontier_value_json,
      'IDENTITY', identity_frontier.frontier_value_json
    )
  );
  select source.*
  into terminal_row
  from app_data_agent.research_domain_terminals as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.run_id = grant_locator.run_id
  for update of source nowait;
  select source.*
  into grant_row
  from app_data_agent.report_read_grants as source
  where source.app_id = grant_locator.app_id
    and source.tenant_id = grant_locator.tenant_id
    and source.environment = grant_locator.environment
    and source.grant_id = grant_locator.grant_id
  for update of source nowait;
  if grant_row.grant_id is null
    or grant_row.principal_id <> (command_json ->> 'principal_id')::uuid
    or current_row.run_id is null
    or current_row.state <> 'CURRENT'
    or current_row.certificate_ref is distinct from grant_row.certificate_ref
    or current_row.report_ref is distinct from grant_row.report_ref
    or current_row.readiness_version <> grant_row.issue_readiness_version
    or current_row.revocation_seq <> grant_row.issue_revocation_seq
    or current_row.frontier_hash <> aggregate_frontier_hash
    or current_row.frontier_hash <> grant_row.issue_frontier_hash
    or current_row.authority_epoch <> grant_row.authority_epoch
    or current_row.authority_epoch <> identity_frontier.authority_epoch
    or terminal_row.terminal is distinct from 'READY'
    or terminal_row.certificate_ref is distinct from grant_row.certificate_ref
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code',
        case
          when current_row.state = 'REVOKED' or grant_row.state = 'REVOKED'
            then 'REPORT_READ_GRANT_REVOKED'
          else 'AUTHORITY_EVIDENCE_NOT_CURRENT'
        end,
        'retryable', false
      )
    );
  end if;
  db_now := pg_catalog.clock_timestamp();
  if db_now >= grant_row.expires_at or grant_row.state = 'EXPIRED' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_GRANT_EXPIRED', 'retryable', false
      )
    );
  end if;

  body_bytes := pg_catalog.convert_to(
    app_data_agent.runtime_canonical_json(report_document -> 'payload'),
    'UTF8'
  );
  if pg_catalog.octet_length(body_bytes) > 1048576 then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_RESPONSE_DIGEST_MISMATCH', 'retryable', false
      )
    );
  end if;
  body_base64url := pg_catalog.rtrim(
    pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.translate(
          pg_catalog.encode(body_bytes, 'base64'),
          '+/',
          '-_'
        ),
        pg_catalog.chr(10),
        ''
      ),
      pg_catalog.chr(13),
      ''
    ),
    '='
  );
  response_digest := 'sha256:' || pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to('canonical-response@1.0.0', 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || pg_catalog.convert_to('application/json; charset=utf-8', 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || pg_catalog.convert_to('inline', 'UTF8')
      || pg_catalog.decode('00', 'hex')
      || body_bytes,
      'sha256'
    ),
    'hex'
  );
  expected_response_wire := pg_catalog.jsonb_build_object(
    'protocol_version', 'canonical-response@1.0.0',
    'media_type', 'application/json; charset=utf-8',
    'content_disposition', 'inline',
    'byte_length', pg_catalog.octet_length(body_bytes),
    'response_digest', response_digest,
    'body_base64url', body_base64url
  );
  expected_response_wire_hash :=
    app_data_agent.runtime_canonical_sha256(expected_response_wire);
  if grant_row.response_wire is distinct from expected_response_wire
    or grant_row.response_wire_hash <> expected_response_wire_hash
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_RESPONSE_DIGEST_MISMATCH', 'retryable', false
      )
    );
  end if;

  if grant_row.state = 'RESPONDED'
    and grant_row.response_idempotency_key =
      command_json ->> 'idempotency_key'
    and grant_row.response_input_hash = input_hash
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'grant_id', grant_row.grant_id,
        'state', 'RESPONDED',
        'response', expected_response_wire,
        'responded_at', grant_row.responded_at
      )
    );
  end if;
  if grant_row.state <> 'CONSUMED' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code',
        case when grant_row.state = 'REVOKED'
          then 'REPORT_READ_GRANT_REVOKED'
          else 'REPORT_READ_GRANT_NOT_CONSUMABLE' end,
        'retryable', false
      )
    );
  end if;
  response_at := db_now;
  update app_data_agent.report_read_grants
  set state = 'RESPONDED',
      response_idempotency_key = command_json ->> 'idempotency_key',
      response_input_hash = input_hash,
      responded_at = response_at
  where app_id = grant_row.app_id
    and tenant_id = grant_row.tenant_id
    and environment = grant_row.environment
    and grant_id = grant_row.grant_id
    and state = 'CONSUMED';
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READ_GRANT_NOT_CONSUMABLE', 'retryable', false
      )
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'grant_id', grant_row.grant_id,
      'state', 'RESPONDED',
      'response', expected_response_wire,
      'responded_at', response_at
    )
  );
end
$function$;

create function app_data_agent.commit_current_release_go(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 16
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'decision_id', 'decision', 'certificate_ref',
        'release_manifest_ref', 'scorecard_refs',
        'benchmark_receipt_refs', 'sandbox_receipt_refs',
        'model_certification_receipt_refs', 'signed_outcome_refs',
        'release_policy_version', 'candidate_input_hash'
      ]
    )
    or command_json ->> 'decision' is distinct from 'GO'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;

  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'RELEASE_GO_AUTHORITY', null, null, null, true
  );

  -- U6 freezes the GO wire and lock surface, but the authoritative U7-U9
  -- release-evidence and signed-outcome verifier does not exist in this
  -- migration. Failing closed here is the only honest state: no row is ever
  -- inserted into research_release_decision_commits until that verifier is
  -- delivered and independently certified.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'CURRENT_RELEASE_COMMIT_REQUIRED', 'retryable', false
    )
  );
end
$function$;

create function app_data_agent.commit_research_stop_terminal(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  stop_ref jsonb;
  coverage_ref jsonb;
  stop_document jsonb;
  stop_payload jsonb;
  coverage_document jsonb;
  requested_terminal text;
  requested_reason text;
  input_hash text;
  existing_commit record;
  existing_terminal record;
  committed_at timestamptz;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 9
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  stop_ref := command_json -> 'stop_decision_ref';
  coverage_ref := command_json -> 'coverage_ref';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'RESEARCH_STOP_AUTHORITY', null, null, null, true
  );
  -- The Stop payload contains derived assessments but not the DB-owned
  -- CandidateEnumerationReceipt and BudgetLedgerReceipt needed to replay the
  -- mutually exclusive decision tree. Never turn self-reported JSON into an
  -- immutable public terminal.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_STOP_INPUT_INCONSISTENT', 'retryable', false
    )
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-stop-terminal-commit@1.0.0', command_json
  );

  perform 1
  from app_data_agent.runs as run
  where run.app_id = (scope_json ->> 'app_id')::uuid
    and run.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and run.environment = scope_json ->> 'environment'
    and run.run_id = (command_json ->> 'run_id')::uuid
    and run.principal_id = (command_json ->> 'principal_id')::uuid
  for update of run nowait;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH', 'retryable', false
      )
    );
  end if;

  select source.*
  into existing_commit
  from app_data_agent.research_stop_terminal_commits as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and (
      source.commit_id = (command_json ->> 'commit_id')::uuid
      or (
        source.run_id = (command_json ->> 'run_id')::uuid
        and source.principal_id = (command_json ->> 'principal_id')::uuid
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  for update of source nowait;
  if existing_commit.commit_id is not null then
    if existing_commit.input_hash <> input_hash
      or existing_commit.commit_id <> (command_json ->> 'commit_id')::uuid
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'READINESS_IDEMPOTENCY_CONFLICT', 'retryable', false
        )
      );
    end if;
    select source.*
    into existing_terminal
    from app_data_agent.research_domain_terminals as source
    where source.app_id = existing_commit.app_id
      and source.tenant_id = existing_commit.tenant_id
      and source.environment = existing_commit.environment
      and source.run_id = existing_commit.run_id;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'commit_id', existing_commit.commit_id,
        'terminal_id', existing_terminal.terminal_id,
        'terminal', existing_terminal.terminal,
        'reason_code', existing_terminal.reason_code,
        'domain_reason_codes', existing_terminal.domain_reason_codes,
        'authority_kind', 'RESEARCH_STOP',
        'certificate_ref', null,
        'revocation_receipt_ref', null,
        'stop_decision_ref', existing_terminal.stop_decision_ref,
        'committed_at', existing_terminal.committed_at
      )
    );
  end if;

  perform 1
  from app_data_agent.current_report_readiness as current
  where current.app_id = (scope_json ->> 'app_id')::uuid
    and current.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and current.environment = scope_json ->> 'environment'
    and current.run_id = (command_json ->> 'run_id')::uuid
  for update of current nowait;
  if found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_STOP_INPUT_INCONSISTENT', 'retryable', false
      )
    );
  end if;
  perform 1
  from app_data_agent.research_domain_terminals as terminal
  where terminal.app_id = (scope_json ->> 'app_id')::uuid
    and terminal.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and terminal.environment = scope_json ->> 'environment'
    and terminal.run_id = (command_json ->> 'run_id')::uuid
  for update of terminal nowait;
  if found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_STOP_TERMINAL_COMMIT_REQUIRED', 'retryable', false
      )
    );
  end if;

  select artifact.document_json
  into stop_document
  from app_data_agent.artifacts as artifact
  where artifact.app_id = (stop_ref ->> 'app_id')::uuid
    and artifact.tenant_id = (stop_ref ->> 'tenant_id')::uuid
    and artifact.environment = stop_ref ->> 'environment'
    and artifact.run_id = (stop_ref ->> 'run_id')::uuid
    and artifact.artifact_id = (stop_ref ->> 'artifact_id')::uuid
    and artifact.artifact_type = 'ResearchStopDecision'
    and artifact.revision = (stop_ref ->> 'revision')::integer
    and artifact.content_hash = stop_ref ->> 'content_hash'
    and artifact.is_active
  for update of artifact nowait;
  select artifact.document_json
  into coverage_document
  from app_data_agent.artifacts as artifact
  where artifact.app_id = (coverage_ref ->> 'app_id')::uuid
    and artifact.tenant_id = (coverage_ref ->> 'tenant_id')::uuid
    and artifact.environment = coverage_ref ->> 'environment'
    and artifact.run_id = (coverage_ref ->> 'run_id')::uuid
    and artifact.artifact_id = (coverage_ref ->> 'artifact_id')::uuid
    and artifact.artifact_type = 'CoverageState'
    and artifact.revision = (coverage_ref ->> 'revision')::integer
    and artifact.content_hash = coverage_ref ->> 'content_hash'
    and artifact.is_active
  for update of artifact nowait;
  if stop_document is null
    or coverage_document is null
    or stop_document #> '{payload,coverage_ref}' is distinct from coverage_ref
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT', 'retryable', false
      )
    );
  end if;
  stop_payload := stop_document -> 'payload';
  select mapped.terminal, mapped.reason_code
  into requested_terminal, requested_reason
  from (
    values
      ('STOP_PARTIAL', 'PARTIAL', 'EVIDENCE_PARTIAL'),
      (
        'STOP_NEEDS_MORE_RESEARCH',
        'NEEDS_MORE_RESEARCH',
        'EVIDENCE_COVERAGE_INSUFFICIENT'
      ),
      ('STOP_INCONCLUSIVE', 'INCONCLUSIVE', 'ANALYSIS_INCONCLUSIVE')
  ) as mapped(decision, terminal, reason_code)
  where mapped.decision = stop_payload ->> 'decision';
  if requested_terminal is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_STOP_INPUT_INCONSISTENT', 'retryable', false
      )
    );
  end if;
  committed_at := pg_catalog.clock_timestamp();
  insert into app_data_agent.research_domain_terminals (
    app_id, tenant_id, environment, run_id, terminal_id, terminal,
    authority_kind, reason_code, domain_reason_codes, certificate_ref,
    revocation_receipt_ref, stop_decision_ref, coverage_ref, input_hash,
    committed_at
  )
  values (
    (scope_json ->> 'app_id')::uuid, (scope_json ->> 'tenant_id')::uuid,
    scope_json ->> 'environment', (command_json ->> 'run_id')::uuid,
    (command_json ->> 'terminal_id')::uuid, requested_terminal,
    'RESEARCH_STOP', requested_reason, stop_payload -> 'reason_codes',
    null, null, stop_ref, coverage_ref, input_hash, committed_at
  );
  insert into app_data_agent.research_stop_terminal_commits (
    app_id, tenant_id, environment, commit_id, run_id, principal_id,
    idempotency_key, input_hash, stop_decision_ref, coverage_ref, terminal_id
  )
  values (
    (scope_json ->> 'app_id')::uuid, (scope_json ->> 'tenant_id')::uuid,
    scope_json ->> 'environment', (command_json ->> 'commit_id')::uuid,
    (command_json ->> 'run_id')::uuid, (command_json ->> 'principal_id')::uuid,
    command_json ->> 'idempotency_key', input_hash, stop_ref, coverage_ref,
    (command_json ->> 'terminal_id')::uuid
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'commit_id', command_json ->> 'commit_id',
      'terminal_id', command_json ->> 'terminal_id',
      'terminal', requested_terminal,
      'reason_code', requested_reason,
      'domain_reason_codes', stop_payload -> 'reason_codes',
      'authority_kind', 'RESEARCH_STOP',
      'certificate_ref', null,
      'revocation_receipt_ref', null,
      'stop_decision_ref', stop_ref,
      'committed_at', committed_at
    )
  );
end
$function$;

create function app_data_agent.publish_current_report_readiness(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  certificate_ref jsonb;
  certificate_document jsonb;
  certificate_payload jsonb;
  report_ref jsonb;
  current_row record;
  publication_row record;
  terminal_row record;
  semantic_frontier record;
  schema_frontier record;
  data_frontier record;
  policy_frontier record;
  identity_frontier record;
  aggregate_frontier_hash text;
  input_hash text;
  next_readiness_version bigint;
  preserved_revocation_seq bigint;
  committed_at timestamptz;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 8
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  certificate_ref := command_json -> 'certificate_ref';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'CURRENT_READINESS_AUTHORITY', null, null, null, true
  );
  -- Current Coverage does not yet bind the DB-owned derivation receipts and
  -- the Certificate input-event watermark has no PostgreSQL authority source.
  -- Publishing CURRENT from a shallow self-hash would make forged READY
  -- reachable, therefore publication remains explicitly fail closed.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_DATABASE_AUTHORITY_REQUIRED', 'retryable', false
    )
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-readiness-publication@1.0.0', command_json
  );

  perform 1
  from app_data_agent.runs as run
  where run.app_id = (scope_json ->> 'app_id')::uuid
    and run.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and run.environment = scope_json ->> 'environment'
    and run.run_id = (command_json ->> 'run_id')::uuid
    and run.principal_id = (command_json ->> 'principal_id')::uuid
  for update of run nowait;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH', 'retryable', false
      )
    );
  end if;

  select source.*
  into terminal_row
  from app_data_agent.research_domain_terminals as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
  for update of source nowait;
  if terminal_row.run_id is not null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_STOP_INPUT_INCONSISTENT', 'retryable', false
      )
    );
  end if;

  select source.*
  into current_row
  from app_data_agent.current_report_readiness as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
  for update of source nowait;

  select source.*
  into semantic_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.frontier_kind = 'SEMANTIC'
  for update of source nowait;
  select source.* into schema_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.frontier_kind = 'SCHEMA'
  for update of source nowait;
  select source.* into data_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.frontier_kind = 'DATA'
  for update of source nowait;
  select source.* into policy_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.frontier_kind = 'POLICY'
  for update of source nowait;
  select source.* into identity_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.frontier_kind = 'IDENTITY'
  for update of source nowait;
  if semantic_frontier.frontier_kind is null
    or schema_frontier.frontier_kind is null
    or data_frontier.frontier_kind is null
    or policy_frontier.frontier_kind is null
    or identity_frontier.frontier_kind is null
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'READINESS_FRONTIER_INCOMPLETE', 'retryable', false
      )
    );
  end if;

  select artifact.document_json
  into certificate_document
  from app_data_agent.artifacts as artifact
  where artifact.app_id = (certificate_ref ->> 'app_id')::uuid
    and artifact.tenant_id = (certificate_ref ->> 'tenant_id')::uuid
    and artifact.environment = certificate_ref ->> 'environment'
    and artifact.run_id = (certificate_ref ->> 'run_id')::uuid
    and artifact.artifact_id = (certificate_ref ->> 'artifact_id')::uuid
    and artifact.artifact_type = 'ReportReadyCertificate'
    and artifact.revision = (certificate_ref ->> 'revision')::integer
    and artifact.content_hash = certificate_ref ->> 'content_hash'
    and artifact.is_active
  for update of artifact nowait;
  certificate_payload := certificate_document -> 'payload';
  if certificate_document is null
    or certificate_payload ->> 'protocol_version'
      is distinct from 'report-ready@3.0.0'
    or certificate_payload -> 'version_frontier' -> 'semantic_release_ref'
      is distinct from semantic_frontier.frontier_value_json -> 'reference'
    or certificate_payload -> 'version_frontier' -> 'schema_snapshot_ref'
      is distinct from schema_frontier.frontier_value_json -> 'reference'
    or certificate_payload -> 'version_frontier' -> 'data_snapshot'
      is distinct from data_frontier.frontier_value_json -> 'data_snapshot'
    or certificate_payload -> 'version_frontier' -> 'policy_receipt_ref'
      is distinct from policy_frontier.frontier_value_json -> 'reference'
    or certificate_payload -> 'version_frontier' -> 'identity_binding'
      is distinct from identity_frontier.frontier_value_json -> 'identity_binding'
    or certificate_payload ->> 'certificate_semantic_hash'
      <> app_data_agent.runtime_canonical_sha256(
        certificate_payload - 'certificate_semantic_hash'
      )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'REPORT_READY_CERTIFICATE_TAMPERED', 'retryable', false
      )
    );
  end if;
  report_ref := certificate_payload -> 'analysis_report_ref';
  aggregate_frontier_hash := app_data_agent.u6_domain_sha256(
    'research-frontier-vector@1.0.0',
    pg_catalog.jsonb_build_object(
      'SEMANTIC', semantic_frontier.frontier_value_json,
      'SCHEMA', schema_frontier.frontier_value_json,
      'DATA', data_frontier.frontier_value_json,
      'POLICY', policy_frontier.frontier_value_json,
      'IDENTITY', identity_frontier.frontier_value_json
    )
  );

  select source.*
  into publication_row
  from app_data_agent.research_readiness_publications as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and (
      source.publication_id = (command_json ->> 'publication_id')::uuid
      or (
        source.run_id = (command_json ->> 'run_id')::uuid
        and source.principal_id = (command_json ->> 'principal_id')::uuid
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  for update of source nowait;
  if publication_row.publication_id is not null then
    if publication_row.input_hash <> input_hash
      or current_row.state <> 'CURRENT'
      or current_row.certificate_ref is distinct from certificate_ref
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code',
          case when current_row.state = 'REVOKED'
            then 'CURRENT_READINESS_REVOKED'
            else 'READINESS_IDEMPOTENCY_CONFLICT' end,
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'state', 'CURRENT',
        'certificate_ref', current_row.certificate_ref,
        'report_ref', current_row.report_ref,
        'readiness_version', current_row.readiness_version,
        'revocation_seq', current_row.revocation_seq,
        'frontier_hash', current_row.frontier_hash
      )
    );
  end if;
  if exists (
    select 1
    from app_data_agent.research_revocation_operations as operation
    where operation.app_id = (scope_json ->> 'app_id')::uuid
      and operation.tenant_id = (scope_json ->> 'tenant_id')::uuid
      and operation.environment = scope_json ->> 'environment'
      and operation.certificate_ref = certificate_ref
      and operation.state = 'COMMITTED'
  ) then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'CURRENT_READINESS_REVOKED', 'retryable', false
      )
    );
  end if;
  if current_row.run_id is null then
    if command_json -> 'expected_readiness_version' <> 'null'::jsonb then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'READINESS_CAS_CONFLICT', 'retryable', true
        )
      );
    end if;
    next_readiness_version := 0;
    preserved_revocation_seq := 0;
  else
    if (command_json ->> 'expected_readiness_version')::bigint
      is distinct from current_row.readiness_version
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'READINESS_CAS_CONFLICT', 'retryable', true
        )
      );
    end if;
    next_readiness_version := current_row.readiness_version + 1;
    preserved_revocation_seq := current_row.revocation_seq;
  end if;
  committed_at := pg_catalog.clock_timestamp();
  insert into app_data_agent.current_report_readiness (
    app_id, tenant_id, environment, run_id, state, certificate_ref,
    certificate_identity, certificate_semantic_hash, report_ref, report_identity,
    semantic_frontier_version, semantic_frontier_hash,
    schema_frontier_version, schema_frontier_hash,
    data_frontier_version, data_frontier_hash,
    policy_frontier_version, policy_frontier_hash,
    identity_frontier_version, identity_frontier_hash,
    frontier_hash, authority_epoch, readiness_version, revocation_seq,
    revocation_receipt_ref, published_at, revoked_at, updated_at
  )
  values (
    (scope_json ->> 'app_id')::uuid, (scope_json ->> 'tenant_id')::uuid,
    scope_json ->> 'environment', (command_json ->> 'run_id')::uuid,
    'CURRENT', certificate_ref, app_data_agent.runtime_canonical_json(certificate_ref),
    certificate_payload ->> 'certificate_semantic_hash',
    report_ref, app_data_agent.runtime_canonical_json(report_ref),
    semantic_frontier.frontier_version, semantic_frontier.frontier_value_hash,
    schema_frontier.frontier_version, schema_frontier.frontier_value_hash,
    data_frontier.frontier_version, data_frontier.frontier_value_hash,
    policy_frontier.frontier_version, policy_frontier.frontier_value_hash,
    identity_frontier.frontier_version, identity_frontier.frontier_value_hash,
    aggregate_frontier_hash, identity_frontier.authority_epoch,
    next_readiness_version, preserved_revocation_seq, null,
    committed_at, null, committed_at
  )
  on conflict (app_id, tenant_id, environment, run_id)
  do update set
    state = 'CURRENT',
    certificate_ref = excluded.certificate_ref,
    certificate_identity = excluded.certificate_identity,
    certificate_semantic_hash = excluded.certificate_semantic_hash,
    report_ref = excluded.report_ref,
    report_identity = excluded.report_identity,
    semantic_frontier_version = excluded.semantic_frontier_version,
    semantic_frontier_hash = excluded.semantic_frontier_hash,
    schema_frontier_version = excluded.schema_frontier_version,
    schema_frontier_hash = excluded.schema_frontier_hash,
    data_frontier_version = excluded.data_frontier_version,
    data_frontier_hash = excluded.data_frontier_hash,
    policy_frontier_version = excluded.policy_frontier_version,
    policy_frontier_hash = excluded.policy_frontier_hash,
    identity_frontier_version = excluded.identity_frontier_version,
    identity_frontier_hash = excluded.identity_frontier_hash,
    frontier_hash = excluded.frontier_hash,
    authority_epoch = excluded.authority_epoch,
    readiness_version = excluded.readiness_version,
    revocation_receipt_ref = null,
    published_at = excluded.published_at,
    revoked_at = null,
    updated_at = excluded.updated_at;
  insert into app_data_agent.research_readiness_publications (
    app_id, tenant_id, environment, publication_id, run_id, principal_id,
    idempotency_key, input_hash, certificate_ref, report_ref,
    expected_readiness_version, committed_readiness_version, frontier_hash,
    committed_at
  )
  values (
    (scope_json ->> 'app_id')::uuid, (scope_json ->> 'tenant_id')::uuid,
    scope_json ->> 'environment', (command_json ->> 'publication_id')::uuid,
    (command_json ->> 'run_id')::uuid, (command_json ->> 'principal_id')::uuid,
    command_json ->> 'idempotency_key', input_hash, certificate_ref, report_ref,
    nullif(command_json ->> 'expected_readiness_version', '')::bigint,
    next_readiness_version, aggregate_frontier_hash, committed_at
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'state', 'CURRENT',
      'certificate_ref', certificate_ref,
      'report_ref', report_ref,
      'readiness_version', next_readiness_version,
      'revocation_seq', preserved_revocation_seq,
      'frontier_hash', aggregate_frontier_hash
    )
  );
end
$function$;

create function app_data_agent.initialize_research_version_frontier(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  value_json jsonb;
  scope_json jsonb;
  requested_frontier_kind text;
  expected_authority text;
  frontier_hash text;
  input_hash text;
  operation_row record;
  event_seq bigint;
  committed_at timestamptz;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 9
    or command_json -> 'expected_frontier_version' <> 'null'::jsonb
    or command_json -> 'expected_frontier_hash' <> 'null'::jsonb
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  value_json := command_json -> 'value';
  scope_json := command_json -> 'scope';
  requested_frontier_kind := value_json ->> 'frontier_kind';
  expected_authority := case requested_frontier_kind
    when 'SEMANTIC' then 'SEMANTIC_FRONTIER_AUTHORITY'
    when 'SCHEMA' then 'SCHEMA_FRONTIER_AUTHORITY'
    when 'DATA' then 'DATA_SNAPSHOT_FRONTIER_AUTHORITY'
    when 'POLICY' then 'POLICY_FRONTIER_AUTHORITY'
    when 'IDENTITY' then 'IDENTITY_FRONTIER_AUTHORITY'
    else null
  end;
  if expected_authority is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  if requested_frontier_kind = 'DATA'
    and value_json #>> '{data_snapshot,binding_hash}'
      <> app_data_agent.u6_domain_sha256(
        'data-snapshot-binding@1.0.0',
        (value_json -> 'data_snapshot') - 'binding_hash'
      )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, expected_authority, null, requested_frontier_kind, null, true
  );
  frontier_hash := app_data_agent.u6_domain_sha256(
    'research-frontier-value@1.0.0',
    value_json
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-frontier-operation@1.0.0',
    command_json
  );

  perform 1
  from app_data_agent.runs as run
  where run.app_id = (scope_json ->> 'app_id')::uuid
    and run.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and run.environment = scope_json ->> 'environment'
    and run.run_id = (command_json ->> 'run_id')::uuid
    and run.principal_id = (command_json ->> 'principal_id')::uuid
  for update of run nowait;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH', 'retryable', false
      )
    );
  end if;

  select source.*
  into operation_row
  from app_data_agent.research_frontier_operations as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and (
      source.operation_id = (command_json ->> 'operation_id')::uuid
      or (
        source.run_id = (command_json ->> 'run_id')::uuid
        and source.principal_id = (command_json ->> 'principal_id')::uuid
        and source.frontier_kind = requested_frontier_kind
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  for update of source nowait;
  if operation_row.operation_id is not null then
    if operation_row.input_hash <> input_hash or operation_row.outcome <> 'COMMITTED' then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'READINESS_IDEMPOTENCY_CONFLICT', 'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'operation_id', operation_row.operation_id,
        'frontier_kind', operation_row.frontier_kind,
        'frontier_version', operation_row.committed_frontier_version,
        'frontier_value_hash', operation_row.committed_frontier_hash,
        'event_seq', operation_row.event_seq,
        'cascaded_revocation_operation_id',
          operation_row.cascaded_revocation_operation_id,
        'committed_at', operation_row.completed_at
      )
    );
  end if;

  perform 1
  from app_data_agent.current_report_readiness as current
  where current.app_id = (scope_json ->> 'app_id')::uuid
    and current.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and current.environment = scope_json ->> 'environment'
    and current.run_id = (command_json ->> 'run_id')::uuid
  for update of current nowait;
  perform 1
  from app_data_agent.research_version_frontiers as frontier
  where frontier.app_id = (scope_json ->> 'app_id')::uuid
    and frontier.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and frontier.environment = scope_json ->> 'environment'
    and frontier.run_id = (command_json ->> 'run_id')::uuid
  order by case frontier.frontier_kind
    when 'SEMANTIC' then 1 when 'SCHEMA' then 2 when 'DATA' then 3
    when 'POLICY' then 4 when 'IDENTITY' then 5 end
  for update of frontier nowait;

  if exists (
    select 1
    from app_data_agent.research_version_frontiers as frontier
    where frontier.app_id = (scope_json ->> 'app_id')::uuid
      and frontier.tenant_id = (scope_json ->> 'tenant_id')::uuid
      and frontier.environment = scope_json ->> 'environment'
      and frontier.run_id = (command_json ->> 'run_id')::uuid
      and frontier.frontier_kind = requested_frontier_kind
  ) then
    insert into app_data_agent.research_frontier_operations (
      app_id, tenant_id, environment, operation_id, run_id, principal_id,
      frontier_kind, idempotency_key, input_hash, expected_frontier_version,
      expected_frontier_hash, requested_frontier_hash, outcome, error_code
    )
    values (
      (scope_json ->> 'app_id')::uuid, (scope_json ->> 'tenant_id')::uuid,
      scope_json ->> 'environment', (command_json ->> 'operation_id')::uuid,
      (command_json ->> 'run_id')::uuid, (command_json ->> 'principal_id')::uuid,
      requested_frontier_kind, command_json ->> 'idempotency_key', input_hash, null, null,
      frontier_hash, 'REJECTED', 'RESEARCH_FRONTIER_CAS_CONFLICT'
    );
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_FRONTIER_CAS_CONFLICT', 'retryable', true
      )
    );
  end if;

  select pg_catalog.coalesce(pg_catalog.max(frontier.event_seq), 0) + 1
  into event_seq
  from app_data_agent.research_version_frontiers as frontier
  where frontier.app_id = (scope_json ->> 'app_id')::uuid
    and frontier.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and frontier.environment = scope_json ->> 'environment'
    and frontier.run_id = (command_json ->> 'run_id')::uuid;
  committed_at := pg_catalog.clock_timestamp();

  insert into app_data_agent.research_version_frontiers (
    app_id, tenant_id, environment, run_id, frontier_kind,
    frontier_value_json, frontier_value_hash, frontier_version,
    authority_epoch, event_seq, updated_at
  )
  values (
    (scope_json ->> 'app_id')::uuid, (scope_json ->> 'tenant_id')::uuid,
    scope_json ->> 'environment', (command_json ->> 'run_id')::uuid,
    requested_frontier_kind, value_json, frontier_hash, 0,
    case
      when requested_frontier_kind = 'IDENTITY'
        then (value_json #>> '{identity_binding,authority_epoch}')::bigint
      else 0
    end,
    event_seq, committed_at
  );

  insert into app_data_agent.research_frontier_operations (
    app_id, tenant_id, environment, operation_id, run_id, principal_id,
    frontier_kind, idempotency_key, input_hash, expected_frontier_version,
    expected_frontier_hash, requested_frontier_hash, outcome,
    committed_frontier_version, committed_frontier_hash, event_seq,
    cascaded_revocation_operation_id, error_code, completed_at
  )
  values (
    (scope_json ->> 'app_id')::uuid, (scope_json ->> 'tenant_id')::uuid,
    scope_json ->> 'environment', (command_json ->> 'operation_id')::uuid,
    (command_json ->> 'run_id')::uuid, (command_json ->> 'principal_id')::uuid,
    requested_frontier_kind, command_json ->> 'idempotency_key', input_hash, null, null,
    frontier_hash, 'COMMITTED', 0, frontier_hash, event_seq, null, null, committed_at
  );
  insert into app_data_agent.research_frontier_events (
    app_id, tenant_id, environment, run_id, event_seq, operation_id,
    frontier_kind, event_kind, owner_principal_id, old_frontier_version,
    old_frontier_hash, new_frontier_version, new_frontier_hash, committed_at
  )
  values (
    (scope_json ->> 'app_id')::uuid, (scope_json ->> 'tenant_id')::uuid,
    scope_json ->> 'environment', (command_json ->> 'run_id')::uuid,
    event_seq, (command_json ->> 'operation_id')::uuid, requested_frontier_kind,
    'INITIALIZED', (command_json ->> 'principal_id')::uuid, null, null,
    0, frontier_hash, committed_at
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'operation_id', command_json ->> 'operation_id',
      'frontier_kind', requested_frontier_kind,
      'frontier_version', 0,
      'frontier_value_hash', frontier_hash,
      'event_seq', event_seq,
      'cascaded_revocation_operation_id', null,
      'committed_at', committed_at
    )
  );
end
$function$;

create function app_data_agent.advance_research_version_frontier(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  value_json jsonb;
  scope_json jsonb;
  requested_frontier_kind text;
  expected_authority text;
  frontier_hash text;
  input_hash text;
  target_frontier record;
  current_readiness record;
  locked_certificate record;
  operation_row record;
  semantic_frontier record;
  schema_frontier record;
  data_frontier record;
  policy_frontier record;
  identity_frontier record;
  next_event_seq bigint;
  next_version bigint;
  cascade_operation_id uuid;
  cascade_reason text;
  observed_frontier jsonb;
  observed_frontier_hash text;
  observed_frontier_event_seq bigint;
  revocation_input_hash text;
  next_revocation_seq bigint;
  receipt_artifact_id uuid;
  receipt_payload jsonb;
  receipt_envelope_material jsonb;
  receipt_envelope jsonb;
  receipt_document jsonb;
  receipt_content_hash text;
  committed_receipt_ref jsonb;
  receipt_commit jsonb;
  receipt_input_refs jsonb;
  committed_at_text text;
  committed_at timestamptz;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 9
    or pg_catalog.jsonb_typeof(command_json -> 'expected_frontier_version') <> 'number'
    or pg_catalog.jsonb_typeof(command_json -> 'expected_frontier_hash') <> 'string'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  value_json := command_json -> 'value';
  scope_json := command_json -> 'scope';
  requested_frontier_kind := value_json ->> 'frontier_kind';
  expected_authority := case requested_frontier_kind
    when 'SEMANTIC' then 'SEMANTIC_FRONTIER_AUTHORITY'
    when 'SCHEMA' then 'SCHEMA_FRONTIER_AUTHORITY'
    when 'DATA' then 'DATA_SNAPSHOT_FRONTIER_AUTHORITY'
    when 'POLICY' then 'POLICY_FRONTIER_AUTHORITY'
    when 'IDENTITY' then 'IDENTITY_FRONTIER_AUTHORITY'
    else null
  end;
  if expected_authority is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, expected_authority, null, requested_frontier_kind, null, true
  );
  frontier_hash := app_data_agent.u6_domain_sha256(
    'research-frontier-value@1.0.0', value_json
  );
  if requested_frontier_kind = 'DATA'
    and value_json #>> '{data_snapshot,binding_hash}'
      <> app_data_agent.u6_domain_sha256(
        'data-snapshot-binding@1.0.0',
        (value_json -> 'data_snapshot') - 'binding_hash'
      )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID', 'retryable', false
      )
    );
  end if;
  input_hash := app_data_agent.u6_domain_sha256(
    'research-frontier-operation@1.0.0', command_json
  );

  perform 1
  from app_data_agent.runs as run
  where run.app_id = (scope_json ->> 'app_id')::uuid
    and run.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and run.environment = scope_json ->> 'environment'
    and run.run_id = (command_json ->> 'run_id')::uuid
    and run.principal_id = (command_json ->> 'principal_id')::uuid
  for update of run nowait;
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH', 'retryable', false
      )
    );
  end if;

  select source.*
  into operation_row
  from app_data_agent.research_frontier_operations as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and (
      source.operation_id = (command_json ->> 'operation_id')::uuid
      or (
        source.run_id = (command_json ->> 'run_id')::uuid
        and source.principal_id = (command_json ->> 'principal_id')::uuid
        and source.frontier_kind = requested_frontier_kind
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  for update of source nowait;
  if operation_row.operation_id is not null then
    if operation_row.input_hash <> input_hash or operation_row.outcome <> 'COMMITTED' then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'READINESS_IDEMPOTENCY_CONFLICT', 'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'operation_id', operation_row.operation_id,
        'frontier_kind', operation_row.frontier_kind,
        'frontier_version', operation_row.committed_frontier_version,
        'frontier_value_hash', operation_row.committed_frontier_hash,
        'event_seq', operation_row.event_seq,
        'cascaded_revocation_operation_id',
          operation_row.cascaded_revocation_operation_id,
        'committed_at', operation_row.completed_at
      )
    );
  end if;

  -- The unlocked read is only a locator under the already-held Run lock. It
  -- allows the exact Certificate/Receipt artifact key to be locked before the
  -- Current row, preserving the frozen Root rank.
  select source.*
  into current_readiness
  from app_data_agent.current_report_readiness as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid;
  if current_readiness.run_id is not null
    and current_readiness.state = 'CURRENT'
  then
    receipt_artifact_id := app_data_agent.u6_uuid_v5(
      (command_json ->> 'operation_id')::uuid,
      pg_catalog.convert_to('readiness-revocation-receipt@1.0.0', 'UTF8')
    );
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        app_data_agent.runtime_canonical_json(
          pg_catalog.jsonb_build_array(
            scope_json,
            command_json ->> 'run_id',
            receipt_artifact_id,
            'ReadinessRevocationReceipt'
          )
        ),
        0
      )
    );
    select artifact.*
    into locked_certificate
    from app_data_agent.artifacts as artifact
    where artifact.app_id = current_readiness.app_id
      and artifact.tenant_id = current_readiness.tenant_id
      and artifact.environment = current_readiness.environment
      and artifact.run_id = current_readiness.run_id
      and artifact.artifact_id =
        (current_readiness.certificate_ref ->> 'artifact_id')::uuid
      and artifact.artifact_type = 'ReportReadyCertificate'
      and artifact.revision =
        (current_readiness.certificate_ref ->> 'revision')::integer
      and artifact.content_hash =
        current_readiness.certificate_ref ->> 'content_hash'
      and artifact.is_active
    for update of artifact nowait;
    if locked_certificate.artifact_id is null
      or locked_certificate.document_json #>> '{payload,protocol_version}'
        is distinct from 'report-ready@3.0.0'
      or locked_certificate.document_json #>> '{envelope,status}'
        is distinct from 'COMMITTED'
      or app_data_agent.runtime_canonical_sha256(
        pg_catalog.jsonb_build_object(
          'envelope',
            (locked_certificate.document_json -> 'envelope')
              - 'content_hash' - 'created_at' - 'status',
          'payload', locked_certificate.document_json -> 'payload'
        )
      ) <> current_readiness.certificate_ref ->> 'content_hash'
      or locked_certificate.document_json
          #>> '{payload,certificate_semantic_hash}'
        <> app_data_agent.runtime_canonical_sha256(
          (locked_certificate.document_json -> 'payload')
            - 'certificate_semantic_hash'
        )
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT', 'retryable', false
        )
      );
    end if;
  end if;

  select source.*
  into current_readiness
  from app_data_agent.current_report_readiness as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
  for update of source nowait;
  perform 1
  from app_data_agent.research_version_frontiers as frontier
  where frontier.app_id = (scope_json ->> 'app_id')::uuid
    and frontier.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and frontier.environment = scope_json ->> 'environment'
    and frontier.run_id = (command_json ->> 'run_id')::uuid
  order by case frontier.frontier_kind
    when 'SEMANTIC' then 1 when 'SCHEMA' then 2 when 'DATA' then 3
    when 'POLICY' then 4 when 'IDENTITY' then 5 end
  for update of frontier nowait;

  select source.*
  into target_frontier
  from app_data_agent.research_version_frontiers as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.frontier_kind = requested_frontier_kind;
  if target_frontier.frontier_kind is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'READINESS_FRONTIER_INCOMPLETE', 'retryable', false
      )
    );
  end if;
  if target_frontier.frontier_version <> (command_json ->> 'expected_frontier_version')::bigint
    or target_frontier.frontier_value_hash <> command_json ->> 'expected_frontier_hash'
  then
    insert into app_data_agent.research_frontier_operations (
      app_id, tenant_id, environment, operation_id, run_id, principal_id,
      frontier_kind, idempotency_key, input_hash, expected_frontier_version,
      expected_frontier_hash, requested_frontier_hash, outcome, error_code
    )
    values (
      (scope_json ->> 'app_id')::uuid, (scope_json ->> 'tenant_id')::uuid,
      scope_json ->> 'environment', (command_json ->> 'operation_id')::uuid,
      (command_json ->> 'run_id')::uuid, (command_json ->> 'principal_id')::uuid,
      requested_frontier_kind, command_json ->> 'idempotency_key', input_hash,
      (command_json ->> 'expected_frontier_version')::bigint,
      command_json ->> 'expected_frontier_hash', frontier_hash,
      'REJECTED', 'RESEARCH_FRONTIER_CAS_CONFLICT'
    );
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0', 'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_FRONTIER_CAS_CONFLICT', 'retryable', true
      )
    );
  end if;
  next_version := target_frontier.frontier_version + 1;
  select pg_catalog.max(frontier.event_seq) + 1
  into next_event_seq
  from app_data_agent.research_version_frontiers as frontier
  where frontier.app_id = target_frontier.app_id
    and frontier.tenant_id = target_frontier.tenant_id
    and frontier.environment = target_frontier.environment
    and frontier.run_id = target_frontier.run_id;
  committed_at := pg_catalog.clock_timestamp();

  update app_data_agent.research_version_frontiers
  set frontier_value_json = value_json,
      frontier_value_hash = frontier_hash,
      frontier_version = next_version,
      authority_epoch = case
        when requested_frontier_kind = 'IDENTITY'
          then (value_json #>> '{identity_binding,authority_epoch}')::bigint
        else 0
      end,
      event_seq = next_event_seq,
      updated_at = committed_at
  where app_id = target_frontier.app_id
    and tenant_id = target_frontier.tenant_id
    and environment = target_frontier.environment
    and run_id = target_frontier.run_id
    and research_version_frontiers.frontier_kind = target_frontier.frontier_kind;

  cascade_operation_id := case
    when current_readiness.run_id is not null
      and current_readiness.state = 'CURRENT'
      then (command_json ->> 'operation_id')::uuid
    else null
  end;

  insert into app_data_agent.research_frontier_operations (
    app_id, tenant_id, environment, operation_id, run_id, principal_id,
    frontier_kind, idempotency_key, input_hash, expected_frontier_version,
    expected_frontier_hash, requested_frontier_hash, outcome,
    committed_frontier_version, committed_frontier_hash, event_seq,
    cascaded_revocation_operation_id, error_code, completed_at
  )
  values (
    target_frontier.app_id, target_frontier.tenant_id, target_frontier.environment,
    (command_json ->> 'operation_id')::uuid, target_frontier.run_id,
    (command_json ->> 'principal_id')::uuid, requested_frontier_kind,
    command_json ->> 'idempotency_key', input_hash,
    target_frontier.frontier_version, target_frontier.frontier_value_hash,
    frontier_hash, 'COMMITTED', next_version, frontier_hash, next_event_seq,
    cascade_operation_id, null, committed_at
  );

  if cascade_operation_id is not null then
    select source.* into semantic_frontier
    from app_data_agent.research_version_frontiers as source
    where source.app_id = target_frontier.app_id
      and source.tenant_id = target_frontier.tenant_id
      and source.environment = target_frontier.environment
      and source.run_id = target_frontier.run_id
      and source.frontier_kind = 'SEMANTIC';
    select source.* into schema_frontier
    from app_data_agent.research_version_frontiers as source
    where source.app_id = target_frontier.app_id
      and source.tenant_id = target_frontier.tenant_id
      and source.environment = target_frontier.environment
      and source.run_id = target_frontier.run_id
      and source.frontier_kind = 'SCHEMA';
    select source.* into data_frontier
    from app_data_agent.research_version_frontiers as source
    where source.app_id = target_frontier.app_id
      and source.tenant_id = target_frontier.tenant_id
      and source.environment = target_frontier.environment
      and source.run_id = target_frontier.run_id
      and source.frontier_kind = 'DATA';
    select source.* into policy_frontier
    from app_data_agent.research_version_frontiers as source
    where source.app_id = target_frontier.app_id
      and source.tenant_id = target_frontier.tenant_id
      and source.environment = target_frontier.environment
      and source.run_id = target_frontier.run_id
      and source.frontier_kind = 'POLICY';
    select source.* into identity_frontier
    from app_data_agent.research_version_frontiers as source
    where source.app_id = target_frontier.app_id
      and source.tenant_id = target_frontier.tenant_id
      and source.environment = target_frontier.environment
      and source.run_id = target_frontier.run_id
      and source.frontier_kind = 'IDENTITY';

    if semantic_frontier.frontier_kind is null
      or schema_frontier.frontier_kind is null
      or data_frontier.frontier_kind is null
      or policy_frontier.frontier_kind is null
      or identity_frontier.frontier_kind is null
    then
      raise exception using
        errcode = '23514',
        message = 'DA_U6_READINESS_REVOCATION_PROPAGATION_FAILED';
    end if;

    observed_frontier := pg_catalog.jsonb_build_object(
      'semantic_release_ref',
        semantic_frontier.frontier_value_json -> 'reference',
      'schema_snapshot_ref',
        schema_frontier.frontier_value_json -> 'reference',
      'data_snapshot',
        data_frontier.frontier_value_json -> 'data_snapshot',
      'policy_receipt_ref',
        policy_frontier.frontier_value_json -> 'reference',
      'identity_binding',
        identity_frontier.frontier_value_json -> 'identity_binding'
    );
    observed_frontier_hash := app_data_agent.u6_domain_sha256(
      'research-frontier-vector@1.0.0',
      pg_catalog.jsonb_build_object(
        'SEMANTIC', semantic_frontier.frontier_value_json,
        'SCHEMA', schema_frontier.frontier_value_json,
        'DATA', data_frontier.frontier_value_json,
        'POLICY', policy_frontier.frontier_value_json,
        'IDENTITY', identity_frontier.frontier_value_json
      )
    );
    observed_frontier_event_seq := pg_catalog.greatest(
      semantic_frontier.event_seq,
      schema_frontier.event_seq,
      data_frontier.event_seq,
      policy_frontier.event_seq,
      identity_frontier.event_seq
    );
    cascade_reason := case requested_frontier_kind
      when 'SEMANTIC' then 'SEMANTIC_REVISION_CHANGED'
      when 'SCHEMA' then 'SCHEMA_REVISION_CHANGED'
      when 'DATA' then 'DATA_SNAPSHOT_STALE'
      when 'POLICY' then 'POLICY_CHANGED'
      when 'IDENTITY' then 'IDENTITY_AUTHORITY_CHANGED'
    end;
    revocation_input_hash := app_data_agent.u6_domain_sha256(
      'research-readiness-revocation-operation@1.0.0',
      pg_catalog.jsonb_build_object(
        'trigger', 'FRONTIER_ADVANCE',
        'source_operation_id', cascade_operation_id,
        'reason', cascade_reason,
        'certificate_ref', current_readiness.certificate_ref,
        'observed_frontier_hash', observed_frontier_hash
      )
    );

    insert into app_data_agent.research_revocation_operations (
      app_id, tenant_id, environment, operation_id, run_id,
      owner_principal_id, idempotency_key, input_hash, trigger_kind,
      source_operation_id, reason, certificate_ref,
      observed_frontier_hash, authority_epoch, state
    )
    values (
      target_frontier.app_id, target_frontier.tenant_id,
      target_frontier.environment, cascade_operation_id,
      target_frontier.run_id, (command_json ->> 'principal_id')::uuid,
      'frontier:' || (command_json ->> 'operation_id'),
      revocation_input_hash, 'FRONTIER_ADVANCE', cascade_operation_id,
      cascade_reason, current_readiness.certificate_ref,
      observed_frontier_hash, identity_frontier.authority_epoch, 'REQUESTED'
    );

    receipt_payload := pg_catalog.jsonb_build_object(
      'artifact_type', 'ReadinessRevocationReceipt',
      'protocol_version', 'readiness-revocation@1.0.0',
      'certificate_ref', current_readiness.certificate_ref,
      'observed_frontier', observed_frontier,
      'reason', cascade_reason,
      'trigger', 'FRONTIER_ADVANCE',
      'source_operation_id', cascade_operation_id,
      'observed_frontier_event_seq', observed_frontier_event_seq
    );
    receipt_payload := receipt_payload || pg_catalog.jsonb_build_object(
      'revocation_semantic_hash',
      app_data_agent.runtime_canonical_sha256(receipt_payload)
    );
    select pg_catalog.jsonb_agg(reference_value order by reference_identity)
    into receipt_input_refs
    from (
      select candidate.reference_value,
        app_data_agent.runtime_canonical_json(
          pg_catalog.jsonb_build_array(
            candidate.reference_value ->> 'app_id',
            candidate.reference_value ->> 'tenant_id',
            candidate.reference_value ->> 'environment',
            candidate.reference_value ->> 'run_id',
            candidate.reference_value ->> 'artifact_id',
            candidate.reference_value ->> 'artifact_type',
            candidate.reference_value -> 'revision',
            candidate.reference_value ->> 'content_hash'
          )
        ) as reference_identity
      from (
        values
          (current_readiness.certificate_ref),
          (observed_frontier -> 'semantic_release_ref'),
          (observed_frontier -> 'schema_snapshot_ref'),
          (observed_frontier -> 'policy_receipt_ref')
      ) as candidate(reference_value)
    ) as ordered_references;
    committed_at_text := pg_catalog.to_char(
      committed_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    );
    receipt_envelope_material := pg_catalog.jsonb_build_object(
      'artifact_id', receipt_artifact_id,
      'artifact_type', 'ReadinessRevocationReceipt',
      'app_id', target_frontier.app_id,
      'tenant_id', target_frontier.tenant_id,
      'environment', target_frontier.environment,
      'run_id', target_frontier.run_id,
      'revision', 1,
      'parent_ref', null,
      'attempt_id', cascade_operation_id,
      'producer', pg_catalog.jsonb_build_object(
        'kind', 'deterministic',
        'id', 'u6-readiness-revocation-writer'
      ),
      'input_refs', receipt_input_refs,
      'schema_version', '1.0.0',
      'semantic_version', '1.0.0',
      'policy_version', '1.0.0',
      'model_profile_version', '1.0.0'
    );
    receipt_content_hash := app_data_agent.runtime_canonical_sha256(
      pg_catalog.jsonb_build_object(
        'envelope', receipt_envelope_material,
        'payload', receipt_payload
      )
    );
    receipt_envelope := receipt_envelope_material
      || pg_catalog.jsonb_build_object(
        'content_hash', receipt_content_hash,
        'status', 'COMMITTED',
        'created_at', committed_at_text
      );
    receipt_document := pg_catalog.jsonb_build_object(
      'envelope', receipt_envelope,
      'payload', receipt_payload
    );
    receipt_commit := app_data_agent.commit_research_revocation_receipt(
      pg_catalog.jsonb_build_object(
        'document', receipt_document,
        'document_checksum',
          app_data_agent.runtime_canonical_sha256(receipt_document)
      )
    );
    committed_receipt_ref := receipt_commit -> 'reference';
    if committed_receipt_ref is null then
      raise exception using
        errcode = '23514',
        message = 'DA_U6_READINESS_REVOCATION_PROPAGATION_FAILED';
    end if;

    next_revocation_seq := current_readiness.revocation_seq + 1;
    update app_data_agent.current_report_readiness
    set state = 'REVOKED',
        revocation_seq = next_revocation_seq,
        revocation_receipt_ref = committed_receipt_ref,
        revoked_at = committed_at,
        updated_at = committed_at
    where app_id = current_readiness.app_id
      and tenant_id = current_readiness.tenant_id
      and environment = current_readiness.environment
      and run_id = current_readiness.run_id
      and state = 'CURRENT';
    if not found then
      raise exception using
        errcode = '40001',
        message = 'DA_U6_READINESS_REVOCATION_PROPAGATION_FAILED';
    end if;

    update app_data_agent.report_read_grants as target
    set state = 'REVOKED',
        terminal_from_status = target.state,
        revoked_at = committed_at
    where target.app_id = current_readiness.app_id
      and target.tenant_id = current_readiness.tenant_id
      and target.environment = current_readiness.environment
      and target.run_id = current_readiness.run_id
      and target.state in ('ISSUED', 'CONSUMED');

    update app_data_agent.research_revocation_operations
    set state = 'COMMITTED',
        receipt_ref = committed_receipt_ref,
        completed_at = committed_at
    where app_id = target_frontier.app_id
      and tenant_id = target_frontier.tenant_id
      and environment = target_frontier.environment
      and operation_id = cascade_operation_id
      and state = 'REQUESTED';
    if not found then
      raise exception using
        errcode = '40001',
        message = 'DA_U6_READINESS_REVOCATION_PROPAGATION_FAILED';
    end if;
  end if;

  insert into app_data_agent.research_frontier_events (
    app_id, tenant_id, environment, run_id, event_seq, operation_id,
    frontier_kind, event_kind, owner_principal_id, old_frontier_version,
    old_frontier_hash, new_frontier_version, new_frontier_hash, committed_at
  )
  values (
    target_frontier.app_id, target_frontier.tenant_id, target_frontier.environment,
    target_frontier.run_id, next_event_seq, (command_json ->> 'operation_id')::uuid,
    requested_frontier_kind, 'ADVANCED', (command_json ->> 'principal_id')::uuid,
    target_frontier.frontier_version, target_frontier.frontier_value_hash,
    next_version, frontier_hash, committed_at
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0', 'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'operation_id', command_json ->> 'operation_id',
      'frontier_kind', requested_frontier_kind,
      'frontier_version', next_version,
      'frontier_value_hash', frontier_hash,
      'event_seq', next_event_seq,
      'cascaded_revocation_operation_id', cascade_operation_id,
      'committed_at', committed_at
    )
  );
end
$function$;
create function app_data_agent.authorize_agent_data_projection(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 18
    or command_json ->> 'schema_version' <> '1.0.0'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;

  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'AGENT_DATA_PROJECTION_AUTHORITY',
    null,
    null,
    null,
    true
  );

  -- The frozen wire does not carry tenant HMAC material. PostgreSQL must not
  -- replace that keyed proof with a plain digest or accept caller-provided
  -- counts. The endpoint therefore remains explicitly fail-closed until the
  -- server-owned Projection Authority is wired to this transaction.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_RESULT_GOVERNANCE_REJECTED',
      'retryable', false
    )
  );
end
$function$;

create function app_data_agent.revoke_tool_invocation_permit(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 10
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'transition_id', 'permit_ref',
        'expected_status', 'transition', 'reason_code'
      ]
    )
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(command_json -> 'permit_ref') <> 'object'
    or command_json ->> 'expected_status' <> 'ACTIVE'
    or command_json ->> 'transition' <> 'REVOKE'
    or command_json ->> 'reason_code'
      not in ('POLICY_REVOKED', 'RUN_TERMINATED', 'TOOL_REMOVED')
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'TOOL_POLICY_AUTHORITY',
    null,
    null,
    null,
    true
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_SYSTEM_RECORD_TRANSITION_CONFLICT',
      'retryable', false
    )
  );
end
$function$;

create function app_data_agent.expire_tool_invocation_permit(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 10
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'transition_id', 'permit_ref',
        'expected_status', 'transition', 'reason_code'
      ]
    )
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(command_json -> 'permit_ref') <> 'object'
    or command_json ->> 'expected_status' <> 'ACTIVE'
    or command_json ->> 'transition' <> 'EXPIRE'
    or command_json ->> 'reason_code' <> 'PERMIT_TTL_EXPIRED'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'TOOL_POLICY_EXPIRY_AUTHORITY',
    null,
    null,
    null,
    true
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_SYSTEM_RECORD_TRANSITION_CONFLICT',
      'retryable', false
    )
  );
end
$function$;

create function app_data_agent.tombstone_invocation_result(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 9
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'transition_id', 'result_ref',
        'expected_blob_state', 'reason_code'
      ]
    )
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(command_json -> 'result_ref') <> 'object'
    or command_json ->> 'expected_blob_state' <> 'AVAILABLE'
    or command_json ->> 'reason_code' <> 'RETENTION_PERIOD_ELAPSED'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESULT_RETENTION_AUTHORITY',
    null,
    null,
    null,
    true
  );
  -- The current physical projection cannot clear every frozen sensitive
  -- field and prove the active legal-hold/backup boundary atomically.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_RESULT_GOVERNANCE_REJECTED',
      'retryable', false
    )
  );
end
$function$;

create function app_data_agent.erase_subject_invocation_result(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 11
    or not (
      command_json ?& array[
        'schema_version', 'scope', 'run_id', 'principal_id',
        'idempotency_key', 'transition_id', 'result_ref',
        'expected_blob_state', 'reason_code', 'erasure_request_id',
        'erasure_request_hash'
      ]
    )
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(command_json -> 'result_ref') <> 'object'
    or command_json ->> 'expected_blob_state' <> 'AVAILABLE'
    or command_json ->> 'reason_code' <> 'SUBJECT_ERASURE_CONFIRMED'
    or command_json ->> 'erasure_request_hash' !~ '^sha256:[0-9a-f]{64}$'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESULT_ERASURE_AUTHORITY',
    null,
    null,
    null,
    true
  );
  -- External subject-request verification, backup expiry and complete
  -- sensitive-field erasure are not yet one transactional authority.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_RESULT_GOVERNANCE_REJECTED',
      'retryable', false
    )
  );
end
$function$;

create function app_data_agent.issue_tool_invocation_permit(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  policy_ref jsonb;
  capability_json jsonb;
  target_run record;
  target_policy record;
  target_limit record;
  target_identity record;
  target_permit record;
  conflicting_transition record;
  policy_version text;
  effective_ttl_ms bigint;
  db_now timestamptz;
  payload_json jsonb;
  permit_ref jsonb;
  payload_hash text;
begin
  command_json := envelope_json -> 'command';
  scope_json := command_json -> 'scope';
  policy_ref := command_json -> 'policy_receipt_ref';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 13
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(scope_json)
    ) <> 3
    or pg_catalog.jsonb_typeof(policy_ref) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(policy_ref)
    ) <> 8
    or policy_ref ->> 'artifact_type' <> 'PolicyReceipt'
    or command_json ->> 'tool_name' is null
    or pg_catalog.length(command_json ->> 'tool_name') not between 1 and 2000
    or command_json ->> 'tool_version' is null
    or pg_catalog.length(command_json ->> 'tool_version') not between 1 and 128
    or command_json ->> 'arguments_schema_hash' !~ '^sha256:[0-9a-f]{64}$'
    or command_json ->> 'arguments_hash' !~ '^sha256:[0-9a-f]{64}$'
    or command_json ->> 'requested_ttl_ms' !~ '^[1-9][0-9]{0,7}$'
    or (command_json ->> 'requested_ttl_ms')::bigint not between 1 and 86400000
    or command_json ->> 'idempotency_key' is null
    or pg_catalog.length(command_json ->> 'idempotency_key') not between 1 and 256
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;

  capability_json := app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'TOOL_POLICY_AUTHORITY',
    null,
    null,
    null,
    true
  );

  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  if target_run.run_id is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH',
        'retryable', false
      )
    );
  end if;

  select source.*
  into target_policy
  from app_data_agent.artifacts as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.run_id = target_run.run_id
    and source.artifact_id = (policy_ref ->> 'artifact_id')::uuid
    and source.artifact_type = 'PolicyReceipt'
    and source.revision = (policy_ref ->> 'revision')::integer
    and source.content_hash = policy_ref ->> 'content_hash'
    and source.is_active
  for key share of source nowait;
  if target_policy.artifact_id is null
    or policy_ref ->> 'app_id' is distinct from target_run.app_id::text
    or policy_ref ->> 'tenant_id' is distinct from target_run.tenant_id::text
    or policy_ref ->> 'environment' is distinct from target_run.environment
    or policy_ref ->> 'run_id' is distinct from target_run.run_id::text
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT',
        'retryable', false
      )
    );
  end if;

  policy_version := pg_catalog.coalesce(
    target_policy.document_json ->> 'policy_version',
    target_policy.document_json #>> '{payload,policy_version}',
    target_policy.document_json #>> '{envelope,policy_version}'
  );
  if policy_version is null
    or pg_catalog.length(policy_version) not between 1 and 128
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_COMMITTED',
        'retryable', false
      )
    );
  end if;

  select source.*
  into target_limit
  from app_data_agent.research_tool_permit_policy_limits as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.policy_version = policy_version
  for key share of source nowait;
  if target_limit.policy_version is null
    or target_limit.tool_permit_max_ttl_ms not between 1 and 300000
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESULT_GOVERNANCE_REJECTED',
        'retryable', false
      )
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      app_data_agent.u6_domain_sha256(
        'u6-tool-permit@1.0.0',
        pg_catalog.jsonb_build_array(
          target_run.app_id,
          target_run.tenant_id,
          target_run.environment,
          command_json ->> 'record_id'
        )
      ),
      0
    )
  );
  select source.*
  into target_identity
  from app_data_agent.research_system_record_identities as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.record_kind = 'TOOL_INVOCATION_PERMIT'
    and source.record_id = (command_json ->> 'record_id')::uuid
    and source.record_version = 1
  for update of source nowait;
  select source.*
  into target_permit
  from app_data_agent.research_tool_invocation_permits as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.record_id = (command_json ->> 'record_id')::uuid
  for update of source nowait;
  select source.*
  into conflicting_transition
  from app_data_agent.research_system_record_transition_operations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.transition_id = (command_json ->> 'transition_id')::uuid
  for update of source nowait;

  if conflicting_transition.transition_id is not null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_SYSTEM_RECORD_TRANSITION_CONFLICT',
        'retryable', false
      )
    );
  end if;

  if target_identity.record_id is not null
    or target_permit.record_id is not null
  then
    if target_identity.record_id is null
      or target_permit.record_id is null
      or target_identity.commit_id <> (command_json ->> 'transition_id')::uuid
      or target_identity.run_id <> target_run.run_id
      or target_identity.principal_id <> target_run.principal_id
      or target_permit.run_id <> target_run.run_id
      or target_permit.principal_id <> target_run.principal_id
      or target_permit.tool_name <> command_json ->> 'tool_name'
      or target_permit.tool_version <> command_json ->> 'tool_version'
      or target_permit.arguments_schema_hash
        <> command_json ->> 'arguments_schema_hash'
      or target_permit.arguments_hash <> command_json ->> 'arguments_hash'
      or target_permit.policy_receipt_ref <> policy_ref
      or target_permit.tool_policy_version <> policy_version
      or target_permit.tool_permit_policy_limit_hash
        <> target_limit.policy_limit_hash
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_SYSTEM_RECORD_TRANSITION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    if target_permit.status <> 'ACTIVE' then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_SYSTEM_RECORD_NOT_ACTIVE',
          'retryable', false
        )
      );
    end if;
    payload_json := pg_catalog.jsonb_build_object(
      'protocol_version', 'tool-invocation-permit@1.0.0',
      'scope', scope_json,
      'run_id', target_permit.run_id,
      'principal_id', target_permit.principal_id,
      'tool_name', target_permit.tool_name,
      'tool_version', target_permit.tool_version,
      'arguments_schema_hash', target_permit.arguments_schema_hash,
      'arguments_hash', target_permit.arguments_hash,
      'policy_receipt_ref', target_permit.policy_receipt_ref,
      'tool_policy_version', target_permit.tool_policy_version,
      'tool_permit_policy_limit_hash',
        target_permit.tool_permit_policy_limit_hash,
      'registry', 'ALLOWLISTED',
      'effect', 'READ_ONLY',
      'source_role', 'NON_SOURCE',
      'external_side_effect', 'NO_EXTERNAL_SIDE_EFFECT',
      'authority_epoch', target_permit.authority_epoch,
      'expires_at', target_permit.expires_at
    );
    permit_ref := pg_catalog.jsonb_build_object(
      'record_kind', 'TOOL_INVOCATION_PERMIT',
      'record_id', target_permit.record_id,
      'scope', scope_json,
      'run_id', target_permit.run_id,
      'record_version', 1,
      'content_hash', target_identity.content_hash,
      'commit_id', target_identity.commit_id,
      'owner_kind', 'TOOL_POLICY_AUTHORITY',
      'commit_capability', 'TOOL_POLICY_AUTHORITY',
      'resolver_capabilities',
        pg_catalog.jsonb_build_array(
          'RESOURCE_AUTHORITY',
          'TOOL_INVOCATION_AUTHORITY'
        ),
      'producer', 'TOOL_POLICY_SERVICE',
      'store', 'research_tool_invocation_permits',
      'commit', 'issue_tool_invocation_permit@1.0.0',
      'resolver', 'resolve_current_tool_invocation_permit@1.0.0',
      'status', 'ACTIVE',
      'authority_epoch', target_permit.authority_epoch,
      'expires_at', target_permit.expires_at,
      'revocation_seq', target_permit.revocation_seq
    );
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'permit_ref', permit_ref,
        'payload', payload_json,
        'status', 'ACTIVE',
        'revoked_at', null,
        'expired_at', null
      )
    );
  end if;

  db_now := pg_catalog.clock_timestamp();
  if (capability_json ->> 'expires_at')::timestamptz <= db_now then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_EXPIRED',
        'retryable', false
      )
    );
  end if;
  effective_ttl_ms := pg_catalog.least(
    (command_json ->> 'requested_ttl_ms')::bigint,
    target_limit.tool_permit_max_ttl_ms,
    300000::bigint
  );
  payload_json := pg_catalog.jsonb_build_object(
    'protocol_version', 'tool-invocation-permit@1.0.0',
    'scope', scope_json,
    'run_id', target_run.run_id,
    'principal_id', target_run.principal_id,
    'tool_name', command_json ->> 'tool_name',
    'tool_version', command_json ->> 'tool_version',
    'arguments_schema_hash', command_json ->> 'arguments_schema_hash',
    'arguments_hash', command_json ->> 'arguments_hash',
    'policy_receipt_ref', policy_ref,
    'tool_policy_version', policy_version,
    'tool_permit_policy_limit_hash', target_limit.policy_limit_hash,
    'registry', 'ALLOWLISTED',
    'effect', 'READ_ONLY',
    'source_role', 'NON_SOURCE',
    'external_side_effect', 'NO_EXTERNAL_SIDE_EFFECT',
    'authority_epoch', (capability_json ->> 'authority_epoch')::bigint,
    'expires_at',
      db_now + (effective_ttl_ms * pg_catalog.interval '1 millisecond')
  );
  payload_hash := app_data_agent.runtime_canonical_sha256(payload_json);
  permit_ref := pg_catalog.jsonb_build_object(
    'record_kind', 'TOOL_INVOCATION_PERMIT',
    'record_id', command_json ->> 'record_id',
    'scope', scope_json,
    'run_id', target_run.run_id,
    'record_version', 1,
    'content_hash', payload_hash,
    'commit_id', command_json ->> 'transition_id',
    'owner_kind', 'TOOL_POLICY_AUTHORITY',
    'commit_capability', 'TOOL_POLICY_AUTHORITY',
    'resolver_capabilities',
      pg_catalog.jsonb_build_array(
        'RESOURCE_AUTHORITY',
        'TOOL_INVOCATION_AUTHORITY'
      ),
    'producer', 'TOOL_POLICY_SERVICE',
    'store', 'research_tool_invocation_permits',
    'commit', 'issue_tool_invocation_permit@1.0.0',
    'resolver', 'resolve_current_tool_invocation_permit@1.0.0',
    'status', 'ACTIVE',
    'authority_epoch', (capability_json ->> 'authority_epoch')::bigint,
    'expires_at', payload_json -> 'expires_at',
    'revocation_seq', 0
  );
  insert into app_data_agent.research_system_record_identities (
    app_id, tenant_id, environment, record_kind, record_id, record_version,
    run_id, principal_id, content_hash, commit_id, authority_epoch, committed_at
  )
  values (
    target_run.app_id, target_run.tenant_id, target_run.environment,
    'TOOL_INVOCATION_PERMIT', (command_json ->> 'record_id')::uuid, 1,
    target_run.run_id, target_run.principal_id, payload_hash,
    (command_json ->> 'transition_id')::uuid,
    (capability_json ->> 'authority_epoch')::bigint, db_now
  );
  insert into app_data_agent.research_tool_invocation_permits (
    app_id, tenant_id, environment, record_id, record_version, record_kind,
    run_id, principal_id, tool_name, tool_version, arguments_schema_hash,
    arguments_hash, policy_receipt_ref, tool_policy_version,
    tool_permit_policy_limit_hash, authority_epoch, status, revocation_seq,
    expires_at, revoked_at, expired_at
  )
  values (
    target_run.app_id, target_run.tenant_id, target_run.environment,
    (command_json ->> 'record_id')::uuid, 1, 'TOOL_INVOCATION_PERMIT',
    target_run.run_id, target_run.principal_id, command_json ->> 'tool_name',
    command_json ->> 'tool_version',
    command_json ->> 'arguments_schema_hash',
    command_json ->> 'arguments_hash', policy_ref, policy_version,
    target_limit.policy_limit_hash,
    (capability_json ->> 'authority_epoch')::bigint, 'ACTIVE', 0,
    (payload_json ->> 'expires_at')::timestamptz, null, null
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'permit_ref', permit_ref,
      'payload', payload_json,
      'status', 'ACTIVE',
      'revoked_at', null,
      'expired_at', null
    )
  );
end
$function$;

create function app_data_agent.settle_research_resource(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  usage_ref jsonb;
  resource_kind text;
  input_hash text;
  target_run record;
  target_reservation record;
  target_outbox record;
  target_attempt record;
  target_request record;
  target_invocation record;
  target_identity record;
  target_usage record;
  existing_transition record;
  resolved_actual_json jsonb;
  over_limit boolean;
  db_now timestamptz;
  result_state text;
  result_json jsonb;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 10
    or command_json ->> 'schema_version' <> '1.0.0'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  usage_ref := command_json -> 'invocation_outcome_usage_ref';
  select source.resource_kind
  into resource_kind
  from app_data_agent.research_resource_reservations as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid;
  if resource_kind not in ('MODEL', 'SQL', 'TOOL') then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH',
        'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESOURCE_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-resource-settle@1.0.0',
    command_json
  );

  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  select source.*
  into target_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid
  for update of source nowait;
  select source.*
  into target_outbox
  from app_data_agent.outbox as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.run_id = target_reservation.run_id
    and source.run_fence = target_reservation.worker_fence
    and source.active_attempt_id = target_reservation.attempt_id
  for update of source nowait;
  select source.*
  into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.attempt_id = target_reservation.attempt_id
    and source.outbox_id = target_outbox.outbox_id
    and source.run_id = target_reservation.run_id
    and source.worker_fence = target_reservation.worker_fence
  for update of source nowait;
  select source.*
  into target_request
  from app_data_agent.research_invocation_request_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = target_reservation.invocation_id
  for key share of source nowait;
  select source.*
  into target_invocation
  from app_data_agent.research_invocation_commits as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = (command_json ->> 'invocation_id')::uuid
  for update of source nowait;
  select source.*
  into target_identity
  from app_data_agent.research_system_record_identities as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.record_kind = 'INVOCATION_OUTCOME_USAGE'
    and source.record_id = (usage_ref ->> 'record_id')::uuid
    and source.record_version = 1
  for key share of source nowait;
  select source.*
  into target_usage
  from app_data_agent.research_invocation_outcome_usage as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.record_id = target_identity.record_id
  for key share of source nowait;
  select source.*
  into existing_transition
  from app_data_agent.research_resource_transition_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and (
      source.transition_id = (command_json ->> 'transition_id')::uuid
      or (
        source.reservation_id = target_reservation.reservation_id
        and source.principal_id = target_reservation.principal_id
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  order by source.transition_id
  limit 1
  for update of source nowait;
  if existing_transition.transition_id is not null then
    if existing_transition.input_hash <> input_hash
      or existing_transition.transition <> 'SETTLE'
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_RESERVATION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', existing_transition.result_json
    );
  end if;

  if target_run.run_id is null
    or target_reservation.state not in ('IN_USE', 'ABANDONED')
    or target_reservation.invocation_id <> (command_json ->> 'invocation_id')::uuid
    or target_reservation.resource_lease_id
      <> (command_json ->> 'resource_lease_id')::uuid
    or target_invocation.invocation_id <> target_reservation.invocation_id
    or target_invocation.outcome_usage_ref is distinct from usage_ref
    or target_identity.record_id is null
    or target_usage.record_id is null
    or target_usage.invocation_id <> target_invocation.invocation_id
    or target_usage.reservation_id <> target_reservation.reservation_id
    or target_usage.resource_lease_id <> target_reservation.resource_lease_id
    or target_usage.resource_kind <> resource_kind
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_USAGE_NOT_AUTHORITATIVE',
        'retryable', false
      )
    );
  end if;

  resolved_actual_json := target_usage.actual_json;
  over_limit := case resource_kind
    when 'MODEL' then
      (resolved_actual_json ->> 'invocations')::bigint > 1
      or (resolved_actual_json ->> 'input_tokens')::bigint
        > (target_reservation.reserved_json ->> 'input_tokens')::bigint
      or (resolved_actual_json ->> 'output_tokens')::bigint
        > (target_reservation.reserved_json ->> 'output_tokens')::bigint
      or (resolved_actual_json ->> 'cost_microusd')::bigint
        > (target_reservation.reserved_json ->> 'cost_microusd')::bigint
    when 'SQL' then
      (resolved_actual_json ->> 'executions')::bigint > 1
      or (resolved_actual_json ->> 'elapsed_ms')::bigint
        > (target_reservation.reserved_json ->> 'timeout_ms')::bigint
      or (resolved_actual_json ->> 'rows')::bigint
        > (target_reservation.reserved_json ->> 'max_rows')::bigint
      or (resolved_actual_json ->> 'bytes')::bigint
        > (target_reservation.reserved_json ->> 'max_bytes')::bigint
    else
      (resolved_actual_json ->> 'tool_calls')::bigint > 1
      or (resolved_actual_json ->> 'elapsed_ms')::bigint
        > (target_reservation.reserved_json ->> 'timeout_ms')::bigint
  end;
  if target_usage.outcome = 'COMPLETED'
    and (
      (resource_kind = 'MODEL' and resolved_actual_json ->> 'invocations' <> '1')
      or (resource_kind = 'SQL' and resolved_actual_json ->> 'executions' <> '1')
      or (resource_kind = 'TOOL' and resolved_actual_json ->> 'tool_calls' <> '1')
    )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_USAGE_NOT_AUTHORITATIVE',
        'retryable', false
      )
    );
  end if;

  db_now := pg_catalog.clock_timestamp();
  result_state := case when over_limit then 'SETTLED_OVER_LIMIT' else 'SETTLED' end;
  result_json := pg_catalog.jsonb_build_object(
    'reservation_id', target_reservation.reservation_id,
    'state', result_state,
    'reserved', target_reservation.reserved_json,
    'actual', resolved_actual_json,
    'invocation_outcome_usage_ref', usage_ref,
    'settled_at', db_now
  );
  update app_data_agent.research_resource_reservations
  set state = result_state,
      actual_json = resolved_actual_json,
      invocation_outcome_usage_ref = usage_ref,
      ended_at = db_now
  where app_id = target_reservation.app_id
    and tenant_id = target_reservation.tenant_id
    and environment = target_reservation.environment
    and reservation_id = target_reservation.reservation_id;
  insert into app_data_agent.research_resource_transition_operations (
    app_id, tenant_id, environment, transition_id, reservation_id,
    principal_id, idempotency_key, input_hash, transition,
    source_state, result_state, result_json, committed_at
  )
  values (
    target_reservation.app_id, target_reservation.tenant_id,
    target_reservation.environment, (command_json ->> 'transition_id')::uuid,
    target_reservation.reservation_id, target_reservation.principal_id,
    command_json ->> 'idempotency_key', input_hash, 'SETTLE',
    target_reservation.state, result_state, result_json, db_now
  );
  if over_limit then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_LIMIT_EXCEEDED',
        'retryable', false
      )
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_json
  );
end
$function$;

create function app_data_agent.start_research_invocation(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  resource_kind text;
  input_hash text;
  stage_name text;
  expected_transition_id uuid;
  expected_stage_key text;
  target_run record;
  target_reservation record;
  target_outbox record;
  target_attempt record;
  existing_request record;
  target_projection record;
  target_sql_artifact record;
  target_execution_permit record;
  target_permit_identity record;
  target_permit record;
  target_invocation record;
  existing_transition record;
  db_now timestamptz;
  result_json jsonb;
  request_metadata jsonb;
begin
  command_json := envelope_json -> 'command';
  resource_kind := command_json ->> 'resource_kind';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or command_json ->> 'schema_version' <> '1.0.0'
    or command_json ->> 'transition' <> 'START'
    or command_json ->> 'expected_state' <> 'AUTHORIZED'
    or resource_kind not in ('MODEL', 'SQL', 'TOOL')
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> (case resource_kind
      when 'MODEL' then 22
      when 'SQL' then 23
      else 25
    end)
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    resource_kind || '_INVOCATION_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-invocation-start@1.0.0',
    command_json
  );
  stage_name := app_data_agent.runtime_canonical_json(
    pg_catalog.jsonb_build_array(
      scope_json ->> 'app_id',
      scope_json ->> 'tenant_id',
      scope_json ->> 'environment',
      command_json ->> 'run_id',
      command_json ->> 'invocation_id',
      'START'
    )
  );
  expected_transition_id := app_data_agent.u6_uuid_v5(
    '6d8f4e9a-45d7-5c31-8f6a-6f3cf9c42b18'::uuid,
    pg_catalog.convert_to(stage_name, 'UTF8')
  );
  expected_stage_key := 'u6-invocation@1:' ||
    pg_catalog.translate(
      pg_catalog.rtrim(
        pg_catalog.encode(
          extensions.digest(pg_catalog.convert_to(stage_name, 'UTF8'), 'sha256'),
          'base64'
        ),
        '='
      ),
      '+/',
      '-_'
    );
  if (command_json ->> 'transition_id')::uuid <> expected_transition_id
    or command_json ->> 'idempotency_key' <> expected_stage_key
    or pg_catalog.jsonb_typeof(command_json -> 'outer_request_binding') <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json -> 'outer_request_binding')
    ) <> 2
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_INVOCATION_TRANSITION_CONFLICT',
        'retryable', false
      )
    );
  end if;

  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  select source.*
  into target_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid
  for update of source nowait;
  select source.*
  into target_outbox
  from app_data_agent.outbox as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.outbox_id = (
      select attempt.outbox_id
      from app_data_agent.run_attempts as attempt
      where attempt.app_id = target_reservation.app_id
        and attempt.tenant_id = target_reservation.tenant_id
        and attempt.environment = target_reservation.environment
        and attempt.attempt_id = target_reservation.attempt_id
    )
    and source.run_id = target_reservation.run_id
  for update of source nowait;
  select source.*
  into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.attempt_id = target_reservation.attempt_id
    and source.outbox_id = target_outbox.outbox_id
    and source.run_id = target_reservation.run_id
    and source.worker_fence = target_reservation.worker_fence
  for update of source nowait;

  select source.*
  into existing_request
  from app_data_agent.research_invocation_request_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and (
      source.invocation_id = (command_json ->> 'invocation_id')::uuid
      or (
        source.run_id = target_reservation.run_id
        and source.principal_id = target_reservation.principal_id
        and source.idempotency_key =
          command_json #>> '{outer_request_binding,outer_idempotency_key}'
      )
    )
  order by source.invocation_id
  limit 1
  for update of source nowait;

  if resource_kind = 'MODEL' then
    select source.*
    into target_projection
    from app_data_agent.research_system_artifacts as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.run_id = target_reservation.run_id
      and source.artifact_id =
        (command_json #>> '{projection_receipt_ref,artifact_id}')::uuid
      and source.artifact_type = 'AgentDataProjectionReceipt'
      and source.revision =
        (command_json #>> '{projection_receipt_ref,revision}')::integer
      and source.content_hash =
        command_json #>> '{projection_receipt_ref,content_hash}'
    for key share of source nowait;
  elsif resource_kind = 'SQL' then
    select source.*
    into target_sql_artifact
    from app_data_agent.artifacts as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.run_id = target_reservation.run_id
      and source.artifact_id =
        (command_json #>> '{sql_artifact_ref,artifact_id}')::uuid
      and source.artifact_type = 'SqlArtifact'
      and source.revision =
        (command_json #>> '{sql_artifact_ref,revision}')::integer
      and source.content_hash = command_json #>> '{sql_artifact_ref,content_hash}'
    for key share of source nowait;
    select source.*
    into target_execution_permit
    from app_data_agent.artifacts as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.run_id = target_reservation.run_id
      and source.artifact_id =
        (command_json #>> '{execution_permit_ref,artifact_id}')::uuid
      and source.artifact_type = 'ExecutionPermit'
      and source.revision =
        (command_json #>> '{execution_permit_ref,revision}')::integer
      and source.content_hash =
        command_json #>> '{execution_permit_ref,content_hash}'
    for key share of source nowait;
  else
    select source.*
    into target_permit_identity
    from app_data_agent.research_system_record_identities as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.record_kind = 'TOOL_INVOCATION_PERMIT'
      and source.record_id =
        (command_json #>> '{tool_invocation_permit_ref,record_id}')::uuid
      and source.record_version = 1
    for update of source nowait;
    select source.*
    into target_permit
    from app_data_agent.research_tool_invocation_permits as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.record_id = target_permit_identity.record_id
    for update of source nowait;
  end if;

  select source.*
  into target_invocation
  from app_data_agent.research_invocation_commits as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = (command_json ->> 'invocation_id')::uuid
  for update of source nowait;
  select source.*
  into existing_transition
  from app_data_agent.research_invocation_transition_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and (
      source.transition_id = expected_transition_id
      or (
        source.invocation_id = target_invocation.invocation_id
        and source.principal_id = target_reservation.principal_id
        and source.idempotency_key = expected_stage_key
      )
    )
  order by source.transition_id
  limit 1
  for update of source nowait;
  if existing_transition.transition_id is not null then
    if existing_transition.input_hash <> input_hash
      or existing_transition.transition <> 'START'
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_INVOCATION_TRANSITION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', existing_transition.result_json
    );
  end if;

  db_now := pg_catalog.clock_timestamp();
  if target_run.run_id is null
    or target_reservation.state <> 'IN_USE'
    or target_reservation.resource_kind <> resource_kind
    or target_reservation.invocation_id <> target_invocation.invocation_id
    or target_reservation.request_id <> (command_json ->> 'request_id')::uuid
    or target_reservation.resource_lease_id
      <> (command_json ->> 'resource_lease_id')::uuid
    or target_reservation.reservation_seq
      <> (command_json ->> 'reservation_seq')::bigint
    or target_reservation.canonical_request_digest
      <> command_json ->> 'canonical_request_digest'
    or target_invocation.state <> 'AUTHORIZED'
    or target_attempt.status <> 'ACTIVE'
    or target_attempt.worker_fence <> (command_json ->> 'worker_fence')::bigint
    or target_outbox.status <> 'LEASED'
    or target_outbox.active_attempt_id <> target_attempt.attempt_id
    or target_outbox.run_fence <> target_attempt.worker_fence
    or db_now >= target_attempt.lease_expires_at
    or db_now >= target_outbox.lease_expires_at
    or db_now >= target_reservation.lease_expires_at
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_AUTHORITY_FENCE_MISMATCH',
        'retryable', false
      )
    );
  end if;
  if existing_request.invocation_id is not null
    and existing_request.input_hash
      <> command_json #>> '{outer_request_binding,outer_input_hash}'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_INVOCATION_TRANSITION_CONFLICT',
        'retryable', false
      )
    );
  end if;
  if (resource_kind = 'MODEL' and target_projection.artifact_id is null)
    or (
      resource_kind = 'SQL'
      and (
        target_sql_artifact.artifact_id is null
        or target_execution_permit.artifact_id is null
      )
    )
    or (
      resource_kind = 'TOOL'
      and (
        target_permit.record_id is null
        or target_permit.run_id <> target_run.run_id
        or target_permit.principal_id <> target_run.principal_id
        or target_permit.status <> 'ACTIVE'
        or db_now >= target_permit.expires_at
      )
    )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', case resource_kind
          when 'MODEL' then 'MODEL_PROVIDER_INVOCATION_NOT_AUTHORIZED'
          when 'SQL' then 'SQL_INVOCATION_NOT_AUTHORIZED'
          else 'TOOL_INVOCATION_NOT_AUTHORIZED'
        end,
        'retryable', false
      )
    );
  end if;

  request_metadata := pg_catalog.jsonb_build_object(
    'resource_kind', resource_kind,
    'reservation_id', target_reservation.reservation_id,
    'reservation_seq', target_reservation.reservation_seq,
    'resource_lease_id', target_reservation.resource_lease_id,
    'request_id', target_reservation.request_id,
    'attempt_id', target_reservation.attempt_id,
    'worker_fence', target_reservation.worker_fence,
    'canonical_request_digest', target_reservation.canonical_request_digest,
    'outer_input_hash',
      command_json #>> '{outer_request_binding,outer_input_hash}'
  );
  if existing_request.invocation_id is null then
    insert into app_data_agent.research_invocation_request_operations (
      app_id, tenant_id, environment, invocation_id, run_id, principal_id,
      reservation_id, request_id, idempotency_key, input_hash, resource_kind,
      canonical_request_digest, request_json, outcome, completed_at
    )
    values (
      target_reservation.app_id, target_reservation.tenant_id,
      target_reservation.environment, target_invocation.invocation_id,
      target_reservation.run_id, target_reservation.principal_id,
      target_reservation.reservation_id, target_reservation.request_id,
      command_json #>> '{outer_request_binding,outer_idempotency_key}',
      command_json #>> '{outer_request_binding,outer_input_hash}',
      resource_kind, target_reservation.canonical_request_digest,
      request_metadata, 'STARTED', db_now
    );
  end if;

  update app_data_agent.research_invocation_commits
  set state = 'STARTED',
      started_at = db_now
  where app_id = target_invocation.app_id
    and tenant_id = target_invocation.tenant_id
    and environment = target_invocation.environment
    and invocation_id = target_invocation.invocation_id;
  result_json := pg_catalog.jsonb_build_object(
    'reservation_id', target_invocation.reservation_id,
    'reservation_seq', target_invocation.reservation_seq,
    'resource_lease_id', target_invocation.resource_lease_id,
    'invocation_id', target_invocation.invocation_id,
    'request_id', target_invocation.request_id,
    'attempt_id', target_invocation.attempt_id,
    'worker_fence', target_invocation.worker_fence,
    'resource_kind', target_invocation.resource_kind,
    'invocation_version', 1,
    'canonical_request_digest', target_invocation.canonical_request_digest,
    'committed_at', db_now,
    'state', 'STARTED',
    'outcome_hash', null,
    'outcome_unknown_hash', null,
    'start_created', true,
    'outer_request_replayed', existing_request.invocation_id is not null
  );
  insert into app_data_agent.research_invocation_transition_operations (
    app_id, tenant_id, environment, transition_id, invocation_id,
    principal_id, idempotency_key, input_hash, transition,
    source_state, result_state, result_json, committed_at
  )
  values (
    target_invocation.app_id, target_invocation.tenant_id,
    target_invocation.environment, expected_transition_id,
    target_invocation.invocation_id, target_invocation.principal_id,
    expected_stage_key, input_hash, 'START', 'AUTHORIZED', 'STARTED',
    result_json, db_now
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_json
  );
end
$function$;

create function app_data_agent.mark_research_invocation_outcome_unknown(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  resource_kind text;
  input_hash text;
  stage_name text;
  expected_transition_id uuid;
  expected_stage_key text;
  target_run record;
  target_reservation record;
  target_outbox record;
  target_attempt record;
  target_request record;
  target_invocation record;
  existing_transition record;
  active_preparation record;
  db_now timestamptz;
  result_json jsonb;
begin
  command_json := envelope_json -> 'command';
  resource_kind := command_json ->> 'resource_kind';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 18
    or command_json ->> 'schema_version' <> '1.0.0'
    or command_json ->> 'transition' <> 'MARK_OUTCOME_UNKNOWN'
    or command_json ->> 'expected_state' <> 'STARTED'
    or resource_kind not in ('MODEL', 'SQL', 'TOOL')
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    resource_kind || '_INVOCATION_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  stage_name := app_data_agent.runtime_canonical_json(
    pg_catalog.jsonb_build_array(
      scope_json ->> 'app_id',
      scope_json ->> 'tenant_id',
      scope_json ->> 'environment',
      command_json ->> 'run_id',
      command_json ->> 'invocation_id',
      'OUTCOME_UNKNOWN'
    )
  );
  expected_transition_id := app_data_agent.u6_uuid_v5(
    '6d8f4e9a-45d7-5c31-8f6a-6f3cf9c42b18'::uuid,
    pg_catalog.convert_to(stage_name, 'UTF8')
  );
  expected_stage_key := 'u6-invocation@1:' ||
    pg_catalog.translate(
      pg_catalog.rtrim(
        pg_catalog.encode(
          extensions.digest(pg_catalog.convert_to(stage_name, 'UTF8'), 'sha256'),
          'base64'
        ),
        '='
      ),
      '+/',
      '-_'
    );
  if (command_json ->> 'transition_id')::uuid <> expected_transition_id
    or command_json ->> 'idempotency_key' <> expected_stage_key
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_INVOCATION_TRANSITION_CONFLICT',
        'retryable', false
      )
    );
  end if;
  input_hash := app_data_agent.u6_domain_sha256(
    'research-invocation-outcome-unknown@1.0.0',
    command_json
  );
  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  select source.*
  into target_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid
  for update of source nowait;
  select source.*
  into target_outbox
  from app_data_agent.outbox as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.outbox_id = (
      select attempt.outbox_id
      from app_data_agent.run_attempts as attempt
      where attempt.app_id = target_reservation.app_id
        and attempt.tenant_id = target_reservation.tenant_id
        and attempt.environment = target_reservation.environment
        and attempt.attempt_id = target_reservation.attempt_id
    )
    and source.run_id = target_reservation.run_id
  for update of source nowait;
  select source.*
  into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.attempt_id = target_reservation.attempt_id
    and source.outbox_id = target_outbox.outbox_id
    and source.run_id = target_reservation.run_id
    and source.worker_fence = target_reservation.worker_fence
  for update of source nowait;
  select source.*
  into target_request
  from app_data_agent.research_invocation_request_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = (command_json ->> 'invocation_id')::uuid
  for update of source nowait;
  select source.*
  into target_invocation
  from app_data_agent.research_invocation_commits as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = (command_json ->> 'invocation_id')::uuid
  for update of source nowait;
  select source.*
  into existing_transition
  from app_data_agent.research_invocation_transition_operations as source
  where source.app_id = target_invocation.app_id
    and source.tenant_id = target_invocation.tenant_id
    and source.environment = target_invocation.environment
    and (
      source.transition_id = expected_transition_id
      or (
        source.invocation_id = target_invocation.invocation_id
        and source.principal_id = target_invocation.principal_id
        and source.idempotency_key = expected_stage_key
      )
    )
  order by source.transition_id
  limit 1
  for update of source nowait;
  if existing_transition.transition_id is not null then
    if existing_transition.input_hash <> input_hash
      or existing_transition.transition <> 'MARK_OUTCOME_UNKNOWN'
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_INVOCATION_TRANSITION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', existing_transition.result_json
    );
  end if;
  select source.*
  into active_preparation
  from app_data_agent.research_invocation_terminal_preparations as source
  where source.app_id = target_invocation.app_id
    and source.tenant_id = target_invocation.tenant_id
    and source.environment = target_invocation.environment
    and source.invocation_id = target_invocation.invocation_id
    and source.state in ('PREPARING', 'PREPARED')
  order by source.preparation_id
  limit 1
  for update of source nowait;
  if active_preparation.preparation_id is not null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESULT_TERMINAL_PREPARATION_BUSY',
        'retryable', true
      )
    );
  end if;
  if target_invocation.state <> 'STARTED'
    or target_invocation.resource_kind <> resource_kind
    or target_invocation.canonical_request_digest
      <> command_json ->> 'canonical_request_digest'
    or target_invocation.reservation_id <> target_reservation.reservation_id
    or target_invocation.reservation_seq
      <> (command_json ->> 'reservation_seq')::bigint
    or target_invocation.resource_lease_id
      <> (command_json ->> 'resource_lease_id')::uuid
    or target_invocation.request_id <> (command_json ->> 'request_id')::uuid
    or target_invocation.attempt_id <> (command_json ->> 'attempt_id')::uuid
    or target_invocation.worker_fence <> (command_json ->> 'worker_fence')::bigint
    or command_json ->> 'outcome_unknown_hash'
      !~ '^sha256:[0-9a-f]{64}$'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_INVOCATION_TRANSITION_CONFLICT',
        'retryable', false
      )
    );
  end if;
  db_now := pg_catalog.clock_timestamp();
  update app_data_agent.research_invocation_commits
  set state = 'OUTCOME_UNKNOWN',
      outcome_unknown_hash = command_json ->> 'outcome_unknown_hash'
  where app_id = target_invocation.app_id
    and tenant_id = target_invocation.tenant_id
    and environment = target_invocation.environment
    and invocation_id = target_invocation.invocation_id;
  result_json := pg_catalog.jsonb_build_object(
    'reservation_id', target_invocation.reservation_id,
    'reservation_seq', target_invocation.reservation_seq,
    'resource_lease_id', target_invocation.resource_lease_id,
    'invocation_id', target_invocation.invocation_id,
    'request_id', target_invocation.request_id,
    'attempt_id', target_invocation.attempt_id,
    'worker_fence', target_invocation.worker_fence,
    'resource_kind', target_invocation.resource_kind,
    'invocation_version', 2,
    'canonical_request_digest', target_invocation.canonical_request_digest,
    'committed_at', db_now,
    'state', 'OUTCOME_UNKNOWN',
    'outcome_hash', null,
    'outcome_unknown_hash', command_json ->> 'outcome_unknown_hash'
  );
  insert into app_data_agent.research_invocation_transition_operations (
    app_id, tenant_id, environment, transition_id, invocation_id,
    principal_id, idempotency_key, input_hash, transition,
    source_state, result_state, result_json, committed_at
  )
  values (
    target_invocation.app_id, target_invocation.tenant_id,
    target_invocation.environment, expected_transition_id,
    target_invocation.invocation_id, target_invocation.principal_id,
    expected_stage_key, input_hash, 'MARK_OUTCOME_UNKNOWN',
    'STARTED', 'OUTCOME_UNKNOWN', result_json, db_now
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_json
  );
end
$function$;

create function app_data_agent.abort_invocation_terminal_preparation(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  resource_kind text;
begin
  command_json := envelope_json -> 'command';
  resource_kind := command_json ->> 'resource_kind';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or command_json ->> 'schema_version' <> '1.0.0'
    or command_json ->> 'transition' <> 'ABORT_TERMINAL_PREPARATION'
    or resource_kind not in ('MODEL', 'SQL', 'TOOL')
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    resource_kind || '_INVOCATION_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  -- The current storage projection cannot atomically clear the claim,
  -- commitment and AAD groups required by the frozen ABORTED truth table.
  -- Refuse rather than invent an OUTCOME_UNKNOWN recovery receipt.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_RESULT_GOVERNANCE_REJECTED',
      'retryable', false
    )
  );
end
$function$;

create function app_data_agent.cancel_research_resource(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  termination_ref jsonb;
  usage_ref jsonb;
  resource_kind text;
  input_hash text;
  target_run record;
  target_reservation record;
  target_outbox record;
  target_attempt record;
  target_invocation record;
  termination_identity record;
  target_termination record;
  usage_identity record;
  target_usage record;
  existing_transition record;
  resolved_actual_json jsonb;
  over_limit boolean;
  db_now timestamptz;
  result_state text;
  result_json jsonb;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or command_json ->> 'schema_version' <> '1.0.0'
    or command_json ->> 'transition' <> 'CANCEL'
    or command_json ->> 'source_state' not in ('RESERVED', 'IN_USE', 'ABANDONED')
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> (case when command_json ->> 'source_state' = 'RESERVED' then 10 else 14 end)
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  select source.resource_kind
  into resource_kind
  from app_data_agent.research_resource_reservations as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid;
  if resource_kind not in ('MODEL', 'SQL', 'TOOL') then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH',
        'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESOURCE_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-resource-cancel@1.0.0',
    command_json
  );

  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  select source.*
  into target_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid
  for update of source nowait;
  if target_run.run_id is null
    or target_reservation.reservation_id is null
    or target_reservation.principal_id <> target_run.principal_id
    or target_reservation.run_id <> target_run.run_id
    or command_json ->> 'reason_code'
      not in ('CALLER_CANCELLED', 'RUN_TERMINATED', 'POLICY_REJECTED')
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_RESERVATION_CONFLICT',
        'retryable', false
      )
    );
  end if;

  if target_reservation.state <> 'RESERVED' then
    termination_ref := command_json -> 'adapter_termination_receipt_ref';
    usage_ref := command_json -> 'invocation_outcome_usage_ref';
    select source.*
    into target_outbox
    from app_data_agent.outbox as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.run_id = target_reservation.run_id
      and source.active_attempt_id = target_reservation.attempt_id
      and source.run_fence = target_reservation.worker_fence
    for update of source nowait;
    select source.*
    into target_attempt
    from app_data_agent.run_attempts as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.attempt_id = target_reservation.attempt_id
      and source.outbox_id = target_outbox.outbox_id
      and source.run_id = target_reservation.run_id
      and source.worker_fence = target_reservation.worker_fence
    for update of source nowait;
    select source.*
    into target_invocation
    from app_data_agent.research_invocation_commits as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.invocation_id = (command_json ->> 'invocation_id')::uuid
    for update of source nowait;
    select source.*
    into termination_identity
    from app_data_agent.research_system_record_identities as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.record_kind = 'ADAPTER_TERMINATION_RECEIPT'
      and source.record_id = (termination_ref ->> 'record_id')::uuid
      and source.record_version = 1
    for key share of source nowait;
    select source.*
    into target_termination
    from app_data_agent.research_adapter_termination_receipts as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.record_id = termination_identity.record_id
    for key share of source nowait;
    select source.*
    into usage_identity
    from app_data_agent.research_system_record_identities as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.record_kind = 'INVOCATION_OUTCOME_USAGE'
      and source.record_id = (usage_ref ->> 'record_id')::uuid
      and source.record_version = 1
    for key share of source nowait;
    select source.*
    into target_usage
    from app_data_agent.research_invocation_outcome_usage as source
    where source.app_id = target_reservation.app_id
      and source.tenant_id = target_reservation.tenant_id
      and source.environment = target_reservation.environment
      and source.record_id = usage_identity.record_id
    for key share of source nowait;
  end if;

  select source.*
  into existing_transition
  from app_data_agent.research_resource_transition_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and (
      source.transition_id = (command_json ->> 'transition_id')::uuid
      or (
        source.reservation_id = target_reservation.reservation_id
        and source.principal_id = target_reservation.principal_id
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  order by source.transition_id
  limit 1
  for update of source nowait;
  if existing_transition.transition_id is not null then
    if existing_transition.input_hash <> input_hash
      or existing_transition.transition <> 'CANCEL'
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_RESERVATION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', existing_transition.result_json
    );
  end if;

  if target_reservation.state <> command_json ->> 'source_state' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_RESERVATION_CONFLICT',
        'retryable', false
      )
    );
  end if;

  db_now := pg_catalog.clock_timestamp();
  if target_reservation.state = 'RESERVED' then
    result_state := 'CANCELLED';
    result_json := pg_catalog.jsonb_build_object(
      'reservation_id', target_reservation.reservation_id,
      'previous_state', 'RESERVED',
      'state', 'CANCELLED',
      'reason_code', command_json ->> 'reason_code',
      'actual', null,
      'ended_at', db_now
    );
  else
    if target_invocation.invocation_id is null
      or target_invocation.invocation_id <> target_reservation.invocation_id
      or target_termination.record_id is null
      or target_termination.invocation_id <> target_invocation.invocation_id
      or target_termination.reservation_id <> target_reservation.reservation_id
      or target_termination.resource_lease_id <> target_reservation.resource_lease_id
      or target_termination.resource_kind <> resource_kind
      or target_usage.record_id is null
      or target_usage.invocation_id <> target_invocation.invocation_id
      or target_usage.reservation_id <> target_reservation.reservation_id
      or target_usage.resource_lease_id <> target_reservation.resource_lease_id
      or target_usage.resource_kind <> resource_kind
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_OUTCOME_UNCONFIRMED',
          'retryable', true
        )
      );
    end if;
    resolved_actual_json := target_usage.actual_json;
    over_limit := case resource_kind
      when 'MODEL' then
        (resolved_actual_json ->> 'invocations')::bigint > 1
        or (resolved_actual_json ->> 'input_tokens')::bigint
          > (target_reservation.reserved_json ->> 'input_tokens')::bigint
        or (resolved_actual_json ->> 'output_tokens')::bigint
          > (target_reservation.reserved_json ->> 'output_tokens')::bigint
        or (resolved_actual_json ->> 'cost_microusd')::bigint
          > (target_reservation.reserved_json ->> 'cost_microusd')::bigint
      when 'SQL' then
        (resolved_actual_json ->> 'executions')::bigint > 1
        or (resolved_actual_json ->> 'elapsed_ms')::bigint
          > (target_reservation.reserved_json ->> 'timeout_ms')::bigint
        or (resolved_actual_json ->> 'rows')::bigint
          > (target_reservation.reserved_json ->> 'max_rows')::bigint
        or (resolved_actual_json ->> 'bytes')::bigint
          > (target_reservation.reserved_json ->> 'max_bytes')::bigint
      else
        (resolved_actual_json ->> 'tool_calls')::bigint > 1
        or (resolved_actual_json ->> 'elapsed_ms')::bigint
          > (target_reservation.reserved_json ->> 'timeout_ms')::bigint
    end;
    if over_limit then
      result_state := 'SETTLED_OVER_LIMIT';
      result_json := pg_catalog.jsonb_build_object(
        'reservation_id', target_reservation.reservation_id,
        'state', result_state,
        'reserved', target_reservation.reserved_json,
        'actual', resolved_actual_json,
        'invocation_outcome_usage_ref', usage_ref,
        'settled_at', db_now
      );
    elsif target_usage.outcome = 'COMPLETED' then
      result_state := 'SETTLED';
      result_json := pg_catalog.jsonb_build_object(
        'reservation_id', target_reservation.reservation_id,
        'state', result_state,
        'reserved', target_reservation.reserved_json,
        'actual', resolved_actual_json,
        'invocation_outcome_usage_ref', usage_ref,
        'settled_at', db_now
      );
    elsif target_usage.outcome = 'FAILED' then
      result_state := 'CANCELLED';
      result_json := pg_catalog.jsonb_build_object(
        'reservation_id', target_reservation.reservation_id,
        'previous_state', target_reservation.state,
        'state', 'CANCELLED',
        'reason_code', command_json ->> 'reason_code',
        'actual', resolved_actual_json,
        'adapter_termination_receipt_ref', termination_ref,
        'invocation_outcome_usage_ref', usage_ref,
        'ended_at', db_now
      );
    else
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_OUTCOME_UNCONFIRMED',
          'retryable', true
        )
      );
    end if;
  end if;

  update app_data_agent.research_resource_reservations
  set state = result_state,
      actual_json = resolved_actual_json,
      invocation_outcome_usage_ref = usage_ref,
      adapter_termination_receipt_ref = termination_ref,
      end_reason_code = command_json ->> 'reason_code',
      ended_at = db_now
  where app_id = target_reservation.app_id
    and tenant_id = target_reservation.tenant_id
    and environment = target_reservation.environment
    and reservation_id = target_reservation.reservation_id;
  insert into app_data_agent.research_resource_transition_operations (
    app_id, tenant_id, environment, transition_id, reservation_id,
    principal_id, idempotency_key, input_hash, transition,
    source_state, result_state, result_json, committed_at
  )
  values (
    target_reservation.app_id, target_reservation.tenant_id,
    target_reservation.environment, (command_json ->> 'transition_id')::uuid,
    target_reservation.reservation_id, target_reservation.principal_id,
    command_json ->> 'idempotency_key', input_hash, 'CANCEL',
    target_reservation.state, result_state, result_json, db_now
  );
  if result_state = 'SETTLED_OVER_LIMIT' then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_LIMIT_EXCEEDED',
        'retryable', false
      )
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_json
  );
end
$function$;

create function app_data_agent.expire_research_resource(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  resource_kind text;
  input_hash text;
  target_run record;
  target_reservation record;
  existing_transition record;
  db_now timestamptz;
  result_json jsonb;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 10
    or command_json ->> 'schema_version' <> '1.0.0'
    or command_json ->> 'transition' <> 'EXPIRE'
    or command_json ->> 'source_state' <> 'RESERVED'
    or command_json ->> 'reason_code' <> 'RESERVATION_TTL_EXPIRED'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  select source.resource_kind
  into resource_kind
  from app_data_agent.research_resource_reservations as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESOURCE_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-resource-expire@1.0.0',
    command_json
  );
  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  select source.*
  into target_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid
  for update of source nowait;
  select source.*
  into existing_transition
  from app_data_agent.research_resource_transition_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and (
      source.transition_id = (command_json ->> 'transition_id')::uuid
      or (
        source.reservation_id = target_reservation.reservation_id
        and source.principal_id = target_reservation.principal_id
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  order by source.transition_id
  limit 1
  for update of source nowait;
  if existing_transition.transition_id is not null then
    if existing_transition.input_hash <> input_hash
      or existing_transition.transition <> 'EXPIRE'
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_RESERVATION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', existing_transition.result_json
    );
  end if;
  db_now := pg_catalog.clock_timestamp();
  if target_reservation.state <> 'RESERVED'
    or db_now < target_reservation.reservation_expires_at
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_RESERVATION_CONFLICT',
        'retryable', false
      )
    );
  end if;
  result_json := pg_catalog.jsonb_build_object(
    'reservation_id', target_reservation.reservation_id,
    'previous_state', 'RESERVED',
    'state', 'EXPIRED',
    'reason_code', 'RESERVATION_TTL_EXPIRED',
    'actual', null,
    'ended_at', db_now
  );
  update app_data_agent.research_resource_reservations
  set state = 'EXPIRED',
      end_reason_code = 'RESERVATION_TTL_EXPIRED',
      ended_at = db_now
  where app_id = target_reservation.app_id
    and tenant_id = target_reservation.tenant_id
    and environment = target_reservation.environment
    and reservation_id = target_reservation.reservation_id;
  insert into app_data_agent.research_resource_transition_operations (
    app_id, tenant_id, environment, transition_id, reservation_id,
    principal_id, idempotency_key, input_hash, transition,
    source_state, result_state, result_json, committed_at
  )
  values (
    target_reservation.app_id, target_reservation.tenant_id,
    target_reservation.environment, (command_json ->> 'transition_id')::uuid,
    target_reservation.reservation_id, target_reservation.principal_id,
    command_json ->> 'idempotency_key', input_hash, 'EXPIRE',
    'RESERVED', 'EXPIRED', result_json, db_now
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_json
  );
end
$function$;

create function app_data_agent.mark_research_resource_abandoned(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  resource_kind text;
  input_hash text;
  target_run record;
  target_reservation record;
  target_outbox record;
  target_attempt record;
  target_request record;
  target_invocation record;
  existing_transition record;
  db_now timestamptz;
  result_json jsonb;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 14
    or command_json ->> 'schema_version' <> '1.0.0'
    or command_json ->> 'transition' <> 'ABANDONED'
    or command_json ->> 'source_state' <> 'IN_USE'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  select source.resource_kind
  into resource_kind
  from app_data_agent.research_resource_reservations as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESOURCE_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-resource-abandoned@1.0.0',
    command_json
  );
  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  select source.*
  into target_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid
  for update of source nowait;
  select source.*
  into target_outbox
  from app_data_agent.outbox as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.run_id = target_reservation.run_id
    and source.active_attempt_id = target_reservation.attempt_id
    and source.run_fence = target_reservation.worker_fence
  for update of source nowait;
  select source.*
  into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.attempt_id = target_reservation.attempt_id
    and source.outbox_id = target_outbox.outbox_id
    and source.run_id = target_reservation.run_id
    and source.worker_fence = target_reservation.worker_fence
  for update of source nowait;
  select source.*
  into target_request
  from app_data_agent.research_invocation_request_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = target_reservation.invocation_id
  for key share of source nowait;
  select source.*
  into target_invocation
  from app_data_agent.research_invocation_commits as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = (command_json ->> 'invocation_id')::uuid
  for update of source nowait;
  select source.*
  into existing_transition
  from app_data_agent.research_resource_transition_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and (
      source.transition_id = (command_json ->> 'transition_id')::uuid
      or (
        source.reservation_id = target_reservation.reservation_id
        and source.principal_id = target_reservation.principal_id
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  order by source.transition_id
  limit 1
  for update of source nowait;
  if existing_transition.transition_id is not null then
    if existing_transition.input_hash <> input_hash
      or existing_transition.transition <> 'ABANDONED'
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_RESERVATION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', existing_transition.result_json
    );
  end if;
  if target_reservation.state <> 'IN_USE'
    or target_reservation.invocation_id <> (command_json ->> 'invocation_id')::uuid
    or target_reservation.resource_lease_id
      <> (command_json ->> 'resource_lease_id')::uuid
    or target_reservation.attempt_id <> (command_json ->> 'attempt_id')::uuid
    or target_reservation.worker_fence <> (command_json ->> 'worker_fence')::bigint
    or target_invocation.state <> 'OUTCOME_UNKNOWN'
    or target_invocation.outcome_unknown_hash
      <> command_json ->> 'outcome_unknown_hash'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_OUTCOME_UNCONFIRMED',
        'retryable', true
      )
    );
  end if;
  db_now := pg_catalog.clock_timestamp();
  result_json := pg_catalog.jsonb_build_object(
    'reservation_id', target_reservation.reservation_id,
    'previous_state', 'IN_USE',
    'state', 'ABANDONED',
    'outcome_unknown_hash', target_invocation.outcome_unknown_hash,
    'ended_at', db_now
  );
  update app_data_agent.research_resource_reservations
  set state = 'ABANDONED',
      outcome_unknown_hash = target_invocation.outcome_unknown_hash,
      ended_at = db_now
  where app_id = target_reservation.app_id
    and tenant_id = target_reservation.tenant_id
    and environment = target_reservation.environment
    and reservation_id = target_reservation.reservation_id;
  insert into app_data_agent.research_resource_transition_operations (
    app_id, tenant_id, environment, transition_id, reservation_id,
    principal_id, idempotency_key, input_hash, transition,
    source_state, result_state, result_json, committed_at
  )
  values (
    target_reservation.app_id, target_reservation.tenant_id,
    target_reservation.environment, (command_json ->> 'transition_id')::uuid,
    target_reservation.reservation_id, target_reservation.principal_id,
    command_json ->> 'idempotency_key', input_hash, 'ABANDONED',
    'IN_USE', 'ABANDONED', result_json, db_now
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_json
  );
end
$function$;

create function app_data_agent.reserve_research_resource(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  requested_json jsonb;
  brief_ref jsonb;
  resource_kind text;
  input_hash text;
  requested_input_tokens bigint;
  requested_output_tokens bigint;
  requested_cost_microusd bigint;
  requested_timeout_ms bigint;
  requested_max_rows bigint;
  requested_max_bytes bigint;
  target_run record;
  target_brief record;
  target_head record;
  existing_reservation record;
  active_tenant_count bigint;
  active_principal_count bigint;
  consumed_input_tokens bigint;
  consumed_output_tokens bigint;
  consumed_cost_microusd bigint;
  consumed_sql_executions bigint;
  brief_input_limit bigint;
  brief_output_limit bigint;
  brief_token_run_limit bigint;
  brief_cost_run_limit bigint;
  brief_sql_limit bigint;
  next_seq bigint;
  db_now timestamptz;
  result_json jsonb;
begin
  command_json := envelope_json -> 'command';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 8
    or command_json ->> 'schema_version' <> '1.0.0'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;

  scope_json := command_json -> 'scope';
  requested_json := command_json -> 'requested';
  brief_ref := command_json -> 'research_brief_ref';
  resource_kind := requested_json ->> 'resource_kind';
  if pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(scope_json)
    ) <> 3
    or pg_catalog.jsonb_typeof(requested_json) <> 'object'
    or pg_catalog.jsonb_typeof(brief_ref) <> 'object'
    or resource_kind not in ('MODEL', 'SQL', 'TOOL')
    or command_json ->> 'idempotency_key' is null
    or pg_catalog.length(command_json ->> 'idempotency_key') not between 1 and 256
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;

  if (
    resource_kind = 'MODEL'
    and (
      (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(requested_json)
      ) <> 5
      or requested_json ->> 'input_tokens' !~ '^(0|[1-9][0-9]{0,15})$'
      or requested_json ->> 'output_tokens' !~ '^(0|[1-9][0-9]{0,15})$'
      or requested_json ->> 'cost_microusd' !~ '^(0|[1-9][0-9]{0,15})$'
      or requested_json ->> 'concurrent_slots' <> '1'
    )
  ) or (
    resource_kind = 'SQL'
    and (
      (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(requested_json)
      ) <> 6
      or requested_json ->> 'executions' <> '1'
      or requested_json ->> 'timeout_ms' !~ '^[1-9][0-9]{0,15}$'
      or requested_json ->> 'max_rows' !~ '^(0|[1-9][0-9]{0,15})$'
      or requested_json ->> 'max_bytes' !~ '^(0|[1-9][0-9]{0,15})$'
      or requested_json ->> 'concurrent_slots' <> '1'
    )
  ) or (
    resource_kind = 'TOOL'
    and (
      (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(requested_json)
      ) <> 4
      or requested_json ->> 'tool_calls' <> '1'
      or requested_json ->> 'timeout_ms' !~ '^[1-9][0-9]{0,15}$'
      or requested_json ->> 'concurrent_slots' <> '1'
    )
  ) then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;

  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESOURCE_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );

  input_hash := app_data_agent.u6_domain_sha256(
    'research-resource-reserve@1.0.0',
    command_json
  );

  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  if target_run.run_id is null then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH',
        'retryable', false
      )
    );
  end if;

  select source.*
  into target_brief
  from app_data_agent.artifacts as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.run_id = target_run.run_id
    and source.artifact_id = (brief_ref ->> 'artifact_id')::uuid
    and source.artifact_type = 'ResearchBrief'
    and source.revision = (brief_ref ->> 'revision')::integer
    and source.content_hash = brief_ref ->> 'content_hash'
    and source.is_active
  for key share of source nowait;
  if target_brief.artifact_id is null
    or brief_ref ->> 'app_id' is distinct from target_run.app_id::text
    or brief_ref ->> 'tenant_id' is distinct from target_run.tenant_id::text
    or brief_ref ->> 'environment' is distinct from target_run.environment
    or brief_ref ->> 'run_id' is distinct from target_run.run_id::text
    or target_brief.document_json #>> '{envelope,status}' <> 'COMMITTED'
    or target_brief.document_json #>> '{payload,artifact_type}' <> 'ResearchBrief'
    or target_brief.document_json #>> '{payload,protocol_version}'
      <> 'research-brief@1.0.0'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'AUTHORITY_EVIDENCE_NOT_CURRENT',
        'retryable', false
      )
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      app_data_agent.runtime_canonical_json(
        pg_catalog.jsonb_build_array(
          'u6-resource-tenant@1.0.0',
          target_run.app_id,
          target_run.tenant_id,
          target_run.environment
        )
      ),
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      app_data_agent.runtime_canonical_json(
        pg_catalog.jsonb_build_array(
          'u6-resource-principal@1.0.0',
          target_run.app_id,
          target_run.tenant_id,
          target_run.environment,
          target_run.principal_id
        )
      ),
      0
    )
  );

  select source.*
  into existing_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and (
      source.reservation_id = (command_json ->> 'reservation_id')::uuid
      or (
        source.run_id = target_run.run_id
        and source.principal_id = target_run.principal_id
        and source.reserve_idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  order by source.reservation_id
  limit 1
  for update of source nowait;
  if existing_reservation.reservation_id is not null then
    if existing_reservation.reservation_id
        <> (command_json ->> 'reservation_id')::uuid
      or existing_reservation.reserve_input_hash <> input_hash
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_RESERVATION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', pg_catalog.jsonb_build_object(
        'reservation_id', existing_reservation.reservation_id,
        'reservation_seq', existing_reservation.reservation_seq,
        'state', 'RESERVED',
        'requested', existing_reservation.requested_json,
        'reserved', existing_reservation.reserved_json,
        'expires_at', existing_reservation.reservation_expires_at
      )
    );
  end if;

  select pg_catalog.count(*)
  into active_tenant_count
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.state in ('RESERVED', 'IN_USE', 'ABANDONED');
  select pg_catalog.count(*)
  into active_principal_count
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.principal_id = target_run.principal_id
    and source.state in ('RESERVED', 'IN_USE', 'ABANDONED');
  if active_tenant_count >= 8 or active_principal_count >= 2 then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_LIMIT_EXCEEDED',
        'retryable', false
      )
    );
  end if;

  brief_input_limit := (target_brief.document_json #>>
    '{payload,budget,max_provider_input_tokens_per_call}')::bigint;
  brief_output_limit := (target_brief.document_json #>>
    '{payload,budget,max_provider_output_tokens_per_call}')::bigint;
  brief_token_run_limit := (target_brief.document_json #>>
    '{payload,budget,max_provider_tokens_per_run}')::bigint;
  brief_cost_run_limit := (target_brief.document_json #>>
    '{payload,budget,max_provider_cost_microusd_per_run}')::bigint;
  brief_sql_limit := (target_brief.document_json #>>
    '{payload,budget,max_sql_executions}')::bigint;

  if resource_kind = 'MODEL' then
    requested_input_tokens := (requested_json ->> 'input_tokens')::bigint;
    requested_output_tokens := (requested_json ->> 'output_tokens')::bigint;
    requested_cost_microusd := (requested_json ->> 'cost_microusd')::bigint;
    select
      pg_catalog.coalesce(pg_catalog.sum(
        (source.reserved_json ->> 'input_tokens')::bigint
      ), 0),
      pg_catalog.coalesce(pg_catalog.sum(
        (source.reserved_json ->> 'output_tokens')::bigint
      ), 0),
      pg_catalog.coalesce(pg_catalog.sum(
        (source.reserved_json ->> 'cost_microusd')::bigint
      ), 0)
    into consumed_input_tokens, consumed_output_tokens, consumed_cost_microusd
    from app_data_agent.research_resource_reservations as source
    where source.app_id = target_run.app_id
      and source.tenant_id = target_run.tenant_id
      and source.environment = target_run.environment
      and source.run_id = target_run.run_id
      and source.resource_kind = 'MODEL'
      and source.state in (
        'RESERVED', 'IN_USE', 'ABANDONED', 'SETTLED', 'SETTLED_OVER_LIMIT'
      );
    if requested_input_tokens > pg_catalog.least(32000, brief_input_limit)
      or requested_output_tokens > pg_catalog.least(8000, brief_output_limit)
      or requested_input_tokens + requested_output_tokens
        + consumed_input_tokens + consumed_output_tokens
        > pg_catalog.least(256000, brief_token_run_limit)
      or requested_cost_microusd + consumed_cost_microusd
        > pg_catalog.least(5000000, brief_cost_run_limit)
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_LIMIT_EXCEEDED',
          'retryable', false
        )
      );
    end if;
  elsif resource_kind = 'SQL' then
    requested_timeout_ms := (requested_json ->> 'timeout_ms')::bigint;
    requested_max_rows := (requested_json ->> 'max_rows')::bigint;
    requested_max_bytes := (requested_json ->> 'max_bytes')::bigint;
    select pg_catalog.count(*)
    into consumed_sql_executions
    from app_data_agent.research_resource_reservations as source
    where source.app_id = target_run.app_id
      and source.tenant_id = target_run.tenant_id
      and source.environment = target_run.environment
      and source.run_id = target_run.run_id
      and source.resource_kind = 'SQL'
      and source.state in (
        'RESERVED', 'IN_USE', 'ABANDONED', 'SETTLED', 'SETTLED_OVER_LIMIT'
      );
    if requested_timeout_ms > 30000
      or requested_max_rows > 10000
      or requested_max_bytes > 8388608
      or consumed_sql_executions + 1 > pg_catalog.least(16, brief_sql_limit)
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_LIMIT_EXCEEDED',
          'retryable', false
        )
      );
    end if;
  elsif (requested_json ->> 'timeout_ms')::bigint > 600000 then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_LIMIT_EXCEEDED',
        'retryable', false
      )
    );
  end if;

  insert into app_data_agent.research_resource_run_heads (
    app_id, tenant_id, environment, run_id, next_reservation_seq, updated_at
  )
  values (
    target_run.app_id, target_run.tenant_id, target_run.environment,
    target_run.run_id, 1, pg_catalog.clock_timestamp()
  )
  on conflict do nothing;

  select source.*
  into target_head
  from app_data_agent.research_resource_run_heads as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.run_id = target_run.run_id
  for update of source nowait;
  if target_head.run_id is null
    or target_head.next_reservation_seq >= 9007199254740991
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESOURCE_LIMIT_EXCEEDED',
        'retryable', false
      )
    );
  end if;

  next_seq := target_head.next_reservation_seq;
  db_now := pg_catalog.clock_timestamp();
  result_json := pg_catalog.jsonb_build_object(
    'reservation_id', command_json ->> 'reservation_id',
    'reservation_seq', next_seq,
    'state', 'RESERVED',
    'requested', requested_json,
    'reserved', requested_json,
    'expires_at', db_now + pg_catalog.make_interval(secs => 60)
  );

  insert into app_data_agent.research_resource_reservations (
    app_id, tenant_id, environment, reservation_id, run_id, principal_id,
    reservation_seq, reserve_idempotency_key, reserve_input_hash,
    research_brief_ref, resource_kind, requested_json, reserved_json, state,
    reservation_expires_at, reserved_at
  )
  values (
    target_run.app_id,
    target_run.tenant_id,
    target_run.environment,
    (command_json ->> 'reservation_id')::uuid,
    target_run.run_id,
    target_run.principal_id,
    next_seq,
    command_json ->> 'idempotency_key',
    input_hash,
    brief_ref,
    resource_kind,
    requested_json,
    requested_json,
    'RESERVED',
    db_now + pg_catalog.make_interval(secs => 60),
    db_now
  );
  update app_data_agent.research_resource_run_heads
  set next_reservation_seq = next_seq + 1,
      updated_at = db_now
  where app_id = target_run.app_id
    and tenant_id = target_run.tenant_id
    and environment = target_run.environment
    and run_id = target_run.run_id;

  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_json
  );
end
$function$;

create function app_data_agent.begin_research_resource(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  resource_kind text;
  input_hash text;
  capability_json jsonb;
  target_run record;
  target_reservation record;
  attempt_locator record;
  target_outbox record;
  target_attempt record;
  target_identity record;
  target_permit record;
  existing_transition record;
  generated_resource_lease_id uuid;
  computed_lease_expires_at timestamptz;
  db_now timestamptz;
  result_json jsonb;
begin
  command_json := envelope_json -> 'command';
  resource_kind := command_json ->> 'resource_kind';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or command_json ->> 'schema_version' <> '1.0.0'
    or resource_kind not in ('MODEL', 'SQL', 'TOOL')
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> (case when resource_kind = 'TOOL' then 14 else 13 end)
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  scope_json := command_json -> 'scope';
  capability_json := app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESOURCE_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  input_hash := app_data_agent.u6_domain_sha256(
    'research-resource-begin@1.0.0',
    command_json
  );

  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  select source.*
  into target_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid
  for update of source nowait;
  if target_run.run_id is null
    or target_reservation.reservation_id is null
    or target_reservation.run_id <> target_run.run_id
    or target_reservation.principal_id <> target_run.principal_id
    or target_reservation.resource_kind <> resource_kind
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_CAPABILITY_SCOPE_MISMATCH',
        'retryable', false
      )
    );
  end if;

  select source.outbox_id, source.run_id
  into attempt_locator
  from app_data_agent.run_attempts as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.attempt_id = (command_json ->> 'attempt_id')::uuid;
  select source.*
  into target_outbox
  from app_data_agent.outbox as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.outbox_id = attempt_locator.outbox_id
    and source.run_id = target_run.run_id
  for update of source nowait;
  select source.*
  into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.attempt_id = (command_json ->> 'attempt_id')::uuid
    and source.outbox_id = target_outbox.outbox_id
    and source.run_id = target_run.run_id
  for update of source nowait;

  if resource_kind = 'TOOL' then
    select source.*
    into target_identity
    from app_data_agent.research_system_record_identities as source
    where source.app_id = target_run.app_id
      and source.tenant_id = target_run.tenant_id
      and source.environment = target_run.environment
      and source.record_kind = 'TOOL_INVOCATION_PERMIT'
      and source.record_id =
        (command_json #>> '{tool_invocation_permit_ref,record_id}')::uuid
      and source.record_version = 1
    for update of source nowait;
    select source.*
    into target_permit
    from app_data_agent.research_tool_invocation_permits as source
    where source.app_id = target_run.app_id
      and source.tenant_id = target_run.tenant_id
      and source.environment = target_run.environment
      and source.record_id = target_identity.record_id
    for update of source nowait;
  end if;

  select source.*
  into existing_transition
  from app_data_agent.research_resource_transition_operations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and (
      source.transition_id = (command_json ->> 'transition_id')::uuid
      or (
        source.reservation_id = target_reservation.reservation_id
        and source.principal_id = target_run.principal_id
        and source.idempotency_key = command_json ->> 'idempotency_key'
      )
    )
  order by source.transition_id
  limit 1
  for update of source nowait;
  if existing_transition.transition_id is not null then
    if existing_transition.transition_id <> (command_json ->> 'transition_id')::uuid
      or existing_transition.input_hash <> input_hash
      or existing_transition.transition <> 'BEGIN'
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_RESOURCE_RESERVATION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', existing_transition.result_json
    );
  end if;

  db_now := pg_catalog.clock_timestamp();
  if target_reservation.state <> 'RESERVED'
    or db_now >= target_reservation.reservation_expires_at
    or target_attempt.attempt_id is null
    or target_attempt.status <> 'ACTIVE'
    or target_attempt.worker_fence <> (command_json ->> 'worker_fence')::bigint
    or target_outbox.status <> 'LEASED'
    or target_outbox.active_attempt_id <> target_attempt.attempt_id
    or target_outbox.run_fence <> target_attempt.worker_fence
    or db_now >= target_attempt.lease_expires_at
    or db_now >= target_outbox.lease_expires_at
    or pg_catalog.least(
      target_attempt.lease_expires_at,
      target_outbox.lease_expires_at
    ) - db_now < pg_catalog.make_interval(secs => 5)
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_AUTHORITY_FENCE_MISMATCH',
        'retryable', false
      )
    );
  end if;
  if resource_kind = 'TOOL'
    and (
      target_permit.record_id is null
      or target_permit.run_id <> target_run.run_id
      or target_permit.principal_id <> target_run.principal_id
      or target_permit.status <> 'ACTIVE'
      or db_now >= target_permit.expires_at
    )
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_SYSTEM_RECORD_NOT_ACTIVE',
        'retryable', false
      )
    );
  end if;

  generated_resource_lease_id := extensions.gen_random_uuid();
  computed_lease_expires_at := pg_catalog.least(
    db_now + pg_catalog.make_interval(secs => 900),
    target_attempt.lease_expires_at,
    target_outbox.lease_expires_at
  );
  result_json := pg_catalog.jsonb_build_object(
    'reservation_id', target_reservation.reservation_id,
    'reservation_seq', target_reservation.reservation_seq,
    'state', 'IN_USE',
    'invocation_id', command_json ->> 'invocation_id',
    'resource_lease_id', generated_resource_lease_id,
    'request_id', command_json ->> 'request_id',
    'lease_expires_at', computed_lease_expires_at,
    'resource_kind', resource_kind,
    'canonical_request_digest', command_json ->> 'canonical_request_digest'
  );
  if resource_kind = 'TOOL' then
    result_json := result_json || pg_catalog.jsonb_build_object(
      'tool_invocation_permit_ref', command_json -> 'tool_invocation_permit_ref'
    );
  end if;

  insert into app_data_agent.research_invocation_commits (
    app_id, tenant_id, environment, invocation_id, run_id, principal_id,
    reservation_id, reservation_seq, resource_lease_id, request_id,
    attempt_id, outbox_id, worker_fence, resource_kind,
    canonical_request_digest, authority_epoch, state, created_at
  )
  values (
    target_run.app_id, target_run.tenant_id, target_run.environment,
    (command_json ->> 'invocation_id')::uuid,
    target_run.run_id, target_run.principal_id, target_reservation.reservation_id,
    target_reservation.reservation_seq, generated_resource_lease_id,
    (command_json ->> 'request_id')::uuid, target_attempt.attempt_id,
    target_outbox.outbox_id, target_attempt.worker_fence, resource_kind,
    command_json ->> 'canonical_request_digest',
    (capability_json ->> 'authority_epoch')::bigint, 'AUTHORIZED', db_now
  );
  update app_data_agent.research_resource_reservations
  set state = 'IN_USE',
      invocation_id = (command_json ->> 'invocation_id')::uuid,
      request_id = (command_json ->> 'request_id')::uuid,
      resource_lease_id = generated_resource_lease_id,
      canonical_request_digest = command_json ->> 'canonical_request_digest',
      attempt_id = target_attempt.attempt_id,
      worker_fence = target_attempt.worker_fence,
      lease_expires_at = computed_lease_expires_at,
      begun_at = db_now
  where app_id = target_reservation.app_id
    and tenant_id = target_reservation.tenant_id
    and environment = target_reservation.environment
    and reservation_id = target_reservation.reservation_id;
  insert into app_data_agent.research_resource_transition_operations (
    app_id, tenant_id, environment, transition_id, reservation_id,
    principal_id, idempotency_key, input_hash, transition,
    source_state, result_state, result_json, committed_at
  )
  values (
    target_run.app_id, target_run.tenant_id, target_run.environment,
    (command_json ->> 'transition_id')::uuid, target_reservation.reservation_id,
    target_run.principal_id, command_json ->> 'idempotency_key', input_hash,
    'BEGIN', 'RESERVED', 'IN_USE', result_json, db_now
  );

  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_json
  );
end
$function$;

create function app_data_agent.prepare_invocation_terminal(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  resource_kind text;
begin
  command_json := envelope_json -> 'command';
  resource_kind := command_json ->> 'resource_kind';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or command_json ->> 'schema_version' <> '1.0.0'
    or resource_kind not in ('MODEL', 'SQL', 'TOOL')
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    resource_kind || '_INVOCATION_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  -- A claim is useful only if the database can preserve the complete
  -- CLAIMED/COMMITTED/TOMBSTONED/ABORTED nullable truth table and both key
  -- metadata bindings. The current physical projection cannot do that
  -- without retaining fields that the frozen contract requires cleared.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'RESEARCH_RESULT_KEY_ROTATION_CONFLICT',
      'retryable', true
    )
  );
end
$function$;

create function app_data_agent.commit_invocation_terminal(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  terminal_actual_json jsonb;
  resource_kind text;
  input_hash text;
  stage_name text;
  stage_code text;
  expected_transition_id uuid;
  expected_stage_key text;
  target_run record;
  target_reservation record;
  target_outbox record;
  target_attempt record;
  target_request record;
  target_invocation record;
  existing_transition record;
  conflicting_preparation record;
  capability_json jsonb;
  db_now timestamptz;
  usage_payload jsonb;
  outcome_hash text;
  usage_content_hash text;
  generated_outcome_usage_ref jsonb;
  result_json jsonb;
  actual_count bigint;
  terminal_error_code text;
begin
  command_json := envelope_json -> 'command';
  resource_kind := command_json ->> 'resource_kind';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or command_json ->> 'schema_version' <> '1.0.0'
    or command_json ->> 'command_kind'
      not in ('FAILED_TERMINAL', 'ENCRYPTED_RESULT_TERMINAL')
    or resource_kind not in ('MODEL', 'SQL', 'TOOL')
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  capability_json := app_data_agent.lock_u6_authority_capability(
    envelope_json,
    resource_kind || '_INVOCATION_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  if command_json ->> 'command_kind' = 'ENCRYPTED_RESULT_TERMINAL' then
    -- Never acknowledge encrypted completion without a safely committed
    -- preparation/key/AAD/blob graph. The server may retry after the storage
    -- projection and key lifecycle are installed; no rows are written here.
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_RESULT_INTEGRITY_FAILURE',
        'retryable', false
      )
    );
  end if;
  if (
    select pg_catalog.count(*)
    from pg_catalog.jsonb_object_keys(command_json)
  ) <> 14
    or command_json ->> 'outcome' <> 'FAILED'
    or command_json ->> 'expected_state'
      not in ('AUTHORIZED', 'STARTED', 'OUTCOME_UNKNOWN')
    or pg_catalog.jsonb_typeof(command_json -> 'actual') <> 'object'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;

  scope_json := command_json -> 'scope';
  terminal_actual_json := command_json -> 'actual';
  terminal_error_code := command_json ->> 'error_code';
  if (resource_kind = 'MODEL' and (
      (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(terminal_actual_json)
      ) <> 5
      or terminal_actual_json ->> 'resource_kind' <> 'MODEL'
      or terminal_actual_json ->> 'invocations' not in ('0', '1')
      or terminal_actual_json ->> 'input_tokens' !~ '^(0|[1-9][0-9]{0,15})$'
      or terminal_actual_json ->> 'output_tokens' !~ '^(0|[1-9][0-9]{0,15})$'
      or terminal_actual_json ->> 'cost_microusd' !~ '^(0|[1-9][0-9]{0,15})$'
      or terminal_error_code not in (
        'MODEL_PROVIDER_REJECTED', 'MODEL_PROVIDER_ERROR',
        'MODEL_PROVIDER_RATE_LIMITED', 'MODEL_TIMEOUT', 'MODEL_CANCELLED',
        'MODEL_RESULT_INVALID', 'MODEL_RESULT_GOVERNANCE_REJECTED'
      )
    ))
    or (resource_kind = 'SQL' and (
      (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(terminal_actual_json)
      ) <> 5
      or terminal_actual_json ->> 'resource_kind' <> 'SQL'
      or terminal_actual_json ->> 'executions' not in ('0', '1')
      or terminal_actual_json ->> 'elapsed_ms' !~ '^(0|[1-9][0-9]{0,15})$'
      or terminal_actual_json ->> 'rows' !~ '^(0|[1-9][0-9]{0,15})$'
      or terminal_actual_json ->> 'bytes' !~ '^(0|[1-9][0-9]{0,15})$'
      or terminal_error_code not in (
        'SQL_EXECUTION_FAILED', 'SQL_TIMEOUT', 'SQL_CANCELLED',
        'SQL_RESULT_INVALID', 'SQL_RESULT_GOVERNANCE_REJECTED'
      )
    ))
    or (resource_kind = 'TOOL' and (
      (
        select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(terminal_actual_json)
      ) <> 3
      or terminal_actual_json ->> 'resource_kind' <> 'TOOL'
      or terminal_actual_json ->> 'tool_calls' not in ('0', '1')
      or terminal_actual_json ->> 'elapsed_ms' !~ '^(0|[1-9][0-9]{0,15})$'
      or terminal_error_code not in (
        'TOOL_EXECUTION_FAILED', 'TOOL_TIMEOUT', 'TOOL_CANCELLED',
        'TOOL_RESULT_INVALID', 'TOOL_RESULT_GOVERNANCE_REJECTED'
      )
    ))
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  actual_count := case resource_kind
    when 'MODEL' then (terminal_actual_json ->> 'invocations')::bigint
    when 'SQL' then (terminal_actual_json ->> 'executions')::bigint
    else (terminal_actual_json ->> 'tool_calls')::bigint
  end;
  if command_json ->> 'expected_state' = 'AUTHORIZED' and actual_count <> 0 then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_INVOCATION_TERMINAL_CONFLICT',
        'retryable', false
      )
    );
  end if;

  stage_code := case
    when command_json ->> 'expected_state' = 'OUTCOME_UNKNOWN'
      then 'TERMINAL_LATE'
    else 'TERMINAL_INITIAL'
  end;
  stage_name := app_data_agent.runtime_canonical_json(
    pg_catalog.jsonb_build_array(
      scope_json ->> 'app_id',
      scope_json ->> 'tenant_id',
      scope_json ->> 'environment',
      command_json ->> 'run_id',
      command_json ->> 'invocation_id',
      stage_code
    )
  );
  expected_transition_id := app_data_agent.u6_uuid_v5(
    '6d8f4e9a-45d7-5c31-8f6a-6f3cf9c42b18'::uuid,
    pg_catalog.convert_to(stage_name, 'UTF8')
  );
  expected_stage_key := 'u6-invocation@1:' ||
    pg_catalog.translate(
      pg_catalog.rtrim(
        pg_catalog.encode(
          extensions.digest(pg_catalog.convert_to(stage_name, 'UTF8'), 'sha256'),
          'base64'
        ),
        '='
      ),
      '+/',
      '-_'
    );
  if (command_json ->> 'transition_id')::uuid <> expected_transition_id
    or command_json ->> 'idempotency_key' <> expected_stage_key
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_INVOCATION_TRANSITION_CONFLICT',
        'retryable', false
      )
    );
  end if;
  input_hash := app_data_agent.u6_domain_sha256(
    'research-invocation-failed-terminal@1.0.0',
    command_json
  );

  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  select source.*
  into target_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.reservation_id = (
      select invocation.reservation_id
      from app_data_agent.research_invocation_commits as invocation
      where invocation.app_id = target_run.app_id
        and invocation.tenant_id = target_run.tenant_id
        and invocation.environment = target_run.environment
        and invocation.invocation_id = (command_json ->> 'invocation_id')::uuid
    )
  for update of source nowait;
  select source.*
  into target_outbox
  from app_data_agent.outbox as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.outbox_id = (
      select attempt.outbox_id
      from app_data_agent.run_attempts as attempt
      where attempt.app_id = target_reservation.app_id
        and attempt.tenant_id = target_reservation.tenant_id
        and attempt.environment = target_reservation.environment
        and attempt.attempt_id = target_reservation.attempt_id
    )
    and source.run_id = target_reservation.run_id
  for update of source nowait;
  select source.*
  into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.attempt_id = target_reservation.attempt_id
    and source.outbox_id = target_outbox.outbox_id
    and source.run_id = target_reservation.run_id
    and source.worker_fence = target_reservation.worker_fence
  for update of source nowait;
  select source.*
  into target_request
  from app_data_agent.research_invocation_request_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = (command_json ->> 'invocation_id')::uuid
  for key share of source nowait;
  select source.*
  into target_invocation
  from app_data_agent.research_invocation_commits as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = (command_json ->> 'invocation_id')::uuid
  for update of source nowait;
  select source.*
  into existing_transition
  from app_data_agent.research_invocation_transition_operations as source
  where source.app_id = target_invocation.app_id
    and source.tenant_id = target_invocation.tenant_id
    and source.environment = target_invocation.environment
    and (
      source.transition_id = expected_transition_id
      or (
        source.invocation_id = target_invocation.invocation_id
        and source.principal_id = target_invocation.principal_id
        and source.idempotency_key = expected_stage_key
      )
    )
  order by source.transition_id
  limit 1
  for update of source nowait;
  if existing_transition.transition_id is not null then
    if existing_transition.input_hash <> input_hash
      or existing_transition.transition <> 'COMMIT_TERMINAL'
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_INVOCATION_TERMINAL_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', existing_transition.result_json
    );
  end if;
  select source.*
  into conflicting_preparation
  from app_data_agent.research_invocation_terminal_preparations as source
  where source.app_id = target_invocation.app_id
    and source.tenant_id = target_invocation.tenant_id
    and source.environment = target_invocation.environment
    and source.invocation_id = target_invocation.invocation_id
    and source.state <> 'ABORTED'
  order by source.preparation_id
  limit 1
  for update of source nowait;
  if target_run.run_id is null
    or target_invocation.state <> command_json ->> 'expected_state'
    or target_invocation.resource_kind <> resource_kind
    or target_invocation.invocation_id <> (command_json ->> 'invocation_id')::uuid
    or target_invocation.principal_id <> (command_json ->> 'principal_id')::uuid
    or target_invocation.reservation_id <> target_reservation.reservation_id
    or (
      command_json ->> 'expected_state' <> 'AUTHORIZED'
      and target_request.invocation_id is null
    )
    or (
      command_json ->> 'expected_state' = 'OUTCOME_UNKNOWN'
      and exists (
        select 1
        from app_data_agent.research_invocation_terminal_preparations as preparation
        where preparation.app_id = target_invocation.app_id
          and preparation.tenant_id = target_invocation.tenant_id
          and preparation.environment = target_invocation.environment
          and preparation.invocation_id = target_invocation.invocation_id
          and preparation.state = 'ABORTED'
          and preparation.idempotency_key like '%TERMINAL_LATE%'
      )
    )
    or conflicting_preparation.preparation_id is not null
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_INVOCATION_TERMINAL_CONFLICT',
        'retryable', false
      )
    );
  end if;

  db_now := pg_catalog.clock_timestamp();
  usage_payload := pg_catalog.jsonb_build_object(
    'protocol_version', 'invocation-outcome-usage@1.0.0',
    'scope', scope_json,
    'run_id', target_invocation.run_id,
    'principal_id', target_invocation.principal_id,
    'reservation_id', target_invocation.reservation_id,
    'reservation_seq', target_invocation.reservation_seq,
    'resource_lease_id', target_invocation.resource_lease_id,
    'invocation_id', target_invocation.invocation_id,
    'request_id', target_invocation.request_id,
    'attempt_id', target_invocation.attempt_id,
    'worker_fence', target_invocation.worker_fence,
    'canonical_request_digest', target_invocation.canonical_request_digest,
    'resource_kind', resource_kind,
    'observed_at', db_now,
    'outcome', 'FAILED',
    'actual', terminal_actual_json,
    'completion_binding', null,
    'error_code', terminal_error_code
  );
  outcome_hash := app_data_agent.u6_domain_sha256(
    'invocation-outcome-usage@1.0.0',
    usage_payload
  );
  usage_payload := usage_payload || pg_catalog.jsonb_build_object(
    'outcome_hash', outcome_hash
  );
  usage_content_hash := app_data_agent.runtime_canonical_sha256(usage_payload);
  generated_outcome_usage_ref := pg_catalog.jsonb_build_object(
    'record_kind', 'INVOCATION_OUTCOME_USAGE',
    'record_id', command_json ->> 'outcome_usage_record_id',
    'scope', scope_json,
    'run_id', target_invocation.run_id,
    'record_version', 1,
    'content_hash', usage_content_hash,
    'commit_id', expected_transition_id,
    'adapter_kind', resource_kind,
    'owner_kind', resource_kind || '_ADAPTER_AUTHORITY',
    'commit_capability', resource_kind || '_INVOCATION_AUTHORITY',
    'producer', resource_kind || '_ADAPTER',
    'store', 'research_invocation_outcome_usage',
    'resolver_capability', 'RESOURCE_AUTHORITY',
    'commit', 'commit_invocation_terminal@1.0.0',
    'resolver', 'resolve_committed_invocation_outcome_usage@1.0.0',
    'status', 'COMMITTED',
    'authority_epoch', (capability_json ->> 'authority_epoch')::bigint,
    'expires_at', null,
    'revocation_seq', 0
  );
  insert into app_data_agent.research_system_record_identities (
    app_id, tenant_id, environment, record_kind, record_id, record_version,
    run_id, principal_id, content_hash, commit_id, authority_epoch, committed_at
  )
  values (
    target_invocation.app_id, target_invocation.tenant_id,
    target_invocation.environment, 'INVOCATION_OUTCOME_USAGE',
    (command_json ->> 'outcome_usage_record_id')::uuid, 1,
    target_invocation.run_id, target_invocation.principal_id,
    usage_content_hash, expected_transition_id,
    (capability_json ->> 'authority_epoch')::bigint, db_now
  );
  insert into app_data_agent.research_invocation_outcome_usage (
    app_id, tenant_id, environment, record_id, record_version, record_kind,
    run_id, principal_id, invocation_id, reservation_id, resource_lease_id,
    resource_kind, outcome, actual_json, completion_binding, error_code,
    outcome_hash, observed_at
  )
  values (
    target_invocation.app_id, target_invocation.tenant_id,
    target_invocation.environment,
    (command_json ->> 'outcome_usage_record_id')::uuid, 1,
    'INVOCATION_OUTCOME_USAGE', target_invocation.run_id,
    target_invocation.principal_id, target_invocation.invocation_id,
    target_invocation.reservation_id, target_invocation.resource_lease_id,
    resource_kind, 'FAILED', terminal_actual_json, null,
    terminal_error_code, outcome_hash, db_now
  );
  update app_data_agent.research_invocation_commits
  set state = 'FAILED',
      outcome_unknown_hash = null,
      result_ref = null,
      secure_execution_receipt_ref = null,
      outcome_usage_ref = generated_outcome_usage_ref,
      error_code = terminal_error_code,
      terminal_hash = outcome_hash,
      terminal_at = db_now
  where app_id = target_invocation.app_id
    and tenant_id = target_invocation.tenant_id
    and environment = target_invocation.environment
    and invocation_id = target_invocation.invocation_id;
  result_json := pg_catalog.jsonb_build_object(
    'reservation_id', target_invocation.reservation_id,
    'reservation_seq', target_invocation.reservation_seq,
    'resource_lease_id', target_invocation.resource_lease_id,
    'invocation_id', target_invocation.invocation_id,
    'request_id', target_invocation.request_id,
    'attempt_id', target_invocation.attempt_id,
    'worker_fence', target_invocation.worker_fence,
    'canonical_request_digest', target_invocation.canonical_request_digest,
    'committed_at', db_now,
    'outcome_hash', outcome_hash,
    'outcome_usage_ref', generated_outcome_usage_ref,
    'resource_kind', resource_kind,
    'adapter_method', case resource_kind
      when 'MODEL' then 'MODEL_PROVIDER'
      when 'SQL' then 'SQL_EXECUTOR'
      else 'TOOL_ADAPTER'
    end,
    'state', 'FAILED',
    'result_ref', null,
    'secure_execution_receipt_ref',
      case when resource_kind = 'SQL' then null else null end,
    'output_binding', null,
    'error_code', error_code,
    'usage', actual_json
  );
  insert into app_data_agent.research_invocation_transition_operations (
    app_id, tenant_id, environment, transition_id, invocation_id,
    principal_id, idempotency_key, input_hash, transition,
    source_state, result_state, result_json, committed_at
  )
  values (
    target_invocation.app_id, target_invocation.tenant_id,
    target_invocation.environment, expected_transition_id,
    target_invocation.invocation_id, target_invocation.principal_id,
    expected_stage_key, input_hash, 'COMMIT_TERMINAL',
    command_json ->> 'expected_state', 'FAILED', result_json, db_now
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_json
  );
end
$function$;

create function app_data_agent.commit_adapter_termination_receipt(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  resource_kind text;
  input_hash text;
  capability_json jsonb;
  target_run record;
  target_reservation record;
  target_outbox record;
  target_attempt record;
  target_request record;
  target_invocation record;
  existing_identity record;
  existing_receipt record;
  db_now timestamptz;
  payload_json jsonb;
  content_hash text;
  result_ref jsonb;
begin
  command_json := envelope_json -> 'command';
  resource_kind := command_json ->> 'resource_kind';
  if command_json is null
    or pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(command_json)
    ) <> 18
    or command_json ->> 'schema_version' <> '1.0.0'
    or command_json ->> 'termination' <> 'TERMINATED'
    or resource_kind not in ('MODEL', 'SQL', 'TOOL')
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_DATABASE_CONTRACT_INVALID',
        'retryable', false
      )
    );
  end if;
  capability_json := app_data_agent.lock_u6_authority_capability(
    envelope_json,
    resource_kind || '_INVOCATION_AUTHORITY',
    null,
    null,
    resource_kind,
    true
  );
  scope_json := command_json -> 'scope';
  input_hash := app_data_agent.u6_domain_sha256(
    'adapter-termination-receipt@1.0.0',
    command_json
  );
  select source.*
  into target_run
  from app_data_agent.runs as source
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
  for update of source nowait;
  select source.*
  into target_reservation
  from app_data_agent.research_resource_reservations as source
  where source.app_id = target_run.app_id
    and source.tenant_id = target_run.tenant_id
    and source.environment = target_run.environment
    and source.reservation_id = (command_json ->> 'reservation_id')::uuid
  for update of source nowait;
  select source.*
  into target_outbox
  from app_data_agent.outbox as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.outbox_id = (
      select attempt.outbox_id
      from app_data_agent.run_attempts as attempt
      where attempt.app_id = target_reservation.app_id
        and attempt.tenant_id = target_reservation.tenant_id
        and attempt.environment = target_reservation.environment
        and attempt.attempt_id = target_reservation.attempt_id
    )
    and source.run_id = target_reservation.run_id
  for update of source nowait;
  select source.*
  into target_attempt
  from app_data_agent.run_attempts as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.attempt_id = target_reservation.attempt_id
    and source.outbox_id = target_outbox.outbox_id
    and source.run_id = target_reservation.run_id
    and source.worker_fence = target_reservation.worker_fence
  for update of source nowait;
  select source.*
  into target_request
  from app_data_agent.research_invocation_request_operations as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = (command_json ->> 'invocation_id')::uuid
  for key share of source nowait;
  select source.*
  into target_invocation
  from app_data_agent.research_invocation_commits as source
  where source.app_id = target_reservation.app_id
    and source.tenant_id = target_reservation.tenant_id
    and source.environment = target_reservation.environment
    and source.invocation_id = (command_json ->> 'invocation_id')::uuid
  for update of source nowait;
  select source.*
  into existing_identity
  from app_data_agent.research_system_record_identities as source
  where source.app_id = target_invocation.app_id
    and source.tenant_id = target_invocation.tenant_id
    and source.environment = target_invocation.environment
    and source.record_kind = 'ADAPTER_TERMINATION_RECEIPT'
    and source.record_id = (command_json ->> 'record_id')::uuid
    and source.record_version = 1
  for update of source nowait;
  if existing_identity.record_id is not null then
    select source.*
    into existing_receipt
    from app_data_agent.research_adapter_termination_receipts as source
    where source.app_id = existing_identity.app_id
      and source.tenant_id = existing_identity.tenant_id
      and source.environment = existing_identity.environment
      and source.record_id = existing_identity.record_id
    for key share of source nowait;
    if existing_identity.commit_id <> (command_json ->> 'transition_id')::uuid
      or existing_receipt.payload_json ->> 'input_hash' <> input_hash
    then
      return pg_catalog.jsonb_build_object(
        'protocol_version', 'u6-db-result@1.0.0',
        'ok', false,
        'error', pg_catalog.jsonb_build_object(
          'code', 'RESEARCH_SYSTEM_RECORD_TRANSITION_CONFLICT',
          'retryable', false
        )
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', existing_receipt.payload_json -> 'ref'
    );
  end if;
  if target_invocation.invocation_id is null
    or target_invocation.reservation_id <> target_reservation.reservation_id
    or target_invocation.reservation_seq
      <> (command_json ->> 'reservation_seq')::bigint
    or target_invocation.resource_lease_id
      <> (command_json ->> 'resource_lease_id')::uuid
    or target_invocation.request_id <> (command_json ->> 'request_id')::uuid
    or target_invocation.attempt_id <> (command_json ->> 'attempt_id')::uuid
    or target_invocation.worker_fence <> (command_json ->> 'worker_fence')::bigint
    or target_invocation.resource_kind <> resource_kind
    or target_invocation.canonical_request_digest
      <> command_json ->> 'canonical_request_digest'
    or command_json ->> 'termination_digest' !~ '^sha256:[0-9a-f]{64}$'
  then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', false,
      'error', pg_catalog.jsonb_build_object(
        'code', 'RESEARCH_SYSTEM_RECORD_BINDING_MISMATCH',
        'retryable', false
      )
    );
  end if;
  db_now := pg_catalog.clock_timestamp();
  payload_json := pg_catalog.jsonb_build_object(
    'protocol_version', 'adapter-termination@1.0.0',
    'scope', scope_json,
    'run_id', target_invocation.run_id,
    'principal_id', target_invocation.principal_id,
    'reservation_id', target_invocation.reservation_id,
    'reservation_seq', target_invocation.reservation_seq,
    'resource_lease_id', target_invocation.resource_lease_id,
    'invocation_id', target_invocation.invocation_id,
    'request_id', target_invocation.request_id,
    'attempt_id', target_invocation.attempt_id,
    'worker_fence', target_invocation.worker_fence,
    'resource_kind', resource_kind,
    'canonical_request_digest', target_invocation.canonical_request_digest,
    'termination', 'TERMINATED',
    'termination_digest', command_json ->> 'termination_digest',
    'terminated_at', db_now,
    'input_hash', input_hash
  );
  content_hash := app_data_agent.runtime_canonical_sha256(
    payload_json - 'input_hash'
  );
  result_ref := pg_catalog.jsonb_build_object(
    'record_kind', 'ADAPTER_TERMINATION_RECEIPT',
    'record_id', command_json ->> 'record_id',
    'scope', scope_json,
    'run_id', target_invocation.run_id,
    'record_version', 1,
    'content_hash', content_hash,
    'commit_id', command_json ->> 'transition_id',
    'adapter_kind', resource_kind,
    'owner_kind', resource_kind || '_ADAPTER_AUTHORITY',
    'commit_capability', resource_kind || '_INVOCATION_AUTHORITY',
    'producer', resource_kind || '_ADAPTER',
    'store', 'research_adapter_termination_receipts',
    'resolver_capability', 'RESOURCE_AUTHORITY',
    'commit', 'commit_adapter_termination_receipt@1.0.0',
    'resolver', 'resolve_committed_adapter_termination_receipt@1.0.0',
    'status', 'COMMITTED',
    'authority_epoch', (capability_json ->> 'authority_epoch')::bigint,
    'expires_at', null,
    'revocation_seq', 0
  );
  payload_json := payload_json || pg_catalog.jsonb_build_object('ref', result_ref);
  insert into app_data_agent.research_system_record_identities (
    app_id, tenant_id, environment, record_kind, record_id, record_version,
    run_id, principal_id, content_hash, commit_id, authority_epoch, committed_at
  )
  values (
    target_invocation.app_id, target_invocation.tenant_id,
    target_invocation.environment, 'ADAPTER_TERMINATION_RECEIPT',
    (command_json ->> 'record_id')::uuid, 1, target_invocation.run_id,
    target_invocation.principal_id, content_hash,
    (command_json ->> 'transition_id')::uuid,
    (capability_json ->> 'authority_epoch')::bigint, db_now
  );
  insert into app_data_agent.research_adapter_termination_receipts (
    app_id, tenant_id, environment, record_id, record_version, record_kind,
    run_id, principal_id, invocation_id, reservation_id, resource_lease_id,
    resource_kind, canonical_request_digest, termination_digest,
    payload_json, committed_at
  )
  values (
    target_invocation.app_id, target_invocation.tenant_id,
    target_invocation.environment, (command_json ->> 'record_id')::uuid,
    1, 'ADAPTER_TERMINATION_RECEIPT', target_invocation.run_id,
    target_invocation.principal_id, target_invocation.invocation_id,
    target_invocation.reservation_id, target_invocation.resource_lease_id,
    resource_kind, target_invocation.canonical_request_digest,
    command_json ->> 'termination_digest', payload_json, db_now
  );
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', result_ref
  );
end
$function$;
create function app_data_agent.resolve_invocation_terminal_preparation_recovery_metadata(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  requested_app_id uuid;
  requested_tenant_id uuid;
  requested_environment text;
  requested_run_id uuid;
  requested_principal_id uuid;
  requested_reservation_id uuid;
  requested_reservation_seq bigint;
  requested_resource_lease_id uuid;
  requested_invocation_id uuid;
  requested_request_id uuid;
  requested_attempt_id uuid;
  requested_worker_fence bigint;
  requested_resource_kind text;
  requested_terminal_stage text;
  expected_authority_kind text;
  preparation record;
begin
  command_json := envelope_json -> 'command';
  scope_json := command_json -> 'scope';
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 13
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or command_json ->> 'resource_kind' not in ('MODEL', 'SQL', 'TOOL')
    or command_json ->> 'terminal_stage' not in ('TERMINAL_INITIAL', 'TERMINAL_LATE')
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  begin
    requested_app_id := (scope_json ->> 'app_id')::uuid;
    requested_tenant_id := (scope_json ->> 'tenant_id')::uuid;
    requested_environment := scope_json ->> 'environment';
    requested_run_id := (command_json ->> 'run_id')::uuid;
    requested_principal_id := (command_json ->> 'principal_id')::uuid;
    requested_reservation_id := (command_json ->> 'reservation_id')::uuid;
    requested_reservation_seq := (command_json ->> 'reservation_seq')::bigint;
    requested_resource_lease_id := (command_json ->> 'resource_lease_id')::uuid;
    requested_invocation_id := (command_json ->> 'invocation_id')::uuid;
    requested_request_id := (command_json ->> 'request_id')::uuid;
    requested_attempt_id := (command_json ->> 'attempt_id')::uuid;
    requested_worker_fence := (command_json ->> 'worker_fence')::bigint;
    requested_resource_kind := command_json ->> 'resource_kind';
    requested_terminal_stage := command_json ->> 'terminal_stage';
  exception
    when invalid_text_representation then
      raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end;
  expected_authority_kind :=
    case requested_resource_kind
      when 'MODEL' then 'MODEL_INVOCATION_AUTHORITY'
      when 'SQL' then 'SQL_INVOCATION_AUTHORITY'
      when 'TOOL' then 'TOOL_INVOCATION_AUTHORITY'
    end;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    expected_authority_kind,
    null,
    null,
    requested_resource_kind,
    false
  );
  select source.*
  into preparation
  from app_data_agent.research_invocation_terminal_preparations as source
  join app_data_agent.research_invocation_commits as invocation
    on invocation.app_id = source.app_id
   and invocation.tenant_id = source.tenant_id
   and invocation.environment = source.environment
   and invocation.invocation_id = source.invocation_id
  where source.app_id = requested_app_id
    and source.tenant_id = requested_tenant_id
    and source.environment = requested_environment
    and source.run_id = requested_run_id
    and source.principal_id = requested_principal_id
    and source.invocation_id = requested_invocation_id
    and source.resource_kind = requested_resource_kind
    and source.state in ('PREPARING', 'ABORTED')
    and invocation.reservation_id = requested_reservation_id
    and invocation.reservation_seq = requested_reservation_seq
    and invocation.resource_lease_id = requested_resource_lease_id
    and invocation.request_id = requested_request_id
    and invocation.attempt_id = requested_attempt_id
    and invocation.worker_fence = requested_worker_fence
    and (
      (requested_terminal_stage = 'TERMINAL_INITIAL' and invocation.state = 'STARTED')
      or (requested_terminal_stage = 'TERMINAL_LATE' and invocation.state = 'OUTCOME_UNKNOWN')
    )
  order by source.expires_at desc
  limit 1;
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'RESEARCH_INVOCATION_PREPARATION_NOT_FOUND';
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'protocol_version', 'invocation-terminal-preparation-recovery@1.0.0',
      'scope', scope_json,
      'run_id', preparation.run_id,
      'principal_id', preparation.principal_id,
      'invocation_id', preparation.invocation_id,
      'resource_kind', preparation.resource_kind,
      'reservation_id', requested_reservation_id,
      'reservation_seq', requested_reservation_seq,
      'resource_lease_id', requested_resource_lease_id,
      'request_id', requested_request_id,
      'attempt_id', requested_attempt_id,
      'worker_fence', requested_worker_fence,
      'terminal_stage', requested_terminal_stage,
      'preparation_id', preparation.preparation_id,
      'preparation_version', 1,
      'preparation_state',
        case preparation.state when 'PREPARING' then 'CLAIMED' else 'ABORTED' end,
      'claim_expires_at',
        case when preparation.state = 'PREPARING' then preparation.expires_at else null end
    )
  );
end
$function$;

create function app_data_agent.read_historical_l2_research_artifact(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb;
  scope_json jsonb;
  ref_json jsonb;
  requested_app_id uuid;
  requested_tenant_id uuid;
  requested_environment text;
  requested_run_id uuid;
  requested_artifact_id uuid;
  requested_revision integer;
  artifact_document jsonb;
begin
  command_json := envelope_json -> 'command';
  scope_json := command_json -> 'scope';
  ref_json := command_json -> 'ref';
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 5
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or pg_catalog.jsonb_typeof(ref_json) <> 'object'
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  begin
    requested_app_id := (scope_json ->> 'app_id')::uuid;
    requested_tenant_id := (scope_json ->> 'tenant_id')::uuid;
    requested_environment := scope_json ->> 'environment';
    requested_run_id := (command_json ->> 'run_id')::uuid;
    perform (command_json ->> 'principal_id')::uuid;
    requested_artifact_id := (ref_json ->> 'artifact_id')::uuid;
    requested_revision := (ref_json ->> 'revision')::integer;
  exception
    when invalid_text_representation then
      raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'REPORT_READ_AUTHORITY',
    null,
    null,
    null,
    false
  );
  select artifact.document_json
  into artifact_document
  from app_data_agent.artifacts as artifact
  where artifact.app_id = requested_app_id
    and artifact.tenant_id = requested_tenant_id
    and artifact.environment = requested_environment
    and artifact.run_id = requested_run_id
    and artifact.artifact_id = requested_artifact_id
    and artifact.revision = requested_revision
    and artifact.artifact_type = ref_json ->> 'artifact_type'
    and artifact.content_hash = ref_json ->> 'content_hash'
    and artifact.document_json #>> '{envelope,artifact_type}' = artifact.artifact_type
    and artifact.document_json #>> '{payload,artifact_type}' = artifact.artifact_type
    and (
      (
        artifact.artifact_type in (
          'ResearchBrief', 'HypothesisSet', 'EvidencePlan', 'QueryEvidence',
          'AtomicClaim', 'EvidenceRelation', 'AnalysisReport',
          'ReportReadyCertificate'
        )
        and artifact.document_json #>> '{envelope,schema_version}' = '1.0.0'
        and not ((artifact.document_json -> 'payload') ? 'protocol_version')
      )
      or (
        (
          artifact.artifact_type,
          artifact.document_json #>> '{envelope,schema_version}',
          artifact.document_json #>> '{payload,protocol_version}'
        ) in (
          values
            ('ReportManifest', '1.0.0', 'report-manifest@1.0.0'),
            ('ReportReadyCertificate', '2.0.0', 'report-ready@2.0.0')
        )
      )
    );
  if not found then
    return pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-result@1.0.0',
      'ok', true,
      'value', null
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'authority', 'HISTORICAL_READ_ONLY',
      'can_authorize_current', false,
      'document', artifact_document
    )
  );
end
$function$;

create function app_data_agent.resolve_committed_adapter_termination_receipt(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
  scope_json jsonb := command_json -> 'scope';
  ref_json jsonb := command_json -> 'ref';
  requested_app_id uuid;
  requested_tenant_id uuid;
  requested_record_id uuid;
  payload jsonb;
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 5
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or pg_catalog.jsonb_typeof(ref_json) <> 'object'
    or ref_json ->> 'record_kind' <> 'ADAPTER_TERMINATION_RECEIPT'
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  begin
    requested_app_id := (scope_json ->> 'app_id')::uuid;
    requested_tenant_id := (scope_json ->> 'tenant_id')::uuid;
    requested_record_id := (ref_json ->> 'record_id')::uuid;
  exception
    when invalid_text_representation then
      raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'RESOURCE_AUTHORITY', null, null, ref_json ->> 'adapter_kind', false
  );
  select receipt.payload_json
  into payload
  from app_data_agent.research_adapter_termination_receipts as receipt
  join app_data_agent.research_system_record_identities as identity
    on identity.app_id = receipt.app_id
   and identity.tenant_id = receipt.tenant_id
   and identity.environment = receipt.environment
   and identity.record_kind = receipt.record_kind
   and identity.record_id = receipt.record_id
   and identity.record_version = receipt.record_version
  where receipt.app_id = requested_app_id
    and receipt.tenant_id = requested_tenant_id
    and receipt.environment = scope_json ->> 'environment'
    and receipt.run_id = (command_json ->> 'run_id')::uuid
    and receipt.principal_id = (command_json ->> 'principal_id')::uuid
    and receipt.record_id = requested_record_id
    and receipt.resource_kind = ref_json ->> 'adapter_kind'
    and identity.content_hash = ref_json ->> 'content_hash'
    and identity.commit_id = (ref_json ->> 'commit_id')::uuid;
  if not found then
    raise exception using errcode = 'P0001', message = 'AUTHORITY_EVIDENCE_NOT_COMMITTED';
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', payload
  );
end
$function$;

create function app_data_agent.resolve_committed_invocation_outcome_usage(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
  scope_json jsonb := command_json -> 'scope';
  ref_json jsonb := command_json -> 'ref';
  usage_row record;
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 5
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or pg_catalog.jsonb_typeof(ref_json) <> 'object'
    or ref_json ->> 'record_kind' <> 'INVOCATION_OUTCOME_USAGE'
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'RESOURCE_AUTHORITY', null, null, ref_json ->> 'adapter_kind', false
  );
  select usage.*
  into usage_row
  from app_data_agent.research_invocation_outcome_usage as usage
  join app_data_agent.research_system_record_identities as identity
    on identity.app_id = usage.app_id
   and identity.tenant_id = usage.tenant_id
   and identity.environment = usage.environment
   and identity.record_kind = usage.record_kind
   and identity.record_id = usage.record_id
   and identity.record_version = usage.record_version
  where usage.app_id = (scope_json ->> 'app_id')::uuid
    and usage.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and usage.environment = scope_json ->> 'environment'
    and usage.run_id = (command_json ->> 'run_id')::uuid
    and usage.principal_id = (command_json ->> 'principal_id')::uuid
    and usage.record_id = (ref_json ->> 'record_id')::uuid
    and usage.resource_kind = ref_json ->> 'adapter_kind'
    and identity.content_hash = ref_json ->> 'content_hash'
    and identity.commit_id = (ref_json ->> 'commit_id')::uuid;
  if not found then
    raise exception using errcode = 'P0001', message = 'AUTHORITY_EVIDENCE_NOT_COMMITTED';
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'protocol_version', 'invocation-outcome-usage@1.0.0',
      'scope', scope_json,
      'run_id', usage_row.run_id,
      'principal_id', usage_row.principal_id,
      'invocation_id', usage_row.invocation_id,
      'reservation_id', usage_row.reservation_id,
      'resource_lease_id', usage_row.resource_lease_id,
      'resource_kind', usage_row.resource_kind,
      'outcome', usage_row.outcome,
      'actual', usage_row.actual_json,
      'completion_binding', usage_row.completion_binding,
      'error_code', usage_row.error_code,
      'outcome_hash', usage_row.outcome_hash,
      'observed_at', usage_row.observed_at
    )
  );
end
$function$;

create function app_data_agent.resolve_current_tool_invocation_permit(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
  scope_json jsonb := command_json -> 'scope';
  ref_json jsonb := command_json -> 'ref';
  capability_kind text;
  capability_resource_kind text;
  permit record;
  db_now timestamptz;
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 5
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or pg_catalog.jsonb_typeof(ref_json) <> 'object'
    or ref_json ->> 'record_kind' <> 'TOOL_INVOCATION_PERMIT'
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  select capability.authority_kind, capability.resource_kind
  into capability_kind, capability_resource_kind
  from app_data_agent.research_authority_capabilities as capability
  where capability.app_id = (scope_json ->> 'app_id')::uuid
    and capability.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and capability.environment = scope_json ->> 'environment'
    and capability.capability_id = (envelope_json ->> 'authority_capability_id')::uuid;
  if capability_kind not in ('RESOURCE_AUTHORITY', 'TOOL_INVOCATION_AUTHORITY')
    or capability_resource_kind is distinct from 'TOOL'
  then
    raise exception using errcode = '42501', message = 'DA_U6_CAPABILITY_REQUIRED';
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, capability_kind, null, null, 'TOOL', false
  );
  db_now := pg_catalog.clock_timestamp();
  select source.*
  into permit
  from app_data_agent.research_tool_invocation_permits as source
  join app_data_agent.research_system_record_identities as identity
    on identity.app_id = source.app_id
   and identity.tenant_id = source.tenant_id
   and identity.environment = source.environment
   and identity.record_kind = source.record_kind
   and identity.record_id = source.record_id
   and identity.record_version = source.record_version
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
    and source.record_id = (ref_json ->> 'record_id')::uuid
    and identity.content_hash = ref_json ->> 'content_hash'
    and identity.commit_id = (ref_json ->> 'commit_id')::uuid
    and source.status = 'ACTIVE'
    and source.expires_at > db_now;
  if not found then
    raise exception using errcode = '42501', message = 'TOOL_INVOCATION_PERMIT_NOT_ACTIVE';
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'protocol_version', 'tool-invocation-permit@1.0.0',
      'scope', scope_json,
      'run_id', permit.run_id,
      'principal_id', permit.principal_id,
      'tool_name', permit.tool_name,
      'tool_version', permit.tool_version,
      'arguments_schema_hash', permit.arguments_schema_hash,
      'arguments_hash', permit.arguments_hash,
      'policy_receipt_ref', permit.policy_receipt_ref,
      'tool_policy_version', permit.tool_policy_version,
      'tool_permit_policy_limit_hash', permit.tool_permit_policy_limit_hash,
      'status', permit.status,
      'authority_epoch', permit.authority_epoch,
      'expires_at', permit.expires_at,
      'revocation_seq', permit.revocation_seq
    )
  );
end
$function$;

create function app_data_agent.resolve_committed_model_invocation_result(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
  scope_json jsonb := command_json -> 'scope';
  ref_json jsonb := command_json -> 'ref';
  result_row record;
  db_now timestamptz;
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 5
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or pg_catalog.jsonb_typeof(ref_json) <> 'object'
    or ref_json ->> 'record_kind' <> 'MODEL_INVOCATION_RESULT'
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'MODEL_INVOCATION_AUTHORITY', null, null, 'MODEL', false
  );
  db_now := pg_catalog.clock_timestamp();
  select source.*, blob.ciphertext_hash as blob_hash
  into result_row
  from app_data_agent.research_invocation_results as source
  join app_data_agent.research_system_record_identities as identity
    on identity.app_id = source.app_id
   and identity.tenant_id = source.tenant_id
   and identity.environment = source.environment
   and identity.record_kind = source.record_kind
   and identity.record_id = source.record_id
   and identity.record_version = source.record_version
  join app_data_agent.research_invocation_result_blobs as blob
    on blob.app_id = source.app_id
   and blob.tenant_id = source.tenant_id
   and blob.environment = source.environment
   and blob.blob_id = source.blob_id
   and blob.result_record_kind = source.record_kind
   and blob.result_record_id = source.record_id
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
    and source.record_id = (ref_json ->> 'record_id')::uuid
    and source.record_kind = 'MODEL_INVOCATION_RESULT'
    and identity.content_hash = ref_json ->> 'content_hash'
    and identity.commit_id = (ref_json ->> 'commit_id')::uuid
    and source.state = 'AVAILABLE'
    and source.deletion_due_at > db_now;
  if not found then
    raise exception using errcode = 'P0001', message = 'REPLAY_SNAPSHOT_UNAVAILABLE';
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'protocol_version', 'model-invocation-result@1.0.0',
      'scope', scope_json,
      'run_id', result_row.run_id,
      'principal_id', result_row.principal_id,
      'invocation_id', result_row.invocation_id,
      'reservation_id', result_row.reservation_id,
      'preparation_id', result_row.preparation_id,
      'output_binding', result_row.metadata_json,
      'digest', result_row.digest,
      'byte_length', result_row.byte_length,
      'blob_hash', result_row.blob_hash,
      'deletion_due_at', result_row.deletion_due_at
    )
  );
end
$function$;

create function app_data_agent.resolve_committed_sql_invocation_result(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
  scope_json jsonb := command_json -> 'scope';
  ref_json jsonb := command_json -> 'ref';
  result_row record;
  db_now timestamptz;
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 5
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or pg_catalog.jsonb_typeof(ref_json) <> 'object'
    or ref_json ->> 'record_kind' <> 'SQL_INVOCATION_RESULT'
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'SQL_INVOCATION_AUTHORITY', null, null, 'SQL', false
  );
  db_now := pg_catalog.clock_timestamp();
  select source.*, blob.ciphertext_hash as blob_hash
  into result_row
  from app_data_agent.research_invocation_results as source
  join app_data_agent.research_system_record_identities as identity
    on identity.app_id = source.app_id
   and identity.tenant_id = source.tenant_id
   and identity.environment = source.environment
   and identity.record_kind = source.record_kind
   and identity.record_id = source.record_id
   and identity.record_version = source.record_version
  join app_data_agent.research_invocation_result_blobs as blob
    on blob.app_id = source.app_id
   and blob.tenant_id = source.tenant_id
   and blob.environment = source.environment
   and blob.blob_id = source.blob_id
   and blob.result_record_kind = source.record_kind
   and blob.result_record_id = source.record_id
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
    and source.record_id = (ref_json ->> 'record_id')::uuid
    and source.record_kind = 'SQL_INVOCATION_RESULT'
    and identity.content_hash = ref_json ->> 'content_hash'
    and identity.commit_id = (ref_json ->> 'commit_id')::uuid
    and source.state = 'AVAILABLE'
    and source.deletion_due_at > db_now;
  if not found then
    raise exception using errcode = 'P0001', message = 'REPLAY_SNAPSHOT_UNAVAILABLE';
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'protocol_version', 'sql-invocation-result@1.0.0',
      'scope', scope_json,
      'run_id', result_row.run_id,
      'principal_id', result_row.principal_id,
      'invocation_id', result_row.invocation_id,
      'reservation_id', result_row.reservation_id,
      'preparation_id', result_row.preparation_id,
      'output_binding', result_row.metadata_json,
      'digest', result_row.digest,
      'byte_length', result_row.byte_length,
      'blob_hash', result_row.blob_hash,
      'deletion_due_at', result_row.deletion_due_at
    )
  );
end
$function$;

create function app_data_agent.resolve_committed_secure_sql_execution_receipt(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
  scope_json jsonb := command_json -> 'scope';
  ref_json jsonb := command_json -> 'ref';
  receipt record;
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 5
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or pg_catalog.jsonb_typeof(ref_json) <> 'object'
    or ref_json ->> 'record_kind' <> 'SECURE_SQL_EXECUTION_RECEIPT'
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'SQL_INVOCATION_AUTHORITY', null, null, 'SQL', false
  );
  select source.*
  into receipt
  from app_data_agent.research_secure_sql_execution_receipts as source
  join app_data_agent.research_system_record_identities as identity
    on identity.app_id = source.app_id
   and identity.tenant_id = source.tenant_id
   and identity.environment = source.environment
   and identity.record_kind = source.record_kind
   and identity.record_id = source.record_id
   and identity.record_version = source.record_version
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
    and source.record_id = (ref_json ->> 'record_id')::uuid
    and identity.content_hash = ref_json ->> 'content_hash'
    and identity.commit_id = (ref_json ->> 'commit_id')::uuid;
  if not found then
    raise exception using errcode = 'P0001', message = 'AUTHORITY_EVIDENCE_NOT_COMMITTED';
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'protocol_version', 'secure-sql-execution-receipt@1.0.0',
      'scope', scope_json,
      'run_id', receipt.run_id,
      'principal_id', receipt.principal_id,
      'invocation_id', receipt.invocation_id,
      'result_record_id', receipt.result_record_id,
      'query_hash', receipt.query_hash,
      'snapshot_hash', receipt.snapshot_hash,
      'row_count', receipt.row_count,
      'column_count', receipt.column_count,
      'result_digest', receipt.result_digest,
      'committed_at', receipt.committed_at
    )
  );
end
$function$;

create function app_data_agent.resolve_committed_tool_invocation_result(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
  scope_json jsonb := command_json -> 'scope';
  ref_json jsonb := command_json -> 'ref';
  result_row record;
  db_now timestamptz;
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 5
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or pg_catalog.jsonb_typeof(ref_json) <> 'object'
    or ref_json ->> 'record_kind' <> 'TOOL_INVOCATION_RESULT'
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json, 'TOOL_INVOCATION_AUTHORITY', null, null, 'TOOL', false
  );
  db_now := pg_catalog.clock_timestamp();
  select source.*, blob.ciphertext_hash as blob_hash
  into result_row
  from app_data_agent.research_invocation_results as source
  join app_data_agent.research_system_record_identities as identity
    on identity.app_id = source.app_id
   and identity.tenant_id = source.tenant_id
   and identity.environment = source.environment
   and identity.record_kind = source.record_kind
   and identity.record_id = source.record_id
   and identity.record_version = source.record_version
  join app_data_agent.research_invocation_result_blobs as blob
    on blob.app_id = source.app_id
   and blob.tenant_id = source.tenant_id
   and blob.environment = source.environment
   and blob.blob_id = source.blob_id
   and blob.result_record_kind = source.record_kind
   and blob.result_record_id = source.record_id
  where source.app_id = (scope_json ->> 'app_id')::uuid
    and source.tenant_id = (scope_json ->> 'tenant_id')::uuid
    and source.environment = scope_json ->> 'environment'
    and source.run_id = (command_json ->> 'run_id')::uuid
    and source.principal_id = (command_json ->> 'principal_id')::uuid
    and source.record_id = (ref_json ->> 'record_id')::uuid
    and source.record_kind = 'TOOL_INVOCATION_RESULT'
    and identity.content_hash = ref_json ->> 'content_hash'
    and identity.commit_id = (ref_json ->> 'commit_id')::uuid
    and source.state = 'AVAILABLE'
    and source.deletion_due_at > db_now;
  if not found then
    raise exception using errcode = 'P0001', message = 'REPLAY_SNAPSHOT_UNAVAILABLE';
  end if;
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-db-result@1.0.0',
    'ok', true,
    'value', pg_catalog.jsonb_build_object(
      'protocol_version', 'tool-invocation-result@1.0.0',
      'scope', scope_json,
      'run_id', result_row.run_id,
      'principal_id', result_row.principal_id,
      'invocation_id', result_row.invocation_id,
      'reservation_id', result_row.reservation_id,
      'preparation_id', result_row.preparation_id,
      'output_binding', result_row.metadata_json,
      'digest', result_row.digest,
      'byte_length', result_row.byte_length,
      'blob_hash', result_row.blob_hash,
      'deletion_due_at', result_row.deletion_due_at
    )
  );
end
$function$;

create function app_data_agent.resolve_invocation_result_ciphertext(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  command_json jsonb := envelope_json -> 'command';
  scope_json jsonb := command_json -> 'scope';
  result_ref jsonb := command_json -> 'result_ref';
  db_now timestamptz;
begin
  if pg_catalog.jsonb_typeof(command_json) <> 'object'
    or (case
      when pg_catalog.jsonb_typeof(command_json) = 'object' then (
        select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json)
      )
      else -1
    end) <> 7
    or command_json ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(scope_json) <> 'object'
    or pg_catalog.jsonb_typeof(result_ref) <> 'object'
    or command_json ->> 'access_reason' not in (
      'INVOCATION_RETURN', 'IDEMPOTENT_REPLAY', 'AUTHORIZED_ANALYSIS'
    )
  then
    raise exception using errcode = '22023', message = 'DA_U6_DB_COMMAND_INVALID';
  end if;
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,
    'RESULT_DECRYPTION_AUTHORITY',
    null,
    null,
    null,
    false
  );
  db_now := pg_catalog.clock_timestamp();
  if not exists (
    select 1
    from app_data_agent.research_invocation_results as result
    where result.app_id = (scope_json ->> 'app_id')::uuid
      and result.tenant_id = (scope_json ->> 'tenant_id')::uuid
      and result.environment = scope_json ->> 'environment'
      and result.run_id = (command_json ->> 'run_id')::uuid
      and result.principal_id = (command_json ->> 'principal_id')::uuid
      and result.record_id = (result_ref ->> 'record_id')::uuid
      and result.record_kind = result_ref ->> 'record_kind'
      and result.state = 'AVAILABLE'
      and result.deletion_due_at > db_now
  ) then
    raise exception using errcode = 'P0001', message = 'REPLAY_SNAPSHOT_UNAVAILABLE';
  end if;
  raise exception using
    errcode = '0A000',
    message = 'RESEARCH_RESULT_DECRYPTION_KEY_UNAVAILABLE';
end
$function$;

-- HOLD: deployment mutation wire 尚未形成可由数据库独立重算的完整 strict schema。
-- 七个入口只验证 executor/protocol/request hash 后显式失败，不写表、不设置 RLS binding，
-- 也不返回伪造成功。后续必须先冻结 exact wire，再替换此 fail-closed 边界。
create function app_data_agent.provision_u6_authority_manifest(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
begin
  if pg_catalog.current_setting('role', true) <> 'data_agent_u6_provisioner'
    or pg_catalog.jsonb_typeof(envelope_json) <> 'object'
    or envelope_json ->> 'protocol_version' <> 'u6-authority-manifest@1.0.0'
    or envelope_json ->> 'request_hash' is distinct from
      app_data_agent.u6_domain_sha256(
        'u6-authority-manifest@1.0.0',
        envelope_json - 'request_hash'
      )
  then
    raise exception using errcode = '42501', message = 'DA_U6_PROVISIONER_REQUIRED';
  end if;
  raise exception using
    errcode = '0A000',
    message = 'DA_U6_AUTHORITY_MANIFEST_CONTRACT_UNAVAILABLE';
end
$function$;

create function app_data_agent.provision_u6_execution_policy_manifest(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
begin
  if pg_catalog.current_setting('role', true) <> 'data_agent_u6_provisioner'
    or pg_catalog.jsonb_typeof(envelope_json) <> 'object'
    or envelope_json ->> 'protocol_version' <> 'u6-execution-policy-manifest@1.0.0'
    or envelope_json ->> 'request_hash' is distinct from
      app_data_agent.u6_domain_sha256(
        'u6-execution-policy-manifest@1.0.0',
        envelope_json - 'request_hash'
      )
  then
    raise exception using errcode = '42501', message = 'DA_U6_PROVISIONER_REQUIRED';
  end if;
  raise exception using
    errcode = '0A000',
    message = 'DA_U6_EXECUTION_POLICY_MANIFEST_CONTRACT_UNAVAILABLE';
end
$function$;

create function app_data_agent.stage_u6_result_key_version(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
begin
  if pg_catalog.current_setting('role', true) <> 'data_agent_u6_provisioner'
    or pg_catalog.jsonb_typeof(envelope_json) <> 'object'
    or envelope_json ->> 'protocol_version' <> 'u6-result-key-stage@1.0.0'
    or envelope_json ->> 'request_hash' is distinct from
      app_data_agent.u6_domain_sha256(
        'u6-result-key-stage@1.0.0',
        envelope_json - 'request_hash'
      )
  then
    raise exception using errcode = '42501', message = 'DA_U6_PROVISIONER_REQUIRED';
  end if;
  raise exception using errcode = '0A000', message = 'RESEARCH_RESULT_KEY_OPERATION_UNAVAILABLE';
end
$function$;

create function app_data_agent.activate_u6_result_key_version(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
begin
  if pg_catalog.current_setting('role', true) <> 'data_agent_u6_provisioner'
    or pg_catalog.jsonb_typeof(envelope_json) <> 'object'
    or envelope_json ->> 'protocol_version' <> 'u6-result-key-activate@1.0.0'
    or envelope_json ->> 'request_hash' is distinct from
      app_data_agent.u6_domain_sha256(
        'u6-result-key-activate@1.0.0',
        envelope_json - 'request_hash'
      )
  then
    raise exception using errcode = '42501', message = 'DA_U6_PROVISIONER_REQUIRED';
  end if;
  raise exception using errcode = '0A000', message = 'RESEARCH_RESULT_KEY_OPERATION_UNAVAILABLE';
end
$function$;

create function app_data_agent.retire_u6_result_key_version(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
begin
  if pg_catalog.current_setting('role', true) <> 'data_agent_u6_provisioner'
    or pg_catalog.jsonb_typeof(envelope_json) <> 'object'
    or envelope_json ->> 'protocol_version' <> 'u6-result-key-retire@1.0.0'
    or envelope_json ->> 'request_hash' is distinct from
      app_data_agent.u6_domain_sha256(
        'u6-result-key-retire@1.0.0',
        envelope_json - 'request_hash'
      )
  then
    raise exception using errcode = '42501', message = 'DA_U6_PROVISIONER_REQUIRED';
  end if;
  raise exception using errcode = '0A000', message = 'RESEARCH_RESULT_KEY_OPERATION_UNAVAILABLE';
end
$function$;

create function app_data_agent.compromise_u6_result_key_version(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
begin
  if pg_catalog.current_setting('role', true) <> 'data_agent_u6_provisioner'
    or pg_catalog.jsonb_typeof(envelope_json) <> 'object'
    or envelope_json ->> 'protocol_version' <> 'u6-result-key-compromise@1.0.0'
    or envelope_json ->> 'request_hash' is distinct from
      app_data_agent.u6_domain_sha256(
        'u6-result-key-compromise@1.0.0',
        envelope_json - 'request_hash'
      )
  then
    raise exception using errcode = '42501', message = 'DA_U6_PROVISIONER_REQUIRED';
  end if;
  raise exception using errcode = '0A000', message = 'RESEARCH_RESULT_KEY_OPERATION_UNAVAILABLE';
end
$function$;

create function app_data_agent.purge_u6_result_ciphertext_access_audits(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  requested_protocol text := envelope_json ->> 'protocol_version';
begin
  if pg_catalog.current_setting('role', true) <> 'data_agent_u6_provisioner'
    or pg_catalog.jsonb_typeof(envelope_json) <> 'object'
    or requested_protocol not in (
      'u6-audit-purge-retention@1.0.0',
      'u6-audit-purge-subject-erasure@1.0.0'
    )
    or envelope_json ->> 'request_hash' is distinct from
      app_data_agent.u6_domain_sha256(
        requested_protocol,
        envelope_json - 'request_hash'
      )
  then
    raise exception using errcode = '42501', message = 'DA_U6_PROVISIONER_REQUIRED';
  end if;
  raise exception using
    errcode = '0A000',
    message = 'RESEARCH_RESULT_AUDIT_PURGE_UNAVAILABLE';
end
$function$;
create table app_data_agent.research_lifecycle_cleanup_operations (
  app_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  operation_id uuid not null,
  app_epoch bigint not null
    check (app_epoch between 1 and 9007199254740991),
  component text not null default 'U6_AUTHORITY_RELATIONS'
    check (component = 'U6_AUTHORITY_RELATIONS'),
  operation_hash text not null
    check (operation_hash ~ '^sha256:[0-9a-f]{64}$'),
  resource_manifest_id uuid not null,
  resource_manifest_hash text not null
    check (resource_manifest_hash ~ '^sha256:[0-9a-f]{64}$'),
  export_boundary_receipt_id uuid not null,
  export_boundary_receipt_hash text not null
    check (export_boundary_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  export_operation_receipt_id uuid not null,
  export_operation_receipt_hash text not null
    check (export_operation_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  backup_operation_receipt_id uuid not null,
  backup_operation_receipt_hash text not null
    check (backup_operation_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  schema_inventory_hash text not null
    check (schema_inventory_hash ~ '^sha256:[0-9a-f]{64}$'),
  next_batch_seq bigint not null default 1
    check (next_batch_seq between 1 and 9007199254740991),
  total_live_result_bodies_destroyed bigint not null default 0
    check (total_live_result_bodies_destroyed between 0 and 9007199254740991),
  total_metadata_only_results_deleted bigint not null default 0
    check (total_metadata_only_results_deleted between 0 and 9007199254740991),
  state text not null default 'RUNNING'
    check (state in ('RUNNING', 'COMMITTED')),
  final_receipt_hash text
    check (final_receipt_hash is null or final_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, operation_id),
  unique (app_id, environment, app_epoch, component),
  check (
    (state = 'RUNNING' and final_receipt_hash is null)
    or (state = 'COMMITTED' and final_receipt_hash is not null)
  )
);

create table app_data_agent.research_lifecycle_cleanup_batch_receipts (
  app_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  batch_id uuid not null,
  operation_id uuid not null,
  batch_seq bigint not null
    check (batch_seq between 1 and 9007199254740991),
  app_epoch bigint not null
    check (app_epoch between 1 and 9007199254740991),
  component text not null default 'U6_AUTHORITY_RELATIONS'
    check (component = 'U6_AUTHORITY_RELATIONS'),
  operation_hash text not null
    check (operation_hash ~ '^sha256:[0-9a-f]{64}$'),
  request_hash text not null
    check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  cleanup_rank bigint not null
    check (cleanup_rank between 0 and 9007199254740991),
  deleted_rows bigint not null
    check (deleted_rows between 0 and 9007199254740991),
  live_result_bodies_destroyed bigint not null
    check (live_result_bodies_destroyed between 0 and 9007199254740991),
  metadata_only_results_deleted bigint not null
    check (metadata_only_results_deleted between 0 and 9007199254740991),
  component_residual_rows bigint not null
    check (component_residual_rows between 0 and 9007199254740991),
  state text not null check (state in ('RUNNING', 'COMMITTED')),
  committed_at timestamptz not null,
  receipt_hash text not null
    check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  primary key (app_id, environment, batch_id),
  unique (app_id, environment, operation_id, batch_seq),
  foreign key (app_id, environment, operation_id)
    references app_data_agent.research_lifecycle_cleanup_operations (
      app_id, environment, operation_id
    )
    on delete restrict not deferrable
);

create function app_data_agent.cleanup_u6_delete_pending_environment(
  input_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  requested_app_id uuid;
  requested_environment text;
  requested_operation_id uuid;
  requested_batch_id uuid;
  requested_app_epoch bigint;
  requested_manifest_id uuid;
  requested_boundary_receipt_id uuid;
  requested_export_operation_id uuid;
  requested_backup_operation_id uuid;
  requested_batch_limit bigint;
  expected_operation_hash text;
  expected_request_hash text;
  locked_evidence jsonb;
begin
  if not pg_catalog.pg_has_role(
    session_user,
    'data_agent_job_authority',
    'USAGE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'DA_JOB_AUTHORITY_REQUIRED';
  end if;

  if input_json is null
    or pg_catalog.jsonb_typeof(input_json) <> 'object'
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(
        case
          when pg_catalog.jsonb_typeof(input_json) = 'object' then input_json
          else '{}'::jsonb
        end
      )
    ) <> 18
    or input_json ->> 'protocol_version'
      <> 'u6-app-lifecycle-cleanup@1.0.0'
    or pg_catalog.jsonb_typeof(input_json -> 'operation_id') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'batch_id') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'app_id') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'environment') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'expected_app_epoch') <> 'number'
    or pg_catalog.jsonb_typeof(input_json -> 'resource_manifest_id') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'resource_manifest_hash') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'export_boundary_receipt_id') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'export_boundary_receipt_hash') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'export_operation_receipt_id') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'export_operation_receipt_hash') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'backup_operation_receipt_id') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'backup_operation_receipt_hash') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'schema_inventory_hash') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'batch_limit') <> 'number'
    or pg_catalog.jsonb_typeof(input_json -> 'operation_hash') <> 'string'
    or pg_catalog.jsonb_typeof(input_json -> 'request_hash') <> 'string'
  then
    raise exception using
      errcode = '22023',
      message = 'DA_U6_CLEANUP_INPUT_INVALID';
  end if;

  begin
    requested_app_id := (input_json ->> 'app_id')::uuid;
    requested_environment := input_json ->> 'environment';
    requested_operation_id := (input_json ->> 'operation_id')::uuid;
    requested_batch_id := (input_json ->> 'batch_id')::uuid;
    requested_app_epoch := (input_json ->> 'expected_app_epoch')::bigint;
    requested_manifest_id := (input_json ->> 'resource_manifest_id')::uuid;
    requested_boundary_receipt_id :=
      (input_json ->> 'export_boundary_receipt_id')::uuid;
    requested_export_operation_id :=
      (input_json ->> 'export_operation_receipt_id')::uuid;
    requested_backup_operation_id :=
      (input_json ->> 'backup_operation_receipt_id')::uuid;
    requested_batch_limit := (input_json ->> 'batch_limit')::bigint;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception using
        errcode = '22023',
        message = 'DA_U6_CLEANUP_INPUT_INVALID';
  end;

  if requested_environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or input_json ->> 'expected_app_epoch' !~ '^[0-9]+$'
    or input_json ->> 'batch_limit' !~ '^[0-9]+$'
    or requested_app_epoch not between 1 and 9007199254740991
    or requested_batch_limit not between 1 and 500
    or input_json ->> 'resource_manifest_hash' !~ '^sha256:[0-9a-f]{64}$'
    or input_json ->> 'export_boundary_receipt_hash' !~ '^sha256:[0-9a-f]{64}$'
    or input_json ->> 'export_operation_receipt_hash' !~ '^sha256:[0-9a-f]{64}$'
    or input_json ->> 'backup_operation_receipt_hash' !~ '^sha256:[0-9a-f]{64}$'
    or input_json ->> 'schema_inventory_hash' !~ '^sha256:[0-9a-f]{64}$'
    or input_json ->> 'operation_hash' !~ '^sha256:[0-9a-f]{64}$'
    or input_json ->> 'request_hash' !~ '^sha256:[0-9a-f]{64}$'
  then
    raise exception using
      errcode = '22023',
      message = 'DA_U6_CLEANUP_INPUT_INVALID';
  end if;

  expected_operation_hash := app_data_agent.u6_domain_sha256(
    'u6-cleanup-operation@1.0.0',
    pg_catalog.jsonb_build_array(
      input_json ->> 'protocol_version',
      requested_operation_id,
      requested_app_id,
      requested_environment,
      requested_app_epoch,
      requested_manifest_id,
      input_json ->> 'resource_manifest_hash',
      requested_boundary_receipt_id,
      input_json ->> 'export_boundary_receipt_hash',
      requested_export_operation_id,
      input_json ->> 'export_operation_receipt_hash',
      requested_backup_operation_id,
      input_json ->> 'backup_operation_receipt_hash',
      input_json ->> 'schema_inventory_hash'
    )
  );
  expected_request_hash := app_data_agent.u6_domain_sha256(
    'u6-cleanup-batch-request@1.0.0',
    pg_catalog.jsonb_build_array(
      expected_operation_hash,
      requested_batch_id,
      requested_batch_limit
    )
  );
  if input_json ->> 'operation_hash' <> expected_operation_hash
    or input_json ->> 'request_hash' <> expected_request_hash
  then
    raise exception using
      errcode = '22023',
      message = 'DA_U6_CLEANUP_HASH_INVALID';
  end if;

  perform platform.acquire_lifecycle_exclusive_lock(
    requested_app_id,
    requested_environment
  );
  locked_evidence := platform.lock_u6_cleanup_platform_evidence(
    requested_app_id,
    requested_environment,
    requested_app_epoch,
    requested_manifest_id,
    input_json ->> 'resource_manifest_hash',
    requested_boundary_receipt_id,
    input_json ->> 'export_boundary_receipt_hash',
    requested_export_operation_id,
    input_json ->> 'export_operation_receipt_hash',
    requested_backup_operation_id,
    input_json ->> 'backup_operation_receipt_hash'
  );

  perform pg_catalog.set_config(
    'app.u6_cleanup_app_id',
    requested_app_id::text,
    true
  );
  perform pg_catalog.set_config(
    'app.u6_cleanup_environment',
    requested_environment,
    true
  );
  perform pg_catalog.set_config(
    'app.u6_cleanup_operation_id',
    requested_operation_id::text,
    true
  );
  perform pg_catalog.set_config(
    'app.u6_cleanup_batch_id',
    requested_batch_id::text,
    true
  );
  if pg_catalog.current_setting('app.u6_cleanup_app_id', true)
       is distinct from requested_app_id::text
    or pg_catalog.current_setting('app.u6_cleanup_environment', true)
       is distinct from requested_environment
    or pg_catalog.current_setting('app.u6_cleanup_operation_id', true)
       is distinct from requested_operation_id::text
    or pg_catalog.current_setting('app.u6_cleanup_batch_id', true)
       is distinct from requested_batch_id::text
    or locked_evidence ->> 'app_id' is distinct from requested_app_id::text
    or locked_evidence ->> 'environment' is distinct from requested_environment
    or (locked_evidence ->> 'app_epoch')::bigint is distinct from requested_app_epoch
  then
    raise exception using
      errcode = '42501',
      message = 'DA_U6_CLEANUP_BINDING_INVALID';
  end if;

  -- The destructive branch is deliberately unavailable until the signed
  -- external signature and backup-restore verifier is wired. Returning HOLD
  -- here occurs before retained-control writes or any U6 resource deletion.
  return pg_catalog.jsonb_build_object(
    'protocol_version', 'u6-app-lifecycle-cleanup-result@1.0.0',
    'ok', false,
    'error', pg_catalog.jsonb_build_object(
      'code', 'U6_CLEANUP_EXTERNAL_VERIFIER_UNAVAILABLE',
      'retryable', false
    )
  );
end
$function$;
do $u6_relation_ownership_and_rls$
declare
  relation_name text;
  u6_job_relations constant text[] := array[
    'current_report_readiness',
    'report_read_grant_expiration_operations',
    'report_read_grants',
    'research_adapter_termination_receipts',
    'research_artifact_commit_operations',
    'research_authority_capabilities',
    'research_authority_capability_heads',
    'research_current_evidence_relation_keys',
    'research_domain_terminals',
    'research_frontier_events',
    'research_frontier_operations',
    'research_invocation_commits',
    'research_invocation_outcome_usage',
    'research_invocation_request_operations',
    'research_invocation_result_blobs',
    'research_invocation_results',
    'research_invocation_terminal_preparations',
    'research_invocation_transition_operations',
    'research_readiness_consumptions',
    'research_readiness_publications',
    'research_release_decision_commits',
    'research_resource_reservations',
    'research_resource_run_heads',
    'research_resource_transition_operations',
    'research_result_access_audit_purge_operations',
    'research_result_access_audit_retention_heads',
    'research_result_access_audit_retention_policies',
    'research_result_ciphertext_access_audits',
    'research_result_key_transition_operations',
    'research_result_key_versions',
    'research_result_retention_policies',
    'research_result_retention_policy_heads',
    'research_revocation_operations',
    'research_secure_sql_execution_receipts',
    'research_stop_terminal_commits',
    'research_system_artifacts',
    'research_system_record_identities',
    'research_system_record_transition_operations',
    'research_tool_invocation_permits',
    'research_tool_permit_policy_limits',
    'research_version_frontiers'
  ];
  retained_relations constant text[] := array[
    'research_lifecycle_cleanup_batch_receipts',
    'research_lifecycle_cleanup_operations'
  ];
  rpc_scope_predicate constant text :=
    'app_id = nullif(pg_catalog.current_setting(''data_agent.app_id'', true), '''')::uuid'
    || ' and tenant_id = nullif(pg_catalog.current_setting(''data_agent.tenant_id'', true), '''')::uuid'
    || ' and environment = pg_catalog.current_setting(''data_agent.environment'', true)';
  cleanup_scope_predicate constant text :=
    'current_user = ''data_agent_u6_cleanup_owner'''
    || ' and app_id = nullif(pg_catalog.current_setting(''app.u6_cleanup_app_id'', true), '''')::uuid'
    || ' and environment = pg_catalog.current_setting(''app.u6_cleanup_environment'', true)'
    || ' and nullif(pg_catalog.current_setting(''app.u6_cleanup_operation_id'', true), '''')::uuid is not null'
    || ' and nullif(pg_catalog.current_setting(''app.u6_cleanup_batch_id'', true), '''')::uuid is not null';
begin
  foreach relation_name in array u6_job_relations || retained_relations
  loop
    execute pg_catalog.format(
      'alter table app_data_agent.%I owner to data_agent_u6_data_owner',
      relation_name
    );
    execute pg_catalog.format(
      'alter table app_data_agent.%I enable row level security',
      relation_name
    );
    execute pg_catalog.format(
      'alter table app_data_agent.%I force row level security',
      relation_name
    );
    execute pg_catalog.format(
      'revoke all privileges on table app_data_agent.%I from public, anon, authenticated, service_role, data_agent_backend, data_agent_job_authority, data_agent_u6_rpc_owner, data_agent_u6_provisioner_owner, data_agent_u6_cleanup_owner',
      relation_name
    );
  end loop;

  foreach relation_name in array u6_job_relations
  loop
    if pg_catalog.octet_length(relation_name || '_u6_rpc') > 63
      or pg_catalog.octet_length(relation_name || '_u6_cleanup') > 63
    then
      raise exception using
        errcode = '42622',
        message = 'U6_MIGRATION_POLICY_IDENTIFIER_TOO_LONG';
    end if;
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I as permissive for all to data_agent_u6_rpc_owner using (%s) with check (%s)',
      relation_name || '_u6_rpc',
      relation_name,
      rpc_scope_predicate,
      rpc_scope_predicate
    );
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I as permissive for all to data_agent_u6_cleanup_owner using (%s) with check (%s)',
      relation_name || '_u6_cleanup',
      relation_name,
      cleanup_scope_predicate,
      cleanup_scope_predicate
    );
    execute pg_catalog.format(
      'grant select, insert, update, delete on table app_data_agent.%I to data_agent_u6_rpc_owner',
      relation_name
    );
    execute pg_catalog.format(
      'grant select, insert, update, delete on table app_data_agent.%I to data_agent_u6_cleanup_owner',
      relation_name
    );
  end loop;

  create policy research_lifecycle_cleanup_operations_u6_cleanup_scope
  on app_data_agent.research_lifecycle_cleanup_operations
  as permissive
  for all
  to data_agent_u6_cleanup_owner
  using (
    current_user = 'data_agent_u6_cleanup_owner'
    and app_id =
      nullif(pg_catalog.current_setting('app.u6_cleanup_app_id', true), '')::uuid
    and environment =
      pg_catalog.current_setting('app.u6_cleanup_environment', true)
    and operation_id =
      nullif(
        pg_catalog.current_setting('app.u6_cleanup_operation_id', true),
        ''
      )::uuid
    and nullif(
      pg_catalog.current_setting('app.u6_cleanup_batch_id', true),
      ''
    )::uuid is not null
  )
  with check (
    current_user = 'data_agent_u6_cleanup_owner'
    and app_id =
      nullif(pg_catalog.current_setting('app.u6_cleanup_app_id', true), '')::uuid
    and environment =
      pg_catalog.current_setting('app.u6_cleanup_environment', true)
    and operation_id =
      nullif(
        pg_catalog.current_setting('app.u6_cleanup_operation_id', true),
        ''
      )::uuid
    and nullif(
      pg_catalog.current_setting('app.u6_cleanup_batch_id', true),
      ''
    )::uuid is not null
  );

  create policy research_lifecycle_cleanup_batch_receipts_u6_cleanup_scope
  on app_data_agent.research_lifecycle_cleanup_batch_receipts
  as permissive
  for all
  to data_agent_u6_cleanup_owner
  using (
    current_user = 'data_agent_u6_cleanup_owner'
    and app_id =
      nullif(pg_catalog.current_setting('app.u6_cleanup_app_id', true), '')::uuid
    and environment =
      pg_catalog.current_setting('app.u6_cleanup_environment', true)
    and operation_id =
      nullif(
        pg_catalog.current_setting('app.u6_cleanup_operation_id', true),
        ''
      )::uuid
    and batch_id =
      nullif(
        pg_catalog.current_setting('app.u6_cleanup_batch_id', true),
        ''
      )::uuid
  )
  with check (
    current_user = 'data_agent_u6_cleanup_owner'
    and app_id =
      nullif(pg_catalog.current_setting('app.u6_cleanup_app_id', true), '')::uuid
    and environment =
      pg_catalog.current_setting('app.u6_cleanup_environment', true)
    and operation_id =
      nullif(
        pg_catalog.current_setting('app.u6_cleanup_operation_id', true),
        ''
      )::uuid
    and batch_id =
      nullif(
        pg_catalog.current_setting('app.u6_cleanup_batch_id', true),
        ''
      )::uuid
  );
end
$u6_relation_ownership_and_rls$;

grant select, insert, update
on table app_data_agent.research_lifecycle_cleanup_operations
to data_agent_u6_cleanup_owner;
grant select, insert
on table app_data_agent.research_lifecycle_cleanup_batch_receipts
to data_agent_u6_cleanup_owner;

do $u6_provisioner_rls$
declare
  relation_name text;
  provisioner_relations constant text[] := array[
    'research_authority_capabilities',
    'research_authority_capability_heads',
    'research_result_access_audit_purge_operations',
    'research_result_access_audit_retention_heads',
    'research_result_access_audit_retention_policies',
    'research_result_ciphertext_access_audits',
    'research_result_key_transition_operations',
    'research_result_key_versions',
    'research_result_retention_policies',
    'research_result_retention_policy_heads',
    'research_tool_permit_policy_limits'
  ];
  provision_scope_predicate constant text :=
    'current_user = ''data_agent_u6_provisioner_owner'''
    || ' and app_id = nullif(pg_catalog.current_setting(''app.u6_provision_app_id'', true), '''')::uuid'
    || ' and tenant_id = nullif(pg_catalog.current_setting(''app.u6_provision_tenant_id'', true), '''')::uuid'
    || ' and environment = pg_catalog.current_setting(''app.u6_provision_environment'', true)';
begin
  foreach relation_name in array provisioner_relations
  loop
    if pg_catalog.octet_length(relation_name || '_u6_provision') > 63 then
      raise exception using
        errcode = '42622',
        message = 'U6_MIGRATION_POLICY_IDENTIFIER_TOO_LONG';
    end if;
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I as permissive for all to data_agent_u6_provisioner_owner using (%s) with check (%s)',
      relation_name || '_u6_provision',
      relation_name,
      provision_scope_predicate,
      provision_scope_predicate
    );
    execute pg_catalog.format(
      'grant select, insert, update, delete on table app_data_agent.%I to data_agent_u6_provisioner_owner',
      relation_name
    );
  end loop;
end
$u6_provisioner_rls$;

-- PostgreSQL RI triggers resolve referenced U6 tables under their relation
-- owner. The owner is intentionally NOLOGIN/NOINHERIT, but still needs schema
-- lookup permission for exact foreign-key enforcement.
grant usage on schema app_data_agent
to data_agent_u6_data_owner;

grant usage on schema
  app_data_agent,
  platform
to
  data_agent_u6_rpc_owner,
  data_agent_u6_provisioner_owner,
  data_agent_u6_cleanup_owner,
  data_agent_u6_platform_lock_owner;
grant usage on schema app_data_agent
to data_agent_u6_provisioner, data_agent_job_authority;
grant usage on schema extensions
to
  data_agent_u6_rpc_owner,
  data_agent_u6_provisioner_owner;

grant execute on function platform.current_backend_authority(boolean)
to data_agent_u6_rpc_owner, data_agent_u6_platform_lock_owner;
grant execute on function platform.backend_run_object_matches(
  uuid, uuid, text, uuid, boolean
) to data_agent_u6_rpc_owner;
grant execute on function platform.acquire_lifecycle_shared_lock(uuid, text)
to data_agent_u6_platform_lock_owner;
grant execute on function platform.acquire_lifecycle_exclusive_lock(uuid, text)
to data_agent_u6_cleanup_owner;
grant execute on function app_data_agent.runtime_canonical_json(jsonb)
to
  data_agent_u6_rpc_owner,
  data_agent_u6_provisioner_owner,
  data_agent_u6_cleanup_owner;

grant select on table
  platform.deployment_mappings,
  platform.app_environment_lifecycle,
  app_data_agent.memberships
to data_agent_u6_platform_lock_owner;
grant update (deployment_id)
on table platform.deployment_mappings
to data_agent_u6_platform_lock_owner;
grant update (app_id)
on table platform.app_environment_lifecycle
to data_agent_u6_platform_lock_owner;
grant update (principal_id)
on table app_data_agent.memberships
to data_agent_u6_platform_lock_owner;

grant select on table
  platform.resource_manifests,
  platform.app_lifecycle_events,
  platform.boundary_audit_receipts,
  platform.resource_operation_receipts
to data_agent_u6_platform_lock_owner;
grant update (manifest_id)
on table platform.resource_manifests
to data_agent_u6_platform_lock_owner;
grant update (event_id)
on table platform.app_lifecycle_events
to data_agent_u6_platform_lock_owner;
grant update (receipt_id)
on table platform.boundary_audit_receipts
to data_agent_u6_platform_lock_owner;
grant update (operation_receipt_id)
on table platform.resource_operation_receipts
to data_agent_u6_platform_lock_owner;

create policy memberships_u6_platform_lock_select
on app_data_agent.memberships
as permissive
for select
to data_agent_u6_platform_lock_owner
using (
  platform.backend_principal_object_matches(
    app_id,
    tenant_id,
    environment,
    principal_id,
    false
  )
);
create policy memberships_u6_platform_lock_update
on app_data_agent.memberships
as permissive
for update
to data_agent_u6_platform_lock_owner
using (
  platform.backend_principal_object_matches(
    app_id,
    tenant_id,
    environment,
    principal_id,
    false
  )
)
with check (false);
grant execute on function platform.backend_principal_object_matches(
  uuid, uuid, text, uuid, boolean
) to data_agent_u6_platform_lock_owner;

grant select on table
  app_data_agent.runs,
  app_data_agent.outbox,
  app_data_agent.run_attempts
to data_agent_u6_rpc_owner;
grant update (run_id) on table app_data_agent.runs
to data_agent_u6_rpc_owner;
grant update (outbox_id) on table app_data_agent.outbox
to data_agent_u6_rpc_owner;
grant update (attempt_id) on table app_data_agent.run_attempts
to data_agent_u6_rpc_owner;

create policy runs_u6_rpc_lock_select
on app_data_agent.runs
as permissive
for select
to data_agent_u6_rpc_owner
using (
  platform.backend_run_object_matches(
    app_id, tenant_id, environment, run_id, false
  )
);
create policy runs_u6_rpc_lock_update
on app_data_agent.runs
as permissive
for update
to data_agent_u6_rpc_owner
using (
  platform.backend_run_object_matches(
    app_id, tenant_id, environment, run_id, false
  )
)
with check (false);

create policy outbox_u6_rpc_lock_select
on app_data_agent.outbox
as permissive
for select
to data_agent_u6_rpc_owner
using (
  platform.backend_run_object_matches(
    app_id, tenant_id, environment, run_id, false
  )
);
create policy outbox_u6_rpc_lock_update
on app_data_agent.outbox
as permissive
for update
to data_agent_u6_rpc_owner
using (
  platform.backend_run_object_matches(
    app_id, tenant_id, environment, run_id, true
  )
)
with check (false);

create policy run_attempts_u6_rpc_lock_select
on app_data_agent.run_attempts
as permissive
for select
to data_agent_u6_rpc_owner
using (
  platform.backend_run_object_matches(
    app_id, tenant_id, environment, run_id, false
  )
);
create policy run_attempts_u6_rpc_lock_update
on app_data_agent.run_attempts
as permissive
for update
to data_agent_u6_rpc_owner
using (
  platform.backend_run_object_matches(
    app_id, tenant_id, environment, run_id, true
  )
)
with check (false);

grant select, insert on table app_data_agent.artifacts
to data_agent_u6_rpc_owner;
create policy artifacts_u6_rpc_select
on app_data_agent.artifacts
as permissive
for select
to data_agent_u6_rpc_owner
using (
  platform.backend_run_object_matches(
    app_id, tenant_id, environment, run_id, false
  )
);
create policy artifacts_u6_rpc_insert
on app_data_agent.artifacts
as permissive
for insert
to data_agent_u6_rpc_owner
with check (
  platform.backend_run_object_matches(
    app_id, tenant_id, environment, run_id, true
  )
);

create policy artifacts_u6_reserved_insert_deny
on app_data_agent.artifacts
as restrictive
for insert
to data_agent_backend
with check (
  artifact_type not in (
    'ResearchBrief', 'HypothesisSet', 'EvidencePlan',
    'ObligationExecutionDecision', 'QueryEvidence', 'AtomicClaim',
    'EvidenceRelation', 'EvidenceCheckReceipt', 'SupportDecision',
    'HypothesisAssessment', 'CoverageState', 'ResearchStopDecision',
    'ReportManifest', 'AnalysisReport', 'ReportProjectionReceipt',
    'EvidenceGateReceipt', 'ReportReadyCertificate',
    'ReadinessRevocationReceipt'
  )
);
create policy artifacts_u6_reserved_update_deny
on app_data_agent.artifacts
as restrictive
for update
to data_agent_backend
using (
  artifact_type not in (
    'ResearchBrief', 'HypothesisSet', 'EvidencePlan',
    'ObligationExecutionDecision', 'QueryEvidence', 'AtomicClaim',
    'EvidenceRelation', 'EvidenceCheckReceipt', 'SupportDecision',
    'HypothesisAssessment', 'CoverageState', 'ResearchStopDecision',
    'ReportManifest', 'AnalysisReport', 'ReportProjectionReceipt',
    'EvidenceGateReceipt', 'ReportReadyCertificate',
    'ReadinessRevocationReceipt'
  )
)
with check (
  artifact_type not in (
    'ResearchBrief', 'HypothesisSet', 'EvidencePlan',
    'ObligationExecutionDecision', 'QueryEvidence', 'AtomicClaim',
    'EvidenceRelation', 'EvidenceCheckReceipt', 'SupportDecision',
    'HypothesisAssessment', 'CoverageState', 'ResearchStopDecision',
    'ReportManifest', 'AnalysisReport', 'ReportProjectionReceipt',
    'EvidenceGateReceipt', 'ReportReadyCertificate',
    'ReadinessRevocationReceipt'
  )
);
create policy artifacts_u6_reserved_delete_deny
on app_data_agent.artifacts
as restrictive
for delete
to data_agent_backend
using (
  artifact_type not in (
    'ResearchBrief', 'HypothesisSet', 'EvidencePlan',
    'ObligationExecutionDecision', 'QueryEvidence', 'AtomicClaim',
    'EvidenceRelation', 'EvidenceCheckReceipt', 'SupportDecision',
    'HypothesisAssessment', 'CoverageState', 'ResearchStopDecision',
    'ReportManifest', 'AnalysisReport', 'ReportProjectionReceipt',
    'EvidenceGateReceipt', 'ReportReadyCertificate',
    'ReadinessRevocationReceipt'
  )
);

alter function platform.lock_u6_authority_binding(
  uuid, uuid, text, uuid, uuid, text, text
) owner to data_agent_u6_platform_lock_owner;
alter function platform.lock_u6_cleanup_platform_evidence(
  uuid, text, bigint, uuid, text, uuid, text, uuid, text, uuid, text
) owner to data_agent_u6_platform_lock_owner;

alter function app_data_agent.u6_domain_sha256(text, jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.u6_uuid_v5(uuid, bytea)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.u6_strict_base64url_decode(text)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.u6_constant_time_equal(bytea, bytea)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.lock_u6_authority_capability(
  jsonb, text, text, text, text, boolean
) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_research_revocation_receipt(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_research_system_artifact(jsonb)
owner to data_agent_u6_rpc_owner;

alter function app_data_agent.abort_invocation_terminal_preparation(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.advance_research_version_frontier(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.authorize_agent_data_projection(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_research_resource(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.cancel_research_resource(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_adapter_termination_receipt(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_current_l2_artifact(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_current_release_go(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_invocation_terminal(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_report_read_response(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_research_stop_terminal(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.consume_current_ready(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.consume_report_read_grant(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.erase_subject_invocation_result(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.expire_report_read_grant(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.expire_research_resource(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.expire_tool_invocation_permit(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.initialize_research_version_frontier(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.issue_tool_invocation_permit(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.mark_research_invocation_outcome_unknown(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.mark_research_resource_abandoned(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.prepare_invocation_terminal(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.publish_current_report_readiness(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.reserve_research_resource(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.revoke_current_readiness(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.revoke_tool_invocation_permit(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.settle_research_resource(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.start_research_invocation(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.tombstone_invocation_result(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.read_historical_l2_research_artifact(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_committed_adapter_termination_receipt(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_committed_invocation_outcome_usage(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_committed_model_invocation_result(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_committed_secure_sql_execution_receipt(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_committed_sql_invocation_result(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_committed_tool_invocation_result(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_current_tool_invocation_permit(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_invocation_result_ciphertext(jsonb)
owner to data_agent_u6_rpc_owner;
alter function app_data_agent.resolve_invocation_terminal_preparation_recovery_metadata(jsonb)
owner to data_agent_u6_rpc_owner;

alter function app_data_agent.activate_u6_result_key_version(jsonb)
owner to data_agent_u6_provisioner_owner;
alter function app_data_agent.compromise_u6_result_key_version(jsonb)
owner to data_agent_u6_provisioner_owner;
alter function app_data_agent.provision_u6_authority_manifest(jsonb)
owner to data_agent_u6_provisioner_owner;
alter function app_data_agent.provision_u6_execution_policy_manifest(jsonb)
owner to data_agent_u6_provisioner_owner;
alter function app_data_agent.purge_u6_result_ciphertext_access_audits(jsonb)
owner to data_agent_u6_provisioner_owner;
alter function app_data_agent.retire_u6_result_key_version(jsonb)
owner to data_agent_u6_provisioner_owner;
alter function app_data_agent.stage_u6_result_key_version(jsonb)
owner to data_agent_u6_provisioner_owner;

do $u6_function_ownership_and_acl$
declare
  function_name text;
  public_functions constant text[] := array[
    'abort_invocation_terminal_preparation',
    'advance_research_version_frontier',
    'authorize_agent_data_projection',
    'begin_research_resource',
    'cancel_research_resource',
    'commit_adapter_termination_receipt',
    'commit_current_l2_artifact',
    'commit_current_release_go',
    'commit_invocation_terminal',
    'commit_report_read_response',
    'commit_research_stop_terminal',
    'consume_current_ready',
    'consume_report_read_grant',
    'erase_subject_invocation_result',
    'expire_report_read_grant',
    'expire_research_resource',
    'expire_tool_invocation_permit',
    'initialize_research_version_frontier',
    'issue_tool_invocation_permit',
    'mark_research_invocation_outcome_unknown',
    'mark_research_resource_abandoned',
    'prepare_invocation_terminal',
    'publish_current_report_readiness',
    'reserve_research_resource',
    'revoke_current_readiness',
    'revoke_tool_invocation_permit',
    'settle_research_resource',
    'start_research_invocation',
    'tombstone_invocation_result',
    'read_historical_l2_research_artifact',
    'resolve_committed_adapter_termination_receipt',
    'resolve_committed_invocation_outcome_usage',
    'resolve_committed_model_invocation_result',
    'resolve_committed_secure_sql_execution_receipt',
    'resolve_committed_sql_invocation_result',
    'resolve_committed_tool_invocation_result',
    'resolve_current_tool_invocation_permit',
    'resolve_invocation_result_ciphertext',
    'resolve_invocation_terminal_preparation_recovery_metadata'
  ];
  backend_enabled_functions constant text[] := array[
    'commit_research_stop_terminal',
    'consume_current_ready',
    'publish_current_report_readiness'
  ];
  deployment_functions constant text[] := array[
    'activate_u6_result_key_version',
    'compromise_u6_result_key_version',
    'provision_u6_authority_manifest',
    'provision_u6_execution_policy_manifest',
    'purge_u6_result_ciphertext_access_audits',
    'retire_u6_result_key_version',
    'stage_u6_result_key_version'
  ];
begin
  if pg_catalog.cardinality(backend_enabled_functions) <> 3
    or (
      select pg_catalog.count(distinct enabled.function_name)
      from pg_catalog.unnest(backend_enabled_functions)
        as enabled(function_name)
    ) <> 3
    or exists (
      select 1
      from pg_catalog.unnest(backend_enabled_functions)
        as enabled(function_name)
      where not (enabled.function_name = any(public_functions))
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'U6_MIGRATION_BACKEND_FUNCTION_CLOSED_SET_MISMATCH';
  end if;

  -- C1 only activates the three Root RPCs whose bodies are fixed fail-closed
  -- after capability validation. Every positive/read path stays dormant until
  -- its strict database verifier and real PostgreSQL Oracle are certified.
  foreach function_name in array public_functions
  loop
    execute pg_catalog.format(
      'revoke all privileges on function app_data_agent.%I(jsonb) from public, anon, authenticated, service_role, data_agent_backend, data_agent_job_authority, data_agent_u6_provisioner',
      function_name
    );
    if function_name = any(backend_enabled_functions) then
      execute pg_catalog.format(
        'grant execute on function app_data_agent.%I(jsonb) to data_agent_backend',
        function_name
      );
    end if;
  end loop;

  foreach function_name in array deployment_functions
  loop
    execute pg_catalog.format(
      'revoke all privileges on function app_data_agent.%I(jsonb) from public, anon, authenticated, service_role, data_agent_backend, data_agent_job_authority',
      function_name
    );
    execute pg_catalog.format(
      'grant execute on function app_data_agent.%I(jsonb) to data_agent_u6_provisioner',
      function_name
    );
  end loop;
end
$u6_function_ownership_and_acl$;

alter function app_data_agent.cleanup_u6_delete_pending_environment(jsonb)
owner to data_agent_u6_cleanup_owner;
revoke all privileges
on function app_data_agent.cleanup_u6_delete_pending_environment(jsonb)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_u6_provisioner;
grant execute
on function app_data_agent.cleanup_u6_delete_pending_environment(jsonb)
to data_agent_job_authority;

revoke all privileges
on function platform.lock_u6_authority_binding(
  uuid, uuid, text, uuid, uuid, text, text
)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_u6_provisioner;
grant execute
on function platform.lock_u6_authority_binding(
  uuid, uuid, text, uuid, uuid, text, text
)
to data_agent_u6_rpc_owner, data_agent_u6_provisioner_owner;

revoke all privileges
on function platform.lock_u6_cleanup_platform_evidence(
  uuid, text, bigint, uuid, text, uuid, text, uuid, text, uuid, text
)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_u6_provisioner;
grant execute
on function platform.lock_u6_cleanup_platform_evidence(
  uuid, text, bigint, uuid, text, uuid, text, uuid, text, uuid, text
)
to data_agent_u6_cleanup_owner;

revoke all privileges on function app_data_agent.u6_domain_sha256(text, jsonb)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_u6_provisioner;
revoke all privileges on function app_data_agent.u6_uuid_v5(uuid, bytea)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_u6_provisioner;
revoke all privileges
on function app_data_agent.u6_strict_base64url_decode(text)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_u6_provisioner;
revoke all privileges
on function app_data_agent.u6_constant_time_equal(bytea, bytea)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_u6_provisioner;
revoke all privileges
on function app_data_agent.lock_u6_authority_capability(
  jsonb, text, text, text, text, boolean
)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_u6_provisioner;
revoke all privileges
on function app_data_agent.commit_research_revocation_receipt(jsonb)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_u6_provisioner;
revoke all privileges
on function app_data_agent.commit_research_system_artifact(jsonb)
from public, anon, authenticated, service_role, data_agent_backend,
  data_agent_job_authority, data_agent_u6_provisioner;

grant execute on function app_data_agent.u6_domain_sha256(text, jsonb)
to data_agent_u6_provisioner_owner, data_agent_u6_cleanup_owner;
do $u6_catalog_postconditions$
declare
  relation_name text;
  function_signature text;
  expected_relations constant text[] := array[
    'current_report_readiness',
    'report_read_grant_expiration_operations',
    'report_read_grants',
    'research_adapter_termination_receipts',
    'research_artifact_commit_operations',
    'research_authority_capabilities',
    'research_authority_capability_heads',
    'research_current_evidence_relation_keys',
    'research_domain_terminals',
    'research_frontier_events',
    'research_frontier_operations',
    'research_invocation_commits',
    'research_invocation_outcome_usage',
    'research_invocation_request_operations',
    'research_invocation_result_blobs',
    'research_invocation_results',
    'research_invocation_terminal_preparations',
    'research_invocation_transition_operations',
    'research_lifecycle_cleanup_batch_receipts',
    'research_lifecycle_cleanup_operations',
    'research_readiness_consumptions',
    'research_readiness_publications',
    'research_release_decision_commits',
    'research_resource_reservations',
    'research_resource_run_heads',
    'research_resource_transition_operations',
    'research_result_access_audit_purge_operations',
    'research_result_access_audit_retention_heads',
    'research_result_access_audit_retention_policies',
    'research_result_ciphertext_access_audits',
    'research_result_key_transition_operations',
    'research_result_key_versions',
    'research_result_retention_policies',
    'research_result_retention_policy_heads',
    'research_revocation_operations',
    'research_secure_sql_execution_receipts',
    'research_stop_terminal_commits',
    'research_system_artifacts',
    'research_system_record_identities',
    'research_system_record_transition_operations',
    'research_tool_invocation_permits',
    'research_tool_permit_policy_limits',
    'research_version_frontiers'
  ];
  backend_enabled_function_signatures constant text[] := array[
    'app_data_agent.commit_research_stop_terminal(jsonb)',
    'app_data_agent.consume_current_ready(jsonb)',
    'app_data_agent.publish_current_report_readiness(jsonb)'
  ];
  backend_withheld_function_signatures constant text[] := array[
    'app_data_agent.abort_invocation_terminal_preparation(jsonb)',
    'app_data_agent.advance_research_version_frontier(jsonb)',
    'app_data_agent.authorize_agent_data_projection(jsonb)',
    'app_data_agent.begin_research_resource(jsonb)',
    'app_data_agent.cancel_research_resource(jsonb)',
    'app_data_agent.commit_adapter_termination_receipt(jsonb)',
    'app_data_agent.commit_current_l2_artifact(jsonb)',
    'app_data_agent.commit_current_release_go(jsonb)',
    'app_data_agent.commit_invocation_terminal(jsonb)',
    'app_data_agent.commit_report_read_response(jsonb)',
    'app_data_agent.consume_report_read_grant(jsonb)',
    'app_data_agent.erase_subject_invocation_result(jsonb)',
    'app_data_agent.expire_report_read_grant(jsonb)',
    'app_data_agent.expire_research_resource(jsonb)',
    'app_data_agent.expire_tool_invocation_permit(jsonb)',
    'app_data_agent.initialize_research_version_frontier(jsonb)',
    'app_data_agent.issue_tool_invocation_permit(jsonb)',
    'app_data_agent.mark_research_invocation_outcome_unknown(jsonb)',
    'app_data_agent.mark_research_resource_abandoned(jsonb)',
    'app_data_agent.prepare_invocation_terminal(jsonb)',
    'app_data_agent.reserve_research_resource(jsonb)',
    'app_data_agent.revoke_current_readiness(jsonb)',
    'app_data_agent.revoke_tool_invocation_permit(jsonb)',
    'app_data_agent.settle_research_resource(jsonb)',
    'app_data_agent.start_research_invocation(jsonb)',
    'app_data_agent.tombstone_invocation_result(jsonb)',
    'app_data_agent.read_historical_l2_research_artifact(jsonb)',
    'app_data_agent.resolve_committed_adapter_termination_receipt(jsonb)',
    'app_data_agent.resolve_committed_invocation_outcome_usage(jsonb)',
    'app_data_agent.resolve_committed_model_invocation_result(jsonb)',
    'app_data_agent.resolve_committed_secure_sql_execution_receipt(jsonb)',
    'app_data_agent.resolve_committed_sql_invocation_result(jsonb)',
    'app_data_agent.resolve_committed_tool_invocation_result(jsonb)',
    'app_data_agent.resolve_current_tool_invocation_permit(jsonb)',
    'app_data_agent.resolve_invocation_result_ciphertext(jsonb)',
    'app_data_agent.resolve_invocation_terminal_preparation_recovery_metadata(jsonb)'
  ];
  deployment_function_signatures constant text[] := array[
    'app_data_agent.activate_u6_result_key_version(jsonb)',
    'app_data_agent.compromise_u6_result_key_version(jsonb)',
    'app_data_agent.provision_u6_authority_manifest(jsonb)',
    'app_data_agent.provision_u6_execution_policy_manifest(jsonb)',
    'app_data_agent.purge_u6_result_ciphertext_access_audits(jsonb)',
    'app_data_agent.retire_u6_result_key_version(jsonb)',
    'app_data_agent.stage_u6_result_key_version(jsonb)'
  ];
  protected_role_names constant text[] := array[
    'data_agent_u6_data_owner',
    'data_agent_u6_platform_lock_owner',
    'data_agent_u6_rpc_owner',
    'data_agent_u6_provisioner_owner',
    'data_agent_u6_cleanup_owner',
    'data_agent_u6_provisioner'
  ];
  membership_violation_count bigint;
  membership_option_violation_count bigint;
begin
  if pg_catalog.current_setting('server_version_num')::integer
       not between 170000 and 179999
  then
    raise exception using
      errcode = '0A000',
      message = 'U6_MIGRATION_POSTGRES_VERSION_UNSUPPORTED';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    join pg_catalog.pg_roles as owner
      on owner.oid = relation.relowner
    where namespace.nspname = 'app_data_agent'
      and relation.relname = any(expected_relations)
      and relation.relkind = 'r'
      and owner.rolname = 'data_agent_u6_data_owner'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ) <> pg_catalog.cardinality(expected_relations) then
    raise exception using
      errcode = 'P0001',
      message = 'U6_MIGRATION_RELATION_CATALOG_MISMATCH';
  end if;

  if not pg_catalog.has_schema_privilege(
    'data_agent_u6_data_owner',
    'app_data_agent',
    'USAGE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'U6_MIGRATION_DATA_OWNER_SCHEMA_ACL_MISMATCH';
  end if;

  foreach relation_name in array expected_relations
  loop
    if pg_catalog.has_table_privilege(
      'data_agent_backend',
      'app_data_agent.' || relation_name,
      'SELECT'
    )
      or pg_catalog.has_table_privilege(
        'data_agent_backend',
        'app_data_agent.' || relation_name,
        'INSERT'
      )
      or pg_catalog.has_table_privilege(
        'data_agent_backend',
        'app_data_agent.' || relation_name,
        'UPDATE'
      )
      or pg_catalog.has_table_privilege(
        'data_agent_backend',
        'app_data_agent.' || relation_name,
        'DELETE'
      )
    then
      raise exception using
        errcode = 'P0001',
        message = 'U6_MIGRATION_TABLE_ACL_MISMATCH';
    end if;
  end loop;

  if pg_catalog.cardinality(backend_enabled_function_signatures) <> 3
    or pg_catalog.cardinality(backend_withheld_function_signatures) <> 36
    or exists (
      select 1
      from pg_catalog.unnest(backend_enabled_function_signatures)
        as enabled(function_signature_value)
      where enabled.function_signature_value =
        any(backend_withheld_function_signatures)
    )
    or (
      select pg_catalog.count(distinct candidate.function_signature_value)
      from pg_catalog.unnest(
        backend_enabled_function_signatures || backend_withheld_function_signatures
      ) as candidate(function_signature_value)
    ) <> 39
  then
    raise exception using
      errcode = 'P0001',
      message = 'U6_MIGRATION_BACKEND_FUNCTION_CLOSED_SET_MISMATCH';
  end if;

  foreach function_signature in array backend_enabled_function_signatures
  loop
    if pg_catalog.to_regprocedure(function_signature) is null
      or not pg_catalog.has_function_privilege(
        'data_agent_backend',
        function_signature,
        'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'public',
        function_signature,
        'EXECUTE'
      )
    then
      raise exception using
        errcode = 'P0001',
        message = 'U6_MIGRATION_BACKEND_FUNCTION_ACL_MISMATCH';
    end if;
  end loop;

  foreach function_signature in array backend_withheld_function_signatures
  loop
    if pg_catalog.to_regprocedure(function_signature) is null
      or pg_catalog.has_function_privilege(
        'data_agent_backend',
        function_signature,
        'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'public',
        function_signature,
        'EXECUTE'
      )
    then
      raise exception using
        errcode = 'P0001',
        message = 'U6_MIGRATION_WITHHELD_FUNCTION_ACL_MISMATCH';
    end if;
  end loop;

  foreach function_signature in array deployment_function_signatures
  loop
    if pg_catalog.to_regprocedure(function_signature) is null
      or not pg_catalog.has_function_privilege(
        'data_agent_u6_provisioner',
        function_signature,
        'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'data_agent_backend',
        function_signature,
        'EXECUTE'
      )
      or pg_catalog.has_function_privilege(
        'public',
        function_signature,
        'EXECUTE'
      )
    then
      raise exception using
        errcode = 'P0001',
        message = 'U6_MIGRATION_DEPLOYMENT_FUNCTION_ACL_MISMATCH';
    end if;
  end loop;

  if not pg_catalog.has_function_privilege(
    'data_agent_job_authority',
    'app_data_agent.cleanup_u6_delete_pending_environment(jsonb)',
    'EXECUTE'
  )
    or pg_catalog.has_function_privilege(
      'data_agent_backend',
      'app_data_agent.cleanup_u6_delete_pending_environment(jsonb)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'public',
      'app_data_agent.cleanup_u6_delete_pending_environment(jsonb)',
      'EXECUTE'
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'U6_MIGRATION_CLEANUP_FUNCTION_ACL_MISMATCH';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_roles as role
    where role.rolname in (
      'data_agent_u6_data_owner',
      'data_agent_u6_platform_lock_owner',
      'data_agent_u6_rpc_owner',
      'data_agent_u6_provisioner_owner',
      'data_agent_u6_cleanup_owner',
      'data_agent_u6_provisioner'
    )
      and (
        role.rolcanlogin
        or role.rolsuper
        or role.rolcreatedb
        or role.rolcreaterole
        or role.rolreplication
        or role.rolinherit
        or role.rolbypassrls
      )
  ) or (
    select pg_catalog.count(*)
    from pg_catalog.pg_roles as role
    where role.rolname in (
      'data_agent_u6_data_owner',
      'data_agent_u6_platform_lock_owner',
      'data_agent_u6_rpc_owner',
      'data_agent_u6_provisioner_owner',
      'data_agent_u6_cleanup_owner',
      'data_agent_u6_provisioner'
    )
  ) <> 6 then
    raise exception using
      errcode = '42501',
      message = 'U6_MIGRATION_ROLE_CATALOG_MISMATCH';
  end if;

  -- There is no role-membership allowlist in the frozen grant segment. Verify
  -- the complete member closure at commit time as well as preflight: role
  -- attributes alone do not stop a member that inherited the role or can SET
  -- ROLE through PostgreSQL 17 membership options.
  with recursive u6_protected_roles(root_role_id, root_role_name) as (
    select protected_role.oid, protected_role.rolname
    from pg_catalog.pg_roles as protected_role
    where protected_role.rolname = any(protected_role_names)
  ),
  u6_member_closure (
    root_role_id,
    root_role_name,
    granted_role_id,
    member_id,
    edge_inherit_option,
    edge_set_option,
    edge_admin_option,
    member_path
  ) as (
    select
      protected_role.root_role_id,
      protected_role.root_role_name,
      membership.roleid,
      membership.member,
      membership.inherit_option,
      membership.set_option,
      membership.admin_option,
      array[protected_role.root_role_id, membership.member]::oid[]
    from u6_protected_roles as protected_role
    join pg_catalog.pg_auth_members as membership
      on membership.roleid = protected_role.root_role_id
    union all
    select
      closure.root_role_id,
      closure.root_role_name,
      membership.roleid,
      membership.member,
      membership.inherit_option,
      membership.set_option,
      membership.admin_option,
      closure.member_path || membership.member
    from u6_member_closure as closure
    join pg_catalog.pg_auth_members as membership
      on membership.roleid = closure.member_id
    where not membership.member = any(closure.member_path)
  )
  select
    pg_catalog.count(*),
    pg_catalog.count(*) filter (
      where closure.edge_inherit_option
        or closure.edge_set_option
        or closure.edge_admin_option
    )
  into membership_violation_count, membership_option_violation_count
  from u6_member_closure as closure;

  if membership_violation_count <> 0
    or membership_option_violation_count <> 0
  then
    raise exception using
      errcode = '42501',
      message = 'U6_MIGRATION_ROLE_MEMBERSHIP_MISMATCH';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'platform'
      and relation.relname in (
        'app_environment_lifecycle',
        'resource_manifests',
        'app_lifecycle_events',
        'boundary_audit_receipts',
        'resource_operation_receipts'
      )
      and (relation.relrowsecurity or relation.relforcerowsecurity)
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'U6_MIGRATION_PLATFORM_RLS_MISMATCH';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_policy as policy
    join pg_catalog.pg_class as relation
      on relation.oid = policy.polrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and policy.polname in (
        'runs_u6_rpc_lock_select',
        'runs_u6_rpc_lock_update',
        'outbox_u6_rpc_lock_select',
        'outbox_u6_rpc_lock_update',
        'run_attempts_u6_rpc_lock_select',
        'run_attempts_u6_rpc_lock_update',
        'artifacts_u6_reserved_insert_deny',
        'artifacts_u6_reserved_update_deny',
        'artifacts_u6_reserved_delete_deny'
      )
  ) <> 9 then
    raise exception using
      errcode = 'P0001',
      message = 'U6_MIGRATION_CORE_POLICY_MISMATCH';
  end if;
end
$u6_catalog_postconditions$;

do $u6_final_maintenance_revalidation$
declare
  requested_deployment_id uuid;
  window_expires_at timestamptz;
  observed_database_identity_hash text;
  expected_database_identity_hash text;
begin
  if pg_catalog.current_setting('app.u6_maintenance_manifest_hash', true)
       is distinct from
       'sha256:70b5acaf260521a4b8d8581ca2f33dcebbeb6cd826315d3c246cfa80b35f0723'
    or pg_catalog.current_setting('app.u6_maintenance_window_id', true)
       is distinct from '00000000-0000-4000-8000-000000001590'
  then
    raise exception using
      errcode = '22023',
      message = 'U6_MIGRATION_MAINTENANCE_BINDING_INVALID';
  end if;

  begin
    requested_deployment_id :=
      pg_catalog.current_setting(
        'app.u6_maintenance_deployment_id',
        true
      )::uuid;
    window_expires_at :=
      pg_catalog.current_setting(
        'app.u6_maintenance_window_expires_at',
        true
      )::timestamptz;
    observed_database_identity_hash :=
      pg_catalog.current_setting(
        'app.u6_maintenance_database_identity_hash',
        true
      );
  exception
    when invalid_text_representation or null_value_not_allowed then
      raise exception using
        errcode = '22023',
        message = 'U6_MIGRATION_MAINTENANCE_BINDING_INVALID';
  end;

  if pg_catalog.clock_timestamp() >= window_expires_at then
    raise exception using
      errcode = '57014',
      message = 'U6_MIGRATION_WINDOW_EXPIRED';
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
              'sha256:28a47b75076c9248621af8dd9d0b16091693a2c44add6f3d0edad6bcff7d0ad4'
            )
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );
  if observed_database_identity_hash is distinct from expected_database_identity_hash
    or not exists (
      select 1
      from platform.deployment_mappings as deployment
      join platform.app_environment_lifecycle as lifecycle
        on lifecycle.app_id = deployment.app_id
       and lifecycle.environment = deployment.environment
      where deployment.deployment_id = requested_deployment_id
        and deployment.app_id =
          '00000000-0000-4000-8000-00000000da01'::uuid
        and deployment.is_active
        and lifecycle.lifecycle_state = 'ACTIVE'
    )
    or exists (
      select 1
      from platform.migration_ledger as ledger
      where ledger.owner_kind = 'app'
        and ledger.app_id =
          '00000000-0000-4000-8000-00000000da01'::uuid
        and ledger.migration_version =
          '20260725010590_app_data_agent_u6_research_authority'
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'U6_MIGRATION_FINAL_REVALIDATION_FAILED';
  end if;
end
$u6_final_maintenance_revalidation$;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010590_app_data_agent_u6_research_authority',
  'sha256:091534f8dae4132700564920f4e3e7316f6f411aff92efb108aa49d6ce255678'
);

commit;
