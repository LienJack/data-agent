do $postconditions$
declare definition text;
begin
  if pg_catalog.to_regclass('app_data_agent.e1_analysis_publications') is null
    or pg_catalog.to_regclass('app_data_agent.e1_analysis_publication_artifacts') is null
    or pg_catalog.to_regclass('app_data_agent.e1_analysis_publication_current') is null
    or pg_catalog.to_regclass('app_data_agent.e1_analysis_publication_outbox') is null
    or pg_catalog.to_regprocedure('app_data_agent.commit_e1_analysis_publication(jsonb)') is null
  then raise exception using errcode='P0001',message='E1_ANALYSIS_PUBLICATION_SCHEMA_DRIFT'; end if;
  select prosrc into strict definition from pg_catalog.pg_proc
    where oid='app_data_agent.commit_e1_analysis_publication(jsonb)'::regprocedure;
  if pg_catalog.strpos(definition,'analysis-oracle-receipt@1.0.0')=0
    or pg_catalog.strpos(definition,'DerivedAnalysisEvidence')=0
    or pg_catalog.strpos(definition,'AnalysisCompletionReceipt')=0
    or pg_catalog.strpos(definition,'ArtifactWorkspaceDocument')=0
    or pg_catalog.strpos(definition,'AnalysisReport')=0
    or pg_catalog.strpos(definition,'e1_analysis_publication_outbox')=0
    or pg_catalog.strpos(definition,'append_analysis_context_journal')=0
  then raise exception using errcode='P0001',message='E1_ANALYSIS_PUBLICATION_DEFINITION_STALE'; end if;
  if exists(select 1 from pg_catalog.pg_class relation
    where relation.oid in(
      'app_data_agent.e1_analysis_publications'::regclass,
      'app_data_agent.e1_analysis_publication_artifacts'::regclass,
      'app_data_agent.e1_analysis_publication_current'::regclass,
      'app_data_agent.e1_analysis_publication_outbox'::regclass)
      and (not relation.relrowsecurity or not relation.relforcerowsecurity))
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.commit_e1_analysis_publication(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_e1_analysis_publication(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='E1_ANALYSIS_PUBLICATION_SECURITY_DRIFT'; end if;
end
$postconditions$;
