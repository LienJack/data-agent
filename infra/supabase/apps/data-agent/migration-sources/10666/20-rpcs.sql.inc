create or replace function app_data_agent.workspace_command_payload_is_valid(requested_payload jsonb)
returns boolean language sql immutable set search_path='' as $function$
  select case
    when pg_catalog.jsonb_typeof(requested_payload)='object'
      and (select pg_catalog.count(*)=1 from pg_catalog.jsonb_object_keys(requested_payload))
      and requested_payload->>'kind' in ('RESUME_RUN','CANCEL_RUN')
      then true
    else app_data_agent.command_payload_is_valid(requested_payload)
  end;
$function$;

do $control_payload_compatibility$
begin
  if not app_data_agent.workspace_command_payload_is_valid('{"kind":"RESUME_RUN"}'::jsonb)
    or not app_data_agent.workspace_command_payload_is_valid('{"kind":"CANCEL_RUN"}'::jsonb)
    or not app_data_agent.workspace_command_payload_is_valid(
      '{"kind":"START_L2_RESEARCH","mode":"L2","datasource_id":"00000000-0000-4000-8000-00000000fa01","conversation_id":"00000000-0000-4000-8000-00000000fa04"}'::jsonb)
  then raise exception using errcode='P0001',message='U8_RUN_CONTROL_PAYLOAD_COMPATIBILITY_FAILED'; end if;
end
$control_payload_compatibility$;

create function app_data_agent.u8_replayed_receipt(receipt jsonb)
returns jsonb language sql immutable set search_path='' as $function$
  select (receipt-'receipt_hash'-'disposition')||pg_catalog.jsonb_build_object(
    'disposition','REPLAYED','receipt_hash',app_data_agent.u2_canonical_sha256(
      (receipt-'receipt_hash'-'disposition')||pg_catalog.jsonb_build_object('disposition','REPLAYED')));
$function$;

