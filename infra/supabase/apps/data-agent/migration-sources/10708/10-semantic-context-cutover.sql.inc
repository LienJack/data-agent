alter table app_data_agent.resolved_context_receipts rename to semantic_context_receipts;
alter trigger resolved_context_receipts_immutable on app_data_agent.semantic_context_receipts
  rename to semantic_context_receipts_immutable;
alter policy resolved_context_receipts_owner on app_data_agent.semantic_context_receipts
  rename to semantic_context_receipts_owner;

do $rename_constraints$
declare constraint_record record; replacement_name text;
begin
  for constraint_record in
    select constraint_name.conname
    from pg_catalog.pg_constraint constraint_name
    where constraint_name.conrelid='app_data_agent.semantic_context_receipts'::pg_catalog.regclass
      and constraint_name.conname like '%resolved_context%'
  loop
    replacement_name:=pg_catalog.replace(constraint_record.conname,'resolved_context','semantic_context');
    execute pg_catalog.format('alter table app_data_agent.semantic_context_receipts rename constraint %I to %I',
      constraint_record.conname,replacement_name);
  end loop;
end
$rename_constraints$;

alter function app_data_agent.reject_resolved_context_mutation() rename to reject_semantic_context_mutation;
alter function app_data_agent.resolved_context_exact_keys(jsonb,text[]) rename to semantic_context_exact_keys;
alter function app_data_agent.resolved_context_uuid_v8_from_hash(text) rename to semantic_context_uuid_v8_from_hash;
alter function app_data_agent.resolved_context_package_key_hash(jsonb) rename to semantic_context_package_key_hash;
alter function app_data_agent.assert_resolved_context_request(jsonb) rename to assert_semantic_context_request;
alter function app_data_agent.resolved_context_metric_projection(uuid,uuid,text,text,uuid)
  rename to semantic_context_metric_projection;
alter function app_data_agent.resolved_context_metric_projection_initial(uuid,uuid,text,text,uuid)
  rename to semantic_context_metric_projection_initial;
alter function app_data_agent.resolved_context_ontology_projection(uuid,uuid,text,text,uuid)
  rename to semantic_context_ontology_projection;
alter function app_data_agent.resolved_context_ontology_projection_initial(uuid,uuid,text,text,uuid)
  rename to semantic_context_ontology_projection_initial;
alter function app_data_agent.resolved_context_relationship_projection(uuid,uuid,text,text,uuid)
  rename to semantic_context_relationship_projection;
alter function app_data_agent.resolved_context_relationship_projection_initial(uuid,uuid,text,text,uuid)
  rename to semantic_context_relationship_projection_initial;
alter function app_data_agent.resolved_context_published_lexicon(uuid,uuid,text,text,uuid)
  rename to semantic_context_published_lexicon;
alter function app_data_agent.load_resolved_context_authority_snapshot(jsonb)
  rename to load_semantic_context_authority_snapshot;
alter function app_data_agent.commit_resolved_context_package(jsonb)
  rename to commit_semantic_context_package;
alter function app_data_agent.assert_resolved_context_integrity()
  rename to assert_semantic_context_integrity;
alter function app_data_agent.verify_resolved_context_text2sql_binding(jsonb,uuid)
  rename to verify_semantic_context_text2sql_binding;

