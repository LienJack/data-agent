import { type ArtifactReference, artifactReferenceIdentity } from "@data-agent/contracts/artifacts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import {
  buildFalcon24FourLayerBusinessReceipt,
  type Falcon24FourLayerBusinessReceipt,
  type Falcon24FourLayerGateManifest,
  type Falcon24FourLayerManifestTurn,
} from "@data-agent/contracts/evals";
import { type PublicRunEventV2, projectPublicRunEventStream } from "@data-agent/contracts/runs";
import {
  evaluateFalcon24FourLayerTurn,
  type Falcon24FourLayerRubricEvidence,
  verifyFalcon24FourLayerRubricEvidence,
} from "@data-agent/evals";
import type { PostgresFalcon24FourLayerGateTurn } from "@data-agent/platform/runs";

const ROOT_PROFILE_ID = "data-agent-orchestrator";

export interface Falcon24FourLayerBusinessRunProjection {
  readonly run_id: string;
  readonly status: "SUCCEEDED" | "FAILED" | "CANCELLED";
}

export interface Falcon24FourLayerBusinessObservation {
  readonly answer_text: string;
  readonly answer_hash: string;
  readonly public_event_hash: string;
  readonly terminal_status: "COMPLETED" | "FAILED" | "CANCELLED";
  readonly actual_profile_ids: readonly string[];
  readonly accepted_artifact_refs: readonly ArtifactReference[];
  readonly accepted_artifact_refs_hash: string;
}

function terminalStatusForRun(
  status: Falcon24FourLayerBusinessRunProjection["status"],
): Falcon24FourLayerBusinessObservation["terminal_status"] {
  if (status === "SUCCEEDED") return "COMPLETED";
  return status;
}

function acceptedArtifactReferences(events: readonly PublicRunEventV2[]) {
  const byIdentity = new Map<string, ArtifactReference>();
  for (const event of events) {
    if (event.type !== "tool" || event.payload.status !== "COMPLETED") continue;
    for (const reference of event.payload.artifact_refs) {
      if (reference.run_id !== event.run_id) {
        throw new Error("FALCON24_FOUR_LAYER_ARTIFACT_RUN_MISMATCH");
      }
      byIdentity.set(artifactReferenceIdentity(reference), reference);
    }
  }
  return Object.freeze(
    [...byIdentity.values()].sort((left, right) =>
      artifactReferenceIdentity(left).localeCompare(artifactReferenceIdentity(right)),
    ),
  );
}

function assertToolClosure(events: readonly PublicRunEventV2[]): void {
  const openCalls = new Set<string>();
  for (const event of events) {
    if (event.type !== "tool") continue;
    if (event.payload.status === "RUNNING") openCalls.add(event.payload.call_id);
    else openCalls.delete(event.payload.call_id);
  }
  if (openCalls.size > 0) {
    throw new Error("FALCON24_FOUR_LAYER_PUBLIC_TOOL_CLOSURE_INVALID");
  }
}

function mergeArtifactReferences(
  runId: string,
  ...groups: readonly (readonly ArtifactReference[])[]
) {
  const byIdentity = new Map<string, ArtifactReference>();
  for (const reference of groups.flat()) {
    if (reference.run_id !== runId) {
      throw new Error("FALCON24_FOUR_LAYER_ARTIFACT_RUN_MISMATCH");
    }
    byIdentity.set(artifactReferenceIdentity(reference), reference);
  }
  return Object.freeze(
    [...byIdentity.values()].sort((left, right) =>
      artifactReferenceIdentity(left).localeCompare(artifactReferenceIdentity(right)),
    ),
  );
}

