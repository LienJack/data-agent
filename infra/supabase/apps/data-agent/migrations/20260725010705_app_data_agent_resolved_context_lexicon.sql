-- resolved_context_lexicon_migration_checksum: sha256:cdbebd58c2d88d115ed11aff9569ec3f8223f17fcfd23cb7a96ef0dec777e242
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'RESOLVED_CONTEXT_LEXICON_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'RESOLVED_CONTEXT_LEXICON_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger
    where owner_kind = 'app'
      and app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version = '20260725010704_app_data_agent_semantic_v2_only'
  ) then
    raise exception using errcode = 'P0001', message = 'RESOLVED_CONTEXT_LEXICON_BASELINE_10704_MISSING';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);
create function app_data_agent.resolved_context_published_lexicon(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,p_release_id uuid
) returns jsonb language sql stable set search_path='' as $function$
  with release_ref as (
    select pg_catalog.jsonb_build_object(
      'resource_id',release.release_id,
      'resource_revision',release.release_generation,
      'resource_hash',release.release_digest
    ) as document
    from semantic.semantic_source_release as release
    where release.app_id=p_app_id and release.tenant_id=p_tenant_id
      and release.environment=p_environment and release.semantic_domain=p_semantic_domain
      and release.release_id=p_release_id
  ),
  metrics as (
    select item.value as document
    from pg_catalog.jsonb_array_elements(app_data_agent.resolved_context_metric_projection(
      p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_release_id
    )) as item(value)
  ),
  ontology as (
    select item.value as document
    from pg_catalog.jsonb_array_elements(app_data_agent.resolved_context_ontology_projection(
      p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_release_id
    )) as item(value)
  ),
  direct_candidates as (
    select 0 as match_rank,'METRIC'::text as target_kind,
      metric.document->>'metric_id' as target_id,null::text as term_id,
      'CANONICAL'::text as match_kind,metric.document->>'name' as phrase
    from metrics as metric
    union all
    select 2,'METRIC',metric.document->>'metric_id',null,'ALIAS',alias.value#>>'{}'
    from metrics as metric
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(metric.document->'aliases','[]'::jsonb)
    ) as alias(value)
    union all
    select 0,'ONTOLOGY',object.document->>'object_id',null,'CANONICAL',object.document->>'name'
    from ontology as object where object.document->>'object_kind'<>'TERM'
    union all
    select 2,'ONTOLOGY',object.document->>'object_id',null,'ALIAS',alias.value#>>'{}'
    from ontology as object
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(object.document->'aliases','[]'::jsonb)
    ) as alias(value)
    where object.document->>'object_kind'<>'TERM'
  ),
  glossary_candidates as (
    select case edge.value#>>'{attributes,lexical_role}'
        when 'PREFERRED' then 1 when 'SYNONYM' then 2 else 3 end as match_rank,
      target.target_kind,target.target_id,term.value->>'node_id' as term_id,
      edge.value#>>'{attributes,lexical_role}' as match_kind,
      case when edge.value#>>'{attributes,lexical_role}'='ABBREVIATION'
          and coalesce(term.value->>'abbreviation','')<>''
        then term.value->>'abbreviation' else term.value->>'name' end as phrase
    from semantic.semantic_source_release_graph_projection as binding
    join semantic.semantic_graph_projection as graph
      on graph.app_id=binding.app_id and graph.tenant_id=binding.tenant_id
      and graph.environment=binding.environment and graph.semantic_domain=binding.semantic_domain
      and graph.projection_id=binding.projection_id
      and graph.projection_storage_digest=binding.projection_storage_digest
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(graph.projection_payload->'edges','[]'::jsonb)
    ) as edge(value)
    join lateral (
      select node.value from pg_catalog.jsonb_array_elements(
        coalesce(graph.projection_payload->'nodes','[]'::jsonb)
      ) as node(value)
      where node.value->>'node_id'=edge.value->>'source_node_id'
        and node.value->>'node_type'='GLOSSARY_TERM'
        and node.value->>'lifecycle'='ACTIVE'
      limit 1
    ) as term on true
    join lateral (
      select 'METRIC'::text as target_kind,metric.document->>'metric_id' as target_id
      from metrics as metric
      where metric.document->>'metric_id'=edge.value->>'target_node_id'
      union all
      select 'ONTOLOGY',object.document->>'object_id'
      from ontology as object
      where object.document->>'object_id'=edge.value->>'target_node_id'
      limit 1
    ) as target on true
    where binding.app_id=p_app_id and binding.tenant_id=p_tenant_id
      and binding.environment=p_environment and binding.semantic_domain=p_semantic_domain
      and binding.release_id=p_release_id
      and edge.value->>'lifecycle'='ACTIVE'
      and edge.value->>'family'='TERMINOLOGY'
      and edge.value->>'edge_type'='DENOTES'
      and edge.value#>>'{attributes,kind}'='TERM_LINK'
      and edge.value#>>'{attributes,lexical_role}' in ('PREFERRED','SYNONYM','ABBREVIATION')
  ),
  candidates as (
    select * from direct_candidates
    union all
    select * from glossary_candidates
  ),
  materials as (
    select distinct candidate.match_rank,pg_catalog.jsonb_build_object(
      'schema_version','semantic-lexical-entry@1.0.0',
      'release_ref',release_ref.document,
      'target_kind',candidate.target_kind,
      'target_id',candidate.target_id,
      'term_id',candidate.term_id,
      'match_kind',candidate.match_kind,
      'phrase',candidate.phrase
    ) as document
    from candidates as candidate cross join release_ref
    where coalesce(pg_catalog.btrim(candidate.phrase),'')<>''
  ),
  evidence as (
    select material.match_rank,material.document,
      app_data_agent.u2_canonical_sha256(material.document) as evidence_hash
    from materials as material
  )
  select coalesce(pg_catalog.jsonb_agg(
    evidence.document||pg_catalog.jsonb_build_object('evidence_hash',evidence.evidence_hash)
    order by evidence.match_rank,evidence.evidence_hash
  ),'[]'::jsonb)
  from evidence
