do $safe_exception_projection$
declare
  definition text;
  rewritten text;
  declaration_anchor constant text := $$  committed_at timestamptz;$$;
  projected_declaration constant text := $$  committed_at timestamptz;
  failure_context text;$$;
  generic_handler constant text := $$exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SEMANTIC_CONTEXT_COMMIT_INVALID';$$;
  projected_handler constant text := $$exception when invalid_text_representation or numeric_value_out_of_range then
  get stacked diagnostics failure_context=pg_exception_context;
  if pg_catalog.strpos(failure_context,'semantic_context_uuid_v8_from_hash')>0 then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_PACKAGE_ID_DERIVATION_INVALID';
  elsif pg_catalog.strpos(failure_context,'load_semantic_context_authority_snapshot')>0 then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_AUTHORITY_REFRESH_INVALID';
  elsif pg_catalog.strpos(failure_context,'select receipt.* into existing')>0 then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_IDEMPOTENCY_LOOKUP_INVALID';
  elsif pg_catalog.strpos(failure_context,'insert into app_data_agent.semantic_context_receipts')>0 then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_PERSISTENCE_ROW_INVALID';
  elsif sqlstate='22003' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_NUMERIC_RANGE_INVALID';
  else
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_TEXT_REPRESENTATION_INVALID';
  end if;$$;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,declaration_anchor)=0
    or pg_catalog.strpos(definition,generic_handler)=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_PERSISTENCE_ROW_INVALID')>0
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_SAFE_EXCEPTION_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(definition,declaration_anchor,projected_declaration);
  rewritten:=pg_catalog.replace(rewritten,generic_handler,projected_handler);
  execute rewritten;
end
$safe_exception_projection$;
