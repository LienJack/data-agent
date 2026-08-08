import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  type DataSourceConnectorPort,
  resolveDataSourceCredential,
  unavailableSecretResolver,
} from "../src/lib/datasource-secret";
import {
  createDataSourceInputSchema,
  testConnectionInputSchema,
} from "../src/lib/datasource-types";

const id = "00000000-0000-4000-8000-000000000001";
const credentialRef = {
  schema_version: "datasource-credential-ref@1.0.0",
  app_id: id,
  tenant_id: id,
  environment: "development",
  credential_ref_id: id,
  secret_ref_id: id,
  secret_version: 1,
  rotation_state: "ACTIVE",
} as const;
const authority = {
  appId: id,
  tenantId: id,
  environment: "development",
  principal: id,
} as const;

describe("datasource secret-reference boundary", () => {
  it("rejects raw credentials and provider locators in datasource requests", () => {
    const safeInput = {
      name: "analytics",
      type: "postgresql",
      host: "db.internal",
      database: "analytics",
      username: "reader",
      credentialRef,
    } as const;

    expect(createDataSourceInputSchema.parse(safeInput)).toEqual(safeInput);
    expect(testConnectionInputSchema.parse(safeInput)).toEqual(safeInput);
    expect(() =>
      createDataSourceInputSchema.parse({ ...safeInput, password: "raw-secret" }),
    ).toThrow();
    expect(() =>
      testConnectionInputSchema.parse({
        ...safeInput,
        dsn: "postgresql://reader:raw-secret@db.internal/analytics",
      }),
    ).toThrow();
    expect(() =>
      testConnectionInputSchema.parse({ ...safeInput, providerLocator: "vault://prod/db" }),
    ).toThrow();
  });

  it("fails closed before invoking a connector when the secret provider is unavailable", async () => {
    const connector: DataSourceConnectorPort = {
      test: vi.fn(),
    };

    await expect(
      resolveDataSourceCredential(
        {
          name: "analytics",
          type: "postgresql",
          host: "db.internal",
          database: "analytics",
          username: "reader",
          credentialRef,
        },
        authority,
        unavailableSecretResolver(),
        connector,
      ),
    ).rejects.toMatchObject({ code: "DATASOURCE_SECRET_PROVIDER_NOT_CONFIGURED" });
    expect(connector.test).not.toHaveBeenCalled();
  });

  it("redacts resolver and connector causes from public failures", async () => {
    const connector: DataSourceConnectorPort = {
      test: vi.fn(async () => {
        throw new Error("postgresql://reader:raw-secret@db.internal/analytics token=abc");
      }),
    };
    const resolver = {
      resolve: vi.fn(async () => ({ username: "reader", secretValue: "raw-secret" })),
    };

    await expect(
      resolveDataSourceCredential(
        {
          name: "analytics",
          type: "postgresql",
          host: "db.internal",
          database: "analytics",
          username: "reader",
          credentialRef,
        },
        authority,
        resolver,
        connector,
      ),
    ).rejects.toMatchObject({ code: "DATASOURCE_CONNECTION_FAILED" });

    try {
      await resolveDataSourceCredential(
        {
          name: "analytics",
          type: "postgresql",
          host: "db.internal",
          database: "analytics",
          username: "reader",
          credentialRef,
        },
        authority,
        resolver,
        connector,
      );
    } catch (error) {
      expect(String(error)).not.toContain("raw-secret");
      expect(String(error)).not.toContain("db.internal");
      expect(String(error)).not.toContain("token=abc");
    }
  });

  it("rejects a credential reference outside the server-derived scope", async () => {
    const resolver = { resolve: vi.fn() };
    const connector: DataSourceConnectorPort = { test: vi.fn() };

    await expect(
      resolveDataSourceCredential(
        {
          type: "postgresql",
          host: "db.internal",
          database: "analytics",
          username: "reader",
          credentialRef,
        },
        { ...authority, tenantId: "00000000-0000-4000-8000-000000000002" },
        resolver,
        connector,
      ),
    ).rejects.toMatchObject({ code: "DATASOURCE_CREDENTIAL_REF_INVALID" });
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(connector.test).not.toHaveBeenCalled();
  });

  it("keeps password-bearing fields out of datasource persistence and UI state", () => {
    const paths = [
      "../src/lib/datasource-types.ts",
      "../src/lib/datasource-repository.ts",
      "../src/app/api/datasources/route.ts",
      "../src/app/api/datasources/[id]/route.ts",
      "../src/components/data-sources/connection-form.tsx",
    ];

    for (const path of paths) {
      const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
      expect(source, path).not.toMatch(/\bpassword\b/i);
      expect(source, path).not.toMatch(/\bdsn\b/i);
      expect(source, path).not.toMatch(/provider[_-]?locator/i);
    }
  });
});
