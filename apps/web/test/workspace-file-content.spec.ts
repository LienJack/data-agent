import { describe, expect, it, vi } from "vitest";
import { observeWorkspaceFileContent } from "../src/lib/workspace-file-content";

vi.mock("server-only", () => ({}));

describe("Workspace file content observation", () => {
  it("ignores the browser MIME claim and detects bytes server-side", async () => {
    const observed = await observeWorkspaceFileContent(
      new File(["hello"], "spoofed.pdf", { type: "application/pdf" }),
    );
    expect(observed.detected_mime).toBe("text/plain");
    expect(observed.byte_size).toBe(5);
    expect(observed.blob_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("detects supported signatures and rejects empty or opaque binary input", async () => {
    await expect(
      observeWorkspaceFileContent(new File(["%PDF-1.7\nfixture"], "report.bin")),
    ).resolves.toMatchObject({ detected_mime: "application/pdf" });
    await expect(observeWorkspaceFileContent(new File([], "empty.txt"))).rejects.toThrow(
      "WORKSPACE_FILE_SIZE_INVALID",
    );
    await expect(
      observeWorkspaceFileContent(new File([new Uint8Array([0xff, 0xfe, 0xfd])], "opaque.bin")),
    ).rejects.toThrow("WORKSPACE_FILE_MIME_UNSUPPORTED");
  });
});
