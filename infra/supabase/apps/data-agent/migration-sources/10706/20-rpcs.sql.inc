create function app_data_agent.load_semantic_binding_impact_authority(requested jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; drift catalog.schema_drift_event%rowtype;
  release semantic.semantic_source_release%rowtype; packages jsonb; material jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED';
  end if;
  if requested is null or not app_data_agent.semantic_binding_impact_exact_keys(requested,array[
      'schema_version','semantic_domain','datasource_id','drift_event_id']::text[])
    or requested->>'schema_version'<>'semantic-binding-impact-analyze@1.0.0'
    or requested->>'semantic_domain'!~'^[A-Za-z_][A-Za-z0-9_]{0,63}$'
    or requested->>'datasource_id'!~'^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or (requested->>'drift_event_id')::uuid::text<>requested->>'drift_event_id'
  then raise exception using errcode='22023',message='SEMANTIC_BINDING_IMPACT_REQUEST_INVALID'; end if;
  select * into authority from platform.current_backend_authority(false);
  select event.* into drift from catalog.schema_drift_event event
  where event.app_id=authority.app_id and event.tenant_id=authority.tenant_id
    and event.environment=authority.environment and event.datasource_id=requested->>'datasource_id'
    and event.drift_event_id=(requested->>'drift_event_id')::uuid for share;
  if not found or drift.event_payload->>'binding_impact'<>'UNKNOWN'
    or drift.event_storage_digest<>platform.canonical_sha256(drift.event_payload)
  then raise exception using errcode='P0001',message='SEMANTIC_BINDING_IMPACT_DRIFT_NOT_FOUND'; end if;
  select source.* into release from semantic.semantic_source_release source
  join semantic.semantic_active_pointer pointer
    on pointer.app_id=source.app_id and pointer.tenant_id=source.tenant_id
    and pointer.environment=source.environment and pointer.semantic_domain=source.semantic_domain
    and pointer.current_release_id=source.release_id
    and pointer.current_release_generation=source.release_generation
    and pointer.current_release_digest=source.release_digest
  where source.app_id=authority.app_id and source.tenant_id=authority.tenant_id
    and source.environment=authority.environment and source.semantic_domain=requested->>'semantic_domain'
  for share of source,pointer;
  if not found then raise exception using errcode='40001',message='SEMANTIC_BINDING_IMPACT_RELEASE_STALE'; end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'namespace_id',package.namespace_id,'package_id',package.package_id,
    'package_version',package.package_version,'package_hash',package.package_hash,
    'objects',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'object_id',item.value->>'object_id','graph_entry_kind',item.value->>'graph_entry_kind',
      'graph_entry_id',item.value->>'graph_entry_id','semantic_role',item.value->>'semantic_role',
      'resolution',item.value->>'resolution','object_hash',app_data_agent.u2_canonical_sha256(item.value)
    ) order by item.value->>'object_id') from pg_catalog.jsonb_array_elements(package.package_json->'objects') item(value)),'[]'::jsonb),
    'physical_mappings',coalesce((select pg_catalog.jsonb_agg(item.value order by item.value->>'mapping_id')
      from pg_catalog.jsonb_array_elements(package.package_json->'physical_mappings') item(value)
      where item.value->>'datasource_id'=requested->>'datasource_id'),'[]'::jsonb),
    'metric_bindings',coalesce((select pg_catalog.jsonb_agg(item.value order by item.value->>'metric_object_id')
      from pg_catalog.jsonb_array_elements(package.package_json->'metric_bindings') item(value)),'[]'::jsonb),
    'constraints',coalesce((select pg_catalog.jsonb_agg(item.value order by item.value->>'constraint_id')
      from pg_catalog.jsonb_array_elements(package.package_json->'constraints') item(value)),'[]'::jsonb),
    'graph_edges',coalesce((select pg_catalog.jsonb_agg(item.value order by item.value->>'edge_id')
      from pg_catalog.jsonb_array_elements(package.package_json#>'{graph_source,edges}') item(value)),'[]'::jsonb)
  ) order by package.package_id,package.package_version) into packages
  from semantic.initial_semantic_release_sets release_set
  join semantic.initial_semantic_release_package_bindings binding
    using(app_id,tenant_id,environment,semantic_domain,release_set_id)
  join semantic.ontology_package_candidates package
    on package.app_id=binding.app_id and package.tenant_id=binding.tenant_id
    and package.environment=binding.environment and package.semantic_domain=binding.semantic_domain
    and package.package_id=binding.package_id and package.package_version=binding.package_version
    and package.package_hash=binding.package_hash
  where release_set.app_id=release.app_id and release_set.tenant_id=release.tenant_id
    and release_set.environment=release.environment and release_set.semantic_domain=release.semantic_domain
    and release_set.release_id=release.release_id;
  if packages is null then raise exception using errcode='P0001',message='SEMANTIC_BINDING_IMPACT_AUTHORITY_NOT_FOUND'; end if;
  if exists(select item.value->>'object_id' from pg_catalog.jsonb_array_elements(packages) package(value),
      lateral pg_catalog.jsonb_array_elements(package.value->'objects') item(value)
      group by item.value->>'object_id' having pg_catalog.count(*)>1)
    or exists(select item.value->>'mapping_id' from pg_catalog.jsonb_array_elements(packages) package(value),
      lateral pg_catalog.jsonb_array_elements(package.value->'physical_mappings') item(value)
      group by item.value->>'mapping_id' having pg_catalog.count(*)>1)
  then raise exception using errcode='P0001',message='SEMANTIC_BINDING_IMPACT_AUTHORITY_DUPLICATE'; end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(packages) package(value),
      lateral pg_catalog.jsonb_array_elements(package.value->'physical_mappings') mapping(value)
      where mapping.value->>'snapshot_content_hash'<>drift.base_snapshot_content_hash)
  then raise exception using errcode='40001',message='SEMANTIC_BINDING_IMPACT_MAPPING_STALE'; end if;
  material:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-binding-impact-authority@1.0.0',
    'scope',pg_catalog.jsonb_build_object('app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment,'semantic_domain',release.semantic_domain),
    'datasource_id',drift.datasource_id,
    'drift',pg_catalog.jsonb_build_object('event',drift.event_payload,'event_storage_digest',drift.event_storage_digest),
    'release',pg_catalog.jsonb_build_object('release_id',release.release_id,'generation',release.release_generation,
      'release_digest',release.release_digest),'packages',packages);
  return material||pg_catalog.jsonb_build_object('authority_input_hash',app_data_agent.u2_canonical_sha256(material));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SEMANTIC_BINDING_IMPACT_REQUEST_INVALID';
