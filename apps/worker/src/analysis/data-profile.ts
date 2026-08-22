import {
  type AnalysisContext,
  type ArtifactReference,
  type DataProfilePayload,
  dataProfilePayloadSchema,
  sha256ContentHash,
  verifyAnalysisContext,
} from "@data-agent/contracts";

export interface PhysicalTableProfile {
  readonly table_ref: string;
  readonly row_count: number;
  readonly columns: readonly {
    readonly name: string;
    readonly physical_type: string;
    readonly null_count: number;
    readonly distinct_estimate: number;
  }[];
  readonly sample_projection_ref: ArtifactReference | null;
  readonly time_coverage: DataProfilePayload["tables"][number]["time_coverage"];
  /** Candidate keys are physical observations and never become semantic grain. */
  readonly candidate_grain: readonly string[];
}

export async function buildGovernedDataProfile(input: {
  readonly context: AnalysisContext;
  readonly input_artifact_refs: readonly ArtifactReference[];
  readonly tables: readonly PhysicalTableProfile[];
  readonly published_semantic_binding: boolean;
}): Promise<DataProfilePayload> {
  const context = await verifyAnalysisContext(input.context);
  for (const reference of input.input_artifact_refs) {
    if (
      reference.app_id !== context.scope.app_id ||
      reference.tenant_id !== context.scope.tenant_id ||
      reference.environment !== context.scope.environment ||
      reference.run_id !== context.schema_snapshot_ref.run_id
    ) {
      throw new TypeError("DATA_PROFILE_INPUT_SCOPE_MISMATCH");
    }
  }
  if (input.tables.length === 0) throw new TypeError("DATA_PROFILE_EMPTY");
  const material = {
    artifact_type: "DataProfile",
    protocol_version: "data-profile@1.0.0",
    schema_snapshot_ref: context.schema_snapshot_ref,
    input_artifact_refs: [...input.input_artifact_refs],
    tables: input.tables.map((table) => ({
      ...table,
      columns: [...table.columns].sort((left, right) => left.name.localeCompare(right.name)),
      candidate_grain: [...new Set(table.candidate_grain)].sort(),
    })),
    semantic_binding_status: input.published_semantic_binding ? "PUBLISHED" : "UNRESOLVED",
    limitation_codes: input.published_semantic_binding ? [] : ["UNRESOLVED_SEMANTICS"],
  } as const;
  return dataProfilePayloadSchema.parse({
    ...material,
    profile_hash: await sha256ContentHash({ hash_domain: "data-profile@1.0.0", value: material }),
  });
}
