-- job_center_migration_checksum: sha256:9e5b23f984303910208c35efb48f9c631f332d3cfd4538961ba25b19176640e3
-- ============================================================
-- 10659: Governed Job Center Authority
-- Six bounded background-job kinds; no Run-table reuse or data import.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='JOB_CENTER_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode='42501',message='JOB_CENTER_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger
    where owner_kind='app'
      and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010658_app_data_agent_agent_team_authority'
  ) then
    raise exception using errcode='P0001',message='JOB_CENTER_BASELINE_10658_MISSING';
  end if;
  if pg_catalog.to_regprocedure('app_data_agent.u2_canonical_sha256(jsonb)') is null
    or pg_catalog.to_regprocedure('platform.current_backend_authority(boolean)') is null
  then
    raise exception using errcode='P0001',message='JOB_CENTER_AUTHORITY_PREREQUISITE_MISSING';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname='data_agent_u10_job_owner') then
    create role data_agent_u10_job_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create table app_data_agent.job_handler_revisions (
  kind text not null check (kind in (
    'SCHEMA_SCAN','RELATIONSHIP_INDEX','ARTIFACT_EXPORT',
    'SEMANTIC_INDUCTION','METRIC_IMPORT','DATALINK_REBUILD'
  )),
  handler_revision text not null check (handler_revision ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'),
  enabled boolean not null,
  dependencies_ready boolean not null,
  output_receipt_required boolean not null,
  registered_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (kind,handler_revision)
);

insert into app_data_agent.job_handler_revisions(
  kind,handler_revision,enabled,dependencies_ready,output_receipt_required
) values
  ('SCHEMA_SCAN','schema-scan-handler@1.0.0',false,false,true),
  ('RELATIONSHIP_INDEX','relationship-index-handler@1.0.0',false,false,true),
  ('ARTIFACT_EXPORT','artifact-export-handler@1.0.0',true,true,true),
  ('SEMANTIC_INDUCTION','semantic-induction-handler@1.0.0',false,false,true),
  ('METRIC_IMPORT','metric-import-handler@1.0.0',false,false,true),
  ('DATALINK_REBUILD','datalink-rebuild-handler@1.0.0',false,false,true);

create table app_data_agent.jobs (
  app_id uuid not null check (app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  principal_id uuid not null,
  job_id uuid not null,
  kind text not null,
  handler_revision text not null,
  idempotency_key text not null check (
    length(idempotency_key) between 8 and 128
    and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
  ),
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  input_json jsonb not null check (
    pg_catalog.jsonb_typeof(input_json)='object'
    and not app_data_agent.contains_potential_plaintext_secret(input_json)
  ),
  priority integer not null check (priority between 0 and 100),
  max_attempts integer not null check (max_attempts between 1 and 10),
  attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  worker_fence bigint not null default 0 check (worker_fence between 0 and 9007199254740991),
  cancel_policy text not null check (cancel_policy in ('COOPERATIVE','NOT_SUPPORTED')),
  status text not null check (status in (
    'QUEUED','LEASED','RUNNING','CANCEL_REQUESTED','RETRY_WAIT',
    'SUCCEEDED','FAILED','CANCELLED','DEAD_LETTER'
  )),
  next_attempt_at timestamptz,
  terminal_error_code text,
  submission_receipt_hash text not null check (submission_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  submission_receipt_json jsonb not null check (
    pg_catalog.jsonb_typeof(submission_receipt_json)='object'
    and not app_data_agent.contains_potential_plaintext_secret(submission_receipt_json)
  ),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (app_id,tenant_id,environment,job_id),
  unique (app_id,tenant_id,environment,principal_id,idempotency_key),
  unique (app_id,tenant_id,environment,job_id,request_hash),
  foreign key (kind,handler_revision) references app_data_agent.job_handler_revisions(kind,handler_revision),
  check (kind in (
    'SCHEMA_SCAN','RELATIONSHIP_INDEX','ARTIFACT_EXPORT',
    'SEMANTIC_INDUCTION','METRIC_IMPORT','DATALINK_REBUILD'
  ))
);

create index jobs_claim_order_idx on app_data_agent.jobs(
  app_id,tenant_id,environment,status,priority desc,next_attempt_at,created_at
);

create table app_data_agent.job_attempts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  job_id uuid not null,
  request_hash text not null,
  attempt_id uuid not null,
  attempt_no integer not null check (attempt_no between 1 and 10),
  delivery_attempt_no integer not null check (delivery_attempt_no between 1 and 100),
  worker_id text not null check (worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'),
  lease_token bigint not null check (lease_token between 1 and 9007199254740991),
  worker_fence bigint not null check (worker_fence between 1 and 9007199254740991),
  handler_revision text not null,
  lease_hash text not null check (lease_hash ~ '^sha256:[0-9a-f]{64}$'),
  lease_json jsonb not null check (pg_catalog.jsonb_typeof(lease_json)='object'),
  status text not null check (status in ('LEASED','RUNNING','CANCEL_REQUESTED','COMPLETED','ABANDONED')),
  lease_expires_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,attempt_id),
  unique (app_id,tenant_id,environment,job_id,attempt_no),
  unique (app_id,tenant_id,environment,job_id,worker_fence),
  foreign key (app_id,tenant_id,environment,job_id,request_hash)
    references app_data_agent.jobs(app_id,tenant_id,environment,job_id,request_hash)
);

create table app_data_agent.job_events (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  job_id uuid not null,
  event_id uuid not null,
  sequence bigint not null check (sequence>=1),
  event_type text not null check (event_type in (
    'JOB_QUEUED','JOB_LEASED','JOB_STARTED','JOB_HEARTBEAT','JOB_RETRY_SCHEDULED',
    'JOB_CANCEL_REQUESTED','JOB_SUCCEEDED','JOB_FAILED','JOB_CANCELLED','JOB_DEAD_LETTER'
  )),
  event_hash text not null check (event_hash ~ '^sha256:[0-9a-f]{64}$'),
  event_json jsonb not null check (not app_data_agent.contains_potential_plaintext_secret(event_json)),
  created_at timestamptz not null,
  primary key (app_id,tenant_id,environment,event_id),
  unique (app_id,tenant_id,environment,job_id,sequence),
  foreign key (app_id,tenant_id,environment,job_id)
    references app_data_agent.jobs(app_id,tenant_id,environment,job_id)
);

create table app_data_agent.job_output_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  principal_id uuid not null,
  job_id uuid not null,
  request_hash text not null,
  attempt_id uuid not null,
  worker_fence bigint not null,
  receipt_id uuid not null,
  terminal text not null check (terminal in ('SUCCEEDED','FAILED','CANCELLED','DEAD_LETTER')),
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null check (not app_data_agent.contains_potential_plaintext_secret(receipt_json)),
  committed_at timestamptz not null,
  primary key (app_id,tenant_id,environment,receipt_id),
  unique (app_id,tenant_id,environment,job_id),
  foreign key (app_id,tenant_id,environment,job_id,request_hash)
    references app_data_agent.jobs(app_id,tenant_id,environment,job_id,request_hash),
  foreign key (app_id,tenant_id,environment,attempt_id)
    references app_data_agent.job_attempts(app_id,tenant_id,environment,attempt_id)
);

create table app_data_agent.job_worker_heartbeats (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  heartbeat_id uuid not null,
  worker_id text not null,
  handler_kinds text[] not null,
  handlers_json jsonb not null,
  capacity integer not null check (capacity between 1 and 64),
  heartbeat_hash text not null check (heartbeat_hash ~ '^sha256:[0-9a-f]{64}$'),
  heartbeat_json jsonb not null check (not app_data_agent.contains_potential_plaintext_secret(heartbeat_json)),
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (app_id,tenant_id,environment,heartbeat_id),
  unique (app_id,tenant_id,environment,worker_id,heartbeat_id),
  check (expires_at>observed_at)
);

create table app_data_agent.capability_readiness_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  receipt_id uuid not null,
  capability text not null,
  status text not null check (status in ('READY','NOT_READY','DEGRADED')),
  reason_code text not null check (reason_code in (
    'CAPABILITY_READY','HANDLER_NOT_REGISTERED','HANDLER_REVISION_MISMATCH',
    'WORKER_HEARTBEAT_STALE','DEPENDENCY_UNAVAILABLE','OUTPUT_RECEIPT_REQUIRED'
  )),
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null check (not app_data_agent.contains_potential_plaintext_secret(receipt_json)),
  evaluated_at timestamptz not null,
  valid_until timestamptz not null,
  primary key (app_id,tenant_id,environment,receipt_id),
  check (valid_until>evaluated_at)
);

