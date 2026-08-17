alter table app_data_agent.agent_product_profile_revisions owner to data_agent_u20_profile_owner;
alter table app_data_agent.agent_product_profile_heads owner to data_agent_u20_profile_owner;
alter table app_data_agent.agent_product_profile_operation_receipts owner to data_agent_u20_profile_owner;
alter function app_data_agent.reject_agent_profile_immutable_mutation() owner to data_agent_u20_profile_owner;
alter function app_data_agent.commit_agent_profile_revision(jsonb) owner to data_agent_u20_profile_owner;
alter function app_data_agent.list_agent_profile_revisions(boolean) owner to data_agent_u20_profile_owner;
alter function app_data_agent.current_agent_product_profile_refs() owner to data_agent_u20_profile_owner;
alter function app_data_agent.route_question_run_to_agent_team() owner to data_agent_u20_profile_owner;
alter function app_data_agent.assert_provider_active_worker_lease_pre_u20(jsonb)
  owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.assert_provider_active_worker_lease(jsonb)
  owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.load_agent_team_public_projection(uuid)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.public_run_display_payload_is_valid(text,jsonb)
  owner to data_agent_u20_profile_owner;
grant usage on schema app_data_agent,platform to data_agent_u20_profile_owner;
grant execute on function platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  platform.canonical_sha256(jsonb),
  app_data_agent.u2_canonical_sha256(jsonb),app_data_agent.resolved_context_exact_keys(jsonb,text[])
  to data_agent_u20_profile_owner;
grant select on app_data_agent.skill_revisions,app_data_agent.skill_heads,
  app_data_agent.skill_signer_revocations,app_data_agent.agent_profile_revisions
  to data_agent_u20_profile_owner;
revoke all on function app_data_agent.public_run_display_payload_is_valid(text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function app_data_agent.public_run_display_payload_is_valid(text,jsonb)
  to data_agent_backend,data_agent_job_authority;
revoke all on app_data_agent.agent_product_profile_revisions,
  app_data_agent.agent_product_profile_heads,app_data_agent.agent_product_profile_operation_receipts
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.commit_agent_profile_revision(jsonb),
  app_data_agent.list_agent_profile_revisions(boolean),
  app_data_agent.current_agent_product_profile_refs(),
  app_data_agent.route_question_run_to_agent_team()
  from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.commit_agent_profile_revision(jsonb),
  app_data_agent.list_agent_profile_revisions(boolean) to data_agent_backend;
revoke all on function app_data_agent.load_agent_team_public_projection(uuid)
  from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.load_agent_team_public_projection(uuid)
  to data_agent_backend;
revoke all on function app_data_agent.assert_provider_active_worker_lease_pre_u20(jsonb),
  app_data_agent.assert_provider_active_worker_lease(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

do $postconditions$
begin
  if exists(select 1 from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace
    on namespace.oid=relation.relnamespace where namespace.nspname='app_data_agent'
      and relation.relname in ('agent_product_profile_revisions','agent_product_profile_heads',
        'agent_product_profile_operation_receipts')
      and (not relation.relrowsecurity or not relation.relforcerowsecurity
        or relation.relowner<>(select oid from pg_catalog.pg_roles
          where rolname='data_agent_u20_profile_owner')))
  then raise exception using errcode='P0001',message='U20_AGENT_PROFILE_RLS_OR_OWNER_UNSAFE'; end if;
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u20_profile_owner'
    and not rolcanlogin and not rolsuper and not rolinherit and not rolbypassrls)
  then raise exception using errcode='P0001',message='U20_AGENT_PROFILE_OWNER_FLAGS_UNSAFE'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend',
    'app_data_agent.agent_product_profile_revisions','INSERT,UPDATE,DELETE')
  then raise exception using errcode='P0001',message='U20_AGENT_PROFILE_BACKEND_DML_UNSAFE'; end if;
end
$postconditions$;
