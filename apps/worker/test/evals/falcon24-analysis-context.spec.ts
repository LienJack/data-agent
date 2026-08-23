import {
  buildSemanticContextPackage,
  buildSemanticContextReceipt,
  buildSemanticInferenceReceipt,
  buildSemanticRetrievalReceipt,
  type SemanticContextCommitResult,
} from "@data-agent/contracts/context";
import type { RunWorkLease } from "@data-agent/contracts/runs";
import { FALCON24_AGENT_ANALYSIS_CASES } from "@data-agent/evals";
import { describe, expect, it } from "vitest";
import { compileFalcon24AnalysisContext } from "../../src/evals/falcon24-analysis-context.js";

const id = (suffix: number) => `52000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const runId = id(3);

const lease = {
  scope,
  principal_id: id(4),
  outbox_id: id(5),
  run_id: runId,
  command_id: id(6),
  command_kind: "START_L2_RESEARCH",
  attempt_id: id(7),
  attempt_no: 1,
  delivery_attempt_no: 1,
  lease_duration_ms: 60_000,
  worker_id: "falcon24-worker",
  lease_token: 1,
  worker_fence: 1,
  expires_at: "2026-08-24T12:01:00.000Z",
  payload: {},
} as const satisfies RunWorkLease;

async function semanticContext(
  requiredSemanticKeys: readonly string[] = FALCON24_AGENT_ANALYSIS_CASES[0].required_semantic_keys,
): Promise<SemanticContextCommitResult> {
  const objectIds = requiredSemanticKeys.filter((key) => !key.startsWith("relationship.")).sort();
  const relationshipIds = requiredSemanticKeys
    .filter((key) => key.startsWith("relationship."))
    .sort();
  const retrievalReceipt = await buildSemanticRetrievalReceipt({
    schema_version: "semantic-retrieval-receipt@1.0.0",
    authority_snapshot_hash: hash("a"),
    release_hash: hash("b"),
    query_hash: hash("c"),
    rrf_k: 60,
    hard_filter: {
      scope_hash: hash("d"),
      publication_status: "PUBLISHED",
      authority_mode: "POSTGRES_FILTERED_SNAPSHOT",
      included_object_ids: objectIds,
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
    selected_object_ids: objectIds,
    pruned_object_ids: [],
    fallback_reason_codes: [],
  });
  const inferenceReceipt = await buildSemanticInferenceReceipt({
    schema_version: "semantic-inference-receipt@1.0.0",
    retrieval_receipt_hash: retrievalReceipt.receipt_hash,
    ruleset_id: "semantic-mandatory-closure@1",
    ruleset_hash: hash("e"),
    steps: [],
    mandatory_object_ids: objectIds,
    mandatory_relationship_ids: relationshipIds,
    closure_complete: true,
    reason_codes: [],
  });
  const packageDocument = await buildSemanticContextPackage({
    schema_version: "semantic-context-package@1.0.0",
    scope,
    semantic_domain: "falcon24",
    question_hash: hash("c"),
    defaults_ref: { defaults_id: id(8), defaults_revision: 1, defaults_hash: hash("8") },
    semantic_release: {
      resource_id: id(9),
      resource_revision: 1,
      resource_hash: hash("b"),
      datasource_id: id(10),
      semantic_generation: 1,
      publication_status: "PUBLISHED",
    },
    schema_snapshot: {
      resource_id: id(11),
      resource_revision: 1,
      resource_hash: hash("1"),
      datasource_id: id(10),
      semantic_release_id: id(9),
      semantic_generation: 1,
    },
    context_policy: {
      resource_id: id(12),
      resource_revision: 1,
      resource_hash: hash("2"),
      max_context_tokens: 32_000,
      max_resource_bindings: 64,
    },
    egress_policy: {
      resource_id: id(13),
      resource_revision: 1,
      resource_hash: hash("3"),
      allowed_providers: ["deepseek"],
      allowed_audiences: ["PRIVATE"],
      classification: "INTERNAL",
    },
    provider: "deepseek",
    authority_snapshot_hash: hash("a"),
    route_decision: {
      schema_version: "semantic-context-route-decision@1.0.0",
      state: "READY",
      route: "METRIC",
      selected_metric_id: "metric.order_revenue",
      selected_ontology_ids: [],
      clarification_candidates: [],
      lexical_evidence: [],
      capability_chain: ["METRIC", "ONTOLOGY_TEXT2SQL", "KNOWLEDGE", "GRAPH"],
      reason_codes: ["EXACT_PUBLISHED_METRIC"],
    },
    capacity: {
      schema_version: "context-capacity-plan@1.0.0",
      policy_version: "utf8-byte-upper-bound@1.0.0",
      max_context_tokens: 32_000,
      max_context_bytes: 32_000,
      mandatory_bytes: requiredSemanticKeys.length * 64,
      included_bytes: requiredSemanticKeys.length * 64,
      cropped_bytes: 0,
      items: requiredSemanticKeys.map((key) => ({
        item_kind: key.startsWith("metric.")
          ? ("METRIC" as const)
          : key.startsWith("relationship.")
            ? ("GRAPH" as const)
            : ("ONTOLOGY" as const),
        item_id: key,
        item_hash: hash("4"),
        byte_size: 64,
        priority: 10_000,
        mandatory: true,
        disposition: "MANDATORY" as const,
        reason_code: "ROUTE_SELECTED" as const,
      })),
    },
    evidence: requiredSemanticKeys.map((key) => ({
      evidence_kind: key.startsWith("metric.")
        ? ("METRIC" as const)
        : key.startsWith("relationship.")
          ? ("GRAPH" as const)
          : ("ONTOLOGY" as const),
      evidence_id: key,
      evidence_hash: hash("4"),
      summary: key,
      source_ref: null,
    })),
    knowledge_refs: [],
    retrieval_receipt: retrievalReceipt,
    inference_receipt: inferenceReceipt,
    mandatory_closure: {
      object_ids: objectIds,
      relationship_ids: relationshipIds,
      closure_hash: hash("5"),
    },
    analysis_capabilities: ["ASSOCIATION", "CHART_DATASET", "CONTRIBUTION", "TREND_CHANGE"],
  });
  const receipt = await buildSemanticContextReceipt({
    schema_version: "semantic-context-receipt@1.0.0",
    receipt_id: id(14),
    scope,
    consumer: "RUN",
    request_id: id(15),
    request_hash: hash("6"),
    run_id: runId,
    package_ref: {
      package_id: packageDocument.package_id,
      package_revision: 1,
      package_hash: packageDocument.package_hash,
    },
    state: "READY",
    route: "METRIC",
    authority_snapshot_hash: packageDocument.authority_snapshot_hash,
    resolved_at: "2026-08-24T12:00:00.000Z",
  });
  return {
    schema_version: "semantic-context-commit-result@1.0.0",
    disposition: "CREATED",
    package: packageDocument,
    receipt,
  };
}

describe("Falcon24 analysis context compiler", () => {
  it("binds the unique analysis context to retrieval and inference authority", async () => {
    const semantic_context = await semanticContext();
    const compiled = await compileFalcon24AnalysisContext({
      lease,
      semantic_context,
      test_case: FALCON24_AGENT_ANALYSIS_CASES[0],
    });

    expect(compiled.context.schema_version).toBe("analysis-context@2.0.0");
    expect(compiled.context.semantic_context_binding.package_hash).toBe(
      semantic_context.package.package_hash,
    );
    expect(compiled.context.semantic_retrieval_receipt_hash).toBe(
      semantic_context.package.retrieval_receipt.receipt_hash,
    );
    expect(compiled.context.semantic_inference_receipt_hash).toBe(
      semantic_context.package.inference_receipt.receipt_hash,
    );
    expect(compiled.metric_ids).toEqual(["metric.order_revenue"]);
    expect(
      compiled.context.metrics[0]?.allowed_dimensions.map(({ dimension_id }) => dimension_id),
    ).toEqual(["customer_segment", "order_month", "payment_method"]);
    expect(compiled.context.relationships.map(({ relationship_id }) => relationship_id)).toEqual([
      "order_customer",
      "order_item_product",
    ]);
    expect(compiled.context).not.toHaveProperty("semantic_source_bundle_ref");
    expect(compiled.context).not.toHaveProperty("ontology_analysis_binding_hash");
  });

  it("rejects a package that lacks any required semantic closure", async () => {
    const requiredKeys = FALCON24_AGENT_ANALYSIS_CASES[0].required_semantic_keys.filter(
      (key) => key !== "relationship.order_customer",
    );
    await expect(
      compileFalcon24AnalysisContext({
        lease,
        semantic_context: await semanticContext(requiredKeys),
        test_case: FALCON24_AGENT_ANALYSIS_CASES[0],
      }),
    ).rejects.toThrow("FALCON24_ANALYSIS_CONTEXT_CLOSURE_MISSING:relationship.order_customer");
  });
});
