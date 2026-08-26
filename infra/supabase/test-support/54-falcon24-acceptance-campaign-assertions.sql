\set ON_ERROR_STOP on

begin;

select pg_catalog.set_config(
  'data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config(
  'data_agent.tenant_id','00000000-0000-4000-8000-00000000aa22',true);
select pg_catalog.set_config('data_agent.environment','test',true);
select pg_catalog.set_config(
  'data_agent.principal_id','00000000-0000-4000-8000-000000001003',true);
select pg_catalog.set_config('data_agent.role','owner',true);
select pg_catalog.set_config(
  'data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',true);

create function pg_temp.falcon24_test_hash(document jsonb)
returns text language sql immutable security definer set search_path='' as $function$
  select app_data_agent.u2_canonical_sha256(document)
$function$;

create function pg_temp.falcon24_expire_reclamation_claim(
  requested_campaign_id text,requested_run_id uuid)
returns void language sql volatile security definer set search_path='' as $function$
  update app_data_agent.falcon24_acceptance_campaign_runs set
    sandbox_reclamation_claim_expires_at=pg_catalog.clock_timestamp()-interval '1 second'
    where campaign_id=requested_campaign_id and run_id=requested_run_id
$function$;

create function pg_temp.falcon24_restore_run_work_lease(
  requested_outbox_id uuid,requested_attempt_id uuid)
returns timestamptz language plpgsql volatile security definer set search_path='' as $function$
declare restored_at timestamptz:=pg_catalog.clock_timestamp();
  restored_expiry timestamptz;
begin
  restored_expiry:=restored_at+interval '15 minutes';
  update app_data_agent.run_attempts set
    lease_expires_at=restored_expiry,last_heartbeat_at=restored_at
    where attempt_id=requested_attempt_id;
  update app_data_agent.outbox set
    lease_expires_at=restored_expiry,last_heartbeat_at=restored_at
    where outbox_id=requested_outbox_id;
  return restored_expiry;
end
$function$;

create function pg_temp.falcon24_insert_partial_submit_run(requested_run_id uuid)
returns void language sql volatile security definer set search_path='' as $function$
  insert into app_data_agent.runs(
    app_id,tenant_id,environment,run_id,principal_id,status,question)
  values(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa22'::uuid,'test',requested_run_id,
    '00000000-0000-4000-8000-000000001003'::uuid,'QUEUED',
    'Falcon24 deliberately partial submit authority fixture')
$function$;

create function pg_temp.falcon24_runtime_lease_document(requested_claim jsonb)
returns jsonb language sql stable strict security definer set search_path='' as $function$
  select pg_catalog.jsonb_build_object(
    'scope',pg_catalog.jsonb_build_object(
      'app_id',pg_catalog.current_setting('data_agent.app_id'),
      'tenant_id',pg_catalog.current_setting('data_agent.tenant_id'),
      'environment',pg_catalog.current_setting('data_agent.environment')),
    'principal_id',pg_catalog.current_setting('data_agent.principal_id'),
    'outbox_id',requested_claim->>'outbox_id',
    'run_id',requested_claim->>'run_id',
    'command_id',requested_claim->>'command_id',
    'command_kind',requested_claim->>'command_kind',
    'attempt_id',requested_claim->>'attempt_id',
    'attempt_no',(requested_claim->>'attempt_no')::integer,
    'delivery_attempt_no',(requested_claim->>'delivery_attempt_no')::integer,
    'lease_duration_ms',(requested_claim->>'lease_duration_ms')::integer,
    'worker_id',requested_claim->>'worker_id',
    'lease_token',(requested_claim->>'lease_token')::bigint,
    'worker_fence',(requested_claim->>'worker_fence')::bigint,
    'expires_at',app_data_agent.runtime_iso_timestamp(
      (requested_claim->>'expires_at')::timestamptz),
    'execution_policy',app_data_agent.resolve_falcon24_run_execution_policy(
      (requested_claim->>'run_id')::uuid),
    'payload',requested_claim->'payload')
$function$;

create function pg_temp.falcon24_assert_provider_active_worker_lease(requested_lease jsonb)
returns jsonb language sql volatile strict security definer set search_path='' as $function$
  select app_data_agent.assert_provider_active_worker_lease(requested_lease)
$function$;

