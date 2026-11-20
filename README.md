# Guardian Integration Gateway

A small secure middleware service (Node.js + Express) that sits between a client and an AI provider.

`POST /secure-inquiry` accepts `{ "userId": string, "message": string }` and:

1. **Sanitizes** the message: emails, credit cards and SSNs are replaced by `<REDACTED: EMAIL | CREDIT_CARD | SSN>`.
2. **Calls a mock AI** (2 s delay via `setTimeout`) with the *redacted* text only, and returns a "Generated Answer".
3. **Writes an audit log** to a JSON file: the original message **encrypted** (AES-256-GCM) and the redacted message in **plaintext**.
4. **Circuit breaker**: after **3 consecutive** AI failures the API returns the fallback `Service Busy` **instantly**, without calling the AI or waiting for any timeout.

## Demo video

[`demo/demo.mp4`](demo/demo.mp4): tests, `docker compose up --build`, a request with email + card + SSN being redacted (~2 s mock AI answer), three AI failures opening the circuit, the 4th call returning `Service Busy` in ~24 ms, and the audit log showing the original encrypted (no raw PII on disk) and the redacted text in plaintext.

> Recorded on Windows where Hyper-V/WSL2 are unavailable, so Docker Engine runs in a local Ubuntu VM (VirtualBox) with port 3000 forwarded to `localhost`. Any Docker host works the same way.

## Run it

### Option A: Docker (recommended)

```bash
docker compose up --build
```

The API is on `http://localhost:3000`. The audit log appears in `./data/audit-log.json` on your machine.

### Option B: Node 20+ locally

```bash
npm install
npm start
```

### Run the tests

```bash
npm test
```

28 tests cover the sanitizer, the circuit breaker (including half-open), encryption/audit log (including concurrent writes) and the HTTP API end to end.

## Try it

**macOS / Linux / Git Bash**

```bash
curl -s -X POST http://localhost:3000/secure-inquiry \
  -H "Content-Type: application/json" \
  -d '{"userId":"u1","message":"Hi, I am jane@corp.com, card 4111 1111 1111 1111, SSN 123-45-6789"}'
```

**Windows PowerShell**

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3000/secure-inquiry `
  -ContentType "application/json" `
  -Body '{"userId":"u1","message":"Hi, I am jane@corp.com, card 4111 1111 1111 1111, SSN 123-45-6789"}'
```

Response (after ~2 s):

```json
{
  "answer": "Generated Answer",
  "redactedMessage": "Hi, I am <REDACTED: EMAIL>, card <REDACTED: CREDIT_CARD>, SSN <REDACTED: SSN>",
  "redactions": { "EMAIL": 1, "CREDIT_CARD": 1, "SSN": 1 }
}
```

### See the circuit breaker in action

The mock AI can be forced to fail with the header `X-Simulate-AI-Failure: true` (enabled by `ALLOW_FAILURE_SIMULATION`, on by default for this assessment).

Easiest: with the server running, execute the scripted demo (it prints status codes and timings):

```bash
npm run demo
```

What you will see: a normal answer (~2 s) → three failing calls (`503`, circuit goes `OPEN`) → the next call returns `503 Service Busy` in a few milliseconds.

| Situation | HTTP | Body |
|---|---|---|
| OK | 200 | `{ answer, redactedMessage, redactions }` |
| Invalid body / JSON | 400 | `{ error, details }` |
| AI call failed (circuit still closed) | 503 | `{ message: "Service Busy", reason: "ai_call_failed", circuit }` |
| Circuit open | 503 + `Retry-After` | `{ message: "Service Busy", reason: "circuit_open", circuit }` |

`GET /health` returns `{ status, circuit }`.

## Project layout

```
src/
  sanitizer.js       PII redaction (regex, ordered, whole-number matching)
  crypto.js          AES-256-GCM encrypt/decrypt helpers
  auditLog.js        JSON-file "database", serialized atomic writes
  circuitBreaker.js  CLOSED / OPEN / HALF_OPEN state machine
  mockAi.js          fake provider: 2 s delay, optional failure, timeout
  app.js             Express app (validation, flow, error handling)
  server.js          wiring + graceful shutdown
tests/               node:test suites (no extra test dependencies)
scripts/demo.js      scripted demo used for the video
Dockerfile, docker-compose.yml
```

## Configuration

See `.env.example`. Main variables: `AUDIT_ENCRYPTION_KEY` (64 hex chars), `MOCK_AI_DELAY_MS`, `BREAKER_FAILURE_THRESHOLD`, `BREAKER_RESET_MS`, `ALLOW_FAILURE_SIMULATION`.
Generate a key with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

If `AUDIT_ENCRYPTION_KEY` is not set locally, an ephemeral key is generated and a warning is printed (entries would not be decryptable after a restart). `docker-compose.yml` ships a **demo-only** key; replace it for anything real.

## Design decisions and trade-offs

- **Only redacted text leaves the service.** The AI provider never receives raw PII; the original exists only encrypted in the audit log.
- **Fail-safe redaction.** Any 13–19 digit run (spaces/dashes allowed) is treated as a card, without a Luhn check: I prefer over-redacting to leaking. Cost: long numeric ids (e.g. a 13-digit timestamp) can be redacted too. Cards are matched before SSNs so a card is never partially matched as an SSN, and digit runs of other lengths (phones, 12-digit ids) are left alone.
- **AES-256-GCM** with a random IV per entry gives confidentiality and tamper detection. Key management (KMS, rotation) is out of scope for a mock.
- **Audit writes are serialized** with a promise queue and use temp-file + rename, so concurrent requests don't lose entries and a crash can't leave half a JSON file. A real system would use a database.
- **Fail closed on audit.** If the audit entry cannot be written, the request returns `500` instead of answering unaudited.
- **Circuit breaker** counts *consecutive* failures (a success resets the counter); a timeout counts as a failure; after `BREAKER_RESET_MS` it goes HALF_OPEN and allows one trial call. The fallback paths are audited too (`outcome` field).
- The breaker state is in memory, per instance. Several replicas would each have their own breaker (a shared store such as Redis would be needed to share it).
- No request body is ever written to the console logs.

## Known limitations

- Regex-based PII detection does not catch names, addresses or spelled-out numbers ("one two three...").
- Authentication / rate limiting are not part of the brief and are not implemented.
- The Docker setup was written and reviewed but **could not be built in the environment where this code was generated** (no Docker daemon available there). Everything else (tests and a live run of the demo) was executed. Please run `docker compose up --build` once locally before recording the video.
