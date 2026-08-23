create function app_data_agent.commit_resolved_context_package(requested jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare
  authority record;
  authoritative_snapshot jsonb;
  expected_package_key_hash text;
  existing app_data_agent.resolved_context_receipts%rowtype;
  committed_at timestamptz;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED';
  end if;
  if requested is null or not app_data_agent.resolved_context_exact_keys(requested,array[
    'schema_version','request','authority_snapshot_hash','package','receipt'
  ]::text[]) or requested->>'schema_version'<>'resolved-context-commit@1.0.0'
  then raise exception using errcode='22023',message='RESOLVED_CONTEXT_COMMIT_INVALID'; end if;
  perform app_data_agent.assert_resolved_context_request(requested->'request');
  if not app_data_agent.resolved_context_exact_keys(requested->'package',array[
      'schema_version','scope','semantic_domain','question_hash','defaults_ref','semantic_release',
      'schema_snapshot','context_policy','egress_policy','provider','authority_snapshot_hash',
      'route_decision','capacity','evidence','knowledge_refs','package_id','package_key_hash','package_hash'
    ]::text[])
    or requested#>>'{package,schema_version}'<>'resolved-context-package@1.0.0'
    or not app_data_agent.resolved_context_exact_keys(requested->'receipt',array[
      'schema_version','receipt_id','scope','consumer','request_id','request_hash','run_id','package_ref',
      'state','route','authority_snapshot_hash','resolved_at','receipt_hash'
    ]::text[])
    or requested#>>'{receipt,schema_version}'<>'resolved-context-receipt@1.0.0'
    or not app_data_agent.resolved_context_exact_keys(requested#>'{receipt,package_ref}',array[
      'package_id','package_revision','package_hash'
    ]::text[])
  then raise exception using errcode='22023',message='RESOLVED_CONTEXT_COMMIT_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  authoritative_snapshot:=app_data_agent.load_resolved_context_authority_snapshot(requested->'request');
  expected_package_key_hash:=app_data_agent.resolved_context_package_key_hash(requested->'package');
  if authoritative_snapshot->>'snapshot_hash'<>requested->>'authority_snapshot_hash'
    or requested#>>'{package,authority_snapshot_hash}'<>authoritative_snapshot->>'snapshot_hash'
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
      app_data_agent.resolved_context_uuid_v8_from_hash(expected_package_key_hash)::text
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
  then raise exception using errcode='23514',message='RESOLVED_CONTEXT_COMMIT_CLOSURE_INVALID'; end if;
  select receipt.* into existing from app_data_agent.resolved_context_receipts receipt
  where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
    and receipt.environment=authority.environment
    and receipt.request_id=(requested#>>'{request,request_id}')::uuid
    and receipt.consumer=requested#>>'{request,basis,consumer}' for share;
  if found then
    if existing.receipt_hash<>requested#>>'{receipt,receipt_hash}'
      or existing.package_hash<>requested#>>'{package,package_hash}'
      or existing.package_json<>requested->'package' or existing.receipt_json<>requested->'receipt'
    then raise exception using errcode='23505',message='RESOLVED_CONTEXT_IDEMPOTENCY_CONFLICT'; end if;
    return pg_catalog.jsonb_build_object('schema_version','resolved-context-commit-result@1.0.0',
      'disposition','REPLAYED','package',existing.package_json,'receipt',existing.receipt_json);
  end if;
  committed_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.resolved_context_receipts(
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
  return pg_catalog.jsonb_build_object('schema_version','resolved-context-commit-result@1.0.0',
    'disposition','CREATED','package',requested->'package','receipt',requested->'receipt');
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='RESOLVED_CONTEXT_COMMIT_INVALID';
end
$function$;
