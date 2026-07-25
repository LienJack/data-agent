import { describe, expect, it } from "vitest";
import {
  type AuthoritySqlPool,
  createPostgresCapabilityAuthority,
} from "../../src/tenancy/postgres-authority.js";

const row = {
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: "00000000-0000-4000-8000-00000000aa11",
  environment: "test",
  deployment_id: "00000000-0000-4000-8000-00000000de01",
  principal_id: "00000000-0000-4000-8000-000000001001",
  membership_role: "owner",
  membership_version: "1",
  app_epoch: "1",
  lifecycle_state: "ACTIVE",
  can_write: true,
};

const input = {
  deployment_id: row.deployment_id,
  tenant_id: row.tenant_id,
  principal_id: row.principal_id,
  access: "WRITE" as const,
};

function poolWith(
  handle: (
    text: string,
    values: readonly unknown[],
  ) => Promise<{
    rows: readonly (typeof row)[];
    rowCount: number;
  }>,
) {
  let connects = 0;
  let releases = 0;
  const pool: AuthoritySqlPool = {
    async connect() {
      connects += 1;
      return {
        async query<Row extends object = Record<string, unknown>>(
          text: string,
          values: readonly unknown[] = [],
        ) {
          return (await handle(text, values)) as {
            rows: readonly Row[];
            rowCount: number;
          };
        },
        release() {
          releases += 1;
        },
      };
    },
  };
  return { pool, connects: () => connects, releases: () => releases };
}

describe("PostgreSQL capability authority", () => {
  it("binds object identity and revalidates the persisted version and epoch", async () => {
    const fixture = poolWith(async () => ({ rows: [row], rowCount: 1 }));
    const authority = createPostgresCapabilityAuthority(fixture.pool);
    const resolved = await authority.resolveForServerContext(input);
    if (!resolved.ok) throw new Error(resolved.error.code);

    expect(authority.authorizer.requireRole(resolved.value, ["OWNER"], "WRITE")).toMatchObject({
      ok: true,
    });
    expect(
      authority.authorizer.requireRole({ ...resolved.value }, ["OWNER"], "WRITE"),
    ).toMatchObject({
      ok: false,
      error: { code: "APP_CAPABILITY_ISSUER_MISMATCH" },
    });
    expect(await authority.authorizer.revalidate(resolved.value, ["OWNER"], "WRITE")).toMatchObject(
      { ok: true },
    );
    expect(fixture.connects()).toBe(2);
    expect(fixture.releases()).toBe(2);
  });

  it("does not accept a caller-supplied fake query client", async () => {
    let calls = 0;
    const fixture = poolWith(async () => {
      calls += 1;
      if (calls === 1) return { rows: [row], rowCount: 1 };
      throw Object.assign(new Error("database unavailable"), { code: "57P01" });
    });
    const authority = createPostgresCapabilityAuthority(fixture.pool);
    const resolved = await authority.resolveForServerContext(input);
    if (!resolved.ok) throw new Error(resolved.error.code);

    const result = await (
      authority.authorizer.revalidate as unknown as (
        capability: unknown,
        roles: readonly ["OWNER"],
        operation: "WRITE",
        fakeClient: unknown,
      ) => ReturnType<typeof authority.authorizer.revalidate>
    )(resolved.value, ["OWNER"], "WRITE", {
      query: async () => ({ rows: [row], rowCount: 1 }),
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "APP_AUTHORITY_UNAVAILABLE", retryable: true },
    });
  });

  it("separates an authority denial from a retryable database outage", async () => {
    let calls = 0;
    const fixture = poolWith(async () => {
      calls += 1;
      if (calls === 1) return { rows: [row], rowCount: 1 };
      throw Object.assign(new Error("scope denied"), { code: "42501" });
    });
    const authority = createPostgresCapabilityAuthority(fixture.pool);
    const resolved = await authority.resolveForServerContext(input);
    if (!resolved.ok) throw new Error(resolved.error.code);
    expect(await authority.authorizer.revalidate(resolved.value, ["OWNER"], "READ")).toMatchObject({
      ok: false,
      error: { code: "APP_AUTHORITY_STALE_OR_FORBIDDEN", retryable: false },
    });
  });
});
