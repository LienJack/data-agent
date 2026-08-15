import { describe, expect, it } from "vitest";
import {
  SEMANTIC_GRAPH_READ_VERSION,
  semanticGraphFullQuerySchema,
  semanticGraphNeighborhoodQuerySchema,
  semanticGraphNodeListQuerySchema,
} from "../src/index.js";

describe("Semantic Graph read contracts", () => {
  it("applies bounded defaults for list, local graph and full graph", () => {
    expect(semanticGraphNodeListQuerySchema.parse({})).toMatchObject({ cursor: 0, limit: 50 });
    expect(
      semanticGraphNeighborhoodQuerySchema.parse({ center_node_id: "subject-orders" }),
    ).toMatchObject({ hops: 1, node_limit: 250, edge_limit: 500 });
    expect(semanticGraphFullQuerySchema.parse({})).toMatchObject({ glyph_limit: 500 });
    expect(SEMANTIC_GRAPH_READ_VERSION).toBe("semantic-graph-read@1");
  });

  it("rejects budgets beyond the product safety limits", () => {
    expect(() =>
      semanticGraphNeighborhoodQuerySchema.parse({
        center_node_id: "subject-orders",
        node_limit: 251,
      }),
    ).toThrow();
    expect(() => semanticGraphFullQuerySchema.parse({ glyph_limit: 501 })).toThrow();
  });
});
