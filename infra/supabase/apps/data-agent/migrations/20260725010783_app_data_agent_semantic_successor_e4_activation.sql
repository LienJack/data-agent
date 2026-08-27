-- semantic_successor_e4_activation_migration_checksum: sha256:d2889c065ceda0ab1a039b77ed3d27a986dad2525b7e3460ea5c85541069da13
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare relation_name text; function_name text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010782_app_data_agent_falcon24_analysis_publication')
  then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_E4_BASELINE_DRIFT'; end if;

  foreach relation_name in array array[
    'semantic.semantic_source_release','semantic.semantic_executable_projection',
    'semantic.semantic_relationship_projection',
    'semantic.semantic_runtime_restriction_projection','semantic.semantic_active_pointer',
    'semantic.semantic_runtime_activation','semantic.semantic_publish_attempt',
    'semantic.semantic_candidate','semantic.semantic_review_task',
    'semantic.semantic_graph_projection','semantic.semantic_graph_node_projection',
    'semantic.semantic_graph_edge_projection',
    'semantic.semantic_source_release_graph_projection',
    'app_data_agent.workspace_run_defaults','app_data_agent.workspace_run_default_revisions',
    'app_data_agent.falcon24_authority_staging_sessions',
    'app_data_agent.falcon24_authority_staging_receipts',
    'app_data_agent.falcon24_authority_baselines',
    'app_data_agent.falcon24_authority_activation_attempts',
    'app_data_agent.falcon24_current_authority_epoch'
  ]::text[] loop
    if pg_catalog.to_regclass(relation_name) is null
    then raise exception using errcode='P0001',
      message='SEMANTIC_SUCCESSOR_E4_INVENTORY_DRIFT',detail=relation_name; end if;
  end loop;

  foreach function_name in array array[
    'semantic.lock_semantic_authority_fence(uuid,uuid,text,text)',
    'platform.current_backend_authority(boolean)',
    'platform.backend_context_matches(uuid,uuid,text,boolean)',
    'app_data_agent.u2_canonical_sha256(jsonb)',
    'app_data_agent.provider_json_object_has_exact_keys(jsonb,text[])',
    'app_data_agent.runtime_iso_timestamp(timestamptz)'
  ]::text[] loop
    if pg_catalog.to_regprocedure(function_name) is null
    then raise exception using errcode='P0001',
      message='SEMANTIC_SUCCESSOR_E4_FUNCTION_DRIFT',detail=function_name; end if;
  end loop;

  if pg_catalog.to_regclass('semantic.semantic_successor_release_stage') is not null
    or pg_catalog.to_regclass('semantic.semantic_successor_projection_stage') is not null
    or pg_catalog.to_regclass('semantic.semantic_successor_stage_receipt') is not null
    or pg_catalog.to_regprocedure(
      'app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)') is not null
  then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_E4_SECOND_AUTHORITY_DETECTED'; end if;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';

create temporary table semantic_successor_history_snapshot(
  relation_name text primary key,row_count bigint not null,row_digest text not null
) on commit drop;

