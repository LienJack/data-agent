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
import {
  analysisCompletionReceiptPayloadSchema,
  analysisProgramPayloadSchema,
  atomicClaimV3PayloadSchema,
  dataProfilePayloadSchema,
  derivedAnalysisEvidencePayloadSchema,
  evidenceRelationV3PayloadSchema,
  researchBriefV3PayloadSchema,
} from "./analysis.js";
import { coverageStatePayloadSchema } from "./coverage.js";
import {
  coverageStatePayloadV2Schema,
  researchStopDecisionPayloadV2Schema,
} from "./derivation-wire.js";
import {
  evidencePlanV2PayloadSchema,
  hypothesisSetV2PayloadSchema,
  researchBriefV2PayloadSchema,
} from "./planning.js";
import { U6_WIRE_LIMITS } from "./primitives.js";
import {
  atomicClaimV2PayloadSchema,
  evidenceCheckReceiptPayloadSchema,
  evidenceCheckReceiptV2PayloadSchema,
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
  reportReadyCertificateV3PayloadSchema,
} from "./readiness.js";
import {
  analysisReportV2PayloadSchema,
  analysisReportV3PayloadSchema,
  reportManifestV1PayloadSchema,
  reportManifestV2PayloadSchema,
  reportManifestV3PayloadSchema,
  reportProjectionReceiptPayloadSchema,
} from "./reporting.js";
import { researchStopDecisionPayloadSchema } from "./stop.js";
import { isHistoricalOnlyL2ResearchArtifactType, L2ResearchWireError } from "./versions.js";

const writableVersionedPayloadSchemas = new Map<string, z.ZodType>([
  ["ResearchBrief\0" + "2.0.0\0research-brief@2.0.0", researchBriefV2PayloadSchema],
  ["ResearchBrief\0" + "3.0.0\0research-brief@3.0.0", researchBriefV3PayloadSchema],
  ["HypothesisSet\0" + "2.0.0\0hypothesis-set@2.0.0", hypothesisSetV2PayloadSchema],
  ["EvidencePlan\0" + "2.0.0\0evidence-plan@2.0.0", evidencePlanV2PayloadSchema],
  [
    "ObligationExecutionDecision\0" + "2.0.0\0obligation-execution@2.0.0",
    obligationExecutionDecisionPayloadSchema,
  ],
  ["QueryEvidence\0" + "2.0.0\0query-evidence@2.0.0", queryEvidenceV2PayloadSchema],
  ["DataProfile\0" + "1.0.0\0data-profile@1.0.0", dataProfilePayloadSchema],
  ["AnalysisProgram\0" + "1.0.0\0analysis-program@1.0.0", analysisProgramPayloadSchema],
  [
    "DerivedAnalysisEvidence\0" + "1.0.0\0derived-analysis-evidence@1.0.0",
    derivedAnalysisEvidencePayloadSchema,
  ],
  [
    "AnalysisCompletionReceipt\0" + "1.0.0\0analysis-completion@1.0.0",
    analysisCompletionReceiptPayloadSchema,
  ],
  ["AtomicClaim\0" + "2.0.0\0atomic-claim@2.0.0", atomicClaimV2PayloadSchema],
  ["AtomicClaim\0" + "3.0.0\0atomic-claim@3.0.0", atomicClaimV3PayloadSchema],
  ["EvidenceRelation\0" + "2.0.0\0evidence-relation@2.0.0", evidenceRelationV2PayloadSchema],
  ["EvidenceRelation\0" + "3.0.0\0evidence-relation@3.0.0", evidenceRelationV3PayloadSchema],
  ["EvidenceCheckReceipt\0" + "1.0.0\0evidence-check@1.0.0", evidenceCheckReceiptPayloadSchema],
  ["EvidenceCheckReceipt\0" + "2.0.0\0evidence-check@2.0.0", evidenceCheckReceiptV2PayloadSchema],
  ["SupportDecision\0" + "1.0.0\0support-decision@1.0.0", supportDecisionPayloadSchema],
  [
    "HypothesisAssessment\0" + "1.0.0\0hypothesis-assessment@1.0.0",
    hypothesisAssessmentPayloadSchema,
  ],
  ["CoverageState\0" + "1.0.0\0coverage-state@1.0.0", coverageStatePayloadSchema],
  ["CoverageState\0" + "2.0.0\0coverage-state@2.0.0", coverageStatePayloadV2Schema],
  ["ResearchStopDecision\0" + "1.0.0\0research-stop@1.0.0", researchStopDecisionPayloadSchema],
  ["ResearchStopDecision\0" + "2.0.0\0research-stop@2.0.0", researchStopDecisionPayloadV2Schema],
  ["ReportManifest\0" + "2.0.0\0report-manifest@2.0.0", reportManifestV2PayloadSchema],
  ["ReportManifest\0" + "3.0.0\0report-manifest@3.0.0", reportManifestV3PayloadSchema],
  ["AnalysisReport\0" + "2.0.0\0analysis-report@2.0.0", analysisReportV2PayloadSchema],
  ["AnalysisReport\0" + "3.0.0\0analysis-report@3.0.0", analysisReportV3PayloadSchema],
  [
    "ReportProjectionReceipt\0" + "1.0.0\0report-projection@1.0.0",
    reportProjectionReceiptPayloadSchema,
  ],
  ["EvidenceGateReceipt\0" + "1.0.0\0evidence-gate@1.0.0", evidenceGateReceiptPayloadSchema],
  ["ReportReadyCertificate\0" + "3.0.0\0report-ready@3.0.0", reportReadyCertificateV3PayloadSchema],
  [
    "ReadinessRevocationReceipt\0" + "1.0.0\0readiness-revocation@1.0.0",
    readinessRevocationReceiptPayloadSchema,
  ],
]);

