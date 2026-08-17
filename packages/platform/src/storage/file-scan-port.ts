import type { WorkspaceFileScanVerdict } from "@data-agent/contracts";

const allowedMimeTypes = new Set([
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/markdown",
  "text/plain",
]);

const credentialPatterns = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /\b(?:password|passwd|token|api[_-]?key)\s*[:=]\s*[^\s]{12,}/gi,
];

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_COMPRESSION_RATIO = 200;
const MAX_SIGNATURE_FUTURE_SKEW_MS = 5 * 60 * 1_000;

function blocked(
  findings: FileScanResult["content_policy_findings"],
  scanner: NonNullable<FileScanResult["scanner"]>,
  stableErrorCode = "FILE_CONTENT_POLICY_BLOCKED",
): FileScanResult {
  return {
    verdict: "POLICY_BLOCKED",
    stable_error_code: stableErrorCode,
    scanner,
    credential_match_count: 0,
    content_policy_findings: findings,
    malware_name: null,
  };
}

function inspectDocxArchive(bytes: Uint8Array): FileScanResult["content_policy_findings"] {
  if (bytes.byteLength < 22) return ["UNSUPPORTED_ENCODING"];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lowerBound = Math.max(0, bytes.byteLength - 65_557);
  let endOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= lowerBound; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) return ["UNSUPPORTED_ENCODING"];
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  if (entryCount < 1 || entryCount > MAX_ARCHIVE_ENTRIES) return ["ARCHIVE_BOMB_RISK"];

  let cursor = centralOffset;
  let totalCompressed = 0;
  let totalUncompressed = 0;
  let activeContent = false;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + 46 > bytes.byteLength ||
      view.getUint32(cursor, true) !== ZIP_CENTRAL_DIRECTORY_ENTRY
    ) {
      return ["UNSUPPORTED_ENCODING"];
    }
    const compressedBytes = view.getUint32(cursor + 20, true);
    const uncompressedBytes = view.getUint32(cursor + 24, true);
    const filenameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const next = cursor + 46 + filenameLength + extraLength + commentLength;
    if (next > bytes.byteLength) return ["UNSUPPORTED_ENCODING"];
    const filename = decoder
      .decode(bytes.subarray(cursor + 46, cursor + 46 + filenameLength))
      .toLowerCase();
    if (
      filename.endsWith("vbaproject.bin") ||
      filename.startsWith("word/embeddings/") ||
      filename.startsWith("word/activex/")
    ) {
      activeContent = true;
    }
    totalCompressed += compressedBytes;
    totalUncompressed += uncompressedBytes;
    if (
      uncompressedBytes > MAX_ARCHIVE_ENTRY_BYTES ||
      (compressedBytes === 0 && uncompressedBytes > 0) ||
      (compressedBytes > 0 && uncompressedBytes > compressedBytes * MAX_ARCHIVE_COMPRESSION_RATIO)
    ) {
      return activeContent ? ["ACTIVE_CONTENT", "ARCHIVE_BOMB_RISK"] : ["ARCHIVE_BOMB_RISK"];
    }
    cursor = next;
  }
  if (
    totalUncompressed > MAX_ARCHIVE_UNCOMPRESSED_BYTES ||
    (totalCompressed > 0 && totalUncompressed > totalCompressed * MAX_ARCHIVE_COMPRESSION_RATIO)
  ) {
    return activeContent ? ["ACTIVE_CONTENT", "ARCHIVE_BOMB_RISK"] : ["ARCHIVE_BOMB_RISK"];
  }
  return activeContent ? ["ACTIVE_CONTENT"] : [];
}

function inspectContentPolicy(
  bytes: Uint8Array,
  detectedMime: string,
): FileScanResult["content_policy_findings"] {
  if (detectedMime === "application/pdf") {
    const document = Buffer.from(bytes).toString("latin1");
    return /\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction)\b/u.test(document)
      ? ["ACTIVE_CONTENT"]
      : [];
  }
  return detectedMime === DOCX_MIME ? inspectDocxArchive(bytes) : [];
}

export type ClamAvScanResult = Readonly<{
  status: "CLEAN" | "INFECTED";
  engine_version: string;
  signature_version: string;
  signature_observed_at: string;
  malware_name: string | null;
}>;

export interface ClamAvClient {
  scan(bytes: Uint8Array): Promise<ClamAvScanResult>;
}

