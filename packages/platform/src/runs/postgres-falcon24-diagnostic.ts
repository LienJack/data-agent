import { contentHashSchema, sha256ContentHash } from "@data-agent/contracts/common";
import {
  FALCON24_DIAGNOSTIC_OBSERVED_EXECUTION_PATH,
  falcon24DiagnosticAttemptDocumentSchema,
  falcon24DiagnosticFailureClassSchema,
  falcon24DiagnosticReceiptDocumentSchema,
  falcon24SandboxReclamationReceiptDocumentSchema,
  qualificationIdForEpoch,
  verifyFalcon24DiagnosticAttemptDocument,
  verifyFalcon24DiagnosticReceiptDocument,
  verifyFalcon24SandboxReclamationReceiptDocument,
} from "@data-agent/contracts/evals";
import { falcon24AuthorityEpochSchema } from "@data-agent/contracts/runs";
import { canonicalImmutableIdSchema } from "@data-agent/contracts/workspaces";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const timestampSchema = z.iso.datetime({ offset: true });
const failureCodeSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[A-Z][A-Z0-9_]{2,127}$/u);

const diagnosticRowSchema = z.strictObject({
  app_id: canonicalImmutableIdSchema,
  tenant_id: canonicalImmutableIdSchema,
  environment: z.string().min(1).max(64),
  principal_id: canonicalImmutableIdSchema,
  attempt_id: canonicalImmutableIdSchema,
  run_id: canonicalImmutableIdSchema,
  authority_epoch: falcon24AuthorityEpochSchema,
  authority_baseline_id: canonicalImmutableIdSchema,
  authority_baseline_hash: contentHashSchema,
  authority_activation_attempt_id: canonicalImmutableIdSchema,
  semantic_domain: z.string().min(1).max(64),
  semantic_release_id: canonicalImmutableIdSchema,
  semantic_release_generation: z.literal(2),
  semantic_release_digest: contentHashSchema,
  datasource_id: canonicalImmutableIdSchema,
  source_commit: z.string().regex(/^[0-9a-f]{40}$/u),
  source_fingerprint: contentHashSchema,
  web_build_id: contentHashSchema,
  web_generation_id: contentHashSchema,
  worker_build_id: contentHashSchema,
  worker_generation_id: contentHashSchema,
  runtime_attestation_hash: contentHashSchema,
  question_hash: contentHashSchema,
  manifest_hash: contentHashSchema,
  manifest_document: falcon24DiagnosticAttemptDocumentSchema,
  status: z.enum(["ACTIVE", "PASSED", "FAILED"]),
  failure_class: falcon24DiagnosticFailureClassSchema.nullable(),
  failure_code: failureCodeSchema.nullable(),
  terminal_receipt_hash: contentHashSchema.nullable(),
  created_at: timestampSchema,
  completed_at: timestampSchema.nullable(),
});

const completeSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    attempt_id: canonicalImmutableIdSchema,
    outcome: z.literal("PASS"),
    viewport_width: z.union([z.literal(390), z.literal(1440)]),
    observed_execution_path: z.tuple([
      z.literal("SEMANTIC"),
      z.literal("TEXT2SQL"),
      z.literal("SQL"),
      z.literal("QUERY_EVIDENCE"),
      z.literal("TYPED_ARROW"),
      z.literal("PYTHON_OPERATOR"),
      z.literal("ANALYSIS_REPORT"),
      z.literal("CHART"),
    ]),
    sandbox_reclamation_receipt: falcon24SandboxReclamationReceiptDocumentSchema,
  }),
  z.strictObject({
    attempt_id: canonicalImmutableIdSchema,
    outcome: z.literal("FAIL"),
    failure_class: falcon24DiagnosticFailureClassSchema,
    failure_code: failureCodeSchema,
  }),
]);

type JsonRow = { readonly value: unknown };

const STABLE_DATABASE_ERRORS = new Set([
  "FALCON24_DIAGNOSTIC_COMMAND_INVALID",
  "FALCON24_DIAGNOSTIC_MANIFEST_INVALID",
  "FALCON24_DIAGNOSTIC_AUTHORITY_MISMATCH",
  "FALCON24_DIAGNOSTIC_SEMANTIC_RELEASE_MISMATCH",
  "FALCON24_DIAGNOSTIC_FORMAL_GATE_ALREADY_STARTED",
  "FALCON24_DIAGNOSTIC_ACTIVE_ATTEMPT_EXISTS",
  "FALCON24_DIAGNOSTIC_ATTEMPT_NOT_FOUND",
  "FALCON24_DIAGNOSTIC_ATTEMPT_IMMUTABLE",
  "FALCON24_DIAGNOSTIC_RUN_NOT_READY",
  "FALCON24_DIAGNOSTIC_UI_RECEIPT_PAIR_REQUIRED",
  "FALCON24_DIAGNOSTIC_ARTIFACT_CLOSURE_INVALID",
  "FALCON24_DIAGNOSTIC_REPLAY_MISMATCH",
]);

