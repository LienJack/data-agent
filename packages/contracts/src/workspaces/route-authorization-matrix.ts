import { z } from "zod";
import {
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  timestampSchema,
  versionIdentifierSchema,
} from "../common/index.js";

export const workspaceRouteRoleSchema = z.enum([
  "WORKSPACE_ADMIN",
  "WORKSPACE_ANALYST",
  "WORKSPACE_VIEWER",
  "WORKER",
]);

export const routeWorkspaceActionSchema = z.enum([
  "WORKSPACE_READ",
  "WORKSPACE_ADMINISTER",
  "RUN_CREATE",
  "RUN_READ",
  "FILE_REGISTER",
  "FILE_READ",
  "ARTIFACT_READ",
  "JOB_CREATE",
  "JOB_CONTROL",
  "SEMANTIC_BOOTSTRAP",
  "SEMANTIC_READ",
  "CONTEXT_COMPILE",
  "KNOWLEDGE_QUERY",
  "DATASOURCE_REGISTER",
  "DATASOURCE_READ",
  "EXTENSION_MANAGE",
  "FALCON_EVALUATE",
  "FALCON_RESULT_READ",
  "TOOL_INVOKE",
]);

const routeResourceKindSchema = z.enum([
  "WORKSPACE",
  "RUN",
  "FILE",
  "ARTIFACT",
  "JOB",
  "SEMANTIC",
  "CONTEXT",
  "KNOWLEDGE",
  "DATASOURCE",
  "EXTENSION",
  "FALCON",
  "TOOL",
]);

export const routeAuthorizationDescriptorSchema = z
  .strictObject({
    workspace_action: routeWorkspaceActionSchema,
    resource_kind: routeResourceKindSchema,
    resource_state_requirement: z.enum(["MUST_EXIST", "MUST_NOT_EXIST"]),
    allowed_roles: z.array(workspaceRouteRoleSchema).min(1),
    scope_requirement: z.literal("SAME_WORKSPACE"),
    ownership_requirement: z.enum(["ANY_WORKSPACE_MEMBER", "OWNER_OR_ADMIN", "ADMIN_OR_SERVER"]),
    access_mode: z.enum(["READ", "WRITE", "EXECUTE"]),
    expected_version: z.enum(["REQUIRED", "NOT_APPLICABLE"]),
    idempotency_key: z.enum(["REQUIRED", "NOT_APPLICABLE"]),
    task_capability: versionIdentifierSchema,
    audit_event: versionIdentifierSchema,
  })
  .superRefine((descriptor, ctx) => {
    if (new Set(descriptor.allowed_roles).size !== descriptor.allowed_roles.length) {
      ctx.addIssue({ code: "custom", message: "Route allowed role 必须唯一。" });
    }
    if (
      descriptor.resource_state_requirement === "MUST_NOT_EXIST" &&
      descriptor.expected_version !== "NOT_APPLICABLE"
    ) {
      ctx.addIssue({
        code: "custom",
        message: "新建或注册 Route 的目标必须不存在，不能要求既有 resource version。",
        path: ["expected_version"],
      });
    }
  });

export const routeAuthorizationMatrixSchema = z
  .array(routeAuthorizationDescriptorSchema)
  .length(routeWorkspaceActionSchema.options.length)
  .superRefine((matrix, ctx) => {
    const actions = new Set(matrix.map((descriptor) => descriptor.workspace_action));
    for (const action of routeWorkspaceActionSchema.options) {
      if (!actions.has(action)) {
        ctx.addIssue({ code: "custom", message: `Route Authorization action 缺失: ${action}` });
      }
    }
    if (actions.size !== matrix.length) {
      ctx.addIssue({ code: "custom", message: "Route Authorization action 必须唯一。" });
    }
  });

type RouteDescriptor = z.infer<typeof routeAuthorizationDescriptorSchema>;

