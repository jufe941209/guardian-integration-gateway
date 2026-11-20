// Central place for configuration. Everything can be overridden with env vars
// so the same code runs locally, in tests and in Docker.

const num = (value, fallback) => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

export function loadConfig(env = process.env) {
  return {
    port: num(env.PORT, 3000),

    // Audit log (mock database = a JSON file)
    auditLogPath: env.AUDIT_LOG_PATH || './data/audit-log.json',
    // 32 bytes as 64 hex chars. If missing, an ephemeral key is generated (dev only).
    encryptionKeyHex: env.AUDIT_ENCRYPTION_KEY || '',

    // Mock AI provider
    aiDelayMs: num(env.MOCK_AI_DELAY_MS, 2000), // the "2 seconds" from the spec
    aiFailureDelayMs: num(env.MOCK_AI_FAILURE_DELAY_MS, 300),
    aiTimeoutMs: num(env.AI_TIMEOUT_MS, 5000),

    // Circuit breaker
    breakerFailureThreshold: num(env.BREAKER_FAILURE_THRESHOLD, 3),
    breakerResetMs: num(env.BREAKER_RESET_MS, 15000),

    // Lets a demo force the mock AI to fail via the X-Simulate-AI-Failure header.
    // Turn it off (false) in anything that looks like production.
    allowFailureSimulation: env.ALLOW_FAILURE_SIMULATION !== 'false',

    // Input limits
    maxMessageLength: num(env.MAX_MESSAGE_LENGTH, 5000),
    maxUserIdLength: 128,
  };
}