export async function projectFalcon24FourLayerBusinessRun(input: {
  readonly run: Falcon24FourLayerBusinessRunProjection;
  readonly public_events: readonly unknown[];
}): Promise<Falcon24FourLayerBusinessObservation> {
  const events = projectPublicRunEventStream(input.public_events);
  if (events.length === 0 || events.some(({ run_id: runId }) => runId !== input.run.run_id)) {
    throw new Error("FALCON24_FOUR_LAYER_PUBLIC_EVENT_RUN_MISMATCH");
  }
  const terminals = events.filter((event) => event.type === "terminal");
  const terminal = terminals[0];
  if (
    terminals.length !== 1 ||
    !terminal ||
    terminal.sequence !== events.at(-1)?.sequence ||
    terminal.payload.status !== terminalStatusForRun(input.run.status)
  ) {
    throw new Error("FALCON24_FOUR_LAYER_PUBLIC_EVENT_TERMINAL_INVALID");
  }
  assertToolClosure(events);
  const answerText = events
    .filter(
      (event): event is Extract<PublicRunEventV2, { type: "answer" }> => event.type === "answer",
    )
    .map(({ payload }) => payload.delta)
    .join("");
  const actualProfileIds = events
    .filter(
      (event): event is Extract<PublicRunEventV2, { type: "agent" }> =>
        event.type === "agent" &&
        event.payload.status === "COMPLETED" &&
        event.payload.profile_id !== ROOT_PROFILE_ID,
    )
    .map(({ payload }) => payload.profile_id);
  const accepted = acceptedArtifactReferences(events);
  return Object.freeze({
    answer_text: answerText,
    answer_hash: await sha256ContentHash(answerText),
    public_event_hash: await sha256ContentHash(events),
    terminal_status: terminal.payload.status,
    actual_profile_ids: Object.freeze(actualProfileIds),
    accepted_artifact_refs: accepted,
    accepted_artifact_refs_hash: await sha256ContentHash(accepted),
  });
}

function manifestTurn(
  manifest: Falcon24FourLayerGateManifest,
  authorityTurn: PostgresFalcon24FourLayerGateTurn,
): Falcon24FourLayerManifestTurn {
  const turn = manifest.turns[authorityTurn.turn_ordinal];
  if (
    !turn ||
    turn.turn_id !== authorityTurn.turn_id ||
    turn.question_hash !== authorityTurn.question_hash ||
    turn.scenario_id !== authorityTurn.scenario_id ||
    turn.scenario_turn_index !== authorityTurn.scenario_turn_index
  ) {
    throw new Error("FALCON24_FOUR_LAYER_TURN_AUTHORITY_MISMATCH");
  }
  return turn;
}

function assertEvidenceIdentity(input: {
  readonly manifest: Falcon24FourLayerGateManifest;
  readonly turn: PostgresFalcon24FourLayerGateTurn;
  readonly observation: Falcon24FourLayerBusinessObservation;
  readonly accepted_artifact_refs: readonly ArtifactReference[];
  readonly accepted_input_artifact_refs: readonly ArtifactReference[];
  readonly evidence: Falcon24FourLayerRubricEvidence;
}): void {
  const { manifest, turn, observation, evidence } = input;
  const acceptedTypes = new Set(
    input.accepted_artifact_refs.map(({ artifact_type }) => artifact_type),
  );
  const currentRunEvidencePresent = input.accepted_artifact_refs.length > 0;
  const acceptedInputPresent = input.accepted_input_artifact_refs.length > 0;
  if (
    turn.conversation_id === null ||
    turn.conversation_resource_version === null ||
    turn.run_id === null ||
    evidence.gate_id !== manifest.gate_id ||
    evidence.attempt_id !== manifest.attempt_id ||
    evidence.manifest_hash !== manifest.manifest_hash ||
    evidence.turn_ordinal !== turn.turn_ordinal ||
    evidence.turn_id !== turn.turn_id ||
    evidence.conversation_id !== turn.conversation_id ||
    evidence.conversation_resource_version !== turn.conversation_resource_version ||
    evidence.run_id !== turn.run_id ||
    evidence.answer_hash !== observation.answer_hash ||
    evidence.public_event_hash !== observation.public_event_hash ||
    evidence.current_run_evidence_present !== currentRunEvidencePresent ||
    evidence.accepted_input_present !== acceptedInputPresent ||
    (evidence.table_present &&
      !acceptedTypes.has("QueryEvidence") &&
      !acceptedTypes.has("ArtifactWorkspaceDocument")) ||
    (evidence.chart_present && !acceptedTypes.has("ArtifactWorkspaceDocument"))
  ) {
    throw new Error("FALCON24_FOUR_LAYER_RUBRIC_EVIDENCE_IDENTITY_MISMATCH");
  }
}

async function failedRubricResults(
  turn: Falcon24FourLayerManifestTurn,
  publicEventHash: string,
  failureCode: string,
) {
  return Promise.all(
    turn.rubric.required_checks.map(async (checkId) => ({
      check_id: checkId,
      status: "FAIL" as const,
      evidence_hash: await sha256ContentHash({
        check_id: checkId,
        failure_code: failureCode,
        public_event_hash: publicEventHash,
      }),
    })),
  );
}

