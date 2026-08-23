create table app_data_agent.qa_admin_conversation_audit_receipts(
  app_id uuid not null check(app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check(environment~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  receipt_id uuid not null,
  actor_principal_id uuid not null,
  actor_role text not null check(actor_role in('WORKSPACE_ADMIN','SUPER_ADMIN')),
  target_owner_principal_id uuid,
  resource_kind text not null check(resource_kind in(
    'DIRECTORY','CONVERSATION','MESSAGE','RUN','TRAJECTORY','SUBAGENT','ARTIFACT')),
  resource_id uuid,
  operation_kind text not null check(operation_kind in(
    'DIRECTORY_READ','CONVERSATION_READ','MESSAGES_READ','RUN_REPLAY',
    'TRAJECTORY_READ','SUBAGENT_READ','ARTIFACT_PREVIEW','ARTIFACT_EXPORT')),
  reason_code text not null check(reason_code in(
    'QA_ADMIN_DIRECTORY_REVIEW','QA_ADMIN_CONVERSATION_REVIEW','QA_ADMIN_MESSAGE_REVIEW',
    'QA_ADMIN_RUN_REPLAY','QA_ADMIN_TRAJECTORY_REVIEW','QA_ADMIN_SUBAGENT_REVIEW',
    'QA_ADMIN_ARTIFACT_PREVIEW','QA_ADMIN_ARTIFACT_EXPORT')),
  request_digest text not null check(request_digest~'^sha256:[0-9a-f]{64}$'),
  result_classification text not null check(result_classification in('AUTHORIZED','EMPTY')),
  occurred_at timestamptz not null,
  primary key(app_id,tenant_id,environment,receipt_id),
  check((operation_kind='DIRECTORY_READ') or target_owner_principal_id is not null),
  check((resource_kind='DIRECTORY' and resource_id is null)
    or (resource_kind<>'DIRECTORY' and resource_id is not null))
);

create index qa_admin_conversation_audit_actor_time
  on app_data_agent.qa_admin_conversation_audit_receipts(
    app_id,environment,actor_principal_id,occurred_at desc,receipt_id);
create index qa_admin_conversation_audit_target_time
  on app_data_agent.qa_admin_conversation_audit_receipts(
    app_id,tenant_id,environment,target_owner_principal_id,occurred_at desc,receipt_id);

create function app_data_agent.reject_qa_admin_audit_receipt_mutation()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  raise exception using errcode='55000',message='QA_ADMIN_AUDIT_RECEIPT_IMMUTABLE';
end
$function$;

create trigger qa_admin_conversation_audit_receipts_immutable
before update or delete on app_data_agent.qa_admin_conversation_audit_receipts
for each row execute function app_data_agent.reject_qa_admin_audit_receipt_mutation();

create function platform.resolve_qa_admin_audit_scope(requested_workspace_id uuid)
returns table(
  app_id uuid,tenant_id uuid,environment text,deployment_id uuid,
  actor_principal_id uuid,actor_role text
)
language plpgsql volatile security definer set search_path='' as $function$
declare context record; resolved record;
begin
  if requested_workspace_id is null then
    raise exception using errcode='22023',message='QA_ADMIN_QUERY_INVALID';
  end if;
  select * into context from platform.current_backend_authority(false);
  if context.tenant_id<>requested_workspace_id then
    raise exception using errcode='42501',message='QA_ADMIN_ACCESS_DENIED';
  end if;
  select * into resolved from platform.resolve_workspace_authority(
    context.deployment_id,requested_workspace_id,context.principal_id,false);
  if resolved.workspace_role<>'WORKSPACE_ADMIN' and resolved.system_role<>'SUPER_ADMIN' then
    raise exception using errcode='42501',message='QA_ADMIN_ACCESS_DENIED';
  end if;
  return query select resolved.app_id,resolved.tenant_id,resolved.environment,
    resolved.deployment_id,resolved.principal_id,
    case when resolved.system_role='SUPER_ADMIN' then 'SUPER_ADMIN' else 'WORKSPACE_ADMIN' end;
end
$function$;

create function platform.qa_admin_audit_scope_matches(
  requested_app_id uuid,requested_tenant_id uuid,requested_environment text)
returns boolean language plpgsql volatile security definer set search_path='' as $function$
declare authority record;
begin
  select * into authority from platform.resolve_qa_admin_audit_scope(requested_tenant_id);
  return authority.app_id=requested_app_id and authority.tenant_id=requested_tenant_id
    and authority.environment=requested_environment;
exception when others then return false;
end
$function$;

create function app_data_agent.qa_admin_audit_receipt(
  request_document jsonb,requested_operation text,requested_reason text,
  requested_owner uuid,requested_resource_kind text,requested_resource_id uuid,
  requested_result_classification text default 'AUTHORIZED')
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; receipt_id uuid:=pg_catalog.gen_random_uuid(); occurred timestamptz:=pg_catalog.clock_timestamp();
  request_digest text;
begin
  select * into authority from platform.resolve_qa_admin_audit_scope((request_document->>'workspace_id')::uuid);
  request_digest:=app_data_agent.u2_canonical_sha256(request_document);
  insert into app_data_agent.qa_admin_conversation_audit_receipts(
    app_id,tenant_id,environment,receipt_id,actor_principal_id,actor_role,
    target_owner_principal_id,resource_kind,resource_id,operation_kind,reason_code,
    request_digest,result_classification,occurred_at)
  values(authority.app_id,authority.tenant_id,authority.environment,receipt_id,
    authority.actor_principal_id,authority.actor_role,requested_owner,requested_resource_kind,
    requested_resource_id,requested_operation,requested_reason,request_digest,
    requested_result_classification,occurred);
  return pg_catalog.jsonb_build_object(
    'schema_version','qa-admin-audit-receipt-ref@1.0.0','receipt_id',receipt_id,
    'operation',requested_operation,'reason_code',requested_reason,
    'request_digest',request_digest,'occurred_at',occurred);
end
$function$;
