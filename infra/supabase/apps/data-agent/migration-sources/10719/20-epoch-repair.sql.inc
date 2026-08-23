do $epoch_repair$
declare
  definition text;
  rewritten text;
  old_expression constant text := 'pg_catalog.coalesce(current_head.current_authority_epoch,-1)+1';
  new_expression constant text := 'coalesce(current_head.current_authority_epoch,-1::bigint)+1';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,old_expression)=0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_EPOCH_SOURCE_MISMATCH'; end if;
  rewritten:=pg_catalog.replace(definition,old_expression,new_expression);
  execute rewritten;
end
$epoch_repair$;
