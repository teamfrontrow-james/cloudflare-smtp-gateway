<?php
// Send via the HTTP API from PHP (e.g. a custom plugin or script).
//   GATEWAY_URL=http://localhost:3000 HTTP_TOKEN=... php examples/send.php

$url   = getenv('GATEWAY_URL') ?: 'http://localhost:3000';
$token = getenv('HTTP_TOKEN');
if (!$token) { fwrite(STDERR, "Set HTTP_TOKEN\n"); exit(1); }

$payload = json_encode([
  'to'      => 'recipient@example.net',
  'from'    => 'noreply@example.com',
  'subject' => 'Hello from cloudflare-smtp-gateway',
  'text'    => 'Plain-text body.',
  'html'    => '<p>HTML body.</p>',
]);

$ch = curl_init("$url/send");
curl_setopt_array($ch, [
  CURLOPT_POST           => true,
  CURLOPT_POSTFIELDS     => $payload,
  CURLOPT_HTTPHEADER     => ["Authorization: Bearer $token", 'Content-Type: application/json'],
  CURLOPT_RETURNTRANSFER => true,
]);
$response = curl_exec($ch);
echo curl_getinfo($ch, CURLINFO_HTTP_CODE) . "\n" . $response . "\n";
curl_close($ch);
