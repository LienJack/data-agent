-- semantic_text2sql_promotion_migration_checksum: sha256:b58dcb0c517b19620f2291716a75c18fb781ba729e32ec5b33bd6549211e1604
-- 10698 promotes an activated semantic release into Workspace Defaults and keeps reused projections readable.
begin;
do $bootstrap$ begin
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_TEXT2SQL_PROMOTION_EXECUTOR_UNSAFE'; end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010697_app_data_agent_semantic_projection_reuse')
  then raise exception using errcode='P0001',message='SEMANTIC_TEXT2SQL_PROMOTION_BASELINE_10697_MISSING'; end if;
end $bootstrap$;
set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create function semantic.promote_active_semantic_release_to_workspace_defaults()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare defaults_record app_data_agent.workspace_run_defaults%rowtype;
  revision_record app_data_agent.workspace_run_default_revisions%rowtype;
  selection_value jsonb; command_value jsonb; idempotency_key_value text;
begin
  if new.current_release_id is null or old.current_release_id is null
    or new.current_release_id=old.current_release_id
    or not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE')
  then return new; end if;
  select current_defaults.* into defaults_record from app_data_agent.workspace_run_defaults current_defaults
  where current_defaults.app_id=new.app_id and current_defaults.tenant_id=new.tenant_id
    and current_defaults.environment=new.environment;
  if not found then return new; end if;
  select revision.* into revision_record from app_data_agent.workspace_run_default_revisions revision
  where revision.app_id=defaults_record.app_id and revision.tenant_id=defaults_record.tenant_id
    and revision.environment=defaults_record.environment and revision.defaults_id=defaults_record.defaults_id
    and revision.defaults_revision=defaults_record.defaults_revision
    and revision.defaults_hash=defaults_record.defaults_hash;
  if not found
    or revision_record.defaults_json#>>'{semantic_release,resource_id}'<>old.current_release_id::text
    or (revision_record.defaults_json#>>'{semantic_release,resource_revision}')::bigint<>old.current_release_generation
    or revision_record.defaults_json#>>'{semantic_release,resource_hash}'<>old.current_release_digest
  then return new; end if;

  selection_value:=pg_catalog.jsonb_build_object(
    'model',case when revision_record.defaults_json->'model'='null'::jsonb then 'null'::jsonb else
      pg_catalog.jsonb_build_object('resource_id',revision_record.defaults_json#>>'{model,resource_id}',
        'expected_revision',(revision_record.defaults_json#>>'{model,resource_revision}')::bigint) end,
    'datasource',case when revision_record.defaults_json->'datasource'='null'::jsonb then 'null'::jsonb else
      pg_catalog.jsonb_build_object('resource_id',revision_record.defaults_json#>>'{datasource,resource_id}',
        'expected_revision',(revision_record.defaults_json#>>'{datasource,resource_revision}')::bigint) end,
    'files',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'resource_id',item.value->>'resource_id','expected_revision',(item.value->>'resource_revision')::bigint)
      order by item.value->>'resource_id') from pg_catalog.jsonb_array_elements(
        coalesce(revision_record.defaults_json->'files','[]'::jsonb)) item(value)),'[]'::jsonb),
    'knowledge',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'resource_id',item.value->>'resource_id','expected_revision',(item.value->>'resource_revision')::bigint)
      order by item.value->>'resource_id') from pg_catalog.jsonb_array_elements(
        coalesce(revision_record.defaults_json->'knowledge','[]'::jsonb)) item(value)),'[]'::jsonb),
    'mcp_servers','[]'::jsonb,'skills','[]'::jsonb,
    'semantic_release',pg_catalog.jsonb_build_object(
      'resource_id',new.current_release_id,'expected_revision',new.current_release_generation),
    'schema_snapshot',case when revision_record.defaults_json->'schema_snapshot'='null'::jsonb then 'null'::jsonb else
      pg_catalog.jsonb_build_object('resource_id',revision_record.defaults_json#>>'{schema_snapshot,resource_id}',
        'expected_revision',(revision_record.defaults_json#>>'{schema_snapshot,resource_revision}')::bigint) end,
    'context_policy',pg_catalog.jsonb_build_object(
      'resource_id',revision_record.defaults_json#>>'{context_policy,resource_id}',
      'expected_revision',(revision_record.defaults_json#>>'{context_policy,resource_revision}')::bigint),
    'egress_policy',pg_catalog.jsonb_build_object(
      'resource_id',revision_record.defaults_json#>>'{egress_policy,resource_id}',
      'expected_revision',(revision_record.defaults_json#>>'{egress_policy,resource_revision}')::bigint),
    'execution_safety_policy',pg_catalog.jsonb_build_object(
      'resource_id',revision_record.defaults_json#>>'{execution_safety_policy,resource_id}',
      'expected_revision',(revision_record.defaults_json#>>'{execution_safety_policy,resource_revision}')::bigint)
  );
  idempotency_key_value:='semantic-publish:'||new.current_release_id::text;
  command_value:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-defaults-cas-update@1.0.0','operation_id',extensions.gen_random_uuid(),
    'workspace_id',new.tenant_id,'expected_defaults_revision',defaults_record.defaults_revision,
    'idempotency_key',idempotency_key_value,'defaults',selection_value
  );
  command_value:=command_value||pg_catalog.jsonb_build_object(
    'request_hash',app_data_agent.u2_canonical_sha256(command_value));
  perform app_data_agent.update_workspace_run_defaults(command_value);
  return new;
end
$function$;

create trigger semantic_active_release_defaults_promotion
after update of current_release_id on semantic.semantic_active_pointer for each row
execute function semantic.promote_active_semantic_release_to_workspace_defaults();

revoke all on function semantic.promote_active_semantic_release_to_workspace_defaults()
from public,anon,authenticated,service_role,data_agent_backend;
create or replace function app_data_agent.resolved_context_metric_projection(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,p_release_id uuid
) returns jsonb language plpgsql stable set search_path='' as $function$
declare initial_value jsonb;
begin
  initial_value:=app_data_agent.resolved_context_metric_projection_initial(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_release_id
  );
  if pg_catalog.jsonb_array_length(initial_value)>0 then return initial_value; end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'metric_id',metric.value->>'metric_id','name',metric.value->>'name',
      'aliases',coalesce(metric.value->'aliases','[]'::jsonb),
      'mapping_refs',coalesce((select pg_catalog.jsonb_agg(to_jsonb(reference.value) order by reference.value)
        from (select distinct item.value#>>'{}' value
          from pg_catalog.jsonb_array_elements(
            pg_catalog.jsonb_build_array(metric.value->>'column_id')||
              coalesce(metric.value->'dependency_column_ids','[]'::jsonb)
          ) item(value) where item.value#>>'{}' is not null) reference),'[]'::jsonb),
      'mapping_hash',app_data_agent.u2_canonical_sha256(metric.value),
      'formula_hash',app_data_agent.u2_canonical_sha256(coalesce(metric.value->'formula','null'::jsonb))
    ) order by metric.value->>'metric_id')
    from semantic.semantic_source_release release
    join semantic.semantic_executable_projection projection
      on projection.app_id=release.app_id and projection.tenant_id=release.tenant_id
      and projection.environment=release.environment and projection.semantic_domain=release.semantic_domain
      and projection.projection_id=release.executable_projection_ref
      and projection.projection_digest=release.executable_projection_hash
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(projection.projection_payload->'metrics','[]'::jsonb)
    ) metric(value)
    where release.app_id=p_app_id and release.tenant_id=p_tenant_id
      and release.environment=p_environment and release.semantic_domain=p_semantic_domain
      and release.release_id=p_release_id
  ),'[]'::jsonb);
end
$function$;

create or replace function app_data_agent.resolved_context_ontology_projection(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,p_release_id uuid
) returns jsonb language plpgsql stable set search_path='' as $function$
declare initial_value jsonb;
begin
  initial_value:=app_data_agent.resolved_context_ontology_projection_initial(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_release_id
  );
  if pg_catalog.jsonb_array_length(initial_value)>0 then return initial_value; end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'object_id',node.value->>'node_id',
      'object_kind',case node.value->>'node_type' when 'BUSINESS_SUBJECT' then 'ENTITY'
        when 'GLOSSARY_TERM' then 'TERM' else 'DIMENSION' end,
      'name',node.value->>'name','aliases',coalesce(node.value->'aliases','[]'::jsonb),
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
      and node.value->>'node_type' in ('BUSINESS_SUBJECT','DIMENSION','GLOSSARY_TERM')
  ),'[]'::jsonb);
end
$function$;
do $postconditions$ begin
  if not exists(select 1 from pg_catalog.pg_trigger
      where tgrelid='semantic.semantic_active_pointer'::regclass
        and tgname='semantic_active_release_defaults_promotion' and not tgisinternal)
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.resolved_context_metric_projection(uuid,uuid,text,text,uuid)'::regprocedure),
      'projection.release_id=release.release_id')>0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.resolved_context_ontology_projection(uuid,uuid,text,text,uuid)'::regprocedure),
      'executable.release_id=release.release_id')>0
  then raise exception using errcode='P0001',message='SEMANTIC_TEXT2SQL_PROMOTION_POSTCONDITION_FAILED'; end if;
end $postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010698_app_data_agent_semantic_text2sql_promotion',
  'sha256:b58dcb0c517b19620f2291716a75c18fb781ba729e32ec5b33bd6549211e1604'
);
commit;
