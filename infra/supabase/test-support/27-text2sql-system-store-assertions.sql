\set ON_ERROR_STOP on

select test_support.assert_true(
  pg_catalog.to_regclass(
    'app_data_agent.text2sql_system_artifacts'
  ) is not null
  and pg_catalog.to_regclass(
    'app_data_agent.text2sql_sandbox_claims'
  ) is not null
  and pg_catalog.to_regclass(
    'app_data_agent.text2sql_sandbox_execution_events'
  ) is not null
  and pg_catalog.to_regclass(
    'app_data_agent.text2sql_sandbox_execution_records'
  ) is not null,
  'U5 必须提供专用 System Artifact、Claim、Event 与每 Attempt ExecutionRecord'
);

select test_support.assert_true(
  (
    select pg_catalog.count(*) = 4
    from pg_catalog.pg_class as relation
    where relation.oid in (
      'app_data_agent.text2sql_system_artifacts'::pg_catalog.regclass,
      'app_data_agent.text2sql_sandbox_claims'::pg_catalog.regclass,
      'app_data_agent.text2sql_sandbox_execution_events'::pg_catalog.regclass,
      'app_data_agent.text2sql_sandbox_execution_records'::pg_catalog.regclass
    )
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  'U5 四张 Authority 表必须 Enable + Force RLS'
);

select test_support.assert_true(
  (
    select pg_catalog.count(*) = 8
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app_data_agent'
      and procedure.proname in (
        'claim_text2sql_sandbox_execution',
        'mark_text2sql_sandbox_executing',
        'request_text2sql_sandbox_cancel',
        'finalize_text2sql_sandbox_execution',
        'fail_text2sql_sandbox_execution',
        'resolve_text2sql_sandbox_execution_record',
        'resolve_text2sql_system_artifact',
        'verify_text2sql_system_artifact'
      )
      and procedure.prosecdef
      and procedure.proconfig @> array['search_path=""']::text[]
  ),
  'U5 八个外部函数必须是空 search_path 的 SECURITY DEFINER'
);

select test_support.assert_true(
  pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.claim_text2sql_sandbox_execution(jsonb)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.finalize_text2sql_sandbox_execution(jsonb,jsonb)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.verify_text2sql_system_artifact(jsonb)',
    'EXECUTE'
  )
  and pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.text2sql_audience_context_hash(uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'anon',
    'app_data_agent.text2sql_audience_context_hash(uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'authenticated',
    'app_data_agent.text2sql_audience_context_hash(uuid,uuid,text,uuid,uuid)',
    'EXECUTE'
  )
  and not pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.text2sql_assert_claim_request_integrity(jsonb,text)',
    'EXECUTE'
  )
  and not pg_catalog.has_table_privilege(
    'data_agent_backend',
    'app_data_agent.text2sql_system_artifacts',
    'INSERT'
  )
  and not pg_catalog.has_table_privilege(
    'data_agent_backend',
    'app_data_agent.text2sql_sandbox_claims',
    'UPDATE'
  )
  and not pg_catalog.has_table_privilege(
    'data_agent_backend',
    'app_data_agent.text2sql_sandbox_execution_events',
    'INSERT'
  )
  and not pg_catalog.has_table_privilege(
    'data_agent_backend',
    'app_data_agent.text2sql_sandbox_execution_records',
    'INSERT'
  ),
  'Backend 只能调用窄函数，不能直接 DML Authority 表'
);

select test_support.assert_true(
  pg_catalog.has_table_privilege(
    'data_agent_backend',
    'app_data_agent.text2sql_system_artifacts',
    'SELECT'
  )
  and pg_catalog.has_table_privilege(
    'data_agent_backend',
    'app_data_agent.text2sql_sandbox_claims',
    'SELECT'
  )
  and pg_catalog.has_table_privilege(
    'data_agent_backend',
    'app_data_agent.text2sql_sandbox_execution_events',
    'SELECT'
  )
  and pg_catalog.has_table_privilege(
    'data_agent_backend',
    'app_data_agent.text2sql_sandbox_execution_records',
    'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'anon',
    'app_data_agent.text2sql_system_artifacts',
    'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'anon',
    'app_data_agent.text2sql_sandbox_claims',
    'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'anon',
    'app_data_agent.text2sql_sandbox_execution_events',
    'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'anon',
    'app_data_agent.text2sql_sandbox_execution_records',
    'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated',
    'app_data_agent.text2sql_system_artifacts',
    'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated',
    'app_data_agent.text2sql_sandbox_claims',
    'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated',
    'app_data_agent.text2sql_sandbox_execution_events',
    'SELECT'
  )
  and not pg_catalog.has_table_privilege(
    'authenticated',
    'app_data_agent.text2sql_sandbox_execution_records',
    'SELECT'
  ),
  'Backend 仅获四张 Authority 表 SELECT；anon/authenticated 不得直读'
);

select test_support.assert_true(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
      not ilike '%producer_principal_id%'
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid =
      'app_data_agent.text2sql_system_artifacts'::pg_catalog.regclass
      and constraint_row.contype = 'p'
  ),
  'Producer Principal 是产出/Audience 事实，不能成为 ArtifactReference 主键'
);

select test_support.assert_true(
  (
    select index_definition.indexdef ilike
        '%(app_id, tenant_id, environment, principal_id, input_hash, attempt_sequence desc)%'
      and index_definition.indexdef ilike
        '%where (authority_state_at_record = ''COMPLETED''::text)%'
    from pg_catalog.pg_indexes as index_definition
    where index_definition.schemaname = 'app_data_agent'
      and index_definition.indexname =
        'text2sql_sandbox_records_completed_resolve_lookup'
  ),
  'Completed Record Resolver 必须有匹配其 Scope/Principal/Input/State 谓词的 partial index'
);

select test_support.assert_true(
  pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'app_data_agent.finalize_text2sql_sandbox_execution(jsonb,jsonb)'::pg_catalog.regprocedure
    ),
    'expected_branch_version'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'app_data_agent.fail_text2sql_sandbox_execution(jsonb)'::pg_catalog.regprocedure
    ),
    'expected_branch_version'
  ) = 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'app_data_agent.mark_text2sql_sandbox_executing(jsonb)'::pg_catalog.regprocedure
    ),
    'expected_branch_version'
  ) > 0
  and pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(
      'app_data_agent.request_text2sql_sandbox_cancel(jsonb)'::pg_catalog.regprocedure
    ),
    'expected_branch_version'
  ) > 0,
  'Finalize/Fail 必须锁内按 Attempt/Lease/Fence/Grant/Epoch 决策；Mark/Cancel 保留 Branch CAS'
);

insert into app_data_agent.memberships (
  app_id,
  tenant_id,
  environment,
  principal_id,
  membership_role
)
values (
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa11'::uuid,
  'prod',
  '00000000-0000-4000-8000-000000001015'::uuid,
  'analyst'
)
on conflict do nothing;

insert into app_data_agent.runs (
  app_id,
  tenant_id,
  environment,
  run_id,
  principal_id,
  status,
  question
)
values (
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa11'::uuid,
  'prod',
  '00000000-0000-4000-8000-00000000a191'::uuid,
  '00000000-0000-4000-8000-000000001005'::uuid,
  'RUNNING',
  'U5 system store PostgreSQL smoke'
)
on conflict do nothing;

do $assertions$
#variable_conflict use_variable
declare
  scope_json jsonb := '{
    "app_id":"00000000-0000-4000-8000-00000000da01",
    "tenant_id":"00000000-0000-4000-8000-00000000aa11",
    "environment":"prod"
  }'::jsonb;
  run_id text := '00000000-0000-4000-8000-00000000a191';
  principal_id text := '00000000-0000-4000-8000-000000001005';
  owner_id text := 'sandbox-worker-prod';
  authority_json jsonb := '{
    "authority_id":"00000000-0000-4000-8000-000000000901",
    "principal_id":"sandbox-executor-prod",
    "key_id":"sandbox-key-v1"
  }'::jsonb;
  request_json jsonb := '{
    "schema_version":"1.0.0",
    "language":"sql",
    "query_id":"retail-revenue-investigation-v1"
  }'::jsonb;
  request_checksum text;
  dynamically_revalidated_request jsonb;
  dynamically_revalidated_request_checksum text;
  scope_hash text := 'sha256:' || pg_catalog.repeat('0', 64);
  datasource_id text := '00000000-0000-4000-8000-00000000f191';
  input_hash text := 'sha256:' || pg_catalog.repeat('1', 64);
  execution_id text := '00000000-0000-4000-8000-00000000b191';
  attempt_id text := '00000000-0000-4000-8000-00000000b192';
  lease_id text := '00000000-0000-4000-8000-00000000b193';
  claim_command jsonb;
  mark_command jsonb;
  finalize_command jsonb;
  outcome_json jsonb;
  outcome_payload_checksum text;
  tampered_outcome jsonb;
  identity_json jsonb;
  settings_json jsonb;
  snapshot_json jsonb;
  snapshot_checksum text;
  descriptor_hash text;
  fixture_manifest_hash text := 'sha256:' || pg_catalog.repeat('3', 64);
  grant_hash text := 'sha256:' || pg_catalog.repeat('4', 64);
  sql_artifact_hash text := 'sha256:' || pg_catalog.repeat('5', 64);
  parameters_json jsonb := pg_catalog.jsonb_build_object(
    '$1', 1,
    '$2', 2,
    '$3', 3,
    '$4', 4,
    '$5', 5,
    '$6', 6,
    '$7', 7,
    '$8', 8,
    '$9', 9,
    '$10', 10,
    '$11', 11,
    '$12', 12
  );
  ordered_parameters_json jsonb := pg_catalog.jsonb_build_array(
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
  );
  lexicographic_ordered_parameters_json jsonb :=
    pg_catalog.jsonb_build_array(
      1, 10, 11, 12, 2, 3, 4, 5, 6, 7, 8, 9
    );
  parameters_hash text;
  ordered_parameters_hash text;
  lexicographic_ordered_parameters_hash text;
  result_hash text := 'sha256:' || pg_catalog.repeat('7', 64);
  receipt_hash text := 'sha256:' || pg_catalog.repeat('8', 64);
  result_ref jsonb;
  receipt_ref jsonb;
  result_payload jsonb;
  receipt_payload jsonb;
  artifacts_json jsonb;
  invalid_artifacts jsonb;
  response_json jsonb;
  resolved_json jsonb;
  audience_hash text;

  late_request jsonb := '{"schema_version":"1.0.0","language":"sql","query_id":"late-cancel"}'::jsonb;
  late_request_checksum text;
  late_input_hash text := 'sha256:' || pg_catalog.repeat('a', 64);
  late_execution_id text := '00000000-0000-4000-8000-00000000b1a1';
  late_attempt_id text := '00000000-0000-4000-8000-00000000b1a2';
  late_lease_id text := '00000000-0000-4000-8000-00000000b1a3';
  late_claim jsonb;
  late_identity jsonb;
  late_snapshot jsonb;
  late_descriptor_hash text;
  late_snapshot_checksum text;
  late_outcome jsonb;
  late_outcome_payload_checksum text;

  recovery_request jsonb := '{"schema_version":"1.0.0","language":"sql","query_id":"recovery"}'::jsonb;
  recovery_request_checksum text;
  recovery_input_hash text := 'sha256:' || pg_catalog.repeat('b', 64);
  recovery_execution_id text := '00000000-0000-4000-8000-00000000b1b1';
  recovery_attempt_one text := '00000000-0000-4000-8000-00000000b1b2';
  recovery_lease_one text := '00000000-0000-4000-8000-00000000b1b3';
  recovery_attempt_two text := '00000000-0000-4000-8000-00000000b1b4';
  recovery_lease_two text := '00000000-0000-4000-8000-00000000b1b5';
  recovery_claim jsonb;
  recovery_identity jsonb;
  recovery_snapshot jsonb;
  recovery_descriptor_hash text;
  recovery_snapshot_checksum text;
  attempt_one_outcome jsonb;
  attempt_one_outcome_payload_checksum text;
  attempt_two_outcome jsonb;
  attempt_two_outcome_payload_checksum text;

  none_request jsonb := '{
    "schema_version":"1.0.0",
    "language":"sql",
    "query_id":"replay-unavailable"
  }'::jsonb;
  none_request_checksum text;
  none_input_hash text := 'sha256:' || pg_catalog.repeat('c', 64);
  none_execution_id text := '00000000-0000-4000-8000-00000000b1c1';
  none_attempt_id text := '00000000-0000-4000-8000-00000000b1c2';
  none_lease_id text := '00000000-0000-4000-8000-00000000b1c3';
  none_claim jsonb;
  none_identity jsonb;
  none_snapshot jsonb;
  none_descriptor_hash text;
  none_snapshot_checksum text;
  none_outcome jsonb;
  none_outcome_payload_checksum text;
  none_fail_command jsonb;
