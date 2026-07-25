import { z } from "zod";
import {
  type ArtifactReferenceVerifier,
  artifactReferenceFor,
  artifactReferenceIdentity,
  artifactReferenceSchema,
} from "../artifacts/envelope.js";
import {
  type AppScope,
  appScopeSchema,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";
import type { PortResult } from "../common/primitives.js";
import {
  externalAgentPermissionPolicySchema,
  externalAgentProfileSchema,
  externalAgentWorkspacePolicySchema,
  isCanonicalPosixWorkspaceRoot,
} from "../providers/index.js";
import { assertPortEventCorrelation } from "./event-correlation.js";

export { isCanonicalPosixWorkspaceRoot };

export const EXTERNAL_AGENT_PUBLIC_OUTPUT_DELTA_MAX_CHARACTERS = 100_000;

const canonicalExternalAgentWorkspacePolicySchema = externalAgentWorkspacePolicySchema.superRefine(
  (policy, ctx) => {
    policy.roots.forEach((root, index) => {
      if (!isCanonicalPosixWorkspaceRoot(root)) {
        ctx.addIssue({
          code: "custom",
          message:
            "External Agent Workspace Root 必须是非根目录的规范 POSIX 绝对路径，且不能包含空段、.、.. 或 NUL。",
          path: ["roots", index],
        });
      }
    });
  },
);

const serverOwnedExternalAgentProfileSchema = externalAgentProfileSchema.extend({
  scope: appScopeSchema,
  profile_version: versionIdentifierSchema,
  workspace_policy: canonicalExternalAgentWorkspacePolicySchema,
});

type ServerOwnedExternalAgentProfile = z.infer<typeof serverOwnedExternalAgentProfileSchema>;

export const externalAgentRequestSchema = z
  .strictObject({
    schema_version: versionIdentifierSchema,
    invocation_id: immutableIdSchema,
    attempt_id: immutableIdSchema,
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    profile_id: immutableIdSchema,
    profile_version: versionIdentifierSchema,
    adapter: z.string().min(1).max(128),
    task_ref: artifactReferenceSchema,
    context_refs: z.array(artifactReferenceSchema).max(64),
    workspace_policy: canonicalExternalAgentWorkspacePolicySchema,
    permission_policy: externalAgentPermissionPolicySchema,
    budget: z.strictObject({
      timeout_ms: z.number().int().positive().max(3_600_000),
      max_output_bytes: z.number().int().positive(),
      max_actions: z.number().int().positive(),
    }),
  })
  .superRefine((request, ctx) => {
    if (
      [request.task_ref, ...request.context_refs].some(
        (reference) =>
          reference.app_id !== request.scope.app_id ||
          reference.tenant_id !== request.scope.tenant_id ||
          reference.environment !== request.scope.environment ||
          reference.run_id !== request.run_id,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        message: "External Agent Request 的 Artifact 必须属于同一 App/Tenant/Environment/Run。",
        path: ["context_refs"],
      });
    }
  });

const externalAgentEventBase = {
  schema_version: versionIdentifierSchema,
  invocation_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  profile_id: immutableIdSchema,
  profile_version: versionIdentifierSchema,
  adapter: z.string().min(1).max(128),
  sequence: z.number().int().nonnegative(),
  observed_at: timestampSchema,
} as const;

