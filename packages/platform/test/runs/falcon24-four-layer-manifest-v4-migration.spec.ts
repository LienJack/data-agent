import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migration = readFileSync(
  resolve(
    repositoryRoot,
    "infra/supabase/apps/data-agent/migrations/20260725010819_app_data_agent_falcon24_four_layer_manifest_v4.sql",
  ),
  "utf8",
);
const checksum =
  /^-- falcon24_four_layer_manifest_v4_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1] ?? "";

describe("10819 Falcon24 four-layer manifest v4", () => {
  it("is rendered, checksummed, and based on exact 10818", () => {
    expect(checksum).toMatch(/^[0-9a-f]{64}$/u);
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain("20260725010818_app_data_agent_falcon24_four_layer_manifest_v3");
    expect(migration).toContain(
      "sha256:f177f7550090b2ab0502599fbe1fccb3ef117088efd8d2941aa2304d7ae7fe7d",
    );
  });

  it("adds only the exact v4 bank while retaining v1, v2, and v3", () => {
    expect(migration).toContain("falcon24-four-layer-gate-manifest@1.0.0");
    expect(migration).toContain("falcon24-four-layer-gate-manifest@2.0.0");
    expect(migration).toContain("falcon24-four-layer-gate-manifest@3.0.0");
    expect(migration).toContain("falcon24-four-layer-gate-manifest@4.0.0");
    expect(migration).toContain(
      "sha256:c01c7944368ebdd0ae9fb2e69c9b809cb0cb24a2de65076da934e95a23c396e9",
    );
    expect(migration).toContain(
      "sha256:4ecf4742d2f8a201b3abe9609177441a0672a629becb4f58a23c18b7c7251142",
    );
    expect(migration).toContain(
      "sha256:bc9fdac88acf23889beabeb2ae2c6f49d3df93d72c02d87ab1fde023e434564a",
    );
    expect(migration).toContain(
      "sha256:1b197368096673c1015935308f2db4a4fcddb0f3cc04c73b627cd7ce4d97503f",
    );
    expect(migration).toContain("FALCON24_FOUR_LAYER_MANIFEST_V4_REWRITE_DRIFT");
  });

  it("preserves history and the existing RPC security boundary", () => {
    expect(migration).toContain("falcon24_10819_history_snapshot");
    expect(migration).toContain("FALCON24_FOUR_LAYER_MANIFEST_V4_HISTORY_DRIFT");
    expect(migration).not.toMatch(
      /(?:update|delete from) app_data_agent\.falcon24_four_layer_gate_/iu,
    );
    expect(migration).toContain(
      "alter function app_data_agent.begin_falcon24_four_layer_gate(jsonb)",
    );
    expect(migration).toContain("owner to data_agent_u6_rpc_owner");
    expect(migration).toContain("from public");
    expect(migration).toContain("to data_agent_backend");
  });
});
