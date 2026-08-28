\set ON_ERROR_STOP on

create or replace function pg_temp.successor_hash(document jsonb)
returns text language sql immutable security definer set search_path='' as $function$
  select app_data_agent.u2_canonical_sha256(document)
$function$;

create or replace function pg_temp.setup_semantic_successor_base()
returns void language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare
  app_id constant uuid:='00000000-0000-4000-8000-00000000da01';
  tenant_id constant uuid:='00000000-0000-4000-8000-00000000aa83';
  principal_id constant uuid:='00000000-0000-4000-8000-000000001083';
  predecessor_release_id constant uuid:='00000000-0000-4000-8000-000000007831';
  predecessor_release_digest constant text:=
    'sha256:1111111111111111111111111111111111111111111111111111111111111111';
  digest_a constant text:=
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  digest_b constant text:=
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  digest_c constant text:=
    'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
  defaults_json jsonb;
  defaults_document jsonb;
  defaults_hash text;
  e3_document jsonb;
  e3_hash text;
  now_at timestamptz:=pg_catalog.clock_timestamp();
begin
  insert into app_data_agent.workspaces(
    app_id,workspace_id,environment,slug,display_name)
  values(app_id,tenant_id,'test','falcon24-successor-e4',
    'Falcon24 semantic successor E4 fixture');
  insert into app_data_agent.memberships(
    app_id,tenant_id,environment,principal_id,membership_role)
  values(app_id,tenant_id,'test',principal_id,'owner');

  insert into semantic.semantic_domain_registry(
    app_id,tenant_id,environment,semantic_domain,datasource_id,
    domain_display_name,domain_version,is_active,created_by)
  values(app_id,tenant_id,'test','falcon24_successor',
    '00000000-0000-4000-8000-00000000d083','Falcon24 successor',1,true,
    principal_id::text);

  insert into semantic.semantic_source_revision(
    app_id,tenant_id,environment,semantic_domain,revision_id,revision_number,
    base_release_id,base_release_generation,source_payload,source_digest,
    author_principal,change_description,change_class)
  values(app_id,tenant_id,'test','falcon24_successor',
    '00000000-0000-4000-8000-00000000d832',2,predecessor_release_id,1,
    '{"schema_version":"semantic-source@2.0.0"}'::jsonb,digest_b,
    principal_id::text,'generation 2 successor','MAJOR');

  insert into semantic.semantic_candidate(
    app_id,tenant_id,environment,semantic_domain,candidate_id,proposer_principal,
    current_revision_id,candidate_status)
  values
    (app_id,tenant_id,'test','falcon24_successor',
      '00000000-0000-4000-8000-00000000c831',principal_id::text,
      '00000000-0000-4000-8000-00000000d831','PUBLISHED'),
    (app_id,tenant_id,'test','falcon24_successor',
      '00000000-0000-4000-8000-00000000c832',principal_id::text,
      '00000000-0000-4000-8000-00000000d832','PUBLISHING');

  insert into semantic.semantic_candidate_revision(
    app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id,
    revision_number,source_revision_id,revision_payload,revision_digest,
    author_principal,change_description,change_class)
  values(app_id,tenant_id,'test','falcon24_successor',
    '00000000-0000-4000-8000-00000000c832',
    '00000000-0000-4000-8000-00000000d832',2,
    '00000000-0000-4000-8000-00000000d832',
    '{"schema_version":"semantic-candidate-revision@test"}'::jsonb,digest_b,
    principal_id::text,'generation 2 successor','MAJOR');

  insert into semantic.semantic_review_task(
    app_id,tenant_id,environment,semantic_domain,packet_id,packet_kind,
    packet_digest,packet_payload,candidate_id,decision_window_status,review_outcome,
    decision_expires_at,publish_expires_at,quorum_rules_snapshot,veto_rules_snapshot,
    exclusion_set,created_by,closed_at,approval_mode)
  values
    (app_id,tenant_id,'test','falcon24_successor',
      '00000000-0000-4000-8000-00000000b831','CANDIDATE_REVIEW',digest_a,'{}',
      '00000000-0000-4000-8000-00000000c831','CLOSED','APPROVED',
      now_at+interval '1 day',now_at+interval '1 day','{}','{}','[]',
      principal_id::text,now_at,'HUMAN_REVIEW'),
    (app_id,tenant_id,'test','falcon24_successor',
      '00000000-0000-4000-8000-00000000b832','CANDIDATE_REVIEW',digest_b,'{}',
      '00000000-0000-4000-8000-00000000c832','CLOSED','APPROVED',
      now_at+interval '1 day',now_at+interval '1 day','{}','{}','[]',
      principal_id::text,now_at,'HUMAN_REVIEW');

  insert into semantic.semantic_publish_attempt(
    app_id,tenant_id,environment,semantic_domain,attempt_id,packet_id,candidate_id,
    attempt_state,compiler_bundle_digest,catalog_fence_epoch,dependency_generation,
    executable_projection_ref,executable_projection_hash,relationship_projection_ref,
    relationship_projection_hash,runtime_restriction_projection_ref,
    runtime_restriction_projection_hash,target_generation,idempotency_digest,
    committed_release_ref,approval_mode)
  values
    (app_id,tenant_id,'test','falcon24_successor',
      '00000000-0000-4000-8000-00000000a831',
      '00000000-0000-4000-8000-00000000b831',
      '00000000-0000-4000-8000-00000000c831','COMMITTED',digest_a,1,1,
      '00000000-0000-4000-8000-00000000e831',digest_a,
      '00000000-0000-4000-8000-00000000e832',digest_b,
      '00000000-0000-4000-8000-00000000e833',digest_c,1,digest_a,
      predecessor_release_id,'HUMAN_REVIEW'),
    (app_id,tenant_id,'test','falcon24_successor',
      '00000000-0000-4000-8000-00000000a832',
      '00000000-0000-4000-8000-00000000b832',
      '00000000-0000-4000-8000-00000000c832','PREPARED',digest_c,1,1,
      null,null,null,null,null,null,2,digest_b,null,'HUMAN_REVIEW');

  insert into semantic.semantic_source_release(
    app_id,tenant_id,environment,semantic_domain,release_id,release_generation,
    attempt_id,packet_id,candidate_id,release_digest,compiler_bundle_digest,
    executable_projection_ref,executable_projection_hash,relationship_projection_ref,
    relationship_projection_hash,runtime_restriction_projection_ref,
    runtime_restriction_projection_hash,quorum_snapshot,decision_set_digest,
    published_by,approval_mode)
  values(app_id,tenant_id,'test','falcon24_successor',predecessor_release_id,1,
    '00000000-0000-4000-8000-00000000a831',
    '00000000-0000-4000-8000-00000000b831',
    '00000000-0000-4000-8000-00000000c831',predecessor_release_digest,digest_a,
    '00000000-0000-4000-8000-00000000e831',digest_a,
    '00000000-0000-4000-8000-00000000e832',digest_b,
    '00000000-0000-4000-8000-00000000e833',digest_c,'{}',digest_a,
    principal_id::text,'HUMAN_REVIEW');

  insert into semantic.semantic_dependency_pointer(
    app_id,tenant_id,environment,semantic_domain,current_catalog_epoch,
    current_catalog_digest,current_compiler_bundle_digest,current_closure_policy_digest,
    pointer_generation,updated_by)
  values(app_id,tenant_id,'test','falcon24_successor',1,digest_a,digest_c,digest_b,1,
    principal_id::text);
  insert into semantic.semantic_active_pointer(
    app_id,tenant_id,environment,semantic_domain,current_release_id,
    current_release_generation,current_release_digest,pointer_generation,updated_by)
  values(app_id,tenant_id,'test','falcon24_successor',predecessor_release_id,1,
    predecessor_release_digest,1,principal_id::text);
  insert into semantic.semantic_runtime_activation(
    app_id,tenant_id,environment,semantic_domain,activation_generation,
    current_release_id,current_release_generation,last_governance_readiness_receipt_digest)
  values(app_id,tenant_id,'test','falcon24_successor',1,predecessor_release_id,1,digest_a);

  defaults_json:=pg_catalog.jsonb_build_object(
    'semantic_release',pg_catalog.jsonb_build_object(
      'resource_id',predecessor_release_id,'resource_revision',1,
      'resource_hash',predecessor_release_digest));
  defaults_document:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-defaults-revision@1.0.0','defaults',defaults_json);
  defaults_hash:=pg_temp.successor_hash(defaults_document);
  insert into app_data_agent.workspace_run_default_revisions(
    app_id,tenant_id,environment,defaults_id,defaults_revision,revision_id,principal_id,
    idempotency_key,request_hash,defaults_json,revision_document,defaults_hash,
    membership_version,user_authz_epoch,workspace_lifecycle_version,app_epoch)
  values(app_id,tenant_id,'test','00000000-0000-4000-8000-00000000f831',1,
    '00000000-0000-4000-8000-00000000f832',principal_id,
    'successor-e4:defaults:1',digest_a,defaults_json,defaults_document,defaults_hash,1,1,1,1);
  insert into app_data_agent.workspace_run_defaults(
    app_id,tenant_id,environment,defaults_id,defaults_revision,revision_id,defaults_hash,
    updated_by_principal_id)
  values(app_id,tenant_id,'test','00000000-0000-4000-8000-00000000f831',1,
    '00000000-0000-4000-8000-00000000f832',defaults_hash,principal_id);

  insert into app_data_agent.falcon24_authority_staging_sessions(
    app_id,tenant_id,environment,staging_id,retained_assets_hash,status,created_by,
    created_at,updated_at,authority_epoch)
  values(app_id,tenant_id,'test','00000000-0000-4000-8000-000000007133',digest_a,
    'CONSUMED',principal_id,now_at,now_at,'E3');
  e3_document:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-authority-baseline@2.0.0',
    'baseline_id','00000000-0000-4000-8000-000000007233','authority_epoch','E3',
    'staging_receipts','{}'::jsonb,'production_isolation_proven',false,
    'production_gate','HOLD');
  e3_hash:=pg_temp.successor_hash(e3_document);
  e3_document:=e3_document||pg_catalog.jsonb_build_object('baseline_hash',e3_hash);
  insert into app_data_agent.falcon24_authority_baselines(
    app_id,tenant_id,environment,baseline_id,authority_epoch,staging_id,baseline_hash,
    baseline_document,source_commit,retained_assets_hash,web_build_hash,
    production_isolation_proven,production_gate,status,created_by,created_at)
  values(app_id,tenant_id,'test','00000000-0000-4000-8000-000000007233','E3',
    '00000000-0000-4000-8000-000000007133',e3_hash,e3_document,
    pg_catalog.repeat('3',40),digest_a,digest_b,false,'HOLD','STAGED',principal_id,now_at);
  insert into app_data_agent.falcon24_authority_activation_attempts(
    app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash,status,
    created_by,created_at,decided_at,authority_epoch)
  values(app_id,tenant_id,'test','00000000-0000-4000-8000-000000007333',
    '00000000-0000-4000-8000-000000007233',e3_hash,'ACTIVATED',principal_id,
    now_at,now_at,'E3');
  update app_data_agent.falcon24_authority_baselines baseline set
    status='ACTIVE',activation_attempt_id='00000000-0000-4000-8000-000000007333',
    activated_at=now_at
  where baseline.app_id=app_id and baseline.tenant_id=tenant_id
    and baseline.environment='test'
    and baseline.baseline_id='00000000-0000-4000-8000-000000007233';
  insert into app_data_agent.falcon24_current_authority_epoch(
    app_id,tenant_id,environment,authority_epoch,baseline_id,baseline_hash,
    activation_attempt_id,activated_at)
  values(app_id,tenant_id,'test','E3','00000000-0000-4000-8000-000000007233',
    e3_hash,'00000000-0000-4000-8000-000000007333',now_at);