create function app_data_agent.open_run_interruption(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; existing app_data_agent.session_recovery_operation_receipts%rowtype;
  run_record app_data_agent.runs%rowtype; projection app_data_agent.run_projections%rowtype;
  checkpoint app_data_agent.run_checkpoints%rowtype; document jsonb; result jsonb; now_at timestamptz;
begin
  if command is null or not app_data_agent.resolved_context_exact_keys(command,array[
    'schema_version','operation_id','idempotency_key','actor_principal_id','interruption','command_hash']::text[])
    or command->>'schema_version'<>'run-interruption-open-command@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',message='RUN_INTERRUPTION_OPEN_INVALID'; end if;
  document:=command->'interruption';
  if document->>'schema_version'<>'run-interruption@1.0.0'
    or document->>'interruption_hash'<>app_data_agent.u2_canonical_sha256(document-'interruption_hash')
    or document->>'state'<>'OPEN' or document->>'version'<>'1' or document->'answered_at'<>'null'::jsonb
  then raise exception using errcode='22023',message='RUN_INTERRUPTION_OPEN_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  if command->>'actor_principal_id'<>authority.principal_id::text
    or document#>>'{scope,app_id}'<>authority.app_id::text
    or document#>>'{scope,tenant_id}'<>authority.tenant_id::text
    or document#>>'{scope,environment}'<>authority.environment
  then raise exception using errcode='42501',message='RUN_INTERRUPTION_SCOPE_FORBIDDEN'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    authority.app_id::text||':'||authority.tenant_id::text||':'||authority.environment||
    ':RECOVERY:'||authority.principal_id::text||':'||(command->>'idempotency_key'),0));
  select receipt.* into existing from app_data_agent.session_recovery_operation_receipts receipt
  where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
    and receipt.environment=authority.environment and receipt.actor_principal_id=authority.principal_id
    and receipt.idempotency_key=command->>'idempotency_key' for share;
  if found then
    if existing.command_hash<>command->>'command_hash' or existing.operation_kind<>'OPEN_INTERRUPTION'
    then raise exception using errcode='23505',message='SESSION_RECOVERY_IDEMPOTENCY_CONFLICT'; end if;
    return app_data_agent.u8_replayed_receipt(existing.result_json);
  end if;
  select run.* into run_record from app_data_agent.runs run
  where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
    and run.environment=authority.environment and run.run_id=(document->>'run_id')::uuid
    and run.principal_id=authority.principal_id for update;
  if not found then raise exception using errcode='P0002',message='RUN_INTERRUPTION_NOT_FOUND_OR_DENIED'; end if;
  select value.* into projection from app_data_agent.run_projections value
  where value.app_id=authority.app_id and value.tenant_id=authority.tenant_id
    and value.environment=authority.environment and value.run_id=run_record.run_id
  order by value.version desc limit 1 for update;
  select value.* into checkpoint from app_data_agent.run_checkpoints value
  where value.app_id=authority.app_id and value.tenant_id=authority.tenant_id
    and value.environment=authority.environment and value.run_id=run_record.run_id
    and value.snapshot_id=(document#>>'{checkpoint_ref,snapshot_id}')::uuid
    and value.snapshot_version=(document#>>'{checkpoint_ref,snapshot_version}')::integer
    and value.snapshot_hash=document#>>'{checkpoint_ref,snapshot_hash}';
  if run_record.status<>'WAITING' or projection.status<>'WAITING'
    or projection.worker_fence<>(document->>'worker_fence')::bigint or checkpoint.snapshot_id is null
    or projection.projection_json#>'{active_snapshot_ref}'<>document->'checkpoint_ref'
  then raise exception using errcode='40001',message='RUN_INTERRUPTION_AUTHORITY_STALE'; end if;
  if exists(select 1 from app_data_agent.run_interruptions value where value.app_id=authority.app_id
    and value.tenant_id=authority.tenant_id and value.environment=authority.environment
    and value.run_id=run_record.run_id and value.state='OPEN')
  then raise exception using errcode='23505',message='RUN_INTERRUPTION_ALREADY_OPEN'; end if;
  now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.run_interruptions(app_id,tenant_id,environment,interruption_id,run_id,
    principal_id,state,version,worker_fence,checkpoint_id,checkpoint_version,checkpoint_hash,
    interruption_hash,document_json,opened_at,answered_at)
  values(authority.app_id,authority.tenant_id,authority.environment,(document->>'interruption_id')::uuid,
    run_record.run_id,authority.principal_id,'OPEN',1,(document->>'worker_fence')::bigint,
    checkpoint.snapshot_id,checkpoint.snapshot_version,checkpoint.snapshot_hash,
    document->>'interruption_hash',document,(document->>'opened_at')::timestamptz,null);
  result:=pg_catalog.jsonb_build_object('schema_version','run-interruption-open-receipt@1.0.0',
    'disposition','COMMITTED','command_hash',command->>'command_hash','interruption',document,
    'committed_at',app_data_agent.runtime_iso_timestamp(now_at));
  result:=result||pg_catalog.jsonb_build_object('receipt_hash',app_data_agent.u2_canonical_sha256(result));
  insert into app_data_agent.session_recovery_operation_receipts(app_id,tenant_id,environment,
    operation_id,actor_principal_id,idempotency_key,operation_kind,command_hash,result_json,receipt_hash,committed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,(command->>'operation_id')::uuid,
    authority.principal_id,command->>'idempotency_key','OPEN_INTERRUPTION',command->>'command_hash',
    result,result->>'receipt_hash',now_at);
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='RUN_INTERRUPTION_OPEN_INVALID';
end
$function$;

create function app_data_agent.reply_run_interruption(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; existing app_data_agent.session_recovery_operation_receipts%rowtype;
  target app_data_agent.run_interruptions%rowtype; run_record app_data_agent.runs%rowtype;
  projection app_data_agent.run_projections%rowtype; answered jsonb; resume_command jsonb;
  resume_event jsonb; resume_projection jsonb; control_result jsonb; result jsonb;
  reply_id uuid;resume_command_id uuid;resume_event_id uuid;resume_outbox_id uuid;resume_audit_id uuid;
  resume_key text;response_hash text;now_at timestamptz;
begin
  if command is null or not app_data_agent.resolved_context_exact_keys(command,array[
    'schema_version','operation_id','idempotency_key','scope','run_id','interruption_id',
    'expected_version','expected_worker_fence','actor_principal_id','response','submitted_at','command_hash']::text[])
    or command->>'schema_version'<>'interruption-reply-command@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',message='INTERRUPTION_REPLY_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  if command->>'actor_principal_id'<>authority.principal_id::text
    or command#>>'{scope,app_id}'<>authority.app_id::text
    or command#>>'{scope,tenant_id}'<>authority.tenant_id::text
    or command#>>'{scope,environment}'<>authority.environment
  then raise exception using errcode='42501',message='INTERRUPTION_REPLY_SCOPE_FORBIDDEN'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    authority.app_id::text||':'||authority.tenant_id::text||':'||authority.environment||
    ':RECOVERY:'||authority.principal_id::text||':'||(command->>'idempotency_key'),0));
  select receipt.* into existing from app_data_agent.session_recovery_operation_receipts receipt
  where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
    and receipt.environment=authority.environment and receipt.actor_principal_id=authority.principal_id
    and receipt.idempotency_key=command->>'idempotency_key' for share;
  if found then
    if existing.command_hash<>command->>'command_hash' or existing.operation_kind<>'REPLY_INTERRUPTION'
    then raise exception using errcode='23505',message='SESSION_RECOVERY_IDEMPOTENCY_CONFLICT'; end if;
    return app_data_agent.u8_replayed_receipt(existing.result_json);
  end if;
  select run.* into run_record from app_data_agent.runs run
  where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
    and run.environment=authority.environment and run.run_id=(command->>'run_id')::uuid
    and (authority.membership_role='owner' or run.principal_id=authority.principal_id) for update;
  if not found then raise exception using errcode='P0002',message='RUN_INTERRUPTION_NOT_FOUND_OR_DENIED'; end if;
  select value.* into projection from app_data_agent.run_projections value
  where value.app_id=authority.app_id and value.tenant_id=authority.tenant_id
    and value.environment=authority.environment and value.run_id=run_record.run_id
  order by value.version desc limit 1 for update;
  select value.* into target from app_data_agent.run_interruptions value
  where value.app_id=authority.app_id and value.tenant_id=authority.tenant_id
    and value.environment=authority.environment and value.run_id=run_record.run_id
    and value.interruption_id=(command->>'interruption_id')::uuid for update;
  if target.interruption_id is null then
    raise exception using errcode='P0002',message='RUN_INTERRUPTION_NOT_FOUND_OR_DENIED'; end if;
  if target.state<>'OPEN' or target.version<>(command->>'expected_version')::bigint
    or target.worker_fence<>(command->>'expected_worker_fence')::bigint
    or run_record.status<>'WAITING' or projection.status<>'WAITING'
    or projection.worker_fence<>target.worker_fence or projection.projection_json->>'terminal_event_id' is not null
  then raise exception using errcode='40001',message='INTERRUPTION_REPLY_VERSION_CONFLICT'; end if;
  if command#>>'{response,kind}'='OPTION' and not exists(
    select 1 from pg_catalog.jsonb_array_elements(target.document_json->'options') option(document)
    where option.document->>'option_id'=command#>>'{response,option_id}')
  then raise exception using errcode='22023',message='INTERRUPTION_REPLY_OPTION_INVALID'; end if;
  if command#>>'{response,kind}' not in ('OPTION','FREE_TEXT') then
    raise exception using errcode='22023',message='INTERRUPTION_REPLY_INVALID'; end if;
  now_at:=pg_catalog.clock_timestamp();
  answered:=(target.document_json-'interruption_hash')||pg_catalog.jsonb_build_object(
    'state','ANSWERED','version',2,'answered_at',app_data_agent.runtime_iso_timestamp(now_at));
  answered:=answered||pg_catalog.jsonb_build_object(
    'interruption_hash',app_data_agent.u2_canonical_sha256(answered));
  reply_id:=app_data_agent.resolved_context_uuid_v8_from_hash(app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_array('u8-reply',command->>'command_hash')));
  resume_command_id:=app_data_agent.resolved_context_uuid_v8_from_hash(app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_array('u8-resume-command',command->>'command_hash')));
  resume_event_id:=app_data_agent.resolved_context_uuid_v8_from_hash(app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_array('u8-resume-event',command->>'command_hash')));
  resume_outbox_id:=app_data_agent.resolved_context_uuid_v8_from_hash(app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_array('u8-resume-outbox',command->>'command_hash')));
  resume_audit_id:=app_data_agent.resolved_context_uuid_v8_from_hash(app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_array('u8-resume-audit',command->>'command_hash')));
  resume_key:='u8:resume:'||(command->>'operation_id');
  resume_command:=pg_catalog.jsonb_build_object('schema_version','1.0.0','scope',command->'scope',
    'operation','RESUME','run_id',run_record.run_id,'command_id',resume_command_id,
    'event_id',resume_event_id,'outbox_id',resume_outbox_id,'audit_id',resume_audit_id,
    'idempotency_key',resume_key,'occurred_at',app_data_agent.runtime_iso_timestamp(now_at));
  resume_event:=pg_catalog.jsonb_build_object('schema_version','1.0.0','event_id',resume_event_id,
    'scope',command->'scope','run_id',run_record.run_id,'sequence',projection.version+1,
    'worker_fence',projection.worker_fence,'idempotency_key',resume_key,
    'occurred_at',app_data_agent.runtime_iso_timestamp(now_at),'event_type','run.resumed',
    'payload',pg_catalog.jsonb_build_object('command_id',resume_command_id));
  resume_projection:=app_data_agent.reduce_run_projection_document(projection.projection_json,resume_event);
  control_result:=app_data_agent.request_run_control(resume_command,resume_event,
    app_data_agent.runtime_canonical_sha256(resume_event),projection.projection_hash,
    resume_projection,app_data_agent.runtime_canonical_sha256(resume_projection));
  update app_data_agent.run_interruptions value set state='ANSWERED',version=2,
    interruption_hash=answered->>'interruption_hash',document_json=answered,answered_at=now_at
  where value.app_id=authority.app_id and value.tenant_id=authority.tenant_id
    and value.environment=authority.environment and value.interruption_id=target.interruption_id;
  response_hash:=app_data_agent.u2_canonical_sha256(command->'response');
  result:=pg_catalog.jsonb_build_object('schema_version','interruption-reply-receipt@1.0.0',
    'disposition','COMMITTED','command_hash',command->>'command_hash','interruption',answered,
    'reply_id',reply_id,'response_hash',response_hash,'resume',pg_catalog.jsonb_build_object(
      'command_id',resume_command_id,'event_id',resume_event_id,'outbox_id',resume_outbox_id,
      'projection_version',(control_result#>>'{projection,version}')::bigint),
    'committed_at',app_data_agent.runtime_iso_timestamp(now_at));
  result:=result||pg_catalog.jsonb_build_object('receipt_hash',app_data_agent.u2_canonical_sha256(result));
  insert into app_data_agent.run_interruption_replies(app_id,tenant_id,environment,reply_id,
    interruption_id,run_id,actor_principal_id,expected_version,expected_worker_fence,response_hash,
    response_json,resume_command_id,resume_event_id,resume_outbox_id,receipt_hash,receipt_json,committed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,reply_id,target.interruption_id,
    run_record.run_id,authority.principal_id,1,target.worker_fence,response_hash,command->'response',
    resume_command_id,resume_event_id,resume_outbox_id,result->>'receipt_hash',result,now_at);
  insert into app_data_agent.session_recovery_operation_receipts(app_id,tenant_id,environment,
    operation_id,actor_principal_id,idempotency_key,operation_kind,command_hash,result_json,receipt_hash,committed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,(command->>'operation_id')::uuid,
    authority.principal_id,command->>'idempotency_key','REPLY_INTERRUPTION',command->>'command_hash',
    result,result->>'receipt_hash',now_at);
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='INTERRUPTION_REPLY_INVALID';
end
$function$;
