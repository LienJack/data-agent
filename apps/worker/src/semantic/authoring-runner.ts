import {
  ModelProviderAgentTurnAdapter,
  type SemanticAgentTurnInvocationFactory,
} from "@data-agent/agent-runtime";
import type {
  ModelProviderPort,
  PortResult,
  SemanticAuthoringResumeInput,
  SemanticAuthoringStartInput,
  SemanticAuthoringState,
} from "@data-agent/contracts";
import {
  createPostgresSemanticAuthoringStore,
  type PostgresSemanticAuthoringStoreOptions,
} from "@data-agent/platform";
import { createSemanticAuthoringOrchestrator } from "@data-agent/semantic";

export interface WorkerSemanticAuthoringRunner {
  start(input: SemanticAuthoringStartInput): Promise<PortResult<SemanticAuthoringState>>;
  resume(input: SemanticAuthoringResumeInput): Promise<PortResult<SemanticAuthoringState>>;
  recover(state: SemanticAuthoringState): Promise<PortResult<SemanticAuthoringState>>;
}

/**
 * Worker composition root: provider proposes calls, while the Worker-owned
 * orchestrator and PostgreSQL store execute/fence every candidate mutation.
 */
export function createWorkerSemanticAuthoringRunner(input: {
  readonly provider: ModelProviderPort;
  readonly create_invocation: SemanticAgentTurnInvocationFactory;
  readonly store: PostgresSemanticAuthoringStoreOptions;
  readonly new_id?: () => string;
  readonly now?: () => string;
  readonly compiler_version?: string;
  readonly before_step?: (state: SemanticAuthoringState) => Promise<PortResult<void>>;
}): WorkerSemanticAuthoringRunner {
  const agent = new ModelProviderAgentTurnAdapter({
    provider: input.provider,
    create_invocation: input.create_invocation,
  });
  const store = createPostgresSemanticAuthoringStore(input.store);
  const orchestrator = createSemanticAuthoringOrchestrator({
    agent,
    store,
    ...(input.new_id === undefined ? {} : { new_id: input.new_id }),
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.compiler_version === undefined ? {} : { compiler_version: input.compiler_version }),
    ...(input.before_step === undefined ? {} : { before_step: input.before_step }),
  });
  return Object.freeze({
    start: (authoringInput: SemanticAuthoringStartInput) =>
      orchestrator.startAndRun(authoringInput),
    resume: (resumeInput: SemanticAuthoringResumeInput) => orchestrator.resumeAndRun(resumeInput),
    recover: (state: SemanticAuthoringState) => orchestrator.continueRun(state),
  });
}