end
$function$;

create or replace function pg_temp.semantic_successor_stage_command()
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare
  digest_a constant text:=
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  digest_b constant text:=
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  digest_c constant text:=
    'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
  executable_payload jsonb:='{"schema_version":"semantic-executable-projection@2.0.0","entities":[]}'::jsonb;
  relationship_payload jsonb:='{"schema_version":"semantic-relationship-projection@2.0.0","relationships":[]}'::jsonb;
  restriction_payload jsonb:='{"schema_version":"semantic-runtime-restriction-projection@2.0.0","restrictions":[]}'::jsonb;
  graph_payload jsonb;
  executable_digest text;
  relationship_digest text;
  restriction_digest text;
  graph_digest text;
  projection_refs jsonb;
  candidate_release jsonb;
  release_digest text;
  stage jsonb;
  stage_digest text;
  validation_receipt jsonb;
  validation_hash text;
  command jsonb;
begin
  graph_payload:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-graph-projection@1.0.0',
    'graph_id','00000000-0000-4000-8000-00000000e845',
    'source_digest',digest_b,'registry_digest',digest_a,
    'compiler_version','falcon24-test@1','node_count',0,'edge_count',0,
    'nodes','[]'::jsonb,'edges','[]'::jsonb);
  executable_digest:=pg_temp.successor_hash(executable_payload);
  relationship_digest:=pg_temp.successor_hash(relationship_payload);
  restriction_digest:=pg_temp.successor_hash(restriction_payload);
  graph_digest:=pg_temp.successor_hash(graph_payload);
  projection_refs:=pg_catalog.jsonb_build_object(
    'executable',pg_catalog.jsonb_build_object(
      'projection_id','00000000-0000-4000-8000-00000000e841',
      'projection_digest',executable_digest),
    'relationship',pg_catalog.jsonb_build_object(
      'projection_id','00000000-0000-4000-8000-00000000e842',
      'projection_digest',relationship_digest),
    'runtime_restriction',pg_catalog.jsonb_build_object(
      'projection_id','00000000-0000-4000-8000-00000000e843',
      'projection_digest',restriction_digest),
    'graph',pg_catalog.jsonb_build_object(
      'projection_id','00000000-0000-4000-8000-00000000e844',
      'projection_digest',graph_digest));
  release_digest:=pg_temp.successor_hash(pg_catalog.jsonb_build_object(
    'change_set_hash',digest_b,'generation',2,'compiler_bundle_digest',digest_c,
    'executable_projection_digest',executable_digest,
    'relationship_projection_digest',relationship_digest,
    'restriction_projection_digest',restriction_digest,
    'graph_projection_digest',graph_digest));
  candidate_release:=pg_catalog.jsonb_build_object(
    'release_id','00000000-0000-4000-8000-000000007832',
    'generation',2,'release_digest',release_digest,
    'datasource_id','00000000-0000-4000-8000-00000000d083');
  stage:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-successor-stage@1.0.0',
    'stage_id','00000000-0000-4000-8000-000000008832',
    'scope',pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-00000000aa83',
      'environment','test','semantic_domain','falcon24_successor'),
    'predecessor_release',pg_catalog.jsonb_build_object(
      'release_id','00000000-0000-4000-8000-000000007831','generation',1,
      'release_digest',
        'sha256:1111111111111111111111111111111111111111111111111111111111111111'),
    'expected_pointer_version',1,'target_generation',2,
    'change_set_ref',pg_catalog.jsonb_build_object(
      'change_set_id','00000000-0000-4000-8000-00000000c832','change_set_hash',digest_b),
    'review_ref',pg_catalog.jsonb_build_object(
      'review_id','00000000-0000-4000-8000-00000000b832','review_hash',digest_a),
    'source_snapshot_ref',pg_catalog.jsonb_build_object(
      'snapshot_id','00000000-0000-4000-8000-00000000d832',
      'snapshot_revision',2,'snapshot_hash',digest_b),
    'compiler_bundle_ref',pg_catalog.jsonb_build_object(
      'compiler_version','falcon24-test@1','compiler_bundle_hash',digest_c),
    'candidate_release',candidate_release,'projection_refs',projection_refs,
    'status','STAGED','stage_digest',digest_a);
  stage_digest:=pg_temp.successor_hash(pg_catalog.jsonb_build_object(
    'hash_domain','semantic-successor-stage-digest@1.0.0','scope',stage->'scope',
    'predecessor_release',stage->'predecessor_release',
    'expected_pointer_version',stage->'expected_pointer_version',
    'change_set_ref',stage->'change_set_ref','review_ref',stage->'review_ref',
    'source_snapshot_ref',stage->'source_snapshot_ref',
    'compiler_bundle_ref',stage->'compiler_bundle_ref',
    'candidate_release',candidate_release,'projection_refs',projection_refs));
  stage:=pg_catalog.jsonb_set(stage,'{stage_digest}',pg_catalog.to_jsonb(stage_digest));
  validation_receipt:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-runtime-closure-validation-receipt@1.0.0',
    'receipt_id','00000000-0000-4000-8000-000000009841',
    'stage_id',stage->>'stage_id','stage_digest',stage_digest,
    'candidate_release',candidate_release,'projection_refs',projection_refs,
    'validator_identity',pg_catalog.jsonb_build_object(
      'validator_version','semantic-runtime-closure-validator@test',
      'validator_hash','sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
    'outcome','PASS','reason_codes','[]'::jsonb);
  validation_hash:=pg_temp.successor_hash(pg_catalog.jsonb_build_object(
    'hash_domain','semantic-runtime-closure-validation-receipt@1.0.0',
    'receipt',validation_receipt));
  validation_receipt:=validation_receipt||pg_catalog.jsonb_build_object(
    'validation_receipt_hash',validation_hash);
  command:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-successor-stage-record@1.0.0',
    'command_id','00000000-0000-4000-8000-00000000c842',
    'idempotency_key','semantic-successor-e4-stage',
    'idempotency_digest',digest_a,
    'binding_impact_hashes','[]'::jsonb,'stage',stage,
    'projections',pg_catalog.jsonb_build_object(
      'executable',pg_catalog.jsonb_build_object(
        'projection_kind','EXECUTABLE','projection_id',
          projection_refs#>>'{executable,projection_id}',
        'projection_digest',executable_digest,'projection_payload',executable_payload),
      'relationship',pg_catalog.jsonb_build_object(
        'projection_kind','RELATIONSHIP','projection_id',
          projection_refs#>>'{relationship,projection_id}',
        'projection_digest',relationship_digest,'projection_payload',relationship_payload),
      'runtime_restriction',pg_catalog.jsonb_build_object(
        'projection_kind','RUNTIME_RESTRICTION','projection_id',
          projection_refs#>>'{runtime_restriction,projection_id}',
        'projection_digest',restriction_digest,'projection_payload',restriction_payload),
      'graph',pg_catalog.jsonb_build_object(
        'projection_kind','GRAPH','projection_id',projection_refs#>>'{graph,projection_id}',
        'projection_digest',graph_digest,'projection_payload',graph_payload)),
    'validation_receipt',validation_receipt,
    'authority_ids',pg_catalog.jsonb_build_object(
      'source_revision_id','00000000-0000-4000-8000-00000000d832',
      'candidate_revision_id','00000000-0000-4000-8000-00000000d832',
      'publish_attempt_id','00000000-0000-4000-8000-00000000a832',
      'review_decision_id','00000000-0000-4000-8000-00000000d842',
      'outbox_event_id','00000000-0000-4000-8000-00000000e849'),
    'command_hash',digest_a);
  command:=pg_catalog.jsonb_set(command,'{idempotency_digest}',pg_catalog.to_jsonb(
    pg_temp.successor_hash(pg_catalog.jsonb_build_object(
      'hash_domain','semantic-successor-stage-record-idempotency@1.0.0',
      'command',command-array['idempotency_digest','command_hash']))));
  return pg_catalog.jsonb_set(command,'{command_hash}',
    pg_catalog.to_jsonb(pg_temp.successor_hash(command-'command_hash')));
