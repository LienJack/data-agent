do $postconditions$
declare function_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.public_run_v2_payload_is_valid(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
  ) into strict function_definition;
  if pg_catalog.strpos(function_definition,'governed-analysis-agent')=0
    or pg_catalog.strpos(function_definition,
      '(''governed-text2sql-agent'',''report-writing-agent'',''semantic-management-agent'')')<>0
    or pg_catalog.strpos(function_definition,'command.payload_json->>''kind''')<>0
  then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_PUBLIC_EVENT_NOT_INSTALLED'; end if;
  if not app_data_agent.public_run_v2_payload_is_valid(
    'run.agent_status',
    pg_catalog.jsonb_build_object(
      'profile_id','governed-analysis-agent',
      'task_id','00000000-0000-4000-8000-000000000001',
      'status','RUNNING','phase','analysis','title','Analysis','summary','Running',
      'duration_ms',null,'error_code',null
    ),
    pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-000000000002',
      'environment','local'
    ),
    '00000000-0000-4000-8000-000000000003'::uuid
  ) then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_PUBLIC_EVENT_PROFILE_REJECTED'; end if;
end
$postconditions$;
