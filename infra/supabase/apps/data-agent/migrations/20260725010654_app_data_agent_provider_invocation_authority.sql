-- provider_invocation_migration_checksum: sha256:f6213c684dd4af3ae7d6eeae4606ebb8f9dbb08c1b691534fac6e9d4b0d91bce
-- ============================================================
-- 10654: Greenfield Provider Invocation and Usage authority
-- Depends on: 20260725010653_app_data_agent_effective_run_config
-- Creates empty authority tables only. No historical row transfer or dual path.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'PROVIDER_INVOCATION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'PROVIDER_INVOCATION_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010653_app_data_agent_effective_run_config'
  ) then
    raise exception using errcode = 'P0001', message = 'PROVIDER_INVOCATION_BASELINE_10653_MISSING';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'data_agent_provider_invocation_rpc_owner'
  ) then
    create role data_agent_provider_invocation_rpc_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'data_agent_provider_smoke_rpc_owner'
  ) then
    create role data_agent_provider_smoke_rpc_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';
select platform.acquire_migration_lock('app', '00000000-0000-4000-8000-00000000da01'::uuid);
create table app_data_agent.provider_invocation_intents (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  intent_id uuid not null,
  invocation_id uuid not null,
  logical_call_id uuid not null,
  run_id uuid not null,
  workspace_id uuid not null check (workspace_id = tenant_id),
  principal_id uuid not null,
  idempotency_key text not null check (
    pg_catalog.length(idempotency_key) between 8 and 256
    and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
  ),
  invocation_key_hash text not null check (invocation_key_hash ~ '^sha256:[0-9a-f]{64}$'),
  config_id uuid not null,
  config_revision bigint not null check (config_revision = 1),
  config_hash text not null check (config_hash ~ '^sha256:[0-9a-f]{64}$'),
  model_profile_id uuid not null,
  model_config_version bigint not null check (model_config_version >= 1),
  model_config_hash text not null check (model_config_hash ~ '^sha256:[0-9a-f]{64}$'),
  profile_version text not null check (profile_version ~ '^model-profile@[1-9][0-9]*$'),
  provider text not null check (provider in ('openai','anthropic','deepseek','glm','kimi','grok','gemini')),
  model_id text not null check (pg_catalog.length(pg_catalog.btrim(model_id)) between 1 and 256),
  adapter_version text not null check (adapter_version ~ '^[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$'),
  binding_kind text check (binding_kind is null or binding_kind in ('SYSTEM_DEPLOYMENT','MANAGED_CONNECTION')),
  provider_connection_id uuid,
  provider_connection_version bigint check (provider_connection_version is null or provider_connection_version >= 1),
  provider_connection_hash text check (
    provider_connection_hash is null or provider_connection_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  system_binding_hash text check (
    system_binding_hash is null or system_binding_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  system_deployment_id uuid,
  system_deployment_revision bigint check (
    system_deployment_revision is null or system_deployment_revision >= 1
  ),
  certification_run_id uuid,
  certification_artifact_id uuid,
  certification_artifact_type text check (
    certification_artifact_type is null or certification_artifact_type = 'ModelCertificationReceipt'
  ),
  certification_revision integer check (certification_revision is null or certification_revision >= 1),
  certification_hash text check (certification_hash is null or certification_hash ~ '^sha256:[0-9a-f]{64}$'),
  certification_execution_profile_hash text check (
    certification_execution_profile_hash is null
    or certification_execution_profile_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  task_artifact_id uuid not null,
  task_artifact_type text not null check (
    task_artifact_type ~ '^[A-Za-z][A-Za-z0-9_.-]{1,126}$'
  ),
  task_artifact_revision integer not null check (task_artifact_revision >= 1),
  task_artifact_hash text not null check (task_artifact_hash ~ '^sha256:[0-9a-f]{64}$'),
  projection_artifact_id uuid not null,
  projection_artifact_type text not null check (
    projection_artifact_type = 'AgentDataProjectionReceipt'
  ),
  projection_artifact_revision integer not null check (projection_artifact_revision = 1),
  projection_artifact_hash text not null check (
    projection_artifact_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  projection_receipt_hash text not null check (
    projection_receipt_hash ~ '^sha256:[0-9a-f]{64}$'
    and projection_receipt_hash = projection_artifact_hash
  ),
  recovery_capabilities text[] not null,
  token_bound_policy_version text not null check (
    token_bound_policy_version = 'utf8-byte-upper-bound@1.0.0'
  ),
  trusted_input_token_upper_bound bigint not null check (
    trusted_input_token_upper_bound between 0 and 9007199254740991
  ),
  reserved_output_tokens bigint not null check (reserved_output_tokens between 1 and 9007199254740991),
  effective_max_context_tokens bigint not null check (effective_max_context_tokens between 1 and 9007199254740991),
  effective_max_output_tokens bigint not null check (effective_max_output_tokens between 0 and 9007199254740991),
  provider_call_limit integer not null check (provider_call_limit between 0 and 1024),
  admission text not null check (admission in ('READY','REJECTED')),
  rejection_reason text check (rejection_reason is null or rejection_reason in (
    'PROVIDER_PROFILE_NOT_AVAILABLE','PROVIDER_CERTIFICATION_REQUIRED',
    'PROVIDER_CONTEXT_WINDOW_UNVERIFIED','PROVIDER_CONTEXT_LIMIT_EXCEEDED',
    'PROVIDER_OUTPUT_LIMIT_EXCEEDED','PROVIDER_CALL_LIMIT_EXCEEDED',
    'PROVIDER_EGRESS_DENIED','PROVIDER_DISPATCH_ENVELOPE_INVALID',
    'PROVIDER_CONTEXT_RECEIPT_MISMATCH','PROVIDER_WORKER_LEASE_STALE'
  )),
  intent_json jsonb not null check (
    pg_catalog.jsonb_typeof(intent_json) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(
      intent_json
        #- '{invocation_spec,projection,token_bound_policy_version}'
        #- '{invocation_spec,projection,trusted_input_token_upper_bound}'
    )
  ),
  intent_hash text not null check (
    intent_hash ~ '^sha256:[0-9a-f]{64}$'
    and intent_hash = app_data_agent.u2_canonical_sha256(intent_json - 'intent_hash')
    and intent_hash = intent_json ->> 'intent_hash'
  ),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,intent_id),
  unique (app_id,tenant_id,environment,invocation_id),
  unique (app_id,tenant_id,environment,intent_id,invocation_id),
  unique (app_id,tenant_id,environment,principal_id,idempotency_key),
  unique (app_id,tenant_id,environment,principal_id,invocation_key_hash),
  unique (app_id,tenant_id,environment,intent_id,intent_hash),
  foreign key (app_id,tenant_id,environment,run_id,principal_id)
    references app_data_agent.runs (app_id,tenant_id,environment,run_id,principal_id) on delete restrict,
  foreign key (app_id,tenant_id,environment,config_id,config_revision,config_hash)
    references app_data_agent.effective_run_config_receipts (
      app_id,tenant_id,environment,config_id,config_revision,config_hash
    ) on delete restrict,
  foreign key (app_id,environment,model_profile_id,model_config_version)
    references app_data_agent.model_config_versions (
      app_id,environment,model_profile_id,config_version
    ) on delete restrict,
  foreign key (app_id,environment,provider_connection_id,provider_connection_version)
    references app_data_agent.model_provider_connection_versions (
      app_id,environment,provider_connection_id,config_version
    ) on delete restrict,
  foreign key (
    app_id,tenant_id,environment,certification_run_id,certification_artifact_id,
    certification_revision,certification_hash
  ) references app_data_agent.artifacts (
    app_id,tenant_id,environment,run_id,artifact_id,revision,content_hash
  ) on delete restrict,
  foreign key (
    app_id,tenant_id,environment,run_id,task_artifact_id,task_artifact_revision,task_artifact_hash
  ) references app_data_agent.artifacts (
    app_id,tenant_id,environment,run_id,artifact_id,revision,content_hash
  ) on delete restrict,
  foreign key (
    app_id,tenant_id,environment,run_id,projection_artifact_id,
    projection_artifact_revision,projection_artifact_hash
  ) references app_data_agent.artifacts (
    app_id,tenant_id,environment,run_id,artifact_id,revision,content_hash
  ) on delete restrict,
  check (
    admission = 'REJECTED'
    or (binding_kind = 'MANAGED_CONNECTION'
      and provider_connection_id is not null
      and provider_connection_version is not null
      and provider_connection_hash is not null
      and system_binding_hash is null
      and system_deployment_id is null
      and system_deployment_revision is null)
    or (binding_kind = 'SYSTEM_DEPLOYMENT'
      and provider_connection_id is null
      and provider_connection_version is null
      and provider_connection_hash is null
      and system_binding_hash is not null
      and system_deployment_id is not null
      and system_deployment_revision is not null)
  ),
  check (
    recovery_capabilities = array['IDEMPOTENT_REQUEST']::text[]
    or recovery_capabilities = array['INVOCATION_STATUS_QUERY']::text[]
    or recovery_capabilities = array['INVOCATION_RECONCILIATION']::text[]
    or recovery_capabilities = array['AT_LEAST_ONCE_ONLY']::text[]
    or recovery_capabilities = array['IDEMPOTENT_REQUEST','INVOCATION_STATUS_QUERY']::text[]
    or recovery_capabilities = array['IDEMPOTENT_REQUEST','INVOCATION_RECONCILIATION']::text[]
    or recovery_capabilities = array['INVOCATION_STATUS_QUERY','INVOCATION_RECONCILIATION']::text[]
    or recovery_capabilities = array[
      'IDEMPOTENT_REQUEST','INVOCATION_STATUS_QUERY','INVOCATION_RECONCILIATION'
    ]::text[]
  ),
  check (
    admission = 'REJECTED'
    or (certification_run_id is not null and certification_artifact_id is not null
      and certification_artifact_type = 'ModelCertificationReceipt'
      and certification_revision is not null and certification_hash is not null
      and certification_execution_profile_hash is not null)
  ),
  check (
    (admission = 'READY' and rejection_reason is null and provider_call_limit >= 1)
    or (admission = 'REJECTED' and rejection_reason is not null)
  )
);

create table app_data_agent.provider_invocation_dispatch_permits (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  permit_id uuid not null,
  intent_id uuid not null,
  invocation_id uuid not null,
  run_id uuid not null,
  dispatch_hash text not null check (dispatch_hash ~ '^sha256:[0-9a-f]{64}$'),
  context_receipt_id uuid not null,
  context_receipt_hash text not null check (context_receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  attempt_id uuid not null,
  outbox_id uuid not null,
  command_id uuid not null,
  attempt_no bigint not null check (attempt_no between 1 and 9007199254740991),
  worker_id text not null check (worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'),
  lease_token bigint not null check (lease_token between 1 and 9007199254740991),
  worker_fence bigint not null check (worker_fence between 1 and 9007199254740991),
  envelope_json jsonb not null check (
    pg_catalog.jsonb_typeof(envelope_json) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(
      envelope_json
        #- '{lease,lease_token}'
        #- '{projection,token_bound_policy_version}'
        #- '{projection,trusted_input_token_upper_bound}'
    )
  ),
  permit_json jsonb not null check (
    pg_catalog.jsonb_typeof(permit_json) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(
      permit_json #- '{lease,lease_token}'
    )
  ),
  permit_hash text not null check (
    permit_hash ~ '^sha256:[0-9a-f]{64}$'
    and permit_hash = app_data_agent.u2_canonical_sha256(permit_json - 'permit_hash')
    and permit_hash = permit_json ->> 'permit_hash'
  ),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,permit_id),
  unique (app_id,tenant_id,environment,intent_id,attempt_id,worker_fence),
  unique (app_id,tenant_id,environment,intent_id,dispatch_hash),
  foreign key (app_id,tenant_id,environment,intent_id,invocation_id)
    references app_data_agent.provider_invocation_intents (
      app_id,tenant_id,environment,intent_id,invocation_id
    ) on delete restrict,
  foreign key (app_id,tenant_id,environment,context_receipt_id)
    references app_data_agent.effective_config_context_receipts (
      app_id,tenant_id,environment,context_receipt_id
    ) on delete restrict,
  foreign key (app_id,tenant_id,environment,attempt_id,outbox_id,run_id)
    references app_data_agent.run_attempts (
      app_id,tenant_id,environment,attempt_id,outbox_id,run_id
    ) on delete restrict
);

create table app_data_agent.provider_invocation_outcomes (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  outcome_id uuid not null,
  intent_id uuid not null,
  invocation_id uuid not null,
  run_id uuid not null,
  dispatch_hash text not null check (dispatch_hash ~ '^sha256:[0-9a-f]{64}$'),
  transition_revision bigint not null check (transition_revision between 1 and 9007199254740991),
  parent_transition_revision bigint,
  parent_outcome_hash text check (parent_outcome_hash is null or parent_outcome_hash ~ '^sha256:[0-9a-f]{64}$'),
  state text not null check (state in (
    'DISPATCH_MARKED','RESPONSE_OBSERVED','COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN'
  )),
  observation_kind text check (observation_kind is null or observation_kind in (
    'COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN'
  )),
  actor_kind text not null check (actor_kind in ('WORKER','RECONCILER')),
  transition_from text not null check (transition_from in (
    'INTENT_COMMITTED','DISPATCH_MARKED','RESPONSE_OBSERVED','OUTCOME_UNKNOWN'
  )),
  recovery_action text not null check (recovery_action in (
    'NONE','SAFE_RETRY','STATUS_QUERY_REQUIRED',
    'RECONCILIATION_REQUIRED','MANUAL_REVIEW_REQUIRED'
  )),
  dispatch_attempt_no bigint not null check (dispatch_attempt_no between 0 and 9007199254740991),
  attempt_id uuid not null,
  outbox_id uuid not null,
  command_id uuid not null,
  worker_id text not null check (worker_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'),
  lease_token bigint not null check (lease_token between 1 and 9007199254740991),
  worker_fence bigint not null check (worker_fence between 1 and 9007199254740991),
  dispatch_marked boolean not null,
  provider_call_may_have_started boolean not null,
  response_artifact_id uuid,
  response_artifact_type text check (
    response_artifact_type is null or response_artifact_type = 'ProviderResponseArtifact'
  ),
  response_artifact_revision integer,
  response_artifact_content_hash text check (
    response_artifact_content_hash is null or response_artifact_content_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  response_hash text check (response_hash is null or response_hash ~ '^sha256:[0-9a-f]{64}$'),
  evidence_run_id uuid,
  evidence_artifact_id uuid,
  evidence_artifact_type text,
  evidence_artifact_revision integer,
  evidence_hash text check (evidence_hash is null or evidence_hash ~ '^sha256:[0-9a-f]{64}$'),
  reason_code text check (reason_code is null or reason_code ~ '^[A-Z][A-Z0-9_]{1,126}$'),
  provider_call_count integer not null check (provider_call_count between 0 and 1),
  retry_after_ms bigint check (retry_after_ms is null or retry_after_ms between 1 and 86400000),
  delivery_certainty text not null check (delivery_certainty in (
    'NOT_DISPATCHED','DISPATCHED_OUTCOME_KNOWN','DISPATCHED_OUTCOME_UNKNOWN'
  )),
  started_at timestamptz,
  terminal_at timestamptz,
  latency_ms bigint check (latency_ms is null or latency_ms between 0 and 9007199254740991),
  reconciliation_id uuid,
  recovery_capability_used text check (recovery_capability_used is null or recovery_capability_used in (
    'IDEMPOTENT_REQUEST','INVOCATION_STATUS_QUERY','INVOCATION_RECONCILIATION',
    'AT_LEAST_ONCE_ONLY'
  )),
  reconciliation_of uuid,
  outcome_json jsonb not null check (
    pg_catalog.jsonb_typeof(outcome_json) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(outcome_json)
  ),
  outcome_hash text not null check (
    outcome_hash ~ '^sha256:[0-9a-f]{64}$'
    and outcome_hash = case
      when state in ('DISPATCH_MARKED','RESPONSE_OBSERVED')
        then app_data_agent.u2_canonical_sha256(outcome_json - 'marker_hash')
      else app_data_agent.u2_canonical_sha256(outcome_json - 'outcome_hash')
    end
    and outcome_hash = case
      when state in ('DISPATCH_MARKED','RESPONSE_OBSERVED') then outcome_json ->> 'marker_hash'
      else outcome_json ->> 'outcome_hash'
    end
  ),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,outcome_id),
  unique (app_id,tenant_id,environment,intent_id,transition_revision),
  unique (app_id,tenant_id,environment,intent_id,transition_revision,outcome_hash),
  unique (app_id,tenant_id,environment,reconciliation_id),
  foreign key (app_id,tenant_id,environment,intent_id,invocation_id)
    references app_data_agent.provider_invocation_intents (
      app_id,tenant_id,environment,intent_id,invocation_id
    ) on delete restrict,
  foreign key (
    app_id,tenant_id,environment,intent_id,parent_transition_revision,parent_outcome_hash
  ) references app_data_agent.provider_invocation_outcomes (
    app_id,tenant_id,environment,intent_id,transition_revision,outcome_hash
  ) on delete restrict,
  foreign key (app_id,tenant_id,environment,reconciliation_of)
    references app_data_agent.provider_invocation_outcomes (
      app_id,tenant_id,environment,outcome_id
    ) on delete restrict,
  foreign key (app_id,tenant_id,environment,attempt_id,outbox_id,run_id)
    references app_data_agent.run_attempts (
      app_id,tenant_id,environment,attempt_id,outbox_id,run_id
    ) on delete restrict,
  foreign key (
    app_id,tenant_id,environment,evidence_run_id,evidence_artifact_id,
    evidence_artifact_revision,evidence_hash
  ) references app_data_agent.artifacts (
    app_id,tenant_id,environment,run_id,artifact_id,revision,content_hash
  ) on delete restrict,
  foreign key (
    app_id,tenant_id,environment,run_id,response_artifact_id,
    response_artifact_revision,response_artifact_content_hash
  ) references app_data_agent.artifacts (
    app_id,tenant_id,environment,run_id,artifact_id,revision,content_hash
  ) on delete restrict,
  check (
    (transition_revision = 1 and parent_transition_revision is null and parent_outcome_hash is null)
    or (transition_revision > 1 and parent_transition_revision = transition_revision - 1
      and parent_outcome_hash is not null)
  ),
  check (
    (state = 'DISPATCH_MARKED' and dispatch_marked and provider_call_may_have_started
      and observation_kind is null
      and response_hash is null
      and reason_code is null and provider_call_count = 1 and retry_after_ms is null
      and delivery_certainty = 'DISPATCHED_OUTCOME_UNKNOWN'
      and started_at is not null and terminal_at is null)
    or (state = 'RESPONSE_OBSERVED' and dispatch_marked and provider_call_may_have_started
      and observation_kind is not null and response_hash is null
      and reason_code is null and provider_call_count = 1 and retry_after_ms is null
      and delivery_certainty = case when observation_kind = 'OUTCOME_UNKNOWN'
        then 'DISPATCHED_OUTCOME_UNKNOWN' else 'DISPATCHED_OUTCOME_KNOWN' end
      and started_at is not null and terminal_at is null)
    or (state = 'COMPLETED' and dispatch_marked and provider_call_may_have_started
      and observation_kind is null
      and response_hash is not null
      and reason_code is null and provider_call_count = 1 and retry_after_ms is null
      and delivery_certainty = 'DISPATCHED_OUTCOME_KNOWN'
      and started_at is not null and terminal_at is not null)
    or (state = 'FAILED' and response_hash is null and reason_code is not null
      and observation_kind is null
      and retry_after_ms is null and terminal_at is not null
      and ((dispatch_marked and provider_call_may_have_started and provider_call_count = 1
          and started_at is not null
          and delivery_certainty = 'DISPATCHED_OUTCOME_KNOWN')
        or (not dispatch_marked and not provider_call_may_have_started
          and provider_call_count = 0 and started_at is null
          and delivery_certainty = 'NOT_DISPATCHED')))
    or (state = 'THROTTLED' and dispatch_marked and provider_call_may_have_started
      and observation_kind is null
      and response_hash is null
      and reason_code = 'PROVIDER_THROTTLED' and provider_call_count = 1
      and retry_after_ms is not null
      and delivery_certainty = 'DISPATCHED_OUTCOME_KNOWN'
      and started_at is not null and terminal_at is not null)
    or (state = 'OUTCOME_UNKNOWN' and dispatch_marked and provider_call_may_have_started
      and observation_kind is null
      and response_hash is null
      and reason_code = 'PROVIDER_INVOCATION_OUTCOME_UNKNOWN'
      and provider_call_count = 1 and retry_after_ms is null
      and delivery_certainty = 'DISPATCHED_OUTCOME_UNKNOWN'
      and started_at is not null and terminal_at is not null)
  ),
  check (
    (response_hash is null and response_artifact_id is null and response_artifact_type is null
      and response_artifact_revision is null and response_artifact_content_hash is null)
    or (response_hash is not null and response_artifact_id is not null
      and response_artifact_type = 'ProviderResponseArtifact' and response_artifact_revision is not null
      and response_artifact_content_hash is not null)
  ),
  check (
    (actor_kind = 'WORKER' and evidence_run_id is null and evidence_artifact_id is null
      and evidence_artifact_type is null and evidence_artifact_revision is null
      and evidence_hash is null and reconciliation_id is null and recovery_capability_used is null)
    or (actor_kind = 'RECONCILER' and evidence_run_id is not null and evidence_artifact_id is not null
      and evidence_artifact_type is not null and evidence_artifact_revision is not null
      and evidence_hash is not null and reconciliation_id is not null
      and recovery_capability_used is not null)
  )
  ,check (
    (reconciliation_of is null and transition_from <> 'OUTCOME_UNKNOWN')
    or (reconciliation_of is not null and transition_from = 'OUTCOME_UNKNOWN'
      and recovery_action = 'NONE')
  )
);

create unique index provider_invocation_one_terminal
on app_data_agent.provider_invocation_outcomes (app_id,tenant_id,environment,intent_id)
where state in ('COMPLETED','FAILED','THROTTLED');

create unique index provider_invocation_one_dispatch_marker_per_attempt
on app_data_agent.provider_invocation_outcomes (
  app_id,tenant_id,environment,intent_id,dispatch_attempt_no
)
where state = 'DISPATCH_MARKED';

create unique index provider_invocation_one_response_observed_per_attempt
on app_data_agent.provider_invocation_outcomes (
  app_id,tenant_id,environment,intent_id,dispatch_attempt_no
)
where state = 'RESPONSE_OBSERVED';

create unique index provider_invocation_one_unknown_per_attempt
on app_data_agent.provider_invocation_outcomes (
  app_id,tenant_id,environment,intent_id,dispatch_attempt_no
)
where state = 'OUTCOME_UNKNOWN';

create table app_data_agent.provider_invocation_usage_receipts (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  usage_receipt_id uuid not null,
  intent_id uuid not null,
  invocation_id uuid not null,
  outcome_id uuid not null,
  outcome_transition_revision bigint not null check (outcome_transition_revision >= 1),
  outcome_hash text not null check (outcome_hash ~ '^sha256:[0-9a-f]{64}$'),
  availability text not null check (availability in ('AVAILABLE','NOT_APPLICABLE','UNAVAILABLE')),
  token_source text not null check (token_source in ('PROVIDER_REPORTED','ESTIMATED','UNAVAILABLE')),
  input_tokens bigint check (input_tokens is null or input_tokens between 0 and 9007199254740991),
  output_tokens bigint check (output_tokens is null or output_tokens between 0 and 9007199254740991),
  total_tokens bigint check (total_tokens is null or total_tokens between 0 and 9007199254740991),
  tool_calls bigint check (tool_calls is null or tool_calls between 0 and 9007199254740991),
  provider_call_count integer not null check (provider_call_count between 0 and 1),
  capacity_status text not null check (capacity_status in ('WITHIN_LIMIT','NOT_APPLICABLE','UNAVAILABLE')),
  unavailable_reason text check (
    unavailable_reason is null or unavailable_reason ~ '^[A-Z][A-Z0-9_]{1,126}$'
  ),
  usage_json jsonb not null check (
    pg_catalog.jsonb_typeof(usage_json) = 'object'
    and not app_data_agent.contains_potential_plaintext_secret(usage_json)
  ),
  usage_hash text not null check (
    usage_hash ~ '^sha256:[0-9a-f]{64}$'
    and usage_hash = app_data_agent.u2_canonical_sha256(usage_json - 'usage_hash')
    and usage_hash = usage_json ->> 'usage_hash'
  ),
  observed_at timestamptz not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,usage_receipt_id),
  unique (app_id,tenant_id,environment,intent_id,outcome_id),
  unique (app_id,tenant_id,environment,intent_id,outcome_transition_revision,outcome_hash),
  foreign key (app_id,tenant_id,environment,intent_id,invocation_id)
    references app_data_agent.provider_invocation_intents (
      app_id,tenant_id,environment,intent_id,invocation_id
    ) on delete restrict,
  foreign key (
    app_id,tenant_id,environment,outcome_id
  ) references app_data_agent.provider_invocation_outcomes (
    app_id,tenant_id,environment,outcome_id
  ) on delete restrict,
  foreign key (
    app_id,tenant_id,environment,intent_id,outcome_transition_revision,outcome_hash
  ) references app_data_agent.provider_invocation_outcomes (
    app_id,tenant_id,environment,intent_id,transition_revision,outcome_hash
  ) on delete restrict,
  check (
    (availability = 'AVAILABLE' and token_source in ('PROVIDER_REPORTED','ESTIMATED')
      and input_tokens is not null and output_tokens is not null and tool_calls is not null
      and total_tokens = input_tokens + output_tokens
      and provider_call_count = 1 and capacity_status = 'WITHIN_LIMIT'
      and unavailable_reason is null)
    or (availability in ('NOT_APPLICABLE','UNAVAILABLE') and token_source = 'UNAVAILABLE'
      and input_tokens is null and output_tokens is null and total_tokens is null and tool_calls is null
      and unavailable_reason is not null
      and ((availability = 'NOT_APPLICABLE' and unavailable_reason = 'PROVIDER_NOT_DISPATCHED'
          and provider_call_count = 0 and capacity_status = 'NOT_APPLICABLE')
        or (availability = 'UNAVAILABLE' and unavailable_reason in (
          'PROVIDER_DID_NOT_REPORT_USAGE','PROVIDER_INVOCATION_OUTCOME_UNKNOWN',
          'PROVIDER_PROTOCOL_VIOLATION'
        ) and provider_call_count = 1 and capacity_status = 'UNAVAILABLE')))
  )
);
create function app_data_agent.reject_provider_invocation_authority_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'PROVIDER_INVOCATION_AUTHORITY_IMMUTABLE';
end
$function$;

create trigger provider_invocation_intents_immutable
before update or delete on app_data_agent.provider_invocation_intents
for each row execute function app_data_agent.reject_provider_invocation_authority_mutation();

create trigger provider_invocation_dispatch_permits_immutable
before update or delete on app_data_agent.provider_invocation_dispatch_permits
for each row execute function app_data_agent.reject_provider_invocation_authority_mutation();

create trigger provider_invocation_outcomes_immutable
before update or delete on app_data_agent.provider_invocation_outcomes
for each row execute function app_data_agent.reject_provider_invocation_authority_mutation();

create trigger provider_invocation_usage_receipts_immutable
before update or delete on app_data_agent.provider_invocation_usage_receipts
for each row execute function app_data_agent.reject_provider_invocation_authority_mutation();

alter table app_data_agent.provider_invocation_intents enable row level security;
alter table app_data_agent.provider_invocation_intents force row level security;
alter table app_data_agent.provider_invocation_outcomes enable row level security;
alter table app_data_agent.provider_invocation_outcomes force row level security;
alter table app_data_agent.provider_invocation_usage_receipts enable row level security;
alter table app_data_agent.provider_invocation_usage_receipts force row level security;
alter table app_data_agent.provider_invocation_dispatch_permits enable row level security;
alter table app_data_agent.provider_invocation_dispatch_permits force row level security;

create policy provider_invocation_intents_rpc_owner
on app_data_agent.provider_invocation_intents for all
to data_agent_provider_invocation_rpc_owner using (true) with check (true);
create policy provider_invocation_outcomes_rpc_owner
on app_data_agent.provider_invocation_outcomes for all
to data_agent_provider_invocation_rpc_owner using (true) with check (true);
create policy provider_invocation_dispatch_permits_rpc_owner
on app_data_agent.provider_invocation_dispatch_permits for all
to data_agent_provider_invocation_rpc_owner using (true) with check (true);
create policy provider_invocation_usage_receipts_rpc_owner
on app_data_agent.provider_invocation_usage_receipts for all
to data_agent_provider_invocation_rpc_owner using (true) with check (true);
create function app_data_agent.resolve_conversation_run_selections(
  requested_conversation_id uuid,
  requested_expected_resource_version bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  conversation_record app_data_agent.qa_conversations%rowtype;
  datasource_record app_data_agent.datasource_connections%rowtype;
  model_record app_data_agent.model_catalog_entries%rowtype;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if requested_conversation_id is null
    or requested_expected_resource_version is null
    or requested_expected_resource_version not between 1 and 9007199254740991
  then
    raise exception using errcode = '22023', message = 'CONVERSATION_RUN_SELECTION_INPUT_INVALID';
  end if;

  select * into strict authority from platform.current_backend_authority(false);
  select conversation.* into conversation_record
  from app_data_agent.qa_conversations as conversation
  where conversation.app_id = authority.app_id
    and conversation.tenant_id = authority.tenant_id
    and conversation.environment = authority.environment
    and conversation.owner_principal_id = authority.principal_id
    and conversation.conversation_id = requested_conversation_id
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'CONVERSATION_RUN_SELECTION_NOT_FOUND_OR_FORBIDDEN';
  end if;
  if conversation_record.resource_version <> requested_expected_resource_version then
    raise exception using errcode = '40001', message = 'CONVERSATION_RUN_SELECTION_VERSION_CONFLICT';
  end if;
  if conversation_record.model_profile_id is null then
    raise exception using errcode = '55000', message = 'PROVIDER_PROFILE_NOT_AVAILABLE';
  end if;
  if conversation_record.datasource_id is null then
    raise exception using errcode = '55000', message = 'DATASOURCE_NOT_FOUND_OR_DENIED';
  end if;

  select datasource.* into datasource_record
  from app_data_agent.datasource_connections as datasource
  where datasource.app_id = authority.app_id
    and datasource.tenant_id = authority.tenant_id
    and datasource.environment = authority.environment
    and datasource.datasource_id = conversation_record.datasource_id
    and datasource.status = 'ACTIVE'
  for share;
  if not found then
    raise exception using errcode = '55000', message = 'DATASOURCE_NOT_FOUND_OR_DENIED';
  end if;

  select catalog.* into model_record
  from app_data_agent.model_catalog_entries as catalog
  where catalog.app_id = authority.app_id
    and catalog.environment = authority.environment
    and catalog.model_profile_id = conversation_record.model_profile_id
    and catalog.status not in ('DRAFT','DISABLED')
  for share;
  if not found then
    raise exception using errcode = '55000', message = 'PROVIDER_PROFILE_NOT_AVAILABLE';
  end if;
  perform 1
  from app_data_agent.model_config_versions as revision
  where revision.app_id = model_record.app_id
    and revision.environment = model_record.environment
    and revision.model_profile_id = model_record.model_profile_id
    and revision.config_version = model_record.config_version;
  if not found then
    raise exception using errcode = '55000', message = 'PROVIDER_PROFILE_NOT_AVAILABLE';
  end if;

  return pg_catalog.jsonb_build_object(
    'schema_version','conversation-run-selections@1.0.0',
    'conversation_id',conversation_record.conversation_id,
    'conversation_resource_version',conversation_record.resource_version,
    'model_profile_id',model_record.model_profile_id,
    'model_config_version',model_record.config_version,
    'datasource_id',datasource_record.datasource_id,
    'datasource_resource_version',datasource_record.resource_version
  );
end
$function$;

create function app_data_agent.list_provider_execution_profiles()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  authority record;
  profile record;
  certification app_data_agent.artifacts%rowtype;
  managed_connection app_data_agent.model_provider_connections%rowtype;
  managed_revision app_data_agent.model_provider_connection_versions%rowtype;
  deployment platform.deployment_mappings%rowtype;
  profiles jsonb := '[]'::jsonb;
  common_document jsonb;
  readiness text;
  unavailable_reason text;
  connection_available boolean;
  resource_hash text;
  expected_connection_hash text;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  select * into strict authority from platform.current_backend_authority(false);
  for profile in
    select catalog.*, revision.snapshot
    from app_data_agent.model_catalog_entries catalog
    left join app_data_agent.model_config_versions revision
      on revision.app_id = catalog.app_id
     and revision.environment = catalog.environment
     and revision.model_profile_id = catalog.model_profile_id
     and revision.config_version = catalog.config_version
    where catalog.app_id = authority.app_id
      and catalog.environment = authority.environment
    order by pg_catalog.lower(catalog.display_name),catalog.model_profile_id
    limit 256
  loop
    resource_hash := case when profile.snapshot is null then null
      else app_data_agent.u2_canonical_sha256(profile.snapshot) end;
    common_document := pg_catalog.jsonb_build_object(
      'model_profile_id',profile.model_profile_id,
      'model_config_version',profile.config_version,
      'resource_hash',coalesce(resource_hash,app_data_agent.u2_canonical_sha256('null'::jsonb)),
      'profile_version','model-profile@' || profile.config_version::text,
      'provider',profile.provider,'model_id',profile.model_id,'display_name',profile.display_name);
    readiness := null;
    unavailable_reason := null;
    if profile.status in ('DRAFT','DISABLED') then
      readiness := 'DISABLED'; unavailable_reason := 'MODEL_PROFILE_DISABLED';
    elsif profile.snapshot is null then
      readiness := 'STALE'; unavailable_reason := 'MODEL_PROFILE_STALE';
    end if;

    select artifact.* into certification
    from app_data_agent.artifacts artifact
    where artifact.app_id = authority.app_id
      and artifact.tenant_id = authority.tenant_id
      and artifact.environment = authority.environment
      and artifact.artifact_type = 'ModelCertificationReceipt'
      and artifact.is_active
      and artifact.document_json ->> 'profile_id' = profile.model_profile_id::text
      and artifact.document_json ->> 'model_config_version' = profile.config_version::text
      and artifact.document_json ->> 'provider' = profile.provider
      and artifact.document_json ->> 'model_id' = profile.model_id
      and app_data_agent.provider_json_object_has_exact_keys(artifact.document_json,array[
        'schema_version','receipt_ref','profile_id','model_config_version','provider','model_id',
        'profile_version','adapter_version','execution_profile_hash','execution_profile_snapshot',
        'recovery_capabilities','connection','certification_basis','verdict'
      ]::text[])
      and app_data_agent.provider_json_object_has_exact_keys(
        artifact.document_json -> 'receipt_ref',array[
          'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision',
          'content_hash'
        ]::text[])
      and app_data_agent.provider_json_object_has_exact_keys(
        artifact.document_json -> 'execution_profile_snapshot',array[
          'profile_id','scope','provider','model_id','model_config_version','profile_version',
          'adapter_version','recovery_capabilities','connection','capabilities','context_window',
          'region_privacy','fallback_compatibility'
        ]::text[])
      and app_data_agent.provider_json_object_has_exact_keys(
        artifact.document_json #> '{execution_profile_snapshot,context_window}',array[
          'verification_status','max_context_tokens','max_output_tokens'
        ]::text[])
      and artifact.content_hash =
        app_data_agent.u2_canonical_sha256(artifact.document_json #- '{receipt_ref,content_hash}')
      and artifact.document_json #>> '{receipt_ref,content_hash}' = artifact.content_hash
      and artifact.document_json ->> 'schema_version' = 'model-execution-certification@1.0.0'
      and artifact.document_json ->> 'verdict' = 'PASS'
      and artifact.document_json ->> 'profile_version' =
        'model-profile@' || profile.config_version::text
      and artifact.document_json ->> 'adapter_version' ~
        '^[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$'
      and artifact.document_json #>>
        '{execution_profile_snapshot,context_window,max_context_tokens}' ~ '^[1-9][0-9]*$'
      and artifact.document_json #>>
        '{execution_profile_snapshot,context_window,max_output_tokens}' ~ '^[1-9][0-9]*$'
      and artifact.document_json -> 'recovery_capabilities' in (
        '["IDEMPOTENT_REQUEST"]'::jsonb,
        '["INVOCATION_STATUS_QUERY"]'::jsonb,
        '["INVOCATION_RECONCILIATION"]'::jsonb,
        '["AT_LEAST_ONCE_ONLY"]'::jsonb,
        '["IDEMPOTENT_REQUEST","INVOCATION_STATUS_QUERY"]'::jsonb,
        '["IDEMPOTENT_REQUEST","INVOCATION_RECONCILIATION"]'::jsonb,
        '["INVOCATION_STATUS_QUERY","INVOCATION_RECONCILIATION"]'::jsonb,
        '["IDEMPOTENT_REQUEST","INVOCATION_STATUS_QUERY","INVOCATION_RECONCILIATION"]'::jsonb
      )
      and artifact.document_json -> 'recovery_capabilities' =
        artifact.document_json #> '{execution_profile_snapshot,recovery_capabilities}'
      and artifact.document_json -> 'connection' =
        artifact.document_json #> '{execution_profile_snapshot,connection}'
      and artifact.document_json -> 'receipt_ref' = pg_catalog.jsonb_build_object(
        'artifact_id',artifact.artifact_id,'artifact_type','ModelCertificationReceipt',
        'app_id',artifact.app_id,'tenant_id',artifact.tenant_id,
        'environment',artifact.environment,'run_id',artifact.run_id,
        'revision',artifact.revision,'content_hash',artifact.content_hash)
      and artifact.document_json ->> 'execution_profile_hash' =
        app_data_agent.u2_canonical_sha256(artifact.document_json -> 'execution_profile_snapshot')
      and artifact.document_json #> '{execution_profile_snapshot,capabilities}' =
        profile.capabilities
    order by artifact.created_at desc,artifact.artifact_id
    limit 1;
    if readiness is null and certification.artifact_id is null then
      readiness := 'CERTIFICATION_REQUIRED';
      unavailable_reason := 'MODEL_CERTIFICATION_REQUIRED';
    elsif readiness is null and (
      not app_data_agent.provider_json_object_has_exact_keys(certification.document_json,array[
        'schema_version','receipt_ref','profile_id','model_config_version','provider','model_id',
        'profile_version','adapter_version','execution_profile_hash','execution_profile_snapshot',
        'recovery_capabilities','connection','certification_basis','verdict'
      ]::text[])
      or not app_data_agent.provider_json_object_has_exact_keys(
        certification.document_json -> 'receipt_ref',array[
          'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision',
          'content_hash'
        ]::text[])
      or not app_data_agent.provider_json_object_has_exact_keys(
        certification.document_json -> 'execution_profile_snapshot',array[
          'profile_id','scope','provider','model_id','model_config_version','profile_version',
          'adapter_version','recovery_capabilities','connection','capabilities','context_window',
          'region_privacy','fallback_compatibility'
        ]::text[])
      or not app_data_agent.provider_json_object_has_exact_keys(
        certification.document_json #> '{execution_profile_snapshot,context_window}',array[
          'verification_status','max_context_tokens','max_output_tokens'
        ]::text[])
      or certification.content_hash <>
        app_data_agent.u2_canonical_sha256(certification.document_json #- '{receipt_ref,content_hash}')
      or certification.document_json #>> '{receipt_ref,content_hash}' <> certification.content_hash
      or certification.document_json ->> 'schema_version' <>
        'model-execution-certification@1.0.0'
      or certification.document_json ->> 'verdict' <> 'PASS'
      or certification.document_json ->> 'profile_version' <>
        'model-profile@' || profile.config_version::text
      or certification.document_json ->> 'profile_id' <> profile.model_profile_id::text
      or certification.document_json ->> 'model_config_version' <> profile.config_version::text
      or certification.document_json ->> 'provider' <> profile.provider
      or certification.document_json ->> 'model_id' <> profile.model_id
      or certification.document_json ->> 'adapter_version' !~
        '^[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$'
      or certification.document_json #>>
        '{execution_profile_snapshot,context_window,max_context_tokens}' !~ '^[1-9][0-9]*$'
      or certification.document_json #>>
        '{execution_profile_snapshot,context_window,max_output_tokens}' !~ '^[1-9][0-9]*$'
      or certification.document_json -> 'recovery_capabilities' not in (
        '["IDEMPOTENT_REQUEST"]'::jsonb,
        '["INVOCATION_STATUS_QUERY"]'::jsonb,
        '["INVOCATION_RECONCILIATION"]'::jsonb,
        '["AT_LEAST_ONCE_ONLY"]'::jsonb,
        '["IDEMPOTENT_REQUEST","INVOCATION_STATUS_QUERY"]'::jsonb,
        '["IDEMPOTENT_REQUEST","INVOCATION_RECONCILIATION"]'::jsonb,
        '["INVOCATION_STATUS_QUERY","INVOCATION_RECONCILIATION"]'::jsonb,
        '["IDEMPOTENT_REQUEST","INVOCATION_STATUS_QUERY","INVOCATION_RECONCILIATION"]'::jsonb
      )
      or certification.document_json -> 'recovery_capabilities' <>
        certification.document_json #> '{execution_profile_snapshot,recovery_capabilities}'
      or certification.document_json -> 'connection' <>
        certification.document_json #> '{execution_profile_snapshot,connection}'
      or certification.document_json -> 'receipt_ref' <> pg_catalog.jsonb_build_object(
        'artifact_id',certification.artifact_id,'artifact_type','ModelCertificationReceipt',
        'app_id',certification.app_id,'tenant_id',certification.tenant_id,
        'environment',certification.environment,'run_id',certification.run_id,
        'revision',certification.revision,'content_hash',certification.content_hash)
      or certification.document_json ->> 'execution_profile_hash' <>
        app_data_agent.u2_canonical_sha256(certification.document_json -> 'execution_profile_snapshot')
      or certification.document_json #> '{execution_profile_snapshot,capabilities}' <>
        profile.capabilities
    ) then
      readiness := 'STALE'; unavailable_reason := 'MODEL_PROFILE_STALE';
    elsif readiness is null and certification.document_json #>>
      '{execution_profile_snapshot,context_window,verification_status}' <> 'VERIFIED' then
      readiness := 'CONTEXT_WINDOW_UNVERIFIED';
      unavailable_reason := 'MODEL_CONTEXT_WINDOW_UNVERIFIED';
    elsif readiness is null and (
      profile.provider <> 'deepseek'
      or certification.document_json -> 'recovery_capabilities' <>
        '["AT_LEAST_ONCE_ONLY"]'::jsonb
      or certification.document_json #>> '{connection,kind}' <> 'SYSTEM_DEPLOYMENT'
      or certification.document_json #>> '{connection,deployment_id}' <>
        authority.deployment_id::text
    ) then
      -- U3 only installs an operational recovery driver for the exact DeepSeek
      -- AT_LEAST_ONCE_ONLY profile. Keep other certified capability claims visible
      -- for diagnosis, but never project them as executable until their driver ships.
      readiness := 'STALE';
      unavailable_reason := 'MODEL_PROFILE_STALE';
    end if;

    if readiness is null then
      connection_available := false;
      if certification.document_json #>> '{connection,kind}' = 'MANAGED_CONNECTION' then
        if app_data_agent.provider_json_object_has_exact_keys(
          certification.document_json -> 'connection',array[
            'kind','provider_connection_id','config_version','connection_hash'
          ]::text[])
          and certification.document_json #>> '{connection,provider_connection_id}' ~
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          and certification.document_json #>> '{connection,config_version}' ~ '^[1-9][0-9]*$'
        then
          select connection.* into managed_connection
          from app_data_agent.model_provider_connections connection
          where connection.app_id = authority.app_id
            and connection.environment = authority.environment
            and connection.provider_connection_id = profile.provider_connection_id
            and connection.provider_connection_id =
              (certification.document_json #>> '{connection,provider_connection_id}')::uuid
            and connection.config_version =
              (certification.document_json #>> '{connection,config_version}')::bigint
            and connection.runtime_provider = profile.provider
            and connection.status = 'ACTIVE'
            and connection.credential_ref ->> 'rotation_state' = 'ACTIVE';
          select revision.* into managed_revision
          from app_data_agent.model_provider_connection_versions revision
          where revision.app_id = managed_connection.app_id
            and revision.environment = managed_connection.environment
            and revision.provider_connection_id = managed_connection.provider_connection_id
            and revision.config_version = managed_connection.config_version;
          connection_available := managed_revision.provider_connection_id is not null
            and certification.document_json #>> '{connection,connection_hash}' =
              app_data_agent.u2_canonical_sha256(managed_revision.snapshot);
        end if;
      elsif certification.document_json #>> '{connection,kind}' = 'SYSTEM_DEPLOYMENT' then
        if app_data_agent.provider_json_object_has_exact_keys(
          certification.document_json -> 'connection',array[
            'kind','deployment_id','deployment_revision','deployment_hash'
          ]::text[])
          and certification.document_json #>> '{connection,deployment_id}' ~
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then
          select mapping.* into deployment
          from platform.deployment_mappings mapping
          where mapping.app_id = authority.app_id
            and mapping.environment = authority.environment
            and mapping.deployment_id =
              (certification.document_json #>> '{connection,deployment_id}')::uuid
            and mapping.deployment_id = authority.deployment_id
            and mapping.is_active;
          expected_connection_hash := case when deployment.deployment_id is null then null else
            app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
              'deployment_id',deployment.deployment_id,'app_id',deployment.app_id,
              'environment',deployment.environment,
              'deployment_key_hash',deployment.deployment_key_hash)) end;
          connection_available := deployment.deployment_id is not null
            and certification.document_json #>> '{connection,deployment_revision}' = '1'
            and certification.document_json #>> '{connection,deployment_hash}' =
              expected_connection_hash;
        end if;
      end if;
      if not connection_available then
        readiness := 'CREDENTIAL_UNAVAILABLE';
        unavailable_reason := 'MODEL_CREDENTIAL_UNAVAILABLE';
      end if;
    end if;

    if readiness is null then
      profiles := profiles || pg_catalog.jsonb_build_array(common_document ||
        pg_catalog.jsonb_build_object(
          'adapter_version',certification.document_json -> 'adapter_version',
          'certification_receipt_ref',pg_catalog.jsonb_build_object(
            'artifact_id',certification.artifact_id,'artifact_type','ModelCertificationReceipt',
            'app_id',certification.app_id,'tenant_id',certification.tenant_id,
            'environment',certification.environment,'run_id',certification.run_id,
            'revision',certification.revision,'content_hash',certification.content_hash),
          'execution_profile_hash',certification.document_json -> 'execution_profile_hash',
          'recovery_capabilities',certification.document_json -> 'recovery_capabilities',
          'connection',certification.document_json -> 'connection',
          'effective_context_ceiling_tokens',
            certification.document_json #> '{execution_profile_snapshot,context_window,max_context_tokens}',
          'effective_output_ceiling_tokens',
            certification.document_json #> '{execution_profile_snapshot,context_window,max_output_tokens}',
          'readiness','AVAILABLE','selectable',true,'unavailable_reason',null));
    else
      profiles := profiles || pg_catalog.jsonb_build_array(common_document ||
        pg_catalog.jsonb_build_object(
          'readiness',readiness,'selectable',false,'unavailable_reason',unavailable_reason));
    end if;
  end loop;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-execution-profile-list@1.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment,'workspace_id',authority.tenant_id,
      'principal_id',authority.principal_id),
    'profiles',profiles);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = 'P0001', message = 'PROVIDER_EXECUTION_PROFILE_LIST_INVALID';
end
$function$;
create function app_data_agent.provider_json_object_has_exact_keys(
  requested_document jsonb,
  requested_keys text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(requested_document) = 'object'
    and (select pg_catalog.array_agg(key order by key)
         from pg_catalog.jsonb_object_keys(requested_document) as key)
      = (select pg_catalog.array_agg(key order by key)
         from pg_catalog.unnest(requested_keys) as key);
$function$;

create function app_data_agent.assert_provider_active_worker_lease(
  requested_lease jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  locked_fence bigint;
  attempt_record app_data_agent.run_attempts%rowtype;
  requested_run_id uuid;
  requested_attempt_id uuid;
  requested_outbox_id uuid;
  requested_command_id uuid;
  requested_worker_id text;
  requested_lease_token bigint;
  requested_worker_fence bigint;
  requested_attempt_no bigint;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if not app_data_agent.provider_json_object_has_exact_keys(requested_lease,array[
      'scope','principal_id','outbox_id','run_id','command_id','command_kind','attempt_id',
      'attempt_no','delivery_attempt_no','lease_duration_ms','worker_id','lease_token',
      'worker_fence','expires_at','payload'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_lease -> 'payload',array['kind','effective_config_ref']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_lease -> 'scope',array['app_id','tenant_id','environment']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_lease #> '{payload,effective_config_ref}',
      array['config_id','config_revision','config_hash']::text[])
    or requested_lease ->> 'command_kind' <> 'START_L2_RESEARCH'
    or requested_lease #>> '{payload,kind}' <> 'START_L2_RESEARCH'
    or app_data_agent.contains_potential_plaintext_secret(requested_lease -> 'payload')
  then
    raise exception using errcode = '22023', message = 'PROVIDER_WORKER_LEASE_INVALID';
  end if;
  begin
    requested_run_id := (requested_lease ->> 'run_id')::uuid;
    requested_attempt_id := (requested_lease ->> 'attempt_id')::uuid;
    requested_outbox_id := (requested_lease ->> 'outbox_id')::uuid;
    requested_command_id := (requested_lease ->> 'command_id')::uuid;
    requested_worker_id := requested_lease ->> 'worker_id';
    requested_lease_token := (requested_lease ->> 'lease_token')::bigint;
    requested_worker_fence := (requested_lease ->> 'worker_fence')::bigint;
    requested_attempt_no := (requested_lease ->> 'attempt_no')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'PROVIDER_WORKER_LEASE_INVALID';
  end;
  if requested_worker_id is null
    or requested_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or requested_lease_token not between 1 and 9007199254740991
    or requested_worker_fence not between 1 and 9007199254740991
    or requested_attempt_no not between 1 and 9007199254740991
  then
    raise exception using errcode = '22023', message = 'PROVIDER_WORKER_LEASE_INVALID';
  end if;

  select * into strict authority from platform.current_backend_authority(true);
  if requested_lease #>> '{scope,app_id}' <> authority.app_id::text
    or requested_lease #>> '{scope,tenant_id}' <> authority.tenant_id::text
    or requested_lease #>> '{scope,environment}' <> authority.environment
    or requested_lease ->> 'principal_id' <> authority.principal_id::text
  then
    raise exception using errcode = '42501', message = 'PROVIDER_WORKER_LEASE_NOT_OWNED';
  end if;

  locked_fence := app_data_agent.lock_owned_run_fence(requested_run_id);
  if locked_fence is null or locked_fence <> requested_worker_fence then
    raise exception using errcode = '40001', message = 'PROVIDER_WORKER_LEASE_STALE';
  end if;
  select attempt.* into attempt_record
  from app_data_agent.run_attempts as attempt
  join app_data_agent.outbox as message
    on message.app_id = attempt.app_id
   and message.tenant_id = attempt.tenant_id
   and message.environment = attempt.environment
   and message.outbox_id = attempt.outbox_id
   and message.run_id = attempt.run_id
   and message.command_id = attempt.command_id
  where attempt.app_id = authority.app_id
    and attempt.tenant_id = authority.tenant_id
    and attempt.environment = authority.environment
    and attempt.run_id = requested_run_id
    and attempt.attempt_id = requested_attempt_id
    and attempt.attempt_no = requested_attempt_no
    and attempt.outbox_id = requested_outbox_id
    and attempt.command_id = requested_command_id
    and attempt.worker_id = requested_worker_id
    and attempt.lease_token = requested_lease_token
    and attempt.worker_fence = requested_worker_fence
    and attempt.status = 'ACTIVE'
    and attempt.lease_expires_at > pg_catalog.clock_timestamp()
    and message.status = 'LEASED'
    and message.active_attempt_id = requested_attempt_id
    and message.lease_owner = requested_worker_id
    and message.lease_token = requested_lease_token
    and message.run_fence = requested_worker_fence
    and message.lease_expires_at > pg_catalog.clock_timestamp()
  for update of attempt,message;
  if not found then
    raise exception using errcode = '40001', message = 'PROVIDER_WORKER_LEASE_STALE';
  end if;
  return pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,
    'tenant_id',authority.tenant_id,
    'environment',authority.environment,
    'deployment_id',authority.deployment_id,
    'workspace_id',authority.tenant_id,
    'principal_id',authority.principal_id,
    'run_id',attempt_record.run_id,
    'attempt_id',attempt_record.attempt_id,
    'attempt_no',attempt_record.attempt_no,
    'outbox_id',attempt_record.outbox_id,
    'command_id',attempt_record.command_id,
    'worker_id',attempt_record.worker_id,
    'lease_token',attempt_record.lease_token,
    'worker_fence',attempt_record.worker_fence
  );
end
$function$;

create function app_data_agent.mark_provider_invocation_dispatched(
  requested_lease jsonb,
  requested_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  lease_authority jsonb;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  existing_marker app_data_agent.provider_invocation_outcomes%rowtype;
  previous_outcome app_data_agent.provider_invocation_outcomes%rowtype;
  marker_document jsonb;
  projection_document jsonb;
  marker_id uuid;
  marked_at timestamptz;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash',
      'attempt_id','worker_fence'
    ]::text[])
    or requested_command ->> 'schema_version' <> 'provider-invocation-mark-started@1.0.0'
  then
    raise exception using errcode = '22023', message = 'PROVIDER_DISPATCH_MARK_COMMAND_INVALID';
  end if;
  lease_authority := app_data_agent.assert_provider_active_worker_lease(requested_lease);
  select intent.* into intent_record
  from app_data_agent.provider_invocation_intents as intent
  where intent.app_id = (lease_authority ->> 'app_id')::uuid
    and intent.tenant_id = (lease_authority ->> 'tenant_id')::uuid
    and intent.environment = lease_authority ->> 'environment'
    and intent.intent_id = (requested_command ->> 'intent_id')::uuid
    and intent.invocation_id = (requested_command ->> 'invocation_id')::uuid
    and intent.run_id = (requested_command ->> 'run_id')::uuid
    and intent.admission = 'READY'
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'PROVIDER_INVOCATION_INTENT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  select permit.* into permit_record
  from app_data_agent.provider_invocation_dispatch_permits as permit
  where permit.app_id = intent_record.app_id
    and permit.tenant_id = intent_record.tenant_id
    and permit.environment = intent_record.environment
    and permit.intent_id = intent_record.intent_id
    and permit.invocation_id = intent_record.invocation_id
    and permit.run_id = intent_record.run_id
    and permit.dispatch_hash = requested_command ->> 'dispatch_hash'
    and permit.attempt_id = (requested_command ->> 'attempt_id')::uuid
    and permit.attempt_id = (lease_authority ->> 'attempt_id')::uuid
    and permit.worker_fence = (requested_command ->> 'worker_fence')::bigint
    and permit.worker_fence = (lease_authority ->> 'worker_fence')::bigint
    and permit.outbox_id = (lease_authority ->> 'outbox_id')::uuid
    and permit.command_id = (lease_authority ->> 'command_id')::uuid
    and permit.worker_id = lease_authority ->> 'worker_id'
    and permit.lease_token = (lease_authority ->> 'lease_token')::bigint
  for share;
  if not found or requested_command -> 'scope' <> permit_record.envelope_json -> 'scope' then
    raise exception using errcode = '55000', message = 'PROVIDER_DISPATCH_PERMIT_NOT_COMMITTED';
  end if;
  projection_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-public@1.0.0',
    'invocation_id',intent_record.invocation_id,'run_id',intent_record.run_id,
    'provider',intent_record.provider,'model_profile_id',intent_record.model_profile_id,
    'model_config_version',intent_record.model_config_version,
    'profile_version',intent_record.profile_version,'model_id',intent_record.model_id,
    'certification_receipt_ref',pg_catalog.jsonb_build_object(
      'artifact_id',intent_record.certification_artifact_id,
      'artifact_type','ModelCertificationReceipt','app_id',intent_record.app_id,
      'tenant_id',intent_record.tenant_id,'environment',intent_record.environment,
      'run_id',intent_record.certification_run_id,'revision',intent_record.certification_revision,
      'content_hash',intent_record.certification_hash),
    'attempt_id',permit_record.attempt_id,'attempt_no',permit_record.attempt_no,
    'recovery_action',null,'status','STARTED','reason_code',null,
    'dispatch_hash',permit_record.dispatch_hash,'response_hash',null,
    'usage_availability',null,'usage_source',null,'input_tokens',null,
    'output_tokens',null,'total_tokens',null,'tool_calls',null,'provider_call_count',1,
    'retry_after_ms',null,'latency_ms',null,
    'receipt_deep_link','/w/' || intent_record.workspace_id::text || '/runs/' ||
      intent_record.run_id::text || '/provider-invocations/' || intent_record.invocation_id::text,
    'terminal_at',null);
  select outcome.* into existing_marker
  from app_data_agent.provider_invocation_outcomes as outcome
  where outcome.app_id = intent_record.app_id
    and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment
    and outcome.intent_id = intent_record.intent_id
    and outcome.state = 'DISPATCH_MARKED'
    and outcome.dispatch_attempt_no = (lease_authority ->> 'attempt_no')::bigint;
  if found then
    if existing_marker.dispatch_hash <> permit_record.dispatch_hash
      or existing_marker.attempt_id <> permit_record.attempt_id
      or existing_marker.worker_fence <> permit_record.worker_fence
    then
      raise exception using errcode = '23505', message = 'PROVIDER_DISPATCH_MARK_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-mark-started-result@1.0.0',
      'disposition','REPLAYED','intent',intent_record.intent_json,
      'permit',permit_record.permit_json,'marker',existing_marker.outcome_json,
      'projection',projection_document);
  end if;
  if exists (select 1 from app_data_agent.provider_invocation_outcomes outcome
    where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
      and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
      and outcome.state in ('COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN')) then
    raise exception using errcode = '55000', message = 'PROVIDER_INVOCATION_ALREADY_TERMINAL';
  end if;
  select outcome.* into previous_outcome
  from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
  order by outcome.transition_revision desc
  limit 1
  for share;
  if previous_outcome.outcome_id is not null
    and previous_outcome.state <> 'DISPATCH_MARKED'
  then
    raise exception using errcode = '55000', message = 'PROVIDER_INVOCATION_ALREADY_TERMINAL';
  end if;
  if previous_outcome.outcome_id is not null
    and not ('IDEMPOTENT_REQUEST' = any(intent_record.recovery_capabilities))
  then
    raise exception using errcode = '55000',
      message = 'PROVIDER_REDISPATCH_REQUIRES_RECONCILIATION';
  end if;
  marker_id := pg_catalog.gen_random_uuid();
  marked_at := pg_catalog.clock_timestamp();
  marker_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-dispatch-marker@1.0.0',
    'marker_id',marker_id,'intent_id',intent_record.intent_id,
    'invocation_id',intent_record.invocation_id,
    'scope',permit_record.envelope_json -> 'scope',
    'run_id',intent_record.run_id,'dispatch_hash',permit_record.dispatch_hash,
    'state','DISPATCH_MARKED',
    'dispatch_marked_at',app_data_agent.runtime_iso_timestamp(marked_at));
  marker_document := marker_document || pg_catalog.jsonb_build_object(
    'marker_hash',app_data_agent.u2_canonical_sha256(marker_document));
  insert into app_data_agent.provider_invocation_outcomes (
    app_id,tenant_id,environment,outcome_id,intent_id,invocation_id,run_id,dispatch_hash,
    transition_revision,parent_transition_revision,parent_outcome_hash,state,actor_kind,
    transition_from,recovery_action,dispatch_attempt_no,attempt_id,outbox_id,command_id,
    worker_id,lease_token,worker_fence,dispatch_marked,provider_call_may_have_started,
    provider_call_count,delivery_certainty,started_at,terminal_at,outcome_json,outcome_hash,committed_at
  ) values (
    intent_record.app_id,intent_record.tenant_id,intent_record.environment,marker_id,
    intent_record.intent_id,intent_record.invocation_id,intent_record.run_id,permit_record.dispatch_hash,
    coalesce(previous_outcome.transition_revision,0) + 1,
    previous_outcome.transition_revision,previous_outcome.outcome_hash,
    'DISPATCH_MARKED','WORKER',
    case when previous_outcome.outcome_id is null then 'INTENT_COMMITTED' else 'DISPATCH_MARKED' end,
    case when previous_outcome.outcome_id is null then 'NONE' else 'SAFE_RETRY' end,
    permit_record.attempt_no,permit_record.attempt_id,permit_record.outbox_id,
    permit_record.command_id,permit_record.worker_id,permit_record.lease_token,permit_record.worker_fence,
    true,true,1,'DISPATCHED_OUTCOME_UNKNOWN',marked_at,null,
    marker_document,marker_document ->> 'marker_hash',marked_at
  );
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-mark-started-result@1.0.0',
    'disposition','CREATED','intent',intent_record.intent_json,
    'permit',permit_record.permit_json,'marker',marker_document,
    'projection',projection_document);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023', message = 'PROVIDER_DISPATCH_MARK_COMMAND_INVALID';
end
$function$;

create function app_data_agent.mark_provider_invocation_response_observed(
  requested_lease jsonb,
  requested_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  lease_authority jsonb;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  dispatch_marker app_data_agent.provider_invocation_outcomes%rowtype;
  existing_marker app_data_agent.provider_invocation_outcomes%rowtype;
  marker_document jsonb;
  projection_document jsonb;
  marker_id uuid;
  observed_at timestamptz;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash',
      'attempt_id','worker_fence','observation_kind','response_hash','delivery_certainty'
    ]::text[])
    or requested_command ->> 'schema_version' <>
      'provider-invocation-mark-response-observed@1.0.0'
    or requested_command ->> 'observation_kind' not in (
      'COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN'
    )
    or ((requested_command ->> 'observation_kind') = 'COMPLETED') <>
      ((requested_command ->> 'response_hash') ~ '^sha256:[0-9a-f]{64}$')
    or ((requested_command ->> 'observation_kind') = 'OUTCOME_UNKNOWN') <>
      ((requested_command ->> 'delivery_certainty') = 'DISPATCHED_OUTCOME_UNKNOWN')
    or requested_command ->> 'delivery_certainty' not in (
      'DISPATCHED_OUTCOME_KNOWN','DISPATCHED_OUTCOME_UNKNOWN'
    )
  then
    raise exception using errcode = '22023',
      message = 'PROVIDER_RESPONSE_OBSERVED_COMMAND_INVALID';
  end if;
  lease_authority := app_data_agent.assert_provider_active_worker_lease(requested_lease);
  select intent.* into intent_record
  from app_data_agent.provider_invocation_intents intent
  where intent.app_id = (lease_authority ->> 'app_id')::uuid
    and intent.tenant_id = (lease_authority ->> 'tenant_id')::uuid
    and intent.environment = lease_authority ->> 'environment'
    and intent.intent_id = (requested_command ->> 'intent_id')::uuid
    and intent.invocation_id = (requested_command ->> 'invocation_id')::uuid
    and intent.run_id = (requested_command ->> 'run_id')::uuid
    and intent.admission = 'READY'
  for update;
  if not found or requested_command -> 'scope' <> pg_catalog.jsonb_build_object(
      'app_id',intent_record.app_id,'tenant_id',intent_record.tenant_id,
      'environment',intent_record.environment,'workspace_id',intent_record.workspace_id,
      'principal_id',intent_record.principal_id)
  then
    raise exception using errcode = '55000',
      message = 'PROVIDER_INVOCATION_INTENT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  select permit.* into permit_record
  from app_data_agent.provider_invocation_dispatch_permits permit
  where permit.app_id = intent_record.app_id
    and permit.tenant_id = intent_record.tenant_id
    and permit.environment = intent_record.environment
    and permit.intent_id = intent_record.intent_id
    and permit.dispatch_hash = requested_command ->> 'dispatch_hash'
    and permit.attempt_id = (requested_command ->> 'attempt_id')::uuid
    and permit.attempt_id = (lease_authority ->> 'attempt_id')::uuid
    and permit.worker_fence = (requested_command ->> 'worker_fence')::bigint
    and permit.worker_fence = (lease_authority ->> 'worker_fence')::bigint
    and permit.outbox_id = (lease_authority ->> 'outbox_id')::uuid
    and permit.command_id = (lease_authority ->> 'command_id')::uuid
    and permit.worker_id = lease_authority ->> 'worker_id'
    and permit.lease_token = (lease_authority ->> 'lease_token')::bigint;
  if not found then
    raise exception using errcode = '55000', message = 'PROVIDER_DISPATCH_PERMIT_NOT_COMMITTED';
  end if;
  select outcome.* into dispatch_marker
  from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id
    and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment
    and outcome.intent_id = intent_record.intent_id
    and outcome.dispatch_hash = permit_record.dispatch_hash
    and outcome.attempt_id = permit_record.attempt_id
    and outcome.worker_fence = permit_record.worker_fence
    and outcome.state = 'DISPATCH_MARKED'
  for share;
  if not found then
    raise exception using errcode = '55000', message = 'PROVIDER_DISPATCH_MARK_NOT_COMMITTED';
  end if;
  select outcome.* into existing_marker
  from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id
    and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment
    and outcome.intent_id = intent_record.intent_id
    and outcome.dispatch_attempt_no = permit_record.attempt_no
    and outcome.state = 'RESPONSE_OBSERVED';
  if found then
    if not app_data_agent.provider_json_object_has_exact_keys(
        existing_marker.outcome_json,array[
          'schema_version','marker_id','intent_id','invocation_id','scope','run_id',
          'dispatch_hash','attempt_id','worker_fence','state','observation_kind',
          'response_hash','delivery_certainty','response_observed_at','marker_hash'
        ]::text[])
      or existing_marker.outcome_json ->> 'schema_version' <>
        'provider-invocation-response-observed-marker@1.0.0'
      or existing_marker.outcome_json ->> 'intent_id' <> intent_record.intent_id::text
      or existing_marker.outcome_json ->> 'invocation_id' <> intent_record.invocation_id::text
      or existing_marker.outcome_json -> 'scope' <> requested_command -> 'scope'
      or existing_marker.outcome_json ->> 'run_id' <> intent_record.run_id::text
      or existing_marker.outcome_json ->> 'dispatch_hash' <> permit_record.dispatch_hash
      or existing_marker.outcome_json ->> 'attempt_id' <> permit_record.attempt_id::text
      or existing_marker.outcome_json ->> 'worker_fence' <> permit_record.worker_fence::text
      or existing_marker.outcome_json ->> 'state' <> 'RESPONSE_OBSERVED'
      or existing_marker.outcome_json ->> 'marker_hash' <>
        app_data_agent.u2_canonical_sha256(existing_marker.outcome_json - 'marker_hash')
      or existing_marker.outcome_json ->> 'observation_kind' <>
        requested_command ->> 'observation_kind'
      or existing_marker.outcome_json -> 'response_hash' <>
        requested_command -> 'response_hash'
      or existing_marker.delivery_certainty <> requested_command ->> 'delivery_certainty'
      or existing_marker.parent_outcome_hash <> dispatch_marker.outcome_hash
    then
      raise exception using errcode = '23505', message = 'PROVIDER_RESPONSE_OBSERVED_CONFLICT';
    end if;
    marker_document := existing_marker.outcome_json;
  else
    if exists (select 1 from app_data_agent.provider_invocation_outcomes outcome
      where outcome.app_id = intent_record.app_id
        and outcome.tenant_id = intent_record.tenant_id
        and outcome.environment = intent_record.environment
        and outcome.intent_id = intent_record.intent_id
        and outcome.state in ('COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN'))
    then
      raise exception using errcode = '55000', message = 'PROVIDER_INVOCATION_ALREADY_TERMINAL';
    end if;
    marker_id := pg_catalog.gen_random_uuid();
    observed_at := pg_catalog.clock_timestamp();
    marker_document := pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-response-observed-marker@1.0.0',
      'marker_id',marker_id,'intent_id',intent_record.intent_id,
      'invocation_id',intent_record.invocation_id,
      'scope',requested_command -> 'scope','run_id',intent_record.run_id,
      'dispatch_hash',permit_record.dispatch_hash,
      'attempt_id',permit_record.attempt_id,'worker_fence',permit_record.worker_fence,
      'state','RESPONSE_OBSERVED',
      'observation_kind',requested_command -> 'observation_kind',
      'response_hash',requested_command -> 'response_hash',
      'delivery_certainty',requested_command -> 'delivery_certainty',
      'response_observed_at',app_data_agent.runtime_iso_timestamp(observed_at));
    marker_document := marker_document || pg_catalog.jsonb_build_object(
      'marker_hash',app_data_agent.u2_canonical_sha256(marker_document));
    insert into app_data_agent.provider_invocation_outcomes (
      app_id,tenant_id,environment,outcome_id,intent_id,invocation_id,run_id,dispatch_hash,
      transition_revision,parent_transition_revision,parent_outcome_hash,state,observation_kind,
      actor_kind,transition_from,recovery_action,dispatch_attempt_no,attempt_id,outbox_id,
      command_id,worker_id,lease_token,worker_fence,dispatch_marked,
      provider_call_may_have_started,provider_call_count,delivery_certainty,started_at,
      terminal_at,outcome_json,outcome_hash,committed_at
    ) values (
      intent_record.app_id,intent_record.tenant_id,intent_record.environment,marker_id,
      intent_record.intent_id,intent_record.invocation_id,intent_record.run_id,
      permit_record.dispatch_hash,dispatch_marker.transition_revision + 1,
      dispatch_marker.transition_revision,dispatch_marker.outcome_hash,'RESPONSE_OBSERVED',
      requested_command ->> 'observation_kind','WORKER','DISPATCH_MARKED','NONE',
      permit_record.attempt_no,permit_record.attempt_id,permit_record.outbox_id,
      permit_record.command_id,permit_record.worker_id,permit_record.lease_token,
      permit_record.worker_fence,true,true,1,requested_command ->> 'delivery_certainty',
      dispatch_marker.started_at,null,marker_document,marker_document ->> 'marker_hash',observed_at
    );
  end if;
  projection_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-public@1.0.0',
    'invocation_id',intent_record.invocation_id,'run_id',intent_record.run_id,
    'provider',intent_record.provider,'model_profile_id',intent_record.model_profile_id,
    'model_config_version',intent_record.model_config_version,
    'profile_version',intent_record.profile_version,'model_id',intent_record.model_id,
    'certification_receipt_ref',pg_catalog.jsonb_build_object(
      'artifact_id',intent_record.certification_artifact_id,
      'artifact_type','ModelCertificationReceipt','app_id',intent_record.app_id,
      'tenant_id',intent_record.tenant_id,'environment',intent_record.environment,
      'run_id',intent_record.certification_run_id,'revision',intent_record.certification_revision,
      'content_hash',intent_record.certification_hash),
    'attempt_id',permit_record.attempt_id,'attempt_no',permit_record.attempt_no,
    'recovery_action',null,'status','STARTED','reason_code',null,
    'dispatch_hash',permit_record.dispatch_hash,'response_hash',null,
    'usage_availability',null,'usage_source',null,'input_tokens',null,
    'output_tokens',null,'total_tokens',null,'tool_calls',null,'provider_call_count',1,
    'retry_after_ms',null,'latency_ms',null,
    'receipt_deep_link','/w/' || intent_record.workspace_id::text || '/runs/' ||
      intent_record.run_id::text || '/provider-invocations/' || intent_record.invocation_id::text,
    'terminal_at',null);
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-mark-response-observed-result@1.0.0',
    'disposition',case when existing_marker.outcome_id is null then 'CREATED' else 'REPLAYED' end,
    'intent',intent_record.intent_json,'permit',permit_record.permit_json,
    'marker',marker_document,'projection',projection_document);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023', message = 'PROVIDER_RESPONSE_OBSERVED_COMMAND_INVALID';
