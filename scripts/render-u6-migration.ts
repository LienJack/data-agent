import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const U6_MIGRATION_NAME = "20260725010590_app_data_agent_u6_research_authority.sql";
export const U6_MIGRATION_VERSION = "20260725010590_app_data_agent_u6_research_authority";
export const U6_CHECKSUM_PLACEHOLDER = "__U6_MIGRATION_CHECKSUM__";
export const U6_ZERO_CHECKSUM = `sha256:${"0".repeat(64)}`;
export const U6_SOURCE_SEGMENTS = [
  "00-preamble.sql.inc",
  "10-existing-table-alterations.sql.inc",
  "20-capability-key-metadata.sql.inc",
  "30-artifact-authority.sql.inc",
  "40-frontier-readiness.sql.inc",
  "50-resource.sql.inc",
  "60-invocation-system-records.sql.inc",
  "70-cross-fks-indexes-triggers.sql.inc",
  "80-internal-functions.sql.inc",
  "81-root-rpcs.sql.inc",
  "82-resource-invocation-rpcs.sql.inc",
  "83-resolvers-provisioner.sql.inc",
  "84-lifecycle-cleanup.sql.inc",
  "90-rls-owner-grants.sql.inc",
  "99-postconditions-commit.sql.inc",
] as const;

const APP_ID = "00000000-0000-4000-8000-00000000da01";
const MANIFEST_PROTOCOL = "u6-migration-maintenance@1.0.0";
const MANIFEST_DOMAIN = `${MANIFEST_PROTOCOL}\0`;
const CHECKSUM_PATTERN = "sha256:[0-9a-f]{64}";

const PUBLIC_MUTATION_FUNCTIONS = [
  "abort_invocation_terminal_preparation(jsonb)",
  "advance_research_version_frontier(jsonb)",
  "authorize_agent_data_projection(jsonb)",
  "begin_research_resource(jsonb)",
  "cancel_research_resource(jsonb)",
  "commit_adapter_termination_receipt(jsonb)",
  "commit_current_l2_artifact(jsonb)",
  "commit_current_release_go(jsonb)",
  "commit_invocation_terminal(jsonb)",
  "commit_report_read_response(jsonb)",
  "commit_research_stop_terminal(jsonb)",
  "consume_current_ready(jsonb)",
  "consume_report_read_grant(jsonb)",
  "erase_subject_invocation_result(jsonb)",
  "expire_report_read_grant(jsonb)",
  "expire_research_resource(jsonb)",
  "expire_tool_invocation_permit(jsonb)",
  "initialize_research_version_frontier(jsonb)",
  "issue_tool_invocation_permit(jsonb)",
  "mark_research_invocation_outcome_unknown(jsonb)",
  "mark_research_resource_abandoned(jsonb)",
  "prepare_invocation_terminal(jsonb)",
  "publish_current_report_readiness(jsonb)",
  "reserve_research_resource(jsonb)",
  "revoke_current_readiness(jsonb)",
  "revoke_tool_invocation_permit(jsonb)",
  "settle_research_resource(jsonb)",
  "start_research_invocation(jsonb)",
  "tombstone_invocation_result(jsonb)",
] as const;

const PUBLIC_RESOLVER_FUNCTIONS = [
  "read_historical_l2_research_artifact(jsonb)",
  "resolve_committed_adapter_termination_receipt(jsonb)",
  "resolve_committed_invocation_outcome_usage(jsonb)",
  "resolve_committed_model_invocation_result(jsonb)",
  "resolve_committed_secure_sql_execution_receipt(jsonb)",
  "resolve_committed_sql_invocation_result(jsonb)",
  "resolve_committed_tool_invocation_result(jsonb)",
  "resolve_current_tool_invocation_permit(jsonb)",
  "resolve_invocation_result_ciphertext(jsonb)",
  "resolve_invocation_terminal_preparation_recovery_metadata(jsonb)",
] as const;

export const U6_BACKEND_EXECUTE_ENABLED_FUNCTIONS = [
  "commit_research_stop_terminal(jsonb)",
  "consume_current_ready(jsonb)",
  "publish_current_report_readiness(jsonb)",
] as const;

const DEPLOYMENT_FUNCTIONS = [
  "activate_u6_result_key_version(jsonb)",
  "compromise_u6_result_key_version(jsonb)",
  "provision_u6_authority_manifest(jsonb)",
  "provision_u6_execution_policy_manifest(jsonb)",
  "purge_u6_result_ciphertext_access_audits(jsonb)",
  "retire_u6_result_key_version(jsonb)",
  "stage_u6_result_key_version(jsonb)",
] as const;

const JOB_CLEANUP_FUNCTIONS = ["cleanup_u6_delete_pending_environment(jsonb)"] as const;

type FunctionLanguage = "sql" | "plpgsql";
type FunctionVolatility = "IMMUTABLE" | "STABLE" | "VOLATILE";
type FunctionNullInput = "STRICT" | "CALLED_ON_NULL_INPUT";

