-- falcon24_root_agent_public_event_migration_checksum: sha256:c893e16eacf96203ed00b830495e2ff5b1351e72f4db0c3336e963e031e4b9e0
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare
  source_definition text;
  source_owner text;
  source_security_definer boolean;
  source_status_clause constant text :=
    'and requested_payload->>''profile_id'' in (''governed-analysis-agent'',''governed-text2sql-agent'',''report-writing-agent'',''semantic-management-agent'')';
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010810_app_data_agent_falcon24_ready_attempt_supersession'
        and migration_checksum=
          'sha256:2204b6f357a3ef32c84e57700944c5929cce7fa16f3327d7dee36dc19813fb3a')
  then raise exception using errcode='P0001',
    message='FALCON24_ROOT_AGENT_PUBLIC_EVENT_BASELINE_DRIFT'; end if;

  select pg_catalog.pg_get_functiondef(procedure_row.oid),owner_role.rolname,
    procedure_row.prosecdef
    into strict source_definition,source_owner,source_security_definer
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_roles owner_role on owner_role.oid=procedure_row.proowner
    where procedure_row.oid=
      'app_data_agent.public_run_v2_payload_is_valid(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(source_definition,source_status_clause)=0
    or pg_catalog.strpos(
      pg_catalog.substr(source_definition,
        pg_catalog.strpos(source_definition,source_status_clause)+pg_catalog.length(source_status_clause)),
      source_status_clause)>0
    or pg_catalog.strpos(source_definition,'data-agent-orchestrator')>0
    or source_owner<>'postgres'
    or source_security_definer is distinct from true
  then raise exception using errcode='P0001',
    message='FALCON24_ROOT_AGENT_PUBLIC_EVENT_SOURCE_MISMATCH'; end if;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';

do $cutover$
declare
  source_definition text;
  target_definition text;
  source_status_clause constant text :=
    'and requested_payload->>''profile_id'' in (''governed-analysis-agent'',''governed-text2sql-agent'',''report-writing-agent'',''semantic-management-agent'')';
  target_status_clause constant text :=
    'and requested_payload->>''profile_id'' in (''data-agent-orchestrator'',''governed-analysis-agent'',''governed-text2sql-agent'',''report-writing-agent'',''semantic-management-agent'')';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.public_run_v2_payload_is_valid(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
  ) into strict source_definition;
  target_definition:=pg_catalog.replace(
    source_definition,source_status_clause,target_status_clause);
  if target_definition=source_definition
    or pg_catalog.strpos(target_definition,source_status_clause)>0
    or pg_catalog.strpos(target_definition,target_status_clause)=0
  then raise exception using errcode='P0001',
    message='FALCON24_ROOT_AGENT_PUBLIC_EVENT_REWRITE_FAILED'; end if;
  execute target_definition;
end
$cutover$;

alter function app_data_agent.public_run_v2_payload_is_valid(text,jsonb,jsonb,uuid)
  owner to postgres;
revoke all on function app_data_agent.public_run_v2_payload_is_valid(text,jsonb,jsonb,uuid)
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

do $postconditions$
declare
  function_definition text;
  function_owner text;
  function_security_definer boolean;
  source_status_clause constant text :=
    'and requested_payload->>''profile_id'' in (''governed-analysis-agent'',''governed-text2sql-agent'',''report-writing-agent'',''semantic-management-agent'')';
  target_status_clause constant text :=
    'and requested_payload->>''profile_id'' in (''data-agent-orchestrator'',''governed-analysis-agent'',''governed-text2sql-agent'',''report-writing-agent'',''semantic-management-agent'')';
  child_tool_clause constant text :=
    'requested_payload->>''profile_id'' not in (''governed-analysis-agent'',''governed-text2sql-agent'',''report-writing-agent'',''semantic-management-agent'')';
  root_status_payload constant jsonb := pg_catalog.jsonb_build_object(
    'profile_id','data-agent-orchestrator',
    'task_id','00000000-0000-4000-8000-000000000001',
    'status','RUNNING','phase','root.delegation.started',
    'title','Data Agent Orchestrator','summary','Root delegation running.',
    'duration_ms',null,'error_code',null);
  root_tool_payload constant jsonb := pg_catalog.jsonb_build_object(
    'call_id','root-tool-call','tool_name','root.internal',
    'summary','Root tool must remain denied.',
    'profile_id','data-agent-orchestrator',
    'task_id','00000000-0000-4000-8000-000000000001',
    'artifact_refs','[]'::jsonb,'title','Root tool','input',null);
  model_request_payload constant jsonb := pg_catalog.jsonb_build_object(
    'call_id','00000000-0000-4000-8000-000000000004',
    'tool_name','model.request@1.0.0','summary','Model request started.',
    'profile_id',null,'task_id',null,'artifact_refs','[]'::jsonb,
    'title','Model request','input',null);
  sample_scope constant jsonb := pg_catalog.jsonb_build_object(
    'app_id','00000000-0000-4000-8000-00000000da01',
    'tenant_id','00000000-0000-4000-8000-000000000002',
    'environment','local');
begin
  select pg_catalog.pg_get_functiondef(procedure_row.oid),owner_role.rolname,
    procedure_row.prosecdef
    into strict function_definition,function_owner,function_security_definer
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_roles owner_role on owner_role.oid=procedure_row.proowner
    where procedure_row.oid=
      'app_data_agent.public_run_v2_payload_is_valid(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure;
  if pg_catalog.strpos(function_definition,target_status_clause)=0
    or pg_catalog.strpos(function_definition,source_status_clause)>0
    or pg_catalog.strpos(function_definition,child_tool_clause)=0
    or function_owner<>'postgres'
    or function_security_definer is distinct from true
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.public_run_v2_payload_is_valid(text,jsonb,jsonb,uuid)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.public_run_v2_payload_is_valid(text,jsonb,jsonb,uuid)','EXECUTE')
  then raise exception using errcode='P0001',
    message='FALCON24_ROOT_AGENT_PUBLIC_EVENT_POSTCONDITION_FAILED'; end if;

  if app_data_agent.public_run_v2_payload_is_valid(
    'run.agent_status',root_status_payload,sample_scope,
    '00000000-0000-4000-8000-000000000003'::uuid) is distinct from true
  then raise exception using errcode='P0001',
    message='FALCON24_ROOT_AGENT_PUBLIC_STATUS_REJECTED'; end if;
  if app_data_agent.public_run_v2_payload_is_valid(
    'run.tool_started',root_tool_payload,sample_scope,
    '00000000-0000-4000-8000-000000000003'::uuid) is not distinct from true
  then raise exception using errcode='P0001',
    message='FALCON24_ROOT_AGENT_PUBLIC_TOOL_PERMISSION_WIDENED'; end if;
  if app_data_agent.public_run_v2_payload_is_valid(
    'run.tool_started',model_request_payload,sample_scope,
    '00000000-0000-4000-8000-000000000003'::uuid) is distinct from true
  then raise exception using errcode='P0001',
    message='FALCON24_MODEL_REQUEST_PUBLIC_EVENT_REJECTED'; end if;
end
$postconditions$;

select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010811_app_data_agent_falcon24_root_agent_public_event',
  'sha256:c893e16eacf96203ed00b830495e2ff5b1351e72f4db0c3336e963e031e4b9e0');

commit;
