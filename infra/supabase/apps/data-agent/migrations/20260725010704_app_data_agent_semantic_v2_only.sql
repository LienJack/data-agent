-- semantic_v2_only_migration_checksum: sha256:0dc5388ab38b1e6a295b8774698e7d81fd4b1a26ebd66efeedd5ab0b303d015c
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_V2_ONLY_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_V2_ONLY_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger
    where owner_kind = 'app'
      and app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version = '20260725010703_app_data_agent_commercial_archive_retirement'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_V2_ONLY_BASELINE_10703_MISSING';
  end if;
  if exists (
    select 1 from semantic.semantic_domain_registry
    where app_id <> '00000000-0000-4000-8000-00000000da01'::uuid
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_V2_ONLY_GREENFIELD_SCOPE_MISMATCH';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);
create table if not exists semantic.semantic_v2_retirement_receipts (
  migration_version text primary key,
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  deleted_objects jsonb not null,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table semantic.semantic_v2_retirement_receipts owner to data_agent_u6_data_owner;
alter table semantic.semantic_v2_retirement_receipts enable row level security;
alter table semantic.semantic_v2_retirement_receipts force row level security;
revoke all on table semantic.semantic_v2_retirement_receipts from public, anon, authenticated, service_role, data_agent_backend;

delete from semantic.semantic_review_decision as decision
using semantic.semantic_review_task as task
where task.app_id = decision.app_id
  and task.tenant_id = decision.tenant_id
  and task.environment = decision.environment
  and task.semantic_domain = decision.semantic_domain
  and task.packet_id = decision.packet_id
  and task.packet_kind = 'LEGACY_CLOSURE_REVIEW';

delete from semantic.semantic_review_task where packet_kind = 'LEGACY_CLOSURE_REVIEW';
delete from semantic.semantic_outbox where event_type in (
  'LEGACY_CONTRACT_CLOSED', 'LEGACY_EQUIVALENCE_ATTEMPTED',
  'LEGACY_EQUIVALENCE_COMMITTED', 'LEGACY_CLOSURE_AUTHORIZED',
  'LEGACY_MIRROR_CREATED', 'LEGACY_EQUIVALENCE_RECEIPT_ISSUED'
);

drop function if exists semantic.human_prepare_publish_attempt(jsonb);
drop function if exists semantic.human_commit_publish_attempt(jsonb);
drop function if exists semantic.prepare_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,bigint,bigint,bigint,text,jsonb);
drop function if exists semantic.commit_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,uuid,text,uuid,text,jsonb,uuid);
drop function if exists semantic.self_review_and_publish_semantic_candidate(jsonb);
drop function if exists semantic.activate_runtime(uuid,uuid,text,text,text,bigint,bigint,text,uuid);
drop function if exists semantic.application_rollback(uuid,uuid,text,text,bigint,text,uuid);
drop function if exists semantic.contract_legacy(uuid,uuid,text,text,bigint,uuid,uuid);
drop function if exists semantic.bootstrap_domain(uuid,uuid,text,text,uuid,text,text,text,text,text,text,jsonb,text,jsonb,text,text,text,uuid,timestamptz);

drop policy if exists semantic_candidate_self_publish_candidate_scope on semantic.semantic_candidate;
drop policy if exists semantic_candidate_self_publish_revision_scope on semantic.semantic_candidate_revision;
drop policy if exists semantic_candidate_self_publish_source_scope on semantic.semantic_source_revision;
drop policy if exists semantic_candidate_self_publish_pointer_scope on semantic.semantic_active_pointer;
drop policy if exists semantic_candidate_self_publish_activation_scope on semantic.semantic_runtime_activation;
drop policy if exists semantic_candidate_self_publish_dependency_scope on semantic.semantic_dependency_pointer;
drop policy if exists semantic_candidate_self_publish_domain_scope on semantic.semantic_domain_registry;
drop policy if exists semantic_candidate_self_publish_review_task_scope on semantic.semantic_review_task;
drop policy if exists semantic_candidate_self_publish_decision_scope on semantic.semantic_review_decision;
drop policy if exists semantic_candidate_self_publish_attempt_scope on semantic.semantic_publish_attempt;
drop policy if exists semantic_candidate_self_publish_release_scope on semantic.semantic_source_release;
drop policy if exists semantic_candidate_self_publish_executable_scope on semantic.semantic_executable_projection;
drop policy if exists semantic_candidate_self_publish_relationship_scope on semantic.semantic_relationship_projection;
drop policy if exists semantic_candidate_self_publish_restriction_scope on semantic.semantic_runtime_restriction_projection;
drop policy if exists semantic_candidate_self_publish_usage_scope on app_data_agent.knowledge_semantic_usage_references;
drop policy if exists semantic_candidate_self_publish_audit_scope on app_data_agent.audit_log;

