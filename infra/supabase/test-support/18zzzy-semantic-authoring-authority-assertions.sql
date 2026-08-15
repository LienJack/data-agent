-- Agent semantic authoring fencing, request checkpoint, system-managed mutation and ACL checks.

grant usage on schema test_support to data_agent_backend;
grant execute on all functions in schema test_support to data_agent_backend;

begin;

insert into app_data_agent.datasource_connections (
  app_id, tenant_id, environment, datasource_id, name, datasource_type,
  file_path, created_by_principal_id
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test', '00000000-0000-4000-8000-00000000d639',
  'semantic-authoring-source', 'sqlite', '/tmp/semantic-authoring.db',
  '00000000-0000-4000-8000-000000001001'
);

insert into semantic.semantic_domain_registry (
  app_id, tenant_id, environment, semantic_domain, datasource_id,
  domain_display_name, domain_description, created_by
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test', 'authoring_test', '00000000-0000-4000-8000-00000000d639',
  'Authoring test', 'Agent semantic authoring authority fixture',
  '00000000-0000-4000-8000-000000001001'
);

insert into semantic.semantic_authority_fence (
  app_id, tenant_id, environment, last_fence_update_by
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test', 'semantic-authoring-test'
) on conflict (app_id, tenant_id, environment) do nothing;

insert into semantic.semantic_candidate (
  app_id, tenant_id, environment, semantic_domain, candidate_id,
  proposer_principal, current_revision_id, candidate_status
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa11',
  'test', 'authoring_test', '00000000-0000-4000-8000-000000006391',
  '00000000-0000-4000-8000-000000001001',
  '00000000-0000-4000-8000-000000006392', 'DRAFT'
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
select pg_catalog.set_config('app.semantic_domain', 'authoring_test', true);

do $authoring$
declare
  v_graph jsonb := pg_catalog.jsonb_build_object(
    'metadata', pg_catalog.jsonb_build_object(
      'graph_version', 'semantic-graph-source@2',
      'graph_id', '00000000-0000-4000-8000-000000006393'
    ),
    'node_type_registry', pg_catalog.jsonb_build_array(),
    'edge_type_registry', pg_catalog.jsonb_build_array(),
    'evidence', pg_catalog.jsonb_build_array(),
    'nodes', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'node_id', 'subject-order', 'node_type', 'BUSINESS_SUBJECT',
      'node_version', 1, 'name', '订单', 'aliases', pg_catalog.jsonb_build_array(),
      'owner_ref', 'test', 'lifecycle', 'ACTIVE',
      'evidence_refs', pg_catalog.jsonb_build_array(), 'tags', pg_catalog.jsonb_build_array(),
      'domain', 'authoring_test'
    )),
    'edges', pg_catalog.jsonb_build_array()
  );
  v_input jsonb;
  v_started jsonb;
  v_replay jsonb;
  v_request jsonb;
  v_request_digest text;
  v_checkpoint jsonb;
  v_event jsonb;
  v_began jsonb;
