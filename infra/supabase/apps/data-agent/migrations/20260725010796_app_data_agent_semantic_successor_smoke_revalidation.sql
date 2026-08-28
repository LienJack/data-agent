-- semantic_successor_smoke_revalidation_migration_checksum: sha256:4b3541be45d3e117510a497910de45f918b7a12111c338348b7bbd1de8217286
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010795_app_data_agent_falcon24_authority_staging_hold'
        and migration_checksum=
          'sha256:6a367834c337db45823104c28e4ecc2445b3ab73270fb0bbf766a20aad4f6d9d')
  then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_SMOKE_REVALIDATION_BASELINE_DRIFT'; end if;

  if pg_catalog.to_regclass('semantic.semantic_successor_release_stage') is null
    or pg_catalog.to_regclass('semantic.semantic_successor_stage_receipt') is null
    or pg_catalog.to_regprocedure('semantic.commit_semantic_successor_smoke(jsonb)') is null
    or pg_catalog.to_regprocedure('semantic.lock_semantic_authority_fence(uuid,uuid,text,text)')
      is null
    or pg_catalog.to_regprocedure('platform.current_backend_authority(boolean)') is null
    or pg_catalog.to_regprocedure('app_data_agent.u2_canonical_sha256(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.provider_json_object_has_exact_keys(jsonb,text[])')
      is null
    or pg_catalog.to_regprocedure('app_data_agent.contains_potential_plaintext_secret(jsonb,text)')
      is null
  then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_SMOKE_REVALIDATION_INVENTORY_DRIFT'; end if;
end
$preflight$;

create temporary table semantic_10796_successor_history_snapshot on commit drop as
select 'semantic_successor_release_stage'::text as relation_name,
  pg_catalog.count(*)::bigint as row_count,
  app_data_agent.u2_canonical_sha256(
    coalesce(pg_catalog.jsonb_agg(to_jsonb(stage) order by
      stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,stage.stage_id),
      '[]'::jsonb)) as row_digest
from semantic.semantic_successor_release_stage as stage
union all
select 'semantic_successor_stage_receipt'::text,
  pg_catalog.count(*)::bigint,
  app_data_agent.u2_canonical_sha256(
    coalesce(pg_catalog.jsonb_agg(to_jsonb(receipt) order by
      receipt.app_id,receipt.tenant_id,receipt.environment,receipt.semantic_domain,
      receipt.stage_id,receipt.receipt_id),
      '[]'::jsonb))
