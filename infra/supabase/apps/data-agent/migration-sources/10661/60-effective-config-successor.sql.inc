create or replace function app_data_agent.build_requested_optional_resource_bindings(request jsonb)
returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare authority record; candidate record; current_file app_data_agent.workspace_files%rowtype;
  revision app_data_agent.workspace_file_revisions%rowtype; bindings jsonb:='[]'::jsonb; binding jsonb;
begin
  select * into strict authority from platform.current_backend_authority(false);
  for candidate in
    with overridden as (
      select kind.resource_kind,'OVERRIDE'::text as source,null::jsonb as mention_id,item.document
      from (values ('files','FILE'),('knowledge','KNOWLEDGE'),('mcp_servers','MCP_SERVER'),('skills','SKILL'))
        kind(selection_name,resource_kind)
      cross join lateral pg_catalog.jsonb_array_elements(case
        when request#>>array['overrides',kind.selection_name,'mode']='RESOURCE_IDS'
          then request#>array['overrides',kind.selection_name,'resources'] else '[]'::jsonb end) item(document)
    ), mentioned as (
      select mention.document->>'resource_kind' as resource_kind,'MENTION'::text as source,
        mention.document->'mention_id' as mention_id,mention.document
      from pg_catalog.jsonb_array_elements(request->'mentions') mention(document)
    ) select * from (select * from overridden union all select * from mentioned) all_candidates
      order by resource_kind,document->>'resource_id',source,mention_id
  loop
    current_file:=null;revision:=null;
    if candidate.resource_kind='KNOWLEDGE' then
      binding:=app_data_agent.knowledge_build_resource_binding(
        authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
        (candidate.document->>'resource_id')::uuid,(candidate.document->>'expected_revision')::bigint,
        candidate.source,candidate.mention_id
      );
    else
      if candidate.resource_kind='FILE' then
        select file_record.* into current_file from app_data_agent.workspace_files file_record
        where file_record.app_id=authority.app_id and file_record.tenant_id=authority.tenant_id
          and file_record.environment=authority.environment
          and file_record.file_id=(candidate.document->>'resource_id')::uuid;
        if found then
          select file_revision.* into revision
          from app_data_agent.workspace_file_revisions file_revision
          where file_revision.app_id=current_file.app_id
            and file_revision.tenant_id=current_file.tenant_id
            and file_revision.environment=current_file.environment
            and file_revision.file_id=current_file.file_id
            and file_revision.revision=(candidate.document->>'expected_revision')::bigint
            and file_revision.revision_hash=current_file.current_revision_hash
            and file_revision.revision=current_file.current_revision and file_revision.status='READY'
            and (file_revision.visibility='WORKSPACE' or file_revision.owner_principal_id=authority.principal_id);
        end if;
      end if;
      binding:=pg_catalog.jsonb_build_object(
        'resource_kind',candidate.resource_kind,'mention_id',candidate.mention_id,
        'requested_resource_id',candidate.document->'resource_id',
        'requested_revision',(candidate.document->>'expected_revision')::bigint,
        'effective_resource',case when revision.file_id is null then null else pg_catalog.jsonb_build_object(
          'resource_id',revision.file_id,'resource_revision',revision.revision,'resource_hash',revision.revision_hash
        ) end,'source',candidate.source,
        'availability',case when revision.file_id is null then 'UNAVAILABLE' else 'AVAILABLE' end,
        'unavailable_reason',case when revision.file_id is null then 'RESOURCE_NOT_FOUND_OR_FORBIDDEN' else null end
      );
    end if;
    bindings:=bindings||pg_catalog.jsonb_build_array(binding);
  end loop;
  return bindings;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='EFFECTIVE_CONFIG_REQUEST_INVALID';
end
$function$;

create or replace function app_data_agent.build_inherited_optional_resource_bindings(
  request jsonb,defaults_document jsonb
)
returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare authority record; candidate record; current_file app_data_agent.workspace_files%rowtype;
  revision app_data_agent.workspace_file_revisions%rowtype; bindings jsonb:='[]'::jsonb; binding jsonb;
begin
  select * into strict authority from platform.current_backend_authority(false);
  for candidate in
    select kind.resource_kind,item.document as reference
    from (values ('files','FILE'),('knowledge','KNOWLEDGE'),('mcp_servers','MCP_SERVER'),('skills','SKILL'))
      kind(selection_name,resource_kind)
    cross join lateral pg_catalog.jsonb_array_elements(case
      when request#>>array['overrides',kind.selection_name,'mode']='INHERIT_DEFAULT'
        and pg_catalog.jsonb_typeof(defaults_document->kind.selection_name)='array'
        then defaults_document->kind.selection_name else '[]'::jsonb end) item(document)
    order by kind.resource_kind,item.document->>'resource_id'
  loop
    current_file:=null;revision:=null;
    if candidate.resource_kind='KNOWLEDGE' then
      binding:=app_data_agent.knowledge_build_resource_binding(
        authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
        (candidate.reference->>'resource_id')::uuid,(candidate.reference->>'resource_revision')::bigint,
        'DEFAULT',null
      );
    else
      if candidate.resource_kind='FILE' then
        select * into current_file from app_data_agent.workspace_files
        where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
          and file_id=(candidate.reference->>'resource_id')::uuid;
        if found then
          select file_revision.* into revision
          from app_data_agent.workspace_file_revisions file_revision
          where file_revision.app_id=current_file.app_id
            and file_revision.tenant_id=current_file.tenant_id
            and file_revision.environment=current_file.environment
            and file_revision.file_id=current_file.file_id
            and file_revision.revision=(candidate.reference->>'resource_revision')::bigint
            and file_revision.revision_hash=candidate.reference->>'resource_hash'
            and current_file.current_revision=file_revision.revision
            and current_file.current_revision_hash=file_revision.revision_hash
            and file_revision.status='READY'
            and (file_revision.visibility='WORKSPACE' or file_revision.owner_principal_id=authority.principal_id);
        end if;
      end if;
      binding:=pg_catalog.jsonb_build_object(
        'resource_kind',candidate.resource_kind,'mention_id',null,
        'requested_resource_id',candidate.reference->'resource_id',
        'requested_revision',(candidate.reference->>'resource_revision')::bigint,
        'effective_resource',case when revision.file_id is null then null else pg_catalog.jsonb_build_object(
          'resource_id',revision.file_id,'resource_revision',revision.revision,'resource_hash',revision.revision_hash
        ) end,'source','DEFAULT',
        'availability',case when revision.file_id is null then 'UNAVAILABLE' else 'AVAILABLE' end,
        'unavailable_reason',case when revision.file_id is null then 'RESOURCE_NOT_FOUND_OR_FORBIDDEN' else null end
      );
    end if;
    bindings:=bindings||pg_catalog.jsonb_build_array(binding);
  end loop;
  return bindings;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='EFFECTIVE_CONFIG_REQUEST_INVALID';
end
$function$;
