import { Buffer } from "node:buffer";
import { isIP } from "node:net";
import { URL } from "node:url";
import {
  appScopeSchema,
  canonicalizeJson,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import type {
  RegisteredServerOwnedToolDescriptor,
  ServerOwnedToolRegistry,
} from "../tools/index.js";
import { isSameScope, taskEnvelopeSchema } from "./contracts.js";
import { l2TeamRoleSchema } from "./roles.js";

const httpsOriginSchema = z
  .string()
  .min(1)
  .max(2_000)
  .superRefine((value, ctx) => {
    try {
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        url.pathname !== "/" ||
        url.search !== "" ||
        url.hash !== "" ||
        url.origin !== value
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Tool Network Origin 必须是无凭据、无路径的规范 HTTPS Origin。",
        });
      }
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Tool Network Origin 必须是合法 URL Origin。",
      });
    }
  });

export const toolNetworkCandidateSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("NONE"),
  }),
  z.strictObject({
    mode: z.literal("HTTPS"),
    origin: httpsOriginSchema,
  }),
]);

export type ToolNetworkCandidate = z.infer<typeof toolNetworkCandidateSchema>;

export const toolCallCandidateSchema = z
  .strictObject({
    schema_version: versionIdentifierSchema,
    tool_call_id: immutableIdSchema,
    task_id: immutableIdSchema,
    attempt_id: immutableIdSchema,
    scope: appScopeSchema,
    run_id: immutableIdSchema,
    tool_name: versionIdentifierSchema,
    arguments: z.json(),
    network_access: toolNetworkCandidateSchema,
  })
  .superRefine((candidate, ctx) => {
    if (Buffer.byteLength(canonicalizeJson(candidate.arguments), "utf8") > 65_536) {
      ctx.addIssue({
        code: "custom",
        message: "Tool Call Arguments 超出字节上限。",
        path: ["arguments"],
      });
    }
  });

export type ToolCallCandidate = z.infer<typeof toolCallCandidateSchema>;

const toolPolicyFailureCodeSchema = z.enum([
  "TEAM_TOOL_ARGUMENTS_INVALID",
  "TEAM_TOOL_BUDGET_EXHAUSTED",
  "TEAM_TOOL_NETWORK_DENIED",
  "TEAM_TOOL_NETWORK_METADATA_REQUIRED",
  "TEAM_TOOL_NETWORK_ORIGIN_NOT_ALLOWED",
  "TEAM_TOOL_NETWORK_PRIVATE_ORIGIN",
  "TEAM_TOOL_NOT_ALLOWED",
  "TEAM_TOOL_NOT_REGISTERED",
  "TEAM_TOOL_REPLAY_RESULT_REQUIRED",
]);

export const toolPolicyFailureReceiptSchema = z.strictObject({
  schema_version: versionIdentifierSchema,
  receipt_kind: z.literal("TOOL_POLICY_FAILURE"),
  authority: z.literal("NON_AUTHORITATIVE_RUNTIME"),
  code: toolPolicyFailureCodeSchema,
  tool_call_id: immutableIdSchema,
  task_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  role: l2TeamRoleSchema,
  tool_name: versionIdentifierSchema,
  policy_version: versionIdentifierSchema,
});

export type ToolPolicyFailureReceipt = z.infer<typeof toolPolicyFailureReceiptSchema>;

export interface TeamToolBudgetReservationInput {
  readonly scope: z.infer<typeof appScopeSchema>;
  readonly run_id: string;
  readonly task_id: string;
  readonly attempt_id: string;
  readonly tool_call_id: string;
  readonly request_fingerprint: `sha256:${string}`;
  readonly max_tool_calls: number;
}

export type TeamToolBudgetReservationResult =
  | Readonly<{ status: "EXHAUSTED" }>
  | Readonly<{ status: "REPLAY"; ordinal: number }>
  | Readonly<{ status: "RESERVED"; ordinal: number }>;

export interface TeamToolBudgetReservationLedger {
  reserve(input: TeamToolBudgetReservationInput): Promise<TeamToolBudgetReservationResult>;
}

type ReservationRecord = Readonly<{
  request_fingerprint: `sha256:${string}`;
  ordinal: number;
}>;

