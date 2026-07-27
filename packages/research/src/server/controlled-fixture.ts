import {
  type ControlledFixtureContract,
  controlledFixtureContractSchema,
  deepFreeze,
  sha256ContentHash,
} from "@data-agent/contracts";
import type { ResearchProtocolInput } from "../protocol.js";

const PARTIAL_PRECONDITIONS = {
  hard_budget_cap: true,
  deliverable_supported_subset: true,
  budget_executable_query_count: 0,
} as const;
const PARTIAL_TERMINAL = {
  terminal: "PARTIAL",
  reason_code: "EVIDENCE_PARTIAL",
} as const;
const STALE_TERMINAL = { terminal: "STALE", reason_code: "RUN_STALE" } as const;
const FAILED_TERMINAL = {
  terminal: "FAILED",
  reason_code: "INTERNAL_EXECUTION_FAILED",
} as const;

const CONTROLLED_FIXTURE_LITERAL = {
  protocol_version: "u6-controlled-fixture@1.0.0",
  fixture_id: "retail-revenue-investigation-v1",
  authority_kind: "SYNTHETIC_PROTOCOL_FIXTURE",
  benchmark_eligible: false,
  demo_truth_eligible: false,
  release_evidence_eligible: false,
  question: "2025 年第一季度华南区净收入同比为什么下降？哪些竞争解释得到数据支持，哪些仍不能确认？",
  hypotheses: [
    {
      hypothesis_id: "promotion-mix",
      metric_alias: "promotion_decline_share",
      support_predicate: { operator: "GTE", threshold: 0.6 },
      refute_predicate: { operator: "LTE", threshold: 0.3 },
      expected_assessment: "SURVIVED",
    },
    {
      hypothesis_id: "late-refund",
      metric_alias: "late_refund_decline_share",
      support_predicate: { operator: "GTE", threshold: 0.4 },
      refute_predicate: { operator: "LTE", threshold: 0.2 },
      expected_assessment: "REFUTED",
    },
  ],
  queries: [
    {
      query_id: "Q1",
      depends_on_query_ids: [],
      rows: [
        {
          baseline_net_revenue: 1000,
          current_net_revenue: 800,
          decline_amount: 200,
          promotion_contribution: 140,
          late_refund_contribution: 20,
          other_contribution: 40,
        },
      ],
    },
    {
      query_id: "Q2",
      depends_on_query_ids: ["Q1"],
      rows: [
        {
          promotion_decline_share: 0.7,
          late_refund_decline_share: 0.1,
        },
      ],
    },
  ],
  rq092_mutation_ids: [
    "citation-only",
    "hidden-conflict",
    "critical-query-failure",
    "stale-cross-revision",
    "budget-false-complete",
    "writer-bypass",
    "false-source-independence",
    "wrong-successful-sql",
    "wrong-filter-successful-sql",
    "bounded-universe-disclosure-omission",
    "supervisor-certificate-bypass",
    "certificate-tamper",
    "certificate-semantic-hash-tamper",
    "current-ready-revocation-race",
  ],
  mutation_count: 14,
  partial_mutation_count: 8,
  generated_partial_pair_count: 16,
  mutation_registry: [
    {
      mutation_id: "citation-only",
      partial_preconditions: PARTIAL_PRECONDITIONS,
      public_terminal: PARTIAL_TERMINAL,
      domain_reason_code: "EVIDENCE_SUPPORT_INSUFFICIENT",
      certificate_issued: false,
      grant_issued: false,
    },
    {
      mutation_id: "hidden-conflict",
      partial_preconditions: PARTIAL_PRECONDITIONS,
      public_terminal: PARTIAL_TERMINAL,
      domain_reason_code: "MATERIAL_CONFLICT_UNDISCLOSED",
      certificate_issued: false,
      grant_issued: false,
    },
    {
      mutation_id: "critical-query-failure",
      partial_preconditions: PARTIAL_PRECONDITIONS,
      public_terminal: PARTIAL_TERMINAL,
      domain_reason_code: "CRITICAL_OBLIGATION_FAILED",
      certificate_issued: false,
      grant_issued: false,
    },
    {
      mutation_id: "stale-cross-revision",
      partial_preconditions: null,
      public_terminal: STALE_TERMINAL,
      domain_reason_code: "EVIDENCE_REVISION_STALE",
      certificate_issued: false,
      grant_issued: false,
    },
    {
      mutation_id: "budget-false-complete",
      partial_preconditions: PARTIAL_PRECONDITIONS,
      public_terminal: PARTIAL_TERMINAL,
      domain_reason_code: "BUDGET_EXHAUSTED_WITH_OPEN_CRITICAL_OBLIGATION",
      certificate_issued: false,
      grant_issued: false,
    },
    {
      mutation_id: "writer-bypass",
      partial_preconditions: null,
      public_terminal: FAILED_TERMINAL,
      domain_reason_code: "REPORT_PROJECTION_AUTHORITY_INVALID",
      certificate_issued: false,
      grant_issued: false,
    },
    {
      mutation_id: "false-source-independence",
      partial_preconditions: PARTIAL_PRECONDITIONS,
      public_terminal: PARTIAL_TERMINAL,
      domain_reason_code: "SOURCE_INDEPENDENCE_POLICY_UNSATISFIED",
      certificate_issued: false,
      grant_issued: false,
    },
    {
      mutation_id: "wrong-successful-sql",
      partial_preconditions: PARTIAL_PRECONDITIONS,
      public_terminal: PARTIAL_TERMINAL,
      domain_reason_code: "OBLIGATION_QUERY_SEMANTICS_MISMATCH",
      certificate_issued: false,
      grant_issued: false,
    },
    {
      mutation_id: "wrong-filter-successful-sql",
      partial_preconditions: PARTIAL_PRECONDITIONS,
      public_terminal: PARTIAL_TERMINAL,
      domain_reason_code: "OBLIGATION_QUERY_SEMANTICS_MISMATCH",
      certificate_issued: false,
      grant_issued: false,
    },
    {
      mutation_id: "bounded-universe-disclosure-omission",
      partial_preconditions: PARTIAL_PRECONDITIONS,
      public_terminal: PARTIAL_TERMINAL,
      domain_reason_code: "BOUNDED_HYPOTHESIS_UNIVERSE_UNDISCLOSED",
      certificate_issued: false,
      grant_issued: false,
    },
    {
      mutation_id: "supervisor-certificate-bypass",
      partial_preconditions: null,
      public_terminal: null,
      domain_reason_code: "REPORT_READY_AUTHORITY_REQUIRED",
      certificate_issued: false,
      grant_issued: false,
    },
    {
      mutation_id: "certificate-tamper",
      partial_preconditions: null,
      public_terminal: null,
      domain_reason_code: "REPORT_READY_CERTIFICATE_TAMPERED",
      certificate_issued: false,
      grant_issued: false,
    },
    {
      mutation_id: "certificate-semantic-hash-tamper",
      partial_preconditions: null,
      public_terminal: null,
      domain_reason_code: "CERTIFICATE_SEMANTIC_HASH_MISMATCH",
      certificate_issued: false,
      grant_issued: false,
    },
    {
      mutation_id: "current-ready-revocation-race",
      partial_preconditions: null,
      public_terminal: STALE_TERMINAL,
      domain_reason_code: "READINESS_REVOKED_DURING_CONSUMPTION",
      certificate_issued: false,
      grant_issued: false,
    },
  ],
  partial_pair_generation: {
    base_mutation_ids: [
      "citation-only",
      "hidden-conflict",
      "critical-query-failure",
      "budget-false-complete",
      "false-source-independence",
      "wrong-successful-sql",
      "wrong-filter-successful-sql",
      "bounded-universe-disclosure-omission",
    ],
    continue_suffix: "--continue",
    replan_suffix: "--replan",
    continue_template: {
      hard_budget_cap: false,
      deliverable_supported_subset: true,
      budget_executable_query_count: 1,
      executable_replan_count: 0,
      expected_decision: "CONTINUE",
      expected_reason_code: "ADMISSIBLE_QUERY_CANDIDATE_AVAILABLE",
      public_terminal: null,
      certificate_issued: false,
      grant_issued: false,
    },
    replan_template: {
      hard_budget_cap: false,
      deliverable_supported_subset: true,
      budget_executable_query_count: 0,
      waiting_query_count: 0,
      budget_blocked_query_count: 0,
      open_obligation_count: 1,
      replan_trigger: "PLAN_INVALIDATED",
      executable_with_remaining_budget: true,
      expected_decision: "REPLAN",
      expected_reason_code: "EVIDENCE_PLAN_REPLAN_REQUIRED",
      public_terminal: null,
      certificate_issued: false,
      grant_issued: false,
    },
    generated_count: 16,
  },
  required_disclosures: ["SINGLE_AUTHORITY_SOURCE", "L2_NON_CAUSAL", "BOUNDED_HYPOTHESIS_UNIVERSE"],
  expected: {
    promotion_mix: "SURVIVED",
    late_refund: "REFUTED",
    stop_decision: "STOP_READY",
    public_terminal: "READY",
    public_reason_code: "RUN_READY",
    release_decision: "HOLD",
  },
} as const;

