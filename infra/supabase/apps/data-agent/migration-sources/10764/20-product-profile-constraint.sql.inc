do $profile_constraint$
declare profile_constraint text;
begin
  select pg_catalog.pg_get_constraintdef(oid) into profile_constraint
  from pg_catalog.pg_constraint
  where conrelid='app_data_agent.agent_product_profile_revisions'::pg_catalog.regclass
    and conname='agent_product_profile_revisions_generic_profile_id_check';
  if profile_constraint is null
    or pg_catalog.strpos(profile_constraint,'profile_id')=0
    or pg_catalog.strpos(profile_constraint,'a-z0-9')=0
  then raise exception using errcode='P0001',
    message='GENERIC_PRODUCT_PROFILE_CONSTRAINT_REQUIRED'; end if;
end
$profile_constraint$;
