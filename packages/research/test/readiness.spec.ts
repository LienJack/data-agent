import {
  artifactReferenceIdentity,
  evidenceGateReceiptPayloadSchema,
  reportReadyCertificateV3PayloadSchema,
} from "@data-agent/contracts";
import { derivePreStopReadinessFacts } from "@data-agent/research";
import { describe, expect, it } from "vitest";
import { computeResearchKernelHash } from "../src/internal/hash.js";
import {
  createReportReadyCertificateFromResolvedFactsCandidate as createReportReadyCertificateCandidate,
  evaluateEvidenceGatesFromResolvedFacts as evaluateEvidenceGates,
} from "../src/readiness.js";
import {
  composeControlledResearchClosure,
  controlledResearchBriefPayload,
} from "../src/server/controlled-composition.js";
import { materializeControlledProtocolInput } from "../src/server.js";
import { controlledBaseEvaluation, controlledHandle } from "./controlled.js";
import { reference } from "./fixtures.js";

async function baselineReadinessClosure() {
  const input = materializeControlledProtocolInput(await controlledHandle());
  const closure = await composeControlledResearchClosure(input);
  if ("error" in closure) throw new Error("Controlled closure 生成失败。");
  const evaluation = await controlledBaseEvaluation();
  const artifacts = evaluation.artifact_candidates;
  const { stop, manifest, report, projection_receipt, report_ready, gates } = artifacts;
  if (!stop || !manifest || !report || !projection_receipt || !report_ready || !gates) {
    throw new Error(
      `基线 Readiness Closure 不完整：${JSON.stringify(evaluation.kernel_outcome)}。`,
    );
  }
  const gateFacts = {
    brief_ref: manifest.brief_ref,
    brief: await controlledResearchBriefPayload(),
    report_manifest_ref: report.manifest_ref,
    report_manifest: manifest,
    analysis_report_ref: projection_receipt.report_ref,
    analysis_report: report,
    evaluator_version: "controlled-readiness-gate@1.0.0",
    query_evidence: closure.coverageInput.query_evidence,
    atomic_claims: closure.coverageInput.atomic_claims,
    evidence_relations: closure.coverageInput.evidence_relations,
    evidence_checks: closure.coverageInput.evidence_checks,
    hypothesis_assessments: closure.coverageInput.hypothesis_assessments,
    support_decisions: closure.supportResolutions,
    current_version_frontier: closure.currentFrontier,
  } as const;
  return {
    artifacts: {
      stop,
      manifest,
      report,
      projection_receipt,
      report_ready,
      gates,
    },
    closure,
    gateFacts,
  };
}

