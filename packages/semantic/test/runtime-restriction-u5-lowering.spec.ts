import { describe, expect, it } from "vitest";
import {
  computeRestrictionProjectionDigest,
  lowerRuntimeAuthorization,
  RuntimeAuthLoweringStatus,
} from "../src/compiler/runtime-auth-lowering.js";

describe("Runtime Restriction U5 Lowering", () => {
  it("table/column deny is lowerable", () => {
    const auth = {
      table_rules: [
        {
          table_id: "orders",
          action: "DENY" as const,
          column_ids: ["orders.amount", "orders.customer_id"],
          predicates: [],
        },
      ],
    };
    const result = lowerRuntimeAuthorization(auth);
    expect(result.status).toBe(RuntimeAuthLoweringStatus.LOWERED);
    expect(result.loweredRules.length).toBe(1);
    expect(result.loweredRules[0]!.action).toBe("DENY");
  });

  it("table/column restrict with comparison predicate is lowerable", () => {
    const auth = {
      table_rules: [
        {
          table_id: "orders",
          action: "RESTRICT" as const,
          column_ids: ["orders.amount", "orders.customer_id"],
          predicates: [
            {
              table_id: "orders",
              column_id: "orders.amount",
              operator: "gte" as const,
              parameter_key: "param_min_amount",
            },
          ],
        },
      ],
    };
    const result = lowerRuntimeAuthorization(auth);
    expect(result.status).toBe(RuntimeAuthLoweringStatus.LOWERED);
    expect(result.loweredRules.length).toBe(1);
    expect(result.loweredRules[0]!.predicates.length).toBe(1);
  });

  it("deny-all is lowerable", () => {
    const auth = {
      table_rules: [
        {
          table_id: "employees",
          action: "DENY" as const,
          column_ids: ["employees.salary", "employees.ssn"],
          predicates: [],
        },
        {
          table_id: "employees",
          action: "DENY" as const,
          column_ids: ["employees.bonus"],
          predicates: [],
        },
      ],
    };
    const result = lowerRuntimeAuthorization(auth);
    expect(result.status).toBe(RuntimeAuthLoweringStatus.LOWERED);
    expect(result.loweredRules.length).toBe(2);
  });

  it("canonical ordering produces stable digest", () => {
    const auth1 = {
      table_rules: [
        {
          table_id: "orders",
          action: "DENY" as const,
          column_ids: ["orders.amount", "orders.customer_id"],
          predicates: [],
        },
      ],
    };
    const auth2 = {
      table_rules: [
        {
          table_id: "orders",
          action: "DENY" as const,
          column_ids: ["orders.customer_id", "orders.amount"],
          predicates: [],
        },
      ],
    };
    const result1 = lowerRuntimeAuthorization(auth1);
    const result2 = lowerRuntimeAuthorization(auth2);
    const digest1 = computeRestrictionProjectionDigest(result1.loweredRules);
    const digest2 = computeRestrictionProjectionDigest(result2.loweredRules);
    expect(digest1).toBe(digest2);
  });

  it("purpose/masking not expressible in U5", () => {
    const auth = {
      table_rules: [
        {
          table_id: "users",
          action: "RESTRICT" as const,
          column_ids: ["users.email"],
          predicates: [
            {
              table_id: "users",
              column_id: "users.email",
              operator: "purpose_eq" as any,
              parameter_key: "marketing",
            },
          ],
        },
      ],
    };
    const result = lowerRuntimeAuthorization(auth);
    expect(result.status).toBe(RuntimeAuthLoweringStatus.NOT_EXPRESSIBLE_IN_U5);
    expect(result.notExpressibleReasons.length).toBeGreaterThan(0);
  });

  it("complex ABAC not expressible in U5", () => {
    const auth = {
      table_rules: [
        {
          table_id: "documents",
          action: "RESTRICT" as const,
          column_ids: ["documents.content"],
          predicates: [
            {
              table_id: "documents",
              column_id: "documents.content",
              operator: "abac_match" as any,
              parameter_key: "role_department",
            },
          ],
        },
      ],
    };
    const result = lowerRuntimeAuthorization(auth);
    expect(result.status).toBe(RuntimeAuthLoweringStatus.NOT_EXPRESSIBLE_IN_U5);
  });

  it("any grant is not expressible in U5", () => {
    const auth = {
      table_rules: [
        {
          table_id: "public_data",
          action: "GRANT" as any,
          column_ids: ["public_data.id"],
          predicates: [],
        },
      ],
    };
    const result = lowerRuntimeAuthorization(auth);
    expect(result.status).toBe(RuntimeAuthLoweringStatus.NOT_EXPRESSIBLE_IN_U5);
  });

  it("mutation of policy/source/compiler/generation changes digest", () => {
    const auth = {
      table_rules: [
        {
          table_id: "orders",
          action: "DENY" as const,
          column_ids: ["orders.amount"],
          predicates: [],
        },
      ],
    };
    const authModified = {
      table_rules: [
        {
          table_id: "orders",
          action: "DENY" as const,
          column_ids: ["orders.amount", "orders.customer_id"],
          predicates: [],
        },
      ],
    };
    const result1 = lowerRuntimeAuthorization(auth);
    const result2 = lowerRuntimeAuthorization(authModified);
    const digest1 = computeRestrictionProjectionDigest(result1.loweredRules);
    const digest2 = computeRestrictionProjectionDigest(result2.loweredRules);
    expect(digest1).not.toBe(digest2);
  });
});
