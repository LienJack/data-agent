import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultRendererPaths,
  U6_MIGRATION_NAME,
  U6_SOURCE_SEGMENTS,
  type U6RendererPaths,
  verifyGeneratedArtifacts,
} from "./render-u6-migration.js";
import {
  type DeepReadonly,
  deriveU6C2InventoryReplacementAllowlist,
  deriveU6C2InventorySurfaceDelta,
  U6_C2_FROZEN_PHYSICAL_SCHEMA_HASH,
  U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR,
  type U6C2InventorySurfaceDelta,
  type U6C2InventorySurfaceEntry,
  type U6C2InventorySurfaceKind,
  validateU6C2PhysicalSchemaDescriptor,
} from "./u6-c2-physical-schema.js";

export type {
  DeepReadonly,
  U6C2InventorySurfaceDelta,
  U6C2InventorySurfaceEntry,
  U6C2InventorySurfaceKind,
} from "./u6-c2-physical-schema.js";

export const U6_C1_FROZEN_MIGRATION_CHECKSUM =
  "sha256:091534f8dae4132700564920f4e3e7316f6f411aff92efb108aa49d6ce255678";
export const U6_C1_FROZEN_MANIFEST_HASH =
  "sha256:70b5acaf260521a4b8d8581ca2f33dcebbeb6cd826315d3c246cfa80b35f0723";
export const U6_C1_FROZEN_INVENTORY_HASH =
  "sha256:a400586a8bae3b5bc843cda0355b404c444b6a976f56ab7eca0dd05e1f34593e";
export const U6_C2_MIGRATION_NAME = "20260725010600_app_data_agent_u6_research_derivation.sql";
export const U6_C2_MIGRATION_VERSION = "20260725010600_app_data_agent_u6_research_derivation";
export const U6_C2_CHECKSUM_PLACEHOLDER = "__U6_C2_MIGRATION_CHECKSUM__";
export const U6_C2_ZERO_CHECKSUM = `sha256:${"0".repeat(64)}`;
export const U6_C2_FROZEN_MANIFEST_HASH =
  "sha256:d28f8ac324e5453961c2636a7741c1feb36709908f84c7f03f9b9454ed87cced";

export const U6_C2_SOURCE_SEGMENTS = [
  "00-preamble.sql.inc",
  "10-existing-relation-preflight-alterations.sql.inc",
  "20-budget-policy-events.sql.inc",
  "30-derivation-receipts.sql.inc",
  "40-input-event-watermark.sql.inc",
  "50-terminal-receipt-links.sql.inc",
  "60-cross-fks-indexes-triggers.sql.inc",
  "70-internal-functions.sql.inc",
  "71-run-locked-artifact-rpcs.sql.inc",
  "72-budget-resource-guard-rpcs.sql.inc",
  "73-stop-root-rpcs.sql.inc",
  "74-resolvers-provisioner.sql.inc",
  "80-lifecycle-cleanup.sql.inc",
  "90-rls-owner-grants.sql.inc",
  "99-postconditions-ledger-commit.sql.inc",
] as const;

export const U6_C2_EXISTING_RELATIONS = [
  "app_data_agent.artifacts",
  "app_data_agent.memberships",
  "app_data_agent.outbox",
  "app_data_agent.research_artifact_commit_operations",
  "app_data_agent.research_authority_capabilities",
  "app_data_agent.research_domain_terminals",
  "app_data_agent.research_resource_reservations",
  "app_data_agent.research_resource_run_heads",
  "app_data_agent.research_stop_terminal_commits",
  "app_data_agent.run_attempts",
  "app_data_agent.runs",
] as const;

const APP_ID = "00000000-0000-4000-8000-00000000da01";
const C2_MANIFEST_PROTOCOL = "u6-c2-migration-maintenance@1.0.0";
const C2_CANDIDATE_INVENTORY_PROTOCOL = "u6-schema-inventory-candidate@2.0.0";
const BASELINE_INVENTORY_PROTOCOL = "u6-schema-inventory@1.0.0";
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type JsonPrimitive = null | boolean | number | string;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonRecord = { [key: string]: JsonValue };

export type U6C2MaintenanceManifest = {
  protocol_version: typeof C2_MANIFEST_PROTOCOL;
  migration_name: typeof U6_C2_MIGRATION_NAME;
  deployment_scope: {
    app_id: typeof APP_ID;
    deployment_binding: "SESSION_ACTIVE_MAPPING";
    database_binding: "SESSION_DATABASE_IDENTITY";
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
    qualified_name: (typeof U6_C2_EXISTING_RELATIONS)[number];
    approved_max_rows: number;
    approved_max_total_bytes: number;
  }>;
  manifest_hash: `sha256:${string}`;
};

export type U6C2CandidatePaths = {
  c1: U6RendererPaths;
  c2MaintenanceManifestPath: string;
  c2SourceDirectory: string;
  c2MigrationPath: string;
};

type BaselineInventory = {
  protocol_version: typeof BASELINE_INVENTORY_PROTOCOL;
  migration: {
    name: typeof U6_MIGRATION_NAME;
    sha256: typeof U6_C1_FROZEN_MIGRATION_CHECKSUM;
    source_segments: string[];
  };
  runtime: JsonRecord;
  relations: JsonRecord[];
  functions: JsonRecord[];
};

