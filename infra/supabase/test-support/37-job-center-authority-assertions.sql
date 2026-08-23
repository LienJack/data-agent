\set ON_ERROR_STOP on

do $assert$
declare
  table_name text;
begin
  foreach table_name in array array[
    'job_handler_revisions','jobs','job_attempts','job_events',
    'job_output_receipts','job_worker_heartbeats','capability_readiness_receipts'
  ] loop
    if pg_catalog.to_regclass('app_data_agent.' || table_name) is null then
      raise exception 'JOB_CENTER_TABLE_MISSING:%', table_name;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='app_data_agent' and c.relname=table_name
        and c.relrowsecurity and c.relforcerowsecurity
    ) then
      raise exception 'JOB_CENTER_RLS_NOT_FORCED:%', table_name;
    end if;
  end loop;

  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname='data_agent_u10_job_owner'
      and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls)
  ) then
    raise exception 'JOB_CENTER_OWNER_UNSAFE';
  end if;

  if pg_catalog.to_regprocedure('app_data_agent.enqueue_job(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.claim_job_work(text,jsonb,integer)') is null
    or pg_catalog.to_regprocedure('app_data_agent.start_job_work(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.heartbeat_job_work(jsonb,integer)') is null
    or pg_catalog.to_regprocedure('app_data_agent.succeed_job_work(jsonb,jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.fail_job_work(jsonb,text,boolean,integer)') is null
    or pg_catalog.to_regprocedure('app_data_agent.acknowledge_job_cancel(jsonb,text)') is null
    or pg_catalog.to_regprocedure('app_data_agent.request_job_cancel(uuid,text)') is null
    or pg_catalog.to_regprocedure('app_data_agent.get_job(uuid)') is null
    or pg_catalog.to_regprocedure('app_data_agent.list_jobs(uuid,integer)') is null
    or pg_catalog.to_regprocedure('app_data_agent.publish_job_worker_heartbeat(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.list_job_capability_readiness()') is null
    or pg_catalog.to_regprocedure('app_data_agent.recover_expired_job_work()') is null
    or pg_catalog.to_regprocedure('app_data_agent.assert_job_artifact_references(jsonb,uuid,uuid,text)') is null
  then
    raise exception 'JOB_CENTER_RPC_SURFACE_INCOMPLETE';
  end if;

  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.jobs','INSERT,UPDATE,DELETE')
    or pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.job_attempts','INSERT,UPDATE,DELETE')
    or pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.job_output_receipts','INSERT,UPDATE,DELETE')
  then
    raise exception 'JOB_CENTER_BACKEND_DIRECT_DML';
  end if;

  if not exists (
    select 1 from app_data_agent.job_handler_revisions
    where kind='FILE_SCAN' and handler_revision='file-scan-handler@1.0.0'
      and enabled and dependencies_ready and output_receipt_required
  ) then
    raise exception 'JOB_CENTER_FILE_SCAN_HANDLER_INVALID';
  end if;
end
$assert$;

select 'U10_JOB_CENTER_AUTHORITY_ASSERTIONS_PASSED' as result;

begin;
insert into app_data_agent.workspaces(app_id,workspace_id,environment,slug,display_name)
values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005901',
  'local','u10-job-center-smoke','U10 Job Center smoke'
);
insert into app_data_agent.memberships(
  app_id,tenant_id,environment,principal_id,membership_role,workspace_role,membership_source
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005901',
  'local','00000000-0000-4000-8000-000000005902','owner','WORKSPACE_ADMIN','EXPLICIT'
);
insert into data_agent_auth."user"("id","name","email","emailVerified","username","displayUsername")
values (
  '00000000-0000-4000-8000-000000005902','U10 fixture user',
  'u10-fixture@example.invalid',true,'u10_fixture','u10_fixture'
);
insert into app_data_agent.app_users(
  app_id,environment,principal_id,auth_user_id,email,display_name,system_role
) values (
  '00000000-0000-4000-8000-00000000da01','local',
  '00000000-0000-4000-8000-000000005902','00000000-0000-4000-8000-000000005902',
  'u10-fixture@example.invalid','U10 fixture user','USER'
);
create role data_agent_u10_behavior_session login inherit;
grant data_agent_backend to data_agent_u10_behavior_session with inherit true;
grant execute on function app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.job_utc_millis(timestamptz)
to data_agent_u10_behavior_session;
set session authorization data_agent_u10_behavior_session;
select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-000000005901',true);
select pg_catalog.set_config('data_agent.environment','local',true);
select pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-000000000001',true);
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-000000005902',true);
select pg_catalog.set_config('data_agent.role','owner',true);

