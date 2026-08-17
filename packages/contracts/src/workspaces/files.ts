import { z } from "zod";
import {
  contentHashSchema,
  deepFreeze,
  environmentSchema,
  sha256ContentHash,
} from "../common/index.js";
import {
  canonicalImmutableIdSchema,
  canonicalU2TimestampSchema,
  workspaceScopedAuthoritySchema,
} from "./defaults.js";
import { workspaceIdempotencyKeySchema } from "./identity.js";

const positiveSafeIntegerSchema = z.number().int().positive().safe();
const nonNegativeSafeIntegerSchema = z.number().int().nonnegative().safe();
export const WORKSPACE_FILE_MAX_BYTES = 25 * 1024 * 1024;

export const workspaceFileVisibilitySchema = z.enum(["SESSION", "WORKSPACE"]);
export const workspaceFileStatusSchema = z.enum(["QUARANTINED", "READY", "REJECTED", "DELETED"]);
export const workspaceFileScanVerdictSchema = z.enum([
  "CLEAN",
  "MALICIOUS",
  "CREDENTIAL_MATCH",
  "POLICY_BLOCKED",
  "UNKNOWN",
]);

const originalFilenameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      ![...value].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127 || character === "/" || character === "\\";
      }),
    "文件名不能包含路径或控制字符。",
  )
  .refine((value) => value !== "." && value !== "..", "文件名不能是相对路径。")
  .refine(
    (value) => new TextEncoder().encode(value.normalize("NFC")).byteLength <= 255,
    "文件名 UTF-8 编码不能超过 255 bytes。",
  )
  .transform((value) => value.normalize("NFC"));

export const detectedWorkspaceFileMimeSchema = z
  .string()
  .min(3)
  .max(127)
  .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/);

export const workspaceFileReferenceSchema = z.strictObject({
  file_id: canonicalImmutableIdSchema,
  revision: positiveSafeIntegerSchema,
  revision_hash: contentHashSchema,
});

export const workspaceFileLineageReferenceSchema = workspaceFileReferenceSchema.extend({
  blob_hash: contentHashSchema,
});

export const workspaceFileScanReceiptReferenceSchema = z.strictObject({
  receipt_id: canonicalImmutableIdSchema,
  receipt_hash: contentHashSchema,
  verdict: workspaceFileScanVerdictSchema,
});

export const workspaceFileDeletionReceiptReferenceSchema = z.strictObject({
  receipt_id: canonicalImmutableIdSchema,
  receipt_hash: contentHashSchema,
});

export const storageRetentionPolicyReferenceSchema = z.strictObject({
  policy_id: canonicalImmutableIdSchema,
  policy_revision: positiveSafeIntegerSchema,
  policy_hash: contentHashSchema,
});

export const workspaceFileUploadIntentSchema = z.strictObject({
  schema_version: z.literal("workspace-file-upload-intent@1.0.0"),
  original_filename: originalFilenameSchema,
  visibility: z.literal("SESSION"),
  session_id: canonicalImmutableIdSchema,
  idempotency_key: workspaceIdempotencyKeySchema,
});

export const workspaceFileObservedContentSchema = z.strictObject({
  blob_hash: contentHashSchema,
  byte_size: positiveSafeIntegerSchema.max(WORKSPACE_FILE_MAX_BYTES),
  detected_mime: detectedWorkspaceFileMimeSchema,
  storage_key: z
    .string()
    .min(1)
    .max(512)
    .regex(
      /^workspace-content\/v1\/[0-9a-f-]+\/[0-9a-f-]+\/[A-Za-z0-9._-]+\/[0-9a-f]{2}\/[0-9a-f]{64}$/,
    ),
});

const workspaceFileUploadCommitDraftSchema = z.strictObject({
  schema_version: z.literal("workspace-file-upload-commit@1.0.0"),
  operation_id: canonicalImmutableIdSchema,
  workspace_id: canonicalImmutableIdSchema,
  intent: workspaceFileUploadIntentSchema,
  observed_content: workspaceFileObservedContentSchema,
});

export const workspaceFileUploadCommitCommandSchema = workspaceFileUploadCommitDraftSchema.extend({
  request_hash: contentHashSchema,
});

export async function computeWorkspaceFileUploadRequestHash(input: unknown) {
  return sha256ContentHash(workspaceFileUploadCommitDraftSchema.parse(input));
}

export async function buildWorkspaceFileUploadCommitCommand(input: unknown) {
  const draft = workspaceFileUploadCommitDraftSchema.parse(input);
  return deepFreeze(
    workspaceFileUploadCommitCommandSchema.parse({
      ...draft,
      request_hash: await computeWorkspaceFileUploadRequestHash(draft),
    }),
  );
}

export async function verifyWorkspaceFileUploadCommitCommand(input: unknown) {
  const command = workspaceFileUploadCommitCommandSchema.parse(input);
  const { request_hash: _requestHash, ...draft } = command;
  if ((await computeWorkspaceFileUploadRequestHash(draft)) !== command.request_hash) {
    throw new TypeError("WORKSPACE_FILE_UPLOAD_REQUEST_HASH_MISMATCH");
  }
  return deepFreeze(command);
}

