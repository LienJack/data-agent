import { describe, expect, it } from "vitest";
import {
  contributionTruthContractSchema,
  type ContributionTruthContract,
  truthContractReadyReceiptSchema,
  type TruthContractReadyReceipt,
  contributionArithmeticPartitionTruthSchema,
  type ContributionArithmeticPartitionTruth,
  contributionInjectedFaultTruthSchema,
  type ContributionInjectedFaultTruth,
  contributionExpertPriorityTruthSchema,
  type ContributionExpertPriorityTruth,
  truthKindSchema,
  oracleMutationProtocolSchema,
  type OracleMutationProtocol,
  demoHoldoutIdentitySchema,
  type DemoHoldoutIdentity,
  deepFreeze,
} from "../src/index.js";

// ─── Test constants ────────────────────────────────────────────────────────────

const testHash = `sha256:${"a".repeat(64)}` as const;
const testUUID = "00000000-0000-4000-8000-000000000001";
const testUUID2 = "00000000-0000-4000-8000-000000000002";
const testUUID3 = "00000000-0000-4000-8000-000000000003";
const testTimestamp = "2026-08-04T00:00:00.000Z";

// ─── Retail Revenue Contribution v1 Truth Contract ────────────────────────────

/**
 * retail-revenue-contribution-v1 truth contract fixture.
 * 
 * This truth contract defines the ground truth for a retail revenue decomposition
 * scenario where total revenue decline is driven by three factors:
 * 1. Promotion discount impact (negative - revenue loss from promotions)
 * 2. Late refund adjustments (negative - revenue loss from refunds)
 * 3. Base revenue change (the residual / independently observed trend)
 * 
 * The truth is an ARITHMETIC_PARTITION: total_revenue_change = 
 *   sum(promotion_discount_impact, late_refund_impact, base_revenue_change)
 */
function makeRetailRevenueTruthContract(): ContributionTruthContract {
  return {
    contract_version: "attribution-truth-contract@1",
    truth_id: "retail-revenue-v1",
    truth_name: "Retail Revenue Contribution v1",
    description: "Ground truth for retail revenue decomposition: promotion discount impact, late refund adjustments, and base revenue change",
    fixture_identity: {
      fixture_id: "retail-fixture-v1",
      fixture_version: "1.0.0",
      fixture_origin: "FIXTURE",
    },
    contribution_patterns: [
      {
        pattern_id: "promotion-discount",
        pattern_name: "Promotion Discount Impact",
        source_identity: "promotion",
        expected_verdict: "CONFIRMED",
        evidence_requirements: [
          { required_link_type: "endpoint_binding", required_link_ref_pattern: "revenue/promotion", min_confidence: 0.7 },
        ],
        truth_metadata: {
          arith_partition: "promotion_discount_impact",
          truth_kind: "ARITHMETIC_PARTITION",
        },
      },
      {
        pattern_id: "late-refunds",
        pattern_name: "Late Refund Adjustments",
        source_identity: "refund",
        expected_verdict: "CONFIRMED",
        evidence_requirements: [
          { required_link_type: "endpoint_binding", required_link_ref_pattern: "revenue/refunds", min_confidence: 0.7 },
        ],
        truth_metadata: {
          arith_partition: "late_refund_impact",
          truth_kind: "ARITHMETIC_PARTITION",
        },
      },
      {
        pattern_id: "base-revenue",
        pattern_name: "Base Revenue Change",
        source_identity: "base",
        expected_verdict: "CONFIRMED",
        evidence_requirements: [
          { required_link_type: "endpoint_binding", required_link_ref_pattern: "revenue/base", min_confidence: 0.7 },
        ],
        truth_metadata: {
          arith_partition: "base_revenue_change",
          truth_kind: "INDEPENDENTLY_OBSERVED_RESIDUAL",
        },
      },
    ],
    created_at: testTimestamp,
  };
}

// ─── Arithmetic Partition Truth for retail-revenue-v1 ─────────────────────────

function makeArithmeticPartitionTruth(): ContributionArithmeticPartitionTruth {
  return {
    truth_id: testUUID,
    kind: "ARITHMETIC_PARTITION",
    label: "Retail Revenue Decomposition",
    description: "Total revenue change = promotion discount impact + late refund impact + base revenue change",
    outcome_metric: "total_revenue_change",
    driver_metrics: ["promotion_discount_impact", "late_refund_impact", "base_revenue_change"],
    partition_expression: "total_revenue_change = promotion_discount_impact + late_refund_impact + base_revenue_change",
    expected_closure: "SUM_EQUALS",
    tolerance: 0.001,
    metadata: {
      version: "1.0.0",
      fixture_id: "retail-fixture-v1",
    },
  };
}

