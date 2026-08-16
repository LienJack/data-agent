create function app_data_agent.reject_provider_invocation_authority_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'PROVIDER_INVOCATION_AUTHORITY_IMMUTABLE';
end
$function$;

create trigger provider_invocation_intents_immutable
before update or delete on app_data_agent.provider_invocation_intents
for each row execute function app_data_agent.reject_provider_invocation_authority_mutation();

create trigger provider_invocation_dispatch_permits_immutable
before update or delete on app_data_agent.provider_invocation_dispatch_permits
for each row execute function app_data_agent.reject_provider_invocation_authority_mutation();

create trigger provider_invocation_outcomes_immutable
before update or delete on app_data_agent.provider_invocation_outcomes
for each row execute function app_data_agent.reject_provider_invocation_authority_mutation();

create trigger provider_invocation_usage_receipts_immutable
before update or delete on app_data_agent.provider_invocation_usage_receipts
for each row execute function app_data_agent.reject_provider_invocation_authority_mutation();

alter table app_data_agent.provider_invocation_intents enable row level security;
alter table app_data_agent.provider_invocation_intents force row level security;
alter table app_data_agent.provider_invocation_outcomes enable row level security;
alter table app_data_agent.provider_invocation_outcomes force row level security;
alter table app_data_agent.provider_invocation_usage_receipts enable row level security;
alter table app_data_agent.provider_invocation_usage_receipts force row level security;
alter table app_data_agent.provider_invocation_dispatch_permits enable row level security;
alter table app_data_agent.provider_invocation_dispatch_permits force row level security;

create policy provider_invocation_intents_rpc_owner
on app_data_agent.provider_invocation_intents for all
to data_agent_provider_invocation_rpc_owner using (true) with check (true);
create policy provider_invocation_outcomes_rpc_owner
on app_data_agent.provider_invocation_outcomes for all
to data_agent_provider_invocation_rpc_owner using (true) with check (true);
create policy provider_invocation_dispatch_permits_rpc_owner
on app_data_agent.provider_invocation_dispatch_permits for all
to data_agent_provider_invocation_rpc_owner using (true) with check (true);
create policy provider_invocation_usage_receipts_rpc_owner
on app_data_agent.provider_invocation_usage_receipts for all
to data_agent_provider_invocation_rpc_owner using (true) with check (true);
