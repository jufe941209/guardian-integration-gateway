// Simulates an external AI provider.
//  - success: resolves "Generated Answer" after `delayMs` (2 s by default)
//  - failure: rejects after `failureDelayMs` (only when `simulateFailure` is set)
//  - timeout: if the provider takes longer than `timeoutMs`, that also counts as a failure

export class AiProviderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export class MockAiClient {
  constructor({ delayMs = 2000, failureDelayMs = 300, timeoutMs = 5000 } = {}) {
    this.delayMs = delayMs;
    this.failureDelayMs = failureDelayMs;
    this.timeoutMs = timeoutMs;
  }

  generate(_redactedMessage, { simulateFailure = false } = {}) {
    return new Promise((resolve, reject) => {
      const timers = [];

      const finish = (fn, value) => {
        timers.forEach(clearTimeout);
        fn(value);
      };

      timers.push(setTimeout(() => finish(reject, new AiProviderError('AI provider timed out')), this.timeoutMs));

      if (simulateFailure) {
        timers.push(
          setTimeout(() => finish(reject, new AiProviderError('AI provider error')), this.failureDelayMs)
        );
      } else {
        timers.push(setTimeout(() => finish(resolve, 'Generated Answer'), this.delayMs));
      }
    });
  }
}
