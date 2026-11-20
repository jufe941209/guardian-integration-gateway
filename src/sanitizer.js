// PII sanitizer: replaces emails, credit card numbers and SSNs with
// "<REDACTED: TYPE>" tokens.
//
// Design notes
// - Order matters: emails first (they may contain digits), then cards (13-19
//   digits), then SSNs (exactly 9 digits). Cards go before SSNs so that a long
//   card number is never partially matched as an SSN.
// - Lookarounds `(?<!\d)` / `(?!\d)` make sure we only match a *whole* run of
//   digits (a 12-digit id is not "an SSN plus 3 digits").
// - Fail-safe bias: any 13-19 digit run (spaces/dashes allowed) is treated as a
//   card, with no Luhn check. We would rather over-redact than leak PII.
//   Trade-off: long numeric ids (e.g. a 13-digit timestamp) can be redacted too.

const PATTERNS = [
  {
    type: 'EMAIL',
    regex: /(?<![\w.%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/g,
  },
  {
    type: 'CREDIT_CARD',
    // 13 to 19 digits, optionally separated by single spaces or dashes.
    regex: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g,
  },
  {
    type: 'SSN',
    // 9 digits: 123-45-6789, 123 45 6789 or 123456789.
    regex: /(?<!\d)\d{3}[- ]?\d{2}[- ]?\d{4}(?!\d)/g,
  },
];

export const REDACTION_TYPES = PATTERNS.map((p) => p.type);

export function sanitize(input) {
  if (typeof input !== 'string') {
    throw new TypeError('sanitize() expects a string');
  }

  const redactions = Object.fromEntries(REDACTION_TYPES.map((t) => [t, 0]));
  let sanitized = input;

  for (const { type, regex } of PATTERNS) {
    sanitized = sanitized.replace(regex, () => {
      redactions[type] += 1;
      return `<REDACTED: ${type}>`;
    });
  }

  const total = Object.values(redactions).reduce((a, b) => a + b, 0);
  return { sanitized, redactions, total };
}
