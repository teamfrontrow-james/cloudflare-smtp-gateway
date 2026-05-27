# WordPress (WP Mail SMTP) setup

You do **not** need a custom plugin. cloudflare-smtp-gateway is a real SMTP server, so
the free **WP Mail SMTP** plugin (or any SMTP plugin) works as-is.

## 1. Create an SMTP user in the gateway
Open the admin UI → **Credentials** → **+ Generate user**. Copy the username and
the one-time password.

## 2. Install WP Mail SMTP
WordPress admin → **Plugins → Add New** → search "WP Mail SMTP" → install + activate.

## 3. Configure it
**WP Mail SMTP → Settings**, choose **Other SMTP**, then:

| Field            | Value                                                            |
|------------------|------------------------------------------------------------------|
| From Email       | An address at your verified domain (e.g. `noreply@example.com`)  |
| From Name        | Your site name                                                   |
| SMTP Host        | Where the gateway runs (e.g. `mail.yourserver.com` or `127.0.0.1`) |
| Encryption       | **TLS / STARTTLS**                                                |
| SMTP Port        | `2525` (or `587`)                                                |
| Authentication   | **On**                                                           |
| SMTP Username    | the generated username                                           |
| SMTP Password    | the generated password                                           |

> The **From Email** domain must be in the gateway's `ALLOWED_FROM` list (and
> verified in Cloudflare Email Service), or the gateway rejects the message.

## 4. Send a test
Use **WP Mail SMTP → Tools → Email Test**, then check the gateway's **Activity**
tab to confirm it was delivered/queued.

## Running the gateway on the same server as WordPress
If WordPress runs on a VPS/managed host you control, run the gateway on
`127.0.0.1:2525` (Docker or systemd) and set **SMTP Host = `127.0.0.1`**. Nothing
is exposed to the internet and there's no extra hosting cost.

On **shared hosting** you usually can't run a process — host the gateway
elsewhere (a small VM, Fly.io, etc.) and point WP Mail SMTP at its public host.
