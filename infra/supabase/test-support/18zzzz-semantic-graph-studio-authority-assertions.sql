-- Graph Studio scoped read, candidate bootstrap and backend ACL checks.

grant usage on schema test_support to data_agent_backend;
grant execute on all functions in schema test_support to data_agent_backend;

begin;

insert into app_data_agent.datasource_connections (
  app_id, tenant_id, environment, datasource_id, name, datasource_type,
  file_path, created_by_principal_id
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test', '00000000-0000-4000-8000-00000000d640',
  'semantic-graph-studio-source', 'sqlite', '/tmp/semantic-graph-studio.db',
  '00000000-0000-4000-8000-000000001001'
);

insert into semantic.semantic_domain_registry (
  app_id, tenant_id, environment, semantic_domain, datasource_id,
  domain_display_name, domain_description, created_by
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test', 'studio_test', '00000000-0000-4000-8000-00000000d640',
  'Studio test', 'Graph Studio authority fixture',
  '00000000-0000-4000-8000-000000001001'
);

insert into semantic.semantic_authority_fence (
  app_id, tenant_id, environment, last_fence_update_by
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test', 'semantic-graph-studio-test'
) on conflict (app_id, tenant_id, environment) do nothing;

insert into semantic.semantic_active_pointer (
  app_id, tenant_id, environment, semantic_domain,
  current_release_id, current_release_generation, pointer_generation, updated_by
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test', 'studio_test', null, 0, 1,
  '00000000-0000-4000-8000-000000001001'
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
select pg_catalog.set_config('app.semantic_domain', 'studio_test', true);

do $studio$
declare
  v_graph jsonb := pg_catalog.jsonb_build_object(
    'metadata', pg_catalog.jsonb_build_object(
      'graph_version', 'semantic-graph-source@2',
      'graph_id', '00000000-0000-4000-8000-000000006403'
    ),
    'node_type_registry', pg_catalog.jsonb_build_array(),
    'edge_type_registry', pg_catalog.jsonb_build_array(),
    'evidence', pg_catalog.jsonb_build_array(),
    'nodes', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'node_id', 'subject-order', 'node_type', 'BUSINESS_SUBJECT',
      'node_version', 1, 'name', '订单', 'aliases', pg_catalog.jsonb_build_array(),
      'owner_ref', 'test', 'lifecycle', 'ACTIVE',
      'evidence_refs', pg_catalog.jsonb_build_array(), 'tags', pg_catalog.jsonb_build_array(),
      'domain', 'studio_test'
    )),
    'edges', pg_catalog.jsonb_build_array()
  );
  v_input jsonb;
  v_started jsonb;
  v_replay jsonb;
begin
  if semantic.get_active_semantic_graph_studio(
    '00000000-0000-4000-8000-00000000da01',
    '00000000-0000-4000-8000-00000000aa11', 'test',
    '00000000-0000-4000-8000-000000001001', 'studio_test'
  ) is not null then
    raise exception 'SEMANTIC_GRAPH_STUDIO_EMPTY_ACTIVE_ASSERTION_FAILED';
  end if;
  v_input := pg_catalog.jsonb_build_object(
    'schema_version', 'semantic-authoring-start@1.0.0',
    'scope', pg_catalog.jsonb_build_object(
      'app_id', '00000000-0000-4000-8000-00000000da01',
      'tenant_id', '00000000-0000-4000-8000-00000000aa11',
      'environment', 'test'
    ),
    'semantic_domain', 'studio_test',
    'authoring_run_id', '00000000-0000-4000-8000-000000006404',
    'candidate_id', '00000000-0000-4000-8000-000000006401',
    'principal_id', '00000000-0000-4000-8000-000000001001',
    'policy_version', 'semantic-authoring-policy@1.0.0',
    'base_release_id', null,
    'base_graph', v_graph,
    'instruction', '新增成交商品数',
    'budget', pg_catalog.jsonb_build_object('max_turns', 8, 'max_tool_calls', 32),
    'idempotency_key', 'semantic-graph-studio-sql-test'
  );
  v_started := semantic.start_semantic_studio_authoring(
    '00000000-0000-4000-8000-00000000da01',
    '00000000-0000-4000-8000-00000000aa11', 'test',
    '00000000-0000-4000-8000-000000001001', 'studio_test', v_input
  );
  v_replay := semantic.start_semantic_studio_authoring(
    '00000000-0000-4000-8000-00000000da01',
    '00000000-0000-4000-8000-00000000aa11', 'test',
    '00000000-0000-4000-8000-000000001001', 'studio_test', v_input
  );
  if v_started #>> '{run,status}' <> 'RUNNING'
    or v_started #>> '{run,candidate_id}' <> '00000000-0000-4000-8000-000000006401'
    or v_started is distinct from v_replay
  then
    raise exception 'SEMANTIC_GRAPH_STUDIO_START_ASSERTION_FAILED';
  end if;
end
$studio$;

select test_support.assert_raises(
  $assert$
    insert into semantic.semantic_candidate (
      app_id, tenant_id, environment, semantic_domain, candidate_id,
      proposer_principal, current_revision_id, candidate_status
    ) values (
      '00000000-0000-4000-8000-00000000da01',
      '00000000-0000-4000-8000-00000000aa11', 'test', 'studio_test',
      '00000000-0000-4000-8000-000000006409',
      '00000000-0000-4000-8000-000000001001',
      '00000000-0000-4000-8000-000000006408', 'DRAFT'
    )
  $assert$,
  'permission denied for table semantic_candidate'
);

rollback;

select test_support.assert_true(
  pg_catalog.has_function_privilege(
    'data_agent_backend',
    'semantic.get_active_semantic_graph_studio(uuid,uuid,text,uuid,text)',
    'EXECUTE'
  ),
  'backend must execute the scoped Graph Studio read RPC'
);
