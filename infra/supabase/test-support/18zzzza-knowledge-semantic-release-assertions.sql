-- Explicit Semantic Revision governance, Text2SQL release bridge and rollback closure.
do $assertions$
declare publish_definition text; metric_definition text; rollback_definition text;
begin
  select pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid)) into publish_definition
  from pg_catalog.pg_proc procedure
  where procedure.oid='semantic.self_review_and_publish_semantic_candidate(jsonb)'::regprocedure;
  if publish_definition not like '%semantic_candidate_revision%'
    or publish_definition not like '%semantic_review_task%'
    or publish_definition not like '%semantic_review_decision%'
    or publish_definition not like '%semantic_source_release%'
    or publish_definition not like '%bind_semantic_graph_release%'
    or publish_definition not like '%semantic_candidate_self_review_approved%'
    or publish_definition not like '%semantic_release_published%'
    or publish_definition not like '%data_agent.role%owner%'
  then raise exception 'SEMANTIC_EXPLICIT_SELF_PUBLISH_CLOSURE_INCOMPLETE'; end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid)) into metric_definition
  from pg_catalog.pg_proc procedure
  where procedure.oid=
    'app_data_agent.resolved_context_metric_projection(uuid,uuid,text,text,uuid)'::regprocedure;
  if metric_definition not like '%resolved_context_metric_projection_initial%'
    or metric_definition not like '%semantic_executable_projection%'
    or metric_definition not like '%release.release_id=p_release_id%'
  then raise exception 'SEMANTIC_TEXT2SQL_EXACT_RELEASE_BRIDGE_INCOMPLETE'; end if;

  select pg_catalog.lower(pg_catalog.pg_get_functiondef(procedure.oid)) into rollback_definition
  from pg_catalog.pg_proc procedure
  where procedure.oid='semantic.execute_rollback(uuid,uuid,text,text,uuid,uuid,text)'::regprocedure;
  if rollback_definition not like '%current_release_id=v_auth.to_release_id%'
    or rollback_definition not like '%current_release_generation=v_auth.to_release_generation%'
  then raise exception 'SEMANTIC_EXACT_RELEASE_ROLLBACK_INCOMPLETE'; end if;

  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010682_app_data_agent_semantic_self_publish')
  then raise exception 'SEMANTIC_SELF_PUBLISH_LEDGER_MISSING'; end if;
end
$assertions$;

begin;

create table public.knowledge_semantic_customers (
  id uuid primary key,
  segment text not null,
  tenant_id uuid not null
);
create table public.knowledge_semantic_orders (
  id uuid primary key,
  customer_id uuid not null references public.knowledge_semantic_customers(id),
  created_at timestamptz not null,
  net_amount numeric,
  paid_amount numeric,
  status text not null,
  tenant_id uuid not null
);
insert into public.knowledge_semantic_customers(id,segment,tenant_id) values
  ('00000000-0000-4000-8000-000000006780','enterprise','00000000-0000-4000-8000-00000000aa11'),
  ('00000000-0000-4000-8000-000000006781','smb','00000000-0000-4000-8000-00000000aa11');
insert into public.knowledge_semantic_orders(
  id,customer_id,created_at,net_amount,paid_amount,status,tenant_id
) values
  ('00000000-0000-4000-8000-000000006782','00000000-0000-4000-8000-000000006780',
   '2026-06-10T00:00:00Z',100,100,'paid','00000000-0000-4000-8000-00000000aa11'),
  ('00000000-0000-4000-8000-000000006783','00000000-0000-4000-8000-000000006780',
   '2026-06-15T00:00:00Z',50,50,'paid','00000000-0000-4000-8000-00000000aa11'),
  ('00000000-0000-4000-8000-000000006784','00000000-0000-4000-8000-000000006781',
   '2026-06-20T00:00:00Z',30,30,'paid','00000000-0000-4000-8000-00000000aa11'),
  ('00000000-0000-4000-8000-000000006785','00000000-0000-4000-8000-000000006781',
   '2026-06-21T00:00:00Z',999,999,'refunded','00000000-0000-4000-8000-00000000aa11');

