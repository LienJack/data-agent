import {
  type AnalysisContext,
  type ArtifactReference,
  buildAnalysisContext,
  parseL2ResearchDocumentCandidate,
  type RunWorkLease,
} from "@data-agent/contracts";
import { sha256ContentHash } from "@data-agent/contracts/common";
import type { ResearchArtifactAuthorityPort } from "@data-agent/contracts/ports";
import { describe, expect, it, vi } from "vitest";
import {
  type Falcon24AnalysisDataOracleReceipt,
  falcon24AnalysisDataOracleReceiptSchema,
} from "../../src/evals/falcon24-analysis-data-oracle.js";
import { FALCON24_ANALYSIS_QUERY_SPECS } from "../../src/evals/falcon24-analysis-queries.js";
import { createFalcon24ExactQueryEvidenceAuthority } from "../../src/evals/falcon24-exact-query-evidence-authority.js";
import { falcon24GovernedQueryInternals } from "../../src/evals/falcon24-governed-query-port.js";

const id = (suffix: number) => `61000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const hash = (character: string) => `sha256:${character.repeat(64)}` as const;
const scope = { app_id: id(1), tenant_id: id(2), environment: "test" } as const;
const lease: RunWorkLease = {
  scope,
  principal_id: id(8),
  outbox_id: id(9),
  run_id: id(3),
  command_id: id(10),
  command_kind: "START_DATA_AGENT_TEAM",
  attempt_id: id(4),
  attempt_no: 1,
  delivery_attempt_no: 1,
  lease_duration_ms: 300_000,
  worker_id: "falcon24-exact-evidence-test",
  lease_token: 1,
  worker_fence: 7,
  expires_at: "2026-08-24T00:05:00.000Z",
  payload: {},
};

function reference<T extends ArtifactReference["artifact_type"]>(
  artifactType: T,
  suffix: number,
  contentHash = hash(String(suffix % 10)),
): ArtifactReference & { readonly artifact_type: T } {
  return {
    artifact_id: id(suffix),
    artifact_type: artifactType,
    ...scope,
    run_id: lease.run_id,
    revision: 1,
    content_hash: contentHash,
  };
}

async function analysisContext(): Promise<AnalysisContext> {
  const semanticReleaseRef = reference("SemanticRelease", 20, hash("a"));
  return buildAnalysisContext({
    schema_version: "analysis-context@2.0.0",
    scope,
    semantic_context_binding: {
      package_id: id(21),
      package_hash: hash("b"),
      receipt_id: id(22),
      receipt_hash: hash("c"),
    },
    semantic_release_ref: semanticReleaseRef,
    schema_snapshot_ref: reference("SchemaSnapshot", 23, hash("d")),
    policy_receipt_ref: reference("PolicyReceipt", 24, hash("e")),
    semantic_retrieval_receipt_hash: hash("f"),
    semantic_inference_receipt_hash: hash("1"),
    metrics: [
      {
        metric_ref: { container_ref: semanticReleaseRef, node_id: "metric.order_revenue" },
        formula_hash: hash("2"),
        unit: null,
        grain: { grain_id: "falcon24-analysis", granularity: "atomic" },
        time_domain: {
          time_domain_id: "falcon24-complete-month-frontier",
          calendar: "gregorian",
          timezone: "Asia/Shanghai",
          min_time: "2023-05-01T00:00:00.000Z",
          max_time: "2024-11-01T00:00:00.000Z",
        },
        time_dimension_ref: "order_date",
        additivity: "additive",
        null_policy: "exclude",
        missing_period_policy: "REJECT_GAP",
        seasonality: null,
        priority: 10_000,
        causal_role: "OUTCOME",
        allowed_dimensions: [],
        analysis_capabilities: ["CHART_DATASET", "CONTRIBUTION", "TREND_CHANGE"],
      },
    ],
    relationships: [],
    causal_policy: null,
  });
}

async function oracleReceipt(): Promise<Falcon24AnalysisDataOracleReceipt> {
  const material = {
    schema_version: "falcon24-analysis-data-oracle@1.0.0" as const,
    dataset_id: "falcon_db_24" as const,
    verdict: "PASS_WITH_QUALITY_HOLDS" as const,
    table_count: 9,
    column_count: 70,
    total_row_count: 121445,
    max_order_date: "2024-11-04",
    last_complete_month: "2024-10-01",
    complete_month_count_18: 18,
    complete_month_count_12: 12,
    order_item_total_mismatch_count: 4999,
    stored_order_count_mismatch_count: 2385,
    stored_aov_mismatch_count: 2172,
    orders_before_registration_count: 2556,
    first_order_before_registration_customers: 1438,
    valid_ordering_customers: 734,
    no_order_customers: 328,
    delivery_rows_12m: 3059,
    feedback_rows_12m: 3059,
    inventory_rows_12m: 45231,
    inventory_new_rows_12m: 9798,
    marketing_week_count: 79,
    fully_observed_cohort_count: 12,
    quality_findings: [
      "FIRST_ORDER_BEFORE_REGISTRATION",
      "INVENTORY_NEW_SENSITIVITY_ONLY",
      "ORDER_BEFORE_REGISTRATION",
      "ORDER_TOTAL_ITEM_MISMATCH",
      "STORED_CUSTOMER_KPI_UNTRUSTED",
    ] as const,
  };
  return falcon24AnalysisDataOracleReceiptSchema.parse({
    ...material,
    receipt_hash: await sha256ContentHash(material),
  });
}

function rows() {
  const spec = FALCON24_ANALYSIS_QUERY_SPECS["falcon24-business-review-18m"];
  return Array.from({ length: spec.expected_rows }, (_, index) => ({
    order_id: `order-${index}`,
    order_date: "2024-10-01",
    payment_method: "cash",
    customer_id: `customer-${index}`,
    customer_segment: "new",
    product_category: "grocery",
    quantity: 1,
    order_total: 10,
  }));
}

function researchAuthority() {
  const commitCurrent = vi.fn<ResearchArtifactAuthorityPort["commitCurrent"]>(
    async (_capability, command) => {
      const candidate = parseL2ResearchDocumentCandidate(command.candidate);
      return {
        protocol_version: "u6-db-result@1.0.0",
        ok: true,
        value: {
          created: true,
          reference: {
            artifact_id: candidate.envelope.artifact_id,
            artifact_type: candidate.envelope.artifact_type,
            app_id: candidate.envelope.app_id,
            tenant_id: candidate.envelope.tenant_id,
            environment: candidate.envelope.environment,
            run_id: candidate.envelope.run_id,
            revision: candidate.envelope.revision,
            content_hash: candidate.envelope.content_hash,
          },
        },
      };
    },
  );
  const authority: ResearchArtifactAuthorityPort = {
    commitCurrent,
    async readHistorical() {
      return { protocol_version: "u6-db-result@1.0.0", ok: true, value: null };
    },
  };
  return { authority, commitCurrent };
}

async function command() {
  const spec = FALCON24_ANALYSIS_QUERY_SPECS["falcon24-business-review-18m"];
  return {
    lease,
    analysis_program_ref: reference("AnalysisProgram", 30, hash("3")),
    node_id: spec.case_id,
    idempotency_key: "falcon24-q1-evidence",
    spec,
    spec_hash: await falcon24GovernedQueryInternals.specHash(spec),
    data_oracle_receipt: await oracleReceipt(),
    rows: rows(),
    execution_started_at: "2026-08-24T00:00:00.000Z",
    execution_completed_at: "2026-08-24T00:00:00.010Z",
    statement_timeout_ms: 120_000,
  } as const;
}

describe("Falcon24 exact QueryEvidence authority", () => {
  it("builds and commits exact QueryEvidence@2 for the full 4,612-row Q1 input", async () => {
    const context = await analysisContext();
    const research = researchAuthority();
    const authority = createFalcon24ExactQueryEvidenceAuthority({
      analysis_context: context,
      datasource_id: id(40),
      research_artifacts: research.authority,
      capability_input: { capability: true },
    });

    const result = await authority.issue(await command());

    const document = parseL2ResearchDocumentCandidate(result.query_evidence_document);
    expect(document.payload).toMatchObject({
      artifact_type: "QueryEvidence",
      protocol_version: "query-evidence@2.0.0",
      observation: { row_count: 4_612 },
      observed_version: {
        semantic_release_ref: context.semantic_release_ref,
        schema_snapshot_ref: context.schema_snapshot_ref,
        policy_receipt_ref: context.policy_receipt_ref,
      },
    });
    expect(result.query_evidence_ref.content_hash).toBe(document.envelope.content_hash);
    expect(research.commitCurrent).toHaveBeenCalledOnce();
  });

  it("rejects a forged data-oracle receipt before committing evidence", async () => {
    const research = researchAuthority();
    const authority = createFalcon24ExactQueryEvidenceAuthority({
      analysis_context: await analysisContext(),
      datasource_id: id(40),
      research_artifacts: research.authority,
      capability_input: {},
    });
    const issued = await command();
    await expect(
      authority.issue({
        ...issued,
        data_oracle_receipt: { ...issued.data_oracle_receipt, receipt_hash: hash("9") },
      }),
    ).rejects.toThrow("FALCON24_DATA_ORACLE_RECEIPT_HASH_INVALID");
    expect(research.commitCurrent).not.toHaveBeenCalled();
  });

  it("rejects registry substitution and row-contract drift before committing evidence", async () => {
    const research = researchAuthority();
    const authority = createFalcon24ExactQueryEvidenceAuthority({
      analysis_context: await analysisContext(),
      datasource_id: id(40),
      research_artifacts: research.authority,
      capability_input: {},
    });
    const issued = await command();
    await expect(authority.issue({ ...issued, spec: { ...issued.spec } })).rejects.toThrow(
      "FALCON24_QUERY_EVIDENCE_CORRELATION_INVALID",
    );
    await expect(authority.issue({ ...issued, rows: issued.rows.slice(1) })).rejects.toThrow(
      "FALCON24_QUERY_ROW_BUDGET_INVALID",
    );
    expect(research.commitCurrent).not.toHaveBeenCalled();
  });
});
