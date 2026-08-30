import { createHash } from "node:crypto";
import {
  type RootAcceptedInputArtifact,
  rootAcceptedInputArtifactSchema,
} from "@data-agent/contracts/agents";
import {
  type ArtifactReference,
  artifactReferenceIdentity,
  artifactWorkspaceTableProjectionSchema,
  buildAcceptedTableInputProvenance,
  buildProductTeamArtifactDocument,
  type ProductTeamArtifactDocument,
} from "@data-agent/contracts/artifacts";
import { type PortResult, sha256ContentHash } from "@data-agent/contracts/common";
import { z } from "zod";
import type { RunWorkflowExecutorPort } from "../runs/run-worker-runner.js";
import type { DataAgentTeamRunnerDependencies } from "./data-agent-team-runner.js";

const acceptedTableInputSeedMaterialSchema = z
  .strictObject({
    schema_version: z.literal("accepted-table-input-seed@1.0.0"),
    scope: z.strictObject({
      app_id: z.uuid(),
      tenant_id: z.uuid(),
      environment: z.string().min(1).max(64),
      principal_id: z.uuid(),
    }),
    run_id: z.uuid(),
    acceptance_id: z.uuid(),
    accepted_at: z.iso.datetime({ offset: true }),
    title: z.string().trim().min(1).max(160),
    table: artifactWorkspaceTableProjectionSchema,
  })
  .superRefine((seed, ctx) => {
    if (seed.table.rows.length !== seed.table.total_rows) {
      ctx.addIssue({
        code: "custom",
        message: "Accepted table input seed must contain the complete frozen table.",
        path: ["table", "total_rows"],
      });
    }
  });

export const acceptedTableInputSeedConfigSchema = acceptedTableInputSeedMaterialSchema.extend({
  config_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/u),
});
export type AcceptedTableInputSeedConfig = z.infer<typeof acceptedTableInputSeedConfigSchema>;

export async function buildAcceptedTableInputSeedConfig(input: unknown) {
  const material = acceptedTableInputSeedMaterialSchema.parse(input);
  return acceptedTableInputSeedConfigSchema.parse({
    ...material,
    config_hash: await sha256ContentHash(material),
  });
}

export async function verifyAcceptedTableInputSeedConfig(input: unknown) {
  const config = acceptedTableInputSeedConfigSchema.parse(input);
  const { config_hash: observedHash, ...material } = config;
  if ((await sha256ContentHash(material)) !== observedHash) {
    throw new TypeError("ACCEPTED_TABLE_INPUT_SEED_HASH_MISMATCH");
  }
  return config;
}

export async function loadAcceptedTableInputSeedConfig(
  environment: NodeJS.ProcessEnv,
): Promise<AcceptedTableInputSeedConfig | null> {
  const raw = environment.DATA_AGENT_ACCEPTED_TABLE_INPUT_SEED;
  if (raw === undefined) return null;
  try {
    return await verifyAcceptedTableInputSeedConfig(JSON.parse(raw));
  } catch {
    throw new TypeError("ACCEPTED_TABLE_INPUT_SEED_CONFIG_INVALID");
  }
}

