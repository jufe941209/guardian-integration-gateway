import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { encrypt } from './crypto.js';

// Mock "database": a JSON array in a file.
//   - originalMessage -> stored ENCRYPTED (AES-256-GCM)
//   - redactedMessage -> stored in plaintext
//
// Writes are serialized through a promise queue, otherwise two concurrent
// requests would both read the file, append, and the last write would win
// (lost entries). The file is replaced via temp file + rename so a crash
// mid-write cannot leave half a JSON document behind.
export class AuditLog {
  #queue = Promise.resolve();

  constructor({ filePath, key }) {
    this.filePath = filePath;
    this.key = key;
  }

  async append({ userId, originalMessage, redactedMessage, redactions, outcome }) {
    const entry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      userId,
      outcome, // answered | fallback_ai_failure | fallback_circuit_open
      originalMessageEncrypted: encrypt(originalMessage, this.key),
      redactedMessage,
      redactions,
    };

    const op = this.#queue.then(() => this.#write(entry));
    // Keep the queue alive even if this write fails; the caller still sees the error.
    this.#queue = op.catch(() => {});
    await op;
    return entry;
  }

  async readAll() {
    try {
      return JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async #write(entry) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const entries = await this.readAll();
    entries.push(entry);
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(entries, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
  }
}