const INTERNAL_FUNCTIONS = [
  {
    signature: "lock_u6_authority_capability(jsonb,text,text,text,text,boolean)",
    owner: "data_agent_u6_rpc_owner",
    language: "plpgsql",
    volatility: "VOLATILE",
    null_input: "CALLED_ON_NULL_INPUT",
    security_definer: true,
    search_path: "",
  },
  {
    signature: "u6_domain_sha256(text,jsonb)",
    owner: "data_agent_u6_rpc_owner",
    language: "sql",
    volatility: "IMMUTABLE",
    null_input: "STRICT",
    security_definer: false,
    search_path: "",
  },
  {
    signature: "u6_uuid_v5(uuid,bytea)",
    owner: "data_agent_u6_rpc_owner",
    language: "plpgsql",
    volatility: "IMMUTABLE",
    null_input: "STRICT",
    security_definer: false,
    search_path: "",
  },
  {
    signature: "u6_strict_base64url_decode(text)",
    owner: "data_agent_u6_rpc_owner",
    language: "plpgsql",
    volatility: "IMMUTABLE",
    null_input: "STRICT",
    security_definer: false,
    search_path: "",
  },
  {
    signature: "u6_constant_time_equal(bytea,bytea)",
    owner: "data_agent_u6_rpc_owner",
    language: "plpgsql",
    volatility: "IMMUTABLE",
    null_input: "STRICT",
    security_definer: false,
    search_path: "",
  },
  {
    signature: "commit_research_revocation_receipt(jsonb)",
    owner: "data_agent_u6_rpc_owner",
    language: "plpgsql",
    volatility: "VOLATILE",
    null_input: "CALLED_ON_NULL_INPUT",
    security_definer: true,
    search_path: "",
  },
  {
    signature: "commit_research_system_artifact(jsonb)",
    owner: "data_agent_u6_rpc_owner",
    language: "plpgsql",
    volatility: "VOLATILE",
    null_input: "CALLED_ON_NULL_INPUT",
    security_definer: true,
    search_path: "",
  },
] as const;

const PLATFORM_HELPER_FUNCTIONS = [
  "lock_u6_authority_binding(uuid,uuid,text,uuid,uuid,text,text)",
  "lock_u6_cleanup_platform_evidence(uuid,text,bigint,uuid,text,uuid,text,uuid,text,uuid,text)",
] as const;

export const U6_EXPECTED_FUNCTIONS = {
  publicMutation: PUBLIC_MUTATION_FUNCTIONS,
  publicResolver: PUBLIC_RESOLVER_FUNCTIONS,
  backendExecuteEnabled: U6_BACKEND_EXECUTE_ENABLED_FUNCTIONS,
  deployment: DEPLOYMENT_FUNCTIONS,
  jobCleanup: JOB_CLEANUP_FUNCTIONS,
  internal: INTERNAL_FUNCTIONS,
  internalNames: INTERNAL_FUNCTIONS.map((item) =>
    item.signature.slice(0, item.signature.indexOf("(")),
  ),
  platformHelper: PLATFORM_HELPER_FUNCTIONS,
} as const;

type Exposure =
  | "PUBLIC_MUTATION"
  | "PUBLIC_RESOLVER"
  | "DEPLOYMENT"
  | "JOB_CLEANUP"
  | "INTERNAL"
  | "PLATFORM_HELPER";

type CleanupOwner = "U6_JOB" | "CORE_DATABASE" | "PLATFORM_CONTROL" | "RETAINED_CONTROL";

type CleanupPhase = {
  cleanup_rank: number;
  cleanup_group: string;
  static_predicate_id: string;
  identity_order: string;
};

type InventoryFunction = {
  schema: "app_data_agent" | "platform";
  signature: string;
  exposure: Exposure;
  owner: string;
  language: FunctionLanguage;
  volatility: FunctionVolatility;
  null_input: FunctionNullInput;
  security_definer: boolean;
  search_path: "";
  backend_execute_enabled: boolean;
};

type RelationInventory = {
  qualified_name: string;
  cleanup_owner: CleanupOwner;
  scope_columns: string[];
  identity_order: string;
  cleanup_phases: CleanupPhase[];
};

type MaintenanceManifest = {
  protocol_version: string;
  migration_name: string;
  deployment_scope: {
    app_id: string;
    deployment_binding: string;
    database_binding: string;
  };
  maintenance_window: {
    window_id: string;
    max_duration_ms: number;
  };
  timeouts: {
    lock_timeout_ms: number;
    statement_timeout_ms: number;
    idle_in_transaction_session_timeout_ms: number;
  };
  relation_limits: Array<{
    qualified_name: string;
    approved_max_rows: number;
    approved_max_total_bytes: number;
  }>;
  manifest_hash: string;
};