begin
  perform pg_catalog.set_config(
    'data_agent.app_id',
    '00000000-0000-4000-8000-00000000da01',
    false
  );
  perform pg_catalog.set_config(
    'data_agent.tenant_id',
    '00000000-0000-4000-8000-00000000aa11',
    false
  );
  perform pg_catalog.set_config('data_agent.environment', 'prod', false);
  perform pg_catalog.set_config(
    'data_agent.principal_id',
    principal_id,
    false
  );
  perform pg_catalog.set_config('data_agent.role', 'owner', false);
  perform pg_catalog.set_config(
    'data_agent.deployment_id',
    '00000000-0000-4000-8000-00000000de02',
    false
  );

  request_checksum :=
    app_data_agent.runtime_canonical_sha256(request_json);
  parameters_hash :=
    app_data_agent.runtime_canonical_sha256(parameters_json);
  ordered_parameters_hash :=
    app_data_agent.runtime_canonical_sha256(ordered_parameters_json);
  lexicographic_ordered_parameters_hash :=
    app_data_agent.runtime_canonical_sha256(
      lexicographic_ordered_parameters_json
    );
  perform test_support.assert_true(
    parameters_hash <> ordered_parameters_hash
    and ordered_parameters_hash <> lexicographic_ordered_parameters_hash,
    '参数 Map Hash、数字顺序 $1…$12 Hash 与错误字典序 Hash 必须彼此分离'
  );
  claim_command := pg_catalog.jsonb_build_object(
    'schema_version',
    'text2sql_sandbox_claim@1.0.0',
    'scope',
    scope_json,
    'run_id',
    run_id,
    'principal_id',
    principal_id,
    'execution_id',
    execution_id,
    'idempotency_key',
    'u5-success-once',
    'input_hash',
    input_hash,
    'request_json',
    request_json,
    'request_checksum',
    request_checksum,
    'attempt_id',
    attempt_id,
    'owner_id',
    owner_id,
    'lease_id',
    lease_id,
    'lease_expires_at',
    app_data_agent.runtime_iso_timestamp(
      pg_catalog.clock_timestamp() + interval '1 hour'
    ),
    'event_id',
    '00000000-0000-4000-8000-00000000c191'
  );
  response_json :=
    app_data_agent.claim_text2sql_sandbox_execution(claim_command);
  perform test_support.assert_true(
    response_json ->> 'disposition' = 'ACCEPTED'
    and response_json #>> '{claim,state}' = 'CLAIMED'
    and response_json #>> '{claim,attempt}' = '1'
    and response_json #>> '{claim,fencing_token}' = '1',
    '首次 Claim 必须唯一取得 attempt=1/fencing_token=1'
  );

  response_json :=
    app_data_agent.claim_text2sql_sandbox_execution(
      claim_command || pg_catalog.jsonb_build_object(
        'event_id',
        '00000000-0000-4000-8000-00000000c192'
      )
    );
  perform test_support.assert_true(
    response_json ->> 'disposition' = 'IN_PROGRESS'
    and (
      select pg_catalog.count(*) = 1
      from app_data_agent.text2sql_sandbox_claims as claim
      where claim.environment = 'prod'
        and claim.run_id = run_id::uuid
        and claim.idempotency_key = 'u5-success-once'
    )
    and (
      select pg_catalog.count(*) = 1
      from app_data_agent.text2sql_sandbox_execution_events as event
      where event.environment = 'prod'
        and event.execution_id = execution_id::uuid
    ),
    '同 Principal/Key/Input 的第二个 Claim 必须 IN_PROGRESS 且不能产生双 Owner/Event'
  );

  dynamically_revalidated_request := request_json ||
    pg_catalog.jsonb_build_object(
      'authority_revalidation',
      pg_catalog.jsonb_build_object(
        'revalidated_at',
        '2026-07-27T01:00:00.000Z',
        'authority_epoch',
        2
      )
    );
  dynamically_revalidated_request_checksum :=
    app_data_agent.runtime_canonical_sha256(
      dynamically_revalidated_request
    );
  response_json := app_data_agent.claim_text2sql_sandbox_execution(
    claim_command || pg_catalog.jsonb_build_object(
      'request_json',
      dynamically_revalidated_request,
      'request_checksum',
      dynamically_revalidated_request_checksum,
      'event_id',
      '00000000-0000-4000-8000-00000000c192'
    )
  );
  perform test_support.assert_true(
    response_json ->> 'disposition' = 'IN_PROGRESS'
    and (
      select claim.request_json = request_json
        and claim.request_checksum = request_checksum
      from app_data_agent.text2sql_sandbox_claims as claim
      where claim.environment = 'prod'
        and claim.execution_id = execution_id::uuid
    )
    and (
      select pg_catalog.count(*) = 1
      from app_data_agent.text2sql_sandbox_execution_events as event
      where event.environment = 'prod'
        and event.execution_id = execution_id::uuid
    ),
    '同 immutable Input 仅动态 revalidation 时间变化必须复用原 Claim，且保留原 Preparation'
  );

  begin
    perform app_data_agent.claim_text2sql_sandbox_execution(
      claim_command || pg_catalog.jsonb_build_object(
        'input_hash',
        'sha256:' || pg_catalog.repeat('f', 64),
        'event_id',
        '00000000-0000-4000-8000-00000000c193'
      )
    );
    raise exception 'ASSERTION_DID_NOT_RAISE: SANDBOX_IDEMPOTENCY_CONFLICT';
  exception
    when others then
      if pg_catalog.strpos(sqlerrm, 'SANDBOX_IDEMPOTENCY_CONFLICT') = 0 then
        raise;
      end if;
  end;
  begin
    perform app_data_agent.claim_text2sql_sandbox_execution(
      claim_command || pg_catalog.jsonb_build_object(
        'execution_id',
        '00000000-0000-4000-8000-00000000b1ff',
        'event_id',
        '00000000-0000-4000-8000-00000000c193'
      )
    );
    raise exception 'ASSERTION_DID_NOT_RAISE: SANDBOX_IDEMPOTENCY_CONFLICT';
  exception
    when others then
      if pg_catalog.strpos(sqlerrm, 'SANDBOX_IDEMPOTENCY_CONFLICT') = 0 then
        raise;
      end if;
  end;
  begin
    perform app_data_agent.text2sql_assert_claim_request_integrity(
      request_json,
      'sha256:' || pg_catalog.repeat('0', 64)
    );
    raise exception 'ASSERTION_DID_NOT_RAISE: SANDBOX_CLAIM_INTEGRITY_MISMATCH';
  exception
    when others then
      if pg_catalog.strpos(
        sqlerrm,
        'SANDBOX_CLAIM_INTEGRITY_MISMATCH'
      ) = 0 then
        raise;
      end if;
  end;

  snapshot_json := pg_catalog.jsonb_build_object(
    'protocol_version',
    'postgresql-snapshot@1.0.0',
    'scope_hash',
    scope_hash,
    'run_id',
    run_id,
    'execution_id',
    execution_id,
    'principal_id',
    principal_id,
    'datasource_id',
    datasource_id,
    'datasource_fingerprint',
    'postgresql:fixture-retail-v1',
    'schema_version',
    'fixture-schema-v1',
    'strategy',
    'CONTROLLED_REVISION',
    'intent',
    'CREATE',
    'snapshot_token',
    'controlled-revision-v1',
    'schema_manifest_hash',
    'sha256:' || pg_catalog.repeat('2', 64),
    'data_manifest_hash',
    'sha256:' || pg_catalog.repeat('9', 64),
    'fixture_manifest_hash',
    fixture_manifest_hash,
    'observed_at',
    app_data_agent.runtime_iso_timestamp(pg_catalog.clock_timestamp()),
    'replay_state',
    'REPLAYABLE'
  );
  descriptor_hash :=
    app_data_agent.runtime_canonical_sha256(snapshot_json);
  snapshot_json := snapshot_json || pg_catalog.jsonb_build_object(
    'descriptor_hash',
    descriptor_hash
  );
  snapshot_checksum :=
    app_data_agent.runtime_canonical_sha256(snapshot_json);
  perform test_support.assert_true(
    snapshot_checksum <> descriptor_hash,
    'Snapshot 领域 descriptor_hash 与完整保存体 checksum 必须分离'
  );
  mark_command := claim_command || pg_catalog.jsonb_build_object(
    'expected_branch_version',
    1,
    'fence',
    1,
    'grant_cancel_epoch',
    0,
    'grant_hash',
    grant_hash,
    'sql_artifact_hash',
    sql_artifact_hash,
    'ordered_parameters_hash',
    ordered_parameters_hash,
    'fixture_manifest_hash',
    fixture_manifest_hash,
    'snapshot_descriptor_json',
    snapshot_json,
    'snapshot_descriptor_checksum',
    snapshot_checksum,
    'event_id',
    '00000000-0000-4000-8000-00000000c194'
  );
  response_json :=
    app_data_agent.mark_text2sql_sandbox_executing(mark_command);
  perform test_support.assert_true(
    response_json #>> '{claim,state}' = 'EXECUTING'
    and response_json #>> '{claim,branch_version}' = '2'
    and response_json #>> '{claim,snapshot_descriptor,descriptor_hash}' =
      descriptor_hash
    and response_json #>> '{claim,snapshot_descriptor_checksum}' =
      snapshot_checksum
    and response_json #>> '{claim,ordered_parameters_hash}' =
      ordered_parameters_hash,
    'Mark 必须冻结 Grant、数字参数顺序 Hash、领域 Descriptor Hash、DB checksum 与 CAS 版本'
  );

  settings_json := pg_catalog.jsonb_build_object(
    'database_role',
    'data_agent_reader',
    'search_path',
    pg_catalog.jsonb_build_array('fixture_retail'),
    'plan_cache_mode',
    'force_custom_plan',
    'statement_timeout_ms',
    10000,
    'lock_timeout_ms',
    1000
  );
  identity_json := pg_catalog.jsonb_build_object(
    'protocol_version',
    'sandbox-execution-identity@1.0.0',
    'scope',
    scope_json,
    'scope_hash',
    scope_hash,
    'run_id',
    run_id,
    'execution_id',
    execution_id,
    'principal_id',
    principal_id,
    'idempotency_key',
    'u5-success-once',
    'input_hash',
    input_hash,
    'sql_artifact_ref',
    pg_catalog.jsonb_build_object(
      'artifact_id',
      '00000000-0000-4000-8000-00000000f201',
      'artifact_type',
      'SqlArtifact',
      'app_id',
      scope_json ->> 'app_id',
      'tenant_id',
      scope_json ->> 'tenant_id',
      'environment',
      'prod',
      'run_id',
      run_id,
      'revision',
      1,
      'content_hash',
      sql_artifact_hash
    ),
    'execution_permit_ref',
    pg_catalog.jsonb_build_object(
      'artifact_id',
      '00000000-0000-4000-8000-00000000f202',
      'artifact_type',
      'ExecutionPermit',
      'app_id',
      scope_json ->> 'app_id',
      'tenant_id',
      scope_json ->> 'tenant_id',
      'environment',
      'prod',
      'run_id',
      run_id,
      'revision',
      1,
      'content_hash',
      'sha256:' || pg_catalog.repeat('a', 64)
    ),
    'execution_permit_expires_at',
    '2027-07-27T00:00:00.000Z',
    'resource_admission_ref',
    pg_catalog.jsonb_build_object(
      'artifact_id',
      '00000000-0000-4000-8000-00000000f203',
      'artifact_type',
      'ResourceAdmissionReceipt',
      'app_id',
      scope_json ->> 'app_id',
      'tenant_id',
      scope_json ->> 'tenant_id',
      'environment',
      'prod',
      'run_id',
      run_id,
      'revision',
      1,
      'content_hash',
      'sha256:' || pg_catalog.repeat('b', 64)
    ),
    'policy_receipt_ref',
    pg_catalog.jsonb_build_object(
      'artifact_id',
      '00000000-0000-4000-8000-00000000f204',
      'artifact_type',
      'PolicyReceipt',
      'app_id',
      scope_json ->> 'app_id',
      'tenant_id',
      scope_json ->> 'tenant_id',
      'environment',
      'prod',
      'run_id',
      run_id,
      'revision',
      1,
      'content_hash',
      'sha256:' || pg_catalog.repeat('c', 64)
    ),
    'query_hash',
    'sha256:' || pg_catalog.repeat('d', 64),
    'parameters_hash',
    parameters_hash,
    'ordered_parameters_hash',
    ordered_parameters_hash,
    'datasource_id',
    datasource_id,
    'schema_version',
    'fixture-schema-v1',
    'settings_hash',
    'sha256:' || pg_catalog.repeat('e', 64),
    'snapshot_requirement',
    pg_catalog.jsonb_build_object('mode', 'REQUIRE_REPLAYABLE')
  );
  outcome_json := pg_catalog.jsonb_build_object(
    'protocol_version',
    'sandbox-execution-outcome@1.0.0',
    'identity',
    identity_json,
    'grant_hash',
    grant_hash,
    'input_hash',
    input_hash,
    'execution_id',
    execution_id,
    'attempt_id',
    attempt_id,
    'execution_fence',
    1,
    'lease_id',
    lease_id,
    'cancel_epoch_at_start',
    0,
    'cancel_epoch_observed',
    0,
    'sql_artifact_hash',
    sql_artifact_hash,
    'snapshot_descriptor_hash',
    descriptor_hash,
    'fixture_manifest_hash',
    fixture_manifest_hash,
    'started_at',
    '2026-07-27T00:00:00.000Z',
    'completed_at',
    '2026-07-27T00:00:01.000Z',
    'terminal',
    'COMPLETED',
    'reason_code',
    'SANDBOX_EXECUTION_COMPLETED',
    'result',
    pg_catalog.jsonb_build_object(
      'columns',
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('name', 'total', 'type', 'INTEGER')
      ),
      'rows',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_array(42))
    ),
    'resource_facts',
    pg_catalog.jsonb_build_object(
      'elapsed_ms',
      1000,
      'observed_rows',
      1,
      'observed_bytes',
      32,
      'peak_memory_mb',
      1,
      'retained_canonical_bytes',
      32,
      'current_batch_estimated_bytes',
      32,
      'process_rss_high_water_bytes',
      1048576,
      'cgroup_memory_limit_enforced',
      true,
      'partial_output_discarded',
      false,
      'cutoff_kind',
      'NONE'
    ),
    'cancel_facts',
    pg_catalog.jsonb_build_object(
      'cancel_requested',
      false,
      'query_cancel_dispatched',
      false,
      'query_cancel_confirmed',
      false,
      'cancel_disposition',
      'NOT_REQUESTED',
      'cancel_epoch_at_start',
      0,
      'cancel_epoch_observed',
      0,
      'cancel_requested_at',
      null
    ),
    'rollback_facts',
    pg_catalog.jsonb_build_object(
      'rollback_confirmed',
      true,
      'datasource_terminal',
      'ROLLED_BACK_CLEAN'
    ),
    'connection_facts',
    pg_catalog.jsonb_build_object(
      'backend_pid',
      42,
      'transaction_status',
      'IDLE',
      'connection_reused',
      true
    ),
    'transaction',
    pg_catalog.jsonb_build_object(
      'transaction_id',
      '00000000-0000-4000-8000-00000000f205',
      'read_only',
      true,
      'isolation_level',
      'REPEATABLE_READ'
    ),
    'applied_execution_settings',
    settings_json,
    'manifest_facts',
    pg_catalog.jsonb_build_object(
      'snapshot_descriptor_hash',
      descriptor_hash,
      'schema_manifest_hash',
      snapshot_json ->> 'schema_manifest_hash',
      'data_manifest_hash',
      snapshot_json ->> 'data_manifest_hash',
      'fixture_manifest_hash',
      fixture_manifest_hash,
      'manifest_revalidated',
      true,
      'revalidated_at',
      '2026-07-27T00:00:00.500Z'
    ),
    'canonical_multiset_facts',
    pg_catalog.jsonb_build_object(
      'canonical_multiset_hash',
      'sha256:' || pg_catalog.repeat('f', 64),
      'ordered_result_hash',
      null
    )
  );
  outcome_json := outcome_json || pg_catalog.jsonb_build_object(
    'outcome_checksum',
    app_data_agent.runtime_canonical_sha256(outcome_json)
  );
  outcome_payload_checksum :=
    app_data_agent.runtime_canonical_sha256(outcome_json);
  finalize_command := claim_command || pg_catalog.jsonb_build_object(
    'expected_branch_version',
    2,
    'fence',
    1,
    'grant_hash',
    grant_hash,
    'record_id',
    '00000000-0000-4000-8000-00000000d191',
    'event_id',
    '00000000-0000-4000-8000-00000000c195',
    'authority',
    authority_json,
    'outcome_json',
    outcome_json,
    'outcome_payload_checksum',
    outcome_payload_checksum
  );

  begin
    perform app_data_agent.finalize_text2sql_sandbox_execution(
      finalize_command || pg_catalog.jsonb_build_object(
        'owner_id',
        'sandbox-worker-stale'
      ),
      '[]'::jsonb
    );
    raise exception 'ASSERTION_DID_NOT_RAISE: SANDBOX_STALE_EXECUTION_FENCE';
  exception
    when others then
      if pg_catalog.strpos(sqlerrm, 'SANDBOX_STALE_EXECUTION_FENCE') = 0 then
        raise;
      end if;
  end;

  begin
    perform app_data_agent.finalize_text2sql_sandbox_execution(
      finalize_command || pg_catalog.jsonb_build_object('fence', 0),
      '[]'::jsonb
    );
    raise exception 'ASSERTION_DID_NOT_RAISE: SANDBOX_STALE_EXECUTION_FENCE';
  exception
    when others then
      if pg_catalog.strpos(sqlerrm, 'SANDBOX_STALE_EXECUTION_FENCE') = 0 then
        raise;
      end if;
  end;

  tampered_outcome := (
    outcome_json - 'outcome_checksum'
  ) || pg_catalog.jsonb_build_object(
    'manifest_facts',
    (outcome_json -> 'manifest_facts') ||
      pg_catalog.jsonb_build_object('manifest_revalidated', false)
  );
  tampered_outcome := tampered_outcome || pg_catalog.jsonb_build_object(
    'outcome_checksum',
    app_data_agent.runtime_canonical_sha256(tampered_outcome)
  );
  begin
    perform app_data_agent.finalize_text2sql_sandbox_execution(
      finalize_command || pg_catalog.jsonb_build_object(
        'outcome_json',
        tampered_outcome,
        'outcome_payload_checksum',
        app_data_agent.runtime_canonical_sha256(tampered_outcome)
      ),
      '[]'::jsonb
    );
    raise exception 'ASSERTION_DID_NOT_RAISE: SANDBOX_OUTCOME_BINDING_MISMATCH';
  exception
    when others then
      if pg_catalog.strpos(sqlerrm, 'SANDBOX_OUTCOME_BINDING_MISMATCH') = 0 then
        raise;
      end if;
  end;

  tampered_outcome := (
    outcome_json - 'outcome_checksum'
  ) || pg_catalog.jsonb_build_object(
    'identity',
    identity_json || pg_catalog.jsonb_build_object(
      'ordered_parameters_hash',
      lexicographic_ordered_parameters_hash
    )
  );
  tampered_outcome := tampered_outcome || pg_catalog.jsonb_build_object(
    'outcome_checksum',
    app_data_agent.runtime_canonical_sha256(tampered_outcome)
  );
  begin
    perform app_data_agent.finalize_text2sql_sandbox_execution(
      finalize_command || pg_catalog.jsonb_build_object(
        'outcome_json',
        tampered_outcome,
        'outcome_payload_checksum',
        app_data_agent.runtime_canonical_sha256(tampered_outcome)
      ),
      '[]'::jsonb
    );
    raise exception 'ASSERTION_DID_NOT_RAISE: SANDBOX_OUTCOME_BINDING_MISMATCH';
  exception
    when others then
      if pg_catalog.strpos(sqlerrm, 'SANDBOX_OUTCOME_BINDING_MISMATCH') = 0 then
        raise;
      end if;
  end;

  tampered_outcome := (
    outcome_json - 'outcome_checksum'
  ) || pg_catalog.jsonb_build_object(
    'attempt_id',
    '00000000-0000-4000-8000-00000000ffff'
  );
  tampered_outcome := tampered_outcome || pg_catalog.jsonb_build_object(
    'outcome_checksum',
    app_data_agent.runtime_canonical_sha256(tampered_outcome)
  );
  begin
    perform app_data_agent.finalize_text2sql_sandbox_execution(
      finalize_command || pg_catalog.jsonb_build_object(
        'outcome_json',
        tampered_outcome,
        'outcome_payload_checksum',
        app_data_agent.runtime_canonical_sha256(tampered_outcome)
      ),
      '[]'::jsonb
    );
    raise exception 'ASSERTION_DID_NOT_RAISE: SANDBOX_OUTCOME_BINDING_MISMATCH';
  exception
    when others then
      if pg_catalog.strpos(sqlerrm, 'SANDBOX_OUTCOME_BINDING_MISMATCH') = 0 then
        raise;
      end if;
  end;

  result_ref := pg_catalog.jsonb_build_object(
    'artifact_id',
    '00000000-0000-4000-8000-00000000e191',
    'artifact_type',
    'SandboxResult',
    'app_id',
    scope_json ->> 'app_id',
    'tenant_id',
    scope_json ->> 'tenant_id',
    'environment',
    scope_json ->> 'environment',
    'run_id',
    run_id,
    'revision',
    1,
    'content_hash',
    result_hash
  );
  receipt_ref := pg_catalog.jsonb_build_object(
    'artifact_id',
    '00000000-0000-4000-8000-00000000e192',
    'artifact_type',
    'SandboxExecutionReceipt',
    'app_id',
    scope_json ->> 'app_id',
    'tenant_id',
    scope_json ->> 'tenant_id',
    'environment',
    scope_json ->> 'environment',
    'run_id',
    run_id,
    'revision',
    1,
    'content_hash',
    receipt_hash
  );
  result_payload := pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'scope',
    scope_json,
    'run_id',
    run_id,
    'execution_id',
    execution_id,
    'result_ref',
    result_ref,
    'result_hash',
    result_hash,
    'columns',
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('name', 'total', 'type', 'INTEGER')
    ),
    'rows',
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_array(42)),
    'row_count',
    1,
    'bytes',
    50
  );
  receipt_payload := pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'scope',
    scope_json,
    'run_id',
    run_id,
    'execution_id',
    execution_id,
    'input_hash',
    input_hash,
    'receipt_ref',
    receipt_ref,
    'execution_hash',
    receipt_hash,
    'result_artifact_ref',
    result_ref,
    'terminal',
    'COMPLETED'
  );
  audience_hash :=
    app_data_agent.text2sql_audience_context_hash(
      (scope_json ->> 'app_id')::uuid,
      (scope_json ->> 'tenant_id')::uuid,
      scope_json ->> 'environment',
      run_id::uuid,
      principal_id::uuid
    );
  artifacts_json := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'reference',
      result_ref,
      'payload_json',
      result_payload,
      'payload_checksum',
      app_data_agent.runtime_canonical_sha256(result_payload),
      'authority',
      authority_json,
      'producer_principal_id',
      principal_id,
      'audience_context_hash',
      audience_hash,
      'worker_fence',
      1
    ),
    pg_catalog.jsonb_build_object(
      'reference',
      receipt_ref,
      'payload_json',
      receipt_payload,
      'payload_checksum',
      app_data_agent.runtime_canonical_sha256(receipt_payload),
      'authority',
      authority_json,
      'producer_principal_id',
      principal_id,
      'audience_context_hash',
      audience_hash,
      'worker_fence',
      1
    )
  );
  invalid_artifacts := pg_catalog.jsonb_set(
    artifacts_json,
    '{1,payload_checksum}',
    pg_catalog.to_jsonb('sha256:' || pg_catalog.repeat('0', 64))
  );
  begin
    perform app_data_agent.finalize_text2sql_sandbox_execution(
      finalize_command,
      invalid_artifacts
    );
    raise exception 'ASSERTION_DID_NOT_RAISE: SANDBOX_FINALIZE_ARTIFACTS_INVALID';
  exception
    when others then
      if pg_catalog.strpos(sqlerrm, 'SANDBOX_FINALIZE_ARTIFACTS_INVALID') = 0
      then
        raise;
      end if;
  end;
  perform test_support.assert_true(
    (
      select pg_catalog.count(*) = 0
      from app_data_agent.text2sql_system_artifacts as artifact
      where artifact.environment = 'prod'
        and artifact.run_id = run_id::uuid
    )
    and (
      select pg_catalog.count(*) = 0
      from app_data_agent.text2sql_sandbox_execution_records as record
      where record.environment = 'prod'
        and record.execution_id = execution_id::uuid
    )
    and (
      select claim.state = 'EXECUTING' and claim.branch_version = 2
      from app_data_agent.text2sql_sandbox_claims as claim
      where claim.environment = 'prod'
        and claim.execution_id = execution_id::uuid
    ),
    'Finalize 任一步失败必须回滚 Result、Receipt、Record、Claim 与 Event'
  );

  response_json :=
    app_data_agent.finalize_text2sql_sandbox_execution(
      finalize_command,
      artifacts_json
    );
  perform test_support.assert_true(
    response_json ->> 'disposition' = 'ACCEPTED'
    and response_json #>> '{claim,state}' = 'COMPLETED'
    and response_json #>> '{claim,terminal_reason_code}' =
      'SANDBOX_EXECUTION_COMPLETED'
    and response_json #> '{claim,lease_id}' = 'null'::jsonb
    and response_json #> '{claim,lease_expires_at}' = 'null'::jsonb
    and not (result_payload ? 'input_hash')
    and (
      select pg_catalog.count(*) = 2
      from app_data_agent.text2sql_system_artifacts as artifact
      where artifact.environment = 'prod'
        and artifact.run_id = run_id::uuid
    )
    and (
      select pg_catalog.count(*) = 1
      from app_data_agent.text2sql_sandbox_execution_records as record
      where record.environment = 'prod'
        and record.execution_id = execution_id::uuid
        and record.authority_state_at_record = 'COMPLETED'
        and record.snapshot_descriptor_hash = descriptor_hash
        and record.snapshot_descriptor_hash <>
          snapshot_checksum
    )
    and (
      select pg_catalog.count(*) = 3
      from app_data_agent.text2sql_sandbox_execution_events as event
      where event.environment = 'prod'
        and event.execution_id = execution_id::uuid
    )
    and (
      select pg_catalog.count(*) = 0
      from app_data_agent.artifacts as artifact
      where artifact.environment = 'prod'
        and artifact.run_id = run_id::uuid
        and artifact.artifact_id in (
          '00000000-0000-4000-8000-00000000e191'::uuid,
          '00000000-0000-4000-8000-00000000e192'::uuid
        )
    ),
    'Finalize 必须原子提交两个专用 Artifact、每 Attempt Record、终态 Claim/Event，且不镜像通用 Store'
  );

  resolved_json :=
    app_data_agent.resolve_text2sql_system_artifact(result_ref);
  perform test_support.assert_true(
    resolved_json = result_payload
    and app_data_agent.verify_text2sql_system_artifact(result_ref)
    and app_data_agent.resolve_text2sql_system_artifact(
      result_ref || pg_catalog.jsonb_build_object(
        'content_hash',
        'sha256:' || pg_catalog.repeat('9', 64)
      )
    ) is null,
    'System Resolver 必须精确匹配 ArtifactReference 全 8 元组'
  );

  perform pg_catalog.set_config(
    'data_agent.principal_id',
    '00000000-0000-4000-8000-000000001015',
    false
  );
  perform pg_catalog.set_config('data_agent.role', 'analyst', false);
  perform test_support.assert_true(
    app_data_agent.resolve_text2sql_system_artifact(result_ref) is null,
    '同 Scope 的另一个 Principal 不能只凭 ArtifactReference 读取 Audience'
  );
  perform pg_catalog.set_config(
    'data_agent.principal_id',
    principal_id,
    false
  );
  perform pg_catalog.set_config('data_agent.role', 'owner', false);

  late_request_checksum :=
    app_data_agent.runtime_canonical_sha256(late_request);
  late_claim := pg_catalog.jsonb_build_object(
    'schema_version',
    'text2sql_sandbox_claim@1.0.0',
    'scope',
    scope_json,
    'run_id',
    run_id,
    'principal_id',
    principal_id,
    'execution_id',
    late_execution_id,
    'idempotency_key',
    'u5-late-cancel',
    'input_hash',
    late_input_hash,
    'request_json',
    late_request,
    'request_checksum',
    late_request_checksum,
    'attempt_id',
    late_attempt_id,
    'owner_id',
    owner_id,
    'lease_id',
    late_lease_id,
    'lease_expires_at',
    app_data_agent.runtime_iso_timestamp(
      pg_catalog.clock_timestamp() + interval '1 hour'
    ),
    'event_id',
    '00000000-0000-4000-8000-00000000c1a1'
  );
  perform app_data_agent.claim_text2sql_sandbox_execution(late_claim);
  late_snapshot := (
    snapshot_json - 'descriptor_hash'
  ) || pg_catalog.jsonb_build_object('execution_id', late_execution_id);
  late_descriptor_hash :=
    app_data_agent.runtime_canonical_sha256(late_snapshot);
  late_snapshot := late_snapshot || pg_catalog.jsonb_build_object(
    'descriptor_hash',
    late_descriptor_hash
  );
  late_snapshot_checksum :=
    app_data_agent.runtime_canonical_sha256(late_snapshot);
  perform app_data_agent.mark_text2sql_sandbox_executing(
    late_claim || pg_catalog.jsonb_build_object(
      'expected_branch_version',
      1,
      'fence',
      1,
      'grant_cancel_epoch',
      0,
      'grant_hash',
      'sha256:' || pg_catalog.repeat('c', 64),
      'sql_artifact_hash',
      sql_artifact_hash,
      'ordered_parameters_hash',
      ordered_parameters_hash,
      'fixture_manifest_hash',
      fixture_manifest_hash,
      'snapshot_descriptor_json',
      late_snapshot,
      'snapshot_descriptor_checksum',
      late_snapshot_checksum,
      'event_id',
      '00000000-0000-4000-8000-00000000c1a2'
    )
  );
  late_identity := identity_json || pg_catalog.jsonb_build_object(
    'execution_id',
    late_execution_id,
    'idempotency_key',
    'u5-late-cancel',
    'input_hash',
    late_input_hash
  );
  late_outcome := (
    outcome_json - 'outcome_checksum'
  ) || pg_catalog.jsonb_build_object(
    'identity',
    late_identity,
    'grant_hash',
    'sha256:' || pg_catalog.repeat('c', 64),
    'input_hash',
    late_input_hash,
    'execution_id',
    late_execution_id,
    'attempt_id',
    late_attempt_id,
    'lease_id',
    late_lease_id,
    'snapshot_descriptor_hash',
    late_descriptor_hash,
    'manifest_facts',
    (outcome_json -> 'manifest_facts') ||
      pg_catalog.jsonb_build_object(
        'snapshot_descriptor_hash',
        late_descriptor_hash
      )
  );
  late_outcome := late_outcome || pg_catalog.jsonb_build_object(
    'outcome_checksum',
    app_data_agent.runtime_canonical_sha256(late_outcome)
  );
  late_outcome_payload_checksum :=
    app_data_agent.runtime_canonical_sha256(late_outcome);
  response_json :=
    app_data_agent.request_text2sql_sandbox_cancel(
      late_claim || pg_catalog.jsonb_build_object(
        'expected_branch_version',
        2,
        'expected_cancel_epoch',
        0,
        'reason_code',
        'USER_REQUESTED',
        'event_id',
        '00000000-0000-4000-8000-00000000c1a3'
      )
    );
  perform test_support.assert_true(
    response_json ->> 'disposition' = 'CANCEL_ACCEPTED'
    and response_json #>> '{claim,cancel_epoch}' = '1',
    'Cancel 必须单调增加 cancel_epoch'
  );
  begin
    perform app_data_agent.request_text2sql_sandbox_cancel(
      late_claim || pg_catalog.jsonb_build_object(
        'expected_branch_version',
        3,
        'expected_cancel_epoch',
        0,
        'reason_code',
        'USER_REQUESTED',
        'event_id',
        '00000000-0000-4000-8000-00000000c1a5'
      )
    );
    raise exception 'ASSERTION_DID_NOT_RAISE: SANDBOX_CLAIM_CAS_MISMATCH';
  exception
    when others then
      if pg_catalog.strpos(sqlerrm, 'SANDBOX_CLAIM_CAS_MISMATCH') = 0 then
        raise;
      end if;
  end;
  response_json := app_data_agent.request_text2sql_sandbox_cancel(
    late_claim || pg_catalog.jsonb_build_object(
      'expected_branch_version',
      3,
      'expected_cancel_epoch',
      1,
      'reason_code',
      'USER_REQUESTED',
      'event_id',
      '00000000-0000-4000-8000-00000000c1a6'
    )
  );
  perform test_support.assert_true(
    response_json ->> 'disposition' = 'CANCEL_ACCEPTED'
    and response_json #>> '{claim,branch_version}' = '3'
    and response_json #>> '{claim,cancel_epoch}' = '1'
    and (
      select pg_catalog.count(*) = 3
      from app_data_agent.text2sql_sandbox_execution_events as event
      where event.environment = 'prod'
        and event.execution_id = late_execution_id::uuid
    ),
    '陈旧 Epoch Cancel 必须 CAS 失败，重读后的重复 Cancel 不能二次递增或追加 Event'
  );
  response_json :=
    app_data_agent.finalize_text2sql_sandbox_execution(
      late_claim || pg_catalog.jsonb_build_object(
        'expected_branch_version',
        3,
        'fence',
        1,
        'grant_hash',
        'sha256:' || pg_catalog.repeat('c', 64),
        'record_id',
        '00000000-0000-4000-8000-00000000d1a1',
        'event_id',
        '00000000-0000-4000-8000-00000000c1a4',
        'authority',
        authority_json,
        'outcome_json',
        late_outcome,
        'outcome_payload_checksum',
        late_outcome_payload_checksum
      ),
      '[]'::jsonb
    );
  perform test_support.assert_true(
    response_json ->> 'disposition' = 'CANCEL_ACCEPTED'
    and response_json ->> 'cancel_disposition' =
      'AFTER_DATASOURCE_TERMINAL'
    and response_json #>> '{claim,state}' = 'CANCELLED'
    and (
      select pg_catalog.count(*) = 0
      from app_data_agent.text2sql_system_artifacts as artifact
      where artifact.environment = 'prod'
        and artifact.worker_fence = 1
        and artifact.payload_json ->> 'execution_id' = late_execution_id
    )
    and (
      select pg_catalog.count(*) = 1
      from app_data_agent.text2sql_sandbox_execution_records as record
      where record.environment = 'prod'
        and record.execution_id = late_execution_id::uuid
        and record.authority_state_at_record = 'CANCELLED'
    ),
    'late cancel 必须丢弃成功候选，只提交 CANCELLED Claim/Record/Event'
  );
  response_json := app_data_agent.claim_text2sql_sandbox_execution(
    late_claim || pg_catalog.jsonb_build_object(
      'attempt_id',
      '00000000-0000-4000-8000-00000000b1a4',
      'lease_id',
      '00000000-0000-4000-8000-00000000b1a5',
      'lease_expires_at',
      app_data_agent.runtime_iso_timestamp(
        pg_catalog.clock_timestamp() + interval '1 hour'
      ),
      'event_id',
      '00000000-0000-4000-8000-00000000c1a7'
    )
  );
  perform test_support.assert_true(
    response_json ->> 'disposition' = 'REPLAY_UNAVAILABLE'
    and response_json #>> '{claim,state}' = 'CANCELLED'
    and response_json #>> '{claim,terminal_reason_code}' = 'SANDBOX_CANCELLED',
    'CANCELLED 重放必须保留原始终态与原因，API disposition 才是 REPLAY_UNAVAILABLE'
  );

  recovery_request_checksum :=
    app_data_agent.runtime_canonical_sha256(recovery_request);
  recovery_claim := pg_catalog.jsonb_build_object(
    'schema_version',
    'text2sql_sandbox_claim@1.0.0',
    'scope',
    scope_json,
    'run_id',
    run_id,
    'principal_id',
    principal_id,
    'execution_id',
    recovery_execution_id,
    'idempotency_key',
    'u5-recovery-fence',
    'input_hash',
    recovery_input_hash,
    'request_json',
    recovery_request,
    'request_checksum',
    recovery_request_checksum,
    'attempt_id',
    recovery_attempt_one,
    'owner_id',
    owner_id,
    'lease_id',
    recovery_lease_one,
    'lease_expires_at',
    app_data_agent.runtime_iso_timestamp(
      pg_catalog.clock_timestamp() + interval '1 second'
    ),
    'event_id',
    '00000000-0000-4000-8000-00000000c1b1'
  );
  perform app_data_agent.claim_text2sql_sandbox_execution(recovery_claim);
  recovery_snapshot := (
    snapshot_json - 'descriptor_hash'
  ) || pg_catalog.jsonb_build_object(
    'execution_id',
    recovery_execution_id
  );
  recovery_descriptor_hash :=
    app_data_agent.runtime_canonical_sha256(recovery_snapshot);
  recovery_snapshot := recovery_snapshot || pg_catalog.jsonb_build_object(
    'descriptor_hash',
    recovery_descriptor_hash
  );
  recovery_snapshot_checksum :=
    app_data_agent.runtime_canonical_sha256(recovery_snapshot);
  perform app_data_agent.mark_text2sql_sandbox_executing(
    recovery_claim || pg_catalog.jsonb_build_object(
      'expected_branch_version',
      1,
      'fence',
      1,
      'grant_cancel_epoch',
      0,
      'grant_hash',
      'sha256:' || pg_catalog.repeat('d', 64),
      'sql_artifact_hash',
      sql_artifact_hash,
      'ordered_parameters_hash',
      ordered_parameters_hash,
      'fixture_manifest_hash',
      fixture_manifest_hash,
      'snapshot_descriptor_json',
      recovery_snapshot,
      'snapshot_descriptor_checksum',
      recovery_snapshot_checksum,
      'event_id',
      '00000000-0000-4000-8000-00000000c1b2'
    )
  );
  recovery_identity := identity_json || pg_catalog.jsonb_build_object(
    'execution_id',
    recovery_execution_id,
    'idempotency_key',
    'u5-recovery-fence',
    'input_hash',
    recovery_input_hash
  );
  attempt_one_outcome := (
    outcome_json - 'outcome_checksum'
  ) || pg_catalog.jsonb_build_object(
    'identity',
    recovery_identity,
    'grant_hash',
    'sha256:' || pg_catalog.repeat('d', 64),
    'input_hash',
    recovery_input_hash,
    'execution_id',
    recovery_execution_id,
    'attempt_id',
    recovery_attempt_one,
    'lease_id',
    recovery_lease_one,
    'snapshot_descriptor_hash',
    recovery_descriptor_hash,
    'manifest_facts',
    (outcome_json -> 'manifest_facts') ||
      pg_catalog.jsonb_build_object(
        'snapshot_descriptor_hash',
        recovery_descriptor_hash
      ),
    'terminal',
    'FAILED',
    'reason_code',
    'SANDBOX_QUERY_FAILED',
    'result',
    null,
    'resource_facts',
    (outcome_json -> 'resource_facts') ||
      pg_catalog.jsonb_build_object(
        'partial_output_discarded',
        true,
        'cutoff_kind',
        'TIMEOUT'
      ),
    'canonical_multiset_facts',
    pg_catalog.jsonb_build_object(
      'canonical_multiset_hash',
      null,
      'ordered_result_hash',
      null
    )
  );
  attempt_one_outcome := attempt_one_outcome ||
    pg_catalog.jsonb_build_object(
      'outcome_checksum',
      app_data_agent.runtime_canonical_sha256(attempt_one_outcome)
    );
  attempt_one_outcome_payload_checksum :=
    app_data_agent.runtime_canonical_sha256(attempt_one_outcome);
  begin
    perform app_data_agent.claim_text2sql_sandbox_execution(
      recovery_claim || pg_catalog.jsonb_build_object(
        'attempt_id',
        recovery_attempt_two,
        'lease_id',
        recovery_lease_two,
        'expected_attempt_id',
        recovery_attempt_one,
        'expected_fencing_token',
        1,
        'recovery_requested_at',
        app_data_agent.runtime_iso_timestamp(
          pg_catalog.clock_timestamp() + interval '4 minutes'
        ),
        'lease_expires_at',
        app_data_agent.runtime_iso_timestamp(
          pg_catalog.clock_timestamp() + interval '1 hour'
        ),
        'event_id',
        '00000000-0000-4000-8000-00000000c1b7'
      )
    );
    raise exception 'ASSERTION_DID_NOT_RAISE: SANDBOX_STALE_EXECUTION_FENCE';
  exception
    when others then
      if pg_catalog.strpos(sqlerrm, 'SANDBOX_STALE_EXECUTION_FENCE') = 0 then
        raise;
      end if;
  end;
  begin
    perform app_data_agent.claim_text2sql_sandbox_execution(
      recovery_claim || pg_catalog.jsonb_build_object(
        'attempt_id',
        recovery_attempt_two,
        'lease_id',
        recovery_lease_two,
        'expected_attempt_id',
        recovery_attempt_one,
        'expected_fencing_token',
        1,
        'recovery_requested_at',
        app_data_agent.runtime_iso_timestamp(pg_catalog.clock_timestamp()),
        'lease_expires_at',
        app_data_agent.runtime_iso_timestamp(
          pg_catalog.clock_timestamp() + interval '1 hour'
        ),
        'event_id',
        '00000000-0000-4000-8000-00000000c1b3'
      )
    );
    raise exception 'ASSERTION_DID_NOT_RAISE: SANDBOX_STALE_EXECUTION_FENCE';
  exception
    when others then
      if pg_catalog.strpos(sqlerrm, 'SANDBOX_STALE_EXECUTION_FENCE') = 0 then
        raise;
      end if;
  end;
  perform pg_catalog.pg_sleep(1.1);
  begin
    perform app_data_agent.claim_text2sql_sandbox_execution(
      recovery_claim || pg_catalog.jsonb_build_object(
        'attempt_id',
        recovery_attempt_two,
        'lease_id',
        recovery_lease_two,
        'expected_attempt_id',
        recovery_attempt_one,
        'expected_fencing_token',
        9,
        'recovery_requested_at',
        app_data_agent.runtime_iso_timestamp(pg_catalog.clock_timestamp()),
        'lease_expires_at',
        app_data_agent.runtime_iso_timestamp(
          pg_catalog.clock_timestamp() + interval '1 hour'
        ),
        'event_id',
        '00000000-0000-4000-8000-00000000c1b3'
      )
    );
    raise exception 'ASSERTION_DID_NOT_RAISE: SANDBOX_STALE_EXECUTION_FENCE';
  exception
    when others then
      if pg_catalog.strpos(sqlerrm, 'SANDBOX_STALE_EXECUTION_FENCE') = 0 then
        raise;
      end if;
  end;
  response_json :=
    app_data_agent.claim_text2sql_sandbox_execution(
      recovery_claim || pg_catalog.jsonb_build_object(
        'attempt_id',
        recovery_attempt_two,
        'lease_id',
        recovery_lease_two,
        'expected_attempt_id',
        recovery_attempt_one,
        'expected_fencing_token',
        1,
        'recovery_requested_at',
        app_data_agent.runtime_iso_timestamp(pg_catalog.clock_timestamp()),
        'lease_expires_at',
        app_data_agent.runtime_iso_timestamp(
          pg_catalog.clock_timestamp() + interval '1 hour'
        ),
        'event_id',
        '00000000-0000-4000-8000-00000000c1b4'
      )
    );
  perform test_support.assert_true(
    response_json ->> 'disposition' = 'ACCEPTED'
    and response_json #>> '{claim,attempt}' = '2'
    and response_json #>> '{claim,fencing_token}' = '2'
    and response_json #>> '{claim,attempt_id}' = recovery_attempt_two,
    'Recovery 必须生成更高 Attempt/Fence，不能覆盖旧 Attempt Record'
  );
  perform app_data_agent.mark_text2sql_sandbox_executing(
    recovery_claim || pg_catalog.jsonb_build_object(
      'attempt_id',
      recovery_attempt_two,
      'lease_id',
      recovery_lease_two,
      'expected_branch_version',
      4,
      'fence',
      2,
      'grant_cancel_epoch',
      0,
      'grant_hash',
      'sha256:' || pg_catalog.repeat('e', 64),
      'sql_artifact_hash',
      sql_artifact_hash,
      'ordered_parameters_hash',
      ordered_parameters_hash,
      'fixture_manifest_hash',
      fixture_manifest_hash,
      'snapshot_descriptor_json',
      recovery_snapshot,
      'snapshot_descriptor_checksum',
      recovery_snapshot_checksum,
      'event_id',
      '00000000-0000-4000-8000-00000000c1b5'
    )
  );
  begin
    perform app_data_agent.finalize_text2sql_sandbox_execution(
      recovery_claim || pg_catalog.jsonb_build_object(
        'attempt_id',
        recovery_attempt_two,
        'lease_id',
        recovery_lease_two,
        'expected_branch_version',
        5,
        'fence',
        2,
        'grant_hash',
        'sha256:' || pg_catalog.repeat('e', 64),
        'record_id',
        '00000000-0000-4000-8000-00000000d1b2',
        'event_id',
        '00000000-0000-4000-8000-00000000c1b6',
        'authority',
        authority_json,
        'outcome_json',
        attempt_one_outcome,
        'outcome_payload_checksum',
        attempt_one_outcome_payload_checksum
      ),
      '[]'::jsonb
    );
    raise exception 'ASSERTION_DID_NOT_RAISE: SANDBOX_OUTCOME_BINDING_MISMATCH';
  exception
    when others then
      if pg_catalog.strpos(sqlerrm, 'SANDBOX_OUTCOME_BINDING_MISMATCH') = 0 then
        raise;
      end if;
  end;
  perform test_support.assert_true(
    (
      select pg_catalog.count(*) = 1
      from app_data_agent.text2sql_sandbox_execution_records as record
      where record.environment = 'prod'
        and record.execution_id = recovery_execution_id::uuid
        and record.attempt_id = recovery_attempt_one::uuid
        and record.fence = 1
        and record.authority_state_at_record = 'RECOVERY_PENDING'
        and record.outcome_json ->> 'record_kind' =
          'AUTHORITY_RECOVERY_PENDING'
        and record.outcome_json #>> '{outcome_unknown}' = 'true'
        and not (record.outcome_json ? 'result_hash')
    )
    and (
      select claim.state = 'EXECUTING'
        and claim.attempt_id = recovery_attempt_two::uuid
        and claim.fence = 2
      from app_data_agent.text2sql_sandbox_claims as claim
      where claim.environment = 'prod'
        and claim.execution_id = recovery_execution_id::uuid
    ),
    'Attempt 1 的旧 Outcome 不能提交到 Attempt 2/Fence 2'
  );
  attempt_two_outcome := (
    attempt_one_outcome - 'outcome_checksum'
  ) || pg_catalog.jsonb_build_object(
    'attempt_id',
    recovery_attempt_two,
    'lease_id',
    recovery_lease_two,
    'execution_fence',
    2,
    'grant_hash',
    'sha256:' || pg_catalog.repeat('e', 64),
    'manifest_facts',
    (attempt_one_outcome -> 'manifest_facts') ||
      pg_catalog.jsonb_build_object('manifest_revalidated', false)
  );
  attempt_two_outcome := attempt_two_outcome ||
    pg_catalog.jsonb_build_object(
      'outcome_checksum',
      app_data_agent.runtime_canonical_sha256(attempt_two_outcome)
    );
  attempt_two_outcome_payload_checksum :=
    app_data_agent.runtime_canonical_sha256(attempt_two_outcome);
  response_json := app_data_agent.fail_text2sql_sandbox_execution(
    recovery_claim || pg_catalog.jsonb_build_object(
      'attempt_id',
      recovery_attempt_two,
      'lease_id',
      recovery_lease_two,
      'fence',
      2,
      'grant_hash',
      'sha256:' || pg_catalog.repeat('e', 64),
      'authority_state_at_record',
      'FAILED',
      'terminal_reason_code',
      'SANDBOX_QUERY_FAILED',
      'record_id',
      '00000000-0000-4000-8000-00000000d1b3',
      'event_id',
      '00000000-0000-4000-8000-00000000c1b8',
      'authority',
      authority_json,
      'outcome_json',
      attempt_two_outcome,
      'outcome_payload_checksum',
      attempt_two_outcome_payload_checksum
    )
  );
  perform test_support.assert_true(
    response_json ->> 'disposition' = 'ACCEPTED'
    and response_json #>> '{claim,state}' = 'FAILED'
    and response_json #>> '{claim,terminal_reason_code}' =
      'SANDBOX_QUERY_FAILED'
    and response_json #> '{claim,lease_id}' = 'null'::jsonb,
    'FAILED 可在查询或 Manifest 复核前以 manifest_revalidated=false 终止'
  );
  response_json := app_data_agent.claim_text2sql_sandbox_execution(
    recovery_claim || pg_catalog.jsonb_build_object(
      'attempt_id',
      '00000000-0000-4000-8000-00000000b1b6',
      'lease_id',
      '00000000-0000-4000-8000-00000000b1b7',
      'lease_expires_at',
      app_data_agent.runtime_iso_timestamp(
        pg_catalog.clock_timestamp() + interval '1 hour'
      ),
      'event_id',
      '00000000-0000-4000-8000-00000000c1b9'
    )
  );
  perform test_support.assert_true(
    response_json ->> 'disposition' = 'REPLAY_UNAVAILABLE'
    and response_json #>> '{claim,state}' = 'FAILED'
    and response_json #>> '{claim,terminal_reason_code}' =
      'SANDBOX_QUERY_FAILED',
    'FAILED 重放必须保留原始终态与原因，不能改写成 Claim State REPLAY_UNAVAILABLE'
  );

  none_request_checksum :=
    app_data_agent.runtime_canonical_sha256(none_request);
  none_claim := pg_catalog.jsonb_build_object(
    'schema_version',
    'text2sql_sandbox_claim@1.0.0',
    'scope',
    scope_json,
    'run_id',
    run_id,
    'principal_id',
    principal_id,
    'execution_id',
    none_execution_id,
    'idempotency_key',
    'u5-replay-unavailable',
    'input_hash',
    none_input_hash,
    'request_json',
    none_request,
    'request_checksum',
    none_request_checksum,
    'attempt_id',
    none_attempt_id,
    'owner_id',
    owner_id,
    'lease_id',
    none_lease_id,
    'lease_expires_at',
    app_data_agent.runtime_iso_timestamp(
      pg_catalog.clock_timestamp() + interval '1 hour'
    ),
    'event_id',
    '00000000-0000-4000-8000-00000000c1c1'
  );
  perform app_data_agent.claim_text2sql_sandbox_execution(none_claim);
  none_snapshot := pg_catalog.jsonb_build_object(
    'protocol_version',
    'postgresql-snapshot@1.0.0',
    'scope_hash',
    scope_hash,
    'run_id',
    run_id,
    'execution_id',
    none_execution_id,
    'principal_id',
    principal_id,
    'datasource_id',
    datasource_id,
    'datasource_fingerprint',
    'postgresql:replay-unavailable',
    'schema_version',
    'fixture-schema-v1',
    'strategy',
    'NONE',
    'intent',
    'RESOLVE',
    'snapshot_token',
    null,
    'schema_manifest_hash',
    null,
    'data_manifest_hash',
    null,
    'fixture_manifest_hash',
    null,
    'observed_at',
    app_data_agent.runtime_iso_timestamp(pg_catalog.clock_timestamp()),
    'replay_state',
    'REPLAY_UNAVAILABLE'
  );
  none_descriptor_hash :=
    app_data_agent.runtime_canonical_sha256(none_snapshot);
  none_snapshot := none_snapshot || pg_catalog.jsonb_build_object(
    'descriptor_hash',
    none_descriptor_hash
  );
  none_snapshot_checksum :=
    app_data_agent.runtime_canonical_sha256(none_snapshot);
  perform app_data_agent.mark_text2sql_sandbox_executing(
    none_claim || pg_catalog.jsonb_build_object(
      'expected_branch_version',
      1,
      'fence',
      1,
      'grant_cancel_epoch',
      0,
      'grant_hash',
      'sha256:' || pg_catalog.repeat('f', 64),
      'sql_artifact_hash',
      sql_artifact_hash,
      'ordered_parameters_hash',
      ordered_parameters_hash,
      'fixture_manifest_hash',
      null,
      'snapshot_descriptor_json',
      none_snapshot,
      'snapshot_descriptor_checksum',
      none_snapshot_checksum,
      'event_id',
      '00000000-0000-4000-8000-00000000c1c2'
    )
  );
  none_identity := identity_json || pg_catalog.jsonb_build_object(
    'execution_id',
    none_execution_id,
    'idempotency_key',
    'u5-replay-unavailable',
    'input_hash',
    none_input_hash,
    'snapshot_requirement',
    pg_catalog.jsonb_build_object('mode', 'ALLOW_UNAVAILABLE')
  );
  none_outcome := (
    outcome_json - 'outcome_checksum'
  ) || pg_catalog.jsonb_build_object(
    'identity',
    none_identity,
    'grant_hash',
    'sha256:' || pg_catalog.repeat('f', 64),
    'input_hash',
    none_input_hash,
    'execution_id',
    none_execution_id,
    'attempt_id',
    none_attempt_id,
    'lease_id',
    none_lease_id,
    'snapshot_descriptor_hash',
    none_descriptor_hash,
    'fixture_manifest_hash',
    null,
    'terminal',
    'REPLAY_UNAVAILABLE',
    'reason_code',
    'SANDBOX_REPLAY_UNAVAILABLE',
    'result',
    null,
    'resource_facts',
    (outcome_json -> 'resource_facts') ||
      pg_catalog.jsonb_build_object(
        'observed_rows',
        0,
        'observed_bytes',
        0,
        'retained_canonical_bytes',
        0,
        'current_batch_estimated_bytes',
        0,
        'partial_output_discarded',
        false,
        'cutoff_kind',
        'NONE'
      ),
    'rollback_facts',
    pg_catalog.jsonb_build_object(
      'rollback_confirmed',
      false,
      'datasource_terminal',
      'ROLLBACK_UNCONFIRMED'
    ),
    'connection_facts',
    pg_catalog.jsonb_build_object(
      'backend_pid',
      null,
      'transaction_status',
      'UNKNOWN',
      'connection_reused',
      false
    ),
    'manifest_facts',
    pg_catalog.jsonb_build_object(
      'snapshot_descriptor_hash',
      none_descriptor_hash,
      'schema_manifest_hash',
      null,
      'data_manifest_hash',
      null,
      'fixture_manifest_hash',
      null,
      'manifest_revalidated',
      false,
      'revalidated_at',
      '2026-07-27T00:00:00.500Z'
    ),
    'canonical_multiset_facts',
    pg_catalog.jsonb_build_object(
      'canonical_multiset_hash',
      null,
      'ordered_result_hash',
      null
    )
  );
  none_outcome := none_outcome || pg_catalog.jsonb_build_object(
    'outcome_checksum',
    app_data_agent.runtime_canonical_sha256(none_outcome)
  );
  none_outcome_payload_checksum :=
    app_data_agent.runtime_canonical_sha256(none_outcome);
  none_fail_command := none_claim || pg_catalog.jsonb_build_object(
      'expected_branch_version',
      2,
      'fence',
      1,
      'grant_hash',
      'sha256:' || pg_catalog.repeat('f', 64),
      'authority_state_at_record',
      'REPLAY_UNAVAILABLE',
      'terminal_reason_code',
      'SANDBOX_REPLAY_UNAVAILABLE',
      'record_id',
      '00000000-0000-4000-8000-00000000d1c1',
      'event_id',
      '00000000-0000-4000-8000-00000000c1c3',
      'authority',
      authority_json,
      'outcome_json',
      none_outcome,
      'outcome_payload_checksum',
      none_outcome_payload_checksum
  );
  begin
    perform app_data_agent.fail_text2sql_sandbox_execution(
      none_fail_command || pg_catalog.jsonb_build_object(
        'owner_id',
        'sandbox-worker-stale'
      )
    );
    raise exception 'ASSERTION_DID_NOT_RAISE: SANDBOX_STALE_EXECUTION_FENCE';
  exception
    when others then
      if pg_catalog.strpos(sqlerrm, 'SANDBOX_STALE_EXECUTION_FENCE') = 0 then
        raise;
      end if;
  end;
  perform test_support.assert_true(
    (
      select pg_catalog.count(*) = 0
      from app_data_agent.text2sql_sandbox_execution_records as record
      where record.environment = 'prod'
        and record.execution_id = none_execution_id::uuid
    )
    and (
      select claim.state = 'EXECUTING' and claim.branch_version = 2
      from app_data_agent.text2sql_sandbox_claims as claim
      where claim.environment = 'prod'
        and claim.execution_id = none_execution_id::uuid
    ),
    'Fail 的 stale owner 必须在写入 Record/Claim/Event 前失败'
  );
  response_json :=
    app_data_agent.fail_text2sql_sandbox_execution(none_fail_command);
  perform test_support.assert_true(
    response_json ->> 'disposition' = 'REPLAY_UNAVAILABLE'
    and response_json #>> '{claim,state}' = 'REPLAY_UNAVAILABLE'
    and response_json #> '{claim,lease_id}' = 'null'::jsonb
    and response_json #> '{claim,fixture_manifest_hash}' = 'null'::jsonb
    and response_json #>> '{claim,snapshot_descriptor,strategy}' = 'NONE'
    and response_json #>> '{claim,snapshot_descriptor,replay_state}' =
      'REPLAY_UNAVAILABLE'
    and (
      select pg_catalog.count(*) = 1
      from app_data_agent.text2sql_sandbox_execution_records as record
      where record.environment = 'prod'
        and record.execution_id = none_execution_id::uuid
        and record.authority_state_at_record = 'REPLAY_UNAVAILABLE'
        and record.fixture_manifest_hash is null
        and record.snapshot_descriptor_hash = none_descriptor_hash
        and record.outcome_json #> '{fixture_manifest_hash}' = 'null'::jsonb
    ),
    'NONE Snapshot 必须允许空 Fixture Hash，并以无 Result 的 REPLAY_UNAVAILABLE Record 终止'
  );
