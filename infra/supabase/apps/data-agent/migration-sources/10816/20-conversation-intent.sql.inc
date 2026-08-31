-- No history rewrite or table grant: reuse the existing scoped, hash-verifying task reader.
grant execute on function app_data_agent.load_provider_task_artifact(jsonb)
  to data_agent_u12_context_owner;

do $patch$
declare definition text;needle text;replacement text;
begin
  select pg_catalog.pg_get_functiondef('app_data_agent.assert_semantic_context_request(jsonb)'::regprocedure)
    into strict definition;
  needle:=$old$requested->'basis',array['consumer','run_id','config_ref','context_receipt_ref']::text[]))$old$;
  replacement:=$new$requested->'basis',array['consumer','run_id','config_ref','context_receipt_ref']::text[]
        ||case when (requested->'basis') ? 'provider_task_ref'
          then array['provider_task_ref']::text[] else array[]::text[] end))$new$;
  if pg_catalog.strpos(definition,needle)=0 then
    raise exception using errcode='P0001',message='SEMANTIC_CONVERSATION_INTENT_REQUEST_DRIFT'; end if;
  execute pg_catalog.replace(definition,needle,replacement);

  select pg_catalog.pg_get_functiondef('app_data_agent.load_semantic_context_authority_snapshot(jsonb)'::regprocedure)
    into strict definition;
  if pg_catalog.strpos(definition,'  run_question text;')=0
    or pg_catalog.strpos(definition,'    defaults_json:=config_record.effective_config_json;')=0
    or pg_catalog.strpos(definition,'  return snapshot_document||pg_catalog.jsonb_build_object(')=0
  then raise exception using errcode='P0001',message='SEMANTIC_CONVERSATION_INTENT_LOADER_DRIFT'; end if;
  definition:=pg_catalog.replace(definition,'  run_question text;',
    '  run_question text; task_result jsonb; task_document jsonb; conversation_intent jsonb;');
  definition:=pg_catalog.replace(definition,
    '    defaults_json:=config_record.effective_config_json;',
    $new$    defaults_json:=config_record.effective_config_json;
    if (requested->'basis') ? 'provider_task_ref' then
      task_result:=app_data_agent.load_provider_task_artifact(pg_catalog.jsonb_build_object(
        'schema_version','provider-task-artifact-load@1.0.0',
        'scope',(requested->'scope')||pg_catalog.jsonb_build_object(
          'workspace_id',authority.tenant_id,'principal_id',authority.principal_id),
        'run_id',config_record.run_id,'reference',requested#>'{basis,provider_task_ref}'));
      task_document:=task_result->'document';
      if task_document->>'schema_version' is distinct from 'provider-task-artifact@2.0.0'
        or task_document#>>'{current_message,content}' is distinct from run_question
        or task_document->>'conversation_id' is distinct from defaults_json#>>'{conversation_binding,conversation_id}'
        or task_document->>'conversation_resource_version' is distinct from defaults_json#>>'{conversation_binding,resource_version}'
      then raise exception using errcode='40001',message='SEMANTIC_CONTEXT_CONVERSATION_INTENT_STALE'; end if;
      conversation_intent:=pg_catalog.jsonb_build_object(
        'task_ref',task_result->'reference',
        'context_selection_hash',task_document->'context_selection_hash',
        'prior_user_questions',(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'message_id',question.document->'message_id','content',question.document->'content')
          order by question.ordinality),'[]'::jsonb) from (
            select message.document,message.ordinality
            from pg_catalog.jsonb_array_elements(task_document->'visible_messages') with ordinality message(document,ordinality)
            where message.document->>'role'='user' and message.document->>'type'='text'
              and message.document->>'message_id'<>task_document#>>'{current_message,message_id}'
            order by message.ordinality desc limit 8
          ) question));
    end if;$new$);
  definition:=pg_catalog.replace(definition,
    '  return snapshot_document||pg_catalog.jsonb_build_object(',
    $new$  if conversation_intent is not null then
    snapshot_document:=snapshot_document||pg_catalog.jsonb_build_object('conversation_intent',conversation_intent);
  end if;
  return snapshot_document||pg_catalog.jsonb_build_object($new$);
  execute definition;

  select pg_catalog.pg_get_functiondef('app_data_agent.commit_semantic_context_package(jsonb)'::regprocedure)
    into strict definition;
  needle:=$old$    or requested#>>'{package,retrieval_receipt,query_hash}'<>authoritative_snapshot->>'question_hash'$old$;
  replacement:=needle||$new$
    or requested#>>'{package,retrieval_receipt,intent_context_hash}' is distinct from
      (case when authoritative_snapshot ? 'conversation_intent'
        then app_data_agent.u2_canonical_sha256(authoritative_snapshot->'conversation_intent') else null end)
    or requested#>>'{package,retrieval_receipt,retrieval_query_hash}' is distinct from
      (case when authoritative_snapshot ? 'conversation_intent'
        then app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb(pg_catalog.concat_ws(E'\n',
          (select pg_catalog.string_agg(question.document->>'content',E'\n' order by question.ordinality)
            from pg_catalog.jsonb_array_elements(authoritative_snapshot#>'{conversation_intent,prior_user_questions}')
              with ordinality question(document,ordinality)),authoritative_snapshot->>'question'))) else null end)$new$;
  if pg_catalog.strpos(definition,needle)=0 then
    raise exception using errcode='P0001',message='SEMANTIC_CONVERSATION_INTENT_COMMIT_DRIFT'; end if;
  execute pg_catalog.replace(definition,needle,replacement);
end
$patch$;
