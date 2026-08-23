import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractSemanticRuntimeContent,
  SEMANTIC_SOURCE_BUNDLE_VERSION,
  semanticSourceBundleSchema,
} from "../src/index.js";

const root = resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

describe("Semantic V2-only architecture", () => {
  it("has one current bundle identity and no V2-to-V1 bridge", () => {
    const sources = [
      "packages/contracts/src/artifacts/semantic-governance.ts",
      "packages/semantic/src/analysis/context-compiler.ts",
      "packages/semantic/src/compiler/u5-compiler.ts",
      "packages/semantic/src/graph-v2/compiler.ts",
    ].map(read);
    expect(SEMANTIC_SOURCE_BUNDLE_VERSION).toBe("semantic-source-bundle@2");
    for (const source of sources) {
      expect(source).not.toMatch(/semantic-source-bundle@1|V2ToV1|BundleV2|projectSemanticSource/);
    }
  });

  it("exposes semantic capabilities only through controlled subpaths", () => {
    const rootEntry = read("packages/semantic/src/index.ts");
    expect(rootEntry).toContain("export {};");
    expect(rootEntry).not.toContain(" from ");
  });

  it("keeps Preview and Published authority outside identical runtime content", () => {
    const content = {
      formulas: [],
      metrics: [
        {
          metric_id: "metric-orders",
          name: "Orders",
          aliases: ["orders"],
          table_id: "orders",
          column_id: "orders.id",
          aggregation: "count" as const,
          formula: null,
          grain: { grain_id: "order", granularity: "atomic" as const },
          unit: null,
          time_domain: null,
          time_column_id: null,
          additivity: "non-additive" as const,
          null_policy: "exclude" as const,
          fanout_policy: "reject" as const,
          dependency_column_ids: ["orders.id"],
          tags: [],
          analysis: {
            primary: true,
            priority: 0,
            missing_period_policy: "NULL" as const,
            seasonality: null,
            allowed_dimension_ids: [],
            capabilities: ["DATA_PROFILE" as const],
            causal_role: null,
          },
        },
      ],
      dimensions: [],
      relationships: [],
      domain_causal_policy: null,
    };
    const common = {
      bundle_version: SEMANTIC_SOURCE_BUNDLE_VERSION,
      capability_profile: "U5_EXECUTABLE_SUBSET" as const,
      bundle_id: "00000000-0000-4000-8000-000000000001",
      scope: {
        app_id: "00000000-0000-4000-8000-000000000002",
        tenant_id: "00000000-0000-4000-8000-000000000003",
        environment: "test",
      },
      producer: { kind: "deterministic" as const, id: "test" },
      authority: { kind: "deterministic" as const, id: "test", policy_version: "authority@2" },
      created_at: "2026-08-23T00:00:00Z",
    };
    const preview = semanticSourceBundleSchema.parse({
      ...content,
      metadata: {
        ...common,
        authority_envelope: {
          kind: "PREVIEW",
          candidate_id: "00000000-0000-4000-8000-000000000004",
          working_revision: 1,
        },
      },
    });
    const published = semanticSourceBundleSchema.parse({
      ...content,
      metadata: {
        ...common,
        authority_envelope: {
          kind: "PUBLISHED",
          release_id: "00000000-0000-4000-8000-000000000005",
          release_revision: 1,
          released_at: "2026-08-23T00:01:00Z",
        },
      },
    });
    expect(extractSemanticRuntimeContent(preview)).toEqual(
      extractSemanticRuntimeContent(published),
    );
    expect(preview.metadata.authority_envelope.kind).toBe("PREVIEW");
    expect(published.metadata.authority_envelope.kind).toBe("PUBLISHED");
  });

  it("keeps publish outside the candidate port", () => {
    const portSource = read("packages/contracts/src/ports/semantic/index.ts");
    const candidateSurface = portSource.match(
      /export interface SemanticCandidatePort \{([\s\S]*?)\n\}/,
    )?.[1];
    expect(candidateSurface).toBeDefined();
    expect(candidateSurface).not.toContain("publish");
    expect(portSource).toContain("SemanticGovernancePublishPort");
  });
});
