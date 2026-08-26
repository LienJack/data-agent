import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type MigrationSource,
  verifyMigrationInventory,
} from "../scripts/lib/workspace-migration-inventory.js";

const ZERO = `sha256:${"0".repeat(64)}`;
const migrationDirectory = resolve(
  import.meta.dirname,
  "../infra/supabase/apps/data-agent/migrations",
);

function migration(stem: string): MigrationSource {
  const zeroed = `-- fixture_migration_checksum: ${ZERO}\nbegin;\nselect platform.assert_migration_checksum(\n  'app',\n  '00000000-0000-4000-8000-00000000da01'::uuid,\n  '${stem}',\n  '${ZERO}'\n);\ncommit;\n`;
  const checksum = `sha256:${createHash("sha256").update(zeroed).digest("hex")}`;
  return { name: `${stem}.sql`, sql: zeroed.split(ZERO).join(checksum) };
}

describe("workspace migration identity inventory", () => {
  it("accepts the repository inventory and exposes the actual migration frontier", () => {
    const result = verifyMigrationInventory(
      readdirSync(migrationDirectory)
        .filter((name) => name.endsWith(".sql"))
        .map((name) => ({ name, sql: readFileSync(resolve(migrationDirectory, name), "utf8") })),
    );

    expect(result.violations).toEqual([]);
    expect(result.frontier).toBe("20260725010769");
    expect(result.nextSequence).toBe("20260725010770");
  });

  it("rejects a new duplicate 14 digit sequence", () => {
    const result = verifyMigrationInventory([
      migration("20260725010703_first"),
      migration("20260725010703_second"),
    ]);

    expect(result.violations).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_SEQUENCE" }),
    );
  });

  it("rejects filename and ledger declaration stem drift", () => {
    const valid = migration("20260725010703_expected");
    const result = verifyMigrationInventory([
      { ...valid, sql: valid.sql.replace("20260725010703_expected", "20260725010703_other") },
    ]);

    expect(result.violations).toContainEqual(
      expect.objectContaining({ code: "STEM_DECLARATION_MISMATCH" }),
    );
  });

  it("rejects a new migration without a checksum header", () => {
    const valid = migration("20260725010703_missing_checksum");
    const result = verifyMigrationInventory([{ ...valid, sql: valid.sql.replace(/^-- .*\n/, "") }]);

    expect(result.violations).toContainEqual(
      expect.objectContaining({ code: "CHECKSUM_HEADER_MISSING" }),
    );
  });
});
