-- semantic_bootstrap_release_migration_checksum: sha256:efe4a1d3fbfef53e6bb22470e652926f0d7938a7e750806288a7570c76dca0ac
-- ============================================================
-- 10656: Greenfield Semantic Bootstrap Release Authority
-- Depends on 10655 Ontology Package Authority and 10610 governance baseline.
-- Forward-only empty Authority; no import, backfill, dual-read or benchmark data.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_BOOTSTRAP_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_BOOTSTRAP_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010655_app_data_agent_ontology_package_authority'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_BOOTSTRAP_BASELINE_10655_MISSING';
  end if;
  if pg_catalog.to_regclass('semantic.semantic_source_release') is null
    or pg_catalog.to_regclass('semantic.ontology_package_candidates') is null
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_BOOTSTRAP_AUTHORITY_DEPENDENCY_MISSING';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u5_data_owner') then
    create role data_agent_u5_data_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u5_verifier_owner') then
    create role data_agent_u5_verifier_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u5_publisher_owner') then
    create role data_agent_u5_publisher_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'data_agent_u5_human_governance_owner') then
    create role data_agent_u5_human_governance_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
-- ============================================================
-- Forward-only governance mode extension. Existing rows remain HUMAN_REVIEW.
-- ============================================================

alter table semantic.semantic_review_task
  add column approval_mode text not null default 'HUMAN_REVIEW';
alter table semantic.semantic_review_task
  drop constraint semantic_review_task_packet_kind_check;
alter table semantic.semantic_review_task
  add constraint semantic_review_task_packet_kind_check check (
    (approval_mode = 'HUMAN_REVIEW' and packet_kind in (
      'CANDIDATE_REVIEW','ROLLBACK_REVIEW','LEGACY_CLOSURE_REVIEW'
    )) or
    (approval_mode = 'SYSTEM_BOOTSTRAP_POLICY' and packet_kind = 'SYSTEM_BOOTSTRAP_ADMISSION')
  );
alter table semantic.semantic_review_task
  add constraint semantic_review_task_approval_mode_check
  check (approval_mode in ('HUMAN_REVIEW','SYSTEM_BOOTSTRAP_POLICY'));

alter table semantic.semantic_publish_attempt
  add column approval_mode text not null default 'HUMAN_REVIEW'
  check (approval_mode in ('HUMAN_REVIEW','SYSTEM_BOOTSTRAP_POLICY'));
alter table semantic.semantic_source_release
  add column approval_mode text not null default 'HUMAN_REVIEW'
  check (approval_mode in ('HUMAN_REVIEW','SYSTEM_BOOTSTRAP_POLICY'));

create function semantic.reject_system_bootstrap_human_decision()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if exists (
    select 1 from semantic.semantic_review_task as task
    where task.app_id = new.app_id and task.tenant_id = new.tenant_id
      and task.environment = new.environment and task.semantic_domain = new.semantic_domain
      and task.packet_id = new.packet_id
      and task.approval_mode = 'SYSTEM_BOOTSTRAP_POLICY'
  ) then
    raise exception using errcode = '42501', message = 'SEMANTIC_BOOTSTRAP_HUMAN_DECISION_FORBIDDEN';
  end if;
  return new;
end
$function$;

create trigger semantic_review_decision_system_bootstrap_guard
before insert or update on semantic.semantic_review_decision
for each row execute function semantic.reject_system_bootstrap_human_decision();
-- ============================================================
-- U5 append-only Authority and receipt tables.
-- ============================================================

create table semantic.semantic_bootstrap_signer_key_revisions (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  key_id text not null,
  key_revision bigint not null check (key_revision between 1 and 9007199254740991),
  principal_id uuid not null,
  signer_role text not null check (signer_role in ('WORKSPACE_ADMIN','PLATFORM_ATTESTOR')),
  key_purpose text not null check (key_purpose in ('SEMANTIC_BOOTSTRAP_ADMIN_SIGNATURE','PLATFORM_ATTESTATION')),
  key_status text not null default 'STAGED' check (key_status in ('STAGED','ACTIVE','COMPROMISED','RETIRED')),
  public_material jsonb not null,
  public_material_hash text not null check (public_material_hash ~ '^sha256:[0-9a-f]{64}$'),
  activation_receipt_hash text check (activation_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  revocation_epoch bigint not null default 0,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,semantic_domain,key_id,key_revision),
  unique (app_id,tenant_id,environment,semantic_domain,public_material_hash),
  check (
    (signer_role='WORKSPACE_ADMIN' and key_purpose='SEMANTIC_BOOTSTRAP_ADMIN_SIGNATURE') or
    (signer_role='PLATFORM_ATTESTOR' and key_purpose='PLATFORM_ATTESTATION')
  ),
  check ((key_status='ACTIVE') = (activation_receipt_hash is not null) or key_status in ('COMPROMISED','RETIRED'))
);

