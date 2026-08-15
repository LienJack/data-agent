import { createConnection } from "node:net";
import {
  type PythonExecutionEnvelopeV1,
  type PythonSandboxTransportOutcomeV1,
  pythonExecutionEnvelopeSchema,
  pythonSandboxTransportOutcomeSchema,
} from "@data-agent/contracts";

export interface PythonSandboxClient {
  execute(envelope: PythonExecutionEnvelopeV1): Promise<PythonSandboxTransportOutcomeV1>;
}

export interface PythonSandboxClientOptions {
  socketPath: string;
  responseTimeoutMs: number;
  maxResponseBytes?: number;
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
  return {
    execute(envelope) {
      const payload = `${JSON.stringify(pythonExecutionEnvelopeSchema.parse(envelope))}\n`;
      return new Promise((resolve, reject) => {
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
              resolve(pythonSandboxTransportOutcomeSchema.parse(document));
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
    },
  };
}

export function createEnvironmentPythonSandboxClient(): PythonSandboxClient | null {
  if (process.env.PYTHON_SANDBOX_ENABLED !== "true") return null;
  return createPythonSandboxClient({
    socketPath: process.env.PYTHON_SANDBOX_SOCKET_PATH ?? "/run/data-agent-python/sandbox.sock",
    responseTimeoutMs: Number(process.env.PYTHON_SANDBOX_RESPONSE_TIMEOUT_MS ?? "125000"),
  });
}
