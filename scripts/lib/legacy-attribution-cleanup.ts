import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

export const LEGACY_ATTRIBUTION_CLEANUP_CONFIRMATION =
  "DELETE_LEGACY_ATTRIBUTION_AUTHORITY_ROWS_ONLY";

export const LEGACY_ATTRIBUTION_TABLES = [
  "attribution_active_pointer",
  "attribution_capability_directory",
  "attribution_conclusion_policy",
  "attribution_eligibility_decision",
  "attribution_nonce_ledger",
  "attribution_owner_map_release",
  "attribution_profile_projection",
  "attribution_profile_request",
  "attribution_relationship_promotion_receipt",
  "attribution_safety_verdict",
  "attribution_signer_assignment",
  "attribution_verification_key_revision",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{7,40}$/;

export type LegacyAttributionTableName = (typeof LEGACY_ATTRIBUTION_TABLES)[number];

export type LegacyAttributionCleanupInventory = Readonly<{
  schema_version: "legacy-attribution-cleanup-inventory@1.0.0";
  app_id: string;
  environment: string;
  deployment_id: string;
  database_name: string;
  system_identifier: string;
  migration_attestation: Readonly<{
    contribution_10620_ledger_checksum: string;
    published_f9_10621_legacy_ledger_checksum: string;
    published_f9_10621_source_checksum: string;
    published_f9_legacy_zero_ledger_attested: true;
  }>;
  targets: readonly Readonly<{
    table_name: LegacyAttributionTableName;
    row_count: number;
    schema_fingerprint: string;
  }>[];
  external_fk_count: number;
  hold_column_count: number;
  total_rows: number;
  inventory_digest: string;
}>;

export type LegacyAttributionBackupManifest = Readonly<{
  schema_version: "legacy-attribution-backup-manifest@1.0.0";
  backup_path: string;
  database_name: string;
  system_identifier: string;
  inventory_digest: string;
  backup_sha256: string;
  backup_bytes: number;
  restore_list_verified: true;
  created_at: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  marker: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(marker);
}

function assertNonNegativeInteger(value: unknown, marker: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(marker);
}

function sha256(value: Buffer | string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function listBackupArchive(path: string): string {
  try {
    return execFileSync("pg_restore", ["--list", path], { encoding: "utf8" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--volume",
        `${dirname(path)}:/backup:ro`,
        "postgres:17-alpine",
        "pg_restore",
        "--list",
        `/backup/${basename(path)}`,
      ],
      { encoding: "utf8" },
    );
  }
}

export function parseLegacyAttributionCleanupInventory(
  value: unknown,
): LegacyAttributionCleanupInventory {
  if (!isRecord(value)) throw new Error("LEGACY_ATTRIBUTION_INVENTORY_INVALID");
  assertExactKeys(
    value,
    [
      "schema_version",
      "app_id",
      "environment",
      "deployment_id",
      "database_name",
      "system_identifier",
      "migration_attestation",
      "targets",
      "external_fk_count",
      "hold_column_count",
      "total_rows",
      "inventory_digest",
    ],
    "LEGACY_ATTRIBUTION_INVENTORY_INVALID",
  );
  if (
    value.schema_version !== "legacy-attribution-cleanup-inventory@1.0.0" ||
    typeof value.app_id !== "string" ||
    !UUID.test(value.app_id) ||
    typeof value.deployment_id !== "string" ||
    !UUID.test(value.deployment_id) ||
    typeof value.environment !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.environment) ||
    typeof value.database_name !== "string" ||
    !/^[A-Za-z_][A-Za-z0-9_$]{0,62}$/.test(value.database_name) ||
    typeof value.system_identifier !== "string" ||
    !/^[0-9]{10,24}$/.test(value.system_identifier) ||
    typeof value.inventory_digest !== "string" ||
    !SHA256.test(value.inventory_digest)
  ) {
    throw new Error("LEGACY_ATTRIBUTION_INVENTORY_INVALID");
  }
  if (!isRecord(value.migration_attestation)) {
    throw new Error("LEGACY_ATTRIBUTION_INVENTORY_INVALID");
  }
  assertExactKeys(
    value.migration_attestation,
    [
      "contribution_10620_ledger_checksum",
      "published_f9_10621_legacy_ledger_checksum",
      "published_f9_10621_source_checksum",
      "published_f9_legacy_zero_ledger_attested",
    ],
    "LEGACY_ATTRIBUTION_INVENTORY_INVALID",
  );
  if (
    !SHA256.test(String(value.migration_attestation.contribution_10620_ledger_checksum)) ||
    !SHA256.test(String(value.migration_attestation.published_f9_10621_legacy_ledger_checksum)) ||
    !SHA256.test(String(value.migration_attestation.published_f9_10621_source_checksum)) ||
    value.migration_attestation.published_f9_legacy_zero_ledger_attested !== true
  ) {
    throw new Error("LEGACY_ATTRIBUTION_INVENTORY_INVALID");
  }
  if (!Array.isArray(value.targets) || value.targets.length !== LEGACY_ATTRIBUTION_TABLES.length) {
    throw new Error("LEGACY_ATTRIBUTION_INVENTORY_INVALID");
  }
  let total = 0;
  for (const [index, target] of value.targets.entries()) {
    if (!isRecord(target)) throw new Error("LEGACY_ATTRIBUTION_INVENTORY_INVALID");
    assertExactKeys(
      target,
      ["table_name", "row_count", "schema_fingerprint"],
      "LEGACY_ATTRIBUTION_INVENTORY_INVALID",
    );
    if (
      target.table_name !== LEGACY_ATTRIBUTION_TABLES[index] ||
      typeof target.schema_fingerprint !== "string" ||
      !SHA256.test(target.schema_fingerprint)
    ) {
      throw new Error("LEGACY_ATTRIBUTION_INVENTORY_INVALID");
    }
    assertNonNegativeInteger(target.row_count, "LEGACY_ATTRIBUTION_INVENTORY_INVALID");
    total += target.row_count;
  }
  assertNonNegativeInteger(value.external_fk_count, "LEGACY_ATTRIBUTION_INVENTORY_INVALID");
  assertNonNegativeInteger(value.hold_column_count, "LEGACY_ATTRIBUTION_INVENTORY_INVALID");
  assertNonNegativeInteger(value.total_rows, "LEGACY_ATTRIBUTION_INVENTORY_INVALID");
  if (value.total_rows !== total) throw new Error("LEGACY_ATTRIBUTION_INVENTORY_INVALID");
  return value as LegacyAttributionCleanupInventory;
}

export function verifyLegacyAttributionBackup(input: {
  readonly backupPath: string;
  readonly inventory: LegacyAttributionCleanupInventory;
  readonly createdAt?: Date;
  readonly listArchive?: (path: string) => string;
}): LegacyAttributionBackupManifest {
  const backupPath = resolve(input.backupPath);
  if (!isAbsolute(backupPath)) throw new Error("LEGACY_ATTRIBUTION_BACKUP_PATH_INVALID");
  const archive = readFileSync(backupPath);
  if (archive.length === 0) throw new Error("LEGACY_ATTRIBUTION_BACKUP_EMPTY");
  const listArchive = input.listArchive ?? ((path: string) => listBackupArchive(path));
  const listing = listArchive(backupPath);
  if (!listing.includes("TABLE DATA") && input.inventory.total_rows > 0) {
    throw new Error("LEGACY_ATTRIBUTION_BACKUP_RESTORE_LIST_INVALID");
  }
  return {
    schema_version: "legacy-attribution-backup-manifest@1.0.0",
    backup_path: backupPath,
    database_name: input.inventory.database_name,
    system_identifier: input.inventory.system_identifier,
    inventory_digest: input.inventory.inventory_digest,
    backup_sha256: sha256(archive),
    backup_bytes: archive.length,
    restore_list_verified: true,
    created_at: (input.createdAt ?? new Date()).toISOString(),
  };
}

export function parseLegacyAttributionBackupManifest(
  value: unknown,
): LegacyAttributionBackupManifest {
  if (!isRecord(value)) throw new Error("LEGACY_ATTRIBUTION_BACKUP_MANIFEST_INVALID");
  assertExactKeys(
    value,
    [
      "schema_version",
      "backup_path",
      "database_name",
      "system_identifier",
      "inventory_digest",
      "backup_sha256",
      "backup_bytes",
      "restore_list_verified",
      "created_at",
    ],
    "LEGACY_ATTRIBUTION_BACKUP_MANIFEST_INVALID",
  );
  if (
    value.schema_version !== "legacy-attribution-backup-manifest@1.0.0" ||
    typeof value.backup_path !== "string" ||
    !isAbsolute(value.backup_path) ||
    typeof value.database_name !== "string" ||
    typeof value.system_identifier !== "string" ||
    typeof value.inventory_digest !== "string" ||
    !SHA256.test(value.inventory_digest) ||
    typeof value.backup_sha256 !== "string" ||
    !SHA256.test(value.backup_sha256) ||
    value.restore_list_verified !== true ||
    typeof value.created_at !== "string" ||
    !Number.isFinite(Date.parse(value.created_at))
  ) {
    throw new Error("LEGACY_ATTRIBUTION_BACKUP_MANIFEST_INVALID");
  }
  assertNonNegativeInteger(value.backup_bytes, "LEGACY_ATTRIBUTION_BACKUP_MANIFEST_INVALID");
  return value as LegacyAttributionBackupManifest;
}

export function buildLegacyAttributionCleanupCommand(input: {
  readonly inventory: LegacyAttributionCleanupInventory;
  readonly backup: LegacyAttributionBackupManifest;
  readonly operationId: string;
  readonly retirementCommit: string;
  readonly confirmation: string;
  readonly requestedAt?: Date;
}): Record<string, unknown> {
  if (!UUID.test(input.operationId)) throw new Error("LEGACY_ATTRIBUTION_OPERATION_ID_INVALID");
  if (!COMMIT.test(input.retirementCommit)) {
    throw new Error("LEGACY_ATTRIBUTION_RETIREMENT_COMMIT_INVALID");
  }
  if (input.confirmation !== LEGACY_ATTRIBUTION_CLEANUP_CONFIRMATION) {
    throw new Error("LEGACY_ATTRIBUTION_CONFIRMATION_REQUIRED");
  }
  if (
    input.backup.database_name !== input.inventory.database_name ||
    input.backup.system_identifier !== input.inventory.system_identifier ||
    input.backup.inventory_digest !== input.inventory.inventory_digest
  ) {
    throw new Error("LEGACY_ATTRIBUTION_BACKUP_SCOPE_MISMATCH");
  }
  const expectedCounts = Object.fromEntries(
    input.inventory.targets.map((target) => [target.table_name, target.row_count]),
  );
  return {
    schema_version: "legacy-attribution-cleanup-command@1.0.0",
    operation_id: input.operationId,
    deployment_id: input.inventory.deployment_id,
    app_id: input.inventory.app_id,
    environment: input.inventory.environment,
    database_name: input.inventory.database_name,
    system_identifier: input.inventory.system_identifier,
    inventory_digest: input.inventory.inventory_digest,
    backup: {
      schema_version: input.backup.schema_version,
      database_name: input.backup.database_name,
      system_identifier: input.backup.system_identifier,
      inventory_digest: input.backup.inventory_digest,
      backup_sha256: input.backup.backup_sha256,
      backup_bytes: input.backup.backup_bytes,
      restore_list_verified: input.backup.restore_list_verified,
      created_at: input.backup.created_at,
    },
    approval: input.confirmation,
    expected_counts: expectedCounts,
    expected_total: input.inventory.total_rows,
    hold_attestation: "NO_HOLDS",
    retirement_commit: input.retirementCommit,
    requested_at: (input.requestedAt ?? new Date(input.backup.created_at)).toISOString(),
  };
}

export function redactCleanupError(value: unknown): string {
  const text = value instanceof Error ? value.message : String(value);
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/(password|secret|token)=([^\s&]+)/gi, "$1=[REDACTED]");
}
