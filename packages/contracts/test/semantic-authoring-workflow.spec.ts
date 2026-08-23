import { describe, expect, it } from "vitest";
import { semanticManualEditSchema } from "../src/artifacts/semantic-authoring-workflow.js";

describe("semantic explicit revision workflow contracts", () => {
  it("accepts a governed edge-type proposal but rejects system-managed physical attributes", () => {
    const proposal = {
      operation: "ADD_EDGE_TYPE",
      edge_type_definition: {
        edge_type: "FULFILLED_BY",
        display_name: "由履约主体完成",
        family: "BUSINESS",
        source_node_types: ["BUSINESS_SUBJECT"],
        target_node_types: ["BUSINESS_SUBJECT"],
        direction: "DIRECTED",
        parallel_policy: "FORBID",
        authoring_policy: "AGENT_AUTHORED",
        attribute_kind: "BUSINESS_RELATION",
      },
    };
    expect(semanticManualEditSchema.parse(proposal)).toEqual(proposal);
    expect(
      semanticManualEditSchema.safeParse({
        ...proposal,
        edge_type_definition: {
          ...proposal.edge_type_definition,
          attribute_kind: "PHYSICAL_FACT",
        },
      }).success,
    ).toBe(false);
  });
});
