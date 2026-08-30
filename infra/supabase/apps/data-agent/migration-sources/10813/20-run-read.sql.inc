-- No role membership, BYPASSRLS, write privilege, RPC replacement or new writer.
grant execute on function platform.backend_exact_principal_object_matches(uuid,uuid,text,uuid,boolean)
  to data_agent_u19_team_owner;

do $policy$
begin
  if not exists(select 1 from pg_catalog.pg_policy
    where polrelid='app_data_agent.runs'::regclass and polname='runs_team_trace_owner_select')
  then
    create policy runs_team_trace_owner_select on app_data_agent.runs for select
      to data_agent_u19_team_owner
      using(platform.backend_exact_principal_object_matches(
        app_id,tenant_id,environment,principal_id,false));
  end if;
end
$policy$;
