import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import {
  computeSemanticRelationshipGraphManifestDigest,
  semanticRelationshipGraphManifestMaterialSchema,
  semanticRelationshipGraphManifestSchema,
  semanticRelationshipIndexCheckpointSchema,
  semanticRelationshipSearchRequestSchema,
} from "../packages/contracts/src/index.js";
import { createNeo4jRelationshipGraphAdapter } from "../packages/platform/src/index.js";

const configSchema = z.strictObject({
  uri: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  database: z.string().min(1),
  node_count: z.number().int().min(10_000).max(100_000),
  iterations: z.number().int().min(10).max(100),
});
const BUDGETS_MS = {
  neo4j_warm_search_p95: 300,
  service_candidate_hydration_p95: 1_500,
  ui_interaction_p95: 100,
} as const;

function percentile(values: readonly number[], percentileValue: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)] ?? 0;
}

function hash(material: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(material).digest("hex")}`;
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableUuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function environmentValue(name: string): string | undefined {
  const value = Reflect.get(process.env, name);
  return typeof value === "string" ? value : undefined;
}

async function main(): Promise<void> {
  const config = configSchema.parse({
    uri: environmentValue("NEO4J_BENCHMARK_URI") ?? "bolt://127.0.0.1:7687",
    username: environmentValue("NEO4J_BENCHMARK_USERNAME") ?? "neo4j",
    password: environmentValue("NEO4J_BENCHMARK_PASSWORD"),
    database: environmentValue("NEO4J_BENCHMARK_DATABASE") ?? "neo4j",
    node_count: Number(environmentValue("SEMANTIC_RELATIONSHIP_BENCHMARK_NODES") ?? 10_000),
    iterations: Number(environmentValue("SEMANTIC_RELATIONSHIP_BENCHMARK_ITERATIONS") ?? 25),
  });
  const ids = {
    app: randomUUID(),
    tenant: randomUUID(),
    release: randomUUID(),
    principal: randomUUID(),
    executable: randomUUID(),
    relationship: randomUUID(),
    restriction: randomUUID(),
    datasource: randomUUID(),
    attempt: randomUUID(),
    build: randomUUID(),
  };
  const scope = { app_id: ids.app, tenant_id: ids.tenant, environment: "benchmark" };
  const releaseIdentity = {
    semantic_domain: "benchmark",
    release_id: ids.release,
    release_generation: 1,
    release_digest: hash("release"),
    executable_projection: {
      projection_id: ids.executable,
      projection_digest: hash("executable"),
    },
    relationship_projection: {
      projection_id: ids.relationship,
      projection_digest: hash("relationship"),
    },
    runtime_restriction_projection: {
      projection_id: ids.restriction,
      projection_digest: hash("restriction"),
    },
    published_at: "2026-08-09T00:00:00.000Z",
    published_by: ids.principal,
  };
  const nodes = Array.from({ length: config.node_count }, (_, index) => ({
    node_type: "governance_object" as const,
    node_key: hash(`node-key:${index}`),
    canonical_digest: hash(`node:${index}`),
    name: `Benchmark Node ${index}`,
    governance_kind: "relationship_projection" as const,
    governance_id: stableUuid(index + 1),
    release_id: ids.release,
    release_generation: 1,
    digest: hash(`node:${index}`),
  }));
  const categories = ["BIZ", "JOIN", "FORMULA", "BIND", "GOVERN"] as const;
  const byCategory = { BIZ: 0, JOIN: 0, FORMULA: 0, BIND: 0, GOVERN: 0 };
  const edges = Array.from({ length: config.node_count - 1 }, (_, index) => {
    const category = categories[index % categories.length] ?? "GOVERN";
    byCategory[category] += 1;
    const contract =
      category === "BIZ"
        ? { category, relationship_type: "benchmark" }
        : category === "JOIN"
          ? { category, relationship_id: `benchmark_join_${index}` }
          : category === "FORMULA"
            ? {
                category,
                dependency_kind: "metric_dependency" as const,
                formula_id: `benchmark_formula_${index}`,
              }
            : category === "BIND"
              ? { category, datasource_id: ids.datasource }
              : {
                  category,
                  governance_relation: "PROJECTION_GOVERNS_OBJECT" as const,
                  projection_kind: "relationship_projection" as const,
                };
    return {
      edge_key: hash(`edge-key:${index}`),
      edge_id: `benchmark_edge_${index}`,
      category,
      source_node_key: nodes[index]?.node_key ?? hash("missing-source"),
      target_node_key: nodes[index + 1]?.node_key ?? hash("missing-target"),
      canonical_digest: hash(`edge:${index}`),
      label: `${category} · benchmark`,
      contract,
    };
  });
  const material = semanticRelationshipGraphManifestMaterialSchema.parse({
    schema_version: "semantic-relationship-graph-manifest@1.0.0",
    scope,
    semantic_domain: "benchmark",
    release_identity: releaseIdentity,
    relationship_projection_digest: releaseIdentity.relationship_projection.projection_digest,
    nodes: [...nodes].sort((left, right) => stableCompare(left.node_key, right.node_key)),
    edges: [...edges].sort((left, right) =>
      stableCompare(
        `${left.category}\u0000${left.edge_key}`,
        `${right.category}\u0000${right.edge_key}`,
      ),
    ),
    counts: {
      total_nodes: nodes.length,
      semantic_nodes: 0,
      governance_nodes: nodes.length,
      total_edges: edges.length,
      by_category: byCategory,
    },
  });
  const manifest = semanticRelationshipGraphManifestSchema.parse({
    ...material,
    manifest_digest: await computeSemanticRelationshipGraphManifestDigest(material),
  });
  const checkpoint = semanticRelationshipIndexCheckpointSchema.parse({
    schema_version: "semantic-relationship-index-checkpoint@1.0.0",
    semantic_domain: "benchmark",
    release_identity: releaseIdentity,
    state: "READY",
    attempt_id: ids.attempt,
    attempt_fence: 1,
    build_id: ids.build,
    manifest_digest: manifest.manifest_digest,
    relationship_projection_digest: manifest.relationship_projection_digest,
    node_count: manifest.counts.total_nodes,
    edge_count: manifest.counts.total_edges,
    reason_code: null,
    observed_at: "2026-08-09T00:01:00.000Z",
    indexed_at: "2026-08-09T00:01:00.000Z",
  });
  const request = semanticRelationshipSearchRequestSchema.parse({
    schema_version: "semantic-relationship-search-request@1.0.0",
    semantic_domain: "benchmark",
    release: { kind: "HISTORICAL", release_id: ids.release },
    root: null,
    term: `Benchmark Node ${Math.floor(config.node_count / 2)}`,
    categories: [...categories],
    direction: "both",
    hop_limit: 6,
    node_limit: 250,
    edge_limit: 500,
  });
  const adapter = createNeo4jRelationshipGraphAdapter({
    uri: config.uri,
    username: config.username,
    password: config.password,
    database: config.database,
    batch_size: 1_000,
  });
  try {
    await adapter.initialize();
    await adapter.stageBuild({ build_id: ids.build, manifest });
    await adapter.verifyAndSeal({ build_id: ids.build, manifest });
    await adapter.search({ scope, checkpoint, request });

    const searchTimes: number[] = [];
    const hydrationTimes: number[] = [];
    const uiTimes: number[] = [];
    const nodeByKey = new Map(manifest.nodes.map((node) => [node.node_key, node]));
    const edgeByKey = new Map(manifest.edges.map((edge) => [edge.edge_key, edge]));
    for (let index = 0; index < config.iterations; index += 1) {
      const searchStarted = performance.now();
      const slice = await adapter.search({ scope, checkpoint, request });
      searchTimes.push(performance.now() - searchStarted);

      const hydratedNodes = slice.node_keys.map((key) => nodeByKey.get(key)).filter(Boolean);
      const hydratedEdges = slice.edge_keys.map((key) => edgeByKey.get(key)).filter(Boolean);
      if (
        hydratedNodes.length !== slice.node_keys.length ||
        hydratedEdges.length !== slice.edge_keys.length
      ) {
        throw new Error("Benchmark candidate hydration mismatch.");
      }
      hydrationTimes.push(performance.now() - searchStarted);

      const uiStarted = performance.now();
      const scale = 1 + (index % 5) * 0.1;
      for (let nodeIndex = 0; nodeIndex < hydratedNodes.length; nodeIndex += 1) {
        const x = ((nodeIndex * 37) % 920) * scale;
        const y = ((nodeIndex * 53) % 560) * scale;
        if (!Number.isFinite(x + y)) throw new Error("Benchmark layout invalid.");
      }
      uiTimes.push(performance.now() - uiStarted);
      global.gc?.();
    }
    const observed = {
      neo4j_warm_search_p95: percentile(searchTimes, 0.95),
      service_candidate_hydration_p95: percentile(hydrationTimes, 0.95),
      ui_interaction_p95: percentile(uiTimes, 0.95),
    };
    const passed = Object.entries(BUDGETS_MS).every(
      ([name, budget]) => observed[name as keyof typeof observed] <= budget,
    );
    console.info(
      JSON.stringify(
        {
          benchmark: "semantic-relationship-index@1",
          adapter: "neo4j",
          node_count: manifest.counts.total_nodes,
          edge_count: manifest.counts.total_edges,
          iterations: config.iterations,
          budgets_ms: BUDGETS_MS,
          observed_ms: observed,
          passed,
        },
        null,
        2,
      ),
    );
    if (!passed) process.exitCode = 1;
  } finally {
    await adapter.cleanup({ scope, semantic_domain: "benchmark", keep_release_ids: [] });
    await adapter.close();
  }
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      benchmark: "semantic-relationship-index@1",
      passed: false,
      code: error instanceof z.ZodError ? "BENCHMARK_CONFIG_INVALID" : "BENCHMARK_FAILED",
    }),
  );
  process.exitCode = 1;
});
