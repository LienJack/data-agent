do $helper_consumer_repair$
declare target pg_catalog.regprocedure; definition text; rewritten text; repaired_count integer:=0;
begin
  for target in
    select procedure.oid::pg_catalog.regprocedure
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='app_data_agent' and procedure.prokind='f'
      and pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(procedure.oid),
        'app_data_agent.resolved_context_exact_keys'
      )>0
    order by procedure.oid::pg_catalog.regprocedure::text
  loop
    definition:=pg_catalog.pg_get_functiondef(target);
    rewritten:=pg_catalog.replace(
      definition,
      'app_data_agent.resolved_context_exact_keys',
      'app_data_agent.semantic_context_exact_keys'
    );
    if rewritten=definition then
      raise exception using errcode='P0001',message='SEMANTIC_HELPER_CONSUMER_SOURCE_MISMATCH';
    end if;
    execute rewritten;
    repaired_count:=repaired_count+1;
  end loop;
  if repaired_count<>13 then
    raise exception using errcode='P0001',message='SEMANTIC_HELPER_CONSUMER_COUNT_DRIFT';
  end if;
end
$helper_consumer_repair$;
