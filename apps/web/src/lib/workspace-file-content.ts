import "server-only";

import { createHash } from "node:crypto";
import { WORKSPACE_FILE_MAX_BYTES } from "@data-agent/contracts";

const utf8 = new TextDecoder("utf-8", { fatal: true });

function containsAscii(bytes: Uint8Array, value: string): boolean {
  return Buffer.from(bytes).includes(Buffer.from(value, "utf8"));
}

export async function observeWorkspaceFileContent(file: File): Promise<
  Readonly<{
    bytes: Uint8Array;
    blob_hash: `sha256:${string}`;
    byte_size: number;
    detected_mime: string;
  }>
> {
  if (file.size < 1 || file.size > WORKSPACE_FILE_MAX_BYTES) {
    throw new TypeError("WORKSPACE_FILE_SIZE_INVALID");
  }
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let detectedMime: string;
    if (bytes.slice(0, 5).every((value, index) => value === Buffer.from("%PDF-")[index])) {
      detectedMime = "application/pdf";
    } else if (
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      containsAscii(bytes, "[Content_Types].xml") &&
      containsAscii(bytes, "word/")
    ) {
      detectedMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    } else {
      let text: string;
      try {
        text = utf8.decode(bytes);
      } catch {
        throw new TypeError("WORKSPACE_FILE_MIME_UNSUPPORTED");
      }
      const trimmed = text.trim();
      if (
        (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
        (() => {
          try {
            JSON.parse(trimmed);
            return true;
          } catch {
            return false;
          }
        })()
      ) {
        detectedMime = "application/json";
      } else if (/^#{1,6}\s|\[[^\]]+\]\([^)]+\)|```/mu.test(text)) {
        detectedMime = "text/markdown";
      } else if (text.includes(",") && text.split(/\r?\n/u)[0]?.includes(",")) {
        detectedMime = "text/csv";
      } else {
        detectedMime = "text/plain";
      }
    }
    return Object.freeze({
      bytes,
      blob_hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const,
      byte_size: bytes.byteLength,
      detected_mime: detectedMime,
    });
  });
}
