import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../src/sanitizer.js';

test('redacts emails', () => {
  const { sanitized, redactions } = sanitize('Write to john.doe+test@mail.example.co.uk please');
  assert.equal(sanitized, 'Write to <REDACTED: EMAIL> please');
  assert.equal(redactions.EMAIL, 1);
});

test('redacts credit cards with spaces, dashes and no separators', () => {
  for (const card of ['4111 1111 1111 1111', '4111-1111-1111-1111', '4111111111111111', '3782 822463 10005']) {
    const { sanitized, redactions } = sanitize(`my card is ${card} thanks`);
    assert.equal(sanitized, 'my card is <REDACTED: CREDIT_CARD> thanks', `failed for ${card}`);
    assert.equal(redactions.CREDIT_CARD, 1);
  }
});

test('redacts SSNs: dashed, spaced and 9 plain digits', () => {
  for (const ssn of ['123-45-6789', '123 45 6789', '123456789']) {
    const { sanitized, redactions } = sanitize(`SSN: ${ssn}.`);
    assert.equal(sanitized, 'SSN: <REDACTED: SSN>.', `failed for ${ssn}`);
    assert.equal(redactions.SSN, 1);
  }
});

test('a 16-digit card is not mistaken for an SSN (and vice versa)', () => {
  const { sanitized, redactions } = sanitize('card 4111111111111111 ssn 123-45-6789');
  assert.equal(sanitized, 'card <REDACTED: CREDIT_CARD> ssn <REDACTED: SSN>');
  assert.deepEqual(redactions, { EMAIL: 0, CREDIT_CARD: 1, SSN: 1 });
});

test('handles several PII items of different types in one message', () => {
  const { sanitized, total } = sanitize(
    'Hi, I am ana@corp.io, card 5500-0000-0000-0004, ssn 987654321, backup bob@corp.io'
  );
  assert.equal(
    sanitized,
    'Hi, I am <REDACTED: EMAIL>, card <REDACTED: CREDIT_CARD>, ssn <REDACTED: SSN>, backup <REDACTED: EMAIL>'
  );
  assert.equal(total, 4);
});

test('an email containing a long digit run is redacted as an email, not as a card', () => {
  const { sanitized, redactions } = sanitize('user4111111111111111@mail.com');
  assert.equal(sanitized, '<REDACTED: EMAIL>');
  assert.deepEqual(redactions, { EMAIL: 1, CREDIT_CARD: 0, SSN: 0 });
});

test('does not touch harmless numbers', () => {
  const text = 'Order 12345, zip 90210, phone 3001234567, year 2026, total 1,234.56, id 123456789012';
  const { sanitized, total } = sanitize(text);
  assert.equal(sanitized, text);
  assert.equal(total, 0);
});

test('is idempotent: sanitizing already sanitized text changes nothing', () => {
  const once = sanitize('mail me at a@b.com, ssn 123-45-6789').sanitized;
  assert.equal(sanitize(once).sanitized, once);
});

test('throws on non-string input', () => {
  assert.throws(() => sanitize(null), TypeError);
  assert.throws(() => sanitize(42), TypeError);
});
