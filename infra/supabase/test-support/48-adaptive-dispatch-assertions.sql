\set ON_ERROR_STOP on

begin;
set local session_replication_role = replica;
do $acceptance_fixture$
declare
  app_id constant uuid := '00000000-0000-4000-8000-00000000da01';
  tenant_id constant uuid := '00000000-0000-4000-8000-00000000aa22';
  principal_id constant uuid := '00000000-0000-4000-8000-000000001003';
  deployment_id constant uuid := '00000000-0000-4000-8000-00000000de01';
  datasource_id constant uuid := '00000000-0000-4000-8000-000000002810';
  model_profile_id constant uuid := '00000000-0000-4000-8000-000000002811';
  snapshot_id constant uuid := '00000000-0000-4000-8000-000000002812';
  release_id constant uuid := '00000000-0000-4000-8000-000000002813';
  revision_id constant uuid := '00000000-0000-4000-8000-000000002814';
  defaults_id constant uuid := '00000000-0000-4000-8000-000000002815';
  digest_a constant text := 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  digest_b constant text := 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  digest_c constant text := 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
  datasource_hash text; model_hash text; defaults_document jsonb; revision_document jsonb;
  defaults_hash text;
begin
  insert into app_data_agent.app_users(
    app_id,environment,principal_id,auth_user_id,email,display_name,system_role,status,authz_epoch)
  values(app_id,'test',principal_id,'00000000-0000-4000-8000-000000002816',
    'u22@example.invalid','U22 acceptance','USER','ACTIVE',1);
  insert into app_data_agent.billing_runtime_state(app_id,environment,deployment_id,mode,epoch)
  values(app_id,'test',deployment_id,'SHADOW',1);
  insert into app_data_agent.model_catalog_entries(
    app_id,environment,model_profile_id,provider,model_id,display_name,base_url,
    capabilities,credential_ref,status,config_version,is_system_default,created_by)
  values(app_id,'test',model_profile_id,'openai','u22-model','U22 model','https://example.invalid',
    '{"structured_output":true,"tool_calling":true,"streaming":true,"reasoning":false,"vision":false}'::jsonb,
    null,'ACTIVE',1,false,principal_id);
  insert into app_data_agent.model_config_versions(
    app_id,environment,model_profile_id,config_version,snapshot,actor_principal_id)
  values(app_id,'test',model_profile_id,1,'{}'::jsonb,principal_id);
  insert into app_data_agent.datasource_connections(
    app_id,tenant_id,environment,datasource_id,name,datasource_type,file_path,status,
    created_by_principal_id,resource_version)
  values(app_id,tenant_id,'test',datasource_id,'u22-source','sqlite','/tmp/u22.db','ACTIVE',principal_id,1);
  insert into app_data_agent.qa_conversations(
    app_id,tenant_id,environment,conversation_id,owner_principal_id,title,datasource_id,
    model_id,model_profile_id,resource_version)
  values
    (app_id,tenant_id,'test','00000000-0000-4000-8000-000000002817',principal_id,
      'U22 legacy acceptance',datasource_id,'u22-model',model_profile_id,1),
    (app_id,tenant_id,'test','00000000-0000-4000-8000-000000002818',principal_id,
      'U22 adaptive acceptance',datasource_id,'u22-model',model_profile_id,1);

  insert into catalog.physical_schema_snapshot(
    app_id,tenant_id,environment,datasource_id,datasource_fingerprint,snapshot_content_hash,
    content_payload,content_storage_digest,first_observed_at)
  values(app_id,tenant_id,'test',datasource_id::text,digest_a,digest_b,'{}'::jsonb,digest_c,
    pg_catalog.clock_timestamp());
  insert into catalog.schema_scan_run(
    app_id,tenant_id,environment,datasource_id,datasource_fingerprint,scan_run_id,snapshot_id,
    principal_id,idempotency_key,request_digest,terminal,snapshot_content_hash,captured_at,
    committed_at)
  values(app_id,tenant_id,'test',datasource_id::text,digest_a,
    '00000000-0000-4000-8000-000000002819',snapshot_id,principal_id,
    '00000000-0000-4000-8000-000000002820',digest_c,'SUCCEEDED',digest_b,
    pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp());
  insert into semantic.semantic_domain_registry(
    app_id,tenant_id,environment,semantic_domain,datasource_id,domain_display_name,
    domain_version,is_active,created_by)
  values(app_id,tenant_id,'test','u22_domain',datasource_id,'U22 domain',1,true,'u22');
  insert into semantic.semantic_source_release(
    app_id,tenant_id,environment,semantic_domain,release_id,release_generation,attempt_id,
    packet_id,candidate_id,release_digest,compiler_bundle_digest,executable_projection_ref,
    executable_projection_hash,relationship_projection_ref,relationship_projection_hash,
    runtime_restriction_projection_ref,runtime_restriction_projection_hash,quorum_snapshot,
    decision_set_digest,published_by,approval_mode)
  values(app_id,tenant_id,'test','u22_domain',release_id,1,
    '00000000-0000-4000-8000-000000002821','00000000-0000-4000-8000-000000002822',
    '00000000-0000-4000-8000-000000002823',digest_c,digest_a,
    '00000000-0000-4000-8000-000000002824',digest_a,
    '00000000-0000-4000-8000-000000002825',digest_b,
    '00000000-0000-4000-8000-000000002826',digest_c,'{}'::jsonb,digest_b,'u22','HUMAN_REVIEW');
  insert into semantic.semantic_active_pointer(
    app_id,tenant_id,environment,semantic_domain,current_release_id,current_release_generation,
    current_release_digest,pointer_generation,updated_by)
  values(app_id,tenant_id,'test','u22_domain',release_id,1,digest_c,1,'u22');

  datasource_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'datasource_id',datasource_id,'datasource_type','sqlite','status','ACTIVE','resource_version',1));
  select app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb(catalog)-'credential_ref'::text)
    into strict model_hash from app_data_agent.model_catalog_entries catalog
    where catalog.app_id='00000000-0000-4000-8000-00000000da01'
      and catalog.environment='test'
      and catalog.model_profile_id='00000000-0000-4000-8000-000000002811';
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
  values(app_id,tenant_id,'test',defaults_id,1,revision_id,principal_id,'u22:defaults:1',
    digest_a,defaults_document,revision_document,defaults_hash,1,1,1,1);
  insert into app_data_agent.workspace_run_defaults(
    app_id,tenant_id,environment,defaults_id,defaults_revision,revision_id,defaults_hash,
    updated_by_principal_id)
  values(app_id,tenant_id,'test',defaults_id,1,revision_id,defaults_hash,principal_id);
