import {
  buildSemanticChangeSet,
  type SemanticAssertionCandidate,
  type SemanticAssertionConflict,
  type SemanticChangeSet,
  verifySemanticChangeSet,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson } from "@data-agent/contracts/common";

export interface CompileSemanticChangeSetInput {
  readonly change_set_id: string;
  readonly scope: SemanticAssertionCandidate["scope"];
  readonly base_release: SemanticChangeSet["base_release"];
  readonly revision: number;
  readonly assertions: readonly SemanticAssertionCandidate[];
}

function assertionOrder(assertion: SemanticAssertionCandidate): string {
  return `${assertion.identity_hash}\u0000${assertion.assertion_hash}`;
}

function hasPremiseCycle(assertions: readonly SemanticAssertionCandidate[]): boolean {
  const byId = new Map(assertions.map((assertion) => [assertion.assertion_id, assertion]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (assertionId: string): boolean => {
    if (visiting.has(assertionId)) return true;
    if (visited.has(assertionId)) return false;
    const assertion = byId.get(assertionId);
    if (!assertion) return false;
    visiting.add(assertionId);
    for (const premiseId of assertion.premise_assertion_ids) {
      if (visit(premiseId)) return true;
    }
    visiting.delete(assertionId);
    visited.add(assertionId);
    return false;
  };

  return assertions.some((assertion) => visit(assertion.assertion_id));
}

function compileConflicts(
  assertions: readonly SemanticAssertionCandidate[],
): readonly SemanticAssertionConflict[] {
  const byIdentity = new Map<string, SemanticAssertionCandidate[]>();
  for (const assertion of assertions) {
    const group = byIdentity.get(assertion.identity_hash) ?? [];
    group.push(assertion);
    byIdentity.set(assertion.identity_hash, group);
  }
  return [...byIdentity.entries()]
    .flatMap(([identityHash, group]) => {
      const payloads = new Set(group.map((assertion) => canonicalizeJson(assertion.assertion_payload)));
      if (payloads.size < 2) return [];
      return [
        {
          identity_hash: identityHash,
          assertion_ids: [...new Set(group.map(({ assertion_id }) => assertion_id))].sort(),
          assertion_hashes: [...new Set(group.map(({ assertion_hash }) => assertion_hash))].sort(),
          reason_code: "SEMANTIC_ASSERTION_CONFLICT" as const,
        },
      ];
    })
    .sort((left, right) => left.identity_hash.localeCompare(right.identity_hash));
}

export async function compileSemanticChangeSet(
  input: CompileSemanticChangeSetInput,
): Promise<SemanticChangeSet> {
  if (input.assertions.length === 0) throw new TypeError("SEMANTIC_ASSERTIONS_EMPTY");
  const assertions = [...input.assertions].sort((left, right) =>
    assertionOrder(left).localeCompare(assertionOrder(right)),
  );
  const assertionIds = new Set<string>();
  const reasonCodes = new Set<string>();
  for (const assertion of assertions) {
    if (canonicalizeJson(assertion.scope) !== canonicalizeJson(input.scope)) {
      reasonCodes.add("SEMANTIC_ASSERTION_SCOPE_MISMATCH");
    }
    if (assertionIds.has(assertion.assertion_id)) {
      reasonCodes.add("SEMANTIC_ASSERTION_ID_DUPLICATE");
    }
    assertionIds.add(assertion.assertion_id);
  }
  const evidenceClosed = assertions.every((assertion) =>
    assertion.premise_assertion_ids.every((premiseId) => assertionIds.has(premiseId)),
  );
  if (!evidenceClosed) reasonCodes.add("SEMANTIC_ASSERTION_PREMISE_MISSING");

  const formulaCycleFree = !hasPremiseCycle(assertions);
  if (!formulaCycleFree) reasonCodes.add("SEMANTIC_ASSERTION_DEPENDENCY_CYCLE");

  const conflicts = compileConflicts(assertions);
  if (conflicts.length > 0) reasonCodes.add("SEMANTIC_ASSERTION_CONFLICT");
  const identityConflictFree = conflicts.length === 0;
  const outcome = reasonCodes.size === 0 ? "PASS" : "FAIL";
  return buildSemanticChangeSet({
    schema_version: "semantic-change-set@1.0.0",
    change_set_id: input.change_set_id,
    scope: input.scope,
    base_release: input.base_release,
    revision: input.revision,
    assertions,
    conflicts,
    validation: {
      outcome,
      reason_codes: [...reasonCodes].sort(),
      formula_cycle_free: formulaCycleFree,
      evidence_closed: evidenceClosed,
      identity_conflict_free: identityConflictFree,
    },
    lifecycle_state: outcome === "PASS" ? "VALIDATED" : "BLOCKED",
  });
}

export async function freezeSemanticChangeSetForReview(input: unknown): Promise<SemanticChangeSet> {
  const changeSet = await verifySemanticChangeSet(input);
  if (changeSet.lifecycle_state !== "VALIDATED" || changeSet.validation.outcome !== "PASS") {
    throw new TypeError("SEMANTIC_CHANGE_SET_NOT_REVIEWABLE");
  }
  const { change_set_hash: _changeSetHash, ...material } = changeSet;
  return buildSemanticChangeSet({ ...material, lifecycle_state: "REVIEW_FROZEN" });
}