do $behavior$
declare
  scope jsonb:=pg_catalog.jsonb_build_object(
    'app_id','00000000-0000-4000-8000-00000000da01',
    'tenant_id','00000000-0000-4000-8000-000000005901','environment','local'
  );
  command jsonb;
  receipt jsonb;
  replay jsonb;
  heartbeat jsonb;
  lease jsonb;
  terminal jsonb;
  record jsonb;
  readiness jsonb;
  invalid_command jsonb;
  invalid_reference_rejected boolean:=false;
  stale_lease_rejected boolean:=false;
  secondary_command jsonb;
  secondary_receipt jsonb;
begin
  command:=pg_catalog.jsonb_build_object(
    'schema_version','job-submit@1.0.0','scope',scope,'kind','ARTIFACT_EXPORT',
    'idempotency_key','u10-artifact-export-0001',
    'input',pg_catalog.jsonb_build_object(
      'schema_version','job-input@1.0.0','kind','ARTIFACT_EXPORT',
      'resource_refs','[]'::jsonb,
      'parameters',pg_catalog.jsonb_build_object('fixture','hash-only')
    ),
    'priority',50,'max_attempts',1,'cancel_policy','COOPERATIVE'
  );
  command:=command||pg_catalog.jsonb_build_object(
    'request_hash',app_data_agent.u2_canonical_sha256(command)
  );
  invalid_command:=pg_catalog.jsonb_set(
    command-'request_hash','{input,resource_refs}',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'artifact_id','00000000-0000-4000-8000-000000005909',
        'artifact_type','ArtifactWorkspaceDocument',
        'app_id','00000000-0000-4000-8000-00000000da01',
        'tenant_id','00000000-0000-4000-8000-000000005901','environment','local',
        'run_id','00000000-0000-4000-8000-000000005908','revision',1,
        'content_hash','sha256:0000000000000000000000000000000000000000000000000000000000000000'
      )
    )
  );
  invalid_command:=invalid_command||pg_catalog.jsonb_build_object(
    'request_hash',app_data_agent.u2_canonical_sha256(invalid_command)
  );
  begin
    perform app_data_agent.enqueue_job(invalid_command);
  exception when foreign_key_violation then
    invalid_reference_rejected:=sqlerrm='JOB_ARTIFACT_NOT_COMMITTED';
  end;
  if not invalid_reference_rejected then
    raise exception 'JOB_CENTER_UNCOMMITTED_INPUT_REFERENCE_ACCEPTED';
  end if;
  receipt:=app_data_agent.enqueue_job(command);
  if receipt->>'disposition'<>'CREATED'
    or receipt->>'receipt_hash'<>app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
  then raise exception 'JOB_CENTER_SUBMISSION_RECEIPT_INVALID'; end if;
  replay:=app_data_agent.enqueue_job(command);
  if replay->>'disposition'<>'REPLAYED' or replay->>'job_id'<>receipt->>'job_id'
    or replay->>'receipt_hash'<>app_data_agent.u2_canonical_sha256(replay-'receipt_hash')
  then raise exception 'JOB_CENTER_SUBMISSION_REPLAY_INVALID'; end if;

  heartbeat:=pg_catalog.jsonb_build_object(
    'schema_version','job-worker-heartbeat@1.0.0',
    'heartbeat_id','00000000-0000-4000-8000-000000005903','scope',scope,
    'worker_id','u10-job-worker-1',
    'handlers',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'kind','ARTIFACT_EXPORT','handler_revision','artifact-export-handler@1.0.0'
    )),
    'capacity',1,'observed_at',app_data_agent.job_utc_millis(pg_catalog.clock_timestamp()),
    'expires_at',app_data_agent.job_utc_millis(pg_catalog.clock_timestamp()+interval '2 minutes')
  );
  heartbeat:=heartbeat||pg_catalog.jsonb_build_object(
    'heartbeat_hash',app_data_agent.u2_canonical_sha256(heartbeat)
  );
  perform app_data_agent.publish_job_worker_heartbeat(heartbeat);
  lease:=app_data_agent.claim_job_work(
    'u10-job-worker-1',heartbeat->'handlers',30000
  );
  if lease is null or lease->>'lease_hash'<>app_data_agent.u2_canonical_sha256(lease-'lease_hash')
  then raise exception 'JOB_CENTER_LEASE_INVALID'; end if;
  if not (app_data_agent.start_job_work(lease)->>'started')::boolean then
    raise exception 'JOB_CENTER_START_INVALID';
  end if;
  terminal:=app_data_agent.fail_job_work(lease,'JOB_FIXTURE_FAILURE',true,1000);
  if terminal->>'terminal'<>'DEAD_LETTER'
    or terminal->>'receipt_hash'<>app_data_agent.u2_canonical_sha256(terminal-'receipt_hash')
  then raise exception 'JOB_CENTER_TERMINAL_INVALID'; end if;
  record:=app_data_agent.get_job((receipt->>'job_id')::uuid);
  if record->>'status'<>'DEAD_LETTER' or record->'output_receipt'<>terminal then
    raise exception 'JOB_CENTER_RECORD_INVALID';
  end if;
  begin
    perform app_data_agent.heartbeat_job_work(lease,30000);
  exception when serialization_failure then
    stale_lease_rejected:=sqlerrm='JOB_WORK_LEASE_STALE';
  end;
  if not stale_lease_rejected then raise exception 'JOB_CENTER_STALE_LEASE_ACCEPTED'; end if;

  secondary_command:=pg_catalog.jsonb_set(
    command-'request_hash','{idempotency_key}',pg_catalog.to_jsonb('u10-cancel-queued-0002'::text)
  );
  secondary_command:=secondary_command||pg_catalog.jsonb_build_object(
    'request_hash',app_data_agent.u2_canonical_sha256(secondary_command)
  );
  secondary_receipt:=app_data_agent.enqueue_job(secondary_command);
  record:=app_data_agent.request_job_cancel(
    (secondary_receipt->>'job_id')::uuid,'u10-cancel-command-0002'
  );
  if record->>'status'<>'CANCELLED' then raise exception 'JOB_CENTER_QUEUED_CANCEL_INVALID'; end if;

  secondary_command:=pg_catalog.jsonb_set(
    command-'request_hash','{idempotency_key}',pg_catalog.to_jsonb('u10-recover-expired-0003'::text)
  );
  secondary_command:=secondary_command||pg_catalog.jsonb_build_object(
    'request_hash',app_data_agent.u2_canonical_sha256(secondary_command)
  );
  secondary_receipt:=app_data_agent.enqueue_job(secondary_command);
  lease:=app_data_agent.claim_job_work('u10-job-worker-1',heartbeat->'handlers',30000);
  if lease->>'job_id'<>secondary_receipt->>'job_id'
    or not (app_data_agent.start_job_work(lease)->>'started')::boolean
  then raise exception 'JOB_CENTER_RECOVERY_FIXTURE_INVALID'; end if;
  perform pg_catalog.set_config('u10.recovery_attempt_id',lease->>'attempt_id',true);
  perform pg_catalog.set_config('u10.recovery_job_id',lease->>'job_id',true);

  readiness:=app_data_agent.list_job_capability_readiness();
  if not exists (
    select 1 from pg_catalog.jsonb_array_elements(readiness) item
    where item->>'capability'='ARTIFACT_EXPORT' and item->>'status'='NOT_READY'
      and item->>'reason_code'='OUTPUT_RECEIPT_REQUIRED'
      and item->>'receipt_hash'=app_data_agent.u2_canonical_sha256(item-'receipt_hash')
  ) or exists (
    select 1 from pg_catalog.jsonb_array_elements(readiness) item
    where item->>'status'='READY'
  ) then raise exception 'JOB_CENTER_READINESS_CLOSURE_INVALID'; end if;
end
$behavior$;

reset session authorization;
update app_data_agent.job_attempts set lease_expires_at=pg_catalog.clock_timestamp()-interval '1 second'
where attempt_id=pg_catalog.current_setting('u10.recovery_attempt_id')::uuid;
set session authorization data_agent_u10_behavior_session;
do $recovery$
declare recovered jsonb;
begin
  recovered:=app_data_agent.recover_expired_job_work();
  if recovered->>'job_id'<>pg_catalog.current_setting('u10.recovery_job_id')
    or recovered->>'status'<>'DEAD_LETTER'
    or recovered->'output_receipt'->>'error_code'<>'JOB_WORK_LEASE_EXPIRED'
  then raise exception 'JOB_CENTER_EXPIRED_LEASE_RECOVERY_INVALID'; end if;
end
$recovery$;
reset session authorization;
rollback;

select 'U10_JOB_CENTER_BEHAVIOR_ASSERTIONS_PASSED' as result;
