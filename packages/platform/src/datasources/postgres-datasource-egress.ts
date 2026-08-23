import { randomUUID } from "node:crypto";
import type { AppScope, PortResult } from "@data-agent/contracts";
import ipaddr from "ipaddr.js";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlClient,
  type SqlPool,
  type SqlQueryResult,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { AppCapability } from "../tenancy/capability.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const stableIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const hostPattern =
  /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const protocolSchema = z.enum(["https:", "http:", "postgresql:"]);
const databaseTimestampSchema = z
  .union([z.string(), z.date()])
  .transform((value) =>
    value instanceof Date ? value.toISOString() : new Date(value).toISOString(),
  );
const databasePolicySchema = z.object({
  app_id: z.uuid(),
  tenant_id: z.uuid(),
  environment: z.string().min(1).max(64),
  policy_id: z.uuid(),
  datasource_id: z.string().regex(stableIdentifier),
  created_by: z.uuid(),
  version: z.coerce.number().int().positive().safe(),
  status: z.enum(["ACTIVE", "REVOKED"]),
  allowed_hosts: z.array(z.string().regex(hostPattern)).min(1),
  allowed_ports: z.array(z.coerce.number().int().min(1).max(65_535)).min(1),
  allowed_protocols: z.array(protocolSchema).min(1),
  allowed_roles: z.array(z.enum(["owner", "analyst"])).min(1),
  revoked_at: databaseTimestampSchema.nullable(),
});
const databaseApprovalSchema = z.object({
  app_id: z.uuid(),
  tenant_id: z.uuid(),
  environment: z.string().min(1).max(64),
  approval_id: z.uuid(),
  policy_id: z.uuid(),
  policy_version: z.coerce.number().int().positive().safe(),
  requested_by: z.uuid(),
  requested_url: z.string().min(1).max(2_000),
  requested_host: z.string().regex(hostPattern),
  requested_port: z.coerce.number().int().min(1).max(65_535),
  requested_protocol: protocolSchema,
  pinned_addresses: z.array(z.string().min(2).max(64)).min(1),
  status: z.enum(["PINNED", "VERIFIED", "CONSUMED"]),
  expires_at: databaseTimestampSchema,
  verified_at: databaseTimestampSchema.nullable(),
  target_expires_at: databaseTimestampSchema.nullable(),
  consumed_at: databaseTimestampSchema.nullable(),
});
const createPolicySchema = z.strictObject({
  datasource_id: z.string().regex(stableIdentifier),
  allowed_hosts: z.array(z.string().regex(hostPattern)).min(1).max(64),
  allowed_ports: z.array(z.number().int().min(1).max(65_535)).min(1).max(32),
  allowed_protocols: z.array(protocolSchema).min(1).max(3),
  allowed_roles: z
    .array(z.enum(["OWNER", "ANALYST"]))
    .min(1)
    .max(2)
    .default(["OWNER", "ANALYST"]),
});
const policyReferenceSchema = z.strictObject({
  policy_id: z.uuid(),
  expected_version: z.number().int().positive().safe(),
});
const approvalRequestSchema = z.strictObject({
  policy_id: z.uuid(),
  expected_policy_version: z.number().int().positive().safe(),
  datasource_id: z.string().regex(stableIdentifier),
  url: z.string().url().max(2_000),
});
const approvalReferenceSchema = z.strictObject({
  approval_id: z.uuid(),
  expected_policy_version: z.number().int().positive().safe(),
});
const connectSchema = approvalReferenceSchema.extend({
  selected_address: z.string().min(2).max(64).optional(),
});

export type PersistedDatasourceEgressPolicy = Readonly<{
  scope: AppScope;
  policy_id: string;
  datasource_id: string;
  version: number;
  status: "ACTIVE" | "REVOKED";
  allowed_hosts: readonly string[];
  allowed_ports: readonly number[];
  allowed_protocols: readonly z.infer<typeof protocolSchema>[];
  allowed_roles: readonly ("OWNER" | "ANALYST")[];
}>;

