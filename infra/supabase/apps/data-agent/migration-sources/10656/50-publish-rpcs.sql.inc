-- ============================================================
-- One atomic generation-zero to generation-one publish and exact load.
-- ============================================================

create function semantic.publish_initial_semantic_release_set(p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_scope jsonb; v_release_set jsonb; v_request_hash text; v_principal_id uuid;
  v_existing semantic.semantic_bootstrap_publish_idempotency%rowtype;
  v_verified semantic.verified_semantic_domain_bootstrap_receipts%rowtype;
  v_validation semantic.semantic_bootstrap_validation_receipts%rowtype;
  v_grant semantic.semantic_bootstrap_publisher_grants%rowtype;
  v_policy semantic.semantic_bootstrap_policy_revisions%rowtype;
  v_pointer semantic.semantic_active_pointer%rowtype;
  v_candidate semantic.semantic_candidate_revision%rowtype;
  v_package jsonb; v_package_admissions jsonb:='[]'::jsonb; v_package_refs jsonb:='[]'::jsonb;
  v_package_receipt jsonb; v_first_receipt jsonb; v_tombstone jsonb; v_result jsonb;
  v_packet_id uuid:=extensions.gen_random_uuid(); v_attempt_id uuid:=extensions.gen_random_uuid();
  v_package_receipt_id uuid; v_first_receipt_id uuid:=extensions.gen_random_uuid();
  v_tombstone_id uuid:=extensions.gen_random_uuid(); v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  if p_command is null or not semantic.u5_json_has_exact_keys(p_command,array[
    'schema_version','command_id','idempotency_key','scope','semantic_domain','verified_domain_ref',
    'policy_ref','grant_ref','validation_ref','release_set'
  ]::text[]) or p_command->>'schema_version'<>'publish-initial-semantic-release-command@1.0.0'
  then raise exception using errcode='22023',message='SEMANTIC_BOOTSTRAP_PUBLISH_COMMAND_INVALID'; end if;
  v_scope:=p_command->'scope'; v_release_set:=p_command->'release_set';
  perform semantic.assert_u5_scope(v_scope,p_command->>'semantic_domain',true);
  v_principal_id:=nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid;
  v_request_hash:=app_data_agent.u2_canonical_sha256(p_command);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    (v_scope->>'app_id')||':'||(v_scope->>'tenant_id')||':'||(v_scope->>'environment')||':'||
    v_principal_id::text||':'||(p_command->>'idempotency_key'),0
  ));
  select receipt.* into v_existing from semantic.semantic_bootstrap_publish_idempotency as receipt
  where receipt.app_id=(v_scope->>'app_id')::uuid and receipt.tenant_id=(v_scope->>'tenant_id')::uuid
    and receipt.environment=v_scope->>'environment' and receipt.semantic_domain=p_command->>'semantic_domain'
    and receipt.principal_id=v_principal_id and receipt.idempotency_key=p_command->>'idempotency_key';
  if found then
    if v_existing.request_hash<>v_request_hash then
      raise exception using errcode='23505',message='SEMANTIC_BOOTSTRAP_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_set(v_existing.result_json,'{disposition}','"REPLAYED"'::jsonb);
  end if;
  if not semantic.u5_json_has_exact_keys(v_release_set,array[
    'schema_version','release_set_id','scope','semantic_domain','release_id','generation','base_release_id',
    'candidate_set_root','policy_ref','validation_ref','packages','runtime_projections','published_at','release_set_hash'
  ]::text[]) or v_release_set->>'schema_version'<>'initial-semantic-release-set@1.0.0'
    or (v_release_set->>'generation')::bigint<>1 or v_release_set->'base_release_id'<>'null'::jsonb
    or v_release_set->>'release_set_hash'<>app_data_agent.u2_canonical_sha256(v_release_set-'release_set_hash')
    or v_release_set->'scope'<>v_scope or v_release_set->>'semantic_domain'<>p_command->>'semantic_domain'
    or pg_catalog.jsonb_typeof(v_release_set->'packages')<>'array'
    or pg_catalog.jsonb_array_length(v_release_set->'packages')=0
    or v_release_set->'packages' <> (
      select pg_catalog.jsonb_agg(package_entry.value order by
        package_entry.value->>'namespace_id',package_entry.value->>'package_id',
        (package_entry.value->>'package_version')::bigint,package_entry.value->>'package_hash')
      from pg_catalog.jsonb_array_elements(v_release_set->'packages') as package_entry(value)
    )
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(v_release_set->'packages') as package_entry(value)
      group by package_entry.value->>'package_id',(package_entry.value->>'package_version')::bigint
      having pg_catalog.count(*)<>1
    )
  then raise exception using errcode='22023',message='SEMANTIC_BOOTSTRAP_RELEASE_SET_INVALID'; end if;
  perform semantic.lock_semantic_authority_fence(
    (v_scope->>'app_id')::uuid,(v_scope->>'tenant_id')::uuid,v_scope->>'environment',p_command->>'semantic_domain'
  );
  select pointer.* into v_pointer from semantic.semantic_active_pointer as pointer
  where pointer.app_id=(v_scope->>'app_id')::uuid and pointer.tenant_id=(v_scope->>'tenant_id')::uuid
    and pointer.environment=v_scope->>'environment' and pointer.semantic_domain=p_command->>'semantic_domain'
  for update;
  if not found or v_pointer.current_release_id is not null or v_pointer.current_release_generation<>0
    or exists (select 1 from semantic.semantic_bootstrap_capability_tombstones as tombstone
      where tombstone.app_id=v_pointer.app_id and tombstone.tenant_id=v_pointer.tenant_id
        and tombstone.environment=v_pointer.environment and tombstone.semantic_domain=v_pointer.semantic_domain)
  then raise exception using errcode='P0001',message='SEMANTIC_BOOTSTRAP_CAPABILITY_CLOSED'; end if;
  select receipt.* into v_verified from semantic.verified_semantic_domain_bootstrap_receipts as receipt
  where receipt.app_id=v_pointer.app_id and receipt.tenant_id=v_pointer.tenant_id
    and receipt.environment=v_pointer.environment and receipt.semantic_domain=v_pointer.semantic_domain
    and receipt.receipt_id=(p_command#>>'{verified_domain_ref,receipt_id}')::uuid
    and receipt.receipt_hash=p_command#>>'{verified_domain_ref,receipt_hash}'
    and receipt.release_set_id=(v_release_set->>'release_set_id')::uuid
    and receipt.candidate_set_hash=v_release_set#>>'{candidate_set_root,candidate_set_hash}'
    and receipt.policy_hash=p_command#>>'{policy_ref,policy_hash}';
  if not found then raise exception using errcode='P0001',message='SEMANTIC_BOOTSTRAP_VERIFIED_RECEIPT_STALE'; end if;
  select policy.* into v_policy from semantic.semantic_bootstrap_policy_revisions as policy
  where policy.app_id=v_pointer.app_id and policy.tenant_id=v_pointer.tenant_id
    and policy.environment=v_pointer.environment and policy.semantic_domain=v_pointer.semantic_domain
    and policy.policy_id=(p_command#>>'{policy_ref,policy_id}')::uuid
    and policy.policy_revision=(p_command#>>'{policy_ref,policy_revision}')::bigint
    and policy.policy_hash=p_command#>>'{policy_ref,policy_hash}' and policy.valid_from<=v_now and policy.valid_until>v_now;
  if not found then raise exception using errcode='P0001',message='SEMANTIC_BOOTSTRAP_POLICY_STALE'; end if;
  select validation.* into v_validation from semantic.semantic_bootstrap_validation_receipts as validation
  where validation.app_id=v_pointer.app_id and validation.tenant_id=v_pointer.tenant_id
    and validation.environment=v_pointer.environment and validation.semantic_domain=v_pointer.semantic_domain
    and validation.receipt_id=(p_command#>>'{validation_ref,receipt_id}')::uuid
    and validation.receipt_hash=p_command#>>'{validation_ref,receipt_hash}'
    and validation.candidate_set_hash=v_verified.candidate_set_hash and validation.policy_hash=v_policy.policy_hash;
  if not found or v_validation.receipt_json->'packages'<>v_release_set->'packages' then
    raise exception using errcode='P0001',message='SEMANTIC_BOOTSTRAP_VALIDATION_STALE';
  end if;
  select publisher_grant.* into v_grant
  from semantic.semantic_bootstrap_publisher_grants as publisher_grant
  where publisher_grant.app_id=v_pointer.app_id and publisher_grant.tenant_id=v_pointer.tenant_id
    and publisher_grant.environment=v_pointer.environment
    and publisher_grant.semantic_domain=v_pointer.semantic_domain
    and publisher_grant.grant_id=(p_command#>>'{grant_ref,grant_id}')::uuid
    and publisher_grant.grant_hash=p_command#>>'{grant_ref,grant_hash}'
    and publisher_grant.grant_status='ACTIVE'
    and publisher_grant.expires_at>v_now and publisher_grant.release_set_id=v_verified.release_set_id
    and publisher_grant.operator_principal_id=v_principal_id
    and publisher_grant.candidate_set_hash=v_verified.candidate_set_hash
    and publisher_grant.policy_hash=v_policy.policy_hash
  for update;
  if not found then raise exception using errcode='P0001',message='SEMANTIC_BOOTSTRAP_PUBLISHER_GRANT_INVALID'; end if;
  select revision.* into v_candidate from semantic.semantic_candidate_revision as revision
  where revision.app_id=v_pointer.app_id and revision.tenant_id=v_pointer.tenant_id
    and revision.environment=v_pointer.environment and revision.semantic_domain=v_pointer.semantic_domain
    and revision.candidate_id=(v_release_set#>>'{candidate_set_root,candidate_id}')::uuid
    and revision.revision_id=(v_release_set#>>'{candidate_set_root,revision_id}')::uuid
    and revision.revision_number=(v_release_set#>>'{candidate_set_root,revision}')::bigint
    and revision.revision_digest=v_release_set#>>'{candidate_set_root,revision_digest}';
  if not found
    or v_candidate.revision_payload#>>'{candidate_set_hash}' is distinct from v_verified.candidate_set_hash
    or v_candidate.revision_payload->'packages' is distinct from v_release_set->'packages'
  then
    raise exception using errcode='P0001',message='SEMANTIC_BOOTSTRAP_CANDIDATE_SET_ROOT_INVALID';
  end if;
  insert into semantic.semantic_review_task (
    app_id,tenant_id,environment,semantic_domain,packet_id,packet_kind,approval_mode,
    packet_digest,packet_payload,candidate_id,decision_window_status,review_outcome,
    decision_expires_at,publish_expires_at,quorum_rules_snapshot,veto_rules_snapshot,
    created_by,closed_at
  ) values (
    v_pointer.app_id,v_pointer.tenant_id,v_pointer.environment,v_pointer.semantic_domain,
    v_packet_id,'SYSTEM_BOOTSTRAP_ADMISSION','SYSTEM_BOOTSTRAP_POLICY',v_release_set->>'release_set_hash',
    pg_catalog.jsonb_build_object('release_set_ref',pg_catalog.jsonb_build_object(
      'release_set_id',v_release_set->>'release_set_id','release_set_hash',v_release_set->>'release_set_hash'
    )),v_candidate.candidate_id,'CLOSED','APPROVED',v_now,v_now,v_policy.policy_json,
    pg_catalog.jsonb_build_object('human_decisions_forbidden',true),'u5-bootstrap-policy',v_now
  );
  insert into semantic.semantic_publish_attempt (
    app_id,tenant_id,environment,semantic_domain,attempt_id,packet_id,candidate_id,attempt_state,
    approval_mode,compiler_bundle_digest,catalog_fence_epoch,dependency_generation,
    executable_projection_ref,executable_projection_hash,relationship_projection_ref,
    relationship_projection_hash,runtime_restriction_projection_ref,
    runtime_restriction_projection_hash,target_generation,idempotency_digest
  ) values (
    v_pointer.app_id,v_pointer.tenant_id,v_pointer.environment,v_pointer.semantic_domain,
    v_attempt_id,v_packet_id,v_candidate.candidate_id,'COMMITTED','SYSTEM_BOOTSTRAP_POLICY',
    v_verified.candidate_set_hash,0,0,(v_release_set#>>'{runtime_projections,executable,projection_id}')::uuid,
    v_release_set#>>'{runtime_projections,executable,projection_hash}',
    (v_release_set#>>'{runtime_projections,relationship,projection_id}')::uuid,
    v_release_set#>>'{runtime_projections,relationship,projection_hash}',
    (v_release_set#>>'{runtime_projections,runtime_restriction,projection_id}')::uuid,
    v_release_set#>>'{runtime_projections,runtime_restriction,projection_hash}',1,v_request_hash
  );
  insert into semantic.semantic_source_release (
    app_id,tenant_id,environment,semantic_domain,release_id,release_generation,attempt_id,packet_id,
    candidate_id,release_digest,compiler_bundle_digest,executable_projection_ref,executable_projection_hash,
    relationship_projection_ref,relationship_projection_hash,runtime_restriction_projection_ref,
    runtime_restriction_projection_hash,quorum_snapshot,decision_set_digest,published_at,published_by,approval_mode
  ) values (
    v_pointer.app_id,v_pointer.tenant_id,v_pointer.environment,v_pointer.semantic_domain,
    (v_release_set->>'release_id')::uuid,1,v_attempt_id,v_packet_id,v_candidate.candidate_id,
    v_release_set->>'release_set_hash',v_verified.candidate_set_hash,
    (v_release_set#>>'{runtime_projections,executable,projection_id}')::uuid,
    v_release_set#>>'{runtime_projections,executable,projection_hash}',
    (v_release_set#>>'{runtime_projections,relationship,projection_id}')::uuid,
    v_release_set#>>'{runtime_projections,relationship,projection_hash}',
    (v_release_set#>>'{runtime_projections,runtime_restriction,projection_id}')::uuid,
    v_release_set#>>'{runtime_projections,runtime_restriction,projection_hash}',
    v_policy.policy_json,v_release_set->>'release_set_hash',(v_release_set->>'published_at')::timestamptz,
    v_principal_id::text,'SYSTEM_BOOTSTRAP_POLICY'
  );
  insert into semantic.semantic_executable_projection (
    app_id,tenant_id,environment,semantic_domain,projection_id,release_id,projection_digest,projection_payload
  ) values (v_pointer.app_id,v_pointer.tenant_id,v_pointer.environment,v_pointer.semantic_domain,
    (v_release_set#>>'{runtime_projections,executable,projection_id}')::uuid,(v_release_set->>'release_id')::uuid,
    v_release_set#>>'{runtime_projections,executable,projection_hash}',pg_catalog.jsonb_build_object('release_set_hash',v_release_set->>'release_set_hash'));
  insert into semantic.semantic_relationship_projection (
    app_id,tenant_id,environment,semantic_domain,projection_id,release_id,datasource_id,catalog_epoch,projection_digest,projection_payload
  ) values (v_pointer.app_id,v_pointer.tenant_id,v_pointer.environment,v_pointer.semantic_domain,
    (v_release_set#>>'{runtime_projections,relationship,projection_id}')::uuid,(v_release_set->>'release_id')::uuid,
    v_verified.datasource_id,0,v_release_set#>>'{runtime_projections,relationship,projection_hash}',
    pg_catalog.jsonb_build_object('release_set_hash',v_release_set->>'release_set_hash'));
  insert into semantic.semantic_runtime_restriction_projection (
    app_id,tenant_id,environment,semantic_domain,projection_id,release_id,projection_digest,
    platform_policy_digest,compiler_bundle_digest,pointer_generation,restriction_payload
  ) values (v_pointer.app_id,v_pointer.tenant_id,v_pointer.environment,v_pointer.semantic_domain,
    (v_release_set#>>'{runtime_projections,runtime_restriction,projection_id}')::uuid,(v_release_set->>'release_id')::uuid,
    v_release_set#>>'{runtime_projections,runtime_restriction,projection_hash}',v_policy.policy_hash,
    v_verified.candidate_set_hash,v_pointer.pointer_generation+1,pg_catalog.jsonb_build_object('release_set_hash',v_release_set->>'release_set_hash'));
  insert into semantic.initial_semantic_release_sets (
    app_id,tenant_id,environment,semantic_domain,release_set_id,release_id,release_set_hash,
    candidate_id,candidate_revision_id,policy_hash,validation_receipt_id,validation_receipt_hash,release_set_json,published_at
  ) values (v_pointer.app_id,v_pointer.tenant_id,v_pointer.environment,v_pointer.semantic_domain,
    (v_release_set->>'release_set_id')::uuid,(v_release_set->>'release_id')::uuid,v_release_set->>'release_set_hash',
    v_candidate.candidate_id,v_candidate.revision_id,v_policy.policy_hash,v_validation.receipt_id,v_validation.receipt_hash,
    v_release_set,(v_release_set->>'published_at')::timestamptz);
  for v_package in select value from pg_catalog.jsonb_array_elements(v_release_set->'packages') loop
    insert into semantic.initial_semantic_release_package_bindings (
      app_id,tenant_id,environment,semantic_domain,release_set_id,namespace_id,package_id,package_version,package_hash,
      validation_receipt_id,validation_receipt_hash,preview_id,preview_hash,graph_projection_id,graph_projection_hash,binding_json
    ) values (v_pointer.app_id,v_pointer.tenant_id,v_pointer.environment,v_pointer.semantic_domain,
      (v_release_set->>'release_set_id')::uuid,(v_package->>'namespace_id')::uuid,(v_package->>'package_id')::uuid,
      (v_package->>'package_version')::bigint,v_package->>'package_hash',
      (v_package#>>'{validation_receipt,receipt_id}')::uuid,v_package#>>'{validation_receipt,receipt_hash}',
      (v_package#>>'{preview_binding,preview_id}')::uuid,v_package#>>'{preview_binding,preview_hash}',
      (v_package#>>'{preview_binding,projection_id}')::uuid,v_package#>>'{preview_binding,projection_hash}',v_package);
    v_package_receipt_id:=extensions.gen_random_uuid();
    v_package_receipt:=pg_catalog.jsonb_build_object(
      'schema_version','semantic-package-admission-receipt@1.0.0','receipt_id',v_package_receipt_id,
      'scope',v_scope,'semantic_domain',p_command->>'semantic_domain',
      'release_set_ref',pg_catalog.jsonb_build_object('release_set_id',v_release_set->>'release_set_id','release_set_hash',v_release_set->>'release_set_hash'),
      'package',v_package,'admission','ADMITTED','admitted_at',v_release_set->>'published_at'
    );
    v_package_receipt:=v_package_receipt||pg_catalog.jsonb_build_object('receipt_hash',app_data_agent.u2_canonical_sha256(v_package_receipt));
    insert into semantic.semantic_package_admission_receipts values (
      v_pointer.app_id,v_pointer.tenant_id,v_pointer.environment,v_pointer.semantic_domain,v_package_receipt_id,
      (v_release_set->>'release_set_id')::uuid,(v_package->>'package_id')::uuid,(v_package->>'package_version')::bigint,
      v_package->>'package_hash',v_package_receipt,v_package_receipt->>'receipt_hash',(v_release_set->>'published_at')::timestamptz
    );
    v_package_admissions:=v_package_admissions||pg_catalog.jsonb_build_array(v_package_receipt);
    v_package_refs:=v_package_refs||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'receipt_id',v_package_receipt_id,'receipt_hash',v_package_receipt->>'receipt_hash','package_id',v_package->>'package_id',
      'package_version',(v_package->>'package_version')::bigint,'package_hash',v_package->>'package_hash'
    ));
  end loop;
  v_first_receipt:=pg_catalog.jsonb_build_object(
    'schema_version','first-release-admission-receipt@1.0.0','receipt_id',v_first_receipt_id,'scope',v_scope,
    'semantic_domain',p_command->>'semantic_domain','approval_mode','SYSTEM_BOOTSTRAP_POLICY',
    'release_set_ref',pg_catalog.jsonb_build_object('release_set_id',v_release_set->>'release_set_id','release_set_hash',v_release_set->>'release_set_hash'),
    'policy_ref',p_command->'policy_ref','verified_domain_ref',p_command->'verified_domain_ref',
    'validation_ref',p_command->'validation_ref','grant_ref',p_command->'grant_ref',
    'package_admissions',v_package_refs,'decision_set_digest',v_release_set->>'release_set_hash',
    'admitted_at',v_release_set->>'published_at'
  );
  v_first_receipt:=v_first_receipt||pg_catalog.jsonb_build_object('receipt_hash',app_data_agent.u2_canonical_sha256(v_first_receipt));
  insert into semantic.first_release_admission_receipts values (
    v_pointer.app_id,v_pointer.tenant_id,v_pointer.environment,v_pointer.semantic_domain,v_first_receipt_id,
    (v_release_set->>'release_set_id')::uuid,v_first_receipt,v_first_receipt->>'receipt_hash',
    v_release_set->>'release_set_hash',(v_release_set->>'published_at')::timestamptz
  );
  v_tombstone:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-bootstrap-capability-tombstone@1.0.0','tombstone_id',v_tombstone_id,
    'scope',v_scope,'semantic_domain',p_command->>'semantic_domain',
    'release_set_ref',pg_catalog.jsonb_build_object('release_set_id',v_release_set->>'release_set_id','release_set_hash',v_release_set->>'release_set_hash'),
    'first_release_receipt_ref',pg_catalog.jsonb_build_object('receipt_id',v_first_receipt_id,'receipt_hash',v_first_receipt->>'receipt_hash'),
    'consumed_grant_ref',p_command->'grant_ref','closed_at',v_release_set->>'published_at'
  );
  v_tombstone:=v_tombstone||pg_catalog.jsonb_build_object('tombstone_hash',app_data_agent.u2_canonical_sha256(v_tombstone));
  insert into semantic.semantic_bootstrap_capability_tombstones values (
    v_pointer.app_id,v_pointer.tenant_id,v_pointer.environment,v_pointer.semantic_domain,v_tombstone_id,
    (v_release_set->>'release_set_id')::uuid,v_grant.grant_id,v_tombstone,v_tombstone->>'tombstone_hash',
    (v_release_set->>'published_at')::timestamptz
  );
  update semantic.semantic_bootstrap_publisher_grants as publisher_grant
  set grant_status='CONSUMED',consumed_at=v_now
  where publisher_grant.app_id=v_grant.app_id and publisher_grant.tenant_id=v_grant.tenant_id
    and publisher_grant.environment=v_grant.environment
    and publisher_grant.semantic_domain=v_grant.semantic_domain
    and publisher_grant.grant_id=v_grant.grant_id;
  update semantic.semantic_active_pointer as pointer set current_release_id=(v_release_set->>'release_id')::uuid,
    current_release_generation=1,current_release_digest=v_release_set->>'release_set_hash',
    pointer_generation=pointer.pointer_generation+1,updated_at=v_now,updated_by=v_principal_id::text
  where pointer.app_id=v_pointer.app_id and pointer.tenant_id=v_pointer.tenant_id and pointer.environment=v_pointer.environment
    and pointer.semantic_domain=v_pointer.semantic_domain;
  update semantic.semantic_runtime_activation as activation set runtime_mode='PUBLISHED_ONLY',
    current_release_id=(v_release_set->>'release_id')::uuid,current_release_generation=1,
    activation_generation=activation.activation_generation+1,updated_at=v_now
  where activation.app_id=v_pointer.app_id and activation.tenant_id=v_pointer.tenant_id
    and activation.environment=v_pointer.environment and activation.semantic_domain=v_pointer.semantic_domain;
  update semantic.semantic_publish_attempt as attempt set committed_release_ref=(v_release_set->>'release_id')::uuid
  where attempt.app_id=v_pointer.app_id and attempt.tenant_id=v_pointer.tenant_id and attempt.environment=v_pointer.environment
    and attempt.semantic_domain=v_pointer.semantic_domain and attempt.attempt_id=v_attempt_id;
  update semantic.semantic_candidate as candidate set candidate_status='PUBLISHED',updated_at=v_now
  where candidate.app_id=v_pointer.app_id and candidate.tenant_id=v_pointer.tenant_id and candidate.environment=v_pointer.environment
    and candidate.semantic_domain=v_pointer.semantic_domain and candidate.candidate_id=v_candidate.candidate_id;
  insert into semantic.semantic_bootstrap_outbox values (
    v_pointer.app_id,v_pointer.tenant_id,v_pointer.environment,v_pointer.semantic_domain,extensions.gen_random_uuid(),
    (v_release_set->>'release_set_id')::uuid,'semantic.initial_release.published',
    pg_catalog.jsonb_build_object('release_set_ref',pg_catalog.jsonb_build_object('release_set_id',v_release_set->>'release_set_id','release_set_hash',v_release_set->>'release_set_hash')),
    app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object('release_set_id',v_release_set->>'release_set_id','release_set_hash',v_release_set->>'release_set_hash')),v_now
  );
  insert into app_data_agent.audit_log (
    app_id,tenant_id,environment,audit_id,principal_id,action,resource_type,resource_id,details
  ) values (v_pointer.app_id,v_pointer.tenant_id,v_pointer.environment,extensions.gen_random_uuid(),v_principal_id,
    'SEMANTIC_INITIAL_RELEASE_PUBLISHED','semantic_release_set',v_release_set->>'release_set_id',
    pg_catalog.jsonb_build_object('release_set_hash',v_release_set->>'release_set_hash'));
  v_result:=pg_catalog.jsonb_build_object(
    'schema_version','publish-initial-semantic-release-result@1.0.0','disposition','CREATED',
    'request_hash',v_request_hash,'release_set',v_release_set,'package_admissions',v_package_admissions,
    'first_release_receipt',v_first_receipt,'tombstone',v_tombstone
  );
  insert into semantic.semantic_bootstrap_publish_idempotency values (
    v_pointer.app_id,v_pointer.tenant_id,v_pointer.environment,v_pointer.semantic_domain,v_principal_id,
    p_command->>'idempotency_key',v_request_hash,v_result,v_now
  );
  return v_result;
end
$function$;

create function semantic.load_initial_semantic_release_set(p_command jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_scope jsonb; v_set semantic.initial_semantic_release_sets%rowtype; v_first jsonb; v_tombstone jsonb; v_packages jsonb;
begin
  if p_command is null or not semantic.u5_json_has_exact_keys(p_command,array[
    'schema_version','scope','semantic_domain','release_set_ref'
  ]::text[]) or p_command->>'schema_version'<>'load-initial-semantic-release-command@1.0.0'
  then raise exception using errcode='22023',message='SEMANTIC_BOOTSTRAP_LOAD_INVALID'; end if;
  v_scope:=p_command->'scope'; perform semantic.assert_u5_scope(v_scope,p_command->>'semantic_domain',false);
  select release_set.* into v_set from semantic.initial_semantic_release_sets as release_set
  where release_set.app_id=(v_scope->>'app_id')::uuid and release_set.tenant_id=(v_scope->>'tenant_id')::uuid
    and release_set.environment=v_scope->>'environment' and release_set.semantic_domain=p_command->>'semantic_domain'
    and release_set.release_set_id=(p_command#>>'{release_set_ref,release_set_id}')::uuid
    and release_set.release_set_hash=p_command#>>'{release_set_ref,release_set_hash}';
  if not found then raise exception using errcode='P0002',message='SEMANTIC_BOOTSTRAP_RELEASE_NOT_FOUND'; end if;
  select pg_catalog.jsonb_agg(receipt.receipt_json order by receipt.package_id,receipt.package_version)
  into v_packages from semantic.semantic_package_admission_receipts as receipt
  where receipt.app_id=v_set.app_id and receipt.tenant_id=v_set.tenant_id and receipt.environment=v_set.environment
    and receipt.semantic_domain=v_set.semantic_domain and receipt.release_set_id=v_set.release_set_id;
  select receipt.receipt_json into strict v_first from semantic.first_release_admission_receipts as receipt
  where receipt.app_id=v_set.app_id and receipt.tenant_id=v_set.tenant_id and receipt.environment=v_set.environment
    and receipt.semantic_domain=v_set.semantic_domain and receipt.release_set_id=v_set.release_set_id;
  select tombstone.tombstone_json into strict v_tombstone from semantic.semantic_bootstrap_capability_tombstones as tombstone
  where tombstone.app_id=v_set.app_id and tombstone.tenant_id=v_set.tenant_id and tombstone.environment=v_set.environment
    and tombstone.semantic_domain=v_set.semantic_domain and tombstone.release_set_id=v_set.release_set_id;
  return pg_catalog.jsonb_build_object(
    'schema_version','load-initial-semantic-release-result@1.0.0','release_set',v_set.release_set_json,
    'package_admissions',v_packages,'first_release_receipt',v_first,'tombstone',v_tombstone
  );
end
$function$;
