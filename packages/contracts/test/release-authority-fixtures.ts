import {
  type ArtifactReference,
  artifactReferenceFor,
  artifactReferenceIdentity,
} from "../src/artifacts/envelope.js";
import { computePostgresqlExecutionSettingsHash } from "../src/artifacts/text2sql-evidence.js";
import { sha256ContentHash } from "../src/common/index.js";
import {
  authorizeEvalRegistryAssignment,
  authorizeEvalRun,
  authorizeOracleVerdictReceipt,
  authorizeScoreCard,
  computeEvalRegistryAssignmentHash,
  computeEvalRunHash,
  computeOracleVerdictReceiptHash,
  computeScoreCardHash,
  evalRegistryAssignmentReference,
  evalRegistryAssignmentSchema,
  evalRunReference,
  evalRunSchema,
  oracleVerdictReceiptSchema,
  scoreCardReference,
  scoreCardSchema,
} from "../src/evals/index.js";
import { authorizeBenchmarkAdapterReceipt } from "../src/ports/index.js";
import { authorizeModelCertificationReceipt } from "../src/providers/index.js";
import {
  authorizeReleaseManifest,
  computeReleaseManifestHash,
  type ReleaseAuthorityContext,
  type ReleaseDecision,
} from "../src/runs/index.js";
import { InMemorySandboxPort, ManualClock } from "../src/testing/index.js";
import { createAuthoritativeReadyFixture } from "./authority-fixtures.js";
import { environments, hashes, ids, makeArtifactReference } from "./fixtures.js";

const replayTuple = {
  state: "REPLAYABLE",
  source_commit: "2964482",
  data_snapshot_hash: hashes.input,
  schema_version: "1.0.0",
  semantic_version: "retail-semantics@1.0.0",
  policy_version: "default-policy@1.0.0",
  model_profile_id: ids.artifact,
  model_profile_version: "1.0.0",
  prompt_version: "1.0.0",
  workflow_version: "1.0.0",
  evaluator_version: "1.0.0",
  seed: 7,
  budget: {
    max_cases: 1,
    max_duration_ms: 30_000,
  },
  trace: {
    trace_id: ids.attempt,
    trace_hash: hashes.execution,
  },
} as const;

