import type {
  DatasourceAdapterDescriptor,
  GovernedDatasourceQueryRequest,
} from "@data-agent/contracts";
import {
  createGovernedDatasourceAdapter,
  DatasourceAdapterPolicyError,
  type DatasourceAdapterTargetAuthority,
  type DatasourceAdapterTransport,
} from "./common.js";

export interface DuckdbStatementExtractor {
  extract(statement: string): Promise<{
    readonly statement_count: number;
    readonly statement_type: string;
    readonly relations: readonly string[];
    readonly external_access: boolean;
  }>;
}

export function createDuckdbDatasourceAdapter(input: {
  readonly descriptor: DatasourceAdapterDescriptor;
  readonly target_authority: DatasourceAdapterTargetAuthority;
  readonly extractor: DuckdbStatementExtractor;
  readonly transport: DatasourceAdapterTransport;
  readonly now?: () => number;
}) {
  return createGovernedDatasourceAdapter({
    ...input,
    validate_statement: async (request: GovernedDatasourceQueryRequest) => {
      const extracted = await input.extractor.extract(request.statement);
      if (extracted.statement_count !== 1) {
        throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_SINGLE_STATEMENT_REQUIRED");
      }
      if (extracted.statement_type !== "SELECT" || extracted.external_access) {
        throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_READ_ONLY_REQUIRED");
      }
      const allowed = new Set(request.allowed_relations);
      if (
        extracted.relations.length === 0 ||
        extracted.relations.some((relation) => !allowed.has(relation))
      ) {
        throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RELATION_DENIED");
      }
    },
  });
}
