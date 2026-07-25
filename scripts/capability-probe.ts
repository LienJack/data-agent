import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  inspectProviderRuntimeModel,
  MODEL_PROVIDER_BINDINGS,
  ModelRuntimeError,
} from "../packages/agent-runtime/src/models/index.js";
import { runOfflineProviderBehaviorConformance } from "../packages/agent-runtime/src/models/offline-conformance.js";

const rootManifestSchema = z.strictObject({
  name: z.literal("data-agent"),
  version: z.string().min(1),
  private: z.literal(true),
  type: z.literal("module"),
  packageManager: z.string().min(1),
  engines: z.record(z.string(), z.string()),
  scripts: z.record(z.string(), z.string()),
  devDependencies: z.record(z.string(), z.string()),
});

const runtimeManifestSchema = z.strictObject({
  name: z.literal("@data-agent/agent-runtime"),
  version: z.string().min(1),
  private: z.literal(true),
  type: z.literal("module"),
  exports: z.record(z.string(), z.unknown()),
  files: z.array(z.string()),
  scripts: z.record(z.string(), z.string()),
  dependencies: z.record(z.string(), z.string()),
  devDependencies: z.record(z.string(), z.string()),
});

const rootManifest = rootManifestSchema.parse(
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")),
);
const runtimeManifest = runtimeManifestSchema.parse(
  JSON.parse(
    readFileSync(new URL("../packages/agent-runtime/package.json", import.meta.url), "utf8"),
  ),
);

function inspectConfiguration(binding: (typeof MODEL_PROVIDER_BINDINGS)[number]) {
  const model = inspectProviderRuntimeModel(binding, "offline-conformance-placeholder");
  let normalizedCredentialFailure = false;
  try {
    inspectProviderRuntimeModel(binding, "");
  } catch (error) {
    normalizedCredentialFailure =
      error instanceof ModelRuntimeError &&
      error.code === "PROVIDER_CREDENTIAL_UNAVAILABLE" &&
      !error.message.includes("offline-conformance-placeholder");
  }

  const checks = {
    runtime_model_constructed:
      model.model_id === binding.default_model_id &&
      model.provider_runtime_id.length > 0 &&
      /^v[234]$/.test(model.specification_version),
    empty_credential_rejected: normalizedCredentialFailure,
    operational_constraints_unverified: Object.values(binding.operational_constraints).every(
      (constraint) => constraint.verification_status === "UNVERIFIED",
    ),
  };

  return {
    status: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
    inspection_version: "1.0.0",
    evidence_scope: "STATIC_CONFIGURATION_INSPECTION",
    checks,
    provider_runtime_id: model.provider_runtime_id,
    specification_version: model.specification_version,
  } as const;
}

const providers = await Promise.all(
  MODEL_PROVIDER_BINDINGS.map(async (binding) => {
    const configurationInspection = inspectConfiguration(binding);
    const offlineBehaviorConformance = await runOfflineProviderBehaviorConformance(binding);
    const credentialConfigured = Boolean(process.env[binding.credential_env]?.trim());
    return {
      provider: binding.provider,
      profile_id: binding.profile_id,
      profile_version: binding.profile_version,
      model_id: binding.default_model_id,
      model_id_authority: "UNVERIFIED_DEPLOYMENT_DEFAULT",
      adapter_version: binding.adapter_version,
      sdk: {
        package: binding.sdk_package,
        version: runtimeManifest.dependencies[binding.sdk_package],
      },
      capability_declarations: {
        authority: "UNVERIFIED_DEPLOYMENT_DEFAULT",
        values: binding.capabilities,
      },
      operational_constraints: binding.operational_constraints,
      configuration_inspection: configurationInspection,
      offline_behavior_conformance: offlineBehaviorConformance,
      credential_smoke: {
        status: "NOT_RUN",
        reason_code: credentialConfigured
          ? "EXPLICIT_CREDENTIALED_SMOKE_REQUIRED"
          : "CREDENTIAL_NOT_CONFIGURED",
      },
      certification_status: "UNVERIFIED",
      certification_receipt_ref: null,
    } as const;
  }),
);

const report = {
  probe_version: "2.0.0",
  generated_at: new Date().toISOString(),
  runtime: {
    node: process.versions.node,
    package_manager: rootManifest.packageManager,
    agent_runtime: runtimeManifest.version,
    mastra: runtimeManifest.dependencies["@mastra/core"],
  },
  toolchain: {
    turbo: rootManifest.devDependencies.turbo,
    typescript: rootManifest.devDependencies.typescript,
    vitest: rootManifest.devDependencies.vitest,
    biome: rootManifest.devDependencies["@biomejs/biome"],
  },
  providers,
  external_agents: [
    {
      adapter: "claude-code",
      registration_status: "DISABLED_BY_DEFAULT",
      model_provider_eligible: false,
    },
  ],
  capabilities: [
    { level: "L2", delivery_state: "IMPLEMENTING" },
    { level: "L3", delivery_state: "CONTRACT_ONLY", public_message: "未交付" },
    { level: "L4", delivery_state: "CONTRACT_ONLY", public_message: "未交付" },
    { level: "L5", delivery_state: "CONTRACT_ONLY", public_message: "未交付" },
  ],
} as const;

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (
  providers.some(
    ({ configuration_inspection, offline_behavior_conformance }) =>
      configuration_inspection.status !== "PASS" || offline_behavior_conformance.status !== "PASS",
  )
) {
  process.exitCode = 1;
}
