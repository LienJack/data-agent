do $postconditions$
declare
  before_snapshot record;
  after_count bigint;
  after_digest text;
  rpc record;
begin
  select * into strict before_snapshot from falcon24_10795_staging_snapshot;
  select pg_catalog.count(*)::bigint,
    app_data_agent.u2_canonical_sha256(
      coalesce(
        pg_catalog.jsonb_agg(to_jsonb(session) order by
          session.app_id,session.tenant_id,session.environment,
          session.authority_epoch,session.staging_id),
        '[]'::jsonb))
    into strict after_count,after_digest
    from app_data_agent.falcon24_authority_staging_sessions as session;
  select procedure.provolatile,procedure.prosecdef,procedure.proconfig,
    pg_catalog.pg_get_userbyid(procedure.proowner) as owner_name
    into strict rpc
    from pg_catalog.pg_proc as procedure
    where procedure.oid=
      'app_data_agent.hold_falcon24_authority_staging_session(jsonb)'::regprocedure;

  if before_snapshot.row_count is distinct from after_count
    or before_snapshot.row_digest is distinct from after_digest
    or rpc.provolatile is distinct from 'v'
    or rpc.prosecdef is distinct from true
    or rpc.owner_name is distinct from 'data_agent_u6_rpc_owner'
    or not (rpc.proconfig @> array['search_path=""']::text[])
    or pg_catalog.has_function_privilege(
      'public','app_data_agent.hold_falcon24_authority_staging_session(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.hold_falcon24_authority_staging_session(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',
    message='FALCON24_STAGING_HOLD_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
