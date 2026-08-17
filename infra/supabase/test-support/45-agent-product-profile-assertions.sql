\set ON_ERROR_STOP on

do $catalog$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u20_profile_owner'
    and not rolcanlogin and not rolsuper and not rolinherit and not rolbypassrls)
  then raise exception 'U20 Agent Profile owner flags unsafe'; end if;
  if (select pg_catalog.count(*) from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace
    on namespace.oid=relation.relnamespace where namespace.nspname='app_data_agent'
      and relation.relname in ('agent_product_profile_revisions','agent_product_profile_heads',
        'agent_product_profile_operation_receipts') and relation.relrowsecurity and relation.relforcerowsecurity
      and relation.relowner=(select oid from pg_catalog.pg_roles
        where rolname='data_agent_u20_profile_owner'))<>3
  then raise exception 'U20 Agent Profile relation closure unsafe'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.agent_product_profile_heads','SELECT,INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_agent_profile_revision(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_agent_team_public_projection(uuid)','EXECUTE')
  then raise exception 'U20 Agent Profile DML or RPC grant unsafe'; end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010667_app_data_agent_agent_product_profiles')
  then raise exception 'U20 Agent Profile migration ledger missing'; end if;
  if not app_data_agent.public_run_display_payload_is_valid(
      'run.reasoning_delta',
      '{"block_id":"reasoning-1","delta":"public execution summary"}'::jsonb)
    or app_data_agent.public_run_display_payload_is_valid(
      'run.reasoning_delta',
      '{"block_id":"reasoning-1","delta":"public","reasoning_content":"private"}'::jsonb)
    or app_data_agent.public_run_display_payload_is_valid(
      'run.reasoning_delta','{"block_id":"reasoning-1","delta":123}'::jsonb)
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.prepare_run_event_insert()'::regprocedure),
      'public_run_display_payload_is_valid')=0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.append_run_event(jsonb,jsonb,text,text,jsonb,text)'::regprocedure),
      'run.reasoning_completed')=0
  then raise exception 'U20 public Agent SSE boundary missing'; end if;
  if app_data_agent.reduce_run_projection_document(
      '{"schema_version":"1.0.0","run_id":"00000000-0000-4000-8000-000000000001","version":2,"worker_fence":1,"status":"RUNNING","last_event_id":"00000000-0000-4000-8000-000000000002","last_occurred_at":"2026-08-18T00:00:00.000Z","terminal_event_id":null}'::jsonb,
      '{"schema_version":"1.0.0","event_id":"00000000-0000-4000-8000-000000000003","scope":{"app_id":"00000000-0000-4000-8000-00000000da01","tenant_id":"00000000-0000-4000-8000-00000000aa22","environment":"test"},"run_id":"00000000-0000-4000-8000-000000000001","sequence":3,"worker_fence":1,"idempotency_key":"reasoning:3","occurred_at":"2026-08-18T00:00:01.000Z","event_type":"run.reasoning_delta","payload":{"block_id":"reasoning-1","delta":"public summary"}}'::jsonb
    )#>>'{status}'<>'RUNNING'
  then raise exception 'U20 public Agent SSE changed Run authority state'; end if;
end
$catalog$;

begin;
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

do $vectors$
declare
  scope_document jsonb:=pg_catalog.jsonb_build_object(
    'app_id','00000000-0000-4000-8000-00000000da01',
    'tenant_id','00000000-0000-4000-8000-00000000aa22','environment','test');
  skill_revision jsonb; skill_command jsonb; profile_revision jsonb; profile_command jsonb;
  runtime_profile jsonb; additional_skill_id uuid;
  first_result jsonb; replay_result jsonb; listed jsonb; disabled_skill jsonb; unavailable_profile jsonb;
  additional_profile_id text; legacy_payload jsonb; routed_payload jsonb;
