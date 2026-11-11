import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { log } from './util.js';

function derive(passphrase, salt) {
  return scryptSync(String(passphrase), salt, 32);
}

export function encryptSecret(plain, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = derive(passphrase, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return {
    v: 1,
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  };
}

export function decryptSecret(blob, passphrase) {
  const salt = Buffer.from(blob.salt, 'base64');
  const iv = Buffer.from(blob.iv, 'base64');
  const key = derive(passphrase, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const out = Buffer.concat([decipher.update(Buffer.from(blob.data, 'base64')), decipher.final()]);
  return out.toString('utf8');
}

export function parseSecret(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('empty key');
  if (raw.startsWith('[')) {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new Error('key json is not an array');
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }
  if (/^[0-9a-fA-F]+$/.test(raw) && (raw.length === 64 || raw.length === 128)) {
    const bytes = Buffer.from(raw, 'hex');
    return bytes.length === 32 ? Keypair.fromSeed(bytes) : Keypair.fromSecretKey(bytes);
  }
  const bytes = bs58.decode(raw);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  throw new Error('key must be a base58 secret, a hex seed, or a 64-byte json array');
}

function readPassphrase(cfg) {
  if (process.env.SMS_PASSPHRASE) return String(process.env.SMS_PASSPHRASE);
  if (cfg.passFile && existsSync(cfg.passFile)) return readFileSync(cfg.passFile, 'utf8').trim();
  return '';
}

function shredFile(path) {
  try {
    const len = readFileSync(path).length;
    writeFileSync(path, Buffer.alloc(Math.max(len, 1), 0), { mode: 0o600 });
  } catch { /* best effort */ }
  try { unlinkSync(path); } catch { /* already gone */ }
}

export function unlockKey(cfg) {
  const pass = readPassphrase(cfg);
  if (existsSync(cfg.encFile)) {
    if (!pass) return { need: 'unlock' };
    try {
      const blob = JSON.parse(readFileSync(cfg.encFile, 'utf8'));
      const secret = decryptSecret(blob, pass);
      const kp = parseSecret(secret);
      log('key', 'unlocked encrypted key for ' + kp.publicKey.toBase58());
      return { kp, secret };
    } catch (e) {
      log('key', 'unlock failed: ' + (e.message || 'bad passphrase'));
      return { need: 'unlock', error: 'passphrase did not open the encrypted key' };
    }
  }
  if (cfg.keyFile && existsSync(cfg.keyFile)) {
    if (!pass) return { need: 'setup', error: 'plaintext key file is present. Type a passphrase on the setup page so it can be encrypted. The file is not used until then.' };
    const secret = readFileSync(cfg.keyFile, 'utf8');
    const kp = parseSecret(secret);
    const blob = encryptSecret(secret.trim(), pass);
    writeFileSync(cfg.encFile, JSON.stringify(blob), { mode: 0o600 });
    try { chmodSync(cfg.encFile, 0o600); } catch { /* already set */ }
    shredFile(cfg.keyFile);
    log('key', 'encrypted key at rest and removed the plaintext file. public ' + kp.publicKey.toBase58());
    return { kp, secret: secret.trim() };
  }
  return { need: 'setup' };
}

export function saveEncryptedKey(cfg, secret, passphrase) {
  const kp = parseSecret(secret);
  const blob = encryptSecret(String(secret).trim(), passphrase);
  writeFileSync(cfg.encFile, JSON.stringify(blob), { mode: 0o600 });
  try { chmodSync(cfg.encFile, 0o600); } catch { /* mode set */ }
  if (cfg.keyFile && existsSync(cfg.keyFile)) shredFile(cfg.keyFile);
  return kp;
}

export function tokensMatch(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length || !ba.length) return false;
  return timingSafeEqual(ba, bb);
}
