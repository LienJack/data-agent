import {
  type AuthoritativeCommittedProviderDispatchPermit,
  type CommittedAgentDataProjectionReceiptResolver,
  isAuthoritativeCommittedProviderDispatchPermit,
  type PortResult,
  type ProviderDispatchEnvelope,
  type ProviderInvocationPublicProjection,
  type RunWorkLease,
  runWorkLeaseSchema,
  verifyProviderDispatchEnvelopeCandidate,
} from "@data-agent/contracts";

type ProtectedResponseReference = Readonly<{
  artifact_id: string;
  artifact_type: "ProviderResponseArtifact";
  app_id: string;
  tenant_id: string;
  environment: string;
  run_id: string;
  revision: number;
  content_hash: string;
}>;

export type AuditedProviderTransportResult =
  | Readonly<{
      kind: "COMPLETED";
      output_text: string;
      response_hash: string;
      tool_calls: readonly unknown[];
      usage:
        | Readonly<{
            source: "PROVIDER_REPORTED" | "ESTIMATED";
            input_tokens: number;
            output_tokens: number;
            tool_calls: number;
          }>
        | Readonly<{ source: "UNAVAILABLE" }>;
    }>
  | Readonly<{
      kind: "FAILED" | "THROTTLED";
      reason_code: string;
      retryable: boolean;
      delivery_certainty:
        | "NOT_DISPATCHED"
        | "DISPATCHED_OUTCOME_KNOWN"
        | "DISPATCHED_OUTCOME_UNKNOWN";
      retry_after_ms?: number;
      usage?: Readonly<{
        source: "PROVIDER_REPORTED" | "ESTIMATED";
        input_tokens: number;
        output_tokens: number;
        tool_calls: number;
      }>;
    }>;

type CompletedTransportUsage = Extract<
  AuditedProviderTransportResult,
  { kind: "COMPLETED" }
>["usage"];

export interface PrivateAuditedProviderTransport {
  prepare(input: {
    readonly envelope: ProviderDispatchEnvelope;
    readonly payload: unknown;
    readonly signal: AbortSignal;
  }): Promise<PortResult<{ readonly prepared: unknown }>>;
  dispatch(input: {
    readonly permit: AuthoritativeCommittedProviderDispatchPermit;
    readonly envelope: ProviderDispatchEnvelope;
    readonly prepared: unknown;
    readonly projection_resolver: CommittedAgentDataProjectionReceiptResolver;
    readonly mark_dispatched: () => Promise<PortResult<unknown>>;
    readonly signal: AbortSignal;
  }): Promise<AuditedProviderTransportResult>;
}

type TerminalReplay = Readonly<{
  status: "COMPLETED" | "FAILED" | "THROTTLED" | "OUTCOME_UNKNOWN";
  reason_code?: string | null;
  delivery_certainty?: "NOT_DISPATCHED" | "DISPATCHED_OUTCOME_KNOWN" | "DISPATCHED_OUTCOME_UNKNOWN";
  response_artifact_ref: ProtectedResponseReference | null;
  response_hash: string | null;
  projection: ProviderInvocationPublicProjection;
}>;

type LoadedInvocationState =
  | TerminalReplay
  | Readonly<{ status: "DISPATCH_MARKED" | "RESPONSE_OBSERVED" }>;

