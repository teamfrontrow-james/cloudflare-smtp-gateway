# cloudflare-smtp-gateway

**A tiny self-hostable gateway that lets any app send transactional email through
[Cloudflare Email Service](https://developers.cloudflare.com/email-service/) — over plain SMTP or HTTP.**

Point WordPress (WP Mail SMTP), a legacy app, a cron script, or your own code at
cloudflare-smtp-gateway and it relays the message to Cloudflare Email Service, with a
built-in admin UI for setup, domain verification, credentials, and a send log.

```
WordPress / any SMTP app ──SMTP──┐
                                  ├─▶  cloudflare-smtp-gateway  ──HTTPS──▶  Cloudflare Email Service
your code / forms ──HTTP POST─────┘     (auth · from-pinning · rate limits · admin UI)
```

- **SMTP _and_ HTTP** front doors, one hardened send path.
- **Admin web UI**: enter your Cloudflare token, get the DNS records to add,
  verify your domain, send a test, mint SMTP/HTTP credentials, watch a live send log.
- **Locked down by default**: SMTP AUTH (no open relay), bearer-token HTTP,
  sender pinned to your verified domain, recipient rules, per-credential rate limits.
- **Deploy any way you like**: Docker, `npx`, Fly.io/Render/Railway, or systemd/pm2.
- Small TypeScript app, no database, no build step for the UI.

> ### Why a Node app and not "just a Cloudflare Worker"?
> A Cloudflare Worker can't accept inbound SMTP connections (Workers are HTTP-only),
> and Cloudflare Email Service has no public SMTP endpoint — it sends via a Worker
> binding or its REST API. To give *any* app a real SMTP host to talk to, the SMTP
> listener has to run somewhere you control. cloudflare-smtp-gateway is that small piece,
> and it talks to Cloudflare's REST API for you.

---

## Prerequisites

1. A **Cloudflare Workers Paid** plan ($5/month). Email **Sending** is only
   available on Workers Paid — it includes **3,000 emails/month**, then $0.35 per
   1,000. (Email *Routing*/receiving is free, but this tool sends, so Paid is
   required.) Email Service is currently in beta.
2. A **domain** you can add DNS records to.
3. A **Cloudflare API token** with the **Send Email** permission
   (add **DNS:Edit** too if you want the one-click DNS feature). See
   [docs/domain-setup.md](docs/domain-setup.md).

---

## Quickstart

Pick whichever deployment fits. In all cases, open `http://<host>:3000/admin/`
afterward (when `ADMIN_PASSWORD` is set) to finish setup, verify your domain, and
generate credentials.

### Docker (recommended for "alongside other projects")
```bash
cp .env.example .env        # fill it in (or configure later in the admin UI)
docker compose up -d
```
To embed it next to an existing app in one compose project, see
[`examples/compose-sidecar.yml`](examples/compose-sidecar.yml).

### npx
```bash
npx cloudflare-smtp-gateway          # reads env vars / a .env in the working dir
```

### From source
```bash
npm ci && npm run build && node dist/index.js
# or: npm run dev
```

### Build from source with Docker
```bash
cp .env.example .env        # fill in your Cloudflare creds + secrets
docker compose -f docker-compose.dev.yml up --build
```

### One-click PaaS
- **Fly.io** (supports SMTP + HTTP): [`deploy/fly.toml`](deploy/fly.toml)
- **Railway**: [`deploy/railway.json`](deploy/railway.json)
- **Render** (HTTP only — no public SMTP): [`deploy/render.yaml`](deploy/render.yaml)

### Long-lived service on a VM
- systemd: [`deploy/systemd/cloudflare-smtp-gateway.service`](deploy/systemd/cloudflare-smtp-gateway.service)
- pm2: [`deploy/pm2.config.cjs`](deploy/pm2.config.cjs)

---

## Sending mail

**WordPress** → use WP Mail SMTP pointed at the gateway. Full walkthrough:
[`examples/wordpress-wp-mail-smtp.md`](examples/wordpress-wp-mail-smtp.md).

**Any SMTP client** → host `<your host>`, port `2525` (or `587`), STARTTLS, AUTH on,
with a username/password from the admin **Credentials** tab.

**HTTP** →
```bash
curl -X POST https://your-host/send \
  -H "Authorization: Bearer $HTTP_TOKEN" -H "Content-Type: application/json" \
  -d '{"to":"a@b.com","from":"noreply@example.com","subject":"Hi","text":"Hello"}'
```
More: [`examples/`](examples/) (curl, PHP, Node).

---

## Configuration

Everything is set via env vars (see [`.env.example`](.env.example)) **or** the admin
UI (persisted to `./data/config.json`). Env vars win and lock the corresponding UI
field. Key ones:

| Variable | Purpose |
|---|---|
| `CF_API_TOKEN`, `CF_ACCOUNT_ID` | Cloudflare Email Service credentials |
| `ALLOWED_FROM` | Comma-separated sender domains/addresses (anti-spoofing). **Required to send.** |
| `SMTP_USERS` | `user:pass` logins for the SMTP listener |
| `HTTP_TOKEN` | Bearer token for `POST /send` (blank = HTTP send disabled) |
| `ADMIN_PASSWORD` | Enables + protects the admin UI (blank = UI disabled) |
| `SMTP_PORT`, `HTTP_PORT`, `BIND_HOST` | Listeners (defaults `2525` / `3000` / `127.0.0.1`) |
| `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_PER_DAY` | Per-credential/IP limits |
| `RECIPIENT_ALLOWLIST`, `RECIPIENT_DENYLIST`, `ALLOWED_ORIGINS`, `TURNSTILE_SECRET` | Optional lockdown |

See [docs/security.md](docs/security.md) for the full lockdown guide.

---

## Documentation
- [Domain setup (SPF/DKIM/DMARC + verification)](docs/domain-setup.md)
- [Security & lockdown](docs/security.md)
- [WordPress guide](examples/wordpress-wp-mail-smtp.md)
- [Troubleshooting](docs/troubleshooting.md)

## Development
```bash
npm ci
npm run dev        # tsx watch
npm test           # vitest
npm run typecheck && npm run lint
```

Releases are automated — see [RELEASING.md](RELEASING.md).

## License
MIT — see [LICENSE](LICENSE).
