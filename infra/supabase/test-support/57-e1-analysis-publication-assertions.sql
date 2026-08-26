\set ON_ERROR_STOP on

begin;

do $e1_analysis_publication_authority$
declare definition text;
begin
  select prosrc into strict definition from pg_catalog.pg_proc
    where oid='app_data_agent.commit_e1_analysis_publication(jsonb)'::regprocedure;
  if pg_catalog.to_regclass('app_data_agent.e1_analysis_publications') is null
    or pg_catalog.to_regclass('app_data_agent.e1_analysis_publication_artifacts') is null
    or pg_catalog.to_regclass('app_data_agent.e1_analysis_publication_current') is null
    or pg_catalog.to_regclass('app_data_agent.e1_analysis_publication_outbox') is null
    or pg_catalog.strpos(definition,'RESEARCH_AUTHORITY_FENCE_MISMATCH')=0
    or pg_catalog.strpos(definition,'E1_ANALYSIS_PUBLICATION_STAGE_INVALID')=0
    or pg_catalog.strpos(definition,'analysis_system_artifacts')=0
    or pg_catalog.strpos(definition,'analysis_authority_current')=0
    or pg_catalog.strpos(definition,'e1_analysis_publication_current')=0
    or pg_catalog.strpos(definition,'e1_analysis_publication_outbox')=0
  then raise exception 'E1_ANALYSIS_PUBLICATION_AUTHORITY_ASSERTION_FAILED'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.e1_analysis_publications','INSERT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.e1_analysis_publication_current','UPDATE')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.e1_analysis_publication_outbox','INSERT')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.commit_e1_analysis_publication(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_e1_analysis_publication(jsonb)','EXECUTE')
  then raise exception 'E1_ANALYSIS_PUBLICATION_PRIVILEGE_ASSERTION_FAILED'; end if;
end
$e1_analysis_publication_authority$;

create function pg_temp.e1_id(value integer)
returns uuid language sql immutable set search_path='' as $function$
  select ('00000000-0000-4000-8000-'||pg_catalog.lpad(value::text,12,'0'))::uuid
$function$;

create function pg_temp.e1_hash(hash_character text)
returns text language sql immutable set search_path='' as $function$
  select 'sha256:'||pg_catalog.repeat(hash_character,64)
$function$;

create function pg_temp.e1_ref(run_id uuid,artifact_id uuid,artifact_type text,content_hash text)
returns jsonb language sql immutable set search_path='' as $function$
  select pg_catalog.jsonb_build_object(
    'artifact_id',artifact_id,'artifact_type',artifact_type,
    'app_id','00000000-0000-4000-8000-00000000da01',
    'tenant_id','00000000-0000-4000-8000-00000000aa11',
    'environment','test','run_id',run_id,'revision',1,'content_hash',content_hash)
$function$;

create function pg_temp.e1_envelope(slot integer,verdict text,worker_fence bigint)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare
  run_id uuid:=pg_temp.e1_id(9700+slot);attempt_id uuid:=pg_temp.e1_id(10000+slot);
  stage_id uuid:=pg_temp.e1_id(10100+slot);scope_json jsonb;program_ref jsonb;
  oracle_material jsonb;oracle_receipt jsonb;oracle_payload jsonb;explanation jsonb;
  authority_material jsonb;authority_commit jsonb;journal_material jsonb;journal_command jsonb;
  stage_artifacts jsonb;output_bindings jsonb;l2_evidence jsonb;l2_completion jsonb;
  chart_material jsonb;chart_document jsonb;report_material jsonb;report_document jsonb;
  command_material jsonb;stage_hash text:=pg_temp.e1_hash('a');closure_hash text:=pg_temp.e1_hash('b');
  operator_hash text:=pg_temp.e1_hash('c');sandbox_payload jsonb;
begin
  scope_json:=pg_catalog.jsonb_build_object(
    'app_id','00000000-0000-4000-8000-00000000da01',
    'tenant_id','00000000-0000-4000-8000-00000000aa11','environment','test');
  program_ref:=pg_temp.e1_ref(run_id,pg_temp.e1_id(16000+slot),'AnalysisProgram',pg_temp.e1_hash('d'));
  oracle_material:=pg_catalog.jsonb_build_object(
    'schema_version','analysis-oracle-receipt@1.0.0','oracle_id',pg_temp.e1_id(20000+slot),
    'scope',scope_json,'run_id',run_id,'node_id','node-1','analysis_program_ref',program_ref,
    'implementation_id','independent-e1-test-oracle@1','implementation_hash',pg_temp.e1_hash('e'),
    'input_binding',pg_catalog.jsonb_build_object(
      'query_evidence_refs',pg_catalog.jsonb_build_array(pg_temp.e1_ref(
        run_id,pg_temp.e1_id(17000+slot),'QueryEvidence',pg_temp.e1_hash('f'))),
      'input_materialization_closure_hash',pg_temp.e1_hash('1'),'stage_id',stage_id,
      'stage_hash',stage_hash,'published_closure_hash',closure_hash,
      'operator_receipt_closure_hash',operator_hash,'sandbox_receipt_hash',pg_temp.e1_hash('2'),
      'chart_dataset_hashes',pg_catalog.jsonb_build_array(pg_temp.e1_hash('3'))),
    'verdict',verdict,'expected_terminal',case when verdict='PASS' then 'READY' else 'HOLD' end,
    'sample_size',12,'coverage_ratio',1,'limitation_codes','[]'::jsonb,
    'disclosure_codes',pg_catalog.jsonb_build_array('QUALITY_HOLDS_DISCLOSED'),
    'verified_at','2026-08-27T00:00:00.000Z');
  oracle_receipt:=oracle_material||pg_catalog.jsonb_build_object('receipt_hash',
    app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'hash_domain','analysis-oracle-receipt@1.0.0','value',oracle_material)));
  oracle_payload:=pg_catalog.jsonb_build_object('oracle_receipt',oracle_receipt);
  explanation:=pg_catalog.jsonb_build_object(
    'schema_version','analysis-agent-final@1.0.0','summary_zh','原子发布测试结果。');
  stage_artifacts:=pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('artifact_name','result','artifact_kind','RESULT',
      'media_type','application/json','content_sha256',pg_temp.e1_hash('4'),'bytes',2),
    pg_catalog.jsonb_build_object('artifact_name','table:result','artifact_kind','TABLE',
      'media_type','application/json','content_sha256',pg_temp.e1_hash('5'),'bytes',2),
    pg_catalog.jsonb_build_object('artifact_name','chart:result','artifact_kind','CHART',
      'media_type','application/json','content_sha256',pg_temp.e1_hash('6'),'bytes',2));
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'stage_artifact',artifact,
    'reference',pg_temp.e1_ref(run_id,pg_temp.e1_id(12000+slot*10+ordinality::integer),
      'SandboxResult',artifact->>'content_sha256')) order by ordinality)
  into output_bindings
  from pg_catalog.jsonb_array_elements(stage_artifacts) with ordinality as item(artifact,ordinality);
  sandbox_payload:=pg_catalog.jsonb_build_object(
    'schema_version','analysis-sandbox-execution-receipt@1.0.0','status','SUCCEEDED');
  authority_material:=pg_catalog.jsonb_build_object(
    'schema_version','analysis-authority-commit@1.0.0','scope',scope_json,
    'run_id',run_id,'principal_id','00000000-0000-4000-8000-000000001001',
    'node_id','node-1','attempt_id',attempt_id,'worker_fence',worker_fence,
    'idempotency_key','e1-authority:'||slot,'analysis_program_ref',program_ref,
    'stage_id',stage_id,'stage_hash',stage_hash,'closure_hash',closure_hash,
    'operator_receipt_closure_hash',operator_hash,'oracle_receipt_payload',oracle_payload,
    'oracle_receipt_hash',app_data_agent.u2_canonical_sha256(oracle_payload),
    'explanation',explanation,'explanation_hash',app_data_agent.u2_canonical_sha256(explanation),
    'output_bindings',output_bindings,
    'sandbox_receipt_ref',pg_temp.e1_ref(run_id,pg_temp.e1_id(13000+slot),
      'SandboxExecutionReceipt',app_data_agent.u2_canonical_sha256(sandbox_payload)),
    'sandbox_receipt_payload',sandbox_payload,
    'sandbox_receipt_hash',app_data_agent.u2_canonical_sha256(sandbox_payload),
    'public_event_id',pg_temp.e1_id(21000+slot));
  authority_commit:=authority_material||pg_catalog.jsonb_build_object('authority_commit_hash',
    app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'hash_domain','analysis-authority-commit@1.0.0','value',authority_material)));
  journal_material:=pg_catalog.jsonb_build_object(
    'schema_version','analysis-context-journal-append@1.0.0','scope',scope_json,
    'run_id',run_id,'principal_id','00000000-0000-4000-8000-000000001001',
    'node_id','node-1','attempt_id',attempt_id,'context_generation',1,
    'worker_fence',worker_fence,'expected_prev_seq',1,
    'expected_prev_entry_hash',pg_temp.e1_hash('7'),'runtime_digest',pg_temp.e1_hash('8'),
    'policy_version','analysis-cell-policy@1.0.0','operator_registry_digest',pg_temp.e1_hash('9'),
    'event',pg_catalog.jsonb_build_object('event_type','AUTHORITY_COMMITTED',
      'stage_id',stage_id,'authority_commit_hash',authority_commit->>'authority_commit_hash'));
  journal_command:=journal_material||pg_catalog.jsonb_build_object('append_hash',
    app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'hash_domain','analysis-context-journal-append@1.0.0','value',journal_material)));
  l2_evidence:=pg_catalog.jsonb_build_object(
    'envelope',pg_catalog.jsonb_build_object(
      'artifact_id',pg_temp.e1_id(18000+slot),'artifact_type','DerivedAnalysisEvidence',
      'app_id',scope_json->>'app_id','tenant_id',scope_json->>'tenant_id',
      'environment','test','run_id',run_id,'revision',1,'schema_version','2.0.0',
      'status','CANDIDATE','created_at','2026-08-27T00:00:00.000Z'),
    'payload',pg_catalog.jsonb_build_object('artifact_type','DerivedAnalysisEvidence','node_id','node-1'));
  l2_evidence:=pg_catalog.jsonb_set(l2_evidence,'{envelope,content_hash}',pg_catalog.to_jsonb(
    app_data_agent.runtime_canonical_sha256(pg_catalog.jsonb_build_object(
      'envelope',(l2_evidence->'envelope')-'created_at'-'status','payload',l2_evidence->'payload'))),true);
  l2_completion:=pg_catalog.jsonb_build_object(
    'envelope',pg_catalog.jsonb_build_object(
      'artifact_id',pg_temp.e1_id(19000+slot),'artifact_type','AnalysisCompletionReceipt',
      'app_id',scope_json->>'app_id','tenant_id',scope_json->>'tenant_id',
      'environment','test','run_id',run_id,'revision',1,'schema_version','1.0.0',
      'status','CANDIDATE','created_at','2026-08-27T00:00:00.000Z'),
    'payload',pg_catalog.jsonb_build_object('artifact_type','AnalysisCompletionReceipt','terminal','READY'));
  l2_completion:=pg_catalog.jsonb_set(l2_completion,'{envelope,content_hash}',pg_catalog.to_jsonb(
    app_data_agent.runtime_canonical_sha256(pg_catalog.jsonb_build_object(
      'envelope',(l2_completion->'envelope')-'created_at'-'status','payload',l2_completion->'payload'))),true);
  chart_material:=pg_catalog.jsonb_build_object(
    'schema_version','artifact-workspace-chart-document@3.0.0',
    'document_ref',pg_temp.e1_ref(run_id,pg_temp.e1_id(14000+slot),
      'ArtifactWorkspaceDocument',pg_temp.e1_hash('0'))-'content_hash',
    'source_refs','{}'::jsonb,'provenance','{}'::jsonb,
    'projection',pg_catalog.jsonb_build_object('kind','CHART'));
  chart_document:=pg_catalog.jsonb_set(chart_material,'{document_ref,content_hash}',pg_catalog.to_jsonb(
    app_data_agent.u2_canonical_sha256(chart_material)),true);
  report_material:=pg_catalog.jsonb_build_object(
    'schema_version','product-team-artifact@2.0.0',
    'artifact_ref',pg_temp.e1_ref(run_id,pg_temp.e1_id(15000+slot),
      'AnalysisReport',pg_temp.e1_hash('0'))-'content_hash',
    'profile_id','governed-analysis-agent','task_id',pg_temp.e1_id(22000+slot),
    'source_refs',pg_catalog.jsonb_build_array(l2_evidence->'envelope',l2_completion->'envelope'),
    'provenance',null,'projection',pg_catalog.jsonb_build_object('kind','REPORT'),
    'committed_at','2026-08-27T00:00:00.000Z');
  report_document:=pg_catalog.jsonb_set(report_material,'{artifact_ref,content_hash}',pg_catalog.to_jsonb(
    app_data_agent.u2_canonical_sha256(report_material)),true);
  command_material:=pg_catalog.jsonb_build_object(
    'schema_version','e1-analysis-publication@1.0.0','scope',scope_json,'run_id',run_id,
    'principal_id','00000000-0000-4000-8000-000000001001','attempt_id',attempt_id,
    'worker_fence',worker_fence,'idempotency_key','e1-publication:'||slot,
    'analysis_program_ref',program_ref,
    'nodes',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'authority_commit',authority_commit,'journal_command',journal_command,
      'oracle_receipt',oracle_receipt)),
    'l2_artifact_commands',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('candidate',l2_evidence),
      pg_catalog.jsonb_build_object('candidate',l2_completion)),
    'chart_documents',pg_catalog.jsonb_build_array(chart_document),
    'report_document',report_document,'public_event_id',pg_temp.e1_id(23000+slot));
  command_material:=command_material||pg_catalog.jsonb_build_object('publication_hash',
    app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'hash_domain','e1-analysis-publication@1.0.0','value',command_material)));
  return pg_catalog.jsonb_build_object(
    'protocol_version','u6-db-command@1.0.0',
    'authority_capability_id','00000000-0000-4000-8000-00000000c976',
    'command',command_material);
