\set ON_ERROR_STOP on

do $catalog$
begin
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010671_app_data_agent_public_agent_events')
    or pg_catalog.has_function_privilege('authenticated',
      'app_data_agent.public_run_v2_payload_is_valid(text,jsonb,jsonb,uuid)','EXECUTE')
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.append_run_event(jsonb,jsonb,text,text,jsonb,text)'::regprocedure),
      'run-runtime-event@2.0.0')=0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.reduce_run_projection_document(jsonb,jsonb)'::regprocedure),
      'run.agent_status')=0
  then raise exception 'Public Agent event catalog contract missing'; end if;

  if not app_data_agent.public_run_v2_payload_is_valid(
      'run.agent_status',
      '{"profile_id":"governed-text2sql-agent","task_id":"00000000-0000-4000-8000-000000000801","status":"RUNNING","phase":"compile.query","title":"Text2SQL","summary":"compiling","duration_ms":null,"error_code":null}'::jsonb,
      '{"app_id":"00000000-0000-4000-8000-00000000da01","tenant_id":"00000000-0000-4000-8000-00000000aa22","environment":"test"}'::jsonb,
      '00000000-0000-4000-8000-000000000871'::uuid)
    or app_data_agent.public_run_v2_payload_is_valid(
      'run.agent_status',
      '{"profile_id":"governed-text2sql-agent","task_id":"00000000-0000-4000-8000-000000000801","status":"RUNNING","phase":"compile.query","title":"Text2SQL","summary":"compiling","duration_ms":null,"error_code":null,"private_prompt":"hidden"}'::jsonb,
      '{"app_id":"00000000-0000-4000-8000-00000000da01","tenant_id":"00000000-0000-4000-8000-00000000aa22","environment":"test"}'::jsonb,
      '00000000-0000-4000-8000-000000000871'::uuid)
  then raise exception 'Public Agent event strict payload validation failed'; end if;
end
$catalog$;

begin;
select pg_catalog.set_config(
  'data_agent.app_id',
  '00000000-0000-4000-8000-00000000da01',
  true
);
select pg_catalog.set_config(
  'data_agent.tenant_id',
  '00000000-0000-4000-8000-00000000aa22',
  true
);
select pg_catalog.set_config('data_agent.environment', 'test', true);
select pg_catalog.set_config(
  'data_agent.principal_id',
  '00000000-0000-4000-8000-000000001003',
  true
);
select pg_catalog.set_config('data_agent.role', 'owner', true);
select pg_catalog.set_config(
  'data_agent.deployment_id',
  '00000000-0000-4000-8000-00000000de01',
  true
);
insert into app_data_agent.runs(app_id,tenant_id,environment,run_id,principal_id,status,active_fence,question)
values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa22','test',
  '00000000-0000-4000-8000-000000000871','00000000-0000-4000-8000-000000001003','RUNNING',1,'v2 event contract probe');
insert into app_data_agent.artifacts(app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,document_json,worker_fence)
values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa22','test',
  '00000000-0000-4000-8000-000000000871','00000000-0000-4000-8000-000000000971','SqlArtifact',1,
  'sha256:1111111111111111111111111111111111111111111111111111111111111111','{"sql":"select 1"}',1);

do $events$
declare
  scope_document jsonb:='{"app_id":"00000000-0000-4000-8000-00000000da01","tenant_id":"00000000-0000-4000-8000-00000000aa22","environment":"test"}'::jsonb;
  started_payload jsonb:='{"call_id":"tool-1","tool_name":"sql.compiler.compile","title":"Compile","summary":"compiling","input":null,"profile_id":"governed-text2sql-agent","task_id":"00000000-0000-4000-8000-000000000801","artifact_refs":[]}'::jsonb;
  reference jsonb:='{"artifact_id":"00000000-0000-4000-8000-000000000971","artifact_type":"SqlArtifact","app_id":"00000000-0000-4000-8000-00000000da01","tenant_id":"00000000-0000-4000-8000-00000000aa22","environment":"test","run_id":"00000000-0000-4000-8000-000000000871","revision":1,"content_hash":"sha256:1111111111111111111111111111111111111111111111111111111111111111"}'::jsonb;
  completed_payload jsonb;
  agent_payload jsonb;
  document jsonb;
