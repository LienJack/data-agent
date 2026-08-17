grant usage on schema app_data_agent,platform to data_agent_u10_job_owner;
grant select on app_data_agent.artifacts,app_data_agent.artifact_export_receipts
  to data_agent_u10_job_owner;
grant execute on function
  platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.provider_json_object_has_exact_keys(jsonb,text[]),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text)
to data_agent_u10_job_owner;

create policy artifacts_u10_job_output_select on app_data_agent.artifacts
  as permissive for select to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy artifact_export_receipts_u10_job_output_select on app_data_agent.artifact_export_receipts
  as permissive for select to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));

revoke all on app_data_agent.job_handler_revisions,app_data_agent.jobs,
  app_data_agent.job_attempts,app_data_agent.job_events,app_data_agent.job_output_receipts,
  app_data_agent.job_worker_heartbeats,app_data_agent.capability_readiness_receipts
from public,anon,authenticated,service_role,data_agent_backend;

revoke all on function
  app_data_agent.reject_job_center_immutable_mutation(),
  app_data_agent.job_utc_millis(timestamptz),
  app_data_agent.job_append_event(app_data_agent.jobs,text,jsonb),
  app_data_agent.assert_job_active_lease(jsonb),
  app_data_agent.job_record_document(app_data_agent.jobs),
  app_data_agent.commit_job_output_receipt(app_data_agent.jobs,app_data_agent.job_attempts,text,jsonb,text),
  app_data_agent.enqueue_job(jsonb),
  app_data_agent.claim_job_work(text,jsonb,integer),
  app_data_agent.start_job_work(jsonb),
  app_data_agent.heartbeat_job_work(jsonb,integer),
  app_data_agent.succeed_job_work(jsonb,jsonb),
  app_data_agent.fail_job_work(jsonb,text,boolean,integer),
  app_data_agent.acknowledge_job_cancel(jsonb,text),
  app_data_agent.request_job_cancel(uuid,text),
  app_data_agent.get_job(uuid),
  app_data_agent.list_jobs(uuid,integer),
  app_data_agent.publish_job_worker_heartbeat(jsonb),
  app_data_agent.list_job_capability_readiness(),
  app_data_agent.recover_expired_job_work()
from public,anon,authenticated,service_role,data_agent_backend;

grant execute on function
  app_data_agent.enqueue_job(jsonb),
  app_data_agent.claim_job_work(text,jsonb,integer),
  app_data_agent.start_job_work(jsonb),
  app_data_agent.heartbeat_job_work(jsonb,integer),
  app_data_agent.succeed_job_work(jsonb,jsonb),
  app_data_agent.fail_job_work(jsonb,text,boolean,integer),
  app_data_agent.acknowledge_job_cancel(jsonb,text),
  app_data_agent.request_job_cancel(uuid,text),
  app_data_agent.get_job(uuid),
  app_data_agent.list_jobs(uuid,integer),
  app_data_agent.publish_job_worker_heartbeat(jsonb),
  app_data_agent.list_job_capability_readiness(),
  app_data_agent.recover_expired_job_work()
to data_agent_backend;

do $postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'job_handler_revisions','jobs','job_attempts','job_events','job_output_receipts',
    'job_worker_heartbeats','capability_readiness_receipts'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='app_data_agent' and relation.relname=relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity
        and relation.relowner=(select oid from pg_catalog.pg_roles where rolname='data_agent_u10_job_owner')
    ) then raise exception using errcode='P0001',message='JOB_CENTER_FORCE_RLS_OR_OWNER_MISSING'; end if;
  end loop;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname='data_agent_u10_job_owner'
      and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolinherit and not rolbypassrls
  ) or pg_catalog.pg_has_role('data_agent_u10_job_owner','data_agent_backend','MEMBER')
  then raise exception using errcode='P0001',message='JOB_CENTER_OWNER_FLAGS_UNSAFE'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.jobs','INSERT,UPDATE,DELETE')
    or pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.job_attempts','INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.enqueue_job(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.claim_job_work(text,jsonb,integer)','EXECUTE')
    or pg_catalog.has_function_privilege('anon','app_data_agent.get_job(uuid)','EXECUTE')
    or pg_catalog.has_function_privilege('authenticated','app_data_agent.list_job_capability_readiness()','EXECUTE')
  then raise exception using errcode='P0001',message='JOB_CENTER_GRANT_POSTCONDITION_FAILED'; end if;
  if exists (select 1 from app_data_agent.job_handler_revisions where kind='FILE_SCAN') then
    raise exception using errcode='P0001',message='JOB_CENTER_FILE_SCAN_FORBIDDEN';
  end if;
end
$postconditions$;
