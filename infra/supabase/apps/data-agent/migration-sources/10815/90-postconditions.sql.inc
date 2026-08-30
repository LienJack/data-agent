do $postconditions$
declare before_row record;after_count bigint;after_digest text;security_digest text;
begin
  for before_row in select * from falcon24_10815_history_snapshot order by relation_name loop
    execute pg_catalog.format(
      'select count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb)) from %s r',
      before_row.relation_name) into strict after_count,after_digest;
    if after_count is distinct from before_row.row_count or after_digest is distinct from before_row.row_digest
    then raise exception using errcode='P0001',message='FALCON24_RECOVERY_CERTIFICATION_LOCK_HISTORY_DRIFT'; end if;
  end loop;
  select app_data_agent.u2_canonical_sha256(jsonb_build_object(
    'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p
      where not(schemaname='app_data_agent' and tablename='artifacts' and policyname='falcon24_recovery_active_certification_lock')),
    'artifact_acl',(select to_jsonb(relacl) from pg_class where oid='app_data_agent.artifacts'::regclass),
    'artifact_guard',pg_get_functiondef('app_data_agent.reject_artifact_payload_mutation()'::regprocedure),
    'activation',pg_get_functiondef('app_data_agent.activate_falcon24_authority(jsonb)'::regprocedure)
  )) into strict security_digest;
  if security_digest is distinct from (select digest from falcon24_10815_security_snapshot)
    or not exists(select 1 from pg_policy where polrelid='app_data_agent.artifacts'::regclass
      and polname='falcon24_recovery_active_certification_lock' and polcmd='w' and polpermissive
      and polroles=array['data_agent_u6_rpc_owner'::regrole::oid]
      and pg_get_expr(polwithcheck,polrelid)='false')
  then raise exception using errcode='P0001',message='FALCON24_RECOVERY_CERTIFICATION_LOCK_SECURITY_DRIFT'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010815_app_data_agent_falcon24_recovery_certification_lock',
  '__FALCON24_RECOVERY_CERTIFICATION_LOCK_MIGRATION_CHECKSUM__');
commit;
