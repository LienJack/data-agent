create or replace function app_data_agent.claim_job_work(
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
    or pg_catalog.jsonb_array_length(requested_handlers) not between 1 and 8
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
create or replace function app_data_agent.publish_job_worker_heartbeat(requested_heartbeat jsonb)
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
    or pg_catalog.jsonb_array_length(requested_heartbeat->'handlers') not between 1 and 8
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
  select * into existing from app_data_agent.job_worker_heartbeats heartbeat
  where heartbeat.app_id=authority.app_id and heartbeat.tenant_id=authority.tenant_id
    and heartbeat.environment=authority.environment
    and heartbeat.heartbeat_id=(requested_heartbeat->>'heartbeat_id')::uuid;
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
