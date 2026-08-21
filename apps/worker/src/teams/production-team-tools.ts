import {
  type ArtifactReference,
  buildProductTeamArtifactDocument,
  type PortResult,
  type ProductTeamArtifactDocument,
} from "@data-agent/contracts";
import {
  compileEcommerceTableCountSql,
  type EcommerceBenchmarkQueryExecutor,
} from "@data-agent/platform";
import { z } from "zod";
import { hasRunProviderDispatchCapability } from "../runs/run-execution-context.js";
import type { ProductProfileToolPort } from "./mastra-profile-composition.js";
import {
  type ProductionTeamToolFactoryInput,
  productionTeamRuntimeInternals,
} from "./production-team-runtime.js";

const providerAnswerSchema = z.strictObject({ answer: z.string().min(1) });

export interface ProductionTeamArtifactPort {
  commit(
    capability: unknown,
    lease: ProductionTeamToolFactoryInput["lease"],
    document: ProductTeamArtifactDocument,
  ): Promise<PortResult<ArtifactReference>>;
  resolveCommitted(
    capability: unknown,
    reference: ArtifactReference,
  ): Promise<PortResult<ProductTeamArtifactDocument | null>>;
}

export interface ProductionTeamToolsDependencies {
  readonly capability: unknown;
  readonly artifacts: ProductionTeamArtifactPort;
  readonly sandbox: EcommerceBenchmarkQueryExecutor;
}

class ProductionTeamToolError extends Error {
  override readonly name = "ProductionTeamToolError";

  constructor(readonly code: string) {
    super(code);
  }
}

function portValue<T>(result: PortResult<T>): T {
  if (!result.ok) throw new ProductionTeamToolError(result.error.code);
  return result.value;
}

function committedAt(lease: ProductionTeamToolFactoryInput["lease"]): string {
  return new Date(Date.parse(lease.expires_at) - lease.lease_duration_ms).toISOString();
}

async function providerAnswer(input: ProductionTeamToolFactoryInput, stage: "text2sql" | "report") {
  const provider = input.execution_context.getProviderDispatchCapability();
  if (!hasRunProviderDispatchCapability(provider)) {
    throw new ProductionTeamToolError("PROVIDER_DISPATCH_AUTHORITY_NOT_CONFIGURED");
  }
  const result = portValue(
    await provider.invoke({
      logical_call_id: productionTeamRuntimeInternals.identity(
        input.lease.run_id,
        `provider:${stage}`,
      ),
    }),
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.output_text);
  } catch {
    throw new ProductionTeamToolError("TEAM_PROVIDER_RESPONSE_INVALID");
  }
  const answer = providerAnswerSchema.safeParse(parsed);
  if (!answer.success) throw new ProductionTeamToolError("TEAM_PROVIDER_RESPONSE_INVALID");
  return answer.data.answer;
}

async function commitArtifact(
  dependencies: ProductionTeamToolsDependencies,
  factoryInput: ProductionTeamToolFactoryInput,
  input: {
    readonly artifact_type: "SqlArtifact" | "QueryEvidence" | "AnalysisReport";
    readonly profile_id:
      | "governed-text2sql-agent"
      | "report-writing-agent"
      | "semantic-management-agent";
    readonly task_id: string;
    readonly source_refs: readonly ArtifactReference[];
    readonly projection: ProductTeamArtifactDocument["projection"];
  },
): Promise<ArtifactReference> {
  const document = await buildProductTeamArtifactDocument({
    schema_version: "product-team-artifact@1.0.0",
    artifact_ref: {
      artifact_id: productionTeamRuntimeInternals.identity(
        factoryInput.lease.run_id,
        `artifact:${input.artifact_type}`,
      ),
      artifact_type: input.artifact_type,
      ...factoryInput.lease.scope,
      run_id: factoryInput.lease.run_id,
      revision: 1,
      content_hash: `sha256:${"0".repeat(64)}`,
    },
    profile_id: input.profile_id,
    task_id: input.task_id,
    source_refs: input.source_refs,
    projection: input.projection,
    committed_at: committedAt(factoryInput.lease),
  });
  return portValue(
    await dependencies.artifacts.commit(dependencies.capability, factoryInput.lease, document),
  );
}