create table semantic.semantic_bootstrap_signer_activations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  activation_id uuid not null,
  key_id text not null,
  key_revision bigint not null,
  challenge_hash text not null check (challenge_hash ~ '^sha256:[0-9a-f]{64}$'),
  proof_signature_hash text not null check (proof_signature_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  activated_at timestamptz not null,
  primary key (app_id,tenant_id,environment,semantic_domain,activation_id),
  unique (app_id,tenant_id,environment,semantic_domain,key_id,key_revision),
  foreign key (app_id,tenant_id,environment,semantic_domain,key_id,key_revision)
    references semantic.semantic_bootstrap_signer_key_revisions
      (app_id,tenant_id,environment,semantic_domain,key_id,key_revision) on delete restrict
);

create table semantic.verified_semantic_domain_bootstrap_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  receipt_id uuid not null,
  datasource_id uuid not null,
  packet_id uuid not null,
  packet_digest text not null check (packet_digest ~ '^sha256:[0-9a-f]{64}$'),
  release_set_id uuid not null,
  candidate_id uuid not null,
  candidate_revision_id uuid not null,
  candidate_set_hash text not null check (candidate_set_hash ~ '^sha256:[0-9a-f]{64}$'),
  policy_id uuid not null,
  policy_revision bigint not null,
  policy_hash text not null check (policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  nonce_hash text not null check (nonce_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null,
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  verified_at timestamptz not null,
  primary key (app_id,tenant_id,environment,semantic_domain,receipt_id),
  unique (app_id,tenant_id,environment,semantic_domain,packet_digest),
  unique (app_id,tenant_id,environment,semantic_domain,nonce_hash),
  unique (app_id,tenant_id,environment,semantic_domain,receipt_id,receipt_hash)
);

create table semantic.semantic_bootstrap_policy_revisions (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  policy_id uuid not null,
  policy_revision bigint not null,
  policy_json jsonb not null,
  policy_hash text not null check (policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,semantic_domain,policy_id,policy_revision),
  unique (app_id,tenant_id,environment,semantic_domain,policy_hash),
  check (valid_until > valid_from)
);

create table semantic.semantic_bootstrap_policy_pointer (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  policy_id uuid not null,
  policy_revision bigint not null,
  policy_hash text not null,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,semantic_domain),
  foreign key (app_id,tenant_id,environment,semantic_domain,policy_id,policy_revision)
    references semantic.semantic_bootstrap_policy_revisions
      (app_id,tenant_id,environment,semantic_domain,policy_id,policy_revision) on delete restrict
);

