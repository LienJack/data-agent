import {
  buildSemanticContextReceipt,
  type SemanticContextAuthoritySnapshot,
  type SemanticContextCommitCommand,
  type SemanticContextCommitResult,
  type SemanticContextPackage,
  type SemanticContextPreviewResult,
  type SemanticContextRequest,
  verifySemanticContextAuthoritySnapshot,
  verifySemanticContextRequest,
} from "@data-agent/contracts/context";
import type { PortResult } from "@data-agent/contracts/ports";
import { compileSemanticContextPackage } from "./semantic-context-compiler.js";

export interface SemanticContextAuthorityPort {
  loadAuthoritySnapshot(
    capability: unknown,
    request: SemanticContextRequest,
  ): Promise<PortResult<SemanticContextAuthoritySnapshot>>;
  commit(
    capability: unknown,
    command: SemanticContextCommitCommand,
  ): Promise<PortResult<SemanticContextCommitResult>>;
}

export function createSemanticContextService(
  options: Readonly<{
    authority: SemanticContextAuthorityPort;
    now?: () => Date;
  }>,
) {
  async function prepare(
    capability: unknown,
    request: SemanticContextRequest,
    expectedConsumer: "PREVIEW" | "RUN",
    consumerError: Readonly<{ code: string; message: string }>,
  ): Promise<
    PortResult<{
      readonly request: SemanticContextRequest;
      readonly snapshot: SemanticContextAuthoritySnapshot;
      readonly packageDocument: SemanticContextPackage;
    }>
  > {
    let verifiedRequest: SemanticContextRequest;
    try {
      verifiedRequest = await verifySemanticContextRequest(request);
    } catch {
      return {
        ok: false,
        error: {
          code: "SEMANTIC_CONTEXT_REQUEST_INVALID",
          message: "Semantic Context request identity is invalid.",
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
    const snapshot = await verifySemanticContextAuthoritySnapshot(loaded.value);
    return {
      ok: true,
      value: {
        request: verifiedRequest,
        snapshot,
        packageDocument: await compileSemanticContextPackage(snapshot),
      },
    };
  }

  return Object.freeze({
    async preview(
      capability: unknown,
      request: SemanticContextRequest,
    ): Promise<PortResult<SemanticContextPreviewResult>> {
      const prepared = await prepare(capability, request, "PREVIEW", {
        code: "SEMANTIC_CONTEXT_PREVIEW_CONSUMER_INVALID",
        message: "Read-only preview only accepts PREVIEW context requests.",
      });
      return prepared.ok
        ? {
            ok: true,
            value: {
              schema_version: "semantic-context-preview-result@1.0.0",
              package: prepared.value.packageDocument,
            },
          }
        : prepared;
    },

    async resolve(capability: unknown, request: SemanticContextRequest) {
      const prepared = await prepare(capability, request, "RUN", {
        code: "SEMANTIC_CONTEXT_COMMIT_CONSUMER_INVALID",
        message: "Durable context resolution only accepts RUN context requests.",
      });
      if (!prepared.ok) return prepared;
      const { request: verifiedRequest, snapshot, packageDocument } = prepared.value;
      const receipt = await buildSemanticContextReceipt({
        schema_version: "semantic-context-receipt@1.0.0",
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
        schema_version: "semantic-context-commit@1.0.0",
        request: verifiedRequest,
        authority_snapshot_hash: snapshot.snapshot_hash,
        package: packageDocument,
        receipt,
      });
    },
  });
}
