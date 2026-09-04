import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const migration = readFileSync(
  resolve(
    repositoryRoot,
    "infra/supabase/apps/data-agent/migrations/20260725010822_app_data_agent_falcon24_four_layer_manifest_v7.sql",
  ),
  "utf8",
);
const checksum =
  /^-- falcon24_four_layer_manifest_v7_migration_checksum: sha256:([0-9a-f]{64})$/mu.exec(
    migration,
  )?.[1] ?? "";

describe("10822 Falcon24 four-layer manifest v7", () => {
  it("is rendered, checksummed, and based on exact 10821", () => {
    expect(checksum).toMatch(/^[0-9a-f]{64}$/u);
    expect(migration.split(checksum)).toHaveLength(3);
    expect(
      createHash("sha256")
        .update(migration.replaceAll(checksum, "0".repeat(64)))
        .digest("hex"),
    ).toBe(checksum);
    expect(migration).toContain("20260725010821_app_data_agent_falcon24_four_layer_manifest_v6");
    expect(migration).toContain(
      "sha256:45ef931314cee147e536635310b30e958cbe3a4e8fa230d338f45e3f3fde74fc",
    );
    expect(migration).toContain("917200d4c497842d35b5ddaa1aeed15412c31f655338b56187918e87964a7848");
  });

  it("adds only the exact v7 bank while retaining v1 through v6", () => {
    for (const version of ["1.0.0", "2.0.0", "3.0.0", "4.0.0", "5.0.0", "6.0.0", "7.0.0"]) {
      expect(migration).toContain(`falcon24-four-layer-gate-manifest@${version}`);
    }
    for (const turnsHash of [
      "sha256:c01c7944368ebdd0ae9fb2e69c9b809cb0cb24a2de65076da934e95a23c396e9",
      "sha256:4ecf4742d2f8a201b3abe9609177441a0672a629becb4f58a23c18b7c7251142",
      "sha256:bc9fdac88acf23889beabeb2ae2c6f49d3df93d72c02d87ab1fde023e434564a",
      "sha256:1b197368096673c1015935308f2db4a4fcddb0f3cc04c73b627cd7ce4d97503f",
      "sha256:040e238b038f8ec2d246f553ac26a1d7abc6067f152e4106f7aca93859c6d55c",
      "sha256:959a850d482cd49fb8840da0a2f7c0cdc1a788bcbe1f00430bbd591afd07b22a",
      "sha256:df80081985d2a65f2ea161bb079a8b2a1dfa2930a90090493f3be6f640032795",
    ]) {
      expect(migration).toContain(turnsHash);
    }
    expect(migration).toContain("FALCON24_FOUR_LAYER_MANIFEST_V7_REWRITE_DRIFT");
  });

  it("preserves history and the existing RPC security boundary", () => {
    expect(migration).toContain("falcon24_10822_history_snapshot");
    expect(migration).toContain("FALCON24_FOUR_LAYER_MANIFEST_V7_HISTORY_DRIFT");
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