end
$assertions$;

do $backend_rls$
declare
  same_scope_rows bigint;
  cross_scope_rows bigint;
begin
  execute 'set local role data_agent_backend';
  perform pg_catalog.set_config(
    'data_agent.app_id',
    '00000000-0000-4000-8000-00000000da01',
    true
  );
  perform pg_catalog.set_config(
    'data_agent.tenant_id',
    '00000000-0000-4000-8000-00000000aa11',
    true
  );
  perform pg_catalog.set_config('data_agent.environment', 'prod', true);
  perform pg_catalog.set_config(
    'data_agent.principal_id',
    '00000000-0000-4000-8000-000000001005',
    true
  );
  perform pg_catalog.set_config('data_agent.role', 'owner', true);
  perform pg_catalog.set_config(
    'data_agent.deployment_id',
    '00000000-0000-4000-8000-00000000de02',
    true
  );
  select
    (select pg_catalog.count(*)
     from app_data_agent.text2sql_system_artifacts) +
    (select pg_catalog.count(*)
     from app_data_agent.text2sql_sandbox_claims) +
    (select pg_catalog.count(*)
     from app_data_agent.text2sql_sandbox_execution_events) +
    (select pg_catalog.count(*)
     from app_data_agent.text2sql_sandbox_execution_records)
  into same_scope_rows;

  perform pg_catalog.set_config(
    'data_agent.tenant_id',
    '00000000-0000-4000-8000-00000000aa22',
    true
  );
  perform pg_catalog.set_config('data_agent.environment', 'test', true);
  perform pg_catalog.set_config(
    'data_agent.principal_id',
    '00000000-0000-4000-8000-000000001003',
    true
  );
  perform pg_catalog.set_config(
    'data_agent.deployment_id',
    '00000000-0000-4000-8000-00000000de01',
    true
  );
  select
    (select pg_catalog.count(*)
     from app_data_agent.text2sql_system_artifacts) +
    (select pg_catalog.count(*)
     from app_data_agent.text2sql_sandbox_claims) +
    (select pg_catalog.count(*)
     from app_data_agent.text2sql_sandbox_execution_events) +
    (select pg_catalog.count(*)
     from app_data_agent.text2sql_sandbox_execution_records)
  into cross_scope_rows;
  execute 'reset role';
  perform test_support.assert_true(
    same_scope_rows > 0 and cross_scope_rows = 0,
    'Backend SELECT 必须可见同 Scope Authority 数据，并由 FORCE RLS 隔离跨 Scope'
  );