export type U6RendererPaths = {
  sourceDirectory: string;
  migrationPath: string;
  inventoryPath: string;
  maintenanceManifestPath: string;
};

const CORE_RELATIONS = [
  "app_data_agent.artifacts",
  "app_data_agent.memberships",
  "app_data_agent.outbox",
  "app_data_agent.run_attempts",
  "app_data_agent.runs",
] as const;

const PLATFORM_RELATIONS = [
  "platform.app_environment_lifecycle",
  "platform.app_lifecycle_events",
  "platform.boundary_audit_receipts",
  "platform.deployment_mappings",
  "platform.resource_manifests",
  "platform.resource_operation_receipts",
] as const;

const RETAINED_RELATIONS = [
  "app_data_agent.research_lifecycle_cleanup_batch_receipts",
  "app_data_agent.research_lifecycle_cleanup_operations",
] as const;

const PHASES: ReadonlyArray<{
  rank: number;
  group: string;
  predicate: string;
  order: string;
  relations: readonly string[];
}> = [
  {
    rank: 0,
    group: "AUDIT_LEAF",
    predicate: "ALL_SCOPE_ROWS",
    order: "FULL_PK_ASC",
    relations: [
      "research_result_ciphertext_access_audits",
      "research_result_access_audit_purge_operations",
    ],
  },
  {
    rank: 1,
    group: "ROOT_GRAPH",
    predicate: "ALL_SCOPE_ROWS",
    order: "FULL_PK_ASC",
    relations: [
      "research_release_decision_commits",
      "research_readiness_consumptions",
      "report_read_grant_expiration_operations",
      "report_read_grants",
      "research_revocation_operations",
      "research_readiness_publications",
      "current_report_readiness",
      "research_domain_terminals",
      "research_frontier_events",
      "research_version_frontiers",
      "research_frontier_operations",
      "research_stop_terminal_commits",
      "research_current_evidence_relation_keys",
      "research_artifact_commit_operations",
    ],
  },
  {
    rank: 2,
    group: "SYSTEM_CHILD",
    predicate: "ALL_SCOPE_ROWS",
    order: "FULL_PK_ASC",
    relations: [
      "research_system_record_transition_operations",
      "research_adapter_termination_receipts",
      "research_tool_invocation_permits",
      "research_system_artifacts",
    ],
  },
  {
    rank: 3,
    group: "TERMINAL_T",
    predicate: "INVOCATION_AGGREGATE",
    order: "I_ASC",
    relations: [
      "research_invocation_request_operations",
      "research_invocation_commits",
      "research_invocation_transition_operations",
      "research_invocation_terminal_preparations",
      "research_invocation_results",
      "research_invocation_result_blobs",
      "research_secure_sql_execution_receipts",
      "research_invocation_outcome_usage",
    ],
  },
  {
    rank: 4,
    group: "SYSTEM_IDENTITY",
    predicate: "ALL_SCOPE_ROWS",
    order: "FULL_PK_ASC",
    relations: ["research_system_record_identities"],
  },
  {
    rank: 5,
    group: "RESOURCE_GRAPH",
    predicate: "ALL_SCOPE_ROWS",
    order: "FULL_PK_ASC",
    relations: [
      "research_resource_transition_operations",
      "research_resource_reservations",
      "research_resource_run_heads",
    ],
  },
  {
    rank: 6,
    group: "CAPABILITY_GRAPH",
    predicate: "ALL_SCOPE_ROWS",
    order: "ASSIGNMENT_KEY_ASC",
    relations: ["research_authority_capability_heads", "research_authority_capabilities"],
  },
  {
    rank: 6,
    group: "KEY_TRANSITION",
    predicate: "ALL_SCOPE_ROWS",
    order: "FULL_PK_ASC",
    relations: ["research_result_key_transition_operations"],
  },
  {
    rank: 6,
    group: "KEY_VERSION_CHAIN",
    predicate: "ONE_SCOPE_KIND",
    order: "S_KIND_ASC",
    relations: ["research_result_key_versions"],
  },
  {
    rank: 6,
    group: "TOOL_POLICY",
    predicate: "ALL_SCOPE_ROWS",
    order: "FULL_PK_ASC",
    relations: ["research_tool_permit_policy_limits"],
  },
  {
    rank: 6,
    group: "HISTORICAL_RETENTION",
    predicate: "NON_CURRENT_RESULT_POLICY",
    order: "FULL_PK_ASC",
    relations: ["research_result_retention_policies"],
  },
  {
    rank: 6,
    group: "HISTORICAL_RETENTION",
    predicate: "NON_CURRENT_AUDIT_POLICY",
    order: "FULL_PK_ASC",
    relations: ["research_result_access_audit_retention_policies"],
  },
  {
    rank: 7,
    group: "TENANT_GOVERNANCE_FINAL",
    predicate: "CURRENT_RESULT_POLICY",
    order: "TENANT_UUID_ASC",
    relations: ["research_result_retention_policy_heads", "research_result_retention_policies"],
  },
  {
    rank: 7,
    group: "TENANT_GOVERNANCE_FINAL",
    predicate: "CURRENT_AUDIT_POLICY",
    order: "TENANT_UUID_ASC",
    relations: [
      "research_result_access_audit_retention_heads",
      "research_result_access_audit_retention_policies",
    ],
  },
] as const;

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    assertCondition(Number.isFinite(value), "JCS 不允许非有限数值");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  assertCondition(typeof value === "object" && value !== null, "JCS 输入必须是 JSON 值");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function assertStrictKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assertCondition(
    JSON.stringify(actual) === JSON.stringify(wanted),
    `${label} 字段不闭合：actual=${actual.join(",")}`,
  );
}