export type PersistedDatasourceEgressApproval = Readonly<{
  scope: AppScope;
  approval_id: string;
  policy_id: string;
  policy_version: number;
  requested_by: string;
  url: string;
  host: string;
  port: number;
  protocol: z.infer<typeof protocolSchema>;
  pinned_addresses: readonly string[];
  status: "PINNED" | "VERIFIED" | "CONSUMED";
  expires_at: string;
  target_expires_at: string | null;
}>;

export type DatasourceConnectionTarget = Readonly<{
  scope: AppScope;
  url: string;
  address: string;
  port: number;
  server_name: string;
  protocol: z.infer<typeof protocolSchema>;
  redirects: "DENY";
}>;

export interface DatasourceDnsResolver {
  resolve(host: string): Promise<readonly string[]>;
}

interface JsonResultRow {
  readonly value: unknown;
}

function rethrowDatasourceDatabaseError(error: unknown): never {
  const reason =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  switch (reason) {
    case "DA_OWNER_REQUIRED":
      throw new PersistenceBoundaryError(
        "DATASOURCE_POLICY_OWNER_REQUIRED",
        "只有 Owner 可以变更 Datasource Egress Policy。",
      );
    case "DA_DATASOURCE_POLICY_INVALID":
      throw new PersistenceBoundaryError(
        "DATASOURCE_POLICY_INVALID",
        "Datasource Egress Policy 不符合数据库权威契约。",
      );
    case "DA_DATASOURCE_POLICY_STALE":
    case "DA_DATASOURCE_POLICY_FORBIDDEN":
      throw new PersistenceBoundaryError(
        "DATASOURCE_POLICY_STALE_OR_FORBIDDEN",
        "Datasource Policy 不存在、已撤销、Version 已过期或当前权限不足。",
      );
    case "DA_DATASOURCE_APPROVAL_INVALID":
      throw new PersistenceBoundaryError(
        "DATASOURCE_APPROVAL_INVALID",
        "Datasource Approval 不符合数据库权威契约。",
      );
    case "DA_DATASOURCE_APPROVAL_STALE":
      throw new PersistenceBoundaryError(
        "DATASOURCE_APPROVAL_STALE_OR_FORBIDDEN",
        "Datasource Approval 已过期、已消费、Policy 已撤销或当前权限不足。",
      );
    case "DA_DATASOURCE_DNS_REBIND":
      throw new PersistenceBoundaryError(
        "DATASOURCE_DNS_REBIND",
        "连接前 DNS 结果或短时 Target Authority 已失效。",
      );
    default:
      throw error;
  }
}

async function queryDatasourceAuthority<Row extends object>(
  client: SqlClient,
  text: string,
  values: readonly unknown[],
): Promise<SqlQueryResult<Row>> {
  try {
    return await client.query<Row>(text, values);
  } catch (error) {
    rethrowDatasourceDatabaseError(error);
  }
}

function failure<T>(code: string, message: string, retryable = false): PortResult<T> {
  return { ok: false, error: { code, message, retryable } };
}

function policy(value: unknown): PersistedDatasourceEgressPolicy {
  const parsed = databasePolicySchema.safeParse(value);
  if (!parsed.success) {
    throw new PersistenceBoundaryError(
      "DATASOURCE_POLICY_DATABASE_CONTRACT_INVALID",
      "PostgreSQL 返回的 Datasource Policy 不符合契约。",
    );
  }
  return Object.freeze({
    scope: Object.freeze({
      app_id: parsed.data.app_id,
      tenant_id: parsed.data.tenant_id,
      environment: parsed.data.environment,
    }),
    policy_id: parsed.data.policy_id,
    datasource_id: parsed.data.datasource_id,
    version: parsed.data.version,
    status: parsed.data.status,
    allowed_hosts: Object.freeze(parsed.data.allowed_hosts),
    allowed_ports: Object.freeze(parsed.data.allowed_ports),
    allowed_protocols: Object.freeze(parsed.data.allowed_protocols),
    allowed_roles: Object.freeze(
      parsed.data.allowed_roles.map((role) => role.toUpperCase() as "OWNER" | "ANALYST"),
    ),
  });
}

