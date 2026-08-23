import { describe, expect, it } from "vitest";
import {
  buildTeamProviderDispatchEnvelope,
  verifyTeamProviderDispatchEnvelope,
} from "../src/mastra/provider-dispatch-envelope.js";

const input = {
  schema_version: "team-provider-dispatch-envelope@2.0.0",
  task_id: "00000000-0000-4000-8000-000000000001",
  attempt_id: "00000000-0000-4000-8000-000000000002",
  worker_fence: 7,
  profile_id: "governed-text2sql-agent",
  profile_revision: 1,
  profile_hash: `sha256:${"1".repeat(64)}`,
  model_config_version: 3,
  context_epoch_id: "00000000-0000-4000-8000-000000000003",
  context_build_signature: `sha256:${"2".repeat(64)}`,
  projection_receipt_hash: `sha256:${"3".repeat(64)}`,
  final_messages_hash: `sha256:${"4".repeat(64)}`,
  tool_schemas_hash: `sha256:${"5".repeat(64)}`,
  attachments_hash: `sha256:${"6".repeat(64)}`,
  effective_input_ceiling: 10_000,
  effective_output_ceiling: 2_000,
  trusted_input_token_upper_bound: 1_500,
  token_bound_policy_version: "utf8-byte-upper-bound@1.0.0",
} as const;

describe("Team provider dispatch envelope", () => {
  it("hashes the final post-middleware wire and verifies exact authority", async () => {
    const envelope = await buildTeamProviderDispatchEnvelope(input);
    expect(await verifyTeamProviderDispatchEnvelope(envelope, input)).toEqual(envelope);
    expect(envelope.dispatch_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("fails before transport on post-middleware mutation or capacity drift", async () => {
    const envelope = await buildTeamProviderDispatchEnvelope(input);
    await expect(
      verifyTeamProviderDispatchEnvelope(envelope, {
        ...input,
        final_messages_hash: `sha256:${"7".repeat(64)}`,
      }),
    ).rejects.toThrow("TEAM_PROVIDER_DISPATCH_MISMATCH");
    await expect(
      buildTeamProviderDispatchEnvelope({
        ...input,
        trusted_input_token_upper_bound: 10_001,
      }),
    ).rejects.toThrow();
  });

  it("strictly rejects raw messages, prompts and transport headers", async () => {
    await expect(
      buildTeamProviderDispatchEnvelope({ ...input, messages: [{ role: "user" }] }),
    ).rejects.toThrow();
  });
});
