import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  migrationSummary,
  parseMigrationManifestRegistry,
  verifyMigration,
  writeMigration,
} from "./lib/migration-renderer.js";

const repositoryRoot = resolve(import.meta.dirname, "..");
const manifests = parseMigrationManifestRegistry(
  readFileSync(resolve(import.meta.dirname, "migration-manifests.json"), "utf8"),
);
const arguments_ = process.argv.slice(2);
const verify = arguments_.includes("--verify");
const target = arguments_.find((argument) => argument !== "--verify");

if (target === "list") {
  for (const manifest of manifests) process.stdout.write(`${manifest.id}\n`);
  process.exit(0);
}

const selected =
  target === "--all" ? manifests : manifests.filter((manifest) => manifest.id === target);
if (!target || selected.length === 0) {
  throw new Error(
    `MIGRATION_MANIFEST_NOT_FOUND: ${target ?? "<missing>"}; use render-migration.ts list`,
  );
}

for (const manifest of selected) {
  const rendered = verify
    ? verifyMigration(manifest, repositoryRoot)
    : writeMigration(manifest, repositoryRoot);
  process.stdout.write(
    `${verify ? "verified" : "written"} ${migrationSummary(manifest, rendered)}\n`,
  );
}