type MigrationProjection = {
  name: string;
  sha256: `sha256:${string}`;
  source_segments: string[];
};

export type U6C2CandidateInventory = DeepReadonly<{
  protocol_version: typeof C2_CANDIDATE_INVENTORY_PROTOCOL;
  target_protocol_version: typeof U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR.target_inventory_protocol;
  installable: false;
  baseline_inventory_hash: `sha256:${string}`;
  physical_descriptor_hash: typeof U6_C2_FROZEN_PHYSICAL_SCHEMA_HASH;
  migrations: [MigrationProjection, MigrationProjection];
  runtime: JsonRecord;
  baseline_surface: {
    relations: JsonRecord[];
    functions: JsonRecord[];
  };
  surface_delta: U6C2InventorySurfaceDelta;
}>;

/**
 * Candidate replacements can only be derived from the reviewed frozen
 * physical-schema descriptor. Producing the installable live Inventory still
 * belongs to the final C2a migration task.
 */
export const U6_C2_INVENTORY_REPLACEMENT_ALLOWLIST = deepFreeze(
  deriveU6C2InventoryReplacementAllowlist(),
);

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

function assertJsonValue(value: unknown, label: string): asserts value is JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isSafeInteger(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertJsonValue(item, `${label}[${index}]`);
    });
    return;
  }
  assertCondition(isPlainRecord(value), `${label} 必须是安全 JSON 值`);
  for (const [key, item] of Object.entries(value)) {
    assertJsonValue(item, `${label}.${key}`);
  }
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue)}`)
    .join(",")}}`;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value as DeepReadonly<T>;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value) as DeepReadonly<T>;
}

function compareUtf8Bytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function validateFrozenU6C2PhysicalSchemaDescriptor(): void {
  validateU6C2PhysicalSchemaDescriptor(U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR, {
    baseline_migration_name: U6_MIGRATION_NAME,
    baseline_migration_sha256: U6_C1_FROZEN_MIGRATION_CHECKSUM,
    baseline_inventory_hash: U6_C1_FROZEN_INVENTORY_HASH,
    c2_migration_name: U6_C2_MIGRATION_NAME,
    c2_source_segments: U6_C2_SOURCE_SEGMENTS,
    existing_relations: U6_C2_EXISTING_RELATIONS,
  });
}

function assertSafeIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): asserts value is number {
  assertCondition(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= minimum &&
      value <= maximum,
    `${label} 越界或不是 SafeInteger`,
  );
}

function normalizeSegment(content: string): string {
  return `${content.replace(/\r\n?/g, "\n").replace(/\n+$/g, "")}\n`;
}

function finalLedgerBlock(checksum: string): string {
  return [
    "select platform.assert_migration_checksum(",
    "  'app',",
    `  '${APP_ID}'::uuid,`,
    `  '${U6_C2_MIGRATION_VERSION}',`,
    `  '${checksum}'`,
    ");",
    "",
    "commit;",
    "",
  ].join("\n");
}

type SqlCodeToken = {
  value: string;
  start: number;
  nestedExecutableBody: boolean;
};

