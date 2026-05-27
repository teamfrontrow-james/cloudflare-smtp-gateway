#!/usr/bin/env bash
# Send an email through cloudflare-smtp-gateway's HTTP API.
# Set GATEWAY_URL and HTTP_TOKEN (the token from the admin UI "Credentials" tab).
set -euo pipefail

GATEWAY_URL="${GATEWAY_URL:-http://localhost:3000}"
HTTP_TOKEN="${HTTP_TOKEN:?set HTTP_TOKEN}"

curl -sS -X POST "$GATEWAY_URL/send" \
  -H "Authorization: Bearer $HTTP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "recipient@example.net",
    "from": "noreply@example.com",
    "subject": "Hello from cloudflare-smtp-gateway",
    "text": "Plain-text body.",
    "html": "<p>HTML body.</p>"
  }'
echo
