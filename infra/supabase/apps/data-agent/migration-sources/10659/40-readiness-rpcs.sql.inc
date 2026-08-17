create function app_data_agent.publish_job_worker_heartbeat(requested_heartbeat jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; existing app_data_agent.job_worker_heartbeats%rowtype; kinds text[];
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_heartbeat,array[
    'schema_version','heartbeat_id','scope','worker_id','handlers','capacity',
    'observed_at','expires_at','heartbeat_hash'
  ]) or requested_heartbeat->>'schema_version'<>'job-worker-heartbeat@1.0.0'
    or requested_heartbeat->>'heartbeat_hash'<>app_data_agent.u2_canonical_sha256(requested_heartbeat-'heartbeat_hash')
    or pg_catalog.jsonb_typeof(requested_heartbeat->'handlers')<>'array'
    or pg_catalog.jsonb_array_length(requested_heartbeat->'handlers') not between 1 and 6
    or (requested_heartbeat->>'capacity')::integer not between 1 and 64
    or (requested_heartbeat->>'expires_at')::timestamptz<=(requested_heartbeat->>'observed_at')::timestamptz
    or app_data_agent.contains_potential_plaintext_secret(requested_heartbeat)
  then raise exception using errcode='22023',message='JOB_WORKER_HEARTBEAT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if requested_heartbeat->'scope'<>pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment
  ) then raise exception using errcode='42501',message='JOB_SCOPE_MISMATCH'; end if;
  select pg_catalog.array_agg(handler->>'kind' order by handler->>'kind') into kinds
  from pg_catalog.jsonb_array_elements(requested_heartbeat->'handlers') handler
  where app_data_agent.provider_json_object_has_exact_keys(handler,array['kind','handler_revision'])
    and exists (
      select 1 from app_data_agent.job_handler_revisions revision
      where revision.kind=handler->>'kind' and revision.handler_revision=handler->>'handler_revision'
    );
  if coalesce(pg_catalog.array_length(kinds,1),0)<>pg_catalog.jsonb_array_length(requested_heartbeat->'handlers')
    or (select pg_catalog.count(distinct item) from pg_catalog.unnest(kinds) item)<>pg_catalog.array_length(kinds,1)
    or requested_heartbeat->'handlers'<>(
      select pg_catalog.jsonb_agg(handler order by handler->>'kind')
      from pg_catalog.jsonb_array_elements(requested_heartbeat->'handlers') handler
    )
  then raise exception using errcode='22023',message='JOB_WORKER_HEARTBEAT_INVALID'; end if;
  select * into existing from app_data_agent.job_worker_heartbeats
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and heartbeat_id=(requested_heartbeat->>'heartbeat_id')::uuid;
  if found then
    if existing.heartbeat_hash<>requested_heartbeat->>'heartbeat_hash' then
      raise exception using errcode='23505',message='JOB_WORKER_HEARTBEAT_REPLAY_CONFLICT';
    end if;
    return existing.heartbeat_json;
  end if;
  insert into app_data_agent.job_worker_heartbeats(
    app_id,tenant_id,environment,heartbeat_id,worker_id,handler_kinds,handlers_json,
    capacity,heartbeat_hash,heartbeat_json,observed_at,expires_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,
    (requested_heartbeat->>'heartbeat_id')::uuid,requested_heartbeat->>'worker_id',kinds,
    requested_heartbeat->'handlers',(requested_heartbeat->>'capacity')::integer,
    requested_heartbeat->>'heartbeat_hash',requested_heartbeat,
    (requested_heartbeat->>'observed_at')::timestamptz,(requested_heartbeat->>'expires_at')::timestamptz
  );
  return requested_heartbeat;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  raise exception using errcode='22023',message='JOB_WORKER_HEARTBEAT_INVALID';
end
$function$;

create function app_data_agent.list_job_capability_readiness()
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  authority record;
  revision app_data_agent.job_handler_revisions%rowtype;
  evaluated_at timestamptz := pg_catalog.clock_timestamp();
  valid_until timestamptz := evaluated_at+interval '30 seconds';
  heartbeat_fresh boolean;
  output_available boolean;
  status text;
  reason text;
  receipt_id uuid;
  receipt_document jsonb;
  receipts jsonb := '[]'::jsonb;
