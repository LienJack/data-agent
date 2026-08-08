-- semantic_draft_migration_checksum: sha256:e1dc3ccc8ecf575ff290992167dc9e8a15782a1c7fb3cba7c758feee76851467
-- ============================================================
-- 10622: Semantic Candidate Draft Authority
-- ============================================================
-- Depends on: 20260725010621_app_data_agent_published_f9
-- Adds an idempotency ledger and a narrow, database-owned draft RPC.
-- ============================================================

begin;

do $bootstrap$
declare
  baseline_migration record;
  compatibility_migration record;
  executor record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_DRAFT_MIGRATION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_DRAFT_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'SEMANTIC_DRAFT_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_extension as extension
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = extension.extnamespace
    where extension.extname = 'pgcrypto'
      and namespace.nspname = 'extensions'
  ) then
    raise exception using errcode = '0A000', message = 'SEMANTIC_DRAFT_MIGRATION_PGCRYPTO_REQUIRED';
  end if;

  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010621_app_data_agent_published_f9';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_DRAFT_BASELINE_10621_MISSING';
  end if;
  select ledger.migration_checksum
  into compatibility_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010609_app_data_agent_semantic_publish_grant_compatibility';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_DRAFT_COMPATIBILITY_10609_MISSING';
  end if;
  if exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010622_app_data_agent_semantic_candidate_draft'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_DRAFT_MIGRATION_10622_ALREADY_RECORDED';
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

lock table
  semantic.semantic_authority_fence,
  semantic.semantic_domain_registry,
  semantic.semantic_active_pointer,
  semantic.semantic_source_revision,
  semantic.semantic_candidate,
  semantic.semantic_candidate_revision,
  semantic.semantic_validation_receipt,
  semantic.semantic_review_task
in access exclusive mode nowait;
-- ============================================================
-- 10622: Candidate draft idempotency ledger
-- ============================================================

create table semantic.semantic_candidate_draft_idempotency (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null
    check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  principal_id uuid not null,
  idempotency_key uuid not null,
  input_digest text not null
    check (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  candidate_id uuid not null,
  revision_id uuid not null,
  source_revision_id uuid not null,
  source_digest text not null
    check (source_digest ~ '^sha256:[0-9a-f]{64}$'),
  revision_digest text not null
    check (revision_digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (
    app_id,
    tenant_id,
    environment,
    semantic_domain,
    principal_id,
    idempotency_key
  ),
  unique (app_id, tenant_id, environment, semantic_domain, candidate_id),
  foreign key (app_id, tenant_id, environment, semantic_domain, source_revision_id)
    references semantic.semantic_source_revision (
      app_id,
      tenant_id,
      environment,
      semantic_domain,
      revision_id
    ),
  foreign key (app_id, tenant_id, environment, semantic_domain, candidate_id, revision_id)
    references semantic.semantic_candidate_revision (
      app_id,
      tenant_id,
      environment,
      semantic_domain,
      candidate_id,
      revision_id
    )
);

alter table semantic.semantic_candidate_draft_idempotency
  owner to data_agent_u6_data_owner;

alter table semantic.semantic_candidate_draft_idempotency enable row level security;
alter table semantic.semantic_candidate_draft_idempotency force row level security;

create policy semantic_candidate_draft_idempotency_scope_policy
  on semantic.semantic_candidate_draft_idempotency
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id', true), '')::uuid
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and principal_id = nullif(pg_catalog.current_setting('data_agent.principal_id', true), '')::uuid
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

revoke all on table semantic.semantic_candidate_draft_idempotency from public;
revoke all on table semantic.semantic_candidate_draft_idempotency from data_agent_u6_web_role;
revoke all on table semantic.semantic_candidate_draft_idempotency from data_agent_u6_worker_role;
revoke all on table semantic.semantic_candidate_draft_idempotency from data_agent_u6_rpc_owner;
-- ============================================================
-- 10622: Exact Candidate writer privileges and RLS
-- ============================================================

-- Foreign-key checks execute under relation-owner security context and require
-- namespace resolution. The data owner remains NOLOGIN/NOBYPASSRLS.
grant usage on schema semantic to data_agent_u6_data_owner;
grant usage on schema platform to data_agent_u6_rpc_owner;
grant usage on schema app_data_agent to data_agent_u6_rpc_owner;
grant execute on function platform.backend_context_matches(uuid, uuid, text, boolean)
  to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.contains_potential_plaintext_secret(jsonb, text)
  to data_agent_u6_rpc_owner;

-- Tighten the two broad policies installed by 10610 to the transaction-local
-- server authority context used by the Candidate writer.
alter policy semantic_domain_registry_tenant_isolation
  on semantic.semantic_domain_registry
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

alter policy semantic_authority_fence_tenant_isolation
  on semantic.semantic_authority_fence
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
  );

create policy semantic_active_pointer_candidate_scope_policy
  on semantic.semantic_active_pointer
  for select
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

create policy semantic_source_revision_candidate_scope_policy
  on semantic.semantic_source_revision
  for all
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

create policy semantic_candidate_draft_scope_policy
  on semantic.semantic_candidate
  for all
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
    and candidate_status = 'DRAFT'
  );