create function pg_temp.falcon24_append_runtime_event(
  requested_lease jsonb,requested_event jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare current_projection app_data_agent.run_projections%rowtype;
  next_projection jsonb;
begin
  select projection.* into strict current_projection
    from app_data_agent.run_projections projection
    where projection.app_id=(requested_lease#>>'{scope,app_id}')::uuid
      and projection.tenant_id=(requested_lease#>>'{scope,tenant_id}')::uuid
      and projection.environment=requested_lease#>>'{scope,environment}'
      and projection.run_id=(requested_lease->>'run_id')::uuid
    order by projection.version desc limit 1;
  next_projection:=app_data_agent.reduce_run_projection_document(
    current_projection.projection_json,requested_event);
  return app_data_agent.append_run_event(
    requested_lease,requested_event,
    app_data_agent.runtime_canonical_sha256(requested_event),
    current_projection.projection_hash,next_projection,
    app_data_agent.runtime_canonical_sha256(next_projection));
end
$function$;

insert into app_data_agent.datasource_connections(
  app_id,tenant_id,environment,datasource_id,name,datasource_type,file_path,status,
  created_by_principal_id,resource_version)
values(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,'test',
  '00000000-0000-4000-8000-000000005490'::uuid,
  'Falcon24 submit fence fixture','sqlite','/tmp/falcon24-submit-fence.db','ACTIVE',
  '00000000-0000-4000-8000-000000001003'::uuid,1);

insert into app_data_agent.runs(
  app_id,tenant_id,environment,run_id,principal_id,status,question)
values(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,
  'test','00000000-0000-4000-8000-000000005401'::uuid,
  '00000000-0000-4000-8000-000000001003'::uuid,
  'RUNNING','Falcon24 non-terminal campaign authority assertion');

insert into app_data_agent.falcon24_acceptance_campaigns(
  app_id,tenant_id,environment,principal_id,campaign_id,campaign_version,
  source_fingerprint,frozen_contract_hash,runtime_attestation_hash,manifest_hash,
  policy_id,run_count,next_run_ordinal,status,created_at,updated_at)
values(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,'test',
  '00000000-0000-4000-8000-000000001003'::uuid,
  'falcon24-test-v13-authority',13,
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'falcon24-strict-zero-retry@1.0.0',30,0,'RUNNING',
  pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()),(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,'test',
  '00000000-0000-4000-8000-000000001003'::uuid,
  'falcon24-test-v14-authority',14,
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  'falcon24-strict-zero-retry@1.0.0',30,0,'READY',
  pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()),(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,'test',
  '00000000-0000-4000-8000-000000001003'::uuid,
  'falcon24-test-v15-authority',15,
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  'falcon24-strict-zero-retry@1.0.0',30,0,'READY',
  pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp());

insert into app_data_agent.falcon24_acceptance_campaign_runs(
  app_id,tenant_id,environment,principal_id,campaign_id,run_ordinal,run_id,
  case_id,run_variant,repetition,status,claimed_at,claim_fence_hash)
values(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,'test',
  '00000000-0000-4000-8000-000000001003'::uuid,
  'falcon24-test-v13-authority',0,
  '00000000-0000-4000-8000-000000005401'::uuid,
  'falcon24-business-review-18m','COLD',1,'CLAIMED',pg_catalog.clock_timestamp(),
  pg_temp.falcon24_test_hash(pg_catalog.jsonb_build_object(
    'claim_fence_token','00000000-0000-4000-8000-000000005489'))),(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,'test',
  '00000000-0000-4000-8000-000000001003'::uuid,
  'falcon24-test-v14-authority',0,
  '00000000-0000-4000-8000-000000005411'::uuid,
  'falcon24-business-review-18m','COLD',1,'PLANNED',null,null),(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,'test',
  '00000000-0000-4000-8000-000000001003'::uuid,
  'falcon24-test-v15-authority',0,
  '00000000-0000-4000-8000-000000005421'::uuid,
  'falcon24-business-review-18m','COLD',1,'PLANNED',null,null);

set local role data_agent_backend;

do $exact_run_execution_policy$
declare strict_policy jsonb; ordinary_policy jsonb;
begin
  strict_policy:=app_data_agent.resolve_falcon24_run_execution_policy(
    '00000000-0000-4000-8000-000000005401'::uuid);
  ordinary_policy:=app_data_agent.resolve_falcon24_run_execution_policy(
    '00000000-0000-4000-8000-000000005499'::uuid);
  if strict_policy is null
    or strict_policy->>'schema_version' is distinct from 'run-execution-policy@1.0.0'
    or strict_policy->>'campaign_id' is distinct from 'falcon24-test-v13-authority'
    or strict_policy->>'case_id' is distinct from 'falcon24-business-review-18m'
    or strict_policy->>'run_variant' is distinct from 'COLD'
    or strict_policy->>'repetition' is distinct from '1'
    or strict_policy->>'policy_id' is distinct from 'falcon24-strict-zero-retry@1.0.0'
    or strict_policy->>'max_run_attempts' is distinct from '1'
    or strict_policy->>'max_provider_attempts_per_call' is distinct from '1'
    or strict_policy->>'max_root_turns' is distinct from '1'
    or strict_policy->>'max_text2sql_candidate_attempts' is distinct from '1'
    or strict_policy->>'analysis_repair_budget_per_category' is distinct from '0'
    or strict_policy->>'max_file_transfer_attempts' is distinct from '1'
    or strict_policy->>'allow_stage_recovery' is distinct from 'false'
    or strict_policy->>'hold_on_failure' is distinct from 'true'
    or ordinary_policy is not null
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_acceptance_campaigns','SELECT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_acceptance_campaign_runs','SELECT')
  then raise exception 'FALCON24_EXACT_RUN_EXECUTION_POLICY_DRIFT'; end if;
end
$exact_run_execution_policy$;

do $submit_fence_claim_and_preflight_hold$
declare command jsonb; claimed jsonb; held jsonb; loaded jsonb; resolved jsonb;
  fence_token constant text:='00000000-0000-4000-8000-000000005499';
  expected_fence_hash text;
begin
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-question-run-acceptance@1.0.0',
    'campaign_id','falcon24-test-v13-authority',
    'run_id','00000000-0000-4000-8000-000000005401',
    'claim_fence_token','00000000-0000-4000-8000-000000005489');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  begin
    perform app_data_agent.accept_falcon24_question_run_with_effective_config(
      pg_catalog.jsonb_build_object(
        'run_id','00000000-0000-4000-8000-000000005401'),
      pg_catalog.jsonb_build_object(
        'run_id','00000000-0000-4000-8000-000000005401'),
      command);
    raise exception 'FALCON24_PREEXISTING_RUN_BYPASSED_ACCEPTANCE';
  exception when others then
    if sqlerrm<>'FALCON24_SUBMIT_RUN_PREEXISTS' then raise; end if;
  end;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-run-claim@1.0.0',
    'campaign_id','falcon24-test-v14-authority','run_ordinal',0,
    'run_id','00000000-0000-4000-8000-000000005411',
    'case_id','falcon24-business-review-18m','run_variant','COLD','repetition',1);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  begin
    perform app_data_agent.claim_falcon24_acceptance_run(command);
    raise exception 'FALCON24_CLAIM_V1_WAS_ACCEPTED';
  exception when others then
    if sqlerrm<>'FALCON24_RUN_CLAIM_INVALID' then raise; end if;
  end;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-run-claim@2.0.0',
    'campaign_id','falcon24-test-v14-authority','run_ordinal',0,
    'run_id','00000000-0000-4000-8000-000000005411',
    'case_id','falcon24-business-review-18m','run_variant','COLD','repetition',1,
    'claim_fence_token',fence_token);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  claimed:=app_data_agent.claim_falcon24_acceptance_run(command);
  expected_fence_hash:=pg_temp.falcon24_test_hash(
    pg_catalog.jsonb_build_object('claim_fence_token',fence_token));
  if claimed->>'status' is distinct from 'CLAIMED'
    or claimed->>'claim_fence_hash' is distinct from expected_fence_hash
    or claimed->>'claim_fence_consumed_at' is not null
  then raise exception 'FALCON24_CLAIM_FENCE_NOT_DURABLE'; end if;

  begin
    command:=pg_catalog.jsonb_build_object(
      'schema_version','falcon24-submit-outcome-resolution@1.0.0',
      'campaign_id','falcon24-test-v14-authority',
      'run_id','00000000-0000-4000-8000-000000005411',
      'observed_failure_code','FALCON24_CLAIM_ORPHANED');
    command:=command||pg_catalog.jsonb_build_object(
      'command_hash',pg_temp.falcon24_test_hash(command));
    resolved:=app_data_agent.resolve_falcon24_acceptance_submit_outcome(command);
    if resolved->>'disposition' is distinct from 'HELD'
      or resolved->>'failure_code' is distinct from 'FALCON24_CLAIM_ORPHANED'
    then raise exception 'FALCON24_ORPHANED_CLAIM_NOT_HELD'; end if;
    raise exception 'FALCON24_ORPHANED_CLAIM_PROBE_ROLLBACK';
  exception when others then
    if sqlerrm<>'FALCON24_ORPHANED_CLAIM_PROBE_ROLLBACK' then raise; end if;
  end;

  begin
    perform pg_temp.falcon24_insert_partial_submit_run(
      '00000000-0000-4000-8000-000000005411'::uuid);
    command:=pg_catalog.jsonb_build_object(
      'schema_version','falcon24-submit-outcome-resolution@1.0.0',
      'campaign_id','falcon24-test-v14-authority',
      'run_id','00000000-0000-4000-8000-000000005411',
      'observed_failure_code','PERSISTENCE_TRANSACTION_FAILED');
    command:=command||pg_catalog.jsonb_build_object(
      'command_hash',pg_temp.falcon24_test_hash(command));
    resolved:=app_data_agent.resolve_falcon24_acceptance_submit_outcome(command);
    if resolved->>'disposition' is distinct from 'HELD'
      or resolved->>'failure_code' is distinct from 'FALCON24_SUBMIT_AUTHORITY_CORRUPT'
    then raise exception 'FALCON24_PARTIAL_SUBMIT_AUTHORITY_NOT_HELD'; end if;
    raise exception 'FALCON24_PARTIAL_SUBMIT_PROBE_ROLLBACK';
  exception when others then
    if sqlerrm<>'FALCON24_PARTIAL_SUBMIT_PROBE_ROLLBACK' then raise; end if;
  end;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-campaign-run-load@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  loaded:=app_data_agent.load_falcon24_acceptance_campaign_run(command);
  if loaded->>'status' is distinct from 'CLAIMED'
    or loaded->>'claim_fence_consumed_at' is not null
  then raise exception 'FALCON24_SUBMIT_OUTCOME_PROBE_LEAKED_STATE'; end if;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-campaign-hold@1.0.0',
    'campaign_id','falcon24-test-v15-authority',
    'run_id','00000000-0000-4000-8000-000000005421',
    'failure_layer','ROOT_ROUTING','failure_code','ROOT_PREFLIGHT_FAILED');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  begin
    perform app_data_agent.hold_falcon24_acceptance_campaign(command);
    raise exception 'FALCON24_HOLD_V1_WAS_ACCEPTED';
  exception when others then
    if sqlerrm<>'FALCON24_CAMPAIGN_HOLD_INVALID' then raise; end if;
  end;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-campaign-hold@2.0.0',
    'campaign_id','falcon24-test-v15-authority',
    'run_id','00000000-0000-4000-8000-000000005421',
    'failure_layer','SQL_DATA_PREPARATION','failure_code','PREFLIGHT_LAYER_INVALID');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  begin
    perform app_data_agent.hold_falcon24_acceptance_campaign(command);
    raise exception 'FALCON24_NON_ROOT_PLANNED_HOLD_WAS_ACCEPTED';
  exception when others then
    if sqlerrm<>'FALCON24_RUN_NOT_CLAIMED' then raise; end if;
  end;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-campaign-hold@2.0.0',
    'campaign_id','falcon24-test-v15-authority',
    'run_id','00000000-0000-4000-8000-000000005421',
    'failure_layer','ROOT_ROUTING','failure_code','ROOT_PREFLIGHT_FAILED');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  held:=app_data_agent.hold_falcon24_acceptance_campaign(command);
  if held->>'status' is distinct from 'HOLD'
  then raise exception 'FALCON24_PLANNED_ROOT_HOLD_NOT_DURABLE'; end if;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-campaign-run-load@1.0.0',
    'campaign_id','falcon24-test-v15-authority',
    'run_id','00000000-0000-4000-8000-000000005421');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  loaded:=app_data_agent.load_falcon24_acceptance_campaign_run(command);
  if loaded->>'status' is distinct from 'HOLD'
    or loaded->>'claimed_at' is null or loaded->>'completed_at' is null
  then raise exception 'FALCON24_PLANNED_ROOT_HOLD_RUN_DRIFT'; end if;
