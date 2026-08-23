import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseMigrationManifestRegistry,
  parseMigrationRendererRegistry,
  renderMigration,
  verifyMigration,
  writeMigration,
} from "../scripts/lib/migration-renderer.js";

const temporaryDirectories: string[] = [];
const ZERO = `sha256:${"0".repeat(64)}`;
const fixtureException = {
  id: "custom",
  renderer: "scripts/render-custom.ts",
  reason: "Fixture custom transformation.",
  verification_command: "pnpm exec tsx scripts/render-custom.ts --verify",
};

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "migration-renderer-"));
  temporaryDirectories.push(root);
  const sourceDirectory = resolve(root, "sources/100");
  const migrationDirectory = resolve(root, "infra/supabase/apps/data-agent/migrations");
  mkdirSync(sourceDirectory, { recursive: true });
  mkdirSync(migrationDirectory, { recursive: true });
  writeFileSync(resolve(sourceDirectory, "00-body.sql.inc"), "begin;\r\n");
  writeFileSync(
    resolve(sourceDirectory, "99-ledger.sql.inc"),
    "select '__FIXTURE_MIGRATION_CHECKSUM__';\ncommit;\n\n",
  );
  const registry = {
    schema_version: "migration-renderer-manifests@1.0.0",
    entries: [
      {
        id: "100",
        migration_name: "20260823000100_fixture.sql",
        source_directory: "sources/100",
        segments: ["00-body.sql.inc", "99-ledger.sql.inc"],
        placeholder: "__FIXTURE_MIGRATION_CHECKSUM__",
        checksum_header: "fixture_migration_checksum",
        postcondition: { checksum_occurrences: 2 },
      },
    ],
    exceptions: [fixtureException],
  };
  const manifest = parseMigrationManifestRegistry(JSON.stringify(registry))[0];
  if (!manifest) throw new Error("fixture manifest missing");
  return { root, sourceDirectory, manifest };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("generic migration renderer", () => {
  it("normalizes segments, generates the checksum header and verifies exact bytes", () => {
    const { root, manifest } = fixture();
    const normalized = `-- fixture_migration_checksum: ${ZERO}\nbegin;\nselect '${ZERO}';\ncommit;\n`;
    const checksum = `sha256:${createHash("sha256").update(normalized).digest("hex")}`;

    const rendered = renderMigration(manifest, root);
    expect(rendered.checksum).toBe(checksum);
    expect(rendered.content).toBe(
      `-- fixture_migration_checksum: ${checksum}\nbegin;\nselect '${checksum}';\ncommit;\n`,
    );

    writeMigration(manifest, root);
    expect(verifyMigration(manifest, root)).toEqual(rendered);
    expect(readFileSync(rendered.migrationPath, "utf8")).toBe(rendered.content);
  });

  it("fails closed on segment closure drift", () => {
    const { root, sourceDirectory, manifest } = fixture();
    writeFileSync(resolve(sourceDirectory, "20-unregistered.sql.inc"), "select 1;\n");
    expect(() => renderMigration(manifest, root)).toThrow("MIGRATION_SEGMENT_CLOSURE_DRIFT");
  });

  it("fails closed on missing or repeated placeholders", () => {
    const { root, sourceDirectory, manifest } = fixture();
    const ledger = resolve(sourceDirectory, "99-ledger.sql.inc");
    writeFileSync(ledger, "commit;\n");
    expect(() => renderMigration(manifest, root)).toThrow("MIGRATION_PLACEHOLDER_DRIFT");
    writeFileSync(
      ledger,
      "select '__FIXTURE_MIGRATION_CHECKSUM__', '__FIXTURE_MIGRATION_CHECKSUM__';\n",
    );
    expect(() => renderMigration(manifest, root)).toThrow("MIGRATION_PLACEHOLDER_DRIFT");
  });

  it("detects generated migration checksum or byte drift", () => {
    const { root, manifest } = fixture();
    const rendered = writeMigration(manifest, root);
    writeFileSync(rendered.migrationPath, `${rendered.content}-- drift\n`);
    expect(() => verifyMigration(manifest, root)).toThrow("MIGRATION_RENDER_DRIFT");
  });

  it("rejects unknown manifest fields and duplicate identities", () => {
    const { manifest } = fixture();
    expect(() =>
      parseMigrationManifestRegistry(
        JSON.stringify({
          schema_version: "migration-renderer-manifests@1.0.0",
          entries: [{ ...manifest, unknown: true }],
          exceptions: [fixtureException],
        }),
      ),
    ).toThrow();
    expect(() =>
      parseMigrationManifestRegistry(
        JSON.stringify({
          schema_version: "migration-renderer-manifests@1.0.0",
          entries: [manifest, manifest],
          exceptions: [fixtureException],
        }),
      ),
    ).toThrow("MIGRATION_MANIFEST_DUPLICATE_ID");
  });

  it("keeps every repository migration byte-identical and every custom renderer explained", () => {
    const repositoryRoot = resolve(import.meta.dirname, "..");
    const registry = parseMigrationRendererRegistry(
      readFileSync(resolve(repositoryRoot, "scripts/migration-manifests.json"), "utf8"),
    );
    expect(registry.entries).toHaveLength(82);
    for (const manifest of registry.entries) {
      expect(() => verifyMigration(manifest, repositoryRoot)).not.toThrow();
    }

    const actualCustomRenderers = readdirSync(resolve(repositoryRoot, "scripts"))
      .filter((name) => /^render-.+-migration\.ts$/.test(name) && name !== "render-migration.ts")
      .map((name) => `scripts/${name}`)
      .sort();
    expect(actualCustomRenderers).toEqual(
      registry.exceptions.map((exception) => exception.renderer).sort(),
    );
  });
});
