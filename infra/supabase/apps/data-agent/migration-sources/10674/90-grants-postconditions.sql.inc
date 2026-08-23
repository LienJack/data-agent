alter table app_data_agent.agent_dispatch_rollout_policies
  owner to data_agent_u19_team_owner;
alter table app_data_agent.agent_dispatch_deferred_receipts
  owner to data_agent_u19_team_owner;
alter table app_data_agent.agent_dispatch_execute_receipts
  owner to data_agent_u19_team_owner;
alter function app_data_agent.resolve_agent_dispatch_rollout_policy(text)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.set_agent_dispatch_rollout_policy(text,bigint)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.commit_agent_dispatch_deferred(text,text,jsonb)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.commit_agent_dispatch_execute_internal(text,jsonb,jsonb)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.agent_dispatch_profile_refs_are_canonical(jsonb)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.agent_dispatch_plan_ref_is_valid(jsonb)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.agent_dispatch_direct_receipt_is_valid(jsonb,text,text)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.agent_dispatch_plan_is_valid(jsonb,text)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.agent_dispatch_binding_is_valid(jsonb,jsonb,text)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.agent_dispatch_execute_receipt_is_valid(jsonb,jsonb,text)
  owner to data_agent_u19_team_owner;

revoke all on app_data_agent.agent_dispatch_rollout_policies,
  app_data_agent.agent_dispatch_deferred_receipts,
  app_data_agent.agent_dispatch_execute_receipts from public,data_agent_backend;
revoke all on function app_data_agent.resolve_agent_dispatch_rollout_policy(text),
  app_data_agent.set_agent_dispatch_rollout_policy(text,bigint),
  app_data_agent.commit_agent_dispatch_deferred(text,text,jsonb),
  app_data_agent.commit_agent_dispatch_execute_internal(text,jsonb,jsonb) from public;
grant execute on function app_data_agent.resolve_agent_dispatch_rollout_policy(text),
  app_data_agent.set_agent_dispatch_rollout_policy(text,bigint),
  app_data_agent.commit_agent_dispatch_deferred(text,text,jsonb) to data_agent_backend;
grant execute on function app_data_agent.commit_agent_dispatch_execute_internal(text,jsonb,jsonb)
  to data_agent_effective_config_rpc_owner;

do $postcondition$
begin
  if not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.resolve_agent_dispatch_rollout_policy(text)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.set_agent_dispatch_rollout_policy(text,bigint)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_agent_dispatch_deferred(text,text,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_effective_config_rpc_owner',
      'app_data_agent.commit_agent_dispatch_execute_internal(text,jsonb,jsonb)','EXECUTE')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.agent_dispatch_execute_receipts','INSERT')
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure),
      'effective-config-team-lease@2.0.0')=0
    or not exists(select 1 from app_data_agent.agent_profile_revisions
      where profile_id='semantic-management-agent' and profile_revision=1
        and profile_hash='sha256:92910b6741ada7b2e5377c0b00b3ff2c64be7f0fb5567161359dfbabd4814b38')
    or not exists(select 1 from app_data_agent.agent_profile_revisions
      where profile_id='semantic-management-agent' and profile_revision=2
        and profile_hash='sha256:bae4ec47ca7c23a0ac046c0086051d3696752586f09534572440fb1af1edf3f3')
    or exists(select 1 from app_data_agent.agent_product_profile_heads head
      join app_data_agent.agent_product_profile_revisions revision
        on revision.app_id=head.app_id and revision.tenant_id=head.tenant_id
        and revision.environment=head.environment and revision.profile_id=head.profile_id
        and revision.revision=head.active_revision
        and revision.revision_hash=head.active_revision_hash
      where head.profile_id='semantic-management-agent'
        and (head.active_revision<>2
          or revision.document_json#>>'{runtime_profile_ref,revision}'<>'2'
          or revision.document_json#>>'{runtime_profile_ref,profile_hash}'<>
            'sha256:bae4ec47ca7c23a0ac046c0086051d3696752586f09534572440fb1af1edf3f3'
          or revision.document_json->'expected_output_artifact_types'<>
            '["AnalysisReport","SemanticGraphCandidate"]'::jsonb
          or not exists(select 1 from app_data_agent.agent_product_profile_revisions legacy
            where legacy.app_id=head.app_id and legacy.tenant_id=head.tenant_id
              and legacy.environment=head.environment and legacy.profile_id=head.profile_id
              and legacy.revision=1)))
  then raise exception using errcode='P0001',message='AGENT_DISPATCH_POSTCONDITION_FAILED'; end if;
end
$postcondition$;
