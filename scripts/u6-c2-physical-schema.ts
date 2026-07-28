import { createHash } from "node:crypto";

const DESCRIPTOR_PROTOCOL = "u6-c2-physical-schema-descriptor@1.0.0";
const DESCRIPTOR_HASH_DOMAIN = `${DESCRIPTOR_PROTOCOL}\0`;
const TARGET_INVENTORY_PROTOCOL = "u6-schema-inventory@2.0.0";
const CANDIDATE_INVENTORY_PROTOCOL = "u6-schema-inventory-candidate@2.0.0";
const DATA_OWNER = "data_agent_u6_data_owner";
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_SAFE_BIGINT = 9_007_199_254_740_991;

type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonRecord = { [key: string]: JsonValue };

export type DeepReadonly<
  T,
  Depth extends readonly unknown[] = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
> = Depth extends readonly [unknown, ...infer Rest]
  ? T extends (...args: never[]) => unknown
    ? T
    : T extends readonly unknown[]
      ? { readonly [K in keyof T]: DeepReadonly<T[K], Rest> }
      : T extends object
        ? { readonly [K in keyof T]: DeepReadonly<T[K], Rest> }
        : T
  : T;

type ColumnInput = {
  name: string;
  type: string;
  nullable?: boolean;
  default_expression?: string | null;
};

type ColumnDescriptor = {
  name: string;
  attnum: number;
  type: string;
  nullable: boolean;
  default_expression: string | null;
  collation: string | null;
  identity: null;
  generated: null;
};

type ConstraintKind = "CHECK" | "FOREIGN_KEY" | "PRIMARY_KEY" | "UNIQUE";

type ConstraintDescriptor = {
  name: string;
  kind: ConstraintKind;
  columns: string[];
  expression: string | null;
  referenced_relation: string | null;
  referenced_columns: string[];
  match_type: "SIMPLE" | null;
  on_update: "NO ACTION" | null;
  on_delete: "RESTRICT" | null;
  deferrable: false;
  initially_deferred: false;
};

type IndexDescriptor = {
  name: string;
  unique: boolean;
  method: "btree";
  columns: string[];
  include: string[];
  predicate: string | null;
  backs_constraint: string | null;
};

type CompanionBindingDescriptor =
  | {
      kind: "ARTIFACT_REFERENCE";
      parent_relation: string;
      parent_id_column: "attestation_id" | "receipt_id";
      parent_hash_column: "attestation_hash" | "receipt_hash";
      allowed_paths: string[];
      binding_group_protocol:
        | "ROOT"
        | "ROOT_OR_EMBEDDED_REFERENCE_IDENTITY"
        | "ROOT_OR_QUERY_CONTRACT_REFERENCE_IDENTITY"
        | "ROOT_OR_QUERY_OR_EMBEDDED_REFERENCE_IDENTITY";
      ordinal_scope: "PER_CANONICAL_PATH_AND_BINDING_GROUP";
      ordinal_min: 0;
      ordinal_max: 255;
      requires_parent_exact_fk: true;
      requires_artifact_exact_fk: true;
    }
  | {
      kind: "BUDGET_INPUT";
      parent_relation: "app_data_agent.research_budget_ledger_receipts";
      parent_id_column: "receipt_id";
      parent_hash_column: "receipt_hash";
      allowed_paths: [
        "research_brief_ref",
        "ordered_budget_event_hashes",
        "ordered_reservation_states",
      ];
      binding_group_protocol: "ROOT";
      ordinal_scope: "PER_CANONICAL_PATH_AND_BINDING_GROUP";
      ordinal_min: 0;
      ordinal_max: 255;
      requires_parent_exact_fk: true;
      requires_artifact_exact_fk: true;
      branches: ["ARTIFACT_REF", "BUDGET_EVENT", "RESERVATION_STATE"];
    };

type RelationDescriptor = {
  qualified_name: string;
  surface_kind: "COMPANION" | "CORE";
  mutation_mode: "APPEND_ONLY" | "MUTABLE_CURRENT_HEAD";
  wire_protocols: string[];
  owner: typeof DATA_OWNER;
  columns: ColumnDescriptor[];
  constraints: ConstraintDescriptor[];
  indexes: IndexDescriptor[];
  triggers: Array<{
    name: string;
    timing: "BEFORE";
    events: ["DELETE", "UPDATE"];
    orientation: "ROW";
    enabled: "ORIGIN";
    function_signature: "platform.reject_immutable_mutation()";
    function_body_hash_binding: "FUNCTION_BODY_HASHES_NOT_FROZEN";
  }>;
  rls: { enabled: true; forced: true };
  policies: Array<{
    name: string;
    command: "ALL" | "DELETE" | "INSERT" | "SELECT" | "UPDATE";
    roles: string[];
    permissive: true;
    using: string | null;
    with_check: string | null;
    expression_binding: "FINAL_10600_SQL_NOT_RENDERED";
  }>;
  relation_acl: Array<{
    grantee: string;
    privileges: string[];
    grantor: typeof DATA_OWNER;
  }>;
  column_acl: Array<{
    grantee: string;
    column: string;
    privileges: string[];
    grantor: typeof DATA_OWNER;
  }>;
  cleanup: {
    cleanup_owner: "U6_JOB";
    cleanup_rank: number;
    cleanup_group: string;
    static_predicate_id: "ALL_SCOPE_ROWS";
    identity_order: string;
  };
  maintenance: {
    reasons: string[];
    preflight_check_ids: string[];
  };
  companion_binding: CompanionBindingDescriptor | null;
  replay_requirements: string[];
  sequences: [];
};

type ExistingRelationMutation = {
  qualified_name: string;
  maintenance_reasons: Array<"ACL" | "ALTER" | "FUNCTION_LOCK" | "IMMEDIATE_FK_PARENT">;
  added_columns: ColumnDescriptor[];
  added_constraints: ConstraintDescriptor[];
  added_indexes: IndexDescriptor[];
  backfill: string[];
  final_defaults_absent: string[];
  preflight_check_ids: string[];
  baseline_catalog_binding: "U6_C1_FROZEN_INVENTORY";
  target_catalog_binding: "U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR";
};

export type U6C2PhysicalSchemaExpectedContext = {
  baseline_migration_name: string;
  baseline_migration_sha256: string;
  baseline_inventory_hash: string;
  c2_migration_name: string;
  c2_source_segments: readonly string[];
  existing_relations: readonly string[];
};

const scopeColumnInputs: ColumnInput[] = [
  { name: "app_id", type: "uuid" },
  { name: "tenant_id", type: "uuid" },
  { name: "environment", type: "text" },
];

const runColumnInput: ColumnInput = { name: "run_id", type: "uuid" };

const receiptCommonColumnInputs: ColumnInput[] = [
  ...scopeColumnInputs,
  { name: "receipt_id", type: "uuid" },
  runColumnInput,
  { name: "protocol_version", type: "text" },
  { name: "issuer_principal_id", type: "uuid" },
  { name: "issuer_capability_id", type: "uuid" },
  { name: "issuer_authority_epoch", type: "bigint" },
  { name: "idempotency_key", type: "text" },
  { name: "input_hash", type: "text" },
  { name: "output_hash", type: "text" },
  { name: "receipt_hash", type: "text" },
  { name: "committed_at", type: "timestamp with time zone" },
];

const referenceColumnInputs = (prefix: string): ColumnInput[] => [
  { name: `${prefix}_ref_json`, type: "jsonb" },
  { name: `${prefix}_artifact_id`, type: "uuid" },
  { name: `${prefix}_artifact_type`, type: "text" },
  { name: `${prefix}_revision`, type: "integer" },
  { name: `${prefix}_content_hash`, type: "text" },
];

function columns(inputs: readonly ColumnInput[], firstAttnum = 1): ColumnDescriptor[] {
  return inputs.map((input, index) => ({
    name: input.name,
    attnum: firstAttnum + index,
    type: input.type,
    nullable: input.nullable ?? false,
    default_expression: input.default_expression ?? null,
    collation: null,
    identity: null,
    generated: null,
  }));
}

function shortCatalogName(identity: string, suffix: string): string {
  const digest = createHash("sha256").update(`${identity}\0${suffix}`).digest("hex").slice(0, 16);
  return `u6_${digest}_${suffix}`;
}

function safeBigintCheck(column: string, minimum = 0): string {
  return `${column} between ${minimum} and ${MAX_SAFE_BIGINT}`;
}

function sqlTextLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function bindingGroupCheckExpression(
  protocol: CompanionBindingDescriptor["binding_group_protocol"],
): string {
  const branches = ["binding_group = 'ROOT'"];
  if (
    protocol === "ROOT_OR_QUERY_CONTRACT_REFERENCE_IDENTITY" ||
    protocol === "ROOT_OR_QUERY_OR_EMBEDDED_REFERENCE_IDENTITY"
  ) {
    branches.push("(binding_group like 'REF:%' and pg_catalog.length(binding_group) > 4)");
  }
  if (
    protocol === "ROOT_OR_EMBEDDED_REFERENCE_IDENTITY" ||
    protocol === "ROOT_OR_QUERY_OR_EMBEDDED_REFERENCE_IDENTITY"
  ) {
    branches.push("(binding_group like 'EMBEDDED:%' and pg_catalog.length(binding_group) > 9)");
  }
  return branches.join(" or ");
}

function primaryKey(relation: string, keyColumns: string[]): ConstraintDescriptor {
  return {
    name: shortCatalogName(relation, "pk"),
    kind: "PRIMARY_KEY",
    columns: keyColumns,
    expression: null,
    referenced_relation: null,
    referenced_columns: [],
    match_type: null,
    on_update: null,
    on_delete: null,
    deferrable: false,
    initially_deferred: false,
  };
}

function uniqueConstraint(
  relation: string,
  suffix: string,
  keyColumns: string[],
): ConstraintDescriptor {
  return {
    name: shortCatalogName(relation, suffix),
    kind: "UNIQUE",
    columns: keyColumns,
    expression: null,
    referenced_relation: null,
    referenced_columns: [],
    match_type: null,
    on_update: null,
    on_delete: null,
    deferrable: false,
    initially_deferred: false,
  };
}

function foreignKey(
  relation: string,
  suffix: string,
  keyColumns: string[],
  referencedRelation: string,
  referencedColumns: string[],
): ConstraintDescriptor {
  return {
    name: shortCatalogName(relation, suffix),
    kind: "FOREIGN_KEY",
    columns: keyColumns,
    expression: null,
    referenced_relation: referencedRelation,
    referenced_columns: referencedColumns,
    match_type: "SIMPLE",
    on_update: "NO ACTION",
    on_delete: "RESTRICT",
    deferrable: false,
    initially_deferred: false,
  };
}

function checkConstraint(
  relation: string,
  suffix: string,
  expression: string,
): ConstraintDescriptor {
  return {
    name: shortCatalogName(relation, suffix),
    kind: "CHECK",
    columns: [],
    expression,
    referenced_relation: null,
    referenced_columns: [],
    match_type: null,
    on_update: null,
    on_delete: null,
    deferrable: false,
    initially_deferred: false,
  };
}

function backingIndexes(
  relation: string,
  constraints: readonly ConstraintDescriptor[],
): IndexDescriptor[] {
  return constraints
    .filter(({ kind }) => kind === "PRIMARY_KEY" || kind === "UNIQUE")
    .map((constraint) => ({
      name: shortCatalogName(relation, `${constraint.name.slice(3, 11)}_idx`),
      unique: true,
      method: "btree" as const,
      columns: [...constraint.columns],
      include: [],
      predicate: null,
      backs_constraint: constraint.name,
    }));
}

function supportingIndexes(
  relation: string,
  constraints: readonly ConstraintDescriptor[],
): IndexDescriptor[] {
  return constraints
    .filter(({ kind }) => kind === "FOREIGN_KEY")
    .map((constraint) => ({
      name: shortCatalogName(relation, `${constraint.name.slice(3, 11)}_fk_idx`),
      unique: false,
      method: "btree" as const,
      columns: [...constraint.columns],
      include: [],
      predicate: null,
      backs_constraint: null,
    }));
}

function artifactReferenceForeignKey(relation: string, prefix: string): ConstraintDescriptor {
  return foreignKey(
    relation,
    `${prefix}_artifact_fk`,
    [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      `${prefix}_artifact_id`,
      `${prefix}_artifact_type`,
      `${prefix}_revision`,
      `${prefix}_content_hash`,
    ],
    "app_data_agent.artifacts",
    [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "artifact_id",
      "artifact_type",
      "revision",
      "content_hash",
    ],
  );
}

function commonRunForeignKey(relation: string): ConstraintDescriptor {
  return foreignKey(
    relation,
    "run_fk",
    ["app_id", "tenant_id", "environment", "run_id"],
    "app_data_agent.runs",
    ["app_id", "tenant_id", "environment", "run_id"],
  );
}

function commonReceiptConstraints(relation: string): ConstraintDescriptor[] {
  return [
    primaryKey(relation, ["app_id", "tenant_id", "environment", "receipt_id"]),
    uniqueConstraint(relation, "receipt_exact_uq", [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "receipt_id",
      "receipt_hash",
    ]),
    uniqueConstraint(relation, "receipt_idempotency_uq", [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "issuer_principal_id",
      "idempotency_key",
    ]),
    uniqueConstraint(relation, "receipt_semantic_uq", [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "protocol_version",
      "input_hash",
    ]),
    commonRunForeignKey(relation),
    foreignKey(
      relation,
      "issuer_membership_fk",
      ["app_id", "tenant_id", "environment", "issuer_principal_id"],
      "app_data_agent.memberships",
      ["app_id", "tenant_id", "environment", "principal_id"],
    ),
    foreignKey(
      relation,
      "issuer_capability_fk",
      [
        "app_id",
        "tenant_id",
        "environment",
        "issuer_capability_id",
        "issuer_authority_epoch",
        "issuer_principal_id",
      ],
      "app_data_agent.research_authority_capabilities",
      ["app_id", "tenant_id", "environment", "capability_id", "authority_epoch", "principal_id"],
    ),
    checkConstraint(
      relation,
      "receipt_hashes_ck",
      "input_hash ~ '^sha256:[0-9a-f]{64}$' and output_hash ~ '^sha256:[0-9a-f]{64}$' and receipt_hash ~ '^sha256:[0-9a-f]{64}$'",
    ),
  ];
}

function defaultPolicies(relation: string, provisionable: boolean): RelationDescriptor["policies"] {
  const policies: RelationDescriptor["policies"] = [
    {
      name: shortCatalogName(relation, "rpc_scope_pol"),
      command: "ALL",
      roles: ["data_agent_u6_rpc_owner"],
      permissive: true,
      using: "u6_current_scope_matches_row(app_id, tenant_id, environment)",
      with_check: "u6_current_scope_matches_row(app_id, tenant_id, environment)",
      expression_binding: "FINAL_10600_SQL_NOT_RENDERED",
    },
    {
      name: shortCatalogName(relation, "cleanup_scope_pol"),
      command: "DELETE",
      roles: ["data_agent_u6_cleanup_owner"],
      permissive: true,
      using: "u6_cleanup_scope_matches_row(app_id, environment)",
      with_check: null,
      expression_binding: "FINAL_10600_SQL_NOT_RENDERED",
    },
  ];
  if (provisionable) {
    policies.push({
      name: shortCatalogName(relation, "provision_scope_pol"),
      command: "ALL",
      roles: ["data_agent_u6_provisioner_owner"],
      permissive: true,
      using: "u6_current_scope_matches_row(app_id, tenant_id, environment)",
      with_check: "u6_current_scope_matches_row(app_id, tenant_id, environment)",
      expression_binding: "FINAL_10600_SQL_NOT_RENDERED",
    });
  }
  return policies;
}

