import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");

const retiredPaths = [
  "packages/contracts/src/workspaces/billing.ts",
  "packages/platform/src/billing",
  "packages/platform/src/pricing",
  "apps/worker/src/pricing",
  "apps/web/src/lib/billing-ui.ts",
  "apps/web/src/lib/billing-ui-policy.ts",
  "apps/web/src/lib/credit-admin.ts",
  "apps/web/src/lib/model-billing-admin.ts",
  "apps/web/src/lib/pricing-admin.ts",
  "apps/web/src/components/settings/credit-ledger-panel.tsx",
  "apps/web/src/components/settings/model-billing-panel.tsx",
  "apps/web/src/components/settings/pricing-control-panel.tsx",
  "apps/web/src/app/admin/pricing",
  "apps/web/src/app/api/billing",
  "apps/web/src/app/api/admin/billing",
  "apps/web/src/app/api/admin/credits",
  "apps/web/src/app/api/admin/fx",
  "apps/web/src/app/api/admin/prices",
] as const;

function source(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function productionSources(root: string): readonly string[] {
  const found: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if ([".ts", ".tsx"].includes(extname(entry.name))) found.push(path);
    }
  };
  visit(resolve(repoRoot, root));
  return found;
}

describe("Billing code retirement", () => {
  it("removes every product, API, repository and Worker surface", () => {
    for (const path of retiredPaths) {
      expect(existsSync(resolve(repoRoot, path)), path).toBe(false);
    }
  });

  it("removes commercial authorities from package roots and Web composition", () => {
    expect(source("packages/contracts/src/workspaces/index.ts")).not.toMatch(/\.\/billing\.js/);
    expect(source("packages/platform/src/index.ts")).not.toMatch(/\.\/(?:billing|pricing)\//);
    expect(source("apps/worker/src/index.ts")).not.toMatch(/\.\/pricing\//);
    expect(source("apps/web/src/lib/workspace-identity.ts")).not.toMatch(
      /get(?:PricingControl|CreditLedger|ModelBilling)Repository/,
    );
  });

  it("keeps settings and workspace navigation noncommercial", () => {
    const navigation = [
      "apps/web/src/app/settings/page.tsx",
      "apps/web/src/components/settings/operations-admin-panel.tsx",
      "apps/web/src/components/workspaces/workspace-home.tsx",
      "apps/web/src/lib/workspace-navigation.ts",
    ]
      .map(source)
      .join("\n");

    expect(navigation).not.toMatch(/计费|账单|积分|余额|价格|汇率|\/admin\/pricing/);
  });

  it("has no commercial authority identifiers in production TypeScript", () => {
    const production = [
      ...productionSources("apps/web/src"),
      ...productionSources("apps/worker/src"),
      ...productionSources("packages/contracts/src"),
      ...productionSources("packages/platform/src"),
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(production).not.toMatch(
      /(?:PricingControl|CreditLedger|ModelBilling|BillingMode|FxRate|Microcredits|BILLING_REVIEW|PRICING_MANAGE|CREDIT_MANAGE)/,
    );
  });
});
