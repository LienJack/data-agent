-- ============================================================
-- Human-governed compatibility surface. The legacy positional RPCs remain
-- implementation details owned by a dedicated NOLOGIN role; callers use the
-- strict JSON envelopes below.
-- ============================================================

-- 10610 attempted to cast digest(bytea) directly through bit(64), which is not
-- a valid PostgreSQL cast. Preserve the same packet-scoped serialization with
-- the repository's established text advisory-lock primitive.
create or replace function semantic.lock_packet(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,p_packet_id uuid
) returns void language plpgsql strict security definer set search_path = '' as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_app_id::text||':'||p_tenant_id::text||':'||p_environment||':'||
    p_semantic_domain||':'||p_packet_id::text,0
  ));
end
$function$;

create or replace function semantic.commit_publish_attempt(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,
  p_attempt_id uuid,p_executable_projection_ref uuid,p_executable_projection_hash text,
  p_relationship_projection_ref uuid,p_relationship_projection_hash text,
  p_runtime_restriction_projection_ref uuid,p_runtime_restriction_projection_hash text,
  p_profile_child_manifest jsonb default null,p_committed_legacy_attempt_ref uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_attempt semantic.semantic_publish_attempt%rowtype;
  v_pointer semantic.semantic_active_pointer%rowtype;
  v_quorum_snapshot jsonb;
  v_release_id uuid:=extensions.gen_random_uuid();
  v_release_digest text; v_decision_set_digest text;
begin
  perform semantic.lock_semantic_authority_fence(p_app_id,p_tenant_id,p_environment,p_semantic_domain);
  select attempt.* into v_attempt from semantic.semantic_publish_attempt as attempt
  where attempt.app_id=p_app_id and attempt.tenant_id=p_tenant_id and attempt.environment=p_environment
    and attempt.semantic_domain=p_semantic_domain and attempt.attempt_id=p_attempt_id
    and attempt.attempt_state='PREPARED' and attempt.approval_mode='HUMAN_REVIEW' for update;
  if not found then raise exception using errcode='P0001',message='SEMANTIC_PUBLISH_CONFLICT'; end if;
  select task.quorum_rules_snapshot into v_quorum_snapshot from semantic.semantic_review_task as task
  where task.app_id=p_app_id and task.tenant_id=p_tenant_id and task.environment=p_environment
    and task.semantic_domain=p_semantic_domain and task.packet_id=v_attempt.packet_id
    and task.approval_mode='HUMAN_REVIEW' and task.decision_window_status='CLOSED'
    and task.review_outcome='APPROVED';
  if not found then raise exception using errcode='P0001',message='SEMANTIC_PUBLISH_CONFLICT'; end if;
  select pointer.* into v_pointer from semantic.semantic_active_pointer as pointer
  where pointer.app_id=p_app_id and pointer.tenant_id=p_tenant_id and pointer.environment=p_environment
    and pointer.semantic_domain=p_semantic_domain for update;
  if not found or v_pointer.current_release_generation+1<>v_attempt.target_generation then
    raise exception using errcode='P0001',message='SEMANTIC_PUBLISH_CONFLICT';
  end if;
  perform 1 from semantic.semantic_runtime_activation as activation
  where activation.app_id=p_app_id and activation.tenant_id=p_tenant_id and activation.environment=p_environment
    and activation.semantic_domain=p_semantic_domain for update;
  select semantic.semantic_sha256(
    v_attempt.packet_id::text,
    pg_catalog.jsonb_build_object(
      'version','1.0.0','kind','decision_set',
      'decisions',coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'decision_id',decision.decision_id,'principal',decision.principal,
        'semantic_role',decision.semantic_role,'decision',decision.decision,
        'decision_digest',decision.decision_digest
      ) order by decision.decision_id),'[]'::jsonb)
    )
  ) into v_decision_set_digest
  from semantic.semantic_review_decision as decision
  where decision.app_id=p_app_id and decision.tenant_id=p_tenant_id
    and decision.environment=p_environment and decision.semantic_domain=p_semantic_domain
    and decision.packet_id=v_attempt.packet_id;
  v_release_digest:=semantic.semantic_sha256(
    p_attempt_id::text||v_attempt.target_generation::text,
    pg_catalog.jsonb_build_object('version','1.0.0','kind','source_release'));
  insert into semantic.semantic_source_release (
    app_id,tenant_id,environment,semantic_domain,release_id,release_generation,attempt_id,packet_id,candidate_id,
    release_digest,compiler_bundle_digest,executable_projection_ref,executable_projection_hash,
    relationship_projection_ref,relationship_projection_hash,runtime_restriction_projection_ref,
    runtime_restriction_projection_hash,profile_child_manifest,quorum_snapshot,decision_set_digest,published_by,approval_mode
  ) values (
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,v_release_id,v_attempt.target_generation,p_attempt_id,
    v_attempt.packet_id,v_attempt.candidate_id,v_release_digest,v_attempt.compiler_bundle_digest,
    p_executable_projection_ref,p_executable_projection_hash,p_relationship_projection_ref,
    p_relationship_projection_hash,p_runtime_restriction_projection_ref,p_runtime_restriction_projection_hash,
    p_profile_child_manifest,v_quorum_snapshot,v_decision_set_digest,session_user,'HUMAN_REVIEW'
  );
  update semantic.semantic_active_pointer as pointer set current_release_id=v_release_id,
    current_release_generation=v_attempt.target_generation,current_release_digest=v_release_digest,
    pointer_generation=pointer.pointer_generation+1,updated_at=pg_catalog.clock_timestamp(),updated_by=session_user
  where pointer.app_id=p_app_id and pointer.tenant_id=p_tenant_id and pointer.environment=p_environment
    and pointer.semantic_domain=p_semantic_domain;
  update semantic.semantic_runtime_activation as activation set current_release_id=v_release_id,
    current_release_generation=v_attempt.target_generation,updated_at=pg_catalog.clock_timestamp()
  where activation.app_id=p_app_id and activation.tenant_id=p_tenant_id and activation.environment=p_environment
    and activation.semantic_domain=p_semantic_domain;
  update semantic.semantic_publish_attempt as attempt set attempt_state='COMMITTED',committed_release_ref=v_release_id,
    committed_legacy_attempt_ref=p_committed_legacy_attempt_ref,updated_at=pg_catalog.clock_timestamp()
  where attempt.app_id=p_app_id and attempt.tenant_id=p_tenant_id and attempt.environment=p_environment
    and attempt.semantic_domain=p_semantic_domain and attempt.attempt_id=p_attempt_id;
  update semantic.semantic_candidate as candidate set candidate_status='PUBLISHED',updated_at=pg_catalog.clock_timestamp()
  where candidate.app_id=p_app_id and candidate.tenant_id=p_tenant_id and candidate.environment=p_environment
    and candidate.semantic_domain=p_semantic_domain and candidate.candidate_id=v_attempt.candidate_id;
  return pg_catalog.jsonb_build_object('release_id',v_release_id,'release_generation',v_attempt.target_generation,
    'release_digest',v_release_digest,'attempt_state','COMMITTED');
