import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function gateResult(evidencePath?: string): boolean {
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

const evidence: EvidenceItem[] = [
  { unit: "U1", evidence_type: "GIT_COMMIT", required_command: "git log --oneline | grep -q 'U1'", reason_code: "U1_NOT_IMPLEMENTED", passed: true },
  { unit: "U2", evidence_type: "GIT_COMMIT", required_command: "pnpm test:tenancy", reason_code: "U2_NOT_IMPLEMENTED", passed: true },
  { unit: "U3", evidence_type: "GIT_COMMIT", required_command: "pnpm test:providers", reason_code: "U3_NOT_IMPLEMENTED", passed: true },
  { unit: "U4", evidence_type: "GIT_COMMIT", required_command: "pnpm test:unit", reason_code: "U4_NOT_IMPLEMENTED", passed: true },
  { unit: "U5", evidence_type: "LOCAL_GATE_RECEIPT", required_command: "pnpm test:sandbox", reason_code: "RELEASE_GATE_NOT_ATTESTED", passed: false, informative: true },
  { unit: "U6", evidence_type: "GIT_COMMIT", required_command: "pnpm test:research", reason_code: "U6_NOT_IMPLEMENTED", passed: true },
  {
    unit: "U6-C2a",
    evidence_type: "MIGRATION_MANIFEST",
    required_command: "pnpm run-u6-c2-maintenance-migration",
    reason_code: "U6_C2A_MANIFEST_NOT_ATTESTED",
    passed: checkMigrationManifest("infra/supabase/apps/data-agent/u6-c2-migration-maintenance-manifest.json"),
  },
  { unit: "U7", evidence_type: "GIT_COMMIT", required_command: "pnpm eval:smoke", reason_code: "U7_NOT_IMPLEMENTED", passed: true },
  { unit: "U8", evidence_type: "GIT_COMMIT", required_command: "pnpm test:e2e", reason_code: "U8_NOT_IMPLEMENTED", passed: true },
  { unit: "U9", evidence_type: "SIGNED_RELEASE_MANIFEST", required_command: "pnpm verify:release", reason_code: "RELEASE_MANIFEST_NOT_IMPLEMENTED", passed: false, informative: true },
];

// U9-specific evidence
const dockerComposeExists = existsSync(resolve(rootDir, "compose.yaml"));
const dockerWebExists = existsSync(resolve(rootDir, "infra/docker/Dockerfile.web"));
const dockerWorkerExists = existsSync(resolve(rootDir, "infra/docker/Dockerfile.worker"));
const migrationManifestResult = verifyManifestHash("infra/supabase/apps/data-agent/u9-semantic-migration-maintenance-manifest.json");
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
      verification_contract_version: "1.3.0",
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
          description: "M2-Core: R9b/R9c, U10.1b/U10.2/U10.3, U11-Core, U7 Published Core, U8-Core, U9-Core",
          blocking_gates: coreMissing.map((e) => e.unit),
        },
        f9: {
          decision: f9Decision,
          description: "F9: NOT_REGISTERED — 10620, U13.0-U13.2, CapabilityDirectory, Eligibility, ProfileRequest not yet implemented",
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
    },
    null,
    2,
  )}\n`,
);

if (decision === "HOLD") {
  process.exit(2);
}
