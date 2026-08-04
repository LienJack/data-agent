import { describe, expect, it } from "vitest";
import { type ArtifactReference, artifactReferenceIdentity } from "../src/artifacts/envelope.js";
import {
  capabilityDeliveryReceiptSchema,
  deferredCapabilityDescriptorSchema,
  EXECUTABLE_CAPABILITY_REGISTRY,
  executableCapabilityRegistrationSchema,
  issueCapabilityDeliveryReceipt,
  l3ContractArtifactSchema,
  l4ContractArtifactSchema,
  l5ContractArtifactSchema,
} from "../src/capabilities/index.js";
import {
  authorizeEvalCase,
  authorizeEvalRegistryAssignment,
  authorizeEvalRun,
  authorizeOracleVerdictReceipt,
  authorizeScoreCard,
  benchmarkOracleSchema,
  benchmarkSuiteSchema,
  computeEvalCaseHash,
  computeEvalRegistryAssignmentHash,
  computeEvalRunHash,
  computeOracleVerdictReceiptHash,
  computeScoreCardHash,
  evalCaseSchema,
  evalRegistryAssignmentReference,
  evalRegistryAssignmentSchema,
  evalRunReference,
  evalRunSchema,
  isAuthoritativeEvalCase,
  isAuthoritativeEvalRegistryAssignment,
  isAuthoritativeEvalRun,
  isAuthoritativeOracleVerdictReceipt,
  isAuthoritativeScoreCard,
  oracleVerdictReceiptSchema,
  resolveAuthoritativeEvalRegistryAssignment,
  scoreCardSchema,
} from "../src/evals/index.js";
import {
  authorizeAvailableModelProfile,
  authorizeModelCertificationReceipt,
  computeModelProfileHash,
  externalAgentProfileSchema,
  isAuthoritativeModelCertificationReceipt,
  isAvailableModelProfile,
  MODEL_PROVIDERS,
  ModelCertificationError,
  modelProfileSchema,
} from "../src/providers/index.js";
import {
  AuthorityEvidenceError,
  authorizeReleaseDecision,
  releaseDecisionSchema,
} from "../src/runs/index.js";
import {
  environments,
  hashes,
  ids,
  makeArtifactReference,
  makeRequiredGoEvidenceReferences,
} from "./fixtures.js";
import { createAuthoritativeReleaseFixture } from "./release-authority-fixtures.js";

const evalReplayTuple = {
  state: "REPLAYABLE",
  source_commit: "abcdef0",
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
    max_cost_micros: 1_000_000,
  },
  trace: {
    trace_id: ids.attempt,
    trace_hash: hashes.execution,
  },
} as const;

const scoreCardOperationalFacts = {
  latency: {
    total_ms: 120,
    model_ms: 80,
    execution_ms: 40,
  },
  cost: {
    currency: "USD",
    amount_micros: 25_000,
    input_tokens: 100,
    output_tokens: 50,
  },
  safety_counters: [{ counter_id: "policy_violations", count: 0 }],
  failure_taxonomy: [],
} as const;

async function createOracleVerdictReceiptInput({
  caseReference,
  evalRunReference: evalRunArtifactReference,
  deterministicVerdict = "PASS",
  receiptArtifactId = ids.decision,
  suite = "dab",
  suiteVersion = "1.0.0",
  datasetVersion = "1.0.0",
  oracleVersion = "1.0.0",
}: {
  readonly caseReference: ArtifactReference;
  readonly evalRunReference: ArtifactReference;
  readonly deterministicVerdict?: "PASS" | "FAIL" | "INCONCLUSIVE";
  readonly receiptArtifactId?: string;
  readonly suite?: "insightbench" | "dab" | "rcaeval" | "controlled-attribution";
  readonly suiteVersion?: string;
  readonly datasetVersion?: string;
  readonly oracleVersion?: string;
}) {
  const oracleTypeBySuite = {
    insightbench: "ANALYSIS_REPORT_QUALITY",
    dab: "RESULT_EQUIVALENCE",
    rcaeval: "ROOT_CAUSE_RANKING",
    "controlled-attribution": "ATTRIBUTION_MATCH",
  } as const;
  const receiptReference = makeArtifactReference("OracleVerdictReceipt", receiptArtifactId);
  const draft = oracleVerdictReceiptSchema.parse({
    schema_version: "1.0.0",
    receipt_ref: receiptReference,
    case_ref: caseReference,
    eval_run_ref: evalRunArtifactReference,
    suite,
    suite_version: suiteVersion,
    dataset_version: datasetVersion,
    oracle_version: oracleVersion,
    oracle_type: oracleTypeBySuite[suite],
    deterministic_verdict: deterministicVerdict,
    oracle_result_hash: hashes.execution,
    evaluated_at: "2026-07-25T00:01:30.000Z",
    receipt_hash: receiptReference.content_hash,
  });
  const receiptHash = await computeOracleVerdictReceiptHash(draft);
  return {
    ...draft,
    receipt_ref: {
      ...draft.receipt_ref,
      content_hash: receiptHash,
    },
    receipt_hash: receiptHash,
  };
}

