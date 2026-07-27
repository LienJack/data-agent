import { z } from "zod";
import { artifactReferenceIdentity } from "../envelope.js";
import {
  addUniqueIssues,
  contentHashSchema,
  nonEmptyTextSchema,
  U6_WIRE_LIMITS,
  uniqueIdentifierArraySchema,
  uniqueReasonCodeArraySchema,
  versionIdentifierSchema,
} from "./primitives.js";
import {
  analysisReportRefSchema,
  atomicClaimRefSchema,
  evidenceRelationRefSchema,
  hypothesisAssessmentRefSchema,
  reportManifestRefSchema,
  researchBriefRefSchema,
  researchStopDecisionRefSchema,
} from "./references.js";

const uniqueArtifactReferences = <T extends z.ZodType>(schema: T, min: number, max: number) =>
  z
    .array(schema)
    .min(min)
    .max(max)
    .superRefine((values, ctx) => {
      addUniqueIssues(
        values,
        (value) => artifactReferenceIdentity(value as never),
        ctx,
        [],
        "Artifact Reference 必须唯一。",
      );
    });

export const REPORT_SECTION_IDS = [
  "EXECUTIVE_SUMMARY",
  "SUPPORTED_FINDINGS",
  "REFUTED_HYPOTHESES",
  "CONFLICTS",
  "LIMITATIONS",
  "METHOD",
] as const;
export const reportSectionIdSchema = z.enum(REPORT_SECTION_IDS);

export const reportManifestSectionSchema = z.strictObject({
  section_id: reportSectionIdSchema,
  claim_refs: uniqueArtifactReferences(atomicClaimRefSchema, 0, U6_WIRE_LIMITS.max_obligations),
  hypothesis_assessment_refs: uniqueArtifactReferences(
    hypothesisAssessmentRefSchema,
    0,
    U6_WIRE_LIMITS.max_hypotheses,
  ),
  conflict_refs: uniqueArtifactReferences(evidenceRelationRefSchema, 0, 64),
  limitation_codes: uniqueIdentifierArraySchema(0, U6_WIRE_LIMITS.max_required_disclosures),
});

function createReportManifestPayloadSchema<const ProtocolVersion extends string>(
  protocolVersion: ProtocolVersion,
  minimumMaterialClaims: 0 | 1,
  allowRefutedOnly: boolean,
) {
  return z
    .strictObject({
      artifact_type: z.literal("ReportManifest"),
      protocol_version: z.literal(protocolVersion),
      brief_ref: researchBriefRefSchema,
      stop_decision_ref: researchStopDecisionRefSchema,
      sections: z.array(reportManifestSectionSchema).min(1).max(REPORT_SECTION_IDS.length),
      material_claim_refs: uniqueArtifactReferences(
        atomicClaimRefSchema,
        minimumMaterialClaims,
        U6_WIRE_LIMITS.max_obligations,
      ),
      required_disclosures: uniqueIdentifierArraySchema(1, U6_WIRE_LIMITS.max_required_disclosures),
      allowed_style_profile: z.literal("ZH_L2_RESEARCH_V1"),
      manifest_hash: contentHashSchema,
    })
    .superRefine((manifest, ctx) => {
      addUniqueIssues(
        manifest.sections,
        ({ section_id }) => section_id,
        ctx,
        ["sections"],
        "Report Section ID 必须唯一。",
      );
      const executive = manifest.sections.find(
        ({ section_id }) => section_id === "EXECUTIVE_SUMMARY",
      );
      const supported = manifest.sections.find(
        ({ section_id }) => section_id === "SUPPORTED_FINDINGS",
      );
      const refuted = manifest.sections.find(
        ({ section_id }) => section_id === "REFUTED_HYPOTHESES",
      );
      if (!executive || !supported) {
        ctx.addIssue({
          code: "custom",
          message: "Manifest 必须同时包含 EXECUTIVE_SUMMARY 与 SUPPORTED_FINDINGS。",
          path: ["sections"],
        });
      } else {
        const expected = [
          ...new Set(
            [...executive.claim_refs, ...supported.claim_refs].map(artifactReferenceIdentity),
          ),
        ].sort();
        const actual = manifest.material_claim_refs.map(artifactReferenceIdentity).sort();
        if (JSON.stringify(expected) !== JSON.stringify(actual)) {
          ctx.addIssue({
            code: "custom",
            message: "material_claim_refs 必须等于两个 Material Section 的 Claim 并集。",
            path: ["material_claim_refs"],
          });
        }
      }
      if (
        allowRefutedOnly &&
        manifest.material_claim_refs.length === 0 &&
        (refuted?.hypothesis_assessment_refs.length ?? 0) === 0
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "Manifest 至少需要 material Claim，或在 REFUTED_HYPOTHESES 中包含非空反证 Assessment。",
          path: ["sections"],
        });
      }
      for (const [index, section] of manifest.sections.entries()) {
        if (
          !["EXECUTIVE_SUMMARY", "SUPPORTED_FINDINGS"].includes(section.section_id) &&
          section.claim_refs.length !== 0
        ) {
          ctx.addIssue({
            code: "custom",
            message: "非 Material Section 不能携带 Claim。",
            path: ["sections", index, "claim_refs"],
          });
        }
        if (
          allowRefutedOnly &&
          section.section_id !== "REFUTED_HYPOTHESES" &&
          section.hypothesis_assessment_refs.length !== 0
        ) {
          ctx.addIssue({
            code: "custom",
            message: "HypothesisAssessment 只能出现在 REFUTED_HYPOTHESES Section。",
            path: ["sections", index, "hypothesis_assessment_refs"],
          });
        }
        if (
          allowRefutedOnly &&
          section.section_id !== "CONFLICTS" &&
          section.conflict_refs.length !== 0
        ) {
          ctx.addIssue({
            code: "custom",
            message: "Evidence conflict 只能出现在 CONFLICTS Section。",
            path: ["sections", index, "conflict_refs"],
          });
        }
      }
    });
}

