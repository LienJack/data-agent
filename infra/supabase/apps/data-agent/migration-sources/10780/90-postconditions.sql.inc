do $postconditions$
declare expected_document constant jsonb:=
  '{"schema_version":"agent-profile-revision@2.0.0","profile_id":"semantic-management-agent","revision":3,"direct_tool_allowlist":["semantic.catalog.read"],"delegation_ceiling":[],"mandatory_context":["GOAL","POLICY","QUESTION","SCHEMA_MAPPING","SEMANTIC_RELEASE"],"workflow":{"workflow_id":"team.semantic-read.v3","workflow_revision":1},"expected_output_artifact_types":["AnalysisReport"],"verifier":{"verifier_id":"team.semantic-read-verifier.v3","required_dimensions":["execution_valid","intent_grounded","oracle_verified","policy_valid","provenance_valid","schema_valid","scope_valid"],"semantic_fallback":"SEMANTICALLY_UNVERIFIED"},"profile_hash":"sha256:4deee7bace7d3b58dc5ea17849bd1ef965a8a417452dcae7cfd06b6fb5ab5ba9"}'::jsonb;
begin
  if not exists(select 1 from app_data_agent.agent_profile_revisions
      where profile_id='semantic-management-agent' and profile_revision=3
        and profile_hash='sha256:4deee7bace7d3b58dc5ea17849bd1ef965a8a417452dcae7cfd06b6fb5ab5ba9'
        and profile_json=expected_document
        and profile_hash=app_data_agent.u2_canonical_sha256(profile_json-'profile_hash'))
    or not exists(select 1 from pg_catalog.pg_constraint
      where conrelid='app_data_agent.agent_profile_revisions'::pg_catalog.regclass
        and conname='agent_profile_revisions_profile_revision_check'
        and pg_catalog.pg_get_constraintdef(oid) like '%profile_revision <= 3%')
  then raise exception using errcode='P0001',
    message='FALCON24_E1_RUNTIME_PROFILE_REVISION_DRIFT'; end if;
end
$postconditions$;
