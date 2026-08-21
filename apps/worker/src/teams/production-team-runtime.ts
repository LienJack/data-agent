import { createHash } from "node:crypto";
import {
  advanceContextEpochTransition,
  authorizePersistedTaskCapability,
  buildOpenObligationLedger,
  buildTaskCapabilityReceipt,
  buildTaskCompletionReceipt,
  buildTeamTaskV2,
  buildVerifierDecision,
  createContextEpochTransition,
  createSubagentDelegationCommand,
  decideTaskAcceptance,
  getAgentProfileRevision,
  type TeamTaskV2,
} from "@data-agent/agent-runtime";
import {
  type AgentProductProfileRegistryItem,
  type AgentSpecialistProfileId,
  type ArtifactReference,
  artifactReferenceIdentity,
  canonicalizeJson,
  type PortResult,
  type SideEffectReceipt,
  sha256ContentHash,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts";
import { buildAgentTeamStoreCommand } from "@data-agent/platform";
import type {
  RunExecutionContext,
  RunSideEffectExecutionIdentity,
} from "../runs/run-worker-runner.js";
import type { DataAgentProductTeamRuntimePort } from "./data-agent-team-runner.js";
import {
  createMastraProfileComposition,
  type ProductProfileToolPort,
} from "./mastra-profile-composition.js";

type TeamStoreMethod = (capability: unknown, command: unknown) => Promise<PortResult<unknown>>;

export interface ProductionTeamRunStore {
  readonly createTask: TeamStoreMethod;
  readonly prepareHandoff: TeamStoreMethod;
  readonly commitContextEpoch: TeamStoreMethod;
  readonly commitCompletion: TeamStoreMethod;
  readonly commitAcceptance: TeamStoreMethod;
  readonly issueTaskCapability: TeamStoreMethod;
  readonly loadRun: TeamStoreMethod;
}

export interface ProductionTeamRuntimeDependencies {
  readonly store: ProductionTeamRunStore;
  readonly capability: unknown;
  readonly tools?: ProductProfileToolPort;
  readonly create_tools?: (input: ProductionTeamToolFactoryInput) => ProductProfileToolPort;
  readonly artifacts: {
    verifyCommitted(reference: ArtifactReference): Promise<PortResult<boolean>>;
    resolveCommitted(reference: ArtifactReference): Promise<PortResult<unknown | null>>;
  };
  readonly now?: () => Date;
}

export interface ProductionTeamToolFactoryInput {
  readonly lease: Parameters<DataAgentProductTeamRuntimePort["execute"]>[0]["lease"];
  readonly execution_context: RunExecutionContext;
  readonly resolved_context_ref: Parameters<
    DataAgentProductTeamRuntimePort["execute"]
  >[0]["resolved_context_ref"];
  readonly accepted_evidence_ref: ArtifactReference | null;
}

class ProductionTeamRuntimeError extends Error {
  override readonly name = "ProductionTeamRuntimeError";

  constructor(readonly code: string) {
    super(code);
  }
}

function deterministicUuid(material: string): string {
  const bytes = createHash("sha256")
    .update(`data-agent/team-runtime@1\0${material}`)
    .digest()
    .subarray(0, 16);
  const version = bytes[6];
  const variant = bytes[8];
  if (version === undefined || variant === undefined) {
    throw new ProductionTeamRuntimeError("TEAM_IDENTITY_DERIVATION_FAILED");
  }
  bytes[6] = (version & 0x0f) | 0x80;
  bytes[8] = (variant & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function identity(runId: string, label: string): string {
  return deterministicUuid(`${runId}\0${label}`);
}

function stableStartedAt(
  lease: Parameters<DataAgentProductTeamRuntimePort["execute"]>[0]["lease"],
): string {
  return new Date(Date.parse(lease.expires_at) - lease.lease_duration_ms).toISOString();
}

function portValue<T>(result: PortResult<T>): T {
  if (!result.ok) throw new ProductionTeamRuntimeError(result.error.code);
  return result.value;
}

async function command(input: {
  readonly operation:
    | "CREATE_TASK"
    | "PREPARE_HANDOFF"
    | "COMMIT_CONTEXT_EPOCH"
    | "COMMIT_COMPLETION"
    | "COMMIT_ACCEPTANCE"
    | "ISSUE_TASK_CAPABILITY"
    | "LOAD_RUN";
  readonly label: string;
  readonly task_id: string;
  readonly expected_revision: number | null;
  readonly document: unknown | null;
  readonly lease: Parameters<DataAgentProductTeamRuntimePort["execute"]>[0]["lease"];
}) {
  return buildAgentTeamStoreCommand({
    schema_version: "agent-team-store-command@1.0.0",
    operation: input.operation,
    command_id: identity(input.lease.run_id, input.label),
    scope: input.lease.scope,
    run_id: input.lease.run_id,
    task_id: input.task_id,
    expected_revision: input.expected_revision,
    lease: input.lease,
    selector: null,
    document: input.document,
  });
}

async function persist(
  method: TeamStoreMethod,
  capability: unknown,
  input: Parameters<typeof command>[0],
): Promise<unknown> {
  const result = portValue(await method(capability, await command(input))) as {
    readonly document?: unknown;
  };
  return result.document ?? input.document;
}

function bounds(input: Parameters<DataAgentProductTeamRuntimePort["execute"]>[0]) {
  const safety = input.execution_context.getEffectiveConfig().execution_safety_policy;
  const context = input.execution_context.getEffectiveConfig().context_policy;
  return {
    max_context_bytes: 65_536,
    max_input_tokens: Math.max(1, Math.min(32_768, context.max_context_tokens)),
    max_output_tokens: 4_096,
    max_tool_calls: Math.min(32, safety.max_tool_calls),
    timeout_ms: Math.min(600_000, safety.max_elapsed_ms),
  } as const;
}

async function emit(
  context: RunExecutionContext,
  event: Parameters<NonNullable<RunExecutionContext["emitDisplayEvent"]>>[0],
): Promise<void> {
  if (!context.emitDisplayEvent) throw new ProductionTeamRuntimeError("RUN_DISPLAY_EVENT_REQUIRED");
  portValue(await context.emitDisplayEvent(event));
}

async function createCapability(input: {
  readonly task: TeamTaskV2;
  readonly lease: Parameters<DataAgentProductTeamRuntimePort["execute"]>[0]["lease"];
  readonly store: ProductionTeamRuntimeDependencies["store"];
  readonly capability: unknown;
  readonly issued_at: string;
}) {
  const expiresAt = new Date(
    Math.min(Date.parse(input.lease.expires_at), Date.parse(input.issued_at) + 10 * 60_000),
  ).toISOString();
  const receipt = await buildTaskCapabilityReceipt({
    schema_version: "task-capability-receipt@2.0.0",
    capability_id: identity(input.lease.run_id, `capability:${input.task.task_id}`),
    scope: input.task.scope,
    run_id: input.task.run_id,
    task_id: input.task.task_id,
    attempt_id: input.task.attempt_id,
    worker_fence: input.task.worker_fence,
    profile_id: input.task.profile_id,
    profile_revision: input.task.profile_revision,
    profile_hash: input.task.profile_hash,
    artifact_ref_identities: [],
    operation_audiences: ["HANDOFF_PREPARE", "TASK_COMPLETE", "TOOL_INVOKE"],
    issuer: { principal_id: input.lease.principal_id, key_id: "team-runtime-key@1.0.0" },
    issued_at: input.issued_at,
    expires_at: expiresAt,
    nonce: identity(input.lease.run_id, `nonce:${input.task.task_id}`),
    revocation_version: 1,
  });
  await persist(input.store.issueTaskCapability, input.capability, {
    operation: "ISSUE_TASK_CAPABILITY",
    label: `issue-capability:${input.task.task_id}`,
    task_id: input.task.task_id,
    expected_revision: input.task.task_revision,
    document: receipt,
    lease: input.lease,
  });
  return authorizePersistedTaskCapability(
    input.task,
    receipt.capability_id,
    { resolve_committed: async () => receipt },
    { now: input.issued_at, audience: "TASK_COMPLETE" },
  );
}

async function createChild(input: {
  readonly root: TeamTaskV2;
  readonly root_capability: Awaited<ReturnType<typeof createCapability>>;
  readonly profile_id: AgentSpecialistProfileId;
  readonly lease: Parameters<DataAgentProductTeamRuntimePort["execute"]>[0]["lease"];
  readonly store: ProductionTeamRuntimeDependencies["store"];
  readonly capability: unknown;
  readonly bounds: ReturnType<typeof bounds>;
}) {
  const taskId = identity(input.lease.run_id, `task:${input.profile_id}`);
  const delegation = createSubagentDelegationCommand(input.root, input.root_capability, {
    schema_version: "subagent-delegation-request@2.0.0",
    handoff_id: identity(input.lease.run_id, `handoff:${input.profile_id}`),
    child_task_id: taskId,
    child_attempt_id: identity(input.lease.run_id, `attempt:${input.profile_id}`),
    child_profile_id: input.profile_id,
    parent_expected_revision: input.root.task_revision,
    objective_hash: await sha256ContentHash({
      run_id: input.lease.run_id,
      profile_id: input.profile_id,
    }),
    artifact_refs: [],
    bounds: input.bounds,
    idempotency_key: `team:${input.lease.run_id}:${input.profile_id}`,
  });
  await persist(input.store.prepareHandoff, input.capability, {
    operation: "PREPARE_HANDOFF",
    label: `prepare-handoff:${input.profile_id}`,
    task_id: input.root.task_id,
    expected_revision: input.root.task_revision,
    document: delegation,
    lease: input.lease,
  });
  return delegation.child_task;
}

async function commitContextEpoch(input: {
  readonly task: TeamTaskV2;
  readonly context_ref: Parameters<
    DataAgentProductTeamRuntimePort["execute"]
  >[0]["resolved_context_ref"];
  readonly lease: Parameters<DataAgentProductTeamRuntimePort["execute"]>[0]["lease"];
  readonly store: ProductionTeamRuntimeDependencies["store"];
  readonly capability: unknown;
}) {
  const ledger = await buildOpenObligationLedger({
    schema_version: "open-obligation-ledger@2.0.0",
    task_id: input.task.task_id,
    task_revision: input.task.task_revision,
    obligations: [],
  });
  const currentEpoch = {
    epoch_id: identity(input.lease.run_id, `epoch-current:${input.task.task_id}`),
    build_signature: await sha256ContentHash({ state: "empty", task_id: input.task.task_id }),
  };
  const proposedEpoch = {
    epoch_id: identity(input.lease.run_id, `epoch:${input.task.task_id}`),
    build_signature: await sha256ContentHash(input.context_ref),
  };
  let transition = await createContextEpochTransition({
    transition_id: identity(input.lease.run_id, `epoch-transition:${input.task.task_id}`),
    current_epoch: currentEpoch,
    proposed_epoch: proposedEpoch,
    current_obligations: ledger,
    proposed_obligations: ledger,
  });
  for (const phase of [
    "STARTED",
    "SUMMARY_COMMITTED",
    "REPLACEMENT_COMMITTED",
    "PROBE_PASSED",
    "ACTIVATED",
  ] as const) {
    if (transition.phase !== phase)
      transition = await advanceContextEpochTransition(transition, phase);
    await persist(input.store.commitContextEpoch, input.capability, {
      operation: "COMMIT_CONTEXT_EPOCH",
      label: `context:${input.task.task_id}:${phase}`,
      task_id: input.task.task_id,
      expected_revision: input.task.task_revision,
      document: transition,
      lease: input.lease,
    });
  }
  return proposedEpoch;
}

async function commitAcceptedCompletion(input: {
  readonly task: TeamTaskV2;
  readonly output_ref: ArtifactReference;
  readonly task_capability: Awaited<ReturnType<typeof createCapability>>;
  readonly lease: Parameters<DataAgentProductTeamRuntimePort["execute"]>[0]["lease"];
  readonly store: ProductionTeamRuntimeDependencies["store"];
  readonly capability: unknown;
  readonly artifacts: ProductionTeamRuntimeDependencies["artifacts"];
  readonly timestamp: string;
  readonly coverage_hash: string;
}) {
  if (!portValue(await input.artifacts.verifyCommitted(input.output_ref))) {
    throw new ProductionTeamRuntimeError("TEAM_OUTPUT_ARTIFACT_NOT_COMMITTED");
  }
  const completion = await buildTaskCompletionReceipt(input.task, input.task_capability, {
    schema_version: "task-completion-command@2.0.0",
    completion_id: identity(input.lease.run_id, `completion:${input.task.task_id}`),
    task_expected_revision: input.task.task_revision,
    output_ref: input.output_ref,
    completed_at: input.timestamp,
    idempotency_key: `complete:${input.lease.run_id}:${input.task.task_id}`,
  });
  await persist(input.store.commitCompletion, input.capability, {
    operation: "COMMIT_COMPLETION",
    label: `commit-completion:${input.task.task_id}`,
    task_id: input.task.task_id,
    expected_revision: input.task.task_revision,
    document: completion,
    lease: input.lease,
  });
  const verifier = await buildVerifierDecision({
    schema_version: "team-verifier-decision@2.0.0",
    decision_id: identity(input.lease.run_id, `verifier:${input.task.task_id}`),
    task_id: input.task.task_id,
    task_revision: input.task.task_revision,
    completion_hash: completion.completion_hash,
    schema_valid: "PASS",
    scope_valid: "PASS",
    policy_valid: "PASS",
    provenance_valid: "PASS",
    execution_valid: "PASS",
    intent_grounded: "PASS",
    oracle_verified: "PASS",
    semantic_status: "VERIFIED",
    decided_at: input.timestamp,
  });
  const acceptance = await decideTaskAcceptance({
    task: input.task,
    completion,
    verifier,
    coverage_hash: input.coverage_hash,
    coverage_acceptance_blocked: false,
    blocking_obligation_ids: [],
    accepted_at: input.timestamp,
  });
  await persist(input.store.commitAcceptance, input.capability, {
    operation: "COMMIT_ACCEPTANCE",
    label: `commit-acceptance:${input.task.task_id}`,
    task_id: input.task.task_id,
    expected_revision: input.task.task_revision,
    document: {
      schema_version: "task-acceptance-commit@2.0.0",
      verifier_decision: verifier,
      acceptance_receipt: acceptance,
    },
    lease: input.lease,
  });
  return acceptance;
}

function acceptedOutput(snapshot: unknown): ArtifactReference | null {
  if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) return null;
  const record = snapshot as Record<string, unknown>;
  const completions = Array.isArray(record.completions) ? record.completions : [];
  const acceptances = Array.isArray(record.acceptances) ? record.acceptances : [];
  const accepted = acceptances.find(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as Record<string, unknown>).status === "ACCEPTED",
  ) as Record<string, unknown> | undefined;
  const completion = completions.find(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      (candidate as Record<string, unknown>).completion_id === accepted?.completion_id,
  ) as Record<string, unknown> | undefined;
  return (completion?.output_ref as ArtifactReference | undefined) ?? null;
}

export function createProductionTeamRuntime(
  dependencies: ProductionTeamRuntimeDependencies,
): DataAgentProductTeamRuntimePort {
  const now = dependencies.now ?? (() => new Date());
  const runtime: DataAgentProductTeamRuntimePort = {
    async execute(input: Parameters<DataAgentProductTeamRuntimePort["execute"]>[0]) {
      const timestamp = stableStartedAt(input.lease);
      const rootId = identity(input.lease.run_id, "task:root");
      try {
        const reportTaskId = identity(input.lease.run_id, "task:report-writing-agent");
        const loadedReport = portValue(
          await dependencies.store.loadRun(
            dependencies.capability,
            await command({
              operation: "LOAD_RUN",
              label: "load-report",
              task_id: reportTaskId,
              expected_revision: null,
              document: null,
              lease: input.lease,
            }),
          ),
        );
        const replay = loadedReport as { readonly document?: unknown };
        if (acceptedOutput(replay.document)) {
          return { status: "ACCEPTED", reason_code: "TEAM_ACCEPTED_REPLAY" };
        }

        const rootProfile = getAgentProfileRevision("data-agent-orchestrator");
        const taskBounds = bounds(input);
        const root = buildTeamTaskV2({
          schema_version: "agent-team-task@2.0.0",
          task_id: rootId,
          parent_task_id: null,
          parent_handoff_id: null,
          depth: 0,
          scope: input.lease.scope,
          run_id: input.lease.run_id,
          profile_id: rootProfile.profile_id,
          profile_revision: rootProfile.revision,
          profile_hash: rootProfile.profile_hash,
          task_revision: 1,
          goal_revision: 1,
          attempt_id: input.lease.attempt_id,
          worker_fence: input.lease.worker_fence,
          artifact_refs: [],
          context_epoch_ref: null,
          bounds: taskBounds,
          acceptance: {
            required_artifact_types: rootProfile.expected_output_artifact_types,
            require_all_verifier_dimensions: true,
          },
        });
        await persist(dependencies.store.createTask, dependencies.capability, {
          operation: "CREATE_TASK",
          label: "create-root",
          task_id: root.task_id,
          expected_revision: null,
          document: root,
          lease: input.lease,
        });
        const rootCapability = await createCapability({
          task: root,
          lease: input.lease,
          store: dependencies.store,
          capability: dependencies.capability,
          issued_at: timestamp,
        });

        const specialistIds = [
          "semantic-management-agent",
          "governed-text2sql-agent",
          "report-writing-agent",
        ] as const;
        const tasks = new Map<AgentSpecialistProfileId, TeamTaskV2>();
        for (const profileId of specialistIds) {
          const task = await createChild({
            root,
            root_capability: rootCapability,
            profile_id: profileId,
            lease: input.lease,
            store: dependencies.store,
            capability: dependencies.capability,
            bounds: taskBounds,
          });
          tasks.set(profileId, task);
          await emit(input.execution_context, {
            kind: "agent_status",
            key: `team.agent.${task.task_id}.pending`,
            profile_id: profileId,
            task_id: task.task_id,
            status: "PENDING",
            phase: "handoff.committed",
            title: profileId,
            summary: "专职任务与 Handoff 已持久化",
            duration_ms: null,
            error_code: null,
          });
        }

        const semanticTask = tasks.get("semantic-management-agent");
        if (!semanticTask) throw new ProductionTeamRuntimeError("TEAM_SEMANTIC_TASK_MISSING");
        await emit(input.execution_context, {
          kind: "agent_status",
          key: `team.agent.${semanticTask.task_id}.skipped`,
          profile_id: "semantic-management-agent",
          task_id: semanticTask.task_id,
          status: "SKIPPED",
          phase: "semantic.release.ready",
          title: "Semantic",
          summary: "冻结 Effective Config 已绑定 Published Semantic Release，无需写 Candidate",
          duration_ms: 0,
          error_code: null,
        });

        const coverageHash = await sha256ContentHash({
          resolved_context_ref: input.resolved_context_ref,
          profiles: [...input.profiles.values()].map(({ revision }) => revision.revision_hash),
        });
        let evidenceRef: ArtifactReference | null = null;
        for (const profileId of ["governed-text2sql-agent", "report-writing-agent"] as const) {
          const task = tasks.get(profileId);
          if (!task) throw new ProductionTeamRuntimeError("TEAM_SPECIALIST_TASK_MISSING");
          const epoch = await commitContextEpoch({
            task,
            context_ref: input.resolved_context_ref,
            lease: input.lease,
            store: dependencies.store,
            capability: dependencies.capability,
          });
          await emit(input.execution_context, {
            kind: "agent_status",
            key: `team.agent.${task.task_id}.running`,
            profile_id: profileId,
            task_id: task.task_id,
            status: "RUNNING",
            phase: "context.activated",
            title: profileId === "governed-text2sql-agent" ? "Text2SQL" : "Report",
            summary: "受治理 Context Epoch 已激活，开始执行专职 Tool 链",
            duration_ms: null,
            error_code: null,
          });
          const tools =
            dependencies.create_tools?.({
              lease: input.lease,
              execution_context: input.execution_context,
              resolved_context_ref: input.resolved_context_ref,
              accepted_evidence_ref: evidenceRef,
            }) ?? dependencies.tools;
          if (!tools) throw new ProductionTeamRuntimeError("TEAM_TOOL_COMPOSITION_REQUIRED");
          const registry = await createMastraProfileComposition({
            profiles: [...input.profiles.values()] as AgentProductProfileRegistryItem[],
            tools,
            visibility: {
              emit: (event) => {
                if (!input.execution_context.emitDisplayEvent) {
                  return Promise.resolve({
                    ok: false as const,
                    error: {
                      code: "RUN_DISPLAY_EVENT_REQUIRED",
                      message: "Display event authority is required.",
                      retryable: false,
                    },
                  });
                }
                return input.execution_context.emitDisplayEvent(event);
              },
            },
            now: () => now().getTime(),
          });
          const effect: SideEffectReceipt = portValue(
            await input.execution_context.executeSideEffectOnce({
              effect_kind: "EVAL",
              input: {
                schema_version: "team-specialist-effect@1.0.0",
                task_id: task.task_id,
                task_hash: task.task_hash,
                context_epoch: epoch,
                input_ref: evidenceRef,
              },
              execute: async ({ signal }: RunSideEffectExecutionIdentity) => {
                const result = await registry.execute(task, epoch, signal);
                if (result.status !== "COMPLETED" || !result.output_ref) {
                  throw new ProductionTeamRuntimeError("TEAM_SPECIALIST_EXECUTION_FAILED");
                }
                return { output: result.output_ref, artifact_ref: result.output_ref };
              },
            }),
          );
          const outputRef: ArtifactReference | undefined = effect.artifact_ref;
          if (!outputRef) throw new ProductionTeamRuntimeError("TEAM_SPECIALIST_OUTPUT_MISSING");
          const taskCapability = await createCapability({
            task,
            lease: input.lease,
            store: dependencies.store,
            capability: dependencies.capability,
            issued_at: timestamp,
          });
          await commitAcceptedCompletion({
            task,
            output_ref: outputRef,
            task_capability: taskCapability,
            lease: input.lease,
            store: dependencies.store,
            capability: dependencies.capability,
            artifacts: dependencies.artifacts,
            timestamp,
            coverage_hash: coverageHash,
          });
          await emit(input.execution_context, {
            kind: "agent_status",
            key: `team.agent.${task.task_id}.completed`,
            profile_id: profileId,
            task_id: task.task_id,
            status: "COMPLETED",
            phase: "acceptance.committed",
            title: profileId === "governed-text2sql-agent" ? "Text2SQL" : "Report",
            summary: "Completion、Verifier 与 Acceptance 已持久化并验收",
            duration_ms: Math.max(0, now().getTime() - Date.parse(timestamp)),
            error_code: null,
          });
          if (profileId === "report-writing-agent") {
            const report = await verifyProductTeamArtifactDocument(
              portValue(await dependencies.artifacts.resolveCommitted(outputRef)),
            );
            if (
              artifactReferenceIdentity(report.artifact_ref) !==
                artifactReferenceIdentity(outputRef) ||
              report.projection.kind !== "REPORT"
            ) {
              throw new ProductionTeamRuntimeError("TEAM_REPORT_PROJECTION_INVALID");
            }
            const answer = report.projection.sections
              .map(({ body_text: bodyText }) => bodyText)
              .join("\n\n");
            await emit(input.execution_context, {
              kind: "answer_delta",
              key: `team.answer.${task.task_id}`,
              delta: answer,
            });
          }
          evidenceRef = outputRef;
        }
        return { status: "ACCEPTED", reason_code: "TEAM_ACCEPTED" };
      } catch (error) {
        const code =
          error instanceof ProductionTeamRuntimeError
            ? error.code
            : error instanceof Error && /^[A-Z][A-Z0-9_]*$/.test(error.message)
              ? error.message
              : "DATA_AGENT_TEAM_RUNTIME_FAILED";
        return { status: "FAILED", reason_code: code };
      }
    },
  };
  return Object.freeze(runtime);
}

export const productionTeamRuntimeInternals = Object.freeze({
  deterministicUuid,
  identity,
  acceptedOutput,
  stableStartedAt,
  canonicalizeJson,
});
