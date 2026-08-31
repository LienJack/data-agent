import { describe, expect, it } from "vitest";
import {
  createAnalysisProgramProtocolDiagnostic,
  publicAnalysisProgramProtocolDiagnostic,
} from "../../src/providers/analysis-program-protocol-diagnostic.js";

const candidate = {
  schema_version: "analysis-program-candidate@2.1.0",
  objective_hash: `sha256:${"a".repeat(64)}`,
  nodes: [
    {
      node_id: "monthly",
      method_registry_entry_ids: ["published-monthly-multi-measure-comparison@1"],
      metric_ids: ["metric.order_revenue"],
      dimension_ids: ["dimension.order_month"],
      time_window: {
        start: "2023-11-01T00:00:00.000Z",
        end: "2024-11-01T00:00:00.000Z",
        timezone: "Asia/Shanghai",
        semantics: "HALF_OPEN",
      },
      comparison_window: null,
      parameters: {},
      operator_obligations: [],
      dependency_node_ids: [],
      activation_rule: { kind: "ALWAYS" },
      criticality: "CRITICAL",
    },
  ],
};

describe("analysis planner failure diagnostics", () => {
  it.each([
    ["", "EMPTY"],
    ["secret partial JSON {", "INVALID_JSON"],
    ["null", "NON_OBJECT"],
    [JSON.stringify(candidate), "SCHEMA_VALID"],
  ] as const)("classifies a captured stream without exposing values", (text, state) => {
    const capture = createAnalysisProgramProtocolDiagnostic();
    capture.append(text);
    expect(capture.finish()).toMatchObject({ state, issues: [] });
    expect(JSON.stringify(capture.finish())).not.toContain("secret");
  });
  it("reports the exact structural field failure without candidate values or unknown keys", () => {
    const broken = structuredClone(candidate);
    const node = broken.nodes[0];
    if (!node) throw new Error("TEST_NODE_REQUIRED");
    Object.assign(node, { activation_rule: "secret" });
    const capture = createAnalysisProgramProtocolDiagnostic();
    const text = JSON.stringify(broken);
    capture.append(text.slice(0, 40));
    capture.append(text.slice(40));
    const result = capture.finish();
    expect(result.state).toBe("SCHEMA_INVALID");
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: ["nodes", 0, "activation_rule"] }),
    );
    expect(JSON.stringify(result)).not.toMatch(/secret|metric.order_revenue|2023/);
  });
  it("caps retained bytes and does not parse a truncated prefix", () => {
    const capture = createAnalysisProgramProtocolDiagnostic();
    capture.append("秘".repeat(30_000));
    capture.append(JSON.stringify(candidate));
    expect(capture.finish()).toMatchObject({ state: "CAPTURE_LIMIT", issues: [] });
  });
  it("keeps schema refinement failures and bounds diagnostic issue count", () => {
    const broken = structuredClone(candidate);
    const node = broken.nodes[0];
    if (!node) throw new Error("TEST_NODE_REQUIRED");
    node.metric_ids.push("metric.order_revenue");
    const capture = createAnalysisProgramProtocolDiagnostic();
    capture.append(JSON.stringify(broken));
    expect(capture.finish()).toMatchObject({
      state: "SCHEMA_INVALID",
      issues: [{ code: "custom", path: ["nodes", 0, "metric_ids"] }],
    });
  });
  it("rejects forged detail messages, unknown fields, paths, and issue values at display boundary", () => {
    const capture = createAnalysisProgramProtocolDiagnostic();
    capture.append(JSON.stringify(candidate));
    const diagnostic = capture.finish();
    expect(publicAnalysisProgramProtocolDiagnostic({ analysis_program_protocol: diagnostic })).toBe(
      JSON.stringify(diagnostic),
    );
    for (const forged of [
      { ...diagnostic, raw_response: "secret" },
      { ...diagnostic, state: "secret" },
      { ...diagnostic, issues: [{ code: "custom", path: ["secret"] }] },
      { ...diagnostic, issues: [{ code: "secret", path: ["nodes"] }] },
      { ...diagnostic, issues: [{ code: "custom", path: ["nodes"], value: "secret" }] },
    ])
      expect(
        publicAnalysisProgramProtocolDiagnostic({ analysis_program_protocol: forged }),
      ).toBeNull();
    expect(publicAnalysisProgramProtocolDiagnostic(undefined)).toBeNull();
  });

  it("caps multiple structural errors without including unknown field names", () => {
    const capture = createAnalysisProgramProtocolDiagnostic();
    capture.append(
      JSON.stringify({ ...candidate, nodes: [{ "private-secret": "private-secret" }] }),
    );
    expect(capture.finish().issues).toHaveLength(8);
    expect(JSON.stringify(capture.finish())).not.toContain("private-secret");
  });
});
