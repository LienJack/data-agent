import {
  ANALYSIS_SKILL_IDS,
  type AnalysisDisclosureCode,
  type AnalysisSandboxProgramPayload,
  type AnalysisSkillId,
  type AuthoritativeReleaseManifest,
  analysisSkillIdSchema,
  isAuthoritativeReleaseManifest,
  isDeterministicAnalysisCapabilityExecutable,
  type PythonOutputContractV1,
  pythonOutputContractSchema,
  STATISTICAL_OPERATOR_REGISTRY_DIGEST,
  versionIdentifierSchema,
} from "@data-agent/contracts";
import { z } from "zod";

type AnalysisRuntimeProfile = AnalysisSandboxProgramPayload["import_profile"];

export const ANALYSIS_RUNTIME_ATTESTATIONS = Object.freeze({
  CORE_ANALYSIS: Object.freeze({
    runtime_digest: "sha256:6a51d24215ee653193acb1d0fc193a7bf7eae379750e77ca03b6f299e486874c",
    dependency_lock_digest:
      "sha256:0bbe3f0927d415634b6f520505b06594601cfb7a0ff707e1c9fae905124100d8",
    operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
    image_attestation_digest:
      "sha256:d556839b04ba721ea07596cbd3e04bcac0ba750bf2117d59d89d28bfc5a09087",
  }),
  ML_DIAGNOSTIC: Object.freeze({
    runtime_digest: "sha256:e229bc12e496937fc2429457b4d3d4aa2f617d082d5e8d3bae4dcf8681ba1994",
    dependency_lock_digest:
      "sha256:9f578fc061f77c8c083e1f03a4036c2aabf60419caf11ffdf57292f88410d293",
    operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
    image_attestation_digest:
      "sha256:aad598621207c2885cba31f34e09efeecdb7eea5ab2e93001312b0e8442121c8",
  }),
  CAUSAL_L5: Object.freeze({
    runtime_digest: "sha256:6847cb2e834b22f16209438886ea72829e8ed252defbcc243fbfbc74120751cc",
    dependency_lock_digest:
      "sha256:73bbc0d20938684a2e25c111c3bb80ac6beee877f64d03986e53acae16e4b22d",
    operator_registry_digest: STATISTICAL_OPERATOR_REGISTRY_DIGEST,
    image_attestation_digest:
      "sha256:94c58cfdcfaace7bd464c3480aa5afd8c0ab4a58c9edcbb385d1f1dfbcbf5b93",
  }),
} as const satisfies Record<
  AnalysisRuntimeProfile,
  {
    readonly runtime_digest: `sha256:${string}`;
    readonly dependency_lock_digest: `sha256:${string}`;
    readonly operator_registry_digest: `sha256:${string}`;
    readonly image_attestation_digest: `sha256:${string}`;
  }
>);

const resultOnlyContract = pythonOutputContractSchema.parse({
  schema_version: "python-output-contract@1.0.0",
  outputs: [{ name: "result", type: "JSON", required: true, max_bytes: 16 * 1024 * 1024 }],
});

const forecastContract = pythonOutputContractSchema.parse({
  schema_version: "python-output-contract@1.0.0",
  outputs: [
    { name: "result", type: "JSON", required: true, max_bytes: 4 * 1024 * 1024 },
    { name: "backtest_rows", type: "JSON", required: true, max_bytes: 16 * 1024 * 1024 },
  ],
});

export type AnalysisProgramMode = "FROZEN_TEMPLATE" | "MODEL_GENERATED" | "HYBRID";

