-- falcon24_semantic_successor_review_preparation_migration_checksum: sha256:718dcb449c86f047d4d90b3e0336a5aa008259acf47d29932de3c03f349724e6
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
        and migration_version=
          '20260725010791_app_data_agent_falcon24_semantic_closure_readback')
  then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_REVIEW_PREPARATION_BASELINE_DRIFT'; end if;

  foreach relation_name in array array[
    'semantic.semantic_active_pointer','semantic.semantic_dependency_pointer',
    'semantic.semantic_source_revision','semantic.semantic_candidate',
    'semantic.semantic_candidate_revision','semantic.semantic_review_task',
    'semantic.semantic_review_decision','semantic.semantic_publish_attempt',
    'semantic.semantic_reviewer_policy_revision',
    'semantic.semantic_reviewer_policy_pointer','semantic.semantic_reviewer_assignment'
  ]::text[] loop
    if pg_catalog.to_regclass(relation_name) is null
    then raise exception using errcode='P0001',
      message='SEMANTIC_SUCCESSOR_REVIEW_PREPARATION_INVENTORY_DRIFT',
      detail=relation_name; end if;
  end loop;

  foreach function_name in array array[
    'semantic.lock_semantic_authority_fence(uuid,uuid,text,text)',
    'semantic.lock_packet(uuid,uuid,text,text,uuid)',
    'semantic.assert_review_packet_open(uuid,uuid,text,text,uuid)',
    'semantic.verify_principal_not_excluded(text,jsonb)',
    'semantic.u5_json_has_exact_keys(jsonb,text[])',
    'semantic.assert_u5_scope(jsonb,text,boolean)',
    'platform.backend_context_matches(uuid,uuid,text,boolean)',
    'app_data_agent.u2_canonical_sha256(jsonb)',
    'app_data_agent.runtime_iso_timestamp(timestamptz)',
    'semantic.semantic_successor_receipt_immutable()'
  ]::text[] loop
    if pg_catalog.to_regprocedure(function_name) is null
    then raise exception using errcode='P0001',
      message='SEMANTIC_SUCCESSOR_REVIEW_PREPARATION_FUNCTION_DRIFT',
      detail=function_name; end if;
  end loop;

  if pg_catalog.to_regclass(
      'semantic.semantic_successor_review_preparation') is not null
    or pg_catalog.to_regclass(
      'semantic.semantic_successor_review_decision_document') is not null
    or pg_catalog.to_regprocedure(
      'semantic.prepare_falcon24_successor_review(jsonb)') is not null
    or pg_catalog.to_regprocedure(
      'semantic.human_record_semantic_review_decision(jsonb)') is not null
    or pg_catalog.to_regprocedure(
      'semantic.prepare_falcon24_successor_publish_attempt(jsonb)') is not null
  then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_REVIEW_PREPARATION_SECOND_AUTHORITY_DETECTED'; end if;
