import type { SemanticContextPreviewResult, SemanticContextState } from "@data-agent/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ContextPreview,
  type SemanticContextPreviewState,
} from "@/components/semantic/studio/context-preview";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

function result(state: SemanticContextState): SemanticContextPreviewResult {
  const route = state === "REJECTED" || state === "STALE" ? "NONE" : "METRIC";
  const packageId = "8f48fd68-e0e8-855f-b344-396133208144";
  const packageHash = hash("9");
  return {
    schema_version: "semantic-context-preview-result@1.0.0",
    package: {
      schema_version: "semantic-context-package@1.0.0",
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
        schema_version: "semantic-context-route-decision@1.0.0",
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
                  match_kind: "CANONICAL",
                  matched_phrase: "Gross Revenue",
                  lexical_evidence_hash: hash("9"),
                },
              ]
            : [],
        lexical_evidence:
          state === "NEEDS_CLARIFICATION"
            ? [
                {
                  schema_version: "semantic-lexical-entry@1.0.0",
                  release_ref: {
                    resource_id: id(4),
                    resource_revision: 3,
                    resource_hash: hash("3"),
                  },
                  target_kind: "METRIC",
                  target_id: "gross_revenue",
                  term_id: null,
                  match_kind: "CANONICAL",
                  phrase: "Gross Revenue",
                  evidence_hash: hash("9"),
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
      retrieval_receipt: {
        schema_version: "semantic-retrieval-receipt@1.0.0",
        authority_snapshot_hash: hash("7"),
        release_hash: hash("3"),
        query_hash: hash("1"),
        rrf_k: 60,
        hard_filter: {
          scope_hash: hash("a"),
          publication_status: "PUBLISHED",
          authority_mode: "POSTGRES_FILTERED_SNAPSHOT",
          included_object_ids: ["gross_revenue"],
          excluded_objects: [],
        },
        route_states: {
          LEXICON: "READY",
          SPARSE: "READY",
          VECTOR: "READY",
          GRAPH: "READY",
        },
        hits: [],
        expansions: [],
        selected_object_ids: ["gross_revenue"],
        pruned_object_ids: [],
        fallback_reason_codes: [],
        receipt_hash: hash("b"),
      },
      inference_receipt: {
        schema_version: "semantic-inference-receipt@1.0.0",
        retrieval_receipt_hash: hash("b"),
        ruleset_id: "preview-ruleset-v1",
        ruleset_hash: hash("c"),
        steps: [],
        mandatory_object_ids: ["gross_revenue"],
        mandatory_relationship_ids: [],
        closure_complete: true,
        reason_codes: [],
        receipt_hash: hash("d"),
      },
      mandatory_closure: {
        object_ids: ["gross_revenue"],
        relationship_ids: [],
        closure_hash: hash("e"),
      },
      analysis_capabilities: ["TREND_CHANGE"],
      package_id: packageId,
      package_key_hash: hash("8"),
      package_hash: packageHash,
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
    { kind: "ERROR", code: "SEMANTIC_CONTEXT_RELEASE_STALE" },
  ])("renders the $kind view state", (state) => {
    const markup = renderToStaticMarkup(<ContextPreview state={state} />);
    expect(markup).toContain('aria-label="上下文预览"');
  });

  it("renders exact lexical evidence and keyboard-native clarification without a default", () => {
    const preview = result("NEEDS_CLARIFICATION");
    const markup = renderToStaticMarkup(
      <ContextPreview state={{ kind: "RESOLVED", result: preview }} />,
    );
    expect(markup).toContain("CANONICAL");
    expect(markup).toContain("Gross Revenue");
    expect(markup).toContain(preview.package.semantic_release.resource_hash);
    expect(markup).toContain('type="radio"');
    expect(markup).not.toContain('checked=""');
    expect(markup).not.toMatch(/raw_prompt|raw_sql|parameters|dsn|provider_payload/i);
  });
});
