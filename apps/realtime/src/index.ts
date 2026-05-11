import { createServer } from "./server.js";

const PORT = parseInt(process.env.PORT ?? "4000", 10);

const { httpServer } = createServer();

httpServer.listen(PORT, () => {
  console.log(`🚀 Realtime server running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   WebSocket:    ws://localhost:${PORT}`);
});
