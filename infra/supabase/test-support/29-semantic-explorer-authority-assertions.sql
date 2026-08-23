\set ON_ERROR_STOP on

do $seed$
declare
  v_candidate_id uuid;
begin
  select candidate.candidate_id
  into strict v_candidate_id
  from semantic.semantic_candidate as candidate
  where candidate.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and candidate.tenant_id = '00000000-0000-4000-8000-00000000aa22'::uuid
    and candidate.environment = 'test'
    and candidate.semantic_domain = 'revenue'
    and candidate.candidate_status = 'DRAFT';

  insert into semantic.semantic_review_task (
    app_id,
    tenant_id,
    environment,
    semantic_domain,
    packet_id,
    packet_kind,
    packet_digest,
    packet_payload,
    candidate_id,
    decision_window_status,
    review_outcome,
    decision_expires_at,
    publish_expires_at,
    quorum_rules_snapshot,
    veto_rules_snapshot,
    created_by,
    closed_at
  ) values (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    'revenue',
    '00000000-0000-4000-8000-000000004401'::uuid,
    'CANDIDATE_REVIEW',
    'sha256:' || pg_catalog.repeat('8', 64),
    '{}'::jsonb,
    v_candidate_id,
    'CLOSED',
    'APPROVED',
    '2026-08-10T00:00:00Z'::timestamptz,
    '2026-08-10T01:00:00Z'::timestamptz,
    '{}'::jsonb,
    '{}'::jsonb,
    '00000000-0000-4000-8000-000000001003',
    '2026-08-09T00:00:00Z'::timestamptz
  );

  insert into semantic.semantic_publish_attempt (
    app_id,
    tenant_id,
    environment,
    semantic_domain,
    attempt_id,
    packet_id,
    candidate_id,
    attempt_state,
    compiler_bundle_digest,
    catalog_fence_epoch,
    dependency_generation,
    executable_projection_ref,
    executable_projection_hash,
    relationship_projection_ref,
    relationship_projection_hash,
    runtime_restriction_projection_ref,
    runtime_restriction_projection_hash,
    target_generation,
    idempotency_digest,
    committed_release_ref
  ) values (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    'revenue',
    '00000000-0000-4000-8000-000000004402'::uuid,
    '00000000-0000-4000-8000-000000004401'::uuid,
    v_candidate_id,
    'COMMITTED',
    'sha256:' || pg_catalog.repeat('e', 64),
    1,
    1,
    '00000000-0000-4000-8000-000000004601'::uuid,
    'sha256:' || pg_catalog.repeat('a', 64),
    '00000000-0000-4000-8000-000000004602'::uuid,
    'sha256:' || pg_catalog.repeat('b', 64),
    '00000000-0000-4000-8000-000000004603'::uuid,
    'sha256:' || pg_catalog.repeat('c', 64),
    1,
    'sha256:' || pg_catalog.repeat('f', 64),
    '00000000-0000-4000-8000-000000004501'::uuid
  );

  insert into semantic.semantic_source_release (
    app_id,
    tenant_id,
    environment,
    semantic_domain,
    release_id,
    release_generation,
    attempt_id,
    packet_id,
    candidate_id,
    release_digest,
    compiler_bundle_digest,
    executable_projection_ref,
    executable_projection_hash,
    relationship_projection_ref,
    relationship_projection_hash,
    runtime_restriction_projection_ref,
    runtime_restriction_projection_hash,
    quorum_snapshot,
    decision_set_digest,
    published_at,
    published_by
  ) values (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    'revenue',
    '00000000-0000-4000-8000-000000004501'::uuid,
    1,
    '00000000-0000-4000-8000-000000004402'::uuid,
    '00000000-0000-4000-8000-000000004401'::uuid,
    v_candidate_id,
    'sha256:' || pg_catalog.repeat('d', 64),
    'sha256:' || pg_catalog.repeat('e', 64),
    '00000000-0000-4000-8000-000000004601'::uuid,
    'sha256:' || pg_catalog.repeat('a', 64),
    '00000000-0000-4000-8000-000000004602'::uuid,
    'sha256:' || pg_catalog.repeat('b', 64),
    '00000000-0000-4000-8000-000000004603'::uuid,
    'sha256:' || pg_catalog.repeat('c', 64),
    '{}'::jsonb,
    'sha256:' || pg_catalog.repeat('9', 64),
    '2026-08-09T00:00:00Z'::timestamptz,
    '00000000-0000-4000-8000-000000001003'
  );

  insert into semantic.semantic_executable_projection (
    app_id,
    tenant_id,
    environment,
    semantic_domain,
    projection_id,
    release_id,
    projection_digest,
    projection_payload
  ) values (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    'revenue',
    '00000000-0000-4000-8000-000000004601'::uuid,
    '00000000-0000-4000-8000-000000004501'::uuid,
    'sha256:' || pg_catalog.repeat('a', 64),
    '{"metrics":[],"dimensions":[],"formulas":[]}'::jsonb
  );
  insert into semantic.semantic_relationship_projection (
    app_id,
    tenant_id,
    environment,
    semantic_domain,
    projection_id,
    release_id,
    datasource_id,
    catalog_epoch,
    projection_digest,
    projection_payload
  ) values (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    'revenue',
    '00000000-0000-4000-8000-000000004602'::uuid,
    '00000000-0000-4000-8000-000000004501'::uuid,
    '00000000-0000-4000-8000-00000000d501'::uuid,
    1,
    'sha256:' || pg_catalog.repeat('b', 64),
    '{"edges":[]}'::jsonb
  );
  insert into semantic.semantic_runtime_restriction_projection (
    app_id,
    tenant_id,
    environment,
    semantic_domain,
    projection_id,
    release_id,
    projection_digest,
    platform_policy_digest,
    compiler_bundle_digest,
    pointer_generation,
    restriction_payload
  ) values (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    'revenue',
    '00000000-0000-4000-8000-000000004603'::uuid,
    '00000000-0000-4000-8000-000000004501'::uuid,
    'sha256:' || pg_catalog.repeat('c', 64),
    'sha256:' || pg_catalog.repeat('7', 64),
    'sha256:' || pg_catalog.repeat('e', 64),
    2,
    '{"lowered":{"status":"LOWERED","loweredRules":[]}}'::jsonb
  );

  update semantic.semantic_active_pointer as pointer
  set current_release_id = '00000000-0000-4000-8000-000000004501'::uuid,
      current_release_generation = 1,
      current_release_digest = 'sha256:' || pg_catalog.repeat('d', 64),
      pointer_generation = 2,
      updated_at = '2026-08-09T00:00:30Z'::timestamptz,
      updated_by = '00000000-0000-4000-8000-000000001003'
  where pointer.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and pointer.tenant_id = '00000000-0000-4000-8000-00000000aa22'::uuid
    and pointer.environment = 'test'
    and pointer.semantic_domain = 'revenue';

  insert into semantic.semantic_domain_registry (
    app_id,
    tenant_id,
    environment,
    semantic_domain,
    datasource_id,
    domain_display_name,
    domain_description,
    created_by
  ) values (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    'inventory',
    '00000000-0000-4000-8000-00000000d502'::uuid,
    'Inventory',
    'Must remain hidden from the revenue-only Explorer allowlist.',
    'semantic-explorer-test'
  );
  insert into semantic.semantic_active_pointer (
    app_id,
    tenant_id,
    environment,
    semantic_domain,
    current_release_id,
    current_release_generation,
    current_release_digest,
    pointer_generation,
    updated_by
  ) values (
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    'inventory',
    null,
    0,
    null,
    1,
    'semantic-explorer-test'
  );
