import type { SemanticInductionRegistryPort } from "@data-agent/contracts";
import type { JobHandler } from "../jobs/job-worker-runner.js";
import { createSemanticInductionJobHandler } from "../jobs/semantic-induction-job-handler.js";
import {
  createWorkerSemanticAuthoringRunner,
  type WorkerSemanticAuthoringRunner,
} from "./authoring-runner.js";
import {
  createSemanticRelationshipIndexer,
  type SemanticRelationshipIndexer,
} from "./relationship-indexer.js";

type AuthoringCompositionInput = Readonly<
  { feature: "AUTHORING" } & Parameters<typeof createWorkerSemanticAuthoringRunner>[0]
>;

type RelationshipCompositionInput = Readonly<
  { feature: "RELATIONSHIP_INDEX" } & Parameters<typeof createSemanticRelationshipIndexer>[0]
>;

interface InductionCompositionInput {
  readonly feature: "INDUCTION";
  readonly capability: unknown;
  readonly registry: SemanticInductionRegistryPort;
}

type WorkerSemanticJobCompositionInput =
  | AuthoringCompositionInput
  | RelationshipCompositionInput
  | InductionCompositionInput;

/** The only production entry point for binding a semantic job to its explicit ports. */
export function createWorkerSemanticJobComposition(
  input: AuthoringCompositionInput,
): WorkerSemanticAuthoringRunner;
export function createWorkerSemanticJobComposition(
  input: RelationshipCompositionInput,
): SemanticRelationshipIndexer;
export function createWorkerSemanticJobComposition(
  input: InductionCompositionInput,
): readonly [JobHandler, JobHandler];
export function createWorkerSemanticJobComposition(
  input: WorkerSemanticJobCompositionInput,
): WorkerSemanticAuthoringRunner | SemanticRelationshipIndexer | readonly [JobHandler, JobHandler] {
  switch (input.feature) {
    case "AUTHORING":
      return createWorkerSemanticAuthoringRunner(input);
    case "RELATIONSHIP_INDEX":
      return createSemanticRelationshipIndexer(input);
    case "INDUCTION":
      return Object.freeze([
        createSemanticInductionJobHandler({
          capability: input.capability,
          registry: input.registry,
        }),
        createSemanticInductionJobHandler({
          capability: input.capability,
          registry: input.registry,
          kind: "METRIC_IMPORT",
        }),
      ] as const);
  }
}
