-- falcon24_four_layer_manifest_v5_migration_checksum: sha256:067c0a93ef9d4dd18dee22ac37b1acac05e089abf1042add48ede7d57bd0f515
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
do $rewrite$
declare definition text;needle text;replacement text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.begin_falcon24_four_layer_gate(jsonb)'::regprocedure)
    into strict definition;
  needle:=$needle$
      or (manifest->>'schema_version'='falcon24-four-layer-gate-manifest@4.0.0'
        and turns_hash='sha256:1b197368096673c1015935308f2db4a4fcddb0f3cc04c73b627cd7ce4d97503f'))$needle$;
  replacement:=$replacement$
      or (manifest->>'schema_version'='falcon24-four-layer-gate-manifest@4.0.0'
        and turns_hash='sha256:1b197368096673c1015935308f2db4a4fcddb0f3cc04c73b627cd7ce4d97503f')
      or (manifest->>'schema_version'='falcon24-four-layer-gate-manifest@5.0.0'
        and turns_hash='sha256:040e238b038f8ec2d246f553ac26a1d7abc6067f152e4106f7aca93859c6d55c'))$replacement$;
  if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(definition,needle,'')))
        / pg_catalog.length(needle)<>1
    or pg_catalog.strpos(definition,'falcon24-four-layer-gate-manifest@5.0.0')<>0
  then raise exception using errcode='P0001',
    message='FALCON24_FOUR_LAYER_MANIFEST_V5_REWRITE_DRIFT'; end if;
  definition:=pg_catalog.replace(definition,needle,replacement);
  execute definition;
end
$rewrite$;

alter function app_data_agent.begin_falcon24_four_layer_gate(jsonb)
  owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.begin_falcon24_four_layer_gate(jsonb) from public;
grant execute on function app_data_agent.begin_falcon24_four_layer_gate(jsonb)
  to data_agent_backend;
do $postconditions$
declare before_row record;after_count bigint;after_digest text;definition text;
begin
  for before_row in select * from falcon24_10820_history_snapshot order by relation_name loop
    execute pg_catalog.format(
      'select count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb)) from %s r',
      before_row.relation_name) into strict after_count,after_digest;
    if after_count is distinct from before_row.row_count or after_digest is distinct from before_row.row_digest
    then raise exception using errcode='P0001',
      message='FALCON24_FOUR_LAYER_MANIFEST_V5_HISTORY_DRIFT'; end if;
  end loop;

  select pg_catalog.pg_get_functiondef(
    'app_data_agent.begin_falcon24_four_layer_gate(jsonb)'::regprocedure)
    into strict definition;
  if pg_catalog.strpos(definition,'falcon24-four-layer-gate-manifest@1.0.0')=0
    or pg_catalog.strpos(definition,'falcon24-four-layer-gate-manifest@2.0.0')=0
    or pg_catalog.strpos(definition,'falcon24-four-layer-gate-manifest@3.0.0')=0
    or pg_catalog.strpos(definition,'falcon24-four-layer-gate-manifest@4.0.0')=0
    or pg_catalog.strpos(definition,'falcon24-four-layer-gate-manifest@5.0.0')=0
    or pg_catalog.strpos(definition,'sha256:c01c7944368ebdd0ae9fb2e69c9b809cb0cb24a2de65076da934e95a23c396e9')=0
    or pg_catalog.strpos(definition,'sha256:4ecf4742d2f8a201b3abe9609177441a0672a629becb4f58a23c18b7c7251142')=0
    or pg_catalog.strpos(definition,'sha256:bc9fdac88acf23889beabeb2ae2c6f49d3df93d72c02d87ab1fde023e434564a')=0
    or pg_catalog.strpos(definition,'sha256:1b197368096673c1015935308f2db4a4fcddb0f3cc04c73b627cd7ce4d97503f')=0
    or pg_catalog.strpos(definition,'sha256:040e238b038f8ec2d246f553ac26a1d7abc6067f152e4106f7aca93859c6d55c')=0
    or not exists(select 1 from pg_catalog.pg_proc
      where oid='app_data_agent.begin_falcon24_four_layer_gate(jsonb)'::regprocedure
        and pg_catalog.pg_get_userbyid(proowner)='data_agent_u6_rpc_owner' and prosecdef
        and proacl is not distinct from (select proacl from falcon24_10820_function_acl_snapshot))
    or pg_catalog.has_function_privilege(
      'public','app_data_agent.begin_falcon24_four_layer_gate(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.begin_falcon24_four_layer_gate(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',
    message='FALCON24_FOUR_LAYER_MANIFEST_V5_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010820_app_data_agent_falcon24_four_layer_manifest_v5',
  'sha256:067c0a93ef9d4dd18dee22ac37b1acac05e089abf1042add48ede7d57bd0f515');
commit;
