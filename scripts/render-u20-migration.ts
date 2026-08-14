import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const U20_MIGRATION_NAME = "20260725010620_app_data_agent_contribution_authority.sql";
export const U20_MIGRATION_VERSION = "20260725010620_app_data_agent_contribution_authority";
export const U20_CHECKSUM_PLACEHOLDER = "__CONTRIBUTION_MIGRATION_CHECKSUM__";
export const U20_ZERO_CHECKSUM = `sha256:${"0".repeat(64)}`;
export const U20_SOURCE_SEGMENTS = [
  "00-preamble.sql.inc",
  "10-owner-map.sql.inc",
  "20-relationship-promotion.sql.inc",
  "30-conclusion-policy.sql.inc",
  "40-signer-assignment.sql.inc",
  "50-verification-key.sql.inc",
  "60-active-pointer.sql.inc",
  "70-nonce-ledger.sql.inc",
  "80-internal-functions.sql.inc",
  "90-rls-owner-grants.sql.inc",
  "99-postconditions-ledger-commit.sql.inc",
] as const;

const APP_ID = "00000000-0000-4000-8000-00000000da01";
const MANIFEST_PROTOCOL = "u20-migration-maintenance@1.0.0";
const MANIFEST_DOMAIN = `${MANIFEST_PROTOCOL}\0`;
const CHECKSUM_PATTERN = "sha256:[0-9a-f]{64}";

const U20_FUNCTIONS = [
  // Owner map RPCs
  "provision_owner_map_release(uuid,uuid,text,jsonb)",
  "activate_owner_map_release(uuid,uuid,text,uuid)",
  "retire_owner_map_release(uuid,uuid,text,uuid)",
  // Relationship promotion RPCs
  "commit_relationship_promotion_receipt(uuid,uuid,text,uuid,uuid,text,jsonb)",
  "verify_relationship_promotion(uuid,uuid,text,uuid)",
  // Conclusion policy RPCs
  "provision_conclusion_policy(uuid,uuid,text,jsonb)",
  "activate_conclusion_policy(uuid,uuid,text,uuid)",
  "retire_conclusion_policy(uuid,uuid,text,uuid)",
  // Signer assignment RPCs
  "provision_signer_assignment(uuid,uuid,text,uuid,text,integer,text[],jsonb)",
  "activate_signer_assignment(uuid,uuid,text,uuid)",
  "retire_signer_assignment(uuid,uuid,text,uuid)",
  // Verification key RPCs
  "stage_verification_key(uuid,uuid,text,text,text,boolean)",
  "activate_verification_key(uuid,uuid,text,uuid)",
  "compromise_verification_key(uuid,uuid,text,uuid)",
  "retire_verification_key(uuid,uuid,text,uuid)",
  // Active pointer RPCs
  "get_active_pointer(uuid,uuid,text,app_data_agent.attribution_pointer_type)",
  "set_active_pointer(uuid,uuid,text,app_data_agent.attribution_pointer_type,uuid)",
  // Nonce ledger RPC
  "check_and_consume_nonce(uuid,uuid,text,text,text,timestamptz,text)",
  // Internal functions
  "attribution_sha256(text,jsonb)",
  "lock_attribution_authority_fence(uuid,uuid,text)",
  "attribution_canonical_json(jsonb)",
] as const;

const U20_TABLES = [
  "app_data_agent.attribution_owner_map_release",
  "app_data_agent.attribution_relationship_promotion_receipt",
  "app_data_agent.attribution_conclusion_policy",
  "app_data_agent.attribution_signer_assignment",
  "app_data_agent.attribution_verification_key_revision",
  "app_data_agent.attribution_active_pointer",
  "app_data_agent.attribution_nonce_ledger",
] as const;

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
    assertCondition(Number.isFinite(value), "JCS does not allow non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  assertCondition(typeof value === "object" && value !== null, "JCS input must be a JSON value");
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
    `${label} field mismatch: actual=${actual.join(",")}`,
  );
}

function normalizeSegment(content: string): string {
  return `${content.replace(/\r\n?/g, "\n").replace(/\n+$/g, "")}\n`;
}