do $rls$
declare relation_name text;
begin
  foreach relation_name in array array[
    'job_handler_revisions','jobs','job_attempts','job_events','job_output_receipts',
    'job_worker_heartbeats','capability_readiness_receipts'
  ] loop
    execute pg_catalog.format('alter table app_data_agent.%I enable row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I force row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I owner to data_agent_u10_job_owner',relation_name);
  end loop;
end
$rls$;

create policy job_handler_revisions_owner_all on app_data_agent.job_handler_revisions
  for all to data_agent_u10_job_owner using (true) with check (true);
create policy jobs_owner_all on app_data_agent.jobs for all to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy job_attempts_owner_all on app_data_agent.job_attempts for all to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy job_events_owner_all on app_data_agent.job_events for all to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy job_output_receipts_owner_all on app_data_agent.job_output_receipts for all to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy job_worker_heartbeats_owner_all on app_data_agent.job_worker_heartbeats for all to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy capability_readiness_receipts_owner_all on app_data_agent.capability_readiness_receipts
  for all to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));
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
grant usage on schema app_data_agent,platform to data_agent_u10_job_owner;
grant select on app_data_agent.artifacts,app_data_agent.artifact_export_receipts
  to data_agent_u10_job_owner;
grant execute on function
  platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.provider_json_object_has_exact_keys(jsonb,text[]),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text)