drop table if exists semantic.semantic_candidate_self_publish_idempotency cascade;
drop owned by data_agent_u5_self_publish_owner;
drop role data_agent_u5_self_publish_owner;

drop table if exists semantic.semantic_legacy_compatible_mirror cascade;
drop table if exists semantic.semantic_legacy_equivalence_receipt cascade;
drop table if exists semantic.semantic_legacy_closure_authorization cascade;
drop table if exists semantic.semantic_legacy_equivalence_attempt cascade;

alter table semantic.semantic_publish_attempt
  drop column if exists conditional_legacy_plan,
  drop column if exists committed_legacy_attempt_ref;

alter table semantic.semantic_runtime_activation
  drop column if exists runtime_mode,
  drop column if exists rollback_window_status,
  drop column if exists legacy_contract_status,
  drop column if exists closure_authorization_digest;

do $repair_current_functions$
declare
  definition text;
  repaired text;
begin
  select pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('semantic.commit_verified_semantic_domain_bootstrap(jsonb)')
  ) into strict definition;
  repaired := pg_catalog.replace(
    definition,
    E'insert into semantic.semantic_runtime_activation (\n    app_id,tenant_id,environment,semantic_domain,runtime_mode,activation_generation,current_release_generation\n  ) values ((v_scope->>\'app_id\')::uuid,(v_scope->>\'tenant_id\')::uuid,v_scope->>\'environment\',v_packet->>\'semantic_domain\',\'LEGACY\',1,0);',
    E'insert into semantic.semantic_runtime_activation (\n    app_id,tenant_id,environment,semantic_domain,activation_generation,current_release_generation\n  ) values ((v_scope->>\'app_id\')::uuid,(v_scope->>\'tenant_id\')::uuid,v_scope->>\'environment\',v_packet->>\'semantic_domain\',1,0);'
  );
  if repaired = definition then
    raise exception 'SEMANTIC_V2_ONLY_BOOTSTRAP_REPAIR_MISMATCH';
  end if;
  execute repaired;

  select pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('semantic.publish_initial_semantic_release_set(jsonb)')
  ) into strict definition;
  repaired := pg_catalog.replace(
    definition,
    E'update semantic.semantic_runtime_activation as activation set runtime_mode=\'PUBLISHED_ONLY\',\n    current_release_id=',
    E'update semantic.semantic_runtime_activation as activation set current_release_id='
  );
  if repaired = definition then
    raise exception 'SEMANTIC_V2_ONLY_INITIAL_RELEASE_REPAIR_MISMATCH';
  end if;
  execute repaired;

  select pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure('semantic.commit_published_grounding_bundle_v2(uuid,uuid,text,text,uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,text)')
  ) into strict definition;
  repaired := pg_catalog.replace(
    definition,
    E'  if v_activation.runtime_mode = \'LEGACY\' then\n    raise exception using errcode = \'P0001\', message = \'SEMANTIC_BRIDGE_LEGACY_MODE_UNSUPPORTED\';\n  end if;\n',
    ''
  );
  repaired := pg_catalog.replace(
    repaired,
    E',\n      \'runtime_mode\', v_activation.runtime_mode',
    ''
  );
  if repaired = definition then
    raise exception 'SEMANTIC_V2_ONLY_GROUNDING_REPAIR_MISMATCH';
  end if;
  execute repaired;
end
$repair_current_functions$;

do $constraints$
declare
  constraint_row record;
