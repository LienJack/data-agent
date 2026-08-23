do $canonicalizer_exception_projection$
declare
  definition text;
  rewritten text;
  handler_anchor constant text := $$  if pg_catalog.strpos(failure_context,'semantic_context_uuid_v8_from_hash')>0 then$$;
  canonicalizer_handlers constant text := $$  if pg_catalog.strpos(failure_context,'u2_ecmascript_number')>0 then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_NUMBER_CANONICALIZATION_INVALID';
  elsif pg_catalog.strpos(failure_context,'u2_utf16_sort_key')>0 then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_KEY_CANONICALIZATION_INVALID';
  elsif pg_catalog.strpos(failure_context,'attribution_canonical_json')>0 then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_SCALAR_CANONICALIZATION_INVALID';
  elsif pg_catalog.strpos(failure_context,'u2_contract_canonical_json')>0 then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_DOCUMENT_CANONICALIZATION_INVALID';
  elsif pg_catalog.strpos(failure_context,'semantic_context_uuid_v8_from_hash')>0 then$$;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,handler_anchor)=0
    or pg_catalog.strpos(definition,'SEMANTIC_CONTEXT_NUMBER_CANONICALIZATION_INVALID')>0
  then raise exception using errcode='P0001',message='SEMANTIC_CANONICALIZER_EXCEPTION_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(definition,handler_anchor,canonicalizer_handlers);
  execute rewritten;
end
$canonicalizer_exception_projection$;
