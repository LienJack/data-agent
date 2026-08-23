import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseTurboBuildDryRun,
  projectRuntimeBuildIdentities,
  readWorkspaceBuildAttestation,
  verifyWorkspaceBuildAttestation,
} from "./lib/workspace-build-integrity.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type GuardedConsumerRole = "web" | "worker" | "relationship-indexer" | "semantic-authoring";

const rawCommandByRole: Readonly<
  Record<GuardedConsumerRole, { readonly command: "pnpm"; readonly args: readonly string[] }>
> = {
  web: {
    command: "pnpm",
    args: ["--filter", "@data-agent/web", "exec", "next", "dev", "--turbopack"],
  },
  worker: {
    command: "pnpm",
    args: [
      "--filter",
      "@data-agent/worker",
      "exec",
      "tsx",
      "watch",
      "--clear-screen=false",
      "src/run-worker-cli.ts",
    ],
  },
  "relationship-indexer": {
    command: "pnpm",
    args: [
      "--filter",
      "@data-agent/worker",
      "exec",
      "tsx",
      "watch",
      "--clear-screen=false",
      "src/semantic/relationship-indexer-cli.ts",
    ],
  },
  "semantic-authoring": {
    command: "pnpm",
    args: [
      "--filter",
      "@data-agent/worker",
      "exec",
      "tsx",
      "watch",
      "--clear-screen=false",
      "src/semantic/authoring-worker-cli.ts",
    ],
  },
};

function readRequiredPath(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || !isAbsolute(value)) {
    throw new Error(`DEV_WORKSPACE_BUILD_GUARD_MISSING:${name}`);
  }
  return value;
}

function assertPortableIdentity(role: GuardedConsumerRole, path: string, expected: unknown): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `DEV_WORKSPACE_BUILD_IDENTITY_INVALID:${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    JSON.stringify(Object.entries(parsed).sort()) !==
      JSON.stringify(Object.entries(expected as Record<string, unknown>).sort()) ||
    (parsed as { consumer_role?: unknown }).consumer_role !== role
  ) {
    throw new Error("DEV_WORKSPACE_BUILD_IDENTITY_INVALID");
  }
}

function verifyGuard(role: GuardedConsumerRole): void {
  const injectedRole = process.env.DATA_AGENT_RUNTIME_BUILD_CONSUMER_ROLE?.trim();
  if (!injectedRole) {
    throw new Error("DEV_WORKSPACE_BUILD_GUARD_MISSING:DATA_AGENT_RUNTIME_BUILD_CONSUMER_ROLE");
  }
  if (injectedRole !== role) {
    throw new Error("DEV_WORKSPACE_BUILD_CONSUMER_MISMATCH");
  }
  const attestation = readWorkspaceBuildAttestation(
    readRequiredPath("DATA_AGENT_BUILD_ATTESTATION_FILE"),
  );
  const identity = projectRuntimeBuildIdentities(attestation).find(
    (candidate) => candidate.consumer_role === role,
  );
  if (!identity) throw new Error("DEV_WORKSPACE_BUILD_CONSUMER_MISMATCH");
  const filters = [
    ...new Set(
      attestation.consumers.flatMap((consumer) =>
        consumer.package_tasks.map((task) => `--filter=${task.package_name}`),
      ),
    ),
  ].sort();
  const currentBuild = parseTurboBuildDryRun(
    JSON.parse(
      execFileSync("pnpm", ["turbo", "run", "build", "--dry=json", ...filters], {
        cwd: repositoryRoot,
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
      }),
    ),
  );
  verifyWorkspaceBuildAttestation({ repoRoot: repositoryRoot, attestation, currentBuild });
  assertPortableIdentity(
    role,
    readRequiredPath("DATA_AGENT_RUNTIME_BUILD_IDENTITY_FILE"),
    identity,
  );
}

async function main(
  role: GuardedConsumerRole | undefined,
  option: string | undefined,
): Promise<number> {
  if (!role || !(role in rawCommandByRole)) {
    throw new Error("DEV_WORKSPACE_BUILD_CONSUMER_INVALID");
  }
  if (option && option !== "--verify-only") {
    throw new Error("DEV_WORKSPACE_BUILD_GUARD_OPTION_INVALID");
  }
  verifyGuard(role);
  if (option === "--verify-only") return 0;
  const raw = rawCommandByRole[role];
  const child = spawn(raw.command, [...raw.args], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  return new Promise<number>((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      else resolveExit(code ?? 1);
    });
  });
}

void main(process.argv[2] as GuardedConsumerRole | undefined, process.argv[3])
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "DEV_WORKSPACE_BUILD_GUARD_FAILED");
    process.exitCode = 1;
  });