begin
  for constraint_row in
    select cls.relname, con.conname
    from pg_catalog.pg_constraint as con
    join pg_catalog.pg_class as cls on cls.oid = con.conrelid
    join pg_catalog.pg_namespace as nsp on nsp.oid = cls.relnamespace
    where nsp.nspname = 'semantic'
      and cls.relname in ('semantic_review_task', 'semantic_outbox')
      and (
        pg_catalog.pg_get_constraintdef(con.oid) like '%LEGACY_CLOSURE_REVIEW%'
        or pg_catalog.pg_get_constraintdef(con.oid) like '%LEGACY_EQUIVALENCE%'
        or pg_catalog.pg_get_constraintdef(con.oid) like '%LEGACY_CONTRACT_CLOSED%'
      )
  loop
    execute pg_catalog.format(
      'alter table semantic.%I drop constraint %I',
      constraint_row.relname,
      constraint_row.conname
    );
  end loop;
end
$constraints$;

alter table semantic.semantic_review_task
  add constraint semantic_review_task_packet_kind_v2_only_check
  check (
    (approval_mode = 'HUMAN_REVIEW' and packet_kind in ('CANDIDATE_REVIEW', 'ROLLBACK_REVIEW'))
    or
    (approval_mode = 'SYSTEM_BOOTSTRAP_POLICY' and packet_kind = 'SYSTEM_BOOTSTRAP_ADMISSION')
  );

alter table semantic.semantic_outbox
  add constraint semantic_outbox_event_type_v2_only_check
  check (event_type in (
    'CANDIDATE_SUBMITTED', 'CANDIDATE_APPROVED', 'CANDIDATE_REJECTED',
    'CANDIDATE_PUBLISHED', 'CANDIDATE_STALE', 'REVIEW_PACKET_CREATED',
    'REVIEW_DECISION_RECORDED', 'REVIEW_PACKET_CLOSED', 'REVIEW_PACKET_EXPIRED',
    'PUBLISH_ATTEMPT_PREPARED', 'PUBLISH_ATTEMPT_COMMITTED', 'PUBLISH_ATTEMPT_STALE',
    'SOURCE_RELEASE_CREATED', 'SOURCE_RELEASE_ACTIVATED', 'ROLLBACK_AUTHORIZED',
    'ROLLBACK_EXECUTED', 'RUNTIME_ACTIVATION_CHANGED', 'APPLICATION_ROLLBACK_EXECUTED'
  ));

insert into semantic.semantic_v2_retirement_receipts (
  migration_version,
  app_id,
  deleted_objects
) values (
  '20260725010704_app_data_agent_semantic_v2_only',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  pg_catalog.jsonb_build_array(
    'semantic.semantic_legacy_compatible_mirror',
    'semantic.semantic_legacy_equivalence_receipt',
    'semantic.semantic_legacy_closure_authorization',
    'semantic.semantic_legacy_equivalence_attempt',
    'semantic.semantic_publish_attempt.conditional_legacy_plan',
    'semantic.semantic_publish_attempt.committed_legacy_attempt_ref',
    'semantic.semantic_runtime_activation.runtime_mode',
    'semantic.semantic_runtime_activation.rollback_window_status',
    'semantic.semantic_runtime_activation.legacy_contract_status',
    'semantic.semantic_runtime_activation.closure_authorization_digest',
    'semantic.semantic_candidate_self_publish_idempotency',
    'semantic.self_review_and_publish_semantic_candidate(jsonb)',
    'data_agent_u5_self_publish_owner',
    'semantic.activate_runtime',
    'semantic.application_rollback',
    'semantic.contract_legacy',
    'semantic.bootstrap_domain'
  )
) on conflict (migration_version) do nothing;
create function semantic.prepare_publish_attempt(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,
  p_packet_id uuid,p_candidate_id uuid,p_compiler_bundle_digest text,
  p_catalog_fence_epoch bigint,p_dependency_generation bigint,
  p_target_generation bigint,p_idempotency_digest text
) returns jsonb language plpgsql strict security definer set search_path = '' as $function$
declare v_attempt_id uuid;
begin
  perform semantic.lock_semantic_authority_fence(p_app_id,p_tenant_id,p_environment,p_semantic_domain);
  perform semantic.lock_packet(p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_packet_id);
  perform 1 from semantic.semantic_review_task as task
  where task.app_id=p_app_id and task.tenant_id=p_tenant_id and task.environment=p_environment
    and task.semantic_domain=p_semantic_domain and task.packet_id=p_packet_id
    and task.decision_window_status='CLOSED' and task.review_outcome='APPROVED'
    and (task.publish_expires_at is null or task.publish_expires_at>pg_catalog.clock_timestamp())
  for update;
  if not found then raise exception using errcode='P0001',message='SEMANTIC_PUBLISH_CONFLICT'; end if;
  update semantic.semantic_candidate as candidate
  set candidate_status='PUBLISHING',updated_at=pg_catalog.clock_timestamp()
  where candidate.app_id=p_app_id and candidate.tenant_id=p_tenant_id
    and candidate.environment=p_environment and candidate.semantic_domain=p_semantic_domain
    and candidate.candidate_id=p_candidate_id and candidate.candidate_status='APPROVED';
  if not found then
    raise exception using errcode='P0001',message='SEMANTIC_CANDIDATE_NOT_PUBLISHED';
  end if;
  v_attempt_id:=extensions.gen_random_uuid();
  insert into semantic.semantic_publish_attempt (
    app_id,tenant_id,environment,semantic_domain,attempt_id,packet_id,candidate_id,
    attempt_state,compiler_bundle_digest,catalog_fence_epoch,dependency_generation,
    target_generation,idempotency_digest
  ) values (
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,v_attempt_id,p_packet_id,p_candidate_id,
    'PREPARED',p_compiler_bundle_digest,p_catalog_fence_epoch,p_dependency_generation,
    p_target_generation,p_idempotency_digest
  );
  return pg_catalog.jsonb_build_object(
    'attempt_id',v_attempt_id,'attempt_state','PREPARED','target_generation',p_target_generation
  );
