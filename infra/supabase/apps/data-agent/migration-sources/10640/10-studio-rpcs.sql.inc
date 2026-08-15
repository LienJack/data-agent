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