const historicalVersionedPayloadSchemas = new Map<string, z.ZodType>([
  ["ReportManifest\0" + "1.0.0\0report-manifest@1.0.0", reportManifestV1PayloadSchema],
  ["ReportReadyCertificate\0" + "2.0.0\0report-ready@2.0.0", reportReadyCertificateV2PayloadSchema],
]);

export const L2_RESEARCH_WIRE_VERSION_MATRIX = Object.freeze([
  ["ResearchBrief", "2.0.0", "research-brief@2.0.0"],
  ["ResearchBrief", "3.0.0", "research-brief@3.0.0"],
  ["HypothesisSet", "2.0.0", "hypothesis-set@2.0.0"],
  ["EvidencePlan", "2.0.0", "evidence-plan@2.0.0"],
  ["ObligationExecutionDecision", "2.0.0", "obligation-execution@2.0.0"],
  ["QueryEvidence", "2.0.0", "query-evidence@2.0.0"],
  ["DataProfile", "1.0.0", "data-profile@1.0.0"],
  ["AnalysisProgram", "1.0.0", "analysis-program@1.0.0"],
  ["DerivedAnalysisEvidence", "1.0.0", "derived-analysis-evidence@1.0.0"],
  ["AnalysisCompletionReceipt", "1.0.0", "analysis-completion@1.0.0"],
  ["AtomicClaim", "2.0.0", "atomic-claim@2.0.0"],
  ["AtomicClaim", "3.0.0", "atomic-claim@3.0.0"],
  ["EvidenceRelation", "2.0.0", "evidence-relation@2.0.0"],
  ["EvidenceRelation", "3.0.0", "evidence-relation@3.0.0"],
  ["EvidenceCheckReceipt", "1.0.0", "evidence-check@1.0.0"],
  ["EvidenceCheckReceipt", "2.0.0", "evidence-check@2.0.0"],
  ["SupportDecision", "1.0.0", "support-decision@1.0.0"],
  ["HypothesisAssessment", "1.0.0", "hypothesis-assessment@1.0.0"],
  ["CoverageState", "1.0.0", "coverage-state@1.0.0"],
  ["CoverageState", "2.0.0", "coverage-state@2.0.0"],
  ["ResearchStopDecision", "1.0.0", "research-stop@1.0.0"],
  ["ResearchStopDecision", "2.0.0", "research-stop@2.0.0"],
  ["ReportManifest", "2.0.0", "report-manifest@2.0.0"],
  ["ReportManifest", "3.0.0", "report-manifest@3.0.0"],
  ["AnalysisReport", "2.0.0", "analysis-report@2.0.0"],
  ["AnalysisReport", "3.0.0", "analysis-report@3.0.0"],
  ["ReportProjectionReceipt", "1.0.0", "report-projection@1.0.0"],
  ["EvidenceGateReceipt", "1.0.0", "evidence-gate@1.0.0"],
  ["ReportReadyCertificate", "3.0.0", "report-ready@3.0.0"],
  ["ReadinessRevocationReceipt", "1.0.0", "readiness-revocation@1.0.0"],
] as const);

