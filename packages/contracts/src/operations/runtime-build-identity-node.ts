import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  type RuntimeBuildConsumerRole,
  type RuntimeBuildIdentity,
  runtimeBuildIdentitySchema,
} from "./runtime-build-identity.js";
import {
  RUNTIME_MIGRATION_FACT_VERSION,
  type RuntimeMigrationFact,
  runtimeMigrationFactSchema,
} from "./runtime-migration-fact.js";

export type RuntimeBuildIdentityConfigurationErrorCode =
  | "RUNTIME_BUILD_IDENTITY_INVALID"
  | "RUNTIME_BUILD_IDENTITY_MISSING"
  | "RUNTIME_BUILD_IDENTITY_ROLE_MISMATCH"
  | "RUNTIME_BUILD_IDENTITY_UNREADABLE"
  | "RUNTIME_MIGRATION_FACT_INVALID";

export class RuntimeBuildIdentityConfigurationError extends Error {
  override readonly name = "RuntimeBuildIdentityConfigurationError";

  constructor(readonly code: RuntimeBuildIdentityConfigurationErrorCode) {
    super(code);
  }
}

export type RuntimeIdentityEnvironment = Readonly<Record<string, string | undefined>>;

function parseIdentity(
  input: unknown,
  expectedRole: RuntimeBuildConsumerRole,
): RuntimeBuildIdentity {
  const parsed = runtimeBuildIdentitySchema.safeParse(input);
  if (!parsed.success) {
    throw new RuntimeBuildIdentityConfigurationError("RUNTIME_BUILD_IDENTITY_INVALID");
  }
  if (parsed.data.consumer_role !== expectedRole) {
    throw new RuntimeBuildIdentityConfigurationError("RUNTIME_BUILD_IDENTITY_ROLE_MISMATCH");
  }
  return Object.freeze(parsed.data);
}

export function loadRuntimeBuildIdentity(
  input: Readonly<{
    expectedRole: RuntimeBuildConsumerRole;
    environment?: RuntimeIdentityEnvironment;
    testIdentity?: unknown;
    readText?: (path: string) => string;
  }>,
): RuntimeBuildIdentity {
  if (input.testIdentity !== undefined) {
    return parseIdentity(input.testIdentity, input.expectedRole);
  }
  const environment = input.environment ?? process.env;
  const path = environment.DATA_AGENT_RUNTIME_BUILD_IDENTITY_FILE?.trim();
  if (!path || !isAbsolute(path)) {
    throw new RuntimeBuildIdentityConfigurationError("RUNTIME_BUILD_IDENTITY_MISSING");
  }
  let source: string;
  try {
    source = (input.readText ?? ((candidate) => readFileSync(candidate, "utf8")))(path);
  } catch {
    throw new RuntimeBuildIdentityConfigurationError("RUNTIME_BUILD_IDENTITY_UNREADABLE");
  }
  try {
    return parseIdentity(JSON.parse(source), input.expectedRole);
  } catch (error) {
    if (error instanceof RuntimeBuildIdentityConfigurationError) throw error;
    throw new RuntimeBuildIdentityConfigurationError("RUNTIME_BUILD_IDENTITY_INVALID");
  }
}

export function projectPublicRuntimeBuildIdentity(identity: RuntimeBuildIdentity): Readonly<{
  build_id: RuntimeBuildIdentity["build_id"];
  generation_id: RuntimeBuildIdentity["generation_id"];
}> {
  return Object.freeze({
    build_id: identity.build_id,
    generation_id: identity.generation_id,
  });
}

export function loadRuntimeMigrationFact(
  environment: RuntimeIdentityEnvironment = process.env,
): RuntimeMigrationFact | null {
  const ready = environment.DATA_AGENT_MIGRATION_READY?.trim();
  const frontier = environment.DATA_AGENT_MIGRATION_FRONTIER?.trim();
  if (!ready && !frontier) return null;
  const parsed = runtimeMigrationFactSchema.safeParse({
    schema_version: RUNTIME_MIGRATION_FACT_VERSION,
    migration_ready: ready === "true",
    migration_frontier: frontier,
  });
  if (!parsed.success) {
    throw new RuntimeBuildIdentityConfigurationError("RUNTIME_MIGRATION_FACT_INVALID");
  }
  return Object.freeze(parsed.data);
}