function relationAcl(
  provisionable: boolean,
  mutationMode: RelationDescriptor["mutation_mode"],
): RelationDescriptor["relation_acl"] {
  const writerPrivileges =
    mutationMode === "MUTABLE_CURRENT_HEAD" ? ["INSERT", "SELECT", "UPDATE"] : ["INSERT", "SELECT"];
  const entries: RelationDescriptor["relation_acl"] = [
    {
      grantee: DATA_OWNER,
      privileges: ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "UPDATE"],
      grantor: DATA_OWNER,
    },
    {
      grantee: "data_agent_u6_rpc_owner",
      privileges: [...writerPrivileges],
      grantor: DATA_OWNER,
    },
    {
      grantee: "data_agent_u6_cleanup_owner",
      privileges: ["DELETE", "SELECT"],
      grantor: DATA_OWNER,
    },
  ];
  if (provisionable) {
    entries.push({
      grantee: "data_agent_u6_provisioner_owner",
      privileges: [...writerPrivileges],
      grantor: DATA_OWNER,
    });
  }
  return entries;
}

function relationDescriptor(input: {
  qualified_name: string;
  surface_kind?: "COMPANION" | "CORE";
  mutation_mode?: "APPEND_ONLY" | "MUTABLE_CURRENT_HEAD";
  wire_protocols: string[];
  column_inputs: ColumnInput[];
  constraints: ConstraintDescriptor[];
  cleanup_rank: number;
  cleanup_group: string;
  identity_order?: string;
  provisionable?: boolean;
  companion_binding?: CompanionBindingDescriptor | null;
  replay_requirements: string[];
}): RelationDescriptor {
  const mutationMode = input.mutation_mode ?? "APPEND_ONLY";
  const provisionable = input.provisionable ?? false;
  const allIndexes = [
    ...backingIndexes(input.qualified_name, input.constraints),
    ...supportingIndexes(input.qualified_name, input.constraints),
  ];
  return {
    qualified_name: input.qualified_name,
    surface_kind: input.surface_kind ?? "CORE",
    mutation_mode: mutationMode,
    wire_protocols: input.wire_protocols,
    owner: DATA_OWNER,
    columns: columns(input.column_inputs),
    constraints: input.constraints,
    indexes: allIndexes,
    triggers:
      mutationMode === "APPEND_ONLY"
        ? [
            {
              name: shortCatalogName(input.qualified_name, "immutable_trg"),
              timing: "BEFORE",
              events: ["DELETE", "UPDATE"],
              orientation: "ROW",
              enabled: "ORIGIN",
              function_signature: "platform.reject_immutable_mutation()",
              function_body_hash_binding: "FUNCTION_BODY_HASHES_NOT_FROZEN",
            },
          ]
        : [],
    rls: { enabled: true, forced: true },
    policies: defaultPolicies(input.qualified_name, provisionable),
    relation_acl: relationAcl(provisionable, mutationMode),
    column_acl: [],
    cleanup: {
      cleanup_owner: "U6_JOB",
      cleanup_rank: input.cleanup_rank,
      cleanup_group: input.cleanup_group,
      static_predicate_id: "ALL_SCOPE_ROWS",
      identity_order: input.identity_order ?? "FULL_PK_ASC",
    },
    maintenance: {
      reasons: [],
      preflight_check_ids: [],
    },
    companion_binding: input.companion_binding ?? null,
    replay_requirements: input.replay_requirements,
    sequences: [],
  };
}

const coreRelationNames = [
  "app_data_agent.research_backend_artifact_commit_operations",
  "app_data_agent.research_budget_events",
  "app_data_agent.research_budget_ledger_receipts",
  "app_data_agent.research_budget_policy_heads",
  "app_data_agent.research_budget_policy_versions",
  "app_data_agent.research_candidate_enumeration_receipts",
  "app_data_agent.research_candidate_enumerator_attestations",
  "app_data_agent.research_coverage_derivation_receipts",
  "app_data_agent.research_enumerator_version_heads",
  "app_data_agent.research_enumerator_versions",
  "app_data_agent.research_input_event_heads",
  "app_data_agent.research_input_event_watermark_receipts",
  "app_data_agent.research_input_events",
  "app_data_agent.research_step_operations",
  "app_data_agent.research_stop_derivation_receipts",
] as const;

const companionRelationNames = [
  "app_data_agent.research_budget_ledger_input_bindings",
  "app_data_agent.research_candidate_attestation_ref_bindings",
  "app_data_agent.research_candidate_enumeration_ref_bindings",
  "app_data_agent.research_coverage_derivation_ref_bindings",
  "app_data_agent.research_stop_derivation_ref_bindings",
] as const;

const existingRelationNames = [
  "app_data_agent.artifacts",
  "app_data_agent.memberships",
  "app_data_agent.outbox",
  "app_data_agent.research_artifact_commit_operations",
  "app_data_agent.research_authority_capabilities",
  "app_data_agent.research_domain_terminals",
  "app_data_agent.research_resource_reservations",
  "app_data_agent.research_resource_run_heads",
  "app_data_agent.research_stop_terminal_commits",
  "app_data_agent.run_attempts",
  "app_data_agent.runs",
] as const;

const c1SourceSegments = [
  "00-preamble.sql.inc",
  "10-existing-table-alterations.sql.inc",
  "20-capability-key-metadata.sql.inc",
  "30-artifact-authority.sql.inc",
  "40-frontier-readiness.sql.inc",
  "50-resource.sql.inc",
  "60-invocation-system-records.sql.inc",
  "70-cross-fks-indexes-triggers.sql.inc",
  "80-internal-functions.sql.inc",
  "81-root-rpcs.sql.inc",
  "82-resource-invocation-rpcs.sql.inc",
  "83-resolvers-provisioner.sql.inc",
  "84-lifecycle-cleanup.sql.inc",
  "90-rls-owner-grants.sql.inc",
  "99-postconditions-commit.sql.inc",
] as const;

const c2SourceSegments = [
  "00-preamble.sql.inc",
  "10-existing-relation-preflight-alterations.sql.inc",
  "20-budget-policy-events.sql.inc",
  "30-derivation-receipts.sql.inc",
  "40-input-event-watermark.sql.inc",
  "50-terminal-receipt-links.sql.inc",
  "60-cross-fks-indexes-triggers.sql.inc",
  "70-internal-functions.sql.inc",
  "71-run-locked-artifact-rpcs.sql.inc",
  "72-budget-resource-guard-rpcs.sql.inc",
  "73-stop-root-rpcs.sql.inc",
  "74-resolvers-provisioner.sql.inc",
  "80-lifecycle-cleanup.sql.inc",
  "90-rls-owner-grants.sql.inc",
  "99-postconditions-ledger-commit.sql.inc",
] as const;

const policyVersionRelation = "app_data_agent.research_budget_policy_versions";
const policyVersionConstraints = [
  primaryKey(policyVersionRelation, [
    "app_id",
    "tenant_id",
    "environment",
    "tenant_policy_version",
  ]),
  uniqueConstraint(policyVersionRelation, "policy_hash_uq", [
    "app_id",
    "tenant_id",
    "environment",
    "tenant_policy_version",
    "tenant_policy_hash",
  ]),
  checkConstraint(
    policyVersionRelation,
    "policy_hash_ck",
    "tenant_policy_hash ~ '^sha256:[0-9a-f]{64}$'",
  ),
];

const policyHeadRelation = "app_data_agent.research_budget_policy_heads";
const policyHeadConstraints = [
  primaryKey(policyHeadRelation, ["app_id", "tenant_id", "environment"]),
  foreignKey(
    policyHeadRelation,
    "policy_version_fk",
    [
      "app_id",
      "tenant_id",
      "environment",
      "current_tenant_policy_version",
      "current_tenant_policy_hash",
    ],
    policyVersionRelation,
    ["app_id", "tenant_id", "environment", "tenant_policy_version", "tenant_policy_hash"],
  ),
  checkConstraint(policyHeadRelation, "head_version_ck", safeBigintCheck("head_version")),
];

const enumeratorVersionRelation = "app_data_agent.research_enumerator_versions";
const enumeratorVersionConstraints = [
  primaryKey(enumeratorVersionRelation, [
    "app_id",
    "tenant_id",
    "environment",
    "enumerator_version",
  ]),
  uniqueConstraint(enumeratorVersionRelation, "enumerator_hash_uq", [
    "app_id",
    "tenant_id",
    "environment",
    "enumerator_version",
    "enumerator_version_hash",
  ]),
  uniqueConstraint(enumeratorVersionRelation, "enumerator_binding_uq", [
    "app_id",
    "tenant_id",
    "environment",
    "enumerator_version",
    "eig_policy_version",
    "implementation_digest",
  ]),
  checkConstraint(
    enumeratorVersionRelation,
    "enumerator_hash_ck",
    "enumerator_version_hash ~ '^sha256:[0-9a-f]{64}$' and implementation_digest ~ '^sha256:[0-9a-f]{64}$'",
  ),
];

const enumeratorHeadRelation = "app_data_agent.research_enumerator_version_heads";
const enumeratorHeadConstraints = [
  primaryKey(enumeratorHeadRelation, ["app_id", "tenant_id", "environment"]),
  foreignKey(
    enumeratorHeadRelation,
    "enumerator_version_fk",
    [
      "app_id",
      "tenant_id",
      "environment",
      "current_enumerator_version",
      "current_enumerator_version_hash",
    ],
    enumeratorVersionRelation,
    ["app_id", "tenant_id", "environment", "enumerator_version", "enumerator_version_hash"],
  ),
  checkConstraint(enumeratorHeadRelation, "head_version_ck", safeBigintCheck("head_version")),
];

const budgetEventRelation = "app_data_agent.research_budget_events";
const stepRelation = "app_data_agent.research_step_operations";
const budgetEventConstraints = [
  primaryKey(budgetEventRelation, [
    "app_id",
    "tenant_id",
    "environment",
    "run_id",
    "budget_epoch",
    "budget_event_seq",
  ]),
  uniqueConstraint(budgetEventRelation, "event_exact_uq", [
    "app_id",
    "tenant_id",
    "environment",
    "run_id",
    "budget_epoch",
    "budget_event_seq",
    "event_hash",
  ]),
  uniqueConstraint(budgetEventRelation, "source_operation_uq", [
    "app_id",
    "tenant_id",
    "environment",
    "run_id",
    "source_operation_kind",
    "source_operation_id",
  ]),
  commonRunForeignKey(budgetEventRelation),
  foreignKey(
    budgetEventRelation,
    "resource_head_fk",
    ["app_id", "tenant_id", "environment", "run_id"],
    "app_data_agent.research_resource_run_heads",
    ["app_id", "tenant_id", "environment", "run_id"],
  ),
  foreignKey(
    budgetEventRelation,
    "reservation_fk",
    ["app_id", "tenant_id", "environment", "run_id", "reservation_id", "budget_epoch"],
    "app_data_agent.research_resource_reservations",
    ["app_id", "tenant_id", "environment", "run_id", "reservation_id", "budget_epoch"],
  ),
  foreignKey(
    budgetEventRelation,
    "reservation_step_binding_fk",
    [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "reservation_id",
      "budget_epoch",
      "logical_step_id",
    ],
    "app_data_agent.research_resource_reservations",
    [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "reservation_id",
      "budget_epoch",
      "logical_step_id",
    ],
  ),
  foreignKey(
    budgetEventRelation,
    "step_fk",
    ["app_id", "tenant_id", "environment", "run_id", "budget_epoch", "logical_step_id"],
    stepRelation,
    ["app_id", "tenant_id", "environment", "run_id", "budget_epoch", "logical_step_id"],
  ),
  checkConstraint(
    budgetEventRelation,
    "event_seq_ck",
    `${safeBigintCheck("budget_epoch", 1)} and ${safeBigintCheck("budget_event_seq", 1)}`,
  ),
  checkConstraint(
    budgetEventRelation,
    "event_hash_ck",
    "event_hash ~ '^sha256:[0-9a-f]{64}$' and previous_event_hash ~ '^sha256:[0-9a-f]{64}$'",
  ),
  checkConstraint(
    budgetEventRelation,
    "event_parent_branch_ck",
    "(event_kind = 'BUDGET_OPENED' and reservation_id is null and logical_step_id is null) or (event_kind = 'STEP_BEGIN' and reservation_id is null and logical_step_id is not null) or (event_kind in ('RESERVED','BEGUN','SETTLED','CANCELLED','EXPIRED','ABANDONED') and reservation_id is not null)",
  ),
];

const stepConstraints = [
  primaryKey(stepRelation, ["app_id", "tenant_id", "environment", "step_operation_id"]),
  uniqueConstraint(stepRelation, "logical_step_exact_uq", [
    "app_id",
    "tenant_id",
    "environment",
    "run_id",
    "budget_epoch",
    "logical_step_id",
  ]),
  uniqueConstraint(stepRelation, "step_seq_uq", [
    "app_id",
    "tenant_id",
    "environment",
    "run_id",
    "budget_epoch",
    "step_seq",
  ]),
  uniqueConstraint(stepRelation, "principal_idempotency_uq", [
    "app_id",
    "tenant_id",
    "environment",
    "run_id",
    "principal_id",
    "idempotency_key",
  ]),
  foreignKey(
    stepRelation,
    "issuer_membership_fk",
    ["app_id", "tenant_id", "environment", "principal_id"],
    "app_data_agent.memberships",
    ["app_id", "tenant_id", "environment", "principal_id"],
  ),
  foreignKey(
    stepRelation,
    "run_principal_fk",
    ["app_id", "tenant_id", "environment", "run_id", "principal_id"],
    "app_data_agent.runs",
    ["app_id", "tenant_id", "environment", "run_id", "principal_id"],
  ),
  foreignKey(
    stepRelation,
    "outbox_fk",
    ["app_id", "tenant_id", "environment", "outbox_id", "run_id"],
    "app_data_agent.outbox",
    ["app_id", "tenant_id", "environment", "outbox_id", "run_id"],
  ),
  foreignKey(
    stepRelation,
    "attempt_fence_fk",
    ["app_id", "tenant_id", "environment", "attempt_id", "outbox_id", "run_id", "worker_fence"],
    "app_data_agent.run_attempts",
    ["app_id", "tenant_id", "environment", "attempt_id", "outbox_id", "run_id", "worker_fence"],
  ),
  foreignKey(
    stepRelation,
    "parent_step_fk",
    ["app_id", "tenant_id", "environment", "run_id", "budget_epoch", "parent_logical_step_id"],
    stepRelation,
    ["app_id", "tenant_id", "environment", "run_id", "budget_epoch", "logical_step_id"],
  ),
  checkConstraint(
    stepRelation,
    "step_seq_ck",
    `${safeBigintCheck("budget_epoch", 1)} and ${safeBigintCheck("step_seq", 1)}`,
  ),
];

const budgetReceiptRelation = "app_data_agent.research_budget_ledger_receipts";
const budgetReceiptConstraints = [
  ...commonReceiptConstraints(budgetReceiptRelation),
  artifactReferenceForeignKey(budgetReceiptRelation, "research_brief"),
  foreignKey(
    budgetReceiptRelation,
    "tenant_policy_version_fk",
    ["app_id", "tenant_id", "environment", "tenant_policy_version", "tenant_policy_hash"],
    policyVersionRelation,
    ["app_id", "tenant_id", "environment", "tenant_policy_version", "tenant_policy_hash"],
  ),
  foreignKey(
    budgetReceiptRelation,
    "resource_head_fk",
    ["app_id", "tenant_id", "environment", "run_id"],
    "app_data_agent.research_resource_run_heads",
    ["app_id", "tenant_id", "environment", "run_id"],
  ),
  checkConstraint(
    budgetReceiptRelation,
    "budget_protocol_ck",
    "protocol_version = 'research-budget-ledger-receipt@2.0.0'",
  ),
  checkConstraint(
    budgetReceiptRelation,
    "budget_watermark_ck",
    "evaluated_through_reservation_seq between 0 and 9007199254740991 and evaluated_through_budget_event_seq between 0 and 9007199254740991",
  ),
];

