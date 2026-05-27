# Troubleshooting

Check the **Activity** tab in the admin UI first — every send (and rejection) is
logged there with an outcome and detail.

## "Sender … is not permitted"
The `from` address isn't covered by `ALLOWED_FROM`, or `ALLOWED_FROM` is empty.
Add the domain/address and make sure it's verified in Cloudflare Email Service.

## SMTP client can't authenticate
- Confirm the username/password match `SMTP_USERS` (regenerate in **Credentials**).
- Ensure the client uses **AUTH on** with **STARTTLS/TLS**.
- If connecting from another host, the gateway must bind `0.0.0.0` (`BIND_HOST`)
  and the port must be open in the firewall.

## HTTP `/send` returns 401 / 503
- `503` → `HTTP_TOKEN` isn't set, so the HTTP path is disabled.
- `401` → missing/incorrect `Authorization: Bearer <token>` header.

## HTTP `/send` returns 429
Rate limit hit. Raise `RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_PER_DAY`, or back off
per the `Retry-After` header.

## "Cloudflare rejected the message" (502) / bounces
- Verify credentials in **Setup** → **Verify credentials**.
- Make sure the domain shows **verified** in **Domain & DNS**.
- Recipients in `permanent_bounces` are invalid/blocked addresses on the
  receiving side — check the address.

## Mail sends but lands in spam
SPF/DKIM/DMARC almost certainly aren't all aligned/passing. Re-check the records
in **Domain & DNS** and see [domain-setup.md](domain-setup.md). Use a consistent,
real `from` domain.

## Domain status shows "unknown"
The beta Email Service API didn't return the records to the gateway. Add the
SPF/DKIM/DMARC/bounce records from the Cloudflare Email Service dashboard manually,
then re-check.

## Admin UI won't load / redirects away
`ADMIN_PASSWORD` must be set for the UI to exist at all. If it's set and you still
can't log in, the password may be supplied via env and differ from what you're
typing — check where the app is deployed.

## Config changes in the UI don't stick
A field locked by an environment variable (shown greyed-out, listed under "Locked
by environment variables") can only be changed where the env var is defined.
Otherwise confirm `./data` is writable and persisted (a Docker volume).
