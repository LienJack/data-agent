import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));

interface ControlledKernelBudgetResult {
  readonly kind: string;
  readonly elapsed_ms: number;
  readonly digest_count: number;
  readonly max_rss_mib: number;
  readonly metrics: {
    readonly namespaces: Readonly<
      Record<
        string,
        {
          readonly hits: number;
          readonly misses: number;
          readonly coalesced: number;
          readonly unowned: number;
          readonly failed: number;
        }
      >
    >;
    readonly totals: {
      readonly hits: number;
      readonly misses: number;
      readonly coalesced: number;
      readonly unowned: number;
      readonly failed: number;
    };
  };
}

function missesWithPrefix(
  metrics: ControlledKernelBudgetResult["metrics"],
  prefix: string,
): number {
  return Object.entries(metrics.namespaces)
    .filter(([namespace]) => namespace.startsWith(prefix))
    .reduce((sum, [, counter]) => sum + counter.misses, 0);
}

describe("U6 受控研究内核性能预算", () => {
  it("完整两查询闭包在请求级 verified replay 下保持确定的摘要、文档与内存预算", async () => {
    const benchmark = `
      import {
        getControlledFixtureHandle,
        materializeControlledProtocolInput,
        runControlledProtocolKernel,
      } from "./dist/server.js";
      import {
        inspectControlledKernelReplayMetrics,
      } from "./dist/server/controlled-composition.js";

      let digestCount = 0;
      const originalDigest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
      globalThis.crypto.subtle.digest = async (...args) => {
        digestCount += 1;
        return originalDigest(...args);
      };

      const handle = await getControlledFixtureHandle(
        "retail-revenue-investigation-v1",
        "u6-controlled-fixture@1.0.0",
      );
      const input = materializeControlledProtocolInput(handle);
      const startedAt = performance.now();
      const evaluation = await runControlledProtocolKernel(input);
      const metrics = inspectControlledKernelReplayMetrics(evaluation);
      if (metrics === null) throw new TypeError("CONTROLLED_REPLAY_METRICS_REQUIRED");

      process.stdout.write(JSON.stringify({
        kind: evaluation.kernel_outcome.kind,
        elapsed_ms: performance.now() - startedAt,
        digest_count: digestCount,
        max_rss_mib: process.resourceUsage().maxRSS / 1024,
        metrics,
      }));
    `;
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--input-type=module", "-e", benchmark],
      {
        cwd: packageRoot,
        maxBuffer: 1_000_000,
        timeout: 15_000,
      },
    );
    const result = JSON.parse(stdout) as ControlledKernelBudgetResult;

    expect(result.kind).toBe("REPORT_READY_CANDIDATE");
    expect(result.digest_count).toBeLessThanOrEqual(750);
    expect(result.elapsed_ms).toBeLessThanOrEqual(2_000);
    expect(result.max_rss_mib).toBeLessThanOrEqual(400);

    expect(missesWithPrefix(result.metrics, "document:research:")).toBe(27);
    expect(missesWithPrefix(result.metrics, "document:l2:")).toBe(8);
    expect(result.metrics.totals).toMatchObject({
      misses: 61,
      unowned: 0,
      failed: 0,
    });
    expect(result.metrics.totals.hits).toBeGreaterThan(result.metrics.totals.misses);
  });
});
