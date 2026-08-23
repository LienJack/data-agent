import { randomUUID } from "node:crypto";
import type { AppScope } from "@data-agent/contracts";
import ipaddr from "ipaddr.js";
import { z } from "zod";
import {
  type AppCapability,
  type AppCapabilityRole,
  type BoundaryResult,
  type CapabilityAuthorizer,
  failure,
} from "../tenancy/capability.js";

/**
 * @internal U2 的 Egress Policy/SSRF Conformance Fixture。
 * 它不从 package root 导出；真实 Datasource Socket Adapter 与持久 Policy Authority
 * 由 U5/U9 交付，在此之前不能把 Connector Contract 误报为生产网络闭环。
 */
const hostPattern =
  /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const stableIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const policySchema = z.strictObject({
  datasource_id: z.string().regex(stableIdentifier),
  allowed_hosts: z.array(z.string().regex(hostPattern)).min(1),
  allowed_ports: z.array(z.number().int().min(1).max(65_535)).min(1),
  allowed_protocols: z
    .array(z.enum(["https:", "http:"]))
    .min(1)
    .default(["https:"]),
  allowed_roles: z
    .array(z.enum(["OWNER", "ANALYST", "VIEWER"]))
    .min(1)
    .default(["OWNER", "ANALYST"]),
});
const requestSchema = z.strictObject({
  datasource_id: z.string().regex(stableIdentifier),
  url: z.string().url(),
});

export type DatasourceEgressPolicy = Readonly<{
  policy_id: string;
  version: number;
  scope: AppScope;
  created_by: string;
  issued_at: string;
  datasource_id: string;
  allowed_hosts: readonly string[];
  allowed_ports: readonly number[];
  allowed_protocols: readonly ("https:" | "http:")[];
  allowed_roles: readonly Exclude<AppCapabilityRole, "DEMO">[];
}>;
export interface DnsResolver {
  resolve(host: string): Promise<readonly string[]>;
}
export type PinnedDatasourceEgress = Readonly<{
  policy_id: string;
  policy_version: number;
  scope: AppScope;
  requested_by: string;
  issued_at: string;
  expires_at: string;
  datasource_id: string;
  url: string;
  host: string;
  pinned_addresses: readonly string[];
}>;
export type VerifiedDatasourceEgress = PinnedDatasourceEgress &
  Readonly<{
    verified_at: string;
    target_expires_at: string;
  }>;
export type DatasourceConnectionTarget = Readonly<{
  scope: AppScope;
  url: string;
  address: string;
  server_name: string;
  redirects: "DENY";
}>;
export interface DatasourceConnector<T> {
  connect(target: DatasourceConnectionTarget): Promise<T>;
}

interface PolicyRecord {
  readonly registry: object;
  readonly policy: DatasourceEgressPolicy;
  revoked: boolean;
}
interface ApprovalRecord {
  readonly registry: object;
  readonly approval: PinnedDatasourceEgress;
}
interface VerifiedApprovalRecord {
  readonly registry: object;
  readonly approval: VerifiedDatasourceEgress;
  consumed: boolean;
}

const trustedPolicies = new WeakMap<object, PolicyRecord>();
const trustedEgressApprovals = new WeakMap<object, ApprovalRecord>();
const verifiedEgressApprovals = new WeakMap<object, VerifiedApprovalRecord>();
const approvalTtlMs = 30_000;
const verifiedTargetTtlMs = 5_000;

function canonicalPublicAddress(address: string): string | null {
  if (!ipaddr.isValid(address)) return null;
  let parsed = ipaddr.parse(address);
  if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
    parsed = parsed.toIPv4Address();
  }
  return parsed.range() === "unicast" ? parsed.toString() : null;
}

export function normalizePublicEgressAddresses(
  addresses: readonly string[],
): readonly string[] | null {
  if (addresses.length === 0) return null;
  const normalized = addresses.map(canonicalPublicAddress);
  if (normalized.some((address) => address === null)) return null;
  return [...new Set(normalized as string[])].sort();
}

function sameScope(left: AppScope, right: AppScope): boolean {
  return (
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment
  );
}

