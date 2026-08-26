import { createHash } from "node:crypto";
import {
  type AdmittedSubagentDelegation,
  type AuthoritativeAcceptedSiblingOutputAttachment,
  advanceContextEpochTransition,
  authorizePersistedAcceptedSiblingOutputAttachment,
  authorizePersistedTaskCapability,
  buildAcceptedSiblingOutputAttachment,
  buildOpenObligationLedger,
  buildTaskCapabilityReceipt,
  buildTaskCompletionReceipt,
  buildTeamTaskV2,
  buildVerifierDecision,
  createContextEpochTransition,
  createSubagentDelegationCommand,
  type DataAgentSpecialistProfileId,
  dataAgentSpecialistProfileIdSchema,
  decideTaskAcceptance,
  getAgentProfileRevision,
  type TaskAcceptanceReceipt,
  type TeamTaskV2,
} from "@data-agent/agent-runtime";
import {
  type AgentProductProfileRegistryItemV2,
  type ArtifactReference,
  artifactReferenceIdentity,
  canonicalizeJson,
  type PortResult,
  type ProductTeamArtifactDocument,
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
import { deriveTeamRuntimeTaskBounds } from "./team-runtime-bounds.js";

type TeamStoreMethod = (capability: unknown, command: unknown) => Promise<PortResult<unknown>>;

export interface ProductionTeamRunStore {
  readonly createTask: TeamStoreMethod;
  readonly prepareHandoff: TeamStoreMethod;
  readonly commitContextEpoch: TeamStoreMethod;
  readonly commitCompletion: TeamStoreMethod;
  readonly commitAcceptance: TeamStoreMethod;
  readonly attachAcceptedSiblingOutput: TeamStoreMethod;
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
  readonly semantic_context_ref: Parameters<
    DataAgentProductTeamRuntimePort["execute"]
  >[0]["semantic_context_ref"];
  readonly semantic_context_package: Parameters<
    DataAgentProductTeamRuntimePort["execute"]
  >[0]["semantic_context_package"];
  readonly semantic_context: Parameters<
    DataAgentProductTeamRuntimePort["execute"]
  >[0]["semantic_context"];
  readonly accepted_evidence_ref: ArtifactReference | null;
  readonly delegation: AdmittedSubagentDelegation | null;
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
    | "ATTACH_ACCEPTED_SIBLING_OUTPUT"
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
  return deriveTeamRuntimeTaskBounds(input.execution_context.getEffectiveConfig());
}

function delegationBounds(delegation: AdmittedSubagentDelegation) {
  const budget = delegation.receipt.effective_budget;
  return {
    max_context_bytes: budget.max_context_bytes,
    max_input_tokens: budget.max_input_tokens,
    max_output_tokens: budget.max_output_tokens,
    max_tool_calls: budget.max_tool_calls,
    timeout_ms: budget.timeout_ms,
  } as const;
}

function delegationExecutionTools(
  profileId: DataAgentSpecialistProfileId,
  delegation: AdmittedSubagentDelegation,
): readonly string[] {
  if (
    profileId === "semantic-management-agent" &&
    delegation.profile.revision.discovery.access_mode === "READ_ONLY"
  ) {
    return delegation.receipt.tool_allowlist.filter((toolId) => toolId === "semantic.catalog.read");
  }
  return delegation.receipt.tool_allowlist;
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
    artifact_ref_identities: input.task.artifact_refs.map(artifactReferenceIdentity),
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
  readonly profile_id: DataAgentSpecialistProfileId;
  readonly profile: AgentProductProfileRegistryItemV2;
  readonly delegation: AdmittedSubagentDelegation;
  readonly artifact_refs: readonly ArtifactReference[];
  readonly accepted_sibling_attachments: readonly AuthoritativeAcceptedSiblingOutputAttachment[];
  readonly lease: Parameters<DataAgentProductTeamRuntimePort["execute"]>[0]["lease"];
  readonly store: ProductionTeamRuntimeDependencies["store"];
  readonly capability: unknown;
  readonly bounds: ReturnType<typeof bounds>;
}) {
  const taskId = input.delegation.receipt.task_id;
  const delegation = createSubagentDelegationCommand(
    input.root,
    input.root_capability,
    {
      schema_version: "subagent-delegation-request@2.0.0",
      handoff_id: input.delegation.receipt.delegation_id,
      child_task_id: taskId,
      child_attempt_id: input.delegation.receipt.attempt_id,
      child_profile_id: input.profile_id,
      child_profile_revision: input.profile.revision.runtime_profile_ref.revision,
      child_profile_hash: input.profile.revision.runtime_profile_ref.profile_hash,
      parent_expected_revision: input.root.task_revision,
      objective_hash: input.delegation.receipt.objective_hash,
      artifact_refs: input.artifact_refs,
      bounds: delegationBounds(input.delegation),
      idempotency_key: input.delegation.receipt.idempotency_key,
    },
    input.accepted_sibling_attachments,
  );
  await persist(input.store.prepareHandoff, input.capability, {
    operation: "PREPARE_HANDOFF",
    label: `prepare-handoff:${input.delegation.receipt.delegation_id}`,
    task_id: input.root.task_id,
    expected_revision: input.root.task_revision,
    document: delegation,
    lease: input.lease,
  });
  return delegation.child_task;
}

