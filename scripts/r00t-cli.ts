#!/usr/bin/env npx tsx
/**
 * R00T CLI - Live Market Maker Dashboard
 *
 * A clean terminal UI using blessed for proper rendering.
 * Press 'q' to quit, 'p' to pause/resume.
 */

import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { ethers, Wallet } from 'ethers';
import { poseidon2, poseidon3, poseidon5 } from 'poseidon-lite';
import * as snarkjs from 'snarkjs';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
const envPath = path.join(__dirname, '../contracts/.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0 && !process.env[key.trim()]) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  });
}

// =============================================================================
// CONFIG
// =============================================================================

// =============================================================================
// DAILY VOLUME TARGET (main config - everything else is computed from this)
// =============================================================================
const TARGET_DAILY_VOLUME_ETH = 10;  // Target average daily volume in ETH
const ACTIVE_AGENTS_PER_ROUND = 5;   // Average agents trading per round

// Computed trading parameters based on target volume
const SECONDS_PER_DAY = 86400;
const AVG_TRADE_ETH = 0.003;  // Average trade size in ETH
const tradesNeeded = TARGET_DAILY_VOLUME_ETH / AVG_TRADE_ETH;
const roundsNeeded = tradesNeeded / ACTIVE_AGENTS_PER_ROUND;
const intervalMs = Math.floor((SECONDS_PER_DAY * 1000) / roundsNeeded);

const CONFIG = {
  RPC_URL: process.env.SEPOLIA_RPC_URL || 'https://eth-sepolia.g.alchemy.com/v2/demo',
  CHAIN_ID: 11155111,
  // FRESH DEPLOY 2026-02-06 (configurable OI limit + liquidation fix)
  ZKAMM_ROUTER: '0xd1b972eb47626B67Fe700ee9F3Ab4Fe76751b630',
  ZKAMM_PAIR: '0xdacF977d96840748EB5624508BF98fc5E8CC84E1',
  TOKEN_POOL: '0xC8301Eafed00a003751292F268f3653CdACa2467',
  NUM_AGENTS: 33,
  // Trade sizes (centered around AVG_TRADE_ETH)
  MIN_TRADE_ETH: ethers.parseEther((AVG_TRADE_ETH * 0.5).toFixed(6)),
  MAX_TRADE_ETH: ethers.parseEther((AVG_TRADE_ETH * 1.5).toFixed(6)),
  GAS_BUFFER: ethers.parseEther('0.002'),
  // Interval computed from daily volume target
  TRADE_INTERVAL_MS: Math.max(intervalMs, 3000),  // Min 3s to avoid rate limits
  CIRCUITS_PATH: path.join(__dirname, '../circuits/build'),
  TRACK_EXTERNAL_BUYS: true,
  EXTERNAL_SELL_PERCENT: 20,
  PROFIT_WALLET: process.env.PROFIT_WALLET || '0x42069c220DD72541C2C7Cb7620f2094f1601430A',
  // Expose for UI
  TARGET_DAILY_VOLUME_ETH,
  ACTIVE_AGENTS_PER_ROUND,
};

// =============================================================================
// STATE
// =============================================================================

interface Stats {
  round: number;
  buys: number;
  sells: number;
  volume: bigint;
  extBuys: number;
  profit: bigint;
  ethRes: bigint;
  tokRes: bigint;
  price: number;
  priceHist: number[];
  trades: { time: string; agent: number; action: string; amt: string; result: string }[];
  agents: Map<number, { b: number; s: number; pnl: number; strat: string }>;
  start: number;
  running: boolean;
  paused: boolean;
  dumping: boolean;
  reacting: boolean;
}

const S: Stats = {
  round: 0, buys: 0, sells: 0, volume: 0n, extBuys: 0, profit: 0n,
  ethRes: 0n, tokRes: 0n, price: 0, priceHist: [],
  trades: [], agents: new Map(), start: Date.now(), running: true, paused: false, dumping: false, reacting: false,
};

// =============================================================================
// CRYPTO HELPERS
// =============================================================================

// Suppress snarkjs console output during proof generation
// Note: Don't suppress stdout/stderr.write or blessed UI will freeze
async function silentProve<T>(fn: () => Promise<T>): Promise<T> {
  const origErr = console.error;
  const origLog = console.log;
  const origWarn = console.warn;
  console.error = () => {};
  console.log = () => {};
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.error = origErr;
    console.log = origLog;
    console.warn = origWarn;
  }
}

const FIELD_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const ZERO_VALUE = 21663839004416932945382355908790599225266501822907911457504978515578255421292n;

const randField = (): bigint => {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b.reduce((v, x) => (v << 8n) | BigInt(x), 0n) % FIELD_PRIME;
};

const deriveNull = (pk: string, i: number): bigint =>
  BigInt(ethers.keccak256(ethers.solidityPacked(['bytes32', 'string', 'uint256'], [pk, 'nullifier', i]))) % FIELD_PRIME;

const deriveSec = (pk: string, i: number): bigint =>
  BigInt(ethers.keccak256(ethers.solidityPacked(['bytes32', 'string', 'uint256'], [pk, 'secret', i]))) % FIELD_PRIME;

const hashComm = (n: bigint, s: bigint, a: bigint): bigint => poseidon3([n, s, a]);
const hashNull = (n: bigint, i: number): bigint => poseidon2([n, BigInt(i)]);
const hashPair = (l: bigint, r: bigint): bigint => poseidon2([l, r]);
const pubBind = (m: bigint, r: string, l: string, f: bigint, c: bigint): bigint =>
  poseidon5([m, BigInt(r), BigInt(l), f, c]);

const orgAmt = (min: bigint, max: bigint, bal: bigint): bigint => {
  const mx = max < bal ? max : bal;
  if (mx <= min) return min;
  const range = mx - min;
  const f = Math.max(0, Math.min(1, (Math.random() + Math.random() + Math.random()) / 3 + (Math.random() - 0.5) * 0.3));
  const amt = min + BigInt(Math.floor(Number(range) * f));
  const rnd = (amt / ethers.parseEther('0.001')) * ethers.parseEther('0.001');
  return rnd > min ? rnd : min;
};

// =============================================================================
// MERKLE TREE
// =============================================================================

class MTree {
  private d: number;
  private l: Map<number, bigint> = new Map();
  private z: bigint[];
  private c: Map<number, bigint>[] | null = null;

  constructor(d = 24) {
    this.d = d;
    this.z = [ZERO_VALUE];
    for (let i = 1; i <= d; i++) this.z.push(hashPair(this.z[i - 1], this.z[i - 1]));
  }

  ins(i: number, v: bigint) { this.l.set(i, v); this.c = null; }

  proof(i: number): { path: bigint[]; idx: number[]; root: bigint } {
    const layers = this.build();
    const path: bigint[] = [], idx: number[] = [];
    let ci = i;
    for (let lv = 0; lv < this.d; lv++) {
      const left = ci % 2 === 0;
      idx.push(left ? 0 : 1);
      path.push(layers[lv].get(left ? ci + 1 : ci - 1) ?? this.z[lv]);
      ci = Math.floor(ci / 2);
    }
    return { path, idx, root: layers[this.d].get(0) ?? this.z[this.d] };
  }

  private build(): Map<number, bigint>[] {
    if (this.c) return this.c;
    const layers: Map<number, bigint>[] = [new Map(this.l)];
    for (let lv = 1; lv <= this.d; lv++) {
      layers[lv] = new Map();
      const pis = new Set<number>();
      for (const k of layers[lv - 1].keys()) pis.add(Math.floor(k / 2));
      const mx = this.l.size > 0 ? Math.max(...this.l.keys()) : 0;
      for (let j = 0; j <= Math.floor(mx / Math.pow(2, lv)); j++) pis.add(j);
      for (const pi of pis) {
        const lc = layers[lv - 1].get(pi * 2) ?? this.z[lv - 1];
        const rc = layers[lv - 1].get(pi * 2 + 1) ?? this.z[lv - 1];
        layers[lv].set(pi, hashPair(lc, rc));
      }
    }
    this.c = layers;
    return layers;
  }
}

// =============================================================================
// INDEXER (use Ponder for reads to avoid Alchemy rate limits)
// =============================================================================

