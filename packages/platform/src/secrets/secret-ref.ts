import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  type AppCapability,
  type BoundaryResult,
  type CapabilityAuthorizer,
  failure,
} from "../tenancy/capability.js";

/**
 * @internal 脱敏与进程内 Conformance Fixture。
 * 生产 SecretRef 使用 postgres-secret-ref.ts 与数据库两阶段 Provider Effect Receipt；
 * 本模块的 WeakMap 身份不能跨 JSON、队列或进程恢复，也不从 package root 导出。
 */
const createSchema = z.strictObject({
  secret_name: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z][A-Za-z0-9._/-]*$/),
});
const sensitiveKey =
  /(?:^|[_-])(?:secret|client[_-]?secret|consumer[_-]?secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|provider[_-]?token|password|passwd|credential|authorization|cookie|api[_-]?key|private[_-]?key|access[_-]?key[_-]?id|secret[_-]?access[_-]?key)(?:$|[_-])/i;
const secretReferenceKey = /(?:^|[_-])(?:secret|credential)[_-]?ref(?:s)?$/i;
const pluralSecretReferenceKey = /(?:^|[_-])(?:secret|credential)[_-]?refs$/i;
const nonCredentialTokenKey = /^(?:snapshot|fencing)_token$/i;
const obviousSecretValue =
  /(?:^(?:bearer\s+\S+|sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)|(?:[a-z][a-z0-9+.-]*:)+\/\/[^/\s:@]*:[^@\s]+@|\b(?:password|token|secret|api[_-]?key|authorization)\s*[:=]\s*\S+)/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const environmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const secretNamePattern = /^[A-Za-z][A-Za-z0-9._/-]{0,127}$/;
const secretRefPattern =
  /^secretref:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SecretRef = Readonly<{
  ref: string;
  owner_id: string;
  app_id: string;
  tenant_id: string;
  environment: string;
  secret_name: string;
  version: number;
  rotated_at: string;
  revoked_at: string | null;
}>;

interface SecretIdentity {
  readonly registry: SecretRegistry;
  readonly ref: string;
  readonly version: number;
}

const trustedSecretRefs = new WeakMap<object, SecretIdentity>();

function signSecretRef(registry: SecretRegistry, record: SecretRef): SecretRef {
  trustedSecretRefs.set(record, {
    registry,
    ref: record.ref,
    version: record.version,
  });
  return record;
}

function requireSecretOwner(
  authorizer: CapabilityAuthorizer,
  capabilityInput: unknown,
  record: SecretRef,
  access: "READ" | "WRITE",
): BoundaryResult<AppCapability> {
  const capability = authorizer.requireRole(capabilityInput, ["OWNER"], access);
  if (!capability.ok) return capability;
  if (
    capability.value.scope.app_id !== record.app_id ||
    capability.value.scope.tenant_id !== record.tenant_id ||
    capability.value.scope.environment !== record.environment ||
    capability.value.principal !== record.owner_id
  ) {
    return failure("SECRET_SCOPE_DENIED", "Secret Reference 不属于当前 Owner/App/Environment。");
  }
  return capability;
}

export class SecretRegistry {
  private readonly records = new Map<string, SecretRef>();

  constructor(private readonly authorizer: CapabilityAuthorizer) {}

  create(capabilityInput: unknown, input: unknown): BoundaryResult<SecretRef> {
    const capability = this.authorizer.requireRole(capabilityInput, ["OWNER"], "WRITE");
    if (!capability.ok) return capability;
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return failure("SECRET_METADATA_INVALID", "Secret Metadata 非法。");
    const now = new Date().toISOString();
    const record = Object.freeze({
      ref: `secretref:${randomUUID()}`,
      owner_id: capability.value.principal,
      app_id: capability.value.scope.app_id,
      tenant_id: capability.value.scope.tenant_id,
      environment: capability.value.scope.environment,
      secret_name: parsed.data.secret_name,
      version: 1,
      rotated_at: now,
      revoked_at: null,
    });
    this.records.set(record.ref, record);
    return { ok: true, value: signSecretRef(this, record) };
  }