end
$backend_rls$;

create extension if not exists dblink;

create table test_support.u5_cancel_probe_commands (
  command_json jsonb not null
);

create table test_support.u5_claim_probe_commands (
  command_json jsonb not null
);

create or replace function test_support.capture_u5_cancel(
  command_json jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $capture$
declare
  response_json jsonb;
begin
  response_json :=
    app_data_agent.request_text2sql_sandbox_cancel(command_json);
  return response_json ->> 'disposition';
exception
  when others then
    return sqlerrm;
end
$capture$;

create or replace function test_support.capture_u5_claim(
  command_json jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $capture$
declare
  response_json jsonb;
begin
  response_json :=
    app_data_agent.claim_text2sql_sandbox_execution(command_json);
  return response_json ->> 'disposition';
exception
  when others then
    return sqlerrm;
end
$capture$;

insert into test_support.u5_claim_probe_commands (command_json)
select pg_catalog.jsonb_build_object(
  'schema_version',
  'text2sql_sandbox_claim@1.0.0',
  'scope',
  '{
    "app_id":"00000000-0000-4000-8000-00000000da01",
    "tenant_id":"00000000-0000-4000-8000-00000000aa11",
    "environment":"prod"
  }'::jsonb,
  'run_id',
  '00000000-0000-4000-8000-00000000a191',
  'principal_id',
  '00000000-0000-4000-8000-000000001005',
  'execution_id',
  '00000000-0000-4000-8000-00000000b1e1',
  'idempotency_key',
  'u5-concurrent-claim',
  'input_hash',
  'sha256:' || pg_catalog.repeat('f', 64),
  'request_json',
  request_document.value,
  'request_checksum',
  app_data_agent.runtime_canonical_sha256(request_document.value),
  'attempt_id',
  '00000000-0000-4000-8000-00000000b1e2',
  'owner_id',
  'sandbox-worker-claim-a',
  'lease_id',
  '00000000-0000-4000-8000-00000000b1e3',
  'lease_expires_at',
  app_data_agent.runtime_iso_timestamp(
    pg_catalog.clock_timestamp() + interval '1 hour'
  ),
  'event_id',
  '00000000-0000-4000-8000-00000000c1e1'
)
from (
  values (
    '{
      "schema_version":"1.0.0",
      "language":"sql",
      "query_id":"concurrent-claim"
    }'::jsonb
  )
) as request_document(value);

