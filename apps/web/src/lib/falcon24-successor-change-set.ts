import "server-only";

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { type SemanticChangeSet, verifySemanticChangeSet } from "@data-agent/contracts/artifacts";
import { contentHashSchema } from "@data-agent/contracts/common";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const builderResultSchema = z.strictObject({
  blueprint_hash: contentHashSchema,
  datasource_id: z.uuid(),
  assertion_count: z.number().int().positive(),
  competency_case_count: z.number().int().positive(),
  change_set: z.unknown(),
});

export interface Falcon24SuccessorChangeSetInput {
  readonly repository_root: string;
  readonly scope: SemanticChangeSet["scope"];
  readonly base_release: SemanticChangeSet["base_release"];
  readonly expected_datasource_id: string;
  readonly revision?: number;
}

export function falcon24SuccessorOperationId(material: string): string {
  const digits = createHash("sha256").update(material).digest("hex").slice(0, 32).split("");
  digits[12] = "5";
  digits[16] = ((Number.parseInt(digits[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = digits.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function buildFalcon24SuccessorChangeSet(
  input: Falcon24SuccessorChangeSetInput,
): Promise<{
  readonly blueprint_hash: string;
  readonly datasource_id: string;
  readonly assertion_count: number;
  readonly competency_case_count: number;
  readonly change_set: SemanticChangeSet;
}> {
  if (input.scope.semantic_domain !== "falcon24") {
    throw new TypeError("FALCON24_SEMANTIC_DOMAIN_INVALID");
  }
  const builderInput = {
    scope: input.scope,
    base_release: input.base_release,
    revision: input.revision ?? 1,
  };
  const encodedInput = Buffer.from(JSON.stringify(builderInput), "utf8").toString("base64url");
  const script = resolve(input.repository_root, "scripts/build-falcon24-e1-semantic-change-set.ts");
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const { stdout } = await execFileAsync(
    executable,
    ["exec", "tsx", script, `--input=${encodedInput}`],
    {
      cwd: input.repository_root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    },
  );
  let decoded: unknown;
  try {
    decoded = JSON.parse(stdout);
  } catch {
    throw new TypeError("FALCON24_SUCCESSOR_CHANGE_SET_BUILDER_OUTPUT_INVALID");
  }
  const prepared = builderResultSchema.parse(decoded);
  if (prepared.datasource_id !== input.expected_datasource_id) {
    throw new TypeError("FALCON24_SUCCESSOR_CHANGE_SET_DATASOURCE_MISMATCH");
  }
  const changeSet = await verifySemanticChangeSet(prepared.change_set);
  if (
    changeSet.scope.app_id !== input.scope.app_id ||
    changeSet.scope.tenant_id !== input.scope.tenant_id ||
    changeSet.scope.environment !== input.scope.environment ||
    changeSet.scope.semantic_domain !== input.scope.semantic_domain ||
    changeSet.base_release.release_id !== input.base_release.release_id ||
    changeSet.base_release.generation !== input.base_release.generation ||
    changeSet.base_release.release_hash !== input.base_release.release_hash ||
    changeSet.revision !== (input.revision ?? 1) ||
    changeSet.lifecycle_state !== "REVIEW_FROZEN" ||
    changeSet.validation.outcome !== "PASS"
  ) {
    throw new TypeError("FALCON24_SUCCESSOR_CHANGE_SET_CLOSURE_INVALID");
  }
  return Object.freeze({ ...prepared, change_set: changeSet });
}