export class InMemoryAtomicTeamToolBudgetReservationLedger
  implements TeamToolBudgetReservationLedger
{
  readonly #reservations = new Map<string, Map<string, ReservationRecord>>();

  async reserve(input: TeamToolBudgetReservationInput): Promise<TeamToolBudgetReservationResult> {
    const attemptKey = canonicalizeJson([
      input.scope.environment,
      input.scope.app_id,
      input.scope.tenant_id,
      input.run_id,
      input.task_id,
      input.attempt_id,
    ]);
    const reservations = this.#reservations.get(attemptKey) ?? new Map();
    const previous = reservations.get(input.tool_call_id);
    if (previous) {
      if (previous.request_fingerprint !== input.request_fingerprint) {
        throw new TeamToolCallCorrelationError(
          "相同 Tool Call ID 不能以不同参数、Policy 或 Budget 重放。",
          "TEAM_TOOL_RESERVATION_CONFLICT",
        );
      }
      return Object.freeze({
        status: "REPLAY",
        ordinal: previous.ordinal,
      });
    }
    if (reservations.size >= input.max_tool_calls) {
      return Object.freeze({ status: "EXHAUSTED" });
    }

    const record = Object.freeze({
      request_fingerprint: input.request_fingerprint,
      ordinal: reservations.size + 1,
    });
    reservations.set(input.tool_call_id, record);
    this.#reservations.set(attemptKey, reservations);
    return Object.freeze({
      status: "RESERVED",
      ordinal: record.ordinal,
    });
  }
}

declare const authorizedTeamToolCall: unique symbol;
const authorizedToolCalls = new WeakSet<object>();

export type AuthorizedTeamToolCall = ToolCallCandidate & {
  readonly budget_reservation: Readonly<{
    readonly status: "RESERVED";
    readonly ordinal: number;
  }>;
  readonly policy_version: string;
  readonly network_policy: z.infer<typeof taskEnvelopeSchema>["network_policy"];
  readonly [authorizedTeamToolCall]: true;
};

export type TeamToolAuthorization =
  | Readonly<{
      ok: true;
      value: AuthorizedTeamToolCall;
    }>
  | Readonly<{
      ok: false;
      failure_receipt: ToolPolicyFailureReceipt;
    }>;

export class TeamToolCallCorrelationError extends Error {
  override readonly name = "TeamToolCallCorrelationError";

  constructor(
    message: string,
    readonly code:
      | "TEAM_TOOL_CALL_CORRELATION_MISMATCH"
      | "TEAM_TOOL_RESERVATION_CONFLICT" = "TEAM_TOOL_CALL_CORRELATION_MISMATCH",
  ) {
    super(message);
  }
}

export interface TeamToolAuthorizationSecurity {
  readonly registry: ServerOwnedToolRegistry;
  readonly budget_ledger: TeamToolBudgetReservationLedger;
}

function failure(
  task: z.infer<typeof taskEnvelopeSchema>,
  candidate: ToolCallCandidate,
  code: z.infer<typeof toolPolicyFailureCodeSchema>,
): TeamToolAuthorization {
  const failureReceipt = toolPolicyFailureReceiptSchema.parse({
    schema_version: candidate.schema_version,
    receipt_kind: "TOOL_POLICY_FAILURE",
    authority: "NON_AUTHORITATIVE_RUNTIME",
    code,
    tool_call_id: candidate.tool_call_id,
    task_id: task.task_id,
    attempt_id: task.attempt_id,
    scope: task.scope,
    run_id: task.run_id,
    role: task.role,
    tool_name: candidate.tool_name,
    policy_version: task.policy_version,
  });
  return deepFreeze({
    ok: false,
    failure_receipt: failureReceipt,
  });
}

function parseIpv4(hostname: string): readonly number[] | null {
  const fields = hostname.split(".");
  if (fields.length !== 4 || fields.some((field) => !/^\d{1,3}$/.test(field))) {
    return null;
  }
  const bytes = fields.map(Number);
  return bytes.every((byte) => byte >= 0 && byte <= 255) ? bytes : null;
}

function isPrivateOrSpecialOrigin(origin: string): boolean {
  const parsed = new URL(origin);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal"
  ) {
    return true;
  }

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    const bytes = parseIpv4(hostname);
    if (!bytes) {
      return true;
    }
    const [first = -1, second = -1] = bytes;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0) ||
      (first === 192 && second === 168) ||
      first >= 224
    );
  }
  if (ipVersion === 6) {
    return (
      hostname === "::" ||
      hostname === "::1" ||
      hostname.startsWith("fc") ||
      hostname.startsWith("fd") ||
      /^fe[89ab]/.test(hostname) ||
      hostname.startsWith("ff") ||
      hostname.startsWith("::ffff:")
    );
  }
  return false;
}

