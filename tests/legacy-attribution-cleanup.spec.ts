import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLegacyAttributionCleanupCommand,
  LEGACY_ATTRIBUTION_CLEANUP_CONFIRMATION,
  LEGACY_ATTRIBUTION_TABLES,
  parseLegacyAttributionBackupManifest,
  parseLegacyAttributionCleanupInventory,
  redactCleanupError,
  verifyLegacyAttributionBackup,
} from "../scripts/lib/legacy-attribution-cleanup.js";

const hash = (digit: string) => `sha256:${digit.repeat(64)}`;

function inventory() {
  return parseLegacyAttributionCleanupInventory({
    schema_version: "legacy-attribution-cleanup-inventory@1.0.0",
    app_id: "00000000-0000-4000-8000-00000000da01",
    environment: "local",
    deployment_id: "00000000-0000-4000-8000-000000000001",
    database_name: "data_agent",
    system_identifier: "7675232435726172194",
    migration_attestation: {
      contribution_10620_ledger_checksum: hash("1"),
      published_f9_10621_legacy_ledger_checksum: hash("0"),
      published_f9_10621_source_checksum: hash("2"),
      published_f9_legacy_zero_ledger_attested: true,
    },
    targets: LEGACY_ATTRIBUTION_TABLES.map((table_name) => ({
      table_name,
      row_count: 0,
      schema_fingerprint: hash("3"),
    })),
    external_fk_count: 0,
    hold_column_count: 0,
    total_rows: 0,
    inventory_digest: hash("4"),
  });
}

describe("legacy attribution cleanup boundary", () => {
  it("freezes the exact attribution-only table allowlist", () => {
    expect(LEGACY_ATTRIBUTION_TABLES).toHaveLength(12);
    expect(LEGACY_ATTRIBUTION_TABLES).toContain("attribution_profile_projection");
    expect(LEGACY_ATTRIBUTION_TABLES).not.toContain("runs");
    expect(LEGACY_ATTRIBUTION_TABLES).not.toContain("artifacts");
  });

  it("rejects incomplete, reordered, and internally inconsistent inventory", () => {
    const valid = inventory();
    expect(parseLegacyAttributionCleanupInventory(valid)).toEqual(valid);
    expect(() => parseLegacyAttributionCleanupInventory({ ...valid, unexpected: true })).toThrow(
      "LEGACY_ATTRIBUTION_INVENTORY_INVALID",
    );
    expect(() =>
      parseLegacyAttributionCleanupInventory({
        ...valid,
        targets: [...valid.targets].reverse(),
      }),
    ).toThrow("LEGACY_ATTRIBUTION_INVENTORY_INVALID");
    expect(() => parseLegacyAttributionCleanupInventory({ ...valid, total_rows: 1 })).toThrow(
      "LEGACY_ATTRIBUTION_INVENTORY_INVALID",
    );
  });

  it("binds a restore-list-verified backup to the inventory identity", () => {
    const directory = mkdtempSync(join(tmpdir(), "legacy-attribution-backup-"));
    const backupPath = join(directory, "data-agent.dump");
    writeFileSync(backupPath, "synthetic-custom-format-backup");
    const manifest = verifyLegacyAttributionBackup({
      backupPath,
      inventory: inventory(),
      createdAt: new Date("2026-08-22T00:00:00.000Z"),
      listArchive: () => "; Archive created at 2026-08-22",
    });
    expect(manifest).toMatchObject({
      database_name: "data_agent",
      inventory_digest: hash("4"),
      restore_list_verified: true,
      backup_bytes: 30,
    });
    expect(parseLegacyAttributionBackupManifest(manifest)).toEqual(manifest);
  });

  it("requires exact approval and closes command scope over backup and counts", () => {
    const current = inventory();
    const directory = mkdtempSync(join(tmpdir(), "legacy-attribution-command-"));
    const backupPath = join(directory, "data-agent.dump");
    writeFileSync(backupPath, "backup");
    const backup = verifyLegacyAttributionBackup({
      backupPath,
      inventory: current,
      listArchive: () => "; valid",
    });
    expect(() =>
      buildLegacyAttributionCleanupCommand({
        inventory: current,
        backup,
        operationId: "00000000-0000-4000-8000-000000000901",
        retirementCommit: "16f2734",
        confirmation: "YES",
      }),
    ).toThrow("LEGACY_ATTRIBUTION_CONFIRMATION_REQUIRED");
    const input = {
      inventory: current,
      backup,
      operationId: "00000000-0000-4000-8000-000000000901",
      retirementCommit: "16f2734",
      confirmation: LEGACY_ATTRIBUTION_CLEANUP_CONFIRMATION,
    } as const;
    const first = buildLegacyAttributionCleanupCommand(input);
    expect(first).toMatchObject({
      expected_total: 0,
      expected_counts: Object.fromEntries(LEGACY_ATTRIBUTION_TABLES.map((table) => [table, 0])),
      hold_attestation: "NO_HOLDS",
      requested_at: backup.created_at,
    });
    expect(buildLegacyAttributionCleanupCommand(input)).toEqual(first);
  });

  it("redacts database credentials from public failure text", () => {
    expect(
      redactCleanupError(
        new Error("failed postgres://admin:password@127.0.0.1/db password=hunter2"),
      ),
    ).toBe("failed [REDACTED_DATABASE_URL] password=[REDACTED]");
  });
});