end
$function$;

-- Remaining U3 invocation RPCs are defined below this common fixed-lock lease gate.

create function app_data_agent.begin_provider_invocation(
  requested_lease jsonb,
  requested_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  lease_authority jsonb;
  envelope jsonb;
  scope_document jsonb;
  invocation_key_draft jsonb;
  intent_document jsonb;
  permit_document jsonb;
  existing_intent app_data_agent.provider_invocation_intents%rowtype;
  existing_permit app_data_agent.provider_invocation_dispatch_permits%rowtype;
  existing_outcome app_data_agent.provider_invocation_outcomes%rowtype;
  existing_usage app_data_agent.provider_invocation_usage_receipts%rowtype;
  response_record app_data_agent.artifacts%rowtype;
  config_record app_data_agent.effective_run_config_receipts%rowtype;
  context_record app_data_agent.effective_config_context_receipts%rowtype;
  model_record app_data_agent.model_catalog_entries%rowtype;
  model_revision app_data_agent.model_config_versions%rowtype;
  task_record app_data_agent.artifacts%rowtype;
  certification_record app_data_agent.artifacts%rowtype;
  projection_record app_data_agent.artifacts%rowtype;
  connection_record app_data_agent.model_provider_connections%rowtype;
  connection_revision app_data_agent.model_provider_connection_versions%rowtype;
  deployment_record platform.deployment_mappings%rowtype;
  intent_id uuid;
  permit_id uuid;
  committed_at timestamptz;
  intent_committed_at timestamptz;
  model_resource_hash text;
  connection_hash text;
  expected_deployment_hash text;
  invocation_key_hash text;
  dispatch_hash text;
  recovery_capabilities text[];
  result_disposition text;
  rejection_reason text;
  rejection_outcome_document jsonb;
  rejection_usage_document jsonb;
  rejection_projection_document jsonb;
  rejection_outcome_id uuid;
  rejection_usage_id uuid;
  terminal_projection_document jsonb;
  terminal_response_ref jsonb;
  terminal_replay_action text;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(
      requested_command,array['schema_version','envelope']::text[])
    or requested_command ->> 'schema_version' <> 'provider-invocation-begin@1.0.0'
  then
    raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_COMMAND_INVALID';
  end if;
  envelope := requested_command -> 'envelope';
  if not app_data_agent.provider_json_object_has_exact_keys(envelope,array[
      'schema_version','invocation_id','idempotency_key','scope','run_id','logical_call_id',
      'task_ref','effective_config_ref','context_receipt_ref','lease','model_profile',
      'certification','connection','request_policy','projection','invocation_key_hash','dispatch_hash'
    ]::text[])
    or envelope ->> 'schema_version' <> 'provider-dispatch-envelope@1.0.0'
    or app_data_agent.contains_potential_plaintext_secret(
      envelope
        #- '{lease,lease_token}'
        #- '{request_policy,budget,max_input_tokens}'
        #- '{request_policy,budget,max_output_tokens}'
        #- '{certification,certified_context_window,max_context_tokens}'
        #- '{certification,certified_context_window,max_output_tokens}'
        #- '{projection,token_bound_policy_version}'
        #- '{projection,trusted_input_token_upper_bound}'
        #- '{projection,reserved_output_tokens}'
        #- '{projection,effective_context_ceiling_tokens}'
        #- '{projection,effective_output_ceiling_tokens}'
    )
  then
    raise exception using errcode = '22023', message = 'PROVIDER_DISPATCH_ENVELOPE_INVALID';
  end if;
  if pg_catalog.length(envelope ->> 'idempotency_key') not between 8 and 256
    or envelope ->> 'idempotency_key' !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
    or envelope ->> 'invocation_id' <> pg_catalog.lower((envelope ->> 'invocation_id')::uuid::text)
    or envelope ->> 'run_id' <> pg_catalog.lower((envelope ->> 'run_id')::uuid::text)
    or envelope ->> 'logical_call_id' <>
      pg_catalog.lower((envelope ->> 'logical_call_id')::uuid::text)
    or envelope #>> '{model_profile,profile_version}' <>
      'model-profile@' || (envelope #>> '{model_profile,model_config_version}')::bigint::text
    or envelope #>> '{model_profile,adapter_version}' !~
      '^[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$'
    or (envelope #>> '{request_policy,budget,timeout_ms}')::bigint not between 1 and 600000
    or (envelope #>> '{request_policy,budget,max_input_tokens}')::bigint not between 1 and 9007199254740991
    or (envelope #>> '{request_policy,budget,max_output_tokens}')::bigint not between 1 and 9007199254740991
    or (envelope #>> '{request_policy,budget,max_tool_calls}')::bigint not between 0 and 9007199254740991
    or (envelope #>> '{request_policy,budget,provider_call_limit}')::integer <> 1
    or pg_catalog.jsonb_array_length(envelope #> '{request_policy,tool_allowlist}') > 64
    or exists (
      select 1 from (
        select value,pg_catalog.lag(value) over (order by ordinal) as previous_value
        from pg_catalog.jsonb_array_elements_text(envelope #> '{request_policy,tool_allowlist}')
          with ordinality as tool(value,ordinal)
      ) ordered_tool
      where value !~ '^[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$'
        or previous_value is not null and previous_value >= value
    )
  then
    raise exception using errcode = '22023', message = 'PROVIDER_DISPATCH_ENVELOPE_INVALID';
  end if;
  if not app_data_agent.provider_json_object_has_exact_keys(
      envelope -> 'scope',array['app_id','tenant_id','environment','workspace_id','principal_id']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(envelope -> 'task_ref',array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(envelope -> 'effective_config_ref',array[
      'config_id','config_revision','config_hash'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(envelope -> 'context_receipt_ref',array[
      'receipt_id','receipt_hash'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(envelope -> 'lease',array[
      'outbox_id','command_id','attempt_id','attempt_no','worker_id','lease_token','worker_fence'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(envelope -> 'model_profile',array[
      'profile_id','model_config_version','resource_hash','profile_version','provider','model_id',
      'adapter_version'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(envelope -> 'certification',array[
      'receipt_ref','execution_profile_hash','recovery_capabilities','certified_context_window'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(envelope #> '{certification,receipt_ref}',array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      envelope #> '{certification,certified_context_window}',array[
        'verification_status','max_context_tokens','max_output_tokens'
      ]::text[])
    or pg_catalog.jsonb_typeof(envelope #> '{certification,recovery_capabilities}') <> 'array'
    or not app_data_agent.provider_json_object_has_exact_keys(envelope -> 'request_policy',array[
      'response_schema_version','tool_allowlist','budget'
    ]::text[])
    or pg_catalog.jsonb_typeof(envelope #> '{request_policy,tool_allowlist}') <> 'array'
    or not app_data_agent.provider_json_object_has_exact_keys(envelope #> '{request_policy,budget}',array[
      'timeout_ms','max_input_tokens','max_output_tokens','max_tool_calls','provider_call_limit'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(envelope -> 'projection',array[
      'projection_version','receipt_ref','payload_hash','token_bound_policy_version',
      'trusted_input_token_upper_bound',
      'reserved_output_tokens','effective_context_ceiling_tokens',
      'effective_output_ceiling_tokens','capacity_status','taint_hash'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(envelope #> '{projection,receipt_ref}',array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
    ]::text[])
    or ((envelope #>> '{connection,kind}') = 'SYSTEM_DEPLOYMENT' and not
      app_data_agent.provider_json_object_has_exact_keys(envelope -> 'connection',array[
        'kind','deployment_id','deployment_revision','deployment_hash'
      ]::text[]))
    or ((envelope #>> '{connection,kind}') = 'MANAGED_CONNECTION' and not
      app_data_agent.provider_json_object_has_exact_keys(envelope -> 'connection',array[
        'kind','provider_connection_id','config_version','connection_hash'
      ]::text[]))
    or envelope #>> '{connection,kind}' not in ('SYSTEM_DEPLOYMENT','MANAGED_CONNECTION')
  then
    raise exception using errcode = '22023', message = 'PROVIDER_DISPATCH_ENVELOPE_INVALID';
  end if;
  lease_authority := app_data_agent.assert_provider_active_worker_lease(requested_lease);
  scope_document := envelope -> 'scope';
  if scope_document <> pg_catalog.jsonb_build_object(
      'app_id',lease_authority -> 'app_id',
      'tenant_id',lease_authority -> 'tenant_id',
      'environment',lease_authority -> 'environment',
      'workspace_id',lease_authority -> 'workspace_id',
      'principal_id',lease_authority -> 'principal_id')
    or envelope ->> 'run_id' <> lease_authority ->> 'run_id'
    or envelope -> 'lease' <> pg_catalog.jsonb_build_object(
      'outbox_id',lease_authority -> 'outbox_id',
      'command_id',lease_authority -> 'command_id',
      'attempt_id',lease_authority -> 'attempt_id',
      'attempt_no',lease_authority -> 'attempt_no',
      'worker_id',lease_authority -> 'worker_id',
      'lease_token',lease_authority -> 'lease_token',
      'worker_fence',lease_authority -> 'worker_fence')
  then
    raise exception using errcode = '40001', message = 'PROVIDER_WORKER_LEASE_MISMATCH';
  end if;

  -- Logical identity excludes attempt-bound ContextReceipt and lease. Dispatch identity includes both.
  invocation_key_draft := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-spec@1.0.0',
    'invocation_id',envelope -> 'invocation_id',
    'idempotency_key',envelope -> 'idempotency_key',
    'scope',envelope -> 'scope','run_id',envelope -> 'run_id',
    'logical_call_id',envelope -> 'logical_call_id','task_ref',envelope -> 'task_ref',
    'effective_config_ref',envelope -> 'effective_config_ref',
    'model_profile',envelope -> 'model_profile','certification',envelope -> 'certification',
    'connection',envelope -> 'connection','request_policy',envelope -> 'request_policy',
    'projection',envelope -> 'projection');
  invocation_key_hash := app_data_agent.u2_canonical_sha256(invocation_key_draft);
  dispatch_hash := app_data_agent.u2_canonical_sha256(envelope - 'dispatch_hash');
  if envelope ->> 'invocation_key_hash' <> invocation_key_hash then
    raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_KEY_HASH_MISMATCH';
  end if;
  if envelope ->> 'dispatch_hash' <> dispatch_hash then
    raise exception using errcode = '22023', message = 'PROVIDER_DISPATCH_HASH_MISMATCH';
  end if;

  select config.* into config_record
  from app_data_agent.effective_run_config_receipts as config
  where config.app_id = (lease_authority ->> 'app_id')::uuid
    and config.tenant_id = (lease_authority ->> 'tenant_id')::uuid
    and config.environment = lease_authority ->> 'environment'
    and config.run_id = (lease_authority ->> 'run_id')::uuid
    and config.principal_id = (lease_authority ->> 'principal_id')::uuid
    and config.config_id = (envelope #>> '{effective_config_ref,config_id}')::uuid
    and config.config_revision = (envelope #>> '{effective_config_ref,config_revision}')::bigint
    and config.config_hash = envelope #>> '{effective_config_ref,config_hash}'
  for share;
  if not found then
    raise exception using errcode = '55000', message = 'PROVIDER_EFFECTIVE_CONFIG_MISMATCH';
  end if;
  perform app_data_agent.revalidate_effective_run_config_internal(
    config_record.config_id,config_record.config_revision,config_record.config_hash,
    config_record.run_id,true);

  select context.* into context_record
  from app_data_agent.effective_config_context_receipts as context
  where context.app_id = config_record.app_id
    and context.tenant_id = config_record.tenant_id
    and context.environment = config_record.environment
    and context.context_receipt_id = (envelope #>> '{context_receipt_ref,receipt_id}')::uuid
    and context.receipt_hash = envelope #>> '{context_receipt_ref,receipt_hash}'
    and context.consumer_kind = 'WORKER_START'
    and context.config_id = config_record.config_id
    and context.config_revision = config_record.config_revision
    and context.config_hash = config_record.config_hash
    and context.run_id = config_record.run_id
    and context.principal_id = config_record.principal_id
    and context.attempt_id = (lease_authority ->> 'attempt_id')::uuid
    and context.outbox_id = (lease_authority ->> 'outbox_id')::uuid
    and context.command_id = (lease_authority ->> 'command_id')::uuid
    and context.worker_id = lease_authority ->> 'worker_id'
    and context.lease_token = (lease_authority ->> 'lease_token')::bigint
    and context.worker_fence = (lease_authority ->> 'worker_fence')::bigint
  for share;
  if not found or context_record.receipt_hash <> app_data_agent.u2_canonical_sha256(context_record.receipt_json) then
    raise exception using errcode = '55000', message = 'PROVIDER_CONTEXT_RECEIPT_MISMATCH';
  end if;

  if envelope #>> '{model_profile,profile_id}' <> config_record.model_profile_id::text
    or (envelope #>> '{model_profile,model_config_version}')::bigint <> config_record.model_config_version
    or envelope #>> '{model_profile,profile_version}' <>
      'model-profile@' || config_record.model_config_version::text
    or envelope #>> '{model_profile,provider}' <> config_record.provider
    or envelope #>> '{model_profile,model_id}' <> config_record.model_id
  then
    raise exception using errcode = '55000', message = 'PROVIDER_PROFILE_NOT_AVAILABLE';
  end if;
  if config_record.provider = 'anthropic' then
    rejection_reason := 'PROVIDER_PROFILE_NOT_AVAILABLE';
  end if;
  select catalog.* into model_record
  from app_data_agent.model_catalog_entries as catalog
  where catalog.app_id = config_record.app_id
    and catalog.environment = config_record.environment
    and catalog.model_profile_id = config_record.model_profile_id
    and catalog.config_version = config_record.model_config_version
    and catalog.provider = config_record.provider
    and catalog.model_id = config_record.model_id
    and catalog.status = 'ACTIVE'
  for share;
  select revision.* into model_revision
  from app_data_agent.model_config_versions as revision
  where revision.app_id = config_record.app_id
    and revision.environment = config_record.environment
    and revision.model_profile_id = config_record.model_profile_id
    and revision.config_version = config_record.model_config_version;
  select binding.effective_hash into model_resource_hash
  from app_data_agent.effective_run_config_resource_bindings as binding
  where binding.app_id = config_record.app_id
    and binding.tenant_id = config_record.tenant_id
    and binding.environment = config_record.environment
    and binding.config_id = config_record.config_id
    and binding.config_revision = config_record.config_revision
    and binding.resource_kind = 'MODEL_PROFILE'
    and binding.availability = 'AVAILABLE';
  if model_revision.model_profile_id is null or model_resource_hash is null
    or envelope #>> '{model_profile,resource_hash}' <> model_resource_hash
    or config_record.effective_config_json #>> '{model,resource_hash}' <> model_resource_hash
  then
    raise exception using errcode = '55000', message = 'PROVIDER_PROFILE_NOT_AVAILABLE';
  end if;
  if model_record.model_profile_id is null then
    rejection_reason := coalesce(rejection_reason,'PROVIDER_PROFILE_NOT_AVAILABLE');
  end if;

  select artifact.* into task_record
  from app_data_agent.artifacts as artifact
  where artifact.app_id = config_record.app_id
    and artifact.tenant_id = config_record.tenant_id
    and artifact.environment = config_record.environment
    and artifact.run_id = config_record.run_id
    and artifact.artifact_id = (envelope #>> '{task_ref,artifact_id}')::uuid
    and artifact.artifact_type = envelope #>> '{task_ref,artifact_type}'
    and artifact.revision = (envelope #>> '{task_ref,revision}')::integer
    and artifact.content_hash = envelope #>> '{task_ref,content_hash}'
    and artifact.is_active
  for share;
  if not found then
    raise exception using errcode = '55000', message = 'PROVIDER_TASK_REFERENCE_INVALID';
  end if;
  if envelope -> 'task_ref' <> pg_catalog.jsonb_build_object(
      'artifact_id',task_record.artifact_id,'artifact_type',task_record.artifact_type,
      'app_id',task_record.app_id,'tenant_id',task_record.tenant_id,
      'environment',task_record.environment,'run_id',task_record.run_id,
      'revision',task_record.revision,'content_hash',task_record.content_hash)
  then
    raise exception using errcode = '55000', message = 'PROVIDER_TASK_REFERENCE_INVALID';
  end if;

  select artifact.* into projection_record
  from app_data_agent.artifacts as artifact
  where artifact.app_id = config_record.app_id
    and artifact.tenant_id = config_record.tenant_id
    and artifact.environment = config_record.environment
    and artifact.run_id = config_record.run_id
    and artifact.artifact_id = (envelope #>> '{projection,receipt_ref,artifact_id}')::uuid
    and artifact.artifact_type = 'AgentDataProjectionReceipt'
    and artifact.revision = (envelope #>> '{projection,receipt_ref,revision}')::integer
    and artifact.content_hash = envelope #>> '{projection,receipt_ref,content_hash}'
    and artifact.is_active
  for share;
  if not found
    or not app_data_agent.provider_json_object_has_exact_keys(projection_record.document_json,array[
      'artifact_type','protocol_version','receipt_id','scope','run_id','request_id',
      'principal_id','model_execution_profile_hash','input_refs','approved_fields','classification',
      'payload_hash','token_bound_policy_version','trusted_input_token_upper_bound',
      'redaction','dlp','taint','receipt_hash'
    ]::text[])
    or projection_record.document_json ->> 'artifact_type' <> 'AgentDataProjectionReceipt'
    or projection_record.document_json ->> 'protocol_version' <> 'agent-data-projection@2.0.0'
    or envelope #>> '{projection,projection_version}' <> 'agent-data-projection@2.0.0'
    or projection_record.revision <> 1
    or projection_record.artifact_id::text <> projection_record.document_json ->> 'receipt_id'
    or projection_record.artifact_id::text <> envelope #>> '{projection,receipt_ref,artifact_id}'
    or projection_record.content_hash <> projection_record.document_json ->> 'receipt_hash'
    or envelope #> '{projection,receipt_ref}' <> pg_catalog.jsonb_build_object(
      'artifact_id',projection_record.artifact_id,'artifact_type','AgentDataProjectionReceipt',
      'app_id',projection_record.app_id,'tenant_id',projection_record.tenant_id,
      'environment',projection_record.environment,'run_id',projection_record.run_id,
      'revision',projection_record.revision,'content_hash',projection_record.content_hash)
    or not app_data_agent.provider_json_object_has_exact_keys(
      projection_record.document_json -> 'scope',array['app_id','tenant_id','environment']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      projection_record.document_json -> 'redaction',array['count','policy_version']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      projection_record.document_json -> 'dlp',array['status','policy_version']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      projection_record.document_json -> 'taint',array['policy_version','taint_hash']::text[])
    or pg_catalog.jsonb_typeof(projection_record.document_json -> 'input_refs') <> 'array'
    or pg_catalog.jsonb_array_length(projection_record.document_json -> 'input_refs') not between 1 and 64
    or pg_catalog.jsonb_typeof(projection_record.document_json -> 'approved_fields') <> 'array'
    or pg_catalog.jsonb_array_length(projection_record.document_json -> 'approved_fields') not between 1 and 256
    or projection_record.document_json ->> 'classification' not in (
      'PUBLIC','INTERNAL','RESTRICTED','SECRET'
    )
    or projection_record.document_json #>> '{dlp,status}' <> 'PASS'
    or projection_record.document_json #>> '{scope,app_id}' <> config_record.app_id::text
    or projection_record.document_json #>> '{scope,tenant_id}' <> config_record.tenant_id::text
    or projection_record.document_json #>> '{scope,environment}' <> config_record.environment
    or projection_record.document_json ->> 'run_id' <> config_record.run_id::text
    or projection_record.document_json ->> 'receipt_id' <> envelope ->> 'invocation_id'
    or projection_record.document_json ->> 'request_id' <> envelope ->> 'invocation_id'
    or projection_record.document_json ->> 'principal_id' <> config_record.principal_id::text
    or projection_record.document_json ->> 'model_execution_profile_hash' <>
      envelope #>> '{certification,execution_profile_hash}'
    or projection_record.document_json ->> 'payload_hash' <> envelope #>> '{projection,payload_hash}'
    or projection_record.document_json ->> 'token_bound_policy_version' <>
      'utf8-byte-upper-bound@1.0.0'
    or envelope #>> '{projection,token_bound_policy_version}' <>
      'utf8-byte-upper-bound@1.0.0'
    or projection_record.document_json ->> 'trusted_input_token_upper_bound' <>
      envelope #>> '{projection,trusted_input_token_upper_bound}'
    or projection_record.document_json #>> '{taint,taint_hash}' <> envelope #>> '{projection,taint_hash}'
    or projection_record.document_json ->> 'receipt_hash' <>
      app_data_agent.u2_canonical_sha256(projection_record.document_json - 'receipt_hash')
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(projection_record.document_json -> 'input_refs')
        with ordinality as input_ref(reference,ordinal)
      where not app_data_agent.provider_json_object_has_exact_keys(reference,array[
          'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
        ]::text[])
        or reference ->> 'app_id' <> config_record.app_id::text
        or reference ->> 'tenant_id' <> config_record.tenant_id::text
        or reference ->> 'environment' <> config_record.environment
        or reference ->> 'run_id' <> config_record.run_id::text
        or reference ->> 'content_hash' !~ '^sha256:[0-9a-f]{64}$'
        or (reference ->> 'revision')::bigint not between 1 and 9007199254740991
    )
    or exists (
      select 1 from (
        select reference::text as identity,
          pg_catalog.lag(reference::text) over (order by ordinal) as previous_identity
        from pg_catalog.jsonb_array_elements(projection_record.document_json -> 'input_refs')
          with ordinality as input_ref(reference,ordinal)
      ) ordered_reference
      where previous_identity is not null and previous_identity >= identity
    )
    or exists (
      select 1 from (
        select value,
          pg_catalog.lag(value) over (order by ordinal) as previous_value
        from pg_catalog.jsonb_array_elements_text(projection_record.document_json -> 'approved_fields')
          with ordinality as approved_field(value,ordinal)
      ) ordered_field
      where pg_catalog.length(pg_catalog.btrim(value)) = 0
        or previous_value is not null and previous_value >= value
    )
  then
    raise exception using errcode = '55000', message = 'PROVIDER_DATA_PROJECTION_RECEIPT_INVALID';
  end if;

  select artifact.* into certification_record
  from app_data_agent.artifacts as artifact
  where artifact.app_id = config_record.app_id
    and artifact.tenant_id = config_record.tenant_id
    and artifact.environment = config_record.environment
    and artifact.run_id = (envelope #>> '{certification,receipt_ref,run_id}')::uuid
    and artifact.artifact_id = (envelope #>> '{certification,receipt_ref,artifact_id}')::uuid
    and artifact.artifact_type = 'ModelCertificationReceipt'
    and artifact.revision = (envelope #>> '{certification,receipt_ref,revision}')::integer
    and artifact.content_hash = envelope #>> '{certification,receipt_ref,content_hash}'
    and artifact.is_active
  for share;
  if found and (
      certification_record.document_json #>>
        '{execution_profile_snapshot,context_window,verification_status}' <> 'VERIFIED'
      or envelope #>> '{certification,certified_context_window,verification_status}' <> 'VERIFIED'
    )
  then
    rejection_reason := coalesce(rejection_reason,'PROVIDER_CONTEXT_WINDOW_UNVERIFIED');
  end if;
  if not found
    or not app_data_agent.provider_json_object_has_exact_keys(certification_record.document_json,array[
      'schema_version','receipt_ref','profile_id','model_config_version','provider','model_id',
      'profile_version','adapter_version','execution_profile_hash','execution_profile_snapshot',
      'recovery_capabilities','connection','certification_basis','verdict'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      certification_record.document_json -> 'receipt_ref',array[
        'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
      ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      certification_record.document_json -> 'execution_profile_snapshot',array[
        'profile_id','scope','provider','model_id','model_config_version','profile_version',
        'adapter_version','recovery_capabilities','connection','capabilities','context_window',
        'region_privacy','fallback_compatibility'
      ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      certification_record.document_json #> '{execution_profile_snapshot,scope}',
      array['app_id','tenant_id','environment']::text[])
    or certification_record.document_json #>> '{execution_profile_snapshot,scope,app_id}' <>
      certification_record.app_id::text
    or certification_record.document_json #>> '{execution_profile_snapshot,scope,tenant_id}' <>
      certification_record.tenant_id::text
    or certification_record.document_json #>> '{execution_profile_snapshot,scope,environment}' <>
      certification_record.environment
    or envelope #> '{certification,receipt_ref}' <> pg_catalog.jsonb_build_object(
      'artifact_id',certification_record.artifact_id,'artifact_type','ModelCertificationReceipt',
      'app_id',certification_record.app_id,'tenant_id',certification_record.tenant_id,
      'environment',certification_record.environment,'run_id',certification_record.run_id,
      'revision',certification_record.revision,'content_hash',certification_record.content_hash)
    or certification_record.content_hash <>
      app_data_agent.u2_canonical_sha256(
        certification_record.document_json #- '{receipt_ref,content_hash}'
      )
    or certification_record.document_json ->> 'schema_version' <>
      'model-execution-certification@1.0.0'
    or certification_record.document_json ->> 'verdict' <> 'PASS'
    or certification_record.document_json #>> '{receipt_ref,app_id}' <> certification_record.app_id::text
    or certification_record.document_json #>> '{receipt_ref,tenant_id}' <> certification_record.tenant_id::text
    or certification_record.document_json #>> '{receipt_ref,environment}' <> certification_record.environment
    or certification_record.document_json #>> '{receipt_ref,run_id}' <> certification_record.run_id::text
    or certification_record.document_json #>> '{receipt_ref,artifact_id}' <> certification_record.artifact_id::text
    or certification_record.document_json #>> '{receipt_ref,artifact_type}' <> 'ModelCertificationReceipt'
    or certification_record.document_json #>> '{receipt_ref,revision}' <> certification_record.revision::text
    or certification_record.document_json #>> '{receipt_ref,content_hash}' <> certification_record.content_hash
    or certification_record.document_json ->> 'profile_id' <> config_record.model_profile_id::text
    or certification_record.document_json ->> 'provider' <> config_record.provider
    or certification_record.document_json ->> 'model_id' <> config_record.model_id
    or certification_record.document_json ->> 'profile_version' <>
      envelope #>> '{model_profile,profile_version}'
    or certification_record.document_json ->> 'execution_profile_hash' <>
      envelope #>> '{certification,execution_profile_hash}'
    or certification_record.document_json ->> 'model_config_version' <>
      config_record.model_config_version::text
    or certification_record.document_json ->> 'adapter_version' <>
      envelope #>> '{model_profile,adapter_version}'
    or certification_record.document_json #>> '{execution_profile_snapshot,profile_id}' <>
      config_record.model_profile_id::text
    or certification_record.document_json #>> '{execution_profile_snapshot,model_config_version}' <>
      config_record.model_config_version::text
    or certification_record.document_json #>> '{execution_profile_snapshot,provider}' <>
      config_record.provider
    or certification_record.document_json #>> '{execution_profile_snapshot,model_id}' <>
      config_record.model_id
    or certification_record.document_json #>> '{execution_profile_snapshot,profile_version}' <>
      envelope #>> '{model_profile,profile_version}'
    or certification_record.document_json #>> '{execution_profile_snapshot,adapter_version}' <>
      envelope #>> '{model_profile,adapter_version}'
    or certification_record.document_json #> '{execution_profile_snapshot,recovery_capabilities}' <>
      envelope #> '{certification,recovery_capabilities}'
    or certification_record.document_json #> '{execution_profile_snapshot,connection}' <>
      envelope -> 'connection'
    or certification_record.document_json -> 'recovery_capabilities' <>
      envelope #> '{certification,recovery_capabilities}'
    or certification_record.document_json -> 'connection' <> envelope -> 'connection'
    or certification_record.document_json ->> 'execution_profile_hash' <>
      app_data_agent.u2_canonical_sha256(certification_record.document_json -> 'execution_profile_snapshot')
    or certification_record.document_json #> '{execution_profile_snapshot,capabilities}' <>
      model_record.capabilities
    or certification_record.document_json #> '{execution_profile_snapshot,context_window}' <>
      envelope #> '{certification,certified_context_window}'
    or (certification_record.document_json #>> '{certification_basis,kind}' = 'GOAL_PREFLIGHT_ATTESTATION'
      and (certification_record.document_json #>> '{certification_basis,observed_provider}' <>
          config_record.provider
        or certification_record.document_json #>> '{certification_basis,observed_model_id}' <>
          config_record.model_id))
  then
    rejection_reason := coalesce(rejection_reason,'PROVIDER_PROFILE_NOT_AVAILABLE');
  end if;
  select pg_catalog.array_agg(value order by ordinal) into recovery_capabilities
  from pg_catalog.jsonb_array_elements_text(envelope #> '{certification,recovery_capabilities}')
    with ordinality as capability(value,ordinal);
  if recovery_capabilities is null
    or not (
      recovery_capabilities = array['IDEMPOTENT_REQUEST']::text[]
      or recovery_capabilities = array['INVOCATION_STATUS_QUERY']::text[]
      or recovery_capabilities = array['INVOCATION_RECONCILIATION']::text[]
      or recovery_capabilities = array['AT_LEAST_ONCE_ONLY']::text[]
      or recovery_capabilities = array['IDEMPOTENT_REQUEST','INVOCATION_STATUS_QUERY']::text[]
      or recovery_capabilities = array['IDEMPOTENT_REQUEST','INVOCATION_RECONCILIATION']::text[]
      or recovery_capabilities = array['INVOCATION_STATUS_QUERY','INVOCATION_RECONCILIATION']::text[]
      or recovery_capabilities = array[
        'IDEMPOTENT_REQUEST','INVOCATION_STATUS_QUERY','INVOCATION_RECONCILIATION'
      ]::text[]
    )
  then
    raise exception using errcode = '22023', message = 'PROVIDER_RECOVERY_CAPABILITIES_INVALID';
  end if;
  if config_record.provider <> 'deepseek'
    or recovery_capabilities <> array['AT_LEAST_ONCE_ONLY']::text[]
    or envelope #>> '{connection,kind}' <> 'SYSTEM_DEPLOYMENT'
    or envelope #>> '{connection,deployment_id}' <> lease_authority ->> 'deployment_id'
  then
    -- Certification describes protocol capability; it does not prove that this
    -- deployment has the matching recovery driver. The installed U3 driver is
    -- intentionally limited to the exact DeepSeek ALO profile.
    rejection_reason := coalesce(
      rejection_reason,'PROVIDER_PROFILE_NOT_AVAILABLE'
    );
  end if;

  if envelope #>> '{connection,kind}' = 'MANAGED_CONNECTION' then
    select connection.* into connection_record
    from app_data_agent.model_provider_connections as connection
    where connection.app_id = config_record.app_id
      and connection.environment = config_record.environment
      and connection.provider_connection_id = model_record.provider_connection_id
      and connection.provider_connection_id = (envelope #>> '{connection,provider_connection_id}')::uuid
      and connection.config_version = (envelope #>> '{connection,config_version}')::bigint
      and connection.runtime_provider = config_record.provider
      and connection.status = 'ACTIVE'
      and connection.credential_ref ->> 'rotation_state' = 'ACTIVE'
    for share;
    select revision.* into connection_revision
    from app_data_agent.model_provider_connection_versions as revision
    where revision.app_id = config_record.app_id
      and revision.environment = config_record.environment
      and revision.provider_connection_id = connection_record.provider_connection_id
      and revision.config_version = connection_record.config_version;
    connection_hash := app_data_agent.u2_canonical_sha256(connection_revision.snapshot);
    if connection_record.provider_connection_id is null
      or connection_revision.provider_connection_id is null
      or envelope #>> '{connection,connection_hash}' <> connection_hash
    then
      rejection_reason := coalesce(rejection_reason,'PROVIDER_PROFILE_NOT_AVAILABLE');
    end if;
  elsif envelope #>> '{connection,kind}' = 'SYSTEM_DEPLOYMENT' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'provider-system-deployment:' || config_record.app_id::text || ':' ||
      config_record.environment || ':' || (envelope #>> '{connection,deployment_id}'),0));
    select deployment.* into deployment_record
    from platform.deployment_mappings as deployment
    where deployment.app_id = config_record.app_id
      and deployment.environment = config_record.environment
      and deployment.deployment_id = (envelope #>> '{connection,deployment_id}')::uuid
      and deployment.deployment_id = (lease_authority ->> 'deployment_id')::uuid
      and deployment.is_active
    ;
    expected_deployment_hash := app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'deployment_id',deployment_record.deployment_id,
      'app_id',deployment_record.app_id,
      'environment',deployment_record.environment,
      'deployment_key_hash',deployment_record.deployment_key_hash));
    if deployment_record.deployment_id is null
      or (envelope #>> '{connection,deployment_revision}')::bigint <> 1
      or envelope #>> '{connection,deployment_hash}' <> expected_deployment_hash
    then
      rejection_reason := coalesce(rejection_reason,'PROVIDER_PROFILE_NOT_AVAILABLE');
    end if;
  else
    raise exception using errcode = '22023', message = 'PROVIDER_CONNECTION_PROOF_INVALID';
  end if;

  if (envelope #>> '{request_policy,budget,provider_call_limit}')::integer <> 1 then
    rejection_reason := coalesce(rejection_reason,'PROVIDER_CALL_LIMIT_EXCEEDED');
  elsif (envelope #>> '{projection,reserved_output_tokens}')::bigint >
      (envelope #>> '{request_policy,budget,max_output_tokens}')::bigint
    or (envelope #>> '{projection,reserved_output_tokens}')::bigint >
      (envelope #>> '{projection,effective_output_ceiling_tokens}')::bigint
  then
    rejection_reason := coalesce(rejection_reason,'PROVIDER_OUTPUT_LIMIT_EXCEEDED');
  elsif envelope #>> '{projection,capacity_status}' <> 'WITHIN_LIMIT'
    or (envelope #>> '{projection,trusted_input_token_upper_bound}')::bigint >
      (envelope #>> '{request_policy,budget,max_input_tokens}')::bigint
    or (envelope #>> '{projection,trusted_input_token_upper_bound}')::bigint +
      (envelope #>> '{projection,reserved_output_tokens}')::bigint >
      (envelope #>> '{projection,effective_context_ceiling_tokens}')::bigint
  then
    rejection_reason := coalesce(rejection_reason,'PROVIDER_CONTEXT_LIMIT_EXCEEDED');
  end if;
  if not (config_record.effective_config_json #> '{effective_egress,allowed_providers}') ?
      config_record.provider then
    raise exception using errcode = '55000', message = 'PROVIDER_EGRESS_DENIED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'provider-invocation:' || config_record.app_id::text || ':' || config_record.tenant_id::text || ':' ||
    config_record.environment || ':' || config_record.principal_id::text || ':' ||
    (envelope ->> 'idempotency_key'),0));
  select intent.* into existing_intent
  from app_data_agent.provider_invocation_intents as intent
  where intent.app_id = config_record.app_id
    and intent.tenant_id = config_record.tenant_id
    and intent.environment = config_record.environment
    and intent.principal_id = config_record.principal_id
    and intent.idempotency_key = envelope ->> 'idempotency_key';
  if found then
    if existing_intent.invocation_id <> (envelope ->> 'invocation_id')::uuid
      or existing_intent.invocation_key_hash <> invocation_key_hash
    then
      raise exception using errcode = '23505', message = 'PROVIDER_INVOCATION_IDEMPOTENCY_CONFLICT';
    end if;
    if existing_intent.admission = 'REJECTED' then
      select outcome.* into strict existing_outcome
      from app_data_agent.provider_invocation_outcomes as outcome
      where outcome.app_id = existing_intent.app_id
        and outcome.tenant_id = existing_intent.tenant_id
        and outcome.environment = existing_intent.environment
        and outcome.intent_id = existing_intent.intent_id
        and outcome.state = 'FAILED'
        and outcome.transition_from = 'INTENT_COMMITTED';
      select usage.* into strict existing_usage
      from app_data_agent.provider_invocation_usage_receipts as usage
      where usage.app_id = existing_outcome.app_id
        and usage.tenant_id = existing_outcome.tenant_id
        and usage.environment = existing_outcome.environment
        and usage.outcome_id = existing_outcome.outcome_id;
      rejection_projection_document := pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-public@1.0.0',
        'invocation_id',existing_intent.invocation_id,'run_id',existing_intent.run_id,
        'provider',existing_intent.provider,'model_profile_id',existing_intent.model_profile_id,
        'model_config_version',existing_intent.model_config_version,
        'profile_version',existing_intent.profile_version,'model_id',existing_intent.model_id,
        'certification_receipt_ref',existing_intent.intent_json #>
          '{invocation_spec,certification,receipt_ref}',
        'attempt_id',existing_outcome.attempt_id,
        'attempt_no',existing_outcome.dispatch_attempt_no,
        'recovery_action',existing_outcome.outcome_json #> '{candidate,recovery_action}',
        'status','FAILED','reason_code',existing_outcome.outcome_json #> '{candidate,reason_code}',
        'dispatch_hash',existing_outcome.dispatch_hash,'response_hash',null,
        'usage_availability',existing_usage.usage_json -> 'availability',
        'usage_source',existing_usage.usage_json -> 'source',
        'input_tokens',null,'output_tokens',null,'total_tokens',null,'tool_calls',null,
        'provider_call_count',0,'retry_after_ms',null,'latency_ms',null,
        'receipt_deep_link','/w/' || existing_intent.workspace_id::text || '/runs/' ||
          existing_intent.run_id::text || '/provider-invocations/' ||
          existing_intent.invocation_id::text,
        'terminal_at',existing_outcome.outcome_json -> 'terminal_at');
      return pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-begin-result@1.0.0',
        'admission','REJECTED','disposition','REPLAYED',
        'rejection_reason',existing_intent.rejection_reason,
        'intent',existing_intent.intent_json,'permit',null,
        'outcome',existing_outcome.outcome_json,'usage',existing_usage.usage_json,
        'projection',rejection_projection_document);
    end if;
    if rejection_reason is not null then
      raise exception using errcode = '55000', message = rejection_reason;
    end if;
    select permit.* into existing_permit
    from app_data_agent.provider_invocation_dispatch_permits as permit
    where permit.app_id = existing_intent.app_id
      and permit.tenant_id = existing_intent.tenant_id
      and permit.environment = existing_intent.environment
      and permit.intent_id = existing_intent.intent_id
      and permit.dispatch_hash = dispatch_hash
      and permit.attempt_id = (lease_authority ->> 'attempt_id')::uuid
      and permit.worker_fence = (lease_authority ->> 'worker_fence')::bigint;
    if found then
      return pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-begin-result@1.0.0',
        'admission','READY','disposition','REPLAYED','intent',existing_intent.intent_json,
        'permit',existing_permit.permit_json);
    end if;
    select outcome.* into existing_outcome
    from app_data_agent.provider_invocation_outcomes as outcome
      where outcome.app_id = existing_intent.app_id
        and outcome.tenant_id = existing_intent.tenant_id
        and outcome.environment = existing_intent.environment
        and outcome.intent_id = existing_intent.intent_id
        and outcome.state in ('COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN')
      order by outcome.transition_revision desc
      limit 1;
    if found then
      select permit.* into strict existing_permit
      from app_data_agent.provider_invocation_dispatch_permits permit
      where permit.app_id = existing_outcome.app_id
        and permit.tenant_id = existing_outcome.tenant_id
        and permit.environment = existing_outcome.environment
        and permit.intent_id = existing_outcome.intent_id
        and permit.dispatch_hash = existing_outcome.dispatch_hash
        and permit.attempt_id = existing_outcome.attempt_id
        and permit.worker_fence = existing_outcome.worker_fence;
      select usage.* into strict existing_usage
      from app_data_agent.provider_invocation_usage_receipts usage
      where usage.app_id = existing_outcome.app_id
        and usage.tenant_id = existing_outcome.tenant_id
        and usage.environment = existing_outcome.environment
        and usage.outcome_id = existing_outcome.outcome_id;
      terminal_response_ref := existing_outcome.outcome_json #>
        '{candidate,response_artifact_ref}';
      terminal_replay_action := case existing_outcome.state
        when 'COMPLETED' then 'RETURN_RECORDED'
        when 'FAILED' then 'NEW_LOGICAL_INVOCATION_REQUIRED'
        when 'THROTTLED' then 'NEW_LOGICAL_INVOCATION_AFTER_RETRY_DELAY'
        when 'OUTCOME_UNKNOWN' then 'RECONCILIATION_REQUIRED'
      end;
      if existing_outcome.state = 'COMPLETED' then
        select artifact.* into strict response_record
        from app_data_agent.artifacts artifact
        where artifact.app_id = existing_outcome.app_id
          and artifact.tenant_id = existing_outcome.tenant_id
          and artifact.environment = existing_outcome.environment
          and artifact.run_id = existing_outcome.run_id
          and artifact.artifact_id = existing_outcome.response_artifact_id
          and artifact.artifact_type = 'ProviderResponseArtifact'
          and artifact.revision = existing_outcome.response_artifact_revision
          and artifact.content_hash = existing_outcome.response_artifact_content_hash
          and artifact.is_active;
        if terminal_response_ref <> pg_catalog.jsonb_build_object(
            'artifact_id',response_record.artifact_id,
            'artifact_type','ProviderResponseArtifact',
            'app_id',response_record.app_id,'tenant_id',response_record.tenant_id,
            'environment',response_record.environment,'run_id',response_record.run_id,
            'revision',response_record.revision,'content_hash',response_record.content_hash)
          or response_record.document_json ->> 'response_hash' <>
            existing_outcome.response_hash
          or response_record.content_hash <>
            app_data_agent.u2_canonical_sha256(response_record.document_json - 'content_hash')
        then
          raise exception using errcode = 'P0001',
            message = 'PROVIDER_TERMINAL_REPLAY_CLOSURE_INVALID';
        end if;
      elsif terminal_response_ref <> 'null'::jsonb then
        raise exception using errcode = 'P0001',
          message = 'PROVIDER_TERMINAL_REPLAY_CLOSURE_INVALID';
      end if;
      terminal_projection_document := pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-public@1.0.0',
        'invocation_id',existing_intent.invocation_id,'run_id',existing_intent.run_id,
        'provider',existing_intent.provider,
        'model_profile_id',existing_intent.model_profile_id,
        'model_config_version',existing_intent.model_config_version,
        'profile_version',existing_intent.profile_version,'model_id',existing_intent.model_id,
        'certification_receipt_ref',pg_catalog.jsonb_build_object(
          'artifact_id',existing_intent.certification_artifact_id,
          'artifact_type','ModelCertificationReceipt','app_id',existing_intent.app_id,
          'tenant_id',existing_intent.tenant_id,'environment',existing_intent.environment,
          'run_id',existing_intent.certification_run_id,
          'revision',existing_intent.certification_revision,
          'content_hash',existing_intent.certification_hash),
        'attempt_id',existing_permit.attempt_id,'attempt_no',existing_permit.attempt_no,
        'recovery_action',existing_outcome.outcome_json #> '{candidate,recovery_action}',
        'status',existing_outcome.state,
        'reason_code',existing_outcome.outcome_json #> '{candidate,reason_code}',
        'dispatch_hash',existing_outcome.dispatch_hash,
        'response_hash',existing_outcome.outcome_json #> '{candidate,response_hash}',
        'usage_availability',existing_usage.usage_json -> 'availability',
        'usage_source',existing_usage.usage_json -> 'source',
        'input_tokens',existing_usage.usage_json -> 'input_tokens',
        'output_tokens',existing_usage.usage_json -> 'output_tokens',
        'total_tokens',existing_usage.usage_json -> 'total_tokens',
        'tool_calls',existing_usage.usage_json -> 'tool_calls',
        'provider_call_count',existing_usage.usage_json -> 'provider_call_count',
        'retry_after_ms',existing_outcome.outcome_json #> '{candidate,retry_after_ms}',
        'latency_ms',existing_outcome.outcome_json -> 'latency_ms',
        'receipt_deep_link','/w/' || existing_intent.workspace_id::text || '/runs/' ||
          existing_intent.run_id::text || '/provider-invocations/' ||
          existing_intent.invocation_id::text,
        'terminal_at',existing_outcome.outcome_json -> 'terminal_at');
      if existing_outcome.outcome_json #>> '{candidate,intent_id}' <>
          existing_intent.intent_id::text
        or existing_outcome.outcome_json #>> '{candidate,invocation_id}' <>
          existing_intent.invocation_id::text
        or existing_outcome.outcome_json #>> '{candidate,run_id}' <> existing_intent.run_id::text
        or existing_outcome.outcome_json #> '{candidate,scope}' <>
          existing_intent.intent_json #> '{invocation_spec,scope}'
        or existing_outcome.outcome_json #>> '{candidate,dispatch_hash}' <>
          existing_permit.dispatch_hash
        or existing_usage.usage_json ->> 'intent_id' <> existing_intent.intent_id::text
        or existing_usage.usage_json ->> 'invocation_id' <> existing_intent.invocation_id::text
        or existing_usage.usage_json ->> 'run_id' <> existing_intent.run_id::text
        or existing_usage.usage_json -> 'scope' <>
          existing_intent.intent_json #> '{invocation_spec,scope}'
        or (existing_outcome.state = 'THROTTLED' and
          (existing_outcome.outcome_json #>> '{candidate,retry_after_ms}')::bigint not between 1 and 86400000)
      then
        raise exception using errcode = 'P0001',
          message = 'PROVIDER_TERMINAL_REPLAY_CLOSURE_INVALID';
      end if;
      return pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-begin-result@1.0.0',
        'admission','TERMINAL_REPLAY','disposition','REPLAYED',
        'replay_action',terminal_replay_action,'intent',existing_intent.intent_json,
        'original_permit',existing_permit.permit_json,
        'response_artifact_ref',terminal_response_ref,
        'outcome',existing_outcome.outcome_json,'usage',existing_usage.usage_json,
        'projection',terminal_projection_document);
    end if;
    if exists (
      select 1 from app_data_agent.provider_invocation_outcomes as outcome
      where outcome.app_id = existing_intent.app_id
        and outcome.tenant_id = existing_intent.tenant_id
        and outcome.environment = existing_intent.environment
        and outcome.intent_id = existing_intent.intent_id
        and outcome.state = 'DISPATCH_MARKED'
    ) and not ('IDEMPOTENT_REQUEST' = any(existing_intent.recovery_capabilities)) then
      raise exception using errcode = '55000',
        message = 'PROVIDER_REDISPATCH_REQUIRES_RECONCILIATION';
    end if;
    intent_id := existing_intent.intent_id;
    intent_document := existing_intent.intent_json;
    result_disposition := 'REPLAYED';
  else
    intent_id := pg_catalog.gen_random_uuid();
    intent_committed_at := pg_catalog.clock_timestamp();
    intent_document := pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-intent@1.0.0',
      'intent_id',intent_id,
      'invocation_spec',invocation_key_draft,
      'invocation_key_hash',invocation_key_hash,
      'state','INTENT_COMMITTED',
      'committed_at',app_data_agent.runtime_iso_timestamp(intent_committed_at));
    intent_document := intent_document || pg_catalog.jsonb_build_object(
      'intent_hash',app_data_agent.u2_canonical_sha256(intent_document));
    result_disposition := 'CREATED';
  end if;
  committed_at := pg_catalog.clock_timestamp();
  permit_id := pg_catalog.gen_random_uuid();
  permit_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-dispatch-permit@1.0.0',
    'permit_id',permit_id,
    'intent_id',intent_id,
    'invocation_id',(envelope ->> 'invocation_id')::uuid,
    'scope',scope_document,
    'run_id',config_record.run_id,
    'dispatch_hash',dispatch_hash,
    'context_receipt_ref',envelope -> 'context_receipt_ref',
    'lease',envelope -> 'lease',
    'attempt_id',(lease_authority ->> 'attempt_id')::uuid,
    'worker_fence',(lease_authority ->> 'worker_fence')::bigint,
    'committed_at',app_data_agent.runtime_iso_timestamp(committed_at));
  permit_document := permit_document || pg_catalog.jsonb_build_object(
    'permit_hash',app_data_agent.u2_canonical_sha256(permit_document));
  if permit_document ->> 'intent_id' <> intent_document ->> 'intent_id'
    or permit_document ->> 'invocation_id' <>
      intent_document #>> '{invocation_spec,invocation_id}'
    or permit_document -> 'scope' <> intent_document #> '{invocation_spec,scope}'
    or permit_document ->> 'run_id' <> intent_document #>> '{invocation_spec,run_id}'
  then
    raise exception using errcode = 'P0001',
      message = 'PROVIDER_BEGIN_RESULT_CLOSURE_INVALID';
  end if;
  if result_disposition = 'CREATED' then
    insert into app_data_agent.provider_invocation_intents (
    app_id,tenant_id,environment,intent_id,invocation_id,logical_call_id,run_id,
    workspace_id,principal_id,idempotency_key,invocation_key_hash,
    config_id,config_revision,config_hash,
    model_profile_id,model_config_version,model_config_hash,profile_version,provider,model_id,
    adapter_version,binding_kind,provider_connection_id,provider_connection_version,
    provider_connection_hash,system_binding_hash,system_deployment_id,system_deployment_revision,
    certification_run_id,certification_artifact_id,certification_artifact_type,
    certification_revision,certification_hash,certification_execution_profile_hash,
    task_artifact_id,task_artifact_type,task_artifact_revision,task_artifact_hash,
    projection_artifact_id,projection_artifact_type,projection_artifact_revision,
    projection_artifact_hash,projection_receipt_hash,
    recovery_capabilities,token_bound_policy_version,trusted_input_token_upper_bound,
    reserved_output_tokens,
    effective_max_context_tokens,effective_max_output_tokens,provider_call_limit,
    admission,rejection_reason,intent_json,intent_hash,committed_at
  ) values (
    config_record.app_id,config_record.tenant_id,config_record.environment,intent_id,
    (envelope ->> 'invocation_id')::uuid,(envelope ->> 'logical_call_id')::uuid,config_record.run_id,
    config_record.tenant_id,config_record.principal_id,envelope ->> 'idempotency_key',invocation_key_hash,
    config_record.config_id,config_record.config_revision,config_record.config_hash,
    config_record.model_profile_id,config_record.model_config_version,model_resource_hash,
    envelope #>> '{model_profile,profile_version}',config_record.provider,config_record.model_id,
    envelope #>> '{model_profile,adapter_version}',envelope #>> '{connection,kind}',
    connection_record.provider_connection_id,connection_record.config_version,connection_hash,
    case when envelope #>> '{connection,kind}' = 'SYSTEM_DEPLOYMENT'
      then expected_deployment_hash else null end,
    deployment_record.deployment_id,
    case when deployment_record.deployment_id is not null then 1 else null end,
    certification_record.run_id,certification_record.artifact_id,'ModelCertificationReceipt',
    certification_record.revision,certification_record.content_hash,
    envelope #>> '{certification,execution_profile_hash}',task_record.artifact_id,task_record.artifact_type,
    task_record.revision,task_record.content_hash,projection_record.artifact_id,
    'AgentDataProjectionReceipt',projection_record.revision,projection_record.content_hash,
    projection_record.document_json ->> 'receipt_hash',recovery_capabilities,
    envelope #>> '{projection,token_bound_policy_version}',
    (envelope #>> '{projection,trusted_input_token_upper_bound}')::bigint,
    (envelope #>> '{projection,reserved_output_tokens}')::bigint,
    (envelope #>> '{projection,effective_context_ceiling_tokens}')::bigint,
    (envelope #>> '{projection,effective_output_ceiling_tokens}')::bigint,1,
    case when rejection_reason is null then 'READY' else 'REJECTED' end,
    rejection_reason,intent_document,intent_document ->> 'intent_hash',intent_committed_at
    );
  end if;
  if rejection_reason is not null then
    rejection_outcome_id := pg_catalog.gen_random_uuid();
    rejection_usage_id := pg_catalog.gen_random_uuid();
    committed_at := pg_catalog.clock_timestamp();
    rejection_outcome_document := pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-outcome@1.0.0',
      'outcome_id',rejection_outcome_id,
      'candidate',pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-outcome-candidate@1.0.0',
        'intent_id',intent_id,'invocation_id',(envelope ->> 'invocation_id')::uuid,
        'scope',scope_document,'run_id',config_record.run_id,'dispatch_hash',dispatch_hash,
        'status','FAILED','reason_code','PROVIDER_INVOCATION_FAILED',
        'response_artifact_ref',null,'response_hash',null,
        'delivery_certainty','NOT_DISPATCHED','transition_from','INTENT_COMMITTED',
        'recovery_action','NONE','provider_call_count',0,'retry_after_ms',null,
        'reconciliation_of',null),
      'dispatch_marked_at',null,
      'terminal_at',app_data_agent.runtime_iso_timestamp(committed_at),
      'latency_ms',null);
    rejection_outcome_document := rejection_outcome_document || pg_catalog.jsonb_build_object(
      'outcome_hash',app_data_agent.u2_canonical_sha256(rejection_outcome_document));
    rejection_usage_document := pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-usage@1.0.0',
      'usage_receipt_id',rejection_usage_id,'outcome_id',rejection_outcome_id,
      'intent_id',intent_id,'invocation_id',(envelope ->> 'invocation_id')::uuid,
      'scope',scope_document,'run_id',config_record.run_id,
      'availability','NOT_APPLICABLE','source','UNAVAILABLE',
      'input_tokens',null,'output_tokens',null,'total_tokens',null,'tool_calls',null,
      'provider_call_count',0,'capacity_status','NOT_APPLICABLE',
      'unavailable_reason','PROVIDER_NOT_DISPATCHED',
      'observed_at',app_data_agent.runtime_iso_timestamp(committed_at));
    rejection_usage_document := rejection_usage_document || pg_catalog.jsonb_build_object(
      'usage_hash',app_data_agent.u2_canonical_sha256(rejection_usage_document));
    insert into app_data_agent.provider_invocation_outcomes (
      app_id,tenant_id,environment,outcome_id,intent_id,invocation_id,run_id,dispatch_hash,
      transition_revision,parent_transition_revision,parent_outcome_hash,state,actor_kind,
      transition_from,recovery_action,dispatch_attempt_no,attempt_id,outbox_id,command_id,
      worker_id,lease_token,worker_fence,dispatch_marked,provider_call_may_have_started,
      reason_code,provider_call_count,retry_after_ms,delivery_certainty,started_at,terminal_at,
      latency_ms,reconciliation_of,outcome_json,outcome_hash,committed_at
    ) values (
      config_record.app_id,config_record.tenant_id,config_record.environment,
      rejection_outcome_id,intent_id,(envelope ->> 'invocation_id')::uuid,config_record.run_id,
      dispatch_hash,1,null,null,'FAILED','WORKER','INTENT_COMMITTED','NONE',
      (lease_authority ->> 'attempt_no')::bigint,(lease_authority ->> 'attempt_id')::uuid,
      (lease_authority ->> 'outbox_id')::uuid,(lease_authority ->> 'command_id')::uuid,
      lease_authority ->> 'worker_id',(lease_authority ->> 'lease_token')::bigint,
      (lease_authority ->> 'worker_fence')::bigint,false,false,
      'PROVIDER_INVOCATION_FAILED',0,null,'NOT_DISPATCHED',null,committed_at,null,null,
      rejection_outcome_document,rejection_outcome_document ->> 'outcome_hash',committed_at
    );
    insert into app_data_agent.provider_invocation_usage_receipts (
      app_id,tenant_id,environment,usage_receipt_id,intent_id,invocation_id,outcome_id,
      outcome_transition_revision,outcome_hash,availability,token_source,input_tokens,output_tokens,
      total_tokens,tool_calls,provider_call_count,capacity_status,unavailable_reason,
      usage_json,usage_hash,observed_at,committed_at
    ) values (
      config_record.app_id,config_record.tenant_id,config_record.environment,rejection_usage_id,
      intent_id,(envelope ->> 'invocation_id')::uuid,rejection_outcome_id,1,
      rejection_outcome_document ->> 'outcome_hash','NOT_APPLICABLE','UNAVAILABLE',
      null,null,null,null,0,'NOT_APPLICABLE','PROVIDER_NOT_DISPATCHED',
      rejection_usage_document,rejection_usage_document ->> 'usage_hash',committed_at,committed_at
    );
    rejection_projection_document := pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-public@1.0.0',
      'invocation_id',(envelope ->> 'invocation_id')::uuid,'run_id',config_record.run_id,
      'provider',config_record.provider,'model_profile_id',config_record.model_profile_id,
      'model_config_version',config_record.model_config_version,
      'profile_version',envelope #>> '{model_profile,profile_version}',
      'model_id',config_record.model_id,
      'certification_receipt_ref',envelope #> '{certification,receipt_ref}',
      'attempt_id',(lease_authority ->> 'attempt_id')::uuid,
      'attempt_no',(lease_authority ->> 'attempt_no')::bigint,
      'recovery_action','NONE','status','FAILED','reason_code','PROVIDER_INVOCATION_FAILED',
      'dispatch_hash',dispatch_hash,'response_hash',null,
      'usage_availability','NOT_APPLICABLE','usage_source','UNAVAILABLE',
      'input_tokens',null,'output_tokens',null,'total_tokens',null,'tool_calls',null,
      'provider_call_count',0,'retry_after_ms',null,'latency_ms',null,
      'receipt_deep_link','/w/' || config_record.tenant_id::text || '/runs/' ||
        config_record.run_id::text || '/provider-invocations/' ||
        (envelope ->> 'invocation_id'),
      'terminal_at',rejection_outcome_document -> 'terminal_at');
    return pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-begin-result@1.0.0',
      'admission','REJECTED','disposition','CREATED','rejection_reason',rejection_reason,
      'intent',intent_document,'permit',null,'outcome',rejection_outcome_document,
      'usage',rejection_usage_document,'projection',rejection_projection_document);
  end if;
  insert into app_data_agent.provider_invocation_dispatch_permits (
    app_id,tenant_id,environment,permit_id,intent_id,invocation_id,run_id,dispatch_hash,
    context_receipt_id,context_receipt_hash,attempt_id,outbox_id,command_id,attempt_no,
    worker_id,lease_token,worker_fence,envelope_json,permit_json,permit_hash,committed_at
  ) values (
    config_record.app_id,config_record.tenant_id,config_record.environment,permit_id,intent_id,
    (envelope ->> 'invocation_id')::uuid,config_record.run_id,dispatch_hash,
    context_record.context_receipt_id,context_record.receipt_hash,
    (lease_authority ->> 'attempt_id')::uuid,(lease_authority ->> 'outbox_id')::uuid,
    (lease_authority ->> 'command_id')::uuid,(lease_authority ->> 'attempt_no')::bigint,
    lease_authority ->> 'worker_id',(lease_authority ->> 'lease_token')::bigint,
    (lease_authority ->> 'worker_fence')::bigint,envelope,permit_document,
    permit_document ->> 'permit_hash',committed_at
  );
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-begin-result@1.0.0',
    'admission','READY','disposition',result_disposition,
    'intent',intent_document,'permit',permit_document);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'PROVIDER_DISPATCH_ENVELOPE_INVALID';
end
$function$;
create function app_data_agent.commit_provider_task_artifact(
  requested_lease jsonb,
  requested_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  lease_authority jsonb;
  task_authority record;
  artifact_record app_data_agent.artifacts%rowtype;
  authoritative_document jsonb;
  content_hash text;
  committed_at timestamptz;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','scope','run_id','conversation_binding'
    ]::text[])
    or requested_command ->> 'schema_version' <> 'provider-task-artifact-commit@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'scope',array[
        'app_id','tenant_id','environment','workspace_id','principal_id'
      ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'conversation_binding',array[
        'conversation_id','resource_version'
      ]::text[])
  then
    raise exception using errcode = '22023', message = 'PROVIDER_TASK_ARTIFACT_COMMAND_INVALID';
  end if;
  lease_authority := app_data_agent.assert_provider_active_worker_lease(requested_lease);
  if requested_command -> 'scope' <> pg_catalog.jsonb_build_object(
      'app_id',lease_authority -> 'app_id','tenant_id',lease_authority -> 'tenant_id',
      'environment',lease_authority -> 'environment','workspace_id',lease_authority -> 'workspace_id',
      'principal_id',lease_authority -> 'principal_id')
    or requested_command ->> 'run_id' <> lease_authority ->> 'run_id'
  then
    raise exception using errcode = '40001', message = 'PROVIDER_TASK_ARTIFACT_LEASE_MISMATCH';
  end if;
  select binding.app_id,binding.tenant_id,binding.environment,binding.run_id,
    binding.conversation_id,binding.principal_id,message.message_id,message.content,
    message.role,message.message_type,event.event_id,event.command_id,
    conversation.resource_version
  into task_authority
  from app_data_agent.workspace_run_bindings binding
  join app_data_agent.run_events event
    on event.app_id = binding.app_id and event.tenant_id = binding.tenant_id
   and event.environment = binding.environment and event.run_id = binding.run_id
   and event.command_id = (lease_authority ->> 'command_id')::uuid
   and event.event_type = 'run.accepted'
  join app_data_agent.qa_conversations conversation
    on conversation.app_id = binding.app_id and conversation.tenant_id = binding.tenant_id
   and conversation.environment = binding.environment
   and conversation.conversation_id = binding.conversation_id
   and conversation.owner_principal_id = binding.principal_id
  join app_data_agent.qa_messages message
    on message.app_id = binding.app_id and message.tenant_id = binding.tenant_id
   and message.environment = binding.environment
   and message.conversation_id = binding.conversation_id
   and message.message_id = event.event_id
   and message.owner_principal_id = binding.principal_id
   and message.run_id = binding.run_id and message.role = 'user'
  where binding.app_id = (lease_authority ->> 'app_id')::uuid
    and binding.tenant_id = (lease_authority ->> 'tenant_id')::uuid
    and binding.environment = lease_authority ->> 'environment'
    and binding.run_id = (lease_authority ->> 'run_id')::uuid
    and binding.principal_id = (lease_authority ->> 'principal_id')::uuid
    and binding.conversation_id =
      (requested_command #>> '{conversation_binding,conversation_id}')::uuid
    and conversation.resource_version =
      (requested_command #>> '{conversation_binding,resource_version}')::bigint
  for share of binding,message,event,conversation;
  if not found
  then
    raise exception using errcode = '55000', message = 'PROVIDER_TASK_MESSAGE_NOT_FOUND_OR_FORBIDDEN';
  end if;
  authoritative_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-task-artifact@1.0.0','message_id',task_authority.message_id,
    'accepted_event_id',task_authority.event_id,
    'conversation_id',task_authority.conversation_id,
    'conversation_resource_version',task_authority.resource_version,
    'command_id',task_authority.command_id,'run_id',task_authority.run_id,
    'message_role',task_authority.role,'message_type',task_authority.message_type,
    'question',task_authority.content);
  content_hash := app_data_agent.u2_canonical_sha256(authoritative_document);
  authoritative_document := authoritative_document ||
    pg_catalog.jsonb_build_object('content_hash',content_hash);
  if task_authority.message_id <> task_authority.event_id
    or task_authority.role <> 'user'
    or task_authority.message_type <> 'text'
    or app_data_agent.contains_potential_plaintext_secret(
      authoritative_document - 'question')
  then
    raise exception using errcode = '22023', message = 'PROVIDER_TASK_ARTIFACT_DOCUMENT_INVALID';
  end if;
  select artifact.* into artifact_record
  from app_data_agent.artifacts artifact
  where artifact.app_id = task_authority.app_id
    and artifact.tenant_id = task_authority.tenant_id
    and artifact.environment = task_authority.environment
    and artifact.run_id = task_authority.run_id
    and artifact.artifact_id = task_authority.message_id
    and artifact.artifact_type = 'ProviderTaskArtifact'
    and artifact.revision = 1
  for share;
  if found then
    if artifact_record.content_hash <> content_hash
      or artifact_record.document_json <> authoritative_document
    then
      raise exception using errcode = '23505', message = 'PROVIDER_TASK_ARTIFACT_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'schema_version','provider-task-artifact-commit-result@1.0.0',
      'disposition','REPLAYED','reference',pg_catalog.jsonb_build_object(
        'artifact_id',artifact_record.artifact_id,'artifact_type','ProviderTaskArtifact',
        'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
        'environment',artifact_record.environment,'run_id',artifact_record.run_id,
        'revision',artifact_record.revision,'content_hash',artifact_record.content_hash),
      'document',artifact_record.document_json,
      'committed_at',app_data_agent.runtime_iso_timestamp(artifact_record.created_at));
  end if;
  committed_at := pg_catalog.clock_timestamp();
  insert into app_data_agent.artifacts (
    app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
    document_json,worker_fence,is_active,parent_revision,parent_content_hash,created_at
  ) values (
    task_authority.app_id,task_authority.tenant_id,task_authority.environment,task_authority.run_id,
    task_authority.message_id,'ProviderTaskArtifact',1,content_hash,authoritative_document,
    (lease_authority ->> 'worker_fence')::bigint,true,null,null,committed_at
  ) returning * into artifact_record;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-task-artifact-commit-result@1.0.0',
    'disposition','CREATED','reference',pg_catalog.jsonb_build_object(
      'artifact_id',artifact_record.artifact_id,'artifact_type','ProviderTaskArtifact',
      'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
      'environment',artifact_record.environment,'run_id',artifact_record.run_id,
      'revision',artifact_record.revision,'content_hash',artifact_record.content_hash),
    'document',artifact_record.document_json,
    'committed_at',app_data_agent.runtime_iso_timestamp(artifact_record.created_at));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023', message = 'PROVIDER_TASK_ARTIFACT_COMMAND_INVALID';
end
$function$;

create function app_data_agent.load_provider_task_artifact(requested_command jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  authority record;
  artifact_record app_data_agent.artifacts%rowtype;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','scope','run_id','reference'
    ]::text[])
    or requested_command ->> 'schema_version' <> 'provider-task-artifact-load@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'scope',array[
        'app_id','tenant_id','environment','workspace_id','principal_id'
      ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'reference',array[
        'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
      ]::text[])
    or requested_command #>> '{reference,artifact_type}' <> 'ProviderTaskArtifact'
  then
    raise exception using errcode = '22023', message = 'PROVIDER_TASK_ARTIFACT_LOAD_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(false);
  if requested_command -> 'scope' <> pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment,'workspace_id',authority.tenant_id,
      'principal_id',authority.principal_id)
  then
    raise exception using errcode = '42501', message = 'PROVIDER_TASK_ARTIFACT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  select artifact.* into artifact_record from app_data_agent.artifacts artifact
  where artifact.app_id = authority.app_id and artifact.tenant_id = authority.tenant_id
    and artifact.environment = authority.environment
    and artifact.run_id = (requested_command ->> 'run_id')::uuid
    and artifact.artifact_id = (requested_command #>> '{reference,artifact_id}')::uuid
    and artifact.artifact_type = 'ProviderTaskArtifact'
    and artifact.revision = (requested_command #>> '{reference,revision}')::integer
    and artifact.content_hash = requested_command #>> '{reference,content_hash}'
    and artifact.is_active;
  if not found
    or requested_command -> 'reference' <> pg_catalog.jsonb_build_object(
      'artifact_id',artifact_record.artifact_id,'artifact_type','ProviderTaskArtifact',
      'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
      'environment',artifact_record.environment,'run_id',artifact_record.run_id,
      'revision',artifact_record.revision,'content_hash',artifact_record.content_hash)
    or not app_data_agent.provider_json_object_has_exact_keys(
      artifact_record.document_json,array[
        'schema_version','message_id','accepted_event_id','conversation_id',
        'conversation_resource_version','command_id','run_id','message_role',
        'message_type','question','content_hash'
      ]::text[])
    or artifact_record.document_json ->> 'schema_version' <> 'provider-task-artifact@1.0.0'
    or artifact_record.document_json ->> 'message_id' <> artifact_record.artifact_id::text
    or artifact_record.document_json ->> 'accepted_event_id' <>
      artifact_record.document_json ->> 'message_id'
    or artifact_record.document_json ->> 'run_id' <> artifact_record.run_id::text
    or artifact_record.document_json ->> 'message_role' <> 'user'
    or artifact_record.document_json ->> 'message_type' <> 'text'
    or pg_catalog.length(pg_catalog.btrim(
      artifact_record.document_json ->> 'question')) not between 1 and 200000
    or artifact_record.content_hash <>
      app_data_agent.u2_canonical_sha256(artifact_record.document_json - 'content_hash')
  then
    raise exception using errcode = '42501', message = 'PROVIDER_TASK_ARTIFACT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-task-artifact-load-result@1.0.0',
    'reference',requested_command -> 'reference','document',artifact_record.document_json);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023', message = 'PROVIDER_TASK_ARTIFACT_LOAD_INVALID';
end
$function$;

create function app_data_agent.commit_provider_response_artifact(
  requested_lease jsonb,
  requested_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  lease_authority jsonb;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  artifact_record app_data_agent.artifacts%rowtype;
  document jsonb;
  artifact_id uuid;
  committed_at timestamptz;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','scope','run_id','invocation_id','intent_id','dispatch_hash',
      'attempt_id','worker_fence','document'
    ]::text[])
    or requested_command ->> 'schema_version' <> 'provider-response-artifact-commit@1.0.0'
  then
    raise exception using errcode = '22023', message = 'PROVIDER_RESPONSE_ARTIFACT_COMMAND_INVALID';
  end if;
  document := requested_command -> 'document';
  if not app_data_agent.provider_json_object_has_exact_keys(document,array[
      'schema_version','invocation_id','response_hash','output_text','tool_calls','content_hash'
    ]::text[])
    or document ->> 'schema_version' <> 'provider-response-artifact@1.0.0'
    or document ->> 'invocation_id' <> requested_command ->> 'invocation_id'
    or document ->> 'response_hash' <> app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'output_text',document -> 'output_text','tool_calls',document -> 'tool_calls'))
    or document ->> 'content_hash' <> app_data_agent.u2_canonical_sha256(document - 'content_hash')
    or pg_catalog.jsonb_typeof(document -> 'output_text') <> 'string'
    or pg_catalog.jsonb_typeof(document -> 'tool_calls') <> 'array'
    or pg_catalog.jsonb_array_length(document -> 'tool_calls') > 256
    or app_data_agent.contains_potential_plaintext_secret(document)
  then
    raise exception using errcode = '22023', message = 'PROVIDER_RESPONSE_ARTIFACT_DOCUMENT_INVALID';
  end if;
  lease_authority := app_data_agent.assert_provider_active_worker_lease(requested_lease);
  select intent.* into intent_record
  from app_data_agent.provider_invocation_intents as intent
  where intent.app_id = (lease_authority ->> 'app_id')::uuid
    and intent.tenant_id = (lease_authority ->> 'tenant_id')::uuid
    and intent.environment = lease_authority ->> 'environment'
    and intent.intent_id = (requested_command ->> 'intent_id')::uuid
    and intent.invocation_id = (requested_command ->> 'invocation_id')::uuid
    and intent.run_id = (requested_command ->> 'run_id')::uuid
    and intent.admission = 'READY'
  for update;
  if not found or requested_command -> 'scope' <> intent_record.intent_json #> '{invocation_spec,scope}' then
    raise exception using errcode = '55000', message = 'PROVIDER_INVOCATION_INTENT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  select permit.* into permit_record
  from app_data_agent.provider_invocation_dispatch_permits as permit
  where permit.app_id = intent_record.app_id and permit.tenant_id = intent_record.tenant_id
    and permit.environment = intent_record.environment and permit.intent_id = intent_record.intent_id
    and permit.dispatch_hash = requested_command ->> 'dispatch_hash'
    and permit.attempt_id = (requested_command ->> 'attempt_id')::uuid
    and permit.attempt_id = (lease_authority ->> 'attempt_id')::uuid
    and permit.worker_fence = (requested_command ->> 'worker_fence')::bigint
    and permit.worker_fence = (lease_authority ->> 'worker_fence')::bigint;
  if not found or not exists (
      select 1 from app_data_agent.provider_invocation_outcomes marker
      where marker.app_id = intent_record.app_id and marker.tenant_id = intent_record.tenant_id
        and marker.environment = intent_record.environment and marker.intent_id = intent_record.intent_id
        and marker.dispatch_hash = permit_record.dispatch_hash and marker.attempt_id = permit_record.attempt_id
        and marker.worker_fence = permit_record.worker_fence and marker.state = 'DISPATCH_MARKED'
    )
  then
    raise exception using errcode = '55000', message = 'PROVIDER_DISPATCH_MARK_NOT_COMMITTED';
  end if;
  if exists (select 1 from app_data_agent.provider_invocation_outcomes outcome
    where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
      and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
      and outcome.state in ('COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN')) then
    raise exception using errcode = '55000', message = 'PROVIDER_INVOCATION_ALREADY_TERMINAL';
  end if;

  select artifact.* into artifact_record
  from app_data_agent.artifacts artifact
  where artifact.app_id = intent_record.app_id and artifact.tenant_id = intent_record.tenant_id
    and artifact.environment = intent_record.environment and artifact.run_id = intent_record.run_id
    and artifact.artifact_type = 'ProviderResponseArtifact' and artifact.revision = 1
    and artifact.document_json ->> 'invocation_id' = intent_record.invocation_id::text
  for share;
  if found then
    if artifact_record.content_hash <> document ->> 'content_hash'
      or artifact_record.document_json <> document then
      raise exception using errcode = '23505', message = 'PROVIDER_RESPONSE_ARTIFACT_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'schema_version','provider-response-artifact-commit-result@1.0.0',
      'disposition','REPLAYED','reference',pg_catalog.jsonb_build_object(
        'artifact_id',artifact_record.artifact_id,'artifact_type',artifact_record.artifact_type,
        'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
        'environment',artifact_record.environment,'run_id',artifact_record.run_id,
        'revision',artifact_record.revision,'content_hash',artifact_record.content_hash),
      'document_hash',artifact_record.content_hash,
      'committed_at',app_data_agent.runtime_iso_timestamp(artifact_record.created_at));
  end if;
  artifact_id := pg_catalog.gen_random_uuid();
  committed_at := pg_catalog.clock_timestamp();
  insert into app_data_agent.artifacts (
    app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,
    content_hash,document_json,worker_fence,is_active,parent_revision,parent_content_hash,created_at
  ) values (
    intent_record.app_id,intent_record.tenant_id,intent_record.environment,intent_record.run_id,
    artifact_id,'ProviderResponseArtifact',1,document ->> 'content_hash',document,
    permit_record.worker_fence,true,null,null,committed_at
  );
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-response-artifact-commit-result@1.0.0',
    'disposition','CREATED','reference',pg_catalog.jsonb_build_object(
      'artifact_id',artifact_id,'artifact_type','ProviderResponseArtifact',
      'app_id',intent_record.app_id,'tenant_id',intent_record.tenant_id,
      'environment',intent_record.environment,'run_id',intent_record.run_id,
      'revision',1,'content_hash',document ->> 'content_hash'),
    'document_hash',document ->> 'content_hash',
    'committed_at',app_data_agent.runtime_iso_timestamp(committed_at));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023', message = 'PROVIDER_RESPONSE_ARTIFACT_COMMAND_INVALID';
end
$function$;

create function app_data_agent.load_provider_invocation(requested_command jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  authority record;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  response_marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  terminal_record app_data_agent.provider_invocation_outcomes%rowtype;
  usage_record app_data_agent.provider_invocation_usage_receipts%rowtype;
  projection_document jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','scope','run_id','invocation_id','permit_id','permit_hash',
      'dispatch_hash','attempt_id','worker_fence'
    ]::text[])
    or requested_command ->> 'schema_version' <> 'provider-invocation-load@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'scope',array[
        'app_id','tenant_id','environment','workspace_id','principal_id'
      ]::text[])
  then raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  if requested_command -> 'scope' <> pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment,
      'workspace_id',authority.tenant_id,'principal_id',authority.principal_id) then
    raise exception using errcode = '42501', message = 'PROVIDER_INVOCATION_NOT_FOUND_OR_FORBIDDEN';
  end if;
  select intent.* into intent_record from app_data_agent.provider_invocation_intents intent
  where intent.app_id = authority.app_id and intent.tenant_id = authority.tenant_id
    and intent.environment = authority.environment and intent.principal_id = authority.principal_id
    and intent.run_id = (requested_command ->> 'run_id')::uuid
    and intent.invocation_id = (requested_command ->> 'invocation_id')::uuid;
  if not found then raise exception using errcode = '42501', message = 'PROVIDER_INVOCATION_NOT_FOUND_OR_FORBIDDEN'; end if;
  select permit.* into permit_record
  from app_data_agent.provider_invocation_dispatch_permits permit
  where permit.app_id = intent_record.app_id
    and permit.tenant_id = intent_record.tenant_id
    and permit.environment = intent_record.environment
    and permit.intent_id = intent_record.intent_id
    and permit.invocation_id = intent_record.invocation_id
    and permit.run_id = intent_record.run_id
    and permit.permit_id = (requested_command ->> 'permit_id')::uuid
    and permit.permit_hash = requested_command ->> 'permit_hash'
    and permit.dispatch_hash = requested_command ->> 'dispatch_hash'
    and permit.attempt_id = (requested_command ->> 'attempt_id')::uuid
    and permit.worker_fence = (requested_command ->> 'worker_fence')::bigint;
  if not found
    or permit_record.permit_json ->> 'permit_id' <> permit_record.permit_id::text
    or permit_record.permit_json ->> 'intent_id' <> intent_record.intent_id::text
    or permit_record.permit_json ->> 'invocation_id' <> intent_record.invocation_id::text
    or permit_record.permit_json ->> 'run_id' <> intent_record.run_id::text
    or permit_record.permit_json -> 'scope' <> intent_record.intent_json #> '{invocation_spec,scope}'
    or permit_record.permit_json ->> 'dispatch_hash' <> permit_record.dispatch_hash
    or permit_record.permit_json ->> 'attempt_id' <> permit_record.attempt_id::text
    or permit_record.permit_json ->> 'worker_fence' <> permit_record.worker_fence::text
    or permit_record.permit_json ->> 'permit_hash' <> permit_record.permit_hash
    or permit_record.permit_hash <>
      app_data_agent.u2_canonical_sha256(permit_record.permit_json - 'permit_hash')
  then
    raise exception using errcode = '42501', message = 'PROVIDER_DISPATCH_PERMIT_NOT_COMMITTED';
  end if;
  select outcome.* into marker_record from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
    and outcome.dispatch_hash = permit_record.dispatch_hash
    and outcome.attempt_id = permit_record.attempt_id
    and outcome.worker_fence = permit_record.worker_fence
    and outcome.state = 'DISPATCH_MARKED';
  select outcome.* into response_marker_record
  from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
    and outcome.dispatch_hash = permit_record.dispatch_hash
    and outcome.attempt_id = permit_record.attempt_id
    and outcome.worker_fence = permit_record.worker_fence
    and outcome.state = 'RESPONSE_OBSERVED';
  select outcome.* into terminal_record from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
    and outcome.dispatch_hash = permit_record.dispatch_hash
    and outcome.attempt_id = permit_record.attempt_id
    and outcome.worker_fence = permit_record.worker_fence
    and outcome.state in ('COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN')
  order by outcome.transition_revision desc limit 1;
  if marker_record.outcome_id is null
    and response_marker_record.outcome_id is null
    and terminal_record.outcome_id is null
  then
    return 'null'::jsonb;
  end if;
  if terminal_record.outcome_id is not null then
    select usage.* into strict usage_record from app_data_agent.provider_invocation_usage_receipts usage
    where usage.app_id = terminal_record.app_id and usage.tenant_id = terminal_record.tenant_id
      and usage.environment = terminal_record.environment and usage.outcome_id = terminal_record.outcome_id;
    if (terminal_record.provider_call_count = 1) <> (marker_record.outcome_id is not null) then
      raise exception using errcode = 'P0001', message = 'PROVIDER_LOAD_RESULT_CLOSURE_INVALID';
    end if;
  end if;
  projection_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-public@1.0.0','invocation_id',intent_record.invocation_id,
    'run_id',intent_record.run_id,'provider',intent_record.provider,
    'model_profile_id',intent_record.model_profile_id,'model_config_version',intent_record.model_config_version,
    'profile_version',intent_record.profile_version,'model_id',intent_record.model_id,
    'certification_receipt_ref',pg_catalog.jsonb_build_object(
      'artifact_id',intent_record.certification_artifact_id,'artifact_type','ModelCertificationReceipt',
      'app_id',intent_record.app_id,'tenant_id',intent_record.tenant_id,
      'environment',intent_record.environment,'run_id',intent_record.certification_run_id,
      'revision',intent_record.certification_revision,'content_hash',intent_record.certification_hash),
    'attempt_id',permit_record.attempt_id,
    'attempt_no',permit_record.attempt_no,
    'recovery_action',case when terminal_record.outcome_id is null then null
      else terminal_record.outcome_json #> '{candidate,recovery_action}' end,
    'status',case when terminal_record.outcome_id is null then 'STARTED'
      else terminal_record.outcome_json #>> '{candidate,status}' end,
    'reason_code',case when terminal_record.outcome_id is null then null
      else terminal_record.outcome_json #> '{candidate,reason_code}' end,
    'dispatch_hash',permit_record.dispatch_hash,
    'response_hash',case when terminal_record.outcome_id is null then null
      else terminal_record.outcome_json #> '{candidate,response_hash}' end,
    'usage_availability',case when usage_record.usage_receipt_id is null then null
      else usage_record.usage_json -> 'availability' end,
    'usage_source',case when usage_record.usage_receipt_id is null then null
      else usage_record.usage_json -> 'source' end,
    'input_tokens',usage_record.usage_json -> 'input_tokens',
    'output_tokens',usage_record.usage_json -> 'output_tokens',
    'total_tokens',usage_record.usage_json -> 'total_tokens',
    'tool_calls',usage_record.usage_json -> 'tool_calls',
    'provider_call_count',case when terminal_record.outcome_id is null then 1
      else (usage_record.usage_json ->> 'provider_call_count')::integer end,
    'retry_after_ms',terminal_record.outcome_json #> '{candidate,retry_after_ms}',
    'latency_ms',terminal_record.outcome_json -> 'latency_ms',
    'receipt_deep_link','/w/' || intent_record.workspace_id::text || '/runs/' ||
      intent_record.run_id::text || '/provider-invocations/' || intent_record.invocation_id::text,
    'terminal_at',terminal_record.outcome_json -> 'terminal_at');
  if intent_record.intent_json ->> 'intent_id' <> intent_record.intent_id::text
    or intent_record.intent_json #>> '{invocation_spec,invocation_id}' <>
      intent_record.invocation_id::text
    or intent_record.intent_json #>> '{invocation_spec,run_id}' <> intent_record.run_id::text
    or intent_record.intent_json #> '{invocation_spec,scope}' <> pg_catalog.jsonb_build_object(
      'app_id',intent_record.app_id,'tenant_id',intent_record.tenant_id,
      'environment',intent_record.environment,'workspace_id',intent_record.workspace_id,
      'principal_id',intent_record.principal_id)
    or intent_record.intent_json ->> 'intent_hash' <>
      app_data_agent.u2_canonical_sha256(intent_record.intent_json - 'intent_hash')
    or permit_record.intent_id <> intent_record.intent_id
    or permit_record.invocation_id <> intent_record.invocation_id
    or permit_record.run_id <> intent_record.run_id
    or permit_record.permit_json ->> 'permit_hash' <>
      app_data_agent.u2_canonical_sha256(permit_record.permit_json - 'permit_hash')
    or projection_document ->> 'invocation_id' <> intent_record.invocation_id::text
    or projection_document ->> 'run_id' <> intent_record.run_id::text
    or projection_document ->> 'provider' <> intent_record.provider
    or projection_document ->> 'model_profile_id' <> intent_record.model_profile_id::text
    or projection_document ->> 'model_config_version' <> intent_record.model_config_version::text
    or projection_document ->> 'profile_version' <> intent_record.profile_version
    or projection_document ->> 'model_id' <> intent_record.model_id
    or projection_document ->> 'attempt_id' <> permit_record.attempt_id::text
    or projection_document ->> 'attempt_no' <> permit_record.attempt_no::text
    or projection_document ->> 'dispatch_hash' <> permit_record.dispatch_hash
    or (marker_record.outcome_id is not null and (
      marker_record.intent_id <> intent_record.intent_id
      or marker_record.invocation_id <> intent_record.invocation_id
      or marker_record.run_id <> intent_record.run_id
      or marker_record.dispatch_hash <> permit_record.dispatch_hash
      or marker_record.outcome_json ->> 'marker_hash' <>
        app_data_agent.u2_canonical_sha256(marker_record.outcome_json - 'marker_hash')))
    or (response_marker_record.outcome_id is not null and (
      marker_record.outcome_id is null
      or not app_data_agent.provider_json_object_has_exact_keys(
        response_marker_record.outcome_json,array[
          'schema_version','marker_id','intent_id','invocation_id','scope','run_id',
          'dispatch_hash','attempt_id','worker_fence','state','observation_kind',
          'response_hash','delivery_certainty','response_observed_at','marker_hash'
        ]::text[])
      or response_marker_record.intent_id <> intent_record.intent_id
      or response_marker_record.invocation_id <> intent_record.invocation_id
      or response_marker_record.run_id <> intent_record.run_id
      or response_marker_record.dispatch_hash <> permit_record.dispatch_hash
      or response_marker_record.outcome_json ->> 'schema_version' <>
        'provider-invocation-response-observed-marker@1.0.0'
      or response_marker_record.outcome_json ->> 'intent_id' <> intent_record.intent_id::text
      or response_marker_record.outcome_json ->> 'invocation_id' <> intent_record.invocation_id::text
      or response_marker_record.outcome_json -> 'scope' <>
        intent_record.intent_json #> '{invocation_spec,scope}'
      or response_marker_record.outcome_json ->> 'run_id' <> intent_record.run_id::text
      or response_marker_record.outcome_json ->> 'dispatch_hash' <> permit_record.dispatch_hash
      or response_marker_record.outcome_json ->> 'attempt_id' <> permit_record.attempt_id::text
      or response_marker_record.outcome_json ->> 'worker_fence' <> permit_record.worker_fence::text
      or response_marker_record.outcome_json ->> 'state' <> 'RESPONSE_OBSERVED'
      or response_marker_record.parent_outcome_hash <> marker_record.outcome_hash
      or response_marker_record.outcome_json ->> 'marker_hash' <>
        app_data_agent.u2_canonical_sha256(response_marker_record.outcome_json - 'marker_hash')))
    or (terminal_record.outcome_id is not null and (
      terminal_record.intent_id <> intent_record.intent_id
      or terminal_record.invocation_id <> intent_record.invocation_id
      or terminal_record.run_id <> intent_record.run_id
      or terminal_record.dispatch_hash <> permit_record.dispatch_hash
      or terminal_record.outcome_json #>> '{candidate,intent_id}' <> intent_record.intent_id::text
      or terminal_record.outcome_json #>> '{candidate,invocation_id}' <>
        intent_record.invocation_id::text
      or terminal_record.outcome_json #>> '{candidate,run_id}' <> intent_record.run_id::text
      or terminal_record.outcome_json #> '{candidate,scope}' <>
        intent_record.intent_json #> '{invocation_spec,scope}'
      or terminal_record.outcome_json #>> '{candidate,dispatch_hash}' <> permit_record.dispatch_hash
      or (terminal_record.transition_from = 'RESPONSE_OBSERVED' and (
        response_marker_record.outcome_id is null
        or terminal_record.parent_outcome_hash <> response_marker_record.outcome_hash
        or terminal_record.state <> response_marker_record.observation_kind
        or terminal_record.delivery_certainty <> response_marker_record.delivery_certainty
        or terminal_record.outcome_json #> '{candidate,response_hash}' <>
          response_marker_record.outcome_json -> 'response_hash'))
      or terminal_record.outcome_json ->> 'outcome_hash' <>
        app_data_agent.u2_canonical_sha256(terminal_record.outcome_json - 'outcome_hash')))
    or (usage_record.usage_receipt_id is not null and (
      usage_record.intent_id <> intent_record.intent_id
      or usage_record.invocation_id <> intent_record.invocation_id
      or usage_record.outcome_id <> terminal_record.outcome_id
      or usage_record.usage_json ->> 'intent_id' <> intent_record.intent_id::text
      or usage_record.usage_json ->> 'invocation_id' <> intent_record.invocation_id::text
      or usage_record.usage_json ->> 'run_id' <> intent_record.run_id::text
      or usage_record.usage_json -> 'scope' <> intent_record.intent_json #> '{invocation_spec,scope}'
      or usage_record.usage_json ->> 'usage_hash' <>
        app_data_agent.u2_canonical_sha256(usage_record.usage_json - 'usage_hash')))
  then
    raise exception using errcode = 'P0001', message = 'PROVIDER_LOAD_RESULT_CLOSURE_INVALID';
  end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-load-result@1.0.0','intent',intent_record.intent_json,
    'permit',permit_record.permit_json,
    'marker',case when marker_record.outcome_id is null then null else marker_record.outcome_json end,
    'response_observed',case when response_marker_record.outcome_id is null
      then null else response_marker_record.outcome_json end,
    'outcome',case when terminal_record.outcome_id is null then null else terminal_record.outcome_json end,
    'usage',case when usage_record.usage_receipt_id is null then null else usage_record.usage_json end,
    'projection',projection_document);
exception when invalid_text_representation then
  raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_LOAD_INVALID';
end
$function$;

create function app_data_agent.commit_provider_invocation_worker_transition_internal(
  requested_lease jsonb,
  requested_command jsonb,
  requested_usage jsonb,
  requested_mode text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  lease_authority jsonb;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  response_marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  existing_outcome app_data_agent.provider_invocation_outcomes%rowtype;
  existing_usage app_data_agent.provider_invocation_usage_receipts%rowtype;
  artifact_record app_data_agent.artifacts%rowtype;
  candidate jsonb;
  usage_candidate jsonb;
  response_document jsonb;
  response_ref jsonb;
  outcome_document jsonb;
  usage_document jsonb;
  projection_document jsonb;
  outcome_id uuid;
  usage_id uuid;
  artifact_id uuid;
  terminal_at timestamptz;
  dispatch_marked_at timestamptz;
  latency_ms bigint;
  transition_revision bigint;
  result_schema text;
  disposition text := 'CREATED';
begin
  if requested_mode not in ('COMPLETED','TERMINAL','UNKNOWN') then
    raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_TRANSITION_INVALID';
  end if;
  if requested_mode = 'COMPLETED' then
    if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
        'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash',
        'attempt_id','worker_fence','response_document','outcome','usage'
      ]::text[])
      or requested_command ->> 'schema_version' <> 'provider-invocation-commit-completed@1.0.0'
    then raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_COMPLETED_COMMAND_INVALID'; end if;
    result_schema := 'provider-invocation-commit-completed-result@1.0.0';
    response_document := requested_command -> 'response_document';
  elsif requested_mode = 'TERMINAL' then
    if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
        'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash',
        'attempt_id','worker_fence','outcome','usage'
      ]::text[])
      or requested_command ->> 'schema_version' <> 'provider-invocation-commit-terminal@1.0.0'
    then raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_TERMINAL_COMMAND_INVALID'; end if;
    result_schema := 'provider-invocation-commit-terminal-result@1.0.0';
  else
    if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
        'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash',
        'attempt_id','worker_fence','outcome','usage'
      ]::text[])
      or requested_command ->> 'schema_version' <> 'provider-invocation-mark-unknown@1.0.0'
    then raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_UNKNOWN_COMMAND_INVALID'; end if;
    result_schema := 'provider-invocation-mark-unknown-result@1.0.0';
  end if;
  candidate := requested_command -> 'outcome';
  usage_candidate := requested_command -> 'usage';
  if not app_data_agent.provider_json_object_has_exact_keys(usage_candidate,array[
      'schema_version','availability','source','input_tokens','output_tokens','total_tokens',
      'tool_calls','provider_call_count','capacity_status','unavailable_reason'
    ]::text[])
    or usage_candidate ->> 'schema_version' <> 'provider-invocation-usage-candidate@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'scope',array[
        'app_id','tenant_id','environment','workspace_id','principal_id'
      ]::text[])
    or (requested_mode = 'COMPLETED' and not
      app_data_agent.provider_json_object_has_exact_keys(candidate,array[
        'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash','status',
        'reason_code','response_hash','delivery_certainty','transition_from','recovery_action',
        'provider_call_count','retry_after_ms','reconciliation_of'
      ]::text[]))
    or (requested_mode <> 'COMPLETED' and not
      app_data_agent.provider_json_object_has_exact_keys(candidate,array[
        'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash','status',
        'reason_code','response_artifact_ref','response_hash','delivery_certainty','transition_from',
        'recovery_action','provider_call_count','retry_after_ms','reconciliation_of'
      ]::text[]))
    or candidate -> 'scope' <> requested_command -> 'scope'
    or usage_candidate <> requested_usage
    or candidate ->> 'intent_id' <> requested_command ->> 'intent_id'
    or candidate ->> 'invocation_id' <> requested_command ->> 'invocation_id'
    or candidate ->> 'run_id' <> requested_command ->> 'run_id'
    or candidate ->> 'dispatch_hash' <> requested_command ->> 'dispatch_hash'
    or candidate -> 'scope' <> requested_command -> 'scope'
    or candidate ->> 'provider_call_count' <> usage_candidate ->> 'provider_call_count'
  then
    raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_TRANSITION_CLOSURE_INVALID';
  end if;
  if (usage_candidate ->> 'availability' = 'AVAILABLE' and (
      usage_candidate ->> 'source' not in ('PROVIDER_REPORTED','ESTIMATED')
      or (usage_candidate ->> 'input_tokens')::bigint not between 0 and 9007199254740991
      or (usage_candidate ->> 'output_tokens')::bigint not between 0 and 9007199254740991
      or (usage_candidate ->> 'total_tokens')::bigint <>
        (usage_candidate ->> 'input_tokens')::bigint +
        (usage_candidate ->> 'output_tokens')::bigint
      or (usage_candidate ->> 'tool_calls')::bigint not between 0 and 9007199254740991
      or usage_candidate ->> 'provider_call_count' <> '1'
      or usage_candidate ->> 'capacity_status' <> 'WITHIN_LIMIT'
      or usage_candidate -> 'unavailable_reason' <> 'null'::jsonb))
    or (usage_candidate ->> 'availability' = 'NOT_APPLICABLE' and (
      usage_candidate ->> 'source' <> 'UNAVAILABLE'
      or usage_candidate -> 'input_tokens' <> 'null'::jsonb
      or usage_candidate -> 'output_tokens' <> 'null'::jsonb
      or usage_candidate -> 'total_tokens' <> 'null'::jsonb
      or usage_candidate -> 'tool_calls' <> 'null'::jsonb
      or usage_candidate ->> 'provider_call_count' <> '0'
      or usage_candidate ->> 'capacity_status' <> 'NOT_APPLICABLE'
      or usage_candidate ->> 'unavailable_reason' <> 'PROVIDER_NOT_DISPATCHED'))
    or (usage_candidate ->> 'availability' = 'UNAVAILABLE' and (
      usage_candidate ->> 'source' <> 'UNAVAILABLE'
      or usage_candidate -> 'input_tokens' <> 'null'::jsonb
      or usage_candidate -> 'output_tokens' <> 'null'::jsonb
      or usage_candidate -> 'total_tokens' <> 'null'::jsonb
      or usage_candidate -> 'tool_calls' <> 'null'::jsonb
      or usage_candidate ->> 'provider_call_count' <> '1'
      or usage_candidate ->> 'capacity_status' <> 'UNAVAILABLE'
      or usage_candidate ->> 'unavailable_reason' not in (
        'PROVIDER_DID_NOT_REPORT_USAGE','PROVIDER_INVOCATION_OUTCOME_UNKNOWN',
        'PROVIDER_PROTOCOL_VIOLATION'
      )))
    or usage_candidate ->> 'availability' not in ('AVAILABLE','NOT_APPLICABLE','UNAVAILABLE')
  then
    raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_USAGE_TRUTH_INVALID';
  end if;
  if (requested_mode = 'COMPLETED' and (
      candidate ->> 'schema_version' <> 'provider-invocation-completed-candidate@1.0.0'
      or candidate ->> 'status' <> 'COMPLETED'))
    or (requested_mode = 'TERMINAL' and (
      candidate ->> 'schema_version' <> 'provider-invocation-outcome-candidate@1.0.0'
      or candidate ->> 'status' not in ('FAILED','THROTTLED')))
    or (requested_mode = 'UNKNOWN' and (
      candidate ->> 'status' <> 'OUTCOME_UNKNOWN'
      or candidate ->> 'transition_from' <> 'RESPONSE_OBSERVED'
      or usage_candidate ->> 'availability' <> 'UNAVAILABLE'
      or usage_candidate ->> 'unavailable_reason' <> 'PROVIDER_INVOCATION_OUTCOME_UNKNOWN'))
  then
    raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_TRANSITION_TRUTH_INVALID';
  end if;
  if candidate ->> 'recovery_action' not in (
      'NONE','SAFE_RETRY','STATUS_QUERY_REQUIRED','RECONCILIATION_REQUIRED',
      'MANUAL_REVIEW_REQUIRED'
    )
    or (candidate ->> 'reason_code' is not null and candidate ->> 'reason_code' not in (
      'PROVIDER_CREDENTIAL_UNAVAILABLE','PROVIDER_LOCAL_PREPARATION_FAILED',
      'PROVIDER_THROTTLED','PROVIDER_TIMEOUT','PROVIDER_PROTOCOL_VIOLATION',
      'PROVIDER_INVOCATION_FAILED','PROVIDER_INVOCATION_OUTCOME_UNKNOWN',
      'PROVIDER_RECONCILIATION_REQUIRED'
    ))
    or (requested_mode <> 'COMPLETED' and (
      candidate -> 'response_artifact_ref' <> 'null'::jsonb
      or candidate -> 'response_hash' <> 'null'::jsonb))
    or (candidate ->> 'status' = 'FAILED' and (
      candidate ->> 'reason_code' is null
      or candidate ->> 'delivery_certainty' = 'DISPATCHED_OUTCOME_UNKNOWN'
      or ((candidate ->> 'transition_from') = 'INTENT_COMMITTED') <>
        ((candidate ->> 'provider_call_count') = '0')))
    or (candidate ->> 'status' = 'THROTTLED' and (
      candidate ->> 'reason_code' <> 'PROVIDER_THROTTLED'
      or candidate ->> 'transition_from' <> 'RESPONSE_OBSERVED'
      or candidate ->> 'delivery_certainty' <> 'DISPATCHED_OUTCOME_KNOWN'
      or candidate ->> 'provider_call_count' <> '1'
      or candidate -> 'retry_after_ms' = 'null'::jsonb))
    or (candidate ->> 'status' = 'OUTCOME_UNKNOWN' and (
      candidate ->> 'reason_code' <> 'PROVIDER_INVOCATION_OUTCOME_UNKNOWN'
      or candidate ->> 'transition_from' <> 'RESPONSE_OBSERVED'
      or candidate ->> 'delivery_certainty' <> 'DISPATCHED_OUTCOME_UNKNOWN'
      or candidate ->> 'provider_call_count' <> '1'
      or candidate ->> 'recovery_action' not in (
        'RECONCILIATION_REQUIRED','MANUAL_REVIEW_REQUIRED'
      )))
    or ((candidate ->> 'status') = 'THROTTLED') <>
      (candidate -> 'retry_after_ms' <> 'null'::jsonb)
    or candidate -> 'reconciliation_of' <> 'null'::jsonb
  then
    raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_TRANSITION_TRUTH_INVALID';
  end if;
  lease_authority := app_data_agent.assert_provider_active_worker_lease(requested_lease);
  select intent.* into intent_record from app_data_agent.provider_invocation_intents intent
  where intent.app_id = (lease_authority ->> 'app_id')::uuid
    and intent.tenant_id = (lease_authority ->> 'tenant_id')::uuid
    and intent.environment = lease_authority ->> 'environment'
    and intent.intent_id = (requested_command ->> 'intent_id')::uuid
    and intent.invocation_id = (requested_command ->> 'invocation_id')::uuid
    and intent.run_id = (requested_command ->> 'run_id')::uuid
    and intent.admission = 'READY' for update;
  if not found or requested_command -> 'scope' <> pg_catalog.jsonb_build_object(
      'app_id',intent_record.app_id,'tenant_id',intent_record.tenant_id,
      'environment',intent_record.environment,'workspace_id',intent_record.tenant_id,
      'principal_id',intent_record.principal_id) then
    raise exception using errcode = '55000', message = 'PROVIDER_INVOCATION_INTENT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  select permit.* into permit_record from app_data_agent.provider_invocation_dispatch_permits permit
  where permit.app_id = intent_record.app_id and permit.tenant_id = intent_record.tenant_id
    and permit.environment = intent_record.environment and permit.intent_id = intent_record.intent_id
    and permit.dispatch_hash = requested_command ->> 'dispatch_hash'
    and permit.attempt_id = (requested_command ->> 'attempt_id')::uuid
    and permit.attempt_id = (lease_authority ->> 'attempt_id')::uuid
    and permit.worker_fence = (requested_command ->> 'worker_fence')::bigint
    and permit.worker_fence = (lease_authority ->> 'worker_fence')::bigint;
  if not found then raise exception using errcode = '55000', message = 'PROVIDER_DISPATCH_PERMIT_NOT_COMMITTED'; end if;
  select outcome.* into marker_record from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
    and outcome.dispatch_hash = permit_record.dispatch_hash and outcome.attempt_id = permit_record.attempt_id
    and outcome.worker_fence = permit_record.worker_fence and outcome.state = 'DISPATCH_MARKED';
  select outcome.* into response_marker_record
  from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
    and outcome.dispatch_hash = permit_record.dispatch_hash and outcome.attempt_id = permit_record.attempt_id
    and outcome.worker_fence = permit_record.worker_fence and outcome.state = 'RESPONSE_OBSERVED';

  if candidate ->> 'transition_from' = 'INTENT_COMMITTED' then
    if marker_record.outcome_id is not null or response_marker_record.outcome_id is not null
      or requested_mode <> 'TERMINAL'
      or candidate ->> 'status' <> 'FAILED' or candidate ->> 'provider_call_count' <> '0'
      or usage_candidate ->> 'availability' <> 'NOT_APPLICABLE' then
      raise exception using errcode = '55000', message = 'PROVIDER_PREDISPATCH_TRUTH_INVALID';
    end if;
    dispatch_marked_at := null; transition_revision := 1;
  else
    if marker_record.outcome_id is null
      or response_marker_record.outcome_id is null
      or candidate ->> 'transition_from' <> 'RESPONSE_OBSERVED'
      or response_marker_record.observation_kind <> candidate ->> 'status'
      or response_marker_record.delivery_certainty <> candidate ->> 'delivery_certainty'
      or response_marker_record.outcome_json -> 'response_hash' <>
        candidate -> 'response_hash'
    then
      raise exception using errcode = '55000',
        message = 'PROVIDER_RESPONSE_OBSERVED_MARK_NOT_COMMITTED';
    end if;
    dispatch_marked_at := marker_record.started_at;
    transition_revision := response_marker_record.transition_revision + 1;
  end if;
  if candidate ->> 'transition_from' = 'OUTCOME_UNKNOWN' then
    raise exception using errcode = '55000', message = 'PROVIDER_RECONCILIATION_JOB_REQUIRED';
  end if;

  select outcome.* into existing_outcome from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
    and outcome.state in ('COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN');
  if found then
    select usage.* into strict existing_usage from app_data_agent.provider_invocation_usage_receipts usage
    where usage.app_id = existing_outcome.app_id and usage.tenant_id = existing_outcome.tenant_id
      and usage.environment = existing_outcome.environment and usage.outcome_id = existing_outcome.outcome_id;
    if requested_mode = 'COMPLETED' then
      if not app_data_agent.provider_json_object_has_exact_keys(response_document,array[
          'schema_version','invocation_id','output_text','tool_calls','response_hash','content_hash'
        ]::text[])
        or response_document ->> 'schema_version' <> 'provider-response-artifact@1.0.0'
        or pg_catalog.jsonb_typeof(response_document -> 'output_text') <> 'string'
        or pg_catalog.length(response_document ->> 'output_text') > 1000000
        or pg_catalog.jsonb_typeof(response_document -> 'tool_calls') <> 'array'
        or pg_catalog.jsonb_array_length(response_document -> 'tool_calls') > 256
        or exists (
          select 1 from pg_catalog.jsonb_array_elements(response_document -> 'tool_calls') call
          where not app_data_agent.provider_json_object_has_exact_keys(
            call,array['tool_call_id','tool_name','arguments']::text[])
            or pg_catalog.length(call ->> 'tool_call_id') not between 1 and 256
            or call ->> 'tool_name' !~ '^[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$'
        )
        or response_document ->> 'invocation_id' <> intent_record.invocation_id::text
        or response_document ->> 'response_hash' <> app_data_agent.u2_canonical_sha256(
          pg_catalog.jsonb_build_object(
            'output_text',response_document -> 'output_text','tool_calls',response_document -> 'tool_calls'))
        or response_document ->> 'content_hash' <>
          app_data_agent.u2_canonical_sha256(response_document - 'content_hash')
        or candidate ->> 'response_hash' <> response_document ->> 'response_hash'
      then
        raise exception using errcode = '22023',
          message = 'PROVIDER_RESPONSE_ARTIFACT_DOCUMENT_INVALID';
      end if;
      select artifact.* into strict artifact_record from app_data_agent.artifacts artifact
      where artifact.app_id = existing_outcome.app_id
        and artifact.tenant_id = existing_outcome.tenant_id
        and artifact.environment = existing_outcome.environment
        and artifact.run_id = existing_outcome.run_id
        and artifact.artifact_id = existing_outcome.response_artifact_id
        and artifact.artifact_type = 'ProviderResponseArtifact'
        and artifact.revision = existing_outcome.response_artifact_revision
        and artifact.content_hash = existing_outcome.response_artifact_content_hash;
      response_ref := existing_outcome.outcome_json #> '{candidate,response_artifact_ref}';
      candidate := (candidate - 'schema_version') || pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-outcome-candidate@1.0.0',
        'response_artifact_ref',response_ref);
      if artifact_record.document_json <> response_document then
        raise exception using errcode = '23505', message = 'PROVIDER_RESPONSE_ARTIFACT_CONFLICT';
      end if;
    end if;
    if existing_outcome.outcome_json -> 'candidate' <> candidate
      or existing_usage.usage_json - array['schema_version','usage_receipt_id','outcome_id','intent_id',
          'invocation_id','scope','run_id','observed_at','usage_hash']::text[] <>
        usage_candidate - 'schema_version'
    then raise exception using errcode = '23505', message = 'PROVIDER_INVOCATION_TERMINAL_CONFLICT'; end if;
    outcome_document := existing_outcome.outcome_json;
    usage_document := existing_usage.usage_json;
    disposition := 'REPLAYED';
  else
    terminal_at := pg_catalog.clock_timestamp();
    outcome_id := pg_catalog.gen_random_uuid();
    usage_id := pg_catalog.gen_random_uuid();
    if requested_mode = 'COMPLETED' then
      if not app_data_agent.provider_json_object_has_exact_keys(response_document,array[
          'schema_version','invocation_id','output_text','tool_calls','response_hash','content_hash'
        ]::text[])
        or response_document ->> 'schema_version' <> 'provider-response-artifact@1.0.0'
        or pg_catalog.jsonb_typeof(response_document -> 'output_text') <> 'string'
        or pg_catalog.length(response_document ->> 'output_text') > 1000000
        or pg_catalog.jsonb_typeof(response_document -> 'tool_calls') <> 'array'
        or pg_catalog.jsonb_array_length(response_document -> 'tool_calls') > 256
        or exists (
          select 1 from pg_catalog.jsonb_array_elements(response_document -> 'tool_calls') call
          where not app_data_agent.provider_json_object_has_exact_keys(
            call,array['tool_call_id','tool_name','arguments']::text[])
            or pg_catalog.length(call ->> 'tool_call_id') not between 1 and 256
            or call ->> 'tool_name' !~ '^[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$'
        )
        or response_document ->> 'invocation_id' <> intent_record.invocation_id::text
        or response_document ->> 'response_hash' <> app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
          'output_text',response_document -> 'output_text','tool_calls',response_document -> 'tool_calls'))
        or response_document ->> 'content_hash' <> app_data_agent.u2_canonical_sha256(response_document - 'content_hash')
        or candidate ->> 'response_hash' <> response_document ->> 'response_hash'
      then raise exception using errcode = '22023', message = 'PROVIDER_RESPONSE_ARTIFACT_DOCUMENT_INVALID'; end if;
      select artifact.* into artifact_record from app_data_agent.artifacts artifact
      where artifact.app_id = intent_record.app_id and artifact.tenant_id = intent_record.tenant_id
        and artifact.environment = intent_record.environment and artifact.run_id = intent_record.run_id
        and artifact.artifact_type = 'ProviderResponseArtifact' and artifact.revision = 1
        and artifact.document_json ->> 'invocation_id' = intent_record.invocation_id::text;
      if found and (artifact_record.content_hash <> response_document ->> 'content_hash'
          or artifact_record.document_json <> response_document) then
        raise exception using errcode = '23505', message = 'PROVIDER_RESPONSE_ARTIFACT_CONFLICT';
      elsif not found then
        artifact_id := pg_catalog.gen_random_uuid();
        insert into app_data_agent.artifacts (
          app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
          document_json,worker_fence,is_active,parent_revision,parent_content_hash,created_at
        ) values (intent_record.app_id,intent_record.tenant_id,intent_record.environment,
          intent_record.run_id,artifact_id,'ProviderResponseArtifact',1,
          response_document ->> 'content_hash',response_document,permit_record.worker_fence,
          true,null,null,terminal_at) returning * into artifact_record;
      end if;
      response_ref := pg_catalog.jsonb_build_object(
        'artifact_id',artifact_record.artifact_id,'artifact_type','ProviderResponseArtifact',
        'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
        'environment',artifact_record.environment,'run_id',artifact_record.run_id,
        'revision',artifact_record.revision,'content_hash',artifact_record.content_hash);
      candidate := (candidate - 'schema_version') || pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-outcome-candidate@1.0.0',
        'response_artifact_ref',response_ref);
    end if;
    latency_ms := case when dispatch_marked_at is null then null else
      pg_catalog.greatest(0,pg_catalog.floor(
        extract(epoch from terminal_at - dispatch_marked_at) * 1000
      )::bigint) end;
    outcome_document := pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-outcome@1.0.0','outcome_id',outcome_id,
      'candidate',candidate,'dispatch_marked_at',case when dispatch_marked_at is null then null
        else app_data_agent.runtime_iso_timestamp(dispatch_marked_at) end,
      'terminal_at',app_data_agent.runtime_iso_timestamp(terminal_at),'latency_ms',latency_ms);
    outcome_document := outcome_document || pg_catalog.jsonb_build_object(
      'outcome_hash',app_data_agent.u2_canonical_sha256(outcome_document));
    usage_document := (usage_candidate - 'schema_version') || pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-usage@1.0.0','usage_receipt_id',usage_id,
      'outcome_id',outcome_id,'intent_id',intent_record.intent_id,
      'invocation_id',intent_record.invocation_id,
      'scope',requested_command -> 'scope','run_id',intent_record.run_id,
      'observed_at',app_data_agent.runtime_iso_timestamp(terminal_at));
    usage_document := usage_document || pg_catalog.jsonb_build_object(
      'usage_hash',app_data_agent.u2_canonical_sha256(usage_document));
    insert into app_data_agent.provider_invocation_outcomes (
      app_id,tenant_id,environment,outcome_id,intent_id,invocation_id,run_id,dispatch_hash,
      transition_revision,parent_transition_revision,parent_outcome_hash,state,actor_kind,
      transition_from,recovery_action,dispatch_attempt_no,attempt_id,outbox_id,command_id,
      worker_id,lease_token,worker_fence,dispatch_marked,provider_call_may_have_started,
      response_artifact_id,response_artifact_type,response_artifact_revision,
      response_artifact_content_hash,response_hash,reason_code,provider_call_count,retry_after_ms,
      delivery_certainty,started_at,terminal_at,latency_ms,reconciliation_of,
      outcome_json,outcome_hash,committed_at
    ) values (
      intent_record.app_id,intent_record.tenant_id,intent_record.environment,outcome_id,
      intent_record.intent_id,intent_record.invocation_id,intent_record.run_id,permit_record.dispatch_hash,
      transition_revision,response_marker_record.transition_revision,response_marker_record.outcome_hash,
      candidate ->> 'status','WORKER',candidate ->> 'transition_from',candidate ->> 'recovery_action',
      permit_record.attempt_no,permit_record.attempt_id,permit_record.outbox_id,permit_record.command_id,
      permit_record.worker_id,permit_record.lease_token,permit_record.worker_fence,
      marker_record.outcome_id is not null,marker_record.outcome_id is not null,
      artifact_record.artifact_id,case when artifact_record.artifact_id is null then null
        else 'ProviderResponseArtifact' end,artifact_record.revision,artifact_record.content_hash,
      candidate ->> 'response_hash',candidate ->> 'reason_code',
      (candidate ->> 'provider_call_count')::integer,(candidate ->> 'retry_after_ms')::bigint,
      candidate ->> 'delivery_certainty',dispatch_marked_at,terminal_at,latency_ms,
      (candidate ->> 'reconciliation_of')::uuid,outcome_document,outcome_document ->> 'outcome_hash',terminal_at
    );
    insert into app_data_agent.provider_invocation_usage_receipts (
      app_id,tenant_id,environment,usage_receipt_id,intent_id,invocation_id,outcome_id,
      outcome_transition_revision,outcome_hash,availability,token_source,input_tokens,output_tokens,
      total_tokens,tool_calls,provider_call_count,capacity_status,unavailable_reason,
      usage_json,usage_hash,observed_at,committed_at
    ) values (
      intent_record.app_id,intent_record.tenant_id,intent_record.environment,usage_id,
      intent_record.intent_id,intent_record.invocation_id,outcome_id,transition_revision,
      outcome_document ->> 'outcome_hash',usage_document ->> 'availability',usage_document ->> 'source',
      (usage_document ->> 'input_tokens')::bigint,(usage_document ->> 'output_tokens')::bigint,
      (usage_document ->> 'total_tokens')::bigint,(usage_document ->> 'tool_calls')::bigint,
      (usage_document ->> 'provider_call_count')::integer,usage_document ->> 'capacity_status',
      usage_document ->> 'unavailable_reason',usage_document,usage_document ->> 'usage_hash',terminal_at,terminal_at
    );
  end if;
  projection_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-public@1.0.0',
    'invocation_id',intent_record.invocation_id,'run_id',intent_record.run_id,
    'provider',intent_record.provider,'model_profile_id',intent_record.model_profile_id,
    'model_config_version',intent_record.model_config_version,'profile_version',intent_record.profile_version,
    'model_id',intent_record.model_id,'certification_receipt_ref',pg_catalog.jsonb_build_object(
      'artifact_id',intent_record.certification_artifact_id,'artifact_type','ModelCertificationReceipt',
      'app_id',intent_record.app_id,'tenant_id',intent_record.tenant_id,
      'environment',intent_record.environment,'run_id',intent_record.certification_run_id,
      'revision',intent_record.certification_revision,'content_hash',intent_record.certification_hash),
    'attempt_id',permit_record.attempt_id,'attempt_no',permit_record.attempt_no,
    'recovery_action',outcome_document #> '{candidate,recovery_action}',
    'status',outcome_document #>> '{candidate,status}',
    'reason_code',outcome_document #> '{candidate,reason_code}',
    'dispatch_hash',permit_record.dispatch_hash,
    'response_hash',outcome_document #> '{candidate,response_hash}',
    'usage_availability',usage_document -> 'availability','usage_source',usage_document -> 'source',
    'input_tokens',usage_document -> 'input_tokens','output_tokens',usage_document -> 'output_tokens',
    'total_tokens',usage_document -> 'total_tokens','tool_calls',usage_document -> 'tool_calls',
    'provider_call_count',usage_document -> 'provider_call_count',
    'retry_after_ms',outcome_document #> '{candidate,retry_after_ms}',
    'latency_ms',outcome_document -> 'latency_ms',
    'receipt_deep_link','/w/' || intent_record.workspace_id::text || '/runs/' ||
      intent_record.run_id::text || '/provider-invocations/' || intent_record.invocation_id::text,
    'terminal_at',outcome_document -> 'terminal_at');
  if outcome_document #>> '{candidate,intent_id}' <> intent_record.intent_id::text
    or outcome_document #>> '{candidate,invocation_id}' <> intent_record.invocation_id::text
    or outcome_document #>> '{candidate,run_id}' <> intent_record.run_id::text
    or outcome_document #> '{candidate,scope}' <> pg_catalog.jsonb_build_object(
      'app_id',intent_record.app_id,'tenant_id',intent_record.tenant_id,
      'environment',intent_record.environment,'workspace_id',intent_record.workspace_id,
      'principal_id',intent_record.principal_id)
    or outcome_document #>> '{candidate,dispatch_hash}' <> permit_record.dispatch_hash
    or usage_document ->> 'intent_id' <> intent_record.intent_id::text
    or usage_document ->> 'invocation_id' <> intent_record.invocation_id::text
    or usage_document ->> 'run_id' <> intent_record.run_id::text
    or usage_document -> 'scope' <> outcome_document #> '{candidate,scope}'
    or projection_document ->> 'invocation_id' <> intent_record.invocation_id::text
    or projection_document ->> 'run_id' <> intent_record.run_id::text
    or projection_document ->> 'provider' <> intent_record.provider
    or projection_document ->> 'model_profile_id' <> intent_record.model_profile_id::text
    or projection_document ->> 'model_config_version' <> intent_record.model_config_version::text
    or projection_document ->> 'profile_version' <> intent_record.profile_version
    or projection_document ->> 'model_id' <> intent_record.model_id
    or projection_document ->> 'attempt_id' <> permit_record.attempt_id::text
    or projection_document ->> 'attempt_no' <> permit_record.attempt_no::text
    or projection_document ->> 'dispatch_hash' <> permit_record.dispatch_hash
  then
    raise exception using errcode = 'P0001',
      message = 'PROVIDER_TERMINAL_RESULT_CLOSURE_INVALID';
  end if;
  return pg_catalog.jsonb_build_object(
    'schema_version',result_schema,'disposition',disposition,
    'intent',intent_record.intent_json,'permit',permit_record.permit_json,
    'response_artifact_ref',case when requested_mode = 'COMPLETED'
      then outcome_document #> '{candidate,response_artifact_ref}' else null end,
    'outcome',outcome_document,'usage',usage_document,'projection',projection_document)
    - case when requested_mode = 'COMPLETED' then '' else 'response_artifact_ref' end;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_TRANSITION_INVALID';
end
$function$;

create function app_data_agent.commit_provider_invocation_completed(
  requested_lease jsonb, requested_command jsonb
)
returns jsonb language sql volatile security definer set search_path = ''
as $function$
  select app_data_agent.commit_provider_invocation_worker_transition_internal(
    requested_lease,requested_command,requested_command -> 'usage','COMPLETED');
$function$;

create function app_data_agent.commit_provider_invocation_terminal(
  requested_lease jsonb, requested_command jsonb, requested_usage jsonb
)
returns jsonb language sql volatile security definer set search_path = ''
as $function$
  select app_data_agent.commit_provider_invocation_worker_transition_internal(
    requested_lease,requested_command,requested_usage,'TERMINAL');
$function$;

create function app_data_agent.mark_provider_invocation_outcome_unknown(
  requested_lease jsonb, requested_command jsonb, requested_usage jsonb
)
returns jsonb language sql volatile security definer set search_path = ''
as $function$
  select app_data_agent.commit_provider_invocation_worker_transition_internal(
    requested_lease,requested_command,requested_usage,'UNKNOWN');
$function$;

create function app_data_agent.commit_provider_reconciliation_evidence(
  requested_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  run_record app_data_agent.runs%rowtype;
  artifact_record app_data_agent.artifacts%rowtype;
  document jsonb := requested_command -> 'document';
  content_hash text;
  committed_at timestamptz;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_job_authority','USAGE') then
    raise exception using errcode = '42501', message = 'PROVIDER_RECONCILIATION_JOB_ROLE_REQUIRED';
  end if;
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','scope','run_id','evidence_id','document'
    ]::text[])
    or requested_command ->> 'schema_version' <>
      'provider-reconciliation-evidence-commit@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'scope',array[
        'app_id','tenant_id','environment','workspace_id','principal_id'
      ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(document,array[
      'schema_version','evidence_id','scope','run_id','reconciliation_id','invocation_id',
      'unknown_outcome_id','recovery_capability_used','evidence_status'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      document -> 'scope',array[
        'app_id','tenant_id','environment','workspace_id','principal_id'
      ]::text[])
    or document ->> 'schema_version' <> 'provider-reconciliation-evidence@1.0.0'
    or document ->> 'evidence_id' <> requested_command ->> 'evidence_id'
    or document -> 'scope' <> requested_command -> 'scope'
    or document ->> 'run_id' <> requested_command ->> 'run_id'
    or document ->> 'evidence_status' <> 'OUTCOME_KNOWN'
    or document ->> 'recovery_capability_used' not in (
      'IDEMPOTENT_REQUEST','INVOCATION_STATUS_QUERY','INVOCATION_RECONCILIATION'
    )
    or app_data_agent.contains_potential_plaintext_secret(document)
  then
    raise exception using errcode = '22023',
      message = 'PROVIDER_RECONCILIATION_EVIDENCE_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(true);
  if requested_command -> 'scope' <> pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment,'workspace_id',authority.tenant_id,
      'principal_id',authority.principal_id)
  then
    raise exception using errcode = '42501',
      message = 'PROVIDER_RECONCILIATION_EVIDENCE_NOT_OWNED';
  end if;
  select run.* into run_record from app_data_agent.runs run
  where run.app_id = authority.app_id and run.tenant_id = authority.tenant_id
    and run.environment = authority.environment
    and run.run_id = (requested_command ->> 'run_id')::uuid
  for share;
  if not found then
    raise exception using errcode = '42501',
      message = 'PROVIDER_RECONCILIATION_EVIDENCE_NOT_OWNED';
  end if;
  content_hash := app_data_agent.u2_canonical_sha256(document);
  select artifact.* into artifact_record from app_data_agent.artifacts artifact
  where artifact.app_id = authority.app_id and artifact.tenant_id = authority.tenant_id
    and artifact.environment = authority.environment and artifact.run_id = run_record.run_id
    and artifact.artifact_id = (requested_command ->> 'evidence_id')::uuid
    and artifact.artifact_type = 'ProviderReconciliationEvidence'
    and artifact.revision = 1
  for share;
  if found then
    if artifact_record.content_hash <> content_hash or artifact_record.document_json <> document then
      raise exception using errcode = '23505',
        message = 'PROVIDER_RECONCILIATION_EVIDENCE_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'schema_version','provider-reconciliation-evidence-commit-result@1.0.0',
      'disposition','REPLAYED','reference',pg_catalog.jsonb_build_object(
        'artifact_id',artifact_record.artifact_id,
        'artifact_type','ProviderReconciliationEvidence',
        'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
        'environment',artifact_record.environment,'run_id',artifact_record.run_id,
        'revision',artifact_record.revision,'content_hash',artifact_record.content_hash));
  end if;
  committed_at := pg_catalog.clock_timestamp();
  insert into app_data_agent.artifacts (
    app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,
    content_hash,document_json,worker_fence,is_active,parent_revision,parent_content_hash,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,run_record.run_id,
    (requested_command ->> 'evidence_id')::uuid,'ProviderReconciliationEvidence',1,
    content_hash,document,0,true,null,null,committed_at
  ) returning * into artifact_record;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-reconciliation-evidence-commit-result@1.0.0',
    'disposition','CREATED','reference',pg_catalog.jsonb_build_object(
      'artifact_id',artifact_record.artifact_id,
      'artifact_type','ProviderReconciliationEvidence',
      'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
      'environment',artifact_record.environment,'run_id',artifact_record.run_id,
      'revision',artifact_record.revision,'content_hash',artifact_record.content_hash));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023',
    message = 'PROVIDER_RECONCILIATION_EVIDENCE_INVALID';
end
$function$;

create function app_data_agent.reconcile_provider_invocation_unknown(
  requested_reconciliation_authority jsonb,
  requested_command jsonb,
  requested_usage jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  unknown_record app_data_agent.provider_invocation_outcomes%rowtype;
  existing_outcome app_data_agent.provider_invocation_outcomes%rowtype;
  existing_usage app_data_agent.provider_invocation_usage_receipts%rowtype;
  evidence_record app_data_agent.artifacts%rowtype;
  response_record app_data_agent.artifacts%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  candidate jsonb := requested_command -> 'outcome';
  usage_candidate jsonb := requested_command -> 'usage';
  response_document jsonb := requested_command -> 'response_document';
  response_ref jsonb;
  outcome_document jsonb;
  usage_document jsonb;
  projection_document jsonb;
  outcome_id uuid;
  usage_id uuid;
  response_artifact_id uuid;
  terminal_at timestamptz;
  latency_ms bigint;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_job_authority','USAGE') then
    raise exception using errcode = '42501', message = 'PROVIDER_RECONCILIATION_JOB_ROLE_REQUIRED';
  end if;
  if not app_data_agent.provider_json_object_has_exact_keys(requested_reconciliation_authority,array[
      'schema_version','reconciliation_id','evidence_hash'
    ]::text[])
    or requested_reconciliation_authority ->> 'schema_version' <>
      'provider-reconciliation-authority@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash',
      'attempt_id','worker_fence','actor','reconciliation_id','unknown_outcome_ref',
      'evidence_ref','evidence_hash','recovery_capability_used','response_document','outcome','usage'
    ]::text[])
    or requested_command ->> 'schema_version' <> 'provider-invocation-reconcile-unknown@1.0.0'
    or requested_command ->> 'actor' <> 'RECONCILIATION_JOB'
    or requested_command ->> 'reconciliation_id' <>
      requested_reconciliation_authority ->> 'reconciliation_id'
    or requested_command ->> 'evidence_hash' <>
      requested_reconciliation_authority ->> 'evidence_hash'
    or requested_command ->> 'evidence_hash' <> requested_command #>> '{evidence_ref,content_hash}'
    or requested_usage <> usage_candidate
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'scope',array[
        'app_id','tenant_id','environment','workspace_id','principal_id'
      ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'unknown_outcome_ref',array['outcome_id','outcome_hash']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'evidence_ref',array[
        'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
      ]::text[])
    or ((candidate ->> 'status') = 'COMPLETED' and not
      app_data_agent.provider_json_object_has_exact_keys(candidate,array[
        'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash','status',
        'reason_code','response_hash','delivery_certainty','transition_from','recovery_action',
        'provider_call_count','retry_after_ms','reconciliation_of'
      ]::text[]))
    or ((candidate ->> 'status') <> 'COMPLETED' and not
      app_data_agent.provider_json_object_has_exact_keys(candidate,array[
        'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash','status',
        'reason_code','response_artifact_ref','response_hash','delivery_certainty','transition_from',
        'recovery_action','provider_call_count','retry_after_ms','reconciliation_of'
      ]::text[]))
    or not app_data_agent.provider_json_object_has_exact_keys(usage_candidate,array[
      'schema_version','availability','source','input_tokens','output_tokens','total_tokens',
      'tool_calls','provider_call_count','capacity_status','unavailable_reason'
    ]::text[])
    or ((candidate ->> 'status') = 'COMPLETED' and
      candidate ->> 'schema_version' <> 'provider-invocation-completed-candidate@1.0.0')
    or ((candidate ->> 'status') <> 'COMPLETED' and
      candidate ->> 'schema_version' <> 'provider-invocation-outcome-candidate@1.0.0')
    or usage_candidate ->> 'schema_version' <> 'provider-invocation-usage-candidate@1.0.0'
    or candidate -> 'scope' <> requested_command -> 'scope'
    or ((candidate ->> 'status') = 'COMPLETED' and (
      not app_data_agent.provider_json_object_has_exact_keys(response_document,array[
        'schema_version','invocation_id','output_text','tool_calls','response_hash','content_hash'
      ]::text[])
      or response_document ->> 'schema_version' <> 'provider-response-artifact@1.0.0'
      or response_document ->> 'invocation_id' <> requested_command ->> 'invocation_id'
      or response_document ->> 'response_hash' <> candidate ->> 'response_hash'
      or response_document ->> 'response_hash' <> app_data_agent.u2_canonical_sha256(
        pg_catalog.jsonb_build_object(
          'output_text',response_document -> 'output_text',
          'tool_calls',response_document -> 'tool_calls'))
      or response_document ->> 'content_hash' <>
        app_data_agent.u2_canonical_sha256(response_document - 'content_hash')
      or pg_catalog.jsonb_typeof(response_document -> 'output_text') <> 'string'
      or pg_catalog.length(response_document ->> 'output_text') > 1000000
      or pg_catalog.jsonb_typeof(response_document -> 'tool_calls') <> 'array'
      or pg_catalog.jsonb_array_length(response_document -> 'tool_calls') > 256
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(response_document -> 'tool_calls') call
        where not app_data_agent.provider_json_object_has_exact_keys(
          call,array['tool_call_id','tool_name','arguments']::text[])
          or pg_catalog.length(call ->> 'tool_call_id') not between 1 and 256
          or call ->> 'tool_name' !~ '^[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$'
      )))
    or ((candidate ->> 'status') <> 'COMPLETED' and response_document <> 'null'::jsonb)
    or app_data_agent.contains_potential_plaintext_secret(requested_command)
  then raise exception using errcode = '22023', message = 'PROVIDER_RECONCILIATION_COMMAND_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if requested_command -> 'scope' <> pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment,'workspace_id',authority.tenant_id,
      'principal_id',authority.principal_id)
  then
    raise exception using errcode = '42501', message = 'PROVIDER_RECONCILIATION_NOT_AUTHORIZED';
  end if;
  select intent.* into intent_record from app_data_agent.provider_invocation_intents intent
  where intent.app_id = (requested_command #>> '{scope,app_id}')::uuid
    and intent.tenant_id = (requested_command #>> '{scope,tenant_id}')::uuid
    and intent.environment = requested_command #>> '{scope,environment}'
    and intent.workspace_id = (requested_command #>> '{scope,workspace_id}')::uuid
    and intent.principal_id = (requested_command #>> '{scope,principal_id}')::uuid
    and intent.intent_id = (requested_command ->> 'intent_id')::uuid
    and intent.invocation_id = (requested_command ->> 'invocation_id')::uuid
    and intent.run_id = (requested_command ->> 'run_id')::uuid for update;
  if not found or not ((requested_command ->> 'recovery_capability_used') = any(intent_record.recovery_capabilities)) then
    raise exception using errcode = '42501', message = 'PROVIDER_RECONCILIATION_NOT_AUTHORIZED';
  end if;
  select outcome.* into unknown_record from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
    and outcome.outcome_id = (requested_command #>> '{unknown_outcome_ref,outcome_id}')::uuid
    and outcome.outcome_hash = requested_command #>> '{unknown_outcome_ref,outcome_hash}'
    and outcome.dispatch_hash = requested_command ->> 'dispatch_hash'
    and outcome.state = 'OUTCOME_UNKNOWN' for share;
  if not found or candidate ->> 'transition_from' <> 'OUTCOME_UNKNOWN'
    or unknown_record.attempt_id <> (requested_command ->> 'attempt_id')::uuid
    or unknown_record.worker_fence <> (requested_command ->> 'worker_fence')::bigint
    or candidate ->> 'reconciliation_of' <> unknown_record.outcome_id::text
    or candidate ->> 'status' not in ('COMPLETED','FAILED','THROTTLED')
    or candidate ->> 'recovery_action' <> 'NONE'
    or candidate ->> 'delivery_certainty' <> 'DISPATCHED_OUTCOME_KNOWN'
    or candidate ->> 'intent_id' <> intent_record.intent_id::text
    or candidate ->> 'invocation_id' <> intent_record.invocation_id::text
    or candidate ->> 'run_id' <> intent_record.run_id::text
    or candidate -> 'scope' <> intent_record.intent_json #> '{invocation_spec,scope}'
    or candidate ->> 'dispatch_hash' <> unknown_record.dispatch_hash
    or candidate ->> 'provider_call_count' <> usage_candidate ->> 'provider_call_count'
    or candidate ->> 'recovery_action' <> 'NONE'
    or candidate ->> 'delivery_certainty' <> 'DISPATCHED_OUTCOME_KNOWN'
    or (candidate ->> 'status' = 'COMPLETED' and (
      candidate -> 'reason_code' <> 'null'::jsonb
      or candidate ->> 'provider_call_count' <> '1'
      or candidate -> 'retry_after_ms' <> 'null'::jsonb))
    or (candidate ->> 'status' = 'FAILED' and (
      candidate ->> 'reason_code' is null
      or candidate ->> 'provider_call_count' <> '1'
      or candidate -> 'retry_after_ms' <> 'null'::jsonb))
    or (candidate ->> 'status' = 'THROTTLED' and (
      candidate ->> 'reason_code' <> 'PROVIDER_THROTTLED'
      or candidate ->> 'provider_call_count' <> '1'
      or (candidate ->> 'retry_after_ms')::bigint not between 1 and 86400000))
    or (candidate ->> 'status' <> 'COMPLETED' and (
      candidate -> 'response_artifact_ref' <> 'null'::jsonb
      or candidate -> 'response_hash' <> 'null'::jsonb))
    or (usage_candidate ->> 'availability' = 'AVAILABLE' and (
      usage_candidate ->> 'source' not in ('PROVIDER_REPORTED','ESTIMATED')
      or (usage_candidate ->> 'input_tokens')::bigint not between 0 and 9007199254740991
      or (usage_candidate ->> 'output_tokens')::bigint not between 0 and 9007199254740991
      or (usage_candidate ->> 'total_tokens')::bigint <>
        (usage_candidate ->> 'input_tokens')::bigint +
        (usage_candidate ->> 'output_tokens')::bigint
      or (usage_candidate ->> 'tool_calls')::bigint not between 0 and 9007199254740991
      or usage_candidate ->> 'provider_call_count' <> '1'
      or usage_candidate ->> 'capacity_status' <> 'WITHIN_LIMIT'
      or usage_candidate -> 'unavailable_reason' <> 'null'::jsonb))
    or (usage_candidate ->> 'availability' = 'UNAVAILABLE' and (
      usage_candidate ->> 'source' <> 'UNAVAILABLE'
      or usage_candidate -> 'input_tokens' <> 'null'::jsonb
      or usage_candidate -> 'output_tokens' <> 'null'::jsonb
      or usage_candidate -> 'total_tokens' <> 'null'::jsonb
      or usage_candidate -> 'tool_calls' <> 'null'::jsonb
      or usage_candidate ->> 'provider_call_count' <> '1'
      or usage_candidate ->> 'capacity_status' <> 'UNAVAILABLE'
      or usage_candidate ->> 'unavailable_reason' not in (
        'PROVIDER_DID_NOT_REPORT_USAGE','PROVIDER_PROTOCOL_VIOLATION')))
    or usage_candidate ->> 'availability' not in ('AVAILABLE','UNAVAILABLE')
  then raise exception using errcode = '55000', message = 'PROVIDER_RECONCILIATION_PARENT_MISMATCH'; end if;
  select artifact.* into evidence_record from app_data_agent.artifacts artifact
  where artifact.app_id = intent_record.app_id and artifact.tenant_id = intent_record.tenant_id
    and artifact.environment = intent_record.environment
    and artifact.run_id = (requested_command #>> '{evidence_ref,run_id}')::uuid
    and artifact.artifact_id = (requested_command #>> '{evidence_ref,artifact_id}')::uuid
    and artifact.artifact_type = 'ProviderReconciliationEvidence'
    and artifact.revision = (requested_command #>> '{evidence_ref,revision}')::integer
    and artifact.content_hash = requested_command ->> 'evidence_hash' and artifact.is_active;
  if not found
    or requested_command #>> '{evidence_ref,artifact_type}' <> 'ProviderReconciliationEvidence'
    or requested_command -> 'evidence_ref' <> pg_catalog.jsonb_build_object(
      'artifact_id',evidence_record.artifact_id,
      'artifact_type','ProviderReconciliationEvidence',
      'app_id',evidence_record.app_id,'tenant_id',evidence_record.tenant_id,
      'environment',evidence_record.environment,'run_id',evidence_record.run_id,
      'revision',evidence_record.revision,'content_hash',evidence_record.content_hash)
    or evidence_record.content_hash <> app_data_agent.u2_canonical_sha256(evidence_record.document_json)
    or not app_data_agent.provider_json_object_has_exact_keys(evidence_record.document_json,array[
      'schema_version','evidence_id','scope','run_id','reconciliation_id','invocation_id',
      'unknown_outcome_id','recovery_capability_used','evidence_status'
    ]::text[])
    or evidence_record.document_json ->> 'schema_version' <>
      'provider-reconciliation-evidence@1.0.0'
    or evidence_record.document_json ->> 'evidence_id' <> evidence_record.artifact_id::text
    or evidence_record.document_json -> 'scope' <> requested_command -> 'scope'
    or evidence_record.document_json ->> 'run_id' <> evidence_record.run_id::text
    or evidence_record.document_json ->> 'evidence_status' <> 'OUTCOME_KNOWN'
    or evidence_record.document_json ->> 'reconciliation_id' <> requested_command ->> 'reconciliation_id'
    or evidence_record.document_json ->> 'invocation_id' <> intent_record.invocation_id::text
    or evidence_record.document_json ->> 'unknown_outcome_id' <> unknown_record.outcome_id::text
    or evidence_record.document_json ->> 'recovery_capability_used' <>
      requested_command ->> 'recovery_capability_used'
  then raise exception using errcode = '55000', message = 'PROVIDER_RECONCILIATION_EVIDENCE_INVALID'; end if;
  select permit.* into permit_record from app_data_agent.provider_invocation_dispatch_permits permit
  where permit.app_id = intent_record.app_id and permit.tenant_id = intent_record.tenant_id
    and permit.environment = intent_record.environment and permit.intent_id = intent_record.intent_id
    and permit.dispatch_hash = unknown_record.dispatch_hash;
  select outcome.* into existing_outcome from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment
    and outcome.reconciliation_id = (requested_command ->> 'reconciliation_id')::uuid;
  if found then
    select usage.* into strict existing_usage from app_data_agent.provider_invocation_usage_receipts usage
    where usage.app_id = existing_outcome.app_id and usage.tenant_id = existing_outcome.tenant_id
      and usage.environment = existing_outcome.environment and usage.outcome_id = existing_outcome.outcome_id;
    if candidate ->> 'status' = 'COMPLETED' then
      select artifact.* into strict response_record
      from app_data_agent.artifacts artifact
      where artifact.app_id = existing_outcome.app_id
        and artifact.tenant_id = existing_outcome.tenant_id
        and artifact.environment = existing_outcome.environment
        and artifact.run_id = existing_outcome.run_id
        and artifact.artifact_id = existing_outcome.response_artifact_id
        and artifact.artifact_type = 'ProviderResponseArtifact'
        and artifact.revision = existing_outcome.response_artifact_revision
        and artifact.content_hash = existing_outcome.response_artifact_content_hash;
      if response_record.document_json <> response_document then
        raise exception using errcode = '23505', message = 'PROVIDER_RESPONSE_ARTIFACT_CONFLICT';
      end if;
      response_ref := existing_outcome.outcome_json #> '{candidate,response_artifact_ref}';
      candidate := (candidate - 'schema_version') || pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-outcome-candidate@1.0.0',
        'response_artifact_ref',response_ref);
    end if;
    if existing_outcome.outcome_json -> 'candidate' <> candidate
      or existing_usage.usage_json - array[
        'schema_version','usage_receipt_id','outcome_id','intent_id','invocation_id',
        'scope','run_id','observed_at','usage_hash'
      ]::text[] <> usage_candidate - 'schema_version'
    then
      raise exception using errcode = '23505', message = 'PROVIDER_RECONCILIATION_CONFLICT';
    end if;
    outcome_document := existing_outcome.outcome_json; usage_document := existing_usage.usage_json;
  else
    terminal_at := pg_catalog.clock_timestamp(); outcome_id := pg_catalog.gen_random_uuid();
    usage_id := pg_catalog.gen_random_uuid();
    if candidate ->> 'status' = 'COMPLETED' then
      select artifact.* into response_record from app_data_agent.artifacts artifact
      where artifact.app_id = intent_record.app_id
        and artifact.tenant_id = intent_record.tenant_id
        and artifact.environment = intent_record.environment
        and artifact.run_id = intent_record.run_id
        and artifact.artifact_type = 'ProviderResponseArtifact'
        and artifact.revision = 1
        and artifact.document_json ->> 'invocation_id' = intent_record.invocation_id::text
      for share;
      if found and (response_record.content_hash <> response_document ->> 'content_hash'
          or response_record.document_json <> response_document) then
        raise exception using errcode = '23505', message = 'PROVIDER_RESPONSE_ARTIFACT_CONFLICT';
      elsif not found then
        response_artifact_id := pg_catalog.gen_random_uuid();
        insert into app_data_agent.artifacts (
          app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
          document_json,worker_fence,is_active,parent_revision,parent_content_hash,created_at
        ) values (
          intent_record.app_id,intent_record.tenant_id,intent_record.environment,
          intent_record.run_id,response_artifact_id,'ProviderResponseArtifact',1,
          response_document ->> 'content_hash',response_document,unknown_record.worker_fence,
          true,null,null,terminal_at
        ) returning * into response_record;
      end if;
      response_ref := pg_catalog.jsonb_build_object(
        'artifact_id',response_record.artifact_id,'artifact_type','ProviderResponseArtifact',
        'app_id',response_record.app_id,'tenant_id',response_record.tenant_id,
        'environment',response_record.environment,'run_id',response_record.run_id,
        'revision',response_record.revision,'content_hash',response_record.content_hash);
      candidate := (candidate - 'schema_version') || pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-outcome-candidate@1.0.0',
        'response_artifact_ref',response_ref);
    end if;
    latency_ms := greatest(0::bigint,pg_catalog.floor(
      extract(epoch from terminal_at - unknown_record.started_at) * 1000)::bigint);
    outcome_document := pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-outcome@1.0.0','outcome_id',outcome_id,
      'candidate',candidate,'dispatch_marked_at',app_data_agent.runtime_iso_timestamp(unknown_record.started_at),
      'terminal_at',app_data_agent.runtime_iso_timestamp(terminal_at),'latency_ms',latency_ms);
    outcome_document := outcome_document || pg_catalog.jsonb_build_object(
      'outcome_hash',app_data_agent.u2_canonical_sha256(outcome_document));
    usage_document := (usage_candidate - 'schema_version') || pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-usage@1.0.0','usage_receipt_id',usage_id,
      'outcome_id',outcome_id,'intent_id',intent_record.intent_id,'invocation_id',intent_record.invocation_id,
      'scope',requested_command -> 'scope','run_id',intent_record.run_id,
      'observed_at',app_data_agent.runtime_iso_timestamp(terminal_at));
    usage_document := usage_document || pg_catalog.jsonb_build_object(
      'usage_hash',app_data_agent.u2_canonical_sha256(usage_document));
    insert into app_data_agent.provider_invocation_outcomes (
      app_id,tenant_id,environment,outcome_id,intent_id,invocation_id,run_id,dispatch_hash,
      transition_revision,parent_transition_revision,parent_outcome_hash,state,actor_kind,
      transition_from,recovery_action,dispatch_attempt_no,attempt_id,outbox_id,command_id,worker_id,
      lease_token,worker_fence,dispatch_marked,provider_call_may_have_started,
      response_artifact_id,response_artifact_type,response_artifact_revision,
      response_artifact_content_hash,response_hash,evidence_run_id,evidence_artifact_id,
      evidence_artifact_type,evidence_artifact_revision,evidence_hash,reason_code,provider_call_count,
      retry_after_ms,delivery_certainty,started_at,terminal_at,latency_ms,reconciliation_id,
      recovery_capability_used,reconciliation_of,outcome_json,outcome_hash,committed_at
    ) values (
      intent_record.app_id,intent_record.tenant_id,intent_record.environment,outcome_id,
      intent_record.intent_id,intent_record.invocation_id,intent_record.run_id,unknown_record.dispatch_hash,
      unknown_record.transition_revision + 1,unknown_record.transition_revision,unknown_record.outcome_hash,
      candidate ->> 'status','RECONCILER','OUTCOME_UNKNOWN',candidate ->> 'recovery_action',
      permit_record.attempt_no,permit_record.attempt_id,permit_record.outbox_id,permit_record.command_id,
      permit_record.worker_id,permit_record.lease_token,permit_record.worker_fence,true,true,
      response_record.artifact_id,case when response_record.artifact_id is null then null else 'ProviderResponseArtifact' end,
      response_record.revision,response_record.content_hash,candidate ->> 'response_hash',
      evidence_record.run_id,evidence_record.artifact_id,evidence_record.artifact_type,
      evidence_record.revision,evidence_record.content_hash,candidate ->> 'reason_code',
      (candidate ->> 'provider_call_count')::integer,(candidate ->> 'retry_after_ms')::bigint,
      candidate ->> 'delivery_certainty',unknown_record.started_at,terminal_at,latency_ms,
      (requested_command ->> 'reconciliation_id')::uuid,requested_command ->> 'recovery_capability_used',
      unknown_record.outcome_id,outcome_document,outcome_document ->> 'outcome_hash',terminal_at);
    insert into app_data_agent.provider_invocation_usage_receipts (
      app_id,tenant_id,environment,usage_receipt_id,intent_id,invocation_id,outcome_id,
      outcome_transition_revision,outcome_hash,availability,token_source,input_tokens,output_tokens,
      total_tokens,tool_calls,provider_call_count,capacity_status,unavailable_reason,usage_json,usage_hash,
      observed_at,committed_at
    ) values (intent_record.app_id,intent_record.tenant_id,intent_record.environment,usage_id,
      intent_record.intent_id,intent_record.invocation_id,outcome_id,unknown_record.transition_revision + 1,
      outcome_document ->> 'outcome_hash',usage_document ->> 'availability',usage_document ->> 'source',
      (usage_document ->> 'input_tokens')::bigint,(usage_document ->> 'output_tokens')::bigint,
      (usage_document ->> 'total_tokens')::bigint,(usage_document ->> 'tool_calls')::bigint,
      (usage_document ->> 'provider_call_count')::integer,usage_document ->> 'capacity_status',
      usage_document ->> 'unavailable_reason',usage_document,usage_document ->> 'usage_hash',terminal_at,terminal_at);
  end if;
  projection_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-public@1.0.0','invocation_id',intent_record.invocation_id,
    'run_id',intent_record.run_id,'provider',intent_record.provider,
    'model_profile_id',intent_record.model_profile_id,'model_config_version',intent_record.model_config_version,
    'profile_version',intent_record.profile_version,'model_id',intent_record.model_id,
    'certification_receipt_ref',pg_catalog.jsonb_build_object(
      'artifact_id',intent_record.certification_artifact_id,'artifact_type','ModelCertificationReceipt',
      'app_id',intent_record.app_id,'tenant_id',intent_record.tenant_id,
      'environment',intent_record.environment,'run_id',intent_record.certification_run_id,
      'revision',intent_record.certification_revision,'content_hash',intent_record.certification_hash),
    'attempt_id',permit_record.attempt_id,
    'attempt_no',permit_record.attempt_no,'recovery_action',outcome_document #> '{candidate,recovery_action}',
    'status',outcome_document #>> '{candidate,status}','reason_code',outcome_document #> '{candidate,reason_code}',
    'dispatch_hash',unknown_record.dispatch_hash,'response_hash',outcome_document #> '{candidate,response_hash}',
    'usage_availability',usage_document -> 'availability','usage_source',usage_document -> 'source',
    'input_tokens',usage_document -> 'input_tokens','output_tokens',usage_document -> 'output_tokens',
    'total_tokens',usage_document -> 'total_tokens','tool_calls',usage_document -> 'tool_calls',
    'provider_call_count',usage_document -> 'provider_call_count',
    'retry_after_ms',outcome_document #> '{candidate,retry_after_ms}',
    'latency_ms',outcome_document -> 'latency_ms',
    'receipt_deep_link','/w/' || intent_record.workspace_id::text || '/runs/' || intent_record.run_id::text ||
      '/provider-invocations/' || intent_record.invocation_id::text,
    'terminal_at',outcome_document -> 'terminal_at');
  if outcome_document #>> '{candidate,intent_id}' <> intent_record.intent_id::text
    or outcome_document #>> '{candidate,invocation_id}' <> intent_record.invocation_id::text
    or outcome_document #>> '{candidate,run_id}' <> intent_record.run_id::text
    or outcome_document #> '{candidate,scope}' <> intent_record.intent_json #> '{invocation_spec,scope}'
    or outcome_document #>> '{candidate,dispatch_hash}' <> unknown_record.dispatch_hash
    or usage_document ->> 'intent_id' <> intent_record.intent_id::text
    or usage_document ->> 'invocation_id' <> intent_record.invocation_id::text
    or usage_document ->> 'run_id' <> intent_record.run_id::text
    or usage_document -> 'scope' <> intent_record.intent_json #> '{invocation_spec,scope}'
    or projection_document ->> 'invocation_id' <> intent_record.invocation_id::text
    or projection_document ->> 'run_id' <> intent_record.run_id::text
    or projection_document ->> 'provider' <> intent_record.provider
    or projection_document ->> 'model_profile_id' <> intent_record.model_profile_id::text
    or projection_document ->> 'model_config_version' <> intent_record.model_config_version::text
    or projection_document ->> 'profile_version' <> intent_record.profile_version
    or projection_document ->> 'model_id' <> intent_record.model_id
    or projection_document ->> 'attempt_id' <> permit_record.attempt_id::text
    or projection_document ->> 'attempt_no' <> permit_record.attempt_no::text
    or projection_document ->> 'dispatch_hash' <> unknown_record.dispatch_hash
    or ((outcome_document #>> '{candidate,status}' = 'COMPLETED') <>
      (outcome_document #> '{candidate,response_artifact_ref}' <> 'null'::jsonb))
  then
    raise exception using errcode = 'P0001',
      message = 'PROVIDER_RECONCILIATION_RESULT_CLOSURE_INVALID';
  end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-reconcile-unknown-result@1.0.0',
    'disposition',case when existing_outcome.outcome_id is null then 'CREATED' else 'REPLAYED' end,
    'reconciliation_id',(requested_command ->> 'reconciliation_id')::uuid,
    'intent',intent_record.intent_json,'permit',permit_record.permit_json,
    'response_artifact_ref',case when outcome_document #>> '{candidate,status}' = 'COMPLETED'
      then outcome_document #> '{candidate,response_artifact_ref}' else null end,
    'outcome',outcome_document,'usage',usage_document,'projection',projection_document);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023', message = 'PROVIDER_RECONCILIATION_COMMAND_INVALID';
end
$function$;

create function app_data_agent.recover_stale_provider_invocation_marker(
  requested_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  response_marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  existing_outcome app_data_agent.provider_invocation_outcomes%rowtype;
  usage_record app_data_agent.provider_invocation_usage_receipts%rowtype;
  attempt_record app_data_agent.run_attempts%rowtype;
  outbox_record app_data_agent.outbox%rowtype;
  recovery_artifact app_data_agent.artifacts%rowtype;
  candidate jsonb := requested_command -> 'outcome';
  usage_candidate jsonb := requested_command -> 'usage';
  receipt_document jsonb;
  receipt_reference jsonb;
  outcome_document jsonb;
  usage_document jsonb;
  projection_document jsonb;
  inactive_observation jsonb;
  recovery_action text;
  disposition text := 'CREATED';
  observed_at timestamptz;
  outcome_id uuid;
  usage_id uuid;
  latency_ms bigint;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_job_authority','USAGE') then
    raise exception using errcode = '42501',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_JOB_ROLE_REQUIRED';
  end if;
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','actor','recovery_id','intent','permit','marker',
      'recovery_capability_used','recovery_resolution','outcome','usage'
    ]::text[])
    or requested_command ->> 'schema_version' <>
      'provider-invocation-recover-stale-marker@1.0.0'
    or requested_command ->> 'actor' <> 'STALE_MARKER_RECOVERY_JOB'
    or requested_command ->> 'recovery_resolution' <> 'MARK_OUTCOME_UNKNOWN'
    or not app_data_agent.provider_json_object_has_exact_keys(candidate,array[
      'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash','status',
      'reason_code','response_artifact_ref','response_hash','delivery_certainty','transition_from',
      'recovery_action','provider_call_count','retry_after_ms','reconciliation_of'
    ]::text[])
    or candidate ->> 'schema_version' <> 'provider-invocation-outcome-candidate@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(usage_candidate,array[
      'schema_version','availability','source','input_tokens','output_tokens','total_tokens',
      'tool_calls','provider_call_count','capacity_status','unavailable_reason'
    ]::text[])
    or usage_candidate ->> 'schema_version' <> 'provider-invocation-usage-candidate@1.0.0'
    or candidate ->> 'status' <> 'OUTCOME_UNKNOWN'
    or candidate ->> 'reason_code' <> 'PROVIDER_INVOCATION_OUTCOME_UNKNOWN'
    or candidate -> 'response_artifact_ref' <> 'null'::jsonb
    or candidate -> 'response_hash' <> 'null'::jsonb
    or candidate ->> 'delivery_certainty' <> 'DISPATCHED_OUTCOME_UNKNOWN'
    or (candidate ->> 'transition_from') not in ('DISPATCH_MARKED','RESPONSE_OBSERVED')
    or candidate ->> 'provider_call_count' <> '1'
    or candidate -> 'retry_after_ms' <> 'null'::jsonb
    or candidate -> 'reconciliation_of' <> 'null'::jsonb
    or usage_candidate ->> 'availability' <> 'UNAVAILABLE'
    or usage_candidate ->> 'source' <> 'UNAVAILABLE'
    or usage_candidate -> 'input_tokens' <> 'null'::jsonb
    or usage_candidate -> 'output_tokens' <> 'null'::jsonb
    or usage_candidate -> 'total_tokens' <> 'null'::jsonb
    or usage_candidate -> 'tool_calls' <> 'null'::jsonb
    or usage_candidate ->> 'provider_call_count' <> '1'
    or usage_candidate ->> 'capacity_status' <> 'UNAVAILABLE'
    or usage_candidate ->> 'unavailable_reason' <> 'PROVIDER_INVOCATION_OUTCOME_UNKNOWN'
  then
    raise exception using errcode = '22023',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_COMMAND_INVALID';
  end if;

  recovery_action := case requested_command ->> 'recovery_capability_used'
    when 'IDEMPOTENT_REQUEST' then 'SAFE_RETRY'
    when 'INVOCATION_STATUS_QUERY' then 'STATUS_QUERY_REQUIRED'
    when 'INVOCATION_RECONCILIATION' then 'RECONCILIATION_REQUIRED'
    when 'AT_LEAST_ONCE_ONLY' then 'MANUAL_REVIEW_REQUIRED'
    else null
  end;
  if recovery_action is null or candidate ->> 'recovery_action' <> recovery_action then
    raise exception using errcode = '22023',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_CAPABILITY_INVALID';
  end if;

  select * into strict authority from platform.current_backend_authority(true);
  select intent.* into intent_record
  from app_data_agent.provider_invocation_intents intent
  where intent.app_id = authority.app_id
    and intent.tenant_id = authority.tenant_id
    and intent.environment = authority.environment
    and intent.principal_id = authority.principal_id
    and intent.intent_id = (requested_command #>> '{intent,intent_id}')::uuid
  for update;
  if not found
    or intent_record.intent_json <> requested_command -> 'intent'
    or intent_record.intent_hash <> requested_command #>> '{intent,intent_hash}'
    or candidate ->> 'intent_id' <> intent_record.intent_id::text
    or candidate ->> 'invocation_id' <> intent_record.invocation_id::text
    or candidate ->> 'run_id' <> intent_record.run_id::text
    or candidate -> 'scope' <> intent_record.intent_json #> '{invocation_spec,scope}'
    or not (intent_record.intent_json #> '{invocation_spec,certification,recovery_capabilities}'
      @> pg_catalog.jsonb_build_array(requested_command ->> 'recovery_capability_used'))
  then
    raise exception using errcode = '42501',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_INTENT_INVALID';
  end if;

  select permit.* into permit_record
  from app_data_agent.provider_invocation_dispatch_permits permit
  where permit.app_id = intent_record.app_id
    and permit.tenant_id = intent_record.tenant_id
    and permit.environment = intent_record.environment
    and permit.intent_id = intent_record.intent_id
    and permit.permit_id = (requested_command #>> '{permit,permit_id}')::uuid
  for update;
  if not found
    or permit_record.permit_json <> requested_command -> 'permit'
    or permit_record.permit_hash <> requested_command #>> '{permit,permit_hash}'
    or permit_record.invocation_id <> intent_record.invocation_id
    or permit_record.run_id <> intent_record.run_id
    or candidate ->> 'dispatch_hash' <> permit_record.dispatch_hash
  then
    raise exception using errcode = '42501',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_PERMIT_INVALID';
  end if;

  select marker.* into marker_record
  from app_data_agent.provider_invocation_outcomes marker
  where marker.app_id = intent_record.app_id
    and marker.tenant_id = intent_record.tenant_id
    and marker.environment = intent_record.environment
    and marker.intent_id = intent_record.intent_id
    and marker.outcome_id = (requested_command #>> '{marker,marker_id}')::uuid
    and marker.state = 'DISPATCH_MARKED'
  for share;
  if not found
    or marker_record.outcome_json <> requested_command -> 'marker'
    or marker_record.outcome_hash <> requested_command #>> '{marker,marker_hash}'
    or marker_record.dispatch_hash <> permit_record.dispatch_hash
    or marker_record.attempt_id <> permit_record.attempt_id
    or marker_record.worker_fence <> permit_record.worker_fence
  then
    raise exception using errcode = '42501',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_MARKER_INVALID';
  end if;
  select marker.* into response_marker_record
  from app_data_agent.provider_invocation_outcomes marker
  where marker.app_id = intent_record.app_id
    and marker.tenant_id = intent_record.tenant_id
    and marker.environment = intent_record.environment
    and marker.intent_id = intent_record.intent_id
    and marker.dispatch_hash = permit_record.dispatch_hash
    and marker.attempt_id = permit_record.attempt_id
    and marker.worker_fence = permit_record.worker_fence
    and marker.state = 'RESPONSE_OBSERVED';
  if (response_marker_record.outcome_id is null
      and candidate ->> 'transition_from' <> 'DISPATCH_MARKED')
    or (response_marker_record.outcome_id is not null
      and candidate ->> 'transition_from' <> 'RESPONSE_OBSERVED')
  then
    raise exception using errcode = '55000',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_PARENT_MISMATCH';
  end if;

  select outcome.* into existing_outcome
  from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id
    and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment
    and outcome.reconciliation_id = (requested_command ->> 'recovery_id')::uuid;
  if found then
    select usage.* into strict usage_record
    from app_data_agent.provider_invocation_usage_receipts usage
    where usage.app_id = existing_outcome.app_id
      and usage.tenant_id = existing_outcome.tenant_id
      and usage.environment = existing_outcome.environment
      and usage.outcome_id = existing_outcome.outcome_id;
    select artifact.* into strict recovery_artifact
    from app_data_agent.artifacts artifact
    where artifact.app_id = existing_outcome.app_id
      and artifact.tenant_id = existing_outcome.tenant_id
      and artifact.environment = existing_outcome.environment
      and artifact.run_id = existing_outcome.run_id
      and artifact.artifact_id = (requested_command ->> 'recovery_id')::uuid
      and artifact.artifact_type = 'ProviderStaleMarkerRecoveryReceipt'
      and artifact.revision = 1
      and artifact.content_hash = existing_outcome.evidence_hash;
    if existing_outcome.state <> 'OUTCOME_UNKNOWN'
      or existing_outcome.parent_outcome_hash <>
        coalesce(response_marker_record.outcome_hash,marker_record.outcome_hash)
      or existing_outcome.outcome_json -> 'candidate' <> candidate
      or usage_record.usage_json - array[
        'schema_version','usage_receipt_id','outcome_id','intent_id','invocation_id',
        'scope','run_id','observed_at','usage_hash'
      ]::text[] <> usage_candidate - 'schema_version'
      or recovery_artifact.document_json ->> 'content_hash' <> recovery_artifact.content_hash
      or recovery_artifact.content_hash <>
        app_data_agent.u2_canonical_sha256(recovery_artifact.document_json - 'content_hash')
    then
      raise exception using errcode = '23505',
        message = 'PROVIDER_STALE_MARKER_RECOVERY_CONFLICT';
    end if;
    disposition := 'REPLAYED';
    outcome_document := existing_outcome.outcome_json;
    usage_document := usage_record.usage_json;
    receipt_document := recovery_artifact.document_json;
  else
    if exists (
      select 1 from app_data_agent.provider_invocation_outcomes outcome
      where outcome.app_id = intent_record.app_id
        and outcome.tenant_id = intent_record.tenant_id
        and outcome.environment = intent_record.environment
        and outcome.intent_id = intent_record.intent_id
        and outcome.state in ('COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN')
    ) then
      raise exception using errcode = '55000',
        message = 'PROVIDER_INVOCATION_ALREADY_TERMINAL';
    end if;

    select attempt.* into strict attempt_record
    from app_data_agent.run_attempts attempt
    where attempt.app_id = permit_record.app_id
      and attempt.tenant_id = permit_record.tenant_id
      and attempt.environment = permit_record.environment
      and attempt.run_id = permit_record.run_id
      and attempt.attempt_id = permit_record.attempt_id
      and attempt.outbox_id = permit_record.outbox_id
      and attempt.command_id = permit_record.command_id
    for update;
    select message.* into strict outbox_record
    from app_data_agent.outbox message
    where message.app_id = permit_record.app_id
      and message.tenant_id = permit_record.tenant_id
      and message.environment = permit_record.environment
      and message.run_id = permit_record.run_id
      and message.outbox_id = permit_record.outbox_id
      and message.command_id = permit_record.command_id
    for update;
    observed_at := pg_catalog.clock_timestamp();
    if attempt_record.status = 'ACTIVE'
      and attempt_record.worker_id = permit_record.worker_id
      and attempt_record.lease_token = permit_record.lease_token
      and attempt_record.worker_fence = permit_record.worker_fence
      and attempt_record.lease_expires_at > observed_at
      and outbox_record.status = 'LEASED'
      and outbox_record.active_attempt_id = permit_record.attempt_id
      and outbox_record.lease_owner = permit_record.worker_id
      and outbox_record.lease_token = permit_record.lease_token
      and outbox_record.run_fence = permit_record.worker_fence
      and outbox_record.lease_expires_at > observed_at
    then
      raise exception using errcode = '40001',
        message = 'PROVIDER_STALE_MARKER_LEASE_STILL_ACTIVE';
    end if;

    inactive_observation := pg_catalog.jsonb_build_object(
      'permit_id',permit_record.permit_id,'permit_hash',permit_record.permit_hash,
      'old_attempt_id',permit_record.attempt_id,'old_worker_fence',permit_record.worker_fence,
      'lease_status','INACTIVE','observed_at',app_data_agent.runtime_iso_timestamp(observed_at));
    receipt_document := pg_catalog.jsonb_build_object(
      'schema_version','provider-stale-marker-recovery-receipt@1.0.0',
      'recovery_id',(requested_command ->> 'recovery_id')::uuid,
      'actor','STALE_MARKER_RECOVERY_JOB','intent_id',intent_record.intent_id,
      'intent_hash',intent_record.intent_hash,'invocation_id',intent_record.invocation_id,
      'scope',intent_record.intent_json #> '{invocation_spec,scope}','run_id',intent_record.run_id,
      'permit_id',permit_record.permit_id,'permit_hash',permit_record.permit_hash,
      'marker_id',marker_record.outcome_id,'marker_hash',marker_record.outcome_hash,
      'old_attempt_id',permit_record.attempt_id,'old_worker_fence',permit_record.worker_fence,
      'recovery_capability_used',requested_command ->> 'recovery_capability_used',
      'recovery_action',recovery_action,'lease_status','INACTIVE',
      'inactive_observed_at',app_data_agent.runtime_iso_timestamp(observed_at),
      'inactive_observation_hash',app_data_agent.u2_canonical_sha256(inactive_observation),
      'recovered_at',app_data_agent.runtime_iso_timestamp(observed_at));
    receipt_document := receipt_document || pg_catalog.jsonb_build_object(
      'content_hash',app_data_agent.u2_canonical_sha256(receipt_document));
    insert into app_data_agent.artifacts (
      app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
      document_json,worker_fence,is_active,parent_revision,parent_content_hash,created_at
    ) values (
      intent_record.app_id,intent_record.tenant_id,intent_record.environment,intent_record.run_id,
      (requested_command ->> 'recovery_id')::uuid,'ProviderStaleMarkerRecoveryReceipt',1,
      receipt_document ->> 'content_hash',receipt_document,0,true,null,null,observed_at
    ) returning * into recovery_artifact;

    outcome_id := pg_catalog.gen_random_uuid();
    usage_id := pg_catalog.gen_random_uuid();
    latency_ms := greatest(0::bigint,pg_catalog.floor(
      extract(epoch from observed_at - marker_record.started_at) * 1000)::bigint);
    outcome_document := pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-outcome@1.0.0','outcome_id',outcome_id,
      'candidate',candidate,
      'dispatch_marked_at',app_data_agent.runtime_iso_timestamp(marker_record.started_at),
      'terminal_at',app_data_agent.runtime_iso_timestamp(observed_at),'latency_ms',latency_ms);
    outcome_document := outcome_document || pg_catalog.jsonb_build_object(
      'outcome_hash',app_data_agent.u2_canonical_sha256(outcome_document));
    usage_document := (usage_candidate - 'schema_version') || pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-usage@1.0.0','usage_receipt_id',usage_id,
      'outcome_id',outcome_id,'intent_id',intent_record.intent_id,
      'invocation_id',intent_record.invocation_id,
      'scope',intent_record.intent_json #> '{invocation_spec,scope}','run_id',intent_record.run_id,
      'observed_at',app_data_agent.runtime_iso_timestamp(observed_at));
    usage_document := usage_document || pg_catalog.jsonb_build_object(
      'usage_hash',app_data_agent.u2_canonical_sha256(usage_document));

    insert into app_data_agent.provider_invocation_outcomes (
      app_id,tenant_id,environment,outcome_id,intent_id,invocation_id,run_id,dispatch_hash,
      transition_revision,parent_transition_revision,parent_outcome_hash,state,actor_kind,
      transition_from,recovery_action,dispatch_attempt_no,attempt_id,outbox_id,command_id,worker_id,
      lease_token,worker_fence,dispatch_marked,provider_call_may_have_started,
      response_artifact_id,response_artifact_type,response_artifact_revision,
      response_artifact_content_hash,response_hash,evidence_run_id,evidence_artifact_id,
      evidence_artifact_type,evidence_artifact_revision,evidence_hash,reason_code,provider_call_count,
      retry_after_ms,delivery_certainty,started_at,terminal_at,latency_ms,reconciliation_id,
      recovery_capability_used,reconciliation_of,outcome_json,outcome_hash,committed_at
    ) values (
      intent_record.app_id,intent_record.tenant_id,intent_record.environment,outcome_id,
      intent_record.intent_id,intent_record.invocation_id,intent_record.run_id,permit_record.dispatch_hash,
      coalesce(response_marker_record.transition_revision,marker_record.transition_revision) + 1,
      coalesce(response_marker_record.transition_revision,marker_record.transition_revision),
      coalesce(response_marker_record.outcome_hash,marker_record.outcome_hash),
      'OUTCOME_UNKNOWN','RECONCILER',candidate ->> 'transition_from',recovery_action,
      permit_record.attempt_no,permit_record.attempt_id,permit_record.outbox_id,
      permit_record.command_id,permit_record.worker_id,permit_record.lease_token,
      permit_record.worker_fence,true,true,null,null,null,null,null,
      recovery_artifact.run_id,recovery_artifact.artifact_id,recovery_artifact.artifact_type,
      recovery_artifact.revision,recovery_artifact.content_hash,
      'PROVIDER_INVOCATION_OUTCOME_UNKNOWN',1,null,'DISPATCHED_OUTCOME_UNKNOWN',
      marker_record.started_at,observed_at,latency_ms,(requested_command ->> 'recovery_id')::uuid,
      requested_command ->> 'recovery_capability_used',null,outcome_document,
      outcome_document ->> 'outcome_hash',observed_at);
    insert into app_data_agent.provider_invocation_usage_receipts (
      app_id,tenant_id,environment,usage_receipt_id,intent_id,invocation_id,outcome_id,
      outcome_transition_revision,outcome_hash,availability,token_source,input_tokens,output_tokens,
      total_tokens,tool_calls,provider_call_count,capacity_status,unavailable_reason,usage_json,usage_hash,
      observed_at,committed_at
    ) values (
      intent_record.app_id,intent_record.tenant_id,intent_record.environment,usage_id,
      intent_record.intent_id,intent_record.invocation_id,outcome_id,
      coalesce(response_marker_record.transition_revision,marker_record.transition_revision) + 1,
      outcome_document ->> 'outcome_hash','UNAVAILABLE','UNAVAILABLE',null,null,null,null,1,
      'UNAVAILABLE','PROVIDER_INVOCATION_OUTCOME_UNKNOWN',usage_document,
      usage_document ->> 'usage_hash',observed_at,observed_at);
  end if;

  receipt_reference := pg_catalog.jsonb_build_object(
    'artifact_id',recovery_artifact.artifact_id,
    'artifact_type','ProviderStaleMarkerRecoveryReceipt',
    'app_id',recovery_artifact.app_id,'tenant_id',recovery_artifact.tenant_id,
    'environment',recovery_artifact.environment,'run_id',recovery_artifact.run_id,
    'revision',recovery_artifact.revision,'content_hash',recovery_artifact.content_hash);
  projection_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-public@1.0.0','invocation_id',intent_record.invocation_id,
    'run_id',intent_record.run_id,'provider',intent_record.provider,
    'model_profile_id',intent_record.model_profile_id,
    'model_config_version',intent_record.model_config_version,
    'profile_version',intent_record.profile_version,'model_id',intent_record.model_id,
    'certification_receipt_ref',pg_catalog.jsonb_build_object(
      'artifact_id',intent_record.certification_artifact_id,
      'artifact_type','ModelCertificationReceipt','app_id',intent_record.app_id,
      'tenant_id',intent_record.tenant_id,'environment',intent_record.environment,
      'run_id',intent_record.certification_run_id,'revision',intent_record.certification_revision,
      'content_hash',intent_record.certification_hash),
    'attempt_id',permit_record.attempt_id,'attempt_no',permit_record.attempt_no,
    'recovery_action',outcome_document #> '{candidate,recovery_action}',
    'status','OUTCOME_UNKNOWN','reason_code','PROVIDER_INVOCATION_OUTCOME_UNKNOWN',
    'dispatch_hash',permit_record.dispatch_hash,'response_hash',null,
    'usage_availability','UNAVAILABLE','usage_source','UNAVAILABLE',
    'input_tokens',null,'output_tokens',null,'total_tokens',null,'tool_calls',null,
    'provider_call_count',1,'retry_after_ms',null,
    'latency_ms',outcome_document -> 'latency_ms',
    'receipt_deep_link','/w/' || intent_record.workspace_id::text || '/runs/' ||
      intent_record.run_id::text || '/provider-invocations/' || intent_record.invocation_id::text,
    'terminal_at',outcome_document -> 'terminal_at');
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-recover-stale-marker-result@1.0.0',
    'disposition',disposition,'recovery_receipt_ref',receipt_reference,
    'recovery_receipt',receipt_document,'intent',intent_record.intent_json,
    'permit',permit_record.permit_json,'marker',marker_record.outcome_json,
    'outcome',outcome_document,'usage',usage_document,'projection',projection_document);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023',
    message = 'PROVIDER_STALE_MARKER_RECOVERY_COMMAND_INVALID';
end
$function$;

create function app_data_agent.recover_next_stale_provider_invocation_marker()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  response_marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  recovery_id uuid;
  recovery_capability text;
  recovery_action text;
  candidate jsonb;
  usage_candidate jsonb;
  command jsonb;
  result jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_job_authority','USAGE') then
    raise exception using errcode = '42501',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_JOB_ROLE_REQUIRED';
  end if;
  select * into strict authority from platform.current_backend_authority(true);

  select marker.*
  into marker_record
  from app_data_agent.provider_invocation_outcomes marker
  join app_data_agent.provider_invocation_intents intent
    on intent.app_id = marker.app_id
   and intent.tenant_id = marker.tenant_id
   and intent.environment = marker.environment
   and intent.intent_id = marker.intent_id
   and intent.invocation_id = marker.invocation_id
  join app_data_agent.provider_invocation_dispatch_permits permit
    on permit.app_id = marker.app_id
   and permit.tenant_id = marker.tenant_id
   and permit.environment = marker.environment
   and permit.intent_id = marker.intent_id
   and permit.invocation_id = marker.invocation_id
   and permit.run_id = marker.run_id
   and permit.dispatch_hash = marker.dispatch_hash
   and permit.attempt_id = marker.attempt_id
   and permit.outbox_id = marker.outbox_id
   and permit.command_id = marker.command_id
   and permit.worker_id = marker.worker_id
   and permit.lease_token = marker.lease_token
   and permit.worker_fence = marker.worker_fence
  join app_data_agent.run_attempts attempt
    on attempt.app_id = permit.app_id
   and attempt.tenant_id = permit.tenant_id
   and attempt.environment = permit.environment
   and attempt.run_id = permit.run_id
   and attempt.attempt_id = permit.attempt_id
   and attempt.outbox_id = permit.outbox_id
   and attempt.command_id = permit.command_id
  join app_data_agent.outbox message
    on message.app_id = permit.app_id
   and message.tenant_id = permit.tenant_id
   and message.environment = permit.environment
   and message.run_id = permit.run_id
   and message.outbox_id = permit.outbox_id
   and message.command_id = permit.command_id
  where marker.app_id = authority.app_id
    and marker.tenant_id = authority.tenant_id
    and marker.environment = authority.environment
    and intent.principal_id = authority.principal_id
    and marker.state = 'DISPATCH_MARKED'
    and not exists (
      select 1
      from app_data_agent.provider_invocation_outcomes later
      where later.app_id = marker.app_id
        and later.tenant_id = marker.tenant_id
        and later.environment = marker.environment
        and later.intent_id = marker.intent_id
        and later.state in ('COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN')
    )
    and not (
      attempt.status = 'ACTIVE'
      and attempt.worker_id = permit.worker_id
      and attempt.lease_token = permit.lease_token
      and attempt.worker_fence = permit.worker_fence
      and attempt.lease_expires_at > pg_catalog.clock_timestamp()
      and message.status = 'LEASED'
      and message.active_attempt_id = permit.attempt_id
      and message.lease_owner = permit.worker_id
      and message.lease_token = permit.lease_token
      and message.run_fence = permit.worker_fence
      and message.lease_expires_at > pg_catalog.clock_timestamp()
    )
  order by marker.committed_at,marker.outcome_id
  for update of marker skip locked
  limit 1;

  if not found then
    return null;
  end if;

  select intent.* into strict intent_record
  from app_data_agent.provider_invocation_intents intent
  where intent.app_id = marker_record.app_id
    and intent.tenant_id = marker_record.tenant_id
    and intent.environment = marker_record.environment
    and intent.intent_id = marker_record.intent_id
    and intent.invocation_id = marker_record.invocation_id;
  select permit.* into strict permit_record
  from app_data_agent.provider_invocation_dispatch_permits permit
  where permit.app_id = marker_record.app_id
    and permit.tenant_id = marker_record.tenant_id
    and permit.environment = marker_record.environment
    and permit.intent_id = marker_record.intent_id
    and permit.invocation_id = marker_record.invocation_id
    and permit.run_id = marker_record.run_id
    and permit.dispatch_hash = marker_record.dispatch_hash
    and permit.attempt_id = marker_record.attempt_id
    and permit.worker_fence = marker_record.worker_fence;
  select marker.* into response_marker_record
  from app_data_agent.provider_invocation_outcomes marker
  where marker.app_id = marker_record.app_id
    and marker.tenant_id = marker_record.tenant_id
    and marker.environment = marker_record.environment
    and marker.intent_id = marker_record.intent_id
    and marker.dispatch_hash = marker_record.dispatch_hash
    and marker.attempt_id = marker_record.attempt_id
    and marker.worker_fence = marker_record.worker_fence
    and marker.state = 'RESPONSE_OBSERVED'
  for share;

  recovery_capability := case
    when intent_record.recovery_capabilities @> array['IDEMPOTENT_REQUEST']::text[]
      then 'IDEMPOTENT_REQUEST'
    when intent_record.recovery_capabilities @> array['INVOCATION_STATUS_QUERY']::text[]
      then 'INVOCATION_STATUS_QUERY'
    when intent_record.recovery_capabilities @> array['INVOCATION_RECONCILIATION']::text[]
      then 'INVOCATION_RECONCILIATION'
    when intent_record.recovery_capabilities = array['AT_LEAST_ONCE_ONLY']::text[]
      then 'AT_LEAST_ONCE_ONLY'
    else null
  end;
  recovery_action := case recovery_capability
    when 'IDEMPOTENT_REQUEST' then 'SAFE_RETRY'
    when 'INVOCATION_STATUS_QUERY' then 'STATUS_QUERY_REQUIRED'
    when 'INVOCATION_RECONCILIATION' then 'RECONCILIATION_REQUIRED'
    when 'AT_LEAST_ONCE_ONLY' then 'MANUAL_REVIEW_REQUIRED'
    else null
  end;
  if recovery_action is null then
    raise exception using errcode = 'P0001',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_CAPABILITY_INVALID';
  end if;

  recovery_id := pg_catalog.gen_random_uuid();
  candidate := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-outcome-candidate@1.0.0',
    'intent_id',intent_record.intent_id,'invocation_id',intent_record.invocation_id,
    'scope',intent_record.intent_json #> '{invocation_spec,scope}',
    'run_id',intent_record.run_id,'dispatch_hash',permit_record.dispatch_hash,
    'status','OUTCOME_UNKNOWN','reason_code','PROVIDER_INVOCATION_OUTCOME_UNKNOWN',
    'response_artifact_ref',null,'response_hash',null,
    'delivery_certainty','DISPATCHED_OUTCOME_UNKNOWN','transition_from',case
      when response_marker_record.outcome_id is null then 'DISPATCH_MARKED'
      else 'RESPONSE_OBSERVED' end,
    'recovery_action',recovery_action,'provider_call_count',1,
    'retry_after_ms',null,'reconciliation_of',null);
  usage_candidate := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-usage-candidate@1.0.0',
    'availability','UNAVAILABLE','source','UNAVAILABLE','input_tokens',null,
    'output_tokens',null,'total_tokens',null,'tool_calls',null,'provider_call_count',1,
    'capacity_status','UNAVAILABLE',
    'unavailable_reason','PROVIDER_INVOCATION_OUTCOME_UNKNOWN');
  command := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-recover-stale-marker@1.0.0',
    'actor','STALE_MARKER_RECOVERY_JOB','recovery_id',recovery_id,
    'intent',intent_record.intent_json,'permit',permit_record.permit_json,
    'marker',marker_record.outcome_json,'recovery_capability_used',recovery_capability,
    'recovery_resolution','MARK_OUTCOME_UNKNOWN','outcome',candidate,'usage',usage_candidate);
  result := app_data_agent.recover_stale_provider_invocation_marker(command);
  if result ->> 'schema_version' <>
      'provider-invocation-recover-stale-marker-result@1.0.0'
    or result ->> 'disposition' <> 'CREATED'
    or result #>> '{recovery_receipt,recovery_id}' <> recovery_id::text
    or result -> 'intent' <> intent_record.intent_json
    or result -> 'permit' <> permit_record.permit_json
    or result -> 'marker' <> marker_record.outcome_json
    or result #>> '{outcome,candidate,status}' <> 'OUTCOME_UNKNOWN'
    or result #>> '{usage,availability}' <> 'UNAVAILABLE'
  then
    raise exception using errcode = 'P0001',
      message = 'PROVIDER_STALE_MARKER_RECOVERY_RESULT_CLOSURE_INVALID';
  end if;
  return result;
end
$function$;

create function app_data_agent.claim_provider_invocation_smoke_work(
  requested_worker_id text,
  requested_lease_duration_ms integer,
  expected_run_id uuid,
  expected_command_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  candidate record;
  claimed_at timestamptz;
  next_attempt_id uuid;
  next_attempt_no integer;
  next_lease_token bigint;
  next_worker_fence bigint;
  next_expires_at timestamptz;
  intent_count integer;
  permit_count integer;
  marker_count integer;
  outcome_count integer;
  usage_count integer;
  response_artifact_count integer;
  precondition jsonb;
  lease_document jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_job_authority','USAGE') then
    raise exception using errcode = '42501',
      message = 'PROVIDER_SMOKE_JOB_ROLE_REQUIRED';
  end if;
  if requested_worker_id is null
    or requested_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or requested_lease_duration_ms not between 5000 and 900000
    or expected_run_id is null
    or expected_command_id is null
  then
    raise exception using errcode = '22023', message = 'PROVIDER_SMOKE_CLAIM_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(true);
  claimed_at := pg_catalog.clock_timestamp();

  select message.*,run.active_fence,run.principal_id,
    command.payload_json as command_payload,
    command.payload_json ->> 'kind' as resolved_command_kind
  into candidate
  from app_data_agent.outbox message
  join app_data_agent.runs run
    on run.app_id = message.app_id
   and run.tenant_id = message.tenant_id
   and run.environment = message.environment
   and run.run_id = message.run_id
  join app_data_agent.commands command
    on command.app_id = message.app_id
   and command.tenant_id = message.tenant_id
   and command.environment = message.environment
   and command.run_id = message.run_id
   and command.command_id = message.command_id
  where message.app_id = authority.app_id
    and message.tenant_id = authority.tenant_id
    and message.environment = authority.environment
    and message.run_id = expected_run_id
    and message.command_id = expected_command_id
    and message.topic = 'run.command.accepted'
    and message.status in ('PENDING','FAILED')
    and message.attempt_count = 0
    and message.claimable_at <= claimed_at
    and run.principal_id = authority.principal_id
    and run.status = 'QUEUED'
    and command.status = 'ACCEPTED'
    and app_data_agent.provider_json_object_has_exact_keys(
      command.payload_json,array['kind','effective_config_ref']::text[])
    and command.payload_json ->> 'kind' = 'START_L2_RESEARCH'
    and app_data_agent.provider_json_object_has_exact_keys(
      command.payload_json -> 'effective_config_ref',
      array['config_id','config_revision','config_hash']::text[])
    and not exists (
      select 1 from app_data_agent.outbox earlier
      where earlier.app_id = message.app_id
        and earlier.tenant_id = message.tenant_id
        and earlier.environment = message.environment
        and earlier.run_id = message.run_id
        and earlier.topic in ('run.command.accepted','run.work.resume')
        and earlier.status in ('PENDING','FAILED','LEASED')
        and earlier.queue_sequence < message.queue_sequence)
  for update of message,run,command skip locked;
  if not found then
    return null;
  end if;

  select pg_catalog.count(*)::integer into intent_count
  from app_data_agent.provider_invocation_intents intent
  where intent.app_id = authority.app_id
    and intent.tenant_id = authority.tenant_id
    and intent.environment = authority.environment
    and intent.run_id = expected_run_id
    and intent.logical_call_id = expected_command_id;
  select pg_catalog.count(*)::integer into permit_count
  from app_data_agent.provider_invocation_dispatch_permits permit
  join app_data_agent.provider_invocation_intents intent
    on intent.app_id = permit.app_id and intent.tenant_id = permit.tenant_id
   and intent.environment = permit.environment and intent.intent_id = permit.intent_id
  where intent.run_id = expected_run_id and intent.logical_call_id = expected_command_id;
  select pg_catalog.count(*) filter (where outcome.state = 'DISPATCH_MARKED')::integer,
    pg_catalog.count(*) filter (where outcome.state <> 'DISPATCH_MARKED')::integer
  into marker_count,outcome_count
  from app_data_agent.provider_invocation_outcomes outcome
  join app_data_agent.provider_invocation_intents intent
    on intent.app_id = outcome.app_id and intent.tenant_id = outcome.tenant_id
   and intent.environment = outcome.environment and intent.intent_id = outcome.intent_id
  where intent.run_id = expected_run_id and intent.logical_call_id = expected_command_id;
  select pg_catalog.count(*)::integer into usage_count
  from app_data_agent.provider_invocation_usage_receipts usage
  join app_data_agent.provider_invocation_intents intent
    on intent.app_id = usage.app_id and intent.tenant_id = usage.tenant_id
   and intent.environment = usage.environment and intent.intent_id = usage.intent_id
  where intent.run_id = expected_run_id and intent.logical_call_id = expected_command_id;
  select pg_catalog.count(*)::integer into response_artifact_count
  from app_data_agent.artifacts artifact
  where artifact.app_id = authority.app_id
    and artifact.tenant_id = authority.tenant_id
    and artifact.environment = authority.environment
    and artifact.run_id = expected_run_id
    and artifact.artifact_type = 'ProviderResponseArtifact'
    and artifact.document_json ->> 'invocation_id' = expected_command_id::text;
  precondition := pg_catalog.jsonb_build_object(
    'run_id',expected_run_id,'command_id',expected_command_id,
    'logical_invocation_id',expected_command_id,
    'intent_count',intent_count,'permit_count',permit_count,'marker_count',marker_count,
    'outcome_count',outcome_count,'usage_count',usage_count,
    'response_artifact_count',response_artifact_count);
  if intent_count <> 0 or permit_count <> 0 or marker_count <> 0
    or outcome_count <> 0 or usage_count <> 0 or response_artifact_count <> 0
  then
    raise exception using errcode = '55000',
      message = 'PROVIDER_SMOKE_PRECONDITION_NOT_EMPTY';
  end if;

  select coalesce(pg_catalog.max(attempt.attempt_no),0)::integer + 1
  into next_attempt_no
  from app_data_agent.run_attempts attempt
  where attempt.app_id = authority.app_id
    and attempt.tenant_id = authority.tenant_id
    and attempt.environment = authority.environment
    and attempt.run_id = expected_run_id;
  next_attempt_id := pg_catalog.gen_random_uuid();
  next_lease_token := candidate.lease_token + 1;
  next_worker_fence := candidate.active_fence + 1;
  next_expires_at := claimed_at +
    (requested_lease_duration_ms * interval '1 millisecond');

  update app_data_agent.runs run
  set status = 'RUNNING',active_fence = next_worker_fence,updated_at = claimed_at
  where run.app_id = authority.app_id and run.tenant_id = authority.tenant_id
    and run.environment = authority.environment and run.run_id = expected_run_id
    and run.principal_id = authority.principal_id
    and run.status = 'QUEUED' and run.active_fence = candidate.active_fence;
  if not found then
    raise exception using errcode = '40001', message = 'PROVIDER_SMOKE_CLAIM_CONFLICT';
  end if;
  insert into app_data_agent.run_attempts (
    app_id,tenant_id,environment,run_id,outbox_id,command_id,attempt_id,attempt_no,
    worker_id,lease_token,worker_fence,lease_expires_at,last_heartbeat_at,started_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,expected_run_id,
    candidate.outbox_id,expected_command_id,next_attempt_id,next_attempt_no,
    requested_worker_id,next_lease_token,next_worker_fence,next_expires_at,claimed_at,claimed_at);
  update app_data_agent.outbox message
  set status = 'LEASED',attempt_count = 1,lease_owner = requested_worker_id,
    lease_token = next_lease_token,lease_expires_at = next_expires_at,published_at = null,
    active_attempt_id = next_attempt_id,run_fence = next_worker_fence,
    last_heartbeat_at = claimed_at
  where message.app_id = authority.app_id and message.tenant_id = authority.tenant_id
    and message.environment = authority.environment and message.outbox_id = candidate.outbox_id
    and message.run_id = expected_run_id and message.command_id = expected_command_id
    and message.status in ('PENDING','FAILED') and message.attempt_count = 0;
  if not found then
    raise exception using errcode = '40001', message = 'PROVIDER_SMOKE_CLAIM_CONFLICT';
  end if;
  update app_data_agent.commands command
  set status = 'PROCESSING'
  where command.app_id = authority.app_id and command.tenant_id = authority.tenant_id
    and command.environment = authority.environment and command.run_id = expected_run_id
    and command.command_id = expected_command_id and command.status = 'ACCEPTED';
  if not found then
    raise exception using errcode = '40001', message = 'PROVIDER_SMOKE_CLAIM_CONFLICT';
  end if;

  lease_document := pg_catalog.jsonb_build_object(
    'scope',pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment),
    'principal_id',authority.principal_id,'outbox_id',candidate.outbox_id,
    'run_id',expected_run_id,'command_id',expected_command_id,
    'command_kind',candidate.resolved_command_kind,'attempt_id',next_attempt_id,
    'attempt_no',next_attempt_no,'delivery_attempt_no',1,
    'lease_duration_ms',requested_lease_duration_ms,'worker_id',requested_worker_id,
    'lease_token',next_lease_token,'worker_fence',next_worker_fence,
    'expires_at',app_data_agent.runtime_iso_timestamp(next_expires_at),
    'payload',candidate.command_payload);
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-smoke-claim@1.0.0',
    'lease',lease_document,'precondition',precondition);
end
$function$;

create function app_data_agent.verify_provider_invocation_smoke_completion(
  requested_run_id uuid,
  requested_command_id uuid,
  requested_attempt_id uuid,
  expected_worker_fence bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  authority record;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  response_marker_record app_data_agent.provider_invocation_outcomes%rowtype;
  outcome_record app_data_agent.provider_invocation_outcomes%rowtype;
  usage_record app_data_agent.provider_invocation_usage_receipts%rowtype;
  artifact_record app_data_agent.artifacts%rowtype;
  intent_count integer;
  permit_count integer;
  marker_count integer;
  response_marker_count integer;
  outcome_count integer;
  usage_count integer;
  response_artifact_count integer;
  response_reference jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_job_authority','USAGE') then
    raise exception using errcode = '42501', message = 'PROVIDER_SMOKE_JOB_ROLE_REQUIRED';
  end if;
  if requested_run_id is null or requested_command_id is null
    or requested_attempt_id is null or expected_worker_fence < 1
  then
    raise exception using errcode = '22023', message = 'PROVIDER_SMOKE_PROOF_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(false);

  select pg_catalog.count(*)::integer into intent_count
  from app_data_agent.provider_invocation_intents intent
  where intent.app_id = authority.app_id and intent.tenant_id = authority.tenant_id
    and intent.environment = authority.environment and intent.principal_id = authority.principal_id
    and intent.run_id = requested_run_id and intent.logical_call_id = requested_command_id;
  if intent_count = 1 then
    select intent.* into strict intent_record
    from app_data_agent.provider_invocation_intents intent
    where intent.app_id = authority.app_id and intent.tenant_id = authority.tenant_id
      and intent.environment = authority.environment and intent.principal_id = authority.principal_id
      and intent.run_id = requested_run_id and intent.logical_call_id = requested_command_id;
  end if;
  select pg_catalog.count(*)::integer into permit_count
  from app_data_agent.provider_invocation_dispatch_permits permit
  where permit.app_id = authority.app_id and permit.tenant_id = authority.tenant_id
    and permit.environment = authority.environment
    and permit.intent_id = intent_record.intent_id;
  if permit_count = 1 then
    select permit.* into strict permit_record
    from app_data_agent.provider_invocation_dispatch_permits permit
    where permit.app_id = authority.app_id and permit.tenant_id = authority.tenant_id
      and permit.environment = authority.environment and permit.intent_id = intent_record.intent_id;
  end if;
  select pg_catalog.count(*) filter (where outcome.state = 'DISPATCH_MARKED')::integer,
    pg_catalog.count(*) filter (where outcome.state = 'RESPONSE_OBSERVED')::integer,
    pg_catalog.count(*) filter (where outcome.state in (
      'COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN'
    ))::integer
  into marker_count,response_marker_count,outcome_count
  from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = authority.app_id and outcome.tenant_id = authority.tenant_id
    and outcome.environment = authority.environment and outcome.intent_id = intent_record.intent_id;
  if marker_count = 1 then
    select outcome.* into strict marker_record
    from app_data_agent.provider_invocation_outcomes outcome
    where outcome.app_id = authority.app_id and outcome.tenant_id = authority.tenant_id
      and outcome.environment = authority.environment and outcome.intent_id = intent_record.intent_id
      and outcome.state = 'DISPATCH_MARKED';
  end if;
  if response_marker_count = 1 then
    select outcome.* into strict response_marker_record
    from app_data_agent.provider_invocation_outcomes outcome
    where outcome.app_id = authority.app_id and outcome.tenant_id = authority.tenant_id
      and outcome.environment = authority.environment and outcome.intent_id = intent_record.intent_id
      and outcome.state = 'RESPONSE_OBSERVED';
  end if;
  if outcome_count = 1 then
    select outcome.* into strict outcome_record
    from app_data_agent.provider_invocation_outcomes outcome
    where outcome.app_id = authority.app_id and outcome.tenant_id = authority.tenant_id
      and outcome.environment = authority.environment and outcome.intent_id = intent_record.intent_id
      and outcome.state in ('COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN');
  end if;
  select pg_catalog.count(*)::integer into usage_count
  from app_data_agent.provider_invocation_usage_receipts usage
  where usage.app_id = authority.app_id and usage.tenant_id = authority.tenant_id
    and usage.environment = authority.environment and usage.intent_id = intent_record.intent_id;
  if usage_count = 1 then
    select usage.* into strict usage_record
    from app_data_agent.provider_invocation_usage_receipts usage
    where usage.app_id = authority.app_id and usage.tenant_id = authority.tenant_id
      and usage.environment = authority.environment and usage.intent_id = intent_record.intent_id;
  end if;
  select pg_catalog.count(*)::integer into response_artifact_count
  from app_data_agent.artifacts artifact
  where artifact.app_id = authority.app_id and artifact.tenant_id = authority.tenant_id
    and artifact.environment = authority.environment and artifact.run_id = requested_run_id
    and artifact.artifact_type = 'ProviderResponseArtifact'
    and artifact.artifact_id = outcome_record.response_artifact_id
    and artifact.revision = outcome_record.response_artifact_revision
    and artifact.content_hash = outcome_record.response_artifact_content_hash
    and artifact.is_active;
  if response_artifact_count = 1 then
    select artifact.* into strict artifact_record
    from app_data_agent.artifacts artifact
    where artifact.app_id = authority.app_id and artifact.tenant_id = authority.tenant_id
      and artifact.environment = authority.environment and artifact.run_id = requested_run_id
      and artifact.artifact_type = 'ProviderResponseArtifact'
      and artifact.artifact_id = outcome_record.response_artifact_id
      and artifact.revision = outcome_record.response_artifact_revision
      and artifact.content_hash = outcome_record.response_artifact_content_hash
      and artifact.is_active;
    response_reference := pg_catalog.jsonb_build_object(
      'artifact_id',artifact_record.artifact_id,'artifact_type','ProviderResponseArtifact',
      'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
      'environment',artifact_record.environment,'run_id',artifact_record.run_id,
      'revision',artifact_record.revision,'content_hash',artifact_record.content_hash);
  end if;

  if intent_count <> 1 or permit_count <> 1 or marker_count <> 1
    or response_marker_count <> 1
    or outcome_count <> 1 or usage_count <> 1 or response_artifact_count <> 1
    or intent_record.invocation_id <> requested_command_id
    or intent_record.provider <> 'deepseek' or intent_record.model_id <> 'deepseek-v4-flash'
    or permit_record.attempt_id <> requested_attempt_id
    or permit_record.worker_fence <> expected_worker_fence
    or permit_record.run_id <> requested_run_id
    or marker_record.dispatch_hash <> permit_record.dispatch_hash
    or marker_record.attempt_id <> requested_attempt_id
    or marker_record.worker_fence <> expected_worker_fence
    or marker_record.provider_call_count <> 1
    or response_marker_record.parent_outcome_hash <> marker_record.outcome_hash
    or response_marker_record.outcome_json ->> 'attempt_id' <> requested_attempt_id::text
    or response_marker_record.outcome_json ->> 'worker_fence' <> expected_worker_fence::text
    or response_marker_record.observation_kind <> 'COMPLETED'
    or response_marker_record.outcome_json ->> 'response_hash' <> outcome_record.response_hash
    or outcome_record.parent_outcome_hash <> response_marker_record.outcome_hash
    or outcome_record.transition_from <> 'RESPONSE_OBSERVED'
    or outcome_record.state <> 'COMPLETED'
    or outcome_record.dispatch_hash <> permit_record.dispatch_hash
    or outcome_record.attempt_id <> requested_attempt_id
    or outcome_record.worker_fence <> expected_worker_fence
    or outcome_record.provider_call_count <> 1
    or usage_record.outcome_id <> outcome_record.outcome_id
    or usage_record.outcome_hash <> outcome_record.outcome_hash
    or usage_record.provider_call_count <> 1
    or usage_record.availability not in ('AVAILABLE','UNAVAILABLE')
    or artifact_record.document_json ->> 'invocation_id' <> intent_record.invocation_id::text
    or artifact_record.document_json ->> 'response_hash' <> outcome_record.response_hash
    or artifact_record.content_hash <>
      app_data_agent.u2_canonical_sha256(artifact_record.document_json - 'content_hash')
    or outcome_record.outcome_json #> '{candidate,response_artifact_ref}' <>
      response_reference
  then
    raise exception using errcode = '55000', message = 'PROVIDER_SMOKE_PROOF_NOT_READY';
  end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-smoke-proof@1.0.0',
    'run_id',requested_run_id,'command_id',requested_command_id,
    'logical_invocation_id',requested_command_id,'provider','deepseek',
    'model_id','deepseek-v4-flash','intent_id',intent_record.intent_id,
    'intent_hash',intent_record.intent_hash,'permit_id',permit_record.permit_id,
    'permit_hash',permit_record.permit_hash,'marker_id',marker_record.outcome_id,
    'marker_hash',marker_record.outcome_hash,'outcome_id',outcome_record.outcome_id,
    'outcome_hash',outcome_record.outcome_hash,'outcome_status','COMPLETED',
    'usage_receipt_id',usage_record.usage_receipt_id,
    'usage_receipt_hash',usage_record.usage_hash,
    'usage_availability',usage_record.availability,'provider_call_count',1,
    'response_artifact_ref',response_reference);
end
$function$;

create function app_data_agent.discover_next_provider_invocation_unknown()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  outcome_record app_data_agent.provider_invocation_outcomes%rowtype;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_job_authority','USAGE') then
    raise exception using errcode = '42501',
      message = 'PROVIDER_UNKNOWN_CLASSIFICATION_JOB_ROLE_REQUIRED';
  end if;
  select * into strict authority from platform.current_backend_authority(false);
  select outcome.* into outcome_record
  from app_data_agent.provider_invocation_outcomes outcome
  join app_data_agent.provider_invocation_intents intent
    on intent.app_id = outcome.app_id and intent.tenant_id = outcome.tenant_id
   and intent.environment = outcome.environment and intent.intent_id = outcome.intent_id
  where outcome.app_id = authority.app_id and outcome.tenant_id = authority.tenant_id
    and outcome.environment = authority.environment and intent.principal_id = authority.principal_id
    and outcome.state = 'OUTCOME_UNKNOWN'
    and intent.recovery_capabilities = array['AT_LEAST_ONCE_ONLY']::text[]
    and outcome.recovery_capability_used = 'AT_LEAST_ONCE_ONLY'
    and outcome.recovery_action = 'MANUAL_REVIEW_REQUIRED'
    and not exists (
      select 1 from app_data_agent.provider_invocation_outcomes terminal
      where terminal.app_id = outcome.app_id and terminal.tenant_id = outcome.tenant_id
        and terminal.environment = outcome.environment and terminal.intent_id = outcome.intent_id
        and terminal.state in ('COMPLETED','FAILED','THROTTLED'))
  order by outcome.committed_at,outcome.outcome_id
  for share of outcome skip locked
  limit 1;
  if not found then return null; end if;
  select intent.* into strict intent_record
  from app_data_agent.provider_invocation_intents intent
  where intent.app_id = outcome_record.app_id and intent.tenant_id = outcome_record.tenant_id
    and intent.environment = outcome_record.environment
    and intent.intent_id = outcome_record.intent_id;
  select permit.* into strict permit_record
  from app_data_agent.provider_invocation_dispatch_permits permit
  where permit.app_id = outcome_record.app_id and permit.tenant_id = outcome_record.tenant_id
    and permit.environment = outcome_record.environment
    and permit.intent_id = outcome_record.intent_id
    and permit.dispatch_hash = outcome_record.dispatch_hash
    and permit.attempt_id = outcome_record.attempt_id
    and permit.worker_fence = outcome_record.worker_fence;
  if intent_record.recovery_capabilities <> array['AT_LEAST_ONCE_ONLY']::text[]
    or outcome_record.recovery_capability_used <> 'AT_LEAST_ONCE_ONLY'
    or outcome_record.recovery_action <> 'MANUAL_REVIEW_REQUIRED'
  then
    raise exception using errcode = 'P0001',
      message = 'PROVIDER_UNKNOWN_CLASSIFICATION_CLOSURE_INVALID';
  end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-unknown-classification@1.0.0',
    'invocation_id',intent_record.invocation_id,'intent_id',intent_record.intent_id,
    'intent_hash',intent_record.intent_hash,'permit_id',permit_record.permit_id,
    'permit_hash',permit_record.permit_hash,'outcome_id',outcome_record.outcome_id,
    'outcome_hash',outcome_record.outcome_hash,
    'recovery_capability_used',outcome_record.recovery_capability_used,
    'recovery_action',outcome_record.recovery_action,
    'required_action',outcome_record.recovery_action);
