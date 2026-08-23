import { describe, expect, it } from "vitest";
import {
  authorizeWorkspaceRoute,
  greenfieldBootstrapInputSchema,
  ROUTE_AUTHORIZATION_MATRIX,
  type RouteAuthorityResolverPort,
  type RouteAuthorizationDescriptor,
  type RouteAuthorizationInput,
  routeAuthorizationDecisionSchema,
} from "../packages/contracts/src/capabilities/index.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const principalId = "00000000-0000-4000-8000-000000000002";
const resourceId = "00000000-0000-4000-8000-000000000003";
const resolutionId = "00000000-0000-4000-8000-000000000004";
const reservationId = "00000000-0000-4000-8000-000000000005";
const now = "2026-08-16T08:00:00.000Z";
const resolvedAt = "2026-08-16T07:59:00.000Z";
const expiresAt = "2026-08-16T08:01:00.000Z";
const requestHash = `sha256:${"1".repeat(64)}`;
const otherRequestHash = `sha256:${"2".repeat(64)}`;
const evidenceHash = `sha256:${"a".repeat(64)}`;
const resolutionHash = `sha256:${"b".repeat(64)}`;

type AuthorityOptions = {
  action?: RouteAuthorizationInput["action"];
  channel?: RouteAuthorizationInput["invocation_channel"];
  resourceId?: string;
  resourceKind?: RouteAuthorizationDescriptor["resource_kind"];
  exists?: boolean;
  workspaceId?: string;
  principalWorkspaceId?: string;
  resourceWorkspaceId?: string;
  ownerPrincipalId?: string | null;
  principalId?: string;
  role?: "WORKSPACE_ADMIN" | "WORKSPACE_ANALYST" | "WORKSPACE_VIEWER" | "WORKER";
  capabilities?: string[];
  boundCapability?: string;
  expectedVersion?: number | null;
  currentVersion?: number | null;
  idempotencyKey?: string | null;
  idempotency?: null | {
    status: "RESERVED" | "REPLAY_SAME_REQUEST";
    key: string;
    requestHash: string;
    expiresAt?: string;
  };
  requestHash?: string;
  resolvedAt?: string;
  expiresAt?: string;
  now?: string;
};

function requestFor(
  descriptor: RouteAuthorizationDescriptor,
  overrides: Partial<RouteAuthorizationInput> = {},
): RouteAuthorizationInput {
  return {
    action: descriptor.workspace_action,
    invocation_channel: "API",
    resource_id: resourceId,
    expected_version: descriptor.expected_version === "REQUIRED" ? 7 : null,
    idempotency_key:
      descriptor.idempotency_key === "REQUIRED" ? `u1-${descriptor.workspace_action}` : null,
    request_hash: requestHash,
    ...overrides,
  };
}

