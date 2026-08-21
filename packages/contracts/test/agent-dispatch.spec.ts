import { describe, expect, it } from "vitest";
import {
  buildAgentDispatchDeferredReceipt,
  buildAgentDispatchExecuteAdmission,
  buildAgentDispatchExecutionBinding,
  buildAgentDispatchPlan,
  buildDirectAdmissibilityReceipt,
  sha256ContentHash,
  verifyAgentDispatchAdmissionResult,
  verifyAgentDispatchPlan,
} from "../src/index.js";

const ids = Array.from(
  { length: 12 },
  (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

const profileRef = async (
  profile_id: "governed-text2sql-agent" | "report-writing-agent" | "semantic-management-agent",
  salt: string,
) => ({ profile_id, revision: 1, revision_hash: await sha256ContentHash({ salt }) });

async function directPlan() {
  const capability = await sha256ContentHash({ catalog: "ready" });
  const direct = await buildDirectAdmissibilityReceipt({
    schema_version: "direct-admissibility-receipt@1.0.0",
    no_new_facts: true,
    no_governance_mutation: true,
    no_formal_report: true,
    policy_version: "adaptive-routing@1.0.0",
    capability_snapshot_hash: capability,
  });
  return buildAgentDispatchPlan({
    schema_version: "agent-dispatch-plan@1.0.0",
    plan_id: ids[0],
    run_id: ids[1],
    question_class: "EXPLANATION",
    mode: "DIRECT",
    selected_profile_refs: [],
    dependency_edges: [],
    required_evidence: ["DIRECT_PROVIDER_RECEIPT"],
    reason_codes: ["DIRECT_EXPLANATION_ADMISSIBLE"],
    capability_snapshot_hash: capability,
    policy_version: "adaptive-routing@1.0.0",
    direct_admissibility_receipt: direct,
  });
}

describe("AgentDispatch authority", () => {
  it("builds and verifies a content-addressed DIRECT admission", async () => {
    const plan = await directPlan();
    const binding = await buildAgentDispatchExecutionBinding({
      schema_version: "agent-dispatch-execution-binding@1.0.0",
      run_id: plan.run_id,
      effective_executor_version: "ADAPTIVE@1",
      dispatch_plan_ref: { plan_id: plan.plan_id, plan_hash: plan.plan_hash },
      selected_profile_refs: [],
      policy_version: plan.policy_version,
      capability_snapshot_hash: plan.capability_snapshot_hash,
      shadow_dispatch_plan_ref: null,
    });
    const admission = await buildAgentDispatchExecuteAdmission({ kind: "EXECUTE", plan, binding });
    await expect(verifyAgentDispatchAdmissionResult(admission)).resolves.toEqual(admission);
    await expect(
      verifyAgentDispatchAdmissionResult({
        ...admission,
        binding: { ...binding, policy_version: "adaptive-routing@9.9.9" },
      }),
    ).rejects.toThrow("AGENT_DISPATCH_EXECUTION_BINDING_MISMATCH");
  });

  it("accepts selected TEAM subsets and closes Report over QueryEvidence", async () => {
    const text2sql = await profileRef("governed-text2sql-agent", "text2sql");
    const report = await profileRef("report-writing-agent", "report");
    const plan = await buildAgentDispatchPlan({
      schema_version: "agent-dispatch-plan@1.0.0",
      plan_id: ids[2],
      run_id: ids[3],
      question_class: "REPORT",
      mode: "TEAM",
      selected_profile_refs: [text2sql, report],
      dependency_edges: [
        {
          from_profile_id: "governed-text2sql-agent",
          to_profile_id: "report-writing-agent",
          evidence_requirement: "ACCEPTED_QUERY_EVIDENCE",
        },
      ],
      required_evidence: [
        "ACCEPTED_QUERY_EVIDENCE",
        "ACCEPTED_REPORT_ARTIFACT",
        "FROZEN_SEMANTIC_RELEASE",
      ],
      reason_codes: ["FORMAL_REPORT_REQUESTED"],
      capability_snapshot_hash: await sha256ContentHash({ profiles: [text2sql, report] }),
      policy_version: "adaptive-routing@1.0.0",
      direct_admissibility_receipt: null,
    });
    await expect(verifyAgentDispatchPlan(plan)).resolves.toEqual(plan);
  });

  it("fails closed on dependency gaps, duplicate refs, and hash tampering", async () => {
    const text2sql = await profileRef("governed-text2sql-agent", "text2sql");
    const report = await profileRef("report-writing-agent", "report");
    const base = {
      schema_version: "agent-dispatch-plan@1.0.0",
      plan_id: ids[4],
      run_id: ids[5],
      question_class: "REPORT",
      mode: "TEAM",
      dependency_edges: [],
      required_evidence: ["ACCEPTED_REPORT_ARTIFACT"],
      reason_codes: ["FORMAL_REPORT_REQUESTED"],
      capability_snapshot_hash: await sha256ContentHash({ profile: "report" }),
      policy_version: "adaptive-routing@1.0.0",
      direct_admissibility_receipt: null,
    } as const;
    await expect(
      buildAgentDispatchPlan({ ...base, selected_profile_refs: [text2sql, report] }),
    ).rejects.toThrow();
    await expect(
      buildAgentDispatchPlan({ ...base, selected_profile_refs: [text2sql, text2sql] }),
    ).rejects.toThrow();
    const semantic = await profileRef("semantic-management-agent", "semantic");
    await expect(
      buildAgentDispatchPlan({
        ...base,
        question_class: "DATA_QUERY",
        selected_profile_refs: [text2sql, semantic],
        dependency_edges: [
          {
            from_profile_id: "governed-text2sql-agent",
            to_profile_id: "semantic-management-agent",
            evidence_requirement: "FROZEN_SEMANTIC_RELEASE",
          },
          {
            from_profile_id: "semantic-management-agent",
            to_profile_id: "governed-text2sql-agent",
            evidence_requirement: "FROZEN_SEMANTIC_RELEASE",
          },
        ],
      }),
    ).rejects.toThrow();

    const direct = await directPlan();
    await expect(
      verifyAgentDispatchPlan({ ...direct, reason_codes: ["TAMPERED"] }),
    ).rejects.toThrow("AGENT_DISPATCH_PLAN_HASH_MISMATCH");
  });

  it("builds a deterministic DEFERRED receipt and rejects tampering", async () => {
    const receipt = await buildAgentDispatchDeferredReceipt({
      kind: "DEFERRED",
      schema_version: "agent-dispatch-deferred-receipt@1.0.0",
      run_id: ids[6],
      question_class: "ATTRIBUTION",
      reason_code: "ATTRIBUTION_RUNTIME_NOT_READY",
      required_capabilities: ["attribution.acceptance@1.0.0"],
      policy_version: "adaptive-routing@1.0.0",
      capability_snapshot_hash: await sha256ContentHash({ attribution: false }),
    });
    await expect(verifyAgentDispatchAdmissionResult(receipt)).resolves.toEqual(receipt);
    await expect(
      verifyAgentDispatchAdmissionResult({ ...receipt, reason_code: "ROOT_ONLY_DEFER_DATA" }),
    ).rejects.toThrow("AGENT_DISPATCH_DEFERRED_RECEIPT_MISMATCH");
  });
});