end
$function$;

create function app_data_agent.load_provider_response_artifact(requested_command jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  authority record;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  artifact_record app_data_agent.artifacts%rowtype;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','scope','run_id','invocation_id','reference'
    ]::text[])
    or requested_command ->> 'schema_version' <> 'provider-response-artifact-load@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'scope',array[
        'app_id','tenant_id','environment','workspace_id','principal_id'
      ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_command -> 'reference',array[
        'artifact_id','artifact_type','app_id','tenant_id','environment','run_id',
        'revision','content_hash'
      ]::text[])
    or requested_command #>> '{reference,artifact_type}' <> 'ProviderResponseArtifact'
  then
    raise exception using errcode = '22023', message = 'PROVIDER_RESPONSE_ARTIFACT_LOAD_INVALID';
  end if;
  select * into strict authority from platform.current_backend_authority(false);
  if requested_command -> 'scope' <> pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment,'workspace_id',authority.tenant_id,
      'principal_id',authority.principal_id) then
    raise exception using errcode = '42501', message = 'PROVIDER_RESPONSE_ARTIFACT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  select intent.* into intent_record from app_data_agent.provider_invocation_intents intent
  where intent.app_id = authority.app_id and intent.tenant_id = authority.tenant_id
    and intent.environment = authority.environment and intent.principal_id = authority.principal_id
    and intent.run_id = (requested_command ->> 'run_id')::uuid
    and intent.invocation_id = (requested_command ->> 'invocation_id')::uuid;
  if not found then
    raise exception using errcode = '42501', message = 'PROVIDER_RESPONSE_ARTIFACT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  select artifact.* into artifact_record from app_data_agent.artifacts artifact
  where artifact.app_id = intent_record.app_id and artifact.tenant_id = intent_record.tenant_id
    and artifact.environment = intent_record.environment and artifact.run_id = intent_record.run_id
    and artifact.artifact_id = (requested_command #>> '{reference,artifact_id}')::uuid
    and artifact.artifact_type = 'ProviderResponseArtifact'
    and artifact.revision = (requested_command #>> '{reference,revision}')::integer
    and artifact.content_hash = requested_command #>> '{reference,content_hash}'
    and artifact.document_json ->> 'invocation_id' = intent_record.invocation_id::text
    and artifact.is_active
    and exists (select 1 from app_data_agent.provider_invocation_outcomes outcome
      where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
        and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
        and outcome.state = 'COMPLETED' and outcome.response_artifact_id = artifact.artifact_id
        and outcome.response_artifact_revision = artifact.revision
        and outcome.response_artifact_content_hash = artifact.content_hash
        and outcome.response_hash = artifact.document_json ->> 'response_hash');
  if not found
    or requested_command -> 'reference' <> pg_catalog.jsonb_build_object(
      'artifact_id',artifact_record.artifact_id,'artifact_type','ProviderResponseArtifact',
      'app_id',artifact_record.app_id,'tenant_id',artifact_record.tenant_id,
      'environment',artifact_record.environment,'run_id',artifact_record.run_id,
      'revision',artifact_record.revision,'content_hash',artifact_record.content_hash)
    or artifact_record.content_hash <>
      app_data_agent.u2_canonical_sha256(artifact_record.document_json - 'content_hash')
    or artifact_record.document_json ->> 'response_hash' <>
      app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
        'output_text',artifact_record.document_json -> 'output_text',
        'tool_calls',artifact_record.document_json -> 'tool_calls'))
  then
    raise exception using errcode = '42501', message = 'PROVIDER_RESPONSE_ARTIFACT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-response-artifact-load-result@1.0.0',
    'invocation_id',intent_record.invocation_id,
    'reference',requested_command -> 'reference','document',artifact_record.document_json);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023', message = 'PROVIDER_RESPONSE_ARTIFACT_LOAD_INVALID';
