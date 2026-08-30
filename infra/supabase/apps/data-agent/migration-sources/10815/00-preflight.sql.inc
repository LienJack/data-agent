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
        and migration_version='20260725010814_app_data_agent_falcon24_four_layer_recovery'
        and migration_checksum='sha256:eb85edc9df631ab973357bfa242ed556e81aad63613503dd6cf9640823fdf520')
    or exists(select 1 from pg_catalog.pg_policy where polrelid='app_data_agent.artifacts'::regclass
      and polname='falcon24_recovery_active_certification_lock')
  then raise exception using errcode='P0001',message='FALCON24_RECOVERY_CERTIFICATION_LOCK_BASELINE_DRIFT'; end if;
  if not exists(select 1 from pg_catalog.pg_proc
      where oid='app_data_agent.activate_falcon24_authority(jsonb)'::regprocedure
        and pg_catalog.pg_get_userbyid(proowner)='data_agent_u6_rpc_owner' and prosecdef
        and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex')
          ='ade70237e02f49478714ea3e5a2abb78efabcd1185ee936affd80502aa941384')
    or not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u6_rpc_owner'
      and not rolsuper and not rolcanlogin and not rolinherit and not rolbypassrls)
    or pg_catalog.pg_has_role('data_agent_u6_rpc_owner','data_agent_backend','MEMBER')
    or not pg_catalog.has_column_privilege('data_agent_u6_rpc_owner','app_data_agent.artifacts','is_active','UPDATE')
    or not exists(select 1 from pg_catalog.pg_proc
      where oid='app_data_agent.reject_artifact_payload_mutation()'::regprocedure
        and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex')
          ='faf781b516cfd42bf74bca16b107b0d84e139599e31dc7d38e7f020627fb2487')
  then raise exception using errcode='P0001',message='FALCON24_RECOVERY_CERTIFICATION_LOCK_SOURCE_DRIFT'; end if;
end
$preflight$;

create temporary table falcon24_10815_history_snapshot(
  relation_name text primary key,row_count bigint not null,row_digest text not null
) on commit drop;
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
    insert into falcon24_10815_history_snapshot values(
      pg_catalog.format('%I.%I',relation.nspname,relation.relname),row_count,row_digest);
  end loop;
end
$snapshot$;
create temporary table falcon24_10815_security_snapshot on commit drop as
select app_data_agent.u2_canonical_sha256(jsonb_build_object(
  'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p),
  'artifact_acl',(select to_jsonb(relacl) from pg_class where oid='app_data_agent.artifacts'::regclass),
  'artifact_guard',pg_get_functiondef('app_data_agent.reject_artifact_payload_mutation()'::regprocedure),
  'activation',pg_get_functiondef('app_data_agent.activate_falcon24_authority(jsonb)'::regprocedure)
)) as digest;
