import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sha256ContentHash } from "../packages/contracts/src/common/index.js";
import {
  buildFalcon24FourLayerManifestTurns,
  FALCON24_FOUR_LAYER_GATE_MANIFEST_VERSION,
  FALCON24_FOUR_LAYER_LEGACY_GATE_MANIFEST_VERSION,
} from "../packages/contracts/src/evals/falcon24-four-layer-gate.js";

const migration = readFileSync(
  new URL(
    "../infra/supabase/apps/data-agent/migrations/20260725010817_app_data_agent_falcon24_four_layer_manifest_v2.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Falcon24 four-layer manifest v2 forward migration", () => {
  it("binds each accepted schema version to its exact frozen turn hash", async () => {
    const v1Hash = await sha256ContentHash(
      await buildFalcon24FourLayerManifestTurns(FALCON24_FOUR_LAYER_LEGACY_GATE_MANIFEST_VERSION),
    );
    const v2Hash = await sha256ContentHash(
      await buildFalcon24FourLayerManifestTurns(FALCON24_FOUR_LAYER_GATE_MANIFEST_VERSION),
    );

    expect(v1Hash).toBe("sha256:c01c7944368ebdd0ae9fb2e69c9b809cb0cb24a2de65076da934e95a23c396e9");
    expect(v2Hash).toBe("sha256:4ecf4742d2f8a201b3abe9609177441a0672a629becb4f58a23c18b7c7251142");
    expect(migration).toContain(FALCON24_FOUR_LAYER_LEGACY_GATE_MANIFEST_VERSION);
    expect(migration).toContain(FALCON24_FOUR_LAYER_GATE_MANIFEST_VERSION);
    expect(migration).toContain(v1Hash);
    expect(migration).toContain(v2Hash);
    expect(migration).toContain("or not ((manifest->>'schema_version'");
  });

  it("changes only the begin RPC and preserves history, owner, and narrow execution grants", () => {
    expect(migration).toContain(
      "create or replace function app_data_agent.begin_falcon24_four_layer_gate(command jsonb)",
    );
    expect(migration).toContain("FALCON24_FOUR_LAYER_MANIFEST_V2_HISTORY_DRIFT");
    expect(migration).toContain("owner to data_agent_u6_rpc_owner");
    expect(migration).toContain(
      "revoke all on function app_data_agent.begin_falcon24_four_layer_gate(jsonb) from public",
    );
    expect(migration).toContain(
      "grant execute on function app_data_agent.begin_falcon24_four_layer_gate(jsonb)",
    );
    expect(migration.match(/create or replace function/gu)).toHaveLength(1);
    expect(migration).not.toMatch(/drop\s+(?:table|function)/iu);
  });
});
