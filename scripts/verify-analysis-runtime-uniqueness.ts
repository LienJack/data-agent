import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".py",
  ".sh",
  ".json",
  ".lock",
  ".yaml",
  ".yml",
]);
const forbidden = [
  ["Sandbox", "Program"].join(""),
  ["main", "(context)"].join(""),
  ["PYTHON", "_SANDBOX"].join(""),
  ["python", "-sandbox-client"].join(""),
  ["python", "_runtime"].join(""),
  ["declared", "_output_names"].join(""),
  ["output", "_base64"].join(""),
  ["createSingle", "StagePort"].join(""),
  "/workspace/outputs",
] as const;

function filesBelow(path: string): string[] {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) return [];
  const output: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const item = resolve(absolute, entry);
    if (statSync(item).isDirectory()) output.push(...filesBelow(relative(root, item)));
    else if (sourceExtensions.has(extname(item)) || entry.startsWith("Dockerfile.")) {
      output.push(item);
    }
  }
  return output;
}

function liveSourceRoots(parent: "apps" | "packages"): string[] {
  const absolute = resolve(root, parent);
  return readdirSync(absolute)
    .map((entry) => `${parent}/${entry}/src`)
    .filter((path) => existsSync(resolve(root, path)));
}

const files = [
  ...[...liveSourceRoots("apps"), ...liveSourceRoots("packages"), "services/sandbox/src"].flatMap(
    filesBelow,
  ),
  resolve(root, "compose.yaml"),
  resolve(root, "package.json"),
  ...filesBelow("infra/docker"),
];
const violations = files.flatMap((path) => {
  const source = readFileSync(path, "utf8");
  return forbidden
    .filter((value) => source.includes(value))
    .map((value) => ({ path: relative(root, path), value }));
});
const required = [
  "apps/worker/src/runs/opensandbox-analysis-runtime.ts",
  "packages/contracts/src/ports/analysis-sandbox.ts",
  "packages/contracts/src/ports/sandbox.ts",
  "packages/platform/src/sandbox/python-sql-sandbox.ts",
] as const;
const missing = required.filter((path) => !existsSync(resolve(root, path)));
if (violations.length > 0 || missing.length > 0) {
  process.stdout.write(
    `${JSON.stringify(
      {
        schema_version: "analysis-runtime-uniqueness@1.0.0",
        status: "FAILED",
        violations,
        missing,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `${JSON.stringify({
    schema_version: "analysis-runtime-uniqueness@1.0.0",
    status: "PASS",
    scanned_files: files.length,
    python_analysis_runtime: "OpenSandbox Cells",
    sql_sandbox_preserved: true,
  })}\n`,
);