function validateMaintenanceManifest(raw: unknown): MaintenanceManifest {
  assertCondition(
    typeof raw === "object" && raw !== null && !Array.isArray(raw),
    "U6 maintenance manifest 必须是 object",
  );
  const manifest = raw as unknown as MaintenanceManifest;
  assertStrictKeys(
    manifest as unknown as Record<string, unknown>,
    [
      "protocol_version",
      "migration_name",
      "deployment_scope",
      "maintenance_window",
      "timeouts",
      "relation_limits",
      "manifest_hash",
    ],
    "maintenance manifest",
  );
  assertCondition(manifest.protocol_version === MANIFEST_PROTOCOL, "manifest protocol 漂移");
  assertCondition(manifest.migration_name === U6_MIGRATION_NAME, "manifest migration_name 漂移");
  assertStrictKeys(
    manifest.deployment_scope as unknown as Record<string, unknown>,
    ["app_id", "deployment_binding", "database_binding"],
    "deployment_scope",
  );
  assertCondition(manifest.deployment_scope.app_id === APP_ID, "manifest app_id 漂移");
  assertCondition(
    manifest.deployment_scope.deployment_binding === "SESSION_ACTIVE_MAPPING",
    "manifest deployment_binding 漂移",
  );
  assertCondition(
    manifest.deployment_scope.database_binding === "SESSION_DATABASE_IDENTITY",
    "manifest database_binding 漂移",
  );
  assertStrictKeys(
    manifest.maintenance_window as unknown as Record<string, unknown>,
    ["window_id", "max_duration_ms"],
    "maintenance_window",
  );
  assertCondition(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      manifest.maintenance_window.window_id,
    ),
    "manifest window_id 不是规范 UUID",
  );
  const range = (value: number, min: number, max: number, label: string) => {
    assertCondition(Number.isSafeInteger(value) && value >= min && value <= max, `${label} 越界`);
  };
  range(manifest.maintenance_window.max_duration_ms, 60_000, 7_200_000, "max_duration_ms");
  assertStrictKeys(
    manifest.timeouts as unknown as Record<string, unknown>,
    ["lock_timeout_ms", "statement_timeout_ms", "idle_in_transaction_session_timeout_ms"],
    "timeouts",
  );
  range(manifest.timeouts.lock_timeout_ms, 100, 5_000, "lock_timeout_ms");
  range(manifest.timeouts.statement_timeout_ms, 30_000, 1_800_000, "statement_timeout_ms");
  range(
    manifest.timeouts.idle_in_transaction_session_timeout_ms,
    30_000,
    300_000,
    "idle_in_transaction_session_timeout_ms",
  );
  const expectedRelations = [
    "app_data_agent.artifacts",
    "app_data_agent.memberships",
    "app_data_agent.outbox",
    "app_data_agent.run_attempts",
    "app_data_agent.runs",
    "platform.app_environment_lifecycle",
    "platform.deployment_mappings",
  ];
  assertCondition(
    Array.isArray(manifest.relation_limits) &&
      manifest.relation_limits.length === expectedRelations.length,
    "manifest relation_limits 必须精确包含七张表",
  );
  manifest.relation_limits.forEach((relation, index) => {
    assertStrictKeys(
      relation as unknown as Record<string, unknown>,
      ["qualified_name", "approved_max_rows", "approved_max_total_bytes"],
      `relation_limits[${index}]`,
    );
    assertCondition(
      relation.qualified_name === expectedRelations[index],
      "manifest relation_limits 必须按全限定名排序且闭合",
    );
    range(relation.approved_max_rows, 0, Number.MAX_SAFE_INTEGER, "approved_max_rows");
    range(
      relation.approved_max_total_bytes,
      0,
      Number.MAX_SAFE_INTEGER,
      "approved_max_total_bytes",
    );
  });
  assertCondition(
    new RegExp(`^${CHECKSUM_PATTERN}$`).test(manifest.manifest_hash),
    "manifest_hash 格式无效",
  );
  const withoutHash = { ...manifest } as Record<string, unknown>;
  delete withoutHash.manifest_hash;
  const expectedHash = sha256(`${MANIFEST_DOMAIN}${canonicalJson(withoutHash)}`);
  assertCondition(
    manifest.manifest_hash === expectedHash,
    `manifest_hash 不匹配：expected=${expectedHash}`,
  );
  return manifest;
}

