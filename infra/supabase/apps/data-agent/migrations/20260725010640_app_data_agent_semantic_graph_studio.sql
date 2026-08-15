-- semantic_graph_studio_migration_checksum: sha256:c5fb8ac4426ecfbce593005b220d07e45c38b66ee44991d767c5b2e953c4482d
-- ============================================================
-- 10640: Semantic Graph Studio read and authoring entrypoints
-- ============================================================
-- Depends on: 20260725010639_app_data_agent_semantic_authoring

begin;

do $bootstrap$
declare
  baseline_migration record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_GRAPH_STUDIO_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_GRAPH_STUDIO_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010639_app_data_agent_semantic_authoring';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_STUDIO_BASELINE_10639_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010640_app_data_agent_semantic_graph_studio'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_STUDIO_MIGRATION_10640_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regclass('semantic.semantic_graph_projection') is null
    or pg_catalog.to_regclass('semantic.semantic_authoring_run') is null
    or pg_catalog.to_regprocedure('semantic.start_semantic_authoring(uuid,uuid,text,uuid,text,jsonb)') is null
    or pg_catalog.to_regprocedure('semantic.assert_explorer_scope(uuid,uuid,text,uuid,text)') is null
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_STUDIO_AUTHORITY_SURFACE_MISSING';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);
create function semantic.get_active_semantic_graph_studio(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_pointer semantic.semantic_active_pointer%rowtype;
  v_binding semantic.semantic_source_release_graph_projection%rowtype;
  v_projection semantic.semantic_graph_projection%rowtype;
  v_source semantic.semantic_source_revision%rowtype;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  select pointer.* into v_pointer
  from semantic.semantic_active_pointer as pointer
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.semantic_domain = p_semantic_domain;
  if not found or v_pointer.current_release_id is null then
    return null;
  end if;
  select binding.* into v_binding
  from semantic.semantic_source_release_graph_projection as binding
  where binding.app_id = p_app_id
    and binding.tenant_id = p_tenant_id
    and binding.environment = p_environment
    and binding.semantic_domain = p_semantic_domain
    and binding.release_id = v_pointer.current_release_id;
  if not found then
    return null;
  end if;
  select projection.* into strict v_projection
  from semantic.semantic_graph_projection as projection
  where projection.app_id = p_app_id
    and projection.tenant_id = p_tenant_id
    and projection.environment = p_environment
    and projection.semantic_domain = p_semantic_domain
    and projection.projection_id = v_binding.projection_id;
  select source.* into strict v_source
  from semantic.semantic_source_revision as source
  where source.app_id = p_app_id
    and source.tenant_id = p_tenant_id
    and source.environment = p_environment
    and source.semantic_domain = p_semantic_domain
    and source.revision_id = v_binding.source_revision_id;
  if v_source.source_digest is distinct from v_binding.source_revision_digest
    or v_projection.source_revision_id is distinct from v_binding.source_revision_id
    or v_projection.source_revision_digest is distinct from v_binding.source_revision_digest
    or v_projection.source_digest is distinct from v_binding.source_digest
    or v_projection.projection_storage_digest is distinct from v_binding.projection_storage_digest
    or v_projection.projection_payload ->> 'graph_id' is distinct from v_source.source_payload #>> '{metadata,graph_id}'
    or v_projection.projection_payload ->> 'source_digest' is distinct from v_source.source_digest
    or v_source.source_payload #>> '{metadata,graph_version}' <> 'semantic-graph-source@2'
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_STUDIO_SOURCE_BINDING_MISMATCH';
  end if;
  return pg_catalog.jsonb_build_object(
    'semantic_domain', p_semantic_domain,
    'release_id', v_pointer.current_release_id,
    'release_generation', v_pointer.current_release_generation,
    'pointer_generation', v_pointer.pointer_generation,
    'projection_id', v_projection.projection_id,
    'source_revision_id', v_source.revision_id,
    'projection', v_projection.projection_payload,
    'source_graph', v_source.source_payload
  );
exception
  when no_data_found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_STUDIO_SOURCE_BINDING_MISMATCH';
end;
$function$;

create function semantic.start_semantic_studio_authoring(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_input jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_candidate_id uuid;
  v_placeholder_revision_id uuid;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  if p_input is null or pg_catalog.jsonb_typeof(p_input) <> 'object'
    or p_input ->> 'semantic_domain' <> p_semantic_domain
    or p_input ->> 'principal_id' <> p_principal_id::text
  then
    raise exception using errcode = '22023', message = 'SEMANTIC_GRAPH_STUDIO_AUTHORING_START_INVALID';
  end if;
  v_candidate_id := (p_input ->> 'candidate_id')::uuid;
  v_placeholder_revision_id := (p_input ->> 'authoring_run_id')::uuid;
  insert into semantic.semantic_candidate (
    app_id, tenant_id, environment, semantic_domain, candidate_id,
    proposer_principal, current_revision_id, candidate_status
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain, v_candidate_id,
    p_principal_id::text, v_placeholder_revision_id, 'DRAFT'
  ) on conflict (app_id, tenant_id, environment, semantic_domain, candidate_id) do nothing;
  return semantic.start_semantic_authoring(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain, p_input
  );
end;
$function$;
alter function semantic.get_active_semantic_graph_studio(uuid,uuid,text,uuid,text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.start_semantic_studio_authoring(uuid,uuid,text,uuid,text,jsonb)
  owner to data_agent_u6_rpc_owner;

revoke all on function semantic.get_active_semantic_graph_studio(uuid,uuid,text,uuid,text) from public;
revoke all on function semantic.start_semantic_studio_authoring(uuid,uuid,text,uuid,text,jsonb) from public;
grant execute on function semantic.get_active_semantic_graph_studio(uuid,uuid,text,uuid,text)
  to data_agent_backend;
grant execute on function semantic.start_semantic_studio_authoring(uuid,uuid,text,uuid,text,jsonb)
  to data_agent_backend;

do $postconditions$
declare
  function_record record;
begin
  if has_table_privilege('data_agent_backend', 'semantic.semantic_graph_projection', 'SELECT')
    or has_table_privilege('data_agent_backend', 'semantic.semantic_authoring_run', 'SELECT')
    or has_table_privilege('data_agent_backend', 'semantic.semantic_candidate', 'INSERT')
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_STUDIO_BACKEND_TABLE_PRIVILEGE_LEAK';
  end if;
  for function_record in
    select procedure.proname as function_name, procedure.provolatile, procedure.prosecdef
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'semantic'
      and procedure.proname in ('get_active_semantic_graph_studio', 'start_semantic_studio_authoring')
  loop
    if not function_record.prosecdef
      or (function_record.function_name = 'get_active_semantic_graph_studio' and function_record.provolatile <> 's')
      or (function_record.function_name = 'start_semantic_studio_authoring' and function_record.provolatile <> 'v')
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_STUDIO_RPC_SECURITY_INVALID';
    end if;
  end loop;
  if (select pg_catalog.count(*) from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'semantic'
        and procedure.proname in ('get_active_semantic_graph_studio', 'start_semantic_studio_authoring')) <> 2
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_GRAPH_STUDIO_RPC_MISSING';
  end if;
end
$postconditions$;
insert into platform.migration_ledger (
  owner_kind,
  app_id,
  migration_version,
  migration_checksum
) values (
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010640_app_data_agent_semantic_graph_studio',
  'sha256:c5fb8ac4426ecfbce593005b220d07e45c38b66ee44991d767c5b2e953c4482d'
);

commit;
