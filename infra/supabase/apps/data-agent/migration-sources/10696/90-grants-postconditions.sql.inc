alter table app_data_agent.subagent_capability_catalog_snapshots owner to data_agent_u19_team_owner;
alter function app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.commit_subagent_catalog_snapshot_internal(text,jsonb)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.load_subagent_catalog_snapshot(uuid,uuid)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.list_agent_profile_revisions_v2(boolean)
  owner to data_agent_u20_profile_owner;
alter function app_data_agent.commit_agent_profile_revision_v2(jsonb)
  owner to data_agent_u20_profile_owner;

revoke all on app_data_agent.subagent_capability_catalog_snapshots from public,data_agent_backend;
revoke all on function app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text),
  app_data_agent.commit_subagent_catalog_snapshot_internal(text,jsonb),
  app_data_agent.load_subagent_catalog_snapshot(uuid,uuid),
  app_data_agent.list_agent_profile_revisions_v2(boolean),
  app_data_agent.commit_agent_profile_revision_v2(jsonb) from public;
grant execute on function app_data_agent.load_subagent_catalog_snapshot(uuid,uuid)
  to data_agent_backend;
grant execute on function app_data_agent.list_agent_profile_revisions_v2(boolean),
  app_data_agent.commit_agent_profile_revision_v2(jsonb) to data_agent_backend;
grant execute on function app_data_agent.commit_subagent_catalog_snapshot_internal(text,jsonb)
  to data_agent_effective_config_rpc_owner;

do $postconditions$
begin
  if not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_subagent_catalog_snapshot(uuid,uuid)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.list_agent_profile_revisions_v2(boolean)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_agent_profile_revision_v2(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_effective_config_rpc_owner',
      'app_data_agent.commit_subagent_catalog_snapshot_internal(text,jsonb)','EXECUTE')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.subagent_capability_catalog_snapshots','INSERT')
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.command_payload_is_valid(jsonb)'::regprocedure),
      'effective-config-team-lease@3.0.0')=0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure),
      'subagent_catalog_snapshot')=0
    or exists(select 1 from app_data_agent.agent_product_profile_heads head
      join app_data_agent.agent_product_profile_revisions revision
        on revision.app_id=head.app_id and revision.tenant_id=head.tenant_id
        and revision.environment=head.environment and revision.profile_id=head.profile_id
        and revision.revision=head.active_revision and revision.revision_hash=head.active_revision_hash
      where head.profile_id in(
        'governed-text2sql-agent','report-writing-agent','semantic-management-agent')
        and revision.document_json->>'schema_version'<>'agent-product-profile-revision@2.0.0')
  then raise exception using errcode='P0001',message='SUBAGENT_HARNESS_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
