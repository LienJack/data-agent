import {
  buildOntologyPackageCandidate,
  buildOntologyPackageValidationReceipt,
  computeOntologyPackageSourceBindingHash,
  type OntologyPackageCandidate,
  ontologyPackageCandidateSchema,
  sha256ContentHash,
  verifyOntologyPackageCandidate,
} from "@data-agent/contracts";
import { computeSemanticGraphDigest } from "./canonicalize.js";
import { validateSemanticGraph } from "./validator.js";

export const ONTOLOGY_PACKAGE_COMPILER_VERSION = "ontology-package-compiler@1.0.0" as const;
export const ONTOLOGY_PACKAGE_VALIDATOR_VERSION = "ontology-package-validator@1.0.0" as const;

export type OntologyPackageValidationCode =
  | "PACKAGE_SCHEMA_INVALID"
  | "PACKAGE_HASH_INVALID"
  | "PACKAGE_CLOSURE_INVALID"
  | `GRAPH_${string}`;

export interface OntologyPackageValidationIssue {
  readonly code: OntologyPackageValidationCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
  readonly object_id: string | null;
}

export interface OntologyPackageValidationResult {
  readonly valid: boolean;
  readonly candidate: OntologyPackageCandidate | null;
  readonly issues: readonly OntologyPackageValidationIssue[];
}

