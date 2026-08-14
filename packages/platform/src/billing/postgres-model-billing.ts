import {
  type BillingModeDecisionReceipt,
  type BillingReconciliationReceipt,
  type BillingRuntimeState,
  billingModeDecisionInputSchema,
  billingModeDecisionReceiptSchema,
  billingReconciliationReceiptSchema,
  billingRuntimeStateSchema,
  type ModelBillingAuthorizationReceipt,
  type ModelBillingBill,
  type ModelBillingCostSummary,
  type ModelBillingTerminalReceipt,
  modelBillingAuthorizationReceiptSchema,
  modelBillingAuthorizeInputSchema,
  modelBillingBillSchema,
  modelBillingCostSummarySchema,
  modelBillingFinalizeInputSchema,
  modelBillingReviewInputSchema,
  modelBillingTerminalReceiptSchema,
} from "@data-agent/contracts";
import { z } from "zod";
import type { SqlClient, SqlPool } from "../persistence/transaction.js";
import { type BoundaryResult, failure } from "../tenancy/capability.js";

const contextSchema = z.strictObject({
  deployment_id: z.uuid(),
  principal_id: z.uuid(),
});

const adminBillQuerySchema = z.strictObject({
  state: z.enum(["RESERVED", "SETTLED", "RELEASED", "REVIEW_REQUIRED"]).nullable().default(null),
});

export type ModelBillingContext = z.infer<typeof contextSchema>;

export interface ModelBillingPort {
  authorize(
    context: unknown,
    command: unknown,
  ): Promise<BoundaryResult<ModelBillingAuthorizationReceipt>>;
  finalize(
    context: unknown,
    command: unknown,
  ): Promise<BoundaryResult<ModelBillingTerminalReceipt>>;
  review(context: unknown, command: unknown): Promise<BoundaryResult<ModelBillingTerminalReceipt>>;
}

function databaseError(error: unknown): BoundaryResult<never> {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  if (code === "42501" || code === "P0002") {
    return message.includes("SUPER_ADMIN_REQUIRED")
      ? failure("SUPER_ADMIN_REQUIRED", "只有超级管理员可以管理模型计费。")
      : failure("MODEL_BILLING_ACCESS_DENIED", "无权访问该模型账单。");
  }
  if (code === "40001") {
    return failure("MODEL_BILLING_VERSION_CONFLICT", "计费状态已更新，请刷新后重试。");
  }
  if (code === "23505") {
    return failure("MODEL_BILLING_OPERATION_CONFLICT", "同一幂等键已用于不同计费请求。");
  }
  if (code === "23514") {
    return failure("CREDIT_AVAILABLE_INSUFFICIENT", "可用积分不足，模型调用未启动。");
  }
  if (code === "55000") {
    return message.includes("RECONCILIATION")
      ? failure("BILLING_RECONCILIATION_REQUIRED", "Shadow 对账未通过，不能启用强制计费。")
      : failure("BILLING_REVIEW_REQUIRED", "模型调用费用需要人工复核。");
  }
  if (code === "22023") {
    return failure("MODEL_BILLING_INPUT_INVALID", "模型计费请求或用量维度无效。");
  }
  if (code === "22003") {
    return failure("MODEL_BILLING_AMOUNT_OVERFLOW", "模型计费金额超出安全范围。");
  }
  return failure("MODEL_BILLING_OPERATION_FAILED", "模型计费操作失败。", true);
}

async function withClient<T>(
  pool: SqlPool,
  operation: (client: SqlClient) => Promise<T>,
): Promise<BoundaryResult<T>> {
  let client: SqlClient;
  try {
    client = await pool.connect();
  } catch {
    return failure("MODEL_BILLING_UNAVAILABLE", "模型计费暂时不可用。", true);
  }
  try {
    return { ok: true, value: await operation(client) };
  } catch (error) {
    return databaseError(error);
  } finally {
    client.release();
  }
}

function context(input: unknown): BoundaryResult<ModelBillingContext> {
  const parsed = contextSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : failure("MODEL_BILLING_CONTEXT_INVALID", "模型计费 Context 不符合严格契约。");
}

function first(rows: readonly { readonly result: unknown }[]): unknown {
  const row = rows[0];
  if (!row) throw new Error("MODEL_BILLING_RECEIPT_MISSING");
  return row.result;
}

function integer(value: bigint | number | string): string {
  return String(value);
}

function decimal(value: bigint | number | string): string {
  return String(value);
}