function isPrivateOrSpecialIp(ip: string): boolean {
  if (isIP(ip) === 0) {
    return true;
  }
  const host = isIP(ip) === 6 ? `[${ip}]` : ip;
  return isPrivateOrSpecialOrigin(`https://${host}`);
}

function validateNetwork(
  task: z.infer<typeof taskEnvelopeSchema>,
  candidate: ToolCallCandidate,
  descriptorNetworkMode: "DENY" | "HTTPS",
): z.infer<typeof toolPolicyFailureCodeSchema> | null {
  if (descriptorNetworkMode === "DENY") {
    return candidate.network_access.mode === "NONE" ? null : "TEAM_TOOL_NETWORK_DENIED";
  }
  if (candidate.network_access.mode !== "HTTPS") {
    return "TEAM_TOOL_NETWORK_METADATA_REQUIRED";
  }
  if (task.network_policy.mode === "DENY") {
    return "TEAM_TOOL_NETWORK_DENIED";
  }
  if (isPrivateOrSpecialOrigin(candidate.network_access.origin)) {
    return "TEAM_TOOL_NETWORK_PRIVATE_ORIGIN";
  }
  return task.network_policy.allowed_origins.includes(candidate.network_access.origin)
    ? null
    : "TEAM_TOOL_NETWORK_ORIGIN_NOT_ALLOWED";
}

export async function authorizeTeamToolCall(
  taskInput: unknown,
  candidateInput: unknown,
  security: TeamToolAuthorizationSecurity,
): Promise<TeamToolAuthorization> {
  const task = taskEnvelopeSchema.parse(taskInput);
  const candidate = toolCallCandidateSchema.parse(candidateInput);
  if (
    candidate.schema_version !== task.schema_version ||
    candidate.task_id !== task.task_id ||
    candidate.attempt_id !== task.attempt_id ||
    !isSameScope(candidate.scope, task.scope) ||
    candidate.run_id !== task.run_id
  ) {
    throw new TeamToolCallCorrelationError(
      "Tool Call 必须绑定原始 Task、Attempt 与 App/Tenant/Environment/Run。",
    );
  }
  if (!task.tool_policy.allowlist.includes(candidate.tool_name)) {
    return failure(task, candidate, "TEAM_TOOL_NOT_ALLOWED");
  }

  let descriptor: RegisteredServerOwnedToolDescriptor;
  try {
    descriptor = security.registry.resolve(candidate.tool_name);
  } catch {
    return failure(task, candidate, "TEAM_TOOL_NOT_REGISTERED");
  }

  const parsedArguments = descriptor.input_schema.safeParse(candidate.arguments);
  if (!parsedArguments.success) {
    return failure(task, candidate, "TEAM_TOOL_ARGUMENTS_INVALID");
  }

  const networkFailure = validateNetwork(task, candidate, descriptor.network_access.mode);
  if (networkFailure) {
    return failure(task, candidate, networkFailure);
  }

  const requestFingerprint = await sha256ContentHash({
    candidate: {
      ...candidate,
      arguments: parsedArguments.data,
    },
    policy_version: task.policy_version,
    max_tool_calls: task.budget.max_tool_calls,
    descriptor_network_access: descriptor.network_access,
  });
  const reservation = await security.budget_ledger.reserve({
    scope: task.scope,
    run_id: task.run_id,
    task_id: task.task_id,
    attempt_id: task.attempt_id,
    tool_call_id: candidate.tool_call_id,
    request_fingerprint: requestFingerprint,
    max_tool_calls: task.budget.max_tool_calls,
  });
  if (reservation.status === "EXHAUSTED") {
    return failure(task, candidate, "TEAM_TOOL_BUDGET_EXHAUSTED");
  }
  if (reservation.status === "REPLAY") {
    return failure(task, candidate, "TEAM_TOOL_REPLAY_RESULT_REQUIRED");
  }

  const authorized = deepFreeze({
    ...candidate,
    arguments: parsedArguments.data,
    budget_reservation: {
      status: reservation.status,
      ordinal: reservation.ordinal,
    },
    policy_version: task.policy_version,
    network_policy: task.network_policy,
  });
  authorizedToolCalls.add(authorized);
  return deepFreeze({
    ok: true,
    value: authorized as AuthorizedTeamToolCall,
  });
}