export interface AuditedProviderInvocationStore {
  begin(input: {
    readonly worker_lease: RunWorkLease;
    readonly envelope: ProviderDispatchEnvelope;
  }): Promise<
    PortResult<
      | {
          readonly admission: "READY";
          readonly replayed: boolean;
          readonly permit: AuthoritativeCommittedProviderDispatchPermit;
        }
      | {
          readonly admission: "REJECTED";
          readonly reason_code:
            | "PROVIDER_PROFILE_NOT_AVAILABLE"
            | "PROVIDER_CERTIFICATION_REQUIRED"
            | "PROVIDER_CONTEXT_WINDOW_UNVERIFIED"
            | "PROVIDER_CONTEXT_LIMIT_EXCEEDED"
            | "PROVIDER_OUTPUT_LIMIT_EXCEEDED"
            | "PROVIDER_CALL_LIMIT_EXCEEDED"
            | "PROVIDER_EGRESS_DENIED"
            | "PROVIDER_DISPATCH_ENVELOPE_INVALID"
            | "PROVIDER_CONTEXT_RECEIPT_MISMATCH"
            | "PROVIDER_WORKER_LEASE_STALE";
          readonly projection: ProviderInvocationPublicProjection;
        }
      | {
          readonly admission: "TERMINAL_REPLAY";
          readonly replay_action:
            | "RETURN_RECORDED"
            | "NEW_LOGICAL_INVOCATION_REQUIRED"
            | "NEW_LOGICAL_INVOCATION_AFTER_RETRY_DELAY"
            | "RECONCILIATION_REQUIRED";
          readonly original_permit: AuthoritativeCommittedProviderDispatchPermit;
          readonly status: "COMPLETED" | "FAILED" | "THROTTLED" | "OUTCOME_UNKNOWN";
          readonly reason_code?: string | null;
          readonly delivery_certainty?: NonNullable<TerminalReplay["delivery_certainty"]>;
          readonly response_artifact_ref: ProtectedResponseReference | null;
          readonly response_hash: string | null;
          readonly projection: ProviderInvocationPublicProjection;
        }
    >
  >;
  load(input: {
    readonly permit: AuthoritativeCommittedProviderDispatchPermit;
  }): Promise<PortResult<LoadedInvocationState | null>>;
  markDispatched(input: {
    readonly worker_lease: RunWorkLease;
    readonly permit: AuthoritativeCommittedProviderDispatchPermit;
  }): Promise<PortResult<unknown>>;
  markResponseObserved(input: {
    readonly worker_lease: RunWorkLease;
    readonly permit: AuthoritativeCommittedProviderDispatchPermit;
    readonly observation_kind: "COMPLETED" | "FAILED" | "THROTTLED" | "OUTCOME_UNKNOWN";
    readonly response_hash: string | null;
    readonly delivery_certainty: "DISPATCHED_OUTCOME_KNOWN" | "DISPATCHED_OUTCOME_UNKNOWN";
  }): Promise<PortResult<unknown>>;
  commitTerminal(input: {
    readonly worker_lease: RunWorkLease;
    readonly permit: AuthoritativeCommittedProviderDispatchPermit;
    readonly terminal: Exclude<AuditedProviderTransportResult, { kind: "COMPLETED" }>;
  }): Promise<
    PortResult<{
      readonly projection: ProviderInvocationPublicProjection;
    }>
  >;
  commitPreflightFailure(input: {
    readonly worker_lease: RunWorkLease;
    readonly permit: AuthoritativeCommittedProviderDispatchPermit;
    readonly reason_code: "PROVIDER_CREDENTIAL_UNAVAILABLE" | "PROVIDER_LOCAL_PREPARATION_FAILED";
  }): Promise<PortResult<{ readonly projection: ProviderInvocationPublicProjection }>>;
  commitCompleted(input: {
    readonly worker_lease: RunWorkLease;
    readonly permit: AuthoritativeCommittedProviderDispatchPermit;
    readonly response: Readonly<{
      invocation_id: string;
      output_text: string;
      tool_calls: readonly unknown[];
      response_hash: string;
    }>;
    readonly usage: CompletedTransportUsage;
  }): Promise<PortResult<{ readonly projection: ProviderInvocationPublicProjection }>>;
  markOutcomeUnknown(input: {
    readonly worker_lease: RunWorkLease;
    readonly permit: AuthoritativeCommittedProviderDispatchPermit;
  }): Promise<PortResult<{ readonly projection: ProviderInvocationPublicProjection }>>;
}

export interface ProtectedProviderResponseStore {
  load(input: {
    readonly permit: AuthoritativeCommittedProviderDispatchPermit;
    readonly reference: ProtectedResponseReference;
  }): Promise<
    PortResult<{
      readonly output_text: string;
      readonly tool_calls: readonly unknown[];
      readonly response_hash: string;
    }>
  >;
}

export interface AgentDataProjectionReceiptAuthority {
  commit(input: {
    readonly worker_lease: RunWorkLease;
    readonly envelope: ProviderDispatchEnvelope;
  }): Promise<
    PortResult<
      Readonly<{
        reference: ProviderDispatchEnvelope["projection"]["receipt_ref"];
        resolver: CommittedAgentDataProjectionReceiptResolver;
      }>
    >
  >;
}

export type AuditedModelProviderResult = Readonly<{
  output_text: string;
  tool_calls: readonly unknown[];
  projection: ProviderInvocationPublicProjection;
}>;

export interface AuditedModelProvider {
  invoke(input: {
    readonly worker_lease: RunWorkLease;
    readonly envelope: ProviderDispatchEnvelope;
    readonly payload: unknown;
    readonly signal: AbortSignal;
  }): Promise<PortResult<AuditedModelProviderResult>>;
}

