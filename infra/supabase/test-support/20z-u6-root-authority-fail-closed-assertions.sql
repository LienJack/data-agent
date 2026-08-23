\set ON_ERROR_STOP on

-- The three Root success paths stay disabled until PostgreSQL owns every
-- derivation input required to replay Coverage, Stop and ReportReady. These
-- fixtures prove that even a valid, current capability cannot turn a
-- self-reported document into CURRENT, READY, a read Grant or a Stop terminal.
insert into app_data_agent.research_authority_capabilities (
  app_id,
  tenant_id,
  environment,
  capability_id,
  assignment_key,
  principal_id,
  deployment_id,
  membership_version,
  app_epoch,
  membership_role,
  authority_kind,
  artifact_authority_domain,
  frontier_kind,
  resource_kind,
  authority_epoch,
  state,
  expires_at
)
values
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    'test',
    '00000000-0000-4000-8000-00000000c901'::uuid,
    'sha256:' || pg_catalog.repeat('a', 64),
    '00000000-0000-4000-8000-000000001001'::uuid,
    '00000000-0000-4000-8000-00000000de01'::uuid,
    1,
    1,
    'OWNER',
    'RESEARCH_STOP_AUTHORITY',
    null,
    null,
    null,
    1,
    'ACTIVE',
    pg_catalog.clock_timestamp() + interval '10 minutes'
  ),
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    'test',
    '00000000-0000-4000-8000-00000000c902'::uuid,
    'sha256:' || pg_catalog.repeat('b', 64),
    '00000000-0000-4000-8000-000000001001'::uuid,
    '00000000-0000-4000-8000-00000000de01'::uuid,
    1,
    1,
    'OWNER',
    'CURRENT_READINESS_AUTHORITY',
    null,
    null,
    null,
    1,
    'ACTIVE',
    pg_catalog.clock_timestamp() + interval '10 minutes'
  ),
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    'test',
    '00000000-0000-4000-8000-00000000c903'::uuid,
    'sha256:' || pg_catalog.repeat('c', 64),
    '00000000-0000-4000-8000-000000001001'::uuid,
    '00000000-0000-4000-8000-00000000de01'::uuid,
    1,
    1,
    'OWNER',
    'REPORT_READ_AUTHORITY',
    null,
    null,
    null,
    1,
    'ACTIVE',
    pg_catalog.clock_timestamp() + interval '10 minutes'
  );

insert into app_data_agent.research_authority_capability_heads (
  app_id,
  tenant_id,
  environment,
  assignment_key,
  principal_id,
  authority_kind,
  artifact_authority_domain,
  frontier_kind,
  resource_kind,
  current_capability_id,
  current_authority_epoch
)
values
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    'test',
    'sha256:' || pg_catalog.repeat('a', 64),
    '00000000-0000-4000-8000-000000001001'::uuid,
    'RESEARCH_STOP_AUTHORITY',
    null,
    null,
    null,
    '00000000-0000-4000-8000-00000000c901'::uuid,
    1
  ),
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    'test',
    'sha256:' || pg_catalog.repeat('b', 64),
    '00000000-0000-4000-8000-000000001001'::uuid,
    'CURRENT_READINESS_AUTHORITY',
    null,
    null,
    null,
    '00000000-0000-4000-8000-00000000c902'::uuid,
    1
  ),
  (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,
    'test',
    'sha256:' || pg_catalog.repeat('c', 64),
    '00000000-0000-4000-8000-000000001001'::uuid,
    'REPORT_READ_AUTHORITY',
    null,
    null,
    null,
    '00000000-0000-4000-8000-00000000c903'::uuid,
    1
  );

begin;
set local role data_agent_backend;
select pg_catalog.set_config(
  'data_agent.app_id',
  '00000000-0000-4000-8000-00000000da01',
  true
);
select pg_catalog.set_config(
  'data_agent.tenant_id',
  '00000000-0000-4000-8000-00000000aa11',
  true
);
select pg_catalog.set_config('data_agent.environment', 'test', true);
select pg_catalog.set_config(
  'data_agent.principal_id',
  '00000000-0000-4000-8000-000000001001',
  true
);
select pg_catalog.set_config('data_agent.role', 'owner', true);
select pg_catalog.set_config(
  'data_agent.deployment_id',
  '00000000-0000-4000-8000-00000000de01',
  true
);

