do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'coalesce(current_head.current_authority_epoch,-1::bigint)+1')=0
    or pg_catalog.strpos(definition,'pg_catalog.coalesce')>0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_EPOCH_REPAIR_NOT_INSTALLED'; end if;
end
$postconditions$;