function createWorkspaceFileRevisionCommandSchema<Version extends string>(version: Version) {
  const draft = z.strictObject({
    schema_version: z.literal(version),
    operation_id: canonicalImmutableIdSchema,
    workspace_id: canonicalImmutableIdSchema,
    file_ref: workspaceFileReferenceSchema,
    idempotency_key: workspaceIdempotencyKeySchema,
  });
  return { draft, command: draft.extend({ request_hash: contentHashSchema }) };
}

const promoteSchemas = createWorkspaceFileRevisionCommandSchema("workspace-file-promote@1.0.0");
export const workspaceFilePromoteCommandSchema = promoteSchemas.command;

export async function buildWorkspaceFilePromoteCommand(input: unknown) {
  const draft = promoteSchemas.draft.parse(input);
  return deepFreeze(
    workspaceFilePromoteCommandSchema.parse({
      ...draft,
      request_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyWorkspaceFilePromoteCommand(input: unknown) {
  const command = workspaceFilePromoteCommandSchema.parse(input);
  const { request_hash: _requestHash, ...draft } = command;
  if ((await sha256ContentHash(promoteSchemas.draft.parse(draft))) !== command.request_hash) {
    throw new TypeError("WORKSPACE_FILE_PROMOTE_REQUEST_HASH_MISMATCH");
  }
  return deepFreeze(command);
}

const deleteSchemas = createWorkspaceFileRevisionCommandSchema("workspace-file-delete@1.0.0");
export const workspaceFileDeleteCommandSchema = deleteSchemas.command;

export async function buildWorkspaceFileDeleteCommand(input: unknown) {
  const draft = deleteSchemas.draft.parse(input);
  return deepFreeze(
    workspaceFileDeleteCommandSchema.parse({
      ...draft,
      request_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyWorkspaceFileDeleteCommand(input: unknown) {
  const command = workspaceFileDeleteCommandSchema.parse(input);
  const { request_hash: _requestHash, ...draft } = command;
  if ((await sha256ContentHash(deleteSchemas.draft.parse(draft))) !== command.request_hash) {
    throw new TypeError("WORKSPACE_FILE_DELETE_REQUEST_HASH_MISMATCH");
  }
  return deepFreeze(command);
}

const workspaceFileRevisionDraftSchema = z
  .strictObject({
    schema_version: z.literal("workspace-file-revision@1.0.0"),
    scope: workspaceScopedAuthoritySchema,
    file_id: canonicalImmutableIdSchema,
    revision: positiveSafeIntegerSchema,
    parent_ref: workspaceFileReferenceSchema.nullable(),
    owner_principal_id: canonicalImmutableIdSchema,
    visibility: workspaceFileVisibilitySchema,
    session_id: canonicalImmutableIdSchema.nullable(),
    original_filename: originalFilenameSchema,
    detected_mime: detectedWorkspaceFileMimeSchema,
    byte_size: positiveSafeIntegerSchema.max(WORKSPACE_FILE_MAX_BYTES),
    blob_hash: contentHashSchema,
    status: workspaceFileStatusSchema,
    scan_receipt_ref: workspaceFileScanReceiptReferenceSchema.nullable(),
    deletion_receipt_ref: workspaceFileDeletionReceiptReferenceSchema.nullable(),
    promoted_from_ref: workspaceFileLineageReferenceSchema.nullable(),
    retention_policy_ref: storageRetentionPolicyReferenceSchema,
    created_by_principal_id: canonicalImmutableIdSchema,
    created_at: canonicalU2TimestampSchema,
  })
  .superRefine((revision, context) => {
    if (
      (revision.visibility === "SESSION" && revision.session_id === null) ||
      (revision.visibility === "WORKSPACE" && revision.session_id !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "SESSION 文件必须绑定 session_id；WORKSPACE 文件不得绑定 session_id。",
        path: ["session_id"],
      });
    }

    if (revision.revision === 1 && revision.parent_ref !== null) {
      context.addIssue({
        code: "custom",
        message: "首个文件 Revision 不能有 Parent。",
        path: ["parent_ref"],
      });
    }
    if (
      revision.revision > 1 &&
      (revision.parent_ref === null ||
        revision.parent_ref.file_id !== revision.file_id ||
        revision.parent_ref.revision !== revision.revision - 1)
    ) {
      context.addIssue({
        code: "custom",
        message: "后续文件 Revision 必须引用同文件紧邻 Parent Revision。",
        path: ["parent_ref"],
      });
    }

    if (revision.promoted_from_ref !== null) {
      if (
        revision.visibility !== "WORKSPACE" ||
        revision.promoted_from_ref.file_id !== revision.file_id ||
        revision.promoted_from_ref.revision >= revision.revision ||
        revision.promoted_from_ref.blob_hash !== revision.blob_hash
      ) {
        context.addIssue({
          code: "custom",
          message: "文件提升必须绑定同一文件的更早 Revision 和同一 Blob Hash。",
          path: ["promoted_from_ref"],
        });
      }
    }

    if (revision.status === "QUARANTINED") {
      if (revision.scan_receipt_ref !== null || revision.deletion_receipt_ref !== null) {
        context.addIssue({
          code: "custom",
          message: "QUARANTINED 不能携带扫描或删除回执。",
          path: ["status"],
        });
      }
    } else if (revision.status === "READY") {
      if (
        revision.scan_receipt_ref?.verdict !== "CLEAN" ||
        revision.deletion_receipt_ref !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "READY 必须绑定 CLEAN 扫描回执且未删除。",
          path: ["scan_receipt_ref"],
        });
      }
    } else if (revision.status === "REJECTED") {
      if (
        revision.scan_receipt_ref === null ||
        revision.scan_receipt_ref.verdict === "CLEAN" ||
        revision.deletion_receipt_ref !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "REJECTED 必须绑定非 CLEAN 扫描回执且未删除。",
          path: ["scan_receipt_ref"],
        });
      }
    } else if (revision.deletion_receipt_ref === null) {
      context.addIssue({
        code: "custom",
        message: "DELETED 必须绑定删除回执。",
        path: ["deletion_receipt_ref"],
      });
    }
  });

export const workspaceFileRevisionSchema = workspaceFileRevisionDraftSchema.safeExtend({
  revision_hash: contentHashSchema,
});

export async function computeWorkspaceFileRevisionHash(input: unknown) {
  return sha256ContentHash(workspaceFileRevisionDraftSchema.parse(input));
}

export async function buildWorkspaceFileRevision(input: unknown) {
  const draft = workspaceFileRevisionDraftSchema.parse(input);
  return deepFreeze(
    workspaceFileRevisionSchema.parse({
      ...draft,
      revision_hash: await computeWorkspaceFileRevisionHash(draft),
    }),
  );
}

export async function verifyWorkspaceFileRevision(input: unknown) {
  const revision = workspaceFileRevisionSchema.parse(input);
  const { revision_hash: _revisionHash, ...draft } = revision;
  if ((await computeWorkspaceFileRevisionHash(draft)) !== revision.revision_hash) {
    throw new TypeError("WORKSPACE_FILE_REVISION_HASH_MISMATCH");
  }
  return deepFreeze(revision);
}

export const workspaceFileScannerIdentitySchema = z.strictObject({
  engine: z.literal("CLAMAV"),
  engine_version: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/),
  signature_version: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/),
  signature_observed_at: canonicalU2TimestampSchema,
  policy_version: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/),
});