end
$preflight$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
create table semantic.semantic_successor_review_preparation(
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  principal_id uuid not null,
  idempotency_key uuid not null,
  input_digest text not null check(input_digest~'^sha256:[0-9a-f]{64}$'),
  predecessor_release_id uuid not null,
  predecessor_release_generation bigint not null
    check(predecessor_release_generation between 1 and 9007199254740991),
  predecessor_release_digest text not null
    check(predecessor_release_digest~'^sha256:[0-9a-f]{64}$'),
  expected_pointer_version bigint not null
    check(expected_pointer_version between 1 and 9007199254740991),
  change_set_id uuid not null,
  change_set_hash text not null check(change_set_hash~'^sha256:[0-9a-f]{64}$'),
  source_revision_id uuid not null,
  candidate_revision_id uuid not null,
  packet_id uuid not null,
  packet_digest text not null check(packet_digest~'^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,semantic_domain,principal_id,idempotency_key),
  unique(app_id,tenant_id,environment,semantic_domain,change_set_id),
  unique(app_id,tenant_id,environment,semantic_domain,packet_id),
  foreign key(app_id,tenant_id,environment,semantic_domain,change_set_id)
    references semantic.semantic_candidate(app_id,tenant_id,environment,semantic_domain,candidate_id),
  foreign key(app_id,tenant_id,environment,semantic_domain,source_revision_id)
    references semantic.semantic_source_revision(app_id,tenant_id,environment,semantic_domain,revision_id),
  foreign key(app_id,tenant_id,environment,semantic_domain,change_set_id,candidate_revision_id)
    references semantic.semantic_candidate_revision(
      app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id),
  foreign key(app_id,tenant_id,environment,semantic_domain,packet_id)
    references semantic.semantic_review_task(app_id,tenant_id,environment,semantic_domain,packet_id)
);

create table semantic.semantic_successor_review_decision_document(
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  packet_id uuid not null,
  decision_id uuid not null,
  review_hash text not null check(review_hash~'^sha256:[0-9a-f]{64}$'),
  review_document jsonb not null,
  created_at timestamptz not null,
  primary key(app_id,tenant_id,environment,semantic_domain,packet_id,decision_id),
  unique(app_id,tenant_id,environment,semantic_domain,review_hash),
  foreign key(app_id,tenant_id,environment,semantic_domain,packet_id,decision_id)
    references semantic.semantic_review_decision(
      app_id,tenant_id,environment,semantic_domain,packet_id,decision_id)
);

create trigger semantic_successor_review_preparation_immutable
before update or delete on semantic.semantic_successor_review_preparation
for each row execute function semantic.semantic_successor_receipt_immutable();

create trigger semantic_successor_review_decision_document_immutable
before update or delete on semantic.semantic_successor_review_decision_document
for each row execute function semantic.semantic_successor_receipt_immutable();
create function semantic.prepare_falcon24_successor_review(p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare
  scope_json jsonb;
  expected_predecessor jsonb;
  change_set jsonb;
  change_set_scope jsonb;
  base_release jsonb;
  pointer semantic.semantic_active_pointer%rowtype;
  policy semantic.semantic_reviewer_policy_revision%rowtype;
  existing semantic.semantic_successor_review_preparation%rowtype;
  principal_id uuid;
  input_digest text;
  change_set_hash text;
  source_revision_id uuid:=extensions.gen_random_uuid();
  candidate_revision_id uuid:=extensions.gen_random_uuid();
  packet_id uuid:=extensions.gen_random_uuid();
  source_revision_number integer;
  packet_payload jsonb;
  packet_digest text;
  decision_timeout_seconds integer;
  publish_timeout_seconds integer;
  now_at timestamptz:=pg_catalog.clock_timestamp();
  proposer_principal constant text:='falcon24-successor-builder@1';
begin
  if p_command is null or not semantic.u5_json_has_exact_keys(p_command,array[
    'schema_version','scope','semantic_domain','idempotency_key',
    'expected_predecessor','expected_pointer_version','change_set'
  ]::text[]) or p_command->>'schema_version'<>
    'prepare-falcon24-semantic-successor-review@1.0.0'
    or p_command->>'semantic_domain'<>'falcon24'
    or coalesce(p_command->>'idempotency_key','')!~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_command->>'expected_pointer_version','')!~'^[1-9][0-9]{0,15}$'
  then raise exception using errcode='22023',
    message='SEMANTIC_SUCCESSOR_REVIEW_COMMAND_INVALID'; end if;

  scope_json:=p_command->'scope';
  perform semantic.assert_u5_scope(scope_json,p_command->>'semantic_domain',true);
  principal_id:=nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid;
  if principal_id is null then raise exception using errcode='42501',
    message='SEMANTIC_SUCCESSOR_REVIEW_SCOPE_FORBIDDEN'; end if;

  expected_predecessor:=p_command->'expected_predecessor';
  change_set:=p_command->'change_set';
  if not semantic.u5_json_has_exact_keys(expected_predecessor,array[
      'release_id','generation','release_digest']::text[])
    or coalesce(expected_predecessor->>'release_id','')!~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(expected_predecessor->>'generation','')!~'^[1-9][0-9]{0,15}$'
    or coalesce(expected_predecessor->>'release_digest','')!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(change_set)<>'object'
    or not semantic.u5_json_has_exact_keys(change_set,array[
      'schema_version','change_set_id','scope','base_release','revision','assertions',
      'conflicts','competency_results','validation','lifecycle_state','change_set_hash'
    ]::text[])
    or change_set->>'schema_version'<>'semantic-change-set@1.0.0'
    or change_set->>'lifecycle_state'<>'REVIEW_FROZEN'
    or change_set#>>'{validation,outcome}'<>'PASS'
    or coalesce((change_set#>>'{validation,competency_cases_passed}')::boolean,false) is not true
    or pg_catalog.jsonb_typeof(change_set->'assertions')<>'array'
    or pg_catalog.jsonb_array_length(change_set->'assertions')<1
    or pg_catalog.jsonb_typeof(change_set->'conflicts')<>'array'
    or pg_catalog.jsonb_array_length(change_set->'conflicts')<>0
    or coalesce(change_set->>'change_set_id','')!~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(change_set->>'revision','')!~'^[1-9][0-9]{0,15}$'
    or coalesce(change_set->>'change_set_hash','')!~'^sha256:[0-9a-f]{64}$'
  then raise exception using errcode='22023',
    message='SEMANTIC_SUCCESSOR_CHANGE_SET_INVALID'; end if;

  change_set_scope:=change_set->'scope';
  base_release:=change_set->'base_release';
  if not semantic.u5_json_has_exact_keys(change_set_scope,array[
      'app_id','tenant_id','environment','semantic_domain']::text[])
    or not semantic.u5_json_has_exact_keys(base_release,array[
      'release_id','generation','release_hash']::text[])
    or change_set_scope->>'app_id'<>scope_json->>'app_id'
    or change_set_scope->>'tenant_id'<>scope_json->>'tenant_id'
    or change_set_scope->>'environment'<>scope_json->>'environment'
    or change_set_scope->>'semantic_domain'<>p_command->>'semantic_domain'
    or base_release->>'release_id'<>expected_predecessor->>'release_id'
    or base_release->>'generation'<>expected_predecessor->>'generation'
    or base_release->>'release_hash'<>expected_predecessor->>'release_digest'
  then raise exception using errcode='22023',
    message='SEMANTIC_SUCCESSOR_CHANGE_SET_SCOPE_INVALID'; end if;

  change_set_hash:=change_set->>'change_set_hash';
  if app_data_agent.u2_canonical_sha256(change_set-'change_set_hash')<>change_set_hash
  then raise exception using errcode='22023',
    message='SEMANTIC_SUCCESSOR_CHANGE_SET_HASH_MISMATCH'; end if;
  input_digest:=app_data_agent.u2_canonical_sha256(p_command-'idempotency_key');

  perform semantic.lock_semantic_authority_fence(
    (scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,
    scope_json->>'environment',p_command->>'semantic_domain');

  select preparation.* into existing
  from semantic.semantic_successor_review_preparation as preparation
  where preparation.app_id=(scope_json->>'app_id')::uuid
    and preparation.tenant_id=(scope_json->>'tenant_id')::uuid
    and preparation.environment=scope_json->>'environment'
    and preparation.semantic_domain=p_command->>'semantic_domain'
    and preparation.principal_id=principal_id
    and preparation.idempotency_key=(p_command->>'idempotency_key')::uuid;
  if found then
    if existing.input_digest<>input_digest
    then raise exception using errcode='23505',
      message='SEMANTIC_SUCCESSOR_REVIEW_IDEMPOTENCY_CONFLICT'; end if;
    return pg_catalog.jsonb_build_object(
      'change_set_ref',pg_catalog.jsonb_build_object(
        'change_set_id',existing.change_set_id,'change_set_hash',existing.change_set_hash),
      'review_packet_ref',pg_catalog.jsonb_build_object(
        'review_id',existing.packet_id,'packet_digest',existing.packet_digest),
      'candidate_status','WAITING_REVIEW','created',false);
  end if;

  select active.* into pointer from semantic.semantic_active_pointer as active
  where active.app_id=(scope_json->>'app_id')::uuid
    and active.tenant_id=(scope_json->>'tenant_id')::uuid
    and active.environment=scope_json->>'environment'
    and active.semantic_domain=p_command->>'semantic_domain'
  for update;
  if not found
    or pointer.current_release_id is distinct from
      (expected_predecessor->>'release_id')::uuid
    or pointer.current_release_generation is distinct from
      (expected_predecessor->>'generation')::bigint
    or pointer.current_release_digest is distinct from expected_predecessor->>'release_digest'
    or pointer.pointer_generation is distinct from
      (p_command->>'expected_pointer_version')::bigint
  then raise exception using errcode='40001',message='SEMANTIC_SUCCESSOR_POINTER_STALE'; end if;

  perform 1 from semantic.semantic_candidate as candidate
  where candidate.app_id=pointer.app_id and candidate.tenant_id=pointer.tenant_id
    and candidate.environment=pointer.environment
    and candidate.semantic_domain=pointer.semantic_domain
    and candidate.candidate_id=(change_set->>'change_set_id')::uuid
  for update;
  if found then raise exception using errcode='23505',
    message='SEMANTIC_SUCCESSOR_REVIEW_SOURCE_CONFLICT'; end if;

  select revision.* into policy
  from semantic.semantic_reviewer_policy_pointer as policy_pointer
  join semantic.semantic_reviewer_policy_revision as revision
    on revision.app_id=policy_pointer.app_id and revision.tenant_id=policy_pointer.tenant_id
   and revision.environment=policy_pointer.environment
   and revision.semantic_domain=policy_pointer.semantic_domain
   and revision.policy_version=policy_pointer.current_policy_version
   and revision.policy_digest=policy_pointer.current_policy_digest
  where policy_pointer.app_id=pointer.app_id and policy_pointer.tenant_id=pointer.tenant_id
    and policy_pointer.environment=pointer.environment
    and policy_pointer.semantic_domain=pointer.semantic_domain;
  if not found then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_REVIEW_POLICY_REQUIRED'; end if;

  decision_timeout_seconds:=policy.decision_timeout_seconds;
  publish_timeout_seconds:=coalesce(
    (policy.expiry_rules->>'publish_timeout_seconds')::integer,
    policy.decision_timeout_seconds);
  if decision_timeout_seconds not between 60 and 2592000
    or publish_timeout_seconds not between 60 and 2592000
  then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_REVIEW_POLICY_INVALID'; end if;

  select coalesce(pg_catalog.max(source.revision_number),0)+1
    into source_revision_number
  from semantic.semantic_source_revision as source
  where source.app_id=pointer.app_id and source.tenant_id=pointer.tenant_id
    and source.environment=pointer.environment and source.semantic_domain=pointer.semantic_domain;

  packet_payload:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-successor-review-packet@1.0.0',
    'title','Falcon24 executable semantic successor',
    'description','Server-built forward successor; formal release remains unmodified until combined activation.',
    'riskLevel','critical',
    'proposer_principal',proposer_principal,
    'review_policy_ref',pg_catalog.jsonb_build_object(
      'policy_version',policy.policy_version,'policy_digest',policy.policy_digest),
    'change_set',change_set);
  packet_digest:=app_data_agent.u2_canonical_sha256(packet_payload);

  insert into semantic.semantic_source_revision(
    app_id,tenant_id,environment,semantic_domain,revision_id,revision_number,
    base_release_id,base_release_generation,source_payload,source_digest,
    author_principal,change_description,change_class)
  values(pointer.app_id,pointer.tenant_id,pointer.environment,pointer.semantic_domain,
    source_revision_id,source_revision_number,pointer.current_release_id,
    pointer.current_release_generation,change_set,change_set_hash,proposer_principal,
    'Server-built Falcon24 semantic successor','MAJOR');

  insert into semantic.semantic_candidate(
    app_id,tenant_id,environment,semantic_domain,candidate_id,proposer_principal,
    current_revision_id,candidate_status)
  values(pointer.app_id,pointer.tenant_id,pointer.environment,pointer.semantic_domain,
    (change_set->>'change_set_id')::uuid,proposer_principal,candidate_revision_id,
    'WAITING_REVIEW');

  insert into semantic.semantic_candidate_revision(
    app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id,
    revision_number,source_revision_id,revision_payload,revision_digest,
    author_principal,change_description,change_class)
  values(pointer.app_id,pointer.tenant_id,pointer.environment,pointer.semantic_domain,
    (change_set->>'change_set_id')::uuid,candidate_revision_id,
    (change_set->>'revision')::integer,source_revision_id,change_set,change_set_hash,
    proposer_principal,'Frozen Falcon24 successor ChangeSet','MAJOR');

  insert into semantic.semantic_review_task(
    app_id,tenant_id,environment,semantic_domain,packet_id,packet_kind,approval_mode,
    packet_digest,packet_payload,candidate_id,decision_window_status,review_outcome,
    decision_expires_at,publish_expires_at,quorum_rules_snapshot,veto_rules_snapshot,
    exclusion_set,created_by)
  values(pointer.app_id,pointer.tenant_id,pointer.environment,pointer.semantic_domain,
    packet_id,'CANDIDATE_REVIEW','HUMAN_REVIEW',packet_digest,packet_payload,
    (change_set->>'change_set_id')::uuid,'OPEN','PENDING',
    now_at+pg_catalog.make_interval(secs=>decision_timeout_seconds),
    now_at+pg_catalog.make_interval(secs=>publish_timeout_seconds),
    policy.quorum_rules,policy.veto_rules,pg_catalog.jsonb_build_array(proposer_principal),
    principal_id::text);

  insert into semantic.semantic_successor_review_preparation(
    app_id,tenant_id,environment,semantic_domain,principal_id,idempotency_key,
    input_digest,predecessor_release_id,predecessor_release_generation,
    predecessor_release_digest,expected_pointer_version,change_set_id,change_set_hash,
    source_revision_id,candidate_revision_id,packet_id,packet_digest,created_at)
  values(pointer.app_id,pointer.tenant_id,pointer.environment,pointer.semantic_domain,
    principal_id,(p_command->>'idempotency_key')::uuid,input_digest,
    pointer.current_release_id,pointer.current_release_generation,pointer.current_release_digest,
    pointer.pointer_generation,(change_set->>'change_set_id')::uuid,change_set_hash,
    source_revision_id,candidate_revision_id,packet_id,packet_digest,now_at);

  return pg_catalog.jsonb_build_object(
    'change_set_ref',pg_catalog.jsonb_build_object(
      'change_set_id',change_set->>'change_set_id','change_set_hash',change_set_hash),
    'review_packet_ref',pg_catalog.jsonb_build_object(
      'review_id',packet_id,'packet_digest',packet_digest),
    'candidate_status','WAITING_REVIEW','created',true);
end
$function$;

create function semantic.prepare_falcon24_successor_publish_attempt(p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare
  scope_json jsonb;
  expected_predecessor jsonb;
  change_set_ref jsonb;
  pointer semantic.semantic_active_pointer%rowtype;
  task semantic.semantic_review_task%rowtype;
  candidate semantic.semantic_candidate%rowtype;
  dependency semantic.semantic_dependency_pointer%rowtype;
  existing semantic.semantic_publish_attempt%rowtype;
  review_record semantic.semantic_successor_review_decision_document%rowtype;
  attempt_id uuid:=extensions.gen_random_uuid();
begin
  if p_command is null or not semantic.u5_json_has_exact_keys(p_command,array[
    'schema_version','scope','semantic_domain','review_id','change_set_ref',
    'compiler_bundle_digest','target_generation','idempotency_digest',
    'expected_predecessor','expected_pointer_version'
  ]::text[]) or p_command->>'schema_version'<>
    'prepare-falcon24-semantic-successor-publish-attempt@1.0.0'
    or p_command->>'semantic_domain'<>'falcon24'
    or coalesce(p_command->>'review_id','')!~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_command->>'compiler_bundle_digest','')!~'^sha256:[0-9a-f]{64}$'
    or coalesce(p_command->>'idempotency_digest','')!~'^sha256:[0-9a-f]{64}$'
    or coalesce(p_command->>'target_generation','')!~'^[1-9][0-9]{0,15}$'
    or coalesce(p_command->>'expected_pointer_version','')!~'^[1-9][0-9]{0,15}$'
  then raise exception using errcode='22023',
    message='SEMANTIC_SUCCESSOR_PUBLISH_PREPARATION_COMMAND_INVALID'; end if;
  scope_json:=p_command->'scope';
  expected_predecessor:=p_command->'expected_predecessor';
  change_set_ref:=p_command->'change_set_ref';
  perform semantic.assert_u5_scope(scope_json,p_command->>'semantic_domain',true);
  if not semantic.u5_json_has_exact_keys(expected_predecessor,array[
      'release_id','generation','release_digest']::text[])
    or not semantic.u5_json_has_exact_keys(change_set_ref,array[
      'change_set_id','change_set_hash']::text[])
    or coalesce(expected_predecessor->>'release_id','')!~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(expected_predecessor->>'generation','')!~'^[1-9][0-9]{0,15}$'
    or coalesce(expected_predecessor->>'release_digest','')!~'^sha256:[0-9a-f]{64}$'
    or coalesce(change_set_ref->>'change_set_id','')!~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(change_set_ref->>'change_set_hash','')!~'^sha256:[0-9a-f]{64}$'
    or (p_command->>'target_generation')::bigint<>
      (expected_predecessor->>'generation')::bigint+1
  then raise exception using errcode='22023',
    message='SEMANTIC_SUCCESSOR_PUBLISH_PREPARATION_COMMAND_INVALID'; end if;

  perform semantic.lock_semantic_authority_fence(
    (scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,
    scope_json->>'environment',p_command->>'semantic_domain');
  perform semantic.lock_packet(
    (scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,
    scope_json->>'environment',p_command->>'semantic_domain',
    (p_command->>'review_id')::uuid);

  select active.* into pointer from semantic.semantic_active_pointer as active
  where active.app_id=(scope_json->>'app_id')::uuid
    and active.tenant_id=(scope_json->>'tenant_id')::uuid
    and active.environment=scope_json->>'environment'
    and active.semantic_domain=p_command->>'semantic_domain'
  for update;
  if not found
    or pointer.current_release_id is distinct from
      (expected_predecessor->>'release_id')::uuid
    or pointer.current_release_generation is distinct from
      (expected_predecessor->>'generation')::bigint
    or pointer.current_release_digest is distinct from expected_predecessor->>'release_digest'
    or pointer.pointer_generation is distinct from
      (p_command->>'expected_pointer_version')::bigint
  then raise exception using errcode='40001',message='SEMANTIC_SUCCESSOR_POINTER_STALE'; end if;

  select review_task.* into task from semantic.semantic_review_task as review_task
  where review_task.app_id=pointer.app_id and review_task.tenant_id=pointer.tenant_id
    and review_task.environment=pointer.environment
    and review_task.semantic_domain=pointer.semantic_domain
    and review_task.packet_id=(p_command->>'review_id')::uuid
    and review_task.packet_kind='CANDIDATE_REVIEW'
    and review_task.approval_mode='HUMAN_REVIEW'
    and review_task.decision_window_status='CLOSED'
    and review_task.review_outcome='APPROVED'
    and review_task.candidate_id=(change_set_ref->>'change_set_id')::uuid
    and review_task.packet_payload->>'schema_version'=
      'semantic-successor-review-packet@1.0.0'
    and review_task.packet_payload#>>'{change_set,change_set_hash}'=
      change_set_ref->>'change_set_hash'
    and (review_task.publish_expires_at is null
      or review_task.publish_expires_at>pg_catalog.clock_timestamp())
  for update;
  if not found then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_APPROVED_REVIEW_REQUIRED'; end if;

  select semantic_candidate.* into candidate from semantic.semantic_candidate as semantic_candidate
  where semantic_candidate.app_id=pointer.app_id
    and semantic_candidate.tenant_id=pointer.tenant_id
    and semantic_candidate.environment=pointer.environment
    and semantic_candidate.semantic_domain=pointer.semantic_domain
    and semantic_candidate.candidate_id=(change_set_ref->>'change_set_id')::uuid
  for update;
  if not found or candidate.candidate_status not in ('APPROVED','PUBLISHING')
  then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_APPROVED_CANDIDATE_REQUIRED'; end if;

  select document.* into review_record
  from semantic.semantic_successor_review_decision_document as document
  join semantic.semantic_review_decision as decision
    on decision.app_id=document.app_id and decision.tenant_id=document.tenant_id
   and decision.environment=document.environment
   and decision.semantic_domain=document.semantic_domain
   and decision.packet_id=document.packet_id and decision.decision_id=document.decision_id
  where document.app_id=pointer.app_id and document.tenant_id=pointer.tenant_id
    and document.environment=pointer.environment and document.semantic_domain=pointer.semantic_domain
    and document.packet_id=task.packet_id and decision.decision='APPROVE'
  order by decision.created_at desc,decision.decision_id desc limit 1;
  if not found
    or review_record.review_document#>>'{change_set_id}'<>change_set_ref->>'change_set_id'
    or review_record.review_document#>>'{change_set_hash}'<>change_set_ref->>'change_set_hash'
    or review_record.review_document#>>'{review_id}'<>task.packet_id::text
    or review_record.review_document#>>'{decision}'<>'APPROVE'
  then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_APPROVED_REVIEW_REQUIRED'; end if;

  select dependency_pointer.* into dependency
  from semantic.semantic_dependency_pointer as dependency_pointer
  where dependency_pointer.app_id=pointer.app_id
    and dependency_pointer.tenant_id=pointer.tenant_id
    and dependency_pointer.environment=pointer.environment
    and dependency_pointer.semantic_domain=pointer.semantic_domain
  for share;
  if not found then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_DEPENDENCY_POINTER_REQUIRED'; end if;

  select attempt.* into existing from semantic.semantic_publish_attempt as attempt
  where attempt.app_id=pointer.app_id and attempt.tenant_id=pointer.tenant_id
    and attempt.environment=pointer.environment and attempt.semantic_domain=pointer.semantic_domain
    and attempt.idempotency_digest=p_command->>'idempotency_digest'
  for update;
  if found then
    if existing.packet_id<>task.packet_id
      or existing.candidate_id<>candidate.candidate_id
      or existing.attempt_state<>'PREPARED'
      or existing.compiler_bundle_digest<>p_command->>'compiler_bundle_digest'
      or existing.catalog_fence_epoch<>dependency.current_catalog_epoch
      or existing.dependency_generation<>dependency.pointer_generation
      or existing.target_generation<>(p_command->>'target_generation')::bigint
      or existing.approval_mode<>'HUMAN_REVIEW'
    then raise exception using errcode='23505',
      message='SEMANTIC_SUCCESSOR_PUBLISH_PREPARATION_IDEMPOTENCY_CONFLICT'; end if;
    return pg_catalog.jsonb_build_object(
      'attempt_id',existing.attempt_id,'attempt_state',existing.attempt_state,
      'change_set_ref',change_set_ref,
      'review_ref',pg_catalog.jsonb_build_object(
        'review_id',task.packet_id,'review_hash',review_record.review_hash),
      'review_document',review_record.review_document,'created',false);
  end if;

  perform 1 from semantic.semantic_publish_attempt as attempt
  where attempt.app_id=pointer.app_id and attempt.tenant_id=pointer.tenant_id
    and attempt.environment=pointer.environment and attempt.semantic_domain=pointer.semantic_domain
    and attempt.packet_id=task.packet_id and attempt.candidate_id=candidate.candidate_id
    and attempt.target_generation=(p_command->>'target_generation')::bigint
    and attempt.attempt_state='PREPARED'
  for update;
  if found then raise exception using errcode='23505',
    message='SEMANTIC_SUCCESSOR_PUBLISH_PREPARATION_CONFLICT'; end if;

  update semantic.semantic_candidate set candidate_status='PUBLISHING',
    updated_at=pg_catalog.clock_timestamp()
  where app_id=pointer.app_id and tenant_id=pointer.tenant_id
    and environment=pointer.environment and semantic_domain=pointer.semantic_domain
    and candidate_id=candidate.candidate_id and candidate_status='APPROVED';
  if not found then raise exception using errcode='40001',
    message='SEMANTIC_SUCCESSOR_APPROVED_CANDIDATE_REQUIRED'; end if;

  insert into semantic.semantic_publish_attempt(
    app_id,tenant_id,environment,semantic_domain,attempt_id,packet_id,candidate_id,
    attempt_state,approval_mode,compiler_bundle_digest,catalog_fence_epoch,
    dependency_generation,target_generation,idempotency_digest)
  values(pointer.app_id,pointer.tenant_id,pointer.environment,pointer.semantic_domain,
    attempt_id,task.packet_id,candidate.candidate_id,'PREPARED','HUMAN_REVIEW',
    p_command->>'compiler_bundle_digest',dependency.current_catalog_epoch,
    dependency.pointer_generation,(p_command->>'target_generation')::bigint,
    p_command->>'idempotency_digest');

  return pg_catalog.jsonb_build_object(
    'attempt_id',attempt_id,'attempt_state','PREPARED','change_set_ref',change_set_ref,
    'review_ref',pg_catalog.jsonb_build_object(
      'review_id',task.packet_id,'review_hash',review_record.review_hash),
    'review_document',review_record.review_document,'created',true);
end
$function$;
create or replace function semantic.record_review_decision(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,
  p_packet_id uuid,p_principal text,p_semantic_role text,p_decision text,
  p_decision_reason text default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare
  task semantic.semantic_review_task%rowtype;
  decision_id uuid:=extensions.gen_random_uuid();
  decision_digest text;
  total_approvals integer;
  total_rejections integer;
  required_approvals integer;
  veto_count integer;
  min_reviewers integer;
  decision_set_digest text;
  strict_successor boolean;
  policy_ref jsonb;
  change_set jsonb;
  reason_codes jsonb;
  review_material jsonb;
  review_document jsonb;
  now_at timestamptz:=pg_catalog.clock_timestamp();
  result jsonb;
begin
  if p_decision not in ('APPROVE','REJECT')
    or p_semantic_role not in ('domain_reviewer','security_reviewer','admin_reviewer')
  then raise exception using errcode='22023',message='SEMANTIC_REVIEW_DECISION_INVALID'; end if;

  perform semantic.lock_semantic_authority_fence(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain);
  perform semantic.lock_packet(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_packet_id);
  perform semantic.assert_review_packet_open(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_packet_id);

  select review_task.* into task from semantic.semantic_review_task as review_task
  where review_task.app_id=p_app_id and review_task.tenant_id=p_tenant_id
    and review_task.environment=p_environment
    and review_task.semantic_domain=p_semantic_domain
    and review_task.packet_id=p_packet_id
  for update;
  if not found or task.approval_mode<>'HUMAN_REVIEW'
  then raise exception using errcode='P0002',message='SEMANTIC_REVIEW_PACKET_NOT_FOUND'; end if;

  perform semantic.verify_principal_not_excluded(p_principal,task.exclusion_set);
  strict_successor:=task.packet_payload->>'schema_version'=
    'semantic-successor-review-packet@1.0.0';
  policy_ref:=task.packet_payload->'review_policy_ref';
  change_set:=task.packet_payload->'change_set';
  if strict_successor and (
      task.packet_kind<>'CANDIDATE_REVIEW'
      or task.candidate_id is null
      or not semantic.u5_json_has_exact_keys(policy_ref,array[
        'policy_version','policy_digest']::text[])
      or coalesce(policy_ref->>'policy_version','')!~'^[1-9][0-9]{0,15}$'
      or coalesce(policy_ref->>'policy_digest','')!~'^sha256:[0-9a-f]{64}$'
      or change_set->>'schema_version'<>'semantic-change-set@1.0.0'
      or change_set->>'lifecycle_state'<>'REVIEW_FROZEN'
      or change_set#>>'{validation,outcome}'<>'PASS'
      or change_set->>'change_set_id'<>task.candidate_id::text
      or coalesce(change_set->>'change_set_hash','')!~'^sha256:[0-9a-f]{64}$'
      or app_data_agent.u2_canonical_sha256(change_set-'change_set_hash')<>
        change_set->>'change_set_hash'
      or p_principal!~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (p_decision_reason is not null and
        (pg_catalog.length(pg_catalog.btrim(p_decision_reason))<1
          or pg_catalog.length(pg_catalog.btrim(p_decision_reason))>128))
    )
  then raise exception using errcode='22023',
    message='SEMANTIC_SUCCESSOR_REVIEW_PACKET_INVALID'; end if;

  perform 1 from semantic.semantic_reviewer_assignment as assignment
  where assignment.app_id=p_app_id and assignment.tenant_id=p_tenant_id
    and assignment.environment=p_environment and assignment.semantic_domain=p_semantic_domain
    and assignment.principal=p_principal and assignment.semantic_role=p_semantic_role
    and assignment.is_active=true
    and (assignment.expires_at is null or assignment.expires_at>now_at)
    and (not strict_successor
      or assignment.policy_version=(policy_ref->>'policy_version')::bigint);
  if not found then raise exception using errcode='42501',message='SEMANTIC_REVIEWER_REQUIRED'; end if;

  if strict_successor then
    perform 1 from semantic.semantic_reviewer_policy_pointer as current_policy
    where current_policy.app_id=p_app_id and current_policy.tenant_id=p_tenant_id
      and current_policy.environment=p_environment
      and current_policy.semantic_domain=p_semantic_domain
      and current_policy.current_policy_version=(policy_ref->>'policy_version')::bigint
      and current_policy.current_policy_digest=policy_ref->>'policy_digest';
    if not found then raise exception using errcode='40001',
      message='SEMANTIC_SUCCESSOR_REVIEW_POLICY_STALE'; end if;
    reason_codes:=case when p_decision_reason is null then '[]'::jsonb
      else pg_catalog.jsonb_build_array(pg_catalog.btrim(p_decision_reason)) end;
    review_material:=pg_catalog.jsonb_build_object(
      'schema_version','semantic-review-decision@1.0.0',
      'review_id',p_packet_id,
      'scope',pg_catalog.jsonb_build_object(
        'app_id',p_app_id,'tenant_id',p_tenant_id,'environment',p_environment,
        'semantic_domain',p_semantic_domain),
      'change_set_id',task.candidate_id,
      'change_set_hash',change_set->>'change_set_hash',
      'reviewer_principal_id',p_principal::uuid,
      'decision',p_decision,
      'reason_codes',reason_codes,
      'reviewed_at',app_data_agent.runtime_iso_timestamp(now_at));
    decision_digest:=app_data_agent.u2_canonical_sha256(review_material);
    review_document:=review_material||pg_catalog.jsonb_build_object(
      'review_hash',decision_digest);
  else
    decision_digest:=semantic.semantic_sha256(
      p_packet_id::text||p_principal||p_semantic_role||p_decision||
        coalesce(p_decision_reason,''),
      pg_catalog.jsonb_build_object('version','1.0.0','kind','review_decision'));
  end if;

  insert into semantic.semantic_review_decision(
    app_id,tenant_id,environment,semantic_domain,packet_id,decision_id,
    principal,semantic_role,decision,decision_reason,decision_digest,created_at)
  values(p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_packet_id,decision_id,
    p_principal,p_semantic_role,p_decision,p_decision_reason,decision_digest,now_at);
  if strict_successor then
    insert into semantic.semantic_successor_review_decision_document(
      app_id,tenant_id,environment,semantic_domain,packet_id,decision_id,
      review_hash,review_document,created_at)
    values(p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_packet_id,decision_id,
      decision_digest,review_document,now_at);
  end if;

  select pg_catalog.count(*) filter(where decision='APPROVE'),
    pg_catalog.count(*) filter(where decision='REJECT')
  into total_approvals,total_rejections
  from semantic.semantic_review_decision as review_decision
  where review_decision.app_id=p_app_id and review_decision.tenant_id=p_tenant_id
    and review_decision.environment=p_environment
    and review_decision.semantic_domain=p_semantic_domain
    and review_decision.packet_id=p_packet_id;

  veto_count:=coalesce((task.veto_rules_snapshot->>'min_veto_count')::integer,1);
  if p_decision='REJECT' and total_rejections>=veto_count then
    update semantic.semantic_review_task set decision_window_status='CLOSED',
      review_outcome='VETOED',closed_at=now_at
    where app_id=p_app_id and tenant_id=p_tenant_id and environment=p_environment
      and semantic_domain=p_semantic_domain and packet_id=p_packet_id;
    if task.candidate_id is not null then
      update semantic.semantic_candidate set candidate_status='REJECTED',updated_at=now_at
      where app_id=p_app_id and tenant_id=p_tenant_id and environment=p_environment
        and semantic_domain=p_semantic_domain and candidate_id=task.candidate_id
        and candidate_status in ('REVIEW_SUBMITTED','WAITING_REVIEW');
    end if;
    result:=pg_catalog.jsonb_build_object(
      'decision_id',decision_id,'decision_digest',decision_digest,
      'packet_closed',true,'outcome','VETOED','total_approvals',total_approvals,
      'total_rejections',total_rejections);
  else
    required_approvals:=(task.quorum_rules_snapshot->>'required_approvals')::integer;
    if required_approvals is null then
      min_reviewers:=(task.quorum_rules_snapshot->>'min_reviewers')::integer;
      required_approvals:=coalesce(min_reviewers,1);
    end if;
    if total_approvals>=required_approvals then
      decision_set_digest:=semantic.semantic_sha256(
        p_packet_id::text||total_approvals::text||total_rejections::text,
        pg_catalog.jsonb_build_object('version','1.0.0','kind','decision_set'));
      update semantic.semantic_review_task set decision_window_status='CLOSED',
        review_outcome='APPROVED',closed_at=now_at
      where app_id=p_app_id and tenant_id=p_tenant_id and environment=p_environment
        and semantic_domain=p_semantic_domain and packet_id=p_packet_id;
      if task.candidate_id is not null then
        update semantic.semantic_candidate set candidate_status='APPROVED',updated_at=now_at
        where app_id=p_app_id and tenant_id=p_tenant_id and environment=p_environment
          and semantic_domain=p_semantic_domain and candidate_id=task.candidate_id
          and candidate_status in ('REVIEW_SUBMITTED','WAITING_REVIEW');
      end if;
      result:=pg_catalog.jsonb_build_object(
        'decision_id',decision_id,'decision_digest',decision_digest,
        'packet_closed',true,'outcome','APPROVED',
        'decision_set_digest',decision_set_digest,'total_approvals',total_approvals,
        'total_rejections',total_rejections);
    else
      result:=pg_catalog.jsonb_build_object(
        'decision_id',decision_id,'decision_digest',decision_digest,
        'packet_closed',false,'outcome','PENDING','total_approvals',total_approvals,
        'total_rejections',total_rejections,'required_approvals',required_approvals);
    end if;
  end if;
  return result;
end
$function$;

create function semantic.human_record_semantic_review_decision(p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare scope_json jsonb; principal_id uuid;
begin
  if p_command is null or not semantic.u5_json_has_exact_keys(p_command,array[
    'schema_version','scope','semantic_domain','packet_id','principal_id',
    'semantic_role','decision','decision_reason'
  ]::text[]) or p_command->>'schema_version'<>'human-semantic-review-decision@1.0.0'
    or coalesce(p_command->>'packet_id','')!~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_command->>'principal_id','')!~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_command->>'semantic_role' not in
      ('domain_reviewer','security_reviewer','admin_reviewer')
    or p_command->>'decision' not in ('APPROVE','REJECT')
    or (p_command->'decision_reason'<>'null'::jsonb
      and pg_catalog.jsonb_typeof(p_command->'decision_reason')<>'string')
  then raise exception using errcode='22023',message='SEMANTIC_HUMAN_REVIEW_COMMAND_INVALID'; end if;
  scope_json:=p_command->'scope';
  perform semantic.assert_u5_scope(scope_json,p_command->>'semantic_domain',true);
  principal_id:=nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid;
  if principal_id is distinct from (p_command->>'principal_id')::uuid
  then raise exception using errcode='42501',message='SEMANTIC_HUMAN_REVIEW_SCOPE_FORBIDDEN'; end if;
  return semantic.record_review_decision(
    (scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,
    scope_json->>'environment',p_command->>'semantic_domain',
    (p_command->>'packet_id')::uuid,p_command->>'principal_id',
    p_command->>'semantic_role',p_command->>'decision',p_command->>'decision_reason');
end
$function$;
alter table semantic.semantic_successor_review_preparation
  owner to data_agent_u6_data_owner;
alter table semantic.semantic_successor_review_decision_document
  owner to data_agent_u6_data_owner;

alter table semantic.semantic_successor_review_preparation enable row level security;
alter table semantic.semantic_successor_review_preparation force row level security;
alter table semantic.semantic_successor_review_decision_document enable row level security;
alter table semantic.semantic_successor_review_decision_document force row level security;

create policy semantic_successor_review_preparation_rpc
on semantic.semantic_successor_review_preparation for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
  and principal_id=nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid);

create policy semantic_successor_review_document_rpc
on semantic.semantic_successor_review_decision_document for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_review_document_insert_rpc
on semantic.semantic_successor_review_decision_document for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));

create policy semantic_successor_review_task_insert_rpc
on semantic.semantic_review_task for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
  and approval_mode='HUMAN_REVIEW');
create policy semantic_successor_review_decision_select_rpc
on semantic.semantic_review_decision for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_review_decision_insert_rpc
on semantic.semantic_review_decision for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
  and principal=nullif(pg_catalog.current_setting('data_agent.principal_id',true),''));
create policy semantic_successor_reviewer_policy_revision_rpc
on semantic.semantic_reviewer_policy_revision for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_reviewer_policy_pointer_rpc
on semantic.semantic_reviewer_policy_pointer for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_reviewer_assignment_rpc
on semantic.semantic_reviewer_assignment for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));