insert into app_data_agent.workspace_content_blobs (
  app_id,tenant_id,environment,blob_hash,storage_key,byte_size,detected_mime,
  active_reference_count,status,created_at,updated_at
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  'sha256:'||pg_catalog.repeat('1',64),'knowledge-semantic-e2e/net-revenue.md',118,
  'text/markdown',1,'AVAILABLE',pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()
);
insert into app_data_agent.workspace_files (
  app_id,tenant_id,environment,file_id,owner_principal_id,current_revision,
  current_revision_hash,current_status,created_at,updated_at
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  '00000000-0000-4000-8000-000000006792','00000000-0000-4000-8000-000000001001',1,
  'sha256:'||pg_catalog.repeat('2',64),'READY',pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()
);
insert into app_data_agent.workspace_file_revisions (
  app_id,tenant_id,environment,file_id,revision,revision_hash,blob_hash,
  owner_principal_id,visibility,session_id,status,scan_receipt_id,deletion_receipt_id,
  revision_json,created_at
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  '00000000-0000-4000-8000-000000006792',1,'sha256:'||pg_catalog.repeat('2',64),
  'sha256:'||pg_catalog.repeat('1',64),'00000000-0000-4000-8000-000000001001',
  'WORKSPACE',null,'READY',null,null,
  '{"name":"net-revenue.md","mime":"text/markdown"}'::jsonb,pg_catalog.clock_timestamp()
);
insert into app_data_agent.knowledge_embedding_profile_revisions (
  app_id,tenant_id,environment,profile_id,revision,provider,model_id,dimensions,
  status,profile_hash,profile_json,created_at
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  '00000000-0000-4000-8000-000000006790',1,'fixture','deterministic-embedding',2,
  'READY','sha256:'||pg_catalog.repeat('3',64),'{"fixture":true}'::jsonb,
  pg_catalog.clock_timestamp()
);
insert into app_data_agent.knowledge_bases (
  app_id,tenant_id,environment,knowledge_base_id,current_revision,current_revision_hash,
  current_status,updated_at
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  '00000000-0000-4000-8000-000000006791',1,'sha256:'||pg_catalog.repeat('4',64),
  'READY',pg_catalog.clock_timestamp()
);
insert into app_data_agent.knowledge_base_revisions (
  app_id,tenant_id,environment,knowledge_base_id,revision,revision_hash,status,
  profile_id,profile_revision,profile_hash,acl_hash,source_refs_json,revision_json,created_at
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  '00000000-0000-4000-8000-000000006791',1,'sha256:'||pg_catalog.repeat('4',64),'READY',
  '00000000-0000-4000-8000-000000006790',1,'sha256:'||pg_catalog.repeat('3',64),
  'sha256:'||pg_catalog.repeat('5',64),
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'file_id','00000000-0000-4000-8000-000000006792','revision',1,
    'revision_hash','sha256:'||pg_catalog.repeat('2',64)
  )),'{"name":"净收入指标手册","visibility":"WORKSPACE"}'::jsonb,pg_catalog.clock_timestamp()
);
insert into app_data_agent.knowledge_document_revisions (
  app_id,tenant_id,environment,knowledge_base_id,knowledge_base_revision,
  knowledge_base_revision_hash,document_id,revision,source_file_id,source_file_revision,
  source_file_revision_hash,parent_document_id,parent_document_revision,
  parent_canonical_markdown_hash,parser_version,policy_version,canonical_markdown_hash,
  block_manifest_hash,block_count,status,reason_code,revision_hash,revision_json,
  created_by_principal_id,created_at
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  '00000000-0000-4000-8000-000000006791',1,'sha256:'||pg_catalog.repeat('4',64),
  '00000000-0000-4000-8000-000000006793',1,
  '00000000-0000-4000-8000-000000006792',1,'sha256:'||pg_catalog.repeat('2',64),
  null,null,null,'markdown-block-parser@1.0.0','markdown-mvp@1.0.0',
  'sha256:'||pg_catalog.repeat('6',64),'sha256:'||pg_catalog.repeat('7',64),1,
  'READY',null,'sha256:'||pg_catalog.repeat('8',64),
  '{"title":"净收入","source":"net-revenue.md"}'::jsonb,
  '00000000-0000-4000-8000-000000001001',pg_catalog.clock_timestamp()
);
insert into app_data_agent.knowledge_document_blocks (
  app_id,tenant_id,environment,knowledge_base_id,knowledge_base_revision,
  knowledge_base_revision_hash,document_id,document_revision,canonical_markdown_hash,
  block_id,ordinal,block_kind,start_byte,end_byte,start_line,end_line,
  normalized_text_hash,canonical_text,block_hash,block_json
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  '00000000-0000-4000-8000-000000006791',1,'sha256:'||pg_catalog.repeat('4',64),
  '00000000-0000-4000-8000-000000006793',1,'sha256:'||pg_catalog.repeat('6',64),
  '00000000-0000-4000-8000-000000006794',0,'PARAGRAPH',0,78,1,1,
  'sha256:'||pg_catalog.repeat('9',64),
  '净收入 = 已支付订单净额之和，按客户分层统计；退款订单不计入。',
  'sha256:'||pg_catalog.repeat('a',64),
  '{"heading_ancestry":["净收入"],"locator":"L1:B0-78"}'::jsonb
);
insert into app_data_agent.knowledge_evidence_selections (
  app_id,tenant_id,environment,selection_id,knowledge_base_id,knowledge_base_revision,
  knowledge_base_revision_hash,intended_semantic_domain,selected_by_principal_id,
  selected_at,selection_hash,selection_json
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  '00000000-0000-4000-8000-000000006796','00000000-0000-4000-8000-000000006791',1,
  'sha256:'||pg_catalog.repeat('4',64),'knowledge_publish_test',
  '00000000-0000-4000-8000-000000001001',pg_catalog.clock_timestamp(),
  'sha256:'||pg_catalog.repeat('b',64),
  '{"purpose":"生成净收入指标","selected_block_count":1}'::jsonb
);
insert into app_data_agent.knowledge_evidence_selection_blocks (
  app_id,tenant_id,environment,selection_id,ordinal,document_id,document_revision,
  block_id,block_hash
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  '00000000-0000-4000-8000-000000006796',0,
  '00000000-0000-4000-8000-000000006793',1,
  '00000000-0000-4000-8000-000000006794','sha256:'||pg_catalog.repeat('a',64)
);