/**
 * Temporary writer compatibility while the Research Kernel and C2a
 * DB-owned Budget Snapshot/Receipt path move to the v2 tuples atomically.
 * These tuples must be retired together with that cutover, never silently
 * treated as v2 authority.
 */
export const L2_RESEARCH_TRANSITIONAL_WRITABLE_TUPLES = Object.freeze([
  ["CoverageState", "1.0.0", "coverage-state@1.0.0"],
  ["ResearchStopDecision", "1.0.0", "research-stop@1.0.0"],
] as const);

export const L2_RESEARCH_HISTORICAL_VERSIONED_TUPLES = Object.freeze([
  ["ReportManifest", "1.0.0", "report-manifest@1.0.0"],
  ["ReportReadyCertificate", "2.0.0", "report-ready@2.0.0"],
] as const);

type WritableResearchPayload =
  | z.infer<typeof researchBriefV2PayloadSchema>
  | z.infer<typeof researchBriefV3PayloadSchema>
  | z.infer<typeof hypothesisSetV2PayloadSchema>
  | z.infer<typeof evidencePlanV2PayloadSchema>
  | z.infer<typeof obligationExecutionDecisionPayloadSchema>
  | z.infer<typeof queryEvidenceV2PayloadSchema>
  | z.infer<typeof dataProfilePayloadSchema>
  | z.infer<typeof analysisProgramPayloadSchema>
  | z.infer<typeof derivedAnalysisEvidencePayloadSchema>
  | z.infer<typeof analysisCompletionReceiptPayloadSchema>
  | z.infer<typeof atomicClaimV2PayloadSchema>
  | z.infer<typeof atomicClaimV3PayloadSchema>
  | z.infer<typeof evidenceRelationV2PayloadSchema>
  | z.infer<typeof evidenceRelationV3PayloadSchema>
  | z.infer<typeof evidenceCheckReceiptPayloadSchema>
  | z.infer<typeof evidenceCheckReceiptV2PayloadSchema>
  | z.infer<typeof supportDecisionPayloadSchema>
  | z.infer<typeof hypothesisAssessmentPayloadSchema>
  | z.infer<typeof coverageStatePayloadSchema>
  | z.infer<typeof coverageStatePayloadV2Schema>
  | z.infer<typeof researchStopDecisionPayloadSchema>
  | z.infer<typeof researchStopDecisionPayloadV2Schema>
  | z.infer<typeof reportManifestV2PayloadSchema>
  | z.infer<typeof reportManifestV3PayloadSchema>
  | z.infer<typeof analysisReportV2PayloadSchema>
  | z.infer<typeof analysisReportV3PayloadSchema>
  | z.infer<typeof reportProjectionReceiptPayloadSchema>
  | z.infer<typeof evidenceGateReceiptPayloadSchema>
  | z.infer<typeof reportReadyCertificateV3PayloadSchema>
  | z.infer<typeof readinessRevocationReceiptPayloadSchema>;

type KernelWritableResearchPayload = Exclude<
  WritableResearchPayload,
  {
    protocol_version:
      | "research-brief@3.0.0"
      | "atomic-claim@3.0.0"
      | "evidence-relation@3.0.0"
      | "evidence-check@2.0.0"
      | "report-manifest@3.0.0"
      | "analysis-report@3.0.0";
  }
>;

/** Stable payload surface consumed by the existing V2 Research Kernel. */
export type L2ResearchDocumentCandidate = {
  envelope: ArtifactEnvelope;
  payload: KernelWritableResearchPayload;
};

/** Full registered writer surface, including the deterministic-analysis V3 lane. */
export type VersionedL2ResearchDocumentCandidate = {
  envelope: ArtifactEnvelope;
  payload: WritableResearchPayload;
};

const l2ResearchDocumentShapeSchema = z.strictObject({
  envelope: l2ArtifactEnvelopeSchema,
  payload: z.unknown(),
});

export type HistoricalL2ResearchDocument = {
  authority: "HISTORICAL_READ_ONLY";
  can_authorize_current: false;
  document: z.infer<typeof l2ArtifactDocumentSchema>;
};

type HistoricalVersionedResearchPayload =
  | z.infer<typeof reportManifestV1PayloadSchema>
  | z.infer<typeof reportReadyCertificateV2PayloadSchema>;

