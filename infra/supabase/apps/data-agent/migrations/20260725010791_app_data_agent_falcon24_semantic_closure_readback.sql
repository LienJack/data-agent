-- falcon24_semantic_closure_readback_migration_checksum: sha256:59bc6176a5df701b053c0efd08c0b97927218e4307963723789102113af54dcb
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare relation_name text;function_name text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010790_app_data_agent_falcon24_diagnostic_authority')
  then raise exception using errcode='P0001',
    message='FALCON24_SEMANTIC_CLOSURE_READBACK_BASELINE_DRIFT'; end if;

  foreach relation_name in array array[
    'app_data_agent.falcon24_current_authority_epoch',
    'semantic.semantic_active_pointer','semantic.semantic_runtime_activation',
    'semantic.semantic_source_release','semantic.semantic_relationship_projection',
    'app_data_agent.workspace_run_defaults','app_data_agent.workspace_run_default_revisions'
  ]::text[] loop
    if pg_catalog.to_regclass(relation_name) is null
    then raise exception using errcode='P0001',
      message='FALCON24_SEMANTIC_CLOSURE_READBACK_INVENTORY_DRIFT',detail=relation_name; end if;
  end loop;
  foreach function_name in array array[
    'platform.current_backend_authority(boolean)',
    'app_data_agent.u2_canonical_sha256(jsonb)',
    'app_data_agent.provider_json_object_has_exact_keys(jsonb,text[])',
    'app_data_agent.falcon24_authority_binding_document(app_data_agent.falcon24_current_authority_epoch)'
  ]::text[] loop
    if pg_catalog.to_regprocedure(function_name) is null
    then raise exception using errcode='P0001',
      message='FALCON24_SEMANTIC_CLOSURE_READBACK_FUNCTION_DRIFT',detail=function_name; end if;
  end loop;
  if pg_catalog.to_regprocedure(
      'app_data_agent.load_falcon24_semantic_authority_closure(jsonb)') is not null
  then raise exception using errcode='P0001',
    message='FALCON24_SEMANTIC_CLOSURE_READBACK_SECOND_AUTHORITY_DETECTED'; end if;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
