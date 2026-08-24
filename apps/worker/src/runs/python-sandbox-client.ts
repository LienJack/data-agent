import { createConnection } from "node:net";
import {
  type PythonExecutionEnvelopeV2,
  type PythonSandboxTransportOutcomeV2,
  pythonExecutionEnvelopeSchema,
  pythonSandboxTransportOutcomeSchema,
} from "@data-agent/contracts";
import { z } from "zod";

export interface PythonSandboxCancellationV1 {
  readonly protocol_version: "data-agent-python-sandbox-control@1.0.0";
  readonly operation: "CANCEL";
  readonly authorization: string;
  readonly workspace_id: string;
  readonly run_id: string;
  readonly idempotency_key: string;
  readonly fence_token: string;
}

const cancellationResultSchema = z.strictObject({
  protocol_version: z.literal("data-agent-python-sandbox-control@1.0.0"),
  status: z.enum(["CANCEL_REQUESTED", "NOT_FOUND", "ALREADY_TERMINAL"]),
});

export type PythonSandboxCancellationResultV1 = z.infer<typeof cancellationResultSchema>;

export interface PythonSandboxClient {
  execute(
    envelope: PythonExecutionEnvelopeV2,
    signal?: AbortSignal,
  ): Promise<PythonSandboxTransportOutcomeV2>;
  cancel(input: PythonSandboxCancellationV1): Promise<PythonSandboxCancellationResultV1>;
}

export interface PythonSandboxClientOptions {
  socketPath: string;
  responseTimeoutMs: number;
  maxResponseBytes?: number;
}

export interface PythonSandboxRuntimeRoute {
  readonly runtimeDigest: `sha256:${string}`;
  readonly socketPath: string;
}

export class PythonSandboxTransportError extends Error {
  constructor(readonly code: "PYTHON_SANDBOX_UNAVAILABLE" | "PYTHON_PROTOCOL_INVALID") {
    super(code);
    this.name = "PythonSandboxTransportError";
  }
}

export function createPythonSandboxClient(
  options: PythonSandboxClientOptions,
): PythonSandboxClient {
  const maximum = options.maxResponseBytes ?? 384 * 1024 * 1024;
  const exchange = <T>(payload: string, parse: (input: unknown) => T): Promise<T> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      let settled = false;
      const socket = createConnection(options.socketPath);
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        callback();
      };
      const timeout = setTimeout(() => {
        finish(() => reject(new PythonSandboxTransportError("PYTHON_SANDBOX_UNAVAILABLE")));
      }, options.responseTimeoutMs);
      timeout.unref();
      socket.on("connect", () => socket.end(payload));
      socket.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maximum) {
          finish(() => reject(new PythonSandboxTransportError("PYTHON_PROTOCOL_INVALID")));
          return;
        }
        chunks.push(chunk);
      });
      socket.on("error", () => {
        finish(() => reject(new PythonSandboxTransportError("PYTHON_SANDBOX_UNAVAILABLE")));
      });
      socket.on("end", () => {
        finish(() => {
          try {
            const raw = Buffer.concat(chunks).toString("utf8");
            const document = JSON.parse(raw) as { transport_error?: string };
            if (document.transport_error) {
              throw new PythonSandboxTransportError(
                document.transport_error === "PYTHON_PROTOCOL_INVALID"
                  ? "PYTHON_PROTOCOL_INVALID"
                  : "PYTHON_SANDBOX_UNAVAILABLE",
              );
            }
            resolve(parse(document));
          } catch (error) {
            reject(
              error instanceof PythonSandboxTransportError
                ? error
                : new PythonSandboxTransportError("PYTHON_PROTOCOL_INVALID"),
            );
          }
        });
      });
    });
  const client: PythonSandboxClient = {
    execute(envelope, signal) {
      const parsed = pythonExecutionEnvelopeSchema.parse(envelope);
      const execution = exchange(`${JSON.stringify(parsed)}\n`, (document) =>
        pythonSandboxTransportOutcomeSchema.parse(document),
      );
      if (!signal) return execution;
      if (signal.aborted) {
        void client.cancel({
          protocol_version: "data-agent-python-sandbox-control@1.0.0",
          operation: "CANCEL",
          authorization: parsed.authorization,
          workspace_id: parsed.request.workspace_id,
          run_id: parsed.request.run_id,
          idempotency_key: parsed.request.idempotency_key,
          fence_token: parsed.request.fence_token,
        });
        return execution;
      }
      const cancel = () => {
        void client.cancel({
          protocol_version: "data-agent-python-sandbox-control@1.0.0",
          operation: "CANCEL",
          authorization: parsed.authorization,
          workspace_id: parsed.request.workspace_id,
          run_id: parsed.request.run_id,
          idempotency_key: parsed.request.idempotency_key,
          fence_token: parsed.request.fence_token,
        });
      };
      signal.addEventListener("abort", cancel, { once: true });
      return execution.finally(() => signal.removeEventListener("abort", cancel));
    },
    cancel(input) {
      return exchange(`${JSON.stringify(input)}\n`, (document) =>
        cancellationResultSchema.parse(document),
      );
    },
  };
  return client;
}

export function createRoutedPythonSandboxClient(
  routes: readonly (PythonSandboxRuntimeRoute & { readonly client: PythonSandboxClient })[],
): PythonSandboxClient {
  const byDigest = new Map<string, PythonSandboxClient>(
    routes.map((route) => [route.runtimeDigest, route.client]),
  );
  if (byDigest.size === 0 || byDigest.size !== routes.length) {
    throw new TypeError("PYTHON_SANDBOX_RUNTIME_ROUTES_INVALID");
  }
  const routed: PythonSandboxClient = {
    execute(envelope, signal) {
      const client = byDigest.get(envelope.request.runtime_digest);
      if (!client) {
        return Promise.reject(new PythonSandboxTransportError("PYTHON_SANDBOX_UNAVAILABLE"));
      }
      return client.execute(envelope, signal);
    },
    async cancel(input) {
      const results = await Promise.all(
        [...byDigest.values()].map((client) => client.cancel(input)),
      );
      if (results.some(({ status }) => status === "CANCEL_REQUESTED")) {
        return {
          protocol_version: "data-agent-python-sandbox-control@1.0.0",
          status: "CANCEL_REQUESTED",
        };
      }
      if (results.some(({ status }) => status === "ALREADY_TERMINAL")) {
        return {
          protocol_version: "data-agent-python-sandbox-control@1.0.0",
          status: "ALREADY_TERMINAL",
        };
      }
      return { protocol_version: "data-agent-python-sandbox-control@1.0.0", status: "NOT_FOUND" };
    },
  };
  return Object.freeze(routed);
}

export function createEnvironmentPythonSandboxClient(
  environment: NodeJS.ProcessEnv = process.env,
  runtimeRoutes: readonly PythonSandboxRuntimeRoute[] = [],
): PythonSandboxClient | null {
  if (environment.PYTHON_SANDBOX_ENABLED !== "true") return null;
  const responseTimeoutMs = Number(environment.PYTHON_SANDBOX_RESPONSE_TIMEOUT_MS ?? "125000");
  return createRoutedPythonSandboxClient(
    runtimeRoutes.map((route) => ({
      ...route,
      client: createPythonSandboxClient({ socketPath: route.socketPath, responseTimeoutMs }),
    })),
  );
}