begin
  v_input := pg_catalog.jsonb_build_object(
    'schema_version', 'semantic-authoring-start@1.0.0',
    'scope', pg_catalog.jsonb_build_object(
      'app_id', '00000000-0000-4000-8000-00000000da01',
      'tenant_id', '00000000-0000-4000-8000-00000000aa11',
      'environment', 'test'
    ),
    'semantic_domain', 'authoring_test',
    'authoring_run_id', '00000000-0000-4000-8000-000000006394',
    'candidate_id', '00000000-0000-4000-8000-000000006391',
    'principal_id', '00000000-0000-4000-8000-000000001001',
    'policy_version', 'semantic-authoring-policy@1.0.0',
    'base_release_id', null,
    'base_graph', v_graph,
    'instruction', '新增成交商品数',
    'budget', pg_catalog.jsonb_build_object('max_turns', 8, 'max_tool_calls', 32),
    'idempotency_key', 'semantic-authoring-sql-test'
  );
  v_started := semantic.start_semantic_authoring(
    '00000000-0000-4000-8000-00000000da01',
    '00000000-0000-4000-8000-00000000aa11', 'test',
    '00000000-0000-4000-8000-000000001001', 'authoring_test', v_input
  );
  v_replay := semantic.start_semantic_authoring(
    '00000000-0000-4000-8000-00000000da01',
    '00000000-0000-4000-8000-00000000aa11', 'test',
    '00000000-0000-4000-8000-000000001001', 'authoring_test', v_input
  );
  if v_started #>> '{run,status}' <> 'RUNNING'
    or v_started #>> '{run,authority}' <> 'POSTGRESQL'
    or v_started is distinct from v_replay
  then
    raise exception 'SEMANTIC_AUTHORING_START_ASSERTION_FAILED';
  end if;

  v_request := pg_catalog.jsonb_build_object(
    'schema_version', 'semantic-agent-turn@1.0.0',
    'request_id', '00000000-0000-4000-8000-000000006395',
    'scope', v_input -> 'scope',
    'authoring_run_id', '00000000-0000-4000-8000-000000006394',
    'candidate_id', '00000000-0000-4000-8000-000000006391',
    'principal_id', '00000000-0000-4000-8000-000000001001',
    'policy_version', 'semantic-authoring-policy@1.0.0',
    'turn_index', 1, 'messages', v_started #> '{checkpoint,messages}',
    'tools', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'name', 'search_semantic_nodes', 'description', 'search',
      'input_schema', pg_catalog.jsonb_build_object('type', 'object')
    )),
    'budget', pg_catalog.jsonb_build_object(
      'timeout_ms', 30000, 'max_input_tokens', 4000, 'max_output_tokens', 2000
    )
  );
  v_request_digest := platform.canonical_sha256(v_request);
  v_checkpoint := pg_catalog.jsonb_set(
    v_started -> 'checkpoint', '{pending_agent_request}', v_request
  );
  v_event := pg_catalog.jsonb_build_object(
    'schema_version', 'semantic-authoring-public-event@1.0.0',
    'event_id', '00000000-0000-4000-8000-000000006396',
    'run_id', '00000000-0000-4000-8000-000000006394',
    'sequence', 1, 'occurred_at', '2026-08-15T00:00:00.000Z',
    'type', 'stage',
    'payload', pg_catalog.jsonb_build_object(
      'phase', 'AGENT_TURN', 'summary', '开始 Agent turn 1', 'status', 'RUNNING'
    )
  );
  v_began := semantic.begin_semantic_authoring_turn(
    '00000000-0000-4000-8000-00000000da01',
    '00000000-0000-4000-8000-00000000aa11', 'test',
    '00000000-0000-4000-8000-000000001001', 'authoring_test',
    '00000000-0000-4000-8000-000000006394', 1, 0,
    v_request_digest, v_checkpoint, pg_catalog.jsonb_build_array(v_event)
  );
  if v_began #>> '{run,pending_request_digest}' <> v_request_digest
    or v_began ->> 'event_sequence' <> '1'
  then
    raise exception 'SEMANTIC_AUTHORING_BEGIN_TURN_ASSERTION_FAILED';
  end if;
end
$authoring$;

do $physical_mutation$
declare
  v_run jsonb;
  v_patch_material jsonb;
  v_patch jsonb;
  v_receipt_material jsonb;
  v_receipt jsonb;
