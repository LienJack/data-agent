import type { DatasourceAdapterDescriptor } from "@data-agent/contracts";
import { assertPostgresqlSandboxSqlPolicy } from "../../sandbox/postgresql-sql-policy.internal.js";
import {
  createGovernedDatasourceAdapter,
  type DatasourceAdapterTargetAuthority,
  type DatasourceAdapterTransport,
} from "./common.js";

export function createPostgresqlDatasourceAdapter(input: {
  readonly descriptor: DatasourceAdapterDescriptor;
  readonly target_authority: DatasourceAdapterTargetAuthority;
  readonly transport: DatasourceAdapterTransport;
  readonly now?: () => number;
}) {
  return createGovernedDatasourceAdapter({
    ...input,
    validate_statement: (request) =>
      assertPostgresqlSandboxSqlPolicy({
        sql: request.statement,
        allowed_relations: request.allowed_relations.map((relation) => {
          const [schema_name, relation_name] = relation.includes(".")
            ? relation.split(".", 2)
            : ["public", relation];
          return { schema_name: schema_name ?? "public", relation_name: relation_name ?? relation };
        }),
      }),
  });
}
