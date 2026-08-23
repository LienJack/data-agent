import { describe, expect, it } from "vitest";
import {
  buildFalconSemanticAccuracySummary,
  verifyFalconSemanticAccuracySummary,
} from "../src/index.js";

const id = (suffix: number) => `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

function input() {
  return {
    schema_version: "falcon-semantic-accuracy-summary@1.0.0" as const,
    artifact_id: id(1),
    scope: { app_id: id(2), tenant_id: id(3), environment: "test" },
    workspace_id: id(3),
    semantic_domain: "falcon",
    source_commit: "c7d71f28321c43b0e1fa946d8c4d6f4dd42f7b3c",
    corpus_ref: { resource_id: id(4), resource_revision: 1, resource_hash: hash("1") },
    release_ref: { resource_id: id(5), resource_revision: 3, resource_hash: hash("2") },
    route_contract_version: "resolved-context-route-decision@2.0.0" as const,
    b0_exact: {
      lane: "B0_EXACT" as const,
      case_count: 5,
      outcomes: { ready: 3, needs_clarification: 1, partial: 0, rejected: 1 },
      exact_case_count: 3,
      exact_ready_count: 3,
      ambiguity_case_count: 1,
      ambiguity_misselection_count: 0,
      cross_release_hit_count: 0,
      unauthorized_hit_count: 0,
      result_set_hash: hash("3"),
    },
    b1_lexical: {
      lane: "B1_LEXICAL" as const,
      case_count: 5,
      outcomes: { ready: 4, needs_clarification: 1, partial: 0, rejected: 0 },
      exact_case_count: 3,
      exact_ready_count: 3,
      ambiguity_case_count: 1,
      ambiguity_misselection_count: 0,
      cross_release_hit_count: 0,
      unauthorized_hit_count: 0,
      result_set_hash: hash("4"),
    },
    b2_governed_retrieval: {
      lane: "B2_GOVERNED_RETRIEVAL" as const,
      state: "DEFERRED" as const,
      reason_code: "M2_GATE_NO_GO" as const,
    },
    completed_at: "2026-08-23T08:00:00.000Z",
  };
}

describe("Falcon semantic accuracy summary", () => {
  it("seals same-corpus B0/B1 non-regression while keeping B2 deferred", async () => {
    const summary = await buildFalconSemanticAccuracySummary(input());
    expect(summary.comparison).toEqual({ exact_regression_count: 0, lexical_ready_gain: 1 });
    expect(summary.b2_governed_retrieval).toEqual({
      lane: "B2_GOVERNED_RETRIEVAL",
      state: "DEFERRED",
      reason_code: "M2_GATE_NO_GO",
    });
    await expect(verifyFalconSemanticAccuracySummary(summary)).resolves.toEqual(summary);
  });

  it("rejects exact regression, silent ambiguity, unsafe hits and hash tampering", async () => {
    await expect(
      buildFalconSemanticAccuracySummary({
        ...input(),
        b1_lexical: { ...input().b1_lexical, exact_ready_count: 2 },
      }),
    ).rejects.toThrow("FALCON_SEMANTIC_ACCURACY_HOLD");
    await expect(
      buildFalconSemanticAccuracySummary({
        ...input(),
        b1_lexical: { ...input().b1_lexical, ambiguity_misselection_count: 1 },
      }),
    ).rejects.toThrow("FALCON_SEMANTIC_ACCURACY_HOLD");
    await expect(
      buildFalconSemanticAccuracySummary({
        ...input(),
        b1_lexical: { ...input().b1_lexical, cross_release_hit_count: 1 },
      }),
    ).rejects.toThrow("FALCON_SEMANTIC_ACCURACY_HOLD");
    await expect(
      buildFalconSemanticAccuracySummary({
        ...input(),
        b1_lexical: { ...input().b1_lexical, unauthorized_hit_count: 1 },
      }),
    ).rejects.toThrow("FALCON_SEMANTIC_ACCURACY_HOLD");

    const summary = await buildFalconSemanticAccuracySummary(input());
    await expect(
      verifyFalconSemanticAccuracySummary({ ...summary, summary_hash: hash("f") }),
    ).rejects.toThrow("FALCON_SEMANTIC_ACCURACY_HASH_MISMATCH");
    await expect(
      verifyFalconSemanticAccuracySummary({
        ...summary,
        corpus_ref: { ...summary.corpus_ref, resource_hash: hash("e") },
      }),
    ).rejects.toThrow("FALCON_SEMANTIC_ACCURACY_HASH_MISMATCH");
    await expect(
      verifyFalconSemanticAccuracySummary({
        ...summary,
        release_ref: { ...summary.release_ref, resource_revision: 4 },
      }),
    ).rejects.toThrow("FALCON_SEMANTIC_ACCURACY_HASH_MISMATCH");
  });

  it("rejects inconsistent outcome totals and workspace scope", async () => {
    await expect(
      buildFalconSemanticAccuracySummary({
        ...input(),
        b1_lexical: {
          ...input().b1_lexical,
          outcomes: { ...input().b1_lexical.outcomes, ready: 5 },
        },
      }),
    ).rejects.toThrow("FALCON_SEMANTIC_ACCURACY_OUTCOME_MISMATCH");
    await expect(
      buildFalconSemanticAccuracySummary({ ...input(), workspace_id: id(99) }),
    ).rejects.toThrow("FALCON_SEMANTIC_ACCURACY_SCOPE_MISMATCH");
  });
});
