'use strict';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const api = (path, opts = {}) =>
  fetch('/admin/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  });

const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
let state = { config: null };

// ── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  const { data } = await api('/status');
  if (data.authed) {
    state.config = data.config;
    showApp(data);
  } else {
    $('#login').classList.remove('hidden');
  }
}

function showApp(status) {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  renderConfig(state.config);
  if (status && status.recent) renderLogs(status.recent);
}

// ── Login ──────────────────────────────────────────────────────────────────--
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { ok, data } = await api('/login', {
    method: 'POST',
    body: JSON.stringify({ password: $('#login-password').value }),
  });
  if (ok) {
    const status = await api('/status');
    state.config = status.data.config;
    showApp(status.data);
  } else {
    $('#login-error').textContent = data.error || 'Login failed.';
  }
});

$('#logout').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' });
  location.reload();
});

// ── Tabs ──────────────────────────────────────────────────────────────────--
$$('.tab').forEach((btn) =>
  btn.addEventListener('click', () => {
    $$('.tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.tab-panel').forEach((p) => p.classList.add('hidden'));
    $('#tab-' + btn.dataset.tab).classList.remove('hidden');
    if (btn.dataset.tab === 'logs') refreshLogs();
    if (btn.dataset.tab === 'creds') renderConfig(state.config);
  }),
);

// ── Setup ──────────────────────────────────────────────────────────────────--
function renderConfig(c) {
  if (!c) return;
  $('#cfAccountId').value = c.cfAccountId || '';
  $('#allowedFrom').value = (c.allowedFrom || []).join(', ');
  $('#cfTokenState').textContent = c.cfApiTokenSet ? 'set' : 'not set';
  $('#cfApiToken').placeholder = c.cfApiTokenSet ? 'leave blank to keep existing' : 'paste token';

  // locked (env-provided) fields -> read-only
  const locked = c.locked || [];
  const lockMap = { cfAccountId: '#cfAccountId', cfApiToken: '#cfApiToken', allowedFrom: '#allowedFrom' };
  for (const [field, sel] of Object.entries(lockMap)) {
    $(sel).disabled = locked.includes(field);
  }
  if (locked.length) {
    $('#locked-note').classList.remove('hidden');
    $('#locked-note').textContent =
      'Locked by environment variables (edit them where the app is deployed): ' + locked.join(', ');
  }

  renderCreds(c);
}

$('#setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    cfAccountId: $('#cfAccountId').value.trim(),
    allowedFrom: list($('#allowedFrom').value),
  };
  const token = $('#cfApiToken').value.trim();
  if (token) body.cfApiToken = token;
  const { ok, data } = await api('/config', { method: 'POST', body: JSON.stringify(body) });
  const el = $('#setup-result');
  if (ok) {
    state.config = data.config;
    $('#cfApiToken').value = '';
    el.textContent = 'Saved.';
    el.className = 'result ok';
    renderConfig(state.config);
  } else {
    el.textContent = data.error || 'Save failed.';
    el.className = 'result err';
  }
});

$('#verify-creds').addEventListener('click', async () => {
  const el = $('#setup-result');
  el.textContent = 'Verifying…';
  el.className = 'result';
  const { data } = await api('/verify-credentials', { method: 'POST' });
  el.textContent = data.detail || (data.ok ? 'OK' : 'Failed');
  el.className = 'result ' + (data.ok ? 'ok' : 'err');
});

