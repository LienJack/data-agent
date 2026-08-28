do $postconditions$
declare snapshot record; after_count bigint; after_digest text; rpc record; rpc_definition text;
begin
  for snapshot in select * from semantic_10796_successor_history_snapshot loop
    if snapshot.relation_name='semantic_successor_release_stage' then
      select pg_catalog.count(*)::bigint,
        app_data_agent.u2_canonical_sha256(
          coalesce(pg_catalog.jsonb_agg(to_jsonb(stage) order by
            stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,stage.stage_id),
            '[]'::jsonb))
        into strict after_count,after_digest
        from semantic.semantic_successor_release_stage as stage;
    elsif snapshot.relation_name='semantic_successor_stage_receipt' then
      select pg_catalog.count(*)::bigint,
        app_data_agent.u2_canonical_sha256(
          coalesce(pg_catalog.jsonb_agg(to_jsonb(receipt) order by
            receipt.app_id,receipt.tenant_id,receipt.environment,receipt.semantic_domain,
            receipt.stage_id,receipt.receipt_id),
            '[]'::jsonb))
        into strict after_count,after_digest
        from semantic.semantic_successor_stage_receipt as receipt;
    else
      raise exception using errcode='P0001',
        message='SEMANTIC_SUCCESSOR_SMOKE_REVALIDATION_POSTCONDITION_FAILED';
    end if;
    if snapshot.row_count is distinct from after_count
      or snapshot.row_digest is distinct from after_digest
    then raise exception using errcode='P0001',
      message='SEMANTIC_SUCCESSOR_SMOKE_REVALIDATION_POSTCONDITION_FAILED'; end if;
  end loop;

  select procedure.provolatile,procedure.prosecdef,procedure.proconfig,
    pg_catalog.pg_get_userbyid(procedure.proowner) as owner_name,
    pg_catalog.pg_get_functiondef(procedure.oid)
    into strict rpc
    from pg_catalog.pg_proc as procedure
    where procedure.oid='semantic.commit_semantic_successor_smoke(jsonb)'::regprocedure;
  rpc_definition:=rpc.pg_get_functiondef;

  if rpc.provolatile is distinct from 'v'
    or rpc.prosecdef is distinct from true
    or rpc.owner_name is distinct from 'data_agent_u6_rpc_owner'
    or not (rpc.proconfig @> array['search_path=""']::text[])
    or pg_catalog.strpos(
      rpc_definition,'stage.status not in(''STAGED'',''SMOKE_PASSED'')')=0
    or pg_catalog.strpos(
      rpc_definition,
      'stage.status=''SMOKE_PASSED'' and receipt->>''outcome''<>''PASS''')=0
    or pg_catalog.has_function_privilege(
      'public','semantic.commit_semantic_successor_smoke(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','semantic.commit_semantic_successor_smoke(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_SMOKE_REVALIDATION_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
