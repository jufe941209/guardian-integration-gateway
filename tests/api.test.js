import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { CircuitBreaker } from '../src/circuitBreaker.js';
import { MockAiClient } from '../src/mockAi.js';
import { AuditLog } from '../src/auditLog.js';
import { decrypt } from '../src/crypto.js';

const key = crypto.randomBytes(32);
let dir;
let counter = 0;

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'gateway-'));
});
after(() => rm(dir, { recursive: true, force: true }));

// Spins up an isolated server (own breaker + own audit file) on a random port.
async function startServer({ aiDelayMs = 20, aiClient } = {}) {
  const auditPath = path.join(dir, `audit-${counter++}.json`);
  const config = loadConfig({ MOCK_AI_DELAY_MS: String(aiDelayMs), MOCK_AI_FAILURE_DELAY_MS: '5' });
  const calls = [];
  const client =
    aiClient ??
    (() => {
      const real = new MockAiClient({
        delayMs: config.aiDelayMs,
        failureDelayMs: config.aiFailureDelayMs,
        timeoutMs: config.aiTimeoutMs,
      });
      return {
        generate: (msg, opts) => {
          calls.push(msg);
          return real.generate(msg, opts);
        },
      };
    })();

  const app = createApp({
    config,
    aiClient: client,
    breaker: new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60_000 }),
    auditLog: new AuditLog({ filePath: auditPath, key }),
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) =>
    fetch(`${baseUrl}/secure-inquiry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  return { post, calls, auditPath, baseUrl, close: () => new Promise((r) => server.close(r)) };
}

test('happy path: redacts PII, sends ONLY redacted text to the AI, returns the answer', async () => {
  const s = await startServer();
  try {
    const res = await s.post({
      userId: 'u1',
      message: 'My email is jane@corp.com, card 4111 1111 1111 1111, ssn 123-45-6789',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.answer, 'Generated Answer');
    assert.equal(
      body.redactedMessage,
      'My email is <REDACTED: EMAIL>, card <REDACTED: CREDIT_CARD>, ssn <REDACTED: SSN>'
    );
    // The AI provider never saw the raw PII.
    assert.equal(s.calls.length, 1);
    assert.ok(!/jane@corp\.com|4111|123-45-6789/.test(s.calls[0]));
  } finally {
    await s.close();
  }
});

test('audit log: original is encrypted at rest, redacted is plaintext', async () => {
  const s = await startServer();
  try {
    const original = 'ping me at jane@corp.com';
    await s.post({ userId: 'u2', message: original });

    const raw = await readFile(s.auditPath, 'utf8');
    assert.ok(!raw.includes('jane@corp.com'), 'raw PII must not appear in the audit file');

    const [entry] = JSON.parse(raw);
    assert.equal(entry.userId, 'u2');
    assert.equal(entry.redactedMessage, 'ping me at <REDACTED: EMAIL>');
    assert.equal(decrypt(entry.originalMessageEncrypted, key), original);
    assert.equal(entry.outcome, 'answered');
  } finally {
    await s.close();
  }
});

test('validation: rejects bad bodies with 400', async () => {
  const s = await startServer();
  try {
    for (const body of [{}, { userId: 'u' }, { message: 'hi' }, { userId: 1, message: 'hi' }, { userId: 'u', message: '   ' }, []]) {
      const res = await s.post(body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    const invalidJson = await s.post('{not json');
    assert.equal(invalidJson.status, 400);
    assert.equal((await invalidJson.json()).error, 'invalid_json');
  } finally {
    await s.close();
  }
});

test('circuit breaker: after 3 consecutive AI failures the API answers "Service Busy" INSTANTLY', async () => {
  // AI delay is 2s on purpose: if the 4th request waited for the AI, this test would be slow.
  const s = await startServer({ aiDelayMs: 2000 });
  try {
    for (let i = 1; i <= 3; i++) {
      const res = await s.post({ userId: 'u', message: 'hello' }, { 'x-simulate-ai-failure': 'true' });
      assert.equal(res.status, 503);
      assert.equal((await res.json()).reason, 'ai_call_failed');
    }
    assert.equal(s.calls.length, 3);

    const started = performance.now();
    const res = await s.post({ userId: 'u', message: 'hello again' }); // no failure header
    const elapsed = performance.now() - started;

    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.message, 'Service Busy');
    assert.equal(body.reason, 'circuit_open');
    assert.ok(res.headers.get('retry-after'));
    assert.equal(s.calls.length, 3, 'AI must NOT be called while the circuit is open');
    assert.ok(elapsed < 500, `fallback took ${Math.round(elapsed)}ms, expected instant`);
  } finally {
    await s.close();
  }
});

test('the fallback path is still audited', async () => {
  const s = await startServer();
  try {
    for (let i = 0; i < 4; i++) {
      await s.post({ userId: 'u', message: 'mail a@b.com' }, { 'x-simulate-ai-failure': 'true' });
    }
    const entries = JSON.parse(await readFile(s.auditPath, 'utf8'));
    assert.deepEqual(
      entries.map((e) => e.outcome),
      ['fallback_ai_failure', 'fallback_ai_failure', 'fallback_ai_failure', 'fallback_circuit_open']
    );
  } finally {
    await s.close();
  }
});

test('an AI timeout counts as a failure', async () => {
  const slowClient = { generate: () => new MockAiClient({ delayMs: 1000, timeoutMs: 30 }).generate('x') };
  const s = await startServer({ aiClient: slowClient });
  try {
    const res = await s.post({ userId: 'u', message: 'hello' });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).reason, 'ai_call_failed');
  } finally {
    await s.close();
  }
});

test('unknown routes return 404 JSON and /health reports the circuit state', async () => {
  const s = await startServer();
  try {
    assert.equal((await fetch(`${s.baseUrl}/nope`)).status, 404);
    const health = await (await fetch(`${s.baseUrl}/health`)).json();
    assert.deepEqual(health, { status: 'ok', circuit: 'CLOSED' });
  } finally {
    await s.close();
  }
});
