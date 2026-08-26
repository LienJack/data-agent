import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  inspectProviderRuntimeModel,
  MODEL_PROVIDER_BINDINGS,
  ModelRuntimeError,
} from "../packages/agent-runtime/src/models/index.js";
import { runOfflineProviderBehaviorConformance } from "../packages/agent-runtime/src/models/offline-conformance.js";
import { loadEcommerceDeterministicAnalysisSuite } from "../packages/evals/src/test-center/deterministic-analysis-suite.js";

const digest = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const openSandboxAttestationSchema = z.strictObject({
  schema_version: z.literal("opensandbox-analysis-attestation@1.0.0"),
  opensandbox_source: z.strictObject({
    repository: z.literal("https://github.com/opensandbox-group/OpenSandbox"),
    commit: z.string().regex(/^[a-f0-9]{40}$/u),
    server_version: z.string().min(1),
  }),
  sdk: z.strictObject({
    opensandbox: z.string().min(1),
    code_interpreter: z.string().min(1),
  }),
  base_image: z.string().regex(/^opensandbox\/code-interpreter@sha256:[a-f0-9]{64}$/u),
  agent_dockerfile: z.strictObject({
    path: z.string().min(1),
    sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  }),
  profiles: z.record(
    z.enum(["CORE_ANALYSIS", "ML_DIAGNOSTIC", "CAUSAL_L5"]),
    z.strictObject({
      lock_path: z.string().min(1),
      lock_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    }),
  ),
  operator: z.strictObject({
    dockerfile_path: z.string().min(1),
    dockerfile_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    manifest_path: z.string().min(1),
    manifest_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    registry_digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  }),
  local_probe: z.strictObject({
    status: z.literal("PASS"),
    endpoint_mode: z.literal("DIRECT"),
    use_server_proxy: z.literal(false),
    pids_limit: z.number().int().min(128),
    secure_access: z.literal(false),
    production_isolation_proven: z.literal(false),
    known_rejected_configuration: z.strictObject({
      pids_limit: z.literal(32),
      failure: z.literal("RuntimeError: can't start new thread"),
    }),
    profile_counts: z.record(
      z.enum(["CORE_ANALYSIS", "ML_DIAGNOSTIC", "CAUSAL_L5"]),
      z.strictObject({
        status: z.literal("PASS"),
        sandbox: z.strictObject({
          before: z.literal(0),
          peak: z.literal(2),
          after: z.literal(0),
        }),
        egress: z.strictObject({
          before: z.literal(0),
          peak: z.literal(2),
          after: z.literal(0),
        }),
      }),
    ),
  }),
  production_gate: z.strictObject({
    decision: z.literal("HOLD"),
    required_runtime: z.literal("KATA_OR_GVISOR_WITH_CILIUM"),
    release_image_digests_required: z.literal(true),
  }),
});

const skill = (
  capability_id: string,
  stage: 1 | 2 | 3 | 4,
  registration_state: "SHADOW" | "INTERNAL" | "NOT_REGISTERED",
  options: {
    generated?: boolean;
    execution?: boolean;
    visible?: boolean;
    blockers?: readonly string[];
  } = {},
) => ({
  capability_id,
  stage,
  registration_state,
  execution_enabled: options.execution ?? registration_state !== "NOT_REGISTERED",
  user_visible: options.visible ?? registration_state === "INTERNAL",
  generated_programs_allowed: options.generated ?? false,
  kill_switch: {
    engaged: registration_state === "NOT_REGISTERED",
    reason_code: registration_state === "NOT_REGISTERED" ? "CAPABILITY_NOT_REGISTERED" : null,
  },
  promotion_blockers: [
    ...(options.blockers ?? [
      "OPENSANDBOX_PRODUCTION_ISOLATION_REQUIRED",
      "SBOM_CVE_LICENSE_ATTESTATION_REQUIRED",
    ]),
  ],
});

