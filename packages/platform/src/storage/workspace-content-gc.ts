import type {
  PortResult,
  WorkspaceContentGcEvaluationCommand,
  WorkspaceContentGcEvaluationResult,
  WorkspaceContentGcReceipt,
} from "@data-agent/contracts";

type WorkspaceContentGcAuthority = Readonly<{
  evaluateGc(
    capability: unknown,
    command: WorkspaceContentGcEvaluationCommand,
  ): Promise<PortResult<WorkspaceContentGcEvaluationResult>>;
  commitGc(
    capability: unknown,
    command: Readonly<{
      schema_version: "workspace-content-gc-commit@1.0.0";
      workspace_id: string;
      receipt_id: string;
      receipt_hash: string;
      blob_hash: string;
    }>,
  ): Promise<PortResult<WorkspaceContentGcReceipt>>;
}>;

type WorkspaceContentRemover = Readonly<{
  remove(capability: unknown, key: string, expectedHash: string): Promise<PortResult<void>>;
}>;

export function createWorkspaceContentGcService(
  options: Readonly<{
    authority: WorkspaceContentGcAuthority;
    content: WorkspaceContentRemover;
  }>,
) {
  return Object.freeze({
    async collect(
      capability: unknown,
      command: WorkspaceContentGcEvaluationCommand,
    ): Promise<PortResult<WorkspaceContentGcReceipt>> {
      const evaluated = await options.authority.evaluateGc(capability, command);
      if (!evaluated.ok) return evaluated;
      const target = evaluated.value.deletion_authority;
      if (target === null) return { ok: true, value: evaluated.value.receipt };
      const removed = await options.content.remove(
        capability,
        target.storage_key,
        target.blob_hash,
      );
      if (!removed.ok) return removed;
      return options.authority.commitGc(capability, {
        schema_version: "workspace-content-gc-commit@1.0.0",
        workspace_id: command.workspace_id,
        receipt_id: evaluated.value.receipt.receipt_id,
        receipt_hash: evaluated.value.receipt.receipt_hash,
        blob_hash: evaluated.value.receipt.blob_hash,
      });
    },
  });
}

export type WorkspaceContentGcService = ReturnType<typeof createWorkspaceContentGcService>;
