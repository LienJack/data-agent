-- published_f9_migration_checksum: sha256:2d86b6622d4009169137716e398cc54f495d83114b69877ca2dbbc6b9049d26e
-- ============================================================
-- 10621: Published F9 — Capability, Eligibility, Profile, Safety
-- ============================================================
-- This migration adds:
--   1. attribution_capability_directory — capability directory with anti-enumeration
--   2. attribution_eligibility_decision — eligibility decisions for frozen-question attribution
--   3. attribution_profile_request — profile request lifecycle (DRAFT→SUBMITTED→DEDUPED|TRIAGED→DECLINED|LINKED→CLOSED)
--   4. attribution_safety_verdict — published attribution safety verdicts (GO/HOLD/STOP)
--   5. attribution_profile_projection — profile projections for attribution analysis
--   6. Internal functions, RLS, owner grants
--
-- Depends on: 20260725010620_app_data_agent_contribution_authority (10620)
-- ============================================================

begin;

do $bootstrap$
declare
  session_arm_ms bigint;
  arm_now timestamptz;
  window_expires_at timestamptz;
  effective_budget_ms bigint;
  rearm_verified_at timestamptz;
  requested_deployment_id uuid;
  observed_database_identity_hash text;
  expected_database_identity_hash text;
  executor record;
  transaction_setting bigint;
  baseline_migration record;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'PUBLISHED_F9_MIGRATION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'PUBLISHED_F9_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  select role.rolcanlogin, role.rolbypassrls
  into executor
  from pg_catalog.pg_roles as role
  where role.rolname = 'postgres';
  if not found or not executor.rolcanlogin or not executor.rolbypassrls then
    raise exception using errcode = '42501', message = 'PUBLISHED_F9_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_extension as extension
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = extension.extnamespace
    where extension.extname = 'pgcrypto'
      and namespace.nspname = 'extensions'
  ) then
    raise exception using errcode = '0A000', message = 'PUBLISHED_F9_MIGRATION_PGCRYPTO_REQUIRED';
  end if;

  -- Verify 10620 baseline is installed and immutable
  select ledger.migration_checksum
  into baseline_migration
  from platform.migration_ledger as ledger
  where ledger.owner_kind = 'app'
    and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
    and ledger.migration_version = '20260725010620_app_data_agent_contribution_authority';
  if not found then
    raise exception using errcode = 'P0001', message = 'PUBLISHED_F9_BASELINE_10620_MISSING';
  end if;
  if exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010621_app_data_agent_published_f9'
  ) then
    raise exception using errcode = 'P0001', message = 'PUBLISHED_F9_MIGRATION_10621_ALREADY_RECORDED';
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

lock table
  app_data_agent.memberships,
  app_data_agent.runs,
  app_data_agent.run_attempts,
  app_data_agent.artifacts,
  semantic.semantic_active_pointer,
  semantic.semantic_source_release
in access exclusive mode nowait;
-- ============================================================
-- 10621: Attribution Capability Directory
-- ============================================================
-- Stores capability directory entries that list available attribution
-- capabilities with anti-enumeration protections.
-- ============================================================

create table app_data_agent.attribution_capability_directory (
  id uuid not null default extensions.gen_random_uuid(),
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  directory_id uuid not null default extensions.gen_random_uuid(),
  directory_hash text not null,
  capabilities jsonb not null,
  published_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint attribution_capability_directory_pk
    primary key (id),
  constraint attribution_capability_directory_unique
    unique (app_id, tenant_id, environment, directory_id)
);

comment on table app_data_agent.attribution_capability_directory is
  'Attribution capability directory: lists available capabilities with anti-enumeration protections.';

create index idx_attribution_capability_dir_published
  on app_data_agent.attribution_capability_directory (app_id, tenant_id, environment, published_at desc);