create table semantic.semantic_bootstrap_publisher_grants (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  grant_id uuid not null,
  grant_hash text not null check (grant_hash ~ '^sha256:[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  idempotency_key text not null,
  grant_nonce uuid not null,
  command_json jsonb not null,
  issuer_principal_id uuid not null,
  operator_principal_id uuid not null,
  release_set_id uuid not null,
  candidate_set_hash text not null check (candidate_set_hash ~ '^sha256:[0-9a-f]{64}$'),
  policy_id uuid not null,
  policy_revision bigint not null,
  policy_hash text not null,
  revocation_epoch bigint not null,
  grant_status text not null default 'ACTIVE' check (grant_status in ('ACTIVE','REVOKED','CONSUMED','EXPIRED')),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  primary key (app_id,tenant_id,environment,semantic_domain,grant_id),
  unique (app_id,tenant_id,environment,semantic_domain,grant_hash),
  unique (app_id,tenant_id,environment,semantic_domain,issuer_principal_id,idempotency_key),
  unique (app_id,tenant_id,environment,semantic_domain,grant_nonce),
  check (expires_at > issued_at),
  check ((grant_status='CONSUMED') = (consumed_at is not null))
);

create table semantic.semantic_bootstrap_validation_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  receipt_id uuid not null,
  candidate_id uuid not null,
  candidate_revision_id uuid not null,
  candidate_set_hash text not null check (candidate_set_hash ~ '^sha256:[0-9a-f]{64}$'),
  policy_hash text not null check (policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null,
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  validated_at timestamptz not null,
  primary key (app_id,tenant_id,environment,semantic_domain,receipt_id),
  unique (app_id,tenant_id,environment,semantic_domain,receipt_id,receipt_hash)
);

create table semantic.initial_semantic_release_sets (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  release_set_id uuid not null,
  release_id uuid not null,
  release_set_hash text not null check (release_set_hash ~ '^sha256:[0-9a-f]{64}$'),
  candidate_id uuid not null,
  candidate_revision_id uuid not null,
  policy_hash text not null,
  validation_receipt_id uuid not null,
  validation_receipt_hash text not null,
  release_set_json jsonb not null,
  published_at timestamptz not null,
  primary key (app_id,tenant_id,environment,semantic_domain,release_set_id),
  unique (app_id,tenant_id,environment,semantic_domain,release_id),
  unique (app_id,tenant_id,environment,semantic_domain,release_set_hash)
);

create table semantic.initial_semantic_release_package_bindings (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  release_set_id uuid not null,
  namespace_id uuid not null,
  package_id uuid not null,
  package_version bigint not null,
  package_hash text not null,
  validation_receipt_id uuid not null,
  validation_receipt_hash text not null,
  preview_id uuid not null,
  preview_hash text not null,
  graph_projection_id uuid not null,
  graph_projection_hash text not null,
  binding_json jsonb not null,
  primary key (app_id,tenant_id,environment,semantic_domain,release_set_id,package_id,package_version),
  foreign key (app_id,tenant_id,environment,semantic_domain,release_set_id)
    references semantic.initial_semantic_release_sets
      (app_id,tenant_id,environment,semantic_domain,release_set_id) on delete restrict,
  foreign key (app_id,tenant_id,environment,semantic_domain,package_id,package_version,package_hash)
    references semantic.ontology_package_candidates
      (app_id,tenant_id,environment,semantic_domain,package_id,package_version,package_hash) on delete restrict,
  foreign key (app_id,tenant_id,environment,semantic_domain,validation_receipt_id,validation_receipt_hash)
    references semantic.ontology_package_validation_receipts
      (app_id,tenant_id,environment,semantic_domain,receipt_id,receipt_hash) on delete restrict,
  foreign key (app_id,tenant_id,environment,semantic_domain,preview_id)
    references semantic.ontology_package_preview_bindings
      (app_id,tenant_id,environment,semantic_domain,preview_id) on delete restrict,
  foreign key (app_id,tenant_id,environment,semantic_domain,graph_projection_id)
    references semantic.semantic_graph_projection
      (app_id,tenant_id,environment,semantic_domain,projection_id) on delete restrict
);

create table semantic.semantic_package_admission_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  receipt_id uuid not null,
  release_set_id uuid not null,
  package_id uuid not null,
  package_version bigint not null,
  package_hash text not null,
  receipt_json jsonb not null,
  receipt_hash text not null,
  admitted_at timestamptz not null,
  primary key (app_id,tenant_id,environment,semantic_domain,receipt_id),
  unique (app_id,tenant_id,environment,semantic_domain,release_set_id,package_id,package_version),
  unique (app_id,tenant_id,environment,semantic_domain,receipt_id,receipt_hash)
);

create table semantic.first_release_admission_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  receipt_id uuid not null,
  release_set_id uuid not null,
  receipt_json jsonb not null,
  receipt_hash text not null,
  decision_set_digest text not null,
  admitted_at timestamptz not null,
  primary key (app_id,tenant_id,environment,semantic_domain,receipt_id),
  unique (app_id,tenant_id,environment,semantic_domain,release_set_id),
  unique (app_id,tenant_id,environment,semantic_domain,receipt_id,receipt_hash)
);

create table semantic.semantic_bootstrap_capability_tombstones (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  tombstone_id uuid not null,
  release_set_id uuid not null,
  grant_id uuid not null,
  tombstone_json jsonb not null,
  tombstone_hash text not null,
  closed_at timestamptz not null,
  primary key (app_id,tenant_id,environment,semantic_domain),
  unique (app_id,tenant_id,environment,semantic_domain,tombstone_id),
  unique (app_id,tenant_id,environment,semantic_domain,tombstone_hash)
);

