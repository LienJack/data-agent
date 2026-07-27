import { z } from "zod";
import {
  appScopeSchema,
  canonicalizeJson,
  contentHashSchema,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../../common/index.js";
import { artifactReferenceFor, artifactReferenceSchema } from "../envelope.js";
import {
  idempotencyKeySchema,
  nonNegativeIntSchema,
  positiveIntSchema,
  uniqueReasonCodeArraySchema,
} from "./primitives.js";
import {
  analysisReportRefSchema,
  coverageStateRefSchema,
  modelCertificationReceiptRefSchema,
  policyReceiptRefSchema,
  readinessRevocationReceiptRefSchema,
  reportReadyCertificateRefSchema,
  researchStopDecisionRefSchema,
  schemaSnapshotRefSchema,
  semanticReleaseRefSchema,
} from "./references.js";
import { type L2ResearchDocumentCandidate, parseL2ResearchDocumentCandidate } from "./wire.js";

export const U6_PLATFORM_SCHEMA_VERSION = "1.0.0" as const;
export const U6_DB_RESULT_PROTOCOL_VERSION = "u6-db-result@1.0.0" as const;

const strictResearchCommandBaseShape = {
  schema_version: z.literal(U6_PLATFORM_SCHEMA_VERSION),
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  principal_id: immutableIdSchema,
  idempotency_key: idempotencyKeySchema,
} as const;

export const strictResearchCommandBaseSchema = z.strictObject(strictResearchCommandBaseShape);

export const researchIdentityBindingSchema = z.strictObject({
  principal_id: immutableIdSchema,
  delegation_chain_hash: contentHashSchema,
  authority_epoch: nonNegativeIntSchema,
});

const researchDataSnapshotBindingShape = {
  protocol_version: z.literal("data-snapshot-binding@1.0.0"),
  datasource_id: immutableIdSchema,
  strategy: z.enum(["CONTROLLED_REVISION", "NONE"]),
  snapshot_token: versionIdentifierSchema.nullable(),
  schema_manifest_hash: contentHashSchema.nullable(),
  data_manifest_hash: contentHashSchema.nullable(),
  fixture_manifest_hash: contentHashSchema.nullable(),
  replay_state: z.enum(["REPLAYABLE", "REPLAY_UNAVAILABLE"]),
} as const;

const researchDataSnapshotBindingDraftObjectSchema = z.strictObject(
  researchDataSnapshotBindingShape,
);

type ResearchDataSnapshotFacts = z.infer<typeof researchDataSnapshotBindingDraftObjectSchema>;

function validateResearchDataSnapshotFacts(
  binding: ResearchDataSnapshotFacts,
  ctx: z.RefinementCtx,
): void {
  const revisionFields = [
    binding.snapshot_token,
    binding.schema_manifest_hash,
    binding.data_manifest_hash,
    binding.fixture_manifest_hash,
  ];
  if (
    binding.strategy === "CONTROLLED_REVISION" &&
    (binding.replay_state !== "REPLAYABLE" || revisionFields.some((value) => value === null))
  ) {
    ctx.addIssue({
      code: "custom",
      message: "CONTROLLED_REVISION 必须提供全部 Manifest、Snapshot Token 且可重放。",
    });
  }
  if (
    binding.strategy === "NONE" &&
    (binding.replay_state !== "REPLAY_UNAVAILABLE" ||
      revisionFields.some((value) => value !== null))
  ) {
    ctx.addIssue({
      code: "custom",
      message: "NONE 必须清空全部 Revision 字段且标记为不可重放。",
    });
  }
}

export const researchDataSnapshotBindingDraftSchema =
  researchDataSnapshotBindingDraftObjectSchema.superRefine(validateResearchDataSnapshotFacts);

export const researchDataSnapshotBindingSchema = z
  .strictObject({
    ...researchDataSnapshotBindingShape,
    binding_hash: contentHashSchema,
  })
  .superRefine(validateResearchDataSnapshotFacts);

export const researchFrontierValueSchema = z.discriminatedUnion("frontier_kind", [
  z.strictObject({
    frontier_kind: z.literal("SEMANTIC"),
    reference: semanticReleaseRefSchema,
  }),
  z.strictObject({
    frontier_kind: z.literal("SCHEMA"),
    reference: schemaSnapshotRefSchema,
  }),
  z.strictObject({
    frontier_kind: z.literal("DATA"),
    data_snapshot: researchDataSnapshotBindingSchema,
  }),
  z.strictObject({
    frontier_kind: z.literal("POLICY"),
    reference: policyReceiptRefSchema,
  }),
  z.strictObject({
    frontier_kind: z.literal("IDENTITY"),
    identity_binding: researchIdentityBindingSchema,
  }),
]);

async function computeDomainSeparatedHash(
  domain: string,
  value: unknown,
): Promise<`sha256:${string}`> {
  const bytes = new TextEncoder().encode(`${domain}\0${canonicalizeJson(value)}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
  return `sha256:${hex}`;
}

export async function computeDataSnapshotBindingHash(input: unknown): Promise<`sha256:${string}`> {
  const facts = researchDataSnapshotBindingDraftSchema.parse(input);
  return computeDomainSeparatedHash("data-snapshot-binding@1.0.0", facts);
}

export async function verifyResearchDataSnapshotBinding(
  input: unknown,
): Promise<ResearchDataSnapshotBinding> {
  const binding = researchDataSnapshotBindingSchema.parse(input);
  const { binding_hash: reportedHash, ...facts } = binding;
  const expectedHash = await computeDataSnapshotBindingHash(facts);
  if (reportedHash !== expectedHash) {
    throw new TypeError("DataSnapshotBinding binding_hash 与规范内容不匹配。");
  }
  return binding;
}

export async function computeResearchFrontierValueHash(
  input: unknown,
): Promise<`sha256:${string}`> {
  const value = researchFrontierValueSchema.parse(input);
  if (value.frontier_kind === "DATA") {
    await verifyResearchDataSnapshotBinding(value.data_snapshot);
  }
  return computeDomainSeparatedHash("research-frontier-value@1.0.0", value);
}

export const frontierInitializeInputSchema = z.strictObject({
  ...strictResearchCommandBaseShape,
  operation_id: immutableIdSchema,
  value: researchFrontierValueSchema,
  expected_frontier_version: z.null(),
  expected_frontier_hash: z.null(),
});

export const frontierAdvanceInputSchema = z.strictObject({
  ...strictResearchCommandBaseShape,
  operation_id: immutableIdSchema,
  value: researchFrontierValueSchema,
  expected_frontier_version: nonNegativeIntSchema,
  expected_frontier_hash: contentHashSchema,
});

export const committedFrontierSchema = z.strictObject({
  operation_id: immutableIdSchema,
  frontier_kind: z.enum(["SEMANTIC", "SCHEMA", "DATA", "POLICY", "IDENTITY"]),
  frontier_version: nonNegativeIntSchema,
  frontier_value_hash: contentHashSchema,
  event_seq: positiveIntSchema,
  cascaded_revocation_operation_id: immutableIdSchema.nullable(),
  committed_at: timestampSchema,
});

const l2ResearchDocumentCandidateSchema = z.unknown().transform((input, ctx) => {
  try {
    return parseL2ResearchDocumentCandidate(input);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message:
        error instanceof Error
          ? `无效的 current L2 Research Candidate：${error.message}`
          : "无效的 current L2 Research Candidate。",
    });
    return z.NEVER;
  }
});

export const researchArtifactCommitInputSchema = z.strictObject({
  ...strictResearchCommandBaseShape,
  commit_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  worker_fence: positiveIntSchema,
  candidate: l2ResearchDocumentCandidateSchema,
  expected_parent_ref: artifactReferenceSchema.nullable(),
});

export const committedResearchArtifactSchema = z.strictObject({
  reference: artifactReferenceSchema,
  created: z.boolean(),
});

export const publishCurrentInputSchema = z.strictObject({
  ...strictResearchCommandBaseShape,
  publication_id: immutableIdSchema,
  certificate_ref: reportReadyCertificateRefSchema,
  expected_readiness_version: nonNegativeIntSchema.nullable(),
});

const consumeCurrentBaseShape = {
  ...strictResearchCommandBaseShape,
  consumption_id: immutableIdSchema,
  certificate_ref: reportReadyCertificateRefSchema,
} as const;

export const consumeCurrentInputSchema = z.discriminatedUnion("purpose", [
  z.strictObject({
    ...consumeCurrentBaseShape,
    purpose: z.literal("DOMAIN_TERMINAL"),
    terminal_id: immutableIdSchema,
  }),
  z.strictObject({
    ...consumeCurrentBaseShape,
    purpose: z.literal("REPORT_READ"),
    grant_id: immutableIdSchema,
  }),
]);

export const revokeCurrentInputSchema = z.strictObject({
  ...strictResearchCommandBaseShape,
  operation_id: immutableIdSchema,
  certificate_ref: reportReadyCertificateRefSchema,
  observed_frontier_hash: contentHashSchema,
  reason: z.enum(["EVIDENCE_REVOKED", "CERTIFICATE_TAMPERED"]),
});

export const cascadeFrontierRevocationCommandSchema = z.strictObject({
  trigger: z.literal("FRONTIER_ADVANCE"),
  source_operation_id: immutableIdSchema,
  reason: z.enum([
    "SEMANTIC_REVISION_CHANGED",
    "SCHEMA_REVISION_CHANGED",
    "DATA_SNAPSHOT_STALE",
    "POLICY_CHANGED",
    "IDENTITY_AUTHORITY_CHANGED",
  ]),
});

export const commitResearchStopTerminalInputSchema = z.strictObject({
  ...strictResearchCommandBaseShape,
  commit_id: immutableIdSchema,
  terminal_id: immutableIdSchema,
  stop_decision_ref: researchStopDecisionRefSchema,
  coverage_ref: coverageStateRefSchema,
});

const researchStopTerminalCommonShape = {
  commit_id: immutableIdSchema,
  terminal_id: immutableIdSchema,
  domain_reason_codes: uniqueReasonCodeArraySchema(1),
  authority_kind: z.literal("RESEARCH_STOP"),
  certificate_ref: z.null(),
  revocation_receipt_ref: z.null(),
  stop_decision_ref: researchStopDecisionRefSchema,
  committed_at: timestampSchema,
} as const;

export const committedResearchStopTerminalSchema = z.discriminatedUnion("terminal", [
  z.strictObject({
    ...researchStopTerminalCommonShape,
    terminal: z.literal("PARTIAL"),
    reason_code: z.literal("EVIDENCE_PARTIAL"),
  }),
  z.strictObject({
    ...researchStopTerminalCommonShape,
    terminal: z.literal("NEEDS_MORE_RESEARCH"),
    reason_code: z.literal("EVIDENCE_COVERAGE_INSUFFICIENT"),
  }),
  z.strictObject({
    ...researchStopTerminalCommonShape,
    terminal: z.literal("INCONCLUSIVE"),
    reason_code: z.literal("ANALYSIS_INCONCLUSIVE"),
  }),
]);

export const publishedCurrentReadinessSchema = z.strictObject({
  state: z.literal("CURRENT"),
  certificate_ref: reportReadyCertificateRefSchema,
  report_ref: analysisReportRefSchema,
  readiness_version: nonNegativeIntSchema,
  revocation_seq: nonNegativeIntSchema,
  frontier_hash: contentHashSchema,
});

export const committedReadyResearchTerminalSchema = z.strictObject({
  terminal_id: immutableIdSchema,
  terminal: z.literal("READY"),
  reason_code: z.literal("RUN_READY"),
  domain_reason_codes: uniqueReasonCodeArraySchema(),
  authority_kind: z.literal("CURRENT_READINESS"),
  certificate_ref: reportReadyCertificateRefSchema,
  revocation_receipt_ref: z.null(),
  stop_decision_ref: z.null(),
  committed_at: timestampSchema,
});

export const committedStaleResearchTerminalSchema = z.strictObject({
  terminal_id: immutableIdSchema,
  terminal: z.literal("STALE"),
  reason_code: z.literal("RUN_STALE"),
  domain_reason_codes: uniqueReasonCodeArraySchema(1),
  authority_kind: z.literal("REVOCATION_CONSUMPTION"),
  certificate_ref: z.null(),
  revocation_receipt_ref: readinessRevocationReceiptRefSchema,
  stop_decision_ref: z.null(),
  committed_at: timestampSchema,
});

export const canonicalResponseBindingSchema = z.strictObject({
  protocol_version: z.literal("canonical-response@1.0.0"),
  media_type: z.literal("application/json; charset=utf-8"),
  content_disposition: z.literal("inline"),
  byte_length: nonNegativeIntSchema.max(1_048_576),
  response_digest: contentHashSchema,
});

export const canonicalResponseWireSchema = canonicalResponseBindingSchema
  .extend({
    body_base64url: z
      .string()
      .max(1_398_102)
      .regex(/^[A-Za-z0-9_-]*$/, "必须是无 padding 的 RFC 4648 base64url。"),
  })
  .superRefine((wire, ctx) => {
    if (wire.body_base64url.length % 4 === 1) {
      ctx.addIssue({
        code: "custom",
        message: "base64url 长度不可能表示完整字节序列。",
        path: ["body_base64url"],
      });
    }
  });

export const currentReadinessConsumeResultSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    purpose: z.literal("DOMAIN_TERMINAL"),
    outcome: z.literal("READY_COMMITTED"),
    consumption_id: immutableIdSchema,
    current_state: z.literal("CURRENT"),
    terminal: committedReadyResearchTerminalSchema,
  }),
  z.strictObject({
    purpose: z.literal("DOMAIN_TERMINAL"),
    outcome: z.literal("STALE_COMMITTED"),
    consumption_id: immutableIdSchema,
    current_state: z.literal("REVOKED"),
    terminal: committedStaleResearchTerminalSchema,
  }),
  z.strictObject({
    purpose: z.literal("REPORT_READ"),
    outcome: z.literal("GRANT_ISSUED"),
    consumption_id: immutableIdSchema,
    current_state: z.literal("CURRENT"),
    grant_id: immutableIdSchema,
    state: z.literal("ISSUED"),
    response: canonicalResponseBindingSchema,
  }),
]);

export const committedCurrentRevocationSchema = z.strictObject({
  operation_id: immutableIdSchema,
  state: z.literal("REVOKED"),
  revocation_seq: positiveIntSchema,
  receipt_ref: readinessRevocationReceiptRefSchema,
});

export const consumeReportReadGrantInputSchema = z.strictObject({
  ...strictResearchCommandBaseShape,
  grant_id: immutableIdSchema,
});

export const commitReportReadResponseInputSchema = z.strictObject({
  ...strictResearchCommandBaseShape,
  grant_id: immutableIdSchema,
});

export const expireReportReadGrantInputSchema = z.strictObject({
  ...strictResearchCommandBaseShape,
  operation_id: immutableIdSchema,
  grant_id: immutableIdSchema,
  expected_state: z.enum(["ISSUED", "CONSUMED"]),
  reason_code: z.literal("REPORT_READ_GRANT_TTL_EXPIRED"),
});

export const consumedReportReadGrantSchema = z.strictObject({
  grant_id: immutableIdSchema,
  state: z.literal("CONSUMED"),
  report_ref: analysisReportRefSchema,
  response: canonicalResponseBindingSchema,
  consumed_at: timestampSchema,
});

export const expiredReportReadGrantSchema = z.strictObject({
  operation_id: immutableIdSchema,
  grant_id: immutableIdSchema,
  state: z.literal("EXPIRED"),
  terminal_from_status: z.enum(["ISSUED", "CONSUMED"]),
  expired_at: timestampSchema,
});

export const committedReportReadResponseSchema = z.strictObject({
  grant_id: immutableIdSchema,
  state: z.literal("RESPONDED"),
  response: canonicalResponseWireSchema,
  responded_at: timestampSchema,
});

export const commitCurrentGoInputSchema = z.strictObject({
  ...strictResearchCommandBaseShape,
  decision_id: immutableIdSchema,
  decision: z.literal("GO"),
  certificate_ref: reportReadyCertificateRefSchema,
  release_manifest_ref: artifactReferenceFor("ReleaseManifest"),
  scorecard_refs: z.array(artifactReferenceFor("ScoreCard")),
  benchmark_receipt_refs: z.array(artifactReferenceFor("BenchmarkAdapterReceipt")),
  sandbox_receipt_refs: z.array(artifactReferenceFor("SandboxExecutionReceipt")),
  model_certification_receipt_refs: z.array(modelCertificationReceiptRefSchema),
  signed_outcome_refs: z.array(artifactReferenceSchema),
  release_policy_version: versionIdentifierSchema,
  candidate_input_hash: contentHashSchema,
});

export const committedCurrentGoSchema = z.strictObject({
  decision_id: immutableIdSchema,
  decision: z.literal("GO"),
  certificate_ref: reportReadyCertificateRefSchema,
  readiness_version: nonNegativeIntSchema,
  revocation_seq: nonNegativeIntSchema,
  frontier_hash: contentHashSchema,
  committed_at: timestampSchema,
});

export const U6_ERROR_RETRYABLE = Object.freeze({
  RESEARCH_CAPABILITY_SCOPE_MISMATCH: false,
  RESEARCH_DATABASE_AUTHORITY_REQUIRED: false,
  RESEARCH_DATABASE_CONTRACT_INVALID: false,
  RESEARCH_PERSISTENCE_UNAVAILABLE: true,
  RESEARCH_AUTHORITY_LOCK_CONTENDED: true,
  RESEARCH_FRONTIER_OWNER_MISMATCH: false,
  RESEARCH_FRONTIER_CAS_CONFLICT: true,
  READINESS_REVOCATION_PROPAGATION_FAILED: true,
  L2_WIRE_VERSION_WRITE_UNSUPPORTED: false,
  READINESS_PROTOCOL_VERSION_UNSUPPORTED: false,
  AUTHORITY_EVIDENCE_NOT_CURRENT: false,
  AUTHORITY_EVIDENCE_NOT_COMMITTED: false,
  CURRENT_READY_CONSUMPTION_REQUIRED: false,
  RESEARCH_STOP_TERMINAL_COMMIT_REQUIRED: false,
  READINESS_FRONTIER_INCOMPLETE: false,
  READINESS_FRONTIER_STALE: false,
  READINESS_CAS_CONFLICT: true,
  READINESS_IDEMPOTENCY_CONFLICT: false,
  REPORT_READY_CERTIFICATE_TAMPERED: false,
  REPORT_READ_READY_TERMINAL_REQUIRED: false,
  REPORT_READ_GRANT_NOT_CONSUMABLE: false,
  REPORT_READ_GRANT_EXPIRED: false,
  REPORT_READ_RESPONSE_DIGEST_MISMATCH: false,
  REPORT_READ_GRANT_REVOKED: false,
  EVIDENCE_RELATION_IDENTITY_CONFLICT: false,
  RESEARCH_RESOURCE_RESERVATION_CONFLICT: false,
  RESEARCH_RESOURCE_OUTCOME_UNCONFIRMED: true,
  RESEARCH_RESOURCE_USAGE_NOT_AUTHORITATIVE: false,
  RESEARCH_RESOURCE_LIMIT_EXCEEDED: false,
  RESEARCH_INVOCATION_TRANSITION_CONFLICT: false,
  RESEARCH_INVOCATION_TERMINAL_CONFLICT: false,
  RESEARCH_INVOCATION_LATE_TERMINAL_CLOSED: false,
  RESEARCH_SYSTEM_RECORD_NOT_ACTIVE: false,
  RESEARCH_SYSTEM_RECORD_BINDING_MISMATCH: false,
  RESEARCH_SYSTEM_RECORD_TRANSITION_CONFLICT: false,
  RESEARCH_RESULT_SIZE_EXCEEDED: false,
  RESEARCH_RESULT_DIGEST_MISMATCH: false,
  RESEARCH_RESULT_GOVERNANCE_REJECTED: false,
  RESEARCH_RESULT_TERMINAL_PREPARATION_BUSY: true,
  RESEARCH_RESULT_KEY_ROTATION_CONFLICT: true,
  RESEARCH_RESULT_DECRYPTION_KEY_UNAVAILABLE: false,
  RESEARCH_RESULT_INTEGRITY_FAILURE: false,
  RESEARCH_RESULT_ACCESS_RATE_LIMITED: true,
  REPLAY_SNAPSHOT_UNAVAILABLE: false,
  MODEL_PROVIDER_INVOCATION_NOT_AUTHORIZED: false,
  SQL_INVOCATION_NOT_AUTHORIZED: false,
  TOOL_INVOCATION_NOT_AUTHORIZED: false,
  CURRENT_READINESS_REVOKED: false,
  RESEARCH_READY_TERMINAL_REQUIRED: false,
  CURRENT_RELEASE_COMMIT_REQUIRED: false,
  RESEARCH_AUTHORITY_FENCE_MISMATCH: false,
  RESEARCH_STOP_INPUT_INCONSISTENT: false,
  RESEARCH_STOP_INPUT_STALE: false,
} as const);

const u6PlatformErrorCodeValues = Object.keys(U6_ERROR_RETRYABLE) as U6PlatformErrorCode[];

export const u6PlatformErrorCodeSchema = z.enum(
  u6PlatformErrorCodeValues as [U6PlatformErrorCode, ...U6PlatformErrorCode[]],
);

export const u6PlatformErrorSchema = z
  .strictObject({
    code: u6PlatformErrorCodeSchema,
    retryable: z.boolean(),
  })
  .superRefine((error, ctx) => {
    if (error.retryable !== U6_ERROR_RETRYABLE[error.code]) {
      ctx.addIssue({
        code: "custom",
        message: `${error.code} 的 retryable 必须为 ${U6_ERROR_RETRYABLE[error.code]}。`,
        path: ["retryable"],
      });
    }
  });

export function createU6DbResultSchema<TSchema extends z.ZodType>(valueSchema: TSchema) {
  return z.discriminatedUnion("ok", [
    z.strictObject({
      protocol_version: z.literal(U6_DB_RESULT_PROTOCOL_VERSION),
      ok: z.literal(true),
      value: valueSchema,
    }),
    z.strictObject({
      protocol_version: z.literal(U6_DB_RESULT_PROTOCOL_VERSION),
      ok: z.literal(false),
      error: u6PlatformErrorSchema,
    }),
  ]);
}

export type StrictResearchCommandBase = z.infer<typeof strictResearchCommandBaseSchema>;
export type ResearchIdentityBinding = z.infer<typeof researchIdentityBindingSchema>;
export type ResearchDataSnapshotBindingDraft = z.infer<
  typeof researchDataSnapshotBindingDraftSchema
>;
export type ResearchDataSnapshotBinding = z.infer<typeof researchDataSnapshotBindingSchema>;
export type ResearchFrontierValue = z.infer<typeof researchFrontierValueSchema>;
export type FrontierInitializeInput = z.infer<typeof frontierInitializeInputSchema>;
export type FrontierAdvanceInput = z.infer<typeof frontierAdvanceInputSchema>;
export type CommittedFrontier = z.infer<typeof committedFrontierSchema>;
export type ResearchArtifactCommitInput = Omit<
  z.infer<typeof researchArtifactCommitInputSchema>,
  "candidate"
> & {
  readonly candidate: L2ResearchDocumentCandidate;
};
export type CommittedResearchArtifact = z.infer<typeof committedResearchArtifactSchema>;
export type PublishCurrentInput = z.infer<typeof publishCurrentInputSchema>;
export type ConsumeCurrentInput = z.infer<typeof consumeCurrentInputSchema>;
export type RevokeCurrentInput = z.infer<typeof revokeCurrentInputSchema>;
export type CascadeFrontierRevocationCommand = z.infer<
  typeof cascadeFrontierRevocationCommandSchema
>;
export type CommitResearchStopTerminalInput = z.infer<typeof commitResearchStopTerminalInputSchema>;
export type CommittedResearchStopTerminal = z.infer<typeof committedResearchStopTerminalSchema>;
export type PublishedCurrentReadiness = z.infer<typeof publishedCurrentReadinessSchema>;
export type CommittedReadyResearchTerminal = z.infer<typeof committedReadyResearchTerminalSchema>;
export type CommittedStaleResearchTerminal = z.infer<typeof committedStaleResearchTerminalSchema>;
export type CanonicalResponseBinding = z.infer<typeof canonicalResponseBindingSchema>;
export type CanonicalResponseWire = z.infer<typeof canonicalResponseWireSchema>;
export type CurrentReadinessConsumeResult = z.infer<typeof currentReadinessConsumeResultSchema>;
export type CommittedCurrentRevocation = z.infer<typeof committedCurrentRevocationSchema>;
export type ConsumeReportReadGrantInput = z.infer<typeof consumeReportReadGrantInputSchema>;
export type CommitReportReadResponseInput = z.infer<typeof commitReportReadResponseInputSchema>;
export type ExpireReportReadGrantInput = z.infer<typeof expireReportReadGrantInputSchema>;
export type ConsumedReportReadGrant = z.infer<typeof consumedReportReadGrantSchema>;
export type ExpiredReportReadGrant = z.infer<typeof expiredReportReadGrantSchema>;
export type CommittedReportReadResponse = z.infer<typeof committedReportReadResponseSchema>;
export type CommitCurrentGoInput = z.infer<typeof commitCurrentGoInputSchema>;
export type CommittedCurrentGo = z.infer<typeof committedCurrentGoSchema>;
export type U6PlatformErrorCode = keyof typeof U6_ERROR_RETRYABLE;
export type U6PlatformError = {
  [K in U6PlatformErrorCode]: {
    readonly code: K;
    readonly retryable: (typeof U6_ERROR_RETRYABLE)[K];
  };
}[U6PlatformErrorCode];
export type U6DbResult<T> =
  | {
      readonly protocol_version: typeof U6_DB_RESULT_PROTOCOL_VERSION;
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly protocol_version: typeof U6_DB_RESULT_PROTOCOL_VERSION;
      readonly ok: false;
      readonly error: U6PlatformError;
    };
