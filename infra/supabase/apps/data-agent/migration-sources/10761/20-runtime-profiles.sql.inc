alter table app_data_agent.agent_profile_revisions
  drop constraint agent_profile_revisions_profile_id_check;
alter table app_data_agent.agent_profile_revisions
  add constraint agent_profile_revisions_profile_id_check check(profile_id in (
    'data-agent-orchestrator','governed-analysis-agent','semantic-management-agent',
    'governed-text2sql-agent','report-writing-agent'
  ));

insert into app_data_agent.agent_profile_revisions(
  profile_id,profile_revision,profile_hash,profile_json)
values
(
  'data-agent-orchestrator',2,
  'sha256:bfe92aae492252be7667e3fe8631bf6cd4107db49a2f19edd29295dacd49d65d',
  '{"schema_version":"agent-profile-revision@2.0.0","profile_id":"data-agent-orchestrator","revision":2,"direct_tool_allowlist":[],"delegation_ceiling":["governed-analysis-agent","governed-text2sql-agent","report-writing-agent","semantic-management-agent"],"mandatory_context":["GOAL","OPEN_OBLIGATIONS","POLICY","QUESTION"],"workflow":{"workflow_id":"team.orchestrator.v3","workflow_revision":1},"expected_output_artifact_types":["ReportManifest"],"verifier":{"verifier_id":"team.orchestrator-verifier.v3","required_dimensions":["execution_valid","intent_grounded","oracle_verified","policy_valid","provenance_valid","schema_valid","scope_valid"],"semantic_fallback":"NEEDS_CLARIFICATION"},"profile_hash":"sha256:bfe92aae492252be7667e3fe8631bf6cd4107db49a2f19edd29295dacd49d65d"}'::jsonb
),
(
  'governed-analysis-agent',1,
  'sha256:265abb762fd9466d5ce8bee79bb43b823ff18621b1b728a645b84bb4356be7f6',
  '{"schema_version":"agent-profile-revision@2.0.0","profile_id":"governed-analysis-agent","revision":1,"direct_tool_allowlist":["analysis.python.execute"],"delegation_ceiling":[],"mandatory_context":["GOAL","POLICY","QUESTION","SCHEMA_MAPPING","SEMANTIC_RELEASE"],"workflow":{"workflow_id":"team.governed-analysis.v2","workflow_revision":1},"expected_output_artifact_types":["AnalysisReport"],"verifier":{"verifier_id":"team.governed-analysis-verifier.v2","required_dimensions":["execution_valid","intent_grounded","oracle_verified","policy_valid","provenance_valid","schema_valid","scope_valid"],"semantic_fallback":"NEEDS_CLARIFICATION"},"profile_hash":"sha256:265abb762fd9466d5ce8bee79bb43b823ff18621b1b728a645b84bb4356be7f6"}'::jsonb
)
on conflict(profile_id,profile_revision) do nothing;
