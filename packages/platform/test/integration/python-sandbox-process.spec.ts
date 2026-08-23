import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createPythonSqlSandboxClient } from "../../src/sandbox/python-sql-sandbox.js";

const enabled = process.env.DATA_AGENT_SANDBOX_PROCESS_INTEGRATION === "1";
const datasourceDsn = process.env.DATA_AGENT_SANDBOX_DSN;
const sandboxDirectory = fileURLToPath(new URL("../../../../services/sandbox/", import.meta.url));
const pythonExecutable = fileURLToPath(
  new URL("../../../../services/sandbox/.venv/bin/python", import.meta.url),
);
const executeFixture = fileURLToPath(
  new URL("../../../../tests/fixtures/sandbox-protocol/v1/execute.json", import.meta.url),
);

describe.skipIf(!enabled || !datasourceDsn)(
  "TypeScript Platform ↔ Python Sandbox ↔ PostgreSQL 17",
  () => {
    it("通过同一份严格 Grant 完成真实 RR/RO 查询并返回唯一可验证 Outcome", async () => {
      const frame = JSON.parse(await readFile(executeFixture, "utf8")) as {
        readonly grant: unknown;
        readonly sql: unknown;
        readonly snapshot: unknown;
        readonly settings: unknown;
        readonly budget: unknown;
      };
      const client = createPythonSqlSandboxClient({
        command: pythonExecutable,
        datasource_id: "00000000-0000-4000-8000-00000000d101",
        datasource_fingerprint: "postgresql-test-datasource@1.0.0",
        args: ["-m", "data_agent_sandbox"],
        cwd: sandboxDirectory,
        server_environment: {
          DATA_AGENT_SANDBOX_DSN: datasourceDsn,
          PYTHONUNBUFFERED: "1",
        },
      });

      const handle = await client.start({
        grant: frame.grant,
        sql: frame.sql,
        snapshot: frame.snapshot,
        settings: frame.settings,
        budget: frame.budget,
      });
      const outcome = await handle.outcome;

      expect(outcome).toMatchObject({
        terminal: "COMPLETED",
        reason_code: "SANDBOX_EXECUTION_COMPLETED",
        result: {
          columns: [{ name: "result", type: "INTEGER" }],
          rows: [[7]],
        },
        rollback_facts: {
          rollback_confirmed: true,
          datasource_terminal: "ROLLED_BACK_CLEAN",
        },
        connection_facts: {
          transaction_status: "IDLE",
          connection_reused: false,
        },
        transaction: {
          read_only: true,
          isolation_level: "REPEATABLE_READ",
        },
      });
      expect(outcome.identity).toStrictEqual(
        (frame.grant as { readonly identity: unknown }).identity,
      );
    });
  },
);