insert into app_data_agent.datasource_connections (
  app_id,tenant_id,environment,datasource_id,name,datasource_type,file_path,status,
  created_by_principal_id
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  '00000000-0000-4000-8000-000000006750','semantic-self-publish-fixture','sqlite',
  '/tmp/semantic-self-publish-fixture.db','ACTIVE','00000000-0000-4000-8000-000000001001'
);

insert into semantic.semantic_domain_registry (
  app_id,tenant_id,environment,semantic_domain,datasource_id,domain_display_name,
  domain_description,created_by
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  'knowledge_publish_test','00000000-0000-4000-8000-000000006750',
  'Knowledge publish test','Knowledge-backed semantic self-publish fixture',
  '00000000-0000-4000-8000-000000001001'
);

insert into semantic.semantic_authority_fence (
  app_id,tenant_id,environment,last_fence_update_by
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  'knowledge-self-publish-fixture'
) on conflict (app_id,tenant_id,environment) do nothing;

insert into semantic.semantic_candidate (
  app_id,tenant_id,environment,semantic_domain,candidate_id,proposer_principal,
  current_revision_id,candidate_status
) values
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
   'knowledge_publish_test','00000000-0000-4000-8000-000000006751',
   '00000000-0000-4000-8000-000000001001','00000000-0000-4000-8000-000000006752','PUBLISHED'),
  ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
   'knowledge_publish_test','00000000-0000-4000-8000-000000006760',
   '00000000-0000-4000-8000-000000001001','00000000-0000-4000-8000-000000006761','DRAFT');

insert into semantic.semantic_source_revision (
  app_id,tenant_id,environment,semantic_domain,revision_id,revision_number,
  base_release_id,base_release_generation,source_payload,source_digest,author_principal,
  change_description,change_class
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  'knowledge_publish_test','00000000-0000-4000-8000-000000006753',1,null,null,
  pg_catalog.jsonb_build_object('metadata',pg_catalog.jsonb_build_object(
    'graph_version','semantic-graph-source@2','graph_id','00000000-0000-4000-8000-000000006759'
  ),'nodes','[]'::jsonb,'edges','[]'::jsonb),
  'sha256:'||pg_catalog.repeat('1',64),'00000000-0000-4000-8000-000000001001',
  'base release','MAJOR'
);

insert into semantic.semantic_candidate_revision (
  app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id,revision_number,
  source_revision_id,revision_payload,revision_digest,author_principal,change_description,change_class
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  'knowledge_publish_test','00000000-0000-4000-8000-000000006751',
  '00000000-0000-4000-8000-000000006752',1,'00000000-0000-4000-8000-000000006753',
  '{"fixture":"base"}'::jsonb,'sha256:'||pg_catalog.repeat('2',64),
  '00000000-0000-4000-8000-000000001001','base release','MAJOR'
);

