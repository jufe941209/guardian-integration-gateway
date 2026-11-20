// Circuit breaker with the classic three states:
//
//   CLOSED     normal operation, calls go through. Consecutive failures are counted.
//   OPEN       after N consecutive failures: calls are rejected INSTANTLY
//              (CircuitOpenError) without touching the provider.
//   HALF_OPEN  after `resetTimeoutMs`, ONE trial call is allowed. If it succeeds
//              the circuit closes; if it fails the circuit opens again.

export const STATE = Object.freeze({
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
});

export class CircuitOpenError extends Error {
  constructor(retryAfterMs) {
    super('Circuit is open');
    this.name = 'CircuitOpenError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class CircuitBreaker {
  #state = STATE.CLOSED;
  #failures = 0;
  #openedAt = 0;
  #probeInFlight = false;

  constructor({ failureThreshold = 3, resetTimeoutMs = 15000, now = () => Date.now() } = {}) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this.now = now;
  }

  get state() {
    return this.#state;
  }

  get consecutiveFailures() {
    return this.#failures;
  }

  async exec(fn) {
    if (this.#state === STATE.OPEN) {
      const elapsed = this.now() - this.#openedAt;
      if (elapsed >= this.resetTimeoutMs) {
        this.#state = STATE.HALF_OPEN;
        this.#probeInFlight = false;
      } else {
        throw new CircuitOpenError(this.resetTimeoutMs - elapsed);
      }
    }

    if (this.#state === STATE.HALF_OPEN) {
      // Only one trial request at a time; everyone else fails fast.
      if (this.#probeInFlight) throw new CircuitOpenError(this.resetTimeoutMs);
      this.#probeInFlight = true;
    }

    try {
      const result = await fn();
      this.#onSuccess();
      return result;
    } catch (err) {
      this.#onFailure();
      throw err;
    }
  }

  #onSuccess() {
    this.#failures = 0;
    this.#probeInFlight = false;
    this.#state = STATE.CLOSED;
  }

  #onFailure() {
    this.#failures += 1;
    this.#probeInFlight = false;
    if (this.#state === STATE.HALF_OPEN || this.#failures >= this.failureThreshold) {
      this.#state = STATE.OPEN;
      this.#openedAt = this.now();
    }
  }
}
