import { describe, expect, it } from "vitest";
import {
  compileOntologyPackagePreview,
  validateOntologyPackageCandidate,
} from "../src/graph-v2/ontology-package.js";
import { createOntologyPackageFixture } from "./fixtures/ontology-package.js";

describe("Ontology Package compiler and validator", () => {
  it("keeps optional unresolved objects in the candidate and out of the runtime preview", async () => {
    const candidate = await createOntologyPackageFixture();
    const validation = await validateOntologyPackageCandidate(candidate);
    const preview = await compileOntologyPackagePreview(candidate);

    expect(validation.valid).toBe(true);
    expect(candidate.objects.some((entry) => entry.resolution === "UNRESOLVED")).toBe(true);
    expect(preview.mandatory_object_ids).toEqual(candidate.mandatory_manifest.node_object_ids);
    expect(preview.runtime_queryable_object_ids).not.toContain(candidate.dimensions[0]?.object_id);
    expect(preview.knowledge_only_object_ids).toContain(candidate.dimensions[0]?.object_id);
  });

  it("produces a stable compiler digest when canonical arrays are reordered", async () => {
    const candidate = await createOntologyPackageFixture();
    const first = await compileOntologyPackagePreview(candidate);
    const second = await compileOntologyPackagePreview({
      ...candidate,
      objects: [...candidate.objects].reverse(),
      graph_source: {
        ...candidate.graph_source,
        nodes: [...candidate.graph_source.nodes].reverse(),
      },
    });
    expect(second.compiler_digest).toBe(first.compiler_digest);
  });

  it("fails closed on a tampered package hash", async () => {
    const candidate = await createOntologyPackageFixture();
    const validation = await validateOntologyPackageCandidate({
      ...candidate,
      package_hash: `sha256:${"f".repeat(64)}`,
    });
    expect(validation.valid).toBe(false);
    expect(validation.issues.map((entry) => entry.code)).toContain("PACKAGE_HASH_INVALID");
  });

  it("surfaces existing Graph v2 structural failures", async () => {
    const candidate = await createOntologyPackageFixture();
    const validation = await validateOntologyPackageCandidate({
      ...candidate,
      graph_source: {
        ...candidate.graph_source,
        edges: [
          {
            edge_id: "dangling",
            edge_version: 1,
            edge_type: "HAS_DIMENSION",
            family: "ANALYTICAL",
            source_node_id: "subject-order",
            target_node_id: "missing-node",
            lifecycle: "ACTIVE",
            attributes: { kind: "NONE" },
            evidence_refs: [],
          },
        ],
      },
    });
    expect(validation.valid).toBe(false);
    expect(validation.issues.some((entry) => entry.code === "GRAPH_DANGLING_EDGE")).toBe(true);
  });
});
