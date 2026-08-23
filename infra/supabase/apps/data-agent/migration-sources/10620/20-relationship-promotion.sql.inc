-- ============================================================
-- 10620: Attribution Relationship Promotion Receipt
-- ============================================================
-- Stores relationship promotion receipts that track promotion of
-- relationships between source releases across the semantic lifecycle.
-- ============================================================

create table app_data_agent.attribution_relationship_promotion_receipt (
  id uuid not null default extensions.gen_random_uuid(),
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  receipt_id uuid not null default extensions.gen_random_uuid(),
  source_release_id uuid not null,
  target_release_id uuid not null,
  promotion_type text not null
    constraint attribution_promotion_type_check
    check (promotion_type in ('PROMOTE', 'DEMOTE', 'RECONCILE')),
  status text not null
    constraint attribution_promotion_status_check
    check (status in ('COMMITTED', 'VERIFIED', 'FAILED')),
  promotion_receipt jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  verified_at timestamptz,
  constraint attribution_relationship_promotion_receipt_pk
    primary key (id),
  constraint attribution_promotion_receipt_unique
    unique (app_id, tenant_id, environment, receipt_id)
);

comment on table app_data_agent.attribution_relationship_promotion_receipt is
  'Tracks promotion of relationships between source releases across the semantic lifecycle.';

create index idx_attribution_promotion_source
  on app_data_agent.attribution_relationship_promotion_receipt (app_id, tenant_id, environment, source_release_id);

-- ============================================================
-- RPC: commit_relationship_promotion_receipt
-- ============================================================
create or replace function app_data_agent.commit_relationship_promotion_receipt(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_source_release_id uuid,
  p_target_release_id uuid,
  p_promotion_type text,
  p_promotion_receipt jsonb default null
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_receipt_id uuid;
  v_result jsonb;
begin
  v_receipt_id := extensions.gen_random_uuid();
  insert into app_data_agent.attribution_relationship_promotion_receipt (
    app_id, tenant_id, environment, receipt_id,
    source_release_id, target_release_id, promotion_type,
    status, promotion_receipt
  ) values (
    p_app_id, p_tenant_id, p_environment, v_receipt_id,
    p_source_release_id, p_target_release_id, p_promotion_type,
    'COMMITTED', p_promotion_receipt
  );
  v_result := jsonb_build_object(
    'receipt_id', v_receipt_id,
    'status', 'COMMITTED',
    'created_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;

-- ============================================================
-- RPC: verify_relationship_promotion
-- ============================================================
create or replace function app_data_agent.verify_relationship_promotion(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_receipt_id uuid
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  update app_data_agent.attribution_relationship_promotion_receipt as target
  set status = 'VERIFIED',
      verified_at = pg_catalog.clock_timestamp()
  where target.app_id = p_app_id
    and target.tenant_id = p_tenant_id
    and target.environment = p_environment
    and target.receipt_id = p_receipt_id
    and target.status = 'COMMITTED';

  if not found then
    raise exception using errcode = 'P0002', message = 'PROMOTION_RECEIPT_NOT_FOUND_OR_NOT_COMMITTED';
  end if;

  v_result := jsonb_build_object(
    'receipt_id', p_receipt_id,
    'status', 'VERIFIED',
    'verified_at', pg_catalog.clock_timestamp()
  );
  return v_result;
end;
$function$;
