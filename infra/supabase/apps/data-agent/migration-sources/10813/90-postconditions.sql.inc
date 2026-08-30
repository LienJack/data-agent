do $postconditions$
declare before_row record;after_count bigint;after_digest text;
begin
  for before_row in select * from team_trace_10813_history_snapshot loop
    execute pg_catalog.format(
      'select count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb)) from app_data_agent.%I r',
      before_row.relation_name) into strict after_count,after_digest;
    if after_count<>before_row.row_count or after_digest<>before_row.row_digest
    then raise exception using errcode='P0001',message='AGENT_TEAM_TRACE_RUN_READ_HISTORY_DRIFT'; end if;
  end loop;
  if not exists(select 1 from pg_catalog.pg_policy
    where polrelid='app_data_agent.runs'::regclass and polname='runs_team_trace_owner_select'
      and polcmd='r' and polpermissive
      and polroles=array['data_agent_u19_team_owner'::regrole::oid]
      and polwithcheck is null
      and pg_catalog.pg_get_expr(polqual,polrelid)=
        'platform.backend_exact_principal_object_matches(app_id, tenant_id, environment, principal_id, false)')
    or not pg_catalog.has_function_privilege('data_agent_u19_team_owner',
      'platform.backend_exact_principal_object_matches(uuid,uuid,text,uuid,boolean)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.load_agent_team_public_projection_v2(uuid)','EXECUTE')
    or pg_catalog.pg_has_role('data_agent_u19_team_owner','data_agent_backend','MEMBER')
    or pg_catalog.has_table_privilege('data_agent_u19_team_owner','app_data_agent.runs','INSERT,UPDATE,DELETE,TRUNCATE')
  then raise exception using errcode='P0001',message='AGENT_TEAM_TRACE_RUN_READ_POSTCONDITION_FAILED'; end if;
end
$postconditions$;

select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010813_app_data_agent_agent_team_trace_run_read',
  '__AGENT_TEAM_TRACE_RUN_READ_MIGRATION_CHECKSUM__');
commit;
