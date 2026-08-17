import type { WorkspaceContentGcReceipt } from "@data-agent/contracts";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceContentGcService } from "../../src/storage/workspace-content-gc.js";

const hash = (value: string) => `sha256:${value.repeat(64)}` as const;
const receipt = {
  schema_version: "workspace-content-gc-receipt@1.0.0",
  receipt_id: "10000000-0000-4000-8000-000000000001",
  operation_id: "20000000-0000-4000-8000-000000000001",
  scope: {
    app_id: "00000000-0000-4000-8000-00000000da01",
    tenant_id: "30000000-0000-4000-8000-000000000001",
    environment: "test",
    workspace_id: "30000000-0000-4000-8000-000000000001",
  },
  blob_hash: hash("a"),
  status: "ELIGIBLE",
  parent_receipt_ref: null,
  active_reference_count: 0,
  legal_hold_active: false,
  retention_expires_at: "2026-08-17T00:00:00.000Z",
  backup_expires_at: "2026-08-17T00:00:00.000Z",
  evaluated_at: "2026-08-17T01:00:00.000Z",
  receipt_hash: hash("b"),
} as const satisfies WorkspaceContentGcReceipt;

describe("Workspace Content GC service", () => {
  it("removes bytes only after eligible authority and commits the exact receipt", async () => {
    const remove = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const commitGc = vi.fn(async () => ({
      ok: true as const,
      value: {
        ...receipt,
        status: "DELETED" as const,
        parent_receipt_ref: {
          receipt_id: receipt.receipt_id,
          receipt_hash: receipt.receipt_hash,
        },
      },
    }));
    const service = createWorkspaceContentGcService({
      authority: {
        evaluateGc: async () => ({
          ok: true,
          value: {
            receipt,
            deletion_authority: {
              storage_key: "workspace-content/v1/key",
              blob_hash: receipt.blob_hash,
            },
          },
        }),
        commitGc,
      },
      content: { remove },
    });
    const command = {
      schema_version: "workspace-content-gc-evaluate@1.0.0" as const,
      operation_id: receipt.operation_id,
      workspace_id: receipt.scope.workspace_id,
      blob_hash: receipt.blob_hash,
      idempotency_key: "blob-gc-0001",
      request_hash: hash("c"),
    };
    const result = await service.collect({}, command);
    expect(result).toMatchObject({ ok: true, value: { status: "DELETED" } });
    expect(remove).toHaveBeenCalledWith({}, "workspace-content/v1/key", receipt.blob_hash);
    expect(commitGc).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        receipt_id: receipt.receipt_id,
        receipt_hash: receipt.receipt_hash,
      }),
    );
  });

  it("does not touch storage while policy or legal hold retains the blob", async () => {
    const remove = vi.fn();
    const commitGc = vi.fn();
    const held = { ...receipt, status: "HELD" as const, legal_hold_active: true };
    const service = createWorkspaceContentGcService({
      authority: {
        evaluateGc: async () => ({ ok: true, value: { receipt: held, deletion_authority: null } }),
        commitGc,
      },
      content: { remove },
    });
    const result = await service.collect(
      {},
      {
        schema_version: "workspace-content-gc-evaluate@1.0.0",
        operation_id: receipt.operation_id,
        workspace_id: receipt.scope.workspace_id,
        blob_hash: receipt.blob_hash,
        idempotency_key: "blob-gc-0001",
        request_hash: hash("c"),
      },
    );
    expect(result).toMatchObject({ ok: true, value: { status: "HELD" } });
    expect(remove).not.toHaveBeenCalled();
    expect(commitGc).not.toHaveBeenCalled();
  });
});