end
$seed$;

begin;
select pg_catalog.set_config(
  'test.semantic_explorer_candidate_id',
  (
    select candidate.candidate_id::text
    from semantic.semantic_candidate as candidate
    where candidate.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and candidate.tenant_id = '00000000-0000-4000-8000-00000000aa22'::uuid
      and candidate.environment = 'test'
      and candidate.semantic_domain = 'revenue'
      and candidate.candidate_status = 'DRAFT'
  ),
  true
);
select pg_catalog.set_config(
  'test.semantic_explorer_revision_id',
  (
    select candidate.current_revision_id::text
    from semantic.semantic_candidate as candidate
    where candidate.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and candidate.tenant_id = '00000000-0000-4000-8000-00000000aa22'::uuid
      and candidate.environment = 'test'
      and candidate.semantic_domain = 'revenue'
      and candidate.candidate_status = 'DRAFT'
  ),
  true
);
set local role data_agent_backend;
select * from platform.revalidate_backend_authority(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,
  'test',
  '00000000-0000-4000-8000-00000000de01'::uuid,
  '00000000-0000-4000-8000-000000001003'::uuid,
  'owner',
  1,
  1,
  false
);
select pg_catalog.set_config('data_agent.app_id', '00000000-0000-4000-8000-00000000da01', true);
select pg_catalog.set_config('data_agent.tenant_id', '00000000-0000-4000-8000-00000000aa22', true);
select pg_catalog.set_config('data_agent.environment', 'test', true);
select pg_catalog.set_config('data_agent.principal_id', '00000000-0000-4000-8000-000000001003', true);
select pg_catalog.set_config('data_agent.role', 'owner', true);
select pg_catalog.set_config('data_agent.deployment_id', '00000000-0000-4000-8000-00000000de01', true);
select pg_catalog.set_config('app.semantic_domain', 'revenue', true);