end
$function$;
create or replace function platform.resolve_backend_authority(
  requested_deployment_id uuid,
  requested_tenant_id uuid,
  requested_principal_id uuid,
  require_write boolean default false
)
returns table (
  app_id uuid,tenant_id uuid,environment text,deployment_id uuid,principal_id uuid,
  membership_role text,membership_version bigint,app_epoch bigint,
  lifecycle_state text,can_write boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  lock_app_id uuid;
  lock_environment text;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE')
    and not pg_catalog.pg_has_role(session_user,'data_agent_job_authority','USAGE')
  then
    raise exception using errcode = '42501',message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if require_write is null then
    raise exception using errcode = '22023',message = 'DA_AUTHORITY_MODE_INVALID';
  end if;
  if require_write then
    select deployment.app_id,deployment.environment
    into lock_app_id,lock_environment
    from platform.deployment_mappings deployment
    where deployment.deployment_id = requested_deployment_id and deployment.is_active;
    if found then
      perform platform.acquire_lifecycle_shared_lock(lock_app_id,lock_environment);
    end if;
  end if;
  return query
  select deployment.app_id,membership.tenant_id,deployment.environment,
    deployment.deployment_id,membership.principal_id,membership.membership_role,
    membership.membership_version,lifecycle.authority_epoch,lifecycle.lifecycle_state,
    lifecycle.lifecycle_state = 'ACTIVE'
      and membership.membership_role in ('owner','analyst')
  from platform.deployment_mappings deployment
  join platform.app_environment_lifecycle lifecycle
    on lifecycle.app_id = deployment.app_id
   and lifecycle.environment = deployment.environment
  join app_data_agent.memberships membership
    on membership.app_id = deployment.app_id
   and membership.environment = deployment.environment
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active
    and membership.tenant_id = requested_tenant_id
    and membership.principal_id = requested_principal_id
    and membership.membership_role <> 'demo'
    and membership.revoked_at is null
    and lifecycle.lifecycle_state <> 'DELETED'
    and (not require_write or (
      lifecycle.lifecycle_state = 'ACTIVE'
      and membership.membership_role in ('owner','analyst')));
  if not found then
    raise exception using errcode = '42501',message = 'DA_SCOPE_FORBIDDEN';
  end if;
end
$function$;

create or replace function platform.revalidate_backend_authority(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  requested_deployment_id uuid,
  requested_principal_id uuid,
  requested_role text,
  requested_membership_version bigint,
  requested_app_epoch bigint,
  require_write boolean default false
)
returns table (
  app_id uuid,tenant_id uuid,environment text,deployment_id uuid,principal_id uuid,
  membership_role text,membership_version bigint,app_epoch bigint,
  lifecycle_state text,can_write boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE')
    and not pg_catalog.pg_has_role(session_user,'data_agent_job_authority','USAGE')
  then
    raise exception using errcode = '42501',message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if require_write is null then
    raise exception using errcode = '22023',message = 'DA_AUTHORITY_MODE_INVALID';
  end if;
  if require_write then
    perform platform.acquire_lifecycle_shared_lock(requested_app_id,requested_environment);
  end if;
  return query
  select deployment.app_id,membership.tenant_id,deployment.environment,
    deployment.deployment_id,membership.principal_id,membership.membership_role,
    membership.membership_version,lifecycle.authority_epoch,lifecycle.lifecycle_state,
    lifecycle.lifecycle_state = 'ACTIVE'
      and membership.membership_role in ('owner','analyst')
  from platform.deployment_mappings deployment
  join platform.app_environment_lifecycle lifecycle
    on lifecycle.app_id = deployment.app_id
   and lifecycle.environment = deployment.environment
  join app_data_agent.memberships membership
    on membership.app_id = deployment.app_id
   and membership.environment = deployment.environment
  where deployment.app_id = requested_app_id
    and membership.tenant_id = requested_tenant_id
    and deployment.environment = requested_environment
    and deployment.deployment_id = requested_deployment_id
    and membership.principal_id = requested_principal_id
    and membership.membership_role = requested_role
    and membership.membership_version = requested_membership_version
    and lifecycle.authority_epoch = requested_app_epoch
    and deployment.is_active
    and membership.membership_role <> 'demo'
    and membership.revoked_at is null
    and lifecycle.lifecycle_state <> 'DELETED'
    and (not require_write or (
      lifecycle.lifecycle_state = 'ACTIVE'
      and membership.membership_role in ('owner','analyst')));
  if not found then
    raise exception using errcode = '42501',message = 'DA_AUTHORITY_STALE_OR_FORBIDDEN';
  end if;
end
$function$;

revoke all on table
  app_data_agent.provider_invocation_intents,
  app_data_agent.provider_invocation_dispatch_permits,
  app_data_agent.provider_invocation_outcomes,
  app_data_agent.provider_invocation_usage_receipts
from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

grant usage on schema app_data_agent,platform
to data_agent_provider_invocation_rpc_owner;
grant usage on schema app_data_agent,platform
to data_agent_provider_smoke_rpc_owner;
grant usage on schema app_data_agent to data_agent_backend,data_agent_job_authority;
grant execute on function
  platform.resolve_backend_authority(uuid,uuid,uuid,boolean),
  platform.revalidate_backend_authority(uuid,uuid,text,uuid,uuid,text,bigint,bigint,boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean)
to data_agent_job_authority;
grant execute on function
  platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  platform.backend_run_object_matches(uuid,uuid,text,uuid,boolean),
  platform.canonical_sha256(jsonb),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text),
  app_data_agent.runtime_iso_timestamp(timestamptz),
  app_data_agent.lock_owned_run_fence(uuid),
  app_data_agent.revalidate_effective_run_config_internal(uuid,bigint,text,uuid,boolean)
to data_agent_provider_invocation_rpc_owner;
grant execute on function
  platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  platform.backend_run_object_matches(uuid,uuid,text,uuid,boolean),
  platform.canonical_sha256(jsonb),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.provider_json_object_has_exact_keys(jsonb,text[]),
  app_data_agent.command_payload_is_valid(jsonb),
  app_data_agent.workspace_command_payload_is_valid(jsonb),
  app_data_agent.canonical_uuid_json_string_is_valid(jsonb),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text),
  app_data_agent.runtime_iso_timestamp(timestamptz)