export function createProductionTeamTools(
  dependencies: ProductionTeamToolsDependencies,
  factoryInput: ProductionTeamToolFactoryInput,
): ProductProfileToolPort {
  const state: {
    sql_ref: ArtifactReference | null;
    provider_answer: string | null;
    semantic_ref: ArtifactReference | null;
  } = { sql_ref: null, provider_answer: null, semantic_ref: null };

  return Object.freeze({
    async invoke(input: Parameters<ProductProfileToolPort["invoke"]>[0]) {
      if (
        input.profile.revision.profile_id !== input.task.profile_id ||
        input.task.run_id !== factoryInput.lease.run_id
      ) {
        throw new ProductionTeamToolError("TEAM_TOOL_TASK_CORRELATION_INVALID");
      }
      if (input.task.profile_id === "semantic-management-agent") {
        if (input.tool_id === "semantic.catalog.read") {
          state.semantic_ref = await commitArtifact(dependencies, factoryInput, {
            artifact_type: "AnalysisReport",
            profile_id: "semantic-management-agent",
            task_id: input.task.task_id,
            source_refs: [],
            projection: {
              kind: "REPORT",
              title: "冻结语义层说明",
              sections: [
                {
                  heading: "语义层",
                  body_text: "已读取本次 Run 冻结的 Published Semantic Release。",
                  source_refs: [],
                },
              ],
            },
          });
          return state.semantic_ref;
        }
        throw new ProductionTeamToolError("SEMANTIC_AGENT_TOOL_DENIED");
      }
      if (input.task.profile_id === "governed-text2sql-agent") {
        if (input.tool_id === "semantic.release.read") return null;
        if (input.tool_id === "sql.compiler.compile") {
          state.provider_answer = await providerAnswer(factoryInput, "text2sql");
          const sql = compileEcommerceTableCountSql();
          state.sql_ref = await commitArtifact(dependencies, factoryInput, {
            artifact_type: "SqlArtifact",
            profile_id: "governed-text2sql-agent",
            task_id: input.task.task_id,
            source_refs: [],
            projection: { kind: "SQL", dialect: "postgresql", sql },
          });
          return state.sql_ref;
        }
        if (input.tool_id === "sql.sandbox.execute") {
          if (!state.sql_ref || !state.provider_answer) {
            throw new ProductionTeamToolError("TEAM_TEXT2SQL_COMPILE_REQUIRED");
          }
          const result = await dependencies.sandbox.executeTableCount({
            timeout_ms: Math.min(30_000, input.task.bounds.timeout_ms),
          });
          const columns = result.columns.map((column) => ({
            key: column,
            label: column,
            data_type: "NUMBER" as const,
          }));
          const rows = result.rows.map((row) =>
            Object.fromEntries(columns.map((column, index) => [column.key, row[index] ?? null])),
          );
          return commitArtifact(dependencies, factoryInput, {
            artifact_type: "QueryEvidence",
            profile_id: "governed-text2sql-agent",
            task_id: input.task.task_id,
            source_refs: [state.sql_ref],
            projection: { kind: "TABLE", columns, rows, total_rows: rows.length },
          });
        }
        throw new ProductionTeamToolError("TEXT2SQL_AGENT_TOOL_DENIED");
      }

      if (input.task.profile_id === "report-writing-agent") {
        const evidenceRef = factoryInput.accepted_evidence_ref;
        if (evidenceRef?.artifact_type !== "QueryEvidence") {
          throw new ProductionTeamToolError("TEAM_ACCEPTED_QUERY_EVIDENCE_REQUIRED");
        }
        if (input.tool_id === "evidence.read") return evidenceRef;
        if (input.tool_id === "report.project") {
          const evidence = portValue(
            await dependencies.artifacts.resolveCommitted(dependencies.capability, evidenceRef),
          );
          if (evidence?.projection.kind !== "TABLE") {
            throw new ProductionTeamToolError("TEAM_QUERY_EVIDENCE_NOT_COMMITTED");
          }
          await providerAnswer(factoryInput, "report");
          const tableCount = evidence.projection.rows[0]?.table_count;
          if (typeof tableCount !== "number" || !Number.isInteger(tableCount)) {
            throw new ProductionTeamToolError("TEAM_TABLE_COUNT_EVIDENCE_INVALID");
          }
          const answer = `当前受治理 E-commerce 数据库共有 ${tableCount} 张已批准业务表。`;
          return commitArtifact(dependencies, factoryInput, {
            artifact_type: "AnalysisReport",
            profile_id: "report-writing-agent",
            task_id: input.task.task_id,
            source_refs: [evidenceRef],
            projection: {
              kind: "REPORT",
              title: "E-commerce 数据库表数量",
              sections: [
                {
                  heading: "结论",
                  body_text: answer,
                  source_refs: [evidenceRef],
                },
              ],
            },
          });
        }
        throw new ProductionTeamToolError("REPORT_AGENT_TOOL_DENIED");
      }
      throw new ProductionTeamToolError("TEAM_TOOL_PROFILE_DENIED");
    },
  });
}