const coverageReceiptRelation = "app_data_agent.research_coverage_derivation_receipts";
const coverageReceiptConstraints = [
  ...commonReceiptConstraints(coverageReceiptRelation),
  artifactReferenceForeignKey(coverageReceiptRelation, "coverage"),
  artifactReferenceForeignKey(coverageReceiptRelation, "evidence_plan"),
  foreignKey(
    coverageReceiptRelation,
    "budget_receipt_fk",
    ["app_id", "tenant_id", "environment", "run_id", "budget_receipt_id", "budget_receipt_hash"],
    budgetReceiptRelation,
    ["app_id", "tenant_id", "environment", "run_id", "receipt_id", "receipt_hash"],
  ),
  checkConstraint(
    coverageReceiptRelation,
    "coverage_protocol_ck",
    "protocol_version = 'coverage-derivation-receipt@1.0.0'",
  ),
];

const attestationRelation = "app_data_agent.research_candidate_enumerator_attestations";
const attestationConstraints = [
  primaryKey(attestationRelation, ["app_id", "tenant_id", "environment", "attestation_id"]),
  uniqueConstraint(attestationRelation, "attestation_exact_uq", [
    "app_id",
    "tenant_id",
    "environment",
    "run_id",
    "attestation_id",
    "attestation_hash",
  ]),
  uniqueConstraint(attestationRelation, "attestation_idempotency_uq", [
    "app_id",
    "tenant_id",
    "environment",
    "run_id",
    "issuer_principal_id",
    "idempotency_key",
  ]),
  uniqueConstraint(attestationRelation, "attestation_semantic_uq", [
    "app_id",
    "tenant_id",
    "environment",
    "run_id",
    "coverage_artifact_id",
    "coverage_artifact_type",
    "coverage_revision",
    "coverage_content_hash",
    "budget_receipt_id",
    "budget_receipt_hash",
    "enumerator_version",
    "eig_policy_version",
    "enumeration_universe_hash",
  ]),
  uniqueConstraint(attestationRelation, "attestation_candidate_binding_uq", [
    "app_id",
    "tenant_id",
    "environment",
    "run_id",
    "attestation_id",
    "attestation_hash",
    "issuer_principal_id",
    "issuer_capability_id",
    "issuer_authority_epoch",
    "budget_receipt_id",
    "budget_receipt_hash",
    "enumerator_version",
    "eig_policy_version",
    "enumeration_universe_hash",
    "candidate_set_hash",
  ]),
  commonRunForeignKey(attestationRelation),
  foreignKey(
    attestationRelation,
    "issuer_membership_fk",
    ["app_id", "tenant_id", "environment", "issuer_principal_id"],
    "app_data_agent.memberships",
    ["app_id", "tenant_id", "environment", "principal_id"],
  ),
  foreignKey(
    attestationRelation,
    "issuer_capability_fk",
    [
      "app_id",
      "tenant_id",
      "environment",
      "issuer_capability_id",
      "issuer_authority_epoch",
      "issuer_principal_id",
    ],
    "app_data_agent.research_authority_capabilities",
    ["app_id", "tenant_id", "environment", "capability_id", "authority_epoch", "principal_id"],
  ),
  foreignKey(
    attestationRelation,
    "enumerator_version_fk",
    [
      "app_id",
      "tenant_id",
      "environment",
      "enumerator_version",
      "eig_policy_version",
      "implementation_digest",
    ],
    enumeratorVersionRelation,
    [
      "app_id",
      "tenant_id",
      "environment",
      "enumerator_version",
      "eig_policy_version",
      "implementation_digest",
    ],
  ),
  artifactReferenceForeignKey(attestationRelation, "coverage"),
  foreignKey(
    attestationRelation,
    "budget_receipt_fk",
    ["app_id", "tenant_id", "environment", "run_id", "budget_receipt_id", "budget_receipt_hash"],
    budgetReceiptRelation,
    ["app_id", "tenant_id", "environment", "run_id", "receipt_id", "receipt_hash"],
  ),
  checkConstraint(
    attestationRelation,
    "attestation_hashes_ck",
    "input_hash ~ '^sha256:[0-9a-f]{64}$' and attestation_hash ~ '^sha256:[0-9a-f]{64}$'",
  ),
];

const candidateReceiptRelation = "app_data_agent.research_candidate_enumeration_receipts";
const candidateReceiptConstraints = [
  ...commonReceiptConstraints(candidateReceiptRelation),
  foreignKey(
    candidateReceiptRelation,
    "coverage_receipt_fk",
    [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "coverage_receipt_id",
      "coverage_receipt_hash",
    ],
    coverageReceiptRelation,
    ["app_id", "tenant_id", "environment", "run_id", "receipt_id", "receipt_hash"],
  ),
  foreignKey(
    candidateReceiptRelation,
    "budget_receipt_fk",
    ["app_id", "tenant_id", "environment", "run_id", "budget_receipt_id", "budget_receipt_hash"],
    budgetReceiptRelation,
    ["app_id", "tenant_id", "environment", "run_id", "receipt_id", "receipt_hash"],
  ),
  foreignKey(
    candidateReceiptRelation,
    "attestation_fk",
    [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "enumerator_attestation_id",
      "enumerator_attestation_hash",
      "issuer_principal_id",
      "issuer_capability_id",
      "issuer_authority_epoch",
      "budget_receipt_id",
      "budget_receipt_hash",
      "enumerator_version",
      "eig_policy_version",
      "enumeration_universe_hash",
      "candidate_set_hash",
    ],
    attestationRelation,
    [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "attestation_id",
      "attestation_hash",
      "issuer_principal_id",
      "issuer_capability_id",
      "issuer_authority_epoch",
      "budget_receipt_id",
      "budget_receipt_hash",
      "enumerator_version",
      "eig_policy_version",
      "enumeration_universe_hash",
      "candidate_set_hash",
    ],
  ),
  checkConstraint(
    candidateReceiptRelation,
    "candidate_protocol_ck",
    "protocol_version = 'candidate-enumeration-receipt@2.0.0'",
  ),
  checkConstraint(
    candidateReceiptRelation,
    "enumerator_head_version_ck",
    "enumerator_head_version between 0 and 9007199254740991",
  ),
  checkConstraint(
    candidateReceiptRelation,
    "enumerator_issuer_authority_ck",
    "enumerator_capability_id = issuer_capability_id and enumerator_authority_epoch = issuer_authority_epoch",
  ),
];

const stopReceiptRelation = "app_data_agent.research_stop_derivation_receipts";
const stopReceiptConstraints = [
  ...commonReceiptConstraints(stopReceiptRelation),
  artifactReferenceForeignKey(stopReceiptRelation, "stop"),
  artifactReferenceForeignKey(stopReceiptRelation, "coverage"),
  ...(
    [
      ["coverage", coverageReceiptRelation],
      ["candidate", candidateReceiptRelation],
      ["budget", budgetReceiptRelation],
    ] as const
  ).map(([prefix, target]) =>
    foreignKey(
      stopReceiptRelation,
      `${prefix}_receipt_fk`,
      [
        "app_id",
        "tenant_id",
        "environment",
        "run_id",
        `${prefix}_receipt_id`,
        `${prefix}_receipt_hash`,
      ],
      target,
      ["app_id", "tenant_id", "environment", "run_id", "receipt_id", "receipt_hash"],
    ),
  ),
  checkConstraint(
    stopReceiptRelation,
    "stop_protocol_ck",
    "protocol_version = 'research-stop-derivation-receipt@2.0.0'",
  ),
];

const inputHeadRelation = "app_data_agent.research_input_event_heads";
const inputHeadConstraints = [
  primaryKey(inputHeadRelation, ["app_id", "tenant_id", "environment", "run_id"]),
  commonRunForeignKey(inputHeadRelation),
  checkConstraint(inputHeadRelation, "next_event_seq_ck", safeBigintCheck("next_event_seq", 1)),
];

const inputEventRelation = "app_data_agent.research_input_events";
const inputEventConstraints = [
  primaryKey(inputEventRelation, ["app_id", "tenant_id", "environment", "run_id", "event_seq"]),
  uniqueConstraint(inputEventRelation, "event_exact_uq", [
    "app_id",
    "tenant_id",
    "environment",
    "run_id",
    "event_seq",
    "event_hash",
  ]),
  uniqueConstraint(inputEventRelation, "source_operation_uq", [
    "app_id",
    "tenant_id",
    "environment",
    "run_id",
    "source_operation_kind",
    "source_operation_id",
  ]),
  commonRunForeignKey(inputEventRelation),
  foreignKey(
    inputEventRelation,
    "input_event_head_fk",
    ["app_id", "tenant_id", "environment", "run_id"],
    inputHeadRelation,
    ["app_id", "tenant_id", "environment", "run_id"],
  ),
  checkConstraint(inputEventRelation, "event_seq_ck", safeBigintCheck("event_seq", 1)),
];

const watermarkReceiptRelation = "app_data_agent.research_input_event_watermark_receipts";
const watermarkReceiptConstraints = [
  ...commonReceiptConstraints(watermarkReceiptRelation),
  artifactReferenceForeignKey(watermarkReceiptRelation, "certificate"),
  foreignKey(
    watermarkReceiptRelation,
    "input_event_head_fk",
    ["app_id", "tenant_id", "environment", "run_id"],
    inputHeadRelation,
    ["app_id", "tenant_id", "environment", "run_id"],
  ),
  checkConstraint(
    watermarkReceiptRelation,
    "watermark_protocol_ck",
    "protocol_version = 'research-input-watermark-receipt@1.0.0'",
  ),
];

const backendOperationRelation = "app_data_agent.research_backend_artifact_commit_operations";
const backendOperationConstraints = [
  primaryKey(backendOperationRelation, ["app_id", "tenant_id", "environment", "operation_id"]),
  uniqueConstraint(backendOperationRelation, "idempotency_uq", [
    "app_id",
    "tenant_id",
    "environment",
    "run_id",
    "principal_id",
    "idempotency_key",
  ]),
  foreignKey(
    backendOperationRelation,
    "principal_membership_fk",
    ["app_id", "tenant_id", "environment", "principal_id"],
    "app_data_agent.memberships",
    ["app_id", "tenant_id", "environment", "principal_id"],
  ),
  foreignKey(
    backendOperationRelation,
    "run_principal_fk",
    ["app_id", "tenant_id", "environment", "run_id", "principal_id"],
    "app_data_agent.runs",
    ["app_id", "tenant_id", "environment", "run_id", "principal_id"],
  ),
  artifactReferenceForeignKey(backendOperationRelation, "committed_artifact"),
  checkConstraint(
    backendOperationRelation,
    "command_hash_ck",
    "command_hash ~ '^sha256:[0-9a-f]{64}$'",
  ),
];

type ForeignKeyEdge = {
  child_relation: string;
  child_columns: readonly string[];
  parent_relation: string;
  parent_columns: readonly string[];
};

const mandatoryAuthorityForeignKeyEdges: readonly ForeignKeyEdge[] = [
  {
    child_relation: stepRelation,
    child_columns: ["app_id", "tenant_id", "environment", "principal_id"],
    parent_relation: "app_data_agent.memberships",
    parent_columns: ["app_id", "tenant_id", "environment", "principal_id"],
  },
  {
    child_relation: stepRelation,
    child_columns: ["app_id", "tenant_id", "environment", "run_id", "principal_id"],
    parent_relation: "app_data_agent.runs",
    parent_columns: ["app_id", "tenant_id", "environment", "run_id", "principal_id"],
  },
  {
    child_relation: stepRelation,
    child_columns: ["app_id", "tenant_id", "environment", "outbox_id", "run_id"],
    parent_relation: "app_data_agent.outbox",
    parent_columns: ["app_id", "tenant_id", "environment", "outbox_id", "run_id"],
  },
  {
    child_relation: stepRelation,
    child_columns: [
      "app_id",
      "tenant_id",
      "environment",
      "attempt_id",
      "outbox_id",
      "run_id",
      "worker_fence",
    ],
    parent_relation: "app_data_agent.run_attempts",
    parent_columns: [
      "app_id",
      "tenant_id",
      "environment",
      "attempt_id",
      "outbox_id",
      "run_id",
      "worker_fence",
    ],
  },
  {
    child_relation: stepRelation,
    child_columns: [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "budget_epoch",
      "parent_logical_step_id",
    ],
    parent_relation: stepRelation,
    parent_columns: [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "budget_epoch",
      "logical_step_id",
    ],
  },
  {
    child_relation: backendOperationRelation,
    child_columns: ["app_id", "tenant_id", "environment", "principal_id"],
    parent_relation: "app_data_agent.memberships",
    parent_columns: ["app_id", "tenant_id", "environment", "principal_id"],
  },
  {
    child_relation: backendOperationRelation,
    child_columns: ["app_id", "tenant_id", "environment", "run_id", "principal_id"],
    parent_relation: "app_data_agent.runs",
    parent_columns: ["app_id", "tenant_id", "environment", "run_id", "principal_id"],
  },
  {
    child_relation: attestationRelation,
    child_columns: ["app_id", "tenant_id", "environment", "issuer_principal_id"],
    parent_relation: "app_data_agent.memberships",
    parent_columns: ["app_id", "tenant_id", "environment", "principal_id"],
  },
  {
    child_relation: attestationRelation,
    child_columns: [
      "app_id",
      "tenant_id",
      "environment",
      "issuer_capability_id",
      "issuer_authority_epoch",
      "issuer_principal_id",
    ],
    parent_relation: "app_data_agent.research_authority_capabilities",
    parent_columns: [
      "app_id",
      "tenant_id",
      "environment",
      "capability_id",
      "authority_epoch",
      "principal_id",
    ],
  },
  {
    child_relation: attestationRelation,
    child_columns: [
      "app_id",
      "tenant_id",
      "environment",
      "enumerator_version",
      "eig_policy_version",
      "implementation_digest",
    ],
    parent_relation: enumeratorVersionRelation,
    parent_columns: [
      "app_id",
      "tenant_id",
      "environment",
      "enumerator_version",
      "eig_policy_version",
      "implementation_digest",
    ],
  },
  {
    child_relation: budgetReceiptRelation,
    child_columns: [
      "app_id",
      "tenant_id",
      "environment",
      "tenant_policy_version",
      "tenant_policy_hash",
    ],
    parent_relation: policyVersionRelation,
    parent_columns: [
      "app_id",
      "tenant_id",
      "environment",
      "tenant_policy_version",
      "tenant_policy_hash",
    ],
  },
  {
    child_relation: budgetReceiptRelation,
    child_columns: ["app_id", "tenant_id", "environment", "run_id"],
    parent_relation: "app_data_agent.research_resource_run_heads",
    parent_columns: ["app_id", "tenant_id", "environment", "run_id"],
  },
  {
    child_relation: budgetEventRelation,
    child_columns: ["app_id", "tenant_id", "environment", "run_id"],
    parent_relation: "app_data_agent.research_resource_run_heads",
    parent_columns: ["app_id", "tenant_id", "environment", "run_id"],
  },
  {
    child_relation: budgetEventRelation,
    child_columns: [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "reservation_id",
      "budget_epoch",
    ],
    parent_relation: "app_data_agent.research_resource_reservations",
    parent_columns: [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "reservation_id",
      "budget_epoch",
    ],
  },
  {
    child_relation: budgetEventRelation,
    child_columns: [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "reservation_id",
      "budget_epoch",
      "logical_step_id",
    ],
    parent_relation: "app_data_agent.research_resource_reservations",
    parent_columns: [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "reservation_id",
      "budget_epoch",
      "logical_step_id",
    ],
  },
  {
    child_relation: budgetEventRelation,
    child_columns: [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "budget_epoch",
      "logical_step_id",
    ],
    parent_relation: stepRelation,
    parent_columns: [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "budget_epoch",
      "logical_step_id",
    ],
  },
  {
    child_relation: inputEventRelation,
    child_columns: ["app_id", "tenant_id", "environment", "run_id"],
    parent_relation: inputHeadRelation,
    parent_columns: ["app_id", "tenant_id", "environment", "run_id"],
  },
  {
    child_relation: watermarkReceiptRelation,
    child_columns: ["app_id", "tenant_id", "environment", "run_id"],
    parent_relation: inputHeadRelation,
    parent_columns: ["app_id", "tenant_id", "environment", "run_id"],
  },
  {
    child_relation: candidateReceiptRelation,
    child_columns: [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "enumerator_attestation_id",
      "enumerator_attestation_hash",
      "issuer_principal_id",
      "issuer_capability_id",
      "issuer_authority_epoch",
      "budget_receipt_id",
      "budget_receipt_hash",
      "enumerator_version",
      "eig_policy_version",
      "enumeration_universe_hash",
      "candidate_set_hash",
    ],
    parent_relation: attestationRelation,
    parent_columns: [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "attestation_id",
      "attestation_hash",
      "issuer_principal_id",
      "issuer_capability_id",
      "issuer_authority_epoch",
      "budget_receipt_id",
      "budget_receipt_hash",
      "enumerator_version",
      "eig_policy_version",
      "enumeration_universe_hash",
      "candidate_set_hash",
    ],
  },
];