end
$submit_fence_claim_and_preflight_hold$;

reset role;

set local session_replication_role=replica;
do $fenced_acceptance_fixture$
declare app_id constant uuid:='00000000-0000-4000-8000-00000000da01';
  tenant_id constant uuid:='00000000-0000-4000-8000-00000000aa22';
  principal_id constant uuid:='00000000-0000-4000-8000-000000001003';
  datasource_id constant uuid:='00000000-0000-4000-8000-000000005490';
  model_profile_id constant uuid:='00000000-0000-4000-8000-000000005491';
  snapshot_id constant uuid:='00000000-0000-4000-8000-000000005492';
  release_id constant uuid:='00000000-0000-4000-8000-000000005493';
  revision_id constant uuid:='00000000-0000-4000-8000-000000005494';
  defaults_id constant uuid:='00000000-0000-4000-8000-000000005495';
  digest_a constant text:='sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  digest_b constant text:='sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  digest_c constant text:='sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
  datasource_hash text; model_hash text; defaults_document jsonb;
  revision_document jsonb; defaults_hash text;
begin
  insert into app_data_agent.app_users(
    app_id,environment,principal_id,auth_user_id,email,display_name,system_role,status,authz_epoch)
  values(app_id,'test',principal_id,'00000000-0000-4000-8000-000000005496',
    'falcon24@example.invalid','Falcon24 acceptance','USER','ACTIVE',1);
  insert into app_data_agent.model_catalog_entries(
    app_id,environment,model_profile_id,provider,model_id,display_name,base_url,
    capabilities,credential_ref,status,config_version,is_system_default,created_by)
  values(app_id,'test',model_profile_id,'deepseek','deepseek-chat','Falcon24 DeepSeek',
    'https://example.invalid',
    '{"structured_output":true,"tool_calling":true,"streaming":true,"reasoning":true,"vision":false}'::jsonb,
    null,'ACTIVE',1,false,principal_id);
  insert into app_data_agent.model_config_versions(
    app_id,environment,model_profile_id,config_version,snapshot,actor_principal_id)
  values(app_id,'test',model_profile_id,1,'{}'::jsonb,principal_id);
  insert into app_data_agent.qa_conversations(
    app_id,tenant_id,environment,conversation_id,owner_principal_id,title,datasource_id,
    model_id,model_profile_id,resource_version)
  values(app_id,tenant_id,'test','00000000-0000-4000-8000-000000005497',principal_id,
    'Falcon24 fenced acceptance',datasource_id,'deepseek-chat',model_profile_id,1);
  insert into catalog.physical_schema_snapshot(
    app_id,tenant_id,environment,datasource_id,datasource_fingerprint,snapshot_content_hash,
    content_payload,content_storage_digest,first_observed_at)
  values(app_id,tenant_id,'test',datasource_id::text,digest_a,digest_b,'{}'::jsonb,digest_c,
    pg_catalog.clock_timestamp());
  insert into catalog.schema_scan_run(
    app_id,tenant_id,environment,datasource_id,datasource_fingerprint,scan_run_id,snapshot_id,
    principal_id,idempotency_key,request_digest,terminal,snapshot_content_hash,captured_at,committed_at)
  values(app_id,tenant_id,'test',datasource_id::text,digest_a,
    '00000000-0000-4000-8000-0000000054a1',snapshot_id,principal_id,
    '00000000-0000-4000-8000-0000000054a2',digest_c,'SUCCEEDED',digest_b,
    pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp());
  insert into semantic.semantic_domain_registry(
    app_id,tenant_id,environment,semantic_domain,datasource_id,domain_display_name,
    domain_version,is_active,created_by)
  values(app_id,tenant_id,'test','falcon24_domain',datasource_id,'Falcon24 domain',1,true,'falcon24');
  insert into semantic.semantic_source_release(
    app_id,tenant_id,environment,semantic_domain,release_id,release_generation,attempt_id,
    packet_id,candidate_id,release_digest,compiler_bundle_digest,executable_projection_ref,
    executable_projection_hash,relationship_projection_ref,relationship_projection_hash,
    runtime_restriction_projection_ref,runtime_restriction_projection_hash,quorum_snapshot,
    decision_set_digest,published_by,approval_mode)
  values(app_id,tenant_id,'test','falcon24_domain',release_id,1,
    '00000000-0000-4000-8000-0000000054a3','00000000-0000-4000-8000-0000000054a4',
    '00000000-0000-4000-8000-0000000054a5',digest_c,digest_a,
    '00000000-0000-4000-8000-0000000054a6',digest_a,
    '00000000-0000-4000-8000-0000000054a7',digest_b,
    '00000000-0000-4000-8000-0000000054a8',digest_c,'{}'::jsonb,digest_b,'falcon24','HUMAN_REVIEW');
  insert into semantic.semantic_active_pointer(
    app_id,tenant_id,environment,semantic_domain,current_release_id,current_release_generation,
    current_release_digest,pointer_generation,updated_by)
  values(app_id,tenant_id,'test','falcon24_domain',release_id,1,digest_c,1,'falcon24');
  datasource_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'datasource_id',datasource_id,'datasource_type','sqlite','status','ACTIVE','resource_version',1));
  select app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb(catalog)-'credential_ref'::text)
    into strict model_hash from app_data_agent.model_catalog_entries catalog
    where catalog.app_id='00000000-0000-4000-8000-00000000da01'
      and catalog.environment='test'
      and catalog.model_profile_id='00000000-0000-4000-8000-000000005491';
  defaults_document:=pg_catalog.jsonb_build_object(
    'model',pg_catalog.jsonb_build_object('resource_id',model_profile_id,'resource_revision',1,
      'resource_hash',model_hash),
    'datasource',pg_catalog.jsonb_build_object('resource_id',datasource_id,'resource_revision',1,
      'resource_hash',datasource_hash),
    'files','[]'::jsonb,'knowledge','[]'::jsonb,'mcp_servers','[]'::jsonb,'skills','[]'::jsonb,
    'semantic_release',pg_catalog.jsonb_build_object('resource_id',release_id,'resource_revision',1,
      'resource_hash',digest_c),
    'schema_snapshot',pg_catalog.jsonb_build_object('resource_id',snapshot_id,'resource_revision',1,
      'resource_hash',digest_b),
    'context_policy',pg_catalog.jsonb_build_object('resource_id','builtin:context@1',
      'resource_revision',1,'resource_hash',digest_a),
    'egress_policy',pg_catalog.jsonb_build_object('resource_id','builtin:egress@1',
      'resource_revision',1,'resource_hash',digest_b),
    'execution_safety_policy',pg_catalog.jsonb_build_object('resource_id','builtin:safety@1',
      'resource_revision',1,'resource_hash',digest_c));
  revision_document:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-run-defaults-revision@1.0.0','defaults',defaults_document);
  defaults_hash:=app_data_agent.u2_canonical_sha256(revision_document);
  insert into app_data_agent.workspace_run_default_revisions(
    app_id,tenant_id,environment,defaults_id,defaults_revision,revision_id,principal_id,
    idempotency_key,request_hash,defaults_json,revision_document,defaults_hash,
    membership_version,user_authz_epoch,workspace_lifecycle_version,app_epoch)
  values(app_id,tenant_id,'test',defaults_id,1,revision_id,principal_id,'falcon24:defaults:1',
    digest_a,defaults_document,revision_document,defaults_hash,1,1,1,1);
  insert into app_data_agent.workspace_run_defaults(
    app_id,tenant_id,environment,defaults_id,defaults_revision,revision_id,defaults_hash,
    updated_by_principal_id)
  values(app_id,tenant_id,'test',defaults_id,1,revision_id,defaults_hash,principal_id);
