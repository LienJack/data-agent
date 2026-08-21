import { describe, expect, it } from "vitest";
import {
  buildSemanticCandidateSelfPublishCommand,
  semanticManualEditSchema,
  verifySemanticCandidateSelfPublishCommand,
} from "../src/artifacts/semantic-authoring-workflow.js";
import { sha256ContentHash } from "../src/common/index.js";

const id = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

describe("semantic explicit revision workflow contracts", () => {
  it("accepts a governed edge-type proposal but rejects system-managed physical attributes", () => {
    const proposal = {
      operation: "ADD_EDGE_TYPE",
      edge_type_definition: {
        edge_type: "FULFILLED_BY",
        display_name: "由履约主体完成",
        family: "BUSINESS",
        source_node_types: ["BUSINESS_SUBJECT"],
        target_node_types: ["BUSINESS_SUBJECT"],
        direction: "DIRECTED",
        parallel_policy: "FORBID",
        authoring_policy: "AGENT_AUTHORED",
        attribute_kind: "BUSINESS_RELATION",
      },
    };
    expect(semanticManualEditSchema.parse(proposal)).toEqual(proposal);
    expect(
      semanticManualEditSchema.safeParse({
        ...proposal,
        edge_type_definition: {
          ...proposal.edge_type_definition,
          attribute_kind: "PHYSICAL_FACT",
        },
      }).success,
    ).toBe(false);
  });

  it("binds self-review publishing to exact candidate, source and compiled projections", async () => {
    const bundleHash = await sha256ContentHash({ bundle: "v1" });
    const executable = { sourceDigest: bundleHash, metrics: [] };
    const relationship = { sourceDigest: bundleHash, edges: [] };
    const restriction = { sourceDigest: bundleHash, lowered: {} };
    const sourceDigest = await sha256ContentHash({ graph: "v2" });
    const command = await buildSemanticCandidateSelfPublishCommand({
      schema_version: "semantic-candidate-self-publish-command@1.0.0",
      command_id: id("1"),
      scope: { app_id: id("2"), tenant_id: id("3"), environment: "test" },
      semantic_domain: "ecommerce",
      principal_id: id("4"),
      candidate_id: id("5"),
      candidate_revision_id: id("6"),
      revision_number: 1,
      source_revision_id: id("7"),
      source_graph_digest: sourceDigest,
      base_release_id: id("8"),
      graph_projection_id: id("9"),
      graph_projection: {
        projection_version: "semantic-graph-projection@1",
        graph_id: id("10"),
        source_digest: sourceDigest,
        registry_digest: await sha256ContentHash({ registry: "v1" }),
        compiler_version: "semantic-graph-compiler@2.0.0",
        node_count: 0,
        edge_count: 0,
        nodes: [],
        edges: [],
      },
      executable_projection_id: id("11"),
      executable_projection_hash: await sha256ContentHash(executable),
      executable_projection: executable,
      relationship_projection_id: id("12"),
      relationship_projection_hash: await sha256ContentHash(relationship),
      relationship_projection: relationship,
      runtime_restriction_projection_id: id("13"),
      runtime_restriction_projection_hash: await sha256ContentHash(restriction),
      runtime_restriction_projection: restriction,
      compiler_bundle_digest: bundleHash,
      review_reason: "创建者审核通过",
      idempotency_key: id("14"),
      reviewed_at: "2026-08-22T00:00:00.000Z",
    });
    await expect(verifySemanticCandidateSelfPublishCommand(command)).resolves.toEqual(command);
    await expect(
      verifySemanticCandidateSelfPublishCommand({ ...command, revision_number: 2 }),
    ).rejects.toThrow("SEMANTIC_CANDIDATE_SELF_PUBLISH_HASH_MISMATCH");
  });
});
