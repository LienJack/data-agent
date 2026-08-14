import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { getDataAgentAuth } from "@/lib/auth";

function unavailableAdminEndpoint(request: Request): boolean {
  return new URL(request.url).pathname.startsWith("/api/auth/admin/");
}

function disabledSignUpEndpoint(request: Request): boolean {
  return new URL(request.url).pathname === "/api/auth/sign-up/email";
}

function handlers() {
  return toNextJsHandler(getDataAgentAuth());
}

export async function GET(request: Request) {
  if (unavailableAdminEndpoint(request)) {
    return NextResponse.json(
      { error: { code: "WORKSPACE_ACCESS_DENIED", message: "该身份管理入口不可公开访问。" } },
      { status: 404 },
    );
  }
  return handlers().GET(request);
}

export async function POST(request: Request) {
  if (disabledSignUpEndpoint(request)) {
    return NextResponse.json(
      { error: { code: "AUTH_SIGNUP_DISABLED", message: "系统未开放自主注册。" } },
      { status: 403 },
    );
  }
  if (unavailableAdminEndpoint(request)) {
    return NextResponse.json(
      { error: { code: "WORKSPACE_ACCESS_DENIED", message: "该身份管理入口不可公开访问。" } },
      { status: 404 },
    );
  }
  return handlers().POST(request);
}