declare const controlledFixtureHandleBrand: unique symbol;
export interface ControlledFixtureHandle {
  readonly fixture_id: "retail-revenue-investigation-v1";
  readonly protocol_version: "u6-controlled-fixture@1.0.0";
  readonly fixture_hash: `sha256:${string}`;
  readonly [controlledFixtureHandleBrand]: true;
}

declare const controlledResearchProtocolInputBrand: unique symbol;
export interface ControlledResearchProtocolInput extends ResearchProtocolInput {
  readonly [controlledResearchProtocolInputBrand]: true;
}

interface FixtureRecord {
  readonly fixture: ControlledFixtureContract;
  readonly fixture_hash: `sha256:${string}`;
}

const fixtureHandles = new WeakSet<object>();
const fixtureRecords = new WeakMap<object, FixtureRecord>();
const controlledProtocolInputs = new WeakSet<object>();
let handlePromise: Promise<ControlledFixtureHandle> | undefined;

async function createHandle(): Promise<ControlledFixtureHandle> {
  const fixture = deepFreeze(controlledFixtureContractSchema.parse(CONTROLLED_FIXTURE_LITERAL));
  const fixture_hash = await sha256ContentHash(fixture);
  const handle = deepFreeze({
    fixture_id: fixture.fixture_id,
    protocol_version: fixture.protocol_version,
    fixture_hash,
  }) as ControlledFixtureHandle;
  fixtureHandles.add(handle);
  fixtureRecords.set(handle, { fixture, fixture_hash });
  return handle;
}