end
$function$;

create function pg_temp.setup_e1_publication_fixture(slot integer)
returns void language plpgsql volatile security definer set search_path='' as $function$
declare
  run_id uuid:=pg_temp.e1_id(9700+slot);command_id uuid:=pg_temp.e1_id(9800+slot);
  target_outbox_id uuid:=pg_temp.e1_id(9900+slot);attempt_id uuid:=pg_temp.e1_id(10000+slot);
  envelope jsonb:=pg_temp.e1_envelope(slot,'PASS',7);command_json jsonb:=envelope->'command';
  authority_json jsonb:=envelope#>'{command,nodes,0,authority_commit}';artifact jsonb;
begin
  insert into app_data_agent.runs(
    app_id,tenant_id,environment,run_id,principal_id,status,active_fence,question)
  values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
    'test',run_id,'00000000-0000-4000-8000-000000001001','RUNNING',7,
    'E1 atomic publication fixture');
  insert into app_data_agent.commands(
    app_id,tenant_id,environment,command_id,run_id,principal_id,idempotency_key,
    payload_json,payload_hash,status)
  values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
    'test',command_id,run_id,'00000000-0000-4000-8000-000000001001','e1-command:'||slot,
    '{"kind":"START_L2_RESEARCH","mode":"L2"}'::jsonb,
    platform.canonical_sha256('{"kind":"START_L2_RESEARCH","mode":"L2"}'::jsonb),'PROCESSING');
  insert into app_data_agent.outbox(
    app_id,tenant_id,environment,outbox_id,run_id,command_id,topic,payload_json,
    status,attempt_count,queue_sequence)
  values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
    'test',target_outbox_id,run_id,command_id,'run.command.accepted','{"kind":"START_L2_RESEARCH"}',
    'PENDING',0,slot);
  insert into app_data_agent.run_attempts(
    app_id,tenant_id,environment,run_id,outbox_id,command_id,attempt_id,attempt_no,
    worker_id,lease_token,worker_fence,status,lease_expires_at,last_heartbeat_at)
  values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
    'test',run_id,target_outbox_id,command_id,attempt_id,1,'e1-test-worker',1,7,'ACTIVE',
    pg_catalog.clock_timestamp()+interval '10 minutes',pg_catalog.clock_timestamp());
  update app_data_agent.outbox as target set
    status='LEASED',attempt_count=1,lease_owner='e1-test-worker',lease_token=1,
    lease_expires_at=pg_catalog.clock_timestamp()+interval '10 minutes',
    active_attempt_id=attempt_id,run_fence=7,last_heartbeat_at=pg_catalog.clock_timestamp()
  where target.app_id='00000000-0000-4000-8000-00000000da01'
    and target.tenant_id='00000000-0000-4000-8000-00000000aa11'
    and target.environment='test' and target.outbox_id=target_outbox_id;
  insert into app_data_agent.analysis_result_stages(
    app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,stage_id,
    principal_id,worker_fence,idempotency_key,publish_id,contract_hash,manifest_hash,
    closure_hash,stage_hash,governed_results_json,artifacts_json,command_json,expires_at)
  values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
    'test',run_id,'node-1',attempt_id,1,(authority_json->>'stage_id')::uuid,
    '00000000-0000-4000-8000-000000001001',7,'e1-stage:'||slot,'e1-publish:'||slot,
    pg_temp.e1_hash('a'),pg_temp.e1_hash('b'),authority_json->>'closure_hash',
    authority_json->>'stage_hash','[]'::jsonb,
    (select pg_catalog.jsonb_agg(value->'stage_artifact') from pg_catalog.jsonb_array_elements(
      authority_json->'output_bindings')),
    pg_catalog.jsonb_build_object('operator_finalization',pg_catalog.jsonb_build_object(
      'operator_receipt_closure_hash',authority_json->>'operator_receipt_closure_hash')),
    pg_catalog.clock_timestamp()+interval '10 minutes');
  for artifact in select value from pg_catalog.jsonb_array_elements(authority_json->'output_bindings') loop
    insert into app_data_agent.analysis_result_stage_artifacts(
      app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,stage_id,
      artifact_name,artifact_kind,media_type,content_sha256,byte_count,content_bytes)
    values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
      'test',run_id,'node-1',attempt_id,1,(authority_json->>'stage_id')::uuid,
      artifact#>>'{stage_artifact,artifact_name}',artifact#>>'{stage_artifact,artifact_kind}',
      'application/json',artifact#>>'{stage_artifact,content_sha256}',2,'{}'::bytea);
  end loop;
  insert into app_data_agent.analysis_stage_oracle_records(
    app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,stage_id,
    principal_id,worker_fence,receipt_hash,receipt_payload)
  values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
    'test',run_id,'node-1',attempt_id,1,(authority_json->>'stage_id')::uuid,
    '00000000-0000-4000-8000-000000001001',7,authority_json->>'oracle_receipt_hash',
    authority_json->'oracle_receipt_payload');
  insert into app_data_agent.analysis_stage_explanation_records(
    app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,stage_id,
    principal_id,worker_fence,explanation_hash,explanation,provider_invocation_ref)
  values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
    'test',run_id,'node-1',attempt_id,1,(authority_json->>'stage_id')::uuid,
    '00000000-0000-4000-8000-000000001001',7,authority_json->>'explanation_hash',
    authority_json->'explanation','{}'::jsonb);
  insert into app_data_agent.analysis_context_journal(
    app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,seq,
    principal_id,worker_fence,prev_entry_hash,entry_hash,append_hash,runtime_digest,
    policy_version,operator_registry_digest,event_json,entry_json)
  values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
    'test',run_id,'node-1',attempt_id,1,1,'00000000-0000-4000-8000-000000001001',7,
    null,pg_temp.e1_hash('7'),pg_temp.e1_hash('6'),pg_temp.e1_hash('8'),
    'analysis-cell-policy@1.0.0',pg_temp.e1_hash('9'),
    pg_catalog.jsonb_build_object('event_type','EXPLANATION_BOUND','stage_id',authority_json->>'stage_id',
      'explanation_hash',authority_json->>'explanation_hash'),
    pg_catalog.jsonb_build_object('schema_version','analysis-context-journal-entry@1.0.0'));
