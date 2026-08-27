begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare expected_predecessor constant jsonb:=
  '{"schema_version":"agent-profile-revision@2.0.0","profile_id":"semantic-management-agent","revision":3,"direct_tool_allowlist":["semantic.catalog.read"],"delegation_ceiling":[],"mandatory_context":["GOAL","POLICY","QUESTION","SCHEMA_MAPPING","SEMANTIC_RELEASE"],"workflow":{"workflow_id":"team.semantic-read.v3","workflow_revision":1},"expected_output_artifact_types":["AnalysisReport"],"verifier":{"verifier_id":"team.semantic-read-verifier.v3","required_dimensions":["execution_valid","intent_grounded","oracle_verified","policy_valid","provenance_valid","schema_valid","scope_valid"],"semantic_fallback":"SEMANTICALLY_UNVERIFIED"},"profile_hash":"sha256:4deee7bace7d3b58dc5ea17849bd1ef965a8a417452dcae7cfd06b6fb5ab5ba9"}'::jsonb;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010786_app_data_agent_conversation_context_summary_compatibility')
    or not exists(select 1 from app_data_agent.agent_profile_revisions
      where profile_id='semantic-management-agent' and profile_revision=3
        and profile_hash='sha256:4deee7bace7d3b58dc5ea17849bd1ef965a8a417452dcae7cfd06b6fb5ab5ba9'
        and profile_json=expected_predecessor)
    or not exists(select 1 from pg_catalog.pg_constraint
      where conrelid='app_data_agent.agent_profile_revisions'::pg_catalog.regclass
        and conname='agent_profile_revisions_profile_revision_check'
        and pg_catalog.pg_get_constraintdef(oid) like '%profile_revision <= 3%')
  then raise exception using errcode='P0001',
    message='SEMANTIC_QUERY_CONTEXT_RUNTIME_PROFILE_BASELINE_DRIFT'; end if;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