grant select,insert on table semantic.semantic_successor_review_preparation
  to data_agent_u6_rpc_owner;
grant select,insert on table semantic.semantic_successor_review_decision_document
  to data_agent_u6_rpc_owner;
grant select,insert,update on table semantic.semantic_review_task
  to data_agent_u6_rpc_owner;
grant select,insert on table semantic.semantic_review_decision
  to data_agent_u6_rpc_owner;
grant select on table semantic.semantic_reviewer_policy_revision,
  semantic.semantic_reviewer_policy_pointer,semantic.semantic_reviewer_assignment
  to data_agent_u6_rpc_owner;

alter function semantic.prepare_falcon24_successor_review(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.record_review_decision(uuid,uuid,text,text,uuid,text,text,text,text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.human_record_semantic_review_decision(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.prepare_falcon24_successor_publish_attempt(jsonb)
  owner to data_agent_u6_rpc_owner;

grant execute on function
  semantic.lock_semantic_authority_fence(uuid,uuid,text,text),
  semantic.lock_packet(uuid,uuid,text,text,uuid),
  semantic.assert_review_packet_open(uuid,uuid,text,text,uuid),
  semantic.verify_principal_not_excluded(text,jsonb),
  semantic.u5_json_has_exact_keys(jsonb,text[]),
  semantic.assert_u5_scope(jsonb,text,boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.runtime_iso_timestamp(timestamptz)
to data_agent_u6_rpc_owner;
grant execute on function
  semantic.record_review_decision(uuid,uuid,text,text,uuid,text,text,text,text)
to data_agent_u6_rpc_owner;

revoke all on table semantic.semantic_successor_review_preparation,
  semantic.semantic_successor_review_decision_document
from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function
  semantic.prepare_falcon24_successor_review(jsonb),
  semantic.record_review_decision(uuid,uuid,text,text,uuid,text,text,text,text),
  semantic.human_record_semantic_review_decision(jsonb),
  semantic.prepare_falcon24_successor_publish_attempt(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function
  semantic.prepare_falcon24_successor_review(jsonb),
  semantic.human_record_semantic_review_decision(jsonb),
  semantic.prepare_falcon24_successor_publish_attempt(jsonb)
to data_agent_backend;
do $postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'semantic.semantic_successor_review_preparation',
    'semantic.semantic_successor_review_decision_document'
  ]::text[] loop
    if pg_catalog.to_regclass(relation_name) is null
      or not exists(select 1 from pg_catalog.pg_class as relation
        where relation.oid=pg_catalog.to_regclass(relation_name)
          and relation.relrowsecurity and relation.relforcerowsecurity)
      or pg_catalog.has_table_privilege('data_agent_backend',relation_name,'SELECT,INSERT,UPDATE,DELETE')
    then raise exception using errcode='P0001',
      message='SEMANTIC_SUCCESSOR_REVIEW_PREPARATION_POSTCONDITION_FAILED',
      detail=relation_name; end if;
  end loop;

  if pg_catalog.to_regprocedure(
      'semantic.prepare_falcon24_successor_review(jsonb)') is null
    or pg_catalog.to_regprocedure(
      'semantic.human_record_semantic_review_decision(jsonb)') is null
    or pg_catalog.to_regprocedure(
      'semantic.prepare_falcon24_successor_publish_attempt(jsonb)') is null
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'semantic.prepare_falcon24_successor_review(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'semantic.human_record_semantic_review_decision(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'semantic.prepare_falcon24_successor_publish_attempt(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'semantic.record_review_decision(uuid,uuid,text,text,uuid,text,text,text,text)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'semantic.prepare_falcon24_successor_review(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',
    message='SEMANTIC_SUCCESSOR_REVIEW_PREPARATION_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010792_app_data_agent_semantic_successor_review_preparation',
  'sha256:718dcb449c86f047d4d90b3e0336a5aa008259acf47d29932de3c03f349724e6');

commit;