function route(
  workspace_action: RouteDescriptor["workspace_action"],
  resource_kind: RouteDescriptor["resource_kind"],
  resource_state_requirement: RouteDescriptor["resource_state_requirement"],
  allowed_roles: readonly z.infer<typeof workspaceRouteRoleSchema>[],
  ownership_requirement: RouteDescriptor["ownership_requirement"],
  access_mode: RouteDescriptor["access_mode"],
  expected_version: RouteDescriptor["expected_version"],
  idempotency_key: RouteDescriptor["idempotency_key"],
  task_capability: string,
  audit_event: string,
) {
  return routeAuthorizationDescriptorSchema.parse({
    workspace_action,
    resource_kind,
    resource_state_requirement,
    allowed_roles,
    scope_requirement: "SAME_WORKSPACE",
    ownership_requirement,
    access_mode,
    expected_version,
    idempotency_key,
    task_capability,
    audit_event,
  });
}

export const ROUTE_AUTHORIZATION_MATRIX = deepFreeze(
  routeAuthorizationMatrixSchema.parse([
    route(
      "WORKSPACE_READ",
      "WORKSPACE",
      "MUST_EXIST",
      ["WORKSPACE_ADMIN", "WORKSPACE_ANALYST", "WORKSPACE_VIEWER", "WORKER"],
      "ANY_WORKSPACE_MEMBER",
      "READ",
      "NOT_APPLICABLE",
      "NOT_APPLICABLE",
      "workspace.read",
      "workspace.read",
    ),
    route(
      "WORKSPACE_ADMINISTER",
      "WORKSPACE",
      "MUST_EXIST",
      ["WORKSPACE_ADMIN"],
      "ADMIN_OR_SERVER",
      "WRITE",
      "REQUIRED",
      "REQUIRED",
      "workspace.administer",
      "workspace.administer",
    ),
    route(
      "RUN_CREATE",
      "RUN",
      "MUST_NOT_EXIST",
      ["WORKSPACE_ADMIN", "WORKSPACE_ANALYST"],
      "ANY_WORKSPACE_MEMBER",
      "WRITE",
      "NOT_APPLICABLE",
      "REQUIRED",
      "run.create",
      "run.create",
    ),
    route(
      "RUN_READ",
      "RUN",
      "MUST_EXIST",
      ["WORKSPACE_ADMIN", "WORKSPACE_ANALYST", "WORKSPACE_VIEWER", "WORKER"],
      "OWNER_OR_ADMIN",
      "READ",
      "NOT_APPLICABLE",
      "NOT_APPLICABLE",
      "run.read",
      "run.read",
    ),
    route(
      "FILE_REGISTER",
      "FILE",
      "MUST_NOT_EXIST",
      ["WORKSPACE_ADMIN", "WORKSPACE_ANALYST"],
      "ANY_WORKSPACE_MEMBER",
      "WRITE",
      "NOT_APPLICABLE",
      "REQUIRED",
      "file.register",
      "file.register",
    ),
    route(
      "FILE_READ",
      "FILE",
      "MUST_EXIST",
      ["WORKSPACE_ADMIN", "WORKSPACE_ANALYST", "WORKSPACE_VIEWER", "WORKER"],
      "OWNER_OR_ADMIN",
      "READ",
      "REQUIRED",
      "NOT_APPLICABLE",
      "file.read",
      "file.read",
    ),
    route(
      "ARTIFACT_READ",
      "ARTIFACT",
      "MUST_EXIST",
      ["WORKSPACE_ADMIN", "WORKSPACE_ANALYST", "WORKSPACE_VIEWER", "WORKER"],
      "OWNER_OR_ADMIN",
      "READ",
      "REQUIRED",
      "NOT_APPLICABLE",
      "artifact.read",
      "artifact.read",
    ),
    route(
      "JOB_CREATE",
      "JOB",
      "MUST_NOT_EXIST",
      ["WORKSPACE_ADMIN", "WORKSPACE_ANALYST", "WORKER"],
      "ANY_WORKSPACE_MEMBER",
      "WRITE",
      "NOT_APPLICABLE",
      "REQUIRED",
      "job.create",
      "job.create",
    ),
    route(
      "JOB_CONTROL",
      "JOB",
      "MUST_EXIST",
      ["WORKSPACE_ADMIN", "WORKSPACE_ANALYST", "WORKER"],
      "OWNER_OR_ADMIN",
      "WRITE",
      "REQUIRED",
      "REQUIRED",
      "job.control",
      "job.control",
    ),
    route(
      "SEMANTIC_BOOTSTRAP",
      "SEMANTIC",
      "MUST_EXIST",
      ["WORKSPACE_ADMIN", "WORKER"],
      "ADMIN_OR_SERVER",
      "EXECUTE",
      "REQUIRED",
      "REQUIRED",
      "semantic.bootstrap",
      "semantic.bootstrap",
    ),
    route(
      "SEMANTIC_READ",
      "SEMANTIC",
      "MUST_EXIST",
      ["WORKSPACE_ADMIN", "WORKSPACE_ANALYST", "WORKSPACE_VIEWER", "WORKER"],
      "ANY_WORKSPACE_MEMBER",
      "READ",
      "REQUIRED",
      "NOT_APPLICABLE",
      "semantic.read",
      "semantic.read",
    ),
    route(
      "CONTEXT_COMPILE",
      "CONTEXT",
      "MUST_EXIST",
      ["WORKSPACE_ADMIN", "WORKSPACE_ANALYST", "WORKER"],
      "OWNER_OR_ADMIN",
      "EXECUTE",
      "REQUIRED",
      "REQUIRED",
      "context.compile",
      "context.compile",
    ),
    route(
      "KNOWLEDGE_QUERY",
      "KNOWLEDGE",
      "MUST_EXIST",
      ["WORKSPACE_ADMIN", "WORKSPACE_ANALYST", "WORKER"],
      "ANY_WORKSPACE_MEMBER",
      "READ",
      "REQUIRED",
      "NOT_APPLICABLE",
      "knowledge.query",
      "knowledge.query",
    ),
    route(
      "DATASOURCE_REGISTER",
      "DATASOURCE",
      "MUST_NOT_EXIST",
      ["WORKSPACE_ADMIN"],
      "ADMIN_OR_SERVER",
      "WRITE",
      "NOT_APPLICABLE",
      "REQUIRED",
      "datasource.register",
      "datasource.register",
    ),
    route(
      "DATASOURCE_READ",
      "DATASOURCE",
      "MUST_EXIST",
      ["WORKSPACE_ADMIN", "WORKSPACE_ANALYST", "WORKER"],
      "ANY_WORKSPACE_MEMBER",
      "READ",
      "REQUIRED",
      "NOT_APPLICABLE",
      "datasource.read",
      "datasource.read",
    ),
    route(
      "EXTENSION_MANAGE",
      "EXTENSION",
      "MUST_EXIST",
      ["WORKSPACE_ADMIN"],
      "ADMIN_OR_SERVER",
      "WRITE",
      "REQUIRED",
      "REQUIRED",
      "extension.manage",
      "extension.manage",
    ),
    route(
      "FALCON_EVALUATE",
      "FALCON",
      "MUST_EXIST",
      ["WORKSPACE_ADMIN", "WORKER"],
      "ADMIN_OR_SERVER",
      "EXECUTE",
      "REQUIRED",
      "REQUIRED",
      "falcon.evaluate",
      "falcon.evaluate",
    ),
    route(
      "FALCON_RESULT_READ",
      "FALCON",
      "MUST_EXIST",
      ["WORKSPACE_ADMIN", "WORKSPACE_ANALYST", "WORKSPACE_VIEWER", "WORKER"],
      "ANY_WORKSPACE_MEMBER",
      "READ",
      "REQUIRED",
      "NOT_APPLICABLE",
      "falcon.result.read",
      "falcon.result.read",
    ),
    route(
      "TOOL_INVOKE",
      "TOOL",
      "MUST_EXIST",
      ["WORKSPACE_ADMIN", "WORKSPACE_ANALYST", "WORKER"],
      "OWNER_OR_ADMIN",
      "EXECUTE",
      "REQUIRED",
      "REQUIRED",
      "tool.invoke",
      "tool.invoke",
    ),
  ]),
);

