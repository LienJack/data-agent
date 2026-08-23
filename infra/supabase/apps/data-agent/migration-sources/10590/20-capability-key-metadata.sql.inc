create table app_data_agent.research_authority_capabilities (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  capability_id uuid not null,
  assignment_key text not null check (assignment_key ~ '^sha256:[0-9a-f]{64}$'),
  principal_id uuid not null,
  deployment_id uuid not null,
  membership_version bigint not null check (membership_version between 1 and 9007199254740991),
  app_epoch bigint not null check (app_epoch between 1 and 9007199254740991),
  membership_role text not null check (membership_role in ('OWNER', 'ANALYST', 'VIEWER')),
  authority_kind text not null check (
    authority_kind in (
      'SEMANTIC_FRONTIER_AUTHORITY', 'SCHEMA_FRONTIER_AUTHORITY',
      'DATA_SNAPSHOT_FRONTIER_AUTHORITY', 'POLICY_FRONTIER_AUTHORITY',
      'IDENTITY_FRONTIER_AUTHORITY', 'RESEARCH_ARTIFACT_AUTHORITY',
      'RESEARCH_STOP_AUTHORITY', 'CURRENT_READINESS_AUTHORITY',
      'SERVICE_REVOCATION_AUTHORITY', 'REPORT_READ_AUTHORITY',
      'REPORT_READ_EXPIRY_AUTHORITY', 'RESOURCE_AUTHORITY',
      'AGENT_DATA_PROJECTION_AUTHORITY', 'MODEL_INVOCATION_AUTHORITY',
      'SQL_INVOCATION_AUTHORITY', 'TOOL_INVOCATION_AUTHORITY',
      'TOOL_POLICY_AUTHORITY', 'TOOL_POLICY_EXPIRY_AUTHORITY',
      'RESULT_RETENTION_AUTHORITY', 'RESULT_ERASURE_AUTHORITY',
      'RESULT_DECRYPTION_AUTHORITY', 'RELEASE_GO_AUTHORITY'
    )
  ),
  artifact_authority_domain text check (
    artifact_authority_domain is null
    or artifact_authority_domain in (
      'BRIEF_SEMANTIC', 'PLANNING', 'OBLIGATION_EXECUTION', 'EVIDENCE',
      'CLAIM_STRUCTURE', 'RELATION', 'PROOF', 'COVERAGE', 'RESEARCH_STOP',
      'PROJECTION', 'EVIDENCE_GATE', 'READINESS'
    )
  ),
  frontier_kind text check (
    frontier_kind is null or frontier_kind in ('SEMANTIC', 'SCHEMA', 'DATA', 'POLICY', 'IDENTITY')
  ),
  resource_kind text check (resource_kind is null or resource_kind in ('MODEL', 'SQL', 'TOOL')),
  authority_epoch bigint not null check (authority_epoch between 0 and 9007199254740991),
  state text not null check (state in ('ACTIVE', 'REVOKED')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, capability_id),
  unique (app_id, tenant_id, environment, assignment_key, capability_id),
  unique (app_id, tenant_id, environment, capability_id, authority_epoch, principal_id),
  foreign key (app_id, tenant_id, environment, principal_id)
    references app_data_agent.memberships (app_id, tenant_id, environment, principal_id)
    on delete restrict not deferrable,
  foreign key (app_id, environment, deployment_id)
    references platform.deployment_mappings (app_id, environment, deployment_id)
    on delete restrict not deferrable,
  check (
    (
      authority_kind = 'RESEARCH_ARTIFACT_AUTHORITY'
      and artifact_authority_domain is not null
      and frontier_kind is null
      and resource_kind is null
    )
    or (
      authority_kind in (
        'SEMANTIC_FRONTIER_AUTHORITY', 'SCHEMA_FRONTIER_AUTHORITY',
        'DATA_SNAPSHOT_FRONTIER_AUTHORITY', 'POLICY_FRONTIER_AUTHORITY',
        'IDENTITY_FRONTIER_AUTHORITY'
      )
      and artifact_authority_domain is null
      and frontier_kind =
        case authority_kind
          when 'SEMANTIC_FRONTIER_AUTHORITY' then 'SEMANTIC'
          when 'SCHEMA_FRONTIER_AUTHORITY' then 'SCHEMA'
          when 'DATA_SNAPSHOT_FRONTIER_AUTHORITY' then 'DATA'
          when 'POLICY_FRONTIER_AUTHORITY' then 'POLICY'
          when 'IDENTITY_FRONTIER_AUTHORITY' then 'IDENTITY'
        end
      and resource_kind is null
    )
    or (
      authority_kind in (
        'RESOURCE_AUTHORITY', 'MODEL_INVOCATION_AUTHORITY',
        'SQL_INVOCATION_AUTHORITY', 'TOOL_INVOCATION_AUTHORITY'
      )
      and artifact_authority_domain is null
      and frontier_kind is null
      and resource_kind is not null
      and (
        authority_kind = 'RESOURCE_AUTHORITY'
        or resource_kind =
          case authority_kind
            when 'MODEL_INVOCATION_AUTHORITY' then 'MODEL'
            when 'SQL_INVOCATION_AUTHORITY' then 'SQL'
            when 'TOOL_INVOCATION_AUTHORITY' then 'TOOL'
          end
      )
    )
    or (
      authority_kind not in (
        'RESEARCH_ARTIFACT_AUTHORITY',
        'SEMANTIC_FRONTIER_AUTHORITY', 'SCHEMA_FRONTIER_AUTHORITY',
        'DATA_SNAPSHOT_FRONTIER_AUTHORITY', 'POLICY_FRONTIER_AUTHORITY',
        'IDENTITY_FRONTIER_AUTHORITY', 'RESOURCE_AUTHORITY',
        'MODEL_INVOCATION_AUTHORITY', 'SQL_INVOCATION_AUTHORITY',
        'TOOL_INVOCATION_AUTHORITY'
      )
      and artifact_authority_domain is null
      and frontier_kind is null
      and resource_kind is null
    )
  ),
  check (
    (state = 'ACTIVE' and revoked_at is null)
    or (state = 'REVOKED' and revoked_at is not null)
  ),
  check (
    (authority_kind = 'REPORT_READ_AUTHORITY' and membership_role in ('OWNER', 'ANALYST', 'VIEWER'))
    or (authority_kind = 'RELEASE_GO_AUTHORITY' and membership_role = 'OWNER')
    or (
      authority_kind not in ('REPORT_READ_AUTHORITY', 'RELEASE_GO_AUTHORITY')
      and membership_role in ('OWNER', 'ANALYST')
    )
  )
);

