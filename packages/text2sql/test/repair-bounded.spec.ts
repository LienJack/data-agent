import { randomUUID } from "node:crypto";
import {
  type ArtifactReference,
  artifactReferenceIdentity,
  canonicalizeJson,
  computeGateEvaluationHash,
  computeGateInputHash,
  type GateReceiptPayload,
  gateReceiptSchema,
  type QueryContractPayload,
  sha256ContentHash,
  TEXT2SQL_GATE_EVALUATOR_VERSION,
} from "@data-agent/contracts";
import {
  attemptBoundedRepair,
  BOUNDED_REPAIR_LIMITS,
  buildLogicalPlan,
  buildSemanticQuery,
  compilePostgresqlLogicalPlan,
  computeRepairEpisodeHash,
  computeRepairPatchScriptHash,
  computeRepairReceiptHash,
  computeRepairTraceHash,
  createGroundingPackagePayload,
  createSemanticQueryPayload,
  type RepairPatchOperation,
  repairReceiptSchema,
  sealRepairFrozenBundle,
  validateLogicalPlan,
} from "@data-agent/text2sql";
import {
  authorizeRepairTrace,
  createBoundedRepairTrace,
  loadCurrentRepairSession,
  type RepairSessionCreateClaim,
  type RepairSessionSnapshot,
  type RepairSessionStoreAdapter,
  type RepairSessionTransitionClaim,
  registerTrustedGateArtifactAuthority,
  registerTrustedRepairAuthority,
} from "@data-agent/text2sql/server";
import { describe, expect, it } from "vitest";
import { groundQueryContract } from "../src/grounding/ground-query-contract.js";
import {
  analystPolicy,
  artifactReference,
  commerceCatalog,
  fixturePrincipalId,
  netRevenueContract,
} from "./support/commerce-fixture.js";
import { committedLogicalPlanAuthorityFixture } from "./support/compiler-authority-fixture.js";

const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;
const HASH_C = `sha256:${"c".repeat(64)}` as const;

function uniqueReference<const T extends ArtifactReference["artifact_type"]>(
  artifactType: T,
): ArtifactReference & { artifact_type: T } {
  return { ...artifactReference(artifactType), artifact_id: randomUUID() };
}

class InMemoryRepairSessionStore implements RepairSessionStoreAdapter {
  readonly #episodeOwners = new Map<string, string>();
  readonly #snapshots = new Map<string, RepairSessionSnapshot>();

  async createSession(claim: RepairSessionCreateClaim): Promise<boolean> {
    if (this.#episodeOwners.has(claim.episode_hash) || this.#snapshots.has(claim.repair_id)) {
      return false;
    }
    this.#episodeOwners.set(claim.episode_hash, claim.repair_id);
    this.#snapshots.set(claim.repair_id, {
      repair_id: claim.repair_id,
      episode_hash: claim.episode_hash,
      frozen_bundle_hash: claim.frozen_bundle_hash,
      trace_history: [structuredClone(claim.initial_trace)],
      transitions: [],
    });
    return true;
  }

  async compareAndSwap(claim: RepairSessionTransitionClaim): Promise<boolean> {
    const current = this.#snapshots.get(claim.repair_id);
    const currentTrace = current?.trace_history.at(-1);
    if (
      !current ||
      !currentTrace ||
      current.episode_hash !== claim.episode_hash ||
      current.frozen_bundle_hash !== claim.frozen_bundle_hash ||
      currentTrace.trace_hash !== claim.expected_trace_hash ||
      currentTrace.attempt_count !== claim.expected_attempt_count ||
      claim.next_trace.trace_hash === claim.expected_trace_hash ||
      (claim.next_trace.attempt_count !== claim.expected_attempt_count &&
        claim.next_trace.attempt_count !== claim.expected_attempt_count + 1)
    ) {
      return false;
    }
    this.#snapshots.set(claim.repair_id, {
      ...current,
      trace_history: [...current.trace_history, structuredClone(claim.next_trace)],
      transitions: [...current.transitions, structuredClone(claim.transition)],
    });
    return true;
  }

  async loadSession(claim: {
    repair_id: string;
    episode_hash: string;
  }): Promise<RepairSessionSnapshot | null> {
    const snapshot = this.#snapshots.get(claim.repair_id);
    return snapshot?.episode_hash === claim.episode_hash ? structuredClone(snapshot) : null;
  }

  replaceSnapshot(snapshot: RepairSessionSnapshot): void {
    this.#snapshots.set(snapshot.repair_id, structuredClone(snapshot));
  }
}

async function failedGateReceipt(
  parentReference: ArtifactReference & { artifact_type: "SqlArtifact" },
  parent: Awaited<ReturnType<typeof repairFixtureBase>>["parent"],
  gate: "STRUCTURAL" | "POLICY",
): Promise<GateReceiptPayload> {
  const inputMaterial = {
    artifact_type: "GateReceipt" as const,
    sql_artifact_ref: parentReference,
    execution_receipt_ref: null,
    gate,
    gate_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
    evaluator_version: TEXT2SQL_GATE_EVALUATOR_VERSION,
    evidence_refs: [parentReference],
  };
  const inputHash = await computeGateInputHash(inputMaterial);
  const evaluationMaterial =
    gate === "STRUCTURAL"
      ? {
          ...inputMaterial,
          input_hash: inputHash,
          evaluator_input_hash: HASH_A,
          evaluator_evaluation_hash: HASH_B,
          verdict: "FAIL" as const,
          reason_code: "STRUCTURAL_HASH_MISMATCH" as const,
          observations: {
            compiler_version: parent.compiler_version,
            ast_hash: parent.ast_hash,
            query_hash: parent.query_hash,
            parameter_count: Object.keys(parent.parameters).length,
            statement_kind: "SELECT" as const,
            read_only: true,
          },
          evaluated_at: "2026-07-26T00:00:00.000Z",
        }
      : {
          ...inputMaterial,
          input_hash: inputHash,
          evaluator_input_hash: HASH_A,
          evaluator_evaluation_hash: HASH_B,
          verdict: "FAIL" as const,
          reason_code: "POLICY_OBJECT_DENIED" as const,
          observations: {
            policy_version: "commerce-policy@1.0.0",
            mandatory_predicate_count: 1,
            resolved_binding_count: 0,
          },
          evaluated_at: "2026-07-26T00:00:00.000Z",
        };
  return gateReceiptSchema.parse({
    ...evaluationMaterial,
    evaluation_hash: await computeGateEvaluationHash(evaluationMaterial),
  });
}

