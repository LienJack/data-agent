import { toPublicRunEvent } from "@data-agent/contracts";
import { createPostgresRepository, createPostgresRunEventStore } from "@data-agent/platform";
import type { NextRequest } from "next/server";
import { selectSseCursor } from "@/lib/sse-cursor";
import {
  getWorkspaceAuthority,
  getWorkspaceDataRepository,
  getWorkspaceSqlPool,
} from "@/lib/workspace-identity";
import { authorizeWorkspaceRequest, workspaceErrorResponse } from "@/lib/workspace-request";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const TERMINAL_TYPES = new Set(["terminal"]);

function parseCursor(request: NextRequest): number {
  return selectSseCursor(
    request.headers.get("last-event-id"),
    request.nextUrl.searchParams.get("cursor"),
  );
}

function waitForNextPoll(signal: AbortSignal, milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workspaceId: string; runId: string }> },
) {
  const { workspaceId, runId } = await context.params;
  const authorized = await authorizeWorkspaceRequest(request, workspaceId, "READ");
  if (!authorized.ok) return workspaceErrorResponse(authorized.error);

  const sqlPool = getWorkspaceSqlPool();
  const authorizer = getWorkspaceAuthority().authorizer;
  const repository = createPostgresRepository(sqlPool, authorizer);
  const [run, binding] = await Promise.all([
    repository.getRun(authorized.value.capability, { run_id: runId }),
    getWorkspaceDataRepository().getRunBinding(authorized.value.capability, runId),
  ]);
  if (!run.ok) return workspaceErrorResponse(run.error);
  if (!binding.ok) return workspaceErrorResponse(binding.error);
  if (!run.value || !binding.value) {
    return workspaceErrorResponse({
      code: "WORKSPACE_OBJECT_NOT_FOUND_OR_DENIED",
      message: "Run 不存在或无权访问。",
      retryable: false,
    });
  }

  const eventStore = createPostgresRunEventStore(sqlPool, authorizer, authorized.value.capability);
  let cursor = parseCursor(request);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        let lastHeartbeat = Date.now();
        let lastProjectionCheck = 0;
        try {
          while (!request.signal.aborted) {
            const result = await eventStore.listEvents({
              scope: authorized.value.capability.scope,
              run_id: runId,
              after_sequence: cursor,
              limit: 256,
            });
            if (!result.ok) throw new Error(result.error.code);

            for (const durableEvent of result.value) {
              if (durableEvent.sequence <= cursor) continue;
              const publicEvent = toPublicRunEvent(durableEvent);
              controller.enqueue(
                encoder.encode(
                  `id: ${publicEvent.sequence}\ndata: ${JSON.stringify(publicEvent)}\n\n`,
                ),
              );
              cursor = publicEvent.sequence;
              if (TERMINAL_TYPES.has(publicEvent.type)) {
                controller.close();
                return;
              }
            }

            if (result.value.length === 0) {
              if (Date.now() - lastProjectionCheck >= 2_000) {
                const projection = await eventStore.readProjection({
                  scope: authorized.value.capability.scope,
                  run_id: runId,
                });
                if (!projection.ok) throw new Error(projection.error.code);
                if (
                  projection.value &&
                  ["COMPLETED", "FAILED", "CANCELLED"].includes(projection.value.projection.status)
                ) {
                  controller.close();
                  return;
                }
                lastProjectionCheck = Date.now();
              }
              if (Date.now() - lastHeartbeat >= 15_000) {
                controller.enqueue(encoder.encode(`: heartbeat ${cursor}\n\n`));
                lastHeartbeat = Date.now();
              }
              await waitForNextPoll(request.signal, 400);
            }
          }
          controller.close();
        } catch (error) {
          if (request.signal.aborted) {
            controller.close();
            return;
          }
          controller.error(error);
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
