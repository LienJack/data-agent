create function app_data_agent.load_agent_team_public_projection(requested_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; result jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  select * into authority from platform.current_backend_authority(false);
  if not exists(select 1 from app_data_agent.runs run where run.app_id=authority.app_id
    and run.tenant_id=authority.tenant_id and run.environment=authority.environment
    and run.run_id=requested_run_id and run.principal_id=authority.principal_id)
  then return null; end if;
  if exists(select 1 from app_data_agent.agent_team_tasks task
    where task.app_id=authority.app_id and task.tenant_id=authority.tenant_id
      and task.environment=authority.environment and task.run_id=requested_run_id
      and (task.task_hash<>app_data_agent.u2_canonical_sha256(task.task_json-'task_hash')
        or task.task_id<>(task.task_json->>'task_id')::uuid
        or task.parent_task_id is distinct from case when task.task_json->'parent_task_id'='null'::jsonb
          then null else (task.task_json->>'parent_task_id')::uuid end
        or task.depth<>(task.task_json->>'depth')::integer
        or task.profile_id<>task.task_json->>'profile_id'
        or task.profile_revision<>(task.task_json->>'profile_revision')::integer
        or task.profile_hash<>task.task_json->>'profile_hash'
        or task.task_revision<>(task.task_json->>'task_revision')::integer
        or task.task_attempt_id<>(task.task_json->>'attempt_id')::uuid
        or task.worker_fence<>(task.task_json->>'worker_fence')::bigint))
    or exists(select 1 from app_data_agent.agent_team_handoffs handoff
      join app_data_agent.agent_team_tasks child on child.app_id=handoff.app_id
        and child.tenant_id=handoff.tenant_id and child.environment=handoff.environment
        and child.task_id=handoff.child_task_id
      where handoff.app_id=authority.app_id and handoff.tenant_id=authority.tenant_id
        and handoff.environment=authority.environment and handoff.run_id=requested_run_id
        and (handoff.handoff_id<>(handoff.handoff_json#>>'{child_task,parent_handoff_id}')::uuid
          or handoff.parent_task_id<>(handoff.handoff_json->>'parent_task_id')::uuid
          or handoff.child_task_id<>(handoff.handoff_json#>>'{child_task,task_id}')::uuid
          or handoff.parent_expected_revision<>
            (handoff.handoff_json->>'parent_expected_revision')::integer
          or handoff.handoff_json->'child_task'<>child.task_json))
    or exists(select 1 from app_data_agent.agent_team_context_epochs epoch
      where epoch.app_id=authority.app_id and epoch.tenant_id=authority.tenant_id
        and epoch.environment=authority.environment and epoch.run_id=requested_run_id
        and (epoch.document_hash<>app_data_agent.u2_canonical_sha256(epoch.epoch_json)
          or epoch.task_id<>(epoch.epoch_json#>>'{proposed_obligations,task_id}')::uuid
          or epoch.epoch_id<>(epoch.epoch_json#>>'{proposed_epoch,epoch_id}')::uuid
          or epoch.epoch_revision<>(epoch.epoch_json->>'revision')::integer
          or epoch.phase<>epoch.epoch_json->>'phase'
          or epoch.build_signature<>epoch.epoch_json#>>'{proposed_epoch,build_signature}'
          or epoch.obligation_ledger_hash<>
            epoch.epoch_json#>>'{proposed_obligations,ledger_hash}'))
    or exists(select 1 from app_data_agent.agent_team_verifier_decisions verifier
      where verifier.app_id=authority.app_id and verifier.tenant_id=authority.tenant_id
        and verifier.environment=authority.environment and verifier.run_id=requested_run_id
        and (verifier.decision_hash<>
            app_data_agent.u2_canonical_sha256(verifier.decision_json-'decision_hash')
          or verifier.task_id<>(verifier.decision_json->>'task_id')::uuid
          or verifier.task_revision<>(verifier.decision_json->>'task_revision')::integer
          or verifier.decision_id<>(verifier.decision_json->>'decision_id')::uuid
          or verifier.completion_hash<>verifier.decision_json->>'completion_hash'))
    or exists(select 1 from app_data_agent.agent_team_completion_receipts completion
      where completion.app_id=authority.app_id and completion.tenant_id=authority.tenant_id
        and completion.environment=authority.environment and completion.run_id=requested_run_id
        and (completion.completion_hash<>
            app_data_agent.u2_canonical_sha256(completion.receipt_json-'completion_hash')
          or completion.task_id<>(completion.receipt_json->>'task_id')::uuid
          or completion.task_revision<>(completion.receipt_json->>'task_revision')::integer
          or completion.completion_id<>(completion.receipt_json->>'completion_id')::uuid))
    or exists(select 1 from app_data_agent.agent_team_acceptance_receipts acceptance
      where acceptance.app_id=authority.app_id and acceptance.tenant_id=authority.tenant_id
        and acceptance.environment=authority.environment and acceptance.run_id=requested_run_id
        and (acceptance.acceptance_hash<>
            app_data_agent.u2_canonical_sha256(acceptance.receipt_json-'acceptance_hash')
          or acceptance.task_id<>(acceptance.receipt_json->>'task_id')::uuid
          or acceptance.task_revision<>(acceptance.receipt_json->>'task_revision')::integer
          or acceptance.completion_id<>(acceptance.receipt_json->>'completion_id')::uuid
          or acceptance.status<>acceptance.receipt_json->>'status'))
  then raise exception using errcode='55000',message='AGENT_TEAM_TRACE_CORRUPT'; end if;
  if not exists(select 1 from app_data_agent.agent_team_tasks task
    where task.app_id=authority.app_id and task.tenant_id=authority.tenant_id
      and task.environment=authority.environment and task.run_id=requested_run_id)
  then return null; end if;
  result:=pg_catalog.jsonb_build_object(
    'tasks',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'task_id',task.task_id,'parent_task_id',task.parent_task_id,'depth',task.depth,
      'profile_id',task.profile_id,'profile_revision',task.profile_revision,
      'profile_hash',task.profile_hash,'task_revision',task.task_revision,
      'attempt_id',task.task_attempt_id,'worker_fence',task.worker_fence,
      'status',case when acceptance.status='ACCEPTED' then 'ACCEPTED'
        when acceptance.status='REJECTED' then 'REJECTED'
        when completion.completion_id is not null then 'COMPLETED' else 'RUNNING' end,
      'created_at',pg_catalog.to_char(task.created_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by task.task_id)
      from app_data_agent.agent_team_tasks task
      left join lateral(select receipt.status from app_data_agent.agent_team_acceptance_receipts receipt
        where receipt.app_id=task.app_id and receipt.tenant_id=task.tenant_id
          and receipt.environment=task.environment and receipt.task_id=task.task_id
        order by receipt.created_at desc limit 1) acceptance on true
      left join lateral(select receipt.completion_id from app_data_agent.agent_team_completion_receipts receipt
        where receipt.app_id=task.app_id and receipt.tenant_id=task.tenant_id
          and receipt.environment=task.environment and receipt.task_id=task.task_id
        order by receipt.created_at desc limit 1) completion on true
      where task.app_id=authority.app_id and task.tenant_id=authority.tenant_id
        and task.environment=authority.environment and task.run_id=requested_run_id),'[]'::jsonb),
    'handoffs',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'handoff_id',handoff.handoff_id,'parent_task_id',handoff.parent_task_id,
      'child_task_id',handoff.child_task_id,'parent_expected_revision',handoff.parent_expected_revision,
      'request_hash',handoff.request_hash,'created_at',pg_catalog.to_char(handoff.created_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by handoff.handoff_id)
      from app_data_agent.agent_team_handoffs handoff where handoff.app_id=authority.app_id
        and handoff.tenant_id=authority.tenant_id and handoff.environment=authority.environment
        and handoff.run_id=requested_run_id),'[]'::jsonb),
    'epochs',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'task_id',epoch.task_id,'epoch_id',epoch.epoch_id,'epoch_revision',epoch.epoch_revision,
      'phase',epoch.phase,'build_signature',epoch.build_signature,
      'obligation_ledger_hash',epoch.obligation_ledger_hash,
      'created_at',pg_catalog.to_char(epoch.created_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by epoch.task_id,epoch.epoch_id,epoch.epoch_revision)
      from app_data_agent.agent_team_context_epochs epoch where epoch.app_id=authority.app_id
        and epoch.tenant_id=authority.tenant_id and epoch.environment=authority.environment
        and epoch.run_id=requested_run_id),'[]'::jsonb),
    'verifier_decisions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'task_id',verifier.task_id,'task_revision',verifier.task_revision,
      'decision_id',verifier.decision_id,'completion_hash',verifier.completion_hash,
      'decision_hash',verifier.decision_hash,'created_at',pg_catalog.to_char(verifier.created_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by verifier.decision_id)
      from app_data_agent.agent_team_verifier_decisions verifier where verifier.app_id=authority.app_id
        and verifier.tenant_id=authority.tenant_id and verifier.environment=authority.environment
        and verifier.run_id=requested_run_id),'[]'::jsonb));
  return result;
end
$function$;
