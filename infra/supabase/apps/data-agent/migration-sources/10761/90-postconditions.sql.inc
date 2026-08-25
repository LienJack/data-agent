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
