import {
  analysisReportV2PayloadSchema,
  reportManifestV2PayloadSchema,
  reportProjectionReceiptPayloadSchema,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import { computeResearchKernelHash } from "../src/internal/hash.js";
import { buildReportManifestCandidate } from "../src/reporting.js";
import { composeControlledResearchClosure } from "../src/server/controlled-composition.js";
import { materializeControlledProtocolInput, runControlledProtocolKernel } from "../src/server.js";
import {
  controlledBaseEvaluation,
  controlledHandle,
  controlledMutationCases,
} from "./controlled.js";
import { buildDocumentBackedResearchFixture, sealResearchDocument } from "./document-fixtures.js";

describe("Reporting kernel", () => {
  it("报告只投影 Manifest 的 material Claim，标题与正文均通过禁止模式扫描", async () => {
    const handle = await controlledHandle();
    const closure = await composeControlledResearchClosure(
      materializeControlledProtocolInput(handle),
    );
    if ("error" in closure) throw new Error(`受控闭包失败：${closure.error}`);
    const evaluation = await controlledBaseEvaluation();
    const artifacts = evaluation.artifact_candidates;
    expect(reportManifestV2PayloadSchema.parse(artifacts.manifest)).toEqual(artifacts.manifest);
    expect(analysisReportV2PayloadSchema.parse(artifacts.report)).toEqual(artifacts.report);
    expect(reportProjectionReceiptPayloadSchema.parse(artifacts.projection_receipt)).toEqual(
      artifacts.projection_receipt,
    );
    expect(artifacts.report?.title).toContain("多步研究分析");
    expect(
      artifacts.report?.sections.flatMap(({ statement_units }) => statement_units).join("\n"),
    ).toContain(closure.claim1.payload.statement);
    expect(artifacts.projection_receipt?.forbidden_claim_mode_scan).toBe("PASS");
  });

  it("Writer 无法通过改标题或删 sections 绕过确定性 Projection", async () => {
    const writerCase = (await controlledMutationCases()).find(
      ({ case_id }) => case_id === "writer-bypass",
    );
    if (!writerCase) throw new Error("writer-bypass fixture 缺失。");
    const result = await runControlledProtocolKernel(writerCase.kernel_input);
    expect(result.kernel_outcome).toEqual({
      kind: "RUNTIME_FAILURE_REQUIRED",
      reason_code: "REPORT_PROJECTION_AUTHORITY_INVALID",
      required_platform_transition: "RUNTIME_FAILURE_TRANSACTION",
      verification_scope: "SYNTHETIC_PLATFORM_BOUNDARY_EXPECTATION",
    });
    expect(result.kernel_trace).toEqual(["OBSERVATION", "COVERAGE", "STOP", "REPORTING"]);
    expect(result.artifact_candidates.report).toBeUndefined();
  });

  it("self-sealed STOP_READY 即使重算自身 hash，也不能进入 ReportManifest", async () => {
    const research = await buildDocumentBackedResearchFixture({ seed: 43_000 });
    const stop = research.stop_document.payload;
    if (stop.artifact_type !== "ResearchStopDecision") {
      throw new Error("Document fixture Stop 类型漂移。");
    }
    const supportedSubset = {
      ...stop.supported_subset,
      claim_refs: [],
      support_decision_refs: [],
      subset_hash: await computeResearchKernelHash("u6-supported-subset@1", {
        supported: [],
        required_disclosures: stop.supported_subset.required_disclosures,
      }),
    };
    const { decision_input_hash: _declaredHash, ...forgedWithoutHash } = {
      ...stop,
      supported_subset: supportedSubset,
    };
    const forgedStopDocument = await sealResearchDocument(
      {
        ...forgedWithoutHash,
        decision_input_hash: await computeResearchKernelHash(
          "u6-stop-decision@1",
          forgedWithoutHash,
        ),
      },
      43_001,
    );
    expect(
      await buildReportManifestCandidate({
        brief_document: research.brief_document,
        stop_decision_resolution: {
          document: forgedStopDocument,
          derivation_input: research.stop_input,
        },
        executive_claim_documents: [],
        supported_finding_claim_documents: [],
        support_decision_documents: [],
        refuted_hypothesis_assessment_documents: [],
        conflict_relation_documents: [],
        limitation_codes: [],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "REPORT_PROJECTION_AUTHORITY_INVALID" },
    });
  });
});
