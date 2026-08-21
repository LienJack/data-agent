create function app_data_agent.claim_qa_conversation_retention(
  requested_limit integer,requested_lease_duration_ms integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare
  authority record; now_at timestamptz:=pg_catalog.clock_timestamp();
  candidate app_data_agent.qa_conversations%rowtype;
  claim app_data_agent.qa_conversation_retention_claims%rowtype;
  claims jsonb:='[]'::jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  if requested_limit not between 1 and 50 or requested_lease_duration_ms not between 1000 and 300000 then
    raise exception using errcode='22023',message='QA_RETENTION_CLAIM_INPUT_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  if pg_catalog.lower(authority.membership_role) not in('owner','analyst') then
    raise exception using errcode='42501',message='QA_RETENTION_JOB_REQUIRED'; end if;
  for candidate in
    select conversation.* from app_data_agent.qa_conversations conversation
    left join app_data_agent.qa_conversation_retention_claims existing
      on existing.app_id=conversation.app_id and existing.tenant_id=conversation.tenant_id
      and existing.environment=conversation.environment
      and existing.owner_principal_id=conversation.owner_principal_id
      and existing.conversation_id=conversation.conversation_id
    where conversation.app_id=authority.app_id and conversation.tenant_id=authority.tenant_id
      and conversation.environment=authority.environment
      and conversation.owner_principal_id=authority.principal_id
      and conversation.deleted_at is not null and conversation.purge_after<=now_at
      and (existing.claim_id is null or (existing.status<>'PURGED'
        and (existing.status='HELD' or existing.lease_expires_at<=now_at)))
    order by conversation.purge_after,conversation.conversation_id
    for update of conversation skip locked limit requested_limit
  loop
    insert into app_data_agent.qa_conversation_retention_claims(
      app_id,tenant_id,environment,owner_principal_id,conversation_id,claim_id,fence,status,
      deleted_at,purge_after,lease_expires_at,created_at,updated_at)
    values(candidate.app_id,candidate.tenant_id,candidate.environment,candidate.owner_principal_id,
      candidate.conversation_id,pg_catalog.gen_random_uuid(),1,'LEASED',candidate.deleted_at,
      candidate.purge_after,now_at+pg_catalog.make_interval(secs=>requested_lease_duration_ms/1000.0),
      now_at,now_at)
    on conflict(app_id,tenant_id,environment,owner_principal_id,conversation_id) do update set
      claim_id=pg_catalog.gen_random_uuid(),fence=app_data_agent.qa_conversation_retention_claims.fence+1,
      status='LEASED',deleted_at=excluded.deleted_at,purge_after=excluded.purge_after,
      lease_expires_at=excluded.lease_expires_at,reason_code=null,receipt_id=null,completed_at=null,
      updated_at=now_at
    where app_data_agent.qa_conversation_retention_claims.status<>'PURGED'
      and (app_data_agent.qa_conversation_retention_claims.status='HELD'
        or app_data_agent.qa_conversation_retention_claims.lease_expires_at<=now_at)
    returning * into claim;
    if found then
      claims:=claims||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'schema_version','conversation-trash-retention-claim@1.0.0','claim_id',claim.claim_id,
        'workspace_id',claim.tenant_id,'owner_principal_id',claim.owner_principal_id,
        'conversation_id',claim.conversation_id,'deleted_at',claim.deleted_at,
        'purge_after',claim.purge_after,'fence',claim.fence,
        'lease_expires_at',claim.lease_expires_at));
    end if;
  end loop;
  return claims;
end
$function$;

create function app_data_agent.complete_qa_conversation_retention(requested_completion jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare
  authority record; claim app_data_agent.qa_conversation_retention_claims%rowtype;
  now_at timestamptz:=pg_catalog.clock_timestamp(); requested_outcome text;
  actual_outcome text; actual_reason text; receipt_id_value uuid:=pg_catalog.gen_random_uuid();
  receipt jsonb; has_references boolean;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  if requested_completion is null or not app_data_agent.resolved_context_exact_keys(
      requested_completion,array['schema_version','claim_id','fence','outcome','reason_code']::text[])
    or requested_completion->>'schema_version'<>'conversation-trash-retention-complete@1.0.0'
    or requested_completion->>'outcome' not in('PURGED','HELD')
    or requested_completion->>'reason_code'!~'^[A-Z][A-Z0-9_]*$'
    or pg_catalog.length(requested_completion->>'reason_code') not between 1 and 128
  then raise exception using errcode='22023',message='QA_RETENTION_COMPLETION_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  select * into claim from app_data_agent.qa_conversation_retention_claims current_claim
  where current_claim.app_id=authority.app_id and current_claim.tenant_id=authority.tenant_id
    and current_claim.environment=authority.environment
    and current_claim.owner_principal_id=authority.principal_id
    and current_claim.claim_id=(requested_completion->>'claim_id')::uuid for update;
  if not found or claim.status<>'LEASED' or claim.fence<>(requested_completion->>'fence')::bigint
    or claim.lease_expires_at<=now_at then
    raise exception using errcode='40001',message='QA_RETENTION_CLAIM_STALE'; end if;
  requested_outcome:=requested_completion->>'outcome';
  actual_outcome:=requested_outcome; actual_reason:=requested_completion->>'reason_code';
  if requested_outcome='PURGED' then
    select exists(select 1 from app_data_agent.qa_messages message
        where message.app_id=claim.app_id and message.tenant_id=claim.tenant_id
          and message.environment=claim.environment and message.owner_principal_id=claim.owner_principal_id
          and message.conversation_id=claim.conversation_id)
      or exists(select 1 from app_data_agent.workspace_run_bindings binding
        where binding.app_id=claim.app_id and binding.tenant_id=claim.tenant_id
          and binding.environment=claim.environment and binding.principal_id=claim.owner_principal_id
          and binding.conversation_id=claim.conversation_id)
      into has_references;
    if has_references then
      actual_outcome:='HELD'; actual_reason:='CONVERSATION_RETENTION_REFERENCES_HELD';
    else
      begin
        delete from app_data_agent.qa_conversations conversation
        where conversation.app_id=claim.app_id and conversation.tenant_id=claim.tenant_id
          and conversation.environment=claim.environment
          and conversation.owner_principal_id=claim.owner_principal_id
          and conversation.conversation_id=claim.conversation_id
          and conversation.deleted_at=claim.deleted_at and conversation.purge_after<=now_at;
        if not found then
          actual_outcome:='HELD'; actual_reason:='CONVERSATION_RETENTION_STATE_CHANGED'; end if;
      exception when foreign_key_violation then
        actual_outcome:='HELD'; actual_reason:='CONVERSATION_RETENTION_REFERENCES_HELD';
      end;
    end if;
  end if;
  update app_data_agent.qa_conversation_retention_claims current_claim set
    status=actual_outcome,reason_code=actual_reason,receipt_id=receipt_id_value,
    completed_at=now_at,updated_at=now_at
  where current_claim.app_id=claim.app_id and current_claim.tenant_id=claim.tenant_id
    and current_claim.environment=claim.environment and current_claim.claim_id=claim.claim_id;
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','conversation-trash-retention-receipt@1.0.0',
    'receipt_id',receipt_id_value,'claim_id',claim.claim_id,
    'conversation_id',claim.conversation_id,'fence',claim.fence,
    'outcome',actual_outcome,'reason_code',actual_reason,'committed_at',now_at);
  return receipt;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='QA_RETENTION_COMPLETION_INVALID';
end
$function$;
