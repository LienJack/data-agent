import type { ArtifactReference } from "@data-agent/contracts";
import type { HypothesisCandidateInput, ResearchBriefCandidateInput } from "@data-agent/research";

export const hashes = {
  a: `sha256:${"1".repeat(64)}`,
  b: `sha256:${"2".repeat(64)}`,
  c: `sha256:${"3".repeat(64)}`,
} as const;

export function reference<T extends ArtifactReference["artifact_type"]>(
  artifactType: T,
  suffix = "01",
): ArtifactReference & { artifact_type: T } {
  return {
    app_id: "00000000-0000-4000-8000-000000000001",
    tenant_id: "00000000-0000-4000-8000-000000000002",
    environment: "test",
    run_id: "00000000-0000-4000-8000-000000000003",
    artifact_id: `00000000-0000-4000-8000-0000000000${suffix}`,
    artifact_type: artifactType,
    revision: 1,
    content_hash: hashes.a,
  };
}

export function researchBriefInput(): ResearchBriefCandidateInput {
  return {
    question_frame_ref: reference("QuestionFrame", "10"),
    scope: {
      subject: "分析收入下降",
      time_window: {
        start: "2025-01-01T00:00:00.000Z",
        end: "2025-04-01T00:00:00.000Z",
        timezone: "Asia/Shanghai",
        semantics: "HALF_OPEN",
      },
      dimensions: ["region"],
      metric_refs: [
        {
          container_ref: reference("SemanticRelease", "11"),
          node_id: "net-revenue",
        },
      ],
    },
    success_criteria: [
      {
        criterion_id: "explain-decline",
        statement: "解释净收入下降的贡献构成",
        materiality: "CRITICAL",
      },
    ],
    evidence_policy: {
      allowed_kinds: ["QUERY"],
      minimum_support_mode: "DETERMINISTIC",
      unsupported_source_behavior: "REJECT",
    },
    hypothesis_universe_policy: {
      candidate_sources: ["METRIC_DECOMPOSITION"],
      enumerator_version: "hypothesis-enumerator@1.0.0",
      required_disclosure: "BOUNDED_HYPOTHESIS_UNIVERSE",
    },
    freshness_policy: {
      max_age_seconds: 3600,
      require_snapshot_replayable: true,
    },
    source_independence_policy: {
      mode: "ONE_AUTHORITATIVE_SOURCE_WITH_DISCLOSURE",
      minimum_provenance_groups: 1,
      required_disclosures: ["SINGLE_AUTHORITY_SOURCE"],
    },
    claim_policy: {
      allowed_modes: ["DESCRIPTIVE", "COMPARATIVE", "DIAGNOSTIC"],
      forbidden_modes: ["CAUSAL", "PRESCRIPTIVE", "ACTION_EXECUTING"],
    },
    budget: {
      max_steps: 24,
      max_model_calls: 32,
      max_sql_executions: 16,
      max_source_calls: 0,
      max_elapsed_ms: 600_000,
      max_provider_input_tokens_per_call: 32_000,
      max_provider_output_tokens_per_call: 8_000,
      max_provider_tokens_per_run: 256_000,
      max_provider_cost_microusd_per_run: 5_000_000,
    },
    policy_ref: reference("PolicyReceipt", "12"),
    policy_digest: hashes.b,
    data_classification: "INTERNAL",
    retention_policy_ref: {
      policy_id: "research-retention",
      policy_version: "1.0.0",
      policy_hash: hashes.c,
    },
  };
}

export function hypotheses(): HypothesisCandidateInput[] {
  return [
    {
      hypothesis_id: "promotion-mix",
      mechanism_class: "promotion",
      statement: "促销结构变化解释收入下降",
      predictions: ["促销贡献份额上升"],
      falsifiers: ["促销贡献份额很低"],
      discriminating_test_ids: ["promotion-share"],
      materiality: "MATERIAL",
    },
    {
      hypothesis_id: "late-refund",
      mechanism_class: "refund",
      statement: "延迟退款解释收入下降",
      predictions: ["延迟退款贡献份额上升"],
      falsifiers: ["延迟退款贡献份额很低"],
      discriminating_test_ids: ["refund-share"],
      materiality: "MATERIAL",
    },
  ];
}
