-- workspace_command_payload_migration_checksum: sha256:91f18daab31d0ad9369d3bfc57137ffa0fa68e270a7fa2d65a3e9d603cc55226
-- ============================================================
-- 10647: Workspace-bound Run command payload compatibility
-- Depends on: 20260725010646_app_data_agent_falcon_import
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'WORKSPACE_COMMAND_PAYLOAD_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'WORKSPACE_COMMAND_PAYLOAD_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010646_app_data_agent_falcon_import'
  ) then
    raise exception using errcode = 'P0001', message = 'WORKSPACE_COMMAND_PAYLOAD_BASELINE_10646_MISSING';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';
select platform.acquire_migration_lock('app', '00000000-0000-4000-8000-00000000da01'::uuid);
create or replace function app_data_agent.command_payload_is_valid(
  requested_payload jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  item jsonb;
begin
  if requested_payload is null
    or pg_catalog.jsonb_typeof(requested_payload) <> 'object'
    or app_data_agent.contains_potential_plaintext_secret(requested_payload)
  then
    return false;
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_object_keys(requested_payload) as payload_key(key)
    where payload_key.key not in (
      'kind',
      'mode',
      'question_version',
      'dataset_id',
      'secret_refs',
      'datasource_id',
      'conversation_id'
    )
  ) then
    return false;
  end if;
  if pg_catalog.jsonb_typeof(requested_payload -> 'kind') is distinct from 'string'
    or requested_payload ->> 'kind'
      !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
  then
    return false;
  end if;
  if requested_payload ? 'mode' and (
    pg_catalog.jsonb_typeof(requested_payload -> 'mode') is distinct from 'string'
    or requested_payload ->> 'mode' <> 'L2'
  ) then
    return false;
  end if;
  if requested_payload ? 'question_version' and (
    pg_catalog.jsonb_typeof(requested_payload -> 'question_version')
      is distinct from 'string'
    or requested_payload ->> 'question_version'
      !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
  ) then
    return false;
  end if;
  if requested_payload ? 'dataset_id' and (
    pg_catalog.jsonb_typeof(requested_payload -> 'dataset_id') is distinct from 'string'
    or requested_payload ->> 'dataset_id'
      !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
  ) then
    return false;
  end if;
  if requested_payload ? 'secret_refs' then
    if pg_catalog.jsonb_typeof(requested_payload -> 'secret_refs')
      is distinct from 'array'
      or pg_catalog.jsonb_array_length(requested_payload -> 'secret_refs')
        not between 1 and 32
    then
      return false;
    end if;
    for item in
      select element.value
      from pg_catalog.jsonb_array_elements(
        requested_payload -> 'secret_refs'
      ) as element(value)
    loop
      if pg_catalog.jsonb_typeof(item) is distinct from 'string'
        or item #>> '{}'
          !~* '^secretref:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then
        return false;
      end if;
    end loop;
  end if;
  if requested_payload ? 'datasource_id' and (
    pg_catalog.jsonb_typeof(requested_payload -> 'datasource_id') is distinct from 'string'
    or requested_payload ->> 'datasource_id'
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    return false;
  end if;
  if requested_payload ? 'conversation_id' and (
    not (requested_payload ? 'datasource_id')
    or pg_catalog.jsonb_typeof(requested_payload -> 'conversation_id') is distinct from 'string'
    or requested_payload ->> 'conversation_id'
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    return false;
  end if;
  return true;
end
$function$;
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
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010647_app_data_agent_workspace_command_payload',
  'sha256:91f18daab31d0ad9369d3bfc57137ffa0fa68e270a7fa2d65a3e9d603cc55226'
);

commit;
