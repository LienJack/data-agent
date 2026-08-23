import type {
  SemanticGraphExpansion,
  SemanticInferenceReceipt,
  SemanticInferenceStep,
} from "@data-agent/contracts/context";
import { sha256ContentHash } from "@data-agent/contracts/common";

export interface StratifiedSemanticRule {
  readonly rule_id: string;
  readonly stratum: number;
  readonly relationship_pattern: RegExp;
  readonly mandatory: boolean;
  readonly negated_rule_ids: readonly string[];
}

export const DEFAULT_SEMANTIC_RULES: readonly StratifiedSemanticRule[] = Object.freeze([
  {
    rule_id: "formula-lineage-closure@1",
    stratum: 0,
    relationship_pattern: /(FORMULA|DEPEND|LINEAGE)/iu,
    mandatory: true,
    negated_rule_ids: [],
  },
  {
    rule_id: "join-binding-time-closure@1",
    stratum: 1,
    relationship_pattern: /(JOIN|BIND|MAP|TIME)/iu,
    mandatory: true,
    negated_rule_ids: [],
  },
  {
    rule_id: "policy-quality-closure@1",
    stratum: 2,
    relationship_pattern: /(POLICY|QUALITY|GOVERN)/iu,
    mandatory: true,
    negated_rule_ids: [],
  },
]);

export function verifyStratifiedSemanticRules(
  rules: readonly StratifiedSemanticRule[],
): readonly StratifiedSemanticRule[] {
  const byId = new Map(rules.map((rule) => [rule.rule_id, rule]));
  if (byId.size !== rules.length) throw new TypeError("SEMANTIC_RULE_ID_DUPLICATE");
  for (const rule of rules) {
    if (!Number.isInteger(rule.stratum) || rule.stratum < 0) {
      throw new TypeError("SEMANTIC_RULE_STRATUM_INVALID");
    }
    for (const negatedRuleId of rule.negated_rule_ids) {
      const dependency = byId.get(negatedRuleId);
      if (!dependency || dependency.stratum >= rule.stratum) {
        throw new TypeError("SEMANTIC_RULE_NEGATION_NOT_STRATIFIED");
      }
    }
  }
  return [...rules].sort(
    (left, right) => left.stratum - right.stratum || left.rule_id.localeCompare(right.rule_id),
  );
}

export function relationshipRequiresClosure(
  relationshipKind: string,
  rules: readonly StratifiedSemanticRule[] = DEFAULT_SEMANTIC_RULES,
): boolean {
  return verifyStratifiedSemanticRules(rules).some(
    (rule) => rule.mandatory && rule.relationship_pattern.test(relationshipKind),
  );
}

export async function compileSemanticInference(input: Readonly<{
  expansions: readonly SemanticGraphExpansion[];
  seed_object_ids: readonly string[];
  object_hashes: ReadonlyMap<string, string>;
  release_hash: string;
  authority_snapshot_hash: string;
  rules?: readonly StratifiedSemanticRule[];
}>) {
  const rules = verifyStratifiedSemanticRules(input.rules ?? DEFAULT_SEMANTIC_RULES);
  const mandatoryObjects = new Set(input.seed_object_ids);
  const mandatoryRelationships = new Set<string>();
  const steps: SemanticInferenceStep[] = [];
  for (const expansion of [...input.expansions].sort(
    (left, right) => left.hop - right.hop || left.relationship_id.localeCompare(right.relationship_id),
  )) {
    const rule = rules.find(({ relationship_pattern }) =>
      relationship_pattern.test(expansion.relationship_kind),
    );
    if (!rule?.mandatory) continue;
    const premiseId =
      expansion.direction === "OUTBOUND"
        ? expansion.source_object_id
        : expansion.target_object_id;
    const conclusionId =
      expansion.direction === "OUTBOUND"
        ? expansion.target_object_id
        : expansion.source_object_id;
    mandatoryObjects.add(premiseId);
    mandatoryObjects.add(conclusionId);
    mandatoryRelationships.add(expansion.relationship_id);
    const premiseHash = input.object_hashes.get(premiseId) ?? expansion.relationship_hash;
    steps.push({
      inference_id: `closure:${expansion.relationship_id}`,
      rule_id: rule.rule_id,
      premise_object_ids: [premiseId],
      conclusion_object_ids: [conclusionId],
      relationship_path_ids: [expansion.relationship_id],
      premise_hashes: [premiseHash],
      release_hash: input.release_hash,
      valid_time_hash: await sha256ContentHash({
        authority_snapshot_hash: input.authority_snapshot_hash,
        relationship_hash: expansion.relationship_hash,
      }),
      mandatory: true,
      explanation: `${rule.rule_id} derives ${conclusionId} from ${premiseId} through ${expansion.relationship_kind}.`,
    });
  }
  return Object.freeze({
    ruleset_id: "semantic-stratified-forward-rules@1",
    ruleset_hash: await sha256ContentHash(
      rules.map((rule) => ({
        rule_id: rule.rule_id,
        stratum: rule.stratum,
        relationship_pattern: rule.relationship_pattern.source,
        flags: rule.relationship_pattern.flags,
        mandatory: rule.mandatory,
        negated_rule_ids: rule.negated_rule_ids,
      })),
    ),
    steps: Object.freeze(steps),
    mandatory_object_ids: Object.freeze([...mandatoryObjects].sort()),
    mandatory_relationship_ids: Object.freeze([...mandatoryRelationships].sort()),
  });
}

export function invalidateSemanticInference(
  receipt: SemanticInferenceReceipt,
  invalid_premise_object_ids: readonly string[],
) {
  const invalidObjects = new Set(invalid_premise_object_ids);
  const invalidInferenceIds = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of receipt.steps) {
      if (
        invalidInferenceIds.has(step.inference_id) ||
        !step.premise_object_ids.some((objectId) => invalidObjects.has(objectId))
      ) {
        continue;
      }
      invalidInferenceIds.add(step.inference_id);
      for (const conclusion of step.conclusion_object_ids) invalidObjects.add(conclusion);
      changed = true;
    }
  }
  return Object.freeze({
    invalid_inference_ids: Object.freeze([...invalidInferenceIds].sort()),
    invalid_object_ids: Object.freeze([...invalidObjects].sort()),
  });
}
