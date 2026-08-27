alter table app_data_agent.falcon24_diagnostic_attempts owner to data_agent_u6_data_owner;
alter table app_data_agent.falcon24_diagnostic_receipts owner to data_agent_u6_data_owner;
alter table app_data_agent.falcon24_diagnostic_attempts enable row level security;
alter table app_data_agent.falcon24_diagnostic_attempts force row level security;
alter table app_data_agent.falcon24_diagnostic_receipts enable row level security;
alter table app_data_agent.falcon24_diagnostic_receipts force row level security;

create policy falcon24_diagnostic_attempts_rpc
on app_data_agent.falcon24_diagnostic_attempts for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy falcon24_diagnostic_receipts_rpc
on app_data_agent.falcon24_diagnostic_receipts for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));

revoke all on table app_data_agent.falcon24_diagnostic_attempts,
  app_data_agent.falcon24_diagnostic_receipts from public,data_agent_backend;
grant select,insert,update on table app_data_agent.falcon24_diagnostic_attempts
  to data_agent_u6_rpc_owner;
grant select,insert on table app_data_agent.falcon24_diagnostic_receipts
  to data_agent_u6_rpc_owner;

alter function app_data_agent.falcon24_diagnostic_attempt_state_fence()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.falcon24_diagnostic_receipt_immutable()
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_diagnostic(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.load_falcon24_diagnostic(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.complete_falcon24_diagnostic(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_qualification_pre_diagnostic(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_qualification(jsonb)
  owner to data_agent_u6_rpc_owner;

revoke all on function app_data_agent.falcon24_diagnostic_attempt_state_fence(),
  app_data_agent.falcon24_diagnostic_receipt_immutable(),
  app_data_agent.begin_falcon24_diagnostic(jsonb),
  app_data_agent.load_falcon24_diagnostic(jsonb),
  app_data_agent.complete_falcon24_diagnostic(jsonb),
  app_data_agent.begin_falcon24_qualification_pre_diagnostic(jsonb),
  app_data_agent.begin_falcon24_qualification(jsonb)
from public;
revoke execute on function app_data_agent.begin_falcon24_qualification_pre_diagnostic(jsonb)
  from data_agent_backend;
grant execute on function app_data_agent.begin_falcon24_diagnostic(jsonb),
  app_data_agent.load_falcon24_diagnostic(jsonb),
  app_data_agent.complete_falcon24_diagnostic(jsonb),
  app_data_agent.begin_falcon24_qualification(jsonb)
to data_agent_backend;
grant execute on function app_data_agent.falcon24_diagnostic_attempt_state_fence(),
  app_data_agent.falcon24_diagnostic_receipt_immutable(),
  app_data_agent.begin_falcon24_diagnostic(jsonb),
  app_data_agent.load_falcon24_diagnostic(jsonb),
  app_data_agent.complete_falcon24_diagnostic(jsonb),
  app_data_agent.begin_falcon24_qualification_pre_diagnostic(jsonb),
  app_data_agent.begin_falcon24_qualification(jsonb)
to data_agent_u6_rpc_owner;

revoke all on table app_data_agent.falcon24_diagnostic_attempts,
  app_data_agent.falcon24_diagnostic_receipts from data_agent_backend;
