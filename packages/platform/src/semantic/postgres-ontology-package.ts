import {
  immutableIdSchema,
  type OntologyPackageCandidate,
  type OntologyPackageCandidateCommitReceipt,
  type OntologyPackagePreviewBindingCommand,
  type OntologyPackagePreviewBindingReceipt,
  type OntologyPackagePreviewLoadResult,
  type OntologyPackageValidationCommitReceipt,
  type OntologyPackageValidationReceipt,
  ontologyPackageCandidateCommitReceiptSchema,
  ontologyPackageCandidateSchema,
  ontologyPackagePreviewBindingCommandSchema,
  ontologyPackagePreviewBindingReceiptSchema,
  ontologyPackagePreviewLoadResultSchema,
  ontologyPackageValidationCommitReceiptSchema,
  ontologyPackageValidationReceiptSchema,
  type PortResult,
  sha256ContentHash,
  verifyOntologyPackageCandidate,
  verifyOntologyPackageValidationReceipt,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  PersistenceBoundaryError,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

const semanticDomainSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);

interface JsonValueRow {
  readonly value: unknown;
}

export interface OntologyPackageCandidateCommitInput {
  readonly semantic_domain: string;
  readonly candidate_id: string;
  readonly revision_id: string;
  readonly candidate: OntologyPackageCandidate;
}

export interface OntologyPackageValidationCommitInput {
  readonly semantic_domain: string;
  readonly receipt: OntologyPackageValidationReceipt;
}

export interface OntologyPackagePreviewBindInput {
  readonly semantic_domain: string;
  readonly command: OntologyPackagePreviewBindingCommand;
}

export interface PostgresOntologyPackageStore {
  commitCandidate(
    capability: unknown,
    input: OntologyPackageCandidateCommitInput,
  ): Promise<PortResult<OntologyPackageCandidateCommitReceipt>>;
  commitValidation(
    capability: unknown,
    input: OntologyPackageValidationCommitInput,
  ): Promise<PortResult<OntologyPackageValidationCommitReceipt>>;
  bindPreview(
    capability: unknown,
    input: OntologyPackagePreviewBindInput,
  ): Promise<PortResult<OntologyPackagePreviewBindingReceipt>>;
  getPreview(
    capability: unknown,
    semanticDomain: string,
    packageId: string,
    packageVersion: number,
  ): Promise<PortResult<OntologyPackagePreviewLoadResult | null>>;
}

function databaseFailure(error: unknown): PortResult<never> | null {
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  if (message.includes("IDEMPOTENCY_CONFLICT")) {
    return {
      ok: false,
      error: {
        code: "ONTOLOGY_PACKAGE_IDEMPOTENCY_CONFLICT",
        message: "Ontology Package identity 已绑定到不同内容。",
        retryable: false,
      },
    };
  }
  if (message.includes("NOT_FOUND")) {
    return {
      ok: false,
      error: {
        code: "ONTOLOGY_PACKAGE_AUTHORITY_NOT_FOUND",
        message: "Ontology Package 引用的 Candidate、Validation 或 Graph Projection 不存在。",
        retryable: false,
      },
    };
  }
  if (message.includes("INVALID") || message.includes("MISMATCH")) {
    return {
      ok: false,
      error: {
        code: "ONTOLOGY_PACKAGE_CONTRACT_INVALID",
        message: "Ontology Package Authority 契约或引用闭包无效。",
        retryable: false,
      },
    };
  }
  return null;
}

function oneValue(rows: readonly JsonValueRow[]): unknown {
  if (rows.length !== 1) {
    throw new PersistenceBoundaryError(
      "ONTOLOGY_PACKAGE_DATABASE_CONTRACT_INVALID",
      "Ontology Package RPC 返回了无效行数。",
      false,
    );
  }
  return rows[0]?.value;
}

function parseValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new PersistenceBoundaryError(
      "ONTOLOGY_PACKAGE_DATABASE_CONTRACT_INVALID",
      "Ontology Package RPC 返回了无效契约。",
      false,
    );
  }
  return parsed.data;
}

async function setSemanticDomain(
  client: { query(text: string, values?: readonly unknown[]): Promise<unknown> },
  semanticDomain: string,
): Promise<void> {
  await client.query("select pg_catalog.set_config('app.semantic_domain', $1, true)", [
    semanticDomain,
  ]);
}

