do $postconditions$
declare snapshot record; schema_name text; table_name text;
  after_count bigint; after_digest text; rpc record; rpc_definition text;
begin
  for snapshot in select * from falcon24_10797_authority_history_snapshot loop
    schema_name:=pg_catalog.split_part(snapshot.relation_name,'.',1);
    table_name:=pg_catalog.split_part(snapshot.relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint, app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by '
      ||'to_jsonb(row_value)::text),''[]''::jsonb)) from %I.%I as row_value',
      schema_name,table_name)
      into strict after_count,after_digest;
    if snapshot.row_count is distinct from after_count
      or snapshot.row_digest is distinct from after_digest
    then raise exception using errcode='P0001',
      message='FALCON24_SUCCESSOR_ACTIVATION_CLOSURE_HISTORY_DRIFT'; end if;
  end loop;

  select procedure.provolatile,procedure.prosecdef,procedure.proconfig,
    pg_catalog.pg_get_userbyid(procedure.proowner) as owner_name,
    pg_catalog.pg_get_functiondef(procedure.oid)
    into strict rpc
    from pg_catalog.pg_proc as procedure
    where procedure.oid=
      'app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)'::regprocedure;
  rpc_definition:=rpc.pg_get_functiondef;

  if rpc.provolatile is distinct from 'v'
    or rpc.prosecdef is distinct from true
    or rpc.owner_name is distinct from 'data_agent_u6_rpc_owner'
    or not (rpc.proconfig @> array['search_path=""']::text[])
    or pg_catalog.strpos(
      rpc_definition,'row.source_digest=stage.source_snapshot_hash')<>0
    or pg_catalog.strpos(
      rpc_definition,'row.source_digest=stage.change_set_hash')=0
    or pg_catalog.strpos(
      rpc_definition,'row.revision_id=stage.candidate_revision_id')=0
    or pg_catalog.strpos(
      rpc_definition,'row.source_revision_id=stage.source_revision_id')=0
    or pg_catalog.strpos(
      rpc_definition,'row.revision_digest=stage.change_set_hash')=0
    or pg_catalog.strpos(
      rpc_definition,'row.current_revision_id=stage.candidate_revision_id')=0
    or pg_catalog.strpos(
      rpc_definition,'row.candidate_status=''PUBLISHING''')=0
    or pg_catalog.has_function_privilege(
      'public',
      'app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)',
      'EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend',
      'app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)',
      'EXECUTE')
  then raise exception using errcode='P0001',
    message='FALCON24_SUCCESSOR_ACTIVATION_CLOSURE_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