export const teamToolSinkRevalidationReceiptSchema = z.strictObject({
  schema_version: versionIdentifierSchema,
  tool_call_id: immutableIdSchema,
  task_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  policy_version: versionIdentifierSchema,
  network_access: toolNetworkCandidateSchema,
  requested_origin: httpsOriginSchema.nullable(),
  final_origin: httpsOriginSchema.nullable(),
  redirect_origins: z.array(httpsOriginSchema).max(16),
  resolved_ips: z
    .array(
      z.string().superRefine((value, ctx) => {
        if (isIP(value) === 0) {
          ctx.addIssue({
            code: "custom",
            message: "Tool Sink resolved_ips 只能包含规范 IP Literal。",
          });
        }
      }),
    )
    .max(64),
  revalidated: z.literal(true),
});

export interface TeamToolSinkPolicyRevalidator {
  revalidate(input: AuthorizedTeamToolCall): Promise<unknown>;
}

declare const authoritativeTeamToolSinkInvocation: unique symbol;
const authoritativeSinkInvocations = new WeakSet<object>();
const attemptedSinkAuthorizations = new WeakSet<object>();

export type AuthoritativeTeamToolSinkInvocation = AuthorizedTeamToolCall & {
  readonly [authoritativeTeamToolSinkInvocation]: true;
};

export async function authorizeTeamToolSinkInvocation(
  input: AuthorizedTeamToolCall,
  revalidator: TeamToolSinkPolicyRevalidator,
): Promise<AuthoritativeTeamToolSinkInvocation> {
  if (typeof input !== "object" || input === null || !authorizedToolCalls.has(input)) {
    throw new TeamToolCallCorrelationError("Tool Sink 只接受运行时授权且已预留预算的调用。");
  }
  if (attemptedSinkAuthorizations.has(input)) {
    throw new TeamToolCallCorrelationError(
      "同一 Tool Call 的 Sink Authority 只能申请一次；重放必须解析已提交执行结果。",
    );
  }
  attemptedSinkAuthorizations.add(input);
  const receipt = teamToolSinkRevalidationReceiptSchema.parse(await revalidator.revalidate(input));
  if (
    receipt.schema_version !== input.schema_version ||
    receipt.tool_call_id !== input.tool_call_id ||
    receipt.task_id !== input.task_id ||
    receipt.attempt_id !== input.attempt_id ||
    !isSameScope(receipt.scope, input.scope) ||
    receipt.run_id !== input.run_id ||
    receipt.policy_version !== input.policy_version ||
    canonicalizeJson(receipt.network_access) !== canonicalizeJson(input.network_access)
  ) {
    throw new TeamToolCallCorrelationError(
      "Tool Sink 再校验 Receipt 必须绑定同一调用、Policy 与 Network Origin。",
    );
  }
  if (input.network_access.mode === "NONE") {
    if (
      receipt.requested_origin !== null ||
      receipt.final_origin !== null ||
      receipt.redirect_origins.length > 0 ||
      receipt.resolved_ips.length > 0
    ) {
      throw new TeamToolCallCorrelationError(
        "无网络 Tool 的 Sink Receipt 不能自报 DNS、Redirect 或 Origin。",
      );
    }
  } else {
    const allowedOrigins = new Set(input.network_policy.allowed_origins);
    const observedOrigins = [
      ...(receipt.final_origin === null ? [] : [receipt.final_origin]),
      ...receipt.redirect_origins,
    ];
    if (
      input.network_policy.mode !== "ALLOWLIST" ||
      receipt.requested_origin !== input.network_access.origin ||
      receipt.final_origin === null ||
      receipt.resolved_ips.length === 0 ||
      observedOrigins.some(
        (origin) => !allowedOrigins.has(origin) || isPrivateOrSpecialOrigin(origin),
      ) ||
      receipt.resolved_ips.some(isPrivateOrSpecialIp)
    ) {
      throw new TeamToolCallCorrelationError(
        "Tool Sink DNS/Redirect 结果必须仍属于 HTTPS Allowlist 且不能落入私网地址。",
      );
    }
  }
  authoritativeSinkInvocations.add(input);
  return input as AuthoritativeTeamToolSinkInvocation;
}

export function isAuthoritativeTeamToolSinkInvocation(
  input: unknown,
): input is AuthoritativeTeamToolSinkInvocation {
  return typeof input === "object" && input !== null && authoritativeSinkInvocations.has(input);
}