export const externalAgentEventSchema = z
  .discriminatedUnion("event_type", [
    z.strictObject({
      ...externalAgentEventBase,
      event_type: z.literal("STARTED"),
    }),
    z.strictObject({
      ...externalAgentEventBase,
      event_type: z.literal("OUTPUT_DELTA"),
      channel: z.enum(["stdout", "stderr"]),
      delta: z.string().min(1).max(EXTERNAL_AGENT_PUBLIC_OUTPUT_DELTA_MAX_CHARACTERS),
    }),
    z.strictObject({
      ...externalAgentEventBase,
      event_type: z.literal("AUDIT_ACTION"),
      action: versionIdentifierSchema,
      target: z.string().min(1).max(2_000),
      verdict: z.enum(["ALLOWED", "BLOCKED"]),
    }),
    z.strictObject({
      ...externalAgentEventBase,
      event_type: z.literal("COMPLETED"),
      audit_receipt_ref: artifactReferenceFor("ExternalAgentAuditReceipt"),
    }),
    z.strictObject({
      ...externalAgentEventBase,
      event_type: z.enum(["FAILED", "CANCELLED"]),
      reason_code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
      retryable: z.boolean(),
    }),
  ])
  .superRefine((event, ctx) => {
    if (
      event.event_type === "COMPLETED" &&
      (event.audit_receipt_ref.app_id !== event.scope.app_id ||
        event.audit_receipt_ref.tenant_id !== event.scope.tenant_id ||
        event.audit_receipt_ref.environment !== event.scope.environment ||
        event.audit_receipt_ref.run_id !== event.run_id)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "External Agent Receipt 必须与事件属于同一 App/Tenant/Environment/Run。",
        path: ["audit_receipt_ref"],
      });
    }
  });

export const externalAgentCancelRequestSchema = z.strictObject({
  schema_version: versionIdentifierSchema,
  invocation_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  reason_code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
});

export const externalAgentCancelConfirmationSchema = z.strictObject({
  cancelled: z.literal(true),
  attempt_id: immutableIdSchema,
});

export type ExternalAgentRequest = z.infer<typeof externalAgentRequestSchema>;
export type ExternalAgentEvent = z.infer<typeof externalAgentEventSchema>;
export type ExternalAgentCancelRequest = z.infer<typeof externalAgentCancelRequestSchema>;
export type ExternalAgentCancelConfirmation = z.infer<typeof externalAgentCancelConfirmationSchema>;

export const externalAgentAuditReceiptSchema = z
  .strictObject({
    schema_version: versionIdentifierSchema,
    receipt_ref: artifactReferenceFor("ExternalAgentAuditReceipt"),
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    invocation_id: immutableIdSchema,
    attempt_id: immutableIdSchema,
    profile_id: immutableIdSchema,
    profile_version: versionIdentifierSchema,
    adapter: z.string().min(1).max(128),
    workspace_policy_hash: contentHashSchema,
    permission_policy_hash: contentHashSchema,
    action_log_hash: contentHashSchema,
    output_hash: contentHashSchema,
    action_count: z.number().int().nonnegative(),
    output_bytes: z.number().int().nonnegative(),
    process_terminal: z.literal("EXITED"),
    terminal: z.literal("COMPLETED"),
    reason_code: z.literal("EXTERNAL_AGENT_COMPLETED"),
    completed_at: timestampSchema,
  })
  .superRefine((receipt, ctx) => {
    if (
      receipt.receipt_ref.app_id !== receipt.scope.app_id ||
      receipt.receipt_ref.tenant_id !== receipt.scope.tenant_id ||
      receipt.receipt_ref.environment !== receipt.scope.environment ||
      receipt.receipt_ref.run_id !== receipt.run_id
    ) {
      ctx.addIssue({
        code: "custom",
        message: "External Agent Audit Receipt Reference 必须属于同一 Scope/Run。",
        path: ["receipt_ref"],
      });
    }
  });

export type ExternalAgentAuditReceipt = z.infer<typeof externalAgentAuditReceiptSchema>;

export interface ExternalAgentAuditReceiptExpectation {
  readonly invocation: ExternalAgentRequest;
  readonly workspace_policy_hash: `sha256:${string}`;
  readonly permission_policy_hash: `sha256:${string}`;
  readonly action_log_hash: `sha256:${string}`;
  readonly output_hash: `sha256:${string}`;
  readonly action_count: number;
  readonly output_bytes: number;
}

export class ExternalAgentAuditReceiptAuthorityError extends Error {
  override readonly name = "ExternalAgentAuditReceiptAuthorityError";
  readonly code = "EXTERNAL_AGENT_AUDIT_RECEIPT_NOT_AUTHORITATIVE";
}