export async function getControlledFixtureHandle(
  fixtureId: "retail-revenue-investigation-v1",
  protocolVersion: "u6-controlled-fixture@1.0.0",
): Promise<ControlledFixtureHandle> {
  if (
    fixtureId !== "retail-revenue-investigation-v1" ||
    protocolVersion !== "u6-controlled-fixture@1.0.0"
  ) {
    throw new TypeError("未知 Controlled Fixture Registry Key。");
  }
  handlePromise ??= createHandle();
  return handlePromise;
}

export function isControlledFixtureHandle(value: unknown): value is ControlledFixtureHandle {
  return typeof value === "object" && value !== null && fixtureHandles.has(value);
}

function resolveRecord(handle: ControlledFixtureHandle): FixtureRecord {
  const record = fixtureRecords.get(handle);
  if (!record || !fixtureHandles.has(handle)) {
    throw new TypeError("CONTROLLED_FIXTURE_HANDLE_REQUIRED");
  }
  return record;
}

export function readControlledFixtureContract(
  handle: ControlledFixtureHandle,
): ControlledFixtureContract {
  return resolveRecord(handle).fixture;
}

const FORBIDDEN_KERNEL_INPUT_KEYS = new Set([
  "mutation_id",
  "public_terminal",
  "certificate_issued",
  "grant_issued",
  "partial_preconditions",
]);

function stripOracleFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripOracleFields);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          key !== "expected" &&
          !key.startsWith("expected_") &&
          !FORBIDDEN_KERNEL_INPUT_KEYS.has(key) &&
          !key.includes("certificate") &&
          !key.includes("grant"),
      )
      .map(([key, fieldValue]) => [key, stripOracleFields(fieldValue)]),
  );
}

/**
 * 该函数不从 package exports 暴露；保留给 Proxy 负测证明投影不会读取 Oracle 字段。
 */
