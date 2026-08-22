-- semantic_provider_pending_attempt_recovery_migration_checksum: sha256:b716d4543d2084d942306e7e3aedbb37dbcbaac0a53b12fc2da2aeb58bcd179e
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_PROVIDER_PENDING_ATTEMPT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_PROVIDER_PENDING_ATTEMPT_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010693_app_data_agent_semantic_graph_studio_digest_repair')
  then raise exception using errcode='P0001',message='SEMANTIC_PROVIDER_PENDING_ATTEMPT_BASELINE_10693_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create function semantic.get_authoring_pending_provider_attempt(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_principal_id uuid,p_semantic_domain text,
  p_authoring_run_id uuid,p_turn_index integer,p_request_id uuid
) returns uuid language plpgsql stable security definer set search_path='' as $function$
declare v_attempt_id uuid;
begin
  perform semantic.assert_explorer_scope(p_app_id,p_tenant_id,p_environment,p_principal_id,p_semantic_domain);
  select turn.provider_attempt_id into v_attempt_id
  from semantic.semantic_authoring_turn as turn
  join semantic.semantic_authoring_run as run
    on run.app_id=turn.app_id and run.tenant_id=turn.tenant_id and run.environment=turn.environment
    and run.semantic_domain=turn.semantic_domain and run.authoring_run_id=turn.authoring_run_id
  where turn.app_id=p_app_id and turn.tenant_id=p_tenant_id and turn.environment=p_environment
    and turn.semantic_domain=p_semantic_domain and turn.authoring_run_id=p_authoring_run_id
    and turn.turn_index=p_turn_index and turn.request_payload#>>'{request_id}'=p_request_id::text
    and run.principal_id=p_principal_id and run.status='RUNNING' and run.lease_token is not null
    and run.lease_expires_at>pg_catalog.clock_timestamp()
    and turn.provider_status='INTENT_COMMITTED';
  return v_attempt_id;
end
$function$;

alter function semantic.get_authoring_pending_provider_attempt(uuid,uuid,text,uuid,text,uuid,integer,uuid)
  owner to data_agent_u6_rpc_owner;
revoke all on function semantic.get_authoring_pending_provider_attempt(uuid,uuid,text,uuid,text,uuid,integer,uuid)
  from public, anon, authenticated, service_role;
grant execute on function semantic.get_authoring_pending_provider_attempt(uuid,uuid,text,uuid,text,uuid,integer,uuid)
  to data_agent_backend;
do $postconditions$
begin
  if pg_catalog.to_regprocedure(
      'semantic.get_authoring_pending_provider_attempt(uuid,uuid,text,uuid,text,uuid,integer,uuid)'
    ) is null
    or not pg_catalog.has_function_privilege(
      'data_agent_backend',
      'semantic.get_authoring_pending_provider_attempt(uuid,uuid,text,uuid,text,uuid,integer,uuid)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'semantic.get_authoring_pending_provider_attempt(uuid,uuid,text,uuid,text,uuid,integer,uuid)',
      'EXECUTE'
    )
  then raise exception using errcode='P0001',message='SEMANTIC_PROVIDER_PENDING_ATTEMPT_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010694_app_data_agent_semantic_provider_pending_attempt_recovery',
  'sha256:b716d4543d2084d942306e7e3aedbb37dbcbaac0a53b12fc2da2aeb58bcd179e'
);
commit;
