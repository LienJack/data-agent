import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");

function source(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

const modelControlSymbols =
  /listActiveModels|listModels|applyModelCommand|listProviderConnections|recordModelAuthentication/;
const commercialFields =
  /\b(?:price|currency|fx|credit|bill|cost|balance|hold|reservation|settlement)(?:_|\b)/i;

describe("Model Control architecture boundary", () => {
  it("keeps model contracts independent from the retiring Billing workspace", () => {
    const modelContracts = source("packages/contracts/src/models/index.ts");
    const billingContracts = source("packages/contracts/src/workspaces/billing.ts");

    expect(modelContracts).not.toMatch(commercialFields);
    expect(billingContracts).not.toMatch(
      /globalModelCredentialRefSchema|modelProviderConnectionSchema|modelCatalogEntrySchema/,
    );
  });

  it("keeps model persistence out of the retiring Pricing repository", () => {
    expect(source("packages/platform/src/models/postgres-model-control.ts")).not.toMatch(
      commercialFields,
    );
    expect(source("packages/platform/src/pricing/postgres-pricing-control.ts")).not.toMatch(
      modelControlSymbols,
    );
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