do $concurrent_setup$
declare
  scope_json jsonb := '{
    "app_id":"00000000-0000-4000-8000-00000000da01",
    "tenant_id":"00000000-0000-4000-8000-00000000aa11",
    "environment":"prod"
  }'::jsonb;
  request_json jsonb := '{
    "schema_version":"1.0.0",
    "language":"sql",
    "query_id":"concurrent-cancel"
  }'::jsonb;
  claim_command jsonb;
  snapshot_json jsonb;
  snapshot_checksum text;
  descriptor_hash text;
  ordered_parameters_hash text;
begin
  perform pg_catalog.set_config(
    'data_agent.app_id',
    '00000000-0000-4000-8000-00000000da01',
    false
  );
  perform pg_catalog.set_config(
    'data_agent.tenant_id',
    '00000000-0000-4000-8000-00000000aa11',
    false
  );
  perform pg_catalog.set_config('data_agent.environment', 'prod', false);
  perform pg_catalog.set_config(
    'data_agent.principal_id',
    '00000000-0000-4000-8000-000000001005',
    false
  );
  perform pg_catalog.set_config('data_agent.role', 'owner', false);
  perform pg_catalog.set_config(
    'data_agent.deployment_id',
    '00000000-0000-4000-8000-00000000de02',
    false
  );
  ordered_parameters_hash := app_data_agent.runtime_canonical_sha256(
    pg_catalog.jsonb_build_array(
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
    )
  );
  claim_command := pg_catalog.jsonb_build_object(
    'schema_version',
    'text2sql_sandbox_claim@1.0.0',
    'scope',
    scope_json,
    'run_id',
    '00000000-0000-4000-8000-00000000a191',
    'principal_id',
    '00000000-0000-4000-8000-000000001005',
    'execution_id',
    '00000000-0000-4000-8000-00000000b1d1',
    'idempotency_key',
    'u5-concurrent-cancel',
    'input_hash',
    'sha256:' || pg_catalog.repeat('d', 64),
    'request_json',
    request_json,
    'request_checksum',
    app_data_agent.runtime_canonical_sha256(request_json),
    'attempt_id',
    '00000000-0000-4000-8000-00000000b1d2',
    'owner_id',
    'sandbox-worker-prod',
    'lease_id',
    '00000000-0000-4000-8000-00000000b1d3',
    'lease_expires_at',
    app_data_agent.runtime_iso_timestamp(
      pg_catalog.clock_timestamp() + interval '1 hour'
    ),
    'event_id',
    '00000000-0000-4000-8000-00000000c1d1'
  );
  perform app_data_agent.claim_text2sql_sandbox_execution(claim_command);
  snapshot_json := pg_catalog.jsonb_build_object(
    'protocol_version',
    'postgresql-snapshot@1.0.0',
    'scope_hash',
    'sha256:' || pg_catalog.repeat('0', 64),
    'run_id',
    '00000000-0000-4000-8000-00000000a191',
    'execution_id',
    '00000000-0000-4000-8000-00000000b1d1',
    'principal_id',
    '00000000-0000-4000-8000-000000001005',
    'datasource_id',
    '00000000-0000-4000-8000-00000000f191',
    'datasource_fingerprint',
    'postgresql:concurrent-cancel',
    'schema_version',
    'fixture-schema-v1',
    'strategy',
    'CONTROLLED_REVISION',
    'intent',
    'CREATE',
    'snapshot_token',
    'controlled-revision-concurrent-cancel',
    'schema_manifest_hash',
    'sha256:' || pg_catalog.repeat('2', 64),
    'data_manifest_hash',
    'sha256:' || pg_catalog.repeat('9', 64),
    'fixture_manifest_hash',
    'sha256:' || pg_catalog.repeat('3', 64),
    'observed_at',
    app_data_agent.runtime_iso_timestamp(pg_catalog.clock_timestamp()),
    'replay_state',
    'REPLAYABLE'
  );
  descriptor_hash :=
    app_data_agent.runtime_canonical_sha256(snapshot_json);
  snapshot_json := snapshot_json || pg_catalog.jsonb_build_object(
    'descriptor_hash',
    descriptor_hash
  );
  snapshot_checksum :=
    app_data_agent.runtime_canonical_sha256(snapshot_json);
  perform app_data_agent.mark_text2sql_sandbox_executing(
    claim_command || pg_catalog.jsonb_build_object(
      'expected_branch_version',
      1,
      'fence',
      1,
      'grant_cancel_epoch',
      0,
      'grant_hash',
      'sha256:' || pg_catalog.repeat('e', 64),
      'sql_artifact_hash',
      'sha256:' || pg_catalog.repeat('5', 64),
      'ordered_parameters_hash',
      ordered_parameters_hash,
      'fixture_manifest_hash',
      'sha256:' || pg_catalog.repeat('3', 64),
      'snapshot_descriptor_json',
      snapshot_json,
      'snapshot_descriptor_checksum',
      snapshot_checksum,
      'event_id',
      '00000000-0000-4000-8000-00000000c1d2'
    )
  );
  insert into test_support.u5_cancel_probe_commands (command_json)
  values (
    claim_command || pg_catalog.jsonb_build_object(
      'expected_branch_version',
      2,
      'expected_cancel_epoch',
      0,
      'reason_code',
      'USER_REQUESTED'
    )
  );
