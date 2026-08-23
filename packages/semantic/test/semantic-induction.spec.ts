import { describe, expect, it } from "vitest";
import {
  planSemanticImpact,
  resolveStableSemanticObjects,
  runMetricImportDryRun,
} from "../src/induction/index.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describe("semantic induction kernels", () => {
  it("derives stable IDs independently of input order and merges explicit aliases", async () => {
    const facts = [
      {
        namespace: "commerce",
        object_role: "METRIC" as const,
        name: "Gross Revenue",
        aliases: ["GMV"],
        mapping_identities: ["relation:public.orders", "column:public.orders.amount"],
        evidence_identities: ["evidence:b", "evidence:a"],
      },
      {
        namespace: "commerce",
        object_role: "METRIC" as const,
        name: "GMV",
        aliases: ["Gross Revenue"],
        mapping_identities: ["column:public.orders.amount", "relation:public.orders"],
        evidence_identities: ["evidence:a", "evidence:b"],
      },
    ];
    const forward = await resolveStableSemanticObjects(facts);
    const reverse = await resolveStableSemanticObjects([...facts].reverse());
    expect(forward).toEqual(reverse);
    expect(forward.objects).toHaveLength(1);
    expect(forward.conflicts).toEqual([]);
    const multilingual = await resolveStableSemanticObjects([
      {
        namespace: "commerce",
        object_role: "TERM",
        name: "成交商品数",
        aliases: [],
        mapping_identities: ["term:成交商品数"],
        evidence_identities: ["evidence:成交商品数"],
      },
    ]);
    expect(multilingual.objects[0]?.material.normalized_name).toBe("成交商品数");
  });

  it("surfaces cross-package conflicts instead of silently overwriting", async () => {
    const result = await resolveStableSemanticObjects([
      {
        namespace: "commerce",
        object_role: "METRIC",
        name: "GMV",
        aliases: [],
        mapping_identities: ["column:public.orders.amount"],
        evidence_identities: ["evidence:a"],
      },
      {
        namespace: "commerce",
        object_role: "METRIC",
        name: "GMV",
        aliases: [],
        mapping_identities: ["column:public.payments.amount"],
        evidence_identities: ["evidence:b"],
      },
    ]);
    expect(result.objects).toEqual([]);
    expect(result.conflicts[0]?.code).toBe("SEMANTIC_STABLE_IDENTITY_CONFLICT");

    const aliasConflict = await resolveStableSemanticObjects([
      {
        namespace: "commerce",
        object_role: "METRIC",
        name: "Gross Revenue",
        aliases: ["GMV"],
        mapping_identities: ["column:public.orders.amount"],
        evidence_identities: ["evidence:a"],
      },
      {
        namespace: "commerce",
        object_role: "METRIC",
        name: "GMV",
        aliases: ["Gross Revenue"],
        mapping_identities: ["column:public.payments.amount"],
        evidence_identities: ["evidence:b"],
      },
    ]);
    expect(aliasConflict.objects).toEqual([]);
    expect(aliasConflict.conflicts).toHaveLength(1);
  });

  it("computes only the transitive affected closure and preserves other hashes", async () => {
    const plan = await planSemanticImpact({
      scope: { app_id: id(1), tenant_id: id(2), environment: "development" },
      semantic_domain: "commerce",
      induction_id: id(3),
      objects: [
        {
          object_id: id(10),
          object_kind: "METRIC",
          previous_hash: hash("a"),
          next_hash: hash("b"),
        },
        {
          object_id: id(11),
          object_kind: "FORMULA",
          previous_hash: hash("c"),
          next_hash: hash("d"),
        },
        { object_id: id(12), object_kind: "QUERY", previous_hash: hash("e"), next_hash: hash("e") },
        { object_id: id(13), object_kind: "AGENT", previous_hash: hash("f"), next_hash: hash("f") },
        {
          object_id: id(14),
          object_kind: "RELEASE",
          previous_hash: hash("1"),
          next_hash: hash("1"),
        },
        {
          object_id: id(15),
          object_kind: "METRIC",
          previous_hash: hash("2"),
          next_hash: hash("2"),
        },
      ],
      dependencies: [
        { source_object_id: id(10), dependent_object_id: id(11) },
        { source_object_id: id(11), dependent_object_id: id(12) },
        { source_object_id: id(12), dependent_object_id: id(13) },
        { source_object_id: id(13), dependent_object_id: id(14) },
      ],
    });
    expect(plan.affected_objects.map(({ object_id }) => object_id)).toEqual([
      id(10),
      id(11),
      id(12),
      id(13),
      id(14),
    ]);
    expect(plan.unchanged_object_hashes).toEqual([{ object_id: id(15), object_hash: hash("2") }]);
  });

  it("dry-runs metric exchange before producing a candidate patch", async () => {
    const valid = await runMetricImportDryRun({
      scope: { app_id: id(1), tenant_id: id(2), environment: "development" },
      semantic_domain: "commerce",
      import_id: id(20),
      source_format: "OSI_METRIC_EXCHANGE",
      metrics: [
        { external_id: "gmv", name: "Gross Revenue", expression: "sum(order_amount)", unit: "CNY" },
      ],
      existing: [],
    });
    expect(valid.receipt.status).toBe("VALID");
    expect(valid.candidate_patch).not.toBeNull();

    const conflict = await runMetricImportDryRun({
      scope: { app_id: id(1), tenant_id: id(2), environment: "development" },
      semantic_domain: "commerce",
      import_id: id(21),
      source_format: "OSSIE_METRIC_EXCHANGE",
      metrics: [
        { external_id: "gmv", name: "Gross Revenue", expression: "drop table orders", unit: "CNY" },
      ],
      existing: [],
    });
    expect(conflict.receipt.status).toBe("INVALID");
    expect(conflict.candidate_patch).toBeNull();

    const identityConflict = await runMetricImportDryRun({
      scope: { app_id: id(1), tenant_id: id(2), environment: "development" },
      semantic_domain: "commerce",
      import_id: id(22),
      source_format: "OSI_METRIC_EXCHANGE",
      metrics: [
        { external_id: "gmv", name: "Gross Revenue", expression: "sum(amount)", unit: "CNY" },
        { external_id: "gmv", name: "Gross Margin", expression: "sum(margin)", unit: "CNY" },
      ],
      existing: [],
    });
    expect(identityConflict.receipt.status).toBe("CONFLICT");
    expect(
      identityConflict.receipt.entries.every(({ disposition }) => disposition === "CONFLICT"),
    ).toBe(true);
    expect(identityConflict.candidate_patch).toBeNull();
  });
});