describe("Readiness candidate kernel", () => {
  it("Pre-stop evaluator 对 malformed input fail-close，并独立报告来源/L2 与 bounded disclosure 缺口", async () => {
    expect(await derivePreStopReadinessFacts(null as never)).toMatchObject({
      ok: false,
      error: { code: "RESEARCH_STOP_INPUT_INCONSISTENT" },
    });
    const { gateFacts } = await baselineReadinessClosure();
    const facts = await derivePreStopReadinessFacts({
      brief: gateFacts.brief,
      material_query_evidence: [gateFacts.query_evidence[0]?.payload].filter(
        (payload): payload is (typeof gateFacts.query_evidence)[number]["payload"] =>
          payload !== undefined,
      ),
      supplied_disclosures: [],
    });
    expect(facts).toMatchObject({
      ok: true,
      value: {
        ready: false,
        reason_codes: [
          "SOURCE_INDEPENDENCE_POLICY_UNSATISFIED",
          "BOUNDED_HYPOTHESIS_UNIVERSE_UNDISCLOSED",
        ],
      },
    });
  });

  it("基线形成四张独立 PASS Gate 与 ReportReady@3 Candidate，但没有 Public READY", async () => {
    const evaluation = await controlledBaseEvaluation();
    const gates = evaluation.artifact_candidates.gates;
    const candidate = evaluation.artifact_candidates.report_ready;
    expect(gates).toBeDefined();
    expect(candidate).toBeDefined();
    if (!gates || !candidate) return;
    expect(
      Object.values(gates)
        .map(({ gate }) => gate)
        .sort(),
    ).toEqual(["CONFLICT", "FRESHNESS", "SOURCE_INDEPENDENCE", "SUPPORT"].sort());
    for (const gate of Object.values(gates)) {
      expect(evidenceGateReceiptPayloadSchema.parse(gate)).toEqual(gate);
      expect(gate.verdict).toBe("PASS");
    }
    expect(reportReadyCertificateV3PayloadSchema.parse(candidate)).toEqual(candidate);
    expect(candidate).not.toHaveProperty("public_terminal");
    expect(candidate).not.toHaveProperty("current_readiness");
    expect(candidate).not.toHaveProperty("grant");
    expect(candidate).not.toHaveProperty("committed");
  });

  it("Gate Facts 由语义闭包重算；FAIL Gate 无法签发 ReportReady Candidate", async () => {
    const { artifacts, closure, gateFacts } = await baselineReadinessClosure();
    const failedGates = await evaluateEvidenceGates({
      ...gateFacts,
      analysis_report: {
        ...gateFacts.analysis_report,
        disclosures: ["L2_NON_CAUSAL", "BOUNDED_HYPOTHESIS_UNIVERSE"],
      },
    });
    expect(failedGates.ok).toBe(true);
    if (!failedGates.ok) return;
    expect(failedGates.value.source_independence.verdict).toBe("FAIL");

    expect(
      await createReportReadyCertificateCandidate({
        stop_decision_ref: artifacts.report_ready.stop_decision_ref,
        stop_decision: artifacts.stop,
        report_manifest_ref: artifacts.report_ready.report_manifest_ref,
        report_manifest: artifacts.manifest,
        analysis_report_ref: artifacts.report_ready.analysis_report_ref,
        analysis_report: artifacts.report,
        projection_receipt_ref: artifacts.report_ready.projection_receipt_ref,
        projection_receipt: artifacts.projection_receipt,
        gate_receipt_refs: artifacts.report_ready.gate_receipt_refs,
        gates: failedGates.value,
        gate_facts: {
          ...gateFacts,
          analysis_report: {
            ...gateFacts.analysis_report,
            disclosures: ["L2_NON_CAUSAL", "BOUNDED_HYPOTHESIS_UNIVERSE"],
          },
        },
        material_support_decisions: [closure.support1],
        version_frontier: artifacts.report_ready.version_frontier,
        evaluated_through_input_event_seq: 10,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPORT_READY_AUTHORITY_REQUIRED" },
    });
  });

  it("四张无关 PASS Gate 即使保留 enum，也不能签发 Candidate", async () => {
    const { artifacts, closure, gateFacts } = await baselineReadinessClosure();
    const unrelated = {
      ...artifacts.gates,
      support: {
        ...artifacts.gates.support,
        evaluated_refs: [gateFacts.brief_ref],
      },
      conflict: {
        ...artifacts.gates.conflict,
        evaluated_refs: [gateFacts.brief_ref],
      },
      freshness: {
        ...artifacts.gates.freshness,
        evaluated_refs: [gateFacts.brief_ref],
      },
      source_independence: {
        ...artifacts.gates.source_independence,
        evaluated_refs: [gateFacts.brief_ref],
      },
    };
    expect(
      await createReportReadyCertificateCandidate({
        stop_decision_ref: artifacts.report_ready.stop_decision_ref,
        stop_decision: artifacts.stop,
        report_manifest_ref: artifacts.report_ready.report_manifest_ref,
        report_manifest: artifacts.manifest,
        analysis_report_ref: artifacts.report_ready.analysis_report_ref,
        analysis_report: artifacts.report,
        projection_receipt_ref: artifacts.report_ready.projection_receipt_ref,
        projection_receipt: artifacts.projection_receipt,
        gate_receipt_refs: artifacts.report_ready.gate_receipt_refs,
        gates: unrelated,
        gate_facts: gateFacts,
        material_support_decisions: [closure.support1],
        version_frontier: artifacts.report_ready.version_frontier,
        evaluated_through_input_event_seq: 10,
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPORT_READY_AUTHORITY_REQUIRED" },
    });
  });

  it("SOURCE gate 要求 Manifest 与 Report 都保留 L2 disclosure，且只统计 material Evidence provenance", async () => {
    const { gateFacts } = await baselineReadinessClosure();
    const withoutL2 = await evaluateEvidenceGates({
      ...gateFacts,
      report_manifest: {
        ...gateFacts.report_manifest,
        required_disclosures: gateFacts.report_manifest.required_disclosures.filter(
          (disclosure) => disclosure !== "L2_NON_CAUSAL",
        ),
      },
      analysis_report: {
        ...gateFacts.analysis_report,
        disclosures: gateFacts.analysis_report.disclosures.filter(
          (disclosure) => disclosure !== "L2_NON_CAUSAL",
        ),
      },
    });
    expect(withoutL2).toMatchObject({
      ok: true,
      value: { source_independence: { verdict: "FAIL" } },
    });

    const [supportedEvidence, refutedEvidence] = gateFacts.query_evidence;
    if (!supportedEvidence || !refutedEvidence) {
      throw new Error("Readiness provenance fixture 不完整。");
    }
    const unrelatedSecondGroup = await evaluateEvidenceGates({
      ...gateFacts,
      brief: {
        ...gateFacts.brief,
        source_independence_policy: {
          mode: "MULTI_PROVENANCE_REQUIRED",
          minimum_provenance_groups: 2,
          required_disclosures: [],
        },
      },
      query_evidence: [
        supportedEvidence,
        refutedEvidence,
        {
          ref: reference("QueryEvidence", "94"),
          payload: {
            ...refutedEvidence.payload,
            provenance_group: "unrelated-second-source",
          },
        },
      ],
    });
    expect(unrelatedSecondGroup).toMatchObject({
      ok: true,
      value: { source_independence: { verdict: "FAIL" } },
    });
  });

  it("CONFLICT gate 对 REFUTED Assessment 做 exact placement，resolved payload 仍是 strict", async () => {
    const { gateFacts } = await baselineReadinessClosure();
    const missingRefutedPlacement = await evaluateEvidenceGates({
      ...gateFacts,
      report_manifest: {
        ...gateFacts.report_manifest,
        sections: gateFacts.report_manifest.sections.map((section) =>
          section.section_id === "REFUTED_HYPOTHESES"
            ? { ...section, hypothesis_assessment_refs: [] }
            : section,
        ),
      },
    });
    expect(missingRefutedPlacement).toMatchObject({
      ok: true,
      value: { conflict: { verdict: "FAIL" } },
    });
    const [, refutedAssessment] = gateFacts.hypothesis_assessments;
    if (!refutedAssessment) throw new Error("Readiness refuted fixture 缺失。");
    const unrelatedAssessment = {
      ref: reference("HypothesisAssessment", "92"),
      payload: refutedAssessment.payload,
    };
    const unrelatedReplacement = await evaluateEvidenceGates({
      ...gateFacts,
      hypothesis_assessments: [...gateFacts.hypothesis_assessments, unrelatedAssessment],
      report_manifest: {
        ...gateFacts.report_manifest,
        sections: gateFacts.report_manifest.sections.map((section) =>
          section.section_id === "REFUTED_HYPOTHESES"
            ? {
                ...section,
                hypothesis_assessment_refs: [unrelatedAssessment.ref],
              }
            : section,
        ),
      },
    });
    expect(unrelatedReplacement).toMatchObject({
      ok: true,
      value: { conflict: { verdict: "FAIL" } },
    });

    const conflictRelation = {
      ref: reference("EvidenceRelation", "93"),
      payload: {
        ...gateFacts.evidence_relations[0]?.payload,
        proposed_relation: "CONFLICTS" as const,
      },
    };
    if (!conflictRelation.payload.artifact_type) {
      throw new Error("Readiness conflict fixture 缺失。");
    }
    const wrongConflictSection = await evaluateEvidenceGates({
      ...gateFacts,
      evidence_relations: [
        ...gateFacts.evidence_relations,
        conflictRelation as (typeof gateFacts.evidence_relations)[number],
      ],
      report_manifest: {
        ...gateFacts.report_manifest,
        sections: gateFacts.report_manifest.sections.map((section) =>
          section.section_id === "METHOD"
            ? { ...section, conflict_refs: [conflictRelation.ref] }
            : section,
        ),
      },
      analysis_report: {
        ...gateFacts.analysis_report,
        sections: gateFacts.analysis_report.sections.map((section) =>
          section.section_id === "CONFLICTS"
            ? { ...section, statement_units: ["存在一项 material conflict。"] }
            : section,
        ),
      },
    });
    expect(wrongConflictSection).toMatchObject({
      ok: false,
      error: { code: "REPORT_READY_AUTHORITY_REQUIRED" },
    });

    const [firstEvidence, ...remainingEvidence] = gateFacts.query_evidence;
    if (!firstEvidence) throw new Error("Readiness strict fixture 缺失。");
    expect(
      await evaluateEvidenceGates({
        ...gateFacts,
        query_evidence: [
          {
            ...firstEvidence,
            payload: {
              ...firstEvidence.payload,
              injected_verdict: "PASS",
            } as typeof firstEvidence.payload,
          },
          ...remainingEvidence,
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPORT_READY_AUTHORITY_REQUIRED" },
    });
    expect(
      await evaluateEvidenceGates({
        ...gateFacts,
        query_evidence: [
          {
            ...firstEvidence,
            ref: {
              ...firstEvidence.ref,
              tenant_id: "00000000-0000-4000-8000-000000000099",
            },
          },
          ...remainingEvidence,
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPORT_READY_AUTHORITY_REQUIRED" },
    });
  });

  it("REFUTED Assessment 可同时引用 SUPPORTED Support，且多个 Assessment 可共享同一 REFUTED Support", async () => {
    const { gateFacts } = await baselineReadinessClosure();
    const supported = gateFacts.support_decisions.find(
      ({ payload }) => payload.decision === "SUPPORTED",
    );
    const refuted = gateFacts.support_decisions.find(
      ({ payload }) => payload.decision === "REFUTED",
    );
    const refutedAssessment = gateFacts.hypothesis_assessments.find(
      ({ payload }) => payload.status === "REFUTED",
    );
    if (!supported || !refuted || !refutedAssessment) {
      throw new Error("Readiness legal refutation graph fixture 不完整。");
    }

    const mixedAssessment = {
      ...refutedAssessment,
      payload: {
        ...refutedAssessment.payload,
        support_decision_refs: [supported.ref, refuted.ref],
      },
    };
    const mixedGates = await evaluateEvidenceGates({
      ...gateFacts,
      hypothesis_assessments: gateFacts.hypothesis_assessments.map((assessment) =>
        artifactReferenceIdentity(assessment.ref) ===
        artifactReferenceIdentity(refutedAssessment.ref)
          ? mixedAssessment
          : assessment,
      ),
    });
    expect(mixedGates.ok).toBe(true);
    if (!mixedGates.ok) return;
    expect(Object.values(mixedGates.value).every(({ verdict }) => verdict === "PASS")).toBe(true);

    const sharedAssessment = {
      ref: reference("HypothesisAssessment", "95"),
      payload: {
        ...refutedAssessment.payload,
        support_decision_refs: [refuted.ref],
      },
    };
    const sharedManifestMaterial = {
      brief_ref: gateFacts.report_manifest.brief_ref,
      stop_decision_ref: gateFacts.report_manifest.stop_decision_ref,
      sections: gateFacts.report_manifest.sections.map((section) =>
        section.section_id === "REFUTED_HYPOTHESES"
          ? {
              ...section,
              hypothesis_assessment_refs: [
                ...section.hypothesis_assessment_refs,
                sharedAssessment.ref,
              ],
            }
          : section,
      ),
      material_claim_refs: gateFacts.report_manifest.material_claim_refs,
      required_disclosures: gateFacts.report_manifest.required_disclosures,
      allowed_style_profile: gateFacts.report_manifest.allowed_style_profile,
    };
    const sharedGates = await evaluateEvidenceGates({
      ...gateFacts,
      report_manifest: {
        artifact_type: "ReportManifest",
        protocol_version: "report-manifest@2.0.0",
        ...sharedManifestMaterial,
        manifest_hash: await computeResearchKernelHash(
          "u6-report-manifest@2",
          sharedManifestMaterial,
        ),
      },
      hypothesis_assessments: [...gateFacts.hypothesis_assessments, sharedAssessment],
    });
    expect(sharedGates.ok).toBe(true);
    if (!sharedGates.ok) return;
    expect(Object.values(sharedGates.value).every(({ verdict }) => verdict === "PASS")).toBe(true);
  });

  it("Certificate 拒绝 Projection 扫描失败与 Stop decision hash 篡改", async () => {
    const { artifacts, closure, gateFacts } = await baselineReadinessClosure();
    const common = {
      stop_decision_ref: artifacts.report_ready.stop_decision_ref,
      stop_decision: artifacts.stop,
      report_manifest_ref: artifacts.report_ready.report_manifest_ref,
      report_manifest: artifacts.manifest,
      analysis_report_ref: artifacts.report_ready.analysis_report_ref,
      analysis_report: artifacts.report,
      projection_receipt_ref: artifacts.report_ready.projection_receipt_ref,
      projection_receipt: artifacts.projection_receipt,
      gate_receipt_refs: artifacts.report_ready.gate_receipt_refs,
      gates: artifacts.gates,
      gate_facts: gateFacts,
      material_support_decisions: [closure.support1],
      version_frontier: artifacts.report_ready.version_frontier,
      evaluated_through_input_event_seq: 10,
    } as const;
    expect(
      await createReportReadyCertificateCandidate({
        ...common,
        projection_receipt: {
          ...artifacts.projection_receipt,
          forbidden_claim_mode_scan: "FAIL",
          reason_codes: ["REPORT_PROJECTION_AUTHORITY_INVALID"],
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPORT_READY_CERTIFICATE_TAMPERED" },
    });
    expect(
      await createReportReadyCertificateCandidate({
        ...common,
        stop_decision: {
          ...artifacts.stop,
          decision_input_hash: `sha256:${"0".repeat(64)}`,
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPORT_READY_AUTHORITY_REQUIRED" },
    });

    const refutedSupport = closure.supportResolutions.find(
      ({ payload }) => payload.decision === "REFUTED",
    );
    if (!refutedSupport) throw new Error("Certificate swap fixture 缺少 REFUTED Support。");
    const swappedSupportedSubset = {
      ...artifacts.stop.supported_subset,
      support_decision_refs: [refutedSupport.ref],
      subset_hash: await computeResearchKernelHash("u6-supported-subset@1", {
        supported: artifacts.stop.supported_subset.claim_refs.map((claimRef) => ({
          claim_ref: claimRef,
          support_decision_ref: refutedSupport.ref,
        })),
        required_disclosures: artifacts.stop.supported_subset.required_disclosures,
      }),
    };
    const { decision_input_hash: _declaredDecisionHash, ...swappedStopWithoutDecisionHash } = {
      ...artifacts.stop,
      supported_subset: swappedSupportedSubset,
    };
    expect(
      await createReportReadyCertificateCandidate({
        ...common,
        stop_decision: {
          ...swappedStopWithoutDecisionHash,
          decision_input_hash: await computeResearchKernelHash(
            "u6-stop-decision@1",
            swappedStopWithoutDecisionHash,
          ),
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPORT_READY_AUTHORITY_REQUIRED" },
    });
  });
});
