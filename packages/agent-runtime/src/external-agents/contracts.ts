import {
  type AuthoritativeExternalAgentAuditReceipt,
  type AuthoritativeExternalAgentInvocation,
  appScopeSchema,
  artifactReferenceFor,
  artifactReferenceSchema,
  EXTERNAL_AGENT_PUBLIC_OUTPUT_DELTA_MAX_CHARACTERS,
  type ExternalAgentAuditReceipt,
  type ExternalAgentAuditReceiptExpectation,
  type ExternalAgentProfile,
  externalAgentProfileSchema,
  immutableIdSchema,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import { z } from "zod";

export const externalAgentRuntimeLimitsSchema = z.strictObject({
  max_timeout_ms: z.number().int().positive().max(3_600_000),
  max_termination_confirmation_ms: z.number().int().positive().max(30_000),
  max_output_bytes: z.number().int().positive().max(100_000_000),
  max_actions: z.number().int().positive().max(10_000),
});

export type ExternalAgentRuntimeLimits = z.infer<typeof externalAgentRuntimeLimitsSchema>;

export interface ExternalAgentProcessStartInput {
  readonly invocation: AuthoritativeExternalAgentInvocation;
  readonly limits: ExternalAgentRuntimeLimits;
  readonly signal: AbortSignal;
}

export const externalAgentProcessTerminationRequestSchema = z.strictObject({
  schema_version: versionIdentifierSchema,
  session_id: immutableIdSchema,
  invocation_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  reason_code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
});

export type ExternalAgentProcessTerminationRequest = z.infer<
  typeof externalAgentProcessTerminationRequestSchema
>;

export const externalAgentProcessTerminationConfirmationSchema = z.strictObject({
  schema_version: versionIdentifierSchema,
  session_id: immutableIdSchema,
  invocation_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  process_terminal: z.literal("EXITED"),
  reason_code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
});

export type ExternalAgentProcessTerminationConfirmation = z.infer<
  typeof externalAgentProcessTerminationConfirmationSchema
>;

export interface ExternalAgentProcessSession {
  readonly session_id: string;
  readonly events: AsyncIterable<unknown>;
  requestTermination(input: ExternalAgentProcessTerminationRequest): Promise<unknown>;
}

export interface ExternalAgentProcessHostImplementation {
  start(
    input: ExternalAgentProcessStartInput,
  ): Promise<ExternalAgentProcessSession> | ExternalAgentProcessSession;
}

declare const trustedExternalAgentProcessHost: unique symbol;
const trustedProcessHosts = new WeakSet<object>();

export type TrustedExternalAgentProcessHost = ExternalAgentProcessHostImplementation & {
  readonly [trustedExternalAgentProcessHost]: true;
};

function isProcessHostImplementation(
  value: unknown,
): value is ExternalAgentProcessHostImplementation {
  return (
    typeof value === "object" && value !== null && typeof Reflect.get(value, "start") === "function"
  );
}

/**
 * 服务端组合根把真正受控的 Process/Effect Host 包装为不可结构伪造的运行时能力。
 *
 * U3 只定义这一边界；真实 OS Sandbox、进程树清理和持久会话由 U9 加固。
 */
export function createTrustedExternalAgentProcessHost(
  implementation: ExternalAgentProcessHostImplementation,
): TrustedExternalAgentProcessHost {
  if (!isProcessHostImplementation(implementation)) {
    throw new TypeError("External Agent Process Host 必须实现 start。");
  }
  const host = Object.freeze({
    start(input: ExternalAgentProcessStartInput) {
      return implementation.start(input);
    },
  });
  trustedProcessHosts.add(host);
  return host as TrustedExternalAgentProcessHost;
}

export function isTrustedExternalAgentProcessHost(
  value: unknown,
): value is TrustedExternalAgentProcessHost {
  return typeof value === "object" && value !== null && trustedProcessHosts.has(value);
}

const externalAgentProcessHostSchema = z.custom<TrustedExternalAgentProcessHost>(
  isTrustedExternalAgentProcessHost,
  {
    message: "启用的 External Agent 注册项必须注入服务端受信 Process/Effect Host。",
  },
);

const externalAgentActionTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("WORKSPACE_PATH"),
    path: z.string().min(1).max(2_000),
  }),
  z.strictObject({
    kind: z.literal("ARTIFACT_REFERENCE"),
    reference: artifactReferenceSchema,
  }),
]);