export function projectControlledProtocolInputFromFixture(
  fixture: ControlledFixtureContract,
): ResearchProtocolInput {
  const q1 = fixture.queries[0].rows[0];
  const q2 = fixture.queries[1].rows[0];
  const projected = {
    observations: {
      q1: { ...q1 },
      q2: { ...q2 },
      q1_snapshot_token: "retail-revenue-investigation-v1:r1",
      q2_snapshot_token: "retail-revenue-investigation-v1:r1",
      q2_dependency_query_ids: [...fixture.queries[1].depends_on_query_ids],
    },
    hypotheses: fixture.hypotheses.map((hypothesis) => ({
      hypothesis_id: hypothesis.hypothesis_id,
      metric_alias: hypothesis.metric_alias,
      support_predicate: hypothesis.support_predicate,
      refute_predicate: hypothesis.refute_predicate,
    })),
    evidence_facts: {
      deterministic_check_observed_hash: "controlled-deterministic-hash-v1",
      deterministic_check_expected_hash: "controlled-deterministic-hash-v1",
      material_conflict_count: 0,
      disclosed_material_conflict_count: 0,
      critical_query_execution_status: "SUCCEEDED",
      observed_schema_revision: 1,
      current_schema_revision: 1,
      writer_projection_mode: "DETERMINISTIC",
      provenance_groups: ["controlled-postgresql"],
      source_independence_mode: "ONE_AUTHORITATIVE_SOURCE_WITH_DISCLOSURE",
      minimum_provenance_groups: 1,
      query_metric_id: "late_refund_decline_share",
      obligation_metric_id: "late_refund_decline_share",
      query_filter_hash: "controlled-filter-v1",
      obligation_filter_hash: "controlled-filter-v1",
      report_disclosures: [...fixture.required_disclosures],
      remaining_budget_steps: 1,
      required_followup_budget_steps: 0,
    },
    next_query_facts: {
      query_present: false,
      semantic_admissible: true,
      information_gain_microunits: 100,
      required_budget_steps: 1,
      waiting_on_codes: [],
      replan_trigger: null,
      budget_top_up_allowed: false,
    },
    boundary_facts: {
      issuer_role: "READINESS_AUTHORITY",
      closure_hash_transport: "UNCHANGED",
      semantic_hash_transport: "UNCHANGED",
      revocation_event_seq: null,
      consumption_event_seq: 10,
    },
  } satisfies ResearchProtocolInput;
  return deepFreeze(stripOracleFields(projected) as ResearchProtocolInput);
}

export function materializeControlledProtocolInput(
  handle: ControlledFixtureHandle,
): ControlledResearchProtocolInput {
  return registerControlledProtocolInput(
    projectControlledProtocolInputFromFixture(resolveRecord(handle).fixture),
  );
}

function registerControlledProtocolInput(
  input: ResearchProtocolInput,
): ControlledResearchProtocolInput {
  const frozen = deepFreeze(input) as ControlledResearchProtocolInput;
  controlledProtocolInputs.add(frozen);
  return frozen;
}

export function isControlledResearchProtocolInput(
  value: unknown,
): value is ControlledResearchProtocolInput {
  return typeof value === "object" && value !== null && controlledProtocolInputs.has(value);
}

type MutationOracle = ControlledFixtureContract["mutation_registry"][number];
export interface ControlledMutationCase {
  readonly case_id: string;
  readonly kernel_input: ControlledResearchProtocolInput;
  readonly oracle: MutationOracle;
}

export interface ControlledPairCase {
  readonly case_id: string;
  readonly kernel_input: ControlledResearchProtocolInput;
  readonly oracle:
    | {
        readonly decision: "CONTINUE";
        readonly reason_code: "ADMISSIBLE_QUERY_CANDIDATE_AVAILABLE";
        readonly committed_public_terminal: null;
        readonly hard_budget_cap: false;
        readonly deliverable_supported_subset: true;
        readonly budget_executable_query_count: 1;
        readonly executable_replan_count: 0;
      }
    | {
        readonly decision: "REPLAN";
        readonly reason_code: "EVIDENCE_PLAN_REPLAN_REQUIRED";
        readonly committed_public_terminal: null;
        readonly hard_budget_cap: false;
        readonly deliverable_supported_subset: true;
        readonly budget_executable_query_count: 0;
        readonly waiting_query_count: 0;
        readonly budget_blocked_query_count: 0;
        readonly open_obligation_count: 1;
        readonly replan_trigger: "PLAN_INVALIDATED";
        readonly executable_with_remaining_budget: true;
      };
}

