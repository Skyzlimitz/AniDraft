import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

export function createServer() {
  const httpServer = http.createServer((req, res) => {
    // Health check endpoint
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
      return;
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws: WebSocket) => {
    console.log("Client connected");

    // Send hello message on connection
    ws.send(JSON.stringify({ type: "hello", message: "Connected to AniDraft realtime server" }));

    ws.on("message", (data: Buffer) => {
      const message = data.toString();
      console.log("Received:", message);

      // Echo for now — draft protocol will be implemented in a separate issue
      ws.send(JSON.stringify({ type: "echo", data: message }));
    });

    ws.on("close", () => {
      console.log("Client disconnected");
    });

    ws.on("error", (error: Error) => {
      console.error("WebSocket error:", error.message);
    });
  });

  return { httpServer, wss };
}
