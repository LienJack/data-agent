import { type AppScope, environmentSchema, type PortResult } from "@data-agent/contracts";
import { z } from "zod";
import {
  type InternalCapabilityLifecycleController,
  registerLifecycleAuthority,
} from "./lifecycle-authority.internal.js";

const id = z.uuid();
const deploymentSchema = z.strictObject({
  deployment_id: id,
  app_id: id,
  environment: environmentSchema,
});
const membershipSchema = z.strictObject({
  subject: z.string().min(1).max(256),
  deployment_id: id,
  tenant_id: id,
  role: z.enum(["OWNER", "ANALYST", "VIEWER"]),
});
const demoSchema = z.strictObject({
  subject: z.string().min(1).max(256),
  deployment_id: id,
  tenant_id: id,
  dataset_id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/),
});
const subjectSchema = z.strictObject({ subject: z.string().min(1).max(256) }).passthrough();

export type AppCapabilityRole = "OWNER" | "ANALYST" | "VIEWER" | "DEMO";
export type CapabilityOperation = "READ" | "WRITE" | "EGRESS_CONNECT";
export type AppCapability = Readonly<{
  scope: AppScope;
  deployment_id: string;
  principal: string;
  role: AppCapabilityRole;
  dataset_id?: string;
}>;
export type BoundaryResult<T> = PortResult<T>;
export interface CapabilityQueryClient {
  query<Row extends object = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{
    readonly rows: readonly Row[];
    readonly rowCount: number | null;
  }>;
}
export interface CapabilityAuthorizer {
  verify(value: unknown): BoundaryResult<AppCapability>;
  requireRole(
    value: unknown,
    allowedRoles: readonly AppCapabilityRole[],
    operation?: CapabilityOperation,
  ): BoundaryResult<AppCapability>;
  revalidate(
    value: unknown,
    allowedRoles: readonly AppCapabilityRole[],
    operation?: CapabilityOperation,
  ): Promise<BoundaryResult<AppCapability>>;
}
export type CapabilityLifecycleAuthority = Readonly<{
  kind: "capability-lifecycle-authority";
}>;

export const failure = <T = never>(
  code: string,
  message: string,
  retryable = false,
): BoundaryResult<T> => ({
  ok: false,
  error: { code, message, retryable },
});

interface CapabilityRecord {
  readonly issuer: object;
  readonly validate: () => BoundaryResult<void>;
}

const capabilityRecords = new WeakMap<object, CapabilityRecord>();
const authorizerIssuers = new WeakMap<object, object>();

function insertUnique<T>(target: Map<string, T>, key: string, value: T, errorCode: string): void {
  if (target.has(key)) throw new TypeError(errorCode);
  target.set(key, value);
}

