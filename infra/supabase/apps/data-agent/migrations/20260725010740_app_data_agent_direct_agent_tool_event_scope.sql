-- direct_agent_tool_event_scope_migration_checksum: sha256:a29b1dc8be893026b9c8b00ac5a9ce16083d6cfdcad6fcf46f10814f62c0f732
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='DIRECT_AGENT_TOOL_EVENT_SCOPE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='DIRECT_AGENT_TOOL_EVENT_SCOPE_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010739_app_data_agent_analysis_input_artifact_constraint')
  then raise exception using errcode='P0001',message='DIRECT_AGENT_TOOL_EVENT_SCOPE_BASELINE_10739_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);

do $cutover$
declare
  source_definition text;
  direct_definition text;
  retired_team_branch constant text := '  if exists(select 1 from app_data_agent.commands command
      where command.app_id=(requested_scope->>''app_id'')::uuid
        and command.tenant_id=(requested_scope->>''tenant_id'')::uuid
        and command.environment=requested_scope->>''environment''
        and command.run_id=requested_run_id
        and command.payload_json->>''kind''=''START_DATA_AGENT_TEAM'')
    and requested_payload->>''profile_id'' is null
  then return false; end if;
  if exists(select 1 from app_data_agent.commands command
      where command.app_id=(requested_scope->>''app_id'')::uuid
        and command.tenant_id=(requested_scope->>''tenant_id'')::uuid
        and command.environment=requested_scope->>''environment''
        and command.run_id=requested_run_id
        and command.payload_json->>''kind''<>''START_DATA_AGENT_TEAM'')
    and requested_payload->>''profile_id'' is not null
  then return false; end if;
';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.public_run_v2_payload_is_valid(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
  ) into strict source_definition;
  if pg_catalog.strpos(source_definition,retired_team_branch)=0 then
    raise exception using errcode='P0001',message='DIRECT_AGENT_TOOL_EVENT_SCOPE_SOURCE_MISMATCH';
  end if;
  direct_definition:=pg_catalog.replace(source_definition,retired_team_branch,'');
  if direct_definition=source_definition then
    raise exception using errcode='P0001',message='DIRECT_AGENT_TOOL_EVENT_SCOPE_REWRITE_FAILED';
  end if;
  execute direct_definition;
end
$cutover$;

do $postconditions$
declare function_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.public_run_v2_payload_is_valid(text,jsonb,jsonb,uuid)'::pg_catalog.regprocedure
  ) into strict function_definition;
  if pg_catalog.strpos(function_definition,'command.payload_json->>''kind''')<>0
    or pg_catalog.strpos(function_definition,
      '((requested_payload->>''profile_id'' is null) <> (requested_payload->>''task_id'' is null))')=0
  then raise exception using errcode='P0001',message='DIRECT_AGENT_TOOL_EVENT_SCOPE_NOT_INSTALLED'; end if;
end
$postconditions$;

select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010740_app_data_agent_direct_agent_tool_event_scope',
  'sha256:a29b1dc8be893026b9c8b00ac5a9ce16083d6cfdcad6fcf46f10814f62c0f732');
commit;
