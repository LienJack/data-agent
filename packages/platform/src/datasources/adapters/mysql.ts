import type { DatasourceAdapterDescriptor } from "@data-agent/contracts";
import {
  createGovernedDatasourceAdapter,
  type DatasourceAdapterTargetAuthority,
  type DatasourceAdapterTransport,
} from "./common.js";
import { createNodeSqlStatementPolicy } from "./node-sql-policy.js";

export function createMysqlDatasourceAdapter(input: {
  readonly descriptor: DatasourceAdapterDescriptor;
  readonly target_authority: DatasourceAdapterTargetAuthority;
  readonly transport: DatasourceAdapterTransport;
  readonly now?: () => number;
}) {
  return createGovernedDatasourceAdapter({
    ...input,
    validate_statement: createNodeSqlStatementPolicy("MySQL"),
  });
}