const IDX = process.env.INDEXER_URL || 'https://ponder-indexer-production-50c3.up.railway.app';

// Cache for pool state to avoid repeated queries
let poolStateCache: { ethRes: bigint; tokRes: bigint; ts: number } | null = null;
const POOL_CACHE_TTL = 3000; // 3 seconds

// Fetch pool reserves from Ponder instead of direct RPC
async function fetchPoolState(pairAddr: string): Promise<{ ethRes: bigint; tokRes: bigint } | null> {
  // Return cached value if fresh
  if (poolStateCache && Date.now() - poolStateCache.ts < POOL_CACHE_TTL) {
    return { ethRes: poolStateCache.ethRes, tokRes: poolStateCache.tokRes };
  }

  try {
    const addr = pairAddr.toLowerCase();
    const r = await fetch(`${IDX}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{ poolStates(where:{id:"${addr}"}) { items { ethReserve tokenReserve } } }`
      }),
    });
    if (!r.ok) return null;
    const j = await r.json() as any;
    const item = j.data?.poolStates?.items?.[0];
    if (!item) return null;

    const result = {
      ethRes: BigInt(item.ethReserve || '0'),
      tokRes: BigInt(item.tokenReserve || '0'),
    };
    poolStateCache = { ...result, ts: Date.now() };
    return result;
  } catch {
    return null;
  }
}

// Cache for agent balances - updated in batches less frequently
const agentBalanceCache = new Map<string, { bal: bigint; ts: number }>();
const BALANCE_CACHE_TTL = 10000; // 10 seconds

async function getCachedBalance(prov: ethers.Provider, addr: string): Promise<bigint> {
  const cached = agentBalanceCache.get(addr);
  if (cached && Date.now() - cached.ts < BALANCE_CACHE_TTL) {
    return cached.bal;
  }
  // Not in cache or stale - will be updated by batch refresh
  return cached?.bal ?? 0n;
}

// Batch update agent balances with rate limiting
async function refreshAgentBalances(prov: ethers.Provider, addresses: string[]): Promise<void> {
  const BATCH_SIZE = 3; // Small batches to avoid rate limits
  const BATCH_DELAY = 500; // 500ms between batches

  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batch = addresses.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (addr) => {
        const bal = await prov.getBalance(addr);
        return { addr, bal };
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        agentBalanceCache.set(r.value.addr, { bal: r.value.bal, ts: Date.now() });
      }
    }

    if (i + BATCH_SIZE < addresses.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY));
    }
  }
}

// Retry helper with exponential backoff for RPC calls
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 5,
  baseDelayMs = 2000
): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      const is429 = e?.error?.code === 429 || e?.message?.includes('429') || e?.code === 'TIMEOUT' || e?.shortMessage?.includes('coalesce');
      if (is429 && attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000;
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw e;
      }
    }
  }
  throw lastError;
}

async function fetchComms(pair: string, retries = 3): Promise<{ c: bigint; i: number }[]> {
  const all: { c: bigint; i: number }[] = [];
  let cursor: string | null = null;
  const addr = pair.toLowerCase();

  for (let page = 0; page < 20; page++) { // Max 20 pages = 20k commitments
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const afterClause = cursor ? `,after:"${cursor}"` : '';
        const r = await fetch(`${IDX}/graphql`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `{commitmentss(limit:1000,where:{address:"${addr}"}${afterClause}){pageInfo{endCursor hasNextPage}items{leafIndex commitment}}}`
          }),
        });
        if (!r.ok) {
          if (attempt < retries - 1) { await new Promise(w => setTimeout(w, 1000 * (attempt + 1))); continue; }
          return all.length > 0 ? all : [];
        }
        const j = await r.json() as any;
        const items = j.data?.commitmentss?.items;
        if (!items) {
          if (attempt < retries - 1) { await new Promise(w => setTimeout(w, 1000 * (attempt + 1))); continue; }
          return all.length > 0 ? all : [];
        }
        for (const it of items) all.push({ c: BigInt(it.commitment), i: Number(it.leafIndex) });
        const pageInfo = j.data?.commitmentss?.pageInfo;
        if (!pageInfo?.hasNextPage) return all;
        cursor = pageInfo.endCursor;
        break; // Success, move to next page
      } catch {
        if (attempt < retries - 1) { await new Promise(w => setTimeout(w, 1000 * (attempt + 1))); continue; }
        return all.length > 0 ? all : [];
      }
    }
  }
  return all;
}

// =============================================================================
// ABIS
// =============================================================================

const ROUTER_ABI = [
  'function buyPrivate(uint256,uint256,uint256,bytes) payable',
  'function sellPrivate(uint256[8],uint256,uint256,uint256,uint256,address,address,uint256,uint256,uint256,uint256,bytes)',
  'function getAmountOut(uint256,uint256,uint256) view returns (uint256)',
  'event NewCommitment(uint256 indexed,uint256 indexed,bytes)',
  'event TokensPurchased(uint256,uint256,uint256,uint256)',
  'event TokensSold(uint256,uint256,uint256,uint256)',
];

const PAIR_ABI = [
  'function ethReserve() view returns (uint256)',
  'function tokenReserve() view returns (uint256)',
  'event TokensPurchased(uint256,uint256,uint256,uint256)',
  'event TokensSold(uint256,uint256,uint256,uint256)',
];

// =============================================================================
// NOTES & STRATEGIES
// =============================================================================

interface Note { c: bigint; n: bigint; s: bigint; a: bigint; i: number; spent: boolean; }
type Strat = 'MOM' | 'MEAN' | 'RAND' | 'BULL' | 'BEAR' | 'BAL' | 'CONTRA';
interface Dec { act: 'BUY' | 'SELL' | 'HOLD'; amt: bigint; }
interface Mkt { eR: bigint; tR: bigint; p: number; pH: number[]; }

const decide = (st: Strat, m: Mkt, eth: bigint, notes: Note[]): Dec => {
  const avail = notes.filter(n => !n.spent);
  const canBuy = eth > CONFIG.MIN_TRADE_ETH + CONFIG.GAS_BUFFER;
  const canSell = avail.length > 0;
  const buyAmt = () => orgAmt(CONFIG.MIN_TRADE_ETH, CONFIG.MAX_TRADE_ETH, eth - CONFIG.GAS_BUFFER);

  switch (st) {
    case 'MOM': {
      const trend = m.pH.length >= 2 ? m.pH[m.pH.length - 1] - m.pH[m.pH.length - 2] : 0;
      if (trend >= 0 && canBuy) return { act: 'BUY', amt: buyAmt() };
      if (trend < 0 && canSell) return { act: 'SELL', amt: avail[0].a };
      if (canBuy) return { act: 'BUY', amt: buyAmt() };
      return { act: 'HOLD', amt: 0n };
    }
    case 'MEAN': {
      if (m.pH.length < 3 && canBuy) return { act: 'BUY', amt: buyAmt() };
      const mean = m.pH.reduce((a, b) => a + b, 0) / m.pH.length;
      const dev = (m.p - mean) / mean;
      if (dev < -0.005 && canBuy) return { act: 'BUY', amt: buyAmt() };
      if (dev > 0.005 && canSell) return { act: 'SELL', amt: avail[0].a };
      if (Math.random() > 0.5 && canBuy) return { act: 'BUY', amt: buyAmt() };
      if (canSell) return { act: 'SELL', amt: avail[0].a };
      return { act: 'HOLD', amt: 0n };
    }
    case 'RAND': {
      const r = Math.random();
      if (r < 0.55 && canBuy) return { act: 'BUY', amt: buyAmt() };
      if (r < 0.95 && canSell) return { act: 'SELL', amt: avail[Math.floor(Math.random() * avail.length)].a };
      if (canBuy) return { act: 'BUY', amt: buyAmt() };
      return { act: 'HOLD', amt: 0n };
    }
    case 'BULL': {
      if (canBuy) return { act: 'BUY', amt: buyAmt() };
      if (canSell && Math.random() > 0.3) return { act: 'SELL', amt: avail[0].a };
      return { act: 'HOLD', amt: 0n };
    }
    case 'BEAR': {
      if (canSell) return { act: 'SELL', amt: avail[0].a };
      if (canBuy) return { act: 'BUY', amt: buyAmt() };
      return { act: 'HOLD', amt: 0n };
    }
    case 'BAL': {
      if (Math.random() < 0.5 && canBuy) return { act: 'BUY', amt: buyAmt() };
      if (canSell) return { act: 'SELL', amt: avail[0].a };
      if (canBuy) return { act: 'BUY', amt: buyAmt() };
      return { act: 'HOLD', amt: 0n };
    }
    case 'CONTRA': {
      const trend = m.pH.length >= 2 ? m.pH[m.pH.length - 1] - m.pH[m.pH.length - 2] : 0;
      if (trend > 0 && canSell) return { act: 'SELL', amt: avail[0].a };
      if (trend <= 0 && canBuy) return { act: 'BUY', amt: buyAmt() };
      if (canSell) return { act: 'SELL', amt: avail[0].a };
      return { act: 'HOLD', amt: 0n };
    }
  }
};

