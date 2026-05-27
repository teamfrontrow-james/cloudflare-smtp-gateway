# Security & lockdown

cloudflare-smtp-gateway holds a Cloudflare token that can send email, so treat it like a
credential store. It fails closed and ships locked down; this page explains each
control.

## Sender pinning (anti-spoofing) — required
`ALLOWED_FROM` is a comma-separated list of domains/addresses you're allowed to
send *from*. A bare domain (`example.com`) allows any mailbox at that domain; a
full address (`noreply@example.com`) pins exactly. **If it's empty, every send is
rejected** — the gateway is never an open relay. The `from` must also be a domain
verified in Cloudflare Email Service.

## Authentication
- **SMTP**: AUTH is mandatory. Define logins in `SMTP_USERS` (`user:pass,user2:pass2`)
  or generate them in the admin **Credentials** tab. Use long random passwords.
- **HTTP `POST /send`**: requires `Authorization: Bearer <HTTP_TOKEN>`. Leave
  `HTTP_TOKEN` blank to disable the HTTP path entirely.
- **Admin UI**: gated by `ADMIN_PASSWORD` (blank = UI fully disabled). The session
  cookie is an HMAC over the password, so changing the password logs everyone out.

All secret comparisons are constant-time.

## Transport security
The SMTP listener offers **STARTTLS**. Provide `TLS_CERT_PATH` + `TLS_KEY_PATH`
for a real certificate; without them a self-signed cert is used (fine for
`127.0.0.1`, not for public exposure). Put the HTTP side behind HTTPS (your PaaS,
or a reverse proxy / Cloudflare Tunnel) whenever it's reachable off-host.

## Network exposure
`BIND_HOST` defaults to `127.0.0.1` — nothing is reachable off the machine. Only
set `0.0.0.0` when another container or host genuinely needs to connect, and pair
it with AUTH + a firewall. Run the admin UI on localhost (`ADMIN_LOCALHOST_ONLY`)
or behind your own auth proxy; never expose it to the open internet.

## Rate limiting
`RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_PER_DAY` cap sends per SMTP user / HTTP
client / IP. Over-limit SMTP gets a temporary `451`; HTTP gets `429` + `Retry-After`.

## Recipient rules & bot protection
- `RECIPIENT_ALLOWLIST` / `RECIPIENT_DENYLIST` (full addresses or `@domain`).
  Allowlist wins when set; otherwise denylist blocks.
- `ALLOWED_ORIGINS` restricts which browser origins may call `/send` (CORS).
- `TURNSTILE_SECRET` requires a valid Cloudflare Turnstile token on HTTP sends —
  useful for public contact forms.

## Token scoping
Give the Cloudflare API token the **minimum** scope: **Send Email** only, adding
**DNS:Edit** solely if you use one-click DNS. The token lives server-side and is
never returned to the browser (the admin API only reports whether it's set).

## Secrets handling
Logs redact tokens/passwords. `./data/config.json` (GUI-saved secrets) and your
`.env` are git-ignored — keep them `chmod 600` and out of version control.