const routeByAction = new Map(
  ROUTE_AUTHORIZATION_MATRIX.map(
    (descriptor) => [descriptor.workspace_action, descriptor] as const,
  ),
);

export const routeInvocationChannelSchema = z.enum(["API", "UI", "TOOL", "WORKER"]);
const routeResourceVersionSchema = z.number().int().min(0);
const routeIdempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/);

export const routeAuthorizationInputSchema = z.strictObject({
  action: routeWorkspaceActionSchema,
  invocation_channel: routeInvocationChannelSchema,
  resource_id: immutableIdSchema,
  expected_version: routeResourceVersionSchema.nullable(),
  idempotency_key: routeIdempotencyKeySchema.nullable(),
  request_hash: contentHashSchema,
});

const humanRoutePrincipalSchema = z.strictObject({
  kind: z.literal("HUMAN"),
  principal_id: immutableIdSchema,
  workspace_id: immutableIdSchema,
  role: z.enum(["WORKSPACE_ADMIN", "WORKSPACE_ANALYST", "WORKSPACE_VIEWER"]),
});

const serviceRoutePrincipalSchema = z.strictObject({
  kind: z.literal("SERVICE"),
  principal_id: immutableIdSchema,
  workspace_id: immutableIdSchema,
  role: z.literal("WORKER"),
});

