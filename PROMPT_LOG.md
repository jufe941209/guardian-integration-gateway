# Prompt Log: Guardian Integration Gateway

How I directed the AI (Claude) on this assignment, in order. Prompts are summarized
where they were long. Anything marked **[Julian: complete]** is for me to fill in with what I
actually did or changed myself.

## Prompt 1: Context and constraints

> I pasted the full assignment brief (POST /secure-inquiry with `{ userId, message }`;
> sanitize emails, credit cards and SSNs into `<REDACTED: TYPE>`; mock AI call with a 2 s
> `setTimeout`; audit log with the original encrypted and the redacted in plaintext in a JSON
> file; circuit breaker that returns "Service Busy" instantly after 3 consecutive failures;
> Docker + video) and said I had until 2:00 AM to submit, with the frontend test already done.

**AI response / what it decided**

- Stack: Node.js + Express (closest to my day-to-day JavaScript), plain ESM, no
  extra test dependencies (`node:test`).
- Split into small modules (sanitizer, crypto, audit log, circuit breaker, mock AI, app) so
  each piece can be tested on its own.
- Built the whole project, 28 automated tests, Docker files, README, and a demo script.

## Security-logic decisions the AI made (reviewed by me)

| Topic | Decision | Why |
|---|---|---|
| Sanitizer order | emails → cards → SSN | an email can contain digits; a card must not be half-matched as SSN |
| Matching | lookarounds so only *whole* digit runs match | avoids redacting part of a 12-digit id |
| Cards | any 13–19 digits, no Luhn check | fail-safe: prefer over-redaction to leaking PII |
| Encryption | AES-256-GCM, random IV per entry | confidentiality + tamper detection |
| Data sent to the AI | redacted text only | provider never sees raw PII |
| Audit writes | serialized queue + temp file + rename | no lost entries under concurrency |
| Audit failure | respond 500 (fail closed) | never answer an unaudited request |
| Circuit breaker | CLOSED → OPEN after 3 consecutive failures → HALF_OPEN with a single trial | open state rejects instantly, no waiting |
| Failure demo | `X-Simulate-AI-Failure: true` header | lets the 3 failures be triggered on demand for the video |

## Verification (what was actually run)

- `npm test`: 28 tests passing (sanitizer, circuit breaker incl. half-open, encryption and
  concurrent audit writes, HTTP end-to-end including "4th call returns Service Busy in < 500 ms
  while the AI would take 2 s" and "the AI is not called while the circuit is open").
- Live run with `npm run demo`: first call answered in ~2 s with all three PII types
  redacted; three failing calls opened the circuit; the next call returned `Service Busy`
  in ~3 ms.
- Inspected `data/audit-log.json`: no plaintext email or card number in the file; the original
  is only present as ciphertext.
- Docker: the image was built and run with `docker compose up --build` on my machine. My Windows image has no
  Hyper-V / VirtualMachinePlatform (so no Docker Desktop / WSL2); Claude Code diagnosed this and set up Docker
  Engine in a local Ubuntu VM (VirtualBox + Vagrant) with the project folder shared and port 3000 forwarded to
  `localhost`. The demo video shows the container answering on `http://localhost:3000`.

## My own follow-up prompts and changes

Second session (Claude Code in VS Code):

1. *"Make every point work and leave it running."* Claude re-ran the test suite (28/28 passing), found that the
   git repo was accidentally rooted at my user folder and created a project-local repo instead.
2. Docker was missing. Claude tried WSL2 + Docker Desktop, diagnosed error `0x800f080c` and that Hyper-V /
   VirtualMachinePlatform are not present in my Windows image, and proposed VirtualBox + Vagrant as a Docker host
   without a reboot. I approved the installs (UAC) and the GitHub CLI login.
3. Added `.gitattributes` (LF endings so files behave the same inside the Linux container).
4. Claude scripted the demo session (tests -> `docker compose up --build` -> health -> PII request ->
   circuit-breaker sequence -> audit log check -> container logs) and recorded it with ffmpeg: `demo/demo.mp4`.
5. I verified in the video: PII redacted, ~2 s AI answer, 4th call `Service Busy` in milliseconds, no raw
   PII in `data/audit-log.json`.

## What I would improve with more time

- Share breaker state between instances (Redis) and add rate limiting / authentication.
- Move the audit log to a real database with key management (KMS, rotation).
- Add NER-based detection for names and addresses on top of the regexes.
