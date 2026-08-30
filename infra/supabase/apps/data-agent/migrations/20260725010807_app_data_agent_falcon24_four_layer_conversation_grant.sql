-- falcon24_four_layer_conversation_grant_migration_checksum: sha256:0660c7eb6945b938caa30dbaba9c16be4b0456428c65ee948aacb5a4fecd9136
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare owner_name text;security_definer boolean;policy_expression text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010806_app_data_agent_falcon24_four_layer_lock_repair'
        and migration_checksum=
          'sha256:56888f989851a9d36cc5f224863884b101c4cf787f784e1579c537f9062775bf')
    or pg_catalog.to_regprocedure(
      'platform.backend_exact_principal_object_matches(uuid,uuid,text,uuid,boolean)') is null
  then raise exception using errcode='P0001',
    message='FALCON24_FOUR_LAYER_CONVERSATION_GRANT_BASELINE_DRIFT'; end if;

  select owner_role.rolname,procedure_row.prosecdef
    into strict owner_name,security_definer
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_roles owner_role on owner_role.oid=procedure_row.proowner
    where procedure_row.oid=
      'platform.backend_exact_principal_object_matches(uuid,uuid,text,uuid,boolean)'::regprocedure;
  select pg_catalog.pg_get_expr(policy_row.polqual,policy_row.polrelid)
    into strict policy_expression from pg_catalog.pg_policy policy_row
    where policy_row.polrelid='app_data_agent.qa_conversations'::regclass
      and policy_row.polname='falcon24_four_layer_gate_conversation_select'
      and policy_row.polcmd='r'
      and policy_row.polroles=array['data_agent_u6_rpc_owner'::regrole::oid];
  if owner_name<>'postgres' or security_definer is distinct from true
    or policy_expression not like
      '%backend_exact_principal_object_matches(app_id, tenant_id, environment, owner_principal_id, true)%'
    or pg_catalog.has_function_privilege('public',
      'platform.backend_exact_principal_object_matches(uuid,uuid,text,uuid,boolean)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'platform.backend_exact_principal_object_matches(uuid,uuid,text,uuid,boolean)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_qa_directory_owner',
      'platform.backend_exact_principal_object_matches(uuid,uuid,text,uuid,boolean)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_u6_rpc_owner',
      'platform.backend_exact_principal_object_matches(uuid,uuid,text,uuid,boolean)','EXECUTE')
  then raise exception using errcode='P0001',
    message='FALCON24_FOUR_LAYER_CONVERSATION_GRANT_BASELINE_DRIFT'; end if;
end
$preflight$;

create temporary table falcon24_10807_history_snapshot(
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
    'app_data_agent.qa_conversations',
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
    insert into falcon24_10807_history_snapshot
      values(relation_name,before_count,before_digest);
  end loop;
end
$snapshot$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';

grant execute on function platform.backend_exact_principal_object_matches(uuid,uuid,text,uuid,boolean) to data_agent_u6_rpc_owner;

do $postconditions$
declare before_row record;relation_name text;schema_name text;table_name text;
  after_count bigint;after_digest text;owner_name text;security_definer boolean;
begin
  select owner_role.rolname,procedure_row.prosecdef
    into strict owner_name,security_definer
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_roles owner_role on owner_role.oid=procedure_row.proowner
    where procedure_row.oid=
      'platform.backend_exact_principal_object_matches(uuid,uuid,text,uuid,boolean)'::regprocedure;
  if owner_name<>'postgres' or security_definer is distinct from true
    or pg_catalog.has_function_privilege('public',
      'platform.backend_exact_principal_object_matches(uuid,uuid,text,uuid,boolean)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'platform.backend_exact_principal_object_matches(uuid,uuid,text,uuid,boolean)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_qa_directory_owner',
      'platform.backend_exact_principal_object_matches(uuid,uuid,text,uuid,boolean)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_u6_rpc_owner',
      'platform.backend_exact_principal_object_matches(uuid,uuid,text,uuid,boolean)','EXECUTE')
  then raise exception using errcode='P0001',
    message='FALCON24_FOUR_LAYER_CONVERSATION_GRANT_POSTCONDITION_FAILED'; end if;

  for before_row in select * from falcon24_10807_history_snapshot order by relation_name loop
    relation_name:=before_row.relation_name;
    schema_name:=pg_catalog.split_part(relation_name,'.',1);
    table_name:=pg_catalog.split_part(relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by to_jsonb(row_value)::text),'
      ||'''[]''::jsonb)) from %I.%I as row_value',schema_name,table_name)
      into strict after_count,after_digest;
    if after_count<>before_row.row_count or after_digest<>before_row.row_digest
    then raise exception using errcode='P0001',
      message='FALCON24_FOUR_LAYER_CONVERSATION_GRANT_HISTORY_DRIFT'; end if;
  end loop;
end
$postconditions$;

select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010807_app_data_agent_falcon24_four_layer_conversation_grant',
  'sha256:0660c7eb6945b938caa30dbaba9c16be4b0456428c65ee948aacb5a4fecd9136');

commit;
