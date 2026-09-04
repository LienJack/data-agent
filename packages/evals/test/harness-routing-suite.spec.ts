import type { RootAgentDecisionCandidate } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  evaluateHarnessRouting,
  type HarnessRoutingObservation,
  harnessRoutingCase,
  harnessRoutingSuite,
} from "../src/index.js";

const scope = {
  app_id: "10000000-0000-4000-8000-000000000001",
  tenant_id: "10000000-0000-4000-8000-000000000002",
  environment: "test" as const,
};
const runId = "10000000-0000-4000-8000-000000000003";
const catalogHash = `sha256:${"a".repeat(64)}` as const;

function delegation(profileId: string): RootAgentDecisionCandidate {
  return {
    schema_version: "root-agent-turn-candidate@1.0.0",
    kind: "TOOL_CALLS",
    scope,
    run_id: runId,
    catalog_snapshot_hash: catalogHash,
    tool_calls: [
      {
        tool_name: "delegate_to_subagent@2",
        tool_call_id: `call-${profileId}`,
        profile_id: profileId,
        objective: "Use governed evidence to answer the visible user request.",
        output_usage: "FINAL_ANSWER_EVIDENCE",
        requested_artifact_types: ["AnalysisReport"],
        input_artifact_refs: [],
        requested_budget: {
          timeout_ms: 30_000,
          max_steps: 8,
          max_input_tokens: 8_000,
          max_output_tokens: 2_000,
          max_tool_calls: 4,
          max_context_bytes: 16_384,
        },
      },
    ],
    public_summary: "主 Agent 选择一个受治理的专职 Agent。",
  };
}

function directAnswer(): RootAgentDecisionCandidate {
  return {
    schema_version: "root-agent-turn-candidate@1.0.0",
    kind: "FINAL_ANSWER",
    scope,
    run_id: runId,
    catalog_snapshot_hash: catalogHash,
    sections: [
      {
        kind: "GENERAL_TEXT",
        text: "同比是与上一年同一时期进行比较。",
        basis: "GENERAL_KNOWLEDGE",
        source_message_refs: [],
      },
    ],
    public_summary: "主 Agent 直接回答通用概念。",
  };
}

function semanticObservation(): HarnessRoutingObservation {
  return {
    decision: delegation("semantic-management-agent"),
    admitted_profile_ids: ["semantic-management-agent"],
    tool_calls: [{ profile_id: "semantic-management-agent", tool_name: "semantic.catalog.read" }],
    accepted_evidence: ["FROZEN_SEMANTIC_RELEASE", "RELATIONSHIP_GRAPH_EDGES"],
    final_answer_fact_selectors: ["relationship_edges"],
    authorization_expansion_detected: false,
  };
}

describe("Harness routing suite", () => {
  it("covers the required intent, correction, context, capability and safety classes", () => {
    expect(harnessRoutingSuite).toHaveLength(10);
    expect(new Set(harnessRoutingSuite.map(({ case_id: caseId }) => caseId)).size).toBe(10);
    expect(harnessRoutingSuite.filter(({ critical }) => critical).length).toBeGreaterThanOrEqual(8);
  });

  it("passes the user correction only with Semantic graph evidence and no Text2SQL", () => {
    const result = evaluateHarnessRouting(
      harnessRoutingCase("semantic-relationship-correction"),
      semanticObservation(),
    );
    expect(result).toEqual({
      verdict: "PASS",
      case_id: "semantic-relationship-correction",
      violations: [],
    });
  });

  it("fails the legacy table-count behavior for the relationship correction", () => {
    const result = evaluateHarnessRouting(harnessRoutingCase("semantic-relationship-correction"), {
      decision: delegation("governed-text2sql-agent"),
      admitted_profile_ids: ["governed-text2sql-agent"],
      tool_calls: [{ profile_id: "governed-text2sql-agent", tool_name: "schema.table_count" }],
      accepted_evidence: ["ACCEPTED_QUERY_EVIDENCE"],
      final_answer_fact_selectors: ["result.table_count"],
      authorization_expansion_detected: false,
    });
    expect(result.verdict).toBe("FAIL");
    expect(result.violations.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "CANDIDATE_PROFILE_MISMATCH",
        "ADMITTED_PROFILE_MISMATCH",
        "FORBIDDEN_PROFILE_USED",
        "REQUIRED_TOOL_MISSING",
        "FORBIDDEN_TOOL_USED",
        "REQUIRED_EVIDENCE_MISSING",
        "FINAL_ANSWER_EVIDENCE_MISSING",
      ]),
    );
  });

  it("accepts a direct Root answer when no specialist is needed", () => {
    expect(
      evaluateHarnessRouting(harnessRoutingCase("general-concept-explanation"), {
        decision: directAnswer(),
        admitted_profile_ids: [],
        tool_calls: [],
        accepted_evidence: [],
        final_answer_fact_selectors: [],
        authorization_expansion_detected: false,
      }).verdict,
    ).toBe("PASS");
  });

  it("fails closed when Host admission expands authority", () => {
    const observation = { ...semanticObservation(), authorization_expansion_detected: true };
    const result = evaluateHarnessRouting(
      harnessRoutingCase("semantic-relationship-correction"),
      observation,
    );
    expect(result.violations).toContainEqual(
      expect.objectContaining({ code: "AUTHORIZATION_EXPANSION" }),
    );
  });
});