end
$concurrent_setup$;

do $concurrent_cancel$
declare
  first_result text;
  second_result text;
  wait_count integer := 0;
begin
  perform public.dblink_connect(
    'u5_cancel_a',
    'dbname=' || pg_catalog.current_database()
  );
  perform public.dblink_connect(
    'u5_cancel_b',
    'dbname=' || pg_catalog.current_database()
  );
  perform public.dblink_exec(
    'u5_cancel_a',
    $remote$
      begin;
      set local data_agent.app_id =
        '00000000-0000-4000-8000-00000000da01';
      set local data_agent.tenant_id =
        '00000000-0000-4000-8000-00000000aa11';
      set local data_agent.environment = 'prod';
      set local data_agent.principal_id =
        '00000000-0000-4000-8000-000000001005';
      set local data_agent.role = 'owner';
      set local data_agent.deployment_id =
        '00000000-0000-4000-8000-00000000de02';
    $remote$
  );
  perform public.dblink_exec(
    'u5_cancel_b',
    $remote$
      begin;
      set local data_agent.app_id =
        '00000000-0000-4000-8000-00000000da01';
      set local data_agent.tenant_id =
        '00000000-0000-4000-8000-00000000aa11';
      set local data_agent.environment = 'prod';
      set local data_agent.principal_id =
        '00000000-0000-4000-8000-000000001005';
      set local data_agent.role = 'owner';
      set local data_agent.deployment_id =
        '00000000-0000-4000-8000-00000000de02';
    $remote$
  );
  perform public.dblink_send_query(
    'u5_cancel_a',
    $remote$
      select test_support.capture_u5_cancel(
        command_json || pg_catalog.jsonb_build_object(
          'event_id',
          '00000000-0000-4000-8000-00000000c1d3'
        )
      )
      from test_support.u5_cancel_probe_commands
    $remote$
  );
  while public.dblink_is_busy('u5_cancel_a') = 1 loop
    perform pg_catalog.pg_sleep(0.01);
    wait_count := wait_count + 1;
    if wait_count > 500 then
      raise exception 'ASSERTION_FAILED: first concurrent Cancel timed out';
    end if;
  end loop;
  select remote.result
  into first_result
  from public.dblink_get_result('u5_cancel_a') as remote(result text);
  perform remote.result
  from public.dblink_get_result('u5_cancel_a') as remote(result text);
  perform public.dblink_send_query(
    'u5_cancel_b',
    $remote$
      select test_support.capture_u5_cancel(
        command_json || pg_catalog.jsonb_build_object(
          'event_id',
          '00000000-0000-4000-8000-00000000c1d4'
        )
      )
      from test_support.u5_cancel_probe_commands
    $remote$
  );
  perform pg_catalog.pg_sleep(0.1);
  perform test_support.assert_true(
    public.dblink_is_busy('u5_cancel_b') = 1,
    '并发 Cancel loser 必须等待 winner 持有的 Claim 行锁'
  );
  perform public.dblink_exec('u5_cancel_a', 'commit');
  wait_count := 0;
  while public.dblink_is_busy('u5_cancel_b') = 1 loop
    perform pg_catalog.pg_sleep(0.01);
    wait_count := wait_count + 1;
    if wait_count > 500 then
      raise exception 'ASSERTION_FAILED: second concurrent Cancel timed out';
    end if;
  end loop;
  select remote.result
  into second_result
  from public.dblink_get_result('u5_cancel_b') as remote(result text);
  perform remote.result
  from public.dblink_get_result('u5_cancel_b') as remote(result text);
  perform public.dblink_exec('u5_cancel_b', 'commit');
  perform public.dblink_disconnect('u5_cancel_a');
  perform public.dblink_disconnect('u5_cancel_b');
  perform test_support.assert_true(
    first_result = 'CANCEL_ACCEPTED'
    and pg_catalog.strpos(
      second_result,
      'SANDBOX_CLAIM_CAS_MISMATCH'
    ) > 0,
    '重叠 Cancel 必须只有一个 winner，loser 以稳定 CAS marker 失败'
  );
