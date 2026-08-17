revoke all on app_data_agent.agent_profile_revisions,
  app_data_agent.agent_team_tasks,
  app_data_agent.agent_team_handoffs,
  app_data_agent.agent_team_context_epochs,
  app_data_agent.agent_team_completion_receipts,
  app_data_agent.agent_team_events,
  app_data_agent.agent_team_verifier_decisions,
  app_data_agent.agent_team_task_capabilities,
  app_data_agent.agent_team_acceptance_receipts,
  app_data_agent.sensitive_execution_artifacts,
  app_data_agent.sensitive_execution_artifact_access_audit
from public,anon,authenticated,service_role,data_agent_backend;

revoke all on function app_data_agent.reject_agent_team_authority_mutation(),
  app_data_agent.agent_team_assert_store_command(jsonb,text),
  app_data_agent.agent_team_store_result(jsonb,text,jsonb),
  app_data_agent.create_agent_team_task(jsonb),
  app_data_agent.prepare_agent_team_handoff(jsonb),
  app_data_agent.issue_agent_team_task_capability(jsonb),
  app_data_agent.load_agent_team_task_capability(jsonb),
  app_data_agent.commit_agent_team_context_epoch(jsonb),
  app_data_agent.commit_agent_team_completion(jsonb),
  app_data_agent.commit_agent_team_acceptance(jsonb),
  app_data_agent.record_agent_team_late_result(jsonb),
  app_data_agent.load_agent_team_run(jsonb),
  app_data_agent.commit_sensitive_execution_artifact(jsonb,jsonb),
  app_data_agent.load_sensitive_execution_artifact(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;

grant usage on schema app_data_agent,platform to data_agent_u19_team_owner;
grant select on app_data_agent.runs,app_data_agent.run_attempts,app_data_agent.outbox
  to data_agent_u19_team_owner;
grant execute on function
  platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  platform.backend_run_object_matches(uuid,uuid,text,uuid,boolean),
  app_data_agent.assert_provider_active_worker_lease(jsonb),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.provider_json_object_has_exact_keys(jsonb,text[]),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text)
to data_agent_u19_team_owner;

grant execute on function
  app_data_agent.create_agent_team_task(jsonb),
  app_data_agent.prepare_agent_team_handoff(jsonb),
  app_data_agent.issue_agent_team_task_capability(jsonb),
  app_data_agent.load_agent_team_task_capability(jsonb),
  app_data_agent.commit_agent_team_context_epoch(jsonb),
  app_data_agent.commit_agent_team_completion(jsonb),
  app_data_agent.commit_agent_team_acceptance(jsonb),
  app_data_agent.record_agent_team_late_result(jsonb),
  app_data_agent.load_agent_team_run(jsonb),
  app_data_agent.commit_sensitive_execution_artifact(jsonb,jsonb),
  app_data_agent.load_sensitive_execution_artifact(jsonb)
to data_agent_backend;

do $postconditions$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'agent_team_tasks','agent_team_handoffs','agent_team_context_epochs',
    'agent_team_completion_receipts','agent_team_events','agent_team_verifier_decisions',
    'agent_team_task_capabilities','agent_team_acceptance_receipts',
    'sensitive_execution_artifacts','sensitive_execution_artifact_access_audit'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='app_data_agent' and relation.relname=relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity
    ) then
      raise exception using errcode='P0001',message='AGENT_TEAM_FORCE_RLS_MISSING';
    end if;
  end loop;
  if not exists (
    select 1 from pg_catalog.pg_roles
    where rolname='data_agent_u19_team_owner' and not rolcanlogin and not rolsuper
      and not rolcreatedb and not rolcreaterole and not rolreplication
      and not rolinherit and not rolbypassrls
  ) or pg_catalog.pg_has_role('data_agent_u19_team_owner','data_agent_backend','MEMBER')
  then
    raise exception using errcode='P0001',message='AGENT_TEAM_OWNER_FLAGS_UNSAFE';
  end if;
  if pg_catalog.has_table_privilege(
      'data_agent_backend','app_data_agent.agent_team_tasks','INSERT,UPDATE,DELETE'
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend','app_data_agent.sensitive_execution_artifacts','INSERT,UPDATE,DELETE'
    ) or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.create_agent_team_task(jsonb)','EXECUTE'
    ) or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.commit_sensitive_execution_artifact(jsonb,jsonb)','EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'anon','app_data_agent.load_agent_team_run(jsonb)','EXECUTE'
    ) or pg_catalog.has_function_privilege(
      'authenticated','app_data_agent.load_sensitive_execution_artifact(jsonb)','EXECUTE'
    )
  then
    raise exception using errcode='P0001',message='AGENT_TEAM_GRANT_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;
