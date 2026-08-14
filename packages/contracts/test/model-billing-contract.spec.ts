import { describe, expect, it } from "vitest";
import {
  billingModeDecisionInputSchema,
  modelBillingAuthorizeInputSchema,
  modelBillingFinalizeInputSchema,
  modelBillingReviewInputSchema,
} from "../src/workspaces/billing.js";

const id = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

describe("model billing contracts", () => {
  const authorization = {
    schema_version: "model-billing-authorize@1.0.0",
    operation_id: id("1"),
    idempotency_key: "model-billing-authorize-1",
    bill_id: id("2"),
    invocation_id: id("3"),
    reservation_id: id("4"),
    workspace_id: id("5"),
    run_id: id("6"),
    conversation_id: null,
    datasource_id: id("7"),
    model_profile_id: id("8"),
    expected_model_config_version: 3,
    request_budget: {
      input_tokens: "1000",
      output_tokens: "200",
      cache_read_tokens: "0",
      cache_write_tokens: "0",
      tool_calls: "2",
    },
    expected_account_version: 1,
  } as const;

  it("accepts only server-safe identifiers and string usage amounts", () => {
    expect(modelBillingAuthorizeInputSchema.parse(authorization)).toEqual(authorization);
    expect(
      modelBillingAuthorizeInputSchema.safeParse({
        ...authorization,
        funding_type: "SYSTEM_FUNDED",
      }).success,
    ).toBe(false);
    expect(
      modelBillingAuthorizeInputSchema.safeParse({
        ...authorization,
        request_budget: { ...authorization.request_budget, input_tokens: 1000 },
      }).success,
    ).toBe(false);
  });

  it("requires outcome usage references only for usage-bearing terminal kinds", () => {
    const completed = {
      schema_version: "model-billing-finalize@1.0.0",
      operation_id: id("9"),
      idempotency_key: "model-billing-finalize-1",
      bill_id: id("2"),
      terminal_kind: "COMPLETED",
      outcome_usage_record_id: id("10"),
    } as const;
    expect(modelBillingFinalizeInputSchema.parse(completed)).toEqual(completed);
    expect(
      modelBillingFinalizeInputSchema.safeParse({ ...completed, role: "SUPER_ADMIN" }).success,
    ).toBe(false);
  });

  it("keeps review and mode decisions explicit and reasoned", () => {
    expect(
      modelBillingReviewInputSchema.parse({
        schema_version: "model-billing-review@1.0.0",
        operation_id: id("11"),
        idempotency_key: "model-billing-review-1",
        bill_id: id("2"),
        decision: "RELEASE",
        verified_usage: null,
        reason: "provider confirmed no charge",
      }).decision,
    ).toBe("RELEASE");
    expect(
      billingModeDecisionInputSchema.safeParse({
        schema_version: "billing-mode-decision@1.0.0",
        operation_id: id("12"),
        idempotency_key: "billing-mode-decision-1",
        target_mode: "ENFORCED",
        expected_epoch: 1,
        reason: "",
      }).success,
    ).toBe(false);
  });
});