function foreignKeyEdgeIdentity(edge: ForeignKeyEdge): string {
  return JSON.stringify([
    edge.child_relation,
    edge.child_columns,
    edge.parent_relation,
    edge.parent_columns,
  ]);
}

const artifactCompanionColumns: ColumnInput[] = [
  ...scopeColumnInputs,
  runColumnInput,
  { name: "parent_id", type: "uuid" },
  { name: "parent_hash", type: "text" },
  { name: "canonical_path", type: "text" },
  { name: "binding_group", type: "text" },
  { name: "ordinal", type: "integer" },
  { name: "strict_ref_json", type: "jsonb" },
  { name: "artifact_id", type: "uuid" },
  { name: "artifact_type", type: "text" },
  { name: "revision", type: "integer" },
  { name: "content_hash", type: "text" },
  { name: "node_id", type: "text", nullable: true },
];

function artifactCompanionConstraints(
  relation: string,
  parentRelation: string,
  parentIdColumn: "attestation_id" | "receipt_id",
  parentHashColumn: "attestation_hash" | "receipt_hash",
  allowedPaths: readonly string[],
  bindingGroupProtocol: CompanionBindingDescriptor["binding_group_protocol"],
): ConstraintDescriptor[] {
  return [
    primaryKey(relation, [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "parent_id",
      "parent_hash",
      "canonical_path",
      "binding_group",
      "ordinal",
    ]),
    foreignKey(
      relation,
      "parent_exact_fk",
      ["app_id", "tenant_id", "environment", "run_id", "parent_id", "parent_hash"],
      parentRelation,
      ["app_id", "tenant_id", "environment", "run_id", parentIdColumn, parentHashColumn],
    ),
    foreignKey(
      relation,
      "artifact_exact_fk",
      [
        "app_id",
        "tenant_id",
        "environment",
        "run_id",
        "artifact_id",
        "artifact_type",
        "revision",
        "content_hash",
      ],
      "app_data_agent.artifacts",
      [
        "app_id",
        "tenant_id",
        "environment",
        "run_id",
        "artifact_id",
        "artifact_type",
        "revision",
        "content_hash",
      ],
    ),
    checkConstraint(relation, "ordinal_ck", "ordinal between 0 and 255"),
    checkConstraint(
      relation,
      "canonical_path_ck",
      `canonical_path in (${allowedPaths.map(sqlTextLiteral).join(",")})`,
    ),
    checkConstraint(
      relation,
      "binding_group_ck",
      bindingGroupCheckExpression(bindingGroupProtocol),
    ),
    checkConstraint(
      relation,
      "reference_branch_ck",
      "(node_id is null and not (strict_ref_json ? 'container_ref')) or (node_id is not null and strict_ref_json ? 'container_ref')",
    ),
  ];
}

const budgetBindingRelation = "app_data_agent.research_budget_ledger_input_bindings";
const budgetBindingColumns: ColumnInput[] = [
  ...scopeColumnInputs,
  runColumnInput,
  { name: "parent_id", type: "uuid" },
  { name: "parent_hash", type: "text" },
  { name: "canonical_path", type: "text" },
  { name: "binding_group", type: "text" },
  { name: "ordinal", type: "integer" },
  { name: "strict_ref_json", type: "jsonb", nullable: true },
  { name: "artifact_id", type: "uuid", nullable: true },
  { name: "artifact_type", type: "text", nullable: true },
  { name: "revision", type: "integer", nullable: true },
  { name: "content_hash", type: "text", nullable: true },
  { name: "node_id", type: "text", nullable: true },
  { name: "binding_kind", type: "text" },
  { name: "budget_epoch", type: "bigint", nullable: true },
  { name: "budget_event_seq", type: "bigint", nullable: true },
  { name: "event_hash", type: "text", nullable: true },
  { name: "reservation_id", type: "uuid", nullable: true },
  { name: "reservation_seq", type: "bigint", nullable: true },
  { name: "reservation_state", type: "text", nullable: true },
  { name: "reservation_projection_json", type: "jsonb", nullable: true },
  { name: "reservation_projection_hash", type: "text", nullable: true },
];
const budgetBindingConstraints = [
  primaryKey(budgetBindingRelation, [
    "app_id",
    "tenant_id",
    "environment",
    "run_id",
    "parent_id",
    "parent_hash",
    "canonical_path",
    "binding_group",
    "ordinal",
  ]),
  foreignKey(
    budgetBindingRelation,
    "parent_exact_fk",
    ["app_id", "tenant_id", "environment", "run_id", "parent_id", "parent_hash"],
    budgetReceiptRelation,
    ["app_id", "tenant_id", "environment", "run_id", "receipt_id", "receipt_hash"],
  ),
  foreignKey(
    budgetBindingRelation,
    "artifact_exact_fk",
    [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "artifact_id",
      "artifact_type",
      "revision",
      "content_hash",
    ],
    "app_data_agent.artifacts",
    [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "artifact_id",
      "artifact_type",
      "revision",
      "content_hash",
    ],
  ),
  foreignKey(
    budgetBindingRelation,
    "budget_event_exact_fk",
    [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "budget_epoch",
      "budget_event_seq",
      "event_hash",
    ],
    budgetEventRelation,
    [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "budget_epoch",
      "budget_event_seq",
      "event_hash",
    ],
  ),
  foreignKey(
    budgetBindingRelation,
    "reservation_exact_fk",
    ["app_id", "tenant_id", "environment", "run_id", "reservation_id", "reservation_seq"],
    "app_data_agent.research_resource_reservations",
    ["app_id", "tenant_id", "environment", "run_id", "reservation_id", "reservation_seq"],
  ),
  checkConstraint(budgetBindingRelation, "ordinal_ck", "ordinal between 0 and 255"),
  checkConstraint(
    budgetBindingRelation,
    "canonical_path_ck",
    "canonical_path in ('research_brief_ref','ordered_budget_event_hashes','ordered_reservation_states')",
  ),
  checkConstraint(budgetBindingRelation, "binding_group_ck", "binding_group = 'ROOT'"),
  checkConstraint(
    budgetBindingRelation,
    "binding_kind_ck",
    "(binding_kind = 'ARTIFACT_REF' and strict_ref_json is not null and artifact_id is not null and artifact_type is not null and revision is not null and content_hash is not null and node_id is null and budget_epoch is null and budget_event_seq is null and event_hash is null and reservation_id is null and reservation_seq is null and reservation_state is null and reservation_projection_json is null and reservation_projection_hash is null) or (binding_kind = 'BUDGET_EVENT' and strict_ref_json is null and artifact_id is null and artifact_type is null and revision is null and content_hash is null and node_id is null and budget_epoch is not null and budget_event_seq is not null and event_hash is not null and reservation_id is null and reservation_seq is null and reservation_state is null and reservation_projection_json is null and reservation_projection_hash is null) or (binding_kind = 'RESERVATION_STATE' and strict_ref_json is null and artifact_id is null and artifact_type is null and revision is null and content_hash is null and node_id is null and budget_epoch is null and budget_event_seq is null and event_hash is null and reservation_id is not null and reservation_seq is not null and reservation_state is not null and reservation_projection_json is not null and reservation_projection_hash is not null)",
  ),
];

