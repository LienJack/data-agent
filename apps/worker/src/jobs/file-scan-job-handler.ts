import type {
  JobOutputReference,
  JobWorkLease,
  PortResult,
  WorkspaceFileScanCommit,
  WorkspaceFileScanCommitResult,
  WorkspaceFileScanTarget,
} from "@data-agent/contracts";
import type { FileScanPort } from "@data-agent/platform";
import type { JobHandler } from "./job-worker-runner.js";

type ContentReader = Readonly<{
  get(
    capability: unknown,
    key: string,
    expectedHash: string,
    expectedByteSize: number,
  ): Promise<PortResult<Uint8Array | null>>;
}>;

type WorkspaceFileScanAuthority = Readonly<{
  loadForScan(
    capability: unknown,
    lease: JobWorkLease,
  ): Promise<PortResult<WorkspaceFileScanTarget>>;
  commitScan(
    capability: unknown,
    lease: JobWorkLease,
    commit: WorkspaceFileScanCommit,
  ): Promise<PortResult<WorkspaceFileScanCommitResult>>;
}>;

function failure(code: string, message: string, retryable: boolean): PortResult<never> {
  return { ok: false, error: { code, message, retryable } };
}

export function createFileScanJobHandler(
  options: Readonly<{
    capability: unknown;
    files: WorkspaceFileScanAuthority;
    content: ContentReader;
    scanner: FileScanPort;
    policy_version: string;
  }>,
): JobHandler {
  return Object.freeze({
    binding: { kind: "FILE_SCAN", handler_revision: "file-scan-handler@1.0.0" } as const,
    async execute(
      lease: JobWorkLease,
      signal: AbortSignal,
    ): Promise<PortResult<readonly JobOutputReference[]>> {
      if (signal.aborted) return failure("FILE_SCAN_CANCELLED", "FILE_SCAN 已取消。", false);
      const loaded = await options.files.loadForScan(options.capability, lease);
      if (!loaded.ok) return loaded;
      const target = loaded.value as WorkspaceFileScanTarget;
      const bytes = await options.content.get(
        options.capability,
        target.storage_key,
        target.blob_hash,
        target.byte_size,
      );
      if (!bytes.ok) return bytes;
      if (bytes.value === null) {
        return failure("WORKSPACE_FILE_BLOB_NOT_FOUND", "Workspace 文件内容不存在。", false);
      }
      if (signal.aborted) return failure("FILE_SCAN_CANCELLED", "FILE_SCAN 已取消。", false);
      const scanned = await options.scanner.scan({
        bytes: bytes.value,
        detected_mime: target.detected_mime,
      });
      if (scanned.verdict === "UNKNOWN" || scanned.scanner === null) {
        return failure(
          scanned.stable_error_code ?? "FILE_SCANNER_UNAVAILABLE",
          "文件扫描器暂时不能签发确定性结果。",
          true,
        );
      }
      if (signal.aborted) return failure("FILE_SCAN_CANCELLED", "FILE_SCAN 已取消。", false);
      const commit: WorkspaceFileScanCommit = {
        schema_version: "workspace-file-scan-commit@1.0.0",
        file_ref: {
          file_id: target.file.file_id,
          revision: target.file.revision,
          revision_hash: target.file.revision_hash,
        },
        blob_hash: target.blob_hash,
        byte_size: target.byte_size,
        scanner: {
          engine: "CLAMAV",
          engine_version: scanned.scanner.engine_version,
          signature_version: scanned.scanner.signature_version,
          signature_observed_at: scanned.scanner.signature_observed_at,
          policy_version: options.policy_version,
        },
        verdict: scanned.verdict,
        malware_name: scanned.malware_name,
        credential_match_count: scanned.credential_match_count,
        content_policy_findings: [...scanned.content_policy_findings],
      };
      const committed = await options.files.commitScan(options.capability, lease, commit);
      if (!committed.ok) return committed;
      const receipt = committed.value.scan_receipt;
      return {
        ok: true,
        value: [
          {
            schema_version: "job-domain-output-reference@1.0.0",
            resource_kind: "WORKSPACE_FILE_SCAN_RECEIPT",
            app_id: receipt.scope.app_id,
            tenant_id: receipt.scope.tenant_id,
            environment: receipt.scope.environment,
            resource_id: receipt.receipt_id,
            resource_revision: 1,
            resource_hash: receipt.receipt_hash,
          },
        ],
      };
    },
  });
}
