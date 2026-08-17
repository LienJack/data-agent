import {
  buildResolvedContextReceipt,
  type PortResult,
  type ResolvedContextAuthoritySnapshot,
  type ResolvedContextCommitCommand,
  type ResolvedContextCommitResult,
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
  return Object.freeze({
    async resolve(capability: unknown, request: ResolvedContextRequest) {
      let verifiedRequest: ResolvedContextRequest;
      try {
        verifiedRequest = await verifyResolvedContextRequest(request);
      } catch {
        return {
          ok: false as const,
          error: {
            code: "RESOLVED_CONTEXT_REQUEST_INVALID",
            message: "Resolved Context request identity is invalid.",
            retryable: false,
          },
        };
      }
      const loaded = await options.authority.loadAuthoritySnapshot(capability, verifiedRequest);
      if (!loaded.ok) return loaded;
      const snapshot = await verifyResolvedContextAuthoritySnapshot(loaded.value);
      const packageDocument = await resolveContextPackage(snapshot);
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
