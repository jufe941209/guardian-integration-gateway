import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

// Accepts a 64-char hex string (32 bytes). Without one we generate an
// ephemeral key so the app still starts for a quick demo, but entries written in
// a previous run could not be decrypted afterwards, so we warn loudly.
export function resolveKey(hex) {
  if (hex) {
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error('AUDIT_ENCRYPTION_KEY must be 64 hex characters (32 bytes).');
    }
    return Buffer.from(hex, 'hex');
  }
  console.warn(
    '[crypto] AUDIT_ENCRYPTION_KEY is not set: using an EPHEMERAL key. ' +
      'Audit entries will not be decryptable after a restart. Set the variable for real use.'
  );
  return crypto.randomBytes(32);
}

// AES-256-GCM: confidentiality + integrity (the auth tag detects tampering).
// A fresh random 12-byte IV is generated per message.
export function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    alg: ALGORITHM,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function decrypt(payload, key) {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(payload.data, 'base64')),
    decipher.final(), // throws if the data or tag was modified
  ]);
  return plain.toString('utf8');
}