end
$function$;

create or replace function pg_temp.semantic_successor_smoke_command()
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare
  stage_command jsonb:=pg_temp.semantic_successor_stage_command();
  stage jsonb:=stage_command->'stage';
  receipt jsonb;
  command jsonb;
begin
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-runtime-smoke-receipt@1.0.0',
    'receipt_id','00000000-0000-4000-8000-000000009842',
    'stage_id',stage->>'stage_id','stage_digest',stage->>'stage_digest',
    'candidate_release',stage->'candidate_release','projection_refs',stage->'projection_refs',
    'resolved_metric_id','metric.order_revenue',
    'resolved_dimension_id','dimension.order_month',
    'resolved_binding_hash',
      'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    'plan_hash','sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'calendar_timezone','Asia/Shanghai',
    'window_start','2023-11-01T00:00:00.000Z',
    'window_end_exclusive','2024-11-01T00:00:00.000Z',
    'validator_identity',pg_catalog.jsonb_build_object(
      'validator_version','semantic-runtime-closure-validator@test',
      'validator_hash','sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),
    'worker_build_identity',pg_catalog.jsonb_build_object(
      'schema_version','runtime-build-identity@1.0.0','consumer_role','worker',
      'generation_id','sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      'build_id','sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      'built_at','2026-08-28T00:00:00.000Z',
      'git_commit','4444444444444444444444444444444444444444','git_dirty',false),
    'outcome','PASS','failure_code',null);
  receipt:=receipt||pg_catalog.jsonb_build_object(
    'smoke_receipt_hash',pg_temp.successor_hash(pg_catalog.jsonb_build_object(
      'hash_domain','semantic-runtime-smoke-receipt@1.0.0','receipt',receipt)));
  command:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-successor-smoke-commit@1.0.0',
    'idempotency_key','semantic-successor-e4-smoke','stage_id',stage->>'stage_id',
    'expected_stage_digest',stage->>'stage_digest','receipt',receipt,
    'command_hash',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  return pg_catalog.jsonb_set(command,'{command_hash}',
    pg_catalog.to_jsonb(pg_temp.successor_hash(command-'command_hash')));