to data_agent_provider_smoke_rpc_owner;

grant select on table
  app_data_agent.runs,app_data_agent.outbox,app_data_agent.commands,
  app_data_agent.run_attempts,app_data_agent.provider_invocation_intents,
  app_data_agent.provider_invocation_dispatch_permits,
  app_data_agent.provider_invocation_outcomes,
  app_data_agent.provider_invocation_usage_receipts,app_data_agent.artifacts
to data_agent_provider_smoke_rpc_owner;
grant update on table
  app_data_agent.runs,app_data_agent.outbox,app_data_agent.commands
to data_agent_provider_smoke_rpc_owner;
grant insert on table app_data_agent.run_attempts
to data_agent_provider_smoke_rpc_owner;

create policy provider_smoke_runs_rpc_select
on app_data_agent.runs for select to data_agent_provider_smoke_rpc_owner
using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy provider_smoke_runs_rpc_update
on app_data_agent.runs for update to data_agent_provider_smoke_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true))
with check (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy provider_smoke_outbox_rpc_select
on app_data_agent.outbox for select to data_agent_provider_smoke_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy provider_smoke_outbox_rpc_update
on app_data_agent.outbox for update to data_agent_provider_smoke_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true))
with check (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy provider_smoke_commands_rpc_select
on app_data_agent.commands for select to data_agent_provider_smoke_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy provider_smoke_commands_rpc_update
on app_data_agent.commands for update to data_agent_provider_smoke_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true))
with check (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy provider_smoke_attempts_rpc_select
on app_data_agent.run_attempts for select to data_agent_provider_smoke_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy provider_smoke_attempts_rpc_insert
on app_data_agent.run_attempts for insert to data_agent_provider_smoke_rpc_owner
with check (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy provider_smoke_intents_rpc_select
on app_data_agent.provider_invocation_intents for select
to data_agent_provider_smoke_rpc_owner
using (
  platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false)
  and principal_id = (select principal_id from platform.current_backend_authority(false)));
create policy provider_smoke_permits_rpc_select
on app_data_agent.provider_invocation_dispatch_permits for select
to data_agent_provider_smoke_rpc_owner
using (exists (
  select 1 from app_data_agent.provider_invocation_intents intent
  where intent.app_id = provider_invocation_dispatch_permits.app_id
    and intent.tenant_id = provider_invocation_dispatch_permits.tenant_id
    and intent.environment = provider_invocation_dispatch_permits.environment
    and intent.intent_id = provider_invocation_dispatch_permits.intent_id
    and platform.backend_run_object_matches(
      intent.app_id,intent.tenant_id,intent.environment,intent.run_id,false)
    and intent.principal_id =
      (select principal_id from platform.current_backend_authority(false))));
create policy provider_smoke_outcomes_rpc_select
on app_data_agent.provider_invocation_outcomes for select
to data_agent_provider_smoke_rpc_owner
using (exists (
  select 1 from app_data_agent.provider_invocation_intents intent
  where intent.app_id = provider_invocation_outcomes.app_id
    and intent.tenant_id = provider_invocation_outcomes.tenant_id
    and intent.environment = provider_invocation_outcomes.environment
    and intent.intent_id = provider_invocation_outcomes.intent_id
    and platform.backend_run_object_matches(
      intent.app_id,intent.tenant_id,intent.environment,intent.run_id,false)
    and intent.principal_id =
      (select principal_id from platform.current_backend_authority(false))));
create policy provider_smoke_usage_rpc_select
on app_data_agent.provider_invocation_usage_receipts for select
to data_agent_provider_smoke_rpc_owner
using (exists (
  select 1 from app_data_agent.provider_invocation_intents intent
  where intent.app_id = provider_invocation_usage_receipts.app_id
    and intent.tenant_id = provider_invocation_usage_receipts.tenant_id
    and intent.environment = provider_invocation_usage_receipts.environment
    and intent.intent_id = provider_invocation_usage_receipts.intent_id
    and platform.backend_run_object_matches(
      intent.app_id,intent.tenant_id,intent.environment,intent.run_id,false)
    and intent.principal_id =
      (select principal_id from platform.current_backend_authority(false))));
create policy provider_smoke_artifacts_rpc_select
on app_data_agent.artifacts for select to data_agent_provider_smoke_rpc_owner
using (
  artifact_type = 'ProviderResponseArtifact'
  and platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));

