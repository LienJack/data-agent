import {
  type ArtifactWorkspaceTableProjection,
  computeArtifactWorkspaceDocumentHash,
} from "@data-agent/contracts";
import { describe, expect, it } from "vitest";
import {
  neutralizeSpreadsheetFormula,
  projectArtifactDocument,
  renderArtifactExport,
} from "@/lib/artifact-workspace-service";

const sourceRef = {
  artifact_id: "00000000-0000-4000-8000-000000007201",
  artifact_type: "ArtifactWorkspaceDocument" as const,
  app_id: "00000000-0000-4000-8000-00000000da01",
  tenant_id: "00000000-0000-4000-8000-000000007202",
  environment: "test",
  run_id: "00000000-0000-4000-8000-000000007203",
  revision: 1,
  content_hash: `sha256:${"0".repeat(64)}` as const,
};

const table: ArtifactWorkspaceTableProjection = {
  kind: "TABLE",
  columns: [
    { key: "name", label: "Name", data_type: "STRING" },
    { key: "value", label: "Value", data_type: "MIXED" },
  ],
  rows: [
    { name: "safe", value: 3 },
    { name: "formula", value: ' \t=HYPERLINK("https://evil.invalid")' },
  ],
  total_rows: 2,
};

async function document() {
  const draft = {
    schema_version: "artifact-workspace-document@1.0.0" as const,
    document_ref: sourceRef,
    projection: table,
  };
  const contentHash = await computeArtifactWorkspaceDocumentHash(draft);
  return {
    ...draft,
    document_ref: { ...sourceRef, content_hash: contentHash },
  };
}

function storedZipEntries(bytes: Uint8Array): Map<string, string> {
  const entries = new Map<string, string>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= bytes.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    entries.set(name, decoder.decode(bytes.slice(dataStart, dataStart + compressedSize)));
    offset = dataStart + compressedSize;
  }
  return entries;
}

describe("Artifact workspace renderer", () => {
  it("binds preview to the exact committed source ref and keeps pagination non-authoritative", async () => {
    const committed = await document();
    const preview = await projectArtifactDocument(committed, committed.document_ref, {
      offset: 1,
      limit: 1,
    });
    expect(preview.source_ref).toEqual(committed.document_ref);
    expect(preview.viewport).toEqual({ offset: 1, limit: 1, total_rows: 2, truncated: true });
    expect(preview.projection).toMatchObject({ kind: "TABLE", rows: [table.rows[1]] });

    await expect(
      projectArtifactDocument(
        committed,
        { ...committed.document_ref, revision: 2 },
        { offset: 0, limit: 10 },
      ),
    ).rejects.toThrow("ARTIFACT_SOURCE_IDENTITY_MISMATCH");
  });

  it("neutralizes spreadsheet formulas after leading whitespace/control characters", () => {
    expect(neutralizeSpreadsheetFormula("=1+1")).toBe("'=1+1");
    expect(neutralizeSpreadsheetFormula(" \t@cmd")).toBe("' \t@cmd");
    expect(neutralizeSpreadsheetFormula("ordinary")).toBe("ordinary");
  });

  it("produces deterministic CSV and real deterministic XLSX bytes from the same table", async () => {
    const csv = await renderArtifactExport(table, "CSV", "results");
    const csvAgain = await renderArtifactExport(table, "CSV", "results");
    expect(csv.output_hash).toBe(csvAgain.output_hash);
    expect(new TextDecoder().decode(csv.bytes)).toContain("' \t=HYPERLINK");
    expect(csv.mime_type).toBe("text/csv; charset=utf-8");

    const xlsx = await renderArtifactExport(table, "XLSX", "results");
    const xlsxAgain = await renderArtifactExport(table, "XLSX", "results");
    expect([...xlsx.bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(xlsx.output_hash).toBe(xlsxAgain.output_hash);
    expect(xlsx.attachment_filename).toBe("results.xlsx");
    const entries = storedZipEntries(xlsx.bytes);
    expect([...entries.keys()]).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    expect(entries.get("xl/worksheets/sheet1.xml")).toContain(
      "&apos; \t=HYPERLINK(&quot;https://evil.invalid&quot;)",
    );
    await expect(renderArtifactExport(table, "CSV", "../unsafe")).rejects.toThrow();
  });

  it("keeps untrusted markup as text and rejects dangerous links in the contract", async () => {
    const committed = await document();
    const unsafe = {
      ...committed,
      projection: {
        kind: "MARKDOWN",
        plain_text: "<script>alert(1)</script>",
        links: [{ label: "bad", href: "javascript:alert(1)" }],
      },
    };
    await expect(
      projectArtifactDocument(unsafe, committed.document_ref, { offset: 0, limit: 10 }),
    ).rejects.toThrow();
  });
});