function failure(code: string, message: string, retryable = false): PortResult<never> {
  return { ok: false, error: { code, message, retryable } };
}

function sameLease(lease: RunWorkLease, envelope: ProviderDispatchEnvelope): boolean {
  return (
    lease.run_id === envelope.run_id &&
    lease.outbox_id === envelope.lease.outbox_id &&
    lease.command_id === envelope.lease.command_id &&
    lease.attempt_id === envelope.lease.attempt_id &&
    lease.attempt_no === envelope.lease.attempt_no &&
    lease.worker_id === envelope.lease.worker_id &&
    lease.lease_token === envelope.lease.lease_token &&
    lease.worker_fence === envelope.lease.worker_fence &&
    lease.scope.app_id === envelope.scope.app_id &&
    lease.scope.tenant_id === envelope.scope.tenant_id &&
    lease.scope.environment === envelope.scope.environment &&
    lease.principal_id === envelope.scope.principal_id
  );
}

function sameArtifactReference(
  left: ProviderDispatchEnvelope["projection"]["receipt_ref"],
  right: ProviderDispatchEnvelope["projection"]["receipt_ref"],
): boolean {
  return (
    left.artifact_id === right.artifact_id &&
    left.artifact_type === right.artifact_type &&
    left.app_id === right.app_id &&
    left.tenant_id === right.tenant_id &&
    left.environment === right.environment &&
    left.run_id === right.run_id &&
    left.revision === right.revision &&
    left.content_hash === right.content_hash
  );
}

function terminalFailure(
  status: TerminalReplay["status"],
  recorded?: Pick<TerminalReplay, "reason_code" | "delivery_certainty"> & {
    readonly status?: string;
  },
): PortResult<never> {
  const code =
    status === "OUTCOME_UNKNOWN"
      ? "PROVIDER_INVOCATION_OUTCOME_UNKNOWN"
      : status === "THROTTLED"
        ? "PROVIDER_THROTTLED"
        : status === "FAILED" &&
            recorded?.reason_code === "PROVIDER_PROTOCOL_VIOLATION" &&
            recorded.delivery_certainty === "DISPATCHED_OUTCOME_KNOWN"
          ? "PROVIDER_RESPONSE_REJECTED"
          : "PROVIDER_INVOCATION_FAILED";
  return failure(code, "Provider 调用已进入持久终态。", false);
}

