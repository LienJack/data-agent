import {
  type ArtifactReference,
  artifactReferenceIdentity,
  type ProductTeamArtifactDocument,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import { type AppScope, canonicalizeJson } from "@data-agent/contracts/common";

type ReportProjection = Extract<ProductTeamArtifactDocument["projection"], { kind: "REPORT" }>;

// This is a projection of already admitted references, not an acceptance authority.
// The caller must admit every input and retain the same Run/Scope at resolution.
export async function resolveReportEvidence(input: {
  readonly references: readonly ArtifactReference[];
  readonly scope: AppScope;
  readonly run_id: string;
  readonly resolve: (reference: ArtifactReference) => Promise<ProductTeamArtifactDocument | null>;
}) {
  const identities = input.references.map(artifactReferenceIdentity);
  if (
    identities.length === 0 ||
    identities.length > 16 ||
    new Set(identities).size !== identities.length ||
    input.references.some(
      (reference) =>
        !["QueryEvidence", "AnalysisReport"].includes(reference.artifact_type) ||
        reference.run_id !== input.run_id ||
        reference.app_id !== input.scope.app_id ||
        reference.tenant_id !== input.scope.tenant_id ||
        reference.environment !== input.scope.environment,
    )
  )
    throw new Error("TEAM_REPORT_INPUT_INVALID");

  const documents: ProductTeamArtifactDocument[] = [];
  const sourceRefs = new Map(input.references.map((ref) => [artifactReferenceIdentity(ref), ref]));
  const retainedSections: ReportProjection["sections"] = [];
  for (const reference of input.references) {
    const resolved = await input.resolve(reference);
    if (!resolved) throw new Error("TEAM_REPORT_INPUT_NOT_COMMITTED");
    const document = await verifyProductTeamArtifactDocument(resolved);
    if (artifactReferenceIdentity(document.artifact_ref) !== artifactReferenceIdentity(reference))
      throw new Error("TEAM_REPORT_INPUT_CORRELATION_INVALID");
    documents.push(document);
    if (document.projection.kind === "REPORT") {
      const allowedSources = new Set(document.source_refs.map(artifactReferenceIdentity));
      for (const section of document.projection.sections) {
        if (section.source_refs.some((ref) => !allowedSources.has(artifactReferenceIdentity(ref))))
          throw new Error("TEAM_REPORT_SECTION_SOURCE_INVALID");
        retainedSections.push(section);
      }
      for (const ref of document.source_refs) sourceRefs.set(artifactReferenceIdentity(ref), ref);
    }
  }
  // Respect the existing Product Artifact and projection limits; never silently drop evidence.
  if (sourceRefs.size > 16 || retainedSections.length > 99)
    throw new Error("TEAM_REPORT_COMPOSITION_LIMIT_EXCEEDED");
  const single = documents.length === 1 ? documents[0] : undefined;
  const context =
    single?.projection.kind === "TABLE"
      ? {
          evidence_ref: single.artifact_ref,
          columns: single.projection.columns,
          rows: single.projection.rows,
          total_rows: single.projection.total_rows,
        }
      : {
          accepted_inputs: documents.map((document) => ({
            evidence_ref: document.artifact_ref,
            projection: document.projection,
          })),
        };
  return {
    context_text: canonicalizeJson(context),
    source_refs: [...sourceRefs.values()],
    retained_sections: retainedSections,
  };
}