function deterministicUuid(material: string): string {
  const bytes = createHash("sha256")
    .update(`data-agent/accepted-table-input@1\0${material}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function failed<T>(code: string): PortResult<T> {
  return {
    ok: false,
    error: { code, message: "Accepted table input could not be committed.", retryable: false },
  };
}

function matchesLease(
  config: AcceptedTableInputSeedConfig,
  lease: Parameters<RunWorkflowExecutorPort["execute"]>[0]["lease"],
): boolean {
  return (
    config.run_id === lease.run_id &&
    config.scope.app_id === lease.scope.app_id &&
    config.scope.tenant_id === lease.scope.tenant_id &&
    config.scope.environment === lease.scope.environment &&
    config.scope.principal_id === lease.principal_id
  );
}

export function createAcceptedTableInputSeeder(
  dependencies: {
    readonly capability: unknown;
    readonly artifacts: {
      commit(
        capability: unknown,
        lease: Parameters<RunWorkflowExecutorPort["execute"]>[0]["lease"],
        document: ProductTeamArtifactDocument,
      ): Promise<PortResult<ArtifactReference>>;
    };
  },
  config: AcceptedTableInputSeedConfig,
): NonNullable<DataAgentTeamRunnerDependencies["accepted_inputs"]> {
  return Object.freeze({
    async load(
      input: Parameters<RunWorkflowExecutorPort["execute"]>[0],
    ): Promise<PortResult<readonly RootAcceptedInputArtifact[]>> {
      if (!matchesLease(config, input.lease)) return { ok: true as const, value: [] };
      try {
        if (!input.context.emitDisplayEvent) {
          return failed("RUN_DISPLAY_EVENT_REQUIRED");
        }
        const started = await input.context.emitDisplayEvent({
          kind: "tool_started",
          key: `accepted.input.${config.acceptance_id}.started`,
          call_id: config.acceptance_id,
          tool_name: "accepted_input.attach",
          title: "绑定已验收表格输入",
          summary: "正在把冻结的已验收表格绑定到当前 Run",
          input: JSON.stringify({
            acceptance_id: config.acceptance_id,
            config_hash: config.config_hash,
          }),
          profile_id: null,
          task_id: null,
          artifact_refs: [],
        });
        if (!started.ok) return failed(started.error.code);
        const provenance = await buildAcceptedTableInputProvenance({
          acceptance_id: config.acceptance_id,
          accepted_by_principal_id: config.scope.principal_id,
          accepted_at: config.accepted_at,
          projection: config.table,
        });
        const document = await buildProductTeamArtifactDocument({
          schema_version: "product-team-artifact@2.0.0",
          artifact_ref: {
            artifact_id: deterministicUuid(`${config.run_id}:artifact:${config.acceptance_id}`),
            artifact_type: "QueryEvidence",
            ...input.lease.scope,
            run_id: input.lease.run_id,
            revision: 1,
            content_hash: `sha256:${"0".repeat(64)}`,
          },
          profile_id: "data-agent-orchestrator",
          task_id: deterministicUuid(`${config.run_id}:input-task:${config.acceptance_id}`),
          source_refs: [],
          provenance,
          projection: config.table,
          committed_at: config.accepted_at,
        });
        const committed = await dependencies.artifacts.commit(
          dependencies.capability,
          input.lease,
          document,
        );
        if (!committed.ok) return failed(committed.error.code);
        if (
          artifactReferenceIdentity(committed.value) !==
          artifactReferenceIdentity(document.artifact_ref)
        ) {
          return failed("ACCEPTED_TABLE_INPUT_COMMIT_MISMATCH");
        }
        const displayed = await input.context.emitDisplayEvent({
          kind: "tool_completed",
          key: `accepted.input.${config.acceptance_id}.completed`,
          call_id: config.acceptance_id,
          tool_name: "accepted_input.attach",
          summary: `${config.table.total_rows} 行已验收表格输入已绑定到当前 Run`,
          output: JSON.stringify({
            acceptance_id: config.acceptance_id,
            artifact_id: committed.value.artifact_id,
            artifact_type: committed.value.artifact_type,
            revision: committed.value.revision,
            content_hash: committed.value.content_hash,
          }),
          duration_ms: 0,
          profile_id: null,
          task_id: null,
          artifact_refs: [committed.value],
        });
        if (!displayed.ok) return failed(displayed.error.code);
        return {
          ok: true as const,
          value: [
            rootAcceptedInputArtifactSchema.parse({
              schema_version: "root-accepted-input-artifact@1.0.0",
              artifact_ref: committed.value,
              safe_projection: {
                schema_version: "root-tool-safe-projection@1.0.0",
                artifact_ref: committed.value,
                projection_kind: "TABLE",
                title: config.title,
                summary: `${config.table.total_rows} accepted user-confirmed rows are available.`,
                column_keys: config.table.columns.map(({ key }) => key).sort(),
                total_rows: config.table.total_rows,
                source_artifact_refs: [],
                semantic_query_context: null,
              },
            }),
          ],
        };
      } catch (error) {
        return failed(
          error instanceof Error && /^[A-Z][A-Z0-9_]*$/u.test(error.message)
            ? error.message
            : "ACCEPTED_TABLE_INPUT_SEED_FAILED",
        );
      }
    },
  });
}