export interface OntologyPackagePreview {
  readonly schema_version: "ontology-package-preview@1.0.0";
  readonly namespace_id: string;
  readonly package_id: string;
  readonly package_version: number;
  readonly package_hash: `sha256:${string}`;
  readonly graph_source_digest: `sha256:${string}`;
  readonly mandatory_object_ids: readonly string[];
  readonly runtime_queryable_object_ids: readonly string[];
  readonly knowledge_only_object_ids: readonly string[];
  readonly formula_ast_digests: readonly {
    readonly metric_object_id: string;
    readonly formula_ast_hash: `sha256:${string}`;
  }[];
  readonly compiler_version: typeof ONTOLOGY_PACKAGE_COMPILER_VERSION;
  readonly compiler_digest: `sha256:${string}`;
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function issueSortKey(issue: OntologyPackageValidationIssue): string {
  return `${issue.code}:${JSON.stringify(issue.path)}:${issue.object_id ?? ""}:${issue.message}`;
}

function schemaIssues(error: {
  readonly issues: readonly { path: PropertyKey[]; message: string }[];
}) {
  return error.issues.map(
    (issue): OntologyPackageValidationIssue => ({
      code: "PACKAGE_SCHEMA_INVALID",
      path: issue.path.map((entry) => (typeof entry === "symbol" ? String(entry) : entry)),
      message: issue.message,
      object_id: null,
    }),
  );
}

export async function validateOntologyPackageCandidate(
  input: unknown,
): Promise<OntologyPackageValidationResult> {
  const parsed = ontologyPackageCandidateSchema.safeParse(input);
  if (!parsed.success) {
    const issues = schemaIssues(parsed.error).sort((left, right) =>
      compareStable(issueSortKey(left), issueSortKey(right)),
    );
    return { valid: false, candidate: null, issues };
  }

  const candidate = parsed.data;
  const issues: OntologyPackageValidationIssue[] = [];
  if (!(await verifyOntologyPackageCandidate(candidate))) {
    issues.push({
      code: "PACKAGE_HASH_INVALID",
      path: ["package_hash"],
      message: "Ontology Package canonical hash verification failed.",
      object_id: null,
    });
  }

  const { package_hash: _packageHash, ...draft } = candidate;
  try {
    await buildOntologyPackageCandidate(draft);
  } catch (error) {
    issues.push({
      code: "PACKAGE_CLOSURE_INVALID",
      path: [],
      message: error instanceof Error ? error.message : "Ontology Package closure is invalid.",
      object_id: null,
    });
  }

  try {
    const unresolvedGraphEntries = new Set(
      candidate.objects
        .filter((object) => object.resolution === "UNRESOLVED")
        .map((object) => object.graph_entry_id),
    );
    for (const graphIssue of validateSemanticGraph(candidate.graph_source)) {
      if (
        graphIssue.code === "RUNTIME_CAPABILITY_UNSUPPORTED" &&
        graphIssue.entry_id !== undefined &&
        unresolvedGraphEntries.has(graphIssue.entry_id)
      ) {
        continue;
      }
      issues.push({
        code: `GRAPH_${graphIssue.code}`,
        path: ["graph_source"],
        message: graphIssue.message,
        object_id: graphIssue.entry_id ?? null,
      });
    }
  } catch (error) {
    issues.push({
      code: "PACKAGE_SCHEMA_INVALID",
      path: ["graph_source"],
      message: error instanceof Error ? error.message : "Graph v2 source is invalid.",
      object_id: null,
    });
  }

  issues.sort((left, right) => compareStable(issueSortKey(left), issueSortKey(right)));
  return { valid: issues.length === 0, candidate, issues };
}

function canonicalMandatoryIds(candidate: OntologyPackageCandidate): string[] {
  return [
    ...candidate.mandatory_manifest.node_object_ids,
    ...candidate.mandatory_manifest.edge_object_ids,
    ...candidate.mandatory_manifest.constraint_ids,
    ...candidate.mandatory_manifest.mapping_ids,
    ...candidate.mandatory_manifest.metric_object_ids,
  ].sort(compareStable);
}

export async function compileOntologyPackagePreview(
  input: unknown,
): Promise<OntologyPackagePreview> {
  const validation = await validateOntologyPackageCandidate(input);
  if (!validation.valid || validation.candidate === null) {
    const summary = validation.issues.map((issue) => `${issue.code}: ${issue.message}`).join("; ");
    throw new TypeError(`Ontology Package cannot be compiled: ${summary}`);
  }
  const candidate = validation.candidate;
  const mandatoryObjectIds = canonicalMandatoryIds(candidate);
  const queryable = new Set(mandatoryObjectIds);
  for (const mapping of candidate.physical_mappings) {
    if (mapping.mode === "QUERYABLE" && mapping.resolution === "RESOLVED") {
      queryable.add(mapping.logical_object_id);
      queryable.add(mapping.mapping_id);
    }
  }
  const knowledgeOnly = new Set(
    candidate.objects
      .filter((object) => object.resolution === "UNRESOLVED")
      .map((object) => object.object_id),
  );
  for (const mapping of candidate.physical_mappings) {
    if (mapping.mode === "KNOWLEDGE_ONLY") {
      knowledgeOnly.add(mapping.logical_object_id);
      knowledgeOnly.add(mapping.mapping_id);
    }
  }
  for (const objectId of queryable) knowledgeOnly.delete(objectId);

  const material: Omit<OntologyPackagePreview, "compiler_digest"> = {
    schema_version: "ontology-package-preview@1.0.0" as const,
    namespace_id: candidate.namespace.namespace_id,
    package_id: candidate.package_id,
    package_version: candidate.package_version,
    package_hash: candidate.package_hash as `sha256:${string}`,
    graph_source_digest: await computeSemanticGraphDigest(candidate.graph_source),
    mandatory_object_ids: mandatoryObjectIds,
    runtime_queryable_object_ids: [...queryable].sort(compareStable),
    knowledge_only_object_ids: [...knowledgeOnly].sort(compareStable),
    formula_ast_digests: candidate.metric_bindings
      .map((binding) => ({
        metric_object_id: binding.metric_object_id,
        formula_ast_hash: binding.formula_ast_hash as `sha256:${string}`,
      }))
      .sort((left, right) => compareStable(left.metric_object_id, right.metric_object_id)),
    compiler_version: ONTOLOGY_PACKAGE_COMPILER_VERSION,
  };
  return Object.freeze({ ...material, compiler_digest: await sha256ContentHash(material) });
}

export async function createOntologyPackageValidationReceipt(input: {
  readonly candidate: unknown;
  readonly receipt_id: string;
  readonly validated_at: string;
}) {
  const validation = await validateOntologyPackageCandidate(input.candidate);
  if (validation.candidate === null) {
    throw new TypeError("A structurally valid candidate is required for a validation receipt.");
  }
  const preview = validation.valid
    ? await compileOntologyPackagePreview(validation.candidate)
    : { compiler_digest: await sha256ContentHash({ valid: false, issues: validation.issues }) };
  return buildOntologyPackageValidationReceipt({
    schema_version: "ontology-package-validation@1.0.0",
    receipt_id: input.receipt_id,
    namespace: validation.candidate.namespace,
    package_id: validation.candidate.package_id,
    package_version: validation.candidate.package_version,
    package_hash: validation.candidate.package_hash,
    source_binding_hash: await computeOntologyPackageSourceBindingHash(
      validation.candidate.source_binding,
    ),
    compiler_digest: preview.compiler_digest,
    validator_version: ONTOLOGY_PACKAGE_VALIDATOR_VERSION,
    valid: validation.valid,
    issues: validation.issues.map((issue) => ({
      code: issue.code,
      path: [...issue.path],
      message: issue.message,
      object_id: issue.object_id,
    })),
    validated_at: input.validated_at,
  });
}