const contentPolicyFindingSchema = z.enum([
  "ACTIVE_CONTENT",
  "ARCHIVE_BOMB_RISK",
  "MIME_NOT_ALLOWED",
  "UNSUPPORTED_ENCODING",
]);

const workspaceFileScanReceiptDraftSchema = z
  .strictObject({
    schema_version: z.literal("workspace-file-scan-receipt@1.0.0"),
    receipt_id: canonicalImmutableIdSchema,
    scope: workspaceScopedAuthoritySchema,
    file_ref: workspaceFileReferenceSchema,
    blob_hash: contentHashSchema,
    byte_size: positiveSafeIntegerSchema.max(WORKSPACE_FILE_MAX_BYTES),
    job_id: canonicalImmutableIdSchema,
    attempt_id: canonicalImmutableIdSchema,
    worker_fence: positiveSafeIntegerSchema,
    scanner: workspaceFileScannerIdentitySchema,
    verdict: workspaceFileScanVerdictSchema,
    malware_name: z.string().min(1).max(256).nullable(),
    credential_match_count: nonNegativeSafeIntegerSchema.max(10_000),
    content_policy_findings: z.array(contentPolicyFindingSchema).max(16),
    scanned_at: canonicalU2TimestampSchema,
  })
  .superRefine((receipt, context) => {
    const findings = receipt.content_policy_findings;
    if (
      new Set(findings).size !== findings.length ||
      findings.some((value, index) => index > 0 && (findings[index - 1] ?? "") >= value)
    ) {
      context.addIssue({
        code: "custom",
        message: "Content policy findings 必须唯一规范排序。",
        path: ["content_policy_findings"],
      });
    }
    if (
      receipt.verdict === "CLEAN" &&
      (receipt.malware_name !== null ||
        receipt.credential_match_count !== 0 ||
        findings.length !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "CLEAN 不能携带恶意、凭据或策略命中。",
        path: ["verdict"],
      });
    }
    if (receipt.verdict === "MALICIOUS" && receipt.malware_name === null) {
      context.addIssue({
        code: "custom",
        message: "MALICIOUS 必须携带去敏 malware 名称。",
        path: ["malware_name"],
      });
    }
    if (receipt.verdict === "CREDENTIAL_MATCH" && receipt.credential_match_count === 0) {
      context.addIssue({
        code: "custom",
        message: "CREDENTIAL_MATCH 必须有正数命中计数。",
        path: ["credential_match_count"],
      });
    }
    if (receipt.verdict === "POLICY_BLOCKED" && findings.length === 0) {
      context.addIssue({
        code: "custom",
        message: "POLICY_BLOCKED 必须有策略 finding。",
        path: ["content_policy_findings"],
      });
    }
    if (
      receipt.verdict === "UNKNOWN" &&
      (receipt.malware_name !== null ||
        receipt.credential_match_count !== 0 ||
        findings.length !== 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "UNKNOWN 不得伪装确定性 finding。",
        path: ["verdict"],
      });
    }
  });

export const workspaceFileScanReceiptSchema = workspaceFileScanReceiptDraftSchema.safeExtend({
  receipt_hash: contentHashSchema,
});