end
$fenced_acceptance_fixture$;
set local session_replication_role=origin;

create function pg_temp.falcon24_test_defaults_ref()
returns jsonb language sql stable security definer set search_path='' as $function$
  select pg_catalog.jsonb_build_object(
    'defaults_id',pointer.defaults_id,
    'defaults_revision',pointer.defaults_revision,
    'defaults_hash',pointer.defaults_hash)
  from app_data_agent.workspace_run_defaults pointer
  where pointer.app_id='00000000-0000-4000-8000-00000000da01'
    and pointer.tenant_id='00000000-0000-4000-8000-00000000aa22'
    and pointer.environment='test'
$function$;

set local role data_agent_backend;

do $submit_fence_consume_and_hold_sequences$
declare command jsonb; consumed jsonb; accepted jsonb; loaded jsonb; held jsonb; resolved jsonb;
  defaults_ref jsonb; requested_config jsonb; requested_command jsonb;
  fence_token constant text:='00000000-0000-4000-8000-000000005499';
begin
  defaults_ref:=pg_temp.falcon24_test_defaults_ref();
  requested_config:=pg_catalog.jsonb_build_object(
    'schema_version','run-config-request@1.0.0',
    'workspace_id','00000000-0000-4000-8000-00000000aa22',
    'idempotency_key','falcon24:accept:5411','defaults_ref',defaults_ref,
    'overrides',pg_catalog.jsonb_build_object(
      'model',pg_catalog.jsonb_build_object('mode','INHERIT_DEFAULT'),
      'datasource',pg_catalog.jsonb_build_object('mode','INHERIT_DEFAULT'),
      'files',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
      'knowledge',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
      'mcp_servers',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
      'skills',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),'egress',null),
    'mentions','[]'::jsonb,'operation','QUESTION_RUN',
    'conversation_ref',pg_catalog.jsonb_build_object(
      'conversation_id','00000000-0000-4000-8000-000000005497',
      'expected_resource_version',1),
    'run_id','00000000-0000-4000-8000-000000005411');
  requested_config:=requested_config||pg_catalog.jsonb_build_object(
    'request_hash',pg_temp.falcon24_test_hash(requested_config));
  requested_command:=pg_catalog.jsonb_build_object(
    'run_id','00000000-0000-4000-8000-000000005411',
    'command_id','00000000-0000-4000-8000-000000005481',
    'event_id','00000000-0000-4000-8000-000000005482',
    'outbox_id','00000000-0000-4000-8000-000000005483',
    'audit_id','00000000-0000-4000-8000-000000005484',
    'idempotency_key','falcon24:accept:5411',
    'question','Falcon24 governed fenced acceptance assertion');
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-question-run-acceptance@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'claim_fence_token','00000000-0000-4000-8000-000000005498');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  begin
    perform app_data_agent.accept_falcon24_question_run_with_effective_config(
      requested_command,requested_config,command);
    raise exception 'FALCON24_WRONG_SUBMIT_FENCE_WAS_CONSUMED';
  exception when others then
    if sqlerrm<>'FALCON24_SUBMIT_FENCE_MISMATCH' then raise; end if;
  end;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-question-run-acceptance@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'claim_fence_token',fence_token);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  accepted:=app_data_agent.accept_falcon24_question_run_with_effective_config(
    requested_command,requested_config,command);
  consumed:=accepted->'submit_fence';
  if (select pg_catalog.array_agg(key order by key)
      from pg_catalog.jsonb_object_keys(accepted) as keys(key))
      is distinct from array['acceptance','submit_fence']::text[]
    or accepted#>>'{acceptance,resolution,admission}' is distinct from 'READY'
    or accepted#>>'{acceptance,resolution,operation}' is distinct from 'QUESTION_RUN'
    or accepted#>>'{acceptance,resolution,run_id}' is distinct from
      '00000000-0000-4000-8000-000000005411'
    or (select pg_catalog.array_agg(key order by key)
      from pg_catalog.jsonb_object_keys(consumed) as keys(key))
      is distinct from array[
        'campaign_id','claim_fence_consumed_at','claim_fence_hash','run_id']::text[]
    or consumed->>'campaign_id' is distinct from 'falcon24-test-v14-authority'
    or consumed->>'run_id' is distinct from '00000000-0000-4000-8000-000000005411'
    or consumed->>'claim_fence_consumed_at' is null
  then raise exception 'FALCON24_SUBMIT_FENCE_RECEIPT_DRIFT'; end if;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-submit-outcome-resolution@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'observed_failure_code','PERSISTENCE_TRANSACTION_FAILED');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  resolved:=app_data_agent.resolve_falcon24_acceptance_submit_outcome(command);
  if resolved->>'disposition' is distinct from 'ACCEPTED'
    or resolved->>'run_id' is distinct from '00000000-0000-4000-8000-000000005411'
    or resolved->>'claim_fence_hash' is distinct from consumed->>'claim_fence_hash'
    or resolved->>'claim_fence_consumed_at' is distinct from consumed->>'claim_fence_consumed_at'
  then raise exception 'FALCON24_ACCEPTED_SUBMIT_OUTCOME_DRIFT'; end if;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-question-run-acceptance@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'claim_fence_token',fence_token);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  begin
    perform app_data_agent.accept_falcon24_question_run_with_effective_config(
      requested_command,requested_config,command);
    raise exception 'FALCON24_SUBMIT_FENCE_WAS_CONSUMED_TWICE';
  exception when others then
    if sqlerrm<>'FALCON24_SUBMIT_FENCE_ALREADY_CONSUMED' then raise; end if;
  end;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-campaign-hold@2.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'failure_layer','ROOT_ROUTING','failure_code','ROOT_FAILURE_AFTER_ACCEPT');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  begin
    perform app_data_agent.hold_falcon24_acceptance_campaign(command);
    raise exception 'FALCON24_ROOT_HOLD_AFTER_ACCEPT_WAS_ALLOWED';
  exception when others then
    if sqlerrm<>'FALCON24_ACTUAL_RUN_NOT_TERMINAL' then raise; end if;
  end;

  begin
    command:=pg_catalog.jsonb_build_object(
      'schema_version','falcon24-acceptance-campaign-hold@2.0.0',
      'campaign_id','falcon24-test-v14-authority',
      'run_id','00000000-0000-4000-8000-000000005411',
      'failure_layer','SQL_DATA_PREPARATION','failure_code','SQL_FAILED_AFTER_ACCEPT');
    command:=command||pg_catalog.jsonb_build_object(
      'command_hash',pg_temp.falcon24_test_hash(command));
    perform app_data_agent.hold_falcon24_acceptance_campaign(command);
    raise exception 'FALCON24_RUNNING_RUN_HOLD_WAS_ALLOWED';
  exception when others then
    if sqlerrm<>'FALCON24_ACTUAL_RUN_NOT_TERMINAL' then raise; end if;
  end;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-campaign-load@1.0.0',
    'campaign_id','falcon24-test-v14-authority');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  loaded:=app_data_agent.load_falcon24_acceptance_campaign(command);
  if loaded->>'status' is distinct from 'RUNNING'
  then raise exception 'FALCON24_HOLD_FAULT_SEQUENCE_LEAKED_STATE'; end if;
