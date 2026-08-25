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
