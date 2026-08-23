do $persistence_input_validation$
declare
  definition text;
  rewritten text;
  authority_statement constant text :=
    $$  select * into authority from platform.current_backend_authority(true);$$;
  guarded_authority_statement constant text := $$  if not pg_catalog.pg_input_is_valid(requested#>>'{receipt,receipt_id}','uuid') then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_RECEIPT_ID_INVALID';
  end if;
  if not pg_catalog.pg_input_is_valid(requested#>>'{request,request_id}','uuid') then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_REQUEST_ID_INVALID';
  end if;
  if requested#>>'{request,basis,consumer}'='RUN'
    and not pg_catalog.pg_input_is_valid(requested#>>'{request,basis,run_id}','uuid')
  then raise exception using errcode='22023',message='SEMANTIC_CONTEXT_RUN_ID_INVALID'; end if;
  if not pg_catalog.pg_input_is_valid(requested#>>'{package,package_id}','uuid') then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_PACKAGE_ID_INVALID';
  end if;
  if not pg_catalog.pg_input_is_valid(requested#>>'{receipt,resolved_at}','timestamptz') then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_RESOLVED_AT_INVALID';
  end if;
  select * into authority from platform.current_backend_authority(true);$$;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,authority_statement)=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_RECEIPT_ID_INVALID')>0
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_PERSISTENCE_INPUT_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(definition,authority_statement,guarded_authority_statement);
  execute rewritten;
end
$persistence_input_validation$;
