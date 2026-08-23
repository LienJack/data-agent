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

function clickhousePolicy(request: GovernedDatasourceQueryRequest): void {
  const normalized = request.statement
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, " ")
    .trim();
  if (normalized.includes(";") || !/^(?:SELECT|WITH)\b/i.test(normalized)) {
    throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_READ_ONLY_REQUIRED");
  }
  if (
    /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|ATTACH|DETACH|SYSTEM)\b/i.test(normalized)
  ) {
    throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_READ_ONLY_REQUIRED");
  }
  const allowed = new Set(request.allowed_relations);
  const relations = [...normalized.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_.]*)/gi)].map(
    (match) => match[1] ?? "",
  );
  if (relations.length === 0 || relations.some((relation) => !allowed.has(relation))) {
    throw new DatasourceAdapterPolicyError("DATASOURCE_ADAPTER_RELATION_DENIED");
  }
}

export function createClickhouseDatasourceAdapter(input: {
  readonly descriptor: DatasourceAdapterDescriptor;
  readonly target_authority: DatasourceAdapterTargetAuthority;
  readonly transport: DatasourceAdapterTransport;
  readonly now?: () => number;
}) {
  return createGovernedDatasourceAdapter({ ...input, validate_statement: clickhousePolicy });
}