grant select,insert,update,delete on table
  app_data_agent.provider_invocation_intents,
  app_data_agent.provider_invocation_dispatch_permits,
  app_data_agent.provider_invocation_outcomes,
  app_data_agent.provider_invocation_usage_receipts
to data_agent_provider_invocation_rpc_owner;

grant select on table
  app_data_agent.runs,app_data_agent.run_attempts,app_data_agent.outbox,
  app_data_agent.effective_run_config_receipts,
  app_data_agent.effective_run_config_resource_bindings,
  app_data_agent.effective_config_context_receipts,
  app_data_agent.qa_conversations,app_data_agent.datasource_connections,
  app_data_agent.workspace_run_bindings,app_data_agent.qa_messages,
  app_data_agent.run_events,
  app_data_agent.model_catalog_entries,app_data_agent.model_config_versions,
  app_data_agent.model_provider_connections,
  app_data_agent.model_provider_connection_versions,
  platform.deployment_mappings
to data_agent_provider_invocation_rpc_owner;
-- Row locks require UPDATE ACL. The lock-only UPDATE policies below expose the
-- scoped old row to FOR SHARE/UPDATE while WITH CHECK (false) denies direct mutation.
grant update on table
  app_data_agent.runs,app_data_agent.run_attempts,app_data_agent.outbox,
  app_data_agent.effective_run_config_receipts,
  app_data_agent.effective_config_context_receipts,
  app_data_agent.qa_conversations,app_data_agent.datasource_connections,
  app_data_agent.workspace_run_bindings,app_data_agent.qa_messages,
  app_data_agent.run_events,
  app_data_agent.model_catalog_entries,app_data_agent.model_config_versions,
  app_data_agent.model_provider_connections,
  app_data_agent.model_provider_connection_versions,
  app_data_agent.artifacts
