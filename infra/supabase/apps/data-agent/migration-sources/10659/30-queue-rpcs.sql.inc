create function app_data_agent.enqueue_job(requested_command jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  authority record;
  existing_job app_data_agent.jobs%rowtype;
  created_job app_data_agent.jobs%rowtype;
  handler_revision text;
  job_id uuid := pg_catalog.gen_random_uuid();
  accepted_at timestamptz := pg_catalog.clock_timestamp();
  receipt_document jsonb;
  receipt_hash text;
  disposition text := 'CREATED';
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
    'schema_version','scope','kind','idempotency_key','input','priority','max_attempts',
    'cancel_policy','request_hash'
  ]) or requested_command->>'schema_version'<>'job-submit@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(requested_command->'scope',array[
      'app_id','tenant_id','environment'
    ]) or not app_data_agent.provider_json_object_has_exact_keys(requested_command->'input',array[
      'schema_version','kind','resource_refs','parameters'
    ]) or requested_command->'input'->>'schema_version'<>'job-input@1.0.0'
    or requested_command->>'kind'<>requested_command->'input'->>'kind'
    or requested_command->>'kind' not in (
      'SCHEMA_SCAN','RELATIONSHIP_INDEX','ARTIFACT_EXPORT',
      'SEMANTIC_INDUCTION','METRIC_IMPORT','DATALINK_REBUILD'
    ) or requested_command->>'request_hash'<>app_data_agent.u2_canonical_sha256(requested_command-'request_hash')
    or app_data_agent.contains_potential_plaintext_secret(requested_command)
  then
    raise exception using errcode='22023',message='JOB_SUBMISSION_CONTRACT_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(true);
  if requested_command->'scope'<>pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment
  ) then
    raise exception using errcode='42501',message='JOB_SCOPE_MISMATCH';
  end if;
  perform app_data_agent.assert_job_artifact_references(
    requested_command->'input'->'resource_refs',authority.app_id,authority.tenant_id,authority.environment
  );
  if pg_catalog.length(requested_command->>'idempotency_key') not between 8 and 128
    or requested_command->>'idempotency_key' !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
    or (requested_command->>'priority')::integer not between 0 and 100
    or (requested_command->>'max_attempts')::integer not between 1 and 10
    or requested_command->>'cancel_policy' not in ('COOPERATIVE','NOT_SUPPORTED')
    or pg_catalog.jsonb_typeof(requested_command->'input'->'resource_refs')<>'array'
    or pg_catalog.jsonb_array_length(requested_command->'input'->'resource_refs')>64
    or pg_catalog.jsonb_typeof(requested_command->'input'->'parameters')<>'object'
  then
    raise exception using errcode='22023',message='JOB_SUBMISSION_CONTRACT_INVALID';
  end if;

  select * into existing_job from app_data_agent.jobs
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and principal_id=authority.principal_id
    and idempotency_key=requested_command->>'idempotency_key'
  for share;
  if found then
    if existing_job.request_hash<>requested_command->>'request_hash' then
      raise exception using errcode='23505',message='JOB_IDEMPOTENCY_CONFLICT';
    end if;
    disposition := 'REPLAYED'; job_id := existing_job.job_id; accepted_at := existing_job.created_at;
  else
    select revision.handler_revision into strict handler_revision
    from app_data_agent.job_handler_revisions revision
    where revision.kind=requested_command->>'kind'
    order by revision.registered_at desc,revision.handler_revision desc limit 1;
    receipt_document := pg_catalog.jsonb_build_object(
      'schema_version','job-submission-receipt@1.0.0','disposition','CREATED',
      'scope',requested_command->'scope','principal_id',authority.principal_id,'job_id',job_id,
      'kind',requested_command->>'kind','request_hash',requested_command->>'request_hash',
      'status','QUEUED','accepted_at',app_data_agent.job_utc_millis(accepted_at)
    );
    receipt_hash := app_data_agent.u2_canonical_sha256(receipt_document);
    receipt_document := receipt_document||pg_catalog.jsonb_build_object('receipt_hash',receipt_hash);
    insert into app_data_agent.jobs(
      app_id,tenant_id,environment,principal_id,job_id,kind,handler_revision,idempotency_key,
      request_hash,input_json,priority,max_attempts,cancel_policy,status,
      submission_receipt_hash,submission_receipt_json,created_at,updated_at
    ) values (
      authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,job_id,
      requested_command->>'kind',handler_revision,requested_command->>'idempotency_key',
      requested_command->>'request_hash',requested_command->'input',
      (requested_command->>'priority')::integer,(requested_command->>'max_attempts')::integer,
      requested_command->>'cancel_policy','QUEUED',receipt_hash,receipt_document,accepted_at,accepted_at
    ) returning * into created_job;
    perform app_data_agent.job_append_event(created_job,'JOB_QUEUED',pg_catalog.jsonb_build_object(
      'request_hash',created_job.request_hash,'handler_revision',created_job.handler_revision
    ));
  end if;

  receipt_document := pg_catalog.jsonb_build_object(
    'schema_version','job-submission-receipt@1.0.0','disposition',disposition,
    'scope',requested_command->'scope','principal_id',authority.principal_id,'job_id',job_id,
    'kind',requested_command->>'kind','request_hash',requested_command->>'request_hash',
    'status','QUEUED','accepted_at',app_data_agent.job_utc_millis(accepted_at)
  );
  receipt_document := receipt_document||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(receipt_document)
  );
  return receipt_document;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='JOB_SUBMISSION_CONTRACT_INVALID';
