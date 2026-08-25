-- governed_analysis_profile_v2_migration_checksum: sha256:bef39951b72aa191b6ed7819a1c04472fa4630427c737363faf518a31796209e
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='GOVERNED_ANALYSIS_PROFILE_V2_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='GOVERNED_ANALYSIS_PROFILE_V2_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010767_app_data_agent_accepted_sibling_output_attachment')
  then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_PROFILE_V2_BASELINE_10767_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
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
do $postconditions$
declare generic_profile_constraint text;
begin
  if not exists(select 1 from app_data_agent.agent_profile_revisions
    where profile_id='governed-analysis-agent' and profile_revision=1
      and profile_hash='sha256:265abb762fd9466d5ce8bee79bb43b823ff18621b1b728a645b84bb4356be7f6'
      and profile_hash=app_data_agent.u2_canonical_sha256(profile_json-'profile_hash'))
  then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_PROFILE_V1_HISTORY_DRIFT'; end if;

  if not exists(select 1 from app_data_agent.agent_profile_revisions
    where profile_id='governed-analysis-agent' and profile_revision=2
      and profile_hash='sha256:e5f85f6b0a7e4b582f13cb9bb24a08e03c1c01e6721760afb94003d4c883b019'
      and profile_json->'direct_tool_allowlist' ? 'analysis.program.execute'
      and profile_json->'mandatory_context' ? 'QUERY_EVIDENCE'
      and profile_hash=app_data_agent.u2_canonical_sha256(profile_json-'profile_hash'))
  then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_PROFILE_V2_DRIFT'; end if;

  if exists(select 1 from pg_catalog.pg_constraint
    where conrelid='app_data_agent.agent_product_profile_revisions'::pg_catalog.regclass
      and conname='agent_product_profile_revisions_profile_id_check')
  then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_FIXED_PRODUCT_PROFILE_CONSTRAINT_REMAINS'; end if;

  select pg_catalog.pg_get_constraintdef(oid) into generic_profile_constraint
  from pg_catalog.pg_constraint
  where conrelid='app_data_agent.agent_product_profile_revisions'::pg_catalog.regclass
    and conname='agent_product_profile_revisions_generic_profile_id_check';
  if generic_profile_constraint is null
    or pg_catalog.strpos(generic_profile_constraint,'profile_id')=0
    or pg_catalog.strpos(generic_profile_constraint,'a-z0-9')=0
  then raise exception using errcode='P0001',message='GENERIC_PRODUCT_PROFILE_CONSTRAINT_DRIFT'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010768_app_data_agent_governed_analysis_profile_v2',
  'sha256:bef39951b72aa191b6ed7819a1c04472fa4630427c737363faf518a31796209e');
commit;