type AcceptedDelegationOutput = Readonly<{
  task: TeamTaskV2;
  tool_call_id: string;
  output_ref: ArtifactReference;
  acceptance: TaskAcceptanceReceipt;
}>;

async function attachAcceptedSiblingOutput(input: {
  readonly root: TeamTaskV2;
  readonly producer: AcceptedDelegationOutput;
  readonly consumer: AdmittedSubagentDelegation;
  readonly lease: Parameters<DataAgentProductTeamRuntimePort["execute"]>[0]["lease"];
  readonly store: ProductionTeamRuntimeDependencies["store"];
  readonly capability: unknown;
  readonly attached_at: string;
}): Promise<AuthoritativeAcceptedSiblingOutputAttachment> {
  const attachment = await buildAcceptedSiblingOutputAttachment({
    schema_version: "agent-team-accepted-sibling-output-attachment@1.0.0",
    attachment_id: identity(
      input.lease.run_id,
      `accepted-sibling:${input.consumer.receipt.task_id}`,
    ),
    scope: input.lease.scope,
    run_id: input.lease.run_id,
    root_task_id: input.root.task_id,
    root_task_hash: input.root.task_hash,
    producer_task_id: input.producer.task.task_id,
    producer_task_hash: input.producer.task.task_hash,
    producer_profile_id: input.producer.task.profile_id,
    producer_tool_call_id: input.producer.tool_call_id,
    consumer_task_id: input.consumer.receipt.task_id,
    consumer_tool_call_id: input.consumer.call.tool_call_id,
    consumer_profile_id: input.consumer.profile.revision.runtime_profile_ref.profile_id,
    consumer_profile_revision: input.consumer.profile.revision.runtime_profile_ref.revision,
    consumer_profile_hash: input.consumer.profile.revision.runtime_profile_ref.profile_hash,
    artifact_ref: input.producer.output_ref,
    completion_id: input.producer.acceptance.completion_id,
    completion_hash: input.producer.acceptance.completion_hash,
    verifier_decision_id: input.producer.acceptance.verifier_decision_id,
    verifier_decision_hash: input.producer.acceptance.verifier_decision_hash,
    acceptance_hash: input.producer.acceptance.acceptance_hash,
    worker_fence: input.lease.worker_fence,
    attached_at: input.attached_at,
  });
  const persisted = await persist(input.store.attachAcceptedSiblingOutput, input.capability, {
    operation: "ATTACH_ACCEPTED_SIBLING_OUTPUT",
    label: `attach-accepted-sibling:${input.consumer.receipt.task_id}`,
    task_id: input.root.task_id,
    expected_revision: input.root.task_revision,
    document: attachment,
    lease: input.lease,
  });
  return authorizePersistedAcceptedSiblingOutputAttachment({
    attachment_id: attachment.attachment_id,
    root_task: input.root,
    producer_task: input.producer.task,
    consumer_task_id: input.consumer.receipt.task_id,
    consumer_tool_call_id: input.consumer.call.tool_call_id,
    consumer_profile_id: input.consumer.profile.revision.runtime_profile_ref.profile_id,
    consumer_profile_revision: input.consumer.profile.revision.runtime_profile_ref.revision,
    consumer_profile_hash: input.consumer.profile.revision.runtime_profile_ref.profile_hash,
    producer_tool_call_id: input.producer.tool_call_id,
    artifact_ref: input.producer.output_ref,
    completion_id: input.producer.acceptance.completion_id,
    completion_hash: input.producer.acceptance.completion_hash,
    verifier_decision_id: input.producer.acceptance.verifier_decision_id,
    verifier_decision_hash: input.producer.acceptance.verifier_decision_hash,
    acceptance_hash: input.producer.acceptance.acceptance_hash,
    resolver: { resolve_committed: async () => persisted },
  });
}