export function renderMigrationFromSegments(sourceDirectory: string): {
  content: string;
  checksum: string;
} {
  assertCondition(
    existsSync(sourceDirectory),
    `U20 source directory does not exist: ${sourceDirectory}`,
  );
  const actualSegments = readdirSync(sourceDirectory)
    .filter((entry) => entry.endsWith(".sql.inc"))
    .sort();
  assertCondition(
    JSON.stringify(actualSegments) === JSON.stringify([...U20_SOURCE_SEGMENTS].sort()),
    `U20 source segment closure mismatch: actual=${actualSegments.join(",")}`,
  );
  const body = U20_SOURCE_SEGMENTS.map((segment) =>
    normalizeSegment(readFileSync(resolve(sourceDirectory, segment), "utf8")),
  ).join("");
  const placeholderCount = body.split(U20_CHECKSUM_PLACEHOLDER).length - 1;
  assertCondition(
    placeholderCount === 1,
    `U20 ledger checksum placeholder must appear exactly once: found=${placeholderCount}`,
  );
  assertCondition(
    new RegExp(`'${U20_MIGRATION_VERSION}'\\s*,\\s*'${U20_CHECKSUM_PLACEHOLDER}'`).test(body),
    "U20 checksum placeholder must be the final migration ledger parameter",
  );
  const normalized = `-- u20_migration_checksum: ${U20_ZERO_CHECKSUM}\n${body.replace(
    U20_CHECKSUM_PLACEHOLDER,
    U20_ZERO_CHECKSUM,
  )}`;
  const checksum = sha256(normalized);
  return {
    content: normalized
      .replace(
        `-- u20_migration_checksum: ${U20_ZERO_CHECKSUM}`,
        `-- u20_migration_checksum: ${checksum}`,
      )
      .replace(
        new RegExp(
          `('${U20_MIGRATION_VERSION}'\\s*,\\s*')${U20_ZERO_CHECKSUM.replace(":", "\\:")}(')`,
        ),
        `$1${checksum}$2`,
      ),
    checksum,
  };
}

