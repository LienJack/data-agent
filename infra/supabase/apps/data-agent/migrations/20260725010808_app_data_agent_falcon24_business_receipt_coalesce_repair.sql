-- falcon24_business_receipt_coalesce_repair_migration_checksum: sha256:c030ddcee9cfff416c51d75a908da9c89018e912d3a215a0821a9e2ada01c061
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare definition text;source_definition text;owner_name text;security_definer boolean;
  broken_expression constant text := 'pg_catalog.coalesce(';
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010807_app_data_agent_falcon24_four_layer_conversation_grant'
        and migration_checksum=
          'sha256:0660c7eb6945b938caa30dbaba9c16be4b0456428c65ee948aacb5a4fecd9136')
    or pg_catalog.to_regprocedure(
      'app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)') is null
  then raise exception using errcode='P0001',
    message='FALCON24_BUSINESS_RECEIPT_COALESCE_BASELINE_DRIFT'; end if;

  select pg_catalog.pg_get_functiondef(procedure_row.oid),procedure_row.prosrc,
    owner_role.rolname,procedure_row.prosecdef
    into strict definition,source_definition,owner_name,security_definer
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_roles owner_role on owner_role.oid=procedure_row.proowner
    where procedure_row.oid=
      'app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)'::regprocedure;
  if pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(source_definition,'UTF8')),'hex')<>
      'c806d1a68ca84edf9c68b612f9af57e3ca5fa453dd16e8f32f9d5720854ef6c9'
    or owner_name<>'data_agent_u6_rpc_owner' or security_definer is distinct from true
    or (pg_catalog.length(definition)-pg_catalog.length(
      pg_catalog.replace(definition,broken_expression,'')))
      / pg_catalog.length(broken_expression)<>1
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',
    message='FALCON24_BUSINESS_RECEIPT_COALESCE_SOURCE_MISMATCH'; end if;
end
$preflight$;

create temporary table falcon24_10808_history_snapshot(
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
    insert into falcon24_10808_history_snapshot
      values(relation_name,before_count,before_digest);
  end loop;
end
$snapshot$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';

do $repair$
declare definition text;
  broken_expression constant text := 'pg_catalog.coalesce(';
  fixed_expression constant text := 'coalesce(';
begin
  select pg_catalog.pg_get_functiondef(procedure_row.oid)
    into strict definition from pg_catalog.pg_proc procedure_row
    where procedure_row.oid=
      'app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)'::regprocedure;
  definition:=pg_catalog.replace(definition,broken_expression,fixed_expression);
  execute definition;
end
$repair$;

do $postconditions$
declare definition text;source_definition text;owner_name text;security_definer boolean;
  before_row record;relation_name text;schema_name text;table_name text;
  after_count bigint;after_digest text;
  broken_expression constant text := 'pg_catalog.coalesce(';
begin
  select pg_catalog.pg_get_functiondef(procedure_row.oid),procedure_row.prosrc,
    owner_role.rolname,procedure_row.prosecdef
    into strict definition,source_definition,owner_name,security_definer
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_roles owner_role on owner_role.oid=procedure_row.proowner
    where procedure_row.oid=
      'app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)'::regprocedure;
  if pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(source_definition,'UTF8')),'hex')<>
      '360226662c5ef51cef4cd26d9d434c98ca9a0dadcafd6297caee5007bd0bda41'
    or owner_name<>'data_agent_u6_rpc_owner' or security_definer is distinct from true
    or pg_catalog.strpos(definition,broken_expression)>0
    or pg_catalog.strpos(definition,
      'coalesce(pg_catalog.jsonb_agg(result->''check_id'' order by ordinality),')=0
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',
    message='FALCON24_BUSINESS_RECEIPT_COALESCE_POSTCONDITION_FAILED'; end if;

  for before_row in select * from falcon24_10808_history_snapshot order by relation_name loop
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
      message='FALCON24_BUSINESS_RECEIPT_COALESCE_HISTORY_DRIFT'; end if;
  end loop;
end
$postconditions$;

select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010808_app_data_agent_falcon24_business_receipt_coalesce_repair',
  'sha256:c030ddcee9cfff416c51d75a908da9c89018e912d3a215a0821a9e2ada01c061');

commit;
