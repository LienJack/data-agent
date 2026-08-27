-- conversation_context_summary_compatibility_migration_checksum: sha256:60f05ac027c21d28d5e4b1b7f7e7c289654a8cd9e4a55513d039057168344217
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare commit_definition text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010785_app_data_agent_conversation_context_summary')
    or pg_catalog.to_regprocedure(
      'app_data_agent.commit_provider_task_artifact(jsonb,jsonb)') is null
  then raise exception using errcode='P0001',
    message='CONVERSATION_CONTEXT_SUMMARY_COMPATIBILITY_BASELINE_DRIFT'; end if;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_provider_task_artifact(jsonb,jsonb)'::regprocedure)
    into strict commit_definition;
  if pg_catalog.strpos(commit_definition,
      $$select case when bounds.total_count<=16 then 1$$)=0
    or pg_catalog.strpos(commit_definition,
      $$if selected_message_refs<>requested_lease#>'{payload,visible_message_refs}' then$$)=0
  then raise exception using errcode='P0001',
    message='CONVERSATION_CONTEXT_SUMMARY_COMPATIBILITY_PREDECESSOR_DRIFT'; end if;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
do $patch_provider_task_compatibility$
declare definition text;repaired text;
  old_cutoff text;new_cutoff text;old_guard text;new_guard text;
  old_join text;new_join text;old_resource text;new_resource text;
  old_lock text;new_lock text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_provider_task_artifact(jsonb,jsonb)'::regprocedure)
    into strict definition;
  old_cutoff:=$$select case when bounds.total_count<=16 then 1$$;
  new_cutoff:=$$select case when requested_lease#>'{payload,visible_message_refs}' is null then 1
      when bounds.total_count<=16 then 1$$;
  old_guard:=$$if selected_message_refs<>requested_lease#>'{payload,visible_message_refs}' then$$;
  new_guard:=$$if requested_lease#>'{payload,visible_message_refs}' is not null
    and selected_message_refs<>requested_lease#>'{payload,visible_message_refs}' then$$;
  old_join:=$$join app_data_agent.effective_run_config_receipts receipt$$;
  new_join:=$$left join app_data_agent.effective_run_config_receipts receipt$$;
  old_resource:=$$    (receipt.effective_config_json#>>'{conversation_binding,resource_version}')::bigint
      as resource_version$$;
  new_resource:=$$    coalesce(
      (receipt.effective_config_json#>>'{conversation_binding,resource_version}')::bigint,
      (requested_command#>>'{conversation_binding,resource_version}')::bigint)
      as resource_version$$;
  old_lock:=$$    and binding.conversation_id=
      (requested_command#>>'{conversation_binding,conversation_id}')::uuid
  for share of binding,message,event,receipt,conversation;$$;
  new_lock:=$$    and binding.conversation_id=
      (requested_command#>>'{conversation_binding,conversation_id}')::uuid
    and ((requested_lease#>'{payload,visible_message_refs}' is null
        and conversation.resource_version=
          (requested_command#>>'{conversation_binding,resource_version}')::bigint)
      or (requested_lease#>'{payload,visible_message_refs}' is not null
        and receipt.config_id is not null))
  for share of binding,message,event,conversation;$$;
  if (pg_catalog.length(definition)-pg_catalog.length(
      pg_catalog.replace(definition,old_cutoff,'')))/pg_catalog.length(old_cutoff)<>1
    or (pg_catalog.length(definition)-pg_catalog.length(
      pg_catalog.replace(definition,old_guard,'')))/pg_catalog.length(old_guard)<>1
    or (pg_catalog.length(definition)-pg_catalog.length(
      pg_catalog.replace(definition,old_join,'')))/pg_catalog.length(old_join)<>1
    or (pg_catalog.length(definition)-pg_catalog.length(
      pg_catalog.replace(definition,old_resource,'')))/pg_catalog.length(old_resource)<>1
    or (pg_catalog.length(definition)-pg_catalog.length(
      pg_catalog.replace(definition,old_lock,'')))/pg_catalog.length(old_lock)<>1
  then raise exception using errcode='P0001',
    message='CONVERSATION_CONTEXT_SUMMARY_COMPATIBILITY_PATCH_DRIFT'; end if;
  repaired:=pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
    pg_catalog.replace(definition,old_cutoff,new_cutoff),old_guard,new_guard),
    old_join,new_join),old_resource,new_resource),old_lock,new_lock);
  if repaired=definition
    or pg_catalog.strpos(repaired,new_cutoff)=0
    or pg_catalog.strpos(repaired,new_guard)=0
    or pg_catalog.strpos(repaired,new_join)=0
    or pg_catalog.strpos(repaired,new_resource)=0
    or pg_catalog.strpos(repaired,new_lock)=0
  then raise exception using errcode='P0001',
    message='CONVERSATION_CONTEXT_SUMMARY_COMPATIBILITY_PATCH_MISSED'; end if;
  execute repaired;
end
$patch_provider_task_compatibility$;
grant usage on schema extensions
to data_agent_provider_invocation_rpc_owner;
do $postconditions$
declare commit_definition text;
begin
  select procedure.prosrc into strict commit_definition from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.commit_provider_task_artifact(jsonb,jsonb)'::regprocedure;
  if pg_catalog.strpos(commit_definition,
      $$requested_lease#>'{payload,visible_message_refs}' is null then 1$$)=0
    or pg_catalog.strpos(commit_definition,
      $$requested_lease#>'{payload,visible_message_refs}' is not null$$)=0
    or pg_catalog.strpos(commit_definition,
      'left join app_data_agent.effective_run_config_receipts receipt')=0
    or pg_catalog.strpos(commit_definition,'conversation.resource_version=')=0
    or pg_catalog.strpos(commit_definition,'receipt.config_id is not null')=0
    or pg_catalog.strpos(commit_definition,'ConversationContextSummary')=0
    or not pg_catalog.has_schema_privilege(
      'data_agent_provider_invocation_rpc_owner','extensions','USAGE')
    or pg_catalog.has_schema_privilege('data_agent_backend','extensions','USAGE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_provider_task_artifact(jsonb,jsonb)','EXECUTE')
  then raise exception using errcode='P0001',
    message='CONVERSATION_CONTEXT_SUMMARY_COMPATIBILITY_POSTCONDITION_FAILED'; end if;
end
$postconditions$;

select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010786_app_data_agent_conversation_context_summary_compatibility',
  'sha256:60f05ac027c21d28d5e4b1b7f7e7c289654a8cd9e4a55513d039057168344217');
commit;
