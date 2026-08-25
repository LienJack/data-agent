do $postconditions$
declare profile_constraint text;
begin
  select pg_catalog.pg_get_constraintdef(oid) into profile_constraint
  from pg_catalog.pg_constraint
  where conrelid='app_data_agent.agent_product_profile_revisions'::pg_catalog.regclass
    and conname='agent_product_profile_revisions_profile_id_check';
  if profile_constraint is null
    or pg_catalog.strpos(profile_constraint,'governed-analysis-agent')=0
  then raise exception using errcode='P0001',message='GOVERNED_ANALYSIS_PRODUCT_PROFILE_CONSTRAINT_DRIFT'; end if;
end
$postconditions$;
