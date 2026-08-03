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
       is distinct from '__SEMANTIC_MANIFEST_HASH__'
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
    'semantic.semantic_domain_registry',
    'semantic.semantic_domain_bootstrap',
    'semantic.semantic_authority_fence',
    'semantic.semantic_reviewer_policy_revision',
    'semantic.semantic_reviewer_assignment',
    'semantic.semantic_reviewer_policy_pointer',
    'semantic.semantic_catalog_fence',
    'semantic.semantic_dependency_pointer',
    'semantic.semantic_source_revision',
    'semantic.semantic_candidate',
    'semantic.semantic_candidate_revision',
    'semantic.semantic_validation_receipt',
    'semantic.semantic_review_task',
    'semantic.semantic_review_decision',
    'semantic.semantic_publish_attempt',
    'semantic.semantic_source_release',
    'semantic.semantic_executable_projection',
    'semantic.semantic_relationship_projection',
    'semantic.semantic_runtime_restriction_projection',
    'semantic.semantic_descriptive_contribution_profile_projection',
    'semantic.semantic_active_pointer',
    'semantic.semantic_grounding_issuer_draft',
    'semantic.semantic_runtime_projection_binding',
    'semantic.semantic_runtime_activation',
    'semantic.semantic_legacy_equivalence_attempt',
    'semantic.semantic_legacy_compatible_mirror',
    'semantic.semantic_legacy_equivalence_receipt',
    'semantic.semantic_legacy_closure_authorization',
    'semantic.semantic_rollback_authorization',
    'semantic.semantic_rollback_receipt',
    'semantic.semantic_outbox',
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
  semantic.semantic_domain_registry,
  semantic.semantic_domain_bootstrap,
  semantic.semantic_authority_fence,
  semantic.semantic_reviewer_policy_revision,
  semantic.semantic_reviewer_assignment,
  semantic.semantic_reviewer_policy_pointer,
  semantic.semantic_catalog_fence,
  semantic.semantic_dependency_pointer,
  semantic.semantic_source_revision,
  semantic.semantic_candidate,
  semantic.semantic_candidate_revision,
  semantic.semantic_validation_receipt,
  semantic.semantic_review_task,
  semantic.semantic_review_decision,
  semantic.semantic_publish_attempt,
  semantic.semantic_source_release,
  semantic.semantic_executable_projection,
  semantic.semantic_relationship_projection,
  semantic.semantic_runtime_restriction_projection,
  semantic.semantic_descriptive_contribution_profile_projection,
  semantic.semantic_active_pointer,
  semantic.semantic_grounding_issuer_draft,
  semantic.semantic_runtime_projection_binding,
  semantic.semantic_runtime_activation,
  semantic.semantic_legacy_equivalence_attempt,
  semantic.semantic_legacy_compatible_mirror,
  semantic.semantic_legacy_equivalence_receipt,
  semantic.semantic_legacy_closure_authorization,
  semantic.semantic_rollback_authorization,
  semantic.semantic_rollback_receipt,
  semantic.semantic_outbox,
  platform.app_environment_lifecycle,
  platform.deployment_mappings,
  app_data_agent.memberships,
  app_data_agent.runs,
  app_data_agent.run_attempts
in access exclusive mode nowait;