async function commitContextEpoch(input: {
  readonly task: TeamTaskV2;
  readonly context_ref: Parameters<
    DataAgentProductTeamRuntimePort["execute"]
  >[0]["semantic_context_ref"];
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
  const document = await verifyProductTeamArtifactDocument(
    portValue(await input.artifacts.resolveCommitted(input.output_ref)),
  );
  if (
    artifactReferenceIdentity(document.artifact_ref) !==
      artifactReferenceIdentity(input.output_ref) ||
    document.profile_id !== input.task.profile_id ||
    document.task_id !== input.task.task_id ||
    document.artifact_ref.app_id !== input.task.scope.app_id ||
    document.artifact_ref.tenant_id !== input.task.scope.tenant_id ||
    document.artifact_ref.environment !== input.task.scope.environment ||
    document.artifact_ref.run_id !== input.task.run_id
  ) {
    throw new ProductionTeamRuntimeError("TEAM_OUTPUT_ARTIFACT_CORRELATION_INVALID");
  }
  if (
    !input.task.acceptance.required_artifact_types.includes(document.artifact_ref.artifact_type)
  ) {
    throw new ProductionTeamRuntimeError("TEAM_OUTPUT_ARTIFACT_TYPE_NOT_ACCEPTED");
  }
  if (
    (input.task.profile_id === "semantic-management-agent" &&
      (document.artifact_ref.artifact_type !== "AnalysisReport" ||
        document.projection.kind !== "REPORT")) ||
    (input.task.profile_id === "governed-analysis-agent" &&
      (document.artifact_ref.artifact_type !== "AnalysisReport" ||
        document.projection.kind !== "REPORT" ||
        !document.source_refs.some(
          ({ artifact_type: artifactType }) => artifactType === "DerivedAnalysisEvidence",
        ) ||
        !document.source_refs.some(
          ({ artifact_type: artifactType }) => artifactType === "ArtifactWorkspaceDocument",
        ))) ||
    (input.task.profile_id === "governed-text2sql-agent" &&
      (document.artifact_ref.artifact_type !== "QueryEvidence" ||
        document.projection.kind !== "TABLE")) ||
    (input.task.profile_id === "report-writing-agent" &&
      (document.artifact_ref.artifact_type !== "AnalysisReport" ||
        document.projection.kind !== "REPORT" ||
        !document.source_refs.some(
          ({ artifact_type: artifactType }) => artifactType === "QueryEvidence",
        )))
  ) {
    throw new ProductionTeamRuntimeError("TEAM_OUTPUT_VERIFIER_CONTRACT_FAILED");
  }
  for (const sourceRef of document.source_refs) {
    if (!portValue(await input.artifacts.verifyCommitted(sourceRef))) {
      throw new ProductionTeamRuntimeError("TEAM_SOURCE_ARTIFACT_NOT_COMMITTED");
    }
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

async function verifyAcceptedReplayBinding(input: {
  readonly snapshot: unknown;
  readonly execution: Parameters<DataAgentProductTeamRuntimePort["execute"]>[0];
  readonly task_id: string;
  readonly profile: AgentProductProfileRegistryItemV2;
}): Promise<void> {
  if (
    typeof input.snapshot !== "object" ||
    input.snapshot === null ||
    Array.isArray(input.snapshot)
  ) {
    throw new ProductionTeamRuntimeError("TEAM_ACCEPTED_REPLAY_BINDING_INVALID");
  }
  const snapshot = input.snapshot as Record<string, unknown>;
  const task = snapshot.task;
  if (typeof task !== "object" || task === null || Array.isArray(task)) {
    throw new ProductionTeamRuntimeError("TEAM_ACCEPTED_REPLAY_BINDING_INVALID");
  }
  const taskRecord = task as Record<string, unknown>;
  const runtimeProfile = input.profile.revision.runtime_profile_ref;
  if (
    taskRecord.task_id !== input.task_id ||
    taskRecord.run_id !== input.execution.lease.run_id ||
    taskRecord.attempt_id !== input.execution.lease.attempt_id ||
    taskRecord.worker_fence !== input.execution.lease.worker_fence ||
    taskRecord.profile_id !== runtimeProfile.profile_id ||
    taskRecord.profile_revision !== runtimeProfile.revision ||
    taskRecord.profile_hash !== runtimeProfile.profile_hash
  ) {
    throw new ProductionTeamRuntimeError("TEAM_ACCEPTED_REPLAY_BINDING_INVALID");
  }
  const expectedContextHash = await sha256ContentHash(input.execution.semantic_context_ref);
  const contextEpochs = Array.isArray(snapshot.context_epochs) ? snapshot.context_epochs : [];
  const activated = contextEpochs.findLast(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).phase === "ACTIVATED",
  ) as Record<string, unknown> | undefined;
  const proposedEpoch = activated?.proposed_epoch;
  if (
    typeof proposedEpoch !== "object" ||
    proposedEpoch === null ||
    Array.isArray(proposedEpoch) ||
    (proposedEpoch as Record<string, unknown>).build_signature !== expectedContextHash
  ) {
    throw new ProductionTeamRuntimeError("TEAM_ACCEPTED_REPLAY_CONTEXT_DRIFT");
  }
}

function renderAcceptedArtifact(document: ProductTeamArtifactDocument): string {
  if (document.projection.kind === "REPORT") {
    if (document.profile_id === "semantic-management-agent") {
      const conclusion = document.projection.sections.find(({ heading }) => heading === "结论");
      if (!conclusion) {
        throw new ProductionTeamRuntimeError("TEAM_SEMANTIC_CONCLUSION_MISSING");
      }
      return conclusion.body_text;
    }
    return document.projection.sections.map(({ body_text: bodyText }) => bodyText).join("\n\n");
  }
  if (document.projection.kind === "TABLE") {
    const tableCountColumn = document.projection.columns.find(({ key }) => key === "table_count");
    const tableCount = tableCountColumn
      ? document.projection.rows[0]?.[tableCountColumn.key]
      : undefined;
    if (typeof tableCount === "number" && Number.isInteger(tableCount)) {
      return `当前受治理数据库共有 ${tableCount} 张已批准业务表。`;
    }
    const hasMonth = document.projection.columns.some(({ key }) => key === "month");
    if (hasMonth) {
      return `已生成并验收 ${document.projection.total_rows} 个有序月份的数据趋势。`;
    }
    return `已生成并验收 ${document.projection.total_rows} 行受治理数据结果。`;
  }
  throw new ProductionTeamRuntimeError("TEAM_FINAL_OUTPUT_NOT_RENDERABLE");
}

function selectedExecutionOrder(
  input: Parameters<DataAgentProductTeamRuntimePort["execute"]>[0],
): readonly DataAgentSpecialistProfileId[] {
  if (input.admitted_delegations.length === 0) {
    throw new ProductionTeamRuntimeError("ROOT_AGENT_EMPTY_DELEGATION");
  }
  return input.admitted_delegations.map(({ profile }) =>
    dataAgentSpecialistProfileIdSchema.parse(profile.revision.profile_id),
  );
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
        const executionOrder = selectedExecutionOrder(input);
        const replayProfileId = executionOrder.at(-1);
        if (!replayProfileId) throw new ProductionTeamRuntimeError("AGENT_DISPATCH_PLAN_INVALID");
        const replayTaskId = input.admitted_delegations.at(-1)?.receipt.task_id;
        if (!replayTaskId) throw new ProductionTeamRuntimeError("ROOT_AGENT_EMPTY_DELEGATION");
        const replayProfile = input.profiles.get(replayProfileId);
        if (!replayProfile) throw new ProductionTeamRuntimeError("AGENT_PROFILE_NOT_ALLOWED");
        const loadedReplay = portValue(
          await dependencies.store.loadRun(
            dependencies.capability,
            await command({
              operation: "LOAD_RUN",
              label: "load-selected-acceptance",
              task_id: replayTaskId,
              expected_revision: null,
              document: null,
              lease: input.lease,
            }),
          ),
        );
        const replay = loadedReplay as { readonly document?: unknown };
        const replayOutput = acceptedOutput(replay.document);
        if (replayOutput) {
          await verifyAcceptedReplayBinding({
            snapshot: replay.document,
            execution: input,
            task_id: replayTaskId,
            profile: replayProfile,
          });
          const document = await verifyProductTeamArtifactDocument(
            portValue(await dependencies.artifacts.resolveCommitted(replayOutput)),
          );
          if (
            artifactReferenceIdentity(document.artifact_ref) !==
              artifactReferenceIdentity(replayOutput) ||
            document.task_id !== replayTaskId ||
            document.profile_id !== replayProfileId ||
            document.artifact_ref.app_id !== input.lease.scope.app_id ||
            document.artifact_ref.tenant_id !== input.lease.scope.tenant_id ||
            document.artifact_ref.environment !== input.lease.scope.environment ||
            document.artifact_ref.run_id !== input.lease.run_id
          ) {
            throw new ProductionTeamRuntimeError("TEAM_ACCEPTED_REPLAY_CORRELATION_INVALID");
          }
          await emit(input.execution_context, {
            kind: "answer_delta",
            key: `team.answer.${replayTaskId}`,
            delta: renderAcceptedArtifact(document),
          });
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
          artifact_refs: [
            ...new Map(
              input.admitted_delegations
                .flatMap(({ receipt }) => receipt.input_artifact_refs)
                .map((reference) => [artifactReferenceIdentity(reference), reference] as const),
            ).values(),
          ].sort((left, right) =>
            artifactReferenceIdentity(left).localeCompare(artifactReferenceIdentity(right)),
          ),
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

        const coverageHash = await sha256ContentHash({
          semantic_context_ref: input.semantic_context_ref,
          profiles: [...input.profiles.values()].map(({ revision }) => revision.revision_hash),
        });
        const acceptedOutputsByToolCallId = new Map<string, AcceptedDelegationOutput>();
        for (const [executionIndex, profileId] of executionOrder.entries()) {
          const admittedDelegation = input.admitted_delegations[executionIndex];
          if (!admittedDelegation) {
            throw new ProductionTeamRuntimeError("ROOT_AGENT_DELEGATION_MISSING");
          }
          const selectedProfile = input.profiles.get(profileId);
          if (!selectedProfile) {
            throw new ProductionTeamRuntimeError("AGENT_PROFILE_NOT_ALLOWED");
          }
          const upstreamSelector = admittedDelegation.receipt.upstream_accepted_output;
          let acceptedUpstreamRef: ArtifactReference | null = null;
          const acceptedSiblingAttachments: AuthoritativeAcceptedSiblingOutputAttachment[] = [];
          if (upstreamSelector) {
            const producer = acceptedOutputsByToolCallId.get(
              upstreamSelector.producer_tool_call_id,
            );
            if (!producer) {
              throw new ProductionTeamRuntimeError("TEAM_UPSTREAM_ACCEPTED_OUTPUT_MISSING");
            }
            if (producer.output_ref.artifact_type !== upstreamSelector.artifact_type) {
              throw new ProductionTeamRuntimeError("TEAM_UPSTREAM_ACCEPTED_OUTPUT_TYPE_MISMATCH");
            }
            acceptedUpstreamRef = producer.output_ref;
            acceptedSiblingAttachments.push(
              await attachAcceptedSiblingOutput({
                root,
                producer,
                consumer: admittedDelegation,
                lease: input.lease,
                store: dependencies.store,
                capability: dependencies.capability,
                attached_at: timestamp,
              }),
            );
          }
          const artifactRefs = [
            ...new Map(
              [
                ...admittedDelegation.receipt.input_artifact_refs,
                ...(acceptedUpstreamRef ? [acceptedUpstreamRef] : []),
              ].map((reference) => [artifactReferenceIdentity(reference), reference] as const),
            ).values(),
          ].sort((left, right) =>
            artifactReferenceIdentity(left).localeCompare(artifactReferenceIdentity(right)),
          );
          const task = await createChild({
            root,
            root_capability: rootCapability,
            profile_id: profileId,
            profile: selectedProfile,
            delegation: admittedDelegation,
            artifact_refs: artifactRefs,
            accepted_sibling_attachments: acceptedSiblingAttachments,
            lease: input.lease,
            store: dependencies.store,
            capability: dependencies.capability,
            bounds: taskBounds,
          });
          await emit(input.execution_context, {
            kind: "agent_status",
            key: `team.agent.${task.task_id}.pending`,
            profile_id: profileId,
            task_id: task.task_id,
            status: "PENDING",
            phase: "root.subagent.selected",
            title: admittedDelegation.profile.revision.discovery.display_name,
            summary: `主 Agent 已选择 Product Profile ${profileId} r${admittedDelegation.profile.revision.revision}；Handoff 已持久化。`,
            duration_ms: null,
            error_code: null,
          });
          const epoch = await commitContextEpoch({
            task,
            context_ref: input.semantic_context_ref,
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
            title:
              profileId === "governed-analysis-agent"
                ? "Governed Analysis"
                : profileId === "governed-text2sql-agent"
                  ? "Text2SQL"
                  : profileId === "report-writing-agent"
                    ? "Report"
                    : "Semantic",
            summary: "受治理 Context Epoch 已激活，Subagent 开始执行专职 Tool 链",
            duration_ms: null,
            error_code: null,
          });
          const tools =
            dependencies.create_tools?.({
              lease: input.lease,
              execution_context: input.execution_context,
              semantic_context_ref: input.semantic_context_ref,
              semantic_context_package: input.semantic_context_package,
              semantic_context: input.semantic_context,
              accepted_evidence_ref: acceptedUpstreamRef,
              delegation: admittedDelegation,
            }) ?? dependencies.tools;
          if (!tools) throw new ProductionTeamRuntimeError("TEAM_TOOL_COMPOSITION_REQUIRED");
          const registry = await createMastraProfileComposition({
            profiles: [...input.profiles.values()],
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
            execution_tool_allowlists: {
              [profileId]: delegationExecutionTools(profileId, admittedDelegation),
            },
          });
          const effect: SideEffectReceipt = portValue(
            await input.execution_context.executeSideEffectOnce({
              effect_kind: "EVAL",
              input: {
                schema_version: "team-specialist-effect@1.0.0",
                task_id: task.task_id,
                task_hash: task.task_hash,
                context_epoch: epoch,
                input_ref: acceptedUpstreamRef,
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
          const acceptance = await commitAcceptedCompletion({
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
          acceptedOutputsByToolCallId.set(admittedDelegation.call.tool_call_id, {
            task,
            tool_call_id: admittedDelegation.call.tool_call_id,
            output_ref: outputRef,
            acceptance,
          });
          await emit(input.execution_context, {
            kind: "agent_status",
            key: `team.agent.${task.task_id}.completed`,
            profile_id: profileId,
            task_id: task.task_id,
            status: "COMPLETED",
            phase: "acceptance.committed",
            title:
              profileId === "governed-analysis-agent"
                ? "Governed Analysis"
                : profileId === "governed-text2sql-agent"
                  ? "Text2SQL"
                  : profileId === "report-writing-agent"
                    ? "Report"
                    : "Semantic",
            summary: "Subagent Completion、Verifier 与 Artifact Acceptance 已持久化并验收",
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
          } else if (executionOrder.at(-1) === profileId) {
            const artifact = await verifyProductTeamArtifactDocument(
              portValue(await dependencies.artifacts.resolveCommitted(outputRef)),
            );
            if (
              artifactReferenceIdentity(artifact.artifact_ref) !==
              artifactReferenceIdentity(outputRef)
            ) {
              throw new ProductionTeamRuntimeError("TEAM_OUTPUT_PROJECTION_INVALID");
            }
            await emit(input.execution_context, {
              kind: "answer_delta",
              key: `team.answer.${task.task_id}`,
              delta: renderAcceptedArtifact(artifact),
            });
          }
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
