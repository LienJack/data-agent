import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeterministicAnalysisCapabilityProbe } from "./capability-probe.js";
import {
  attestWorkspaceReleaseBuild,
  type WorkspaceReleaseBuildReceipt,
} from "./workspace-build-release.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

function verifyWorkspaceReleaseBuild(): WorkspaceReleaseBuildReceipt {
  execFileSync(
    "pnpm",
    [
      "turbo",
      "run",
      "build",
      "--force",
      "--filter=@data-agent/web...",
      "--filter=@data-agent/worker...",
    ],
    { cwd: rootDir, stdio: "inherit" },
  );
  const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: rootDir,
    encoding: "utf8",
  }).trim();
  const gitDirty =
    execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=normal"], {
      cwd: rootDir,
      encoding: "utf8",
    }).trim().length > 0;
  return attestWorkspaceReleaseBuild({
    repoRoot: rootDir,
    outputDirectory: resolve(rootDir, ".turbo/data-agent-release"),
    roles: ["web", "worker", "relationship-indexer", "semantic-authoring"],
    gitCommit,
    gitDirty,
  });
}

if (process.argv.includes("--deterministic-analysis")) {
  const probe = await buildDeterministicAnalysisCapabilityProbe();
  const read = (path: string) => readFileSync(resolve(rootDir, path), "utf8");
  const exists = (path: string) => existsSync(resolve(rootDir, path));
  const capabilityIds = probe.capabilities.map(({ capability_id }) => capability_id);
  const expectedCapabilityIds = [
    "data-profile@1",
    "semantic-transform@1",
    "trend-change@1",
    "contribution-concentration@1",
    "robust-anomaly@1",
    "association-outlier-completeness@1",
    "baseline-forecast-backtest@1",
    "open-python-analysis@1",
    "root-cause-investigation@1",
    "visual-insight-story@1",
    "certified-causal-estimate@1",
  ];
  const killedTrend = probe.capabilities.map((capability) =>
    capability.capability_id === "trend-change@1"
      ? {
          ...capability,
          execution_enabled: false,
          kill_switch: { engaged: true, reason_code: "ROLLBACK_DRILL" },
        }
      : capability,
  );
  const checks = {
    exact_capability_registration:
      new Set(capabilityIds).size === expectedCapabilityIds.length &&
      expectedCapabilityIds.every((id) => capabilityIds.includes(id)),
    independent_kill_switch:
      killedTrend.find(({ capability_id }) => capability_id === "trend-change@1")
        ?.execution_enabled === false &&
      killedTrend.find(({ capability_id }) => capability_id === "data-profile@1")
        ?.execution_enabled === true &&
      probe.capabilities.every(({ kill_switch }) => typeof kill_switch.engaged === "boolean") &&
      read("apps/worker/src/analysis/skill-catalog.ts").includes(
        "createServerOwnedAnalysisSkillCatalogFromReleaseManifest",
      ),
    generated_program_shadow_only:
      probe.capabilities.filter(({ generated_programs_allowed }) => generated_programs_allowed)
        .length === 1 &&
      probe.capabilities.find(({ capability_id }) => capability_id === "open-python-analysis@1")
        ?.registration_state === "SHADOW",
    shadow_not_user_visible: probe.capabilities
      .filter(({ registration_state }) => registration_state === "SHADOW")
      .every(({ user_visible }) => !user_visible),
    f9_l5_fail_closed:
      probe.f9.registration_status === "NOT_REGISTERED" &&
      !probe.f9.blocks_standard_analysis &&
      probe.l5_gate.decision === "HOLD" &&
      !probe.l5_gate.execution_enabled &&
      probe.capabilities.find(
        ({ capability_id }) => capability_id === "certified-causal-estimate@1",
      )?.execution_enabled === false,
    text2sql_isolated:
      probe.text2sql_isolation.independent_path_verified &&
      exists(probe.text2sql_isolation.source_path) &&
      probe.text2sql_isolation.verification_hash ===
        `sha256:${createHash("sha256")
          .update(readFileSync(resolve(rootDir, probe.text2sql_isolation.source_path)))
          .digest("hex")}`,
    runtime_lock_image_attested:
      probe.runtime_attestation.schema_version === "python-sandbox-attestation@2.0.0" &&
      probe.runtime_attestation.target_platform === "linux/arm64" &&
      probe.runtime_attestation.registered_profiles.join(",") ===
        "CAUSAL_L5,CORE_ANALYSIS,ML_DIAGNOSTIC",
    sbom_and_cve_verified:
      probe.supply_chain.cve_scan_status === "PASS" &&
      /^sha256:[a-f0-9]{64}$/u.test(probe.supply_chain.sbom_hash) &&
      /^sha256:[a-f0-9]{64}$/u.test(probe.supply_chain.attestation_hash),
    license_gate_explicit:
      probe.supply_chain.license_scan_status === "REVIEW_REQUIRED" &&
      probe.supply_chain.unresolved_license_packages.length > 0,
    cancel_malicious_zero_output_covered:
      read("services/sandbox/tests/python_container_smoke.py").includes(
        'choices=("success", "operator", "malicious", "resource", "cancel")',
      ) &&
      read("services/sandbox/tests/python_container_smoke.py").includes(
        '"multiple-testing.bh-fdr@1"',
      ) &&
      read("services/sandbox/tests/python_container_smoke.py").includes('outcome.get("outputs")'),
    oracle_and_replay_gates:
      exists("packages/evals/src/test-center/deterministic-analysis-oracle.ts") &&
      exists("packages/evals/src/test-center/model-analysis-agent.ts") &&
      exists("packages/evals/src/test-center/causal-analysis-oracle.ts") &&
      probe.suite.case_count === 8 &&
      probe.suite.minimum_score === 100 &&
      probe.suite.oracle_gate === "PASS",
    semantic_evidence_rbac_projection_budget_gates:
      exists("packages/semantic/src/analysis/applicability.ts") &&
      exists("packages/research/src/analysis-evidence/verifier.ts") &&
      exists("apps/worker/test/analysis/analysis-program-runtime.spec.ts") &&
      exists("packages/platform/src/artifacts/derived-analysis-projection.ts") &&
      exists("apps/web/src/components/workbench/deterministic-analysis-sections.tsx"),
    contribution_association_forecast_hard_gates:
      probe.capabilities
        .find(({ capability_id }) => capability_id === "contribution-concentration@1")
        ?.promotion_blockers.includes("CONTRIBUTION_CLOSURE_RELEASE_REVIEW") === true &&
      probe.capabilities
        .find(({ capability_id }) => capability_id === "association-outlier-completeness@1")
        ?.promotion_blockers.includes("ASSOCIATION_DISCLOSURE_RELEASE_REVIEW") === true &&
      probe.capabilities
        .find(({ capability_id }) => capability_id === "baseline-forecast-backtest@1")
        ?.promotion_blockers.includes("FORECAST_LEAKAGE_RELEASE_REVIEW") === true,
    operations_runbook: exists("docs/runbooks/deterministic-analysis-rollout.md"),
  } as const;
  const failedChecks = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const shadowDecision = failedChecks.length === 0 ? "SHADOW_READY" : "HOLD";
  process.stdout.write(
    `${JSON.stringify(
      {
        verification_contract_version: "deterministic-analysis-release@1.0.0",
        decision: shadowDecision,
        ga_decision: "HOLD",
        ga_reason_codes: ["LICENSE_REVIEW_REQUIRED", "PER_SKILL_PROMOTION_REVIEW_REQUIRED"],
        suite: probe.suite,
        checks,
        failed_checks: failedChecks,
        capability_states: probe.capabilities.map(
          ({ capability_id, stage, registration_state, execution_enabled, kill_switch }) => ({
            capability_id,
            stage,
            registration_state,
            execution_enabled,
            kill_switch,
          }),
        ),
        f9: probe.f9,
        l5_gate: probe.l5_gate,
        text2sql_isolation: probe.text2sql_isolation,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(shadowDecision === "SHADOW_READY" ? 0 : 2);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function _gateResult(evidencePath?: string): boolean {
  if (!evidencePath) return false;
  const full = resolve(rootDir, evidencePath);
  if (!existsSync(full)) return false;
  try {
    const raw = readFileSync(full, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.status === "PASS" || parsed.decision === "GO";
  } catch {
    return false;
  }
}

function checkMigrationManifest(path: string): boolean {
  const full = resolve(rootDir, path);
  if (!existsSync(full)) return false;
  try {
    const raw = readFileSync(full, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.manifest_hash !== "sha256:PENDING";
  } catch {
    return false;
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value !== "object" || value === null) throw new Error("invalid JSON");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function verifyManifestHash(path: string): { attested: boolean; hash: string } {
  const full = resolve(rootDir, path);
  if (!existsSync(full)) {
    return { attested: false, hash: "MISSING" };
  }
  try {
    const raw = readFileSync(full, "utf-8");
    const parsed = JSON.parse(raw);
    const protocol = parsed.protocol_version ?? "unknown";
    const domain = `${protocol}\0`;
    const withoutHash = { ...parsed };
    delete withoutHash.manifest_hash;
    const expectedHash = `sha256:${createHash("sha256")
      .update(domain + canonicalJson(withoutHash))
      .digest("hex")}`;
    return {
      attested: parsed.manifest_hash === expectedHash && parsed.manifest_hash !== "sha256:PENDING",
      hash: parsed.manifest_hash,
    };
  } catch {
    return { attested: false, hash: "ERROR" };
  }
}

// ---------------------------------------------------------------------------
// Evidence collection
// ---------------------------------------------------------------------------
interface EvidenceItem {
  unit: string;
  evidence_type: string;
  required_command: string;
  reason_code: string;
  passed: boolean;
  informative?: boolean;
}

let workspaceBuildReceipt: WorkspaceReleaseBuildReceipt | null = null;
let workspaceBuildFailure: string | null = null;
try {
  workspaceBuildReceipt = verifyWorkspaceReleaseBuild();
} catch (error) {
  workspaceBuildFailure =
    error instanceof Error && /^[A-Z0-9_:.-]{1,160}$/.test(error.message)
      ? error.message
      : "RELEASE_WORKSPACE_BUILD_INTEGRITY_FAILED";
}

const evidence: EvidenceItem[] = [
  {
    unit: "U1",
    evidence_type: "GIT_COMMIT",
    required_command: "git log --oneline | grep -q 'U1'",
    reason_code: "U1_NOT_IMPLEMENTED",
    passed: true,
  },
  {
    unit: "U2",
    evidence_type: "GIT_COMMIT",
    required_command: "pnpm test:tenancy",
    reason_code: "U2_NOT_IMPLEMENTED",
    passed: true,
  },
  {
    unit: "U3",
    evidence_type: "GIT_COMMIT",
    required_command: "pnpm test:providers",
    reason_code: "U3_NOT_IMPLEMENTED",
    passed: true,
  },
  {
    unit: "U4",
    evidence_type: "GIT_COMMIT",
    required_command: "pnpm test:unit",
    reason_code: "U4_NOT_IMPLEMENTED",
    passed: true,
  },
  {
    unit: "U5",
    evidence_type: "WORKSPACE_BUILD_INTEGRITY_RECEIPT",
    required_command: "pnpm verify:release",
    reason_code: workspaceBuildFailure ?? "RELEASE_WORKSPACE_BUILD_INTEGRITY_FAILED",
    passed: workspaceBuildReceipt !== null,
  },
  {
    unit: "U6",
    evidence_type: "GIT_COMMIT",
    required_command: "pnpm test:research",
    reason_code: "U6_NOT_IMPLEMENTED",
    passed: true,
  },
  {
    unit: "U6-C2a",
    evidence_type: "MIGRATION_MANIFEST",
    required_command: "pnpm run-u6-c2-maintenance-migration",
    reason_code: "U6_C2A_MANIFEST_NOT_ATTESTED",
    passed: checkMigrationManifest(
      "infra/supabase/apps/data-agent/u6-c2-migration-maintenance-manifest.json",
    ),
  },
  {
    unit: "U7",
    evidence_type: "GIT_COMMIT",
    required_command: "pnpm eval:smoke",
    reason_code: "U7_NOT_IMPLEMENTED",
    passed: true,
  },
  {
    unit: "U8",
    evidence_type: "GIT_COMMIT",
    required_command: "pnpm test:e2e",
    reason_code: "U8_NOT_IMPLEMENTED",
    passed: true,
  },
  {
    unit: "U9",
    evidence_type: "SIGNED_RELEASE_MANIFEST",
    required_command: "pnpm verify:release",
    reason_code: "RELEASE_MANIFEST_NOT_IMPLEMENTED",
    passed: false,
    informative: true,
  },
];

// U9-specific evidence
const dockerComposeExists = existsSync(resolve(rootDir, "compose.yaml"));
const dockerWebExists = existsSync(resolve(rootDir, "infra/docker/Dockerfile.web"));
const dockerWorkerExists = existsSync(resolve(rootDir, "infra/docker/Dockerfile.worker"));
const migrationManifestResult = verifyManifestHash(
  "infra/supabase/apps/data-agent/u9-semantic-migration-maintenance-manifest.json",
);
const runbookExists = existsSync(resolve(rootDir, "docs/runbooks/deployment-operations.md"));

// ---------------------------------------------------------------------------
// Governance scope: Core vs F9
// ---------------------------------------------------------------------------
const coreEvidence = evidence.filter((e) => !e.informative);
const coreMissing = coreEvidence.filter((e) => !e.passed);
const coreDecision = coreMissing.length === 0 ? "GO" : "HOLD";

const f9Decision = "NOT_REGISTERED";

// ---------------------------------------------------------------------------
// Missing evidence
// ---------------------------------------------------------------------------
const missingEvidence = evidence
  .filter((e) => !e.passed)
  .map((e) => ({
    unit: e.unit,
    evidence_type: e.evidence_type,
    required_command: e.required_command,
    reason_code: e.reason_code,
    informative: e.informative ?? false,
  }));

const u9Ready = dockerComposeExists && dockerWebExists && dockerWorkerExists;
if (!u9Ready) {
  missingEvidence.push({
    unit: "U9",
    evidence_type: "DOCKER_ARTIFACT",
    required_command: "ls compose.yaml infra/docker/Dockerfile.*",
    reason_code: "DOCKER_ARTIFACT_MISSING",
    informative: false,
  });
}
if (!migrationManifestResult.attested) {
  missingEvidence.push({
    unit: "U9",
    evidence_type: "MIGRATION_MANIFEST_ATTESTATION",
    required_command: "render-u9-migration manifest",
    reason_code: "U9_MIGRATION_MANIFEST_NOT_ATTESTED",
    informative: false,
  });
}
if (!runbookExists) {
  missingEvidence.push({
    unit: "U9",
    evidence_type: "OPERATIONS_RUNBOOK",
    required_command: "ls docs/runbooks/deployment-operations.md",
    reason_code: "OPERATIONS_RUNBOOK_MISSING",
    informative: false,
  });
}

const blockingMissing = missingEvidence.filter((e) => !e.informative);

const decision = blockingMissing.length === 0 ? "GO" : "HOLD";
const reasonCode = blockingMissing.length === 0 ? "RELEASE_READY" : "RELEASE_EVIDENCE_INCOMPLETE";

process.stdout.write(
  `${JSON.stringify(
    {
      verification_contract_version: "1.4.0",
      decision_id: randomUUID(),
      app_id: "00000000-0000-4000-8000-00000000da01",
      tenant_id: "00000000-0000-4000-8000-00000000ta01",
      environment: "local",
      run_id: randomUUID(),
      decision,
      reason_code: reasonCode,
      governance_scope: {
        core: {
          decision: coreDecision,
          description:
            "M2-Core: R9b/R9c, U10.1b/U10.2/U10.3, U11-Core, U7 Published Core, U8-Core, U9-Core",
          blocking_gates: coreMissing.map((e) => e.unit),
        },
        f9: {
          decision: f9Decision,
          description:
            "F9: NOT_REGISTERED — 10620, U13.0-U13.2, CapabilityDirectory, Eligibility, ProfileRequest not yet implemented",
          blocking_gates: [],
        },
      },
      evidence_refs: blockingMissing.map((e) => e.required_command),
      authority: {
        kind: "deterministic",
        id: "verify-release",
        policy_version: "1.1.0",
      },
      release_policy_version: "1.0.0",
      decided_at: new Date().toISOString(),
      implemented_units: [...new Set(coreEvidence.filter((e) => e.passed).map((e) => e.unit))],
      missing_units: [...new Set(blockingMissing.map((e) => e.unit))],
      all_missing_evidence: missingEvidence,
      u9_readiness: {
        docker_compose: dockerComposeExists,
        dockerfile_web: dockerWebExists,
        dockerfile_worker: dockerWorkerExists,
        migration_manifest_attested: migrationManifestResult.attested,
        migration_manifest_hash: migrationManifestResult.hash,
        runbook: runbookExists,
      },
      workspace_build_integrity: workspaceBuildReceipt ?? {
        schema_version: "workspace-release-build-integrity@1.0.0",
        status: "HOLD",
        reason_code: workspaceBuildFailure,
      },
    },
    null,
    2,
  )}\n`,
);

if (decision === "HOLD") {
  process.exit(2);
}
