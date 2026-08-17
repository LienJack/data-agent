\set ON_ERROR_STOP on

do $catalog$
begin
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u14_extension_owner'
    and not rolcanlogin and not rolsuper and not rolinherit and not rolbypassrls)
  then raise exception 'U14 extension owner flags unsafe'; end if;
  if (select pg_catalog.count(*) from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace
    on namespace.oid=relation.relnamespace where namespace.nspname='app_data_agent'
      and relation.relname in ('mcp_server_revisions','mcp_server_heads','skill_revisions','skill_heads',
        'skill_signer_revocations','extension_operation_receipts','tool_effects','tool_effect_transitions')
      and relation.relrowsecurity and relation.relforcerowsecurity
      and relation.relowner=(select oid from pg_catalog.pg_roles where rolname='data_agent_u14_extension_owner'))<>8
  then raise exception 'U14 extension relation closure unsafe'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.mcp_server_heads','SELECT,INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_extension_revision(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.begin_tool_effect(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.resolve_extension_config_reference(text,uuid,bigint,text)','EXECUTE')
  then raise exception 'U14 direct DML or RPC grant unsafe'; end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010665_app_data_agent_extension_registry')
  then raise exception 'U14 migration ledger missing'; end if;
end
$catalog$;

begin;
set local role data_agent_backend;
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
  command jsonb:='{"schema_version":"extension-revision-commit@1.0.0","operation_id":"00000000-0000-4000-8000-000000001403","idempotency_key":"u14:mcp:commit:1","kind":"MCP_SERVER","expected_head_version":null,"target_lifecycle":"ENABLED","revision":{"schema_version":"mcp-server-revision@1.0.0","scope":{"app_id":"00000000-0000-4000-8000-00000000da01","tenant_id":"00000000-0000-4000-8000-00000000aa22","environment":"test"},"server_id":"00000000-0000-4000-8000-000000001401","revision":1,"endpoint":"https://mcp.example.test/v1","secret_ref_id":"00000000-0000-4000-8000-000000001402","trust_class":"EXTERNAL_REVIEWED","approval_status":"APPROVED","audience":"PRIVATE","manifest_version":"commerce-mcp@1","tools":[{"tool_id":"list_metrics","name":"List metrics","description":"List published metrics.","input_schema_hash":"sha256:1111111111111111111111111111111111111111111111111111111111111111","output_schema_hash":"sha256:2222222222222222222222222222222222222222222222222222222222222222","effect_semantics":"READ_ONLY","remote_idempotency_key_field":null,"outcome_status_tool_id":null,"required_capabilities":["semantic.read"],"max_timeout_ms":10000,"max_response_bytes":1000000}],"policy_revision":1,"revision_hash":"sha256:d8963f0fc6f9c84de0a00bb4c5d5efb25223d37ee855a8dd321171349dc5edf4"}}'::jsonb;
  skill_command jsonb:='{"schema_version":"extension-revision-commit@1.0.0","operation_id":"00000000-0000-4000-8000-000000001412","idempotency_key":"u14:skill:commit:1","kind":"SKILL","expected_head_version":null,"target_lifecycle":"ENABLED","revision":{"schema_version":"skill-revision@1.0.0","scope":{"app_id":"00000000-0000-4000-8000-00000000da01","tenant_id":"00000000-0000-4000-8000-00000000aa22","environment":"test"},"skill_id":"00000000-0000-4000-8000-000000001410","revision":1,"name":"Commerce Analyst","source_url":"https://skills.example.test/commerce.json","package_hash":"sha256:3333333333333333333333333333333333333333333333333333333333333333","dependency_lock_hash":"sha256:4444444444444444444444444444444444444444444444444444444444444444","signer_id":"00000000-0000-4000-8000-000000001411","signature_hash":"sha256:5555555555555555555555555555555555555555555555555555555555555555","publisher_trust":"TRUSTED_PUBLISHER","approval_status":"APPROVED","capabilities":["semantic.read"],"default_resources":[],"install_scripts":[],"revision_hash":"sha256:5c7494382236808f1484e6dd7ca4f46a5c0649a3eb6edb5008381188fa629761"}}'::jsonb;
  revoke_command jsonb:='{"schema_version":"skill-signer-revoke@1.0.0","operation_id":"00000000-0000-4000-8000-000000001413","idempotency_key":"u14:signer:revoke:1","signer_id":"00000000-0000-4000-8000-000000001411","expected_revocation_version":0,"reason_code":"SIGNER_COMPROMISED"}'::jsonb;
  first_result jsonb; replay_result jsonb; listed jsonb; skill_result jsonb;
  skills_before jsonb; revoke_result jsonb; skills_after jsonb;
begin
  first_result:=app_data_agent.commit_extension_revision(command);
  replay_result:=app_data_agent.commit_extension_revision(command);
  listed:=app_data_agent.list_extension_revisions('MCP_SERVER',true);
  if first_result->>'disposition'<>'COMMITTED' or first_result->>'head_version'<>'1'
    or replay_result->>'disposition'<>'REPLAYED'
    or pg_catalog.jsonb_array_length(listed->'items')<>1
    or listed#>>'{items,0,revision,revision_hash}'<>'sha256:d8963f0fc6f9c84de0a00bb4c5d5efb25223d37ee855a8dd321171349dc5edf4'
    or listed#>>'{items,0,head,lifecycle}'<>'ENABLED'
  then raise exception 'U14 MCP commit/replay/selection vector failed'; end if;
  skill_result:=app_data_agent.commit_extension_revision(skill_command);
  skills_before:=app_data_agent.list_extension_revisions('SKILL',true);
  revoke_result:=app_data_agent.revoke_skill_signer(revoke_command);
  skills_after:=app_data_agent.list_extension_revisions('SKILL',true);
  if skill_result->>'disposition'<>'COMMITTED'
    or pg_catalog.jsonb_array_length(skills_before->'items')<>1
    or revoke_result->>'disposition'<>'REVOKED'
    or revoke_result->>'revocation_version'<>'1'
    or pg_catalog.jsonb_array_length(skills_after->'items')<>0
  then raise exception 'U14 Skill signer revocation vector failed'; end if;
  begin
    perform app_data_agent.begin_tool_effect('{}'::jsonb);
    raise exception 'U14 invalid Tool Effect unexpectedly accepted';
  exception when sqlstate '22023' then
    if sqlerrm<>'TOOL_EFFECT_INTENT_INVALID' then raise; end if;
  end;
end
$vectors$;

set local role data_agent_effective_config_rpc_owner;
do $effective_config$
declare
  request_document jsonb:=pg_catalog.jsonb_build_object(
    'overrides',pg_catalog.jsonb_build_object(
      'files',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
      'knowledge',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
      'mcp_servers',pg_catalog.jsonb_build_object('mode','RESOURCE_IDS','resources',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'resource_id','00000000-0000-4000-8000-000000001401','expected_revision',1))),
      'skills',pg_catalog.jsonb_build_object('mode','RESOURCE_IDS','resources',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'resource_id','00000000-0000-4000-8000-000000001410','expected_revision',1)))),
    'mentions','[]'::jsonb);
  inherited_request jsonb:=pg_catalog.jsonb_build_object('overrides',pg_catalog.jsonb_build_object(
    'files',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
    'knowledge',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
    'mcp_servers',pg_catalog.jsonb_build_object('mode','INHERIT_DEFAULT'),
    'skills',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE')),'mentions','[]'::jsonb);
  wrong_hash_defaults jsonb:=pg_catalog.jsonb_build_object('files','[]'::jsonb,'knowledge','[]'::jsonb,
    'skills','[]'::jsonb,'mcp_servers',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'resource_id','00000000-0000-4000-8000-000000001401','resource_revision',1,
      'resource_hash','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')));
  bindings jsonb; inherited_bindings jsonb; mcp_binding jsonb; skill_binding jsonb;
