import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createClamAvInstreamClient } from "../../src/storage/clamav-client.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function fakeClamAv(scanResponse: string) {
  const server = createServer((socket) => {
    let payload = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      payload = Buffer.concat([payload, Buffer.from(chunk)]);
      if (payload.subarray(0, 9).toString() === "zVERSION\0") {
        socket.end("ClamAV 1.4.5/28123/Sun Aug 17 07:00:00 2026\0");
        return;
      }
      if (payload.subarray(0, 10).toString() !== "zINSTREAM\0") return;
      let offset = 10;
      while (offset + 4 <= payload.length) {
        const length = payload.readUInt32BE(offset);
        if (length === 0) {
          socket.end(`${scanResponse}\0`);
          return;
        }
        if (offset + 4 + length > payload.length) return;
        offset += 4 + length;
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fake ClamAV did not bind");
  return address.port;
}

describe("ClamAV INSTREAM client", () => {
  it("marks a complete protocol response clean and preserves signature identity", async () => {
    const port = await fakeClamAv("stream: OK");
    const client = createClamAvInstreamClient({
      host: "127.0.0.1",
      port,
      timeout_ms: 1_000,
      max_bytes: 1024,
    });
    await expect(client.scan(new TextEncoder().encode("hello"))).resolves.toMatchObject({
      status: "CLEAN",
      engine_version: "1.4.5",
      signature_version: "28123",
      malware_name: null,
    });
  });

  it("returns only a bounded malware name for an infected response", async () => {
    const port = await fakeClamAv(`stream: ${"X".repeat(300)} FOUND`);
    const client = createClamAvInstreamClient({
      host: "127.0.0.1",
      port,
      timeout_ms: 1_000,
      max_bytes: 1024,
    });
    const result = await client.scan(new Uint8Array([1]));
    expect(result.status).toBe("INFECTED");
    expect(result.malware_name).toHaveLength(256);
  });
});
