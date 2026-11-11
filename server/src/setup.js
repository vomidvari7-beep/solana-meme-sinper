import { createServer } from 'node:http';
import { chmodSync, writeFileSync } from 'node:fs';
import { saveEncryptedKey } from './keystore.js';
import { log } from './util.js';

const PAGE = `<!doctype html><meta charset="utf-8"><title>SMS setup</title>
<style>body{font:16px/1.4 sans-serif;background:#111;color:#eee;max-width:32rem;margin:2rem auto;padding:0 1rem}input,button{width:100%;box-sizing:border-box;margin:.4rem 0;padding:.6rem;border-radius:8px;border:1px solid #333;background:#1b1b1b;color:#eee}button{background:#6d5efc;border:0;font-weight:700}p{color:#aaa}</style>
<h1>SolanaMemeSniper</h1>
<p>This page is only on 127.0.0.1. Reach it through an SSH tunnel. The key is encrypted and is not written to the log.</p>
<form method="post">
<label>Burner secret (base58, hex, or JSON array)<input name="secret" type="password" autocomplete="off" required></label>
<label>Passphrase<input name="pass" type="password" autocomplete="new-password" required></label>
<label>Passphrase again<input name="pass2" type="password" autocomplete="new-password" required></label>
<label>API token the phone will send<input name="token" type="password" autocomplete="off" required></label>
<button>Encrypt and start</button>
</form>`;

function local(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function serveSetup(cfg) {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!local(req)) { res.writeHead(403); res.end('local only'); return; }
      if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); return; }
      if (req.method !== 'POST') { res.writeHead(405); res.end('no'); return; }
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const form = new URLSearchParams(text);
        const secret = form.get('secret') || '';
        const pass = form.get('pass') || '';
        const pass2 = form.get('pass2') || '';
        const token = (form.get('token') || '').trim();
        if (pass.length < 8 || pass !== pass2 || token.length < 12 || !secret) {
          res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
          res.end('<p>Passphrase must match and be at least 8 characters. API token must be at least 12 characters.</p><a href="/">Back</a>');
          return;
        }
        try {
          const kp = saveEncryptedKey(cfg, secret, pass);
          writeFileSync(cfg.tokenFile, token + '\n', { mode: 0o600 });
          try { chmodSync(cfg.tokenFile, 0o600); } catch { /* set */ }
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end('<p>Encrypted. Public address ' + kp.publicKey.toBase58() + '. You can close this page.</p>');
          log('setup', 'key encrypted for ' + kp.publicKey.toBase58());
          server.close(() => resolve({ publicKey: kp.publicKey.toBase58() }));
        } catch (e) {
          res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
          res.end('<p>Could not read that key. ' + String(e.message || 'invalid').replace(/[<>]/g, '') + '</p><a href="/">Back</a>');
        }
      });
    });
    server.listen(cfg.setupPort, '127.0.0.1', () => {
      log('setup', 'open an SSH tunnel to 127.0.0.1:' + cfg.setupPort + ' and submit the key once');
    });
    server.on('error', reject);
  });
}
