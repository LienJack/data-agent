import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  globSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const legacyAttestationVersion = "workspace-build-attestation@1.0.0" as const;
const attestationVersion = "workspace-build-attestation@2.0.0" as const;
const runtimeIdentityVersion = "runtime-build-identity@1.0.0" as const;
const defaultRootInputs = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
  "tsconfig.base.json",
] as const;
const contentHashPattern = /^sha256:[a-f0-9]{64}$/;
const gitCommitPattern = /^[a-f0-9]{7,64}$/;
const turboTaskHashPattern = /^[a-f0-9]{16,64}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const runtimeBuildConsumerRoles = new Set<RuntimeBuildConsumerRole>([
  "web",
  "worker",
  "relationship-indexer",
  "semantic-authoring",
]);

export type RuntimeBuildConsumerRole =
  | "web"
  | "worker"
  | "relationship-indexer"
  | "semantic-authoring";

export type WorkspaceBuildIntegrityErrorCode =
  | "DEV_WORKSPACE_BUILD_ATTESTATION_INVALID"
  | "DEV_WORKSPACE_BUILD_CHANGED_DURING_BUILD"
  | "DEV_WORKSPACE_BUILD_EXPORT_OUTSIDE_OUTPUTS"
  | "DEV_WORKSPACE_BUILD_GRAPH_INVALID"
  | "DEV_WORKSPACE_BUILD_OUTPUT_MISSING"
  | "DEV_WORKSPACE_BUILD_OUTPUT_MISMATCH"
  | "DEV_WORKSPACE_BUILD_STALE";

export class WorkspaceBuildIntegrityError extends Error {
  readonly code: WorkspaceBuildIntegrityErrorCode;

  constructor(code: WorkspaceBuildIntegrityErrorCode, message: string) {
    super(message);
    this.name = "WorkspaceBuildIntegrityError";
    this.code = code;
  }
}

export interface TurboBuildTaskIdentity {
  readonly task_id: string;
  readonly package_name: string;
  readonly directory: string;
  readonly task_hash: string;
  readonly outputs: readonly string[];
  readonly excluded_outputs: readonly string[];
}

export interface TurboBuildDryRun {
  readonly tasks: readonly TurboBuildTaskIdentity[];
}

export interface WorkspaceBuildPackageTask extends TurboBuildTaskIdentity {
  readonly output_digest: `sha256:${string}`;
}

export interface WorkspaceBuildPackageTaskV1 {
  readonly task_id: string;
  readonly package_name: string;
  readonly directory: string;
  readonly task_hash: string;
  readonly outputs: readonly string[];
  readonly output_digest: `sha256:${string}`;
}

export interface WorkspaceBuildConsumerAttestation {
  readonly consumer_role: RuntimeBuildConsumerRole;
  readonly build_id: `sha256:${string}`;
  readonly package_tasks: readonly WorkspaceBuildPackageTask[];
}

export interface WorkspaceBuildConsumerAttestationV1 {
  readonly consumer_role: RuntimeBuildConsumerRole;
  readonly build_id: `sha256:${string}`;
  readonly package_tasks: readonly WorkspaceBuildPackageTaskV1[];
}

export interface WorkspaceBuildAttestationV2 {
  readonly schema_version: typeof attestationVersion;
  readonly generation_id: `sha256:${string}`;
  readonly built_at: string;
  readonly git_commit: string;
  readonly git_dirty: boolean;
  readonly root_inputs: Readonly<Record<string, `sha256:${string}`>>;
  readonly consumers: readonly WorkspaceBuildConsumerAttestation[];
}

export interface WorkspaceBuildAttestationV1 {
  readonly schema_version: typeof legacyAttestationVersion;
  readonly generation_id: `sha256:${string}`;
  readonly built_at: string;
  readonly git_commit: string;
  readonly git_dirty: boolean;
  readonly root_inputs: Readonly<Record<string, `sha256:${string}`>>;
  readonly consumers: readonly WorkspaceBuildConsumerAttestationV1[];
}

