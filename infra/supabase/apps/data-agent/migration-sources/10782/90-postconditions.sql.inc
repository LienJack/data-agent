do $postconditions$
declare definition text;
begin
  if pg_catalog.to_regprocedure(
      'app_data_agent.commit_falcon24_analysis_publication(jsonb)') is null
  then raise exception using errcode='P0001',
    message='FALCON24_ANALYSIS_PUBLICATION_RPC_MISSING'; end if;
  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.commit_falcon24_analysis_publication(jsonb)'::regprocedure;
  if pg_catalog.strpos(definition,'falcon24-analysis-publication@2.0.0')=0
    or pg_catalog.strpos(definition,'falcon24-authority-binding@2.0.0')=0
    or pg_catalog.strpos(definition,'falcon24_analysis_publications')=0
    or pg_catalog.strpos(definition,'falcon24_analysis_publication_outbox')=0
    or pg_catalog.strpos(definition,'FALCON24_ANALYSIS_PUBLICATION_AUTHORITY_MISMATCH')=0
    or pg_catalog.strpos(definition,'append_analysis_context_journal')=0
    or pg_catalog.strpos(definition,'e1_analysis_publications')>0
  then raise exception using errcode='P0001',
    message='FALCON24_ANALYSIS_PUBLICATION_DEFINITION_DRIFT'; end if;
  if not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_falcon24_analysis_publication(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.commit_falcon24_analysis_publication(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_e1_analysis_publication(jsonb)','EXECUTE')
    or (select role.rolname from pg_catalog.pg_proc procedure
      join pg_catalog.pg_roles role on role.oid=procedure.proowner
      where procedure.oid=
        'app_data_agent.commit_falcon24_analysis_publication(jsonb)'::regprocedure)
      <>'data_agent_u6_rpc_owner'
  then raise exception using errcode='P0001',
    message='FALCON24_ANALYSIS_PUBLICATION_SECURITY_DRIFT'; end if;
end
$postconditions$;

select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010782_app_data_agent_falcon24_analysis_publication',
  '__FALCON24_ANALYSIS_PUBLICATION_MIGRATION_CHECKSUM__');
