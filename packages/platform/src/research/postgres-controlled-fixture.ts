import type { PortResult } from "@data-agent/contracts";
import {
  appScopeSchema,
  type ControlledFixtureContract,
  contentHashSchema,
  controlledFixtureContractSchema,
  databaseUtcTimestampSchema,
  idempotencyKeySchema,
  immutableIdSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import {
  type AppTransactionOptions,
  PersistenceBoundaryError,
  type SqlClient,
  type SqlPool,
  withAppTransaction,
} from "../persistence/transaction.js";
import type { TransactionalCapabilityAuthorizer } from "../tenancy/transactional-authority.internal.js";

// ──────────────────────────────────────────────────
// 1. Zod Schemas for fixture storage & retrieval
// ──────────────────────────────────────────────────

const _DEFAULT_LOCK_RETRY_DELAYS_MS = Object.freeze([10, 25, 50] as const);

const _lockRetryDelaysSchema = z
  .array(z.number().int().positive())
  .min(1)
  .max(10)
  .default([10, 25, 50]);

const fixtureIdSchema = z.literal("retail-revenue-investigation-v1");
const protocolVersionSchema = z.literal("u6-controlled-fixture@1.0.0");

const storeFixtureContractInputSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
  fixture_id: fixtureIdSchema,
  protocol_version: protocolVersionSchema,
  fixture_hash: contentHashSchema,
  contract: controlledFixtureContractSchema,
  idempotency_key: idempotencyKeySchema,
});

type StoreFixtureContractInput = z.infer<typeof storeFixtureContractInputSchema>;

const storedFixtureContractResultSchema = z.strictObject({
  created: z.boolean(),
  fixture_hash: contentHashSchema,
});

type StoredFixtureContractResult = z.infer<typeof storedFixtureContractResultSchema>;

const readFixtureContractInputSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
  fixture_id: fixtureIdSchema,
  protocol_version: protocolVersionSchema,
});

type ReadFixtureContractInput = z.infer<typeof readFixtureContractInputSchema>;

const fixtureCaseEvaluationInputSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
  fixture_id: fixtureIdSchema,
  case_id: z.string().min(1).max(128),
  mutation_id: z.string().min(1).max(128),
  run_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  evaluation_result: z.string().min(1).max(64),
  evaluation_detail: z.string().optional(),
  idempotency_key: idempotencyKeySchema,
});

type FixtureCaseEvaluationInput = z.infer<typeof fixtureCaseEvaluationInputSchema>;

const storedFixtureCaseEvaluationResultSchema = z.strictObject({
  created: z.boolean(),
  evaluation_id: immutableIdSchema,
});

type StoredFixtureCaseEvaluationResult = z.infer<typeof storedFixtureCaseEvaluationResultSchema>;

const queryFixtureCaseEvaluationsInputSchema = z.strictObject({
  schema_version: z.literal("1.0.0"),
  scope: appScopeSchema,
  fixture_id: fixtureIdSchema,
  case_id: z.string().optional(),
  mutation_id: z.string().optional(),
});

type QueryFixtureCaseEvaluationsInput = z.infer<typeof queryFixtureCaseEvaluationsInputSchema>;

const fixtureCaseEvaluationRecordSchema = z.strictObject({
  evaluation_id: immutableIdSchema,
  fixture_id: fixtureIdSchema,
  case_id: z.string(),
  mutation_id: z.string(),
  run_id: immutableIdSchema,
  attempt_id: immutableIdSchema,
  evaluation_result: z.string(),
  evaluation_detail: z.string().nullable(),
  created_at: databaseUtcTimestampSchema,
});

const fixtureCaseEvaluationsResultSchema = z.strictObject({
  evaluations: z.array(fixtureCaseEvaluationRecordSchema),
});

type FixtureCaseEvaluationsResult = z.infer<typeof fixtureCaseEvaluationsResultSchema>;

// ──────────────────────────────────────────────────
// 2. Capability & factory types
// ──────────────────────────────────────────────────

export interface PostgresControlledFixtureOptions {
  readonly pool: SqlPool;
  readonly authorizer: TransactionalCapabilityAuthorizer;
  readonly lock_retry_delays_ms?: readonly number[];
  readonly sleep?: (delayMs: number) => Promise<void>;
}

const capabilityInputSchema = z.strictObject({
  app_capability: z.unknown().refine((value) => value !== undefined),
  authority_capability_id: immutableIdSchema,
});

export interface PostgresControlledFixture {
  /** Store a fixture contract in the database. Returns true if created, false if idempotent replay. */
  storeFixtureContract(
    capabilityInput: unknown,
    input: StoreFixtureContractInput,
  ): Promise<PortResult<StoredFixtureContractResult>>;

  /** Read a fixture contract from the database. */
  readFixtureContract(
    capabilityInput: unknown,
    input: ReadFixtureContractInput,
  ): Promise<PortResult<ControlledFixtureContract>>;

