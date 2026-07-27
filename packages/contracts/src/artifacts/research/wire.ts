import { z } from "zod";
import { canonicalizeJson, deepFreeze, sha256ContentHash } from "../../common/index.js";
import {
  type ArtifactEnvelope,
  type ArtifactReference,
  artifactReferenceIdentity,
  artifactReferenceSchema,
  l2ArtifactEnvelopeSchema,
} from "../envelope.js";
import { l2ArtifactDocumentSchema } from "../l2.js";
import { coverageStatePayloadSchema } from "./coverage.js";
import {
  evidencePlanV2PayloadSchema,
  hypothesisSetV2PayloadSchema,
  researchBriefV2PayloadSchema,
} from "./planning.js";
import { U6_WIRE_LIMITS } from "./primitives.js";
import {
  atomicClaimV2PayloadSchema,
  evidenceCheckReceiptPayloadSchema,
  evidenceRelationV2PayloadSchema,
  hypothesisAssessmentPayloadSchema,
  obligationExecutionDecisionPayloadSchema,
  queryEvidenceV2PayloadSchema,
  supportDecisionPayloadSchema,
} from "./proof.js";
import {
  evidenceGateReceiptPayloadSchema,
  readinessRevocationReceiptPayloadSchema,
  reportReadyCertificateV2PayloadSchema,
} from "./readiness.js";
import {
  analysisReportV2PayloadSchema,
  reportManifestPayloadSchema,
  reportProjectionReceiptPayloadSchema,
} from "./reporting.js";
import { researchStopDecisionPayloadSchema } from "./stop.js";
import { isHistoricalOnlyL2ResearchArtifactType, L2ResearchWireError } from "./versions.js";

const v2PayloadSchemas = new Map<string, z.ZodType>([
  ["ResearchBrief\0" + "2.0.0\0research-brief@2.0.0", researchBriefV2PayloadSchema],
  ["HypothesisSet\0" + "2.0.0\0hypothesis-set@2.0.0", hypothesisSetV2PayloadSchema],
  ["EvidencePlan\0" + "2.0.0\0evidence-plan@2.0.0", evidencePlanV2PayloadSchema],
  [
    "ObligationExecutionDecision\0" + "1.0.0\0obligation-execution@1.0.0",
    obligationExecutionDecisionPayloadSchema,
  ],
  ["QueryEvidence\0" + "2.0.0\0query-evidence@2.0.0", queryEvidenceV2PayloadSchema],
  ["AtomicClaim\0" + "2.0.0\0atomic-claim@2.0.0", atomicClaimV2PayloadSchema],
  ["EvidenceRelation\0" + "2.0.0\0evidence-relation@2.0.0", evidenceRelationV2PayloadSchema],
  ["EvidenceCheckReceipt\0" + "1.0.0\0evidence-check@1.0.0", evidenceCheckReceiptPayloadSchema],
  ["SupportDecision\0" + "1.0.0\0support-decision@1.0.0", supportDecisionPayloadSchema],
  [
    "HypothesisAssessment\0" + "1.0.0\0hypothesis-assessment@1.0.0",
    hypothesisAssessmentPayloadSchema,
  ],
  ["CoverageState\0" + "1.0.0\0coverage-state@1.0.0", coverageStatePayloadSchema],
  ["ResearchStopDecision\0" + "1.0.0\0research-stop@1.0.0", researchStopDecisionPayloadSchema],
  ["ReportManifest\0" + "1.0.0\0report-manifest@1.0.0", reportManifestPayloadSchema],
  ["AnalysisReport\0" + "2.0.0\0analysis-report@2.0.0", analysisReportV2PayloadSchema],
  [
    "ReportProjectionReceipt\0" + "1.0.0\0report-projection@1.0.0",
    reportProjectionReceiptPayloadSchema,
  ],
  ["EvidenceGateReceipt\0" + "1.0.0\0evidence-gate@1.0.0", evidenceGateReceiptPayloadSchema],
  ["ReportReadyCertificate\0" + "2.0.0\0report-ready@2.0.0", reportReadyCertificateV2PayloadSchema],
  [
    "ReadinessRevocationReceipt\0" + "1.0.0\0readiness-revocation@1.0.0",
    readinessRevocationReceiptPayloadSchema,
  ],
]);

