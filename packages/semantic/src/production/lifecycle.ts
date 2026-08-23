import {
  buildSemanticChangeSet,
  businessEntitySchema,
  businessTermSchema,
  formulaNodeSchema,
  physicalBindingEntrySchema,
  type SemanticAssertionCandidate,
  type SemanticAssertionConflict,
  type SemanticChangeSet,
  type SemanticCompetencyCase,
  type SemanticCompetencyResult,
  semanticDimensionSchema,
  semanticMetricSchema,
  semanticRelationshipSchema,
  timeDomainSchema,
  verifySemanticChangeSet,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson, sha256ContentHash } from "@data-agent/contracts/common";

export interface CompileSemanticChangeSetInput {
  readonly change_set_id: string;
  readonly scope: SemanticAssertionCandidate["scope"];
  readonly base_release: SemanticChangeSet["base_release"];
  readonly revision: number;
  readonly assertions: readonly SemanticAssertionCandidate[];
  readonly competency_cases?: readonly SemanticCompetencyCase[];
}

function assertionShapeValid(assertion: SemanticAssertionCandidate): boolean {
  const payload = assertion.assertion_payload;
  switch (assertion.target_kind) {
    case "BUSINESS_ENTITY_TYPE":
      return businessEntitySchema.safeParse(payload.entity).success;
    case "TERM":
      return businessTermSchema.safeParse(payload.term).success;
    case "METRIC":
      return semanticMetricSchema.safeParse(payload.metric).success;
    case "DIMENSION":
      return semanticDimensionSchema.safeParse(payload.dimension).success;
    case "RELATIONSHIP":
    case "ANALYSIS_JOIN":
      return semanticRelationshipSchema.safeParse(payload.relationship).success;
    case "PHYSICAL_BINDING":
      return physicalBindingEntrySchema.safeParse(payload.binding).success;
    case "FORMULA":
      return formulaNodeSchema.safeParse(payload.formula).success;
    case "TIME_SEMANTICS":
      return timeDomainSchema.safeParse(payload.time_domain).success;
    case "QUALITY_CONSTRAINT":
      return (
        typeof payload.constraint_id === "string" &&
        typeof payload.expression === "string" &&
        payload.expression.trim().length > 0 &&
        ["ERROR", "WARN"].includes(String(payload.severity))
      );
  }
}

function grainJoinTimeValid(assertion: SemanticAssertionCandidate): boolean {
  if (
    !["METRIC", "DIMENSION", "RELATIONSHIP", "ANALYSIS_JOIN", "TIME_SEMANTICS"].includes(
      assertion.target_kind,
    )
  ) {
    return true;
  }
  return assertionShapeValid(assertion);
}

function policyQualityValid(assertion: SemanticAssertionCandidate): boolean {
  if (assertion.target_kind !== "QUALITY_CONSTRAINT") return true;
  const sensitivity = assertion.assertion_payload.sensitivity;
  return (
    assertionShapeValid(assertion) &&
    (sensitivity === undefined ||
      ["PUBLIC", "INTERNAL", "RESTRICTED", "SECRET"].includes(String(sensitivity)))
  );
}

async function evaluateCompetencyCases(
  assertions: readonly SemanticAssertionCandidate[],
  cases: readonly SemanticCompetencyCase[],
): Promise<readonly SemanticCompetencyResult[]> {
  const byKey = new Map(assertions.map((assertion) => [assertion.canonical_key, assertion]));
  return Promise.all(
    [...cases]
      .sort((left, right) => left.case_id.localeCompare(right.case_id))
      .map(async (testCase) => {
        const resolved = testCase.required_assertion_keys.flatMap((key) => {
          const assertion = byKey.get(key);
          return assertion ? [assertion] : [];
        });
        const reasonCodes = new Set<string>();
        if (resolved.length !== testCase.required_assertion_keys.length) {
          reasonCodes.add("SEMANTIC_COMPETENCY_ASSERTION_MISSING");
        }
        for (const kind of testCase.required_target_kinds) {
          if (!resolved.some(({ target_kind: targetKind }) => targetKind === kind)) {
            reasonCodes.add("SEMANTIC_COMPETENCY_TARGET_KIND_MISSING");
          }
        }
        const resolvedPaths = testCase.required_relationship_paths.flatMap((path) => {
          const pathAssertions = path.map((key) => byKey.get(key));
          return pathAssertions.every(Boolean)
            ? [pathAssertions.flatMap((assertion) => (assertion ? [assertion.assertion_id] : []))]
            : [];
        });
        if (resolvedPaths.length !== testCase.required_relationship_paths.length) {
          reasonCodes.add("SEMANTIC_COMPETENCY_RELATIONSHIP_PATH_MISSING");
        }
        const caseHash = await sha256ContentHash(testCase);
        const material = {
          case_id: testCase.case_id,
          case_hash: caseHash,
          verdict: reasonCodes.size === 0 ? ("PASS" as const) : ("FAIL" as const),
          resolved_assertion_ids: [
            ...new Set(resolved.map(({ assertion_id }) => assertion_id)),
          ].sort(),
          resolved_relationship_paths: resolvedPaths,
          reason_codes: [...reasonCodes].sort(),
        };
        return {
          ...material,
          result_hash: await sha256ContentHash(material),
        };
      }),
  );
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
      const payloads = new Set(
        group.map((assertion) => canonicalizeJson(assertion.assertion_payload)),
      );
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
  const shapesValid = assertions.every(assertionShapeValid);
  if (!shapesValid) reasonCodes.add("SEMANTIC_ASSERTION_SHAPE_INVALID");
  const formulasValid = assertions
    .filter(({ target_kind: targetKind }) => targetKind === "FORMULA")
    .every(assertionShapeValid);
  if (!formulasValid) reasonCodes.add("SEMANTIC_FORMULA_AST_INVALID");
  const grainJoinTimeIsValid = assertions.every(grainJoinTimeValid);
  if (!grainJoinTimeIsValid) reasonCodes.add("SEMANTIC_GRAIN_JOIN_TIME_INVALID");
  const policyQualityIsValid = assertions.every(policyQualityValid);
  if (!policyQualityIsValid) reasonCodes.add("SEMANTIC_POLICY_QUALITY_INVALID");
  const competencyResults = await evaluateCompetencyCases(assertions, input.competency_cases ?? []);
  const competencyCasesPassed = competencyResults.every(({ verdict }) => verdict === "PASS");
  if (!competencyCasesPassed) reasonCodes.add("SEMANTIC_COMPETENCY_CASE_FAILED");
  const outcome = reasonCodes.size === 0 ? "PASS" : "FAIL";
  return buildSemanticChangeSet({
    schema_version: "semantic-change-set@1.0.0",
    change_set_id: input.change_set_id,
    scope: input.scope,
    base_release: input.base_release,
    revision: input.revision,
    assertions,
    conflicts,
    competency_results: competencyResults,
    validation: {
      outcome,
      reason_codes: [...reasonCodes].sort(),
      formula_cycle_free: formulaCycleFree,
      evidence_closed: evidenceClosed,
      identity_conflict_free: identityConflictFree,
      shapes_valid: shapesValid,
      formulas_valid: formulasValid,
      grain_join_time_valid: grainJoinTimeIsValid,
      policy_quality_valid: policyQualityIsValid,
      competency_cases_passed: competencyCasesPassed,
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