end
$function$;

create or replace function pg_temp.setup_falcon24_e4_candidate()
returns void language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare
  app_id constant uuid:='00000000-0000-4000-8000-00000000da01';
  tenant_id constant uuid:='00000000-0000-4000-8000-00000000aa83';
  principal_id constant uuid:='00000000-0000-4000-8000-000000001083';
  staging_id constant uuid:='00000000-0000-4000-8000-000000007144';
  baseline_id constant uuid:='00000000-0000-4000-8000-000000007244';
  attempt_id constant uuid:='00000000-0000-4000-8000-000000007344';
  digest_a constant text:=
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  digest_b constant text:=
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  stage semantic.semantic_successor_release_stage%rowtype;
  validation semantic.semantic_successor_stage_receipt%rowtype;
  smoke semantic.semantic_successor_stage_receipt%rowtype;
  component text;
  receipt_document jsonb;
  receipt_hash text;
  receipt_hashes jsonb:='{}'::jsonb;
  receipt_key text;
  baseline_document jsonb;
  baseline_hash text;
  semantic_proof jsonb;
  semantic_proof_hash text;
  now_at timestamptz:=pg_catalog.clock_timestamp();
begin
  select * into strict stage from semantic.semantic_successor_release_stage row
  where row.app_id=app_id and row.tenant_id=tenant_id and row.environment='test'
    and row.semantic_domain='falcon24_successor'
    and row.stage_id='00000000-0000-4000-8000-000000008832';
  select * into strict smoke from semantic.semantic_successor_stage_receipt row
  where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
    and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
    and row.stage_id=stage.stage_id and row.receipt_kind='SMOKE';
  select * into strict validation from semantic.semantic_successor_stage_receipt row
  where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
    and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
    and row.stage_id=stage.stage_id and row.receipt_kind='VALIDATION';
  semantic_proof:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-semantic-release-authority-proof@2.0.0',
    'authority_epoch','E4',
    'predecessor_release',pg_catalog.jsonb_build_object(
      'release_id',stage.predecessor_release_id,
      'generation',stage.predecessor_generation,
      'release_digest',stage.predecessor_release_digest,
      'datasource_id',stage.datasource_id),
    'candidate_release',stage.stage_document->'candidate_release',
    'projections',stage.stage_document->'projection_refs',
    'change_set_ref',stage.stage_document->'change_set_ref',
    'review_ref',stage.stage_document->'review_ref',
    'source_snapshot_ref',stage.stage_document->'source_snapshot_ref',
    'compiler_bundle_ref',stage.stage_document->'compiler_bundle_ref',
    'validation_receipt_ref',pg_catalog.jsonb_build_object(
      'schema_version','semantic-runtime-closure-validation-receipt@1.0.0',
      'receipt_id',validation.receipt_id,
      'validation_receipt_hash',validation.receipt_hash),
    'smoke_receipt_ref',pg_catalog.jsonb_build_object(
      'schema_version','semantic-runtime-smoke-receipt@1.0.0',
      'receipt_id',smoke.receipt_id,'smoke_receipt_hash',smoke.receipt_hash),
    'expected_versions',pg_catalog.jsonb_build_object(
      'semantic_pointer',1,'semantic_runtime',1,'workspace_defaults',1));
  semantic_proof_hash:=pg_temp.successor_hash(pg_catalog.jsonb_build_object(
    'hash_domain','falcon24-semantic-release-authority-proof@2.0.0',
    'proof',semantic_proof));
  insert into app_data_agent.falcon24_authority_staging_sessions(
    app_id,tenant_id,environment,staging_id,retained_assets_hash,status,created_by,
    created_at,updated_at,authority_epoch)
  values(app_id,tenant_id,'test',staging_id,digest_a,'STAGED',principal_id,
    now_at,now_at,'E4');
  foreach component in array array['AGENT_PROFILES','DATASET','LLM_CONFIGURATION',
      'OPERATOR_REGISTRY','SANDBOX_RUNTIME','SEMANTIC_RELEASE']::text[] loop
    receipt_document:=pg_catalog.jsonb_build_object(
      'schema_version','falcon24-staging-receipt@2.0.0','staging_id',staging_id,
      'authority_epoch','E4','component',component,
      'subject_hash',case when component='SEMANTIC_RELEASE'
        then stage.candidate_release_digest else digest_a end,
      'evidence_hash',case when component='SEMANTIC_RELEASE'
        then semantic_proof_hash else digest_b end,
      'production_isolation_proven',false);
    receipt_hash:=pg_temp.successor_hash(receipt_document);
    receipt_document:=receipt_document||pg_catalog.jsonb_build_object(
      'receipt_hash',receipt_hash);
    insert into app_data_agent.falcon24_authority_staging_receipts(
      app_id,tenant_id,environment,staging_id,component,subject_hash,evidence_hash,
      production_isolation_proven,receipt_hash,receipt_document,created_at,authority_epoch)
    values(app_id,tenant_id,'test',staging_id,component,
      receipt_document->>'subject_hash',receipt_document->>'evidence_hash',false,
      receipt_hash,receipt_document,now_at,'E4');
    receipt_key:=case component
      when 'AGENT_PROFILES' then 'agent_profiles'
      when 'DATASET' then 'dataset'
      when 'LLM_CONFIGURATION' then 'llm_configuration'
      when 'OPERATOR_REGISTRY' then 'operator_registry'
      when 'SANDBOX_RUNTIME' then 'sandbox_runtime'
      else 'semantic_release' end;
    receipt_hashes:=receipt_hashes||pg_catalog.jsonb_build_object(receipt_key,receipt_hash);
  end loop;
  baseline_document:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-authority-baseline@2.0.0','baseline_id',baseline_id,
    'authority_epoch','E4','source_commit',pg_catalog.repeat('4',40),
    'retained_assets_hash',digest_a,'web_build_hash',digest_b,
    'staging_receipts',receipt_hashes,'acceptance_contracts','{}'::jsonb,
    'production_isolation_proven',false,'production_gate','HOLD');
  baseline_hash:=pg_temp.successor_hash(baseline_document);
  baseline_document:=baseline_document||pg_catalog.jsonb_build_object(
    'baseline_hash',baseline_hash);
  insert into app_data_agent.falcon24_authority_baselines(
    app_id,tenant_id,environment,baseline_id,authority_epoch,staging_id,baseline_hash,
    baseline_document,source_commit,retained_assets_hash,web_build_hash,
    production_isolation_proven,production_gate,status,created_by,created_at)
  values(app_id,tenant_id,'test',baseline_id,'E4',staging_id,baseline_hash,
    baseline_document,pg_catalog.repeat('4',40),digest_a,digest_b,false,'HOLD',
    'STAGED',principal_id,now_at);
  insert into app_data_agent.falcon24_authority_activation_attempts(
    app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash,status,
    created_by,created_at,authority_epoch)
  values(app_id,tenant_id,'test',attempt_id,baseline_id,baseline_hash,'OPEN',principal_id,
    now_at,'E4');
