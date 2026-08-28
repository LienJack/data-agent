import { fileURLToPath } from "node:url";
import { adaptPgPool } from "@data-agent/platform/persistence";
import { createPostgresFalcon24SemanticClosureReader } from "@data-agent/platform/runs";
import { loadRuntimeEnvironment } from "@data-agent/platform/runtime-config";
import { createPostgresCapabilityAuthority } from "@data-agent/platform/tenancy";
import pg from "pg";
import { z } from "zod";
import {
  buildFalcon24SuccessorChangeSet,
  falcon24SuccessorOperationId,
} from "../lib/falcon24-successor-change-set";
import { createPostgresSemanticPublicationAuthority } from "../lib/postgres-semantic-publication";

const CONFIRMATION_VARIABLE = "DATA_AGENT_ALLOW_FALCON24_SUCCESSOR_REVIEW_PREPARATION";
const APP_ID = "00000000-0000-4000-8000-00000000da01";
const DEFAULT_DEPLOYMENT_ID = "00000000-0000-4000-8000-000000000001";
const DEFAULT_WORKSPACE_ID = "00000000-0000-4000-8000-00000000e124";
const DEFAULT_PRINCIPAL_ID = "00000000-0000-4000-8000-00000000e125";
const DEFAULT_DATASOURCE_ID = "37653002-af62-53c9-bf21-519468aa39ab";
const SEMANTIC_DOMAIN = "falcon24" as const;
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const configurationSchema = z.strictObject({
  database_url: z.string().min(1),
  deployment_id: z.uuid(),
  workspace_id: z.uuid(),
  principal_id: z.uuid(),
  datasource_id: z.uuid(),
  environment: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u),
});

function required<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string } },
): T {
  if (!result.ok) throw new TypeError(result.error.code);
  return result.value;
}

function stableFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,127}$/u.test(message)
    ? message
    : "FALCON24_SUCCESSOR_REVIEW_PREPARATION_FAILED";
}

export async function runFalcon24SuccessorReviewPreparation(
  environment: NodeJS.ProcessEnv = loadRuntimeEnvironment().environment,
) {
  if (environment[CONFIRMATION_VARIABLE]?.trim() !== "YES") {
    return {
      schema_version: "falcon24-successor-review-preparation-result@1.0.0" as const,
      terminal: "NOT_RUN" as const,
      reason_code: "FALCON24_SUCCESSOR_REVIEW_PREPARATION_CONFIRMATION_REQUIRED" as const,
    };
  }
  const configuration = configurationSchema.parse({
    database_url: environment.DATABASE_URL,
    deployment_id: environment.WORKER_DEPLOYMENT_ID ?? DEFAULT_DEPLOYMENT_ID,
    workspace_id: environment.WORKER_TENANT_ID ?? DEFAULT_WORKSPACE_ID,
    principal_id: environment.WORKER_PRINCIPAL_ID ?? DEFAULT_PRINCIPAL_ID,
    datasource_id: environment.FALCON24_DATASOURCE_ID ?? DEFAULT_DATASOURCE_ID,
    environment: environment.FALCON24_ENVIRONMENT ?? "local",
  });
  const pool = new pg.Pool({
    connectionString: configuration.database_url,
    application_name: "data-agent-falcon24-successor-review-preparation",
    max: 2,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 120_000,
  });
  try {
    const sqlPool = adaptPgPool(pool);
    const authority = createPostgresCapabilityAuthority(sqlPool);
    const capability = required(
      await authority.resolveForServerContext({
        deployment_id: configuration.deployment_id,
        tenant_id: configuration.workspace_id,
        principal_id: configuration.principal_id,
        access: "WRITE",
      }),
    );
    if (
      capability.scope.app_id !== APP_ID ||
      capability.scope.tenant_id !== configuration.workspace_id ||
      capability.scope.environment !== configuration.environment
    ) {
      throw new TypeError("FALCON24_SUCCESSOR_REVIEW_PREPARATION_SCOPE_MISMATCH");
    }
    const closure = required(
      await createPostgresFalcon24SemanticClosureReader({
        pool: sqlPool,
        authorizer: authority.authorizer,
      }).load(capability, { semantic_domain: SEMANTIC_DOMAIN }),
    );
    if (
      closure.authority.authority_epoch !== "E3" ||
      closure.semantic_pointer.release.generation !== 1 ||
      closure.semantic_pointer.release.datasource_id !== configuration.datasource_id ||
      closure.scope.semantic_domain !== SEMANTIC_DOMAIN
    ) {
      throw new TypeError("FALCON24_SUCCESSOR_REVIEW_PREPARATION_PREFLIGHT_MISMATCH");
    }
    const built = await buildFalcon24SuccessorChangeSet({
      repository_root: REPOSITORY_ROOT,
      scope: closure.scope,
      base_release: {
        release_id: closure.semantic_pointer.release.release_id,
        generation: closure.semantic_pointer.release.generation,
        release_hash: closure.semantic_pointer.release.release_digest,
      },
      expected_datasource_id: configuration.datasource_id,
      revision: 1,
    });
    const publication = createPostgresSemanticPublicationAuthority(pool, {
      appId: capability.scope.app_id,
      workspaceId: capability.scope.tenant_id,
      environment: capability.scope.environment,
      principalId: capability.principal,
      datasourceId: configuration.datasource_id,
      semanticDomain: SEMANTIC_DOMAIN,
    });
    const prepared = await publication.prepareSuccessorReview({
      idempotency_key: falcon24SuccessorOperationId(
        `falcon24:E4:successor-review:${built.change_set.change_set_hash}`,
      ),
      expected_predecessor: {
        release_id: closure.semantic_pointer.release.release_id,
        generation: closure.semantic_pointer.release.generation,
        release_digest: closure.semantic_pointer.release.release_digest,
      },
      expected_pointer_version: closure.semantic_pointer.version,
      change_set: built.change_set,
    });
    return Object.freeze({
      schema_version: "falcon24-successor-review-preparation-result@1.0.0" as const,
      terminal: prepared.candidate_status,
      authority_epoch: closure.authority.authority_epoch,
      predecessor_release: closure.semantic_pointer.release,
      change_set_ref: prepared.change_set_ref,
      review_packet_ref: prepared.review_packet_ref,
      candidate_status: prepared.candidate_status,
      created: prepared.created,
    });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  try {
    const environment = loadRuntimeEnvironment({
      cwd: REPOSITORY_ROOT,
      environment: process.env,
    }).environment;
    Object.assign(process.env, environment);
    const result = await runFalcon24SuccessorReviewPreparation(environment);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.terminal === "NOT_RUN") process.exitCode = 2;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        schema_version: "falcon24-successor-review-preparation-result@1.0.0",
        terminal: "HOLD",
        reason_code: stableFailureCode(error),
      })}\n`,
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1]?.endsWith("prepare-falcon24-semantic-successor-review.ts") ||
  process.argv[1]?.endsWith("prepare-falcon24-semantic-successor-review.js")
) {
  await main();
}
