create function app_data_agent.commit_semantic_induction_candidate(
  requested_lease jsonb, requested_command jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype;
  request jsonb; proposal jsonb; impact jsonb; dry_run jsonb; candidate_draft jsonb;
  candidate jsonb; receipt jsonb; result jsonb; now_at timestamptz:=pg_catalog.clock_timestamp();
  existing app_data_agent.semantic_induction_receipts%rowtype;
  stable_object jsonb; evidence_item jsonb; evidence_identity text;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','request','proposal','impact_plan','metric_dry_run','candidate_draft'
    ]) or requested_command->>'schema_version'<>'semantic-induction-commit-command@1.0.0'
  then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_COMMIT_INVALID'; end if;
  request:=requested_command->'request'; proposal:=requested_command->'proposal';
  impact:=requested_command->'impact_plan';
  dry_run:=nullif(requested_command->'metric_dry_run','null'::jsonb);
  candidate_draft:=requested_command->'candidate_draft';
  perform app_data_agent.semantic_induction_assert_request(request);
  if proposal->>'proposal_hash'<>app_data_agent.u2_canonical_sha256(proposal-'proposal_hash')
    or impact->>'plan_hash'<>app_data_agent.u2_canonical_sha256(impact-'plan_hash')
    or (dry_run is not null and dry_run->>'receipt_hash'<>app_data_agent.u2_canonical_sha256(dry_run-'receipt_hash'))
    or proposal->>'induction_id'<>request->>'induction_id'
    or impact->>'induction_id'<>request->>'induction_id'
    or proposal->>'semantic_domain'<>request->>'semantic_domain'
    or impact->>'semantic_domain'<>request->>'semantic_domain'
    or proposal->'scope'<>request->'scope' or impact->'scope'<>request->'scope'
    or proposal->'base_release_ref'<>request->'base_release_ref'
    or (request->>'induction_kind'='METRIC_IMPORT')<>(dry_run is not null)
    or (dry_run is not null and (
      dry_run->>'status'<>'VALID' or dry_run->'scope'<>request->'scope'
      or dry_run->>'semantic_domain'<>request->>'semantic_domain'
      or dry_run->>'import_id'<>request->>'induction_id'
    ))
    or candidate_draft->>'schema_version'<>'semantic-candidate-draft@1.0.0'
    or candidate_draft->>'semantic_domain'<>request->>'semantic_domain'
    or candidate_draft->>'idempotency_key'<>request->>'induction_id'
    or candidate_draft#>>'{source_payload,content,review_only}'<>'true'
    or candidate_draft#>>'{source_payload,content,proposal_hash}'<>proposal->>'proposal_hash'
  then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_COMMIT_INVALID'; end if;
  if pg_catalog.jsonb_typeof(proposal->'stable_objects')<>'array'
    or pg_catalog.jsonb_typeof(proposal->'evidence')<>'array'
    or pg_catalog.jsonb_typeof(proposal->'candidates')<>'array'
    or pg_catalog.jsonb_array_length(proposal->'stable_objects')
      <>pg_catalog.jsonb_array_length(proposal->'candidates')
  then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_PROPOSAL_CLOSURE_INVALID'; end if;
  for stable_object in select value from pg_catalog.jsonb_array_elements(proposal->'stable_objects') loop
    if stable_object->>'identity_hash'<>app_data_agent.u2_canonical_sha256(stable_object->'material')
      or (stable_object->>'object_id')::uuid
        <>app_data_agent.semantic_induction_stable_object_id(stable_object->>'identity_hash')
      or 1<>(select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(proposal->'candidates') candidate(value)
        where candidate.value->>'object_id'=stable_object->>'object_id')
    then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_PROPOSAL_CLOSURE_INVALID'; end if;
    for evidence_identity in select value from pg_catalog.jsonb_array_elements_text(
      stable_object#>'{material,evidence_identities}'
    ) loop
      if 1<>(select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(proposal->'evidence') evidence(value)
        where evidence.value->>'evidence_id'=evidence_identity)
      then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_PROPOSAL_CLOSURE_INVALID'; end if;
    end loop;
  end loop;
  for evidence_item in select value from pg_catalog.jsonb_array_elements(proposal->'evidence') loop
    if not exists (
      select 1 from pg_catalog.jsonb_array_elements(request->'sources') source(value)
      where source.value->'source_ref'=evidence_item->'source_ref'
    ) or not exists (
      select 1 from pg_catalog.jsonb_array_elements(proposal->'stable_objects') object(value),
        lateral pg_catalog.jsonb_array_elements_text(object.value#>'{material,evidence_identities}') identity(value)
      where identity.value=evidence_item->>'evidence_id'
    ) then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_PROPOSAL_CLOSURE_INVALID'; end if;
  end loop;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements_text(impact->'changed_object_ids') changed(value)
    where not exists (
      select 1 from pg_catalog.jsonb_array_elements(proposal->'candidates') candidate(value)
      where candidate.value->>'object_id'=changed.value
    )
  ) then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_IMPACT_CLOSURE_INVALID'; end if;
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and job_id=attempt.job_id and kind in ('SEMANTIC_INDUCTION','METRIC_IMPORT');
  if job.input_json#>'{parameters,request}'<>request then
    raise exception using errcode='22023',message='SEMANTIC_INDUCTION_REQUEST_MISMATCH'; end if;
  perform app_data_agent.semantic_induction_assert_base_release(
    request,job.app_id,job.tenant_id,job.environment
  );
  select * into existing from app_data_agent.semantic_induction_receipts
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
    and induction_id=(request->>'induction_id')::uuid;
  if found then
    if existing.request_hash<>job.request_hash
      or existing.receipt_json->>'proposal_hash'<>proposal->>'proposal_hash'
      or existing.receipt_json#>>'{impact_plan_ref,resource_hash}'<>impact->>'plan_hash'
    then raise exception using errcode='23505',message='SEMANTIC_INDUCTION_IDEMPOTENCY_CONFLICT'; end if;
    return existing.result_json;
  end if;
  perform pg_catalog.set_config('app.semantic_domain',request->>'semantic_domain',true);
  candidate:=semantic.create_candidate_draft(
    job.app_id,job.tenant_id,job.environment,request->>'semantic_domain',job.principal_id::text,
    (candidate_draft->>'idempotency_key')::uuid,candidate_draft->>'title',candidate_draft->>'description',
    candidate_draft->>'change_class',candidate_draft->>'risk_level',
    candidate_draft->'source_payload',candidate_draft->'diff'
  )||pg_catalog.jsonb_build_object(
    'schema_version','semantic-candidate-create-result@1.0.0','authority','POSTGRESQL'
  );
  insert into app_data_agent.semantic_induction_proposals(
    app_id,tenant_id,environment,induction_id,semantic_domain,proposal_hash,proposal_json,committed_at
  ) values (job.app_id,job.tenant_id,job.environment,(request->>'induction_id')::uuid,
    request->>'semantic_domain',proposal->>'proposal_hash',proposal,now_at);
  insert into app_data_agent.semantic_impact_plans(
    app_id,tenant_id,environment,induction_id,semantic_domain,plan_hash,plan_json,committed_at
  ) values (job.app_id,job.tenant_id,job.environment,(request->>'induction_id')::uuid,
    request->>'semantic_domain',impact->>'plan_hash',impact,now_at);
  if dry_run is not null then
    insert into app_data_agent.semantic_metric_dry_run_receipts(
      app_id,tenant_id,environment,import_id,semantic_domain,receipt_hash,receipt_json,committed_at
    ) values (job.app_id,job.tenant_id,job.environment,(dry_run->>'import_id')::uuid,
      request->>'semantic_domain',dry_run->>'receipt_hash',dry_run,now_at);
  end if;
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-induction-receipt@1.0.0','scope',request->'scope',
    'semantic_domain',request->>'semantic_domain','induction_id',request->>'induction_id',
    'request_hash',job.request_hash,'proposal_hash',proposal->>'proposal_hash',
    'impact_plan_ref',pg_catalog.jsonb_build_object('resource_id',request->>'induction_id','resource_revision',1,'resource_hash',impact->>'plan_hash'),
    'metric_dry_run_ref',case when dry_run is null then null else pg_catalog.jsonb_build_object(
      'resource_id',dry_run->>'import_id','resource_revision',1,'resource_hash',dry_run->>'receipt_hash') end,
    'candidate_ref',pg_catalog.jsonb_build_object('resource_id',candidate->>'candidate_id','resource_revision',1,'resource_hash',candidate->>'revision_digest'),
    'terminal','CANDIDATE_CREATED','created_at',app_data_agent.semantic_induction_utc_millis(now_at)
  );
  receipt:=receipt||pg_catalog.jsonb_build_object('receipt_hash',app_data_agent.u2_canonical_sha256(receipt));
  result:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-induction-commit-result@1.0.0','receipt',receipt,'candidate',candidate
  );
  insert into app_data_agent.semantic_induction_receipts(
    app_id,tenant_id,environment,induction_id,semantic_domain,job_id,attempt_id,worker_fence,
    request_hash,receipt_hash,receipt_json,result_json,committed_at
  ) values (job.app_id,job.tenant_id,job.environment,(request->>'induction_id')::uuid,
    request->>'semantic_domain',job.job_id,attempt.attempt_id,attempt.worker_fence,
    job.request_hash,receipt->>'receipt_hash',receipt,result,now_at);
  return result;
