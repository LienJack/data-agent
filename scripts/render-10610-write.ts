import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  renderSemanticMigrationCandidateFromSegments,
  defaultSemanticCandidatePaths,
} from "./render-semantic-migration.js";

const repoRoot = resolve(import.meta.dirname, "..");
const paths = defaultSemanticCandidatePaths(repoRoot);

console.log("渲染 10610 migration from:", paths.sourceDirectory);
console.log("目标路径:", paths.migrationPath);

const rendered = renderSemanticMigrationCandidateFromSegments(paths.sourceDirectory);
console.log(`checksum: ${rendered.checksum}`);
console.log(`content length: ${rendered.content.length} bytes`);

writeFileSync(paths.migrationPath, rendered.content);
console.log("✅ 10610 migration 已写入");
