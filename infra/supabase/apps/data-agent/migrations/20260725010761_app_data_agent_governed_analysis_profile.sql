-- governed_analysis_profile_migration_checksum: sha256:8fea6fbc0befe3252a3ce92f825c33a8e8df6b719da89268cfcfb8b05ee0b253
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='GOVERNED_ANALYSIS_PROFILE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='GOVERNED_ANALYSIS_PROFILE_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010760_app_data_agent_analysis_authority_row_lock_policy')
  then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_PROFILE_BASELINE_10760_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
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
  'governed-analysis-agent',2,
  'sha256:e5f85f6b0a7e4b582f13cb9bb24a08e03c1c01e6721760afb94003d4c883b019',
  '{"schema_version":"agent-profile-revision@2.0.0","profile_id":"governed-analysis-agent","revision":2,"direct_tool_allowlist":["analysis.program.execute"],"delegation_ceiling":[],"mandatory_context":["GOAL","POLICY","QUERY_EVIDENCE","QUESTION","SCHEMA_MAPPING","SEMANTIC_RELEASE"],"workflow":{"workflow_id":"team.governed-analysis.v2","workflow_revision":1},"expected_output_artifact_types":["AnalysisReport"],"verifier":{"verifier_id":"team.governed-analysis-verifier.v2","required_dimensions":["execution_valid","intent_grounded","oracle_verified","policy_valid","provenance_valid","schema_valid","scope_valid"],"semantic_fallback":"NEEDS_CLARIFICATION"},"profile_hash":"sha256:e5f85f6b0a7e4b582f13cb9bb24a08e03c1c01e6721760afb94003d4c883b019"}'::jsonb
)
on conflict(profile_id,profile_revision) do nothing;
do $postconditions$
declare profile_constraint text;
begin
  select pg_catalog.pg_get_constraintdef(oid) into profile_constraint
  from pg_catalog.pg_constraint
  where conrelid='app_data_agent.agent_profile_revisions'::pg_catalog.regclass
    and conname='agent_profile_revisions_profile_id_check';
  if profile_constraint is null
    or pg_catalog.strpos(profile_constraint,'governed-analysis-agent')=0
  then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_PROFILE_CONSTRAINT_DRIFT'; end if;

  if not exists(select 1 from app_data_agent.agent_profile_revisions
    where profile_id='data-agent-orchestrator' and profile_revision=1
      and profile_hash='sha256:c46b9eb899fe2dd1592b914b509268b8281736ad223181be5a4e998ecd9eddad')
  then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_HISTORICAL_ROOT_MISSING'; end if;

  if not exists(select 1 from app_data_agent.agent_profile_revisions
    where profile_id='data-agent-orchestrator' and profile_revision=2
      and profile_hash='sha256:bfe92aae492252be7667e3fe8631bf6cd4107db49a2f19edd29295dacd49d65d'
      and profile_hash=app_data_agent.u2_canonical_sha256(profile_json-'profile_hash'))
  then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_ROOT_V2_DRIFT'; end if;

  if not exists(select 1 from app_data_agent.agent_profile_revisions
    where profile_id='governed-analysis-agent' and profile_revision=2
      and profile_hash='sha256:e5f85f6b0a7e4b582f13cb9bb24a08e03c1c01e6721760afb94003d4c883b019'
      and profile_json->'mandatory_context' ? 'QUERY_EVIDENCE'
      and profile_hash=app_data_agent.u2_canonical_sha256(profile_json-'profile_hash'))
  then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_SPECIALIST_DRIFT'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010761_app_data_agent_governed_analysis_profile',
  'sha256:8fea6fbc0befe3252a3ce92f825c33a8e8df6b719da89268cfcfb8b05ee0b253');
commit;
