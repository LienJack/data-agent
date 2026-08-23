import { describe, expect, it } from "vitest";
import { runLocalSuperadminSync } from "@/cli/local-superadmin-sync";

describe("local superadmin sync guards", () => {
  it("is disabled unless the explicit local switch is YES", async () => {
    await expect(runLocalSuperadminSync({ NODE_ENV: "development" })).resolves.toEqual({
      schema_version: "local-superadmin-sync-result@1.0.0",
      terminal: "SKIPPED",
      reason_code: "DEV_SUPERADMIN_SYNC_DISABLED",
    });
  });

  it("fails closed before database access in production", async () => {
    await expect(
      runLocalSuperadminSync({ DATA_AGENT_LOCAL_SUPERADMIN_SYNC: "YES", NODE_ENV: "production" }),
    ).resolves.toMatchObject({
      terminal: "HOLD",
      reason_code: "DEV_SUPERADMIN_SYNC_PRODUCTION_FORBIDDEN",
    });
  });

  it("rejects missing or invalid username configuration without echoing secrets", async () => {
    const result = await runLocalSuperadminSync({
      NODE_ENV: "development",
      DATA_AGENT_LOCAL_SUPERADMIN_SYNC: "YES",
      DATA_AGENT_BOOTSTRAP_PASSWORD: "do-not-render-this-password",
      DATA_AGENT_BOOTSTRAP_USERNAME: "two words",
    });
    expect(result).toMatchObject({
      terminal: "HOLD",
      reason_code: "DEV_SUPERADMIN_SYNC_CONFIGURATION_INVALID",
    });
    expect(JSON.stringify(result)).not.toContain("do-not-render-this-password");
  });

  it.each(["x", "x".repeat(256)])(
    "accepts a configured password without enforcing a character-count limit",
    async (password) => {
      const result = await runLocalSuperadminSync({
        NODE_ENV: "development",
        DATA_AGENT_LOCAL_SUPERADMIN_SYNC: "YES",
        DATABASE_URL: "postgresql://postgres@127.0.0.1:1/data_agent?connect_timeout=1",
        WORKSPACE_DEPLOYMENT_ID: "00000000-0000-4000-8000-000000000001",
        DATA_AGENT_BOOTSTRAP_EMAIL: "admin@example.com",
        DATA_AGENT_BOOTSTRAP_USERNAME: "admin",
        DATA_AGENT_BOOTSTRAP_NAME: "Admin",
        DATA_AGENT_BOOTSTRAP_PASSWORD: password,
      });

      expect(result).toMatchObject({
        terminal: "HOLD",
        reason_code: "DEV_SUPERADMIN_SYNC_FAILED",
      });
      expect(JSON.stringify(result)).not.toContain(password);
    },
  );
});