function approval(value: unknown): PersistedDatasourceEgressApproval {
  const parsed = databaseApprovalSchema.safeParse(value);
  if (!parsed.success) {
    throw new PersistenceBoundaryError(
      "DATASOURCE_APPROVAL_DATABASE_CONTRACT_INVALID",
      "PostgreSQL 返回的 Datasource Approval 不符合契约。",
    );
  }
  return Object.freeze({
    scope: Object.freeze({
      app_id: parsed.data.app_id,
      tenant_id: parsed.data.tenant_id,
      environment: parsed.data.environment,
    }),
    approval_id: parsed.data.approval_id,
    policy_id: parsed.data.policy_id,
    policy_version: parsed.data.policy_version,
    requested_by: parsed.data.requested_by,
    url: parsed.data.requested_url,
    host: parsed.data.requested_host,
    port: parsed.data.requested_port,
    protocol: parsed.data.requested_protocol,
    pinned_addresses: Object.freeze(parsed.data.pinned_addresses),
    status: parsed.data.status,
    expires_at: parsed.data.expires_at,
    target_expires_at: parsed.data.target_expires_at,
  });
}

function canonicalPublicAddress(address: string): string | null {
  if (!ipaddr.isValid(address)) return null;
  const parsed = ipaddr.parse(address);
  if (parsed instanceof ipaddr.IPv6 && parsed.isIPv4MappedAddress()) {
    return null;
  }
  if (
    parsed instanceof ipaddr.IPv6 &&
    ["64:ff9b::/96", "64:ff9b:1::/48", "2001::/32", "2002::/16"].some((cidr) => {
      const [network, prefix] = ipaddr.parseCIDR(cidr);
      return network instanceof ipaddr.IPv6 && parsed.match(network, prefix);
    })
  ) {
    return null;
  }
  return parsed.range() === "unicast" ? parsed.toString() : null;
}

function normalizePublicAddresses(addresses: readonly string[]): readonly string[] | null {
  if (addresses.length === 0) return null;
  const normalized = addresses.map(canonicalPublicAddress);
  if (normalized.some((address) => address === null)) return null;
  return [...new Set(normalized as string[])].sort();
}

function defaultPort(protocol: z.infer<typeof protocolSchema>): number {
  if (protocol === "https:") return 443;
  if (protocol === "http:") return 80;
  return 5432;
}

async function loadPolicy(
  client: SqlClient,
  capability: AppCapability,
  policyId: string,
  expectedVersion: number,
): Promise<PersistedDatasourceEgressPolicy> {
  const result = await client.query(
    `select
       app_id,
       tenant_id,
       environment,
       policy_id,
       datasource_id,
       created_by,
       version,
       status,
       allowed_hosts,
       allowed_ports,
       allowed_protocols,
       allowed_roles,
       revoked_at
     from datasource_egress_policies
     where app_id = $1
       and tenant_id = $2
       and environment = $3
       and policy_id = $4::uuid
       and version = $5::bigint
       and status = 'ACTIVE'`,
    [
      capability.scope.app_id,
      capability.scope.tenant_id,
      capability.scope.environment,
      policyId,
      expectedVersion,
    ],
  );
  if (!result.rows[0]) {
    throw new PersistenceBoundaryError(
      "DATASOURCE_POLICY_STALE_OR_FORBIDDEN",
      "Datasource Policy 不存在、已撤销或 Version 已过期。",
    );
  }
  return policy(result.rows[0]);
}