export async function computeWorkspaceFileScanReceiptHash(input: unknown) {
  return sha256ContentHash(workspaceFileScanReceiptDraftSchema.parse(input));
}

export async function buildWorkspaceFileScanReceipt(input: unknown) {
  const draft = workspaceFileScanReceiptDraftSchema.parse(input);
  return deepFreeze(
    workspaceFileScanReceiptSchema.parse({
      ...draft,
      receipt_hash: await computeWorkspaceFileScanReceiptHash(draft),
    }),
  );
}

export async function verifyWorkspaceFileScanReceipt(input: unknown) {
  const receipt = workspaceFileScanReceiptSchema.parse(input);
  const { receipt_hash: _receiptHash, ...draft } = receipt;
  if ((await computeWorkspaceFileScanReceiptHash(draft)) !== receipt.receipt_hash) {
    throw new TypeError("WORKSPACE_FILE_SCAN_RECEIPT_HASH_MISMATCH");
  }
  return deepFreeze(receipt);
}

export const storageRetentionPolicyReferenceWithScopeSchema =
  storageRetentionPolicyReferenceSchema.extend({
    app_id: canonicalImmutableIdSchema,
    tenant_id: canonicalImmutableIdSchema,
    environment: environmentSchema,
  });

const storageRetentionPolicyRevisionDraftSchema = z
  .strictObject({
    schema_version: z.literal("storage-retention-policy-revision@1.0.0"),
    scope: workspaceScopedAuthoritySchema,
    policy_id: canonicalImmutableIdSchema,
    revision: positiveSafeIntegerSchema,
    parent_ref: storageRetentionPolicyReferenceSchema.nullable(),
    quarantine_ttl_seconds: positiveSafeIntegerSchema.max(31_536_000),
    deleted_reference_ttl_seconds: nonNegativeSafeIntegerSchema.max(31_536_000),
    orphan_blob_ttl_seconds: positiveSafeIntegerSchema.max(31_536_000),
    backup_expiry_seconds: positiveSafeIntegerSchema.max(315_360_000),
    legal_hold_enabled: z.boolean(),
    created_by_principal_id: canonicalImmutableIdSchema,
    created_at: canonicalU2TimestampSchema,
  })
  .superRefine((policy, context) => {
    if (policy.revision === 1 && policy.parent_ref !== null) {
      context.addIssue({
        code: "custom",
        message: "首个 Retention Revision 不能有 Parent。",
        path: ["parent_ref"],
      });
    }
    if (
      policy.revision > 1 &&
      (policy.parent_ref === null ||
        policy.parent_ref.policy_id !== policy.policy_id ||
        policy.parent_ref.policy_revision !== policy.revision - 1)
    ) {
      context.addIssue({
        code: "custom",
        message: "Retention Revision 必须绑定紧邻 Parent。",
        path: ["parent_ref"],
      });
    }
  });

export const storageRetentionPolicyRevisionSchema =
  storageRetentionPolicyRevisionDraftSchema.safeExtend({
    policy_hash: contentHashSchema,
  });

export async function computeStorageRetentionPolicyRevisionHash(input: unknown) {
  return sha256ContentHash(storageRetentionPolicyRevisionDraftSchema.parse(input));
}

export async function buildStorageRetentionPolicyRevision(input: unknown) {
  const draft = storageRetentionPolicyRevisionDraftSchema.parse(input);
  return deepFreeze(
    storageRetentionPolicyRevisionSchema.parse({
      ...draft,
      policy_hash: await computeStorageRetentionPolicyRevisionHash(draft),
    }),
  );
}

export async function verifyStorageRetentionPolicyRevision(input: unknown) {
  const policy = storageRetentionPolicyRevisionSchema.parse(input);
  const { policy_hash: _policyHash, ...draft } = policy;
  if ((await computeStorageRetentionPolicyRevisionHash(draft)) !== policy.policy_hash) {
    throw new TypeError("STORAGE_RETENTION_POLICY_HASH_MISMATCH");
  }
  return deepFreeze(policy);
}

const storageRetentionPolicyUpdateDraftSchema = z.strictObject({
  schema_version: z.literal("storage-retention-policy-update@1.0.0"),
  operation_id: canonicalImmutableIdSchema,
  workspace_id: canonicalImmutableIdSchema,
  expected_policy_ref: storageRetentionPolicyReferenceSchema,
  quarantine_ttl_seconds: positiveSafeIntegerSchema.max(31_536_000),
  deleted_reference_ttl_seconds: nonNegativeSafeIntegerSchema.max(31_536_000),
  orphan_blob_ttl_seconds: positiveSafeIntegerSchema.max(31_536_000),
  backup_expiry_seconds: positiveSafeIntegerSchema.max(315_360_000),
  legal_hold_enabled: z.boolean(),
  idempotency_key: workspaceIdempotencyKeySchema,
});

export const storageRetentionPolicyUpdateCommandSchema =
  storageRetentionPolicyUpdateDraftSchema.extend({ request_hash: contentHashSchema });

