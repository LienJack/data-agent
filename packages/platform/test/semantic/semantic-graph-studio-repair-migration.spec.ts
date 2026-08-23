import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migrationPath = resolve(
  repositoryRoot,
  "infra/supabase/apps/data-agent/migrations/20260725010693_app_data_agent_semantic_graph_studio_digest_repair.sql",
);
const migration = readFileSync(migrationPath, "utf8");

describe("10693 Semantic Graph Studio digest repair", () => {
  it("compares the projection payload digest with the graph-content digest", () => {
    expect(migration).toContain(
      "v_projection.projection_payload ->> 'source_digest' is distinct from v_projection.source_digest",
    );
    expect(migration).not.toContain(
      "v_projection.projection_payload ->> 'source_digest' is distinct from v_source.source_digest",
    );
  });

  it("keeps revision, binding, storage, graph identity and source-version checks fail closed", () => {
    for (const check of [
      "v_source.source_digest is distinct from v_binding.source_revision_digest",
      "v_projection.source_revision_id is distinct from v_binding.source_revision_id",
      "v_projection.source_digest is distinct from v_binding.source_digest",
      "v_projection.projection_storage_digest is distinct from v_binding.projection_storage_digest",
      "v_projection.projection_payload ->> 'graph_id' is distinct from v_source.source_payload #>> '{metadata,graph_id}'",
      "v_source.source_payload #>> '{metadata,graph_version}' <> 'semantic-graph-source@2'",
    ]) {
      expect(migration).toContain(check);
    }
    expect(migration).toContain("SEMANTIC_GRAPH_STUDIO_SOURCE_BINDING_MISMATCH");
  });
});
