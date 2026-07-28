import {
  appScopeSchema,
  type ContentHash,
  computeResearchKernelHashV2,
  contentHashSchema,
  identifierSchema,
  immutableIdSchema,
  nonNegativeIntSchema,
  parseInertWireInput,
  positiveIntSchema,
  researchBudgetBalanceSchema,
  researchBudgetLimitSchema,
  researchBudgetUsageSchema,
  sameJson,
  U6_WIRE_LIMITS,
  z,
} from "./derivation-wire-shared.js";

const budgetUsageKeys = [
  "steps",
  "model_calls",
  "sql_executions",
  "source_calls",
  "elapsed_ms",
  "provider_input_tokens",
  "provider_output_tokens",
  "provider_tokens",
  "provider_cost_microusd",
] as const;

const budgetBalanceAxes = [
  ["steps", "max_steps"],
  ["model_calls", "max_model_calls"],
  ["sql_executions", "max_sql_executions"],
  ["source_calls", "max_source_calls"],
  ["elapsed_ms", "max_elapsed_ms"],
  ["provider_tokens", "max_provider_tokens_per_run"],
  ["provider_cost_microusd", "max_provider_cost_microusd_per_run"],
] as const;

export const researchBudgetLedgerBindingV2Schema = z
  .strictObject({
    ledger_version: z.literal("research-budget-ledger@2.0.0"),
    evaluated_through_reservation_seq: nonNegativeIntSchema,
    evaluated_through_budget_event_seq: nonNegativeIntSchema,
    effective_limit: researchBudgetLimitSchema,
    actual_used: researchBudgetUsageSchema,
    unresolved_hold: researchBudgetUsageSchema,
    charged_used: researchBudgetUsageSchema,
    remaining: researchBudgetBalanceSchema,
    overage: researchBudgetBalanceSchema,
    top_up_allowed: z.boolean(),
    ledger_hash: contentHashSchema,
  })
  .superRefine((ledger, ctx) => {
    for (const key of budgetUsageKeys) {
      const sum = ledger.actual_used[key] + ledger.unresolved_hold[key];
      if (!Number.isSafeInteger(sum) || ledger.charged_used[key] !== sum) {
        ctx.addIssue({
          code: "custom",
          message: `${key} 必须满足 charged_used = actual_used + unresolved_hold。`,
          path: ["charged_used", key],
        });
      }
    }

    for (const [axis, limitKey] of budgetBalanceAxes) {
      const left = ledger.charged_used[axis] + ledger.remaining[axis];
      const right = ledger.effective_limit[limitKey] + ledger.overage[axis];
      if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left !== right) {
        ctx.addIssue({
          code: "custom",
          message: `${axis} 必须满足 charged_used + remaining = effective_limit + overage。`,
          path: ["remaining", axis],
        });
      }
      if (ledger.remaining[axis] !== 0 && ledger.overage[axis] !== 0) {
        ctx.addIssue({
          code: "custom",
          message: `${axis} 的 remaining 与 overage 至少一个必须为 0。`,
          path: ["overage", axis],
        });
      }
    }
  });

export async function computeResearchBudgetLedgerV2Hash(input: unknown): Promise<ContentHash> {
  const ledger = parseInertWireInput(researchBudgetLedgerBindingV2Schema, input);
  const { ledger_hash: _ledgerHash, ...material } = ledger;
  return computeResearchKernelHashV2("u6-research-budget-ledger@2", material);
}

export async function verifyResearchBudgetLedgerBindingV2(
  input: unknown,
): Promise<z.infer<typeof researchBudgetLedgerBindingV2Schema>> {
  const ledger = parseInertWireInput(researchBudgetLedgerBindingV2Schema, input);
  const expectedHash = await computeResearchBudgetLedgerV2Hash(ledger);
  if (expectedHash !== ledger.ledger_hash) {
    throw new TypeError("Research Budget Ledger ledger_hash 与 exact material 不匹配。");
  }
  return ledger;
}

const invocationOutcomeUsageReferenceCommonShape = {
  record_kind: z.literal("INVOCATION_OUTCOME_USAGE"),
  record_id: immutableIdSchema,
  scope: appScopeSchema,
  run_id: immutableIdSchema,
  record_version: z.literal(1),
  content_hash: contentHashSchema,
  commit_id: immutableIdSchema,
  store: z.literal("research_invocation_outcome_usage"),
  resolver_capability: z.literal("RESOURCE_AUTHORITY"),
  commit: z.literal("commit_invocation_terminal@1.0.0"),
  resolver: z.literal("resolve_committed_invocation_outcome_usage@1.0.0"),
  status: z.literal("COMMITTED"),
  authority_epoch: nonNegativeIntSchema,
  expires_at: z.null(),
  revocation_seq: z.literal(0),
} as const;