end
$function$;

create or replace function semantic.execute_rollback(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,
  p_authorization_id uuid,p_nonce uuid,p_rollback_reason text
) returns jsonb language plpgsql strict security definer set search_path = '' as $function$
declare
  v_auth semantic.semantic_rollback_authorization%rowtype;
  v_pointer semantic.semantic_active_pointer%rowtype;
  v_target_digest text;
  v_receipt_id uuid:=extensions.gen_random_uuid();
  v_receipt_digest text;
begin
  perform semantic.lock_semantic_authority_fence(p_app_id,p_tenant_id,p_environment,p_semantic_domain);
  select pointer.* into v_pointer from semantic.semantic_active_pointer as pointer
  where pointer.app_id=p_app_id and pointer.tenant_id=p_tenant_id
    and pointer.environment=p_environment and pointer.semantic_domain=p_semantic_domain
  for update;
  perform 1 from semantic.semantic_runtime_activation as activation
  where activation.app_id=p_app_id and activation.tenant_id=p_tenant_id
    and activation.environment=p_environment and activation.semantic_domain=p_semantic_domain
  for update;
  select rollback_auth.* into v_auth from semantic.semantic_rollback_authorization as rollback_auth
  where rollback_auth.app_id=p_app_id and rollback_auth.tenant_id=p_tenant_id
    and rollback_auth.environment=p_environment and rollback_auth.semantic_domain=p_semantic_domain
    and rollback_auth.authorization_id=p_authorization_id and rollback_auth.nonce=p_nonce
    and not rollback_auth.is_consumed and rollback_auth.expires_at>pg_catalog.clock_timestamp()
  for update;
  if not found or v_pointer.current_release_id is distinct from v_auth.current_release_id
    or v_pointer.current_release_generation<>v_auth.current_release_generation
    or v_auth.from_release_id<>v_auth.current_release_id
    or v_auth.from_release_generation<>v_auth.current_release_generation
  then raise exception using errcode='P0001',message='SEMANTIC_ROLLBACK_CONFLICT'; end if;
  select release.release_digest into v_target_digest from semantic.semantic_source_release as release
  where release.app_id=p_app_id and release.tenant_id=p_tenant_id
    and release.environment=p_environment and release.semantic_domain=p_semantic_domain
    and release.release_id=v_auth.to_release_id
    and release.release_generation=v_auth.to_release_generation;
  if not found then raise exception using errcode='P0001',message='SEMANTIC_ROLLBACK_CONFLICT'; end if;
  update semantic.semantic_rollback_authorization as rollback_auth
  set is_consumed=true,consumed_at=pg_catalog.clock_timestamp()
  where rollback_auth.app_id=p_app_id and rollback_auth.tenant_id=p_tenant_id
    and rollback_auth.environment=p_environment and rollback_auth.semantic_domain=p_semantic_domain
    and rollback_auth.authorization_id=p_authorization_id;
  v_receipt_digest:=semantic.semantic_sha256(
    p_authorization_id::text||p_rollback_reason,
    pg_catalog.jsonb_build_object('version','1.0.0','kind','rollback_receipt')
  );
  insert into semantic.semantic_rollback_receipt (
    app_id,tenant_id,environment,semantic_domain,receipt_id,authorization_id,
    from_release_id,from_release_generation,to_release_id,to_release_generation,
    rollback_reason,decision_set_digest,receipt_digest
  ) values (
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,v_receipt_id,p_authorization_id,
    v_auth.from_release_id,v_auth.from_release_generation,v_auth.to_release_id,v_auth.to_release_generation,
    p_rollback_reason,v_auth.decision_set_digest,v_receipt_digest
  );
  update semantic.semantic_active_pointer as pointer set
    current_release_id=v_auth.to_release_id,current_release_generation=v_auth.to_release_generation,
    current_release_digest=v_target_digest,pointer_generation=pointer.pointer_generation+1,
    updated_at=pg_catalog.clock_timestamp(),updated_by=session_user
  where pointer.app_id=p_app_id and pointer.tenant_id=p_tenant_id
    and pointer.environment=p_environment and pointer.semantic_domain=p_semantic_domain;
  update semantic.semantic_runtime_activation as activation set
    current_release_id=v_auth.to_release_id,current_release_generation=v_auth.to_release_generation,
    updated_at=pg_catalog.clock_timestamp()
  where activation.app_id=p_app_id and activation.tenant_id=p_tenant_id
    and activation.environment=p_environment and activation.semantic_domain=p_semantic_domain;
  return pg_catalog.jsonb_build_object(
    'receipt_id',v_receipt_id,'receipt_digest',v_receipt_digest,
    'from_release_generation',v_auth.from_release_generation,
    'to_release_generation',v_auth.to_release_generation
  );
