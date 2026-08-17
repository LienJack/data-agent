import {
  type ArtifactReference,
  artifactExportCommandSchema,
  type PortResult,
} from "@data-agent/contracts";
import {
  ArtifactWorkspaceError,
  type ArtifactWorkspaceServiceOptions,
  createArtifactWorkspaceService,
} from "@data-agent/platform/artifact-workspace-service";
import { z } from "zod";
import type { JobHandler } from "./job-worker-runner.js";

const parametersSchema = z.strictObject({
  format: z.enum(["CSV", "XLSX"]),
  filename_stem: z.string().min(1).max(120),
  export_idempotency_key: z.string().min(8).max(128),
});

export function createArtifactExportJobHandler(
  options: Readonly<{
    capability: unknown;
    workspace: ArtifactWorkspaceServiceOptions;
  }>,
): JobHandler {
  const service = createArtifactWorkspaceService(options.workspace);
  return {
    binding: {
      kind: "ARTIFACT_EXPORT",
      handler_revision: "artifact-export-handler@1.0.0",
    },
    async execute(lease): Promise<PortResult<readonly ArtifactReference[]>> {
      const parameters = parametersSchema.safeParse(lease.input.parameters);
      const source = lease.input.resource_refs[0];
      if (!parameters.success || lease.input.resource_refs.length !== 1 || !source) {
        return {
          ok: false,
          error: {
            code: "ARTIFACT_EXPORT_JOB_INPUT_INVALID",
            message: "Artifact Export Job 必须冻结一个 Source Reference 与导出参数。",
            retryable: false,
          },
        };
      }
      const command = artifactExportCommandSchema.parse({
        schema_version: "artifact-export-command@1.0.0",
        source_ref: source,
        format: parameters.data.format,
        filename_stem: parameters.data.filename_stem,
        idempotency_key: parameters.data.export_idempotency_key,
      });
      try {
        const result = await service.createExport(options.capability, command);
        return { ok: true, value: [result.receipt.receipt_ref] };
      } catch (error) {
        return {
          ok: false,
          error: {
            code:
              error instanceof ArtifactWorkspaceError ? error.code : "ARTIFACT_EXPORT_JOB_FAILED",
            message: "Artifact Export Job 执行失败。",
            retryable: false,
          },
        };
      }
    },
  };
}