create table semantic.semantic_bootstrap_publish_idempotency (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  principal_id uuid not null,
  idempotency_key text not null,
  request_hash text not null,
  result_json jsonb not null,
  committed_at timestamptz not null,
  primary key (app_id,tenant_id,environment,semantic_domain,principal_id,idempotency_key)
);

create table semantic.semantic_bootstrap_outbox (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  outbox_id uuid not null,
  release_set_id uuid not null,
  topic text not null check (topic='semantic.initial_release.published'),
  payload_json jsonb not null,
  payload_hash text not null,
  created_at timestamptz not null,
  primary key (app_id,tenant_id,environment,semantic_domain,outbox_id),
  unique (app_id,tenant_id,environment,semantic_domain,release_set_id)
);
-- ============================================================
-- Strict JSON, scope, mutation and canonical Authority helpers.
-- ============================================================

create function semantic.u5_json_has_exact_keys(p_value jsonb,p_keys text[])
returns boolean language sql immutable strict set search_path = '' as $function$
  select pg_catalog.jsonb_typeof(p_value)='object'
    and p_value - p_keys = '{}'::jsonb
    and not exists (
      select 1 from pg_catalog.unnest(p_keys) as required(key)
      where not p_value ? required.key
    )
$function$;

create function semantic.assert_u5_scope(p_scope jsonb,p_semantic_domain text,p_require_write boolean)
returns void language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_app_id uuid;
  v_tenant_id uuid;
  v_environment text;
begin
  if p_scope is null or not semantic.u5_json_has_exact_keys(
    p_scope,array['app_id','tenant_id','workspace_id','environment']::text[]
  ) or coalesce(p_scope->>'app_id','') !~* '^[0-9a-f-]{36}$'
    or coalesce(p_scope->>'tenant_id','') !~* '^[0-9a-f-]{36}$'
    or p_scope->>'workspace_id' <> p_scope->>'tenant_id'
    or coalesce(p_semantic_domain,'') !~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'
  then
    raise exception using errcode='22023',message='SEMANTIC_BOOTSTRAP_SCOPE_INVALID';
  end if;
  v_app_id := (p_scope->>'app_id')::uuid;
  v_tenant_id := (p_scope->>'tenant_id')::uuid;
  v_environment := p_scope->>'environment';
  if v_app_id <> '00000000-0000-4000-8000-00000000da01'::uuid
    or nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid is distinct from v_app_id
    or nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid is distinct from v_tenant_id
    or nullif(pg_catalog.current_setting('data_agent.environment',true),'') is distinct from v_environment
    or nullif(pg_catalog.current_setting('app.semantic_domain',true),'') is distinct from p_semantic_domain
    or not platform.backend_context_matches(v_app_id,v_tenant_id,v_environment,p_require_write)
  then
    raise exception using errcode='42501',message='SEMANTIC_BOOTSTRAP_SCOPE_MISMATCH';
  end if;
end
$function$;

create function semantic.reject_u5_immutable_mutation()
returns trigger language plpgsql set search_path = '' as $function$
begin
  raise exception using errcode='55000',message='SEMANTIC_BOOTSTRAP_AUTHORITY_IMMUTABLE';
end
$function$;

create function semantic.guard_u5_key_transition()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if old.app_id<>new.app_id or old.tenant_id<>new.tenant_id or old.environment<>new.environment
    or old.semantic_domain<>new.semantic_domain or old.key_id<>new.key_id
    or old.key_revision<>new.key_revision or old.principal_id<>new.principal_id
    or old.signer_role<>new.signer_role or old.key_purpose<>new.key_purpose
    or old.public_material<>new.public_material or old.public_material_hash<>new.public_material_hash
    or old.revocation_epoch>new.revocation_epoch
    or not (
      (old.key_status='STAGED' and new.key_status='ACTIVE' and new.activation_receipt_hash is not null) or
      (old.key_status in ('STAGED','ACTIVE') and new.key_status in ('COMPROMISED','RETIRED'))
    )
  then
    raise exception using errcode='55000',message='SEMANTIC_BOOTSTRAP_KEY_TRANSITION_INVALID';
  end if;
  return new;
end
$function$;

