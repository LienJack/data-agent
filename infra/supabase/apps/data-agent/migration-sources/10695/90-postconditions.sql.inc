do $postconditions$
declare v_constraint text;
begin
  select pg_catalog.pg_get_constraintdef(item.oid)
    into strict v_constraint
  from pg_catalog.pg_constraint as item
  where item.conrelid='semantic.semantic_authoring_turn'::pg_catalog.regclass
    and item.conname='semantic_authoring_provider_dispatch_closure';
  if pg_catalog.strpos(v_constraint, 'provider_terminal_kind = ''FAILED''')=0
    or pg_catalog.strpos(v_constraint, 'provider_dispatched_at IS NULL')=0
  then raise exception using errcode='P0001',message='SEMANTIC_PROVIDER_PREFLIGHT_FAILURE_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
