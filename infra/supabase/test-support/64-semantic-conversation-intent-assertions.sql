\set ON_ERROR_STOP on
begin;

-- Exercise the installed projection body, not a second hand-written projection.
do $prepare$
declare body text;projection text;
begin
  select prosrc into strict body from pg_proc
    where oid='app_data_agent.load_semantic_context_authority_snapshot(jsonb)'::regprocedure;
  projection:=substring(body from 'conversation_intent:=pg_catalog.jsonb_build_object\([\s\S]*?\) question\)\);');
  if projection is null then raise exception 'SEMANTIC_INTENT_PROJECTION_MISSING'; end if;
  execute 'create function pg_temp.project_semantic_intent_test(task_result jsonb) returns jsonb '
    ||'language plpgsql as $test$ declare task_document jsonb:=task_result->''document'';conversation_intent jsonb;'
    ||'begin '||projection||' return conversation_intent;end $test$';
end
$prepare$;

do $projection$
declare messages jsonb;result jsonb;source jsonb;
begin
  select jsonb_agg(jsonb_build_object('message_id',n::text,'role','user','type','text','content','q'||n::text) order by n)
    into messages from generate_series(1,12) n;
  messages:=messages||jsonb_build_array(
    jsonb_build_object('message_id','agent','role','agent','type','text','content','untrusted old answer'),
    jsonb_build_object('message_id','table','role','user','type','table','content','old table'),
    jsonb_build_object('message_id','current','role','user','type','text','content','continue'));
  source:=jsonb_build_object('reference',jsonb_build_object('content_hash','task hash'),
    'document',jsonb_build_object('visible_messages',messages,'current_message',jsonb_build_object('message_id','current'),
      'context_selection_hash','selection hash'));
  result:=pg_temp.project_semantic_intent_test(source);
  if jsonb_array_length(result->'prior_user_questions')<>8
    or result#>>'{prior_user_questions,0,message_id}'<>'5'
    or result#>>'{prior_user_questions,7,message_id}'<>'12'
    or result#>>'{prior_user_questions,7,content}'<>'q12'
    or result->'task_ref'<>source->'reference'
    or result->>'context_selection_hash'<>'selection hash'
    or result::text like '%untrusted old answer%'
    or result::text like '%old table%'
  then raise exception 'SEMANTIC_INTENT_PRIOR_USER_PROJECTION_INVALID'; end if;
  source:=jsonb_set(source,'{document,visible_messages}',jsonb_build_array(messages->14));
  if pg_temp.project_semantic_intent_test(source)->'prior_user_questions'<>'[]'::jsonb
  then raise exception 'SEMANTIC_INTENT_FIRST_TURN_INVALID'; end if;
end
$projection$;

do $surface$
declare definition text;request jsonb;
begin
  select prosrc into strict definition from pg_proc
    where oid='app_data_agent.load_semantic_context_authority_snapshot(jsonb)'::regprocedure;
  if strpos(definition,'SEMANTIC_CONTEXT_WORKER_AUTHORITY_STALE')=0
    or strpos(definition,'attempt.lease_expires_at>pg_catalog.clock_timestamp()')=0
    or strpos(definition,'app_data_agent.load_provider_task_artifact(')=0
    or strpos(definition,'SEMANTIC_CONTEXT_CONVERSATION_INTENT_STALE')=0
    or strpos(definition,'''snapshot_hash'',app_data_agent.u2_canonical_sha256(snapshot_document)')=0
    or not has_function_privilege('data_agent_u12_context_owner','app_data_agent.load_provider_task_artifact(jsonb)','EXECUTE')
    or has_table_privilege('data_agent_u12_context_owner','app_data_agent.artifacts','SELECT')
  then raise exception 'SEMANTIC_INTENT_AUTHORITY_BOUNDARY_DRIFT'; end if;
  select prosrc into strict definition from pg_proc where oid='app_data_agent.commit_semantic_context_package(jsonb)'::regprocedure;
  if strpos(definition,'{package,retrieval_receipt,intent_context_hash}'' is distinct from')=0
    or strpos(definition,'{package,retrieval_receipt,retrieval_query_hash}'' is distinct from')=0
  then raise exception 'SEMANTIC_INTENT_COMMIT_HASH_RECHECK_MISSING'; end if;
  request:='{"schema_version":"semantic-context-request@1.0.0","request_id":"00000000-0000-4000-8000-000000000008","scope":{"app_id":"00000000-0000-4000-8000-00000000da01","tenant_id":"00000000-0000-4000-8000-000000000001","environment":"test"},"basis":{"consumer":"RUN","run_id":"00000000-0000-4000-8000-000000000009","config_ref":{"config_id":"00000000-0000-4000-8000-000000000010","config_revision":1,"config_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"context_receipt_ref":{"receipt_id":"00000000-0000-4000-8000-000000000011","receipt_hash":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},"provider_task_ref":{}}}'::jsonb;
  perform app_data_agent.assert_semantic_context_request(request||jsonb_build_object('request_hash',app_data_agent.u2_canonical_sha256(request)));
  -- The reader validates exact task ref shape and authority. Request assertion only owns the optional basis key.
  request:=jsonb_set(request,'{basis,question}','"injected"'::jsonb);
  begin
    perform app_data_agent.assert_semantic_context_request(request||jsonb_build_object('request_hash',app_data_agent.u2_canonical_sha256(request)));
    raise exception 'SEMANTIC_INTENT_UNKNOWN_BASIS_ACCEPTED';
  exception when sqlstate '22023' then null;
  end;
end
$surface$;
rollback;
select 'SEMANTIC_CONVERSATION_INTENT_ASSERTIONS_PASSED' as result;
