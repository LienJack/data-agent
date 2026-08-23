import { randomUUID } from "node:crypto";
import {
  buildToolEffectTransition,
  canonicalizeJson,
  type McpServerRevision,
  type PortResult,
  sha256ContentHash,
  type ToolEffectIntent,
  verifyMcpServerRevision,
  verifyToolEffectIntent,
} from "@data-agent/contracts";
import { normalizePublicEgressAddresses } from "../datasources/egress.js";
import { containsPotentialPlaintextSecret } from "../secrets/secret-ref.js";

export interface McpDnsResolver {
  resolve(host: string): Promise<readonly string[]>;
}

export interface FixedTargetMcpHttpPort {
  send(input: {
    readonly url: string;
    readonly address: string;
    readonly server_name: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Uint8Array;
    readonly timeout_ms: number;
    readonly max_response_bytes: number;
  }): Promise<{
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: Uint8Array;
  }>;
}

export interface McpEffectAuthority {
  begin(capability: unknown, intent: ToolEffectIntent): Promise<PortResult<unknown>>;
  transition(
    capability: unknown,
    transition: Awaited<ReturnType<typeof buildToolEffectTransition>>,
  ): Promise<PortResult<unknown>>;
}

function failure<T>(code: string, message: string, retryable = false): PortResult<T> {
  return { ok: false, error: { code, message, retryable } };
}