async function loadApproval(
  client: SqlClient,
  capability: AppCapability,
  approvalId: string,
  expectedPolicyVersion: number,
  expectedStatus: "PINNED" | "VERIFIED",
): Promise<PersistedDatasourceEgressApproval> {
  const result = await client.query(
    `select
       app_id,
       tenant_id,
       environment,
       approval_id,
       policy_id,
       policy_version,
       requested_by,
       requested_url,
       requested_host,
       requested_port,
       requested_protocol,
       pinned_addresses,
       status,
       expires_at,
       verified_at,
       target_expires_at,
       consumed_at
     from datasource_egress_approvals
     where app_id = $1
       and tenant_id = $2
       and environment = $3
       and approval_id = $4::uuid
       and requested_by = $5::uuid
       and policy_version = $6::bigint
       and status = $7::text`,
    [
      capability.scope.app_id,
      capability.scope.tenant_id,
      capability.scope.environment,
      approvalId,
      capability.principal,
      expectedPolicyVersion,
      expectedStatus,
    ],
  );
  if (!result.rows[0]) {
    throw new PersistenceBoundaryError(
      "DATASOURCE_APPROVAL_STALE_OR_FORBIDDEN",
      "Datasource Approval 不存在、已消费或不属于当前 Principal。",
    );
  }
  return approval(result.rows[0]);
}

