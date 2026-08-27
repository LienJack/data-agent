do $postconditions$
declare expected_document constant jsonb:=
  '{"schema_version":"agent-profile-revision@2.0.0","profile_id":"semantic-management-agent","revision":4,"direct_tool_allowlist":["semantic.catalog.read"],"delegation_ceiling":[],"mandatory_context":["GOAL","POLICY","QUESTION","SCHEMA_MAPPING","SEMANTIC_RELEASE"],"workflow":{"workflow_id":"team.semantic-query-context.v4","workflow_revision":1},"expected_output_artifact_types":["SemanticQueryContext"],"verifier":{"verifier_id":"team.semantic-query-context-verifier.v4","required_dimensions":["execution_valid","intent_grounded","oracle_verified","policy_valid","provenance_valid","schema_valid","scope_valid"],"semantic_fallback":"SEMANTICALLY_UNVERIFIED"},"profile_hash":"sha256:d9128bf434a39a03611583a26ba7425a3e45af4cabc9190de6135116df520873"}'::jsonb;
begin
  if not exists(select 1 from app_data_agent.agent_profile_revisions
      where profile_id='semantic-management-agent' and profile_revision=4
        and profile_hash='sha256:d9128bf434a39a03611583a26ba7425a3e45af4cabc9190de6135116df520873'
        and profile_json=expected_document
        and profile_hash=app_data_agent.u2_canonical_sha256(profile_json-'profile_hash'))
    or not exists(select 1 from pg_catalog.pg_constraint
      where conrelid='app_data_agent.agent_profile_revisions'::pg_catalog.regclass
        and conname='agent_profile_revisions_profile_revision_check'
        and pg_catalog.pg_get_constraintdef(oid) like '%profile_revision <= 4%')
  then raise exception using errcode='P0001',
    message='SEMANTIC_QUERY_CONTEXT_RUNTIME_PROFILE_POSTCONDITION_FAILED'; end if;
end
$postconditions$;

select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010787_app_data_agent_semantic_query_context_runtime_profile',
  '__SEMANTIC_QUERY_CONTEXT_RUNTIME_PROFILE_MIGRATION_CHECKSUM__');
