import { describe, expect, it } from "vitest";
import {
  buildSemanticAssertionCandidate,
  buildSemanticChangeSet,
  verifySemanticChangeSet,
} from "../src/artifacts/semantic-lifecycle.js";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}`;
const scope = {
  app_id: id(1),
  tenant_id: id(2),
  environment: "test" as const,
  semantic_domain: "falcon24",
};

function assertionInput(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "semantic-assertion-candidate@1.0.0" as const,
    assertion_id: id(10),
    scope,
    target_kind: "METRIC" as const,
    canonical_key: "order_revenue",
    applicability_scope: { datasource: "falcon_db_24" },
    assertion_payload: { expression: "sum(orders.total_amount)", unit: "currency" },
    source_kind: "SELECTED_KNOWLEDGE_EVIDENCE" as const,
    evidence: [
      {
        evidence_id: "falcon24-metric-handbook:order-revenue",
        source_kind: "SELECTED_KNOWLEDGE_EVIDENCE" as const,
        source_ref: {
          resource_id: "falcon24-metric-handbook",
          resource_revision: 1,
          resource_hash: hash("a"),
        },
        locator: { locator_kind: "DOCUMENT_SPAN" as const, locator_value: "section:revenue" },
        observation: "订单收入使用订单头金额。",
      },
    ],
    premise_assertion_ids: [],
    inference_rule_id: null,
    confidence: 0.98,
    ...overrides,
  };
}

describe("semantic lifecycle contracts", () => {
  it("builds stable assertion identity independently of assertion id and provenance", async () => {
    const left = await buildSemanticAssertionCandidate(assertionInput());
    const right = await buildSemanticAssertionCandidate(
      assertionInput({ assertion_id: id(11), confidence: 0.9 }),
    );
    expect(left.identity_hash).toBe(right.identity_hash);
    expect(left.assertion_hash).not.toBe(right.assertion_hash);
  });

  it("requires explicit premises and a registered rule for Agent inference", async () => {
    await expect(
      buildSemanticAssertionCandidate(
        assertionInput({
          source_kind: "AGENT_INFERENCE",
          evidence: [
            {
              evidence_id: "rule:no-premise",
              source_kind: "AGENT_INFERENCE",
              source_ref: {
                resource_id: "semantic-rule-registry",
                resource_revision: 1,
                resource_hash: hash("b"),
              },
              locator: { locator_kind: "INFERENCE_RULE", locator_value: "rule:no-premise" },
              observation: "Inference without premises is not admissible.",
            },
          ],
          confidence: 0.8,
        }),
      ),
    ).rejects.toThrow();
  });

  it("binds a canonical change set hash and rejects tampering", async () => {
    const assertion = await buildSemanticAssertionCandidate(assertionInput());
    const changeSet = await buildSemanticChangeSet({
      schema_version: "semantic-change-set@1.0.0",
      change_set_id: id(20),
      scope,
      base_release: { release_id: id(21), generation: 1, release_hash: hash("c") },
      revision: 1,
      assertions: [assertion],
      conflicts: [],
      validation: {
        outcome: "PASS",
        reason_codes: [],
        formula_cycle_free: true,
        evidence_closed: true,
        identity_conflict_free: true,
      },
      lifecycle_state: "VALIDATED",
    });
    await expect(verifySemanticChangeSet(changeSet)).resolves.toEqual(changeSet);
    await expect(
      verifySemanticChangeSet({ ...changeSet, revision: 2 }),
    ).rejects.toThrow("SEMANTIC_CHANGE_SET_HASH_MISMATCH");
  });
});