function executableSqlTokens(
  sql: string,
  label: string,
  baseOffset = 0,
  nestedExecutableBody = false,
): SqlCodeToken[] {
  const tokens: SqlCodeToken[] = [];
  let state: "CODE" | "LINE_COMMENT" | "BLOCK_COMMENT" | "SINGLE" | "DOUBLE" = "CODE";
  let blockDepth = 0;
  let singleBackslashEscapes = false;
  let doubleIdentifier = "";
  let doubleIdentifierStart = -1;
  let index = 0;
  while (index < sql.length) {
    const current = sql[index] ?? "";
    const next = sql[index + 1] ?? "";
    if (state === "CODE") {
      assertCondition(
        current !== "\\",
        `${label} 禁止 psql meta-command 绕过静态 SQL 与单事务校验`,
      );
      if (current === "-" && next === "-") {
        state = "LINE_COMMENT";
        index += 2;
        continue;
      }
      if (current === "/" && next === "*") {
        state = "BLOCK_COMMENT";
        blockDepth = 1;
        index += 2;
        continue;
      }
      if (current === "'") {
        const statementStart = tokens.findLastIndex((token) => token.value === ";") + 1;
        const statementValues = tokens.slice(statementStart).map((token) => token.value);
        const isDoBody = statementValues[0] === "do";
        const lastAsIndex = statementValues.lastIndexOf("as");
        const isFunctionBody =
          lastAsIndex >= 0 &&
          statementValues.includes("create") &&
          (statementValues.includes("function") || statementValues.includes("procedure")) &&
          statementValues
            .slice(lastAsIndex + 1)
            .every((token) => token === "e" || token === "u" || token === "&");
        assertCondition(
          !isDoBody && !isFunctionBody,
          `${label} 可执行 DO/function body 必须使用可递归校验的 dollar quote`,
        );
        const previous = sql[index - 1] ?? "";
        const beforePrevious = sql[index - 2] ?? "";
        singleBackslashEscapes =
          (previous === "e" || previous === "E") && !/[A-Za-z0-9_$]/.test(beforePrevious);
        state = "SINGLE";
        index += 1;
        continue;
      }
      if ((current === "u" || current === "U") && next === "&" && sql[index + 2] === '"') {
        assertCondition(false, `${label} 在物理描述符冻结前禁止 Unicode escaped identifier`);
      }
      if (current === '"') {
        doubleIdentifier = "";
        doubleIdentifierStart = index;
        state = "DOUBLE";
        index += 1;
        continue;
      }
      if (current === "$") {
        const match = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
        if (match?.[0]) {
          const dollarTag = match[0];
          const bodyStart = index + dollarTag.length;
          const bodyEnd = sql.indexOf(dollarTag, bodyStart);
          assertCondition(bodyEnd >= 0, `${label} 存在未闭合 dollar-quoted body`);
          const statementStart = tokens.findLastIndex((token) => token.value === ";") + 1;
          const statementTokens = tokens.slice(statementStart);
          const statementValues = statementTokens.map((token) => token.value);
          const isDoBody = statementValues[0] === "do";
          const isFunctionBody =
            statementValues.at(-1) === "as" &&
            statementValues.includes("create") &&
            (statementValues.includes("function") || statementValues.includes("procedure"));
          if (isDoBody || isFunctionBody) {
            tokens.push(
              ...executableSqlTokens(
                sql.slice(bodyStart, bodyEnd),
                label,
                baseOffset + bodyStart,
                true,
              ),
            );
          }
          index = bodyEnd + dollarTag.length;
          continue;
        }
      }
      if (/[A-Za-z_]/.test(current)) {
        let end = index + 1;
        while (end < sql.length && /[A-Za-z0-9_$]/.test(sql[end] ?? "")) {
          end += 1;
        }
        tokens.push({
          value: sql.slice(index, end).toLowerCase(),
          start: baseOffset + index,
          nestedExecutableBody,
        });
        index = end;
        continue;
      }
      if (!/\s/.test(current)) {
        tokens.push({
          value: current,
          start: baseOffset + index,
          nestedExecutableBody,
        });
      }
      index += 1;
      continue;
    }
    if (state === "LINE_COMMENT") {
      if (current === "\n") {
        state = "CODE";
      }
      index += 1;
      continue;
    }
    if (state === "BLOCK_COMMENT") {
      if (current === "/" && next === "*") {
        blockDepth += 1;
        index += 2;
        continue;
      }
      if (current === "*" && next === "/") {
        blockDepth -= 1;
        state = blockDepth === 0 ? "CODE" : "BLOCK_COMMENT";
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (state === "SINGLE") {
      if (singleBackslashEscapes && current === "\\") {
        index += 2;
        continue;
      }
      if (current === "'" && next === "'") {
        index += 2;
        continue;
      }
      if (current === "'") {
        state = "CODE";
      }
      index += 1;
      continue;
    }
    if (state === "DOUBLE") {
      if (current === '"' && next === '"') {
        doubleIdentifier += '"';
        index += 2;
        continue;
      }
      if (current === '"') {
        tokens.push({
          value: doubleIdentifier,
          start: baseOffset + doubleIdentifierStart,
          nestedExecutableBody,
        });
        state = "CODE";
        index += 1;
        continue;
      }
      doubleIdentifier += current;
      index += 1;
    }
  }
  assertCondition(
    state === "CODE" || state === "LINE_COMMENT",
    `${label} ledger 必须位于可执行 SQL code 边界`,
  );
  return tokens;
}

function assertSingleTopLevelTransaction(tokens: readonly SqlCodeToken[], label: string): void {
  const statements: SqlCodeToken[][] = [];
  let currentStatement: SqlCodeToken[] = [];
  for (const token of tokens) {
    if (token.nestedExecutableBody) {
      continue;
    }
    if (token.value === ";") {
      if (currentStatement.length > 0) {
        statements.push(currentStatement);
        currentStatement = [];
      }
      continue;
    }
    currentStatement.push(token);
  }
  assertCondition(currentStatement.length === 0, `${label} 顶层 SQL 语句必须以分号结束`);
  const statementValues = statements.map((statement) => statement.map((token) => token.value));
  assertCondition(
    JSON.stringify(statementValues[0]) === JSON.stringify(["begin"]),
    `${label} 必须以唯一顶层 BEGIN; 开始`,
  );
  assertCondition(
    JSON.stringify(statementValues.at(-1)) === JSON.stringify(["commit"]),
    `${label} 必须以唯一顶层 COMMIT; 结束`,
  );
  for (const [statementIndex, values] of statementValues.entries()) {
    const lead = values[0];
    const isTransactionControl =
      lead === "begin" ||
      (lead === "start" && values[1] === "transaction") ||
      lead === "commit" ||
      lead === "end" ||
      lead === "rollback" ||
      lead === "abort" ||
      lead === "savepoint" ||
      lead === "release" ||
      (lead === "prepare" && values[1] === "transaction");
    if (!isTransactionControl) {
      continue;
    }
    const isFrozenBegin =
      statementIndex === 0 && JSON.stringify(values) === JSON.stringify(["begin"]);
    const isFrozenCommit =
      statementIndex === statementValues.length - 1 &&
      JSON.stringify(values) === JSON.stringify(["commit"]);
    assertCondition(
      isFrozenBegin || isFrozenCommit,
      `${label} 只允许首条 BEGIN; 与最终 ledger 后的 COMMIT;，禁止其他顶层事务控制`,
    );
  }
}

function assertExecutableFinalLedger(
  sql: string,
  checksum: string,
  label: string,
  requireSingleTopLevelTransaction = false,
): void {
  const ledgerBlock = finalLedgerBlock(checksum);
  assertCondition(sql.endsWith(ledgerBlock), `${label} 必须以冻结 ledger 调用和独立 COMMIT 结束`);
  const ledgerOffset = sql.length - ledgerBlock.length;
  assertCondition(
    ledgerOffset === 0 || sql[ledgerOffset - 1] === "\n",
    `${label} ledger 必须从独立行开始`,
  );
  const tokens = executableSqlTokens(sql, label);
  if (requireSingleTopLevelTransaction) {
    assertSingleTopLevelTransaction(tokens, label);
  }
  const ledgerSelectIndex = tokens.findIndex(
    (token) => token.start === ledgerOffset && token.value === "select",
  );
  assertCondition(ledgerSelectIndex >= 0, `${label} ledger SELECT 必须是可执行顶层 token`);
  const precedingToken = tokens[ledgerSelectIndex - 1];
  assertCondition(
    precedingToken === undefined || precedingToken.value === ";",
    `${label} ledger SELECT 必须是独立顶层语句`,
  );
  // Candidate authoring remains closed to dynamic SQL until the physical
  // descriptor freezes an exact statement-level allowlist. Top-level ACL
  // GRANT/REVOKE and static CREATE TRIGGER ... EXECUTE FUNCTION/PROCEDURE
  // use the same EXECUTE token but are not dynamic SQL.
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex];
    if (token?.value !== "execute" || token.start >= ledgerOffset) {
      continue;
    }
    let statementStart = tokenIndex;
    while (
      statementStart > 0 &&
      tokens[statementStart - 1]?.value !== ";" &&
      tokens[statementStart - 1]?.nestedExecutableBody === token.nestedExecutableBody
    ) {
      statementStart -= 1;
    }
    const statementLead = tokens[statementStart]?.value;
    const isTopLevelAcl =
      !token.nestedExecutableBody && (statementLead === "grant" || statementLead === "revoke");
    const statementValues = tokens
      .slice(statementStart, tokenIndex + 2)
      .map((statementToken) => statementToken.value);
    const isTopLevelTrigger =
      !token.nestedExecutableBody &&
      statementLead === "create" &&
      statementValues.includes("trigger") &&
      (tokens[tokenIndex + 1]?.value === "function" ||
        tokens[tokenIndex + 1]?.value === "procedure");
    assertCondition(
      isTopLevelAcl || isTopLevelTrigger,
      `${label} 未冻结的动态 SQL EXECUTE 可能绕过 migration ledger 闭集`,
    );
  }
  let ledgerCallCount = 0;
  for (let tokenIndex = 0; tokenIndex <= tokens.length - 2; tokenIndex += 1) {
    if (
      tokens[tokenIndex]?.value === "assert_migration_checksum" &&
      tokens[tokenIndex + 1]?.value === "("
    ) {
      ledgerCallCount += 1;
    }
  }
  assertCondition(ledgerCallCount === 1, `${label} 必须且只能调用一次 migration ledger`);
}