const routeIdempotencyAuthoritySchema = z.strictObject({
  status: z.enum(["RESERVED", "REPLAY_SAME_REQUEST"]),
  reservation_id: immutableIdSchema,
  idempotency_key: routeIdempotencyKeySchema,
  request_hash: contentHashSchema,
  expires_at: timestampSchema,
});

export const serverResolvedRouteAuthorityFactsSchema = z
  .strictObject({
    schema_version: z.literal("server-resolved-route-authority@2.0.0"),
    resolution_id: immutableIdSchema,
    resolution_hash: contentHashSchema,
    resolver_id: versionIdentifierSchema,
    provenance: z.literal("SERVER_RESOLVED"),
    binding: z.strictObject({
      action: routeWorkspaceActionSchema,
      invocation_channel: routeInvocationChannelSchema,
      workspace_id: immutableIdSchema,
      principal_id: immutableIdSchema,
      principal_kind: z.enum(["HUMAN", "SERVICE"]),
      principal_role: workspaceRouteRoleSchema,
      resource_id: immutableIdSchema,
      resource_kind: routeResourceKindSchema,
      task_capability: versionIdentifierSchema,
      expected_version: routeResourceVersionSchema.nullable(),
      idempotency_key: routeIdempotencyKeySchema.nullable(),
      request_hash: contentHashSchema,
    }),
    principal: z.discriminatedUnion("kind", [
      humanRoutePrincipalSchema,
      serviceRoutePrincipalSchema,
    ]),
    resource: z.strictObject({
      resource_id: immutableIdSchema,
      resource_kind: routeResourceKindSchema,
      exists: z.boolean(),
      workspace_id: immutableIdSchema,
      owner_principal_id: immutableIdSchema.nullable(),
      current_version: routeResourceVersionSchema.nullable(),
    }),
    task_capabilities: z.array(versionIdentifierSchema).max(1_000),
    idempotency: routeIdempotencyAuthoritySchema.nullable(),
    evidence_hash: contentHashSchema,
    resolved_at: timestampSchema,
    expires_at: timestampSchema,
  })
  .superRefine((facts, ctx) => {
    if (
      facts.principal.principal_id !== facts.binding.principal_id ||
      facts.principal.workspace_id !== facts.binding.workspace_id ||
      facts.principal.kind !== facts.binding.principal_kind ||
      facts.principal.role !== facts.binding.principal_role
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Authority principal identity 与 binding 不一致。",
        path: ["principal"],
      });
    }
    if (
      facts.resource.resource_id !== facts.binding.resource_id ||
      facts.resource.resource_kind !== facts.binding.resource_kind ||
      facts.resource.workspace_id !== facts.binding.workspace_id
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Authority resource identity、kind 或 workspace 与 binding 不一致。",
        path: ["resource"],
      });
    }
    if (
      (!facts.resource.exists &&
        (facts.resource.owner_principal_id !== null || facts.resource.current_version !== null)) ||
      (facts.resource.exists && facts.resource.current_version === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Authority resource existence 必须与 owner/current version facts 一致。",
        path: ["resource"],
      });
    }
    if (
      (facts.principal.kind === "SERVICE" && facts.binding.invocation_channel !== "WORKER") ||
      (facts.principal.kind === "HUMAN" && facts.binding.invocation_channel === "WORKER")
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Authority principal kind 与 invocation channel 不一致。",
        path: ["binding", "invocation_channel"],
      });
    }
    if (new Set(facts.task_capabilities).size !== facts.task_capabilities.length) {
      ctx.addIssue({
        code: "custom",
        message: "Authority task capability 必须唯一。",
        path: ["task_capabilities"],
      });
    }
    if (Date.parse(facts.expires_at) <= Date.parse(facts.resolved_at)) {
      ctx.addIssue({
        code: "custom",
        message: "Authority expiry 必须晚于 resolved time。",
        path: ["expires_at"],
      });
    }
  });