  private resolveTrusted(input: unknown): BoundaryResult<SecretRef> {
    if (typeof input !== "object" || input === null) {
      return failure("SECRET_REF_REQUIRED", "必须使用 SecretRegistry 签发的 SecretRef。");
    }
    const identity = trustedSecretRefs.get(input);
    if (!identity || identity.registry !== this) {
      return failure("SECRET_REF_REQUIRED", "必须使用 SecretRegistry 签发的 SecretRef。");
    }
    const current = this.records.get(identity.ref);
    if (!current) return failure("SECRET_NOT_FOUND", "Secret Reference 不存在。");
    if (identity.version !== current.version) {
      return failure("SECRET_VERSION_STALE", "Secret Reference Version 已过期。");
    }
    return { ok: true, value: current };
  }

  rotate(capabilityInput: unknown, referenceInput: unknown): BoundaryResult<SecretRef> {
    const resolved = this.resolveTrusted(referenceInput);
    if (!resolved.ok) return resolved;
    const owner = requireSecretOwner(this.authorizer, capabilityInput, resolved.value, "WRITE");
    if (!owner.ok) return owner;
    if (resolved.value.revoked_at) return failure("SECRET_REVOKED", "Secret 已撤销。");
    const next = Object.freeze({
      ...resolved.value,
      version: resolved.value.version + 1,
      rotated_at: new Date().toISOString(),
    });
    this.records.set(next.ref, next);
    return { ok: true, value: signSecretRef(this, next) };
  }

  revoke(capabilityInput: unknown, referenceInput: unknown): BoundaryResult<void> {
    const resolved = this.resolveTrusted(referenceInput);
    if (!resolved.ok) return resolved;
    const owner = requireSecretOwner(this.authorizer, capabilityInput, resolved.value, "WRITE");
    if (!owner.ok) return owner;
    if (resolved.value.revoked_at) return failure("SECRET_REVOKED", "Secret 已撤销。");
    const revoked = Object.freeze({
      ...resolved.value,
      revoked_at: new Date().toISOString(),
    });
    this.records.set(revoked.ref, revoked);
    return { ok: true, value: undefined };
  }

  resolve(capabilityInput: unknown, referenceInput: unknown): BoundaryResult<SecretRef> {
    const resolved = this.resolveTrusted(referenceInput);
    if (!resolved.ok) return resolved;
    const owner = requireSecretOwner(this.authorizer, capabilityInput, resolved.value, "READ");
    if (!owner.ok) return owner;
    return resolved.value.revoked_at ? failure("SECRET_REVOKED", "Secret 已撤销。") : resolved;
  }
}

function hasPlaintextSecret(value: unknown, key = ""): boolean {
  if (secretReferenceKey.test(key)) {
    if (pluralSecretReferenceKey.test(key)) {
      return (
        !Array.isArray(value) ||
        value.length === 0 ||
        value.some((item) => typeof item !== "string" || !secretRefPattern.test(item))
      );
    }
    return typeof value !== "string" || !secretRefPattern.test(value);
  }
  if (nonCredentialTokenKey.test(key)) {
    return value !== null && (typeof value !== "string" || obviousSecretValue.test(value));
  }
  if (sensitiveKey.test(key) && !secretReferenceKey.test(key)) return true;
  if (typeof value === "string") {
    return obviousSecretValue.test(value);
  }
  if (Array.isArray(value)) return value.some((item) => hasPlaintextSecret(item, key));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(([childKey, child]) => hasPlaintextSecret(child, childKey));
  }
  return false;
}

export function containsPotentialPlaintextSecret(value: unknown): boolean {
  return hasPlaintextSecret(value);
}

function redact(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    const safeMetadata =
      ((key === "app_id" || key === "tenant_id" || key === "owner_id") &&
        uuidPattern.test(value)) ||
      (key === "environment" && environmentPattern.test(value)) ||
      (key === "secret_name" && secretNamePattern.test(value)) ||
      (key === "ref" && secretRefPattern.test(value)) ||
      ((key === "rotated_at" || key === "revoked_at") &&
        !Number.isNaN(Date.parse(value)) &&
        value.includes("T"));
    return safeMetadata && !obviousSecretValue.test(value) ? value : "[REDACTED]";
  }
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        sensitiveKey.test(childKey) && !secretReferenceKey.test(childKey)
          ? "[REDACTED]"
          : redact(child, childKey),
      ]),
    );
  }
  return value;
}

export function redactSecretLog(value: unknown): string {
  return JSON.stringify(redact(value));
}