begin
  skill_revision:=pg_catalog.jsonb_build_object(
    'schema_version','skill-revision@1.0.0','scope',scope_document,
    'skill_id','00000000-0000-4000-8000-000000002301','revision',1,
    'name','Evidence to Report','source_url','https://builtin.data-agent.invalid/skills/evidence-report',
    'package_hash','sha256:1111111111111111111111111111111111111111111111111111111111111111',
    'dependency_lock_hash','sha256:2222222222222222222222222222222222222222222222222222222222222222',
    'signer_id','00000000-0000-4000-8000-000000002001',
    'signature_hash','sha256:3333333333333333333333333333333333333333333333333333333333333333',
    'publisher_trust','TRUSTED_PUBLISHER','approval_status','APPROVED',
    'capabilities',pg_catalog.jsonb_build_array('evidence.read','report.project'),
    'default_resources','[]'::jsonb,'install_scripts','[]'::jsonb);
  skill_revision:=skill_revision||pg_catalog.jsonb_build_object(
    'revision_hash',app_data_agent.u2_canonical_sha256(skill_revision));
  skill_command:=pg_catalog.jsonb_build_object(
    'schema_version','extension-revision-commit@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000002401',
    'idempotency_key','u20:skill:commit:1','kind','SKILL','expected_head_version',null,
    'target_lifecycle','ENABLED','revision',skill_revision);
  perform app_data_agent.commit_extension_revision(skill_command);

  select runtime.profile_json into runtime_profile
  from app_data_agent.agent_profile_revisions runtime
  where runtime.profile_id='report-writing-agent' and runtime.profile_revision=1;

  profile_revision:=pg_catalog.jsonb_build_object(
    'schema_version','agent-product-profile-revision@1.0.0','scope',scope_document,
    'profile_id','report-writing-agent','revision',1,
    'runtime_profile_ref',pg_catalog.jsonb_build_object('profile_id','report-writing-agent',
      'revision',1,'profile_hash',runtime_profile->>'profile_hash'),
    'model_profile_ref',pg_catalog.jsonb_build_object('resource_id','00000000-0000-4000-8000-000000002501',
      'resource_revision',1,'resource_hash','sha256:5555555555555555555555555555555555555555555555555555555555555555'),
    'prompt_ref',pg_catalog.jsonb_build_object('prompt_id','prompt.report','revision',1,
      'prompt_hash','sha256:6666666666666666666666666666666666666666666666666666666666666666'),
    'workflow_ref',pg_catalog.jsonb_build_object('workflow_id','workflow.report','revision',1,
      'workflow_hash','sha256:7777777777777777777777777777777777777777777777777777777777777777'),
    'direct_tool_allowlist',runtime_profile->'direct_tool_allowlist',
    'skill_refs',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'skill_id',skill_revision->>'skill_id','revision',1,'revision_hash',skill_revision->>'revision_hash')),
    'context_policy_ref',pg_catalog.jsonb_build_object('resource_id','00000000-0000-4000-8000-000000002502',
      'resource_revision',1,'resource_hash','sha256:8888888888888888888888888888888888888888888888888888888888888888'),
    'execution_safety_policy_ref',pg_catalog.jsonb_build_object('resource_id','00000000-0000-4000-8000-000000002503',
      'resource_revision',1,'resource_hash','sha256:9999999999999999999999999999999999999999999999999999999999999999'),
    'expected_output_artifact_types',runtime_profile->'expected_output_artifact_types',
    'verifier_contract_hash',app_data_agent.u2_canonical_sha256(runtime_profile->'verifier'),
    'approval_status','APPROVED');
  profile_revision:=profile_revision||pg_catalog.jsonb_build_object(
    'revision_hash',app_data_agent.u2_canonical_sha256(profile_revision));
  profile_command:=pg_catalog.jsonb_build_object(
    'schema_version','agent-product-profile-commit-command@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000002402',
    'idempotency_key','u20:profile:commit:1',
    'actor_principal_id','00000000-0000-4000-8000-000000001003',
    'revision',profile_revision,'expected_head_version',0,'target_lifecycle','ENABLED');
  profile_command:=profile_command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(profile_command));
  first_result:=app_data_agent.commit_agent_profile_revision(profile_command);
  replay_result:=app_data_agent.commit_agent_profile_revision(profile_command);
  foreach additional_profile_id in array array['governed-text2sql-agent','semantic-management-agent'] loop
    select runtime.profile_json into runtime_profile
    from app_data_agent.agent_profile_revisions runtime
    where runtime.profile_id=additional_profile_id and runtime.profile_revision=1;
    additional_skill_id:=case when additional_profile_id='governed-text2sql-agent'
      then '00000000-0000-4000-8000-000000002302'::uuid
      else '00000000-0000-4000-8000-000000002303'::uuid end;
    skill_revision:=pg_catalog.jsonb_set(skill_revision,'{skill_id}',
      pg_catalog.to_jsonb(additional_skill_id::text),false);
    skill_revision:=pg_catalog.jsonb_set(skill_revision,'{name}',
      pg_catalog.to_jsonb(additional_profile_id||' Skill'),false);
    skill_revision:=pg_catalog.jsonb_set(skill_revision,'{capabilities}',
      runtime_profile->'direct_tool_allowlist',false);
    skill_revision:=pg_catalog.jsonb_set(skill_revision,'{revision_hash}',
      pg_catalog.to_jsonb(app_data_agent.u2_canonical_sha256(skill_revision-'revision_hash')),false);
    skill_command:=pg_catalog.jsonb_build_object(
      'schema_version','extension-revision-commit@1.0.0',
      'operation_id',case when additional_profile_id='governed-text2sql-agent'
        then '00000000-0000-4000-8000-000000002410'
        else '00000000-0000-4000-8000-000000002411' end,
      'idempotency_key',case when additional_profile_id='governed-text2sql-agent'
        then 'u20:skill:text2sql:1' else 'u20:skill:semantic:1' end,
      'kind','SKILL','expected_head_version',null,'target_lifecycle','ENABLED',
      'revision',skill_revision);
    perform app_data_agent.commit_extension_revision(skill_command);
    profile_revision:=pg_catalog.jsonb_set(profile_revision,'{profile_id}',
      pg_catalog.to_jsonb(additional_profile_id),false);
    profile_revision:=pg_catalog.jsonb_set(profile_revision,'{runtime_profile_ref}',
      pg_catalog.jsonb_build_object('profile_id',additional_profile_id,'revision',1,
        'profile_hash',runtime_profile->>'profile_hash'),false);
    profile_revision:=pg_catalog.jsonb_set(profile_revision,'{direct_tool_allowlist}',
      runtime_profile->'direct_tool_allowlist',false);
    profile_revision:=pg_catalog.jsonb_set(profile_revision,'{skill_refs}',
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'skill_id',additional_skill_id,'revision',1,
        'revision_hash',skill_revision->>'revision_hash')),false);
    profile_revision:=pg_catalog.jsonb_set(profile_revision,'{expected_output_artifact_types}',
      runtime_profile->'expected_output_artifact_types',false);
    profile_revision:=pg_catalog.jsonb_set(profile_revision,'{verifier_contract_hash}',
      pg_catalog.to_jsonb(app_data_agent.u2_canonical_sha256(runtime_profile->'verifier')),false);
    profile_revision:=pg_catalog.jsonb_set(profile_revision,'{revision_hash}',
      pg_catalog.to_jsonb(app_data_agent.u2_canonical_sha256(profile_revision-'revision_hash')),false);
    profile_command:=pg_catalog.jsonb_build_object(
      'schema_version','agent-product-profile-commit-command@1.0.0',
      'operation_id',case when additional_profile_id='governed-text2sql-agent'
        then '00000000-0000-4000-8000-000000002405'
        else '00000000-0000-4000-8000-000000002406' end,
      'idempotency_key',case when additional_profile_id='governed-text2sql-agent'
        then 'u20:profile:text2sql:1' else 'u20:profile:semantic:1' end,
      'actor_principal_id','00000000-0000-4000-8000-000000001003',
      'revision',profile_revision,'expected_head_version',0,'target_lifecycle','ENABLED');
    profile_command:=profile_command||pg_catalog.jsonb_build_object(
      'command_hash',app_data_agent.u2_canonical_sha256(profile_command));
    perform app_data_agent.commit_agent_profile_revision(profile_command);
  end loop;
  listed:=app_data_agent.list_agent_profile_revisions(true);
  if first_result->>'disposition'<>'COMMITTED' or replay_result->>'disposition'<>'REPLAYED'
    or pg_catalog.jsonb_array_length(listed->'items')<>3
    or listed#>>'{items,1,head,lifecycle}'<>'ENABLED'
  then raise exception 'U20 Agent Profile commit/replay/list failed'; end if;

  insert into app_data_agent.runs(app_id,tenant_id,environment,run_id,principal_id,status,question)
  values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa22',
    'test','00000000-0000-4000-8000-000000002601','00000000-0000-4000-8000-000000001003',
    'QUEUED','U20 command routing probe');
  legacy_payload:=pg_catalog.jsonb_build_object('kind','START_L2_RESEARCH',
    'effective_config_ref',pg_catalog.jsonb_build_object(
      'config_id','00000000-0000-4000-8000-000000002602','config_revision',1,
      'config_hash','sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'));
  insert into app_data_agent.commands(app_id,tenant_id,environment,command_id,run_id,principal_id,
    idempotency_key,payload_json,payload_hash,status)
  values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa22',
    'test','00000000-0000-4000-8000-000000002603','00000000-0000-4000-8000-000000002601',
    '00000000-0000-4000-8000-000000001003','u20:team:command:1',legacy_payload,
    platform.canonical_sha256(legacy_payload),'ACCEPTED');
  select payload_json into routed_payload from app_data_agent.commands
  where app_id='00000000-0000-4000-8000-00000000da01' and tenant_id='00000000-0000-4000-8000-00000000aa22'
    and environment='test' and command_id='00000000-0000-4000-8000-000000002603';
  if routed_payload->>'kind'<>'START_DATA_AGENT_TEAM'
    or pg_catalog.jsonb_array_length(routed_payload->'profile_refs')<>3
    or not app_data_agent.command_payload_is_valid(routed_payload)
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.claim_run_work(text,integer,integer)'::regprocedure),'START_DATA_AGENT_TEAM')=0
  then raise exception 'U20 Question command did not route to Team'; end if;
  if app_data_agent.load_agent_team_public_projection(
    '00000000-0000-4000-8000-000000002601'::uuid) is not null
  then raise exception 'U20 empty Team trace was not null'; end if;

  disabled_skill:=app_data_agent.commit_extension_revision(pg_catalog.jsonb_build_object(
    'schema_version','extension-revision-commit@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000002403',
    'idempotency_key','u20:skill:disable:1','kind','SKILL','expected_head_version',1,
    'target_lifecycle','DISABLED','revision',skill_revision));
  if pg_catalog.jsonb_array_length(
    app_data_agent.list_agent_profile_revisions(true)->'items')<>2
  then raise exception 'U20 disabled Skill left Profile runnable'; end if;
  profile_revision:=pg_catalog.jsonb_set(profile_revision,'{revision}','2'::jsonb,false);
  profile_revision:=pg_catalog.jsonb_set(profile_revision,'{revision_hash}',
    pg_catalog.to_jsonb(app_data_agent.u2_canonical_sha256(profile_revision-'revision_hash')),false);
  profile_command:=pg_catalog.jsonb_build_object(
    'schema_version','agent-product-profile-commit-command@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000002404',
    'idempotency_key','u20:profile:commit:2',
    'actor_principal_id','00000000-0000-4000-8000-000000001003',
    'revision',profile_revision,'expected_head_version',1,'target_lifecycle','ENABLED');
  profile_command:=profile_command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(profile_command));
  begin
    unavailable_profile:=app_data_agent.commit_agent_profile_revision(profile_command);
    raise exception 'U20 disabled Skill unexpectedly entered Profile';
  exception when sqlstate '42501' then
    if sqlerrm<>'AGENT_PROFILE_SKILL_NOT_AVAILABLE' then raise; end if;
  end;
end
$vectors$;

rollback;
select 'U20_AGENT_PRODUCT_PROFILE_ASSERTIONS_PASSED' as result;
