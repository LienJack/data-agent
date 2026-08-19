import { type ChildProcess, execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000001";
const LOCAL_TENANT_ID = "00000000-0000-4000-8000-000000000002";
const LOCAL_PRINCIPAL_ID = "00000000-0000-4000-8000-000000000003";

const LOCAL_DEFAULTS = Object.freeze({
  DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:5432/data_agent",
  SEMANTIC_GOVERNANCE_BACKEND: "postgres",
  SEMANTIC_EXPLORER_ENABLED: "true",
  SEMANTIC_DEPLOYMENT_ID: LOCAL_DEPLOYMENT_ID,
  WORKSPACE_DEPLOYMENT_ID: LOCAL_DEPLOYMENT_ID,
  BETTER_AUTH_SECRET: "data-agent-local-development-secret-change-me",
  BETTER_AUTH_URL: "http://localhost:3000",
  DATA_AGENT_ECOMMERCE_HOST: "127.0.0.1",
  DATA_AGENT_ECOMMERCE_PORT: "5432",
  DATA_AGENT_ECOMMERCE_DATABASE: "data_agent",
  DATA_AGENT_ECOMMERCE_READER_PASSWORD: "data-agent-ecommerce-demo-change-me",
  SEMANTIC_TENANT_ID: LOCAL_TENANT_ID,
  SEMANTIC_PRINCIPAL_ID: LOCAL_PRINCIPAL_ID,
  SEMANTIC_ALLOWED_DOMAINS: "revenue,customer,marketing,sales,ecommerce",
  SEMANTIC_RELATIONSHIP_INDEX_ENABLED: "true",
  SEMANTIC_RELATIONSHIP_DOMAINS: "sales,ecommerce",
  SEMANTIC_RELATIONSHIP_INDEX_HEALTH_PORT: "9090",
  WORKER_DEPLOYMENT_ID: LOCAL_DEPLOYMENT_ID,
  WORKER_TENANT_ID: LOCAL_TENANT_ID,
  WORKER_PRINCIPAL_ID: LOCAL_PRINCIPAL_ID,
  WORKER_ID: "worker-local",
  SEMANTIC_AUTHORING_WORKER_ID: "semantic-authoring-worker-local",
  WORKER_HEALTH_PORT: "9091",
  NEO4J_URI: "bolt://127.0.0.1:7687",
  NEO4J_USERNAME: "neo4j",
  NEO4J_PASSWORD: "data-agent-neo4j",
  NEO4J_DATABASE: "neo4j",
  TEST_CENTER_TENANT_ID: LOCAL_TENANT_ID,
  TEST_CENTER_PRINCIPAL_ID: LOCAL_PRINCIPAL_ID,
  TEST_CENTER_ENVIRONMENT: "local",
});

type EnvironmentLayer = Readonly<Record<string, string | undefined>>;

interface LocalSuperadminSyncResult {
  readonly terminal: "SUCCEEDED" | "SKIPPED" | "HOLD";
  readonly reason_code: string;
  readonly principal_id?: string;
  readonly workspace_id?: string;
}

export function isLocalSuperadminSyncEnabled(environment: EnvironmentLayer): boolean {
  return environment.DATA_AGENT_LOCAL_SUPERADMIN_SYNC?.trim() === "YES";
}

export function applyLocalSuperadminAuthority(
  environment: NodeJS.ProcessEnv,
  result: LocalSuperadminSyncResult,
): NodeJS.ProcessEnv {
  if (result.terminal !== "SUCCEEDED" || !result.principal_id || !result.workspace_id) {
    return environment;
  }
  return {
    ...environment,
    SEMANTIC_TENANT_ID: result.workspace_id,
    SEMANTIC_PRINCIPAL_ID: result.principal_id,
    WORKER_TENANT_ID: result.workspace_id,
    WORKER_PRINCIPAL_ID: result.principal_id,
    TEST_CENTER_TENANT_ID: result.workspace_id,
    TEST_CENTER_PRINCIPAL_ID: result.principal_id,
  };
}

export function mergeLocalDevelopmentEnvironment(
  input: Readonly<{
    processEnvironment?: EnvironmentLayer;
    dotenv?: EnvironmentLayer;
    dotenvLocal?: EnvironmentLayer;
  }> = {},
): NodeJS.ProcessEnv {
  const merged: Record<string, string> = { ...LOCAL_DEFAULTS };
  for (const layer of [input.dotenv, input.dotenvLocal, input.processEnvironment]) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  if (!merged.DEEPSEEK_API_KEY && merged.DeepSeekAPIKey) {
    merged.DEEPSEEK_API_KEY = merged.DeepSeekAPIKey;
  }
  if (!merged.MOONSHOT_API_KEY && merged.KimiAPIKey) {
    merged.MOONSHOT_API_KEY = merged.KimiAPIKey;
  }
  merged.WORKER_DEPLOYMENT_ID ||= merged.SEMANTIC_DEPLOYMENT_ID ?? LOCAL_DEPLOYMENT_ID;
  merged.WORKSPACE_DEPLOYMENT_ID ||= merged.SEMANTIC_DEPLOYMENT_ID ?? LOCAL_DEPLOYMENT_ID;
  merged.WORKER_TENANT_ID ||= merged.SEMANTIC_TENANT_ID ?? LOCAL_TENANT_ID;
  merged.WORKER_PRINCIPAL_ID ||= merged.SEMANTIC_PRINCIPAL_ID ?? LOCAL_PRINCIPAL_ID;
  return merged;
}

function readEnvironmentFile(path: string): Record<string, string> {
  return existsSync(path) ? parseEnv(readFileSync(path, "utf8")) : {};
}

function loadLocalDevelopmentEnvironment(): NodeJS.ProcessEnv {
  return mergeLocalDevelopmentEnvironment({
    dotenv: readEnvironmentFile(resolve(REPOSITORY_ROOT, ".env")),
    dotenvLocal: readEnvironmentFile(resolve(REPOSITORY_ROOT, ".env.local")),
    processEnvironment: process.env,
  });
}

export interface LocalApplicationProcessSpec {
  readonly name: "web" | "worker" | "indexer" | "semantic-authoring";
  readonly command: "pnpm";
  readonly args: readonly string[];
}

export function buildLocalApplicationProcessSpecs(): readonly LocalApplicationProcessSpec[] {
  return [
    {
      name: "web",
      command: "pnpm",
      args: ["--filter", "@data-agent/web", "dev"],
    },
    {
      name: "worker",
      command: "pnpm",
      args: ["--filter", "@data-agent/worker", "dev"],
    },
    {
      name: "indexer",
      command: "pnpm",
      args: ["--filter", "@data-agent/worker", "dev:indexer"],
    },
    {
      name: "semantic-authoring",
      command: "pnpm",
      args: ["--filter", "@data-agent/worker", "dev:semantic-authoring"],
    },
  ];
}

function runCommand(command: string, args: readonly string[], environment = process.env): void {
  const result = spawnSync(command, [...args], {
    cwd: REPOSITORY_ROOT,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`COMMAND_FAILED:${command}:${result.status ?? "signal"}`);
  }
}

function runOptionalLocalSuperadminSync(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!isLocalSuperadminSyncEnabled(environment)) return environment;
  const result = spawnSync("pnpm", ["exec", "tsx", "apps/web/src/cli/local-superadmin-sync.ts"], {
    cwd: REPOSITORY_ROOT,
    env: environment,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  let parsed: LocalSuperadminSyncResult;
  try {
    parsed = JSON.parse(result.stdout) as LocalSuperadminSyncResult;
  } catch {
    throw new Error("DEV_SUPERADMIN_SYNC_RESULT_INVALID");
  }
  if (result.status !== 0 || parsed.terminal !== "SUCCEEDED") {
    throw new Error(parsed.reason_code || "DEV_SUPERADMIN_SYNC_FAILED");
  }
  console.info(`Local superadmin sync: ${parsed.reason_code}`);
  return applyLocalSuperadminAuthority(environment, parsed);
}

interface ComposeContainerState {
  readonly Service?: string;
  readonly State?: string;
  readonly Health?: string;
}

function parseJsonLines<T>(value: string): readonly T[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function assertDatabaseContainersHealthy(): void {
  const output = execFileSync(
    "docker",
    ["compose", "ps", "--format", "json", "postgres", "neo4j"],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  );
  const states = parseJsonLines<ComposeContainerState>(output);
  for (const service of ["postgres", "neo4j"] as const) {
    const state = states.find((candidate) => candidate.Service === service);
    if (state?.State !== "running" || state.Health !== "healthy") {
      throw new Error(`DEV_DATABASE_NOT_HEALTHY:${service}`);
    }
  }
}

interface ExpectedMigration {
  readonly owner_kind: "platform" | "app";
  readonly app_id: string | null;
  readonly migration_version: string;
  readonly migration_checksum: string;
}

const MIGRATION_CALL_PATTERN =
  /platform\.assert_migration_checksum\(\s*'(platform|app)'\s*,\s*(null|'([0-9a-f-]{36})'::uuid)\s*,\s*'([0-9]{14}_[a-z][a-z0-9_]{1,96})'\s*,\s*'(sha256:[0-9a-f]{64})'\s*\)/g;

export function readExpectedMigrations(
  repositoryRoot: string = REPOSITORY_ROOT,
): readonly ExpectedMigration[] {
  const directories = [
    resolve(repositoryRoot, "infra/supabase/platform/migrations"),
    resolve(repositoryRoot, "infra/supabase/apps/data-agent/migrations"),
  ];
  const migrations: ExpectedMigration[] = [];
  for (const directory of directories) {
    for (const filename of readdirSync(directory)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      const source = readFileSync(resolve(directory, filename), "utf8");
      const matches = [...source.matchAll(MIGRATION_CALL_PATTERN)];
      if (matches.length !== 1) {
        throw new Error(`MIGRATION_LEDGER_DECLARATION_INVALID:${filename}:${matches.length}`);
      }
      const match = matches[0];
      const ownerKind = match?.[1];
      const migrationVersion = match?.[4];
      const migrationChecksum = match?.[5];
      if (
        (ownerKind !== "platform" && ownerKind !== "app") ||
        !migrationVersion ||
        !migrationChecksum ||
        `${migrationVersion}.sql` !== filename
      ) {
        throw new Error(`MIGRATION_LEDGER_DECLARATION_INVALID:${filename}`);
      }
      migrations.push({
        owner_kind: ownerKind,
        app_id: ownerKind === "app" ? (match?.[3] ?? null) : null,
        migration_version: migrationVersion,
        migration_checksum: migrationChecksum,
      });
    }
  }
  return migrations;
}

function readMigrationLedger(): Map<string, string> {
  const output = execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-X",
      "-A",
      "-t",
      "-F",
      "|",
      "-U",
      "postgres",
      "-d",
      "data_agent",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "select owner_kind, coalesce(app_id::text, ''), migration_version, migration_checksum from platform.migration_ledger order by owner_kind, app_id, migration_version",
    ],
    { cwd: REPOSITORY_ROOT, encoding: "utf8" },
  );
  const ledger = new Map<string, string>();
  for (const line of output
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)) {
    const [ownerKind, appId, version, checksum] = line.split("|");
    if (!ownerKind || appId === undefined || !version || !checksum) {
      throw new Error("MIGRATION_LEDGER_RESULT_INVALID");
    }
    ledger.set(`${ownerKind}|${appId}|${version}`, checksum);
  }
  return ledger;
}

