import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { connect } from "node:net";

export type NasEnvironment = Readonly<Record<string, string | undefined>>;

export interface NasRuntimeConfig {
  readonly sshHost: string;
  readonly projectDir: string;
  readonly postgresForwardPort: number;
  readonly neo4jHttpForwardPort: number;
  readonly neo4jBoltForwardPort: number;
  readonly webUrl: string;
}

const DEFAULT_NAS_PROJECT_DIR = "/vol1/1000/work/data-agent/current";
const REMOTE_POSTGRES_PORT = 55432;
const REMOTE_NEO4J_HTTP_PORT = 7474;
const REMOTE_NEO4J_BOLT_PORT = 7687;
function parseForwardPort(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined || value.trim() === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`NAS_FORWARD_PORT_INVALID:${name}`);
  }
  return parsed;
}

function validateSshHost(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._@:-]*$/.test(value) || value.startsWith("-")) {
    throw new Error("NAS_SSH_HOST_INVALID");
  }
  return value;
}

function validateProjectDir(value: string): string {
  if (!/^\/[A-Za-z0-9._/-]+$/.test(value) || value.split("/").includes("..")) {
    throw new Error("NAS_PROJECT_DIR_INVALID");
  }
  return value.replace(/\/$/, "");
}

function validateWebUrl(value: string): string {
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      throw new Error("invalid");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error("NAS_WEB_URL_INVALID");
  }
}

export function resolveNasRuntimeConfig(environment: NasEnvironment): NasRuntimeConfig {
  return {
    sshHost: validateSshHost(environment.DATA_AGENT_NAS_SSH_HOST?.trim() || "data-agent-nas"),
    projectDir: validateProjectDir(
      environment.DATA_AGENT_NAS_PROJECT_DIR?.trim() || DEFAULT_NAS_PROJECT_DIR,
    ),
    postgresForwardPort: parseForwardPort(
      environment.DATA_AGENT_NAS_POSTGRES_FORWARD_PORT,
      REMOTE_POSTGRES_PORT,
      "postgres",
    ),
    neo4jHttpForwardPort: parseForwardPort(
      environment.DATA_AGENT_NAS_NEO4J_HTTP_FORWARD_PORT,
      REMOTE_NEO4J_HTTP_PORT,
      "neo4j-http",
    ),
    neo4jBoltForwardPort: parseForwardPort(
      environment.DATA_AGENT_NAS_NEO4J_BOLT_FORWARD_PORT,
      REMOTE_NEO4J_BOLT_PORT,
      "neo4j-bolt",
    ),
    webUrl: validateWebUrl(
      environment.DATA_AGENT_NAS_WEB_URL?.trim() || "http://192.168.5.41:3001",
    ),
  };
}

function quotePosixShell(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function buildNasRemoteComposeCommand(
  config: NasRuntimeConfig,
  composeArgs: readonly string[],
  remoteEnvironment: Readonly<Record<string, string>> = {},
): string {
  const environment = Object.entries(remoteEnvironment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => quotePosixShell(`${key}=${value}`));
  const dockerCommand = `docker compose -f ${quotePosixShell("compose.yaml")} -f ${quotePosixShell("compose.nas.yaml")} ${composeArgs.map(quotePosixShell).join(" ")}`;
  const command =
    environment.length > 0 ? `env ${environment.join(" ")} ${dockerCommand}` : dockerCommand;
  return `cd ${quotePosixShell(config.projectDir)} && ${command}`;
}

export function buildNasSshTunnelArgs(config: NasRuntimeConfig): readonly string[] {
  return [
    "-N",
    "-o",
    "BatchMode=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "-L",
    `${config.postgresForwardPort}:127.0.0.1:${REMOTE_POSTGRES_PORT}`,
    "-L",
    `${config.neo4jHttpForwardPort}:127.0.0.1:${REMOTE_NEO4J_HTTP_PORT}`,
    "-L",
    `${config.neo4jBoltForwardPort}:127.0.0.1:${REMOTE_NEO4J_BOLT_PORT}`,
    config.sshHost,
  ];
}

export function buildNasRsyncArgs(
  config: NasRuntimeConfig,
  repositoryRoot: string,
): readonly string[] {
  const source = repositoryRoot.endsWith("/") ? repositoryRoot : `${repositoryRoot}/`;
  return [
    "-az",
    "--delete",
    "--exclude=.env",
    "--exclude=.env.local",
    "--exclude=.git/",
    "--exclude=.worktrees/",
    "--exclude=.trellis/",
    "--exclude=.data/",
    "--exclude=.next/",
    "--exclude=.turbo/",
    "--exclude=node_modules/",
    "--exclude=dist/",
    source,
    `${config.sshHost}:${config.projectDir}/`,
  ];
}

interface RemoteComposeOptions {
  readonly captureOutput?: boolean;
  readonly input?: string;
  readonly remoteEnvironment?: Readonly<Record<string, string>>;
}

export function runNasRemoteCompose(
  config: NasRuntimeConfig,
  composeArgs: readonly string[],
  options: RemoteComposeOptions = {},
): string {
  const captureOutput = options.captureOutput ?? false;
  const result = spawnSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      config.sshHost,
      buildNasRemoteComposeCommand(config, composeArgs, options.remoteEnvironment),
    ],
    {
      encoding: "utf8",
      input: options.input,
      stdio: captureOutput
        ? ["pipe", "pipe", "inherit"]
        : options.input === undefined
          ? "inherit"
          : ["pipe", "inherit", "inherit"],
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`NAS_REMOTE_COMPOSE_FAILED:${result.status ?? "signal"}`);
  }
  return captureOutput ? result.stdout : "";
}