export type HistoricalVersionedL2ResearchDocument = {
  readonly authority: "HISTORICAL_READ_ONLY";
  readonly can_authorize_current: false;
  readonly document: {
    readonly envelope: ArtifactEnvelope;
    readonly payload: HistoricalVersionedResearchPayload;
  };
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
  const descriptor = Object.getOwnPropertyDescriptor(payload, "protocol_version");
  const value =
    descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable
      ? descriptor.value
      : undefined;
  return typeof value === "string" ? value : null;
}

const rawWireTextEncoder = new TextEncoder();
const MAX_RAW_CONTAINER_ENTRIES = U6_WIRE_LIMITS.max_artifact_input_refs;

function rawWireBytes(value: string): number {
  return rawWireTextEncoder.encode(value).byteLength;
}

function isRawPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function rawArrayLength(value: object): number | null {
  const descriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !descriptor ||
    !Object.hasOwn(descriptor, "value") ||
    descriptor.enumerable ||
    typeof descriptor.value !== "number" ||
    !Number.isSafeInteger(descriptor.value) ||
    descriptor.value < 0
  ) {
    return null;
  }
  return descriptor.value;
}

function isRawArrayIndex(key: string, length: number): boolean {
  if (!/^(0|[1-9][0-9]*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
}

/**
 * Rejects hostile object graphs before Zod, recursive reference collection, or
 * canonical JSON can traverse them. This is a wire-resource boundary only; the
 * strict schemas and the exact canonical-byte check remain authoritative.
 */
function preflightRawL2ResearchJsonObject(input: unknown, label: string): void {
  try {
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      !isRawPlainObject(input)
    ) {
      throw new L2ResearchWireError(
        "L2_WIRE_VERSION_WRITE_UNSUPPORTED",
        `L2_WIRE_VERSION_WRITE_UNSUPPORTED：${label} 必须是普通 strict object。`,
      );
    }

    type Frame =
      | { readonly phase: "ENTER"; readonly value: unknown; readonly depth: number }
      | { readonly phase: "EXIT"; readonly value: object };
    const states = new WeakMap<object, "VISITING" | "DONE">();
    const stack: Frame[] = [{ phase: "ENTER", value: input, depth: 0 }];
    let objectNodes = 0;
    let observedBytes = 0;

    while (stack.length > 0) {
      const frame = stack.pop();
      if (!frame) break;
      if (frame.phase === "EXIT") {
        states.set(frame.value, "DONE");
        continue;
      }

      const value = frame.value;
      if (typeof value === "string") {
        observedBytes += rawWireBytes(value);
      } else if (typeof value === "number" || typeof value === "boolean") {
        if (typeof value === "number" && !Number.isFinite(value)) {
          throw new L2ResearchWireError(
            "L2_WIRE_REFERENCE_CLOSURE_INVALID",
            "L2_WIRE_REFERENCE_CLOSURE_INVALID：Research Wire 只接受有限 JSON number。",
          );
        }
        observedBytes += rawWireBytes(String(value));
      } else if (value !== null && typeof value === "object") {
        const existing = states.get(value);
        if (existing === "VISITING") {
          throw new L2ResearchWireError(
            "L2_WIRE_REFERENCE_CLOSURE_INVALID",
            "L2_WIRE_REFERENCE_CLOSURE_INVALID：Research Wire 禁止循环对象图。",
          );
        }
        if (existing === "DONE") continue;
        if (frame.depth > U6_WIRE_LIMITS.max_dependency_depth) {
          throw new L2ResearchWireError(
            "L2_WIRE_REFERENCE_CLOSURE_INVALID",
            "L2_WIRE_REFERENCE_CLOSURE_INVALID：Research Wire 嵌套深度超过上限。",
          );
        }
        objectNodes += 1;
        if (objectNodes > U6_WIRE_LIMITS.max_recursive_closure_nodes) {
          throw new L2ResearchWireError(
            "L2_WIRE_REFERENCE_CLOSURE_INVALID",
            "L2_WIRE_REFERENCE_CLOSURE_INVALID：Research Wire 节点数量超过上限。",
          );
        }

        const isArray = Array.isArray(value);
        const prototype = Object.getPrototypeOf(value);
        if (
          (isArray && prototype !== Array.prototype) ||
          (!isArray && prototype !== Object.prototype && prototype !== null)
        ) {
          throw new L2ResearchWireError(
            "L2_WIRE_REFERENCE_CLOSURE_INVALID",
            "L2_WIRE_REFERENCE_CLOSURE_INVALID：Research Wire 只接受 inert Array/plain object。",
          );
        }
        const arrayLength = isArray ? rawArrayLength(value) : null;
        if (isArray && (arrayLength === null || arrayLength > MAX_RAW_CONTAINER_ENTRIES)) {
          throw new L2ResearchWireError(
            "L2_WIRE_REFERENCE_CLOSURE_INVALID",
            "L2_WIRE_REFERENCE_CLOSURE_INVALID：Research Wire 数组长度超过上限或 length 非法。",
          );
        }

        const ownKeys = Reflect.ownKeys(value);
        const entryCount = ownKeys.length - (isArray && ownKeys.includes("length") ? 1 : 0);
        if (
          entryCount > MAX_RAW_CONTAINER_ENTRIES ||
          ownKeys.some((key) => typeof key === "symbol")
        ) {
          throw new L2ResearchWireError(
            "L2_WIRE_REFERENCE_CLOSURE_INVALID",
            "L2_WIRE_REFERENCE_CLOSURE_INVALID：Research Wire 字段数量超过上限或包含 Symbol。",
          );
        }
        states.set(value, "VISITING");
        stack.push({ phase: "EXIT", value });

        for (let index = ownKeys.length - 1; index >= 0; index -= 1) {
          const key = ownKeys[index];
          if (typeof key !== "string" || (isArray && key === "length")) continue;
          if (isArray && !isRawArrayIndex(key, arrayLength ?? 0)) {
            throw new L2ResearchWireError(
              "L2_WIRE_REFERENCE_CLOSURE_INVALID",
              "L2_WIRE_REFERENCE_CLOSURE_INVALID：Research Wire 数组只允许范围内索引。",
            );
          }
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) {
            throw new L2ResearchWireError(
              "L2_WIRE_REFERENCE_CLOSURE_INVALID",
              "L2_WIRE_REFERENCE_CLOSURE_INVALID：Research Wire 只允许 enumerable data property。",
            );
          }
          observedBytes += rawWireBytes(key);
          stack.push({
            phase: "ENTER",
            value: descriptor.value,
            depth: frame.depth + 1,
          });
        }
      } else if (
        typeof value === "function" ||
        typeof value === "symbol" ||
        typeof value === "bigint" ||
        typeof value === "undefined"
      ) {
        throw new L2ResearchWireError(
          "L2_WIRE_REFERENCE_CLOSURE_INVALID",
          "L2_WIRE_REFERENCE_CLOSURE_INVALID：Research Wire 只接受 JSON 值。",
        );
      }

      if (observedBytes > U6_WIRE_LIMITS.max_artifact_bytes) {
        throw new L2ResearchWireError(
          "L2_WIRE_ARTIFACT_TOO_LARGE",
          "L2_WIRE_ARTIFACT_TOO_LARGE：Research Artifact 原始输入超过 1 MiB。",
        );
      }
    }
  } catch (error) {
    if (error instanceof L2ResearchWireError) throw error;
    throw new L2ResearchWireError(
      "L2_WIRE_REFERENCE_CLOSURE_INVALID",
      "L2_WIRE_REFERENCE_CLOSURE_INVALID：Research Wire 不能安全遍历对象。",
    );
  }
}

