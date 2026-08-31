import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ArtifactReference } from "@data-agent/contracts/artifacts";
import { canonicalizeJson, sha256ContentHash } from "@data-agent/contracts/common";
import type { AnalysisBoundOutput } from "./executor.js";

/** Shared byte/reference checks only; each oracle independently computes its business expectations. */
export function createAnalysisOracleOutputClosure(
  errorPrefix: string,
  oracleModuleUrl: string,
  dependencyModuleUrls: readonly string[] = [],
) {
  function fail(kind: string): never {
    throw new TypeError(`${errorPrefix}_${kind}`);
  }
  function same(left: unknown, right: unknown) {
    return canonicalizeJson(left) === canonicalizeJson(right);
  }
  function sameScopeRun(left: ArtifactReference, right: ArtifactReference) {
    return (
      left.app_id === right.app_id &&
      left.tenant_id === right.tenant_id &&
      left.environment === right.environment &&
      left.run_id === right.run_id
    );
  }
  function outputOf(
    outputs: readonly AnalysisBoundOutput[],
    name: string,
    kind: AnalysisBoundOutput["artifact_kind"],
    source: ArtifactReference,
  ) {
    const matches = outputs.filter(
      (item) => item.artifact_name === name && item.artifact_kind === kind,
    );
    const output = matches[0];
    if (
      matches.length !== 1 ||
      !output ||
      output.media_type !== "application/json" ||
      output.reference.artifact_type !== "SandboxResult" ||
      !sameScopeRun(output.reference, source) ||
      output.bytes !== output.content.byteLength ||
      output.reference.content_hash !== output.content_sha256 ||
      `sha256:${createHash("sha256").update(output.content).digest("hex")}` !==
        output.content_sha256
    )
      return fail("OUTPUT_CLOSURE_INVALID");
    return output;
  }
  function readJson(output: AnalysisBoundOutput): unknown {
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(output.content));
    } catch {
      return fail("OUTPUT_CLOSURE_INVALID");
    }
  }
  let codeDigest: Promise<string> | undefined;
  function implementationCodeDigest() {
    codeDigest ??= Promise.all(
      [oracleModuleUrl, import.meta.url, ...dependencyModuleUrls].map(
        async (url) =>
          `sha256:${createHash("sha256")
            .update(await readFile(new URL(url)))
            .digest("hex")}`,
      ),
    ).then(([oracle_code_digest, closure_code_digest, ...dependency_code_digests]) =>
      sha256ContentHash({
        oracle_code_digest,
        closure_code_digest,
        ...(dependency_code_digests.length ? { dependency_code_digests } : {}),
      }),
    );
    return codeDigest;
  }
  return Object.freeze({ fail, same, sameScopeRun, outputOf, readJson, implementationCodeDigest });
}
