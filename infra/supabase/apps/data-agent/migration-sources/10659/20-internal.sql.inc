create function app_data_agent.reject_job_center_immutable_mutation()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  raise exception using errcode='55000',message='JOB_CENTER_AUTHORITY_IMMUTABLE';
end
$function$;
alter function app_data_agent.reject_job_center_immutable_mutation() owner to data_agent_u10_job_owner;

create trigger job_handler_revisions_immutable before update or delete on app_data_agent.job_handler_revisions
for each row execute function app_data_agent.reject_job_center_immutable_mutation();
create trigger job_events_immutable before update or delete on app_data_agent.job_events
for each row execute function app_data_agent.reject_job_center_immutable_mutation();
create trigger job_output_receipts_immutable before update or delete on app_data_agent.job_output_receipts
for each row execute function app_data_agent.reject_job_center_immutable_mutation();
create trigger job_worker_heartbeats_immutable before update or delete on app_data_agent.job_worker_heartbeats
for each row execute function app_data_agent.reject_job_center_immutable_mutation();
create trigger capability_readiness_receipts_immutable before update or delete on app_data_agent.capability_readiness_receipts
for each row execute function app_data_agent.reject_job_center_immutable_mutation();

create function app_data_agent.job_utc_millis(value timestamptz)
returns text language sql immutable strict set search_path=''
as $function$
  select pg_catalog.to_char(value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$function$;

create function app_data_agent.job_append_event(
  requested_job app_data_agent.jobs,
  requested_event_type text,
  requested_payload jsonb
)
returns void language plpgsql security definer set search_path=''
as $function$
declare
  event_id uuid := pg_catalog.gen_random_uuid();
  event_sequence bigint;
  event_time timestamptz := pg_catalog.clock_timestamp();
  event_document jsonb;
begin
  select coalesce(pg_catalog.max(sequence),0::bigint)+1 into event_sequence
  from app_data_agent.job_events
  where app_id=requested_job.app_id and tenant_id=requested_job.tenant_id
    and environment=requested_job.environment and job_id=requested_job.job_id;
  event_document := pg_catalog.jsonb_build_object(
    'schema_version','job-event@1.0.0','event_id',event_id,'job_id',requested_job.job_id,
    'sequence',event_sequence,'event_type',requested_event_type,
    'payload',requested_payload,'created_at',app_data_agent.job_utc_millis(event_time)
  );
  insert into app_data_agent.job_events(
    app_id,tenant_id,environment,job_id,event_id,sequence,event_type,event_hash,event_json,created_at
  ) values (
    requested_job.app_id,requested_job.tenant_id,requested_job.environment,requested_job.job_id,
    event_id,event_sequence,requested_event_type,app_data_agent.u2_canonical_sha256(event_document),
    event_document,event_time
  );
end
$function$;

create function app_data_agent.assert_job_active_lease(requested_lease jsonb)
returns app_data_agent.job_attempts
language plpgsql security definer set search_path=''
as $function$
declare
  authority record;
  attempt app_data_agent.job_attempts%rowtype;
  job app_data_agent.jobs%rowtype;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_lease,array[
    'schema_version','scope','principal_id','job_id','kind','request_hash','input','attempt_id',
    'attempt_no','delivery_attempt_no','worker_id','lease_token','worker_fence',
    'lease_duration_ms','expires_at','handler_revision','lease_hash'
  ]) or requested_lease->>'schema_version'<>'job-work-lease@1.0.0'
    or requested_lease->>'lease_hash'<>app_data_agent.u2_canonical_sha256(requested_lease-'lease_hash')
  then
    raise exception using errcode='22023',message='JOB_WORK_LEASE_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into attempt from app_data_agent.job_attempts
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and attempt_id=(requested_lease->>'attempt_id')::uuid
  for update;
  if not found or attempt.lease_json<>requested_lease
    or attempt.lease_expires_at<=pg_catalog.clock_timestamp()
    or attempt.status not in ('LEASED','RUNNING','CANCEL_REQUESTED')
  then
    raise exception using errcode='40001',message='JOB_WORK_LEASE_STALE';
  end if;
  select * into strict job from app_data_agent.jobs
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and job_id=attempt.job_id for update;
  if job.principal_id<>authority.principal_id
    or requested_lease->>'principal_id'<>job.principal_id::text
    or requested_lease->'scope'<>pg_catalog.jsonb_build_object(
      'app_id',job.app_id,'tenant_id',job.tenant_id,'environment',job.environment
    )
  then
    raise exception using errcode='42501',message='JOB_WORK_LEASE_SCOPE_MISMATCH';
  end if;
  return attempt;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='JOB_WORK_LEASE_INVALID';
