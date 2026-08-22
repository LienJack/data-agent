-- 10676 persists the semantic-authoring Provider lifecycle before network egress.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_PROVIDER_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_PROVIDER_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010675_app_data_agent_semantic_self_publish')
  then raise exception using errcode='P0001',message='SEMANTIC_PROVIDER_BASELINE_10675_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);

alter table semantic.semantic_authoring_turn
  add column provider_request_id uuid,
  add column provider_attempt_id uuid,
  add column provider_payload_hash text check(provider_payload_hash is null or provider_payload_hash~'^sha256:[0-9a-f]{64}$'),
  add column provider_identity jsonb check(provider_identity is null or pg_catalog.jsonb_typeof(provider_identity)='object'),
  add column provider_status text check(provider_status is null or provider_status in
    ('INTENT_COMMITTED','DISPATCH_MARKED','RESPONSE_OBSERVED','COMPLETED','FAILED','THROTTLED')),
  add column provider_terminal_kind text check(provider_terminal_kind is null or provider_terminal_kind in
    ('COMPLETED','FAILED','THROTTLED')),
  add column provider_observation_value text,
  add column provider_response_payload jsonb check(provider_response_payload is null or pg_catalog.jsonb_typeof(provider_response_payload)='object'),
  add column provider_intent_at timestamptz,
  add column provider_dispatched_at timestamptz,
  add column provider_response_observed_at timestamptz,
  add column provider_terminal_at timestamptz,
  add constraint semantic_authoring_provider_intent_closure check(
    (provider_status is null and provider_request_id is null and provider_attempt_id is null
      and provider_payload_hash is null and provider_identity is null and provider_intent_at is null)
    or (provider_status is not null and provider_request_id is not null and provider_attempt_id is not null
      and provider_payload_hash is not null and provider_identity is not null and provider_intent_at is not null)
  ),
  add constraint semantic_authoring_provider_dispatch_closure check(
    (provider_status='INTENT_COMMITTED')=(provider_dispatched_at is null)
    or provider_status is null
  ),
  add constraint semantic_authoring_provider_observation_closure check(
    (provider_status in ('RESPONSE_OBSERVED','COMPLETED','FAILED','THROTTLED'))
      =(provider_response_observed_at is not null)
    or provider_status is null
  ),
  add constraint semantic_authoring_provider_terminal_closure check(
    (provider_status in ('COMPLETED','FAILED','THROTTLED'))
      =(provider_terminal_at is not null and provider_terminal_kind is not null and provider_response_payload is not null)
    or provider_status is null
  );

create unique index semantic_authoring_provider_request_unique
  on semantic.semantic_authoring_turn(app_id,tenant_id,environment,provider_request_id)
  where provider_request_id is not null;