async function repairFixtureBase(
  options: Readonly<{
    parent_state?: "DRIFTED" | "CANONICAL";
    failed_gate?: "STRUCTURAL" | "POLICY";
    session_store?: InMemoryRepairSessionStore;
  }> = {},
) {
  const queryContract: QueryContractPayload = netRevenueContract();
  const groundingResult = await groundQueryContract({
    query_contract: queryContract,
    catalog: commerceCatalog,
    policy: analystPolicy,
    retrieval_candidates: [],
    max_context_objects: 64,
  });
  if (groundingResult.state !== "READY") throw new Error("Repair Fixture 必须完成 Grounding。");
  const semanticDraft = buildSemanticQuery({
    query_contract: queryContract,
    grounding: groundingResult.grounding,
  });
  const logicalPlanDraft = buildLogicalPlan({
    semantic_query: semanticDraft,
    grounding: groundingResult.grounding,
  });
  const validation = validateLogicalPlan({
    logical_plan: logicalPlanDraft,
    grounding: groundingResult.grounding,
    semantic_query: semanticDraft,
    query_contract: queryContract,
  });
  if (validation.state !== "VALID") throw new Error("Repair Fixture 必须产生有效 LogicalPlan。");
  const logicalAuthority = await committedLogicalPlanAuthorityFixture(validation.logical_plan);
  const compilerInput = {
    logical_plan_binding: await logicalAuthority.bind(),
    grounding: groundingResult.grounding,
  };
  const compilation = await compilePostgresqlLogicalPlan(compilerInput);
  if (compilation.state !== "COMPILED") throw new Error("Repair Fixture 必须确定性编译。");
  const canonical = compilation.compilation.sql_artifact;
  const parent =
    options.parent_state === "CANONICAL"
      ? canonical
      : {
          ...canonical,
          compiler_version: "candidate-compiler@0.1.0",
          ast_hash: HASH_B,
          sql: "SELECT $1 AS drifted",
          parameters: { $1: "candidate-literal" },
          query_hash: HASH_C,
        };

  if (logicalAuthority.document.payload.artifact_type !== "LogicalPlan") {
    throw new Error("Compiler Authority Fixture 必须持有 LogicalPlan。");
  }
  const queryContractReference = uniqueReference("QueryContract");
  const groundingReference = uniqueReference("GroundingPackage");
  const semanticReference = logicalAuthority.document.payload.semantic_query_ref;
  const logicalReference = logicalAuthority.reference;
  const parentReference = {
    ...uniqueReference("SqlArtifact"),
    content_hash: await sha256ContentHash(parent),
  };
  const groundingPayload = createGroundingPackagePayload({
    draft: groundingResult.grounding,
    query_contract_ref: queryContractReference,
    semantic_release_ref: uniqueReference("SemanticRelease"),
    schema_snapshot_ref: uniqueReference("SchemaSnapshot"),
    policy_receipt_ref: uniqueReference("PolicyReceipt"),
  });
  const semanticPayload = createSemanticQueryPayload({
    draft: semanticDraft,
    query_contract_ref: queryContractReference,
    grounding_package_ref: groundingReference,
  });
  const failurePayload = await failedGateReceipt(
    parentReference,
    parent,
    options.failed_gate ?? "STRUCTURAL",
  );
  const failureReference = {
    ...uniqueReference("GateReceipt"),
    content_hash: await sha256ContentHash(failurePayload),
  };
  const committedArtifacts = new Map<string, unknown>([
    [artifactReferenceIdentity(queryContractReference), queryContract],
    [artifactReferenceIdentity(groundingReference), groundingPayload],
    [artifactReferenceIdentity(semanticReference), semanticPayload],
    [artifactReferenceIdentity(logicalReference), logicalAuthority.document.payload],
    [artifactReferenceIdentity(parentReference), parent],
    [artifactReferenceIdentity(failureReference), failurePayload],
  ]);
  const resolvedArtifacts = new Map(committedArtifacts);
  const artifactAuthority = registerTrustedGateArtifactAuthority({
    resolveArtifact: async (reference) =>
      resolvedArtifacts.get(artifactReferenceIdentity(reference)) ?? null,
    verifyCommitted: async (reference) =>
      committedArtifacts.has(artifactReferenceIdentity(reference)),
    now: () => "2026-07-26T00:01:00.000Z",
  });
  const sessionStore = options.session_store ?? new InMemoryRepairSessionStore();
  const verifyExactArtifactRevision = async (reference: ArtifactReference, payload: unknown) =>
    canonicalizeJson(committedArtifacts.get(artifactReferenceIdentity(reference))) ===
    canonicalizeJson(payload);
  const createAuthority = () =>
    registerTrustedRepairAuthority({
      principal_id: fixturePrincipalId,
      artifact_authority: artifactAuthority,
      session_store: sessionStore,
      verifyExactArtifactRevision,
    });
  const authority = createAuthority();
  const frozenBundle = await sealRepairFrozenBundle({
    repair_id: randomUUID(),
    principal_id: fixturePrincipalId,
    query_contract_ref: queryContractReference,
    grounding_package_ref: groundingReference,
    semantic_query_ref: semanticReference,
    logical_plan_ref: logicalReference,
    root_sql_artifact_ref: parentReference,
    query_contract_hash: await sha256ContentHash(queryContract),
    grounding_package_hash: await sha256ContentHash(groundingPayload),
    semantic_query_hash: await sha256ContentHash(semanticPayload),
    logical_plan_hash: await sha256ContentHash(validation.logical_plan),
    root_sql_artifact_payload_hash: await sha256ContentHash(parent),
    grounding_hash: groundingResult.grounding.grounding_hash,
    semantic_signature_hash: await sha256ContentHash(validation.logical_plan.semantic_signature),
    policy_version: groundingResult.grounding.policy_version,
  });
  return {
    committedArtifacts,
    artifactAuthority,
    authority,
    canonical,
    compilerInput,
    createAuthority,
    failureReference,
    groundingPayload,
    frozenBundle,
    logicalPlanPayload: logicalAuthority.document.payload,
    parent,
    parentReference,
    queryContract,
    queryContractReference,
    resolvedArtifacts,
    semanticPayload,
    sessionStore,
  };
}

