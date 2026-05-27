# Domain setup & verification

Before Cloudflare Email Service will send on behalf of your domain, you must
onboard the domain in the **Cloudflare dashboard** (this authorizes sending and
adds the SPF/DKIM/DMARC + bounce records). This is done in Cloudflare's UI —
there is no public API for it — so cloudflare-smtp-gateway links you straight to
the right page rather than managing DNS itself.

## 1. Onboard the sending domain (Cloudflare dashboard)

Go to **Email Sending** at the **account** level (not inside a specific website):

- Direct link: `https://dash.cloudflare.com/<ACCOUNT_ID>/email-service/sending`
- Or in the sidebar: **Build → Compute → Email Service → Email Sending**.

Then:

1. Click **Onboard Domain**.
2. Choose your domain → **Continue**.
3. Click **Add records and onboard**. If the domain uses **Cloudflare DNS**, the
   records are added automatically; otherwise copy the shown records into your DNS
   provider. Cloudflare adds:
   - **SPF** (TXT) — authorizes Cloudflare to send.
   - **DKIM** (TXT) — cryptographic signing (Cloudflare issues the selector/value).
   - **DMARC** (TXT, `_dmarc.yourdomain`) — alignment/reporting policy.
   - **Bounce subdomain** (MX) — handles bounces.
4. Wait for the status to leave **Syncing** (a few minutes; DNS can take up to 24h).

> Requires a **Workers Paid** plan with Email Sending enabled. Email Sending is in beta.

## 2. Create a scoped API token

Cloudflare dashboard → **My Profile → API Tokens → Create Token → Custom token**:

- **Send Email** — *Edit/Use* (this is all the gateway needs).

Copy the token and your **Account ID** into the gateway's admin UI **Setup** tab,
then click **Verify credentials**.

## 3. Confirm it works

In the admin UI **Test send** tab, send a test to an address you control. A
delivered result means the domain is fully onboarded and you're ready — point
WordPress / your apps at the gateway. (`from` must be an address at a domain in
`ALLOWED_FROM`.)

## Deliverability tips
- Keep SPF, DKIM, and DMARC all passing — misalignment lands you in spam.
- Use a real, monitored `from` address and a matching `reply_to`.
- Warm up gradually if you'll send high volume.