const relationAdditions: RelationDescriptor[] = [
  relationDescriptor({
    qualified_name: backendOperationRelation,
    wire_protocols: ["commit-current-l2-artifact@2.0.0"],
    column_inputs: [
      ...scopeColumnInputs,
      { name: "operation_id", type: "uuid" },
      runColumnInput,
      { name: "principal_id", type: "uuid" },
      { name: "idempotency_key", type: "text" },
      { name: "commit_mode", type: "text" },
      { name: "command_hash", type: "text" },
      { name: "expected_active_revision", type: "integer", nullable: true },
      { name: "worker_fence", type: "bigint", nullable: true },
      { name: "adopted_legacy", type: "boolean" },
      { name: "committed_at", type: "timestamp with time zone" },
      ...referenceColumnInputs("committed_artifact"),
    ],
    constraints: backendOperationConstraints,
    cleanup_rank: 1,
    cleanup_group: "ROOT_GRAPH",
    replay_requirements: ["COMMAND_HASH", "EXACT_COMMITTED_ARTIFACT_REFERENCE"],
  }),
  relationDescriptor({
    qualified_name: budgetEventRelation,
    wire_protocols: ["u6-research-budget-event@1.0.0"],
    column_inputs: [
      ...scopeColumnInputs,
      runColumnInput,
      { name: "budget_epoch", type: "bigint" },
      { name: "budget_event_seq", type: "bigint" },
      { name: "event_kind", type: "text" },
      { name: "source_operation_kind", type: "text" },
      { name: "source_operation_id", type: "uuid" },
      { name: "reservation_id", type: "uuid", nullable: true },
      { name: "logical_step_id", type: "uuid", nullable: true },
      { name: "actual_before_json", type: "jsonb" },
      { name: "actual_after_json", type: "jsonb" },
      { name: "hold_before_json", type: "jsonb" },
      { name: "hold_after_json", type: "jsonb" },
      { name: "uncertainty_before_json", type: "jsonb" },
      { name: "uncertainty_after_json", type: "jsonb" },
      { name: "previous_event_hash", type: "text" },
      { name: "event_hash", type: "text" },
      { name: "committed_at", type: "timestamp with time zone" },
    ],
    constraints: budgetEventConstraints,
    cleanup_rank: 5,
    cleanup_group: "RESOURCE_EVENT",
    replay_requirements: ["CONTIGUOUS_EVENT_HASH_CHAIN", "IMMUTABLE_BEFORE_AFTER"],
  }),
  relationDescriptor({
    qualified_name: budgetReceiptRelation,
    wire_protocols: ["research-budget-ledger-receipt@2.0.0"],
    column_inputs: [
      ...receiptCommonColumnInputs,
      { name: "snapshot_command_hash", type: "text" },
      ...referenceColumnInputs("research_brief"),
      { name: "runtime_limits_version", type: "text" },
      { name: "runtime_limits_hash", type: "text" },
      { name: "tenant_policy_version", type: "text" },
      { name: "tenant_policy_hash", type: "text" },
      { name: "budget_epoch", type: "bigint" },
      { name: "budget_started_at", type: "timestamp with time zone" },
      { name: "evaluated_through_reservation_seq", type: "bigint" },
      { name: "evaluated_through_budget_event_seq", type: "bigint" },
      { name: "evaluated_at", type: "timestamp with time zone" },
      { name: "valid_until", type: "timestamp with time zone" },
      { name: "outstanding_set_hash", type: "text" },
      { name: "active_count", type: "integer" },
      { name: "outcome_unknown_count", type: "integer" },
      { name: "abandoned_count", type: "integer" },
      { name: "actual_used_json", type: "jsonb" },
      { name: "unresolved_hold_json", type: "jsonb" },
      { name: "ledger_json", type: "jsonb" },
    ],
    constraints: budgetReceiptConstraints,
    cleanup_rank: 1,
    cleanup_group: "ROOT_GRAPH",
    replay_requirements: [
      "EXACT_BUDGET_EVENT_CHAIN",
      "EXACT_RESERVATION_PROJECTION",
      "INPUT_HASH_REBUILT_FROM_COMPANION",
    ],
  }),
  relationDescriptor({
    qualified_name: policyHeadRelation,
    mutation_mode: "MUTABLE_CURRENT_HEAD",
    wire_protocols: ["u6-budget-policy-head@1.0.0"],
    column_inputs: [
      ...scopeColumnInputs,
      { name: "current_tenant_policy_version", type: "text" },
      { name: "current_tenant_policy_hash", type: "text" },
      { name: "head_version", type: "bigint" },
      { name: "updated_at", type: "timestamp with time zone" },
    ],
    constraints: policyHeadConstraints,
    cleanup_rank: 7,
    cleanup_group: "DERIVATION_GOVERNANCE_FINAL",
    provisionable: true,
    replay_requirements: ["CURRENT_HEAD_CAS_ONLY"],
  }),
  relationDescriptor({
    qualified_name: policyVersionRelation,
    wire_protocols: ["u6-budget-policy-version@1.0.0"],
    column_inputs: [
      ...scopeColumnInputs,
      { name: "tenant_policy_version", type: "text" },
      { name: "limits_json", type: "jsonb" },
      { name: "top_up_allowed", type: "boolean" },
      { name: "tenant_policy_hash", type: "text" },
      { name: "provision_operation_id", type: "uuid" },
      { name: "committed_at", type: "timestamp with time zone" },
    ],
    constraints: policyVersionConstraints,
    cleanup_rank: 6,
    cleanup_group: "HISTORICAL_DERIVATION_POLICY",
    provisionable: true,
    replay_requirements: ["IMMUTABLE_POLICY_HASH"],
  }),
  relationDescriptor({
    qualified_name: candidateReceiptRelation,
    wire_protocols: ["candidate-enumeration-receipt@2.0.0"],
    column_inputs: [
      ...receiptCommonColumnInputs,
      { name: "coverage_receipt_id", type: "uuid" },
      { name: "coverage_receipt_hash", type: "text" },
      { name: "budget_receipt_id", type: "uuid" },
      { name: "budget_receipt_hash", type: "text" },
      { name: "enumerator_head_version", type: "bigint" },
      { name: "enumerator_version", type: "text" },
      { name: "eig_policy_version", type: "text" },
      { name: "enumerator_capability_id", type: "uuid" },
      { name: "enumerator_authority_epoch", type: "bigint" },
      { name: "enumerator_attestation_id", type: "uuid" },
      { name: "enumerator_attestation_hash", type: "text" },
      { name: "unresolved_obligation_refs_json", type: "jsonb" },
      { name: "no_candidate_obligation_refs_json", type: "jsonb" },
      { name: "no_candidate_assessments_json", type: "jsonb" },
      { name: "candidate_queries_json", type: "jsonb" },
      { name: "query_contract_universe_refs_json", type: "jsonb" },
      { name: "enumeration_universe_hash", type: "text" },
      { name: "candidate_set_hash", type: "text" },
    ],
    constraints: candidateReceiptConstraints,
    cleanup_rank: 1,
    cleanup_group: "ROOT_GRAPH",
    replay_requirements: [
      "ENUMERATOR_HEAD_VERSION_IN_RECEIPT_HASH",
      "EXACT_ATTESTATION_COVERAGE_BUDGET_BINDING",
      "VARIABLE_REFERENCES_REQUIRE_COMPANION",
    ],
  }),
  relationDescriptor({
    qualified_name: attestationRelation,
    wire_protocols: ["candidate-enumerator-attestation@1.0.0"],
    column_inputs: [
      ...scopeColumnInputs,
      { name: "attestation_id", type: "uuid" },
      runColumnInput,
      { name: "issuer_principal_id", type: "uuid" },
      { name: "issuer_capability_id", type: "uuid" },
      { name: "issuer_authority_epoch", type: "bigint" },
      { name: "idempotency_key", type: "text" },
      { name: "budget_receipt_id", type: "uuid" },
      { name: "budget_receipt_hash", type: "text" },
      { name: "budget_input_hash", type: "text" },
      { name: "enumerator_version", type: "text" },
      { name: "eig_policy_version", type: "text" },
      { name: "implementation_digest", type: "text" },
      ...referenceColumnInputs("coverage"),
      { name: "query_contract_universe_refs_json", type: "jsonb" },
      { name: "unresolved_obligation_refs_json", type: "jsonb" },
      { name: "no_candidate_obligation_refs_json", type: "jsonb" },
      { name: "no_candidate_assessments_json", type: "jsonb" },
      { name: "candidate_queries_json", type: "jsonb" },
      { name: "enumeration_universe_hash", type: "text" },
      { name: "candidate_set_hash", type: "text" },
      { name: "attestation_command_hash", type: "text" },
      { name: "input_hash", type: "text" },
      { name: "attestation_hash", type: "text" },
      { name: "committed_at", type: "timestamp with time zone" },
    ],
    constraints: attestationConstraints,
    cleanup_rank: 1,
    cleanup_group: "ROOT_GRAPH",
    replay_requirements: [
      "EXACT_BUDGET_AND_COVERAGE_BINDING",
      "VARIABLE_REFERENCES_REQUIRE_COMPANION",
    ],
  }),
  relationDescriptor({
    qualified_name: coverageReceiptRelation,
    wire_protocols: ["coverage-derivation-receipt@1.0.0"],
    column_inputs: [
      ...receiptCommonColumnInputs,
      ...referenceColumnInputs("coverage"),
      ...referenceColumnInputs("evidence_plan"),
      { name: "budget_receipt_id", type: "uuid" },
      { name: "budget_receipt_hash", type: "text" },
      { name: "version_frontier_json", type: "jsonb" },
      { name: "version_frontier_hash", type: "text" },
      { name: "closure_refs_json", type: "jsonb" },
      { name: "coverage_input_hash", type: "text" },
      { name: "kernel_version", type: "text" },
    ],
    constraints: coverageReceiptConstraints,
    cleanup_rank: 1,
    cleanup_group: "ROOT_GRAPH",
    replay_requirements: ["EXACT_BUDGET_BINDING", "VARIABLE_REFERENCES_REQUIRE_COMPANION"],
  }),
  relationDescriptor({
    qualified_name: enumeratorHeadRelation,
    mutation_mode: "MUTABLE_CURRENT_HEAD",
    wire_protocols: ["u6-enumerator-head@1.0.0"],
    column_inputs: [
      ...scopeColumnInputs,
      { name: "current_enumerator_version", type: "text" },
      { name: "current_enumerator_version_hash", type: "text" },
      { name: "head_version", type: "bigint" },
      { name: "updated_at", type: "timestamp with time zone" },
    ],
    constraints: enumeratorHeadConstraints,
    cleanup_rank: 7,
    cleanup_group: "DERIVATION_GOVERNANCE_FINAL",
    provisionable: true,
    replay_requirements: ["CURRENT_HEAD_CAS_ONLY"],
  }),
  relationDescriptor({
    qualified_name: enumeratorVersionRelation,
    wire_protocols: ["u6-enumerator-version@1.0.0"],
    column_inputs: [
      ...scopeColumnInputs,
      { name: "enumerator_version", type: "text" },
      { name: "eig_policy_version", type: "text" },
      { name: "input_schema_version", type: "text" },
      { name: "implementation_digest", type: "text" },
      { name: "enumerator_version_hash", type: "text" },
      { name: "provision_operation_id", type: "uuid" },
      { name: "committed_at", type: "timestamp with time zone" },
    ],
    constraints: enumeratorVersionConstraints,
    cleanup_rank: 6,
    cleanup_group: "HISTORICAL_DERIVATION_POLICY",
    provisionable: true,
    replay_requirements: ["IMMUTABLE_ENUMERATOR_HASH"],
  }),
  relationDescriptor({
    qualified_name: inputHeadRelation,
    mutation_mode: "MUTABLE_CURRENT_HEAD",
    wire_protocols: ["u6-input-event-head@1.0.0"],
    column_inputs: [
      ...scopeColumnInputs,
      runColumnInput,
      { name: "next_event_seq", type: "bigint" },
      { name: "head_event_hash", type: "text" },
      { name: "updated_at", type: "timestamp with time zone" },
    ],
    constraints: inputHeadConstraints,
    cleanup_rank: 1,
    cleanup_group: "ROOT_GRAPH",
    replay_requirements: ["CONTIGUOUS_INPUT_EVENT_HEAD"],
  }),
  relationDescriptor({
    qualified_name: watermarkReceiptRelation,
    wire_protocols: ["research-input-watermark-receipt@1.0.0"],
    column_inputs: [
      ...receiptCommonColumnInputs,
      { name: "observed_event_seq", type: "bigint" },
      { name: "observed_head_hash", type: "text" },
      ...referenceColumnInputs("certificate"),
      { name: "certificate_input_closure_hash", type: "text" },
    ],
    constraints: watermarkReceiptConstraints,
    cleanup_rank: 1,
    cleanup_group: "ROOT_GRAPH",
    replay_requirements: ["EXACT_INPUT_EVENT_WATERMARK"],
  }),
  relationDescriptor({
    qualified_name: inputEventRelation,
    wire_protocols: ["u6-input-event@1.0.0"],
    column_inputs: [
      ...scopeColumnInputs,
      runColumnInput,
      { name: "event_seq", type: "bigint" },
      { name: "event_kind", type: "text" },
      { name: "subject_identity", type: "text" },
      { name: "subject_hash", type: "text" },
      { name: "source_operation_kind", type: "text" },
      { name: "source_operation_id", type: "uuid" },
      { name: "previous_event_hash", type: "text" },
      { name: "event_hash", type: "text" },
      { name: "committed_at", type: "timestamp with time zone" },
    ],
    constraints: inputEventConstraints,
    cleanup_rank: 1,
    cleanup_group: "ROOT_GRAPH",
    replay_requirements: ["CONTIGUOUS_INPUT_EVENT_HASH_CHAIN"],
  }),
  relationDescriptor({
    qualified_name: stepRelation,
    wire_protocols: ["begin-research-step@1.0.0"],
    column_inputs: [
      ...scopeColumnInputs,
      { name: "step_operation_id", type: "uuid" },
      runColumnInput,
      { name: "budget_epoch", type: "bigint" },
      { name: "logical_step_id", type: "uuid" },
      { name: "parent_logical_step_id", type: "uuid", nullable: true },
      { name: "step_seq", type: "bigint" },
      { name: "step_kind", type: "text" },
      { name: "step_input_hash", type: "text" },
      { name: "outbox_id", type: "uuid" },
      { name: "attempt_id", type: "uuid" },
      { name: "worker_fence", type: "bigint" },
      { name: "budget_event_seq", type: "bigint" },
      { name: "budget_event_hash", type: "text" },
      { name: "principal_id", type: "uuid" },
      { name: "idempotency_key", type: "text" },
      { name: "committed_at", type: "timestamp with time zone" },
    ],
    constraints: stepConstraints,
    cleanup_rank: 5,
    cleanup_group: "STEP_TREE",
    identity_order: "RUN_STEP_DESC",
    replay_requirements: ["PARENT_STEP_SEQ_PRECEDES_CHILD", "EXACT_BUDGET_EVENT"],
  }),
  relationDescriptor({
    qualified_name: stopReceiptRelation,
    wire_protocols: ["research-stop-derivation-receipt@2.0.0"],
    column_inputs: [
      ...receiptCommonColumnInputs,
      ...referenceColumnInputs("stop"),
      ...referenceColumnInputs("coverage"),
      { name: "coverage_receipt_id", type: "uuid" },
      { name: "coverage_receipt_hash", type: "text" },
      { name: "candidate_receipt_id", type: "uuid" },
      { name: "candidate_receipt_hash", type: "text" },
      { name: "budget_receipt_id", type: "uuid" },
      { name: "budget_receipt_hash", type: "text" },
      { name: "supported_subset_json", type: "jsonb" },
      { name: "required_disclosures_json", type: "jsonb" },
      { name: "pre_stop_readiness_hash", type: "text" },
      { name: "kernel_version", type: "text" },
      { name: "enumerator_version", type: "text" },
      { name: "eig_policy_version", type: "text" },
      { name: "decision", type: "text" },
      { name: "decision_input_hash", type: "text" },
    ],
    constraints: stopReceiptConstraints,
    cleanup_rank: 1,
    cleanup_group: "ROOT_GRAPH",
    replay_requirements: [
      "EXACT_CANDIDATE_COVERAGE_BUDGET_BINDING",
      "VARIABLE_REFERENCES_REQUIRE_COMPANION",
    ],
  }),
  relationDescriptor({
    qualified_name: budgetBindingRelation,
    surface_kind: "COMPANION",
    wire_protocols: ["u6-budget-ledger-input-bindings@1.0.0"],
    column_inputs: budgetBindingColumns,
    constraints: budgetBindingConstraints,
    cleanup_rank: 1,
    cleanup_group: "ROOT_GRAPH",
    companion_binding: {
      kind: "BUDGET_INPUT",
      parent_relation: budgetReceiptRelation,
      parent_id_column: "receipt_id",
      parent_hash_column: "receipt_hash",
      allowed_paths: [
        "research_brief_ref",
        "ordered_budget_event_hashes",
        "ordered_reservation_states",
      ],
      binding_group_protocol: "ROOT",
      ordinal_scope: "PER_CANONICAL_PATH_AND_BINDING_GROUP",
      ordinal_min: 0,
      ordinal_max: 255,
      requires_parent_exact_fk: true,
      requires_artifact_exact_fk: true,
      branches: ["ARTIFACT_REF", "BUDGET_EVENT", "RESERVATION_STATE"],
    },
    replay_requirements: ["EXACT_PARENT_HASH", "EVENT_CHAIN_AND_RESERVATION_SNAPSHOT_CLOSED_SET"],
  }),
  ...[
    {
      relation: "app_data_agent.research_candidate_attestation_ref_bindings",
      parent: attestationRelation,
      parentId: "attestation_id" as const,
      parentHash: "attestation_hash" as const,
      paths: [
        "candidate_queries[*].obligation_refs",
        "candidate_queries[*].query_contract_ref",
        "no_candidate_assessments[*].obligation_ref",
        "no_candidate_obligation_refs",
        "query_contract_universe_refs",
        "unresolved_obligation_refs",
      ],
      group: "ROOT_OR_QUERY_OR_EMBEDDED_REFERENCE_IDENTITY" as const,
    },
    {
      relation: "app_data_agent.research_candidate_enumeration_ref_bindings",
      parent: candidateReceiptRelation,
      parentId: "receipt_id" as const,
      parentHash: "receipt_hash" as const,
      paths: [
        "candidate_queries[*].obligation_refs",
        "candidate_queries[*].query_contract_ref",
        "no_candidate_assessments[*].obligation_ref",
        "no_candidate_obligation_refs",
        "query_contract_universe_refs",
        "unresolved_obligation_refs",
      ],
      group: "ROOT_OR_QUERY_OR_EMBEDDED_REFERENCE_IDENTITY" as const,
    },
    {
      relation: "app_data_agent.research_coverage_derivation_ref_bindings",
      parent: coverageReceiptRelation,
      parentId: "receipt_id" as const,
      parentHash: "receipt_hash" as const,
      paths: [
        "closure_refs.atomic_claim_refs",
        "closure_refs.evidence_relation_refs",
        "closure_refs.hypothesis_assessment_refs",
        "closure_refs.obligation_execution_decision_refs",
        "closure_refs.query_evidence_refs",
        "closure_refs.support_decision_refs",
        "version_frontier.policy_receipt_ref",
        "version_frontier.schema_snapshot_ref",
        "version_frontier.semantic_release_ref",
      ],
      group: "ROOT" as const,
    },
    {
      relation: "app_data_agent.research_stop_derivation_ref_bindings",
      parent: stopReceiptRelation,
      parentId: "receipt_id" as const,
      parentHash: "receipt_hash" as const,
      paths: ["supported_subset.claim_refs", "supported_subset.support_decision_refs"],
      group: "ROOT" as const,
    },
  ].map(({ relation, parent, parentId, parentHash, paths, group }) =>
    relationDescriptor({
      qualified_name: relation,
      surface_kind: "COMPANION",
      wire_protocols: ["u6-artifact-reference-binding@1.0.0"],
      column_inputs: artifactCompanionColumns,
      constraints: artifactCompanionConstraints(
        relation,
        parent,
        parentId,
        parentHash,
        paths,
        group,
      ),
      cleanup_rank: 1,
      cleanup_group: "ROOT_GRAPH",
      companion_binding: {
        kind: "ARTIFACT_REFERENCE",
        parent_relation: parent,
        parent_id_column: parentId,
        parent_hash_column: parentHash,
        allowed_paths: paths,
        binding_group_protocol: group,
        ordinal_scope: "PER_CANONICAL_PATH_AND_BINDING_GROUP",
        ordinal_min: 0,
        ordinal_max: 255,
        requires_parent_exact_fk: true,
        requires_artifact_exact_fk: true,
      },
      replay_requirements: [
        "EXACT_PARENT_HASH",
        "EXACT_ARTIFACT_REFERENCE_FK",
        "CONTIGUOUS_ORDINAL_PER_PATH_AND_GROUP",
      ],
    }),
  ),
];

const mutationColumns = {
  artifactCommit: columns(
    [
      { name: "wire_protocol_version", type: "text" },
      { name: "budget_receipt_id", type: "uuid", nullable: true },
      { name: "budget_receipt_hash", type: "text", nullable: true },
    ],
    18,
  ),
  domainTerminal: columns(
    [
      { name: "stop_derivation_receipt_id", type: "uuid", nullable: true },
      { name: "stop_derivation_receipt_hash", type: "text", nullable: true },
    ],
    16,
  ),
  reservation: columns(
    [
      { name: "budget_epoch", type: "bigint" },
      { name: "logical_step_id", type: "uuid", nullable: true },
    ],
    31,
  ),
  resourceHead: columns(
    [
      { name: "next_step_seq", type: "bigint" },
      { name: "next_budget_event_seq", type: "bigint" },
      { name: "budget_epoch", type: "bigint" },
      { name: "budget_epoch_state", type: "text" },
      { name: "budget_started_at", type: "timestamp with time zone", nullable: true },
      { name: "last_budget_event_hash", type: "text", nullable: true },
    ],
    7,
  ),
  stopCommit: columns(
    [
      { name: "stop_derivation_receipt_id", type: "uuid" },
      { name: "stop_derivation_receipt_hash", type: "text" },
    ],
    14,
  ),
};