to data_agent_provider_invocation_rpc_owner;
grant select,insert on table app_data_agent.artifacts
to data_agent_provider_invocation_rpc_owner;

create policy provider_invocation_runs_rpc_select
on app_data_agent.runs for select to data_agent_provider_invocation_rpc_owner
using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy provider_invocation_runs_rpc_lock
on app_data_agent.runs for update to data_agent_provider_invocation_rpc_owner
using (platform.backend_context_matches(app_id,tenant_id,environment,false))
with check (false);
create policy provider_invocation_attempts_rpc_select
on app_data_agent.run_attempts for select to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy provider_invocation_attempts_rpc_lock
on app_data_agent.run_attempts for update to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (false);
create policy provider_invocation_outbox_rpc_select
on app_data_agent.outbox for select to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy provider_invocation_outbox_rpc_lock
on app_data_agent.outbox for update to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (false);
create policy provider_invocation_effective_config_rpc_select
on app_data_agent.effective_run_config_receipts for select to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy provider_invocation_effective_config_rpc_lock
on app_data_agent.effective_run_config_receipts for update
to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (false);
create policy provider_invocation_effective_binding_rpc_select
on app_data_agent.effective_run_config_resource_bindings for select
to data_agent_provider_invocation_rpc_owner
using (exists (select 1 from app_data_agent.effective_run_config_receipts receipt
  where receipt.app_id = effective_run_config_resource_bindings.app_id
    and receipt.tenant_id = effective_run_config_resource_bindings.tenant_id
    and receipt.environment = effective_run_config_resource_bindings.environment
    and receipt.config_id = effective_run_config_resource_bindings.config_id
    and receipt.config_revision = effective_run_config_resource_bindings.config_revision
    and platform.backend_run_object_matches(
      receipt.app_id,receipt.tenant_id,receipt.environment,receipt.run_id,false)));
