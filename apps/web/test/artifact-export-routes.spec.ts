import {
  type ArtifactExportReceipt,
  computeArtifactWorkspaceDocumentHash,
} from "@data-agent/contracts";
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const state = vi.hoisted(() => ({
  document: null as unknown,
  receipt: null as ArtifactExportReceipt | null,
  resolves: 0,
  creates: 0,
  loads: 0,
  enqueues: 0,
  accesses: [] as string[],
  bindingAvailable: true,
  bindingReads: 0,
}));

vi.mock("@data-agent/platform", () => ({
  createPostgresJobQueue: () => ({
    enqueue: async () => {
      state.enqueues += 1;
      return {
        ok: true,
        value: {
          schema_version: "job-submission-receipt@1.0.0",
          disposition: "CREATED",
          job_id: "00000000-0000-4000-8000-000000007305",
        },
      };
    },
  }),
  createPostgresRepository: () => ({
    resolveArtifact: async () => {
      state.resolves += 1;
      return { ok: true, value: state.document };
    },
  }),
  createPostgresArtifactWorkspaceStore: () => ({
    create: async (_capability: unknown, _command: unknown, receipt: ArtifactExportReceipt) => {
      state.creates += 1;
      state.receipt = receipt;
      return { ok: true, value: { disposition: "CREATED", receipt } };
    },
    load: async () => {
      state.loads += 1;
      return { ok: true, value: state.receipt };
    },
  }),
}));

vi.mock("@/lib/workspace-identity", () => ({
  getWorkspaceAuthority: () => ({ authorizer: {} }),
  getWorkspaceDataRepository: () => ({
    getRunBinding: async () => {
      state.bindingReads += 1;
      return {
        ok: true,
        value: state.bindingAvailable
          ? { run_id: ids.run, conversation_id: "00000000-0000-4000-8000-000000007306" }
          : null,
      };
    },
  }),
  getWorkspaceSqlPool: () => ({}),
}));

vi.mock("@/lib/workspace-request", () => ({
  authorizeWorkspaceRequest: async (_request: unknown, _workspaceId: string, access: string) => {
    state.accesses.push(access);
    return { ok: true, value: { capability: { branded: true } } };
  },
  workspaceErrorResponse: (error: unknown) => NextResponse.json({ error }, { status: 400 }),
}));

const ids = {
  workspace: "00000000-0000-4000-8000-000000007302",
  artifact: "00000000-0000-4000-8000-000000007303",
  run: "00000000-0000-4000-8000-000000007304",
} as const;
const referenceDraft = {
  artifact_id: ids.artifact,
  artifact_type: "ArtifactWorkspaceDocument" as const,
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: ids.workspace,
  environment: "test",
  run_id: ids.run,
  revision: 1,
  content_hash: `sha256:${"0".repeat(64)}` as const,
};

async function fixture() {
  const draft = {
    schema_version: "artifact-workspace-document@1.0.0" as const,
    document_ref: referenceDraft,
    projection: {
      kind: "TABLE" as const,
      columns: [{ key: "value", label: "Value", data_type: "STRING" as const }],
      rows: [{ value: "=1+1" }],
      total_rows: 1,
    },
  };
  const contentHash = await computeArtifactWorkspaceDocumentHash(draft);
  const reference = { ...referenceDraft, content_hash: contentHash };
  return { reference, document: { ...draft, document_ref: reference } };
}

describe("Artifact preview/export routes", () => {
  beforeEach(() => {
    state.document = null;
    state.receipt = null;
    state.resolves = 0;
    state.creates = 0;
    state.loads = 0;
    state.enqueues = 0;
    state.accesses = [];
    state.bindingAvailable = true;
    state.bindingReads = 0;
  });

  it("returns a safe no-store preview bound to the path artifact id", async () => {
    const { GET } = await import(
      "../src/app/api/workspaces/[workspaceId]/artifacts/[artifactId]/route"
    );
    const item = await fixture();
    state.document = item.document;
    const encoded = Buffer.from(JSON.stringify(item.reference)).toString("base64url");
    const response = await GET(new NextRequest(`http://localhost/artifact?reference=${encoded}`), {
      params: Promise.resolve({ workspaceId: ids.workspace, artifactId: ids.artifact }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toMatchObject({ source_ref: item.reference });
    expect(state.bindingReads).toBe(1);
  });

  it("enqueues Artifact Export and does not render bytes in the request", async () => {
    const route = await import(
      "../src/app/api/workspaces/[workspaceId]/artifacts/[artifactId]/exports/route"
    );
    const item = await fixture();
    state.document = item.document;
    const context = {
      params: Promise.resolve({ workspaceId: ids.workspace, artifactId: ids.artifact }),
    };
    const created = await route.POST(
      new NextRequest("http://localhost/exports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schema_version: "artifact-export-command@1.0.0",
          source_ref: item.reference,
          format: "CSV",
          filename_stem: "safe-results",
          idempotency_key: "artifact-export-route-0001",
        }),
      }),
      context,
    );
    expect(created.status).toBe(202);
    await expect(created.json()).resolves.toMatchObject({
      disposition: "CREATED",
      job: { job_id: "00000000-0000-4000-8000-000000007305" },
    });
    expect(state.enqueues).toBe(1);
    expect(state.creates).toBe(0);
    expect(state.resolves).toBe(0);
    expect(state.accesses).toEqual(["WRITE"]);
  });

  it("rejects a cross-workspace source before repository access", async () => {
    const { GET } = await import(
      "../src/app/api/workspaces/[workspaceId]/artifacts/[artifactId]/route"
    );
    const item = await fixture();
    const encoded = Buffer.from(
      JSON.stringify({
        ...item.reference,
        tenant_id: "00000000-0000-4000-8000-000000007399",
      }),
    ).toString("base64url");
    const response = await GET(new NextRequest(`http://localhost/artifact?reference=${encoded}`), {
      params: Promise.resolve({ workspaceId: ids.workspace, artifactId: ids.artifact }),
    });
    expect(response.status).toBe(400);
    expect(state.resolves).toBe(0);
    expect(state.bindingReads).toBe(0);
  });

  it("denies preview when the Run binding belongs to a trashed conversation", async () => {
    const { GET } = await import(
      "../src/app/api/workspaces/[workspaceId]/artifacts/[artifactId]/route"
    );
    const item = await fixture();
    state.document = item.document;
    state.bindingAvailable = false;
    const encoded = Buffer.from(JSON.stringify(item.reference)).toString("base64url");

    const response = await GET(new NextRequest(`http://localhost/artifact?reference=${encoded}`), {
      params: Promise.resolve({ workspaceId: ids.workspace, artifactId: ids.artifact }),
    });

    expect(response.status).toBe(400);
    expect(state.bindingReads).toBe(1);
    expect(state.resolves).toBe(0);
  });
});
