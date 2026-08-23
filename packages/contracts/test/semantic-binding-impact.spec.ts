import { describe, expect, it } from "vitest";
import {
  buildSemanticBindingImpactAuthorityBundle,
  buildSemanticBindingImpactPlan,
  computeSemanticBindingImpactReceiptHash,
  semanticBindingImpactAuthorityBundleSchema,
  semanticBindingImpactSafeProjectionSchema,
  uuidV8FromContentHash,
  verifySemanticBindingImpactAuthorityBundle,
  verifySemanticBindingImpactCommitReceipt,
  verifySemanticBindingImpactPlan,
} from "../src/index.js";

const APP_ID = "00000000-0000-4000-8000-00000000da01";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const DATASOURCE_ID = "22222222-2222-4222-8222-222222222222";
const DRIFT_ID = "33333333-3333-4333-8333-333333333333";
const PACKAGE_ID = "44444444-4444-4444-8444-444444444444";
const NAMESPACE_ID = "55555555-5555-4555-8555-555555555555";
const OBJECT_ID = "66666666-6666-4666-8666-666666666666";
const RELEASE_ID = "77777777-7777-4777-8777-777777777777";
const CANDIDATE_ID = "88888888-8888-4888-8888-888888888888";
const REVISION_ID = "99999999-9999-4999-8999-999999999999";
const SOURCE_REVISION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const H1 = `sha256:${"1".repeat(64)}` as const;
const H2 = `sha256:${"2".repeat(64)}` as const;
const H3 = `sha256:${"3".repeat(64)}` as const;
const H4 = `sha256:${"4".repeat(64)}` as const;
const H5 = `sha256:${"5".repeat(64)}` as const;
const H6 = `sha256:${"6".repeat(64)}` as const;

function authorityMaterial() {
  return {
    schema_version: "semantic-binding-impact-authority@1.0.0" as const,
    scope: {
      app_id: APP_ID,
      tenant_id: TENANT_ID,
      environment: "dev",
      semantic_domain: "sales",
    },
    datasource_id: DATASOURCE_ID,
    drift: {
      event: {
        schema_version: "schema-drift-event@1.0.0" as const,
        drift_event_id: DRIFT_ID,
        datasource_id: DATASOURCE_ID,
        datasource_fingerprint: H1,
        base_snapshot_content_hash: H2,
        current_snapshot_content_hash: H3,
        observed_at: "2026-08-23T00:00:00.000Z",
        severity: "INFO" as const,
        binding_impact: "UNKNOWN" as const,
        operations: [
          {
            operation_kind: "RELATION_COMMENT_CHANGED" as const,
            severity: "INFO" as const,
            identity: { schema_name: "public", relation_name: "orders" },
            before: null,
            after: "Order facts",
          },
        ],
      },
      event_storage_digest: H4,
    },
    release: { release_id: RELEASE_ID, generation: 3, release_digest: H5 },
    packages: [
      {
        namespace_id: NAMESPACE_ID,
        package_id: PACKAGE_ID,
        package_version: 1,
        package_hash: H6,
        objects: [
          {
            object_id: OBJECT_ID,
            graph_entry_kind: "NODE" as const,
            graph_entry_id: "orders",
            semantic_role: "ENTITY" as const,
            resolution: "RESOLVED" as const,
            object_hash: H1,
          },
        ],
        physical_mappings: [],
        metric_bindings: [],
        constraints: [],
        graph_edges: [],
      },
    ],
  };
}

