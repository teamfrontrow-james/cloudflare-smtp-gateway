# Domain setup & verification

Before Cloudflare Email Service will send on behalf of your domain, you must
prove you own it and authorize sending via DNS. cloudflare-smtp-gateway's admin UI shows
you exactly which records to add (and can add them for you if your domain uses
Cloudflare DNS).

## 1. Create a scoped API token
Cloudflare dashboard → **My Profile → API Tokens → Create Token → Custom token**:

- **Send Email** — *Edit/Use* (required, for sending).
- **DNS → Edit** on the relevant zone — *only* if you want the **one-click "add
  records"** button in the admin UI. Otherwise skip it and add records manually.

Copy the token and your **Account ID** (Workers/Overview page) into the admin UI
**Setup** tab, then click **Verify credentials**.

## 2. Add the DNS records
Open the **Domain & DNS** tab, enter your domain, and click **Check status**. The
gateway asks Cloudflare for the records your domain needs, typically:

- **SPF** (TXT) — authorizes Cloudflare to send.
- **DKIM** (TXT) — cryptographic signing; Cloudflare gives you the selector + value.
- **DMARC** (TXT, `_dmarc.yourdomain`) — alignment/reporting policy.
- **Bounce subdomain** (MX, e.g. `cf-bounce`) — handles bounces.

If the domain is on **Cloudflare DNS**, click **One-click add records**. Otherwise
copy each row into your DNS provider.

> The exact records are issued per-domain by Cloudflare. If the beta API doesn't
> return them to the gateway, the UI says so — add them from the **Cloudflare
> Email Service dashboard** instead.

## 3. Verify
DNS can take a few minutes (up to 24h) to propagate. Re-click **Check status**
until it shows **verified**. Then any address at that domain can be used as a
`from` (as long as it's listed in `ALLOWED_FROM`).

## 4. Deliverability tips
- Keep SPF, DKIM, and DMARC all passing — misalignment lands you in spam.
- Use a real, monitored `from` address and a matching `reply_to`.
- Warm up gradually if you'll send high volume.
