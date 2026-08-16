import {
  type ArchiveModelProviderConnectionInput,
  archiveModelProviderConnectionInputSchema,
  type FxRateCandidate,
  fxRateCandidateSchema,
  type ModelCatalogEntry,
  type ModelCatalogStatusInput,
  type ModelPriceCandidate,
  type ModelProviderConnection,
  type ModelProviderSelectionInput,
  modelCatalogEntrySchema,
  modelCatalogStatusInputSchema,
  modelPriceCandidateSchema,
  modelProviderConnectionSchema,
  modelProviderSelectionInputSchema,
  type PricingCandidateDecisionInput,
  pricingCandidateDecisionInputSchema,
  type SubmitFxRateSyncInput,
  type SubmitModelPriceSyncInput,
  submitFxRateSyncInputSchema,
  submitModelPriceSyncInputSchema,
  type UpsertModelCatalogEntryInput,
  type UpsertModelProviderConnectionInput,
  upsertModelCatalogEntryInputSchema,
  upsertModelProviderConnectionInputSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import type { SqlClient, SqlPool } from "../persistence/transaction.js";
import { type BoundaryResult, failure } from "../tenancy/capability.js";

const adminContextSchema = z.strictObject({
  deployment_id: z.uuid(),
  principal_id: z.uuid(),
});

const pricingFailureSchema = z.strictObject({
  operation_id: z.uuid(),
  source_kind: z.enum(["MODEL_PRICE", "FX_RATE"]),
  source_adapter: z.string().min(1).max(128),
  source_url: z.url().max(2048),
  parser_version: z.string().min(1).max(128),
  fetched_at: z.iso.datetime({ offset: true }),
  raw_evidence: z.string().max(65_536).default(""),
  error_code: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/),
});

export type PricingAdminContext = z.infer<typeof adminContextSchema>;
export type PricingSyncFailure = z.infer<typeof pricingFailureSchema>;
export interface PricingDecisionReceipt {
  readonly candidate_kind: "MODEL_PRICE" | "FX_RATE";
  readonly candidate_id: string;
  readonly decision: "APPROVE" | "REJECT";
  readonly version_id: string | null;
}

