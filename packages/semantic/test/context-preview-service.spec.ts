import {
  buildResolvedContextAuthoritySnapshot,
  buildResolvedContextRequest,
  verifyResolvedContextPreviewResult,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { createResolvedContextService } from "../src/context/service.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;

async function authoritySnapshot() {
  return buildResolvedContextAuthoritySnapshot({
    schema_version: "resolved-context-authority-snapshot@2.0.0",
    scope,
    semantic_domain: "commerce",
    question: "Gross Revenue by channel",
    defaults_ref: { defaults_id: id(3), defaults_revision: 1, defaults_hash: hash("1") },
    semantic_release: {
      resource_id: id(4),
      resource_revision: 3,
      resource_hash: hash("2"),
      datasource_id: id(5),
      semantic_generation: 3,
      publication_status: "PUBLISHED",
    },
    schema_snapshot: {
      resource_id: id(6),
      resource_revision: 1,
      resource_hash: hash("3"),
      datasource_id: id(5),
      semantic_release_id: id(4),
      semantic_generation: 3,
    },
    context_policy: {
      resource_id: id(7),
      resource_revision: 1,
      resource_hash: hash("4"),
      max_context_tokens: 4_096,
      max_resource_bindings: 64,
    },
    egress_policy: {
      resource_id: id(8),
      resource_revision: 1,
      resource_hash: hash("5"),
      allowed_providers: ["deepseek"],
      allowed_audiences: ["PRIVATE"],
      classification: "INTERNAL",
    },
    provider: "deepseek",
    published_metrics: [
      {
        metric_id: "gross_revenue",
        name: "Gross Revenue",
        aliases: ["GMV"],
        mapping_refs: ["orders.amount"],
        mapping_hash: hash("6"),
        formula_hash: hash("7"),
      },
    ],
    published_ontology: [],
    published_relationships: [],
    knowledge_refs: [],
    projection_hashes: [hash("6")],
  });
}

describe("resolved context read-only preview", () => {
  it("shares the current resolver but never commits a receipt", async () => {
    const snapshot = await authoritySnapshot();
    let loadCount = 0;
    let commitCount = 0;
    const service = createResolvedContextService({
      authority: {
        loadAuthoritySnapshot: async () => {
          loadCount += 1;
          return { ok: true as const, value: snapshot };
        },
        commit: async () => {
          commitCount += 1;
          return {
            ok: false as const,
            error: {
              code: "UNEXPECTED_COMMIT",
              message: "preview must not commit",
              retryable: false,
            },
          };
        },
      },
    });
    const request = await buildResolvedContextRequest({
      schema_version: "resolved-context-request@1.0.0",
      request_id: id(9),
      scope,
      question: "Gross Revenue by channel",
      basis: {
        consumer: "PREVIEW",
        defaults_ref: { defaults_id: id(3), defaults_revision: 1, defaults_hash: hash("1") },
      },
    });

    const preview = await service.preview({ access: "READ" }, request);

    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error(preview.error.code);
    expect(preview.value.package.route_decision).toMatchObject({
      state: "READY",
      route: "METRIC",
      selected_metric_id: "gross_revenue",
    });
    expect(loadCount).toBe(1);
    expect(commitCount).toBe(0);
    await expect(verifyResolvedContextPreviewResult(preview.value)).resolves.toEqual(preview.value);
    await expect(
      verifyResolvedContextPreviewResult({ ...preview.value, receipt: { secret: true } }),
    ).rejects.toThrow();

    const committed = await service.resolve({ access: "WRITE" }, request);
    expect(committed).toMatchObject({
      ok: false,
      error: { code: "RESOLVED_CONTEXT_COMMIT_CONSUMER_INVALID" },
    });
    expect(loadCount).toBe(1);
    expect(commitCount).toBe(0);

    const runRequest = await buildResolvedContextRequest({
      schema_version: "resolved-context-request@1.0.0",
      request_id: id(10),
      scope,
      basis: {
        consumer: "RUN",
        run_id: id(11),
        config_ref: { config_id: id(12), config_revision: 1, config_hash: hash("9") },
        context_receipt_ref: { receipt_id: id(13), receipt_hash: hash("a") },
      },
    });
    const invalidPreview = await service.preview({ access: "READ" }, runRequest);
    expect(invalidPreview).toMatchObject({
      ok: false,
      error: { code: "RESOLVED_CONTEXT_PREVIEW_CONSUMER_INVALID" },
    });
    expect(loadCount).toBe(1);
    expect(commitCount).toBe(0);
  });
});