do $happy_path$
declare
  v_active jsonb;
  v_historical jsonb;
  v_domains jsonb;
  v_timeline jsonb;
  v_candidate jsonb;
  v_candidate_id uuid;
  v_revision_id uuid;
begin
  v_active := semantic.get_active_explorer_source(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'revenue'
  );
  if v_active ->> 'source_kind' <> 'ACTIVE'
    or v_active #>> '{pointer,current_release_id}' <> '00000000-0000-4000-8000-000000004501'
    or v_active #>> '{pointer,pointer_generation}' <> '2'
    or v_active #>> '{release,semantic_domain}' <> 'revenue'
    or v_active #>> '{executable_projection,projection_id}' <> '00000000-0000-4000-8000-000000004601'
    or v_active #>> '{relationship_projection,projection_id}' <> '00000000-0000-4000-8000-000000004602'
    or v_active #>> '{runtime_restriction_projection,projection_id}' <> '00000000-0000-4000-8000-000000004603'
    or v_active #>> '{runtime_restriction_projection,pointer_generation}' <> '2'
    or v_active ->> 'observed_at' is null
  then
    raise exception 'SEMANTIC_EXPLORER_ACTIVE_SOURCE_ASSERTION_FAILED';
  end if;

  v_historical := semantic.get_release_explorer_source(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'revenue',
    '00000000-0000-4000-8000-000000004501'::uuid
  );
  if v_historical ->> 'source_kind' <> 'HISTORICAL'
    or v_historical #>> '{release,release_id}' <> '00000000-0000-4000-8000-000000004501'
    or v_historical #>> '{pointer,current_release_id}' <> '00000000-0000-4000-8000-000000004501'
  then
    raise exception 'SEMANTIC_EXPLORER_HISTORICAL_SOURCE_ASSERTION_FAILED';
  end if;

  perform pg_catalog.set_config('app.semantic_allowed_domains', 'revenue', true);
  v_domains := semantic.list_explorer_domains(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    array['revenue']::text[]
  );
  if pg_catalog.jsonb_array_length(v_domains) <> 1
    or v_domains #>> '{0,schema_version}' <> 'semantic-explorer-domain-summary@1.0.0'
    or v_domains #>> '{0,pointer_observation,pointer_generation}' <> '2'
    or v_domains #>> '{0,has_current_release}' <> 'true'
  then
    raise exception 'SEMANTIC_EXPLORER_DOMAIN_LIST_ASSERTION_FAILED';
  end if;

  v_timeline := semantic.list_explorer_releases(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'revenue',
    20,
    null
  );
  if v_timeline ->> 'schema_version' <> 'semantic-explorer-release-timeline@1.0.0'
    or pg_catalog.jsonb_array_length(v_timeline -> 'releases') <> 1
    or v_timeline #>> '{releases,0,is_current_at_observation}' <> 'true'
    or v_timeline #>> '{releases,0,release_identity,release_id}' <> '00000000-0000-4000-8000-000000004501'
  then
    raise exception 'SEMANTIC_EXPLORER_TIMELINE_ASSERTION_FAILED';
  end if;

  v_candidate_id := pg_catalog.current_setting('test.semantic_explorer_candidate_id')::uuid;
  v_revision_id := pg_catalog.current_setting('test.semantic_explorer_revision_id')::uuid;
  v_candidate := semantic.get_candidate_explorer_comparison(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,
    'test',
    '00000000-0000-4000-8000-000000001003'::uuid,
    'revenue',
    v_candidate_id,
    v_revision_id
  );
  if v_candidate ->> 'schema_version' <> 'semantic-explorer-candidate-source@1.0.0'
    or v_candidate -> 'base_release' <> 'null'::jsonb
    or v_candidate #>> '{compared_release,release_id}' <> '00000000-0000-4000-8000-000000004501'
    or v_candidate #>> '{candidate_diff,schema_version}' <> 'semantic-diff@1.0.0'
  then
    raise exception 'SEMANTIC_EXPLORER_CANDIDATE_ASSERTION_FAILED';
  end if;

  begin
    perform 1 from semantic.semantic_source_release;
    raise exception 'SEMANTIC_EXPLORER_BACKEND_DIRECT_READ_WAS_NOT_REJECTED';
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    perform semantic.get_active_explorer_source(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa23'::uuid,
      'test',
      '00000000-0000-4000-8000-000000001003'::uuid,
      'revenue'
    );
    raise exception 'SEMANTIC_EXPLORER_CROSS_SCOPE_WAS_NOT_REJECTED';
  exception
    when insufficient_privilege then
      if sqlerrm <> 'SEMANTIC_EXPLORER_SCOPE_FORBIDDEN' then
        raise;
      end if;
  end;
