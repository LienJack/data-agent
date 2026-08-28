begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare relation_name text; function_name text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010792_app_data_agent_semantic_successor_review_preparation'
        and migration_checksum=
          'sha256:9457e523edfd72d1f227f5109aea204e6ab8ed76a0f10cfd4b6f62a619cee055')
  then raise exception using errcode='P0001',
    message='FALCON24_SUCCESSOR_REVIEW_POLICY_BASELINE_DRIFT'; end if;

  foreach relation_name in array array[
    'app_data_agent.memberships',
    'app_data_agent.falcon24_current_authority_epoch',
    'semantic.semantic_domain_registry','semantic.semantic_active_pointer',
    'semantic.semantic_source_release',
    'semantic.semantic_reviewer_policy_revision',
    'semantic.semantic_reviewer_policy_pointer',
    'semantic.semantic_reviewer_assignment',
    'semantic.semantic_successor_review_preparation'
  ]::text[] loop
    if pg_catalog.to_regclass(relation_name) is null
    then raise exception using errcode='P0001',
      message='FALCON24_SUCCESSOR_REVIEW_POLICY_INVENTORY_DRIFT',
      detail=relation_name; end if;
  end loop;

  foreach function_name in array array[
    'semantic.lock_semantic_authority_fence(uuid,uuid,text,text)',
    'app_data_agent.u2_canonical_sha256(jsonb)',
    'app_data_agent.u6_uuid_v5(uuid,bytea)'
  ]::text[] loop
    if pg_catalog.to_regprocedure(function_name) is null
    then raise exception using errcode='P0001',
      message='FALCON24_SUCCESSOR_REVIEW_POLICY_FUNCTION_DRIFT',
      detail=function_name; end if;
  end loop;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