export const invocationOutcomeUsageReferenceSchema = z.discriminatedUnion("adapter_kind", [
  z.strictObject({
    ...invocationOutcomeUsageReferenceCommonShape,
    adapter_kind: z.literal("MODEL"),
    owner_kind: z.literal("MODEL_ADAPTER_AUTHORITY"),
    commit_capability: z.literal("MODEL_INVOCATION_AUTHORITY"),
    producer: z.literal("MODEL_ADAPTER"),
  }),
  z.strictObject({
    ...invocationOutcomeUsageReferenceCommonShape,
    adapter_kind: z.literal("SQL"),
    owner_kind: z.literal("SQL_ADAPTER_AUTHORITY"),
    commit_capability: z.literal("SQL_INVOCATION_AUTHORITY"),
    producer: z.literal("SQL_ADAPTER"),
  }),
  z.strictObject({
    ...invocationOutcomeUsageReferenceCommonShape,
    adapter_kind: z.literal("TOOL"),
    owner_kind: z.literal("TOOL_ADAPTER_AUTHORITY"),
    commit_capability: z.literal("TOOL_INVOCATION_AUTHORITY"),
    producer: z.literal("TOOL_ADAPTER"),
  }),
]);

const zeroResearchBudgetUsage = {
  steps: 0,
  model_calls: 0,
  sql_executions: 0,
  source_calls: 0,
  elapsed_ms: 0,
  provider_input_tokens: 0,
  provider_output_tokens: 0,
  provider_tokens: 0,
  provider_cost_microusd: 0,
} as const;

function usageExceedsReservation(
  actualUsage: z.infer<typeof researchBudgetUsageSchema>,
  reservedUsage: z.infer<typeof researchBudgetUsageSchema>,
): boolean {
  return budgetUsageKeys.some((key) => actualUsage[key] > reservedUsage[key]);
}

function addResourceUsageIssues(
  resourceKind: "MODEL" | "SQL" | "TOOL",
  usage: z.infer<typeof researchBudgetUsageSchema>,
  ctx: z.RefinementCtx,
  path: PropertyKey[],
): void {
  const allowedKeys =
    resourceKind === "MODEL"
      ? new Set([
          "model_calls",
          "provider_input_tokens",
          "provider_output_tokens",
          "provider_tokens",
          "provider_cost_microusd",
        ])
      : resourceKind === "SQL"
        ? new Set(["sql_executions"])
        : new Set<string>();

  for (const key of budgetUsageKeys) {
    if (!allowedKeys.has(key) && usage[key] !== 0) {
      ctx.addIssue({
        code: "custom",
        message: `${resourceKind} Reservation 不得在 ${key} 维度记账。`,
        path: [...path, key],
      });
    }
  }
}

