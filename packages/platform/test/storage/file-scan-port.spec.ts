import { describe, expect, it, vi } from "vitest";
import { createFileScanPort } from "../../src/storage/file-scan-port.js";

const scanner = {
  scan: vi.fn(async () => ({
    status: "CLEAN" as const,
    engine_version: "1.4.2",
    signature_version: "20260817",
    signature_observed_at: "2026-08-17T11:59:00.000Z",
    malware_name: null,
  })),
};

describe("U6 file scan port", () => {
  it("combines ClamAV with local credential/content policy", async () => {
    const port = createFileScanPort({
      clamav: scanner,
      now: () => new Date("2026-08-17T12:00:00.000Z"),
      max_signature_age_ms: 86_400_000,
      policy_version: "workspace-file-policy@1.0.0",
    });
    await expect(
      port.scan({
        bytes: new TextEncoder().encode("ordinary quarterly report"),
        detected_mime: "text/plain",
      }),
    ).resolves.toMatchObject({ verdict: "CLEAN", credential_match_count: 0 });
    await expect(
      port.scan({
        bytes: new TextEncoder().encode("token=sk-abcdefghijklmnopqrstuvwxyz123456"),
        detected_mime: "text/plain",
      }),
    ).resolves.toMatchObject({ verdict: "CREDENTIAL_MATCH", credential_match_count: 1 });
  });

  it("fails closed for malware, stale signatures, unsupported MIME, and scanner errors", async () => {
    const malware = createFileScanPort({
      clamav: {
        scan: async () => ({
          status: "INFECTED",
          engine_version: "1.4.2",
          signature_version: "20260817",
          signature_observed_at: "2026-08-17T11:59:00.000Z",
          malware_name: "Eicar-Test-Signature",
        }),
      },
      now: () => new Date("2026-08-17T12:00:00.000Z"),
      max_signature_age_ms: 86_400_000,
      policy_version: "workspace-file-policy@1.0.0",
    });
    await expect(
      malware.scan({ bytes: new Uint8Array([1, 2, 3]), detected_mime: "application/pdf" }),
    ).resolves.toMatchObject({ verdict: "MALICIOUS" });

    const stale = createFileScanPort({
      clamav: {
        scan: async () => ({
          status: "CLEAN",
          engine_version: "1.4.2",
          signature_version: "old",
          signature_observed_at: "2026-08-10T00:00:00.000Z",
          malware_name: null,
        }),
      },
      now: () => new Date("2026-08-17T12:00:00.000Z"),
      max_signature_age_ms: 86_400_000,
      policy_version: "workspace-file-policy@1.0.0",
    });
    await expect(
      stale.scan({ bytes: new Uint8Array([1]), detected_mime: "application/pdf" }),
    ).resolves.toMatchObject({
      verdict: "UNKNOWN",
      stable_error_code: "FILE_SCANNER_SIGNATURE_STALE",
    });
    const futureDated = createFileScanPort({
      clamav: {
        scan: async () => ({
          status: "CLEAN",
          engine_version: "1.4.2",
          signature_version: "future",
          signature_observed_at: "2026-08-17T12:06:00.000Z",
          malware_name: null,
        }),
      },
      now: () => new Date("2026-08-17T12:00:00.000Z"),
      max_signature_age_ms: 86_400_000,
      policy_version: "workspace-file-policy@1.0.0",
    });
    await expect(
      futureDated.scan({ bytes: new Uint8Array([1]), detected_mime: "application/pdf" }),
    ).resolves.toMatchObject({
      verdict: "UNKNOWN",
      stable_error_code: "FILE_SCANNER_SIGNATURE_STALE",
    });
    const mimeBlocked = createFileScanPort({
      clamav: {
        scan: async () => ({
          status: "CLEAN",
          engine_version: "1.4.2",
          signature_version: "20260817",
          signature_observed_at: "2026-08-17T11:59:00.000Z",
          malware_name: null,
        }),
      },
      now: () => new Date("2026-08-17T12:00:00.000Z"),
      max_signature_age_ms: 86_400_000,
      policy_version: "workspace-file-policy@1.0.0",
    });
    await expect(
      mimeBlocked.scan({ bytes: new Uint8Array([1]), detected_mime: "application/x-executable" }),
    ).resolves.toMatchObject({
      verdict: "POLICY_BLOCKED",
      content_policy_findings: ["MIME_NOT_ALLOWED"],
    });

    const unavailable = createFileScanPort({
      clamav: { scan: async () => Promise.reject(new Error("private socket detail")) },
      now: () => new Date("2026-08-17T12:00:00.000Z"),
      max_signature_age_ms: 86_400_000,
      policy_version: "workspace-file-policy@1.0.0",
    });
    await expect(
      unavailable.scan({ bytes: new Uint8Array([1]), detected_mime: "application/pdf" }),
    ).resolves.toEqual({
      verdict: "UNKNOWN",
      stable_error_code: "FILE_SCANNER_UNAVAILABLE",
      scanner: null,
      credential_match_count: 0,
      content_policy_findings: [],
      malware_name: null,
    });
  });

  it("binds active PDF and suspicious OOXML rejection to deterministic scanner evidence", async () => {
    const clamav = {
      scan: vi.fn(async () => ({
        status: "CLEAN" as const,
        engine_version: "1.4.2",
        signature_version: "20260817",
        signature_observed_at: "2026-08-17T11:59:00.000Z",
        malware_name: null,
      })),
    };
    const port = createFileScanPort({
      clamav,
      now: () => new Date("2026-08-17T12:00:00.000Z"),
      max_signature_age_ms: 86_400_000,
      policy_version: "workspace-file-policy@1.0.0",
    });
    await expect(
      port.scan({
        bytes: new TextEncoder().encode("%PDF-1.7\n1 0 obj << /OpenAction 2 0 R >>"),
        detected_mime: "application/pdf",
      }),
    ).resolves.toMatchObject({
      verdict: "POLICY_BLOCKED",
      content_policy_findings: ["ACTIVE_CONTENT"],
    });

    const filename = new TextEncoder().encode("word/document.xml");
    const archive = new Uint8Array(46 + filename.byteLength + 22);
    const view = new DataView(archive.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint32(20, 1, true);
    view.setUint32(24, 300 * 1024 * 1024, true);
    view.setUint16(28, filename.byteLength, true);
    archive.set(filename, 46);
    const end = 46 + filename.byteLength;
    view.setUint32(end, 0x06054b50, true);
    view.setUint16(end + 10, 1, true);
    view.setUint32(end + 16, 0, true);
    await expect(
      port.scan({
        bytes: archive,
        detected_mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).resolves.toMatchObject({
      verdict: "POLICY_BLOCKED",
      content_policy_findings: ["ARCHIVE_BOMB_RISK"],
    });
    expect(clamav.scan).toHaveBeenCalledTimes(2);
  });
});
