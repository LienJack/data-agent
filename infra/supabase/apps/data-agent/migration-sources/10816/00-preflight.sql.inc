begin;
set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or session_user<>'postgres' or current_user<>'postgres'
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010815_app_data_agent_falcon24_recovery_certification_lock'
        and migration_checksum='sha256:9db12283ff7d6c9c92ee6cc7b0a273a4e89668f749fd22d3613f59947ff85a1e')
    or not exists(select 1 from pg_catalog.pg_proc
      where oid='app_data_agent.load_semantic_context_authority_snapshot(jsonb)'::regprocedure
        and pg_catalog.pg_get_userbyid(proowner)='data_agent_u12_context_owner' and prosecdef
        and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex')
          ='ddc55529da0dba5595140bf351f122b6681ed9a46b1545bc0b63ea7adc10268a')
    or not exists(select 1 from pg_catalog.pg_proc
      where oid='app_data_agent.assert_semantic_context_request(jsonb)'::regprocedure
        and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex')
          ='be4c3d24aacd5fd1ad005d5f561666a0f735589d090ef992aa01aecda77479e0')
    or not exists(select 1 from pg_catalog.pg_proc
      where oid='app_data_agent.commit_semantic_context_package(jsonb)'::regprocedure
        and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex')
          ='9d7334f0ab4bba3e86dded9d8c9a5f39139b2d8ec0850f03f727bafa0d485951')
    or not exists(select 1 from pg_catalog.pg_proc
      where oid='app_data_agent.load_provider_task_artifact(jsonb)'::regprocedure
        and pg_catalog.pg_get_userbyid(proowner)='data_agent_provider_invocation_rpc_owner' and prosecdef
        and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex')
          ='7a1d7342979acfacafd6be0d76f1f6d6af49bb905970d3b82f31957433f423bd')
  then raise exception using errcode='P0001',message='SEMANTIC_CONVERSATION_INTENT_BASELINE_DRIFT'; end if;
end
$preflight$;
