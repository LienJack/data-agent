-- ============================================================
-- 10624: Narrow Semantic Explorer read RPCs
-- ============================================================

create function semantic.assert_explorer_scope(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text
) returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_app_id is null
    or p_tenant_id is null
    or p_environment is null
    or p_principal_id is null
    or nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid is distinct from p_app_id
    or nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid is distinct from p_tenant_id
    or nullif(pg_catalog.current_setting('data_agent.environment', true), '') is distinct from p_environment
    or nullif(pg_catalog.current_setting('data_agent.principal_id', true), '')::uuid is distinct from p_principal_id
    or not platform.backend_context_matches(p_app_id, p_tenant_id, p_environment, false)
    or (
      p_semantic_domain is not null
      and (
        p_semantic_domain !~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'
        or nullif(pg_catalog.current_setting('app.semantic_domain', true), '') is distinct from p_semantic_domain
      )
    )
  then
    raise exception using errcode = '42501', message = 'SEMANTIC_EXPLORER_SCOPE_FORBIDDEN';
  end if;
end;
$function$;

create function semantic.build_explorer_source(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_release_id uuid,
  p_source_kind text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_pointer semantic.semantic_active_pointer%rowtype;
  v_release semantic.semantic_source_release%rowtype;
  v_executable semantic.semantic_executable_projection%rowtype;
  v_relationship semantic.semantic_relationship_projection%rowtype;
  v_restriction semantic.semantic_runtime_restriction_projection%rowtype;
  v_requested_release_id uuid;
begin
  perform semantic.assert_explorer_scope(
    p_app_id,
    p_tenant_id,
    p_environment,
    p_principal_id,
    p_semantic_domain
  );
  if p_source_kind not in ('ACTIVE', 'HISTORICAL')
    or (p_source_kind = 'ACTIVE' and p_release_id is not null)
    or (p_source_kind = 'HISTORICAL' and p_release_id is null)
  then
    raise exception using errcode = '22023', message = 'SEMANTIC_EXPLORER_CONTRACT_INVALID';
  end if;

  select pointer.*
  into v_pointer
  from semantic.semantic_active_pointer as pointer
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.semantic_domain = p_semantic_domain;
  if not found
    or v_pointer.current_release_id is null
    or v_pointer.current_release_generation = 0
    or v_pointer.current_release_digest is null
  then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_EXPLORER_ACTIVE_RELEASE_NOT_FOUND';
  end if;

  v_requested_release_id := case
    when p_source_kind = 'ACTIVE' then v_pointer.current_release_id
    else p_release_id
  end;
  select release.*
  into v_release
  from semantic.semantic_source_release as release
  where release.app_id = p_app_id
    and release.tenant_id = p_tenant_id
    and release.environment = p_environment
    and release.semantic_domain = p_semantic_domain
    and release.release_id = v_requested_release_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_EXPLORER_RELEASE_NOT_FOUND';
  end if;
  if p_source_kind = 'ACTIVE'
    and (
      v_release.release_id is distinct from v_pointer.current_release_id
      or v_release.release_generation is distinct from v_pointer.current_release_generation
      or v_release.release_digest is distinct from v_pointer.current_release_digest
    )
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_RELEASE_IDENTITY_MISMATCH';
  end if;

  select projection.*
  into v_executable
  from semantic.semantic_executable_projection as projection
  where projection.app_id = p_app_id
    and projection.tenant_id = p_tenant_id
    and projection.environment = p_environment
    and projection.semantic_domain = p_semantic_domain
    and projection.projection_id = v_release.executable_projection_ref;
  select projection.*
  into v_relationship
  from semantic.semantic_relationship_projection as projection
  where projection.app_id = p_app_id
    and projection.tenant_id = p_tenant_id
    and projection.environment = p_environment
    and projection.semantic_domain = p_semantic_domain
    and projection.projection_id = v_release.relationship_projection_ref;
  select projection.*
  into v_restriction
  from semantic.semantic_runtime_restriction_projection as projection
  where projection.app_id = p_app_id
    and projection.tenant_id = p_tenant_id
    and projection.environment = p_environment
    and projection.semantic_domain = p_semantic_domain
    and projection.projection_id = v_release.runtime_restriction_projection_ref;
  if v_executable.projection_id is null
    or v_relationship.projection_id is null
    or v_restriction.projection_id is null
  then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_EXPLORER_PROJECTION_MISSING';
  end if;
  if v_executable.release_id is distinct from v_release.release_id
    or v_executable.projection_digest is distinct from v_release.executable_projection_hash
    or v_relationship.release_id is distinct from v_release.release_id
    or v_relationship.projection_digest is distinct from v_release.relationship_projection_hash
    or v_restriction.release_id is distinct from v_release.release_id
    or v_restriction.projection_digest is distinct from v_release.runtime_restriction_projection_hash
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_PROJECTION_IDENTITY_MISMATCH';
  end if;
  if p_source_kind = 'ACTIVE'
    and v_restriction.pointer_generation is distinct from v_pointer.pointer_generation
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_PROJECTION_IDENTITY_MISMATCH';
  end if;

  return pg_catalog.jsonb_build_object(
    'source_kind', p_source_kind,
    'observed_at', pg_catalog.statement_timestamp(),
    'pointer', pg_catalog.jsonb_build_object(
      'semantic_domain', v_pointer.semantic_domain,
      'current_release_id', v_pointer.current_release_id,
      'current_release_generation', v_pointer.current_release_generation,
      'current_release_digest', v_pointer.current_release_digest,
      'pointer_generation', v_pointer.pointer_generation,
      'updated_at', v_pointer.updated_at
    ),
    'release', pg_catalog.jsonb_build_object(
      'semantic_domain', v_release.semantic_domain,
      'release_id', v_release.release_id,
      'release_generation', v_release.release_generation,
      'release_digest', v_release.release_digest,
      'candidate_id', v_release.candidate_id,
      'compiler_bundle_digest', v_release.compiler_bundle_digest,
      'executable_projection_ref', v_release.executable_projection_ref,
      'executable_projection_hash', v_release.executable_projection_hash,
      'relationship_projection_ref', v_release.relationship_projection_ref,
      'relationship_projection_hash', v_release.relationship_projection_hash,
      'runtime_restriction_projection_ref', v_release.runtime_restriction_projection_ref,
      'runtime_restriction_projection_hash', v_release.runtime_restriction_projection_hash,
      'published_at', v_release.published_at,
      'published_by', v_release.published_by
    ),
    'executable_projection', pg_catalog.jsonb_build_object(
      'projection_id', v_executable.projection_id,
      'release_id', v_executable.release_id,
      'projection_digest', v_executable.projection_digest,
      'projection_payload', v_executable.projection_payload
    ),
    'relationship_projection', pg_catalog.jsonb_build_object(
      'projection_id', v_relationship.projection_id,
      'release_id', v_relationship.release_id,
      'datasource_id', v_relationship.datasource_id,
      'catalog_epoch', v_relationship.catalog_epoch,
      'projection_digest', v_relationship.projection_digest,
      'projection_payload', v_relationship.projection_payload
    ),
    'runtime_restriction_projection', pg_catalog.jsonb_build_object(
      'projection_id', v_restriction.projection_id,
      'release_id', v_restriction.release_id,
      'projection_digest', v_restriction.projection_digest,
      'pointer_generation', v_restriction.pointer_generation,
      'projection_payload', v_restriction.restriction_payload
    )
  );
end;
$function$;

create function semantic.list_explorer_domains(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domains text[]
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_domains jsonb;
  v_observed_at timestamptz := pg_catalog.statement_timestamp();
  v_domain_count bigint;
  v_joined_count bigint;
begin
  perform semantic.assert_explorer_scope(
    p_app_id,
    p_tenant_id,
    p_environment,
    p_principal_id,
    null
  );
  if p_semantic_domains is null
    or pg_catalog.cardinality(p_semantic_domains) not between 1 and 256
    or exists (
      select 1
      from pg_catalog.unnest(p_semantic_domains) as requested(domain_name)
      where requested.domain_name !~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'
    )
    or nullif(pg_catalog.current_setting('app.semantic_allowed_domains', true), '')
      is distinct from pg_catalog.array_to_string(p_semantic_domains, ',')
  then
    raise exception using errcode = '42501', message = 'SEMANTIC_EXPLORER_SCOPE_FORBIDDEN';
  end if;
  select pg_catalog.count(*)
  into v_domain_count
  from semantic.semantic_domain_registry as domain
  where domain.app_id = p_app_id
    and domain.tenant_id = p_tenant_id
    and domain.environment = p_environment
    and domain.semantic_domain = any(p_semantic_domains);
  select pg_catalog.count(*)
  into v_joined_count
  from semantic.semantic_domain_registry as domain
  join semantic.semantic_active_pointer as pointer
    on pointer.app_id = domain.app_id
    and pointer.tenant_id = domain.tenant_id
    and pointer.environment = domain.environment
    and pointer.semantic_domain = domain.semantic_domain
  where domain.app_id = p_app_id
    and domain.tenant_id = p_tenant_id
    and domain.environment = p_environment
    and domain.semantic_domain = any(p_semantic_domains);
  if v_joined_count <> v_domain_count then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_POINTER_OBSERVATION_MISSING';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'schema_version', 'semantic-explorer-domain-summary@1.0.0',
        'semantic_domain', domain.semantic_domain,
        'datasource_id', domain.datasource_id,
        'display_name', domain.domain_display_name,
        'description', domain.domain_description,
        'pointer_observation', pg_catalog.jsonb_build_object(
          'current_release_id', pointer.current_release_id,
          'current_release_generation', pointer.current_release_generation,
          'current_release_digest', pointer.current_release_digest,
          'pointer_generation', pointer.pointer_generation,
          'observed_at', v_observed_at
        ),
        'has_current_release', pointer.current_release_id is not null
      ) order by domain.semantic_domain
    ),
    '[]'::jsonb
  )
  into v_domains
  from semantic.semantic_domain_registry as domain
  join semantic.semantic_active_pointer as pointer
    on pointer.app_id = domain.app_id
    and pointer.tenant_id = domain.tenant_id
    and pointer.environment = domain.environment
    and pointer.semantic_domain = domain.semantic_domain
  where domain.app_id = p_app_id
    and domain.tenant_id = p_tenant_id
    and domain.environment = p_environment
    and domain.semantic_domain = any(p_semantic_domains);
  return v_domains;