export const L2_RESEARCH_WIRE_VERSION_MATRIX = Object.freeze([
  ["ResearchBrief", "2.0.0", "research-brief@2.0.0"],
  ["HypothesisSet", "2.0.0", "hypothesis-set@2.0.0"],
  ["EvidencePlan", "2.0.0", "evidence-plan@2.0.0"],
  ["ObligationExecutionDecision", "1.0.0", "obligation-execution@1.0.0"],
  ["QueryEvidence", "2.0.0", "query-evidence@2.0.0"],
  ["AtomicClaim", "2.0.0", "atomic-claim@2.0.0"],
  ["EvidenceRelation", "2.0.0", "evidence-relation@2.0.0"],
  ["EvidenceCheckReceipt", "1.0.0", "evidence-check@1.0.0"],
  ["SupportDecision", "1.0.0", "support-decision@1.0.0"],
  ["HypothesisAssessment", "1.0.0", "hypothesis-assessment@1.0.0"],
  ["CoverageState", "1.0.0", "coverage-state@1.0.0"],
  ["ResearchStopDecision", "1.0.0", "research-stop@1.0.0"],
  ["ReportManifest", "1.0.0", "report-manifest@1.0.0"],
  ["AnalysisReport", "2.0.0", "analysis-report@2.0.0"],
  ["ReportProjectionReceipt", "1.0.0", "report-projection@1.0.0"],
  ["EvidenceGateReceipt", "1.0.0", "evidence-gate@1.0.0"],
  ["ReportReadyCertificate", "2.0.0", "report-ready@2.0.0"],
  ["ReadinessRevocationReceipt", "1.0.0", "readiness-revocation@1.0.0"],
] as const);

type V2ResearchPayload =
  | z.infer<typeof researchBriefV2PayloadSchema>
  | z.infer<typeof hypothesisSetV2PayloadSchema>
  | z.infer<typeof evidencePlanV2PayloadSchema>
  | z.infer<typeof obligationExecutionDecisionPayloadSchema>
  | z.infer<typeof queryEvidenceV2PayloadSchema>
  | z.infer<typeof atomicClaimV2PayloadSchema>
  | z.infer<typeof evidenceRelationV2PayloadSchema>
  | z.infer<typeof evidenceCheckReceiptPayloadSchema>
  | z.infer<typeof supportDecisionPayloadSchema>
  | z.infer<typeof hypothesisAssessmentPayloadSchema>
  | z.infer<typeof coverageStatePayloadSchema>
  | z.infer<typeof researchStopDecisionPayloadSchema>
  | z.infer<typeof reportManifestPayloadSchema>
  | z.infer<typeof analysisReportV2PayloadSchema>
  | z.infer<typeof reportProjectionReceiptPayloadSchema>
  | z.infer<typeof evidenceGateReceiptPayloadSchema>
  | z.infer<typeof reportReadyCertificateV2PayloadSchema>
  | z.infer<typeof readinessRevocationReceiptPayloadSchema>;

export type L2ResearchDocumentCandidate = {
  envelope: ArtifactEnvelope;
  payload: V2ResearchPayload;
};

export type HistoricalL2ResearchDocument = {
  authority: "HISTORICAL_READ_ONLY";
  can_authorize_current: false;
  document: z.infer<typeof l2ArtifactDocumentSchema>;
};

function registryKey(
  artifactType: string,
  envelopeSchemaVersion: string,
  payloadProtocolVersion: string | null,
): string {
  return `${artifactType}\0${envelopeSchemaVersion}\0${payloadProtocolVersion ?? ""}`;
}

function protocolVersionOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const value = Reflect.get(payload, "protocol_version");
  return typeof value === "string" ? value : null;
}

