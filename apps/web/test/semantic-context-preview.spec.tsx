import type { ResolvedContextCommitResult, ResolvedContextState } from "@data-agent/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ContextPreview,
  type SemanticContextPreviewState,
} from "@/components/semantic/studio/context-preview";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

function result(state: ResolvedContextState): ResolvedContextCommitResult {
  const route = state === "REJECTED" || state === "STALE" ? "NONE" : "METRIC";
  const packageId = "8f48fd68-e0e8-855f-b344-396133208144";
  const packageHash = hash("9");
  return {
    schema_version: "resolved-context-commit-result@1.0.0",
    disposition: "CREATED",
    package: {
      schema_version: "resolved-context-package@1.0.0",
      scope: { app_id: id(1), tenant_id: id(2), environment: "test" },
      semantic_domain: "commerce",
      question_hash: hash("1"),
      defaults_ref: { defaults_id: id(3), defaults_revision: 2, defaults_hash: hash("2") },
      semantic_release: {
        resource_id: id(4),
        resource_revision: 3,
        resource_hash: hash("3"),
        datasource_id: id(5),
        semantic_generation: 3,
        publication_status: "PUBLISHED",
      },
      schema_snapshot: {
        resource_id: id(6),
        resource_revision: 1,
        resource_hash: hash("4"),
        datasource_id: id(5),
        semantic_release_id: id(4),
        semantic_generation: 3,
      },
      context_policy: {
        resource_id: id(7),
        resource_revision: 1,
        resource_hash: hash("5"),
        max_context_tokens: 4096,
        max_resource_bindings: 64,
      },
      egress_policy: {
        resource_id: id(8),
        resource_revision: 1,
        resource_hash: hash("6"),
        allowed_providers: ["deepseek"],
        allowed_audiences: ["PRIVATE"],
        classification: "INTERNAL",
      },
      provider: "deepseek",
      authority_snapshot_hash: hash("7"),
      route_decision: {
        schema_version: "resolved-context-route-decision@1.0.0",
        state,
        route,
        selected_metric_id: route === "METRIC" ? "gross_revenue" : null,
        selected_ontology_ids: [],
        clarification_candidates:
          state === "NEEDS_CLARIFICATION"
            ? [
                {
                  candidate_id: "gross_revenue",
                  candidate_kind: "METRIC",
                  label: "Gross Revenue",
                  candidate_hash: hash("8"),
                },
              ]
            : [],
        capability_chain: ["METRIC", "ONTOLOGY_TEXT2SQL", "KNOWLEDGE", "GRAPH"],
        reason_codes: [state],
      },
      capacity: {
        schema_version: "context-capacity-plan@1.0.0",
        policy_version: "utf8-byte-upper-bound@1.0.0",
        max_context_tokens: 4096,
        max_context_bytes: 4096,
        mandatory_bytes: 64,
        included_bytes: 64,
        cropped_bytes: state === "PARTIAL" ? 32 : 0,
        items: [
          {
            item_kind: "METRIC",
            item_id: "gross_revenue",
            item_hash: hash("8"),
            byte_size: 64,
            priority: 100,
            mandatory: true,
            disposition: "MANDATORY",
            reason_code: "ROUTE_SELECTED",
          },
        ],
      },
      evidence: [
        {
          evidence_kind: "METRIC",
          evidence_id: "gross_revenue",
          evidence_hash: hash("8"),
          summary: "Gross Revenue = sum(order_amount)",
          source_ref: null,
        },
      ],
      knowledge_refs: [],
      package_id: packageId,
      package_key_hash: hash("8"),
      package_hash: packageHash,
    },
    receipt: {
      schema_version: "resolved-context-receipt@1.0.0",
      receipt_id: id(10),
      scope: { app_id: id(1), tenant_id: id(2), environment: "test" },
      consumer: "PREVIEW",
      request_id: id(10),
      request_hash: hash("a"),
      run_id: null,
      package_ref: { package_id: packageId, package_revision: 1, package_hash: packageHash },
      state,
      route,
      authority_snapshot_hash: hash("7"),
      resolved_at: "2026-08-17T00:00:00.000Z",
      receipt_hash: hash("b"),
    },
  };
}

describe("Semantic Context Preview", () => {
  it.each([
    ["READY", "可用"],
    ["PARTIAL", "部分可用"],
    ["NEEDS_CLARIFICATION", "需要澄清"],
    ["REJECTED", "已拒绝"],
    ["STALE", "已过期"],
  ] as const)("renders %s without exposing raw context", (contextState, label) => {
    const preview = result(contextState);
    const markup = renderToStaticMarkup(
      <ContextPreview state={{ kind: "RESOLVED", result: preview }} />,
    );
    expect(markup).toContain(label);
    expect(markup).toContain(preview.package.semantic_release.resource_id);
    expect(markup).toContain(preview.package.schema_snapshot.resource_id);
    expect(markup).toContain("上下文容量");
    expect(markup).not.toContain("raw_prompt");
    expect(markup).not.toContain("private_reasoning");
  });

  it.each<SemanticContextPreviewState>([
    { kind: "IDLE" },
    { kind: "RESOLVING" },
    { kind: "ERROR", code: "RESOLVED_CONTEXT_RELEASE_STALE" },
  ])("renders the $kind view state", (state) => {
    const markup = renderToStaticMarkup(<ContextPreview state={state} />);
    expect(markup).toContain('aria-label="上下文预览"');
  });
});
