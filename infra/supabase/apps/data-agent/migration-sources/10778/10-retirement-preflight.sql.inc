do $retirement_preflight$
begin
  if pg_catalog.to_regclass('app_data_agent.agent_dispatch_rollout_policies') is null
    or pg_catalog.to_regclass('app_data_agent.agent_dispatch_deferred_receipts') is null
    or pg_catalog.to_regclass('app_data_agent.agent_dispatch_execute_receipts') is null
  then
    raise exception using errcode='P0001',
      message='E1_LEGACY_RUNTIME_RETIREMENT_SOURCE_DRIFT';
  end if;

  if exists(select 1 from app_data_agent.agent_dispatch_rollout_policies)
    or exists(select 1 from app_data_agent.agent_dispatch_deferred_receipts)
    or exists(select 1 from app_data_agent.agent_dispatch_execute_receipts)
  then
    raise exception using errcode='55000',
      message='E1_LEGACY_RUNTIME_RETIREMENT_REQUIRES_FRESH_DATABASE';
  end if;
end
$retirement_preflight$;
