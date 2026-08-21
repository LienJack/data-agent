import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SessionPrincipal } from "@data-agent/contracts";
import type { AppCapability } from "@data-agent/platform";
import { type NextRequest, NextResponse } from "next/server";
import { getQaAdminAuditRepository } from "./workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "./workspace-request";

export interface AuthorizedQaAdminAuditRequest {
  readonly session: SessionPrincipal;
  readonly capability: AppCapability;
  readonly repository: ReturnType<typeof getQaAdminAuditRepository>;
}

interface QaAdminCursorPayload {
  readonly schema_version: "qa-admin-cursor@1.0.0";
  readonly binding: string;
  readonly offset: string;
  readonly expires_at: number;
}

function cursorSecret() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new TypeError("QA_ADMIN_CURSOR_SECRET_UNAVAILABLE");
  return secret;
}

function cursorSignature(body: string) {
  return createHmac("sha256", cursorSecret()).update(`qa-admin-cursor:${body}`).digest();
}

export function issueQaAdminCursor(binding: string, offset: string, now = Date.now()) {
  if (!/^\d{1,6}$/.test(offset)) throw new TypeError("QA_ADMIN_CURSOR_OFFSET_INVALID");
  const payload: QaAdminCursorPayload = {
    schema_version: "qa-admin-cursor@1.0.0",
    binding,
    offset,
    expires_at: now + 15 * 60 * 1_000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${cursorSignature(body).toString("base64url")}`;
}

export function verifyQaAdminCursor(token: string, binding: string, now = Date.now()) {
  try {
    const [body, encodedSignature, extra] = token.split(".");
    if (!body || !encodedSignature || extra) return null;
    const actual = Buffer.from(encodedSignature, "base64url");
    const expected = cursorSignature(body);
    if (actual.byteLength !== expected.byteLength || !timingSafeEqual(actual, expected))
      return null;
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as QaAdminCursorPayload;
    if (
      payload.schema_version !== "qa-admin-cursor@1.0.0" ||
      payload.binding !== binding ||
      !/^\d{1,6}$/.test(payload.offset) ||
      payload.expires_at < now
    ) {
      return null;
    }
    return payload.offset;
  } catch {
    return null;
  }
}

type Authorized =
  | { readonly ok: true; readonly value: AuthorizedQaAdminAuditRequest }
  | { readonly ok: false; readonly response: NextResponse };

export async function authorizeQaAdminAuditRequest(
  request: NextRequest,
  workspaceId: string,
): Promise<Authorized> {
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return { ok: false, response: workspaceErrorResponse(authorized.error) };
  if (authorized.value.capability.role !== "OWNER") {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "QA_ADMIN_ACCESS_DENIED",
            message: "只有工作空间管理员或超级管理员可以访问对话审计平面。",
            retryable: false,
          },
        },
        { status: 403 },
      ),
    };
  }
  return {
    ok: true,
    value: {
      session: authorized.value.session,
      capability: authorized.value.capability,
      repository: getQaAdminAuditRepository(),
    },
  };
}

export function qaAdminResultResponse<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | {
        readonly ok: false;
        readonly error: {
          readonly code: string;
          readonly message: string;
          readonly retryable: boolean;
        };
      },
) {
  if (result.ok) return NextResponse.json({ data: result.value });
  const status =
    result.error.code === "QA_ADMIN_ACCESS_DENIED" ||
    result.error.code === "PERSISTENCE_WRITE_DENIED"
      ? 403
      : result.error.code === "QA_ADMIN_RESOURCE_NOT_FOUND_OR_DENIED"
        ? 404
        : result.error.code.endsWith("_INVALID")
          ? 400
          : result.error.retryable
            ? 503
            : 409;
  return NextResponse.json({ error: result.error }, { status });
}