end
$happy_path$;
commit;

begin;
update semantic.semantic_executable_projection as projection
set projection_digest = 'sha256:' || pg_catalog.repeat('6', 64)
where projection.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
  and projection.tenant_id = '00000000-0000-4000-8000-00000000aa22'::uuid
  and projection.environment = 'test'
  and projection.semantic_domain = 'revenue'
  and projection.projection_id = '00000000-0000-4000-8000-000000004601'::uuid;
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
do $digest_mismatch$
begin
  begin
    perform semantic.get_active_explorer_source(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa22'::uuid,
      'test',
      '00000000-0000-4000-8000-000000001003'::uuid,
      'revenue'
    );
    raise exception 'SEMANTIC_EXPLORER_DIGEST_MISMATCH_WAS_NOT_REJECTED';
  exception
    when raise_exception then
      if sqlerrm <> 'SEMANTIC_EXPLORER_PROJECTION_IDENTITY_MISMATCH' then
        raise;
      end if;
  end;
end
$digest_mismatch$;
rollback;

begin;
delete from semantic.semantic_executable_projection as projection
where projection.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
  and projection.tenant_id = '00000000-0000-4000-8000-00000000aa22'::uuid
  and projection.environment = 'test'
  and projection.semantic_domain = 'revenue'
  and projection.projection_id = '00000000-0000-4000-8000-000000004601'::uuid;
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
do $missing_projection$
begin
  begin
    perform semantic.get_active_explorer_source(
      '00000000-0000-4000-8000-00000000da01'::uuid,
      '00000000-0000-4000-8000-00000000aa22'::uuid,
      'test',
      '00000000-0000-4000-8000-000000001003'::uuid,
      'revenue'
    );
    raise exception 'SEMANTIC_EXPLORER_MISSING_PROJECTION_WAS_NOT_REJECTED';
  exception
    when no_data_found then
      if sqlerrm <> 'SEMANTIC_EXPLORER_PROJECTION_MISSING' then
        raise;
      end if;
  end;
end
$missing_projection$;
rollback;

do $surface$
begin
  if not exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010624_app_data_agent_semantic_explorer'
  )
    or not pg_catalog.has_function_privilege(
      'data_agent_backend',
      'semantic.get_active_explorer_source(uuid,uuid,text,uuid,text)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'authenticated',
      'semantic.get_active_explorer_source(uuid,uuid,text,uuid,text)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'data_agent_u6_web_role',
      'semantic.get_active_explorer_source(uuid,uuid,text,uuid,text)',
      'EXECUTE'
    )
  then
    raise exception 'SEMANTIC_EXPLORER_SURFACE_ASSERTION_FAILED';
  end if;
end
$surface$;
