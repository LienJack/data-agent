\set ON_ERROR_STOP on

begin;

do $analysis_artifact_authority$
declare
  commit_definition text;
  system_definition text;
begin
  if pg_catalog.to_regprocedure(
      'app_data_agent.commit_current_analysis_artifact(jsonb)'
    ) is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.commit_analysis_system_artifact(jsonb,bytea)'
    ) is null
    or pg_catalog.to_regclass(
      'app_data_agent.analysis_system_artifacts'
    ) is null
  then
    raise exception 'ANALYSIS_ARTIFACT_AUTHORITY_SURFACE_MISSING';
  end if;

  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_current_analysis_artifact(jsonb)'::pg_catalog.regprocedure
  ) into commit_definition;
  if pg_catalog.strpos(commit_definition, 'when ''DataProfile'' then ''EVIDENCE''') = 0
    or pg_catalog.strpos(commit_definition, 'when ''AnalysisProgram'' then ''PLANNING''') = 0
    or pg_catalog.strpos(commit_definition, 'AnalysisPlan') > 0
    or pg_catalog.strpos(
      commit_definition,
      'when ''DerivedAnalysisEvidence'' then ''EVIDENCE'''
    ) = 0
    or pg_catalog.strpos(
      commit_definition,
      'when ''AnalysisCompletionReceipt'' then ''COVERAGE'''
    ) = 0
  then
    raise exception 'ANALYSIS_L2_DOMAIN_ROUTING_MISSING';
  end if;

  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_analysis_system_artifact(jsonb,bytea)'::pg_catalog.regprocedure
  ) into system_definition;
  if pg_catalog.strpos(system_definition, 'u6-db-command@1.0.0') = 0
    or pg_catalog.strpos(system_definition, 'extensions.digest(content_bytes') = 0
    or pg_catalog.strpos(system_definition, 'worker_fence') = 0
    or pg_catalog.strpos(system_definition, 'lease_expires_at <= db_now') = 0
  then
    raise exception 'ANALYSIS_SYSTEM_ARTIFACT_GUARDS_MISSING';
  end if;

  if not exists (
      select 1
      from pg_catalog.pg_trigger
      where tgrelid = 'app_data_agent.analysis_system_artifacts'::pg_catalog.regclass
        and tgname = 'analysis_system_artifacts_immutable'
        and not tgisinternal
    )
    or not pg_catalog.has_function_privilege(
      'data_agent_backend',
      'app_data_agent.commit_analysis_system_artifact(jsonb,bytea)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'public',
      'app_data_agent.commit_analysis_system_artifact(jsonb,bytea)',
      'EXECUTE'
    )
  then
    raise exception 'ANALYSIS_SYSTEM_ARTIFACT_ACL_OR_IMMUTABILITY_INVALID';
  end if;

  if not exists (
      select 1
      from pg_catalog.pg_policies
      where schemaname = 'app_data_agent'
        and tablename = 'artifacts'
        and policyname = 'artifacts_u6_reserved_insert_deny'
        and with_check like '%DerivedAnalysisEvidence%'
        and with_check like '%AnalysisCompletionReceipt%'
    )
  then
    raise exception 'ANALYSIS_GENERIC_ARTIFACT_BYPASS_NOT_RESERVED';
  end if;
end
$analysis_artifact_authority$;

rollback;