async function openTrace(fixture: Awaited<ReturnType<typeof repairFixtureBase>>) {
  return createBoundedRepairTrace({
    authority: fixture.authority,
    frozen_bundle: fixture.frozenBundle,
  });
}

async function commitParentRevision(
  fixture: Awaited<ReturnType<typeof repairFixtureBase>>,
  payload: typeof fixture.canonical,
  revision = fixture.parentReference.revision + 1,
) {
  const parentReference = {
    ...fixture.parentReference,
    revision,
    content_hash: await sha256ContentHash(payload),
  };
  const failurePayload = await failedGateReceipt(parentReference, payload, "STRUCTURAL");
  const failureReference = {
    ...uniqueReference("GateReceipt"),
    content_hash: await sha256ContentHash(failurePayload),
  };
  for (const [reference, value] of [
    [parentReference, payload],
    [failureReference, failurePayload],
  ] as const) {
    const identity = artifactReferenceIdentity(reference);
    fixture.committedArtifacts.set(identity, value);
    fixture.resolvedArtifacts.set(identity, value);
  }
  return { failureReference, parentReference };
}

describe("Bounded Repair", () => {
  it("只从提交态失败 Gate 与冻结 Artifact Bundle 生成候选，并强制七门重验证", async () => {
    const fixture = await repairFixtureBase();
    const result = await attemptBoundedRepair({
      authority: fixture.authority,
      compiler_input: fixture.compilerInput,
      current_parent_sql_artifact_ref: fixture.parentReference,
      failure_gate_receipt_ref: fixture.failureReference,
      trace: await openTrace(fixture),
    });

    expect(result.state).toBe("CANDIDATE");
    if (result.state !== "CANDIDATE") throw new Error("测试必须产生 Candidate。");
    expect(result.next_state).toBe("NEEDS_FULL_REVALIDATION");
    expect(result.candidate).toEqual(fixture.canonical);
    expect(result.patch_operations).toEqual([
      {
        operation: "RESTORE_DIALECT_AND_SQL",
        authority: "DETERMINISTIC_POSTGRESQL_COMPILATION",
      },
      {
        operation: "RESTORE_PARAMETERS",
        authority: "DETERMINISTIC_POSTGRESQL_COMPILATION",
      },
      {
        operation: "RESTORE_COMPILER_METADATA",
        authority: "DETERMINISTIC_POSTGRESQL_COMPILATION",
      },
      {
        operation: "RESTORE_QUERY_HASH",
        authority: "DETERMINISTIC_POSTGRESQL_COMPILATION",
      },
    ]);
    expect(result.patch_operations).toHaveLength(
      BOUNDED_REPAIR_LIMITS.max_patch_operations_per_attempt,
    );
    expect(result.receipt).toMatchObject({
      outcome: "CANDIDATE",
      revalidation_state: "REQUIRED",
      required_revalidation_gates: [
        "INTENT",
        "SEMANTIC",
        "STRUCTURAL",
        "POLICY",
        "RESOURCE",
        "EXECUTION",
        "RESULT",
      ],
      failure_gate_receipt_ref: fixture.failureReference,
      failed_gate: "STRUCTURAL",
      failure_code: "STRUCTURAL_HASH_MISMATCH",
    });
    expect("verdict" in result).toBe(false);
    expect("validation_receipt" in result).toBe(false);
    expect(result.receipt.receipt_hash).toBe(await computeRepairReceiptHash(result.receipt));
    expect(result.trace.trace_hash).toBe(await computeRepairTraceHash(result.trace));
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("Policy 失败只能从权威 GateReceipt 派生 HUMAN 路由，调用者不能重标为 Structural", async () => {
    const fixture = await repairFixtureBase({ failed_gate: "POLICY" });
    const result = await attemptBoundedRepair({
      authority: fixture.authority,
      compiler_input: fixture.compilerInput,
      current_parent_sql_artifact_ref: fixture.parentReference,
      failure_gate_receipt_ref: fixture.failureReference,
      trace: await openTrace(fixture),
    });
    expect(result).toMatchObject({
      state: "ROUTED",
      route: "HUMAN",
      receipt: {
        failed_gate: "POLICY",
        failure_code: "POLICY_OBJECT_DENIED",
        revalidation_state: "NOT_APPLICABLE",
      },
    });
    if (result.state !== "ROUTED") throw new Error("Policy Failure 必须路由 HUMAN。");
    expect(
      repairReceiptSchema.safeParse({
        ...result.receipt,
        deterministic_query_hash: HASH_A,
      }).success,
    ).toBe(false);
    const snapshot = await fixture.sessionStore.loadSession({
      repair_id: fixture.frozenBundle.repair_id,
      episode_hash: fixture.frozenBundle.episode_hash,
    });
    if (!snapshot) throw new Error("Policy Route 必须持久化 Session Snapshot。");
    const initialTrace = snapshot.trace_history[0];
    if (!initialTrace) throw new Error("Policy Route Snapshot 必须保留 Initial Trace。");
    const forgedPatchOperations = [
      {
        operation: "RESTORE_DIALECT_AND_SQL",
        authority: "DETERMINISTIC_POSTGRESQL_COMPILATION",
      },
      {
        operation: "RESTORE_PARAMETERS",
        authority: "DETERMINISTIC_POSTGRESQL_COMPILATION",
      },
      {
        operation: "RESTORE_COMPILER_METADATA",
        authority: "DETERMINISTIC_POSTGRESQL_COMPILATION",
      },
      {
        operation: "RESTORE_QUERY_HASH",
        authority: "DETERMINISTIC_POSTGRESQL_COMPILATION",
      },
    ] satisfies RepairPatchOperation[];
    const childCandidateHash = await sha256ContentHash(fixture.canonical);
    const { receipt_hash: _oldReceiptHash, ...forgedReceiptMaterial } = {
      ...result.receipt,
      outcome: "CANDIDATE" as const,
      route: null,
      revalidation_state: "REQUIRED" as const,
      deterministic_query_hash: fixture.canonical.query_hash,
      child_candidate_hash: childCandidateHash,
      patch_operations: forgedPatchOperations,
      patch_script_hash: await computeRepairPatchScriptHash(forgedPatchOperations),
    };
    const forgedReceipt = {
      ...forgedReceiptMaterial,
      receipt_hash: await computeRepairReceiptHash(forgedReceiptMaterial),
    };
    const forgedTraceMaterial = {
      repair_version: result.trace.repair_version,
      frozen_bundle: result.trace.frozen_bundle,
      attempt_count: 1,
      expected_parent_candidate_hash: childCandidateHash,
      attempt_receipt_hashes: [forgedReceipt.receipt_hash],
      terminal_reason_code: null,
    };
    fixture.sessionStore.replaceSnapshot({
      ...snapshot,
      trace_history: [
        initialTrace,
        {
          ...forgedTraceMaterial,
          trace_hash: await computeRepairTraceHash(forgedTraceMaterial),
        },
      ],
      transitions: [{ receipt: forgedReceipt, candidate: fixture.canonical }],
    });
    await expect(
      loadCurrentRepairSession({
        authority: fixture.createAuthority(),
        compiler_input: fixture.compilerInput,
        repair_id: fixture.frozenBundle.repair_id,
        episode_hash: fixture.frozenBundle.episode_hash,
      }),
    ).rejects.toThrow("TEXT2SQL_REPAIR_SESSION_REHYDRATION_FAILED");

    const forgedReference = uniqueReference("GateReceipt");
    const other = await repairFixtureBase();
    await expect(
      attemptBoundedRepair({
        authority: other.authority,
        compiler_input: other.compilerInput,
        current_parent_sql_artifact_ref: other.parentReference,
        failure_gate_receipt_ref: forgedReference,
        trace: await openTrace(other),
      }),
    ).rejects.toThrow("TEXT2SQL_REPAIR_FAILURE_AUTHORITY_REQUIRED");
  });

  it("Reference A 返回 Payload B 时，Frozen Revision 与失败 Gate 都必须失败关闭", async () => {
    const frozenFixture = await repairFixtureBase();
    frozenFixture.resolvedArtifacts.set(
      artifactReferenceIdentity(frozenFixture.queryContractReference),
      {
        ...frozenFixture.queryContract,
        unit: "USD",
      },
    );
    await expect(openTrace(frozenFixture)).rejects.toThrow(
      "TEXT2SQL_REPAIR_FROZEN_BUNDLE_AUTHORITY_REQUIRED",
    );

    const gateFixture = await repairFixtureBase();
    const trace = await openTrace(gateFixture);
    const substitutedGate = await failedGateReceipt(
      gateFixture.parentReference,
      gateFixture.parent,
      "POLICY",
    );
    gateFixture.resolvedArtifacts.set(
      artifactReferenceIdentity(gateFixture.failureReference),
      substitutedGate,
    );
    await expect(
      attemptBoundedRepair({
        authority: gateFixture.authority,
        compiler_input: gateFixture.compilerInput,
        current_parent_sql_artifact_ref: gateFixture.parentReference,
        failure_gate_receipt_ref: gateFixture.failureReference,
        trace,
      }),
    ).rejects.toThrow("TEXT2SQL_REPAIR_FAILURE_AUTHORITY_REQUIRED");
  });

  it("稳定 Root Episode 可推进父 Revision 两次，终态吸收重放且复制 Root 不能重置预算", async () => {
    const fixture = await repairFixtureBase();
    const first = await attemptBoundedRepair({
      authority: fixture.authority,
      compiler_input: fixture.compilerInput,
      current_parent_sql_artifact_ref: fixture.parentReference,
      failure_gate_receipt_ref: fixture.failureReference,
      trace: await openTrace(fixture),
    });
    if (first.state !== "CANDIDATE") throw new Error("首轮必须生成确定性 Candidate。");

    const secondParent = await commitParentRevision(fixture, first.candidate);
    expect(secondParent.parentReference.revision).toBe(2);
    expect(first.trace.frozen_bundle.root_sql_artifact_ref.revision).toBe(1);
    expect(first.trace.frozen_bundle.episode_hash).toBe(fixture.frozenBundle.episode_hash);

    const second = await attemptBoundedRepair({
      authority: fixture.authority,
      compiler_input: fixture.compilerInput,
      current_parent_sql_artifact_ref: secondParent.parentReference,
      failure_gate_receipt_ref: secondParent.failureReference,
      trace: first.trace,
    });
    expect(second).toMatchObject({
      state: "TERMINAL",
      reason_code: "REPAIR_NO_PROGRESS",
      receipt: { attempt: 2 },
      trace: {
        attempt_count: 2,
        frozen_bundle: {
          episode_hash: fixture.frozenBundle.episode_hash,
          root_sql_artifact_ref: fixture.parentReference,
        },
      },
    });
    if (second.state !== "TERMINAL") throw new Error("第二轮必须占用第二个 Attempt。");

    const snapshotBeforeClosedReplay = await fixture.sessionStore.loadSession({
      repair_id: fixture.frozenBundle.repair_id,
      episode_hash: fixture.frozenBundle.episode_hash,
    });
    const third = await attemptBoundedRepair({
      authority: fixture.authority,
      compiler_input: fixture.compilerInput,
      current_parent_sql_artifact_ref: secondParent.parentReference,
      failure_gate_receipt_ref: secondParent.failureReference,
      trace: second.trace,
    });
    expect(third).toMatchObject({
      state: "TERMINAL",
      reason_code: "REPAIR_SESSION_TERMINATED",
      receipt: null,
      trace: second.trace,
    });
    expect(
      await fixture.sessionStore.loadSession({
        repair_id: fixture.frozenBundle.repair_id,
        episode_hash: fixture.frozenBundle.episode_hash,
      }),
    ).toEqual(snapshotBeforeClosedReplay);

    const duplicateRootReference = {
      ...fixture.parentReference,
      artifact_id: randomUUID(),
    };
    fixture.committedArtifacts.set(
      artifactReferenceIdentity(duplicateRootReference),
      fixture.parent,
    );
    fixture.resolvedArtifacts.set(
      artifactReferenceIdentity(duplicateRootReference),
      fixture.parent,
    );
    const duplicateRootBundle = await sealRepairFrozenBundle({
      ...fixture.frozenBundle,
      repair_id: randomUUID(),
      root_sql_artifact_ref: duplicateRootReference,
    });
    expect(duplicateRootBundle.episode_hash).toBe(fixture.frozenBundle.episode_hash);
    const switchedPrincipalBundle = await sealRepairFrozenBundle({
      ...fixture.frozenBundle,
      repair_id: randomUUID(),
      principal_id: "principal:budget-reset-attacker",
    });
    expect(switchedPrincipalBundle.episode_hash).toBe(fixture.frozenBundle.episode_hash);
    await expect(
      createBoundedRepairTrace({
        authority: fixture.authority,
        frozen_bundle: duplicateRootBundle,
      }),
    ).rejects.toThrow("TEXT2SQL_REPAIR_SESSION_ALREADY_EXISTS");

    await expect(
      sealRepairFrozenBundle({
        ...fixture.frozenBundle,
        repair_id: randomUUID(),
        root_sql_artifact_ref: secondParent.parentReference,
        root_sql_artifact_payload_hash: await sha256ContentHash(first.candidate),
      }),
    ).rejects.toThrow();
  });

  it("Session Store 原子保存完整 Trace/Receipt/Candidate，并可在进程重启后恢复 Head", async () => {
    const fixture = await repairFixtureBase();
    const result = await attemptBoundedRepair({
      authority: fixture.authority,
      compiler_input: fixture.compilerInput,
      current_parent_sql_artifact_ref: fixture.parentReference,
      failure_gate_receipt_ref: fixture.failureReference,
      trace: await openTrace(fixture),
    });
    if (result.state !== "CANDIDATE") throw new Error("恢复 Fixture 首轮必须生成 Candidate。");

    const restartedAuthority = fixture.createAuthority();
    const restored = await loadCurrentRepairSession({
      authority: restartedAuthority,
      compiler_input: fixture.compilerInput,
      repair_id: fixture.frozenBundle.repair_id,
      episode_hash: fixture.frozenBundle.episode_hash,
    });
    expect(restored.trace).toEqual(result.trace);
    expect(restored.transitions).toEqual([
      {
        receipt: result.receipt,
        candidate: result.candidate,
      },
    ]);
    expect(restored.trace.trace_hash).toBe(await computeRepairTraceHash(restored.trace));
    expect(restored.transitions[0]?.receipt.receipt_hash).toBe(
      await computeRepairReceiptHash(result.receipt),
    );
    expect(Object.isFrozen(restored.trace)).toBe(true);
  });

  it("load 边界拒绝克隆 Compiler Input，且不修改 Repair Session", async () => {
    const fixture = await repairFixtureBase();
    await openTrace(fixture);
    const snapshotBefore = await fixture.sessionStore.loadSession({
      repair_id: fixture.frozenBundle.repair_id,
      episode_hash: fixture.frozenBundle.episode_hash,
    });

    await expect(
      loadCurrentRepairSession({
        authority: fixture.createAuthority(),
        compiler_input: structuredClone(fixture.compilerInput),
        repair_id: fixture.frozenBundle.repair_id,
        episode_hash: fixture.frozenBundle.episode_hash,
      }),
    ).rejects.toThrow("TEXT2SQL_REPAIR_COMPILER_INPUT_AUTHORITY_REQUIRED");
    expect(
      await fixture.sessionStore.loadSession({
        repair_id: fixture.frozenBundle.repair_id,
        episode_hash: fixture.frozenBundle.episode_hash,
      }),
    ).toEqual(snapshotBefore);
  });

  it("authorize 边界拒绝克隆 Compiler Input，且不修改 Repair Session", async () => {
    const fixture = await repairFixtureBase();
    const trace = await openTrace(fixture);
    const snapshotBefore = await fixture.sessionStore.loadSession({
      repair_id: fixture.frozenBundle.repair_id,
      episode_hash: fixture.frozenBundle.episode_hash,
    });

    await expect(
      authorizeRepairTrace({
        authority: fixture.createAuthority(),
        compiler_input: structuredClone(fixture.compilerInput),
        trace: structuredClone(trace),
      }),
    ).rejects.toThrow("TEXT2SQL_REPAIR_COMPILER_INPUT_AUTHORITY_REQUIRED");
    expect(
      await fixture.sessionStore.loadSession({
        repair_id: fixture.frozenBundle.repair_id,
        episode_hash: fixture.frozenBundle.episode_hash,
      }),
    ).toEqual(snapshotBefore);
  });

  it("attempt 边界拒绝克隆 Compiler Input，不消耗 Attempt 或写入终态", async () => {
    const fixture = await repairFixtureBase();
    const trace = await openTrace(fixture);
    const snapshotBefore = await fixture.sessionStore.loadSession({
      repair_id: fixture.frozenBundle.repair_id,
      episode_hash: fixture.frozenBundle.episode_hash,
    });

    await expect(
      attemptBoundedRepair({
        authority: fixture.authority,
        compiler_input: structuredClone(fixture.compilerInput),
        current_parent_sql_artifact_ref: fixture.parentReference,
        failure_gate_receipt_ref: fixture.failureReference,
        trace,
      }),
    ).rejects.toThrow("TEXT2SQL_REPAIR_COMPILER_INPUT_AUTHORITY_REQUIRED");
    const snapshotAfter = await fixture.sessionStore.loadSession({
      repair_id: fixture.frozenBundle.repair_id,
      episode_hash: fixture.frozenBundle.episode_hash,
    });
    expect(snapshotAfter).toEqual(snapshotBefore);
    expect(snapshotAfter?.trace_history.at(-1)).toMatchObject({
      attempt_count: 0,
      terminal_reason_code: null,
    });
    expect(snapshotAfter?.transitions).toEqual([]);
  });

  it("Compiler Input Schema 失败不能折叠为 REPAIR_COMPILER_UNAVAILABLE", async () => {
    const fixture = await repairFixtureBase();
    const trace = await openTrace(fixture);
    const snapshotBefore = await fixture.sessionStore.loadSession({
      repair_id: fixture.frozenBundle.repair_id,
      episode_hash: fixture.frozenBundle.episode_hash,
    });
    const invalidCompilerInput = {
      ...fixture.compilerInput,
      untrusted_field: true,
    };

    await expect(
      attemptBoundedRepair({
        authority: fixture.authority,
        compiler_input: invalidCompilerInput,
        current_parent_sql_artifact_ref: fixture.parentReference,
        failure_gate_receipt_ref: fixture.failureReference,
        trace,
      }),
    ).rejects.toThrow("TEXT2SQL_REPAIR_COMPILER_INPUT_AUTHORITY_REQUIRED");
    expect(
      await fixture.sessionStore.loadSession({
        repair_id: fixture.frozenBundle.repair_id,
        episode_hash: fixture.frozenBundle.episode_hash,
      }),
    ).toEqual(snapshotBefore);
  });

  it("Accessor Compiler Input 在快照捕获前失败，不能利用校验/编译 TOCTOU 写终态", async () => {
    const fixture = await repairFixtureBase();
    const trace = await openTrace(fixture);
    const snapshotBefore = await fixture.sessionStore.loadSession({
      repair_id: fixture.frozenBundle.repair_id,
      episode_hash: fixture.frozenBundle.episode_hash,
    });
    let groundingReads = 0;
    const accessorCompilerInput = {
      logical_plan_binding: fixture.compilerInput.logical_plan_binding,
      get grounding() {
        groundingReads += 1;
        return fixture.compilerInput.grounding;
      },
    };

    await expect(
      attemptBoundedRepair({
        authority: fixture.authority,
        compiler_input: accessorCompilerInput,
        current_parent_sql_artifact_ref: fixture.parentReference,
        failure_gate_receipt_ref: fixture.failureReference,
        trace,
      }),
    ).rejects.toThrow("TEXT2SQL_REPAIR_COMPILER_INPUT_AUTHORITY_REQUIRED");
    expect(groundingReads).toBe(0);
    expect(
      await fixture.sessionStore.loadSession({
        repair_id: fixture.frozenBundle.repair_id,
        episode_hash: fixture.frozenBundle.episode_hash,
      }),
    ).toEqual(snapshotBefore);
  });

  it("Grounding 内容漂移但复用声明 Hash 时不能消费 Attempt 或写 Compiler Unavailable 终态", async () => {
    const fixture = await repairFixtureBase();
    const trace = await openTrace(fixture);
    const snapshotBefore = await fixture.sessionStore.loadSession({
      repair_id: fixture.frozenBundle.repair_id,
      episode_hash: fixture.frozenBundle.episode_hash,
    });
    const invalidCompilerInput = {
      logical_plan_binding: fixture.compilerInput.logical_plan_binding,
      grounding: {
        ...fixture.compilerInput.grounding,
        allowed_schema: {
          ...fixture.compilerInput.grounding.allowed_schema,
          tables: fixture.compilerInput.grounding.allowed_schema.tables.map((table, index) =>
            index === 0
              ? {
                  ...table,
                  physical_name: `${table.physical_name}_drifted`,
                }
              : table,
          ),
        },
      },
    };

    await expect(
      attemptBoundedRepair({
        authority: fixture.authority,
        compiler_input: invalidCompilerInput,
        current_parent_sql_artifact_ref: fixture.parentReference,
        failure_gate_receipt_ref: fixture.failureReference,
        trace,
      }),
    ).rejects.toThrow("TEXT2SQL_REPAIR_TRACE_BINDING_MISMATCH");
    expect(
      await fixture.sessionStore.loadSession({
        repair_id: fixture.frozenBundle.repair_id,
        episode_hash: fixture.frozenBundle.episode_hash,
      }),
    ).toEqual(snapshotBefore);
  });

  it("重启恢复会重放 Compiler/Patch/状态机，公开 SHA 重签不能把任意 SQL 重新品牌化", async () => {
    const fixture = await repairFixtureBase();
    const result = await attemptBoundedRepair({
      authority: fixture.authority,
      compiler_input: fixture.compilerInput,
      current_parent_sql_artifact_ref: fixture.parentReference,
      failure_gate_receipt_ref: fixture.failureReference,
      trace: await openTrace(fixture),
    });
    if (result.state !== "CANDIDATE") throw new Error("篡改 Fixture 首轮必须生成 Candidate。");
    const snapshot = await fixture.sessionStore.loadSession({
      repair_id: fixture.frozenBundle.repair_id,
      episode_hash: fixture.frozenBundle.episode_hash,
    });
    if (!snapshot) throw new Error("篡改 Fixture 必须持久化 Session Snapshot。");
    const initialTrace = snapshot.trace_history[0];
    if (!initialTrace) throw new Error("篡改 Fixture Snapshot 必须保留 Initial Trace。");

    const forgedCandidate = {
      ...result.candidate,
      sql: `${result.candidate.sql} /* forged */`,
    };
    const forgedCandidateHash = await sha256ContentHash(forgedCandidate);
    const forgedPatchOperations = result.receipt.patch_operations.slice(0, 1);
    const { receipt_hash: _oldReceiptHash, ...forgedReceiptMaterial } = {
      ...result.receipt,
      child_candidate_hash: forgedCandidateHash,
      patch_operations: forgedPatchOperations,
      patch_script_hash: await computeRepairPatchScriptHash(forgedPatchOperations),
    };
    const forgedReceipt = {
      ...forgedReceiptMaterial,
      receipt_hash: await computeRepairReceiptHash(forgedReceiptMaterial),
    };
    const forgedTraceMaterial = {
      repair_version: result.trace.repair_version,
      frozen_bundle: result.trace.frozen_bundle,
      attempt_count: 1,
      expected_parent_candidate_hash: forgedCandidateHash,
      attempt_receipt_hashes: [forgedReceipt.receipt_hash],
      terminal_reason_code: null,
    };
    fixture.sessionStore.replaceSnapshot({
      ...snapshot,
      trace_history: [
        initialTrace,
        {
          ...forgedTraceMaterial,
          trace_hash: await computeRepairTraceHash(forgedTraceMaterial),
        },
      ],
      transitions: [
        {
          receipt: forgedReceipt,
          candidate: forgedCandidate,
        },
      ],
    });

    await expect(
      loadCurrentRepairSession({
        authority: fixture.createAuthority(),
        compiler_input: fixture.compilerInput,
        repair_id: fixture.frozenBundle.repair_id,
        episode_hash: fixture.frozenBundle.episode_hash,
      }),
    ).rejects.toThrow("TEXT2SQL_REPAIR_SESSION_REHYDRATION_FAILED");
  });

  it("同一 episode 不能换 repair_id 重置，旧 head/clone 不能并发分叉", async () => {
    const fixture = await repairFixtureBase();
    const trace = await openTrace(fixture);
    const resetBundle = await sealRepairFrozenBundle({
      ...fixture.frozenBundle,
      repair_id: randomUUID(),
    });
    expect(resetBundle.episode_hash).toBe(fixture.frozenBundle.episode_hash);
    expect(resetBundle.episode_hash).toBe(await computeRepairEpisodeHash(resetBundle));
    await expect(
      createBoundedRepairTrace({
        authority: fixture.authority,
        frozen_bundle: resetBundle,
      }),
    ).rejects.toThrow("TEXT2SQL_REPAIR_SESSION_ALREADY_EXISTS");

    const left = await authorizeRepairTrace({
      authority: fixture.authority,
      compiler_input: fixture.compilerInput,
      trace: structuredClone(trace),
    });
    const right = await authorizeRepairTrace({
      authority: fixture.authority,
      compiler_input: fixture.compilerInput,
      trace: structuredClone(trace),
    });
    const [leftResult, rightResult] = await Promise.all([
      attemptBoundedRepair({
        authority: fixture.authority,
        compiler_input: fixture.compilerInput,
        current_parent_sql_artifact_ref: fixture.parentReference,
        failure_gate_receipt_ref: fixture.failureReference,
        trace: left,
      }),
      attemptBoundedRepair({
        authority: fixture.authority,
        compiler_input: fixture.compilerInput,
        current_parent_sql_artifact_ref: fixture.parentReference,
        failure_gate_receipt_ref: fixture.failureReference,
        trace: right,
      }),
    ]);
    expect([leftResult.state, rightResult.state].sort()).toEqual(["CANDIDATE", "STALE_HEAD"]);
    expect([leftResult, rightResult].find(({ state }) => state === "STALE_HEAD")).toEqual({
      state: "STALE_HEAD",
      reason_code: "REPAIR_CONCURRENT_TRANSITION",
      reload_required: true,
    });
    await expect(
      attemptBoundedRepair({
        authority: fixture.authority,
        compiler_input: fixture.compilerInput,
        current_parent_sql_artifact_ref: fixture.parentReference,
        failure_gate_receipt_ref: fixture.failureReference,
        trace,
      }),
    ).resolves.toEqual({
      state: "STALE_HEAD",
      reason_code: "REPAIR_CONCURRENT_TRANSITION",
      reload_required: true,
    });

    const sameObjectFixture = await repairFixtureBase();
    const sameObjectTrace = await openTrace(sameObjectFixture);
    const sameObjectInput = {
      authority: sameObjectFixture.authority,
      compiler_input: sameObjectFixture.compilerInput,
      current_parent_sql_artifact_ref: sameObjectFixture.parentReference,
      failure_gate_receipt_ref: sameObjectFixture.failureReference,
      trace: sameObjectTrace,
    };
    const sameObjectResults = await Promise.all([
      attemptBoundedRepair(sameObjectInput),
      attemptBoundedRepair(sameObjectInput),
    ]);
    expect(sameObjectResults.map(({ state }) => state).sort()).toEqual(["CANDIDATE", "STALE_HEAD"]);
  });

  it("no-progress 写入吸收终态 Receipt，普通 authority 与跨 Scope Bundle 失败关闭", async () => {
    const noProgressFixture = await repairFixtureBase({ parent_state: "CANONICAL" });
    const noProgress = await attemptBoundedRepair({
      authority: noProgressFixture.authority,
      compiler_input: noProgressFixture.compilerInput,
      current_parent_sql_artifact_ref: noProgressFixture.parentReference,
      failure_gate_receipt_ref: noProgressFixture.failureReference,
      trace: await openTrace(noProgressFixture),
    });
    expect(noProgress).toMatchObject({
      state: "TERMINAL",
      reason_code: "REPAIR_NO_PROGRESS",
      receipt: {
        outcome: "TERMINAL",
        terminal_reason_code: "REPAIR_NO_PROGRESS",
      },
      trace: {
        attempt_count: 1,
        terminal_reason_code: "REPAIR_NO_PROGRESS",
      },
    });
    if (noProgress.state !== "TERMINAL" || !noProgress.receipt) {
      throw new Error("No-progress 必须有终态 Receipt。");
    }
    expect(noProgress.receipt.receipt_hash).toBe(
      await computeRepairReceiptHash(noProgress.receipt),
    );
    for (const contradictoryReceipt of [
      { ...noProgress.receipt, deterministic_query_hash: null },
      { ...noProgress.receipt, child_candidate_hash: HASH_A },
      {
        ...noProgress.receipt,
        terminal_reason_code: "REPAIR_SESSION_TERMINATED",
      },
    ]) {
      expect(repairReceiptSchema.safeParse(contradictoryReceipt).success).toBe(false);
    }
    const terminalReplayInput = {
      authority: noProgressFixture.authority,
      compiler_input: noProgressFixture.compilerInput,
      current_parent_sql_artifact_ref: noProgressFixture.parentReference,
      failure_gate_receipt_ref: noProgressFixture.failureReference,
      trace: noProgress.trace,
    };
    await expect(attemptBoundedRepair(terminalReplayInput)).resolves.toMatchObject({
      state: "TERMINAL",
      reason_code: "REPAIR_SESSION_TERMINATED",
      receipt: null,
    });
    await expect(attemptBoundedRepair(terminalReplayInput)).resolves.toMatchObject({
      state: "TERMINAL",
      reason_code: "REPAIR_SESSION_TERMINATED",
      receipt: null,
    });

    const plainAuthorityFixture = await repairFixtureBase();
    await expect(
      attemptBoundedRepair({
        authority: { ...plainAuthorityFixture.authority },
        compiler_input: plainAuthorityFixture.compilerInput,
        current_parent_sql_artifact_ref: plainAuthorityFixture.parentReference,
        failure_gate_receipt_ref: plainAuthorityFixture.failureReference,
        trace: await openTrace(plainAuthorityFixture),
      }),
    ).rejects.toThrow("TEXT2SQL_REPAIR_AUTHORITY_REQUIRED");

    const crossScopeFixture = await repairFixtureBase();
    const crossScopeBundle = {
      ...crossScopeFixture.frozenBundle,
      root_sql_artifact_ref: {
        ...crossScopeFixture.frozenBundle.root_sql_artifact_ref,
        tenant_id: randomUUID(),
      },
    };
    await expect(
      createBoundedRepairTrace({
        authority: crossScopeFixture.authority,
        frozen_bundle: crossScopeBundle,
      }),
    ).rejects.toThrow();
  });
});
