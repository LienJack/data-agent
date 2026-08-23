alter table app_data_agent.mcp_server_revisions owner to data_agent_u14_extension_owner;
alter table app_data_agent.mcp_server_heads owner to data_agent_u14_extension_owner;
alter table app_data_agent.skill_revisions owner to data_agent_u14_extension_owner;
alter table app_data_agent.skill_heads owner to data_agent_u14_extension_owner;
alter table app_data_agent.skill_signer_revocations owner to data_agent_u14_extension_owner;
alter table app_data_agent.extension_operation_receipts owner to data_agent_u14_extension_owner;
alter table app_data_agent.tool_effects owner to data_agent_u14_extension_owner;
alter table app_data_agent.tool_effect_transitions owner to data_agent_u14_extension_owner;
alter function app_data_agent.reject_extension_immutable_mutation() owner to data_agent_u14_extension_owner;
alter function app_data_agent.commit_extension_revision(jsonb) owner to data_agent_u14_extension_owner;
alter function app_data_agent.list_extension_revisions(text,boolean) owner to data_agent_u14_extension_owner;
alter function app_data_agent.revoke_skill_signer(jsonb) owner to data_agent_u14_extension_owner;
alter function app_data_agent.resolve_extension_config_reference(text,uuid,bigint,text)
  owner to data_agent_u14_extension_owner;
alter function app_data_agent.build_requested_optional_resource_bindings(jsonb)
  owner to data_agent_u14_extension_owner;
alter function app_data_agent.build_inherited_optional_resource_bindings(jsonb,jsonb)
  owner to data_agent_u14_extension_owner;
alter function app_data_agent.begin_tool_effect(jsonb) owner to data_agent_u14_extension_owner;
alter function app_data_agent.transition_tool_effect(jsonb) owner to data_agent_u14_extension_owner;
grant usage on schema app_data_agent,platform to data_agent_u14_extension_owner;
grant execute on function platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.resolved_context_exact_keys(jsonb,text[]) to data_agent_u14_extension_owner;
grant execute on function app_data_agent.lock_owned_run_fence(uuid) to data_agent_u14_extension_owner;
grant execute on function app_data_agent.resolve_extension_config_reference(text,uuid,bigint,text)
  to data_agent_u14_extension_owner;
revoke all on app_data_agent.mcp_server_revisions,app_data_agent.mcp_server_heads,
  app_data_agent.skill_revisions,app_data_agent.skill_heads,app_data_agent.skill_signer_revocations,
  app_data_agent.extension_operation_receipts from public,anon,authenticated,service_role,data_agent_backend;
revoke all on app_data_agent.tool_effects,app_data_agent.tool_effect_transitions
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.commit_extension_revision(jsonb),
  app_data_agent.list_extension_revisions(text,boolean)
  ,app_data_agent.revoke_skill_signer(jsonb),app_data_agent.begin_tool_effect(jsonb),
  app_data_agent.transition_tool_effect(jsonb),
  app_data_agent.resolve_extension_config_reference(text,uuid,bigint,text),
  app_data_agent.build_requested_optional_resource_bindings(jsonb),
  app_data_agent.build_inherited_optional_resource_bindings(jsonb,jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.build_requested_optional_resource_bindings(jsonb),
  app_data_agent.build_inherited_optional_resource_bindings(jsonb,jsonb)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.commit_extension_revision(jsonb),
  app_data_agent.list_extension_revisions(text,boolean),app_data_agent.revoke_skill_signer(jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.begin_tool_effect(jsonb),
  app_data_agent.transition_tool_effect(jsonb) to data_agent_backend;

do $postconditions$
begin
  if exists(select 1 from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace
    on namespace.oid=relation.relnamespace where namespace.nspname='app_data_agent'
      and relation.relname in ('mcp_server_revisions','mcp_server_heads','skill_revisions','skill_heads',
        'skill_signer_revocations','extension_operation_receipts','tool_effects','tool_effect_transitions')
      and (not relation.relrowsecurity or not relation.relforcerowsecurity
        or relation.relowner<>(select oid from pg_catalog.pg_roles where rolname='data_agent_u14_extension_owner')))
  then raise exception using errcode='P0001',message='U14_EXTENSION_RLS_OR_OWNER_UNSAFE'; end if;
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u14_extension_owner'
    and not rolcanlogin and not rolsuper and not rolinherit and not rolbypassrls)
  then raise exception using errcode='P0001',message='U14_EXTENSION_OWNER_FLAGS_UNSAFE'; end if;
end
$postconditions$;