create function app_data_agent.load_falcon24_semantic_authority_closure(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;
  current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  pointer semantic.semantic_active_pointer%rowtype;
  runtime semantic.semantic_runtime_activation%rowtype;
  defaults_pointer app_data_agent.workspace_run_defaults%rowtype;
  defaults_revision app_data_agent.workspace_run_default_revisions%rowtype;
  pointer_release semantic.semantic_source_release%rowtype;
  runtime_release semantic.semantic_source_release%rowtype;
  defaults_release semantic.semantic_source_release%rowtype;
  pointer_datasource uuid;runtime_datasource uuid;defaults_datasource uuid;
  semantic_domain_value text;defaults_semantic jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','semantic_domain','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from
      'falcon24-semantic-authority-closure-load@1.0.0'
    or command->>'semantic_domain'!~'^[A-Za-z_][A-Za-z0-9_]{0,63}$'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',
    message='FALCON24_SEMANTIC_AUTHORITY_CLOSURE_LOAD_INVALID'; end if;
  semantic_domain_value:=command->>'semantic_domain';
  select * into strict authority from platform.current_backend_authority(false);
  if nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
      is distinct from semantic_domain_value
  then raise exception using errcode='42501',
    message='FALCON24_SEMANTIC_AUTHORITY_CLOSURE_SCOPE_FORBIDDEN'; end if;

  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment;
  if not found or current_epoch.authority_epoch='E1'
  then raise exception using errcode='02000',
    message='FALCON24_SEMANTIC_AUTHORITY_CLOSURE_NOT_FOUND'; end if;
  select * into pointer from semantic.semantic_active_pointer row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment
      and row.semantic_domain=semantic_domain_value;
  if not found then raise exception using errcode='02000',
    message='FALCON24_SEMANTIC_AUTHORITY_CLOSURE_NOT_FOUND'; end if;
  select * into runtime from semantic.semantic_runtime_activation row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment
      and row.semantic_domain=semantic_domain_value;
  if not found then raise exception using errcode='02000',
    message='FALCON24_SEMANTIC_AUTHORITY_CLOSURE_NOT_FOUND'; end if;
  select * into defaults_pointer from app_data_agent.workspace_run_defaults row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment;
  if not found then raise exception using errcode='02000',
    message='FALCON24_SEMANTIC_AUTHORITY_CLOSURE_NOT_FOUND'; end if;
  select * into defaults_revision from app_data_agent.workspace_run_default_revisions row
    where row.app_id=defaults_pointer.app_id and row.tenant_id=defaults_pointer.tenant_id
      and row.environment=defaults_pointer.environment
      and row.defaults_id=defaults_pointer.defaults_id
      and row.defaults_revision=defaults_pointer.defaults_revision
      and row.revision_id=defaults_pointer.revision_id
      and row.defaults_hash=defaults_pointer.defaults_hash;
  if not found then raise exception using errcode='02000',
    message='FALCON24_SEMANTIC_AUTHORITY_CLOSURE_NOT_FOUND'; end if;
  defaults_semantic:=defaults_revision.defaults_json->'semantic_release';
  if pg_catalog.jsonb_typeof(defaults_semantic) is distinct from 'object'
    or app_data_agent.canonical_uuid_json_string_is_valid(
      defaults_semantic->'resource_id') is distinct from true
    or defaults_semantic->>'resource_revision'!~'^[1-9][0-9]*$'
    or defaults_semantic->>'resource_hash'!~'^sha256:[0-9a-f]{64}$'
  then raise exception using errcode='55000',
    message='FALCON24_SEMANTIC_AUTHORITY_CLOSURE_INVALID'; end if;

  select * into pointer_release from semantic.semantic_source_release row
    where row.app_id=pointer.app_id and row.tenant_id=pointer.tenant_id
      and row.environment=pointer.environment and row.semantic_domain=pointer.semantic_domain
      and row.release_id=pointer.current_release_id;
  if not found then raise exception using errcode='02000',
    message='FALCON24_SEMANTIC_AUTHORITY_CLOSURE_NOT_FOUND'; end if;
  select projection.datasource_id into pointer_datasource
    from semantic.semantic_relationship_projection projection
    where projection.app_id=pointer_release.app_id
      and projection.tenant_id=pointer_release.tenant_id
      and projection.environment=pointer_release.environment
      and projection.semantic_domain=pointer_release.semantic_domain
      and projection.release_id=pointer_release.release_id
      and projection.projection_id=pointer_release.relationship_projection_ref;
  if not found then raise exception using errcode='02000',
    message='FALCON24_SEMANTIC_AUTHORITY_CLOSURE_NOT_FOUND'; end if;

  select * into runtime_release from semantic.semantic_source_release row
    where row.app_id=runtime.app_id and row.tenant_id=runtime.tenant_id
      and row.environment=runtime.environment and row.semantic_domain=runtime.semantic_domain
      and row.release_id=runtime.current_release_id;
  if not found then raise exception using errcode='02000',
    message='FALCON24_SEMANTIC_AUTHORITY_CLOSURE_NOT_FOUND'; end if;
  select projection.datasource_id into runtime_datasource
    from semantic.semantic_relationship_projection projection
    where projection.app_id=runtime_release.app_id
      and projection.tenant_id=runtime_release.tenant_id
      and projection.environment=runtime_release.environment
      and projection.semantic_domain=runtime_release.semantic_domain
      and projection.release_id=runtime_release.release_id
      and projection.projection_id=runtime_release.relationship_projection_ref;
  if not found then raise exception using errcode='02000',
    message='FALCON24_SEMANTIC_AUTHORITY_CLOSURE_NOT_FOUND'; end if;

  select * into defaults_release from semantic.semantic_source_release row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.semantic_domain=semantic_domain_value
      and row.release_id=(defaults_semantic->>'resource_id')::uuid;
  if not found then raise exception using errcode='02000',
    message='FALCON24_SEMANTIC_AUTHORITY_CLOSURE_NOT_FOUND'; end if;
  select projection.datasource_id into defaults_datasource
    from semantic.semantic_relationship_projection projection
    where projection.app_id=defaults_release.app_id
      and projection.tenant_id=defaults_release.tenant_id
      and projection.environment=defaults_release.environment
      and projection.semantic_domain=defaults_release.semantic_domain
      and projection.release_id=defaults_release.release_id
      and projection.projection_id=defaults_release.relationship_projection_ref;
  if not found then raise exception using errcode='02000',
    message='FALCON24_SEMANTIC_AUTHORITY_CLOSURE_NOT_FOUND'; end if;

  if pointer.current_release_generation is distinct from pointer_release.release_generation
    or pointer.current_release_digest is distinct from pointer_release.release_digest
    or runtime.current_release_generation is distinct from runtime_release.release_generation
    or defaults_semantic->>'resource_revision' is distinct from
      defaults_release.release_generation::text
    or defaults_semantic->>'resource_hash' is distinct from defaults_release.release_digest
    or pointer_release.release_id is distinct from runtime_release.release_id
    or pointer_release.release_generation is distinct from runtime_release.release_generation
    or pointer_release.release_digest is distinct from runtime_release.release_digest
    or pointer_datasource is distinct from runtime_datasource
    or pointer_release.release_id is distinct from defaults_release.release_id
    or pointer_release.release_generation is distinct from defaults_release.release_generation
    or pointer_release.release_digest is distinct from defaults_release.release_digest
    or pointer_datasource is distinct from defaults_datasource
  then raise exception using errcode='55000',
    message='FALCON24_SEMANTIC_AUTHORITY_CLOSURE_INVALID'; end if;

  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-semantic-authority-closure@1.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment,'semantic_domain',semantic_domain_value),
    'authority',app_data_agent.falcon24_authority_binding_document(current_epoch),
    'semantic_pointer',pg_catalog.jsonb_build_object(
      'version',pointer.pointer_generation,'release',pg_catalog.jsonb_build_object(
        'release_id',pointer_release.release_id,
        'generation',pointer_release.release_generation,
        'release_digest',pointer_release.release_digest,'datasource_id',pointer_datasource)),
    'semantic_runtime',pg_catalog.jsonb_build_object(
      'version',runtime.activation_generation,'release',pg_catalog.jsonb_build_object(
        'release_id',runtime_release.release_id,
        'generation',runtime_release.release_generation,
        'release_digest',runtime_release.release_digest,'datasource_id',runtime_datasource)),
    'workspace_defaults',pg_catalog.jsonb_build_object(
      'version',defaults_pointer.defaults_revision,'release',pg_catalog.jsonb_build_object(
        'release_id',defaults_release.release_id,
        'generation',defaults_release.release_generation,
        'release_digest',defaults_release.release_digest,'datasource_id',defaults_datasource)));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='55000',
    message='FALCON24_SEMANTIC_AUTHORITY_CLOSURE_INVALID';
end
$function$;
alter function app_data_agent.load_falcon24_semantic_authority_closure(jsonb)
  owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.load_falcon24_semantic_authority_closure(jsonb)
  from public;
grant execute on function app_data_agent.load_falcon24_semantic_authority_closure(jsonb)
  to data_agent_backend;
do $postconditions$
begin
  if pg_catalog.to_regprocedure(
      'app_data_agent.load_falcon24_semantic_authority_closure(jsonb)') is null
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.load_falcon24_semantic_authority_closure(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_falcon24_semantic_authority_closure(jsonb)','EXECUTE')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'semantic.semantic_active_pointer','SELECT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'semantic.semantic_runtime_activation','SELECT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.workspace_run_defaults','SELECT')
  then raise exception using errcode='P0001',
    message='FALCON24_SEMANTIC_CLOSURE_READBACK_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010791_app_data_agent_falcon24_semantic_closure_readback',
  'sha256:59bc6176a5df701b053c0efd08c0b97927218e4307963723789102113af54dcb');
commit;