function assertCandidateCommitCorrelation(
  input: OntologyPackageCandidateCommitInput,
  receipt: OntologyPackageCandidateCommitReceipt,
): void {
  if (
    receipt.namespace_id !== input.candidate.namespace.namespace_id ||
    receipt.package_id !== input.candidate.package_id ||
    receipt.package_version !== input.candidate.package_version ||
    receipt.package_hash !== input.candidate.package_hash ||
    receipt.candidate_id !== input.candidate_id ||
    receipt.revision_id !== input.revision_id
  ) {
    throw new PersistenceBoundaryError(
      "ONTOLOGY_PACKAGE_DATABASE_CONTRACT_INVALID",
      "Candidate commit receipt 与请求不一致。",
      false,
    );
  }
}

function assertValidationCorrelation(
  input: OntologyPackageValidationReceipt,
  receipt: OntologyPackageValidationCommitReceipt,
): void {
  if (
    receipt.receipt_id !== input.receipt_id ||
    receipt.namespace_id !== input.namespace.namespace_id ||
    receipt.package_id !== input.package_id ||
    receipt.package_version !== input.package_version ||
    receipt.package_hash !== input.package_hash ||
    receipt.receipt_hash !== input.receipt_hash ||
    receipt.valid !== input.valid
  ) {
    throw new PersistenceBoundaryError(
      "ONTOLOGY_PACKAGE_DATABASE_CONTRACT_INVALID",
      "Validation commit receipt 与请求不一致。",
      false,
    );
  }
}

async function assertPreviewCorrelation(
  input: OntologyPackagePreviewBindingCommand,
  receipt: OntologyPackagePreviewBindingReceipt,
): Promise<void> {
  if (
    receipt.preview_id !== input.preview_id ||
    receipt.namespace_id !== input.preview.namespace_id ||
    receipt.package_id !== input.preview.package_id ||
    receipt.package_version !== input.preview.package_version ||
    receipt.package_hash !== input.preview.package_hash ||
    receipt.validation_receipt_id !== input.validation_receipt_id ||
    receipt.validation_receipt_hash !== input.validation_receipt_hash ||
    receipt.projection_id !== input.projection_id ||
    receipt.projection_storage_digest !== input.projection_storage_digest ||
    receipt.preview_hash !== (await sha256ContentHash(input.preview))
  ) {
    throw new PersistenceBoundaryError(
      "ONTOLOGY_PACKAGE_DATABASE_CONTRACT_INVALID",
      "Preview binding receipt 与请求不一致。",
      false,
    );
  }
}

