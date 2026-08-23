-- agent_team_trace_content_migration_checksum: sha256:d858b3ee13a3d984cd45a5e211fefdaecabae085c5a15d7831c15409eb0bd4bc
-- Content-first, owner-scoped Agent Team trace projection. The v1 RPC remains
-- available for older clients; v2 only exposes an allowlist from documents that
-- v1 has already closed over relational identity and canonical hashes.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'AGENT_TEAM_TRACE_CONTENT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'AGENT_TEAM_TRACE_CONTENT_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger
    where owner_kind = 'app'
      and app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version = '20260725010696_app_data_agent_model_driven_subagent_harness'
  ) then
    raise exception using errcode = 'P0001', message = 'AGENT_TEAM_TRACE_CONTENT_BASELINE_10696_MISSING';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';
select platform.acquire_migration_lock(
  'app', '00000000-0000-4000-8000-00000000da01'::uuid
);

create function app_data_agent.load_agent_team_public_projection_v2(requested_run_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  authority record;
  verified_v1 jsonb;
begin
  verified_v1 := app_data_agent.load_agent_team_public_projection(requested_run_id);
  if verified_v1 is null then
    return null;
  end if;
  select * into authority from platform.current_backend_authority(false);

  return pg_catalog.jsonb_build_object(
    'tasks', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'task_id', task.task_id,
          'parent_task_id', task.parent_task_id,
          'depth', task.depth,
          'profile_id', task.profile_id,
          'profile_revision', task.profile_revision,
          'profile_hash', task.profile_hash,
          'task_revision', task.task_revision,
          'attempt_id', task.task_attempt_id,
          'worker_fence', task.worker_fence,
          'status', case
            when acceptance.status = 'ACCEPTED' then 'ACCEPTED'
            when acceptance.status = 'REJECTED' then 'REJECTED'
            when completion.completion_id is not null then 'COMPLETED'
            else 'RUNNING'
          end,
          'created_at', pg_catalog.to_char(
            task.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'goal_revision', (task.task_json ->> 'goal_revision')::integer,
          'bounds', task.task_json -> 'bounds',
          'required_artifact_types', task.task_json #> '{acceptance,required_artifact_types}',
          'artifact_refs', task.task_json -> 'artifact_refs',
          'context_epoch_ref', task.task_json -> 'context_epoch_ref',
          'completion', case when completion.receipt_json is null then 'null'::jsonb else
            pg_catalog.jsonb_build_object(
              'output_ref', completion.receipt_json -> 'output_ref',
              'completed_at', completion.receipt_json -> 'completed_at'
            ) end,
          'acceptance', case when acceptance.receipt_json is null then 'null'::jsonb else
            pg_catalog.jsonb_build_object(
              'status', acceptance.receipt_json -> 'status',
              'reason', acceptance.receipt_json -> 'reason',
              'accepted_at', acceptance.receipt_json -> 'accepted_at'
            ) end
        ) order by task.task_id
      )
      from app_data_agent.agent_team_tasks task
      left join lateral (
        select receipt.completion_id, receipt.receipt_json
        from app_data_agent.agent_team_completion_receipts receipt
        where receipt.app_id = task.app_id
          and receipt.tenant_id = task.tenant_id
          and receipt.environment = task.environment
          and receipt.task_id = task.task_id
        order by receipt.created_at desc
        limit 1
      ) completion on true
      left join lateral (
        select receipt.status, receipt.receipt_json
        from app_data_agent.agent_team_acceptance_receipts receipt
        where receipt.app_id = task.app_id
          and receipt.tenant_id = task.tenant_id
          and receipt.environment = task.environment
          and receipt.task_id = task.task_id
        order by receipt.created_at desc
        limit 1
      ) acceptance on true
      where task.app_id = authority.app_id
        and task.tenant_id = authority.tenant_id
        and task.environment = authority.environment
        and task.run_id = requested_run_id
    ), '[]'::jsonb),
    'handoffs', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'handoff_id', handoff.handoff_id,
          'parent_task_id', handoff.parent_task_id,
          'child_task_id', handoff.child_task_id,
          'parent_expected_revision', handoff.parent_expected_revision,
          'request_hash', handoff.request_hash,
          'created_at', pg_catalog.to_char(
            handoff.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'child_required_artifact_types',
            handoff.handoff_json #> '{child_task,acceptance,required_artifact_types}',
          'child_bounds', handoff.handoff_json #> '{child_task,bounds}'
        ) order by handoff.handoff_id
      )
      from app_data_agent.agent_team_handoffs handoff
      where handoff.app_id = authority.app_id
        and handoff.tenant_id = authority.tenant_id
        and handoff.environment = authority.environment
        and handoff.run_id = requested_run_id
    ), '[]'::jsonb),
    'epochs', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'task_id', epoch.task_id,
          'epoch_id', epoch.epoch_id,
          'epoch_revision', epoch.epoch_revision,
          'phase', epoch.phase,
          'build_signature', epoch.build_signature,
          'obligation_ledger_hash', epoch.obligation_ledger_hash,
          'created_at', pg_catalog.to_char(
            epoch.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'obligation_counts', pg_catalog.jsonb_build_object(
            'total', pg_catalog.jsonb_array_length(epoch.epoch_json #> '{proposed_obligations,obligations}'),
            'open', (
              select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(
                epoch.epoch_json #> '{proposed_obligations,obligations}'
              ) obligation where obligation ->> 'status' = 'OPEN'
            ),
            'unknown', (
              select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(
                epoch.epoch_json #> '{proposed_obligations,obligations}'
              ) obligation where obligation ->> 'status' = 'UNKNOWN'
            ),
            'resolved', (
              select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(
                epoch.epoch_json #> '{proposed_obligations,obligations}'
              ) obligation where obligation ->> 'status' = 'RESOLVED'
            )
          )
        ) order by epoch.task_id, epoch.epoch_id, epoch.epoch_revision
      )
      from app_data_agent.agent_team_context_epochs epoch
      where epoch.app_id = authority.app_id
        and epoch.tenant_id = authority.tenant_id
        and epoch.environment = authority.environment
        and epoch.run_id = requested_run_id
    ), '[]'::jsonb),
    'verifier_decisions', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'task_id', verifier.task_id,
          'task_revision', verifier.task_revision,
          'decision_id', verifier.decision_id,
          'completion_hash', verifier.completion_hash,
          'decision_hash', verifier.decision_hash,
          'created_at', pg_catalog.to_char(
            verifier.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
          ),
          'dimensions', pg_catalog.jsonb_build_object(
            'schema_valid', verifier.decision_json -> 'schema_valid',
            'scope_valid', verifier.decision_json -> 'scope_valid',
            'policy_valid', verifier.decision_json -> 'policy_valid',
            'provenance_valid', verifier.decision_json -> 'provenance_valid',
            'execution_valid', verifier.decision_json -> 'execution_valid',
            'intent_grounded', verifier.decision_json -> 'intent_grounded',
            'oracle_verified', verifier.decision_json -> 'oracle_verified'
          ),
          'semantic_status', verifier.decision_json -> 'semantic_status',
          'decided_at', verifier.decision_json -> 'decided_at',
          'acceptance', case when acceptance.receipt_json is null then 'null'::jsonb else
            pg_catalog.jsonb_build_object(
              'status', acceptance.receipt_json -> 'status',
              'reason', acceptance.receipt_json -> 'reason',
              'accepted_at', acceptance.receipt_json -> 'accepted_at'
            ) end
        ) order by verifier.decision_id
      )
      from app_data_agent.agent_team_verifier_decisions verifier
      left join lateral (
        select receipt.receipt_json
        from app_data_agent.agent_team_acceptance_receipts receipt
        where receipt.app_id = verifier.app_id
          and receipt.tenant_id = verifier.tenant_id
          and receipt.environment = verifier.environment
          and receipt.task_id = verifier.task_id
          and receipt.task_revision = verifier.task_revision
          and receipt.receipt_json ->> 'verifier_decision_id' = verifier.decision_id::text
        order by receipt.created_at desc
        limit 1
      ) acceptance on true
      where verifier.app_id = authority.app_id
        and verifier.tenant_id = authority.tenant_id
        and verifier.environment = authority.environment
        and verifier.run_id = requested_run_id
    ), '[]'::jsonb)
  );
end
$function$;

alter function app_data_agent.load_agent_team_public_projection_v2(uuid)
  owner to data_agent_u19_team_owner;
revoke all on function app_data_agent.load_agent_team_public_projection_v2(uuid) from public;
grant execute on function app_data_agent.load_agent_team_public_projection_v2(uuid)
  to data_agent_backend;

do $postconditions$
begin
  if pg_catalog.to_regprocedure(
    'app_data_agent.load_agent_team_public_projection_v2(uuid)'
  ) is null
    or not pg_catalog.has_function_privilege(
      'data_agent_backend',
      'app_data_agent.load_agent_team_public_projection_v2(uuid)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'public',
      'app_data_agent.load_agent_team_public_projection_v2(uuid)',
      'EXECUTE'
    )
  then
    raise exception using errcode = 'P0001', message = 'AGENT_TEAM_TRACE_CONTENT_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010697_app_data_agent_agent_team_trace_content',
  'sha256:d858b3ee13a3d984cd45a5e211fefdaecabae085c5a15d7831c15409eb0bd4bc'
);

commit;