function checksumOccurrences(migration: string): {
  marker: string;
  ledger: string;
  normalized: string;
} {
  const markerMatches = [
    ...migration.matchAll(/^-- u6_c2_migration_checksum: (sha256:[0-9a-f]{64})$/gm),
  ];
  assertCondition(markerMatches.length === 1, "10600 必须且只能有一个 checksum marker");
  const marker = markerMatches[0]?.[1] ?? "";
  assertExecutableFinalLedger(migration, marker, "10600", true);
  const markerNormalized = migration.replace(
    /^-- u6_c2_migration_checksum: sha256:[0-9a-f]{64}$/m,
    `-- u6_c2_migration_checksum: ${U6_C2_ZERO_CHECKSUM}`,
  );
  const ledgerBlock = finalLedgerBlock(marker);
  const normalized = `${markerNormalized.slice(0, -ledgerBlock.length)}${finalLedgerBlock(
    U6_C2_ZERO_CHECKSUM,
  )}`;
  return { marker, ledger: marker, normalized };
}

export function renderU6C2MigrationCandidateFromSegments(sourceDirectory: string): {
  content: string;
  checksum: `sha256:${string}`;
} {
  assertCondition(existsSync(sourceDirectory), `U6 C2 source directory 不存在：${sourceDirectory}`);
  const actualSegments = readdirSync(sourceDirectory)
    .filter((entry) => entry.endsWith(".sql.inc"))
    .sort(compareUtf8Bytes);
  const expectedClosedSet = [...U6_C2_SOURCE_SEGMENTS].sort(compareUtf8Bytes);
  assertCondition(
    JSON.stringify(actualSegments) === JSON.stringify(expectedClosedSet),
    `U6 C2 source segment 闭集不匹配：actual=${actualSegments.join(",")}`,
  );
  const normalizedSegments = U6_C2_SOURCE_SEGMENTS.map((segment) =>
    normalizeSegment(readFileSync(resolve(sourceDirectory, segment), "utf8")),
  );
  const body = normalizedSegments.join("");
  const placeholderCount = body.split(U6_C2_CHECKSUM_PLACEHOLDER).length - 1;
  assertCondition(
    placeholderCount === 1,
    `U6 C2 ledger checksum placeholder 必须且只能出现一次：found=${placeholderCount}`,
  );
  const finalSegment = normalizedSegments.at(-1) ?? "";
  assertExecutableFinalLedger(finalSegment, U6_C2_CHECKSUM_PLACEHOLDER, "U6 C2 final segment");
  const placeholderLedger = finalLedgerBlock(U6_C2_CHECKSUM_PLACEHOLDER);
  const bodyWithZeroChecksum = `${body.slice(
    0,
    -placeholderLedger.length,
  )}${finalLedgerBlock(U6_C2_ZERO_CHECKSUM)}`;
  const normalized = `-- u6_c2_migration_checksum: ${U6_C2_ZERO_CHECKSUM}\n${bodyWithZeroChecksum}`;
  const checksum = sha256(normalized);
  const zeroLedger = finalLedgerBlock(U6_C2_ZERO_CHECKSUM);
  const contentWithMarker = normalized.replace(
    `-- u6_c2_migration_checksum: ${U6_C2_ZERO_CHECKSUM}`,
    `-- u6_c2_migration_checksum: ${checksum}`,
  );
  const content = `${contentWithMarker.slice(0, -zeroLedger.length)}${finalLedgerBlock(checksum)}`;
  const occurrences = checksumOccurrences(content);
  assertCondition(
    occurrences.marker === checksum && sha256(occurrences.normalized) === checksum,
    "U6 C2 candidate checksum 自校验失败",
  );
  return { content, checksum };
}