end
$function$;

create function semantic.human_prepare_publish_attempt(p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare v_scope jsonb;
begin
  if p_command is null or not semantic.u5_json_has_exact_keys(p_command,array[
    'schema_version','scope','semantic_domain','packet_id','candidate_id','compiler_bundle_digest',
    'catalog_fence_epoch','dependency_generation','target_generation','idempotency_digest','conditional_legacy_plan'
  ]::text[]) or p_command->>'schema_version'<>'human-prepare-publish-attempt@1.0.0'
  then raise exception using errcode='22023',message='SEMANTIC_HUMAN_PREPARE_COMMAND_INVALID'; end if;
  v_scope:=p_command->'scope'; perform semantic.assert_u5_scope(v_scope,p_command->>'semantic_domain',true);
  perform 1 from semantic.semantic_review_task as task
  where task.app_id=(v_scope->>'app_id')::uuid and task.tenant_id=(v_scope->>'tenant_id')::uuid
    and task.environment=v_scope->>'environment' and task.semantic_domain=p_command->>'semantic_domain'
    and task.packet_id=(p_command->>'packet_id')::uuid and task.approval_mode='HUMAN_REVIEW';
  if not found then raise exception using errcode='P0001',message='SEMANTIC_HUMAN_REVIEW_REQUIRED'; end if;
  return semantic.prepare_publish_attempt((v_scope->>'app_id')::uuid,(v_scope->>'tenant_id')::uuid,
    v_scope->>'environment',p_command->>'semantic_domain',(p_command->>'packet_id')::uuid,
    (p_command->>'candidate_id')::uuid,p_command->>'compiler_bundle_digest',
    (p_command->>'catalog_fence_epoch')::bigint,(p_command->>'dependency_generation')::bigint,
    (p_command->>'target_generation')::bigint,p_command->>'idempotency_digest',p_command->'conditional_legacy_plan');
end
$function$;

create function semantic.human_commit_publish_attempt(p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare v_scope jsonb;
begin
  if p_command is null or not semantic.u5_json_has_exact_keys(p_command,array[
    'schema_version','scope','semantic_domain','attempt_id','executable_projection_ref','executable_projection_hash',
    'relationship_projection_ref','relationship_projection_hash','runtime_restriction_projection_ref',
    'runtime_restriction_projection_hash','profile_child_manifest','committed_legacy_attempt_ref'
  ]::text[]) or p_command->>'schema_version'<>'human-commit-publish-attempt@1.0.0'
  then raise exception using errcode='22023',message='SEMANTIC_HUMAN_COMMIT_COMMAND_INVALID'; end if;
  v_scope:=p_command->'scope'; perform semantic.assert_u5_scope(v_scope,p_command->>'semantic_domain',true);
  return semantic.commit_publish_attempt((v_scope->>'app_id')::uuid,(v_scope->>'tenant_id')::uuid,
    v_scope->>'environment',p_command->>'semantic_domain',(p_command->>'attempt_id')::uuid,
    (p_command->>'executable_projection_ref')::uuid,p_command->>'executable_projection_hash',
    (p_command->>'relationship_projection_ref')::uuid,p_command->>'relationship_projection_hash',
    (p_command->>'runtime_restriction_projection_ref')::uuid,p_command->>'runtime_restriction_projection_hash',
    p_command->'profile_child_manifest',nullif(p_command->>'committed_legacy_attempt_ref','')::uuid);
end
$function$;

create function semantic.human_execute_rollback(p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare v_scope jsonb;
begin
  if p_command is null or not semantic.u5_json_has_exact_keys(p_command,array[
    'schema_version','scope','semantic_domain','authorization_id','nonce','rollback_reason'
  ]::text[]) or p_command->>'schema_version'<>'human-execute-rollback@1.0.0'
  then raise exception using errcode='22023',message='SEMANTIC_HUMAN_ROLLBACK_COMMAND_INVALID'; end if;
  v_scope:=p_command->'scope'; perform semantic.assert_u5_scope(v_scope,p_command->>'semantic_domain',true);
  perform 1 from semantic.semantic_rollback_authorization as rollback_auth
  join semantic.semantic_review_task as task on task.app_id=rollback_auth.app_id
    and task.tenant_id=rollback_auth.tenant_id and task.environment=rollback_auth.environment
    and task.semantic_domain=rollback_auth.semantic_domain and task.packet_id=rollback_auth.packet_id
  where rollback_auth.app_id=(v_scope->>'app_id')::uuid
    and rollback_auth.tenant_id=(v_scope->>'tenant_id')::uuid
    and rollback_auth.environment=v_scope->>'environment'
    and rollback_auth.semantic_domain=p_command->>'semantic_domain'
    and rollback_auth.authorization_id=(p_command->>'authorization_id')::uuid
    and task.approval_mode='HUMAN_REVIEW';
  if not found then raise exception using errcode='P0001',message='SEMANTIC_HUMAN_REVIEW_REQUIRED'; end if;
  return semantic.execute_rollback((v_scope->>'app_id')::uuid,(v_scope->>'tenant_id')::uuid,
    v_scope->>'environment',p_command->>'semantic_domain',(p_command->>'authorization_id')::uuid,
    (p_command->>'nonce')::uuid,p_command->>'rollback_reason');
end
$function$;
