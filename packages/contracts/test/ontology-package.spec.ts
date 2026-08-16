import { describe, expect, it } from "vitest";
import {
  buildOntologyPackageCandidate,
  buildOntologyPackageValidationReceipt,
  computeOntologyConstraintRuleHash,
  computeOntologyFormulaAstHash,
  deriveOntologyNamespaceId,
  deriveOntologyPackageId,
  deriveOntologyStableObjectId,
  verifyOntologyPackageCandidate,
  verifyOntologyPackageValidationReceipt,
} from "../src/artifacts/ontology-package.js";
import {
  BUILTIN_SEMANTIC_EDGE_TYPES,
  BUILTIN_SEMANTIC_NODE_TYPES,
  SEMANTIC_GRAPH_SOURCE_VERSION,
} from "../src/artifacts/semantic-graph-v2.js";
import { sha256ContentHash } from "../src/common/index.js";

const H = (character: string) => `sha256:${character.repeat(64)}` as const;

async function fixture() {
  const namespaceBase = {
    app_id: "00000000-0000-4000-8000-000000000401",
    tenant_id: "00000000-0000-4000-8000-000000000402",
    workspace_id: "00000000-0000-4000-8000-000000000402",
    environment: "test",
    semantic_domain: "commerce",
  } as const;
  const namespace = {
    ...namespaceBase,
    namespace_id: await deriveOntologyNamespaceId(namespaceBase),
  };
  const source = {
    source_class: "BUSINESS_CONTEXT" as const,
    source_role: "BUSINESS_SOURCE_BUNDLE" as const,
    namespace_id: namespace.namespace_id,
    source_id: "00000000-0000-4000-8000-000000000403",
    source_version: 1,
    source_hash: H("3"),
    object_path: ["subjects", "order"],
  };
  const subjectId = await deriveOntologyStableObjectId({
    namespace,
    source,
    semantic_role: "ENTITY",
  });
  const constraintSource = { ...source, object_path: ["constraints", "order-required"] };
  const constraintId = await deriveOntologyStableObjectId({
    namespace,
    source: constraintSource,
    semantic_role: "CONSTRAINT",
  });
  const rule = { kind: "REQUIRED", target_object_id: subjectId } as const;
  const expression = {
    kind: "AGGREGATE" as const,
    function: "COUNT" as const,
    input: null,
    distinct: false,
    filter: null,
  };

  return {
    schema_version: "ontology-package@1.0.0" as const,
    namespace,
    package_id: await deriveOntologyPackageId(namespace),
    package_version: 1,
    status: "CANDIDATE" as const,
    source_binding: {
      schema_snapshot: {
        source_class: "SCHEMA" as const,
        source_role: "SCHEMA_SNAPSHOT" as const,
        namespace_id: namespace.namespace_id,
        source_id: "00000000-0000-4000-8000-000000000404",
        source_version: 1,
        source_hash: H("4"),
        object_path: ["snapshot"],
      },
      business_source_bundle: { ...source, object_path: ["bundle"] },
      policy: {
        source_class: "POLICY" as const,
        source_role: "POLICY_DIGEST" as const,
        namespace_id: namespace.namespace_id,
        source_id: "00000000-0000-4000-8000-000000000405",
        source_version: 1,
        source_hash: H("5"),
        object_path: ["policy"],
      },
      datasource_id: "00000000-0000-4000-8000-000000000406",
    },
    dependencies: [],
    imports: [],
    objects: [
      {
        object_id: subjectId,
        graph_entry_kind: "NODE" as const,
        graph_entry_id: "subject-order",
        source,
        semantic_role: "ENTITY" as const,
        resolution: "RESOLVED" as const,
      },
      {
        object_id: constraintId,
        graph_entry_kind: "AUXILIARY" as const,
        graph_entry_id: "constraint-order-required",
        source: constraintSource,
        semantic_role: "CONSTRAINT" as const,
        resolution: "RESOLVED" as const,
      },
    ],
    business_subjects: [
      { object_id: subjectId, graph_node_id: "subject-order", role: "ENTITY" as const },
    ],
    dimensions: [],
    edge_semantics: [],
    constraints: [
      {
        constraint_id: constraintId,
        target_kind: "NODE" as const,
        target_object_id: subjectId,
        constraint_kind: "REQUIRED" as const,
        rule,
        rule_hash: await computeOntologyConstraintRuleHash(rule),
        provenance_object_ids: [subjectId],
        validation_status: "VALID" as const,
      },
    ],
    physical_mappings: [],
    metric_bindings: [
      {
        metric_object_id: subjectId,
        formula_object_id: subjectId,
        dimension_object_ids: [],
        grain_object_ids: [],
        time_object_id: null,
        unit_object_id: null,
        formula_ast_hash: await computeOntologyFormulaAstHash(expression),
        compiler_digest: H("6"),
        resolution: "UNRESOLVED" as const,
      },
    ],
    graph_source: {
      metadata: {
        graph_version: SEMANTIC_GRAPH_SOURCE_VERSION,
        graph_id: "00000000-0000-4000-8000-000000000407",
        domain_id: namespace.semantic_domain,
        base_release_id: null,
        capability_profile: "U5_EXECUTABLE_SUBSET" as const,
        scope: {
          app_id: namespace.app_id,
          tenant_id: namespace.tenant_id,
          environment: namespace.environment,
        },
        producer: { kind: "deterministic" as const, id: "u4-fixture" },
        authority: {
          kind: "deterministic" as const,
          id: "ontology-package-validator",
          policy_version: "ontology-package-validator@1.0.0",
        },
        created_at: "2026-08-17T00:00:00.000Z",
      },
      node_type_registry: BUILTIN_SEMANTIC_NODE_TYPES,
      edge_type_registry: BUILTIN_SEMANTIC_EDGE_TYPES,
      evidence: [],
      nodes: [
        {
          node_id: "subject-order",
          node_version: 1,
          node_type: "BUSINESS_SUBJECT" as const,
          name: "订单",
          aliases: [],
          owner_ref: "data-team",
          lifecycle: "ACTIVE" as const,
          evidence_refs: [],
          tags: [],
          domain: namespace.semantic_domain,
        },
      ],
      edges: [],
    },
    mandatory_manifest: {
      manifest_version: "mandatory-release-manifest@1.0.0" as const,
      node_object_ids: [subjectId],
      edge_object_ids: [],
      constraint_ids: [constraintId],
      mapping_ids: [],
      metric_object_ids: [],
    },
  };
}