function parseRegisteredL2ResearchPayloadAfterPreflight(input: unknown): WritableResearchPayload {
  const artifactTypeDescriptor =
    typeof input === "object" && input !== null
      ? Object.getOwnPropertyDescriptor(input, "artifact_type")
      : undefined;
  const artifactType =
    artifactTypeDescriptor &&
    Object.hasOwn(artifactTypeDescriptor, "value") &&
    artifactTypeDescriptor.enumerable
      ? artifactTypeDescriptor.value
      : undefined;
  const protocolVersion = protocolVersionOf(input);
  const matches = [...writableVersionedPayloadSchemas.entries()].filter(([key]) => {
    const [registeredArtifactType, _schemaVersion, registeredProtocolVersion] = key.split("\0");
    return registeredArtifactType === artifactType && registeredProtocolVersion === protocolVersion;
  });
  if (matches.length !== 1) {
    throw new L2ResearchWireError(
      "L2_WIRE_VERSION_WRITE_UNSUPPORTED",
      `L2_WIRE_VERSION_WRITE_UNSUPPORTED：未注册或歧义的 Research Payload 元组 ${String(
        artifactType,
      )}\0${protocolVersion ?? ""}。`,
    );
  }
  const schema = matches[0]?.[1];
  if (!schema) {
    throw new L2ResearchWireError(
      "L2_WIRE_VERSION_WRITE_UNSUPPORTED",
      "L2_WIRE_VERSION_WRITE_UNSUPPORTED：Research Payload Schema 解析失败。",
    );
  }
  return schema.parse(input) as WritableResearchPayload;
}