end
$submit_fence_consume_and_hold_sequences$;

reset role;

set local role data_agent_backend;

do $complete_actual_run$
declare claimed record; reclaimed record; lease_document jsonb; runtime_event jsonb; appended jsonb;
  pending_failed jsonb; hold_command jsonb; held jsonb; lease_authority jsonb;
  observed_run_status text; observed_attempt_count integer;
begin
  select * into strict claimed from app_data_agent.claim_run_work(
    'falcon24-fixture-worker',1,5);
  if claimed.run_id is distinct from '00000000-0000-4000-8000-000000005411'::uuid
    or claimed.attempt_no is distinct from 1
    or claimed.delivery_attempt_no is distinct from 1
  then raise exception 'FALCON24_ACTUAL_RUN_CLAIM_DRIFT'; end if;
  begin
    perform pg_catalog.pg_sleep(5.1);
    select * into reclaimed from app_data_agent.claim_run_work(
      'falcon24-crash-probe-worker',1,900);
    if found and reclaimed.run_id=claimed.run_id
    then raise exception 'FALCON24_STRICT_RUN_WAS_REDELIVERED_AFTER_CRASH'; end if;
    select run.status into strict observed_run_status from app_data_agent.runs run
      where run.run_id=claimed.run_id;
    select message.attempt_count into strict observed_attempt_count
      from app_data_agent.outbox message where message.outbox_id=claimed.outbox_id;
    if observed_run_status is distinct from 'FAILED' or observed_attempt_count<>1
    then raise exception 'FALCON24_STRICT_CRASH_BUDGET_NOT_TERMINAL'; end if;
    pending_failed:=app_data_agent.load_falcon24_pending_failed_run();
    if pending_failed is null
      or pending_failed->>'campaign_id' is distinct from 'falcon24-test-v14-authority'
      or pending_failed->>'run_id' is distinct from claimed.run_id::text
    then raise exception 'FALCON24_STRICT_CRASH_PENDING_FAILURE_DRIFT'; end if;
    hold_command:=pg_catalog.jsonb_build_object(
      'schema_version','falcon24-acceptance-campaign-hold@2.0.0',
      'campaign_id',pending_failed->>'campaign_id',
      'run_id',pending_failed->>'run_id',
      'failure_layer','ROOT_ROUTING',
      'failure_code','RUN_ATTEMPT_BUDGET_EXHAUSTED');
    hold_command:=hold_command||pg_catalog.jsonb_build_object(
      'command_hash',pg_temp.falcon24_test_hash(hold_command));
    held:=app_data_agent.hold_falcon24_acceptance_campaign(hold_command);
    if held->>'status' is distinct from 'HOLD'
      or held->>'first_failure_run_id' is distinct from claimed.run_id::text
      or held->>'first_failure_layer' is distinct from 'ROOT_ROUTING'
      or held->>'first_failure_code' is distinct from 'RUN_ATTEMPT_BUDGET_EXHAUSTED'
    then raise exception 'FALCON24_STRICT_CRASH_HOLD_RECONCILIATION_DRIFT'; end if;
    raise exception 'FALCON24_STRICT_CRASH_PROBE_ROLLBACK';
  exception when others then
    if sqlerrm<>'FALCON24_STRICT_CRASH_PROBE_ROLLBACK' then raise; end if;
  end;
  claimed.expires_at:=pg_temp.falcon24_restore_run_work_lease(
    claimed.outbox_id,claimed.attempt_id);
  claimed.lease_duration_ms:=900000;
  lease_document:=pg_temp.falcon24_runtime_lease_document(pg_catalog.to_jsonb(claimed));
  runtime_event:=pg_catalog.jsonb_build_object(
    'schema_version','1.0.0',
    'event_id','00000000-0000-4000-8000-000000005486',
    'scope',lease_document->'scope',
    'run_id',claimed.run_id,
    'sequence',2,
    'worker_fence',claimed.worker_fence,
    'idempotency_key','falcon24-fixture:leased:5411',
    'occurred_at',app_data_agent.runtime_iso_timestamp(pg_catalog.clock_timestamp()),
    'event_type','run.leased',
    'payload',pg_catalog.jsonb_build_object(
      'command_id',claimed.command_id,
      'lease_id',claimed.attempt_id::text,
      'worker_id',claimed.worker_id,
      'attempt',claimed.attempt_no));
  appended:=pg_temp.falcon24_append_runtime_event(lease_document,runtime_event);
  if appended#>>'{projection,status}' is distinct from 'RUNNING'
  then raise exception 'FALCON24_ACTUAL_RUN_LEASE_EVENT_DRIFT'; end if;
  lease_authority:=pg_temp.falcon24_assert_provider_active_worker_lease(lease_document);
  if lease_authority->>'run_id' is distinct from claimed.run_id::text
    or lease_authority->>'attempt_id' is distinct from claimed.attempt_id::text
    or lease_authority->>'worker_fence' is distinct from claimed.worker_fence::text
  then raise exception 'FALCON24_PROVIDER_LEASE_POLICY_AUTHORITY_DRIFT'; end if;
  begin
    perform pg_temp.falcon24_assert_provider_active_worker_lease(pg_catalog.jsonb_set(
      lease_document,'{execution_policy,max_root_turns}','2'::jsonb,false));
    raise exception 'FALCON24_PROVIDER_LEASE_POLICY_TAMPER_WAS_ALLOWED';
  exception when others then
    if sqlerrm<>'RUN_EXECUTION_POLICY_CORRUPT' then raise; end if;
  end;

  runtime_event:=pg_catalog.jsonb_build_object(
    'schema_version','1.0.0',
    'event_id','00000000-0000-4000-8000-000000005487',
    'scope',lease_document->'scope',
    'run_id',claimed.run_id,
    'sequence',3,
    'worker_fence',claimed.worker_fence,
    'idempotency_key','falcon24-fixture:completed:5411',
    'occurred_at',app_data_agent.runtime_iso_timestamp(pg_catalog.clock_timestamp()),
    'event_type','run.completed',
    'payload',pg_catalog.jsonb_build_object(
      'completion_kind','WORKFLOW_EXECUTION_ONLY'));
  appended:=pg_temp.falcon24_append_runtime_event(lease_document,runtime_event);
  if appended#>>'{projection,status}' is distinct from 'COMPLETED'
    or app_data_agent.complete_run_work(
      claimed.outbox_id,claimed.attempt_id,claimed.worker_id,
      claimed.lease_token,claimed.worker_fence,3) is distinct from true
  then raise exception 'FALCON24_ACTUAL_RUN_COMPLETION_DRIFT'; end if;
