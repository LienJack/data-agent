import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ids = {
  workspace: "00000000-0000-4000-8000-000000008101",
  impact: "00000000-0000-8000-8000-000000008102",
  release: "00000000-0000-4000-8000-000000008103",
} as const;
const hash = `sha256:${"a".repeat(64)}`;
const calls = vi.hoisted(() => ({
  runtime: [] as unknown[],
  get: [] as unknown[],
  serviceValue: null as unknown,
}));

vi.mock("@/lib/workspace-request", () => ({
  workspaceErrorResponse: (error: unknown) => NextResponse.json({ error }, { status: 400 }),
}));

vi.mock("@/lib/workspace-semantic-runtime", () => ({
  getWorkspaceSemanticRuntime: async (_request: unknown, options: unknown) => {
    calls.runtime.push(options);
    return {
      ok: true,
      runtime: {
        authorityResolver: {
          resolve: async (input: unknown) => ({ authority: "POSTGRESQL", input }),
        },
        service: {
          get: async (authority: unknown, input: unknown) => {
            calls.get.push({ authority, input });
            return {
              ok: true,
              value: calls.serviceValue ?? {
                schema_version: "semantic-binding-impact-safe-projection@1.0.0",
                impact_id: ids.impact,
                receipt_hash: hash,
                plan_hash: hash,
                drift_event_id: ids.release,
                release: { release_id: ids.release, generation: 3, release_digest: hash },
                status: "REVIEW_REQUIRED",
                risk_level: "HIGH",
                direct_impact_count: 2,
                transitive_impact_count: 4,
                suggested_actions: ["REVIEW_MAPPING"],
                manual_reason_codes: [],
                candidate_ref: null,
                committed_at: "2026-08-23T08:00:00.000Z",
              },
            };
          },
        },
      },
    };
  },
}));

describe("workspace semantic binding impact route", () => {
  beforeEach(() => {
    calls.runtime = [];
    calls.get = [];
    calls.serviceValue = null;
  });

  it("uses READ authority and returns only the strict safe projection", async () => {
    const route = await import(
      "../src/app/api/workspaces/[workspaceId]/semantic/binding-impacts/[impactId]/route"
    );
    const response = await route.GET(
      new NextRequest("http://localhost/api/impact?domain=commerce"),
      { params: Promise.resolve({ workspaceId: ids.workspace, impactId: ids.impact }) },
    );
    expect(response.status).toBe(200);
    expect(calls.runtime).toEqual([
      { feature: "BINDING_IMPACT", access: "READ", workspaceId: ids.workspace },
    ]);
    expect(calls.get).toEqual([
      {
        authority: {
          authority: "POSTGRESQL",
          input: { access: "READ", semanticDomain: "commerce" },
        },
        input: { semantic_domain: "commerce", impact_id: ids.impact },
      },
    ]);
    const body = await response.json();
    expect(body.meta).toEqual({ authority: "POSTGRESQL" });
    expect(JSON.stringify(body)).not.toMatch(/package|drift_payload|raw_sql|rows|dsn|provider/i);
  });

  it("rejects unknown query fields before calling the service", async () => {
    const route = await import(
      "../src/app/api/workspaces/[workspaceId]/semantic/binding-impacts/[impactId]/route"
    );
    const response = await route.GET(
      new NextRequest("http://localhost/api/impact?domain=commerce&tenantId=attacker"),
      { params: Promise.resolve({ workspaceId: ids.workspace, impactId: ids.impact }) },
    );
    expect(response.status).toBe(400);
    expect(calls.get).toEqual([]);
  });

  it("rejects invalid impact identity before calling the service", async () => {
    const route = await import(
      "../src/app/api/workspaces/[workspaceId]/semantic/binding-impacts/[impactId]/route"
    );
    const response = await route.GET(
      new NextRequest("http://localhost/api/impact?domain=commerce"),
      { params: Promise.resolve({ workspaceId: ids.workspace, impactId: "not-an-id" }) },
    );
    expect(response.status).toBe(400);
    expect(calls.get).toEqual([]);
  });

  it("fails closed when the service returns an unknown or sensitive projection field", async () => {
    calls.serviceValue = {
      schema_version: "semantic-binding-impact-safe-projection@1.0.0",
      impact_id: ids.impact,
      unexpected_detail: { hidden: true },
    };
    const route = await import(
      "../src/app/api/workspaces/[workspaceId]/semantic/binding-impacts/[impactId]/route"
    );
    const response = await route.GET(
      new NextRequest("http://localhost/api/impact?domain=commerce"),
      { params: Promise.resolve({ workspaceId: ids.workspace, impactId: ids.impact }) },
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SEMANTIC_BINDING_IMPACT_PROJECTION_INVALID" },
    });
  });
});
