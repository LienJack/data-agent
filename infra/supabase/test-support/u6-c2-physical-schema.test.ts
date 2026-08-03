import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import {
  deriveU6C2InventoryReplacementAllowlist,
  deriveU6C2InventorySurfaceDelta,
  U6_C2_FROZEN_PHYSICAL_SCHEMA_HASH,
  U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR,
  validateU6C2PhysicalSchemaDescriptor,
} from "../../../scripts/u6-c2-physical-schema.ts";

const c2MigrationName =
  "20260725010600_app_data_agent_u6_research_derivation.sql";
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
const existingRelations = [
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
const semanticCoreRelations = [
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
const companionRelations = [
  "app_data_agent.research_budget_ledger_input_bindings",
  "app_data_agent.research_candidate_attestation_ref_bindings",
  "app_data_agent.research_candidate_enumeration_ref_bindings",
  "app_data_agent.research_coverage_derivation_ref_bindings",
  "app_data_agent.research_stop_derivation_ref_bindings",
] as const;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function recomputeEmbeddedHash(value: Record<string, unknown>): void {
  const material = structuredClone(value);
  delete material.physical_descriptor_hash;
  value.physical_descriptor_hash = `sha256:${createHash("sha256")
    .update(
      `u6-c2-physical-schema-descriptor@1.0.0\0${canonicalJson(material)}`,
    )
    .digest("hex")}`;
}

function cloneDescriptor(): Record<string, unknown> {
  return structuredClone(
    U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR,
  ) as unknown as Record<string, unknown>;
}

describe("U6-C2 physical schema descriptor", () => {
  test("冻结 exact 20 additions、11 existing 与 Candidate/target Inventory v2", () => {
    const descriptor = validateU6C2PhysicalSchemaDescriptor(
      U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR,
      {
        baseline_migration_name:
          "20260725010590_app_data_agent_u6_research_authority.sql",
        baseline_migration_sha256:
          "sha256:091534f8dae4132700564920f4e3e7316f6f411aff92efb108aa49d6ce255678",
        baseline_inventory_hash:
          "sha256:a400586a8bae3b5bc843cda0355b404c444b6a976f56ab7eca0dd05e1f34593e",
        c2_migration_name: c2MigrationName,
        c2_source_segments: c2SourceSegments,
        existing_relations: existingRelations,
      },
    );

    assert.equal(descriptor.installable, true);
    assert.equal(descriptor.status, "FROZEN_TABLE_SURFACE");
    assert.equal(
      descriptor.target_inventory_protocol,
      "u6-schema-inventory@2.0.0",
    );
    assert.equal(
      descriptor.candidate_inventory_protocol,
      "u6-schema-inventory-candidate@2.0.0",
    );
    assert.equal(
      descriptor.physical_descriptor_hash,
      U6_C2_FROZEN_PHYSICAL_SCHEMA_HASH,
    );
    assert.equal(descriptor.semantic_core_relations.length, 15);
    assert.deepEqual(descriptor.semantic_core_relations, semanticCoreRelations);
    assert.equal(descriptor.source_segments.length, 15);
    assert.equal(descriptor.core_relations_are_source_segments, false);
    assert.equal(descriptor.relation_additions.length, 20);
    assert.deepEqual(
      descriptor.relation_additions.map(({ qualified_name }) => qualified_name),
      [...semanticCoreRelations, ...companionRelations].sort(),
    );
    assert.equal(
      descriptor.relation_additions.filter(
        ({ surface_kind }) => surface_kind === "COMPANION",
      ).length,
      5,
    );
    assert.equal(descriptor.existing_relation_mutations.length, 11);
    assert.equal(descriptor.migrations[0].status, "IMMUTABLE");
    assert.equal(descriptor.migrations[1].sha256, null);
    assert.equal(
      descriptor.migrations[1].status,
      "AWAITING_RENDERED_10600_BYTES",
    );
  });

  test("Candidate Receipt v2 与五张 companion exact FK/分组闭合", () => {
    const candidate = U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR.relation_additions.find(
      ({ qualified_name }) =>
        qualified_name ===
        "app_data_agent.research_candidate_enumeration_receipts",
    );
    assert.ok(candidate);
    assert.deepEqual(candidate.wire_protocols, [
      "candidate-enumeration-receipt@2.0.0",
    ]);
    assert.ok(
      candidate.columns.some(
        ({ name, type }) =>
          name === "enumerator_head_version" && type === "bigint",
      ),
    );

    const companions =
      U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR.relation_additions.filter(
        ({ surface_kind }) => surface_kind === "COMPANION",
      );
    for (const companion of companions) {
      assert.ok(companion.columns.some(({ name }) => name === "parent_hash"));
      assert.ok(companion.columns.some(({ name }) => name === "binding_group"));
      assert.ok(companion.columns.some(({ name }) => name === "ordinal"));
      assert.ok(
        companion.constraints.some(
          ({ kind, columns }) =>
            kind === "FOREIGN_KEY" && columns.includes("parent_hash"),
        ),
      );
      assert.ok(
        companion.constraints.some(
          ({ kind, referenced_relation }) =>
            kind === "FOREIGN_KEY" &&
            referenced_relation === "app_data_agent.artifacts",
        ),
      );
      assert.equal(
        companion.companion_binding?.ordinal_scope,
        "PER_CANONICAL_PATH_AND_BINDING_GROUP",
      );
    }

    const budgetCompanion = companions.find(
      ({ qualified_name }) =>
        qualified_name ===
        "app_data_agent.research_budget_ledger_input_bindings",
    );
    assert.ok(budgetCompanion);
    assert.ok(
      budgetCompanion.constraints.some(
        ({ kind, expression }) =>
          kind === "CHECK" && expression === "binding_group = 'ROOT'",
      ),
    );
    assert.deepEqual(
      budgetCompanion.columns
        .filter(({ name }) =>
          [
            "strict_ref_json",
            "artifact_id",
            "artifact_type",
            "revision",
            "content_hash",
            "node_id",
          ].includes(name),
        )
        .map(({ name, nullable }) => [name, nullable]),
      [
        ["strict_ref_json", true],
        ["artifact_id", true],
        ["artifact_type", true],
        ["revision", true],
        ["content_hash", true],
        ["node_id", true],
      ],
    );

    const candidateCompanions = companions.filter(({ qualified_name }) =>
      [
        "app_data_agent.research_candidate_attestation_ref_bindings",
        "app_data_agent.research_candidate_enumeration_ref_bindings",
      ].includes(qualified_name),
    );
    assert.equal(candidateCompanions.length, 2);
    for (const candidateCompanion of candidateCompanions) {
      assert.equal(
        candidateCompanion.companion_binding?.binding_group_protocol,
        "ROOT_OR_QUERY_OR_EMBEDDED_REFERENCE_IDENTITY",
      );
    }

    const stopReceipt =
      U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR.relation_additions.find(
        ({ qualified_name }) =>
          qualified_name ===
          "app_data_agent.research_stop_derivation_receipts",
      );
    assert.ok(stopReceipt);
    assert.deepEqual(stopReceipt.wire_protocols, [
      "research-stop-derivation-receipt@2.0.0",
    ]);
  });

  test("mutable Head、ACL 与 mandatory authority FK graph 均 fail closed", () => {
    const descriptor = U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR;
    const mutableHeads = descriptor.relation_additions.filter(
      ({ mutation_mode }) => mutation_mode === "MUTABLE_CURRENT_HEAD",
    );
    assert.deepEqual(
      mutableHeads.map(({ qualified_name }) => qualified_name),
      [
        "app_data_agent.research_budget_policy_heads",
        "app_data_agent.research_enumerator_version_heads",
        "app_data_agent.research_input_event_heads",
      ],
    );
    for (const relation of descriptor.relation_additions) {
      assert.equal(
        relation.triggers.length,
        relation.mutation_mode === "APPEND_ONLY" ? 1 : 0,
      );
      assert.ok(
        relation.relation_acl.some(
          ({ grantee, privileges }) =>
            grantee === "data_agent_u6_rpc_owner" &&
            privileges.includes("INSERT") &&
            privileges.includes("SELECT"),
        ),
      );
      assert.ok(
        relation.relation_acl.some(
          ({ grantee, privileges }) =>
            grantee === "data_agent_u6_cleanup_owner" &&
            privileges.includes("DELETE") &&
            privileges.includes("SELECT"),
        ),
      );
    }
    assert.deepEqual(descriptor.authority.forbidden_raw_dml_roles, [
      "PUBLIC",
      "anon",
      "authenticated",
      "data_agent_backend",
      "data_agent_job_authority",
      "service_role",
    ]);
    assert.deepEqual(descriptor.authority.default_acl, []);

    const relation = (qualifiedName: string) => {
      const found = descriptor.relation_additions.find(
        ({ qualified_name }) => qualified_name === qualifiedName,
      );
      assert.ok(found, `relation missing: ${qualifiedName}`);
      return found;
    };
    const hasForeignKey = (
      child: string,
      childColumns: readonly string[],
      parent: string,
      parentColumns: readonly string[],
    ) =>
      relation(child).constraints.some(
        ({ kind, columns, referenced_relation, referenced_columns }) =>
          kind === "FOREIGN_KEY" &&
          referenced_relation === parent &&
          JSON.stringify(columns) === JSON.stringify(childColumns) &&
          JSON.stringify(referenced_columns) === JSON.stringify(parentColumns),
      );
    const hasUniqueConstraint = (
      qualifiedName: string,
      expectedColumns: readonly string[],
    ) =>
      relation(qualifiedName).constraints.some(
        ({ kind, columns }) =>
          kind === "UNIQUE" &&
          JSON.stringify(columns) === JSON.stringify(expectedColumns),
      );

    assert.ok(
      hasForeignKey(
        "app_data_agent.research_step_operations",
        [
          "app_id",
          "tenant_id",
          "environment",
          "attempt_id",
          "outbox_id",
          "run_id",
          "worker_fence",
        ],
        "app_data_agent.run_attempts",
        [
          "app_id",
          "tenant_id",
          "environment",
          "attempt_id",
          "outbox_id",
          "run_id",
          "worker_fence",
        ],
      ),
    );
    assert.ok(
      hasForeignKey(
        "app_data_agent.research_candidate_enumerator_attestations",
        [
          "app_id",
          "tenant_id",
          "environment",
          "issuer_capability_id",
          "issuer_authority_epoch",
          "issuer_principal_id",
        ],
        "app_data_agent.research_authority_capabilities",
        [
          "app_id",
          "tenant_id",
          "environment",
          "capability_id",
          "authority_epoch",
          "principal_id",
        ],
      ),
    );
    assert.ok(
      hasForeignKey(
        "app_data_agent.research_budget_ledger_receipts",
        [
          "app_id",
          "tenant_id",
          "environment",
          "tenant_policy_version",
          "tenant_policy_hash",
        ],
        "app_data_agent.research_budget_policy_versions",
        [
          "app_id",
          "tenant_id",
          "environment",
          "tenant_policy_version",
          "tenant_policy_hash",
        ],
      ),
    );
    assert.ok(
      hasForeignKey(
        "app_data_agent.research_input_event_watermark_receipts",
        ["app_id", "tenant_id", "environment", "run_id"],
        "app_data_agent.research_input_event_heads",
        ["app_id", "tenant_id", "environment", "run_id"],
      ),
    );
    assert.ok(
      hasForeignKey(
        "app_data_agent.research_budget_events",
        [
          "app_id",
          "tenant_id",
          "environment",
          "run_id",
          "reservation_id",
          "budget_epoch",
        ],
        "app_data_agent.research_resource_reservations",
        [
          "app_id",
          "tenant_id",
          "environment",
          "run_id",
          "reservation_id",
          "budget_epoch",
        ],
      ),
    );
    assert.ok(
      hasForeignKey(
        "app_data_agent.research_budget_events",
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
    );
    assert.ok(
      hasUniqueConstraint(
        "app_data_agent.research_candidate_enumerator_attestations",
        [
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
        ],
      ),
    );
    const candidateAttestationBindingColumns = [
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
    ] as const;
    assert.ok(
      hasUniqueConstraint(
        "app_data_agent.research_candidate_enumerator_attestations",
        candidateAttestationBindingColumns,
      ),
    );
    assert.ok(
      hasForeignKey(
        "app_data_agent.research_candidate_enumeration_receipts",
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
        "app_data_agent.research_candidate_enumerator_attestations",
        candidateAttestationBindingColumns,
      ),
    );
    assert.ok(
      relation(
        "app_data_agent.research_candidate_enumeration_receipts",
      ).constraints.some(
        ({ kind, expression }) =>
          kind === "CHECK" &&
          expression ===
            "enumerator_capability_id = issuer_capability_id and enumerator_authority_epoch = issuer_authority_epoch",
      ),
    );
    const reservationMutation =
      descriptor.existing_relation_mutations.find(
        ({ qualified_name }) =>
          qualified_name ===
          "app_data_agent.research_resource_reservations",
      );
    assert.ok(reservationMutation);
    for (const expectedColumns of [
      [
        "app_id",
        "tenant_id",
        "environment",
        "run_id",
        "reservation_id",
        "budget_epoch",
      ],
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
      assert.ok(
        reservationMutation.added_constraints.some(
          ({ kind, columns }) =>
            kind === "UNIQUE" &&
            JSON.stringify(columns) === JSON.stringify(expectedColumns),
        ),
      );
    }
    assert.equal(
      relation(
        "app_data_agent.research_input_event_watermark_receipts",
      ).constraints.some(
        ({ kind, referenced_relation }) =>
          kind === "FOREIGN_KEY" &&
          referenced_relation === "app_data_agent.research_input_events",
      ),
      false,
    );
    assert.equal(
      relation("app_data_agent.research_step_operations").constraints.some(
        ({ kind, referenced_relation }) =>
          kind === "FOREIGN_KEY" &&
          referenced_relation === "app_data_agent.research_budget_events",
      ),
      false,
    );
  });

  test("strict validator 拒绝闭集、顺序、列、v1 与 companion 漂移", () => {
    const extraKey = cloneDescriptor();
    extraKey.forbidden = true;
    assert.throws(
      () => validateU6C2PhysicalSchemaDescriptor(extraKey),
      /字段不闭合/,
    );

    const nestedExtraKey = cloneDescriptor();
    const nestedRelation = (
      nestedExtraKey.relation_additions as Array<Record<string, unknown>>
    )[0]!;
    const nestedPolicy = (
      nestedRelation.policies as Array<Record<string, unknown>>
    )[0]!;
    nestedPolicy.forbidden = true;
    assert.throws(
      () => validateU6C2PhysicalSchemaDescriptor(nestedExtraKey),
      /frozen shape/,
    );

    const missingRelation = cloneDescriptor();
    (
      missingRelation.relation_additions as Array<Record<string, unknown>>
    ).pop();
    assert.throws(
      () => validateU6C2PhysicalSchemaDescriptor(missingRelation),
      /20 relation additions/,
    );

    const reordered = cloneDescriptor();
    (
      reordered.relation_additions as Array<Record<string, unknown>>
    ).reverse();
    assert.throws(
      () => validateU6C2PhysicalSchemaDescriptor(reordered),
      /closed set|顺序/,
    );

    const attnumDrift = cloneDescriptor();
    const firstRelation = (
      attnumDrift.relation_additions as Array<Record<string, unknown>>
    )[0]!;
    (
      firstRelation.columns as Array<Record<string, unknown>>
    )[0]!.attnum = 2;
    assert.throws(
      () => validateU6C2PhysicalSchemaDescriptor(attnumDrift),
      /attnum/,
    );

    const candidateV1 = cloneDescriptor();
    const candidate = (
      candidateV1.relation_additions as Array<Record<string, unknown>>
    ).find(
      ({ qualified_name }) =>
        qualified_name ===
        "app_data_agent.research_candidate_enumeration_receipts",
    )!;
    candidate.wire_protocols = ["candidate-enumeration-receipt@1.0.0"];
    assert.throws(
      () => validateU6C2PhysicalSchemaDescriptor(candidateV1),
      /Candidate Receipt v2/,
    );

    const attestationSemanticDrift = cloneDescriptor();
    const attestation = (
      attestationSemanticDrift.relation_additions as Array<
        Record<string, unknown>
      >
    ).find(
      ({ qualified_name }) =>
        qualified_name ===
        "app_data_agent.research_candidate_enumerator_attestations",
    )!;
    const semanticUnique = (
      attestation.constraints as Array<Record<string, unknown>>
    ).find(
      ({ kind, columns }) =>
        kind === "UNIQUE" &&
        Array.isArray(columns) &&
        columns.includes("enumeration_universe_hash"),
    )!;
    const semanticColumns = semanticUnique.columns as string[];
    semanticColumns[semanticColumns.indexOf("budget_receipt_hash")] =
      "candidate_set_hash";
    assert.throws(
      () =>
        validateU6C2PhysicalSchemaDescriptor(attestationSemanticDrift),
      /Attestation semantic UQ/,
    );

    const candidateAuthorityDrift = cloneDescriptor();
    const candidateWithDrift = (
      candidateAuthorityDrift.relation_additions as Array<
        Record<string, unknown>
      >
    ).find(
      ({ qualified_name }) =>
        qualified_name ===
        "app_data_agent.research_candidate_enumeration_receipts",
    )!;
    const authorityCheck = (
      candidateWithDrift.constraints as Array<Record<string, unknown>>
    ).find(
      ({ kind, expression }) =>
        kind === "CHECK" &&
        typeof expression === "string" &&
        expression.includes("enumerator_capability_id"),
    )!;
    authorityCheck.expression = "enumerator_authority_epoch >= 0";
    assert.throws(
      () => validateU6C2PhysicalSchemaDescriptor(candidateAuthorityDrift),
      /Enumerator authority/,
    );

    const reservationEpochDrift = cloneDescriptor();
    const reservationMutation = (
      reservationEpochDrift.existing_relation_mutations as Array<
        Record<string, unknown>
      >
    ).find(
      ({ qualified_name }) =>
        qualified_name ===
        "app_data_agent.research_resource_reservations",
    )!;
    const reservationEpochUnique = (
      reservationMutation.added_constraints as Array<Record<string, unknown>>
    ).find(
      ({ kind, columns }) =>
        kind === "UNIQUE" &&
        Array.isArray(columns) &&
        columns.includes("budget_epoch") &&
        !columns.includes("logical_step_id"),
    )!;
    const reservationColumns = reservationEpochUnique.columns as string[];
    reservationColumns[reservationColumns.indexOf("budget_epoch")] =
      "reservation_seq";
    assert.throws(
      () => validateU6C2PhysicalSchemaDescriptor(reservationEpochDrift),
      /Reservation exact budget\/step UQ/,
    );

    const missingParentHash = cloneDescriptor();
    const companion = (
      missingParentHash.relation_additions as Array<Record<string, unknown>>
    ).find(({ surface_kind }) => surface_kind === "COMPANION")!;
    companion.columns = (
      companion.columns as Array<Record<string, unknown>>
    ).filter(({ name }) => name !== "parent_hash");
    assert.throws(
      () => validateU6C2PhysicalSchemaDescriptor(missingParentHash),
      /attnum|parent_hash|unknown column/,
    );
  });

  test("strict validator 不执行 getter，并拒绝 symbol、sparse、prototype、cycle 与 unsafe number", () => {
    const accessor = cloneDescriptor();
    const originalAuthority = accessor.authority;
    delete accessor.authority;
    let getterCalls = 0;
    Object.defineProperty(accessor, "authority", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return originalAuthority;
      },
    });
    assert.throws(
      () => validateU6C2PhysicalSchemaDescriptor(accessor),
      /enumerable data property/,
    );
    assert.equal(getterCalls, 0);

    const symbolKey = cloneDescriptor();
    Object.defineProperty(symbolKey, Symbol("forbidden"), {
      enumerable: true,
      value: true,
    });
    assert.throws(
      () => validateU6C2PhysicalSchemaDescriptor(symbolKey),
      /symbol key/,
    );

    const sparseArray = cloneDescriptor();
    delete (
      sparseArray.relation_additions as Array<Record<string, unknown>>
    )[0];
    assert.throws(
      () => validateU6C2PhysicalSchemaDescriptor(sparseArray),
      /sparse array/,
    );

    const customPrototype = cloneDescriptor();
    Object.setPrototypeOf(customPrototype, { forbidden: true });
    assert.throws(
      () => validateU6C2PhysicalSchemaDescriptor(customPrototype),
      /prototype 漂移/,
    );

    const cyclic = cloneDescriptor();
    cyclic.cycle = cyclic;
    assert.throws(
      () => validateU6C2PhysicalSchemaDescriptor(cyclic),
      /循环引用/,
    );

    const unsafeNumber = cloneDescriptor();
    (
      unsafeNumber.authority as Record<string, unknown>
    ).cleanup_guard_relation_count_after_c2 = Number.MAX_SAFE_INTEGER + 1;
    assert.throws(
      () => validateU6C2PhysicalSchemaDescriptor(unsafeNumber),
      /安全 JSON value/,
    );

    const sharedDag = cloneDescriptor();
    const firstRelation = (
      sharedDag.relation_additions as Array<Record<string, unknown>>
    )[0]!;
    const indexes = firstRelation.indexes as Array<Record<string, unknown>>;
    assert.ok(indexes.length >= 2);
    indexes[1]!.include = indexes[0]!.include;
    assert.doesNotThrow(() =>
      validateU6C2PhysicalSchemaDescriptor(sharedDag),
    );
  });

  test("existing ALTER 列使用 10590 live baseline 的真实 attnum", () => {
    const mutations =
      U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR.existing_relation_mutations;
    const actual = Object.fromEntries(
      mutations
        .filter(({ added_columns }) => added_columns.length > 0)
        .map(({ qualified_name, added_columns }) => [
          qualified_name,
          added_columns.map(({ name, attnum }) => [name, attnum]),
        ]),
    );

    assert.deepEqual(actual, {
      "app_data_agent.research_artifact_commit_operations": [
        ["wire_protocol_version", 18],
        ["budget_receipt_id", 19],
        ["budget_receipt_hash", 20],
      ],
      "app_data_agent.research_domain_terminals": [
        ["stop_derivation_receipt_id", 16],
        ["stop_derivation_receipt_hash", 17],
      ],
      "app_data_agent.research_resource_reservations": [
        ["budget_epoch", 31],
        ["logical_step_id", 32],
      ],
      "app_data_agent.research_resource_run_heads": [
        ["next_step_seq", 7],
        ["next_budget_event_seq", 8],
        ["budget_epoch", 9],
        ["budget_epoch_state", 10],
        ["budget_started_at", 11],
        ["last_budget_event_hash", 12],
      ],
      "app_data_agent.research_stop_terminal_commits": [
        ["stop_derivation_receipt_id", 14],
        ["stop_derivation_receipt_hash", 15],
      ],
    });
  });

  test("冻结的 CHECK 是列级 PostgreSQL 表达式，不包含语义占位词", () => {
    const descriptor = U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR;
    const checks = [
      ...descriptor.relation_additions.flatMap(({ constraints }) =>
        constraints.filter(({ kind }) => kind === "CHECK"),
      ),
      ...descriptor.existing_relation_mutations.flatMap(({ added_constraints }) =>
        added_constraints.filter(({ kind }) => kind === "CHECK"),
      ),
    ];
    assert.ok(checks.length > 0);
    for (const check of checks) {
      assert.equal(typeof check.expression, "string");
      assert.doesNotMatch(
        check.expression!,
        /\bvalue between\b|exactly_one_|_requires_|_is_exact\b|legacy_epoch_zero_/,
      );
    }

    const companions = descriptor.relation_additions.filter(
      ({ surface_kind }) => surface_kind === "COMPANION",
    );
    for (const companion of companions) {
      assert.ok(
        companion.constraints.some(
          ({ kind, expression }) =>
            kind === "CHECK" && expression?.startsWith("canonical_path in ("),
        ),
      );
    }

    const resourceHead = descriptor.existing_relation_mutations.find(
      ({ qualified_name }) =>
        qualified_name === "app_data_agent.research_resource_run_heads",
    );
    assert.ok(resourceHead);
    assert.ok(
      resourceHead.backfill.includes(
        "budget_epoch_state := 'LEGACY_BUDGET_EPOCH_UNPROVABLE'",
      ),
    );
    const budgetEpochStateCheck = resourceHead.added_constraints.find(
      ({ kind, name }) =>
        kind === "CHECK" && name.includes("budget_epoch_state"),
    );
    assert.ok(budgetEpochStateCheck?.expression);
    assert.match(
      budgetEpochStateCheck.expression,
      /budget_epoch_state = 'ACTIVE'.*last_budget_event_hash ~ '\^sha256:/,
    );
    assert.doesNotMatch(
      budgetEpochStateCheck.expression,
      /last_budget_event_hash is null or/,
    );
  });

  test("内嵌 hash 与 committed frozen hash 是两道独立门", () => {
    const contentDrift = cloneDescriptor();
    const authority = contentDrift.authority as Record<string, unknown>;
    authority.cleanup_guard_relation_count_after_c2 = 34;
    assert.throws(
      () => validateU6C2PhysicalSchemaDescriptor(contentDrift),
      /内嵌 hash/,
    );

    recomputeEmbeddedHash(contentDrift);
    assert.notEqual(
      contentDrift.physical_descriptor_hash,
      U6_C2_FROZEN_PHYSICAL_SCHEMA_HASH,
    );
    assert.throws(
      () => validateU6C2PhysicalSchemaDescriptor(contentDrift),
      /committed frozen hash/,
    );
  });

  test("expectedContext 漂移在进入 Candidate builder 前失败", () => {
    assert.throws(
      () =>
        validateU6C2PhysicalSchemaDescriptor(
          U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR,
          {
            baseline_migration_name:
              "20260725010590_app_data_agent_u6_research_authority.sql",
            baseline_migration_sha256:
              "sha256:091534f8dae4132700564920f4e3e7316f6f411aff92efb108aa49d6ce255678",
            baseline_inventory_hash:
              "sha256:a400586a8bae3b5bc843cda0355b404c444b6a976f56ab7eca0dd05e1f34593e",
            c2_migration_name: c2MigrationName,
            c2_source_segments: [...c2SourceSegments].reverse(),
            existing_relations: existingRelations,
          },
        ),
      /source segments 漂移/,
    );
  });

  test("Inventory surface/allowlist 只能确定性派生且深冻结", () => {
    const first = deriveU6C2InventorySurfaceDelta();
    const second = deriveU6C2InventorySurfaceDelta();
    const allowlist = deriveU6C2InventoryReplacementAllowlist();

    assert.deepEqual(first, second);
    assert.equal(first.additions.relation.length, 20);
    assert.equal(first.replacements.relation.length, 11);
    assert.deepEqual(
      first.replacements.relation.map(({ identity }) => identity),
      allowlist.relation,
    );
    assert.ok(first.additions.constraint.length > 0);
    assert.ok(first.additions.index.length > 0);
    assert.ok(Object.isFrozen(first));
    assert.ok(Object.isFrozen(first.additions.relation));
    assert.ok(Object.isFrozen(first.additions.relation[0]!.descriptor));
    const firstRelationDescriptor = first.additions.relation[0]!
      .descriptor as Record<string, unknown>;
    assert.ok(Object.isFrozen(firstRelationDescriptor.columns));
    assert.ok(Object.isFrozen(firstRelationDescriptor.constraints));
    assert.ok(Object.isFrozen(allowlist));
    assert.ok(Object.isFrozen(allowlist.relation));
    assert.throws(() => {
      // @ts-expect-error Surface Delta 的公开合同必须在编译期拒绝 mutation。
      first.additions.relation.push(first.additions.relation[0]!);
    }, /object is not extensible|read only|frozen/i);
  });
});