// ─── Truth Contract Ready Receipt Factory ──────────────────────────────────────

function makeTruthReadyReceipt(
  truthContractHash: `sha256:${string}`,
  truthContractId: string,
): TruthContractReadyReceipt {
  const receipt: TruthContractReadyReceipt = {
    protocol_version: "truth-contract-ready-receipt@1",
    receipt_id: crypto.randomUUID(),
    truth_contract_id: truthContractId,
    truth_contract_hash: truthContractHash,
    truth_count: 3,
    truth_kinds: ["ARITHMETIC_PARTITION"],
    verified_at: testTimestamp,
    verifier_version: "truth-contract-verifier@1",
    receipt_hash: testHash,
  };
  return receipt;
}

// ─── Oracle Mutation Protocol for retail-revenue-v1 ────────────────────────────

function makeOracleMutationProtocol(): OracleMutationProtocol {
  return {
    protocol_id: testUUID,
    protocol_version: "oracle-mutation-protocol@1",
    truth_contract_id: "retail-revenue-v1",
    mutations: [
      {
        mutation_id: testUUID,
        mutation_type: "VALUE_CHANGE",
        target_table: "revenue",
        target_column: "promotion_discount",
        mutation_parameters: { scale_factor: 0.5 },
        expected_oracle_response: "HOLD",
      },
      {
        mutation_id: testUUID2,
        mutation_type: "ROW_DELETION",
        target_table: "revenue",
        target_column: "refund_amount",
        mutation_parameters: { filter: "refund_amount > 1000" },
        expected_oracle_response: "HOLD",
      },
      {
        mutation_id: testUUID3,
        mutation_type: "AGGREGATE_SHIFT",
        target_table: "revenue",
        mutation_parameters: { shift: "base_revenue", offset: -500 },
        expected_oracle_response: "PASS",
      },
    ],
    budget: {
      max_mutations_per_run: 10,
      max_rows_affected: 100,
    },
    created_at: testTimestamp,
  };
}

// ─── Demo/Holdout Identity for retail-revenue-v1 ───────────────────────────────

