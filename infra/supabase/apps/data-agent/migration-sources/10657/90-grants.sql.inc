revoke all on app_data_agent.artifact_export_receipts from public,data_agent_backend,anon,authenticated;
revoke all on function app_data_agent.reject_artifact_export_receipt_mutation() from public;
revoke all on function app_data_agent.create_artifact_export_receipt(jsonb,jsonb) from public,anon,authenticated;
revoke all on function app_data_agent.load_artifact_export_receipt(jsonb) from public,anon,authenticated;

grant usage on schema app_data_agent,platform
  to data_agent_u7_artifact_export_owner;
grant execute on function app_data_agent.create_artifact_export_receipt(jsonb,jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.load_artifact_export_receipt(jsonb)
  to data_agent_backend;
grant execute on function platform.backend_context_matches(uuid,uuid,text,boolean),
  platform.backend_run_object_matches(uuid,uuid,text,uuid,boolean),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.provider_json_object_has_exact_keys(jsonb,text[]),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text)
  to data_agent_u7_artifact_export_owner;

do $postconditions$
begin
  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname='data_agent_u7_artifact_export_owner'
      and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolinherit or rolbypassrls)
  ) then
    raise exception 'ARTIFACT_EXPORT_OWNER_FLAGS_UNSAFE';
  end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.artifact_export_receipts','INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.create_artifact_export_receipt(jsonb,jsonb)','EXECUTE'
    ) or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.load_artifact_export_receipt(jsonb)','EXECUTE'
    )
  then
    raise exception 'ARTIFACT_EXPORT_GRANT_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;