begin
  document:=pg_catalog.jsonb_build_object('schema_version','run-runtime-event@2.0.0',
    'event_id','00000000-0000-4000-8000-000000000981','scope',scope_document,
    'run_id','00000000-0000-4000-8000-000000000871','sequence',1,'worker_fence',1,
    'idempotency_key','v2:tool:1:start','occurred_at','2026-08-21T00:00:00.000Z',
    'event_type','run.tool_started','payload',started_payload);
  insert into app_data_agent.run_events(app_id,tenant_id,environment,event_id,run_id,sequence,event_type,
    payload_json,dedupe_key,worker_fence,event_document,created_at)
  values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa22','test',
    '00000000-0000-4000-8000-000000000981','00000000-0000-4000-8000-000000000871',1,'run.tool_started',
    started_payload,'v2:tool:1:start',1,document,'2026-08-21T00:00:00.000Z');

  completed_payload:=pg_catalog.jsonb_build_object('call_id','tool-1','tool_name','sql.compiler.compile',
    'summary','compiled','output',null,'duration_ms',12,'profile_id','governed-text2sql-agent',
    'task_id','00000000-0000-4000-8000-000000000801','artifact_refs',pg_catalog.jsonb_build_array(reference));
  document:=pg_catalog.jsonb_build_object('schema_version','run-runtime-event@2.0.0',
    'event_id','00000000-0000-4000-8000-000000000982','scope',scope_document,
    'run_id','00000000-0000-4000-8000-000000000871','sequence',2,'worker_fence',1,
    'idempotency_key','v2:tool:1:end','occurred_at','2026-08-21T00:00:01.000Z',
    'event_type','run.tool_completed','payload',completed_payload);
  insert into app_data_agent.run_events(app_id,tenant_id,environment,event_id,run_id,sequence,event_type,
    payload_json,dedupe_key,worker_fence,event_document,created_at)
  values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa22','test',
    '00000000-0000-4000-8000-000000000982','00000000-0000-4000-8000-000000000871',2,'run.tool_completed',
    completed_payload,'v2:tool:1:end',1,document,'2026-08-21T00:00:01.000Z');

  if not exists(select 1 from app_data_agent.run_events event where event.run_id='00000000-0000-4000-8000-000000000871'
    and event.sequence=2 and event.event_document->>'schema_version'='run-runtime-event@2.0.0')
  then raise exception 'v2 Tool lifecycle was not persisted'; end if;

  agent_payload:='{"profile_id":"report-writing-agent","task_id":"00000000-0000-4000-8000-000000000802","status":"RUNNING","phase":"draft.report","title":"Report","summary":"drafting","duration_ms":null,"error_code":null}'::jsonb;
  document:=pg_catalog.jsonb_build_object('schema_version','run-runtime-event@2.0.0',
    'event_id','00000000-0000-4000-8000-000000000983','scope',scope_document,
    'run_id','00000000-0000-4000-8000-000000000871','sequence',3,'worker_fence',1,
    'idempotency_key','v2:agent:running','occurred_at','2026-08-21T00:00:02.000Z',
    'event_type','run.agent_status','payload',agent_payload);
  insert into app_data_agent.run_events(app_id,tenant_id,environment,event_id,run_id,sequence,event_type,
    payload_json,dedupe_key,worker_fence,event_document,created_at)
  values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa22','test',
    '00000000-0000-4000-8000-000000000983','00000000-0000-4000-8000-000000000871',3,'run.agent_status',
    agent_payload,'v2:agent:running',1,document,'2026-08-21T00:00:02.000Z');

  if not exists(select 1 from app_data_agent.run_events event where event.run_id='00000000-0000-4000-8000-000000000871'
    and event.sequence=3 and event.payload_json->>'profile_id'='report-writing-agent')
  then raise exception 'v2 Agent status was not persisted'; end if;

  begin
    completed_payload:=pg_catalog.jsonb_set(completed_payload,'{task_id}','"00000000-0000-4000-8000-000000000802"'::jsonb);
    if app_data_agent.public_run_v2_payload_is_valid('run.tool_completed',completed_payload,scope_document,
      '00000000-0000-4000-8000-000000000871'::uuid)
    then raise exception 'mismatched Tool identity accepted'; end if;
  end;
end
$events$;
rollback;
