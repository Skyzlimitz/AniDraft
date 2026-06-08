import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";

import { createServer } from "./server.js";

type ServerHandle = ReturnType<typeof createServer>;

let handle: ServerHandle;
let port: number;

beforeEach(async () => {
  handle = createServer();
  await new Promise<void>((resolve) => {
    // Port 0 lets the OS pick a free ephemeral port so tests never collide.
    handle.httpServer.listen(0, () => resolve());
  });
  port = (handle.httpServer.address() as AddressInfo).port;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    handle.wss.close();
    handle.httpServer.close((err) => (err ? reject(err) : resolve()));
  });
});

/** Open a ws client and collect the first `count` JSON messages it receives. */
function collectMessages(ws: WebSocket, count: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const messages: unknown[] = [];
    ws.on("message", (data: Buffer) => {
      messages.push(JSON.parse(data.toString()));
      if (messages.length >= count) resolve(messages);
    });
    ws.on("error", reject);
  });
}

describe("realtime server — health endpoint", () => {
  it("returns 200 OK with a JSON status payload on GET /health", async () => {
    const res = await fetch(`http://localhost:${port}/health`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = (await res.json()) as { status: string; timestamp: string };
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it("returns 404 for unknown routes", async () => {
    const res = await fetch(`http://localhost:${port}/does-not-exist`);
    expect(res.status).toBe(404);
  });
});

describe("realtime server — websocket handshake", () => {
  it("sends a hello message immediately on connection", async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const [hello] = await collectMessages(ws, 1);

    expect(hello).toMatchObject({ type: "hello" });

    ws.close();
  });

  it("echoes messages back to the sender", async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const received = collectMessages(ws, 2);

    await new Promise<void>((resolve) => ws.on("open", () => resolve()));
    ws.send("ping-test");

    const [hello, echo] = await received;
    expect(hello).toMatchObject({ type: "hello" });
    expect(echo).toEqual({ type: "echo", data: "ping-test" });

    ws.close();
  });
});
