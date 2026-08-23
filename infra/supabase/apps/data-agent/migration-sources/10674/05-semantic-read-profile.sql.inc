alter table app_data_agent.agent_profile_revisions
  drop constraint agent_profile_revisions_profile_revision_check;
alter table app_data_agent.agent_profile_revisions
  add constraint agent_profile_revisions_profile_revision_check
  check(profile_revision between 1 and 2);

insert into app_data_agent.agent_profile_revisions(
  profile_id,profile_revision,profile_hash,profile_json)
values(
  'semantic-management-agent',2,
  'sha256:bae4ec47ca7c23a0ac046c0086051d3696752586f09534572440fb1af1edf3f3',
  '{"schema_version":"agent-profile-revision@2.0.0","profile_id":"semantic-management-agent","revision":2,"direct_tool_allowlist":["semantic.candidate.write","semantic.catalog.read"],"delegation_ceiling":[],"mandatory_context":["GOAL","POLICY","QUESTION","SCHEMA_MAPPING"],"workflow":{"workflow_id":"team.semantic-read.v2","workflow_revision":1},"expected_output_artifact_types":["AnalysisReport","SemanticGraphCandidate"],"verifier":{"verifier_id":"team.semantic-read-verifier.v2","required_dimensions":["execution_valid","intent_grounded","oracle_verified","policy_valid","provenance_valid","schema_valid","scope_valid"],"semantic_fallback":"SEMANTICALLY_UNVERIFIED"},"profile_hash":"sha256:bae4ec47ca7c23a0ac046c0086051d3696752586f09534572440fb1af1edf3f3"}'::jsonb)
on conflict(profile_id,profile_revision) do nothing;

do $semantic_runtime_profile_v2_exact$
begin
  if not exists(select 1 from app_data_agent.agent_profile_revisions
    where profile_id='semantic-management-agent' and profile_revision=2
      and profile_hash='sha256:bae4ec47ca7c23a0ac046c0086051d3696752586f09534572440fb1af1edf3f3'
      and profile_json=
        '{"schema_version":"agent-profile-revision@2.0.0","profile_id":"semantic-management-agent","revision":2,"direct_tool_allowlist":["semantic.candidate.write","semantic.catalog.read"],"delegation_ceiling":[],"mandatory_context":["GOAL","POLICY","QUESTION","SCHEMA_MAPPING"],"workflow":{"workflow_id":"team.semantic-read.v2","workflow_revision":1},"expected_output_artifact_types":["AnalysisReport","SemanticGraphCandidate"],"verifier":{"verifier_id":"team.semantic-read-verifier.v2","required_dimensions":["execution_valid","intent_grounded","oracle_verified","policy_valid","provenance_valid","schema_valid","scope_valid"],"semantic_fallback":"SEMANTICALLY_UNVERIFIED"},"profile_hash":"sha256:bae4ec47ca7c23a0ac046c0086051d3696752586f09534572440fb1af1edf3f3"}'::jsonb)
  then raise exception using errcode='23505',message='AGENT_SEMANTIC_RUNTIME_PROFILE_V2_CONFLICT'; end if;
end
$semantic_runtime_profile_v2_exact$;

do $semantic_product_profile_v2$
declare current_profile record; successor jsonb; successor_hash text; now_at timestamptz;
begin
  now_at:=pg_catalog.clock_timestamp();
  for current_profile in
    select revision.*,head.version as head_version,head.lifecycle,head.updated_by
    from app_data_agent.agent_product_profile_heads head
    join app_data_agent.agent_product_profile_revisions revision
      on revision.app_id=head.app_id and revision.tenant_id=head.tenant_id
      and revision.environment=head.environment and revision.profile_id=head.profile_id
      and revision.revision=head.active_revision
      and revision.revision_hash=head.active_revision_hash
    where head.profile_id='semantic-management-agent'
      and revision.document_json#>>'{runtime_profile_ref,revision}'='1'
      and revision.document_json#>>'{runtime_profile_ref,profile_hash}'=
        'sha256:92910b6741ada7b2e5377c0b00b3ff2c64be7f0fb5567161359dfbabd4814b38'
  loop
    successor:=pg_catalog.jsonb_set(current_profile.document_json,'{revision}','2'::jsonb,false);
    successor:=pg_catalog.jsonb_set(successor,'{runtime_profile_ref}',pg_catalog.jsonb_build_object(
      'profile_id','semantic-management-agent','revision',2,
      'profile_hash','sha256:bae4ec47ca7c23a0ac046c0086051d3696752586f09534572440fb1af1edf3f3'),false);
    successor:=pg_catalog.jsonb_set(successor,'{expected_output_artifact_types}',
      '["AnalysisReport","SemanticGraphCandidate"]'::jsonb,false);
    successor:=pg_catalog.jsonb_set(successor,'{verifier_contract_hash}',pg_catalog.to_jsonb(
      app_data_agent.u2_canonical_sha256(
        (select profile_json->'verifier' from app_data_agent.agent_profile_revisions
          where profile_id='semantic-management-agent' and profile_revision=2))),false);
    successor_hash:=app_data_agent.u2_canonical_sha256(successor-'revision_hash'::text);
    successor:=pg_catalog.jsonb_set(successor,'{revision_hash}',pg_catalog.to_jsonb(successor_hash),false);
    insert into app_data_agent.agent_product_profile_revisions(
      app_id,tenant_id,environment,profile_id,revision,revision_hash,approval_status,
      document_json,created_by,created_at)
    values(current_profile.app_id,current_profile.tenant_id,current_profile.environment,
      current_profile.profile_id,2,successor_hash,current_profile.approval_status,
      successor,current_profile.created_by,now_at)
    on conflict(app_id,tenant_id,environment,profile_id,revision) do nothing;
    if not exists(select 1 from app_data_agent.agent_product_profile_revisions revision
      where revision.app_id=current_profile.app_id and revision.tenant_id=current_profile.tenant_id
        and revision.environment=current_profile.environment
        and revision.profile_id='semantic-management-agent' and revision.revision=2
        and revision.revision_hash=successor_hash and revision.document_json=successor)
    then raise exception using errcode='23505',message='AGENT_SEMANTIC_PROFILE_V2_CONFLICT'; end if;
    update app_data_agent.agent_product_profile_heads head set
      active_revision=2,active_revision_hash=successor_hash,version=head.version+1,
      updated_by=current_profile.updated_by,updated_at=now_at
    where head.app_id=current_profile.app_id and head.tenant_id=current_profile.tenant_id
      and head.environment=current_profile.environment and head.profile_id=current_profile.profile_id
      and head.version=current_profile.head_version;
    if not found then
      raise exception using errcode='40001',message='AGENT_SEMANTIC_PROFILE_V2_HEAD_CONFLICT';
    end if;
  end loop;
end
$semantic_product_profile_v2$;