end
$complete_actual_run$;

reset role;

set local role data_agent_backend;

do $assertion$
declare observation jsonb; receipt jsonb; command jsonb; result_document jsonb; result_hash text;
  trace_receipt jsonb; trace_command jsonb; loaded jsonb; reclamation_claim jsonb;
  recorded jsonb; completed jsonb;
  reclamation_recovery_token constant text:='00000000-0000-4000-8000-000000005415';
  competing_recovery_token constant text:='00000000-0000-4000-8000-000000005416';
  reclamation_claim_token constant text:='00000000-0000-4000-8000-000000005413';
  competing_claim_token constant text:='00000000-0000-4000-8000-000000005414';
  recovered_claim_token constant text:='00000000-0000-4000-8000-000000005417';
  expected_reclamation_recovery_hash text; expected_reclamation_claim_hash text;
begin
  begin
    command:=pg_catalog.jsonb_build_object(
      'schema_version','falcon24-acceptance-campaign-hold@2.0.0',
      'campaign_id','falcon24-test-v14-authority',
      'run_id','00000000-0000-4000-8000-000000005411',
      'failure_layer','SQL_DATA_PREPARATION','failure_code','SQL_FAILED_AFTER_TERMINAL');
    command:=command||pg_catalog.jsonb_build_object(
      'command_hash',pg_temp.falcon24_test_hash(command));
    completed:=app_data_agent.hold_falcon24_acceptance_campaign(command);
    if completed->>'status' is distinct from 'HOLD'
    then raise exception 'FALCON24_TERMINAL_RUN_HOLD_NOT_ALLOWED'; end if;
    raise exception 'FALCON24_TERMINAL_HOLD_PROBE_ROLLBACK';
  exception when others then
    if sqlerrm<>'FALCON24_TERMINAL_HOLD_PROBE_ROLLBACK' then raise; end if;
  end;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-campaign-load@1.0.0',
    'campaign_id','falcon24-test-v14-authority');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  loaded:=app_data_agent.load_falcon24_acceptance_campaign(command);
  if loaded->>'campaign_id' is distinct from 'falcon24-test-v14-authority'
    or loaded->>'status' is distinct from 'RUNNING'
  then raise exception 'FALCON24_CAMPAIGN_LOAD_RPC_DRIFT'; end if;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-campaign-run-load@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  loaded:=app_data_agent.load_falcon24_acceptance_campaign_run(command);
  if loaded->>'run_id' is distinct from '00000000-0000-4000-8000-000000005411'
    or loaded->>'status' is distinct from 'CLAIMED'
  then raise exception 'FALCON24_CAMPAIGN_RUN_LOAD_RPC_DRIFT'; end if;

  observation:=pg_catalog.jsonb_build_object(
    'management_observation_schema_version',
      'opensandbox-management-reclamation-observation@1.0.0',
    'management_operation_id','00000000-0000-4000-8000-000000005402',
    'observation_source','OPENSANDBOX_MANAGEMENT_API',
    'target_metadata_hash',
      'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'before_observation',pg_catalog.jsonb_build_object(
      'active_count',1,'observation_hash',
      'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
    'killed',1,
    'after_observation',pg_catalog.jsonb_build_object(
      'active_count',0,'observation_hash',
      'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
    'residual',0,'completed_at','2026-08-26T00:00:00.000Z');
  observation:=observation||pg_catalog.jsonb_build_object(
    'management_observation_hash',pg_temp.falcon24_test_hash(observation));
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-sandbox-reclamation-receipt@2.0.0',
    'campaign_id','falcon24-test-v13-authority',
    'run_id','00000000-0000-4000-8000-000000005401',
    'runtime_attestation_hash',
      'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc')
    ||observation;
  receipt:=receipt||pg_catalog.jsonb_build_object(
    'receipt_hash',pg_temp.falcon24_test_hash(receipt));
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-sandbox-reclamation-record@1.0.0',
    'campaign_id','falcon24-test-v13-authority',
    'run_id','00000000-0000-4000-8000-000000005401',
    'reclamation_claim_token','00000000-0000-4000-8000-000000005403',
    'sandbox_reclamation_hash',receipt->>'receipt_hash',
    'sandbox_reclamation_receipt',receipt);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  if (select pg_catalog.array_agg(key order by key)
      from pg_catalog.jsonb_object_keys(receipt) keys(key))
      is distinct from (
        select pg_catalog.array_agg(expected_key order by expected_key)
        from pg_catalog.unnest(array[
          'schema_version','campaign_id','run_id','runtime_attestation_hash',
          'management_observation_schema_version','management_operation_id',
          'observation_source','target_metadata_hash','before_observation','killed',
          'after_observation','residual','completed_at','management_observation_hash',
          'receipt_hash']::text[]) expected(expected_key))
  then raise exception 'FALCON24_RECLAMATION_FIXTURE_KEYS_INVALID'; end if;
  if receipt->>'management_observation_hash' is distinct from
      pg_temp.falcon24_test_hash(receipt-array[
        'schema_version','campaign_id','run_id','runtime_attestation_hash',
        'management_observation_hash','receipt_hash']::text[])
  then raise exception 'FALCON24_RECLAMATION_FIXTURE_OBSERVATION_HASH_INVALID'; end if;
  if receipt->>'receipt_hash' is distinct from
      pg_temp.falcon24_test_hash(receipt-'receipt_hash')
  then raise exception 'FALCON24_RECLAMATION_FIXTURE_RECEIPT_HASH_INVALID'; end if;
  begin
    perform app_data_agent.record_falcon24_sandbox_reclamation(command);
    raise exception 'FALCON24_RECLAMATION_WITHOUT_TRACE_WAS_RECORDED';
  exception when others then
    if sqlerrm<>'FALCON24_TRACE_STAGE_REQUIRED' then raise; end if;
  end;

  observation:=pg_catalog.jsonb_build_object(
    'management_observation_schema_version',
      'opensandbox-management-reclamation-observation@1.0.0',
    'management_operation_id','00000000-0000-4000-8000-000000005412',
    'observation_source','OPENSANDBOX_MANAGEMENT_API',
    'target_metadata_hash',
      'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'before_observation',pg_catalog.jsonb_build_object(
      'active_count',1,'observation_hash',
      'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
    'killed',1,
    'after_observation',pg_catalog.jsonb_build_object(
      'active_count',0,'observation_hash',
      'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
    'residual',0,'completed_at','2026-08-26T00:00:00.000Z');
  observation:=observation||pg_catalog.jsonb_build_object(
    'management_observation_hash',pg_temp.falcon24_test_hash(observation));
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-sandbox-reclamation-receipt@2.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'runtime_attestation_hash',
      'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc')
    ||observation;
  receipt:=receipt||pg_catalog.jsonb_build_object(
    'receipt_hash',pg_temp.falcon24_test_hash(receipt));
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-sandbox-reclamation-record@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'reclamation_claim_token',reclamation_claim_token,
    'sandbox_reclamation_hash',receipt->>'receipt_hash',
    'sandbox_reclamation_receipt',receipt);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));

  begin
    perform app_data_agent.record_falcon24_sandbox_reclamation(command);
    raise exception 'FALCON24_RECLAMATION_WITHOUT_TRACE_WAS_RECORDED';
  exception when others then
    if sqlerrm<>'FALCON24_TRACE_STAGE_REQUIRED' then raise; end if;
  end;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-sandbox-reclamation-claim@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'runtime_attestation_hash',
      'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'reclamation_recovery_token',reclamation_recovery_token,
    'reclamation_claim_token',reclamation_claim_token);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  begin
    perform app_data_agent.claim_falcon24_sandbox_reclamation(command);
    raise exception 'FALCON24_RECLAMATION_WITHOUT_TRACE_WAS_CLAIMED';
  exception when others then
    if sqlerrm<>'FALCON24_TRACE_STAGE_REQUIRED' then raise; end if;
  end;

  trace_receipt:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-resolution-trace-gate-receipt@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'trace_hash','sha256:1111111111111111111111111111111111111111111111111111111111111111',
    'node_count',7,'edge_count',5,'detail_count',7,'sql_node_count',1,
    'query_evidence_node_count',1,'analysis_evidence_node_count',1,
    'chart_node_count',1,'report_node_count',1,
    'verified_at','2026-08-26T00:00:00.000Z');
  trace_receipt:=trace_receipt||pg_catalog.jsonb_build_object(
    'receipt_hash',pg_temp.falcon24_test_hash(trace_receipt));
  trace_command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-trace-stage@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'trace_closure_hash',trace_receipt->>'trace_hash',
    'trace_gate_receipt_hash',trace_receipt->>'receipt_hash',
    'trace_gate_receipt',trace_receipt);
  trace_command:=trace_command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(trace_command));
  loaded:=app_data_agent.stage_falcon24_acceptance_trace(trace_command);
  if loaded->>'trace_closure_hash' is distinct from trace_receipt->>'trace_hash'
    or loaded->>'trace_gate_receipt_hash' is distinct from trace_receipt->>'receipt_hash'
  then raise exception 'FALCON24_TRACE_GATE_NOT_DURABLE'; end if;
  perform app_data_agent.stage_falcon24_acceptance_trace(trace_command);

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-trace-gate-load@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  loaded:=app_data_agent.load_falcon24_acceptance_trace_gate(command);
  if loaded is distinct from trace_receipt
  then raise exception 'FALCON24_TRACE_GATE_LOAD_RPC_DRIFT'; end if;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-sandbox-reclamation-claim@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'runtime_attestation_hash',
      'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'reclamation_recovery_token',reclamation_recovery_token,
    'reclamation_claim_token',reclamation_claim_token);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  expected_reclamation_claim_hash:=pg_temp.falcon24_test_hash(
    pg_catalog.jsonb_build_object('reclamation_claim_token',reclamation_claim_token));
  expected_reclamation_recovery_hash:=pg_temp.falcon24_test_hash(
    pg_catalog.jsonb_build_object('reclamation_recovery_token',reclamation_recovery_token));
  reclamation_claim:=app_data_agent.claim_falcon24_sandbox_reclamation(command);
  if reclamation_claim->>'sandbox_reclamation_recovery_hash'
      is distinct from expected_reclamation_recovery_hash
    or reclamation_claim->>'sandbox_reclamation_claim_hash'
      is distinct from expected_reclamation_claim_hash
    or reclamation_claim->>'sandbox_reclamation_claimed_at' is null
    or reclamation_claim->>'sandbox_reclamation_claim_expires_at' is null
    or reclamation_claim->>'sandbox_reclamation_claim_consumed_at' is not null
    or reclamation_claim->>'sandbox_reclamation_receipt' is not null
  then raise exception 'FALCON24_RECLAMATION_CLAIM_NOT_DURABLE'; end if;

  begin
    perform app_data_agent.claim_falcon24_sandbox_reclamation(command);
    raise exception 'FALCON24_RECLAMATION_SAME_TOKEN_DOUBLE_CLAIMED';
  exception when others then
    if sqlerrm<>'FALCON24_SANDBOX_RECLAMATION_ALREADY_CLAIMED' then raise; end if;
  end;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-sandbox-reclamation-claim@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'runtime_attestation_hash',
      'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'reclamation_recovery_token',reclamation_recovery_token,
    'reclamation_claim_token',competing_claim_token);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  begin
    perform app_data_agent.claim_falcon24_sandbox_reclamation(command);
    raise exception 'FALCON24_RECLAMATION_COMPETING_TOKEN_CLAIMED';
  exception when others then
    if sqlerrm<>'FALCON24_SANDBOX_RECLAMATION_ALREADY_CLAIMED' then raise; end if;
  end;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-sandbox-reclamation-claim@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'runtime_attestation_hash',
      'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'reclamation_recovery_token',competing_recovery_token,
    'reclamation_claim_token',competing_claim_token);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  begin
    perform app_data_agent.claim_falcon24_sandbox_reclamation(command);
    raise exception 'FALCON24_RECLAMATION_COMPETING_RECOVERY_CLAIMED';
  exception when others then
    if sqlerrm<>'FALCON24_SANDBOX_RECLAMATION_ALREADY_CLAIMED' then raise; end if;
  end;

  perform pg_temp.falcon24_expire_reclamation_claim(
    'falcon24-test-v14-authority','00000000-0000-4000-8000-000000005411'::uuid);
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-sandbox-reclamation-claim@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'runtime_attestation_hash',
      'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'reclamation_recovery_token',reclamation_recovery_token,
    'reclamation_claim_token',recovered_claim_token);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  reclamation_claim:=app_data_agent.claim_falcon24_sandbox_reclamation(command);
  expected_reclamation_claim_hash:=pg_temp.falcon24_test_hash(
    pg_catalog.jsonb_build_object('reclamation_claim_token',recovered_claim_token));
  if reclamation_claim->>'sandbox_reclamation_recovery_hash'
      is distinct from expected_reclamation_recovery_hash
    or reclamation_claim->>'sandbox_reclamation_claim_hash'
      is distinct from expected_reclamation_claim_hash
    or reclamation_claim->>'sandbox_reclamation_claim_expires_at' is null
  then raise exception 'FALCON24_RECLAMATION_EXPIRED_CLAIM_NOT_RECOVERED'; end if;
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-campaign-run-load@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  loaded:=app_data_agent.load_falcon24_acceptance_campaign_run(command);
  if loaded->>'sandbox_reclamation_claim_hash' is distinct from expected_reclamation_claim_hash
    or loaded->>'sandbox_reclamation_claim_consumed_at' is not null
    or loaded->>'sandbox_reclamation_receipt' is not null
  then raise exception 'FALCON24_RECLAMATION_CONFLICT_MUTATED_AUTHORITY'; end if;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-sandbox-reclamation-record@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'reclamation_claim_token',reclamation_claim_token,
    'sandbox_reclamation_hash',receipt->>'receipt_hash',
    'sandbox_reclamation_receipt',receipt);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  begin
    perform app_data_agent.record_falcon24_sandbox_reclamation(command);
    raise exception 'FALCON24_RECLAMATION_WRONG_TOKEN_RECORDED';
  exception when others then
    if sqlerrm<>'FALCON24_SANDBOX_RECLAMATION_CLAIM_MISMATCH' then raise; end if;
  end;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-sandbox-reclamation-record@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'reclamation_claim_token',recovered_claim_token,
    'sandbox_reclamation_hash',receipt->>'receipt_hash',
    'sandbox_reclamation_receipt',receipt);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  recorded:=app_data_agent.record_falcon24_sandbox_reclamation(command);
  if recorded#>>'{sandbox_reclamation_receipt,observation_source}'
      is distinct from 'OPENSANDBOX_MANAGEMENT_API'
    or recorded#>>'{sandbox_reclamation_receipt,runtime_attestation_hash}'
      is distinct from
        'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    or recorded#>>'{sandbox_reclamation_receipt,after_observation,active_count}'
      is distinct from '0'
    or recorded#>>'{sandbox_reclamation_receipt,management_observation_hash}'
      is distinct from observation->>'management_observation_hash'
    or recorded->>'sandbox_reclamation_claim_hash'
      is distinct from expected_reclamation_claim_hash
    or recorded->>'sandbox_reclamation_claim_consumed_at' is null
  then raise exception 'FALCON24_RECLAMATION_RECEIPT_NOT_DURABLE'; end if;

  result_document:=pg_catalog.jsonb_build_object(
    'run_id','00000000-0000-4000-8000-000000005411');
  result_hash:=pg_temp.falcon24_test_hash(result_document);
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-result-stage@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'result_hash',result_hash,'result_document',result_document);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  perform app_data_agent.stage_falcon24_acceptance_result(command);

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-run-complete@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'trace_closure_hash',trace_receipt->>'trace_hash',
    'expected_result_hash',result_hash,
    'sandbox_reclamation_hash',receipt->>'receipt_hash');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  begin
    perform app_data_agent.complete_falcon24_acceptance_run(command);
    raise exception 'FALCON24_COMPLETION_V1_WAS_ACCEPTED';
  exception when others then
    if sqlerrm<>'FALCON24_RUN_COMPLETION_INVALID' then raise; end if;
  end;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-run-complete@2.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'trace_closure_hash',trace_receipt->>'trace_hash',
    'expected_result_hash',result_hash,
    'sandbox_reclamation_hash',receipt->>'receipt_hash');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  begin
    perform app_data_agent.complete_falcon24_acceptance_run(command);
    raise exception 'FALCON24_COMPLETION_V2_CALLER_TRACE_WAS_ACCEPTED';
  exception when others then
    if sqlerrm<>'FALCON24_RUN_COMPLETION_INVALID' then raise; end if;
  end;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-acceptance-run-complete@2.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'expected_result_hash',result_hash,
    'sandbox_reclamation_hash',receipt->>'receipt_hash');
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  completed:=app_data_agent.complete_falcon24_acceptance_run(command);
  if completed->>'status' is distinct from 'READY'
    or completed->>'next_run_ordinal' is distinct from '1'
  then raise exception 'FALCON24_COMPLETION_DID_NOT_ADVANCE_EXACT_RUN'; end if;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-sandbox-reclamation-claim@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'runtime_attestation_hash',
      'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'reclamation_recovery_token',competing_recovery_token,
    'reclamation_claim_token',competing_claim_token);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  begin
    perform app_data_agent.claim_falcon24_sandbox_reclamation(command);
    raise exception 'FALCON24_COMPLETED_RECLAMATION_RECOVERY_IDENTITY_BYPASSED';
  exception when others then
    if sqlerrm<>'FALCON24_SANDBOX_RECLAMATION_REPLAY_MISMATCH' then raise; end if;
  end;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-sandbox-reclamation-claim@1.0.0',
    'campaign_id','falcon24-test-v14-authority',
    'run_id','00000000-0000-4000-8000-000000005411',
    'runtime_attestation_hash',
      'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'reclamation_recovery_token',reclamation_recovery_token,
    'reclamation_claim_token',competing_claim_token);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.falcon24_test_hash(command));
  reclamation_claim:=app_data_agent.claim_falcon24_sandbox_reclamation(command);
  if reclamation_claim->'sandbox_reclamation_receipt' is distinct from receipt
    or reclamation_claim->>'sandbox_reclamation_claim_consumed_at' is null
  then raise exception 'FALCON24_COMPLETED_RECLAMATION_NOT_RECOVERED'; end if;
end
$assertion$;

rollback;

\echo FALCON24_ACCEPTANCE_CAMPAIGN_ASSERTIONS_PASSED
