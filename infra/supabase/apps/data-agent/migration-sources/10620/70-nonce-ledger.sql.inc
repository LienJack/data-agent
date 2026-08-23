-- ============================================================
-- 10620: Attribution Nonce Ledger
-- ============================================================
-- Stores nonce entries for atomic check-and-consume operations.
-- Nonces are used to prevent replay attacks in attribution workflows.
-- ============================================================

create table app_data_agent.attribution_nonce_ledger (
  id uuid not null default extensions.gen_random_uuid(),
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  nonce text not null,
  purpose text not null,
  consumed_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null,
  origin text,
  constraint attribution_nonce_ledger_pk
    primary key (id),
  constraint attribution_nonce_ledger_unique_nonce
    unique (app_id, tenant_id, environment, nonce)
);

comment on table app_data_agent.attribution_nonce_ledger is
  'Nonce ledger: stores nonce entries for atomic check-and-consume operations to prevent replay attacks.';

create index idx_attribution_nonce_expires
  on app_data_agent.attribution_nonce_ledger (app_id, tenant_id, environment, expires_at);

-- ============================================================
-- RPC: check_and_consume_nonce
-- ============================================================
-- Atomically checks if a nonce has been consumed and consumes it if not.
-- Returns consumed=true if the nonce was successfully consumed (first time),
-- or consumed=false if the nonce was already consumed.
-- ============================================================
create or replace function app_data_agent.check_and_consume_nonce(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_nonce text,
  p_purpose text,
  p_expires_at timestamptz,
  p_origin text default null
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  insert into app_data_agent.attribution_nonce_ledger (
    app_id, tenant_id, environment, nonce, purpose, expires_at, origin
  ) values (
    p_app_id, p_tenant_id, p_environment, p_nonce, p_purpose, p_expires_at, p_origin
  )
  on conflict (app_id, tenant_id, environment, nonce)
  do nothing;

  if found then
    v_result := jsonb_build_object(
      'nonce', p_nonce,
      'consumed', true,
      'consumed_at', pg_catalog.clock_timestamp()
    );
  else
    v_result := jsonb_build_object(
      'nonce', p_nonce,
      'consumed', false,
      'consumed_at', null::timestamptz
    );
  end if;

  return v_result;
end;
$function$;
