import "server-only";

import {
  immutableIdSchema,
  semanticGraphEntryStatusSchema,
  semanticLifecycleSchema,
  semanticNodeTypeSchema,
} from "@data-agent/contracts";
import type { SemanticStudioService } from "@data-agent/semantic/application";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { selectSseCursor } from "./sse-cursor";
import { workspaceErrorResponse } from "./workspace-request";

const semanticDomainSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
const loadQuerySchema = z.strictObject({
  domain: semanticDomainSchema.default("ecommerce"),
  selectedNodeId: z.string().min(1).max(128).nullable().default(null),
  runId: immutableIdSchema.nullable().default(null),
  hops: z.coerce.number().int().min(1).max(2).default(1),
  clusterId: z.string().min(1).max(128).nullable().default(null),
  view: z.enum(["bootstrap", "full"]).default("bootstrap"),
  search: z.string().max(256).default(""),
  nodeType: semanticNodeTypeSchema.nullable().default(null),
  owner: z.string().min(1).max(128).nullable().default(null),
  lifecycle: semanticLifecycleSchema.nullable().default(null),
  status: semanticGraphEntryStatusSchema.nullable().default(null),
  nodeDomain: z.string().min(1).max(256).nullable().default(null),
  cursor: z.coerce.number().int().nonnegative().safe().default(0),
  limit: z.coerce.number().int().min(1).max(250).default(250),
});
const intentSchema = z.strictObject({
  schema_version: z.literal("semantic-studio-authoring-intent@1.0.0"),
  semantic_domain: semanticDomainSchema,
  instruction: z.string().trim().min(1).max(20_000),
  selected_node_id: z.string().min(1).max(128).nullable(),
  selected_edge_id: z.string().min(1).max(128).nullable(),
  evidence_selection_id: immutableIdSchema.nullable().default(null),
  idempotency_key: z.string().min(8).max(256),
});
const runQuerySchema = z.strictObject({
  semanticDomain: semanticDomainSchema,
  after: z.coerce.number().int().nonnegative().safe().default(0),
});
const clarificationSchema = z.strictObject({
  schema_version: z.literal("semantic-studio-clarification@1.0.0"),
  semantic_domain: semanticDomainSchema,
  run_id: immutableIdSchema,
  clarification_id: immutableIdSchema,
  answer: z.string().trim().min(1).max(2_048),
  idempotency_key: z.string().min(8).max(256),
});

function queryObject(request: NextRequest): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of request.nextUrl.searchParams) {
    if (key in result) throw new z.ZodError([]);
    result[key] = value;
  }
  return result;
}

function response<T>(result: T, created = false): NextResponse {
  const port = result as
    | { readonly ok: true; readonly value: unknown }
    | {
        readonly ok: false;
        readonly error: {
          readonly code: string;
          readonly message: string;
          readonly retryable: boolean;
        };
      };
  return port.ok
    ? NextResponse.json(
        { data: port.value, meta: { authority: "POSTGRESQL", mutation: "AGENT_ONLY" } },
        { status: created ? 201 : 200, headers: { "Cache-Control": "private, no-store" } },
      )
    : workspaceErrorResponse(port.error);
}

function invalid(error: unknown): NextResponse {
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return workspaceErrorResponse({
      code: "SEMANTIC_STUDIO_INPUT_INVALID",
      message: "请求内容不符合 Semantic Studio 契约。",
      retryable: false,
    });
  }
  return workspaceErrorResponse({
    code: "SEMANTIC_STUDIO_UNAVAILABLE",
    message: "Semantic Studio 暂时不可用。",
    retryable: true,
  });
}

