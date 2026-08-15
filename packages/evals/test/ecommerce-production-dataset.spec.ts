import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadEcommerceProductionPreview,
  loadEcommerceProductionSqlDataset,
} from "../src/test-center/index.js";

const fixtureRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../infra/agenticdatabench/ecommerce-v1/production-suite",
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("E-commerce production preview dataset", () => {
  it("exposes all 24 public cases with real PostgreSQL table schemas while remaining HOLD", async () => {
    const dataset = await loadEcommerceProductionPreview(fixtureRoot);
    expect(dataset.readiness).toBe("HOLD");
    expect(dataset.public_cases).toHaveLength(24);
    expect(dataset.public_cases.filter((testCase) => testCase.registry === "HOLDOUT")).toHaveLength(
      6,
    );
    expect(
      dataset.public_cases.filter((testCase) => testCase.difficulty === "challenging"),
    ).toHaveLength(8);
    expect(
      dataset.public_cases.filter((testCase) => testCase.capabilities.includes("PYTHON_ANALYSIS")),
    ).toHaveLength(8);
    expect(dataset.public_cases[6]?.schema).toHaveLength(6);
    expect(
      dataset.public_cases[6]?.schema.find((table) => table.name === "fact_order")?.columns,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ name: "delivery_delay_days" })]));
    expect(JSON.stringify(dataset.public_cases)).not.toContain("gold_sql");
    expect(JSON.stringify(dataset.public_cases)).not.toContain("oracle_policy");
  });

  it("fails closed when a public case changes without regenerating its digests", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ecommerce-preview-"));
    temporaryDirectories.push(directory);
    await cp(fixtureRoot, directory, { recursive: true });
    const path = join(directory, "public-cases.json");
    const cases = JSON.parse(await readFile(path, "utf8")) as Array<Record<string, unknown>>;
    cases[0] = { ...cases[0], question: "tampered" };
    await writeFile(path, JSON.stringify(cases));
    await expect(loadEcommerceProductionPreview(directory)).rejects.toThrow(
      "ECOMMERCE_PRODUCTION_PREVIEW_DIGEST_MISMATCH",
    );
  });

  it("loads sealed SQL only through the server dataset and binds every Gold to its public case", async () => {
    const dataset = await loadEcommerceProductionSqlDataset(fixtureRoot);
    expect(dataset.sealed_cases).toHaveLength(24);
    expect(dataset.database_path).toBe("postgresql://demo_adb_ecommerce_mart");
    expect(dataset.sealed_cases[3]?.public_case.case_id).toBe(
      "ec100000-0000-4000-8000-000000000004",
    );
    expect(dataset.sealed_cases[3]?.gold_sql).toContain("demo_adb_ecommerce_mart.fact_order_item");
  });

  it("fails closed when sealed Gold changes without regenerating its digests", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ecommerce-sealed-"));
    temporaryDirectories.push(directory);
    await cp(fixtureRoot, directory, { recursive: true });
    const path = join(directory, "sealed/sealed-cases.json");
    const cases = JSON.parse(await readFile(path, "utf8")) as Array<Record<string, unknown>>;
    cases[0] = { ...cases[0], gold_sql: "select 1" };
    await writeFile(path, JSON.stringify(cases));
    await expect(loadEcommerceProductionSqlDataset(directory)).rejects.toThrow(
      "ECOMMERCE_PRODUCTION_SEALED_DIGEST_MISMATCH",
    );
  });
});
