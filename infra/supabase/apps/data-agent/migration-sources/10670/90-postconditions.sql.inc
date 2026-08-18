-- The original U20 insert trigger remains enabled as defense in depth.
do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.accept_backend_run_command(jsonb,text,jsonb,text)'::pg_catalog.regprocedure)
  into strict definition;
  if pg_catalog.strpos(definition,'QA_TEAM_ACCEPTANCE_ATOMIC_UPGRADE')=0
    or pg_catalog.strpos(
      definition,E'not in (''START_L2_RESEARCH'',''START_DATA_AGENT_TEAM'')')=0
  then
    raise exception using errcode='P0001',message='U20_TEAM_ACCEPTANCE_POSTCONDITION_FAILED';
  end if;
  if not exists(select 1 from pg_catalog.pg_trigger trigger
    where trigger.tgrelid='app_data_agent.commands'::pg_catalog.regclass
      and trigger.tgname='commands_route_question_run_to_agent_team'
      and trigger.tgenabled<>'D')
  then
    raise exception using errcode='P0001',message='U20_TEAM_ACCEPTANCE_TRIGGER_MISSING';
  end if;
end
$postconditions$;
