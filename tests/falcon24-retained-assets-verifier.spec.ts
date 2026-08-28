import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createGitRetainedAssetHistoryReader,
  verifyFalcon24RetainedAssets,
} from "../scripts/verify-falcon24-retained-assets.js";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

describe("Falcon24 retained assets verifier", () => {
  it("proves immutable E1 semantic sources from the manifest introduction commit", async () => {
    const proof = await verifyFalcon24RetainedAssets(repositoryRoot);

    expect(proof).toMatchObject({
      terminal: "READY",
      manifest_origin_commit: "5eb4714e13ef3daad44ae79412832e6108c17902",
      verified_historical_semantic_file_count: 3,
    });
    expect(proof.current_semantic_drift_files).toEqual([
      "apps/worker/src/evals/falcon24-semantic-catalog.ts",
      "apps/worker/src/evals/falcon24-semantic-change-set.ts",
      "packages/evals/src/test-center/falcon24-agent-analysis-suite.ts",
    ]);
  });

  it("rejects a historical semantic blob that no longer matches the frozen manifest", async () => {
    const base = createGitRetainedAssetHistoryReader(repositoryRoot);

    await expect(
      verifyFalcon24RetainedAssets(repositoryRoot, {
        ...base,
        readFileAtCommit: (commit, relativePath) =>
          relativePath === "apps/worker/src/evals/falcon24-semantic-catalog.ts"
            ? Buffer.from("tampered historical semantic source")
            : base.readFileAtCommit(commit, relativePath),
      }),
    ).rejects.toThrowError(
      "FALCON24_E1_RETAINED_HISTORICAL_SOURCE_HASH_INVALID:apps/worker/src/evals/falcon24-semantic-catalog.ts",
    );
  });

  it("rejects replacement of the E1 manifest even when the current document is self-consistent", async () => {
    const base = createGitRetainedAssetHistoryReader(repositoryRoot);

    await expect(
      verifyFalcon24RetainedAssets(repositoryRoot, {
        ...base,
        readFileAtCommit: (commit, relativePath) =>
          relativePath === "infra/falcon/e1/retained-assets-manifest.json"
            ? Buffer.from("different historical manifest bytes")
            : base.readFileAtCommit(commit, relativePath),
      }),
    ).rejects.toThrowError("FALCON24_E1_RETAINED_MANIFEST_BYTES_DRIFT");
  });

  it("still rejects drift in assets that E4 consumes from the current checkout", async () => {
    const base = createGitRetainedAssetHistoryReader(repositoryRoot);

    await expect(
      verifyFalcon24RetainedAssets(repositoryRoot, {
        ...base,
        readCurrentFile: (relativePath) =>
          relativePath === "infra/falcon/e1/llm-provider-model-profile.json"
            ? Buffer.from(
                base
                  .readCurrentFile(relativePath)
                  .toString("utf8")
                  .replace("Falcon24 DeepSeek Analysis", "Falcon24 Drifted Analysis"),
              )
            : base.readCurrentFile(relativePath),
      }),
    ).rejects.toThrowError(
      "FALCON24_E1_RETAINED_CURRENT_FILE_HASH_INVALID:infra/falcon/e1/llm-provider-model-profile.json",
    );
  });
});
