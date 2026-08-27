import { describe, expect, it } from "vitest";
import { artifactReferenceIdentity } from "../src/artifacts/envelope.js";
import { sha256ContentHash } from "../src/common/index.js";
import {
  authorityEpochForFalcon24Gate,
  buildFalcon24AcceptanceRunManifest,
  buildFalcon24AcceptanceRunManifestV2,
  buildFalcon24ResolutionTraceGateReceipt,
  buildFalcon24ResolutionTraceUiGateReceipt,
  buildFalcon24ResolutionTraceUiGateReceiptV2,
  buildFalcon24SandboxReclamationReceipt,
  campaignIdForEpoch,
  falcon24GateIdSchema,
  qualificationIdForEpoch,
  verifyFalcon24AcceptanceRunManifest,
  verifyFalcon24AcceptanceRunManifestDocument,
  verifyFalcon24ResolutionTraceGateReceipt,
  verifyFalcon24ResolutionTraceUiGateReceipt,
  verifyFalcon24ResolutionTraceUiGateReceiptDocument,
  verifyFalcon24SandboxReclamationReceipt,
} from "../src/evals/falcon24-acceptance-campaign.js";
import { falcon24AnalysisCaseIdSchema } from "../src/evals/falcon24-agent-analysis.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

function artifactReference(
  artifactType:
    | "AnalysisReport"
    | "ArtifactWorkspaceDocument"
    | "DerivedAnalysisEvidence"
    | "QueryEvidence"
    | "SqlArtifact",
  suffix: number,
) {
  return {
    artifact_id: id(suffix),
    artifact_type: artifactType,
    app_id: id(90),
    tenant_id: id(91),
    environment: "test" as const,
    run_id: id(1),
    revision: 1,
    content_hash: hash(String(suffix % 10)),
  };
}

