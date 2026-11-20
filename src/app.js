import express from 'express';
import { sanitize } from './sanitizer.js';
import { CircuitOpenError } from './circuitBreaker.js';

const FALLBACK_MESSAGE = 'Service Busy';

function validate(body, config) {
  const errors = [];
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return ['Body must be a JSON object: { "userId": string, "message": string }'];
  }
  const { userId, message } = body;

  if (typeof userId !== 'string' || userId.trim() === '') {
    errors.push('userId must be a non-empty string');
  } else if (userId.length > config.maxUserIdLength) {
    errors.push(`userId must be at most ${config.maxUserIdLength} characters`);
  }

  if (typeof message !== 'string' || message.trim() === '') {
    errors.push('message must be a non-empty string');
  } else if (message.length > config.maxMessageLength) {
    errors.push(`message must be at most ${config.maxMessageLength} characters`);
  }
  return errors;
}

export function createApp({ aiClient, breaker, auditLog, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', circuit: breaker.state });
  });

  app.post('/secure-inquiry', async (req, res, next) => {
    try {
      const errors = validate(req.body, config);
      if (errors.length > 0) {
        return res.status(400).json({ error: 'invalid_request', details: errors });
      }

      const { userId, message } = req.body;

      // Step 1 - Sanitization. From here on, ONLY the redacted text is used.
      const { sanitized, redactions } = sanitize(message);

      // Step 2 - (Mock) AI call, protected by the circuit breaker.
      const simulateFailure =
        config.allowFailureSimulation && req.get('x-simulate-ai-failure') === 'true';

      let outcome = 'answered';
      let answer = null;
      let retryAfterMs = 0;
      try {
        answer = await breaker.exec(() => aiClient.generate(sanitized, { simulateFailure }));
      } catch (err) {
        if (err instanceof CircuitOpenError) {
          outcome = 'fallback_circuit_open';
          retryAfterMs = err.retryAfterMs;
        } else {
          outcome = 'fallback_ai_failure';
        }
      }

      // Step 3 - Audit log: original (encrypted) + redacted (plaintext).
      // Fail closed: if we cannot audit, we do not answer.
      await auditLog.append({
        userId,
        originalMessage: message,
        redactedMessage: sanitized,
        redactions,
        outcome,
      });

      console.log(JSON.stringify({ event: 'secure-inquiry', userId, outcome, redactions }));

      if (outcome === 'answered') {
        return res.status(200).json({ answer, redactedMessage: sanitized, redactions });
      }

      if (retryAfterMs > 0) res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      return res.status(503).json({
        message: FALLBACK_MESSAGE,
        reason: outcome === 'fallback_circuit_open' ? 'circuit_open' : 'ai_call_failed',
        circuit: breaker.state,
      });
    } catch (err) {
      next(err);
    }
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid_json' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'payload_too_large' });
    }
    // Never log the request body here: it may contain unredacted PII.
    console.error('[error]', err.name, err.message);
    return res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