export type WorkspaceBuildAttestation = WorkspaceBuildAttestationV1 | WorkspaceBuildAttestationV2;

export interface RuntimeBuildIdentityProjection {
  readonly schema_version: typeof runtimeIdentityVersion;
  readonly consumer_role: RuntimeBuildConsumerRole;
  readonly generation_id: `sha256:${string}`;
  readonly build_id: `sha256:${string}`;
  readonly built_at: string;
  readonly git_commit: string;
  readonly git_dirty: boolean;
}

export interface WorkspaceBuildFilesystem {
  readonly exists: (path: string) => boolean;
  readonly glob: (
    pattern: string,
    options: { readonly cwd: string; readonly exclude: readonly string[] },
  ) => readonly string[];
  readonly lstat: (path: string) => {
    readonly isFile: () => boolean;
    readonly isSymbolicLink: () => boolean;
  };
  readonly readBuffer: (path: string) => Buffer;
  readonly readlink: (path: string) => string;
  readonly readText: (path: string) => string;
  readonly writeTextAtomically: (path: string, content: string) => void;
}

function writeTextAtomically(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, path);
  } catch (error) {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
    if (existsSync(temporaryPath)) {
      unlinkSync(temporaryPath);
    }
    throw error;
  }
}

export const nodeWorkspaceBuildFilesystem: WorkspaceBuildFilesystem = {
  exists: existsSync,
  glob: (pattern, options) => globSync(pattern, options),
  lstat: lstatSync,
  readBuffer: (path) => readFileSync(path),
  readlink: readlinkSync,
  readText: (path) => readFileSync(path, "utf8"),
  writeTextAtomically,
};

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(",")}}`;
}

function contentHash(value: string | Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function invalid(message: string): never {
  throw new WorkspaceBuildIntegrityError("DEV_WORKSPACE_BUILD_ATTESTATION_INVALID", message);
}

function invalidGraph(message: string): never {
  throw new WorkspaceBuildIntegrityError("DEV_WORKSPACE_BUILD_GRAPH_INVALID", message);
}

function requiredString(object: JsonObject, key: string): string {
  const value = object[key];
  return typeof value === "string" && value.length > 0
    ? value
    : invalid(`字段 ${key} 必须是非空字符串。`);
}

function canonicalOutputGlobs(object: JsonObject, key: "outputs" | "excludedOutputs"): string[] {
  const raw = object[key];
  if (key === "excludedOutputs" && (raw === undefined || raw === null)) return [];
  if (!Array.isArray(raw) || !raw.every((entry) => typeof entry === "string")) {
    return invalidGraph(`字段 ${key} 必须是字符串数组。`);
  }
  const values = [...raw];
  if (key === "outputs" && values.length === 0) {
    return invalidGraph("Turbo build task 必须声明至少一个 output glob。");
  }
  const seen = new Set<string>();
  for (const value of values) {
    const segments = value.split("/");
    if (
      value.length === 0 ||
      value.startsWith("!") ||
      isAbsolute(value) ||
      value.includes("\\") ||
      value.includes("\0") ||
      segments.includes("..") ||
      seen.has(value)
    ) {
      return invalidGraph(`Turbo ${key} 包含不安全或重复 glob。`);
    }
    seen.add(value);
  }
  return [...seen].sort();
}

function hasExactKeys(object: JsonObject, keys: readonly string[]): boolean {
  const expected = [...keys].sort();
  const actual = Object.keys(object).sort();
  return expected.length === actual.length && expected.every((key, index) => key === actual[index]);
}

function isContentHash(value: unknown): value is `sha256:${string}` {
  return typeof value === "string" && contentHashPattern.test(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" && timestampPattern.test(value) && !Number.isNaN(Date.parse(value))
  );
}

export function parseTurboBuildDryRun(input: unknown): TurboBuildDryRun {
  if (!isJsonObject(input) || !Array.isArray(input.tasks)) {
    return invalidGraph("Turbo dry-run 缺少 tasks 数组。");
  }

  const tasks = input.tasks.map((candidate) => {
    if (!isJsonObject(candidate) || candidate.task !== "build") {
      return invalidGraph("Turbo dry-run 只能包含可识别的 build task。");
    }
    const taskId = requiredString(candidate, "taskId");
    const packageName = requiredString(candidate, "package");
    const taskHash = requiredString(candidate, "hash");
    if (taskId !== `${packageName}#build` || !turboTaskHashPattern.test(taskHash)) {
      return invalidGraph(`Turbo dry-run task ${taskId} identity 无效。`);
    }
    const outputs = canonicalOutputGlobs(candidate, "outputs");
    const excludedOutputs = canonicalOutputGlobs(candidate, "excludedOutputs");
    if (excludedOutputs.some((pattern) => outputs.includes(pattern))) {
      return invalidGraph(`Turbo dry-run task ${taskId} 的 include/exclude glob 冲突。`);
    }
    return {
      task_id: taskId,
      package_name: packageName,
      directory: requiredString(candidate, "directory"),
      task_hash: taskHash,
      outputs,
      excluded_outputs: excludedOutputs,
    } satisfies TurboBuildTaskIdentity;
  });

  const taskIds = new Set<string>();
  for (const task of tasks) {
    if (taskIds.has(task.task_id)) {
      invalidGraph(`Turbo dry-run 包含重复 task ${task.task_id}。`);
    }
    taskIds.add(task.task_id);
  }
  return { tasks: tasks.sort((left, right) => left.task_id.localeCompare(right.task_id)) };
}

