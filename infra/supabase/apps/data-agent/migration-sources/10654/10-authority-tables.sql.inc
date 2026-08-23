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