end
$function$;

create function semantic.commit_publish_attempt(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,
  p_attempt_id uuid,p_executable_projection_ref uuid,p_executable_projection_hash text,
  p_relationship_projection_ref uuid,p_relationship_projection_hash text,
  p_runtime_restriction_projection_ref uuid,p_runtime_restriction_projection_hash text,
  p_profile_child_manifest jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_attempt semantic.semantic_publish_attempt%rowtype;
  v_pointer semantic.semantic_active_pointer%rowtype;
  v_quorum_snapshot jsonb;
  v_release_id uuid:=extensions.gen_random_uuid();
  v_release_digest text;
  v_decision_set_digest text;
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
      'version','2.0.0','kind','decision_set',
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
    pg_catalog.jsonb_build_object('version','2.0.0','kind','source_release')
  );
  insert into semantic.semantic_source_release (
    app_id,tenant_id,environment,semantic_domain,release_id,release_generation,attempt_id,
    packet_id,candidate_id,release_digest,compiler_bundle_digest,executable_projection_ref,
    executable_projection_hash,relationship_projection_ref,relationship_projection_hash,
    runtime_restriction_projection_ref,runtime_restriction_projection_hash,
    profile_child_manifest,quorum_snapshot,decision_set_digest,published_by,approval_mode
  ) values (
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,v_release_id,v_attempt.target_generation,
    p_attempt_id,v_attempt.packet_id,v_attempt.candidate_id,v_release_digest,
    v_attempt.compiler_bundle_digest,p_executable_projection_ref,p_executable_projection_hash,
    p_relationship_projection_ref,p_relationship_projection_hash,
    p_runtime_restriction_projection_ref,p_runtime_restriction_projection_hash,
    p_profile_child_manifest,v_quorum_snapshot,v_decision_set_digest,session_user,'HUMAN_REVIEW'
  );
  update semantic.semantic_active_pointer as pointer set
    current_release_id=v_release_id,current_release_generation=v_attempt.target_generation,
    current_release_digest=v_release_digest,pointer_generation=pointer.pointer_generation+1,
    updated_at=pg_catalog.clock_timestamp(),updated_by=session_user
  where pointer.app_id=p_app_id and pointer.tenant_id=p_tenant_id and pointer.environment=p_environment
    and pointer.semantic_domain=p_semantic_domain;
  update semantic.semantic_runtime_activation as activation set
    current_release_id=v_release_id,current_release_generation=v_attempt.target_generation,
    updated_at=pg_catalog.clock_timestamp()
  where activation.app_id=p_app_id and activation.tenant_id=p_tenant_id
    and activation.environment=p_environment and activation.semantic_domain=p_semantic_domain;
  update semantic.semantic_publish_attempt as attempt set
    attempt_state='COMMITTED',committed_release_ref=v_release_id,updated_at=pg_catalog.clock_timestamp()
  where attempt.app_id=p_app_id and attempt.tenant_id=p_tenant_id and attempt.environment=p_environment
    and attempt.semantic_domain=p_semantic_domain and attempt.attempt_id=p_attempt_id;
  update semantic.semantic_candidate as candidate set
    candidate_status='PUBLISHED',updated_at=pg_catalog.clock_timestamp()
  where candidate.app_id=p_app_id and candidate.tenant_id=p_tenant_id
    and candidate.environment=p_environment and candidate.semantic_domain=p_semantic_domain
    and candidate.candidate_id=v_attempt.candidate_id;
  return pg_catalog.jsonb_build_object(
    'release_id',v_release_id,'release_generation',v_attempt.target_generation,
    'release_digest',v_release_digest,'attempt_state','COMMITTED'
  );
