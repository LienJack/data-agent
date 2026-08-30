-- agent_team_trace_run_read_migration_checksum: sha256:392a59f42b7340d30c610fffa2f9d7df94eaa0e7aa8a4a71ae0541fb0723966e
begin;
set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare source_row record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or session_user<>'postgres' or current_user<>'postgres'
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010812_app_data_agent_falcon24_partial_ready_supersession'
        and migration_checksum='sha256:28b74d01eeb3d56cddbee69cf98892ff524c3cefc3cdee8b199a8c3cb7ffcfb2')
  then raise exception using errcode='P0001',message='AGENT_TEAM_TRACE_RUN_READ_BASELINE_DRIFT'; end if;
  for source_row in select * from (values
    ('app_data_agent.load_agent_team_public_projection(uuid)',
      '0dc209982561f5bfdd5419a9a95139b8821cdb851c17d6e1a6e3dca19302f935'),
    ('app_data_agent.load_agent_team_public_projection_v2(uuid)',
      '7f808ce9084dbbbf83c5bb8e666e61f32c2c909415df6cfe4418472f520b9a2f')
  ) as expected(signature,source_hash) loop
    if not exists(select 1 from pg_catalog.pg_proc
      where oid=source_row.signature::regprocedure
        and pg_catalog.pg_get_userbyid(proowner)='data_agent_u19_team_owner'
        and prosecdef
        and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex')=source_row.source_hash)
    then raise exception using errcode='P0001',message='AGENT_TEAM_TRACE_RUN_READ_SOURCE_DRIFT'; end if;
  end loop;
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u19_team_owner'
      and not rolsuper and not rolcanlogin and not rolinherit and not rolbypassrls)
    or pg_catalog.pg_has_role('data_agent_u19_team_owner','data_agent_backend','MEMBER')
    or not pg_catalog.has_table_privilege('data_agent_u19_team_owner','app_data_agent.runs','SELECT')
    or pg_catalog.has_table_privilege('data_agent_u19_team_owner','app_data_agent.runs','INSERT,UPDATE,DELETE,TRUNCATE')
  then raise exception using errcode='P0001',message='AGENT_TEAM_TRACE_RUN_READ_OWNER_UNSAFE'; end if;
end
$preflight$;

-- Protect exact history bytes; this migration only adds a narrow read policy.
create temporary table team_trace_10813_history_snapshot(
  relation_name text primary key,row_count bigint not null,row_digest text not null
) on commit drop;
do $snapshot$
declare relation_name text;row_count bigint;row_digest text;
begin
  foreach relation_name in array array[
    'falcon24_current_authority_epoch','falcon24_authority_baselines',
    'falcon24_authority_activation_attempts','falcon24_qualifications',
    'falcon24_qualification_slots','falcon24_acceptance_campaigns',
    'falcon24_acceptance_campaign_runs','falcon24_four_layer_gate_attempts',
    'falcon24_four_layer_gate_turns','runs','run_events','run_attempts','artifacts',
    'agent_team_tasks','agent_team_handoffs','agent_team_completion_receipts',
    'agent_team_acceptance_receipts','agent_team_verifier_decisions','agent_team_context_epochs'
  ]::text[] loop
    execute pg_catalog.format('lock table app_data_agent.%I in share mode',relation_name);
    execute pg_catalog.format(
      'select count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb)) from app_data_agent.%I r',
      relation_name) into strict row_count,row_digest;
    insert into team_trace_10813_history_snapshot values(relation_name,row_count,row_digest);
  end loop;
end
$snapshot$;
-- No role membership, BYPASSRLS, write privilege, RPC replacement or new writer.
grant execute on function platform.backend_exact_principal_object_matches(uuid,uuid,text,uuid,boolean)
  to data_agent_u19_team_owner;

do $policy$
begin
  if not exists(select 1 from pg_catalog.pg_policy
    where polrelid='app_data_agent.runs'::regclass and polname='runs_team_trace_owner_select')
  then
    create policy runs_team_trace_owner_select on app_data_agent.runs for select
      to data_agent_u19_team_owner
      using(platform.backend_exact_principal_object_matches(
        app_id,tenant_id,environment,principal_id,false));
  end if;
end
$policy$;
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
  'sha256:392a59f42b7340d30c610fffa2f9d7df94eaa0e7aa8a4a71ae0541fb0723966e');
commit;