function sameAddresses(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function safeEndpoint(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      (url.port !== "" && url.port !== "443")
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function findHeader(headers: Readonly<Record<string, string>>, name: string): string | null {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  return entry?.[1] ?? null;
}

export function createGovernedMcpTransport(options: {
  readonly dns: McpDnsResolver;
  readonly http: FixedTargetMcpHttpPort;
  readonly effects: McpEffectAuthority;
  readonly verify_task_capability: (input: ToolEffectIntent) => Promise<boolean>;
  readonly verify_projection_receipt: (input: ToolEffectIntent) => Promise<boolean>;
  readonly resolve_secret_headers?: (
    secretRefId: string,
  ) => Promise<Readonly<Record<string, string>>>;
  readonly max_redirects?: number;
}) {
  const maxRedirects = options.max_redirects ?? 3;
  return Object.freeze({
    async invoke(input: {
      readonly capability: unknown;
      readonly revision: McpServerRevision;
      readonly tool_id: string;
      readonly intent: ToolEffectIntent;
      readonly payload: unknown;
    }): Promise<PortResult<Readonly<{ status: number; body: Uint8Array; response_hash: string }>>> {
      let revision: McpServerRevision;
      let intent: ToolEffectIntent;
      try {
        [revision, intent] = await Promise.all([
          verifyMcpServerRevision(input.revision),
          verifyToolEffectIntent(input.intent),
        ]);
      } catch {
        return failure("MCP_INVOCATION_CONTRACT_INVALID", "MCP invocation contract is invalid.");
      }
      const tool = revision.tools.find(({ tool_id }) => tool_id === input.tool_id);
      const endpoint = safeEndpoint(revision.endpoint);
      const payloadBytes = new TextEncoder().encode(canonicalizeJson(input.payload));
      const payloadHash = await sha256ContentHash(input.payload);
      if (
        !tool ||
        !endpoint ||
        intent.server_id !== revision.server_id ||
        intent.server_revision !== revision.revision ||
        intent.server_revision_hash !== revision.revision_hash ||
        intent.tool_id !== tool.tool_id ||
        intent.effect_semantics !== tool.effect_semantics ||
        intent.request_payload_hash !== payloadHash ||
        intent.policy_revision !== revision.policy_revision ||
        payloadBytes.byteLength > tool.max_response_bytes ||
        containsPotentialPlaintextSecret(input.payload)
      ) {
        return failure("MCP_INVOCATION_NOT_AUTHORIZED", "MCP invocation binding was rejected.");
      }
      if (
        !(await options.verify_task_capability(intent)) ||
        !(await options.verify_projection_receipt(intent))
      ) {
        return failure(
          "MCP_EGRESS_PROJECTION_REQUIRED",
          "MCP invocation requires exact capability and projection authority.",
        );
      }
      const begun = await options.effects.begin(input.capability, intent);
      if (!begun.ok) return begun as PortResult<never>;

      const secretHeaders = revision.secret_ref_id
        ? await options.resolve_secret_headers?.(revision.secret_ref_id)
        : undefined;
      if (revision.secret_ref_id && !secretHeaders) {
        return failure("MCP_SECRET_REF_UNAVAILABLE", "MCP SecretRef could not be resolved.");
      }
      const headers = Object.freeze({
        "content-type": "application/json",
        ...(secretHeaders ?? {}),
      });
      if (
        Object.keys(headers).some((name) =>
          ["host", "content-length", "cookie"].includes(name.toLowerCase()),
        )
      ) {
        return failure(
          "MCP_SECRET_HEADERS_INVALID",
          "MCP secret headers contain forbidden transport fields.",
        );
      }
      let pinned: readonly string[] | null = null;
      try {
        pinned = normalizePublicEgressAddresses(await options.dns.resolve(endpoint.hostname));
      } catch {
        pinned = null;
      }
      if (!pinned) {
        const rejected = await options.effects.transition(
          input.capability,
          await buildToolEffectTransition({
            schema_version: "tool-effect-transition@1.0.0",
            transition_id: randomUUID(),
            effect_id: intent.effect_id,
            expected_state: "INTENT_COMMITTED",
            target_state: "FAILED",
            dispatch_hash: null,
            response_hash: null,
            delivery_certainty: "NOT_DISPATCHED",
            reason_code: "MCP_ADDRESS_DENIED",
            reconciliation_of: null,
          }),
        );
        if (!rejected.ok) return rejected as PortResult<never>;
        return failure("MCP_ADDRESS_DENIED", "MCP DNS resolved to a denied address.");
      }
      const dispatchHash = await sha256ContentHash({
        effect_id: intent.effect_id,
        endpoint: endpoint.toString(),
        request_payload_hash: payloadHash,
        server_revision_hash: revision.revision_hash,
        tool_id: tool.tool_id,
      });
      const dispatched = await options.effects.transition(
        input.capability,
        await buildToolEffectTransition({
          schema_version: "tool-effect-transition@1.0.0",
          transition_id: randomUUID(),
          effect_id: intent.effect_id,
          expected_state: "INTENT_COMMITTED",
          target_state: "DISPATCH_MARKED",
          dispatch_hash: dispatchHash,
          response_hash: null,
          delivery_certainty: "DISPATCHED_KNOWN",
          reason_code: "TOOL_DISPATCHED",
          reconciliation_of: null,
        }),
      );
      if (!dispatched.ok) return dispatched as PortResult<never>;

      let current = endpoint;
      try {
        for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
          const addresses = normalizePublicEgressAddresses(
            await options.dns.resolve(current.hostname),
          );
          if (!addresses || !sameAddresses(pinned, addresses)) {
            throw new Error("MCP_DNS_REBIND");
          }
          const response = await options.http.send({
            url: current.toString(),
            address: addresses[0] ?? "",
            server_name: current.hostname,
            headers,
            body: payloadBytes,
            timeout_ms: tool.max_timeout_ms,
            max_response_bytes: tool.max_response_bytes,
          });
          if (response.body.byteLength > tool.max_response_bytes) {
            throw new Error("MCP_RESPONSE_TOO_LARGE");
          }
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            if (redirect === maxRedirects) throw new Error("MCP_REDIRECT_LIMIT");
            const location = findHeader(response.headers, "location");
            const next = location ? safeEndpoint(new URL(location, current).toString()) : null;
            if (!next || next.hostname !== endpoint.hostname)
              throw new Error("MCP_REDIRECT_DENIED");
            current = next;
            continue;
          }
          const responseHash = await sha256ContentHash([...response.body]);
          const observed = await options.effects.transition(
            input.capability,
            await buildToolEffectTransition({
              schema_version: "tool-effect-transition@1.0.0",
              transition_id: randomUUID(),
              effect_id: intent.effect_id,
              expected_state: "DISPATCH_MARKED",
              target_state: "RESPONSE_OBSERVED",
              dispatch_hash: dispatchHash,
              response_hash: responseHash,
              delivery_certainty: "DISPATCHED_KNOWN",
              reason_code: "TOOL_RESPONSE_OBSERVED",
              reconciliation_of: null,
            }),
          );
          if (!observed.ok) return observed as PortResult<never>;
          const terminalState =
            response.status >= 200 && response.status < 300 ? "COMPLETED" : "FAILED";
          const terminal = await options.effects.transition(
            input.capability,
            await buildToolEffectTransition({
              schema_version: "tool-effect-transition@1.0.0",
              transition_id: randomUUID(),
              effect_id: intent.effect_id,
              expected_state: "RESPONSE_OBSERVED",
              target_state: terminalState,
              dispatch_hash: dispatchHash,
              response_hash: responseHash,
              delivery_certainty: "DISPATCHED_KNOWN",
              reason_code: terminalState === "COMPLETED" ? "TOOL_COMPLETED" : "TOOL_REMOTE_FAILED",
              reconciliation_of: null,
            }),
          );
          if (!terminal.ok) return terminal as PortResult<never>;
          return {
            ok: true,
            value: Object.freeze({
              status: response.status,
              body: response.body,
              response_hash: responseHash,
            }),
          };
        }
      } catch {
        const unknown = await options.effects.transition(
          input.capability,
          await buildToolEffectTransition({
            schema_version: "tool-effect-transition@1.0.0",
            transition_id: randomUUID(),
            effect_id: intent.effect_id,
            expected_state: "DISPATCH_MARKED",
            target_state: "TOOL_OUTCOME_UNKNOWN",
            dispatch_hash: dispatchHash,
            response_hash: null,
            delivery_certainty: "DISPATCHED_UNKNOWN",
            reason_code: "TOOL_OUTCOME_UNKNOWN",
            reconciliation_of: null,
          }),
        );
        if (!unknown.ok) return unknown as PortResult<never>;
        return failure(
          "TOOL_OUTCOME_UNKNOWN",
          "MCP request may have reached the remote server; reconcile before retry.",
          true,
        );
      }
      return failure("MCP_REDIRECT_LIMIT", "MCP redirect limit exceeded.");
    },
  });
}