describe("semantic binding impact contracts", () => {
  it("builds and verifies an exact authority bundle", async () => {
    const bundle = await buildSemanticBindingImpactAuthorityBundle(authorityMaterial());
    expect(bundle.authority_input_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    await expect(verifySemanticBindingImpactAuthorityBundle(bundle)).resolves.toEqual(bundle);
    await expect(
      verifySemanticBindingImpactAuthorityBundle({ ...bundle, authority_input_hash: H1 }),
    ).rejects.toThrow("SEMANTIC_BINDING_IMPACT_AUTHORITY_HASH_MISMATCH");
  });

  it("rejects a published mapping outside the drift base snapshot", () => {
    const material = authorityMaterial();
    expect(() =>
      semanticBindingImpactAuthorityBundleSchema.parse({
        ...material,
        packages: [
          {
            ...material.packages[0],
            physical_mappings: [
              {
                mapping_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                logical_object_id: OBJECT_ID,
                mode: "QUERYABLE",
                datasource_id: DATASOURCE_ID,
                schema_snapshot_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                snapshot_content_hash: H3,
                physical_locator: {
                  kind: "TABLE",
                  schema_name: "public",
                  table_name: "orders",
                },
                evidence_sources: [],
                resolution: "RESOLVED",
              },
            ],
          },
        ],
        authority_input_hash: H1,
      }),
    ).toThrow("Published mapping 必须绑定 drift 的 datasource 与 base snapshot");
  });

  it("rejects duplicate semantic object identities across published packages", () => {
    const material = authorityMaterial();
    expect(() =>
      semanticBindingImpactAuthorityBundleSchema.parse({
        ...material,
        packages: [
          ...material.packages,
          {
            ...material.packages[0],
            package_id: "44444444-4444-4444-8444-444444444445",
            package_hash: H5,
          },
        ],
        authority_input_hash: H1,
      }),
    ).toThrow("Published release 中的 object_id 必须全局唯一");
  });

  it("builds a stable no-op plan and closes it over authority", async () => {
    const authority = await buildSemanticBindingImpactAuthorityBundle(authorityMaterial());
    const material = {
      schema_version: "semantic-binding-impact-plan@1.0.0" as const,
      impact_id: uuidV8FromContentHash(authority.authority_input_hash),
      scope: authority.scope,
      datasource_id: authority.datasource_id,
      authority_input_hash: authority.authority_input_hash,
      drift_ref: {
        drift_event_id: authority.drift.event.drift_event_id,
        event_storage_digest: authority.drift.event_storage_digest,
        base_snapshot_content_hash: authority.drift.event.base_snapshot_content_hash,
        current_snapshot_content_hash: authority.drift.event.current_snapshot_content_hash,
      },
      release_ref: authority.release,
      status: "NO_SEMANTIC_ACTION" as const,
      risk_level: "LOW" as const,
      direct_impacts: [],
      transitive_impacts: [],
      unchanged_object_hashes: [{ object_id: OBJECT_ID, object_hash: H1 }],
      suggested_actions: ["NO_SEMANTIC_ACTION" as const],
      manual_reason_codes: [],
      candidate_operations: [],
    };
    const first = await buildSemanticBindingImpactPlan(material);
    const second = await buildSemanticBindingImpactPlan(material);
    expect(second.plan_hash).toBe(first.plan_hash);
    await expect(verifySemanticBindingImpactPlan(first, authority)).resolves.toEqual(first);
    await expect(
      verifySemanticBindingImpactPlan({ ...first, datasource_id: TENANT_ID }, authority),
    ).rejects.toThrow();
  });

  it("verifies receipt hashes independently from replay metadata", async () => {
    const material = {
      schema_version: "semantic-binding-impact-receipt@1.0.0" as const,
      authority: "POSTGRESQL" as const,
      impact_id: DRIFT_ID,
      scope: {
        app_id: APP_ID,
        tenant_id: TENANT_ID,
        environment: "dev",
        semantic_domain: "sales",
      },
      datasource_id: DATASOURCE_ID,
      authority_input_hash: H1,
      plan_hash: H2,
      drift_event_id: DRIFT_ID,
      release: { release_id: RELEASE_ID, generation: 3, release_digest: H3 },
      status: "REVIEW_REQUIRED" as const,
      risk_level: "HIGH" as const,
      direct_impact_count: 1,
      transitive_impact_count: 2,
      suggested_actions: ["REMAP_COLUMN" as const],
      manual_reason_codes: [],
      candidate_ref: {
        candidate_id: CANDIDATE_ID,
        revision_id: REVISION_ID,
        source_revision_id: SOURCE_REVISION_ID,
        source_digest: H4,
        revision_digest: H5,
      },
      committed_at: "2026-08-23T00:00:00.000Z",
    };
    const receiptHash = await computeSemanticBindingImpactReceiptHash(material);
    const created = { ...material, receipt_hash: receiptHash, created: true };
    const replayed = { ...created, created: false };
    await expect(verifySemanticBindingImpactCommitReceipt(created)).resolves.toEqual(created);
    await expect(verifySemanticBindingImpactCommitReceipt(replayed)).resolves.toEqual(replayed);
  });

  it("keeps the public projection free of internal authority payloads", () => {
    const safe = {
      schema_version: "semantic-binding-impact-safe-projection@1.0.0" as const,
      impact_id: DRIFT_ID,
      receipt_hash: H1,
      plan_hash: H2,
      drift_event_id: DRIFT_ID,
      release: { release_id: RELEASE_ID, generation: 3, release_digest: H3 },
      status: "NO_SEMANTIC_ACTION" as const,
      risk_level: "LOW" as const,
      direct_impact_count: 0,
      transitive_impact_count: 0,
      suggested_actions: ["NO_SEMANTIC_ACTION" as const],
      manual_reason_codes: [],
      candidate_ref: null,
      committed_at: "2026-08-23T00:00:00.000Z",
    };
    expect(semanticBindingImpactSafeProjectionSchema.parse(safe)).toEqual(safe);
    expect(() =>
      semanticBindingImpactSafeProjectionSchema.parse({
        ...safe,
        packages: authorityMaterial().packages,
      }),
    ).toThrow();
  });
});
