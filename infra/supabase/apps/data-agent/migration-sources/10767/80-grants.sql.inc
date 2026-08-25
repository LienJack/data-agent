alter function app_data_agent.attach_agent_team_accepted_sibling_output(jsonb)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.prepare_agent_team_handoff(jsonb)
  owner to data_agent_u19_team_owner;

revoke all on app_data_agent.agent_team_accepted_sibling_output_attachments
from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.attach_agent_team_accepted_sibling_output(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.prepare_agent_team_handoff(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;

grant select on app_data_agent.artifacts to data_agent_u19_team_owner;
grant execute on function app_data_agent.attach_agent_team_accepted_sibling_output(jsonb),
  app_data_agent.prepare_agent_team_handoff(jsonb)
to data_agent_backend;