function pathIsWithin(path: string, root: string): boolean {
  const fromRoot = relative(root, path);
  return (
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot))
  );
}

function outputFiles(
  repoRoot: string,
  task: TurboBuildTaskIdentity | WorkspaceBuildPackageTaskV1,
  filesystem: WorkspaceBuildFilesystem,
  missingCode:
    | "DEV_WORKSPACE_BUILD_OUTPUT_MISSING"
    | "DEV_WORKSPACE_BUILD_OUTPUT_MISMATCH" = "DEV_WORKSPACE_BUILD_OUTPUT_MISSING",
): string[] {
  const packageRoot = resolve(repoRoot, task.directory);
  if (!pathIsWithin(packageRoot, resolve(repoRoot))) {
    return invalid(`Task ${task.task_id} 的目录越过仓库边界。`);
  }
  const includes = task.outputs.filter((pattern) => !pattern.startsWith("!"));
  const legacyExcludes = task.outputs
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => pattern.slice(1));
  const excludes = [
    ...legacyExcludes,
    ...("excluded_outputs" in task ? task.excluded_outputs : []),
  ];
  const matches = new Set<string>();
  for (const pattern of includes) {
    for (const match of filesystem.glob(pattern, { cwd: packageRoot, exclude: excludes })) {
      const absolutePath = resolve(packageRoot, match);
      if (!pathIsWithin(absolutePath, packageRoot) || !filesystem.exists(absolutePath)) {
        continue;
      }
      const stat = filesystem.lstat(absolutePath);
      if (stat.isFile() || stat.isSymbolicLink()) {
        matches.add(match.split(sep).join("/"));
      }
    }
  }
  if (includes.length === 0 || matches.size === 0) {
    throw new WorkspaceBuildIntegrityError(
      missingCode,
      `Task ${task.task_id} 没有可证明的 build output。`,
    );
  }
  return [...matches].sort();
}

function outputDigest(
  repoRoot: string,
  task: TurboBuildTaskIdentity | WorkspaceBuildPackageTaskV1,
  filesystem: WorkspaceBuildFilesystem,
  missingCode?: "DEV_WORKSPACE_BUILD_OUTPUT_MISSING" | "DEV_WORKSPACE_BUILD_OUTPUT_MISMATCH",
): `sha256:${string}` {
  const packageRoot = resolve(repoRoot, task.directory);
  const hash = createHash("sha256");
  for (const path of outputFiles(repoRoot, task, filesystem, missingCode)) {
    const absolutePath = join(packageRoot, path);
    const stat = filesystem.lstat(absolutePath);
    hash.update(path).update("\0");
    if (stat.isSymbolicLink()) {
      hash.update("symlink\0").update(filesystem.readlink(absolutePath)).update("\0");
    } else {
      hash.update("file\0").update(filesystem.readBuffer(absolutePath)).update("\0");
    }
  }
  return `sha256:${hash.digest("hex")}`;
}

