import type { DeterministicAnalysisRunProjection } from "@data-agent/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeterministicAnalysisSections } from "@/components/workbench/deterministic-analysis-sections";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const ref = (artifact_type: string, suffix: number) => ({
  artifact_id: id(suffix),
  artifact_type,
  app_id: id(1),
  tenant_id: id(2),
  environment: "test" as const,
  run_id: id(3),
  revision: 1,
  content_hash: hash(String(suffix % 10)),
});

function projection(
  terminal: "READY" | "PARTIAL" | "HOLD",
  rootLevel: "NONE" | "L4_DISCOVERY" | "L5_CERTIFIED" | "HOLD" = "NONE",
): DeterministicAnalysisRunProjection {
  const succeeded = terminal === "READY";
  const evidenceRef = ref("DerivedAnalysisEvidence", 5);
  const candidateRef = ref("DiscoveryCandidate", 10);
  const estimateRef = ref("CausalEstimate", 11);
  const certificateRef = ref("IdentificationCertificate", 12);
  return {
    schema_version: "deterministic-analysis-run-projection@1.0.0",
    terminal,
    completion_ref: ref("AnalysisCompletionReceipt", 4),
    nodes: [
      {
        node_id: "trend",
        skill_id: "trend-change@1",
        criticality: terminal === "PARTIAL" ? "OPTIONAL" : "CRITICAL",
        status: succeeded ? "SUCCEEDED" : "FAILED",
        evidence_ref: succeeded ? evidenceRef : null,
        reason_codes: succeeded ? [] : ["ANALYSIS_SANDBOX_UNAVAILABLE"],
      },
    ],
    findings: succeeded
      ? [
          {
            finding_id: "fact-1",
            tier: "FACT",
            statement: "订单从 10 增至 12",
            evidence_ref: evidenceRef,
            evidence_level: "L2_OBSERVATION",
            status: "ACCEPTED",
            disclosure_codes: [],
          },
        ]
      : [],
    charts: [],
    methods: succeeded
      ? [
          {
            evidence_ref: evidenceRef,
            skill_id: "trend-change@1",
            algorithm_version: "trend-v1",
            parameter_hash: hash("a"),
            input_closure_hash: hash("b"),
            program_ref: ref("SandboxProgram", 6),
            receipt_ref: ref("SandboxExecutionReceipt", 7),
            runtime_digest: hash("c"),
            dependency_lock_digest: hash("d"),
            sample_size: 2,
            limitation_codes: [],
          },
        ]
      : [],
    root_cause: {
      level: rootLevel,
      candidate_ref: rootLevel === "NONE" ? null : candidateRef,
      estimate_ref: rootLevel === "L5_CERTIFIED" ? estimateRef : null,
      certificate_ref: rootLevel === "L5_CERTIFIED" ? certificateRef : null,
      disclosures:
        rootLevel === "L4_DISCOVERY"
          ? ["STATISTICAL_ASSOCIATION_NOT_CAUSATION"]
          : rootLevel === "L5_CERTIFIED"
            ? ["CAUSAL_ESTIMATE_ASSUMPTION_BOUND"]
            : [],
    },
    limitations: succeeded ? [] : ["ANALYSIS_SANDBOX_UNAVAILABLE"],
  } as DeterministicAnalysisRunProjection;
}

describe("deterministic analysis report", () => {
  it.each(["READY", "PARTIAL", "HOLD"] as const)(
    "renders the server-owned %s terminal without client recomputation",
    (terminal) => {
      const html = renderToStaticMarkup(
        <DeterministicAnalysisSections analysis={projection(terminal)} />,
      );
      expect(html).toContain(terminal);
      expect(html).toContain("自动分析证据链");
      expect(html).not.toMatch(/source_text|stdout|stderr|private_reasoning|raw_rows/u);
    },
  );

  it("clearly separates L4 discovery from L5 certified causal evidence", () => {
    const l4 = renderToStaticMarkup(
      <DeterministicAnalysisSections analysis={projection("READY", "L4_DISCOVERY")} />,
    );
    const l5 = renderToStaticMarkup(
      <DeterministicAnalysisSections analysis={projection("READY", "L5_CERTIFIED")} />,
    );
    expect(l4).toContain("仅为根因候选，不代表因果识别");
    expect(l4).toContain("STATISTICAL_ASSOCIATION_NOT_CAUSATION");
    expect(l5).toContain("已绑定当前 Identification Certificate");
    expect(l5).toContain("CAUSAL_ESTIMATE_ASSUMPTION_BOUND");
  });

  it("renders duplicate replay payloads byte-for-byte identically", () => {
    const input = projection("READY");
    const live = renderToStaticMarkup(<DeterministicAnalysisSections analysis={input} />);
    const replay = renderToStaticMarkup(
      <DeterministicAnalysisSections analysis={structuredClone(input)} />,
    );
    expect(replay).toBe(live);
    expect(live).toContain("Evidence Drawer");
    expect(live).toContain("订单从 10 增至 12");
  });
});
