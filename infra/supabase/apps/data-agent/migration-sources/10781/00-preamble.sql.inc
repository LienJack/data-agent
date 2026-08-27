begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare relation_name text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010780_app_data_agent_falcon24_e1_runtime_profile')
  then raise exception using errcode='P0001',
    message='FALCON24_E2_AUTHORITY_BASELINE_DRIFT'; end if;

  foreach relation_name in array array[
    'falcon24_e1_staging_sessions','falcon24_e1_staging_receipts',
    'falcon24_authority_baselines','falcon24_e1_activation_attempts',
    'falcon24_current_authority_epoch','falcon24_e1_ui_receipts',
    'falcon24_e1_gate_attempt_history','falcon24_qualifications',
    'falcon24_qualification_slots','falcon24_acceptance_campaigns',
    'falcon24_acceptance_campaign_runs','e1_analysis_publications',
    'e1_analysis_publication_artifacts','e1_analysis_publication_current',
    'e1_analysis_publication_outbox','runs','effective_run_config_receipts','artifacts'
  ]::text[] loop
    if pg_catalog.to_regclass('app_data_agent.'||relation_name) is null
    then raise exception using errcode='P0001',
      message='FALCON24_E2_AUTHORITY_INVENTORY_DRIFT'; end if;
  end loop;

  foreach relation_name in array array[
    'falcon24_authority_staging_sessions','falcon24_authority_staging_receipts',
    'falcon24_authority_activation_attempts','falcon24_ui_receipts',
    'falcon24_gate_attempt_history','falcon24_analysis_publications',
    'falcon24_analysis_publication_artifacts','falcon24_analysis_publication_current',
    'falcon24_analysis_publication_outbox'
  ]::text[] loop
    if pg_catalog.to_regclass('app_data_agent.'||relation_name) is not null
    then raise exception using errcode='P0001',
      message='FALCON24_E2_SECOND_AUTHORITY_TRUTH_DETECTED'; end if;
  end loop;

  if exists(select 1 from app_data_agent.falcon24_authority_baselines
      where authority_epoch<>'E1')
    or exists(select 1 from app_data_agent.falcon24_current_authority_epoch
      where authority_epoch<>'E1')
    or exists(select 1 from app_data_agent.runs where authority_epoch<>'E1')
  then raise exception using errcode='P0001',
    message='FALCON24_E2_PREDECESSOR_IDENTITY_DRIFT'; end if;
end
$preflight$;

create temporary table falcon24_e1_relation_snapshot(
  relation_name text primary key,
  relation_oid oid not null,
  excluded_columns text[] not null,
  row_count bigint not null,
  row_digest text not null
) on commit drop;

do $snapshot$
declare item record; observed_count bigint; observed_digest text; relation_id regclass;
begin
  for item in select * from (values
    ('falcon24_e1_staging_sessions',array['authority_epoch']::text[]),
    ('falcon24_e1_staging_receipts',array['authority_epoch']::text[]),
    ('falcon24_authority_baselines',array[]::text[]),
    ('falcon24_e1_activation_attempts',array['authority_epoch']::text[]),
    ('falcon24_current_authority_epoch',array[]::text[]),
    ('falcon24_e1_ui_receipts',array[]::text[]),
    ('falcon24_e1_gate_attempt_history',array[]::text[]),
    ('falcon24_qualifications',array[]::text[]),
    ('falcon24_qualification_slots',array['authority_epoch']::text[]),
    ('falcon24_acceptance_campaigns',array[]::text[]),
    ('falcon24_acceptance_campaign_runs',array['authority_epoch']::text[]),
    ('e1_analysis_publications',array[]::text[]),
    ('e1_analysis_publication_artifacts',array[]::text[]),
    ('e1_analysis_publication_current',array[]::text[]),
    ('e1_analysis_publication_outbox',array[]::text[]),
    ('runs',array[]::text[]),
    ('effective_run_config_receipts',array[]::text[]),
    ('artifacts',array[]::text[])
  ) snapshot(relation_name,excluded_columns) loop
    relation_id:=pg_catalog.to_regclass('app_data_agent.'||item.relation_name);
    execute pg_catalog.format(
      'select pg_catalog.count(*),app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(source)-$1 order by '
      ||'(to_jsonb(source)-$1)::text),''[]''::jsonb)) from %s source',relation_id)
      into strict observed_count,observed_digest using item.excluded_columns;
    insert into falcon24_e1_relation_snapshot(
      relation_name,relation_oid,excluded_columns,row_count,row_digest)
    values(item.relation_name,relation_id::oid,item.excluded_columns,
      observed_count,observed_digest);
  end loop;
end
$snapshot$;