export function createPostgresOntologyPackageStore(
  options: Readonly<{ pool: SqlPool; authorizer: TransactionalCapabilityAuthorizer }>,
): PostgresOntologyPackageStore {
  const transaction = async <T>(
    capability: unknown,
    access: "READ" | "WRITE",
    operationName: string,
    semanticDomain: string,
    work: Parameters<typeof withAppTransaction<T>>[4],
  ): Promise<PortResult<T>> =>
    withAppTransaction(
      options.pool,
      options.authorizer,
      capability,
      {
        access,
        operation_name: operationName,
        correlation_id: semanticDomain,
        map_database_error: databaseFailure,
      },
      async (context) => {
        await setSemanticDomain(context.client, semanticDomain);
        return work(context);
      },
    );

  return {
    async commitCandidate(capabilityInput, input) {
      const semanticDomain = semanticDomainSchema.parse(input.semantic_domain);
      const candidateId = immutableIdSchema.parse(input.candidate_id);
      const revisionId = immutableIdSchema.parse(input.revision_id);
      const candidate = ontologyPackageCandidateSchema.parse(input.candidate);
      if (!(await verifyOntologyPackageCandidate(candidate))) {
        return {
          ok: false,
          error: {
            code: "ONTOLOGY_PACKAGE_CONTRACT_INVALID",
            message: "Candidate canonical hash 或闭包无效。",
            retryable: false,
          },
        };
      }
      return transaction(
        capabilityInput,
        "WRITE",
        "semantic.commit_ontology_package_candidate",
        semanticDomain,
        async ({ capability, client }) => {
          if (
            candidate.namespace.app_id !== capability.scope.app_id ||
            candidate.namespace.tenant_id !== capability.scope.tenant_id ||
            candidate.namespace.environment !== capability.scope.environment ||
            candidate.namespace.semantic_domain !== semanticDomain
          ) {
            throw new PersistenceBoundaryError(
              "ONTOLOGY_PACKAGE_CONTRACT_INVALID",
              "Candidate Namespace 与 AppCapability 不一致。",
              false,
            );
          }
          const result = await client.query<JsonValueRow>(
            `select semantic.commit_ontology_package_candidate(
               $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,$7::uuid,$8::jsonb
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              semanticDomain,
              candidateId,
              revisionId,
              candidate,
            ],
          );
          const receipt = parseValue(
            ontologyPackageCandidateCommitReceiptSchema,
            oneValue(result.rows),
          );
          assertCandidateCommitCorrelation(
            {
              semantic_domain: semanticDomain,
              candidate_id: candidateId,
              revision_id: revisionId,
              candidate,
            },
            receipt,
          );
          return receipt;
        },
      );
    },

    async commitValidation(capabilityInput, input) {
      const semanticDomain = semanticDomainSchema.parse(input.semantic_domain);
      const receipt = ontologyPackageValidationReceiptSchema.parse(input.receipt);
      if (!(await verifyOntologyPackageValidationReceipt(receipt))) {
        return {
          ok: false,
          error: {
            code: "ONTOLOGY_PACKAGE_CONTRACT_INVALID",
            message: "Validation Receipt canonical hash 无效。",
            retryable: false,
          },
        };
      }
      return transaction(
        capabilityInput,
        "WRITE",
        "semantic.commit_ontology_package_validation",
        semanticDomain,
        async ({ capability, client }) => {
          const result = await client.query<JsonValueRow>(
            `select semantic.commit_ontology_package_validation(
               $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::jsonb
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              semanticDomain,
              receipt,
            ],
          );
          const committed = parseValue(
            ontologyPackageValidationCommitReceiptSchema,
            oneValue(result.rows),
          );
          assertValidationCorrelation(receipt, committed);
          return committed;
        },
      );
    },

    async bindPreview(capabilityInput, input) {
      const semanticDomain = semanticDomainSchema.parse(input.semantic_domain);
      const command = ontologyPackagePreviewBindingCommandSchema.parse(input.command);
      return transaction(
        capabilityInput,
        "WRITE",
        "semantic.bind_ontology_package_preview",
        semanticDomain,
        async ({ capability, client }) => {
          const result = await client.query<JsonValueRow>(
            `select semantic.bind_ontology_package_preview(
               $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::jsonb
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              semanticDomain,
              command,
            ],
          );
          const receipt = parseValue(
            ontologyPackagePreviewBindingReceiptSchema,
            oneValue(result.rows),
          );
          await assertPreviewCorrelation(command, receipt);
          return receipt;
        },
      );
    },

    async getPreview(capabilityInput, semanticDomainInput, packageIdInput, packageVersionInput) {
      const semanticDomain = semanticDomainSchema.parse(semanticDomainInput);
      const packageId = immutableIdSchema.parse(packageIdInput);
      const packageVersion = z.number().int().positive().safe().parse(packageVersionInput);
      return transaction(
        capabilityInput,
        "READ",
        "semantic.get_ontology_package_preview",
        semanticDomain,
        async ({ capability, client }) => {
          const result = await client.query<JsonValueRow>(
            `select semantic.get_ontology_package_preview(
               $1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::uuid,$7::bigint
             ) as value`,
            [
              capability.scope.app_id,
              capability.scope.tenant_id,
              capability.scope.environment,
              capability.principal,
              semanticDomain,
              packageId,
              packageVersion,
            ],
          );
          const value = oneValue(result.rows);
          if (value === null) return null;
          const loaded = parseValue(ontologyPackagePreviewLoadResultSchema, value);
          if (
            loaded.binding.package_id !== packageId ||
            loaded.binding.package_version !== packageVersion ||
            loaded.binding.namespace_id !== loaded.preview.namespace_id ||
            loaded.binding.package_hash !== loaded.preview.package_hash ||
            loaded.binding.preview_hash !== (await sha256ContentHash(loaded.preview))
          ) {
            throw new PersistenceBoundaryError(
              "ONTOLOGY_PACKAGE_DATABASE_CONTRACT_INVALID",
              "Preview read receipt 与请求不一致。",
              false,
            );
          }
          return loaded;
        },
      );
    },
  };
}
