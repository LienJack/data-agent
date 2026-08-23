import "server-only";

import { randomUUID } from "node:crypto";
import type { AppCapability } from "@data-agent/platform";
import {
  createKnowledgeSearchService,
  createNeo4jKnowledgeIndexFromEnvironment,
  createOpenAiCompatibleEmbeddingProviderFactory,
  createUnavailableKnowledgeIndex,
  type KnowledgeIndex,
} from "@data-agent/platform";
import { ensureRootEnvironmentLoaded } from "./root-env";
import { getKnowledgeRegistry } from "./workspace-identity";

const KNOWLEDGE_RUNTIME = Symbol.for("data-agent.knowledge-runtime");

type RuntimeState = {
  index?: KnowledgeIndex;
  initializing?: Promise<KnowledgeIndex>;
};

function state(): RuntimeState {
  const globals = globalThis as typeof globalThis & { [KNOWLEDGE_RUNTIME]?: RuntimeState };
  globals[KNOWLEDGE_RUNTIME] ??= {};
  return globals[KNOWLEDGE_RUNTIME];
}

async function getKnowledgeIndex(): Promise<KnowledgeIndex> {
  const runtime = state();
  if (runtime.index) return runtime.index;
  runtime.initializing ??= (async () => {
    try {
      const index = createNeo4jKnowledgeIndexFromEnvironment(process.env);
      await index.initialize();
      runtime.index = index;
      return index;
    } catch {
      const unavailable = createUnavailableKnowledgeIndex();
      runtime.index = unavailable;
      return unavailable;
    }
  })();
  return runtime.initializing;
}

export async function getKnowledgeSearchService(capability: AppCapability) {
  ensureRootEnvironmentLoaded();
  return createKnowledgeSearchService({
    capability,
    registry: getKnowledgeRegistry(),
    embedding: createOpenAiCompatibleEmbeddingProviderFactory(process.env),
    index: await getKnowledgeIndex(),
    create_id: randomUUID,
    now: () => new Date(),
  });
}
