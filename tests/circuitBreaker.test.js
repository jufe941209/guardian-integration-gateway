import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker, CircuitOpenError, STATE } from '../src/circuitBreaker.js';

const fail = () => Promise.reject(new Error('boom'));
const ok = () => Promise.resolve('fine');

function makeBreaker() {
  let t = 1_000;
  const breaker = new CircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 10_000, now: () => t });
  return { breaker, advance: (ms) => (t += ms) };
}

test('stays closed below the threshold', async () => {
  const { breaker } = makeBreaker();
  await assert.rejects(breaker.exec(fail), /boom/);
  await assert.rejects(breaker.exec(fail), /boom/);
  assert.equal(breaker.state, STATE.CLOSED);
});

test('opens after 3 consecutive failures and then rejects instantly without calling fn', async () => {
  const { breaker } = makeBreaker();
  for (let i = 0; i < 3; i++) await assert.rejects(breaker.exec(fail), /boom/);
  assert.equal(breaker.state, STATE.OPEN);

  let called = false;
  await assert.rejects(
    breaker.exec(async () => {
      called = true;
    }),
    CircuitOpenError
  );
  assert.equal(called, false);
});

test('a success resets the consecutive failure counter', async () => {
  const { breaker } = makeBreaker();
  await assert.rejects(breaker.exec(fail));
  await assert.rejects(breaker.exec(fail));
  await breaker.exec(ok);
  await assert.rejects(breaker.exec(fail));
  await assert.rejects(breaker.exec(fail));
  assert.equal(breaker.state, STATE.CLOSED); // 2 failures after the reset, not 3
});

test('half-open: a successful trial closes the circuit', async () => {
  const { breaker, advance } = makeBreaker();
  for (let i = 0; i < 3; i++) await assert.rejects(breaker.exec(fail));
  advance(10_000);
  assert.equal(await breaker.exec(ok), 'fine');
  assert.equal(breaker.state, STATE.CLOSED);
});

test('half-open: a failed trial opens the circuit again', async () => {
  const { breaker, advance } = makeBreaker();
  for (let i = 0; i < 3; i++) await assert.rejects(breaker.exec(fail));
  advance(10_000);
  await assert.rejects(breaker.exec(fail), /boom/);
  assert.equal(breaker.state, STATE.OPEN);
  await assert.rejects(breaker.exec(ok), CircuitOpenError);
});

test('half-open lets only ONE trial call through at a time', async () => {
  const { breaker, advance } = makeBreaker();
  for (let i = 0; i < 3; i++) await assert.rejects(breaker.exec(fail));
  advance(10_000);

  let release;
  const slow = new Promise((resolve) => (release = resolve));
  const trial = breaker.exec(() => slow);
  await assert.rejects(breaker.exec(ok), CircuitOpenError); // second caller is rejected
  release('done');
  assert.equal(await trial, 'done');
});
