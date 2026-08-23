import { resolve } from "node:path";
import {
  buildBundle,
  defaultBundleDirectory,
  formatBundleSummary,
} from "./lib/agenticdatabench-ecommerce-bundle.js";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const sourceDirectory = option("--source-dir");
if (!sourceDirectory) throw new Error("--source-dir is required");
const outputDirectory = resolve(option("--output-dir") ?? defaultBundleDirectory());
const manifest = await buildBundle(resolve(sourceDirectory), outputDirectory);
process.stdout.write(
  `AgenticDataBench E-commerce bundle built: ${formatBundleSummary(manifest)}\n`,
);
