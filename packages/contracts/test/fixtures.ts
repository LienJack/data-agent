import type { ArtifactReference } from "../src/artifacts/envelope.js";
import type { KnownArtifactType } from "../src/artifacts/types.js";

export const ids = {
  appA: "00000000-0000-4000-8000-000000000001",
  appB: "00000000-0000-4000-8000-000000000002",
  tenantA: "00000000-0000-4000-8000-000000000003",
  tenantB: "00000000-0000-4000-8000-000000000004",
  run: "00000000-0000-4000-8000-000000000005",
  artifact: "00000000-0000-4000-8000-000000000006",
  inputArtifact: "00000000-0000-4000-8000-000000000007",
  attempt: "00000000-0000-4000-8000-000000000008",
  decision: "00000000-0000-4000-8000-000000000009",
  receipt: "00000000-0000-4000-8000-000000000010",
  evalRun: "00000000-0000-4000-8000-000000000011",
  assignment: "00000000-0000-4000-8000-000000000012",
  command: "00000000-0000-4000-8000-000000000013",
  snapshot: "00000000-0000-4000-8000-000000000014",
} as const;

export const environments = {
  test: "test",
  staging: "staging",
} as const;

export const hashes = {
  artifact: `sha256:${"a".repeat(64)}`,
  input: `sha256:${"b".repeat(64)}`,
  execution: `sha256:${"c".repeat(64)}`,
} as const;

export function makeArtifactEnvelope() {
  return {
    artifact_id: ids.artifact,
    artifact_type: "QuestionFrame",
    app_id: ids.appA,
    tenant_id: ids.tenantA,
    environment: environments.test,
    run_id: ids.run,
    revision: 1,
    parent_ref: null,
    attempt_id: ids.attempt,
    producer: {
      kind: "deterministic",
      id: "question-frame-compiler",
    },
    input_refs: [],
    schema_version: "1.0.0",
    semantic_version: "retail-semantics@1.0.0",
    policy_version: "default-policy@1.0.0",
    model_profile_version: "none@1.0.0",
    content_hash: hashes.artifact,
    status: "COMMITTED",
    created_at: "2026-07-25T00:00:00.000Z",
  };
}

export function makeArtifactReference<const T extends KnownArtifactType = "QuestionFrame">(
  artifactType: T = "QuestionFrame" as T,
  artifactId: string = ids.inputArtifact,
) {
  return {
    artifact_id: artifactId,
    artifact_type: artifactType,
    app_id: ids.appA,
    tenant_id: ids.tenantA,
    environment: environments.test,
    run_id: ids.run,
    revision: 1,
    content_hash: hashes.input,
  };
}

export function makeRequiredGoEvidenceReferences(
  reportReadyCertificate: ArtifactReference = makeArtifactReference("ReportReadyCertificate"),
) {
  return [
    reportReadyCertificate,
    makeArtifactReference("ScoreCard"),
    makeArtifactReference("BenchmarkAdapterReceipt"),
    makeArtifactReference("SandboxExecutionReceipt"),
    makeArtifactReference("ModelCertificationReceipt"),
  ];
}

export function makeGoReleaseDecision(
  reportReadyCertificate: ArtifactReference = makeArtifactReference("ReportReadyCertificate"),
) {
  return {
    decision_id: ids.decision,
    app_id: ids.appA,
    tenant_id: ids.tenantA,
    environment: environments.test,
    run_id: ids.run,
    decision: "GO",
    reason_code: "RELEASE_EVIDENCE_COMPLETE",
    evidence_refs: makeRequiredGoEvidenceReferences(reportReadyCertificate),
    release_manifest_ref: makeArtifactReference("ReleaseManifest"),
    authority: {
      kind: "deterministic",
      id: "release-gate",
      policy_version: "1.0.0",
    },
    release_policy_version: "1.0.0",
    decided_at: "2026-07-25T00:00:00.000Z",
  };
}
