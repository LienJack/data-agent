do $patch_session_recovery_semantic_helper$
declare
  definition text;
  repaired text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.reply_run_interruption(jsonb)'::regprocedure)
    into definition;
  repaired:=pg_catalog.replace(
    definition,
    'app_data_agent.resolved_context_uuid_v8_from_hash',
    'app_data_agent.semantic_context_uuid_v8_from_hash');
  if repaired=definition then
    raise exception using errcode='P0001',
      message='E1_SESSION_RECOVERY_SEMANTIC_HELPER_DRIFT';
  end if;
  execute repaired;
end
$patch_session_recovery_semantic_helper$;
