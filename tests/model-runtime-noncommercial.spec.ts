import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");

function source(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

const monetaryRuntimeField =
  /\b(?:UNBILLABLE|MODEL_COST_BUDGET_NOT_SATISFIED|max_cost_budget|max_cost_micros|cost_micros|total_cost_micros|amount_micros)\b|\bpricing\s*:/;

describe("noncommercial model runtime", () => {
  it("removes the legacy Billing provider gates from source and package exports", () => {
    for (const path of [
      "packages/platform/src/billing/billing-gated-model-provider.ts",
      "packages/platform/src/billing/billing-gated-provider.ts",
    ]) {
      expect(existsSync(resolve(repoRoot, path)), path).toBe(false);
    }
    expect(source("packages/platform/src/index.ts")).not.toMatch(
      /billing-gated-(?:model-)?provider/,
    );
  });

  it("keeps provider profiles, routing and Model Control technical-only", () => {
    for (const path of [
      "packages/contracts/src/providers/index.ts",
      "packages/contracts/src/models/index.ts",
      "packages/agent-runtime/src/models/router.ts",
      "packages/agent-runtime/src/models/errors.ts",
      "packages/agent-runtime/src/models/system-deployments.ts",
    ]) {
      expect(source(path), path).not.toMatch(monetaryRuntimeField);
    }
  });

  it("keeps Test Center and Eval usage free of monetary budgets and projections", () => {
    for (const path of [
      "packages/contracts/src/evals/test-center.ts",
      "packages/contracts/src/evals/index.ts",
      "packages/contracts/src/evals/manifest.ts",
      "packages/evals/src/test-center/model-analysis-agent.ts",
      "packages/evals/src/test-center/model-sql-agent.ts",
      "packages/evals/src/test-center/model-multiple-choice-agent.ts",
      "packages/evals/src/test-center/model-provider-usage.ts",
    ]) {
      expect(source(path), path).not.toMatch(monetaryRuntimeField);
    }
  });

  it("keeps Web, Worker and semantic provider composition independent of monetary readiness", () => {
    for (const path of [
      "apps/web/src/lib/test-center-model-runtime.ts",
      "apps/web/src/lib/semantic-candidate-service.ts",
      "apps/web/src/cli/bootstrap-qa-readiness.ts",
      "apps/worker/src/semantic/authoring-model-runtime.ts",
      "apps/worker/src/providers/production-run-bound-provider-dispatcher.ts",
      "apps/worker/src/system-model-certification-cli.ts",
    ]) {
      expect(source(path), path).not.toMatch(monetaryRuntimeField);
    }
  });
});
