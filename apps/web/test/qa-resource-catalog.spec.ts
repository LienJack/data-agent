import type { ProviderExecutionProfile } from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildQaResourceCatalog } from "../src/lib/qa-resource-catalog";

const ids = {
  app: "30000000-0000-4000-8000-000000000001",
  workspace: "30000000-0000-4000-8000-000000000002",
  profile: "30000000-0000-4000-8000-000000000003",
  certification: "30000000-0000-4000-8000-000000000004",
  run: "30000000-0000-4000-8000-000000000005",
  deployment: "30000000-0000-4000-8000-000000000006",
} as const;

const hash = (value: string) => `sha256:${value.repeat(64)}` as const;

function availableProfile(
  modelId = "deepseek-v4-flash",
): Extract<ProviderExecutionProfile, { readiness: "AVAILABLE" }> {
  return {
    model_profile_id: ids.profile,
    model_config_version: 3,
    resource_hash: hash("a"),
    profile_version: "model-profile@3",
    provider: "deepseek",
    model_id: modelId,
    display_name: "DeepSeek V4 Flash",
    adapter_version: "model-provider-adapter@1.0.0",
    certification_receipt_ref: {
      artifact_id: ids.certification,
      artifact_type: "ModelCertificationReceipt",
      app_id: ids.app,
      tenant_id: ids.workspace,
      environment: "test",
      run_id: ids.run,
      revision: 1,
      content_hash: hash("b"),
    },
    execution_profile_hash: hash("c"),
    recovery_capabilities: ["AT_LEAST_ONCE_ONLY"],
    connection: {
      kind: "SYSTEM_DEPLOYMENT",
      deployment_id: ids.deployment,
      deployment_revision: 2,
      deployment_hash: hash("d"),
    },
    effective_context_ceiling_tokens: 16_000,
    effective_output_ceiling_tokens: 4_000,
    readiness: "AVAILABLE",
    selectable: true,
    unavailable_reason: null,
  };
}

describe("Q&A resource catalog", () => {
  it("projects an Authority-approved execution profile without private or commercial fields", () => {
    const catalog = buildQaResourceCatalog({ models: [availableProfile()], datasources: [] });

    expect(catalog.models).toEqual([
      {
        model_profile_id: ids.profile,
        config_version: 3,
        profile_version: "model-profile@3",
        provider: "deepseek",
        model_id: "deepseek-v4-flash",
        display_name: "DeepSeek V4 Flash",
        certification_receipt_ref: availableProfile().certification_receipt_ref,
        api_authentication_state: "NOT_CERTIFIED",
        effective_context_ceiling_tokens: 16_000,
        effective_output_ceiling_tokens: 4_000,
        readiness: "AVAILABLE",
        selectable: true,
      },
    ]);
    expect(JSON.stringify(catalog)).not.toMatch(/credential|pricing|billing|credit/iu);
  });

  it("projects another Authority-approved model without applying smoke-only model restrictions", () => {
    const catalog = buildQaResourceCatalog({
      models: [availableProfile("deepseek-v4-pro")],
      datasources: [],
    });

    expect(catalog.models).toEqual([
      expect.objectContaining({
        model_id: "deepseek-v4-pro",
        readiness: "AVAILABLE",
        selectable: true,
      }),
    ]);
  });

  it("projects the Authority-approved recovery semantics instead of reinterpreting them in Web", () => {
    const statusQuery = {
      ...availableProfile(),
      recovery_capabilities: ["INVOCATION_STATUS_QUERY"],
    } as const satisfies ProviderExecutionProfile;
    const catalog = buildQaResourceCatalog({ models: [statusQuery], datasources: [] });

    expect(catalog.models).toEqual([
      expect.objectContaining({
        model_id: "deepseek-v4-flash",
        readiness: "AVAILABLE",
        selectable: true,
      }),
    ]);
  });

  it("projects a second Authority-approved provider without applying DeepSeek smoke restrictions", () => {
    const kimi = {
      ...availableProfile(),
      provider: "kimi",
      model_id: "kimi-k3",
      display_name: "Kimi K3",
    } as const satisfies ProviderExecutionProfile;
    const catalog = buildQaResourceCatalog({ models: [kimi], datasources: [] });

    expect(catalog.models).toEqual([
      expect.objectContaining({
        provider: "kimi",
        model_id: "kimi-k3",
        readiness: "AVAILABLE",
        selectable: true,
      }),
    ]);
  });

  it("projects an Authority-approved managed profile without re-authorizing its connection in Web", () => {
    const managed = {
      ...availableProfile(),
      connection: {
        kind: "MANAGED_CONNECTION",
        provider_connection_id: ids.deployment,
        config_version: 1,
        connection_hash: hash("d"),
      },
    } as const satisfies ProviderExecutionProfile;
    const catalog = buildQaResourceCatalog({ models: [managed], datasources: [] });

    expect(catalog.models).toEqual([
      expect.objectContaining({
        provider: "deepseek",
        model_id: "deepseek-v4-flash",
        readiness: "AVAILABLE",
        selectable: true,
      }),
    ]);
  });

  it("makes a configured profile selectable without certification", () => {
    const unavailable = {
      model_profile_id: ids.profile,
      model_config_version: 4,
      resource_hash: hash("a"),
      profile_version: "model-profile@4",
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      display_name: "DeepSeek V4 Flash",
      readiness: "CERTIFICATION_REQUIRED",
      selectable: false,
      unavailable_reason: "MODEL_CERTIFICATION_REQUIRED",
    } as const satisfies ProviderExecutionProfile;

    expect(buildQaResourceCatalog({ models: [unavailable], datasources: [] }).models).toEqual([
      expect.objectContaining({
        readiness: "AVAILABLE",
        selectable: true,
        certification_receipt_ref: null,
        effective_context_ceiling_tokens: null,
        effective_output_ceiling_tokens: null,
      }),
    ]);
  });

  it("ignores historical API authentication when deciding direct-call availability", () => {
    const unavailable = {
      model_profile_id: ids.profile,
      model_config_version: 4,
      resource_hash: hash("a"),
      profile_version: "model-profile@4",
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      display_name: "DeepSeek V4 Flash",
      readiness: "CERTIFICATION_REQUIRED",
      selectable: false,
      unavailable_reason: "MODEL_CERTIFICATION_REQUIRED",
    } as const satisfies ProviderExecutionProfile;

    const catalog = buildQaResourceCatalog({
      models: [unavailable],
      datasources: [],
    });

    expect(catalog.models).toEqual([
      expect.objectContaining({
        readiness: "AVAILABLE",
        selectable: true,
        api_authentication_state: "NOT_CERTIFIED",
        certification_receipt_ref: null,
      }),
    ]);
  });

  it("keeps a profile without a server credential unavailable", () => {
    const unavailable = {
      model_profile_id: ids.profile,
      model_config_version: 4,
      resource_hash: hash("a"),
      profile_version: "model-profile@4",
      provider: "deepseek",
      model_id: "deepseek-v4-flash",
      display_name: "DeepSeek V4 Flash",
      readiness: "CREDENTIAL_UNAVAILABLE",
      selectable: false,
      unavailable_reason: "MODEL_CREDENTIAL_UNAVAILABLE",
    } as const satisfies ProviderExecutionProfile;

    expect(buildQaResourceCatalog({ models: [unavailable], datasources: [] }).models).toEqual([
      expect.objectContaining({
        readiness: "CREDENTIAL_UNAVAILABLE",
        selectable: false,
        api_authentication_state: "NOT_CERTIFIED",
      }),
    ]);
  });
});