begin
  v_run := semantic.get_semantic_authoring(
    '00000000-0000-4000-8000-00000000da01',
    '00000000-0000-4000-8000-00000000aa11', 'test',
    '00000000-0000-4000-8000-000000001001', 'authoring_test',
    '00000000-0000-4000-8000-000000006394'
  );
  v_patch_material := pg_catalog.jsonb_build_object(
    'patch_version', 'semantic-graph-patch@1',
    'patch_id', '00000000-0000-4000-8000-000000006397',
    'graph_id', v_run #>> '{run,graph_id}',
    'candidate_id', v_run #>> '{run,candidate_id}',
    'from_working_revision', 0,
    'to_working_revision', 1,
    'before_digest', v_run #>> '{run,graph_digest}',
    'after_digest', v_run #>> '{run,graph_digest}',
    'operations', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'operation', 'ADD_NODE',
      'node', pg_catalog.jsonb_build_object(
        'node_id', 'table-forged', 'node_version', 1,
        'node_type', 'PHYSICAL_TABLE', 'name', 'forged'
      )
    ))
  );
  v_patch := v_patch_material || pg_catalog.jsonb_build_object(
    'patch_digest', platform.canonical_sha256(v_patch_material)
  );
  v_receipt_material := pg_catalog.jsonb_build_object(
    'receipt_version', 'semantic-authoring-tool-receipt@1.0.0',
    'receipt_id', '00000000-0000-4000-8000-000000006398',
    'authoring_run_id', v_run #>> '{run,authoring_run_id}',
    'candidate_id', v_run #>> '{run,candidate_id}',
    'turn_index', 1,
    'tool_call_id', 'forge-physical-table',
    'tool_name', 'create_semantic_node',
    'idempotency_key', 'authoring:forge-physical-table',
    'input_digest', 'sha256:' || pg_catalog.repeat('1', 64),
    'output_digest', 'sha256:' || pg_catalog.repeat('2', 64),
    'status', 'SUCCEEDED',
    'mutation', true,
    'from_working_revision', 0,
    'to_working_revision', 1,
    'before_digest', v_run #>> '{run,graph_digest}',
    'after_digest', v_run #>> '{run,graph_digest}',
    'patch', v_patch,
    'result', pg_catalog.jsonb_build_object(),
    'error_code', null,
    'committed_at', '2026-08-15T00:00:01.000Z'
  );
  v_receipt := v_receipt_material || pg_catalog.jsonb_build_object(
    'receipt_digest', platform.canonical_sha256(v_receipt_material)
  );
  begin
    perform semantic.commit_semantic_authoring_tool(
      '00000000-0000-4000-8000-00000000da01',
      '00000000-0000-4000-8000-00000000aa11', 'test',
      '00000000-0000-4000-8000-000000001001', 'authoring_test',
      (v_run #>> '{run,authoring_run_id}')::uuid, 1, 0,
      v_run #>> '{run,graph_digest}', v_receipt,
      v_run -> 'working_graph', v_run -> 'checkpoint', pg_catalog.jsonb_build_array()
    );
    raise exception 'EXPECTED_SYSTEM_MANAGED_MUTATION_REJECTION';
  exception when others then
    if sqlerrm not like '%SEMANTIC_AUTHORING_SYSTEM_MANAGED_MUTATION%' then
      raise;
    end if;
  end;
end
$physical_mutation$;

select test_support.assert_raises(
  $assert$
    insert into semantic.semantic_authoring_event (
      app_id, tenant_id, environment, semantic_domain, authoring_run_id,
      sequence, event_id, event_type, event_payload, occurred_at
    ) values (
      '00000000-0000-4000-8000-00000000da01',
      '00000000-0000-4000-8000-00000000aa11', 'test', 'authoring_test',
      '00000000-0000-4000-8000-000000006394', 99,
      '00000000-0000-4000-8000-000000006399', 'stage', '{}'::jsonb,
      pg_catalog.clock_timestamp()
    )
  $assert$,
  'permission denied for table semantic_authoring_event'
);

rollback;

select test_support.assert_true(
  not pg_catalog.has_table_privilege(
    'data_agent_backend', 'semantic.semantic_authoring_run', 'SELECT,INSERT,UPDATE,DELETE'
  ),
  'backend must not access semantic authoring tables directly'
);
