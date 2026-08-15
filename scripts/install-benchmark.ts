import { join } from "node:path";
import {
  defaultBenchmarkRoot,
  getBenchmarkCatalog,
  installBirdMiniDevSmokeSlice,
  installBladeSmokeSlice,
  installDrSpiderSmokeSlice,
  installInsightBenchSmokeSlice,
} from "../packages/evals/src/test-center/index.js";

async function main(): Promise<void> {
  const command = process.argv[2] ?? "bird-mini-dev";
  const benchmarkRoot = defaultBenchmarkRoot();
  if (command === "status") {
    process.stdout.write(`${JSON.stringify(await getBenchmarkCatalog(benchmarkRoot), null, 2)}\n`);
    return;
  }
  if (command === "insightbench") {
    const receipt = await installInsightBenchSmokeSlice({ benchmark_root: benchmarkRoot });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return;
  }
  if (command === "dr-spider") {
    const archivePath = process.argv[3];
    const receipt = await installDrSpiderSmokeSlice({
      benchmark_root: benchmarkRoot,
      ...(archivePath ? { archive_path: archivePath } : {}),
    });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return;
  }
  if (command === "blade") {
    const archivePath = process.argv[3];
    const receipt = await installBladeSmokeSlice({
      benchmark_root: benchmarkRoot,
      ...(archivePath ? { archive_path: archivePath } : {}),
    });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    return;
  }
  if (command !== "bird-mini-dev") {
    throw new Error(`Unsupported benchmark installer: ${command}`);
  }
  const archivePath = process.argv[3] ?? join(benchmarkRoot, "downloads", "bird-mini-dev-v1.zip");
  const receipt = await installBirdMiniDevSmokeSlice({
    archive_path: archivePath,
    benchmark_root: benchmarkRoot,
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "BENCHMARK_INSTALL_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
