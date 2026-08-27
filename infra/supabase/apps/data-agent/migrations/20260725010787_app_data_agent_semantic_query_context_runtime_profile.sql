-- semantic_query_context_runtime_profile_migration_checksum: sha256:243ac35e8066ca9f7c243d8c5c2d08e2801e95b8a88fac02f61a645550e8ddc5
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
  'sha256:243ac35e8066ca9f7c243d8c5c2d08e2801e95b8a88fac02f61a645550e8ddc5');
commit;