const STRATS: Strat[] = ['MOM', 'MEAN', 'RAND', 'BULL', 'BEAR', 'BAL', 'CONTRA'];

// =============================================================================
// AGENT
// =============================================================================

// Track recent transaction hashes from our agents (for filtering external buys)
const recentAgentTxHashes = new Set<string>();
const MAX_RECENT_TX = 200;

function trackAgentTx(hash: string) {
  recentAgentTxHashes.add(hash.toLowerCase());
  // Keep set bounded
  if (recentAgentTxHashes.size > MAX_RECENT_TX) {
    const first = recentAgentTxHashes.values().next().value;
    if (first) recentAgentTxHashes.delete(first);
  }
}

class Agent {
  id: number;
  w: Wallet;
  st: Strat;
  notes: Note[] = [];
  buys = 0;
  sells = 0;
  ethOut = 0n;
  ethIn = 0n;
  private router: ethers.Contract;
  private pair: ethers.Contract;
  private txLock = false; // Prevent concurrent transactions

  constructor(id: number, w: Wallet, st: Strat, prov: ethers.Provider) {
    this.id = id;
    this.w = w.connect(prov);
    this.st = st;
    this.router = new ethers.Contract(CONFIG.ZKAMM_ROUTER, ROUTER_ABI, this.w);
    this.pair = new ethers.Contract(CONFIG.ZKAMM_PAIR, PAIR_ABI, prov);
  }

  isLocked(): boolean { return this.txLock; }

  load() {
    const f = path.join(__dirname, `.notes-agent-${this.id}.json`);
    if (fs.existsSync(f)) {
      const d = JSON.parse(fs.readFileSync(f, 'utf-8'));
      this.notes = d.map((n: any) => ({
        c: BigInt(n.commitment), n: BigInt(n.nullifier), s: BigInt(n.secret),
        a: BigInt(n.amount), i: n.leafIndex, spent: n.spent,
      }));
    }
  }

  private save() {
    const f = path.join(__dirname, `.notes-agent-${this.id}.json`);
    fs.writeFileSync(f, JSON.stringify(this.notes.map(n => ({
      commitment: n.c.toString(), nullifier: n.n.toString(), secret: n.s.toString(),
      amount: n.a.toString(), leafIndex: n.i, spent: n.spent,
    })), null, 2));
  }

  async buy(amt: bigint, m: Mkt): Promise<{ ok: boolean; tok: bigint }> {
    if (this.txLock) return { ok: false, tok: 0n };

    try {
      const pk = (this.w as Wallet).privateKey;
      const nul = deriveNull(pk, this.buys);
      const sec = deriveSec(pk, this.buys);
      const expTok = await this.router.getAmountOut(amt, m.eR, m.tR);
      const comm = hashComm(nul, sec, expTok);
      const dl = BigInt(Math.floor(Date.now() / 1000) + 600);

      this.txLock = true;
      let tx, rc;
      try {
        tx = await this.router.buyPrivate(comm, 0n, dl, '0x', { value: amt, gasLimit: 1200000 });
        trackAgentTx(tx.hash); // Track our tx hash for external buy detection
        rc = await withRetry(() => tx.wait());
      } finally {
        this.txLock = false;
      }

      let leaf = 0, actTok = expTok;
      for (const log of rc.logs) {
        try {
          const p = this.router.interface.parseLog(log);
          if (p?.name === 'NewCommitment') leaf = Number(p.args[1]);
          if (p?.name === 'TokensPurchased') actTok = p.args[1];
        } catch {}
      }

      // Log if there's a mismatch between expected and actual tokens
      if (actTok !== expTok) {
        fs.appendFileSync('/tmp/sell-debug.log', `[${new Date().toISOString()}] Agent#${this.id}: BUY MISMATCH! expTok=${expTok}, actTok=${actTok}, diff=${actTok - expTok}\n`);
      }

      // Store expTok (committed amount) not actTok - commitment hash uses expTok
      this.notes.push({ c: comm, n: nul, s: sec, a: expTok, i: leaf, spent: false });
      this.buys++;
      this.ethOut += amt;
      this.save();
      return { ok: true, tok: actTok };
    } catch {
      this.txLock = false;
      return { ok: false, tok: 0n };
    }
  }

