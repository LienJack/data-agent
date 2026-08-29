do $postconditions$
declare before_row record;relation_name text;schema_name text;table_name text;
  after_count bigint;after_digest text;definition text;source_definition text;owner_name text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)'::regprocedure),
    procedure_row.prosrc,owner_role.rolname
    into strict definition,source_definition,owner_name
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_roles owner_role on owner_role.oid=procedure_row.proowner
    where procedure_row.oid=
      'app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)'::regprocedure;
  if pg_catalog.encode(pg_catalog.sha256(
      pg_catalog.convert_to(source_definition,'UTF8')),'hex')<>
      'f39c7dfd4002d455003646f16ea9066f34593154b2236220d7bb7789bec664c0'
    or pg_catalog.strpos(definition,
      'if receipt->>''status''=''PASS'' and not app_data_agent.falcon24_four_layer_agent_contract_matches(')=0
    or owner_name<>'data_agent_u6_rpc_owner'
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.record_falcon24_four_layer_business_receipt(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',
    message='FALCON24_FAILURE_RECEIPT_POSTCONDITION_FAILED'; end if;
  for before_row in select * from falcon24_10804_history_snapshot order by relation_name loop
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
      message='FALCON24_FAILURE_RECEIPT_HISTORY_DRIFT'; end if;
  end loop;
end
$postconditions$;
