create function app_data_agent.reject_semantic_induction_immutable_mutation()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  raise exception using errcode='55000',message='SEMANTIC_INDUCTION_AUTHORITY_IMMUTABLE';
end
$function$;

create function app_data_agent.semantic_induction_assert_source(source jsonb)
returns void language plpgsql immutable security definer set search_path=''
as $function$
begin
  if not app_data_agent.provider_json_object_has_exact_keys(source,array[
      'schema_version','source_kind','source_ref','corpus_class','taint'
    ]) or source->>'schema_version'<>'semantic-induction-source@1.0.0'
    or source->>'source_kind' not in (
      'PHYSICAL_SCHEMA','KNOWLEDGE_DOCUMENT','METRIC_EXCHANGE','FOUNDATIONAL_ONTOLOGY'
    ) or source->>'corpus_class'<>'SEMANTIC_BOOTSTRAP_CORPUS'
    or not app_data_agent.provider_json_object_has_exact_keys(source->'source_ref',array[
      'resource_kind','resource_id','resource_revision','resource_hash'
    ]) or (source#>>'{source_ref,resource_id}')::uuid::text<>source#>>'{source_ref,resource_id}'
    or (source#>>'{source_ref,resource_revision}')::bigint not between 1 and 9007199254740991
    or source#>>'{source_ref,resource_hash}'!~'^sha256:[0-9a-f]{64}$'
    or not app_data_agent.provider_json_object_has_exact_keys(source->'taint',array[
      'contains_holdout_or_test','contains_gold_or_expected_output','contains_oracle_feedback','sealed_benchmark'
    ]) or (source#>>'{taint,contains_holdout_or_test}')::boolean
    or (source#>>'{taint,contains_gold_or_expected_output}')::boolean
    or (source#>>'{taint,contains_oracle_feedback}')::boolean
    or (source#>>'{taint,sealed_benchmark}')::boolean
    or (source->>'source_kind'='PHYSICAL_SCHEMA' and source#>>'{source_ref,resource_kind}'<>'SCHEMA_SNAPSHOT')
    or (source->>'source_kind'='KNOWLEDGE_DOCUMENT' and source#>>'{source_ref,resource_kind}'<>'KNOWLEDGE_REVISION')
    or (source->>'source_kind'='METRIC_EXCHANGE' and source#>>'{source_ref,resource_kind}'<>'METRIC_EXCHANGE_PACKAGE')
    or (source->>'source_kind'='FOUNDATIONAL_ONTOLOGY' and source#>>'{source_ref,resource_kind}'<>'FOUNDATIONAL_ONTOLOGY_RELEASE')
  then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_SOURCE_INVALID'; end if;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SEMANTIC_INDUCTION_SOURCE_INVALID';
end
$function$;

create function app_data_agent.semantic_induction_assert_request(requested_request jsonb)
returns void language plpgsql stable security definer set search_path=''
as $function$
declare source jsonb; previous_identity text; identity text;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_request,array[
      'schema_version','scope','semantic_domain','induction_id','induction_kind',
      'base_release_ref','sources','idempotency_key'
    ]) or requested_request->>'schema_version'<>'semantic-induction-request@1.0.0'
    or requested_request->>'induction_kind' not in (
      'SCHEMA_INDUCTION','DOCUMENT_INDUCTION','FOUNDATIONAL_GROUNDING','DRIFT_REPAIR','METRIC_IMPORT'
    ) or (requested_request->>'induction_id')::uuid::text<>requested_request->>'induction_id'
    or requested_request->>'semantic_domain'!~'^[A-Za-z_][A-Za-z0-9_]{0,63}$'
    or pg_catalog.jsonb_typeof(requested_request->'sources')<>'array'
    or pg_catalog.jsonb_array_length(requested_request->'sources') not between 1 and 64
    or (requested_request->>'induction_kind'='METRIC_IMPORT'
      and pg_catalog.jsonb_array_length(requested_request->'sources')<>1)
    or requested_request#>>'{scope,app_id}'<>pg_catalog.current_setting('data_agent.app_id',true)
    or requested_request#>>'{scope,tenant_id}'<>pg_catalog.current_setting('data_agent.tenant_id',true)
    or requested_request#>>'{scope,environment}'<>pg_catalog.current_setting('data_agent.environment',true)
  then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_REQUEST_INVALID'; end if;
  for source in select value from pg_catalog.jsonb_array_elements(requested_request->'sources') loop
    perform app_data_agent.semantic_induction_assert_source(source);
    if (requested_request->>'induction_kind'='SCHEMA_INDUCTION' and source->>'source_kind'<>'PHYSICAL_SCHEMA')
      or (requested_request->>'induction_kind'='DOCUMENT_INDUCTION' and source->>'source_kind'<>'KNOWLEDGE_DOCUMENT')
      or (requested_request->>'induction_kind'='METRIC_IMPORT' and source->>'source_kind'<>'METRIC_EXCHANGE')
      or (requested_request->>'induction_kind'='FOUNDATIONAL_GROUNDING' and source->>'source_kind'<>'FOUNDATIONAL_ONTOLOGY')
    then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_SOURCE_KIND_MISMATCH'; end if;
    identity:=pg_catalog.jsonb_build_array(
      source->>'source_kind',source#>>'{source_ref,resource_id}',
      (source#>>'{source_ref,resource_revision}')::bigint,source#>>'{source_ref,resource_hash}'
    )::text;
    if previous_identity is not null and previous_identity>=identity then
      raise exception using errcode='22023',message='SEMANTIC_INDUCTION_SOURCES_NOT_CANONICAL'; end if;
    previous_identity:=identity;
  end loop;
end
$function$;

create function app_data_agent.semantic_induction_utc_millis(value timestamptz)
returns text language sql immutable strict parallel safe set search_path=''
as $function$
  select pg_catalog.to_char(value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$function$;

create function app_data_agent.semantic_induction_assert_base_release(
  request jsonb, requested_app_id uuid, requested_tenant_id uuid, requested_environment text
) returns void language plpgsql stable security definer set search_path=''
as $function$
begin
  if request->'base_release_ref'='null'::jsonb then
    if exists (
      select 1 from semantic.semantic_source_release release
      where release.app_id=requested_app_id and release.tenant_id=requested_tenant_id
        and release.environment=requested_environment
        and release.semantic_domain=request->>'semantic_domain'
    ) then raise exception using errcode='40001',message='SEMANTIC_INDUCTION_BASE_RELEASE_REQUIRED'; end if;
  elsif not exists (
    select 1 from semantic.semantic_source_release release
    join semantic.semantic_active_pointer pointer
      on pointer.app_id=release.app_id and pointer.tenant_id=release.tenant_id
      and pointer.environment=release.environment
      and pointer.semantic_domain=release.semantic_domain
      and pointer.current_release_id=release.release_id
      and pointer.current_release_generation=release.release_generation
      and pointer.current_release_digest=release.release_digest
    where release.app_id=requested_app_id and release.tenant_id=requested_tenant_id
      and release.environment=requested_environment
      and release.semantic_domain=request->>'semantic_domain'
      and release.release_id=(request#>>'{base_release_ref,release_id}')::uuid
      and release.release_generation=(request#>>'{base_release_ref,generation}')::bigint
      and release.release_digest=request#>>'{base_release_ref,release_hash}'
  ) then raise exception using errcode='40001',message='SEMANTIC_INDUCTION_BASE_RELEASE_STALE'; end if;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SEMANTIC_INDUCTION_BASE_RELEASE_INVALID';
end
$function$;

create function app_data_agent.semantic_induction_stable_object_id(identity_hash text)
returns uuid language plpgsql immutable strict security definer set search_path=''
as $function$
declare value text; variant text;
begin
  if identity_hash!~'^sha256:[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='SEMANTIC_STABLE_OBJECT_IDENTITY_INVALID';
  end if;
  value:=pg_catalog.substr(identity_hash,8,32);
  value:=pg_catalog.substr(value,1,12)||'8'||pg_catalog.substr(value,14);
  variant:=case pg_catalog.substr(value,17,1)
    when '0' then '8' when '4' then '8' when '8' then '8' when 'c' then '8'
    when '1' then '9' when '5' then '9' when '9' then '9' when 'd' then '9'
    when '2' then 'a' when '6' then 'a' when 'a' then 'a' when 'e' then 'a'
    else 'b' end;
  value:=pg_catalog.substr(value,1,16)||variant||pg_catalog.substr(value,18);
  return (pg_catalog.substr(value,1,8)||'-'||pg_catalog.substr(value,9,4)||'-'||
    pg_catalog.substr(value,13,4)||'-'||pg_catalog.substr(value,17,4)||'-'||
    pg_catalog.substr(value,21,12))::uuid;
end
$function$;