function normalizeSegment(content: string): string {
  return `${content.replace(/\r\n?/g, "\n").replace(/\n+$/g, "")}\n`;
}

export function renderMigrationFromSegments(sourceDirectory: string): {
  content: string;
  checksum: string;
} {
  assertCondition(existsSync(sourceDirectory), `U6 source directory 不存在：${sourceDirectory}`);
  const actualSegments = readdirSync(sourceDirectory)
    .filter((entry) => entry.endsWith(".sql.inc"))
    .sort();
  assertCondition(
    JSON.stringify(actualSegments) === JSON.stringify([...U6_SOURCE_SEGMENTS].sort()),
    `U6 source segment 闭集不匹配：actual=${actualSegments.join(",")}`,
  );
  const body = U6_SOURCE_SEGMENTS.map((segment) =>
    normalizeSegment(readFileSync(resolve(sourceDirectory, segment), "utf8")),
  ).join("");
  const placeholderCount = body.split(U6_CHECKSUM_PLACEHOLDER).length - 1;
  assertCondition(
    placeholderCount === 1,
    `U6 ledger checksum placeholder 必须且只能出现一次：found=${placeholderCount}`,
  );
  assertCondition(
    new RegExp(`'${U6_MIGRATION_VERSION}'\\s*,\\s*'${U6_CHECKSUM_PLACEHOLDER}'`).test(body),
    "U6 checksum placeholder 必须是最终 migration ledger 参数",
  );
  const normalized = `-- u6_migration_checksum: ${U6_ZERO_CHECKSUM}\n${body.replace(
    U6_CHECKSUM_PLACEHOLDER,
    U6_ZERO_CHECKSUM,
  )}`;
  const checksum = sha256(normalized);
  return {
    content: normalized
      .replace(
        `-- u6_migration_checksum: ${U6_ZERO_CHECKSUM}`,
        `-- u6_migration_checksum: ${checksum}`,
      )
      .replace(
        new RegExp(
          `('${U6_MIGRATION_VERSION}'\\s*,\\s*')${U6_ZERO_CHECKSUM.replace(":", "\\:")}(')`,
        ),
        `$1${checksum}$2`,
      ),
    checksum,
  };
}

function splitArguments(argumentsSql: string): string[] {
  const values: string[] = [];
  let current = "";
  let depth = 0;
  let quoted = false;
  for (const character of argumentsSql) {
    if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === "(") {
      depth += 1;
    } else if (!quoted && character === ")") {
      depth -= 1;
    }
    if (!quoted && depth === 0 && character === ",") {
      values.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim() !== "") {
    values.push(current);
  }
  return values;
}

function argumentType(argumentSql: string): string {
  const withoutDefault = argumentSql
    .replace(/\s+default\s+[\s\S]*$/i, "")
    .replace(/\s*=\s*[\s\S]*$/i, "")
    .trim()
    .replace(/^(?:in|inout|variadic)\s+/i, "");
  const tokens = withoutDefault.split(/\s+/);
  assertCondition(tokens.length > 0 && tokens[0] !== "", `无法解析函数参数：${argumentSql}`);
  const typeTokens = tokens.length === 1 ? tokens : tokens.slice(1);
  return typeTokens.join(" ").replace(/\s+/g, " ").toLowerCase();
}

function signature(name: string, argumentsSql: string): string {
  const types = splitArguments(argumentsSql).map(argumentType);
  return `${name.toLowerCase()}(${types.join(",")})`;
}

function expectedExposure(schema: string, functionSignature: string): Exposure | undefined {
  if (schema === "platform") {
    return PLATFORM_HELPER_FUNCTIONS.includes(functionSignature as never)
      ? "PLATFORM_HELPER"
      : undefined;
  }
  if (PUBLIC_MUTATION_FUNCTIONS.includes(functionSignature as never)) {
    return "PUBLIC_MUTATION";
  }
  if (PUBLIC_RESOLVER_FUNCTIONS.includes(functionSignature as never)) {
    return "PUBLIC_RESOLVER";
  }
  if (DEPLOYMENT_FUNCTIONS.includes(functionSignature as never)) {
    return "DEPLOYMENT";
  }
  if (JOB_CLEANUP_FUNCTIONS.includes(functionSignature as never)) {
    return "JOB_CLEANUP";
  }
  if (INTERNAL_FUNCTIONS.some((item) => item.signature === functionSignature)) {
    return "INTERNAL";
  }
  return undefined;
}

function expectedOwner(exposure: Exposure): string {
  switch (exposure) {
    case "PLATFORM_HELPER":
      return "data_agent_u6_platform_lock_owner";
    case "DEPLOYMENT":
      return "data_agent_u6_provisioner_owner";
    case "JOB_CLEANUP":
      return "data_agent_u6_cleanup_owner";
    case "PUBLIC_MUTATION":
    case "PUBLIC_RESOLVER":
    case "INTERNAL":
      return "data_agent_u6_rpc_owner";
  }
}