end
$function$;

create function semantic.human_prepare_publish_attempt(p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare v_scope jsonb;
begin
  if p_command is null or not semantic.u5_json_has_exact_keys(p_command,array[
    'schema_version','scope','semantic_domain','packet_id','candidate_id','compiler_bundle_digest',
    'catalog_fence_epoch','dependency_generation','target_generation','idempotency_digest'
  ]::text[]) or p_command->>'schema_version'<>'human-prepare-publish-attempt@1.0.0'
  then raise exception using errcode='22023',message='SEMANTIC_HUMAN_PREPARE_COMMAND_INVALID'; end if;
  v_scope:=p_command->'scope';
  perform semantic.assert_u5_scope(v_scope,p_command->>'semantic_domain',true);
  perform 1 from semantic.semantic_review_task as task
  where task.app_id=(v_scope->>'app_id')::uuid and task.tenant_id=(v_scope->>'tenant_id')::uuid
    and task.environment=v_scope->>'environment' and task.semantic_domain=p_command->>'semantic_domain'
    and task.packet_id=(p_command->>'packet_id')::uuid and task.approval_mode='HUMAN_REVIEW';
  if not found then raise exception using errcode='P0001',message='SEMANTIC_HUMAN_REVIEW_REQUIRED'; end if;
  return semantic.prepare_publish_attempt(
    (v_scope->>'app_id')::uuid,(v_scope->>'tenant_id')::uuid,v_scope->>'environment',
    p_command->>'semantic_domain',(p_command->>'packet_id')::uuid,
    (p_command->>'candidate_id')::uuid,p_command->>'compiler_bundle_digest',
    (p_command->>'catalog_fence_epoch')::bigint,(p_command->>'dependency_generation')::bigint,
    (p_command->>'target_generation')::bigint,p_command->>'idempotency_digest'
  );
end
$function$;

create function semantic.human_commit_publish_attempt(p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare v_scope jsonb;
begin
  if p_command is null or not semantic.u5_json_has_exact_keys(p_command,array[
    'schema_version','scope','semantic_domain','attempt_id','executable_projection_ref',
    'executable_projection_hash','relationship_projection_ref','relationship_projection_hash',
    'runtime_restriction_projection_ref','runtime_restriction_projection_hash','profile_child_manifest'
  ]::text[]) or p_command->>'schema_version'<>'human-commit-publish-attempt@1.0.0'
  then raise exception using errcode='22023',message='SEMANTIC_HUMAN_COMMIT_COMMAND_INVALID'; end if;
  v_scope:=p_command->'scope';
  perform semantic.assert_u5_scope(v_scope,p_command->>'semantic_domain',true);
  return semantic.commit_publish_attempt(
    (v_scope->>'app_id')::uuid,(v_scope->>'tenant_id')::uuid,v_scope->>'environment',
    p_command->>'semantic_domain',(p_command->>'attempt_id')::uuid,
    (p_command->>'executable_projection_ref')::uuid,p_command->>'executable_projection_hash',
    (p_command->>'relationship_projection_ref')::uuid,p_command->>'relationship_projection_hash',
    (p_command->>'runtime_restriction_projection_ref')::uuid,
    p_command->>'runtime_restriction_projection_hash',p_command->'profile_child_manifest'
  );
end
$function$;
alter function semantic.prepare_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,bigint,bigint,bigint,text)
  owner to data_agent_u5_human_governance_owner;
alter function semantic.commit_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,uuid,text,uuid,text,jsonb)
  owner to data_agent_u5_human_governance_owner;
