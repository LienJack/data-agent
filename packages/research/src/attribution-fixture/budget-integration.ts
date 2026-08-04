import {
  type RunDriverBudgetAdmission,
  type BudgetAdmissionReservation,
  type BudgetState,
  checkAndReserveBudget,
  transitionBudgetAdmission,
  isBudgetAdmissionExpired,
  MAX_DRIVER_LIMIT,
  MAX_SQL_LIMIT,
} from "@data-agent/contracts";

// ─── Constants ─────────────────────────────────────────────────────────────────

export const BUDGET_INTEGRATION_VERSION = "budget-integration@1" as const;

/**
 * Default budget state for a new attribution run.
 * Based on U13.1 constraints: 16 SQL max, 6 drivers max.
 */
export const DEFAULT_ATTRIBUTION_BUDGET: BudgetState = Object.freeze({
  remaining_sql_budget: MAX_SQL_LIMIT,
  remaining_obligation_budget: MAX_DRIVER_LIMIT * 10, // 60 obligations max
  remaining_artifact_input_budget: MAX_DRIVER_LIMIT * 5, // 30 artifact inputs max
});

// ─── Budget lifecycle manager ──────────────────────────────────────────────────

/**
 * Budget lifecycle manager for attribution fixture kernel.
 *
 * Maintains a map of active reservations keyed by idempotency_key.
 * In production, this would be backed by PostgreSQL/U4 lease/fence;
 * in M1, it's a pure in-memory state machine.
 */
export class BudgetLifecycleManager {
  private readonly reservations: Map<string, RunDriverBudgetAdmission> = new Map();
  private currentBudget: BudgetState;

  constructor(initialBudget?: BudgetState) {
    this.currentBudget = initialBudget ?? { ...DEFAULT_ATTRIBUTION_BUDGET };
  }

  /**
   * Get current budget state.
   */
  getBudget(): BudgetState {
    return { ...this.currentBudget };
  }

  /**
   * Check and reserve budget for a run.
   * Returns the admission if successful, or an error if budget is exceeded.
   *
   * Idempotent: same idempotency_key returns existing reservation.
   */
  reserve(reservation: BudgetAdmissionReservation): {
    ok: true; admission: RunDriverBudgetAdmission
  } | { ok: false; reason: string } {
    // Check idempotency
    const existing = this.reservations.get(reservation.idempotency_key);
    if (existing) {
      // Return existing reservation if still valid
      if (existing.status === "RESERVED" && !isBudgetAdmissionExpired(existing)) {
        return { ok: true, admission: existing };
      }
      // If expired, remove and re-reserve
      if (existing.status === "RESERVED" && isBudgetAdmissionExpired(existing)) {
        this.reservations.delete(reservation.idempotency_key);
        // Release expired budget back
        this.currentBudget = {
          remaining_sql_budget: this.currentBudget.remaining_sql_budget + 1,
          remaining_obligation_budget: this.currentBudget.remaining_obligation_budget + 1,
          remaining_artifact_input_budget: this.currentBudget.remaining_artifact_input_budget + 1,
        };
      }
    }

    const result = checkAndReserveBudget(this.currentBudget, reservation);
    if (!result.ok) {
      return { ok: false, reason: result.reason };
    }

    // Update local budget state
    this.currentBudget = {
      remaining_sql_budget: result.admission.remaining_sql_budget,
      remaining_obligation_budget: result.admission.remaining_obligation_budget,
      remaining_artifact_input_budget: result.admission.remaining_artifact_input_budget,
    };

    this.reservations.set(reservation.idempotency_key, result.admission);
    return { ok: true, admission: result.admission };
  }

  /**
   * Consume a reserved budget.
   * Transitions status from RESERVED to CONSUMED.
   */
  consume(idempotencyKey: string): {
    ok: true; admission: RunDriverBudgetAdmission
  } | { ok: false; reason: string } {
    const existing = this.reservations.get(idempotencyKey);
    if (!existing) {
      return { ok: false, reason: "No reservation found for key" };
    }
    if (existing.status !== "RESERVED") {
      return { ok: false, reason: `Cannot consume admission in status ${existing.status}` };
    }
    if (isBudgetAdmissionExpired(existing)) {
      return { ok: false, reason: "Admission has expired" };
    }

    const consumed = transitionBudgetAdmission(existing, "CONSUMED");
    this.reservations.set(idempotencyKey, consumed);
    return { ok: true, admission: consumed };
  }

  /**
   * Release a reserved budget.
   * Transitions status from RESERVED to RELEASED and returns budget.
   */
  release(idempotencyKey: string): {
    ok: true; admission: RunDriverBudgetAdmission
  } | { ok: false; reason: string } {
    const existing = this.reservations.get(idempotencyKey);
    if (!existing) {
      return { ok: false, reason: "No reservation found for key" };
    }

    const released = transitionBudgetAdmission(existing, "RELEASED");
    this.reservations.set(idempotencyKey, released);

    // Return budget
    this.currentBudget = {
      remaining_sql_budget: this.currentBudget.remaining_sql_budget + 1,
      remaining_obligation_budget: this.currentBudget.remaining_obligation_budget + 1,
      remaining_artifact_input_budget: this.currentBudget.remaining_artifact_input_budget + 1,
    };

    return { ok: true, admission: released };
  }

  /**
   * Sweep expired reservations and return them to the budget pool.
   */
  sweepExpired(): number {
    let sweptCount = 0;
    for (const [key, admission] of this.reservations.entries()) {
      if (admission.status === "RESERVED" && isBudgetAdmissionExpired(admission)) {
        const expired = transitionBudgetAdmission(admission, "EXPIRED");
        this.reservations.set(key, expired);

        // Return budget
        this.currentBudget = {
          remaining_sql_budget: this.currentBudget.remaining_sql_budget + 1,
          remaining_obligation_budget: this.currentBudget.remaining_obligation_budget + 1,
          remaining_artifact_input_budget: this.currentBudget.remaining_artifact_input_budget + 1,
        };

        sweptCount++;
      }
    }
    return sweptCount;
  }

  /**
   * Get all active reservations.
   */
  getActiveReservations(): RunDriverBudgetAdmission[] {
    return Array.from(this.reservations.values()).filter(
      (a) => a.status === "RESERVED" && !isBudgetAdmissionExpired(a),
    );
  }

  /**
   * Reset budget to initial state (for testing).
   */
  reset(initialBudget?: BudgetState): void {
    this.reservations.clear();
    this.currentBudget = initialBudget ?? { ...DEFAULT_ATTRIBUTION_BUDGET };
  }
}

// ─── Budget integration helper ─────────────────────────────────────────────────

/**
 * Create a budget reservation for the attribution fixture kernel.
 */
export function createAttributionBudgetReservation(
  runFence: string,
  questionHash: `sha256:${string}`,
  profileHash: `sha256:${string}`,
  driverCount: number,
): BudgetAdmissionReservation {
  return {
    idempotency_key: `${runFence}:${questionHash}`,
    run_fence: runFence,
    question_hash: questionHash,
    profile_hash: profileHash,
    requested_sql: Math.min(driverCount, MAX_SQL_LIMIT),
    requested_obligations: Math.min(driverCount * 10, 100),
    requested_artifact_inputs: Math.min(driverCount * 5, 50),
    reservation_ttl_ms: 60_000,
  };
}
