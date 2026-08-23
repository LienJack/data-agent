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