create function semantic.guard_u5_grant_transition()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if old.app_id<>new.app_id or old.tenant_id<>new.tenant_id or old.environment<>new.environment
    or old.semantic_domain<>new.semantic_domain or old.grant_id<>new.grant_id
    or old.grant_hash<>new.grant_hash or old.request_hash<>new.request_hash
    or old.command_json<>new.command_json or old.grant_nonce<>new.grant_nonce
    or old.grant_status<>'ACTIVE' or new.grant_status not in ('CONSUMED','REVOKED','EXPIRED')
    or (new.grant_status='CONSUMED' and new.consumed_at is null)
  then
    raise exception using errcode='55000',message='SEMANTIC_PUBLISHER_GRANT_TRANSITION_INVALID';
  end if;
  return new;
end
$function$;

create trigger u5_signer_key_transition_guard before update on semantic.semantic_bootstrap_signer_key_revisions
for each row execute function semantic.guard_u5_key_transition();
create trigger u5_signer_key_delete_guard before delete on semantic.semantic_bootstrap_signer_key_revisions
for each row execute function semantic.reject_u5_immutable_mutation();
create trigger u5_grant_transition_guard before update on semantic.semantic_bootstrap_publisher_grants
for each row execute function semantic.guard_u5_grant_transition();
create trigger u5_grant_delete_guard before delete on semantic.semantic_bootstrap_publisher_grants
for each row execute function semantic.reject_u5_immutable_mutation();

do $immutable_triggers$
declare v_table text;
begin
  foreach v_table in array array[
    'semantic_bootstrap_signer_activations','verified_semantic_domain_bootstrap_receipts',
    'semantic_bootstrap_policy_revisions','semantic_bootstrap_validation_receipts',
    'initial_semantic_release_sets','initial_semantic_release_package_bindings',
    'semantic_package_admission_receipts','first_release_admission_receipts',
    'semantic_bootstrap_capability_tombstones','semantic_bootstrap_publish_idempotency',
    'semantic_bootstrap_outbox'
  ] loop
    execute pg_catalog.format(
      'create trigger %I before update or delete on semantic.%I for each row execute function semantic.reject_u5_immutable_mutation()',
      'u5_'||v_table||'_immutable',v_table
    );
  end loop;
end
$immutable_triggers$;
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
-- ============================================================
-- Ownership, RLS, grants, and postconditions.
-- ============================================================

do $u5_tables$
declare name text;
begin
  foreach name in array array[
    'semantic_bootstrap_signer_key_revisions','semantic_bootstrap_signer_activations',
    'verified_semantic_domain_bootstrap_receipts','semantic_bootstrap_policy_revisions',
    'semantic_bootstrap_policy_pointer','semantic_bootstrap_publisher_grants',
    'semantic_bootstrap_validation_receipts','initial_semantic_release_sets',
    'initial_semantic_release_package_bindings','semantic_package_admission_receipts',
    'first_release_admission_receipts','semantic_bootstrap_capability_tombstones',
    'semantic_bootstrap_publish_idempotency','semantic_bootstrap_outbox'
  ] loop
    execute pg_catalog.format('alter table semantic.%I owner to data_agent_u5_data_owner',name);
    execute pg_catalog.format('alter table semantic.%I enable row level security',name);
    execute pg_catalog.format('alter table semantic.%I force row level security',name);
    execute pg_catalog.format(
      'create policy %I on semantic.%I for all to data_agent_u5_verifier_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false)) with check (platform.backend_context_matches(app_id,tenant_id,environment,true))',
      'u5_verifier_'||name,name);
    execute pg_catalog.format(
      'create policy %I on semantic.%I for all to data_agent_u5_publisher_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false)) with check (platform.backend_context_matches(app_id,tenant_id,environment,true))',
      'u5_publisher_'||name,name);
  end loop;
end
$u5_tables$;

grant usage on schema semantic,platform,app_data_agent,extensions to
  data_agent_u5_data_owner,data_agent_u5_verifier_owner,data_agent_u5_publisher_owner,
  data_agent_u5_human_governance_owner;

grant select,insert,update on table
  semantic.semantic_bootstrap_signer_key_revisions,
  semantic.semantic_bootstrap_signer_activations,
  semantic.verified_semantic_domain_bootstrap_receipts,
  semantic.semantic_bootstrap_policy_revisions,
  semantic.semantic_bootstrap_policy_pointer,
  semantic.semantic_bootstrap_publisher_grants
to data_agent_u5_verifier_owner;
grant select,insert on table semantic.semantic_domain_registry to data_agent_u5_verifier_owner;
grant select,insert,update on table
  semantic.semantic_authority_fence,semantic.semantic_active_pointer,semantic.semantic_runtime_activation
