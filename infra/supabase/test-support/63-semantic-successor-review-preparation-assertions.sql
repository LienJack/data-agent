\set ON_ERROR_STOP on

create or replace function pg_temp.successor_review_hash(document jsonb)
returns text language sql immutable security definer set search_path='' as $function$
  select app_data_agent.u2_canonical_sha256(document)
$function$;

create or replace function pg_temp.successor_published_early()
returns boolean language sql stable security definer set search_path='' as $function$
  select exists(
      select 1 from semantic.semantic_source_release
      where app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and tenant_id='00000000-0000-4000-8000-00000000a192'::uuid
        and environment='test' and semantic_domain='falcon24'
        and release_generation=2)
    or (select current_release_generation from semantic.semantic_active_pointer
      where app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and tenant_id='00000000-0000-4000-8000-00000000a192'::uuid
        and environment='test' and semantic_domain='falcon24')<>1
$function$;

begin;
set local session_replication_role=replica;

do $fixture$
declare
  app_id constant uuid:='00000000-0000-4000-8000-00000000da01';
  tenant_id constant uuid:='00000000-0000-4000-8000-00000000a192';
  principal_id constant uuid:='00000000-0000-4000-8000-000000001192';
  predecessor_id constant uuid:='00000000-0000-4000-8000-000000007191';
  predecessor_digest constant text:=
    'sha256:1111111111111111111111111111111111111111111111111111111111111111';
  policy_digest constant text:=
    'sha256:2222222222222222222222222222222222222222222222222222222222222222';
  dependency_digest constant text:=
    'sha256:3333333333333333333333333333333333333333333333333333333333333333';
begin
  insert into app_data_agent.workspaces(
    app_id,workspace_id,environment,slug,display_name)
  values(app_id,tenant_id,'test','falcon24-successor-review-10792',
    'Falcon24 successor review preparation fixture');
  insert into app_data_agent.memberships(
    app_id,tenant_id,environment,principal_id,membership_role)
  values(app_id,tenant_id,'test',principal_id,'owner');
  insert into semantic.semantic_authority_fence(
    app_id,tenant_id,environment,fence_epoch)
  values(app_id,tenant_id,'test',1);
  insert into semantic.semantic_domain_registry(
    app_id,tenant_id,environment,semantic_domain,datasource_id,
    domain_display_name,domain_version,is_active,created_by)
  values(app_id,tenant_id,'test','falcon24',
    '00000000-0000-4000-8000-00000000d192','Falcon24 successor review',1,true,
    principal_id::text);
  insert into semantic.semantic_active_pointer(
    app_id,tenant_id,environment,semantic_domain,current_release_id,
    current_release_generation,current_release_digest,pointer_generation,updated_by)
  values(app_id,tenant_id,'test','falcon24',predecessor_id,1,
    predecessor_digest,1,principal_id::text);
  insert into semantic.semantic_dependency_pointer(
    app_id,tenant_id,environment,semantic_domain,current_catalog_epoch,
    current_catalog_digest,current_compiler_bundle_digest,current_closure_policy_digest,
    pointer_generation,updated_by)
  values(app_id,tenant_id,'test','falcon24',1,dependency_digest,dependency_digest,
    dependency_digest,1,principal_id::text);
  insert into semantic.semantic_reviewer_policy_revision(
    app_id,tenant_id,environment,semantic_domain,policy_version,policy_digest,
    policy_payload,quorum_rules,veto_rules,expiry_rules,role_separation_rules,
    min_reviewers,decision_timeout_seconds,created_by)
  values(app_id,tenant_id,'test','falcon24',1,policy_digest,'{}',
    '{"required_approvals":1}','{"min_veto_count":1}',
    '{"decision_timeout_seconds":604800,"publish_timeout_seconds":604800}',
    '{"proposer_cannot_approve":true,"require_author_exclusion":true}',
    1,604800,principal_id::text);
  insert into semantic.semantic_reviewer_policy_pointer(
    app_id,tenant_id,environment,semantic_domain,current_policy_version,
    current_policy_digest,pointer_generation,updated_by)
  values(app_id,tenant_id,'test','falcon24',1,policy_digest,1,principal_id::text);
  insert into semantic.semantic_reviewer_assignment(
    app_id,tenant_id,environment,semantic_domain,assignment_id,principal,
    semantic_role,membership_version,policy_version,is_active,assigned_by)
  values(app_id,tenant_id,'test','falcon24',
    '00000000-0000-4000-8000-00000000b192',principal_id::text,
    'admin_reviewer',1,1,true,principal_id::text);
end
$fixture$;

set local session_replication_role=origin;
select pg_catalog.set_config('data_agent.app_id',
  '00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id',
  '00000000-0000-4000-8000-00000000a192',true);
select pg_catalog.set_config('data_agent.environment','test',true);
select pg_catalog.set_config('data_agent.principal_id',
  '00000000-0000-4000-8000-000000001192',true);
select pg_catalog.set_config('data_agent.role','owner',true);
select pg_catalog.set_config('data_agent.deployment_id',
  '00000000-0000-4000-8000-00000000de01',true);
select pg_catalog.set_config('app.semantic_domain','falcon24',true);
set local role data_agent_backend;

do $review_preparation$
declare
  change_set_material jsonb;
  change_set jsonb;
  command jsonb;
  opened jsonb;
  replay jsonb;
  conflict jsonb;
  decision jsonb;
  publish_command jsonb;
  prepared jsonb;
  prepared_replay jsonb;
