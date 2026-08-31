import { createHash } from "node:crypto";
import {
  buildProductTeamArtifactDocument,
  buildQueryEvidenceSemanticBinding,
} from "@data-agent/contracts/artifacts";
import { describe, expect, it } from "vitest";
import { governedInputDatetimeTimezones } from "../../src/analysis/governed-analysis-input.js";
import {
  governedInputBindingIdentity,
  openSandboxAnalysisRuntimeInternals,
} from "../../src/runs/opensandbox-analysis-runtime.js";
import { monthlyComparisonFixture } from "./support/monthly-comparison-fixture.js";

describe("accepted input datetime representation", () => {
  it.each(["DATE", "DATETIME"] as const)(
    "projects only an accepted DATETIME dimension, not %s calendar values",
    async (logical_type) => {
      const f = await monthlyComparisonFixture();
      const { binding_hash: _hash, ...draft } = f.binding;
      const binding = await buildQueryEvidenceSemanticBinding({
        ...draft,
        columns: draft.columns.map((c) => (c.output_name === "month" ? { ...c, logical_type } : c)),
      });
      const document = await buildProductTeamArtifactDocument({
        ...f.document,
        provenance: { ...f.document.provenance, semantic_binding: binding },
      });
      const input = {
        format: "ARROW" as const,
        query_evidence_ref: document.artifact_ref as typeof f.reference,
        query_evidence_document: document,
      };
      expect(await governedInputDatetimeTimezones(input)).toEqual(
        logical_type === "DATETIME" ? [{ column_name: "month", timezone: "Asia/Shanghai" }] : [],
      );
      expect(await governedInputDatetimeTimezones({ ...input, format: "JSON" })).toEqual([]);
      const corrupted = structuredClone(document);
      if (corrupted.provenance?.kind !== "GOVERNED_QUERY_RESULT") throw Error("BINDING_REQUIRED");
      const window = corrupted.provenance.semantic_binding.time_window;
      if (!window) throw Error("WINDOW_REQUIRED");
      window.timezone = "America/New_York";
      await expect(
        governedInputDatetimeTimezones({ ...input, query_evidence_document: corrupted }),
      ).rejects.toThrow();
    },
  );
  it("binds timezone representation into identity while preserving legacy no-projection identity", () => {
    const input = {
      input_name: "query_evidence",
      content_sha256: `sha256:${"a".repeat(64)}` as const,
    };
    const suffix = createHash("sha256")
      .update([input.input_name, input.content_sha256].join("\0"))
      .digest("hex")
      .slice(0, 24);
    expect(governedInputBindingIdentity(input).input_symbol).toBe(`__da_input_${suffix}`);
    expect(governedInputBindingIdentity({ ...input, datetime_timezones: [] })).toEqual(
      governedInputBindingIdentity(input),
    );
    const sh = governedInputBindingIdentity({
      ...input,
      datetime_timezones: [{ column_name: "month", timezone: "Asia/Shanghai" }],
    });
    const ny = governedInputBindingIdentity({
      ...input,
      datetime_timezones: [{ column_name: "month", timezone: "America/New_York" }],
    });
    expect(sh).not.toEqual(ny);
    expect(sh).not.toEqual(governedInputBindingIdentity(input));
    expect(() =>
      governedInputBindingIdentity({
        ...input,
        datetime_timezones: [{ column_name: "month", timezone: "not/a-zone" }],
      }),
    ).toThrow();
    expect(() =>
      governedInputBindingIdentity({
        ...input,
        datetime_timezones: [
          { column_name: "month", timezone: "UTC" },
          { column_name: "month", timezone: "Asia/Shanghai" },
        ],
      }),
    ).toThrow();
  });
  it("keeps byte verification before time representation and exposes no derived answer", () => {
    const source = openSandboxAnalysisRuntimeInternals.buildGovernedInputBindingSource({
      input_path: "/workspace/input.arrow",
      input_symbol: "__da_input_aaaaaaaaaaaaaaaaaaaaaaaa",
      content_sha256: `sha256:${"a".repeat(64)}`,
      format: "ARROW",
      max_bytes: 1024,
      datetime_timezones: [{ column_name: "month", timezone: "Asia/Shanghai" }],
    });
    expect(source.indexOf("ANALYSIS_GOVERNED_INPUT_BINDING_HASH_MISMATCH")).toBeLessThan(
      source.indexOf(".dt.tz_convert"),
    );
    expect(source).toContain('errors="raise", utc=True');
    expect(source).toContain("ANALYSIS_GOVERNED_INPUT_TIMEZONE_COLUMN_MISSING");
    expect(source).not.toContain("2024-");
    expect(source).not.toContain("measure_1");
  });
});
