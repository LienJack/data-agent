import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010638_app_data_agent_semantic_graph_v2.sql",
);
const migration = readFileSync(migrationPath, "utf8");

describe("10638 Semantic Graph v2 migration", () => {
  it("creates immutable graph, node, edge and release-bound projection surfaces", () => {
    expect(migration).toContain("create table semantic.semantic_graph_projection");
    expect(migration).toContain("create table semantic.semantic_graph_node_projection");
    expect(migration).toContain("create table semantic.semantic_graph_edge_projection");
    expect(migration).toContain("create table semantic.semantic_source_release_graph_projection");
    expect(migration).toContain(
      "unique (app_id, tenant_id, environment, semantic_domain, source_revision_id, compiler_version)",
    );
    expect(migration).not.toMatch(/edge_type\s+text[^;]+check\s*\(edge_type\s+in/is);
  });

  it("forces RLS and denies backend direct table access", () => {
    for (const table of [
      "semantic_graph_projection",
      "semantic_graph_node_projection",
      "semantic_graph_edge_projection",
      "semantic_source_release_graph_projection",
    ]) {
      expect(migration).toContain(`alter table semantic.${table} force row level security`);
      expect(migration).toContain(`revoke all on table semantic.${table} from data_agent_backend`);
    }
    expect(migration).not.toMatch(
      /grant\s+(?:select|insert|update|delete)[^;]+to\s+data_agent_backend/is,
    );
  });

  it("exposes only hardened scoped RPCs and rejects embedded Metric bindings", () => {
    for (const functionName of [
      "commit_semantic_graph_projection",
      "get_semantic_graph_projection",
      "bind_semantic_graph_release",
    ]) {
      expect(migration).toContain(`create function semantic.${functionName}`);
      expect(migration).toContain("security definer\nset search_path = ''");
      expect(migration).toContain(`grant execute on function semantic.${functionName}`);
    }
    expect(migration).toContain(
      "node.value ?| array['table_id', 'column_id', 'formula', 'dependency_node_ids']",
    );
    expect(migration).toContain("v_release_source_revision_id <> v_projection.source_revision_id");
  });
});