export interface AnalysisSkillDescriptor {
  readonly skill_id: AnalysisSkillId;
  readonly input_contract_version: string;
  readonly output_contract_version: string;
  readonly required_capabilities: readonly string[];
  readonly parameter_schema: z.ZodType;
  readonly hard_limits: Readonly<{
    max_metrics: number;
    max_dimensions: number;
    max_series_points: number;
    max_groups: number;
    max_sql_executions: number;
    max_sandbox_executions: number;
    wall_time_ms: number;
    memory_bytes: number;
  }>;
  readonly algorithm_version: string;
  readonly program_mode: AnalysisProgramMode;
  readonly python_import_profile: AnalysisRuntimeProfile;
  readonly output_contract: PythonOutputContractV1;
  readonly standard_program: string | null;
  readonly mandatory_disclosures: readonly AnalysisDisclosureCode[];
}

export class AnalysisSkillCatalogError extends TypeError {
  override readonly name = "AnalysisSkillCatalogError";

  constructor(
    readonly code:
      | "ANALYSIS_SKILL_NOT_REGISTERED"
      | "ANALYSIS_SKILL_REGISTRY_CONFLICT"
      | "ANALYSIS_SKILL_PARAMETER_INVALID"
      | "ANALYSIS_RELEASE_MANIFEST_NOT_AUTHORITATIVE",
  ) {
    super(code);
  }
}

const standardParameters = z.strictObject({}).or(
  z.strictObject({
    minimum_samples: z.number().int().positive().max(5_000).optional(),
    threshold: z.number().positive().finite().max(100).optional(),
    horizon: z.number().int().positive().max(512).optional(),
    minimum_train: z.number().int().positive().max(5_000).optional(),
    closure_tolerance: z.number().nonnegative().finite().max(1).optional(),
  }),
);

const transformParameters = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("CHART_DATASET"),
    max_rows: z.number().int().positive().max(5_000),
  }),
  z.strictObject({ kind: z.literal("GROUP_BY") }),
  z.strictObject({ kind: z.literal("WINDOW"), periods: z.number().int().positive().max(512) }),
]);

const storyParameters = z.strictObject({
  intent: z.enum([
    "TREND",
    "RANKING",
    "COMPOSITION",
    "RELATIONSHIP",
    "DISTRIBUTION",
    "CONTRIBUTION",
  ]),
  max_charts: z.number().int().positive().max(6).default(3),
});

const generatedParameters = z.strictObject({
  declared_method: versionIdentifierSchema,
  acceptance_case_id: versionIdentifierSchema.optional(),
  question: z.string().trim().min(1).max(8_000).optional(),
  required_methods: z.array(versionIdentifierSchema).min(1).max(32).optional(),
  result_schema_version: versionIdentifierSchema.optional(),
  required_output_fields: z.array(versionIdentifierSchema).min(1).max(64).optional(),
  claim_strength: z.enum(["DESCRIPTIVE", "ASSOCIATION_ONLY", "HOLD_WITH_SENSITIVITY"]).optional(),
});

const commonLimits = Object.freeze({
  max_metrics: 1,
  max_dimensions: 5,
  max_series_points: 5_000,
  max_groups: 5_000,
  max_sql_executions: 1,
  max_sandbox_executions: 1,
  wall_time_ms: 120_000,
  memory_bytes: 1_073_741_824,
});

function descriptor(
  input: Omit<
    AnalysisSkillDescriptor,
    "input_contract_version" | "output_contract_version" | "hard_limits"
  > & {
    readonly hard_limits?: Partial<AnalysisSkillDescriptor["hard_limits"]>;
  },
): AnalysisSkillDescriptor {
  return Object.freeze({
    ...input,
    input_contract_version: "query-evidence@2.0.0",
    output_contract_version: "derived-analysis-evidence@1.0.0",
    hard_limits: Object.freeze({ ...commonLimits, ...input.hard_limits }),
  });
}