end
$function$;

create function app_data_agent.job_record_document(requested_job app_data_agent.jobs)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare output_receipt jsonb;
begin
  select receipt_json into output_receipt from app_data_agent.job_output_receipts
  where app_id=requested_job.app_id and tenant_id=requested_job.tenant_id
    and environment=requested_job.environment and job_id=requested_job.job_id;
  return pg_catalog.jsonb_build_object(
    'schema_version','job-record@1.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id',requested_job.app_id,'tenant_id',requested_job.tenant_id,
      'environment',requested_job.environment
    ),
    'principal_id',requested_job.principal_id,'job_id',requested_job.job_id,
    'kind',requested_job.kind,'request_hash',requested_job.request_hash,'status',requested_job.status,
    'priority',requested_job.priority,'max_attempts',requested_job.max_attempts,
    'attempt_count',requested_job.attempt_count,'worker_fence',requested_job.worker_fence,
    'cancel_policy',requested_job.cancel_policy,'output_receipt',output_receipt,
    'terminal_error_code',requested_job.terminal_error_code,
    'created_at',app_data_agent.job_utc_millis(requested_job.created_at),
    'updated_at',app_data_agent.job_utc_millis(requested_job.updated_at)
  );
end
$function$;

create function app_data_agent.assert_job_artifact_references(
  requested_references jsonb,
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text
)
returns void language plpgsql security definer set search_path=''
as $function$
declare
  reference jsonb;
  reference_identity text;
  previous_identity text;
begin
  if pg_catalog.jsonb_typeof(requested_references)<>'array'
    or pg_catalog.jsonb_array_length(requested_references)>64
  then
    raise exception using errcode='22023',message='JOB_ARTIFACT_REFERENCES_INVALID';
  end if;
  for reference in select value from pg_catalog.jsonb_array_elements(requested_references) loop
    if not app_data_agent.provider_json_object_has_exact_keys(reference,array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
    ]) or reference->>'app_id'<>requested_app_id::text
      or reference->>'tenant_id'<>requested_tenant_id::text
      or reference->>'environment'<>requested_environment
      or reference->>'artifact_id'<>(reference->>'artifact_id')::uuid::text
      or reference->>'run_id'<>(reference->>'run_id')::uuid::text
      or (reference->>'revision')::integer<1
      or reference->>'content_hash'!~'^sha256:[0-9a-f]{64}$'
      or not (
        exists (
          select 1 from app_data_agent.artifacts
          where app_id=requested_app_id and tenant_id=requested_tenant_id
            and environment=requested_environment and run_id=(reference->>'run_id')::uuid
            and artifact_id=(reference->>'artifact_id')::uuid and artifact_type=reference->>'artifact_type'
            and revision=(reference->>'revision')::integer and content_hash=reference->>'content_hash'
            and is_active
        ) or exists (
          select 1 from app_data_agent.artifact_export_receipts
          where app_id=requested_app_id and tenant_id=requested_tenant_id
            and environment=requested_environment and run_id=(reference->>'run_id')::uuid
            and receipt_id=(reference->>'artifact_id')::uuid
            and reference->>'artifact_type'='ArtifactExportReceipt'
            and receipt_revision=(reference->>'revision')::integer and receipt_hash=reference->>'content_hash'
        )
      )
    then
      raise exception using errcode='23503',message='JOB_ARTIFACT_NOT_COMMITTED';
    end if;
    reference_identity:=pg_catalog.jsonb_build_array(
      reference->>'app_id',reference->>'tenant_id',reference->>'environment',reference->>'run_id',
      reference->>'artifact_id',reference->>'artifact_type',(reference->>'revision')::integer,
      reference->>'content_hash'
    )::text;
    if previous_identity is not null and previous_identity>=reference_identity then
      raise exception using errcode='22023',message=case
        when previous_identity=reference_identity then 'JOB_OUTPUT_REFERENCE_DUPLICATE'
        else 'JOB_ARTIFACT_REFERENCES_NOT_CANONICAL'
      end;
    end if;
    previous_identity:=reference_identity;
  end loop;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='JOB_ARTIFACT_REFERENCES_INVALID';