export function createPostgresModelBillingRepository(pool: SqlPool): ModelBillingPort & {
  getRuntimeState(context: unknown): Promise<BoundaryResult<BillingRuntimeState>>;
  listOwnBills(context: unknown): Promise<BoundaryResult<readonly ModelBillingBill[]>>;
  listBills(
    context: unknown,
    query?: unknown,
  ): Promise<BoundaryResult<readonly ModelBillingBill[]>>;
  listCosts(context: unknown): Promise<BoundaryResult<readonly ModelBillingCostSummary[]>>;
  reconcile(context: unknown): Promise<BoundaryResult<BillingReconciliationReceipt>>;
  decideMode(
    context: unknown,
    command: unknown,
  ): Promise<BoundaryResult<BillingModeDecisionReceipt>>;
} {
  async function mutation<T>(
    contextInput: unknown,
    command: unknown,
    schema: { safeParse(value: unknown): { success: boolean; data?: unknown } },
    sql: string,
    receipt: { parse(value: unknown): T },
  ): Promise<BoundaryResult<T>> {
    const parsedContext = context(contextInput);
    if (!parsedContext.ok) return parsedContext;
    const parsedCommand = schema.safeParse(command);
    if (!parsedCommand.success) {
      return failure("MODEL_BILLING_INPUT_INVALID", "模型计费命令不符合严格契约。");
    }
    return withClient(pool, async (client) => {
      const result = await client.query<{ readonly result: unknown }>(sql, [
        parsedContext.value.deployment_id,
        parsedContext.value.principal_id,
        parsedCommand.data,
      ]);
      return receipt.parse(first(result.rows));
    });
  }

  return Object.freeze({
    authorize: (contextInput: unknown, command: unknown) =>
      mutation(
        contextInput,
        command,
        modelBillingAuthorizeInputSchema,
        "select app_data_agent.authorize_model_billing($1::uuid,$2::uuid,$3::jsonb) as result",
        modelBillingAuthorizationReceiptSchema,
      ),
    finalize: (contextInput: unknown, command: unknown) =>
      mutation(
        contextInput,
        command,
        modelBillingFinalizeInputSchema,
        "select app_data_agent.finalize_model_billing($1::uuid,$2::uuid,$3::jsonb) as result",
        modelBillingTerminalReceiptSchema,
      ),
    review: (contextInput: unknown, command: unknown) =>
      mutation(
        contextInput,
        command,
        modelBillingReviewInputSchema,
        "select app_data_agent.review_model_billing($1::uuid,$2::uuid,$3::jsonb) as result",
        modelBillingTerminalReceiptSchema,
      ),
    decideMode: (contextInput: unknown, command: unknown) =>
      mutation(
        contextInput,
        command,
        billingModeDecisionInputSchema,
        "select app_data_agent.decide_billing_mode($1::uuid,$2::uuid,$3::jsonb) as result",
        billingModeDecisionReceiptSchema,
      ),
    async getRuntimeState(contextInput: unknown) {
      const parsed = context(contextInput);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly result: unknown }>(
          "select platform.get_billing_runtime_state($1::uuid,$2::uuid) as result",
          [parsed.value.deployment_id, parsed.value.principal_id],
        );
        return billingRuntimeStateSchema.parse(first(result.rows));
      });
    },
    async listOwnBills(contextInput: unknown) {
      const parsed = context(contextInput);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly result: unknown }>(
          "select result from platform.list_own_model_bills($1::uuid,$2::uuid) as result",
          [parsed.value.deployment_id, parsed.value.principal_id],
        );
        return Object.freeze(result.rows.map((row) => modelBillingBillSchema.parse(row.result)));
      });
    },
    async listBills(contextInput: unknown, queryInput: unknown = {}) {
      const parsed = context(contextInput);
      if (!parsed.ok) return parsed;
      const query = adminBillQuerySchema.safeParse(queryInput);
      if (!query.success) {
        return failure("MODEL_BILLING_QUERY_INVALID", "模型账单查询不符合严格契约。");
      }
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly result: unknown }>(
          "select result from platform.list_model_bills($1::uuid,$2::uuid,$3::text) as result",
          [parsed.value.deployment_id, parsed.value.principal_id, query.data.state],
        );
        return Object.freeze(result.rows.map((row) => modelBillingBillSchema.parse(row.result)));
      });
    },
    async listCosts(contextInput: unknown) {
      const parsed = context(contextInput);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<{
          readonly workspace_id: string;
          readonly run_id: string | null;
          readonly conversation_id: string | null;
          readonly funding_type: ModelBillingCostSummary["funding_type"];
          readonly bill_count: bigint | number | string;
          readonly settled_count: bigint | number | string;
          readonly review_count: bigint | number | string;
          readonly cny_cost: bigint | number | string;
          readonly charged_microcredits: bigint | number | string;
        }>("select * from platform.list_model_billing_costs($1::uuid,$2::uuid)", [
          parsed.value.deployment_id,
          parsed.value.principal_id,
        ]);
        return Object.freeze(
          result.rows.map((row) =>
            modelBillingCostSummarySchema.parse({
              schema_version: "model-billing-cost-summary@1.0.0",
              workspace_id: row.workspace_id,
              run_id: row.run_id,
              conversation_id: row.conversation_id,
              funding_type: row.funding_type,
              bill_count: integer(row.bill_count),
              settled_count: integer(row.settled_count),
              review_count: integer(row.review_count),
              cny_cost: decimal(row.cny_cost),
              charged_microcredits: integer(row.charged_microcredits),
            }),
          ),
        );
      });
    },
    async reconcile(contextInput: unknown) {
      const parsed = context(contextInput);
      if (!parsed.ok) return parsed;
      return withClient(pool, async (client) => {
        const result = await client.query<{ readonly result: unknown }>(
          "select app_data_agent.reconcile_model_billing($1::uuid,$2::uuid) as result",
          [parsed.value.deployment_id, parsed.value.principal_id],
        );
        return billingReconciliationReceiptSchema.parse(first(result.rows));
      });
    },
  });
}