function existingMutation(input: {
  qualified_name: string;
  maintenance_reasons: ExistingRelationMutation["maintenance_reasons"];
  added_columns?: ColumnDescriptor[];
  added_constraints?: ConstraintDescriptor[];
  backfill?: string[];
  final_defaults_absent?: string[];
  preflight_check_ids: string[];
}): ExistingRelationMutation {
  const addedConstraints = input.added_constraints ?? [];
  return {
    qualified_name: input.qualified_name,
    maintenance_reasons: input.maintenance_reasons,
    added_columns: input.added_columns ?? [],
    added_constraints: addedConstraints,
    added_indexes: [
      ...backingIndexes(input.qualified_name, addedConstraints),
      ...supportingIndexes(input.qualified_name, addedConstraints),
    ],
    backfill: input.backfill ?? [],
    final_defaults_absent: input.final_defaults_absent ?? [],
    preflight_check_ids: input.preflight_check_ids,
    baseline_catalog_binding: "U6_C1_FROZEN_INVENTORY",
    target_catalog_binding: "U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR",
  };
}

const existingRelationMutations: ExistingRelationMutation[] = [
  existingMutation({
    qualified_name: "app_data_agent.artifacts",
    maintenance_reasons: ["IMMEDIATE_FK_PARENT"],
    preflight_check_ids: ["C2_ARTIFACT_REFERENCE_PARENT_EXACT"],
  }),
  existingMutation({
    qualified_name: "app_data_agent.memberships",
    maintenance_reasons: ["IMMEDIATE_FK_PARENT"],
    preflight_check_ids: ["C2_ISSUER_MEMBERSHIP_PARENT_EXACT"],
  }),
  existingMutation({
    qualified_name: "app_data_agent.outbox",
    maintenance_reasons: ["FUNCTION_LOCK", "IMMEDIATE_FK_PARENT"],
    added_constraints: [
      uniqueConstraint("app_data_agent.outbox", "scope_outbox_run_uq", [
        "app_id",
        "tenant_id",
        "environment",
        "outbox_id",
        "run_id",
      ]),
    ],
    preflight_check_ids: ["C2_OUTBOX_LOCK_PROFILE_EXACT"],
  }),
  existingMutation({
    qualified_name: "app_data_agent.research_artifact_commit_operations",
    maintenance_reasons: ["ACL", "ALTER", "FUNCTION_LOCK"],
    added_columns: mutationColumns.artifactCommit,
    added_constraints: [
      checkConstraint(
        "app_data_agent.research_artifact_commit_operations",
        "wire_protocol_ck",
        "wire_protocol_version = candidate_json #>> '{payload,protocol_version}'",
      ),
      checkConstraint(
        "app_data_agent.research_artifact_commit_operations",
        "budget_receipt_pair_ck",
        "(budget_receipt_id is null) = (budget_receipt_hash is null) and ((wire_protocol_version in ('coverage-state@2.0.0','research-stop@2.0.0')) = (budget_receipt_id is not null))",
      ),
      foreignKey(
        "app_data_agent.research_artifact_commit_operations",
        "budget_receipt_fk",
        [
          "app_id",
          "tenant_id",
          "environment",
          "run_id",
          "budget_receipt_id",
          "budget_receipt_hash",
        ],
        budgetReceiptRelation,
        ["app_id", "tenant_id", "environment", "run_id", "receipt_id", "receipt_hash"],
      ),
    ],
    backfill: [
      "wire_protocol_version := candidate_json #>> '{payload,protocol_version}'",
      "legacy rows keep budget receipt pair null",
    ],
    final_defaults_absent: ["wire_protocol_version"],
    preflight_check_ids: [
      "C2_ARTIFACT_WIRE_PROTOCOL_BACKFILL",
      "C2_ARTIFACT_BUDGET_RECEIPT_PAIR_BRANCH",
    ],
  }),
  existingMutation({
    qualified_name: "app_data_agent.research_authority_capabilities",
    maintenance_reasons: ["IMMEDIATE_FK_PARENT"],
    preflight_check_ids: ["C2_ISSUER_CAPABILITY_PARENT_EXACT"],
  }),
  existingMutation({
    qualified_name: "app_data_agent.research_domain_terminals",
    maintenance_reasons: ["ALTER", "IMMEDIATE_FK_PARENT"],
    added_columns: mutationColumns.domainTerminal,
    added_constraints: [
      checkConstraint(
        "app_data_agent.research_domain_terminals",
        "stop_receipt_branch_ck",
        "(stop_derivation_receipt_id is null) = (stop_derivation_receipt_hash is null) and (((authority_kind = 'RESEARCH_STOP' and terminal in ('PARTIAL','NEEDS_MORE_RESEARCH','INCONCLUSIVE'))) = (stop_derivation_receipt_id is not null))",
      ),
      foreignKey(
        "app_data_agent.research_domain_terminals",
        "stop_receipt_fk",
        [
          "app_id",
          "tenant_id",
          "environment",
          "run_id",
          "stop_derivation_receipt_id",
          "stop_derivation_receipt_hash",
        ],
        stopReceiptRelation,
        ["app_id", "tenant_id", "environment", "run_id", "receipt_id", "receipt_hash"],
      ),
    ],
    preflight_check_ids: ["C2_DOMAIN_TERMINAL_STOP_RECEIPT_BRANCH_ZERO"],
  }),
  existingMutation({
    qualified_name: "app_data_agent.research_resource_reservations",
    maintenance_reasons: ["ALTER", "IMMEDIATE_FK_PARENT"],
    added_columns: mutationColumns.reservation,
    added_constraints: [
      uniqueConstraint(
        "app_data_agent.research_resource_reservations",
        "reservation_seq_exact_uq",
        ["app_id", "tenant_id", "environment", "run_id", "reservation_id", "reservation_seq"],
      ),
      uniqueConstraint(
        "app_data_agent.research_resource_reservations",
        "reservation_epoch_exact_uq",
        ["app_id", "tenant_id", "environment", "run_id", "reservation_id", "budget_epoch"],
      ),
      uniqueConstraint(
        "app_data_agent.research_resource_reservations",
        "reservation_step_binding_uq",
        [
          "app_id",
          "tenant_id",
          "environment",
          "run_id",
          "reservation_id",
          "budget_epoch",
          "logical_step_id",
        ],
      ),
      checkConstraint(
        "app_data_agent.research_resource_reservations",
        "budget_epoch_step_branch_ck",
        "(budget_epoch = 0 and logical_step_id is null) or (budget_epoch between 1 and 9007199254740991 and (resource_kind = 'TOOL' or logical_step_id is not null))",
      ),
      foreignKey(
        "app_data_agent.research_resource_reservations",
        "logical_step_fk",
        ["app_id", "tenant_id", "environment", "run_id", "budget_epoch", "logical_step_id"],
        stepRelation,
        ["app_id", "tenant_id", "environment", "run_id", "budget_epoch", "logical_step_id"],
      ),
    ],
    backfill: ["budget_epoch := 0", "logical_step_id := null"],
    final_defaults_absent: ["budget_epoch"],
    preflight_check_ids: ["C2_RESERVATION_LEGACY_CLASSIFICATION"],
  }),
  existingMutation({
    qualified_name: "app_data_agent.research_resource_run_heads",
    maintenance_reasons: ["ALTER", "FUNCTION_LOCK"],
    added_columns: mutationColumns.resourceHead,
    added_constraints: [
      checkConstraint(
        "app_data_agent.research_resource_run_heads",
        "budget_epoch_state_ck",
        "(budget_epoch_state = 'LEGACY_BUDGET_EPOCH_UNPROVABLE' and budget_epoch = 0 and budget_started_at is null and last_budget_event_hash is null) or (budget_epoch_state = 'ACTIVE' and budget_epoch between 1 and 9007199254740991 and budget_started_at is not null and last_budget_event_hash ~ '^sha256:[0-9a-f]{64}$')",
      ),
      checkConstraint(
        "app_data_agent.research_resource_run_heads",
        "budget_sequences_ck",
        "next_step_seq between 1 and 9007199254740991 and next_budget_event_seq between 1 and 9007199254740991",
      ),
    ],
    backfill: [
      "next_step_seq := 1",
      "next_budget_event_seq := 1",
      "budget_epoch := 0",
      "budget_epoch_state := 'LEGACY_BUDGET_EPOCH_UNPROVABLE'",
      "budget_started_at := null",
      "last_budget_event_hash := null",
    ],
    final_defaults_absent: [
      "next_reservation_seq",
      "next_step_seq",
      "next_budget_event_seq",
      "budget_epoch",
    ],
    preflight_check_ids: ["C2_RESOURCE_HEAD_LEGACY_CLASSIFICATION"],
  }),
  existingMutation({
    qualified_name: "app_data_agent.research_stop_terminal_commits",
    maintenance_reasons: ["ALTER", "IMMEDIATE_FK_PARENT"],
    added_columns: mutationColumns.stopCommit,
    added_constraints: [
      checkConstraint(
        "app_data_agent.research_stop_terminal_commits",
        "stop_receipt_pair_ck",
        "stop_derivation_receipt_id is not null and stop_derivation_receipt_hash is not null",
      ),
      foreignKey(
        "app_data_agent.research_stop_terminal_commits",
        "stop_receipt_fk",
        [
          "app_id",
          "tenant_id",
          "environment",
          "run_id",
          "stop_derivation_receipt_id",
          "stop_derivation_receipt_hash",
        ],
        stopReceiptRelation,
        ["app_id", "tenant_id", "environment", "run_id", "receipt_id", "receipt_hash"],
      ),
    ],
    preflight_check_ids: ["C2_STOP_TERMINAL_COMMIT_PREEXISTING_ZERO"],
  }),
  existingMutation({
    qualified_name: "app_data_agent.run_attempts",
    maintenance_reasons: ["FUNCTION_LOCK", "IMMEDIATE_FK_PARENT"],
    preflight_check_ids: ["C2_ATTEMPT_FENCE_PARENT_EXACT"],
  }),
  existingMutation({
    qualified_name: "app_data_agent.runs",
    maintenance_reasons: ["FUNCTION_LOCK", "IMMEDIATE_FK_PARENT"],
    preflight_check_ids: ["C2_RUN_PARENT_EXACT"],
  }),
];

function compareUtf8Bytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sortedByIdentity<T>(values: readonly T[], identity: (value: T) => string): T[] {
  return [...values].sort((left, right) => compareUtf8Bytes(identity(left), identity(right)));
}

const sortedRelationAdditions = sortedByIdentity(
  relationAdditions,
  ({ qualified_name }) => qualified_name,
);
const sortedExistingRelationMutations = sortedByIdentity(
  existingRelationMutations,
  ({ qualified_name }) => qualified_name,
);

const releaseBlockers = [
  "EXTENSION_VERSIONS_NOT_EXTRACTED",
  "FUNCTION_BODY_HASHES_NOT_FROZEN",
  "FUNCTION_SIGNATURES_NOT_FROZEN",
  "HOSTED_DOCKER_PARITY_NOT_PROVEN",
  "MIGRATION_10600_BYTES_NOT_RENDERED",
  "PG17_CATALOG_NOT_EXTRACTED",
  "PREFLIGHT_SQL_HASHES_NOT_FROZEN",
  "ROLE_ATTRIBUTES_NOT_EXTRACTED",
] as const;

const descriptorMaterial = {
  protocol_version: DESCRIPTOR_PROTOCOL,
  target_inventory_protocol: TARGET_INVENTORY_PROTOCOL,
  candidate_inventory_protocol: CANDIDATE_INVENTORY_PROTOCOL,
  status: "FROZEN_TABLE_SURFACE",
  installable: false,
  baseline: {
    migration_name: "20260725010590_app_data_agent_u6_research_authority.sql",
    migration_sha256: "sha256:091534f8dae4132700564920f4e3e7316f6f411aff92efb108aa49d6ce255678",
    inventory_protocol: "u6-schema-inventory@1.0.0",
    inventory_hash: "sha256:a400586a8bae3b5bc843cda0355b404c444b6a976f56ab7eca0dd05e1f34593e",
    source_segments: [...c1SourceSegments],
  },
  migrations: [
    {
      chain_ordinal: 1,
      name: "20260725010590_app_data_agent_u6_research_authority.sql",
      sha256: "sha256:091534f8dae4132700564920f4e3e7316f6f411aff92efb108aa49d6ce255678",
      status: "IMMUTABLE",
    },
    {
      chain_ordinal: 2,
      name: "20260725010600_app_data_agent_u6_research_derivation.sql",
      sha256: null,
      status: "AWAITING_RENDERED_10600_BYTES",
    },
  ],
  source_segments: c2SourceSegments.map((name, index) => ({
    ordinal: index,
    name,
  })),
  semantic_core_relations: [...coreRelationNames],
  core_relations_are_source_segments: false,
  authority: {
    relation_owner: DATA_OWNER,
    force_rls: true,
    forbidden_raw_dml_roles: [
      "PUBLIC",
      "anon",
      "authenticated",
      "data_agent_backend",
      "data_agent_job_authority",
      "service_role",
    ],
    default_acl: [],
    scoped_owner_roles: [
      "data_agent_u6_cleanup_owner",
      "data_agent_u6_provisioner_owner",
      "data_agent_u6_rpc_owner",
    ],
    cleanup_guard_relation_count_after_c2: 33,
    cleanup_u6_job_relation_count_after_c2: 61,
  },
  relation_additions: sortedRelationAdditions,
  existing_relation_mutations: sortedExistingRelationMutations,
  future_catalog_facets: {
    postgres_major: 17,
    executor_identity: null,
    executor_bypassrls: null,
    extension_projection: {
      required_name: "pgcrypto",
      required_schema: "extensions",
      version: null,
      owner: null,
    },
    function_projection: {
      signatures: null,
      attributes: null,
      owners: null,
      body_hashes: null,
      dependencies: null,
      authority_kinds: null,
      lock_profiles: null,
    },
    role_projection: null,
    preflight_query_hashes: null,
    pg17_catalog_extractor_query_hash: null,
  },
  canonicalization: {
    content_hash_domain: DESCRIPTOR_PROTOCOL,
    content_hash_encoding: "DOMAIN_NUL_CANONICAL_JSON_UTF8_SHA256",
    object_key_order: "UTF16_CODE_UNITS",
    identity_order: "UTF8_BYTES",
    column_order: "ATTNUM_ASC",
    descriptor_hash_excluded_field: "physical_descriptor_hash",
  },
  release_blockers: [...releaseBlockers],
} as const;

/**
 * Filled with the committed digest of descriptorMaterial. The validator first
 * checks the raw embedded digest and then this independent frozen constant.
 */
export const U6_C2_FROZEN_PHYSICAL_SCHEMA_HASH =
  "sha256:b848930cc4cd97148cf5209983b1d4637f8550c219d697be08fe0dd2c657f8d9";

export const U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR = deepFreeze({
  ...descriptorMaterial,
  physical_descriptor_hash: U6_C2_FROZEN_PHYSICAL_SCHEMA_HASH,
});

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new TypeError(message);
  }
}

function assertStrictKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assertCondition(
    JSON.stringify(actual) === JSON.stringify(wanted),
    `${label} 字段不闭合：actual=${actual.join(",")}`,
  );
}

