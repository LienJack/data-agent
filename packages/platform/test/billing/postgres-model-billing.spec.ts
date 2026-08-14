import { describe, expect, it } from "vitest";
import { createPostgresModelBillingRepository } from "../../src/billing/postgres-model-billing.js";

const deployment = "00000000-0000-4000-8000-000000006001";
const principal = "00000000-0000-4000-8000-000000006002";

describe("PostgreSQL model billing repository", () => {
  it("rejects client authority fields before touching PostgreSQL", async () => {
    let touched = false;
    const repository = createPostgresModelBillingRepository({
      async connect() {
        touched = true;
        throw new Error("unexpected");
      },
    });
    const result = await repository.authorize(
      { deployment_id: deployment, principal_id: principal },
      { schema_version: "model-billing-authorize@1.0.0", role: "SUPER_ADMIN" },
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "MODEL_BILLING_INPUT_INVALID",
        message: "模型计费命令不符合严格契约。",
        retryable: false,
      },
    });
    expect(touched).toBe(false);
  });

  it("uses only the narrow personal bill function", async () => {
    const queries: string[] = [];
    const repository = createPostgresModelBillingRepository({
      async connect() {
        return {
          async query(text: string) {
            queries.push(text);
            return { rows: [], rowCount: 0 };
          },
          release() {},
        };
      },
    });
    expect(
      await repository.listOwnBills({ deployment_id: deployment, principal_id: principal }),
    ).toEqual({ ok: true, value: [] });
    expect(queries).toEqual([
      "select result from platform.list_own_model_bills($1::uuid,$2::uuid) as result",
    ]);
  });
});