function exportTargets(value: unknown): string[] {
  if (typeof value === "string") {
    return value.startsWith("./") ? [value.slice(2)] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => exportTargets(entry));
  }
  if (isJsonObject(value)) {
    return Object.values(value).flatMap((entry) => exportTargets(entry));
  }
  return [];
}

function verifyPackageExports(
  repoRoot: string,
  task: TurboBuildTaskIdentity,
  filesystem: WorkspaceBuildFilesystem,
): void {
  const packageRoot = resolve(repoRoot, task.directory);
  const manifestPath = join(packageRoot, "package.json");
  if (!filesystem.exists(manifestPath)) {
    invalid(`Task ${task.task_id} 缺少 package.json。`);
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(filesystem.readText(manifestPath));
  } catch {
    invalid(`${manifestPath} 不是有效 JSON。`);
  }
  if (!isJsonObject(manifest)) {
    invalid(`${manifestPath} 必须是 JSON object。`);
  }
  const files = new Set(outputFiles(repoRoot, task, filesystem));
  const targets = [
    ...exportTargets(manifest.exports),
    ...exportTargets(manifest.main),
    ...exportTargets(manifest.module),
    ...exportTargets(manifest.types),
  ];
  for (const target of targets) {
    if (!files.has(target) || !filesystem.exists(join(packageRoot, target))) {
      throw new WorkspaceBuildIntegrityError(
        "DEV_WORKSPACE_BUILD_EXPORT_OUTSIDE_OUTPUTS",
        `${task.package_name} export ${target} 不在已声明且存在的 build outputs 中。`,
      );
    }
  }
}

function taskSignature(task: TurboBuildTaskIdentity): string {
  return canonicalize({
    task_id: task.task_id,
    package_name: task.package_name,
    directory: task.directory,
    task_hash: task.task_hash,
    outputs: task.outputs,
    excluded_outputs: task.excluded_outputs,
  });
}

function legacyTaskSignature(task: TurboBuildTaskIdentity | WorkspaceBuildPackageTaskV1): string {
  return canonicalize({
    task_id: task.task_id,
    package_name: task.package_name,
    directory: task.directory,
    task_hash: task.task_hash,
    outputs: task.outputs,
  });
}

function assertStableBuild(before: TurboBuildDryRun, after: TurboBuildDryRun): void {
  if (
    canonicalize(before.tasks.map(taskSignature)) !== canonicalize(after.tasks.map(taskSignature))
  ) {
    throw new WorkspaceBuildIntegrityError(
      "DEV_WORKSPACE_BUILD_CHANGED_DURING_BUILD",
      "Workspace build 期间 Turbo task 集合或 hash 发生变化。",
    );
  }
}

function rootInputIdentities(
  repoRoot: string,
  filesystem: WorkspaceBuildFilesystem,
  paths: readonly string[] = defaultRootInputs,
): Readonly<Record<string, `sha256:${string}`>> {
  return Object.fromEntries(
    [...paths].sort().map((path) => {
      const absolutePath = resolve(repoRoot, path);
      if (!pathIsWithin(absolutePath, resolve(repoRoot)) || !filesystem.exists(absolutePath)) {
        return invalid(`根构建输入 ${path} 缺失或越过仓库边界。`);
      }
      return [path, contentHash(filesystem.readBuffer(absolutePath))];
    }),
  );
}

