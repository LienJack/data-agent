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
