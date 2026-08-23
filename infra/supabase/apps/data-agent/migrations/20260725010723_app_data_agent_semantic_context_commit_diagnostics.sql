-- semantic_context_commit_diagnostics_migration_checksum: sha256:b2d553f16e2194d872c7f124c76530c0fc473a8aa40867653df1a5aa2699bd74
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_CONTEXT_COMMIT_DIAGNOSTICS_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_CONTEXT_COMMIT_DIAGNOSTICS_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010722_app_data_agent_semantic_context_jsonb_operator_repair')
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_COMMIT_DIAGNOSTICS_BASELINE_10722_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $commit_diagnostics$
declare
  definition text;
  rewritten text;
  generic_suffix constant text := $$    or pg_catalog.jsonb_typeof(requested#>'{package,analysis_capabilities}')<>'array'
  then raise exception using errcode='22023',message='SEMANTIC_CONTEXT_COMMIT_INVALID'; end if;$$;
  diagnostic_suffix constant text := $$    or pg_catalog.jsonb_typeof(requested#>'{package,analysis_capabilities}')<>'array'
  then
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
    then raise exception using errcode='22023',message='SEMANTIC_CONTEXT_COMMIT_SHAPE_INVALID';
    elsif requested#>>'{package,retrieval_receipt,receipt_hash}'<>
      app_data_agent.u2_canonical_sha256(requested#>'{package,retrieval_receipt}'-('receipt_hash'::text))
    then raise exception using errcode='22023',message='SEMANTIC_CONTEXT_RETRIEVAL_RECEIPT_HASH_INVALID';
    elsif requested#>>'{package,inference_receipt,receipt_hash}'<>
      app_data_agent.u2_canonical_sha256(requested#>'{package,inference_receipt}'-('receipt_hash'::text))
    then raise exception using errcode='22023',message='SEMANTIC_CONTEXT_INFERENCE_RECEIPT_HASH_INVALID';
    elsif requested#>>'{package,inference_receipt,retrieval_receipt_hash}'<>
      requested#>>'{package,retrieval_receipt,receipt_hash}'
    then raise exception using errcode='22023',message='SEMANTIC_CONTEXT_INFERENCE_RECEIPT_LINK_INVALID';
    elsif requested#>>'{package,inference_receipt,closure_complete}'<>'true'
    then raise exception using errcode='22023',message='SEMANTIC_CONTEXT_INFERENCE_CLOSURE_INCOMPLETE';
    elsif requested#>'{package,mandatory_closure,object_ids}'<>
        requested#>'{package,inference_receipt,mandatory_object_ids}'
      or requested#>'{package,mandatory_closure,relationship_ids}'<>
        requested#>'{package,inference_receipt,mandatory_relationship_ids}'
    then raise exception using errcode='22023',message='SEMANTIC_CONTEXT_MANDATORY_CLOSURE_BINDING_INVALID';
    elsif requested#>>'{package,mandatory_closure,closure_hash}'<>
      app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
        'object_ids',requested#>'{package,mandatory_closure,object_ids}',
        'relationship_ids',requested#>'{package,mandatory_closure,relationship_ids}'))
    then raise exception using errcode='22023',message='SEMANTIC_CONTEXT_MANDATORY_CLOSURE_HASH_INVALID';
    elsif pg_catalog.jsonb_array_length(requested#>'{package,mandatory_closure,object_ids}')>80
      or pg_catalog.jsonb_array_length(requested#>'{package,mandatory_closure,relationship_ids}')>160
      or pg_catalog.jsonb_typeof(requested#>'{package,analysis_capabilities}')<>'array'
    then raise exception using errcode='22023',message='SEMANTIC_CONTEXT_CAPACITY_INVALID';
    else raise exception using errcode='22023',message='SEMANTIC_CONTEXT_COMMIT_INVALID';
    end if;
  end if;$$;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,generic_suffix)=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_COMMIT_SHAPE_INVALID')>0
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_COMMIT_DIAGNOSTICS_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(definition,generic_suffix,diagnostic_suffix);
  execute rewritten;
end
$commit_diagnostics$;
do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_COMMIT_SHAPE_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_RETRIEVAL_RECEIPT_HASH_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_INFERENCE_RECEIPT_HASH_INVALID')=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_MANDATORY_CLOSURE_HASH_INVALID')=0
    or pg_catalog.strpos(definition,$$requested#>'{package,retrieval_receipt}'-('receipt_hash'::text)$$)=0
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_COMMIT_DIAGNOSTICS_NOT_INSTALLED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010723_app_data_agent_semantic_context_commit_diagnostics',
  'sha256:b2d553f16e2194d872c7f124c76530c0fc473a8aa40867653df1a5aa2699bd74');
commit;