describe("Falcon24 acceptance campaign contracts", () => {
  it("derives only Q1/C1 identities from canonical authority epochs", () => {
    expect(qualificationIdForEpoch("E2")).toBe("E2-Q1");
    expect(campaignIdForEpoch("E10")).toBe("E10-C1");
    expect(authorityEpochForFalcon24Gate("E10-C1")).toBe("E10");
    expect(falcon24GateIdSchema.parse("E2-Q1")).toBe("E2-Q1");
    for (const invalid of ["E2-Q2", "E2-C2", "E02-Q1", "E2Q1"]) {
      expect(() => falcon24GateIdSchema.parse(invalid)).toThrow();
    }
  });

  it("builds and verifies the exact 30-slot frozen manifest", async () => {
    const runs = falcon24AnalysisCaseIdSchema.options.flatMap((caseId, caseIndex) =>
      (["COLD", "WARM"] as const).flatMap((runVariant, variantIndex) =>
        [1, 2, 3].map((repetition) => ({
          run_id: id(100 + caseIndex * 10 + variantIndex * 3 + repetition),
          case_id: caseId,
          run_variant: runVariant,
          repetition,
        })),
      ),
    );
    const manifest = await buildFalcon24AcceptanceRunManifest({
      schema_version: "falcon24-analysis-run-manifest@2.0.0",
      campaign_id: "E1-C1",
      attempt_id: id(2),
      winning_qualification_attempt_id: id(3),
      authority_baseline_hash: hash("0"),
      source_fingerprint: hash("a"),
      frozen_contract_hash: hash("b"),
      runtime_attestation_hash: hash("d"),
      runs,
    });
    await expect(verifyFalcon24AcceptanceRunManifest(manifest)).resolves.toEqual(manifest);
    await expect(
      verifyFalcon24AcceptanceRunManifest({ ...manifest, attempt_id: id(4) }),
    ).rejects.toThrow("FALCON24_ANALYSIS_RUN_MANIFEST_HASH_INVALID");
    await expect(
      verifyFalcon24AcceptanceRunManifest({ ...manifest, source_fingerprint: hash("c") }),
    ).rejects.toThrow("FALCON24_ANALYSIS_RUN_MANIFEST_HASH_INVALID");
  });

  it("binds the v2 campaign manifest to the exact derived epoch gate", async () => {
    const runs = falcon24AnalysisCaseIdSchema.options.flatMap((caseId, caseIndex) =>
      (["COLD", "WARM"] as const).flatMap((runVariant, variantIndex) =>
        [1, 2, 3].map((repetition) => ({
          run_id: id(300 + caseIndex * 10 + variantIndex * 3 + repetition),
          case_id: caseId,
          run_variant: runVariant,
          repetition,
        })),
      ),
    );
    const material = {
      schema_version: "falcon24-analysis-run-manifest@3.0.0",
      authority_epoch: "E2",
      campaign_id: "E2-C1",
      attempt_id: id(200),
      winning_qualification_attempt_id: id(201),
      authority_baseline_hash: hash("0"),
      source_fingerprint: hash("a"),
      frozen_contract_hash: hash("b"),
      runtime_attestation_hash: hash("d"),
      runs,
    };
    const manifest = await buildFalcon24AcceptanceRunManifestV2(material);

    await expect(verifyFalcon24AcceptanceRunManifestDocument(manifest)).resolves.toEqual(manifest);
    await expect(
      buildFalcon24AcceptanceRunManifestV2({ ...material, campaign_id: "E1-C1" }),
    ).rejects.toThrow("authority_epoch");
    await expect(
      buildFalcon24AcceptanceRunManifestV2({ ...material, campaign_id: "E2-C2" }),
    ).rejects.toThrow();
  });

  it("hashes the exact zero-residual reclamation receipt", async () => {
    const managementObservationMaterial = {
      management_observation_schema_version:
        "opensandbox-management-reclamation-observation@1.0.0" as const,
      management_operation_id: id(2),
      observation_source: "OPENSANDBOX_MANAGEMENT_API" as const,
      target_metadata_hash: hash("d"),
      before_observation: { active_count: 2, observation_hash: hash("e") },
      killed: 2,
      after_observation: { active_count: 0 as const, observation_hash: hash("f") },
      residual: 0 as const,
      completed_at: "2026-08-26T00:00:00.000Z",
    };
    const managementObservation = {
      ...managementObservationMaterial,
      management_observation_hash: await sha256ContentHash(managementObservationMaterial),
    };
    const receipt = await buildFalcon24SandboxReclamationReceipt({
      schema_version: "falcon24-sandbox-reclamation-receipt@2.0.0",
      campaign_id: "E1-C1",
      run_id: id(1),
      runtime_attestation_hash: hash("c"),
      ...managementObservation,
    });
    await expect(verifyFalcon24SandboxReclamationReceipt(receipt)).resolves.toEqual(receipt);
    await expect(
      verifyFalcon24SandboxReclamationReceipt({ ...receipt, killed: 3 }),
    ).rejects.toThrow();
    const { receipt_hash: _receiptHash, ...receiptMaterial } = receipt;
    await expect(
      buildFalcon24SandboxReclamationReceipt({
        ...receiptMaterial,
        management_observation_hash: hash("0"),
      }),
    ).rejects.toThrow("FALCON24_SANDBOX_MANAGEMENT_OBSERVATION_HASH_INVALID");
  });

  it("hashes the exact successful Resolution Trace gate closure", async () => {
    const receipt = await buildFalcon24ResolutionTraceGateReceipt({
      schema_version: "falcon24-resolution-trace-gate-receipt@2.0.0",
      campaign_id: "E1-C1",
      run_id: id(1),
      trace_hash: hash("a"),
      node_count: 10,
      edge_count: 9,
      detail_count: 10,
      sql_node_count: 1,
      query_evidence_node_count: 1,
      analysis_evidence_node_count: 1,
      chart_node_count: 1,
      report_node_count: 1,
      detail_closure: Array.from({ length: 10 }, (_, index) => ({
        node_id: `node-${String(index).padStart(2, "0")}`,
        detail_hash: hash(String(index % 10)),
      })),
      verified_at: "2026-08-26T00:00:00.000Z",
    });
    await expect(verifyFalcon24ResolutionTraceGateReceipt(receipt)).resolves.toEqual(receipt);
    await expect(
      verifyFalcon24ResolutionTraceGateReceipt({ ...receipt, chart_node_count: 2 }),
    ).rejects.toThrow("FALCON24_RESOLUTION_TRACE_GATE_RECEIPT_HASH_INVALID");
  });

  it("hashes the browser-observed UI trace closure and rejects incomplete artifact coverage", async () => {
    const references = [
      artifactReference("AnalysisReport", 15),
      artifactReference("ArtifactWorkspaceDocument", 14),
      artifactReference("DerivedAnalysisEvidence", 13),
      artifactReference("QueryEvidence", 12),
      artifactReference("SqlArtifact", 11),
    ].sort((left, right) =>
      artifactReferenceIdentity(left).localeCompare(artifactReferenceIdentity(right)),
    );
    const chartRef = references.find(
      ({ artifact_type: artifactType }) => artifactType === "ArtifactWorkspaceDocument",
    );
    if (!chartRef) throw new Error("chart fixture missing");
    const receipt = await buildFalcon24ResolutionTraceUiGateReceipt({
      schema_version: "falcon24-resolution-trace-ui-gate-receipt@1.0.0",
      campaign_id: "E1-C1",
      run_id: id(1),
      workspace_id: id(91),
      conversation_id: id(92),
      trace_hash: hash("a"),
      web_build: { build_id: hash("b"), generation_id: hash("c") },
      browser_harness_version: "falcon24-agent-browser-trace-gate@1.0.0",
      opened_nodes: [
        { node_id: "node-01", detail_hash: hash("d") },
        { node_id: "node-02", detail_hash: hash("e") },
      ],
      opened_artifact_refs: references,
      chart_ref: chartRef,
      chart_renderer_version: "governed-vchart@1.0.0",
      chart_rendered: true,
      source_table_visible: true,
      error_banner: null,
      dom_snapshot_hash: hash("f"),
      screenshot_hash: hash("0"),
      observed_at: "2026-08-26T00:00:00.000Z",
    });
    await expect(verifyFalcon24ResolutionTraceUiGateReceipt(receipt)).resolves.toEqual(receipt);
    const { receipt_hash: _receiptHash, ...receiptMaterial } = receipt;
    const e2Receipt = await buildFalcon24ResolutionTraceUiGateReceiptV2({
      ...receiptMaterial,
      schema_version: "falcon24-resolution-trace-ui-gate-receipt@2.0.0",
      authority_epoch: "E2",
      campaign_id: "E2-C1",
    });
    await expect(verifyFalcon24ResolutionTraceUiGateReceiptDocument(e2Receipt)).resolves.toEqual(
      e2Receipt,
    );
    await expect(
      buildFalcon24ResolutionTraceUiGateReceiptV2({
        ...receiptMaterial,
        schema_version: "falcon24-resolution-trace-ui-gate-receipt@2.0.0",
        authority_epoch: "E2",
        campaign_id: "E1-C1",
      }),
    ).rejects.toThrow("authority_epoch");
    await expect(
      buildFalcon24ResolutionTraceUiGateReceipt({
        ...receiptMaterial,
        opened_artifact_refs: [
          ...references.slice(0, 4),
          artifactReference("SqlArtifact", 16),
        ].sort((left, right) =>
          artifactReferenceIdentity(left).localeCompare(artifactReferenceIdentity(right)),
        ),
      }),
    ).rejects.toThrow("Falcon24 UI 必须精确打开");
    await expect(
      verifyFalcon24ResolutionTraceUiGateReceipt({ ...receipt, chart_rendered: false }),
    ).rejects.toThrow();
  });
});