export function createWorkspaceBuildAttestation(input: {
  readonly repoRoot: string;
  readonly beforeBuild: TurboBuildDryRun;
  readonly afterBuild: TurboBuildDryRun;
  readonly consumers: readonly {
    readonly consumerRole: RuntimeBuildConsumerRole;
    readonly packageNames: readonly string[];
  }[];
  readonly builtAt: string;
  readonly gitCommit: string;
  readonly gitDirty: boolean;
  readonly rootInputPaths?: readonly string[];
  readonly filesystem?: WorkspaceBuildFilesystem;
}): WorkspaceBuildAttestationV2 {
  if (!isTimestamp(input.builtAt) || !gitCommitPattern.test(input.gitCommit)) {
    invalid("Workspace build provenance 的 builtAt 或 gitCommit 无效。");
  }
  const consumerRoles = new Set<RuntimeBuildConsumerRole>();
  if (input.consumers.length === 0) {
    invalidGraph("Workspace build 没有受管理进程。");
  }
  for (const consumer of input.consumers) {
    if (
      !runtimeBuildConsumerRoles.has(consumer.consumerRole) ||
      consumerRoles.has(consumer.consumerRole)
    ) {
      invalidGraph(`受管理进程角色 ${consumer.consumerRole} 无效或重复。`);
    }
    if (consumer.packageNames.length === 0) {
      invalidGraph(`受管理进程 ${consumer.consumerRole} 没有 build task。`);
    }
    consumerRoles.add(consumer.consumerRole);
  }
  assertStableBuild(input.beforeBuild, input.afterBuild);
  const filesystem = input.filesystem ?? nodeWorkspaceBuildFilesystem;
  const taskByPackage = new Map(input.afterBuild.tasks.map((task) => [task.package_name, task]));
  const rootInputs = rootInputIdentities(input.repoRoot, filesystem, input.rootInputPaths);
  const consumers = input.consumers
    .map((consumer) => {
      const packageTasks = [...new Set(consumer.packageNames)]
        .sort()
        .map((packageName): WorkspaceBuildPackageTask => {
          const task = taskByPackage.get(packageName);
          if (!task) {
            return invalidGraph(
              `受管理进程 ${consumer.consumerRole} 缺少 ${packageName} build task。`,
            );
          }
          verifyPackageExports(input.repoRoot, task, filesystem);
          return { ...task, output_digest: outputDigest(input.repoRoot, task, filesystem) };
        });
      const buildId = contentHash(
        canonicalize({ root_inputs: rootInputs, package_tasks: packageTasks }),
      );
      return {
        consumer_role: consumer.consumerRole,
        build_id: buildId,
        package_tasks: packageTasks,
      } satisfies WorkspaceBuildConsumerAttestation;
    })
    .sort((left, right) => left.consumer_role.localeCompare(right.consumer_role));
  const generationId = contentHash(
    canonicalize({ built_at: input.builtAt, root_inputs: rootInputs, consumers }),
  );

  return {
    schema_version: attestationVersion,
    generation_id: generationId,
    built_at: input.builtAt,
    git_commit: input.gitCommit,
    git_dirty: input.gitDirty,
    root_inputs: rootInputs,
    consumers,
  };
}

export function projectRuntimeBuildIdentities(
  attestation: WorkspaceBuildAttestation,
): RuntimeBuildIdentityProjection[] {
  assertAttestation(attestation);
  return attestation.consumers.map((consumer) => ({
    schema_version: runtimeIdentityVersion,
    consumer_role: consumer.consumer_role,
    generation_id: attestation.generation_id,
    build_id: consumer.build_id,
    built_at: attestation.built_at,
    git_commit: attestation.git_commit,
    git_dirty: attestation.git_dirty,
  }));
}

