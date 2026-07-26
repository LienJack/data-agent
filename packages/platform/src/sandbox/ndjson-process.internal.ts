import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { TextDecoder } from "node:util";

export type SandboxProcessFailureCode =
  | "SANDBOX_PROCESS_DEADLINE_EXCEEDED"
  | "SANDBOX_PROCESS_EXITED"
  | "SANDBOX_PROCESS_NOT_RUNNING"
  | "SANDBOX_PROTOCOL_INVALID_JSON"
  | "SANDBOX_PROTOCOL_INVALID_OUTCOME"
  | "SANDBOX_PROTOCOL_MULTIPLE_OUTCOMES"
  | "SANDBOX_PROTOCOL_NO_OUTCOME"
  | "SANDBOX_PROTOCOL_STDERR_LIMIT_EXCEEDED"
  | "SANDBOX_PROTOCOL_STDOUT_LIMIT_EXCEEDED";

export class SandboxProcessError extends Error {
  override readonly name = "SandboxProcessError";

  constructor(
    readonly code: SandboxProcessFailureCode,
    message: string,
  ) {
    super(message);
  }
}

export interface SingleExecutionNdjsonProcessOptions<Outcome> {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly execute_frame: unknown;
  readonly parse_outcome: (value: unknown) => Outcome;
  readonly protocol_timeout_ms?: number;
  readonly max_stdout_bytes?: number;
  readonly max_stderr_bytes?: number;
}

export interface SingleExecutionNdjsonProcess<Outcome> {
  readonly outcome: Promise<Outcome>;
  send(frame: unknown): void;
  terminate(): void;
}

const DEFAULT_MAX_STDOUT_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 1024 * 1024;
const DEFAULT_PROTOCOL_TIMEOUT_MS = 5 * 60 * 1000;

function encodeFrame(frame: unknown): string {
  const encoded = JSON.stringify(frame);
  if (encoded === undefined) {
    throw new TypeError("Sandbox NDJSON frame 必须是可序列化的 JSON 值。");
  }
  return `${encoded}\n`;
}

function processFailure(code: SandboxProcessFailureCode, message: string): SandboxProcessError {
  return new SandboxProcessError(code, message);
}

