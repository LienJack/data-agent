do $cutover$
declare
  source_definition text;
  current_definition text;
  retired_profile_set constant text := '(''governed-text2sql-agent'',''report-writing-agent'',''semantic-management-agent'')';
  current_profile_set constant text := '(''governed-analysis-agent'',''governed-text2sql-agent'',''report-writing-agent'',''semantic-management-agent'')';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.public_run_v2_payload_is_valid(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
  ) into strict source_definition;
  if pg_catalog.strpos(source_definition,retired_profile_set)=0
    or pg_catalog.strpos(source_definition,'governed-analysis-agent')<>0
  then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_PUBLIC_EVENT_SOURCE_MISMATCH'; end if;
  current_definition:=pg_catalog.replace(source_definition,retired_profile_set,current_profile_set);
  if current_definition=source_definition
    or pg_catalog.strpos(current_definition,retired_profile_set)<>0
  then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_PUBLIC_EVENT_REWRITE_FAILED'; end if;
  execute current_definition;
end
$cutover$;
