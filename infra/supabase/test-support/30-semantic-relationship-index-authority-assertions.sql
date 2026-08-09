\set ON_ERROR_STOP on

begin isolation level repeatable read read only;
do $static_surface$
begin
  if not exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010625_app_data_agent_semantic_relationship_index'
  )
    or not pg_catalog.has_function_privilege(
      'data_agent_backend',
      'semantic.get_relationship_index_checkpoint(uuid,uuid,text,uuid,text,uuid)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'semantic.get_relationship_index_checkpoint(uuid,uuid,text,uuid,text,uuid)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'data_agent_u6_web_role',
      'semantic.claim_relationship_index_job(uuid,uuid,text,uuid,text,uuid,integer)',
      'EXECUTE'
    )
    or not pg_catalog.has_function_privilege(
      'data_agent_backend',
      'semantic.requeue_relationship_index_release(uuid,uuid,text,uuid,text,uuid,uuid,text,text)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'semantic.requeue_relationship_index_release(uuid,uuid,text,uuid,text,uuid,uuid,text,text)',
      'EXECUTE'
    )
  then
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_STATIC_SURFACE_ASSERTION_FAILED';
  end if;
end
$static_surface$;
commit;

-- Exercise event-driven discovery with both a malformed unrelated payload and
-- the exact release event. Reconciliation must ignore the former safely.
insert into semantic.semantic_outbox (
  app_id, tenant_id, environment, semantic_domain, event_id, event_type,
  counter_kind, axis_generation, observed_release_generation,
  observed_activation_generation, event_payload, event_digest
) values
(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,
  'test', 'revenue', '00000000-0000-4000-8000-000000007201'::uuid,
  'SOURCE_RELEASE_CREATED', 'RELEASE', 1, 1, null,
  '{"release_id":"not-a-uuid"}'::jsonb,
  'sha256:' || pg_catalog.repeat('1', 64)
),
(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,
  'test', 'revenue', '00000000-0000-4000-8000-000000007202'::uuid,
  'SOURCE_RELEASE_CREATED', 'RELEASE', 1, 1, null,
  '{"release_id":"00000000-0000-4000-8000-000000004501"}'::jsonb,
  'sha256:' || pg_catalog.repeat('2', 64)
);

begin;
set local role data_agent_backend;
select * from platform.revalidate_backend_authority(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,
  'test',
  '00000000-0000-4000-8000-00000000de01'::uuid,
  '00000000-0000-4000-8000-000000001003'::uuid,
  'owner', 1, 1, false
);
select pg_catalog.set_config('data_agent.app_id', '00000000-0000-4000-8000-00000000da01', true);
select pg_catalog.set_config('data_agent.tenant_id', '00000000-0000-4000-8000-00000000aa22', true);
select pg_catalog.set_config('data_agent.environment', 'test', true);
select pg_catalog.set_config('data_agent.principal_id', '00000000-0000-4000-8000-000000001003', true);
select pg_catalog.set_config('data_agent.role', 'owner', true);
select pg_catalog.set_config('data_agent.deployment_id', '00000000-0000-4000-8000-00000000de01', true);
select pg_catalog.set_config('app.semantic_domain', 'revenue', true);

do $operations$
declare
  v_discovered integer;
  v_claim jsonb;
  v_second_claim jsonb;
  v_replacement_claim jsonb;
  v_rebuild_claim jsonb;
  v_checkpoint jsonb;
  v_replayed_checkpoint jsonb;
  v_heartbeat timestamptz;