function assertAttestation(value: unknown): asserts value is WorkspaceBuildAttestation {
  const topLevelKeys = [
    "schema_version",
    "generation_id",
    "built_at",
    "git_commit",
    "git_dirty",
    "root_inputs",
    "consumers",
  ] as const;
  if (
    !isJsonObject(value) ||
    !hasExactKeys(value, topLevelKeys) ||
    (value.schema_version !== legacyAttestationVersion &&
      value.schema_version !== attestationVersion)
  ) {
    invalid("Workspace build attestation version 或顶层字段无效。");
  }
  const isLegacy = value.schema_version === legacyAttestationVersion;
  if (
    !isContentHash(value.generation_id) ||
    !isTimestamp(value.built_at) ||
    typeof value.git_commit !== "string" ||
    !gitCommitPattern.test(value.git_commit) ||
    typeof value.git_dirty !== "boolean" ||
    !isJsonObject(value.root_inputs) ||
    Object.keys(value.root_inputs).length === 0 ||
    !Object.values(value.root_inputs).every(isContentHash) ||
    !Array.isArray(value.consumers) ||
    value.consumers.length === 0
  ) {
    invalid("Workspace build attestation provenance 或根输入无效。");
  }

  const roles = new Set<RuntimeBuildConsumerRole>();
  const consumers: JsonObject[] = [];
  for (const rawConsumer of value.consumers) {
    if (
      !isJsonObject(rawConsumer) ||
      !hasExactKeys(rawConsumer, ["consumer_role", "build_id", "package_tasks"]) ||
      !runtimeBuildConsumerRoles.has(rawConsumer.consumer_role as RuntimeBuildConsumerRole) ||
      !isContentHash(rawConsumer.build_id) ||
      !Array.isArray(rawConsumer.package_tasks) ||
      rawConsumer.package_tasks.length === 0
    ) {
      invalid("Workspace build attestation consumer 无效。");
    }
    const role = rawConsumer.consumer_role as RuntimeBuildConsumerRole;
    if (roles.has(role)) {
      invalid(`Workspace build attestation consumer ${role} 重复。`);
    }
    roles.add(role);

    const packageNames = new Set<string>();
    const packageTasks = rawConsumer.package_tasks.map((rawTask): JsonObject => {
      const taskKeys = isLegacy
        ? ["task_id", "package_name", "directory", "task_hash", "outputs", "output_digest"]
        : [
            "task_id",
            "package_name",
            "directory",
            "task_hash",
            "outputs",
            "excluded_outputs",
            "output_digest",
          ];
      if (
        !isJsonObject(rawTask) ||
        !hasExactKeys(rawTask, taskKeys) ||
        typeof rawTask.task_id !== "string" ||
        typeof rawTask.package_name !== "string" ||
        rawTask.task_id !== `${rawTask.package_name}#build` ||
        typeof rawTask.directory !== "string" ||
        rawTask.directory.length === 0 ||
        typeof rawTask.task_hash !== "string" ||
        !turboTaskHashPattern.test(rawTask.task_hash) ||
        !Array.isArray(rawTask.outputs) ||
        !rawTask.outputs.every((output) => typeof output === "string") ||
        (!isLegacy &&
          (!Array.isArray(rawTask.excluded_outputs) ||
            !rawTask.excluded_outputs.every((output) => typeof output === "string"))) ||
        !isContentHash(rawTask.output_digest)
      ) {
        return invalid("Workspace build attestation package task 无效。");
      }
      if (!isLegacy) {
        let normalized: TurboBuildTaskIdentity | undefined;
        try {
          normalized = parseTurboBuildDryRun({
            tasks: [
              {
                taskId: rawTask.task_id,
                task: "build",
                package: rawTask.package_name,
                hash: rawTask.task_hash,
                directory: rawTask.directory,
                outputs: rawTask.outputs,
                excludedOutputs: rawTask.excluded_outputs,
              },
            ],
          }).tasks[0];
        } catch {
          return invalid("Workspace build attestation package task glob 无效。");
        }
        if (
          !normalized ||
          canonicalize(normalized.outputs) !== canonicalize(rawTask.outputs) ||
          canonicalize(normalized.excluded_outputs) !== canonicalize(rawTask.excluded_outputs)
        ) {
          return invalid("Workspace build attestation package task glob 非 canonical。");
        }
      }
      if (packageNames.has(rawTask.package_name)) {
        invalid(`Workspace build attestation package ${rawTask.package_name} 重复。`);
      }
      packageNames.add(rawTask.package_name);
      return rawTask;
    });
    const consumer = {
      consumer_role: role,
      build_id: rawConsumer.build_id,
      package_tasks: packageTasks,
    };
    if (
      consumer.build_id !==
      contentHash(canonicalize({ root_inputs: value.root_inputs, package_tasks: packageTasks }))
    ) {
      invalid(`Workspace build attestation consumer ${role} build_id 无效。`);
    }
    consumers.push(consumer);
  }
  if (
    value.generation_id !==
    contentHash(
      canonicalize({ built_at: value.built_at, root_inputs: value.root_inputs, consumers }),
    )
  ) {
    invalid("Workspace build attestation generation_id 无效。");
  }
}

