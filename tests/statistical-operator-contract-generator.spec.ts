import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeStatisticalOperatorManifestDigest,
  parseStatisticalOperatorManifest,
  renderStatisticalOperatorContract,
} from "../scripts/generate-statistical-operator-contracts.js";

const repositoryRoot = resolve(import.meta.dirname, "..");
const manifestPath = resolve(repositoryRoot, "services/sandbox/src/data_agent_stats/manifest.json");
const generatedPath = resolve(
  repositoryRoot,
  "packages/contracts/src/generated/statistical-operators.ts",
);
const runtimeProbePath = resolve(repositoryRoot, "scripts/verify-opensandbox-analysis-runtime.ts");
const manifestText = readFileSync(manifestPath, "utf8");

describe("statistical operator contract generator", () => {
  it("keeps the generated projection byte-identical to the sole manifest", () => {
    const manifest = parseStatisticalOperatorManifest(manifestText);
    expect(manifest.operators).toHaveLength(8);
    expect(readFileSync(generatedPath, "utf8")).toBe(
      renderStatisticalOperatorContract(manifestText),
    );
    expect(computeStatisticalOperatorManifestDigest(manifestText)).toMatch(
      /^sha256:[a-f0-9]{64}$/u,
    );
    const python = spawnSync(
      "python3",
      [
        "-c",
        "import hashlib,sys; print('sha256:' + hashlib.sha256(open(sys.argv[1], 'rb').read()).hexdigest())",
        manifestPath,
      ],
      { encoding: "utf8" },
    );
    expect(python.status).toBe(0);
    expect(python.stdout.trim()).toBe(computeStatisticalOperatorManifestDigest(manifestText));
  });

  it("rejects duplicate IDs and compatibility metadata", () => {
    const duplicate = JSON.parse(manifestText) as {
      operators: Array<Record<string, unknown>>;
    };
    duplicate.operators[1] = {
      ...duplicate.operators[1],
      operator_id: duplicate.operators[0]?.operator_id,
    };
    expect(() => parseStatisticalOperatorManifest(`${JSON.stringify(duplicate)}\n`)).toThrow(
      /operator_id 重复/u,
    );

    for (const forbidden of ["aliases", "overwrite", "fallback"] as const) {
      const candidate = JSON.parse(manifestText) as {
        operators: Array<Record<string, unknown>>;
      };
      candidate.operators[0] = { ...candidate.operators[0], [forbidden]: [] };
      expect(() => parseStatisticalOperatorManifest(`${JSON.stringify(candidate)}\n`)).toThrow();
    }
  });

  it("changes the source digest for any manifest mutation", () => {
    const changed = JSON.parse(manifestText) as {
      operators: Array<Record<string, unknown>>;
    };
    changed.operators[0] = {
      ...changed.operators[0],
      description_zh: "已改变的定义",
    };
    const changedSource = `${JSON.stringify(changed)}\n`;
    parseStatisticalOperatorManifest(changedSource);
    expect(computeStatisticalOperatorManifestDigest(changedSource)).not.toBe(
      computeStatisticalOperatorManifestDigest(manifestText),
    );
  });

  it("binds the runtime probe to the generated registry digest", () => {
    const runtimeProbe = readFileSync(runtimeProbePath, "utf8");
    expect(runtimeProbe).toContain(
      'import { STATISTICAL_OPERATOR_REGISTRY_DIGEST } from "../packages/contracts/src/generated/statistical-operators.js";',
    );
    expect(runtimeProbe).toContain("const REGISTRY_DIGEST = STATISTICAL_OPERATOR_REGISTRY_DIGEST;");
    expect(runtimeProbe).not.toMatch(/const REGISTRY_DIGEST\s*=\s*"sha256:/u);
  });

  it("allows the runtime probe endpoint mode to match Worker reachability", () => {
    const runtimeProbe = readFileSync(runtimeProbePath, "utf8");
    expect(runtimeProbe).not.toContain("OPENSANDBOX_LOCAL_PROBE_DIRECT_ENDPOINT_REQUIRED");
    expect(runtimeProbe).toContain('endpoint_mode: useServerProxy ? "SERVER_PROXY" : "DIRECT"');
  });
});
