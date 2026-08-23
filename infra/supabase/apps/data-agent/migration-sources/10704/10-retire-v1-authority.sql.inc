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
