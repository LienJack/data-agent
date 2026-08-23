-- Phase 6: semantic JSON portability stays workspace-scoped and draft-only.

grant usage on schema test_support to data_agent_backend;
grant execute on all functions in schema test_support to data_agent_backend;

begin;

insert into app_data_agent.datasource_connections (
  app_id, tenant_id, environment, datasource_id, name, datasource_type,
  file_path, created_by_principal_id
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test',
  '00000000-0000-4000-8000-00000000d632',
  'portable-workspace-source',
  'sqlite',
  '/tmp/portable-workspace.db',
  '00000000-0000-4000-8000-000000001001'
);

insert into semantic.semantic_domain_registry (
  app_id, tenant_id, environment, semantic_domain, datasource_id,
  domain_display_name, domain_description, created_by
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test',
  'portable_revenue',
  '00000000-0000-4000-8000-00000000d632',
  'Portable revenue',
  'Phase 6 portability fixture',
  '00000000-0000-4000-8000-000000001001'
);

insert into semantic.semantic_authority_fence (
  app_id, tenant_id, environment, last_fence_update_by
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test',
  'semantic-portability-test'
) on conflict (app_id, tenant_id, environment) do nothing;

set local role data_agent_backend;
select pg_catalog.set_config('data_agent.app_id', '00000000-0000-4000-8000-00000000da01', true);
select pg_catalog.set_config('data_agent.tenant_id', '00000000-0000-4000-8000-00000000aa11', true);
select pg_catalog.set_config('data_agent.environment', 'test', true);
select pg_catalog.set_config('data_agent.principal_id', '00000000-0000-4000-8000-000000001001', true);
select pg_catalog.set_config('data_agent.role', 'owner', true);
select pg_catalog.set_config('data_agent.deployment_id', '00000000-0000-4000-8000-00000000de01', true);

select test_support.assert_true(
  (
    select pg_catalog.count(*) = 1
    from semantic.read_portability_targets(
      '00000000-0000-4000-8000-00000000da01',
      '00000000-0000-4000-8000-00000000aa11',
      'test'
    ) as target
    where target.datasource_id = '00000000-0000-4000-8000-00000000d632'::uuid
      and target.semantic_domains ? 'portable_revenue'
  ),
  'portable target bridge must return only safe workspace datasource/domain metadata'
);

insert into app_data_agent.semantic_import_jobs (
  app_id, tenant_id, environment, import_id, principal_id,
  file_name, byte_size, upload_hash, document_content_hash,
  format, source_document, state
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test',
  '00000000-0000-4000-8000-00000000a632',
  '00000000-0000-4000-8000-000000001001',
  'portable.json',
  512,
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'semantic-workspace-export@1.0.0',
  pg_catalog.jsonb_build_object(
    'format', 'semantic-workspace-export@1.0.0',
    'compatibility', pg_catalog.jsonb_build_object(
      'semantic_protocol_version', 'semantic-source-payload@1.0.0',
      'minimum_importer_version', 'data-agent@0.1.0'
    ),
    'datasource_refs', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'logical_ref', 'portable_revenue:primary',
        'display_name', 'Portable revenue',
        'dialect', 'sqlite',
        'schema_fingerprint',
          'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
      )
    ),
    'domains', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'semantic_domain', 'portable_revenue',
        'datasource_logical_ref', 'portable_revenue:primary',
        'source_release', pg_catalog.jsonb_build_object(
          'generation', '1',
          'digest', 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
        ),
        'semantic', pg_catalog.jsonb_build_object('metrics', pg_catalog.jsonb_build_array())
      )
    ),
    'exported_at', '2026-08-14T00:00:00.000Z',
    'content_hash',
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  ),
  'AWAITING_DATASOURCE_MAPPING'
);

insert into app_data_agent.semantic_import_mappings (
  app_id, tenant_id, environment, import_id, logical_ref,
  target_datasource_id, target_semantic_domain, mapped_by_principal_id
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test',
  '00000000-0000-4000-8000-00000000a632',
  'portable_revenue:primary',
  '00000000-0000-4000-8000-00000000d632',
  'portable_revenue',
  '00000000-0000-4000-8000-000000001001'
);

update app_data_agent.semantic_import_jobs
set state = 'READY',
    mapping_hash = 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    preview = pg_catalog.jsonb_build_object(
      'schema_version', 'semantic-import-preview@1.0.0',
      'compatible', true,
      'missing_logical_refs', pg_catalog.jsonb_build_array(),
      'conflicts', pg_catalog.jsonb_build_array(),
      'domains', pg_catalog.jsonb_build_array()
    )
where app_id = '00000000-0000-4000-8000-00000000da01'::uuid
  and tenant_id = '00000000-0000-4000-8000-00000000aa11'::uuid
  and environment = 'test'
  and import_id = '00000000-0000-4000-8000-00000000a632'::uuid;

insert into app_data_agent.semantic_import_operations (
  app_id, tenant_id, environment, principal_id, operation_id,
  idempotency_key, operation_kind, input_hash, import_id
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test',
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-00000000b632',
  '00000000-0000-4000-8000-00000000c632',
  'DRY_RUN',
  'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  '00000000-0000-4000-8000-00000000a632'
);

select test_support.assert_raises(
  $assert$
    update app_data_agent.semantic_import_operations
    set input_hash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    where operation_id = '00000000-0000-4000-8000-00000000b632'::uuid
  $assert$,
  'permission denied for table semantic_import_operations'
);

select test_support.assert_raises(
  $assert$
    insert into app_data_agent.semantic_import_receipts (
      app_id, tenant_id, environment, receipt_id, import_id, principal_id,
      upload_hash, document_content_hash, mapping_hash, candidate_refs
    ) values (
      '00000000-0000-4000-8000-00000000da01',
      '00000000-0000-4000-8000-00000000aa11',
      'test',
      '00000000-0000-4000-8000-00000000e632',
      '00000000-0000-4000-8000-00000000a632',
      '00000000-0000-4000-8000-000000001001',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'semantic_domain', 'portable_revenue',
        'candidate_id', '00000000-0000-4000-8000-00000000f632',
        'revision_id', '00000000-0000-4000-8000-00000000f633'
      ))
    )
  $assert$,
  'SEMANTIC_IMPORT_CANDIDATE_REF_INVALID'
);

select pg_catalog.set_config('data_agent.tenant_id', '00000000-0000-4000-8000-00000000aa22', true);
select pg_catalog.set_config('data_agent.principal_id', '00000000-0000-4000-8000-000000001003', true);

select test_support.assert_true(
  (
    select pg_catalog.count(*) = 0
    from app_data_agent.semantic_import_jobs
    where import_id = '00000000-0000-4000-8000-00000000a632'::uuid
  ),
  'semantic import jobs must not cross workspace RLS'
);

rollback;

select test_support.assert_true(
  not pg_catalog.has_table_privilege(
    'data_agent_backend', 'semantic.semantic_source_release', 'SELECT'
  ),
  'backend must not gain raw semantic release table access for export'
);