export async function handleLoadSemanticStudio(
  request: NextRequest,
  service: SemanticStudioService,
) {
  try {
    const query = loadQuerySchema.parse(queryObject(request));
    const loaded = await service.load({
      semantic_domain: query.domain,
      selected_node_id: query.selectedNodeId,
      authoring_run_id: query.runId,
      hops: query.hops as 1 | 2,
      expanded_cluster_id: query.clusterId,
      list_query: {
        search: query.search,
        node_types: query.nodeType === null ? [] : [query.nodeType],
        owners: query.owner === null ? [] : [query.owner],
        lifecycles: query.lifecycle === null ? [] : [query.lifecycle],
        statuses: query.status === null ? [] : [query.status],
        domains: query.nodeDomain === null ? [] : [query.nodeDomain],
        cursor: query.cursor,
        limit: query.limit,
      },
    });
    if (!loaded.ok || query.view === "bootstrap") return response(loaded);
    return NextResponse.json(
      { data: loaded.value.full, meta: { authority: "POSTGRESQL", mutation: "AGENT_ONLY" } },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return invalid(error);
  }
}

export async function handleStartSemanticAuthoring(
  request: NextRequest,
  service: SemanticStudioService,
) {
  try {
    return response(await service.start(intentSchema.parse(await request.json())), true);
  } catch (error) {
    return invalid(error);
  }
}

export async function handleGetSemanticAuthoringRun(
  request: NextRequest,
  runId: string,
  service: SemanticStudioService,
) {
  try {
    const query = runQuerySchema.parse(queryObject(request));
    return response(
      await service.getRun({
        semantic_domain: query.semanticDomain,
        authoring_run_id: immutableIdSchema.parse(runId),
        after_sequence: query.after,
      }),
    );
  } catch (error) {
    return invalid(error);
  }
}

export async function handleGetSemanticAuthoringPublicFeed(
  request: NextRequest,
  runId: string,
  service: SemanticStudioService,
) {
  try {
    const query = runQuerySchema.parse(queryObject(request));
    return response(
      await service.getPublicRun({
        semantic_domain: query.semanticDomain,
        authoring_run_id: immutableIdSchema.parse(runId),
        after_sequence: query.after,
      }),
    );
  } catch (error) {
    return invalid(error);
  }
}

export async function handleStreamSemanticAuthoringRun(
  request: NextRequest,
  runId: string,
  service: SemanticStudioService,
): Promise<Response> {
  try {
    const query = runQuerySchema.parse(queryObject(request));
    const authoringRunId = immutableIdSchema.parse(runId);
    const encoder = new TextEncoder();
    let cursor = selectSseCursor(request.headers.get("last-event-id"), String(query.after));
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (value: string) => {
          if (!cancelled) controller.enqueue(encoder.encode(value));
        };
        const close = () => {
          if (cancelled) return;
          cancelled = true;
          controller.close();
        };
        const abort = () => close();
        request.signal.addEventListener("abort", abort, { once: true });
        send("retry: 1500\n\n");
        void (async () => {
          const expiresAt = Date.now() + 55_000;
          while (!cancelled && Date.now() < expiresAt) {
            const result = await service.getRun({
              semantic_domain: query.semanticDomain,
              authoring_run_id: authoringRunId,
              after_sequence: cursor,
            });
            if (!result.ok) {
              send(`event: error\ndata: ${JSON.stringify({ error: result.error })}\n\n`);
              close();
              return;
            }
            const lastSequence = result.value.events.at(-1)?.sequence;
            if (lastSequence !== undefined) cursor = Math.max(cursor, lastSequence);
            send(`id: ${cursor}\nevent: authoring\ndata: ${JSON.stringify(result.value)}\n\n`);
            if (
              result.value.state.run.status !== "RUNNING" &&
              result.value.state.run.status !== "WAITING_CLARIFICATION"
            ) {
              close();
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 1_000));
          }
          if (!cancelled) {
            send(`id: ${cursor}\nevent: reconnect\ndata: {}\n\n`);
            close();
          }
        })().catch(() => {
          send(
            `event: error\ndata: ${JSON.stringify({
              error: {
                code: "SEMANTIC_STUDIO_STREAM_FAILED",
                message: "Agent 事件流暂时中断，客户端将自动重连。",
                retryable: true,
              },
            })}\n\n`,
          );
          close();
        });
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "private, no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return invalid(error);
  }
}

export async function handleStreamSemanticAuthoringPublicFeed(
  request: NextRequest,
  runId: string,
  service: SemanticStudioService,
): Promise<Response> {
  try {
    const query = runQuerySchema.parse(queryObject(request));
    const authoringRunId = immutableIdSchema.parse(runId);
    const encoder = new TextEncoder();
    let cursor = selectSseCursor(request.headers.get("last-event-id"), String(query.after));
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (value: string) => {
          if (!cancelled) controller.enqueue(encoder.encode(value));
        };
        const close = () => {
          if (cancelled) return;
          cancelled = true;
          controller.close();
        };
        request.signal.addEventListener("abort", close, { once: true });
        send("retry: 1500\n\n");
        void (async () => {
          const expiresAt = Date.now() + 55_000;
          while (!cancelled && Date.now() < expiresAt) {
            const result = await service.getPublicRun({
              semantic_domain: query.semanticDomain,
              authoring_run_id: authoringRunId,
              after_sequence: cursor,
            });
            if (!result.ok) {
              send(`event: error\ndata: ${JSON.stringify({ error: result.error })}\n\n`);
              close();
              return;
            }
            const lastSequence = result.value.events.at(-1)?.sequence;
            if (lastSequence !== undefined) cursor = Math.max(cursor, lastSequence);
            send(
              `id: ${cursor}\nevent: public-authoring\ndata: ${JSON.stringify(result.value)}\n\n`,
            );
            if (
              result.value.run.status !== "QUEUED" &&
              result.value.run.status !== "RUNNING" &&
              result.value.run.status !== "WAITING_CLARIFICATION"
            ) {
              close();
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 1_000));
          }
          if (!cancelled) {
            send(`id: ${cursor}\nevent: reconnect\ndata: {}\n\n`);
            close();
          }
        })().catch(() => {
          send(
            `event: error\ndata: ${JSON.stringify({
              error: {
                code: "SEMANTIC_STUDIO_STREAM_FAILED",
                message: "Agent 公开事件流暂时中断，客户端将自动重连。",
                retryable: true,
              },
            })}\n\n`,
          );
          close();
        });
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "private, no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return invalid(error);
  }
}

export async function handleResumeSemanticAuthoring(
  request: NextRequest,
  runId: string,
  service: SemanticStudioService,
) {
  try {
    const body = clarificationSchema.parse(await request.json());
    if (body.run_id !== immutableIdSchema.parse(runId)) throw new z.ZodError([]);
    return response(
      await service.resume({
        semantic_domain: body.semantic_domain,
        authoring_run_id: body.run_id,
        clarification_id: body.clarification_id,
        answer: body.answer,
        idempotency_key: body.idempotency_key,
      }),
    );
  } catch (error) {
    return invalid(error);
  }
}
