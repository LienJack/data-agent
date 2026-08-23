\set ON_ERROR_STOP on

do $catalog$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u8_recovery_owner'
    and not rolcanlogin and not rolsuper and not rolinherit and not rolbypassrls)
  then raise exception 'U8 recovery owner flags unsafe'; end if;
  if (select pg_catalog.count(*) from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace
    on namespace.oid=relation.relnamespace where namespace.nspname='app_data_agent'
      and relation.relname in ('run_interruptions','run_interruption_replies','session_branches',
        'session_recovery_operation_receipts') and relation.relrowsecurity and relation.relforcerowsecurity
      and relation.relowner=(select oid from pg_catalog.pg_roles where rolname='data_agent_u8_recovery_owner'))<>4
  then raise exception 'U8 recovery relation closure unsafe'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.run_interruptions','SELECT,INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.open_run_interruption(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.reply_run_interruption(jsonb)','EXECUTE')
  then raise exception 'U8 direct DML or RPC grant unsafe'; end if;
end
$catalog$;

begin;
insert into app_data_agent.runs(app_id,tenant_id,environment,run_id,principal_id,status,
  active_fence,question,next_queue_sequence,created_at,updated_at)
values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa22',
  'test','00000000-0000-4000-8000-000000008801','00000000-0000-4000-8000-000000001003',
  'WAITING',3,'U8 durable clarification fixture',2,'2026-08-17T12:00:00Z','2026-08-17T12:00:00Z');
insert into app_data_agent.commands(app_id,tenant_id,environment,command_id,run_id,principal_id,
  idempotency_key,payload_json,payload_hash,status,created_at)
values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa22','test',
  '00000000-0000-4000-8000-000000008802','00000000-0000-4000-8000-000000008801',
  '00000000-0000-4000-8000-000000001003','u8-fixture-start',
  '{"kind":"START_L2_RESEARCH","mode":"L2"}'::jsonb,
  platform.canonical_sha256('{"kind":"START_L2_RESEARCH","mode":"L2"}'::jsonb),
  'SUCCEEDED','2026-08-17T12:00:00Z');
insert into app_data_agent.outbox(app_id,tenant_id,environment,outbox_id,run_id,command_id,topic,
  payload_json,status,attempt_count,available_at,lease_token,run_fence,published_at,created_at,queue_sequence)
values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa22','test',
  '00000000-0000-4000-8000-000000008803','00000000-0000-4000-8000-000000008801',
  '00000000-0000-4000-8000-000000008802','run.command.accepted','{"fixture":"u8"}',
  'PUBLISHED',1,'2026-08-17T12:00:00Z',1,3,'2026-08-17T12:00:00Z','2026-08-17T12:00:00Z',1);
insert into app_data_agent.run_attempts(app_id,tenant_id,environment,run_id,outbox_id,command_id,
  attempt_id,attempt_no,worker_id,lease_token,worker_fence,status,lease_expires_at,
  last_heartbeat_at,started_at,finished_at)
values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa22','test',
  '00000000-0000-4000-8000-000000008801','00000000-0000-4000-8000-000000008803',
  '00000000-0000-4000-8000-000000008802','00000000-0000-4000-8000-000000008804',1,
  'u8-worker',1,3,'SUSPENDED','2026-08-17T12:10:00Z','2026-08-17T12:00:00Z',
  '2026-08-17T12:00:00Z','2026-08-17T12:00:01Z');

do $fixture$
declare scope_document jsonb:=pg_catalog.jsonb_build_object('app_id','00000000-0000-4000-8000-00000000da01',
  'tenant_id','00000000-0000-4000-8000-00000000aa22','environment','test');
  checkpoint_ref jsonb:=pg_catalog.jsonb_build_object('snapshot_id','00000000-0000-4000-8000-000000008805',
    'snapshot_version',1,'snapshot_hash','sha256:1111111111111111111111111111111111111111111111111111111111111111');
  event_document jsonb; projection_document jsonb;
begin
  event_document:=pg_catalog.jsonb_build_object('schema_version','1.0.0',
    'event_id','00000000-0000-4000-8000-000000008806','scope',scope_document,
    'run_id','00000000-0000-4000-8000-000000008801','sequence',3,'worker_fence',3,
    'idempotency_key','u8-fixture-suspended','occurred_at','2026-08-17T12:00:01.000Z',
    'event_type','run.suspended','payload',pg_catalog.jsonb_build_object(
      'reason_code','WAITING_FOR_CLARIFICATION','snapshot_id','00000000-0000-4000-8000-000000008805',
      'interruption_id','00000000-0000-4000-8000-000000008807','interruption_version',1));
  insert into app_data_agent.run_events(app_id,tenant_id,environment,event_id,run_id,sequence,event_type,
    payload_json,attempt_id,command_id,dedupe_key,event_hash,worker_fence,event_document,created_at)
  values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa22','test',
    '00000000-0000-4000-8000-000000008806','00000000-0000-4000-8000-000000008801',3,
    'run.suspended',event_document->'payload','00000000-0000-4000-8000-000000008804',
    '00000000-0000-4000-8000-000000008802','u8-fixture-suspended',
    app_data_agent.runtime_canonical_sha256(event_document),3,event_document,'2026-08-17T12:00:01Z');
  projection_document:=pg_catalog.jsonb_build_object('schema_version','1.0.0','scope',scope_document,
    'run_id','00000000-0000-4000-8000-000000008801','status','WAITING','version',3,
    'worker_fence',3,'attempt_count',1,'last_event_id','00000000-0000-4000-8000-000000008806',
    'last_occurred_at','2026-08-17T12:00:01.000Z','active_artifact_ref',null,
    'active_snapshot_ref',checkpoint_ref,'last_side_effect_receipt_id',null,'terminal_event_id',null);
  insert into app_data_agent.run_projections(app_id,tenant_id,environment,run_id,version,status,
    worker_fence,event_id,projection_hash,projection_json,occurred_at)
  values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa22','test',
    '00000000-0000-4000-8000-000000008801',3,'WAITING',3,
    '00000000-0000-4000-8000-000000008806',app_data_agent.runtime_canonical_sha256(projection_document),
    projection_document,'2026-08-17T12:00:01Z');
  insert into app_data_agent.run_checkpoints(app_id,tenant_id,environment,run_id,attempt_id,
    snapshot_id,snapshot_version,snapshot_hash,event_sequence,worker_fence,binding_json,created_at)
  values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa22','test',
    '00000000-0000-4000-8000-000000008801','00000000-0000-4000-8000-000000008804',
    '00000000-0000-4000-8000-000000008805',1,
    'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    2,3,'{"fixture":"u8-checkpoint"}'::jsonb,'2026-08-17T12:00:00Z');