declare const authoritativeExternalAgentAuditReceipt: unique symbol;
const authorizedExternalAgentAuditReceipts = new WeakSet<object>();

export type AuthoritativeExternalAgentAuditReceipt = ExternalAgentAuditReceipt & {
  readonly [authoritativeExternalAgentAuditReceipt]: true;
};

export interface ExternalAgentAuditReceiptAuthorityContext {
  resolve(reference: ExternalAgentAuditReceipt["receipt_ref"]): Promise<unknown | null>;
  verifyCommitted: ArtifactReferenceVerifier;
}

export async function authorizeExternalAgentAuditReceipt(
  expectedReference: ExternalAgentAuditReceipt["receipt_ref"],
  expected: ExternalAgentAuditReceiptExpectation,
  authority: ExternalAgentAuditReceiptAuthorityContext,
): Promise<AuthoritativeExternalAgentAuditReceipt> {
  let receipt: ExternalAgentAuditReceipt;
  try {
    receipt = externalAgentAuditReceiptSchema.parse(await authority.resolve(expectedReference));
  } catch {
    throw new ExternalAgentAuditReceiptAuthorityError(
      "External Agent Audit Receipt 无法从持久化 Authority 解析。",
    );
  }
  const invocation = externalAgentRequestSchema.parse(expected.invocation);
  if (
    artifactReferenceIdentity(receipt.receipt_ref) !==
      artifactReferenceIdentity(expectedReference) ||
    receipt.scope.app_id !== invocation.scope.app_id ||
    receipt.scope.tenant_id !== invocation.scope.tenant_id ||
    receipt.scope.environment !== invocation.scope.environment ||
    receipt.run_id !== invocation.run_id ||
    receipt.invocation_id !== invocation.invocation_id ||
    receipt.attempt_id !== invocation.attempt_id ||
    receipt.profile_id !== invocation.profile_id ||
    receipt.profile_version !== invocation.profile_version ||
    receipt.adapter !== invocation.adapter ||
    receipt.workspace_policy_hash !== expected.workspace_policy_hash ||
    receipt.permission_policy_hash !== expected.permission_policy_hash ||
    receipt.action_log_hash !== expected.action_log_hash ||
    receipt.output_hash !== expected.output_hash ||
    receipt.action_count !== expected.action_count ||
    receipt.output_bytes !== expected.output_bytes
  ) {
    throw new ExternalAgentAuditReceiptAuthorityError(
      "External Agent Audit Receipt 未绑定完整调用、Policy、Action Log 与 Output。",
    );
  }
  if (!(await authority.verifyCommitted(expectedReference))) {
    throw new ExternalAgentAuditReceiptAuthorityError(
      "External Agent Audit Receipt 尚未由持久化 Authority 提交。",
    );
  }

  authorizedExternalAgentAuditReceipts.add(receipt);
  return deepFreeze(receipt) as AuthoritativeExternalAgentAuditReceipt;
}

export function isAuthoritativeExternalAgentAuditReceipt(
  value: unknown,
): value is AuthoritativeExternalAgentAuditReceipt {
  return (
    typeof value === "object" && value !== null && authorizedExternalAgentAuditReceipts.has(value)
  );
}

export type ExternalAgentProfileResolver = (input: {
  readonly scope: AppScope;
  readonly profile_id: string;
  readonly profile_version: string;
}) => Promise<unknown | null>;

export class ExternalAgentInvocationAuthorizationError extends Error {
  override readonly name = "ExternalAgentInvocationAuthorizationError";
  readonly code = "EXTERNAL_AGENT_INVOCATION_NOT_AUTHORIZED";
}

declare const authoritativeExternalAgentInvocation: unique symbol;
const authorizedExternalAgentInvocations = new WeakSet<object>();

export type AuthoritativeExternalAgentInvocation = ExternalAgentRequest & {
  readonly [authoritativeExternalAgentInvocation]: true;
};