export async function evaluateFalcon24FourLayerBusiness(input: {
  readonly manifest: Falcon24FourLayerGateManifest;
  readonly turn: PostgresFalcon24FourLayerGateTurn;
  readonly run: Falcon24FourLayerBusinessRunProjection;
  readonly public_events: readonly unknown[];
  readonly accepted_input_artifact_refs?: readonly ArtifactReference[];
  readonly rubric_evidence?: unknown | null;
  readonly now?: () => Date;
}): Promise<Falcon24FourLayerBusinessReceipt> {
  const frozenTurn = manifestTurn(input.manifest, input.turn);
  if (
    input.turn.attempt_id !== input.manifest.attempt_id ||
    input.turn.run_id !== input.run.run_id ||
    input.turn.conversation_id === null ||
    input.turn.conversation_resource_version === null
  ) {
    throw new Error("FALCON24_FOUR_LAYER_BUSINESS_AUTHORITY_MISMATCH");
  }
  const observation = await projectFalcon24FourLayerBusinessRun({
    run: input.run,
    public_events: input.public_events,
  });
  const acceptedInputArtifactRefs = input.accepted_input_artifact_refs ?? [];
  const acceptedArtifactRefs = mergeArtifactReferences(
    input.run.run_id,
    observation.accepted_artifact_refs,
    acceptedInputArtifactRefs,
  );
  const acceptedArtifactRefsHash = await sha256ContentHash(acceptedArtifactRefs);
  const acceptedInputArtifactRefsHash = await sha256ContentHash(
    mergeArtifactReferences(input.run.run_id, acceptedInputArtifactRefs),
  );
  const runPassed = observation.terminal_status === "COMPLETED";
  const runFailureCode =
    observation.terminal_status === "FAILED" ? "FALCON24_RUN_FAILED" : "FALCON24_RUN_CANCELLED";
  const evidence = runPassed
    ? await verifyFalcon24FourLayerRubricEvidence(input.rubric_evidence)
    : null;
  if (evidence) {
    if (
      evidence.accepted_artifact_refs_hash !== acceptedArtifactRefsHash ||
      evidence.accepted_input_artifact_refs_hash !== acceptedInputArtifactRefsHash
    ) {
      throw new Error("FALCON24_FOUR_LAYER_RUBRIC_EVIDENCE_IDENTITY_MISMATCH");
    }
    assertEvidenceIdentity({
      manifest: input.manifest,
      turn: input.turn,
      observation,
      accepted_artifact_refs: acceptedArtifactRefs,
      accepted_input_artifact_refs: acceptedInputArtifactRefs,
      evidence,
    });
  }
  const rubricResults = evidence
    ? evidence.observations
    : await failedRubricResults(frozenTurn, observation.public_event_hash, runFailureCode);
  const evaluation = !runPassed
    ? { status: "FAIL" as const, failure_code: runFailureCode }
    : observation.answer_text.length === 0
      ? { status: "FAIL" as const, failure_code: "FALCON24_ANSWER_MISSING" as const }
      : evaluateFalcon24FourLayerTurn({
          turn: frozenTurn,
          actual_profile_ids: observation.actual_profile_ids,
          observations: rubricResults,
          answer_text: observation.answer_text,
          table_present: evidence?.table_present ?? false,
          chart_present: evidence?.chart_present ?? false,
          accepted_input_present: evidence?.accepted_input_present ?? false,
          current_run_evidence_present: evidence?.current_run_evidence_present ?? false,
        });
  return buildFalcon24FourLayerBusinessReceipt({
    schema_version: "falcon24-four-layer-business-receipt@1.0.0",
    gate_id: input.manifest.gate_id,
    attempt_id: input.manifest.attempt_id,
    manifest_hash: input.manifest.manifest_hash,
    turn_ordinal: frozenTurn.ordinal,
    turn_id: frozenTurn.turn_id,
    layer: frozenTurn.layer,
    scenario_id: frozenTurn.scenario_id,
    scenario_turn_index: frozenTurn.scenario_turn_index,
    conversation_id: input.turn.conversation_id,
    conversation_resource_version: input.turn.conversation_resource_version,
    run_id: input.run.run_id,
    question_hash: frozenTurn.question_hash,
    worker_build_hash: input.manifest.worker_build_hash,
    worker_generation_hash: input.manifest.worker_generation_hash,
    semantic_release_hash: input.manifest.semantic_release_hash,
    answer_hash: observation.answer_hash,
    public_event_hash: observation.public_event_hash,
    actual_profile_ids: observation.actual_profile_ids,
    accepted_artifact_refs: acceptedArtifactRefs,
    rubric_results: rubricResults,
    status: evaluation.status,
    failure_code: evaluation.failure_code,
    evaluated_at: (input.now?.() ?? new Date()).toISOString(),
  });
}