do $rewrite_semantic_context_definitions$
declare signature text; definition text; rewritten text;
begin
  foreach signature in array array[
    'app_data_agent.reject_semantic_context_mutation()',
    'app_data_agent.semantic_context_exact_keys(jsonb,text[])',
    'app_data_agent.semantic_context_uuid_v8_from_hash(text)',
    'app_data_agent.semantic_context_package_key_hash(jsonb)',
    'app_data_agent.assert_semantic_context_request(jsonb)',
    'app_data_agent.semantic_context_metric_projection(uuid,uuid,text,text,uuid)',
    'app_data_agent.semantic_context_metric_projection_initial(uuid,uuid,text,text,uuid)',
    'app_data_agent.semantic_context_ontology_projection(uuid,uuid,text,text,uuid)',
    'app_data_agent.semantic_context_ontology_projection_initial(uuid,uuid,text,text,uuid)',
    'app_data_agent.semantic_context_relationship_projection(uuid,uuid,text,text,uuid)',
    'app_data_agent.semantic_context_relationship_projection_initial(uuid,uuid,text,text,uuid)',
    'app_data_agent.semantic_context_published_lexicon(uuid,uuid,text,text,uuid)',
    'app_data_agent.load_semantic_context_authority_snapshot(jsonb)',
    'app_data_agent.commit_semantic_context_package(jsonb)',
    'app_data_agent.assert_semantic_context_integrity()',
    'app_data_agent.verify_semantic_context_text2sql_binding(jsonb,uuid)'
  ]::text[]
  loop
    select pg_catalog.pg_get_functiondef(signature::pg_catalog.regprocedure) into strict definition;
    rewritten:=pg_catalog.replace(definition,'resolved_context','semantic_context');
    rewritten:=pg_catalog.replace(rewritten,'RESOLVED_CONTEXT','SEMANTIC_CONTEXT');
    rewritten:=pg_catalog.replace(rewritten,
      'resolved-context-authority-snapshot@2.0.0','semantic-context-authority-snapshot@1.0.0');
    rewritten:=pg_catalog.replace(rewritten,
      'resolved-context-request@1.0.0','semantic-context-request@1.0.0');
    rewritten:=pg_catalog.replace(rewritten,
      'resolved-context-package@2.0.0','semantic-context-package@1.0.0');
    rewritten:=pg_catalog.replace(rewritten,
      'resolved-context-route-decision@2.0.0','semantic-context-route-decision@1.0.0');
    rewritten:=pg_catalog.replace(rewritten,
      'resolved-context-receipt@1.0.0','semantic-context-receipt@1.0.0');
    rewritten:=pg_catalog.replace(rewritten,
      'resolved-context-commit@1.0.0','semantic-context-commit@1.0.0');
    rewritten:=pg_catalog.replace(rewritten,
      'resolved-context-commit-result@1.0.0','semantic-context-commit-result@1.0.0');
    rewritten:=pg_catalog.replace(rewritten,
      'resolved-context-text2sql-binding@1.0.0','semantic-context-text2sql-binding@1.0.0');
    rewritten:=pg_catalog.replace(rewritten,
      'resolved_context_package_ref','semantic_context_package_ref');
    if signature='app_data_agent.commit_semantic_context_package(jsonb)' then
      if pg_catalog.strpos(rewritten,
        $$'knowledge_refs','package_id','package_key_hash','package_hash'$$)=0
      then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_COMMIT_BASELINE_DRIFT'; end if;
      rewritten:=pg_catalog.replace(rewritten,
        $$'knowledge_refs','package_id','package_key_hash','package_hash'$$,
        $$'knowledge_refs','retrieval_receipt','inference_receipt','mandatory_closure','analysis_capabilities','package_id','package_key_hash','package_hash'$$);
    end if;
    execute rewritten;
  end loop;
end
$rewrite_semantic_context_definitions$;

