create function app_data_agent.resolve_extension_config_reference(
  requested_kind text, requested_id uuid, requested_revision bigint, expected_hash text
)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare
  revision_hash_value text; approval_status_value text; lifecycle_value text;
  active_revision_value bigint; active_hash_value text; signer_revoked boolean:=false;
begin
  if requested_kind not in ('MCP_SERVER','SKILL') or requested_revision<1
    or (expected_hash is not null and expected_hash !~ '^sha256:[0-9a-f]{64}$')
  then raise exception using errcode='22023',message='EXTENSION_CONFIG_REFERENCE_INVALID'; end if;
  if requested_kind='MCP_SERVER' then
    select revision.revision_hash,revision.approval_status,head.lifecycle,
      head.active_revision,head.active_revision_hash
    into revision_hash_value,approval_status_value,lifecycle_value,
      active_revision_value,active_hash_value
    from app_data_agent.mcp_server_revisions revision
    left join app_data_agent.mcp_server_heads head on head.app_id=revision.app_id
      and head.tenant_id=revision.tenant_id and head.environment=revision.environment
      and head.server_id=revision.server_id
    where revision.app_id=pg_catalog.current_setting('data_agent.app_id')::uuid
      and revision.tenant_id=pg_catalog.current_setting('data_agent.tenant_id')::uuid
      and revision.environment=pg_catalog.current_setting('data_agent.environment')
      and revision.server_id=requested_id and revision.revision=requested_revision;
  else
    select revision.revision_hash,revision.approval_status,head.lifecycle,
      head.active_revision,head.active_revision_hash,
      exists(select 1 from app_data_agent.skill_signer_revocations revocation
        where revocation.app_id=revision.app_id and revocation.tenant_id=revision.tenant_id
          and revocation.environment=revision.environment and revocation.signer_id=revision.signer_id)
    into revision_hash_value,approval_status_value,lifecycle_value,
      active_revision_value,active_hash_value,signer_revoked
    from app_data_agent.skill_revisions revision
    left join app_data_agent.skill_heads head on head.app_id=revision.app_id
      and head.tenant_id=revision.tenant_id and head.environment=revision.environment
      and head.skill_id=revision.skill_id
    where revision.app_id=pg_catalog.current_setting('data_agent.app_id')::uuid
      and revision.tenant_id=pg_catalog.current_setting('data_agent.tenant_id')::uuid
      and revision.environment=pg_catalog.current_setting('data_agent.environment')
      and revision.skill_id=requested_id and revision.revision=requested_revision;
  end if;
  if not found then
    return pg_catalog.jsonb_build_object('effective_resource',null,'availability','UNAVAILABLE',
      'unavailable_reason','RESOURCE_NOT_FOUND_OR_FORBIDDEN');
  end if;
  if expected_hash is not null and expected_hash<>revision_hash_value then
    return pg_catalog.jsonb_build_object('effective_resource',null,'availability','UNAVAILABLE',
      'unavailable_reason','RESOURCE_REVISION_MISMATCH');
  end if;
  if lifecycle_value='REVOKED' or signer_revoked then
    return pg_catalog.jsonb_build_object('effective_resource',null,'availability','UNAVAILABLE',
      'unavailable_reason','RESOURCE_REVOKED');
  end if;
  if active_revision_value is null or active_revision_value<>requested_revision
    or active_hash_value<>revision_hash_value
  then
    return pg_catalog.jsonb_build_object('effective_resource',null,'availability','UNAVAILABLE',
      'unavailable_reason','RESOURCE_REVISION_MISMATCH');
  end if;
  if lifecycle_value<>'ENABLED' or approval_status_value<>'APPROVED' then
    return pg_catalog.jsonb_build_object('effective_resource',null,'availability','UNAVAILABLE',
      'unavailable_reason','RESOURCE_DISABLED');
  end if;
  return pg_catalog.jsonb_build_object(
    'effective_resource',pg_catalog.jsonb_build_object('resource_id',requested_id,
      'resource_revision',requested_revision,'resource_hash',revision_hash_value),
    'availability','AVAILABLE','unavailable_reason',null);
end
$function$;