create policy provider_invocation_context_rpc_select
on app_data_agent.effective_config_context_receipts for select
to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy provider_invocation_context_rpc_lock
on app_data_agent.effective_config_context_receipts for update
to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (false);
create policy provider_invocation_conversation_rpc_select
on app_data_agent.qa_conversations for select to data_agent_provider_invocation_rpc_owner
using (
  platform.backend_context_matches(app_id,tenant_id,environment,false)
  and owner_principal_id = (select principal_id from platform.current_backend_authority(false))
);
create policy provider_invocation_conversation_rpc_lock
on app_data_agent.qa_conversations for update to data_agent_provider_invocation_rpc_owner
using (
  platform.backend_context_matches(app_id,tenant_id,environment,false)
  and owner_principal_id = (select principal_id from platform.current_backend_authority(false))
) with check (false);
create policy provider_invocation_run_binding_rpc_select
on app_data_agent.workspace_run_bindings for select to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy provider_invocation_run_binding_rpc_lock
on app_data_agent.workspace_run_bindings for update to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (false);
create policy provider_invocation_qa_message_rpc_select
on app_data_agent.qa_messages for select to data_agent_provider_invocation_rpc_owner
using (
  platform.backend_context_matches(app_id,tenant_id,environment,false)
  and owner_principal_id = (select principal_id from platform.current_backend_authority(false))
);
create policy provider_invocation_qa_message_rpc_lock
on app_data_agent.qa_messages for update to data_agent_provider_invocation_rpc_owner
using (
  platform.backend_context_matches(app_id,tenant_id,environment,false)
  and owner_principal_id = (select principal_id from platform.current_backend_authority(false))
) with check (false);
create policy provider_invocation_run_event_rpc_select
on app_data_agent.run_events for select to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy provider_invocation_run_event_rpc_lock
on app_data_agent.run_events for update to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (false);
create policy provider_invocation_datasource_rpc_select
on app_data_agent.datasource_connections for select to data_agent_provider_invocation_rpc_owner
using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy provider_invocation_datasource_rpc_lock
on app_data_agent.datasource_connections for update to data_agent_provider_invocation_rpc_owner
using (platform.backend_context_matches(app_id,tenant_id,environment,false))
with check (false);
create policy provider_invocation_model_catalog_rpc_select
on app_data_agent.model_catalog_entries for select to data_agent_provider_invocation_rpc_owner
using (
  app_id = (select app_id from platform.current_backend_authority(false))
  and environment = (select environment from platform.current_backend_authority(false))
);
create policy provider_invocation_model_catalog_rpc_lock
on app_data_agent.model_catalog_entries for update to data_agent_provider_invocation_rpc_owner
using (
  app_id = (select app_id from platform.current_backend_authority(false))
  and environment = (select environment from platform.current_backend_authority(false))
) with check (false);
create policy provider_invocation_model_config_rpc_select
on app_data_agent.model_config_versions for select to data_agent_provider_invocation_rpc_owner
using (
  app_id = (select app_id from platform.current_backend_authority(false))
  and environment = (select environment from platform.current_backend_authority(false))
);
create policy provider_invocation_model_config_rpc_lock
on app_data_agent.model_config_versions for update to data_agent_provider_invocation_rpc_owner
using (
  app_id = (select app_id from platform.current_backend_authority(false))
  and environment = (select environment from platform.current_backend_authority(false))
) with check (false);
create policy provider_invocation_connection_rpc_select
on app_data_agent.model_provider_connections for select to data_agent_provider_invocation_rpc_owner
using (
  app_id = (select app_id from platform.current_backend_authority(false))
  and environment = (select environment from platform.current_backend_authority(false))
);
create policy provider_invocation_connection_rpc_lock
on app_data_agent.model_provider_connections for update to data_agent_provider_invocation_rpc_owner
using (
  app_id = (select app_id from platform.current_backend_authority(false))
  and environment = (select environment from platform.current_backend_authority(false))
) with check (false);
create policy provider_invocation_connection_version_rpc_select
on app_data_agent.model_provider_connection_versions for select
to data_agent_provider_invocation_rpc_owner
using (
  app_id = (select app_id from platform.current_backend_authority(false))
  and environment = (select environment from platform.current_backend_authority(false))
);
create policy provider_invocation_connection_version_rpc_lock
on app_data_agent.model_provider_connection_versions for update
to data_agent_provider_invocation_rpc_owner
using (
  app_id = (select app_id from platform.current_backend_authority(false))
  and environment = (select environment from platform.current_backend_authority(false))
) with check (false);
create policy provider_invocation_artifacts_rpc_select
on app_data_agent.artifacts for select to data_agent_provider_invocation_rpc_owner
using (
  platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false)
  or (artifact_type in ('ModelCertificationReceipt','ProviderReconciliationEvidence')
    and platform.backend_context_matches(app_id,tenant_id,environment,false))
);
create policy provider_invocation_artifacts_rpc_lock
on app_data_agent.artifacts for update to data_agent_provider_invocation_rpc_owner
using (
  platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false)
  or (artifact_type in ('ModelCertificationReceipt','ProviderReconciliationEvidence')
    and platform.backend_context_matches(app_id,tenant_id,environment,false))
) with check (false);
create policy provider_invocation_artifacts_rpc_insert
on app_data_agent.artifacts for insert to data_agent_provider_invocation_rpc_owner
with check (
  (artifact_type = 'ProviderResponseArtifact'
    and platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true))
  or (artifact_type = 'ProviderReconciliationEvidence'
    and platform.backend_context_matches(app_id,tenant_id,environment,true))
  or (artifact_type = 'ProviderTaskArtifact'
    and platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true))
  or (artifact_type = 'ProviderStaleMarkerRecoveryReceipt'
    and platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true))
);

alter function app_data_agent.provider_json_object_has_exact_keys(jsonb,text[])
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.assert_provider_active_worker_lease(jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.resolve_conversation_run_selections(uuid,bigint)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.list_provider_execution_profiles()
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.begin_provider_invocation(jsonb,jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.mark_provider_invocation_dispatched(jsonb,jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.mark_provider_invocation_response_observed(jsonb,jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.commit_provider_invocation_worker_transition_internal(jsonb,jsonb,jsonb,text)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.commit_provider_invocation_completed(jsonb,jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.commit_provider_invocation_terminal(jsonb,jsonb,jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.mark_provider_invocation_outcome_unknown(jsonb,jsonb,jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.commit_provider_reconciliation_evidence(jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.reconcile_provider_invocation_unknown(jsonb,jsonb,jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.recover_stale_provider_invocation_marker(jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.recover_next_stale_provider_invocation_marker()
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.claim_provider_invocation_smoke_work(text,integer,uuid,uuid)
owner to data_agent_provider_smoke_rpc_owner;
alter function app_data_agent.verify_provider_invocation_smoke_completion(uuid,uuid,uuid,bigint)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.discover_next_provider_invocation_unknown()
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.load_provider_invocation(jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.commit_provider_task_artifact(jsonb,jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.load_provider_task_artifact(jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.commit_provider_response_artifact(jsonb,jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.load_provider_response_artifact(jsonb)
owner to data_agent_provider_invocation_rpc_owner;

revoke all on function app_data_agent.provider_json_object_has_exact_keys(jsonb,text[])
from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function app_data_agent.assert_provider_active_worker_lease(jsonb)
from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function app_data_agent.commit_provider_invocation_worker_transition_internal(jsonb,jsonb,jsonb,text)
from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function app_data_agent.resolve_conversation_run_selections(uuid,bigint),
  app_data_agent.list_provider_execution_profiles(),
  app_data_agent.begin_provider_invocation(jsonb,jsonb),
  app_data_agent.mark_provider_invocation_dispatched(jsonb,jsonb),
  app_data_agent.mark_provider_invocation_response_observed(jsonb,jsonb),
  app_data_agent.commit_provider_invocation_completed(jsonb,jsonb),
  app_data_agent.commit_provider_invocation_terminal(jsonb,jsonb,jsonb),
  app_data_agent.mark_provider_invocation_outcome_unknown(jsonb,jsonb,jsonb),
  app_data_agent.commit_provider_reconciliation_evidence(jsonb),
  app_data_agent.reconcile_provider_invocation_unknown(jsonb,jsonb,jsonb),
  app_data_agent.recover_stale_provider_invocation_marker(jsonb),
  app_data_agent.recover_next_stale_provider_invocation_marker(),
  app_data_agent.claim_provider_invocation_smoke_work(text,integer,uuid,uuid),
  app_data_agent.verify_provider_invocation_smoke_completion(uuid,uuid,uuid,bigint),
  app_data_agent.discover_next_provider_invocation_unknown(),
  app_data_agent.load_provider_invocation(jsonb),
  app_data_agent.commit_provider_task_artifact(jsonb,jsonb),
  app_data_agent.load_provider_task_artifact(jsonb),
  app_data_agent.load_provider_response_artifact(jsonb)
from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

grant execute on function app_data_agent.resolve_conversation_run_selections(uuid,bigint),
  app_data_agent.list_provider_execution_profiles(),
  app_data_agent.begin_provider_invocation(jsonb,jsonb),
  app_data_agent.mark_provider_invocation_dispatched(jsonb,jsonb),
  app_data_agent.mark_provider_invocation_response_observed(jsonb,jsonb),
  app_data_agent.commit_provider_invocation_completed(jsonb,jsonb),
  app_data_agent.commit_provider_invocation_terminal(jsonb,jsonb,jsonb),
  app_data_agent.mark_provider_invocation_outcome_unknown(jsonb,jsonb,jsonb),
  app_data_agent.commit_provider_task_artifact(jsonb,jsonb),
  app_data_agent.load_provider_task_artifact(jsonb),
  app_data_agent.load_provider_response_artifact(jsonb)
to data_agent_backend;
grant execute on function app_data_agent.reconcile_provider_invocation_unknown(jsonb,jsonb,jsonb)
to data_agent_job_authority;
grant execute on function app_data_agent.recover_stale_provider_invocation_marker(jsonb)
to data_agent_job_authority;
grant execute on function app_data_agent.recover_next_stale_provider_invocation_marker()
to data_agent_job_authority;
grant execute on function app_data_agent.claim_provider_invocation_smoke_work(
  text,integer,uuid,uuid
) to data_agent_job_authority;
grant execute on function app_data_agent.verify_provider_invocation_smoke_completion(
  uuid,uuid,uuid,bigint
) to data_agent_job_authority;
grant execute on function app_data_agent.discover_next_provider_invocation_unknown()
to data_agent_job_authority;
grant execute on function app_data_agent.commit_provider_reconciliation_evidence(jsonb)
to data_agent_job_authority;
grant execute on function app_data_agent.load_provider_invocation(jsonb)
to data_agent_backend;

-- Standalone response insertion is intentionally not executable by backend: COMPLETED owns
-- response Artifact + Outcome + Usage in one transaction through commit_provider_invocation_completed.
revoke all on function app_data_agent.commit_provider_response_artifact(jsonb,jsonb)
from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

do $postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'provider_invocation_intents','provider_invocation_dispatch_permits',
    'provider_invocation_outcomes','provider_invocation_usage_receipts'
  ] loop
    if not exists (select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app_data_agent' and relation.relname = relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity) then
      raise exception using errcode = 'P0001', message = 'PROVIDER_INVOCATION_FORCE_RLS_MISSING';
    end if;
  end loop;
  if not exists (select 1 from pg_catalog.pg_roles
    where rolname = 'data_agent_provider_invocation_rpc_owner'
      and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolbypassrls)
    or pg_catalog.pg_has_role(
      'data_agent_provider_invocation_rpc_owner','data_agent_backend','MEMBER')
    or pg_catalog.pg_has_role(
      'data_agent_provider_invocation_rpc_owner','data_agent_job_authority','MEMBER')
  then
    raise exception using errcode = 'P0001', message = 'PROVIDER_INVOCATION_RPC_OWNER_UNSAFE';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles
    where rolname = 'data_agent_provider_smoke_rpc_owner'
      and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolbypassrls)
    or pg_catalog.pg_has_role(
      'data_agent_provider_smoke_rpc_owner','data_agent_backend','MEMBER')
    or pg_catalog.pg_has_role(
      'data_agent_provider_smoke_rpc_owner','data_agent_job_authority','MEMBER')
  then
    raise exception using errcode = 'P0001', message = 'PROVIDER_SMOKE_RPC_OWNER_UNSAFE';
  end if;
  if not pg_catalog.has_function_privilege(
    'data_agent_provider_invocation_rpc_owner',
    'app_data_agent.u2_canonical_sha256(jsonb)','EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_provider_smoke_rpc_owner',
    'app_data_agent.u2_canonical_sha256(jsonb)','EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_provider_invocation_rpc_owner',
    'app_data_agent.attribution_canonical_json(jsonb)','EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_backend','app_data_agent.u2_canonical_sha256(jsonb)','EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_job_authority','app_data_agent.u2_canonical_sha256(jsonb)','EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'PROVIDER_CONTRACT_HASH_AUTHORITY_UNSAFE';
  end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010654_app_data_agent_provider_invocation_authority',
  'sha256:f6213c684dd4af3ae7d6eeae4606ebb8f9dbb08c1b691534fac6e9d4b0d91bce'
);

commit;