create or replace function app_data_agent.commit_semantic_context_package(requested jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare
  authority record;
  authoritative_snapshot jsonb;
  expected_package_key_hash text;
  existing app_data_agent.semantic_context_receipts%rowtype;
  committed_at timestamptz;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED';
  end if;
  if requested is null or not app_data_agent.semantic_context_exact_keys(requested,array[
    'schema_version','request','authority_snapshot_hash','package','receipt'
  ]::text[]) or requested->>'schema_version'<>'semantic-context-commit@1.0.0'
  then raise exception using errcode='22023',message='SEMANTIC_CONTEXT_COMMIT_INVALID'; end if;
  perform app_data_agent.assert_semantic_context_request(requested->'request');
  if not app_data_agent.semantic_context_exact_keys(requested->'package',array[
      'schema_version','scope','semantic_domain','question_hash','defaults_ref','semantic_release',
      'schema_snapshot','context_policy','egress_policy','provider','authority_snapshot_hash',
      'route_decision','capacity','evidence','knowledge_refs','retrieval_receipt','inference_receipt',
      'mandatory_closure','analysis_capabilities','package_id','package_key_hash','package_hash'
    ]::text[])
    or requested#>>'{package,schema_version}'<>'semantic-context-package@1.0.0'
    or not app_data_agent.semantic_context_exact_keys(requested#>'{package,route_decision}',array[
      'schema_version','state','route','selected_metric_id','selected_ontology_ids',
      'clarification_candidates','lexical_evidence','capability_chain','reason_codes'
    ]::text[])
    or requested#>>'{package,route_decision,schema_version}'<>'semantic-context-route-decision@1.0.0'
    or not app_data_agent.semantic_context_exact_keys(requested->'receipt',array[
      'schema_version','receipt_id','scope','consumer','request_id','request_hash','run_id','package_ref',
      'state','route','authority_snapshot_hash','resolved_at','receipt_hash'
    ]::text[])
    or requested#>>'{receipt,schema_version}'<>'semantic-context-receipt@1.0.0'
    or not app_data_agent.semantic_context_exact_keys(requested#>'{receipt,package_ref}',array[
      'package_id','package_revision','package_hash'
    ]::text[])
    or requested#>>'{package,retrieval_receipt,schema_version}'<>'semantic-retrieval-receipt@1.0.0'
    or requested#>>'{package,inference_receipt,schema_version}'<>'semantic-inference-receipt@1.0.0'
    or requested#>>'{package,retrieval_receipt,receipt_hash}'<>
      app_data_agent.u2_canonical_sha256(requested#>'{package,retrieval_receipt}'-'receipt_hash')
    or requested#>>'{package,inference_receipt,receipt_hash}'<>
      app_data_agent.u2_canonical_sha256(requested#>'{package,inference_receipt}'-'receipt_hash')
    or requested#>>'{package,inference_receipt,retrieval_receipt_hash}'<>
      requested#>>'{package,retrieval_receipt,receipt_hash}'
    or requested#>>'{package,inference_receipt,closure_complete}'<>'true'
    or requested#>'{package,mandatory_closure,object_ids}'<>
      requested#>'{package,inference_receipt,mandatory_object_ids}'
    or requested#>'{package,mandatory_closure,relationship_ids}'<>
      requested#>'{package,inference_receipt,mandatory_relationship_ids}'
    or requested#>>'{package,mandatory_closure,closure_hash}'<>
      app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
        'object_ids',requested#>'{package,mandatory_closure,object_ids}',
        'relationship_ids',requested#>'{package,mandatory_closure,relationship_ids}'))
    or pg_catalog.jsonb_array_length(requested#>'{package,mandatory_closure,object_ids}')>80
    or pg_catalog.jsonb_array_length(requested#>'{package,mandatory_closure,relationship_ids}')>160
    or pg_catalog.jsonb_typeof(requested#>'{package,analysis_capabilities}')<>'array'
  then raise exception using errcode='22023',message='SEMANTIC_CONTEXT_COMMIT_INVALID'; end if;
  if exists(
    select 1 from pg_catalog.jsonb_array_elements(requested#>'{package,mandatory_closure,object_ids}') object_id(value)
    where not (requested#>'{package,retrieval_receipt,selected_object_ids}') ? (object_id.value#>>'{}')
  ) or exists(
    select 1 from pg_catalog.jsonb_array_elements(requested#>'{package,retrieval_receipt,hits}') hit(value)
    join pg_catalog.jsonb_array_elements(requested#>'{package,retrieval_receipt,hard_filter,excluded_objects}') excluded(value)
      on excluded.value->>'object_id'=hit.value->>'object_id'
  ) then raise exception using errcode='23514',message='SEMANTIC_CONTEXT_MANDATORY_CLOSURE_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  authoritative_snapshot:=app_data_agent.load_semantic_context_authority_snapshot(requested->'request');
  expected_package_key_hash:=app_data_agent.semantic_context_package_key_hash(requested->'package');
  if authoritative_snapshot->>'snapshot_hash'<>requested->>'authority_snapshot_hash'
    or requested#>>'{package,authority_snapshot_hash}'<>authoritative_snapshot->>'snapshot_hash'
    or requested#>>'{package,retrieval_receipt,authority_snapshot_hash}'<>authoritative_snapshot->>'snapshot_hash'
    or requested#>>'{package,retrieval_receipt,release_hash}'<>authoritative_snapshot#>>'{semantic_release,resource_hash}'
    or requested#>>'{package,retrieval_receipt,query_hash}'<>authoritative_snapshot->>'question_hash'
    or requested#>'{package,scope}'<>requested#>'{request,scope}'
    or requested#>>'{package,semantic_domain}'<>authoritative_snapshot->>'semantic_domain'
    or requested#>>'{package,question_hash}'<>authoritative_snapshot->>'question_hash'
    or requested#>'{package,defaults_ref}'<>authoritative_snapshot->'defaults_ref'
    or requested#>'{package,semantic_release}'<>authoritative_snapshot->'semantic_release'
    or requested#>'{package,schema_snapshot}'<>authoritative_snapshot->'schema_snapshot'
    or requested#>'{package,context_policy}'<>authoritative_snapshot->'context_policy'
    or requested#>'{package,egress_policy}'<>authoritative_snapshot->'egress_policy'
    or requested#>>'{package,provider}'<>authoritative_snapshot->>'provider'
    or requested#>'{package,knowledge_refs}'<>authoritative_snapshot->'knowledge_refs'
    or requested#>>'{package,package_key_hash}'<>expected_package_key_hash
    or requested#>>'{package,package_id}'<>
      app_data_agent.semantic_context_uuid_v8_from_hash(expected_package_key_hash)::text
    or requested#>>'{package,package_hash}'<>app_data_agent.u2_canonical_sha256(requested->'package'-'package_hash')
    or requested#>>'{receipt,receipt_hash}'<>app_data_agent.u2_canonical_sha256(requested->'receipt'-'receipt_hash')
    or requested#>'{receipt,scope}'<>requested#>'{request,scope}'
    or requested#>>'{receipt,request_id}'<>requested#>>'{request,request_id}'
    or requested#>>'{receipt,request_hash}'<>requested#>>'{request,request_hash}'
    or requested#>>'{receipt,package_ref,package_id}'<>requested#>>'{package,package_id}'
    or requested#>>'{receipt,package_ref,package_revision}'<>'1'
    or requested#>>'{receipt,package_ref,package_hash}'<>requested#>>'{package,package_hash}'
    or requested#>>'{receipt,authority_snapshot_hash}'<>authoritative_snapshot->>'snapshot_hash'
    or requested#>>'{receipt,state}'<>requested#>>'{package,route_decision,state}'
    or requested#>>'{receipt,route}'<>requested#>>'{package,route_decision,route}'
    or requested#>>'{receipt,consumer}'<>requested#>>'{request,basis,consumer}'
    or (requested#>>'{request,basis,consumer}'='PREVIEW' and requested#>'{receipt,run_id}'<>'null'::jsonb)
    or (requested#>>'{request,basis,consumer}'='RUN'
      and requested#>>'{receipt,run_id}'<>requested#>>'{request,basis,run_id}')
  then raise exception using errcode='23514',message='SEMANTIC_CONTEXT_COMMIT_CLOSURE_INVALID'; end if;
  select receipt.* into existing from app_data_agent.semantic_context_receipts receipt
  where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
    and receipt.environment=authority.environment
    and receipt.request_id=(requested#>>'{request,request_id}')::uuid
    and receipt.consumer=requested#>>'{request,basis,consumer}' for share;
  if found then
    if existing.receipt_hash<>requested#>>'{receipt,receipt_hash}'
      or existing.package_hash<>requested#>>'{package,package_hash}'
      or existing.package_json<>requested->'package' or existing.receipt_json<>requested->'receipt'
    then raise exception using errcode='23505',message='SEMANTIC_CONTEXT_IDEMPOTENCY_CONFLICT'; end if;
    return pg_catalog.jsonb_build_object('schema_version','semantic-context-commit-result@1.0.0',
      'disposition','REPLAYED','package',existing.package_json,'receipt',existing.receipt_json);
  end if;
  committed_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.semantic_context_receipts(
    app_id,tenant_id,environment,receipt_id,request_id,request_hash,consumer,run_id,
    package_id,package_key_hash,package_hash,
    authority_snapshot_hash,state,route,package_json,receipt_json,receipt_hash,resolved_at,committed_by,committed_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,(requested#>>'{receipt,receipt_id}')::uuid,
    (requested#>>'{request,request_id}')::uuid,requested#>>'{request,request_hash}',
    requested#>>'{request,basis,consumer}',
    case when requested#>>'{request,basis,consumer}'='RUN' then (requested#>>'{request,basis,run_id}')::uuid else null end,
    (requested#>>'{package,package_id}')::uuid,requested#>>'{package,package_key_hash}',
    requested#>>'{package,package_hash}',
    authoritative_snapshot->>'snapshot_hash',requested#>>'{package,route_decision,state}',
    requested#>>'{package,route_decision,route}',requested->'package',requested->'receipt',
    requested#>>'{receipt,receipt_hash}',(requested#>>'{receipt,resolved_at}')::timestamptz,
    authority.principal_id,committed_at);
  return pg_catalog.jsonb_build_object('schema_version','semantic-context-commit-result@1.0.0',
    'disposition','CREATED','package',requested->'package','receipt',requested->'receipt');
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SEMANTIC_CONTEXT_COMMIT_INVALID';
end
$function$;

do $rename_auxiliary_policy$
begin
  if exists(select 1 from pg_catalog.pg_policy policy
    join pg_catalog.pg_class relation on relation.oid=policy.polrelid
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='app_data_agent' and relation.relname='model_catalog_entries'
      and policy.polname='model_catalog_resolved_context_select')
  then
    alter policy model_catalog_resolved_context_select on app_data_agent.model_catalog_entries
      rename to model_catalog_semantic_context_select;
  end if;
end
$rename_auxiliary_policy$;