create or replace function app_data_agent.build_requested_optional_resource_bindings(request jsonb)
returns jsonb language sql stable security definer set search_path='' as $function$
  with overridden as (
    select kind.resource_kind,'OVERRIDE'::text as source,null::jsonb as mention_id,item.document
    from (values ('files','FILE'),('knowledge','KNOWLEDGE'),
      ('mcp_servers','MCP_SERVER'),('skills','SKILL')) kind(selection_name,resource_kind)
    cross join lateral pg_catalog.jsonb_array_elements(case
      when request #>> array['overrides',kind.selection_name,'mode']='RESOURCE_IDS'
        then request #> array['overrides',kind.selection_name,'resources']
      else '[]'::jsonb end) item(document)
  ), mentioned as (
    select mention.document->>'resource_kind' as resource_kind,'MENTION'::text as source,
      mention.document->'mention_id' as mention_id,mention.document
    from pg_catalog.jsonb_array_elements(request->'mentions') mention(document)
  ), candidates as (select * from overridden union all select * from mentioned), bindings as (
    select pg_catalog.jsonb_build_object(
      'resource_kind',candidate.resource_kind,'mention_id',candidate.mention_id,
      'requested_resource_id',candidate.document->'resource_id',
      'requested_revision',(candidate.document->>'expected_revision')::bigint,
      'effective_resource',case when resolution.document is null then null
        else resolution.document->'effective_resource' end,
      'source',candidate.source,
      'availability',coalesce(resolution.document->>'availability','UNAVAILABLE'),
      'unavailable_reason',case when resolution.document is null then 'RESOURCE_NOT_FOUND_OR_FORBIDDEN'
        else resolution.document->>'unavailable_reason' end) document
    from candidates candidate
    left join lateral (select app_data_agent.resolve_extension_config_reference(
      candidate.resource_kind,(candidate.document->>'resource_id')::uuid,
      (candidate.document->>'expected_revision')::bigint,null) document
      where candidate.resource_kind in ('MCP_SERVER','SKILL')) resolution on true
  )
  select coalesce(pg_catalog.jsonb_agg(bindings.document order by
    bindings.document->>'resource_kind',bindings.document->>'requested_resource_id',
    bindings.document->>'source',bindings.document->>'mention_id'),'[]'::jsonb) from bindings;
$function$;

create or replace function app_data_agent.build_inherited_optional_resource_bindings(
  request jsonb,defaults_document jsonb
)
returns jsonb language sql stable security definer set search_path='' as $function$
  with inherited_kind as (
    select selection_name,resource_kind,
      case when pg_catalog.jsonb_typeof(defaults_document->selection_name)='array'
        then defaults_document->selection_name else '[]'::jsonb end references
    from (values ('files','FILE'),('knowledge','KNOWLEDGE'),
      ('mcp_servers','MCP_SERVER'),('skills','SKILL')) kind(selection_name,resource_kind)
    where request #>> array['overrides',selection_name,'mode']='INHERIT_DEFAULT'
  ), projected as (
    select kind.resource_kind,item.document reference from inherited_kind kind
    cross join lateral pg_catalog.jsonb_array_elements(kind.references) item(document)
  ), bindings as (
    select pg_catalog.jsonb_build_object(
      'resource_kind',projected.resource_kind,'mention_id',null,
      'requested_resource_id',projected.reference->'resource_id',
      'requested_revision',(projected.reference->>'resource_revision')::bigint,
      'effective_resource',case when resolution.document is null then null
        else resolution.document->'effective_resource' end,
      'source','DEFAULT','availability',coalesce(resolution.document->>'availability','UNAVAILABLE'),
      'unavailable_reason',case when resolution.document is null then 'RESOURCE_NOT_FOUND_OR_FORBIDDEN'
        else resolution.document->>'unavailable_reason' end) document
    from projected
    left join lateral (select app_data_agent.resolve_extension_config_reference(
      projected.resource_kind,(projected.reference->>'resource_id')::uuid,
      (projected.reference->>'resource_revision')::bigint,projected.reference->>'resource_hash') document
      where projected.resource_kind in ('MCP_SERVER','SKILL')) resolution on true
  )
  select coalesce(pg_catalog.jsonb_agg(bindings.document order by
    bindings.document->>'resource_kind',bindings.document->>'requested_resource_id'),'[]'::jsonb)
  from bindings;
$function$;