end
$concurrent_cancel$;

select test_support.assert_true(
  (
    select claim.state = 'CANCEL_REQUESTED'
      and claim.branch_version = 3
      and claim.cancel_epoch = 1
    from app_data_agent.text2sql_sandbox_claims as claim
    where claim.environment = 'prod'
      and claim.execution_id =
        '00000000-0000-4000-8000-00000000b1d1'::uuid
  )
  and (
    select pg_catalog.count(*) = 3
    from app_data_agent.text2sql_sandbox_execution_events as event
    where event.environment = 'prod'
      and event.execution_id =
        '00000000-0000-4000-8000-00000000b1d1'::uuid
  ),
  '并发 Cancel 后必须只有一个 Epoch 增量与一个 cancel_requested Event'
);

do $concurrent_claim$
declare
  first_result text;
  second_result text;
  wait_count integer := 0;
begin
  perform public.dblink_connect(
    'u5_claim_a',
    'dbname=' || pg_catalog.current_database()
  );
  perform public.dblink_connect(
    'u5_claim_b',
    'dbname=' || pg_catalog.current_database()
  );
  perform public.dblink_exec(
    'u5_claim_a',
    $remote$
      begin;
      set local data_agent.app_id =
        '00000000-0000-4000-8000-00000000da01';
      set local data_agent.tenant_id =
        '00000000-0000-4000-8000-00000000aa11';
      set local data_agent.environment = 'prod';
      set local data_agent.principal_id =
        '00000000-0000-4000-8000-000000001005';
      set local data_agent.role = 'owner';
      set local data_agent.deployment_id =
        '00000000-0000-4000-8000-00000000de02';
    $remote$
  );
  perform public.dblink_exec(
    'u5_claim_b',
    $remote$
      begin;
      set local data_agent.app_id =
        '00000000-0000-4000-8000-00000000da01';
      set local data_agent.tenant_id =
        '00000000-0000-4000-8000-00000000aa11';
      set local data_agent.environment = 'prod';
      set local data_agent.principal_id =
        '00000000-0000-4000-8000-000000001005';
      set local data_agent.role = 'owner';
      set local data_agent.deployment_id =
        '00000000-0000-4000-8000-00000000de02';
    $remote$
  );
  perform public.dblink_send_query(
    'u5_claim_a',
    $remote$
      select test_support.capture_u5_claim(command_json)
      from test_support.u5_claim_probe_commands
    $remote$
  );
  while public.dblink_is_busy('u5_claim_a') = 1 loop
    perform pg_catalog.pg_sleep(0.01);
    wait_count := wait_count + 1;
    if wait_count > 500 then
      raise exception 'ASSERTION_FAILED: first concurrent Claim timed out';
    end if;
  end loop;
  select remote.result
  into first_result
  from public.dblink_get_result('u5_claim_a') as remote(result text);
  perform remote.result
  from public.dblink_get_result('u5_claim_a') as remote(result text);
  perform public.dblink_send_query(
    'u5_claim_b',
    $remote$
      select test_support.capture_u5_claim(
        command_json || pg_catalog.jsonb_build_object(
          'attempt_id',
          '00000000-0000-4000-8000-00000000b1e4',
          'owner_id',
          'sandbox-worker-claim-b',
          'lease_id',
          '00000000-0000-4000-8000-00000000b1e5',
          'event_id',
          '00000000-0000-4000-8000-00000000c1e2'
        )
      )
      from test_support.u5_claim_probe_commands
    $remote$
  );
  perform pg_catalog.pg_sleep(0.1);
  perform test_support.assert_true(
    public.dblink_is_busy('u5_claim_b') = 1,
    '并发同输入 Claim loser 必须等待 winner 的唯一键事务'
  );
  perform public.dblink_exec('u5_claim_a', 'commit');
  wait_count := 0;
  while public.dblink_is_busy('u5_claim_b') = 1 loop
    perform pg_catalog.pg_sleep(0.01);
    wait_count := wait_count + 1;
    if wait_count > 500 then
      raise exception 'ASSERTION_FAILED: second concurrent Claim timed out';
    end if;
  end loop;
  select remote.result
  into second_result
  from public.dblink_get_result('u5_claim_b') as remote(result text);
  perform remote.result
  from public.dblink_get_result('u5_claim_b') as remote(result text);
  perform public.dblink_exec('u5_claim_b', 'commit');
  perform public.dblink_disconnect('u5_claim_a');
  perform public.dblink_disconnect('u5_claim_b');
  perform test_support.assert_true(
    first_result = 'ACCEPTED'
    and second_result = 'IN_PROGRESS',
    '重叠同输入 Claim 必须只有一个 ACCEPTED，loser 返回 IN_PROGRESS'
  );
