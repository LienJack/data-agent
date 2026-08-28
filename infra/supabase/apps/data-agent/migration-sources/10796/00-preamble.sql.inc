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
