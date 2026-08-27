import "server-only";

import { execFile } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import {
  type SemanticRuntimeSmokeReceipt,
  verifySemanticRuntimeSmokeReceipt,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson } from "@data-agent/contracts/common";
import type { PortResult } from "@data-agent/contracts/ports";
import {
  type RuntimeBuildIdentity,
  runtimeBuildIdentitySchema,
} from "@data-agent/contracts/server";
import { z } from "zod";

const configurationSchema = z.strictObject({
  repository_root: z.string().min(1).refine(isAbsolute),
  database_url: z.string().min(1),
  deployment_id: z.uuid(),
  tenant_id: z.uuid(),
  principal_id: z.uuid(),
  worker_build_identity_file: z.string().min(1).refine(isAbsolute),
});
const runInputSchema = z.strictObject({
  semantic_domain: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/u),
  stage_id: z.uuid(),
  idempotency_key: z.string().trim().min(1).max(256),
  worker_build_identity: runtimeBuildIdentitySchema,
});

interface ProcessExecutionOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeout: number;
  readonly maxBuffer: number;
}

export type ProcessExecutor = (
  executable: string,
  arguments_: readonly string[],
  options: ProcessExecutionOptions,
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

const execFileAsync = promisify(execFile);
const executeProcess: ProcessExecutor = async (executable, arguments_, options) => {
  const result = await execFileAsync(executable, arguments_, {
    ...options,
    encoding: "utf8",
  });
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
};

function processFailure(): PortResult<never> {
  return {
    ok: false,
    error: {
      code: "FALCON24_SEMANTIC_SUCCESSOR_SMOKE_PROCESS_FAILED",
      message: "Worker semantic successor smoke 进程未返回可验证的 exact receipt。",
      retryable: false,
    },
  };
}

export function createFalcon24SuccessorSmokeProcess(input: {
  readonly repository_root: string;
  readonly database_url: string;
  readonly deployment_id: string;
  readonly tenant_id: string;
  readonly principal_id: string;
  readonly worker_build_identity_file: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly execute?: ProcessExecutor;
}) {
  const configuration = configurationSchema.parse({
    repository_root: input.repository_root,
    database_url: input.database_url,
    deployment_id: input.deployment_id,
    tenant_id: input.tenant_id,
    principal_id: input.principal_id,
    worker_build_identity_file: input.worker_build_identity_file,
  });
  const execute = input.execute ?? executeProcess;
  return Object.freeze({
    async run(candidate: {
      readonly capability: unknown;
      readonly semantic_domain: string;
      readonly stage_id: string;
      readonly idempotency_key: string;
      readonly worker_build_identity: RuntimeBuildIdentity;
    }): Promise<PortResult<SemanticRuntimeSmokeReceipt>> {
      try {
        const run = runInputSchema.parse({
          semantic_domain: candidate.semantic_domain,
          stage_id: candidate.stage_id,
          idempotency_key: candidate.idempotency_key,
          worker_build_identity: candidate.worker_build_identity,
        });
        if (run.worker_build_identity.consumer_role !== "worker") return processFailure();
        const { stdout, stderr } = await execute(
          process.execPath,
          [
            resolve(configuration.repository_root, "node_modules/tsx/dist/cli.mjs"),
            resolve(
              configuration.repository_root,
              "apps/worker/src/semantic/semantic-successor-stage-smoke-cli.ts",
            ),
          ],
          {
            cwd: configuration.repository_root,
            env: {
              ...(input.environment ?? process.env),
              DATABASE_URL: configuration.database_url,
              SEMANTIC_DEPLOYMENT_ID: configuration.deployment_id,
              SEMANTIC_TENANT_ID: configuration.tenant_id,
              SEMANTIC_PRINCIPAL_ID: configuration.principal_id,
              SEMANTIC_SUCCESSOR_DOMAIN: run.semantic_domain,
              SEMANTIC_SUCCESSOR_STAGE_ID: run.stage_id,
              SEMANTIC_SUCCESSOR_SMOKE_IDEMPOTENCY_KEY: run.idempotency_key,
              DATA_AGENT_RUNTIME_BUILD_IDENTITY_FILE: configuration.worker_build_identity_file,
            },
            timeout: 60_000,
            maxBuffer: 1024 * 1024,
          },
        );
        if (stderr.trim().length > 0) return processFailure();
        const receipt = await verifySemanticRuntimeSmokeReceipt(JSON.parse(stdout.trim()));
        if (
          receipt.stage_id !== run.stage_id ||
          canonicalizeJson(receipt.worker_build_identity) !==
            canonicalizeJson(run.worker_build_identity)
        ) {
          return processFailure();
        }
        return { ok: true, value: receipt };
      } catch {
        return processFailure();
      }
    },
  });
}