$function$;
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
alter function app_data_agent.resolved_context_published_lexicon(uuid,uuid,text,text,uuid)
  owner to data_agent_u12_context_owner;
alter function app_data_agent.load_resolved_context_authority_snapshot(jsonb)
  owner to data_agent_u12_context_owner;
alter function app_data_agent.commit_resolved_context_package(jsonb)
  owner to data_agent_u12_context_owner;

revoke all on function
  app_data_agent.resolved_context_published_lexicon(uuid,uuid,text,text,uuid)
from public,anon,authenticated,service_role,data_agent_backend;

do $postconditions$
declare
  load_definition text:=pg_catalog.pg_get_functiondef(
    'app_data_agent.load_resolved_context_authority_snapshot(jsonb)'::pg_catalog.regprocedure
  );
  commit_definition text:=pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_resolved_context_package(jsonb)'::pg_catalog.regprocedure
  );
begin
  if pg_catalog.strpos(load_definition,'resolved-context-authority-snapshot@2.0.0')=0
    or pg_catalog.strpos(load_definition,$$'published_lexicon'$$)=0
    or pg_catalog.strpos(load_definition,'resolved-context-authority-snapshot@1.0.0')>0
  then raise exception 'RESOLVED_CONTEXT_LEXICON_LOAD_CONTRACT_UNSAFE'; end if;
  if pg_catalog.strpos(commit_definition,'resolved-context-package@2.0.0')=0
    or pg_catalog.strpos(commit_definition,'resolved-context-route-decision@2.0.0')=0
    or pg_catalog.strpos(commit_definition,'resolved-context-package@1.0.0')>0
  then raise exception 'RESOLVED_CONTEXT_LEXICON_COMMIT_CONTRACT_UNSAFE'; end if;
  if pg_catalog.to_regprocedure(
      'app_data_agent.load_resolved_context_authority_snapshot_v1(jsonb)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'app_data_agent.load_resolved_context_authority_snapshot_v2(jsonb)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'app_data_agent.commit_resolved_context_package_v1(jsonb)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'app_data_agent.commit_resolved_context_package_v2(jsonb)'
    ) is not null
  then raise exception 'RESOLVED_CONTEXT_LEXICON_COMPATIBILITY_RPC_UNSAFE'; end if;
  if pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.resolved_context_published_lexicon(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) then raise exception 'RESOLVED_CONTEXT_LEXICON_HELPER_EXPOSED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010705_app_data_agent_resolved_context_lexicon',
  'sha256:cdbebd58c2d88d115ed11aff9569ec3f8223f17fcfd23cb7a96ef0dec777e242'
);

commit;