to data_agent_u5_verifier_owner;

grant select on table
  semantic.verified_semantic_domain_bootstrap_receipts,
  semantic.semantic_bootstrap_policy_revisions,semantic.semantic_bootstrap_policy_pointer
to data_agent_u5_publisher_owner;
grant select,update on table semantic.semantic_bootstrap_publisher_grants
to data_agent_u5_publisher_owner;
grant select,insert,update on table
  semantic.semantic_bootstrap_validation_receipts,semantic.initial_semantic_release_sets,
  semantic.initial_semantic_release_package_bindings,semantic.semantic_package_admission_receipts,
  semantic.first_release_admission_receipts,semantic.semantic_bootstrap_capability_tombstones,
  semantic.semantic_bootstrap_publish_idempotency,semantic.semantic_bootstrap_outbox
to data_agent_u5_publisher_owner;
grant select,update on table
  semantic.semantic_authority_fence,semantic.semantic_active_pointer,semantic.semantic_runtime_activation,
  semantic.semantic_candidate
to data_agent_u5_publisher_owner;
grant select,insert,update on table semantic.semantic_publish_attempt
to data_agent_u5_publisher_owner;
grant select on table semantic.semantic_candidate_revision to data_agent_u5_publisher_owner;
grant select,insert on table
  semantic.semantic_review_task,semantic.semantic_source_release,
  semantic.semantic_executable_projection,semantic.semantic_relationship_projection,
  semantic.semantic_runtime_restriction_projection
to data_agent_u5_publisher_owner;
grant select on table
  semantic.ontology_package_candidates,semantic.ontology_package_validation_receipts,
  semantic.ontology_package_preview_bindings
to data_agent_u5_publisher_owner;
grant insert on table app_data_agent.audit_log to data_agent_u5_publisher_owner;
create policy audit_log_u5_publisher_insert on app_data_agent.audit_log
for insert to data_agent_u5_publisher_owner
with check (platform.backend_context_matches(app_id,tenant_id,environment,true));

grant select,insert,update on table
  semantic.semantic_authority_fence,semantic.semantic_review_task,semantic.semantic_publish_attempt,
  semantic.semantic_source_release,semantic.semantic_active_pointer,semantic.semantic_runtime_activation,
  semantic.semantic_candidate,semantic.semantic_rollback_authorization,semantic.semantic_rollback_receipt
to data_agent_u5_human_governance_owner;
grant select on table semantic.semantic_review_decision to data_agent_u5_human_governance_owner;

do $u5_legacy_policies$
declare name text; role_name text;
begin
  foreach role_name in array array[
    'data_agent_u5_verifier_owner','data_agent_u5_publisher_owner','data_agent_u5_human_governance_owner'
  ] loop
    foreach name in array array[
      'semantic_domain_registry','semantic_authority_fence','semantic_active_pointer','semantic_runtime_activation',
      'semantic_candidate','semantic_candidate_revision','semantic_review_task','semantic_review_decision','semantic_publish_attempt',
      'semantic_source_release','semantic_executable_projection','semantic_relationship_projection',
      'semantic_runtime_restriction_projection','semantic_rollback_authorization','semantic_rollback_receipt',
      'ontology_package_candidates','ontology_package_validation_receipts','ontology_package_preview_bindings'
    ] loop
      if pg_catalog.to_regclass('semantic.'||name) is not null then
        execute pg_catalog.format(
          'create policy %I on semantic.%I for all to %I using (platform.backend_context_matches(app_id,tenant_id,environment,false)) with check (platform.backend_context_matches(app_id,tenant_id,environment,true))',
          'u5_'||pg_catalog.md5(role_name||':'||name),name,role_name);
      end if;
    end loop;
  end loop;
end
$u5_legacy_policies$;

grant execute on function
  platform.backend_context_matches(uuid,uuid,text,boolean),app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text),
  app_data_agent.runtime_canonical_json(jsonb),
  semantic.u5_json_has_exact_keys(jsonb,text[]),semantic.assert_u5_scope(jsonb,text,boolean),
  semantic.lock_semantic_authority_fence(uuid,uuid,text,text)
to data_agent_u5_verifier_owner,data_agent_u5_publisher_owner,data_agent_u5_human_governance_owner;
grant execute on function semantic.semantic_sha256(text,jsonb) to data_agent_u5_human_governance_owner;

