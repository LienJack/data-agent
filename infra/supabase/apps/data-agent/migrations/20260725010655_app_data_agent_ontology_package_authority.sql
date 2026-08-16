-- ontology_package_migration_checksum: sha256:08b8056198a93598c2e79cd36f46558532473f4ddd81b9bc06f630a8f51be1bf
-- ============================================================
-- 10655: Greenfield Ontology Package authority
-- Depends on: 10654 Provider Invocation Authority and 10638 Graph v2
-- Creates empty append-only authority only. No release publish/backfill/dual-read.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'ONTOLOGY_PACKAGE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'ONTOLOGY_PACKAGE_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010654_app_data_agent_provider_invocation_authority'
  ) then
    raise exception using errcode = 'P0001', message = 'ONTOLOGY_PACKAGE_BASELINE_10654_MISSING';
  end if;
  if pg_catalog.to_regclass('semantic.semantic_candidate_revision') is null
    or pg_catalog.to_regclass('semantic.semantic_graph_projection') is null
  then
    raise exception using errcode = 'P0001', message = 'ONTOLOGY_PACKAGE_GRAPH_AUTHORITY_MISSING';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u4_data_owner') then
    create role data_agent_u4_data_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u4_rpc_owner') then
    create role data_agent_u4_rpc_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';
select platform.acquire_migration_lock('app', '00000000-0000-4000-8000-00000000da01'::uuid);
-- ============================================================
-- Immutable package, validation and preview receipts.
-- Existing Candidate Revision and Graph Projection remain the only source authorities.
-- ============================================================

create table semantic.ontology_package_candidates (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  namespace_id uuid not null,
  package_id uuid not null,
  package_version bigint not null check (package_version between 1 and 9007199254740991),
  package_hash text not null check (package_hash ~ '^sha256:[0-9a-f]{64}$'),
  candidate_id uuid not null,
  revision_id uuid not null,
  revision_digest text not null check (revision_digest ~ '^sha256:[0-9a-f]{64}$'),
  package_json jsonb not null check (
    pg_catalog.jsonb_typeof(package_json) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(package_json)
  ),
  committed_by uuid not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,semantic_domain,package_id,package_version),
  unique (app_id,tenant_id,environment,semantic_domain,namespace_id,package_hash),
  unique (app_id,tenant_id,environment,semantic_domain,package_id,package_version,package_hash),
  foreign key (app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id)
    references semantic.semantic_candidate_revision (
      app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id
    ) on delete restrict
);

create table semantic.ontology_package_validation_receipts (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  receipt_id uuid not null,
  namespace_id uuid not null,
  package_id uuid not null,
  package_version bigint not null check (package_version between 1 and 9007199254740991),
  package_hash text not null check (package_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_binding_hash text not null check (source_binding_hash ~ '^sha256:[0-9a-f]{64}$'),
  compiler_digest text not null check (compiler_digest ~ '^sha256:[0-9a-f]{64}$'),
  validator_version text not null check (validator_version ~ '^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'),
  valid boolean not null,
  receipt_json jsonb not null check (
    pg_catalog.jsonb_typeof(receipt_json) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(receipt_json)
  ),
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  committed_by uuid not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,semantic_domain,receipt_id),
  unique (app_id,tenant_id,environment,semantic_domain,package_id,package_version,receipt_hash),
  unique (app_id,tenant_id,environment,semantic_domain,receipt_id,receipt_hash),
  foreign key (app_id,tenant_id,environment,semantic_domain,package_id,package_version,package_hash)
    references semantic.ontology_package_candidates (
      app_id,tenant_id,environment,semantic_domain,package_id,package_version,package_hash
    ) on delete restrict
);

