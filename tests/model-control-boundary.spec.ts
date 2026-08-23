import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");

function source(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

const commercialFields =
  /\b(?:price|currency|fx|credit|bill|cost|balance|hold|reservation|settlement)(?:_|\b)/i;

describe("Model Control architecture boundary", () => {
  it("keeps model contracts independent after Billing retirement", () => {
    const modelContracts = source("packages/contracts/src/models/index.ts");

    expect(modelContracts).not.toMatch(commercialFields);
    expect(existsSync(resolve(repoRoot, "packages/contracts/src/workspaces/billing.ts"))).toBe(
      false,
    );
  });

  it("keeps model persistence independent after Pricing retirement", () => {
    expect(source("packages/platform/src/models/postgres-model-control.ts")).not.toMatch(
      commercialFields,
    );
    expect(
      existsSync(resolve(repoRoot, "packages/platform/src/pricing/postgres-pricing-control.ts")),
    ).toBe(false);
  });

  it("routes model administration through Model Control only", () => {
    const admin = source("apps/web/src/lib/model-control-admin.ts");
    const routes = [
      "apps/web/src/app/api/admin/model-certifications/route.ts",
      "apps/web/src/app/api/admin/model-providers/route.ts",
      "apps/web/src/app/api/admin/models/route.ts",
      "apps/web/src/app/api/models/route.ts",
    ].map(source);

    expect(admin).toContain("getModelControlRepository");
    expect(admin).not.toMatch(/Pricing|Billing|getPricingControlRepository/);
    for (const route of routes) {
      expect(route).not.toMatch(/pricing-admin|getPricingControlRepository/);
    }
  });
});