export const reservationBudgetStateProjectionSchema = z
  .strictObject({
    reservation_id: immutableIdSchema,
    reservation_seq: positiveIntSchema,
    resource_kind: z.enum(["MODEL", "SQL", "TOOL"]),
    state: z.enum([
      "RESERVED",
      "IN_USE",
      "SETTLED",
      "SETTLED_OVER_LIMIT",
      "CANCELLED",
      "EXPIRED",
      "ABANDONED",
    ]),
    reserved_usage: researchBudgetUsageSchema,
    actual_usage: researchBudgetUsageSchema.nullable(),
    outcome_usage_ref: invocationOutcomeUsageReferenceSchema.nullable(),
    outcome_unknown_hash: contentHashSchema.nullable(),
    end_reason_code: identifierSchema.nullable(),
  })
  .superRefine((reservation, ctx) => {
    addResourceUsageIssues(reservation.resource_kind, reservation.reserved_usage, ctx, [
      "reserved_usage",
    ]);
    if (reservation.actual_usage !== null) {
      addResourceUsageIssues(reservation.resource_kind, reservation.actual_usage, ctx, [
        "actual_usage",
      ]);
    }
    if (
      (reservation.resource_kind === "MODEL" && reservation.reserved_usage.model_calls !== 1) ||
      (reservation.resource_kind === "SQL" && reservation.reserved_usage.sql_executions !== 1)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "MODEL/SQL Reservation 必须为一次受控调用保留恰好一个主资源单位。",
        path: ["reserved_usage"],
      });
    }
    const active =
      reservation.state === "RESERVED" ||
      reservation.state === "IN_USE" ||
      reservation.state === "ABANDONED";
    if (active && reservation.actual_usage !== null) {
      ctx.addIssue({
        code: "custom",
        message: "未决 Reservation 不得声明 actual_usage。",
        path: ["actual_usage"],
      });
    }
    if (
      (reservation.state === "SETTLED" || reservation.state === "SETTLED_OVER_LIMIT") &&
      (reservation.actual_usage === null ||
        reservation.outcome_usage_ref === null ||
        reservation.outcome_unknown_hash !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "SETTLED 必须绑定 actual_usage 与 OutcomeUsage，且不能保留 unknown hash。",
        path: ["state"],
      });
    }
    if (
      reservation.state === "SETTLED" &&
      reservation.actual_usage !== null &&
      usageExceedsReservation(reservation.actual_usage, reservation.reserved_usage)
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "SETTLED 的 actual_usage 不得超过 reserved_usage；超额必须使用 SETTLED_OVER_LIMIT。",
        path: ["state"],
      });
    }
    if (
      reservation.state === "SETTLED_OVER_LIMIT" &&
      reservation.actual_usage !== null &&
      !usageExceedsReservation(reservation.actual_usage, reservation.reserved_usage)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "SETTLED_OVER_LIMIT 必须至少有一个 actual_usage 维度超过 reserved_usage。",
        path: ["state"],
      });
    }
    if (
      reservation.state === "CANCELLED" &&
      reservation.actual_usage !== null &&
      usageExceedsReservation(reservation.actual_usage, reservation.reserved_usage)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "CANCELLED 必须保持 within-limit；超额必须使用 SETTLED_OVER_LIMIT。",
        path: ["state"],
      });
    }
    if (
      reservation.state === "ABANDONED" &&
      (reservation.outcome_unknown_hash === null ||
        reservation.outcome_usage_ref !== null ||
        reservation.end_reason_code === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "ABANDONED 必须绑定 unknown hash/end reason，且不能伪造 OutcomeUsage。",
        path: ["state"],
      });
    }
    if (
      (reservation.state === "RESERVED" || reservation.state === "IN_USE") &&
      (reservation.outcome_usage_ref !== null ||
        reservation.outcome_unknown_hash !== null ||
        reservation.end_reason_code !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "活动 Reservation 不能提前声明终态字段。",
        path: ["state"],
      });
    }
    if (
      (reservation.state === "CANCELLED" || reservation.state === "EXPIRED") &&
      (reservation.actual_usage === null || reservation.end_reason_code === null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "CANCELLED/EXPIRED 必须显式携带零或权威 actual_usage 与 end reason。",
        path: ["state"],
      });
    }
    if (
      reservation.state === "CANCELLED" &&
      (reservation.outcome_unknown_hash !== null ||
        (reservation.outcome_usage_ref === null &&
          !sameJson(reservation.actual_usage, zeroResearchBudgetUsage)))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "CANCELLED 不得保留 unknown hash；无权威 OutcomeUsage 时 actual_usage 必须全零。",
        path: ["actual_usage"],
      });
    }
    if (
      reservation.state === "EXPIRED" &&
      (!sameJson(reservation.actual_usage, zeroResearchBudgetUsage) ||
        reservation.outcome_usage_ref !== null ||
        reservation.outcome_unknown_hash !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "EXPIRED 是 pre-I/O 终态，actual_usage 必须全零且无 Outcome。",
        path: ["actual_usage"],
      });
    }
    if (
      reservation.outcome_usage_ref !== null &&
      reservation.outcome_usage_ref.adapter_kind !== reservation.resource_kind
    ) {
      ctx.addIssue({
        code: "custom",
        message: "OutcomeUsage adapter_kind 必须匹配 Reservation resource_kind。",
        path: ["outcome_usage_ref", "adapter_kind"],
      });
    }
  });

function addReservationOrderIssues(
  reservations: readonly z.infer<typeof reservationBudgetStateProjectionSchema>[],
  ctx: z.RefinementCtx,
  path: PropertyKey[] = [],
): void {
  const reservationIds = reservations.map(({ reservation_id }) => reservation_id);
  const reservationSeqs = reservations.map(({ reservation_seq }) => reservation_seq);
  if (new Set(reservationIds).size !== reservationIds.length) {
    ctx.addIssue({
      code: "custom",
      message: "Reservation projection 不接受重复 reservation_id。",
      path,
    });
    return;
  }
  if (new Set(reservationSeqs).size !== reservationSeqs.length) {
    ctx.addIssue({
      code: "custom",
      message: "Reservation projection 不接受重复 reservation_seq。",
      path,
    });
    return;
  }
  const identities = reservations.map(
    ({ reservation_seq, reservation_id }) =>
      `${reservation_seq.toString().padStart(16, "0")}\0${reservation_id}`,
  );
  const ordered = [...identities].sort();
  for (const [index, identity] of identities.entries()) {
    if (identity !== ordered[index]) {
      ctx.addIssue({
        code: "custom",
        message: "Reservation projection 必须按 reservation_seq、reservation_id 升序。",
        path: [...path, index],
      });
      return;
    }
  }
}

const orderedReservationBudgetStateArraySchema = z
  .array(reservationBudgetStateProjectionSchema)
  .max(U6_WIRE_LIMITS.max_artifact_input_refs)
  .superRefine((reservations, ctx) => {
    addReservationOrderIssues(reservations, ctx);
  });

/** @internal */
export { orderedReservationBudgetStateArraySchema };

export type ResearchBudgetLedgerBindingV2 = z.infer<typeof researchBudgetLedgerBindingV2Schema>;
export type InvocationOutcomeUsageReference = z.infer<typeof invocationOutcomeUsageReferenceSchema>;
export type ReservationBudgetStateProjection = z.infer<
  typeof reservationBudgetStateProjectionSchema
>;