/**
 * Historical tuple retained with its original non-empty material Claim
 * guarantee. It is read-only in the Research Wire registry.
 */
export const reportManifestV1PayloadSchema = createReportManifestPayloadSchema(
  "report-manifest@1.0.0",
  1,
  false,
);

/**
 * Current tuple. V2 explicitly adds refuted-only material reports.
 */
export const reportManifestV2PayloadSchema = createReportManifestPayloadSchema(
  "report-manifest@2.0.0",
  0,
  true,
);

/**
 * Backward-compatible V1 alias. Current Research code must select V2
 * explicitly so existing consumers do not silently change wire contracts.
 *
 * @deprecated Use an explicit versioned schema.
 */
export const reportManifestPayloadSchema = reportManifestV1PayloadSchema;

export const analysisReportV2PayloadSchema = z
  .strictObject({
    artifact_type: z.literal("AnalysisReport"),
    protocol_version: z.literal("analysis-report@2.0.0"),
    manifest_ref: reportManifestRefSchema,
    title_template_id: z.literal("ZH_L2_RESEARCH_TITLE_V1"),
    title: nonEmptyTextSchema,
    title_hash: contentHashSchema,
    sections: z
      .array(
        z.strictObject({
          section_id: reportSectionIdSchema,
          statement_units: z.array(nonEmptyTextSchema).max(128),
        }),
      )
      .min(1)
      .max(REPORT_SECTION_IDS.length),
    disclosures: uniqueIdentifierArraySchema(1, U6_WIRE_LIMITS.max_required_disclosures),
    projection_hash: contentHashSchema,
  })
  .superRefine((report, ctx) => {
    addUniqueIssues(
      report.sections,
      ({ section_id }) => section_id,
      ctx,
      ["sections"],
      "AnalysisReport Section ID 必须唯一。",
    );
    if (
      report.sections.reduce((total, section) => total + section.statement_units.length, 0) > 128
    ) {
      ctx.addIssue({
        code: "custom",
        message: "AnalysisReport 的 Statement Unit 总数不能超过 128。",
        path: ["sections"],
      });
    }
  });

export const reportProjectionReceiptPayloadSchema = z.strictObject({
  artifact_type: z.literal("ReportProjectionReceipt"),
  protocol_version: z.literal("report-projection@1.0.0"),
  manifest_ref: reportManifestRefSchema,
  report_ref: analysisReportRefSchema,
  manifest_hash: contentHashSchema,
  claim_closure_hash: contentHashSchema,
  title_hash: contentHashSchema,
  rendered_statement_hashes: z.array(contentHashSchema).min(1).max(128),
  projection_hash: contentHashSchema,
  projector_version: versionIdentifierSchema,
  forbidden_claim_mode_scan: z.enum(["PASS", "FAIL"]),
  reason_codes: uniqueReasonCodeArraySchema(),
});

export type ReportSectionId = z.infer<typeof reportSectionIdSchema>;
export type ReportManifestSection = z.infer<typeof reportManifestSectionSchema>;
export type ReportManifestV1Payload = z.infer<typeof reportManifestV1PayloadSchema>;
export type ReportManifestV2Payload = z.infer<typeof reportManifestV2PayloadSchema>;
/** @deprecated Use an explicit versioned payload type. */
export type ReportManifestPayload = ReportManifestV1Payload;
export type AnalysisReportV2Payload = z.infer<typeof analysisReportV2PayloadSchema>;
export type ReportProjectionReceiptPayload = z.infer<typeof reportProjectionReceiptPayloadSchema>;