  async sell(amt: bigint): Promise<{ ok: boolean; eth: bigint; err?: string }> {
    const log = (msg: string) => fs.appendFileSync('/tmp/sell-debug.log', `[${new Date().toISOString()}] Agent#${this.id}: ${msg}\n`);

    // Prevent concurrent transactions from same agent
    if (this.txLock) {
      log(`SKIP: Transaction already pending`);
      return { ok: false, eth: 0n, err: 'LOCKED' };
    }
    this.txLock = true;

    try {
      // Check gas balance first using cache, fallback to RPC if needed
      const MIN_GAS_FOR_SELL = ethers.parseEther('0.001');
      let balance = agentBalanceCache.get(this.w.address)?.bal;
      if (!balance) {
        // Cache miss - do single RPC call
        balance = await this.w.provider!.getBalance(this.w.address);
        agentBalanceCache.set(this.w.address, { bal: balance, ts: Date.now() });
      }
      if (balance < MIN_GAS_FOR_SELL) {
        log(`SKIP: Insufficient gas balance (${ethers.formatEther(balance)} ETH < 0.001 ETH required)`);
        this.txLock = false;
        return { ok: false, eth: 0n, err: 'NO_GAS' };
      }

      const ni = this.notes.findIndex(n => !n.spent && n.a === amt);
      if (ni === -1) {
        log(`FAIL: No unspent note found with amount ${amt.toString()}`);
        this.txLock = false;
        return { ok: false, eth: 0n, err: 'NO_NOTE' };
      }

      const note = this.notes[ni];
      log(`Found note at index ${note.i}, commitment: ${note.c.toString().slice(0, 20)}...`);

      const comms = await fetchComms(CONFIG.ZKAMM_PAIR);
      if (comms.length === 0) {
        log(`FAIL: Indexer returned 0 commitments - indexer may be down or lagging`);
        this.txLock = false;
        return { ok: false, eth: 0n, err: 'IDX_DOWN' };
      }
      log(`Fetched ${comms.length} commitments from indexer`);

      // Check if our note's commitment exists in indexer data
      const noteInTree = comms.find(c => c.i === note.i);
      if (!noteInTree) {
        log(`FAIL: Note index ${note.i} not found in indexer data (max index: ${Math.max(...comms.map(c => c.i))})`);
        this.txLock = false;
        return { ok: false, eth: 0n, err: 'NOT_IN_TREE' };
      }
      if (noteInTree.c !== note.c) {
        log(`FAIL: Commitment mismatch at index ${note.i}. Local: ${note.c.toString().slice(0, 20)}..., Indexer: ${noteInTree.c.toString().slice(0, 20)}...`);
        this.txLock = false;
        return { ok: false, eth: 0n, err: 'COMM_MISMATCH' };
      }

      const tree = new MTree(24);
      for (const c of comms) tree.ins(c.i, c.c);
      const pf = tree.proof(note.i);
      const nullH = hashNull(note.n, note.i);
      const chgC = 0n, minE = 0n;
      log(`Merkle root: ${pf.root.toString().slice(0, 20)}..., nullifierHash: ${nullH.toString().slice(0, 20)}...`);

      const wasmP = path.join(CONFIG.CIRCUITS_PATH, 'sell/sell_js/sell.wasm');
      const zkeyP = path.join(CONFIG.CIRCUITS_PATH, 'sell/sell_final.zkey');
      if (!fs.existsSync(wasmP)) {
        log(`FAIL: Circuit wasm not found: ${wasmP}`);
        this.txLock = false;
        return { ok: false, eth: 0n, err: 'NO_WASM' };
      }
      if (!fs.existsSync(zkeyP)) {
        log(`FAIL: Circuit zkey not found: ${zkeyP}`);
        this.txLock = false;
        return { ok: false, eth: 0n, err: 'NO_ZKEY' };
      }

      const inp = {
        merkleRoot: pf.root.toString(), nullifierHash: nullH.toString(),
        tokenAmount: amt.toString(), minEthOut: minE.toString(),
        recipient: BigInt(this.w.address).toString(), relayer: BigInt(this.w.address).toString(),
        fee: '0', changeCommitment: chgC.toString(),
        nullifier: note.n.toString(), secret: note.s.toString(), amount: note.a.toString(),
        pathElements: pf.path.map(e => e.toString()), pathIndices: pf.idx,
        changeNullifier: '0', changeSecret: '0',
      };

      log(`Generating ZK proof...`);
      const result = await silentProve(() => snarkjs.groth16.fullProve(inp, wasmP, zkeyP));
      if (!result?.proof || !result?.publicSignals) {
        log(`FAIL: Proof generation returned null/undefined`);
        this.txLock = false;
        return { ok: false, eth: 0n, err: 'PROOF_FAIL' };
      }
      log(`Proof generated, ${result.publicSignals.length} public signals`);

      const { proof, publicSignals } = result;
      const sp: bigint[] = [
        BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1]),
        BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0]),
        BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0]),
        BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1]),
      ];

      // Use publicInputsBinding from circuit output (publicSignals[0]), not computed separately
      const circuitPib = BigInt(publicSignals[0]);
      const dl = BigInt(Math.floor(Date.now() / 1000) + 600);

      log(`Simulating sellPrivate call...`);
      try {
        await this.router.sellPrivate.staticCall(
          sp, pf.root, nullH, amt, minE,
          this.w.address, this.w.address, 0n, chgC, circuitPib, dl, '0x',
          { gasLimit: 1500000 }
        );
        log(`Simulation passed, submitting tx...`);
      } catch (simErr: any) {
        const errData = simErr?.data || simErr?.error?.data || '';
        let errCode = 'SIM_FAIL';
        if (errData.includes('b115d857')) errCode = 'SPENT'; // NullifierAlreadySpent
        else if (errData.includes('InvalidProof') || simErr?.message?.includes('InvalidProof')) errCode = 'BAD_PROOF';
        const reason = simErr?.reason || simErr?.revert?.name || simErr?.message || 'Unknown';
        log(`SIMULATION FAILED [${errCode}]: ${reason}`);
        if (simErr?.revert) log(`Revert details: ${JSON.stringify(simErr.revert)}`);
        // Mark note as spent if nullifier already used
        if (errCode === 'SPENT') {
          this.notes[ni].spent = true;
          this.save();
          log(`Marked note as spent (nullifier already used on-chain)`);
        }
        this.txLock = false;
        return { ok: false, eth: 0n, err: errCode };
      }

      let tx, rc;
      try {
        tx = await this.router.sellPrivate(
          sp, pf.root, nullH, amt, minE,
          this.w.address, this.w.address, 0n, chgC, circuitPib, dl, '0x',
          { gasLimit: 1500000 }
        );
        log(`Tx submitted: ${tx.hash}, waiting for confirmation...`);

        // Mark note as spent immediately after tx is submitted —
        // the nullifier is burned on-chain regardless of whether we
        // successfully wait for the receipt. This prevents "SPENT" errors
        // if tx.wait() fails due to rate limits but the tx actually lands.
        this.notes[ni].spent = true;
        this.save();

        rc = await withRetry(() => tx.wait());
        log(`Tx confirmed in block ${rc.blockNumber}, status: ${rc.status}`);
      } finally {
        this.txLock = false;
      }

      let ethRcv = 0n;
      for (const l of rc.logs) {
        try {
          const p = this.router.interface.parseLog(l);
          if (p?.name === 'TokensSold') { ethRcv = p.args[1]; break; }
        } catch {}
        try {
          const p = this.pair.interface.parseLog(l);
          if (p?.name === 'TokensSold') { ethRcv = p.args[1]; break; }
        } catch {}
      }

      this.sells++;
      this.ethIn += ethRcv;
      this.save();
      log(`SUCCESS: Sold ${ethers.formatEther(amt)} tokens for ${ethers.formatEther(ethRcv)} ETH`);
      return { ok: true, eth: ethRcv };
    } catch (e: any) {
      const errMsg = e?.reason || e?.message || e?.toString() || 'Unknown error';
      const errCode = e?.code || 'ERROR';
      log(`ERROR [${errCode}]: ${errMsg}`);
      if (e?.transaction) log(`Failed tx data: ${JSON.stringify({ to: e.transaction.to, data: e.transaction.data?.slice(0, 100) })}`);
      return { ok: false, eth: 0n, err: errCode };
    }
  }

  pnl(): number { return Number(ethers.formatEther(this.ethIn)) - Number(ethers.formatEther(this.ethOut)); }
}

// =============================================================================
// UI SETUP
// =============================================================================

const screen = blessed.screen({
  smartCSR: true,
  title: 'R00T Market Maker',
  cursor: { artificial: true, shape: 'block', blink: true, color: 'green' },
});

// Color scheme - cyberpunk trading terminal
const CLR = {
  bg: '#0a0a0f',
  fg: '#e0e0e0',
  border: '#1a1a2e',
  accent: '#00ff88',
  buy: '#00ff88',
  sell: '#ff4444',
  warn: '#ffaa00',
  muted: '#555566',
  highlight: '#00aaff',
};

// Header with ASCII art
const header = blessed.box({
  parent: screen,
  top: 0,
  left: 0,
  width: '100%',
  height: 7,
  content: `{bold}{#00ff88-fg}
    ██████╗  ██████╗  ██████╗ ████████╗
    ██╔══██╗██╔═══██╗██╔═══██╗╚══██╔══╝
    ██████╔╝██║   ██║██║   ██║   ██║
    ██╔══██╗██║   ██║██║   ██║   ██║
    ██║  ██║╚██████╔╝╚██████╔╝   ██║
    ╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝   {/}{#555566-fg} market maker v2.0 {/}{#00aaff-fg}■{/}{#555566-fg} zkAMM privacy trades{/}`,
  tags: true,
  style: { fg: CLR.fg, bg: CLR.bg },
});

// Status bar
const statusBar = blessed.box({
  parent: screen,
  top: 7,
  left: 0,
  width: '100%',
  height: 1,
  tags: true,
  style: { fg: CLR.fg, bg: '#111122' },
});

// Market panel
const marketPanel = blessed.box({
  parent: screen,
  top: 8,
  left: 0,
  width: '50%',
  height: 9,
  label: ' {bold}MARKET{/} ',
  tags: true,
  border: { type: 'line' },
  style: { fg: CLR.fg, bg: CLR.bg, border: { fg: CLR.border }, label: { fg: CLR.accent } },
});

// Profit panel
const profitPanel = blessed.box({
  parent: screen,
  top: 8,
  left: '50%',
  width: '50%',
  height: 9,
  label: ' {bold}PROFIT TRACKER{/} ',
  tags: true,
  border: { type: 'line' },
  style: { fg: CLR.fg, bg: CLR.bg, border: { fg: CLR.border }, label: { fg: CLR.warn } },
});

// Stats panel
const statsPanel = blessed.box({
  parent: screen,
  top: 17,
  left: 0,
  width: '100%',
  height: 3,
  tags: true,
  border: { type: 'line' },
  style: { fg: CLR.fg, bg: CLR.bg, border: { fg: CLR.border } },
});