end
$acceptance_fixture$;
set local session_replication_role = origin;
select * from platform.revalidate_backend_authority(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa22'::uuid,'test',
  '00000000-0000-4000-8000-00000000de01'::uuid,
  '00000000-0000-4000-8000-000000001003'::uuid,'owner',1,1,true);
select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-00000000aa22',true);
select pg_catalog.set_config('data_agent.environment','test',true);
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-000000001003',true);
select pg_catalog.set_config('data_agent.role','owner',true);
select pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',true);

do $adaptive_dispatch$
declare
  run_value constant text:='00000000-0000-4000-8000-000000002801';
  capability_hash constant text:='sha256:1111111111111111111111111111111111111111111111111111111111111111';
  refs jsonb; direct_receipt jsonb; direct_plan jsonb; binding jsonb; execute_receipt jsonb;
  report_plan jsonb; cyclic_plan jsonb; tampered jsonb; deferred jsonb; policy_first jsonb;
  policy_replay jsonb; policy_changed jsonb; policy_same jsonb; policy_version text;
  config_ref jsonb; defaults_ref jsonb; legacy_config jsonb; adaptive_config jsonb;
  legacy_command jsonb; adaptive_command jsonb; adaptive_plan jsonb; adaptive_binding jsonb;
  adaptive_execute jsonb; resolution jsonb; accepted_payload jsonb;