function withMutation(
  base: ResearchProtocolInput,
  mutationId: ControlledFixtureContract["rq092_mutation_ids"][number],
): ControlledResearchProtocolInput {
  const evidenceFacts = {
    ...base.evidence_facts,
    provenance_groups: [...base.evidence_facts.provenance_groups],
    report_disclosures: [...base.evidence_facts.report_disclosures],
  };
  const boundaryFacts = { ...base.boundary_facts };
  switch (mutationId) {
    case "citation-only":
      evidenceFacts.deterministic_check_observed_hash = "citation-only-hash";
      break;
    case "hidden-conflict":
      evidenceFacts.material_conflict_count = 1;
      evidenceFacts.disclosed_material_conflict_count = 0;
      break;
    case "critical-query-failure":
      evidenceFacts.critical_query_execution_status = "FAILED";
      break;
    case "stale-cross-revision":
      evidenceFacts.observed_schema_revision = 1;
      evidenceFacts.current_schema_revision = 2;
      break;
    case "budget-false-complete":
      evidenceFacts.remaining_budget_steps = 0;
      evidenceFacts.required_followup_budget_steps = 1;
      break;
    case "writer-bypass":
      evidenceFacts.writer_projection_mode = "FREEFORM";
      break;
    case "false-source-independence":
      evidenceFacts.source_independence_mode = "MULTI_PROVENANCE_REQUIRED";
      evidenceFacts.minimum_provenance_groups = 2;
      break;
    case "wrong-successful-sql":
      evidenceFacts.query_metric_id = "gross_revenue";
      break;
    case "wrong-filter-successful-sql":
      evidenceFacts.query_filter_hash = "wrong-region-filter";
      break;
    case "bounded-universe-disclosure-omission":
      evidenceFacts.report_disclosures = evidenceFacts.report_disclosures.filter(
        (disclosure) => disclosure !== "BOUNDED_HYPOTHESIS_UNIVERSE",
      );
      break;
    case "supervisor-certificate-bypass":
      boundaryFacts.issuer_role = "SUPERVISOR";
      break;
    case "certificate-tamper":
      boundaryFacts.closure_hash_transport = "ZEROED";
      break;
    case "certificate-semantic-hash-tamper":
      boundaryFacts.semantic_hash_transport = "REPLACED";
      break;
    case "current-ready-revocation-race":
      boundaryFacts.revocation_event_seq = 9;
      break;
  }
  return registerControlledProtocolInput(
    stripOracleFields({
      ...base,
      evidence_facts: evidenceFacts,
      next_query_facts: {
        ...base.next_query_facts,
        query_present: true,
        required_budget_steps: 2,
      },
      boundary_facts: boundaryFacts,
    }) as ResearchProtocolInput,
  );
}

export function listControlledMutationCases(
  handle: ControlledFixtureHandle,
): readonly ControlledMutationCase[] {
  const fixture = resolveRecord(handle).fixture;
  const base = projectControlledProtocolInputFromFixture(fixture);
  return deepFreeze(
    fixture.mutation_registry.map((oracle) => ({
      case_id: oracle.mutation_id,
      kernel_input: withMutation(base, oracle.mutation_id),
      oracle,
    })),
  );
}

export function listControlledPairCases(
  handle: ControlledFixtureHandle,
): readonly ControlledPairCase[] {
  const fixture = resolveRecord(handle).fixture;
  const base = projectControlledProtocolInputFromFixture(fixture);
  return deepFreeze(
    fixture.partial_pair_generation.base_mutation_ids.flatMap((mutationId) => {
      const disturbed = withMutation(base, mutationId);
      return [
        {
          case_id: `${mutationId}${fixture.partial_pair_generation.continue_suffix}`,
          kernel_input: registerControlledProtocolInput(
            deepFreeze({
              ...disturbed,
              next_query_facts: {
                ...disturbed.next_query_facts,
                query_present: true,
                semantic_admissible: true,
                information_gain_microunits: 100,
                required_budget_steps: 1,
                waiting_on_codes: [],
                replan_trigger: null,
              },
            }) as ResearchProtocolInput,
          ),
          oracle: {
            decision: "CONTINUE",
            reason_code: "ADMISSIBLE_QUERY_CANDIDATE_AVAILABLE",
            committed_public_terminal: null,
            hard_budget_cap: false,
            deliverable_supported_subset: true,
            budget_executable_query_count: 1,
            executable_replan_count: 0,
          },
        },
        {
          case_id: `${mutationId}${fixture.partial_pair_generation.replan_suffix}`,
          kernel_input: registerControlledProtocolInput(
            deepFreeze({
              ...disturbed,
              next_query_facts: {
                ...disturbed.next_query_facts,
                query_present: false,
                required_budget_steps: 1,
                waiting_on_codes: [],
                replan_trigger: "PLAN_INVALIDATED",
              },
            }) as ResearchProtocolInput,
          ),
          oracle: {
            decision: "REPLAN",
            reason_code: "EVIDENCE_PLAN_REPLAN_REQUIRED",
            committed_public_terminal: null,
            hard_budget_cap: false,
            deliverable_supported_subset: true,
            budget_executable_query_count: 0,
            waiting_query_count: 0,
            budget_blocked_query_count: 0,
            open_obligation_count: 1,
            replan_trigger: "PLAN_INVALIDATED",
            executable_with_remaining_budget: true,
          },
        },
      ];
    }),
  );
}
