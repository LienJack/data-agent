-- optional_resource_binding_repair_migration_checksum: sha256:935e07981003bd826291ded4c12713fd67136ae0d548ec32cb009dc5d2cabd90
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='OPTIONAL_RESOURCE_BINDING_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='OPTIONAL_RESOURCE_BINDING_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010706_app_data_agent_semantic_binding_impact')
  then raise exception using errcode='P0001',message='OPTIONAL_RESOURCE_BINDING_REPAIR_BASELINE_10706_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);

create function app_data_agent.resolve_workspace_file_config_reference(
  requested_id uuid,requested_revision bigint,expected_hash text
)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; file_record app_data_agent.workspace_files%rowtype;
  revision_record app_data_agent.workspace_file_revisions%rowtype;
begin
  if requested_revision<1 or (expected_hash is not null and expected_hash!~'^sha256:[0-9a-f]{64}$') then
    raise exception using errcode='22023',message='WORKSPACE_FILE_CONFIG_REFERENCE_INVALID';
  end if;
  select * into file_record from app_data_agent.workspace_files
  where app_id=pg_catalog.current_setting('data_agent.app_id')::uuid
    and tenant_id=pg_catalog.current_setting('data_agent.tenant_id')::uuid
    and environment=pg_catalog.current_setting('data_agent.environment')
    and file_id=requested_id;
  if not found then
    return pg_catalog.jsonb_build_object('effective_resource',null,'availability','UNAVAILABLE',
      'unavailable_reason','RESOURCE_NOT_FOUND_OR_FORBIDDEN');
  end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into revision_record from app_data_agent.workspace_file_revisions
  where app_id=file_record.app_id and tenant_id=file_record.tenant_id and environment=file_record.environment
    and file_id=file_record.file_id and revision=requested_revision;
  if not found then
    return pg_catalog.jsonb_build_object('effective_resource',null,'availability','UNAVAILABLE',
      'unavailable_reason','RESOURCE_NOT_FOUND_OR_FORBIDDEN');
  end if;
  if (expected_hash is not null and expected_hash<>revision_record.revision_hash)
    or file_record.current_revision<>revision_record.revision
    or file_record.current_revision_hash<>revision_record.revision_hash
  then
    return pg_catalog.jsonb_build_object('effective_resource',null,'availability','UNAVAILABLE',
      'unavailable_reason','RESOURCE_NOT_FOUND_OR_FORBIDDEN');
  end if;
  if revision_record.status<>'READY'
    or (revision_record.visibility<>'WORKSPACE' and revision_record.owner_principal_id<>authority.principal_id)
  then
    return pg_catalog.jsonb_build_object('effective_resource',null,'availability','UNAVAILABLE',
      'unavailable_reason','RESOURCE_NOT_FOUND_OR_FORBIDDEN');
  end if;
  return pg_catalog.jsonb_build_object(
    'effective_resource',pg_catalog.jsonb_build_object('resource_id',revision_record.file_id,
      'resource_revision',revision_record.revision,'resource_hash',revision_record.revision_hash),
    'availability','AVAILABLE','unavailable_reason',null);
end
$function$;