export async function buildStorageRetentionPolicyUpdateCommand(input: unknown) {
  const draft = storageRetentionPolicyUpdateDraftSchema.parse(input);
  return deepFreeze(
    storageRetentionPolicyUpdateCommandSchema.parse({
      ...draft,
      request_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyStorageRetentionPolicyUpdateCommand(input: unknown) {
  const command = storageRetentionPolicyUpdateCommandSchema.parse(input);
  const { request_hash: _requestHash, ...draft } = command;
  if (
    (await sha256ContentHash(storageRetentionPolicyUpdateDraftSchema.parse(draft))) !==
    command.request_hash
  ) {
    throw new TypeError("STORAGE_RETENTION_POLICY_UPDATE_HASH_MISMATCH");
  }
  return deepFreeze(command);
}

const workspaceFileLegalHoldReasonSchema = z.enum([
  "LEGAL_REQUEST",
  "SECURITY_INCIDENT",
  "AUDIT_PRESERVATION",
  "RELEASED",
]);

const workspaceFileLegalHoldCommandDraftSchema = z
  .strictObject({
    schema_version: z.literal("workspace-file-legal-hold@1.0.0"),
    operation_id: canonicalImmutableIdSchema,
    workspace_id: canonicalImmutableIdSchema,
    file_id: canonicalImmutableIdSchema,
    active: z.boolean(),
    reason_code: workspaceFileLegalHoldReasonSchema,
    idempotency_key: workspaceIdempotencyKeySchema,
  })
  .superRefine((command, context) => {
    if (
      (command.active && command.reason_code === "RELEASED") ||
      (!command.active && command.reason_code !== "RELEASED")
    ) {
      context.addIssue({
        code: "custom",
        message: "Legal Hold active 与 reason_code 不闭合。",
        path: ["reason_code"],
      });
    }
  });

export const workspaceFileLegalHoldCommandSchema =
  workspaceFileLegalHoldCommandDraftSchema.safeExtend({
    request_hash: contentHashSchema,
  });

export async function buildWorkspaceFileLegalHoldCommand(input: unknown) {
  const draft = workspaceFileLegalHoldCommandDraftSchema.parse(input);
  return deepFreeze(
    workspaceFileLegalHoldCommandSchema.parse({
      ...draft,
      request_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyWorkspaceFileLegalHoldCommand(input: unknown) {
  const command = workspaceFileLegalHoldCommandSchema.parse(input);
  const { request_hash: _requestHash, ...draft } = command;
  if (
    (await sha256ContentHash(workspaceFileLegalHoldCommandDraftSchema.parse(draft))) !==
    command.request_hash
  ) {
    throw new TypeError("WORKSPACE_FILE_LEGAL_HOLD_REQUEST_HASH_MISMATCH");
  }
  return deepFreeze(command);
}

const workspaceFileLegalHoldReceiptDraftSchema = z
  .strictObject({
    schema_version: z.literal("workspace-file-legal-hold-receipt@1.0.0"),
    scope: workspaceScopedAuthoritySchema,
    file_id: canonicalImmutableIdSchema,
    hold_revision: positiveSafeIntegerSchema,
    active: z.boolean(),
    operation_id: canonicalImmutableIdSchema,
    principal_id: canonicalImmutableIdSchema,
    reason_code: workspaceFileLegalHoldReasonSchema,
    created_at: canonicalU2TimestampSchema,
  })
  .superRefine((receipt, context) => {
    if (
      (receipt.active && receipt.reason_code === "RELEASED") ||
      (!receipt.active && receipt.reason_code !== "RELEASED")
    ) {
      context.addIssue({
        code: "custom",
        message: "Legal Hold Receipt 状态不闭合。",
        path: ["reason_code"],
      });
    }
  });

export const workspaceFileLegalHoldReceiptSchema =
  workspaceFileLegalHoldReceiptDraftSchema.safeExtend({
    hold_hash: contentHashSchema,
  });

export async function buildWorkspaceFileLegalHoldReceipt(input: unknown) {
  const draft = workspaceFileLegalHoldReceiptDraftSchema.parse(input);
  return deepFreeze(
    workspaceFileLegalHoldReceiptSchema.parse({
      ...draft,
      hold_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyWorkspaceFileLegalHoldReceipt(input: unknown) {
  const receipt = workspaceFileLegalHoldReceiptSchema.parse(input);
  const { hold_hash: _holdHash, ...draft } = receipt;
  if (
    (await sha256ContentHash(workspaceFileLegalHoldReceiptDraftSchema.parse(draft))) !==
    receipt.hold_hash
  ) {
    throw new TypeError("WORKSPACE_FILE_LEGAL_HOLD_HASH_MISMATCH");
  }
  return deepFreeze(receipt);
}

const workspaceContentGcEvaluationCommandDraftSchema = z.strictObject({
  schema_version: z.literal("workspace-content-gc-evaluate@1.0.0"),
  operation_id: canonicalImmutableIdSchema,
  workspace_id: canonicalImmutableIdSchema,
  blob_hash: contentHashSchema,
  idempotency_key: workspaceIdempotencyKeySchema,
});

export const workspaceContentGcEvaluationCommandSchema =
  workspaceContentGcEvaluationCommandDraftSchema.extend({ request_hash: contentHashSchema });

export async function buildWorkspaceContentGcEvaluationCommand(input: unknown) {
  const draft = workspaceContentGcEvaluationCommandDraftSchema.parse(input);
  return deepFreeze(
    workspaceContentGcEvaluationCommandSchema.parse({
      ...draft,
      request_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyWorkspaceContentGcEvaluationCommand(input: unknown) {
  const command = workspaceContentGcEvaluationCommandSchema.parse(input);
  const { request_hash: _requestHash, ...draft } = command;
  if (
    (await sha256ContentHash(workspaceContentGcEvaluationCommandDraftSchema.parse(draft))) !==
    command.request_hash
  ) {
    throw new TypeError("WORKSPACE_CONTENT_GC_EVALUATION_REQUEST_HASH_MISMATCH");
  }
  return deepFreeze(command);
}

export const workspaceContentGcStatusSchema = z.enum(["HELD", "ELIGIBLE", "DELETED"]);

const workspaceContentGcReceiptDraftSchema = z
  .strictObject({
    schema_version: z.literal("workspace-content-gc-receipt@1.0.0"),
    receipt_id: canonicalImmutableIdSchema,
    operation_id: canonicalImmutableIdSchema,
    scope: workspaceScopedAuthoritySchema,
    blob_hash: contentHashSchema,
    status: workspaceContentGcStatusSchema,
    parent_receipt_ref: z
      .strictObject({
        receipt_id: canonicalImmutableIdSchema,
        receipt_hash: contentHashSchema,
      })
      .nullable(),
    active_reference_count: nonNegativeSafeIntegerSchema,
    legal_hold_active: z.boolean(),
    retention_expires_at: canonicalU2TimestampSchema,
    backup_expires_at: canonicalU2TimestampSchema,
    evaluated_at: canonicalU2TimestampSchema,
  })
  .superRefine((receipt, context) => {
    if (
      receipt.status === "ELIGIBLE" &&
      (receipt.active_reference_count !== 0 || receipt.legal_hold_active)
    ) {
      context.addIssue({
        code: "custom",
        message: "GC Eligible 必须零引用且无 Legal Hold。",
        path: ["status"],
      });
    }
    if (
      receipt.status === "HELD" &&
      receipt.active_reference_count === 0 &&
      !receipt.legal_hold_active &&
      new Date(receipt.retention_expires_at).getTime() <=
        new Date(receipt.evaluated_at).getTime() &&
      new Date(receipt.backup_expires_at).getTime() <= new Date(receipt.evaluated_at).getTime()
    ) {
      context.addIssue({
        code: "custom",
        message: "HELD 必须有可验证的保留原因。",
        path: ["status"],
      });
    }
    if ((receipt.status === "DELETED") !== (receipt.parent_receipt_ref !== null)) {
      context.addIssue({
        code: "custom",
        message: "DELETED 必须绑定 Eligible Parent。",
        path: ["parent_receipt_ref"],
      });
    }
  });

export const workspaceContentGcReceiptSchema = workspaceContentGcReceiptDraftSchema.safeExtend({
  receipt_hash: contentHashSchema,
});

export async function buildWorkspaceContentGcReceipt(input: unknown) {
  const draft = workspaceContentGcReceiptDraftSchema.parse(input);
  return deepFreeze(
    workspaceContentGcReceiptSchema.parse({
      ...draft,
      receipt_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function verifyWorkspaceContentGcReceipt(input: unknown) {
  const receipt = workspaceContentGcReceiptSchema.parse(input);
  const { receipt_hash: _receiptHash, ...draft } = receipt;
  if (
    (await sha256ContentHash(workspaceContentGcReceiptDraftSchema.parse(draft))) !==
    receipt.receipt_hash
  ) {
    throw new TypeError("WORKSPACE_CONTENT_GC_RECEIPT_HASH_MISMATCH");
  }
  return deepFreeze(receipt);
}

export const workspaceContentGcEvaluationResultSchema = z
  .strictObject({
    receipt: workspaceContentGcReceiptSchema,
    deletion_authority: z
      .strictObject({
        storage_key: workspaceFileObservedContentSchema.shape.storage_key,
        blob_hash: contentHashSchema,
      })
      .nullable(),
  })
  .superRefine((result, context) => {
    if (
      (result.receipt.status === "ELIGIBLE") !== (result.deletion_authority !== null) ||
      (result.deletion_authority !== null &&
        result.deletion_authority.blob_hash !== result.receipt.blob_hash)
    ) {
      context.addIssue({
        code: "custom",
        message: "GC deletion authority 与 receipt 不闭合。",
        path: ["deletion_authority"],
      });
    }
  });

export const workspaceContentGcCommitCommandSchema = z.strictObject({
  schema_version: z.literal("workspace-content-gc-commit@1.0.0"),
  workspace_id: canonicalImmutableIdSchema,
  receipt_id: canonicalImmutableIdSchema,
  receipt_hash: contentHashSchema,
  blob_hash: contentHashSchema,
});

export const workspaceContentOrphanCheckCommandSchema = z.strictObject({
  schema_version: z.literal("workspace-content-orphan-check@1.0.0"),
  workspace_id: canonicalImmutableIdSchema,
  storage_key: workspaceFileObservedContentSchema.shape.storage_key,
  blob_hash: contentHashSchema,
  observed_at: canonicalU2TimestampSchema,
});

export const workspaceContentOrphanCheckResultSchema = z
  .strictObject({
    schema_version: z.literal("workspace-content-orphan-check-result@1.0.0"),
    storage_key: workspaceFileObservedContentSchema.shape.storage_key,
    blob_hash: contentHashSchema,
    authorized: z.boolean(),
    orphan_ttl_seconds: positiveSafeIntegerSchema.max(31_536_000),
    observed_at: canonicalU2TimestampSchema,
    checked_at: canonicalU2TimestampSchema,
  })
  .superRefine((result, context) => {
    if (new Date(result.checked_at).getTime() < new Date(result.observed_at).getTime()) {
      context.addIssue({
        code: "custom",
        message: "Orphan check 不能早于对象 observed_at。",
        path: ["checked_at"],
      });
    }
  });

export const workspaceFileBlobDeletionStatusSchema = z.enum([
  "RETAINED_BY_REFERENCE",
  "RETAINED_BY_POLICY",
  "RETAINED_BY_LEGAL_HOLD",
  "ELIGIBLE_FOR_GC",
  "DELETED",
]);

const workspaceFileDeletionReceiptDraftSchema = z
  .strictObject({
    schema_version: z.literal("workspace-file-deletion-receipt@1.0.0"),
    receipt_id: canonicalImmutableIdSchema,
    operation_id: canonicalImmutableIdSchema,
    scope: workspaceScopedAuthoritySchema,
    file_ref: workspaceFileReferenceSchema,
    blob_hash: contentHashSchema,
    deleted_by_principal_id: canonicalImmutableIdSchema,
    access_revoked_at: canonicalU2TimestampSchema,
    legal_hold_active: z.boolean(),
    remaining_active_references: nonNegativeSafeIntegerSchema,
    blob_deletion_status: workspaceFileBlobDeletionStatusSchema,
    backup_expires_at: canonicalU2TimestampSchema,
  })
  .superRefine((receipt, context) => {
    if (
      new Date(receipt.backup_expires_at).getTime() < new Date(receipt.access_revoked_at).getTime()
    ) {
      context.addIssue({
        code: "custom",
        message: "Backup expiry 不能早于访问撤销。",
        path: ["backup_expires_at"],
      });
    }
    if (receipt.legal_hold_active && receipt.blob_deletion_status !== "RETAINED_BY_LEGAL_HOLD") {
      context.addIssue({
        code: "custom",
        message: "Legal Hold 必须阻止 Blob GC。",
        path: ["blob_deletion_status"],
      });
    }
    if (
      !receipt.legal_hold_active &&
      receipt.remaining_active_references > 0 &&
      receipt.blob_deletion_status !== "RETAINED_BY_REFERENCE"
    ) {
      context.addIssue({
        code: "custom",
        message: "存在有效引用时 Blob 必须按引用保留。",
        path: ["blob_deletion_status"],
      });
    }
    if (
      receipt.remaining_active_references === 0 &&
      !receipt.legal_hold_active &&
      receipt.blob_deletion_status === "RETAINED_BY_REFERENCE"
    ) {
      context.addIssue({
        code: "custom",
        message: "零引用不能声明按引用保留。",
        path: ["blob_deletion_status"],
      });
    }
  });

export const workspaceFileDeletionReceiptSchema =
  workspaceFileDeletionReceiptDraftSchema.safeExtend({
    receipt_hash: contentHashSchema,
  });

export async function computeWorkspaceFileDeletionReceiptHash(input: unknown) {
  return sha256ContentHash(workspaceFileDeletionReceiptDraftSchema.parse(input));
}

export async function buildWorkspaceFileDeletionReceipt(input: unknown) {
  const draft = workspaceFileDeletionReceiptDraftSchema.parse(input);
  return deepFreeze(
    workspaceFileDeletionReceiptSchema.parse({
      ...draft,
      receipt_hash: await computeWorkspaceFileDeletionReceiptHash(draft),
    }),
  );
}

export async function verifyWorkspaceFileDeletionReceipt(input: unknown) {
  const receipt = workspaceFileDeletionReceiptSchema.parse(input);
  const { receipt_hash: _receiptHash, ...draft } = receipt;
  if ((await computeWorkspaceFileDeletionReceiptHash(draft)) !== receipt.receipt_hash) {
    throw new TypeError("WORKSPACE_FILE_DELETION_RECEIPT_HASH_MISMATCH");
  }
  return deepFreeze(receipt);
}

export const workspaceFileScanCommitSchema = z
  .strictObject({
    schema_version: z.literal("workspace-file-scan-commit@1.0.0"),
    file_ref: workspaceFileReferenceSchema,
    blob_hash: contentHashSchema,
    byte_size: positiveSafeIntegerSchema.max(WORKSPACE_FILE_MAX_BYTES),
    scanner: workspaceFileScannerIdentitySchema,
    verdict: z.enum(["CLEAN", "MALICIOUS", "CREDENTIAL_MATCH", "POLICY_BLOCKED"]),
    malware_name: z.string().min(1).max(256).nullable(),
    credential_match_count: nonNegativeSafeIntegerSchema.max(10_000),
    content_policy_findings: z.array(contentPolicyFindingSchema).max(16),
  })
  .superRefine((commit, context) => {
    if (
      (commit.verdict === "CLEAN" &&
        (commit.malware_name !== null ||
          commit.credential_match_count !== 0 ||
          commit.content_policy_findings.length !== 0)) ||
      (commit.verdict === "MALICIOUS" && commit.malware_name === null) ||
      (commit.verdict === "CREDENTIAL_MATCH" && commit.credential_match_count === 0) ||
      (commit.verdict === "POLICY_BLOCKED" && commit.content_policy_findings.length === 0)
    ) {
      context.addIssue({ code: "custom", message: "Scan Commit verdict facts 不闭合。" });
    }
  });

export const workspaceFileScanTargetSchema = z
  .strictObject({
    file: workspaceFileRevisionSchema,
    storage_key: workspaceFileObservedContentSchema.shape.storage_key,
    blob_hash: contentHashSchema,
    byte_size: positiveSafeIntegerSchema.max(WORKSPACE_FILE_MAX_BYTES),
    detected_mime: detectedWorkspaceFileMimeSchema,
  })
  .superRefine((target, context) => {
    if (
      target.file.status !== "QUARANTINED" ||
      target.file.blob_hash !== target.blob_hash ||
      target.file.byte_size !== target.byte_size ||
      target.file.detected_mime !== target.detected_mime
    ) {
      context.addIssue({
        code: "custom",
        message: "Scan Target 必须与 QUARANTINED Revision 的内容身份完全一致。",
        path: ["file"],
      });
    }
  });

export const workspaceFileScanCommitResultSchema = z.strictObject({
  scan_receipt: workspaceFileScanReceiptSchema,
  revision: workspaceFileRevisionSchema,
});

export const workspaceFileDownloadAuthoritySchema = z
  .strictObject({
    file: workspaceFileRevisionSchema,
    storage_key: workspaceFileObservedContentSchema.shape.storage_key,
    blob_hash: contentHashSchema,
    byte_size: positiveSafeIntegerSchema.max(WORKSPACE_FILE_MAX_BYTES),
    detected_mime: detectedWorkspaceFileMimeSchema,
  })
  .superRefine((authority, context) => {
    if (
      authority.file.status !== "READY" ||
      authority.file.blob_hash !== authority.blob_hash ||
      authority.file.byte_size !== authority.byte_size ||
      authority.file.detected_mime !== authority.detected_mime
    ) {
      context.addIssue({
        code: "custom",
        message: "Download Authority 必须与 READY Revision 的内容身份完全一致。",
        path: ["file"],
      });
    }
  });

export const workspaceFileDeletionResultSchema = z.strictObject({
  revision: workspaceFileRevisionSchema,
  deletion_receipt: workspaceFileDeletionReceiptSchema,
});

export type WorkspaceFileReference = z.infer<typeof workspaceFileReferenceSchema>;
export type WorkspaceFileScanVerdict = z.infer<typeof workspaceFileScanVerdictSchema>;
export type WorkspaceFileRevision = z.infer<typeof workspaceFileRevisionSchema>;
export type WorkspaceFileScanReceipt = z.infer<typeof workspaceFileScanReceiptSchema>;
export type StorageRetentionPolicyRevision = z.infer<typeof storageRetentionPolicyRevisionSchema>;
export type StorageRetentionPolicyUpdateCommand = z.infer<
  typeof storageRetentionPolicyUpdateCommandSchema
>;
export type WorkspaceFileDeletionReceipt = z.infer<typeof workspaceFileDeletionReceiptSchema>;
export type WorkspaceFileObservedContent = z.infer<typeof workspaceFileObservedContentSchema>;
export type WorkspaceFileUploadCommitCommand = z.infer<
  typeof workspaceFileUploadCommitCommandSchema
>;
export type WorkspaceFilePromoteCommand = z.infer<typeof workspaceFilePromoteCommandSchema>;
export type WorkspaceFileDeleteCommand = z.infer<typeof workspaceFileDeleteCommandSchema>;
export type WorkspaceFileScanCommit = z.infer<typeof workspaceFileScanCommitSchema>;
export type WorkspaceFileScanTarget = z.infer<typeof workspaceFileScanTargetSchema>;
export type WorkspaceFileScanCommitResult = z.infer<typeof workspaceFileScanCommitResultSchema>;
export type WorkspaceFileDownloadAuthority = z.infer<typeof workspaceFileDownloadAuthoritySchema>;
export type WorkspaceFileLegalHoldCommand = z.infer<typeof workspaceFileLegalHoldCommandSchema>;
export type WorkspaceFileLegalHoldReceipt = z.infer<typeof workspaceFileLegalHoldReceiptSchema>;
export type WorkspaceContentGcEvaluationCommand = z.infer<
  typeof workspaceContentGcEvaluationCommandSchema
>;
export type WorkspaceContentGcReceipt = z.infer<typeof workspaceContentGcReceiptSchema>;
export type WorkspaceContentGcEvaluationResult = z.infer<
  typeof workspaceContentGcEvaluationResultSchema
>;
export type WorkspaceContentGcCommitCommand = z.infer<typeof workspaceContentGcCommitCommandSchema>;
export type WorkspaceContentOrphanCheckCommand = z.infer<
  typeof workspaceContentOrphanCheckCommandSchema
>;
export type WorkspaceContentOrphanCheckResult = z.infer<
  typeof workspaceContentOrphanCheckResultSchema
>;
export type WorkspaceFileDeletionResult = z.infer<typeof workspaceFileDeletionResultSchema>;
