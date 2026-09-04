import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migration = readFileSync(
  resolve(
    repositoryRoot,
    "infra/supabase/apps/data-agent/migrations/20260725010818_app_data_agent_falcon24_four_layer_manifest_v3.sql",
  ),
  "utf8",
);
const checksum =
  /^-- falcon24_four_layer_manifest_v3_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1] ?? "";

describe("10818 Falcon24 four-layer manifest v3", () => {
  it("is rendered, checksummed, and based on exact 10817", () => {
    expect(checksum).toMatch(/^[0-9a-f]{64}$/u);
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain("20260725010817_app_data_agent_falcon24_four_layer_manifest_v2");
    expect(migration).toContain(
      "sha256:92054489f6fd488d4e587679865c3ec6c7f17ded4992b81a8f37cf1b6e5f4fb6",
    );
  });

  it("adds only the exact v3 bank while retaining v1 and v2", () => {
    expect(migration).toContain("falcon24-four-layer-gate-manifest@1.0.0");
    expect(migration).toContain("falcon24-four-layer-gate-manifest@2.0.0");
    expect(migration).toContain("falcon24-four-layer-gate-manifest@3.0.0");
    expect(migration).toContain(
      "sha256:c01c7944368ebdd0ae9fb2e69c9b809cb0cb24a2de65076da934e95a23c396e9",
    );
    expect(migration).toContain(
      "sha256:4ecf4742d2f8a201b3abe9609177441a0672a629becb4f58a23c18b7c7251142",
    );
    expect(migration).toContain(
      "sha256:bc9fdac88acf23889beabeb2ae2c6f49d3df93d72c02d87ab1fde023e434564a",
    );
    expect(migration).toContain("FALCON24_FOUR_LAYER_MANIFEST_V3_REWRITE_DRIFT");
  });

  it("preserves history and the existing RPC security boundary", () => {
    expect(migration).toContain("falcon24_10818_history_snapshot");
    expect(migration).toContain("FALCON24_FOUR_LAYER_MANIFEST_V3_HISTORY_DRIFT");
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