end;
$function$;

create function semantic.get_active_explorer_source(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select semantic.build_explorer_source(
    p_app_id,
    p_tenant_id,
    p_environment,
    p_principal_id,
    p_semantic_domain,
    null,
    'ACTIVE'
  );
$function$;

create function semantic.get_release_explorer_source(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_release_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select semantic.build_explorer_source(
    p_app_id,
    p_tenant_id,
    p_environment,
    p_principal_id,
    p_semantic_domain,
    p_release_id,
    'HISTORICAL'
  );
$function$;

create function semantic.build_explorer_release_identity(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_release_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_release semantic.semantic_source_release%rowtype;
  v_executable semantic.semantic_executable_projection%rowtype;
  v_relationship semantic.semantic_relationship_projection%rowtype;
  v_restriction semantic.semantic_runtime_restriction_projection%rowtype;
begin
  select release.*
  into v_release
  from semantic.semantic_source_release as release
  where release.app_id = p_app_id
    and release.tenant_id = p_tenant_id
    and release.environment = p_environment
    and release.semantic_domain = p_semantic_domain
    and release.release_id = p_release_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_EXPLORER_RELEASE_NOT_FOUND';
  end if;
  select projection.*
  into v_executable
  from semantic.semantic_executable_projection as projection
  where projection.app_id = p_app_id
    and projection.tenant_id = p_tenant_id
    and projection.environment = p_environment
    and projection.semantic_domain = p_semantic_domain
    and projection.projection_id = v_release.executable_projection_ref;
  select projection.*
  into v_relationship
  from semantic.semantic_relationship_projection as projection
  where projection.app_id = p_app_id
    and projection.tenant_id = p_tenant_id
    and projection.environment = p_environment
    and projection.semantic_domain = p_semantic_domain
    and projection.projection_id = v_release.relationship_projection_ref;
  select projection.*
  into v_restriction
  from semantic.semantic_runtime_restriction_projection as projection
  where projection.app_id = p_app_id
    and projection.tenant_id = p_tenant_id
    and projection.environment = p_environment
    and projection.semantic_domain = p_semantic_domain
    and projection.projection_id = v_release.runtime_restriction_projection_ref;
  if v_executable.projection_id is null
    or v_relationship.projection_id is null
    or v_restriction.projection_id is null
  then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_EXPLORER_PROJECTION_MISSING';
  end if;
  if v_executable.release_id is distinct from v_release.release_id
    or v_executable.projection_digest is distinct from v_release.executable_projection_hash
    or v_relationship.release_id is distinct from v_release.release_id
    or v_relationship.projection_digest is distinct from v_release.relationship_projection_hash
    or v_restriction.release_id is distinct from v_release.release_id
    or v_restriction.projection_digest is distinct from v_release.runtime_restriction_projection_hash
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_PROJECTION_IDENTITY_MISMATCH';
  end if;
  return pg_catalog.jsonb_build_object(
    'semantic_domain', v_release.semantic_domain,
    'release_id', v_release.release_id,
    'release_generation', v_release.release_generation,
    'release_digest', v_release.release_digest,
    'executable_projection', pg_catalog.jsonb_build_object(
      'projection_id', v_executable.projection_id,
      'projection_digest', v_executable.projection_digest
    ),
    'relationship_projection', pg_catalog.jsonb_build_object(
      'projection_id', v_relationship.projection_id,
      'projection_digest', v_relationship.projection_digest
    ),
    'runtime_restriction_projection', pg_catalog.jsonb_build_object(
      'projection_id', v_restriction.projection_id,
      'projection_digest', v_restriction.projection_digest
    ),
    'published_at', v_release.published_at,
    'published_by', v_release.published_by
  );
end;
$function$;

create function semantic.list_explorer_releases(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_limit integer,
  p_generation_cursor bigint
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_pointer semantic.semantic_active_pointer%rowtype;
  v_releases jsonb := '[]'::jsonb;
  v_observed_at timestamptz := pg_catalog.statement_timestamp();
  v_has_more boolean := false;
  v_next_cursor bigint := null;
  v_invalid_projection_count bigint := 0;
begin
  perform semantic.assert_explorer_scope(
    p_app_id,
    p_tenant_id,
    p_environment,
    p_principal_id,
    p_semantic_domain
  );
  if p_limit is null
    or p_limit not between 1 and 100
    or (p_generation_cursor is not null and p_generation_cursor < 1)
  then
    raise exception using errcode = '22023', message = 'SEMANTIC_EXPLORER_CONTRACT_INVALID';
  end if;
  select pointer.*
  into v_pointer
  from semantic.semantic_active_pointer as pointer
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.semantic_domain = p_semantic_domain;
  if not found then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_EXPLORER_POINTER_OBSERVATION_MISSING';
  end if;
  if (v_pointer.current_release_id is null) is distinct from
      (v_pointer.current_release_generation = 0 and v_pointer.current_release_digest is null)
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_RELEASE_IDENTITY_MISMATCH';
  end if;

  with page as materialized (
    select release.*
    from semantic.semantic_source_release as release
    where release.app_id = p_app_id
      and release.tenant_id = p_tenant_id
      and release.environment = p_environment
      and release.semantic_domain = p_semantic_domain
      and (p_generation_cursor is null or release.release_generation < p_generation_cursor)
    order by release.release_generation desc
    limit p_limit + 1
  ), limited as (
    select page.*
    from page
    order by page.release_generation desc
    limit p_limit
  )
  select
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'schema_version', 'semantic-explorer-release-summary@1.0.0',
          'release_identity', pg_catalog.jsonb_build_object(
            'semantic_domain', release.semantic_domain,
            'release_id', release.release_id,
            'release_generation', release.release_generation,
            'release_digest', release.release_digest,
            'executable_projection', pg_catalog.jsonb_build_object(
              'projection_id', executable.projection_id,
              'projection_digest', executable.projection_digest
            ),
            'relationship_projection', pg_catalog.jsonb_build_object(
              'projection_id', relationship.projection_id,
              'projection_digest', relationship.projection_digest
            ),
            'runtime_restriction_projection', pg_catalog.jsonb_build_object(
              'projection_id', restriction.projection_id,
              'projection_digest', restriction.projection_digest
            ),
            'published_at', release.published_at,
            'published_by', release.published_by
          ),
          'candidate_id', release.candidate_id,
          'is_current_at_observation',
            v_pointer.current_release_id is not distinct from release.release_id
            and v_pointer.current_release_generation is not distinct from release.release_generation
            and v_pointer.current_release_digest is not distinct from release.release_digest
        ) order by release.release_generation desc
      ),
      '[]'::jsonb
    ),
    (select pg_catalog.count(*) > p_limit from page),
    case
      when (select pg_catalog.count(*) > p_limit from page)
      then pg_catalog.min(release.release_generation)
      else null
    end,
    pg_catalog.count(*) filter (
      where executable.projection_id is null
        or relationship.projection_id is null
        or restriction.projection_id is null
        or executable.release_id is distinct from release.release_id
        or executable.projection_digest is distinct from release.executable_projection_hash
        or relationship.release_id is distinct from release.release_id
        or relationship.projection_digest is distinct from release.relationship_projection_hash
        or restriction.release_id is distinct from release.release_id
        or restriction.projection_digest is distinct from release.runtime_restriction_projection_hash
    )
  into v_releases, v_has_more, v_next_cursor, v_invalid_projection_count
  from limited as release
  left join semantic.semantic_executable_projection as executable
    on executable.app_id = release.app_id
    and executable.tenant_id = release.tenant_id
    and executable.environment = release.environment
    and executable.semantic_domain = release.semantic_domain
    and executable.projection_id = release.executable_projection_ref
  left join semantic.semantic_relationship_projection as relationship
    on relationship.app_id = release.app_id
    and relationship.tenant_id = release.tenant_id
    and relationship.environment = release.environment
    and relationship.semantic_domain = release.semantic_domain
    and relationship.projection_id = release.relationship_projection_ref
  left join semantic.semantic_runtime_restriction_projection as restriction
    on restriction.app_id = release.app_id
    and restriction.tenant_id = release.tenant_id
    and restriction.environment = release.environment
    and restriction.semantic_domain = release.semantic_domain
    and restriction.projection_id = release.runtime_restriction_projection_ref;
  if v_invalid_projection_count > 0 then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_PROJECTION_IDENTITY_MISMATCH';
  end if;
  return pg_catalog.jsonb_build_object(
    'schema_version', 'semantic-explorer-release-timeline@1.0.0',
    'semantic_domain', p_semantic_domain,
    'pointer_observation', pg_catalog.jsonb_build_object(
      'current_release_id', v_pointer.current_release_id,
      'current_release_generation', v_pointer.current_release_generation,
      'current_release_digest', v_pointer.current_release_digest,
      'pointer_generation', v_pointer.pointer_generation,
      'observed_at', v_observed_at
    ),
    'releases', v_releases,
    'next_generation_cursor', v_next_cursor
  );
end;
$function$;

create function semantic.get_candidate_explorer_comparison(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_candidate_id uuid,
  p_revision_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_candidate semantic.semantic_candidate%rowtype;
  v_revision semantic.semantic_candidate_revision%rowtype;
  v_source semantic.semantic_source_revision%rowtype;
  v_pointer semantic.semantic_active_pointer%rowtype;
  v_base_release semantic.semantic_source_release%rowtype;
  v_compared_release semantic.semantic_source_release%rowtype;
  v_base_identity jsonb := null;
  v_compared_identity jsonb := null;
  v_candidate_diff jsonb;
begin
  perform semantic.assert_explorer_scope(
    p_app_id,
    p_tenant_id,
    p_environment,
    p_principal_id,
    p_semantic_domain
  );
  if p_candidate_id is null or p_revision_id is null then
    raise exception using errcode = '22023', message = 'SEMANTIC_EXPLORER_CONTRACT_INVALID';
  end if;
  select candidate.*
  into v_candidate
  from semantic.semantic_candidate as candidate
  where candidate.app_id = p_app_id
    and candidate.tenant_id = p_tenant_id
    and candidate.environment = p_environment
    and candidate.semantic_domain = p_semantic_domain
    and candidate.candidate_id = p_candidate_id;
  select revision.*
  into v_revision
  from semantic.semantic_candidate_revision as revision
  where revision.app_id = p_app_id
    and revision.tenant_id = p_tenant_id
    and revision.environment = p_environment
    and revision.semantic_domain = p_semantic_domain
    and revision.candidate_id = p_candidate_id
    and revision.revision_id = p_revision_id;
  if v_candidate.candidate_id is null or v_revision.revision_id is null then
    raise exception using errcode = 'P0002', message = 'SEMANTIC_EXPLORER_CANDIDATE_NOT_FOUND';
  end if;
  select source.*
  into v_source
  from semantic.semantic_source_revision as source
  where source.app_id = p_app_id
    and source.tenant_id = p_tenant_id
    and source.environment = p_environment
    and source.semantic_domain = p_semantic_domain
    and source.revision_id = v_revision.source_revision_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_CANDIDATE_CONTRACT_INVALID';
  end if;
  if v_revision.revision_payload ->> 'schema_version' <> 'semantic-candidate-revision@1.0.0'
    or v_revision.revision_payload ->> 'source_revision_id' is distinct from v_revision.source_revision_id::text
    or pg_catalog.jsonb_typeof(v_revision.revision_payload -> 'diff') <> 'object'
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_CANDIDATE_CONTRACT_INVALID';
  end if;
  v_candidate_diff := v_revision.revision_payload -> 'diff';

  if v_source.base_release_id is null then
    if coalesce(v_source.base_release_generation, 0) <> 0 then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_CANDIDATE_CONTRACT_INVALID';
    end if;
  else
    select release.*
    into v_base_release
    from semantic.semantic_source_release as release
    where release.app_id = p_app_id
      and release.tenant_id = p_tenant_id
      and release.environment = p_environment
      and release.semantic_domain = p_semantic_domain
      and release.release_id = v_source.base_release_id;
    if not found
      or v_base_release.release_generation is distinct from v_source.base_release_generation
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_CANDIDATE_CONTRACT_INVALID';
    end if;
    v_base_identity := semantic.build_explorer_release_identity(
      p_app_id,
      p_tenant_id,
      p_environment,
      p_semantic_domain,
      v_base_release.release_id
    );
  end if;

  select pointer.*
  into v_pointer
  from semantic.semantic_active_pointer as pointer
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.semantic_domain = p_semantic_domain;
  if found and v_pointer.current_release_id is not null then
    select release.*
    into v_compared_release
    from semantic.semantic_source_release as release
    where release.app_id = p_app_id
      and release.tenant_id = p_tenant_id
      and release.environment = p_environment
      and release.semantic_domain = p_semantic_domain
      and release.release_id = v_pointer.current_release_id;
    if not found
      or v_compared_release.release_generation is distinct from v_pointer.current_release_generation
      or v_compared_release.release_digest is distinct from v_pointer.current_release_digest
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_RELEASE_IDENTITY_MISMATCH';
    end if;
    v_compared_identity := semantic.build_explorer_release_identity(
      p_app_id,
      p_tenant_id,
      p_environment,
      p_semantic_domain,
      v_compared_release.release_id
    );
  elsif found and (
    v_pointer.current_release_generation <> 0
    or v_pointer.current_release_digest is not null
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_EXPLORER_RELEASE_IDENTITY_MISMATCH';
  end if;

  return pg_catalog.jsonb_build_object(
    'schema_version', 'semantic-explorer-candidate-source@1.0.0',
    'semantic_domain', p_semantic_domain,
    'candidate_id', v_candidate.candidate_id,
    'revision_id', v_revision.revision_id,
    'revision_number', v_revision.revision_number,
    'source_revision_id', v_revision.source_revision_id,
    'candidate_status', v_candidate.candidate_status,
    'base_release', v_base_identity,
    'compared_release', v_compared_identity,
    'candidate_diff', v_candidate_diff
  );
end;
$function$;