insert into semantic.semantic_review_task (
  app_id,tenant_id,environment,semantic_domain,packet_id,packet_kind,approval_mode,
  packet_digest,packet_payload,candidate_id,decision_window_status,review_outcome,
  decision_expires_at,publish_expires_at,quorum_rules_snapshot,veto_rules_snapshot,
  exclusion_set,created_by,closed_at
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  'knowledge_publish_test','00000000-0000-4000-8000-000000006754','CANDIDATE_REVIEW','HUMAN_REVIEW',
  'sha256:'||pg_catalog.repeat('3',64),'{"fixture":"base"}'::jsonb,
  '00000000-0000-4000-8000-000000006751','CLOSED','APPROVED',
  pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()+interval '1 day',
  '{"required_approvals":1}'::jsonb,'{"min_veto_count":1}'::jsonb,'[]'::jsonb,
  '00000000-0000-4000-8000-000000001001',pg_catalog.clock_timestamp()
);

insert into semantic.semantic_publish_attempt (
  app_id,tenant_id,environment,semantic_domain,attempt_id,packet_id,candidate_id,attempt_state,
  approval_mode,compiler_bundle_digest,catalog_fence_epoch,dependency_generation,
  executable_projection_ref,executable_projection_hash,relationship_projection_ref,
  relationship_projection_hash,runtime_restriction_projection_ref,
  runtime_restriction_projection_hash,target_generation,idempotency_digest,committed_release_ref
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  'knowledge_publish_test','00000000-0000-4000-8000-000000006755',
  '00000000-0000-4000-8000-000000006754','00000000-0000-4000-8000-000000006751',
  'COMMITTED','HUMAN_REVIEW','sha256:'||pg_catalog.repeat('4',64),0,1,
  '00000000-0000-4000-8000-000000006756','sha256:'||pg_catalog.repeat('5',64),
  '00000000-0000-4000-8000-000000006757','sha256:'||pg_catalog.repeat('6',64),
  '00000000-0000-4000-8000-000000006758','sha256:'||pg_catalog.repeat('7',64),1,
  'sha256:'||pg_catalog.repeat('8',64),'00000000-0000-4000-8000-000000006759'
);

insert into semantic.semantic_source_release (
  app_id,tenant_id,environment,semantic_domain,release_id,release_generation,attempt_id,packet_id,
  candidate_id,release_digest,compiler_bundle_digest,executable_projection_ref,
  executable_projection_hash,relationship_projection_ref,relationship_projection_hash,
  runtime_restriction_projection_ref,runtime_restriction_projection_hash,profile_child_manifest,
  quorum_snapshot,decision_set_digest,published_by,approval_mode
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  'knowledge_publish_test','00000000-0000-4000-8000-000000006759',1,
  '00000000-0000-4000-8000-000000006755','00000000-0000-4000-8000-000000006754',
  '00000000-0000-4000-8000-000000006751','sha256:'||pg_catalog.repeat('9',64),
  'sha256:'||pg_catalog.repeat('4',64),'00000000-0000-4000-8000-000000006756',
  'sha256:'||pg_catalog.repeat('5',64),'00000000-0000-4000-8000-000000006757',
  'sha256:'||pg_catalog.repeat('6',64),'00000000-0000-4000-8000-000000006758',
  'sha256:'||pg_catalog.repeat('7',64),'{"fixture":"base"}'::jsonb,
  '{"required_approvals":1}'::jsonb,'sha256:'||pg_catalog.repeat('a',64),
  '00000000-0000-4000-8000-000000001001','HUMAN_REVIEW'
);

insert into semantic.semantic_active_pointer (
  app_id,tenant_id,environment,semantic_domain,current_release_id,current_release_generation,
  current_release_digest,pointer_generation,updated_by
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  'knowledge_publish_test','00000000-0000-4000-8000-000000006759',1,
  'sha256:'||pg_catalog.repeat('9',64),1,'00000000-0000-4000-8000-000000001001'
);

insert into semantic.semantic_runtime_activation (
  app_id,tenant_id,environment,semantic_domain,runtime_mode,current_release_id,
  current_release_generation
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  'knowledge_publish_test','PUBLISHED_ONLY','00000000-0000-4000-8000-000000006759',1
);

insert into semantic.semantic_dependency_pointer (
  app_id,tenant_id,environment,semantic_domain,current_catalog_epoch,current_catalog_digest,
  current_compiler_bundle_digest,current_closure_policy_digest,pointer_generation,updated_by
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  'knowledge_publish_test',1,'sha256:'||pg_catalog.repeat('b',64),
  'sha256:'||pg_catalog.repeat('c',64),'sha256:'||pg_catalog.repeat('d',64),1,
  '00000000-0000-4000-8000-000000001001'
);

