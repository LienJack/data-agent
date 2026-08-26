alter table app_data_agent.agent_profile_revisions
  drop constraint agent_profile_revisions_profile_revision_check;
alter table app_data_agent.agent_profile_revisions
  add constraint agent_profile_revisions_profile_revision_check
  check(profile_revision between 1 and 3);

insert into app_data_agent.agent_profile_revisions(
  profile_id,profile_revision,profile_hash,profile_json)
values(
  'semantic-management-agent',3,
  'sha256:4deee7bace7d3b58dc5ea17849bd1ef965a8a417452dcae7cfd06b6fb5ab5ba9',
  '{"schema_version":"agent-profile-revision@2.0.0","profile_id":"semantic-management-agent","revision":3,"direct_tool_allowlist":["semantic.catalog.read"],"delegation_ceiling":[],"mandatory_context":["GOAL","POLICY","QUESTION","SCHEMA_MAPPING","SEMANTIC_RELEASE"],"workflow":{"workflow_id":"team.semantic-read.v3","workflow_revision":1},"expected_output_artifact_types":["AnalysisReport"],"verifier":{"verifier_id":"team.semantic-read-verifier.v3","required_dimensions":["execution_valid","intent_grounded","oracle_verified","policy_valid","provenance_valid","schema_valid","scope_valid"],"semantic_fallback":"SEMANTICALLY_UNVERIFIED"},"profile_hash":"sha256:4deee7bace7d3b58dc5ea17849bd1ef965a8a417452dcae7cfd06b6fb5ab5ba9"}'::jsonb)
on conflict(profile_id,profile_revision) do nothing;
