import {
  buildSemanticBindingImpactAuthorityBundle,
  computeSemanticBindingImpactReceiptHash,
  type SemanticApplicationAuthority,
  type SemanticBindingImpactPort,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { createSemanticBindingImpactService } from "../src/application/binding-impact.js";

const APP_ID = "00000000-0000-4000-8000-00000000da01";
const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const DATASOURCE_ID = "10000000-0000-4000-8000-000000000002";
const DRIFT_ID = "10000000-0000-4000-8000-000000000003";
const RELEASE_ID = "10000000-0000-4000-8000-000000000004";
const H1 = `sha256:${"1".repeat(64)}` as const;
const H2 = `sha256:${"2".repeat(64)}` as const;
const H3 = `sha256:${"3".repeat(64)}` as const;
const H4 = `sha256:${"4".repeat(64)}` as const;
const H5 = `sha256:${"5".repeat(64)}` as const;

const applicationAuthority: SemanticApplicationAuthority = {
  authority: "POSTGRESQL",
  capabilityInput: { token: "opaque" },
  scope: {
    appId: APP_ID,
    tenantId: TENANT_ID,
    environment: "dev",
    semanticDomain: "sales",
  },
  deploymentId: "deployment",
  principal: "10000000-0000-4000-8000-000000000099",
  semanticRole: "human-reviewer",
  allowedDomains: ["sales"],
};

async function noOpAuthority() {
  return buildSemanticBindingImpactAuthorityBundle({
    schema_version: "semantic-binding-impact-authority@1.0.0",
    scope: {
      app_id: APP_ID,
      tenant_id: TENANT_ID,
      environment: "dev",
      semantic_domain: "sales",
    },
    datasource_id: DATASOURCE_ID,
    drift: {
      event: {
        schema_version: "schema-drift-event@1.0.0",
        drift_event_id: DRIFT_ID,
        datasource_id: DATASOURCE_ID,
        datasource_fingerprint: H1,
        base_snapshot_content_hash: H2,
        current_snapshot_content_hash: H3,
        observed_at: "2026-08-23T00:00:00.000Z",
        severity: "INFO",
        binding_impact: "UNKNOWN",
        operations: [
          {
            operation_kind: "RELATION_COMMENT_CHANGED",
            severity: "INFO",
            identity: { schema_name: "public", relation_name: "orders" },
            before: null,
            after: "Orders",
          },
        ],
      },
      event_storage_digest: H4,
    },
    release: { release_id: RELEASE_ID, generation: 1, release_digest: H5 },
    packages: [
      {
        namespace_id: "10000000-0000-4000-8000-000000000005",
        package_id: "10000000-0000-4000-8000-000000000006",
        package_version: 1,
        package_hash: H1,
        objects: [],
        physical_mappings: [],
        metric_bindings: [],
        constraints: [],
        graph_edges: [],
      },
    ],
  });
}

describe("semantic binding impact application", () => {
  it("commits a deterministic no-op receipt without creating a Candidate", async () => {
    const bundle = await noOpAuthority();
    let committedCandidate: unknown;
    const store: SemanticBindingImpactPort = {
      async loadAuthority() {
        return { ok: true, value: bundle };
      },
      async commit(_capability, input) {
        committedCandidate = input.candidate_draft;
        const material = {
          schema_version: "semantic-binding-impact-receipt@1.0.0" as const,
          authority: "POSTGRESQL" as const,
          impact_id: input.plan.impact_id,
          scope: input.plan.scope,
          datasource_id: input.plan.datasource_id,
          authority_input_hash: input.plan.authority_input_hash,
          plan_hash: input.plan.plan_hash,
          drift_event_id: input.plan.drift_ref.drift_event_id,
          release: input.plan.release_ref,
          status: input.plan.status,
          risk_level: input.plan.risk_level,
          direct_impact_count: input.plan.direct_impacts.length,
          transitive_impact_count: input.plan.transitive_impacts.length,
          suggested_actions: input.plan.suggested_actions,
          manual_reason_codes: input.plan.manual_reason_codes,
          candidate_ref: null,
          committed_at: "2026-08-23T00:00:00.000Z",
        };
        return {
          ok: true,
          value: {
            ...material,
            receipt_hash: await computeSemanticBindingImpactReceiptHash(material),
            created: true,
          },
        };
      },
      async getSafeProjection() {
        return {
          ok: false,
          error: { code: "NOT_USED", message: "not used", retryable: false },
        };
      },
    };
    const result = await createSemanticBindingImpactService({ store }).analyze(
      applicationAuthority,
      {
        schema_version: "semantic-binding-impact-analyze@1.0.0",
        semantic_domain: "sales",
        datasource_id: DATASOURCE_ID,
        drift_event_id: DRIFT_ID,
      },
    );
    expect(result.ok).toBe(true);
    expect(committedCandidate).toBeNull();
    if (result.ok) expect(result.value.status).toBe("NO_SEMANTIC_ACTION");
  });

  it("rejects a cross-domain request before loading authority", async () => {
    let loaded = false;
    const store = {
      async loadAuthority() {
        loaded = true;
        return { ok: true, value: await noOpAuthority() };
      },
    } as unknown as SemanticBindingImpactPort;
    const result = await createSemanticBindingImpactService({ store }).analyze(
      applicationAuthority,
      {
        schema_version: "semantic-binding-impact-analyze@1.0.0",
        semantic_domain: "finance",
        datasource_id: DATASOURCE_ID,
        drift_event_id: DRIFT_ID,
      },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "SEMANTIC_BINDING_IMPACT_SCOPE_FORBIDDEN" },
    });
    expect(loaded).toBe(false);
  });
});
