-- ============================================================
-- Signer activation, policy, verified genesis, grant and validation RPCs.
-- ============================================================

create function semantic.register_semantic_bootstrap_signer_key(p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare v_key jsonb; v_scope jsonb;
begin
  if p_command is null or not semantic.u5_json_has_exact_keys(
    p_command,array['schema_version','scope','semantic_domain','key']::text[]
  ) or p_command->>'schema_version'<>'semantic-bootstrap-signer-key-register@1.0.0'
  then raise exception using errcode='22023',message='SEMANTIC_BOOTSTRAP_SIGNER_KEY_COMMAND_INVALID'; end if;
  v_scope:=p_command->'scope'; v_key:=p_command->'key';
  perform semantic.assert_u5_scope(v_scope,p_command->>'semantic_domain',true);
  if not semantic.u5_json_has_exact_keys(v_key,array[
    'key_id','key_revision','principal_id','role','purpose','algorithm','public_material','public_material_hash','revocation_epoch'
  ]::text[]) or v_key->>'algorithm'<>'Ed25519'
    or v_key->>'public_material_hash'<>app_data_agent.u2_canonical_sha256(v_key->'public_material')
    or (v_key->>'role'='WORKSPACE_ADMIN' and v_key->>'purpose'<>'SEMANTIC_BOOTSTRAP_ADMIN_SIGNATURE')
    or (v_key->>'role'='PLATFORM_ATTESTOR' and v_key->>'purpose'<>'PLATFORM_ATTESTATION')
  then raise exception using errcode='22023',message='SEMANTIC_BOOTSTRAP_SIGNER_KEY_INVALID'; end if;
  insert into semantic.semantic_bootstrap_signer_key_revisions (
    app_id,tenant_id,environment,semantic_domain,key_id,key_revision,principal_id,
    signer_role,key_purpose,public_material,public_material_hash,revocation_epoch
  ) values (
    (v_scope->>'app_id')::uuid,(v_scope->>'tenant_id')::uuid,v_scope->>'environment',
    p_command->>'semantic_domain',v_key->>'key_id',(v_key->>'key_revision')::bigint,
    (v_key->>'principal_id')::uuid,v_key->>'role',v_key->>'purpose',v_key->'public_material',
    v_key->>'public_material_hash',(v_key->>'revocation_epoch')::bigint
  ) on conflict do nothing;
  return pg_catalog.jsonb_build_object(
    'key_id',v_key->>'key_id','key_revision',(v_key->>'key_revision')::bigint,
    'status','STAGED','public_material_hash',v_key->>'public_material_hash'
  );
end
$function$;

create function semantic.activate_semantic_bootstrap_signer_key(p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare v_scope jsonb; v_receipt jsonb; v_expected_hash text; v_key semantic.semantic_bootstrap_signer_key_revisions%rowtype;
begin
  if p_command is null or not semantic.u5_json_has_exact_keys(p_command,array[
    'schema_version','scope','semantic_domain','activation_id','key_id','key_revision',
    'challenge_hash','proof_signature_hash','activated_at','receipt_hash'
  ]::text[]) or p_command->>'schema_version'<>'semantic-bootstrap-signer-activation@1.0.0'
  then raise exception using errcode='22023',message='SEMANTIC_BOOTSTRAP_SIGNER_ACTIVATION_INVALID'; end if;
  v_scope:=p_command->'scope'; perform semantic.assert_u5_scope(v_scope,p_command->>'semantic_domain',true);
  v_expected_hash:=app_data_agent.u2_canonical_sha256(p_command-'receipt_hash');
  if p_command->>'receipt_hash'<>v_expected_hash then
    raise exception using errcode='22023',message='SEMANTIC_BOOTSTRAP_SIGNER_ACTIVATION_HASH_INVALID';
  end if;
  select key.* into v_key from semantic.semantic_bootstrap_signer_key_revisions as key
  where key.app_id=(v_scope->>'app_id')::uuid and key.tenant_id=(v_scope->>'tenant_id')::uuid
    and key.environment=v_scope->>'environment' and key.semantic_domain=p_command->>'semantic_domain'
    and key.key_id=p_command->>'key_id' and key.key_revision=(p_command->>'key_revision')::bigint
  for update;
  if not found or v_key.key_status<>'STAGED' then
    raise exception using errcode='P0001',message='SEMANTIC_BOOTSTRAP_KEY_NOT_STAGED';
  end if;
  insert into semantic.semantic_bootstrap_signer_activations (
    app_id,tenant_id,environment,semantic_domain,activation_id,key_id,key_revision,
    challenge_hash,proof_signature_hash,receipt_hash,activated_at
  ) values (
    v_key.app_id,v_key.tenant_id,v_key.environment,v_key.semantic_domain,
    (p_command->>'activation_id')::uuid,v_key.key_id,v_key.key_revision,
    p_command->>'challenge_hash',p_command->>'proof_signature_hash',v_expected_hash,
    (p_command->>'activated_at')::timestamptz
  );
  update semantic.semantic_bootstrap_signer_key_revisions as key set
    key_status='ACTIVE',activation_receipt_hash=v_expected_hash
  where key.app_id=v_key.app_id and key.tenant_id=v_key.tenant_id and key.environment=v_key.environment
    and key.semantic_domain=v_key.semantic_domain and key.key_id=v_key.key_id and key.key_revision=v_key.key_revision;
  v_receipt:=p_command;
  return v_receipt;
end
$function$;

create function semantic.commit_semantic_bootstrap_policy(p_policy jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare v_scope jsonb;
begin
  if p_policy is null or not semantic.u5_json_has_exact_keys(p_policy,array[
    'schema_version','policy_id','policy_revision','scope','semantic_domain','mandatory_manifest',
    'coverage_policy','lowerability_policy','source_boundary','valid_from','valid_until','policy_hash'
  ]::text[]) or p_policy->>'schema_version'<>'semantic-bootstrap-policy-view@1.0.0'
    or p_policy->>'policy_hash'<>app_data_agent.u2_canonical_sha256(p_policy-'policy_hash')
  then raise exception using errcode='22023',message='SEMANTIC_BOOTSTRAP_POLICY_INVALID'; end if;
  v_scope:=p_policy->'scope'; perform semantic.assert_u5_scope(v_scope,p_policy->>'semantic_domain',true);
  insert into semantic.semantic_bootstrap_policy_revisions (
    app_id,tenant_id,environment,semantic_domain,policy_id,policy_revision,policy_json,
    policy_hash,valid_from,valid_until
  ) values (
    (v_scope->>'app_id')::uuid,(v_scope->>'tenant_id')::uuid,v_scope->>'environment',
    p_policy->>'semantic_domain',(p_policy->>'policy_id')::uuid,(p_policy->>'policy_revision')::bigint,
    p_policy,p_policy->>'policy_hash',(p_policy->>'valid_from')::timestamptz,(p_policy->>'valid_until')::timestamptz
  ) on conflict do nothing;
  insert into semantic.semantic_bootstrap_policy_pointer (
    app_id,tenant_id,environment,semantic_domain,policy_id,policy_revision,policy_hash
  ) values (
    (v_scope->>'app_id')::uuid,(v_scope->>'tenant_id')::uuid,v_scope->>'environment',
    p_policy->>'semantic_domain',(p_policy->>'policy_id')::uuid,(p_policy->>'policy_revision')::bigint,
    p_policy->>'policy_hash'
  ) on conflict (app_id,tenant_id,environment,semantic_domain) do update set
    policy_id=excluded.policy_id,policy_revision=excluded.policy_revision,policy_hash=excluded.policy_hash,
    updated_at=pg_catalog.clock_timestamp()
  where semantic.semantic_bootstrap_policy_pointer.policy_revision < excluded.policy_revision;
  return p_policy;
end
$function$;

create function semantic.load_semantic_bootstrap_signer_context(p_packet jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare v_scope jsonb; v_admin jsonb; v_attestor jsonb;
begin
  if p_packet is null or not semantic.u5_json_has_exact_keys(p_packet,array[
    'schema_version','packet_id','scope','semantic_domain','datasource_id','audience','candidate_set_root',
    'release_set_id','policy_ref','nonce_hash','issued_at','expires_at','packet_digest'
  ]::text[]) or p_packet->>'schema_version'<>'semantic-domain-bootstrap-packet@1.0.0'
    or p_packet->>'packet_digest'<>app_data_agent.u2_canonical_sha256(p_packet-'packet_digest')
  then raise exception using errcode='22023',message='SEMANTIC_BOOTSTRAP_PACKET_INVALID'; end if;
  v_scope:=p_packet->'scope'; perform semantic.assert_u5_scope(v_scope,p_packet->>'semantic_domain',false);
  select pg_catalog.jsonb_build_object(
    'principal_id',key.principal_id,'key_id',key.key_id,'key_revision',key.key_revision,
    'role',key.signer_role,'purpose',key.key_purpose,'status',key.key_status,
    'public_material',key.public_material,'public_material_hash',key.public_material_hash,
    'activation_receipt_hash',key.activation_receipt_hash
  ) into v_admin from semantic.semantic_bootstrap_signer_key_revisions as key
  where key.app_id=(v_scope->>'app_id')::uuid and key.tenant_id=(v_scope->>'tenant_id')::uuid
    and key.environment=v_scope->>'environment' and key.semantic_domain=p_packet->>'semantic_domain'
    and key.signer_role='WORKSPACE_ADMIN' and key.key_status='ACTIVE'
  order by key.key_revision desc limit 1;
  select pg_catalog.jsonb_build_object(
    'principal_id',key.principal_id,'key_id',key.key_id,'key_revision',key.key_revision,
    'role',key.signer_role,'purpose',key.key_purpose,'status',key.key_status,
    'public_material',key.public_material,'public_material_hash',key.public_material_hash,
    'activation_receipt_hash',key.activation_receipt_hash
  ) into v_attestor from semantic.semantic_bootstrap_signer_key_revisions as key
  where key.app_id=(v_scope->>'app_id')::uuid and key.tenant_id=(v_scope->>'tenant_id')::uuid
    and key.environment=v_scope->>'environment' and key.semantic_domain=p_packet->>'semantic_domain'
    and key.signer_role='PLATFORM_ATTESTOR' and key.key_status='ACTIVE'
  order by key.key_revision desc limit 1;
  if v_admin is null or v_attestor is null then
    raise exception using errcode='P0001',message='SEMANTIC_BOOTSTRAP_KEY_NOT_ACTIVE';
  end if;
  return pg_catalog.jsonb_build_object('workspace_admin',v_admin,'platform_attestor',v_attestor);
end
$function$;

create function semantic.commit_verified_semantic_domain_bootstrap(p_commit jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_packet jsonb; v_scope jsonb; v_admin jsonb; v_attestor jsonb; v_policy record;
  v_receipt jsonb; v_receipt_id uuid:=extensions.gen_random_uuid(); v_verified_at timestamptz:=pg_catalog.clock_timestamp();
begin
  if p_commit is null or not semantic.u5_json_has_exact_keys(
    p_commit,array['packet','workspace_admin','platform_attestor']::text[]
  ) or not semantic.u5_json_has_exact_keys(p_commit->'packet',array[
    'schema_version','packet_id','scope','semantic_domain','datasource_id','audience',
    'candidate_set_root','release_set_id','policy_ref','nonce_hash','issued_at','expires_at','packet_digest'
  ]::text[])
    or not semantic.u5_json_has_exact_keys(p_commit->'workspace_admin',array[
      'principal_id','key_id','key_revision','public_material_hash','activation_receipt_hash','signature_hash'
    ]::text[])
    or not semantic.u5_json_has_exact_keys(p_commit->'platform_attestor',array[
      'principal_id','key_id','key_revision','public_material_hash','activation_receipt_hash','signature_hash'
    ]::text[])
  then raise exception using errcode='22023',message='SEMANTIC_BOOTSTRAP_VERIFIED_COMMIT_INVALID'; end if;
  v_packet:=p_commit->'packet'; v_admin:=p_commit->'workspace_admin'; v_attestor:=p_commit->'platform_attestor';
  v_scope:=v_packet->'scope'; perform semantic.assert_u5_scope(v_scope,v_packet->>'semantic_domain',true);
  if v_packet->>'packet_digest'<>app_data_agent.u2_canonical_sha256(v_packet-'packet_digest')
    or v_packet->>'audience'<>'SEMANTIC_BOOTSTRAP_VERIFIER'
    or (v_packet->>'issued_at')::timestamptz>v_verified_at
    or (v_packet->>'expires_at')::timestamptz<=v_verified_at
    or v_admin->>'principal_id'=v_attestor->>'principal_id'
    or v_admin->>'key_id'=v_attestor->>'key_id'
    or v_admin->>'public_material_hash'=v_attestor->>'public_material_hash'
  then raise exception using errcode='22023',message='SEMANTIC_BOOTSTRAP_VERIFIED_COMMIT_INVALID'; end if;
  perform 1 from semantic.semantic_bootstrap_signer_key_revisions as key
  where key.app_id=(v_scope->>'app_id')::uuid and key.tenant_id=(v_scope->>'tenant_id')::uuid
    and key.environment=v_scope->>'environment' and key.semantic_domain=v_packet->>'semantic_domain'
    and key.key_id=v_admin->>'key_id' and key.key_revision=(v_admin->>'key_revision')::bigint
    and key.principal_id=(v_admin->>'principal_id')::uuid and key.signer_role='WORKSPACE_ADMIN'
    and key.key_status='ACTIVE' and key.public_material_hash=v_admin->>'public_material_hash'
    and key.activation_receipt_hash=v_admin->>'activation_receipt_hash' for update;
  if not found then raise exception using errcode='P0001',message='SEMANTIC_BOOTSTRAP_KEY_NOT_ACTIVE'; end if;
  perform 1 from semantic.semantic_bootstrap_signer_key_revisions as key
  where key.app_id=(v_scope->>'app_id')::uuid and key.tenant_id=(v_scope->>'tenant_id')::uuid
    and key.environment=v_scope->>'environment' and key.semantic_domain=v_packet->>'semantic_domain'
    and key.key_id=v_attestor->>'key_id' and key.key_revision=(v_attestor->>'key_revision')::bigint
    and key.principal_id=(v_attestor->>'principal_id')::uuid and key.signer_role='PLATFORM_ATTESTOR'
    and key.key_status='ACTIVE' and key.public_material_hash=v_attestor->>'public_material_hash'
    and key.activation_receipt_hash=v_attestor->>'activation_receipt_hash' for update;
  if not found then raise exception using errcode='P0001',message='SEMANTIC_BOOTSTRAP_KEY_NOT_ACTIVE'; end if;
  select pointer.* into v_policy from semantic.semantic_bootstrap_policy_pointer as pointer
  where pointer.app_id=(v_scope->>'app_id')::uuid and pointer.tenant_id=(v_scope->>'tenant_id')::uuid
    and pointer.environment=v_scope->>'environment' and pointer.semantic_domain=v_packet->>'semantic_domain'
    and pointer.policy_id=(v_packet#>>'{policy_ref,policy_id}')::uuid
    and pointer.policy_revision=(v_packet#>>'{policy_ref,policy_revision}')::bigint
    and pointer.policy_hash=v_packet#>>'{policy_ref,policy_hash}' for update;
  if not found then raise exception using errcode='P0001',message='SEMANTIC_BOOTSTRAP_POLICY_STALE'; end if;
  v_receipt:=pg_catalog.jsonb_build_object(
    'schema_version','verified-domain-bootstrap-receipt@1.0.0','receipt_id',v_receipt_id,
    'scope',v_scope,'semantic_domain',v_packet->>'semantic_domain','datasource_id',v_packet->>'datasource_id',
    'packet_digest',v_packet->>'packet_digest','candidate_set_root',v_packet->'candidate_set_root',
    'release_set_id',v_packet->>'release_set_id','policy_ref',v_packet->'policy_ref',
    'workspace_admin',v_admin,'platform_attestor',v_attestor,'nonce_hash',v_packet->>'nonce_hash',
    'issued_at',v_packet->>'issued_at','expires_at',v_packet->>'expires_at','verified_at',v_verified_at
  );
  v_receipt:=v_receipt||pg_catalog.jsonb_build_object('receipt_hash',app_data_agent.u2_canonical_sha256(v_receipt));
  insert into semantic.verified_semantic_domain_bootstrap_receipts (
    app_id,tenant_id,environment,semantic_domain,receipt_id,datasource_id,packet_id,packet_digest,
    release_set_id,candidate_id,candidate_revision_id,candidate_set_hash,policy_id,policy_revision,
    policy_hash,nonce_hash,receipt_json,receipt_hash,verified_at
  ) values (
    (v_scope->>'app_id')::uuid,(v_scope->>'tenant_id')::uuid,v_scope->>'environment',v_packet->>'semantic_domain',
    v_receipt_id,(v_packet->>'datasource_id')::uuid,(v_packet->>'packet_id')::uuid,v_packet->>'packet_digest',
    (v_packet->>'release_set_id')::uuid,(v_packet#>>'{candidate_set_root,candidate_id}')::uuid,
    (v_packet#>>'{candidate_set_root,revision_id}')::uuid,v_packet#>>'{candidate_set_root,candidate_set_hash}',
    (v_packet#>>'{policy_ref,policy_id}')::uuid,(v_packet#>>'{policy_ref,policy_revision}')::bigint,
    v_packet#>>'{policy_ref,policy_hash}',v_packet->>'nonce_hash',v_receipt,v_receipt->>'receipt_hash',v_verified_at
  );
  insert into semantic.semantic_domain_registry (
    app_id,tenant_id,environment,semantic_domain,datasource_id,domain_display_name,created_by
  ) values (
    (v_scope->>'app_id')::uuid,(v_scope->>'tenant_id')::uuid,v_scope->>'environment',
    v_packet->>'semantic_domain',(v_packet->>'datasource_id')::uuid,v_packet->>'semantic_domain',
    v_admin->>'principal_id'
  );
  insert into semantic.semantic_authority_fence (app_id,tenant_id,environment,last_fence_update_by)
  values ((v_scope->>'app_id')::uuid,(v_scope->>'tenant_id')::uuid,v_scope->>'environment','u5-verifier')
  on conflict do nothing;
  insert into semantic.semantic_active_pointer (
    app_id,tenant_id,environment,semantic_domain,current_release_generation,updated_by
  ) values ((v_scope->>'app_id')::uuid,(v_scope->>'tenant_id')::uuid,v_scope->>'environment',v_packet->>'semantic_domain',0,'u5-verifier');
  insert into semantic.semantic_runtime_activation (
    app_id,tenant_id,environment,semantic_domain,runtime_mode,activation_generation,current_release_generation
  ) values ((v_scope->>'app_id')::uuid,(v_scope->>'tenant_id')::uuid,v_scope->>'environment',v_packet->>'semantic_domain','LEGACY',1,0);
  return v_receipt;
end
$function$;

create function semantic.create_semantic_bootstrap_publisher_grant(p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare v_scope jsonb; v_existing record; v_request_hash text; v_grant_id uuid; v_grant_hash text;
begin
  if p_command is null or not semantic.u5_json_has_exact_keys(p_command,array[
    'schema_version','command_id','idempotency_key','scope','semantic_domain','issuer',
    'operator_principal_id','audience','release_set_id','candidate_set_hash','policy_ref',
    'revocation_epoch','issued_at','expires_at'
  ]::text[]) or p_command->>'schema_version'<>'semantic-publisher-grant-create-command@1.0.0'
    or p_command->>'audience'<>'SEMANTIC_BOOTSTRAP_PUBLISHER'
    or (p_command#>>'{issuer,principal_id}')::uuid is distinct from
      nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid
    or (p_command->>'issued_at')::timestamptz>pg_catalog.clock_timestamp()
    or (p_command->>'expires_at')::timestamptz<=pg_catalog.clock_timestamp()
  then raise exception using errcode='22023',message='SEMANTIC_PUBLISHER_GRANT_COMMAND_INVALID'; end if;
  v_scope:=p_command->'scope'; perform semantic.assert_u5_scope(v_scope,p_command->>'semantic_domain',true);
  v_request_hash:=app_data_agent.u2_canonical_sha256(p_command);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    (v_scope->>'app_id')||':'||(v_scope->>'tenant_id')||':'||(v_scope->>'environment')||':'||
    (p_command#>>'{issuer,principal_id}')||':'||(p_command->>'idempotency_key'),0
  ));
  select publisher_grant.* into v_existing
  from semantic.semantic_bootstrap_publisher_grants as publisher_grant
  where publisher_grant.app_id=(v_scope->>'app_id')::uuid
    and publisher_grant.tenant_id=(v_scope->>'tenant_id')::uuid
    and publisher_grant.environment=v_scope->>'environment'
    and publisher_grant.semantic_domain=p_command->>'semantic_domain'
    and publisher_grant.issuer_principal_id=(p_command#>>'{issuer,principal_id}')::uuid
    and publisher_grant.idempotency_key=p_command->>'idempotency_key';
  if found then
    if v_existing.request_hash<>v_request_hash then raise exception using errcode='23505',message='SEMANTIC_PUBLISHER_GRANT_IDEMPOTENCY_CONFLICT'; end if;
    return pg_catalog.jsonb_build_object(
      'schema_version','semantic-publisher-grant-create-result@1.0.0',
      'grant_ref',pg_catalog.jsonb_build_object('grant_id',v_existing.grant_id,'grant_hash',v_existing.grant_hash),
      'request_hash',v_existing.request_hash,'disposition','REPLAYED'
    );
  end if;
  perform 1 from semantic.semantic_bootstrap_signer_key_revisions as key
  where key.app_id=(v_scope->>'app_id')::uuid and key.tenant_id=(v_scope->>'tenant_id')::uuid
    and key.environment=v_scope->>'environment' and key.semantic_domain=p_command->>'semantic_domain'
    and key.key_id=p_command#>>'{issuer,key_id}' and key.key_revision=(p_command#>>'{issuer,key_revision}')::bigint
    and key.principal_id=(p_command#>>'{issuer,principal_id}')::uuid and key.signer_role='WORKSPACE_ADMIN'
    and key.key_status='ACTIVE' and key.revocation_epoch=(p_command->>'revocation_epoch')::bigint;
  if not found then raise exception using errcode='P0001',message='SEMANTIC_PUBLISHER_GRANT_KEY_NOT_ACTIVE'; end if;
  perform 1 from semantic.semantic_bootstrap_policy_pointer as pointer
  where pointer.app_id=(v_scope->>'app_id')::uuid and pointer.tenant_id=(v_scope->>'tenant_id')::uuid
    and pointer.environment=v_scope->>'environment' and pointer.semantic_domain=p_command->>'semantic_domain'
    and pointer.policy_hash=p_command#>>'{policy_ref,policy_hash}';
  if not found then raise exception using errcode='P0001',message='SEMANTIC_PUBLISHER_GRANT_POLICY_STALE'; end if;
  v_grant_id:=extensions.gen_random_uuid();
  v_grant_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'schema_version','semantic-publisher-grant-reference@1.0.0','grant_id',v_grant_id,'request_hash',v_request_hash
  ));
  insert into semantic.semantic_bootstrap_publisher_grants (
    app_id,tenant_id,environment,semantic_domain,grant_id,grant_hash,request_hash,idempotency_key,
    grant_nonce,command_json,issuer_principal_id,operator_principal_id,release_set_id,candidate_set_hash,
    policy_id,policy_revision,policy_hash,revocation_epoch,issued_at,expires_at
  ) values (
    (v_scope->>'app_id')::uuid,(v_scope->>'tenant_id')::uuid,v_scope->>'environment',p_command->>'semantic_domain',
    v_grant_id,v_grant_hash,v_request_hash,p_command->>'idempotency_key',extensions.gen_random_uuid(),p_command,
    (p_command#>>'{issuer,principal_id}')::uuid,(p_command->>'operator_principal_id')::uuid,
    (p_command->>'release_set_id')::uuid,p_command->>'candidate_set_hash',
    (p_command#>>'{policy_ref,policy_id}')::uuid,(p_command#>>'{policy_ref,policy_revision}')::bigint,
    p_command#>>'{policy_ref,policy_hash}',(p_command->>'revocation_epoch')::bigint,
    (p_command->>'issued_at')::timestamptz,(p_command->>'expires_at')::timestamptz
  );
  return pg_catalog.jsonb_build_object(
    'schema_version','semantic-publisher-grant-create-result@1.0.0',
    'grant_ref',pg_catalog.jsonb_build_object('grant_id',v_grant_id,'grant_hash',v_grant_hash),
    'request_hash',v_request_hash,'disposition','CREATED'
  );
end
$function$;

create function semantic.commit_semantic_bootstrap_validation(p_receipt jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare v_scope jsonb; v_package jsonb;
begin
  if p_receipt is null or not semantic.u5_json_has_exact_keys(p_receipt,array[
    'schema_version','receipt_id','scope','semantic_domain','candidate_set_root','policy_ref',
    'schema_snapshot','source_bundle','packages','outcome','validator_version','validated_at','receipt_hash'
  ]::text[]) or p_receipt->>'schema_version'<>'semantic-bootstrap-validation-receipt@1.0.0'
    or p_receipt->>'outcome'<>'PASS'
    or p_receipt->>'receipt_hash'<>app_data_agent.u2_canonical_sha256(p_receipt-'receipt_hash')
    or pg_catalog.jsonb_typeof(p_receipt->'packages')<>'array'
    or pg_catalog.jsonb_array_length(p_receipt->'packages')=0
    or p_receipt->'packages' <> (
      select pg_catalog.jsonb_agg(package_entry.value order by
        package_entry.value->>'namespace_id',package_entry.value->>'package_id',
        (package_entry.value->>'package_version')::bigint,package_entry.value->>'package_hash')
      from pg_catalog.jsonb_array_elements(p_receipt->'packages') as package_entry(value)
    )
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_receipt->'packages') as package_entry(value)
      group by package_entry.value->>'package_id',(package_entry.value->>'package_version')::bigint
      having pg_catalog.count(*)<>1
    )
  then raise exception using errcode='22023',message='SEMANTIC_BOOTSTRAP_VALIDATION_INVALID'; end if;
  v_scope:=p_receipt->'scope'; perform semantic.assert_u5_scope(v_scope,p_receipt->>'semantic_domain',true);
  for v_package in select value from pg_catalog.jsonb_array_elements(p_receipt->'packages') loop
    if not semantic.u5_json_has_exact_keys(v_package,array[
      'namespace_id','package_id','package_version','package_hash','candidate_revision',
      'validation_receipt','preview_binding','mandatory','gates'
    ]::text[])
      or not semantic.u5_json_has_exact_keys(v_package->'candidate_revision',array[
        'candidate_id','revision_id','revision','revision_digest','candidate_set_hash'
      ]::text[])
      or not semantic.u5_json_has_exact_keys(v_package->'validation_receipt',array[
        'receipt_id','receipt_hash'
      ]::text[])
      or not semantic.u5_json_has_exact_keys(v_package->'preview_binding',array[
        'preview_id','preview_hash','projection_id','projection_hash'
      ]::text[])
      or not semantic.u5_json_has_exact_keys(v_package->'gates',array[
        'coverage','lowerability','source_boundary','mapping_evidence','join_evidence',
        'formula_compiler','query_dry_run'
      ]::text[])
      or exists (
        select 1 from pg_catalog.jsonb_each_text(v_package->'gates') as gate
        where gate.value<>'PASS'
      )
    then
      raise exception using errcode='22023',message='SEMANTIC_BOOTSTRAP_VALIDATION_GATE_FAILED';
    end if;
    perform 1 from semantic.ontology_package_candidates as package
    join semantic.ontology_package_validation_receipts as validation
      on validation.app_id=package.app_id and validation.tenant_id=package.tenant_id
      and validation.environment=package.environment and validation.semantic_domain=package.semantic_domain
      and validation.package_id=package.package_id and validation.package_version=package.package_version
    join semantic.ontology_package_preview_bindings as preview
      on preview.app_id=package.app_id and preview.tenant_id=package.tenant_id
      and preview.environment=package.environment and preview.semantic_domain=package.semantic_domain
      and preview.package_id=package.package_id and preview.package_version=package.package_version
    where package.app_id=(v_scope->>'app_id')::uuid and package.tenant_id=(v_scope->>'tenant_id')::uuid
      and package.environment=v_scope->>'environment' and package.semantic_domain=p_receipt->>'semantic_domain'
      and package.package_id=(v_package->>'package_id')::uuid
      and package.package_version=(v_package->>'package_version')::bigint
      and package.package_hash=v_package->>'package_hash'
      and package.candidate_id=(v_package#>>'{candidate_revision,candidate_id}')::uuid
      and package.revision_id=(v_package#>>'{candidate_revision,revision_id}')::uuid
      and package.revision_digest=v_package#>>'{candidate_revision,revision_digest}'
      and v_package#>>'{candidate_revision,candidate_set_hash}'=
        p_receipt#>>'{candidate_set_root,candidate_set_hash}'
      and validation.receipt_id=(v_package#>>'{validation_receipt,receipt_id}')::uuid
      and validation.receipt_hash=v_package#>>'{validation_receipt,receipt_hash}' and validation.valid
      and preview.preview_id=(v_package#>>'{preview_binding,preview_id}')::uuid
      and preview.preview_hash=v_package#>>'{preview_binding,preview_hash}'
      and preview.projection_id=(v_package#>>'{preview_binding,projection_id}')::uuid
      and preview.projection_storage_digest=v_package#>>'{preview_binding,projection_hash}';
    if not found then raise exception using errcode='P0001',message='SEMANTIC_BOOTSTRAP_VALIDATION_STALE'; end if;
  end loop;
  insert into semantic.semantic_bootstrap_validation_receipts (
    app_id,tenant_id,environment,semantic_domain,receipt_id,candidate_id,candidate_revision_id,
    candidate_set_hash,policy_hash,receipt_json,receipt_hash,validated_at
  ) values (
    (v_scope->>'app_id')::uuid,(v_scope->>'tenant_id')::uuid,v_scope->>'environment',p_receipt->>'semantic_domain',
    (p_receipt->>'receipt_id')::uuid,(p_receipt#>>'{candidate_set_root,candidate_id}')::uuid,
    (p_receipt#>>'{candidate_set_root,revision_id}')::uuid,p_receipt#>>'{candidate_set_root,candidate_set_hash}',
    p_receipt#>>'{policy_ref,policy_hash}',p_receipt,p_receipt->>'receipt_hash',(p_receipt->>'validated_at')::timestamptz
  ) on conflict do nothing;
  return p_receipt;
end
$function$;
