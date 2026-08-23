import {
  canonicalizeJson,
  contentHashSchema,
  deepFreeze,
  immutableIdSchema,
  sha256ContentHash,
} from "@data-agent/contracts";
import { z } from "zod";

const obligationSchema = z.strictObject({
  obligation_id: immutableIdSchema,
  kind: z.enum([
    "GOAL_CONSTRAINT",
    "CLARIFICATION",
    "POLICY_DENIAL",
    "UNSUPPORTED_CLAIM",
    "PENDING_EFFECT",
    "CHILD_COMMITMENT",
    "ACCEPTANCE_CLAUSE",
  ]),
  status: z.enum(["OPEN", "UNKNOWN", "RESOLVED"]),
  subject_hash: contentHashSchema,
});

const obligationLedgerDraftSchema = z.strictObject({
  schema_version: z.literal("open-obligation-ledger@2.0.0"),
  task_id: immutableIdSchema,
  task_revision: z.number().int().positive(),
  obligations: z.array(obligationSchema).max(256),
});

export const openObligationLedgerSchema = obligationLedgerDraftSchema.extend({
  ledger_hash: contentHashSchema,
});
export type OpenObligationLedger = z.infer<typeof openObligationLedgerSchema>;

export async function buildOpenObligationLedger(input: unknown): Promise<OpenObligationLedger> {
  const parsed = obligationLedgerDraftSchema.parse(input);
  const obligations = [...parsed.obligations].sort((left, right) =>
    left.obligation_id.localeCompare(right.obligation_id),
  );
  if (new Set(obligations.map((entry) => entry.obligation_id)).size !== obligations.length) {
    throw new Error("TEAM_OBLIGATION_DUPLICATE");
  }
  const draft = obligationLedgerDraftSchema.parse({ ...parsed, obligations });
  return deepFreeze(
    openObligationLedgerSchema.parse({
      ...draft,
      ledger_hash: await sha256ContentHash(draft),
    }),
  );
}

const epochRefSchema = z.strictObject({
  epoch_id: immutableIdSchema,
  build_signature: contentHashSchema,
});

const transitionPhaseSchema = z.enum([
  "STARTED",
  "SUMMARY_COMMITTED",
  "REPLACEMENT_COMMITTED",
  "PROBE_PASSED",
  "ACTIVATED",
]);

const contextEpochTransitionDraftSchema = z.strictObject({
  schema_version: z.literal("context-epoch-transition@2.0.0"),
  transition_id: immutableIdSchema,
  current_epoch: epochRefSchema,
  proposed_epoch: epochRefSchema,
  current_obligations: openObligationLedgerSchema,
  proposed_obligations: openObligationLedgerSchema,
  phase: transitionPhaseSchema,
  revision: z.number().int().positive(),
});

export const contextEpochTransitionSchema = contextEpochTransitionDraftSchema.extend({
  transition_hash: contentHashSchema,
});
export type ContextEpochTransition = z.infer<typeof contextEpochTransitionSchema>;

async function buildTransition(input: unknown): Promise<ContextEpochTransition> {
  const draft = contextEpochTransitionDraftSchema.parse(input);
  return deepFreeze(
    contextEpochTransitionSchema.parse({
      ...draft,
      transition_hash: await sha256ContentHash(draft),
    }),
  );
}

export async function createContextEpochTransition(input: {
  readonly transition_id: string;
  readonly current_epoch: unknown;
  readonly proposed_epoch: unknown;
  readonly current_obligations: unknown;
  readonly proposed_obligations: unknown;
}): Promise<ContextEpochTransition> {
  const current = openObligationLedgerSchema.parse(input.current_obligations);
  const proposed = openObligationLedgerSchema.parse(input.proposed_obligations);
  if (current.task_id !== proposed.task_id || current.task_revision !== proposed.task_revision) {
    throw new Error("TEAM_OBLIGATION_TASK_MISMATCH");
  }
  return buildTransition({
    schema_version: "context-epoch-transition@2.0.0",
    transition_id: input.transition_id,
    current_epoch: input.current_epoch,
    proposed_epoch: input.proposed_epoch,
    current_obligations: current,
    proposed_obligations: proposed,
    phase: "STARTED",
    revision: 1,
  });
}

const phases = [
  "STARTED",
  "SUMMARY_COMMITTED",
  "REPLACEMENT_COMMITTED",
  "PROBE_PASSED",
  "ACTIVATED",
] as const;

function obligationsEquivalent(left: OpenObligationLedger, right: OpenObligationLedger): boolean {
  return canonicalizeJson(left.obligations) === canonicalizeJson(right.obligations);
}

export async function advanceContextEpochTransition(
  input: unknown,
  nextPhase: z.infer<typeof transitionPhaseSchema>,
): Promise<ContextEpochTransition> {
  const current = contextEpochTransitionSchema.parse(input);
  const currentIndex = phases.indexOf(current.phase);
  const nextIndex = phases.indexOf(nextPhase);
  if (nextIndex !== currentIndex + 1) throw new Error("TEAM_CONTEXT_EPOCH_TRANSITION_INVALID");
  if (
    nextPhase === "ACTIVATED" &&
    !obligationsEquivalent(current.current_obligations, current.proposed_obligations)
  ) {
    throw new Error("TEAM_OBLIGATION_SET_MISMATCH");
  }
  if (
    nextPhase === "ACTIVATED" &&
    current.proposed_obligations.obligations.some(
      (obligation) => obligation.kind === "PENDING_EFFECT" && obligation.status !== "RESOLVED",
    )
  ) {
    throw new Error("TEAM_PENDING_EFFECT_RECONCILIATION_REQUIRED");
  }
  const { transition_hash: _transitionHash, ...draft } = current;
  return buildTransition({
    ...draft,
    phase: nextPhase,
    revision: current.revision + 1,
  });
}

export function recoverContextEpoch(
  activeEpochInput: unknown,
  transitionInput: unknown,
): {
  readonly active_epoch: z.infer<typeof epochRefSchema>;
  readonly transition: ContextEpochTransition;
} {
  const activeEpoch = epochRefSchema.parse(activeEpochInput);
  const transition = contextEpochTransitionSchema.parse(transitionInput);
  if (canonicalizeJson(activeEpoch) !== canonicalizeJson(transition.current_epoch)) {
    throw new Error("TEAM_CONTEXT_EPOCH_LINEAGE_MISMATCH");
  }
  return deepFreeze({
    active_epoch: transition.phase === "ACTIVATED" ? transition.proposed_epoch : activeEpoch,
    transition,
  });
}