export async function createAuthoritativeReleaseFixture(
  options: {
    readonly scoreVerdict?: "PASS" | "FAIL" | "INCONCLUSIVE";
    readonly safetyViolationCount?: number;
  } = {},
) {
  const ready = await createAuthoritativeReadyFixture();
  const readyCertificateReference = artifactReferenceFor("ReportReadyCertificate").parse(
    ready.certificateReference,
  );
  const caseReference = makeArtifactReference("EvalCase", ids.artifact);

  const assignmentDraft = evalRegistryAssignmentSchema.parse({
    assignment_id: ids.artifact,
    assignment_version: 1,
    case_ref: caseReference,
    registry: "DEMO",
    registry_policy_version: "1.0.0",
    previous_assignment_ref: null,
    assignment_hash: hashes.artifact,
    assigned_at: "2026-07-25T00:00:00.000Z",
    authority: {
      kind: "deterministic",
      id: "eval-registry",
      policy_version: "1.0.0",
    },
  });
  const assignmentInput = {
    ...assignmentDraft,
    assignment_hash: await computeEvalRegistryAssignmentHash(assignmentDraft),
  };
  const assignment = await authorizeEvalRegistryAssignment(assignmentInput, {
    verifyCase: async () => true,
    resolveCurrent: async () => null,
    compareAndSwap: async () => true,
  });
  const assignmentReference = evalRegistryAssignmentReference(assignment);

  const evalRunDraft = evalRunSchema.parse({
    eval_run_id: ids.evalRun,
    eval_run_version: 1,
    case_ref: caseReference,
    registry_assignment_ref: assignmentReference,
    suite: "dab",
    suite_version: "1.0.0",
    dataset_version: "1.0.0",
    oracle_version: "1.0.0",
    oracle_type: "RESULT_EQUIVALENCE",
    manifest_version: "1.0.0",
    replay: replayTuple,
    started_at: "2026-07-25T00:00:00.000Z",
    completed_at: "2026-07-25T00:01:00.000Z",
    status: "COMPLETED",
    eval_run_hash: hashes.artifact,
  });
  const evalRunInput = {
    ...evalRunDraft,
    eval_run_hash: await computeEvalRunHash(evalRunDraft),
  };
  const evalRun = await authorizeEvalRun(evalRunInput, {
    verifyCase: async () => true,
    verifyCommitted: async () => true,
    resolveRegistryAssignment: async () => assignment,
    resolveCurrentRegistryAssignment: async () => assignment,
  });
  const evalRunArtifactReference = evalRunReference(evalRun);

  const oracleReceiptReferenceDraft = makeArtifactReference("OracleVerdictReceipt", ids.decision);
  const oracleReceiptDraft = oracleVerdictReceiptSchema.parse({
    schema_version: "1.0.0",
    receipt_ref: oracleReceiptReferenceDraft,
    case_ref: caseReference,
    eval_run_ref: evalRunArtifactReference,
    suite: "dab",
    suite_version: "1.0.0",
    dataset_version: "1.0.0",
    oracle_version: "1.0.0",
    oracle_type: "RESULT_EQUIVALENCE",
    deterministic_verdict: options.scoreVerdict ?? "PASS",
    oracle_result_hash: hashes.execution,
    evaluated_at: "2026-07-25T00:01:30.000Z",
    receipt_hash: oracleReceiptReferenceDraft.content_hash,
  });
  const oracleReceiptHash = await computeOracleVerdictReceiptHash(oracleReceiptDraft);
  const oracleReceiptInput = {
    ...oracleReceiptDraft,
    receipt_ref: {
      ...oracleReceiptDraft.receipt_ref,
      content_hash: oracleReceiptHash,
    },
    receipt_hash: oracleReceiptHash,
  };
  const oracleReceipt = await authorizeOracleVerdictReceipt(oracleReceiptInput.receipt_ref, {
    resolveCommitted: async (reference) =>
      sameReference(reference, oracleReceiptInput.receipt_ref) ? oracleReceiptInput : null,
    verifyCommitted: async () => true,
    verifyDeterministicOracle: async (receipt) =>
      sameReference(receipt.case_ref, caseReference) &&
      sameReference(receipt.eval_run_ref, evalRunArtifactReference) &&
      receipt.oracle_result_hash === hashes.execution &&
      receipt.deterministic_verdict === (options.scoreVerdict ?? "PASS"),
  });

  const scoreCardDraft = scoreCardSchema.parse({
    scorecard_id: ids.receipt,
    scorecard_version: 1,
    case_ref: caseReference,
    eval_run_ref: evalRunArtifactReference,
    suite: "dab",
    suite_version: "1.0.0",
    dataset_version: "1.0.0",
    oracle_version: "1.0.0",
    oracle_type: "RESULT_EQUIVALENCE",
    deterministic_verdict: options.scoreVerdict ?? "PASS",
    oracle_verdict_receipt_ref: oracleReceipt.receipt_ref,
    comparison: {
      mode: "SINGLE",
    },
    evidence_refs: [readyCertificateReference],
    latency: {
      total_ms: 120,
      model_ms: 80,
      execution_ms: 40,
    },
    usage: {
      availability: "AVAILABLE",
      input_tokens: 100,
      output_tokens: 50,
    },
    safety_counters: [
      {
        counter_id: "policy_violations",
        count: options.safetyViolationCount ?? 0,
      },
    ],
    failure_taxonomy: [],
    scorecard_hash: hashes.artifact,
  });
  const scoreCardInput = {
    ...scoreCardDraft,
    scorecard_hash: await computeScoreCardHash(scoreCardDraft),
  };
  const scoreCard = await authorizeScoreCard(scoreCardInput, {
    resolveEvalRun: async () => evalRun,
    resolveRegistryAssignment: async () => assignment,
    resolveOracleVerdictReceipt: async (reference) =>
      sameReference(reference, oracleReceipt.receipt_ref) ? oracleReceipt : null,
    verifyCommitted: async () => true,
  });
  const scoreCardArtifactReference = artifactReferenceFor("ScoreCard").parse(
    scoreCardReference(scoreCard),
  );

  const modelReceiptReference = makeArtifactReference(
    "ModelCertificationReceipt",
    ids.inputArtifact,
  );
  const modelReceiptClaims = {
    schema_version: "1.0.0",
    receipt_ref: modelReceiptReference,
    profile_id: ids.artifact,
    provider: "openai",
    model_id: "verified-model",
    profile_version: "1.0.0",
    profile_hash: hashes.input,
    probe_hash: hashes.execution,
    verdict: "PASS" as const,
  };
  const modelReceipt = await authorizeModelCertificationReceipt(modelReceiptReference, {
    resolve: async () => modelReceiptClaims,
    verifyCommitted: async () => true,
  });

  const benchmarkReceiptReference = makeArtifactReference(
    "BenchmarkAdapterReceipt",
    ids.inputArtifact,
  );
  const benchmarkReceipt = await authorizeBenchmarkAdapterReceipt(
    {
      schema_version: "1.0.0",
      receipt_ref: benchmarkReceiptReference,
      adapter_run_id: ids.decision,
      attempt_id: ids.attempt,
      scope: {
        app_id: ids.appA,
        tenant_id: ids.tenantA,
        environment: environments.test,
      },
      run_id: ids.run,
      suite: "dab",
      suite_version: "1.0.0",
      dataset_version: "1.0.0",
      oracle_version: "1.0.0",
      case_ref: caseReference,
      eval_run_ref: evalRunArtifactReference,
      scorecard_ref: scoreCardArtifactReference,
      terminal: "COMPLETED",
      reason_code: "BENCHMARK_COMPLETED",
      observed_at: "2026-07-25T00:01:00.000Z",
    },
    async () => true,
  );

  const sandboxScope = {
    app_id: ids.appA,
    tenant_id: ids.tenantA,
    environment: environments.test,
  } as const;
  const sandboxExecutionSettings = {
    database_role: "analyst",
    search_path: ["app_data_agent", "pg_catalog"] as string[],
    plan_cache_mode: "force_custom_plan" as const,
    statement_timeout_ms: 1_000,
    lock_timeout_ms: 100,
  };
  const sandboxSettingsHash =
    await computePostgresqlExecutionSettingsHash(sandboxExecutionSettings);
  const sandboxBudget = {
    timeout_ms: 1_000,
    lock_timeout_ms: 100,
    max_rows: 1_000,
    max_bytes: 1_000_000,
    max_memory_mb: 256,
  } as const;
  const sandboxSqlReference = makeArtifactReference("SqlArtifact", ids.artifact);
  const sandboxResourceAdmissionReference = makeArtifactReference(
    "ResourceAdmissionReceipt",
    ids.assignment,
  );
  const sandboxExecutionPermitReference = makeArtifactReference("ExecutionPermit", ids.command);
  const sandboxExecutionPermit = {
    artifact_type: "ExecutionPermit",
    sql_artifact_ref: sandboxSqlReference,
    resource_admission_ref: sandboxResourceAdmissionReference,
    gate_receipt_refs: [
      makeArtifactReference("GateReceipt", "00000000-0000-4000-8000-000000000201"),
      makeArtifactReference("GateReceipt", "00000000-0000-4000-8000-000000000202"),
      makeArtifactReference("GateReceipt", "00000000-0000-4000-8000-000000000203"),
      makeArtifactReference("GateReceipt", "00000000-0000-4000-8000-000000000204"),
      makeArtifactReference("GateReceipt", "00000000-0000-4000-8000-000000000205"),
    ],
    datasource_id: ids.tenantA,
    schema_version: "1.0.0",
    settings_hash: sandboxSettingsHash,
    execution_settings: sandboxExecutionSettings,
    principal_id: "release-analyst@example.test",
    policy_receipt_ref: makeArtifactReference("PolicyReceipt", ids.snapshot),
    budget: sandboxBudget,
    issued_at: "2026-07-24T23:59:00.000Z",
    expires_at: "2026-07-25T00:04:00.000Z",
  } as const;
  const sandboxRequest = {
    schema_version: sandboxExecutionPermit.schema_version,
    scope: sandboxScope,
    run_id: ids.run,
    execution_id: ids.decision,
    idempotency_key: "release-fixture",
    language: "sql",
    payload: {
      dialect: "postgresql",
      sql_artifact_ref: sandboxSqlReference,
      execution_permit_ref: sandboxExecutionPermitReference,
      resource_admission_ref: sandboxResourceAdmissionReference,
      datasource_id: sandboxExecutionPermit.datasource_id,
      settings_hash: sandboxSettingsHash,
      execution_settings: sandboxExecutionSettings,
      snapshot_requirement: {
        mode: "REQUIRE_REPLAYABLE",
      },
      parameters: {},
    },
    budget: sandboxBudget,
  } as const;
  const sandbox = new InMemorySandboxPort(new ManualClock("2026-07-25T00:00:00.000Z"));
  const sandboxSqlArtifactMaterial = {
    dialect: "postgresql",
    sql: "select 1 as result",
    parameters: sandboxRequest.payload.parameters,
  } as const;
  sandbox.commitAuthoritativeSqlArtifact(sandboxSqlReference, {
    artifact_type: "SqlArtifact",
    logical_plan_ref: {
      ...sandboxSqlReference,
      artifact_type: "LogicalPlan",
      content_hash: hashes.artifact,
    },
    compiler_version: "postgresql-compiler@1.1.0",
    ast_hash: hashes.artifact,
    ...sandboxSqlArtifactMaterial,
    query_hash: await sha256ContentHash(sandboxSqlArtifactMaterial),
  });
  sandbox.commitAuthoritativeExecutionPermit(
    sandboxExecutionPermitReference,
    sandboxExecutionPermit,
  );
  const sandboxExecution = await sandbox.execute(sandboxRequest);
  if (!sandboxExecution.ok || sandboxExecution.value.terminal !== "COMPLETED") {
    throw new Error("Release Fixture 的 Sandbox Request 必须由有效 Permit 成功执行。");
  }
  const sandboxReceipt = await sandbox.authorizeExecutionReceipt(
    sandboxExecution.value.receipt_ref,
  );

  const decisionEvidenceReferences = [
    readyCertificateReference,
    scoreCardArtifactReference,
    benchmarkReceiptReference,
    sandboxReceipt.receipt_ref,
    modelReceiptReference,
  ] as const;
  const manifestDraft = {
    schema_version: "1.0.0",
    manifest_ref: makeArtifactReference("ReleaseManifest", ids.decision),
    release_policy_version: "1.0.0",
    source_commit: "2964482",
    contract_version: "contracts@0.1.0",
    component_versions: {
      contracts: "0.1.0",
      runtime: "0.1.0",
    },
    workflow_version: "l2-research@1.0.0",
    eval_run_refs: [evalRunArtifactReference],
    tenancy_evidence_refs: [assignmentReference],
    deployment_evidence: {
      hosted_refs: [makeArtifactReference("ExternalAgentAuditReceipt")],
      docker_refs: [makeArtifactReference("SandboxProgram")],
    },
    signed_outcome_refs: [...decisionEvidenceReferences],
    verdict: "PASS" as const,
    created_at: "2026-07-25T00:02:00.000Z",
    manifest_hash: hashes.input,
  };
  const manifestHash = await computeReleaseManifestHash(manifestDraft);
  const manifestInput = {
    ...manifestDraft,
    manifest_ref: {
      ...manifestDraft.manifest_ref,
      content_hash: manifestHash,
    },
    manifest_hash: manifestHash,
  };
  const manifest = await authorizeReleaseManifest(manifestInput.manifest_ref, {
    resolveCommitted: async () => manifestInput,
    verifyCommitted: async () => true,
  });

  const decisionInput: ReleaseDecision = {
    decision_id: ids.decision,
    app_id: ids.appA,
    tenant_id: ids.tenantA,
    environment: environments.test,
    run_id: ids.run,
    decision: "GO",
    reason_code: "RELEASE_EVIDENCE_COMPLETE",
    evidence_refs: [...decisionEvidenceReferences],
    release_manifest_ref: manifest.manifest_ref,
    authority: {
      kind: "deterministic",
      id: "release-gate",
      policy_version: "1.0.0",
    },
    release_policy_version: "1.0.0",
    decided_at: "2026-07-25T00:03:00.000Z",
  };

  const {
    resolveGroundingAuthority,
    resolveSystemArtifact,
    verifySystemArtifactCommitted,
    verifyResourceAdmissionReceipt,
    resolveAuthoritativeMetamorphicFixtureReceipt,
    resolveAuthoritativeMetamorphicOracleReceipt,
    resolveAuthoritativeResultOracleReceipt,
    resolveAuthoritativeSandboxExecutionReceipt,
    resolveAuthoritativeSandboxResult,
    verifySqlArtifactCompilation,
  } = ready.authority;
  if (
    !resolveGroundingAuthority ||
    !resolveSystemArtifact ||
    !verifySystemArtifactCommitted ||
    !verifyResourceAdmissionReceipt ||
    !resolveAuthoritativeMetamorphicFixtureReceipt ||
    !resolveAuthoritativeMetamorphicOracleReceipt ||
    !resolveAuthoritativeResultOracleReceipt ||
    !resolveAuthoritativeSandboxExecutionReceipt ||
    !resolveAuthoritativeSandboxResult ||
    !verifySqlArtifactCompilation
  ) {
    throw new Error("Release Fixture 缺少完整的 L2/System Artifact Authority。");
  }
  const authority: ReleaseAuthorityContext = {
    principalId: ready.authority.principalId,
    verifyCommitted: async (reference) =>
      reference.artifact_type === "ReportReadyCertificate"
        ? ready.authority.verifyCommitted(reference)
        : true,
    resolveL2: ready.authority.resolveL2,
    resolveGroundingAuthority,
    resolveSystemArtifact,
    verifySystemArtifactCommitted,
    verifySqlArtifactCompilation,
    verifyResourceAdmissionReceipt,
    resolveAuthoritativeMetamorphicFixtureReceipt,
    resolveAuthoritativeMetamorphicOracleReceipt,
    resolveAuthoritativeResultOracleReceipt,
    resolveAuthoritativeSandboxExecutionReceipt,
    resolveAuthoritativeSandboxResult,
    verifyCommitterCapability: ready.authority.verifyCommitterCapability,
    resolveScoreCard: async (reference) =>
      sameReference(reference, scoreCardArtifactReference) ? scoreCard : null,
    resolveBenchmarkAdapterReceipt: async (reference) =>
      sameReference(reference, benchmarkReceiptReference) ? benchmarkReceipt : null,
    resolveSandboxExecutionReceipt: async (reference) =>
      sameReference(reference, sandboxReceipt.receipt_ref) ? sandboxReceipt : null,
    resolveModelCertificationReceipt: async (reference) =>
      sameReference(reference, modelReceiptReference) ? modelReceipt : null,
    resolveReleaseManifest: async (reference) =>
      sameReference(reference, manifest.manifest_ref) ? manifest : null,
  };

  return {
    authority,
    decisionInput,
    evidence: {
      assignment,
      benchmarkReceipt,
      evalRun,
      manifest,
      modelReceipt,
      oracleReceipt,
      ready,
      sandboxReceipt,
      scoreCard,
    },
  };
}

function sameReference(left: ArtifactReference, right: ArtifactReference): boolean {
  return artifactReferenceIdentity(left) === artifactReferenceIdentity(right);
}