begin
  select * into strict authority from platform.current_backend_authority(false);
  for revision in
    select distinct on (kind) * from app_data_agent.job_handler_revisions
    order by kind,registered_at desc,handler_revision desc
  loop
    select exists (
      select 1 from app_data_agent.job_worker_heartbeats heartbeat
      where heartbeat.app_id=authority.app_id and heartbeat.tenant_id=authority.tenant_id
        and heartbeat.environment=authority.environment and heartbeat.expires_at>evaluated_at
        and revision.kind=any(heartbeat.handler_kinds)
        and exists (
          select 1 from pg_catalog.jsonb_array_elements(heartbeat.handlers_json) handler
          where handler->>'kind'=revision.kind
            and handler->>'handler_revision'=revision.handler_revision
        )
    ) into heartbeat_fresh;
    output_available := not revision.output_receipt_required or exists (
      select 1 from app_data_agent.job_output_receipts output
      where output.app_id=authority.app_id and output.tenant_id=authority.tenant_id
        and output.environment=authority.environment and output.terminal='SUCCEEDED'
        and output.receipt_json->>'kind'=revision.kind
    );
    if not revision.enabled then status:='NOT_READY'; reason:='HANDLER_NOT_REGISTERED';
    elsif not revision.dependencies_ready then status:='NOT_READY'; reason:='DEPENDENCY_UNAVAILABLE';
    elsif not heartbeat_fresh then status:='NOT_READY'; reason:='WORKER_HEARTBEAT_STALE';
    elsif not output_available then status:='NOT_READY'; reason:='OUTPUT_RECEIPT_REQUIRED';
    else status:='READY'; reason:='CAPABILITY_READY'; end if;
    receipt_id:=pg_catalog.gen_random_uuid();
    receipt_document:=pg_catalog.jsonb_build_object(
      'schema_version','capability-readiness-receipt@1.0.0','receipt_id',receipt_id,
      'scope',pg_catalog.jsonb_build_object(
        'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment
      ),
      'capability',revision.kind,'status',status,'reason_code',reason,
      'handler_revision',case when revision.enabled then to_jsonb(revision.handler_revision) else 'null'::jsonb end,
      'handler_registered',revision.enabled,'worker_heartbeat_fresh',heartbeat_fresh,
      'dependencies_ready',revision.dependencies_ready,
      'output_receipt_required',revision.output_receipt_required,
      'output_receipt_available',output_available,
      'evaluated_at',app_data_agent.job_utc_millis(evaluated_at),
      'valid_until',app_data_agent.job_utc_millis(valid_until)
    );
    receipt_document:=receipt_document||pg_catalog.jsonb_build_object(
      'receipt_hash',app_data_agent.u2_canonical_sha256(receipt_document)
    );
    insert into app_data_agent.capability_readiness_receipts(
      app_id,tenant_id,environment,receipt_id,capability,status,reason_code,receipt_hash,
      receipt_json,evaluated_at,valid_until
    ) values (
      authority.app_id,authority.tenant_id,authority.environment,receipt_id,revision.kind,status,reason,
      receipt_document->>'receipt_hash',receipt_document,evaluated_at,valid_until
    );
    receipts:=receipts||pg_catalog.jsonb_build_array(receipt_document);
  end loop;
  return receipts;
end
$function$;

create function app_data_agent.recover_expired_job_work()
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype; receipt jsonb; now_at timestamptz:=pg_catalog.clock_timestamp();
begin
  select * into strict authority from platform.current_backend_authority(true);
  select candidate.* into attempt from app_data_agent.job_attempts candidate
  join app_data_agent.jobs owned on owned.app_id=candidate.app_id and owned.tenant_id=candidate.tenant_id
    and owned.environment=candidate.environment and owned.job_id=candidate.job_id
  where candidate.app_id=authority.app_id and candidate.tenant_id=authority.tenant_id
    and candidate.environment=authority.environment and owned.principal_id=authority.principal_id
    and candidate.status in ('LEASED','RUNNING','CANCEL_REQUESTED')
    and candidate.lease_expires_at<=now_at
  order by candidate.lease_expires_at,candidate.attempt_id for update of candidate skip locked limit 1;
  if not found then return null; end if;
  select * into strict job from app_data_agent.jobs where app_id=attempt.app_id and tenant_id=attempt.tenant_id
    and environment=attempt.environment and job_id=attempt.job_id for update;
  update app_data_agent.job_attempts set status='ABANDONED',completed_at=now_at
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment and attempt_id=attempt.attempt_id;
  if job.status='CANCEL_REQUESTED' then
    receipt:=app_data_agent.commit_job_output_receipt(job,attempt,'CANCELLED','[]'::jsonb,'JOB_CANCELLED_AFTER_LEASE_EXPIRY');
    update app_data_agent.jobs set status='CANCELLED',terminal_error_code='JOB_CANCELLED_AFTER_LEASE_EXPIRY',updated_at=now_at
    where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment and job_id=job.job_id returning * into job;
    perform app_data_agent.job_append_event(job,'JOB_CANCELLED',pg_catalog.jsonb_build_object('receipt_hash',receipt->>'receipt_hash'));
  elsif job.attempt_count<job.max_attempts then
    update app_data_agent.jobs set status='RETRY_WAIT',next_attempt_at=now_at,updated_at=now_at
    where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment and job_id=job.job_id returning * into job;
    perform app_data_agent.job_append_event(job,'JOB_RETRY_SCHEDULED',pg_catalog.jsonb_build_object('error_code','JOB_WORK_LEASE_EXPIRED','retry_delay_ms',0));
  else
    receipt:=app_data_agent.commit_job_output_receipt(job,attempt,'DEAD_LETTER','[]'::jsonb,'JOB_WORK_LEASE_EXPIRED');
    update app_data_agent.jobs set status='DEAD_LETTER',terminal_error_code='JOB_WORK_LEASE_EXPIRED',updated_at=now_at
    where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment and job_id=job.job_id returning * into job;
    perform app_data_agent.job_append_event(job,'JOB_DEAD_LETTER',pg_catalog.jsonb_build_object('receipt_hash',receipt->>'receipt_hash'));
  end if;
  return app_data_agent.job_record_document(job);
end
$function$;

alter function app_data_agent.publish_job_worker_heartbeat(jsonb) owner to data_agent_u10_job_owner;
alter function app_data_agent.list_job_capability_readiness() owner to data_agent_u10_job_owner;
alter function app_data_agent.recover_expired_job_work() owner to data_agent_u10_job_owner;
