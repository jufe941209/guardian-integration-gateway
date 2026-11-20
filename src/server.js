import { loadConfig } from './config.js';
import { resolveKey } from './crypto.js';
import { AuditLog } from './auditLog.js';
import { CircuitBreaker } from './circuitBreaker.js';
import { MockAiClient } from './mockAi.js';
import { createApp } from './app.js';

const config = loadConfig();

const app = createApp({
  config,
  aiClient: new MockAiClient({
    delayMs: config.aiDelayMs,
    failureDelayMs: config.aiFailureDelayMs,
    timeoutMs: config.aiTimeoutMs,
  }),
  breaker: new CircuitBreaker({
    failureThreshold: config.breakerFailureThreshold,
    resetTimeoutMs: config.breakerResetMs,
  }),
  auditLog: new AuditLog({
    filePath: config.auditLogPath,
    key: resolveKey(config.encryptionKeyHex),
  }),
});

const server = app.listen(config.port, () => {
  console.log(`Guardian Gateway listening on http://localhost:${config.port}`);
});

// Graceful shutdown (Docker sends SIGTERM on `docker stop`).
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down...`);
    server.close(() => process.exit(0));
  });
}