end
$fixture$;

set local role data_agent_backend;
select * from platform.revalidate_backend_authority(
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa22','test',
  '00000000-0000-4000-8000-00000000de01','00000000-0000-4000-8000-000000001003','owner',1,1,true);
select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-00000000aa22',true);
select pg_catalog.set_config('data_agent.environment','test',true);
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-000000001003',true);
select pg_catalog.set_config('data_agent.role','owner',true);
select pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',true);

set local role data_agent_u8_recovery_owner;
do $vectors$
declare scope_document jsonb:=pg_catalog.jsonb_build_object('app_id','00000000-0000-4000-8000-00000000da01',
  'tenant_id','00000000-0000-4000-8000-00000000aa22','environment','test');
  interruption jsonb; open_command jsonb; reply_command jsonb; open_result jsonb; reply_result jsonb; replay jsonb;
begin
  interruption:=pg_catalog.jsonb_build_object('schema_version','run-interruption@1.0.0','scope',scope_document,
    'interruption_id','00000000-0000-4000-8000-000000008807','run_id','00000000-0000-4000-8000-000000008801',
    'kind','CLARIFICATION','question','Which revenue definition?','options',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('option_id','booked','label','Booked revenue')),
    'checkpoint_ref',pg_catalog.jsonb_build_object('snapshot_id','00000000-0000-4000-8000-000000008805',
      'snapshot_version',1,'snapshot_hash','sha256:1111111111111111111111111111111111111111111111111111111111111111'),
    'worker_fence',3,'state','OPEN','version',1,'opened_at','2026-08-17T12:00:01.000Z','answered_at',null);
  interruption:=interruption||pg_catalog.jsonb_build_object(
    'interruption_hash',app_data_agent.u2_canonical_sha256(interruption));
  open_command:=pg_catalog.jsonb_build_object('schema_version','run-interruption-open-command@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000008808','idempotency_key','u8:open:1',
    'actor_principal_id','00000000-0000-4000-8000-000000001003','interruption',interruption);
  open_command:=open_command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(open_command));
  open_result:=app_data_agent.open_run_interruption(open_command);
  reply_command:=pg_catalog.jsonb_build_object('schema_version','interruption-reply-command@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000008809','idempotency_key','u8:reply:1',
    'scope',scope_document,'run_id','00000000-0000-4000-8000-000000008801',
    'interruption_id','00000000-0000-4000-8000-000000008807','expected_version',1,
    'expected_worker_fence',3,'actor_principal_id','00000000-0000-4000-8000-000000001003',
    'response',pg_catalog.jsonb_build_object('kind','OPTION','option_id','booked'),
    'submitted_at','2026-08-17T12:00:02.000Z');
  reply_command:=reply_command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(reply_command));
  reply_result:=app_data_agent.reply_run_interruption(reply_command);
  replay:=app_data_agent.reply_run_interruption(reply_command);
  if open_result->>'disposition'<>'COMMITTED' or reply_result->>'disposition'<>'COMMITTED'
    or replay->>'disposition'<>'REPLAYED' or reply_result#>>'{interruption,state}'<>'ANSWERED'
    or reply_result#>>'{resume,projection_version}'<>'4'
    or (select status from app_data_agent.runs where run_id='00000000-0000-4000-8000-000000008801')<>'QUEUED'
    or (select pg_catalog.count(*) from app_data_agent.run_interruption_replies
      where run_id='00000000-0000-4000-8000-000000008801')<>1
  then raise exception 'U8 interruption reply/resume/replay vector failed'; end if;
  begin
    perform app_data_agent.reply_run_interruption((reply_command-'operation_id'-'idempotency_key'-'command_hash')
      ||pg_catalog.jsonb_build_object('operation_id','00000000-0000-4000-8000-000000008810',
        'idempotency_key','u8:reply:stale','command_hash',app_data_agent.u2_canonical_sha256(
          (reply_command-'operation_id'-'idempotency_key'-'command_hash')||pg_catalog.jsonb_build_object(
            'operation_id','00000000-0000-4000-8000-000000008810','idempotency_key','u8:reply:stale'))));
    raise exception 'U8 stale reply unexpectedly accepted';
  exception when sqlstate '40001' then
    if sqlerrm<>'INTERRUPTION_REPLY_VERSION_CONFLICT' then raise; end if;
  end;
end
$vectors$;
rollback;

select 'U8_SESSION_RECOVERY_ASSERTIONS_PASSED' as result;