export function createDatasourceEgressPolicyRegistry(authorizer: CapabilityAuthorizer) {
  const registry = Object.freeze({});
  const policiesById = new Map<string, PolicyRecord>();

  function requirePolicy(
    capability: AppCapability,
    value: unknown,
  ): BoundaryResult<DatasourceEgressPolicy> {
    if (typeof value !== "object" || value === null) {
      return failure(
        "DATASOURCE_POLICY_REQUIRED",
        "Datasource Egress 必须使用服务端登记的 Policy。",
      );
    }
    const record = trustedPolicies.get(value);
    if (!record || record.registry !== registry) {
      return failure(
        "DATASOURCE_POLICY_AUTHORITY_MISMATCH",
        "Datasource Policy 不是由当前 App Authority 签发。",
      );
    }
    if (record.revoked) {
      return failure("DATASOURCE_POLICY_REVOKED", "Datasource Policy 已撤销。");
    }
    if (!sameScope(capability.scope, record.policy.scope)) {
      return failure(
        "DATASOURCE_POLICY_SCOPE_DENIED",
        "Datasource Policy 不属于当前 App/Tenant/Environment。",
      );
    }
    if (
      !record.policy.allowed_roles.includes(capability.role as Exclude<AppCapabilityRole, "DEMO">)
    ) {
      return failure("DATASOURCE_POLICY_ROLE_DENIED", "当前 Role 不在 Datasource Policy ACL 中。");
    }
    return { ok: true, value: record.policy };
  }

  function requireApproval(
    capability: AppCapability,
    value: unknown,
  ): BoundaryResult<PinnedDatasourceEgress> {
    if (typeof value !== "object" || value === null) {
      return failure(
        "DATASOURCE_EGRESS_APPROVAL_REQUIRED",
        "必须使用服务端签发的 Pinned Egress Approval。",
      );
    }
    const record = trustedEgressApprovals.get(value);
    if (
      !record ||
      record.registry !== registry ||
      !sameScope(capability.scope, record.approval.scope) ||
      capability.principal !== record.approval.requested_by ||
      Date.parse(record.approval.expires_at) <= Date.now()
    ) {
      return failure(
        "DATASOURCE_EGRESS_APPROVAL_REQUIRED",
        "Pinned Egress Approval 的 Authority、Scope 或 Principal 不匹配。",
      );
    }
    const currentPolicy = policiesById.get(record.approval.policy_id);
    if (
      !currentPolicy ||
      currentPolicy.revoked ||
      currentPolicy.policy.version !== record.approval.policy_version
    ) {
      return failure(
        "DATASOURCE_POLICY_REVOKED",
        "Pinned Egress Approval 引用的 Policy 已撤销或过期。",
      );
    }
    return { ok: true, value: record.approval };
  }

  function requireVerifiedApproval(
    capability: AppCapability,
    value: unknown,
  ): BoundaryResult<VerifiedDatasourceEgress> {
    if (typeof value !== "object" || value === null) {
      return failure(
        "DATASOURCE_VERIFIED_APPROVAL_REQUIRED",
        "连接目标必须消费刚完成 DNS 校验的 Approval。",
      );
    }
    const record = verifiedEgressApprovals.get(value);
    if (
      !record ||
      record.registry !== registry ||
      record.consumed ||
      !sameScope(capability.scope, record.approval.scope) ||
      capability.principal !== record.approval.requested_by ||
      Date.parse(record.approval.target_expires_at) <= Date.now()
    ) {
      return failure(
        "DATASOURCE_VERIFIED_APPROVAL_REQUIRED",
        "Verified Approval 已过期、已消费或 Scope/Principal 不匹配。",
      );
    }
    const currentPolicy = policiesById.get(record.approval.policy_id);
    if (
      !currentPolicy ||
      currentPolicy.revoked ||
      currentPolicy.policy.version !== record.approval.policy_version
    ) {
      return failure("DATASOURCE_POLICY_REVOKED", "Datasource Policy 已撤销或过期。");
    }
    return { ok: true, value: record.approval };
  }

  return {
    createPolicy(capabilityInput: unknown, input: unknown): BoundaryResult<DatasourceEgressPolicy> {
      const capability = authorizer.requireRole(capabilityInput, ["OWNER"], "WRITE");
      if (!capability.ok) return capability;
      const parsed = policySchema.safeParse(input);
      if (!parsed.success) {
        return failure("DATASOURCE_POLICY_INVALID", "Datasource Egress Policy 非法。");
      }
      const now = new Date().toISOString();
      const policy = Object.freeze({
        policy_id: randomUUID(),
        version: 1,
        scope: capability.value.scope,
        created_by: capability.value.principal,
        issued_at: now,
        datasource_id: parsed.data.datasource_id,
        allowed_hosts: Object.freeze(
          [...new Set(parsed.data.allowed_hosts.map((host) => host.toLowerCase()))].sort(),
        ),
        allowed_ports: Object.freeze([...new Set(parsed.data.allowed_ports)].sort((a, b) => a - b)),
        allowed_protocols: Object.freeze([...new Set(parsed.data.allowed_protocols)].sort()),
        allowed_roles: Object.freeze([...new Set(parsed.data.allowed_roles)].sort()),
      });
      const record = { registry, policy, revoked: false };
      trustedPolicies.set(policy, record);
      policiesById.set(policy.policy_id, record);
      return { ok: true, value: policy };
    },

    revokePolicy(capabilityInput: unknown, policyInput: unknown): BoundaryResult<void> {
      const capability = authorizer.requireRole(capabilityInput, ["OWNER"], "WRITE");
      if (!capability.ok) return capability;
      const policy = requirePolicy(capability.value, policyInput);
      if (!policy.ok) return policy;
      const record = policiesById.get(policy.value.policy_id);
      if (!record) return failure("DATASOURCE_POLICY_REQUIRED", "Datasource Policy 不存在。");
      record.revoked = true;
      return { ok: true, value: undefined };
    },

    async approve(
      capabilityInput: unknown,
      policyInput: unknown,
      requestInput: unknown,
      resolver: DnsResolver,
    ): Promise<BoundaryResult<PinnedDatasourceEgress>> {
      const capability = authorizer.requireRole(
        capabilityInput,
        ["OWNER", "ANALYST", "VIEWER"],
        "EGRESS_CONNECT",
      );
      if (!capability.ok) return capability;
      const policy = requirePolicy(capability.value, policyInput);
      if (!policy.ok) return policy;
      const request = requestSchema.safeParse(requestInput);
      if (!request.success) {
        return failure("DATASOURCE_URL_DENIED", "Datasource URL 不满足 Egress Policy。");
      }
      if (request.data.datasource_id !== policy.value.datasource_id) {
        return failure(
          "DATASOURCE_POLICY_MISMATCH",
          "Datasource ID 与服务端 Egress Policy 不匹配。",
        );
      }

      const url = new URL(request.data.url);
      const host = url.hostname.toLowerCase();
      const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
      if (
        url.username !== "" ||
        url.password !== "" ||
        ipaddr.isValid(host.replace(/^\[|\]$/g, "")) ||
        !policy.value.allowed_protocols.includes(url.protocol as "https:" | "http:") ||
        !policy.value.allowed_hosts.includes(host) ||
        !policy.value.allowed_ports.includes(port)
      ) {
        return failure("DATASOURCE_URL_DENIED", "Datasource URL 不满足 Egress Policy。");
      }

      const addresses = normalizePublicEgressAddresses(await resolver.resolve(host));
      if (!addresses) {
        return failure("DATASOURCE_ADDRESS_DENIED", "Datasource DNS 解析到受限地址。");
      }
      const issuedAt = Date.now();
      const approval = Object.freeze({
        policy_id: policy.value.policy_id,
        policy_version: policy.value.version,
        scope: capability.value.scope,
        requested_by: capability.value.principal,
        issued_at: new Date(issuedAt).toISOString(),
        expires_at: new Date(issuedAt + approvalTtlMs).toISOString(),
        datasource_id: request.data.datasource_id,
        url: url.toString(),
        host,
        pinned_addresses: Object.freeze(addresses),
      });
      trustedEgressApprovals.set(approval, { registry, approval });
      return { ok: true, value: approval };
    },

    async verify(
      capabilityInput: unknown,
      approvalInput: unknown,
      resolver: DnsResolver,
    ): Promise<BoundaryResult<VerifiedDatasourceEgress>> {
      const capability = authorizer.requireRole(
        capabilityInput,
        ["OWNER", "ANALYST", "VIEWER"],
        "EGRESS_CONNECT",
      );
      if (!capability.ok) return capability;
      const approval = requireApproval(capability.value, approvalInput);
      if (!approval.ok) return approval;
      const next = normalizePublicEgressAddresses(await resolver.resolve(approval.value.host));
      const expected = [...approval.value.pinned_addresses].sort();
      if (
        !next ||
        next.length !== expected.length ||
        !next.every((address, index) => address === expected[index])
      ) {
        return failure("DATASOURCE_DNS_REBIND", "连接前 DNS 解析偏离已批准地址集合。");
      }
      const verifiedAt = Date.now();
      const verified = Object.freeze({
        ...approval.value,
        verified_at: new Date(verifiedAt).toISOString(),
        target_expires_at: new Date(verifiedAt + verifiedTargetTtlMs).toISOString(),
      });
      verifiedEgressApprovals.set(verified, {
        registry,
        approval: verified,
        consumed: false,
      });
      return { ok: true, value: verified };
    },

    async connect<T>(
      capabilityInput: unknown,
      verifiedApprovalInput: unknown,
      connector: DatasourceConnector<T>,
      selectedAddress?: string,
    ): Promise<BoundaryResult<T>> {
      const capability = authorizer.requireRole(
        capabilityInput,
        ["OWNER", "ANALYST", "VIEWER"],
        "EGRESS_CONNECT",
      );
      if (!capability.ok) return capability;
      const approval = requireVerifiedApproval(capability.value, verifiedApprovalInput);
      if (!approval.ok) return approval;
      const address = selectedAddress ?? approval.value.pinned_addresses[0];
      if (!address || !approval.value.pinned_addresses.includes(address)) {
        return failure(
          "DATASOURCE_EGRESS_APPROVAL_REQUIRED",
          "网络 Adapter 只能直连已签发 Approval 中的固定地址。",
        );
      }
      const record = verifiedEgressApprovals.get(approval.value);
      if (!record) {
        return failure("DATASOURCE_VERIFIED_APPROVAL_REQUIRED", "Verified Approval 已失效。");
      }
      record.consumed = true;
      const target = Object.freeze({
        scope: approval.value.scope,
        url: approval.value.url,
        address,
        server_name: approval.value.host,
        redirects: "DENY" as const,
      });
      try {
        return { ok: true, value: await connector.connect(target) };
      } catch {
        return failure(
          "DATASOURCE_CONNECT_FAILED",
          "Datasource Connector 失败；底层错误细节已脱敏。",
        );
      }
    },
  };
}