create or replace function app_data_agent.build_requested_optional_resource_bindings(request jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; candidate record; resolution jsonb; bindings jsonb:='[]'::jsonb;
begin
  for candidate in
    with overridden as (
      select kind.resource_kind,'OVERRIDE'::text as source,null::jsonb as mention_id,item.document
      from (values ('files','FILE'),('knowledge','KNOWLEDGE'),
        ('mcp_servers','MCP_SERVER'),('skills','SKILL')) kind(selection_name,resource_kind)
      cross join lateral pg_catalog.jsonb_array_elements(case
        when request#>>array['overrides',kind.selection_name,'mode']='RESOURCE_IDS'
          then request#>array['overrides',kind.selection_name,'resources'] else '[]'::jsonb end) item(document)
    ), mentioned as (
      select mention.document->>'resource_kind' as resource_kind,'MENTION'::text as source,
        mention.document->'mention_id' as mention_id,mention.document
      from pg_catalog.jsonb_array_elements(request->'mentions') mention(document)
    ) select * from (select * from overridden union all select * from mentioned) candidates
      order by resource_kind,document->>'resource_id',source,mention_id
  loop
    if candidate.resource_kind='KNOWLEDGE' then
      select * into strict authority from platform.current_backend_authority(false);
      resolution:=app_data_agent.knowledge_build_resource_binding(
        authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
        (candidate.document->>'resource_id')::uuid,(candidate.document->>'expected_revision')::bigint,
        candidate.source,candidate.mention_id);
    elsif candidate.resource_kind='FILE' then
      resolution:=app_data_agent.resolve_workspace_file_config_reference(
        (candidate.document->>'resource_id')::uuid,(candidate.document->>'expected_revision')::bigint,null)
        ||pg_catalog.jsonb_build_object('resource_kind','FILE','mention_id',candidate.mention_id,
          'requested_resource_id',candidate.document->'resource_id',
          'requested_revision',(candidate.document->>'expected_revision')::bigint,'source',candidate.source);
    elsif candidate.resource_kind in ('MCP_SERVER','SKILL') then
      resolution:=app_data_agent.resolve_extension_config_reference(
        candidate.resource_kind,(candidate.document->>'resource_id')::uuid,
        (candidate.document->>'expected_revision')::bigint,null)
        ||pg_catalog.jsonb_build_object('resource_kind',candidate.resource_kind,'mention_id',candidate.mention_id,
          'requested_resource_id',candidate.document->'resource_id',
          'requested_revision',(candidate.document->>'expected_revision')::bigint,'source',candidate.source);
    else
      raise exception using errcode='22023',message='EFFECTIVE_CONFIG_RESOURCE_KIND_INVALID';
    end if;
    bindings:=bindings||pg_catalog.jsonb_build_array(resolution);
  end loop;
  return bindings;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='EFFECTIVE_CONFIG_REQUEST_INVALID';
end
$function$;

create or replace function app_data_agent.build_inherited_optional_resource_bindings(
  request jsonb,defaults_document jsonb
)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; candidate record; resolution jsonb; bindings jsonb:='[]'::jsonb;
begin
  for candidate in
    select kind.resource_kind,item.document as reference
    from (values ('files','FILE'),('knowledge','KNOWLEDGE'),
      ('mcp_servers','MCP_SERVER'),('skills','SKILL')) kind(selection_name,resource_kind)
    cross join lateral pg_catalog.jsonb_array_elements(case
      when request#>>array['overrides',kind.selection_name,'mode']='INHERIT_DEFAULT'
        and pg_catalog.jsonb_typeof(defaults_document->kind.selection_name)='array'
        then defaults_document->kind.selection_name else '[]'::jsonb end) item(document)
    order by kind.resource_kind,item.document->>'resource_id'
  loop
    if candidate.resource_kind='KNOWLEDGE' then
      select * into strict authority from platform.current_backend_authority(false);
      resolution:=app_data_agent.knowledge_build_resource_binding(
        authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
        (candidate.reference->>'resource_id')::uuid,(candidate.reference->>'resource_revision')::bigint,
        'DEFAULT',null);
    elsif candidate.resource_kind='FILE' then
      resolution:=app_data_agent.resolve_workspace_file_config_reference(
        (candidate.reference->>'resource_id')::uuid,(candidate.reference->>'resource_revision')::bigint,
        candidate.reference->>'resource_hash')
        ||pg_catalog.jsonb_build_object('resource_kind','FILE','mention_id',null,
          'requested_resource_id',candidate.reference->'resource_id',
          'requested_revision',(candidate.reference->>'resource_revision')::bigint,'source','DEFAULT');
    elsif candidate.resource_kind in ('MCP_SERVER','SKILL') then
      resolution:=app_data_agent.resolve_extension_config_reference(
        candidate.resource_kind,(candidate.reference->>'resource_id')::uuid,
        (candidate.reference->>'resource_revision')::bigint,candidate.reference->>'resource_hash')
        ||pg_catalog.jsonb_build_object('resource_kind',candidate.resource_kind,'mention_id',null,
          'requested_resource_id',candidate.reference->'resource_id',
          'requested_revision',(candidate.reference->>'resource_revision')::bigint,'source','DEFAULT');
    else
      raise exception using errcode='22023',message='EFFECTIVE_CONFIG_RESOURCE_KIND_INVALID';
    end if;
    bindings:=bindings||pg_catalog.jsonb_build_array(resolution);
  end loop;
  return bindings;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='EFFECTIVE_CONFIG_REQUEST_INVALID';
end
$function$;

alter function app_data_agent.resolve_workspace_file_config_reference(uuid,bigint,text)
  owner to data_agent_u6_file_owner;
alter function app_data_agent.build_requested_optional_resource_bindings(jsonb)
  owner to data_agent_u14_extension_owner;
alter function app_data_agent.build_inherited_optional_resource_bindings(jsonb,jsonb)
  owner to data_agent_u14_extension_owner;

grant usage on schema app_data_agent,platform to data_agent_u6_file_owner;
grant execute on function platform.current_backend_authority(boolean) to data_agent_u6_file_owner;
grant execute on function app_data_agent.resolve_workspace_file_config_reference(uuid,bigint,text),
  app_data_agent.knowledge_build_resource_binding(uuid,uuid,text,uuid,uuid,bigint,text,jsonb)
  to data_agent_u14_extension_owner;
revoke all on function app_data_agent.resolve_workspace_file_config_reference(uuid,bigint,text)
  from public,anon,authenticated,service_role,data_agent_backend;

do $postconditions$
declare requested_definition text; inherited_definition text;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict requested_definition
  from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
  where namespace.nspname='app_data_agent' and procedure.proname='build_requested_optional_resource_bindings';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict inherited_definition
  from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
  where namespace.nspname='app_data_agent' and procedure.proname='build_inherited_optional_resource_bindings';
  if requested_definition not like '%candidate.resource_kind=''FILE''%'
    or requested_definition not like '%candidate.resource_kind=''KNOWLEDGE''%'
    or requested_definition not like '%resolve_extension_config_reference%'
    or inherited_definition not like '%candidate.resource_kind=''FILE''%'
    or inherited_definition not like '%candidate.resource_kind=''KNOWLEDGE''%'
    or inherited_definition not like '%resolve_extension_config_reference%'
  then raise exception using errcode='P0001',message='OPTIONAL_RESOURCE_BINDING_DISPATCH_UNSAFE'; end if;
  if not pg_catalog.has_function_privilege('data_agent_u14_extension_owner',
      'app_data_agent.resolve_workspace_file_config_reference(uuid,bigint,text)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_u14_extension_owner',
      'app_data_agent.knowledge_build_resource_binding(uuid,uuid,text,uuid,uuid,bigint,text,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.resolve_workspace_file_config_reference(uuid,bigint,text)','EXECUTE')
  then raise exception using errcode='P0001',message='OPTIONAL_RESOURCE_BINDING_GRANT_UNSAFE'; end if;
end
$postconditions$;

select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010707_app_data_agent_optional_resource_binding_repair',
  'sha256:935e07981003bd826291ded4c12713fd67136ae0d548ec32cb009dc5d2cabd90');
commit;