export function writeWorkspaceBuildAttestation(
  path: string,
  attestation: WorkspaceBuildAttestationV2,
  filesystem: WorkspaceBuildFilesystem = nodeWorkspaceBuildFilesystem,
): void {
  assertAttestation(attestation);
  filesystem.writeTextAtomically(path, `${JSON.stringify(attestation, null, 2)}\n`);
}

export function readWorkspaceBuildAttestation(
  path: string,
  filesystem: WorkspaceBuildFilesystem = nodeWorkspaceBuildFilesystem,
): WorkspaceBuildAttestation {
  try {
    const parsed: unknown = JSON.parse(filesystem.readText(path));
    assertAttestation(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof WorkspaceBuildIntegrityError) {
      throw error;
    }
    throw new WorkspaceBuildIntegrityError(
      "DEV_WORKSPACE_BUILD_ATTESTATION_INVALID",
      `无法读取完整 Workspace build attestation: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function verifyWorkspaceBuildAttestation(input: {
  readonly repoRoot: string;
  readonly attestation: WorkspaceBuildAttestation;
  readonly currentBuild: TurboBuildDryRun;
  readonly rootInputPaths?: readonly string[];
  readonly filesystem?: WorkspaceBuildFilesystem;
}): WorkspaceBuildAttestation {
  assertAttestation(input.attestation);
  const filesystem = input.filesystem ?? nodeWorkspaceBuildFilesystem;
  const currentTasks = new Map(input.currentBuild.tasks.map((task) => [task.package_name, task]));
  const isLegacy = input.attestation.schema_version === legacyAttestationVersion;
  for (const consumer of input.attestation.consumers) {
    for (const expected of consumer.package_tasks) {
      const current = currentTasks.get(expected.package_name);
      const expectedSignature = isLegacy
        ? legacyTaskSignature(expected)
        : "excluded_outputs" in expected
          ? taskSignature(expected)
          : invalid("Workspace build attestation v2 缺少 excluded_outputs。");
      const currentSignature = isLegacy
        ? legacyTaskSignature(current ?? expected)
        : current && taskSignature(current);
      if (!current || currentSignature !== expectedSignature) {
        throw new WorkspaceBuildIntegrityError(
          "DEV_WORKSPACE_BUILD_STALE",
          `${expected.package_name} 当前 Turbo task identity 与证明不一致。`,
        );
      }
      if (
        outputDigest(
          input.repoRoot,
          expected,
          filesystem,
          "DEV_WORKSPACE_BUILD_OUTPUT_MISMATCH",
        ) !== expected.output_digest
      ) {
        throw new WorkspaceBuildIntegrityError(
          "DEV_WORKSPACE_BUILD_OUTPUT_MISMATCH",
          `${expected.package_name} build output digest 与证明不一致。`,
        );
      }
    }
  }
  if (
    canonicalize(rootInputIdentities(input.repoRoot, filesystem, input.rootInputPaths)) !==
    canonicalize(input.attestation.root_inputs)
  ) {
    throw new WorkspaceBuildIntegrityError("DEV_WORKSPACE_BUILD_STALE", "根构建输入与证明不一致。");
  }
  return input.attestation;
}