begin
  change_set_material:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-change-set@1.0.0',
    'change_set_id','00000000-0000-4000-8000-00000000c192',
    'scope',pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-00000000a192',
      'environment','test','semantic_domain','falcon24'),
    'base_release',pg_catalog.jsonb_build_object(
      'release_id','00000000-0000-4000-8000-000000007191','generation',1,
      'release_hash','sha256:1111111111111111111111111111111111111111111111111111111111111111'),
    'revision',1,'assertions',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('canonical_key','metric.order_revenue')),
    'conflicts','[]'::jsonb,'competency_results','[]'::jsonb,
    'validation',pg_catalog.jsonb_build_object(
      'outcome','PASS','competency_cases_passed',true),
    'lifecycle_state','REVIEW_FROZEN');
  change_set:=change_set_material||pg_catalog.jsonb_build_object(
    'change_set_hash',pg_temp.successor_review_hash(change_set_material));
  command:=pg_catalog.jsonb_build_object(
    'schema_version','prepare-falcon24-semantic-successor-review@1.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-00000000a192',
      'workspace_id','00000000-0000-4000-8000-00000000a192',
      'environment','test'),
    'semantic_domain','falcon24',
    'idempotency_key','00000000-0000-4000-8000-00000000e192',
    'expected_predecessor',pg_catalog.jsonb_build_object(
      'release_id','00000000-0000-4000-8000-000000007191','generation',1,
      'release_digest','sha256:1111111111111111111111111111111111111111111111111111111111111111'),
    'expected_pointer_version',1,'change_set',change_set);
  opened:=semantic.prepare_falcon24_successor_review(command);
  replay:=semantic.prepare_falcon24_successor_review(command);
  if (opened-'created') is distinct from (replay-'created')
    or opened->>'candidate_status'<>'WAITING_REVIEW'
    or (opened->>'created')::boolean is not true
    or (replay->>'created')::boolean is not false
  then raise exception 'SEMANTIC_SUCCESSOR_REVIEW_REPLAY_INVALID'; end if;

  conflict:=pg_catalog.jsonb_set(command,'{expected_pointer_version}','2'::jsonb);
  begin
    perform semantic.prepare_falcon24_successor_review(conflict);
    raise exception 'SEMANTIC_SUCCESSOR_REVIEW_IDEMPOTENCY_CONFLICT_ACCEPTED';
  exception when unique_violation then
    if sqlerrm<>'SEMANTIC_SUCCESSOR_REVIEW_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;

  decision:=semantic.human_record_semantic_review_decision(
    pg_catalog.jsonb_build_object(
      'schema_version','human-semantic-review-decision@1.0.0',
      'scope',command->'scope','semantic_domain','falcon24',
      'packet_id',opened#>>'{review_packet_ref,review_id}',
      'principal_id','00000000-0000-4000-8000-000000001192',
      'semantic_role','admin_reviewer','decision','APPROVE','decision_reason',null));
  if decision->>'outcome'<>'APPROVED' or (decision->>'packet_closed')::boolean is not true
  then raise exception 'SEMANTIC_SUCCESSOR_HUMAN_REVIEW_NOT_CLOSED'; end if;

  publish_command:=pg_catalog.jsonb_build_object(
    'schema_version','prepare-falcon24-semantic-successor-publish-attempt@1.0.0',
    'scope',command->'scope','semantic_domain','falcon24',
    'review_id',opened#>>'{review_packet_ref,review_id}',
    'change_set_ref',opened->'change_set_ref',
    'compiler_bundle_digest',
      'sha256:4444444444444444444444444444444444444444444444444444444444444444',
    'target_generation',2,
    'idempotency_digest',
      'sha256:5555555555555555555555555555555555555555555555555555555555555555',
    'expected_predecessor',command->'expected_predecessor','expected_pointer_version',1);
  prepared:=semantic.prepare_falcon24_successor_publish_attempt(publish_command);
  prepared_replay:=semantic.prepare_falcon24_successor_publish_attempt(publish_command);
  if prepared#>>'{attempt_state}'<>'PREPARED'
    or prepared#>>'{review_ref,review_hash}'<>decision->>'decision_digest'
    or prepared#>>'{review_document,review_hash}'<>decision->>'decision_digest'
    or (prepared->>'created')::boolean is not true
    or (prepared_replay->>'created')::boolean is not false
  then raise exception 'SEMANTIC_SUCCESSOR_PUBLISH_PREPARATION_INVALID'; end if;

  if not exists(select 1
      from semantic.semantic_successor_review_decision_document as document
      where document.packet_id=(opened#>>'{review_packet_ref,review_id}')::uuid
        and document.review_hash=decision->>'decision_digest')
  then raise exception 'SEMANTIC_SUCCESSOR_REVIEW_DOCUMENT_NOT_READABLE'; end if;

  if pg_temp.successor_published_early()
  then raise exception 'SEMANTIC_SUCCESSOR_REVIEW_PREPARATION_PUBLISHED_EARLY'; end if;
end
$review_preparation$;

reset role;
do $security$
begin
  if pg_catalog.has_table_privilege('data_agent_backend',
      'semantic.semantic_successor_review_preparation','SELECT')
    or not pg_catalog.has_table_privilege('data_agent_backend',
      'semantic.semantic_successor_review_decision_document','SELECT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'semantic.semantic_successor_review_decision_document','INSERT,UPDATE,DELETE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'semantic.record_review_decision(uuid,uuid,text,text,uuid,text,text,text,text)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'semantic.human_record_semantic_review_decision(jsonb)','EXECUTE')
  then raise exception 'SEMANTIC_SUCCESSOR_REVIEW_PREPARATION_SECURITY_INVALID'; end if;
end
$security$;

rollback;
