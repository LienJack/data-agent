alter table app_data_agent.falcon24_e1_ui_receipts owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_falcon24_e1_ui_receipt(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_e1_ui_receipts(jsonb) owner to data_agent_u6_rpc_owner;

alter table app_data_agent.falcon24_e1_ui_receipts enable row level security;
alter table app_data_agent.falcon24_e1_ui_receipts force row level security;
revoke all on table app_data_agent.falcon24_e1_ui_receipts from public;
grant select,insert on table app_data_agent.falcon24_e1_ui_receipts to data_agent_u6_rpc_owner;
create policy falcon24_e1_ui_receipts_rpc on app_data_agent.falcon24_e1_ui_receipts
  for select to data_agent_u6_rpc_owner
  using(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy falcon24_e1_ui_receipts_rpc_insert on app_data_agent.falcon24_e1_ui_receipts
  for insert to data_agent_u6_rpc_owner
  with check(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));

revoke all on function app_data_agent.commit_falcon24_e1_ui_receipt(jsonb),
  app_data_agent.load_falcon24_e1_ui_receipts(jsonb) from public;
grant execute on function app_data_agent.commit_falcon24_e1_ui_receipt(jsonb),
  app_data_agent.load_falcon24_e1_ui_receipts(jsonb) to data_agent_backend;
