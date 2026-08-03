import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  defaultU6C2CandidatePaths,
  renderU6C2MigrationCandidateFromSegments,
} from "./render-u6-c2-migration.js";

const repoRoot = resolve(import.meta.dirname, "..");
const paths = defaultU6C2CandidatePaths(repoRoot);

console.log("渲染 10600 migration from:", paths.c2SourceDirectory);
console.log("目标路径:", paths.c2MigrationPath);

const rendered = renderU6C2MigrationCandidateFromSegments(paths.c2SourceDirectory);
console.log(`checksum: ${rendered.checksum}`);
console.log(`content length: ${rendered.content.length} bytes`);

writeFileSync(paths.c2MigrationPath, rendered.content);
console.log("✅ 10600 migration 已写入");
