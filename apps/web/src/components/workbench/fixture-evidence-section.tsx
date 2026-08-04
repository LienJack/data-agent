"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * U8 M1-F9 Fixture Evidence Demo 组件。
 *
 * 展示 fixture evidence、verdict 与固定三状态。
 * 符合 implement.md §8.7 要求：
 * - Core L2=HOLD
 * - Attribution F9=NOT_REGISTERED
 * - Fixture Evidence=HOLD
 * - 不渲染 Published F9 或产品 ContributionItemSet
 */

// ─── 固定三状态 ─────────────────────────────────────────────────────────────

const FIXED_STATES = {
  coreL2: { label: "Core L2", value: "HOLD" as const, color: "text-[var(--color-warning)]" },
  attributionF9: { label: "归因 F9", value: "NOT_REGISTERED" as const, color: "text-[var(--color-text-tertiary)]" },
  fixtureEvidence: { label: "Fixture Evidence", value: "HOLD" as const, color: "text-[var(--color-warning)]" },
} as const;

// ─── Truth Contract 数据 ────────────────────────────────────────────────────

const TRUTH_CONTRACT = {
  id: "retail-revenue-v1",
  name: "Retail Revenue Contribution v1",
  version: "attribution-truth-contract@1",
  description: "Ground truth for retail revenue decomposition: promotion discount impact, late refund adjustments, and base revenue change",
  fixture: {
    id: "retail-fixture-v1",
    version: "1.0.0",
    origin: "FIXTURE",
  },
  patterns: [
    {
      id: "promotion-discount",
      name: "Promotion Discount Impact",
      expected: "CONFIRMED",
      source: "promotion",
      partition: "promotion_discount_impact",
      kind: "ARITHMETIC_PARTITION",
    },
    {
      id: "late-refunds",
      name: "Late Refund Adjustments",
      expected: "CONFIRMED",
      source: "refund",
      partition: "late_refund_impact",
      kind: "ARITHMETIC_PARTITION",
    },
    {
      id: "base-revenue",
      name: "Base Revenue Change",
      expected: "CONFIRMED",
      source: "base",
      partition: "base_revenue_change",
      kind: "INDEPENDENTLY_OBSERVED_RESIDUAL",
    },
  ],
};

// ─── Kernel Evidence 数据 ───────────────────────────────────────────────────

const KERNEL_EVIDENCE = {
  version: "attribution-kernel-evidence@1",
  origin: "FIXTURE",
  evidence_id: "ke-001",
  profile_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
  truth_hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
  closure_verdict: "PASS",
  conclusion: {
    subject_id: "retail-revenue-v1",
    source_identity: "retail-fixture-v1",
    contribution_verdict: "CONFIRMED",
    fixture_confidence: 0.9,
    evidence_links: 6,
  },
  explicit_absence: "attribution_feasibility_verdict",
};

// ─── Feasibility Verdict 数据 ───────────────────────────────────────────────

const FEASIBILITY_VERDICT = {
  version: "attribution-feasibility-verdict@1",
  verdict: "FEASIBLE_FOR_PUBLISHED_INTEGRATION",
  oracle_check: {
    status: "PASS",
    pattern_match: "3/3",
    evidence_match: "5/5",
    closure_verdict: "PASS",
  },
  mutation_check: {
    status: "PASS",
    detection_rate: "100%",
    mutations: "3/3",
  },
  holdout_check: {
    status: "PASS",
    holdout_pass: "2/2",
  },
  reason_codes: ["ALL_CHECKS_PASSED"],
};

// ─── 组件 ───────────────────────────────────────────────────────────────────

