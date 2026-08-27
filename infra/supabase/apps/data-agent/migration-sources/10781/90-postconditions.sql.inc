do $history_postconditions$
declare snapshot_row record;target_relation_name text;target_relation regclass;
  observed_count bigint;observed_digest text;
begin
  for snapshot_row in select * from falcon24_e1_relation_snapshot order by relation_name loop
    target_relation_name:=case snapshot_row.relation_name
      when 'falcon24_e1_staging_sessions' then 'falcon24_authority_staging_sessions'
      when 'falcon24_e1_staging_receipts' then 'falcon24_authority_staging_receipts'
      when 'falcon24_e1_activation_attempts' then 'falcon24_authority_activation_attempts'
      when 'falcon24_e1_ui_receipts' then 'falcon24_ui_receipts'
      when 'falcon24_e1_gate_attempt_history' then 'falcon24_gate_attempt_history'
      when 'e1_analysis_publications' then 'falcon24_analysis_publications'
      when 'e1_analysis_publication_artifacts' then 'falcon24_analysis_publication_artifacts'
      when 'e1_analysis_publication_current' then 'falcon24_analysis_publication_current'
      when 'e1_analysis_publication_outbox' then 'falcon24_analysis_publication_outbox'
      else snapshot_row.relation_name end;
    target_relation:=pg_catalog.to_regclass('app_data_agent.'||target_relation_name);
    if target_relation is null or target_relation::oid<>snapshot_row.relation_oid
    then raise exception using errcode='P0001',message='FALCON24_E1_HISTORY_DRIFT'; end if;
    execute pg_catalog.format(
      'select pg_catalog.count(*),app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(source)-$1 order by '
      ||'(to_jsonb(source)-$1)::text),''[]''::jsonb)) from %s source',target_relation)
      into strict observed_count,observed_digest using snapshot_row.excluded_columns;
    if observed_count<>snapshot_row.row_count or observed_digest<>snapshot_row.row_digest
    then raise exception using errcode='P0001',message='FALCON24_E1_HISTORY_DRIFT',
      detail=pg_catalog.jsonb_build_object('relation',target_relation_name)::text; end if;
  end loop;
end
$history_postconditions$;

do $authority_postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'falcon24_e1_staging_sessions','falcon24_e1_staging_receipts',
    'falcon24_e1_activation_attempts','falcon24_e1_ui_receipts',
    'falcon24_e1_gate_attempt_history','e1_analysis_publications',
    'e1_analysis_publication_artifacts','e1_analysis_publication_current',
    'e1_analysis_publication_outbox'
  ]::text[] loop
    if pg_catalog.to_regclass('app_data_agent.'||relation_name) is not null
    then raise exception using errcode='P0001',
      message='FALCON24_E2_SECOND_AUTHORITY_TRUTH_DETECTED'; end if;
  end loop;

  foreach relation_name in array array[
    'falcon24_authority_staging_sessions','falcon24_authority_staging_receipts',
    'falcon24_authority_baselines','falcon24_authority_activation_attempts',
    'falcon24_current_authority_epoch','falcon24_ui_receipts',
    'falcon24_gate_attempt_history','falcon24_analysis_publications',
    'falcon24_analysis_publication_artifacts','falcon24_analysis_publication_current',
    'falcon24_analysis_publication_outbox'
  ]::text[] loop
    if not exists(select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='app_data_agent' and relation.relname=relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity)
    then raise exception using errcode='P0001',message='FALCON24_AUTHORITY_RLS_DRIFT'; end if;
  end loop;

  if not exists(select 1 from pg_catalog.pg_indexes
      where schemaname='app_data_agent'
        and indexname='falcon24_authority_one_active_baseline_per_epoch'
        and indexdef like '%app_id, tenant_id, environment, authority_epoch%')
    or exists(select 1 from app_data_agent.falcon24_authority_baselines
      where authority_epoch!~'^E[1-9][0-9]*$')
    or exists(select 1 from app_data_agent.falcon24_current_authority_epoch
      where authority_epoch!~'^E[1-9][0-9]*$')
    or exists(select 1 from app_data_agent.falcon24_qualifications
      where qualification_id<>authority_epoch||'-Q1')
    or exists(select 1 from app_data_agent.falcon24_acceptance_campaigns
      where campaign_id<>authority_epoch||'-C1')
  then raise exception using errcode='P0001',message='FALCON24_AUTHORITY_IDENTITY_DRIFT'; end if;

  if not pg_catalog.has_function_privilege('data_agent_u6_rpc_owner',
      'app_data_agent.activate_falcon24_authority(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.activate_falcon24_authority(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.activate_falcon24_authority(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.activate_falcon24_e1_authority(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.activate_falcon24_e1_authority(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_e1_analysis_publication(jsonb)','EXECUTE')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_authority_baselines','SELECT')
  then raise exception using errcode='P0001',message='FALCON24_AUTHORITY_GRANT_DRIFT'; end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname in(
          'begin_falcon24_authority_staging_session',
          'record_falcon24_authority_staging_receipt',
          'stage_falcon24_authority_baseline',
          'begin_falcon24_authority_activation_attempt',
          'hold_falcon24_authority_activation_attempt',
          'activate_falcon24_authority','load_falcon24_current_authority_epoch',
          'load_falcon24_run_authority_binding','commit_falcon24_ui_receipt',
          'load_falcon24_ui_receipts'))<>10
  then raise exception using errcode='P0001',message='FALCON24_AUTHORITY_RPC_INVENTORY_DRIFT'; end if;
end
$authority_postconditions$;

select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010781_app_data_agent_falcon24_e2_authority',
  '__FALCON24_E2_AUTHORITY_MIGRATION_CHECKSUM__');