end
$function$;

create function app_data_agent.commit_job_output_receipt(
  requested_job app_data_agent.jobs,
  requested_attempt app_data_agent.job_attempts,
  requested_terminal text,
  requested_output_refs jsonb,
  requested_error_code text
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  receipt_id uuid := pg_catalog.gen_random_uuid();
  committed_at timestamptz := pg_catalog.clock_timestamp();
  receipt_document jsonb;
  receipt_hash text;
begin
  if pg_catalog.jsonb_typeof(requested_output_refs)<>'array'
    or pg_catalog.jsonb_array_length(requested_output_refs)>64
    or requested_terminal not in ('SUCCEEDED','FAILED','CANCELLED','DEAD_LETTER')
    or (requested_terminal='SUCCEEDED' and (
      requested_error_code is not null or pg_catalog.jsonb_array_length(requested_output_refs)=0
    )) or (requested_terminal<>'SUCCEEDED' and (
      requested_error_code is null or pg_catalog.jsonb_array_length(requested_output_refs)<>0
    ))
  then
    raise exception using errcode='22023',message='JOB_OUTPUT_RECEIPT_INVALID';
  end if;
  perform app_data_agent.assert_job_artifact_references(
    requested_output_refs,requested_job.app_id,requested_job.tenant_id,requested_job.environment
  );
  receipt_document := pg_catalog.jsonb_build_object(
    'schema_version','job-output-receipt@1.0.0','receipt_id',receipt_id,
    'scope',pg_catalog.jsonb_build_object(
      'app_id',requested_job.app_id,'tenant_id',requested_job.tenant_id,'environment',requested_job.environment
    ),
    'principal_id',requested_job.principal_id,'job_id',requested_job.job_id,
    'kind',requested_job.kind,'request_hash',requested_job.request_hash,
    'attempt_id',requested_attempt.attempt_id,'worker_fence',requested_attempt.worker_fence,
    'terminal',requested_terminal,'output_refs',requested_output_refs,
    'error_code',requested_error_code,'committed_at',app_data_agent.job_utc_millis(committed_at)
  );
  receipt_hash := app_data_agent.u2_canonical_sha256(receipt_document);
  receipt_document := receipt_document||pg_catalog.jsonb_build_object('receipt_hash',receipt_hash);
  insert into app_data_agent.job_output_receipts(
    app_id,tenant_id,environment,principal_id,job_id,request_hash,attempt_id,worker_fence,
    receipt_id,terminal,receipt_hash,receipt_json,committed_at
  ) values (
    requested_job.app_id,requested_job.tenant_id,requested_job.environment,requested_job.principal_id,
    requested_job.job_id,requested_job.request_hash,requested_attempt.attempt_id,requested_attempt.worker_fence,
    receipt_id,requested_terminal,receipt_hash,receipt_document,committed_at
  );
  return receipt_document;
end
$function$;

alter function app_data_agent.job_utc_millis(timestamptz) owner to data_agent_u10_job_owner;
alter function app_data_agent.job_append_event(app_data_agent.jobs,text,jsonb) owner to data_agent_u10_job_owner;
alter function app_data_agent.assert_job_active_lease(jsonb) owner to data_agent_u10_job_owner;
alter function app_data_agent.job_record_document(app_data_agent.jobs) owner to data_agent_u10_job_owner;
alter function app_data_agent.assert_job_artifact_references(jsonb,uuid,uuid,text)
  owner to data_agent_u10_job_owner;
alter function app_data_agent.commit_job_output_receipt(app_data_agent.jobs,app_data_agent.job_attempts,text,jsonb,text)
  owner to data_agent_u10_job_owner;
