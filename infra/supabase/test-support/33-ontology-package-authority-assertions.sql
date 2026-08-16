\set ON_ERROR_STOP on

begin isolation level repeatable read read only;
do $ontology_package_surface$
declare
  relation_name text;
  function_name text;
  definition text;
begin
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010655_app_data_agent_ontology_package_authority'
  ) then
    raise exception 'ONTOLOGY_PACKAGE_LEDGER_ASSERTION_FAILED';
  end if;
  foreach relation_name in array array[
    'ontology_package_candidates','ontology_package_validation_receipts',
    'ontology_package_preview_bindings'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'semantic' and relation.relname = relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend',pg_catalog.format('semantic.%I',relation_name),
      'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception 'ONTOLOGY_PACKAGE_RELATION_SURFACE_ASSERTION_FAILED:%',relation_name;
    end if;
  end loop;
  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname in ('data_agent_u4_data_owner','data_agent_u4_rpc_owner')
      and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolinherit)
  ) then
    raise exception 'ONTOLOGY_PACKAGE_ROLE_ASSERTION_FAILED';
  end if;
  foreach function_name in array array[
    'commit_ontology_package_candidate','commit_ontology_package_validation',
    'bind_ontology_package_preview','get_ontology_package_preview'
  ] loop
    select pg_catalog.pg_get_functiondef(procedure.oid) into strict definition
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'semantic' and procedure.proname = function_name;
    if definition not like '%SECURITY DEFINER%' or definition not like '%SET search_path TO ''''%'
    then
      raise exception 'ONTOLOGY_PACKAGE_RPC_HARDENING_ASSERTION_FAILED:%',function_name;
    end if;
  end loop;
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict definition
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'semantic' and procedure.proname = 'assert_ontology_package_document';
  if definition not like '%base_release_id%'
    or definition not like '%FALCON_GOLD%'
    or definition not like '%FALCON_EXPECTED%'
    or definition not like '%FALCON_SEALED%'
    or definition not like '%FALCON_HOLDOUT%'
    or definition not like '%u2_canonical_sha256%'
    or definition not like '%workspace_id%'
  then
    raise exception 'ONTOLOGY_PACKAGE_GREENFIELD_BOUNDARY_ASSERTION_FAILED';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'semantic'
      and procedure.proname in (
        'commit_ontology_package_candidate','commit_ontology_package_validation',
        'bind_ontology_package_preview','get_ontology_package_preview'
      )
      and pg_catalog.pg_get_functiondef(procedure.oid) ~* '(semantic_source_release|semantic_active_pointer|falcon|billing|price|credit)'
  ) then
    raise exception 'ONTOLOGY_PACKAGE_FORBIDDEN_DEPENDENCY_ASSERTION_FAILED';
  end if;
end
$ontology_package_surface$;
rollback;

do $ontology_package_greenfield_empty$
begin
  if (select pg_catalog.count(*) from semantic.ontology_package_candidates) <> 0
    or (select pg_catalog.count(*) from semantic.ontology_package_validation_receipts) <> 0
    or (select pg_catalog.count(*) from semantic.ontology_package_preview_bindings) <> 0
  then
    raise exception 'ONTOLOGY_PACKAGE_GREENFIELD_TABLES_NOT_EMPTY';
  end if;
end
$ontology_package_greenfield_empty$;

-- Exercise the immutable candidate and validation Authority using a rollback-only,
-- empty-database fixture. This proves canonical replay, conflict, hash-tamper and
-- cross-workspace rejection without importing any benchmark or application data.
begin;

insert into app_data_agent.workspaces (
  app_id, environment, workspace_id, slug, display_name
) values (
  '00000000-0000-4000-8000-00000000da01'::uuid,
  'local',
  '00000000-0000-4000-8000-00000000a401'::uuid,
  'u4-ontology-authority-fixture',
  'U4 ontology authority fixture'
);

insert into app_data_agent.memberships (
  app_id, tenant_id, environment, principal_id, membership_role,
  workspace_role, membership_source, system_override
) values (
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000a401'::uuid,
  'local',
  '00000000-0000-4000-8000-00000000a402'::uuid,
  'owner', 'WORKSPACE_ADMIN', 'EXPLICIT', false
);

insert into semantic.semantic_candidate (
  app_id, tenant_id, environment, semantic_domain, candidate_id,
  proposer_principal, current_revision_id, candidate_status
) values (
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000a401'::uuid,
  'local', 'commerce',
  '00000000-0000-4000-8000-00000000a403'::uuid,
  '00000000-0000-4000-8000-00000000a402',
  '00000000-0000-4000-8000-00000000a404'::uuid,
  'DRAFT'
);

insert into semantic.semantic_candidate_revision (
  app_id, tenant_id, environment, semantic_domain, candidate_id, revision_id,
  revision_number, source_revision_id, revision_payload, revision_digest,
  author_principal, change_class
) values (
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000a401'::uuid,
  'local', 'commerce',
  '00000000-0000-4000-8000-00000000a403'::uuid,
  '00000000-0000-4000-8000-00000000a404'::uuid,
  1,
  '00000000-0000-4000-8000-00000000a405'::uuid,
  '{"fixture":"u4-ontology-authority"}'::jsonb,
  'sha256:' || pg_catalog.repeat('4', 64),
  '00000000-0000-4000-8000-00000000a402',
  'MINOR'
);

create temporary table u4_ontology_assertion_documents (
  package jsonb not null,
  cross_scope_package jsonb not null,
  validation_receipt jsonb not null
) on commit drop;

do $ontology_package_documents$
declare
  v_package jsonb;
  v_cross_scope jsonb;
  v_receipt jsonb;
begin
  v_package := pg_catalog.jsonb_build_object(
    'schema_version','ontology-package@1.0.0',
    'namespace',pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-00000000a401',
      'workspace_id','00000000-0000-4000-8000-00000000a401',
      'environment','local','semantic_domain','commerce',
      'namespace_id','00000000-0000-4000-8000-00000000a406'
    ),
    'package_id','00000000-0000-4000-8000-00000000a407',
    'package_version',1,'status','CANDIDATE',
    'source_binding',pg_catalog.jsonb_build_object(
      'schema_snapshot',pg_catalog.jsonb_build_object('source_role','SCHEMA_SNAPSHOT'),
      'business_source_bundle',pg_catalog.jsonb_build_object('source_role','BUSINESS_SOURCE_BUNDLE'),
      'policy',pg_catalog.jsonb_build_object('source_role','POLICY_DIGEST')
    ),
    'dependencies','[]'::jsonb,'imports','[]'::jsonb,
    'objects','[{"object_id":"00000000-0000-4000-8000-00000000a408"}]'::jsonb,
    'business_subjects','[]'::jsonb,'dimensions','[]'::jsonb,
    'edge_semantics','[]'::jsonb,'constraints','[]'::jsonb,
    'physical_mappings','[]'::jsonb,'metric_bindings','[]'::jsonb,
    'graph_source',pg_catalog.jsonb_build_object(
      'metadata',pg_catalog.jsonb_build_object(
        'scope',pg_catalog.jsonb_build_object(
          'app_id','00000000-0000-4000-8000-00000000da01',
          'tenant_id','00000000-0000-4000-8000-00000000a401',
          'environment','local'
        ),
        'domain_id','commerce','base_release_id',null
      )
    ),
    'mandatory_manifest','{}'::jsonb
  );
  v_package := v_package || pg_catalog.jsonb_build_object(
    'package_hash',app_data_agent.u2_canonical_sha256(v_package)
  );
  v_cross_scope := pg_catalog.jsonb_set(v_package,'{namespace,tenant_id}',
    '"00000000-0000-4000-8000-00000000a499"'::jsonb);
  v_cross_scope := pg_catalog.jsonb_set(v_cross_scope,'{namespace,workspace_id}',
    '"00000000-0000-4000-8000-00000000a499"'::jsonb);
  v_cross_scope := pg_catalog.jsonb_set(v_cross_scope,'{graph_source,metadata,scope,tenant_id}',
    '"00000000-0000-4000-8000-00000000a499"'::jsonb);
  v_cross_scope := v_cross_scope - 'package_hash';
  v_cross_scope := v_cross_scope || pg_catalog.jsonb_build_object(
    'package_hash',app_data_agent.u2_canonical_sha256(v_cross_scope)
  );
  v_receipt := pg_catalog.jsonb_build_object(
    'schema_version','ontology-package-validation@1.0.0',
    'receipt_id','00000000-0000-4000-8000-00000000a409',
    'namespace',v_package -> 'namespace',
    'package_id',v_package -> 'package_id',
    'package_version',v_package -> 'package_version',
    'package_hash',v_package -> 'package_hash',
    'source_binding_hash',app_data_agent.u2_canonical_sha256(v_package -> 'source_binding'),
    'compiler_digest','sha256:' || pg_catalog.repeat('6',64),
    'validator_version','ontology-package-validator@1.0.0',
    'valid',true,'issues','[]'::jsonb,
    'validated_at','2026-08-17T00:00:00.000Z'
  );
  v_receipt := v_receipt || pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(v_receipt)
  );
  insert into u4_ontology_assertion_documents values (v_package,v_cross_scope,v_receipt);
end
$ontology_package_documents$;
grant select on u4_ontology_assertion_documents to data_agent_backend;

set local role data_agent_backend;
select pg_catalog.set_config('data_agent.app_id', '00000000-0000-4000-8000-00000000da01', true);
select pg_catalog.set_config('data_agent.tenant_id', '00000000-0000-4000-8000-00000000a401', true);
select pg_catalog.set_config('data_agent.environment', 'local', true);
select pg_catalog.set_config('data_agent.principal_id', '00000000-0000-4000-8000-00000000a402', true);
select pg_catalog.set_config('data_agent.role', 'owner', true);
select pg_catalog.set_config('data_agent.deployment_id', '00000000-0000-4000-8000-000000000001', true);
select pg_catalog.set_config('app.semantic_domain', 'commerce', true);

do $ontology_package_behavior$
declare
  v_package jsonb;
  v_cross_scope jsonb;
  v_receipt jsonb;
  v_first jsonb;
  v_replay jsonb;
begin
  select documents.package,documents.cross_scope_package,documents.validation_receipt
  into strict v_package,v_cross_scope,v_receipt
  from u4_ontology_assertion_documents as documents;

  v_first := semantic.commit_ontology_package_candidate(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000a401'::uuid,
    'local','00000000-0000-4000-8000-00000000a402'::uuid,'commerce',
    '00000000-0000-4000-8000-00000000a403'::uuid,
    '00000000-0000-4000-8000-00000000a404'::uuid,v_package
  );
  v_replay := semantic.commit_ontology_package_candidate(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000a401'::uuid,
    'local','00000000-0000-4000-8000-00000000a402'::uuid,'commerce',
    '00000000-0000-4000-8000-00000000a403'::uuid,
    '00000000-0000-4000-8000-00000000a404'::uuid,v_package
  );
  if (v_first ->> 'replayed')::boolean
    or not (v_replay ->> 'replayed')::boolean
    or v_first ->> 'package_hash' <> v_replay ->> 'package_hash'
  then
    raise exception 'ONTOLOGY_PACKAGE_REPLAY_ASSERTION_FAILED';
  end if;

  begin
    perform semantic.commit_ontology_package_candidate(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000a401'::uuid,
      'local','00000000-0000-4000-8000-00000000a402'::uuid,'commerce',
      '00000000-0000-4000-8000-00000000a403'::uuid,
      '00000000-0000-4000-8000-00000000a404'::uuid,
      pg_catalog.jsonb_set(v_package,'{package_hash}',pg_catalog.to_jsonb(
        'sha256:' || pg_catalog.repeat('f',64)
      ))
    );
    raise exception 'ONTOLOGY_PACKAGE_HASH_TAMPER_WAS_NOT_REJECTED';
  exception when sqlstate '22023' then
    if sqlerrm <> 'ONTOLOGY_PACKAGE_DOCUMENT_INVALID' then raise; end if;
  end;

  begin
    perform semantic.commit_ontology_package_candidate(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000a401'::uuid,
      'local','00000000-0000-4000-8000-00000000a402'::uuid,'commerce',
      '00000000-0000-4000-8000-00000000a403'::uuid,
      '00000000-0000-4000-8000-00000000a404'::uuid,v_cross_scope
    );
    raise exception 'ONTOLOGY_PACKAGE_CROSS_SCOPE_WAS_NOT_REJECTED';
  exception when sqlstate '22023' then
    if sqlerrm <> 'ONTOLOGY_PACKAGE_DOCUMENT_INVALID' then raise; end if;
  end;

  v_first := semantic.commit_ontology_package_validation(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000a401'::uuid,
    'local','00000000-0000-4000-8000-00000000a402'::uuid,'commerce',v_receipt
  );
  v_replay := semantic.commit_ontology_package_validation(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000a401'::uuid,
    'local','00000000-0000-4000-8000-00000000a402'::uuid,'commerce',v_receipt
  );
  if (v_first ->> 'replayed')::boolean or not (v_replay ->> 'replayed')::boolean then
    raise exception 'ONTOLOGY_PACKAGE_VALIDATION_REPLAY_ASSERTION_FAILED';
  end if;
end
$ontology_package_behavior$;

reset role;
do $ontology_package_immutable$
begin
  begin
    update semantic.ontology_package_candidates set package_version = 2
    where package_id = '00000000-0000-4000-8000-00000000a407'::uuid;
    raise exception 'ONTOLOGY_PACKAGE_MUTATION_WAS_NOT_REJECTED';
  exception when sqlstate '55000' then
    if sqlerrm <> 'ONTOLOGY_PACKAGE_AUTHORITY_IMMUTABLE' then raise; end if;
  end;
end
$ontology_package_immutable$;

rollback;