export function createDeploymentRegistry(
  deploymentsInput: unknown[],
  membershipsInput: unknown[],
  demosInput: unknown[] = [],
) {
  const issuer = Object.freeze({});
  const writeFrozenScopes = new Set<string>();
  const deploymentEpochs = new Map<string, number>();
  const scopeKey = (scope: AppScope) => `${scope.app_id}\u0000${scope.environment}`;
  const authorizer: CapabilityAuthorizer = Object.freeze({
    verify(value: unknown): BoundaryResult<AppCapability> {
      return requireCapability(value, authorizer);
    },
    requireRole(
      value: unknown,
      allowedRoles: readonly AppCapabilityRole[],
      operation: CapabilityOperation = "READ",
    ): BoundaryResult<AppCapability> {
      const required = requireCapabilityRole(value, allowedRoles, authorizer);
      if (!required.ok) return required;
      if (operation !== "READ" && writeFrozenScopes.has(scopeKey(required.value.scope))) {
        return failure("APP_OPERATION_FROZEN", "App 已冻结，不能执行新的写入或外连操作。");
      }
      return required;
    },
    async revalidate(
      value: unknown,
      allowedRoles: readonly AppCapabilityRole[],
      operation: CapabilityOperation = "READ",
    ): Promise<BoundaryResult<AppCapability>> {
      return authorizer.requireRole(value, allowedRoles, operation);
    },
  });
  authorizerIssuers.set(authorizer, issuer);
  const lifecycleController: InternalCapabilityLifecycleController = Object.freeze({
    freezeWrites(value: unknown): BoundaryResult<AppCapability> {
      const required = authorizer.requireRole(value, ["OWNER"], "WRITE");
      if (!required.ok) return required;
      writeFrozenScopes.add(scopeKey(required.value.scope));
      return required;
    },
    retire(value: unknown): BoundaryResult<AppCapability> {
      const required = authorizer.requireRole(value, ["OWNER"], "READ");
      if (!required.ok) return required;
      for (const deployment of deployments.values()) {
        if (
          deployment.app_id === required.value.scope.app_id &&
          deployment.environment === required.value.scope.environment
        ) {
          revokedDeployments.add(deployment.deployment_id);
          deploymentEpochs.set(
            deployment.deployment_id,
            (deploymentEpochs.get(deployment.deployment_id) ?? 0) + 1,
          );
        }
      }
      return required;
    },
    restoreScope(scope: AppScope): void {
      for (const deployment of deployments.values()) {
        if (deployment.app_id === scope.app_id && deployment.environment === scope.environment) {
          revokedDeployments.delete(deployment.deployment_id);
        }
      }
      writeFrozenScopes.add(scopeKey(scope));
    },
    activateWrites(value: unknown): BoundaryResult<AppCapability> {
      const required = authorizer.requireRole(value, ["OWNER"], "READ");
      if (!required.ok) return required;
      writeFrozenScopes.delete(scopeKey(required.value.scope));
      return required;
    },
  });
  const lifecycleAuthority: CapabilityLifecycleAuthority = Object.freeze({
    kind: "capability-lifecycle-authority",
  });
  registerLifecycleAuthority(lifecycleAuthority, lifecycleController);

  const deployments = new Map<string, z.infer<typeof deploymentSchema>>();
  for (const input of deploymentsInput) {
    const deployment = deploymentSchema.parse(input);
    insertUnique(deployments, deployment.deployment_id, deployment, "DUPLICATE_DEPLOYMENT_ID");
  }

  const memberships = new Map<string, z.infer<typeof membershipSchema>>();
  for (const input of membershipsInput) {
    const membership = membershipSchema.parse(input);
    if (!deployments.has(membership.deployment_id)) {
      throw new TypeError("MEMBERSHIP_DEPLOYMENT_NOT_FOUND");
    }
    const key = `${membership.subject}\u0000${membership.deployment_id}`;
    insertUnique(memberships, key, membership, "DUPLICATE_MEMBERSHIP");
  }

  const demos = new Map<string, z.infer<typeof demoSchema>>();
  for (const input of demosInput) {
    const demo = demoSchema.parse(input);
    if (!deployments.has(demo.deployment_id)) {
      throw new TypeError("DEMO_DEPLOYMENT_NOT_FOUND");
    }
    const key = `${demo.subject}\u0000${demo.deployment_id}`;
    if (memberships.has(key)) throw new TypeError("PRINCIPAL_KIND_CONFLICT");
    insertUnique(demos, key, demo, "DUPLICATE_DEMO_PRINCIPAL");
  }

  const revokedMemberships = new Set<string>();
  const revokedDeployments = new Set<string>();

  const build = (
    principal: string,
    deploymentId: string,
    tenantId: string,
    role: AppCapabilityRole,
    membershipKey: string,
    datasetId?: string,
  ): BoundaryResult<AppCapability> => {
    const deployment = deployments.get(deploymentId);
    if (!deployment) return failure("DEPLOYMENT_NOT_FOUND", "服务端 Deployment Mapping 不存在。");
    if (revokedDeployments.has(deploymentId)) {
      return failure("DEPLOYMENT_REVOKED", "Deployment Mapping 已撤销。");
    }

    const issuedEpoch = deploymentEpochs.get(deploymentId) ?? 0;
    const capability = Object.freeze({
      scope: Object.freeze({
        app_id: deployment.app_id,
        tenant_id: tenantId,
        environment: deployment.environment,
      }),
      deployment_id: deploymentId,
      principal,
      role,
      ...(datasetId === undefined ? {} : { dataset_id: datasetId }),
    });
    capabilityRecords.set(capability, {
      issuer,
      validate: () => {
        if ((deploymentEpochs.get(deploymentId) ?? 0) !== issuedEpoch) {
          return failure("CAPABILITY_EPOCH_STALE", "App Capability Epoch 已过期。");
        }
        if (revokedDeployments.has(deploymentId)) {
          return failure("DEPLOYMENT_REVOKED", "Deployment Mapping 已撤销。");
        }
        if (revokedMemberships.has(membershipKey)) {
          return failure("MEMBERSHIP_REVOKED", "Membership 已撤销。");
        }
        return { ok: true, value: undefined };
      },
    });
    return { ok: true, value: capability };
  };

  return {
    authorizer,
    lifecycleAuthority,
    resolveForDeployment(
      serverDeploymentId: string,
      input: unknown,
    ): BoundaryResult<AppCapability> {
      const deployment = deploymentSchema.shape.deployment_id.safeParse(serverDeploymentId);
      if (!deployment.success) {
        return failure("DEPLOYMENT_NOT_FOUND", "服务端 Deployment Mapping 不存在。");
      }
      const { subject } = subjectSchema.parse(input);
      const membershipKey = `${subject}\u0000${deployment.data}`;
      const membership = memberships.get(membershipKey);
      if (membership) {
        return revokedMemberships.has(membershipKey)
          ? failure("MEMBERSHIP_REVOKED", "Membership 已撤销。")
          : build(
              subject,
              membership.deployment_id,
              membership.tenant_id,
              membership.role,
              membershipKey,
            );
      }
      const demo = demos.get(membershipKey);
      if (demo) {
        return revokedMemberships.has(membershipKey)
          ? failure("MEMBERSHIP_REVOKED", "Demo Principal 已撤销。")
          : build(
              subject,
              demo.deployment_id,
              demo.tenant_id,
              "DEMO",
              membershipKey,
              demo.dataset_id,
            );
      }
      return failure("MEMBERSHIP_NOT_FOUND", "Token subject 没有服务端 Membership。");
    },

    resolve(input: unknown): BoundaryResult<AppCapability> {
      const { subject } = subjectSchema.parse(input);
      const deploymentIds = new Set([
        ...[...memberships.values()]
          .filter((membership) => membership.subject === subject)
          .map((membership) => membership.deployment_id),
        ...[...demos.values()]
          .filter((demo) => demo.subject === subject)
          .map((demo) => demo.deployment_id),
      ]);
      if (deploymentIds.size !== 1) {
        return failure("DEPLOYMENT_CONTEXT_REQUIRED", "服务端必须指定唯一 Deployment Context。");
      }
      return this.resolveForDeployment([...deploymentIds][0] ?? "", input);
    },

    revoke(subject: string, deploymentId: string): void {
      revokedMemberships.add(`${subject}\u0000${deploymentId}`);
    },

    revokeDeployment(deploymentId: string): void {
      revokedDeployments.add(deploymentId);
      deploymentEpochs.set(deploymentId, (deploymentEpochs.get(deploymentId) ?? 0) + 1);
    },

    permitsDemo(
      capabilityInput: unknown,
      operation: "READ" | "DISCOVER_DATASOURCE" | "DISCOVER_SECRET" | "READ_HOLDOUT",
      datasetId: string,
    ): boolean {
      const required = authorizer.verify(capabilityInput);
      return (
        required.ok &&
        required.value.role === "DEMO" &&
        operation === "READ" &&
        required.value.dataset_id === datasetId
      );
    },
  };
}

