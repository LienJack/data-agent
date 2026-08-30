-- falcon24_four_layer_lock_repair_migration_checksum: sha256:56888f989851a9d36cc5f224863884b101c4cf787f784e1579c537f9062775bf
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare signature text;definition text;owner_name text;security_definer boolean;
  broken_command constant text :=
    '''data-agent:falcon24-four-layer-attempt:''||command->>''attempt_id''';
  broken_receipt constant text :=
    '''data-agent:falcon24-four-layer-attempt:''||receipt->>''attempt_id''';
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010805_app_data_agent_falcon24_fence_token_secret_guard'
        and migration_checksum=
          'sha256:6c511eb4f8150e6bc2df2e16ce05e9c5facfa4344b20e1a3ef72f4155affa030')
    or pg_catalog.to_regclass('app_data_agent.qa_conversations') is null
    or exists(select 1 from pg_catalog.pg_policy
      where polrelid='app_data_agent.qa_conversations'::regclass
        and polname='falcon24_four_layer_gate_conversation_select')
  then raise exception using errcode='P0001',
    message='FALCON24_FOUR_LAYER_LOCK_REPAIR_BASELINE_DRIFT'; end if;

  foreach signature in array array[
    'app_data_agent.claim_falcon24_four_layer_gate_turn(jsonb)',
    'app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)',
    'app_data_agent.record_falcon24_four_layer_qa_ui_receipt(jsonb)',
    'app_data_agent.record_falcon24_four_layer_trace_ui_receipt(jsonb)',
    'app_data_agent.finalize_falcon24_four_layer_gate_turn(jsonb)',
    'app_data_agent.finalize_falcon24_four_layer_gate_attempt(jsonb)'
  ]::text[] loop
    if pg_catalog.to_regprocedure(signature) is null
    then raise exception using errcode='P0001',
      message='FALCON24_FOUR_LAYER_LOCK_REPAIR_BASELINE_DRIFT'; end if;
    select pg_catalog.pg_get_functiondef(procedure_row.oid),owner_role.rolname,
      procedure_row.prosecdef
      into strict definition,owner_name,security_definer
      from pg_catalog.pg_proc procedure_row
      join pg_catalog.pg_roles owner_role on owner_role.oid=procedure_row.proowner
      where procedure_row.oid=signature::regprocedure;
    if owner_name<>'data_agent_u6_rpc_owner' or security_definer is distinct from true
      or (pg_catalog.length(definition)-pg_catalog.length(
        pg_catalog.replace(definition,broken_command,'')))
          / pg_catalog.length(broken_command)
        + (pg_catalog.length(definition)-pg_catalog.length(
          pg_catalog.replace(definition,broken_receipt,'')))
          / pg_catalog.length(broken_receipt)<>1
      or pg_catalog.strpos(definition,
        '''data-agent:falcon24-four-layer-attempt:''||(command->>''attempt_id'')')>0
      or pg_catalog.strpos(definition,
        '''data-agent:falcon24-four-layer-attempt:''||(receipt->>''attempt_id'')')>0
      or pg_catalog.has_function_privilege('public',signature,'EXECUTE')
      or not pg_catalog.has_function_privilege('data_agent_backend',signature,'EXECUTE')
    then raise exception using errcode='P0001',
      message='FALCON24_FOUR_LAYER_LOCK_REPAIR_SOURCE_MISMATCH'; end if;
  end loop;
end
$preflight$;

create temporary table falcon24_10806_history_snapshot(
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
    insert into falcon24_10806_history_snapshot
      values(relation_name,before_count,before_digest);
  end loop;
end
$snapshot$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';

-- repaired lock keys: 'data-agent:falcon24-four-layer-attempt:'||(command->>'attempt_id')
-- and 'data-agent:falcon24-four-layer-attempt:'||(receipt->>'attempt_id')
do $repair$
declare signature text;definition text;broken text;corrected text;
  broken_command constant text :=
    '''data-agent:falcon24-four-layer-attempt:''||command->>''attempt_id''';
  fixed_command constant text :=
    '''data-agent:falcon24-four-layer-attempt:''||(command->>''attempt_id'')';
  broken_receipt constant text :=
    '''data-agent:falcon24-four-layer-attempt:''||receipt->>''attempt_id''';
  fixed_receipt constant text :=
    '''data-agent:falcon24-four-layer-attempt:''||(receipt->>''attempt_id'')';
begin
  foreach signature in array array[
    'app_data_agent.claim_falcon24_four_layer_gate_turn(jsonb)',
    'app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)',
    'app_data_agent.record_falcon24_four_layer_qa_ui_receipt(jsonb)',
    'app_data_agent.record_falcon24_four_layer_trace_ui_receipt(jsonb)',
    'app_data_agent.finalize_falcon24_four_layer_gate_turn(jsonb)',
    'app_data_agent.finalize_falcon24_four_layer_gate_attempt(jsonb)'
  ]::text[] loop
    select pg_catalog.pg_get_functiondef(procedure_row.oid)
      into strict definition from pg_catalog.pg_proc procedure_row
      where procedure_row.oid=signature::regprocedure;
    if pg_catalog.strpos(definition,broken_command)>0
    then broken:=broken_command;corrected:=fixed_command;
    elsif pg_catalog.strpos(definition,broken_receipt)>0
    then broken:=broken_receipt;corrected:=fixed_receipt;
    else raise exception using errcode='P0001',
      message='FALCON24_FOUR_LAYER_LOCK_REPAIR_SOURCE_MISMATCH'; end if;
    definition:=pg_catalog.replace(definition,broken,corrected);
    execute definition;
  end loop;
end
$repair$;

create policy falcon24_four_layer_gate_conversation_select
on app_data_agent.qa_conversations for select
to data_agent_u6_rpc_owner
using (platform.backend_exact_principal_object_matches(
  app_id,tenant_id,environment,owner_principal_id,true));

do $postconditions$
declare signature text;definition text;owner_name text;security_definer boolean;
  before_row record;relation_name text;schema_name text;table_name text;
  after_count bigint;after_digest text;policy_expression text;
  broken_command constant text :=
    '''data-agent:falcon24-four-layer-attempt:''||command->>''attempt_id''';
  fixed_command constant text :=
    '''data-agent:falcon24-four-layer-attempt:''||(command->>''attempt_id'')';
  broken_receipt constant text :=
    '''data-agent:falcon24-four-layer-attempt:''||receipt->>''attempt_id''';
  fixed_receipt constant text :=
    '''data-agent:falcon24-four-layer-attempt:''||(receipt->>''attempt_id'')';
begin
  foreach signature in array array[
    'app_data_agent.claim_falcon24_four_layer_gate_turn(jsonb)',
    'app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)',
    'app_data_agent.record_falcon24_four_layer_qa_ui_receipt(jsonb)',
    'app_data_agent.record_falcon24_four_layer_trace_ui_receipt(jsonb)',
    'app_data_agent.finalize_falcon24_four_layer_gate_turn(jsonb)',
    'app_data_agent.finalize_falcon24_four_layer_gate_attempt(jsonb)'
  ]::text[] loop
    select pg_catalog.pg_get_functiondef(procedure_row.oid),owner_role.rolname,
      procedure_row.prosecdef
      into strict definition,owner_name,security_definer
      from pg_catalog.pg_proc procedure_row
      join pg_catalog.pg_roles owner_role on owner_role.oid=procedure_row.proowner
      where procedure_row.oid=signature::regprocedure;
    if owner_name<>'data_agent_u6_rpc_owner' or security_definer is distinct from true
      or pg_catalog.strpos(definition,broken_command)>0
      or pg_catalog.strpos(definition,broken_receipt)>0
      or ((pg_catalog.length(definition)-pg_catalog.length(
          pg_catalog.replace(definition,fixed_command,'')))
          / pg_catalog.length(fixed_command)
        + (pg_catalog.length(definition)-pg_catalog.length(
          pg_catalog.replace(definition,fixed_receipt,'')))
          / pg_catalog.length(fixed_receipt))<>1
      or pg_catalog.has_function_privilege('public',signature,'EXECUTE')
      or not pg_catalog.has_function_privilege('data_agent_backend',signature,'EXECUTE')
    then raise exception using errcode='P0001',
      message='FALCON24_FOUR_LAYER_LOCK_REPAIR_POSTCONDITION_FAILED'; end if;
  end loop;

  select pg_catalog.pg_get_expr(policy_row.polqual,policy_row.polrelid)
    into strict policy_expression from pg_catalog.pg_policy policy_row
    where policy_row.polrelid='app_data_agent.qa_conversations'::regclass
      and policy_row.polname='falcon24_four_layer_gate_conversation_select'
      and policy_row.polcmd='r'
      and policy_row.polroles=array['data_agent_u6_rpc_owner'::regrole::oid];
  if policy_expression not like
    '%backend_exact_principal_object_matches(app_id, tenant_id, environment, owner_principal_id, true)%'
  then raise exception using errcode='P0001',
    message='FALCON24_FOUR_LAYER_LOCK_REPAIR_POSTCONDITION_FAILED'; end if;

  for before_row in select * from falcon24_10806_history_snapshot order by relation_name loop
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
      message='FALCON24_FOUR_LAYER_LOCK_REPAIR_HISTORY_DRIFT'; end if;
  end loop;
end
$postconditions$;

select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010806_app_data_agent_falcon24_four_layer_lock_repair',
  'sha256:56888f989851a9d36cc5f224863884b101c4cf787f784e1579c537f9062775bf');

commit;
