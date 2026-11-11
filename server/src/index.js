import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { startApi } from './api.js';
import { createEngine } from './engine.js';
import { parseSecret, unlockKey } from './keystore.js';
import { createNet } from './net.js';
import { serveSetup } from './setup.js';
import { openState } from './state.js';
import { createSwap } from './swap.js';
import { log, sleep } from './util.js';

function env(name, fallback) {
  const v = process.env[name];
  return v == null || v === '' ? fallback : v;
}

function loadConfig() {
  const stateDir = env('SMS_STATE_DIR', '/var/lib/sms');
  mkdirSync(stateDir, { recursive: true });
  const cfg = {
    stateDir,
    stateFile: join(stateDir, 'book.json'),
    encFile: join(stateDir, 'key.enc'),
    tokenFile: join(stateDir, 'api.token'),
    keyFile: env('SMS_KEY_FILE', '/etc/sms/key'),
    passFile: env('SMS_PASSPHRASE_FILE', '/etc/sms/passphrase'),
    repo: env('SMS_REPO', 'vomidvari7-beep/solana-meme-sinper'),
    rpc: env('SMS_RPC', 'https://solana-rpc.publicnode.com'),
    bind: env('SMS_BIND', '0.0.0.0'),
    port: +env('SMS_PORT', '8787') || 8787,
    setupPort: +env('SMS_SETUP_PORT', '8788') || 8788,
    dryRun: env('SMS_DRY_RUN', '1') !== '0',
    agentMs: Math.min(30000, Math.max(15000, +env('SMS_AGENT_MS', '20000') || 20000)),
    priceMs: Math.min(2000, Math.max(1000, +env('SMS_PRICE_MS', '1500') || 1500))
  };
  return cfg;
}

function readToken(cfg) {
  if (process.env.SMS_API_TOKEN) return String(process.env.SMS_API_TOKEN).trim();
  if (existsSync(cfg.tokenFile)) return readFileSync(cfg.tokenFile, 'utf8').trim();
  return '';
}

async function main() {
  const cfg = loadConfig();
  mkdirSync(dirname(cfg.encFile), { recursive: true });
  let unlocked = unlockKey(cfg);
  if (unlocked.need) {
    log('setup', unlocked.error || 'waiting for the local setup page');
    await serveSetup(cfg);
    unlocked = unlockKey(cfg);
    if (!unlocked.kp) throw new Error('setup finished without a usable key');
  }
  cfg.apiToken = readToken(cfg);
  if (!cfg.apiToken) throw new Error('API token missing. Set SMS_API_TOKEN or submit one on the setup page.');
  const kp = unlocked.kp || parseSecret(unlocked.secret);
  const state = openState(cfg.stateFile);
  state.data.dryRun = cfg.dryRun;
  state.save();
  const net = createNet(cfg);
  const swap = createSwap(cfg, kp);
  const engine = createEngine(cfg, state, net, swap);
  startApi(cfg, state, engine);
  log('boot', (cfg.dryRun ? 'DRY-RUN' : 'LIVE') + ' public ' + swap.owner + ' state ' + cfg.stateFile);
  await engine.tick('agents');
  const loops = [
    ['prices', cfg.priceMs],
    ['agents', cfg.agentMs],
    ['scalp', 12000],
    ['breakout', 8000],
    ['plans', 20000],
    ['scan', 8000]
  ];
  let stop = false;
  const run = async (kind, ms) => {
    while (!stop) {
      await engine.tick(kind);
      await sleep(ms);
    }
  };
  loops.forEach(([kind, ms]) => { run(kind, ms).catch(e => log(kind, e.message || e)); });
  const halt = () => { stop = true; try { state.save(); } catch { /* disk */ } process.exit(0); };
  process.on('SIGTERM', halt);
  process.on('SIGINT', halt);
}

main().catch((e) => {
  log('fatal', e.message || e);
  process.exit(1);
});