end
$function$;

insert into app_data_agent.research_authority_capabilities(
  app_id,tenant_id,environment,capability_id,assignment_key,principal_id,deployment_id,
  membership_version,app_epoch,membership_role,authority_kind,artifact_authority_domain,
  authority_epoch,state,expires_at)
select '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
  'test','00000000-0000-4000-8000-00000000c976',pg_temp.e1_hash('4'),
  '00000000-0000-4000-8000-000000001001','00000000-0000-4000-8000-00000000de01',
  membership.membership_version,lifecycle.authority_epoch,
  pg_catalog.upper(membership.membership_role),'RESEARCH_ARTIFACT_AUTHORITY','EVIDENCE',1,'ACTIVE',
  pg_catalog.clock_timestamp()+interval '10 minutes'
from app_data_agent.memberships membership
join platform.app_environment_lifecycle lifecycle
  on lifecycle.app_id=membership.app_id and lifecycle.environment=membership.environment
where membership.app_id='00000000-0000-4000-8000-00000000da01'
  and membership.tenant_id='00000000-0000-4000-8000-00000000aa11'
  and membership.environment='test'
  and membership.principal_id='00000000-0000-4000-8000-000000001001';
insert into app_data_agent.research_authority_capability_heads(
  app_id,tenant_id,environment,assignment_key,principal_id,authority_kind,
  artifact_authority_domain,current_capability_id,current_authority_epoch)