do $candidate_revision$
declare target_graph jsonb; source_digest text;
begin
  target_graph:=pg_catalog.jsonb_build_object(
    'metadata',pg_catalog.jsonb_build_object(
      'graph_version','semantic-graph-source@2','graph_id','00000000-0000-4000-8000-000000006769'
    ),'nodes','[]'::jsonb,'edges','[]'::jsonb
  );
  source_digest:=platform.canonical_sha256(target_graph);
  insert into semantic.semantic_source_revision (
    app_id,tenant_id,environment,semantic_domain,revision_id,revision_number,
    base_release_id,base_release_generation,source_payload,source_digest,author_principal,
    change_description,change_class
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
    'knowledge_publish_test','00000000-0000-4000-8000-000000006762',2,
    '00000000-0000-4000-8000-000000006759',1,target_graph,source_digest,
    '00000000-0000-4000-8000-000000001001','knowledge-backed metric','MINOR'
  );
  insert into semantic.semantic_candidate_revision (
    app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id,revision_number,
    source_revision_id,revision_payload,revision_digest,author_principal,change_description,change_class
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
    'knowledge_publish_test','00000000-0000-4000-8000-000000006760',
    '00000000-0000-4000-8000-000000006761',1,'00000000-0000-4000-8000-000000006762',
    pg_catalog.jsonb_build_object(
      'source_graph',target_graph,'source_graph_digest',source_digest,
      'base_release_id','00000000-0000-4000-8000-000000006759',
      'evidence_selection_refs',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'selection_id','00000000-0000-4000-8000-000000006796',
        'selection_hash','sha256:'||pg_catalog.repeat('b',64)
      ))
    ),platform.canonical_sha256(pg_catalog.jsonb_build_object('source_graph',target_graph)),
    '00000000-0000-4000-8000-000000001001','knowledge-backed metric','MINOR'
  );
  insert into semantic.semantic_authoring_run (
    app_id,tenant_id,environment,semantic_domain,authoring_run_id,candidate_id,graph_id,
    base_release_id,base_release_generation,principal_id,policy_version,status,working_revision,
    graph_digest,writer_fence,current_turn,pending_request_digest,used_tool_calls,max_turns,
    max_tool_calls,validation_receipt_digest,clarification,working_graph,checkpoint,event_sequence,
    idempotency_key,input_digest,materialized_source_revision_id,
    materialized_candidate_revision_id,failure_code
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
    'knowledge_publish_test','00000000-0000-4000-8000-000000006763',
    '00000000-0000-4000-8000-000000006760','00000000-0000-4000-8000-000000006769',
    '00000000-0000-4000-8000-000000006759',1,
    '00000000-0000-4000-8000-000000001001','semantic-authoring-policy@1.0.0',
    'READY_FOR_REVIEW',1,source_digest,1,0,null,0,8,64,
    'sha256:'||pg_catalog.repeat('f',64),null,target_graph,'{}'::jsonb,0,
    'knowledge-semantic-restore-fixture','sha256:'||pg_catalog.repeat('e',64),
    '00000000-0000-4000-8000-000000006762','00000000-0000-4000-8000-000000006761',null
  );
  insert into semantic.semantic_candidate_revision_save_idempotency (
    app_id,tenant_id,environment,semantic_domain,principal_id,idempotency_key,command_hash,
    candidate_id,source_revision_id,candidate_revision_id,revision_number,result_json
  ) values (
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
    'knowledge_publish_test','00000000-0000-4000-8000-000000001001',
    '00000000-0000-4000-8000-000000006764','sha256:'||pg_catalog.repeat('d',64),
    '00000000-0000-4000-8000-000000006760','00000000-0000-4000-8000-000000006762',
    '00000000-0000-4000-8000-000000006761',1,
    pg_catalog.jsonb_build_object(
      'schema_version','semantic-candidate-revision-save-result@1.0.0',
      'disposition','CREATED','candidate_id','00000000-0000-4000-8000-000000006760',
      'source_revision_id','00000000-0000-4000-8000-000000006762',
      'candidate_revision_id','00000000-0000-4000-8000-000000006761',
      'revision_number',1,'final_graph_digest',source_digest,
      'validation_receipt_digest','sha256:'||pg_catalog.repeat('f',64),
      'saved_at','2026-08-22T00:00:00.000Z'
    )
  );