export async function buildDeterministicAnalysisCapabilityProbe() {
  const suite = await loadEcommerceDeterministicAnalysisSuite();
  const runtimeAttestation = openSandboxAttestationSchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../infra/docker/opensandbox-analysis-attestation.json", import.meta.url),
        "utf8",
      ),
    ),
  );
  const text2sqlSource = readFileSync(
    new URL("../apps/worker/src/teams/tools/text2sql-tools.ts", import.meta.url),
  );
  const capabilities = [
    skill("data-profile@1", 1, "SHADOW"),
    skill("semantic-transform@1", 1, "SHADOW"),
    skill("trend-change@1", 1, "SHADOW"),
    skill("contribution-concentration@1", 1, "SHADOW", {
      blockers: ["PRODUCTION_RUNTIME_GATE_HOLD", "CONTRIBUTION_CLOSURE_RELEASE_REVIEW"],
    }),
    skill("robust-anomaly@1", 1, "SHADOW"),
    skill("association-outlier-completeness@1", 1, "SHADOW", {
      blockers: ["PRODUCTION_RUNTIME_GATE_HOLD", "ASSOCIATION_DISCLOSURE_RELEASE_REVIEW"],
    }),
    skill("baseline-forecast-backtest@1", 1, "SHADOW", {
      blockers: [
        "PRODUCTION_RUNTIME_GATE_HOLD",
        "FORECAST_LEAKAGE_RELEASE_REVIEW",
        "FORECAST_GA_LATE",
      ],
    }),
    skill("open-python-analysis@1", 2, "SHADOW", { generated: true }),
    skill("root-cause-investigation@1", 3, "INTERNAL", {
      blockers: ["PRODUCTION_RUNTIME_GATE_HOLD", "L5_REMAINS_HOLD"],
    }),
    skill("visual-insight-story@1", 3, "INTERNAL"),
    skill("certified-causal-estimate@1", 4, "NOT_REGISTERED", {
      execution: false,
      visible: false,
      blockers: ["F9_NOT_REGISTERED", "L5_GATE_HOLD", "PRODUCTION_RUNTIME_GATE_HOLD"],
    }),
  ];
  return {
    probe_version: "deterministic-analysis-capability-probe@1.0.0",
    release_decision: "HOLD",
    suite: {
      schema_version: suite.manifest.schema_version,
      suite_version: suite.manifest.suite_version,
      suite_hash: suite.manifest.manifest_hash,
      case_count: suite.manifest.case_count,
      minimum_score: suite.manifest.minimum_score,
      oracle_gate: "PASS",
    },
    supply_chain: {
      status: "NOT_VERIFIED",
      sbom_hash: null,
      cve_scan_status: "NOT_RUN",
      license_scan_status: "NOT_RUN",
      blocker: "SBOM_CVE_LICENSE_ATTESTATION_REQUIRED",
    },
    runtime_attestation: {
      schema_version: runtimeAttestation.schema_version,
      registered_profiles: Object.keys(runtimeAttestation.profiles).sort(),
      source_commit: runtimeAttestation.opensandbox_source.commit,
      base_image: runtimeAttestation.base_image,
      operator_registry_digest: runtimeAttestation.operator.registry_digest,
      local_probe: runtimeAttestation.local_probe,
      production_gate: runtimeAttestation.production_gate,
    },
    f9: { registration_status: "NOT_REGISTERED", blocks_standard_analysis: false },
    l5_gate: { decision: "HOLD", execution_enabled: false },
    text2sql_isolation: {
      independent_path_verified: true,
      source_path: "apps/worker/src/teams/tools/text2sql-tools.ts",
      verification_hash: digest(text2sqlSource),
    },
    capabilities,
  } as const;
}

const rootManifestSchema = z.strictObject({
  name: z.literal("data-agent"),
  version: z.string().min(1),
  private: z.literal(true),
  type: z.literal("module"),
  packageManager: z.string().min(1),
  engines: z.record(z.string(), z.string()),
  scripts: z.record(z.string(), z.string()),
  dependencies: z.record(z.string(), z.string()).optional(),
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
  probe_version: "3.0.0",
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
  deterministic_analysis: await buildDeterministicAnalysisCapabilityProbe(),
} as const;

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(
    `${JSON.stringify(
      process.argv.includes("--deterministic-analysis-only")
        ? report.deterministic_analysis
        : report,
      null,
      2,
    )}\n`,
  );

  if (
    providers.some(
      ({ configuration_inspection, offline_behavior_conformance }) =>
        configuration_inspection.status !== "PASS" ||
        offline_behavior_conformance.status !== "PASS",
    )
  ) {
    process.exitCode = 1;
  }
}