begin
  v_discovered := semantic.reconcile_relationship_index_jobs(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'revenue'
  );
  if v_discovered <> 1 then
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_DISCOVERY_ASSERTION_FAILED';
  end if;
  if semantic.reconcile_relationship_index_jobs(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'revenue'
  ) <> 0 then
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_DISCOVERY_NOT_IDEMPOTENT';
  end if;

  v_claim := semantic.claim_relationship_index_job(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'revenue',
    '00000000-0000-4000-8000-000000007001'::uuid,
    5
  );
  if v_claim is null
    or v_claim ->> 'release_id' <> '00000000-0000-4000-8000-000000004501'
    or v_claim ->> 'attempt_fence' <> '1'
    or v_claim ->> 'relationship_projection_id' <> '00000000-0000-4000-8000-000000004602'
  then
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_CLAIM_ASSERTION_FAILED';
  end if;

  v_second_claim := semantic.claim_relationship_index_job(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'revenue',
    '00000000-0000-4000-8000-000000007002'::uuid,
    5
  );
  if v_second_claim is not null then
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_DOUBLE_CLAIM_ASSERTION_FAILED';
  end if;

  v_heartbeat := semantic.heartbeat_relationship_index_attempt(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'revenue',
    (v_claim ->> 'attempt_id')::uuid,
    (v_claim ->> 'attempt_fence')::bigint,
    '00000000-0000-4000-8000-000000007001'::uuid,
    5
  );
  if v_heartbeat <= pg_catalog.clock_timestamp() then
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_HEARTBEAT_ASSERTION_FAILED';
  end if;

  begin
    perform semantic.commit_relationship_index_attempt(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa22'::uuid,
      'test',
      '00000000-0000-4000-8000-000000001003'::uuid,
      'revenue',
      (v_claim ->> 'attempt_id')::uuid,
      2,
      '00000000-0000-4000-8000-000000007001'::uuid,
      '00000000-0000-4000-8000-000000007101'::uuid,
      'sha256:' || pg_catalog.repeat('7', 64),
      v_claim ->> 'release_digest',
      v_claim ->> 'relationship_projection_digest',
      24,
      37
    );
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_OLD_FENCE_WAS_NOT_REJECTED';
  exception
    when serialization_failure then
      if sqlerrm <> 'SEMANTIC_RELATIONSHIP_INDEX_ATTEMPT_STALE' then
        raise;
      end if;
  end;

  begin
    perform semantic.commit_relationship_index_attempt(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa22'::uuid,
      'test',
      '00000000-0000-4000-8000-000000001003'::uuid,
      'revenue',
      (v_claim ->> 'attempt_id')::uuid,
      (v_claim ->> 'attempt_fence')::bigint,
      '00000000-0000-4000-8000-000000007001'::uuid,
      '00000000-0000-4000-8000-000000007101'::uuid,
      null,
      v_claim ->> 'release_digest',
      v_claim ->> 'relationship_projection_digest',
      24,
      37
    );
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_NULL_DIGEST_WAS_NOT_REJECTED';
  exception
    when invalid_parameter_value then
      if sqlerrm <> 'SEMANTIC_RELATIONSHIP_INDEX_COMMIT_INVALID' then
        raise;
      end if;
  end;

  perform pg_catalog.pg_sleep(5.1);
  begin
    perform semantic.heartbeat_relationship_index_attempt(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa22'::uuid,
      'test',
      '00000000-0000-4000-8000-000000001003'::uuid,
      'revenue',
      (v_claim ->> 'attempt_id')::uuid,
      (v_claim ->> 'attempt_fence')::bigint,
      '00000000-0000-4000-8000-000000007001'::uuid,
      5
    );
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_EXPIRED_HEARTBEAT_WAS_NOT_REJECTED';
  exception
    when serialization_failure then
      if sqlerrm <> 'SEMANTIC_RELATIONSHIP_INDEX_ATTEMPT_STALE' then
        raise;
      end if;
  end;

  v_replacement_claim := semantic.claim_relationship_index_job(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'revenue',
    '00000000-0000-4000-8000-000000007002'::uuid,
    60
  );
  if v_replacement_claim is null
    or v_replacement_claim ->> 'attempt_fence' <> '2'
  then
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_EXPIRED_RECOVERY_ASSERTION_FAILED';
  end if;

  v_checkpoint := semantic.commit_relationship_index_attempt(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'revenue',
    (v_replacement_claim ->> 'attempt_id')::uuid,
    (v_replacement_claim ->> 'attempt_fence')::bigint,
    '00000000-0000-4000-8000-000000007002'::uuid,
    '00000000-0000-4000-8000-000000007101'::uuid,
    'sha256:' || pg_catalog.repeat('7', 64),
    v_replacement_claim ->> 'release_digest',
    v_replacement_claim ->> 'relationship_projection_digest',
    24,
    37
  );
  if v_checkpoint ->> 'schema_version' <> 'semantic-relationship-index-checkpoint@1.0.0'
    or v_checkpoint ->> 'state' <> 'READY'
    or v_checkpoint ->> 'build_id' <> '00000000-0000-4000-8000-000000007101'
    or v_checkpoint ->> 'node_count' <> '24'
    or v_checkpoint ->> 'edge_count' <> '37'
    or v_checkpoint #>> '{release_identity,release_id}' <> '00000000-0000-4000-8000-000000004501'
  then
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_READY_RECEIPT_ASSERTION_FAILED';
  end if;

  v_replayed_checkpoint := semantic.commit_relationship_index_attempt(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'revenue',
    (v_replacement_claim ->> 'attempt_id')::uuid,
    (v_replacement_claim ->> 'attempt_fence')::bigint,
    '00000000-0000-4000-8000-000000007002'::uuid,
    '00000000-0000-4000-8000-000000007101'::uuid,
    'sha256:' || pg_catalog.repeat('7', 64),
    v_replacement_claim ->> 'release_digest',
    v_replacement_claim ->> 'relationship_projection_digest',
    24,
    37
  );
  if v_replayed_checkpoint <> v_checkpoint then
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_COMMIT_NOT_IDEMPOTENT';
  end if;

  begin
    perform semantic.requeue_relationship_index_release(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa22'::uuid,
      'test',
      '00000000-0000-4000-8000-000000001003'::uuid,
      'revenue',
      '00000000-0000-4000-8000-000000004501'::uuid,
      '00000000-0000-4000-8000-000000007101'::uuid,
      'sha256:' || pg_catalog.repeat('8', 64),
      'INDEX_NOT_READY'
    );
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_REQUEUE_MISMATCH_WAS_NOT_REJECTED';
  exception
    when serialization_failure then
      if sqlerrm <> 'SEMANTIC_RELATIONSHIP_INDEX_ATTEMPT_STALE' then
        raise;
      end if;
  end;

  v_checkpoint := semantic.requeue_relationship_index_release(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'revenue',
    '00000000-0000-4000-8000-000000004501'::uuid,
    '00000000-0000-4000-8000-000000007101'::uuid,
    'sha256:' || pg_catalog.repeat('7', 64),
    'INDEX_NOT_READY'
  );
  if v_checkpoint ->> 'state' <> 'STALE'
    or v_checkpoint ->> 'reason_code' <> 'INDEX_NOT_READY'
    or v_checkpoint ->> 'build_id' <> '00000000-0000-4000-8000-000000007101'
    or v_checkpoint -> 'indexed_at' <> 'null'::jsonb
  then
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_REQUEUE_ASSERTION_FAILED';
  end if;

  v_replayed_checkpoint := semantic.requeue_relationship_index_release(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'revenue',
    '00000000-0000-4000-8000-000000004501'::uuid,
    '00000000-0000-4000-8000-000000007101'::uuid,
    'sha256:' || pg_catalog.repeat('7', 64),
    'INDEX_NOT_READY'
  );
  if v_replayed_checkpoint <> v_checkpoint then
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_REQUEUE_NOT_IDEMPOTENT';
  end if;

  v_rebuild_claim := semantic.claim_relationship_index_job(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'revenue',
    '00000000-0000-4000-8000-000000007003'::uuid,
    60
  );
  if v_rebuild_claim is null or v_rebuild_claim ->> 'attempt_fence' <> '3' then
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_REBUILD_CLAIM_ASSERTION_FAILED';
  end if;

  v_checkpoint := semantic.commit_relationship_index_attempt(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'revenue',
    (v_rebuild_claim ->> 'attempt_id')::uuid,
    (v_rebuild_claim ->> 'attempt_fence')::bigint,
    '00000000-0000-4000-8000-000000007003'::uuid,
    '00000000-0000-4000-8000-000000007102'::uuid,
    'sha256:' || pg_catalog.repeat('8', 64),
    v_rebuild_claim ->> 'release_digest',
    v_rebuild_claim ->> 'relationship_projection_digest',
    24,
    37
  );
  if v_checkpoint ->> 'state' <> 'READY'
    or v_checkpoint ->> 'build_id' <> '00000000-0000-4000-8000-000000007102'
  then
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_REBUILD_COMMIT_ASSERTION_FAILED';
  end if;

  v_checkpoint := semantic.get_relationship_index_checkpoint(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'revenue',
    '00000000-0000-4000-8000-000000004501'::uuid
  );
  if v_checkpoint ->> 'state' <> 'READY'
    or v_checkpoint ->> 'manifest_digest' <> 'sha256:' || pg_catalog.repeat('8', 64)
  then
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_READ_RECEIPT_ASSERTION_FAILED';
  end if;

  begin
    perform 1 from semantic.semantic_relationship_index_checkpoint;
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_DIRECT_READ_WAS_NOT_REJECTED';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    perform semantic.get_relationship_index_checkpoint(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa23'::uuid,
      'test',
      '00000000-0000-4000-8000-000000001003'::uuid,
      'revenue',
      '00000000-0000-4000-8000-000000004501'::uuid
    );
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_CROSS_SCOPE_WAS_NOT_REJECTED';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'SEMANTIC_EXPLORER_SCOPE_FORBIDDEN' then
        raise;
      end if;
  end;
end
$operations$;
commit;

begin isolation level repeatable read read only;
do $immutable_evidence$
begin
  if (
    select pg_catalog.count(*)
    from semantic.semantic_relationship_index_attempt as attempt
    where attempt.tenant_id = '00000000-0000-4000-8000-00000000aa22'::uuid
      and attempt.environment = 'test'
      and attempt.semantic_domain = 'revenue'
  ) <> 3
    or (
      select pg_catalog.count(*)
      from semantic.semantic_relationship_index_attempt_receipt as receipt
      where receipt.tenant_id = '00000000-0000-4000-8000-00000000aa22'::uuid
        and receipt.environment = 'test'
        and receipt.semantic_domain = 'revenue'
        and receipt.terminal_state in ('EXPIRED', 'COMMITTED')
    ) <> 3
    or pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner',
      'semantic.semantic_relationship_index_attempt',
      'UPDATE'
    )
    or pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner',
      'semantic.semantic_relationship_index_attempt_receipt',
      'UPDATE'
    )
  then
    raise exception 'SEMANTIC_RELATIONSHIP_INDEX_IMMUTABLE_EVIDENCE_ASSERTION_FAILED';
  end if;
end
$immutable_evidence$;
commit;
