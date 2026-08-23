do $replace_current_contract$
declare
  definition text;
  repaired text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.load_resolved_context_authority_snapshot(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'resolved-context-authority-snapshot@1.0.0')=0
    or pg_catalog.strpos(definition,$$    'knowledge_refs',knowledge_refs,$$)=0
    or pg_catalog.strpos(definition,$$'published_lexicon'$$)>0
  then raise exception using errcode='P0001',message='RESOLVED_CONTEXT_LEXICON_LOAD_RPC_DRIFT'; end if;
  repaired:=pg_catalog.replace(
    definition,
    'resolved-context-authority-snapshot@1.0.0',
    'resolved-context-authority-snapshot@2.0.0'
  );
  repaired:=pg_catalog.replace(
    repaired,
    $$    'knowledge_refs',knowledge_refs,$$,
    $$    'published_lexicon',app_data_agent.resolved_context_published_lexicon(
      authority.app_id,authority.tenant_id,authority.environment,release_record.semantic_domain,release_record.release_id),
    'knowledge_refs',knowledge_refs,$$
  );
  execute repaired;

  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_resolved_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'resolved-context-package@1.0.0')=0
  then raise exception using errcode='P0001',message='RESOLVED_CONTEXT_LEXICON_COMMIT_RPC_DRIFT'; end if;
  repaired:=pg_catalog.replace(
    definition,
    'resolved-context-package@1.0.0',
    'resolved-context-package@2.0.0'
  );
  if pg_catalog.strpos(repaired,$$    or requested#>>'{package,schema_version}'<>'resolved-context-package@2.0.0'
    or not app_data_agent.resolved_context_exact_keys(requested->'receipt',array[$$)=0
  then raise exception using errcode='P0001',message='RESOLVED_CONTEXT_LEXICON_ROUTE_RPC_DRIFT'; end if;
  repaired:=pg_catalog.replace(
    repaired,
    $$    or requested#>>'{package,schema_version}'<>'resolved-context-package@2.0.0'
    or not app_data_agent.resolved_context_exact_keys(requested->'receipt',array[$$,
    $$    or requested#>>'{package,schema_version}'<>'resolved-context-package@2.0.0'
    or not app_data_agent.resolved_context_exact_keys(requested#>'{package,route_decision}',array[
      'schema_version','state','route','selected_metric_id','selected_ontology_ids',
      'clarification_candidates','lexical_evidence','capability_chain','reason_codes'
    ]::text[])
    or requested#>>'{package,route_decision,schema_version}'<>'resolved-context-route-decision@2.0.0'
    or pg_catalog.jsonb_typeof(requested#>'{package,route_decision,lexical_evidence}')<>'array'
    or not app_data_agent.resolved_context_exact_keys(requested->'receipt',array[$$
  );
  execute repaired;
end
$replace_current_contract$;