export function validateU6C2MaintenanceManifest(raw: unknown): U6C2MaintenanceManifest {
  assertCondition(isPlainRecord(raw), "U6 C2 maintenance manifest 必须是 object");
  assertStrictKeys(
    raw,
    [
      "protocol_version",
      "migration_name",
      "deployment_scope",
      "maintenance_window",
      "timeouts",
      "relation_limits",
      "manifest_hash",
    ],
    "U6 C2 maintenance manifest",
  );
  assertCondition(raw.protocol_version === C2_MANIFEST_PROTOCOL, "U6 C2 manifest protocol 漂移");
  assertCondition(
    raw.migration_name === U6_C2_MIGRATION_NAME,
    "U6 C2 manifest migration_name 漂移",
  );
  assertCondition(isPlainRecord(raw.deployment_scope), "deployment_scope 必须是 object");
  assertStrictKeys(
    raw.deployment_scope,
    ["app_id", "deployment_binding", "database_binding"],
    "deployment_scope",
  );
  assertCondition(raw.deployment_scope.app_id === APP_ID, "U6 C2 manifest app_id 漂移");
  assertCondition(
    raw.deployment_scope.deployment_binding === "SESSION_ACTIVE_MAPPING" &&
      raw.deployment_scope.database_binding === "SESSION_DATABASE_IDENTITY",
    "U6 C2 manifest deployment/database binding 漂移",
  );
  assertCondition(isPlainRecord(raw.maintenance_window), "maintenance_window 必须是 object");
  assertStrictKeys(raw.maintenance_window, ["window_id", "max_duration_ms"], "maintenance_window");
  assertCondition(
    typeof raw.maintenance_window.window_id === "string" &&
      UUID_PATTERN.test(raw.maintenance_window.window_id),
    "U6 C2 manifest window_id 不是规范 UUID",
  );
  assertSafeIntegerInRange(
    raw.maintenance_window.max_duration_ms,
    60_000,
    7_200_000,
    "max_duration_ms",
  );
  assertCondition(isPlainRecord(raw.timeouts), "timeouts 必须是 object");
  assertStrictKeys(
    raw.timeouts,
    ["lock_timeout_ms", "statement_timeout_ms", "idle_in_transaction_session_timeout_ms"],
    "timeouts",
  );
  assertSafeIntegerInRange(raw.timeouts.lock_timeout_ms, 100, 5_000, "lock_timeout_ms");
  assertSafeIntegerInRange(
    raw.timeouts.statement_timeout_ms,
    30_000,
    1_800_000,
    "statement_timeout_ms",
  );
  assertSafeIntegerInRange(
    raw.timeouts.idle_in_transaction_session_timeout_ms,
    30_000,
    300_000,
    "idle_in_transaction_session_timeout_ms",
  );
  assertCondition(Array.isArray(raw.relation_limits), "relation_limits 必须是 array");
  assertCondition(
    raw.relation_limits.length === U6_C2_EXISTING_RELATIONS.length,
    "U6 C2 relation_limits 必须精确包含十一张 existing relation",
  );
  raw.relation_limits.forEach((relation, index) => {
    assertCondition(isPlainRecord(relation), `relation_limits[${index}] 必须是 object`);
    assertStrictKeys(
      relation,
      ["qualified_name", "approved_max_rows", "approved_max_total_bytes"],
      `relation_limits[${index}]`,
    );
    assertCondition(
      relation.qualified_name === U6_C2_EXISTING_RELATIONS[index],
      "U6 C2 relation_limits 必须按冻结 tuple 顺序且不得重复",
    );
    assertSafeIntegerInRange(
      relation.approved_max_rows,
      0,
      Number.MAX_SAFE_INTEGER,
      `relation_limits[${index}].approved_max_rows`,
    );
    assertSafeIntegerInRange(
      relation.approved_max_total_bytes,
      0,
      Number.MAX_SAFE_INTEGER,
      `relation_limits[${index}].approved_max_total_bytes`,
    );
  });
  assertCondition(
    typeof raw.manifest_hash === "string" && SHA256_PATTERN.test(raw.manifest_hash),
    "U6 C2 manifest_hash 格式无效",
  );
  const withoutHash = { ...raw };
  delete withoutHash.manifest_hash;
  assertJsonValue(withoutHash, "U6 C2 manifest");
  const expectedHash = sha256(
    `${C2_MANIFEST_PROTOCOL}\0${canonicalJson(withoutHash as JsonValue)}`,
  );
  assertCondition(
    raw.manifest_hash === expectedHash,
    `U6 C2 manifest_hash 不匹配：expected=${expectedHash}`,
  );
  assertCondition(
    raw.manifest_hash === U6_C2_FROZEN_MANIFEST_HASH,
    "U6 C2 committed manifest hash 漂移",
  );
  return raw as U6C2MaintenanceManifest;
}