alter function semantic.register_semantic_bootstrap_signer_key(jsonb) owner to data_agent_u5_verifier_owner;
alter function semantic.activate_semantic_bootstrap_signer_key(jsonb) owner to data_agent_u5_verifier_owner;
alter function semantic.commit_semantic_bootstrap_policy(jsonb) owner to data_agent_u5_verifier_owner;
alter function semantic.load_semantic_bootstrap_signer_context(jsonb) owner to data_agent_u5_verifier_owner;
alter function semantic.commit_verified_semantic_domain_bootstrap(jsonb) owner to data_agent_u5_verifier_owner;
alter function semantic.create_semantic_bootstrap_publisher_grant(jsonb) owner to data_agent_u5_verifier_owner;
alter function semantic.commit_semantic_bootstrap_validation(jsonb) owner to data_agent_u5_publisher_owner;
alter function semantic.publish_initial_semantic_release_set(jsonb) owner to data_agent_u5_publisher_owner;
alter function semantic.load_initial_semantic_release_set(jsonb) owner to data_agent_u5_publisher_owner;

alter function semantic.prepare_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,bigint,bigint,bigint,text,jsonb)
  owner to data_agent_u5_human_governance_owner;
alter function semantic.commit_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,uuid,text,uuid,text,jsonb,uuid)
  owner to data_agent_u5_human_governance_owner;
alter function semantic.execute_rollback(uuid,uuid,text,text,uuid,uuid,text)
  owner to data_agent_u5_human_governance_owner;
alter function semantic.bootstrap_domain(uuid,uuid,text,text,uuid,text,text,text,text,text,text,jsonb,text,jsonb,text,text,text,uuid,timestamptz)
  owner to data_agent_u5_human_governance_owner;
alter function semantic.human_prepare_publish_attempt(jsonb) owner to data_agent_u5_human_governance_owner;
alter function semantic.human_commit_publish_attempt(jsonb) owner to data_agent_u5_human_governance_owner;
alter function semantic.human_execute_rollback(jsonb) owner to data_agent_u5_human_governance_owner;

revoke all on all tables in schema semantic from public,anon,authenticated;
revoke all on function
  semantic.register_semantic_bootstrap_signer_key(jsonb),
  semantic.activate_semantic_bootstrap_signer_key(jsonb),
  semantic.commit_semantic_bootstrap_policy(jsonb),
  semantic.load_semantic_bootstrap_signer_context(jsonb),
  semantic.commit_verified_semantic_domain_bootstrap(jsonb),
  semantic.create_semantic_bootstrap_publisher_grant(jsonb),
  semantic.commit_semantic_bootstrap_validation(jsonb),
  semantic.publish_initial_semantic_release_set(jsonb),
  semantic.load_initial_semantic_release_set(jsonb),
  semantic.prepare_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,bigint,bigint,bigint,text,jsonb),
  semantic.commit_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,uuid,text,uuid,text,jsonb,uuid),
  semantic.execute_rollback(uuid,uuid,text,text,uuid,uuid,text),
  semantic.bootstrap_domain(uuid,uuid,text,text,uuid,text,text,text,text,text,text,jsonb,text,jsonb,text,text,text,uuid,timestamptz),
  semantic.human_prepare_publish_attempt(jsonb),semantic.human_commit_publish_attempt(jsonb),
  semantic.human_execute_rollback(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;

grant execute on function
  semantic.human_prepare_publish_attempt(jsonb),semantic.human_commit_publish_attempt(jsonb),
  semantic.human_execute_rollback(jsonb)
to data_agent_backend;

do $u5_postconditions$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname like 'data_agent_u5_%_owner'
    and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolinherit or rolbypassrls))
  then raise exception 'SEMANTIC_BOOTSTRAP_OWNER_ROLE_UNSAFE'; end if;
  if pg_catalog.has_function_privilege('anon','semantic.publish_initial_semantic_release_set(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'semantic.bootstrap_domain(uuid,uuid,text,text,uuid,text,text,text,text,text,text,jsonb,text,jsonb,text,text,text,uuid,timestamptz)','EXECUTE')
  then raise exception 'SEMANTIC_BOOTSTRAP_EXECUTE_SURFACE_UNSAFE'; end if;
end
$u5_postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010656_app_data_agent_semantic_bootstrap_release',
  'sha256:efe4a1d3fbfef53e6bb22470e652926f0d7938a7e750806288a7570c76dca0ac'
);

commit;
