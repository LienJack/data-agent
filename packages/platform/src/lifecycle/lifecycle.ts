import { randomUUID } from "node:crypto";
import type { AppScope } from "@data-agent/contracts";
import { z } from "zod";
import {
  type BoundaryResult,
  type CapabilityAuthorizer,
  type CapabilityLifecycleAuthority,
  failure,
} from "../tenancy/capability.js";
import {
  type InternalCapabilityLifecycleController,
  resolveLifecycleAuthority,
} from "../tenancy/lifecycle-authority.internal.js";

/**
 * @internal U2 的进程内语义与失败关闭 Fixture。
 * 生产 Lifecycle Authority 位于 platform schema 的持久 Manifest/Receipt 状态机；
 * 本模块不从 package root 导出，不能作为多实例或重启后的权威。
 */
export type LifecycleAction = "FREEZE" | "ENUMERATE" | "EXPORT_OR_EXPIRE" | "DELETE" | "VERIFY";
export type LifecycleState =
  | "ACTIVE"
  | "FROZEN"
  | "ENUMERATED"
  | "EXPORTED_OR_EXPIRED"
  | "DELETED"
  | "RETIRED"
  | "RESTORED";
export type BoundaryReceipt = Readonly<{
  receipt_id: string;
  app_id: string;
  tenant_id: string;
  environment: string;
  action: LifecycleAction | "RESTORE" | "ACTIVATE";
  state: LifecycleState;
  evidence_id: string | null;
}>;

const evidenceActionSchema = z.enum([
  "ENUMERATE",
  "EXPORT_OR_EXPIRE",
  "DELETE",
  "VERIFY",
  "RESTORE",
]);
const evidenceSchema = z.strictObject({
  evidence_id: z.uuid(),
  app_id: z.uuid(),
  environment: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  action: evidenceActionSchema,
  upstream_evidence_id: z.uuid().nullable(),
  manifest_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  database_count: z.number().int().nonnegative(),
  storage_count: z.number().int().nonnegative(),
  redis_count: z.number().int().nonnegative(),
});

export type LifecycleEvidence = Readonly<z.infer<typeof evidenceSchema>>;
export interface LifecycleEvidenceAuthority {
  issue(input: unknown): LifecycleEvidence;
  verify(input: unknown): BoundaryResult<LifecycleEvidence>;
}

interface EvidenceRecord {
  readonly issuer: object;
  readonly evidence: LifecycleEvidence;
}

const evidenceRecords = new WeakMap<object, EvidenceRecord>();
const evidenceAuthorityIssuers = new WeakMap<object, object>();

export function createLifecycleEvidenceAuthority(): LifecycleEvidenceAuthority {
  const issuer = Object.freeze({});
  const authority: LifecycleEvidenceAuthority = Object.freeze({
    issue(input: unknown): LifecycleEvidence {
      const evidence = Object.freeze(evidenceSchema.parse(input));
      evidenceRecords.set(evidence, { issuer, evidence });
      return evidence;
    },
    verify(input: unknown): BoundaryResult<LifecycleEvidence> {
      if (typeof input !== "object" || input === null) {
        return failure("LIFECYCLE_EVIDENCE_REQUIRED", "Lifecycle Step 缺少 Job Evidence。");
      }
      const record = evidenceRecords.get(input);
      if (!record || evidenceAuthorityIssuers.get(authority) !== record.issuer) {
        return failure(
          "LIFECYCLE_EVIDENCE_AUTHORITY_MISMATCH",
          "Lifecycle Evidence 不是由当前 Job Authority 签发。",
        );
      }
      return { ok: true as const, value: record.evidence };
    },
  });
  evidenceAuthorityIssuers.set(authority, issuer);
  return authority;
}

const next: Record<LifecycleState, Partial<Record<LifecycleAction, LifecycleState>>> = {
  ACTIVE: { FREEZE: "FROZEN" },
  FROZEN: { ENUMERATE: "ENUMERATED" },
  ENUMERATED: { EXPORT_OR_EXPIRE: "EXPORTED_OR_EXPIRED" },
  EXPORTED_OR_EXPIRED: { DELETE: "DELETED" },
  DELETED: { VERIFY: "RETIRED" },
  RETIRED: {},
  RESTORED: {},
};

function scopeKey(scope: Pick<AppScope, "app_id" | "environment">): string {
  return `${scope.app_id}\u0000${scope.environment}`;
}

export class LifecycleRegistry {
  private readonly states = new Map<string, LifecycleState>();
  private readonly tenantByScope = new Map<string, string>();
  private readonly latestEvidenceByScope = new Map<string, LifecycleEvidence>();
  private readonly exportEvidenceByScope = new Map<string, LifecycleEvidence>();

  private readonly capabilityLifecycle: InternalCapabilityLifecycleController;

  constructor(
    private readonly authorizer: CapabilityAuthorizer,
    lifecycleAuthority: CapabilityLifecycleAuthority,
    private readonly evidenceAuthority: LifecycleEvidenceAuthority,
  ) {
    const controller = resolveLifecycleAuthority(lifecycleAuthority);
    if (!controller) throw new TypeError("CAPABILITY_LIFECYCLE_AUTHORITY_REQUIRED");
    this.capabilityLifecycle = controller;
  }

  private stateFor(scope: Pick<AppScope, "app_id" | "environment">): LifecycleState {
    return this.states.get(scopeKey(scope)) ?? "ACTIVE";
  }