export function syncNasDeployment(config: NasRuntimeConfig, repositoryRoot: string): void {
  const result = spawnSync("rsync", [...buildNasRsyncArgs(config, repositoryRoot)], {
    cwd: repositoryRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`NAS_SOURCE_SYNC_FAILED:${result.status ?? "signal"}`);
  }
}

export function switchNasToInfrastructure(config: NasRuntimeConfig): void {
  const applicationServices = ["web", "worker", "relationship-indexer", "clamav"];
  runNasRemoteCompose(config, ["--profile", "deploy", "stop", ...applicationServices]);
  runNasRemoteCompose(config, ["--profile", "deploy", "rm", "-f", ...applicationServices]);
  runNasRemoteCompose(config, ["up", "-d", "--wait", "postgres", "neo4j"]);
}

export function runNasMigration(config: NasRuntimeConfig): void {
  runNasRemoteCompose(config, ["up", "-d", "--wait", "postgres"]);
  runNasRemoteCompose(config, ["--profile", "migrate", "run", "--rm", "migration"]);
}

export function runNasProduction(
  config: NasRuntimeConfig,
  provenance: Readonly<{ gitCommit: string; gitDirty: string }>,
): void {
  runNasRemoteCompose(config, ["--profile", "deploy", "up", "--build", "-d", "--wait"], {
    remoteEnvironment: {
      DATA_AGENT_GIT_COMMIT: provenance.gitCommit,
      DATA_AGENT_GIT_DIRTY: provenance.gitDirty,
    },
  });
}

export function stopNasProduction(config: NasRuntimeConfig): void {
  runNasRemoteCompose(config, ["--profile", "deploy", "down"]);
}

export function readNasComposeStates(config: NasRuntimeConfig): string {
  return runNasRemoteCompose(config, ["ps", "--format", "json", "postgres", "neo4j"], {
    captureOutput: true,
  });
}

export function runNasPostgresCommand(
  config: NasRuntimeConfig,
  postgresArgs: readonly string[],
  input?: string,
): string {
  return runNasRemoteCompose(config, ["exec", "-T", "postgres", "psql", ...postgresArgs], {
    captureOutput: true,
    input,
  });
}

export function startNasSshTunnel(config: NasRuntimeConfig): ChildProcess {
  return spawn("ssh", [...buildNasSshTunnelArgs(config)], {
    detached: true,
    stdio: "inherit",
  });
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

async function canReachPostgresThroughTunnel(port: number): Promise<boolean> {
  return new Promise<boolean>((resolveProbe) => {
    const socket = connect({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveProbe(reachable);
    };
    socket.setTimeout(500);
    socket.once("connect", () => {
      const sslRequest = Buffer.alloc(8);
      sslRequest.writeInt32BE(8, 0);
      sslRequest.writeInt32BE(80_877_103, 4);
      socket.write(sslRequest);
    });
    socket.once("data", (chunk: Buffer) => finish(chunk[0] === 0x53 || chunk[0] === 0x4e));
    socket.once("timeout", () => finish(false));
    socket.once("end", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export async function waitForNasSshTunnel(
  child: ChildProcess,
  config: NasRuntimeConfig,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const ports = [
    config.postgresForwardPort,
    config.neo4jHttpForwardPort,
    config.neo4jBoltForwardPort,
  ];
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("NAS_SSH_TUNNEL_EXITED");
    }
    const listenersReady = (await Promise.all(ports.map(isPortListening))).every(Boolean);
    if (listenersReady && (await canReachPostgresThroughTunnel(config.postgresForwardPort))) {
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 50));
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error("NAS_SSH_TUNNEL_EXITED");
      }
      return;
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("NAS_SSH_TUNNEL_NOT_READY");
}

export function stopNasSshTunnel(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      // Fall through to the direct child signal when a process group is unavailable.
    }
  }
  child.kill("SIGTERM");
}
