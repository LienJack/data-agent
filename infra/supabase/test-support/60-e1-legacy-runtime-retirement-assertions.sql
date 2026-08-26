\set ON_ERROR_STOP on

begin;

do $legacy_runtime_absent$
declare command_definition text;acceptance_definition text;
begin
  if pg_catalog.to_regclass('app_data_agent.agent_dispatch_rollout_policies') is not null
    or pg_catalog.to_regclass('app_data_agent.agent_dispatch_deferred_receipts') is not null
    or pg_catalog.to_regclass('app_data_agent.agent_dispatch_execute_receipts') is not null
    or exists(
      select 1 from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname like '%agent_dispatch%')
  then raise exception 'E1_LEGACY_ADAPTIVE_DISPATCH_SURFACE_STILL_PRESENT'; end if;

  select pg_catalog.pg_get_functiondef(
    'app_data_agent.command_payload_is_valid(jsonb)'::regprocedure)
    into strict command_definition;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure)
    into strict acceptance_definition;
  if pg_catalog.strpos(command_definition,'subagent_catalog_snapshot_is_valid')=0
    or pg_catalog.strpos(command_definition,'agent_dispatch')>0
    or pg_catalog.strpos(command_definition,'effective-config-team-lease@2.0.0')>0
    or pg_catalog.strpos(acceptance_definition,'commit_subagent_catalog_snapshot_internal')=0
    or pg_catalog.strpos(acceptance_definition,'effective-config-team-lease@3.0.0')=0
    or pg_catalog.strpos(acceptance_definition,'dispatch_admission')>0
    or pg_catalog.strpos(acceptance_definition,'shadow_dispatch_plan')>0
  then raise exception 'E1_COMMAND_BOUNDARY_NOT_EXCLUSIVE'; end if;
end
$legacy_runtime_absent$;

do $legacy_rpc_not_found$
begin
  begin
    execute 'select app_data_agent.resolve_agent_dispatch_rollout_policy($1)'
      using 'ENFORCED';
    raise exception 'E1_RETIRED_RPC_REMAINED_CALLABLE';
  exception when undefined_function then null;
  end;
end
$legacy_rpc_not_found$;

rollback;