end
$candidate_revision$;

set local role data_agent_backend;
select * from platform.revalidate_backend_authority(
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '00000000-0000-4000-8000-00000000aa11'::uuid,'test',
  '00000000-0000-4000-8000-00000000de01'::uuid,
  '00000000-0000-4000-8000-000000001001'::uuid,'owner',1,1,true
);
select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-00000000aa11',true);
select pg_catalog.set_config('data_agent.environment','test',true);
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-000000001001',true);
select pg_catalog.set_config('data_agent.role','owner',true);
select pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',true);
select pg_catalog.set_config('app.semantic_domain','knowledge_publish_test',true);

do $restore_saved_revision$
declare restored jsonb;
begin
  restored:=semantic.get_saved_semantic_candidate_revision(
    '00000000-0000-4000-8000-00000000da01'::uuid,
    '00000000-0000-4000-8000-00000000aa11'::uuid,'test',
    '00000000-0000-4000-8000-000000001001'::uuid,'knowledge_publish_test',
    '00000000-0000-4000-8000-000000006763'::uuid
  );
  if restored->>'candidate_revision_id'<>'00000000-0000-4000-8000-000000006761'
    or restored->>'source_revision_id'<>'00000000-0000-4000-8000-000000006762'
    or (restored->>'revision_number')::integer<>1
  then raise exception using errcode='P0001',message='SEMANTIC_SAVED_REVISION_RESTORE_FAILED'; end if;
end
$restore_saved_revision$;

do $publish$
declare target_graph jsonb; source_digest text; compiler_digest text; graph_projection jsonb;
  executable_projection jsonb; relationship_projection jsonb; restriction_projection jsonb;
  command_value jsonb; published jsonb; replayed jsonb;
begin
  target_graph:=pg_catalog.jsonb_build_object(
    'metadata',pg_catalog.jsonb_build_object(
      'graph_version','semantic-graph-source@2','graph_id','00000000-0000-4000-8000-000000006769'
    ),'nodes','[]'::jsonb,'edges','[]'::jsonb
  );
  source_digest:=platform.canonical_sha256(target_graph);
  compiler_digest:='sha256:'||pg_catalog.repeat('c',64);
  graph_projection:=pg_catalog.jsonb_build_object(
    'projection_version','semantic-graph-projection@1',
    'graph_id','00000000-0000-4000-8000-000000006769','source_digest',source_digest,
    'registry_digest','sha256:'||pg_catalog.repeat('e',64),
    'compiler_version','semantic-graph-compiler@2.0.0','node_count',0,'edge_count',0,
    'nodes','[]'::jsonb,'edges','[]'::jsonb
  );
  executable_projection:=pg_catalog.jsonb_build_object(
    'sourceDigest',compiler_digest,'metrics',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'metric_id','metric-paid-gmv','name','支付 GMV','aliases',pg_catalog.jsonb_build_array('GMV'),
        'column_id','orders.paid_amount','dependency_column_ids','[]'::jsonb,
        'formula',pg_catalog.jsonb_build_object('kind','SUM','column','orders.paid_amount')
      ),pg_catalog.jsonb_build_object(
        'metric_id','metric.net_revenue','name','净收入',
        'aliases',pg_catalog.jsonb_build_array('收入','Net Revenue'),
        'column_id','orders.net_amount','dependency_column_ids','[]'::jsonb,
        'formula',pg_catalog.jsonb_build_object('kind','SUM','column','orders.net_amount')
      )
    ),'dimensions','[]'::jsonb
  );
  relationship_projection:=pg_catalog.jsonb_build_object(
    'sourceDigest',compiler_digest,'relationships','[]'::jsonb
  );
  restriction_projection:=pg_catalog.jsonb_build_object(
    'sourceDigest',compiler_digest,'restrictions','[]'::jsonb
  );
  command_value:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-candidate-self-publish-command@1.0.0',
    'command_id','00000000-0000-4000-8000-000000006768',
    'scope',pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-00000000aa11','environment','test'
    ),'semantic_domain','knowledge_publish_test',
    'principal_id','00000000-0000-4000-8000-000000001001',
    'candidate_id','00000000-0000-4000-8000-000000006760',
    'candidate_revision_id','00000000-0000-4000-8000-000000006761','revision_number',1,
    'source_revision_id','00000000-0000-4000-8000-000000006762',
    'source_graph_digest',source_digest,'base_release_id','00000000-0000-4000-8000-000000006759',
    'graph_projection_id','00000000-0000-4000-8000-000000006763',
    'graph_projection',graph_projection,
    'executable_projection_id','00000000-0000-4000-8000-000000006764',
    'executable_projection_hash',platform.canonical_sha256(executable_projection),
    'executable_projection',executable_projection,
    'relationship_projection_id','00000000-0000-4000-8000-000000006765',
    'relationship_projection_hash',platform.canonical_sha256(relationship_projection),
    'relationship_projection',relationship_projection,
    'runtime_restriction_projection_id','00000000-0000-4000-8000-000000006766',
    'runtime_restriction_projection_hash',platform.canonical_sha256(restriction_projection),
    'runtime_restriction_projection',restriction_projection,
    'compiler_bundle_digest',compiler_digest,'review_reason','创建者审核知识驱动指标',
    'idempotency_key','00000000-0000-4000-8000-000000006767',
    'reviewed_at','2026-08-22T00:00:00.000Z'
  );
  command_value:=command_value||pg_catalog.jsonb_build_object(
    'command_hash',platform.canonical_sha256(command_value)
  );
  published:=semantic.self_review_and_publish_semantic_candidate(command_value);
  replayed:=semantic.self_review_and_publish_semantic_candidate(command_value);
  if published->>'disposition'<>'PUBLISHED' or replayed->>'disposition'<>'REPLAYED'
    or published->>'release_id'<>replayed->>'release_id'
  then raise exception 'SEMANTIC_SELF_PUBLISH_BEHAVIOR_ASSERTION_FAILED'; end if;