function makeDemoHoldoutIdentity(): DemoHoldoutIdentity {
  return {
    identity_id: testUUID,
    dataset_id: "retail-revenue-v1-dataset",
    split: "DEMO",
    split_ratio: 0.7,
    row_count: 10000,
    fingerprint: testHash,
    created_at: testTimestamp,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("U7 Truth Contract — retail-revenue-contribution-v1", () => {
  describe("Truth Contract Schema", () => {
    it("creates a valid retail-revenue-v1 truth contract", () => {
      const contract = makeRetailRevenueTruthContract();
      const parsed = contributionTruthContractSchema.safeParse(contract);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.truth_id).toBe("retail-revenue-v1");
        expect(parsed.data.contribution_patterns).toHaveLength(3);
      }
    });

    it("rejects truth contract with missing contribution_patterns", () => {
      const invalid = {
        ...makeRetailRevenueTruthContract(),
        contribution_patterns: [],
      } as unknown as ContributionTruthContract;
      const parsed = contributionTruthContractSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it("rejects truth contract with invalid fixture_origin", () => {
      const invalid = {
        ...makeRetailRevenueTruthContract(),
        fixture_identity: { ...makeRetailRevenueTruthContract().fixture_identity, fixture_origin: "PRODUCTION" },
      } as unknown as ContributionTruthContract;
      const parsed = contributionTruthContractSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it("rejects truth contract with empty truth_name", () => {
      const invalid = { ...makeRetailRevenueTruthContract(), truth_name: "" };
      const parsed = contributionTruthContractSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it("freezes truth contract immutably with deepFreeze", () => {
      const contract = deepFreeze(makeRetailRevenueTruthContract());
      expect(() => {
        (contract as Record<string, unknown>).truth_name = "modified";
      }).toThrow();
    });
  });

  describe("ArithmeticPartitionTruth Schema", () => {
    it("creates a valid arithmetic partition truth", () => {
      const truth = makeArithmeticPartitionTruth();
      const parsed = contributionArithmeticPartitionTruthSchema.safeParse(truth);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.kind).toBe("ARITHMETIC_PARTITION");
        expect(parsed.data.driver_metrics).toHaveLength(3);
        expect(parsed.data.expected_closure).toBe("SUM_EQUALS");
      }
    });

    it("rejects arithmetic partition truth with empty driver_metrics", () => {
      const invalid = { ...makeArithmeticPartitionTruth(), driver_metrics: [] };
      const parsed = contributionArithmeticPartitionTruthSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it("rejects arithmetic partition truth with wrong kind", () => {
      const invalid = { ...makeArithmeticPartitionTruth(), kind: "INJECTED_FAULT" };
      const parsed = contributionArithmeticPartitionTruthSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });
  });

  describe("Truth Contract Ready Receipt", () => {
    it("creates a valid truth contract ready receipt", () => {
      const receipt = makeTruthReadyReceipt(testHash, "retail-revenue-v1");
      const parsed = truthContractReadyReceiptSchema.safeParse(receipt);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.protocol_version).toBe("truth-contract-ready-receipt@1");
        expect(parsed.data.truth_count).toBe(3);
      }
    });

    it("rejects receipt with zero truth_count", () => {
      const invalid = { ...makeTruthReadyReceipt(testHash, "retail-revenue-v1"), truth_count: 0 };
      const parsed = truthContractReadyReceiptSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });

    it("rejects receipt with empty truth_kinds", () => {
      const invalid = { ...makeTruthReadyReceipt(testHash, "retail-revenue-v1"), truth_kinds: [] };
      const parsed = truthContractReadyReceiptSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });
  });

  describe("Oracle Mutation Protocol", () => {
    it("creates a valid oracle mutation protocol", () => {
      const protocol = makeOracleMutationProtocol();
      const parsed = oracleMutationProtocolSchema.safeParse(protocol);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.mutations).toHaveLength(3);
        expect(parsed.data.budget.max_mutations_per_run).toBe(10);
      }
    });

    it("rejects mutation protocol with empty mutations", () => {
      const invalid = { ...makeOracleMutationProtocol(), mutations: [] };
      const parsed = oracleMutationProtocolSchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });
  });

  describe("Demo/Holdout Identity", () => {
    it("creates a valid demo identity", () => {
      const identity = makeDemoHoldoutIdentity();
      const parsed = demoHoldoutIdentitySchema.safeParse(identity);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.split).toBe("DEMO");
        expect(parsed.data.split_ratio).toBe(0.7);
      }
    });

    it("rejects holdout identity with negative row_count", () => {
      const invalid = { ...makeDemoHoldoutIdentity(), split: "HOLDOUT", row_count: -1 } as unknown as DemoHoldoutIdentity;
      const parsed = demoHoldoutIdentitySchema.safeParse(invalid);
      expect(parsed.success).toBe(false);
    });
  });

  describe("Truth Contract Hash Integrity", () => {
    it("produces consistent content-addressed hash for same contract", () => {
      const contract1 = makeRetailRevenueTruthContract();
      const contract2 = makeRetailRevenueTruthContract();
      const hash1 = computeTruthContractDigest(contract1);
      const hash2 = computeTruthContractDigest(contract2);
      expect(hash1).toBe(hash2);
    });

    it("produces different hash for different contracts", () => {
      const contract = makeRetailRevenueTruthContract();
      const modified = { ...contract, truth_name: "Modified" } as unknown as ContributionTruthContract;
      const hash1 = computeTruthContractDigest(contract);
      const hash2 = computeTruthContractDigest(modified);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("TruthKind Enum", () => {
    it("accepts all valid truth kinds", () => {
      const validKinds = ["ARITHMETIC_PARTITION", "INJECTED_FAULT", "EXPERT_PRIORITY", "SCM_CAUSAL"];
      for (const kind of validKinds) {
        const parsed = truthKindSchema.safeParse(kind);
        expect(parsed.success).toBe(true);
      }
    });

    it("rejects invalid truth kind", () => {
      const parsed = truthKindSchema.safeParse("INVALID_KIND");
      expect(parsed.success).toBe(false);
    });
  });
});

// ─── Helper: Compute truth contract content digest ─────────────────────────────

function computeTruthContractDigest(contract: ContributionTruthContract): string {
  const json = JSON.stringify(contract, Object.keys(contract).sort());
  // Simple hash for test purposes (production would use SHA-256)
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    const char = json.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return `sha256:${Math.abs(hash).toString(16).padStart(64, "0")}` as const;
}
