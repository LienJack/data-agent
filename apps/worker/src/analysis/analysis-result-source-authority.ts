import {
  type AnalysisResultContract,
  type ArtifactReference,
  verifyAnalysisResultContract,
} from "@data-agent/contracts/artifacts";
import { canonicalizeJson } from "@data-agent/contracts/common";
import { type AnalysisContext, verifyAnalysisContext } from "@data-agent/contracts/context";
import { verifyProductTeamQueryEvidenceInput } from "./governed-analysis-input.js";

export interface AcceptedAnalysisQueryEvidence {
  readonly reference: ArtifactReference & { readonly artifact_type: "QueryEvidence" };
  readonly document: unknown;
}

function reject(): never {
  throw new TypeError("ANALYSIS_PROGRAM_RESULT_SOURCE_AUTHORITY_INVALID");
}

/** Verify the accepted artifact against the original Run/Context/resource authority. */
export async function verifyAcceptedAnalysisQueryEvidence(input: {
  readonly context: AnalysisContext;
  readonly run_id: string;
  readonly query_evidence: AcceptedAnalysisQueryEvidence;
}) {
  const context = await verifyAnalysisContext(input.context);
  const { reference, document } = input.query_evidence;
  const verified = await verifyProductTeamQueryEvidenceInput({
    query_evidence_ref: reference,
    query_evidence_document: document,
  });
  const binding = verified.semantic_binding;
  if (
    reference.run_id !== input.run_id ||
    reference.app_id !== context.scope.app_id ||
    reference.tenant_id !== context.scope.tenant_id ||
    reference.environment !== context.scope.environment ||
    canonicalizeJson(binding.semantic_context_ref) !==
      canonicalizeJson(context.semantic_context_binding)
  )
    return reject();
  for (const [resource, artifact] of [
    [binding.semantic_release_ref, context.semantic_release_ref],
    [binding.schema_snapshot_ref, context.schema_snapshot_ref],
  ] as const) {
    if (
      resource.resource_id !== artifact.artifact_id ||
      resource.resource_revision !== artifact.revision ||
      resource.resource_hash !== artifact.content_hash ||
      artifact.run_id !== input.run_id
    )
      return reject();
  }
  return verified;
}

/** Data-only input authority. These IDs never enter Metric/Skill capability selection. */
export async function resolveAnalysisResultSourceObjects(input: {
  readonly result_contract: AnalysisResultContract;
  readonly context: AnalysisContext;
  readonly run_id: string;
  readonly selected_object_ids: ReadonlySet<string>;
  readonly query_evidence?: AcceptedAnalysisQueryEvidence;
}): Promise<ReadonlySet<string>> {
  try {
    const contract = await verifyAnalysisResultContract(input.result_contract);
    const sourceColumns = contract.tables.flatMap((table) =>
      table.columns
        .filter((column) => ["FORMULA", "REQUEST_DERIVED"].includes(column.semantic_role))
        .map((column) => ({ table, column })),
    );
    if (sourceColumns.length === 0) return new Set();
    const context = await verifyAnalysisContext(input.context);
    const evidence = input.query_evidence;
    if (!evidence) return reject();
    const { semantic_binding: binding } = await verifyAcceptedAnalysisQueryEvidence({
      context,
      run_id: input.run_id,
      query_evidence: evidence,
    });
    if (contract.semantic_context_hash !== context.semantic_context_binding.package_hash)
      return reject();
    const ids = new Set<string>();
    for (const { table, column } of sourceColumns) {
      const projection = table.projection;
      if (projection.mode !== "RESULT_COLLECTION") return reject();
      const source = projection.column_mappings.find(
        ({ table_column }) => table_column === column.key,
      )?.source;
      if (
        source?.input_name !== "query_evidence" ||
        input.selected_object_ids.has(column.semantic_object_id)
      )
        return reject();
      const matches = binding.columns.filter(
        (bound) =>
          bound.output_name === source.output_name &&
          bound.semantic_role === column.semantic_role &&
          bound.semantic_object_id === column.semantic_object_id &&
          bound.logical_type === "NUMBER",
      );
      const bound = matches[0];
      if (matches.length !== 1 || !bound || (bound.nullable && !column.nullable)) return reject();
      if (
        bound.semantic_role === "REQUEST_DERIVED" &&
        (!bound.request_derivation ||
          bound.request_derivation.interpretation.source_object_ids.some(
            (id) => !input.selected_object_ids.has(id),
          ))
      )
        return reject();
      ids.add(column.semantic_object_id);
    }
    return ids;
  } catch {
    return reject();
  }
}
