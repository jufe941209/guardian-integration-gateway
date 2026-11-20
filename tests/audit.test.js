import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { encrypt, decrypt, resolveKey } from '../src/crypto.js';
import { AuditLog } from '../src/auditLog.js';

const key = crypto.randomBytes(32);

test('encrypt/decrypt roundtrip', () => {
  const payload = encrypt('secret: 4111 1111 1111 1111', key);
  assert.equal(decrypt(payload, key), 'secret: 4111 1111 1111 1111');
  assert.ok(!JSON.stringify(payload).includes('4111'));
});

test('same plaintext produces different ciphertext (random IV)', () => {
  assert.notEqual(encrypt('hello', key).data, encrypt('hello', key).data);
});

test('tampered ciphertext is detected', () => {
  const payload = encrypt('hello world', key);
  const bytes = Buffer.from(payload.data, 'base64');
  bytes[0] ^= 0xff;
  assert.throws(() => decrypt({ ...payload, data: bytes.toString('base64') }, key));
});

test('wrong key cannot decrypt', () => {
  const payload = encrypt('hello', key);
  assert.throws(() => decrypt(payload, crypto.randomBytes(32)));
});

test('resolveKey validates the hex format', () => {
  assert.throws(() => resolveKey('not-hex'), /64 hex/);
  assert.equal(resolveKey('ab'.repeat(32)).length, 32);
});

test('audit log keeps every entry under concurrent writes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'audit-'));
  const filePath = path.join(dir, 'log.json');
  const log = new AuditLog({ filePath, key });

  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      log.append({
        userId: `u${i}`,
        originalMessage: `mail me at user${i}@x.com`,
        redactedMessage: 'mail me at <REDACTED: EMAIL>',
        redactions: { EMAIL: 1, CREDIT_CARD: 0, SSN: 0 },
        outcome: 'answered',
      })
    )
  );

  const entries = JSON.parse(await readFile(filePath, 'utf8'));
  assert.equal(entries.length, 25);
  assert.equal(new Set(entries.map((e) => e.id)).size, 25);
  // The original is only recoverable by decrypting.
  const e = entries.find((x) => x.userId === 'u7');
  assert.equal(decrypt(e.originalMessageEncrypted, key), 'mail me at user7@x.com');
});