function projectDataJson(value: unknown, active = new WeakSet<object>()): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isSafeInteger(value))
  ) {
    return value;
  }
  assertCondition(typeof value === "object", "physical descriptor 只接受安全 JSON value");
  assertCondition(!active.has(value), "physical descriptor 不接受循环引用");
  active.add(value);
  try {
    if (Array.isArray(value)) {
      assertCondition(
        Object.getPrototypeOf(value) === Array.prototype,
        "physical descriptor array prototype 漂移",
      );
      const keys = Reflect.ownKeys(value);
      assertCondition(
        keys.every(
          (key) => key === "length" || (typeof key === "string" && /^(?:0|[1-9][0-9]*)$/.test(key)),
        ),
        "physical descriptor array 出现额外 key",
      );
      const projected: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        assertCondition(Object.hasOwn(value, index), "physical descriptor 不接受 sparse array");
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        assertCondition(
          descriptor?.enumerable === true && "value" in descriptor,
          "physical descriptor array element 必须是 enumerable data property",
        );
        projected.push(projectDataJson(descriptor.value, active));
      }
      return projected;
    }
    assertCondition(isPlainRecord(value), "physical descriptor object prototype 漂移");
    const projected: JsonRecord = {};
    for (const key of Reflect.ownKeys(value)) {
      assertCondition(typeof key === "string", "physical descriptor 不接受 symbol key");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      assertCondition(
        descriptor?.enumerable === true && "value" in descriptor,
        "physical descriptor 字段必须是 enumerable data property",
      );
      projected[key] = projectDataJson(descriptor.value, active);
    }
    return projected;
  } finally {
    active.delete(value);
  }
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue)}`)
    .join(",")}}`;
}

function assertSameFrozenShape(actual: JsonValue, expected: JsonValue, label: string): void {
  if (expected === null) {
    assertCondition(actual === null, `${label} frozen shape nullability 漂移`);
    return;
  }
  if (typeof expected !== "object") {
    assertCondition(typeof actual === typeof expected, `${label} frozen shape 类型漂移`);
    return;
  }
  if (Array.isArray(expected)) {
    assertCondition(Array.isArray(actual), `${label} frozen shape 应为 array`);
    assertCondition(actual.length === expected.length, `${label} frozen shape array 长度漂移`);
    for (const [index, expectedElement] of expected.entries()) {
      assertSameFrozenShape(actual[index] as JsonValue, expectedElement, `${label}[${index}]`);
    }
    return;
  }
  assertCondition(
    isPlainRecord(actual) && !Array.isArray(actual),
    `${label} frozen shape 应为 object`,
  );
  assertStrictKeys(actual, Object.keys(expected), `${label} frozen shape`);
  for (const key of Object.keys(expected)) {
    assertSameFrozenShape(actual[key] as JsonValue, expected[key] as JsonValue, `${label}.${key}`);
  }
}

function assertFrozenShape(actual: unknown, expected: unknown, label: string): void {
  assertSameFrozenShape(projectDataJson(actual), projectDataJson(expected), label);
}

function descriptorHash(material: unknown): `sha256:${string}` {
  const projected = projectDataJson(material);
  return `sha256:${createHash("sha256")
    .update(`${DESCRIPTOR_HASH_DOMAIN}${canonicalJson(projected)}`)
    .digest("hex")}`;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value as DeepReadonly<T>;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value) as DeepReadonly<T>;
}

function assertCanonicalIdentities(
  identities: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  assertCondition(
    JSON.stringify(identities) === JSON.stringify(expected),
    `${label} closed set/顺序漂移`,
  );
  assertCondition(new Set(identities).size === identities.length, `${label} 出现重复 identity`);
  assertCondition(
    JSON.stringify(identities) === JSON.stringify([...identities].sort(compareUtf8Bytes)),
    `${label} 必须按 UTF-8 bytes 升序`,
  );
}

function validateRelationDescriptor(raw: unknown): RelationDescriptor {
  assertCondition(isPlainRecord(raw), "relation descriptor 必须是 object");
  assertStrictKeys(
    raw,
    [
      "qualified_name",
      "surface_kind",
      "mutation_mode",
      "wire_protocols",
      "owner",
      "columns",
      "constraints",
      "indexes",
      "triggers",
      "rls",
      "policies",
      "relation_acl",
      "column_acl",
      "cleanup",
      "maintenance",
      "companion_binding",
      "replay_requirements",
      "sequences",
    ],
    "relation descriptor",
  );
  assertCondition(
    typeof raw.qualified_name === "string" &&
      /^app_data_agent\.[a-z_][a-z0-9_]*$/.test(raw.qualified_name),
    "relation qualified_name 非 canonical",
  );
  assertCondition(raw.owner === DATA_OWNER, `${raw.qualified_name} owner 漂移`);
  assertCondition(
    raw.mutation_mode === "APPEND_ONLY" || raw.mutation_mode === "MUTABLE_CURRENT_HEAD",
    `${raw.qualified_name} mutation_mode 无效`,
  );
  assertCondition(isPlainRecord(raw.rls), `${raw.qualified_name} rls 缺失`);
  assertStrictKeys(raw.rls, ["enabled", "forced"], `${raw.qualified_name}.rls`);
  assertCondition(
    raw.rls.enabled === true && raw.rls.forced === true,
    "新增 relation 必须 FORCE RLS",
  );
  assertCondition(Array.isArray(raw.columns) && raw.columns.length > 0, "relation columns 缺失");
  const columnNames: string[] = [];
  for (const [index, column] of raw.columns.entries()) {
    assertCondition(isPlainRecord(column), "column descriptor 必须是 object");
    assertStrictKeys(
      column,
      [
        "name",
        "attnum",
        "type",
        "nullable",
        "default_expression",
        "collation",
        "identity",
        "generated",
      ],
      `${raw.qualified_name}.columns[${index}]`,
    );
    assertCondition(column.attnum === index + 1, `${raw.qualified_name} attnum 不连续`);
    assertCondition(typeof column.name === "string", "column name 缺失");
    assertCondition(!columnNames.includes(column.name), `${raw.qualified_name} column 重复`);
    columnNames.push(column.name);
  }
  assertCondition(Array.isArray(raw.constraints), "relation constraints 缺失");
  const constraintNames = new Set<string>();
  for (const constraint of raw.constraints) {
    assertCondition(isPlainRecord(constraint), "constraint descriptor 必须是 object");
    assertStrictKeys(
      constraint,
      [
        "name",
        "kind",
        "columns",
        "expression",
        "referenced_relation",
        "referenced_columns",
        "match_type",
        "on_update",
        "on_delete",
        "deferrable",
        "initially_deferred",
      ],
      `${raw.qualified_name}.constraint`,
    );
    assertCondition(typeof constraint.name === "string", "constraint name 缺失");
    assertCondition(
      Buffer.byteLength(constraint.name, "utf8") <= 63,
      `${constraint.name} 超过 PostgreSQL identifier 限制`,
    );
    assertCondition(!constraintNames.has(constraint.name), "constraint name 重复");
    constraintNames.add(constraint.name);
    assertCondition(Array.isArray(constraint.columns), "constraint columns 必须是 array");
    for (const column of constraint.columns) {
      assertCondition(
        typeof column === "string" && columnNames.includes(column),
        `${constraint.name} 引用未知 column`,
      );
    }
    if (constraint.kind === "FOREIGN_KEY") {
      assertCondition(
        typeof constraint.referenced_relation === "string" &&
          Array.isArray(constraint.referenced_columns) &&
          constraint.referenced_columns.length === constraint.columns.length,
        `${constraint.name} FK arity/target 无效`,
      );
      assertCondition(
        constraint.deferrable === false && constraint.initially_deferred === false,
        `${constraint.name} 必须 immediate`,
      );
    }
  }
  assertCondition(
    raw.constraints.some((constraint) => constraint.kind === "PRIMARY_KEY"),
    `${raw.qualified_name} 缺 PK`,
  );
  assertCondition(Array.isArray(raw.indexes), "relation indexes 缺失");
  const indexNames = new Set<string>();
  for (const index of raw.indexes) {
    assertCondition(isPlainRecord(index), "index descriptor 必须是 object");
    assertStrictKeys(
      index,
      ["name", "unique", "method", "columns", "include", "predicate", "backs_constraint"],
      `${raw.qualified_name}.index`,
    );
    assertCondition(typeof index.name === "string", "index name 缺失");
    assertCondition(Buffer.byteLength(index.name, "utf8") <= 63, "index name 超长");
    assertCondition(!indexNames.has(index.name), "index name 重复");
    indexNames.add(index.name);
    assertCondition(Array.isArray(index.columns), "index columns 必须是 array");
    for (const column of index.columns) {
      assertCondition(
        typeof column === "string" && columnNames.includes(column),
        `${index.name} 引用未知 column`,
      );
    }
    if (index.backs_constraint !== null) {
      assertCondition(
        typeof index.backs_constraint === "string" && constraintNames.has(index.backs_constraint),
        `${index.name} backing constraint 不存在`,
      );
    }
  }
  for (const constraint of raw.constraints) {
    if (constraint.kind === "PRIMARY_KEY" || constraint.kind === "UNIQUE") {
      assertCondition(
        raw.indexes.some(
          (index) => index.backs_constraint === constraint.name && index.unique === true,
        ),
        `${constraint.name} 缺 exact backing index`,
      );
    }
  }
  assertCondition(Array.isArray(raw.policies) && raw.policies.length >= 2, "relation policy 缺失");
  assertCondition(Array.isArray(raw.relation_acl), "relation ACL 缺失");
  const provisionable = raw.policies.some(
    (policy) =>
      isPlainRecord(policy) &&
      Array.isArray(policy.roles) &&
      policy.roles.includes("data_agent_u6_provisioner_owner"),
  );
  assertFrozenShape(
    raw.relation_acl,
    relationAcl(provisionable, raw.mutation_mode),
    `${raw.qualified_name}.relation_acl`,
  );
  assertCondition(
    !raw.relation_acl.some(
      (entry) =>
        isPlainRecord(entry) &&
        [
          "PUBLIC",
          "anon",
          "authenticated",
          "data_agent_backend",
          "data_agent_job_authority",
          "service_role",
        ].includes(String(entry.grantee)) &&
        Array.isArray(entry.privileges) &&
        entry.privileges.length > 0,
    ),
    "ordinary role 不得有 raw relation ACL",
  );
  assertCondition(
    Array.isArray(raw.triggers) &&
      ((raw.mutation_mode === "APPEND_ONLY" && raw.triggers.length === 1) ||
        (raw.mutation_mode === "MUTABLE_CURRENT_HEAD" && raw.triggers.length === 0)),
    "relation immutable/mutable trigger 分支漂移",
  );
  assertCondition(isPlainRecord(raw.cleanup), "cleanup descriptor 缺失");
  assertStrictKeys(
    raw.cleanup,
    ["cleanup_owner", "cleanup_rank", "cleanup_group", "static_predicate_id", "identity_order"],
    `${raw.qualified_name}.cleanup`,
  );
  if (raw.surface_kind === "COMPANION") {
    assertCondition(isPlainRecord(raw.companion_binding), "companion binding 缺失");
    const binding = raw.companion_binding;
    const bindingKeys =
      binding.kind === "BUDGET_INPUT"
        ? [
            "kind",
            "parent_relation",
            "parent_id_column",
            "parent_hash_column",
            "allowed_paths",
            "binding_group_protocol",
            "ordinal_scope",
            "ordinal_min",
            "ordinal_max",
            "requires_parent_exact_fk",
            "requires_artifact_exact_fk",
            "branches",
          ]
        : [
            "kind",
            "parent_relation",
            "parent_id_column",
            "parent_hash_column",
            "allowed_paths",
            "binding_group_protocol",
            "ordinal_scope",
            "ordinal_min",
            "ordinal_max",
            "requires_parent_exact_fk",
            "requires_artifact_exact_fk",
          ];
    assertStrictKeys(binding, bindingKeys, `${raw.qualified_name}.companion_binding`);
    assertCondition(
      binding.kind === "ARTIFACT_REFERENCE" || binding.kind === "BUDGET_INPUT",
      "companion binding kind 非法",
    );
    assertCondition(
      typeof binding.parent_relation === "string" &&
        typeof binding.parent_id_column === "string" &&
        typeof binding.parent_hash_column === "string",
      "companion parent identity 缺失",
    );
    assertCondition(
      Array.isArray(binding.allowed_paths) &&
        binding.allowed_paths.length > 0 &&
        binding.allowed_paths.every((path) => typeof path === "string") &&
        new Set(binding.allowed_paths).size === binding.allowed_paths.length,
      "companion canonical path 闭集无效",
    );
    assertCondition(
      binding.ordinal_scope === "PER_CANONICAL_PATH_AND_BINDING_GROUP" &&
        binding.ordinal_min === 0 &&
        binding.ordinal_max === 255,
      "companion ordinal 协议漂移",
    );
    assertCondition(
      binding.requires_parent_exact_fk === true && binding.requires_artifact_exact_fk === true,
      "companion exact FK requirement 漂移",
    );
    if (binding.kind === "BUDGET_INPUT") {
      assertCondition(
        binding.binding_group_protocol === "ROOT" &&
          Array.isArray(binding.branches) &&
          JSON.stringify(binding.branches) ===
            JSON.stringify(["ARTIFACT_REF", "BUDGET_EVENT", "RESERVATION_STATE"]),
        "budget companion branch/group 协议漂移",
      );
      assertCondition(
        raw.constraints.some(
          (constraint) =>
            constraint.kind === "CHECK" && constraint.expression === "binding_group = 'ROOT'",
        ),
        "budget companion 缺 ROOT binding group CHECK",
      );
    } else {
      assertCondition(
        [
          "ROOT",
          "ROOT_OR_EMBEDDED_REFERENCE_IDENTITY",
          "ROOT_OR_QUERY_CONTRACT_REFERENCE_IDENTITY",
          "ROOT_OR_QUERY_OR_EMBEDDED_REFERENCE_IDENTITY",
        ].includes(String(binding.binding_group_protocol)),
        "artifact companion binding group 协议漂移",
      );
    }
    assertCondition(columnNames.includes("parent_hash"), "companion 缺 parent_hash");
    assertCondition(columnNames.includes("binding_group"), "companion 缺 binding_group");
    assertCondition(columnNames.includes("ordinal"), "companion 缺 ordinal");
    assertCondition(
      raw.constraints.some(
        (constraint) =>
          constraint.kind === "FOREIGN_KEY" &&
          constraint.referenced_relation === binding.parent_relation &&
          JSON.stringify(constraint.columns) ===
            JSON.stringify([
              "app_id",
              "tenant_id",
              "environment",
              "run_id",
              "parent_id",
              "parent_hash",
            ]) &&
          JSON.stringify(constraint.referenced_columns) ===
            JSON.stringify([
              "app_id",
              "tenant_id",
              "environment",
              "run_id",
              binding.parent_id_column,
              binding.parent_hash_column,
            ]),
      ),
      "companion 缺 parent exact FK",
    );
    assertCondition(
      raw.constraints.some(
        (constraint) =>
          constraint.kind === "FOREIGN_KEY" &&
          constraint.referenced_relation === "app_data_agent.artifacts" &&
          JSON.stringify(constraint.columns) ===
            JSON.stringify([
              "app_id",
              "tenant_id",
              "environment",
              "run_id",
              "artifact_id",
              "artifact_type",
              "revision",
              "content_hash",
            ]) &&
          JSON.stringify(constraint.referenced_columns) ===
            JSON.stringify([
              "app_id",
              "tenant_id",
              "environment",
              "run_id",
              "artifact_id",
              "artifact_type",
              "revision",
              "content_hash",
            ]),
      ),
      "companion 缺 exact Artifact FK",
    );
  } else {
    assertCondition(raw.companion_binding === null, "core relation 不得伪装 companion");
  }
  return raw as unknown as RelationDescriptor;
}