end
$function$;

create function app_data_agent.commit_semantic_binding_impact(requested jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; plan jsonb; candidate_draft jsonb; current_authority jsonb;
  existing app_data_agent.semantic_binding_impact_receipts%rowtype; candidate jsonb;
  candidate_ref jsonb; material jsonb; receipt jsonb; now_at timestamptz:=pg_catalog.clock_timestamp();
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED';
  end if;
  if requested is null or not app_data_agent.semantic_binding_impact_exact_keys(requested,array['plan','candidate_draft']::text[])
    or not app_data_agent.semantic_binding_impact_exact_keys(requested->'plan',array[
      'schema_version','impact_id','scope','datasource_id','authority_input_hash','drift_ref','release_ref',
      'status','risk_level','direct_impacts','transitive_impacts','unchanged_object_hashes',
      'suggested_actions','manual_reason_codes','candidate_operations','plan_hash']::text[])
    or requested#>>'{plan,schema_version}'<>'semantic-binding-impact-plan@1.0.0'
    or requested#>>'{plan,plan_hash}'<>app_data_agent.u2_canonical_sha256((requested->'plan')-'plan_hash')
    or (requested#>>'{plan,impact_id}')::uuid<>app_data_agent.semantic_binding_impact_uuid_v8(requested#>>'{plan,authority_input_hash}')
    or requested#>>'{plan,status}' not in ('NO_SEMANTIC_ACTION','REVIEW_REQUIRED','MANUAL_INVESTIGATION')
    or pg_catalog.jsonb_typeof(requested#>'{plan,direct_impacts}')<>'array'
    or pg_catalog.jsonb_typeof(requested#>'{plan,transitive_impacts}')<>'array'
    or pg_catalog.jsonb_typeof(requested#>'{plan,unchanged_object_hashes}')<>'array'
    or pg_catalog.jsonb_typeof(requested#>'{plan,suggested_actions}')<>'array'
    or pg_catalog.jsonb_typeof(requested#>'{plan,manual_reason_codes}')<>'array'
    or pg_catalog.jsonb_typeof(requested#>'{plan,candidate_operations}')<>'array'
    or (requested#>>'{plan,status}'='REVIEW_REQUIRED')<>(requested->'candidate_draft'<>'null'::jsonb)
    or (requested#>>'{plan,status}'='REVIEW_REQUIRED' and (
      pg_catalog.jsonb_array_length(requested#>'{plan,candidate_operations}') not between 1 and 256
      or exists(select 1 from pg_catalog.jsonb_array_elements(requested#>'{plan,candidate_operations}') operation(value)
        where operation.value->>'action'<>'MARK_STALE' or operation.value->'payload'<>'null'::jsonb)))
    or (requested#>>'{plan,status}'<>'REVIEW_REQUIRED'
      and pg_catalog.jsonb_array_length(requested#>'{plan,candidate_operations}')<>0)
    or (requested#>>'{plan,status}'='NO_SEMANTIC_ACTION'
      and (pg_catalog.jsonb_array_length(requested#>'{plan,direct_impacts}')<>0
        or pg_catalog.jsonb_array_length(requested#>'{plan,transitive_impacts}')<>0))
    or (requested#>>'{plan,status}'='MANUAL_INVESTIGATION'
      and pg_catalog.jsonb_array_length(requested#>'{plan,manual_reason_codes}')=0)
  then raise exception using errcode='22023',message='SEMANTIC_BINDING_IMPACT_COMMIT_INVALID'; end if;
  plan:=requested->'plan'; candidate_draft:=nullif(requested->'candidate_draft','null'::jsonb);
  select * into authority from platform.current_backend_authority(true);
  if plan#>>'{scope,app_id}'<>authority.app_id::text or plan#>>'{scope,tenant_id}'<>authority.tenant_id::text
    or plan#>>'{scope,environment}'<>authority.environment
  then raise exception using errcode='42501',message='SEMANTIC_BINDING_IMPACT_SCOPE_MISMATCH'; end if;
  perform pg_catalog.set_config('app.semantic_domain',plan#>>'{scope,semantic_domain}',true);
  current_authority:=app_data_agent.load_semantic_binding_impact_authority(pg_catalog.jsonb_build_object(
    'schema_version','semantic-binding-impact-analyze@1.0.0','semantic_domain',plan#>>'{scope,semantic_domain}',
    'datasource_id',plan->>'datasource_id','drift_event_id',plan#>>'{drift_ref,drift_event_id}'));
  if current_authority->>'authority_input_hash'<>plan->>'authority_input_hash'
    or current_authority->'scope'<>plan->'scope' or current_authority->>'datasource_id'<>plan->>'datasource_id'
    or current_authority#>>'{drift,event_storage_digest}'<>plan#>>'{drift_ref,event_storage_digest}'
    or current_authority->'release'<>plan->'release_ref'
  then raise exception using errcode='40001',message='SEMANTIC_BINDING_IMPACT_AUTHORITY_STALE'; end if;
  select * into existing from app_data_agent.semantic_binding_impact_receipts receipt_row
  where receipt_row.app_id=authority.app_id and receipt_row.tenant_id=authority.tenant_id
    and receipt_row.environment=authority.environment and receipt_row.semantic_domain=plan#>>'{scope,semantic_domain}'
    and receipt_row.impact_id=(plan->>'impact_id')::uuid;
  if found then
    if existing.plan_hash<>plan->>'plan_hash' or existing.authority_input_hash<>plan->>'authority_input_hash'
    then raise exception using errcode='23505',message='SEMANTIC_BINDING_IMPACT_IDEMPOTENCY_CONFLICT'; end if;
    return existing.receipt_json||pg_catalog.jsonb_build_object('created',false);
  end if;
  if candidate_draft is not null then
    if not app_data_agent.semantic_binding_impact_exact_keys(candidate_draft,array[
        'schema_version','title','description','semantic_domain','change_class','risk_level',
        'idempotency_key','source_payload','diff']::text[])
      or candidate_draft->>'schema_version'<>'semantic-candidate-draft@1.0.0'
      or candidate_draft->>'semantic_domain'<>plan#>>'{scope,semantic_domain}'
      or candidate_draft->>'idempotency_key'<>plan->>'impact_id'
      or not app_data_agent.semantic_binding_impact_exact_keys(candidate_draft->'source_payload',array[
        'schema_version','source_kind','content']::text[])
      or candidate_draft#>>'{source_payload,source_kind}'<>'SCHEMA_DISCOVERY'
      or not app_data_agent.semantic_binding_impact_exact_keys(candidate_draft#>'{source_payload,content}',array[
        'schema_version','impact_id','plan_hash','authority_input_hash','drift_ref','release_ref','review_only']::text[])
      or candidate_draft#>>'{source_payload,content,impact_id}'<>plan->>'impact_id'
      or candidate_draft#>>'{source_payload,content,review_only}'<>'true'
      or candidate_draft#>>'{source_payload,content,plan_hash}'<>plan->>'plan_hash'
      or candidate_draft#>>'{source_payload,content,authority_input_hash}'<>plan->>'authority_input_hash'
      or candidate_draft#>'{source_payload,content,drift_ref}'<>plan->'drift_ref'
      or candidate_draft#>'{source_payload,content,release_ref}'<>plan->'release_ref'
      or not app_data_agent.semantic_binding_impact_exact_keys(candidate_draft->'diff',array[
        'schema_version','summary','operations']::text[])
      or candidate_draft#>>'{diff,schema_version}'<>'semantic-diff@1.0.0'
      or pg_catalog.jsonb_typeof(candidate_draft#>'{diff,operations}')<>'array'
      or pg_catalog.jsonb_array_length(candidate_draft#>'{diff,operations}')
        <>pg_catalog.jsonb_array_length(plan->'candidate_operations')
      or exists(select 1 from pg_catalog.jsonb_array_elements(candidate_draft#>'{diff,operations}') operation(value)
        where operation.value->>'change_type'<>'MODIFY'
          or operation.value#>>'{before,state}'<>'CURRENT_RELEASE'
          or operation.value#>>'{after,state}'<>'STALE')
    then raise exception using errcode='22023',message='SEMANTIC_BINDING_IMPACT_CANDIDATE_INVALID'; end if;
    candidate:=semantic.create_candidate_draft(authority.app_id,authority.tenant_id,authority.environment,
      plan#>>'{scope,semantic_domain}',authority.principal_id::text,(plan->>'impact_id')::uuid,
      candidate_draft->>'title',candidate_draft->>'description',candidate_draft->>'change_class',
      candidate_draft->>'risk_level',candidate_draft->'source_payload',candidate_draft->'diff');
    if candidate->>'candidate_status'<>'DRAFT' then
      raise exception using errcode='P0001',message='SEMANTIC_BINDING_IMPACT_CANDIDATE_STATE_INVALID';
    end if;
    candidate_ref:=pg_catalog.jsonb_build_object('candidate_id',candidate->>'candidate_id',
      'revision_id',candidate->>'revision_id','source_revision_id',candidate->>'source_revision_id',
      'source_digest',candidate->>'source_digest','revision_digest',candidate->>'revision_digest');
  else candidate_ref:=null;
  end if;
  material:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-binding-impact-receipt@1.0.0','authority','POSTGRESQL',
    'impact_id',plan->>'impact_id','scope',plan->'scope','datasource_id',plan->>'datasource_id',
    'authority_input_hash',plan->>'authority_input_hash','plan_hash',plan->>'plan_hash',
    'drift_event_id',plan#>>'{drift_ref,drift_event_id}','release',plan->'release_ref',
    'status',plan->>'status','risk_level',plan->>'risk_level',
    'direct_impact_count',pg_catalog.jsonb_array_length(plan->'direct_impacts'),
    'transitive_impact_count',pg_catalog.jsonb_array_length(plan->'transitive_impacts'),
    'suggested_actions',plan->'suggested_actions','manual_reason_codes',plan->'manual_reason_codes',
    'candidate_ref',candidate_ref,'committed_at',app_data_agent.semantic_binding_impact_utc_millis(now_at));
  receipt:=material||pg_catalog.jsonb_build_object('receipt_hash',app_data_agent.u2_canonical_sha256(material));
  insert into app_data_agent.semantic_binding_impact_receipts(app_id,tenant_id,environment,semantic_domain,
    impact_id,datasource_id,drift_event_id,event_storage_digest,release_id,release_generation,release_digest,
    authority_input_hash,plan_hash,receipt_hash,candidate_id,candidate_revision_id,receipt_json,committed_by,committed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,plan#>>'{scope,semantic_domain}',
    (plan->>'impact_id')::uuid,plan->>'datasource_id',(plan#>>'{drift_ref,drift_event_id}')::uuid,
    plan#>>'{drift_ref,event_storage_digest}',(plan#>>'{release_ref,release_id}')::uuid,
    (plan#>>'{release_ref,generation}')::bigint,plan#>>'{release_ref,release_digest}',plan->>'authority_input_hash',
    plan->>'plan_hash',receipt->>'receipt_hash',nullif(candidate_ref->>'candidate_id','')::uuid,
    nullif(candidate_ref->>'revision_id','')::uuid,receipt,authority.principal_id,now_at);
  return receipt||pg_catalog.jsonb_build_object('created',true);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SEMANTIC_BINDING_IMPACT_COMMIT_INVALID';
end
$function$;

create function app_data_agent.get_semantic_binding_impact(requested jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; stored app_data_agent.semantic_binding_impact_receipts%rowtype;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED';
  end if;
  if requested is null or not app_data_agent.semantic_binding_impact_exact_keys(requested,array['semantic_domain','impact_id']::text[])
    or requested->>'semantic_domain'!~'^[A-Za-z_][A-Za-z0-9_]{0,63}$'
    or (requested->>'impact_id')::uuid::text<>requested->>'impact_id'
  then raise exception using errcode='22023',message='SEMANTIC_BINDING_IMPACT_REQUEST_INVALID'; end if;
  select * into authority from platform.current_backend_authority(false);
  select * into stored from app_data_agent.semantic_binding_impact_receipts receipt
  where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
    and receipt.environment=authority.environment and receipt.semantic_domain=requested->>'semantic_domain'
    and receipt.impact_id=(requested->>'impact_id')::uuid;
  if not found then return null; end if;
  return pg_catalog.jsonb_build_object('schema_version','semantic-binding-impact-safe-projection@1.0.0',
    'impact_id',stored.receipt_json->>'impact_id','receipt_hash',stored.receipt_hash,
    'plan_hash',stored.plan_hash,'drift_event_id',stored.receipt_json->>'drift_event_id',
    'release',stored.receipt_json->'release','status',stored.receipt_json->>'status',
    'risk_level',stored.receipt_json->>'risk_level','direct_impact_count',stored.receipt_json->'direct_impact_count',
    'transitive_impact_count',stored.receipt_json->'transitive_impact_count',
    'suggested_actions',stored.receipt_json->'suggested_actions',
    'manual_reason_codes',stored.receipt_json->'manual_reason_codes',
    'candidate_ref',stored.receipt_json->'candidate_ref','committed_at',stored.receipt_json->>'committed_at');
exception when invalid_text_representation then
  raise exception using errcode='22023',message='SEMANTIC_BINDING_IMPACT_REQUEST_INVALID';
end
$function$;
