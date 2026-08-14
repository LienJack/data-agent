import { z } from "zod";
import { contentHashSchema, immutableIdSchema, timestampSchema } from "../common/index.js";

export const RUN_DRIVER_BUDGET_ADMISSION_VERSION = "run-driver-budget-admission@1" as const;

export const budgetAdmissionStatusSchema = z.enum(["RESERVED", "CONSUMED", "RELEASED", "EXPIRED"]);
export type BudgetAdmissionStatus = z.infer<typeof budgetAdmissionStatusSchema>;

export const runDriverBudgetAdmissionSchema = z.strictObject({
  protocol_version: z.literal("run-driver-budget-admission@1"),
  admission_id: immutableIdSchema,
  run_fence: z.string().min(1).max(128),
  question_hash: contentHashSchema,
  profile_hash: contentHashSchema,
  reservation_id: immutableIdSchema,
  idempotency_key: z.string().min(1).max(256),
  admission_sequence: z.number().int().min(1),
  admission_expiry: timestampSchema,
  status: budgetAdmissionStatusSchema,
  remaining_sql_budget: z.number().int().min(0),
  remaining_obligation_budget: z.number().int().min(0),
  remaining_artifact_input_budget: z.number().int().min(0),
  admitted_at: timestampSchema,
  consumed_at: timestampSchema.optional(),
  released_at: timestampSchema.optional(),
  expired_at: timestampSchema.optional(),
});

export type RunDriverBudgetAdmission = z.infer<typeof runDriverBudgetAdmissionSchema>;

export const budgetAdmissionReservationSchema = z.strictObject({
  idempotency_key: z.string().min(1).max(256),
  run_fence: z.string().min(1).max(128),
  question_hash: contentHashSchema,
  profile_hash: contentHashSchema,
  requested_sql: z.number().int().min(1),
  requested_obligations: z.number().int().min(1),
  requested_artifact_inputs: z.number().int().min(1),
  reservation_ttl_ms: z.number().int().min(1000).max(300_000).default(60_000),
});

export type BudgetAdmissionReservation = z.infer<typeof budgetAdmissionReservationSchema>;

export interface BudgetState {
  readonly remaining_sql_budget: number;
  readonly remaining_obligation_budget: number;
  readonly remaining_artifact_input_budget: number;
}

export function checkAndReserveBudget(
  state: BudgetState,
  reservation: BudgetAdmissionReservation,
): { ok: true; admission: RunDriverBudgetAdmission } | { ok: false; reason: string } {
  if (state.remaining_sql_budget < reservation.requested_sql) {
    return { ok: false, reason: "CONTRIBUTION_DRIVER_BUDGET_EXCEEDED" };
  }
  if (state.remaining_obligation_budget < reservation.requested_obligations) {
    return { ok: false, reason: "CONTRIBUTION_DRIVER_BUDGET_EXCEEDED" };
  }
  if (state.remaining_artifact_input_budget < reservation.requested_artifact_inputs) {
    return { ok: false, reason: "CONTRIBUTION_DRIVER_BUDGET_EXCEEDED" };
  }
  const admission: RunDriverBudgetAdmission = {
    protocol_version: "run-driver-budget-admission@1",
    admission_id: crypto.randomUUID(),
    run_fence: reservation.run_fence,
    question_hash: reservation.question_hash,
    profile_hash: reservation.profile_hash,
    reservation_id: crypto.randomUUID(),
    idempotency_key: reservation.idempotency_key,
    admission_sequence: 1,
    admission_expiry: new Date(
      Date.now() + reservation.reservation_ttl_ms,
    ).toISOString() as unknown as string,
    status: "RESERVED",
    remaining_sql_budget: state.remaining_sql_budget - reservation.requested_sql,
    remaining_obligation_budget:
      state.remaining_obligation_budget - reservation.requested_obligations,
    remaining_artifact_input_budget:
      state.remaining_artifact_input_budget - reservation.requested_artifact_inputs,
    admitted_at: new Date().toISOString() as unknown as string,
  };
  return { ok: true, admission };
}

export function transitionBudgetAdmission(
  admission: RunDriverBudgetAdmission,
  newStatus: "CONSUMED" | "RELEASED" | "EXPIRED",
): RunDriverBudgetAdmission {
  const now = new Date().toISOString() as unknown as string;
  return {
    ...admission,
    status: newStatus,
    ...(newStatus === "CONSUMED" ? { consumed_at: now } : {}),
    ...(newStatus === "RELEASED" ? { released_at: now } : {}),
    ...(newStatus === "EXPIRED" ? { expired_at: now } : {}),
  };
}

export function isBudgetAdmissionExpired(admission: RunDriverBudgetAdmission): boolean {
  return new Date(admission.admission_expiry) < new Date();
}