end
$function$;

create function app_data_agent.claim_job_work(
  requested_worker_id text,
  requested_handlers jsonb,
  requested_lease_duration_ms integer
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  authority record;
  job app_data_agent.jobs%rowtype;
  attempt_id uuid := pg_catalog.gen_random_uuid();
  now_at timestamptz := pg_catalog.clock_timestamp();
  expires_at timestamptz;
  lease_document jsonb;
  lease_hash text;
begin
  if requested_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or requested_lease_duration_ms not between 5000 and 900000
    or pg_catalog.jsonb_typeof(requested_handlers)<>'array'
    or pg_catalog.jsonb_array_length(requested_handlers) not between 1 and 6
  then raise exception using errcode='22023',message='JOB_CLAIM_CONTRACT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if not exists (
    select 1 from app_data_agent.job_worker_heartbeats heartbeat
    where heartbeat.app_id=authority.app_id and heartbeat.tenant_id=authority.tenant_id
      and heartbeat.environment=authority.environment and heartbeat.worker_id=requested_worker_id
      and heartbeat.expires_at>now_at and heartbeat.handlers_json=requested_handlers
  ) then
    raise exception using errcode='55000',message='JOB_WORKER_HEARTBEAT_STALE';
  end if;
  select candidate.* into job from app_data_agent.jobs candidate
  join app_data_agent.job_handler_revisions revision
    on revision.kind=candidate.kind and revision.handler_revision=candidate.handler_revision
  where candidate.app_id=authority.app_id and candidate.tenant_id=authority.tenant_id
    and candidate.environment=authority.environment and candidate.principal_id=authority.principal_id
    and candidate.status in ('QUEUED','RETRY_WAIT')
    and (candidate.next_attempt_at is null or candidate.next_attempt_at<=now_at)
    and candidate.attempt_count<candidate.max_attempts and revision.enabled and revision.dependencies_ready
    and exists (
      select 1 from pg_catalog.jsonb_array_elements(requested_handlers) handler
      where handler->>'kind'=candidate.kind
        and handler->>'handler_revision'=candidate.handler_revision
        and app_data_agent.provider_json_object_has_exact_keys(handler,array['kind','handler_revision'])
    )
  order by candidate.priority desc,candidate.created_at,candidate.job_id
  for update of candidate skip locked limit 1;
  if not found then return null; end if;
  expires_at := now_at+pg_catalog.make_interval(secs=>requested_lease_duration_ms::double precision/1000.0);
  update app_data_agent.jobs set
    status='LEASED',attempt_count=attempt_count+1,worker_fence=worker_fence+1,
    next_attempt_at=null,updated_at=now_at
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment and job_id=job.job_id
  returning * into job;
  lease_document := pg_catalog.jsonb_build_object(
    'schema_version','job-work-lease@1.0.0',
    'scope',pg_catalog.jsonb_build_object('app_id',job.app_id,'tenant_id',job.tenant_id,'environment',job.environment),
    'principal_id',job.principal_id,'job_id',job.job_id,'kind',job.kind,'request_hash',job.request_hash,
    'input',job.input_json,'attempt_id',attempt_id,'attempt_no',job.attempt_count,
    'delivery_attempt_no',1,'worker_id',requested_worker_id,'lease_token',job.worker_fence,
    'worker_fence',job.worker_fence,'lease_duration_ms',requested_lease_duration_ms,
    'expires_at',app_data_agent.job_utc_millis(expires_at),'handler_revision',job.handler_revision
  );
  lease_hash := app_data_agent.u2_canonical_sha256(lease_document);
  lease_document := lease_document||pg_catalog.jsonb_build_object('lease_hash',lease_hash);
  insert into app_data_agent.job_attempts(
    app_id,tenant_id,environment,job_id,request_hash,attempt_id,attempt_no,delivery_attempt_no,
    worker_id,lease_token,worker_fence,handler_revision,lease_hash,lease_json,status,lease_expires_at
  ) values (
    job.app_id,job.tenant_id,job.environment,job.job_id,job.request_hash,attempt_id,job.attempt_count,1,
    requested_worker_id,job.worker_fence,job.worker_fence,job.handler_revision,lease_hash,lease_document,
    'LEASED',expires_at
  );
  perform app_data_agent.job_append_event(job,'JOB_LEASED',pg_catalog.jsonb_build_object(
    'attempt_id',attempt_id,'worker_fence',job.worker_fence,'handler_revision',job.handler_revision
  ));
  return lease_document;