select test_support.assert_true(
  app_data_agent.commit_research_stop_terminal(
    pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-command@1.0.0',
      'authority_capability_id', '00000000-0000-4000-8000-00000000c901',
      'command', pg_catalog.jsonb_build_object(
        'schema_version', '1.0.0',
        'scope', pg_catalog.jsonb_build_object(
          'app_id', '00000000-0000-4000-8000-00000000da01',
          'tenant_id', '00000000-0000-4000-8000-00000000aa11',
          'environment', 'test'
        ),
        'run_id', '00000000-0000-4000-8000-00000000a101',
        'principal_id', '00000000-0000-4000-8000-000000001001',
        'idempotency_key', 'u6-stop-fail-closed',
        'commit_id', '00000000-0000-4000-8000-00000000c911',
        'terminal_id', '00000000-0000-4000-8000-00000000c912',
        'stop_decision_ref', pg_catalog.jsonb_build_object(
          'app_id', '00000000-0000-4000-8000-00000000da01',
          'tenant_id', '00000000-0000-4000-8000-00000000aa11',
          'environment', 'test',
          'run_id', '00000000-0000-4000-8000-00000000a101',
          'artifact_id', '00000000-0000-4000-8000-00000000c913',
          'artifact_type', 'ResearchStopDecision',
          'revision', 1,
          'content_hash', 'sha256:' || pg_catalog.repeat('d', 64)
        ),
        'coverage_ref', pg_catalog.jsonb_build_object(
          'app_id', '00000000-0000-4000-8000-00000000da01',
          'tenant_id', '00000000-0000-4000-8000-00000000aa11',
          'environment', 'test',
          'run_id', '00000000-0000-4000-8000-00000000a101',
          'artifact_id', '00000000-0000-4000-8000-00000000c914',
          'artifact_type', 'CoverageState',
          'revision', 1,
          'content_hash', 'sha256:' || pg_catalog.repeat('e', 64)
        )
      )
    ) -> 'command' || pg_catalog.jsonb_build_object(
      'stop_receipt_id', '00000000-0000-4000-8000-00000000c915',
      'stop_receipt_hash', 'sha256:' || pg_catalog.repeat('3', 64),
      'terminal_decision', 'STOP_PARTIAL'
    )
  ) #>> '{error,code}' = 'STOP_RECEIPT_NOT_FOUND',
  '缺少 DB-owned Stop derivation inputs 时不得提交公共 Stop terminal'
);

select test_support.assert_true(
  app_data_agent.publish_current_report_readiness(
    pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-command@1.0.0',
      'authority_capability_id', '00000000-0000-4000-8000-00000000c902',
      'command', pg_catalog.jsonb_build_object(
        'schema_version', '1.0.0',
        'scope', pg_catalog.jsonb_build_object(
          'app_id', '00000000-0000-4000-8000-00000000da01',
          'tenant_id', '00000000-0000-4000-8000-00000000aa11',
          'environment', 'test'
        ),
        'run_id', '00000000-0000-4000-8000-00000000a101',
        'principal_id', '00000000-0000-4000-8000-000000001001',
        'idempotency_key', 'u6-publish-fail-closed',
        'publication_id', '00000000-0000-4000-8000-00000000c921',
        'certificate_ref', pg_catalog.jsonb_build_object(
          'app_id', '00000000-0000-4000-8000-00000000da01',
          'tenant_id', '00000000-0000-4000-8000-00000000aa11',
          'environment', 'test',
          'run_id', '00000000-0000-4000-8000-00000000a101',
          'artifact_id', '00000000-0000-4000-8000-00000000c922',
          'artifact_type', 'ReportReadyCertificate',
          'revision', 1,
          'content_hash', 'sha256:' || pg_catalog.repeat('f', 64)
        ),
        'expected_readiness_version', null
      )
    )
  ) #>> '{error,code}' = 'RESEARCH_DATABASE_AUTHORITY_REQUIRED',
  '缺少完整 Certificate verifier 时不得发布 CURRENT'
);