end
$publish$;

reset role;

do $published_authority$
declare release_id_value uuid;
begin
  select pointer.current_release_id into strict release_id_value
  from semantic.semantic_active_pointer pointer
  where pointer.app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and pointer.tenant_id='00000000-0000-4000-8000-00000000aa11'::uuid
    and pointer.environment='test' and pointer.semantic_domain='knowledge_publish_test'
    and pointer.current_release_generation=2;
  if not exists (
    select 1 from semantic.semantic_active_pointer pointer
    where pointer.app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and pointer.tenant_id='00000000-0000-4000-8000-00000000aa11'::uuid
      and pointer.environment='test' and pointer.semantic_domain='knowledge_publish_test'
      and pointer.current_release_id=release_id_value and pointer.current_release_generation=2
  ) or not exists (
    select 1 from app_data_agent.audit_log audit
    where audit.app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and audit.tenant_id='00000000-0000-4000-8000-00000000aa11'::uuid
      and audit.environment='test' and audit.action='SEMANTIC_CANDIDATE_SELF_REVIEW_APPROVED'
  ) or not exists (
    select 1 from app_data_agent.audit_log audit
    where audit.app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and audit.tenant_id='00000000-0000-4000-8000-00000000aa11'::uuid
      and audit.environment='test' and audit.action='SEMANTIC_RELEASE_PUBLISHED'
  ) or not exists (
    select 1 from app_data_agent.knowledge_semantic_usage_references usage
    where usage.app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and usage.tenant_id='00000000-0000-4000-8000-00000000aa11'::uuid
      and usage.environment='test'
      and usage.selection_id='00000000-0000-4000-8000-000000006796'::uuid
      and usage.selection_hash='sha256:'||pg_catalog.repeat('b',64)
      and usage.usage_kind='PUBLISHED_SEMANTIC_OBJECT'
      and usage.subject_id=release_id_value
  ) then raise exception 'SEMANTIC_SELF_PUBLISH_AUTHORITY_ASSERTION_FAILED'; end if;
  if app_data_agent.resolved_context_metric_projection(
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
    'knowledge_publish_test',release_id_value
  )#>>'{0,metric_id}'<>'metric-paid-gmv'
  then raise exception 'SEMANTIC_SELF_PUBLISH_TEXT2SQL_BRIDGE_ASSERTION_FAILED'; end if;
end
$published_authority$;

\if :{?KNOWLEDGE_SEMANTIC_KEEP_PUBLISHED}
commit;
\else

