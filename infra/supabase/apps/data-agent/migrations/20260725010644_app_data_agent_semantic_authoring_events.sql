-- ============================================================
-- 10644: Semantic authoring event page bounds
-- ============================================================
-- Depends on: 20260725010643_app_data_agent_semantic_authoring_digest

begin;

do $bootstrap$
declare
  baseline_migration record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_AUTHORING_EVENTS_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_AUTHORING_EVENTS_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select ledger.migration_checksum into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010643_app_data_agent_semantic_authoring_digest';
  if not found then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_EVENTS_BASELINE_10643_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010644_app_data_agent_semantic_authoring_events'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_EVENTS_MIGRATION_10644_ALREADY_RECORDED';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);
create or replace function semantic.list_semantic_authoring_events(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_principal_id uuid,
  p_semantic_domain text,
  p_authoring_run_id uuid,
  p_after_sequence bigint,
  p_limit integer
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_events jsonb;
begin
  perform semantic.assert_explorer_scope(
    p_app_id, p_tenant_id, p_environment, p_principal_id, p_semantic_domain
  );
  if not exists (
    select 1 from semantic.semantic_authoring_run as run
    where run.app_id = p_app_id and run.tenant_id = p_tenant_id
      and run.environment = p_environment and run.semantic_domain = p_semantic_domain
      and run.authoring_run_id = p_authoring_run_id
  ) then
    return '[]'::jsonb;
  end if;
  select coalesce(pg_catalog.jsonb_agg(event.event_payload order by event.sequence), '[]'::jsonb)
  into v_events
  from (
    select item.sequence, item.event_payload
    from semantic.semantic_authoring_event as item
    where item.app_id = p_app_id and item.tenant_id = p_tenant_id
      and item.environment = p_environment and item.semantic_domain = p_semantic_domain
      and item.authoring_run_id = p_authoring_run_id
      and item.sequence > coalesce(p_after_sequence, 0)
    order by item.sequence
    limit least(greatest(coalesce(p_limit, 1000), 1), 5000)
  ) as event;
  return v_events;
end;
$function$;

alter function semantic.list_semantic_authoring_events(uuid,uuid,text,uuid,text,uuid,bigint,integer)
  owner to data_agent_u6_rpc_owner;
revoke all on function semantic.list_semantic_authoring_events(uuid,uuid,text,uuid,text,uuid,bigint,integer)
  from public;
grant execute on function semantic.list_semantic_authoring_events(uuid,uuid,text,uuid,text,uuid,bigint,integer)
  to data_agent_backend;
do $postconditions$
declare
  function_oid regprocedure := pg_catalog.to_regprocedure(
    'semantic.list_semantic_authoring_events(uuid,uuid,text,uuid,text,uuid,bigint,integer)'
  );
  function_definition text;
  function_record record;
begin
  function_definition := pg_catalog.pg_get_functiondef(function_oid);
  select procedure.prosecdef, procedure.proconfig, owner.rolname as owner_name
  into function_record
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
  where procedure.oid = function_oid::oid;

  if pg_catalog.strpos(function_definition, 'pg_catalog.greatest') > 0
    or pg_catalog.strpos(function_definition, 'pg_catalog.least') > 0
    or pg_catalog.strpos(pg_catalog.lower(function_definition), 'limit least(greatest(') = 0
    or not function_record.prosecdef
    or function_record.owner_name <> 'data_agent_u6_rpc_owner'
    or pg_catalog.array_to_string(function_record.proconfig, ',') not in (
      'search_path=', 'search_path=""'
    )
    or not has_function_privilege(
      'data_agent_backend',
      'semantic.list_semantic_authoring_events(uuid,uuid,text,uuid,text,uuid,bigint,integer)',
      'EXECUTE'
    )
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_EVENTS_FUNCTION_HARDENING_FAILED';
  end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010644_app_data_agent_semantic_authoring_events',
  'sha256:1aa73c34a8836ae569809ca2eaed2aec97f3cb53f2bacaa665914b764b17c135'
);

commit;
