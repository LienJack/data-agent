import {
  createSemanticExplorerToolExecutor,
  type SemanticExplorerToolExecutor,
  type SemanticExplorerToolService,
} from "@data-agent/agent-runtime";

/**
 * Worker composition wrapper. The injected service is the same server service
 * used by Web; the worker only owns dispatch and never receives SQL/Cypher.
 */
export function createWorkerSemanticExplorerToolExecutor<TAuthority>(
  service: SemanticExplorerToolService<TAuthority>,
): SemanticExplorerToolExecutor<TAuthority> {
  return createSemanticExplorerToolExecutor(service);
}
