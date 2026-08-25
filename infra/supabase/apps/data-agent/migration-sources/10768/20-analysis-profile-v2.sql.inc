insert into app_data_agent.agent_profile_revisions(
  profile_id,profile_revision,profile_hash,profile_json)
values
(
  'governed-analysis-agent',2,
  'sha256:e5f85f6b0a7e4b582f13cb9bb24a08e03c1c01e6721760afb94003d4c883b019',
  '{"schema_version":"agent-profile-revision@2.0.0","profile_id":"governed-analysis-agent","revision":2,"direct_tool_allowlist":["analysis.program.execute"],"delegation_ceiling":[],"mandatory_context":["GOAL","POLICY","QUERY_EVIDENCE","QUESTION","SCHEMA_MAPPING","SEMANTIC_RELEASE"],"workflow":{"workflow_id":"team.governed-analysis.v2","workflow_revision":1},"expected_output_artifact_types":["AnalysisReport"],"verifier":{"verifier_id":"team.governed-analysis-verifier.v2","required_dimensions":["execution_valid","intent_grounded","oracle_verified","policy_valid","provenance_valid","schema_valid","scope_valid"],"semantic_fallback":"NEEDS_CLARIFICATION"},"profile_hash":"sha256:e5f85f6b0a7e4b582f13cb9bb24a08e03c1c01e6721760afb94003d4c883b019"}'::jsonb
)
on conflict(profile_id,profile_revision) do nothing;

alter table app_data_agent.agent_product_profile_revisions
  drop constraint agent_product_profile_revisions_profile_id_check;
