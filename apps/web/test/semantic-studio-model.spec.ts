import type { SemanticAuthoringPublicEvent, SemanticGraphReadNode } from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  filterSemanticNodes,
  localGraphLayout,
  mergeAuthoringEvents,
} from "@/lib/semantic-studio-model";

const metric = {
  node: {
    node_id: "metric-product-count",
    node_version: 1,
    node_type: "METRIC",
    name: "成交商品数",
    description: "按商品去重",
    aliases: ["商品数"],
    owner_ref: "owner-commerce",
    lifecycle: "ACTIVE",
    evidence_refs: [],
    tags: ["交易"],
    unit: null,
    additivity: "non_additive",
    null_policy: "ignore_nulls",
    fanout_policy: "deduplicate_required",
  },
  status: "MODIFIED",
  relation_count: { incoming: 1, outgoing: 1, total: 2, by_family: { ANALYTICAL: 1, FORMULA: 1 } },
} as unknown as SemanticGraphReadNode;

describe("Semantic Studio view model", () => {
  it("filters by intrinsic node data and candidate status", () => {
    expect(
      filterSemanticNodes([metric], { search: "商品", nodeType: "METRIC", status: "MODIFIED" }),
    ).toEqual([metric]);
    expect(
      filterSemanticNodes([metric], { search: "订单", nodeType: "ALL", status: "ALL" }),
    ).toEqual([]);
  });

  it("pins the selected node at the center of local graph layout", () => {
    expect(localGraphLayout([metric], metric.node.node_id).get(metric.node.node_id)).toEqual({
      x: 500,
      y: 310,
    });
  });

  it("deduplicates replayed authoring events by sequence", () => {
    const first = {
      schema_version: "semantic-authoring-public-event@1.0.0",
      event_id: "10000000-0000-4000-8000-000000000001",
      run_id: "10000000-0000-4000-8000-000000000002",
      sequence: 1,
      occurred_at: "2026-08-15T00:00:00.000Z",
      type: "stage",
      payload: { phase: "READING", status: "RUNNING", summary: "读取图" },
    } as SemanticAuthoringPublicEvent;
    expect(mergeAuthoringEvents([first], [first])).toEqual([first]);
  });
});