export const externalAgentProcessEventSchema = z.discriminatedUnion("event_type", [
  z.strictObject({
    event_type: z.literal("OUTPUT_DELTA"),
    channel: z.enum(["stdout", "stderr"]),
    delta: z.string().min(1).max(EXTERNAL_AGENT_PUBLIC_OUTPUT_DELTA_MAX_CHARACTERS),
  }),
  z.strictObject({
    event_type: z.literal("AUDIT_ACTION"),
    action_kind: z.enum(["TOOL", "COMMAND"]),
    action: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]*$/),
    effect: z.enum(["READ", "WRITE"]),
    target: externalAgentActionTargetSchema,
    verdict: z.enum(["ALLOWED", "BLOCKED"]),
  }),
  z.strictObject({
    event_type: z.literal("PROCESS_EXITED"),
    exit_code: z.number().int().nonnegative().max(255),
    audit_receipt_ref: artifactReferenceFor("ExternalAgentAuditReceipt"),
  }),
]);

export type ExternalAgentProcessEvent = z.infer<typeof externalAgentProcessEventSchema>;

const disabledExternalAgentRegistrationSchema = z.strictObject({
  enabled: z.literal(false),
  profile: externalAgentProfileSchema,
  limits: externalAgentRuntimeLimitsSchema,
});

const enabledExternalAgentRegistrationSchema = z.strictObject({
  enabled: z.literal(true),
  profile: externalAgentProfileSchema,
  limits: externalAgentRuntimeLimitsSchema,
  process_host: externalAgentProcessHostSchema,
});

export const externalAgentRegistrationSchema = z
  .discriminatedUnion("enabled", [
    disabledExternalAgentRegistrationSchema,
    enabledExternalAgentRegistrationSchema,
  ])
  .superRefine((registration, ctx) => {
    if (registration.limits.max_timeout_ms > registration.profile.cancellation.timeout_ms) {
      ctx.addIssue({
        code: "custom",
        message: "External Agent 服务端超时上限不能超过 Profile 的取消超时。",
        path: ["limits", "max_timeout_ms"],
      });
    }
    if (
      registration.limits.max_termination_confirmation_ms >
      registration.profile.cancellation.timeout_ms
    ) {
      ctx.addIssue({
        code: "custom",
        message: "External Agent 终止确认上限不能超过 Profile 的取消超时。",
        path: ["limits", "max_termination_confirmation_ms"],
      });
    }
    if (registration.enabled && !registration.profile.cancellation.supported) {
      ctx.addIssue({
        code: "custom",
        message: "启用的 External Agent Profile 必须支持取消。",
        path: ["profile", "cancellation", "supported"],
      });
    }
  });

export type ExternalAgentRegistration = z.infer<typeof externalAgentRegistrationSchema>;
export type EnabledExternalAgentRegistration = Extract<
  ExternalAgentRegistration,
  { readonly enabled: true }
>;

export interface ExternalAgentRegistrationStatus {
  readonly profile_id: string;
  readonly profile_version: string;
  readonly scope: ExternalAgentProfile["scope"];
  readonly adapter: string;
  readonly enabled: boolean;
  readonly has_process_host: boolean;
}

export const externalAgentOutputScanResultSchema = z.strictObject({
  contains_secret: z.boolean(),
});

export const externalAgentOutputRedactionResultSchema = z.strictObject({
  delta: z.string().min(1).max(100_000_000),
});

export interface ExternalAgentOutputSecurity {
  scan(input: {
    readonly scope: AuthoritativeExternalAgentInvocation["scope"];
    readonly run_id: string;
    readonly invocation_id: string;
    readonly attempt_id: string;
    readonly channel: "stdout" | "stderr";
    readonly delta: string;
    readonly stream_final: true;
  }): Promise<unknown>;
  redact(input: {
    readonly scope: AuthoritativeExternalAgentInvocation["scope"];
    readonly run_id: string;
    readonly invocation_id: string;
    readonly attempt_id: string;
    readonly channel: "stdout" | "stderr";
    readonly delta: string;
    readonly stream_final: true;
  }): Promise<unknown>;
}

export interface ExternalAgentCompletionAuthority {
  authorize(input: {
    readonly receipt_ref: ExternalAgentAuditReceipt["receipt_ref"];
    readonly expectation: ExternalAgentAuditReceiptExpectation;
  }): Promise<AuthoritativeExternalAgentAuditReceipt>;
}
