-- 10676 repairs invalid schema qualification of the PostgreSQL COALESCE expression in 10675.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='QA_ADMIN_AUDIT_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='QA_ADMIN_AUDIT_REPAIR_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010675_app_data_agent_qa_admin_audit')
  then raise exception using errcode='P0001',message='QA_ADMIN_AUDIT_REPAIR_BASELINE_10675_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010676_app_data_agent_qa_admin_audit_coalesce_repair',
  '__QA_ADMIN_AUDIT_REPAIR_MIGRATION_CHECKSUM__');

do $repair$
declare signature text; definition text;
begin
  foreach signature in array array[
    'app_data_agent.qa_admin_conversation_document(app_data_agent.qa_conversations,text)',
    'app_data_agent.read_qa_admin_directory(jsonb)',
    'app_data_agent.read_qa_admin_conversation(jsonb)',
    'app_data_agent.read_qa_admin_run_events(jsonb)'
  ]::text[] loop
    select pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(signature)) into definition;
    if definition is null or pg_catalog.strpos(definition,'pg_catalog.coalesce')=0 then
      raise exception using errcode='P0001',message='QA_ADMIN_AUDIT_REPAIR_TARGET_INVALID';
    end if;
    execute pg_catalog.replace(definition,'pg_catalog.coalesce','coalesce');
  end loop;
end
$repair$;

do $postconditions$
declare signature text; definition text;
begin
  foreach signature in array array[
    'app_data_agent.qa_admin_conversation_document(app_data_agent.qa_conversations,text)',
    'app_data_agent.read_qa_admin_directory(jsonb)',
    'app_data_agent.read_qa_admin_conversation(jsonb)',
    'app_data_agent.read_qa_admin_run_events(jsonb)'
  ]::text[] loop
    select pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(signature)) into definition;
    if definition is null or pg_catalog.strpos(definition,'pg_catalog.coalesce')<>0 then
      raise exception using errcode='P0001',message='QA_ADMIN_AUDIT_REPAIR_POSTCONDITION_FAILED';
    end if;
  end loop;
end
$postconditions$;

commit;