export function parseL2ResearchPayloadForEnvelopeCandidate(
  envelopeInput: unknown,
  payloadInput: unknown,
): V2ResearchPayload {
  const envelope = l2ArtifactEnvelopeSchema.parse(envelopeInput);
  const key = registryKey(
    envelope.artifact_type,
    envelope.schema_version,
    protocolVersionOf(payloadInput),
  );
  const schema = v2PayloadSchemas.get(key);
  if (!schema) {
    throw new L2ResearchWireError(
      "L2_WIRE_VERSION_WRITE_UNSUPPORTED",
      `L2_WIRE_VERSION_WRITE_UNSUPPORTED：未注册或不可写的 Research Wire 元组 ${key}。`,
    );
  }
  const payload = schema.parse(payloadInput) as V2ResearchPayload;
  if (payload.artifact_type !== envelope.artifact_type) {
    throw new L2ResearchWireError(
      "L2_WIRE_VERSION_WRITE_UNSUPPORTED",
      "L2_WIRE_VERSION_WRITE_UNSUPPORTED：Envelope 与 Payload Artifact Type 不匹配。",
    );
  }
  return payload;
}

function collectArtifactReferences(
  value: unknown,
  references: Map<string, ArtifactReference>,
): void {
  const parsedReference = artifactReferenceSchema.safeParse(value);
  if (parsedReference.success) {
    references.set(artifactReferenceIdentity(parsedReference.data), parsedReference.data);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectArtifactReferences(entry, references);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const fieldValue of Object.values(value)) {
      collectArtifactReferences(fieldValue, references);
    }
  }
}

function assertReferenceClosure(envelope: ArtifactEnvelope, payload: V2ResearchPayload): void {
  const referenced = new Map<string, ArtifactReference>();
  collectArtifactReferences(payload, referenced);
  if (
    referenced.size > U6_WIRE_LIMITS.max_artifact_input_refs ||
    envelope.input_refs.length > U6_WIRE_LIMITS.max_artifact_input_refs
  ) {
    throw new L2ResearchWireError(
      "L2_WIRE_REFERENCE_CLOSURE_INVALID",
      "L2_WIRE_REFERENCE_CLOSURE_INVALID：Artifact Reference 数量超过上限。",
    );
  }
  for (const reference of referenced.values()) {
    if (
      reference.app_id !== envelope.app_id ||
      reference.tenant_id !== envelope.tenant_id ||
      reference.environment !== envelope.environment ||
      reference.run_id !== envelope.run_id
    ) {
      throw new L2ResearchWireError(
        "L2_WIRE_REFERENCE_CLOSURE_INVALID",
        "L2_WIRE_REFERENCE_CLOSURE_INVALID：Payload Reference 与 Envelope Scope/Run 不一致。",
      );
    }
  }
  const declared = new Set(envelope.input_refs.map(artifactReferenceIdentity));
  if (
    declared.size !== envelope.input_refs.length ||
    declared.size !== referenced.size ||
    [...referenced.keys()].some((identity) => !declared.has(identity))
  ) {
    throw new L2ResearchWireError(
      "L2_WIRE_REFERENCE_CLOSURE_INVALID",
      "L2_WIRE_REFERENCE_CLOSURE_INVALID：Envelope input_refs 必须严格等于 Payload Reference 闭包。",
    );
  }
}

export function parseL2ResearchDocumentCandidate(input: unknown): L2ResearchDocumentCandidate {
  const documentShape = z
    .strictObject({
      envelope: l2ArtifactEnvelopeSchema,
      payload: z.unknown(),
    })
    .parse(input);
  const payload = parseL2ResearchPayloadForEnvelopeCandidate(
    documentShape.envelope,
    documentShape.payload,
  );
  assertReferenceClosure(documentShape.envelope, payload);
  if (
    new TextEncoder().encode(canonicalizeJson({ envelope: documentShape.envelope, payload }))
      .byteLength > U6_WIRE_LIMITS.max_artifact_bytes
  ) {
    throw new L2ResearchWireError(
      "L2_WIRE_ARTIFACT_TOO_LARGE",
      "L2_WIRE_ARTIFACT_TOO_LARGE：Research Artifact 超过 1 MiB。",
    );
  }
  return {
    envelope: documentShape.envelope,
    payload,
  };
}