// Trade log
const tradeLog = blessed.log({
  parent: screen,
  top: 20,
  left: 0,
  width: '100%',
  height: 'shrink',
  bottom: 4,
  label: ' {bold}TRADE LOG{/} ',
  tags: true,
  border: { type: 'line' },
  scrollable: true,
  alwaysScroll: true,
  scrollbar: { ch: '│', style: { fg: CLR.accent } },
  style: { fg: CLR.fg, bg: CLR.bg, border: { fg: CLR.border }, label: { fg: CLR.highlight } },
});

// Top agents
const agentPanel = blessed.box({
  parent: screen,
  bottom: 1,
  left: 0,
  width: '100%',
  height: 3,
  tags: true,
  border: { type: 'line' },
  style: { fg: CLR.fg, bg: CLR.bg, border: { fg: CLR.border } },
});

// Help bar
const helpBar = blessed.box({
  parent: screen,
  bottom: 0,
  left: 0,
  width: '100%',
  height: 1,
  content: ' {#555566-fg}[q]{/} quit  {#555566-fg}[p]{/} pause  {#555566-fg}[r]{/} refresh',
  tags: true,
  style: { fg: CLR.muted, bg: CLR.bg },
});

// Sparkline helper
const spark = (data: number[], w: number): string => {
  if (data.length < 2) return '{#555566-fg}' + '─'.repeat(w) + '{/}';
  const h = data.slice(-w);
  const min = Math.min(...h), max = Math.max(...h);
  const range = max - min || 1;
  const chars = '▁▂▃▄▅▆▇█';
  return h.map(p => {
    const n = (p - min) / range;
    const c = chars[Math.min(7, Math.floor(n * 8))];
    return n > 0.5 ? `{#00ff88-fg}${c}{/}` : `{#ff4444-fg}${c}{/}`;
  }).join('');
};

// Update UI
const updateUI = () => {
  const uptime = Math.floor((Date.now() - S.start) / 1000);
  const h = Math.floor(uptime / 3600);
  const m = Math.floor((uptime % 3600) / 60);
  const s = uptime % 60;
  const uptimeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  const tpm = uptime > 0 ? Math.round((S.buys + S.sells) / (uptime / 60)) : 0;

  const pChg = S.priceHist.length > 1 ? ((S.price - S.priceHist[0]) / S.priceHist[0] * 100) : 0;
  const pClr = pChg >= 0 ? '#00ff88' : '#ff4444';

  // Status bar
  const status = S.paused ? '{#ffaa00-fg}⏸ PAUSED{/}' : S.reacting ? '{#ff00ff-fg}⚡ REACTING{/}' : '{#00ff88-fg}● LIVE{/}';
  statusBar.setContent(` {#555566-fg}⏱{/} ${uptimeStr}  {#555566-fg}│{/}  {#555566-fg}⚡{/} ${tpm}/min  {#555566-fg}│{/}  ${status}  {#555566-fg}│{/}  Round {bold}${S.round}{/}`);

  // Market panel
  marketPanel.setContent(`
 {#555566-fg}PRICE{/}    {bold}{${pClr}-fg}${S.price.toExponential(3)}{/}  {${pClr}-fg}${pChg >= 0 ? '+' : ''}${pChg.toFixed(2)}%{/}
 {#555566-fg}ETH{/}      {#00aaff-fg}${ethers.formatEther(S.ethRes).slice(0, 12)}{/}
 {#555566-fg}ROOT{/}     {#00aaff-fg}${ethers.formatEther(S.tokRes).slice(0, 14)}{/}

 ${spark(S.priceHist, 40)}`);

  // Profit panel - also show daily volume config
  const actualIntervalSec = CONFIG.TRADE_INTERVAL_MS / 1000;
  const estDailyVol = CONFIG.TARGET_DAILY_VOLUME_ETH;
  profitPanel.setContent(`
 {#555566-fg}DAILY VOL{/}    {#00ffff-fg}~${estDailyVol} ETH/day{/}
 {#555566-fg}INTERVAL{/}     {#555566-fg}${actualIntervalSec.toFixed(1)}s{/}
 {#555566-fg}EXT BUYS{/}     {#ff00ff-fg}${S.extBuys}{/}
 {#555566-fg}EXTRACTED{/}    {#00ff88-fg}${ethers.formatEther(S.profit).slice(0, 10)} ETH{/}
 {#555566-fg}SELL %{/}       {#ffaa00-fg}${CONFIG.EXTERNAL_SELL_PERCENT}%{/}`);

  // Stats panel
  const vol = ethers.formatEther(S.volume).slice(0, 10);
  statsPanel.setContent(` {#00ff88-fg}▲{/} BUYS {bold}${S.buys}{/}    {#ff4444-fg}▼{/} SELLS {bold}${S.sells}{/}    {#ffaa00-fg}Σ{/} VOLUME {bold}${vol} ETH{/}    {#00aaff-fg}◎{/} AGENTS {bold}33{/}`);

  // Top agents
  const top3 = Array.from(S.agents.entries())
    .sort((a, b) => b[1].pnl - a[1].pnl)
    .slice(0, 5);

  if (top3.length > 0) {
    const strs = top3.map(([id, d]) => {
      const pClr = d.pnl >= 0 ? '#00ff88' : '#ff4444';
      return `{bold}#${id}{/} ${d.strat.padEnd(5)} {${pClr}-fg}${d.pnl >= 0 ? '+' : ''}${d.pnl.toFixed(4)}{/}`;
    });
    agentPanel.setContent(` {#555566-fg}TOP AGENTS{/}  ${strs.join('  {#333344-fg}│{/}  ')}`);
  }

  screen.render();
};

const logTrade = (time: string, agent: number, action: string, amt: string, result: string) => {
  const actClr = action.includes('BUY') ? '#00ff88' : action.includes('SELL') || action === 'REACT' ? '#ff4444' : '#ff00ff';
  const resClr = result.includes('✓') ? '#00ff88' : result.includes('🚨') ? '#ff00ff' : '#ff4444';
  tradeLog.log(`{#555566-fg}${time}{/}  {#888899-fg}#${agent.toString().padStart(2)}{/}  {${actClr}-fg}${action.padEnd(8)}{/}  {#ffaa00-fg}${amt.padEnd(14)}{/}  {${resClr}-fg}${result}{/}`);
};

// =============================================================================
// ORCHESTRATOR
// =============================================================================

class MM {
  private prov: ethers.Provider;
  private agents: Agent[] = [];
  private pair: ethers.Contract;
  private router: ethers.Contract;
  private addrs: Set<string> = new Set();

  constructor() {
    this.prov = new ethers.JsonRpcProvider(CONFIG.RPC_URL);
    this.pair = new ethers.Contract(CONFIG.ZKAMM_PAIR, PAIR_ABI, this.prov);
    this.router = new ethers.Contract(CONFIG.ZKAMM_ROUTER, ROUTER_ABI, this.prov);
  }

  async init(): Promise<void> {
    const pk = process.env.PRIVATE_KEY;
    if (!pk) { console.error('No PRIVATE_KEY'); process.exit(1); }

    for (let i = 0; i < CONFIG.NUM_AGENTS; i++) {
      const dk = ethers.keccak256(ethers.solidityPacked(['bytes32', 'uint256'], [pk, i + 1]));
      const w = new Wallet(dk);
      const st = STRATS[i % STRATS.length];
      const ag = new Agent(i + 1, w, st, this.prov);
      ag.load();
      this.agents.push(ag);
      this.addrs.add(w.address.toLowerCase());
      S.agents.set(i + 1, { b: ag.buys, s: ag.sells, pnl: ag.pnl(), strat: st });
    }

    // Initial rebalance disabled - too slow with rate limits
    // try {
    //   await this.rebalance();
    // } catch {}

    if (CONFIG.TRACK_EXTERNAL_BUYS) this.watchExt();
  }

  private watchExt() {
    const log = (msg: string) => fs.appendFileSync('/tmp/sell-debug.log', `[${new Date().toISOString()}] WATCH_EXT: ${msg}\n`);
    log('Started polling Ponder for external buys');

    let lastSeenId = '';
    let initialized = false; // Skip first poll to avoid false positives
    let reactInProgress = false; // Prevent concurrent react calls
    const POLL_INTERVAL = 3000; // 3 seconds

    const pollPonder = async () => {
      // Skip polling while a react is still in progress
      if (reactInProgress) return;

      try {
        const res = await fetch(`${IDX}/graphql`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `{ tradess(limit: 10, orderBy: "timestamp", orderDirection: "desc") { items { id type ethAmount tokenAmount timestamp transactionHash } } }`
          }),
        });

