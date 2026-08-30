begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);
set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';

do $preflight$
declare fence_hash text;rpc_hash text;fence_owner text;rpc_owner text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010811_app_data_agent_falcon24_root_agent_public_event'
        and migration_checksum='sha256:c893e16eacf96203ed00b830495e2ff5b1351e72f4db0c3336e963e031e4b9e0')
  then raise exception using errcode='P0001',message='FALCON24_PARTIAL_SUPERSESSION_BASELINE_DRIFT'; end if;
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex'),
    pg_catalog.pg_get_userbyid(proowner) into strict fence_hash,fence_owner
    from pg_catalog.pg_proc where oid='app_data_agent.falcon24_four_layer_attempt_state_fence()'::regprocedure;
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex'),
    pg_catalog.pg_get_userbyid(proowner) into strict rpc_hash,rpc_owner
    from pg_catalog.pg_proc where oid='app_data_agent.supersede_falcon24_four_layer_gate_attempt(jsonb)'::regprocedure;
  if fence_hash<>'2a05044717300082ee78b0c3f80e009fda7ab0d7d5948f7064721897116b7027'
    or rpc_hash<>'865442054236ea98ee4d0c2f1fe606a4860c402078c7307037b8ba954b6203d0'
    or fence_owner<>'data_agent_u6_data_owner' or rpc_owner<>'data_agent_u6_rpc_owner'
  then raise exception using errcode='P0001',message='FALCON24_PARTIAL_SUPERSESSION_SOURCE_MISMATCH'; end if;
end
$preflight$;

create temporary table falcon24_10812_history_snapshot(
  relation_name text primary key,row_count bigint not null,row_digest text not null
) on commit drop;
do $snapshot$
declare relation_name text;row_count bigint;row_digest text;
begin
  foreach relation_name in array array[
    'app_data_agent.falcon24_current_authority_epoch',
    'app_data_agent.falcon24_authority_baselines',
    'app_data_agent.falcon24_authority_activation_attempts',
    'app_data_agent.falcon24_qualifications',
    'app_data_agent.falcon24_qualification_slots',
    'app_data_agent.falcon24_acceptance_campaigns',
    'app_data_agent.falcon24_acceptance_campaign_runs',
    'app_data_agent.falcon24_four_layer_gate_attempts',
    'app_data_agent.falcon24_four_layer_gate_turns',
    'app_data_agent.runs','app_data_agent.run_events','app_data_agent.run_attempts',
    'app_data_agent.artifacts'
  ]::text[] loop
    execute pg_catalog.format(
      'select count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb)) from %I.%I r',
      pg_catalog.split_part(relation_name,'.',1),pg_catalog.split_part(relation_name,'.',2))
      into strict row_count,row_digest;
    insert into falcon24_10812_history_snapshot values(relation_name,row_count,row_digest);
  end loop;
end
$snapshot$;
