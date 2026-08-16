import { describe, expect, it } from "vitest";
import { providerExecutionProfileSchema } from "../src/workspaces/qa-resources.js";

const hash = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const base = {
  model_profile_id: "10000000-0000-4000-8000-000000000001",
  model_config_version: 7,
  resource_hash: hash("1"),
  profile_version: "model-profile@7",
  provider: "deepseek",
  model_id: "deepseek-v4-flash",
  display_name: "DeepSeek V4 Flash",
} as const;

describe("U3 provider execution profile catalog", () => {
  it.each([
    ["CERTIFICATION_REQUIRED", "MODEL_CERTIFICATION_REQUIRED"],
    ["CREDENTIAL_UNAVAILABLE", "MODEL_CREDENTIAL_UNAVAILABLE"],
    ["CONTEXT_WINDOW_UNVERIFIED", "MODEL_CONTEXT_WINDOW_UNVERIFIED"],
    ["DISABLED", "MODEL_PROFILE_DISABLED"],
    ["STALE", "MODEL_PROFILE_STALE"],
  ] as const)("projects %s without fake certification fields", (readiness, reason) => {
    expect(
      providerExecutionProfileSchema.parse({
        ...base,
        readiness,
        selectable: false,
        unavailable_reason: reason,
      }),
    ).not.toHaveProperty("certification_receipt_ref");
    expect(
      providerExecutionProfileSchema.safeParse({
        ...base,
        readiness,
        selectable: true,
        unavailable_reason: reason,
      }).success,
    ).toBe(false);
  });

  it("requires complete technical authority only for AVAILABLE", () => {
    const available = {
      ...base,
      adapter_version: "model-provider-adapter@1.0.0",
      certification_receipt_ref: {
        artifact_id: "10000000-0000-4000-8000-000000000002",
        artifact_type: "ModelCertificationReceipt",
        app_id: "10000000-0000-4000-8000-000000000003",
        tenant_id: "10000000-0000-4000-8000-000000000004",
        environment: "test",
        run_id: "10000000-0000-4000-8000-000000000005",
        revision: 1,
        content_hash: hash("2"),
      },
      execution_profile_hash: hash("3"),
      recovery_capabilities: ["INVOCATION_RECONCILIATION"],
      connection: {
        kind: "SYSTEM_DEPLOYMENT",
        deployment_id: "10000000-0000-4000-8000-000000000006",
        deployment_revision: 2,
        deployment_hash: hash("4"),
      },
      effective_context_ceiling_tokens: 8_000,
      effective_output_ceiling_tokens: 2_000,
      readiness: "AVAILABLE",
      selectable: true,
      unavailable_reason: null,
    } as const;
    expect(providerExecutionProfileSchema.safeParse(available).success).toBe(true);
    expect(
      providerExecutionProfileSchema.safeParse({
        ...available,
        profile_version: "model-profile@8",
      }).success,
    ).toBe(false);
    const { certification_receipt_ref: _receipt, ...missing } = available;
    expect(providerExecutionProfileSchema.safeParse(missing).success).toBe(false);
  });
});
