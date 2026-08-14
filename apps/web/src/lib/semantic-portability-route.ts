import "server-only";

import { SEMANTIC_IMPORT_MAX_BYTES } from "@data-agent/contracts";
import { NextResponse } from "next/server";

const REQUEST_ENVELOPE_BYTES = 64 * 1024;

export type SemanticJsonBodyResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: NextResponse };

function invalidBody(message: string): SemanticJsonBodyResult {
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: {
          code: "SEMANTIC_IMPORT_INPUT_INVALID",
          message,
          retryable: false,
        },
      },
      { status: 400 },
    ),
  };
}

export async function readSemanticJsonBody(request: Request): Promise<SemanticJsonBodyResult> {
  const maxBytes = SEMANTIC_IMPORT_MAX_BYTES + REQUEST_ENVELOPE_BYTES;
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return invalidBody("语义导入请求超过 1 MiB 文件限制。");
  }
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return invalidBody("无法读取语义导入请求体。");
  }
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    return invalidBody("语义导入请求超过 1 MiB 文件限制。");
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return invalidBody("请求体必须是 JSON。");
  }
}

export function bindSemanticImportId(input: unknown, importId: string): unknown {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? { ...input, import_id: importId }
    : input;
}