  /** Persist a fixture case evaluation result. */
  persistCaseEvaluation(
    capabilityInput: unknown,
    input: FixtureCaseEvaluationInput,
  ): Promise<PortResult<StoredFixtureCaseEvaluationResult>>;

  /** Query fixture case evaluations by scope + fixture_id, optionally filtered by case_id or mutation_id. */
  queryCaseEvaluations(
    capabilityInput: unknown,
    input: QueryFixtureCaseEvaluationsInput,
  ): Promise<PortResult<FixtureCaseEvaluationsResult>>;
}

// ──────────────────────────────────────────────────
// 3. Internal helpers
// ──────────────────────────────────────────────────

function _sleepWithTimer(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function makeTransactionOptions(
  operationName: string,
  correlationId: string,
): AppTransactionOptions {
  return {
    access: "WRITE",
    operation_name: operationName,
    correlation_id: correlationId,
  };
}

function makeReadTransactionOptions(
  operationName: string,
  correlationId: string,
): AppTransactionOptions {
  return {
    access: "READ",
    operation_name: operationName,
    correlation_id: correlationId,
  };
}

// ──────────────────────────────────────────────────
// 4. Factory
// ──────────────────────────────────────────────────

export function createPostgresControlledFixture(
  options: PostgresControlledFixtureOptions,
): PostgresControlledFixture {
  const pool: SqlPool = options.pool;
  const authorizer: TransactionalCapabilityAuthorizer = options.authorizer;

  async function storeFixtureContract(
    capabilityInput: unknown,
    input: StoreFixtureContractInput,
  ): Promise<PortResult<StoredFixtureContractResult>> {
    const parsedCapability = capabilityInputSchema.parse(capabilityInput);
    const parsedInput = storeFixtureContractInputSchema.parse(input);

    return withAppTransaction(
      pool,
      authorizer,
      parsedCapability,
      makeTransactionOptions("controlled_fixture.store_contract", parsedInput.scope.app_id),
      async ({ client }: { client: SqlClient }) => {
        // Check for idempotent replay
        const existingResult = await client.query<{ fixture_hash: string }>(
          `SELECT fixture_hash
           FROM u6_research_fixture_contracts
           WHERE app_id = $1 AND tenant_id = $2 AND environment = $3
             AND fixture_id = $4 AND protocol_version = $5`,
          [
            parsedInput.scope.app_id,
            parsedInput.scope.tenant_id,
            parsedInput.scope.environment,
            parsedInput.fixture_id,
            parsedInput.protocol_version,
          ],
        );

        if (existingResult.rows.length > 0) {
          const fixtureHash = (existingResult.rows[0] as { fixture_hash: string })
            .fixture_hash as `sha256:${string}`;
          return {
            created: false,
            fixture_hash: fixtureHash,
          };
        }

        // Insert the fixture contract
        await client.query(
          `INSERT INTO u6_research_fixture_contracts
           (app_id, tenant_id, environment, fixture_id, protocol_version,
            fixture_hash, contract_json, idempotency_key, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            parsedInput.scope.app_id,
            parsedInput.scope.tenant_id,
            parsedInput.scope.environment,
            parsedInput.fixture_id,
            parsedInput.protocol_version,
            parsedInput.fixture_hash,
            JSON.stringify(parsedInput.contract),
            parsedInput.idempotency_key,
          ],
        );

        return {
          created: true,
          fixture_hash: parsedInput.fixture_hash,
        };
      },
    );
  }

  async function readFixtureContract(
    capabilityInput: unknown,
    input: ReadFixtureContractInput,
  ): Promise<PortResult<ControlledFixtureContract>> {
    const parsedCapability = capabilityInputSchema.parse(capabilityInput);
    const parsedInput = readFixtureContractInputSchema.parse(input);

    return withAppTransaction(
      pool,
      authorizer,
      parsedCapability,
      makeReadTransactionOptions("controlled_fixture.read_contract", parsedInput.scope.app_id),
      async ({ client }: { client: SqlClient }) => {
        const result = await client.query<{ contract_json: string }>(
          `SELECT contract_json
           FROM u6_research_fixture_contracts
           WHERE app_id = $1 AND tenant_id = $2 AND environment = $3
             AND fixture_id = $4 AND protocol_version = $5`,
          [
            parsedInput.scope.app_id,
            parsedInput.scope.tenant_id,
            parsedInput.scope.environment,
            parsedInput.fixture_id,
            parsedInput.protocol_version,
          ],
        );

        if (result.rows.length === 0) {
          throw new PersistenceBoundaryError(
            "FIXTURE_CONTRACT_NOT_FOUND",
            "Fixture contract not found for the given scope and fixture ID.",
          );
        }

        const contract = controlledFixtureContractSchema.parse(
          JSON.parse((result.rows[0] as { contract_json: string }).contract_json),
        );
        return contract;
      },
    );
  }

  async function persistCaseEvaluation(
    capabilityInput: unknown,
    input: FixtureCaseEvaluationInput,
  ): Promise<PortResult<StoredFixtureCaseEvaluationResult>> {
    const parsedCapability = capabilityInputSchema.parse(capabilityInput);
    const parsedInput = fixtureCaseEvaluationInputSchema.parse(input);

    return withAppTransaction(
      pool,
      authorizer,
      parsedCapability,
      makeTransactionOptions("controlled_fixture.persist_evaluation", parsedInput.scope.app_id),
      async ({ client }: { client: SqlClient }) => {
        // Check for idempotent replay
        const existingResult = await client.query<{ evaluation_id: string }>(
          `SELECT evaluation_id
           FROM u6_research_fixture_case_evaluations
           WHERE app_id = $1 AND tenant_id = $2 AND environment = $3
             AND fixture_id = $4 AND case_id = $5
             AND idempotency_key = $6`,
          [
            parsedInput.scope.app_id,
            parsedInput.scope.tenant_id,
            parsedInput.scope.environment,
            parsedInput.fixture_id,
            parsedInput.case_id,
            parsedInput.idempotency_key,
          ],
        );

        if (existingResult.rows.length > 0) {
          return {
            created: false,
            evaluation_id: existingResult.rows[0]?.evaluation_id as `{${string}}`,
          };
        }

        const evaluationId = crypto.randomUUID();
        await client.query(
          `INSERT INTO u6_research_fixture_case_evaluations
           (app_id, tenant_id, environment, fixture_id, case_id, mutation_id,
            run_id, attempt_id, evaluation_id, evaluation_result, evaluation_detail,
            idempotency_key, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
          [
            parsedInput.scope.app_id,
            parsedInput.scope.tenant_id,
            parsedInput.scope.environment,
            parsedInput.fixture_id,
            parsedInput.case_id,
            parsedInput.mutation_id,
            parsedInput.run_id,
            parsedInput.attempt_id,
            evaluationId,
            parsedInput.evaluation_result,
            parsedInput.evaluation_detail ?? null,
            parsedInput.idempotency_key,
          ],
        );

        return {
          created: true,
          evaluation_id: evaluationId as `{${string}}`,
        };
      },
    );
  }

  async function queryCaseEvaluations(
    capabilityInput: unknown,
    input: QueryFixtureCaseEvaluationsInput,
  ): Promise<PortResult<FixtureCaseEvaluationsResult>> {
    const parsedCapability = capabilityInputSchema.parse(capabilityInput);
    const parsedInput = queryFixtureCaseEvaluationsInputSchema.parse(input);

    return withAppTransaction(
      pool,
      authorizer,
      parsedCapability,
      makeReadTransactionOptions("controlled_fixture.query_evaluations", parsedInput.scope.app_id),
      async ({ client }: { client: SqlClient }) => {
        let whereClause = `WHERE app_id = $1 AND tenant_id = $2 AND environment = $3 AND fixture_id = $4`;
        const params: unknown[] = [
          parsedInput.scope.app_id,
          parsedInput.scope.tenant_id,
          parsedInput.scope.environment,
          parsedInput.fixture_id,
        ];
        let paramIndex = 5;

        if (parsedInput.case_id) {
          whereClause += ` AND case_id = $${paramIndex}`;
          params.push(parsedInput.case_id);
          paramIndex++;
        }
        if (parsedInput.mutation_id) {
          whereClause += ` AND mutation_id = $${paramIndex}`;
          params.push(parsedInput.mutation_id);
          paramIndex++;
        }

        const result = await client.query<{
          evaluation_id: string;
          fixture_id: string;
          case_id: string;
          mutation_id: string;
          run_id: string;
          attempt_id: string;
          evaluation_result: string;
          evaluation_detail: string | null;
          created_at: string;
        }>(
          `SELECT evaluation_id, fixture_id, case_id, mutation_id,
                  run_id, attempt_id, evaluation_result, evaluation_detail, created_at
           FROM u6_research_fixture_case_evaluations
           ${whereClause}
           ORDER BY created_at DESC`,
          params,
        );

        const evaluations = result.rows.map((row) =>
          fixtureCaseEvaluationRecordSchema.parse({
            evaluation_id: row.evaluation_id,
            fixture_id: row.fixture_id,
            case_id: row.case_id,
            mutation_id: row.mutation_id,
            run_id: row.run_id,
            attempt_id: row.attempt_id,
            evaluation_result: row.evaluation_result,
            evaluation_detail: row.evaluation_detail,
            created_at: row.created_at,
          }),
        );

        return { evaluations };
      },
    );
  }

  return {
    storeFixtureContract,
    readFixtureContract,
    persistCaseEvaluation,
    queryCaseEvaluations,
  };
}