interface ModelCatalogRow {
  readonly app_id: string;
  readonly environment: string;
  readonly model_profile_id: string;
  readonly provider_connection_id?: string;
  readonly provider: ModelCatalogEntry["provider"];
  readonly model_id: string;
  readonly display_name: string;
  readonly base_url: string;
  readonly capabilities: unknown;
  readonly credential_ref: unknown | null;
  readonly status: ModelCatalogEntry["status"];
  readonly config_version: number | string;
  readonly is_system_default: boolean;
  readonly created_by: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface ModelProviderConnectionRow {
  readonly app_id: string;
  readonly environment: string;
  readonly provider_connection_id: string;
  readonly vendor_id: ModelProviderConnection["vendor_id"];
  readonly runtime_provider: ModelProviderConnection["runtime_provider"];
  readonly display_name: string;
  readonly base_url: string;
  readonly credential_ref: unknown | null;
  readonly source: ModelProviderConnection["source"];
  readonly status: ModelProviderConnection["status"];
  readonly health: ModelProviderConnection["health"];
  readonly config_version: number | string;
  readonly created_by: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

interface PriceCandidateEnvelopeRow {
  readonly candidate: {
    readonly candidate: Record<string, unknown>;
    readonly components: readonly Record<string, unknown>[];
  };
}

interface FxCandidateRow extends Record<string, unknown> {
  readonly candidate_id: string;
  readonly base_currency: string;
  readonly quote_currency: string;
  readonly rate: string;
  readonly official_date: Date | string;
  readonly source_url: string;
  readonly evidence_hash: string;
  readonly parser_version: string;
  readonly fetched_at: Date | string;
  readonly status: FxRateCandidate["status"];
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function date(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function model(row: ModelCatalogRow): ModelCatalogEntry {
  return modelCatalogEntrySchema.parse({
    schema_version: "model-catalog-entry@1.0.0",
    ...row,
    config_version: Number(row.config_version),
    created_at: timestamp(row.created_at),
    updated_at: timestamp(row.updated_at),
  });
}

function providerConnection(row: ModelProviderConnectionRow): ModelProviderConnection {
  return modelProviderConnectionSchema.parse({
    schema_version: "model-provider-connection@1.0.0",
    ...row,
    config_version: Number(row.config_version),
    created_at: timestamp(row.created_at),
    updated_at: timestamp(row.updated_at),
  });
}

function priceCandidate(row: PriceCandidateEnvelopeRow): ModelPriceCandidate {
  const candidate = row.candidate.candidate;
  return modelPriceCandidateSchema.parse({
    schema_version: "model-price-candidate@1.0.0",
    candidate_id: candidate.candidate_id,
    provider: candidate.provider,
    model_id: candidate.model_id,
    status: candidate.status,
    source_url: candidate.source_url,
    evidence_hash: candidate.evidence_hash,
    parser_version: candidate.parser_version,
    fetched_at: timestamp(candidate.fetched_at as Date | string),
    risk: candidate.risk,
    components: row.candidate.components.map((component) => ({
      component_id: component.component_id,
      kind: component.kind,
      unit: component.unit,
      unit_price: String(component.unit_price),
      currency: component.currency,
      tier_min_inclusive:
        component.tier_min_inclusive === null ? null : String(component.tier_min_inclusive),
      tier_max_exclusive:
        component.tier_max_exclusive === null ? null : String(component.tier_max_exclusive),
    })),
  });
}

function fxCandidate(row: FxCandidateRow): FxRateCandidate {
  return fxRateCandidateSchema.parse({
    schema_version: "fx-rate-candidate@1.0.0",
    candidate_id: row.candidate_id,
    base_currency: row.base_currency,
    quote_currency: row.quote_currency,
    rate: String(row.rate),
    official_date: date(row.official_date),
    source_url: row.source_url,
    evidence_hash: row.evidence_hash,
    parser_version: row.parser_version,
    fetched_at: timestamp(row.fetched_at),
    status: row.status,
  });
}

function isDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["42501", "P0002"].includes(String(error.code))
  );
}

async function withClient<T>(
  pool: SqlPool,
  operation: (client: SqlClient) => Promise<T>,
): Promise<BoundaryResult<T>> {
  let client: SqlClient;
  try {
    client = await pool.connect();
  } catch {
    return failure("PRICING_CONTROL_UNAVAILABLE", "模型计费控制面暂时不可用。", true);
  }
  try {
    return { ok: true, value: await operation(client) };
  } catch (error) {
    return isDenied(error)
      ? failure("SUPER_ADMIN_REQUIRED", "只有超级管理员可以访问模型计费控制面。")
      : failure("PRICING_CONTROL_OPERATION_FAILED", "模型计费控制面操作失败。", true);
  } finally {
    client.release();
  }
}

export function createPostgresPricingControlRepository(pool: SqlPool) {
  function context(input: unknown): BoundaryResult<PricingAdminContext> {
    const parsed = adminContextSchema.safeParse(input);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : failure("PRICING_ADMIN_CONTEXT_INVALID", "超级管理员 Context 不符合严格契约。");
  }

  return Object.freeze({
    async listActiveModels(input: unknown): Promise<BoundaryResult<readonly ModelCatalogEntry[]>> {
      const parsed = context(input);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<ModelCatalogRow>(
          "select * from platform.list_active_model_catalog($1::uuid,$2::uuid)",
          [parsed.value.deployment_id, parsed.value.principal_id],
        );
        return Object.freeze(result.rows.map(model));
      });
    },

    async listModels(input: unknown): Promise<BoundaryResult<readonly ModelCatalogEntry[]>> {
      const parsed = context(input);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<ModelCatalogRow>(
          "select * from platform.list_model_catalog($1::uuid,$2::uuid)",
          [parsed.value.deployment_id, parsed.value.principal_id],
        );
        return Object.freeze(result.rows.map(model));
      });
    },

