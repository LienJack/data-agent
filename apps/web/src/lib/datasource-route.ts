import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  publicSemanticGovernanceError,
  redactSemanticGovernanceError,
  SemanticGovernanceError,
} from "./semantic-governance-error";

export function dataSourceRouteErrorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "数据源请求不符合契约。" } },
      { status: 400 },
    );
  }

  const publicError =
    error instanceof SemanticGovernanceError
      ? redactSemanticGovernanceError(error)
      : publicSemanticGovernanceError("DATASOURCE_CONNECTION_FAILED", true);

  return NextResponse.json(
    {
      error: {
        code: publicError.code,
        message: publicError.message,
        retryable: publicError.retryable,
      },
    },
    { status: publicError.status },
  );
}
