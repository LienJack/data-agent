create function app_data_agent.read_qa_admin_run_events(requested_query jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; requested_owner uuid; requested_conversation uuid; requested_run uuid;
  requested_operation text; requested_profile text; requested_task uuid; requested_after bigint;
  requested_limit integer; documents jsonb; next_sequence bigint; receipt jsonb; reason text; result_run uuid;
begin
  if requested_query is null or not app_data_agent.resolved_context_exact_keys(requested_query,array[
    'schema_version','operation','workspace_id','owner_principal_id','conversation_id','run_id',
    'profile_id','task_id','after_sequence','limit']::text[])
    or requested_query->>'schema_version'<>'qa-admin-run-events-query@1.0.0'
    or requested_query->>'operation' not in('RUN_REPLAY','TRAJECTORY_READ','SUBAGENT_READ')
  then raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID'; end if;
  select * into authority from platform.resolve_qa_admin_audit_scope((requested_query->>'workspace_id')::uuid);
  requested_owner:=(requested_query->>'owner_principal_id')::uuid;
  requested_conversation:=(requested_query->>'conversation_id')::uuid;
  requested_operation:=requested_query->>'operation';
  if requested_query->'run_id'<>'null'::jsonb then requested_run:=(requested_query->>'run_id')::uuid; end if;
  if requested_query->'profile_id'<>'null'::jsonb then requested_profile:=requested_query->>'profile_id'; end if;
  if requested_query->'task_id'<>'null'::jsonb then requested_task:=(requested_query->>'task_id')::uuid; end if;
  requested_after:=(requested_query->>'after_sequence')::bigint;
  requested_limit:=(requested_query->>'limit')::integer;
  if requested_after<0 or requested_limit not between 1 and 500
    or (requested_operation='RUN_REPLAY' and requested_run is null)
    or (requested_operation='SUBAGENT_READ' and (requested_run is null or requested_profile is null or requested_task is null))
    or (requested_operation<>'SUBAGENT_READ' and (requested_profile is not null or requested_task is not null))
  then raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID'; end if;
  if not exists(select 1 from app_data_agent.qa_conversations conversation
    where conversation.app_id=authority.app_id and conversation.tenant_id=authority.tenant_id
      and conversation.environment=authority.environment and conversation.owner_principal_id=requested_owner
      and conversation.conversation_id=requested_conversation)
  then raise exception using errcode='P0002',message='QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED'; end if;
  if requested_run is not null and not exists(select 1 from app_data_agent.workspace_run_bindings binding
    where binding.app_id=authority.app_id and binding.tenant_id=authority.tenant_id
      and binding.environment=authority.environment and binding.principal_id=requested_owner
      and binding.conversation_id=requested_conversation and binding.run_id=requested_run)
  then raise exception using errcode='P0002',message='QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED'; end if;
  if requested_operation='SUBAGENT_READ' and not exists(select 1 from app_data_agent.run_events event
    where event.app_id=authority.app_id and event.tenant_id=authority.tenant_id
      and event.environment=authority.environment and event.run_id=requested_run
      and event.event_document#>>'{payload,profile_id}'=requested_profile
      and event.event_document#>>'{payload,task_id}'=requested_task::text)
  then raise exception using errcode='P0002',message='QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED'; end if;
  if requested_run is not null then
    select pg_catalog.coalesce(pg_catalog.jsonb_agg(event.event_document order by event.sequence),'[]'::jsonb),
      case when pg_catalog.count(*)=requested_limit then pg_catalog.max(event.sequence) else null end
    into documents,next_sequence from (select source.* from app_data_agent.run_events source
      where source.app_id=authority.app_id and source.tenant_id=authority.tenant_id
        and source.environment=authority.environment and source.run_id=requested_run
        and source.sequence>requested_after order by source.sequence limit requested_limit) event;
    result_run:=requested_run;
  else
    select pg_catalog.coalesce(pg_catalog.jsonb_agg(event.event_document
      order by event.created_at,event.run_id,event.sequence),'[]'::jsonb),null::bigint
    into documents,next_sequence from (select source.* from app_data_agent.run_events source
      join app_data_agent.workspace_run_bindings binding on binding.app_id=source.app_id
        and binding.tenant_id=source.tenant_id and binding.environment=source.environment
        and binding.run_id=source.run_id and binding.principal_id=requested_owner
      where source.app_id=authority.app_id and source.tenant_id=authority.tenant_id
        and source.environment=authority.environment and binding.conversation_id=requested_conversation
      order by source.created_at,source.run_id,source.sequence offset requested_after limit requested_limit) event;
  end if;
  reason:=case requested_operation when 'RUN_REPLAY' then 'QA_ADMIN_RUN_REPLAY'
    when 'TRAJECTORY_READ' then 'QA_ADMIN_TRAJECTORY_REVIEW' else 'QA_ADMIN_SUBAGENT_REVIEW' end;
  receipt:=app_data_agent.qa_admin_audit_receipt(requested_query,requested_operation,reason,requested_owner,
    case when requested_operation='TRAJECTORY_READ' then 'TRAJECTORY'
      when requested_operation='SUBAGENT_READ' then 'SUBAGENT' else 'RUN' end,
    pg_catalog.coalesce(requested_run,requested_conversation),
    case when documents='[]'::jsonb then 'EMPTY' else 'AUTHORIZED' end);
  return pg_catalog.jsonb_build_object('schema_version','qa-admin-run-events-raw-page@1.0.0',
    'workspace_id',authority.tenant_id,'owner_principal_id',requested_owner,
    'conversation_id',requested_conversation,'run_id',result_run,'read_only',true,
    'event_documents',documents,'next_sequence',next_sequence,'receipt',receipt);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID';
end
$function$;

create function app_data_agent.authorize_qa_admin_artifact_access(requested_query jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; requested_owner uuid; requested_conversation uuid; requested_run uuid;
  requested_operation text; reference jsonb; receipt jsonb; reason text; artifact_document jsonb;
begin
  if requested_query is null or not app_data_agent.resolved_context_exact_keys(requested_query,array[
    'schema_version','operation','workspace_id','owner_principal_id','conversation_id','run_id','reference']::text[])
    or requested_query->>'schema_version'<>'qa-admin-artifact-access-query@1.0.0'
    or requested_query->>'operation' not in('ARTIFACT_PREVIEW','ARTIFACT_EXPORT')
    or not app_data_agent.resolved_context_exact_keys(requested_query->'reference',array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash']::text[])
  then raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID'; end if;
  select * into authority from platform.resolve_qa_admin_audit_scope((requested_query->>'workspace_id')::uuid);
  requested_owner:=(requested_query->>'owner_principal_id')::uuid;
  requested_conversation:=(requested_query->>'conversation_id')::uuid;
  requested_run:=(requested_query->>'run_id')::uuid;
  requested_operation:=requested_query->>'operation'; reference:=requested_query->'reference';
  if reference->>'app_id'<>authority.app_id::text or reference->>'tenant_id'<>authority.tenant_id::text
    or reference->>'environment'<>authority.environment or reference->>'run_id'<>requested_run::text
    or not exists(select 1 from app_data_agent.workspace_run_bindings binding
      where binding.app_id=authority.app_id and binding.tenant_id=authority.tenant_id
        and binding.environment=authority.environment and binding.principal_id=requested_owner
        and binding.conversation_id=requested_conversation and binding.run_id=requested_run)
    or not exists(select 1 from app_data_agent.artifacts artifact
      where artifact.app_id=authority.app_id and artifact.tenant_id=authority.tenant_id
        and artifact.environment=authority.environment and artifact.run_id=requested_run
        and artifact.artifact_id=(reference->>'artifact_id')::uuid
        and artifact.artifact_type=reference->>'artifact_type'
        and artifact.revision=(reference->>'revision')::integer
        and artifact.content_hash=reference->>'content_hash')
  then raise exception using errcode='P0002',message='QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED'; end if;
  select artifact.document_json into strict artifact_document
  from app_data_agent.artifacts artifact
  where artifact.app_id=authority.app_id and artifact.tenant_id=authority.tenant_id
    and artifact.environment=authority.environment and artifact.run_id=requested_run
    and artifact.artifact_id=(reference->>'artifact_id')::uuid
    and artifact.artifact_type=reference->>'artifact_type'
    and artifact.revision=(reference->>'revision')::integer
    and artifact.content_hash=reference->>'content_hash';
  reason:=case requested_operation when 'ARTIFACT_EXPORT' then 'QA_ADMIN_ARTIFACT_EXPORT'
    else 'QA_ADMIN_ARTIFACT_PREVIEW' end;
  receipt:=app_data_agent.qa_admin_audit_receipt(requested_query,requested_operation,reason,requested_owner,
    'ARTIFACT',(reference->>'artifact_id')::uuid,'AUTHORIZED');
  return pg_catalog.jsonb_build_object('schema_version','qa-admin-artifact-access-result@1.0.0',
    'workspace_id',authority.tenant_id,'owner_principal_id',requested_owner,
    'conversation_id',requested_conversation,'run_id',requested_run,'read_only',true,
    'reference',reference,'artifact_document',artifact_document,'receipt',receipt);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID';
end
$function$;
