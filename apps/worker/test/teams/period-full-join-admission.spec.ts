import type { Text2SqlQueryCandidate } from "@data-agent/contracts/agents";
import {
  assertPostgresqlQueryTemporalSelection,
  resolvePostgresqlRequestDerivedBindings,
} from "@data-agent/platform/datasource-adapters";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPostgresqlText2SqlQueryRuntime,
  type PreparedText2SqlContext,
} from "../../src/teams/postgresql-text2sql-query-runtime.js";

vi.mock("@data-agent/platform/datasource-adapters", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@data-agent/platform/datasource-adapters")>()),
  resolvePostgresqlRequestDerivedBindings: vi.fn(),
  assertPostgresqlQueryTemporalSelection: vi.fn(),
}));

// Only the proof port is substituted. The actual parameterizer/firewall and
// Worker compilation path execute; Platform separately proves the full SQL.
const candidate: Text2SqlQueryCandidate = {
  schema_version: "text2sql-query-candidate@1.0.0",
  sql: "WITH c AS (SELECT o.amount AS v FROM public.orders AS o), p AS (SELECT o.amount AS v FROM public.orders AS o) SELECT c.v AS value FROM c AS c FULL JOIN p AS p ON c.v=p.v",
  parameters: [],
  result_columns: [
    {
      name: "value",
      label: "value",
      semantic_type: "NUMBER",
      semantic_binding: { object_kind: "METRIC", object_id: "metric.revenue" },
    },
  ],
  time_window: null,
  presentation: { title: "test", summary: "test", visualization: "TABLE", x_key: null, y_keys: [] },
};
const prepared: PreparedText2SqlContext = {
  context_text: "{}",
  datasource_id: "00000000-0000-4000-8000-000000000001",
  schema_snapshot_id: "00000000-0000-4000-8000-000000000002",
  schema_snapshot_hash: `sha256:${"a".repeat(64)}`,
  target_capability_hash: `sha256:${"b".repeat(64)}`,
  reader_role: "test_reader",
  semantic_query_context_hash: null,
  allowed_relations: ["public.orders"],
  binding_authority: {} as never,
};

describe("complete-period proof to SQL firewall admission", () => {
  beforeEach(() => vi.resetAllMocks());
  it.each(["BOTH_PERIOD_GROUPS", "CURRENT_PERIOD_GROUPS", "no-proof", "proof-failed"])(
    "takes the permission only from the proof: %s",
    async (scope) => {
      const connect = vi.fn();
      const runtime = createPostgresqlText2SqlQueryRuntime({
        pool: { connect } as never,
        capability: {},
        schema_snapshots: {} as never,
        datasources: {} as never,
        secrets: {} as never,
      });
      const proof = vi.mocked(resolvePostgresqlRequestDerivedBindings);
      if (scope === "proof-failed") proof.mockRejectedValue(new TypeError("PROOF_REJECTED"));
      else
        proof.mockResolvedValue(
          scope === "no-proof"
            ? []
            : ([
                {
                  column: {
                    request_derivation: { period_comparison: { group_coverage: scope } },
                  },
                },
              ] as Awaited<ReturnType<typeof resolvePostgresqlRequestDerivedBindings>>),
        );
      const compile = runtime.compileCandidate({ prepared, candidate });
      if (scope === "BOTH_PERIOD_GROUPS") {
        const accepted = await compile;
        expect(accepted.sql).toContain("FULL JOIN");
        expect(proof.mock.calls[0]?.[0].candidate).toEqual(accepted);
        expect(assertPostgresqlQueryTemporalSelection).toHaveBeenCalledOnce();
      } else
        await expect(compile).rejects.toMatchObject(
          scope === "proof-failed"
            ? { message: "PROOF_REJECTED" }
            : { diagnostic_code: "TEXT2SQL_SQL_JOIN_SHAPE_REJECTED" },
        );
      expect(connect).not.toHaveBeenCalled();
    },
  );
});