create unique index research_authority_capabilities_one_active_assignment
on app_data_agent.research_authority_capabilities (
  app_id, tenant_id, environment, principal_id, authority_kind,
  artifact_authority_domain, frontier_kind, resource_kind
) nulls not distinct
where state = 'ACTIVE';

create table app_data_agent.research_authority_capability_heads (
  app_id uuid not null
    check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null
    check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  assignment_key text not null check (assignment_key ~ '^sha256:[0-9a-f]{64}$'),
  principal_id uuid not null,
  authority_kind text not null,
  artifact_authority_domain text,
  frontier_kind text,
  resource_kind text,
  current_capability_id uuid not null,
  current_authority_epoch bigint not null
    check (current_authority_epoch between 0 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, assignment_key),
  unique nulls not distinct (
    app_id, tenant_id, environment, principal_id, authority_kind,
    artifact_authority_domain, frontier_kind, resource_kind
  ),
  foreign key (app_id, tenant_id, environment, principal_id)
    references app_data_agent.memberships (app_id, tenant_id, environment, principal_id)
    on delete restrict not deferrable,
  foreign key (app_id, tenant_id, environment, assignment_key, current_capability_id)
    references app_data_agent.research_authority_capabilities (
      app_id, tenant_id, environment, assignment_key, capability_id
    )
    on delete restrict
    deferrable initially deferred
);

create table app_data_agent.research_tool_permit_policy_limits (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  policy_version text not null check (pg_catalog.length(policy_version) between 1 and 128),
  policy_limit_hash text not null check (policy_limit_hash ~ '^sha256:[0-9a-f]{64}$'),
  tool_permit_max_ttl_ms bigint not null
    check (tool_permit_max_ttl_ms between 1 and 86400000),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, policy_version),
  unique (app_id, tenant_id, environment, policy_version, policy_limit_hash)
);