export function readHistoricalL2ResearchDocument(input: unknown): HistoricalL2ResearchDocument {
  const document = l2ArtifactDocumentSchema.parse(input);
  if (
    document.envelope.schema_version !== "1.0.0" ||
    !isHistoricalOnlyL2ResearchArtifactType(document.payload.artifact_type) ||
    protocolVersionOf(document.payload) !== null
  ) {
    throw new L2ResearchWireError(
      "L2_WIRE_VERSION_WRITE_UNSUPPORTED",
      "L2_WIRE_VERSION_WRITE_UNSUPPORTED：readHistorical 只接受已登记的 V1 Research Artifact。",
    );
  }
  return deepFreeze({
    authority: "HISTORICAL_READ_ONLY",
    can_authorize_current: false,
    document,
  });
}

function envelopeContentHashMaterial(document: L2ResearchDocumentCandidate) {
  const {
    content_hash: _contentHash,
    created_at: _createdAt,
    status: _status,
    ...versionedEnvelope
  } = document.envelope;
  return {
    envelope: versionedEnvelope,
    payload: document.payload,
  };
}

export async function computeL2ResearchEnvelopeContentHash(
  input: unknown,
): Promise<`sha256:${string}`> {
  const document = parseL2ResearchDocumentCandidate(input);
  return sha256ContentHash(envelopeContentHashMaterial(document));
}

type L2ResearchSemanticPayload =
  | z.infer<typeof obligationExecutionDecisionPayloadSchema>
  | z.infer<typeof reportReadyCertificateV2PayloadSchema>
  | z.infer<typeof readinessRevocationReceiptPayloadSchema>;

function compareCanonicalIdentity(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseL2ResearchSemanticPayload(input: unknown): L2ResearchSemanticPayload {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new L2ResearchWireError(
      "L2_WIRE_VERSION_WRITE_UNSUPPORTED",
      "L2_WIRE_VERSION_WRITE_UNSUPPORTED：领域 Semantic Hash 只接受已登记的语义决策 Payload。",
    );
  }
  switch (Reflect.get(input, "artifact_type")) {
    case "ObligationExecutionDecision":
      return obligationExecutionDecisionPayloadSchema.parse(input);
    case "ReportReadyCertificate":
      return reportReadyCertificateV2PayloadSchema.parse(input);
    case "ReadinessRevocationReceipt":
      return readinessRevocationReceiptPayloadSchema.parse(input);
    default:
      throw new L2ResearchWireError(
        "L2_WIRE_VERSION_WRITE_UNSUPPORTED",
        "L2_WIRE_VERSION_WRITE_UNSUPPORTED：该 Research Payload 没有冻结的 Domain Semantic Hash 字段。",
      );
  }
}

function semanticHashMaterial(payload: L2ResearchSemanticPayload) {
  switch (payload.artifact_type) {
    case "ObligationExecutionDecision": {
      const { decision_semantic_hash: _declaredHash, ...material } = payload;
      return {
        ...material,
        reason_codes: [...material.reason_codes].sort(compareCanonicalIdentity),
      };
    }
    case "ReportReadyCertificate": {
      const { certificate_semantic_hash: _declaredHash, ...material } = payload;
      return {
        ...material,
        material_support_decision_refs: [...material.material_support_decision_refs].sort(
          (left, right) =>
            compareCanonicalIdentity(
              artifactReferenceIdentity(left),
              artifactReferenceIdentity(right),
            ),
        ),
      };
    }
    case "ReadinessRevocationReceipt": {
      const { revocation_semantic_hash: _declaredHash, ...material } = payload;
      return material;
    }
  }
}

export async function computeL2ResearchSemanticHash(
  payloadInput: unknown,
): Promise<`sha256:${string}`> {
  return sha256ContentHash(semanticHashMaterial(parseL2ResearchSemanticPayload(payloadInput)));
}

export async function computeL2ResearchInputHash(input: unknown): Promise<`sha256:${string}`> {
  return sha256ContentHash({
    hash_domain: "u6-l2-domain-input@1.0.0",
    input: z.json().parse(input),
  });
}