do $snapshot$
declare relation_name text; relation_id regclass; observed_count bigint; observed_digest text;
begin
  foreach relation_name in array array[
    'semantic.semantic_source_release','semantic.semantic_executable_projection',
    'semantic.semantic_relationship_projection',
    'semantic.semantic_runtime_restriction_projection','semantic.semantic_graph_projection',
    'semantic.semantic_graph_node_projection','semantic.semantic_graph_edge_projection',
    'semantic.semantic_source_release_graph_projection',
    'app_data_agent.falcon24_authority_staging_sessions',
    'app_data_agent.falcon24_authority_staging_receipts',
    'app_data_agent.falcon24_authority_baselines',
    'app_data_agent.falcon24_authority_activation_attempts',
    'app_data_agent.falcon24_current_authority_epoch',
    'app_data_agent.falcon24_gate_attempt_history','app_data_agent.falcon24_qualifications',
    'app_data_agent.falcon24_acceptance_campaigns'
  ]::text[] loop
    relation_id:=pg_catalog.to_regclass(relation_name);
    execute pg_catalog.format(
      'select pg_catalog.count(*),app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(source) order by to_jsonb(source)::text),'
      ||'''[]''::jsonb)) from %s source',relation_id)
      into strict observed_count,observed_digest;
    insert into semantic_successor_history_snapshot values(
      relation_name,observed_count,observed_digest);
  end loop;
end
$snapshot$;
create table semantic.semantic_successor_release_stage(
  app_id uuid not null check(app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check(environment~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null check(semantic_domain~'^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  stage_id uuid not null,command_id uuid not null,principal_id uuid not null,
  idempotency_key text not null check(pg_catalog.length(idempotency_key) between 1 and 256),
  idempotency_digest text not null check(idempotency_digest~'^sha256:[0-9a-f]{64}$'),
  predecessor_release_id uuid not null,predecessor_generation bigint not null,
  predecessor_release_digest text not null check(predecessor_release_digest~'^sha256:[0-9a-f]{64}$'),
  expected_pointer_version bigint not null check(expected_pointer_version between 1 and 9007199254740991),
  target_generation bigint not null check(target_generation between 1 and 9007199254740991),
  change_set_id uuid not null,change_set_hash text not null check(change_set_hash~'^sha256:[0-9a-f]{64}$'),
  review_id uuid not null,review_hash text not null check(review_hash~'^sha256:[0-9a-f]{64}$'),
  source_snapshot_id uuid not null,source_snapshot_revision bigint not null
    check(source_snapshot_revision between 1 and 9007199254740991),
  source_snapshot_hash text not null check(source_snapshot_hash~'^sha256:[0-9a-f]{64}$'),
  compiler_version text not null check(compiler_version~'^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'),
  compiler_bundle_hash text not null check(compiler_bundle_hash~'^sha256:[0-9a-f]{64}$'),
  candidate_release_id uuid not null,candidate_release_digest text not null
    check(candidate_release_digest~'^sha256:[0-9a-f]{64}$'),
  datasource_id uuid not null,stage_digest text not null check(stage_digest~'^sha256:[0-9a-f]{64}$'),
  validation_receipt_hash text not null check(validation_receipt_hash~'^sha256:[0-9a-f]{64}$'),
  source_revision_id uuid not null,candidate_revision_id uuid not null,
  publish_attempt_id uuid not null,review_decision_id uuid not null,outbox_event_id uuid not null,
  binding_impact_hashes jsonb not null default '[]'::jsonb
    check(pg_catalog.jsonb_typeof(binding_impact_hashes)='array'),
  stage_document jsonb not null check(pg_catalog.jsonb_typeof(stage_document)='object'),
  status text not null check(status in('STAGED','SMOKE_PASSED','REJECTED','PROMOTED')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  smoke_passed_at timestamptz,rejected_at timestamptz,promoted_at timestamptz,
  primary key(app_id,tenant_id,environment,semantic_domain,stage_id),
  unique(app_id,tenant_id,environment,semantic_domain,principal_id,idempotency_key),
  unique(app_id,tenant_id,environment,semantic_domain,stage_digest),
  unique(app_id,tenant_id,environment,semantic_domain,candidate_release_id),
  foreign key(app_id,tenant_id,environment,semantic_domain,predecessor_release_id)
    references semantic.semantic_source_release(
      app_id,tenant_id,environment,semantic_domain,release_id) on delete restrict,
  check(target_generation=predecessor_generation+1),
  check((status='STAGED' and smoke_passed_at is null and rejected_at is null and promoted_at is null)
    or (status='SMOKE_PASSED' and smoke_passed_at is not null
      and rejected_at is null and promoted_at is null)
    or (status='REJECTED' and rejected_at is not null and promoted_at is null)
    or (status='PROMOTED' and smoke_passed_at is not null
      and rejected_at is null and promoted_at is not null))
);

create unique index semantic_successor_one_live_generation
on semantic.semantic_successor_release_stage(
  app_id,tenant_id,environment,semantic_domain,target_generation)
where status in('STAGED','SMOKE_PASSED');

create table semantic.semantic_successor_projection_stage(
  app_id uuid not null,tenant_id uuid not null,environment text not null,semantic_domain text not null,
  stage_id uuid not null,
  projection_kind text not null
    check(projection_kind in('EXECUTABLE','RELATIONSHIP','RUNTIME_RESTRICTION','GRAPH')),
  projection_id uuid not null,projection_payload jsonb not null,
  projection_digest text not null check(projection_digest~'^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,semantic_domain,stage_id,projection_kind),
  unique(app_id,tenant_id,environment,semantic_domain,projection_id),
  foreign key(app_id,tenant_id,environment,semantic_domain,stage_id)
    references semantic.semantic_successor_release_stage(
      app_id,tenant_id,environment,semantic_domain,stage_id) on delete restrict,
  check(projection_digest=app_data_agent.u2_canonical_sha256(projection_payload))
);

create table semantic.semantic_successor_stage_receipt(
  app_id uuid not null,tenant_id uuid not null,environment text not null,semantic_domain text not null,
  stage_id uuid not null,receipt_kind text not null
    check(receipt_kind in('VALIDATION','SMOKE','REJECTION','PROMOTION')),
  receipt_id uuid not null,receipt_schema_version text not null,
  operation_idempotency_key text not null
    check(pg_catalog.length(operation_idempotency_key) between 1 and 256),
  operation_digest text not null check(operation_digest~'^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null check(pg_catalog.jsonb_typeof(receipt_json)='object'),
  receipt_hash text not null check(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,semantic_domain,stage_id,receipt_id),
  unique(app_id,tenant_id,environment,semantic_domain,stage_id,receipt_kind,operation_idempotency_key),
  unique(app_id,tenant_id,environment,semantic_domain,stage_id,receipt_hash),
  foreign key(app_id,tenant_id,environment,semantic_domain,stage_id)
    references semantic.semantic_successor_release_stage(
      app_id,tenant_id,environment,semantic_domain,stage_id) on delete restrict
);

create function semantic.semantic_successor_stage_state_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if tg_op='DELETE'
    or (to_jsonb(new)-array['status','smoke_passed_at','rejected_at','promoted_at'])
      is distinct from
      (to_jsonb(old)-array['status','smoke_passed_at','rejected_at','promoted_at'])
    or not ((old.status='STAGED' and new.status in('SMOKE_PASSED','REJECTED'))
      or (old.status='SMOKE_PASSED' and new.status='PROMOTED'))
  then raise exception using errcode='55000',message='SEMANTIC_SUCCESSOR_STAGE_IMMUTABLE'; end if;
  return new;
end
$function$;

create function semantic.semantic_successor_receipt_immutable()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  raise exception using errcode='55000',message='SEMANTIC_SUCCESSOR_RECEIPT_IMMUTABLE';
end
$function$;

create function semantic.semantic_formal_history_immutable()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  raise exception using errcode='55000',message='SEMANTIC_FORMAL_HISTORY_IMMUTABLE';
end
$function$;

create trigger semantic_successor_release_stage_state_fence
before update or delete on semantic.semantic_successor_release_stage
for each row execute function semantic.semantic_successor_stage_state_fence();
create trigger semantic_successor_projection_stage_immutable
before update or delete on semantic.semantic_successor_projection_stage
for each row execute function semantic.semantic_successor_receipt_immutable();
create trigger semantic_successor_stage_receipt_immutable
before update or delete on semantic.semantic_successor_stage_receipt
for each row execute function semantic.semantic_successor_receipt_immutable();

create trigger semantic_source_release_history_immutable
before update or delete on semantic.semantic_source_release
for each row execute function semantic.semantic_formal_history_immutable();
create trigger semantic_executable_projection_history_immutable
before update or delete on semantic.semantic_executable_projection
for each row execute function semantic.semantic_formal_history_immutable();
create trigger semantic_relationship_projection_history_immutable
before update or delete on semantic.semantic_relationship_projection
for each row execute function semantic.semantic_formal_history_immutable();
create trigger semantic_runtime_restriction_projection_history_immutable
before update or delete on semantic.semantic_runtime_restriction_projection
for each row execute function semantic.semantic_formal_history_immutable();
create trigger semantic_graph_projection_history_immutable
before update or delete on semantic.semantic_graph_projection
for each row execute function semantic.semantic_formal_history_immutable();
create trigger semantic_graph_node_projection_history_immutable
before update or delete on semantic.semantic_graph_node_projection
for each row execute function semantic.semantic_formal_history_immutable();
create trigger semantic_graph_edge_projection_history_immutable
before update or delete on semantic.semantic_graph_edge_projection
for each row execute function semantic.semantic_formal_history_immutable();
create trigger semantic_source_release_graph_projection_history_immutable
before update or delete on semantic.semantic_source_release_graph_projection
for each row execute function semantic.semantic_formal_history_immutable();
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
create function app_data_agent.activate_falcon24_authority_with_semantic_successor(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record; stage_scope record;
  pointer semantic.semantic_active_pointer%rowtype;
  runtime semantic.semantic_runtime_activation%rowtype;
  defaults_pointer app_data_agent.workspace_run_defaults%rowtype;
  defaults_revision app_data_agent.workspace_run_default_revisions%rowtype;
  current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  stage semantic.semantic_successor_release_stage%rowtype;
  validation_receipt semantic.semantic_successor_stage_receipt%rowtype;
  smoke_receipt semantic.semantic_successor_stage_receipt%rowtype;
  promotion_receipt semantic.semantic_successor_stage_receipt%rowtype;
  baseline app_data_agent.falcon24_authority_baselines%rowtype;
  attempt app_data_agent.falcon24_authority_activation_attempts%rowtype;
  session app_data_agent.falcon24_authority_staging_sessions%rowtype;
  semantic_receipt app_data_agent.falcon24_authority_staging_receipts%rowtype;
  publish_attempt semantic.semantic_publish_attempt%rowtype;
  review_task semantic.semantic_review_task%rowtype;
  dependency semantic.semantic_dependency_pointer%rowtype;
  projection_row record; graph_payload jsonb; graph_projection_id uuid;
  node_value jsonb; edge_value jsonb;
  scope_json jsonb; expected_authority jsonb; expected_predecessor jsonb;
  stage_ref jsonb; smoke_ref jsonb; baseline_ref jsonb; attempt_ref jsonb; versions jsonb;
  new_defaults_json jsonb; new_revision_document jsonb; new_defaults_hash text;
  now_at timestamptz:=pg_catalog.clock_timestamp();
  outbox_payload jsonb; outbox_digest text; receipt jsonb; receipt_hash text;
  semantic_proof jsonb; expected_semantic_proof_hash text;
  transaction_id_value text; defaults_revision_id uuid;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','command_id','idempotency_key','scope','authority_epoch',
      'expected_current_authority','expected_semantic_predecessor','stage_ref',
      'smoke_receipt_ref','baseline_ref','activation_attempt_ref','expected_versions',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from
      'combined-falcon24-semantic-activation-command@1.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'command_id') is distinct from true
    or pg_catalog.length(command->>'idempotency_key') not between 1 and 256
    or pg_catalog.btrim(command->>'idempotency_key') is distinct from command->>'idempotency_key'
    or command->>'authority_epoch' is distinct from 'E4'
    or command->>'command_hash' is distinct from app_data_agent.u2_canonical_sha256(
      pg_catalog.jsonb_build_object(
        'hash_domain','combined-falcon24-semantic-activation-command@1.0.0',
        'command',command-'command_hash'))
    or app_data_agent.contains_potential_plaintext_secret(command)
  then raise exception using errcode='22023',
    message='FALCON24_COMBINED_ACTIVATION_COMMAND_INVALID'; end if;
  scope_json:=command->'scope';expected_authority:=command->'expected_current_authority';
  expected_predecessor:=command->'expected_semantic_predecessor';stage_ref:=command->'stage_ref';
  smoke_ref:=command->'smoke_receipt_ref';baseline_ref:=command->'baseline_ref';
  attempt_ref:=command->'activation_attempt_ref';versions:=command->'expected_versions';
  if app_data_agent.provider_json_object_has_exact_keys(scope_json,array[
      'app_id','tenant_id','environment','semantic_domain']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(expected_authority,array[
      'schema_version','authority_epoch','baseline_id','baseline_hash',
      'activation_attempt_id']::text[]) is distinct from true
    or expected_authority->>'schema_version' is distinct from 'falcon24-authority-binding@2.0.0'
    or expected_authority->>'authority_epoch' is distinct from 'E3'
    or app_data_agent.provider_json_object_has_exact_keys(expected_predecessor,array[
      'release_id','generation','release_digest','datasource_id']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(stage_ref,array[
      'stage_id','stage_digest']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(smoke_ref,array[
      'schema_version','receipt_id','smoke_receipt_hash']::text[]) is distinct from true
    or smoke_ref->>'schema_version' is distinct from 'semantic-runtime-smoke-receipt@1.0.0'
    or app_data_agent.provider_json_object_has_exact_keys(baseline_ref,array[
      'baseline_id','baseline_hash']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(attempt_ref,array[
      'activation_attempt_id']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(versions,array[
      'semantic_pointer','semantic_runtime','workspace_defaults']::text[]) is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(scope_json->'app_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(scope_json->'tenant_id') is distinct from true
    or pg_catalog.length(scope_json->>'environment') not between 1 and 128
    or pg_catalog.btrim(scope_json->>'environment') is distinct from scope_json->>'environment'
    or pg_catalog.length(scope_json->>'semantic_domain') not between 1 and 128
    or pg_catalog.btrim(scope_json->>'semantic_domain') is distinct from
      scope_json->>'semantic_domain'
    or app_data_agent.canonical_uuid_json_string_is_valid(
      expected_authority->'baseline_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      expected_authority->'activation_attempt_id') is distinct from true
    or expected_authority->>'baseline_hash'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(
      expected_predecessor->'release_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      expected_predecessor->'datasource_id') is distinct from true
    or expected_predecessor->>'release_digest'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(expected_predecessor->'generation') is distinct from 'number'
    or expected_predecessor->>'generation'!~'^(0|[1-9][0-9]{0,18})$'
    or pg_catalog.pg_input_is_valid(
      expected_predecessor->>'generation','bigint') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(stage_ref->'stage_id') is distinct from true
    or stage_ref->>'stage_digest'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(smoke_ref->'receipt_id') is distinct from true
    or smoke_ref->>'smoke_receipt_hash'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(baseline_ref->'baseline_id')
      is distinct from true
    or baseline_ref->>'baseline_hash'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(
      attempt_ref->'activation_attempt_id') is distinct from true
    or exists(select 1 from pg_catalog.jsonb_each(versions) item
      where pg_catalog.jsonb_typeof(item.value) is distinct from 'number'
        or item.value#>>'{}'!~'^(0|[1-9][0-9]{0,18})$'
        or pg_catalog.pg_input_is_valid(item.value#>>'{}','bigint') is distinct from true)
  then raise exception using errcode='22023',
    message='FALCON24_COMBINED_ACTIVATION_COMMAND_INVALID'; end if;
  if (expected_predecessor->>'generation')::bigint<>1
    or (versions->>'semantic_pointer')::bigint<0
    or (versions->>'semantic_runtime')::bigint<0
    or (versions->>'workspace_defaults')::bigint<0
  then raise exception using errcode='22023',
    message='FALCON24_COMBINED_ACTIVATION_COMMAND_INVALID'; end if;

  select * into strict authority from platform.current_backend_authority(true);
  if scope_json->>'app_id' is distinct from authority.app_id::text
    or scope_json->>'tenant_id' is distinct from authority.tenant_id::text
    or scope_json->>'environment' is distinct from authority.environment
    or scope_json->>'semantic_domain' is distinct from
      nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
  then raise exception using errcode='42501',
    message='FALCON24_COMBINED_ACTIVATION_SCOPE_FORBIDDEN'; end if;
  select row.app_id,row.tenant_id,row.environment,row.semantic_domain into stage_scope
    from semantic.semantic_successor_release_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.stage_id=(stage_ref->>'stage_id')::uuid;
  if not found or stage_scope.semantic_domain is distinct from scope_json->>'semantic_domain'
  then raise exception using errcode='02000',message='SEMANTIC_SUCCESSOR_STAGE_NOT_FOUND'; end if;

  -- Global lock order: semantic fence -> Falcon scope -> semantic pointer/runtime ->
  -- workspace defaults -> Falcon current -> stage/smoke -> baseline/attempt/session.
  perform semantic.lock_semantic_authority_fence(
    authority.app_id,authority.tenant_id,authority.environment,scope_json->>'semantic_domain');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-authority-activation:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into pointer from semantic.semantic_active_pointer row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.semantic_domain=scope_json->>'semantic_domain'
    for update;
  select * into runtime from semantic.semantic_runtime_activation row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.semantic_domain=scope_json->>'semantic_domain'
    for update;
  select * into defaults_pointer from app_data_agent.workspace_run_defaults row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for update;
  if found then
    select * into defaults_revision from app_data_agent.workspace_run_default_revisions row
      where row.app_id=defaults_pointer.app_id and row.tenant_id=defaults_pointer.tenant_id
        and row.environment=defaults_pointer.environment
        and row.defaults_id=defaults_pointer.defaults_id
        and row.defaults_revision=defaults_pointer.defaults_revision
        and row.revision_id=defaults_pointer.revision_id
        and row.defaults_hash=defaults_pointer.defaults_hash for update;
  end if;
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for update;
  select * into stage from semantic.semantic_successor_release_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.semantic_domain=scope_json->>'semantic_domain'
      and row.stage_id=(stage_ref->>'stage_id')::uuid for update;
  select * into smoke_receipt from semantic.semantic_successor_stage_receipt row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
      and row.stage_id=stage.stage_id and row.receipt_kind='SMOKE'
      and row.receipt_id=(smoke_ref->>'receipt_id')::uuid for share;
  select * into validation_receipt from semantic.semantic_successor_stage_receipt row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
      and row.stage_id=stage.stage_id and row.receipt_kind='VALIDATION'
      and row.receipt_hash=stage.validation_receipt_hash for share;
  select * into baseline from app_data_agent.falcon24_authority_baselines row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment
      and row.baseline_id=(baseline_ref->>'baseline_id')::uuid for update;
  if found then
    select * into attempt from app_data_agent.falcon24_authority_activation_attempts row
      where row.app_id=baseline.app_id and row.tenant_id=baseline.tenant_id
        and row.environment=baseline.environment
        and row.attempt_id=(attempt_ref->>'activation_attempt_id')::uuid for update;
    select * into session from app_data_agent.falcon24_authority_staging_sessions row
      where row.app_id=baseline.app_id and row.tenant_id=baseline.tenant_id
        and row.environment=baseline.environment and row.staging_id=baseline.staging_id
        and row.authority_epoch='E4' for update;
    perform 1 from app_data_agent.falcon24_authority_staging_receipts row
      where row.app_id=baseline.app_id and row.tenant_id=baseline.tenant_id
        and row.environment=baseline.environment and row.staging_id=baseline.staging_id
        and row.authority_epoch='E4' order by row.component for share;
    select * into semantic_receipt from app_data_agent.falcon24_authority_staging_receipts row
      where row.app_id=baseline.app_id and row.tenant_id=baseline.tenant_id
        and row.environment=baseline.environment and row.staging_id=baseline.staging_id
        and row.authority_epoch='E4' and row.component='SEMANTIC_RELEASE';
  end if;

  if stage.status='PROMOTED' then
    select * into promotion_receipt from semantic.semantic_successor_stage_receipt row
      where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
        and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
        and row.stage_id=stage.stage_id and row.receipt_kind='PROMOTION';
    if not found or promotion_receipt.operation_digest is distinct from command->>'command_hash'
    then raise exception using errcode='23505',
      message='FALCON24_COMBINED_ACTIVATION_IDEMPOTENCY_CONFLICT'; end if;
    return promotion_receipt.receipt_json;
  end if;

  if current_epoch.authority_epoch is distinct from 'E3'
    or current_epoch.authority_epoch is distinct from expected_authority->>'authority_epoch'
    or current_epoch.baseline_id is distinct from (expected_authority->>'baseline_id')::uuid
    or current_epoch.baseline_hash is distinct from expected_authority->>'baseline_hash'
    or current_epoch.activation_attempt_id is distinct from
      (expected_authority->>'activation_attempt_id')::uuid
    or pointer.current_release_id is distinct from (expected_predecessor->>'release_id')::uuid
    or pointer.current_release_generation<>1
    or pointer.current_release_digest is distinct from expected_predecessor->>'release_digest'
    or stage.predecessor_release_id is distinct from pointer.current_release_id
    or stage.predecessor_generation is distinct from pointer.current_release_generation
    or stage.predecessor_release_digest is distinct from pointer.current_release_digest
    or stage.datasource_id is distinct from (expected_predecessor->>'datasource_id')::uuid
  then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_PREDECESSOR_MISMATCH'; end if;
  if pointer.pointer_generation is distinct from (versions->>'semantic_pointer')::bigint
    or runtime.activation_generation is distinct from (versions->>'semantic_runtime')::bigint
    or defaults_pointer.defaults_revision is distinct from (versions->>'workspace_defaults')::bigint
    or stage.expected_pointer_version is distinct from (versions->>'semantic_pointer')::bigint
    or runtime.current_release_id is distinct from pointer.current_release_id
    or runtime.current_release_generation is distinct from pointer.current_release_generation
  then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_DEFAULTS_STALE'; end if;
  if defaults_revision.defaults_json#>>'{semantic_release,resource_id}'
      is distinct from pointer.current_release_id::text
    or (defaults_revision.defaults_json#>>'{semantic_release,resource_revision}')::bigint
      is distinct from pointer.current_release_generation
    or defaults_revision.defaults_json#>>'{semantic_release,resource_hash}'
      is distinct from pointer.current_release_digest
  then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_DEFAULTS_STALE'; end if;
  if stage.status<>'SMOKE_PASSED'
    or stage.stage_digest is distinct from stage_ref->>'stage_digest'
    or stage.target_generation<>2
    or smoke_receipt.receipt_hash is distinct from smoke_ref->>'smoke_receipt_hash'
    or smoke_receipt.receipt_json->>'outcome'<>'PASS'
    or smoke_receipt.receipt_json->>'stage_digest' is distinct from stage.stage_digest
    or validation_receipt.receipt_hash is distinct from stage.validation_receipt_hash
    or validation_receipt.receipt_json->>'outcome'<>'PASS'
    or validation_receipt.receipt_json->>'stage_digest' is distinct from stage.stage_digest
  then raise exception using errcode='55000',
    message='FALCON24_COMBINED_ACTIVATION_SMOKE_REQUIRED'; end if;

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
      'receipt_id',validation_receipt.receipt_id,
      'validation_receipt_hash',validation_receipt.receipt_hash),
    'smoke_receipt_ref',smoke_ref,
    'expected_versions',versions);
  expected_semantic_proof_hash:=app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_object(
      'hash_domain','falcon24-semantic-release-authority-proof@2.0.0',
      'proof',semantic_proof));
  if baseline.status<>'STAGED' or baseline.authority_epoch<>'E4'
    or baseline.baseline_hash is distinct from baseline_ref->>'baseline_hash'
    or attempt.status<>'OPEN' or attempt.authority_epoch<>'E4'
    or attempt.baseline_id is distinct from baseline.baseline_id
    or attempt.expected_baseline_hash is distinct from baseline.baseline_hash
    or session.status<>'STAGED' or session.authority_epoch<>'E4'
    or semantic_receipt.subject_hash is distinct from stage.candidate_release_digest
    or semantic_receipt.evidence_hash is distinct from expected_semantic_proof_hash
    or baseline.baseline_document#>>'{staging_receipts,semantic_release}'
      is distinct from semantic_receipt.receipt_hash
    or (select pg_catalog.count(*) from app_data_agent.falcon24_authority_staging_receipts row
      where row.app_id=baseline.app_id and row.tenant_id=baseline.tenant_id
        and row.environment=baseline.environment and row.staging_id=baseline.staging_id
        and row.authority_epoch='E4')<>6
  then raise exception using errcode='55000',
    message='FALCON24_COMBINED_ACTIVATION_BASELINE_MISMATCH'; end if;

  if exists(select 1 from app_data_agent.runs row where row.app_id=authority.app_id
      and row.tenant_id=authority.tenant_id and row.environment=authority.environment
      and row.authority_epoch='E4')
    or exists(select 1 from app_data_agent.effective_run_config_receipts row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch='E4')
    or exists(select 1 from app_data_agent.artifacts row where row.app_id=authority.app_id
      and row.tenant_id=authority.tenant_id and row.environment=authority.environment
      and row.authority_epoch='E4')
    or exists(select 1 from app_data_agent.falcon24_qualifications row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch='E4')
    or exists(select 1 from app_data_agent.falcon24_acceptance_campaigns row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch='E4')
    or exists(select 1 from app_data_agent.falcon24_gate_attempt_history row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch='E4')
    or exists(select 1 from app_data_agent.falcon24_ui_receipts row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch='E4')
  then raise exception using errcode='55000',message='FALCON24_E4_AUTHORITY_POLLUTED'; end if;

  select * into publish_attempt from semantic.semantic_publish_attempt row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
      and row.attempt_id=stage.publish_attempt_id for update;
  select * into review_task from semantic.semantic_review_task row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
      and row.packet_id=stage.review_id for share;
  select * into dependency from semantic.semantic_dependency_pointer row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain for share;
  if publish_attempt.attempt_state is distinct from 'PREPARED'
    or publish_attempt.target_generation is distinct from stage.target_generation
    or publish_attempt.candidate_id is distinct from stage.change_set_id
    or publish_attempt.packet_id is distinct from stage.review_id
    or publish_attempt.compiler_bundle_digest is distinct from stage.compiler_bundle_hash
    or review_task.decision_window_status is distinct from 'CLOSED'
    or review_task.review_outcome is distinct from 'APPROVED'
    or review_task.candidate_id is distinct from stage.change_set_id
    or dependency.current_closure_policy_digest is null
    or not exists(select 1 from semantic.semantic_source_revision row
      where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
        and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
        and row.revision_id=stage.source_revision_id
        and row.source_digest=stage.source_snapshot_hash)
    or not exists(select 1 from semantic.semantic_candidate row
      where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
        and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
        and row.candidate_id=stage.change_set_id and row.current_revision_id=stage.candidate_revision_id
        and row.candidate_status='PUBLISHING')
    or (select pg_catalog.count(*) from semantic.semantic_successor_projection_stage row
      where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
        and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
        and row.stage_id=stage.stage_id)<>4
  then raise exception using errcode='55000',
    message='FALCON24_COMBINED_ACTIVATION_BASELINE_MISMATCH'; end if;

  insert into semantic.semantic_source_release(
    app_id,tenant_id,environment,semantic_domain,release_id,release_generation,attempt_id,
    packet_id,candidate_id,release_digest,compiler_bundle_digest,executable_projection_ref,
    executable_projection_hash,relationship_projection_ref,relationship_projection_hash,
    runtime_restriction_projection_ref,runtime_restriction_projection_hash,
    profile_child_manifest,quorum_snapshot,decision_set_digest,published_at,published_by,approval_mode)
  values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,
    stage.candidate_release_id,stage.target_generation,stage.publish_attempt_id,stage.review_id,
    stage.change_set_id,stage.candidate_release_digest,stage.compiler_bundle_hash,
    (stage.stage_document#>>'{projection_refs,executable,projection_id}')::uuid,
    stage.stage_document#>>'{projection_refs,executable,projection_digest}',
    (stage.stage_document#>>'{projection_refs,relationship,projection_id}')::uuid,
    stage.stage_document#>>'{projection_refs,relationship,projection_digest}',
    (stage.stage_document#>>'{projection_refs,runtime_restriction,projection_id}')::uuid,
    stage.stage_document#>>'{projection_refs,runtime_restriction,projection_digest}',
    pg_catalog.jsonb_build_object(
      'graph_projection_id',stage.stage_document#>>'{projection_refs,graph,projection_id}',
      'graph_projection_digest',stage.stage_document#>>'{projection_refs,graph,projection_digest}',
      'binding_impact_hashes',stage.binding_impact_hashes),
    review_task.quorum_rules_snapshot,stage.review_hash,now_at,authority.principal_id::text,'HUMAN_REVIEW');

  select * into projection_row from semantic.semantic_successor_projection_stage row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
      and row.stage_id=stage.stage_id and row.projection_kind='EXECUTABLE';
  insert into semantic.semantic_executable_projection(
    app_id,tenant_id,environment,semantic_domain,projection_id,release_id,
    projection_digest,projection_payload)
  values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,
    projection_row.projection_id,stage.candidate_release_id,
    projection_row.projection_digest,projection_row.projection_payload);

  select * into projection_row from semantic.semantic_successor_projection_stage row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
      and row.stage_id=stage.stage_id and row.projection_kind='RELATIONSHIP';
  insert into semantic.semantic_relationship_projection(
    app_id,tenant_id,environment,semantic_domain,projection_id,release_id,datasource_id,
    catalog_epoch,projection_digest,projection_payload)
  values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,
    projection_row.projection_id,stage.candidate_release_id,stage.datasource_id,
    publish_attempt.catalog_fence_epoch,projection_row.projection_digest,
    projection_row.projection_payload);

  select * into projection_row from semantic.semantic_successor_projection_stage row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
      and row.stage_id=stage.stage_id and row.projection_kind='RUNTIME_RESTRICTION';
  insert into semantic.semantic_runtime_restriction_projection(
    app_id,tenant_id,environment,semantic_domain,projection_id,release_id,projection_digest,
    platform_policy_digest,compiler_bundle_digest,pointer_generation,restriction_payload)
  values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,
    projection_row.projection_id,stage.candidate_release_id,projection_row.projection_digest,
    dependency.current_closure_policy_digest,stage.compiler_bundle_hash,
    pointer.pointer_generation+1,projection_row.projection_payload);

  select projection_id,projection_payload into graph_projection_id,graph_payload
    from semantic.semantic_successor_projection_stage row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
      and row.stage_id=stage.stage_id and row.projection_kind='GRAPH';
  insert into semantic.semantic_graph_projection(
    app_id,tenant_id,environment,semantic_domain,projection_id,graph_id,source_revision_id,
    source_revision_digest,source_digest,registry_digest,compiler_version,projection_payload,
    projection_storage_digest,node_count,edge_count,created_by,created_at)
  values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,graph_projection_id,
    (graph_payload->>'graph_id')::uuid,stage.source_revision_id,stage.source_snapshot_hash,
    graph_payload->>'source_digest',graph_payload->>'registry_digest',
    graph_payload->>'compiler_version',graph_payload,
    stage.stage_document#>>'{projection_refs,graph,projection_digest}',
    (graph_payload->>'node_count')::integer,(graph_payload->>'edge_count')::integer,
    authority.principal_id,now_at);
  for node_value in select value from pg_catalog.jsonb_array_elements(graph_payload->'nodes') loop
    insert into semantic.semantic_graph_node_projection(
      app_id,tenant_id,environment,semantic_domain,projection_id,node_id,node_type,
      node_version,lifecycle,intrinsic_payload,entry_storage_digest)
    values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,graph_projection_id,
      node_value->>'node_id',node_value->>'node_type',(node_value->>'node_version')::integer,
      node_value->>'lifecycle',node_value,app_data_agent.u2_canonical_sha256(node_value));
  end loop;
  for edge_value in select value from pg_catalog.jsonb_array_elements(graph_payload->'edges') loop
    insert into semantic.semantic_graph_edge_projection(
      app_id,tenant_id,environment,semantic_domain,projection_id,edge_id,edge_type,edge_family,
      source_node_id,target_node_id,edge_version,lifecycle,edge_payload,entry_storage_digest)
    values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,graph_projection_id,
      edge_value->>'edge_id',edge_value->>'edge_type',edge_value->>'family',
      edge_value->>'source_node_id',edge_value->>'target_node_id',
      (edge_value->>'edge_version')::integer,edge_value->>'lifecycle',edge_value,
      app_data_agent.u2_canonical_sha256(edge_value));
  end loop;
  insert into semantic.semantic_source_release_graph_projection(
    app_id,tenant_id,environment,semantic_domain,release_id,projection_id,source_revision_id,
    source_revision_digest,source_digest,projection_storage_digest,bound_by,bound_at)
  values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,
    stage.candidate_release_id,graph_projection_id,stage.source_revision_id,
    stage.source_snapshot_hash,graph_payload->>'source_digest',
    stage.stage_document#>>'{projection_refs,graph,projection_digest}',authority.principal_id,now_at);

  update semantic.semantic_publish_attempt set attempt_state='COMMITTED',
    executable_projection_ref=(stage.stage_document#>>'{projection_refs,executable,projection_id}')::uuid,
    executable_projection_hash=stage.stage_document#>>'{projection_refs,executable,projection_digest}',
    relationship_projection_ref=(stage.stage_document#>>'{projection_refs,relationship,projection_id}')::uuid,
    relationship_projection_hash=stage.stage_document#>>'{projection_refs,relationship,projection_digest}',
    runtime_restriction_projection_ref=
      (stage.stage_document#>>'{projection_refs,runtime_restriction,projection_id}')::uuid,
    runtime_restriction_projection_hash=
      stage.stage_document#>>'{projection_refs,runtime_restriction,projection_digest}',
    committed_release_ref=stage.candidate_release_id,updated_at=now_at
    where app_id=stage.app_id and tenant_id=stage.tenant_id and environment=stage.environment
      and semantic_domain=stage.semantic_domain and attempt_id=stage.publish_attempt_id
      and attempt_state='PREPARED';
  if not found then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_PREDECESSOR_MISMATCH'; end if;
  update semantic.semantic_candidate set candidate_status='PUBLISHED',updated_at=now_at
    where app_id=stage.app_id and tenant_id=stage.tenant_id and environment=stage.environment
      and semantic_domain=stage.semantic_domain and candidate_id=stage.change_set_id
      and candidate_status='PUBLISHING';
  if not found then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_PREDECESSOR_MISMATCH'; end if;

  defaults_revision_id:=(command->>'command_id')::uuid;
  new_defaults_json:=pg_catalog.jsonb_set(defaults_revision.defaults_json,'{semantic_release}',
    pg_catalog.jsonb_build_object('resource_id',stage.candidate_release_id,
      'resource_revision',stage.target_generation,'resource_hash',stage.candidate_release_digest));
  new_revision_document:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-defaults-revision@1.0.0','scope',
      pg_catalog.jsonb_build_object('app_id',authority.app_id,'tenant_id',authority.tenant_id,
        'environment',authority.environment,'workspace_id',authority.tenant_id),
    'defaults_id',defaults_pointer.defaults_id,
    'defaults_revision',defaults_pointer.defaults_revision+1,
    'parent_revision',defaults_pointer.defaults_revision,'parent_hash',defaults_pointer.defaults_hash,
    'defaults',new_defaults_json,'created_by_principal_id',authority.principal_id,
    'created_at',app_data_agent.runtime_iso_timestamp(now_at));
  new_defaults_hash:=app_data_agent.u2_canonical_sha256(new_revision_document);
  insert into app_data_agent.workspace_run_default_revisions(
    app_id,tenant_id,environment,defaults_id,defaults_revision,revision_id,principal_id,
    idempotency_key,request_hash,defaults_json,revision_document,defaults_hash,
    membership_version,user_authz_epoch,workspace_lifecycle_version,app_epoch,committed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,defaults_pointer.defaults_id,
    defaults_pointer.defaults_revision+1,defaults_revision_id,authority.principal_id,
    'combined-e4:'||(command->>'command_id'),command->>'command_hash',new_defaults_json,
    new_revision_document,new_defaults_hash,authority.membership_version,
    defaults_revision.user_authz_epoch,defaults_revision.workspace_lifecycle_version,
    authority.app_epoch,now_at);
  update app_data_agent.workspace_run_defaults pointer_row set
    defaults_revision=defaults_pointer.defaults_revision+1,revision_id=defaults_revision_id,
    defaults_hash=new_defaults_hash,updated_by_principal_id=authority.principal_id,updated_at=now_at
    where pointer_row.app_id=authority.app_id and pointer_row.tenant_id=authority.tenant_id
      and pointer_row.environment=authority.environment
      and pointer_row.defaults_revision=defaults_pointer.defaults_revision
      and pointer_row.revision_id=defaults_pointer.revision_id
      and pointer_row.defaults_hash=defaults_pointer.defaults_hash;
  if not found then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_DEFAULTS_STALE'; end if;

  update semantic.semantic_active_pointer set current_release_id=stage.candidate_release_id,
    current_release_generation=stage.target_generation,
    current_release_digest=stage.candidate_release_digest,
    pointer_generation=pointer.pointer_generation+1,updated_at=now_at,
    updated_by=authority.principal_id::text
    where app_id=stage.app_id and tenant_id=stage.tenant_id and environment=stage.environment
      and semantic_domain=stage.semantic_domain and current_release_id=pointer.current_release_id
      and current_release_generation=pointer.current_release_generation
      and pointer_generation=pointer.pointer_generation;
  if not found then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_PREDECESSOR_MISMATCH'; end if;
  update semantic.semantic_runtime_activation set current_release_id=stage.candidate_release_id,
    current_release_generation=stage.target_generation,
    activation_generation=runtime.activation_generation+1,updated_at=now_at
    where app_id=stage.app_id and tenant_id=stage.tenant_id and environment=stage.environment
      and semantic_domain=stage.semantic_domain
      and current_release_id=runtime.current_release_id
      and current_release_generation=runtime.current_release_generation
      and activation_generation=runtime.activation_generation;
  if not found then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_PREDECESSOR_MISMATCH'; end if;

  update app_data_agent.falcon24_authority_activation_attempts set
    status='ACTIVATED',decided_at=now_at
    where app_id=attempt.app_id and tenant_id=attempt.tenant_id
      and environment=attempt.environment and attempt_id=attempt.attempt_id and status='OPEN';
  if not found then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_BASELINE_MISMATCH'; end if;
  update app_data_agent.falcon24_authority_baselines set
    status='ACTIVE',activation_attempt_id=attempt.attempt_id,activated_at=now_at
    where app_id=baseline.app_id and tenant_id=baseline.tenant_id
      and environment=baseline.environment and baseline_id=baseline.baseline_id and status='STAGED';
  if not found then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_BASELINE_MISMATCH'; end if;
  update app_data_agent.falcon24_authority_staging_sessions set status='CONSUMED',updated_at=now_at
    where app_id=session.app_id and tenant_id=session.tenant_id and environment=session.environment
      and staging_id=session.staging_id and authority_epoch='E4' and status='STAGED';
  if not found then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_BASELINE_MISMATCH'; end if;
  update app_data_agent.falcon24_current_authority_epoch set authority_epoch='E4',
    baseline_id=baseline.baseline_id,baseline_hash=baseline.baseline_hash,
    activation_attempt_id=attempt.attempt_id,activated_at=now_at
    where app_id=current_epoch.app_id and tenant_id=current_epoch.tenant_id
      and environment=current_epoch.environment and authority_epoch='E3'
    returning * into strict current_epoch;

  outbox_payload:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-successor-activated-event@1.0.0','stage_id',stage.stage_id,
    'release_id',stage.candidate_release_id,'release_digest',stage.candidate_release_digest,
    'release_generation',stage.target_generation,'authority_epoch','E4',
    'baseline_id',baseline.baseline_id,'smoke_receipt_hash',smoke_receipt.receipt_hash);
  outbox_digest:=app_data_agent.u2_canonical_sha256(outbox_payload);
  insert into semantic.semantic_outbox(
    app_id,tenant_id,environment,semantic_domain,event_id,event_type,counter_kind,
    axis_generation,observed_release_generation,event_payload,event_digest,created_at)
  values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,stage.outbox_event_id,
    'SOURCE_RELEASE_ACTIVATED','RELEASE',stage.target_generation,stage.target_generation,
    outbox_payload,outbox_digest,now_at);

  transaction_id_value:='xid:'||pg_catalog.pg_current_xact_id()::text;
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','combined-falcon24-semantic-activation-receipt@1.0.0',
    'command_id',command->>'command_id','command_hash',command->>'command_hash',
    'scope',scope_json,'authority',app_data_agent.falcon24_authority_binding_document(current_epoch),
    'semantic_release',stage.stage_document->'candidate_release','workspace_defaults',
      pg_catalog.jsonb_build_object('version',defaults_pointer.defaults_revision+1,
        'semantic_release',stage.stage_document->'candidate_release'),
    'stage_ref',stage_ref,'smoke_receipt_ref',smoke_ref,
    'outbox_event_id',stage.outbox_event_id,'transaction_id',transaction_id_value);
  receipt_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'hash_domain','combined-falcon24-semantic-activation-receipt@1.0.0','receipt',receipt));
  receipt:=receipt||pg_catalog.jsonb_build_object('activation_receipt_hash',receipt_hash);
  insert into semantic.semantic_successor_stage_receipt(
    app_id,tenant_id,environment,semantic_domain,stage_id,receipt_kind,receipt_id,
    receipt_schema_version,operation_idempotency_key,operation_digest,
    receipt_json,receipt_hash,created_at)
  values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,stage.stage_id,
    'PROMOTION',(command->>'command_id')::uuid,receipt->>'schema_version',
    command->>'idempotency_key',command->>'command_hash',receipt,receipt_hash,now_at);
  update semantic.semantic_successor_release_stage set status='PROMOTED',promoted_at=now_at
    where app_id=stage.app_id and tenant_id=stage.tenant_id and environment=stage.environment
      and semantic_domain=stage.semantic_domain and stage_id=stage.stage_id
      and status='SMOKE_PASSED';
  if not found then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_SMOKE_REQUIRED'; end if;
  return receipt;
end
$function$;
alter table semantic.semantic_successor_release_stage owner to data_agent_u6_data_owner;
alter table semantic.semantic_successor_projection_stage owner to data_agent_u6_data_owner;
alter table semantic.semantic_successor_stage_receipt owner to data_agent_u6_data_owner;

alter table semantic.semantic_successor_release_stage enable row level security;
alter table semantic.semantic_successor_release_stage force row level security;
alter table semantic.semantic_successor_projection_stage enable row level security;
alter table semantic.semantic_successor_projection_stage force row level security;
alter table semantic.semantic_successor_stage_receipt enable row level security;
alter table semantic.semantic_successor_stage_receipt force row level security;

create policy semantic_successor_release_stage_rpc
on semantic.semantic_successor_release_stage for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_projection_stage_rpc
on semantic.semantic_successor_projection_stage for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_stage_receipt_rpc
on semantic.semantic_successor_stage_receipt for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));

create policy semantic_successor_publish_attempt_rpc on semantic.semantic_publish_attempt
for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_candidate_rpc on semantic.semantic_candidate
for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_review_task_rpc on semantic.semantic_review_task
for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_review_task_lock_rpc on semantic.semantic_review_task
for update to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_source_revision_rpc on semantic.semantic_source_revision
for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_dependency_rpc on semantic.semantic_dependency_pointer
for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_dependency_lock_rpc on semantic.semantic_dependency_pointer
for update to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_release_insert_rpc on semantic.semantic_source_release
for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_executable_insert_rpc on semantic.semantic_executable_projection
for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_relationship_insert_rpc on semantic.semantic_relationship_projection
for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_restriction_insert_rpc
on semantic.semantic_runtime_restriction_projection for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));

create policy semantic_successor_graph_insert_rpc on semantic.semantic_graph_projection
for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_graph_node_insert_rpc on semantic.semantic_graph_node_projection
for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_graph_edge_insert_rpc on semantic.semantic_graph_edge_projection
for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_graph_binding_insert_rpc
on semantic.semantic_source_release_graph_projection for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_outbox_insert_rpc on semantic.semantic_outbox
for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_pointer_update_rpc on semantic.semantic_active_pointer
for update to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_runtime_rpc on semantic.semantic_runtime_activation
for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));

create policy semantic_successor_workspace_defaults_rpc
on app_data_agent.workspace_run_defaults for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy semantic_successor_workspace_default_revisions_rpc
on app_data_agent.workspace_run_default_revisions for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));

grant select,insert,update on table
  semantic.semantic_successor_release_stage,
  semantic.semantic_successor_projection_stage,
  semantic.semantic_successor_stage_receipt to data_agent_u6_rpc_owner;
grant select,insert,update on table
  semantic.semantic_publish_attempt,semantic.semantic_candidate,
  semantic.semantic_active_pointer,semantic.semantic_runtime_activation to data_agent_u6_rpc_owner;
grant select on table semantic.semantic_source_revision to data_agent_u6_rpc_owner;
grant select,update on table
  semantic.semantic_review_task,semantic.semantic_dependency_pointer
  to data_agent_u6_rpc_owner;
grant insert on table
  semantic.semantic_source_release,semantic.semantic_executable_projection,
  semantic.semantic_relationship_projection,semantic.semantic_runtime_restriction_projection,
  semantic.semantic_graph_projection,semantic.semantic_graph_node_projection,
  semantic.semantic_graph_edge_projection,semantic.semantic_source_release_graph_projection,
  semantic.semantic_outbox to data_agent_u6_rpc_owner;
grant select,insert,update on table app_data_agent.workspace_run_defaults
  to data_agent_u6_rpc_owner;
grant select,insert,update on table app_data_agent.workspace_run_default_revisions
  to data_agent_u6_rpc_owner;

alter function semantic.semantic_successor_stage_state_fence()
  owner to data_agent_u6_rpc_owner;
alter function semantic.semantic_successor_receipt_immutable()
  owner to data_agent_u6_rpc_owner;
alter function semantic.semantic_formal_history_immutable()
  owner to data_agent_u6_rpc_owner;
alter function semantic.record_semantic_successor_stage(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.load_semantic_successor_stage(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.load_promoted_semantic_successor_release(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.commit_semantic_successor_smoke(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)
  owner to data_agent_u6_rpc_owner;

grant execute on function semantic.lock_semantic_authority_fence(uuid,uuid,text,text),
  platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.provider_json_object_has_exact_keys(jsonb,text[]),
  app_data_agent.runtime_iso_timestamp(timestamptz)
to data_agent_u6_rpc_owner;

revoke all on table
  semantic.semantic_successor_release_stage,
  semantic.semantic_successor_projection_stage,
  semantic.semantic_successor_stage_receipt
from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function
  semantic.semantic_successor_stage_state_fence(),
  semantic.semantic_successor_receipt_immutable(),
  semantic.semantic_formal_history_immutable(),
  semantic.record_semantic_successor_stage(jsonb),
  semantic.load_semantic_successor_stage(jsonb),
  semantic.load_promoted_semantic_successor_release(jsonb),
  semantic.commit_semantic_successor_smoke(jsonb),
  app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function
  semantic.record_semantic_successor_stage(jsonb),
  semantic.load_semantic_successor_stage(jsonb),
  semantic.load_promoted_semantic_successor_release(jsonb),
  semantic.commit_semantic_successor_smoke(jsonb),
  app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)
to data_agent_backend;
do $history_postconditions$
declare snapshot_row record; observed_count bigint; observed_digest text;
begin
  for snapshot_row in select * from semantic_successor_history_snapshot order by relation_name loop
    execute pg_catalog.format(
      'select pg_catalog.count(*),app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(source) order by to_jsonb(source)::text),'
      ||'''[]''::jsonb)) from %s source',pg_catalog.to_regclass(snapshot_row.relation_name))
      into strict observed_count,observed_digest;
    if observed_count<>snapshot_row.row_count or observed_digest<>snapshot_row.row_digest
    then raise exception using errcode='P0001',message='SEMANTIC_SUCCESSOR_HISTORY_DRIFT',
      detail=snapshot_row.relation_name; end if;
  end loop;
