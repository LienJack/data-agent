create function semantic.record_semantic_successor_stage(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record; pointer semantic.semantic_active_pointer%rowtype;
  existing semantic.semantic_successor_release_stage%rowtype;
  stage jsonb; projections jsonb; validation_receipt jsonb; authority_ids jsonb;
  scope_json jsonb; projection_json jsonb; projection_reference jsonb;
  projection_item record; expected_release_digest text; expected_stage_digest text;
  expected_validation_hash text; expected_idempotency_digest text;
  rejection_receipt jsonb; rejection_hash text;
  stage_id_value uuid; status_value text; now_at timestamptz:=pg_catalog.clock_timestamp();
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','command_id','idempotency_key','idempotency_digest','binding_impact_hashes','stage',
      'projections','validation_receipt','authority_ids','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'semantic-successor-stage-record@1.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'command_id') is distinct from true
    or pg_catalog.length(command->>'idempotency_key') not between 1 and 256
    or pg_catalog.btrim(command->>'idempotency_key') is distinct from command->>'idempotency_key'
    or command->>'idempotency_digest'!~'^sha256:[0-9a-f]{64}$'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'stage') is distinct from 'object'
    or pg_catalog.jsonb_typeof(command->'projections') is distinct from 'object'
    or pg_catalog.jsonb_typeof(command->'validation_receipt') is distinct from 'object'
    or pg_catalog.jsonb_typeof(command->'authority_ids') is distinct from 'object'
  then raise exception using errcode='22023',message='SEMANTIC_SUCCESSOR_STAGE_RECORD_INVALID'; end if;
  stage:=command->'stage';projections:=command->'projections';
  validation_receipt:=command->'validation_receipt';authority_ids:=command->'authority_ids';
  scope_json:=stage->'scope';
  expected_idempotency_digest:=app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_object(
      'hash_domain','semantic-successor-stage-record-idempotency@1.0.0',
      'command',command-array['idempotency_digest','command_hash']));
  if app_data_agent.provider_json_object_has_exact_keys(stage,array[
      'schema_version','stage_id','scope','predecessor_release','expected_pointer_version',
      'target_generation','change_set_ref','review_ref','source_snapshot_ref',
      'compiler_bundle_ref','candidate_release','projection_refs','status','stage_digest']::text[])
      is distinct from true
    or stage->>'schema_version' is distinct from 'semantic-successor-stage@1.0.0'
    or app_data_agent.provider_json_object_has_exact_keys(scope_json,array[
      'app_id','tenant_id','environment','semantic_domain']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(stage->'predecessor_release',array[
      'release_id','generation','release_digest']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(stage->'change_set_ref',array[
      'change_set_id','change_set_hash']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(stage->'review_ref',array[
      'review_id','review_hash']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(stage->'source_snapshot_ref',array[
      'snapshot_id','snapshot_revision','snapshot_hash']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(stage->'compiler_bundle_ref',array[
      'compiler_version','compiler_bundle_hash']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(stage->'candidate_release',array[
      'release_id','generation','release_digest','datasource_id']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(stage->'projection_refs',array[
      'executable','relationship','runtime_restriction','graph']::text[]) is distinct from true
    or exists(select 1 from pg_catalog.jsonb_each(stage->'projection_refs') item
      where app_data_agent.provider_json_object_has_exact_keys(item.value,array[
        'projection_id','projection_digest']::text[]) is distinct from true
        or app_data_agent.canonical_uuid_json_string_is_valid(
          item.value->'projection_id') is distinct from true
        or item.value->>'projection_digest'!~'^sha256:[0-9a-f]{64}$')
    or app_data_agent.provider_json_object_has_exact_keys(projections,array[
      'executable','relationship','runtime_restriction','graph']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(authority_ids,array[
      'source_revision_id','candidate_revision_id','publish_attempt_id',
      'review_decision_id','outbox_event_id']::text[]) is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(scope_json->'app_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(scope_json->'tenant_id') is distinct from true
    or pg_catalog.length(scope_json->>'environment') not between 1 and 128
    or pg_catalog.btrim(scope_json->>'environment') is distinct from scope_json->>'environment'
    or pg_catalog.length(scope_json->>'semantic_domain') not between 1 and 128
    or pg_catalog.btrim(scope_json->>'semantic_domain') is distinct from
      scope_json->>'semantic_domain'
    or exists(select 1 from pg_catalog.jsonb_each(authority_ids) item
      where app_data_agent.canonical_uuid_json_string_is_valid(item.value) is distinct from true)
    or app_data_agent.canonical_uuid_json_string_is_valid(stage->'stage_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      stage#>'{predecessor_release,release_id}') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      stage#>'{change_set_ref,change_set_id}') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      stage#>'{review_ref,review_id}') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      stage#>'{source_snapshot_ref,snapshot_id}') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      stage#>'{candidate_release,release_id}') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      stage#>'{candidate_release,datasource_id}') is distinct from true
    or stage#>>'{predecessor_release,release_digest}'!~'^sha256:[0-9a-f]{64}$'
    or stage#>>'{change_set_ref,change_set_hash}'!~'^sha256:[0-9a-f]{64}$'
    or stage#>>'{review_ref,review_hash}'!~'^sha256:[0-9a-f]{64}$'
    or stage#>>'{source_snapshot_ref,snapshot_hash}'!~'^sha256:[0-9a-f]{64}$'
    or stage#>>'{compiler_bundle_ref,compiler_bundle_hash}'!~'^sha256:[0-9a-f]{64}$'
    or stage#>>'{candidate_release,release_digest}'!~'^sha256:[0-9a-f]{64}$'
    or stage#>>'{compiler_bundle_ref,compiler_version}'
      !~'^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
    or pg_catalog.jsonb_typeof(stage#>'{predecessor_release,generation}') is distinct from 'number'
    or stage#>>'{predecessor_release,generation}'!~'^(0|[1-9][0-9]{0,18})$'
    or pg_catalog.pg_input_is_valid(
      stage#>>'{predecessor_release,generation}','bigint') is distinct from true
    or pg_catalog.jsonb_typeof(stage->'expected_pointer_version') is distinct from 'number'
    or stage->>'expected_pointer_version'!~'^(0|[1-9][0-9]{0,18})$'
    or pg_catalog.pg_input_is_valid(stage->>'expected_pointer_version','bigint') is distinct from true
    or pg_catalog.jsonb_typeof(stage->'target_generation') is distinct from 'number'
    or stage->>'target_generation'!~'^(0|[1-9][0-9]{0,18})$'
    or pg_catalog.pg_input_is_valid(stage->>'target_generation','bigint') is distinct from true
    or pg_catalog.jsonb_typeof(stage#>'{source_snapshot_ref,snapshot_revision}')
      is distinct from 'number'
    or stage#>>'{source_snapshot_ref,snapshot_revision}'!~'^(0|[1-9][0-9]{0,18})$'
    or pg_catalog.pg_input_is_valid(
      stage#>>'{source_snapshot_ref,snapshot_revision}','bigint') is distinct from true
    or pg_catalog.jsonb_typeof(stage#>'{candidate_release,generation}') is distinct from 'number'
    or stage#>>'{candidate_release,generation}'!~'^(0|[1-9][0-9]{0,18})$'
    or pg_catalog.pg_input_is_valid(
      stage#>>'{candidate_release,generation}','bigint') is distinct from true
    or command->>'idempotency_digest' is distinct from expected_idempotency_digest
    or pg_catalog.jsonb_typeof(command->'binding_impact_hashes') is distinct from 'array'
    or pg_catalog.jsonb_array_length(command->'binding_impact_hashes')>256
    or exists(select 1 from pg_catalog.jsonb_array_elements(
        command->'binding_impact_hashes') as item(value)
      where pg_catalog.jsonb_typeof(item.value) is distinct from 'string'
        or item.value#>>'{}'!~'^sha256:[0-9a-f]{64}$')
    or command->'binding_impact_hashes' is distinct from coalesce((
      select pg_catalog.jsonb_agg(value order by value)
      from (select distinct value from pg_catalog.jsonb_array_elements_text(
        command->'binding_impact_hashes') value) canonical), '[]'::jsonb)
    or (stage->>'target_generation')::bigint<>(stage#>>'{predecessor_release,generation}')::bigint+1
    or (stage#>>'{candidate_release,generation}')::bigint<>(stage->>'target_generation')::bigint
    or stage->>'status' not in('STAGED','REJECTED')
    or stage->>'stage_digest'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.contains_potential_plaintext_secret(command)
  then raise exception using errcode='22023',message='SEMANTIC_SUCCESSOR_STAGE_RECORD_INVALID'; end if;

  if (stage#>>'{predecessor_release,generation}')::bigint<1
    or (stage->>'expected_pointer_version')::bigint<0
    or (stage->>'target_generation')::bigint<1
    or (stage#>>'{source_snapshot_ref,snapshot_revision}')::bigint<1
    or (stage#>>'{candidate_release,generation}')::bigint<1
    or stage#>>'{candidate_release,release_id}'=stage#>>'{predecessor_release,release_id}'
  then raise exception using errcode='22023',message='SEMANTIC_SUCCESSOR_STAGE_RECORD_INVALID'; end if;

  expected_release_digest:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'change_set_hash',stage#>>'{change_set_ref,change_set_hash}',
    'generation',(stage->>'target_generation')::bigint,
    'compiler_bundle_digest',stage#>>'{compiler_bundle_ref,compiler_bundle_hash}',
    'executable_projection_digest',stage#>>'{projection_refs,executable,projection_digest}',
    'relationship_projection_digest',stage#>>'{projection_refs,relationship,projection_digest}',
    'restriction_projection_digest',
      stage#>>'{projection_refs,runtime_restriction,projection_digest}',
    'graph_projection_digest',stage#>>'{projection_refs,graph,projection_digest}'));
  expected_stage_digest:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'hash_domain','semantic-successor-stage-digest@1.0.0','scope',stage->'scope',
    'predecessor_release',stage->'predecessor_release',
    'expected_pointer_version',stage->'expected_pointer_version',
    'change_set_ref',stage->'change_set_ref','review_ref',stage->'review_ref',
    'source_snapshot_ref',stage->'source_snapshot_ref',
    'compiler_bundle_ref',stage->'compiler_bundle_ref',
    'candidate_release',stage->'candidate_release','projection_refs',stage->'projection_refs'));
  if stage#>>'{candidate_release,release_digest}' is distinct from expected_release_digest
    or stage->>'stage_digest' is distinct from expected_stage_digest
  then raise exception using errcode='22023',message='SEMANTIC_SUCCESSOR_STAGE_DIGEST_INVALID'; end if;

  for projection_item in select * from (values
    ('executable','EXECUTABLE'),('relationship','RELATIONSHIP'),
    ('runtime_restriction','RUNTIME_RESTRICTION'),('graph','GRAPH'))
      item(projection_key,projection_kind)
  loop
    projection_json:=projections->projection_item.projection_key;
    projection_reference:=stage#>array['projection_refs',projection_item.projection_key];
    if app_data_agent.provider_json_object_has_exact_keys(projection_json,array[
        'projection_kind','projection_id','projection_digest','projection_payload']::text[])
        is distinct from true
      or projection_json->>'projection_kind' is distinct from projection_item.projection_kind
      or projection_json->>'projection_id' is distinct from projection_reference->>'projection_id'
      or projection_json->>'projection_digest' is distinct from
        projection_reference->>'projection_digest'
      or projection_json->>'projection_digest' is distinct from
        app_data_agent.u2_canonical_sha256(projection_json->'projection_payload')
    then raise exception using errcode='22023',
      message='SEMANTIC_SUCCESSOR_PROJECTION_SET_INVALID'; end if;
  end loop;

  expected_validation_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'hash_domain','semantic-runtime-closure-validation-receipt@1.0.0',
    'receipt',validation_receipt-'validation_receipt_hash'));
  if app_data_agent.provider_json_object_has_exact_keys(validation_receipt,array[
      'schema_version','receipt_id','stage_id','stage_digest','candidate_release',
      'projection_refs','validator_identity','outcome','reason_codes',
      'validation_receipt_hash']::text[]) is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      validation_receipt->'receipt_id') is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(
      validation_receipt->'validator_identity',array[
        'validator_version','validator_hash']::text[]) is distinct from true
    or validation_receipt#>>'{validator_identity,validator_version}'
      !~'^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
    or validation_receipt#>>'{validator_identity,validator_hash}'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(validation_receipt->'reason_codes') is distinct from 'array'
    or pg_catalog.jsonb_array_length(validation_receipt->'reason_codes')>256
    or exists(select 1 from pg_catalog.jsonb_array_elements(
        validation_receipt->'reason_codes') as item(value)
      where pg_catalog.jsonb_typeof(item.value) is distinct from 'string'
        or item.value#>>'{}'!~'^[A-Z][A-Z0-9_]{2,127}$')
    or validation_receipt->'reason_codes' is distinct from coalesce((
      select pg_catalog.jsonb_agg(value order by value)
      from (select distinct value from pg_catalog.jsonb_array_elements_text(
        validation_receipt->'reason_codes') value) canonical), '[]'::jsonb)
    or validation_receipt->>'schema_version' is distinct from
      'semantic-runtime-closure-validation-receipt@1.0.0'
    or validation_receipt->>'stage_id' is distinct from stage->>'stage_id'
    or validation_receipt->>'stage_digest' is distinct from stage->>'stage_digest'
    or validation_receipt->'candidate_release' is distinct from stage->'candidate_release'
    or validation_receipt->'projection_refs' is distinct from stage->'projection_refs'
    or validation_receipt->>'validation_receipt_hash' is distinct from expected_validation_hash
    or validation_receipt->>'outcome' not in('PASS','FAIL')
    or ((validation_receipt->>'outcome'='PASS') is distinct from
      (pg_catalog.jsonb_array_length(validation_receipt->'reason_codes')=0))
    or ((validation_receipt->>'outcome'='PASS') is distinct from (stage->>'status'='STAGED'))
  then raise exception using errcode='22023',message='SEMANTIC_RUNTIME_CLOSURE_INVALID'; end if;

  select * into strict authority from platform.current_backend_authority(true);
  if scope_json->>'app_id' is distinct from authority.app_id::text
    or scope_json->>'tenant_id' is distinct from authority.tenant_id::text
    or scope_json->>'environment' is distinct from authority.environment
    or scope_json->>'semantic_domain' is distinct from
      nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
  then raise exception using errcode='42501',message='SEMANTIC_SUCCESSOR_SCOPE_FORBIDDEN'; end if;

  perform semantic.lock_semantic_authority_fence(
    authority.app_id,authority.tenant_id,authority.environment,scope_json->>'semantic_domain');
  stage_id_value:=(stage->>'stage_id')::uuid;status_value:=stage->>'status';
  select * into existing from semantic.semantic_successor_release_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.semantic_domain=scope_json->>'semantic_domain'
      and row.principal_id=authority.principal_id
      and row.idempotency_key=command->>'idempotency_key' for update;
  if found then
    if existing.idempotency_digest is distinct from command->>'idempotency_digest'
      or existing.stage_digest is distinct from stage->>'stage_digest'
    then raise exception using errcode='23505',message='SEMANTIC_SUCCESSOR_IDEMPOTENCY_CONFLICT'; end if;
    return pg_catalog.jsonb_build_object(
      'stage',pg_catalog.jsonb_set(existing.stage_document,'{status}',to_jsonb(existing.status)),
      'projections',(select pg_catalog.jsonb_object_agg(
        case projection_kind when 'EXECUTABLE' then 'executable'
          when 'RELATIONSHIP' then 'relationship'
          when 'RUNTIME_RESTRICTION' then 'runtime_restriction' else 'graph' end,
        pg_catalog.jsonb_build_object('projection_kind',projection_kind,
          'projection_id',projection_id,'projection_digest',projection_digest,
          'projection_payload',projection_payload))
        from semantic.semantic_successor_projection_stage projection
        where projection.app_id=existing.app_id and projection.tenant_id=existing.tenant_id
          and projection.environment=existing.environment
          and projection.semantic_domain=existing.semantic_domain
          and projection.stage_id=existing.stage_id));
  end if;
  select * into pointer from semantic.semantic_active_pointer row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment
      and row.semantic_domain=scope_json->>'semantic_domain' for update;
  if not found
    or pointer.current_release_id is distinct from
      (stage#>>'{predecessor_release,release_id}')::uuid
    or pointer.current_release_generation is distinct from
      (stage#>>'{predecessor_release,generation}')::bigint
    or pointer.current_release_digest is distinct from
      stage#>>'{predecessor_release,release_digest}'
    or pointer.pointer_generation is distinct from (stage->>'expected_pointer_version')::bigint
  then raise exception using errcode='40001',message='SEMANTIC_SUCCESSOR_POINTER_STALE'; end if;

  insert into semantic.semantic_successor_release_stage(
    app_id,tenant_id,environment,semantic_domain,stage_id,command_id,principal_id,
    idempotency_key,idempotency_digest,predecessor_release_id,predecessor_generation,
    predecessor_release_digest,expected_pointer_version,target_generation,change_set_id,
    change_set_hash,review_id,review_hash,source_snapshot_id,source_snapshot_revision,
    source_snapshot_hash,compiler_version,compiler_bundle_hash,candidate_release_id,
    candidate_release_digest,datasource_id,stage_digest,validation_receipt_hash,
    source_revision_id,candidate_revision_id,publish_attempt_id,review_decision_id,
    outbox_event_id,binding_impact_hashes,stage_document,status,rejected_at)
  values(authority.app_id,authority.tenant_id,authority.environment,
    scope_json->>'semantic_domain',stage_id_value,(command->>'command_id')::uuid,
    authority.principal_id,command->>'idempotency_key',command->>'idempotency_digest',
    (stage#>>'{predecessor_release,release_id}')::uuid,
    (stage#>>'{predecessor_release,generation}')::bigint,
    stage#>>'{predecessor_release,release_digest}',(stage->>'expected_pointer_version')::bigint,
    (stage->>'target_generation')::bigint,(stage#>>'{change_set_ref,change_set_id}')::uuid,
    stage#>>'{change_set_ref,change_set_hash}',(stage#>>'{review_ref,review_id}')::uuid,
    stage#>>'{review_ref,review_hash}',(stage#>>'{source_snapshot_ref,snapshot_id}')::uuid,
    (stage#>>'{source_snapshot_ref,snapshot_revision}')::bigint,
    stage#>>'{source_snapshot_ref,snapshot_hash}',stage#>>'{compiler_bundle_ref,compiler_version}',
    stage#>>'{compiler_bundle_ref,compiler_bundle_hash}',
    (stage#>>'{candidate_release,release_id}')::uuid,
    stage#>>'{candidate_release,release_digest}',
    (stage#>>'{candidate_release,datasource_id}')::uuid,stage->>'stage_digest',
    validation_receipt->>'validation_receipt_hash',(authority_ids->>'source_revision_id')::uuid,
    (authority_ids->>'candidate_revision_id')::uuid,(authority_ids->>'publish_attempt_id')::uuid,
    (authority_ids->>'review_decision_id')::uuid,(authority_ids->>'outbox_event_id')::uuid,
    coalesce(command->'binding_impact_hashes','[]'::jsonb),stage,status_value,
    case when status_value='REJECTED' then now_at else null end);

  for projection_item in select * from (values
    ('executable','EXECUTABLE'),('relationship','RELATIONSHIP'),
    ('runtime_restriction','RUNTIME_RESTRICTION'),('graph','GRAPH'))
      item(projection_key,projection_kind)
  loop
    projection_json:=projections->projection_item.projection_key;
    insert into semantic.semantic_successor_projection_stage(
      app_id,tenant_id,environment,semantic_domain,stage_id,projection_kind,
      projection_id,projection_payload,projection_digest,created_at)
    values(authority.app_id,authority.tenant_id,authority.environment,
      scope_json->>'semantic_domain',stage_id_value,projection_item.projection_kind,
      (projection_json->>'projection_id')::uuid,projection_json->'projection_payload',
      projection_json->>'projection_digest',now_at);
  end loop;

  insert into semantic.semantic_successor_stage_receipt(
    app_id,tenant_id,environment,semantic_domain,stage_id,receipt_kind,receipt_id,
    receipt_schema_version,operation_idempotency_key,operation_digest,
    receipt_json,receipt_hash,created_at)
  values(authority.app_id,authority.tenant_id,authority.environment,
    scope_json->>'semantic_domain',stage_id_value,'VALIDATION',
    (validation_receipt->>'receipt_id')::uuid,validation_receipt->>'schema_version',
    command->>'idempotency_key',command->>'command_hash',validation_receipt,
    validation_receipt->>'validation_receipt_hash',now_at);

  if status_value='REJECTED' then
    rejection_receipt:=pg_catalog.jsonb_build_object(
      'schema_version','semantic-successor-rejection-receipt@1.0.0',
      'receipt_id',extensions.gen_random_uuid(),'stage_id',stage_id_value,
      'stage_digest',stage->>'stage_digest','validation_receipt_hash',
      validation_receipt->>'validation_receipt_hash','reason_codes',
      validation_receipt->'reason_codes');
    rejection_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'hash_domain','semantic-successor-rejection-receipt@1.0.0','receipt',rejection_receipt));
    rejection_receipt:=rejection_receipt||pg_catalog.jsonb_build_object(
      'rejection_receipt_hash',rejection_hash);
    insert into semantic.semantic_successor_stage_receipt(
      app_id,tenant_id,environment,semantic_domain,stage_id,receipt_kind,receipt_id,
      receipt_schema_version,operation_idempotency_key,operation_digest,
      receipt_json,receipt_hash,created_at)
    values(authority.app_id,authority.tenant_id,authority.environment,
      scope_json->>'semantic_domain',stage_id_value,'REJECTION',
      (rejection_receipt->>'receipt_id')::uuid,rejection_receipt->>'schema_version',
      (command->>'idempotency_key')||':rejection',command->>'command_hash',
      rejection_receipt,rejection_hash,now_at);
  end if;

  return pg_catalog.jsonb_build_object('stage',stage,'projections',projections);
end
$function$;

create function semantic.load_semantic_successor_stage(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; stage semantic.semantic_successor_release_stage%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','stage_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'semantic-successor-stage-load@1.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'stage_id') is distinct from true
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',message='SEMANTIC_SUCCESSOR_STAGE_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into stage from semantic.semantic_successor_release_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.stage_id=(command->>'stage_id')::uuid;
  if not found then raise exception using errcode='02000',
    message='SEMANTIC_SUCCESSOR_STAGE_NOT_FOUND'; end if;
  return pg_catalog.jsonb_build_object(
    'stage',pg_catalog.jsonb_set(stage.stage_document,'{status}',to_jsonb(stage.status)),
    'projections',(select pg_catalog.jsonb_object_agg(
      case projection_kind when 'EXECUTABLE' then 'executable'
        when 'RELATIONSHIP' then 'relationship'
        when 'RUNTIME_RESTRICTION' then 'runtime_restriction' else 'graph' end,
      pg_catalog.jsonb_build_object('projection_kind',projection_kind,
        'projection_id',projection_id,'projection_digest',projection_digest,
        'projection_payload',projection_payload))
      from semantic.semantic_successor_projection_stage projection
      where projection.app_id=stage.app_id and projection.tenant_id=stage.tenant_id
        and projection.environment=stage.environment and projection.semantic_domain=stage.semantic_domain
        and projection.stage_id=stage.stage_id));
end
$function$;

create function semantic.load_promoted_semantic_successor_release(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; stage semantic.semantic_successor_release_stage%rowtype;
  projections jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','semantic_domain','release_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'semantic-successor-release-load@1.0.0'
    or command->>'semantic_domain'!~'^[A-Za-z_][A-Za-z0-9_]{0,63}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'release_id') is distinct from true
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',
    message='SEMANTIC_SUCCESSOR_RELEASE_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  if nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
      is distinct from command->>'semantic_domain'
  then raise exception using errcode='42501',
    message='SEMANTIC_SUCCESSOR_SCOPE_FORBIDDEN'; end if;
  select * into stage from semantic.semantic_successor_release_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment
      and row.semantic_domain=command->>'semantic_domain'
      and row.candidate_release_id=(command->>'release_id')::uuid
      and row.status='PROMOTED';
  if not found then raise exception using errcode='02000',
    message='SEMANTIC_SUCCESSOR_PROMOTED_RELEASE_NOT_FOUND'; end if;
  if not exists(select 1 from semantic.semantic_source_release release
      where release.app_id=stage.app_id and release.tenant_id=stage.tenant_id
        and release.environment=stage.environment and release.semantic_domain=stage.semantic_domain
        and release.release_id=stage.candidate_release_id
        and release.release_generation=stage.target_generation
        and release.release_digest=stage.candidate_release_digest
        and release.compiler_bundle_digest=stage.compiler_bundle_hash
        and release.executable_projection_ref=
          (stage.stage_document#>>'{projection_refs,executable,projection_id}')::uuid
        and release.executable_projection_hash=
          stage.stage_document#>>'{projection_refs,executable,projection_digest}'
        and release.relationship_projection_ref=
          (stage.stage_document#>>'{projection_refs,relationship,projection_id}')::uuid
        and release.relationship_projection_hash=
          stage.stage_document#>>'{projection_refs,relationship,projection_digest}'
        and release.runtime_restriction_projection_ref=
          (stage.stage_document#>>'{projection_refs,runtime_restriction,projection_id}')::uuid
        and release.runtime_restriction_projection_hash=
          stage.stage_document#>>'{projection_refs,runtime_restriction,projection_digest}')
    or not exists(select 1 from semantic.semantic_executable_projection projection
      where projection.app_id=stage.app_id and projection.tenant_id=stage.tenant_id
        and projection.environment=stage.environment and projection.semantic_domain=stage.semantic_domain
        and projection.release_id=stage.candidate_release_id
        and projection.projection_id=
          (stage.stage_document#>>'{projection_refs,executable,projection_id}')::uuid
        and projection.projection_digest=
          stage.stage_document#>>'{projection_refs,executable,projection_digest}')
    or not exists(select 1 from semantic.semantic_relationship_projection projection
      where projection.app_id=stage.app_id and projection.tenant_id=stage.tenant_id
        and projection.environment=stage.environment and projection.semantic_domain=stage.semantic_domain
        and projection.release_id=stage.candidate_release_id
        and projection.datasource_id=stage.datasource_id
        and projection.projection_id=
          (stage.stage_document#>>'{projection_refs,relationship,projection_id}')::uuid
        and projection.projection_digest=
          stage.stage_document#>>'{projection_refs,relationship,projection_digest}')
    or not exists(select 1 from semantic.semantic_runtime_restriction_projection projection
      where projection.app_id=stage.app_id and projection.tenant_id=stage.tenant_id
        and projection.environment=stage.environment and projection.semantic_domain=stage.semantic_domain
        and projection.release_id=stage.candidate_release_id
        and projection.projection_id=
          (stage.stage_document#>>'{projection_refs,runtime_restriction,projection_id}')::uuid
        and projection.projection_digest=
          stage.stage_document#>>'{projection_refs,runtime_restriction,projection_digest}')
    or not exists(select 1 from semantic.semantic_source_release_graph_projection binding
      join semantic.semantic_graph_projection projection
        on projection.app_id=binding.app_id and projection.tenant_id=binding.tenant_id
       and projection.environment=binding.environment
       and projection.semantic_domain=binding.semantic_domain
       and projection.projection_id=binding.projection_id
      where binding.app_id=stage.app_id and binding.tenant_id=stage.tenant_id
        and binding.environment=stage.environment and binding.semantic_domain=stage.semantic_domain
        and binding.release_id=stage.candidate_release_id
        and binding.projection_id=
          (stage.stage_document#>>'{projection_refs,graph,projection_id}')::uuid
        and binding.projection_storage_digest=
          stage.stage_document#>>'{projection_refs,graph,projection_digest}'
        and projection.projection_storage_digest=binding.projection_storage_digest)
  then raise exception using errcode='55000',
    message='SEMANTIC_SUCCESSOR_FORMAL_RELEASE_BINDING_MISMATCH'; end if;
  select pg_catalog.jsonb_object_agg(
    case projection_kind when 'EXECUTABLE' then 'executable'
      when 'RELATIONSHIP' then 'relationship'
      when 'RUNTIME_RESTRICTION' then 'runtime_restriction' else 'graph' end,
    pg_catalog.jsonb_build_object('projection_kind',projection_kind,
      'projection_id',projection_id,'projection_digest',projection_digest,
      'projection_payload',projection_payload)) into projections
    from semantic.semantic_successor_projection_stage projection
    where projection.app_id=stage.app_id and projection.tenant_id=stage.tenant_id
      and projection.environment=stage.environment and projection.semantic_domain=stage.semantic_domain
      and projection.stage_id=stage.stage_id;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(projections))<>4
  then raise exception using errcode='55000',
    message='SEMANTIC_SUCCESSOR_PROJECTION_SET_INVALID'; end if;
  return pg_catalog.jsonb_build_object(
    'stage',pg_catalog.jsonb_set(stage.stage_document,'{status}',to_jsonb(stage.status)),
    'projections',projections);
end
$function$;

create function semantic.commit_semantic_successor_smoke(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record; stage_scope record; stage semantic.semantic_successor_release_stage%rowtype;
  existing semantic.semantic_successor_stage_receipt%rowtype; receipt jsonb;
  expected_hash text; now_at timestamptz:=pg_catalog.clock_timestamp();
  rejection_receipt jsonb; rejection_hash text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','idempotency_key','stage_id','expected_stage_digest',
      'receipt','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'semantic-successor-smoke-commit@1.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'stage_id') is distinct from true
    or pg_catalog.length(command->>'idempotency_key') not between 1 and 256
    or pg_catalog.btrim(command->>'idempotency_key') is distinct from command->>'idempotency_key'
    or command->>'expected_stage_digest'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'receipt') is distinct from 'object'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.contains_potential_plaintext_secret(command)
  then raise exception using errcode='22023',message='SEMANTIC_SUCCESSOR_SMOKE_COMMIT_INVALID'; end if;
  receipt:=command->'receipt';
  select * into strict authority from platform.current_backend_authority(true);
  select row.app_id,row.tenant_id,row.environment,row.semantic_domain into stage_scope
    from semantic.semantic_successor_release_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.stage_id=(command->>'stage_id')::uuid;
  if not found then raise exception using errcode='02000',
    message='SEMANTIC_SUCCESSOR_STAGE_NOT_FOUND'; end if;
  perform semantic.lock_semantic_authority_fence(
    stage_scope.app_id,stage_scope.tenant_id,stage_scope.environment,stage_scope.semantic_domain);
  select * into strict stage from semantic.semantic_successor_release_stage row
    where row.app_id=stage_scope.app_id and row.tenant_id=stage_scope.tenant_id
      and row.environment=stage_scope.environment and row.semantic_domain=stage_scope.semantic_domain
      and row.stage_id=(command->>'stage_id')::uuid for update;
  select * into existing from semantic.semantic_successor_stage_receipt row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
      and row.stage_id=stage.stage_id and row.receipt_kind='SMOKE'
      and row.operation_idempotency_key=command->>'idempotency_key';
  if found then
    if existing.operation_digest is distinct from command->>'command_hash'
    then raise exception using errcode='23505',message='SEMANTIC_SUCCESSOR_IDEMPOTENCY_CONFLICT'; end if;
    return existing.receipt_json;
  end if;
  expected_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'hash_domain','semantic-runtime-smoke-receipt@1.0.0',
    'receipt',receipt-'smoke_receipt_hash'));
  if stage.status<>'STAGED'
    or stage.stage_digest is distinct from command->>'expected_stage_digest'
    or app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','receipt_id','stage_id','stage_digest','candidate_release',
      'projection_refs','resolved_metric_id','resolved_dimension_id',
      'resolved_binding_hash','plan_hash','calendar_timezone','window_start',
      'window_end_exclusive','validator_identity','worker_build_identity','outcome',
      'failure_code','smoke_receipt_hash']::text[]) is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(receipt->'receipt_id') is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(
      receipt->'validator_identity',array[
        'validator_version','validator_hash']::text[]) is distinct from true
    or receipt#>>'{validator_identity,validator_version}'
      !~'^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
    or receipt#>>'{validator_identity,validator_hash}'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.provider_json_object_has_exact_keys(
      receipt->'worker_build_identity',array[
        'schema_version','consumer_role','generation_id','build_id','built_at',
        'git_commit','git_dirty']::text[]) is distinct from true
    or receipt#>>'{worker_build_identity,schema_version}' is distinct from
      'runtime-build-identity@1.0.0'
    or receipt#>>'{worker_build_identity,consumer_role}' is distinct from 'worker'
    or receipt#>>'{worker_build_identity,generation_id}'!~'^sha256:[0-9a-f]{64}$'
    or receipt#>>'{worker_build_identity,build_id}'!~'^sha256:[0-9a-f]{64}$'
    or receipt#>>'{worker_build_identity,built_at}'
      !~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
    or receipt#>>'{worker_build_identity,git_commit}'!~'^[a-f0-9]{7,64}$'
    or pg_catalog.jsonb_typeof(receipt#>'{worker_build_identity,git_dirty}')
      is distinct from 'boolean'
    or receipt->>'schema_version' is distinct from 'semantic-runtime-smoke-receipt@1.0.0'
    or receipt->>'stage_id' is distinct from stage.stage_id::text
    or receipt->>'stage_digest' is distinct from stage.stage_digest
    or receipt->'candidate_release' is distinct from stage.stage_document->'candidate_release'
    or receipt->'projection_refs' is distinct from stage.stage_document->'projection_refs'
    or receipt->>'resolved_metric_id' is distinct from 'metric.order_revenue'
    or receipt->>'resolved_dimension_id' is distinct from 'dimension.order_month'
    or receipt->>'resolved_binding_hash'!~'^sha256:[0-9a-f]{64}$'
    or receipt->>'plan_hash'!~'^sha256:[0-9a-f]{64}$'
    or receipt->>'calendar_timezone' is distinct from 'Asia/Shanghai'
    or receipt->>'window_start' is distinct from '2023-11-01T00:00:00.000Z'
    or receipt->>'window_end_exclusive' is distinct from '2024-11-01T00:00:00.000Z'
    or receipt->>'smoke_receipt_hash' is distinct from expected_hash
    or receipt->>'outcome' not in('PASS','FAIL')
    or (receipt->'failure_code'<>'null'::jsonb and (
      pg_catalog.jsonb_typeof(receipt->'failure_code') is distinct from 'string'
      or receipt->>'failure_code'!~'^[A-Z][A-Z0-9_]{2,127}$'))
    or ((receipt->>'outcome'='PASS') is distinct from (receipt->'failure_code'='null'::jsonb))
  then raise exception using errcode='40001',message='SEMANTIC_RUNTIME_SMOKE_FENCE_MISMATCH'; end if;
  insert into semantic.semantic_successor_stage_receipt(
    app_id,tenant_id,environment,semantic_domain,stage_id,receipt_kind,receipt_id,
    receipt_schema_version,operation_idempotency_key,operation_digest,
    receipt_json,receipt_hash,created_at)
  values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,stage.stage_id,'SMOKE',
    (receipt->>'receipt_id')::uuid,receipt->>'schema_version',command->>'idempotency_key',
    command->>'command_hash',receipt,receipt->>'smoke_receipt_hash',now_at);
  if receipt->>'outcome'='PASS' then
    update semantic.semantic_successor_release_stage set
      status='SMOKE_PASSED',smoke_passed_at=now_at
      where app_id=stage.app_id and tenant_id=stage.tenant_id and environment=stage.environment
        and semantic_domain=stage.semantic_domain and stage_id=stage.stage_id and status='STAGED';
  else
    update semantic.semantic_successor_release_stage set status='REJECTED',rejected_at=now_at
      where app_id=stage.app_id and tenant_id=stage.tenant_id and environment=stage.environment
        and semantic_domain=stage.semantic_domain and stage_id=stage.stage_id and status='STAGED';
    rejection_receipt:=pg_catalog.jsonb_build_object(
      'schema_version','semantic-successor-rejection-receipt@1.0.0',
      'receipt_id',extensions.gen_random_uuid(),'stage_id',stage.stage_id,
      'stage_digest',stage.stage_digest,'smoke_receipt_hash',receipt->>'smoke_receipt_hash',
      'failure_code',receipt->>'failure_code');
    rejection_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'hash_domain','semantic-successor-rejection-receipt@1.0.0','receipt',rejection_receipt));
    rejection_receipt:=rejection_receipt||pg_catalog.jsonb_build_object(
      'rejection_receipt_hash',rejection_hash);
    insert into semantic.semantic_successor_stage_receipt(
      app_id,tenant_id,environment,semantic_domain,stage_id,receipt_kind,receipt_id,
      receipt_schema_version,operation_idempotency_key,operation_digest,
      receipt_json,receipt_hash,created_at)
    values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,stage.stage_id,
      'REJECTION',(rejection_receipt->>'receipt_id')::uuid,
      rejection_receipt->>'schema_version',command->>'idempotency_key'||':rejection',
      command->>'command_hash',rejection_receipt,rejection_hash,now_at);
  end if;
  return receipt;
end
$function$;
