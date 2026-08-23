import { resolve } from "node:path";
import {
  defaultBundleDirectory,
  formatBundleSummary,
  verifyBundle,
} from "./lib/agenticdatabench-ecommerce-bundle.js";

const directoryIndex = process.argv.indexOf("--bundle-dir");
const bundleDirectory = resolve(
  directoryIndex === -1 ? defaultBundleDirectory() : (process.argv[directoryIndex + 1] ?? ""),
);
const manifest = await verifyBundle(bundleDirectory);
process.stdout.write(
  `AgenticDataBench E-commerce bundle verified: ${formatBundleSummary(manifest)}\n`,
);
