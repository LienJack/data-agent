import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import pg from "pg";
import {
  buildLegacyAttributionCleanupCommand,
  parseLegacyAttributionBackupManifest,
  parseLegacyAttributionCleanupInventory,
  redactCleanupError,
  verifyLegacyAttributionBackup,
} from "./lib/legacy-attribution-cleanup.js";

const DEFAULT_DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000001";

function argumentsMap(values: readonly string[]): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--") || result.has(key)) {
      throw new Error("LEGACY_ATTRIBUTION_CLEANUP_ARGUMENTS_INVALID");
    }
    result.set(key, value);
  }
  return result;
}

function required(args: ReadonlyMap<string, string>, key: string): string {
  const value = args.get(key)?.trim();
  if (!value) throw new Error(`LEGACY_ATTRIBUTION_CLEANUP_ARGUMENT_REQUIRED:${key}`);
  return value;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as unknown;
}

function existingRequestedAt(value: unknown): Date | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("requested_at" in value) ||
    typeof value.requested_at !== "string" ||
    !Number.isFinite(Date.parse(value.requested_at))
  ) {
    return undefined;
  }
  return new Date(value.requested_at);
}

function writeJson(path: string | undefined, value: unknown): void {
  const document = `${JSON.stringify(value, null, 2)}\n`;
  if (!path) {
    process.stdout.write(document);
    return;
  }
  const output = resolve(path);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, document, { mode: 0o600 });
  process.stdout.write(
    `${JSON.stringify({ terminal: "READY", output, schema_version: (value as { schema_version?: string }).schema_version })}\n`,
  );
}

async function readLiveInventory(pool: pg.Pool, deploymentId: string) {
  const result = await pool.query<{ inventory: unknown }>(
    "select app_data_agent.legacy_attribution_cleanup_inventory($1::uuid) as inventory",
    [deploymentId],
  );
  return parseLegacyAttributionCleanupInventory(result.rows[0]?.inventory);
}

const [command, ...rawArguments] = process.argv.slice(2);
const args = argumentsMap(rawArguments);
const allowedArguments =
  command === "inventory"
    ? new Set(["--deployment-id", "--output"])
    : command === "backup-manifest"
      ? new Set(["--inventory-file", "--backup-file", "--output"])
      : command === "execute"
        ? new Set([
            "--inventory-file",
            "--backup-manifest",
            "--operation-id",
            "--retirement-commit",
            "--confirm",
            "--output",
          ])
        : new Set<string>();
if (
  !command ||
  allowedArguments.size === 0 ||
  [...args.keys()].some((key) => !allowedArguments.has(key))
) {
  throw new Error("LEGACY_ATTRIBUTION_CLEANUP_COMMAND_INVALID");
}

const connectionString =
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: operational CLI reuses the server authority URL.
  process.env.AUTH_DATABASE_URL ??
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: DATABASE_URL is the documented local fallback.
  process.env.DATABASE_URL ??
  "postgres://postgres:postgres@127.0.0.1:5432/data_agent";
const pool = new pg.Pool({
  connectionString,
  application_name: "data-agent-legacy-attribution-cleanup",
  connectionTimeoutMillis: 5_000,
  statement_timeout: 300_000,
  max: 1,
});

try {
  if (command === "inventory") {
    const inventory = await readLiveInventory(
      pool,
      args.get("--deployment-id") ?? DEFAULT_DEPLOYMENT_ID,
    );
    writeJson(args.get("--output"), inventory);
  } else if (command === "backup-manifest") {
    const inventory = parseLegacyAttributionCleanupInventory(
      readJson(required(args, "--inventory-file")),
    );
    const backup = verifyLegacyAttributionBackup({
      backupPath: required(args, "--backup-file"),
      inventory,
    });
    writeJson(args.get("--output"), backup);
  } else {
    const inventory = parseLegacyAttributionCleanupInventory(
      readJson(required(args, "--inventory-file")),
    );
    const backup = parseLegacyAttributionBackupManifest(
      readJson(required(args, "--backup-manifest")),
    );
    if (!existsSync(backup.backup_path)) throw new Error("LEGACY_ATTRIBUTION_BACKUP_MISSING");
    const verifiedBackup = verifyLegacyAttributionBackup({
      backupPath: backup.backup_path,
      inventory,
      createdAt: new Date(backup.created_at),
    });
    if (JSON.stringify(verifiedBackup) !== JSON.stringify(backup)) {
      throw new Error("LEGACY_ATTRIBUTION_BACKUP_CHANGED");
    }
    const live = await readLiveInventory(pool, inventory.deployment_id);
    if (live.inventory_digest !== inventory.inventory_digest) {
      throw new Error("LEGACY_ATTRIBUTION_LIVE_INVENTORY_CHANGED");
    }
    const operationId = required(args, "--operation-id");
    const existing = await pool.query<{ request_document: unknown }>(
      `select request_document
       from app_data_agent.legacy_attribution_cleanup_receipts
       where operation_id = $1::uuid`,
      [operationId],
    );
    const cleanupCommand = buildLegacyAttributionCleanupCommand({
      inventory,
      backup,
      operationId,
      retirementCommit: required(args, "--retirement-commit"),
      confirmation: required(args, "--confirm"),
      requestedAt: existingRequestedAt(existing.rows[0]?.request_document),
    });
    const result = await pool.query<{ receipt: unknown }>(
      "select app_data_agent.execute_legacy_attribution_cleanup($1::jsonb) as receipt",
      [cleanupCommand],
    );
    writeJson(args.get("--output"), result.rows[0]?.receipt);
  }
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ terminal: "HOLD", error: redactCleanupError(error) })}\n`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}

if (process.exitCode) process.exit(process.exitCode);
