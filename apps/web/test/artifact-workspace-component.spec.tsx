import type { ArtifactPreviewResult } from "@data-agent/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArtifactWorkspace } from "@/components/workbench/artifact-workspace";

const sourceRef = {
  artifact_id: "00000000-0000-4000-8000-000000007401",
  artifact_type: "ArtifactWorkspaceDocument" as const,
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: "00000000-0000-4000-8000-000000007402",
  environment: "test",
  run_id: "00000000-0000-4000-8000-000000007403",
  revision: 1,
  content_hash: `sha256:${"4".repeat(64)}` as const,
};

describe("ArtifactWorkspace", () => {
  it("renders untrusted markup as escaped text and exposes the exact source hash", () => {
    const preview: ArtifactPreviewResult = {
      schema_version: "artifact-preview-result@1.0.0",
      source_ref: sourceRef,
      renderer_version: "artifact-workspace-renderer@1.0.0",
      projection: {
        kind: "MARKDOWN",
        plain_text: '<script>alert("x")</script><img src=x onerror=alert(1)>',
        links: [{ label: "safe", href: "https://example.com/evidence" }],
      },
      viewport: { offset: 0, limit: 100, total_rows: null, truncated: false },
    };
    const markup = renderToStaticMarkup(<ArtifactWorkspace preview={preview} />);
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).not.toContain("<img");
    expect(markup).toContain(sourceRef.content_hash);
    expect(markup).toContain('rel="noreferrer noopener"');
  });

  it("cross-links report evidence with the complete immutable ArtifactReference", () => {
    const evidenceRef = {
      ...sourceRef,
      artifact_id: "00000000-0000-4000-8000-000000007499",
      artifact_type: "SqlArtifact" as const,
      revision: 3,
      content_hash: `sha256:${"9".repeat(64)}` as const,
    };
    const preview: ArtifactPreviewResult = {
      schema_version: "artifact-preview-result@1.0.0",
      source_ref: sourceRef,
      renderer_version: "artifact-workspace-renderer@1.0.0",
      projection: {
        kind: "REPORT",
        title: "Evidence report",
        sections: [{ heading: "Finding", body_text: "Text", source_refs: [evidenceRef] }],
      },
      viewport: { offset: 0, limit: 100, total_rows: null, truncated: false },
    };
    const markup = renderToStaticMarkup(<ArtifactWorkspace preview={preview} />);
    expect(markup).toContain(`/artifacts/${evidenceRef.artifact_id}?reference=`);
    const href = markup.match(/href="([^"]+\?reference=[^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
    expect(href).toBeDefined();
    const encodedReference = new URL(href ?? "", "http://localhost").searchParams.get("reference");
    expect(JSON.parse(encodedReference ?? "null")).toEqual(evidenceRef);
  });
});
