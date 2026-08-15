do $postconditions$
begin
  if not app_data_agent.command_payload_is_valid(
    '{"kind":"START_L2_RESEARCH","mode":"L2","datasource_id":"00000000-0000-4000-8000-00000000fa01","conversation_id":"00000000-0000-4000-8000-00000000fa04"}'::jsonb
  ) then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_BOUND_COMMAND_PAYLOAD_REJECTED';
  end if;
  if app_data_agent.command_payload_is_valid(
    '{"kind":"START_L2_RESEARCH","mode":"L2","conversation_id":"00000000-0000-4000-8000-00000000fa04"}'::jsonb
  ) then
    raise exception using errcode = 'P0001', message = 'UNBOUND_CONVERSATION_COMMAND_PAYLOAD_ACCEPTED';
  end if;
  if not app_data_agent.workspace_command_payload_is_valid(
    '{"kind":"START_L2_RESEARCH","mode":"L2","datasource_id":"00000000-0000-4000-8000-00000000fa01","conversation_id":"00000000-0000-4000-8000-00000000fa04"}'::jsonb
  ) then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_COMMAND_VALIDATOR_DRIFT';
  end if;
end
$postconditions$;