create table app_data_agent.research_result_retention_policies (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  policy_id uuid not null,
  policy_version text not null check (pg_catalog.length(policy_version) between 1 and 128),
  policy_hash text not null check (policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  retention_duration_ms bigint not null
    check (retention_duration_ms between 1 and 31536000000),
  legal_hold text not null check (legal_hold in ('NONE', 'ACTIVE')),
  hold_ref_hash text check (hold_ref_hash is null or hold_ref_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, policy_id, policy_version),
  unique (app_id, tenant_id, environment, policy_id, policy_version, policy_hash),
  check (
    (legal_hold = 'NONE' and hold_ref_hash is null)
    or (legal_hold = 'ACTIVE' and hold_ref_hash is not null)
  )
);

create table app_data_agent.research_result_retention_policy_heads (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  policy_id uuid not null,
  policy_version text not null,
  policy_hash text not null,
  head_version bigint not null default 1 check (head_version between 1 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment),
  foreign key (app_id, tenant_id, environment, policy_id, policy_version, policy_hash)
    references app_data_agent.research_result_retention_policies (
      app_id, tenant_id, environment, policy_id, policy_version, policy_hash
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_result_access_audit_retention_policies (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  policy_version text not null check (pg_catalog.length(policy_version) between 1 and 128),
  policy_hash text not null check (policy_hash ~ '^sha256:[0-9a-f]{64}$'),
  online_retention_ms bigint not null check (online_retention_ms between 1 and 31536000000),
  erasure_sla_ms bigint not null check (erasure_sla_ms between 1 and 604800000),
  backup_retention_ms bigint not null check (backup_retention_ms between 0 and 3024000000),
  legal_hold text not null check (legal_hold in ('NONE', 'ACTIVE')),
  hold_ref_hash text check (hold_ref_hash is null or hold_ref_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, policy_version),
  unique (app_id, tenant_id, environment, policy_version, policy_hash),
  check (
    (legal_hold = 'NONE' and hold_ref_hash is null)
    or (legal_hold = 'ACTIVE' and hold_ref_hash is not null)
  )
);

create table app_data_agent.research_result_access_audit_retention_heads (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  policy_version text not null,
  policy_hash text not null,
  head_version bigint not null default 1 check (head_version between 1 and 9007199254740991),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment),
  foreign key (app_id, tenant_id, environment, policy_version, policy_hash)
    references app_data_agent.research_result_access_audit_retention_policies (
      app_id, tenant_id, environment, policy_version, policy_hash
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_result_access_audit_purge_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  operation_id uuid not null,
  policy_version text not null,
  policy_hash text not null,
  purpose text not null check (purpose in ('RETENTION_PURGE', 'SUBJECT_ERASURE')),
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  deleted_count bigint not null check (deleted_count between 0 and 9007199254740991),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, operation_id),
  foreign key (app_id, tenant_id, environment, policy_version, policy_hash)
    references app_data_agent.research_result_access_audit_retention_policies (
      app_id, tenant_id, environment, policy_version, policy_hash
    )
    on delete restrict not deferrable
);

create table app_data_agent.research_result_key_versions (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  key_kind text not null check (key_kind in ('ENCRYPTION', 'COMMITMENT')),
  key_version text not null check (pg_catalog.length(key_version) between 1 and 128),
  key_ref_hash text not null check (key_ref_hash ~ '^sha256:[0-9a-f]{64}$'),
  state text not null check (state in ('STAGED', 'ACTIVE', 'RETIRED', 'COMPROMISED')),
  predecessor_key_version text,
  staged_at timestamptz not null default pg_catalog.clock_timestamp(),
  activated_at timestamptz,
  retired_at timestamptz,
  compromised_at timestamptz,
  primary key (app_id, tenant_id, environment, key_kind, key_version),
  foreign key (app_id, tenant_id, environment, key_kind, predecessor_key_version)
    references app_data_agent.research_result_key_versions (
      app_id, tenant_id, environment, key_kind, key_version
    )
    match simple on delete no action not deferrable,
  check (predecessor_key_version is null or predecessor_key_version <> key_version),
  check (
    (state = 'STAGED' and activated_at is null and retired_at is null and compromised_at is null)
    or (state = 'ACTIVE' and activated_at is not null and retired_at is null and compromised_at is null)
    or (state = 'RETIRED' and activated_at is not null and retired_at is not null and compromised_at is null)
    or (state = 'COMPROMISED' and compromised_at is not null)
  )
);

create unique index research_result_key_versions_one_active
on app_data_agent.research_result_key_versions (app_id, tenant_id, environment, key_kind)
where state = 'ACTIVE';

create unique index research_result_key_versions_one_staged
on app_data_agent.research_result_key_versions (app_id, tenant_id, environment, key_kind)
where state = 'STAGED';

create table app_data_agent.research_result_key_transition_operations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  operation_id uuid not null,
  principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 1 and 256),
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  key_kind text not null check (key_kind in ('ENCRYPTION', 'COMMITMENT')),
  key_version text not null,
  transition text not null check (transition in ('STAGE', 'ACTIVATE', 'RETIRE', 'COMPROMISE')),
  result_state text not null check (result_state in ('STAGED', 'ACTIVE', 'RETIRED', 'COMPROMISED')),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, operation_id),
  unique (app_id, tenant_id, environment, principal_id, idempotency_key),
  foreign key (app_id, tenant_id, environment, key_kind, key_version)
    references app_data_agent.research_result_key_versions (
      app_id, tenant_id, environment, key_kind, key_version
    )
    on delete restrict not deferrable
);