export function FixtureEvidenceSection() {
  const [expandedContract, setExpandedContract] = useState(false);
  const [expandedEvidence, setExpandedEvidence] = useState(false);
  const [expandedVerdict, setExpandedVerdict] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span>Fixture Evidence</span>
          <span className="rounded-full bg-[var(--color-warning)]/10 px-2 py-0.5 text-xs font-medium text-[var(--color-warning)]">
            HOLD
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 三状态摘要 */}
        <div className="grid grid-cols-3 gap-3">
          {Object.values(FIXED_STATES).map((state) => (
            <div
              key={state.label}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2 text-center"
            >
              <p className="text-xs text-[var(--color-text-tertiary)]">{state.label}</p>
              <p className={`mt-0.5 text-sm font-medium ${state.color}`}>{state.value}</p>
            </div>
          ))}
        </div>

        {/* Truth Contract */}
        <div className="rounded-lg border border-[var(--color-border)]">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]"
            onClick={() => setExpandedContract(!expandedContract)}
            aria-expanded={expandedContract}
            aria-controls="fixture-truth-contract-details"
          >
            <span>Truth Contract: {TRUTH_CONTRACT.name}</span>
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {expandedContract ? "▼" : "▶"}
            </span>
          </button>
          {expandedContract && (
            <div id="fixture-truth-contract-details" className="border-t border-[var(--color-border)] px-3 py-2">
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-tertiary)]">ID</span>
                  <span className="font-mono text-[var(--color-text)]">{TRUTH_CONTRACT.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-tertiary)]">Version</span>
                  <span className="text-[var(--color-text)]">{TRUTH_CONTRACT.version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-tertiary)]">Fixture</span>
                  <span className="font-mono text-[var(--color-text)]">{TRUTH_CONTRACT.fixture.id} v{TRUTH_CONTRACT.fixture.version}</span>
                </div>
                <p className="text-[var(--color-text-tertiary)]">{TRUTH_CONTRACT.description}</p>
                <div className="pt-1">
                  <p className="mb-1 font-medium text-[var(--color-text-tertiary)]">Contribution Patterns</p>
                  {TRUTH_CONTRACT.patterns.map((pattern) => (
                    <div key={pattern.id} className="flex items-center gap-2 rounded bg-[var(--color-bg-secondary)] p-1.5">
                      <span className="font-medium text-[var(--color-text)]">{pattern.name}</span>
                      <span className="text-[var(--color-text-tertiary)]">→</span>
                      <span className="text-[var(--color-success)]">{pattern.expected}</span>
                      <span className="ml-auto font-mono text-[var(--color-text-tertiary)]">{pattern.partition}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Kernel Evidence */}
        <div className="rounded-lg border border-[var(--color-border)]">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]"
            onClick={() => setExpandedEvidence(!expandedEvidence)}
            aria-expanded={expandedEvidence}
            aria-controls="fixture-kernel-evidence-details"
          >
            <span>Kernel Evidence: {KERNEL_EVIDENCE.evidence_id}</span>
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {expandedEvidence ? "▼" : "▶"}
            </span>
          </button>
          {expandedEvidence && (
            <div id="fixture-kernel-evidence-details" className="border-t border-[var(--color-border)] px-3 py-2">
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-tertiary)]">Version</span>
                  <span className="text-[var(--color-text)]">{KERNEL_EVIDENCE.version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-tertiary)]">Origin</span>
                  <span className="text-[var(--color-text)]">{KERNEL_EVIDENCE.origin}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-tertiary)]">Closure Verdict</span>
                  <span className="text-[var(--color-success)]">{KERNEL_EVIDENCE.closure_verdict}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-tertiary)]">Conclusion</span>
                  <span className="text-[var(--color-success)]">{KERNEL_EVIDENCE.conclusion.contribution_verdict}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-tertiary)]">Confidence</span>
                  <span className="text-[var(--color-text)]">{KERNEL_EVIDENCE.conclusion.fixture_confidence}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-tertiary)]">Evidence Links</span>
                  <span className="text-[var(--color-text)]">{KERNEL_EVIDENCE.conclusion.evidence_links}</span>
                </div>
                <div className="rounded bg-[var(--color-bg-secondary)] p-1.5 font-mono text-[var(--color-text-tertiary)]">
                  explicit_absence: {KERNEL_EVIDENCE.explicit_absence}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Feasibility Verdict */}
        <div className="rounded-lg border border-[var(--color-border)]">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)]"
            onClick={() => setExpandedVerdict(!expandedVerdict)}
            aria-expanded={expandedVerdict}
            aria-controls="fixture-feasibility-verdict-details"
          >
            <span>Feasibility Verdict: {FEASIBILITY_VERDICT.verdict}</span>
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {expandedVerdict ? "▼" : "▶"}
            </span>
          </button>
          {expandedVerdict && (
            <div id="fixture-feasibility-verdict-details" className="border-t border-[var(--color-border)] px-3 py-2">
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-tertiary)]">Version</span>
                  <span className="text-[var(--color-text)]">{FEASIBILITY_VERDICT.version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-tertiary)]">Verdict</span>
                  <span className="font-medium text-[var(--color-success)]">{FEASIBILITY_VERDICT.verdict}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-tertiary)]">Oracle Check</span>
                  <span className="text-[var(--color-success)]">{FEASIBILITY_VERDICT.oracle_check.status} ({FEASIBILITY_VERDICT.oracle_check.pattern_match})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-tertiary)]">Mutation Check</span>
                  <span className="text-[var(--color-success)]">{FEASIBILITY_VERDICT.mutation_check.status} ({FEASIBILITY_VERDICT.mutation_check.detection_rate})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-tertiary)]">Holdout Check</span>
                  <span className="text-[var(--color-success)]">{FEASIBILITY_VERDICT.holdout_check.status} ({FEASIBILITY_VERDICT.holdout_check.holdout_pass})</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {FEASIBILITY_VERDICT.reason_codes.map((code) => (
                    <span key={code} className="rounded bg-[var(--color-bg-secondary)] px-1.5 py-0.5 font-mono text-[var(--color-text-tertiary)]">
                      {code}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
