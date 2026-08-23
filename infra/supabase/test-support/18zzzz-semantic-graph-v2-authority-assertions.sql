-- Semantic Graph v2 source/revision fencing, RPC idempotency and ACL checks.

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
  '00000000-0000-4000-8000-00000000d638',
  'semantic-graph-v2-source',
  'sqlite',
  '/tmp/semantic-graph-v2.db',
  '00000000-0000-4000-8000-000000001001'
);

insert into semantic.semantic_domain_registry (
  app_id, tenant_id, environment, semantic_domain, datasource_id,
  domain_display_name, domain_description, created_by
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test',
  'graph_v2_test',
  '00000000-0000-4000-8000-00000000d638',
  'Graph v2 test',
  'Semantic Graph v2 authority fixture',
  '00000000-0000-4000-8000-000000001001'
);

insert into semantic.semantic_authority_fence (
  app_id, tenant_id, environment, last_fence_update_by
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test',
  'semantic-graph-v2-test'
) on conflict (app_id, tenant_id, environment) do nothing;

insert into semantic.semantic_source_revision (
  app_id, tenant_id, environment, semantic_domain, revision_id,
  revision_number, source_payload, source_digest, author_principal,
  change_description, change_class
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test',
  'graph_v2_test',
  '00000000-0000-4000-8000-000000006381',
  1,
  pg_catalog.jsonb_build_object(
    'metadata', pg_catalog.jsonb_build_object(
      'graph_version', 'semantic-graph-source@2',
      'graph_id', '00000000-0000-4000-8000-000000006382'
    ),
    'nodes', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'node_id', 'subject-order',
        'node_type', 'BUSINESS_SUBJECT',
        'node_version', 1,
        'lifecycle', 'ACTIVE'
      )
    ),
    'edges', pg_catalog.jsonb_build_array()
  ),
  'sha256:' || pg_catalog.repeat('9', 64),
  '00000000-0000-4000-8000-000000001001',
  'Graph v2 projection test',
  'MAJOR'
);

set local role data_agent_backend;
select * from platform.revalidate_backend_authority(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa11'::uuid,
  'test',
  '00000000-0000-4000-8000-00000000de01'::uuid,
  '00000000-0000-4000-8000-000000001001'::uuid,
  'owner', 1, 1, false
);
select pg_catalog.set_config('data_agent.app_id', '00000000-0000-4000-8000-00000000da01', true);
select pg_catalog.set_config('data_agent.tenant_id', '00000000-0000-4000-8000-00000000aa11', true);
select pg_catalog.set_config('data_agent.environment', 'test', true);
select pg_catalog.set_config('data_agent.principal_id', '00000000-0000-4000-8000-000000001001', true);
select pg_catalog.set_config('data_agent.role', 'owner', true);
select pg_catalog.set_config('data_agent.deployment_id', '00000000-0000-4000-8000-00000000de01', true);
select pg_catalog.set_config('app.semantic_domain', 'graph_v2_test', true);

do $projection$
declare
  v_payload jsonb := pg_catalog.jsonb_build_object(
    'projection_version', 'semantic-graph-projection@1',
    'graph_id', '00000000-0000-4000-8000-000000006382',
    'source_digest', 'sha256:' || pg_catalog.repeat('1', 64),
    'registry_digest', 'sha256:' || pg_catalog.repeat('2', 64),
    'compiler_version', 'semantic-graph-compiler@2.0.0',
    'node_count', 1,
    'edge_count', 0,
    'nodes', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'node_id', 'subject-order',
        'node_type', 'BUSINESS_SUBJECT',
        'node_version', 1,
        'lifecycle', 'ACTIVE'
      )
    ),
    'edges', pg_catalog.jsonb_build_array()
  );
  v_created jsonb;
  v_replay jsonb;
  v_read jsonb;
begin
  v_created := semantic.commit_semantic_graph_projection(
    '00000000-0000-4000-8000-00000000da01',
    '00000000-0000-4000-8000-00000000aa11',
    'test',
    '00000000-0000-4000-8000-000000001001',
    'graph_v2_test',
    '00000000-0000-4000-8000-000000006383',
    '00000000-0000-4000-8000-000000006381',
    v_payload
  );
  v_replay := semantic.commit_semantic_graph_projection(
    '00000000-0000-4000-8000-00000000da01',
    '00000000-0000-4000-8000-00000000aa11',
    'test',
    '00000000-0000-4000-8000-000000001001',
    'graph_v2_test',
    '00000000-0000-4000-8000-000000006383',
    '00000000-0000-4000-8000-000000006381',
    v_payload
  );
  v_read := semantic.get_semantic_graph_projection(
    '00000000-0000-4000-8000-00000000da01',
    '00000000-0000-4000-8000-00000000aa11',
    'test',
    '00000000-0000-4000-8000-000000001001',
    'graph_v2_test',
    '00000000-0000-4000-8000-000000006383'
  );
  if v_created ->> 'created' <> 'true'
    or v_replay ->> 'created' <> 'false'
    or v_created ->> 'source_revision_digest' <> 'sha256:' || pg_catalog.repeat('9', 64)
    or v_read is distinct from v_payload
    or v_created ->> 'node_count' <> '1'
    or v_created ->> 'edge_count' <> '0'
  then
    raise exception 'SEMANTIC_GRAPH_V2_COMMIT_ASSERTION_FAILED';
  end if;
end
$projection$;

select test_support.assert_raises(
  $assert$
    insert into semantic.semantic_graph_node_projection (
      app_id, tenant_id, environment, semantic_domain, projection_id,
      node_id, node_type, node_version, lifecycle, intrinsic_payload, entry_storage_digest
    ) values (
      '00000000-0000-4000-8000-00000000da01',
      '00000000-0000-4000-8000-00000000aa11',
      'test', 'graph_v2_test',
      '00000000-0000-4000-8000-000000006383',
      'subject-direct-write', 'BUSINESS_SUBJECT', 1, 'ACTIVE', '{}'::jsonb,
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
  $assert$,
  'permission denied for table semantic_graph_node_projection'
);

select test_support.assert_raises(
  $assert$
    select semantic.commit_semantic_graph_projection(
      '00000000-0000-4000-8000-00000000da01',
      '00000000-0000-4000-8000-00000000aa11',
      'test',
      '00000000-0000-4000-8000-000000001001',
      'graph_v2_test',
      '00000000-0000-4000-8000-000000006384',
      '00000000-0000-4000-8000-000000006381',
      pg_catalog.jsonb_build_object(
        'projection_version', 'semantic-graph-projection@1',
        'graph_id', '00000000-0000-4000-8000-000000006382',
        'source_digest', 'sha256:' || pg_catalog.repeat('1', 64),
        'registry_digest', 'sha256:' || pg_catalog.repeat('2', 64),
        'compiler_version', 'semantic-graph-compiler@2.0.0',
        'node_count', 1,
        'edge_count', 0,
        'nodes', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'node_id', 'metric-invalid',
          'node_type', 'METRIC',
          'node_version', 1,
          'lifecycle', 'ACTIVE',
          'table_id', 'forbidden'
        )),
        'edges', pg_catalog.jsonb_build_array()
      )
    )
  $assert$,
  'SEMANTIC_GRAPH_PROJECTION_INVALID'
);

rollback;

select test_support.assert_true(
  not pg_catalog.has_table_privilege(
    'data_agent_backend', 'semantic.semantic_graph_projection', 'SELECT,INSERT,UPDATE,DELETE'
  ),
  'backend must not access semantic graph projection tables directly'
);