export const DEFAULT_ANALYSIS_SKILL_DESCRIPTORS: readonly AnalysisSkillDescriptor[] = Object.freeze(
  [
    descriptor({
      skill_id: "data-profile@1",
      required_capabilities: ["DATA_PROFILE"],
      parameter_schema: z.strictObject({}),
      algorithm_version: "data-profile@1.0.0",
      program_mode: "FROZEN_TEMPLATE",
      python_import_profile: "CORE_ANALYSIS",
      output_contract: resultOnlyContract,
      standard_program: "data_profile.py",
      mandatory_disclosures: [],
    }),
    descriptor({
      skill_id: "semantic-transform@1",
      required_capabilities: ["CHART_DATASET"],
      parameter_schema: transformParameters,
      algorithm_version: "semantic-transform@1.0.0",
      program_mode: "FROZEN_TEMPLATE",
      python_import_profile: "CORE_ANALYSIS",
      output_contract: resultOnlyContract,
      standard_program: null,
      mandatory_disclosures: [],
    }),
    descriptor({
      skill_id: "trend-change@1",
      required_capabilities: ["TREND_CHANGE"],
      parameter_schema: standardParameters,
      algorithm_version: "trend-change@1.0.0",
      program_mode: "FROZEN_TEMPLATE",
      python_import_profile: "CORE_ANALYSIS",
      output_contract: resultOnlyContract,
      standard_program: "trend_change.py",
      mandatory_disclosures: [],
    }),
    descriptor({
      skill_id: "contribution-concentration@1",
      required_capabilities: ["CONTRIBUTION", "CONCENTRATION"],
      parameter_schema: standardParameters,
      algorithm_version: "contribution-concentration@1.0.0",
      program_mode: "FROZEN_TEMPLATE",
      python_import_profile: "CORE_ANALYSIS",
      output_contract: resultOnlyContract,
      standard_program: "contribution_concentration.py",
      mandatory_disclosures: [],
    }),
    descriptor({
      skill_id: "robust-anomaly@1",
      required_capabilities: ["ROBUST_ANOMALY"],
      parameter_schema: standardParameters,
      algorithm_version: "robust-anomaly@1.0.0",
      program_mode: "FROZEN_TEMPLATE",
      python_import_profile: "CORE_ANALYSIS",
      output_contract: resultOnlyContract,
      standard_program: "robust_anomaly.py",
      mandatory_disclosures: [],
    }),
    descriptor({
      skill_id: "association-outlier-completeness@1",
      required_capabilities: ["ASSOCIATION"],
      parameter_schema: standardParameters,
      algorithm_version: "association-quality@1.0.0",
      program_mode: "FROZEN_TEMPLATE",
      python_import_profile: "CORE_ANALYSIS",
      output_contract: resultOnlyContract,
      standard_program: "association_quality.py",
      mandatory_disclosures: ["STATISTICAL_ASSOCIATION_NOT_CAUSATION"],
    }),
    descriptor({
      skill_id: "baseline-forecast-backtest@1",
      required_capabilities: ["FORECAST"],
      parameter_schema: standardParameters,
      algorithm_version: "forecast-backtest@1.0.0",
      program_mode: "FROZEN_TEMPLATE",
      python_import_profile: "ML_DIAGNOSTIC",
      output_contract: forecastContract,
      standard_program: "forecast_backtest.py",
      mandatory_disclosures: ["BASELINE_FORECAST_NOT_COMMITMENT"],
    }),
    descriptor({
      skill_id: "open-python-analysis@1",
      required_capabilities: ["CHART_DATASET"],
      parameter_schema: generatedParameters,
      algorithm_version: "open-python-analysis@1.0.0",
      program_mode: "MODEL_GENERATED",
      python_import_profile: "ML_DIAGNOSTIC",
      output_contract: resultOnlyContract,
      standard_program: null,
      mandatory_disclosures: [],
    }),
    descriptor({
      skill_id: "root-cause-investigation@1",
      required_capabilities: ["ROOT_CAUSE_DISCOVERY"],
      parameter_schema: z.strictObject({ level: z.enum(["L4_DISCOVERY", "L5_CAUSAL"]) }),
      algorithm_version: "root-cause-investigation@1.0.0",
      program_mode: "HYBRID",
      python_import_profile: "CAUSAL_L5",
      output_contract: resultOnlyContract,
      standard_program: null,
      mandatory_disclosures: [
        "STATISTICAL_ASSOCIATION_NOT_CAUSATION",
        "ROOT_CAUSE_CANDIDATE_NOT_CERTIFIED",
      ],
    }),
    descriptor({
      skill_id: "visual-insight-story@1",
      required_capabilities: ["CHART_DATASET"],
      parameter_schema: storyParameters,
      algorithm_version: "visual-insight-story@1.0.0",
      program_mode: "FROZEN_TEMPLATE",
      python_import_profile: "CORE_ANALYSIS",
      output_contract: resultOnlyContract,
      standard_program: null,
      mandatory_disclosures: [],
    }),
  ],
);