select test_support.assert_true(
  app_data_agent.consume_current_ready(
    pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-command@1.0.0',
      'authority_capability_id', '00000000-0000-4000-8000-00000000c902',
      'command', pg_catalog.jsonb_build_object(
        'schema_version', '1.0.0',
        'scope', pg_catalog.jsonb_build_object(
          'app_id', '00000000-0000-4000-8000-00000000da01',
          'tenant_id', '00000000-0000-4000-8000-00000000aa11',
          'environment', 'test'
        ),
        'run_id', '00000000-0000-4000-8000-00000000a101',
        'principal_id', '00000000-0000-4000-8000-000000001001',
        'idempotency_key', 'u6-consume-ready-fail-closed',
        'consumption_id', '00000000-0000-4000-8000-00000000c931',
        'purpose', 'DOMAIN_TERMINAL',
        'certificate_ref', pg_catalog.jsonb_build_object(
          'app_id', '00000000-0000-4000-8000-00000000da01',
          'tenant_id', '00000000-0000-4000-8000-00000000aa11',
          'environment', 'test',
          'run_id', '00000000-0000-4000-8000-00000000a101',
          'artifact_id', '00000000-0000-4000-8000-00000000c932',
          'artifact_type', 'ReportReadyCertificate',
          'revision', 1,
          'content_hash', 'sha256:' || pg_catalog.repeat('1', 64)
        ),
        'terminal_id', '00000000-0000-4000-8000-00000000c933'
      )
    ) -> 'command'
  ) #>> '{error,code}' = 'NO_CURRENT_READINESS',
  '缺少完整 Certificate verifier 时不得提交 READY'
);

select test_support.assert_true(
  app_data_agent.consume_current_ready(
    pg_catalog.jsonb_build_object(
      'protocol_version', 'u6-db-command@1.0.0',
      'authority_capability_id', '00000000-0000-4000-8000-00000000c903',
      'command', pg_catalog.jsonb_build_object(
        'schema_version', '1.0.0',
        'scope', pg_catalog.jsonb_build_object(
          'app_id', '00000000-0000-4000-8000-00000000da01',
          'tenant_id', '00000000-0000-4000-8000-00000000aa11',
          'environment', 'test'
        ),
        'run_id', '00000000-0000-4000-8000-00000000a101',
        'principal_id', '00000000-0000-4000-8000-000000001001',
        'idempotency_key', 'u6-consume-read-fail-closed',
        'consumption_id', '00000000-0000-4000-8000-00000000c941',
        'purpose', 'REPORT_READ',
        'certificate_ref', pg_catalog.jsonb_build_object(
          'app_id', '00000000-0000-4000-8000-00000000da01',
          'tenant_id', '00000000-0000-4000-8000-00000000aa11',
          'environment', 'test',
          'run_id', '00000000-0000-4000-8000-00000000a101',
          'artifact_id', '00000000-0000-4000-8000-00000000c942',
          'artifact_type', 'ReportReadyCertificate',
          'revision', 1,
          'content_hash', 'sha256:' || pg_catalog.repeat('2', 64)
        ),
        'grant_id', '00000000-0000-4000-8000-00000000c943'
      )
    ) -> 'command'
  ) #>> '{error,code}' = 'NO_CURRENT_READINESS',
  '缺少完整 Certificate verifier 时不得签发 ReportRead Grant'
);
commit;

select test_support.assert_true(
  not exists (
    select 1 from app_data_agent.current_report_readiness
  )
  and not exists (
    select 1 from app_data_agent.research_domain_terminals
  )
  and not exists (
    select 1 from app_data_agent.research_readiness_publications
  )
  and not exists (
    select 1 from app_data_agent.research_readiness_consumptions
  )
  and not exists (
    select 1 from app_data_agent.report_read_grants
  ),
  'U6 Root fail-closed 路径不得留下 CURRENT、Terminal、Publication、Consumption 或 Grant'
);
