import { parseEnv, realtimeEnvSchema } from "@anidraft/shared/env";
import { createServer } from "./server.js";

// Fail fast on a missing/malformed environment before binding the port.
const env = parseEnv(realtimeEnvSchema);

const { httpServer } = createServer();

httpServer.listen(env.PORT, () => {
  console.log(`🚀 Realtime server running on port ${env.PORT}`);
  console.log(`   Health check: http://localhost:${env.PORT}/health`);
  console.log(`   WebSocket:    ws://localhost:${env.PORT}`);
});