export function createPostgresDatasourceEgress(
  pool: SqlPool,
  authorizer: TransactionalCapabilityAuthorizer,
) {
  return {
    async createPolicy(
      capabilityInput: unknown,
      input: unknown,
    ): Promise<PortResult<PersistedDatasourceEgressPolicy>> {
      const parsed = createPolicySchema.safeParse(input);
      if (!parsed.success) {
        return failure("DATASOURCE_POLICY_INVALID", "Datasource Egress Policy 非法。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "WRITE" },
        async ({ capability, client }) => {
          if (capability.role !== "OWNER") {
            throw new PersistenceBoundaryError(
              "DATASOURCE_POLICY_OWNER_REQUIRED",
              "只有 Owner 可以登记 Datasource Egress Policy。",
            );
          }
          const result = await queryDatasourceAuthority<JsonResultRow>(
            client,
            `select app_data_agent.register_datasource_egress_policy(
               $1::uuid,
               $2::text,
               $3::text[],
               $4::integer[],
               $5::text[],
               $6::text[]
             ) as value`,
            [
              randomUUID(),
              parsed.data.datasource_id,
              parsed.data.allowed_hosts.map((host) => host.toLowerCase()),
              parsed.data.allowed_ports,
              parsed.data.allowed_protocols,
              parsed.data.allowed_roles.map((role) => role.toLowerCase()),
            ],
          );
          return policy(result.rows[0]?.value);
        },
      );
    },

    async revokePolicy(
      capabilityInput: unknown,
      input: unknown,
    ): Promise<PortResult<PersistedDatasourceEgressPolicy>> {
      const parsed = policyReferenceSchema.safeParse(input);
      if (!parsed.success) {
        return failure("DATASOURCE_POLICY_INVALID", "Datasource Policy Reference 非法。");
      }
      return withAppTransaction(
        pool,
        authorizer,
        capabilityInput,
        { access: "WRITE" },
        async ({ capability, client }) => {
          if (capability.role !== "OWNER") {
            throw new PersistenceBoundaryError(
              "DATASOURCE_POLICY_OWNER_REQUIRED",
              "只有 Owner 可以撤销 Datasource Egress Policy。",
            );
          }
          const result = await queryDatasourceAuthority<JsonResultRow>(
            client,
            `select app_data_agent.revoke_datasource_egress_policy(
               $1::uuid,
               $2::bigint
             ) as value`,
            [parsed.data.policy_id, parsed.data.expected_version],
          );
          return policy(result.rows[0]?.value);
        },
      );
    },

    async approve(
      capabilityInput: unknown,
      input: unknown,
      resolver: DatasourceDnsResolver,
    ): Promise<PortResult<PersistedDatasourceEgressApproval>> {
      const parsed = approvalRequestSchema.safeParse(input);
      if (!parsed.success) {
        return failure("DATASOURCE_URL_DENIED", "Datasource URL 或 Policy Reference 非法。");
      }
      const currentCapability = await authorizer.revalidate(
        capabilityInput,
        ["OWNER", "ANALYST"],
        "EGRESS_CONNECT",
      );
      if (!currentCapability.ok) return currentCapability;
      const loadedPolicy = await withAppTransaction(
        pool,
        authorizer,
        currentCapability.value,
        { access: "READ" },
        ({ capability, client }) =>
          loadPolicy(
            client,
            capability,
            parsed.data.policy_id,
            parsed.data.expected_policy_version,
          ),
      );
      if (!loadedPolicy.ok) return loadedPolicy;
      if (
        loadedPolicy.value.datasource_id !== parsed.data.datasource_id ||
        !loadedPolicy.value.allowed_roles.includes(
          currentCapability.value.role as "OWNER" | "ANALYST",
        )
      ) {
        return failure("DATASOURCE_POLICY_FORBIDDEN", "Datasource ID 或当前 Role 不属于 Policy。");
      }

      const url = new URL(parsed.data.url);
      const protocol = protocolSchema.safeParse(url.protocol);
      const host = url.hostname.toLowerCase();
      if (
        !protocol.success ||
        url.username !== "" ||
        url.password !== "" ||
        url.pathname !== "/" ||
        url.search !== "" ||
        url.hash !== "" ||
        ipaddr.isValid(host.replace(/^\[|\]$/g, "")) ||
        !loadedPolicy.value.allowed_protocols.includes(protocol.data) ||
        !loadedPolicy.value.allowed_hosts.includes(host)
      ) {
        return failure("DATASOURCE_URL_DENIED", "Datasource URL 不满足服务端 Policy。");
      }
      const port = Number(url.port || defaultPort(protocol.data));
      if (!loadedPolicy.value.allowed_ports.includes(port)) {
        return failure("DATASOURCE_URL_DENIED", "Datasource Port 不满足服务端 Policy。");
      }

      let resolved: readonly string[];
      try {
        resolved = await resolver.resolve(host);
      } catch {
        return failure(
          "DATASOURCE_DNS_UNAVAILABLE",
          "Datasource DNS 暂时不可用；底层错误已脱敏。",
          true,
        );
      }
      const addresses = normalizePublicAddresses(resolved);
      if (!addresses) {
        return failure("DATASOURCE_ADDRESS_DENIED", "Datasource DNS 解析到受限地址。");
      }
      const expiresAt = new Date(Date.now() + 30_000).toISOString();
      return withAppTransaction(
        pool,
        authorizer,
        currentCapability.value,
        { access: "WRITE" },
        async ({ client }) => {
          const result = await queryDatasourceAuthority<JsonResultRow>(
            client,
            `select app_data_agent.register_datasource_egress_approval(
               $1::uuid,
               $2::uuid,
               $3::bigint,
               $4::text,
               $5::text,
               $6::integer,
               $7::text,
               $8::inet[],
               $9::timestamptz
             ) as value`,
            [
              randomUUID(),
              loadedPolicy.value.policy_id,
              loadedPolicy.value.version,
              url.toString(),
              host,
              port,
              protocol.data,
              addresses,
              expiresAt,
            ],
          );
          return approval(result.rows[0]?.value);
        },
      );
    },

    async verify(
      capabilityInput: unknown,
      input: unknown,
      resolver: DatasourceDnsResolver,
    ): Promise<PortResult<PersistedDatasourceEgressApproval>> {
      const parsed = approvalReferenceSchema.safeParse(input);
      if (!parsed.success) {
        return failure("DATASOURCE_APPROVAL_INVALID", "Datasource Approval Reference 非法。");
      }
      const currentCapability = await authorizer.revalidate(
        capabilityInput,
        ["OWNER", "ANALYST"],
        "EGRESS_CONNECT",
      );
      if (!currentCapability.ok) return currentCapability;
      const loaded = await withAppTransaction(
        pool,
        authorizer,
        currentCapability.value,
        { access: "READ" },
        ({ capability, client }) =>
          loadApproval(
            client,
            capability,
            parsed.data.approval_id,
            parsed.data.expected_policy_version,
            "PINNED",
          ),
      );
      if (!loaded.ok) return loaded;

      let resolved: readonly string[];
      try {
        resolved = await resolver.resolve(loaded.value.host);
      } catch {
        return failure(
          "DATASOURCE_DNS_UNAVAILABLE",
          "Datasource DNS 暂时不可用；底层错误已脱敏。",
          true,
        );
      }
      const addresses = normalizePublicAddresses(resolved);
      if (
        !addresses ||
        addresses.length !== loaded.value.pinned_addresses.length ||
        !addresses.every((address, index) => address === loaded.value.pinned_addresses[index])
      ) {
        return failure("DATASOURCE_DNS_REBIND", "连接前 DNS 结果偏离已批准地址集合。");
      }
      const targetExpiresAt = new Date(Date.now() + 5_000).toISOString();
      return withAppTransaction(
        pool,
        authorizer,
        currentCapability.value,
        { access: "WRITE" },
        async ({ client }) => {
          const result = await queryDatasourceAuthority<JsonResultRow>(
            client,
            `select app_data_agent.verify_datasource_egress_approval(
               $1::uuid,
               $2::bigint,
               $3::inet[],
               $4::timestamptz
             ) as value`,
            [loaded.value.approval_id, loaded.value.policy_version, addresses, targetExpiresAt],
          );
          return approval(result.rows[0]?.value);
        },
      );
    },

    async consumeTarget(
      capabilityInput: unknown,
      input: unknown,
    ): Promise<PortResult<DatasourceConnectionTarget>> {
      const parsed = connectSchema.safeParse(input);
      if (!parsed.success) {
        return failure("DATASOURCE_APPROVAL_INVALID", "Datasource Connect Reference 非法。");
      }
      const currentCapability = await authorizer.revalidate(
        capabilityInput,
        ["OWNER", "ANALYST"],
        "EGRESS_CONNECT",
      );
      if (!currentCapability.ok) return currentCapability;
      const loaded = await withAppTransaction(
        pool,
        authorizer,
        currentCapability.value,
        { access: "READ" },
        ({ capability, client }) =>
          loadApproval(
            client,
            capability,
            parsed.data.approval_id,
            parsed.data.expected_policy_version,
            "VERIFIED",
          ),
      );
      if (!loaded.ok) return loaded;
      const selectedAddress = parsed.data.selected_address ?? loaded.value.pinned_addresses[0];
      if (!selectedAddress || !loaded.value.pinned_addresses.includes(selectedAddress)) {
        return failure("DATASOURCE_ADDRESS_DENIED", "Connector 只能使用 Approval 中的固定地址。");
      }

      const consumed = await withAppTransaction(
        pool,
        authorizer,
        currentCapability.value,
        { access: "WRITE" },
        async ({ client }) => {
          const result = await queryDatasourceAuthority<JsonResultRow>(
            client,
            `select app_data_agent.consume_datasource_egress_approval(
               $1::uuid,
               $2::bigint,
               $3::inet
             ) as value`,
            [loaded.value.approval_id, loaded.value.policy_version, selectedAddress],
          );
          return approval(result.rows[0]?.value);
        },
      );
      if (!consumed.ok) return consumed;

      const target = Object.freeze({
        scope: consumed.value.scope,
        url: consumed.value.url,
        address: selectedAddress,
        port: consumed.value.port,
        server_name: consumed.value.host,
        protocol: consumed.value.protocol,
        redirects: "DENY" as const,
      });
      return { ok: true, value: target };
    },
  };
}
