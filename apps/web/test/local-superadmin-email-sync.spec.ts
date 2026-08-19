import { Client } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runLocalSuperadminSync } from "@/cli/local-superadmin-sync";

vi.mock("pg", () => ({ Client: vi.fn() }));

describe("local superadmin email sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes a configured email change through the governed local sync function", async () => {
    const queries: Array<{ readonly text: string; readonly values?: readonly unknown[] }> = [];
    let ended = false;
    const client = {
      connect: vi.fn(async () => undefined),
      end: vi.fn(async () => {
        ended = true;
      }),
      query: vi.fn(async (text: string, values?: readonly unknown[]) => {
        if (ended) throw new Error("Client was closed and is not queryable");
        queries.push({ text, ...(values ? { values } : {}) });
        if (text === "select session_user,current_user") {
          return { rowCount: 1, rows: [{ session_user: "postgres", current_user: "postgres" }] };
        }
        if (text.includes("from app_data_agent.app_users as app_user")) {
          return {
            rowCount: 1,
            rows: [
              {
                principal_id: "00000000-0000-4000-8000-000000000010",
                auth_user_id: "00000000-0000-4000-8000-000000000011",
                app_username: "admin",
                auth_username: "admin",
                email: "old-admin@example.com",
                auth_email: "old-admin@example.com",
                password_hash: null,
                workspace_id: "00000000-0000-4000-8000-000000000012",
              },
            ],
          };
        }
        if (text.includes("sync_local_super_admin_credentials")) {
          return {
            rowCount: 1,
            rows: [
              {
                result: {
                  principal_id: "00000000-0000-4000-8000-000000000010",
                  workspace_id: "00000000-0000-4000-8000-000000000012",
                },
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      }),
    };
    vi.mocked(Client).mockImplementation(function MockClient() {
      return client as unknown as Client;
    });

    const result = await runLocalSuperadminSync({
      NODE_ENV: "development",
      DATA_AGENT_LOCAL_SUPERADMIN_SYNC: "YES",
      DATABASE_URL: "postgresql://redacted.invalid/data_agent",
      WORKSPACE_DEPLOYMENT_ID: "00000000-0000-4000-8000-000000000001",
      DATA_AGENT_BOOTSTRAP_EMAIL: "new-admin@example.com",
      DATA_AGENT_BOOTSTRAP_USERNAME: "admin",
      DATA_AGENT_BOOTSTRAP_NAME: "Admin",
      DATA_AGENT_BOOTSTRAP_PASSWORD: "short",
    });

    expect(result).toMatchObject({
      terminal: "SUCCEEDED",
      reason_code: "DEV_SUPERADMIN_SYNC_UPDATED",
      action: "UPDATED",
      email: "new-admin@example.com",
    });
    const syncCall = queries.find(({ text }) =>
      text.includes("sync_local_super_admin_credentials"),
    );
    expect(syncCall?.values?.[1]).toBe("new-admin@example.com");
    expect(JSON.stringify(result)).not.toContain("short");
  });
});
