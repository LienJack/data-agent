-- ============================================================
-- 10632: Portable published semantic and safe target read bridges
-- ============================================================

create or replace function semantic.read_portable_published_semantic(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text
) returns table (
  semantic_domain text,
  datasource_name text,
  datasource_type text,
  release_generation bigint,
  release_digest text,
  schema_fingerprint text,
  semantic_content jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not platform.backend_context_matches(p_app_id, p_tenant_id, p_environment, false) then
    raise exception using errcode = '42501', message = 'SEMANTIC_SCOPE_FORBIDDEN';
  end if;
  return query
  select
    domain.semantic_domain,
    datasource.name,
    datasource.datasource_type,
    release.release_generation,
    release.release_digest,
    release.relationship_projection_hash,
    source.source_payload #> '{source,content}'
  from semantic.semantic_domain_registry as domain
  join app_data_agent.datasource_connections as datasource
    on datasource.app_id = domain.app_id
   and datasource.tenant_id = domain.tenant_id
   and datasource.environment = domain.environment
   and datasource.datasource_id = domain.datasource_id
  join semantic.semantic_active_pointer as pointer
    on pointer.app_id = domain.app_id
   and pointer.tenant_id = domain.tenant_id
   and pointer.environment = domain.environment
   and pointer.semantic_domain = domain.semantic_domain
  join semantic.semantic_source_release as release
    on release.app_id = pointer.app_id
   and release.tenant_id = pointer.tenant_id
   and release.environment = pointer.environment
   and release.semantic_domain = pointer.semantic_domain
   and release.release_id = pointer.current_release_id
  join semantic.semantic_candidate as candidate
    on candidate.app_id = release.app_id
   and candidate.tenant_id = release.tenant_id
   and candidate.environment = release.environment
   and candidate.semantic_domain = release.semantic_domain
   and candidate.candidate_id = release.candidate_id
  join semantic.semantic_candidate_revision as revision
    on revision.app_id = candidate.app_id
   and revision.tenant_id = candidate.tenant_id
   and revision.environment = candidate.environment
   and revision.semantic_domain = candidate.semantic_domain
   and revision.candidate_id = candidate.candidate_id
   and revision.revision_id = candidate.current_revision_id
  join semantic.semantic_source_revision as source
    on source.app_id = revision.app_id
   and source.tenant_id = revision.tenant_id
   and source.environment = revision.environment
   and source.semantic_domain = revision.semantic_domain
   and source.revision_id = revision.source_revision_id
  where domain.app_id = p_app_id
    and domain.tenant_id = p_tenant_id
    and domain.environment = p_environment
    and domain.is_active = true
    and datasource.status = 'ACTIVE'
    and pointer.current_release_id is not null
  order by domain.semantic_domain;
end;
$function$;

create or replace function semantic.read_portability_targets(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text
) returns table (
  datasource_id uuid,
  display_name text,
  dialect text,
  semantic_domains jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not platform.backend_context_matches(p_app_id, p_tenant_id, p_environment, false) then
    raise exception using errcode = '42501', message = 'SEMANTIC_SCOPE_FORBIDDEN';
  end if;
  return query
  select
    datasource.datasource_id,
    datasource.name,
    datasource.datasource_type,
    pg_catalog.jsonb_agg(domain.semantic_domain order by domain.semantic_domain)
  from app_data_agent.datasource_connections as datasource
  join semantic.semantic_domain_registry as domain
    on domain.app_id = datasource.app_id
   and domain.tenant_id = datasource.tenant_id
   and domain.environment = datasource.environment
   and domain.datasource_id = datasource.datasource_id
   and domain.is_active = true
  where datasource.app_id = p_app_id
    and datasource.tenant_id = p_tenant_id
    and datasource.environment = p_environment
    and datasource.status = 'ACTIVE'
  group by datasource.datasource_id, datasource.name, datasource.datasource_type
  order by datasource.name, datasource.datasource_id;
end;
$function$;

alter function semantic.read_portable_published_semantic(uuid, uuid, text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.read_portability_targets(uuid, uuid, text)
  owner to data_agent_u6_rpc_owner;

revoke all on function semantic.read_portable_published_semantic(uuid, uuid, text) from public;
revoke all on function semantic.read_portability_targets(uuid, uuid, text) from public;
grant execute on function semantic.read_portable_published_semantic(uuid, uuid, text)
  to data_agent_backend;
grant execute on function semantic.read_portability_targets(uuid, uuid, text)
  to data_agent_backend;