end
$function$;

create or replace function pg_temp.semantic_successor_activation_command()
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare
  current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  stage semantic.semantic_successor_release_stage%rowtype;
  smoke semantic.semantic_successor_stage_receipt%rowtype;
  baseline app_data_agent.falcon24_authority_baselines%rowtype;
  command jsonb;
begin
  select * into strict current_epoch from app_data_agent.falcon24_current_authority_epoch row
  where row.app_id='00000000-0000-4000-8000-00000000da01'
    and row.tenant_id='00000000-0000-4000-8000-00000000aa83'
    and row.environment='test';
  select * into strict stage from semantic.semantic_successor_release_stage row
  where row.app_id=current_epoch.app_id and row.tenant_id=current_epoch.tenant_id
    and row.environment=current_epoch.environment and row.semantic_domain='falcon24_successor';
  select * into strict smoke from semantic.semantic_successor_stage_receipt row
  where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
    and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
    and row.stage_id=stage.stage_id and row.receipt_kind='SMOKE';
  select * into strict baseline from app_data_agent.falcon24_authority_baselines row
  where row.app_id=current_epoch.app_id and row.tenant_id=current_epoch.tenant_id
    and row.environment=current_epoch.environment and row.authority_epoch='E4';
  command:=pg_catalog.jsonb_build_object(
    'schema_version','combined-falcon24-semantic-activation-command@1.0.0',
    'command_id','00000000-0000-4000-8000-00000000c844',
    'idempotency_key','falcon24-e4-semantic-successor-activation',
    'scope',pg_catalog.jsonb_build_object(
      'app_id',current_epoch.app_id,'tenant_id',current_epoch.tenant_id,
      'environment',current_epoch.environment,'semantic_domain','falcon24_successor'),
    'authority_epoch','E4',
    'expected_current_authority',pg_catalog.jsonb_build_object(
      'schema_version','falcon24-authority-binding@2.0.0',
      'authority_epoch','E3','baseline_id',current_epoch.baseline_id,
      'baseline_hash',current_epoch.baseline_hash,
      'activation_attempt_id',current_epoch.activation_attempt_id),
    'expected_semantic_predecessor',pg_catalog.jsonb_build_object(
      'release_id',stage.predecessor_release_id,'generation',stage.predecessor_generation,
      'release_digest',stage.predecessor_release_digest,
      'datasource_id',stage.datasource_id),
    'stage_ref',pg_catalog.jsonb_build_object(
      'stage_id',stage.stage_id,'stage_digest',stage.stage_digest),
    'smoke_receipt_ref',pg_catalog.jsonb_build_object(
      'schema_version','semantic-runtime-smoke-receipt@1.0.0',
      'receipt_id',smoke.receipt_id,'smoke_receipt_hash',smoke.receipt_hash),
    'baseline_ref',pg_catalog.jsonb_build_object(
      'baseline_id',baseline.baseline_id,'baseline_hash',baseline.baseline_hash),
    'activation_attempt_ref',pg_catalog.jsonb_build_object(
      'activation_attempt_id','00000000-0000-4000-8000-000000007344'),
    'expected_versions',pg_catalog.jsonb_build_object(
      'semantic_pointer',1,'semantic_runtime',1,'workspace_defaults',1),
    'command_hash',
      'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  return pg_catalog.jsonb_set(command,'{command_hash}',pg_catalog.to_jsonb(
    pg_temp.successor_hash(pg_catalog.jsonb_build_object(
      'hash_domain','combined-falcon24-semantic-activation-command@1.0.0',
      'command',command-'command_hash'))));
