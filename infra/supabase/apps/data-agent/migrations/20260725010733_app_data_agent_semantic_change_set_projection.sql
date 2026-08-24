-- semantic_change_set_projection_migration_checksum: sha256:c42255279e9a27acc3a55e34d771c8a4bd20bd31b0829de28486149e0eef141d
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_CHANGE_SET_PROJECTION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_CHANGE_SET_PROJECTION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010732_app_data_agent_qa_directory_semantic_helper_cutover')
  then raise exception using errcode='P0001',message='SEMANTIC_CHANGE_SET_PROJECTION_BASELINE_10732_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create or replace function app_data_agent.semantic_context_ontology_projection(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,p_release_id uuid
) returns jsonb language plpgsql stable set search_path='' as $function$
declare initial_value jsonb;
begin
  initial_value:=app_data_agent.semantic_context_ontology_projection_initial(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_release_id
  );
  if pg_catalog.jsonb_array_length(initial_value)>0 then return initial_value; end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'object_id',node.value->>'node_id',
      'object_kind',case
        when node.value->>'node_type'='GLOSSARY_TERM' then 'TERM'
        when node.value->>'node_type'='DIMENSION' then 'DIMENSION'
        when node.value->>'node_type'='FORMULA' then 'FORMULA'
        when coalesce(node.value->'tags','[]'::jsonb) ? 'assertion-kind:RELATIONSHIP' then 'RELATIONSHIP'
        when coalesce(node.value->'tags','[]'::jsonb) ? 'assertion-kind:QUALITY_CONSTRAINT' then 'QUALITY'
        when coalesce(node.value->'tags','[]'::jsonb) ? 'assertion-kind:TIME_SEMANTICS' then 'TIME'
        else 'ENTITY' end,
      'name',node.value->>'name',
      'aliases',coalesce(node.value->'aliases','[]'::jsonb),
      'queryable',dimension.value is not null,
      'mapping_refs',case when dimension.value is null then '[]'::jsonb
        else pg_catalog.jsonb_build_array(dimension.value->>'column_id') end,
      'object_hash',app_data_agent.u2_canonical_sha256(node.value)
    ) order by node.value->>'node_id')
    from semantic.semantic_source_release release
    join semantic.semantic_source_release_graph_projection binding
      on binding.app_id=release.app_id and binding.tenant_id=release.tenant_id
      and binding.environment=release.environment and binding.semantic_domain=release.semantic_domain
      and binding.release_id=release.release_id
    join semantic.semantic_graph_projection graph
      on graph.app_id=binding.app_id and graph.tenant_id=binding.tenant_id
      and graph.environment=binding.environment and graph.semantic_domain=binding.semantic_domain
      and graph.projection_id=binding.projection_id
      and graph.projection_storage_digest=binding.projection_storage_digest
    join semantic.semantic_executable_projection executable
      on executable.app_id=release.app_id and executable.tenant_id=release.tenant_id
      and executable.environment=release.environment and executable.semantic_domain=release.semantic_domain
      and executable.projection_id=release.executable_projection_ref
      and executable.projection_digest=release.executable_projection_hash
    cross join lateral pg_catalog.jsonb_array_elements(graph.projection_payload->'nodes') node(value)
    left join lateral (
      select item.value from pg_catalog.jsonb_array_elements(
        coalesce(executable.projection_payload->'dimensions','[]'::jsonb)
      ) item(value) where item.value->>'dimension_id'=node.value->>'node_id' limit 1
    ) dimension on true
    where release.app_id=p_app_id and release.tenant_id=p_tenant_id
      and release.environment=p_environment and release.semantic_domain=p_semantic_domain
      and release.release_id=p_release_id and node.value->>'lifecycle'='ACTIVE'
      and node.value->>'node_type' in ('BUSINESS_SUBJECT','DIMENSION','GLOSSARY_TERM','FORMULA')
  ),'[]'::jsonb);
end
$function$;
do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.semantic_context_ontology_projection(uuid,uuid,text,text,uuid)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'assertion-kind:RELATIONSHIP')=0
    or pg_catalog.strpos(definition,'assertion-kind:QUALITY_CONSTRAINT')=0
    or pg_catalog.strpos(definition,'assertion-kind:TIME_SEMANTICS')=0
    or pg_catalog.strpos(definition,'semantic_graph_projection')=0
  then raise exception using errcode='P0001',message='SEMANTIC_CHANGE_SET_PROJECTION_NOT_INSTALLED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010733_app_data_agent_semantic_change_set_projection',
  'sha256:c42255279e9a27acc3a55e34d771c8a4bd20bd31b0829de28486149e0eef141d');
commit;