create policy semantic_candidate_revision_draft_scope_policy
  on semantic.semantic_candidate_revision
  for all
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

create policy audit_log_semantic_candidate_rpc_insert
  on app_data_agent.audit_log
  for insert
  to data_agent_u6_rpc_owner
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and principal_id = nullif(
      pg_catalog.current_setting('data_agent.principal_id', true),
      ''
    )::uuid
    and action = 'SEMANTIC_CANDIDATE_DRAFT_CREATED'
    and resource_type = 'semantic_candidate'
  );

grant select, update on table semantic.semantic_domain_registry to data_agent_u6_rpc_owner;
grant select, update on table semantic.semantic_authority_fence to data_agent_u6_rpc_owner;
grant select, update on table semantic.semantic_active_pointer to data_agent_u6_rpc_owner;
grant select, insert, update on table semantic.semantic_source_revision to data_agent_u6_rpc_owner;
grant select, insert on table semantic.semantic_candidate to data_agent_u6_rpc_owner;
grant select, insert on table semantic.semantic_candidate_revision to data_agent_u6_rpc_owner;
grant select, insert, update on table semantic.semantic_candidate_draft_idempotency
  to data_agent_u6_rpc_owner;
grant insert on table app_data_agent.audit_log to data_agent_u6_rpc_owner;

revoke all on table semantic.semantic_domain_registry from data_agent_backend;
revoke all on table semantic.semantic_authority_fence from data_agent_backend;
revoke all on table semantic.semantic_active_pointer from data_agent_backend;
revoke all on table semantic.semantic_source_revision from data_agent_backend;
revoke all on table semantic.semantic_candidate from data_agent_backend;
revoke all on table semantic.semantic_candidate_revision from data_agent_backend;
revoke all on table semantic.semantic_candidate_draft_idempotency from data_agent_backend;
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
-- ============================================================
-- 10622: Repair 10610 optional publish arguments
-- ============================================================
-- The two functions declared nullable default arguments while also being STRICT,
-- which made omitted optional material short-circuit to SQL NULL. The optional
-- fields remain nullable, but required projection/compiler material stays strict
-- at the TypeScript contract and inside each function's state checks.

alter function semantic.prepare_publish_attempt(
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  text,
  bigint,
  bigint,
  bigint,
  text,
  jsonb
) called on null input;

alter function semantic.commit_publish_attempt(
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  text,
  uuid,
  text,
  uuid,
  text,
  jsonb,
  uuid
) called on null input;

-- Remove the inert 12-argument overload after the historical 10610 GRANT has
-- resolved. It never contains a mutation path and is absent from the final API.
drop function if exists semantic.commit_publish_attempt(
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  text,
  uuid,
  text,
  uuid,
  text,
  uuid
);
-- ============================================================
-- 10622: Repair the 10610 semantic advisory-lock key
-- ============================================================
-- pgcrypto.digest returns bytea. Convert its first eight bytes to hex before
-- casting to bit(64), and frame the scope as JSON to avoid concatenation
-- ambiguity. CREATE OR REPLACE preserves the registered owner and ACL.

create or replace function semantic.lock_semantic_authority_fence(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text
) returns void
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  lock_key bigint;
begin
  lock_key := (
    'x' || pg_catalog.encode(
      pg_catalog.substr(
        extensions.digest(
          pg_catalog.convert_to(
            pg_catalog.jsonb_build_array(
              p_app_id,
              p_tenant_id,
              p_environment,
              p_semantic_domain
            )::text,
            'UTF8'
          ),
          'sha256'
        ),
        1,
        8
      ),
      'hex'
    )
  )::bit(64)::bigint;
  perform pg_catalog.pg_advisory_xact_lock(lock_key);
