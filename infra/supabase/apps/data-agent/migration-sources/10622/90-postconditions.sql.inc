-- ============================================================
-- 10622: Static postconditions
-- ============================================================

do $postconditions$
declare
  candidate_rpc record;
  lock_rpc record;
begin
  select procedure.prosecdef, procedure.proconfig, procedure.proisstrict,
    owner.rolname as owner_name
  into candidate_rpc
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  join pg_catalog.pg_roles as owner
    on owner.oid = procedure.proowner
    where namespace.nspname = 'semantic'
      and procedure.proname = 'create_candidate_draft'
    and procedure.pronargs = 12
    and pg_catalog.oidvectortypes(procedure.proargtypes) =
      'uuid, uuid, text, text, text, uuid, text, text, text, text, jsonb, jsonb';
  if not found
    or not candidate_rpc.prosecdef
    or pg_catalog.array_to_string(candidate_rpc.proconfig, ',') not in (
      'search_path=',
      'search_path=""'
    )
    or candidate_rpc.proisstrict
    or candidate_rpc.owner_name <> 'data_agent_u6_rpc_owner'
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_DRAFT_RPC_POSTCONDITION_FAILED';
  end if;

  if not pg_catalog.has_table_privilege(
    'data_agent_u6_rpc_owner', 'semantic.semantic_source_revision', 'SELECT'
  )
    or not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner', 'semantic.semantic_source_revision', 'INSERT'
    )
    or not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner', 'semantic.semantic_candidate', 'SELECT'
    )
    or not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner', 'semantic.semantic_candidate', 'INSERT'
    )
    or not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner', 'semantic.semantic_candidate_revision', 'SELECT'
    )
    or not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner', 'semantic.semantic_candidate_revision', 'INSERT'
    )
    or not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner', 'semantic.semantic_candidate_draft_idempotency', 'SELECT'
    )
    or not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner', 'semantic.semantic_candidate_draft_idempotency', 'INSERT'
    )
    or pg_catalog.has_table_privilege(
      'data_agent_backend', 'semantic.semantic_candidate', 'SELECT'
    )
    or pg_catalog.has_table_privilege(
      'data_agent_backend', 'semantic.semantic_candidate', 'INSERT'
    )
    or pg_catalog.has_table_privilege(
      'data_agent_backend', 'semantic.semantic_candidate', 'UPDATE'
    )
    or pg_catalog.has_table_privilege(
      'data_agent_backend', 'semantic.semantic_candidate', 'DELETE'
    )
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_DRAFT_TABLE_ACL_POSTCONDITION_FAILED';
  end if;

  if not pg_catalog.has_schema_privilege('data_agent_backend', 'semantic', 'USAGE')
    or pg_catalog.has_schema_privilege('authenticated', 'semantic', 'USAGE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend',
      'semantic.create_candidate_draft(uuid,uuid,text,text,text,uuid,text,text,text,text,jsonb,jsonb)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'semantic.create_candidate_draft(uuid,uuid,text,text,text,uuid,text,text,text,text,jsonb,jsonb)',
      'EXECUTE'
    )
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_DRAFT_RPC_ACL_POSTCONDITION_FAILED';
  end if;

  if not pg_catalog.has_schema_privilege('data_agent_u6_rpc_owner', 'platform', 'USAGE')
    or not pg_catalog.has_function_privilege(
      'data_agent_u6_rpc_owner',
      'platform.backend_context_matches(uuid,uuid,text,boolean)',
      'EXECUTE'
    )
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_DRAFT_CONTEXT_GUARD_ACL_FAILED';
  end if;

  if not pg_catalog.has_schema_privilege(
    'data_agent_u6_rpc_owner', 'app_data_agent', 'USAGE'
  )
    or not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner', 'app_data_agent.audit_log', 'INSERT'
    )
    or pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner', 'app_data_agent.audit_log', 'SELECT'
    )
    or pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner', 'app_data_agent.audit_log', 'UPDATE'
    )
    or pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner', 'app_data_agent.audit_log', 'DELETE'
    )
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_DRAFT_AUDIT_ACL_POSTCONDITION_FAILED';
  end if;

  select procedure.prosecdef, procedure.proisstrict, procedure.proconfig, procedure.prosrc,
    owner.rolname as owner_name
  into lock_rpc
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  join pg_catalog.pg_roles as owner
    on owner.oid = procedure.proowner
  where namespace.nspname = 'semantic'
    and procedure.proname = 'lock_semantic_authority_fence'
    and procedure.pronargs = 4
    and pg_catalog.oidvectortypes(procedure.proargtypes) = 'uuid, uuid, text, text';
  if not found
    or not lock_rpc.prosecdef
    or not lock_rpc.proisstrict
    or lock_rpc.owner_name <> 'data_agent_u6_rpc_owner'
    or pg_catalog.array_to_string(lock_rpc.proconfig, ',') not in (
      'search_path=',
      'search_path=""'
    )
    or pg_catalog.strpos(lock_rpc.prosrc, 'pg_catalog.encode') = 0
    or pg_catalog.strpos(lock_rpc.prosrc, 'pg_catalog.jsonb_build_array') = 0
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORITY_LOCK_POSTCONDITION_FAILED';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'semantic'
      and relation.relname = 'semantic_candidate_draft_idempotency'
      and relation.relkind = 'r'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_DRAFT_LEDGER_POSTCONDITION_FAILED';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'semantic'
      and procedure.proname in ('prepare_publish_attempt', 'commit_publish_attempt')
      and procedure.proisstrict
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_PUBLISH_OPTIONAL_ARGUMENT_POSTCONDITION_FAILED';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'semantic'
      and procedure.proname = 'commit_publish_attempt'
      and procedure.pronargs = 12
      and pg_catalog.oidvectortypes(procedure.proargtypes) =
        'uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid, text, uuid'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_PUBLISH_COMPATIBILITY_RPC_NOT_REMOVED';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'pg_catalog'
      and procedure.proname = 'digest'
      and procedure.pronargs = 2
      and pg_catalog.oidvectortypes(procedure.proargtypes) = 'bytea, text'
      and pg_catalog.obj_description(procedure.oid, 'pg_proc') =
        'data-agent:10619:temporary-pgcrypto-parser-shim'
  ) then
    raise exception using errcode = 'P0001', message = 'ATTRIBUTION_DIGEST_COMPATIBILITY_HELPER_NOT_REMOVED';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_event_trigger as event_trigger
    where event_trigger.evtname = 'data_agent_10619_attribution_body_validation'
  ) or pg_catalog.to_regprocedure(
    'app_data_agent.attribution_compatibility_function_body_guard()'
  ) is not null then
    raise exception using errcode = 'P0001', message = 'ATTRIBUTION_FUNCTION_BODY_COMPATIBILITY_GUARD_NOT_REMOVED';
  end if;
end
$postconditions$;
