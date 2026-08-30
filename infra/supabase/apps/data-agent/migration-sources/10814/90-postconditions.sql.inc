do $postconditions$
declare before_row record;after_count bigint;after_digest text;role_name text;
begin
  for before_row in select * from falcon24_10814_history_snapshot order by relation_name loop
    execute pg_catalog.format(
      'select count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb)) from %s r',
      before_row.relation_name) into strict after_count,after_digest;
    if after_count is distinct from before_row.row_count or after_digest is distinct from before_row.row_digest
    then raise exception using errcode='P0001',message='FALCON24_FOUR_LAYER_RECOVERY_HISTORY_DRIFT'; end if;
  end loop;
  if exists(select 1 from app_data_agent.falcon24_retained_recovery_activation_receipts)
    or not exists(select 1 from pg_catalog.pg_class where
      oid='app_data_agent.falcon24_retained_recovery_activation_receipts'::regclass
      and relrowsecurity and relforcerowsecurity and pg_catalog.pg_get_userbyid(relowner)='data_agent_u6_data_owner')
    or not exists(select 1 from pg_catalog.pg_trigger where
      tgrelid='app_data_agent.falcon24_retained_recovery_activation_receipts'::regclass
      and tgname='falcon24_retained_recovery_receipt_immutable' and not tgisinternal and tgenabled='O')
    or not pg_catalog.has_table_privilege('data_agent_u6_rpc_owner',
      'app_data_agent.falcon24_retained_recovery_activation_receipts','SELECT')
    or not pg_catalog.has_table_privilege('data_agent_u6_rpc_owner',
      'app_data_agent.falcon24_retained_recovery_activation_receipts','INSERT')
    or pg_catalog.has_table_privilege('data_agent_u6_rpc_owner',
      'app_data_agent.falcon24_retained_recovery_activation_receipts','UPDATE,DELETE,TRUNCATE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.activate_falcon24_authority(jsonb)','EXECUTE')
    or not exists(select 1 from pg_catalog.pg_proc where
      oid='app_data_agent.activate_falcon24_authority(jsonb)'::regprocedure
      and prosecdef and pg_catalog.pg_get_userbyid(proowner)='data_agent_u6_rpc_owner'
      and proconfig=array['search_path=""']::text[])
    or not exists(select 1 from pg_catalog.pg_proc where
      oid='app_data_agent.activate_falcon24_authority_pre_e12(jsonb)'::regprocedure
      and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex')
        ='b2531eea1d27e13ae279bd9842316775eaa5cd00ac630382c30605fde4e62282')
  then raise exception using errcode='P0001',message='FALCON24_FOUR_LAYER_RECOVERY_SECURITY_DRIFT'; end if;
  foreach role_name in array array['public','anon','authenticated','service_role','data_agent_backend','data_agent_job_authority']::text[] loop
    if pg_catalog.has_table_privilege(role_name,'app_data_agent.falcon24_retained_recovery_activation_receipts','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      or pg_catalog.has_function_privilege(role_name,'app_data_agent.activate_falcon24_authority_pre_e12(jsonb)','EXECUTE')
      or pg_catalog.has_function_privilege(role_name,'app_data_agent.activate_falcon24_authority_pre_e10(jsonb)','EXECUTE')
      or (role_name<>'data_agent_backend' and pg_catalog.has_function_privilege(role_name,
        'app_data_agent.activate_falcon24_authority(jsonb)','EXECUTE'))
    then raise exception using errcode='P0001',message='FALCON24_FOUR_LAYER_RECOVERY_SECURITY_DRIFT'; end if;
  end loop;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010814_app_data_agent_falcon24_four_layer_recovery',
  '__FALCON24_FOUR_LAYER_RECOVERY_MIGRATION_CHECKSUM__');
commit;
