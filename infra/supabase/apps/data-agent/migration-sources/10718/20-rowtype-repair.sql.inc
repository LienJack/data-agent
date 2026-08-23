do $rowtype_repair$
declare
  definition text;
  rewritten text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'  current_head record;')=0
    or pg_catalog.strpos(definition,'  current_capability record;')=0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_ROWTYPE_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(
    definition,'  current_head record;',
    '  current_head app_data_agent.research_authority_capability_heads%rowtype;'
  );
  rewritten:=pg_catalog.replace(
    rewritten,'  current_capability record;',
    '  current_capability app_data_agent.research_authority_capabilities%rowtype;'
  );
  execute rewritten;
end
$rowtype_repair$;
