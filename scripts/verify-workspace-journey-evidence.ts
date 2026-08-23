import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyWorkspaceJourneyEvidenceArtifact } from "../packages/contracts/src/index.js";

const evidencePath = resolve(
  process.cwd(),
  process.argv[2] ?? "artifacts/u17-workspace-journey/workspace-journey-evidence.json",
);

const artifact = await verifyWorkspaceJourneyEvidenceArtifact(
  JSON.parse(await readFile(evidencePath, "utf8")),
);

console.log(
  JSON.stringify({
    schema_version: "workspace-journey-evidence-verification@1.0.0",
    result: artifact.result,
    artifact_id: artifact.artifact_id,
    artifact_hash: artifact.artifact_hash,
    checkpoint_count: artifact.checks.length,
    locales: artifact.locales,
    viewports: artifact.viewports.map(({ name, width, height }) => ({ name, width, height })),
  }),
);
