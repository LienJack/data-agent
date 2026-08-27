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