export function validateMaintenanceManifest(raw: unknown): MaintenanceManifest {
  assertCondition(
    typeof raw === "object" && raw !== null && !Array.isArray(raw),
    "U20 maintenance manifest must be an object",
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
  assertCondition(manifest.protocol_version === MANIFEST_PROTOCOL, "manifest protocol drift");
  assertCondition(manifest.migration_name === U20_MIGRATION_NAME, "manifest migration_name drift");
  assertStrictKeys(
    manifest.deployment_scope as unknown as Record<string, unknown>,
    ["app_id", "deployment_binding", "database_binding"],
    "deployment_scope",
  );
  assertCondition(manifest.deployment_scope.app_id === APP_ID, "manifest app_id drift");
  assertCondition(
    manifest.deployment_scope.deployment_binding === "SESSION_ACTIVE_MAPPING",
    "manifest deployment_binding drift",
  );
  assertCondition(
    manifest.deployment_scope.database_binding === "SESSION_DATABASE_IDENTITY",
    "manifest database_binding drift",
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
    "manifest window_id is not a valid UUID",
  );
  const range = (value: number, min: number, max: number, label: string) => {
    assertCondition(
      Number.isSafeInteger(value) && value >= min && value <= max,
      `${label} out of range`,
    );
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
  assertCondition(
    Array.isArray(manifest.relation_limits) &&
      manifest.relation_limits.length === U20_TABLES.length,
    `manifest relation_limits must contain exactly ${U20_TABLES.length} tables`,
  );
  manifest.relation_limits.forEach((relation, index) => {
    assertStrictKeys(
      relation as unknown as Record<string, unknown>,
      ["qualified_name", "approved_max_rows", "approved_max_total_bytes"],
      `relation_limits[${index}]`,
    );
    assertCondition(
      relation.qualified_name === U20_TABLES[index],
      `manifest relation_limits must be sorted by fully qualified name and closed: index=${index}`,
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
    "manifest_hash format is invalid",
  );
  const withoutHash = { ...manifest } as Record<string, unknown>;
  delete withoutHash.manifest_hash;
  const expectedHash = sha256(`${MANIFEST_DOMAIN}${canonicalJson(withoutHash)}`);
  assertCondition(
    manifest.manifest_hash === expectedHash,
    `manifest_hash mismatch: expected=${expectedHash}`,
  );
  return manifest;
}

export function verifyGeneratedArtifacts(
  sourceDirectory: string,
  migrationPath: string,
  maintenanceManifestPath: string,
): void {
  const manifest = validateMaintenanceManifest(
    JSON.parse(readFileSync(maintenanceManifestPath, "utf8")),
  );
  const rendered = renderMigrationFromSegments(sourceDirectory);
  const migration = readFileSync(migrationPath, "utf8");
  assertCondition(
    migration === rendered.content,
    "U20 migration does not match rendered result from source segments",
  );
  // Validate checksum self-consistency
  const markerMatches = [
    ...migration.matchAll(new RegExp(`^-- u20_migration_checksum: (${CHECKSUM_PATTERN})$`, "gm")),
  ];
  assertCondition(markerMatches.length === 1, "U20 must have exactly one checksum marker");
  const marker = markerMatches[0]?.[1] ?? "";
  const ledgerPattern = new RegExp(
    `('${U20_MIGRATION_VERSION}'\\s*,\\s*')(${CHECKSUM_PATTERN})(')`,
    "g",
  );
  const ledgerMatches = [...migration.matchAll(ledgerPattern)];
  assertCondition(ledgerMatches.length === 1, "U20 must have exactly one ledger checksum entry");
  const ledger = ledgerMatches[0]?.[2] ?? "";
  assertCondition(marker === ledger, "U20 marker and ledger checksum mismatch");
  const normalized = migration
    .replace(
      new RegExp(`^-- u20_migration_checksum: ${CHECKSUM_PATTERN}$`, "m"),
      `-- u20_migration_checksum: ${U20_ZERO_CHECKSUM}`,
    )
    .replace(ledgerPattern, `$1${U20_ZERO_CHECKSUM}$3`);
  assertCondition(marker === sha256(normalized), "U20 self-checksum does not match");
  console.log(`U20 migration artifacts verified: ${basename(migrationPath)}`);
}

export function defaultRendererPaths(repositoryRoot: string): {
  sourceDirectory: string;
  migrationPath: string;
  maintenanceManifestPath: string;
} {
  const appInfraRoot = resolve(repositoryRoot, "infra/supabase/apps/data-agent");
  return {
    sourceDirectory: resolve(appInfraRoot, "migration-sources/10620"),
    migrationPath: resolve(appInfraRoot, "migrations", U20_MIGRATION_NAME),
    maintenanceManifestPath: resolve(appInfraRoot, "u20-migration-maintenance-manifest.json"),
  };
}

// ============================================================
// CLI entry point
// ============================================================
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const paths = defaultRendererPaths(repositoryRoot);

  if (process.argv.includes("--verify")) {
    // Verify existing artifacts
    verifyGeneratedArtifacts(
      paths.sourceDirectory,
      paths.migrationPath,
      paths.maintenanceManifestPath,
    );
  } else if (process.argv.includes("--render-only")) {
    // Render and print the migration (for initial creation)
    const rendered = renderMigrationFromSegments(paths.sourceDirectory);
    process.stdout.write(rendered.content);
    console.error(`U20 migration rendered: checksum=${rendered.checksum}`);
  } else {
    // Default: render and verify
    const rendered = renderMigrationFromSegments(paths.sourceDirectory);
    assertCondition(
      existsSync(paths.migrationPath),
      "Migration file does not exist. Use --render-only to create it first.",
    );
    const migration = readFileSync(paths.migrationPath, "utf8");
    assertCondition(migration === rendered.content, "Migration file is stale. Re-render needed.");
    verifyGeneratedArtifacts(
      paths.sourceDirectory,
      paths.migrationPath,
      paths.maintenanceManifestPath,
    );
    console.log(`U20 migration artifacts verified: ${basename(paths.migrationPath)}`);
  }
}