values('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11',
  'test',pg_temp.e1_hash('4'),'00000000-0000-4000-8000-000000001001',
  'RESEARCH_ARTIFACT_AUTHORITY','EVIDENCE','00000000-0000-4000-8000-00000000c976',1);

select pg_temp.setup_e1_publication_fixture(slot) from pg_catalog.generate_series(1,4) slot;
select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-00000000aa11',true);
select pg_catalog.set_config('data_agent.environment','test',true);
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-000000001001',true);
select pg_catalog.set_config('data_agent.role','owner',true);
select pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',true);

set local role data_agent_backend;
do $oracle_reject$
declare result jsonb;
begin
  result:=app_data_agent.commit_e1_analysis_publication(pg_temp.e1_envelope(2,'REJECT',7));
  if result->>'error_code'<>'E1_ANALYSIS_PUBLICATION_NODE_INVALID'
  then raise exception 'E1_ORACLE_REJECT_REASON_INVALID: %',result; end if;
end
$oracle_reject$;
reset role;
do $oracle_reject_atomic$
begin
  if exists(select 1 from app_data_agent.e1_analysis_publications where run_id=pg_temp.e1_id(9702))
    or exists(select 1 from app_data_agent.analysis_authority_current where run_id=pg_temp.e1_id(9702))
    or exists(select 1 from app_data_agent.analysis_system_artifacts where run_id=pg_temp.e1_id(9702))
    or exists(select 1 from app_data_agent.artifacts where run_id=pg_temp.e1_id(9702))
  then raise exception 'E1_ORACLE_REJECT_LEFT_PARTIAL_PUBLICATION'; end if;
