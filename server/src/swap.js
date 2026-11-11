import { Connection, VersionedTransaction } from '@solana/web3.js';
import { CAPS } from './rules.js';
import { log, WSOL } from './util.js';

const JUP = ['https://lite-api.jup.ag/swap/v1', 'https://api.jup.ag/swap/v1'];

async function jup(path, opts) {
  let last = 'jupiter failed';
  for (const base of JUP) {
    try {
      const res = await fetch(base + path, { ...opts, headers: { accept: 'application/json', ...(opts?.headers || {}) } });
      const data = await res.json().catch(() => null);
      if (!res.ok) { last = (data && (data.error || data.message)) || res.status; continue; }
      return data;
    } catch (e) { last = e.message || String(e); }
  }
  throw new Error(String(last).slice(0, 180));
}

export function createSwap(cfg, kp) {
  const connection = new Connection(cfg.rpc, 'confirmed');
  const owner = kp.publicKey.toBase58();
  async function balance() {
    const lamports = await connection.getBalance(kp.publicKey, 'confirmed');
    return lamports / 1e9;
  }
  async function decimals(mint) {
    const info = await connection.getParsedAccountInfo(new (await import('@solana/web3.js')).PublicKey(mint));
    const d = info?.value?.data?.parsed?.info?.decimals;
    return Number.isFinite(+d) ? +d : 6;
  }
  async function mintFlags(mint) {
    const { PublicKey } = await import('@solana/web3.js');
    const info = await connection.getAccountInfo(new PublicKey(mint));
    const buf = info?.data;
    if (!buf || buf.length < 82) return { ok: false, reason: 'mint unreadable' };
    const mintRevoked = buf.readUInt32LE(0) === 0;
    const freezeRevoked = buf.readUInt32LE(46) === 0;
    const dec = buf[44];
    if (!mintRevoked || !freezeRevoked) return { ok: false, reason: 'mint or freeze authority' };
    return { ok: true, decimals: dec };
  }
  async function quote(inputMint, outputMint, amountRaw, slippageBps) {
    const q = new URLSearchParams({ inputMint, outputMint, amount: amountRaw.toString(), slippageBps: String(slippageBps), restrictIntermediateTokens: 'true' });
    const data = await jup('/quote?' + q.toString());
    if (!data?.outAmount) throw new Error('Jupiter quote returned no route');
    return data;
  }
  async function buy(mint, sol, slippageBps, maxImpact) {
    if (sol < CAPS.minBuySol) throw new Error('amount too small');
    const amount = BigInt(Math.round(sol * 1e9));
    const quoteObj = await quote(WSOL, mint, amount, slippageBps);
    if (quoteObj.priceImpactPct == null || quoteObj.priceImpactPct === '' || !Number.isFinite(+quoteObj.priceImpactPct)) {
      throw new Error('fake-data: impact cannot be computed');
    }
    const pct = +quoteObj.priceImpactPct * 100;
    if (maxImpact != null && pct > maxImpact) throw new Error('price impact ' + pct.toFixed(2) + '%');
    if (cfg.dryRun) {
      log('dry-run', 'buy ' + sol + ' SOL impact ' + pct.toFixed(2) + '%');
      return { dry: true, quote: quoteObj, sig: 'dry-run', tokenAmount: null };
    }
    const swap = await jup('/swap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      quoteResponse: quoteObj, userPublicKey: owner, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: Math.round(0.001 * 1e9), priorityLevel: 'high' } }
    }) });
    if (!swap?.swapTransaction) throw new Error('Jupiter returned no transaction');
    if (swap.simulationError) throw new Error('simulation failed');
    const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, 'base64'));
    tx.sign([kp]);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3, preflightCommitment: 'confirmed' });
    const conf = await connection.confirmTransaction(sig, 'confirmed');
    if (conf?.value?.err) throw new Error('transaction failed');
    let tokenAmount = null;
    try {
      const dec = await decimals(mint);
      tokenAmount = +quoteObj.outAmount / 10 ** dec;
    } catch { tokenAmount = null; }
    log('swap', 'buy confirmed ' + sig.slice(0, 8));
    return { dry: false, quote: quoteObj, sig, tokenAmount, feeSol: ((swap.prioritizationFeeLamports || 0) + 5000) / 1e9 };
  }
  async function sell(mint, rawAmount, slippageBps) {
    const amount = typeof rawAmount === 'bigint' ? rawAmount : BigInt(rawAmount);
    if (amount <= 0n) throw new Error('no balance');
    const quoteObj = await quote(mint, WSOL, amount, slippageBps);
    if (cfg.dryRun) {
      log('dry-run', 'sell ' + mint.slice(0, 4) + '… raw ' + amount.toString());
      return { dry: true, quote: quoteObj, sig: 'dry-run', solOut: +quoteObj.outAmount / 1e9 };
    }
    const swap = await jup('/swap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      quoteResponse: quoteObj, userPublicKey: owner, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: Math.round(0.001 * 1e9), priorityLevel: 'high' } }
    }) });
    if (!swap?.swapTransaction) throw new Error('Jupiter returned no transaction');
    const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, 'base64'));
    tx.sign([kp]);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3, preflightCommitment: 'confirmed' });
    const conf = await connection.confirmTransaction(sig, 'confirmed');
    if (conf?.value?.err) throw new Error('transaction failed');
    log('swap', 'sell confirmed ' + sig.slice(0, 8));
    return { dry: false, quote: quoteObj, sig, solOut: +quoteObj.outAmount / 1e9, feeSol: ((swap.prioritizationFeeLamports || 0) + 5000) / 1e9 };
  }
  async function tokenRaw(mint) {
    const { PublicKey } = await import('@solana/web3.js');
    const res = await connection.getParsedTokenAccountsByOwner(kp.publicKey, { mint: new PublicKey(mint) });
    let raw = 0n, ui = 0;
    for (const row of res.value || []) {
      const info = row.account.data.parsed.info.tokenAmount;
      raw += BigInt(info.amount);
      ui += +info.uiAmount || 0;
    }
    return { raw, ui };
  }
  return { owner, balance, quote, buy, sell, tokenRaw, mintFlags, connection };
}