        if (!res.ok) return;
        const json = await res.json() as any;
        const trades = json.data?.tradess?.items || [];

        if (trades.length === 0) return;

        // Skip first poll - just set lastSeenId without detecting buys
        if (!initialized) {
          initialized = true;
          lastSeenId = trades[0].id;
          log(`Initialized with lastSeenId: ${lastSeenId}`);
          return;
        }

        // Find new buys since last poll (use old lastSeenId for comparison)
        const newBuys: any[] = [];
        for (const trade of trades) {
          if (trade.id === lastSeenId) break;
          if (trade.type === 'buy') {
            newBuys.push(trade);
          }
        }

        // Debug: log what we found
        if (newBuys.length > 0) {
          log(`Found ${newBuys.length} new buys since lastSeenId=${lastSeenId.slice(0, 16)}...`);
        }

        // Update last seen after comparison
        lastSeenId = trades[0].id;

        // Collect all external buys and aggregate their token amounts
        let totalExtTok = 0n;
        let totalExtEth = 0;
        for (const buy of newBuys.reverse()) {
          const txHash = buy.transactionHash?.toLowerCase() || '';
          const isOurs = recentAgentTxHashes.has(txHash);
          log(`Buy TX: ${txHash.slice(0, 16)}... isOurs=${isOurs} (tracked: ${recentAgentTxHashes.size})`);

          if (isOurs) continue;

          const ethIn = parseFloat(buy.ethAmount || '0');
          const tokOut = parseFloat(buy.tokenAmount || '0');

          log(`External buy detected! ETH: ${ethIn}, Tokens: ${tokOut}, TX: ${txHash.slice(0, 16)}...`);

          S.extBuys++;
          const time = new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 8);
          logTrade(time, 0, 'EXT BUY', `${ethIn.toFixed(4)} ETH`, '🚨 External!');