async function authorizeTestOracleVerdictReceipt(
  input: Awaited<ReturnType<typeof createOracleVerdictReceiptInput>>,
) {
  return authorizeOracleVerdictReceipt(input.receipt_ref, {
    resolveCommitted: async (reference) =>
      artifactReferenceIdentity(reference) === artifactReferenceIdentity(input.receipt_ref)
        ? input
        : null,
    verifyCommitted: async () => true,
    verifyDeterministicOracle: async (receipt) => receipt.oracle_result_hash === hashes.execution,
  });
}

describe("延后能力边界", () => {
  it.each(["L3", "L4", "L5"] as const)("%s 只能解析为 CONTRACT_ONLY", (level) => {
    expect(
      deferredCapabilityDescriptorSchema.parse({
        level,
        contract_version: "1.0.0",
        delivery_state: "CONTRACT_ONLY",
        public_message: "未交付",
      }).delivery_state,
    ).toBe("CONTRACT_ONLY");

    expect(
      deferredCapabilityDescriptorSchema.safeParse({
        level,
        contract_version: "1.0.0",
        delivery_state: "DELIVERED",
        public_message: "已交付",
      }).success,
    ).toBe(false);
  });

  it.each(["L3", "L4", "L5"] as const)("%s 不能产生首版交付 Receipt", (level) => {
    expect(
      capabilityDeliveryReceiptSchema.safeParse({
        receipt_id: ids.receipt,
        level,
        state: "DELIVERED",
        release_decision_id: ids.decision,
        evidence_refs: [ids.artifact],
        issued_at: "2026-07-25T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });

  it("L2 交付 Receipt 必须显式绑定 GO 决策和 Evidence", () => {
    const receipt = {
      receipt_id: ids.receipt,
      level: "L2",
      state: "DELIVERED",
      release_decision_id: ids.decision,
      evidence_refs: makeRequiredGoEvidenceReferences(),
      issued_at: "2026-07-25T00:00:00.000Z",
    };

    expect(capabilityDeliveryReceiptSchema.safeParse(receipt).success).toBe(false);
    expect(
      capabilityDeliveryReceiptSchema.safeParse({
        ...receipt,
        release_decision: {
          decision_id: ids.decision,
          app_id: ids.appA,
          tenant_id: ids.tenantA,
          environment: environments.test,
          run_id: ids.run,
          decision: "GO",
          reason_code: "RELEASE_EVIDENCE_COMPLETE",
          evidence_refs: makeRequiredGoEvidenceReferences(),
          release_manifest_ref: makeArtifactReference("ReleaseManifest"),
          authority: {
            kind: "deterministic",
            id: "release-gate",
            policy_version: "1.0.0",
          },
          release_policy_version: "1.0.0",
          decided_at: "2026-07-25T00:00:00.000Z",
        },
      }).success,
    ).toBe(true);
  });

  it("Receipt Issuer 在运行时拒绝仅经 Schema Parse 的伪 GO", async () => {
    const fixture = await createAuthoritativeReleaseFixture();
    const { decisionInput } = fixture;
    const rawDecision = releaseDecisionSchema.parse(decisionInput);
    const receiptInput = {
      receipt_id: ids.receipt,
      level: "L2" as const,
      state: "DELIVERED" as const,
      release_decision_id: ids.decision,
      evidence_refs: [...decisionInput.evidence_refs],
      issued_at: "2026-07-25T00:00:00.000Z",
    };

    expect(() => issueCapabilityDeliveryReceipt(receiptInput, rawDecision as never)).toThrow(
      AuthorityEvidenceError,
    );

    await expect(authorizeReleaseDecision(decisionInput, fixture.authority)).rejects.toMatchObject({
      code: "CURRENT_RELEASE_COMMIT_REQUIRED",
      retryable: false,
    });
  });

  it("L3–L5 Artifact Contract 可解析但始终不可执行", () => {
    expect(
      l3ContractArtifactSchema.parse({
        level: "L3",
        artifact_type: "ExperimentPlan",
        contract_version: "1.0.0",
        delivery_state: "CONTRACT_ONLY",
        executable: false,
        hypothesis_ref: ids.artifact,
        dag_node_contracts: ["dataset", "transform", "statistical-test"],
        public_message: "未交付",
      }).executable,
    ).toBe(false);

    expect(
      l4ContractArtifactSchema.parse({
        level: "L4",
        artifact_type: "ObservationSpec",
        contract_version: "1.0.0",
        delivery_state: "CONTRACT_ONLY",
        executable: false,
        observation_target_ref: ids.artifact,
        novelty_policy_version: "1.0.0",
        multiple_testing_policy_version: "1.0.0",
        public_message: "未交付",
      }).executable,
    ).toBe(false);

    expect(
      l5ContractArtifactSchema.parse({
        level: "L5",
        artifact_type: "IdentificationPlan",
        contract_version: "1.0.0",
        delivery_state: "CONTRACT_ONLY",
        executable: false,
        causal_question_ref: ids.artifact,
        estimand: "ATE",
        assumptions: ["exchangeability", "positivity", "consistency"],
        public_message: "未交付",
      }).executable,
    ).toBe(false);
  });

  it("唯一 Executable Registry 在 U1 为空，且注册契约只接受 L2", async () => {
    expect(EXECUTABLE_CAPABILITY_REGISTRY).toEqual([]);
    expect(
      executableCapabilityRegistrationSchema.safeParse({
        capability_id: "causal-scientist",
        level: "L5",
        kind: "workflow",
        entrypoint: "run-causal-analysis",
      }).success,
    ).toBe(false);

    const publicContracts = await import("../src/index.js");
    const deferredExecutablePattern =
      /(?:(?:l[345]|experiment|observation|causal).*(?:run|start|create|execute|register|invoke|schedule|launch|factory|route|tool|workflow|handler|executor)|(?:run|start|create|execute|register|invoke|schedule|launch|factory|route|tool|workflow|handler|executor).*(?:l[345]|experiment|observation|causal))/i;
    expect(
      [
        "l5Workflow",
        "executeL5Estimate",
        "createCausalWorkflow",
        "runCausalAnalysis",
        "startExperiment",
      ].filter((name) => deferredExecutablePattern.test(name)),
    ).toHaveLength(5);
    const executableExports = Object.keys(publicContracts).filter((name) =>
      deferredExecutablePattern.test(name),
    );
    expect(executableExports).toEqual(
      EXECUTABLE_CAPABILITY_REGISTRY.map(({ entrypoint }) => entrypoint),
    );
  });
});

describe("Provider 与 External Agent 契约", () => {
  it("固定七类 Model Provider，默认不能伪装为 AVAILABLE", () => {
    expect(MODEL_PROVIDERS).toEqual([
      "openai",
      "anthropic",
      "deepseek",
      "glm",
      "kimi",
      "grok",
      "gemini",
    ]);

    expect(
      modelProfileSchema.safeParse({
        profile_id: ids.artifact,
        scope: {
          app_id: ids.appA,
          tenant_id: ids.tenantA,
          environment: environments.test,
        },
        provider: "openai",
        model_id: "example-model",
        profile_version: "1.0.0",
        capabilities: {
          structured_output: true,
          tool_calling: true,
          streaming: true,
          reasoning: true,
          vision: false,
        },
        certification_status: "AVAILABLE",
      }).success,
    ).toBe(false);
  });

  it("External Agent 使用独立 Workspace/Permission/Cancel/Audit Envelope", () => {
    expect(
      externalAgentProfileSchema.safeParse({
        profile_id: ids.inputArtifact,
        profile_version: "1.0.0",
        scope: {
          app_id: ids.appA,
          tenant_id: ids.tenantA,
          environment: environments.test,
        },
        kind: "EXTERNAL_AGENT",
        adapter: "claude-code",
        workspace_policy: { roots: ["/workspace"], writable: false },
        permission_policy: { allowed_tools: [], allowed_command_ids: [] },
        cancellation: { supported: true, timeout_ms: 5000 },
        audit: { required: true, receipt_schema_version: "1.0.0" },
      }).success,
    ).toBe(true);
    expect(
      externalAgentProfileSchema.safeParse({
        profile_id: ids.inputArtifact,
        profile_version: "1.0.0",
        scope: {
          app_id: ids.appA,
          tenant_id: ids.tenantA,
          environment: environments.test,
        },
        kind: "EXTERNAL_AGENT",
        adapter: "claude-code",
        workspace_policy: { roots: ["/workspace/../secrets"], writable: true },
        permission_policy: {
          allowed_tools: [],
          allowed_command_ids: ["rm -rf /"],
        },
        cancellation: { supported: true, timeout_ms: 5000 },
        audit: { required: true, receipt_schema_version: "1.0.0" },
      }).success,
    ).toBe(false);
  });

  it("AVAILABLE 状态只能认证当前 Model ID", () => {
    expect(
      modelProfileSchema.safeParse({
        profile_id: ids.artifact,
        scope: {
          app_id: ids.appA,
          tenant_id: ids.tenantA,
          environment: environments.test,
        },
        provider: "openai",
        model_id: "expected-model",
        profile_version: "1.0.0",
        capabilities: {
          structured_output: true,
          tool_calling: true,
          streaming: true,
          reasoning: true,
          vision: false,
        },
        certification_status: "AVAILABLE",
        certification_receipt_ref: makeArtifactReference("ModelCertificationReceipt"),
        certified_model_id: "different-model",
      }).success,
    ).toBe(false);
  });

  it("Schema 上声明 AVAILABLE 仍不是可调用能力，必须解析匹配的认证 Receipt", async () => {
    const receiptReference = makeArtifactReference("ModelCertificationReceipt");
    const profile = modelProfileSchema.parse({
      profile_id: ids.artifact,
      scope: {
        app_id: ids.appA,
        tenant_id: ids.tenantA,
        environment: environments.test,
      },
      provider: "openai",
      model_id: "verified-model",
      profile_version: "1.0.0",
      capabilities: {
        structured_output: true,
        tool_calling: true,
        streaming: true,
        reasoning: true,
        vision: false,
      },
      certification_status: "AVAILABLE",
      certification_receipt_ref: receiptReference,
      certified_model_id: "verified-model",
    });
    const profileHash = await computeModelProfileHash(profile);

    expect(isAvailableModelProfile(profile)).toBe(false);
    await expect(
      authorizeAvailableModelProfile(profile, {
        verifyCommitted: async () => true,
        resolve: async () => null,
      }),
    ).rejects.toBeInstanceOf(ModelCertificationError);
    const claims = {
      schema_version: "1.0.0",
      receipt_ref: receiptReference,
      profile_id: profile.profile_id,
      provider: profile.provider,
      model_id: profile.model_id,
      profile_version: profile.profile_version,
      profile_hash: profileHash,
      probe_hash: hashes.execution,
      verdict: "PASS" as const,
    };
    const receipt = await authorizeModelCertificationReceipt(receiptReference, {
      resolve: async () => claims,
      verifyCommitted: async () => true,
    });
    expect(isAuthoritativeModelCertificationReceipt(receipt)).toBe(true);

    const available = await authorizeAvailableModelProfile(profile, {
      verifyCommitted: async () => true,
      resolve: async () => receipt,
    });
    expect(isAvailableModelProfile(available)).toBe(true);
    expect(Object.isFrozen(available)).toBe(true);
  });

  it("认证 Receipt 必须绑定完整 Reference 与当前 Capability Profile Hash", async () => {
    const receiptReference = makeArtifactReference("ModelCertificationReceipt");
    const profile = modelProfileSchema.parse({
      profile_id: ids.artifact,
      scope: {
        app_id: ids.appA,
        tenant_id: ids.tenantA,
        environment: environments.test,
      },
      provider: "openai",
      model_id: "verified-model",
      profile_version: "1.0.0",
      capabilities: {
        structured_output: true,
        tool_calling: true,
        streaming: true,
        reasoning: true,
        vision: false,
      },
      certification_status: "AVAILABLE",
      certification_receipt_ref: receiptReference,
      certified_model_id: "verified-model",
    });
    const profileHash = await computeModelProfileHash(profile);
    const claims = {
      schema_version: "1.0.0",
      receipt_ref: receiptReference,
      profile_id: profile.profile_id,
      provider: profile.provider,
      model_id: profile.model_id,
      profile_version: profile.profile_version,
      profile_hash: profileHash,
      probe_hash: hashes.execution,
      verdict: "PASS" as const,
    };

    await expect(
      authorizeModelCertificationReceipt(
        {
          ...receiptReference,
          content_hash: hashes.artifact,
        },
        {
          resolve: async () => claims,
          verifyCommitted: async () => true,
        },
      ),
    ).rejects.toBeInstanceOf(ModelCertificationError);
    await expect(
      authorizeModelCertificationReceipt(receiptReference, {
        resolve: async () => claims,
        verifyCommitted: async () => false,
      }),
    ).rejects.toBeInstanceOf(ModelCertificationError);

    const mutatedProfile = modelProfileSchema.parse({
      ...profile,
      capabilities: {
        ...profile.capabilities,
        tool_calling: false,
      },
    });
    await expect(
      authorizeAvailableModelProfile(mutatedProfile, {
        verifyCommitted: async () => true,
        resolve: async () => claims,
      }),
    ).rejects.toBeInstanceOf(ModelCertificationError);
  });
});

describe("Benchmark Oracle 分离", () => {
  it("Transport 可以统一，但每个 Suite 保留自己的 Oracle", () => {
    expect(benchmarkSuiteSchema.options).toEqual([
      "insightbench",
      "dab",
      "rcaeval",
      "controlled-attribution",
      "governance",
    ]);
    expect(
      benchmarkOracleSchema.safeParse({
        suite: "dab",
        oracle_type: "ROOT_CAUSE_RANKING",
        expected: ["promotion"],
      }).success,
    ).toBe(false);
  });

  it("EvalCase 与 ScoreCard 不能混用其他 Suite 的 Oracle", () => {
    expect(
      evalCaseSchema.safeParse({
        case_id: ids.artifact,
        suite: "dab",
        suite_version: "1.0.0",
        dataset_version: "1.0.0",
        oracle_version: "1.0.0",
        source_commit: "abcdef0",
        question: "华南区净收入同比为什么下降？",
        oracle: {
          suite: "rcaeval",
          oracle_type: "ROOT_CAUSE_RANKING",
          expected: ["promotion"],
        },
        license: "Apache-2.0",
        case_hash: hashes.artifact,
      }).success,
    ).toBe(false);

    expect(
      scoreCardSchema.safeParse({
        scorecard_id: ids.receipt,
        scorecard_version: 1,
        case_ref: makeArtifactReference("EvalCase"),
        eval_run_ref: makeArtifactReference("EvalRun", ids.evalRun),
        suite: "dab",
        suite_version: "1.0.0",
        dataset_version: "1.0.0",
        oracle_version: "1.0.0",
        oracle_type: "ROOT_CAUSE_RANKING",
        deterministic_verdict: "PASS",
        oracle_verdict_receipt_ref: makeArtifactReference("OracleVerdictReceipt"),
        comparison: {
          mode: "SINGLE",
        },
        evidence_refs: [makeArtifactReference("QueryEvidence")],
        ...scoreCardOperationalFacts,
        scorecard_hash: hashes.artifact,
      }).success,
    ).toBe(false);
  });

  it("EvalCase 不携带可变 Registry 标签，同一 Case 不能重标为 Demo/Holdout", async () => {
    const caseReference = makeArtifactReference("EvalCase", ids.artifact);
    const evalCaseDraft = evalCaseSchema.parse({
      case_id: ids.artifact,
      suite: "dab",
      suite_version: "1.0.0",
      dataset_version: "1.0.0",
      oracle_version: "1.0.0",
      source_commit: "abcdef0",
      question: "华南区净收入同比为什么下降？",
      oracle: {
        suite: "dab",
        oracle_type: "RESULT_EQUIVALENCE",
        expected: { rows: [] },
      },
      license: "Apache-2.0",
      case_hash: hashes.artifact,
    });
    const evalCase = {
      ...evalCaseDraft,
      case_hash: await computeEvalCaseHash(evalCaseDraft),
    };
    expect(evalCaseSchema.safeParse(evalCase).success).toBe(true);
    expect(evalCaseSchema.safeParse({ ...evalCase, registry: "DEMO" }).success).toBe(false);
    expect(isAuthoritativeEvalCase(evalCase)).toBe(false);
    expect(isAuthoritativeEvalCase(await authorizeEvalCase(evalCase))).toBe(true);

    const demoDraft = evalRegistryAssignmentSchema.parse({
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
    const demo = {
      ...demoDraft,
      assignment_hash: await computeEvalRegistryAssignmentHash(demoDraft),
    };
    let currentAssignment: unknown | null = null;
    const registryAuthority = {
      verifyCase: async () => true,
      resolveCurrent: async () => currentAssignment,
      compareAndSwap: async ({
        expected_current_ref: expectedCurrentReference,
        next_assignment: nextAssignment,
      }: {
        expected_current_ref: unknown | null;
        next_assignment: unknown;
      }) => {
        if (expectedCurrentReference !== null || currentAssignment !== null) {
          return false;
        }
        currentAssignment = nextAssignment;
        return true;
      },
    };
    const authoritativeDemo = await authorizeEvalRegistryAssignment(demo, registryAuthority);
    expect(isAuthoritativeEvalRegistryAssignment(authoritativeDemo)).toBe(true);

    const holdoutDraft = {
      ...demoDraft,
      registry: "HOLDOUT" as const,
    };
    const holdout = {
      ...holdoutDraft,
      assignment_hash: await computeEvalRegistryAssignmentHash(holdoutDraft),
    };
    await expect(authorizeEvalRegistryAssignment(holdout, registryAuthority)).rejects.toThrow(
      "已存在不可变 Registry Assignment",
    );
  });

  it("Registry Assignment 的权威提交必须经过持久化 CAS", async () => {
    const caseReference = makeArtifactReference("EvalCase", ids.artifact);
    const draft = evalRegistryAssignmentSchema.parse({
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
    const assignment = {
      ...draft,
      assignment_hash: await computeEvalRegistryAssignmentHash(draft),
    };

    await expect(
      authorizeEvalRegistryAssignment(assignment, {
        verifyCase: async () => true,
        resolveCurrent: async () => null,
        compareAndSwap: async () => false,
      }),
    ).rejects.toThrow("并发");
  });

  it("PASS ScoreCard 必须绑定权威且已完成的 EvalRun、Registry Assignment 和 Evidence", async () => {
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
    const persistedAssignment: unknown = structuredClone(assignment);
    expect(isAuthoritativeEvalRegistryAssignment(persistedAssignment)).toBe(false);
    const rehydratedAssignment = await resolveAuthoritativeEvalRegistryAssignment(
      assignmentReference,
      {
        verifyCommitted: async () => true,
        resolve: async () => persistedAssignment,
      },
    );
    expect(isAuthoritativeEvalRegistryAssignment(rehydratedAssignment)).toBe(true);
    await expect(
      resolveAuthoritativeEvalRegistryAssignment(assignmentReference, {
        verifyCommitted: async () => false,
        resolve: async () => persistedAssignment,
      }),
    ).rejects.toThrow("尚未由持久化 Authority 提交");

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
      replay: evalReplayTuple,
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
      resolveRegistryAssignment: async () => rehydratedAssignment,
      resolveCurrentRegistryAssignment: async () => rehydratedAssignment,
    });
    expect(isAuthoritativeEvalRun(evalRun)).toBe(true);
    const evalRunArtifactReference = evalRunReference(evalRun);
    const oracleReceipt = await authorizeTestOracleVerdictReceipt(
      await createOracleVerdictReceiptInput({
        caseReference,
        evalRunReference: evalRunArtifactReference,
      }),
    );
    expect(isAuthoritativeOracleVerdictReceipt(oracleReceipt)).toBe(true);

    const upgradedAssignmentDraft = evalRegistryAssignmentSchema.parse({
      ...assignmentInput,
      assignment_version: 2,
      registry_policy_version: "2.0.0",
      previous_assignment_ref: assignmentReference,
      assignment_hash: hashes.artifact,
      assigned_at: "2026-07-25T00:02:00.000Z",
      authority: {
        kind: "deterministic",
        id: "eval-registry",
        policy_version: "2.0.0",
      },
    });
    const upgradedAssignmentInput = {
      ...upgradedAssignmentDraft,
      assignment_hash: await computeEvalRegistryAssignmentHash(upgradedAssignmentDraft),
    };
    const upgradedAssignment = await authorizeEvalRegistryAssignment(upgradedAssignmentInput, {
      verifyCase: async () => true,
      resolveCurrent: async () => persistedAssignment,
      compareAndSwap: async () => true,
    });

    const historicalAssignment = await resolveAuthoritativeEvalRegistryAssignment(
      assignmentReference,
      {
        verifyCommitted: async () => true,
        resolve: async () => persistedAssignment,
      },
    );
    expect(isAuthoritativeEvalRegistryAssignment(historicalAssignment)).toBe(true);
    await expect(
      authorizeEvalRun(evalRunInput, {
        verifyCase: async () => true,
        verifyCommitted: async () => true,
        resolveRegistryAssignment: async () => historicalAssignment,
        resolveCurrentRegistryAssignment: async () => upgradedAssignment,
      }),
    ).rejects.toThrow("当前生效");

    const draft = scoreCardSchema.parse({
      scorecard_id: ids.receipt,
      scorecard_version: 1,
      case_ref: caseReference,
      eval_run_ref: evalRunArtifactReference,
      suite: "dab",
      suite_version: "1.0.0",
      dataset_version: "1.0.0",
      oracle_version: "1.0.0",
      oracle_type: "RESULT_EQUIVALENCE",
      deterministic_verdict: "PASS",
      oracle_verdict_receipt_ref: oracleReceipt.receipt_ref,
      comparison: {
        mode: "SINGLE",
      },
      evidence_refs: [makeArtifactReference("QueryEvidence")],
      ...scoreCardOperationalFacts,
      scorecard_hash: hashes.artifact,
    });
    const scoreCard = {
      ...draft,
      scorecard_hash: await computeScoreCardHash(draft),
    };

    expect(isAuthoritativeScoreCard(scoreCard)).toBe(false);
    await expect(
      authorizeScoreCard(scoreCard, {
        resolveEvalRun: async () => null,
        resolveRegistryAssignment: async () => rehydratedAssignment,
        resolveOracleVerdictReceipt: async () => oracleReceipt,
        verifyCommitted: async () => true,
      }),
    ).rejects.toThrow("没有匹配的 EvalRun");

    await expect(
      authorizeScoreCard(scoreCard, {
        resolveEvalRun: async () => evalRunInput,
        resolveRegistryAssignment: async () => rehydratedAssignment,
        resolveOracleVerdictReceipt: async () => oracleReceipt,
        verifyCommitted: async () => true,
      }),
    ).rejects.toThrow("权威");

    const authorized = await authorizeScoreCard(scoreCard, {
      resolveEvalRun: async () => evalRun,
      resolveRegistryAssignment: async () => historicalAssignment,
      resolveOracleVerdictReceipt: async () => oracleReceipt,
      verifyCommitted: async () => true,
    });
    expect(isAuthoritativeScoreCard(authorized)).toBe(true);
  });

  it("ScoreCard 拒绝未完成 EvalRun 或未授权 Registry Assignment", async () => {
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
    const runningDraft = evalRunSchema.parse({
      eval_run_id: ids.evalRun,
      eval_run_version: 1,
      case_ref: caseReference,
      registry_assignment_ref: evalRegistryAssignmentReference(assignment),
      suite: "dab",
      suite_version: "1.0.0",
      dataset_version: "1.0.0",
      oracle_version: "1.0.0",
      oracle_type: "RESULT_EQUIVALENCE",
      manifest_version: "1.0.0",
      replay: evalReplayTuple,
      started_at: "2026-07-25T00:00:00.000Z",
      completed_at: null,
      status: "RUNNING",
      eval_run_hash: hashes.artifact,
    });
    const runningInput = {
      ...runningDraft,
      eval_run_hash: await computeEvalRunHash(runningDraft),
    };
    const running = await authorizeEvalRun(runningInput, {
      verifyCase: async () => true,
      verifyCommitted: async () => true,
      resolveRegistryAssignment: async () => assignment,
      resolveCurrentRegistryAssignment: async () => assignment,
    });
    const scoreCardDraft = scoreCardSchema.parse({
      scorecard_id: ids.receipt,
      scorecard_version: 1,
      case_ref: caseReference,
      eval_run_ref: evalRunReference(running),
      suite: "dab",
      suite_version: "1.0.0",
      dataset_version: "1.0.0",
      oracle_version: "1.0.0",
      oracle_type: "RESULT_EQUIVALENCE",
      deterministic_verdict: "PASS",
      oracle_verdict_receipt_ref: makeArtifactReference("OracleVerdictReceipt"),
      comparison: {
        mode: "SINGLE",
      },
      evidence_refs: [makeArtifactReference("QueryEvidence")],
      ...scoreCardOperationalFacts,
      scorecard_hash: hashes.artifact,
    });
    const scoreCard = {
      ...scoreCardDraft,
      scorecard_hash: await computeScoreCardHash(scoreCardDraft),
    };

    await expect(
      authorizeScoreCard(scoreCard, {
        resolveEvalRun: async () => running,
        resolveRegistryAssignment: async () => assignment,
        resolveOracleVerdictReceipt: async () => null,
        verifyCommitted: async () => true,
      }),
    ).rejects.toThrow("COMPLETED");
    await expect(
      authorizeScoreCard(scoreCard, {
        resolveEvalRun: async () => running,
        resolveRegistryAssignment: async () => assignmentInput,
        resolveOracleVerdictReceipt: async () => null,
        verifyCommitted: async () => true,
      }),
    ).rejects.toThrow("权威 Registry Assignment");
  });

  it("Oracle Verdict Receipt 必须来自提交态原文、匹配 Content Hash 并通过服务端 Oracle", async () => {
    const fixture = await createAuthoritativeReleaseFixture();
    const rawReceipt = structuredClone(fixture.evidence.oracleReceipt);
    expect(isAuthoritativeOracleVerdictReceipt(rawReceipt)).toBe(false);

    const rehydrated = await authorizeOracleVerdictReceipt(rawReceipt.receipt_ref, {
      resolveCommitted: async () => rawReceipt,
      verifyCommitted: async () => true,
      verifyDeterministicOracle: async (receipt) => receipt.oracle_result_hash === hashes.execution,
    });
    expect(isAuthoritativeOracleVerdictReceipt(rehydrated)).toBe(true);

    await expect(
      authorizeOracleVerdictReceipt(rawReceipt.receipt_ref, {
        resolveCommitted: async () => rawReceipt,
        verifyCommitted: async () => false,
        verifyDeterministicOracle: async () => true,
      }),
    ).rejects.toThrow("尚未由持久化 Authority 提交");

    await expect(
      authorizeOracleVerdictReceipt(rawReceipt.receipt_ref, {
        resolveCommitted: async () => rawReceipt,
        verifyCommitted: async () => true,
        verifyDeterministicOracle: async () => false,
      }),
    ).rejects.toThrow("服务端 Oracle Capability");

    const hashDriftedReceipt = {
      ...rawReceipt,
      oracle_result_hash: hashes.input,
    };
    await expect(
      authorizeOracleVerdictReceipt(rawReceipt.receipt_ref, {
        resolveCommitted: async () => hashDriftedReceipt,
        verifyCommitted: async () => true,
        verifyDeterministicOracle: async () => true,
      }),
    ).rejects.toThrow("Hash");

    const mismatchedReference = {
      ...rawReceipt.receipt_ref,
      artifact_id: ids.receipt,
    };
    await expect(
      authorizeOracleVerdictReceipt(mismatchedReference, {
        resolveCommitted: async () => rawReceipt,
        verifyCommitted: async () => true,
        verifyDeterministicOracle: async () => true,
      }),
    ).rejects.toThrow("完整的 Content-Addressed Reference");
  });

  it("自报 PASS 和任意已提交 Evidence 不能替代权威 Oracle Verdict Receipt", async () => {
    const fixture = await createAuthoritativeReleaseFixture();
    const rawScoreCard = structuredClone(fixture.evidence.scoreCard);
    const unbrandedOracleReceipt = structuredClone(fixture.evidence.oracleReceipt);

    await expect(
      authorizeScoreCard(rawScoreCard, {
        resolveEvalRun: async () => fixture.evidence.evalRun,
        resolveRegistryAssignment: async () => fixture.evidence.assignment,
        resolveOracleVerdictReceipt: async () => unbrandedOracleReceipt,
        verifyCommitted: async () => true,
      }),
    ).rejects.toThrow("权威 Oracle Verdict Receipt");
  });

  it("ScoreCard 必须逐项匹配 Oracle Receipt 的 Verdict、Suite、Version 和完整 Reference", async () => {
    const fixture = await createAuthoritativeReleaseFixture();
    const rawScoreCard = structuredClone(fixture.evidence.scoreCard);
    const caseReference = rawScoreCard.case_ref;
    const evalRunArtifactReference = rawScoreCard.eval_run_ref;
    const verdictMismatch = await authorizeTestOracleVerdictReceipt(
      await createOracleVerdictReceiptInput({
        caseReference,
        evalRunReference: evalRunArtifactReference,
        deterministicVerdict: "FAIL",
        receiptArtifactId: ids.attempt,
      }),
    );
    const suiteMismatch = await authorizeTestOracleVerdictReceipt(
      await createOracleVerdictReceiptInput({
        caseReference,
        evalRunReference: evalRunArtifactReference,
        suite: "rcaeval",
        receiptArtifactId: ids.inputArtifact,
      }),
    );
    const versionMismatch = await authorizeTestOracleVerdictReceipt(
      await createOracleVerdictReceiptInput({
        caseReference,
        evalRunReference: evalRunArtifactReference,
        oracleVersion: "2.0.0",
        receiptArtifactId: ids.assignment,
      }),
    );

    for (const mismatchedReceipt of [verdictMismatch, suiteMismatch, versionMismatch]) {
      const draft = scoreCardSchema.parse({
        ...rawScoreCard,
        oracle_verdict_receipt_ref: mismatchedReceipt.receipt_ref,
        scorecard_hash: hashes.artifact,
      });
      const input = {
        ...draft,
        scorecard_hash: await computeScoreCardHash(draft),
      };
      await expect(
        authorizeScoreCard(input, {
          resolveEvalRun: async () => fixture.evidence.evalRun,
          resolveRegistryAssignment: async () => fixture.evidence.assignment,
          resolveOracleVerdictReceipt: async () => mismatchedReceipt,
          verifyCommitted: async () => true,
        }),
      ).rejects.toThrow("不匹配");
    }

    const differentReferenceReceipt = await authorizeTestOracleVerdictReceipt(
      await createOracleVerdictReceiptInput({
        caseReference,
        evalRunReference: evalRunArtifactReference,
        receiptArtifactId: ids.receipt,
      }),
    );
    await expect(
      authorizeScoreCard(rawScoreCard, {
        resolveEvalRun: async () => fixture.evidence.evalRun,
        resolveRegistryAssignment: async () => fixture.evidence.assignment,
        resolveOracleVerdictReceipt: async () => differentReferenceReceipt,
        verifyCommitted: async () => true,
      }),
    ).rejects.toThrow("完整 Reference");
  });

  it("PAIRED ScoreCard 验证成对 EvalRun、版本化置信区间和权威 Baseline", async () => {
    const fixture = await createAuthoritativeReleaseFixture();
    const candidate = fixture.evidence.evalRun;
    const assignment = fixture.evidence.assignment;
    const baselineDraft = evalRunSchema.parse({
      ...structuredClone(candidate),
      eval_run_id: ids.assignment,
      eval_run_hash: hashes.artifact,
    });
    const baselineInput = {
      ...baselineDraft,
      eval_run_hash: await computeEvalRunHash(baselineDraft),
    };
    const baseline = await authorizeEvalRun(baselineInput, {
      verifyCase: async () => true,
      verifyCommitted: async () => true,
      resolveRegistryAssignment: async () => assignment,
      resolveCurrentRegistryAssignment: async () => assignment,
    });
    const candidateReference = evalRunReference(candidate);
    const baselineReference = evalRunReference(baseline);
    const interval = {
      interval_version: "1.0.0",
      metric: "result_equivalence_delta",
      confidence_level: 0.95,
      lower: 0.02,
      upper: 0.18,
      sample_size: 100,
      method: "paired-bootstrap@1.0.0",
    } as const;
    const rawSingleScoreCard = structuredClone(fixture.evidence.scoreCard);
    const pairedDraft = scoreCardSchema.parse({
      ...rawSingleScoreCard,
      comparison: {
        mode: "PAIRED",
        baseline_eval_run_ref: baselineReference,
        candidate_eval_run_ref: candidateReference,
        pairing_key: "case-id@1.0.0",
        interval,
      },
      scorecard_hash: hashes.artifact,
    });
    const pairedInput = {
      ...pairedDraft,
      scorecard_hash: await computeScoreCardHash(pairedDraft),
    };
    const resolveEvalRun = async (reference: ArtifactReference) => {
      if (artifactReferenceIdentity(reference) === artifactReferenceIdentity(candidateReference)) {
        return candidate;
      }
      if (artifactReferenceIdentity(reference) === artifactReferenceIdentity(baselineReference)) {
        return baseline;
      }
      return null;
    };
    const paired = await authorizeScoreCard(pairedInput, {
      resolveEvalRun,
      resolveRegistryAssignment: async () => assignment,
      resolveOracleVerdictReceipt: async () => fixture.evidence.oracleReceipt,
      verifyCommitted: async () => true,
    });
    expect(isAuthoritativeScoreCard(paired)).toBe(true);
    expect(paired.comparison.mode).toBe("PAIRED");

    const candidateMismatch = scoreCardSchema.safeParse({
      ...rawSingleScoreCard,
      comparison: {
        mode: "PAIRED",
        baseline_eval_run_ref: baselineReference,
        candidate_eval_run_ref: makeArtifactReference("EvalRun", ids.attempt),
        pairing_key: "case-id@1.0.0",
        interval,
      },
      scorecard_hash: hashes.artifact,
    });
    expect(candidateMismatch.success).toBe(false);

    const invalidInterval = scoreCardSchema.safeParse({
      ...rawSingleScoreCard,
      comparison: {
        mode: "PAIRED",
        baseline_eval_run_ref: baselineReference,
        candidate_eval_run_ref: candidateReference,
        pairing_key: "case-id@1.0.0",
        interval: {
          ...interval,
          lower: 0.2,
          upper: 0.1,
        },
      },
      scorecard_hash: hashes.artifact,
    });
    expect(invalidInterval.success).toBe(false);

    await expect(
      authorizeScoreCard(pairedInput, {
        resolveEvalRun: async (reference) =>
          artifactReferenceIdentity(reference) === artifactReferenceIdentity(candidateReference)
            ? candidate
            : baselineInput,
        resolveRegistryAssignment: async () => assignment,
        resolveOracleVerdictReceipt: async () => fixture.evidence.oracleReceipt,
        verifyCommitted: async () => true,
      }),
    ).rejects.toThrow("权威 Baseline EvalRun");
  });
});
