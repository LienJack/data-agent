import {
  type ArtifactReference,
  artifactReferenceIdentity,
  canonicalizeJson,
  type PortResult,
  type ProductTeamArtifactDocument,
  type RootAgentDecisionCandidate,
  verifyProductTeamArtifactDocument,
} from "@data-agent/contracts";

export type RootAnswerVerification = Readonly<
  | {
      status: "ACCEPTED";
      rendered_text: string;
      evidence_refs: readonly ArtifactReference[];
      reason_code: "ROOT_ANSWER_VERIFIED";
    }
  | {
      status: "EVIDENCE_REQUIRED";
      rendered_text: null;
      evidence_refs: readonly [];
      reason_code: string;
    }
>;

export interface RootAnswerVerifierDependencies {
  readonly artifacts: {
    resolveCommitted(
      reference: ArtifactReference,
    ): Promise<PortResult<ProductTeamArtifactDocument | null>>;
  };
}

function evidenceRequired(reasonCode: string): RootAnswerVerification {
  return {
    status: "EVIDENCE_REQUIRED",
    rendered_text: null,
    evidence_refs: [],
    reason_code: reasonCode,
  };
}

function belongsToDecisionRun(
  decision: Pick<RootAgentDecisionCandidate, "scope" | "run_id">,
  reference: ArtifactReference,
): boolean {
  return (
    reference.app_id === decision.scope.app_id &&
    reference.tenant_id === decision.scope.tenant_id &&
    reference.environment === decision.scope.environment &&
    reference.run_id === decision.run_id
  );
}

function renderArtifactFacts(
  document: ProductTeamArtifactDocument,
  selectors: readonly string[],
): string | null {
  if (document.projection.kind === "REPORT") {
    if (
      selectors.some((selector) => !["projection.sections", "projection.title"].includes(selector))
    ) {
      return null;
    }
    const fields: string[] = [];
    if (selectors.includes("projection.title")) fields.push(document.projection.title);
    if (selectors.includes("projection.sections")) {
      fields.push(...document.projection.sections.map(({ body_text: bodyText }) => bodyText));
    }
    return fields.join("\n\n");
  }
  if (document.projection.kind === "TABLE") {
    if (
      selectors.some(
        (selector) =>
          !["projection.columns", "projection.rows", "projection.total_rows"].includes(selector),
      )
    ) {
      return null;
    }
    const fields: string[] = [];
    if (selectors.includes("projection.total_rows")) {
      fields.push(`total_rows=${document.projection.total_rows}`);
    }
    if (selectors.includes("projection.columns")) {
      fields.push(`columns=${JSON.stringify(document.projection.columns)}`);
    }
    if (selectors.includes("projection.rows")) {
      fields.push(`rows=${JSON.stringify(document.projection.rows)}`);
    }
    return fields.join("\n");
  }
  if (document.projection.kind === "SEMANTIC_CONTEXT") {
    const allowed = new Map<string, unknown>([
      ["projection.context.datasource", document.projection.context.datasource],
      ["projection.context.dimensions", document.projection.context.dimensions],
      ["projection.context.formulas", document.projection.context.formulas],
      ["projection.context.metrics", document.projection.context.metrics],
      ["projection.context.physical_bindings", document.projection.context.physical_bindings],
      ["projection.context.quality_constraints", document.projection.context.quality_constraints],
      ["projection.context.relationships", document.projection.context.relationships],
      ["projection.context.requested_object_ids", document.projection.context.requested_object_ids],
      ["projection.context.schema_snapshot", document.projection.context.schema_snapshot],
      ["projection.context.semantic_context_ref", document.projection.context.semantic_context_ref],
      ["projection.context.semantic_release", document.projection.context.semantic_release],
      ["projection.context.time_semantics", document.projection.context.time_semantics],
      [
        "projection.context.unresolved_ambiguities",
        document.projection.context.unresolved_ambiguities,
      ],
    ]);
    if (selectors.some((selector) => !allowed.has(selector))) return null;
    return selectors
      .map((selector) => `${selector}=${canonicalizeJson(allowed.get(selector))}`)
      .join("\n");
  }
  return null;
}

export function createRootAnswerVerifier(dependencies: RootAnswerVerifierDependencies) {
  return Object.freeze({
    async verify(input: {
      readonly decision: RootAgentDecisionCandidate;
      readonly visible_message_refs: readonly string[];
      readonly accepted_artifact_refs: readonly ArtifactReference[];
    }): Promise<RootAnswerVerification> {
      if (input.decision.kind !== "FINAL_ANSWER") {
        return evidenceRequired("ROOT_ANSWER_FINAL_CANDIDATE_REQUIRED");
      }
      const visibleMessages = new Set(input.visible_message_refs);
      const acceptedArtifacts = new Set(
        input.accepted_artifact_refs
          .filter((reference) => belongsToDecisionRun(input.decision, reference))
          .map(artifactReferenceIdentity),
      );
      const rendered: string[] = [];
      const evidence = new Map<string, ArtifactReference>();
      for (const section of input.decision.sections) {
        if (section.kind === "GENERAL_TEXT") {
          if (
            section.basis === "PROVIDED_CONTEXT" &&
            section.source_message_refs.some((reference) => !visibleMessages.has(reference))
          ) {
            return evidenceRequired("ROOT_ANSWER_MESSAGE_SOURCE_NOT_VISIBLE");
          }
          rendered.push(section.text);
          continue;
        }
        if (!belongsToDecisionRun(input.decision, section.artifact_ref)) {
          return evidenceRequired("ROOT_ANSWER_ARTIFACT_NOT_ACCEPTED");
        }
        const identity = artifactReferenceIdentity(section.artifact_ref);
        if (!acceptedArtifacts.has(identity)) {
          return evidenceRequired("ROOT_ANSWER_ARTIFACT_NOT_ACCEPTED");
        }
        const resolved = await dependencies.artifacts.resolveCommitted(section.artifact_ref);
        if (!resolved.ok || !resolved.value) {
          return evidenceRequired("ROOT_ANSWER_ARTIFACT_NOT_COMMITTED");
        }
        let document: ProductTeamArtifactDocument;
        try {
          document = await verifyProductTeamArtifactDocument(resolved.value);
        } catch {
          return evidenceRequired("ROOT_ANSWER_ARTIFACT_INVALID");
        }
        if (artifactReferenceIdentity(document.artifact_ref) !== identity) {
          return evidenceRequired("ROOT_ANSWER_ARTIFACT_CORRELATION_MISMATCH");
        }
        const facts = renderArtifactFacts(document, section.fact_selectors);
        if (!facts) return evidenceRequired("ROOT_ANSWER_FACT_SELECTOR_NOT_ALLOWED");
        rendered.push(facts);
        evidence.set(identity, section.artifact_ref);
      }
      return {
        status: "ACCEPTED",
        rendered_text: rendered.join("\n\n"),
        evidence_refs: [...evidence.values()],
        reason_code: "ROOT_ANSWER_VERIFIED",
      };
    },
  });
}