export class AnalysisSkillCatalog {
  readonly #descriptors: ReadonlyMap<AnalysisSkillId, AnalysisSkillDescriptor>;

  constructor(
    descriptors: readonly AnalysisSkillDescriptor[] = DEFAULT_ANALYSIS_SKILL_DESCRIPTORS,
  ) {
    const registered = new Map<AnalysisSkillId, AnalysisSkillDescriptor>();
    for (const input of descriptors) {
      const skillId = analysisSkillIdSchema.parse(input.skill_id);
      if (registered.has(skillId)) {
        throw new AnalysisSkillCatalogError("ANALYSIS_SKILL_REGISTRY_CONFLICT");
      }
      registered.set(skillId, Object.freeze(input));
    }
    this.#descriptors = registered;
  }

  resolve(skillIdInput: string): AnalysisSkillDescriptor {
    const parsed = analysisSkillIdSchema.safeParse(skillIdInput);
    const descriptor = parsed.success ? this.#descriptors.get(parsed.data) : undefined;
    if (!descriptor) throw new AnalysisSkillCatalogError("ANALYSIS_SKILL_NOT_REGISTERED");
    return descriptor;
  }

  parseParameters(skillId: string, input: unknown): unknown {
    const parsed = this.resolve(skillId).parameter_schema.safeParse(input);
    if (!parsed.success) throw new AnalysisSkillCatalogError("ANALYSIS_SKILL_PARAMETER_INVALID");
    return parsed.data;
  }

  list(): readonly AnalysisSkillDescriptor[] {
    return Object.freeze(
      ANALYSIS_SKILL_IDS.flatMap((skillId) => {
        const value = this.#descriptors.get(skillId);
        return value ? [value] : [];
      }),
    );
  }
}

export const DEFAULT_ANALYSIS_SKILL_CATALOG = new AnalysisSkillCatalog();

/**
 * Builds the server-owned executable catalog after release-manifest kill switches
 * have been resolved. This boundary is intentionally not exposed as a tool input:
 * callers can select parameters, but cannot re-register a killed executor.
 */
export function createServerOwnedAnalysisSkillCatalog(
  killedSkillIds: ReadonlySet<AnalysisSkillId>,
): AnalysisSkillCatalog {
  for (const skillId of killedSkillIds) analysisSkillIdSchema.parse(skillId);
  return new AnalysisSkillCatalog(
    DEFAULT_ANALYSIS_SKILL_DESCRIPTORS.filter(({ skill_id }) => !killedSkillIds.has(skill_id)),
  );
}

export function createServerOwnedAnalysisSkillCatalogFromReleaseManifest(
  manifest: AuthoritativeReleaseManifest,
): AnalysisSkillCatalog {
  if (!isAuthoritativeReleaseManifest(manifest) || !manifest.deterministic_analysis_rollout) {
    throw new AnalysisSkillCatalogError("ANALYSIS_RELEASE_MANIFEST_NOT_AUTHORITATIVE");
  }
  const rollout = manifest.deterministic_analysis_rollout;
  return createServerOwnedAnalysisSkillCatalog(
    new Set(
      ANALYSIS_SKILL_IDS.filter(
        (skillId) => !isDeterministicAnalysisCapabilityExecutable(rollout, skillId),
      ),
    ),
  );
}