          totalExtTok += ethers.parseEther(tokOut.toString());
          totalExtEth += ethIn;
        }

        // React once for all aggregated external buys
        if (totalExtTok > 0n) {
          reactInProgress = true;
          try {
            await this.react(totalExtTok);
          } finally {
            reactInProgress = false;
          }
        }
      } catch (err: any) {
        reactInProgress = false;
        // Silent fail - don't spam logs on network errors
      }
    };

    // Initial poll to set lastSeenId
    pollPonder();

    // Start polling interval
    setInterval(pollPonder, POLL_INTERVAL);
  }

  private async react(tokOut: bigint): Promise<void> {
    const log = (msg: string) => fs.appendFileSync('/tmp/sell-debug.log', `[${new Date().toISOString()}] REACT: ${msg}\n`);

    const target = (tokOut * BigInt(CONFIG.EXTERNAL_SELL_PERCENT)) / 100n;
    log(`React triggered: selling ${CONFIG.EXTERNAL_SELL_PERCENT}% of ${ethers.formatEther(tokOut)} = ${ethers.formatEther(target)} tokens`);

    // Signal round() to stop starting new trades while we react
    S.reacting = true;

    // Wait briefly for any in-flight agent trades to settle
    await new Promise(r => setTimeout(r, 500));

    let sold = 0n, rcv = 0n, attempted = 0;

    // Collect eligible agents with unspent notes (skip locked ones)
    const eligible: { ag: Agent; notes: Note[] }[] = [];
    for (const ag of this.agents) {
      if (ag.isLocked()) {
        log(`Agent#${ag.id} is locked, skipping entirely`);
        continue;
      }
      const avail = ag.notes.filter(n => !n.spent);
      if (avail.length > 0) eligible.push({ ag, notes: avail });
    }

    if (eligible.length === 0) {
      log(`No eligible agents with unspent notes`);
      S.reacting = false;
      return;
    }

    // Build a flat list of sells needed, round-robin across agents
    const sellQueue: { ag: Agent; note: Note }[] = [];
    let tokenBudget = target;
    let noteIdx = 0;
    let hasMore = true;
    while (hasMore && tokenBudget > 0n) {
      hasMore = false;
      for (const { ag, notes } of eligible) {
        if (tokenBudget <= 0n) break;
        if (noteIdx < notes.length) {
          hasMore = true;
          sellQueue.push({ ag, note: notes[noteIdx] });
          tokenBudget -= notes[noteIdx].a;
        }
      }
      noteIdx++;
    }

    log(`Sell queue: ${sellQueue.length} notes across ${eligible.length} agents to meet target`);

    // Group by agent for parallel execution (each agent handles its notes sequentially)
    const byAgent = new Map<number, { ag: Agent; notes: Note[] }>();
    for (const { ag, note } of sellQueue) {
      if (!byAgent.has(ag.id)) byAgent.set(ag.id, { ag, notes: [] });
      byAgent.get(ag.id)!.notes.push(note);
    }

    // Execute sells in parallel across agents (sequential within each agent for nonce ordering)
    let successCount = 0;
    const agentPromises = Array.from(byAgent.values()).map(async ({ ag, notes }) => {
      let agSold = 0n, agRcv = 0n, agSuccess = 0;

      for (const note of notes) {
        attempted++;
        log(`Attempting sell: Agent#${ag.id}, note amount=${ethers.formatEther(note.a)}`);

        try {
          const r = await ag.sell(note.a);
          if (r.ok) {
            agSold += note.a;
            agRcv += r.eth;
            agSuccess++;
            const time = new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 8);
            logTrade(time, ag.id, 'REACT', `${ethers.formatEther(note.a).slice(0, 8)} ROOT`, `✓ ${ethers.formatEther(r.eth).slice(0, 6)} ETH`);
            S.agents.set(ag.id, { b: ag.buys, s: ag.sells, pnl: ag.pnl(), strat: ag.st });
            log(`Sell success: Agent#${ag.id}, got ${ethers.formatEther(r.eth)} ETH`);
          } else {
            log(`Sell failed: Agent#${ag.id}, err=${r.err}`);
          }
        } catch (err: any) {
          log(`Sell error: Agent#${ag.id} - ${err.message}`);
        }
      }

      return { agSold, agRcv, agSuccess };
    });

    const results = await Promise.allSettled(agentPromises);
    for (const r of results) {
      if (r.status === 'fulfilled') {
        sold += r.value.agSold;
        rcv += r.value.agRcv;
        successCount += r.value.agSuccess;
      }
    }

    S.profit += rcv;
    S.sells += successCount;
    S.volume += rcv;
    S.reacting = false;

    log(`React complete: attempted=${attempted}, success=${successCount}, sold=${ethers.formatEther(sold)} of ${ethers.formatEther(target)} target, received=${ethers.formatEther(rcv)} ETH`);
  }

  async update(): Promise<void> {
    try {
      // Use Ponder indexer instead of direct RPC to avoid rate limits
      const poolState = await fetchPoolState(CONFIG.ZKAMM_PAIR);
      if (poolState) {
        S.ethRes = poolState.ethRes;
        S.tokRes = poolState.tokRes;
      } else {
        // Fallback to RPC only if Ponder fails
        S.ethRes = await this.pair.ethReserve();
        S.tokRes = await this.pair.tokenReserve();
      }
      if (S.tokRes > 0n) S.price = Number(S.ethRes) / Number(S.tokRes);
      S.priceHist.push(S.price);
      if (S.priceHist.length > 60) S.priceHist.shift();
    } catch {
      // Ignore errors - use last known values
    }
  }

  async rebalance(): Promise<void> {
    const MIN_BALANCE = ethers.parseEther('0.006'); // Minimum each agent needs
    const TARGET_BALANCE = ethers.parseEther('0.01'); // Target balance per agent
    const REBALANCE_THRESHOLD = ethers.parseEther('0.015'); // Only take from agents above this
    const GAS_COST = ethers.parseEther('0.0002'); // Approx cost of transfer

    // Get balances using cached system with rate-limited refresh
    const addresses = this.agents.map(ag => ag.w.address);
    await refreshAgentBalances(this.prov, addresses);

    const balances: { agent: Agent; balance: bigint }[] = [];
    for (const ag of this.agents) {
      const bal = agentBalanceCache.get(ag.w.address)?.bal ?? 0n;
      if (bal > 0n) balances.push({ agent: ag, balance: bal });
    }

    // Find poor agents (below minimum) and rich agents (above threshold)
    const poor = balances.filter(b => b.balance < MIN_BALANCE).sort((a, b) => Number(a.balance - b.balance));
    const rich = balances.filter(b => b.balance > REBALANCE_THRESHOLD).sort((a, b) => Number(b.balance - a.balance));

    if (poor.length === 0 || rich.length === 0) return;

    const log = (msg: string) => fs.appendFileSync('/tmp/sell-debug.log', `[${new Date().toISOString()}] REBALANCE: ${msg}\n`);
    log(`Found ${poor.length} poor agents, ${rich.length} rich agents`);

    // Transfer from rich to poor
    for (const poorAgent of poor) {
      const needed = TARGET_BALANCE - poorAgent.balance;
      if (needed <= 0n) continue;

      for (const richAgent of rich) {
        const available = richAgent.balance - TARGET_BALANCE - GAS_COST;
        if (available <= 0n) continue;

        const toSend = available > needed ? needed : available;
        if (toSend < ethers.parseEther('0.001')) continue; // Skip tiny transfers

        try {
          const signer = richAgent.agent.w.connect(this.prov) as Wallet;
          const tx = await signer.sendTransaction({
            to: poorAgent.agent.w.address,
            value: toSend,
            gasLimit: 21000
          });
          await withRetry(() => tx.wait());

          richAgent.balance -= toSend + GAS_COST;
          poorAgent.balance += toSend;
          // Update cache
          agentBalanceCache.set(richAgent.agent.w.address, { bal: richAgent.balance, ts: Date.now() });
          agentBalanceCache.set(poorAgent.agent.w.address, { bal: poorAgent.balance, ts: Date.now() });

          log(`Sent ${ethers.formatEther(toSend)} ETH from Agent#${richAgent.agent.id} to Agent#${poorAgent.agent.id}`);

          if (poorAgent.balance >= MIN_BALANCE) break;
        } catch (e: any) {
          log(`Transfer failed: ${e.message}`);
        }
      }
    }
  }

  async sellAll(): Promise<void> {
    const log = (msg: string) => fs.appendFileSync('/tmp/sell-debug.log', `[${new Date().toISOString()}] SELL_ALL: ${msg}\n`);

    // Fetch current merkle tree state to verify notes
    const comms = await fetchComms(CONFIG.ZKAMM_PAIR);
    if (comms.length === 0) {
      log('Cannot verify notes - indexer returned 0 commitments');
      logTrade(new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 8), 0, 'SELL ALL', 'Error', 'Indexer down');
      return;
    }

    const commMap = new Map(comms.map(c => [c.i, c.c]));
    log(`Fetched ${comms.length} commitments from indexer for verification`);

    // Collect all unspent notes from all agents AND verify they exist in merkle tree
    const allNotes: { agent: Agent; note: Note }[] = [];
    let skippedInvalid = 0;
    for (const ag of this.agents) {
      for (const note of ag.notes.filter(n => !n.spent)) {
        const onChain = commMap.get(note.i);
        if (onChain && onChain === note.c) {
          allNotes.push({ agent: ag, note });
        } else {
          skippedInvalid++;
          log(`Skipping invalid note: Agent#${ag.id} index=${note.i} (${onChain ? 'commitment mismatch' : 'not in tree'})`);
          // Mark as spent since it's invalid
          note.spent = true;
          ag.save();
        }
      }
    }

    if (allNotes.length === 0) {
      log(`No valid unspent notes to sell (${skippedInvalid} invalid notes marked as spent)`);
      logTrade(new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 8), 0, 'SELL ALL', 'No valid notes', `${skippedInvalid} invalid`);
      return;
    }

    log(`Starting SELL ALL: ${allNotes.length} valid notes (${skippedInvalid} invalid skipped)`);
    logTrade(new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 8), 0, 'SELL ALL', `${allNotes.length} valid`, `${skippedInvalid} invalid`);

    // Rebalance first to ensure agents have gas
    try { await this.rebalance(); } catch {}

    let sold = 0, failed = 0, totalEth = 0n;

    // Group notes by agent to process sequentially per agent
    const notesByAgent = new Map<number, { agent: Agent; notes: Note[] }>();
    for (const { agent, note } of allNotes) {
      if (!notesByAgent.has(agent.id)) {
        notesByAgent.set(agent.id, { agent, notes: [] });
      }
      notesByAgent.get(agent.id)!.notes.push(note);
    }

    // Process round-robin: one note per agent at a time
    let hasMore = true;
    let round = 0;
    while (hasMore) {
      hasMore = false;
      const batch: { agent: Agent; note: Note }[] = [];

      for (const { agent, notes } of notesByAgent.values()) {
        if (round < notes.length) {
          hasMore = true;
          if (!agent.isLocked()) {
            batch.push({ agent, note: notes[round] });
          }
        }
      }

      if (batch.length === 0) {
        round++;
        continue;
      }

      const results = await Promise.allSettled(
        batch.map(async ({ agent, note }) => {
          const r = await agent.sell(note.a);
          return { agent, note, result: r };
        })
      );

      for (const res of results) {
        if (res.status === 'fulfilled' && res.value.result.ok) {
          sold++;
          totalEth += res.value.result.eth;
          S.sells++;
          S.volume += res.value.result.eth;
          const time = new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 8);
          logTrade(time, res.value.agent.id, 'SELL ALL', `${ethers.formatEther(res.value.note.a).slice(0, 8)} ROOT`, `✓ ${ethers.formatEther(res.value.result.eth).slice(0, 6)} ETH`);
          S.agents.set(res.value.agent.id, { b: res.value.agent.buys, s: res.value.agent.sells, pnl: res.value.agent.pnl(), strat: res.value.agent.st });
        } else {
          failed++;
        }
      }

      round++;

      // Rebalance every 3 rounds
      if (round % 3 === 0) {
        try { await this.rebalance(); } catch {}
      }

      // Small delay between rounds
      await new Promise(r => setTimeout(r, 300));
    }

    log(`SELL ALL complete: ${sold} sold, ${failed} failed, ${ethers.formatEther(totalEth)} ETH received`);
    logTrade(new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 8), 0, 'SELL ALL', `${sold}/${allNotes.length}`, `✓ ${ethers.formatEther(totalEth).slice(0, 8)} ETH`);
  }

  // FAST DUMP - Maximum velocity sell all (press 'S')
  async sellAllFast(): Promise<void> {
    const log = (msg: string) => fs.appendFileSync('/tmp/sell-debug.log', `[${new Date().toISOString()}] FAST_DUMP: ${msg}\n`);
    const startTime = Date.now();

    // Fetch current merkle tree state to verify notes
    const comms = await fetchComms(CONFIG.ZKAMM_PAIR);
    if (comms.length === 0) {
      log('Cannot verify notes - indexer returned 0 commitments');
      logTrade(new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 8), 0, 'FAST DUMP', 'Error', 'Indexer down');
      return;
    }

    const commMap = new Map(comms.map(c => [c.i, c.c]));
    log(`Fetched ${comms.length} commitments from indexer`);

    // Collect all valid unspent notes
    const allNotes: { agent: Agent; note: Note }[] = [];
    let skippedInvalid = 0;
    for (const ag of this.agents) {
      for (const note of ag.notes.filter(n => !n.spent)) {
        const onChain = commMap.get(note.i);
        if (onChain && onChain === note.c) {
          allNotes.push({ agent: ag, note });
        } else {
          skippedInvalid++;
          note.spent = true;
          ag.save();
        }
      }
    }

    if (allNotes.length === 0) {
      log(`No valid notes to dump`);
      logTrade(new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 8), 0, 'FAST DUMP', 'No notes', '');
      return;
    }

    log(`FAST DUMP: ${allNotes.length} notes (${skippedInvalid} invalid)`);
    logTrade(new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 8), 0, 'FAST DUMP', `${allNotes.length} notes`, '🚀 MAX VELOCITY');

    // Group notes by agent
    const notesByAgent = new Map<number, { agent: Agent; notes: Note[] }>();
    for (const { agent, note } of allNotes) {
      if (!notesByAgent.has(agent.id)) {
        notesByAgent.set(agent.id, { agent, notes: [] });
      }
      notesByAgent.get(agent.id)!.notes.push(note);
    }

    let totalSold = 0, totalFailed = 0, totalEth = 0n;

    // ALL agents dump in parallel - each agent processes its notes sequentially (nonce)
    let cancelled = false;
    const agentPromises = Array.from(notesByAgent.values()).map(async ({ agent, notes }) => {
      let sold = 0, failed = 0, eth = 0n;

      for (const note of notes) {
        // Check if user pressed 'p' to pause/cancel
        if (S.paused || cancelled) {
          cancelled = true;
          break;
        }

        try {
          const r = await agent.sell(note.a);
          const time = new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 8);
          if (r.ok) {
            sold++;
            eth += r.eth;
            S.sells++;
            S.volume += r.eth;
            logTrade(time, agent.id, 'DUMP', `${ethers.formatEther(note.a).slice(0, 8)} ROOT`, `✓ ${ethers.formatEther(r.eth).slice(0, 6)} ETH`);
          } else {
            failed++;
            logTrade(time, agent.id, 'DUMP', `${ethers.formatEther(note.a).slice(0, 8)} ROOT`, `✗ ${r.err || ''}`);
          }
        } catch {
          failed++;
        }
      }

      return { sold, failed, eth };
    });

    const results = await Promise.allSettled(agentPromises);
    for (const r of results) {
      if (r.status === 'fulfilled') {
        totalSold += r.value.sold;
        totalFailed += r.value.failed;
        totalEth += r.value.eth;
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const status = cancelled ? 'CANCELLED' : 'DONE';
    log(`FAST DUMP ${status}: ${totalSold} sold, ${totalFailed} failed, ${ethers.formatEther(totalEth)} ETH in ${elapsed}s`);
    logTrade(new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 8), 0, 'FAST DUMP', `${status} ${totalSold}/${allNotes.length}`, `${ethers.formatEther(totalEth).slice(0, 8)} ETH`);

    // Reset pause state after dump completes
    S.paused = false;
  }

  async round(): Promise<void> {
    const dbg = (msg: string) => fs.appendFileSync('/tmp/cli-debug.log', `[${new Date().toISOString()}] ROUND: ${msg}\n`);
    if (S.paused) { dbg('paused, skipping'); return; }
    if (S.reacting) { dbg('reacting to external buy, skipping round'); return; }
    S.round++;
    dbg(`Starting round ${S.round}`);
    await this.update();
    dbg(`Update done, reserves: ${ethers.formatEther(S.ethRes)} ETH, ${ethers.formatEther(S.tokRes)} ROOT`);

    // Rebalance every 10 rounds to keep agents funded (reduced from 5)
    if (S.round % 10 === 0) {
      try { await this.rebalance(); } catch {}
    }

    // Refresh balances once per round for a subset of agents (not all 33)
    const shuffledForBalances = [...this.agents].sort(() => Math.random() - 0.5).slice(0, 10);
    await refreshAgentBalances(this.prov, shuffledForBalances.map(a => a.w.address));

    const mkt: Mkt = { eR: S.ethRes, tR: S.tokRes, p: S.price, pH: S.priceHist };
    const shuffled = [...this.agents].sort(() => Math.random() - 0.5);
    const traders = shuffled.slice(0, Math.floor(Math.random() * 5) + 3); // Reduced: 3-7 traders per round

    // Stagger trades over ~10 seconds (spread evenly + random jitter)
    const ROUND_DURATION_MS = 10000;
    const delayPerAgent = ROUND_DURATION_MS / traders.length;

    const proms = traders.map(async (ag, idx) => {
      // Staggered delay: base delay + random jitter (±30%)
      const baseDelay = idx * delayPerAgent;
      const jitter = (Math.random() - 0.5) * delayPerAgent * 0.6;
      await new Promise(r => setTimeout(r, Math.max(0, baseDelay + jitter)));
      if (S.dumping || S.reacting) return; // Skip if dump or react in progress

      try {
        // Use cached balance instead of direct RPC call
        const eth = agentBalanceCache.get(ag.w.address)?.bal ?? 0n;
        if (eth === 0n) return; // Skip if no cached balance
        const dec = decide(ag.st, mkt, eth, ag.notes);
        if (dec.act === 'HOLD') return;
        if (S.dumping && dec.act === 'BUY') return; // Block buys during dump

        const time = new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 8);

        if (dec.act === 'BUY') {
          const r = await ag.buy(dec.amt, mkt);
          S.buys++;
          S.volume += dec.amt;
          logTrade(time, ag.id, 'BUY', `${ethers.formatEther(dec.amt).slice(0, 8)} ETH`, r.ok ? `✓ ${ethers.formatEther(r.tok).slice(0, 8)} ROOT` : '✗');
        } else {
          const r = await ag.sell(dec.amt);
          S.sells++;
          if (r.ok) S.volume += r.eth;
          logTrade(time, ag.id, 'SELL', `${ethers.formatEther(dec.amt).slice(0, 8)} ROOT`, r.ok ? `✓ ${ethers.formatEther(r.eth).slice(0, 6)} ETH` : `✗ ${r.err || ''}`);
        }

        S.agents.set(ag.id, { b: ag.buys, s: ag.sells, pnl: ag.pnl(), strat: ag.st });
      } catch {}
    });

    await Promise.race([Promise.allSettled(proms), new Promise(r => setTimeout(r, 35000))]);
  }

  async run(): Promise<void> {
    const dbg = (msg: string) => fs.appendFileSync('/tmp/cli-debug.log', `[${new Date().toISOString()}] ${msg}\n`);
    dbg('run() started');

    // Small delay at startup to let Alchemy rate limits reset
    logTrade('', 0, 'STARTING', 'Please wait...', 'Initializing');
    updateUI();
    dbg('waiting 2s...');
    await new Promise(r => setTimeout(r, 2000));
    dbg('2s wait done');

    // Initialize with retry on rate limit
    let initRetries = 3;
    while (initRetries > 0) {
      try {
        dbg('calling init()...');
        await this.init();
        dbg('init() completed');
        break;
      } catch (e: any) {
        dbg(`init() error: ${e?.message}`);
        if (e?.error?.code === 429 || e?.message?.includes('429')) {
          initRetries--;
          if (initRetries > 0) {
            await new Promise(r => setTimeout(r, 3000)); // Wait 3s before retry
          }
        } else {
          throw e;
        }
      }
    }

    dbg('starting UI interval');
    // Update UI every 200ms
    setInterval(updateUI, 200);

    // Main loop
    while (S.running) {
      try {
        await this.round();
        await new Promise(r => setTimeout(r, CONFIG.TRADE_INTERVAL_MS));
      } catch {}
    }
  }
}

// =============================================================================
// MAIN
// =============================================================================

screen.key(['q', 'C-c'], () => {
  S.running = false;
  screen.destroy();
  console.log('\n  R00T CLI stopped.\n');
  process.exit(0);
});

const mm = new MM();

screen.key(['p'], () => { S.paused = !S.paused; });
screen.key(['r'], () => { screen.render(); });
screen.key(['s'], () => {
  S.paused = true;
  logTrade(new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 8), 0, 'SELL ALL', 'Triggered', 'Normal speed');
  mm.sellAll().then(() => { S.paused = false; }).catch(() => { S.paused = false; });
});
let dumpInProgress = false;
screen.key(['d'], () => {
  if (dumpInProgress) return; // Prevent double-trigger
  dumpInProgress = true;
  S.dumping = true; // Block buys during dump
  logTrade(new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 8), 0, 'FAST DUMP', 'Triggered', '🚀 press p to cancel');
  mm.sellAllFast().then(() => { dumpInProgress = false; S.dumping = false; }).catch(() => { dumpInProgress = false; S.dumping = false; });
});

mm.run().catch(e => { screen.destroy(); console.error(e); process.exit(1); });