begin
  policy_first:=app_data_agent.resolve_agent_dispatch_rollout_policy('SHADOW');
  policy_replay:=app_data_agent.resolve_agent_dispatch_rollout_policy('ENFORCED');
  if policy_first<>policy_replay or policy_replay->>'mode'<>'SHADOW'
    or policy_replay->>'version'<>'1'
    or policy_replay->>'policy_version'<>'adaptive-routing@1.0.0+rollout.1'
  then raise exception 'U22 rollout policy was not DB-frozen'; end if;
  policy_changed:=app_data_agent.set_agent_dispatch_rollout_policy('ENFORCED',1);
  policy_same:=app_data_agent.set_agent_dispatch_rollout_policy('ENFORCED',1);
  if policy_changed<>policy_same or policy_changed->>'mode'<>'ENFORCED'
    or policy_changed->>'version'<>'2'
    or policy_changed->>'policy_version'<>'adaptive-routing@1.0.0+rollout.2'
  then raise exception 'U22 rollout policy CAS transition was not versioned'; end if;
  begin
    perform app_data_agent.set_agent_dispatch_rollout_policy('SHADOW',1);
    raise exception 'U22 stale rollout policy transition was accepted';
  exception when serialization_failure then
    if sqlerrm<>'AGENT_DISPATCH_ROLLOUT_VERSION_CONFLICT' then raise; end if;
  end;
  policy_version:=policy_changed->>'policy_version';

  direct_receipt:=pg_catalog.jsonb_build_object(
    'schema_version','direct-admissibility-receipt@1.0.0','no_new_facts',true,
    'no_governance_mutation',true,'no_formal_report',true,
    'policy_version',policy_version,'capability_snapshot_hash',capability_hash);
  direct_receipt:=direct_receipt||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(direct_receipt));
  direct_plan:=pg_catalog.jsonb_build_object(
    'schema_version','agent-dispatch-plan@1.0.0',
    'plan_id','00000000-0000-4000-8000-000000002802','run_id',run_value,
    'question_class','EXPLANATION','mode','DIRECT','selected_profile_refs','[]'::jsonb,
    'dependency_edges','[]'::jsonb,'required_evidence','["DIRECT_PROVIDER_RECEIPT"]'::jsonb,
    'reason_codes','["DIRECT_EXPLANATION_ADMISSIBLE"]'::jsonb,
    'capability_snapshot_hash',capability_hash,'policy_version',policy_version,
    'direct_admissibility_receipt',direct_receipt);
  direct_plan:=direct_plan||pg_catalog.jsonb_build_object(
    'plan_hash',app_data_agent.u2_canonical_sha256(direct_plan));
  binding:=pg_catalog.jsonb_build_object(
    'schema_version','agent-dispatch-execution-binding@1.0.0','run_id',run_value,
    'effective_executor_version','ADAPTIVE@1',
    'dispatch_plan_ref',pg_catalog.jsonb_build_object(
      'plan_id',direct_plan->>'plan_id','plan_hash',direct_plan->>'plan_hash'),
    'selected_profile_refs','[]'::jsonb,'policy_version',policy_version,
    'capability_snapshot_hash',capability_hash,'shadow_dispatch_plan_ref','null'::jsonb);
  binding:=binding||pg_catalog.jsonb_build_object(
    'binding_hash',app_data_agent.u2_canonical_sha256(binding));
  execute_receipt:=pg_catalog.jsonb_build_object(
    'kind','EXECUTE','plan',direct_plan,'binding',binding);
  if not app_data_agent.agent_dispatch_execute_receipt_is_valid(
      execute_receipt,'null'::jsonb,run_value)
  then raise exception 'U22 valid DIRECT execute receipt rejected'; end if;

  tampered:=pg_catalog.jsonb_set(direct_receipt,'{no_new_facts}','false'::jsonb,false);
  direct_plan:=pg_catalog.jsonb_set(direct_plan,'{direct_admissibility_receipt}',tampered,false);
  direct_plan:=pg_catalog.jsonb_set(direct_plan,'{plan_hash}',pg_catalog.to_jsonb(
    app_data_agent.u2_canonical_sha256(direct_plan-'plan_hash'::text)),false);
  if app_data_agent.agent_dispatch_plan_is_valid(direct_plan,run_value)
  then raise exception 'U22 forged nested DIRECT receipt accepted'; end if;

  refs:=pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('profile_id','governed-text2sql-agent','revision',1,
      'revision_hash','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    pg_catalog.jsonb_build_object('profile_id','report-writing-agent','revision',1,
      'revision_hash','sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'));
  report_plan:=pg_catalog.jsonb_build_object(
    'schema_version','agent-dispatch-plan@1.0.0',
    'plan_id','00000000-0000-4000-8000-000000002803','run_id',run_value,
    'question_class','REPORT','mode','TEAM','selected_profile_refs',refs,
    'dependency_edges',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'from_profile_id','governed-text2sql-agent','to_profile_id','report-writing-agent',
      'evidence_requirement','ACCEPTED_QUERY_EVIDENCE')),
    'required_evidence','["ACCEPTED_QUERY_EVIDENCE","ACCEPTED_REPORT_ARTIFACT","FROZEN_SEMANTIC_RELEASE"]'::jsonb,
    'reason_codes','["REPORT_SPECIALIST_REQUIRED"]'::jsonb,
    'capability_snapshot_hash',capability_hash,'policy_version',policy_version,
    'direct_admissibility_receipt','null'::jsonb);
  report_plan:=report_plan||pg_catalog.jsonb_build_object(
    'plan_hash',app_data_agent.u2_canonical_sha256(report_plan));
  if not app_data_agent.agent_dispatch_plan_is_valid(report_plan,run_value)
  then raise exception 'U22 valid Report DAG rejected'; end if;
  tampered:=pg_catalog.jsonb_set(report_plan,'{dependency_edges}','[]'::jsonb,false);
  tampered:=pg_catalog.jsonb_set(tampered,'{plan_hash}',pg_catalog.to_jsonb(
    app_data_agent.u2_canonical_sha256(tampered-'plan_hash'::text)),false);
  if app_data_agent.agent_dispatch_plan_is_valid(tampered,run_value)
  then raise exception 'U22 Report without QueryEvidence edge accepted'; end if;

  refs:=refs||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'profile_id','semantic-management-agent','revision',2,
    'revision_hash','sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'));
  cyclic_plan:=pg_catalog.jsonb_build_object(
    'schema_version','agent-dispatch-plan@1.0.0',
    'plan_id','00000000-0000-4000-8000-000000002804','run_id',run_value,
    'question_class','DATA_QUERY','mode','TEAM','selected_profile_refs',refs,
    'dependency_edges',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('from_profile_id','governed-text2sql-agent',
        'to_profile_id','semantic-management-agent','evidence_requirement','FROZEN_SEMANTIC_RELEASE'),
      pg_catalog.jsonb_build_object('from_profile_id','semantic-management-agent',
        'to_profile_id','governed-text2sql-agent','evidence_requirement','FROZEN_SEMANTIC_RELEASE')),
    'required_evidence','["ACCEPTED_QUERY_EVIDENCE","FROZEN_SEMANTIC_RELEASE"]'::jsonb,
    'reason_codes','["DATA_QUERY_SPECIALIST_REQUIRED"]'::jsonb,
    'capability_snapshot_hash',capability_hash,'policy_version',policy_version,
    'direct_admissibility_receipt','null'::jsonb);
  cyclic_plan:=cyclic_plan||pg_catalog.jsonb_build_object(
    'plan_hash',app_data_agent.u2_canonical_sha256(cyclic_plan));
  if app_data_agent.agent_dispatch_plan_is_valid(cyclic_plan,run_value)
  then raise exception 'U22 cyclic dispatch graph accepted'; end if;

  deferred:=pg_catalog.jsonb_build_object(
    'kind','DEFERRED','schema_version','agent-dispatch-deferred-receipt@1.0.0',
    'run_id','00000000-0000-4000-8000-000000002805','question_class','ATTRIBUTION',
    'reason_code','ATTRIBUTION_RUNTIME_NOT_READY',
    'required_capabilities','["attribution.acceptance@1.0.0"]'::jsonb,
    'policy_version',policy_version,'capability_snapshot_hash',capability_hash);
  deferred:=deferred||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(deferred));
  if app_data_agent.commit_agent_dispatch_deferred(
      'u22:deferred:1','sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',deferred)
      <>app_data_agent.commit_agent_dispatch_deferred(
      'u22:deferred:1','sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',deferred)
    or exists(select 1 from app_data_agent.runs where run_id=(deferred->>'run_id')::uuid)
  then raise exception 'U22 DEFERRED replay was not durable and Run-free'; end if;
  begin
    perform app_data_agent.commit_agent_dispatch_deferred(
      'u22:deferred:1','sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',deferred);
    raise exception 'U22 mismatched deferred replay accepted';
  exception when unique_violation then
    if sqlerrm<>'AGENT_DISPATCH_DEFERRED_REPLAY_MISMATCH' then raise; end if;
  end;

  config_ref:=pg_catalog.jsonb_build_object(
    'config_id','00000000-0000-4000-8000-000000002806','config_revision',1,
    'config_hash','sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
  if not app_data_agent.command_payload_is_valid(pg_catalog.jsonb_build_object(
      'kind','START_DATA_AGENT_TEAM','effective_config_ref',config_ref,'profile_refs',refs))
  then raise exception 'U22 legacy exact-three Team payload rejected'; end if;
  if not app_data_agent.command_payload_is_valid(pg_catalog.jsonb_build_object(
      'schema_version','effective-config-team-lease@2.0.0','kind','START_DATA_AGENT_TEAM',
      'executor_version','ADAPTIVE@1','effective_config_ref',config_ref,'profile_refs','[]'::jsonb,
      'dispatch_plan',execute_receipt->'plan','dispatch_binding',execute_receipt->'binding'))
  then raise exception 'U22 adaptive Team payload rejected'; end if;
  tampered:=pg_catalog.jsonb_set(execute_receipt->'binding','{binding_hash}',
    pg_catalog.to_jsonb('sha256:9999999999999999999999999999999999999999999999999999999999999999'::text),false);
  if app_data_agent.command_payload_is_valid(pg_catalog.jsonb_build_object(
      'schema_version','effective-config-team-lease@2.0.0','kind','START_DATA_AGENT_TEAM',
      'executor_version','ADAPTIVE@1','effective_config_ref',config_ref,'profile_refs','[]'::jsonb,
      'dispatch_plan',execute_receipt->'plan','dispatch_binding',tampered))
  then raise exception 'U22 tampered adaptive binding accepted'; end if;
  tampered:=pg_catalog.jsonb_set(execute_receipt->'binding','{policy_version}',
    pg_catalog.to_jsonb('adaptive-routing@9.9.9'::text),false);
  tampered:=pg_catalog.jsonb_set(tampered,'{capability_snapshot_hash}',
    pg_catalog.to_jsonb('sha256:8888888888888888888888888888888888888888888888888888888888888888'::text),false);
  tampered:=pg_catalog.jsonb_set(tampered,'{binding_hash}',pg_catalog.to_jsonb(
    app_data_agent.u2_canonical_sha256(tampered-'binding_hash'::text)),false);
  if app_data_agent.command_payload_is_valid(pg_catalog.jsonb_build_object(
      'schema_version','effective-config-team-lease@2.0.0','kind','START_DATA_AGENT_TEAM',
      'executor_version','ADAPTIVE@1','effective_config_ref',config_ref,'profile_refs','[]'::jsonb,
      'dispatch_plan',execute_receipt->'plan','dispatch_binding',tampered))
  then raise exception 'U22 rehashed policy/capability-mismatched binding accepted'; end if;

  select pg_catalog.jsonb_build_object('defaults_id',pointer.defaults_id,
      'defaults_revision',pointer.defaults_revision,'defaults_hash',pointer.defaults_hash)
    into strict defaults_ref from app_data_agent.workspace_run_defaults pointer
    where pointer.app_id='00000000-0000-4000-8000-00000000da01'
      and pointer.tenant_id='00000000-0000-4000-8000-00000000aa22'
      and pointer.environment='test';
  legacy_config:=pg_catalog.jsonb_build_object(
    'schema_version','run-config-request@1.0.0','workspace_id','00000000-0000-4000-8000-00000000aa22',
    'idempotency_key','u22:accept:legacy','defaults_ref',defaults_ref,
    'overrides',pg_catalog.jsonb_build_object(
      'model',pg_catalog.jsonb_build_object('mode','INHERIT_DEFAULT'),
      'datasource',pg_catalog.jsonb_build_object('mode','INHERIT_DEFAULT'),
      'files',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
      'knowledge',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
      'mcp_servers',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
      'skills',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),'egress',null),
    'mentions','[]'::jsonb,'operation','QUESTION_RUN',
    'conversation_ref',pg_catalog.jsonb_build_object(
      'conversation_id','00000000-0000-4000-8000-000000002817','expected_resource_version',1),
    'run_id','00000000-0000-4000-8000-000000002830');
  legacy_config:=legacy_config||pg_catalog.jsonb_build_object(
    'request_hash',app_data_agent.u2_canonical_sha256(legacy_config));
  legacy_command:=pg_catalog.jsonb_build_object(
    'run_id','00000000-0000-4000-8000-000000002830',
    'command_id','00000000-0000-4000-8000-000000002831',
    'event_id','00000000-0000-4000-8000-000000002832',
    'outbox_id','00000000-0000-4000-8000-000000002833',
    'audit_id','00000000-0000-4000-8000-000000002834',
    'idempotency_key','u22:accept:legacy','question','legacy seven-key acceptance');
  resolution:=app_data_agent.accept_question_run_with_effective_config(legacy_command,legacy_config);
  select command.payload_json into strict accepted_payload from app_data_agent.commands command
    where command.command_id='00000000-0000-4000-8000-000000002831';
  if resolution#>>'{resolution,admission}'<>'READY'
    or accepted_payload->>'kind'<>'START_L2_RESEARCH'
    or accepted_payload ? 'schema_version'
    or not exists(select 1 from app_data_agent.outbox message
      where message.outbox_id='00000000-0000-4000-8000-000000002833'
        and message.topic='run.command.accepted')
  then raise exception 'U22 legacy seven-key atomic acceptance failed: resolution=% payload=% outbox=%',
    resolution,accepted_payload,(select message.payload_json from app_data_agent.outbox message
      where message.outbox_id='00000000-0000-4000-8000-000000002833'); end if;
  begin
    perform app_data_agent.accept_question_run_with_effective_config(
      pg_catalog.jsonb_set(legacy_command,'{question}',pg_catalog.to_jsonb('changed replay'::text),false),
      legacy_config);
    raise exception 'U22 legacy acceptance replay mismatch was accepted';
  exception when unique_violation then
    if sqlerrm<>'EFFECTIVE_CONFIG_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;

  adaptive_plan:=pg_catalog.jsonb_build_object(
    'schema_version','agent-dispatch-plan@1.0.0',
    'plan_id','00000000-0000-4000-8000-000000002835',
    'run_id','00000000-0000-4000-8000-000000002840',
    'question_class','EXPLANATION','mode','DIRECT','selected_profile_refs','[]'::jsonb,
    'dependency_edges','[]'::jsonb,'required_evidence','["DIRECT_PROVIDER_RECEIPT"]'::jsonb,
    'reason_codes','["DIRECT_EXPLANATION_ADMISSIBLE"]'::jsonb,
    'capability_snapshot_hash',capability_hash,'policy_version',policy_version,
    'direct_admissibility_receipt',direct_receipt);
  adaptive_plan:=adaptive_plan||pg_catalog.jsonb_build_object(
    'plan_hash',app_data_agent.u2_canonical_sha256(adaptive_plan));
  adaptive_binding:=pg_catalog.jsonb_build_object(
    'schema_version','agent-dispatch-execution-binding@1.0.0',
    'run_id','00000000-0000-4000-8000-000000002840','effective_executor_version','ADAPTIVE@1',
    'dispatch_plan_ref',pg_catalog.jsonb_build_object(
      'plan_id',adaptive_plan->>'plan_id','plan_hash',adaptive_plan->>'plan_hash'),
    'selected_profile_refs','[]'::jsonb,'policy_version',policy_version,
    'capability_snapshot_hash',capability_hash,'shadow_dispatch_plan_ref','null'::jsonb);
  adaptive_binding:=adaptive_binding||pg_catalog.jsonb_build_object(
    'binding_hash',app_data_agent.u2_canonical_sha256(adaptive_binding));
  adaptive_execute:=pg_catalog.jsonb_build_object(
    'kind','EXECUTE','plan',adaptive_plan,'binding',adaptive_binding);
  adaptive_config:=pg_catalog.jsonb_set(legacy_config,'{idempotency_key}',
    pg_catalog.to_jsonb('u22:accept:adaptive'::text),false);
  adaptive_config:=pg_catalog.jsonb_set(adaptive_config,'{conversation_ref,conversation_id}',
    pg_catalog.to_jsonb('00000000-0000-4000-8000-000000002818'::text),false);
  adaptive_config:=pg_catalog.jsonb_set(adaptive_config,'{run_id}',
    pg_catalog.to_jsonb('00000000-0000-4000-8000-000000002840'::text),false);
  adaptive_config:=pg_catalog.jsonb_set(adaptive_config,'{request_hash}',pg_catalog.to_jsonb(
    app_data_agent.u2_canonical_sha256(adaptive_config-'request_hash'::text)),false);
  adaptive_command:=pg_catalog.jsonb_build_object(
    'run_id','00000000-0000-4000-8000-000000002840',
    'command_id','00000000-0000-4000-8000-000000002841',
    'event_id','00000000-0000-4000-8000-000000002842',
    'outbox_id','00000000-0000-4000-8000-000000002843',
    'audit_id','00000000-0000-4000-8000-000000002844',
    'idempotency_key','u22:accept:adaptive','question','adaptive nine-key acceptance',
    'dispatch_admission',adaptive_execute,'shadow_dispatch_plan',null);
  resolution:=app_data_agent.accept_question_run_with_effective_config(adaptive_command,adaptive_config);
  select command.payload_json into strict accepted_payload from app_data_agent.commands command
    where command.command_id='00000000-0000-4000-8000-000000002841';
  if resolution#>>'{resolution,admission}'<>'READY'
    or accepted_payload->>'schema_version'<>'effective-config-team-lease@2.0.0'
    or accepted_payload->>'executor_version'<>'ADAPTIVE@1'
    or accepted_payload->'dispatch_plan'<>adaptive_plan
    or accepted_payload->'dispatch_binding'<>adaptive_binding
    or not exists(select 1 from app_data_agent.agent_dispatch_execute_receipts receipt
      where receipt.run_id='00000000-0000-4000-8000-000000002840'
        and receipt.receipt_json=adaptive_execute and receipt.shadow_plan_json='null'::jsonb)
    or not exists(select 1 from app_data_agent.outbox message
      where message.outbox_id='00000000-0000-4000-8000-000000002843'
        and message.topic='run.command.accepted')
  then raise exception 'U22 adaptive nine-key atomic acceptance failed'; end if;
end
$adaptive_dispatch$;

rollback;
select 'ADAPTIVE_DISPATCH_ASSERTIONS_PASSED' as result;
