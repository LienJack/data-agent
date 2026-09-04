begin;
set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or session_user<>'postgres' or current_user<>'postgres'
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010819_app_data_agent_falcon24_four_layer_manifest_v4'
        and migration_checksum='sha256:e974bb8427d95e55845e997533ae19d8904fe8d78b321de702df7d7784aded34')
    or not exists(select 1 from pg_catalog.pg_proc
      where oid='app_data_agent.begin_falcon24_four_layer_gate(jsonb)'::regprocedure
        and pg_catalog.pg_get_userbyid(proowner)='data_agent_u6_rpc_owner' and prosecdef
        and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex')
          ='d8f11e94ff31b7dfbc8ae13b3c2273eb04785e1689f9b5efafcdeaf73c38cb3a')
    or pg_catalog.has_function_privilege(
      'public','app_data_agent.begin_falcon24_four_layer_gate(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.begin_falcon24_four_layer_gate(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',
    message='FALCON24_FOUR_LAYER_MANIFEST_V5_BASELINE_DRIFT'; end if;
end
$preflight$;

create temporary table falcon24_10820_history_snapshot(
  relation_name text primary key,row_count bigint not null,row_digest text not null
) on commit drop;
create temporary table falcon24_10820_function_acl_snapshot on commit drop as
select proacl from pg_catalog.pg_proc
where oid='app_data_agent.begin_falcon24_four_layer_gate(jsonb)'::regprocedure;

do $snapshot$
declare relation record;row_count bigint;row_digest text;
begin
  for relation in select n.nspname,c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname in('app_data_agent','semantic','catalog','platform')
      and c.relkind in('r','p') and not(n.nspname='platform' and c.relname='migration_ledger')
    order by n.nspname,c.relname loop
    execute pg_catalog.format('lock table %I.%I in share mode',relation.nspname,relation.relname);
    execute pg_catalog.format(
      'select count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb)) from %I.%I r',
      relation.nspname,relation.relname) into strict row_count,row_digest;
    insert into falcon24_10820_history_snapshot values(
      pg_catalog.format('%I.%I',relation.nspname,relation.relname),row_count,row_digest);
  end loop;
end
$snapshot$;
