import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  discoverWorkspaceModules,
  normalizeWorkspaceFilter,
} from "./lib/workspace-architecture.js";

const [task, ...rawArgs] = process.argv.slice(2);

if (!task) {
  process.stderr.write("缺少 Turbo Task 名称。\n");
  process.exit(64);
}

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const workspaceModules = discoverWorkspaceModules(repoRoot);
const args = rawArgs.map((arg, index) => {
  const previous = rawArgs[index - 1];
  if (previous === "--filter" || arg.startsWith("--filter=")) {
    const value = arg.startsWith("--filter=") ? arg.slice("--filter=".length) : arg;
    const normalized = normalizeWorkspaceFilter(value, workspaceModules);
    return arg.startsWith("--filter=") ? `--filter=${normalized}` : normalized;
  }
  return arg;
});

const result = spawnSync("pnpm", ["exec", "turbo", "run", task, ...args], {
  stdio: "inherit",
});

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
