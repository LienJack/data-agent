-- ============================================================
-- 10622: Narrow candidate draft creation authority
-- ============================================================

create or replace function semantic.create_candidate_draft(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_author_principal text,
  p_idempotency_key uuid,
  p_title text,
  p_description text,
  p_change_class text,
  p_risk_level text,
  p_source_payload jsonb,
  p_diff jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $function$
declare
  existing_idempotency semantic.semantic_candidate_draft_idempotency%rowtype;
  existing_source semantic.semantic_source_revision%rowtype;
  v_input_digest text;
  v_source_payload_document jsonb;
  v_source_digest text;
  v_revision_payload jsonb;
  v_revision_digest text;
  v_candidate_id uuid;
  v_revision_id uuid;
  v_source_revision_id uuid;
  v_source_revision_number integer;
  v_base_release_id uuid;
  v_base_release_generation bigint;
begin
  if p_app_id is null
    or p_tenant_id is null
    or p_environment is null
    or p_semantic_domain is null
    or p_author_principal is null
    or p_idempotency_key is null
    or p_title is null
    or p_description is null
    or p_change_class is null
    or p_risk_level is null
    or p_source_payload is null
    or p_diff is null
    or p_environment !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or p_semantic_domain !~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'
    or pg_catalog.length(p_title) not between 1 and 256
    or pg_catalog.length(p_description) not between 1 and 2048
    or p_change_class not in ('MINOR', 'MAJOR', 'RUNTIME_AUTHORIZATION', 'SECURITY')
    or p_risk_level not in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
    or p_author_principal !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    raise exception using errcode = '22023', message = 'SEMANTIC_CANDIDATE_INVALID';
  end if;

  if pg_catalog.jsonb_typeof(p_source_payload) <> 'object'
    or not (p_source_payload ? 'schema_version')
    or not (p_source_payload ? 'source_kind')
    or not (p_source_payload ? 'content')
    or p_source_payload ->> 'schema_version' <> 'semantic-source-payload@1.0.0'
    or p_source_payload ->> 'source_kind' is null
    or p_source_payload ->> 'source_kind' not in ('MANUAL', 'AGENT', 'SCHEMA_DISCOVERY')
    or pg_catalog.jsonb_typeof(p_source_payload -> 'content') <> 'object'
    or p_source_payload - array['schema_version', 'source_kind', 'content'] <> '{}'::jsonb
  then
    raise exception using errcode = '22023', message = 'SEMANTIC_CANDIDATE_INVALID';
  end if;

  if pg_catalog.jsonb_typeof(p_diff) <> 'object'
    or not (p_diff ? 'schema_version')
    or not (p_diff ? 'summary')
    or not (p_diff ? 'operations')
    or p_diff ->> 'schema_version' <> 'semantic-diff@1.0.0'
    or p_diff ->> 'summary' is null
    or pg_catalog.length(p_diff ->> 'summary') not between 1 and 2048
    or pg_catalog.jsonb_typeof(p_diff -> 'operations') <> 'array'
    or p_diff - array['schema_version', 'summary', 'operations'] <> '{}'::jsonb
  then
    raise exception using errcode = '22023', message = 'SEMANTIC_CANDIDATE_INVALID';
  end if;

  if pg_catalog.jsonb_array_length(p_diff -> 'operations') not between 1 and 256
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_diff -> 'operations') as operation(value)
      where pg_catalog.jsonb_typeof(operation.value) <> 'object'
        or operation.value - array['path', 'change_type', 'before', 'after'] <> '{}'::jsonb
        or operation.value ->> 'path' is null
        or pg_catalog.length(operation.value ->> 'path') not between 1 and 512
        or operation.value ->> 'change_type' is null
        or operation.value ->> 'change_type' not in ('ADD', 'MODIFY', 'DELETE')
        or not (operation.value ? 'path')
        or not (operation.value ? 'change_type')
        or (
          operation.value ->> 'change_type' <> 'ADD'
          and not (operation.value ? 'before')
        )
        or (
          operation.value ->> 'change_type' <> 'DELETE'
          and not (operation.value ? 'after')
        )
    )
  then
    raise exception using errcode = '22023', message = 'SEMANTIC_CANDIDATE_INVALID';
  end if;

  if nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid is distinct from p_app_id
    or nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid is distinct from p_tenant_id
    or nullif(pg_catalog.current_setting('data_agent.environment', true), '') is distinct from p_environment
    or nullif(pg_catalog.current_setting('data_agent.principal_id', true), '') is distinct from p_author_principal
    or nullif(pg_catalog.current_setting('app.semantic_domain', true), '') is distinct from p_semantic_domain
    or not platform.backend_context_matches(p_app_id, p_tenant_id, p_environment, true)
  then
    raise exception using errcode = '42501', message = 'SEMANTIC_SCOPE_FORBIDDEN';
  end if;

  perform semantic.lock_semantic_authority_fence(
    p_app_id,
    p_tenant_id,
    p_environment,
    p_semantic_domain
  );

  perform 1
  from semantic.semantic_authority_fence as fence
  where fence.app_id = p_app_id
    and fence.tenant_id = p_tenant_id
    and fence.environment = p_environment
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'SEMANTIC_SCOPE_FORBIDDEN';
  end if;

  perform 1
  from semantic.semantic_domain_registry as domain
  where domain.app_id = p_app_id
    and domain.tenant_id = p_tenant_id
    and domain.environment = p_environment
    and domain.semantic_domain = p_semantic_domain
    and domain.is_active = true
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'SEMANTIC_SCOPE_FORBIDDEN';
  end if;

  select pointer.current_release_id, pointer.current_release_generation
  into v_base_release_id, v_base_release_generation
  from semantic.semantic_active_pointer as pointer
  where pointer.app_id = p_app_id
    and pointer.tenant_id = p_tenant_id
    and pointer.environment = p_environment
    and pointer.semantic_domain = p_semantic_domain
  for share;
  if not found then
    v_base_release_id := null;
    v_base_release_generation := 0;
  end if;

  v_input_digest := semantic.semantic_sha256(
    'semantic-candidate-draft@1.0.0',
    pg_catalog.jsonb_build_object(
      'app_id', p_app_id,
      'tenant_id', p_tenant_id,
      'environment', p_environment,
      'semantic_domain', p_semantic_domain,
      'author_principal', p_author_principal,
      'title', p_title,
      'description', p_description,
      'change_class', p_change_class,
      'risk_level', p_risk_level,
      'source_payload', p_source_payload,
      'diff', p_diff,
      'base_release_id', v_base_release_id,
      'base_release_generation', v_base_release_generation
    )
  );

  select idempotency.*
  into existing_idempotency
  from semantic.semantic_candidate_draft_idempotency as idempotency
  where idempotency.app_id = p_app_id
    and idempotency.tenant_id = p_tenant_id
    and idempotency.environment = p_environment
    and idempotency.semantic_domain = p_semantic_domain
    and idempotency.principal_id = p_author_principal::uuid
    and idempotency.idempotency_key = p_idempotency_key
  for update;
  if found then
    if existing_idempotency.input_digest <> v_input_digest then
      raise exception using errcode = '23505', message = 'SEMANTIC_CANDIDATE_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'candidate_id', existing_idempotency.candidate_id,
      'revision_id', existing_idempotency.revision_id,
      'source_revision_id', existing_idempotency.source_revision_id,
      'source_digest', existing_idempotency.source_digest,
      'revision_digest', existing_idempotency.revision_digest,
      'idempotency_digest', existing_idempotency.input_digest,
      'candidate_status', 'DRAFT',
      'created', false
    );
  end if;

  v_source_payload_document := pg_catalog.jsonb_build_object(
    'schema_version', 'semantic-candidate-source-revision@1.0.0',
    'title', p_title,
    'description', p_description,
    'risk_level', p_risk_level,
    'source', p_source_payload
  );
  v_source_digest := semantic.semantic_sha256(
    'semantic-candidate-source-revision@1.0.0',
    pg_catalog.jsonb_build_object(
      'scope', pg_catalog.jsonb_build_array(
        p_app_id,
        p_tenant_id,
        p_environment,
        p_semantic_domain
      ),
      'base_release_id', v_base_release_id,
      'base_release_generation', v_base_release_generation,
      'source_payload', v_source_payload_document,
      'author_principal', p_author_principal,
      'change_description', p_description,
      'change_class', p_change_class
    )
  );

  select source.*
  into existing_source
  from semantic.semantic_source_revision as source
  where source.app_id = p_app_id
    and source.tenant_id = p_tenant_id
    and source.environment = p_environment
    and source.semantic_domain = p_semantic_domain
    and source.source_digest = v_source_digest
  for share;
  if found then
    if existing_source.source_payload <> v_source_payload_document
      or existing_source.base_release_id is distinct from v_base_release_id
      or existing_source.base_release_generation is distinct from v_base_release_generation
      or existing_source.author_principal <> p_author_principal
      or existing_source.change_description is distinct from p_description
      or existing_source.change_class is distinct from p_change_class
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_CANDIDATE_DIGEST_COLLISION';
    end if;
    v_source_revision_id := existing_source.revision_id;
  else
    select coalesce(pg_catalog.max(source.revision_number), 0) + 1
    into v_source_revision_number
    from semantic.semantic_source_revision as source
    where source.app_id = p_app_id
      and source.tenant_id = p_tenant_id
      and source.environment = p_environment
      and source.semantic_domain = p_semantic_domain;
    v_source_revision_id := extensions.gen_random_uuid();
    insert into semantic.semantic_source_revision (
      app_id,
      tenant_id,
      environment,
      semantic_domain,
      revision_id,
      revision_number,
      base_release_id,
      base_release_generation,
      source_payload,
      source_digest,
      author_principal,
      change_description,
      change_class
    ) values (
      p_app_id,
      p_tenant_id,
      p_environment,
      p_semantic_domain,
      v_source_revision_id,
      v_source_revision_number,
      v_base_release_id,
      v_base_release_generation,
      v_source_payload_document,
      v_source_digest,
      p_author_principal,
      p_description,
      p_change_class
    );
  end if;

  v_candidate_id := extensions.gen_random_uuid();
  v_revision_id := extensions.gen_random_uuid();
  v_revision_payload := pg_catalog.jsonb_build_object(
    'schema_version', 'semantic-candidate-revision@1.0.0',
    'title', p_title,
    'description', p_description,
    'risk_level', p_risk_level,
    'source_revision_id', v_source_revision_id,
    'diff', p_diff
  );
  v_revision_digest := semantic.semantic_sha256(
    v_candidate_id::text,
    pg_catalog.jsonb_build_object(
      'revision_number', 1,
      'source_revision_id', v_source_revision_id,
      'revision_payload', v_revision_payload,
      'author_principal', p_author_principal,
      'change_description', p_description,
      'change_class', p_change_class
    )
  );

  insert into semantic.semantic_candidate (
    app_id,
    tenant_id,
    environment,
    semantic_domain,
    candidate_id,
    proposer_principal,
    current_revision_id,
    candidate_status
  ) values (
    p_app_id,
    p_tenant_id,
    p_environment,
    p_semantic_domain,
    v_candidate_id,
    p_author_principal,
    v_revision_id,
    'DRAFT'
  );

  insert into semantic.semantic_candidate_revision (
    app_id,
    tenant_id,
    environment,
    semantic_domain,
    candidate_id,
    revision_id,
    revision_number,
    source_revision_id,
    revision_payload,
    revision_digest,
    author_principal,
    change_description,
    change_class
  ) values (
    p_app_id,
    p_tenant_id,
    p_environment,
    p_semantic_domain,
    v_candidate_id,
    v_revision_id,
    1,
    v_source_revision_id,
    v_revision_payload,
    v_revision_digest,
    p_author_principal,
    p_description,
    p_change_class
  );

  insert into semantic.semantic_candidate_draft_idempotency (
    app_id,
    tenant_id,
    environment,
    semantic_domain,
    principal_id,
    idempotency_key,
    input_digest,
    candidate_id,
    revision_id,
    source_revision_id,
    source_digest,
    revision_digest
  ) values (
    p_app_id,
    p_tenant_id,
    p_environment,
    p_semantic_domain,
    p_author_principal::uuid,
    p_idempotency_key,
    v_input_digest,
    v_candidate_id,
    v_revision_id,
    v_source_revision_id,
    v_source_digest,
    v_revision_digest
  );

  insert into app_data_agent.audit_log (
    app_id,
    tenant_id,
    environment,
    audit_id,
    principal_id,
    action,
    resource_type,
    resource_id,
    details
  ) values (
    p_app_id,
    p_tenant_id,
    p_environment,
    extensions.gen_random_uuid(),
    p_author_principal::uuid,
    'SEMANTIC_CANDIDATE_DRAFT_CREATED',
    'semantic_candidate',
    v_candidate_id::text,
    pg_catalog.jsonb_build_object(
      'candidate_id', v_candidate_id,
      'revision_id', v_revision_id,
      'source_revision_id', v_source_revision_id,
      'source_digest', v_source_digest,
      'revision_digest', v_revision_digest,
      'idempotency_digest', v_input_digest
    )
  );

  return pg_catalog.jsonb_build_object(
    'candidate_id', v_candidate_id,
    'revision_id', v_revision_id,
    'source_revision_id', v_source_revision_id,
    'source_digest', v_source_digest,
    'revision_digest', v_revision_digest,
    'idempotency_digest', v_input_digest,
    'candidate_status', 'DRAFT',
    'created', true
  );
end;
$function$;

alter function semantic.create_candidate_draft(
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb
) owner to data_agent_u6_rpc_owner;

revoke all on function semantic.create_candidate_draft(
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb
) from public;

grant execute on function semantic.create_candidate_draft(
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb
) to data_agent_u6_rpc_owner;

grant execute on function semantic.create_candidate_draft(
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  jsonb,
  jsonb
) to data_agent_backend;

-- The application connection invokes the narrowly granted RPC directly. It
-- needs schema resolution but receives no table privileges.
grant usage on schema semantic to data_agent_backend;
