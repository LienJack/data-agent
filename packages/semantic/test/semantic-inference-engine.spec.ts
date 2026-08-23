import { buildSemanticInferenceReceipt } from "@data-agent/contracts/context";
import { describe, expect, it } from "vitest";
import {
  compileSemanticInference,
  invalidateSemanticInference,
  verifyStratifiedSemanticRules,
} from "../src/context/semantic-inference-engine.js";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

describe("bounded semantic inference", () => {
  it("derives typed mandatory closure with premise and release provenance", async () => {
    const inference = await compileSemanticInference({
      expansions: [{
        relationship_id: "aov-formula-revenue",
        relationship_hash: hash("1"),
        relationship_kind: "FORMULA_DEPENDENCY",
        source_object_id: "average_order_value",
        target_object_id: "order_revenue",
        direction: "OUTBOUND",
        hop: 1,
        mandatory: true,
      }],
      seed_object_ids: ["average_order_value"],
      object_hashes: new Map([["average_order_value", hash("2")]]),
      release_hash: hash("3"),
      authority_snapshot_hash: hash("4"),
    });
    expect(inference.mandatory_object_ids).toEqual(["average_order_value", "order_revenue"]);
    expect(inference.steps[0]).toMatchObject({
      rule_id: "formula-lineage-closure@1",
      premise_hashes: [hash("2")],
      release_hash: hash("3"),
    });
  });

  it("rejects unstratified negation and propagates premise invalidation", async () => {
    expect(() => verifyStratifiedSemanticRules([
      {
        rule_id: "bad@1",
        stratum: 0,
        relationship_pattern: /FORMULA/u,
        mandatory: true,
        negated_rule_ids: ["bad@1"],
      },
    ])).toThrow("SEMANTIC_RULE_NEGATION_NOT_STRATIFIED");
    const receipt = await buildSemanticInferenceReceipt({
      schema_version: "semantic-inference-receipt@1.0.0",
      retrieval_receipt_hash: hash("1"),
      ruleset_id: "rules@1",
      ruleset_hash: hash("2"),
      steps: [
        {
          inference_id: "step-a",
          rule_id: "formula@1",
          premise_object_ids: ["a"],
          conclusion_object_ids: ["b"],
          relationship_path_ids: ["ab"],
          premise_hashes: [hash("3")],
          release_hash: hash("4"),
          valid_time_hash: hash("5"),
          mandatory: true,
          explanation: "a derives b",
        },
        {
          inference_id: "step-b",
          rule_id: "formula@1",
          premise_object_ids: ["b"],
          conclusion_object_ids: ["c"],
          relationship_path_ids: ["bc"],
          premise_hashes: [hash("6")],
          release_hash: hash("4"),
          valid_time_hash: hash("7"),
          mandatory: true,
          explanation: "b derives c",
        },
      ],
      mandatory_object_ids: ["a", "b", "c"],
      mandatory_relationship_ids: ["ab", "bc"],
      closure_complete: true,
      reason_codes: [],
    });
    expect(invalidateSemanticInference(receipt, ["a"])).toEqual({
      invalid_inference_ids: ["step-a", "step-b"],
      invalid_object_ids: ["a", "b", "c"],
    });
  });
});
