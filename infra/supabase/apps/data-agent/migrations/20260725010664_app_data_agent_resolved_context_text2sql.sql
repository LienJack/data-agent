-- u13_text2sql_migration_checksum: sha256:b79764d8c22025bace597ade6f501d1dd9ebf0f794cc3f97399cdf575bb51e99
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='U13_TEXT2SQL_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='U13_TEXT2SQL_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010663_app_data_agent_resolved_context')
  then raise exception using errcode='P0001',message='U13_TEXT2SQL_BASELINE_10663_MISSING'; end if;
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u12_context_owner'
    and not rolcanlogin and not rolsuper and not rolbypassrls)
  then raise exception using errcode='P0001',message='U13_TEXT2SQL_OWNER_MISSING_OR_UNSAFE'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create function app_data_agent.verify_resolved_context_text2sql_binding(
  requested jsonb,
  requested_run_id uuid
) returns boolean language plpgsql volatile security definer set search_path='' as $function$
declare
  authority record;
  receipt app_data_agent.resolved_context_receipts%rowtype;
  pointer_record semantic.semantic_active_pointer%rowtype;
  release_record semantic.semantic_source_release%rowtype;
  metric_document jsonb;
  ontology_document jsonb;
  mapping_authorities jsonb:='[]'::jsonb;
  expected_mapping_refs jsonb;
  expected_projection_hashes jsonb;
  expected_mapping_closure_hash text;
  selected_object_id text;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED';
  end if;
  if requested is null or requested_run_id is null
    or not app_data_agent.resolved_context_exact_keys(requested,array[
      'schema_version','scope','resolved_context_package_ref','authority_snapshot_hash',
      'semantic_release','schema_snapshot','route','selected_metric_id','selected_ontology_ids',
      'mapping_refs','semantic_projection_hashes','mapping_closure_hash','binding_hash'
    ]::text[])
    or requested->>'schema_version'<>'resolved-context-text2sql-binding@1.0.0'
    or requested->>'binding_hash'<>app_data_agent.u2_canonical_sha256(requested-'binding_hash')
    or requested->>'route' not in ('METRIC','ONTOLOGY_TEXT2SQL')
    or pg_catalog.jsonb_typeof(requested->'mapping_refs')<>'array'
    or pg_catalog.jsonb_array_length(requested->'mapping_refs')=0
    or pg_catalog.jsonb_typeof(requested->'semantic_projection_hashes')<>'array'
    or pg_catalog.jsonb_array_length(requested->'semantic_projection_hashes')=0
  then raise exception using errcode='22023',message='RESOLVED_CONTEXT_TEXT2SQL_BINDING_INVALID'; end if;

  select * into authority from platform.current_backend_authority(false);
  if requested->'scope'<>pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment)
  then raise exception using errcode='42501',message='RESOLVED_CONTEXT_SCOPE_MISMATCH'; end if;

  select candidate.* into receipt
  from app_data_agent.resolved_context_receipts candidate
  where candidate.app_id=authority.app_id and candidate.tenant_id=authority.tenant_id
    and candidate.environment=authority.environment and candidate.consumer='RUN'
    and candidate.run_id=requested_run_id and candidate.state in ('READY','PARTIAL')
    and candidate.package_id=(requested#>>'{resolved_context_package_ref,package_id}')::uuid
    and candidate.package_hash=requested#>>'{resolved_context_package_ref,package_hash}'
    and candidate.authority_snapshot_hash=requested->>'authority_snapshot_hash'
  order by candidate.committed_at desc limit 1 for share;
  if not found then
    raise exception using errcode='42501',message='RESOLVED_CONTEXT_TEXT2SQL_RUN_RECEIPT_REQUIRED';
  end if;
  if receipt.package_json->'scope'<>requested->'scope'
    or receipt.package_json->'semantic_release'<>requested->'semantic_release'
    or receipt.package_json->'schema_snapshot'<>requested->'schema_snapshot'
    or receipt.package_json#>>'{route_decision,route}'<>requested->>'route'
    or receipt.package_json#>'{route_decision,selected_metric_id}'<>requested->'selected_metric_id'
    or receipt.package_json#>'{route_decision,selected_ontology_ids}'<>requested->'selected_ontology_ids'
  then raise exception using errcode='23514',message='RESOLVED_CONTEXT_TEXT2SQL_BINDING_CLOSURE_INVALID'; end if;

  select pointer.* into pointer_record from semantic.semantic_active_pointer pointer
  where pointer.app_id=authority.app_id and pointer.tenant_id=authority.tenant_id
    and pointer.environment=authority.environment
    and pointer.semantic_domain=receipt.package_json->>'semantic_domain'
  for share;
  if not found then
    raise exception using errcode='40001',message='RESOLVED_CONTEXT_RELEASE_STALE';
  end if;

  select release.* into release_record from semantic.semantic_source_release release
  where release.app_id=authority.app_id and release.tenant_id=authority.tenant_id
    and release.environment=authority.environment
    and release.release_id=(requested#>>'{semantic_release,resource_id}')::uuid
    and release.release_generation=(requested#>>'{semantic_release,resource_revision}')::bigint
    and release.release_digest=requested#>>'{semantic_release,resource_hash}'
    and release.semantic_domain=pointer_record.semantic_domain
    and release.release_id=pointer_record.current_release_id
    and release.release_generation=pointer_record.current_release_generation
    and release.release_digest=pointer_record.current_release_digest
  for share;
  if not found then
    raise exception using errcode='40001',message='RESOLVED_CONTEXT_RELEASE_STALE';
  end if;

  select pg_catalog.jsonb_agg(to_jsonb(projection_hash) order by projection_hash)
  into expected_projection_hashes
  from pg_catalog.unnest(array[
    release_record.executable_projection_hash,
    release_record.relationship_projection_hash,
    release_record.runtime_restriction_projection_hash
  ]::text[]) projection_hash;
  if requested->'semantic_projection_hashes'<>expected_projection_hashes then
    raise exception using errcode='40001',message='RESOLVED_CONTEXT_TEXT2SQL_PROJECTION_STALE';
  end if;

  if requested->>'route'='METRIC' then
    select candidate.value into metric_document
    from pg_catalog.jsonb_array_elements(app_data_agent.resolved_context_metric_projection(
      authority.app_id,authority.tenant_id,authority.environment,
      release_record.semantic_domain,release_record.release_id)) candidate(value)
    where candidate.value->>'metric_id'=requested->>'selected_metric_id';
    if metric_document is null then
      raise exception using errcode='23514',message='RESOLVED_CONTEXT_METRIC_MAPPING_NOT_QUERYABLE';
    end if;
    mapping_authorities:=pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'authority_kind','METRIC','authority_id',metric_document->>'metric_id',
      'authority_hash',metric_document->>'mapping_hash','mapping_refs',metric_document->'mapping_refs'));
  else
    for selected_object_id in
      select candidate.value#>>'{}' from pg_catalog.jsonb_array_elements(
        requested->'selected_ontology_ids') candidate(value) order by candidate.value#>>'{}'
    loop
      select candidate.value into ontology_document
      from pg_catalog.jsonb_array_elements(app_data_agent.resolved_context_ontology_projection(
        authority.app_id,authority.tenant_id,authority.environment,
        release_record.semantic_domain,release_record.release_id)) candidate(value)
      where candidate.value->>'object_id'=selected_object_id
        and (candidate.value->>'queryable')::boolean
        and pg_catalog.jsonb_array_length(candidate.value->'mapping_refs')>0;
      if ontology_document is null then
        raise exception using errcode='23514',message='RESOLVED_CONTEXT_ONTOLOGY_MAPPING_NOT_QUERYABLE';
      end if;
      mapping_authorities:=mapping_authorities||pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'authority_kind','ONTOLOGY','authority_id',ontology_document->>'object_id',
          'authority_hash',ontology_document->>'object_hash',
          'mapping_refs',ontology_document->'mapping_refs'));
    end loop;
  end if;

  select pg_catalog.jsonb_agg(to_jsonb(candidate.mapping_ref) order by candidate.mapping_ref)
  into expected_mapping_refs from (
    select distinct mapping_ref.value#>>'{}' as mapping_ref
    from pg_catalog.jsonb_array_elements(mapping_authorities) authority_document(value)
    cross join lateral pg_catalog.jsonb_array_elements(
      authority_document.value->'mapping_refs') mapping_ref(value)
  ) candidate;
  expected_mapping_closure_hash:=app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_object(
      'package_hash',receipt.package_hash,
      'authority_snapshot_hash',receipt.authority_snapshot_hash,
      'route',requested->>'route',
      'selected_metric_id',requested->'selected_metric_id',
      'selected_ontology_ids',requested->'selected_ontology_ids',
      'mapping_authorities',mapping_authorities,
      'semantic_projection_hashes',expected_projection_hashes));
  if requested->'mapping_refs'<>expected_mapping_refs
    or requested->>'mapping_closure_hash'<>expected_mapping_closure_hash
  then raise exception using errcode='23514',message='RESOLVED_CONTEXT_TEXT2SQL_MAPPING_CLOSURE_INVALID'; end if;
  return true;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='RESOLVED_CONTEXT_TEXT2SQL_BINDING_INVALID';
end
$function$;
alter function app_data_agent.verify_resolved_context_text2sql_binding(jsonb,uuid)
  owner to data_agent_u12_context_owner;

revoke all on function app_data_agent.verify_resolved_context_text2sql_binding(jsonb,uuid)
  from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.verify_resolved_context_text2sql_binding(jsonb,uuid)
  to data_agent_backend;

do $postconditions$
begin
  if not pg_catalog.has_function_privilege('data_agent_backend',
    'app_data_agent.verify_resolved_context_text2sql_binding(jsonb,uuid)','EXECUTE')
  then raise exception using errcode='P0001',message='U13_TEXT2SQL_VERIFIER_GRANT_MISSING'; end if;
  if exists(select 1 from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.verify_resolved_context_text2sql_binding(jsonb,uuid)'::regprocedure
      and (not procedure.prosecdef or not procedure.proconfig @> array['search_path=""']::text[]))
  then raise exception using errcode='P0001',message='U13_TEXT2SQL_VERIFIER_SECURITY_UNSAFE'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010664_app_data_agent_resolved_context_text2sql',
  'sha256:b79764d8c22025bace597ade6f501d1dd9ebf0f794cc3f97399cdf575bb51e99'
);

commit;
