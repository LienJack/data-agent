alter table app_data_agent.agent_profile_revisions
  drop constraint agent_profile_revisions_profile_revision_check;
alter table app_data_agent.agent_profile_revisions
  add constraint agent_profile_revisions_profile_revision_check
  check(profile_revision between 1 and 4);

insert into app_data_agent.agent_profile_revisions(
  profile_id,profile_revision,profile_hash,profile_json)
values(
  'semantic-management-agent',4,
  'sha256:d9128bf434a39a03611583a26ba7425a3e45af4cabc9190de6135116df520873',
  '{"schema_version":"agent-profile-revision@2.0.0","profile_id":"semantic-management-agent","revision":4,"direct_tool_allowlist":["semantic.catalog.read"],"delegation_ceiling":[],"mandatory_context":["GOAL","POLICY","QUESTION","SCHEMA_MAPPING","SEMANTIC_RELEASE"],"workflow":{"workflow_id":"team.semantic-query-context.v4","workflow_revision":1},"expected_output_artifact_types":["SemanticQueryContext"],"verifier":{"verifier_id":"team.semantic-query-context-verifier.v4","required_dimensions":["execution_valid","intent_grounded","oracle_verified","policy_valid","provenance_valid","schema_valid","scope_valid"],"semantic_fallback":"SEMANTICALLY_UNVERIFIED"},"profile_hash":"sha256:d9128bf434a39a03611583a26ba7425a3e45af4cabc9190de6135116df520873"}'::jsonb)
on conflict(profile_id,profile_revision) do nothing;