export function assertFrozenU6C1InventoryProjection(raw: unknown): BaselineInventory {
  assertCondition(isPlainRecord(raw), "U6 C1 baseline Inventory 必须是 object");
  assertCondition(
    raw.protocol_version === BASELINE_INVENTORY_PROTOCOL,
    "U6 C1 baseline Inventory protocol 漂移",
  );
  assertCondition(isPlainRecord(raw.migration), "U6 C1 baseline migration projection 缺失");
  assertStrictKeys(
    raw.migration,
    ["name", "sha256", "source_segments"],
    "U6 C1 baseline migration projection",
  );
  assertCondition(raw.migration.name === U6_MIGRATION_NAME, "U6 C1 migration name 漂移");
  assertCondition(
    raw.migration.sha256 === U6_C1_FROZEN_MIGRATION_CHECKSUM,
    "U6 C1 migration checksum 漂移",
  );
  assertCondition(
    Array.isArray(raw.migration.source_segments) &&
      JSON.stringify(raw.migration.source_segments) === JSON.stringify(U6_SOURCE_SEGMENTS),
    "U6 C1 source segment tuple 漂移",
  );
  assertCondition(isPlainRecord(raw.runtime), "U6 C1 runtime Inventory 缺失");
  assertCondition(Array.isArray(raw.relations), "U6 C1 relation Inventory 缺失");
  assertCondition(Array.isArray(raw.functions), "U6 C1 function Inventory 缺失");
  assertJsonValue(raw, "U6 C1 baseline Inventory");
  const inventoryHash = sha256(
    `${BASELINE_INVENTORY_PROTOCOL}\0${canonicalJson(raw as JsonValue)}`,
  );
  assertCondition(
    inventoryHash === U6_C1_FROZEN_INVENTORY_HASH,
    "U6 C1 baseline Inventory 完整投影漂移",
  );
  return raw as BaselineInventory;
}

export function verifyImmutableU6C1Baseline(paths: U6RendererPaths): BaselineInventory {
  const sessionValues = verifyGeneratedArtifacts(paths);
  assertCondition(
    sessionValues.manifestHash === U6_C1_FROZEN_MANIFEST_HASH,
    "U6 C1 maintenance manifest hash 漂移",
  );
  const migration = readFileSync(paths.migrationPath, "utf8");
  const marker = migration.match(/^-- u6_migration_checksum: (sha256:[0-9a-f]{64})$/m)?.[1];
  assertCondition(marker === U6_C1_FROZEN_MIGRATION_CHECKSUM, "U6 C1 migration bytes 漂移");
  return assertFrozenU6C1InventoryProjection(JSON.parse(readFileSync(paths.inventoryPath, "utf8")));
}

function validateSurfaceEntries(
  kind: U6C2InventorySurfaceKind,
  entries: readonly U6C2InventorySurfaceEntry[],
  label: string,
): U6C2InventorySurfaceEntry[] {
  const seen = new Set<string>();
  const validated = entries.map((entry, index) => {
    assertCondition(isPlainRecord(entry), `${label}.${kind}[${index}] 必须是 object`);
    assertStrictKeys(entry, ["identity", "descriptor"], `${label}.${kind}[${index}]`);
    assertCondition(
      typeof entry.identity === "string" &&
        entry.identity.length >= 1 &&
        entry.identity.length <= 512,
      `${label}.${kind}[${index}].identity 无效`,
    );
    if (kind === "relation") {
      assertCondition(
        /^app_data_agent\.[a-z_][a-z0-9_]*$/.test(entry.identity),
        `${label}.${kind}[${index}].identity 不是 canonical relation identity`,
      );
    }
    if (kind === "function") {
      assertCondition(
        /^app_data_agent\.[a-z_][a-z0-9_]*\([a-z0-9_.,[\]]*\)$/.test(entry.identity),
        `${label}.${kind}[${index}].identity 不是 canonical function identity`,
      );
    }
    assertCondition(
      !seen.has(entry.identity),
      `${label}.${kind} 出现重复 identity：${entry.identity}`,
    );
    seen.add(entry.identity);
    assertCondition(
      isPlainRecord(entry.descriptor),
      `${label}.${kind}[${index}].descriptor 必须是 object`,
    );
    assertJsonValue(entry.descriptor, `${label}.${kind}[${index}].descriptor`);
    return {
      identity: entry.identity,
      descriptor: entry.descriptor as JsonRecord,
    };
  });
  const expectedOrder = [...validated].map(({ identity }) => identity).sort(compareUtf8Bytes);
  assertCondition(
    JSON.stringify(validated.map(({ identity }) => identity)) === JSON.stringify(expectedOrder),
    `${label}.${kind} 必须按 identity UTF-8 bytes 升序`,
  );
  return validated;
}

