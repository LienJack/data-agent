import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverWorkspaceModules,
  resolveWorkspaceConsumerDependencies,
} from "./lib/workspace-architecture.js";
import {
  createWorkspaceBuildAttestation,
  nodeWorkspaceBuildFilesystem,
  parseTurboBuildDryRun,
  projectRuntimeBuildIdentities,
  type RuntimeBuildConsumerRole,
  type TurboBuildDryRun,
  verifyWorkspaceBuildAttestation,
  writeWorkspaceBuildAttestation,
} from "./lib/workspace-build-integrity.js";

const roleDescriptors = Object.freeze({
  web: { consumerRole: "web", moduleName: "@data-agent/web" },
  worker: { consumerRole: "worker", moduleName: "@data-agent/worker" },
  "relationship-indexer": {
    consumerRole: "relationship-indexer",
    moduleName: "@data-agent/worker",
  },
  "semantic-authoring": {
    consumerRole: "semantic-authoring",
    moduleName: "@data-agent/worker",
  },
} satisfies Readonly<
  Record<
    RuntimeBuildConsumerRole,
    { readonly consumerRole: RuntimeBuildConsumerRole; readonly moduleName: string }
  >
>);

export interface WorkspaceReleaseBuildReceipt {
  readonly schema_version: "workspace-release-build-integrity@1.0.0";
  readonly status: "PASS";
  readonly generation_id: `sha256:${string}`;
  readonly consumers: readonly {
    readonly consumer_role: RuntimeBuildConsumerRole;
    readonly build_id: `sha256:${string}`;
    readonly identity_file: string;
  }[];
}

export function parseManagedBuildProvenance(
  input: Readonly<{
    gitCommit: string | undefined;
    gitDirty: string | undefined;
  }>,
): Readonly<{ gitCommit: string; gitDirty: boolean }> {
  const gitCommit = input.gitCommit?.trim();
  if (!gitCommit || !/^[a-f0-9]{7,64}$/.test(gitCommit)) {
    throw new Error("RELEASE_BUILD_GIT_COMMIT_INVALID");
  }
  if (input.gitDirty !== "true" && input.gitDirty !== "false") {
    throw new Error("RELEASE_BUILD_GIT_DIRTY_INVALID");
  }
  return Object.freeze({ gitCommit, gitDirty: input.gitDirty === "true" });
}

function readTurboBuildDryRun(repoRoot: string, moduleNames: readonly string[]): TurboBuildDryRun {
  const filters = [...new Set(moduleNames)].sort().map((name) => `--filter=${name}...`);
  const output = execFileSync("pnpm", ["turbo", "run", "build", "--dry=json", ...filters], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return parseTurboBuildDryRun(JSON.parse(output));
}

export function attestWorkspaceReleaseBuild(
  input: Readonly<{
    repoRoot: string;
    outputDirectory: string;
    roles: readonly RuntimeBuildConsumerRole[];
    gitCommit: string;
    gitDirty: boolean;
    builtAt?: string;
    currentBuild?: TurboBuildDryRun;
  }>,
): WorkspaceReleaseBuildReceipt {
  const roles = [...new Set(input.roles)].sort();
  if (roles.length === 0 || roles.length !== input.roles.length) {
    throw new Error("RELEASE_BUILD_CONSUMER_INVALID");
  }
  const descriptors = roles.map((role) => roleDescriptors[role]);
  if (descriptors.some((descriptor) => !descriptor)) {
    throw new Error("RELEASE_BUILD_CONSUMER_INVALID");
  }
  const modules = discoverWorkspaceModules(input.repoRoot);
  const resolutions = resolveWorkspaceConsumerDependencies(
    modules,
    descriptors.map((descriptor) => ({
      consumerId: descriptor.consumerRole,
      moduleName: descriptor.moduleName,
    })),
  );
  const currentBuild =
    input.currentBuild ??
    readTurboBuildDryRun(
      input.repoRoot,
      descriptors.map((descriptor) => descriptor.moduleName),
    );
  const attestation = createWorkspaceBuildAttestation({
    repoRoot: input.repoRoot,
    beforeBuild: currentBuild,
    afterBuild: currentBuild,
    consumers: descriptors.map((descriptor) => {
      const resolution = resolutions.find(
        (candidate) => candidate.consumerId === descriptor.consumerRole,
      );
      if (!resolution) throw new Error("RELEASE_BUILD_GRAPH_INVALID");
      return {
        consumerRole: descriptor.consumerRole,
        packageNames: [descriptor.moduleName, ...resolution.dependencyNames],
      };
    }),
    builtAt: input.builtAt ?? new Date().toISOString(),
    gitCommit: input.gitCommit,
    gitDirty: input.gitDirty,
  });
  verifyWorkspaceBuildAttestation({
    repoRoot: input.repoRoot,
    attestation,
    currentBuild,
  });

  const outputDirectory = resolve(input.outputDirectory);
  writeWorkspaceBuildAttestation(resolve(outputDirectory, "attestation.json"), attestation);
  const identities = projectRuntimeBuildIdentities(attestation);
  for (const identity of identities) {
    nodeWorkspaceBuildFilesystem.writeTextAtomically(
      resolve(outputDirectory, `${identity.consumer_role}.json`),
      `${JSON.stringify(identity, null, 2)}\n`,
    );
  }
  return Object.freeze({
    schema_version: "workspace-release-build-integrity@1.0.0",
    status: "PASS",
    generation_id: attestation.generation_id,
    consumers: identities.map((identity) => ({
      consumer_role: identity.consumer_role,
      build_id: identity.build_id,
      identity_file: `${identity.consumer_role}.json`,
    })),
  });
}

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function main(): void {
  const provenance = parseManagedBuildProvenance({
    gitCommit: option("git-commit"),
    gitDirty: option("git-dirty"),
  });
  const outputDirectory = option("output");
  const rawRoles = option("roles");
  if (!outputDirectory || !rawRoles) throw new Error("RELEASE_BUILD_OPTION_MISSING");
  const roles = rawRoles.split(",") as RuntimeBuildConsumerRole[];
  const receipt = attestWorkspaceReleaseBuild({
    repoRoot: resolve(fileURLToPath(new URL("../", import.meta.url))),
    outputDirectory,
    roles,
    ...provenance,
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "RELEASE_BUILD_FAILED"}\n`);
    process.exitCode = 1;
  }
}
