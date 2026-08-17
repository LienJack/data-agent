import { buildEmbeddingProfileRevision } from "@data-agent/contracts";
import { createOpenAiCompatibleEmbeddingProviderFactory } from "@data-agent/platform";
import { describe, expect, it, vi } from "vitest";

const scope = {
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: "00000000-0000-4000-8000-00000000a101",
  environment: "local",
};

async function profile() {
  return buildEmbeddingProfileRevision({
    schema_version: "embedding-profile-revision@1.0.0",
    scope,
    profile_id: "00000000-0000-4000-8000-00000000a102",
    revision: 1,
    provider: "embedding-api",
    model_id: "embed-v1",
    dimensions: 2,
    normalization: "L2",
    parser_version: "knowledge-parser@1.0.0",
    chunker_version: "knowledge-chunker@1.0.0",
    projection_policy_version: "knowledge-projection@1.0.0",
    status: "READY",
    created_at: "2026-08-17T00:00:00.000Z",
  });
}

describe("production embedding transport", () => {
  it("fails before network when the private API binding is absent", async () => {
    const network = vi.fn();
    const binding = await profile();
    const provider = createOpenAiCompatibleEmbeddingProviderFactory(
      {},
      network as typeof fetch,
    )(binding);
    const result = await provider.embed(
      {
        schema_version: "embedding-request@1.0.0",
        profile_ref: {
          profile_id: binding.profile_id,
          revision: binding.revision,
          profile_hash: binding.profile_hash,
        },
        provider: binding.provider,
        model_id: binding.model_id,
        dimensions: binding.dimensions,
        projection_receipt: {
          schema_version: "knowledge-query-projection-receipt@1.0.0",
          receipt_id: "00000000-0000-4000-8000-00000000a103",
          scope,
          knowledge_base_ref: {
            knowledge_base_id: "00000000-0000-4000-8000-00000000a104",
            revision: 1,
            revision_hash: `sha256:${"1".repeat(64)}`,
          },
          generation_ref: {
            generation_id: "00000000-0000-4000-8000-00000000a105",
            generation_revision: 1,
            generation_hash: `sha256:${"2".repeat(64)}`,
          },
          classification: "INTERNAL",
          provider: binding.provider,
          projection_policy_version: binding.projection_policy_version,
          pii_finding_count: 0,
          credential_finding_count: 0,
          prompt_injection_detected: false,
          decision: "ALLOW",
          payload_hash: `sha256:${"3".repeat(64)}`,
          projected_at: "2026-08-17T00:00:00.000Z",
          receipt_hash: `sha256:${"4".repeat(64)}`,
        },
        projected_text: "safe projected text",
      },
      new AbortController().signal,
    );
    expect(result).toMatchObject({ ok: false, error: { code: "EMBEDDING_PROVIDER_UNAVAILABLE" } });
    expect(network).not.toHaveBeenCalled();
  });
});
