import "server-only";

import {
  PostgresSemanticGovernanceService,
  type SqlPool,
  type TransactionalCapabilityAuthorizer,
} from "@data-agent/platform";
import {
  createSemanticGovernanceService,
  type SemanticGovernanceService,
} from "@data-agent/semantic/application";
import type { SemanticAuthorityResolver } from "./semantic-authority";

export interface SemanticGovernanceRuntime {
  readonly service: SemanticGovernanceService;
  readonly authorityResolver: SemanticAuthorityResolver;
}

export function createSemanticGovernanceRuntime(dependencies: {
  readonly sqlPool: SqlPool;
  readonly transactionalAuthorizer: TransactionalCapabilityAuthorizer;
  readonly authorityResolver: SemanticAuthorityResolver;
}): SemanticGovernanceRuntime {
  const adapter = new PostgresSemanticGovernanceService(
    dependencies.sqlPool,
    dependencies.transactionalAuthorizer,
  );
  return Object.freeze({
    service: createSemanticGovernanceService(adapter),
    authorityResolver: dependencies.authorityResolver,
  });
}
