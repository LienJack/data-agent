import { describe, expect, it } from "vitest";
import {
  loadFalconDevDataset,
  loadFalconPreview,
  loadFalconTestCases,
  verifyFalconBundle,
} from "../src/test-center/index.js";

describe("fixed Falcon dataset", () => {
  it("verifies all 28 bundles and immutable manifests", async () => {
    const result = await verifyFalconBundle();
    expect(result.verified_file_count).toBe(32);
    expect(result.compatibility_fixture_count).toBe(5);
    expect(result.manifest.source_commit).toBe("8ff29caaa7fad5c7b8f8864f2fc19f9f698d39a5");
  });

  it("loads 500 public cases without sealed truth", async () => {
    const dataset = await loadFalconPreview();
    expect(dataset.public_cases).toHaveLength(495);
    expect(dataset.main_demo_cases).toHaveLength(10);
    expect(dataset.smoke_cases).toHaveLength(32);
    expect(
      dataset.public_cases
        .filter((testCase) => testCase.registry === "OFFICIAL_TEST_BLIND")
        .every((testCase) => !testCase.runnable && testCase.status_reason !== null),
    ).toBe(true);
    expect(JSON.stringify(dataset.public_cases)).not.toContain("LOCAL_HOLDOUT");
    expect(
      dataset.main_demo_cases.every((testCase) => testCase.evidence?.includes("关键复合口径")),
    ).toBe(true);
    expect(JSON.stringify(dataset.public_cases)).not.toMatch(/gold_sql|expected_results/u);
  }, 30_000);

  it("keeps 309 DEV truths server-only and TEST 191 blind", async () => {
    const [dev, test] = await Promise.all([loadFalconDevDataset(), loadFalconTestCases()]);
    expect(dev.sealed_cases).toHaveLength(309);
    expect(dev.public_cases).toHaveLength(309);
    expect(JSON.stringify(dev.public_cases)).not.toContain("LOCAL_HOLDOUT");
    expect(test).toHaveLength(191);
    expect(test.every((testCase) => testCase.registry === "OFFICIAL_TEST_BLIND")).toBe(true);
  }, 30_000);
});