end
$oracle_reject_atomic$;

set local role data_agent_backend;
do $stale_fence$
begin
  begin
    perform app_data_agent.commit_e1_analysis_publication(pg_temp.e1_envelope(3,'PASS',8));
    raise exception 'E1_STALE_FENCE_ACCEPTED';
  exception when sqlstate '42501' then
    if sqlerrm<>'DA_U6_CAPABILITY_REQUIRED' then raise; end if;
  end;
end
$stale_fence$;
reset role;
do $stale_fence_atomic$
begin
  if exists(select 1 from app_data_agent.e1_analysis_publications where run_id=pg_temp.e1_id(9703))
    or exists(select 1 from app_data_agent.analysis_authority_current where run_id=pg_temp.e1_id(9703))
    or exists(select 1 from app_data_agent.analysis_system_artifacts where run_id=pg_temp.e1_id(9703))
    or exists(select 1 from app_data_agent.artifacts where run_id=pg_temp.e1_id(9703))
  then raise exception 'E1_STALE_FENCE_LEFT_PARTIAL_PUBLICATION'; end if;
end
$stale_fence_atomic$;

create function pg_temp.fail_e1_outbox()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin raise exception using errcode='P0001',message='E1_TEST_OUTBOX_FAILURE'; end
$function$;
create trigger e1_test_outbox_failure before insert on app_data_agent.e1_analysis_publication_outbox
for each row execute function pg_temp.fail_e1_outbox();
set local role data_agent_backend;
do $outbox_failure$
declare result jsonb;
begin
  result:=app_data_agent.commit_e1_analysis_publication(pg_temp.e1_envelope(4,'PASS',7));
  if result->>'error_code'<>'E1_TEST_OUTBOX_FAILURE'
  then raise exception 'E1_OUTBOX_FAILURE_REASON_INVALID: %',result; end if;
