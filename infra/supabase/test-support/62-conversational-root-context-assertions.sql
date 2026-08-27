\set ON_ERROR_STOP on

begin isolation level repeatable read read only;

do $provider_task_v2_validator$
declare conversation_id uuid:='88000000-0000-4000-8000-000000000001';
  run_one uuid:='88000000-0000-4000-8000-000000000002';
  run_two uuid:='88000000-0000-4000-8000-000000000003';
  message_one uuid:='88000000-0000-4000-8000-000000000004';
  message_two uuid:='88000000-0000-4000-8000-000000000005';
  message_three uuid:='88000000-0000-4000-8000-000000000006';
  visible_messages jsonb;selection_document jsonb;document jsonb;content_hash text;
begin
  visible_messages:=pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'message_id',message_one,'role','user','type','text',
      'content','最近 12 个完整月订单收入趋势如何？','run_id',run_one,
      'content_hash',app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
        'message_id',message_one,'role','user','type','text',
        'content','最近 12 个完整月订单收入趋势如何？','run_id',run_one))),
    pg_catalog.jsonb_build_object(
      'message_id',message_two,'role','agent','type','text',
      'content','订单收入趋势已经生成。','run_id',run_one,
      'content_hash',app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
        'message_id',message_two,'role','agent','type','text',
        'content','订单收入趋势已经生成。','run_id',run_one))),
    pg_catalog.jsonb_build_object(
      'message_id',message_three,'role','user','type','text',
      'content','只看华东呢？','run_id',run_two,
      'content_hash',app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
        'message_id',message_three,'role','user','type','text',
        'content','只看华东呢？','run_id',run_two))));
  selection_document:=pg_catalog.jsonb_build_object(
    'conversation_id',conversation_id,'conversation_resource_version',7,
    'current_message_id',message_three,
    'visible_messages',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'message_id',message.document->>'message_id',
        'content_hash',message.document->>'content_hash') order by message.ordinal)
      from pg_catalog.jsonb_array_elements(visible_messages)
        with ordinality message(document,ordinal)),
    'context_summary_ref',null);
  document:=pg_catalog.jsonb_build_object(
    'schema_version','provider-task-artifact@2.0.0',
    'conversation_id',conversation_id,'conversation_resource_version',7,
    'current_message',pg_catalog.jsonb_build_object(
      'message_id',message_three,'content','只看华东呢？'),
    'visible_messages',visible_messages,'context_summary_ref',null,
    'context_selection_hash',app_data_agent.u2_canonical_sha256(selection_document));
  content_hash:=app_data_agent.u2_canonical_sha256(document);
  document:=document||pg_catalog.jsonb_build_object('content_hash',content_hash);
  if not app_data_agent.provider_task_document_is_valid(
      document,message_three,run_two,content_hash)
  then raise exception 'CONVERSATIONAL_ROOT_PROVIDER_TASK_V2_REJECTED'; end if;
  if app_data_agent.provider_task_document_is_valid(
      pg_catalog.jsonb_set(document,'{visible_messages,0,content}',
        '"tampered"'::jsonb),message_three,run_two,content_hash)
  then raise exception 'CONVERSATIONAL_ROOT_VISIBLE_MESSAGE_TAMPER_ACCEPTED'; end if;
  if app_data_agent.provider_task_document_is_valid(
      pg_catalog.jsonb_set(document,'{current_message,message_id}',
        pg_catalog.to_jsonb(message_one)),message_three,run_two,content_hash)
  then raise exception 'CONVERSATIONAL_ROOT_CURRENT_MESSAGE_TAMPER_ACCEPTED'; end if;
end
$provider_task_v2_validator$;

do $installed_surface$
declare acceptance_definition text;commit_definition text;
begin
  select procedure.prosrc into strict acceptance_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure;
  select procedure.prosrc into strict commit_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.commit_provider_task_artifact(jsonb,jsonb)'::regprocedure;
  if pg_catalog.strpos(acceptance_definition,'limit 63')=0
    or pg_catalog.strpos(commit_definition,'limit 64')=0
    or pg_catalog.strpos(commit_definition,
      '(candidate.created_at,candidate.message_id)<=')=0
  then raise exception 'CONVERSATIONAL_ROOT_CONTEXT_INSTALLED_SURFACE_DRIFT'; end if;
end
$installed_surface$;

rollback;
