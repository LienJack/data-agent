import {
  buildResolvedContextReceipt,
  type PortResult,
  type ResolvedContextAuthoritySnapshot,
  type ResolvedContextCommitCommand,
  type ResolvedContextCommitResult,
  type ResolvedContextPackage,
  type ResolvedContextPreviewResult,
  type ResolvedContextRequest,
  verifyResolvedContextAuthoritySnapshot,
  verifyResolvedContextRequest,
} from "@data-agent/contracts";
import { resolveContextPackage } from "./resolver.js";

export interface ResolvedContextAuthorityPort {
  loadAuthoritySnapshot(
    capability: unknown,
    request: ResolvedContextRequest,
  ): Promise<PortResult<ResolvedContextAuthoritySnapshot>>;
  commit(
    capability: unknown,
    command: ResolvedContextCommitCommand,
  ): Promise<PortResult<ResolvedContextCommitResult>>;
}

export function createResolvedContextService(
  options: Readonly<{
    authority: ResolvedContextAuthorityPort;
    now?: () => Date;
  }>,
) {
  async function prepare(
    capability: unknown,
    request: ResolvedContextRequest,
    expectedConsumer: "PREVIEW" | "RUN",
    consumerError: Readonly<{ code: string; message: string }>,
  ): Promise<
    PortResult<{
      readonly request: ResolvedContextRequest;
      readonly snapshot: ResolvedContextAuthoritySnapshot;
      readonly packageDocument: ResolvedContextPackage;
    }>
  > {
    let verifiedRequest: ResolvedContextRequest;
    try {
      verifiedRequest = await verifyResolvedContextRequest(request);
    } catch {
      return {
        ok: false,
        error: {
          code: "RESOLVED_CONTEXT_REQUEST_INVALID",
          message: "Resolved Context request identity is invalid.",
          retryable: false,
        },
      };
    }
    if (verifiedRequest.basis.consumer !== expectedConsumer) {
      return {
        ok: false,
        error: {
          ...consumerError,
          retryable: false,
        },
      };
    }
    const loaded = await options.authority.loadAuthoritySnapshot(capability, verifiedRequest);
    if (!loaded.ok) return loaded;
    const snapshot = await verifyResolvedContextAuthoritySnapshot(loaded.value);
    return {
      ok: true,
      value: {
        request: verifiedRequest,
        snapshot,
        packageDocument: await resolveContextPackage(snapshot),
      },
    };
  }

  return Object.freeze({
    async preview(
      capability: unknown,
      request: ResolvedContextRequest,
    ): Promise<PortResult<ResolvedContextPreviewResult>> {
      const prepared = await prepare(capability, request, "PREVIEW", {
        code: "RESOLVED_CONTEXT_PREVIEW_CONSUMER_INVALID",
        message: "Read-only preview only accepts PREVIEW context requests.",
      });
      return prepared.ok
        ? {
            ok: true,
            value: {
              schema_version: "resolved-context-preview-result@1.0.0",
              package: prepared.value.packageDocument,
            },
          }
        : prepared;
    },

    async resolve(capability: unknown, request: ResolvedContextRequest) {
      const prepared = await prepare(capability, request, "RUN", {
        code: "RESOLVED_CONTEXT_COMMIT_CONSUMER_INVALID",
        message: "Durable context resolution only accepts RUN context requests.",
      });
      if (!prepared.ok) return prepared;
      const { request: verifiedRequest, snapshot, packageDocument } = prepared.value;
      const receipt = await buildResolvedContextReceipt({
        schema_version: "resolved-context-receipt@1.0.0",
        receipt_id: verifiedRequest.request_id,
        scope: verifiedRequest.scope,
        consumer: verifiedRequest.basis.consumer,
        request_id: verifiedRequest.request_id,
        request_hash: verifiedRequest.request_hash,
        run_id: verifiedRequest.basis.consumer === "RUN" ? verifiedRequest.basis.run_id : null,
        package_ref: {
          package_id: packageDocument.package_id,
          package_revision: 1,
          package_hash: packageDocument.package_hash,
        },
        state: packageDocument.route_decision.state,
        route: packageDocument.route_decision.route,
        authority_snapshot_hash: snapshot.snapshot_hash,
        resolved_at: (options.now?.() ?? new Date()).toISOString(),
      });
      return options.authority.commit(capability, {
        schema_version: "resolved-context-commit@1.0.0",
        request: verifiedRequest,
        authority_snapshot_hash: snapshot.snapshot_hash,
        package: packageDocument,
        receipt,
      });
    },
  });
}