export function createAuditedModelProvider(dependencies: {
  readonly invocation_store: AuditedProviderInvocationStore;
  readonly projection_receipts: AgentDataProjectionReceiptAuthority;
  readonly response_artifacts: ProtectedProviderResponseStore;
  readonly transport: PrivateAuditedProviderTransport;
}): AuditedModelProvider {
  return {
    async invoke(inputValue) {
      if (inputValue.signal.aborted) {
        return failure("RUN_EXECUTION_ABORTED", "Provider Authority 核验前 Run 已中止。");
      }
      let envelope: ProviderDispatchEnvelope;
      const lease = runWorkLeaseSchema.safeParse(inputValue.worker_lease);
      try {
        envelope = await verifyProviderDispatchEnvelopeCandidate(inputValue.envelope);
      } catch {
        return failure(
          "PROVIDER_DISPATCH_ENVELOPE_INVALID",
          "Provider Dispatch Envelope 完整性校验失败。",
        );
      }
      if (!lease.success || !sameLease(lease.data, envelope)) {
        return failure(
          "PROVIDER_WORKER_LEASE_STALE",
          "Provider Dispatch 与 ACTIVE Worker Lease 不一致。",
        );
      }

      const projectionReceipt = await dependencies.projection_receipts.commit({
        worker_lease: lease.data,
        envelope,
      });
      if (!projectionReceipt.ok) return projectionReceipt;
      if (inputValue.signal.aborted) {
        return failure("RUN_EXECUTION_ABORTED", "Provider begin 前 Run 已中止。");
      }
      if (
        !sameArtifactReference(projectionReceipt.value.reference, envelope.projection.receipt_ref)
      ) {
        return failure(
          "PROVIDER_DATA_PROJECTION_RECEIPT_INVALID",
          "Agent Data Projection Receipt 与 Dispatch Envelope 不一致。",
        );
      }

      const begun = await dependencies.invocation_store.begin({
        worker_lease: lease.data,
        envelope,
      });
      if (!begun.ok) return begun;
      if (begun.value.admission === "REJECTED") {
        return failure(begun.value.reason_code, "Provider 调用在网络前被 Authority 拒绝。", false);
      }
      if (begun.value.admission === "TERMINAL_REPLAY") {
        if (
          begun.value.replay_action !== "RETURN_RECORDED" ||
          begun.value.status !== "COMPLETED" ||
          !begun.value.response_artifact_ref ||
          !begun.value.response_hash
        ) {
          return terminalFailure(begun.value.status, begun.value);
        }
        const response = await dependencies.response_artifacts.load({
          permit: begun.value.original_permit,
          reference: begun.value.response_artifact_ref,
        });
        if (!response.ok) return response;
        if (response.value.response_hash !== begun.value.response_hash) {
          return failure(
            "PROVIDER_RESPONSE_ARTIFACT_MISMATCH",
            "Terminal replay response 与 recorded outcome 不一致。",
          );
        }
        return {
          ok: true,
          value: {
            output_text: response.value.output_text,
            tool_calls: response.value.tool_calls,
            projection: begun.value.projection,
          },
        };
      }
      if (!isAuthoritativeCommittedProviderDispatchPermit(begun.value.permit)) {
        return failure(
          "PROVIDER_DISPATCH_PERMIT_NOT_COMMITTED",
          "Provider Dispatch Permit 未由 PostgreSQL Authority 提交。",
        );
      }
      const permit = begun.value.permit;
      const loaded = await dependencies.invocation_store.load({ permit });
      if (!loaded.ok) return loaded;
      if (loaded.value) {
        if (
          loaded.value.status === "DISPATCH_MARKED" ||
          loaded.value.status === "RESPONSE_OBSERVED"
        ) {
          return failure(
            "PROVIDER_RECONCILIATION_REQUIRED",
            "Provider 已记录 dispatch 但没有可信终态，禁止普通重发。",
            false,
          );
        }
        if (
          loaded.value.status !== "COMPLETED" ||
          !loaded.value.response_artifact_ref ||
          !loaded.value.response_hash
        ) {
          return terminalFailure(loaded.value.status, loaded.value);
        }
        const response = await dependencies.response_artifacts.load({
          permit,
          reference: loaded.value.response_artifact_ref,
        });
        if (!response.ok) return response;
        if (response.value.response_hash !== loaded.value.response_hash) {
          return failure(
            "PROVIDER_RESPONSE_ARTIFACT_MISMATCH",
            "持久化 Provider Response 与 terminal receipt 不一致。",
          );
        }
        return {
          ok: true,
          value: {
            output_text: response.value.output_text,
            tool_calls: response.value.tool_calls,
            projection: loaded.value.projection,
          },
        };
      }

      const prepared = await dependencies.transport.prepare({
        envelope,
        payload: inputValue.payload,
        signal: inputValue.signal,
      });
      if (!prepared.ok) {
        const reasonCode =
          prepared.error.code === "PROVIDER_CREDENTIAL_UNAVAILABLE"
            ? "PROVIDER_CREDENTIAL_UNAVAILABLE"
            : "PROVIDER_LOCAL_PREPARATION_FAILED";
        const failed = await dependencies.invocation_store.commitPreflightFailure({
          worker_lease: lease.data,
          permit,
          reason_code: reasonCode,
        });
        return failed.ok ? failure(reasonCode, prepared.error.message, false) : failed;
      }

      if (inputValue.signal.aborted) {
        const failed = await dependencies.invocation_store.commitPreflightFailure({
          worker_lease: lease.data,
          permit,
          reason_code: "PROVIDER_LOCAL_PREPARATION_FAILED",
        });
        return failed.ok
          ? failure("RUN_EXECUTION_ABORTED", "Provider dispatch marker 前 Run 已中止。")
          : failed;
      }

      let dispatchMarked = false;
      let transportResult: AuditedProviderTransportResult;
      try {
        transportResult = await dependencies.transport.dispatch({
          permit,
          envelope,
          prepared: prepared.value.prepared,
          projection_resolver: projectionReceipt.value.resolver,
          mark_dispatched: async () => {
            if (inputValue.signal.aborted) {
              return failure("RUN_EXECUTION_ABORTED", "Provider dispatch marker 前 Run 已中止。");
            }
            if (dispatchMarked) {
              return failure(
                "PROVIDER_DISPATCH_MARKER_DUPLICATE",
                "Provider transport 重复请求 durable dispatch marker。",
              );
            }
            const marked = await dependencies.invocation_store.markDispatched({
              worker_lease: lease.data,
              permit,
            });
            if (marked.ok) dispatchMarked = true;
            return marked;
          },
          signal: inputValue.signal,
        });
      } catch {
        if (!dispatchMarked) {
          const failed = await dependencies.invocation_store.commitPreflightFailure({
            worker_lease: lease.data,
            permit,
            reason_code: "PROVIDER_LOCAL_PREPARATION_FAILED",
          });
          return failed.ok
            ? failure(
                "PROVIDER_LOCAL_PREPARATION_FAILED",
                "Provider 本地准备失败，网络调用未发生。",
              )
            : failed;
        }
        const observed = await dependencies.invocation_store.markResponseObserved({
          worker_lease: lease.data,
          permit,
          observation_kind: "OUTCOME_UNKNOWN",
          response_hash: null,
          delivery_certainty: "DISPATCHED_OUTCOME_UNKNOWN",
        });
        if (!observed.ok) return observed;
        const unknown = await dependencies.invocation_store.markOutcomeUnknown({
          worker_lease: lease.data,
          permit,
        });
        if (!unknown.ok) return unknown;
        return failure(
          "PROVIDER_INVOCATION_OUTCOME_UNKNOWN",
          "Provider 调用可能已送达但当前没有可信终态，只允许后续 reconcile。",
          false,
        );
      }

      if (transportResult.kind !== "COMPLETED") {
        if (transportResult.delivery_certainty === "NOT_DISPATCHED") {
          const reasonCode =
            transportResult.reason_code === "PROVIDER_CREDENTIAL_UNAVAILABLE"
              ? "PROVIDER_CREDENTIAL_UNAVAILABLE"
              : "PROVIDER_LOCAL_PREPARATION_FAILED";
          const failed = await dependencies.invocation_store.commitPreflightFailure({
            worker_lease: lease.data,
            permit,
            reason_code: reasonCode,
          });
          return failed.ok ? failure(reasonCode, "Provider 网络前执行失败。", false) : failed;
        }
        if (!dispatchMarked) {
          return failure(
            "PROVIDER_STREAM_PROTOCOL_VIOLATION",
            "Provider response 不能出现在 durable dispatch marker 之前。",
          );
        }
        const observed = await dependencies.invocation_store.markResponseObserved({
          worker_lease: lease.data,
          permit,
          observation_kind:
            transportResult.delivery_certainty === "DISPATCHED_OUTCOME_UNKNOWN"
              ? "OUTCOME_UNKNOWN"
              : transportResult.kind,
          response_hash: null,
          delivery_certainty: transportResult.delivery_certainty,
        });
        if (!observed.ok) return observed;
        if (transportResult.delivery_certainty === "DISPATCHED_OUTCOME_UNKNOWN") {
          const unknown = await dependencies.invocation_store.markOutcomeUnknown({
            worker_lease: lease.data,
            permit,
          });
          return unknown.ok
            ? failure(
                "PROVIDER_INVOCATION_OUTCOME_UNKNOWN",
                "Provider 调用可能已送达但当前没有可信终态，只允许后续 reconcile。",
                false,
              )
            : unknown;
        }
        const terminal = await dependencies.invocation_store.commitTerminal({
          worker_lease: lease.data,
          permit,
          terminal: transportResult,
        });
        if (!terminal.ok) return terminal;
        return terminalFailure(transportResult.kind, transportResult);
      }

      if (!dispatchMarked) {
        return failure(
          "PROVIDER_STREAM_PROTOCOL_VIOLATION",
          "Provider completion 不能出现在 durable dispatch marker 之前。",
        );
      }

      const observed = await dependencies.invocation_store.markResponseObserved({
        worker_lease: lease.data,
        permit,
        observation_kind: "COMPLETED",
        response_hash: transportResult.response_hash,
        delivery_certainty: "DISPATCHED_OUTCOME_KNOWN",
      });
      if (!observed.ok) return observed;

      const terminal = await dependencies.invocation_store.commitCompleted({
        worker_lease: lease.data,
        permit,
        response: {
          invocation_id: envelope.invocation_id,
          output_text: transportResult.output_text,
          tool_calls: transportResult.tool_calls,
          response_hash: transportResult.response_hash,
        },
        usage: transportResult.usage,
      });
      if (!terminal.ok) return terminal;
      return {
        ok: true,
        value: {
          output_text: transportResult.output_text,
          tool_calls: transportResult.tool_calls,
          projection: terminal.value.projection,
        },
      };
    },
  };
}