create table semantic.ontology_package_preview_bindings (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null check (semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  preview_id uuid not null,
  namespace_id uuid not null,
  package_id uuid not null,
  package_version bigint not null check (package_version between 1 and 9007199254740991),
  package_hash text not null check (package_hash ~ '^sha256:[0-9a-f]{64}$'),
  validation_receipt_id uuid not null,
  validation_receipt_hash text not null check (validation_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  projection_id uuid not null,
  projection_storage_digest text not null check (projection_storage_digest ~ '^sha256:[0-9a-f]{64}$'),
  preview_json jsonb not null check (
    pg_catalog.jsonb_typeof(preview_json) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(preview_json)
  ),
  preview_hash text not null check (preview_hash ~ '^sha256:[0-9a-f]{64}$'),
  committed_by uuid not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,semantic_domain,preview_id),
  unique (app_id,tenant_id,environment,semantic_domain,package_id,package_version),
  unique (app_id,tenant_id,environment,semantic_domain,preview_hash),
  foreign key (app_id,tenant_id,environment,semantic_domain,package_id,package_version,package_hash)
    references semantic.ontology_package_candidates (
      app_id,tenant_id,environment,semantic_domain,package_id,package_version,package_hash
    ) on delete restrict,
  foreign key (
    app_id,tenant_id,environment,semantic_domain,validation_receipt_id,validation_receipt_hash
  ) references semantic.ontology_package_validation_receipts (
    app_id,tenant_id,environment,semantic_domain,receipt_id,receipt_hash
  ) on delete restrict,
  foreign key (app_id,tenant_id,environment,semantic_domain,projection_id)
    references semantic.semantic_graph_projection (
      app_id,tenant_id,environment,semantic_domain,projection_id
    ) on delete restrict
);

create function semantic.reject_ontology_package_authority_mutation()
returns trigger language plpgsql set search_path = '' as $function$
begin
  raise exception using errcode = '55000', message = 'ONTOLOGY_PACKAGE_AUTHORITY_IMMUTABLE';
end
$function$;

create trigger ontology_package_candidates_immutable
before update or delete on semantic.ontology_package_candidates
for each row execute function semantic.reject_ontology_package_authority_mutation();
create trigger ontology_package_validation_receipts_immutable
before update or delete on semantic.ontology_package_validation_receipts
for each row execute function semantic.reject_ontology_package_authority_mutation();
create trigger ontology_package_preview_bindings_immutable
before update or delete on semantic.ontology_package_preview_bindings
for each row execute function semantic.reject_ontology_package_authority_mutation();
-- ============================================================
-- Narrow package commit, validation commit, preview bind and exact read RPCs.
-- ============================================================

create function semantic.ontology_package_json_has_exact_keys(p_value jsonb, p_keys text[])
returns boolean language sql immutable strict set search_path = '' as $function$
  select pg_catalog.jsonb_typeof(p_value) = 'object'
    and p_value - p_keys = '{}'::jsonb
    and not exists (
      select 1 from pg_catalog.unnest(p_keys) as required(key)
      where not p_value ? required.key
    )
$function$;

create function semantic.assert_ontology_package_document(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_package jsonb
) returns void
language plpgsql immutable set search_path = '' as $function$
declare
  v_namespace_id text;
begin
  if p_package is null
    or not semantic.ontology_package_json_has_exact_keys(p_package,array[
      'schema_version','namespace','package_id','package_version','status','source_binding',
      'dependencies','imports','objects','business_subjects','dimensions','edge_semantics',
      'constraints','physical_mappings','metric_bindings','graph_source','mandatory_manifest',
      'package_hash'
    ]::text[])
    or p_package ->> 'schema_version' <> 'ontology-package@1.0.0'
    or p_package ->> 'status' <> 'CANDIDATE'
    or coalesce(p_package ->> 'package_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_package ->> 'package_version','') !~ '^[1-9][0-9]{0,15}$'
    or coalesce(p_package ->> 'package_hash','') !~ '^sha256:[0-9a-f]{64}$'
    or p_package ->> 'package_hash' <> app_data_agent.u2_canonical_sha256(p_package - 'package_hash')
    or pg_catalog.jsonb_typeof(p_package -> 'dependencies') <> 'array'
    or pg_catalog.jsonb_typeof(p_package -> 'imports') <> 'array'
    or pg_catalog.jsonb_typeof(p_package -> 'objects') <> 'array'
    or pg_catalog.jsonb_array_length(p_package -> 'objects') = 0
    or pg_catalog.jsonb_typeof(p_package -> 'business_subjects') <> 'array'
    or pg_catalog.jsonb_typeof(p_package -> 'dimensions') <> 'array'
    or pg_catalog.jsonb_typeof(p_package -> 'edge_semantics') <> 'array'
    or pg_catalog.jsonb_typeof(p_package -> 'constraints') <> 'array'
    or pg_catalog.jsonb_typeof(p_package -> 'physical_mappings') <> 'array'
    or pg_catalog.jsonb_typeof(p_package -> 'metric_bindings') <> 'array'
    or p_package #>> '{namespace,app_id}' <> p_app_id::text
    or p_package #>> '{namespace,tenant_id}' <> p_tenant_id::text
    or p_package #>> '{namespace,workspace_id}' <> p_tenant_id::text
    or p_package #>> '{namespace,environment}' <> p_environment
    or p_package #>> '{namespace,semantic_domain}' <> p_semantic_domain
    or p_package #>> '{graph_source,metadata,scope,app_id}' <> p_app_id::text
    or p_package #>> '{graph_source,metadata,scope,tenant_id}' <> p_tenant_id::text
    or p_package #>> '{graph_source,metadata,scope,environment}' <> p_environment
    or p_package #>> '{graph_source,metadata,domain_id}' <> p_semantic_domain
    or p_package #> '{graph_source,metadata,base_release_id}' <> 'null'::jsonb
    or p_package #>> '{source_binding,schema_snapshot,source_role}' <> 'SCHEMA_SNAPSHOT'
    or p_package #>> '{source_binding,business_source_bundle,source_role}' <> 'BUSINESS_SOURCE_BUNDLE'
    or p_package #>> '{source_binding,policy,source_role}' <> 'POLICY_DIGEST'
  then
    raise exception using errcode = '22023', message = 'ONTOLOGY_PACKAGE_DOCUMENT_INVALID';
  end if;
  v_namespace_id := p_package #>> '{namespace,namespace_id}';
  if coalesce(v_namespace_id,'') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or exists (
      select 1
      from pg_catalog.jsonb_path_query(p_package,'lax $.**.namespace_id') as scoped(value)
      where scoped.value #>> '{}' <> v_namespace_id
    )
    or exists (
      select 1
      from pg_catalog.jsonb_path_query(p_package,'lax $.**.source_role') as source(value)
      where source.value #>> '{}' in (
        'FALCON_GOLD','FALCON_EXPECTED','FALCON_SEALED','FALCON_HOLDOUT',
        'BENCHMARK_GOLD','EXPECTED','SEALED','HOLDOUT','TEST_CASE'
      )
    )
    or (
      select pg_catalog.count(*) <> pg_catalog.count(distinct entry.value ->> 'object_id')
      from pg_catalog.jsonb_array_elements(p_package -> 'objects') as entry(value)
    )
  then
    raise exception using errcode = '22023', message = 'ONTOLOGY_PACKAGE_SOURCE_CLOSURE_INVALID';
  end if;
end
$function$;

create function semantic.commit_ontology_package_candidate(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_candidate_id uuid,
  p_revision_id uuid,
  p_package jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_revision semantic.semantic_candidate_revision%rowtype;
  v_existing semantic.ontology_package_candidates%rowtype;
  v_committed_at timestamptz;
begin
  perform semantic.assert_explorer_scope(
    p_app_id,p_tenant_id,p_environment,p_principal_id,p_semantic_domain
  );
  perform semantic.lock_semantic_authority_fence(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain
  );
  perform semantic.assert_ontology_package_document(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_package
  );
  select revision.* into v_revision
  from semantic.semantic_candidate_revision as revision
  where revision.app_id = p_app_id and revision.tenant_id = p_tenant_id
    and revision.environment = p_environment and revision.semantic_domain = p_semantic_domain
    and revision.candidate_id = p_candidate_id and revision.revision_id = p_revision_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'ONTOLOGY_PACKAGE_CANDIDATE_REVISION_NOT_FOUND';
  end if;
  select package.* into v_existing
  from semantic.ontology_package_candidates as package
  where package.app_id = p_app_id and package.tenant_id = p_tenant_id
    and package.environment = p_environment and package.semantic_domain = p_semantic_domain
    and package.package_id = (p_package ->> 'package_id')::uuid
    and package.package_version = (p_package ->> 'package_version')::bigint;
  if found then
    if v_existing.package_hash <> p_package ->> 'package_hash'
      or v_existing.candidate_id <> p_candidate_id
      or v_existing.revision_id <> p_revision_id
      or v_existing.package_json <> p_package
    then
      raise exception using errcode = '23505', message = 'ONTOLOGY_PACKAGE_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'namespace_id',v_existing.namespace_id,'package_id',v_existing.package_id,
      'package_version',v_existing.package_version,'package_hash',v_existing.package_hash,
      'candidate_id',v_existing.candidate_id,'revision_id',v_existing.revision_id,
      'revision_digest',v_existing.revision_digest,'committed_at',v_existing.committed_at,
      'replayed',true
    );
  end if;
  insert into semantic.ontology_package_candidates (
    app_id,tenant_id,environment,semantic_domain,namespace_id,package_id,package_version,
    package_hash,candidate_id,revision_id,revision_digest,package_json,committed_by
  ) values (
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,
    (p_package #>> '{namespace,namespace_id}')::uuid,(p_package ->> 'package_id')::uuid,
    (p_package ->> 'package_version')::bigint,p_package ->> 'package_hash',
    p_candidate_id,p_revision_id,v_revision.revision_digest,p_package,p_principal_id
  ) returning committed_at into v_committed_at;
  return pg_catalog.jsonb_build_object(
    'namespace_id',(p_package #>> '{namespace,namespace_id}')::uuid,
    'package_id',(p_package ->> 'package_id')::uuid,
    'package_version',(p_package ->> 'package_version')::bigint,
    'package_hash',p_package ->> 'package_hash','candidate_id',p_candidate_id,
    'revision_id',p_revision_id,'revision_digest',v_revision.revision_digest,
    'committed_at',v_committed_at,'replayed',false
  );
end
$function$;

create function semantic.commit_ontology_package_validation(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_receipt jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_package semantic.ontology_package_candidates%rowtype;
  v_existing semantic.ontology_package_validation_receipts%rowtype;
  v_committed_at timestamptz;
begin
  perform semantic.assert_explorer_scope(
    p_app_id,p_tenant_id,p_environment,p_principal_id,p_semantic_domain
  );
  perform semantic.lock_semantic_authority_fence(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain
  );
  if p_receipt is null
    or not semantic.ontology_package_json_has_exact_keys(p_receipt,array[
      'schema_version','receipt_id','namespace','package_id','package_version','package_hash',
      'source_binding_hash','compiler_digest','validator_version','valid','issues',
      'validated_at','receipt_hash'
    ]::text[])
    or p_receipt ->> 'schema_version' <> 'ontology-package-validation@1.0.0'
    or p_receipt #>> '{namespace,app_id}' <> p_app_id::text
    or p_receipt #>> '{namespace,tenant_id}' <> p_tenant_id::text
    or p_receipt #>> '{namespace,workspace_id}' <> p_tenant_id::text
    or p_receipt #>> '{namespace,environment}' <> p_environment
    or p_receipt #>> '{namespace,semantic_domain}' <> p_semantic_domain
    or pg_catalog.jsonb_typeof(p_receipt -> 'issues') <> 'array'
    or (p_receipt ->> 'valid')::boolean is distinct from
      (pg_catalog.jsonb_array_length(p_receipt -> 'issues') = 0)
    or p_receipt ->> 'receipt_hash' <> app_data_agent.u2_canonical_sha256(p_receipt - 'receipt_hash')
  then
    raise exception using errcode = '22023', message = 'ONTOLOGY_PACKAGE_VALIDATION_INVALID';
  end if;
  select package.* into v_package from semantic.ontology_package_candidates as package
  where package.app_id = p_app_id and package.tenant_id = p_tenant_id
    and package.environment = p_environment and package.semantic_domain = p_semantic_domain
    and package.package_id = (p_receipt ->> 'package_id')::uuid
    and package.package_version = (p_receipt ->> 'package_version')::bigint
    and package.package_hash = p_receipt ->> 'package_hash'
    and package.namespace_id = (p_receipt #>> '{namespace,namespace_id}')::uuid;
  if not found then
    raise exception using errcode = 'P0002', message = 'ONTOLOGY_PACKAGE_CANDIDATE_NOT_FOUND';
  end if;
  select receipt.* into v_existing
  from semantic.ontology_package_validation_receipts as receipt
  where receipt.app_id = p_app_id and receipt.tenant_id = p_tenant_id
    and receipt.environment = p_environment and receipt.semantic_domain = p_semantic_domain
    and receipt.receipt_id = (p_receipt ->> 'receipt_id')::uuid;
  if found then
    if v_existing.receipt_hash <> p_receipt ->> 'receipt_hash' or v_existing.receipt_json <> p_receipt then
      raise exception using errcode = '23505', message = 'ONTOLOGY_PACKAGE_VALIDATION_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'receipt_id',v_existing.receipt_id,'namespace_id',v_existing.namespace_id,
      'package_id',v_existing.package_id,'package_version',v_existing.package_version,
      'package_hash',v_existing.package_hash,'receipt_hash',v_existing.receipt_hash,
      'valid',v_existing.valid,'committed_at',v_existing.committed_at,'replayed',true
    );
  end if;
  insert into semantic.ontology_package_validation_receipts (
    app_id,tenant_id,environment,semantic_domain,receipt_id,namespace_id,package_id,
    package_version,package_hash,source_binding_hash,compiler_digest,validator_version,
    valid,receipt_json,receipt_hash,committed_by
  ) values (
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,(p_receipt ->> 'receipt_id')::uuid,
    (p_receipt #>> '{namespace,namespace_id}')::uuid,(p_receipt ->> 'package_id')::uuid,
    (p_receipt ->> 'package_version')::bigint,p_receipt ->> 'package_hash',
    p_receipt ->> 'source_binding_hash',p_receipt ->> 'compiler_digest',
    p_receipt ->> 'validator_version',(p_receipt ->> 'valid')::boolean,p_receipt,
    p_receipt ->> 'receipt_hash',p_principal_id
  ) returning committed_at into v_committed_at;
  return pg_catalog.jsonb_build_object(
    'receipt_id',(p_receipt ->> 'receipt_id')::uuid,
    'namespace_id',(p_receipt #>> '{namespace,namespace_id}')::uuid,
    'package_id',(p_receipt ->> 'package_id')::uuid,
    'package_version',(p_receipt ->> 'package_version')::bigint,
    'package_hash',p_receipt ->> 'package_hash','receipt_hash',p_receipt ->> 'receipt_hash',
    'valid',(p_receipt ->> 'valid')::boolean,'committed_at',v_committed_at,'replayed',false
  );
end
$function$;

create function semantic.bind_ontology_package_preview(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_command jsonb
) returns jsonb
language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_preview jsonb;
  v_preview_hash text;
  v_validation semantic.ontology_package_validation_receipts%rowtype;
  v_projection semantic.semantic_graph_projection%rowtype;
  v_existing semantic.ontology_package_preview_bindings%rowtype;
  v_committed_at timestamptz;
begin
  perform semantic.assert_explorer_scope(
    p_app_id,p_tenant_id,p_environment,p_principal_id,p_semantic_domain
  );
  perform semantic.lock_semantic_authority_fence(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain
  );
  if p_command is null or not semantic.ontology_package_json_has_exact_keys(p_command,array[
    'schema_version','preview_id','validation_receipt_id','validation_receipt_hash',
    'projection_id','projection_storage_digest','preview'
  ]::text[]) or p_command ->> 'schema_version' <> 'ontology-package-preview-binding@1.0.0'
  then
    raise exception using errcode = '22023', message = 'ONTOLOGY_PACKAGE_PREVIEW_COMMAND_INVALID';
  end if;
  v_preview := p_command -> 'preview';
  if not semantic.ontology_package_json_has_exact_keys(v_preview,array[
    'schema_version','namespace_id','package_id','package_version','package_hash',
    'graph_source_digest','mandatory_object_ids','runtime_queryable_object_ids',
    'knowledge_only_object_ids','formula_ast_digests','compiler_version','compiler_digest'
  ]::text[]) or v_preview ->> 'schema_version' <> 'ontology-package-preview@1.0.0'
    or pg_catalog.jsonb_typeof(v_preview -> 'mandatory_object_ids') <> 'array'
    or pg_catalog.jsonb_typeof(v_preview -> 'runtime_queryable_object_ids') <> 'array'
    or pg_catalog.jsonb_typeof(v_preview -> 'knowledge_only_object_ids') <> 'array'
    or pg_catalog.jsonb_typeof(v_preview -> 'formula_ast_digests') <> 'array'
  then
    raise exception using errcode = '22023', message = 'ONTOLOGY_PACKAGE_PREVIEW_INVALID';
  end if;
  select receipt.* into v_validation
  from semantic.ontology_package_validation_receipts as receipt
  where receipt.app_id = p_app_id and receipt.tenant_id = p_tenant_id
    and receipt.environment = p_environment and receipt.semantic_domain = p_semantic_domain
    and receipt.receipt_id = (p_command ->> 'validation_receipt_id')::uuid
    and receipt.receipt_hash = p_command ->> 'validation_receipt_hash'
    and receipt.valid;
  if not found or v_validation.namespace_id <> (v_preview ->> 'namespace_id')::uuid
    or v_validation.package_id <> (v_preview ->> 'package_id')::uuid
    or v_validation.package_version <> (v_preview ->> 'package_version')::bigint
    or v_validation.package_hash <> v_preview ->> 'package_hash'
    or v_validation.compiler_digest <> v_preview ->> 'compiler_digest'
  then
    raise exception using errcode = 'P0001', message = 'ONTOLOGY_PACKAGE_PREVIEW_VALIDATION_MISMATCH';
  end if;
  select projection.* into v_projection from semantic.semantic_graph_projection as projection
  where projection.app_id = p_app_id and projection.tenant_id = p_tenant_id
    and projection.environment = p_environment and projection.semantic_domain = p_semantic_domain
    and projection.projection_id = (p_command ->> 'projection_id')::uuid
    and projection.projection_storage_digest = p_command ->> 'projection_storage_digest'
    and projection.source_digest = v_preview ->> 'graph_source_digest';
  if not found then
    raise exception using errcode = 'P0002', message = 'ONTOLOGY_PACKAGE_GRAPH_PROJECTION_NOT_FOUND';
  end if;
  v_preview_hash := app_data_agent.u2_canonical_sha256(v_preview);
  select binding.* into v_existing from semantic.ontology_package_preview_bindings as binding
  where binding.app_id = p_app_id and binding.tenant_id = p_tenant_id
    and binding.environment = p_environment and binding.semantic_domain = p_semantic_domain
    and binding.preview_id = (p_command ->> 'preview_id')::uuid;
  if found then
    if v_existing.preview_hash <> v_preview_hash or v_existing.preview_json <> v_preview
      or v_existing.validation_receipt_id <> v_validation.receipt_id
      or v_existing.projection_id <> v_projection.projection_id
    then
      raise exception using errcode = '23505', message = 'ONTOLOGY_PACKAGE_PREVIEW_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'preview_id',v_existing.preview_id,'namespace_id',v_existing.namespace_id,
      'package_id',v_existing.package_id,'package_version',v_existing.package_version,
      'package_hash',v_existing.package_hash,
      'validation_receipt_id',v_existing.validation_receipt_id,
      'validation_receipt_hash',v_existing.validation_receipt_hash,
      'projection_id',v_existing.projection_id,
      'projection_storage_digest',v_existing.projection_storage_digest,
      'preview_hash',v_existing.preview_hash,'committed_at',v_existing.committed_at,'replayed',true
    );
  end if;
  insert into semantic.ontology_package_preview_bindings (
    app_id,tenant_id,environment,semantic_domain,preview_id,namespace_id,package_id,
    package_version,package_hash,validation_receipt_id,validation_receipt_hash,
    projection_id,projection_storage_digest,preview_json,preview_hash,committed_by
  ) values (
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,(p_command ->> 'preview_id')::uuid,
    (v_preview ->> 'namespace_id')::uuid,(v_preview ->> 'package_id')::uuid,
    (v_preview ->> 'package_version')::bigint,v_preview ->> 'package_hash',
    v_validation.receipt_id,v_validation.receipt_hash,v_projection.projection_id,
    v_projection.projection_storage_digest,v_preview,v_preview_hash,p_principal_id
  ) returning committed_at into v_committed_at;
  return pg_catalog.jsonb_build_object(
    'preview_id',(p_command ->> 'preview_id')::uuid,
    'namespace_id',(v_preview ->> 'namespace_id')::uuid,
    'package_id',(v_preview ->> 'package_id')::uuid,
    'package_version',(v_preview ->> 'package_version')::bigint,
    'package_hash',v_preview ->> 'package_hash','validation_receipt_id',v_validation.receipt_id,
    'validation_receipt_hash',v_validation.receipt_hash,'projection_id',v_projection.projection_id,
    'projection_storage_digest',v_projection.projection_storage_digest,
    'preview_hash',v_preview_hash,'committed_at',v_committed_at,'replayed',false
  );
end
$function$;

create function semantic.get_ontology_package_preview(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_package_id uuid,
  p_package_version bigint
) returns jsonb
language plpgsql stable security definer set search_path = '' as $function$
declare
  v_binding semantic.ontology_package_preview_bindings%rowtype;
begin
  perform semantic.assert_explorer_scope(
    p_app_id,p_tenant_id,p_environment,p_principal_id,p_semantic_domain
  );
  select binding.* into v_binding from semantic.ontology_package_preview_bindings as binding
  where binding.app_id = p_app_id and binding.tenant_id = p_tenant_id
    and binding.environment = p_environment and binding.semantic_domain = p_semantic_domain
    and binding.package_id = p_package_id and binding.package_version = p_package_version;
  if not found then return null; end if;
  return pg_catalog.jsonb_build_object(
    'binding',pg_catalog.jsonb_build_object(
    'preview_id',v_binding.preview_id,'namespace_id',v_binding.namespace_id,
    'package_id',v_binding.package_id,'package_version',v_binding.package_version,
    'package_hash',v_binding.package_hash,
    'validation_receipt_id',v_binding.validation_receipt_id,
    'validation_receipt_hash',v_binding.validation_receipt_hash,
    'projection_id',v_binding.projection_id,
    'projection_storage_digest',v_binding.projection_storage_digest,
    'preview_hash',v_binding.preview_hash,'committed_at',v_binding.committed_at,'replayed',true
    ),
    'preview',v_binding.preview_json
  );
end
$function$;
-- ============================================================
-- Ownership, FORCE RLS, exact grants and postconditions.
-- ============================================================

alter table semantic.ontology_package_candidates owner to data_agent_u4_data_owner;
alter table semantic.ontology_package_validation_receipts owner to data_agent_u4_data_owner;
alter table semantic.ontology_package_preview_bindings owner to data_agent_u4_data_owner;

alter table semantic.ontology_package_candidates enable row level security;
alter table semantic.ontology_package_candidates force row level security;
alter table semantic.ontology_package_validation_receipts enable row level security;
alter table semantic.ontology_package_validation_receipts force row level security;
alter table semantic.ontology_package_preview_bindings enable row level security;
alter table semantic.ontology_package_preview_bindings force row level security;

create policy ontology_package_candidates_rpc_owner
on semantic.ontology_package_candidates for all to data_agent_u4_rpc_owner
using (true) with check (true);
create policy ontology_package_validation_rpc_owner
on semantic.ontology_package_validation_receipts for all to data_agent_u4_rpc_owner
using (true) with check (true);
create policy ontology_package_preview_rpc_owner
on semantic.ontology_package_preview_bindings for all to data_agent_u4_rpc_owner
using (true) with check (true);

create policy ontology_package_candidate_revision_read
on semantic.semantic_candidate_revision for select to data_agent_u4_rpc_owner
using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
);
create policy ontology_package_graph_projection_read
on semantic.semantic_graph_projection for select to data_agent_u4_rpc_owner
using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
);

grant usage on schema semantic to data_agent_u4_data_owner;
grant usage on schema semantic,platform,app_data_agent to data_agent_u4_rpc_owner;
grant select,insert on table
  semantic.ontology_package_candidates,
  semantic.ontology_package_validation_receipts,
  semantic.ontology_package_preview_bindings
to data_agent_u4_rpc_owner;
grant select on table semantic.semantic_candidate_revision,semantic.semantic_graph_projection
to data_agent_u4_rpc_owner;
grant execute on function
  semantic.assert_explorer_scope(uuid,uuid,text,uuid,text),
  semantic.lock_semantic_authority_fence(uuid,uuid,text,text),
  semantic.ontology_package_json_has_exact_keys(jsonb,text[]),
  semantic.assert_ontology_package_document(uuid,uuid,text,text,jsonb),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text)
to data_agent_u4_rpc_owner;

alter function semantic.commit_ontology_package_candidate(uuid,uuid,text,uuid,text,uuid,uuid,jsonb)
  owner to data_agent_u4_rpc_owner;
alter function semantic.commit_ontology_package_validation(uuid,uuid,text,uuid,text,jsonb)
  owner to data_agent_u4_rpc_owner;
alter function semantic.bind_ontology_package_preview(uuid,uuid,text,uuid,text,jsonb)
  owner to data_agent_u4_rpc_owner;
alter function semantic.get_ontology_package_preview(uuid,uuid,text,uuid,text,uuid,bigint)
  owner to data_agent_u4_rpc_owner;

revoke all on function semantic.commit_ontology_package_candidate(uuid,uuid,text,uuid,text,uuid,uuid,jsonb) from public;
revoke all on function semantic.commit_ontology_package_validation(uuid,uuid,text,uuid,text,jsonb) from public;
revoke all on function semantic.bind_ontology_package_preview(uuid,uuid,text,uuid,text,jsonb) from public;
revoke all on function semantic.get_ontology_package_preview(uuid,uuid,text,uuid,text,uuid,bigint) from public;
grant execute on function semantic.commit_ontology_package_candidate(uuid,uuid,text,uuid,text,uuid,uuid,jsonb)
  to data_agent_backend;
grant execute on function semantic.commit_ontology_package_validation(uuid,uuid,text,uuid,text,jsonb)
  to data_agent_backend;
grant execute on function semantic.bind_ontology_package_preview(uuid,uuid,text,uuid,text,jsonb)
  to data_agent_backend;
grant execute on function semantic.get_ontology_package_preview(uuid,uuid,text,uuid,text,uuid,bigint)
  to data_agent_backend;

revoke all on table
  semantic.ontology_package_candidates,
  semantic.ontology_package_validation_receipts,
  semantic.ontology_package_preview_bindings
from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

do $postconditions$
declare
  relation_name text;
  function_name text;
  function_record record;
begin
  foreach relation_name in array array[
    'ontology_package_candidates','ontology_package_validation_receipts',
    'ontology_package_preview_bindings'
  ] loop
    if not (select class.relrowsecurity and class.relforcerowsecurity
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'semantic' and class.relname = relation_name)
    then
      raise exception using errcode = 'P0001', message = 'ONTOLOGY_PACKAGE_RLS_POSTCONDITION_FAILED';
    end if;
    if not pg_catalog.has_table_privilege('data_agent_u4_rpc_owner','semantic.' || relation_name,'SELECT')
      or not pg_catalog.has_table_privilege('data_agent_u4_rpc_owner','semantic.' || relation_name,'INSERT')
      or pg_catalog.has_table_privilege('data_agent_backend','semantic.' || relation_name,'SELECT')
      or pg_catalog.has_table_privilege('data_agent_backend','semantic.' || relation_name,'INSERT')
    then
      raise exception using errcode = 'P0001', message = 'ONTOLOGY_PACKAGE_GRANT_POSTCONDITION_FAILED';
    end if;
  end loop;
  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname in ('data_agent_u4_data_owner','data_agent_u4_rpc_owner')
      and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolinherit)
  ) then
    raise exception using errcode = 'P0001', message = 'ONTOLOGY_PACKAGE_ROLE_POSTCONDITION_FAILED';
  end if;
  foreach function_name in array array[
    'commit_ontology_package_candidate','commit_ontology_package_validation',
    'bind_ontology_package_preview','get_ontology_package_preview'
  ] loop
    select procedure.prosecdef,procedure.proconfig,procedure.provolatile,owner.rolname as owner_name
    into function_record
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where namespace.nspname = 'semantic' and procedure.proname = function_name;
    if not found or not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_u4_rpc_owner'
      or pg_catalog.array_to_string(function_record.proconfig,',') not in ('search_path=','search_path=""')
      or (function_name = 'get_ontology_package_preview' and function_record.provolatile <> 's')
      or (function_name <> 'get_ontology_package_preview' and function_record.provolatile <> 'v')
    then
      raise exception using errcode = 'P0001', message = 'ONTOLOGY_PACKAGE_RPC_POSTCONDITION_FAILED';
    end if;
  end loop;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010655_app_data_agent_ontology_package_authority',
  'sha256:08b8056198a93598c2e79cd36f46558532473f4ddd81b9bc06f630a8f51be1bf'
);

commit;