alter function semantic.human_prepare_publish_attempt(jsonb)
  owner to data_agent_u5_human_governance_owner;
alter function semantic.human_commit_publish_attempt(jsonb)
  owner to data_agent_u5_human_governance_owner;

revoke all on function
  semantic.prepare_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,bigint,bigint,bigint,text),
  semantic.commit_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,uuid,text,uuid,text,jsonb),
  semantic.human_prepare_publish_attempt(jsonb),
  semantic.human_commit_publish_attempt(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;

grant execute on function
  semantic.human_prepare_publish_attempt(jsonb),
  semantic.human_commit_publish_attempt(jsonb)
to data_agent_backend;

do $postconditions$
begin
  if exists (
    select 1 from pg_catalog.pg_class as cls
    join pg_catalog.pg_namespace as nsp on nsp.oid=cls.relnamespace
    where nsp.nspname='semantic' and cls.relname in (
      'semantic_legacy_compatible_mirror','semantic_legacy_equivalence_receipt',
      'semantic_legacy_closure_authorization','semantic_legacy_equivalence_attempt',
      'semantic_candidate_self_publish_idempotency'
    )
  ) then raise exception 'SEMANTIC_V2_ONLY_TABLE_SURFACE_UNSAFE'; end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='semantic' and (
      (table_name='semantic_publish_attempt' and column_name in (
        'conditional_legacy_plan','committed_legacy_attempt_ref'
      )) or
      (table_name='semantic_runtime_activation' and column_name in (
        'runtime_mode','rollback_window_status','legacy_contract_status','closure_authorization_digest'
      ))
    )
  ) then raise exception 'SEMANTIC_V2_ONLY_COLUMN_SURFACE_UNSAFE'; end if;
  if exists (
    select 1 from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as nsp on nsp.oid=proc.pronamespace
    where nsp.nspname='semantic'
      and proc.prokind in ('f','p')
      and pg_catalog.pg_get_functiondef(proc.oid) ~* 'legacy_(equivalence|closure|compatible)|conditional_legacy|committed_legacy|runtime_mode|rollback_window_status|legacy_contract_status|closure_authorization_digest'
  ) then raise exception 'SEMANTIC_V2_ONLY_FUNCTION_SURFACE_UNSAFE'; end if;
  if pg_catalog.to_regprocedure('semantic.self_review_and_publish_semantic_candidate(jsonb)') is not null
    or exists (select 1 from pg_catalog.pg_roles where rolname='data_agent_u5_self_publish_owner')
  then raise exception 'SEMANTIC_V2_ONLY_SELF_PUBLISH_SURFACE_UNSAFE'; end if;
  if not exists (
    select 1 from semantic.semantic_v2_retirement_receipts
    where migration_version='20260725010704_app_data_agent_semantic_v2_only'
      and pg_catalog.jsonb_array_length(deleted_objects)=17
  ) then raise exception 'SEMANTIC_V2_ONLY_RETIREMENT_RECEIPT_MISSING'; end if;
  if pg_catalog.has_function_privilege(
    'anon','semantic.human_commit_publish_attempt(jsonb)','EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend','semantic.human_commit_publish_attempt(jsonb)','EXECUTE'
  ) then raise exception 'SEMANTIC_V2_ONLY_EXECUTE_SURFACE_UNSAFE'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010704_app_data_agent_semantic_v2_only',
  'sha256:0dc5388ab38b1e6a295b8774698e7d81fd4b1a26ebd66efeedd5ab0b303d015c'
);

commit;