export interface RouteAuthorityResolverPort {
  /** Resolve only from authenticated membership, resource and server task authority. */
  resolve(request: RouteAuthorizationInput): Promise<unknown>;
  /** Server-owned clock used for freshness checks; transport input never supplies it. */
  currentTime(): string | Promise<string>;
}

export class RouteAuthorityEvidenceError extends Error {
  override readonly name = "RouteAuthorityEvidenceError";
  readonly code = "ROUTE_AUTHORITY_RESOLVER_REQUIRED";
}

export const routeAuthorizationReasonSchema = z.enum([
  "AUTHORIZED",
  "RESOURCE_NOT_FOUND_OR_FORBIDDEN",
  "RESOURCE_ALREADY_EXISTS",
  "WORKSPACE_SCOPE_MISMATCH",
  "ROLE_FORBIDDEN",
  "OWNERSHIP_FORBIDDEN",
  "EXPECTED_VERSION_REQUIRED",
  "EXPECTED_VERSION_NOT_APPLICABLE",
  "EXPECTED_VERSION_MISMATCH",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_NOT_APPLICABLE",
  "IDEMPOTENCY_REPLAY_RECORDED_RESULT",
  "TASK_CAPABILITY_REQUIRED",
  "AUTHORITY_REQUIRED",
  "AUTHORITY_BINDING_MISMATCH",
  "AUTHORITY_EXPIRED",
]);

export const routeAuthorizationDecisionSchema = z
  .strictObject({
    authorized: z.boolean(),
    reason_code: routeAuthorizationReasonSchema,
    execution_disposition: z.enum(["EXECUTE_NEW", "RETURN_RECORDED_RESULT", "DENY"]),
    workspace_action: routeWorkspaceActionSchema,
    audit_event: versionIdentifierSchema,
    binding: z.strictObject({
      resolution_id: immutableIdSchema,
      resolution_hash: contentHashSchema,
      evidence_hash: contentHashSchema,
      resolver_id: versionIdentifierSchema,
      authority_resolved_at: timestampSchema,
      authority_expires_at: timestampSchema,
      authority_evaluated_at: timestampSchema,
      action: routeWorkspaceActionSchema,
      invocation_channel: routeInvocationChannelSchema,
      workspace_id: immutableIdSchema,
      principal_id: immutableIdSchema,
      principal_kind: z.enum(["HUMAN", "SERVICE"]),
      principal_role: workspaceRouteRoleSchema,
      resource_id: immutableIdSchema,
      resource_kind: routeResourceKindSchema,
      resource_state_requirement: z.enum(["MUST_EXIST", "MUST_NOT_EXIST"]),
      task_capability: versionIdentifierSchema,
      expected_version: routeResourceVersionSchema.nullable(),
      current_version: routeResourceVersionSchema.nullable(),
      idempotency_key: routeIdempotencyKeySchema.nullable(),
      idempotency_status: z.enum(["RESERVED", "REPLAY_SAME_REQUEST"]).nullable(),
      idempotency_reservation_id: immutableIdSchema.nullable(),
      idempotency_expires_at: timestampSchema.nullable(),
      request_hash: contentHashSchema,
    }),
  })
  .superRefine((decision, ctx) => {
    const expectedDisposition =
      decision.reason_code === "AUTHORIZED"
        ? "EXECUTE_NEW"
        : decision.reason_code === "IDEMPOTENCY_REPLAY_RECORDED_RESULT"
          ? "RETURN_RECORDED_RESULT"
          : "DENY";
    if (
      decision.authorized !== (decision.reason_code === "AUTHORIZED") ||
      decision.execution_disposition !== expectedDisposition
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Route decision authorized/reason/disposition invariant 不一致。",
      });
    }
  });

