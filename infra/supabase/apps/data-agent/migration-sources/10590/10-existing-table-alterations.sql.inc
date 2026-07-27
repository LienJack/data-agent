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