function authorityPortFor(
  descriptor: RouteAuthorizationDescriptor,
  request: RouteAuthorizationInput,
  options: AuthorityOptions = {},
): RouteAuthorityResolverPort {
  const role = options.role ?? "WORKSPACE_ADMIN";
  const servicePrincipal = role === "WORKER";
  const exists = options.exists ?? descriptor.resource_state_requirement === "MUST_EXIST";
  const expectedVersion = options.expectedVersion ?? request.expected_version;
  const idempotencyKey = options.idempotencyKey ?? request.idempotency_key;
  const authorityRequestHash = options.requestHash ?? request.request_hash;
  const defaultIdempotency =
    descriptor.idempotency_key === "REQUIRED" && idempotencyKey !== null
      ? {
          status: "RESERVED" as const,
          key: idempotencyKey,
          requestHash: authorityRequestHash,
        }
      : null;
  const idempotency = options.idempotency === undefined ? defaultIdempotency : options.idempotency;
  const boundResourceId = options.resourceId ?? request.resource_id;
  const boundWorkspaceId = options.workspaceId ?? workspaceId;
  const boundPrincipalId = options.principalId ?? principalId;
  const facts = {
    schema_version: "server-resolved-route-authority@2.0.0",
    resolution_id: resolutionId,
    resolution_hash: resolutionHash,
    resolver_id: "workspace-route-authority-v2",
    provenance: "SERVER_RESOLVED",
    binding: {
      action: options.action ?? request.action,
      invocation_channel: options.channel ?? request.invocation_channel,
      workspace_id: boundWorkspaceId,
      principal_id: boundPrincipalId,
      principal_kind: servicePrincipal ? "SERVICE" : "HUMAN",
      principal_role: role,
      resource_id: boundResourceId,
      resource_kind: options.resourceKind ?? descriptor.resource_kind,
      task_capability: options.boundCapability ?? descriptor.task_capability,
      expected_version: expectedVersion,
      idempotency_key: idempotencyKey,
      request_hash: authorityRequestHash,
    },
    principal: servicePrincipal
      ? {
          kind: "SERVICE",
          principal_id: boundPrincipalId,
          workspace_id: options.principalWorkspaceId ?? boundWorkspaceId,
          role: "WORKER",
        }
      : {
          kind: "HUMAN",
          principal_id: boundPrincipalId,
          workspace_id: options.principalWorkspaceId ?? boundWorkspaceId,
          role,
        },
    resource: {
      resource_id: boundResourceId,
      resource_kind: options.resourceKind ?? descriptor.resource_kind,
      exists,
      workspace_id: options.resourceWorkspaceId ?? boundWorkspaceId,
      owner_principal_id:
        options.ownerPrincipalId === undefined
          ? exists
            ? boundPrincipalId
            : null
          : options.ownerPrincipalId,
      current_version:
        options.currentVersion === undefined ? (exists ? 7 : null) : options.currentVersion,
    },
    task_capabilities: options.capabilities ?? [descriptor.task_capability],
    idempotency:
      idempotency === null
        ? null
        : {
            status: idempotency.status,
            reservation_id: reservationId,
            idempotency_key: idempotency.key,
            request_hash: idempotency.requestHash,
            expires_at: idempotency.expiresAt ?? expiresAt,
          },
    evidence_hash: evidenceHash,
    resolved_at: options.resolvedAt ?? resolvedAt,
    expires_at: options.expiresAt ?? expiresAt,
  } as const;
  return {
    resolve: async () => facts,
    currentTime: () => options.now ?? now,
  };
}