export function parseInventoryFunctions(migration: string): InventoryFunction[] {
  const ownerBySignature = new Map<string, string>();
  const alterPattern =
    /alter\s+function\s+(app_data_agent|platform)\.([a-z][a-z0-9_]*)\s*\(([\s\S]*?)\)\s+owner\s+to\s+([a-z][a-z0-9_]*)\s*;/gi;
  for (const match of migration.matchAll(alterPattern)) {
    const key = `${match[1]?.toLowerCase()}.${signature(match[2] ?? "", match[3] ?? "")}`;
    assertCondition(!ownerBySignature.has(key), `函数 owner 重复声明：${key}`);
    ownerBySignature.set(key, match[4] ?? "");
  }

  const parsed: InventoryFunction[] = [];
  const seen = new Set<string>();
  const triggerNames = new Set<string>();
  const createPattern =
    /create\s+(?:or\s+replace\s+)?function\s+(app_data_agent|platform)\.([a-z][a-z0-9_]*)\s*\(([\s\S]*?)\)\s*returns\s+([\s\S]*?)\bas\s+\$[a-z0-9_]*\$/gi;
  for (const match of migration.matchAll(createPattern)) {
    const schema = match[1]?.toLowerCase() as "app_data_agent" | "platform";
    const name = match[2]?.toLowerCase() ?? "";
    const functionSignature = signature(name, match[3] ?? "");
    const attributes = match[4] ?? "";
    if (/^\s*trigger\b/i.test(attributes)) {
      triggerNames.add(`${schema}.${functionSignature}`);
      continue;
    }
    const exposure = expectedExposure(schema, functionSignature);
    assertCondition(exposure, `10590 出现未登记的非 trigger 函数：${schema}.${functionSignature}`);
    const key = `${schema}.${functionSignature}`;
    assertCondition(!seen.has(key), `U6 函数重复定义：${key}`);
    seen.add(key);
    const languageMatch = attributes.match(/\blanguage\s+(sql|plpgsql)\b/i);
    assertCondition(languageMatch, `U6 函数缺少受支持 language：${key}`);
    const language = languageMatch[1]?.toLowerCase() as FunctionLanguage;
    const volatility: FunctionVolatility = /\bimmutable\b/i.test(attributes)
      ? "IMMUTABLE"
      : /\bstable\b/i.test(attributes)
        ? "STABLE"
        : "VOLATILE";
    const nullInput: FunctionNullInput = /\bstrict\b|\breturns\s+null\s+on\s+null\s+input\b/i.test(
      attributes,
    )
      ? "STRICT"
      : "CALLED_ON_NULL_INPUT";
    const securityDefiner = /\bsecurity\s+definer\b/i.test(attributes);
    if (exposure !== "INTERNAL") {
      assertCondition(securityDefiner, `U6 exposed/helper 函数必须 SECURITY DEFINER：${key}`);
    }
    assertCondition(
      /\bset\s+search_path\s*=\s*''/i.test(attributes),
      `U6 函数必须使用空 search_path：${key}`,
    );
    const owner = ownerBySignature.get(key);
    assertCondition(owner, `U6 函数缺少显式 owner：${key}`);
    assertCondition(
      owner === expectedOwner(exposure),
      `U6 函数 owner 漂移：${key} actual=${owner}`,
    );
    parsed.push({
      schema,
      signature: functionSignature,
      exposure,
      owner,
      language,
      volatility,
      null_input: nullInput,
      security_definer: securityDefiner,
      search_path: "",
      backend_execute_enabled:
        schema === "app_data_agent" &&
        U6_BACKEND_EXECUTE_ENABLED_FUNCTIONS.includes(functionSignature as never),
    });
  }

  const ownerKeys = [...ownerBySignature.keys()].sort();
  const createdKeys = [...seen].sort();
  assertCondition(
    JSON.stringify(ownerKeys) === JSON.stringify(createdKeys),
    `U6 ALTER FUNCTION OWNER 闭集漂移：owner=${ownerKeys.join(",")} created=${createdKeys.join(",")}`,
  );

  const expectedExact = [
    ...PUBLIC_MUTATION_FUNCTIONS.map((item) => `app_data_agent.${item}`),
    ...PUBLIC_RESOLVER_FUNCTIONS.map((item) => `app_data_agent.${item}`),
    ...DEPLOYMENT_FUNCTIONS.map((item) => `app_data_agent.${item}`),
    ...JOB_CLEANUP_FUNCTIONS.map((item) => `app_data_agent.${item}`),
    ...PLATFORM_HELPER_FUNCTIONS.map((item) => `platform.${item}`),
  ].sort();
  const actualExact = parsed
    .filter((item) => item.exposure !== "INTERNAL")
    .map((item) => `${item.schema}.${item.signature}`)
    .sort();
  assertCondition(
    JSON.stringify(actualExact) === JSON.stringify(expectedExact),
    `U6 exact function allowlist 漂移：actual=${actualExact.join(",")}`,
  );
  const actualInternal = parsed
    .filter((item) => item.exposure === "INTERNAL")
    .map((item) => ({
      signature: item.signature,
      owner: item.owner,
      language: item.language,
      volatility: item.volatility,
      null_input: item.null_input,
      security_definer: item.security_definer,
      search_path: item.search_path,
    }))
    .sort((left, right) => left.signature.localeCompare(right.signature));
  const expectedInternal = [...INTERNAL_FUNCTIONS].sort((left, right) =>
    left.signature.localeCompare(right.signature),
  );
  assertCondition(
    JSON.stringify(actualInternal) === JSON.stringify(expectedInternal),
    `U6 internal function exact manifest 漂移：actual=${JSON.stringify(actualInternal)}`,
  );
  for (const triggerName of triggerNames) {
    const escaped = triggerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assertCondition(
      !new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${escaped}`, "i").test(migration),
      `Trigger function 不得获得 EXECUTE grant：${triggerName}`,
    );
  }
  return parsed.sort((left, right) => {
    const leftKey = `${left.schema}.${left.signature}`;
    const rightKey = `${right.schema}.${right.signature}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function buildRelationInventory(): RelationInventory[] {
  const relations = new Map<string, RelationInventory>();
  for (const qualifiedName of CORE_RELATIONS) {
    relations.set(qualifiedName, {
      qualified_name: qualifiedName,
      cleanup_owner: "CORE_DATABASE",
      scope_columns: ["app_id", "tenant_id", "environment"],
      identity_order: "PRIMARY_KEY_ASC",
      cleanup_phases: [],
    });
  }
  for (const qualifiedName of PLATFORM_RELATIONS) {
    relations.set(qualifiedName, {
      qualified_name: qualifiedName,
      cleanup_owner: "PLATFORM_CONTROL",
      scope_columns: ["app_id", "environment"],
      identity_order: "PRIMARY_KEY_ASC",
      cleanup_phases: [],
    });
  }
  for (const phase of PHASES) {
    for (const relationName of phase.relations) {
      const qualifiedName = `app_data_agent.${relationName}`;
      const existing = relations.get(qualifiedName);
      const cleanupPhase = {
        cleanup_rank: phase.rank,
        cleanup_group: phase.group,
        static_predicate_id: phase.predicate,
        identity_order: phase.order,
      };
      if (existing) {
        assertCondition(
          existing.cleanup_owner === "U6_JOB",
          `非 U6_JOB relation 不得有 cleanup phase：${qualifiedName}`,
        );
        existing.cleanup_phases.push(cleanupPhase);
      } else {
        relations.set(qualifiedName, {
          qualified_name: qualifiedName,
          cleanup_owner: "U6_JOB",
          scope_columns: ["app_id", "tenant_id", "environment"],
          identity_order: phase.order,
          cleanup_phases: [cleanupPhase],
        });
      }
    }
  }
  for (const qualifiedName of RETAINED_RELATIONS) {
    assertCondition(
      !relations.has(qualifiedName),
      `retained relation 误入 U6_JOB：${qualifiedName}`,
    );
    relations.set(qualifiedName, {
      qualified_name: qualifiedName,
      cleanup_owner: "RETAINED_CONTROL",
      scope_columns: ["app_id", "environment"],
      identity_order: "PRIMARY_KEY_ASC",
      cleanup_phases: [],
    });
  }
  const inventory = [...relations.values()].sort((left, right) =>
    left.qualified_name < right.qualified_name
      ? -1
      : left.qualified_name > right.qualified_name
        ? 1
        : 0,
  );
  assertCondition(
    inventory.filter((item) => item.cleanup_owner === "U6_JOB").length === 41,
    "U6_JOB relation 必须精确为 41 张",
  );
  assertCondition(
    inventory.filter((item) => item.cleanup_owner === "RETAINED_CONTROL").length === 2,
    "RETAINED_CONTROL relation 必须精确为 2 张",
  );
  return inventory;
}

export function buildSchemaInventory(migration: string, checksum: string): unknown {
  return {
    protocol_version: "u6-schema-inventory@1.0.0",
    migration: {
      name: U6_MIGRATION_NAME,
      sha256: checksum,
      source_segments: [...U6_SOURCE_SEGMENTS],
    },
    runtime: {
      postgres_major: 17,
      pgcrypto_schema: "extensions",
      migration_arm_safety_ms: 5_000,
      migration_min_effective_budget_ms: 30_000,
    },
    relations: buildRelationInventory(),
    functions: parseInventoryFunctions(migration),
  };
}

function checksumOccurrences(migration: string): {
  marker: string;
  ledger: string;
  normalized: string;
} {
  const markerMatches = [
    ...migration.matchAll(new RegExp(`^-- u6_migration_checksum: (${CHECKSUM_PATTERN})$`, "gm")),
  ];
  assertCondition(markerMatches.length === 1, "10590 必须且只能有一个 checksum marker");
  const ledgerPattern = new RegExp(
    `('${U6_MIGRATION_VERSION}'\\s*,\\s*')(${CHECKSUM_PATTERN})(')`,
    "g",
  );
  const ledgerMatches = [...migration.matchAll(ledgerPattern)];
  assertCondition(ledgerMatches.length === 1, "10590 必须且只能登记一次对应 ledger checksum");
  const marker = markerMatches[0]?.[1] ?? "";
  const ledger = ledgerMatches[0]?.[2] ?? "";
  assertCondition(marker === ledger, "10590 marker 与 ledger checksum 不一致");
  const normalized = migration
    .replace(
      new RegExp(`^-- u6_migration_checksum: ${CHECKSUM_PATTERN}$`, "m"),
      `-- u6_migration_checksum: ${U6_ZERO_CHECKSUM}`,
    )
    .replace(ledgerPattern, `$1${U6_ZERO_CHECKSUM}$3`);
  return { marker, ledger, normalized };
}

export function verifyGeneratedArtifacts(paths: U6RendererPaths): void {
  validateMaintenanceManifest(JSON.parse(readFileSync(paths.maintenanceManifestPath, "utf8")));
  const rendered = renderMigrationFromSegments(paths.sourceDirectory);
  const migration = readFileSync(paths.migrationPath, "utf8");
  assertCondition(migration === rendered.content, "10590 与固定 source segments 渲染结果不一致");
  const occurrences = checksumOccurrences(migration);
  assertCondition(
    occurrences.marker === sha256(occurrences.normalized),
    "10590 自校验 checksum 不匹配",
  );
  const inventory = JSON.parse(readFileSync(paths.inventoryPath, "utf8")) as {
    migration?: { sha256?: string };
  };
  assertCondition(
    inventory.migration?.sha256 === occurrences.marker,
    "Schema Inventory 与 10590 checksum 不一致",
  );
  const expectedInventory = buildSchemaInventory(migration, occurrences.marker);
  assertCondition(
    canonicalJson(inventory) === canonicalJson(expectedInventory),
    "Schema Inventory 与 renderer 投影不一致",
  );
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

export function renderU6Migration(paths: U6RendererPaths): void {
  validateMaintenanceManifest(JSON.parse(readFileSync(paths.maintenanceManifestPath, "utf8")));
  const rendered = renderMigrationFromSegments(paths.sourceDirectory);
  const inventory = buildSchemaInventory(rendered.content, rendered.checksum);
  const inventoryContent = `${JSON.stringify(inventory, null, 2)}\n`;
  const occurrences = checksumOccurrences(rendered.content);
  assertCondition(
    occurrences.marker === rendered.checksum &&
      sha256(occurrences.normalized) === rendered.checksum,
    "renderer 生成了无效的 U6 checksum",
  );
  atomicWrite(paths.migrationPath, rendered.content);
  atomicWrite(paths.inventoryPath, inventoryContent);
  verifyGeneratedArtifacts(paths);
}

export function defaultRendererPaths(repositoryRoot: string): U6RendererPaths {
  const appInfraRoot = resolve(repositoryRoot, "infra/supabase/apps/data-agent");
  return {
    sourceDirectory: resolve(appInfraRoot, "migration-sources/10590"),
    migrationPath: resolve(appInfraRoot, "migrations", U6_MIGRATION_NAME),
    inventoryPath: resolve(appInfraRoot, "u6-schema-inventory.json"),
    maintenanceManifestPath: resolve(appInfraRoot, "u6-migration-maintenance-manifest.json"),
  };
}

function isMainModule(): boolean {
  return (
    process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isMainModule()) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const paths = defaultRendererPaths(repositoryRoot);
  const snapshotFlagIndex = process.argv.indexOf("--verify-migration-snapshot");
  if (snapshotFlagIndex >= 0) {
    const snapshotPath = process.argv[snapshotFlagIndex + 1];
    assertCondition(
      snapshotPath !== undefined && snapshotPath.length > 0,
      "--verify-migration-snapshot 必须提供 migration snapshot 路径",
    );
    verifyGeneratedArtifacts({
      ...paths,
      migrationPath: resolve(snapshotPath),
    });
    console.log(`U6 migration snapshot verified: ${basename(snapshotPath)}`);
  } else if (process.argv.includes("--verify")) {
    verifyGeneratedArtifacts(paths);
    console.log(`U6 migration artifacts verified: ${basename(paths.migrationPath)}`);
  } else {
    renderU6Migration(paths);
    console.log(`U6 migration artifacts rendered: ${basename(paths.migrationPath)}`);
  }
}
