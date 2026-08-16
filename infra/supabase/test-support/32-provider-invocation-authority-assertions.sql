\set ON_ERROR_STOP on

begin isolation level repeatable read read only;
do $surface$
declare
  relation_name text;
  function_name text;
  function_definition text;
  begin_definition text;
  terminal_definition text;
  dispatch_definition text;
  response_observed_definition text;
  reconcile_definition text;
  load_definition text;
  profile_list_definition text;
  lease_definition text;
  task_commit_definition text;
  stale_recovery_definition text;
  next_stale_recovery_definition text;
  smoke_claim_definition text;
  smoke_proof_definition text;
  unknown_classification_definition text;
  resolve_authority_definition text;
  revalidate_authority_definition text;
begin
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010654_app_data_agent_provider_invocation_authority'
  ) then
    raise exception 'PROVIDER_INVOCATION_LEDGER_ASSERTION_FAILED';
  end if;

  foreach relation_name in array array[
    'provider_invocation_intents',
    'provider_invocation_dispatch_permits',
    'provider_invocation_outcomes',
    'provider_invocation_usage_receipts'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app_data_agent'
        and relation.relname = relation_name
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend',pg_catalog.format('app_data_agent.%I',relation_name),
      'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception 'PROVIDER_INVOCATION_RELATION_SURFACE_ASSERTION_FAILED:%',relation_name;
    end if;
  end loop;

  select pg_catalog.pg_get_functiondef(procedure.oid) into strict begin_definition
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'begin_provider_invocation';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict terminal_definition
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'commit_provider_invocation_worker_transition_internal';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict dispatch_definition
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'mark_provider_invocation_dispatched';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict response_observed_definition
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'mark_provider_invocation_response_observed';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict reconcile_definition
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'reconcile_provider_invocation_unknown';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict load_definition
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'load_provider_invocation';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict profile_list_definition
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'list_provider_execution_profiles';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict lease_definition
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'assert_provider_active_worker_lease';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict task_commit_definition
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'commit_provider_task_artifact';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict stale_recovery_definition
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'recover_stale_provider_invocation_marker';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict next_stale_recovery_definition
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'recover_next_stale_provider_invocation_marker';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict smoke_claim_definition
  from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'claim_provider_invocation_smoke_work';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict smoke_proof_definition
  from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'verify_provider_invocation_smoke_completion';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict unknown_classification_definition
  from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'app_data_agent'
    and procedure.proname = 'discover_next_provider_invocation_unknown';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict resolve_authority_definition
  from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'platform' and procedure.proname = 'resolve_backend_authority';
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict revalidate_authority_definition
  from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'platform' and procedure.proname = 'revalidate_backend_authority';
  if begin_definition not like '%PROVIDER_BEGIN_RESULT_CLOSURE_INVALID%'
    or begin_definition not like '%agent-data-projection@2.0.0%'
    or begin_definition not like '%utf8-byte-upper-bound@1.0.0%'
    or begin_definition not like '%trusted_input_token_upper_bound%'
    or begin_definition like '%trusted_actual_input_tokens%'
    or begin_definition not like '%''admission'',''TERMINAL_REPLAY''%'
    or begin_definition not like '%''original_permit'',existing_permit.permit_json%'
    or begin_definition not like '%PROVIDER_TERMINAL_REPLAY_CLOSURE_INVALID%'
    or begin_definition not like
      '%app_data_agent.u2_canonical_sha256(projection_record.document_json - ''receipt_hash''%'
    or begin_definition not like '%certification_record.document_json #- ''{receipt_ref,content_hash}''%'
    or terminal_definition not like '%PROVIDER_TERMINAL_RESULT_CLOSURE_INVALID%'
    or terminal_definition !~ '''intent'',intent_record.intent_json,''permit'',permit_record.permit_json'
    or dispatch_definition not like '%''intent'',intent_record.intent_json%'
    or dispatch_definition not like '%''permit'',permit_record.permit_json%'
    or response_observed_definition not like
      '%''dispatch_hash'',''attempt_id'',''worker_fence'',''state'',''observation_kind''%'
    or response_observed_definition not like
      '%existing_marker.outcome_json ->> ''attempt_id'' <> permit_record.attempt_id::text%'
    or response_observed_definition not like
      '%existing_marker.outcome_json ->> ''worker_fence'' <> permit_record.worker_fence::text%'
    or terminal_definition not like '%ProviderResponseArtifact%'
    or reconcile_definition not like '%response_document%'
    or reconcile_definition not like '%insert into app_data_agent.artifacts%'
    or reconcile_definition not like '%PROVIDER_RECONCILIATION_NOT_AUTHORIZED%'
    or reconcile_definition not like '%ProviderReconciliationEvidence%'
    or reconcile_definition not like '%PROVIDER_RECONCILIATION_RESULT_CLOSURE_INVALID%'
    or reconcile_definition !~ '''intent'',intent_record.intent_json,''permit'',permit_record.permit_json'
    or reconcile_definition not like '%''response_artifact_ref''%'
    or load_definition not like '%PROVIDER_LOAD_RESULT_CLOSURE_INVALID%'
    or load_definition not like '%''permit_id'',''permit_hash''%'
    or load_definition not like '%''dispatch_hash'',''attempt_id'',''worker_fence''%'
    or load_definition not like '%return ''null''::jsonb%'
    or load_definition not like '%''permit'',permit_record.permit_json%'
    or profile_list_definition not like '%provider-execution-profile-list@1.0.0%'
    or profile_list_definition not like '%MODEL_CERTIFICATION_REQUIRED%'
    or profile_list_definition not like '%MODEL_CREDENTIAL_UNAVAILABLE%'
    or profile_list_definition not like
      '%certification.document_json -> ''recovery_capabilities'' <>%'
    or profile_list_definition not like '%["AT_LEAST_ONCE_ONLY"]%'
    or profile_list_definition not like '%profile.provider <> ''deepseek''%'
    or profile_list_definition not like
      '%{connection,kind}'' <> ''SYSTEM_DEPLOYMENT''%'
    or profile_list_definition not like '%mapping.deployment_id = authority.deployment_id%'
    or begin_definition not like
      '%recovery_capabilities <> array[''AT_LEAST_ONCE_ONLY'']::text[]%'
    or begin_definition not like '%config_record.provider <> ''deepseek''%'
    or begin_definition not like
      '%{connection,kind}'' <> ''SYSTEM_DEPLOYMENT''%'
    or begin_definition not like
      '%deployment.deployment_id = (lease_authority ->> ''deployment_id'')::uuid%'
    or begin_definition not like '%PROVIDER_PROFILE_NOT_AVAILABLE%'
    or begin_definition not like '%PROVIDER_CONTEXT_WINDOW_UNVERIFIED%'
    or begin_definition not like '%PROVIDER_CONTEXT_LIMIT_EXCEEDED%'
    or begin_definition not like '%PROVIDER_OUTPUT_LIMIT_EXCEEDED%'
    or begin_definition not like '%PROVIDER_CALL_LIMIT_EXCEEDED%'
    or pg_catalog.strpos(
      begin_definition,
      'recovery_capabilities <> array[''AT_LEAST_ONCE_ONLY'']::text[]'
    ) >= pg_catalog.strpos(
      begin_definition,
      'insert into app_data_agent.provider_invocation_dispatch_permits'
    )
    or pg_catalog.strpos(begin_definition,'if rejection_reason is not null then') = 0
    or profile_list_definition not like
      '%app_data_agent.u2_canonical_sha256(artifact.document_json #- ''{receipt_ref,content_hash}'')%'
    or lease_definition not like '%attempt.lease_expires_at > pg_catalog.clock_timestamp()%'
    or lease_definition not like '%message.lease_expires_at > pg_catalog.clock_timestamp()%'
    or task_commit_definition not like '%ProviderTaskArtifact%'
    or task_commit_definition not like '%event.event_type = ''run.accepted''%'
    or task_commit_definition not like '%message.message_id = event.event_id%'
    or task_commit_definition not like '%assert_provider_active_worker_lease%'
    or stale_recovery_definition not like '%PROVIDER_STALE_MARKER_LEASE_STILL_ACTIVE%'
    or stale_recovery_definition not like '%ProviderStaleMarkerRecoveryReceipt%'
    or stale_recovery_definition not like '%STALE_MARKER_RECOVERY_JOB%'
    or next_stale_recovery_definition not like '%for update of marker skip locked%'
    or next_stale_recovery_definition not like '%order by marker.committed_at,marker.outcome_id%'
    or next_stale_recovery_definition not like
      '%recover_stale_provider_invocation_marker(command)%'
    or next_stale_recovery_definition not like
      '%PROVIDER_STALE_MARKER_RECOVERY_RESULT_CLOSURE_INVALID%'
    or next_stale_recovery_definition not like '%return null%'
    or smoke_claim_definition not like '%message.run_id = expected_run_id%'
    or smoke_claim_definition not like '%message.command_id = expected_command_id%'
    or smoke_claim_definition not like '%for update of message,run,command skip locked%'
    or smoke_claim_definition like '%claim_run_work%'
    or smoke_claim_definition not like '%PROVIDER_SMOKE_PRECONDITION_NOT_EMPTY%'
    or smoke_proof_definition not like '%deepseek-v4-flash%'
    or smoke_proof_definition not like '%PROVIDER_SMOKE_PROOF_NOT_READY%'
    or unknown_classification_definition not like '%for share of outcome skip locked%'
    or unknown_classification_definition not like '%AT_LEAST_ONCE_ONLY%'
    or unknown_classification_definition not like '%MANUAL_REVIEW_REQUIRED%'
    or unknown_classification_definition not like '%''required_action''%'
    or resolve_authority_definition not like '%data_agent_job_authority%'
    or revalidate_authority_definition not like '%data_agent_job_authority%'
  then
    raise exception 'PROVIDER_INVOCATION_CROSS_RECORD_CLOSURE_ASSERTION_FAILED';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_policy policy
    join pg_catalog.pg_class relation on relation.oid = policy.polrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('app_data_agent','platform')
      and policy.polname like 'provider_invocation_%_rpc_lock'
      and policy.polcmd = 'w'
      and pg_catalog.pg_get_expr(policy.polwithcheck,policy.polrelid) = 'false'
  ) <> 15 then
    raise exception 'PROVIDER_INVOCATION_LOCK_ONLY_RLS_ASSERTION_FAILED';
  end if;

  if not exists (
      select 1 from pg_catalog.pg_roles
      where rolname = 'data_agent_provider_invocation_rpc_owner'
        and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
        and not rolreplication and not rolbypassrls
    )
    or pg_catalog.pg_has_role(
      'data_agent_provider_invocation_rpc_owner','data_agent_backend','MEMBER')
    or pg_catalog.pg_has_role(
      'data_agent_provider_invocation_rpc_owner','data_agent_job_authority','MEMBER')
    or not exists (
      select 1 from pg_catalog.pg_roles
      where rolname = 'data_agent_provider_smoke_rpc_owner'
        and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
        and not rolreplication and not rolbypassrls)
    or pg_catalog.pg_has_role(
      'data_agent_provider_smoke_rpc_owner','data_agent_backend','MEMBER')
    or pg_catalog.pg_has_role(
      'data_agent_provider_smoke_rpc_owner','data_agent_job_authority','MEMBER')
  then
    raise exception 'PROVIDER_INVOCATION_RPC_OWNER_FLAGS_ASSERTION_FAILED';
  end if;

  foreach function_name in array array[
    'resolve_conversation_run_selections',
    'list_provider_execution_profiles',
    'begin_provider_invocation',
    'mark_provider_invocation_dispatched',
    'mark_provider_invocation_response_observed',
    'commit_provider_invocation_completed',
    'commit_provider_invocation_terminal',
    'mark_provider_invocation_outcome_unknown',
    'commit_provider_reconciliation_evidence',
    'reconcile_provider_invocation_unknown',
    'recover_stale_provider_invocation_marker',
    'recover_next_stale_provider_invocation_marker',
    'claim_provider_invocation_smoke_work',
    'verify_provider_invocation_smoke_completion',
    'discover_next_provider_invocation_unknown',
    'load_provider_invocation',
    'commit_provider_task_artifact',
    'load_provider_task_artifact',
    'commit_provider_response_artifact',
    'load_provider_response_artifact'
  ] loop
    select pg_catalog.pg_get_functiondef(procedure.oid) into strict function_definition
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'app_data_agent'
      and procedure.proname = function_name;
    if function_definition not ilike '%security definer%'
      or function_definition not ilike '%SET search_path TO%''''%'
      or function_definition ~* '(billing|pricing|credit|settlement)'
      or function_definition ~* '(research_invocation|run_effect_receipts)'
    then
      raise exception 'PROVIDER_INVOCATION_FUNCTION_DEFINITION_ASSERTION_FAILED:%',function_name;
    end if;
  end loop;

  if not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.list_provider_execution_profiles()','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.resolve_conversation_run_selections(uuid,bigint)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.begin_provider_invocation(jsonb,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.mark_provider_invocation_dispatched(jsonb,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend',
      'app_data_agent.mark_provider_invocation_response_observed(jsonb,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.commit_provider_invocation_terminal(jsonb,jsonb,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.commit_provider_invocation_completed(jsonb,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.mark_provider_invocation_outcome_unknown(jsonb,jsonb,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.reconcile_provider_invocation_unknown(jsonb,jsonb,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_job_authority','app_data_agent.reconcile_provider_invocation_unknown(jsonb,jsonb,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.recover_stale_provider_invocation_marker(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_job_authority','app_data_agent.recover_stale_provider_invocation_marker(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.recover_next_stale_provider_invocation_marker()','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_job_authority','app_data_agent.recover_next_stale_provider_invocation_marker()','EXECUTE')
    or pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.claim_provider_invocation_smoke_work(text,integer,uuid,uuid)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_job_authority','app_data_agent.claim_provider_invocation_smoke_work(text,integer,uuid,uuid)','EXECUTE')
    or pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.verify_provider_invocation_smoke_completion(uuid,uuid,uuid,bigint)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_job_authority','app_data_agent.verify_provider_invocation_smoke_completion(uuid,uuid,uuid,bigint)','EXECUTE')
    or pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.discover_next_provider_invocation_unknown()','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_job_authority','app_data_agent.discover_next_provider_invocation_unknown()','EXECUTE')
    or pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.commit_provider_reconciliation_evidence(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_job_authority','app_data_agent.commit_provider_reconciliation_evidence(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.load_provider_invocation(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.commit_provider_task_artifact(jsonb,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.load_provider_task_artifact(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.load_provider_response_artifact(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_provider_invocation_rpc_owner',
      'app_data_agent.revalidate_effective_run_config_internal(uuid,bigint,text,uuid,boolean)',
      'EXECUTE')
    or pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.commit_provider_response_artifact(jsonb,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_job_authority','platform.resolve_backend_authority(uuid,uuid,uuid,boolean)',
      'EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_job_authority',
      'platform.revalidate_backend_authority(uuid,uuid,text,uuid,uuid,text,bigint,bigint,boolean)',
      'EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_job_authority','platform.backend_context_matches(uuid,uuid,text,boolean)',
      'EXECUTE')
  then
    raise exception 'PROVIDER_INVOCATION_FUNCTION_GRANT_ASSERTION_FAILED';
  end if;

  if exists (
    select 1 from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname in (
        'provider_invocation_intents','provider_invocation_dispatch_permits',
        'provider_invocation_outcomes',
        'provider_invocation_usage_receipts'
      )
      and not attribute.attisdropped
      and attribute.attname ~* '(billing|pricing|price|credit|cost|balance|settlement|falcon)'
  ) then
    raise exception 'PROVIDER_INVOCATION_COMMERCIAL_OR_FALCON_COLUMN_ASSERTION_FAILED';
  end if;

  if exists (
    select 1 from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname in (
        'provider_invocation_intents','provider_invocation_dispatch_permits',
        'provider_invocation_outcomes','provider_invocation_usage_receipts'
      )
      and not attribute.attisdropped
      and attribute.attname ~* '(^|_)(prompt|messages|headers|credential|secret_value|tool_args|response_body)($|_)'
  ) then
    raise exception 'PROVIDER_INVOCATION_RAW_PROVIDER_COLUMN_ASSERTION_FAILED';
  end if;

  if exists (
    select 1 from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'app_data_agent'
      and relation.relname = 'provider_invocation_intents'
      and not attribute.attisdropped
      and attribute.attname in (
        'context_receipt_id','context_receipt_hash','attempt_id','outbox_id','command_id',
        'worker_id','lease_token','worker_fence','dispatch_hash'
      )
  ) then
    raise exception 'PROVIDER_INVOCATION_STABLE_INTENT_HAS_ATTEMPT_COLUMNS';
  end if;
  if exists (
      select 1 from pg_catalog.pg_attribute attribute
      join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app_data_agent'
        and relation.relname = 'provider_invocation_intents'
        and not attribute.attisdropped
        and attribute.attname in ('trusted_actual_input_tokens','trusted_input_tokens')
    ) or not exists (
      select 1 from pg_catalog.pg_attribute attribute
      join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app_data_agent'
        and relation.relname = 'provider_invocation_intents'
        and not attribute.attisdropped
        and attribute.attname = 'trusted_input_token_upper_bound'
    )
  then
    raise exception 'PROVIDER_INVOCATION_TOKEN_BOUND_AUTHORITY_ASSERTION_FAILED';
  end if;
end
$surface$;
commit;

begin;
set local role data_agent_provider_invocation_rpc_owner;
do $provider_contract_hash_role$
begin
  if app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'ratio',0.30000000000000004::numeric,U&'\+010000',1,U&'\E000',2
    )) <> 'sha256:851b001288d89426aad5ceaf21d3bf09bb0ce74b73267e77d9530569d9245761'
  then
    raise exception 'PROVIDER_CONTRACT_HASH_ROLE_CALL_FAILED';
  end if;
end
$provider_contract_hash_role$;
rollback;

begin;
set local role data_agent_backend;
do $backend_dml_denied$
begin
  begin
    execute 'insert into app_data_agent.provider_invocation_intents default values';
    raise exception 'PROVIDER_INVOCATION_BACKEND_DIRECT_DML_WAS_NOT_REJECTED';
  exception when insufficient_privilege then null;
  end;
end
$backend_dml_denied$;
rollback;

begin;
insert into app_data_agent.workspaces (
  app_id,workspace_id,environment,slug,display_name
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-000000005401','local',
  'u3-profile-list-smoke','U3 profile list smoke'
);
insert into app_data_agent.memberships (
  app_id,tenant_id,environment,principal_id,membership_role
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-000000005401','local',
  '00000000-0000-4000-8000-000000005402','owner'
);
insert into data_agent_auth."user" (
  "id","name","email","emailVerified","username","displayUsername"
) values (
  '00000000-0000-4000-8000-000000005402','U3 fixture user',
  'u3-fixture@example.invalid',true,'u3_fixture','u3_fixture'
);
insert into app_data_agent.app_users (
  app_id,environment,principal_id,auth_user_id,email,display_name,system_role
) values (
  '00000000-0000-4000-8000-00000000da01','local',
  '00000000-0000-4000-8000-000000005402',
  '00000000-0000-4000-8000-000000005402',
  'u3-fixture@example.invalid','U3 fixture user','USER'
);
insert into platform.deployment_mappings (
  deployment_id,app_id,environment,deployment_key_hash
) values (
  '00000000-0000-4000-8000-00000000549c',
  '00000000-0000-4000-8000-00000000da01','local',
  'sha256:9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c9c'
);
create role data_agent_u3_job_session_smoke login inherit;
grant data_agent_job_authority to data_agent_u3_job_session_smoke with inherit true;
set session authorization data_agent_u3_job_session_smoke;
do $job_session_authority$
declare
  resolved record;
  revalidated record;
begin
  select * into strict resolved from platform.resolve_backend_authority(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000005401',
    '00000000-0000-4000-8000-000000005402',true);
  select * into strict revalidated from platform.revalidate_backend_authority(
    resolved.app_id,resolved.tenant_id,resolved.environment,resolved.deployment_id,
    resolved.principal_id,resolved.membership_role,resolved.membership_version,
    resolved.app_epoch,true);
  perform pg_catalog.set_config('data_agent.app_id',resolved.app_id::text,true);
  perform pg_catalog.set_config('data_agent.tenant_id',resolved.tenant_id::text,true);
  perform pg_catalog.set_config('data_agent.environment',resolved.environment,true);
  perform pg_catalog.set_config('data_agent.deployment_id',resolved.deployment_id::text,true);
  perform pg_catalog.set_config('data_agent.principal_id',resolved.principal_id::text,true);
  perform pg_catalog.set_config('data_agent.role',resolved.membership_role,true);
  if revalidated.app_id <> resolved.app_id
    or revalidated.tenant_id <> resolved.tenant_id
    or revalidated.principal_id <> resolved.principal_id
    or not platform.backend_context_matches(
      resolved.app_id,resolved.tenant_id,resolved.environment,true)
  then
    raise exception 'PROVIDER_JOB_SESSION_AUTHORITY_NOT_ESTABLISHED';
  end if;
end
$job_session_authority$;
reset session authorization;
insert into app_data_agent.runs (
  app_id,tenant_id,environment,run_id,principal_id,status,active_fence,question
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-000000005401','local',
  '00000000-0000-4000-8000-000000005403',
  '00000000-0000-4000-8000-000000005402','RUNNING',7,'U3 active lease smoke'
);
insert into app_data_agent.commands (
  app_id,tenant_id,environment,command_id,run_id,principal_id,idempotency_key,
  payload_json,payload_hash
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-000000005401','local',
  '00000000-0000-4000-8000-000000005404',
  '00000000-0000-4000-8000-000000005403',
  '00000000-0000-4000-8000-000000005402','u3-active-lease-smoke',
  '{"kind":"START_L2_RESEARCH","effective_config_ref":{"config_id":"00000000-0000-4000-8000-000000005409","config_revision":1,"config_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}',
  platform.canonical_sha256(
    '{"kind":"START_L2_RESEARCH","effective_config_ref":{"config_id":"00000000-0000-4000-8000-000000005409","config_revision":1,"config_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}'::jsonb)
);
insert into app_data_agent.outbox (
  app_id,tenant_id,environment,outbox_id,run_id,command_id,topic,payload_json,
  queue_sequence
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-000000005401','local',
  '00000000-0000-4000-8000-000000005405',
  '00000000-0000-4000-8000-000000005403',
  '00000000-0000-4000-8000-000000005404','run.command.accepted',
  '{"kind":"START_L2_RESEARCH"}',1
);
insert into app_data_agent.runs (
  app_id,tenant_id,environment,run_id,principal_id,status,active_fence,question
) values
('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
  'local','00000000-0000-4000-8000-000000005450',
  '00000000-0000-4000-8000-000000005402','QUEUED',0,'Unrelated FIFO head'),
('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
  'local','00000000-0000-4000-8000-000000005460',
  '00000000-0000-4000-8000-000000005402','QUEUED',0,'Exact provider smoke target');
insert into app_data_agent.commands (
  app_id,tenant_id,environment,command_id,run_id,principal_id,idempotency_key,
  payload_json,payload_hash,status
) values
('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
  'local','00000000-0000-4000-8000-000000005451',
  '00000000-0000-4000-8000-000000005450','00000000-0000-4000-8000-000000005402',
  'u3-unrelated-fifo-head',
  '{"kind":"START_L2_RESEARCH","effective_config_ref":{"config_id":"00000000-0000-4000-8000-000000005459","config_revision":1,"config_hash":"sha256:5959595959595959595959595959595959595959595959595959595959595959"}}',
  platform.canonical_sha256(
    '{"kind":"START_L2_RESEARCH","effective_config_ref":{"config_id":"00000000-0000-4000-8000-000000005459","config_revision":1,"config_hash":"sha256:5959595959595959595959595959595959595959595959595959595959595959"}}'::jsonb),
  'ACCEPTED'),
('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
  'local','00000000-0000-4000-8000-000000005461',
  '00000000-0000-4000-8000-000000005460','00000000-0000-4000-8000-000000005402',
  'u3-exact-smoke-target',
  '{"kind":"START_L2_RESEARCH","effective_config_ref":{"config_id":"00000000-0000-4000-8000-000000005469","config_revision":1,"config_hash":"sha256:6969696969696969696969696969696969696969696969696969696969696969"}}',
  platform.canonical_sha256(
    '{"kind":"START_L2_RESEARCH","effective_config_ref":{"config_id":"00000000-0000-4000-8000-000000005469","config_revision":1,"config_hash":"sha256:6969696969696969696969696969696969696969696969696969696969696969"}}'::jsonb),
  'ACCEPTED');
insert into app_data_agent.outbox (
  app_id,tenant_id,environment,outbox_id,run_id,command_id,topic,payload_json,
  queue_sequence,status,attempt_count
) values
('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
  'local','00000000-0000-4000-8000-000000005452',
  '00000000-0000-4000-8000-000000005450','00000000-0000-4000-8000-000000005451',
  'run.command.accepted','{"kind":"START_L2_RESEARCH"}',1,'PENDING',0),
('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
  'local','00000000-0000-4000-8000-000000005462',
  '00000000-0000-4000-8000-000000005460','00000000-0000-4000-8000-000000005461',
  'run.command.accepted','{"kind":"START_L2_RESEARCH"}',2,'PENDING',0);
insert into app_data_agent.run_attempts (
  app_id,tenant_id,environment,run_id,outbox_id,command_id,attempt_id,attempt_no,
  worker_id,lease_token,worker_fence,status,lease_expires_at,last_heartbeat_at
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-000000005401','local',
  '00000000-0000-4000-8000-000000005403',
  '00000000-0000-4000-8000-000000005405',
  '00000000-0000-4000-8000-000000005404',
  '00000000-0000-4000-8000-000000005406',1,'u3-worker',1,7,'ACTIVE',
  pg_catalog.clock_timestamp() + interval '10 minutes',pg_catalog.clock_timestamp()
);
update app_data_agent.outbox set
  status = 'LEASED',attempt_count = 1,lease_owner = 'u3-worker',lease_token = 1,
  lease_expires_at = pg_catalog.clock_timestamp() + interval '10 minutes',
  active_attempt_id = '00000000-0000-4000-8000-000000005406',run_fence = 7,
  last_heartbeat_at = pg_catalog.clock_timestamp()
where outbox_id = '00000000-0000-4000-8000-000000005405';
insert into app_data_agent.run_events (
  app_id,tenant_id,environment,event_id,run_id,sequence,event_type,payload_json,
  attempt_id,command_id,dedupe_key,worker_fence
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-000000005401','local',
  '00000000-0000-4000-8000-000000005407',
  '00000000-0000-4000-8000-000000005403',1,'run.accepted',
  pg_catalog.jsonb_build_object(
    'command_id','00000000-0000-4000-8000-000000005404',
    'payload_hash',(select payload_hash from app_data_agent.commands
      where command_id = '00000000-0000-4000-8000-000000005404')),
  null,'00000000-0000-4000-8000-000000005404','u3-active-lease-started',0
);
insert into app_data_agent.run_events (
  app_id,tenant_id,environment,event_id,run_id,sequence,event_type,payload_json,
  attempt_id,command_id,dedupe_key,worker_fence
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-000000005401','local',
  '00000000-0000-4000-8000-000000005408',
  '00000000-0000-4000-8000-000000005403',2,'run.leased',
  '{"attempt_no":1}'::jsonb,
  '00000000-0000-4000-8000-000000005406',
  '00000000-0000-4000-8000-000000005404','u3-active-lease-leased',7
);
with leased_event as (
  select event_id,created_at
  from app_data_agent.run_events
  where app_id = '00000000-0000-4000-8000-00000000da01'
    and tenant_id = '00000000-0000-4000-8000-000000005401'
    and environment = 'local'
    and run_id = '00000000-0000-4000-8000-000000005403'
    and event_id = '00000000-0000-4000-8000-000000005408'
), projected as (
  select event_id,created_at,pg_catalog.jsonb_build_object(
    'schema_version','1.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-000000005401',
      'environment','local'),
    'run_id','00000000-0000-4000-8000-000000005403',
    'status','RUNNING','version',2,'worker_fence',7,'attempt_count',1,
    'last_event_id',event_id,'last_occurred_at',app_data_agent.runtime_iso_timestamp(created_at),
    'active_artifact_ref',null,'active_snapshot_ref',null,
    'last_side_effect_receipt_id',null,'terminal_event_id',null
  ) as document
  from leased_event
)
insert into app_data_agent.run_projections (
  app_id,tenant_id,environment,run_id,version,status,worker_fence,event_id,
  projection_hash,projection_json,occurred_at
)
select
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-000000005401','local',
  '00000000-0000-4000-8000-000000005403',2,'RUNNING',7,event_id,
  app_data_agent.runtime_canonical_sha256(document),document,created_at
from projected;
select pg_catalog.set_config(
  'data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config(
  'data_agent.tenant_id','00000000-0000-4000-8000-000000005401',true);
select pg_catalog.set_config('data_agent.environment','local',true);
select pg_catalog.set_config(
  'data_agent.deployment_id','00000000-0000-4000-8000-000000000001',true);
select pg_catalog.set_config(
  'data_agent.principal_id','00000000-0000-4000-8000-000000005402',true);
select pg_catalog.set_config('data_agent.role','owner',true);
set local role data_agent_job_authority;
do $target_smoke_claim$
declare
  result jsonb;
begin
  result := app_data_agent.claim_provider_invocation_smoke_work(
    'u3-provider-smoke',60000,
    '00000000-0000-4000-8000-000000005460',
    '00000000-0000-4000-8000-000000005461');
  if result ->> 'schema_version' <> 'provider-invocation-smoke-claim@1.0.0'
    or result #>> '{lease,run_id}' <> '00000000-0000-4000-8000-000000005460'
    or result #>> '{lease,command_id}' <> '00000000-0000-4000-8000-000000005461'
    or result #>> '{lease,scope,app_id}' <> '00000000-0000-4000-8000-00000000da01'
    or result #>> '{lease,scope,tenant_id}' <> '00000000-0000-4000-8000-000000005401'
    or result #>> '{lease,scope,environment}' <> 'local'
    or result #>> '{lease,principal_id}' <> '00000000-0000-4000-8000-000000005402'
    or result #>> '{lease,worker_fence}' <> '1'
    or result #>> '{precondition,logical_invocation_id}' <>
      '00000000-0000-4000-8000-000000005461'
    or result #>> '{precondition,intent_count}' <> '0'
    or result #>> '{precondition,permit_count}' <> '0'
    or result #>> '{precondition,marker_count}' <> '0'
    or result #>> '{precondition,outcome_count}' <> '0'
    or result #>> '{precondition,usage_count}' <> '0'
    or result #>> '{precondition,response_artifact_count}' <> '0'
    or app_data_agent.claim_provider_invocation_smoke_work(
      'u3-provider-smoke',60000,
      '00000000-0000-4000-8000-000000005460',
      '00000000-0000-4000-8000-000000005461') is not null
    or app_data_agent.claim_provider_invocation_smoke_work(
      'u3-provider-smoke',60000,
      '00000000-0000-4000-8000-000000005450',
      '00000000-0000-4000-8000-000000005461') is not null
  then
    raise exception 'PROVIDER_TARGET_SMOKE_ATOMIC_CLAIM_FAILED';
  end if;
end
$target_smoke_claim$;
reset role;
do $target_smoke_claim_state$
begin
  if (select status from app_data_agent.outbox
      where outbox_id = '00000000-0000-4000-8000-000000005452') <> 'PENDING'
    or (select status from app_data_agent.outbox
      where outbox_id = '00000000-0000-4000-8000-000000005462') <> 'LEASED'
    or not exists (select 1 from app_data_agent.run_attempts
      where run_id = '00000000-0000-4000-8000-000000005460'
        and command_id = '00000000-0000-4000-8000-000000005461'
        and worker_id = 'u3-provider-smoke' and worker_fence = 1)
  then raise exception 'PROVIDER_TARGET_SMOKE_CLAIM_STATE_INVALID'; end if;
end
$target_smoke_claim_state$;

-- Complete a synthetic, zero-network authority lineage for the claimed target so the
-- proof RPC is tested against exact cardinality/hash/ref closure. Missing U2/catalog
-- prerequisites are bypassed only for this rollback-only fixture; all U3 CHECKs remain.
alter table app_data_agent.provider_invocation_intents disable trigger all;
alter table app_data_agent.provider_invocation_dispatch_permits disable trigger all;
alter table app_data_agent.artifacts disable trigger all;
do $target_smoke_completion_fixture$
declare
  target_attempt app_data_agent.run_attempts%rowtype;
  scope_document jsonb := '{
    "app_id":"00000000-0000-4000-8000-00000000da01",
    "tenant_id":"00000000-0000-4000-8000-000000005401",
    "environment":"local",
    "workspace_id":"00000000-0000-4000-8000-000000005401",
    "principal_id":"00000000-0000-4000-8000-000000005402"
  }'::jsonb;
  committed_at timestamptz := pg_catalog.clock_timestamp();
  spec_document jsonb;
  intent_document jsonb;
  permit_document jsonb;
  marker_document jsonb;
  response_marker_document jsonb;
  response_document jsonb;
  response_reference jsonb;
  completed_candidate jsonb;
  completed_document jsonb;
  usage_document jsonb;
  response_hash text;
  response_content_hash text;
begin
  select * into strict target_attempt from app_data_agent.run_attempts
  where app_id = '00000000-0000-4000-8000-00000000da01'
    and tenant_id = '00000000-0000-4000-8000-000000005401'
    and environment = 'local'
    and run_id = '00000000-0000-4000-8000-000000005460'
    and command_id = '00000000-0000-4000-8000-000000005461'
    and worker_id = 'u3-provider-smoke' and status = 'ACTIVE';
  spec_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-spec@1.0.0',
    'invocation_id','00000000-0000-4000-8000-000000005461',
    'scope',scope_document,'run_id','00000000-0000-4000-8000-000000005460',
    'certification',pg_catalog.jsonb_build_object(
      'recovery_capabilities',pg_catalog.jsonb_build_array('IDEMPOTENT_REQUEST')));
  intent_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-intent@1.0.0',
    'intent_id','00000000-0000-4000-8000-000000005470',
    'invocation_spec',spec_document,
    'invocation_key_hash',app_data_agent.u2_canonical_sha256(spec_document),
    'state','INTENT_COMMITTED','committed_at',app_data_agent.runtime_iso_timestamp(committed_at));
  intent_document := intent_document || pg_catalog.jsonb_build_object(
    'intent_hash',app_data_agent.u2_canonical_sha256(intent_document));
  insert into app_data_agent.provider_invocation_intents (
    app_id,tenant_id,environment,intent_id,invocation_id,logical_call_id,run_id,
    workspace_id,principal_id,idempotency_key,invocation_key_hash,
    config_id,config_revision,config_hash,model_profile_id,model_config_version,
    model_config_hash,profile_version,provider,model_id,adapter_version,binding_kind,
    system_binding_hash,system_deployment_id,system_deployment_revision,
    certification_run_id,certification_artifact_id,certification_artifact_type,
    certification_revision,certification_hash,certification_execution_profile_hash,
    task_artifact_id,task_artifact_type,task_artifact_revision,task_artifact_hash,
    projection_artifact_id,projection_artifact_type,projection_artifact_revision,
    projection_artifact_hash,projection_receipt_hash,recovery_capabilities,
    token_bound_policy_version,trusted_input_token_upper_bound,reserved_output_tokens,
    effective_max_context_tokens,effective_max_output_tokens,provider_call_limit,
    admission,rejection_reason,intent_json,intent_hash,committed_at
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
    'local','00000000-0000-4000-8000-000000005470',
    '00000000-0000-4000-8000-000000005461','00000000-0000-4000-8000-000000005461',
    '00000000-0000-4000-8000-000000005460','00000000-0000-4000-8000-000000005401',
    '00000000-0000-4000-8000-000000005402','u3-target-smoke-proof',
    app_data_agent.u2_canonical_sha256(spec_document),'00000000-0000-4000-8000-000000005469',1,
    'sha256:6969696969696969696969696969696969696969696969696969696969696969',
    '00000000-0000-4000-8000-000000005476',1,
    'sha256:7676767676767676767676767676767676767676767676767676767676767676',
    'model-profile@1','deepseek','deepseek-v4-flash','deepseek-adapter@1',
    'SYSTEM_DEPLOYMENT','sha256:7777777777777777777777777777777777777777777777777777777777777777',
    '00000000-0000-4000-8000-000000005477',1,
    '00000000-0000-4000-8000-000000005478','00000000-0000-4000-8000-000000005479',
    'ModelCertificationReceipt',1,
    'sha256:7979797979797979797979797979797979797979797979797979797979797979',
    'sha256:8080808080808080808080808080808080808080808080808080808080808080',
    '00000000-0000-4000-8000-000000005481','ProviderTaskArtifact',1,
    'sha256:8181818181818181818181818181818181818181818181818181818181818181',
    '00000000-0000-4000-8000-000000005461','AgentDataProjectionReceipt',1,
    'sha256:8282828282828282828282828282828282828282828282828282828282828282',
    'sha256:8282828282828282828282828282828282828282828282828282828282828282',
    array['IDEMPOTENT_REQUEST']::text[],'utf8-byte-upper-bound@1.0.0',10,5,100,50,1,
    'READY',null,intent_document,intent_document ->> 'intent_hash',committed_at);

  permit_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-dispatch-permit@1.0.0',
    'permit_id','00000000-0000-4000-8000-000000005471',
    'intent_id','00000000-0000-4000-8000-000000005470',
    'invocation_id','00000000-0000-4000-8000-000000005461','scope',scope_document,
    'run_id','00000000-0000-4000-8000-000000005460',
    'dispatch_hash','sha256:8383838383838383838383838383838383838383838383838383838383838383',
    'context_receipt_ref',pg_catalog.jsonb_build_object(
      'receipt_id','00000000-0000-4000-8000-000000005483',
      'receipt_hash','sha256:8484848484848484848484848484848484848484848484848484848484848484'),
    'lease',pg_catalog.jsonb_build_object(
      'outbox_id',target_attempt.outbox_id,'command_id',target_attempt.command_id,
      'attempt_id',target_attempt.attempt_id,'attempt_no',target_attempt.attempt_no,
      'worker_id',target_attempt.worker_id,'lease_token',target_attempt.lease_token,
      'worker_fence',target_attempt.worker_fence),
    'attempt_id',target_attempt.attempt_id,'worker_fence',target_attempt.worker_fence,
    'committed_at',app_data_agent.runtime_iso_timestamp(committed_at));
  permit_document := permit_document || pg_catalog.jsonb_build_object(
    'permit_hash',app_data_agent.u2_canonical_sha256(permit_document));
  insert into app_data_agent.provider_invocation_dispatch_permits (
    app_id,tenant_id,environment,permit_id,intent_id,invocation_id,run_id,dispatch_hash,
    context_receipt_id,context_receipt_hash,attempt_id,outbox_id,command_id,attempt_no,
    worker_id,lease_token,worker_fence,envelope_json,permit_json,permit_hash,committed_at
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
    'local','00000000-0000-4000-8000-000000005471','00000000-0000-4000-8000-000000005470',
    '00000000-0000-4000-8000-000000005461','00000000-0000-4000-8000-000000005460',
    permit_document ->> 'dispatch_hash','00000000-0000-4000-8000-000000005483',
    permit_document #>> '{context_receipt_ref,receipt_hash}',target_attempt.attempt_id,
    target_attempt.outbox_id,target_attempt.command_id,target_attempt.attempt_no,
    target_attempt.worker_id,target_attempt.lease_token,target_attempt.worker_fence,
    '{}'::jsonb,permit_document,permit_document ->> 'permit_hash',committed_at);

  response_hash := app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'output_text','synthetic zero-network proof','tool_calls','[]'::jsonb));
  response_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-response-artifact@1.0.0',
    'invocation_id','00000000-0000-4000-8000-000000005461',
    'output_text','synthetic zero-network proof','tool_calls','[]'::jsonb,
    'response_hash',response_hash);
  response_content_hash := app_data_agent.u2_canonical_sha256(response_document);
  response_document := response_document || pg_catalog.jsonb_build_object(
    'content_hash',response_content_hash);
  insert into app_data_agent.artifacts (
    app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,
    content_hash,document_json,worker_fence,is_active
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
    'local','00000000-0000-4000-8000-000000005460',
    '00000000-0000-4000-8000-000000005474','ProviderResponseArtifact',1,
    response_content_hash,response_document,target_attempt.worker_fence,true);
  response_reference := pg_catalog.jsonb_build_object(
    'artifact_id','00000000-0000-4000-8000-000000005474',
    'artifact_type','ProviderResponseArtifact',
    'app_id','00000000-0000-4000-8000-00000000da01',
    'tenant_id','00000000-0000-4000-8000-000000005401','environment','local',
    'run_id','00000000-0000-4000-8000-000000005460','revision',1,
    'content_hash',response_content_hash);

  marker_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-dispatch-marker@1.0.0',
    'marker_id','00000000-0000-4000-8000-000000005472',
    'intent_id','00000000-0000-4000-8000-000000005470',
    'invocation_id','00000000-0000-4000-8000-000000005461','scope',scope_document,
    'run_id','00000000-0000-4000-8000-000000005460',
    'dispatch_hash',permit_document ->> 'dispatch_hash','state','DISPATCH_MARKED',
    'dispatch_marked_at',app_data_agent.runtime_iso_timestamp(committed_at));
  marker_document := marker_document || pg_catalog.jsonb_build_object(
    'marker_hash',app_data_agent.u2_canonical_sha256(marker_document));
  insert into app_data_agent.provider_invocation_outcomes (
    app_id,tenant_id,environment,outcome_id,intent_id,invocation_id,run_id,dispatch_hash,
    transition_revision,state,actor_kind,transition_from,recovery_action,dispatch_attempt_no,
    attempt_id,outbox_id,command_id,worker_id,lease_token,worker_fence,dispatch_marked,
    provider_call_may_have_started,provider_call_count,delivery_certainty,started_at,
    outcome_json,outcome_hash,committed_at
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
    'local','00000000-0000-4000-8000-000000005472','00000000-0000-4000-8000-000000005470',
    '00000000-0000-4000-8000-000000005461','00000000-0000-4000-8000-000000005460',
    permit_document ->> 'dispatch_hash',1,'DISPATCH_MARKED','WORKER','INTENT_COMMITTED','NONE',
    target_attempt.attempt_no,target_attempt.attempt_id,target_attempt.outbox_id,
    target_attempt.command_id,target_attempt.worker_id,target_attempt.lease_token,
    target_attempt.worker_fence,true,true,1,'DISPATCHED_OUTCOME_UNKNOWN',committed_at,
    marker_document,marker_document ->> 'marker_hash',committed_at);

  response_marker_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-response-observed-marker@1.0.0',
    'marker_id','00000000-0000-4000-8000-000000005476',
    'intent_id','00000000-0000-4000-8000-000000005470',
    'invocation_id','00000000-0000-4000-8000-000000005461','scope',scope_document,
    'run_id','00000000-0000-4000-8000-000000005460',
    'dispatch_hash',permit_document ->> 'dispatch_hash',
    'attempt_id',target_attempt.attempt_id,'worker_fence',target_attempt.worker_fence,
    'state','RESPONSE_OBSERVED',
    'observation_kind','COMPLETED','response_hash',response_hash,
    'delivery_certainty','DISPATCHED_OUTCOME_KNOWN',
    'response_observed_at',app_data_agent.runtime_iso_timestamp(committed_at));
  response_marker_document := response_marker_document || pg_catalog.jsonb_build_object(
    'marker_hash',app_data_agent.u2_canonical_sha256(response_marker_document));
  insert into app_data_agent.provider_invocation_outcomes (
    app_id,tenant_id,environment,outcome_id,intent_id,invocation_id,run_id,dispatch_hash,
    transition_revision,parent_transition_revision,parent_outcome_hash,state,observation_kind,
    actor_kind,transition_from,recovery_action,dispatch_attempt_no,attempt_id,outbox_id,
    command_id,worker_id,lease_token,worker_fence,dispatch_marked,
    provider_call_may_have_started,provider_call_count,delivery_certainty,started_at,
    outcome_json,outcome_hash,committed_at
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
    'local','00000000-0000-4000-8000-000000005476','00000000-0000-4000-8000-000000005470',
    '00000000-0000-4000-8000-000000005461','00000000-0000-4000-8000-000000005460',
    permit_document ->> 'dispatch_hash',2,1,marker_document ->> 'marker_hash',
    'RESPONSE_OBSERVED','COMPLETED','WORKER','DISPATCH_MARKED','NONE',
    target_attempt.attempt_no,target_attempt.attempt_id,target_attempt.outbox_id,
    target_attempt.command_id,target_attempt.worker_id,target_attempt.lease_token,
    target_attempt.worker_fence,true,true,1,'DISPATCHED_OUTCOME_KNOWN',committed_at,
    response_marker_document,response_marker_document ->> 'marker_hash',committed_at);

  completed_candidate := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-outcome-candidate@1.0.0',
    'intent_id','00000000-0000-4000-8000-000000005470',
    'invocation_id','00000000-0000-4000-8000-000000005461','scope',scope_document,
    'run_id','00000000-0000-4000-8000-000000005460',
    'dispatch_hash',permit_document ->> 'dispatch_hash','status','COMPLETED',
    'reason_code',null,'response_artifact_ref',response_reference,
    'response_hash',response_hash,'delivery_certainty','DISPATCHED_OUTCOME_KNOWN',
    'transition_from','RESPONSE_OBSERVED','recovery_action','NONE','provider_call_count',1,
    'retry_after_ms',null,'reconciliation_of',null);
  completed_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-outcome@1.0.0',
    'outcome_id','00000000-0000-4000-8000-000000005473',
    'candidate',completed_candidate,
    'dispatch_marked_at',app_data_agent.runtime_iso_timestamp(committed_at),
    'terminal_at',app_data_agent.runtime_iso_timestamp(committed_at),'latency_ms',0);
  completed_document := completed_document || pg_catalog.jsonb_build_object(
    'outcome_hash',app_data_agent.u2_canonical_sha256(completed_document));
  insert into app_data_agent.provider_invocation_outcomes (
    app_id,tenant_id,environment,outcome_id,intent_id,invocation_id,run_id,dispatch_hash,
    transition_revision,parent_transition_revision,parent_outcome_hash,state,actor_kind,
    transition_from,recovery_action,dispatch_attempt_no,attempt_id,outbox_id,command_id,
    worker_id,lease_token,worker_fence,dispatch_marked,provider_call_may_have_started,
    response_artifact_id,response_artifact_type,response_artifact_revision,
    response_artifact_content_hash,response_hash,provider_call_count,delivery_certainty,
    started_at,terminal_at,latency_ms,outcome_json,outcome_hash,committed_at
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
    'local','00000000-0000-4000-8000-000000005473','00000000-0000-4000-8000-000000005470',
    '00000000-0000-4000-8000-000000005461','00000000-0000-4000-8000-000000005460',
    permit_document ->> 'dispatch_hash',3,2,response_marker_document ->> 'marker_hash','COMPLETED',
    'WORKER','RESPONSE_OBSERVED','NONE',target_attempt.attempt_no,target_attempt.attempt_id,
    target_attempt.outbox_id,target_attempt.command_id,target_attempt.worker_id,
    target_attempt.lease_token,target_attempt.worker_fence,true,true,
    '00000000-0000-4000-8000-000000005474','ProviderResponseArtifact',1,
    response_content_hash,response_hash,1,'DISPATCHED_OUTCOME_KNOWN',committed_at,
    committed_at,0,completed_document,completed_document ->> 'outcome_hash',committed_at);

  usage_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-usage@1.0.0',
    'usage_receipt_id','00000000-0000-4000-8000-000000005475',
    'outcome_id','00000000-0000-4000-8000-000000005473',
    'intent_id','00000000-0000-4000-8000-000000005470',
    'invocation_id','00000000-0000-4000-8000-000000005461','scope',scope_document,
    'run_id','00000000-0000-4000-8000-000000005460','availability','UNAVAILABLE',
    'source','UNAVAILABLE','input_tokens',null,'output_tokens',null,'total_tokens',null,
    'tool_calls',null,'provider_call_count',1,'capacity_status','UNAVAILABLE',
    'unavailable_reason','PROVIDER_DID_NOT_REPORT_USAGE',
    'observed_at',app_data_agent.runtime_iso_timestamp(committed_at));
  usage_document := usage_document || pg_catalog.jsonb_build_object(
    'usage_hash',app_data_agent.u2_canonical_sha256(usage_document));
  insert into app_data_agent.provider_invocation_usage_receipts (
    app_id,tenant_id,environment,usage_receipt_id,intent_id,invocation_id,outcome_id,
    outcome_transition_revision,outcome_hash,availability,token_source,input_tokens,
    output_tokens,total_tokens,tool_calls,provider_call_count,capacity_status,
    unavailable_reason,usage_json,usage_hash,observed_at,committed_at
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
    'local','00000000-0000-4000-8000-000000005475','00000000-0000-4000-8000-000000005470',
    '00000000-0000-4000-8000-000000005461','00000000-0000-4000-8000-000000005473',
    3,completed_document ->> 'outcome_hash','UNAVAILABLE','UNAVAILABLE',null,null,null,null,
    1,'UNAVAILABLE','PROVIDER_DID_NOT_REPORT_USAGE',usage_document,
    usage_document ->> 'usage_hash',committed_at,committed_at);
  perform pg_catalog.set_config('data_agent.u3_target_attempt_id',target_attempt.attempt_id::text,true);
  perform pg_catalog.set_config('data_agent.u3_target_worker_fence',target_attempt.worker_fence::text,true);
end
$target_smoke_completion_fixture$;
alter table app_data_agent.provider_invocation_intents enable trigger all;
alter table app_data_agent.provider_invocation_dispatch_permits enable trigger all;
alter table app_data_agent.artifacts enable trigger all;
set local role data_agent_job_authority;
do $target_smoke_completion_proof$
declare
  result jsonb;
begin
  result := app_data_agent.verify_provider_invocation_smoke_completion(
    '00000000-0000-4000-8000-000000005460',
    '00000000-0000-4000-8000-000000005461',
    pg_catalog.current_setting('data_agent.u3_target_attempt_id')::uuid,
    pg_catalog.current_setting('data_agent.u3_target_worker_fence')::bigint);
  if result ->> 'schema_version' <> 'provider-invocation-smoke-proof@1.0.0'
    or result ->> 'provider' <> 'deepseek'
    or result ->> 'model_id' <> 'deepseek-v4-flash'
    or result ->> 'outcome_status' <> 'COMPLETED'
    or result ->> 'provider_call_count' <> '1'
    or result #>> '{response_artifact_ref,artifact_type}' <> 'ProviderResponseArtifact'
  then raise exception 'PROVIDER_TARGET_SMOKE_COMPLETION_PROOF_FAILED'; end if;
end
$target_smoke_completion_proof$;
reset role;

-- Even if an operator accidentally requeues the target, persisted invocation Authority
-- makes it ineligible as a new one-call smoke before any new Attempt or lease mutation.
alter table app_data_agent.runs disable trigger all;
alter table app_data_agent.outbox disable trigger all;
alter table app_data_agent.commands disable trigger all;
update app_data_agent.runs set status = 'QUEUED'
where run_id = '00000000-0000-4000-8000-000000005460';
update app_data_agent.outbox set status = 'PENDING',attempt_count = 0,lease_owner = null,
  lease_expires_at = null,active_attempt_id = null,run_fence = 0,last_heartbeat_at = null
where outbox_id = '00000000-0000-4000-8000-000000005462';
update app_data_agent.commands set status = 'ACCEPTED'
where command_id = '00000000-0000-4000-8000-000000005461';
alter table app_data_agent.runs enable trigger all;
alter table app_data_agent.outbox enable trigger all;
alter table app_data_agent.commands enable trigger all;
select pg_catalog.set_config(
  'data_agent.u3_target_attempt_count',
  (select pg_catalog.count(*)::text from app_data_agent.run_attempts
    where run_id = '00000000-0000-4000-8000-000000005460'),true);
set local role data_agent_job_authority;
do $target_smoke_terminal_replay_guard$
begin
  begin
    perform app_data_agent.claim_provider_invocation_smoke_work(
      'u3-provider-smoke',60000,
      '00000000-0000-4000-8000-000000005460',
      '00000000-0000-4000-8000-000000005461');
    raise exception 'PROVIDER_TERMINAL_REPLAY_BECAME_NEW_SMOKE';
  exception when others then
    if sqlerrm <> 'PROVIDER_SMOKE_PRECONDITION_NOT_EMPTY' then raise; end if;
  end;
end
$target_smoke_terminal_replay_guard$;
reset role;
do $target_smoke_terminal_replay_state$
begin
  if pg_catalog.current_setting('data_agent.u3_target_attempt_count')::bigint <>
      (select pg_catalog.count(*) from app_data_agent.run_attempts
       where run_id = '00000000-0000-4000-8000-000000005460')
    or (select status from app_data_agent.outbox
        where outbox_id = '00000000-0000-4000-8000-000000005462') <> 'PENDING'
  then raise exception 'PROVIDER_TERMINAL_REPLAY_MUTATED_TARGET'; end if;
end
$target_smoke_terminal_replay_state$;
do $active_lease_smoke$
declare
  lease jsonb := '{
    "scope":{"app_id":"00000000-0000-4000-8000-00000000da01","tenant_id":"00000000-0000-4000-8000-000000005401","environment":"local"},
    "principal_id":"00000000-0000-4000-8000-000000005402",
    "outbox_id":"00000000-0000-4000-8000-000000005405",
    "run_id":"00000000-0000-4000-8000-000000005403",
    "command_id":"00000000-0000-4000-8000-000000005404",
    "command_kind":"START_L2_RESEARCH",
    "attempt_id":"00000000-0000-4000-8000-000000005406",
    "attempt_no":1,"delivery_attempt_no":1,"lease_duration_ms":600000,
    "worker_id":"u3-worker","lease_token":1,"worker_fence":7,
    "expires_at":"2099-01-01T00:00:00.000Z",
    "payload":{"kind":"START_L2_RESEARCH","effective_config_ref":{"config_id":"00000000-0000-4000-8000-000000005409","config_revision":1,"config_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}
  }'::jsonb;
  resolved jsonb;
  mutated jsonb;
  usage_candidate jsonb := '{
    "schema_version":"provider-invocation-usage-candidate@1.0.0",
    "availability":"NOT_APPLICABLE","source":"UNAVAILABLE",
    "input_tokens":null,"output_tokens":null,"total_tokens":null,"tool_calls":null,
    "provider_call_count":0,"capacity_status":"NOT_APPLICABLE",
    "unavailable_reason":"PROVIDER_NOT_DISPATCHED"
  }'::jsonb;
  transition_command jsonb;
  before_count bigint;
begin
  resolved := app_data_agent.assert_provider_active_worker_lease(lease);
  if resolved ->> 'attempt_id' <> '00000000-0000-4000-8000-000000005406'
    or resolved ->> 'outbox_id' <> '00000000-0000-4000-8000-000000005405'
    or resolved ->> 'command_id' <> '00000000-0000-4000-8000-000000005404'
    or resolved ->> 'worker_fence' <> '7'
  then raise exception 'PROVIDER_ACTIVE_LEASE_POSITIVE_SMOKE_FAILED'; end if;
  foreach mutated in array array[
    pg_catalog.jsonb_set(lease,'{worker_fence}','8'::jsonb),
    pg_catalog.jsonb_set(lease,'{lease_token}','12'::jsonb),
    pg_catalog.jsonb_set(lease,'{outbox_id}',
      '"00000000-0000-4000-8000-000000005407"'::jsonb),
    pg_catalog.jsonb_set(lease,'{command_id}',
      '"00000000-0000-4000-8000-000000005408"'::jsonb)
  ] loop
    begin
      perform app_data_agent.assert_provider_active_worker_lease(mutated);
      raise exception 'PROVIDER_STALE_OR_MISMATCHED_LEASE_WAS_NOT_REJECTED';
    exception when others then
      if sqlerrm not in ('PROVIDER_WORKER_LEASE_STALE','PROVIDER_WORKER_LEASE_INVALID') then
        raise;
      end if;
    end;
  end loop;

  transition_command := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-commit-terminal@1.0.0',
    'intent_id','00000000-0000-4000-8000-000000005410',
    'invocation_id','00000000-0000-4000-8000-000000005411',
    'scope',lease -> 'scope' || pg_catalog.jsonb_build_object(
      'workspace_id','00000000-0000-4000-8000-000000005401',
      'principal_id','00000000-0000-4000-8000-000000005402'),
    'run_id','00000000-0000-4000-8000-000000005403',
    'dispatch_hash','sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'attempt_id','00000000-0000-4000-8000-000000005406','worker_fence',7,
    'outcome',pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-outcome-candidate@1.0.0',
      'intent_id','00000000-0000-4000-8000-000000005410',
      'invocation_id','00000000-0000-4000-8000-000000005411',
      'scope',(lease -> 'scope' || pg_catalog.jsonb_build_object(
        'workspace_id','00000000-0000-4000-8000-000000005401',
        'principal_id','00000000-0000-4000-8000-000000005499')),
      'run_id','00000000-0000-4000-8000-000000005403',
      'dispatch_hash','sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      'status','FAILED','reason_code','PROVIDER_INVOCATION_FAILED',
      'response_artifact_ref',null,'response_hash',null,
      'delivery_certainty','NOT_DISPATCHED','transition_from','INTENT_COMMITTED',
      'recovery_action','NONE','provider_call_count',0,'retry_after_ms',null,
      'reconciliation_of',null),
    'usage',usage_candidate);
  select (select pg_catalog.count(*) from app_data_agent.provider_invocation_intents)
       + (select pg_catalog.count(*) from app_data_agent.provider_invocation_dispatch_permits)
       + (select pg_catalog.count(*) from app_data_agent.provider_invocation_outcomes)
       + (select pg_catalog.count(*) from app_data_agent.provider_invocation_usage_receipts)
  into before_count;
  foreach mutated in array array[
    transition_command,
    pg_catalog.jsonb_set(
      transition_command,'{outcome,invocation_id}',
      '"00000000-0000-4000-8000-000000005412"'::jsonb)
  ] loop
    begin
      perform app_data_agent.commit_provider_invocation_terminal(
        lease,mutated,usage_candidate);
      raise exception 'PROVIDER_TRANSITION_IDENTITY_MUTATION_WAS_NOT_REJECTED';
    exception when others then
      if sqlerrm <> 'PROVIDER_INVOCATION_TRANSITION_CLOSURE_INVALID' then raise; end if;
    end;
  end loop;
  if before_count <> (
      select (select pg_catalog.count(*) from app_data_agent.provider_invocation_intents)
           + (select pg_catalog.count(*) from app_data_agent.provider_invocation_dispatch_permits)
           + (select pg_catalog.count(*) from app_data_agent.provider_invocation_outcomes)
           + (select pg_catalog.count(*) from app_data_agent.provider_invocation_usage_receipts)
    )
  then raise exception 'PROVIDER_TRANSITION_IDENTITY_MUTATION_CAUSED_WRITE'; end if;
end
$active_lease_smoke$;

-- Synthetic append-only records isolate the attempt-bound load rule. FK triggers are
-- disabled only for these test rows because the fixture intentionally avoids rebuilding
-- the complete U2 Config/Certification graph; CHECK/hash/Authority logic remains active.
alter table app_data_agent.provider_invocation_intents disable trigger all;
alter table app_data_agent.provider_invocation_dispatch_permits disable trigger all;
alter table app_data_agent.workspace_run_bindings disable trigger all;
alter table app_data_agent.qa_messages disable trigger all;
alter table app_data_agent.qa_conversations disable trigger all;
do $takeover_load_fixture$
declare
  scope_document jsonb := '{
    "app_id":"00000000-0000-4000-8000-00000000da01",
    "tenant_id":"00000000-0000-4000-8000-000000005401",
    "environment":"local",
    "workspace_id":"00000000-0000-4000-8000-000000005401",
    "principal_id":"00000000-0000-4000-8000-000000005402"
  }'::jsonb;
  spec_document jsonb;
  intent_document jsonb;
  permit_one jsonb;
  permit_two jsonb;
  marker_document jsonb;
  committed_at timestamptz := pg_catalog.clock_timestamp();
begin
  spec_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-spec@1.0.0',
    'invocation_id','00000000-0000-4000-8000-000000005411',
    'scope',scope_document,'run_id','00000000-0000-4000-8000-000000005403',
    'certification',pg_catalog.jsonb_build_object(
      'recovery_capabilities',pg_catalog.jsonb_build_array('IDEMPOTENT_REQUEST')));
  intent_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-intent@1.0.0',
    'intent_id','00000000-0000-4000-8000-000000005410',
    'invocation_spec',spec_document,
    'invocation_key_hash',app_data_agent.u2_canonical_sha256(spec_document),
    'state','INTENT_COMMITTED','committed_at',app_data_agent.runtime_iso_timestamp(committed_at));
  intent_document := intent_document || pg_catalog.jsonb_build_object(
    'intent_hash',app_data_agent.u2_canonical_sha256(intent_document));
  insert into app_data_agent.provider_invocation_intents (
    app_id,tenant_id,environment,intent_id,invocation_id,logical_call_id,run_id,
    workspace_id,principal_id,idempotency_key,invocation_key_hash,
    config_id,config_revision,config_hash,model_profile_id,model_config_version,
    model_config_hash,profile_version,provider,model_id,adapter_version,binding_kind,
    provider_connection_id,provider_connection_version,provider_connection_hash,
    certification_run_id,certification_artifact_id,certification_artifact_type,
    certification_revision,certification_hash,certification_execution_profile_hash,
    task_artifact_id,task_artifact_type,task_artifact_revision,task_artifact_hash,
    projection_artifact_id,projection_artifact_type,projection_artifact_revision,
    projection_artifact_hash,projection_receipt_hash,recovery_capabilities,
    token_bound_policy_version,trusted_input_token_upper_bound,reserved_output_tokens,
    effective_max_context_tokens,
    effective_max_output_tokens,provider_call_limit,admission,rejection_reason,
    intent_json,intent_hash,committed_at
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
    'local','00000000-0000-4000-8000-000000005410',
    '00000000-0000-4000-8000-000000005411','00000000-0000-4000-8000-000000005412',
    '00000000-0000-4000-8000-000000005403','00000000-0000-4000-8000-000000005401',
    '00000000-0000-4000-8000-000000005402','u3-takeover-load-smoke',
    app_data_agent.u2_canonical_sha256(spec_document),'00000000-0000-4000-8000-000000005409',1,
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '00000000-0000-4000-8000-000000005413',1,
    'sha256:1313131313131313131313131313131313131313131313131313131313131313',
    'model-profile@1','deepseek','fake-deepseek','adapter@1','MANAGED_CONNECTION',
    '00000000-0000-4000-8000-000000005414',1,
    'sha256:1414141414141414141414141414141414141414141414141414141414141414',
    '00000000-0000-4000-8000-000000005415','00000000-0000-4000-8000-000000005416',
    'ModelCertificationReceipt',1,
    'sha256:1616161616161616161616161616161616161616161616161616161616161616',
    'sha256:1717171717171717171717171717171717171717171717171717171717171717',
    '00000000-0000-4000-8000-000000005417','ProviderTaskArtifact',1,
    'sha256:1818181818181818181818181818181818181818181818181818181818181818',
    '00000000-0000-4000-8000-000000005411','AgentDataProjectionReceipt',1,
    'sha256:1919191919191919191919191919191919191919191919191919191919191919',
    'sha256:1919191919191919191919191919191919191919191919191919191919191919',
    array['IDEMPOTENT_REQUEST']::text[],'utf8-byte-upper-bound@1.0.0',10,5,100,50,1,
    'READY',null,
    intent_document,intent_document ->> 'intent_hash',committed_at
  );

  permit_one := pg_catalog.jsonb_build_object(
    'schema_version','provider-dispatch-permit@1.0.0',
    'permit_id','00000000-0000-4000-8000-000000005421',
    'intent_id','00000000-0000-4000-8000-000000005410',
    'invocation_id','00000000-0000-4000-8000-000000005411','scope',scope_document,
    'run_id','00000000-0000-4000-8000-000000005403',
    'dispatch_hash','sha256:2121212121212121212121212121212121212121212121212121212121212121',
    'context_receipt_ref',pg_catalog.jsonb_build_object(
      'receipt_id','00000000-0000-4000-8000-000000005422',
      'receipt_hash','sha256:2222222222222222222222222222222222222222222222222222222222222222'),
    'lease',pg_catalog.jsonb_build_object(
      'outbox_id','00000000-0000-4000-8000-000000005405',
      'command_id','00000000-0000-4000-8000-000000005404',
      'attempt_id','00000000-0000-4000-8000-000000005406','attempt_no',1,
      'worker_id','u3-worker','lease_token',1,'worker_fence',7),
    'attempt_id','00000000-0000-4000-8000-000000005406','worker_fence',7,
    'committed_at',app_data_agent.runtime_iso_timestamp(committed_at));
  permit_one := permit_one || pg_catalog.jsonb_build_object(
    'permit_hash',app_data_agent.u2_canonical_sha256(permit_one));
  permit_two := pg_catalog.jsonb_set(permit_one,'{permit_id}',
    '"00000000-0000-4000-8000-000000005423"'::jsonb);
  permit_two := pg_catalog.jsonb_set(permit_two,'{dispatch_hash}',
    '"sha256:2323232323232323232323232323232323232323232323232323232323232323"'::jsonb);
  permit_two := pg_catalog.jsonb_set(permit_two,'{attempt_id}',
    '"00000000-0000-4000-8000-000000005424"'::jsonb);
  permit_two := pg_catalog.jsonb_set(permit_two,'{worker_fence}','8'::jsonb);
  permit_two := pg_catalog.jsonb_set(permit_two,'{lease,attempt_id}',
    '"00000000-0000-4000-8000-000000005424"'::jsonb);
  permit_two := pg_catalog.jsonb_set(permit_two,'{lease,attempt_no}','2'::jsonb);
  permit_two := pg_catalog.jsonb_set(permit_two,'{lease,worker_fence}','8'::jsonb);
  permit_two := permit_two || pg_catalog.jsonb_build_object(
    'permit_hash',app_data_agent.u2_canonical_sha256(permit_two - 'permit_hash'));
  insert into app_data_agent.provider_invocation_dispatch_permits (
    app_id,tenant_id,environment,permit_id,intent_id,invocation_id,run_id,dispatch_hash,
    context_receipt_id,context_receipt_hash,attempt_id,outbox_id,command_id,attempt_no,
    worker_id,lease_token,worker_fence,envelope_json,permit_json,permit_hash,committed_at
  ) values
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401','local',
    '00000000-0000-4000-8000-000000005421','00000000-0000-4000-8000-000000005410',
    '00000000-0000-4000-8000-000000005411','00000000-0000-4000-8000-000000005403',
    permit_one ->> 'dispatch_hash','00000000-0000-4000-8000-000000005422',
    permit_one #>> '{context_receipt_ref,receipt_hash}',
    '00000000-0000-4000-8000-000000005406','00000000-0000-4000-8000-000000005405',
    '00000000-0000-4000-8000-000000005404',1,'u3-worker',1,7,
    '{}'::jsonb,permit_one,permit_one ->> 'permit_hash',committed_at),
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401','local',
    '00000000-0000-4000-8000-000000005423','00000000-0000-4000-8000-000000005410',
    '00000000-0000-4000-8000-000000005411','00000000-0000-4000-8000-000000005403',
    permit_two ->> 'dispatch_hash','00000000-0000-4000-8000-000000005425',
    'sha256:2525252525252525252525252525252525252525252525252525252525252525',
    '00000000-0000-4000-8000-000000005424','00000000-0000-4000-8000-000000005426',
    '00000000-0000-4000-8000-000000005427',2,'u3-worker-takeover',2,8,
    '{}'::jsonb,permit_two,permit_two ->> 'permit_hash',committed_at);

  marker_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-dispatch-marker@1.0.0',
    'marker_id','00000000-0000-4000-8000-000000005428',
    'intent_id','00000000-0000-4000-8000-000000005410',
    'invocation_id','00000000-0000-4000-8000-000000005411','scope',scope_document,
    'run_id','00000000-0000-4000-8000-000000005403',
    'dispatch_hash',permit_one ->> 'dispatch_hash','state','DISPATCH_MARKED',
    'dispatch_marked_at',app_data_agent.runtime_iso_timestamp(committed_at));
  marker_document := marker_document || pg_catalog.jsonb_build_object(
    'marker_hash',app_data_agent.u2_canonical_sha256(marker_document));
  insert into app_data_agent.provider_invocation_outcomes (
    app_id,tenant_id,environment,outcome_id,intent_id,invocation_id,run_id,dispatch_hash,
    transition_revision,state,actor_kind,transition_from,recovery_action,dispatch_attempt_no,
    attempt_id,outbox_id,command_id,worker_id,lease_token,worker_fence,dispatch_marked,
    provider_call_may_have_started,provider_call_count,delivery_certainty,started_at,
    outcome_json,outcome_hash,committed_at
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
    'local','00000000-0000-4000-8000-000000005428',
    '00000000-0000-4000-8000-000000005410','00000000-0000-4000-8000-000000005411',
    '00000000-0000-4000-8000-000000005403',permit_one ->> 'dispatch_hash',1,
    'DISPATCH_MARKED','WORKER','INTENT_COMMITTED','NONE',1,
    '00000000-0000-4000-8000-000000005406','00000000-0000-4000-8000-000000005405',
    '00000000-0000-4000-8000-000000005404','u3-worker',1,7,true,true,1,
    'DISPATCHED_OUTCOME_UNKNOWN',committed_at,marker_document,
    marker_document ->> 'marker_hash',committed_at);
  insert into app_data_agent.workspace_run_bindings (
    app_id,tenant_id,environment,run_id,datasource_id,conversation_id,principal_id
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
    'local','00000000-0000-4000-8000-000000005403',
    '00000000-0000-4000-8000-000000005431','00000000-0000-4000-8000-000000005432',
    '00000000-0000-4000-8000-000000005402');
  insert into app_data_agent.qa_conversations (
    app_id,tenant_id,environment,conversation_id,owner_principal_id,title,
    datasource_id,resource_version
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
    'local','00000000-0000-4000-8000-000000005432',
    '00000000-0000-4000-8000-000000005402','U3 task smoke',
    '00000000-0000-4000-8000-000000005431',3);
  insert into app_data_agent.qa_messages (
    app_id,tenant_id,environment,conversation_id,message_id,owner_principal_id,
    role,content,message_type,run_id,metadata
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
    'local','00000000-0000-4000-8000-000000005432',
    '00000000-0000-4000-8000-000000005407','00000000-0000-4000-8000-000000005402',
    'user','U3 protected question','text','00000000-0000-4000-8000-000000005403',
    '{"source":"QUESTION_RUN"}'::jsonb);
  perform pg_catalog.set_config(
    'data_agent.u3_permit_one_hash',permit_one ->> 'permit_hash',true);
  perform pg_catalog.set_config(
    'data_agent.u3_permit_two_hash',permit_two ->> 'permit_hash',true);
end
$takeover_load_fixture$;
alter table app_data_agent.provider_invocation_intents enable trigger all;
alter table app_data_agent.provider_invocation_dispatch_permits enable trigger all;
alter table app_data_agent.workspace_run_bindings enable trigger all;
alter table app_data_agent.qa_messages enable trigger all;
alter table app_data_agent.qa_conversations enable trigger all;
set local role data_agent_backend;
do $takeover_load_smoke$
declare
  scope_document jsonb := '{
    "app_id":"00000000-0000-4000-8000-00000000da01",
    "tenant_id":"00000000-0000-4000-8000-000000005401","environment":"local",
    "workspace_id":"00000000-0000-4000-8000-000000005401",
    "principal_id":"00000000-0000-4000-8000-000000005402"
  }'::jsonb;
  result jsonb;
  command jsonb;
begin
  command := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-load@1.0.0','scope',scope_document,
    'run_id','00000000-0000-4000-8000-000000005403',
    'invocation_id','00000000-0000-4000-8000-000000005411',
    'permit_id','00000000-0000-4000-8000-000000005423',
    'permit_hash',pg_catalog.current_setting('data_agent.u3_permit_two_hash'),
    'dispatch_hash','sha256:2323232323232323232323232323232323232323232323232323232323232323',
    'attempt_id','00000000-0000-4000-8000-000000005424','worker_fence',8);
  result := app_data_agent.load_provider_invocation(command);
  if result <> 'null'::jsonb then
    raise exception 'PROVIDER_TAKEOVER_FRESH_PERMIT_DID_NOT_LOAD_NULL';
  end if;
  command := command || pg_catalog.jsonb_build_object(
    'permit_id','00000000-0000-4000-8000-000000005421',
    'permit_hash',pg_catalog.current_setting('data_agent.u3_permit_one_hash'),
    'dispatch_hash','sha256:2121212121212121212121212121212121212121212121212121212121212121',
    'attempt_id','00000000-0000-4000-8000-000000005406','worker_fence',7);
  result := app_data_agent.load_provider_invocation(command);
  if result #>> '{permit,permit_id}' <> '00000000-0000-4000-8000-000000005421'
    or result #>> '{marker,marker_id}' <> '00000000-0000-4000-8000-000000005428'
    or result -> 'outcome' <> 'null'::jsonb or result -> 'usage' <> 'null'::jsonb
    or result #>> '{projection,provider_call_count}' <> '1'
  then raise exception 'PROVIDER_ATTEMPT_BOUND_MARKER_LOAD_FAILED'; end if;
  begin
    perform app_data_agent.load_provider_invocation(pg_catalog.jsonb_set(
      command,'{permit_hash}',
      '"sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"'::jsonb));
    raise exception 'PROVIDER_LOAD_PERMIT_HASH_MUTATION_WAS_NOT_REJECTED';
  exception when others then
    if sqlerrm <> 'PROVIDER_DISPATCH_PERMIT_NOT_COMMITTED' then raise; end if;
  end;
end
$takeover_load_smoke$;
do $provider_task_artifact_smoke$
declare
  scope_document jsonb := '{
    "app_id":"00000000-0000-4000-8000-00000000da01",
    "tenant_id":"00000000-0000-4000-8000-000000005401","environment":"local",
    "workspace_id":"00000000-0000-4000-8000-000000005401",
    "principal_id":"00000000-0000-4000-8000-000000005402"
  }'::jsonb;
  lease jsonb := '{
    "scope":{"app_id":"00000000-0000-4000-8000-00000000da01","tenant_id":"00000000-0000-4000-8000-000000005401","environment":"local"},
    "principal_id":"00000000-0000-4000-8000-000000005402",
    "outbox_id":"00000000-0000-4000-8000-000000005405",
    "run_id":"00000000-0000-4000-8000-000000005403",
    "command_id":"00000000-0000-4000-8000-000000005404",
    "command_kind":"START_L2_RESEARCH",
    "attempt_id":"00000000-0000-4000-8000-000000005406",
    "attempt_no":1,"delivery_attempt_no":1,"lease_duration_ms":600000,
    "worker_id":"u3-worker","lease_token":1,"worker_fence":7,
    "expires_at":"2099-01-01T00:00:00.000Z",
    "payload":{"kind":"START_L2_RESEARCH","effective_config_ref":{"config_id":"00000000-0000-4000-8000-000000005409","config_revision":1,"config_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}
  }'::jsonb;
  command jsonb;
  result jsonb;
  replay jsonb;
  loaded jsonb;
begin
  command := pg_catalog.jsonb_build_object(
    'schema_version','provider-task-artifact-commit@1.0.0','scope',scope_document,
    'run_id','00000000-0000-4000-8000-000000005403',
    'conversation_binding',pg_catalog.jsonb_build_object(
      'conversation_id','00000000-0000-4000-8000-000000005432','resource_version',3));
  result := app_data_agent.commit_provider_task_artifact(lease,command);
  replay := app_data_agent.commit_provider_task_artifact(lease,command);
  if result ->> 'disposition' <> 'CREATED'
    or replay ->> 'disposition' <> 'REPLAYED'
    or result #>> '{reference,artifact_id}' <> '00000000-0000-4000-8000-000000005407'
    or result #>> '{reference,artifact_type}' <> 'ProviderTaskArtifact'
    or result #>> '{document,message_id}' <> '00000000-0000-4000-8000-000000005407'
    or result #>> '{document,accepted_event_id}' <> '00000000-0000-4000-8000-000000005407'
    or result #>> '{document,question}' <> 'U3 protected question'
    or result ->> 'committed_at' <> replay ->> 'committed_at'
  then raise exception 'PROVIDER_TASK_ARTIFACT_COMMIT_REPLAY_FAILED'; end if;
  loaded := app_data_agent.load_provider_task_artifact(pg_catalog.jsonb_build_object(
    'schema_version','provider-task-artifact-load@1.0.0','scope',scope_document,
    'run_id','00000000-0000-4000-8000-000000005403','reference',result -> 'reference'));
  if loaded -> 'reference' <> result -> 'reference'
    or loaded -> 'document' <> result -> 'document' then
    raise exception 'PROVIDER_TASK_ARTIFACT_LOAD_FAILED';
  end if;
  begin
    perform app_data_agent.commit_provider_task_artifact(lease,pg_catalog.jsonb_set(
      command,'{conversation_binding,resource_version}','4'::jsonb));
    raise exception 'PROVIDER_TASK_ARTIFACT_TAMPER_WAS_NOT_REJECTED';
  exception when others then
    if sqlerrm <> 'PROVIDER_TASK_MESSAGE_NOT_FOUND_OR_FORBIDDEN' then raise; end if;
  end;
end
$provider_task_artifact_smoke$;
reset role;
do $stale_marker_command_fixture$
declare
  intent_document jsonb;
  permit_document jsonb;
  marker_document jsonb;
  candidate jsonb;
  usage_candidate jsonb;
  command jsonb;
begin
  select intent_json into strict intent_document
  from app_data_agent.provider_invocation_intents
  where intent_id = '00000000-0000-4000-8000-000000005410';
  select permit_json into strict permit_document
  from app_data_agent.provider_invocation_dispatch_permits
  where permit_id = '00000000-0000-4000-8000-000000005421';
  select outcome_json into strict marker_document
  from app_data_agent.provider_invocation_outcomes
  where outcome_id = '00000000-0000-4000-8000-000000005428';
  candidate := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-outcome-candidate@1.0.0',
    'intent_id','00000000-0000-4000-8000-000000005410',
    'invocation_id','00000000-0000-4000-8000-000000005411',
    'scope',intent_document #> '{invocation_spec,scope}',
    'run_id','00000000-0000-4000-8000-000000005403',
    'dispatch_hash',permit_document ->> 'dispatch_hash','status','OUTCOME_UNKNOWN',
    'reason_code','PROVIDER_INVOCATION_OUTCOME_UNKNOWN','response_artifact_ref',null,
    'response_hash',null,'delivery_certainty','DISPATCHED_OUTCOME_UNKNOWN',
    'transition_from','DISPATCH_MARKED','recovery_action','SAFE_RETRY',
    'provider_call_count',1,'retry_after_ms',null,'reconciliation_of',null);
  usage_candidate := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-usage-candidate@1.0.0',
    'availability','UNAVAILABLE','source','UNAVAILABLE','input_tokens',null,
    'output_tokens',null,'total_tokens',null,'tool_calls',null,'provider_call_count',1,
    'capacity_status','UNAVAILABLE',
    'unavailable_reason','PROVIDER_INVOCATION_OUTCOME_UNKNOWN');
  command := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-recover-stale-marker@1.0.0',
    'actor','STALE_MARKER_RECOVERY_JOB',
    'recovery_id','00000000-0000-4000-8000-000000005440',
    'intent',intent_document,'permit',permit_document,'marker',marker_document,
    'recovery_capability_used','IDEMPOTENT_REQUEST',
    'recovery_resolution','MARK_OUTCOME_UNKNOWN','outcome',candidate,'usage',usage_candidate);
  perform pg_catalog.set_config('data_agent.u3_stale_recovery_command',command::text,true);
end
$stale_marker_command_fixture$;
set local role data_agent_job_authority;
do $active_marker_recovery_rejected$
begin
  if app_data_agent.recover_next_stale_provider_invocation_marker() is not null then
    raise exception 'PROVIDER_ACTIVE_MARKER_WAS_DISCOVERED_AS_STALE';
  end if;
  begin
    perform app_data_agent.recover_stale_provider_invocation_marker(
      pg_catalog.current_setting('data_agent.u3_stale_recovery_command')::jsonb);
    raise exception 'PROVIDER_ACTIVE_MARKER_RECOVERY_WAS_NOT_REJECTED';
  exception when others then
    if sqlerrm <> 'PROVIDER_STALE_MARKER_LEASE_STILL_ACTIVE' then raise; end if;
  end;
end
$active_marker_recovery_rejected$;
reset role;
alter table app_data_agent.run_attempts disable trigger all;
alter table app_data_agent.outbox disable trigger all;
update app_data_agent.run_attempts
set lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where attempt_id = '00000000-0000-4000-8000-000000005406';
update app_data_agent.outbox
set lease_expires_at = pg_catalog.clock_timestamp() - interval '1 second'
where outbox_id = '00000000-0000-4000-8000-000000005405';
alter table app_data_agent.run_attempts enable trigger all;
alter table app_data_agent.outbox enable trigger all;
set local role data_agent_job_authority;
do $stale_marker_recovery_smoke$
declare
  command jsonb := pg_catalog.current_setting('data_agent.u3_stale_recovery_command')::jsonb;
  result jsonb;
  replay jsonb;
  classified jsonb;
begin
  result := app_data_agent.recover_next_stale_provider_invocation_marker();
  command := pg_catalog.jsonb_set(
    command,'{recovery_id}',pg_catalog.to_jsonb(result #>> '{recovery_receipt,recovery_id}'));
  replay := app_data_agent.recover_stale_provider_invocation_marker(command);
  classified := app_data_agent.discover_next_provider_invocation_unknown();
  if result ->> 'disposition' <> 'CREATED'
    or replay ->> 'disposition' <> 'REPLAYED'
    or app_data_agent.recover_next_stale_provider_invocation_marker() is not null
    or result #>> '{recovery_receipt_ref,artifact_type}' <>
      'ProviderStaleMarkerRecoveryReceipt'
    or result #>> '{recovery_receipt,lease_status}' <> 'INACTIVE'
    or result #>> '{outcome,candidate,status}' <> 'OUTCOME_UNKNOWN'
    or result #>> '{usage,availability}' <> 'UNAVAILABLE'
    or result #>> '{projection,status}' <> 'OUTCOME_UNKNOWN'
    or result #>> '{projection,provider_call_count}' <> '1'
    or classified is not null
  then raise exception 'PROVIDER_STALE_MARKER_RECOVERY_REPLAY_FAILED'; end if;
end
$stale_marker_recovery_smoke$;
reset role;
-- Clone the already validated UNKNOWN lineage into an ALO-only rollback fixture. This
-- isolates the read-only operator classification contract without invoking a Provider.
alter table app_data_agent.provider_invocation_intents disable trigger all;
alter table app_data_agent.provider_invocation_dispatch_permits disable trigger all;
alter table app_data_agent.provider_invocation_outcomes disable trigger all;
alter table app_data_agent.provider_invocation_usage_receipts disable trigger all;
do $alo_unknown_classification_fixture$
declare
  source_intent app_data_agent.provider_invocation_intents%rowtype;
  source_permit app_data_agent.provider_invocation_dispatch_permits%rowtype;
  source_outcome app_data_agent.provider_invocation_outcomes%rowtype;
  source_usage app_data_agent.provider_invocation_usage_receipts%rowtype;
  spec_document jsonb;
  intent_document jsonb;
  permit_document jsonb;
  outcome_document jsonb;
  usage_document jsonb;
begin
  select * into strict source_intent from app_data_agent.provider_invocation_intents
  where intent_id = '00000000-0000-4000-8000-000000005410';
  select * into strict source_permit from app_data_agent.provider_invocation_dispatch_permits
  where permit_id = '00000000-0000-4000-8000-000000005421';
  select * into strict source_outcome from app_data_agent.provider_invocation_outcomes
  where intent_id = source_intent.intent_id and state = 'OUTCOME_UNKNOWN';
  select * into strict source_usage from app_data_agent.provider_invocation_usage_receipts
  where intent_id = source_intent.intent_id and outcome_id = source_outcome.outcome_id;

  spec_document := pg_catalog.jsonb_set(
    source_intent.intent_json -> 'invocation_spec','{invocation_id}',
    '"00000000-0000-4000-8000-000000005491"'::jsonb);
  spec_document := pg_catalog.jsonb_set(
    spec_document,'{certification,recovery_capabilities}',
    '["AT_LEAST_ONCE_ONLY"]'::jsonb);
  intent_document := pg_catalog.jsonb_set(
    source_intent.intent_json - 'intent_hash','{intent_id}',
    '"00000000-0000-4000-8000-000000005490"'::jsonb);
  intent_document := pg_catalog.jsonb_set(intent_document,'{invocation_spec}',spec_document);
  intent_document := pg_catalog.jsonb_set(
    intent_document,'{invocation_key_hash}',
    pg_catalog.to_jsonb(app_data_agent.u2_canonical_sha256(spec_document)));
  intent_document := intent_document || pg_catalog.jsonb_build_object(
    'intent_hash',app_data_agent.u2_canonical_sha256(intent_document));
  insert into app_data_agent.provider_invocation_intents
  select populated.* from pg_catalog.jsonb_populate_record(
    null::app_data_agent.provider_invocation_intents,
    pg_catalog.to_jsonb(source_intent) || pg_catalog.jsonb_build_object(
      'intent_id','00000000-0000-4000-8000-000000005490',
      'invocation_id','00000000-0000-4000-8000-000000005491',
      'logical_call_id','00000000-0000-4000-8000-000000005492',
      'idempotency_key','u3-alo-unknown-classification',
      'invocation_key_hash',app_data_agent.u2_canonical_sha256(spec_document),
      'recovery_capabilities',pg_catalog.jsonb_build_array('AT_LEAST_ONCE_ONLY'),
      'intent_json',intent_document,'intent_hash',intent_document ->> 'intent_hash')) populated;

  permit_document := pg_catalog.jsonb_set(
    source_permit.permit_json - 'permit_hash','{permit_id}',
    '"00000000-0000-4000-8000-000000005493"'::jsonb);
  permit_document := pg_catalog.jsonb_set(
    permit_document,'{intent_id}','"00000000-0000-4000-8000-000000005490"'::jsonb);
  permit_document := pg_catalog.jsonb_set(
    permit_document,'{invocation_id}','"00000000-0000-4000-8000-000000005491"'::jsonb);
  permit_document := pg_catalog.jsonb_set(
    permit_document,'{dispatch_hash}',
    '"sha256:9393939393939393939393939393939393939393939393939393939393939393"'::jsonb);
  permit_document := permit_document || pg_catalog.jsonb_build_object(
    'permit_hash',app_data_agent.u2_canonical_sha256(permit_document));
  insert into app_data_agent.provider_invocation_dispatch_permits
  select populated.* from pg_catalog.jsonb_populate_record(
    null::app_data_agent.provider_invocation_dispatch_permits,
    pg_catalog.to_jsonb(source_permit) || pg_catalog.jsonb_build_object(
      'permit_id','00000000-0000-4000-8000-000000005493',
      'intent_id','00000000-0000-4000-8000-000000005490',
      'invocation_id','00000000-0000-4000-8000-000000005491',
      'dispatch_hash','sha256:9393939393939393939393939393939393939393939393939393939393939393',
      'permit_json',permit_document,'permit_hash',permit_document ->> 'permit_hash')) populated;

  outcome_document := pg_catalog.jsonb_set(
    source_outcome.outcome_json - 'outcome_hash','{outcome_id}',
    '"00000000-0000-4000-8000-000000005494"'::jsonb);
  outcome_document := pg_catalog.jsonb_set(
    outcome_document,'{candidate,intent_id}',
    '"00000000-0000-4000-8000-000000005490"'::jsonb);
  outcome_document := pg_catalog.jsonb_set(
    outcome_document,'{candidate,invocation_id}',
    '"00000000-0000-4000-8000-000000005491"'::jsonb);
  outcome_document := pg_catalog.jsonb_set(
    outcome_document,'{candidate,dispatch_hash}',
    '"sha256:9393939393939393939393939393939393939393939393939393939393939393"'::jsonb);
  outcome_document := pg_catalog.jsonb_set(
    outcome_document,'{candidate,recovery_action}','"MANUAL_REVIEW_REQUIRED"'::jsonb);
  outcome_document := outcome_document || pg_catalog.jsonb_build_object(
    'outcome_hash',app_data_agent.u2_canonical_sha256(outcome_document));
  insert into app_data_agent.provider_invocation_outcomes
  select populated.* from pg_catalog.jsonb_populate_record(
    null::app_data_agent.provider_invocation_outcomes,
    pg_catalog.to_jsonb(source_outcome) || pg_catalog.jsonb_build_object(
      'outcome_id','00000000-0000-4000-8000-000000005494',
      'intent_id','00000000-0000-4000-8000-000000005490',
      'invocation_id','00000000-0000-4000-8000-000000005491',
      'dispatch_hash','sha256:9393939393939393939393939393939393939393939393939393939393939393',
      'recovery_action','MANUAL_REVIEW_REQUIRED',
      'recovery_capability_used','AT_LEAST_ONCE_ONLY',
      'reconciliation_id','00000000-0000-4000-8000-000000005495',
      'outcome_json',outcome_document,'outcome_hash',outcome_document ->> 'outcome_hash')) populated;

  usage_document := pg_catalog.jsonb_set(
    source_usage.usage_json - 'usage_hash','{usage_receipt_id}',
    '"00000000-0000-4000-8000-000000005496"'::jsonb);
  usage_document := pg_catalog.jsonb_set(
    usage_document,'{outcome_id}','"00000000-0000-4000-8000-000000005494"'::jsonb);
  usage_document := pg_catalog.jsonb_set(
    usage_document,'{intent_id}','"00000000-0000-4000-8000-000000005490"'::jsonb);
  usage_document := pg_catalog.jsonb_set(
    usage_document,'{invocation_id}','"00000000-0000-4000-8000-000000005491"'::jsonb);
  usage_document := usage_document || pg_catalog.jsonb_build_object(
    'usage_hash',app_data_agent.u2_canonical_sha256(usage_document));
  insert into app_data_agent.provider_invocation_usage_receipts
  select populated.* from pg_catalog.jsonb_populate_record(
    null::app_data_agent.provider_invocation_usage_receipts,
    pg_catalog.to_jsonb(source_usage) || pg_catalog.jsonb_build_object(
      'usage_receipt_id','00000000-0000-4000-8000-000000005496',
      'intent_id','00000000-0000-4000-8000-000000005490',
      'invocation_id','00000000-0000-4000-8000-000000005491',
      'outcome_id','00000000-0000-4000-8000-000000005494',
      'outcome_hash',outcome_document ->> 'outcome_hash',
      'usage_json',usage_document,'usage_hash',usage_document ->> 'usage_hash')) populated;
end
$alo_unknown_classification_fixture$;
alter table app_data_agent.provider_invocation_intents enable trigger all;
alter table app_data_agent.provider_invocation_dispatch_permits enable trigger all;
alter table app_data_agent.provider_invocation_outcomes enable trigger all;
alter table app_data_agent.provider_invocation_usage_receipts enable trigger all;
set local role data_agent_job_authority;
do $alo_unknown_classification_smoke$
declare
  first_result jsonb;
  replay_result jsonb;
begin
  first_result := app_data_agent.discover_next_provider_invocation_unknown();
  replay_result := app_data_agent.discover_next_provider_invocation_unknown();
  if first_result <> replay_result
    or first_result ->> 'schema_version' <>
      'provider-invocation-unknown-classification@1.0.0'
    or first_result ->> 'invocation_id' <> '00000000-0000-4000-8000-000000005491'
    or first_result ->> 'recovery_capability_used' <> 'AT_LEAST_ONCE_ONLY'
    or first_result ->> 'recovery_action' <> 'MANUAL_REVIEW_REQUIRED'
    or first_result ->> 'required_action' <> 'MANUAL_REVIEW_REQUIRED'
  then raise exception 'PROVIDER_ALO_UNKNOWN_CLASSIFICATION_FAILED'; end if;
end
$alo_unknown_classification_smoke$;
reset role;
alter table app_data_agent.run_attempts disable trigger all;
alter table app_data_agent.outbox disable trigger all;
update app_data_agent.run_attempts
set status = 'ACTIVE',lease_expires_at = pg_catalog.clock_timestamp() + interval '10 minutes',
  last_heartbeat_at = pg_catalog.clock_timestamp()
where attempt_id = '00000000-0000-4000-8000-000000005406';
update app_data_agent.outbox
set status = 'LEASED',lease_expires_at = pg_catalog.clock_timestamp() + interval '10 minutes',
  last_heartbeat_at = pg_catalog.clock_timestamp(),lease_owner = 'u3-worker',lease_token = 1,
  active_attempt_id = '00000000-0000-4000-8000-000000005406',run_fence = 7
where outbox_id = '00000000-0000-4000-8000-000000005405';
alter table app_data_agent.run_attempts enable trigger all;
alter table app_data_agent.outbox enable trigger all;
alter table app_data_agent.artifacts disable trigger all;
do $non_alo_profile_fixture$
declare
  profile_id constant uuid := '00000000-0000-4000-8000-000000005497';
  certification_id constant uuid := '00000000-0000-4000-8000-000000005498';
  managed_profile_id constant uuid := '00000000-0000-4000-8000-000000005499';
  managed_certification_id constant uuid := '00000000-0000-4000-8000-00000000549a';
  deployment_record platform.deployment_mappings%rowtype;
  connection_document jsonb;
  profile_snapshot jsonb;
  certification_document jsonb;
  certification_hash text;
begin
  select mapping.* into strict deployment_record
  from platform.deployment_mappings as mapping
  where mapping.app_id = '00000000-0000-4000-8000-00000000da01'
    and mapping.environment = 'local'
    and mapping.deployment_id = '00000000-0000-4000-8000-000000000001';
  connection_document := pg_catalog.jsonb_build_object(
    'kind','SYSTEM_DEPLOYMENT','deployment_id',deployment_record.deployment_id,
    'deployment_revision',1,'deployment_hash',app_data_agent.u2_canonical_sha256(
      pg_catalog.jsonb_build_object(
        'deployment_id',deployment_record.deployment_id,
        'app_id',deployment_record.app_id,'environment',deployment_record.environment,
        'deployment_key_hash',deployment_record.deployment_key_hash)));
  insert into app_data_agent.model_catalog_entries (
    app_id,environment,model_profile_id,provider,model_id,display_name,base_url,
    capabilities,credential_ref,status,config_version,is_system_default,created_by
  ) values (
    '00000000-0000-4000-8000-00000000da01','local',profile_id,'deepseek',
    'deepseek-non-alo-fixture','DeepSeek non-ALO fixture','https://api.deepseek.com',
    '{"structured_output":true,"tool_calling":true,"streaming":true,"reasoning":true,"vision":false}',
    null,'ACTIVE',1,false,'00000000-0000-4000-8000-000000005402');
  insert into app_data_agent.model_config_versions (
    app_id,environment,model_profile_id,config_version,snapshot,actor_principal_id
  ) values (
    '00000000-0000-4000-8000-00000000da01','local',profile_id,1,
    '{"provider":"deepseek","model_id":"deepseek-non-alo-fixture","status":"ACTIVE"}',
    '00000000-0000-4000-8000-000000005402');
  profile_snapshot := pg_catalog.jsonb_build_object(
    'profile_id',profile_id,
    'scope',pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-000000005401','environment','local'),
    'provider','deepseek','model_id','deepseek-non-alo-fixture',
    'model_config_version',1,'profile_version','model-profile@1',
    'adapter_version','deepseek-adapter@1.0.0',
    'recovery_capabilities',pg_catalog.jsonb_build_array('IDEMPOTENT_REQUEST'),
    'connection',connection_document,
    'capabilities','{"structured_output":true,"tool_calling":true,"streaming":true,"reasoning":true,"vision":false}'::jsonb,
    'context_window',pg_catalog.jsonb_build_object(
      'verification_status','VERIFIED','max_context_tokens',1000000,
      'max_output_tokens',100000),
    'region_privacy','{}'::jsonb,'fallback_compatibility','{}'::jsonb);
  certification_document := pg_catalog.jsonb_build_object(
    'schema_version','model-execution-certification@1.0.0',
    'receipt_ref',pg_catalog.jsonb_build_object(
      'artifact_id',certification_id,'artifact_type','ModelCertificationReceipt',
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-000000005401','environment','local',
      'run_id','00000000-0000-4000-8000-000000005403','revision',1,
      'content_hash','sha256:0000000000000000000000000000000000000000000000000000000000000000'),
    'profile_id',profile_id,'model_config_version',1,'provider','deepseek',
    'model_id','deepseek-non-alo-fixture','profile_version','model-profile@1',
    'adapter_version','deepseek-adapter@1.0.0',
    'execution_profile_hash',app_data_agent.u2_canonical_sha256(profile_snapshot),
    'execution_profile_snapshot',profile_snapshot,
    'recovery_capabilities',pg_catalog.jsonb_build_array('IDEMPOTENT_REQUEST'),
    'connection',connection_document,
    'certification_basis',pg_catalog.jsonb_build_object(
      'kind','GOAL_PREFLIGHT_ATTESTATION','observed_provider','deepseek',
      'observed_model_id','deepseek-non-alo-fixture'),'verdict','PASS');
  certification_hash := app_data_agent.u2_canonical_sha256(
    certification_document #- '{receipt_ref,content_hash}');
  certification_document := pg_catalog.jsonb_set(
    certification_document,'{receipt_ref,content_hash}',pg_catalog.to_jsonb(certification_hash));
  insert into app_data_agent.artifacts (
    app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,
    content_hash,document_json,worker_fence,is_active
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
    'local','00000000-0000-4000-8000-000000005403',certification_id,
    'ModelCertificationReceipt',1,certification_hash,certification_document,7,true);

  connection_document := pg_catalog.jsonb_build_object(
    'kind','MANAGED_CONNECTION',
    'provider_connection_id','00000000-0000-4000-8000-00000000549b',
    'config_version',1,
    'connection_hash','sha256:9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b9b');
  insert into app_data_agent.model_catalog_entries (
    app_id,environment,model_profile_id,provider,model_id,display_name,base_url,
    capabilities,credential_ref,status,config_version,is_system_default,created_by
  ) values (
    '00000000-0000-4000-8000-00000000da01','local',managed_profile_id,'deepseek',
    'deepseek-managed-alo-fixture','DeepSeek managed ALO fixture','https://api.deepseek.com',
    '{"structured_output":true,"tool_calling":true,"streaming":true,"reasoning":true,"vision":false}',
    null,'ACTIVE',1,false,'00000000-0000-4000-8000-000000005402');
  insert into app_data_agent.model_config_versions (
    app_id,environment,model_profile_id,config_version,snapshot,actor_principal_id
  ) values (
    '00000000-0000-4000-8000-00000000da01','local',managed_profile_id,1,
    '{"provider":"deepseek","model_id":"deepseek-managed-alo-fixture","status":"ACTIVE"}',
    '00000000-0000-4000-8000-000000005402');
  profile_snapshot := pg_catalog.jsonb_build_object(
    'profile_id',managed_profile_id,
    'scope',pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-000000005401','environment','local'),
    'provider','deepseek','model_id','deepseek-managed-alo-fixture',
    'model_config_version',1,'profile_version','model-profile@1',
    'adapter_version','deepseek-adapter@1.0.0',
    'recovery_capabilities',pg_catalog.jsonb_build_array('AT_LEAST_ONCE_ONLY'),
    'connection',connection_document,
    'capabilities','{"structured_output":true,"tool_calling":true,"streaming":true,"reasoning":true,"vision":false}'::jsonb,
    'context_window',pg_catalog.jsonb_build_object(
      'verification_status','VERIFIED','max_context_tokens',1000000,
      'max_output_tokens',100000),
    'region_privacy','{}'::jsonb,'fallback_compatibility','{}'::jsonb);
  certification_document := pg_catalog.jsonb_build_object(
    'schema_version','model-execution-certification@1.0.0',
    'receipt_ref',pg_catalog.jsonb_build_object(
      'artifact_id',managed_certification_id,'artifact_type','ModelCertificationReceipt',
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-000000005401','environment','local',
      'run_id','00000000-0000-4000-8000-000000005403','revision',1,
      'content_hash','sha256:0000000000000000000000000000000000000000000000000000000000000000'),
    'profile_id',managed_profile_id,'model_config_version',1,'provider','deepseek',
    'model_id','deepseek-managed-alo-fixture','profile_version','model-profile@1',
    'adapter_version','deepseek-adapter@1.0.0',
    'execution_profile_hash',app_data_agent.u2_canonical_sha256(profile_snapshot),
    'execution_profile_snapshot',profile_snapshot,
    'recovery_capabilities',pg_catalog.jsonb_build_array('AT_LEAST_ONCE_ONLY'),
    'connection',connection_document,
    'certification_basis',pg_catalog.jsonb_build_object(
      'kind','GOAL_PREFLIGHT_ATTESTATION','observed_provider','deepseek',
      'observed_model_id','deepseek-managed-alo-fixture'),'verdict','PASS');
  certification_hash := app_data_agent.u2_canonical_sha256(
    certification_document #- '{receipt_ref,content_hash}');
  certification_document := pg_catalog.jsonb_set(
    certification_document,'{receipt_ref,content_hash}',pg_catalog.to_jsonb(certification_hash));
  insert into app_data_agent.artifacts (
    app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,
    content_hash,document_json,worker_fence,is_active
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
    'local','00000000-0000-4000-8000-000000005403',managed_certification_id,
    'ModelCertificationReceipt',1,certification_hash,certification_document,7,true);
end
$non_alo_profile_fixture$;
alter table app_data_agent.artifacts enable trigger all;

-- Isolate the U3 recovery-driver admission branch behind already-correlated U2 rows.
-- The replacement remains inside this rollback-only transaction and only avoids
-- rebuilding U2 semantic/default parents that are independently covered by assertion 31.
create or replace function app_data_agent.revalidate_effective_run_config_internal(
  requested_config_id uuid,
  requested_config_revision bigint,
  requested_config_hash text,
  requested_run_id uuid,
  require_write boolean
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $function$
  select config.effective_config_json || pg_catalog.jsonb_build_object(
    'config_hash',config.config_hash)
  from app_data_agent.effective_run_config_receipts as config
  where config.config_id = requested_config_id
    and config.config_revision = requested_config_revision
    and config.config_hash = requested_config_hash
    and config.run_id = requested_run_id
    and require_write;
$function$;
alter table app_data_agent.effective_run_config_receipts disable trigger all;
alter table app_data_agent.effective_run_config_resource_bindings disable trigger all;
alter table app_data_agent.effective_config_context_receipts disable trigger all;
alter table app_data_agent.artifacts disable trigger all;
-- The legacy generic Artifact check treats every technical `*_token_*` key as a
-- credential. U3 projection authorization has its own strict no-raw validator;
-- drop this unrelated legacy CHECK only inside the rollback-only fixture.
alter table app_data_agent.artifacts drop constraint artifacts_document_json_check;
do $non_alo_begin_fixture$
declare
  config_document jsonb;
  config_hash text;
  context_document jsonb := '{"fixture":"u3-non-alo-context"}'::jsonb;
  task_document jsonb;
  task_hash text;
  task_reference jsonb;
  projection_document jsonb;
  projection_hash text;
begin
  config_document := pg_catalog.jsonb_build_object(
    'model',pg_catalog.jsonb_build_object(
      'resource_hash','sha256:a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7'),
    'effective_egress',pg_catalog.jsonb_build_object(
      'allowed_providers',pg_catalog.jsonb_build_array('deepseek')));
  config_hash := app_data_agent.u2_canonical_sha256(config_document);
  insert into app_data_agent.effective_run_config_receipts (
    app_id,tenant_id,environment,config_id,config_revision,config_hash,run_id,
    principal_id,idempotency_key,request_hash,operation_kind,admission,
    defaults_revision,defaults_id,defaults_hash,membership_version,user_authz_epoch,
    workspace_lifecycle_version,app_epoch,route_resolution_id,route_resolution_hash,
    resolver_policy_version,model_profile_id,model_config_version,provider,model_id,
    datasource_id,datasource_revision_hash,schema_datasource_id,datasource_fingerprint,
    semantic_domain,semantic_release_id,semantic_release_generation,
    semantic_release_digest,schema_snapshot_hash,context_policy_hash,egress_policy_hash,
    execution_safety_policy_hash,provider_audience,classification,effective_config_json
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
    'local','00000000-0000-4000-8000-000000005409',1,config_hash,
    '00000000-0000-4000-8000-000000005403','00000000-0000-4000-8000-000000005402',
    'u3-non-alo-begin','sha256:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
    'QUESTION_RUN','READY',1,'00000000-0000-4000-8000-0000000054a0',
    'sha256:a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0',
    1,1,1,1,'00000000-0000-4000-8000-0000000054a1',
    'sha256:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
    'u3-test-resolver@1.0.0','00000000-0000-4000-8000-000000005497',1,
    'deepseek','deepseek-non-alo-fixture','00000000-0000-4000-8000-0000000054a2',
    'sha256:a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2',
    '00000000-0000-4000-8000-0000000054a2',
    'sha256:a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3',
    'u3_fixture','00000000-0000-4000-8000-0000000054a3',1,
    'sha256:a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4',
    'sha256:a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5',
    'sha256:a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6a6',
    'sha256:a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7',
    'sha256:a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8',
    'PRIVATE','INTERNAL',config_document);
  insert into app_data_agent.effective_run_config_resource_bindings (
    app_id,tenant_id,environment,config_id,config_revision,binding_ordinal,
    resource_kind,resource_id,requested_mode,requested_revision,effective_revision,
    effective_hash,availability,binding_json
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
    'local','00000000-0000-4000-8000-000000005409',1,1,'MODEL_PROFILE',
    '00000000-0000-4000-8000-000000005497','RESOURCE_IDS','1','1',
    'sha256:a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7',
    'AVAILABLE','{"fixture":"u3-non-alo-model-binding"}');
  insert into app_data_agent.effective_config_context_receipts (
    app_id,tenant_id,environment,context_receipt_id,config_id,config_revision,
    config_hash,run_id,principal_id,consumer_kind,consumer_id,attempt_id,worker_id,
    lease_token,outbox_id,command_id,worker_fence,receipt_json,receipt_hash
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
    'local','00000000-0000-4000-8000-0000000054a4',
    '00000000-0000-4000-8000-000000005409',1,config_hash,
    '00000000-0000-4000-8000-000000005403','00000000-0000-4000-8000-000000005402',
    'WORKER_START','u3-worker','00000000-0000-4000-8000-000000005406','u3-worker',
    1,'00000000-0000-4000-8000-000000005405','00000000-0000-4000-8000-000000005404',
    7,context_document,app_data_agent.u2_canonical_sha256(context_document));
  task_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-task-artifact@1.0.0','fixture','u3-non-alo-task');
  task_hash := app_data_agent.u2_canonical_sha256(task_document);
  insert into app_data_agent.artifacts (
    app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,
    content_hash,document_json,worker_fence,is_active
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
    'local','00000000-0000-4000-8000-000000005403',
    '00000000-0000-4000-8000-0000000054a5','ProviderTaskArtifact',1,
    task_hash,task_document,7,true);
  task_reference := pg_catalog.jsonb_build_object(
    'artifact_id','00000000-0000-4000-8000-0000000054a5',
    'artifact_type','ProviderTaskArtifact','app_id','00000000-0000-4000-8000-00000000da01',
    'tenant_id','00000000-0000-4000-8000-000000005401','environment','local',
    'run_id','00000000-0000-4000-8000-000000005403','revision',1,
    'content_hash',task_hash);
  projection_document := pg_catalog.jsonb_build_object(
    'artifact_type','AgentDataProjectionReceipt','protocol_version','agent-data-projection@2.0.0',
    'receipt_id','00000000-0000-4000-8000-0000000054a6',
    'scope',pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-000000005401','environment','local'),
    'run_id','00000000-0000-4000-8000-000000005403',
    'request_id','00000000-0000-4000-8000-0000000054a6',
    'principal_id','00000000-0000-4000-8000-000000005402',
    'model_execution_profile_hash',(select document_json ->> 'execution_profile_hash'
      from app_data_agent.artifacts where artifact_id = '00000000-0000-4000-8000-000000005498'),
    'input_refs',pg_catalog.jsonb_build_array(task_reference),
    'approved_fields',pg_catalog.jsonb_build_array('question'),'classification','INTERNAL',
    'payload_hash','sha256:a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9',
    'token_bound_policy_version','utf8-byte-upper-bound@1.0.0',
    'trusted_input_token_upper_bound',10,
    'redaction',pg_catalog.jsonb_build_object('count',0,'policy_version','redaction@1.0.0'),
    'dlp',pg_catalog.jsonb_build_object('status','PASS','policy_version','dlp@1.0.0'),
    'taint',pg_catalog.jsonb_build_object(
      'policy_version','taint@1.0.0',
      'taint_hash','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
  projection_hash := app_data_agent.u2_canonical_sha256(projection_document);
  projection_document := projection_document || pg_catalog.jsonb_build_object(
    'receipt_hash',projection_hash);
  insert into app_data_agent.artifacts (
    app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,
    content_hash,document_json,worker_fence,is_active
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005401',
    'local','00000000-0000-4000-8000-000000005403',
    '00000000-0000-4000-8000-0000000054a6','AgentDataProjectionReceipt',1,
    projection_hash,projection_document,7,true);
end
$non_alo_begin_fixture$;
alter table app_data_agent.effective_run_config_receipts enable trigger all;
alter table app_data_agent.effective_run_config_resource_bindings enable trigger all;
alter table app_data_agent.effective_config_context_receipts enable trigger all;
alter table app_data_agent.artifacts enable trigger all;
do $non_alo_begin_rejected$
declare
  lease jsonb;
  envelope jsonb;
  invocation_key_draft jsonb;
  command jsonb;
  result jsonb;
  replay jsonb;
  certification_document jsonb;
  task_reference jsonb;
  projection_reference jsonb;
  config_hash text;
begin
  select document_json into strict certification_document
  from app_data_agent.artifacts
  where artifact_id = '00000000-0000-4000-8000-000000005498';
  select content_hash into strict config_hash
  from app_data_agent.artifacts
  where artifact_id = '00000000-0000-4000-8000-0000000054a5';
  task_reference := pg_catalog.jsonb_build_object(
    'artifact_id','00000000-0000-4000-8000-0000000054a5',
    'artifact_type','ProviderTaskArtifact','app_id','00000000-0000-4000-8000-00000000da01',
    'tenant_id','00000000-0000-4000-8000-000000005401','environment','local',
    'run_id','00000000-0000-4000-8000-000000005403','revision',1,'content_hash',config_hash);
  select pg_catalog.jsonb_build_object(
    'artifact_id',artifact_id,'artifact_type',artifact_type,'app_id',app_id,
    'tenant_id',tenant_id,'environment',environment,'run_id',run_id,
    'revision',revision,'content_hash',content_hash)
  into strict projection_reference
  from app_data_agent.artifacts
  where artifact_id = '00000000-0000-4000-8000-0000000054a6';
  select receipt_hash into strict config_hash
  from app_data_agent.effective_config_context_receipts
  where context_receipt_id = '00000000-0000-4000-8000-0000000054a4';
  lease := pg_catalog.jsonb_build_object(
    'scope',pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-000000005401','environment','local'),
    'principal_id','00000000-0000-4000-8000-000000005402',
    'outbox_id','00000000-0000-4000-8000-000000005405',
    'run_id','00000000-0000-4000-8000-000000005403',
    'command_id','00000000-0000-4000-8000-000000005404',
    'command_kind','START_L2_RESEARCH','attempt_id','00000000-0000-4000-8000-000000005406',
    'attempt_no',1,'delivery_attempt_no',1,'lease_duration_ms',600000,
    'worker_id','u3-worker','lease_token',1,'worker_fence',7,
    'expires_at',app_data_agent.runtime_iso_timestamp(pg_catalog.clock_timestamp() + interval '5 minutes'),
    'payload',pg_catalog.jsonb_build_object(
      'kind','START_L2_RESEARCH','effective_config_ref',pg_catalog.jsonb_build_object(
        'config_id','00000000-0000-4000-8000-000000005409','config_revision',1,
        'config_hash',(select receipt.config_hash
          from app_data_agent.effective_run_config_receipts as receipt
          where receipt.config_id = '00000000-0000-4000-8000-000000005409'))));
  envelope := pg_catalog.jsonb_build_object(
    'schema_version','provider-dispatch-envelope@1.0.0',
    'invocation_id','00000000-0000-4000-8000-0000000054a6',
    'idempotency_key','u3-non-alo-begin-rejected',
    'scope',pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-000000005401','environment','local',
      'workspace_id','00000000-0000-4000-8000-000000005401',
      'principal_id','00000000-0000-4000-8000-000000005402'),
    'run_id','00000000-0000-4000-8000-000000005403',
    'logical_call_id','00000000-0000-4000-8000-000000005404',
    'task_ref',task_reference,'effective_config_ref',lease #> '{payload,effective_config_ref}',
    'context_receipt_ref',pg_catalog.jsonb_build_object(
      'receipt_id','00000000-0000-4000-8000-0000000054a4','receipt_hash',config_hash),
    'lease',pg_catalog.jsonb_build_object(
      'outbox_id','00000000-0000-4000-8000-000000005405',
      'command_id','00000000-0000-4000-8000-000000005404',
      'attempt_id','00000000-0000-4000-8000-000000005406','attempt_no',1,
      'worker_id','u3-worker','lease_token',1,'worker_fence',7),
    'model_profile',pg_catalog.jsonb_build_object(
      'profile_id','00000000-0000-4000-8000-000000005497','model_config_version',1,
      'resource_hash','sha256:a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7a7',
      'profile_version','model-profile@1','provider','deepseek',
      'model_id','deepseek-non-alo-fixture','adapter_version','deepseek-adapter@1.0.0'),
    'certification',pg_catalog.jsonb_build_object(
      'receipt_ref',certification_document -> 'receipt_ref',
      'execution_profile_hash',certification_document -> 'execution_profile_hash',
      'recovery_capabilities',certification_document -> 'recovery_capabilities',
      'certified_context_window',certification_document #> '{execution_profile_snapshot,context_window}'),
    'connection',certification_document -> 'connection',
    'request_policy',pg_catalog.jsonb_build_object(
      'response_schema_version','provider-response@1.0.0','tool_allowlist','[]'::jsonb,
      'budget',pg_catalog.jsonb_build_object(
        'timeout_ms',60000,'max_input_tokens',100,'max_output_tokens',50,
        'max_tool_calls',0,'provider_call_limit',1)),
    'projection',pg_catalog.jsonb_build_object(
      'projection_version','agent-data-projection@2.0.0','receipt_ref',projection_reference,
      'payload_hash','sha256:a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9a9',
      'token_bound_policy_version','utf8-byte-upper-bound@1.0.0',
      'trusted_input_token_upper_bound',10,'reserved_output_tokens',5,
      'effective_context_ceiling_tokens',1000000,'effective_output_ceiling_tokens',100000,
      'capacity_status','WITHIN_LIMIT',
      'taint_hash','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'));
  invocation_key_draft := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-spec@1.0.0',
    'invocation_id',envelope -> 'invocation_id','idempotency_key',envelope -> 'idempotency_key',
    'scope',envelope -> 'scope','run_id',envelope -> 'run_id',
    'logical_call_id',envelope -> 'logical_call_id','task_ref',envelope -> 'task_ref',
    'effective_config_ref',envelope -> 'effective_config_ref',
    'model_profile',envelope -> 'model_profile','certification',envelope -> 'certification',
    'connection',envelope -> 'connection','request_policy',envelope -> 'request_policy',
    'projection',envelope -> 'projection');
  envelope := envelope || pg_catalog.jsonb_build_object(
    'invocation_key_hash',app_data_agent.u2_canonical_sha256(invocation_key_draft));
  envelope := envelope || pg_catalog.jsonb_build_object(
    'dispatch_hash',app_data_agent.u2_canonical_sha256(envelope));
  command := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-begin@1.0.0','envelope',envelope);
  if not app_data_agent.provider_json_object_has_exact_keys(envelope,array[
      'schema_version','invocation_id','idempotency_key','scope','run_id','logical_call_id',
      'task_ref','effective_config_ref','context_receipt_ref','lease','model_profile',
      'certification','connection','request_policy','projection','invocation_key_hash','dispatch_hash'
    ]::text[])
  then
    raise exception 'PROVIDER_NON_ALO_FIXTURE_ENVELOPE_KEYS_INVALID:%',envelope;
  end if;
  if app_data_agent.contains_potential_plaintext_secret(
      envelope
        #- '{lease,lease_token}'
        #- '{request_policy,budget,max_input_tokens}'
        #- '{request_policy,budget,max_output_tokens}'
        #- '{certification,certified_context_window,max_context_tokens}'
        #- '{certification,certified_context_window,max_output_tokens}'
        #- '{projection,token_bound_policy_version}'
        #- '{projection,trusted_input_token_upper_bound}'
        #- '{projection,reserved_output_tokens}'
        #- '{projection,effective_context_ceiling_tokens}'
        #- '{projection,effective_output_ceiling_tokens}'
    )
  then
    raise exception 'PROVIDER_NON_ALO_FIXTURE_SECRET_SCAN_INVALID:%',envelope;
  end if;
  execute 'set local role data_agent_backend';
  result := app_data_agent.begin_provider_invocation(lease,command);
  replay := app_data_agent.begin_provider_invocation(lease,command);
  execute 'reset role';
  if result ->> 'admission' <> 'REJECTED'
    or result ->> 'rejection_reason' <> 'PROVIDER_PROFILE_NOT_AVAILABLE'
    or result -> 'permit' <> 'null'::jsonb
    or result #>> '{outcome,candidate,provider_call_count}' <> '0'
    or result #>> '{usage,availability}' <> 'NOT_APPLICABLE'
    or replay ->> 'disposition' <> 'REPLAYED'
    or (select pg_catalog.count(*) from app_data_agent.provider_invocation_intents
        where invocation_id = '00000000-0000-4000-8000-0000000054a6') <> 1
    or (select pg_catalog.count(*) from app_data_agent.provider_invocation_dispatch_permits
        where invocation_id = '00000000-0000-4000-8000-0000000054a6') <> 0
    or (select pg_catalog.count(*) from app_data_agent.provider_invocation_outcomes
        where invocation_id = '00000000-0000-4000-8000-0000000054a6'
          and state = 'DISPATCH_MARKED') <> 0
    or (select pg_catalog.count(*) from app_data_agent.provider_invocation_outcomes
        where invocation_id = '00000000-0000-4000-8000-0000000054a6'
          and state = 'FAILED') <> 1
    or (select pg_catalog.count(*) from app_data_agent.provider_invocation_usage_receipts
        where invocation_id = '00000000-0000-4000-8000-0000000054a6') <> 1
    or exists (select 1 from app_data_agent.artifacts
        where run_id = '00000000-0000-4000-8000-000000005403'
          and artifact_type = 'ProviderResponseArtifact')
  then
    raise exception 'PROVIDER_NON_ALO_BEGIN_REJECTION_FAILED';
  end if;
end
$non_alo_begin_rejected$;
set local role data_agent_backend;
do $profile_list_smoke$
declare
  result jsonb;
  non_alo_profile jsonb;
  managed_profile jsonb;
begin
  result := app_data_agent.list_provider_execution_profiles();
  select profile into non_alo_profile
  from pg_catalog.jsonb_array_elements(result -> 'profiles') as profile
  where profile ->> 'model_profile_id' = '00000000-0000-4000-8000-000000005497';
  select profile into managed_profile
  from pg_catalog.jsonb_array_elements(result -> 'profiles') as profile
  where profile ->> 'model_profile_id' = '00000000-0000-4000-8000-000000005499';
  if result ->> 'schema_version' <> 'provider-execution-profile-list@1.0.0'
    or result #>> '{scope,tenant_id}' <> '00000000-0000-4000-8000-000000005401'
    or result #>> '{scope,principal_id}' <> '00000000-0000-4000-8000-000000005402'
    or non_alo_profile is null
    or non_alo_profile ->> 'readiness' <> 'STALE'
    or (non_alo_profile ->> 'selectable')::boolean
    or non_alo_profile ->> 'unavailable_reason' <> 'MODEL_PROFILE_STALE'
    or non_alo_profile ? 'recovery_capabilities'
    or managed_profile is null
    or managed_profile ->> 'readiness' <> 'STALE'
    or (managed_profile ->> 'selectable')::boolean
    or managed_profile ->> 'unavailable_reason' <> 'MODEL_PROFILE_STALE'
    or managed_profile ? 'connection'
  then
    raise exception 'PROVIDER_NON_ALO_PROFILE_WAS_NOT_UNAVAILABLE';
  end if;
end
$profile_list_smoke$;
reset role;
alter table app_data_agent.artifacts disable trigger all;
do $alo_system_profile_fixture$
declare
  document jsonb;
  execution_snapshot jsonb;
  new_content_hash text;
begin
  select artifact.document_json into strict document
  from app_data_agent.artifacts as artifact
  where artifact.artifact_id = '00000000-0000-4000-8000-000000005498';
  document := pg_catalog.jsonb_set(
    document,'{recovery_capabilities}','["AT_LEAST_ONCE_ONLY"]'::jsonb);
  document := pg_catalog.jsonb_set(
    document,'{execution_profile_snapshot,recovery_capabilities}',
    '["AT_LEAST_ONCE_ONLY"]'::jsonb);
  execution_snapshot := document -> 'execution_profile_snapshot';
  document := pg_catalog.jsonb_set(
    document,'{execution_profile_hash}',
    pg_catalog.to_jsonb(app_data_agent.u2_canonical_sha256(execution_snapshot)));
  new_content_hash := app_data_agent.u2_canonical_sha256(document #- '{receipt_ref,content_hash}');
  document := pg_catalog.jsonb_set(
    document,'{receipt_ref,content_hash}',pg_catalog.to_jsonb(new_content_hash));
  update app_data_agent.artifacts
  set content_hash = new_content_hash,
      document_json = document
  where artifact_id = '00000000-0000-4000-8000-000000005498';
end
$alo_system_profile_fixture$;
alter table app_data_agent.artifacts enable trigger all;
set local role data_agent_backend;
do $alo_system_profile_smoke$
declare
  result jsonb;
  available_profile jsonb;
begin
  result := app_data_agent.list_provider_execution_profiles();
  select profile into available_profile
  from pg_catalog.jsonb_array_elements(result -> 'profiles') as profile
  where profile ->> 'model_profile_id' = '00000000-0000-4000-8000-000000005497';
  if available_profile ->> 'readiness' <> 'AVAILABLE'
    or not (available_profile ->> 'selectable')::boolean
    or available_profile -> 'recovery_capabilities' <> '["AT_LEAST_ONCE_ONLY"]'::jsonb
    or available_profile #>> '{connection,kind}' <> 'SYSTEM_DEPLOYMENT'
    or available_profile #>> '{connection,deployment_id}' <>
      '00000000-0000-4000-8000-000000000001'
    or available_profile -> 'unavailable_reason' <> 'null'::jsonb
  then
    raise exception 'PROVIDER_ALO_SYSTEM_PROFILE_WAS_NOT_AVAILABLE';
  end if;
end
$alo_system_profile_smoke$;
reset role;
alter table app_data_agent.artifacts disable trigger all;
do $cross_deployment_profile_fixture$
declare
  deployment_record platform.deployment_mappings%rowtype;
  connection_document jsonb;
  document jsonb;
  execution_snapshot jsonb;
  new_content_hash text;
begin
  select mapping.* into strict deployment_record
  from platform.deployment_mappings as mapping
  where mapping.deployment_id = '00000000-0000-4000-8000-00000000549c';
  connection_document := pg_catalog.jsonb_build_object(
    'kind','SYSTEM_DEPLOYMENT','deployment_id',deployment_record.deployment_id,
    'deployment_revision',1,'deployment_hash',app_data_agent.u2_canonical_sha256(
      pg_catalog.jsonb_build_object(
        'deployment_id',deployment_record.deployment_id,
        'app_id',deployment_record.app_id,'environment',deployment_record.environment,
        'deployment_key_hash',deployment_record.deployment_key_hash)));
  select artifact.document_json into strict document
  from app_data_agent.artifacts as artifact
  where artifact.artifact_id = '00000000-0000-4000-8000-000000005498';
  document := pg_catalog.jsonb_set(document,'{connection}',connection_document);
  document := pg_catalog.jsonb_set(
    document,'{execution_profile_snapshot,connection}',connection_document);
  execution_snapshot := document -> 'execution_profile_snapshot';
  document := pg_catalog.jsonb_set(
    document,'{execution_profile_hash}',
    pg_catalog.to_jsonb(app_data_agent.u2_canonical_sha256(execution_snapshot)));
  new_content_hash := app_data_agent.u2_canonical_sha256(document #- '{receipt_ref,content_hash}');
  document := pg_catalog.jsonb_set(
    document,'{receipt_ref,content_hash}',pg_catalog.to_jsonb(new_content_hash));
  update app_data_agent.artifacts
  set content_hash = new_content_hash,
      document_json = document
  where artifact_id = '00000000-0000-4000-8000-000000005498';
end
$cross_deployment_profile_fixture$;
alter table app_data_agent.artifacts enable trigger all;
set local role data_agent_backend;
do $cross_deployment_profile_smoke$
declare
  result jsonb;
  cross_deployment_profile jsonb;
begin
  result := app_data_agent.list_provider_execution_profiles();
  select profile into cross_deployment_profile
  from pg_catalog.jsonb_array_elements(result -> 'profiles') as profile
  where profile ->> 'model_profile_id' = '00000000-0000-4000-8000-000000005497';
  if cross_deployment_profile ->> 'readiness' <> 'STALE'
    or (cross_deployment_profile ->> 'selectable')::boolean
    or cross_deployment_profile ->> 'unavailable_reason' <> 'MODEL_PROFILE_STALE'
    or cross_deployment_profile ? 'connection'
  then
    raise exception 'PROVIDER_CROSS_DEPLOYMENT_PROFILE_WAS_AVAILABLE';
  end if;
end
$cross_deployment_profile_smoke$;
rollback;

do $greenfield_empty$
begin
  if (select pg_catalog.count(*) from app_data_agent.provider_invocation_intents) <> 0
    or (select pg_catalog.count(*) from app_data_agent.provider_invocation_dispatch_permits) <> 0
    or (select pg_catalog.count(*) from app_data_agent.provider_invocation_outcomes) <> 0
    or (select pg_catalog.count(*) from app_data_agent.provider_invocation_usage_receipts) <> 0
  then
    raise exception 'PROVIDER_INVOCATION_GREENFIELD_TABLES_NOT_EMPTY';
  end if;
end
$greenfield_empty$;

begin;
do $raw_command_rejected$
declare
  before_count bigint;
begin
  select (select pg_catalog.count(*) from app_data_agent.provider_invocation_intents)
       + (select pg_catalog.count(*) from app_data_agent.provider_invocation_dispatch_permits)
       + (select pg_catalog.count(*) from app_data_agent.provider_invocation_outcomes)
       + (select pg_catalog.count(*) from app_data_agent.provider_invocation_usage_receipts)
  into before_count;
  begin
    perform app_data_agent.begin_provider_invocation(
      '{}'::jsonb,
      pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-begin@1.0.0',
        'envelope','{}'::jsonb,
        'messages',pg_catalog.jsonb_build_array('raw prompt')));
    raise exception 'PROVIDER_INVOCATION_RAW_COMMAND_WAS_NOT_REJECTED';
  exception when others then
    if sqlerrm <> 'PROVIDER_INVOCATION_COMMAND_INVALID' then raise; end if;
  end;
  if before_count <> (
      select (select pg_catalog.count(*) from app_data_agent.provider_invocation_intents)
           + (select pg_catalog.count(*) from app_data_agent.provider_invocation_dispatch_permits)
           + (select pg_catalog.count(*) from app_data_agent.provider_invocation_outcomes)
           + (select pg_catalog.count(*) from app_data_agent.provider_invocation_usage_receipts)
    )
  then
    raise exception 'PROVIDER_INVOCATION_RAW_COMMAND_CAUSED_WRITE';
  end if;
end
$raw_command_rejected$;
rollback;
