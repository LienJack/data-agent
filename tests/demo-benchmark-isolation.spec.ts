import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "..");

function productionSources(directory: string, excluded: readonly string[] = []): string {
  return readdirSync(directory)
    .flatMap((name) => {
      const path = resolve(directory, name);
      if (excluded.includes(path) || name === "dist" || name === "test") return [];
      if (statSync(path).isDirectory()) return [productionSources(path, excluded)];
      return /\.(?:ts|tsx)$/u.test(name) ? [readFileSync(path, "utf8")] : [];
    })
    .join("\n");
}

describe("Demo and benchmark production isolation", () => {
  it("keeps E-commerce business constants and SQL out of generic Worker and Platform source", () => {
    const genericWorker = productionSources(resolve(repositoryRoot, "apps/worker/src"), [
      resolve(repositoryRoot, "apps/worker/src/evals"),
    ]);
    const platform = productionSources(resolve(repositoryRoot, "packages/platform/src"));
    for (const source of [genericWorker, platform]) {
      expect(source).not.toMatch(/SALES_REPORT|demo_adb_ecommerce_mart/u);
      expect(source).not.toMatch(/delivery_delay_days\s*>=\s*100|abs\(mom_pct\)\s*>=\s*50/u);
      expect(source).not.toMatch(/sales_amount_brl[^\n]*BRL/u);
    }
  });

  it("keeps the capability in the explicit Evals and Worker adapter boundaries", () => {
    const capability = readFileSync(
      resolve(repositoryRoot, "packages/evals/src/ecommerce-direct-qa/index.ts"),
      "utf8",
    );
    const adapter = readFileSync(
      resolve(repositoryRoot, "apps/worker/src/evals/ecommerce-direct-qa-adapter.ts"),
      "utf8",
    );
    expect(capability).toContain("SALES_REPORT");
    expect(capability).toContain("demo_adb_ecommerce_mart");
    expect(adapter).toContain("createEcommerceDirectQaAdapter");
  });
});