type MutableSurfaceMap = Record<U6C2InventorySurfaceKind, U6C2InventorySurfaceEntry[]>;

function emptyMutableSurfaceMap(): MutableSurfaceMap {
  return {
    relation: [],
    function: [],
    constraint: [],
    index: [],
  };
}

function baselineSurfaceIdentities(
  inventory: BaselineInventory,
): Record<"relation" | "function", Set<string>> {
  const relations = new Set<string>();
  for (const relation of inventory.relations) {
    const identity = relation.qualified_name;
    assertCondition(typeof identity === "string", "baseline relation identity 缺失");
    assertCondition(!relations.has(identity), `baseline relation identity 重复：${identity}`);
    relations.add(identity);
  }
  const functions = new Set<string>();
  for (const fn of inventory.functions) {
    const schema = fn.schema;
    const signature = fn.signature;
    assertCondition(
      typeof schema === "string" && typeof signature === "string",
      "baseline function identity 缺失",
    );
    const identity = `${schema}.${signature}`;
    assertCondition(!functions.has(identity), `baseline function identity 重复：${identity}`);
    functions.add(identity);
  }
  return { relation: relations, function: functions };
}

function validateSurfaceDelta(
  baseline: BaselineInventory,
  raw: U6C2InventorySurfaceDelta,
): U6C2InventorySurfaceDelta {
  assertCondition(isPlainRecord(raw), "U6 C2 surface delta 必须是 object");
  assertStrictKeys(raw, ["additions", "replacements"], "U6 C2 surface delta");
  assertCondition(isPlainRecord(raw.additions), "surface additions 必须是 object");
  assertCondition(isPlainRecord(raw.replacements), "surface replacements 必须是 object");
  const kinds: U6C2InventorySurfaceKind[] = ["relation", "function", "constraint", "index"];
  assertStrictKeys(raw.additions, kinds, "surface additions");
  assertStrictKeys(raw.replacements, kinds, "surface replacements");
  const baselineIdentities = baselineSurfaceIdentities(baseline);
  const additions = emptyMutableSurfaceMap();
  const replacements = emptyMutableSurfaceMap();
  for (const kind of kinds) {
    assertCondition(Array.isArray(raw.additions[kind]), `surface additions.${kind} 必须是 array`);
    assertCondition(
      Array.isArray(raw.replacements[kind]),
      `surface replacements.${kind} 必须是 array`,
    );
    additions[kind] = validateSurfaceEntries(kind, raw.additions[kind], "additions");
    replacements[kind] = validateSurfaceEntries(kind, raw.replacements[kind], "replacements");
    const expectedReplacementIdentities = U6_C2_INVENTORY_REPLACEMENT_ALLOWLIST[kind];
    assertCondition(
      JSON.stringify(replacements[kind].map(({ identity }) => identity)) ===
        JSON.stringify(expectedReplacementIdentities),
      `U6 C2 ${kind} replacement 与 physical descriptor allowlist 不一致`,
    );
    const replacementAllowlist = new Set(expectedReplacementIdentities);
    for (const entry of replacements[kind]) {
      assertCondition(
        replacementAllowlist.has(entry.identity),
        `U6 C2 replacement 尚未由 physical descriptor 冻结：${kind}:${entry.identity}`,
      );
    }
    const replacementIdentities = new Set(replacements[kind].map((entry) => entry.identity));
    for (const entry of additions[kind]) {
      assertCondition(
        !replacementIdentities.has(entry.identity),
        `U6 C2 surface identity 同时 ADD/REPLACE：${kind}:${entry.identity}`,
      );
      if (kind === "relation" || kind === "function") {
        assertCondition(
          !baselineIdentities[kind].has(entry.identity),
          `U6 C2 addition 与 baseline 冲突：${kind}:${entry.identity}`,
        );
      }
    }
    if (kind === "relation" || kind === "function") {
      for (const entry of replacements[kind]) {
        assertCondition(
          baselineIdentities[kind].has(entry.identity),
          `U6 C2 replacement 不在 baseline：${kind}:${entry.identity}`,
        );
      }
    }
  }
  return { additions, replacements };
}

