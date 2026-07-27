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
  '__U6_MIGRATION_CHECKSUM__'
);

commit;
