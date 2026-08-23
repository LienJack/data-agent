create function app_data_agent.create_session_branch(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; existing app_data_agent.session_recovery_operation_receipts%rowtype;
  branch jsonb; run_record app_data_agent.runs%rowtype; projection app_data_agent.run_projections%rowtype;
  checkpoint app_data_agent.run_checkpoints%rowtype; context_record app_data_agent.effective_config_context_receipts%rowtype;
  parent_binding app_data_agent.workspace_run_bindings%rowtype; result jsonb; now_at timestamptz;
begin
  if command is null or not app_data_agent.resolved_context_exact_keys(command,array[
    'schema_version','operation_id','idempotency_key','branch','command_hash']::text[])
    or command->>'schema_version'<>'session-branch-command@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',message='SESSION_BRANCH_COMMAND_INVALID'; end if;
  branch:=command->'branch';
  if branch->>'schema_version'<>'session-branch@1.0.0'
    or branch->>'branch_hash'<>app_data_agent.u2_canonical_sha256(branch-'branch_hash')
  then raise exception using errcode='22023',message='SESSION_BRANCH_COMMAND_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  if branch#>>'{scope,app_id}'<>authority.app_id::text
    or branch#>>'{scope,tenant_id}'<>authority.tenant_id::text
    or branch#>>'{scope,environment}'<>authority.environment
    or branch->>'created_by_principal_id'<>authority.principal_id::text
  then raise exception using errcode='42501',message='SESSION_BRANCH_SCOPE_FORBIDDEN'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    authority.app_id::text||':'||authority.tenant_id::text||':'||authority.environment||
    ':RECOVERY:'||authority.principal_id::text||':'||(command->>'idempotency_key'),0));
  select receipt.* into existing from app_data_agent.session_recovery_operation_receipts receipt
  where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
    and receipt.environment=authority.environment and receipt.actor_principal_id=authority.principal_id
    and receipt.idempotency_key=command->>'idempotency_key' for share;
  if found then
    if existing.command_hash<>command->>'command_hash' or existing.operation_kind<>'CREATE_BRANCH'
    then raise exception using errcode='23505',message='SESSION_RECOVERY_IDEMPOTENCY_CONFLICT'; end if;
    return app_data_agent.u8_replayed_receipt(existing.result_json);
  end if;
  select run.* into run_record from app_data_agent.runs run
  where run.app_id=authority.app_id and run.tenant_id=authority.tenant_id
    and run.environment=authority.environment and run.run_id=(branch->>'parent_run_id')::uuid
    and (authority.membership_role='owner' or run.principal_id=authority.principal_id) for share;
  if not found then raise exception using errcode='P0002',message='SESSION_BRANCH_NOT_FOUND_OR_DENIED'; end if;
  select binding.* into parent_binding from app_data_agent.workspace_run_bindings binding
  where binding.app_id=authority.app_id and binding.tenant_id=authority.tenant_id
    and binding.environment=authority.environment and binding.run_id=run_record.run_id
    and binding.conversation_id=(branch->>'parent_conversation_id')::uuid
    and binding.principal_id=run_record.principal_id;
  select value.* into projection from app_data_agent.run_projections value
  where value.app_id=authority.app_id and value.tenant_id=authority.tenant_id
    and value.environment=authority.environment and value.run_id=run_record.run_id
  order by value.version desc limit 1 for share;
  select value.* into checkpoint from app_data_agent.run_checkpoints value
  where value.app_id=authority.app_id and value.tenant_id=authority.tenant_id
    and value.environment=authority.environment and value.run_id=run_record.run_id
    and value.snapshot_id=(branch#>>'{parent_checkpoint_ref,snapshot_id}')::uuid
    and value.snapshot_version=(branch#>>'{parent_checkpoint_ref,snapshot_version}')::integer
    and value.snapshot_hash=branch#>>'{parent_checkpoint_ref,snapshot_hash}';
  select value.* into context_record from app_data_agent.effective_config_context_receipts value
  where value.app_id=authority.app_id and value.tenant_id=authority.tenant_id
    and value.environment=authority.environment
    and value.context_receipt_id=(branch#>>'{effective_config_revalidation,receipt_id}')::uuid
    and value.receipt_hash=branch#>>'{effective_config_revalidation,receipt_hash}'
    and value.config_id=(branch#>>'{effective_config_revalidation,config_ref,config_id}')::uuid
    and value.config_revision=(branch#>>'{effective_config_revalidation,config_ref,config_revision}')::bigint
    and value.config_hash=branch#>>'{effective_config_revalidation,config_ref,config_hash}'
    and value.run_id=run_record.run_id and value.principal_id=run_record.principal_id;
  if parent_binding.run_id is null or projection.run_id is null or checkpoint.snapshot_id is null
    or context_record.context_receipt_id is null
    or projection.version<>(branch->>'parent_event_sequence')::bigint
    or projection.projection_json#>'{active_snapshot_ref}'<>branch->'parent_checkpoint_ref'
    or app_data_agent.runtime_iso_timestamp(context_record.consumed_at)<>
      branch#>>'{effective_config_revalidation,revalidated_at}'
  then raise exception using errcode='40001',message='SESSION_BRANCH_AUTHORITY_STALE'; end if;
  if not exists(select 1 from app_data_agent.qa_conversations child
      where child.app_id=authority.app_id and child.tenant_id=authority.tenant_id
        and child.environment=authority.environment
        and child.conversation_id=(branch->>'child_conversation_id')::uuid
        and child.owner_principal_id=authority.principal_id)
    or exists(select 1 from app_data_agent.qa_messages message where message.app_id=authority.app_id
      and message.tenant_id=authority.tenant_id and message.environment=authority.environment
      and message.conversation_id=(branch->>'child_conversation_id')::uuid)
    or exists(select 1 from app_data_agent.workspace_run_bindings child_binding
      where child_binding.app_id=authority.app_id and child_binding.tenant_id=authority.tenant_id
        and child_binding.environment=authority.environment
        and child_binding.conversation_id=(branch->>'child_conversation_id')::uuid)
  then raise exception using errcode='23514',message='SESSION_BRANCH_CHILD_NOT_EMPTY'; end if;
  now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.session_branches(app_id,tenant_id,environment,branch_id,
    parent_conversation_id,parent_run_id,parent_event_sequence,parent_checkpoint_id,
    parent_checkpoint_version,parent_checkpoint_hash,context_receipt_id,context_receipt_hash,
    config_id,config_revision,config_hash,child_conversation_id,created_by_principal_id,
    branch_hash,document_json,created_at)
  values(authority.app_id,authority.tenant_id,authority.environment,(branch->>'branch_id')::uuid,
    (branch->>'parent_conversation_id')::uuid,run_record.run_id,(branch->>'parent_event_sequence')::bigint,
    checkpoint.snapshot_id,checkpoint.snapshot_version,checkpoint.snapshot_hash,
    context_record.context_receipt_id,context_record.receipt_hash,context_record.config_id,
    context_record.config_revision,context_record.config_hash,(branch->>'child_conversation_id')::uuid,
    authority.principal_id,branch->>'branch_hash',branch,(branch->>'created_at')::timestamptz);
  result:=pg_catalog.jsonb_build_object('schema_version','session-branch-receipt@1.0.0',
    'disposition','COMMITTED','command_hash',command->>'command_hash','branch',branch,
    'committed_at',app_data_agent.runtime_iso_timestamp(now_at));
  result:=result||pg_catalog.jsonb_build_object('receipt_hash',app_data_agent.u2_canonical_sha256(result));
  insert into app_data_agent.session_recovery_operation_receipts(app_id,tenant_id,environment,
    operation_id,actor_principal_id,idempotency_key,operation_kind,command_hash,result_json,receipt_hash,committed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,(command->>'operation_id')::uuid,
    authority.principal_id,command->>'idempotency_key','CREATE_BRANCH',command->>'command_hash',
    result,result->>'receipt_hash',now_at);
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SESSION_BRANCH_COMMAND_INVALID';
end
$function$;

create function app_data_agent.load_run_interruption(requested_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; result jsonb;
begin
  select * into authority from platform.current_backend_authority(false);
  select interruption.document_json into result from app_data_agent.run_interruptions interruption
  join app_data_agent.runs run on run.app_id=interruption.app_id and run.tenant_id=interruption.tenant_id
    and run.environment=interruption.environment and run.run_id=interruption.run_id
  where interruption.app_id=authority.app_id and interruption.tenant_id=authority.tenant_id
    and interruption.environment=authority.environment and interruption.run_id=requested_run_id
    and (authority.membership_role='owner' or run.principal_id=authority.principal_id)
  order by interruption.opened_at desc limit 1;
  return result;
end
$function$;

create function app_data_agent.list_session_branches(requested_parent_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; result jsonb;
begin
  select * into authority from platform.current_backend_authority(false);
  select coalesce(pg_catalog.jsonb_agg(branch.document_json order by branch.created_at,branch.branch_id),'[]'::jsonb)
  into result from app_data_agent.session_branches branch join app_data_agent.runs run
    on run.app_id=branch.app_id and run.tenant_id=branch.tenant_id
    and run.environment=branch.environment and run.run_id=branch.parent_run_id
  where branch.app_id=authority.app_id and branch.tenant_id=authority.tenant_id
    and branch.environment=authority.environment and branch.parent_run_id=requested_parent_run_id
    and (authority.membership_role='owner' or run.principal_id=authority.principal_id);
  return result;
end
$function$;