from semantic.semantic_successor_stage_receipt as receipt;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
create or replace function semantic.commit_semantic_successor_smoke(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record; stage_scope record; stage semantic.semantic_successor_release_stage%rowtype;
  existing semantic.semantic_successor_stage_receipt%rowtype; receipt jsonb;
  expected_hash text; now_at timestamptz:=pg_catalog.clock_timestamp();
  rejection_receipt jsonb; rejection_hash text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','idempotency_key','stage_id','expected_stage_digest',
      'receipt','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'semantic-successor-smoke-commit@1.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'stage_id') is distinct from true
    or pg_catalog.length(command->>'idempotency_key') not between 1 and 256
    or pg_catalog.btrim(command->>'idempotency_key') is distinct from command->>'idempotency_key'
    or command->>'expected_stage_digest'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'receipt') is distinct from 'object'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.contains_potential_plaintext_secret(command)
  then raise exception using errcode='22023',message='SEMANTIC_SUCCESSOR_SMOKE_COMMIT_INVALID'; end if;
  receipt:=command->'receipt';
  select * into strict authority from platform.current_backend_authority(true);
  select row.app_id,row.tenant_id,row.environment,row.semantic_domain into stage_scope
    from semantic.semantic_successor_release_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.stage_id=(command->>'stage_id')::uuid;
  if not found then raise exception using errcode='02000',
    message='SEMANTIC_SUCCESSOR_STAGE_NOT_FOUND'; end if;
  perform semantic.lock_semantic_authority_fence(
    stage_scope.app_id,stage_scope.tenant_id,stage_scope.environment,stage_scope.semantic_domain);
  select * into strict stage from semantic.semantic_successor_release_stage row
    where row.app_id=stage_scope.app_id and row.tenant_id=stage_scope.tenant_id
      and row.environment=stage_scope.environment and row.semantic_domain=stage_scope.semantic_domain
      and row.stage_id=(command->>'stage_id')::uuid for update;
  select * into existing from semantic.semantic_successor_stage_receipt row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
      and row.stage_id=stage.stage_id and row.receipt_kind='SMOKE'
      and row.operation_idempotency_key=command->>'idempotency_key';
  if found then
    if existing.operation_digest is distinct from command->>'command_hash'
    then raise exception using errcode='23505',message='SEMANTIC_SUCCESSOR_IDEMPOTENCY_CONFLICT'; end if;
    return existing.receipt_json;
  end if;
  expected_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'hash_domain','semantic-runtime-smoke-receipt@1.0.0',
    'receipt',receipt-'smoke_receipt_hash'));
  if stage.status not in('STAGED','SMOKE_PASSED')
    or (stage.status='SMOKE_PASSED' and receipt->>'outcome'<>'PASS')
    or stage.stage_digest is distinct from command->>'expected_stage_digest'
    or app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','receipt_id','stage_id','stage_digest','candidate_release',
      'projection_refs','resolved_metric_id','resolved_dimension_id',
      'resolved_binding_hash','plan_hash','calendar_timezone','window_start',
      'window_end_exclusive','validator_identity','worker_build_identity','outcome',
      'failure_code','smoke_receipt_hash']::text[]) is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(receipt->'receipt_id') is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(
      receipt->'validator_identity',array[
        'validator_version','validator_hash']::text[]) is distinct from true
    or receipt#>>'{validator_identity,validator_version}'
      !~'^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
    or receipt#>>'{validator_identity,validator_hash}'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.provider_json_object_has_exact_keys(
      receipt->'worker_build_identity',array[
        'schema_version','consumer_role','generation_id','build_id','built_at',
        'git_commit','git_dirty']::text[]) is distinct from true
    or receipt#>>'{worker_build_identity,schema_version}' is distinct from
      'runtime-build-identity@1.0.0'
    or receipt#>>'{worker_build_identity,consumer_role}' is distinct from 'worker'
    or receipt#>>'{worker_build_identity,generation_id}'!~'^sha256:[0-9a-f]{64}$'
    or receipt#>>'{worker_build_identity,build_id}'!~'^sha256:[0-9a-f]{64}$'
    or receipt#>>'{worker_build_identity,built_at}'
      !~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    or receipt#>>'{worker_build_identity,git_commit}'!~'^[a-f0-9]{7,64}$'
    or pg_catalog.jsonb_typeof(receipt#>'{worker_build_identity,git_dirty}')
      is distinct from 'boolean'
    or receipt->>'schema_version' is distinct from 'semantic-runtime-smoke-receipt@1.0.0'
    or receipt->>'stage_id' is distinct from stage.stage_id::text
    or receipt->>'stage_digest' is distinct from stage.stage_digest
    or receipt->'candidate_release' is distinct from stage.stage_document->'candidate_release'
    or receipt->'projection_refs' is distinct from stage.stage_document->'projection_refs'
    or receipt->>'resolved_metric_id' is distinct from 'metric.order_revenue'
    or receipt->>'resolved_dimension_id' is distinct from 'dimension.order_month'
    or receipt->>'resolved_binding_hash'!~'^sha256:[0-9a-f]{64}$'
    or receipt->>'plan_hash'!~'^sha256:[0-9a-f]{64}$'
    or receipt->>'calendar_timezone' is distinct from 'Asia/Shanghai'
    or receipt->>'window_start' is distinct from '2023-11-01T00:00:00.000Z'
    or receipt->>'window_end_exclusive' is distinct from '2024-11-01T00:00:00.000Z'
    or receipt->>'smoke_receipt_hash' is distinct from expected_hash
    or receipt->>'outcome' not in('PASS','FAIL')
    or (receipt->'failure_code'<>'null'::jsonb and (
      pg_catalog.jsonb_typeof(receipt->'failure_code') is distinct from 'string'
      or receipt->>'failure_code'!~'^[A-Z][A-Z0-9_]{2,127}$'))
    or ((receipt->>'outcome'='PASS') is distinct from (receipt->'failure_code'='null'::jsonb))
  then raise exception using errcode='40001',message='SEMANTIC_RUNTIME_SMOKE_FENCE_MISMATCH'; end if;
  select * into existing from semantic.semantic_successor_stage_receipt row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
      and row.stage_id=stage.stage_id and row.receipt_hash=receipt->>'smoke_receipt_hash';
  if found then raise exception using errcode='23505',
    message='SEMANTIC_SUCCESSOR_IDEMPOTENCY_CONFLICT'; end if;
  insert into semantic.semantic_successor_stage_receipt(
    app_id,tenant_id,environment,semantic_domain,stage_id,receipt_kind,receipt_id,
    receipt_schema_version,operation_idempotency_key,operation_digest,
    receipt_json,receipt_hash,created_at)
  values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,stage.stage_id,'SMOKE',
    (receipt->>'receipt_id')::uuid,receipt->>'schema_version',command->>'idempotency_key',
    command->>'command_hash',receipt,receipt->>'smoke_receipt_hash',now_at);
  if stage.status='STAGED' and receipt->>'outcome'='PASS' then
    update semantic.semantic_successor_release_stage set
      status='SMOKE_PASSED',smoke_passed_at=now_at
      where app_id=stage.app_id and tenant_id=stage.tenant_id and environment=stage.environment
        and semantic_domain=stage.semantic_domain and stage_id=stage.stage_id and status='STAGED';
  elsif stage.status='STAGED' and receipt->>'outcome'='FAIL' then
    update semantic.semantic_successor_release_stage set status='REJECTED',rejected_at=now_at
      where app_id=stage.app_id and tenant_id=stage.tenant_id and environment=stage.environment
        and semantic_domain=stage.semantic_domain and stage_id=stage.stage_id and status='STAGED';
    rejection_receipt:=pg_catalog.jsonb_build_object(
      'schema_version','semantic-successor-rejection-receipt@1.0.0',
      'receipt_id',extensions.gen_random_uuid(),'stage_id',stage.stage_id,
      'stage_digest',stage.stage_digest,'smoke_receipt_hash',receipt->>'smoke_receipt_hash',
      'failure_code',receipt->>'failure_code');
    rejection_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'hash_domain','semantic-successor-rejection-receipt@1.0.0','receipt',rejection_receipt));
    rejection_receipt:=rejection_receipt||pg_catalog.jsonb_build_object(
      'rejection_receipt_hash',rejection_hash);
    insert into semantic.semantic_successor_stage_receipt(
      app_id,tenant_id,environment,semantic_domain,stage_id,receipt_kind,receipt_id,
      receipt_schema_version,operation_idempotency_key,operation_digest,
      receipt_json,receipt_hash,created_at)
    values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,stage.stage_id,
      'REJECTION',(rejection_receipt->>'receipt_id')::uuid,
      rejection_receipt->>'schema_version',command->>'idempotency_key'||':rejection',
      command->>'command_hash',rejection_receipt,rejection_hash,now_at);
  end if;
  return receipt;
