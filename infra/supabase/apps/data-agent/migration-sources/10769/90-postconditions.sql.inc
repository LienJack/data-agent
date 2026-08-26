do $postconditions$
declare claim_definition text; hold_definition text; acceptance_definition text;
  stage_definition text; record_definition text; complete_definition text;
  reclamation_claim_definition text; execution_policy_definition text;
  pending_failure_definition text; run_work_definition text; attempt_limit_definition text;
  provider_lease_definition text;
  lifecycle_constraint text; binding_constraint text;
begin
  select procedure.prosrc into strict claim_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.claim_falcon24_acceptance_run(jsonb)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict hold_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.hold_falcon24_acceptance_campaign(jsonb)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict acceptance_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.accept_falcon24_question_run_with_effective_config(jsonb,jsonb,jsonb)'
        ::pg_catalog.regprocedure;
  select procedure.prosrc into strict stage_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.stage_falcon24_acceptance_trace(jsonb)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict record_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.record_falcon24_sandbox_reclamation(jsonb)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict complete_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.complete_falcon24_acceptance_run(jsonb)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict reclamation_claim_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.claim_falcon24_sandbox_reclamation(jsonb)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict execution_policy_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.resolve_falcon24_run_execution_policy(uuid)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict pending_failure_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.load_falcon24_pending_failed_run()'::pg_catalog.regprocedure;
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict run_work_definition
    from pg_catalog.pg_proc procedure where procedure.oid=
      'app_data_agent.claim_run_work(text,integer,integer)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict attempt_limit_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.resolve_run_delivery_attempt_limit(uuid)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict provider_lease_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.assert_provider_active_worker_lease(jsonb)'::pg_catalog.regprocedure;
  select pg_catalog.pg_get_constraintdef(constraint_row.oid) into strict lifecycle_constraint
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid=
      'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
      and constraint_row.conname='falcon24_acceptance_campaign_runs_check';
  select pg_catalog.pg_get_constraintdef(constraint_row.oid) into strict binding_constraint
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid=
      'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
      and constraint_row.conname=
        'falcon24_acceptance_campaign_runs_trace_gate_binding_check';

  if not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='claim_fence_hash'
        and attribute.atttypid='text'::pg_catalog.regtype and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='claim_fence_consumed_at'
        and attribute.atttypid='timestamptz'::pg_catalog.regtype and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='trace_gate_receipt_hash'
        and attribute.atttypid='text'::pg_catalog.regtype and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='trace_gate_receipt'
        and attribute.atttypid='jsonb'::pg_catalog.regtype and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='sandbox_reclamation_recovery_hash'
        and attribute.atttypid='text'::pg_catalog.regtype and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='sandbox_reclamation_claim_hash'
        and attribute.atttypid='text'::pg_catalog.regtype and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='sandbox_reclamation_claimed_at'
        and attribute.atttypid='timestamptz'::pg_catalog.regtype and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='sandbox_reclamation_claim_expires_at'
        and attribute.atttypid='timestamptz'::pg_catalog.regtype and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='sandbox_reclamation_claim_consumed_at'
        and attribute.atttypid='timestamptz'::pg_catalog.regtype and not attribute.attisdropped)
    or pg_catalog.strpos(lifecycle_constraint,'claim_fence_hash')=0
    or pg_catalog.strpos(lifecycle_constraint,'claim_fence_consumed_at')=0
    or pg_catalog.strpos(lifecycle_constraint,'trace_gate_receipt_hash')=0
    or pg_catalog.strpos(lifecycle_constraint,'sandbox_reclamation_recovery_hash')=0
    or pg_catalog.strpos(lifecycle_constraint,'sandbox_reclamation_claim_hash')=0
    or pg_catalog.strpos(lifecycle_constraint,'sandbox_reclamation_claimed_at')=0
    or pg_catalog.strpos(lifecycle_constraint,'sandbox_reclamation_claim_expires_at')=0
    or pg_catalog.strpos(lifecycle_constraint,'sandbox_reclamation_claim_consumed_at')=0
    or pg_catalog.strpos(lifecycle_constraint,'status <> ''VERIFIED''')=0
    or pg_catalog.strpos(binding_constraint,'u2_canonical_sha256')=0
  then raise exception using errcode='P0001',message='FALCON24_TRACE_GATE_COLUMNS_OR_CHECKS_DRIFT'; end if;

  if pg_catalog.strpos(claim_definition,'falcon24-acceptance-run-claim@2.0.0')=0
    or pg_catalog.strpos(claim_definition,'falcon24-acceptance-run-claim@1.0.0')>0
    or pg_catalog.strpos(claim_definition,'claim_fence_hash=fence_hash')=0
    or pg_catalog.strpos(hold_definition,'falcon24-acceptance-campaign-hold@2.0.0')=0
    or pg_catalog.strpos(hold_definition,'falcon24-acceptance-campaign-hold@1.0.0')>0
    or pg_catalog.strpos(hold_definition,'campaign_run.status not in(''PLANNED'',''CLAIMED'')')=0
    or pg_catalog.strpos(hold_definition,
      'campaign_run.status=''PLANNED'' and command->>''failure_layer''<>''ROOT_ROUTING''')=0
    or pg_catalog.strpos(hold_definition,'if campaign_run.status=''CLAIMED'' then')=0
    or pg_catalog.strpos(hold_definition,'FALCON24_SUBMIT_FENCE_REQUIRED')=0
    or pg_catalog.strpos(hold_definition,'FALCON24_ACTUAL_RUN_NOT_TERMINAL')=0
    or pg_catalog.strpos(hold_definition,
      'actual_run_status not in(''SUCCEEDED'',''FAILED'',''CANCELLED'')')=0
    or pg_catalog.strpos(hold_definition,'FALCON24_RUN_ACCEPTED_RECOVERY_REQUIRED')>0
    or pg_catalog.strpos(acceptance_definition,
      'falcon24-question-run-acceptance@1.0.0')=0
    or pg_catalog.strpos(acceptance_definition,
      'accept_question_run_with_effective_config')=0
    or pg_catalog.strpos(acceptance_definition,'FALCON24_SUBMIT_RUN_PREEXISTS')=0
    or pg_catalog.strpos(acceptance_definition,'workspace_run_bindings')=0
    or pg_catalog.strpos(acceptance_definition,'effective_run_config_receipts')=0
    or pg_catalog.strpos(acceptance_definition,'actual.xmin')>0
    or pg_catalog.strpos(acceptance_definition,'binding.xmin')>0
    or pg_catalog.strpos(acceptance_definition,'pg_xact_status')>0
    or pg_catalog.strpos(acceptance_definition,'claim_fence_consumed_at=now_at')=0
    or pg_catalog.strpos(acceptance_definition,
      '''claim_fence_consumed_at'',campaign_run.claim_fence_consumed_at')=0
    or pg_catalog.strpos(stage_definition,
      'falcon24-resolution-trace-gate-receipt@1.0.0')=0
    or pg_catalog.strpos(stage_definition,'FALCON24_TRACE_STAGE_REPLAY_MISMATCH')=0
    or pg_catalog.strpos(stage_definition,'FALCON24_SUBMIT_FENCE_REQUIRED')=0
    or pg_catalog.strpos(stage_definition,'u2_canonical_sha256(receipt-''receipt_hash'')')=0
    or pg_catalog.strpos(record_definition,'FALCON24_TRACE_STAGE_REQUIRED')=0
    or pg_catalog.strpos(record_definition,'FALCON24_SUBMIT_FENCE_REQUIRED')=0
    or pg_catalog.strpos(record_definition,'reclamation_claim_token')=0
    or pg_catalog.strpos(record_definition,'FALCON24_SANDBOX_RECLAMATION_CLAIM_REQUIRED')=0
    or pg_catalog.strpos(record_definition,'FALCON24_SANDBOX_RECLAMATION_CLAIM_MISMATCH')=0
    or pg_catalog.strpos(record_definition,'sandbox_reclamation_claim_consumed_at')=0
    or pg_catalog.strpos(complete_definition,'falcon24-acceptance-run-complete@2.0.0')=0
    or pg_catalog.strpos(complete_definition,'falcon24-acceptance-run-complete@1.0.0')>0
    or pg_catalog.strpos(complete_definition,'command->>''trace_closure_hash''')>0
    or pg_catalog.strpos(complete_definition,'FALCON24_TRACE_STAGE_REQUIRED')=0
    or pg_catalog.strpos(complete_definition,'FALCON24_SUBMIT_FENCE_REQUIRED')=0
    or pg_catalog.strpos(reclamation_claim_definition,
      'falcon24-sandbox-reclamation-claim@1.0.0')=0
    or pg_catalog.strpos(reclamation_claim_definition,
      'platform.current_backend_authority(true)')=0
    or pg_catalog.strpos(reclamation_claim_definition,'for update')=0
    or pg_catalog.strpos(reclamation_claim_definition,'run.status=''SUCCEEDED''')=0
    or pg_catalog.strpos(reclamation_claim_definition,
      'FALCON24_SANDBOX_RECLAMATION_ALREADY_CLAIMED')=0
    or pg_catalog.strpos(reclamation_claim_definition,
      'FALCON24_SANDBOX_RECLAMATION_REPLAY_MISMATCH')=0
    or pg_catalog.strpos(reclamation_claim_definition,
      'sandbox_reclamation_recovery_hash<>reclamation_recovery_hash')=0
    or pg_catalog.strpos(reclamation_claim_definition,
      'sandbox_reclamation_recovery_hash is distinct from')=0
    or pg_catalog.strpos(reclamation_claim_definition,
      'sandbox_reclamation_claim_expires_at<=now_at')=0
    or pg_catalog.strpos(reclamation_claim_definition,
      'sandbox_reclamation_claim_hash=reclamation_claim_hash')=0
    or pg_catalog.strpos(execution_policy_definition,
      'platform.current_backend_authority(false)')=0
    or pg_catalog.strpos(execution_policy_definition,
      'campaign_run.run_id=requested_run_id')=0
    or pg_catalog.strpos(execution_policy_definition,
      '''policy_id'',campaign.policy_id')=0
    or pg_catalog.strpos(execution_policy_definition,
      '''max_run_attempts'',1')=0
    or pg_catalog.strpos(execution_policy_definition,
      '''hold_on_failure'',true')=0
    or pg_catalog.strpos(pending_failure_definition,'campaign.status=''RUNNING''')=0
    or pg_catalog.strpos(pending_failure_definition,'campaign_run.status=''CLAIMED''')=0
    or pg_catalog.strpos(pending_failure_definition,'run.status=''FAILED''')=0
    or pg_catalog.strpos(pending_failure_definition,'campaign.next_run_ordinal')=0
    or pg_catalog.strpos(pending_failure_definition,'FALCON24_PENDING_FAILED_RUN_AMBIGUOUS')=0
    or pg_catalog.strpos(run_work_definition,'message.attempt_count >= 5')>0
    or pg_catalog.strpos(run_work_definition,'message.attempt_count < 5')>0
    or pg_catalog.strpos(run_work_definition,'candidate.attempt_count >= 5')>0
    or pg_catalog.strpos(run_work_definition,
      'resolve_run_delivery_attempt_limit(message.run_id)')=0
    or pg_catalog.strpos(run_work_definition,
      'resolve_run_delivery_attempt_limit(candidate.run_id)')=0
    or pg_catalog.strpos(attempt_limit_definition,
      'resolve_falcon24_run_execution_policy(requested_run_id)')=0
    or pg_catalog.strpos(attempt_limit_definition,'RUN_EXECUTION_POLICY_CORRUPT')=0
    or pg_catalog.strpos(provider_lease_definition,'''execution_policy''')=0
    or pg_catalog.strpos(provider_lease_definition,
      'resolve_falcon24_run_execution_policy(requested_run_id)')=0
    or pg_catalog.strpos(provider_lease_definition,'''START_DATA_AGENT_TEAM''')=0
    or pg_catalog.strpos(provider_lease_definition,'''START_L2_RESEARCH''')=0
    or pg_catalog.strpos(provider_lease_definition,'command_payload_is_valid')=0
    or pg_catalog.strpos(provider_lease_definition,'RUN_EXECUTION_POLICY_CORRUPT')=0
    or pg_catalog.strpos(provider_lease_definition,'lock_owned_run_fence')=0
    or pg_catalog.strpos(provider_lease_definition,'assert_provider_active_worker_lease_pre_u20')>0
  then raise exception using errcode='P0001',message='FALCON24_TRACE_GATE_FUNCTION_DEFINITION_DRIFT'; end if;

  if pg_catalog.to_regprocedure(
      'app_data_agent.assert_provider_active_worker_lease_pre_u20(jsonb)') is not null
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='assert_provider_active_worker_lease')<>1
  then raise exception using errcode='P0001',message='PROVIDER_WORKER_LEASE_COMPATIBILITY_GATE_REMAINS'; end if;

  if exists(select 1 from pg_catalog.pg_proc procedure
      where procedure.oid in(
        'app_data_agent.claim_falcon24_acceptance_run(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.hold_falcon24_acceptance_campaign(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.accept_falcon24_question_run_with_effective_config(jsonb,jsonb,jsonb)'
          ::pg_catalog.regprocedure,
        'app_data_agent.stage_falcon24_acceptance_trace(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.load_falcon24_acceptance_campaign(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.resolve_falcon24_run_execution_policy(uuid)'::pg_catalog.regprocedure,
        'app_data_agent.load_falcon24_pending_failed_run()'::pg_catalog.regprocedure,
        'app_data_agent.resolve_run_delivery_attempt_limit(uuid)'::pg_catalog.regprocedure,
        'app_data_agent.load_falcon24_acceptance_campaign_run(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.load_falcon24_acceptance_trace_gate(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.claim_falcon24_sandbox_reclamation(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.record_falcon24_sandbox_reclamation(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.complete_falcon24_acceptance_run(jsonb)'::pg_catalog.regprocedure)
        and (pg_catalog.pg_get_userbyid(procedure.proowner)<>'data_agent_u6_rpc_owner'
          or not procedure.prosecdef
          or not procedure.proconfig@>array['search_path=""']::text[]))
  then raise exception using errcode='P0001',message='FALCON24_TRACE_GATE_FUNCTION_SECURITY_DRIFT'; end if;

  if exists(select 1 from pg_catalog.pg_proc procedure
      where procedure.oid=
        'app_data_agent.assert_provider_active_worker_lease(jsonb)'::pg_catalog.regprocedure
        and (pg_catalog.pg_get_userbyid(procedure.proowner)<>
            'data_agent_provider_invocation_rpc_owner'
          or not procedure.prosecdef
          or not procedure.proconfig@>array['search_path=""']::text[]))
  then raise exception using errcode='P0001',message='PROVIDER_WORKER_LEASE_FUNCTION_SECURITY_DRIFT'; end if;

  if not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.claim_falcon24_acceptance_run(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.hold_falcon24_acceptance_campaign(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.accept_falcon24_question_run_with_effective_config(jsonb,jsonb,jsonb)',
      'EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.stage_falcon24_acceptance_trace(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_falcon24_acceptance_campaign(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.resolve_falcon24_run_execution_policy(uuid)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_falcon24_pending_failed_run()','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.resolve_run_delivery_attempt_limit(uuid)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_falcon24_acceptance_campaign_run(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_falcon24_acceptance_trace_gate(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.claim_falcon24_sandbox_reclamation(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.record_falcon24_sandbox_reclamation(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.complete_falcon24_acceptance_run(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_provider_invocation_rpc_owner',
      'app_data_agent.resolve_falcon24_run_execution_policy(uuid)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_u19_team_owner',
      'app_data_agent.assert_provider_active_worker_lease(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.assert_provider_active_worker_lease(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.assert_provider_active_worker_lease(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.claim_falcon24_acceptance_run(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.hold_falcon24_acceptance_campaign(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.accept_falcon24_question_run_with_effective_config(jsonb,jsonb,jsonb)',
      'EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.stage_falcon24_acceptance_trace(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.load_falcon24_acceptance_campaign(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.resolve_falcon24_run_execution_policy(uuid)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.load_falcon24_pending_failed_run()','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.resolve_run_delivery_attempt_limit(uuid)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.load_falcon24_acceptance_campaign_run(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.load_falcon24_acceptance_trace_gate(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.claim_falcon24_sandbox_reclamation(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.record_falcon24_sandbox_reclamation(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.complete_falcon24_acceptance_run(jsonb)','EXECUTE')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_acceptance_campaigns','SELECT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_acceptance_campaign_runs','SELECT')
  then raise exception using errcode='P0001',message='FALCON24_TRACE_GATE_GRANT_DRIFT'; end if;

  if not pg_catalog.has_table_privilege('data_agent_u6_rpc_owner',
      'app_data_agent.workspace_run_bindings','SELECT')
    or not pg_catalog.has_table_privilege('data_agent_u6_rpc_owner',
      'app_data_agent.effective_run_config_receipts','SELECT')
    or not pg_catalog.has_function_privilege('data_agent_u6_rpc_owner',
      'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)','EXECUTE')
    or not exists(select 1 from pg_catalog.pg_policies
      where schemaname='app_data_agent' and tablename='workspace_run_bindings'
        and policyname='falcon24_acceptance_submit_fence_binding_select'
        and cmd='SELECT' and roles='{data_agent_u6_rpc_owner}'
        and pg_catalog.strpos(qual,'backend_context_matches')>0
        and pg_catalog.strpos(qual,'principal_id')>0)
    or not exists(select 1 from pg_catalog.pg_policies
      where schemaname='app_data_agent' and tablename='effective_run_config_receipts'
        and policyname='falcon24_acceptance_submit_fence_config_select'
        and cmd='SELECT' and roles='{data_agent_u6_rpc_owner}'
        and pg_catalog.strpos(qual,'backend_context_matches')>0
        and pg_catalog.strpos(qual,'principal_id')>0)
  then raise exception using errcode='P0001',message='FALCON24_SUBMIT_FENCE_BINDING_AUTHORITY_DRIFT'; end if;

  if not pg_catalog.has_table_privilege('data_agent_provider_invocation_rpc_owner',
      'app_data_agent.commands','SELECT')
    or not exists(select 1 from pg_catalog.pg_policies
      where schemaname='app_data_agent' and tablename='commands'
        and policyname='falcon24_provider_worker_lease_commands_select'
        and cmd='SELECT' and roles='{data_agent_provider_invocation_rpc_owner}'
        and pg_catalog.strpos(qual,'backend_run_object_matches')>0)
  then raise exception using errcode='P0001',message='PROVIDER_WORKER_LEASE_COMMAND_AUTHORITY_DRIFT'; end if;

  if pg_catalog.to_regprocedure(
      'app_data_agent.complete_falcon24_acceptance_run_v1(jsonb)') is not null
    or pg_catalog.to_regprocedure(
      'app_data_agent.complete_falcon24_acceptance_run_v2(jsonb)') is not null
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='complete_falcon24_acceptance_run')<>1
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='claim_falcon24_acceptance_run')<>1
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='hold_falcon24_acceptance_campaign')<>1
    or pg_catalog.to_regprocedure(
      'app_data_agent.consume_falcon24_acceptance_submit_fence(jsonb)') is not null
    or pg_catalog.to_regprocedure(
      'app_data_agent.authorize_falcon24_sandbox_reclamation(jsonb)') is not null
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='accept_falcon24_question_run_with_effective_config')<>1
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='claim_falcon24_sandbox_reclamation')<>1
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='resolve_falcon24_run_execution_policy')<>1
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='load_falcon24_pending_failed_run')<>1
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='resolve_run_delivery_attempt_limit')<>1
  then raise exception using errcode='P0001',message='FALCON24_TRACE_GATE_COMPATIBILITY_RPC_REMAINS'; end if;
end
$postconditions$;
