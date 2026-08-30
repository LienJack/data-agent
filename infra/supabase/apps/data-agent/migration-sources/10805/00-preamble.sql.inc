begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare source_definition text;owner_name text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010804_app_data_agent_falcon24_failure_receipt_closure'
        and migration_checksum=
          'sha256:2c60adcf3bc2035d359580105316241d5c87b766a0419ffb820d6073c3cbcfa0')
    or pg_catalog.to_regprocedure(
      'app_data_agent.contains_potential_plaintext_secret(jsonb,text)') is null
  then raise exception using errcode='P0001',
    message='FALCON24_FENCE_TOKEN_SECRET_GUARD_BASELINE_DRIFT'; end if;
  select procedure_row.prosrc,owner_role.rolname
    into strict source_definition,owner_name
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_roles owner_role on owner_role.oid=procedure_row.proowner
    where procedure_row.oid=
      'app_data_agent.contains_potential_plaintext_secret(jsonb,text)'::regprocedure;
  if pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(source_definition,'UTF8')),'hex')<>
      'ffeca6ae3e0368009e14a2fef3e197102b251800a8f4bebda8d0dbdc1f41b6cf'
    or owner_name<>'postgres'
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.contains_potential_plaintext_secret(jsonb,text)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.contains_potential_plaintext_secret(jsonb,text)','EXECUTE')
  then raise exception using errcode='P0001',
    message='FALCON24_FENCE_TOKEN_SECRET_GUARD_BASELINE_DRIFT'; end if;
end
$preflight$;

create temporary table falcon24_10805_history_snapshot(
  relation_name text primary key,row_count bigint not null,row_digest text not null
) on commit drop;

do $snapshot$
declare relation_name text;schema_name text;table_name text;
  before_count bigint;before_digest text;
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
    schema_name:=pg_catalog.split_part(relation_name,'.',1);
    table_name:=pg_catalog.split_part(relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by to_jsonb(row_value)::text),'
      ||'''[]''::jsonb)) from %I.%I as row_value',schema_name,table_name)
      into strict before_count,before_digest;
    insert into falcon24_10805_history_snapshot
      values(relation_name,before_count,before_digest);
  end loop;
end
$snapshot$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