end
$outbox_failure$;
reset role;
do $outbox_failure_atomic$
begin
  if exists(select 1 from app_data_agent.e1_analysis_publications where run_id=pg_temp.e1_id(9704))
    or exists(select 1 from app_data_agent.analysis_authority_current where run_id=pg_temp.e1_id(9704))
    or exists(select 1 from app_data_agent.analysis_system_artifacts where run_id=pg_temp.e1_id(9704))
    or exists(select 1 from app_data_agent.artifacts where run_id=pg_temp.e1_id(9704))
    or exists(select 1 from app_data_agent.analysis_context_journal
      where run_id=pg_temp.e1_id(9704) and seq>1)
  then raise exception 'E1_OUTBOX_FAILURE_LEFT_PARTIAL_PUBLICATION'; end if;
end
$outbox_failure_atomic$;
drop trigger e1_test_outbox_failure on app_data_agent.e1_analysis_publication_outbox;

set local role data_agent_backend;
do $complete_publication$
declare result jsonb;
begin
  result:=app_data_agent.commit_e1_analysis_publication(pg_temp.e1_envelope(1,'PASS',7));
  if (result->>'ok')::boolean is distinct from true
  then raise exception 'E1_COMPLETE_PUBLICATION_REJECTED: %',result; end if;
end
$complete_publication$;
reset role;
do $complete_publication_atomic$
begin
  if (select pg_catalog.count(*) from app_data_agent.e1_analysis_publications
      where run_id=pg_temp.e1_id(9701))<>1
    or (select pg_catalog.count(*) from app_data_agent.e1_analysis_publication_current
      where run_id=pg_temp.e1_id(9701))<>1
    or (select pg_catalog.count(*) from app_data_agent.e1_analysis_publication_outbox
      where run_id=pg_temp.e1_id(9701))<>1
    or (select pg_catalog.count(*) from app_data_agent.e1_analysis_publication_artifacts
      where run_id=pg_temp.e1_id(9701))<>8
    or (select pg_catalog.count(*) from app_data_agent.analysis_authority_current
      where run_id=pg_temp.e1_id(9701))<>1
    or (select pg_catalog.count(*) from app_data_agent.analysis_system_artifacts
      where run_id=pg_temp.e1_id(9701))<>4
    or (select pg_catalog.count(*) from app_data_agent.artifacts
      where run_id=pg_temp.e1_id(9701) and artifact_type in(
        'DerivedAnalysisEvidence','AnalysisCompletionReceipt','ArtifactWorkspaceDocument','AnalysisReport'))<>4
    or (select pg_catalog.count(*) from app_data_agent.analysis_context_journal
      where run_id=pg_temp.e1_id(9701) and seq=2
        and event_json->>'event_type'='AUTHORITY_COMMITTED')<>1
  then raise exception 'E1_COMPLETE_PUBLICATION_BUNDLE_INCOMPLETE'; end if;
end
$complete_publication_atomic$;

rollback;