end
$function$;
alter function semantic.commit_semantic_successor_smoke(jsonb)
  owner to data_agent_u6_rpc_owner;

revoke all on function semantic.commit_semantic_successor_smoke(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function semantic.commit_semantic_successor_smoke(jsonb)
  to data_agent_backend;
do $postconditions$
declare snapshot record; after_count bigint; after_digest text; rpc record; rpc_definition text;
begin
  for snapshot in select * from semantic_10796_successor_history_snapshot loop
    if snapshot.relation_name='semantic_successor_release_stage' then
      select pg_catalog.count(*)::bigint,
        app_data_agent.u2_canonical_sha256(
          coalesce(pg_catalog.jsonb_agg(to_jsonb(stage) order by
            stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,stage.stage_id),
            '[]'::jsonb))
        into strict after_count,after_digest
        from semantic.semantic_successor_release_stage as stage;
    elsif snapshot.relation_name='semantic_successor_stage_receipt' then
      select pg_catalog.count(*)::bigint,
        app_data_agent.u2_canonical_sha256(
          coalesce(pg_catalog.jsonb_agg(to_jsonb(receipt) order by
            receipt.app_id,receipt.tenant_id,receipt.environment,receipt.semantic_domain,
            receipt.stage_id,receipt.receipt_id),
            '[]'::jsonb))
        into strict after_count,after_digest
        from semantic.semantic_successor_stage_receipt as receipt;
    else
      raise exception using errcode='P0001',
        message='SEMANTIC_SUCCESSOR_SMOKE_REVALIDATION_POSTCONDITION_FAILED';
    end if;
    if snapshot.row_count is distinct from after_count
      or snapshot.row_digest is distinct from after_digest
    then raise exception using errcode='P0001',
      message='SEMANTIC_SUCCESSOR_SMOKE_REVALIDATION_POSTCONDITION_FAILED'; end if;
  end loop;

  select procedure.provolatile,procedure.prosecdef,procedure.proconfig,
    pg_catalog.pg_get_userbyid(procedure.proowner) as owner_name,
    pg_catalog.pg_get_functiondef(procedure.oid)
    into strict rpc
    from pg_catalog.pg_proc as procedure
    where procedure.oid='semantic.commit_semantic_successor_smoke(jsonb)'::regprocedure;
  rpc_definition:=rpc.pg_get_functiondef;

  if rpc.provolatile is distinct from 'v'
    or rpc.prosecdef is distinct from true
    or rpc.owner_name is distinct from 'data_agent_u6_rpc_owner'
    or not (rpc.proconfig @> array['search_path=""']::text[])
    or pg_catalog.strpos(
      rpc_definition,'stage.status not in(''STAGED'',''SMOKE_PASSED'')')=0
    or pg_catalog.strpos(
      rpc_definition,
      'stage.status=''SMOKE_PASSED'' and receipt->>''outcome''<>''PASS''')=0
    or pg_catalog.has_function_privilege(
      'public','semantic.commit_semantic_successor_smoke(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','semantic.commit_semantic_successor_smoke(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_SMOKE_REVALIDATION_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010796_app_data_agent_semantic_successor_smoke_revalidation',
  'sha256:4b3541be45d3e117510a497910de45f918b7a12111c338348b7bbd1de8217286');

commit;
