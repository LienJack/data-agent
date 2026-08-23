export interface QaReadinessState {
  readonly schema_version: "qa-readiness-state@1.0.0";
  readonly workspace_id: string;
  readonly model_profiles_ready: boolean;
  readonly schema_snapshot_ready: boolean;
  readonly defaults_ready: boolean;
  readonly team_profiles_ready: boolean;
}

export interface QaReadinessBootstrapDependencies {
  readonly inspect: () => Promise<QaReadinessState>;
  readonly ensureModelProfiles: () => Promise<void>;
  readonly ensureSchemaSnapshot: () => Promise<void>;
  readonly ensureDefaults: () => Promise<void>;
  readonly ensureTeamProfiles: () => Promise<void>;
}

export interface QaReadinessBootstrapInput {
  readonly workspace_id: string;
  readonly environment: string;
  readonly confirmed: boolean;
}

export interface QaReadinessBootstrapResult {
  readonly schema_version: "qa-readiness-bootstrap-result@1.0.0";
  readonly terminal: "READY" | "NOT_RUN" | "HOLD";
  readonly reason_code: string;
  readonly state?: QaReadinessState;
}

function complete(state: QaReadinessState): boolean {
  return (
    state.model_profiles_ready &&
    state.schema_snapshot_ready &&
    state.defaults_ready &&
    state.team_profiles_ready
  );
}

function failureCode(error: unknown): string {
  const marker = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{2,127}$/u.test(marker) ? marker : "QA_READINESS_BOOTSTRAP_FAILED";
}

export async function runQaReadinessBootstrap(
  input: QaReadinessBootstrapInput,
  dependencies: QaReadinessBootstrapDependencies,
): Promise<QaReadinessBootstrapResult> {
  const base = { schema_version: "qa-readiness-bootstrap-result@1.0.0" as const };
  if (input.environment === "production") {
    return {
      ...base,
      terminal: "HOLD",
      reason_code: "QA_READINESS_PRODUCTION_FORBIDDEN",
    };
  }
  if (!input.confirmed) {
    return {
      ...base,
      terminal: "NOT_RUN",
      reason_code: "QA_READINESS_EXPLICIT_CONFIRMATION_REQUIRED",
    };
  }

  try {
    const initial = await dependencies.inspect();
    if (initial.workspace_id !== input.workspace_id) {
      return { ...base, terminal: "HOLD", reason_code: "QA_READINESS_SCOPE_MISMATCH" };
    }
    if (complete(initial)) {
      return {
        ...base,
        terminal: "READY",
        reason_code: "QA_READINESS_ALREADY_READY",
        state: initial,
      };
    }

    if (!initial.model_profiles_ready) await dependencies.ensureModelProfiles();
    if (!initial.schema_snapshot_ready) await dependencies.ensureSchemaSnapshot();
    if (!initial.defaults_ready) await dependencies.ensureDefaults();
    if (!initial.team_profiles_ready) await dependencies.ensureTeamProfiles();

    const state = await dependencies.inspect();
    if (state.workspace_id !== input.workspace_id || !complete(state)) {
      return { ...base, terminal: "HOLD", reason_code: "QA_READINESS_INCOMPLETE", state };
    }
    return {
      ...base,
      terminal: "READY",
      reason_code: "QA_READINESS_BOOTSTRAPPED",
      state,
    };
  } catch (error) {
    return { ...base, terminal: "HOLD", reason_code: failureCode(error) };
  }
}
