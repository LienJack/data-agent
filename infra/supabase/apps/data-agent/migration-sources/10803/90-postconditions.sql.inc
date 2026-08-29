do $postconditions$
declare relation_name text;schema_name text;table_name text;
  after_count bigint;after_digest text;before_row record;definition text;
begin
  if not exists(select 1 from pg_catalog.pg_class relation
      where relation.oid='app_data_agent.falcon24_four_layer_gate_attempts'::regclass
        and relation.relrowsecurity and relation.relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class relation
      where relation.oid='app_data_agent.falcon24_four_layer_gate_turns'::regclass
        and relation.relrowsecurity and relation.relforcerowsecurity)
    or (select pg_catalog.count(*) from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgname in('falcon24_four_layer_attempt_state_fence',
        'falcon24_four_layer_turn_state_fence') and not trigger_row.tgisinternal)<>2
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_four_layer_gate_attempts','SELECT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_four_layer_gate_turns','SELECT')
  then raise exception using errcode='P0001',
    message='FALCON24_FOUR_LAYER_GATE_POSTCONDITION_FAILED'; end if;
  foreach definition in array array[
    'app_data_agent.load_falcon24_four_layer_gate_attempt(jsonb)',
    'app_data_agent.load_falcon24_four_layer_gate_turn(jsonb)',
    'app_data_agent.begin_falcon24_four_layer_gate(jsonb)',
    'app_data_agent.claim_falcon24_four_layer_gate_turn(jsonb)',
    'app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)',
    'app_data_agent.record_falcon24_four_layer_qa_ui_receipt(jsonb)',
    'app_data_agent.record_falcon24_four_layer_trace_ui_receipt(jsonb)',
    'app_data_agent.finalize_falcon24_four_layer_gate_turn(jsonb)',
    'app_data_agent.finalize_falcon24_four_layer_gate_attempt(jsonb)']::text[] loop
    if pg_catalog.to_regprocedure(definition) is null
      or pg_catalog.has_function_privilege('public',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('anon',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated',definition,'EXECUTE')
      or pg_catalog.has_function_privilege('service_role',definition,'EXECUTE')
      or not pg_catalog.has_function_privilege('data_agent_backend',definition,'EXECUTE')
    then raise exception using errcode='P0001',
      message='FALCON24_FOUR_LAYER_GATE_POSTCONDITION_FAILED'; end if;
  end loop;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.begin_falcon24_four_layer_gate(jsonb)'::regprocedure)
    into strict definition;
  if pg_catalog.strpos(definition,
      'sha256:c01c7944368ebdd0ae9fb2e69c9b809cb0cb24a2de65076da934e95a23c396e9')=0
    or pg_catalog.strpos(definition,'array[5,2,2,6]::integer[]')=0
  then raise exception using errcode='P0001',
    message='FALCON24_FOUR_LAYER_GATE_POSTCONDITION_FAILED'; end if;
  for before_row in select * from falcon24_10803_history_snapshot order by relation_name loop
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
      message='FALCON24_FOUR_LAYER_HISTORY_DRIFT'; end if;
  end loop;
end
$postconditions$;