  state(capabilityInput: unknown): BoundaryResult<LifecycleState> {
    const capability = this.authorizer.requireRole(capabilityInput, ["OWNER"], "READ");
    return capability.ok ? { ok: true, value: this.stateFor(capability.value.scope) } : capability;
  }

  apply(
    capabilityInput: unknown,
    action: LifecycleAction,
    evidenceInput?: unknown,
  ): BoundaryResult<BoundaryReceipt> {
    const capability = this.authorizer.requireRole(capabilityInput, ["OWNER"], "READ");
    if (!capability.ok) return capability;
    const key = scopeKey(capability.value.scope);
    const current = this.stateFor(capability.value.scope);
    const target = next[current][action];
    if (!target) {
      return failure("LIFECYCLE_TRANSITION_DENIED", "Lifecycle 状态迁移不合法。");
    }

    let evidence: LifecycleEvidence | null = null;
    if (action !== "FREEZE") {
      const verified = this.evidenceAuthority.verify(evidenceInput);
      if (!verified.ok) return verified;
      evidence = verified.value;
      const upstream = this.latestEvidenceByScope.get(key)?.evidence_id ?? null;
      if (
        evidence.app_id !== capability.value.scope.app_id ||
        evidence.environment !== capability.value.scope.environment ||
        evidence.action !== action ||
        evidence.upstream_evidence_id !== upstream
      ) {
        return failure(
          "LIFECYCLE_EVIDENCE_CHAIN_INVALID",
          "Lifecycle Evidence 的 Scope、Action 或上游链不匹配。",
        );
      }
      if (
        action === "VERIFY" &&
        (evidence.database_count !== 0 ||
          evidence.storage_count !== 0 ||
          evidence.redis_count !== 0)
      ) {
        return failure(
          "LIFECYCLE_RESIDUALS_REMAIN",
          "Lifecycle Verify 仍发现 Database/Storage/Redis 残留。",
        );
      }
    } else if (evidenceInput !== undefined) {
      return failure("LIFECYCLE_EVIDENCE_UNEXPECTED", "FREEZE 不接受外部 Effect Evidence。");
    }

    if (action === "FREEZE") {
      const frozen = this.capabilityLifecycle.freezeWrites(capability.value);
      if (!frozen.ok) return frozen;
    } else if (action === "VERIFY") {
      const retired = this.capabilityLifecycle.retire(capability.value);
      if (!retired.ok) return retired;
    }

    this.states.set(key, target);
    this.tenantByScope.set(key, capability.value.scope.tenant_id);
    if (evidence) {
      this.latestEvidenceByScope.set(key, evidence);
      if (action === "EXPORT_OR_EXPIRE") this.exportEvidenceByScope.set(key, evidence);
    }
    return {
      ok: true,
      value: Object.freeze({
        receipt_id: randomUUID(),
        app_id: capability.value.scope.app_id,
        tenant_id: capability.value.scope.tenant_id,
        environment: capability.value.scope.environment,
        action,
        state: target,
        evidence_id: evidence?.evidence_id ?? null,
      }),
    };
  }

  restore(evidenceInput: unknown): BoundaryResult<BoundaryReceipt> {
    const verified = this.evidenceAuthority.verify(evidenceInput);
    if (!verified.ok) return verified;
    const evidence = verified.value;
    const key = scopeKey(evidence);
    const exportEvidence = this.exportEvidenceByScope.get(key);
    const tenantId = this.tenantByScope.get(key);
    if (
      this.stateFor(evidence) !== "RETIRED" ||
      evidence.action !== "RESTORE" ||
      !exportEvidence ||
      evidence.upstream_evidence_id !== exportEvidence.evidence_id ||
      !tenantId
    ) {
      return failure(
        "LIFECYCLE_RESTORE_EVIDENCE_INVALID",
        "Restore 必须引用同 App/Environment 的已签发 Export Evidence。",
      );
    }

    const scope: AppScope = {
      app_id: evidence.app_id,
      tenant_id: tenantId,
      environment: evidence.environment,
    };
    this.capabilityLifecycle.restoreScope(scope);
    this.states.set(key, "RESTORED");
    this.latestEvidenceByScope.set(key, evidence);
    return {
      ok: true,
      value: Object.freeze({
        receipt_id: randomUUID(),
        app_id: scope.app_id,
        tenant_id: scope.tenant_id,
        environment: scope.environment,
        action: "RESTORE",
        state: "RESTORED",
        evidence_id: evidence.evidence_id,
      }),
    };
  }

  activate(capabilityInput: unknown): BoundaryResult<BoundaryReceipt> {
    const capability = this.authorizer.requireRole(capabilityInput, ["OWNER"], "READ");
    if (!capability.ok) return capability;
    const key = scopeKey(capability.value.scope);
    if (this.stateFor(capability.value.scope) !== "RESTORED") {
      return failure("LIFECYCLE_TRANSITION_DENIED", "只有 RESTORED App 可以重新激活。");
    }
    const activated = this.capabilityLifecycle.activateWrites(capability.value);
    if (!activated.ok) return activated;
    this.states.set(key, "ACTIVE");
    return {
      ok: true,
      value: Object.freeze({
        receipt_id: randomUUID(),
        app_id: capability.value.scope.app_id,
        tenant_id: capability.value.scope.tenant_id,
        environment: capability.value.scope.environment,
        action: "ACTIVATE",
        state: "ACTIVE",
        evidence_id: this.latestEvidenceByScope.get(key)?.evidence_id ?? null,
      }),
    };
  }
}