    async listProviderConnections(
      input: unknown,
    ): Promise<BoundaryResult<readonly ModelProviderConnection[]>> {
      const parsed = context(input);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<ModelProviderConnectionRow>(
          "select * from platform.list_model_provider_connections($1::uuid,$2::uuid)",
          [parsed.value.deployment_id, parsed.value.principal_id],
        );
        return Object.freeze(result.rows.map(providerConnection));
      });
    },

    async applyProviderConnectionCommand(
      input: unknown,
      command: UpsertModelProviderConnectionInput | ArchiveModelProviderConnectionInput,
    ): Promise<BoundaryResult<ModelProviderConnection>> {
      const parsedContext = context(input);
      if (!parsedContext.ok) return parsedContext;
      const parsedCommand =
        command.schema_version === "model-provider-upsert@1.0.0"
          ? upsertModelProviderConnectionInputSchema.safeParse(command)
          : archiveModelProviderConnectionInputSchema.safeParse(command);
      if (!parsedCommand.success) {
        return failure("MODEL_PROVIDER_COMMAND_INVALID", "供应商连接命令不符合严格契约。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly result: ModelProviderConnectionRow }>(
          "select app_data_agent.apply_model_provider_connection_command($1::uuid,$2::uuid,$3::jsonb) as result",
          [parsedContext.value.deployment_id, parsedContext.value.principal_id, parsedCommand.data],
        );
        const row = result.rows[0];
        if (!row) throw new Error("MODEL_PROVIDER_RECEIPT_MISSING");
        return providerConnection(row.result);
      });
    },

    async applyProviderSelection(
      input: unknown,
      selection: ModelProviderSelectionInput,
    ): Promise<BoundaryResult<readonly ModelCatalogEntry[]>> {
      const parsedContext = context(input);
      if (!parsedContext.ok) return parsedContext;
      const parsedSelection = modelProviderSelectionInputSchema.safeParse(selection);
      if (!parsedSelection.success) {
        return failure("MODEL_PROVIDER_SELECTION_INVALID", "供应商模型选择不符合严格契约。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly result: readonly ModelCatalogRow[] }>(
          "select app_data_agent.apply_model_provider_selection($1::uuid,$2::uuid,$3::jsonb) as result",
          [
            parsedContext.value.deployment_id,
            parsedContext.value.principal_id,
            parsedSelection.data,
          ],
        );
        const rows = result.rows[0]?.result;
        if (!rows) throw new Error("MODEL_PROVIDER_SELECTION_RECEIPT_MISSING");
        return Object.freeze(rows.map(model));
      });
    },

    async applyModelCommand(
      input: unknown,
      command: UpsertModelCatalogEntryInput | ModelCatalogStatusInput,
    ): Promise<BoundaryResult<ModelCatalogEntry>> {
      const parsedContext = context(input);
      if (!parsedContext.ok) return parsedContext;
      const parsedCommand =
        command.schema_version === "model-catalog-upsert@1.0.0"
          ? upsertModelCatalogEntryInputSchema.safeParse(command)
          : modelCatalogStatusInputSchema.safeParse(command);
      if (!parsedCommand.success) {
        return failure("MODEL_CATALOG_COMMAND_INVALID", "模型目录命令不符合严格契约。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly result: ModelCatalogRow }>(
          "select app_data_agent.apply_model_catalog_command($1::uuid,$2::uuid,$3::jsonb) as result",
          [parsedContext.value.deployment_id, parsedContext.value.principal_id, parsedCommand.data],
        );
        const row = result.rows[0];
        if (!row) throw new Error("MODEL_CATALOG_RECEIPT_MISSING");
        return model(row.result);
      });
    },

    async submitPriceSync(
      input: unknown,
      submission: SubmitModelPriceSyncInput,
    ): Promise<BoundaryResult<unknown>> {
      return submit(input, submitModelPriceSyncInputSchema.safeParse(submission));
    },

    async submitFxSync(
      input: unknown,
      submission: SubmitFxRateSyncInput,
    ): Promise<BoundaryResult<unknown>> {
      return submit(input, submitFxRateSyncInputSchema.safeParse(submission));
    },

    async recordSyncFailure(
      input: unknown,
      failureInput: PricingSyncFailure,
    ): Promise<BoundaryResult<unknown>> {
      const parsedContext = context(input);
      if (!parsedContext.ok) return parsedContext;
      const parsedFailure = pricingFailureSchema.safeParse(failureInput);
      if (!parsedFailure.success) {
        return failure("PRICING_SYNC_INVALID", "价格同步失败回执不符合严格契约。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly result: unknown }>(
          "select app_data_agent.record_pricing_sync_failure($1::uuid,$2::uuid,$3::jsonb) as result",
          [parsedContext.value.deployment_id, parsedContext.value.principal_id, parsedFailure.data],
        );
        return result.rows[0]?.result ?? {};
      });
    },

    async listPriceCandidates(
      input: unknown,
    ): Promise<BoundaryResult<readonly ModelPriceCandidate[]>> {
      const parsed = context(input);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<PriceCandidateEnvelopeRow>(
          "select * from platform.list_model_price_candidates($1::uuid,$2::uuid)",
          [parsed.value.deployment_id, parsed.value.principal_id],
        );
        return Object.freeze(result.rows.map(priceCandidate));
      });
    },

    async listFxCandidates(input: unknown): Promise<BoundaryResult<readonly FxRateCandidate[]>> {
      const parsed = context(input);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<FxCandidateRow>(
          "select * from platform.list_fx_rate_candidates($1::uuid,$2::uuid)",
          [parsed.value.deployment_id, parsed.value.principal_id],
        );
        return Object.freeze(result.rows.map(fxCandidate));
      });
    },

    async decideCandidate(
      input: unknown,
      candidateKind: "MODEL_PRICE" | "FX_RATE",
      decision: PricingCandidateDecisionInput,
    ): Promise<BoundaryResult<PricingDecisionReceipt>> {
      const parsedContext = context(input);
      if (!parsedContext.ok) return parsedContext;
      const parsedDecision = pricingCandidateDecisionInputSchema.safeParse(decision);
      if (!parsedDecision.success) {
        return failure("PRICING_DECISION_INVALID", "价格审批命令不符合严格契约。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly result: PricingDecisionReceipt }>(
          "select app_data_agent.decide_pricing_candidate($1::uuid,$2::uuid,$3::text,$4::jsonb) as result",
          [
            parsedContext.value.deployment_id,
            parsedContext.value.principal_id,
            candidateKind,
            parsedDecision.data,
          ],
        );
        const receipt = result.rows[0]?.result;
        if (!receipt) throw new Error("PRICING_DECISION_RECEIPT_MISSING");
        return Object.freeze(receipt);
      });
    },
  });

  async function submit<T>(
    input: unknown,
    parsedSubmission: { success: true; data: T } | { success: false },
  ): Promise<BoundaryResult<unknown>> {
    const parsedContext = context(input);
    if (!parsedContext.ok) return parsedContext;
    if (!parsedSubmission.success) {
      return failure("PRICING_SYNC_INVALID", "价格同步提交不符合严格契约。");
    }
    return withClient(pool, async (client) => {
      const result = await client.query<{ readonly result: unknown }>(
        "select app_data_agent.submit_pricing_sync($1::uuid,$2::uuid,$3::jsonb) as result",
        [
          parsedContext.value.deployment_id,
          parsedContext.value.principal_id,
          parsedSubmission.data,
        ],
      );
      return result.rows[0]?.result ?? {};
    });
  }
}