end
$history_postconditions$;

do $security_postconditions$
declare relation_name text; trigger_name text; definition text;
begin
  foreach relation_name in array array[
    'semantic_successor_release_stage','semantic_successor_projection_stage',
    'semantic_successor_stage_receipt']::text[] loop
    if not exists(select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='semantic' and relation.relname=relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity)
    then raise exception using errcode='P0001',message='SEMANTIC_SUCCESSOR_RLS_DRIFT'; end if;
  end loop;
  foreach trigger_name in array array[
    'semantic_source_release_history_immutable',
    'semantic_executable_projection_history_immutable',
    'semantic_relationship_projection_history_immutable',
    'semantic_runtime_restriction_projection_history_immutable',
    'semantic_graph_projection_history_immutable',
    'semantic_graph_node_projection_history_immutable',
    'semantic_graph_edge_projection_history_immutable',
    'semantic_source_release_graph_projection_history_immutable']::text[] loop
    if not exists(select 1 from pg_catalog.pg_trigger
      where tgname=trigger_name and not tgisinternal)
    then raise exception using errcode='P0001',message='SEMANTIC_FORMAL_HISTORY_TRIGGER_DRIFT',
      detail=trigger_name; end if;
  end loop;
  if pg_catalog.has_table_privilege('data_agent_backend',
      'semantic.semantic_successor_release_stage','SELECT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'semantic.semantic_successor_projection_stage','INSERT')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'semantic.semantic_successor_stage_receipt','UPDATE')
    or pg_catalog.has_function_privilege('public',
      'semantic.record_semantic_successor_stage(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'semantic.load_semantic_successor_stage(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'semantic.load_promoted_semantic_successor_release(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='SEMANTIC_SUCCESSOR_GRANT_DRIFT'; end if;
  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)'::regprocedure;
  if pg_catalog.strpos(definition,'semantic.lock_semantic_authority_fence')=0
    or pg_catalog.strpos(definition,'falcon24-authority-activation:')=0
    or pg_catalog.strpos(definition,'FALCON24_COMBINED_ACTIVATION_PREDECESSOR_MISMATCH')=0
    or pg_catalog.strpos(definition,'FALCON24_COMBINED_ACTIVATION_SMOKE_REQUIRED')=0
    or pg_catalog.strpos(definition,'FALCON24_COMBINED_ACTIVATION_BASELINE_MISMATCH')=0
    or pg_catalog.strpos(definition,'FALCON24_E4_AUTHORITY_POLLUTED')=0
    or pg_catalog.strpos(definition,'combined-falcon24-semantic-activation-receipt@1.0.0')=0
  then raise exception using errcode='P0001',message='FALCON24_COMBINED_ACTIVATION_DEFINITION_DRIFT'; end if;
end
$security_postconditions$;

select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010783_app_data_agent_semantic_successor_e4_activation',
  'sha256:d2889c065ceda0ab1a039b77ed3d27a986dad2525b7e3460ea5c85541069da13');
commit;
