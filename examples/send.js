// Send via the HTTP API from Node (no dependencies).
//   GATEWAY_URL=http://localhost:3000 HTTP_TOKEN=... node examples/send.js
const url = process.env.GATEWAY_URL ?? 'http://localhost:3000';
const token = process.env.HTTP_TOKEN;
if (!token) throw new Error('Set HTTP_TOKEN');

const res = await fetch(`${url}/send`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    to: 'recipient@example.net',
    from: 'noreply@example.com',
    subject: 'Hello from cloudflare-smtp-gateway',
    text: 'Plain-text body.',
    html: '<p>HTML body.</p>',
  }),
});

console.log(res.status, await res.json());