end
$function$;

create function app_data_agent.start_job_work(requested_lease jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype; now_at timestamptz:=pg_catalog.clock_timestamp();
begin
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  if attempt.status<>'LEASED' then raise exception using errcode='55000',message='JOB_START_STATE_INVALID'; end if;
  select * into strict job from app_data_agent.jobs where app_id=attempt.app_id and tenant_id=attempt.tenant_id
    and environment=attempt.environment and job_id=attempt.job_id for update;
  update app_data_agent.job_attempts set status='RUNNING',started_at=now_at
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and attempt_id=attempt.attempt_id;
  update app_data_agent.jobs set status='RUNNING',updated_at=now_at
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment and job_id=job.job_id
  returning * into job;
  perform app_data_agent.job_append_event(job,'JOB_STARTED',pg_catalog.jsonb_build_object('attempt_id',attempt.attempt_id));
  return pg_catalog.jsonb_build_object('started',true);
end
$function$;

create function app_data_agent.heartbeat_job_work(requested_lease jsonb,requested_lease_duration_ms integer)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype; expires_at timestamptz;
begin
  if requested_lease_duration_ms not between 5000 and 900000 then
    raise exception using errcode='22023',message='JOB_HEARTBEAT_CONTRACT_INVALID';
  end if;
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  expires_at:=pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>requested_lease_duration_ms::double precision/1000.0);
  update app_data_agent.job_attempts set lease_expires_at=expires_at
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and attempt_id=attempt.attempt_id;
  select * into strict job from app_data_agent.jobs where app_id=attempt.app_id and tenant_id=attempt.tenant_id
    and environment=attempt.environment and job_id=attempt.job_id;
  perform app_data_agent.job_append_event(job,'JOB_HEARTBEAT',pg_catalog.jsonb_build_object(
    'attempt_id',attempt.attempt_id,'expires_at',app_data_agent.job_utc_millis(expires_at)
  ));
  return pg_catalog.jsonb_build_object(
    'expires_at',app_data_agent.job_utc_millis(expires_at),
    'cancel_requested',job.status='CANCEL_REQUESTED'
  );
end
$function$;