export function startSingleExecutionNdjsonProcess<Outcome>(
  options: SingleExecutionNdjsonProcessOptions<Outcome>,
): SingleExecutionNdjsonProcess<Outcome> {
  const executeFrame = encodeFrame(options.execute_frame);
  const maxStdoutBytes = options.max_stdout_bytes ?? DEFAULT_MAX_STDOUT_BYTES;
  const maxStderrBytes = options.max_stderr_bytes ?? DEFAULT_MAX_STDERR_BYTES;
  const protocolTimeoutMs = options.protocol_timeout_ms ?? DEFAULT_PROTOCOL_TIMEOUT_MS;
  if (!Number.isSafeInteger(maxStdoutBytes) || maxStdoutBytes <= 0) {
    throw new TypeError("Sandbox stdout byte limit 必须是正安全整数。");
  }
  if (!Number.isSafeInteger(maxStderrBytes) || maxStderrBytes <= 0) {
    throw new TypeError("Sandbox stderr byte limit 必须是正安全整数。");
  }
  if (!Number.isSafeInteger(protocolTimeoutMs) || protocolTimeoutMs <= 0) {
    throw new TypeError("Sandbox protocol timeout 必须是正安全整数。");
  }

  const child: ChildProcessWithoutNullStreams = spawn(options.command, [...(options.args ?? [])], {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let stdoutFrameChunks: Buffer[] = [];
  let stdoutFrameBytes = 0;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let hasOutcome = false;
  let parsedOutcome: Outcome | undefined;
  let failure: Error | undefined;
  let closed = false;

  const fail = (error: Error): void => {
    if (failure) return;
    failure = error;
    child.kill("SIGKILL");
  };
  const protocolTimer = setTimeout(() => {
    fail(
      processFailure(
        "SANDBOX_PROCESS_DEADLINE_EXCEEDED",
        "Sandbox 进程超过本地协议 Deadline，已被强制终止。",
      ),
    );
  }, protocolTimeoutMs);

  const parseLine = (line: string): void => {
    if (line.trim().length === 0) return;
    if (hasOutcome) {
      fail(
        processFailure(
          "SANDBOX_PROTOCOL_MULTIPLE_OUTCOMES",
          "Sandbox stdout 只能包含一个终态 Outcome frame。",
        ),
      );
      return;
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(line);
    } catch {
      fail(
        processFailure(
          "SANDBOX_PROTOCOL_INVALID_JSON",
          "Sandbox stdout 包含无效 JSON，拒绝作为终态事实。",
        ),
      );
      return;
    }
    try {
      parsedOutcome = options.parse_outcome(decoded);
      hasOutcome = true;
    } catch {
      fail(
        processFailure(
          "SANDBOX_PROTOCOL_INVALID_OUTCOME",
          "Sandbox stdout 未通过严格 Outcome Schema。",
        ),
      );
    }
  };

  const appendFrameChunk = (chunk: Buffer): void => {
    if (chunk.byteLength === 0) return;
    stdoutFrameChunks.push(chunk);
    stdoutFrameBytes += chunk.byteLength;
  };

  const drainFrame = (): void => {
    const frame =
      stdoutFrameChunks.length === 1
        ? stdoutFrameChunks[0]
        : Buffer.concat(stdoutFrameChunks, stdoutFrameBytes);
    stdoutFrameChunks = [];
    stdoutFrameBytes = 0;
    parseLine(decoder.decode(frame));
  };

  const consumeStdoutChunk = (chunk: Buffer): void => {
    let frameStart = 0;
    for (let index = 0; index < chunk.byteLength; index += 1) {
      if (chunk[index] !== 0x0a) continue;
      appendFrameChunk(chunk.subarray(frameStart, index));
      drainFrame();
      frameStart = index + 1;
    }
    appendFrameChunk(chunk.subarray(frameStart));
  };

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes > maxStdoutBytes) {
      fail(
        processFailure(
          "SANDBOX_PROTOCOL_STDOUT_LIMIT_EXCEEDED",
          "Sandbox stdout 超过协议上限，拒绝继续缓冲。",
        ),
      );
      return;
    }
    try {
      consumeStdoutChunk(chunk);
    } catch {
      fail(
        processFailure("SANDBOX_PROTOCOL_INVALID_JSON", "Sandbox stdout 不是有效 UTF-8 NDJSON。"),
      );
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.byteLength;
    if (stderrBytes > maxStderrBytes) {
      fail(
        processFailure(
          "SANDBOX_PROTOCOL_STDERR_LIMIT_EXCEEDED",
          "Sandbox stderr 超过日志上限，进程已被终止。",
        ),
      );
    }
  });

  const outcome = new Promise<Outcome>((resolve, reject) => {
    child.once("error", (error) => {
      fail(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(protocolTimer);
      closed = true;
      try {
        if (stdoutFrameBytes > 0) {
          drainFrame();
        }
      } catch {
        failure ??= processFailure(
          "SANDBOX_PROTOCOL_INVALID_JSON",
          "Sandbox stdout 不是有效 UTF-8 NDJSON。",
        );
      }
      if (failure) {
        reject(failure);
        return;
      }
      if (code !== 0) {
        reject(
          processFailure(
            "SANDBOX_PROCESS_EXITED",
            `Sandbox 进程在产生可信终态前退出（code=${String(code)}, signal=${String(signal)}）。`,
          ),
        );
        return;
      }
      if (!hasOutcome) {
        reject(
          processFailure(
            "SANDBOX_PROTOCOL_NO_OUTCOME",
            "Sandbox 进程成功退出但没有产生终态 Outcome。",
          ),
        );
        return;
      }
      resolve(parsedOutcome as Outcome);
    });
  });

  child.stdin.write(executeFrame);

  return {
    outcome,
    send(frame: unknown): void {
      if (closed || child.exitCode !== null || child.signalCode !== null || child.stdin.destroyed) {
        throw processFailure(
          "SANDBOX_PROCESS_NOT_RUNNING",
          "Sandbox 进程已经终止，不能再发送控制 frame。",
        );
      }
      child.stdin.write(encodeFrame(frame));
    },
    terminate(): void {
      if (!closed && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    },
  };
}
