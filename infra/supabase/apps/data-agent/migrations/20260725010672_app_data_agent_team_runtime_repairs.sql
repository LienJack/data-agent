-- team_runtime_repair_migration_checksum: sha256:a105b6e26a068e0a54ea7820f35ca1559378aedb80b725d8df858e0f6e299547
-- 10672 repairs cross-authority locks and provider terminal persistence exercised by the production Team runtime.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='U20_TEAM_RUNTIME_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='U20_TEAM_RUNTIME_REPAIR_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010671_app_data_agent_public_agent_events')
  then raise exception using errcode='P0001',message='U20_TEAM_RUNTIME_REPAIR_BASELINE_10671_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
grant update on app_data_agent.workspace_run_defaults,
  app_data_agent.workspace_run_default_revisions,
  app_data_agent.effective_run_config_receipts,
  app_data_agent.effective_config_context_receipts,
  app_data_agent.run_attempts,
  app_data_agent.outbox
to data_agent_u12_context_owner;

drop policy if exists workspace_run_defaults_u12_lock on app_data_agent.workspace_run_defaults;
create policy workspace_run_defaults_u12_lock on app_data_agent.workspace_run_defaults
  for update to data_agent_u12_context_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (false);
drop policy if exists workspace_run_default_revisions_u12_lock on app_data_agent.workspace_run_default_revisions;
create policy workspace_run_default_revisions_u12_lock on app_data_agent.workspace_run_default_revisions
  for update to data_agent_u12_context_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (false);
drop policy if exists effective_run_config_u12_lock on app_data_agent.effective_run_config_receipts;
create policy effective_run_config_u12_lock on app_data_agent.effective_run_config_receipts
  for update to data_agent_u12_context_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (false);
drop policy if exists effective_context_receipt_u12_lock on app_data_agent.effective_config_context_receipts;
create policy effective_context_receipt_u12_lock on app_data_agent.effective_config_context_receipts
  for update to data_agent_u12_context_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (false);
drop policy if exists run_attempt_u12_lock on app_data_agent.run_attempts;
create policy run_attempt_u12_lock on app_data_agent.run_attempts
  for update to data_agent_u12_context_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (false);
drop policy if exists outbox_u12_lock on app_data_agent.outbox;
create policy outbox_u12_lock on app_data_agent.outbox
  for update to data_agent_u12_context_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (false);

grant execute on function app_data_agent.assert_provider_active_worker_lease_pre_u20(jsonb),
  app_data_agent.assert_provider_active_worker_lease(jsonb)
to data_agent_u19_team_owner;
grant execute on function app_data_agent.command_payload_is_valid(jsonb)
to data_agent_provider_invocation_rpc_owner;

alter table app_data_agent.artifacts drop constraint artifacts_document_json_check;
alter table app_data_agent.artifacts add constraint artifacts_document_json_check check (
  pg_catalog.jsonb_typeof(document_json)='object'
  and not app_data_agent.contains_potential_plaintext_secret(
    case when artifact_type='AgentDataProjectionReceipt'
      then (document_json-'token_bound_policy_version'::text)-'trusted_input_token_upper_bound'::text
      else document_json end
  )
);

do $repair_functions$
declare
  definition text;
  repaired text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_resolved_context_package(jsonb)'::pg_catalog.regprocedure
  ) into definition;
  repaired:=pg_catalog.replace(
    pg_catalog.replace(
      definition,
      $$requested->'package'-'package_hash'$$,
      $$(requested->'package') - 'package_hash'::text$$
    ),
    $$requested->'receipt'-'receipt_hash'$$,
    $$(requested->'receipt') - 'receipt_hash'::text$$
  );
  if repaired=definition
    and (pg_catalog.strpos(definition,$$(requested->'package') - 'package_hash'::text$$)=0
      or pg_catalog.strpos(definition,$$(requested->'receipt') - 'receipt_hash'::text$$)=0)
  then raise exception using errcode='P0001',message='U20_RESOLVED_CONTEXT_FUNCTION_DRIFT'; end if;
  if repaired<>definition then execute repaired; end if;

  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_provider_invocation_worker_transition_internal(jsonb,jsonb,jsonb,text)'::pg_catalog.regprocedure
  ) into definition;
  repaired:=pg_catalog.replace(
    definition,
    $$pg_catalog.greatest(0,pg_catalog.floor($$,
    $$greatest(0::bigint,pg_catalog.floor($$
  );
  if repaired=definition
    and pg_catalog.strpos(definition,$$greatest(0::bigint,pg_catalog.floor($$)=0
  then raise exception using errcode='P0001',message='U20_PROVIDER_TRANSITION_FUNCTION_DRIFT'; end if;
  if repaired<>definition then execute repaired; end if;
end
$repair_functions$;

alter function app_data_agent.commit_resolved_context_package(jsonb)
  owner to data_agent_u12_context_owner;
alter function app_data_agent.commit_provider_invocation_worker_transition_internal(jsonb,jsonb,jsonb,text)
  owner to data_agent_provider_invocation_rpc_owner;

do $postcondition$
begin
  if not pg_catalog.has_table_privilege('data_agent_u12_context_owner',
      'app_data_agent.run_attempts','UPDATE')
    or not pg_catalog.has_function_privilege('data_agent_u19_team_owner',
      'app_data_agent.assert_provider_active_worker_lease(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_provider_invocation_rpc_owner',
      'app_data_agent.command_payload_is_valid(jsonb)','EXECUTE')
    or pg_catalog.strpos(
      pg_catalog.pg_get_functiondef('app_data_agent.commit_resolved_context_package(jsonb)'::pg_catalog.regprocedure),
      $$(requested->'package') - 'package_hash'::text$$)=0
    or pg_catalog.strpos(
      pg_catalog.pg_get_functiondef('app_data_agent.commit_provider_invocation_worker_transition_internal(jsonb,jsonb,jsonb,text)'::pg_catalog.regprocedure),
      $$greatest(0::bigint,pg_catalog.floor($$)=0
  then raise exception using errcode='P0001',message='U20_TEAM_RUNTIME_REPAIR_POSTCONDITION_FAILED'; end if;
end
$postcondition$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010672_app_data_agent_team_runtime_repairs','sha256:a105b6e26a068e0a54ea7820f35ca1559378aedb80b725d8df858e0f6e299547');
commit;