function validateExpectedContext(context: U6C2PhysicalSchemaExpectedContext): void {
  assertCondition(isPlainRecord(context), "expectedContext 必须是 object");
  assertStrictKeys(
    context,
    [
      "baseline_migration_name",
      "baseline_migration_sha256",
      "baseline_inventory_hash",
      "c2_migration_name",
      "c2_source_segments",
      "existing_relations",
    ],
    "expectedContext",
  );
  assertCondition(
    context.baseline_migration_name === descriptorMaterial.baseline.migration_name,
    "expectedContext baseline migration name 漂移",
  );
  assertCondition(
    context.baseline_migration_sha256 === descriptorMaterial.baseline.migration_sha256,
    "expectedContext baseline migration sha256 漂移",
  );
  assertCondition(
    context.baseline_inventory_hash === descriptorMaterial.baseline.inventory_hash,
    "expectedContext baseline inventory hash 漂移",
  );
  assertCondition(
    context.c2_migration_name === descriptorMaterial.migrations[1].name,
    "expectedContext C2 migration name 漂移",
  );
  assertCondition(
    JSON.stringify(context.c2_source_segments) === JSON.stringify(c2SourceSegments),
    "expectedContext C2 source segments 漂移",
  );
  assertCondition(
    JSON.stringify(context.existing_relations) === JSON.stringify(existingRelationNames),
    "expectedContext existing relation tuple 漂移",
  );
}

export function validateU6C2PhysicalSchemaDescriptor(
  raw: unknown,
  expectedContext?: U6C2PhysicalSchemaExpectedContext,
): typeof U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR {
  const projected = projectDataJson(raw);
  assertCondition(isPlainRecord(projected), "physical descriptor 必须是 object");
  assertStrictKeys(
    projected,
    [
      "protocol_version",
      "target_inventory_protocol",
      "candidate_inventory_protocol",
      "status",
      "installable",
      "baseline",
      "migrations",
      "source_segments",
      "semantic_core_relations",
      "core_relations_are_source_segments",
      "authority",
      "relation_additions",
      "existing_relation_mutations",
      "future_catalog_facets",
      "canonicalization",
      "release_blockers",
      "physical_descriptor_hash",
    ],
    "physical descriptor",
  );
  assertCondition(projected.protocol_version === DESCRIPTOR_PROTOCOL, "descriptor protocol 漂移");
  assertCondition(
    projected.target_inventory_protocol === TARGET_INVENTORY_PROTOCOL,
    "target Inventory protocol 必须是 v2",
  );
  assertCondition(
    projected.candidate_inventory_protocol === CANDIDATE_INVENTORY_PROTOCOL,
    "Candidate Inventory protocol 必须是 v2",
  );
  assertCondition(
    projected.status === "FROZEN_TABLE_SURFACE" && projected.installable === false,
    "descriptor 必须保持不可安装的冻结表面",
  );
  assertFrozenShape(projected.baseline, descriptorMaterial.baseline, "baseline");
  assertFrozenShape(projected.migrations, descriptorMaterial.migrations, "migration chain");
  assertFrozenShape(
    projected.source_segments,
    descriptorMaterial.source_segments,
    "C2 source segments",
  );
  assertFrozenShape(projected.authority, descriptorMaterial.authority, "authority");
  assertFrozenShape(
    projected.future_catalog_facets,
    descriptorMaterial.future_catalog_facets,
    "future catalog facets",
  );
  assertFrozenShape(
    projected.canonicalization,
    descriptorMaterial.canonicalization,
    "canonicalization",
  );
  assertCondition(
    projected.core_relations_are_source_segments === false,
    "15 core relations 不能冒充 15 source segments",
  );
  assertCondition(Array.isArray(projected.semantic_core_relations), "semantic core tuple 缺失");
  assertCanonicalIdentities(
    projected.semantic_core_relations as string[],
    coreRelationNames,
    "15 core relations",
  );
  assertCondition(Array.isArray(projected.relation_additions), "relation additions 缺失");
  const additions = projected.relation_additions.map(validateRelationDescriptor);
  assertCanonicalIdentities(
    additions.map(({ qualified_name }) => qualified_name),
    [...coreRelationNames, ...companionRelationNames].sort(compareUtf8Bytes),
    "20 relation additions",
  );
  assertCondition(
    additions.filter(({ surface_kind }) => surface_kind === "CORE").length === 15 &&
      additions.filter(({ surface_kind }) => surface_kind === "COMPANION").length === 5,
    "relation additions 必须是 15 core + 5 companion",
  );
  assertFrozenShape(additions, sortedRelationAdditions, "20 relation additions");
  const frozenForeignKeyEdges = new Set(
    additions.flatMap((relation) =>
      relation.constraints
        .filter(
          (
            constraint,
          ): constraint is ConstraintDescriptor & {
            referenced_relation: string;
          } => constraint.kind === "FOREIGN_KEY" && constraint.referenced_relation !== null,
        )
        .map((constraint) =>
          foreignKeyEdgeIdentity({
            child_relation: relation.qualified_name,
            child_columns: constraint.columns,
            parent_relation: constraint.referenced_relation,
            parent_columns: constraint.referenced_columns,
          }),
        ),
    ),
  );
  for (const requiredEdge of mandatoryAuthorityForeignKeyEdges) {
    assertCondition(
      frozenForeignKeyEdges.has(foreignKeyEdgeIdentity(requiredEdge)),
      `mandatory authority FK 缺失：${requiredEdge.child_relation} -> ${requiredEdge.parent_relation}`,
    );
  }
  assertCondition(
    !additions
      .find(({ qualified_name }) => qualified_name === watermarkReceiptRelation)
      ?.constraints.some(
        ({ kind, referenced_relation }) =>
          kind === "FOREIGN_KEY" && referenced_relation === inputEventRelation,
      ),
    "Watermark Receipt 不得引用无法表达 genesis 的 Input Event 行",
  );
  const mutableHeadNames = additions
    .filter(({ mutation_mode }) => mutation_mode === "MUTABLE_CURRENT_HEAD")
    .map(({ qualified_name }) => qualified_name);
  assertCanonicalIdentities(
    mutableHeadNames,
    [enumeratorHeadRelation, inputHeadRelation, policyHeadRelation].sort(compareUtf8Bytes),
    "mutable current heads",
  );
  const candidate = additions.find(
    ({ qualified_name }) => qualified_name === candidateReceiptRelation,
  );
  assertCondition(candidate !== undefined, "Candidate Receipt relation 缺失");
  assertCondition(
    candidate.wire_protocols.includes("candidate-enumeration-receipt@2.0.0") &&
      !candidate.wire_protocols.includes("candidate-enumeration-receipt@1.0.0") &&
      candidate.columns.some(
        ({ name, type }) => name === "enumerator_head_version" && type === "bigint",
      ),
    "Candidate Receipt v2/enumerator_head_version 未冻结",
  );
  assertCondition(
    candidate.constraints.some(
      ({ kind, expression }) =>
        kind === "CHECK" &&
        expression ===
          "enumerator_capability_id = issuer_capability_id and enumerator_authority_epoch = issuer_authority_epoch",
    ),
    "Candidate Receipt Enumerator authority 必须逐字等于共同 issuer",
  );
  const attestation = additions.find(
    ({ qualified_name }) => qualified_name === attestationRelation,
  );
  assertCondition(attestation !== undefined, "Candidate Enumerator Attestation relation 缺失");
  assertCondition(
    attestation.constraints.some(
      ({ kind, columns }) =>
        kind === "UNIQUE" &&
        JSON.stringify(columns) ===
          JSON.stringify([
            "app_id",
            "tenant_id",
            "environment",
            "run_id",
            "coverage_artifact_id",
            "coverage_artifact_type",
            "coverage_revision",
            "coverage_content_hash",
            "budget_receipt_id",
            "budget_receipt_hash",
            "enumerator_version",
            "eig_policy_version",
            "enumeration_universe_hash",
          ]),
    ),
    "Candidate Enumerator Attestation semantic UQ 缺失",
  );
  assertCondition(
    attestation.constraints.some(
      ({ kind, columns }) =>
        kind === "UNIQUE" &&
        JSON.stringify(columns) ===
          JSON.stringify([
            "app_id",
            "tenant_id",
            "environment",
            "run_id",
            "attestation_id",
            "attestation_hash",
            "issuer_principal_id",
            "issuer_capability_id",
            "issuer_authority_epoch",
            "budget_receipt_id",
            "budget_receipt_hash",
            "enumerator_version",
            "eig_policy_version",
            "enumeration_universe_hash",
            "candidate_set_hash",
          ]),
    ),
    "Candidate Receipt 可引用的 Attestation exact authority/output UQ 缺失",
  );
  const stopReceipt = additions.find(
    ({ qualified_name }) => qualified_name === stopReceiptRelation,
  );
  assertCondition(
    stopReceipt?.wire_protocols.includes("research-stop-derivation-receipt@2.0.0") === true &&
      !stopReceipt.wire_protocols.includes("research-stop-derivation-receipt@1.0.0"),
    "Stop Receipt 必须用 v2 protocol/hash domain 绑定 Candidate Receipt v2",
  );
  assertCondition(
    additions
      .filter(({ surface_kind }) => surface_kind === "COMPANION")
      .every(
        ({ companion_binding }) =>
          companion_binding?.requires_parent_exact_fk === true &&
          companion_binding.requires_artifact_exact_fk === true &&
          companion_binding.ordinal_scope === "PER_CANONICAL_PATH_AND_BINDING_GROUP",
      ),
    "companion exact FK/binding group/ordinal 协议未闭合",
  );
  assertCondition(
    Array.isArray(projected.existing_relation_mutations),
    "existing relation mutations 缺失",
  );
  for (const [index, mutation] of projected.existing_relation_mutations.entries()) {
    assertCondition(isPlainRecord(mutation), "existing relation mutation 必须是 object");
    assertStrictKeys(
      mutation,
      [
        "qualified_name",
        "maintenance_reasons",
        "added_columns",
        "added_constraints",
        "added_indexes",
        "backfill",
        "final_defaults_absent",
        "preflight_check_ids",
        "baseline_catalog_binding",
        "target_catalog_binding",
      ],
      `existing_relation_mutations[${index}]`,
    );
    assertCondition(
      Array.isArray(mutation.maintenance_reasons) &&
        Array.isArray(mutation.added_columns) &&
        Array.isArray(mutation.added_constraints) &&
        Array.isArray(mutation.added_indexes) &&
        Array.isArray(mutation.backfill) &&
        Array.isArray(mutation.final_defaults_absent) &&
        Array.isArray(mutation.preflight_check_ids),
      `${String(mutation.qualified_name)} mutation array 字段无效`,
    );
  }
  const mutations = projected.existing_relation_mutations as unknown as ExistingRelationMutation[];
  assertCanonicalIdentities(
    mutations.map(({ qualified_name }) => qualified_name),
    existingRelationNames,
    "11 existing relations",
  );
  assertFrozenShape(mutations, sortedExistingRelationMutations, "11 existing relation mutations");
  for (const mutation of mutations) {
    assertCondition(
      mutation.maintenance_reasons.length > 0,
      `${mutation.qualified_name} maintenance reason 为空`,
    );
  }
  const reservationMutation = mutations.find(
    ({ qualified_name }) => qualified_name === "app_data_agent.research_resource_reservations",
  );
  assertCondition(reservationMutation !== undefined, "Reservation C2 mutation 缺失");
  for (const requiredColumns of [
    ["app_id", "tenant_id", "environment", "run_id", "reservation_id", "budget_epoch"],
    [
      "app_id",
      "tenant_id",
      "environment",
      "run_id",
      "reservation_id",
      "budget_epoch",
      "logical_step_id",
    ],
  ]) {
    assertCondition(
      reservationMutation.added_constraints.some(
        ({ kind, columns }) =>
          kind === "UNIQUE" && JSON.stringify(columns) === JSON.stringify(requiredColumns),
      ),
      `Reservation exact budget/step UQ 缺失：${requiredColumns.join(",")}`,
    );
  }
  assertCondition(
    Array.isArray(projected.release_blockers) &&
      JSON.stringify(projected.release_blockers) === JSON.stringify(releaseBlockers),
    "release blockers 漂移或被提前关闭",
  );
  assertCondition(
    typeof projected.physical_descriptor_hash === "string" &&
      SHA256_PATTERN.test(projected.physical_descriptor_hash),
    "physical_descriptor_hash 格式无效",
  );
  const material = structuredClone(projected) as Record<string, JsonValue>;
  delete material.physical_descriptor_hash;
  const computedHash = descriptorHash(material);
  assertCondition(
    computedHash === projected.physical_descriptor_hash,
    "physical descriptor 内嵌 hash 与 exact material 不匹配",
  );
  assertCondition(
    projected.physical_descriptor_hash === U6_C2_FROZEN_PHYSICAL_SCHEMA_HASH,
    "physical descriptor committed frozen hash 漂移",
  );
  if (expectedContext !== undefined) {
    validateExpectedContext(expectedContext);
  }
  return raw as typeof U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR;
}

export type U6C2InventorySurfaceKind = "constraint" | "function" | "index" | "relation";
export type U6C2InventorySurfaceEntry = DeepReadonly<{
  identity: string;
  descriptor: JsonRecord;
}>;
export type U6C2InventorySurfaceDelta = DeepReadonly<{
  additions: Record<U6C2InventorySurfaceKind, U6C2InventorySurfaceEntry[]>;
  replacements: Record<U6C2InventorySurfaceKind, U6C2InventorySurfaceEntry[]>;
}>;
export type U6C2InventoryReplacementAllowlist = DeepReadonly<
  Record<U6C2InventorySurfaceKind, string[]>
>;

function surfaceEntry(identity: string, descriptor: unknown): U6C2InventorySurfaceEntry {
  return {
    identity,
    descriptor: projectDataJson(descriptor) as JsonRecord,
  };
}

export function deriveU6C2InventorySurfaceDelta(): U6C2InventorySurfaceDelta {
  validateU6C2PhysicalSchemaDescriptor(U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR);
  const constraintAdditions = [
    ...sortedRelationAdditions.flatMap((relation) =>
      relation.constraints.map((constraint) =>
        surfaceEntry(`${relation.qualified_name}.${constraint.name}`, {
          relation: relation.qualified_name,
          ...constraint,
        }),
      ),
    ),
    ...sortedExistingRelationMutations.flatMap((relation) =>
      relation.added_constraints.map((constraint) =>
        surfaceEntry(`${relation.qualified_name}.${constraint.name}`, {
          relation: relation.qualified_name,
          ...constraint,
        }),
      ),
    ),
  ];
  const indexAdditions = [
    ...sortedRelationAdditions.flatMap((relation) =>
      relation.indexes.map((index) =>
        surfaceEntry(`${relation.qualified_name}.${index.name}`, {
          relation: relation.qualified_name,
          ...index,
        }),
      ),
    ),
    ...sortedExistingRelationMutations.flatMap((relation) =>
      relation.added_indexes.map((index) =>
        surfaceEntry(`${relation.qualified_name}.${index.name}`, {
          relation: relation.qualified_name,
          ...index,
        }),
      ),
    ),
  ];
  const delta: U6C2InventorySurfaceDelta = {
    additions: {
      relation: sortedRelationAdditions.map((relation) =>
        surfaceEntry(relation.qualified_name, relation),
      ),
      function: [],
      constraint: sortedByIdentity(constraintAdditions, ({ identity }) => identity),
      index: sortedByIdentity(indexAdditions, ({ identity }) => identity),
    },
    replacements: {
      relation: sortedExistingRelationMutations.map((mutation) =>
        surfaceEntry(mutation.qualified_name, mutation),
      ),
      function: [],
      constraint: [],
      index: [],
    },
  };
  return deepFreeze(delta);
}

export function deriveU6C2InventoryReplacementAllowlist(): U6C2InventoryReplacementAllowlist {
  validateU6C2PhysicalSchemaDescriptor(U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR);
  return deepFreeze({
    relation: [...existingRelationNames],
    function: [],
    constraint: [],
    index: [],
  });
}
