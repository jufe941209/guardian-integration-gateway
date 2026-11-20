// Demo for the video. Run the server first (npm start or docker compose up), then:
//   npm run demo
// Optional: BASE_URL=http://localhost:3000 npm run demo

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function call(title, message, headers = {}) {
  const started = performance.now();
  const res = await fetch(`${BASE_URL}/secure-inquiry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ userId: 'demo-user', message }),
  });
  const ms = Math.round(performance.now() - started);
  const body = await res.json();
  console.log(`\n=== ${title}`);
  console.log(`HTTP ${res.status}  (${ms} ms)`);
  console.log(JSON.stringify(body, null, 2));
}

const FAIL = { 'x-simulate-ai-failure': 'true' };

console.log(`Target: ${BASE_URL}`);

await call(
  '1) Sanitization: email + credit card + SSN get redacted (AI answers after ~2s)',
  'Hi, I am jane.doe@corp.com, my card is 4111 1111 1111 1111 and my SSN is 123-45-6789'
);

console.log('\n--- Now the mock AI starts failing ---');
await call('2) AI failure #1', 'hello', FAIL);
await call('3) AI failure #2', 'hello', FAIL);
await call('4) AI failure #3 -> circuit opens', 'hello', FAIL);

console.log('\n--- Circuit is OPEN: the next call must return instantly, without calling the AI ---');
await call('5) Circuit open -> instant "Service Busy"', 'hello again (no failure header at all)');

const health = await (await fetch(`${BASE_URL}/health`)).json();
console.log('\n/health ->', health);
console.log('\nDone. Open data/audit-log.json to see the encrypted originals + redacted messages.');
