import { createServer } from 'node:http';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { saveEncryptedKey, tokensMatch } from './keystore.js';
import { log } from './util.js';

const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SMS setup</title>
<style>body{font:16px/1.45 -apple-system,sans-serif;background:#111;color:#eee;max-width:28rem;margin:1.5rem auto;padding:0 1rem}input,button{width:100%;box-sizing:border-box;margin:.35rem 0;padding:.7rem;border-radius:10px;border:1px solid #333;background:#1b1b1b;color:#eee;font-size:16px}button{background:#6d5efc;border:0;font-weight:700}p{color:#bbb}</style>
<h1>کلید برنر</h1>
<p>این صفحه فقط یک بار کار می‌کند. کد راه‌اندازی از لینک پر می‌شود و تا ۳۰ دقیقه معتبر است. کلید در لاگ نوشته نمی‌شود.</p>
<form method="post" action="/setup">
<label>کد یک‌بارمصرف<input id="code" name="code" autocomplete="off" required></label>
<label>کلید خصوصی برنر<input name="secret" type="password" autocomplete="off" required></label>
<label>عبارت عبور<input name="pass" type="password" autocomplete="new-password" required></label>
<label>تکرار عبارت عبور<input name="pass2" type="password" autocomplete="new-password" required></label>
<button>رمزگذاری و شروع</button>
</form>
<script>var h=(location.hash||'').replace(/^#/, ''); if(h) document.getElementById('code').value=decodeURIComponent(h);</script>`;

export function evaluateSetup(row, code, now, ip) {
  const next = row && typeof row === 'object' ? { ...row, hits: Array.isArray(row.hits) ? row.hits.slice() : [] } : null;
  if (!next || next.done) return { ok: false, reason: 'setup is closed' };
  if (!(next.exp > now)) return { ok: false, reason: 'setup code expired. Run the install command again.', row: next };
  next.hits = next.hits.filter(h => h && now - h.t < 10 * 60e3);
  const fromIp = next.hits.filter(h => h.ip === ip).length;
  if (fromIp >= 20 || (next.lockedUntil || 0) > now) {
    next.lockedUntil = Math.max(next.lockedUntil || 0, now + 10 * 60e3);
    return { ok: false, reason: 'too many tries. Wait 10 minutes.', row: next };
  }
  next.hits.push({ t: now, ip: String(ip || '').slice(0, 64) });
  if (next.hits.length > 80) next.hits = next.hits.slice(-80);
  if (!code || !tokensMatch(String(code), String(next.code || ''))) {
    next.fails = (next.fails || 0) + 1;
    if (next.fails >= 5) { next.fails = 0; next.lockedUntil = now + 10 * 60e3; }
    return { ok: false, reason: 'setup code rejected', row: next };
  }
  return { ok: true, row: next };
}

function loadRow(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}
function saveRow(file, row) {
  writeFileSync(file, JSON.stringify({ ...row, code: row.code }), { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* mode set */ }
}
function clientIp(req) {
  const parts = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return (parts[parts.length - 1] || req.socket.remoteAddress || 'local').slice(0, 64);
}
function html(res, code, body) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}
function isSetupPath(pathname) {
  return pathname === '/' || pathname === '/setup' || pathname === '/setup/';
}

export function serveSetup(cfg) {
  const file = cfg.setupFile;
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      if (!isSetupPath(url.pathname)) { res.writeHead(404); res.end('not found'); return; }
      if (existsSync(cfg.encFile) || existsSync(cfg.setupDone)) { html(res, 410, '<p>Setup is closed.</p>'); return; }
      if (req.method === 'GET') { html(res, 200, PAGE); return; }
      if (req.method !== 'POST') { res.writeHead(405); res.end('no'); return; }
      const chunks = [];
      let n = 0;
      req.on('data', (c) => { n += c.length; if (n > 8000) req.destroy(); else chunks.push(c); });
      req.on('end', () => {
        const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        const row = loadRow(file);
        const gate = evaluateSetup(row, form.get('code') || '', Date.now(), clientIp(req));
        if (gate.row) saveRow(file, gate.row);
        if (!gate.ok) { html(res, 401, '<p>' + gate.reason + '</p><p><a href="/setup">Back</a></p>'); return; }
        const secret = form.get('secret') || '';
        const pass = form.get('pass') || '';
        const pass2 = form.get('pass2') || '';
        if (pass.length < 8 || pass !== pass2 || !secret) {
          html(res, 400, '<p>Passphrase must match and be at least 8 characters.</p><p><a href="/setup">Back</a></p>');
          return;
        }
        try {
          const kp = saveEncryptedKey(cfg, secret, pass);
          saveRow(file, { done: true, at: Date.now() });
          writeFileSync(cfg.setupDone, '1\n', { mode: 0o600 });
          html(res, 200, '<p>رمز شد. آدرس عمومی: ' + kp.publicKey.toBase58() + '</p><p>برگرد به پنل و آدرس https و توکنی که در کنسول VPS چاپ شد را وارد کن.</p>');
          log('setup', 'key encrypted for ' + kp.publicKey.toBase58());
          server.close(() => resolve({ publicKey: kp.publicKey.toBase58() }));
        } catch (e) {
          html(res, 400, '<p>Could not read that key. ' + String(e.message || 'invalid').replace(/[<>]/g, '') + '</p><p><a href="/setup">Back</a></p>');
        }
      });
    });
    server.listen(cfg.setupPort, '127.0.0.1', () => log('setup', 'waiting on /setup'));
    server.on('error', reject);
  });
}