const externalAgentBoundaryLabels = {
  PROFILE: "Profile",
  WORKSPACE: "Workspace",
  PERMISSION: "Permission",
  CANCELLATION: "Cancellation",
} as const;

type ExternalAgentProfileBoundary = keyof typeof externalAgentBoundaryLabels;

function requestFitsExternalAgentProfile(
  request: ExternalAgentRequest,
  profile: ServerOwnedExternalAgentProfile,
): ExternalAgentProfileBoundary | null {
  if (
    request.profile_id !== profile.profile_id ||
    request.profile_version !== profile.profile_version ||
    request.adapter !== profile.adapter ||
    request.scope.app_id !== profile.scope.app_id ||
    request.scope.tenant_id !== profile.scope.tenant_id ||
    request.scope.environment !== profile.scope.environment
  ) {
    return "PROFILE";
  }
  if (
    (request.workspace_policy.writable && !profile.workspace_policy.writable) ||
    request.workspace_policy.roots.some(
      (requestedRoot) =>
        !profile.workspace_policy.roots.some(
          (profileRoot) =>
            requestedRoot === profileRoot || requestedRoot.startsWith(`${profileRoot}/`),
        ),
    )
  ) {
    return "WORKSPACE";
  }
  if (
    request.permission_policy.allowed_tools.some(
      (tool) => !profile.permission_policy.allowed_tools.includes(tool),
    ) ||
    request.permission_policy.allowed_command_ids.some(
      (commandId) => !profile.permission_policy.allowed_command_ids.includes(commandId),
    )
  ) {
    return "PERMISSION";
  }
  if (
    !profile.cancellation.supported ||
    request.budget.timeout_ms > profile.cancellation.timeout_ms
  ) {
    return "CANCELLATION";
  }
  return null;
}

export async function authorizeExternalAgentInvocation(
  input: unknown,
  resolveProfile: ExternalAgentProfileResolver,
): Promise<AuthoritativeExternalAgentInvocation> {
  const request = externalAgentRequestSchema.parse(input);
  const profileResult = serverOwnedExternalAgentProfileSchema.safeParse(
    await resolveProfile({
      scope: request.scope,
      profile_id: request.profile_id,
      profile_version: request.profile_version,
    }),
  );
  if (!profileResult.success) {
    throw new ExternalAgentInvocationAuthorizationError(
      "External Agent 调用必须解析服务端拥有的 Profile。",
    );
  }

  const mismatch = requestFitsExternalAgentProfile(request, profileResult.data);
  if (mismatch) {
    throw new ExternalAgentInvocationAuthorizationError(
      `External Agent 调用不能扩大服务端 Profile 的 ${externalAgentBoundaryLabels[mismatch]} 边界。`,
    );
  }

  authorizedExternalAgentInvocations.add(request);
  return deepFreeze(request) as AuthoritativeExternalAgentInvocation;
}

export function isAuthoritativeExternalAgentInvocation(
  value: unknown,
): value is AuthoritativeExternalAgentInvocation {
  return (
    typeof value === "object" && value !== null && authorizedExternalAgentInvocations.has(value)
  );
}

export function parseExternalAgentEventForRequest(
  request: ExternalAgentRequest,
  input: unknown,
): ExternalAgentEvent {
  const event = externalAgentEventSchema.parse(input);
  assertPortEventCorrelation("External Agent", request, event, [
    {
      field: "invocation_id",
      expected: request.invocation_id,
      actual: event.invocation_id,
    },
    { field: "profile_id", expected: request.profile_id, actual: event.profile_id },
    {
      field: "profile_version",
      expected: request.profile_version,
      actual: event.profile_version,
    },
    { field: "adapter", expected: request.adapter, actual: event.adapter },
  ]);
  return event;
}

export interface ExternalAgentPort {
  stream(input: AuthoritativeExternalAgentInvocation): AsyncIterable<ExternalAgentEvent>;
  cancel(input: ExternalAgentCancelRequest): Promise<PortResult<ExternalAgentCancelConfirmation>>;
}
