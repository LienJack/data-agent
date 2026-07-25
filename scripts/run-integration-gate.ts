import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  discoverWorkspaceModules,
  normalizeWorkspaceFilter,
} from "./lib/workspace-architecture.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const workspaceModules = discoverWorkspaceModules(repoRoot);

function parseFilter(args: readonly string[]): string | undefined {
  if (args.length === 0) {
    return undefined;
  }
  if (args.length === 1 && args[0]?.startsWith("--filter=")) {
    return args[0].slice("--filter=".length);
  }
  if (args.length === 2 && args[0] === "--filter" && args[1]) {
    return args[1];
  }
  throw new Error("test:integration 仅接受一个 --filter 参数。");
}

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const requestedFilter = parseFilter(process.argv.slice(2));
const filters = requestedFilter
  ? [normalizeWorkspaceFilter(requestedFilter, workspaceModules)]
  : ["@data-agent/agent-runtime", "@data-agent/platform"];

for (const filter of filters) {
  switch (filter) {
    case "@data-agent/agent-runtime":
      run("pnpm", ["--filter", filter, "test:integration"]);
      break;
    case "@data-agent/platform":
      run(fileURLToPath(new URL("./test-platform-integration.sh", import.meta.url)), []);
      break;
    default:
      throw new Error(`test:integration 尚未为 ${filter} 注册严格执行器。`);
  }
}
