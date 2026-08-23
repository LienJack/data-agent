import {
  artifactReferenceIdentity,
  type L2ResearchDocumentCandidate,
  U6_WIRE_LIMITS,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { deriveCoverageStateCandidate } from "../src/coverage.js";
import type { ResearchKernelResult } from "../src/errors.js";
import { computeResearchKernelHash } from "../src/internal/hash.js";
import { createReportReadyCertificateCandidate, evaluateEvidenceGates } from "../src/readiness.js";
import { buildReportManifestCandidate, projectAnalysisReportCandidate } from "../src/reporting.js";
import { deriveResearchStopDecisionFromDocumentsCandidate as deriveResearchStopDecisionCandidate } from "../src/stop.js";
import {
  buildDocumentBackedResearchFixture,
  deriveExactResearchDocumentRef,
  sealResearchDocument,
} from "./document-fixtures.js";
import { hashes, reference } from "./fixtures.js";

type ResearchPayload = L2ResearchDocumentCandidate["payload"];

function kernelValue<T>(result: ResearchKernelResult<T>, artifact: string): T {
  if (!result.ok) {
    throw new Error(`${artifact} 构造失败：${result.error.code} ${result.error.message}`);
  }
  return result.value;
}

function exactPayload<const T extends ResearchPayload["artifact_type"]>(
  document: L2ResearchDocumentCandidate,
  expectedArtifactType: T,
): Extract<ResearchPayload, { artifact_type: T }> {
  if (
    document.envelope.artifact_type !== expectedArtifactType ||
    document.payload.artifact_type !== expectedArtifactType
  ) {
    throw new TypeError(
      `Document 类型漂移：预期 ${expectedArtifactType}，实际 ${document.payload.artifact_type}。`,
    );
  }
  return document.payload as Extract<ResearchPayload, { artifact_type: T }>;
}

async function buildDocumentBackedReadinessFixture(
  mode: "MIXED_SUPPORTED_REFUTED" | "ALL_REFUTED" = "MIXED_SUPPORTED_REFUTED",
) {
  const research = await buildDocumentBackedResearchFixture({
    seed: mode === "ALL_REFUTED" ? 21_000 : 20_000,
    mode,
  });
  const supportedQueries = research.queries.filter(
    ({ support_decision_document }) =>
      exactPayload(support_decision_document, "SupportDecision").decision === "SUPPORTED",
  );
  const supportedClaimDocuments = supportedQueries.map(
    ({ atomic_claim_resolution }) => atomic_claim_resolution.document,
  );
  const supportDecisionDocuments = research.queries.map(
    ({ support_decision_document }) => support_decision_document,
  );
  const refutedAssessmentDocuments = research.queries
    .filter(
      ({ hypothesis_assessment_document }) =>
        exactPayload(hypothesis_assessment_document, "HypothesisAssessment").status === "REFUTED",
    )
    .map(({ hypothesis_assessment_document }) => hypothesis_assessment_document);
  if (
    (mode === "MIXED_SUPPORTED_REFUTED" && supportedQueries.length !== 1) ||
    (mode === "ALL_REFUTED" && supportedQueries.length !== 0)
  ) {
    throw new Error("Document readiness fixture 预期恰有一项 SUPPORTED Claim/Decision。");
  }

  const stopDecisionResolution = {
    document: research.stop_document,
    derivation_input: research.stop_input,
  } as const;
  const manifestInput = {
    brief_document: research.brief_document,
    stop_decision_resolution: stopDecisionResolution,
    executive_claim_documents: supportedClaimDocuments,
    supported_finding_claim_documents: supportedClaimDocuments,
    support_decision_documents: supportDecisionDocuments,
    refuted_hypothesis_assessment_documents: refutedAssessmentDocuments,
    conflict_relation_documents: [],
    limitation_codes: ["L2_NON_CAUSAL"],
  } as const;
  const manifest = kernelValue(await buildReportManifestCandidate(manifestInput), "ReportManifest");
  const manifestDocument = await sealResearchDocument(manifest, 30_000);
  const provisionalProjectionInput = {
    brief_document: research.brief_document,
    manifest_document: manifestDocument,
    report_ref: reference("AnalysisReport", "97"),
    atomic_claim_documents: supportedClaimDocuments,
    projector_version: "document-boundary-projector@1.0.0",
  } as const;
  const provisionalProjection = kernelValue(
    await projectAnalysisReportCandidate(provisionalProjectionInput),
    "AnalysisReport",
  );
  const reportDocument = await sealResearchDocument(provisionalProjection.report, 30_001);
  const reportRef = await deriveExactResearchDocumentRef(reportDocument, "AnalysisReport");
  const projectionInput = {
    ...provisionalProjectionInput,
    report_ref: reportRef,
  } as const;
  const projection = kernelValue(
    await projectAnalysisReportCandidate(projectionInput),
    "ReportProjectionReceipt",
  );
  const projectionDocument = await sealResearchDocument(projection.receipt, 30_002);
  const gateFacts = {
    brief_document: research.brief_document,
    report_manifest_document: manifestDocument,
    analysis_report_document: reportDocument,
    evaluator_version: "document-boundary-gate@1.0.0",
    query_evidence_resolutions: research.query_evidence_resolutions,
    atomic_claim_resolutions: research.atomic_claim_resolutions,
    evidence_relation_resolutions: research.evidence_relation_resolutions,
    evidence_check_resolutions: research.evidence_check_resolutions,
    hypothesis_assessment_resolutions: research.hypothesis_assessment_resolutions,
    support_decision_resolutions: research.support_decision_resolutions,
    current_version_frontier: research.version_frontier,
  } as const;
  const gates = kernelValue(await evaluateEvidenceGates(gateFacts), "EvidenceGateReceipt");
  const gateDocuments = {
    support: await sealResearchDocument(gates.support, 30_010),
    conflict: await sealResearchDocument(gates.conflict, 30_011),
    freshness: await sealResearchDocument(gates.freshness, 30_012),
    source_independence: await sealResearchDocument(gates.source_independence, 30_013),
  };
  const reportReadyInput = {
    stop_decision_resolution: stopDecisionResolution,
    report_manifest_resolution: {
      document: manifestDocument,
      derivation_input: manifestInput,
    },
    report_projection_resolution: {
      report_document: reportDocument,
      receipt_document: projectionDocument,
      derivation_input: projectionInput,
    },
    gate_receipt_documents: gateDocuments,
    gate_facts: gateFacts,
    version_frontier: research.version_frontier,
    evaluated_through_input_event_seq: 10,
  } as const;

  return {
    research,
    stopDecisionResolution,
    manifestInput,
    manifestDocument,
    reportDocument,
    projectionDocument,
    projectionInput,
    gateFacts,
    gates,
    gateDocuments,
    projection,
    reportReadyInput,
  };
}

describe("Document-backed research kernel boundaries", () => {
  it("Coverage 只接受可由完整 Document closure 重派生的 payload", async () => {
    const fixture = await buildDocumentBackedResearchFixture();
    const coverage = await deriveCoverageStateCandidate(fixture.coverage_input);
    expect(
      coverage,
      coverage.ok ? undefined : `${coverage.error.code}: ${coverage.error.message}`,
    ).toMatchObject({
      ok: true,
      value: {
        artifact_type: "CoverageState",
        obligations: [{ state: "SATISFIED" }, { state: "SATISFIED" }],
      },
    });

    const [firstClaim, ...remainingClaims] = fixture.atomic_claim_resolutions;
    if (!firstClaim) throw new Error("Document fixture 缺少 AtomicClaim。");
    const claim = exactPayload(firstClaim.document, "AtomicClaim");
    const tamperedStatement = "攻击者自行封装的观察结论。";
    const tamperedClaimDocument = await sealResearchDocument(
      {
        ...claim,
        statement: tamperedStatement,
        statement_hash: await computeResearchKernelHash("u6-atomic-claim-statement@1", {
          renderer_version: firstClaim.derivation_input.renderer.renderer_version,
          locale: firstClaim.derivation_input.renderer.locale,
          statement: tamperedStatement,
        }),
      },
      40_000,
    );
    await expect(
      deriveCoverageStateCandidate({
        ...fixture.coverage_input,
        atomic_claim_resolutions: [
          { ...firstClaim, document: tamperedClaimDocument },
          ...remainingClaims,
        ],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "COVERAGE_INPUT_INVALID" },
    });

    const [firstCheck, ...remainingChecks] = fixture.evidence_check_resolutions;
    if (!firstCheck) throw new Error("Document fixture 缺少 EvidenceCheckReceipt。");
    await expect(
      deriveCoverageStateCandidate({
        ...fixture.coverage_input,
        evidence_check_resolutions: [
          {
            ...firstCheck,
            document: {
              ...firstCheck.document,
              envelope: {
                ...firstCheck.document.envelope,
                content_hash: hashes.a,
              },
            },
          },
          ...remainingChecks,
        ],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "COVERAGE_INPUT_INVALID" },
    });
  });

  it("Stop 重算 Coverage、绑定 exact Brief，并要求 SUPPORTED+REFUTED 的 material QE", async () => {
    const fixture = await buildDocumentBackedResearchFixture();
    const coverage = exactPayload(fixture.coverage_document, "CoverageState");
    const forgedCoverageDocument = await sealResearchDocument(
      {
        ...coverage,
        coverage_input_hash: `sha256:${"0".repeat(64)}`,
      },
      40_010,
    );
    await expect(
      deriveResearchStopDecisionCandidate({
        ...fixture.stop_input,
        coverage_document: forgedCoverageDocument,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "RESEARCH_STOP_INPUT_INCONSISTENT" },
    });

    const brief = exactPayload(fixture.brief_document, "ResearchBrief");
    const weakBriefDocument = await sealResearchDocument(
      {
        ...brief,
        scope: {
          ...brief.scope,
          subject: "攻击者替换的弱约束研究问题",
        },
      },
      40_011,
    );
    await expect(
      deriveResearchStopDecisionCandidate({
        ...fixture.stop_input,
        pre_stop_readiness: {
          ...fixture.stop_input.pre_stop_readiness,
          brief_document: weakBriefDocument,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "RESEARCH_STOP_INPUT_INCONSISTENT" },
    });

    const refutedSupport = fixture.support_decision_resolutions.find(
      ({ document }) => exactPayload(document, "SupportDecision").decision === "REFUTED",
    );
    if (!refutedSupport) throw new Error("Document fixture 缺少 REFUTED SupportDecision。");
    const refutedClaimIdentity = artifactReferenceIdentity(
      exactPayload(refutedSupport.document, "SupportDecision").claim_ref,
    );
    const refutedClaim = fixture.atomic_claim_resolutions.find(
      ({ document }) => artifactReferenceIdentity(document.envelope) === refutedClaimIdentity,
    );
    if (!refutedClaim) throw new Error("Document fixture 缺少 REFUTED AtomicClaim。");
    const refutedEvidenceIdentities = new Set(
      exactPayload(refutedClaim.document, "AtomicClaim").evidence_refs.map(
        artifactReferenceIdentity,
      ),
    );
    const missingRefutedEvidence = fixture.material_query_evidence_documents.filter(
      (document) => !refutedEvidenceIdentities.has(artifactReferenceIdentity(document.envelope)),
    );
    const mixedAdverseStop = await deriveResearchStopDecisionCandidate({
      ...fixture.stop_input,
      pre_stop_readiness: {
        ...fixture.stop_input.pre_stop_readiness,
        material_query_evidence_documents: missingRefutedEvidence,
      },
    });
    expect(mixedAdverseStop).toMatchObject({
      ok: false,
      error: { code: "RESEARCH_STOP_INPUT_INCONSISTENT" },
    });
    expect(mixedAdverseStop.ok && mixedAdverseStop.value.decision === "STOP_READY").toBe(false);

    const allRefuted = await buildDocumentBackedResearchFixture({
      seed: 41_000,
      mode: "ALL_REFUTED",
    });
    expect(exactPayload(allRefuted.stop_document, "ResearchStopDecision")).toMatchObject({
      decision: "STOP_READY",
      supported_subset: {
        claim_refs: [],
        support_decision_refs: [],
      },
    });
  });

  it("Readiness 重派生 Claim/Gate，拒绝 self-sealed Claim 与无关 PASS Gate", async () => {
    const fixture = await buildDocumentBackedReadinessFixture();
    const baselineCertificate = await createReportReadyCertificateCandidate(
      fixture.reportReadyInput,
    );
    expect(
      baselineCertificate,
      baselineCertificate.ok
        ? undefined
        : `${baselineCertificate.error.code}: ${baselineCertificate.error.message}`,
    ).toMatchObject({
      ok: true,
      value: { artifact_type: "ReportReadyCertificate" },
    });

    const [firstClaim, ...remainingClaims] = fixture.gateFacts.atomic_claim_resolutions;
    if (!firstClaim) throw new Error("Readiness fixture 缺少 AtomicClaim。");
    const claim = exactPayload(firstClaim.document, "AtomicClaim");
    const selfSealedClaim = await sealResearchDocument(
      {
        ...claim,
        statement: "self-sealed forged readiness claim",
        statement_hash: hashes.b,
      },
      42_000,
    );
    await expect(
      evaluateEvidenceGates({
        ...fixture.gateFacts,
        atomic_claim_resolutions: [
          { ...firstClaim, document: selfSealedClaim },
          ...remainingClaims,
        ],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "REPORT_READY_AUTHORITY_REQUIRED" },
    });

    const unrelatedPassGate = await sealResearchDocument(
      {
        ...fixture.gates.support,
        evaluated_refs: [...fixture.gates.support.evaluated_refs, reference("QueryEvidence", "99")],
        gate_input_hash: hashes.c,
      },
      42_001,
    );
    await expect(
      createReportReadyCertificateCandidate({
        ...fixture.reportReadyInput,
        gate_receipt_documents: {
          ...fixture.gateDocuments,
          support: unrelatedPassGate,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "REPORT_READY_AUTHORITY_REQUIRED" },
    });
  });

  it("Readiness 在 replay 前快速拒绝超过 Wire 上限的重复 proof resolution 数组", async () => {
    const fixture = await buildDocumentBackedReadinessFixture();
    const firstEvidence = fixture.gateFacts.query_evidence_resolutions[0];
    if (!firstEvidence) throw new Error("Readiness budget fixture 缺少 QueryEvidence。");
    await expect(
      createReportReadyCertificateCandidate({
        ...fixture.reportReadyInput,
        gate_facts: {
          ...fixture.gateFacts,
          query_evidence_resolutions: Array.from(
            { length: U6_WIRE_LIMITS.max_obligations + 1 },
            () => firstEvidence,
          ),
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "RESEARCH_RESOURCE_LIMIT_EXCEEDED" },
    });
  });

  it("all-refuted STOP_READY 仍以非空反证链通过四 Gate 与 Certificate，完全空报告失败", async () => {
    const fixture = await buildDocumentBackedReadinessFixture("ALL_REFUTED");
    const manifest = exactPayload(fixture.manifestDocument, "ReportManifest");
    const refutedSection = manifest.sections.find(
      ({ section_id }) => section_id === "REFUTED_HYPOTHESES",
    );
    expect(manifest.material_claim_refs).toEqual([]);
    expect(refutedSection?.hypothesis_assessment_refs).toHaveLength(2);
    for (const gate of Object.values(fixture.gates)) {
      expect(gate.verdict).toBe("PASS");
    }
    for (const gate of [fixture.gates.support, fixture.gates.source_independence]) {
      const evaluatedTypes = new Set(gate.evaluated_refs.map(({ artifact_type }) => artifact_type));
      expect(evaluatedTypes).toEqual(
        new Set(
          [
            "ResearchBrief",
            "ReportManifest",
            "AnalysisReport",
            "HypothesisAssessment",
            "SupportDecision",
            "AtomicClaim",
            "EvidenceRelation",
            "EvidenceCheckReceipt",
            "QueryEvidence",
          ].filter((artifactType) =>
            gate.gate === "SUPPORT"
              ? artifactType !== "ResearchBrief" && artifactType !== "AnalysisReport"
              : true,
          ),
        ),
      );
    }
    const allRefutedCertificate = await createReportReadyCertificateCandidate(
      fixture.reportReadyInput,
    );
    expect(
      allRefutedCertificate,
      allRefutedCertificate.ok
        ? undefined
        : `${allRefutedCertificate.error.code}: ${allRefutedCertificate.error.message}`,
    ).toMatchObject({
      ok: true,
      value: {
        artifact_type: "ReportReadyCertificate",
        material_support_decision_refs: [],
      },
    });

    expect(
      (
        await buildReportManifestCandidate({
          brief_document: fixture.research.brief_document,
          stop_decision_resolution: fixture.stopDecisionResolution,
          executive_claim_documents: [],
          supported_finding_claim_documents: [],
          support_decision_documents: fixture.research.queries.map(
            ({ support_decision_document }) => support_decision_document,
          ),
          refuted_hypothesis_assessment_documents: [],
          conflict_relation_documents: [],
          limitation_codes: ["L2_NON_CAUSAL"],
        })
      ).ok,
    ).toBe(false);
  });

  it("Manifest 拒绝外来 Brief 与截断的双反证 closure", async () => {
    const mixed = await buildDocumentBackedReadinessFixture();
    const brief = exactPayload(mixed.research.brief_document, "ResearchBrief");
    const foreignBriefDocument = await sealResearchDocument(
      {
        ...brief,
        scope: {
          ...brief.scope,
          subject: "同 Run 中但不属于 Stop→Plan 的外来研究问题",
        },
      },
      42_050,
    );
    await expect(
      buildReportManifestCandidate({
        ...mixed.manifestInput,
        brief_document: foreignBriefDocument,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "REPORT_PROJECTION_AUTHORITY_INVALID" },
    });

    const allRefuted = await buildDocumentBackedReadinessFixture("ALL_REFUTED");
    expect(allRefuted.manifestInput.refuted_hypothesis_assessment_documents).toHaveLength(2);
    await expect(
      buildReportManifestCandidate({
        ...allRefuted.manifestInput,
        refuted_hypothesis_assessment_documents:
          allRefuted.manifestInput.refuted_hypothesis_assessment_documents.slice(0, 1),
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "REPORT_MANIFEST_MATERIAL_CLAIM_INCOMPLETE" },
    });
    await expect(
      createReportReadyCertificateCandidate({
        ...allRefuted.reportReadyInput,
        gate_facts: {
          ...allRefuted.gateFacts,
          hypothesis_assessment_resolutions:
            allRefuted.gateFacts.hypothesis_assessment_resolutions.slice(0, 1),
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "REPORT_READY_AUTHORITY_REQUIRED" },
    });
  });

  it("Certificate 重放 deterministic Projector，拒绝重封且自洽 hash 的伪造正文", async () => {
    const fixture = await buildDocumentBackedReadinessFixture();
    const report = exactPayload(fixture.reportDocument, "AnalysisReport");
    const forgedSections = report.sections.map((section) =>
      section.section_id === "EXECUTIVE_SUMMARY"
        ? {
            ...section,
            statement_units: ["攻击者声称指标增长 99%，因果导致自动执行。"],
          }
        : section,
    );
    const forgedProjectionHash = await computeResearchKernelHash(
      "u6-analysis-report-projection@1",
      {
        manifest_ref: report.manifest_ref,
        title_template_id: report.title_template_id,
        title: report.title,
        title_hash: report.title_hash,
        sections: forgedSections,
        disclosures: report.disclosures,
      },
    );
    const forgedReportDocument = await sealResearchDocument(
      {
        ...report,
        sections: forgedSections,
        projection_hash: forgedProjectionHash,
      },
      42_060,
    );
    const forgedReportRef = await deriveExactResearchDocumentRef(
      forgedReportDocument,
      "AnalysisReport",
    );
    const forgedRenderedStatementHashes = await Promise.all(
      forgedSections
        .flatMap(({ statement_units }) => statement_units)
        .map((statement) => computeResearchKernelHash("u6-report-statement@1", statement)),
    );
    const forgedReceiptDocument = await sealResearchDocument(
      {
        ...fixture.projection.receipt,
        report_ref: forgedReportRef,
        rendered_statement_hashes: forgedRenderedStatementHashes,
        projection_hash: forgedProjectionHash,
        forbidden_claim_mode_scan: "PASS",
        reason_codes: [],
      },
      42_061,
    );
    await expect(
      createReportReadyCertificateCandidate({
        ...fixture.reportReadyInput,
        report_projection_resolution: {
          report_document: forgedReportDocument,
          receipt_document: forgedReceiptDocument,
          derivation_input: {
            ...fixture.projectionInput,
            report_ref: forgedReportRef,
          },
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "REPORT_READY_AUTHORITY_REQUIRED" },
    });
  });

  it("Readiness 从 exact Brief.scope.subject 独立重算标题，拒绝自洽但任意的 report title", async () => {
    const fixture = await buildDocumentBackedReadinessFixture();
    const report = exactPayload(fixture.reportDocument, "AnalysisReport");
    const forgedTitle = "攻击者自行提供的标题";
    const forgedTitleHash = await computeResearchKernelHash("u6-report-title@1", forgedTitle);
    const forgedProjectionHash = await computeResearchKernelHash(
      "u6-analysis-report-projection@1",
      {
        manifest_ref: report.manifest_ref,
        title_template_id: report.title_template_id,
        title: forgedTitle,
        title_hash: forgedTitleHash,
        sections: report.sections,
        disclosures: report.disclosures,
      },
    );
    const forgedReportDocument = await sealResearchDocument(
      {
        ...report,
        title: forgedTitle,
        title_hash: forgedTitleHash,
        projection_hash: forgedProjectionHash,
      },
      42_100,
    );
    await expect(
      evaluateEvidenceGates({
        ...fixture.gateFacts,
        analysis_report_document: forgedReportDocument,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { freshness: { verdict: "FAIL" } },
    });
  });
});
