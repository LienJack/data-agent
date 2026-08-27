begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare definition text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010781_app_data_agent_falcon24_e2_authority')
    or pg_catalog.to_regprocedure(
      'app_data_agent.commit_e1_analysis_publication(jsonb)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.commit_falcon24_analysis_publication(jsonb)') is not null
    or pg_catalog.to_regclass('app_data_agent.falcon24_analysis_publications') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_analysis_publication_artifacts') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_analysis_publication_current') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_analysis_publication_outbox') is null
  then raise exception using errcode='P0001',
    message='FALCON24_ANALYSIS_PUBLICATION_BASELINE_DRIFT'; end if;
  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.commit_e1_analysis_publication(jsonb)'::regprocedure;
  if pg_catalog.strpos(definition,'e1_analysis_publications')=0
    or pg_catalog.strpos(definition,'e1-analysis-publication@1.0.0')=0
    or pg_catalog.strpos(definition,'append_analysis_context_journal')=0
  then raise exception using errcode='P0001',
    message='FALCON24_ANALYSIS_PUBLICATION_PREDECESSOR_DRIFT'; end if;
end
$preflight$;
