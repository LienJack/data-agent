import { describe, expect, it } from "vitest";
import {
  createGovernedAgentDataProjectionReceipt,
  inspectProviderTaskProjection,
} from "../../src/providers/provider-data-projector.internal.js";

const id = (suffix: string) => `89000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64)}` as const;

describe("package-private Provider data projector", () => {
  it("rejects a structural clone that did not pass the deterministic DLP projector", async () => {
    const inspected = inspectProviderTaskProjection({
      question: "查询已治理收入",
      allowed_audiences: ["PRIVATE"],
    });
    if (!inspected.ok) throw new Error(inspected.error.code);

    const result = await createGovernedAgentDataProjectionReceipt({
      inspected: { ...inspected.value } as never,
      scope: { app_id: id("1"), tenant_id: id("2"), environment: "test" },
      run_id: id("3"),
      request_id: id("4"),
      principal_id: id("5"),
      model_execution_profile_hash: hash("a"),
      task_ref: {
        artifact_id: id("6"),
        artifact_type: "ProviderTaskArtifact",
        app_id: id("1"),
        tenant_id: id("2"),
        environment: "test",
        run_id: id("3"),
        revision: 1,
        content_hash: hash("b"),
      },
      classification: "RESTRICTED",
      payload_hash: hash("c"),
      token_bound_policy_version: "utf8-byte-upper-bound@1.0.0",
      trusted_input_token_upper_bound: 128,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_DATA_PROJECTION_NOT_AUTHORIZED" },
    });
  });

  it("requires PRIVATE data audience authority and rejects credential material", () => {
    expect(
      inspectProviderTaskProjection({
        question: "普通问题",
        allowed_audiences: ["WORKSPACE"],
      }),
    ).toMatchObject({ ok: false, error: { code: "PROVIDER_EGRESS_DENIED" } });
    expect(
      inspectProviderTaskProjection({
        question: "authorization=Bearer-secret-value",
        allowed_audiences: ["PRIVATE"],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "PROVIDER_DATA_PROJECTION_DLP_REJECTED" },
    });
    for (const question of [
      '{"api_key":"sensitive-value"}',
      '{\\"api_key\\":\\"sensitive-value\\"}',
      "Bearer abcdefghijklmnopqrstuvwxyz",
      "-----BEGIN PRIVATE KEY-----",
      "api   _   key = sensitive-value",
    ]) {
      expect(
        inspectProviderTaskProjection({ question, allowed_audiences: ["PRIVATE"] }),
      ).toMatchObject({
        ok: false,
        error: { code: "PROVIDER_DATA_PROJECTION_DLP_REJECTED" },
      });
    }
  });
});
