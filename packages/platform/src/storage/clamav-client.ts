import { connect } from "node:net";
import type { ClamAvClient, ClamAvScanResult } from "./file-scan-port.js";

const MAX_RESPONSE_BYTES = 4_096;

function transact(options: {
  host: string;
  port: number;
  timeout_ms: number;
  frames: readonly Uint8Array[];
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: options.host, port: options.port });
    const chunks: Buffer[] = [];
    let length = 0;
    const fail = (error: Error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(options.timeout_ms, () => fail(new Error("CLAMAV_TIMEOUT")));
    socket.once("error", fail);
    socket.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > MAX_RESPONSE_BYTES) return fail(new Error("CLAMAV_RESPONSE_TOO_LARGE"));
      chunks.push(chunk);
      if (chunk.includes(0)) socket.end();
    });
    socket.once("connect", () => {
      for (const frame of options.frames) socket.write(frame);
    });
    socket.once("close", (hadError) => {
      if (hadError) return;
      const response = Buffer.concat(chunks).toString("utf8").replace(/\0+$/u, "").trim();
      response.length > 0 ? resolve(response) : reject(new Error("CLAMAV_EMPTY_RESPONSE"));
    });
  });
}

function chunkedInstream(bytes: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = [Buffer.from("zINSTREAM\0")];
  for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1024) {
    const chunk = bytes.subarray(offset, Math.min(offset + 64 * 1024, bytes.byteLength));
    const size = Buffer.allocUnsafe(4);
    size.writeUInt32BE(chunk.byteLength, 0);
    frames.push(size, chunk);
  }
  frames.push(Buffer.alloc(4));
  return frames;
}

export function createClamAvInstreamClient(options: {
  readonly host: string;
  readonly port: number;
  readonly timeout_ms: number;
  readonly max_bytes: number;
}): ClamAvClient {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(options.host) ||
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65_535 ||
    !Number.isSafeInteger(options.timeout_ms) ||
    options.timeout_ms < 100 ||
    options.timeout_ms > 120_000 ||
    !Number.isSafeInteger(options.max_bytes) ||
    options.max_bytes < 1
  ) {
    throw new TypeError("CLAMAV_CONFIGURATION_INVALID");
  }
  return Object.freeze({
    async scan(bytes: Uint8Array): Promise<ClamAvScanResult> {
      if (bytes.byteLength === 0 || bytes.byteLength > options.max_bytes) {
        throw new TypeError("CLAMAV_INPUT_SIZE_INVALID");
      }
      const version = await transact({
        ...options,
        frames: [Buffer.from("zVERSION\0")],
      });
      const versionMatch = /^ClamAV\s+([^/\s]+)\/([^/\s]+)\/(.+)$/u.exec(version);
      if (!versionMatch?.[1] || !versionMatch[2] || !versionMatch[3]) {
        throw new TypeError("CLAMAV_VERSION_RESPONSE_INVALID");
      }
      const signatureObservedAt = new Date(versionMatch[3]);
      if (!Number.isFinite(signatureObservedAt.getTime())) {
        throw new TypeError("CLAMAV_SIGNATURE_TIMESTAMP_INVALID");
      }
      const response = await transact({ ...options, frames: chunkedInstream(bytes) });
      if (/^stream:\s+OK$/u.test(response)) {
        return {
          status: "CLEAN",
          engine_version: versionMatch[1],
          signature_version: versionMatch[2],
          signature_observed_at: signatureObservedAt.toISOString(),
          malware_name: null,
        };
      }
      const infected = /^stream:\s+(.+)\s+FOUND$/u.exec(response);
      if (!infected?.[1]) throw new TypeError("CLAMAV_SCAN_RESPONSE_INVALID");
      return {
        status: "INFECTED",
        engine_version: versionMatch[1],
        signature_version: versionMatch[2],
        signature_observed_at: signatureObservedAt.toISOString(),
        malware_name: infected[1].slice(0, 256),
      };
    },
  });
}
