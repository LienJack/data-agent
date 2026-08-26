begin;

do $bootstrap$
declare relation_name text; relation_id regclass; has_rows boolean;
  runtime_relations constant text[]:=array[
    'app_data_agent.runs','app_data_agent.commands','app_data_agent.idempotency_records',
    'app_data_agent.run_events','app_data_agent.run_attempts','app_data_agent.run_projections',
    'app_data_agent.run_checkpoints','app_data_agent.run_effect_receipts',
    'app_data_agent.run_interruptions','app_data_agent.run_interruption_replies',
    'app_data_agent.outbox','app_data_agent.artifacts','app_data_agent.artifact_export_receipts',
    'app_data_agent.qa_conversations','app_data_agent.qa_messages',
    'app_data_agent.qa_resource_switch_operations','app_data_agent.qa_directory_operation_receipts',
    'app_data_agent.qa_admin_conversation_audit_receipts',
    'app_data_agent.qa_conversation_retention_claims','app_data_agent.workspace_run_bindings',
    'app_data_agent.effective_run_config_receipts',
    'app_data_agent.effective_run_config_resource_bindings',
    'app_data_agent.effective_config_context_receipts','app_data_agent.agent_team_tasks',
    'app_data_agent.agent_team_handoffs','app_data_agent.agent_team_context_epochs',
    'app_data_agent.agent_team_completion_receipts','app_data_agent.agent_team_events',
    'app_data_agent.agent_team_verifier_decisions','app_data_agent.agent_team_task_capabilities',
    'app_data_agent.agent_team_acceptance_receipts',
    'app_data_agent.agent_team_accepted_sibling_output_attachments',
    'app_data_agent.provider_invocation_intents',
    'app_data_agent.provider_invocation_dispatch_permits',
    'app_data_agent.provider_invocation_outcomes',
    'app_data_agent.provider_invocation_usage_receipts',
    'app_data_agent.analysis_python_sources','app_data_agent.analysis_operator_results',
    'app_data_agent.analysis_context_journal','app_data_agent.analysis_result_stages',
    'app_data_agent.analysis_result_stage_artifacts',
    'app_data_agent.analysis_stage_oracle_records',
    'app_data_agent.analysis_stage_explanation_records',
    'app_data_agent.analysis_result_stage_cleanup_receipts',
    'app_data_agent.analysis_authority_commits','app_data_agent.analysis_authority_current',
    'app_data_agent.analysis_authority_outbox','app_data_agent.analysis_system_artifacts',
    'app_data_agent.text2sql_system_artifacts','app_data_agent.text2sql_sandbox_claims',
    'app_data_agent.text2sql_sandbox_execution_events',
    'app_data_agent.text2sql_sandbox_execution_records',
    'app_data_agent.sensitive_execution_artifacts',
    'app_data_agent.sensitive_execution_artifact_access_audit',
    'app_data_agent.falcon24_acceptance_campaigns',
    'app_data_agent.falcon24_acceptance_campaign_runs',
    'app_data_agent.falcon24_qualifications','app_data_agent.falcon24_qualification_slots']::text[];
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='FALCON24_E1_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='FALCON24_E1_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010774_app_data_agent_falcon24_qualification_authority')
  then raise exception using errcode='P0001',message='FALCON24_E1_BASELINE_10774_MISSING'; end if;
  for relation_name in
    select explicit_relation.name
    from pg_catalog.unnest(runtime_relations) explicit_relation(name)
    union
    select pg_catalog.format('%I.%I',column_row.table_schema,column_row.table_name)
    from information_schema.columns column_row
    join information_schema.tables table_row
      on table_row.table_schema=column_row.table_schema
      and table_row.table_name=column_row.table_name
      and table_row.table_type='BASE TABLE'
    where column_row.table_schema='app_data_agent' and column_row.column_name='run_id'
  loop
    relation_id:=pg_catalog.to_regclass(relation_name);
    if relation_id is null then
      raise exception using errcode='P0001',message='FALCON24_E1_RUNTIME_RELATION_MISSING',
        detail=relation_name;
    end if;
    execute pg_catalog.format('select exists(select 1 from %s limit 1)',relation_id)
      into strict has_rows;
    if has_rows then
      raise exception using errcode='55000',message='FALCON24_E1_LEGACY_RUNTIME_STATE_PRESENT',
        detail=relation_name;
    end if;
  end loop;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