describe("OntologyPackageCandidate", () => {
  it("derives stable IDs from namespace, source identity and semantic role", async () => {
    const input = await fixture();
    const first = input.objects[0];
    if (first === undefined) throw new Error("fixture must contain an ontology object");
    expect(
      await deriveOntologyStableObjectId({
        namespace: input.namespace,
        source: first.source,
        semantic_role: first.semantic_role,
      }),
    ).toBe(first.object_id);
    expect(
      await deriveOntologyStableObjectId({
        namespace: input.namespace,
        source: first.source,
        semantic_role: "CLASS",
      }),
    ).not.toBe(first.object_id);
  });

  it("produces the same package hash after canonical array reordering", async () => {
    const input = await fixture();
    const first = await buildOntologyPackageCandidate(input);
    const reordered = await buildOntologyPackageCandidate({
      ...input,
      objects: [...input.objects].reverse(),
      graph_source: {
        ...input.graph_source,
        node_type_registry: [...input.graph_source.node_type_registry].reverse(),
        edge_type_registry: [...input.graph_source.edge_type_registry].reverse(),
      },
    });
    expect(reordered.package_hash).toBe(first.package_hash);
    await expect(verifyOntologyPackageCandidate(reordered)).resolves.toBe(true);
  });

  it("rejects cross-workspace source bindings", async () => {
    const input = await fixture();
    await expect(
      buildOntologyPackageCandidate({
        ...input,
        source_binding: {
          ...input.source_binding,
          schema_snapshot: {
            ...input.source_binding.schema_snapshot,
            namespace_id: "00000000-0000-4000-8000-000000000499",
          },
        },
      }),
    ).rejects.toThrow(/namespace/i);
  });

  it("strictly rejects Falcon gold, expected, sealed and holdout sources", async () => {
    const input = await fixture();
    await expect(
      buildOntologyPackageCandidate({
        ...input,
        source_binding: {
          ...input.source_binding,
          business_source_bundle: {
            ...input.source_binding.business_source_bundle,
            source_role: "FALCON_GOLD",
          },
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects unresolved objects from the mandatory manifest", async () => {
    const input = await fixture();
    await expect(
      buildOntologyPackageCandidate({
        ...input,
        objects: input.objects.map((entry) =>
          entry.object_id === input.mandatory_manifest.node_object_ids[0]
            ? { ...entry, resolution: "UNRESOLVED" as const }
            : entry,
        ),
      }),
    ).rejects.toThrow(/mandatory/i);
  });

  it("rejects duplicate stable IDs instead of silently deduplicating", async () => {
    const input = await fixture();
    await expect(
      buildOntologyPackageCandidate({ ...input, objects: [...input.objects, input.objects[0]] }),
    ).rejects.toThrow(/duplicate/i);
  });

  it("rejects a dependency path that cycles back to the package", async () => {
    const input = await fixture();
    await expect(
      buildOntologyPackageCandidate({
        ...input,
        dependencies: [
          {
            namespace_id: input.namespace.namespace_id,
            package_id: "00000000-0000-4000-8000-000000000498",
            package_version: 1,
            package_hash: H("9"),
            dependency_path: [input.package_id],
          },
        ],
      }),
    ).rejects.toThrow(/cycle/i);
  });

  it("rejects contradictory cardinality constraints", async () => {
    const input = await fixture();
    const constraint = input.constraints[0];
    if (constraint === undefined) throw new Error("fixture must contain a constraint");
    const rule = {
      kind: "CARDINALITY" as const,
      target_object_id: constraint.target_object_id,
      minimum: 2,
      maximum: 1,
    };
    await expect(
      buildOntologyPackageCandidate({
        ...input,
        constraints: [
          {
            ...constraint,
            constraint_kind: "CARDINALITY" as const,
            rule,
            rule_hash: await computeOntologyConstraintRuleHash(rule),
          },
        ],
      }),
    ).rejects.toThrow(/contradictory cardinality/i);
  });

  it("rejects a self-hashed validation receipt whose issues are not canonical", async () => {
    const candidate = await buildOntologyPackageCandidate(await fixture());
    const receipt = await buildOntologyPackageValidationReceipt({
      schema_version: "ontology-package-validation@1.0.0",
      receipt_id: "00000000-0000-4000-8000-000000000409",
      namespace: candidate.namespace,
      package_id: candidate.package_id,
      package_version: candidate.package_version,
      package_hash: candidate.package_hash,
      source_binding_hash: H("7"),
      compiler_digest: H("8"),
      validator_version: "ontology-package-validator@1.0.0",
      valid: false,
      issues: [
        { code: "Z_ISSUE", path: ["objects", 1], message: "z", object_id: null },
        { code: "A_ISSUE", path: ["objects", 0], message: "a", object_id: null },
      ],
      validated_at: "2026-08-17T00:00:00.000Z",
    });
    expect(receipt.issues.map((issue) => issue.code)).toEqual(["A_ISSUE", "Z_ISSUE"]);
    const { receipt_hash: _receiptHash, ...draft } = receipt;
    const issues = [...receipt.issues].reverse();
    await expect(
      verifyOntologyPackageValidationReceipt({
        ...draft,
        issues,
        receipt_hash: await sha256ContentHash({ ...draft, issues }),
      }),
    ).resolves.toBe(false);
  });
});
