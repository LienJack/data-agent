-- falcon24_e1_runtime_profile_migration_checksum: sha256:8acdad01a6faba24125a78047cb7370b35abe87a9e83dd636f6013b8500bc6bf
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
begin
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app'
      and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010779_app_data_agent_falcon24_e1_gate_attempt_authority')
    or not exists(select 1 from pg_catalog.pg_constraint
      where conrelid='app_data_agent.agent_profile_revisions'::pg_catalog.regclass
        and conname='agent_profile_revisions_profile_revision_check'
        and pg_catalog.pg_get_constraintdef(oid) like '%profile_revision >= 1%'
        and pg_catalog.pg_get_constraintdef(oid) like '%profile_revision <= 2%')
  then raise exception using errcode='P0001',
    message='FALCON24_E1_RUNTIME_PROFILE_BASELINE_DRIFT'; end if;
end
$preflight$;
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
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010780_app_data_agent_falcon24_e1_runtime_profile',
  'sha256:8acdad01a6faba24125a78047cb7370b35abe87a9e83dd636f6013b8500bc6bf');
commit;
