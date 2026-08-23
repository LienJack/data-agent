import { buildSemanticAssertionCandidate } from "@data-agent/contracts/artifacts";
import { describe, expect, it } from "vitest";
import {
  compileSemanticChangeSet,
  freezeSemanticChangeSetForReview,
} from "../src/production/lifecycle.js";

const id = (suffix: number) => `10000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = {
  app_id: id(1),
  tenant_id: id(2),
  environment: "test" as const,
  semantic_domain: "falcon24",
};

async function assertion(input: {
  id: number;
  key: string;
  payload: Readonly<Record<string, unknown>>;
  premises?: readonly string[];
}) {
  const inferred = (input.premises?.length ?? 0) > 0;
  return buildSemanticAssertionCandidate({
    schema_version: "semantic-assertion-candidate@1.0.0",
    assertion_id: id(input.id),
    scope,
    target_kind: "FORMULA",
    canonical_key: input.key,
    applicability_scope: { datasource: "falcon_db_24" },
    assertion_payload: input.payload,
    source_kind: inferred ? "AGENT_INFERENCE" : "CURRENT_SEMANTIC_FACT",
    evidence: [
      {
        evidence_id: `evidence:${input.id}`,
        source_kind: inferred ? "AGENT_INFERENCE" : "CURRENT_SEMANTIC_FACT",
        source_ref: {
          resource_id: inferred ? "semantic-rule-registry" : "falcon24-release",
          resource_revision: 1,
          resource_hash: hash(inferred ? "d" : "e"),
        },
        locator: {
          locator_kind: inferred ? "INFERENCE_RULE" : "SEMANTIC_OBJECT",
          locator_value: inferred ? "formula-dependency@1" : input.key,
        },
        observation: "Governed semantic assertion.",
      },
    ],
    premise_assertion_ids: [...(input.premises ?? [])].sort(),
    inference_rule_id: inferred ? "formula-dependency@1" : null,
    confidence: inferred ? 0.8 : 1,
  });
}

describe("semantic production lifecycle", () => {
  it("compiles and freezes an evidence-closed change set", async () => {
    const base = await assertion({ id: 10, key: "order_revenue", payload: { op: "sum" } });
    const derived = await assertion({
      id: 11,
      key: "average_order_value",
      payload: { op: "divide" },
      premises: [base.assertion_id],
    });
    const changeSet = await compileSemanticChangeSet({
      change_set_id: id(20),
      scope,
      base_release: { release_id: id(21), generation: 4, release_hash: hash("f") },
      revision: 1,
      assertions: [derived, base],
    });
    expect(changeSet.validation).toMatchObject({ outcome: "PASS", evidence_closed: true });
    const canonicalKeys = changeSet.assertions.map(
      ({ identity_hash, assertion_hash }) => `${identity_hash}\u0000${assertion_hash}`,
    );
    expect(canonicalKeys).toEqual([...canonicalKeys].sort());
    await expect(freezeSemanticChangeSetForReview(changeSet)).resolves.toMatchObject({
      lifecycle_state: "REVIEW_FROZEN",
    });
  });

  it("blocks conflicting assertions and missing premise closure", async () => {
    const left = await assertion({ id: 30, key: "damage_rate", payload: { denominator: "received" } });
    const right = await assertion({
      id: 31,
      key: "damage_rate",
      payload: { denominator: "received_plus_damaged" },
    });
    const missing = await assertion({
      id: 32,
      key: "damage_watchlist",
      payload: { op: "trend" },
      premises: [id(999)],
    });
    const changeSet = await compileSemanticChangeSet({
      change_set_id: id(40),
      scope,
      base_release: { release_id: id(41), generation: 4, release_hash: hash("1") },
      revision: 2,
      assertions: [left, right, missing],
    });
    expect(changeSet.lifecycle_state).toBe("BLOCKED");
    expect(changeSet.validation.reason_codes).toEqual([
      "SEMANTIC_ASSERTION_CONFLICT",
      "SEMANTIC_ASSERTION_PREMISE_MISSING",
    ]);
    await expect(freezeSemanticChangeSetForReview(changeSet)).rejects.toThrow(
      "SEMANTIC_CHANGE_SET_NOT_REVIEWABLE",
    );
  });
});