function parseRegisteredL2ResearchPayload(input: unknown): WritableResearchPayload {
  preflightRawL2ResearchJsonObject(input, "Research Payload");
  return parseRegisteredL2ResearchPayloadAfterPreflight(input);
}

function parseL2ResearchPayloadForEnvelopeAfterPreflight(
  envelope: ArtifactEnvelope,
  payloadInput: unknown,
): WritableResearchPayload {
  const key = registryKey(
    envelope.artifact_type,
    envelope.schema_version,
    protocolVersionOf(payloadInput),
  );
  const schema = writableVersionedPayloadSchemas.get(key);
  if (!schema) {
    throw new L2ResearchWireError(
      "L2_WIRE_VERSION_WRITE_UNSUPPORTED",
      `L2_WIRE_VERSION_WRITE_UNSUPPORTED：未注册或不可写的 Research Wire 元组 ${key}。`,
    );
  }
  const payload = schema.parse(payloadInput) as WritableResearchPayload;
  if (payload.artifact_type !== envelope.artifact_type) {
    throw new L2ResearchWireError(
      "L2_WIRE_VERSION_WRITE_UNSUPPORTED",
      "L2_WIRE_VERSION_WRITE_UNSUPPORTED：Envelope 与 Payload Artifact Type 不匹配。",
    );
  }
  return payload;
}

