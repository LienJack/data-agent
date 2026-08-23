do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'current_head app_data_agent.research_authority_capability_heads%rowtype')=0
    or pg_catalog.strpos(definition,'current_capability app_data_agent.research_authority_capabilities%rowtype')=0
    or pg_catalog.strpos(definition,'current_head record')>0
    or pg_catalog.strpos(definition,'current_capability record')>0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_ROWTYPE_NOT_INSTALLED'; end if;
end
$postconditions$;