begin
  bindings:=app_data_agent.build_requested_optional_resource_bindings(request_document);
  select item.document into mcp_binding from pg_catalog.jsonb_array_elements(bindings) item(document)
  where item.document->>'resource_kind'='MCP_SERVER';
  select item.document into skill_binding from pg_catalog.jsonb_array_elements(bindings) item(document)
  where item.document->>'resource_kind'='SKILL';
  inherited_bindings:=app_data_agent.build_inherited_optional_resource_bindings(
    inherited_request,wrong_hash_defaults);
  if mcp_binding->>'availability'<>'AVAILABLE'
    or mcp_binding#>>'{effective_resource,resource_revision}'<>'1'
    or mcp_binding#>>'{effective_resource,resource_hash}'<>
      'sha256:d8963f0fc6f9c84de0a00bb4c5d5efb25223d37ee855a8dd321171349dc5edf4'
    or skill_binding->>'availability'<>'UNAVAILABLE'
    or skill_binding->>'unavailable_reason'<>'RESOURCE_REVOKED'
    or inherited_bindings#>>'{0,unavailable_reason}'<>'RESOURCE_REVISION_MISMATCH'
  then raise exception 'U14 Effective Config exact Extension binding failed'; end if;
end
$effective_config$;
set local role data_agent_backend;
do $disable_mcp$
declare listed jsonb; disabled jsonb;
begin
  listed:=app_data_agent.list_extension_revisions('MCP_SERVER',false);
  disabled:=app_data_agent.commit_extension_revision(pg_catalog.jsonb_build_object(
    'schema_version','extension-revision-commit@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000001414',
    'idempotency_key','u14:mcp:disable:1','kind','MCP_SERVER','expected_head_version',1,
    'target_lifecycle','DISABLED','revision',listed#>'{items,0,revision}'));
  if disabled->>'lifecycle'<>'DISABLED' or disabled->>'head_version'<>'2'
  then raise exception 'U14 MCP disable CAS failed'; end if;
end
$disable_mcp$;
set local role data_agent_effective_config_rpc_owner;
do $disabled_config$
declare bindings jsonb;
begin
  bindings:=app_data_agent.build_requested_optional_resource_bindings(
    pg_catalog.jsonb_build_object('overrides',pg_catalog.jsonb_build_object(
      'files',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
      'knowledge',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
      'mcp_servers',pg_catalog.jsonb_build_object('mode','RESOURCE_IDS','resources',
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'resource_id','00000000-0000-4000-8000-000000001401','expected_revision',1))),
      'skills',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE')),'mentions','[]'::jsonb));
  if bindings#>>'{0,availability}'<>'UNAVAILABLE'
    or bindings#>>'{0,unavailable_reason}'<>'RESOURCE_DISABLED'
  then raise exception 'U14 disabled MCP entered Effective Config'; end if;
end
$disabled_config$;
set local role data_agent_backend;
rollback;

select 'U14_EXTENSION_REGISTRY_ASSERTIONS_PASSED' as result;
