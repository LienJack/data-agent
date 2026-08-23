import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve("infra/agenticdatabench/ecommerce-v1/production-suite");
const hash = (value: unknown) =>
  `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

describe("E-commerce Production Suite", () => {
  it("freezes the approved registry, difficulty, multi-table and Python distributions", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
    const publicCases = JSON.parse(await readFile(resolve(root, "public-cases.json"), "utf8"));
    const sealedCases = JSON.parse(
      await readFile(resolve(root, "sealed/sealed-cases.json"), "utf8"),
    );
    expect(manifest.case_count).toBe(24);
    expect(manifest.registry_counts).toEqual({ DEMO: 8, TUNING: 10, HOLDOUT: 6 });
    expect(manifest.difficulty_counts).toEqual({ simple: 6, moderate: 10, challenging: 8 });
    expect(manifest.hard_six_table_count).toBeGreaterThanOrEqual(6);
    expect(manifest.python_case_count).toBeGreaterThanOrEqual(8);
    expect(manifest.chart_or_report_case_count).toBeGreaterThanOrEqual(4);
    expect(hash(publicCases)).toBe(manifest.public_cases_sha256);
    expect(hash(sealedCases)).toBe(manifest.sealed_cases_sha256);
    expect(new Set(publicCases.map(({ case_id }: { case_id: string }) => case_id)).size).toBe(24);
    expect(publicCases.every((item: Record<string, unknown>) => !("gold_sql" in item))).toBe(true);
    expect(JSON.stringify(publicCases)).not.toContain("oracle_policy");
    expect(manifest.readiness).toBe("HOLD");
  });

  it("packages only public preview material into the Web image", async () => {
    const dockerfile = await readFile(resolve("infra/docker/Dockerfile.web"), "utf8");
    expect(dockerfile).toContain(
      "infra/agenticdatabench/ecommerce-v1/production-suite/public-cases.json",
    );
    expect(dockerfile).toContain(
      "infra/agenticdatabench/ecommerce-v1/production-suite/manifest.json",
    );
    expect(dockerfile).not.toContain("production-suite/sealed");
    expect(dockerfile).not.toContain("production-suite/ ");
    expect(dockerfile).toContain(
      "COPY scripts/qa-readiness-bootstrap.ts scripts/qa-readiness-bootstrap.ts",
    );
    expect(dockerfile).toContain("--roles=web");
    expect(dockerfile).toContain(
      "/app/.release-build-identities/web.json /app/runtime-build-identity/web.json",
    );
    expect(dockerfile).not.toContain(
      "/app/.release-build-identities/attestation.json /app/runtime-build-identity",
    );
  });
});
