import { execPath } from "node:process";
import { describe, expect, it } from "vitest";
import {
  SandboxProcessError,
  startSingleExecutionNdjsonProcess,
} from "../../src/sandbox/ndjson-process.internal.js";

function nodeProcess(source: string) {
  return {
    command: execPath,
    args: ["--input-type=module", "--eval", source],
  } as const;
}

describe("single execution NDJSON sandbox process", () => {
  it("writes the execute frame and accepts exactly one parsed outcome", async () => {
    const process = startSingleExecutionNdjsonProcess({
      ...nodeProcess(`
        import { createInterface } from "node:readline";
        const lines = createInterface({ input: process.stdin });
        lines.once("line", (line) => {
          const frame = JSON.parse(line);
          process.stdout.write(JSON.stringify({
            frame_type: "OUTCOME",
            execution_id: frame.execution_id,
          }) + "\\n");
          process.exit(0);
        });
      `),
      execute_frame: { frame_type: "EXECUTE", execution_id: "execution-1" },
      parse_outcome(value) {
        const candidate = value as { frame_type?: unknown; execution_id?: unknown };
        if (candidate.frame_type !== "OUTCOME" || typeof candidate.execution_id !== "string") {
          throw new TypeError("invalid outcome");
        }
        return candidate as { frame_type: "OUTCOME"; execution_id: string };
      },
    });

    await expect(process.outcome).resolves.toEqual({
      frame_type: "OUTCOME",
      execution_id: "execution-1",
    });
  });

  it("keeps stdin duplex so a bound cancel frame can reach the active execution", async () => {
    const process = startSingleExecutionNdjsonProcess({
      ...nodeProcess(`
        import { createInterface } from "node:readline";
        const lines = createInterface({ input: process.stdin });
        const frames = [];
        lines.on("line", (line) => {
          frames.push(JSON.parse(line));
          if (frames.length === 2) {
            process.stdout.write(JSON.stringify({
              frame_type: "OUTCOME",
              terminal: "CANCELLED",
              execution_id: frames[0].execution_id,
              cancel_epoch: frames[1].cancel_epoch,
            }) + "\\n");
            process.exit(0);
          }
        });
      `),
      execute_frame: { frame_type: "EXECUTE", execution_id: "execution-2" },
      parse_outcome: (value) =>
        value as {
          frame_type: "OUTCOME";
          terminal: "CANCELLED";
          execution_id: string;
          cancel_epoch: number;
        },
    });

    process.send({
      frame_type: "CANCEL",
      execution_id: "execution-2",
      cancel_epoch: 1,
    });

    await expect(process.outcome).resolves.toMatchObject({
      terminal: "CANCELLED",
      execution_id: "execution-2",
      cancel_epoch: 1,
    });
  });

  it("rejects multiple stdout outcomes instead of choosing one", async () => {
    const process = startSingleExecutionNdjsonProcess({
      ...nodeProcess(`
        process.stdin.once("data", () => {
          process.stdout.write('{"frame_type":"OUTCOME","ordinal":1}\\n');
          process.stdout.write('{"frame_type":"OUTCOME","ordinal":2}\\n');
          process.exit(0);
        });
      `),
      execute_frame: { frame_type: "EXECUTE" },
      parse_outcome: (value) => value,
    });

    await expect(process.outcome).rejects.toMatchObject({
      code: "SANDBOX_PROTOCOL_MULTIPLE_OUTCOMES",
    });
  });

  it("parses one large outcome incrementally without repeatedly rescanning prior chunks", async () => {
    const payload = "分析".repeat(256 * 1024);
    const process = startSingleExecutionNdjsonProcess({
      ...nodeProcess(`
        process.stdin.once("data", () => {
          const encoded = JSON.stringify({
            frame_type: "OUTCOME",
            payload: "分析".repeat(256 * 1024),
          }) + "\\n";
          let offset = 0;
          const writeNext = () => {
            if (offset >= encoded.length) return process.exit(0);
            const next = encoded.slice(offset, offset + 4096);
            offset += next.length;
            if (process.stdout.write(next)) setImmediate(writeNext);
            else process.stdout.once("drain", writeNext);
          };
          writeNext();
        });
      `),
      execute_frame: { frame_type: "EXECUTE" },
      parse_outcome: (value) =>
        value as {
          readonly frame_type: "OUTCOME";
          readonly payload: string;
        },
      max_stdout_bytes: 2 * 1024 * 1024,
    });

    await expect(process.outcome).resolves.toEqual({
      frame_type: "OUTCOME",
      payload,
    });
  });

  it("rejects a structurally invalid outcome without exposing stderr", async () => {
    const process = startSingleExecutionNdjsonProcess({
      ...nodeProcess(`
        process.stdin.once("data", () => {
          process.stderr.write("secret datasource diagnostic");
          process.stdout.write('{"frame_type":"NOT_AN_OUTCOME"}\\n');
          process.exit(0);
        });
      `),
      execute_frame: { frame_type: "EXECUTE" },
      parse_outcome(value) {
        if ((value as { frame_type?: unknown }).frame_type !== "OUTCOME") {
          throw new TypeError("invalid outcome");
        }
        return value;
      },
    });

    const error = await process.outcome.catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(SandboxProcessError);
    expect(error).toMatchObject({ code: "SANDBOX_PROTOCOL_INVALID_OUTCOME" });
    expect(String(error)).not.toContain("secret datasource diagnostic");
  });

  it("kills a process that exceeds the stderr log budget", async () => {
    const process = startSingleExecutionNdjsonProcess({
      ...nodeProcess(`
        process.stdin.once("data", () => {
          process.stderr.write("x".repeat(1024));
          setInterval(() => {}, 1000);
        });
      `),
      execute_frame: { frame_type: "EXECUTE" },
      parse_outcome: (value) => value,
      max_stderr_bytes: 64,
    });

    await expect(process.outcome).rejects.toMatchObject({
      code: "SANDBOX_PROTOCOL_STDERR_LIMIT_EXCEEDED",
    });
  });

  it("enforces a host-side protocol deadline if the sandbox never returns", async () => {
    const process = startSingleExecutionNdjsonProcess({
      ...nodeProcess(`
        process.stdin.once("data", () => {
          setInterval(() => {}, 1000);
        });
      `),
      execute_frame: { frame_type: "EXECUTE" },
      parse_outcome: (value) => value,
      protocol_timeout_ms: 50,
    });

    await expect(process.outcome).rejects.toMatchObject({
      code: "SANDBOX_PROCESS_DEADLINE_EXCEEDED",
    });
  });
});