function mapDatabaseError(error: unknown) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? (error as { readonly message?: unknown }).message
      : null;
  if (typeof message !== "string" || !STABLE_DATABASE_ERRORS.has(message)) return null;
  return {
    ok: false as const,
    error: { code: message, message: "Falcon24 诊断权威拒绝当前操作。", retryable: false },
  };
}

function exact(rows: readonly JsonRow[]): unknown {
  if (rows.length !== 1) {
    throw new PersistenceBoundaryError(
      "FALCON24_DIAGNOSTIC_DATABASE_CONTRACT_INVALID",
      "Falcon24 Diagnostic RPC 必须返回恰好一行。",
    );
  }
  return rows[0]?.value;
}

async function commandWithHash<T extends Record<string, unknown>>(command: T) {
  return { ...command, command_hash: await sha256ContentHash(command) } as const;
}

export function createPostgresFalcon24DiagnosticAuthority(input: {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
}) {
  const invoke = async <T>(options: {
    readonly capability: unknown;
    readonly access: "READ" | "WRITE";
    readonly operation: string;
    readonly command: unknown;
    readonly semantic_domain?: string;
    readonly parse: (value: unknown) => T | Promise<T>;
  }) =>
    withAppTransaction(
      input.pool,
      input.authorizer,
      options.capability,
      {
        access: options.access,
        allowed_roles: ["OWNER", "ANALYST"],
        operation_name: options.operation,
        map_database_error: mapDatabaseError,
      },
      async ({ client }) => {
        if (options.semantic_domain) {
          await client.query("select pg_catalog.set_config('app.semantic_domain',$1,true)", [
            options.semantic_domain,
          ]);
        }
        const result = await client.query<JsonRow>(
          `select app_data_agent.${options.operation}($1::jsonb) as value`,
          [options.command],
        );
        return options.parse(exact(result.rows));
      },
    );

  return Object.freeze({
    async begin(capability: unknown, candidate: unknown) {
      const manifest = await verifyFalcon24DiagnosticAttemptDocument(candidate);
      const command = await commandWithHash({
        schema_version:
          manifest.schema_version === "falcon24-diagnostic-attempt@2.0.0"
            ? ("falcon24-diagnostic-begin@2.0.0" as const)
            : ("falcon24-diagnostic-begin@1.0.0" as const),
        manifest,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "begin_falcon24_diagnostic",
        command,
        semantic_domain: "falcon24",
        parse: (raw) => diagnosticRowSchema.parse(raw),
      });
    },

    async load(capability: unknown, attemptId: unknown) {
      const attempt_id = canonicalImmutableIdSchema.parse(attemptId);
      const command = await commandWithHash({
        schema_version: "falcon24-diagnostic-load@1.0.0" as const,
        attempt_id,
      });
      return invoke({
        capability,
        access: "READ",
        operation: "load_falcon24_diagnostic",
        command,
        parse: (raw) => (raw === null ? null : diagnosticRowSchema.parse(raw)),
      });
    },

    async complete(capability: unknown, candidate: unknown) {
      const request = completeSchema.parse(candidate);
      if (
        request.outcome === "PASS" &&
        request.observed_execution_path.some(
          (step, index) => step !== FALCON24_DIAGNOSTIC_OBSERVED_EXECUTION_PATH[index],
        )
      ) {
        throw new TypeError("FALCON24_DIAGNOSTIC_EXECUTION_PATH_INVALID");
      }
      if (
        request.outcome === "PASS" &&
        (request.sandbox_reclamation_receipt.schema_version !==
          "falcon24-sandbox-reclamation-receipt@3.0.0" ||
          request.sandbox_reclamation_receipt.campaign_id !==
            qualificationIdForEpoch(request.sandbox_reclamation_receipt.authority_epoch))
      ) {
        throw new TypeError("FALCON24_DIAGNOSTIC_RECLAMATION_RECEIPT_INVALID");
      }
      if (request.outcome === "PASS") {
        await verifyFalcon24SandboxReclamationReceiptDocument(request.sandbox_reclamation_receipt);
      }
      const command = await commandWithHash({
        schema_version: "falcon24-diagnostic-complete@1.0.0" as const,
        ...request,
      });
      return invoke({
        capability,
        access: "WRITE",
        operation: "complete_falcon24_diagnostic",
        command,
        parse: async (raw) =>
          verifyFalcon24DiagnosticReceiptDocument(
            falcon24DiagnosticReceiptDocumentSchema.parse(raw),
          ),
      });
    },
  });
}
