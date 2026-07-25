import { readFileSync } from "node:fs";
import { z } from "zod";
import { MODEL_PROVIDERS } from "../packages/contracts/src/providers/index.js";

const packageManifestSchema = z.strictObject({
  name: z.literal("data-agent"),
  version: z.string().min(1),
  private: z.literal(true),
  type: z.literal("module"),
  packageManager: z.string().min(1),
  engines: z.record(z.string(), z.string()),
  scripts: z.record(z.string(), z.string()),
  devDependencies: z.record(z.string(), z.string()),
});

const manifest = packageManifestSchema.parse(
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")),
);

const report = {
  probe_version: "1.0.0",
  runtime: {
    node: process.versions.node,
    package_manager: manifest.packageManager,
  },
  toolchain: {
    turbo: manifest.devDependencies.turbo,
    typescript: manifest.devDependencies.typescript,
    vitest: manifest.devDependencies.vitest,
    biome: manifest.devDependencies["@biomejs/biome"],
  },
  providers: MODEL_PROVIDERS.map((provider) => ({
    provider,
    certification_status: "UNVERIFIED",
    reason_code: "CREDENTIAL_SMOKE_NOT_RUN",
  })),
  capabilities: [
    { level: "L2", delivery_state: "IMPLEMENTING" },
    { level: "L3", delivery_state: "CONTRACT_ONLY", public_message: "未交付" },
    { level: "L4", delivery_state: "CONTRACT_ONLY", public_message: "未交付" },
    { level: "L5", delivery_state: "CONTRACT_ONLY", public_message: "未交付" },
  ],
} as const;

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
