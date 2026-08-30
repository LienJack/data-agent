begin;
do $assertions$
begin
  if not exists(select 1 from pg_policy where polrelid='app_data_agent.artifacts'::regclass
      and polname='falcon24_recovery_active_certification_lock' and polcmd='w'
      and polroles=array['data_agent_u6_rpc_owner'::regrole::oid]
      and pg_get_expr(polwithcheck,polrelid)='false')
    or not pg_catalog.has_column_privilege('data_agent_u6_rpc_owner','app_data_agent.artifacts','is_active','UPDATE')
    or not exists(select 1 from pg_proc where oid='app_data_agent.reject_artifact_payload_mutation()'::regprocedure
      and encode(sha256(convert_to(prosrc,'UTF8')),'hex')='faf781b516cfd42bf74bca16b107b0d84e139599e31dc7d38e7f020627fb2487')
  then raise exception 'FALCON24_RECOVERY_CERTIFICATION_LOCK_ASSERTION_FAILED'; end if;
end
$assertions$;
rollback;