function isAuthorityResolverPort(input: unknown): input is RouteAuthorityResolverPort {
  return (
    typeof input === "object" &&
    input !== null &&
    "resolve" in input &&
    typeof input.resolve === "function" &&
    "currentTime" in input &&
    typeof input.currentTime === "function"
  );
}

export async function authorizeWorkspaceRoute(
  input: unknown,
  authorityPort: RouteAuthorityResolverPort,
) {
  const request = routeAuthorizationInputSchema.parse(input);
  if (!isAuthorityResolverPort(authorityPort)) {
    throw new RouteAuthorityEvidenceError(
      "Route Authorization requires a server Authority Resolver Port; raw facts are forbidden.",
    );
  }
  const descriptor = routeByAction.get(request.action);
  if (!descriptor) {
    throw new Error(`Route Authorization Matrix 缺少 action: ${request.action}`);
  }

  const authorityFacts = serverResolvedRouteAuthorityFactsSchema.parse(
    await authorityPort.resolve(request),
  );
  const trustedNow = timestampSchema.parse(await authorityPort.currentTime());

  let reason: z.infer<typeof routeAuthorizationReasonSchema> = "AUTHORIZED";
  if (
    authorityFacts.binding.action !== request.action ||
    authorityFacts.binding.invocation_channel !== request.invocation_channel ||
    authorityFacts.binding.resource_id !== request.resource_id ||
    authorityFacts.binding.resource_kind !== descriptor.resource_kind ||
    authorityFacts.binding.task_capability !== descriptor.task_capability ||
    authorityFacts.binding.expected_version !== request.expected_version ||
    authorityFacts.binding.idempotency_key !== request.idempotency_key ||
    authorityFacts.binding.request_hash !== request.request_hash
  ) {
    reason = "AUTHORITY_BINDING_MISMATCH";
  } else if (
    Date.parse(trustedNow) < Date.parse(authorityFacts.resolved_at) ||
    Date.parse(trustedNow) >= Date.parse(authorityFacts.expires_at)
  ) {
    reason = "AUTHORITY_EXPIRED";
  } else if (
    authorityFacts.principal.workspace_id !== authorityFacts.resource.workspace_id ||
    descriptor.scope_requirement !== "SAME_WORKSPACE"
  ) {
    reason = "WORKSPACE_SCOPE_MISMATCH";
  } else if (!descriptor.allowed_roles.includes(authorityFacts.principal.role)) {
    reason = "ROLE_FORBIDDEN";
  } else if (
    descriptor.ownership_requirement === "OWNER_OR_ADMIN" &&
    authorityFacts.principal.role !== "WORKSPACE_ADMIN" &&
    authorityFacts.resource.owner_principal_id !== authorityFacts.principal.principal_id
  ) {
    reason = "OWNERSHIP_FORBIDDEN";
  } else if (
    descriptor.ownership_requirement === "ADMIN_OR_SERVER" &&
    authorityFacts.principal.role !== "WORKSPACE_ADMIN" &&
    authorityFacts.principal.kind !== "SERVICE"
  ) {
    reason = "OWNERSHIP_FORBIDDEN";
  } else if (
    descriptor.expected_version === "NOT_APPLICABLE" &&
    request.expected_version !== null
  ) {
    reason = "EXPECTED_VERSION_NOT_APPLICABLE";
  } else if (descriptor.expected_version === "REQUIRED" && request.expected_version === null) {
    reason = "EXPECTED_VERSION_REQUIRED";
  } else if (descriptor.idempotency_key === "NOT_APPLICABLE" && request.idempotency_key !== null) {
    reason = "IDEMPOTENCY_KEY_NOT_APPLICABLE";
  } else if (descriptor.idempotency_key === "REQUIRED" && request.idempotency_key === null) {
    reason = "IDEMPOTENCY_KEY_REQUIRED";
  } else if (descriptor.idempotency_key === "REQUIRED" && authorityFacts.idempotency === null) {
    reason = "AUTHORITY_REQUIRED";
  } else if (
    descriptor.idempotency_key === "REQUIRED" &&
    authorityFacts.idempotency !== null &&
    (authorityFacts.idempotency.idempotency_key !== request.idempotency_key ||
      authorityFacts.idempotency.request_hash !== request.request_hash)
  ) {
    reason = "AUTHORITY_BINDING_MISMATCH";
  } else if (
    authorityFacts.idempotency !== null &&
    (authorityFacts.idempotency.idempotency_key !== request.idempotency_key ||
      authorityFacts.idempotency.request_hash !== request.request_hash)
  ) {
    reason = "AUTHORITY_BINDING_MISMATCH";
  } else if (
    authorityFacts.idempotency !== null &&
    Date.parse(trustedNow) >= Date.parse(authorityFacts.idempotency.expires_at)
  ) {
    reason = "AUTHORITY_EXPIRED";
  } else if (!authorityFacts.task_capabilities.includes(descriptor.task_capability)) {
    reason = "TASK_CAPABILITY_REQUIRED";
  } else if (authorityFacts.idempotency?.status === "REPLAY_SAME_REQUEST") {
    reason = "IDEMPOTENCY_REPLAY_RECORDED_RESULT";
  } else if (
    descriptor.resource_state_requirement === "MUST_EXIST" &&
    !authorityFacts.resource.exists
  ) {
    reason = "RESOURCE_NOT_FOUND_OR_FORBIDDEN";
  } else if (
    descriptor.resource_state_requirement === "MUST_NOT_EXIST" &&
    authorityFacts.resource.exists
  ) {
    reason = "RESOURCE_ALREADY_EXISTS";
  } else if (
    descriptor.expected_version === "REQUIRED" &&
    request.expected_version !== authorityFacts.resource.current_version
  ) {
    reason = "EXPECTED_VERSION_MISMATCH";
  }

  const executionDisposition =
    reason === "AUTHORIZED"
      ? "EXECUTE_NEW"
      : reason === "IDEMPOTENCY_REPLAY_RECORDED_RESULT"
        ? "RETURN_RECORDED_RESULT"
        : "DENY";

  return deepFreeze(
    routeAuthorizationDecisionSchema.parse({
      authorized: reason === "AUTHORIZED",
      reason_code: reason,
      execution_disposition: executionDisposition,
      workspace_action: request.action,
      audit_event: descriptor.audit_event,
      binding: {
        resolution_id: authorityFacts.resolution_id,
        resolution_hash: authorityFacts.resolution_hash,
        evidence_hash: authorityFacts.evidence_hash,
        resolver_id: authorityFacts.resolver_id,
        authority_resolved_at: authorityFacts.resolved_at,
        authority_expires_at: authorityFacts.expires_at,
        authority_evaluated_at: trustedNow,
        action: request.action,
        invocation_channel: request.invocation_channel,
        workspace_id: authorityFacts.resource.workspace_id,
        principal_id: authorityFacts.principal.principal_id,
        principal_kind: authorityFacts.principal.kind,
        principal_role: authorityFacts.principal.role,
        resource_id: authorityFacts.resource.resource_id,
        resource_kind: authorityFacts.resource.resource_kind,
        resource_state_requirement: descriptor.resource_state_requirement,
        task_capability: descriptor.task_capability,
        expected_version: request.expected_version,
        current_version: authorityFacts.resource.current_version,
        idempotency_key: request.idempotency_key,
        idempotency_status: authorityFacts.idempotency?.status ?? null,
        idempotency_reservation_id: authorityFacts.idempotency?.reservation_id ?? null,
        idempotency_expires_at: authorityFacts.idempotency?.expires_at ?? null,
        request_hash: request.request_hash,
      },
    }),
  );
}

export type RouteWorkspaceAction = z.infer<typeof routeWorkspaceActionSchema>;
export type RouteAuthorizationDescriptor = z.infer<typeof routeAuthorizationDescriptorSchema>;
export type RouteAuthorizationInput = z.infer<typeof routeAuthorizationInputSchema>;
export type ServerResolvedRouteAuthorityFacts = z.infer<
  typeof serverResolvedRouteAuthorityFactsSchema
>;
export type RouteAuthorizationDecision = z.infer<typeof routeAuthorizationDecisionSchema>;