export type FileScanResult = Readonly<{
  verdict: WorkspaceFileScanVerdict;
  stable_error_code: string | null;
  scanner: Omit<ClamAvScanResult, "status" | "malware_name"> | null;
  credential_match_count: number;
  content_policy_findings: readonly (
    | "ACTIVE_CONTENT"
    | "ARCHIVE_BOMB_RISK"
    | "MIME_NOT_ALLOWED"
    | "UNSUPPORTED_ENCODING"
  )[];
  malware_name: string | null;
}>;

export type FileScanPort = Readonly<{
  scan(input: Readonly<{ bytes: Uint8Array; detected_mime: string }>): Promise<FileScanResult>;
}>;

function countCredentialMatches(value: Uint8Array): number {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(value);
  const matches: Array<readonly [number, number]> = [];
  for (const pattern of credentialPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      if (start !== undefined) matches.push([start, start + match[0].length]);
    }
  }
  matches.sort(([leftStart, leftEnd], [rightStart, rightEnd]) =>
    leftStart === rightStart ? rightEnd - leftEnd : leftStart - rightStart,
  );
  let count = 0;
  let coveredUntil = -1;
  for (const [start, end] of matches) {
    if (start >= coveredUntil) {
      count += 1;
      coveredUntil = end;
    } else if (end > coveredUntil) {
      coveredUntil = end;
    }
  }
  return count;
}

export function createFileScanPort(
  options: Readonly<{
    clamav: ClamAvClient;
    now: () => Date;
    max_signature_age_ms: number;
    policy_version: string;
  }>,
): FileScanPort {
  if (!Number.isSafeInteger(options.max_signature_age_ms) || options.max_signature_age_ms <= 0) {
    throw new TypeError("FILE_SCAN_SIGNATURE_AGE_INVALID");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(options.policy_version)) {
    throw new TypeError("FILE_SCAN_POLICY_VERSION_INVALID");
  }
  return Object.freeze({
    async scan({ bytes, detected_mime }): Promise<FileScanResult> {
      const mimeAllowed = allowedMimeTypes.has(detected_mime);
      const contentPolicyFindings = inspectContentPolicy(bytes, detected_mime);

      let observed: ClamAvScanResult;
      try {
        observed = await options.clamav.scan(bytes);
      } catch {
        return {
          verdict: "UNKNOWN",
          stable_error_code: "FILE_SCANNER_UNAVAILABLE",
          scanner: null,
          credential_match_count: 0,
          content_policy_findings: [],
          malware_name: null,
        };
      }
      const scanner = {
        engine_version: observed.engine_version,
        signature_version: observed.signature_version,
        signature_observed_at: observed.signature_observed_at,
      };
      const signatureTime = new Date(observed.signature_observed_at).getTime();
      const observedAt = options.now().getTime();
      if (
        !Number.isFinite(signatureTime) ||
        observedAt - signatureTime > options.max_signature_age_ms ||
        signatureTime - observedAt > MAX_SIGNATURE_FUTURE_SKEW_MS
      ) {
        return {
          verdict: "UNKNOWN",
          stable_error_code: "FILE_SCANNER_SIGNATURE_STALE",
          scanner,
          credential_match_count: 0,
          content_policy_findings: [],
          malware_name: null,
        };
      }
      if (observed.status === "INFECTED") {
        return {
          verdict: "MALICIOUS",
          stable_error_code: "FILE_MALWARE_DETECTED",
          scanner,
          credential_match_count: 0,
          content_policy_findings: [],
          malware_name: observed.malware_name ?? "MALWARE_DETECTED",
        };
      }
      if (!mimeAllowed) return blocked(["MIME_NOT_ALLOWED"], scanner, "FILE_MIME_NOT_ALLOWED");
      if (contentPolicyFindings.length > 0) return blocked(contentPolicyFindings, scanner);
      const credentialMatchCount = countCredentialMatches(bytes);
      if (credentialMatchCount > 0) {
        return {
          verdict: "CREDENTIAL_MATCH",
          stable_error_code: "FILE_CREDENTIAL_DETECTED",
          scanner,
          credential_match_count: credentialMatchCount,
          content_policy_findings: [],
          malware_name: null,
        };
      }
      return {
        verdict: "CLEAN",
        stable_error_code: null,
        scanner,
        credential_match_count: 0,
        content_policy_findings: [],
        malware_name: null,
      };
    },
  });
}