insert into semantic.semantic_review_task (
  app_id,tenant_id,environment,semantic_domain,packet_id,packet_kind,approval_mode,
  packet_digest,packet_payload,decision_window_status,review_outcome,
  decision_expires_at,publish_expires_at,quorum_rules_snapshot,veto_rules_snapshot,
  exclusion_set,created_by,closed_at
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
  'knowledge_publish_test','00000000-0000-4000-8000-00000000676a','ROLLBACK_REVIEW','HUMAN_REVIEW',
  'sha256:'||pg_catalog.repeat('f',64),'{"fixture":"rollback"}'::jsonb,'CLOSED','APPROVED',
  pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()+interval '1 day',
  '{"required_approvals":1}'::jsonb,'{"min_veto_count":1}'::jsonb,'[]'::jsonb,
  '00000000-0000-4000-8000-000000001001',pg_catalog.clock_timestamp()
);

insert into semantic.semantic_rollback_authorization (
  app_id,tenant_id,environment,semantic_domain,authorization_id,packet_id,
  from_release_id,from_release_generation,to_release_id,to_release_generation,
  current_release_id,current_release_generation,authorization_digest,decision_set_digest,
  nonce,expires_at
)
select pointer.app_id,pointer.tenant_id,pointer.environment,pointer.semantic_domain,
  '00000000-0000-4000-8000-00000000676c','00000000-0000-4000-8000-00000000676a',
  pointer.current_release_id,pointer.current_release_generation,
  '00000000-0000-4000-8000-000000006759',1,
  pointer.current_release_id,pointer.current_release_generation,
  'sha256:'||pg_catalog.repeat('0',64),'sha256:'||pg_catalog.repeat('a',64),
  '00000000-0000-4000-8000-00000000676b',pg_catalog.clock_timestamp()+interval '1 day'
from semantic.semantic_active_pointer pointer
where pointer.app_id='00000000-0000-4000-8000-00000000da01'::uuid
  and pointer.tenant_id='00000000-0000-4000-8000-00000000aa11'::uuid
  and pointer.environment='test' and pointer.semantic_domain='knowledge_publish_test'
  and pointer.current_release_generation=2;

set local role data_agent_backend;

do $rollback_behavior$
declare rollback_result jsonb;
begin
  rollback_result:=semantic.human_execute_rollback(pg_catalog.jsonb_build_object(
    'schema_version','human-execute-rollback@1.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-00000000aa11',
      'workspace_id','00000000-0000-4000-8000-00000000aa11','environment','test'
    ),'semantic_domain','knowledge_publish_test',
    'authorization_id','00000000-0000-4000-8000-00000000676c',
    'nonce','00000000-0000-4000-8000-00000000676b',
    'rollback_reason','验证 exact Release 回滚'
  ));
  if (rollback_result->>'from_release_generation')::bigint<>2
    or (rollback_result->>'to_release_generation')::bigint<>1
  then raise exception 'SEMANTIC_ROLLBACK_BEHAVIOR_ASSERTION_FAILED'; end if;
end
$rollback_behavior$;

reset role;

do $rollback_authority$
begin
  if not exists (
    select 1 from semantic.semantic_active_pointer pointer
    where pointer.app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and pointer.tenant_id='00000000-0000-4000-8000-00000000aa11'::uuid
      and pointer.environment='test' and pointer.semantic_domain='knowledge_publish_test'
      and pointer.current_release_id='00000000-0000-4000-8000-000000006759'::uuid
      and pointer.current_release_generation=1 and pointer.pointer_generation=3
  ) or not exists (
    select 1 from semantic.semantic_runtime_activation activation
    where activation.app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and activation.tenant_id='00000000-0000-4000-8000-00000000aa11'::uuid
      and activation.environment='test' and activation.semantic_domain='knowledge_publish_test'
      and activation.current_release_id='00000000-0000-4000-8000-000000006759'::uuid
      and activation.current_release_generation=1
  ) or not exists (
    select 1 from semantic.semantic_rollback_receipt receipt
    where receipt.app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and receipt.tenant_id='00000000-0000-4000-8000-00000000aa11'::uuid
      and receipt.environment='test' and receipt.semantic_domain='knowledge_publish_test'
      and receipt.authorization_id='00000000-0000-4000-8000-00000000676c'::uuid
      and receipt.from_release_generation=2 and receipt.to_release_generation=1
  ) or pg_catalog.jsonb_array_length(app_data_agent.resolved_context_metric_projection(
    '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-00000000aa11','test',
    'knowledge_publish_test','00000000-0000-4000-8000-000000006759'
  ))<>0 then raise exception 'SEMANTIC_EXACT_RELEASE_ROLLBACK_AUTHORITY_ASSERTION_FAILED'; end if;
end
$rollback_authority$;

rollback;

\endif

select 'KNOWLEDGE_SEMANTIC_RELEASE_ASSERTIONS_PASSED' as result;