end
$function$;

create or replace function pg_temp.set_semantic_successor_authority()
returns void language plpgsql volatile security definer set search_path='' as $function$
begin
  perform pg_catalog.set_config(
    'data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
  perform pg_catalog.set_config(
    'data_agent.tenant_id','00000000-0000-4000-8000-00000000aa83',true);
  perform pg_catalog.set_config('data_agent.environment','test',true);
  perform pg_catalog.set_config(
    'data_agent.principal_id','00000000-0000-4000-8000-000000001083',true);
  perform pg_catalog.set_config('data_agent.role','owner',true);
  perform pg_catalog.set_config(
    'data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',true);
  perform pg_catalog.set_config('app.semantic_domain','falcon24_successor',true);
end
$function$;

begin;
set local session_replication_role=replica;
select pg_temp.setup_semantic_successor_base();
set local session_replication_role=origin;
select pg_temp.set_semantic_successor_authority();
set local role data_agent_backend;

do $stage_state_machine$
declare
  command jsonb:=pg_temp.semantic_successor_stage_command();
  replay jsonb;
  loaded jsonb;
  conflict jsonb;
  invalid_receipt jsonb;
  invalid_command jsonb;
begin
  replay:=semantic.record_semantic_successor_stage(command);
  if replay->'stage' is distinct from command->'stage'
  then raise exception 'SEMANTIC_SUCCESSOR_STAGE_NOT_ATOMIC'; end if;
  if semantic.record_semantic_successor_stage(command) is distinct from replay
  then raise exception 'SEMANTIC_SUCCESSOR_STAGE_REPLAY_CHANGED'; end if;
  loaded:=semantic.load_semantic_successor_stage(pg_catalog.jsonb_build_object(
    'schema_version','semantic-successor-stage-load@1.0.0',
    'stage_id',command#>>'{stage,stage_id}',
    'command_hash',pg_temp.successor_hash(pg_catalog.jsonb_build_object(
      'schema_version','semantic-successor-stage-load@1.0.0',
      'stage_id',command#>>'{stage,stage_id}'))));
  if loaded is distinct from replay then raise exception 'SEMANTIC_SUCCESSOR_LOAD_DRIFT'; end if;
  conflict:=pg_catalog.jsonb_set(command,'{binding_impact_hashes}',
    '["sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"]'::jsonb);
  conflict:=pg_catalog.jsonb_set(conflict,'{idempotency_digest}',pg_catalog.to_jsonb(
    pg_temp.successor_hash(pg_catalog.jsonb_build_object(
      'hash_domain','semantic-successor-stage-record-idempotency@1.0.0',
      'command',conflict-array['idempotency_digest','command_hash']))));
  conflict:=pg_catalog.jsonb_set(conflict,'{command_hash}',pg_catalog.to_jsonb(
    pg_temp.successor_hash(conflict-'command_hash')));
  begin
    perform semantic.record_semantic_successor_stage(conflict);
    raise exception 'SEMANTIC_SUCCESSOR_IDEMPOTENCY_CONFLICT_ACCEPTED';
  exception when unique_violation then
    if sqlerrm<>'SEMANTIC_SUCCESSOR_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;
  invalid_receipt:=(command->'validation_receipt')-'validator_identity';
  invalid_receipt:=pg_catalog.jsonb_set(
    invalid_receipt,'{validation_receipt_hash}',pg_catalog.to_jsonb(
      pg_temp.successor_hash(pg_catalog.jsonb_build_object(
        'hash_domain','semantic-runtime-closure-validation-receipt@1.0.0',
        'receipt',invalid_receipt-'validation_receipt_hash'))));
  invalid_command:=pg_catalog.jsonb_set(command,'{validation_receipt}',invalid_receipt);
  invalid_command:=pg_catalog.jsonb_set(
    invalid_command,'{idempotency_digest}',pg_catalog.to_jsonb(
      pg_temp.successor_hash(pg_catalog.jsonb_build_object(
        'hash_domain','semantic-successor-stage-record-idempotency@1.0.0',
        'command',invalid_command-array['idempotency_digest','command_hash']))));
  invalid_command:=pg_catalog.jsonb_set(invalid_command,'{command_hash}',pg_catalog.to_jsonb(
    pg_temp.successor_hash(invalid_command-'command_hash')));
  begin
    perform semantic.record_semantic_successor_stage(invalid_command);
    raise exception 'SEMANTIC_SUCCESSOR_INVALID_VALIDATION_RECEIPT_ACCEPTED';
  exception when invalid_parameter_value then
    if sqlerrm<>'SEMANTIC_RUNTIME_CLOSURE_INVALID' then raise; end if;
  end;
  invalid_command:=pg_catalog.jsonb_set(command,'{stage,target_generation}','"2"'::jsonb);
  invalid_command:=pg_catalog.jsonb_set(
    invalid_command,'{idempotency_digest}',pg_catalog.to_jsonb(
      pg_temp.successor_hash(pg_catalog.jsonb_build_object(
        'hash_domain','semantic-successor-stage-record-idempotency@1.0.0',
        'command',invalid_command-array['idempotency_digest','command_hash']))));
  invalid_command:=pg_catalog.jsonb_set(invalid_command,'{command_hash}',pg_catalog.to_jsonb(
    pg_temp.successor_hash(invalid_command-'command_hash')));
  begin
    perform semantic.record_semantic_successor_stage(invalid_command);
    raise exception 'SEMANTIC_SUCCESSOR_NONCANONICAL_VERSION_ACCEPTED';
  exception when invalid_parameter_value then
    if sqlerrm<>'SEMANTIC_SUCCESSOR_STAGE_RECORD_INVALID' then raise; end if;
  end;
end
$stage_state_machine$;

reset role;
do $stage_storage_and_security$
begin
  if (select pg_catalog.count(*) from semantic.semantic_successor_projection_stage)<>4
    or (select pg_catalog.count(*) from semantic.semantic_successor_stage_receipt
      where receipt_kind='VALIDATION')<>1
  then raise exception 'SEMANTIC_SUCCESSOR_STAGE_NOT_ATOMIC'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend',
      'semantic.semantic_successor_release_stage','SELECT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'semantic.semantic_successor_projection_stage','INSERT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'semantic.semantic_successor_stage_receipt','UPDATE')
  then raise exception 'SEMANTIC_SUCCESSOR_DIRECT_TABLE_BYPASS'; end if;
end
$stage_storage_and_security$;
set local role data_agent_backend;

do $smoke_state_machine$
declare command jsonb:=pg_temp.semantic_successor_smoke_command(); receipt jsonb;
  invalid_receipt jsonb; invalid_command jsonb; fail_receipt jsonb; fail_command jsonb;
  load_command jsonb; loaded_envelope jsonb;
begin
  load_command:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-successor-stage-load@1.0.0',
    'stage_id','00000000-0000-4000-8000-000000008832');
  load_command:=load_command||pg_catalog.jsonb_build_object(
    'command_hash',pg_temp.successor_hash(load_command));
  fail_receipt:=pg_catalog.jsonb_set(command->'receipt','{outcome}','"FAIL"'::jsonb);
  fail_receipt:=pg_catalog.jsonb_set(
    fail_receipt,'{failure_code}','"SEMANTIC_RUNTIME_FORMULA_DEPENDENCY_INVALID"'::jsonb);
  fail_receipt:=pg_catalog.jsonb_set(fail_receipt,'{smoke_receipt_hash}',
    pg_catalog.to_jsonb(pg_temp.successor_hash(pg_catalog.jsonb_build_object(
      'hash_domain','semantic-runtime-smoke-receipt@1.0.0',
      'receipt',fail_receipt-'smoke_receipt_hash'))));
  fail_command:=pg_catalog.jsonb_set(command,'{receipt}',fail_receipt);
  fail_command:=pg_catalog.jsonb_set(fail_command,'{idempotency_key}','"smoke-fail-branch"'::jsonb);
  fail_command:=pg_catalog.jsonb_set(fail_command,'{command_hash}',pg_catalog.to_jsonb(
    pg_temp.successor_hash(fail_command-'command_hash')));
  begin
    receipt:=semantic.commit_semantic_successor_smoke(fail_command);
    loaded_envelope:=semantic.load_semantic_successor_stage(load_command);
    if receipt->>'outcome'<>'FAIL'
      or receipt->>'failure_code'<>'SEMANTIC_RUNTIME_FORMULA_DEPENDENCY_INVALID'
      or loaded_envelope#>>'{stage,status}'<>'REJECTED'
    then raise exception 'SEMANTIC_SUCCESSOR_FAIL_BRANCH_INVALID'; end if;
    raise exception 'SEMANTIC_SUCCESSOR_FAIL_BRANCH_ROLLBACK';
  exception when raise_exception then
    if sqlerrm<>'SEMANTIC_SUCCESSOR_FAIL_BRANCH_ROLLBACK' then raise; end if;
  end;
  invalid_receipt:=(command->'receipt')-'calendar_timezone';
  invalid_receipt:=pg_catalog.jsonb_set(invalid_receipt,'{smoke_receipt_hash}',
    pg_catalog.to_jsonb(pg_temp.successor_hash(pg_catalog.jsonb_build_object(
      'hash_domain','semantic-runtime-smoke-receipt@1.0.0',
      'receipt',invalid_receipt-'smoke_receipt_hash'))));
  invalid_command:=pg_catalog.jsonb_set(command,'{receipt}',invalid_receipt);
  invalid_command:=pg_catalog.jsonb_set(invalid_command,'{command_hash}',pg_catalog.to_jsonb(
    pg_temp.successor_hash(invalid_command-'command_hash')));
  begin
    perform semantic.commit_semantic_successor_smoke(invalid_command);
    raise exception 'SEMANTIC_SUCCESSOR_INVALID_SMOKE_RECEIPT_ACCEPTED';
  exception when serialization_failure then
    if sqlerrm<>'SEMANTIC_RUNTIME_SMOKE_FENCE_MISMATCH' then raise; end if;
  end;
  receipt:=semantic.commit_semantic_successor_smoke(command);
  if receipt->>'outcome'<>'PASS'
    or semantic.commit_semantic_successor_smoke(command) is distinct from receipt
  then raise exception 'SEMANTIC_SUCCESSOR_SMOKE_STATE_INVALID'; end if;
end
$smoke_state_machine$;

reset role;
do $immutable_histories$
begin
  if (select status from semantic.semantic_successor_release_stage
      where tenant_id='00000000-0000-4000-8000-00000000aa83')<>'SMOKE_PASSED'
  then raise exception 'SEMANTIC_SUCCESSOR_SMOKE_STATE_INVALID'; end if;
  begin
    update semantic.semantic_source_release set published_by=published_by
    where release_id='00000000-0000-4000-8000-000000007831';
    raise exception 'SEMANTIC_FORMAL_HISTORY_UPDATE_ACCEPTED';
  exception when sqlstate '55000' then
    if sqlerrm<>'SEMANTIC_FORMAL_HISTORY_IMMUTABLE' then raise; end if;
  end;
  begin
    delete from semantic.semantic_successor_projection_stage
    where stage_id='00000000-0000-4000-8000-000000008832';
    raise exception 'SEMANTIC_SUCCESSOR_PROJECTION_DELETE_ACCEPTED';
  exception when sqlstate '55000' then
    if sqlerrm<>'SEMANTIC_SUCCESSOR_RECEIPT_IMMUTABLE' then raise; end if;
  end;
end
$immutable_histories$;

set local session_replication_role=replica;
select pg_temp.setup_falcon24_e4_candidate();
set local session_replication_role=origin;
select pg_temp.set_semantic_successor_authority();
reset role;
create temporary table semantic_successor_predecessor_snapshot(bytes text not null)
on commit drop;
insert into semantic_successor_predecessor_snapshot
select pg_catalog.md5(pg_catalog.to_jsonb(row)::text)
from semantic.semantic_source_release row
where row.release_id='00000000-0000-4000-8000-000000007831';
insert into semantic.semantic_successor_stage_receipt(
  app_id,tenant_id,environment,semantic_domain,stage_id,receipt_kind,receipt_id,
  receipt_schema_version,operation_idempotency_key,operation_digest,receipt_json,receipt_hash)
values('00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-00000000aa83','test','falcon24_successor',
  '00000000-0000-4000-8000-000000008832','PROMOTION',
  '00000000-0000-4000-8000-00000000c844',
  'combined-falcon24-semantic-activation-receipt@1.0.0','late-conflict',
  'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  '{}','sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
set local role data_agent_backend;
do $late_failure_is_atomic$
declare command jsonb:=pg_temp.semantic_successor_activation_command(); invalid_command jsonb;
begin
  invalid_command:=pg_catalog.jsonb_set(
    command,'{expected_versions,semantic_pointer}','"1"'::jsonb);
  invalid_command:=pg_catalog.jsonb_set(invalid_command,'{command_hash}',pg_catalog.to_jsonb(
    pg_temp.successor_hash(pg_catalog.jsonb_build_object(
      'hash_domain','combined-falcon24-semantic-activation-command@1.0.0',
      'command',invalid_command-'command_hash'))));
  begin
    perform app_data_agent.activate_falcon24_authority_with_semantic_successor(invalid_command);
    raise exception 'FALCON24_NONCANONICAL_VERSION_ACCEPTED';
  exception when invalid_parameter_value then
    if sqlerrm<>'FALCON24_COMBINED_ACTIVATION_COMMAND_INVALID' then raise; end if;
  end;
  begin
    perform app_data_agent.activate_falcon24_authority_with_semantic_successor(command);
    raise exception 'FALCON24_LATE_ACTIVATION_CONFLICT_ACCEPTED';
  exception when unique_violation then null;
  end;
end
$late_failure_is_atomic$;
reset role;
do $late_failure_rollback_state$
begin
  if (select current_release_generation from semantic.semantic_active_pointer
      where tenant_id='00000000-0000-4000-8000-00000000aa83')<>1
    or (select current_release_generation from semantic.semantic_runtime_activation
      where tenant_id='00000000-0000-4000-8000-00000000aa83')<>1
    or (select defaults_revision from app_data_agent.workspace_run_defaults
      where tenant_id='00000000-0000-4000-8000-00000000aa83')<>1
    or (select authority_epoch from app_data_agent.falcon24_current_authority_epoch
      where tenant_id='00000000-0000-4000-8000-00000000aa83')<>'E3'
    or (select status from semantic.semantic_successor_release_stage
      where tenant_id='00000000-0000-4000-8000-00000000aa83')<>'SMOKE_PASSED'
    or exists(select 1 from semantic.semantic_source_release
      where release_id='00000000-0000-4000-8000-000000007832')
    or (select bytes from semantic_successor_predecessor_snapshot) is distinct from
      (select pg_catalog.md5(pg_catalog.to_jsonb(row)::text)
       from semantic.semantic_source_release row
       where row.release_id='00000000-0000-4000-8000-000000007831')
  then raise exception 'FALCON24_LATE_FAILURE_LEFT_MIXED_AUTHORITY'; end if;
end
$late_failure_rollback_state$;

rollback;

begin;
set local session_replication_role=replica;
select pg_temp.setup_semantic_successor_base();
set local session_replication_role=origin;
select pg_temp.set_semantic_successor_authority();
set local role data_agent_backend;
select semantic.record_semantic_successor_stage(pg_temp.semantic_successor_stage_command());
select semantic.commit_semantic_successor_smoke(pg_temp.semantic_successor_smoke_command());
reset role;
set local session_replication_role=replica;
select pg_temp.setup_falcon24_e4_candidate();
set local session_replication_role=origin;

create table test_support.semantic_successor_e4_probe_command(command jsonb not null);
insert into test_support.semantic_successor_e4_probe_command
values(pg_temp.semantic_successor_activation_command());
create table test_support.semantic_successor_stage_probe_command(command jsonb not null);
insert into test_support.semantic_successor_stage_probe_command
values(pg_temp.semantic_successor_stage_command());
create function test_support.activate_semantic_successor_e4_probe()
returns text language plpgsql volatile security definer set search_path='' as $function$
declare receipt jsonb;
begin
  perform pg_catalog.set_config(
    'data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
  perform pg_catalog.set_config(
    'data_agent.tenant_id','00000000-0000-4000-8000-00000000aa83',true);
  perform pg_catalog.set_config('data_agent.environment','test',true);
  perform pg_catalog.set_config(
    'data_agent.principal_id','00000000-0000-4000-8000-000000001083',true);
  perform pg_catalog.set_config('data_agent.role','owner',true);
  perform pg_catalog.set_config(
    'data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',true);
  perform pg_catalog.set_config('app.semantic_domain','falcon24_successor',true);
  select app_data_agent.activate_falcon24_authority_with_semantic_successor(command)
    into strict receipt from test_support.semantic_successor_e4_probe_command;
  return receipt->>'activation_receipt_hash';
end
$function$;
revoke all on function test_support.activate_semantic_successor_e4_probe() from public;
grant execute on function test_support.activate_semantic_successor_e4_probe() to postgres;
create function test_support.replay_semantic_successor_stage_probe()
returns text language plpgsql volatile security definer set search_path='' as $function$
declare envelope jsonb;
begin
  perform pg_catalog.set_config(
    'data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
  perform pg_catalog.set_config(
    'data_agent.tenant_id','00000000-0000-4000-8000-00000000aa83',true);
  perform pg_catalog.set_config('data_agent.environment','test',true);
  perform pg_catalog.set_config(
    'data_agent.principal_id','00000000-0000-4000-8000-000000001083',true);
  perform pg_catalog.set_config('data_agent.role','owner',true);
  perform pg_catalog.set_config(
    'data_agent.deployment_id','00000000-0000-4000-8000-00000000de01',true);
  perform pg_catalog.set_config('app.semantic_domain','falcon24_successor',true);
  select semantic.record_semantic_successor_stage(command) into strict envelope
  from test_support.semantic_successor_stage_probe_command;
  return envelope#>>'{stage,status}';
end
$function$;
revoke all on function test_support.replay_semantic_successor_stage_probe() from public;
grant execute on function test_support.replay_semantic_successor_stage_probe() to postgres;
commit;

\echo SEMANTIC_SUCCESSOR_E4_ACTIVATION_ASSERTIONS_READY
