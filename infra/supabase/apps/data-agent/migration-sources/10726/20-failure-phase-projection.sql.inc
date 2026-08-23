do $failure_phase_projection$
declare
  definition text;
  rewritten text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_semantic_context_package(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,$$  failure_context text;$$)=0
    or pg_catalog.strpos(definition,$$  select * into authority from platform.current_backend_authority(true);$$)=0
    or pg_catalog.strpos(definition,$$  authoritative_snapshot:=app_data_agent.load_semantic_context_authority_snapshot(requested->'request');$$)=0
    or pg_catalog.strpos(definition,$$  expected_package_key_hash:=app_data_agent.semantic_context_package_key_hash(requested->'package');$$)=0
    or pg_catalog.strpos(definition,$$  select receipt.* into existing from app_data_agent.semantic_context_receipts receipt$$)=0
    or pg_catalog.strpos(definition,$$  insert into app_data_agent.semantic_context_receipts($$)=0
    or pg_catalog.strpos(definition,'failure_phase text')>0
  then raise exception using errcode='P0001',message='SEMANTIC_CONTEXT_FAILURE_PHASE_SOURCE_MISMATCH'; end if;

  rewritten:=pg_catalog.replace(definition,$$  failure_context text;$$,
    $$  failure_context text;
  failure_phase text:='ENVELOPE';$$);
  rewritten:=pg_catalog.replace(rewritten,
    $$  select * into authority from platform.current_backend_authority(true);$$,
    $$  failure_phase:='AUTHORITY';
  select * into authority from platform.current_backend_authority(true);$$);
  rewritten:=pg_catalog.replace(rewritten,
    $$  authoritative_snapshot:=app_data_agent.load_semantic_context_authority_snapshot(requested->'request');$$,
    $$  failure_phase:='AUTHORITY_REFRESH';
  authoritative_snapshot:=app_data_agent.load_semantic_context_authority_snapshot(requested->'request');$$);
  rewritten:=pg_catalog.replace(rewritten,
    $$  expected_package_key_hash:=app_data_agent.semantic_context_package_key_hash(requested->'package');$$,
    $$  failure_phase:='PACKAGE_IDENTITY';
  expected_package_key_hash:=app_data_agent.semantic_context_package_key_hash(requested->'package');$$);
  rewritten:=pg_catalog.replace(rewritten,
    $$  if authoritative_snapshot->>'snapshot_hash'<>requested->>'authority_snapshot_hash'$$,
    $$  failure_phase:='CLOSURE';
  if authoritative_snapshot->>'snapshot_hash'<>requested->>'authority_snapshot_hash'$$);
  rewritten:=pg_catalog.replace(rewritten,
    $$  select receipt.* into existing from app_data_agent.semantic_context_receipts receipt$$,
    $$  failure_phase:='IDEMPOTENCY';
  select receipt.* into existing from app_data_agent.semantic_context_receipts receipt$$);
  rewritten:=pg_catalog.replace(rewritten,
    $$  insert into app_data_agent.semantic_context_receipts($$,
    $$  failure_phase:='PERSISTENCE';
  insert into app_data_agent.semantic_context_receipts($$);
  rewritten:=pg_catalog.replace(rewritten,
    $$  else
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_TEXT_REPRESENTATION_INVALID';
  end if;$$,
    $$  elsif failure_phase='AUTHORITY' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_AUTHORITY_INPUT_INVALID';
  elsif failure_phase='AUTHORITY_REFRESH' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_AUTHORITY_REFRESH_INVALID';
  elsif failure_phase='PACKAGE_IDENTITY' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_PACKAGE_IDENTITY_INVALID';
  elsif failure_phase='CLOSURE' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_COMMIT_CLOSURE_INPUT_INVALID';
  elsif failure_phase='IDEMPOTENCY' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_IDEMPOTENCY_INPUT_INVALID';
  elsif failure_phase='PERSISTENCE' then
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_PERSISTENCE_INPUT_INVALID';
  else
    raise exception using errcode='22023',message='SEMANTIC_CONTEXT_TEXT_REPRESENTATION_INVALID';
  end if;$$);
  execute rewritten;
end
$failure_phase_projection$;