create function app_data_agent.succeed_job_work(requested_lease jsonb,requested_output_refs jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype; receipt jsonb; now_at timestamptz:=pg_catalog.clock_timestamp();
begin
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs where app_id=attempt.app_id and tenant_id=attempt.tenant_id
    and environment=attempt.environment and job_id=attempt.job_id for update;
  if attempt.status<>'RUNNING' or job.status<>'RUNNING' then
    raise exception using errcode='55000',message='JOB_SUCCESS_STATE_INVALID';
  end if;
  receipt:=app_data_agent.commit_job_output_receipt(job,attempt,'SUCCEEDED',requested_output_refs,null);
  update app_data_agent.job_attempts set status='COMPLETED',completed_at=now_at
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment and attempt_id=attempt.attempt_id;
  update app_data_agent.jobs set status='SUCCEEDED',updated_at=now_at
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment and job_id=job.job_id returning * into job;
  perform app_data_agent.job_append_event(job,'JOB_SUCCEEDED',pg_catalog.jsonb_build_object('receipt_hash',receipt->>'receipt_hash'));
  return receipt;
end
$function$;

create function app_data_agent.fail_job_work(
  requested_lease jsonb,requested_error_code text,requested_retryable boolean,requested_retry_delay_ms integer
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype; receipt jsonb; terminal text; now_at timestamptz:=pg_catalog.clock_timestamp();
begin
  if requested_error_code !~ '^[A-Z][A-Z0-9_]{0,127}$'
    or (requested_retryable and requested_retry_delay_ms not between 1000 and 86400000)
    or (not requested_retryable and requested_retry_delay_ms is not null)
  then raise exception using errcode='22023',message='JOB_FAILURE_CONTRACT_INVALID'; end if;
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs where app_id=attempt.app_id and tenant_id=attempt.tenant_id
    and environment=attempt.environment and job_id=attempt.job_id for update;
  if job.status='CANCEL_REQUESTED' then raise exception using errcode='55000',message='JOB_CANCEL_ACK_REQUIRED'; end if;
  if requested_retryable and job.attempt_count<job.max_attempts then
    update app_data_agent.job_attempts set status='ABANDONED',completed_at=now_at
    where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment and attempt_id=attempt.attempt_id;
    update app_data_agent.jobs set status='RETRY_WAIT',next_attempt_at=now_at+
      pg_catalog.make_interval(secs=>requested_retry_delay_ms::double precision/1000.0),updated_at=now_at,
      terminal_error_code=null
    where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment and job_id=job.job_id returning * into job;
    perform app_data_agent.job_append_event(job,'JOB_RETRY_SCHEDULED',pg_catalog.jsonb_build_object(
      'error_code',requested_error_code,'retry_delay_ms',requested_retry_delay_ms
    ));
    return null;
  end if;
  terminal:=case when requested_retryable then 'DEAD_LETTER' else 'FAILED' end;
  receipt:=app_data_agent.commit_job_output_receipt(job,attempt,terminal,'[]'::jsonb,requested_error_code);
  update app_data_agent.job_attempts set status='COMPLETED',completed_at=now_at
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment and attempt_id=attempt.attempt_id;
  update app_data_agent.jobs set status=terminal,terminal_error_code=requested_error_code,updated_at=now_at
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment and job_id=job.job_id returning * into job;
  perform app_data_agent.job_append_event(job,case when terminal='FAILED' then 'JOB_FAILED' else 'JOB_DEAD_LETTER' end,
    pg_catalog.jsonb_build_object('error_code',requested_error_code,'receipt_hash',receipt->>'receipt_hash'));
  return receipt;
end
$function$;

create function app_data_agent.acknowledge_job_cancel(requested_lease jsonb,requested_error_code text)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype; receipt jsonb; now_at timestamptz:=pg_catalog.clock_timestamp();
begin
  if requested_error_code !~ '^[A-Z][A-Z0-9_]{0,127}$' then
    raise exception using errcode='22023',message='JOB_CANCEL_CONTRACT_INVALID';
  end if;
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs where app_id=attempt.app_id and tenant_id=attempt.tenant_id
    and environment=attempt.environment and job_id=attempt.job_id for update;
  if job.status<>'CANCEL_REQUESTED' or job.cancel_policy<>'COOPERATIVE' then
    raise exception using errcode='55000',message='JOB_CANCEL_STATE_INVALID';
  end if;
  receipt:=app_data_agent.commit_job_output_receipt(job,attempt,'CANCELLED','[]'::jsonb,requested_error_code);
  update app_data_agent.job_attempts set status='COMPLETED',completed_at=now_at
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment and attempt_id=attempt.attempt_id;
  update app_data_agent.jobs set status='CANCELLED',terminal_error_code=requested_error_code,updated_at=now_at
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment and job_id=job.job_id returning * into job;
  perform app_data_agent.job_append_event(job,'JOB_CANCELLED',pg_catalog.jsonb_build_object('receipt_hash',receipt->>'receipt_hash'));
  return receipt;
end
$function$;

create function app_data_agent.request_job_cancel(requested_job_id uuid,requested_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; job app_data_agent.jobs%rowtype; now_at timestamptz:=pg_catalog.clock_timestamp();
begin
  if requested_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{7,127}$' then
    raise exception using errcode='22023',message='JOB_CANCEL_CONTRACT_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into job from app_data_agent.jobs where app_id=authority.app_id and tenant_id=authority.tenant_id
    and environment=authority.environment and principal_id=authority.principal_id and job_id=requested_job_id for update;
  if not found then return null; end if;
  if job.cancel_policy='NOT_SUPPORTED' then raise exception using errcode='55000',message='JOB_CANCEL_NOT_SUPPORTED'; end if;
  if job.status in ('QUEUED','RETRY_WAIT') then
    update app_data_agent.jobs set status='CANCELLED',terminal_error_code='JOB_CANCELLED_BEFORE_START',updated_at=now_at
    where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment and job_id=job.job_id returning * into job;
    perform app_data_agent.job_append_event(job,'JOB_CANCELLED',pg_catalog.jsonb_build_object('idempotency_key',requested_idempotency_key));
  elsif job.status in ('LEASED','RUNNING') then
    update app_data_agent.jobs set status='CANCEL_REQUESTED',updated_at=now_at
    where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment and job_id=job.job_id returning * into job;
    update app_data_agent.job_attempts set status='CANCEL_REQUESTED'
    where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment and job_id=job.job_id
      and status in ('LEASED','RUNNING');
    perform app_data_agent.job_append_event(job,'JOB_CANCEL_REQUESTED',pg_catalog.jsonb_build_object('idempotency_key',requested_idempotency_key));
  end if;
  return app_data_agent.job_record_document(job);
end
$function$;

create function app_data_agent.get_job(requested_job_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; job app_data_agent.jobs%rowtype;
begin
  select * into strict authority from platform.current_backend_authority(false);
  select * into job from app_data_agent.jobs where app_id=authority.app_id and tenant_id=authority.tenant_id
    and environment=authority.environment and principal_id=authority.principal_id and job_id=requested_job_id;
  return case when found then app_data_agent.job_record_document(job) else null end;
end
$function$;

create function app_data_agent.list_jobs(requested_after_job_id uuid,requested_limit integer)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; result jsonb;
begin
  if requested_limit not between 1 and 100 then raise exception using errcode='22023',message='JOB_LIST_CONTRACT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select coalesce(pg_catalog.jsonb_agg(app_data_agent.job_record_document(candidate) order by candidate.created_at desc,candidate.job_id desc),'[]'::jsonb)
  into result from (
    select * from app_data_agent.jobs
    where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
      and principal_id=authority.principal_id and (requested_after_job_id is null or job_id<requested_after_job_id)
    order by created_at desc,job_id desc limit requested_limit
  ) candidate;
  return result;
end
$function$;

alter function app_data_agent.enqueue_job(jsonb) owner to data_agent_u10_job_owner;
alter function app_data_agent.claim_job_work(text,jsonb,integer) owner to data_agent_u10_job_owner;
alter function app_data_agent.start_job_work(jsonb) owner to data_agent_u10_job_owner;
alter function app_data_agent.heartbeat_job_work(jsonb,integer) owner to data_agent_u10_job_owner;
alter function app_data_agent.succeed_job_work(jsonb,jsonb) owner to data_agent_u10_job_owner;
alter function app_data_agent.fail_job_work(jsonb,text,boolean,integer) owner to data_agent_u10_job_owner;
alter function app_data_agent.acknowledge_job_cancel(jsonb,text) owner to data_agent_u10_job_owner;
alter function app_data_agent.request_job_cancel(uuid,text) owner to data_agent_u10_job_owner;
alter function app_data_agent.get_job(uuid) owner to data_agent_u10_job_owner;
alter function app_data_agent.list_jobs(uuid,integer) owner to data_agent_u10_job_owner;