function assertMigrationLedgerCurrent(): void {
  const expected = readExpectedMigrations();
  const ledger = readMigrationLedger();
  const failures: string[] = [];
  for (const migration of expected) {
    const key = `${migration.owner_kind}|${migration.app_id ?? ""}|${migration.migration_version}`;
    const actual = ledger.get(key);
    if (actual !== migration.migration_checksum) {
      failures.push(`${migration.migration_version}:${actual ? "CHECKSUM_MISMATCH" : "MISSING"}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`DEV_MIGRATIONS_NOT_READY:${failures.join(",")}\nRun: pnpm dev:migrate`);
  }
}

function assertAuthorityMapping(environment: NodeJS.ProcessEnv): void {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-X",
      "-A",
      "-t",
      "-U",
      "postgres",
      "-d",
      "data_agent",
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      `deployment_id=${environment.WORKER_DEPLOYMENT_ID ?? ""}`,
      "-v",
      `tenant_id=${environment.WORKER_TENANT_ID ?? ""}`,
      "-v",
      `principal_id=${environment.WORKER_PRINCIPAL_ID ?? ""}`,
    ],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      input:
        "select count(*) from platform.resolve_backend_authority(:'deployment_id'::uuid, :'tenant_id'::uuid, :'principal_id'::uuid, true);\n",
    },
  );
  if (result.status !== 0 || result.stdout.trim() !== "1") {
    throw new Error("DEV_AUTHORITY_MAPPING_NOT_READY");
  }
}

async function isPortListening(port: number): Promise<boolean> {
  return new Promise<boolean>((resolvePort) => {
    const socket = connect({ host: "127.0.0.1", port });
    const finish = (listening: boolean) => {
      socket.destroy();
      resolvePort(listening);
    };
    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function assertApplicationPortsFree(): Promise<void> {
  for (const [name, port] of [
    ["web", 3000],
    ["relationship-indexer", 9090],
    ["worker", 9091],
  ] as const) {
    if (await isPortListening(port)) {
      throw new Error(`DEV_PORT_IN_USE:${name}:${port}`);
    }
  }
}

function assertNoExistingNextDevelopmentProcess(): void {
  const lockPath = resolve(REPOSITORY_ROOT, "apps/web/.next/dev/lock");
  if (!existsSync(lockPath)) return;
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
      readonly pid?: unknown;
      readonly port?: unknown;
    };
    if (!Number.isSafeInteger(lock.pid) || Number(lock.pid) <= 0) return;
    try {
      process.kill(Number(lock.pid), 0);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ESRCH"
      ) {
        return;
      }
      throw error;
    }
    throw new Error(`DEV_NEXT_PROCESS_ALREADY_RUNNING:${String(lock.pid)}:${String(lock.port)}`);
  } catch (error) {
    if (error instanceof SyntaxError) return;
    throw error;
  }
}

async function runDevelopmentCheck(environment: NodeJS.ProcessEnv): Promise<void> {
  assertDatabaseContainersHealthy();
  assertMigrationLedgerCurrent();
  assertAuthorityMapping(environment);
  assertNoExistingNextDevelopmentProcess();
  await assertApplicationPortsFree();
  console.info("Development readiness passed: databases, migrations, authority, and ports.");
}

function stopChildren(children: readonly ChildProcess[]): void {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
}

async function superviseApplications(
  specs: readonly LocalApplicationProcessSpec[],
  environment: NodeJS.ProcessEnv,
): Promise<number> {
  const children = specs.map((spec) =>
    spawn(spec.command, [...spec.args], {
      cwd: REPOSITORY_ROOT,
      env: environment,
      stdio: "inherit",
    }),
  );
  let stopping = false;
  let exitCode = 0;
  const stop = () => {
    stopping = true;
    stopChildren(children);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await new Promise<void>((resolveGroup) => {
      let remaining = children.length;
      const completed = () => {
        remaining -= 1;
        if (remaining === 0) resolveGroup();
      };
      children.forEach((child) => {
        child.once("error", () => {
          if (!stopping) {
            exitCode = 1;
            stop();
          }
        });
        child.once("exit", (code, signal) => {
          if (!stopping) {
            exitCode = code && code > 0 ? code : 1;
            console.error(
              `Local application exited unexpectedly: code=${code ?? "null"} signal=${signal ?? "none"}`,
            );
            stop();
          }
          completed();
        });
      });
    });
    return exitCode;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

function selectApplicationSpecs(
  command: "apps" | LocalApplicationProcessSpec["name"],
): readonly LocalApplicationProcessSpec[] {
  const specs = buildLocalApplicationProcessSpecs();
  return command === "apps" ? specs : specs.filter((spec) => spec.name === command);
}

type RuntimeCommand =
  | "dev"
  | "infra"
  | "migrate"
  | "check"
  | "apps"
  | "web"
  | "worker"
  | "indexer"
  | "semantic-authoring"
  | "docker-migrate"
  | "docker-up"
  | "docker-down";

async function main(command: RuntimeCommand | undefined): Promise<number> {
  let environment = loadLocalDevelopmentEnvironment();
  switch (command) {
    case "infra":
      runCommand(
        "docker",
        ["compose", "--profile", "deploy", "stop", "web", "worker", "relationship-indexer"],
        environment,
      );
      runCommand(
        "docker",
        ["compose", "--profile", "deploy", "rm", "-f", "web", "worker", "relationship-indexer"],
        environment,
      );
      runCommand("docker", ["compose", "up", "-d", "--wait", "postgres", "neo4j"], environment);
      return 0;
    case "migrate":
      await main("infra");
      runCommand(
        "docker",
        ["compose", "--profile", "migrate", "run", "--rm", "migration"],
        environment,
      );
      assertMigrationLedgerCurrent();
      return 0;
    case "check":
      await runDevelopmentCheck(environment);
      return 0;
    case "dev":
      await main("infra");
      // Admin sync depends on the newest governed SQL surface. Keep the
      // existing migration-ledger diagnostic ahead of any optional write so a
      // stale local database still receives the actionable migrate message.
      assertMigrationLedgerCurrent();
      environment = runOptionalLocalSuperadminSync(environment);
      await runDevelopmentCheck(environment);
      return superviseApplications(buildLocalApplicationProcessSpecs(), environment);
    case "apps":
    case "web":
    case "worker":
    case "indexer":
    case "semantic-authoring":
      return superviseApplications(selectApplicationSpecs(command), environment);
    case "docker-migrate":
      runCommand("docker", ["compose", "up", "-d", "--wait", "postgres"], environment);
      runCommand(
        "docker",
        ["compose", "--profile", "migrate", "run", "--rm", "migration"],
        environment,
      );
      assertMigrationLedgerCurrent();
      return 0;
    case "docker-up":
      runCommand(
        "docker",
        ["compose", "--profile", "deploy", "up", "--build", "-d", "--wait"],
        environment,
      );
      return 0;
    case "docker-down":
      runCommand("docker", ["compose", "--profile", "deploy", "down"], environment);
      return 0;
    default:
      console.error(
        "Usage: local-dev-runtime.ts <dev|infra|migrate|check|apps|web|worker|indexer|semantic-authoring|docker-migrate|docker-up|docker-down>",
      );
      return 2;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  void main(process.argv[2] as RuntimeCommand | undefined)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "LOCAL_RUNTIME_FAILED");
      process.exitCode = 1;
    });
}