to data_agent_u10_job_owner;

create policy artifacts_u10_job_output_select on app_data_agent.artifacts
  as permissive for select to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy artifact_export_receipts_u10_job_output_select on app_data_agent.artifact_export_receipts
  as permissive for select to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));

revoke all on app_data_agent.job_handler_revisions,app_data_agent.jobs,
  app_data_agent.job_attempts,app_data_agent.job_events,app_data_agent.job_output_receipts,
  app_data_agent.job_worker_heartbeats,app_data_agent.capability_readiness_receipts
from public,anon,authenticated,service_role,data_agent_backend;

revoke all on function
  app_data_agent.reject_job_center_immutable_mutation(),
  app_data_agent.job_utc_millis(timestamptz),
  app_data_agent.job_append_event(app_data_agent.jobs,text,jsonb),
  app_data_agent.assert_job_active_lease(jsonb),
  app_data_agent.job_record_document(app_data_agent.jobs),
  app_data_agent.commit_job_output_receipt(app_data_agent.jobs,app_data_agent.job_attempts,text,jsonb,text),
  app_data_agent.enqueue_job(jsonb),
  app_data_agent.claim_job_work(text,jsonb,integer),
  app_data_agent.start_job_work(jsonb),
  app_data_agent.heartbeat_job_work(jsonb,integer),
  app_data_agent.succeed_job_work(jsonb,jsonb),
  app_data_agent.fail_job_work(jsonb,text,boolean,integer),
  app_data_agent.acknowledge_job_cancel(jsonb,text),
  app_data_agent.request_job_cancel(uuid,text),
  app_data_agent.get_job(uuid),
  app_data_agent.list_jobs(uuid,integer),
  app_data_agent.publish_job_worker_heartbeat(jsonb),
  app_data_agent.list_job_capability_readiness(),
  app_data_agent.recover_expired_job_work()
from public,anon,authenticated,service_role,data_agent_backend;

grant execute on function
  app_data_agent.enqueue_job(jsonb),
  app_data_agent.claim_job_work(text,jsonb,integer),
  app_data_agent.start_job_work(jsonb),
  app_data_agent.heartbeat_job_work(jsonb,integer),
  app_data_agent.succeed_job_work(jsonb,jsonb),
  app_data_agent.fail_job_work(jsonb,text,boolean,integer),
  app_data_agent.acknowledge_job_cancel(jsonb,text),
  app_data_agent.request_job_cancel(uuid,text),
  app_data_agent.get_job(uuid),
  app_data_agent.list_jobs(uuid,integer),
  app_data_agent.publish_job_worker_heartbeat(jsonb),
  app_data_agent.list_job_capability_readiness(),
  app_data_agent.recover_expired_job_work()
to data_agent_backend;

do $postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'job_handler_revisions','jobs','job_attempts','job_events','job_output_receipts',
    'job_worker_heartbeats','capability_readiness_receipts'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='app_data_agent' and relation.relname=relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity
        and relation.relowner=(select oid from pg_catalog.pg_roles where rolname='data_agent_u10_job_owner')
    ) then raise exception using errcode='P0001',message='JOB_CENTER_FORCE_RLS_OR_OWNER_MISSING'; end if;
  end loop;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname='data_agent_u10_job_owner'
      and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolinherit and not rolbypassrls
  ) or pg_catalog.pg_has_role('data_agent_u10_job_owner','data_agent_backend','MEMBER')
  then raise exception using errcode='P0001',message='JOB_CENTER_OWNER_FLAGS_UNSAFE'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.jobs','INSERT,UPDATE,DELETE')
    or pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.job_attempts','INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.enqueue_job(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.claim_job_work(text,jsonb,integer)','EXECUTE')
    or pg_catalog.has_function_privilege('anon','app_data_agent.get_job(uuid)','EXECUTE')
    or pg_catalog.has_function_privilege('authenticated','app_data_agent.list_job_capability_readiness()','EXECUTE')
  then raise exception using errcode='P0001',message='JOB_CENTER_GRANT_POSTCONDITION_FAILED'; end if;
  if exists (select 1 from app_data_agent.job_handler_revisions where kind='FILE_SCAN') then
    raise exception using errcode='P0001',message='JOB_CENTER_FILE_SCAN_FORBIDDEN';
  end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010659_app_data_agent_job_center',
  'sha256:9e5b23f984303910208c35efb48f9c631f332d3cfd4538961ba25b19176640e3'
);

commit;