// ── Domain & DNS ─────────────────────────────────────────────────────────────
$('#check-domain').addEventListener('click', async () => {
  const domain = $('#domain-input').value.trim();
  if (!domain) return;
  const statusEl = $('#domain-status');
  statusEl.textContent = 'Checking…';
  statusEl.className = 'result';
  const { data } = await api('/domain?domain=' + encodeURIComponent(domain));
  const map = { verified: 'ok', pending: '', unknown: '', not_found: 'err' };
  statusEl.textContent =
    'Status: ' + data.status + (data.onCloudflareDns ? ' · domain is on Cloudflare DNS' : ' · domain not on Cloudflare DNS');
  statusEl.className = 'result ' + (map[data.status] || '');

  const tbody = $('#dns-table tbody');
  tbody.innerHTML = '';
  if (data.records && data.records.length) {
    $('#dns-table').classList.remove('hidden');
    for (const r of data.records) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td>${r.type}</td><td><code>${r.name}</code></td><td><code>${r.content}</code></td>` +
        `<td>${r.priority ?? ''}</td><td>${r.note || ''}</td>`;
      tbody.appendChild(tr);
    }
    $('#apply-dns').disabled = !data.onCloudflareDns;
  } else {
    $('#dns-table').classList.add('hidden');
    if (data.status === 'unknown') {
      statusEl.textContent +=
        ' — could not auto-fetch records; see the Cloudflare Email Service dashboard for SPF/DKIM/DMARC values.';
    }
    $('#apply-dns').disabled = true;
  }
});

$('#apply-dns').addEventListener('click', async () => {
  const domain = $('#domain-input').value.trim();
  const statusEl = $('#domain-status');
  statusEl.textContent = 'Adding records…';
  const { ok, data } = await api('/dns-apply', { method: 'POST', body: JSON.stringify({ domain }) });
  statusEl.textContent = ok && data.ok ? 'Records added. Re-check status in a few minutes.' : (data.error || 'Some records failed.');
  statusEl.className = 'result ' + (ok && data.ok ? 'ok' : 'err');
});

// ── Credentials ──────────────────────────────────────────────────────────────
function renderCreds(c) {
  const tbody = $('#smtp-table tbody');
  tbody.innerHTML = '';
  (c.smtpUsers || []).forEach((u) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><code>${u.username}</code></td><td class="muted">${u.passwordSet ? '•••••••• (set)' : '(none)'}</td><td></td>`;
    tbody.appendChild(tr);
  });
  $('#http-token-state').textContent = c.httpTokenSet ? 'An HTTP token is set.' : 'No HTTP token set (HTTP /send disabled).';
  updateWpSettings(c);
}

function updateWpSettings(c) {
  const user = (c.smtpUsers || [])[0];
  if (!user) return;
  $('#wp-settings').classList.remove('hidden');
  const host = location.hostname;
  $('#wp-settings-body').textContent =
    `SMTP Host:       ${host}\n` +
    `SMTP Port:       ${c.smtpPort}   (use STARTTLS; 465 if you front it with implicit TLS)\n` +
    `Encryption:      STARTTLS / TLS\n` +
    `Authentication:  ON\n` +
    `SMTP Username:   ${user.username}\n` +
    `SMTP Password:   (the generated password — shown once when created)\n` +
    `From Email:      an address at one of your allowed sender domains`;
}

$('#mint-smtp').addEventListener('click', async () => {
  const username = prompt('Username for the new SMTP user:', 'wordpress');
  if (!username) return;
  const { ok, data } = await api('/mint-token', { method: 'POST', body: JSON.stringify({ kind: 'smtp', username }) });
  if (ok) {
    alert(`SMTP user created.\n\nUsername: ${data.username}\nPassword: ${data.password}\n\nCopy the password now — it is not shown again.`);
    const status = await api('/status');
    state.config = status.data.config;
    renderConfig(state.config);
  }
});

$('#mint-http').addEventListener('click', async () => {
  const { ok, data } = await api('/mint-token', { method: 'POST', body: JSON.stringify({ kind: 'http' }) });
  if (ok) {
    prompt('HTTP API token (copy now — not shown again). Send it as: Authorization: Bearer <token>', data.token);
    const status = await api('/status');
    state.config = status.data.config;
    renderConfig(state.config);
  }
});

// ── Test send ────────────────────────────────────────────────────────────────
$('#test-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const el = $('#test-result');
  el.textContent = 'Sending…';
  el.className = 'result';
  const body = { to: $('#test-to').value.trim() };
  const from = $('#test-from').value.trim();
  if (from) body.from = from;
  const { ok, data } = await api('/test', { method: 'POST', body: JSON.stringify(body) });
  if (ok) {
    el.textContent = `Sent (${data.outcome}). delivered=${(data.delivered || []).length} queued=${(data.queued || []).length} bounced=${(data.bounced || []).length}`;
    el.className = 'result ok';
  } else {
    el.textContent = (data.error || 'Failed') + (data.detail ? ' — ' + data.detail : '');
    el.className = 'result err';
  }
});

// ── Logs ─────────────────────────────────────────────────────────────────────
async function refreshLogs() {
  const { data } = await api('/logs');
  if (Array.isArray(data)) renderLogs(data);
}
function renderLogs(rows) {
  const tbody = $('#logs-table tbody');
  tbody.innerHTML = '';
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td class="muted small">${new Date(r.at).toLocaleString()}</td>` +
      `<td>${r.via}</td><td><code>${r.from}</code></td><td>${(r.to || []).join(', ')}</td>` +
      `<td>${r.subject || ''}</td>` +
      `<td><span class="badge ${r.outcome}">${r.outcome}</span>${r.detail ? `<br><span class="muted small">${r.detail}</span>` : ''}</td>`;
    tbody.appendChild(tr);
  });
}
$('#refresh-logs').addEventListener('click', refreshLogs);

boot();