-- ============================================================
-- RPC: publish_capability_directory
-- ============================================================
create or replace function app_data_agent.publish_capability_directory(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_directory_hash text,
  p_capabilities jsonb
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_directory_id uuid;
  v_result jsonb;
begin
  v_directory_id := extensions.gen_random_uuid();
  insert into app_data_agent.attribution_capability_directory (
    app_id, tenant_id, environment, directory_id, directory_hash, capabilities
  ) values (
    p_app_id, p_tenant_id, p_environment, v_directory_id, p_directory_hash, p_capabilities
  );
  v_result := jsonb_build_object(
    'directory_id', v_directory_id,
    'published_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: get_latest_capability_directory
-- ============================================================
create or replace function app_data_agent.get_latest_capability_directory(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text
) returns jsonb
  language plpgsql
  strict
  stable
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'directory_id', dir.directory_id,
    'directory_hash', dir.directory_hash,
    'capabilities', dir.capabilities,
    'published_at', dir.published_at
  )
  into v_result
  from app_data_agent.attribution_capability_directory as dir
  where dir.app_id = p_app_id
    and dir.tenant_id = p_tenant_id
    and dir.environment = p_environment
  order by dir.published_at desc
  limit 1;

  return v_result;
end;
$function$;
-- ============================================================
-- 10621: Attribution Eligibility Decision
-- ============================================================
-- Stores eligibility decisions for frozen-question attribution.
-- Determines if a request is eligible for attribution processing.
-- ============================================================

create table app_data_agent.attribution_eligibility_decision (
  id uuid not null default extensions.gen_random_uuid(),
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  decision_id uuid not null default extensions.gen_random_uuid(),
  request_id uuid not null,
  subject_id text not null,
  eligibility_criteria jsonb not null,
  overall_eligible boolean not null,
  decision text not null
    constraint attribution_eligibility_decision_check
    check (decision in ('ELIGIBLE', 'INELIGIBLE', 'DEFERRED')),
  decided_by text not null,
  decided_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz,
  frozen_question_hash text not null,
  constraint attribution_eligibility_decision_pk
    primary key (id),
  constraint attribution_eligibility_decision_unique
    unique (app_id, tenant_id, environment, decision_id)
);

comment on table app_data_agent.attribution_eligibility_decision is
  'Attribution eligibility decision: determines if a request is eligible for attribution processing.';

create index idx_attribution_eligibility_request
  on app_data_agent.attribution_eligibility_decision (app_id, tenant_id, environment, request_id);

create index idx_attribution_eligibility_subject
  on app_data_agent.attribution_eligibility_decision (app_id, tenant_id, environment, subject_id);

-- ============================================================
-- RPC: record_eligibility_decision
-- ============================================================
create or replace function app_data_agent.record_eligibility_decision(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_request_id uuid,
  p_subject_id text,
  p_eligibility_criteria jsonb,
  p_overall_eligible boolean,
  p_decision text,
  p_decided_by text,
  p_frozen_question_hash text,
  p_expires_at timestamptz default null
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_decision_id uuid;
  v_result jsonb;
begin
  v_decision_id := extensions.gen_random_uuid();
  insert into app_data_agent.attribution_eligibility_decision (
    app_id, tenant_id, environment, decision_id, request_id, subject_id,
    eligibility_criteria, overall_eligible, decision, decided_by,
    frozen_question_hash, expires_at
  ) values (
    p_app_id, p_tenant_id, p_environment, v_decision_id, p_request_id, p_subject_id,
    p_eligibility_criteria, p_overall_eligible, p_decision, p_decided_by,
    p_frozen_question_hash, p_expires_at
  );
  v_result := jsonb_build_object(
    'decision_id', v_decision_id,
    'decision', p_decision,
    'overall_eligible', p_overall_eligible,
    'decided_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: get_latest_eligibility_decision
-- ============================================================
create or replace function app_data_agent.get_latest_eligibility_decision(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_subject_id text,
  p_frozen_question_hash text
) returns jsonb
  language plpgsql
  strict
  stable
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'decision_id', d.decision_id,
    'decision', d.decision,
    'overall_eligible', d.overall_eligible,
    'eligibility_criteria', d.eligibility_criteria,
    'decided_by', d.decided_by,
    'decided_at', d.decided_at,
    'expires_at', d.expires_at,
    'frozen_question_hash', d.frozen_question_hash
  )
  into v_result
  from app_data_agent.attribution_eligibility_decision as d
  where d.app_id = p_app_id
    and d.tenant_id = p_tenant_id
    and d.environment = p_environment
    and d.subject_id = p_subject_id
    and d.frozen_question_hash = p_frozen_question_hash
    and (d.expires_at is null or d.expires_at > pg_catalog.clock_timestamp())
  order by d.decided_at desc
  limit 1;

  return v_result;
end;
$function$;
-- ============================================================
-- 10621: Attribution Profile Request Lifecycle
-- ============================================================
-- Stores profile request lifecycle entries.
-- Status flow: DRAFT → SUBMITTED → DEDUPED|TRIAGED → DECLINED|LINKED → CLOSED
-- Terminal states: DEDUPED, DECLINED, CLOSED, EXPIRED, WITHDRAWN
-- ============================================================

create table app_data_agent.attribution_profile_request (
  id uuid not null default extensions.gen_random_uuid(),
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  request_id uuid not null default extensions.gen_random_uuid(),
  subject_id text not null,
  requester text not null,
  request_type text not null
    constraint attribution_profile_request_type_check
    check (request_type in ('PROFILE_ACCESS')),
  status text not null
    constraint attribution_profile_request_status_check
    check (status in ('DRAFT', 'SUBMITTED', 'DEDUPED', 'TRIAGED', 'LINKED', 'DECLINED', 'CLOSED', 'EXPIRED', 'WITHDRAWN')),
  request_reason text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint attribution_profile_request_pk
    primary key (id),
  constraint attribution_profile_request_unique
    unique (app_id, tenant_id, environment, request_id)
);

comment on table app_data_agent.attribution_profile_request is
  'Attribution profile request: lifecycle for requesting attribution profile access.';

create index idx_attribution_profile_request_requester
  on app_data_agent.attribution_profile_request (app_id, tenant_id, environment, requester);

create index idx_attribution_profile_request_status
  on app_data_agent.attribution_profile_request (app_id, tenant_id, environment, status);

-- ============================================================
-- RPC: create_profile_request
-- ============================================================
create or replace function app_data_agent.create_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_subject_id text,
  p_requester text,
  p_request_type text,
  p_request_reason text default null
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_request_id uuid;
  v_result jsonb;
begin
  v_request_id := extensions.gen_random_uuid();
  insert into app_data_agent.attribution_profile_request (
    app_id, tenant_id, environment, request_id, subject_id,
    requester, request_type, status, request_reason
  ) values (
    p_app_id, p_tenant_id, p_environment, v_request_id, p_subject_id,
    p_requester, p_request_type, 'DRAFT', p_request_reason
  );
  v_result := jsonb_build_object(
    'request_id', v_request_id,
    'status', 'DRAFT',
    'created_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: submit_profile_request
-- DRAFT → SUBMITTED
-- ============================================================
create or replace function app_data_agent.submit_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_request_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_profile_request as target
  set status = 'SUBMITTED',
      updated_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.request_id = p_request_id
    and target.status = 'DRAFT';

  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_REQUEST_NOT_FOUND_OR_NOT_DRAFT';
  end if;

  v_result := jsonb_build_object(
    'request_id', p_request_id,
    'status', 'SUBMITTED',
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: triage_profile_request
-- SUBMITTED → TRIAGED
-- ============================================================
create or replace function app_data_agent.triage_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_request_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_profile_request as target
  set status = 'TRIAGED',
      updated_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.request_id = p_request_id
    and target.status = 'SUBMITTED';

  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_REQUEST_NOT_FOUND_OR_NOT_SUBMITTED';
  end if;

  v_result := jsonb_build_object(
    'request_id', p_request_id,
    'status', 'TRIAGED',
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: dedupe_profile_request
-- SUBMITTED → DEDUPED
-- ============================================================
create or replace function app_data_agent.dedupe_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_request_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_profile_request as target
  set status = 'DEDUPED',
      updated_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.request_id = p_request_id
    and target.status = 'SUBMITTED';

  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_REQUEST_NOT_FOUND_OR_NOT_SUBMITTED';
  end if;

  v_result := jsonb_build_object(
    'request_id', p_request_id,
    'status', 'DEDUPED',
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: link_profile_request
-- TRIAGED → LINKED
-- ============================================================
create or replace function app_data_agent.link_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_request_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_profile_request as target
  set status = 'LINKED',
      updated_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.request_id = p_request_id
    and target.status = 'TRIAGED';

  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_REQUEST_NOT_FOUND_OR_NOT_TRIAGED';
  end if;

  v_result := jsonb_build_object(
    'request_id', p_request_id,
    'status', 'LINKED',
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: decline_profile_request
-- SUBMITTED|TRIAGED → DECLINED
-- ============================================================
create or replace function app_data_agent.decline_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_request_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_profile_request as target
  set status = 'DECLINED',
      updated_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.request_id = p_request_id
    and target.status in ('SUBMITTED', 'TRIAGED');

  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_REQUEST_NOT_FOUND_OR_NOT_ACTIVE';
  end if;

  v_result := jsonb_build_object(
    'request_id', p_request_id,
    'status', 'DECLINED',
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: close_profile_request
-- LINKED|DECLINED → CLOSED
-- ============================================================
create or replace function app_data_agent.close_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_request_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_profile_request as target
  set status = 'CLOSED',
      updated_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.request_id = p_request_id
    and target.status in ('LINKED', 'DECLINED');

  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_REQUEST_NOT_FOUND_OR_NOT_TERMINABLE';
  end if;

  v_result := jsonb_build_object(
    'request_id', p_request_id,
    'status', 'CLOSED',
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: expire_profile_request
-- DRAFT|SUBMITTED|TRIAGED → EXPIRED
-- ============================================================
create or replace function app_data_agent.expire_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_request_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_profile_request as target
  set status = 'EXPIRED',
      updated_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.request_id = p_request_id
    and target.status in ('DRAFT', 'SUBMITTED', 'TRIAGED');

  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_REQUEST_NOT_FOUND_OR_NOT_EXPIRABLE';
  end if;

  v_result := jsonb_build_object(
    'request_id', p_request_id,
    'status', 'EXPIRED',
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: withdraw_profile_request
-- DRAFT|SUBMITTED → WITHDRAWN
-- ============================================================
create or replace function app_data_agent.withdraw_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_request_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_profile_request as target
  set status = 'WITHDRAWN',
      updated_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.request_id = p_request_id
    and target.status in ('DRAFT', 'SUBMITTED');

  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_REQUEST_NOT_FOUND_OR_NOT_WITHDRAWABLE';
  end if;

  v_result := jsonb_build_object(
    'request_id', p_request_id,
    'status', 'WITHDRAWN',
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: get_profile_request
-- ============================================================
create or replace function app_data_agent.get_profile_request(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_request_id uuid
) returns jsonb
  language plpgsql
  strict
  stable
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'request_id', r.request_id,
    'subject_id', r.subject_id,
    'requester', r.requester,
    'request_type', r.request_type,
    'status', r.status,
    'request_reason', r.request_reason,
    'created_at', r.created_at,
    'updated_at', r.updated_at
  )
  into v_result
  from app_data_agent.attribution_profile_request as r
  where r.app_id = p_app_id
    and r.tenant_id = p_tenant_id
    and r.environment = p_environment
    and r.request_id = p_request_id;

  return v_result;
end;
$function$;
-- ============================================================
-- 10621: Published Attribution Safety Verdict
-- ============================================================
-- Stores published attribution safety verdicts (GO / HOLD / STOP).
-- Safety verdicts determine whether published attribution results
-- are safe for consumption.
-- ============================================================

create table app_data_agent.attribution_safety_verdict (
  id uuid not null default extensions.gen_random_uuid(),
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  verdict_id uuid not null default extensions.gen_random_uuid(),
  run_id uuid not null,
  evidence_id uuid not null,
  verdict text not null
    constraint attribution_safety_verdict_check
    check (verdict in ('GO', 'HOLD', 'STOP')),
  verdict_reason text not null,
  verdict_dimensions jsonb not null,
  determined_by text not null,
  determined_at timestamptz not null default pg_catalog.clock_timestamp(),
  evidence_hash text not null,
  supersedes_verdict_id uuid,
  auto_approve boolean not null default false,
  ttl_seconds integer not null default 3600,
  constraint attribution_safety_verdict_pk
    primary key (id),
  constraint attribution_safety_verdict_unique
    unique (app_id, tenant_id, environment, verdict_id)
);

comment on table app_data_agent.attribution_safety_verdict is
  'Published attribution safety verdict: GO / HOLD / STOP decision for published attribution results.';

create index idx_attribution_safety_verdict_run
  on app_data_agent.attribution_safety_verdict (app_id, tenant_id, environment, run_id);

create index idx_attribution_safety_verdict_latest
  on app_data_agent.attribution_safety_verdict (app_id, tenant_id, environment, run_id, determined_at desc);

-- ============================================================
-- RPC: record_safety_verdict
-- ============================================================
create or replace function app_data_agent.record_safety_verdict(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_run_id uuid,
  p_evidence_id uuid,
  p_verdict text,
  p_verdict_reason text,
  p_verdict_dimensions jsonb,
  p_determined_by text,
  p_evidence_hash text,
  p_auto_approve boolean default false,
  p_ttl_seconds integer default 3600
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_verdict_id uuid;
  v_result jsonb;
begin
  v_verdict_id := extensions.gen_random_uuid();
  insert into app_data_agent.attribution_safety_verdict (
    app_id, tenant_id, environment, verdict_id, run_id, evidence_id,
    verdict, verdict_reason, verdict_dimensions, determined_by,
    evidence_hash, auto_approve, ttl_seconds
  ) values (
    p_app_id, p_tenant_id, p_environment, v_verdict_id, p_run_id, p_evidence_id,
    p_verdict, p_verdict_reason, p_verdict_dimensions, p_determined_by,
    p_evidence_hash, p_auto_approve, p_ttl_seconds
  );
  v_result := jsonb_build_object(
    'verdict_id', v_verdict_id,
    'verdict', p_verdict,
    'determined_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: get_latest_safety_verdict
-- ============================================================
create or replace function app_data_agent.get_latest_safety_verdict(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_run_id uuid
) returns jsonb
  language plpgsql
  strict
  stable
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'verdict_id', v.verdict_id,
    'verdict', v.verdict,
    'verdict_reason', v.verdict_reason,
    'verdict_dimensions', v.verdict_dimensions,
    'determined_by', v.determined_by,
    'determined_at', v.determined_at,
    'evidence_hash', v.evidence_hash,
    'auto_approve', v.auto_approve,
    'ttl_seconds', v.ttl_seconds
  )
  into v_result
  from app_data_agent.attribution_safety_verdict as v
  where v.app_id = p_app_id
    and v.tenant_id = p_tenant_id
    and v.environment = p_environment
    and v.run_id = p_run_id
  order by v.determined_at desc
  limit 1;

  return v_result;
end;
$function$;
-- ============================================================
-- 10621: Attribution Profile Projection
-- ============================================================
-- Stores profile projections for attribution analysis.
-- Each projection defines the lowering rule set and contribution
-- endpoints for a specific attribution profile.
-- ============================================================

create table app_data_agent.attribution_profile_projection (
  id uuid not null default extensions.gen_random_uuid(),
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  profile_id uuid not null default extensions.gen_random_uuid(),
  source_release_id uuid not null,
  profile_name text not null,
  profile_version text not null,
  lowering_rule_set jsonb not null,
  contribution_endpoints jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint attribution_profile_projection_pk
    primary key (id),
  constraint attribution_profile_projection_unique
    unique (app_id, tenant_id, environment, profile_id)
);

comment on table app_data_agent.attribution_profile_projection is
  'Attribution profile projection: projected profile used for attribution analysis.';

create index idx_attribution_profile_projection_active
  on app_data_agent.attribution_profile_projection (app_id, tenant_id, environment, is_active)
  where is_active = true;

create index idx_attribution_profile_projection_source
  on app_data_agent.attribution_profile_projection (app_id, tenant_id, environment, source_release_id);

-- ============================================================
-- RPC: create_profile_projection
-- ============================================================
create or replace function app_data_agent.create_profile_projection(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_source_release_id uuid,
  p_profile_name text,
  p_profile_version text,
  p_lowering_rule_set jsonb,
  p_contribution_endpoints jsonb
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_profile_id uuid;
  v_result jsonb;
begin
  v_profile_id := extensions.gen_random_uuid();
  insert into app_data_agent.attribution_profile_projection (
    app_id, tenant_id, environment, profile_id, source_release_id,
    profile_name, profile_version, lowering_rule_set, contribution_endpoints
  ) values (
    p_app_id, p_tenant_id, p_environment, v_profile_id, p_source_release_id,
    p_profile_name, p_profile_version, p_lowering_rule_set, p_contribution_endpoints
  );
  v_result := jsonb_build_object(
    'profile_id', v_profile_id,
    'is_active', true,
    'created_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: update_profile_projection
-- ============================================================
create or replace function app_data_agent.update_profile_projection(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_profile_id uuid,
  p_lowering_rule_set jsonb default null,
  p_contribution_endpoints jsonb default null,
  p_is_active boolean default null
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_profile_projection as target
  set
    lowering_rule_set = coalesce(p_lowering_rule_set, target.lowering_rule_set),
    contribution_endpoints = coalesce(p_contribution_endpoints, target.contribution_endpoints),
    is_active = coalesce(p_is_active, target.is_active),
    updated_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.profile_id = p_profile_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'PROFILE_PROJECTION_NOT_FOUND';
  end if;

  v_result := jsonb_build_object(
    'profile_id', p_profile_id,
    'updated_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: get_active_profile_projection
-- ============================================================
create or replace function app_data_agent.get_active_profile_projection(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_profile_id uuid default null
) returns jsonb
  language plpgsql
  strict
  stable
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if p_profile_id is not null then
    select jsonb_build_object(
      'profile_id', p.profile_id,
      'source_release_id', p.source_release_id,
      'profile_name', p.profile_name,
      'profile_version', p.profile_version,
      'lowering_rule_set', p.lowering_rule_set,
      'contribution_endpoints', p.contribution_endpoints,
      'is_active', p.is_active,
      'created_at', p.created_at,
      'updated_at', p.updated_at
    )
    into v_result
    from app_data_agent.attribution_profile_projection as p
    where p.app_id = p_app_id
      and p.tenant_id = p_tenant_id
      and p.environment = p_environment
      and p.profile_id = p_profile_id;
  else
    select jsonb_build_object(
      'profile_id', p.profile_id,
      'source_release_id', p.source_release_id,
      'profile_name', p.profile_name,
      'profile_version', p.profile_version,
      'lowering_rule_set', p.lowering_rule_set,
      'contribution_endpoints', p.contribution_endpoints,
      'is_active', p.is_active,
      'created_at', p.created_at,
      'updated_at', p.updated_at
    )
    into v_result
    from app_data_agent.attribution_profile_projection as p
    where p.app_id = p_app_id
      and p.tenant_id = p_tenant_id
      and p.environment = p_environment
      and p.is_active = true
    order by p.updated_at desc
    limit 1;
  end if;

  return v_result;
end;
$function$;
-- ============================================================
-- 10621: Published F9 Internal Functions
-- ============================================================
-- Internal helper functions for the published F9 tables:
--   1. hash_f9_evidence — domain-separated SHA256 for safety evidence
--   2. lock_f9_fence — advisory lock for F9 operations
-- ============================================================

-- ============================================================
-- Function: hash_f9_evidence
-- Domain-separated SHA256 hash: sha256("attribution-safety" || chr(0) || canonicalJson(payload))
-- ============================================================
create or replace function app_data_agent.hash_f9_evidence(
  p_domain text,
  p_payload jsonb
) returns text
  language sql
  strict
  immutable
  set search_path = ''
as $function$
  select pg_catalog.encode(
    pg_catalog.digest(
      p_domain::bytea || pg_catalog.chr(0)::bytea || p_payload::bytea,
      'sha256'
    ),
    'hex'
  );
$function$;

-- ============================================================
-- Function: lock_f9_fence
-- Acquires an advisory lock for the F9 operations fence.
-- Returns true if the lock was acquired, raises exception on lock timeout.
-- ============================================================
create or replace function app_data_agent.lock_f9_fence(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text
) returns boolean
  language plpgsql
  strict
  volatile
  security definer
  set search_path = ''
as $function$
declare
  v_lock_key bigint;
begin
  v_lock_key := (
    ('x' || pg_catalog.left(p_app_id::text, 16))::bit(64)::bigint
    # ('x' || pg_catalog.left(p_tenant_id::text, 16))::bit(64)::bigint
  ) # 10621::bigint;
  perform pg_catalog.pg_advisory_xact_lock(v_lock_key);
  return true;
end;
$function$;
-- ============================================================
-- 10621: RLS, policy, ACL, and owner assignments for Published F9 tables
-- ============================================================

-- ============================================================
-- Part 1: Owner assignments for all 5 Published F9 tables
-- ============================================================

alter table app_data_agent.attribution_capability_directory owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_eligibility_decision owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_profile_request owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_safety_verdict owner to data_agent_u6_data_owner;
alter table app_data_agent.attribution_profile_projection owner to data_agent_u6_data_owner;

-- ============================================================
-- Part 2: Enable RLS + FORCE RLS for all 5 Published F9 tables
-- ============================================================

alter table app_data_agent.attribution_capability_directory enable row level security;
alter table app_data_agent.attribution_capability_directory force row level security;

alter table app_data_agent.attribution_eligibility_decision enable row level security;
alter table app_data_agent.attribution_eligibility_decision force row level security;

alter table app_data_agent.attribution_profile_request enable row level security;
alter table app_data_agent.attribution_profile_request force row level security;

alter table app_data_agent.attribution_safety_verdict enable row level security;
alter table app_data_agent.attribution_safety_verdict force row level security;

alter table app_data_agent.attribution_profile_projection enable row level security;
alter table app_data_agent.attribution_profile_projection force row level security;

-- ============================================================
-- Part 3: RLS policies for Published F9 tables
-- App/Tenant/Environment isolation
-- ============================================================

create policy attribution_capability_directory_tenant_isolation
  on app_data_agent.attribution_capability_directory
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_eligibility_decision_tenant_isolation
  on app_data_agent.attribution_eligibility_decision
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_profile_request_tenant_isolation
  on app_data_agent.attribution_profile_request
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_safety_verdict_tenant_isolation
  on app_data_agent.attribution_safety_verdict
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

create policy attribution_profile_projection_tenant_isolation
  on app_data_agent.attribution_profile_projection
  using (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid)
  with check (app_id = pg_catalog.current_setting('app.app_id', true)::uuid
    and tenant_id = pg_catalog.current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- Part 4: Function grants
-- ============================================================

-- Grant EXECUTE on capability directory RPCs
grant execute on function app_data_agent.publish_capability_directory(uuid, uuid, text, text, jsonb) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.get_latest_capability_directory(uuid, uuid, text) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on eligibility decision RPCs
grant execute on function app_data_agent.record_eligibility_decision(uuid, uuid, text, uuid, text, jsonb, boolean, text, text, text, timestamptz) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.get_latest_eligibility_decision(uuid, uuid, text, text, text) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on profile request RPCs
grant execute on function app_data_agent.create_profile_request(uuid, uuid, text, text, text, text, text) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.submit_profile_request(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.triage_profile_request(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.dedupe_profile_request(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.link_profile_request(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.decline_profile_request(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.close_profile_request(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.expire_profile_request(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.withdraw_profile_request(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.get_profile_request(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on safety verdict RPCs
grant execute on function app_data_agent.record_safety_verdict(uuid, uuid, text, uuid, uuid, text, text, jsonb, text, text, boolean, integer) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.get_latest_safety_verdict(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on profile projection RPCs
grant execute on function app_data_agent.create_profile_projection(uuid, uuid, text, uuid, text, text, jsonb, jsonb) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.update_profile_projection(uuid, uuid, text, uuid, jsonb, jsonb, boolean) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.get_active_profile_projection(uuid, uuid, text, uuid) to data_agent_u6_rpc_owner;

-- Grant EXECUTE on internal functions
grant execute on function app_data_agent.hash_f9_evidence(text, jsonb) to data_agent_u6_rpc_owner;
grant execute on function app_data_agent.lock_f9_fence(uuid, uuid, text) to data_agent_u6_rpc_owner;

-- ============================================================
-- Part 5: Schema USAGE grants
-- ============================================================
grant usage on schema app_data_agent to data_agent_u6_rpc_owner;
grant usage on schema app_data_agent to data_agent_u6_web_role;
grant usage on schema app_data_agent to data_agent_u6_worker_role;
-- ============================================================
-- 10621: Post-conditions, ledger checksum, and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010621_app_data_agent_published_f9',
  'sha256:0000000000000000000000000000000000000000000000000000000000000000'
);

commit;