export function requireCapability(
  value: unknown,
  authorizer: CapabilityAuthorizer,
): BoundaryResult<AppCapability> {
  if (typeof value !== "object" || value === null) {
    return failure("APP_CAPABILITY_REQUIRED", "操作必须使用服务端签发的 AppCapability。");
  }
  const record = capabilityRecords.get(value);
  if (!record) {
    return failure("APP_CAPABILITY_REQUIRED", "操作必须使用服务端签发的 AppCapability。");
  }
  const expectedIssuer = authorizerIssuers.get(authorizer);
  if (!expectedIssuer || expectedIssuer !== record.issuer) {
    return failure(
      "APP_CAPABILITY_ISSUER_MISMATCH",
      "App Capability 不是由当前服务端 Authority 签发。",
    );
  }
  const current = record.validate();
  if (!current.ok) return current;
  return { ok: true, value: value as AppCapability };
}

export function requireCapabilityRole(
  value: unknown,
  allowedRoles: readonly AppCapabilityRole[],
  authorizer: CapabilityAuthorizer,
): BoundaryResult<AppCapability> {
  const required = requireCapability(value, authorizer);
  if (!required.ok) return required;
  if (!allowedRoles.includes(required.value.role)) {
    return failure("APP_OPERATION_DENIED", "当前 App Capability 无权执行该操作。");
  }
  return required;
}
