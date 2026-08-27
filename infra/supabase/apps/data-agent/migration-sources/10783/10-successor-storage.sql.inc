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