end
$function$;

alter function semantic.lock_semantic_authority_fence(uuid, uuid, text, text)
  owner to data_agent_u6_rpc_owner;
-- ============================================================
-- 10622: Remove the temporary pgcrypto parser shim
-- ============================================================
-- Historical 10620/10621 SQL bodies contain an invalid canonical helper and
-- qualify digest in pg_catalog. Rewrite the canonical helper and both hashes,
-- then remove only the compatibility aids explicitly tagged by 10619.
-- CREATE OR REPLACE preserves owner/ACL.

create or replace function app_data_agent.attribution_canonical_json(
  p_value jsonb
) returns text
  language plpgsql
  strict
  immutable
  set search_path = ''
as $function$
declare
  result text;
begin
  case pg_catalog.jsonb_typeof(p_value)
    when 'object' then
      select '{' || coalesce(
        pg_catalog.string_agg(
          pg_catalog.to_json(object_entry.key)::text || ':' ||
            app_data_agent.attribution_canonical_json(object_entry.value),
          ',' order by object_entry.key
        ),
        ''
      ) || '}'
      into result
      from pg_catalog.jsonb_each(p_value) as object_entry(key, value);
    when 'array' then
      select '[' || coalesce(
        pg_catalog.string_agg(
          app_data_agent.attribution_canonical_json(array_entry.value),
          ',' order by array_entry.ordinal
        ),
        ''
      ) || ']'
      into result
      from pg_catalog.jsonb_array_elements(p_value) with ordinality
        as array_entry(value, ordinal);
    when 'string' then
      result := pg_catalog.to_json(p_value #>> '{}')::text;
    when 'number' then
      result := p_value::text;
    when 'boolean' then
      result := p_value::text;
    when 'null' then
      result := 'null';
    else
      raise exception using
        errcode = '22023',
        message = 'ATTRIBUTION_CANONICAL_JSON_UNSUPPORTED_TYPE';
  end case;
  return result;
end
$function$;

create or replace function app_data_agent.attribution_sha256(
  p_domain text,
  p_payload jsonb
) returns text
  language sql
  strict
  immutable
  set search_path = ''
as $function$
  select pg_catalog.encode(
    extensions.digest(
      p_domain::bytea || pg_catalog.decode('00', 'hex') ||
        app_data_agent.attribution_canonical_json(p_payload)::bytea,
      'sha256'
    ),
    'hex'
  )
$function$;

create or replace function app_data_agent.hash_f9_evidence(
  p_domain text,
  p_payload jsonb
) returns text
  language sql
  strict
  immutable
  set search_path = ''
as $function$
  select pg_catalog.encode(
    extensions.digest(
      p_domain::bytea || pg_catalog.decode('00', 'hex') ||
        app_data_agent.attribution_canonical_json(p_payload)::bytea,
      'sha256'
    ),
    'hex'
  )
$function$;

do $cleanup$
declare
  digest_oid oid;
  body_guard_oid oid;
begin
  select procedure.oid
  into digest_oid
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'pg_catalog'
    and procedure.proname = 'digest'
    and procedure.pronargs = 2
    and pg_catalog.oidvectortypes(procedure.proargtypes) = 'bytea, text'
    and pg_catalog.obj_description(procedure.oid, 'pg_proc') =
      'data-agent:10619:temporary-pgcrypto-parser-shim';

  if found then
    execute 'drop function pg_catalog.digest(bytea, text)';
  end if;

  select event_trigger.oid
  into body_guard_oid
  from pg_catalog.pg_event_trigger as event_trigger
  where event_trigger.evtname = 'data_agent_10619_attribution_body_validation'
    and pg_catalog.obj_description(event_trigger.oid, 'pg_event_trigger') =
      'data-agent:10619:temporary-attribution-function-body-validation-guard';

  if found then
    execute 'drop event trigger data_agent_10619_attribution_body_validation';
    execute 'drop function app_data_agent.attribution_compatibility_function_body_guard()';
  end if;
end
$cleanup$;
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
-- ============================================================
-- 10622: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010622_app_data_agent_semantic_candidate_draft',
  'sha256:e1dc3ccc8ecf575ff290992167dc9e8a15782a1c7fb3cba7c758feee76851467'
);

commit;