describe("DataFoundry CoA Greenfield U1 integration", () => {
  it("freezes all 18 route descriptors including create target state", () => {
    const frozen = ROUTE_AUTHORIZATION_MATRIX.map((descriptor) => [
      descriptor.workspace_action,
      descriptor.resource_kind,
      descriptor.resource_state_requirement,
      descriptor.allowed_roles.join("+"),
      descriptor.ownership_requirement,
      descriptor.access_mode,
      descriptor.expected_version,
      descriptor.idempotency_key,
      descriptor.task_capability,
      descriptor.audit_event,
    ]);
    expect(frozen).toEqual([
      [
        "WORKSPACE_READ",
        "WORKSPACE",
        "MUST_EXIST",
        "WORKSPACE_ADMIN+WORKSPACE_ANALYST+WORKSPACE_VIEWER+WORKER",
        "ANY_WORKSPACE_MEMBER",
        "READ",
        "NOT_APPLICABLE",
        "NOT_APPLICABLE",
        "workspace.read",
        "workspace.read",
      ],
      [
        "WORKSPACE_ADMINISTER",
        "WORKSPACE",
        "MUST_EXIST",
        "WORKSPACE_ADMIN",
        "ADMIN_OR_SERVER",
        "WRITE",
        "REQUIRED",
        "REQUIRED",
        "workspace.administer",
        "workspace.administer",
      ],
      [
        "RUN_CREATE",
        "RUN",
        "MUST_NOT_EXIST",
        "WORKSPACE_ADMIN+WORKSPACE_ANALYST",
        "ANY_WORKSPACE_MEMBER",
        "WRITE",
        "NOT_APPLICABLE",
        "REQUIRED",
        "run.create",
        "run.create",
      ],
      [
        "RUN_READ",
        "RUN",
        "MUST_EXIST",
        "WORKSPACE_ADMIN+WORKSPACE_ANALYST+WORKSPACE_VIEWER+WORKER",
        "OWNER_OR_ADMIN",
        "READ",
        "NOT_APPLICABLE",
        "NOT_APPLICABLE",
        "run.read",
        "run.read",
      ],
      [
        "FILE_REGISTER",
        "FILE",
        "MUST_NOT_EXIST",
        "WORKSPACE_ADMIN+WORKSPACE_ANALYST",
        "ANY_WORKSPACE_MEMBER",
        "WRITE",
        "NOT_APPLICABLE",
        "REQUIRED",
        "file.register",
        "file.register",
      ],
      [
        "FILE_READ",
        "FILE",
        "MUST_EXIST",
        "WORKSPACE_ADMIN+WORKSPACE_ANALYST+WORKSPACE_VIEWER+WORKER",
        "OWNER_OR_ADMIN",
        "READ",
        "REQUIRED",
        "NOT_APPLICABLE",
        "file.read",
        "file.read",
      ],
      [
        "ARTIFACT_READ",
        "ARTIFACT",
        "MUST_EXIST",
        "WORKSPACE_ADMIN+WORKSPACE_ANALYST+WORKSPACE_VIEWER+WORKER",
        "OWNER_OR_ADMIN",
        "READ",
        "REQUIRED",
        "NOT_APPLICABLE",
        "artifact.read",
        "artifact.read",
      ],
      [
        "JOB_CREATE",
        "JOB",
        "MUST_NOT_EXIST",
        "WORKSPACE_ADMIN+WORKSPACE_ANALYST+WORKER",
        "ANY_WORKSPACE_MEMBER",
        "WRITE",
        "NOT_APPLICABLE",
        "REQUIRED",
        "job.create",
        "job.create",
      ],
      [
        "JOB_CONTROL",
        "JOB",
        "MUST_EXIST",
        "WORKSPACE_ADMIN+WORKSPACE_ANALYST+WORKER",
        "OWNER_OR_ADMIN",
        "WRITE",
        "REQUIRED",
        "REQUIRED",
        "job.control",
        "job.control",
      ],
      [
        "SEMANTIC_BOOTSTRAP",
        "SEMANTIC",
        "MUST_EXIST",
        "WORKSPACE_ADMIN+WORKER",
        "ADMIN_OR_SERVER",
        "EXECUTE",
        "REQUIRED",
        "REQUIRED",
        "semantic.bootstrap",
        "semantic.bootstrap",
      ],
      [
        "SEMANTIC_READ",
        "SEMANTIC",
        "MUST_EXIST",
        "WORKSPACE_ADMIN+WORKSPACE_ANALYST+WORKSPACE_VIEWER+WORKER",
        "ANY_WORKSPACE_MEMBER",
        "READ",
        "REQUIRED",
        "NOT_APPLICABLE",
        "semantic.read",
        "semantic.read",
      ],
      [
        "CONTEXT_COMPILE",
        "CONTEXT",
        "MUST_EXIST",
        "WORKSPACE_ADMIN+WORKSPACE_ANALYST+WORKER",
        "OWNER_OR_ADMIN",
        "EXECUTE",
        "REQUIRED",
        "REQUIRED",
        "context.compile",
        "context.compile",
      ],
      [
        "KNOWLEDGE_QUERY",
        "KNOWLEDGE",
        "MUST_EXIST",
        "WORKSPACE_ADMIN+WORKSPACE_ANALYST+WORKER",
        "ANY_WORKSPACE_MEMBER",
        "READ",
        "REQUIRED",
        "NOT_APPLICABLE",
        "knowledge.query",
        "knowledge.query",
      ],
      [
        "DATASOURCE_REGISTER",
        "DATASOURCE",
        "MUST_NOT_EXIST",
        "WORKSPACE_ADMIN",
        "ADMIN_OR_SERVER",
        "WRITE",
        "NOT_APPLICABLE",
        "REQUIRED",
        "datasource.register",
        "datasource.register",
      ],
      [
        "DATASOURCE_READ",
        "DATASOURCE",
        "MUST_EXIST",
        "WORKSPACE_ADMIN+WORKSPACE_ANALYST+WORKER",
        "ANY_WORKSPACE_MEMBER",
        "READ",
        "REQUIRED",
        "NOT_APPLICABLE",
        "datasource.read",
        "datasource.read",
      ],
      [
        "FALCON_EVALUATE",
        "FALCON",
        "MUST_EXIST",
        "WORKSPACE_ADMIN+WORKER",
        "ADMIN_OR_SERVER",
        "EXECUTE",
        "REQUIRED",
        "REQUIRED",
        "falcon.evaluate",
        "falcon.evaluate",
      ],
      [
        "FALCON_RESULT_READ",
        "FALCON",
        "MUST_EXIST",
        "WORKSPACE_ADMIN+WORKSPACE_ANALYST+WORKSPACE_VIEWER+WORKER",
        "ANY_WORKSPACE_MEMBER",
        "READ",
        "REQUIRED",
        "NOT_APPLICABLE",
        "falcon.result.read",
        "falcon.result.read",
      ],
      [
        "TOOL_INVOKE",
        "TOOL",
        "MUST_EXIST",
        "WORKSPACE_ADMIN+WORKSPACE_ANALYST+WORKER",
        "OWNER_OR_ADMIN",
        "EXECUTE",
        "REQUIRED",
        "REQUIRED",
        "tool.invoke",
        "tool.invoke",
      ],
    ]);
  });

  it("enforces the real version, idempotency and target-state values for every descriptor", async () => {
    for (const descriptor of ROUTE_AUTHORIZATION_MATRIX) {
      const request = requestFor(descriptor);
      const authorityPort = authorityPortFor(descriptor, request);
      await expect(
        authorizeWorkspaceRoute(request, authorityPort),
        descriptor.workspace_action,
      ).resolves.toMatchObject({
        authorized: true,
        reason_code: "AUTHORIZED",
        execution_disposition: "EXECUTE_NEW",
        binding: {
          action: descriptor.workspace_action,
          resource_id: resourceId,
          resource_kind: descriptor.resource_kind,
          resource_state_requirement: descriptor.resource_state_requirement,
          expected_version: request.expected_version,
          current_version: descriptor.resource_state_requirement === "MUST_EXIST" ? 7 : null,
          idempotency_key: request.idempotency_key,
          request_hash: requestHash,
          task_capability: descriptor.task_capability,
          evidence_hash: evidenceHash,
          authority_expires_at: expiresAt,
          authority_evaluated_at: now,
          principal_kind: "HUMAN",
          principal_role: "WORKSPACE_ADMIN",
          idempotency_expires_at: descriptor.idempotency_key === "REQUIRED" ? expiresAt : null,
        },
      });

      await expect(
        authorizeWorkspaceRoute(
          request,
          authorityPortFor(descriptor, request, { capabilities: [] }),
        ),
        descriptor.workspace_action,
      ).resolves.toMatchObject({ authorized: false, reason_code: "TASK_CAPABILITY_REQUIRED" });

      const mustExist = descriptor.resource_state_requirement === "MUST_EXIST";
      await expect(
        authorizeWorkspaceRoute(
          request,
          authorityPortFor(descriptor, request, {
            exists: !mustExist,
            currentVersion: mustExist ? null : 7,
          }),
        ),
        descriptor.workspace_action,
      ).resolves.toMatchObject({
        authorized: false,
        reason_code: mustExist ? "RESOURCE_NOT_FOUND_OR_FORBIDDEN" : "RESOURCE_ALREADY_EXISTS",
      });

      if (descriptor.expected_version === "REQUIRED") {
        const missingVersion = requestFor(descriptor, { expected_version: null });
        await expect(
          authorizeWorkspaceRoute(
            missingVersion,
            authorityPortFor(descriptor, missingVersion, { expectedVersion: null }),
          ),
        ).resolves.toMatchObject({ authorized: false, reason_code: "EXPECTED_VERSION_REQUIRED" });
        await expect(
          authorizeWorkspaceRoute(
            request,
            authorityPortFor(descriptor, request, { currentVersion: 8 }),
          ),
        ).resolves.toMatchObject({ authorized: false, reason_code: "EXPECTED_VERSION_MISMATCH" });
      } else {
        const unexpectedVersion = requestFor(descriptor, { expected_version: 7 });
        await expect(
          authorizeWorkspaceRoute(
            unexpectedVersion,
            authorityPortFor(descriptor, unexpectedVersion),
          ),
        ).resolves.toMatchObject({
          authorized: false,
          reason_code: "EXPECTED_VERSION_NOT_APPLICABLE",
        });
      }

      if (descriptor.idempotency_key === "REQUIRED") {
        const missingKey = requestFor(descriptor, { idempotency_key: null });
        await expect(
          authorizeWorkspaceRoute(
            missingKey,
            authorityPortFor(descriptor, missingKey, { idempotencyKey: null, idempotency: null }),
          ),
        ).resolves.toMatchObject({ authorized: false, reason_code: "IDEMPOTENCY_KEY_REQUIRED" });
        await expect(
          authorizeWorkspaceRoute(
            request,
            authorityPortFor(descriptor, request, { idempotency: null }),
          ),
        ).resolves.toMatchObject({ authorized: false, reason_code: "AUTHORITY_REQUIRED" });
        await expect(
          authorizeWorkspaceRoute(
            request,
            authorityPortFor(descriptor, request, {
              idempotency: { status: "RESERVED", key: "wrong-key", requestHash },
            }),
          ),
        ).resolves.toMatchObject({ authorized: false, reason_code: "AUTHORITY_BINDING_MISMATCH" });
      } else {
        const unexpectedKey = requestFor(descriptor, {
          idempotency_key: `u1-unexpected-${descriptor.workspace_action}`,
        });
        await expect(
          authorizeWorkspaceRoute(unexpectedKey, authorityPortFor(descriptor, unexpectedKey)),
        ).resolves.toMatchObject({
          authorized: false,
          reason_code: "IDEMPOTENCY_KEY_NOT_APPLICABLE",
        });
        await expect(
          authorizeWorkspaceRoute(
            request,
            authorityPortFor(descriptor, request, {
              idempotency: {
                status: "RESERVED",
                key: `u1-unbound-${descriptor.workspace_action}`,
                requestHash,
              },
            }),
          ),
        ).resolves.toMatchObject({
          authorized: false,
          reason_code: "AUTHORITY_BINDING_MISMATCH",
        });
      }
    }
  });

  it("resolves server authority inside authorization and rejects raw/self-attested facts", async () => {
    const descriptor = ROUTE_AUTHORIZATION_MATRIX.find(
      (candidate) => candidate.workspace_action === "SEMANTIC_BOOTSTRAP",
    );
    expect(descriptor).toBeDefined();
    if (!descriptor) return;
    const request = requestFor(descriptor);
    const port = authorityPortFor(descriptor, request);
    const rawFacts = await port.resolve(request);
    await expect(authorizeWorkspaceRoute(request, rawFacts as never)).rejects.toThrow(
      /authority resolver port/i,
    );
    expect(
      "verifyServerResolvedRouteAuthorityFacts" in
        (await import("../packages/contracts/src/capabilities/index.js")),
    ).toBe(false);
  });

  it("binds action, channel, target, kind, capability, version, key, hash and freshness", async () => {
    const descriptor = ROUTE_AUTHORIZATION_MATRIX.find(
      (candidate) => candidate.workspace_action === "SEMANTIC_BOOTSTRAP",
    );
    expect(descriptor).toBeDefined();
    if (!descriptor) return;
    const request = requestFor(descriptor);
    const mismatches: AuthorityOptions[] = [
      { action: "SEMANTIC_READ" },
      { channel: "TOOL" },
      { resourceId: resolutionId },
      { resourceKind: "RUN" },
      { boundCapability: "semantic.read" },
      { expectedVersion: 8 },
      { idempotencyKey: "different-key" },
      { requestHash: otherRequestHash },
      {
        idempotency: {
          status: "REPLAY_SAME_REQUEST",
          key: request.idempotency_key ?? "unexpected-null",
          requestHash: otherRequestHash,
        },
      },
    ];
    for (const mismatch of mismatches) {
      await expect(
        authorizeWorkspaceRoute(request, authorityPortFor(descriptor, request, mismatch)),
      ).resolves.toMatchObject({ authorized: false, reason_code: "AUTHORITY_BINDING_MISMATCH" });
    }
    await expect(
      authorizeWorkspaceRoute(
        request,
        authorityPortFor(descriptor, request, {
          idempotency: {
            status: "REPLAY_SAME_REQUEST",
            key: request.idempotency_key ?? "unexpected-null",
            requestHash,
          },
        }),
      ),
    ).resolves.toMatchObject({
      authorized: false,
      reason_code: "IDEMPOTENCY_REPLAY_RECORDED_RESULT",
      execution_disposition: "RETURN_RECORDED_RESULT",
      binding: { idempotency_status: "REPLAY_SAME_REQUEST", request_hash: requestHash },
    });
    await expect(
      authorizeWorkspaceRoute(
        request,
        authorityPortFor(descriptor, request, { expiresAt: "2026-08-16T07:59:30.000Z" }),
      ),
    ).resolves.toMatchObject({ authorized: false, reason_code: "AUTHORITY_EXPIRED" });
    await expect(
      authorizeWorkspaceRoute(
        request,
        authorityPortFor(descriptor, request, {
          idempotency: {
            status: "RESERVED",
            key: request.idempotency_key ?? "unexpected-null",
            requestHash,
            expiresAt: "2026-08-16T07:59:30.000Z",
          },
        }),
      ),
    ).resolves.toMatchObject({ authorized: false, reason_code: "AUTHORITY_EXPIRED" });
  });

  it("returns the recorded result after committed create/update state changes", async () => {
    const createDescriptor = ROUTE_AUTHORIZATION_MATRIX.find(
      (candidate) => candidate.workspace_action === "RUN_CREATE",
    );
    const updateDescriptor = ROUTE_AUTHORIZATION_MATRIX.find(
      (candidate) => candidate.workspace_action === "JOB_CONTROL",
    );
    expect(createDescriptor).toBeDefined();
    expect(updateDescriptor).toBeDefined();
    if (!createDescriptor || !updateDescriptor) return;

    const createRequest = requestFor(createDescriptor);
    const createReplay = await authorizeWorkspaceRoute(
      createRequest,
      authorityPortFor(createDescriptor, createRequest, {
        exists: true,
        currentVersion: 1,
        idempotency: {
          status: "REPLAY_SAME_REQUEST",
          key: createRequest.idempotency_key ?? "unexpected-null",
          requestHash,
        },
      }),
    );
    expect(createReplay).toMatchObject({
      authorized: false,
      reason_code: "IDEMPOTENCY_REPLAY_RECORDED_RESULT",
      execution_disposition: "RETURN_RECORDED_RESULT",
      binding: { current_version: 1, idempotency_status: "REPLAY_SAME_REQUEST" },
    });

    const updateRequest = requestFor(updateDescriptor);
    const updateReplayPort = authorityPortFor(updateDescriptor, updateRequest, {
      currentVersion: 8,
      idempotency: {
        status: "REPLAY_SAME_REQUEST",
        key: updateRequest.idempotency_key ?? "unexpected-null",
        requestHash,
      },
    });
    const updateReplay = await authorizeWorkspaceRoute(updateRequest, updateReplayPort);
    expect(updateReplay).toMatchObject({
      authorized: false,
      reason_code: "IDEMPOTENCY_REPLAY_RECORDED_RESULT",
      execution_disposition: "RETURN_RECORDED_RESULT",
      binding: { current_version: 8, idempotency_status: "REPLAY_SAME_REQUEST" },
    });
    expect(() =>
      routeAuthorizationDecisionSchema.parse({ ...updateReplay, authorized: true }),
    ).toThrow(/invariant/i);

    await expect(
      authorizeWorkspaceRoute(
        updateRequest,
        authorityPortFor(updateDescriptor, updateRequest, {
          currentVersion: 8,
          capabilities: [],
          idempotency: {
            status: "REPLAY_SAME_REQUEST",
            key: updateRequest.idempotency_key ?? "unexpected-null",
            requestHash,
          },
        }),
      ),
    ).resolves.toMatchObject({
      authorized: false,
      reason_code: "TASK_CAPABILITY_REQUIRED",
      execution_disposition: "DENY",
    });
    await expect(
      authorizeWorkspaceRoute(
        updateRequest,
        authorityPortFor(updateDescriptor, updateRequest, {
          currentVersion: 8,
          idempotency: {
            status: "REPLAY_SAME_REQUEST",
            key: updateRequest.idempotency_key ?? "unexpected-null",
            requestHash,
            expiresAt: "2026-08-16T07:59:30.000Z",
          },
        }),
      ),
    ).resolves.toMatchObject({
      authorized: false,
      reason_code: "AUTHORITY_EXPIRED",
      execution_disposition: "DENY",
    });
  });

  it("rejects wrong roles, ownership failures and Worker channel escalation", async () => {
    const descriptor = ROUTE_AUTHORIZATION_MATRIX.find(
      (candidate) => candidate.workspace_action === "TOOL_INVOKE",
    );
    expect(descriptor).toBeDefined();
    if (!descriptor) return;
    const request = requestFor(descriptor);
    await expect(
      authorizeWorkspaceRoute(
        request,
        authorityPortFor(descriptor, request, { role: "WORKSPACE_VIEWER" }),
      ),
    ).resolves.toMatchObject({ authorized: false, reason_code: "ROLE_FORBIDDEN" });
    await expect(
      authorizeWorkspaceRoute(
        request,
        authorityPortFor(descriptor, request, {
          role: "WORKSPACE_ANALYST",
          ownerPrincipalId: "00000000-0000-4000-8000-000000000009",
        }),
      ),
    ).resolves.toMatchObject({ authorized: false, reason_code: "OWNERSHIP_FORBIDDEN" });
    await expect(
      authorizeWorkspaceRoute(request, authorityPortFor(descriptor, request, { role: "WORKER" })),
    ).rejects.toThrow(/principal kind|invocation channel/i);
    await expect(
      authorizeWorkspaceRoute(
        request,
        authorityPortFor(descriptor, request, {
          principalWorkspaceId: "00000000-0000-4000-8000-000000000009",
        }),
      ),
    ).rejects.toThrow(/principal identity|binding/i);
    await expect(
      authorizeWorkspaceRoute(
        request,
        authorityPortFor(descriptor, request, {
          resourceWorkspaceId: "00000000-0000-4000-8000-000000000009",
        }),
      ),
    ).rejects.toThrow(/resource identity|workspace|binding/i);
  });

  it("produces request-bound decisions that cannot be reused for another target, version, key or hash", async () => {
    const descriptor = ROUTE_AUTHORIZATION_MATRIX.find(
      (candidate) => candidate.workspace_action === "TOOL_INVOKE",
    );
    expect(descriptor).toBeDefined();
    if (!descriptor) return;
    const firstRequest = requestFor(descriptor);
    const secondRequest = requestFor(descriptor, {
      resource_id: resolutionId,
      expected_version: 8,
      idempotency_key: "u1-another-tool-request",
      request_hash: otherRequestHash,
    });
    const first = await authorizeWorkspaceRoute(
      firstRequest,
      authorityPortFor(descriptor, firstRequest),
    );
    const second = await authorizeWorkspaceRoute(
      secondRequest,
      authorityPortFor(descriptor, secondRequest, {
        currentVersion: 8,
      }),
    );
    expect(first.authorized).toBe(true);
    expect(second.authorized).toBe(true);
    expect(first.binding).not.toEqual(second.binding);
    expect(first.binding).toMatchObject({
      resource_id: resourceId,
      expected_version: 7,
      idempotency_key: "u1-TOOL_INVOKE",
      request_hash: requestHash,
    });
    expect(second.binding).toMatchObject({
      resource_id: resolutionId,
      expected_version: 8,
      idempotency_key: "u1-another-tool-request",
      request_hash: otherRequestHash,
    });
  });

  it("does not accept caller-injected resource or authority properties", async () => {
    const descriptor = ROUTE_AUTHORIZATION_MATRIX[0];
    const request = requestFor(descriptor);
    await expect(
      authorizeWorkspaceRoute(
        { ...request, resource: { exists: true, workspace_id: workspaceId } },
        authorityPortFor(descriptor, request),
      ),
    ).rejects.toThrow();
  });

  it("keeps all Bootstrap schemas framework-neutral and strict", async () => {
    expect(greenfieldBootstrapInputSchema).toBeDefined();
    const publicSurface = await import("../packages/contracts/src/capabilities/index.js");
    expect(Object.keys(publicSurface).some((key) => /mastra|credential|bearer/i.test(key))).toBe(
      false,
    );
  });
});
