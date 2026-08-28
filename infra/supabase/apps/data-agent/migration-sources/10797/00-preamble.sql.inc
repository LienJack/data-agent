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
          '20260725010796_app_data_agent_semantic_successor_smoke_revalidation'
        and migration_checksum=
          'sha256:4b3541be45d3e117510a497910de45f918b7a12111c338348b7bbd1de8217286')
  then raise exception using errcode='P0001',
    message='FALCON24_SUCCESSOR_ACTIVATION_CLOSURE_BASELINE_DRIFT'; end if;

  if pg_catalog.to_regprocedure(
      'app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)') is null
    or pg_catalog.to_regprocedure('semantic.lock_semantic_authority_fence(uuid,uuid,text,text)')
      is null
    or pg_catalog.to_regprocedure('platform.current_backend_authority(boolean)') is null
    or pg_catalog.to_regprocedure('app_data_agent.u2_canonical_sha256(jsonb)') is null
    or pg_catalog.to_regclass('semantic.semantic_successor_release_stage') is null
    or pg_catalog.to_regclass('semantic.semantic_successor_projection_stage') is null
    or pg_catalog.to_regclass('semantic.semantic_successor_stage_receipt') is null
    or pg_catalog.to_regclass('semantic.semantic_source_revision') is null
    or pg_catalog.to_regclass('semantic.semantic_candidate') is null
    or pg_catalog.to_regclass('semantic.semantic_candidate_revision') is null
    or pg_catalog.to_regclass('semantic.semantic_publish_attempt') is null
    or pg_catalog.to_regclass('semantic.semantic_review_task') is null
    or pg_catalog.to_regclass('semantic.semantic_successor_review_preparation') is null
    or pg_catalog.to_regclass('semantic.semantic_successor_review_decision_document') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_authority_staging_sessions') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_authority_staging_receipts') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_authority_baselines') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_authority_activation_attempts') is null
  then raise exception using errcode='P0001',
    message='FALCON24_SUCCESSOR_ACTIVATION_CLOSURE_INVENTORY_DRIFT'; end if;
end
$preflight$;

create temporary table falcon24_10797_authority_history_snapshot(
  relation_name text primary key,
  row_count bigint not null,
  row_digest text not null
) on commit drop;

do $snapshot$
declare relation_name text; schema_name text; table_name text;
  before_count bigint; before_digest text;
begin
  foreach relation_name in array array[
    'semantic.semantic_successor_release_stage',
    'semantic.semantic_successor_projection_stage',
    'semantic.semantic_successor_stage_receipt',
    'app_data_agent.falcon24_authority_staging_sessions',
    'app_data_agent.falcon24_authority_staging_receipts',
    'app_data_agent.falcon24_authority_baselines',
    'app_data_agent.falcon24_authority_activation_attempts',
    'semantic.semantic_source_revision',
    'semantic.semantic_candidate',
    'semantic.semantic_candidate_revision',
    'semantic.semantic_publish_attempt',
    'semantic.semantic_review_task',
    'semantic.semantic_successor_review_preparation',
    'semantic.semantic_successor_review_decision_document'
  ]::text[] loop
    schema_name:=pg_catalog.split_part(relation_name,'.',1);
    table_name:=pg_catalog.split_part(relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint, app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by '
      ||'to_jsonb(row_value)::text),''[]''::jsonb)) from %I.%I as row_value',
      schema_name,table_name)
      into strict before_count,before_digest;
    insert into falcon24_10797_authority_history_snapshot(
      relation_name,row_count,row_digest)
    values(relation_name,before_count,before_digest);
  end loop;
end
$snapshot$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