exception when no_data_found then
  raise exception using errcode='40001',message='SEMANTIC_INDUCTION_JOB_STALE';
end
$function$;

create function app_data_agent.record_semantic_induction_rejection(
  requested_lease jsonb, requested_command jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype;
  request jsonb; dry_run jsonb; terminal text; receipt jsonb; result jsonb;
  now_at timestamptz:=pg_catalog.clock_timestamp();
  existing app_data_agent.semantic_induction_receipts%rowtype;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','request','terminal','metric_dry_run'
    ]) or requested_command->>'schema_version'<>'semantic-induction-reject-command@1.0.0'
    or requested_command->>'terminal' not in ('DRY_RUN_REJECTED','CONFLICT')
  then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_REJECTION_INVALID'; end if;
  request:=requested_command->'request'; terminal:=requested_command->>'terminal';
  dry_run:=nullif(requested_command->'metric_dry_run','null'::jsonb);
  perform app_data_agent.semantic_induction_assert_request(request);
  if (terminal='DRY_RUN_REJECTED' and (
      dry_run is null or dry_run->>'status' not in ('INVALID','CONFLICT')
    )) or (dry_run is not null and (
      dry_run->>'receipt_hash'<>app_data_agent.u2_canonical_sha256(dry_run-'receipt_hash')
      or dry_run->'scope'<>request->'scope'
      or dry_run->>'semantic_domain'<>request->>'semantic_domain'
      or dry_run->>'import_id'<>request->>'induction_id'
    ))
  then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_REJECTION_INVALID'; end if;
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and job_id=attempt.job_id and kind in ('SEMANTIC_INDUCTION','METRIC_IMPORT');
  if job.input_json#>'{parameters,request}'<>request then
    raise exception using errcode='22023',message='SEMANTIC_INDUCTION_REQUEST_MISMATCH'; end if;
  select * into existing from app_data_agent.semantic_induction_receipts
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
    and induction_id=(request->>'induction_id')::uuid;
  if found then
    if existing.request_hash<>job.request_hash
      or existing.receipt_json->>'terminal'<>terminal
      or existing.receipt_json#>>'{metric_dry_run_ref,resource_hash}'
        is distinct from dry_run->>'receipt_hash'
    then raise exception using errcode='23505',message='SEMANTIC_INDUCTION_IDEMPOTENCY_CONFLICT'; end if;
    return existing.result_json;
  end if;
  if dry_run is not null then
    insert into app_data_agent.semantic_metric_dry_run_receipts(
      app_id,tenant_id,environment,import_id,semantic_domain,receipt_hash,receipt_json,committed_at
    ) values (job.app_id,job.tenant_id,job.environment,(dry_run->>'import_id')::uuid,
      request->>'semantic_domain',dry_run->>'receipt_hash',dry_run,now_at);
  end if;
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-induction-receipt@1.0.0','scope',request->'scope',
    'semantic_domain',request->>'semantic_domain','induction_id',request->>'induction_id',
    'request_hash',job.request_hash,'proposal_hash',null,
    'impact_plan_ref',null,
    'metric_dry_run_ref',case when dry_run is null then null else pg_catalog.jsonb_build_object(
      'resource_id',dry_run->>'import_id','resource_revision',1,'resource_hash',dry_run->>'receipt_hash') end,
    'candidate_ref',null,'terminal',terminal,
    'created_at',app_data_agent.semantic_induction_utc_millis(now_at)
  );
  receipt:=receipt||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(receipt)
  );
  result:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-induction-reject-result@1.0.0','receipt',receipt
  );
  insert into app_data_agent.semantic_induction_receipts(
    app_id,tenant_id,environment,induction_id,semantic_domain,job_id,attempt_id,worker_fence,
    request_hash,receipt_hash,receipt_json,result_json,committed_at
  ) values (job.app_id,job.tenant_id,job.environment,(request->>'induction_id')::uuid,
    request->>'semantic_domain',job.job_id,attempt.attempt_id,attempt.worker_fence,
    job.request_hash,receipt->>'receipt_hash',receipt,result,now_at);
  return result;
exception when no_data_found then
  raise exception using errcode='40001',message='SEMANTIC_INDUCTION_JOB_STALE';
end
$function$;