export function parseL2ResearchPayloadForEnvelopeCandidate(
  envelopeInput: unknown,
  payloadInput: unknown,
): WritableResearchPayload {
  preflightRawL2ResearchJsonObject(envelopeInput, "Research Envelope");
  preflightRawL2ResearchJsonObject(payloadInput, "Research Payload");
  const envelope = l2ArtifactEnvelopeSchema.parse(envelopeInput);
  return parseL2ResearchPayloadForEnvelopeAfterPreflight(envelope, payloadInput);
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

/**
 * Returns the exact Artifact Reference closure of one strict, registered V2
 * Research Payload in stable full-identity order.
 *
 * This is a pure wire helper for constructing and checking Candidate envelopes.
 * It does not seal an Artifact or grant persistence, current-revision,
 * COMMITTED, or authority semantics.
 */
export function collectL2ResearchPayloadArtifactReferences(
  payloadInput: unknown,
): readonly ArtifactReference[] {
  const payload = parseRegisteredL2ResearchPayload(payloadInput);
  const references = new Map<string, ArtifactReference>();
  collectArtifactReferences(payload, references);
  if (references.size > U6_WIRE_LIMITS.max_artifact_input_refs) {
    throw new L2ResearchWireError(
      "L2_WIRE_REFERENCE_CLOSURE_INVALID",
      "L2_WIRE_REFERENCE_CLOSURE_INVALID：Payload Artifact Reference 数量超过上限。",
    );
  }
  return deepFreeze(
    [...references.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([, reference]) => reference),
  );
}

function assertReferenceClosure(
  envelope: ArtifactEnvelope,
  payload: WritableResearchPayload | HistoricalVersionedResearchPayload,
): void {
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

/**
 * Parses only explicitly retired versioned tuples and brands the result as
 * historical read-only. These tuples cannot pass the current Candidate writer
 * registry and cannot authorize current state.
 */
export function readHistoricalVersionedL2ResearchDocument(
  input: unknown,
): HistoricalVersionedL2ResearchDocument {
  preflightRawL2ResearchJsonObject(input, "Historical Versioned Research Document");
  const documentShape = l2ResearchDocumentShapeSchema.parse(input);
  const key = registryKey(
    documentShape.envelope.artifact_type,
    documentShape.envelope.schema_version,
    protocolVersionOf(documentShape.payload),
  );
  const schema = historicalVersionedPayloadSchemas.get(key);
  if (!schema) {
    throw new L2ResearchWireError(
      "L2_WIRE_VERSION_WRITE_UNSUPPORTED",
      `L2_WIRE_VERSION_WRITE_UNSUPPORTED：未登记的历史 Research Wire 元组 ${key}。`,
    );
  }
  const payload = schema.parse(documentShape.payload) as HistoricalVersionedResearchPayload;
  if (payload.artifact_type !== documentShape.envelope.artifact_type) {
    throw new L2ResearchWireError(
      "L2_WIRE_VERSION_WRITE_UNSUPPORTED",
      "L2_WIRE_VERSION_WRITE_UNSUPPORTED：历史 Envelope 与 Payload Artifact Type 不匹配。",
    );
  }
  assertReferenceClosure(documentShape.envelope, payload);
  if (
    rawWireTextEncoder.encode(canonicalizeJson({ envelope: documentShape.envelope, payload }))
      .byteLength > U6_WIRE_LIMITS.max_artifact_bytes
  ) {
    throw new L2ResearchWireError(
      "L2_WIRE_ARTIFACT_TOO_LARGE",
      "L2_WIRE_ARTIFACT_TOO_LARGE：历史 Research Artifact 超过 1 MiB。",
    );
  }
  return deepFreeze({
    authority: "HISTORICAL_READ_ONLY",
    can_authorize_current: false,
    document: {
      envelope: documentShape.envelope,
      payload,
    },
  });
}

export function parseL2ResearchDocumentCandidate<
  const T extends VersionedL2ResearchDocumentCandidate,
>(input: T): T;
export function parseL2ResearchDocumentCandidate(
  input: unknown,
): VersionedL2ResearchDocumentCandidate;
export function parseL2ResearchDocumentCandidate(
  input: unknown,
): VersionedL2ResearchDocumentCandidate {
  preflightRawL2ResearchJsonObject(input, "Research Document");
  const documentShape = l2ResearchDocumentShapeSchema.parse(input);
  const payload = parseL2ResearchPayloadForEnvelopeAfterPreflight(
    documentShape.envelope,
    documentShape.payload,
  );
  assertReferenceClosure(documentShape.envelope, payload);
  if (
    rawWireTextEncoder.encode(canonicalizeJson({ envelope: documentShape.envelope, payload }))
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
  preflightRawL2ResearchJsonObject(input, "Historical Research Document");
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

function envelopeContentHashMaterial(document: VersionedL2ResearchDocumentCandidate) {
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
  return (await parseAndHashL2ResearchDocumentCandidate(input)).content_hash;
}

export async function parseAndHashL2ResearchDocumentCandidate(input: unknown): Promise<{
  readonly document: VersionedL2ResearchDocumentCandidate;
  readonly content_hash: `sha256:${string}`;
}> {
  const document = parseL2ResearchDocumentCandidate(input);
  return {
    document,
    content_hash: await sha256ContentHash(envelopeContentHashMaterial(document)),
  };
}

type L2ResearchSemanticPayload =
  | z.infer<typeof obligationExecutionDecisionPayloadSchema>
  | z.infer<typeof reportReadyCertificateV2PayloadSchema>
  | z.infer<typeof reportReadyCertificateV3PayloadSchema>
  | z.infer<typeof readinessRevocationReceiptPayloadSchema>;

function compareCanonicalIdentity(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseL2ResearchSemanticPayload(input: unknown): L2ResearchSemanticPayload {
  preflightRawL2ResearchJsonObject(input, "Research Semantic Payload");
  const artifactTypeDescriptor =
    typeof input === "object" && input !== null
      ? Object.getOwnPropertyDescriptor(input, "artifact_type")
      : undefined;
  const artifactType =
    artifactTypeDescriptor &&
    Object.hasOwn(artifactTypeDescriptor, "value") &&
    artifactTypeDescriptor.enumerable
      ? artifactTypeDescriptor.value
      : undefined;
  switch (artifactType) {
    case "ObligationExecutionDecision":
      return obligationExecutionDecisionPayloadSchema.parse(input);
    case "ReportReadyCertificate": {
      const protocolVersion = protocolVersionOf(input);
      if (protocolVersion === "report-ready@2.0.0") {
        return reportReadyCertificateV2PayloadSchema.parse(input);
      }
      return reportReadyCertificateV3PayloadSchema.parse(input);
    }
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