export function buildU6C2CandidateInventory(input: {
  baselineInventory: unknown;
  c2SourceDirectory: string;
}): U6C2CandidateInventory {
  assertCondition(isPlainRecord(input), "U6 C2 Candidate builder input 必须是 object");
  assertStrictKeys(
    input as unknown as Record<string, unknown>,
    ["baselineInventory", "c2SourceDirectory"],
    "U6 C2 Candidate builder input",
  );
  const baseline = assertFrozenU6C1InventoryProjection(input.baselineInventory);
  validateFrozenU6C2PhysicalSchemaDescriptor();
  const c2Checksum = renderU6C2MigrationCandidateFromSegments(input.c2SourceDirectory).checksum;
  assertCondition(
    c2Checksum !== U6_C1_FROZEN_MIGRATION_CHECKSUM,
    "U6 C2 checksum 不得复用 immutable 10590 checksum",
  );
  const surfaceDelta = validateSurfaceDelta(baseline, deriveU6C2InventorySurfaceDelta());
  assertJsonValue(baseline, "U6 C1 baseline Inventory");
  const candidate: U6C2CandidateInventory = {
    protocol_version: C2_CANDIDATE_INVENTORY_PROTOCOL,
    target_protocol_version: U6_C2_PHYSICAL_SCHEMA_DESCRIPTOR.target_inventory_protocol,
    installable: false,
    baseline_inventory_hash: U6_C1_FROZEN_INVENTORY_HASH,
    physical_descriptor_hash: U6_C2_FROZEN_PHYSICAL_SCHEMA_HASH,
    migrations: [
      {
        name: U6_MIGRATION_NAME,
        sha256: U6_C1_FROZEN_MIGRATION_CHECKSUM,
        source_segments: [...U6_SOURCE_SEGMENTS],
      },
      {
        name: U6_C2_MIGRATION_NAME,
        sha256: c2Checksum,
        source_segments: [...U6_C2_SOURCE_SEGMENTS],
      },
    ],
    runtime: structuredClone(baseline.runtime),
    baseline_surface: {
      relations: structuredClone(baseline.relations),
      functions: structuredClone(baseline.functions),
    },
    surface_delta: surfaceDelta,
  };
  return deepFreeze(candidate);
}

export function verifyU6C2AuthoringInputs(paths: U6C2CandidatePaths): {
  baselineInventory: BaselineInventory;
  manifest: U6C2MaintenanceManifest;
} {
  validateFrozenU6C2PhysicalSchemaDescriptor();
  const baselineInventory = verifyImmutableU6C1Baseline(paths.c1);
  const manifest = validateU6C2MaintenanceManifest(
    JSON.parse(readFileSync(paths.c2MaintenanceManifestPath, "utf8")),
  );
  return { baselineInventory, manifest };
}

export function verifyU6C2GeneratedMigration(paths: U6C2CandidatePaths): {
  checksum: `sha256:${string}`;
} {
  verifyU6C2AuthoringInputs(paths);
  const rendered = renderU6C2MigrationCandidateFromSegments(paths.c2SourceDirectory);
  const migration = readFileSync(paths.c2MigrationPath, "utf8");
  assertCondition(migration === rendered.content, "10600 与固定 C2 source segments 渲染结果不一致");
  const occurrences = checksumOccurrences(migration);
  assertCondition(
    occurrences.marker === rendered.checksum &&
      sha256(occurrences.normalized) === rendered.checksum,
    "10600 generated migration checksum 复验失败",
  );
  return { checksum: rendered.checksum };
}

export function defaultU6C2CandidatePaths(repositoryRoot: string): U6C2CandidatePaths {
  const appInfraRoot = resolve(repositoryRoot, "infra/supabase/apps/data-agent");
  return {
    c1: defaultRendererPaths(repositoryRoot),
    c2MaintenanceManifestPath: resolve(appInfraRoot, "u6-c2-migration-maintenance-manifest.json"),
    c2SourceDirectory: resolve(appInfraRoot, "migration-sources/10600"),
    c2MigrationPath: resolve(appInfraRoot, "migrations", U6_C2_MIGRATION_NAME),
  };
}

function isMainModule(): boolean {
  return (
    process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isMainModule()) {
  const arguments_ = process.argv.slice(2);
  const allowedArguments = new Set([
    "--verify-manifest",
    "--verify-immutable-baseline",
    "--verify-generated",
  ]);
  assertCondition(arguments_.length <= 1, "U6 C2 authoring CLI 每次只接受一个 verify 动作");
  const argument = arguments_[0];
  assertCondition(
    argument === undefined || allowedArguments.has(argument),
    `U6 C2 authoring CLI 不提供写入口：unsupported=${argument ?? ""}`,
  );
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const paths = defaultU6C2CandidatePaths(repositoryRoot);
  const verified = verifyU6C2AuthoringInputs(paths);
  if (argument === "--verify-generated") {
    const generated = verifyU6C2GeneratedMigration(paths);
    console.log(
      `U6 C2 generated migration verified: ${basename(paths.c2MigrationPath)} checksum=${generated.checksum}`,
    );
  } else {
    console.log(
      [
        "U6 C2 authoring inputs verified",
        `manifest=${verified.manifest.manifest_hash}`,
        `baseline=${verified.baselineInventory.migration.sha256}`,
        `target=${basename(U6_C2_MIGRATION_NAME)}`,
        "installable=true",
      ].join(" "),
    );
  }
}