end
$concurrent_claim$;

select test_support.assert_true(
  (
    select pg_catalog.count(*) = 1
      and pg_catalog.bool_and(
        claim.owner_id = 'sandbox-worker-claim-a'
        and claim.attempt_id =
          '00000000-0000-4000-8000-00000000b1e2'::uuid
      )
    from app_data_agent.text2sql_sandbox_claims as claim
    where claim.environment = 'prod'
      and claim.execution_id =
        '00000000-0000-4000-8000-00000000b1e1'::uuid
  )
  and (
    select pg_catalog.count(*) = 1
    from app_data_agent.text2sql_sandbox_execution_events as event
    where event.environment = 'prod'
      and event.execution_id =
        '00000000-0000-4000-8000-00000000b1e1'::uuid
  ),
  '并发同输入 Claim 必须持久化唯一 Owner/Attempt 与唯一 claimed Event'
);

drop function test_support.capture_u5_cancel(jsonb);
drop function test_support.capture_u5_claim(jsonb);
drop table test_support.u5_cancel_probe_commands;
drop table test_support.u5_claim_probe_commands;

select test_support.assert_raises(
  $assert$
    update app_data_agent.text2sql_system_artifacts
    set payload_json = payload_json || '{"tampered":true}'::jsonb
    where environment = 'prod'
      and artifact_id = '00000000-0000-4000-8000-00000000e191'::uuid
  $assert$,
  'SYSTEM_ARTIFACT_APPEND_ONLY'
);

select test_support.assert_raises(
  $assert$
    delete from app_data_agent.text2sql_sandbox_execution_records
    where environment = 'prod'
      and record_id = '00000000-0000-4000-8000-00000000d191'::uuid
  $assert$,
  'SYSTEM_ARTIFACT_APPEND_ONLY'
);

select test_support.assert_true(
  (
    select artifact.payload_checksum =
      app_data_agent.runtime_canonical_sha256(artifact.payload_json)
      and artifact.content_hash <> artifact.payload_checksum
    from app_data_agent.text2sql_system_artifacts as artifact
    where artifact.environment = 'prod'
      and artifact.artifact_id =
        '00000000-0000-4000-8000-00000000e191'::uuid
  ),
  'System Artifact 领域 content_hash 与完整 payload_checksum 必须分别保存并验证'
);
