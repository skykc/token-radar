// Token Radar's value model: a calibrated, snapshot-derived ranking.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a
// ceiling) and adds the 160 pre-token protocols below the watchlist floor with
// the most TVL. A protocol is pre-token when its record carries no token (no
// market cap, no CoinGecko id, no symbol); the live-token protocols are kept
// apart and shown with the market's own values, never mixed into the ranking.
//
// Implied value follows only from the snapshot's own figures:
//
//   multiple   = the category's calibrated multiple (see calibrateMultiples)
//   growth     = clamp(change_7d, -50, +100) per cent
//   growthMult = clamp(1 + growth / 100 * 0.5, 0.7, 1.6)
//   maturity   = 0.7 + 0.5 * (1 - exp(-age_days / 540))   (age unknown: 365)
//   chains     = 1 + min(chains - 1, 4) * 0.02
//   implied    = max(1, round(tvl_usd * multiple * growthMult * maturity * chains))
//
// The multiple is calibrated, not chosen: for every category, the median
// mcap_usd / tvl_usd of the snapshot's own tokenized protocols in that
// category, shrunk toward the overall median with a prior weight of 10
// (a category with few comparables leans on the whole market: one thin
// category's single outlier ratio must not set a billion-dollar price),
// then clamped to [0.03, 1.5] so a single outlier ratio cannot set a
// category's price. No protocol name is ever special-cased: the same
// function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One category's calibration: how many tokenized comparables it has, their
 *  median market-cap-per-TVL, and the multiple the model actually uses. */
export interface CalibrationRow {
  category: string;
  comparables: number;
  median_multiple: number;
  multiple_used: number;
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  growth_mult_floor: number;
  growth_mult_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_halflife_days: number;
  unknown_age_days: number;
  shrink_prior: number;
  multiple_floor: number;
  multiple_cap: number;
  chain_step: number;
  chain_max_steps: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  growth_mult_floor: 0.7,
  growth_mult_cap: 1.6,
  maturity_floor: 0.7,
  maturity_range: 0.5,
  maturity_halflife_days: 540,
  unknown_age_days: 365,
  shrink_prior: 10,
  multiple_floor: 0.03,
  multiple_cap: 1.5,
  chain_step: 0.02,
  chain_max_steps: 4,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 30;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    comparables: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  base_multiple: number;
  comparables: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_ratio: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  overall_median_multiple: number;
  calibration: CalibrationRow[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a sorted-ascending list of numbers (the list is sorted here). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The category multiples, calibrated from the snapshot's own tokenized
 * protocols: for each category, the median mcap_usd / tvl_usd of its
 * tokenized protocols (each ratio winsorized to [0.005, 5] first, so one
 * tiny-TVL protocol with an outsized market cap cannot bend the median),
 * shrunk toward the overall median with a prior weight of `shrink_prior`,
 * then clamped to [multiple_floor, multiple_cap]. A category with no
 * tokenized comparable uses the overall median outright.
 */
export function calibrateMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { overall: number; table: CalibrationRow[]; byCategory: Map<string, number>; counts: Map<string, number> } {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = Math.min(5, Math.max(0.005, p.mcap_usd / p.tvl_usd));
    all.push(ratio);
    const key = p.category ?? 'Unknown';
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  const overall = median(all);
  const table: CalibrationRow[] = [];
  const used = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const key of [...byCategory.keys()].sort()) {
    const ratios = byCategory.get(key)!;
    const med = median(ratios);
    const n = ratios.length;
    const shrunk = (med * n + overall * model.shrink_prior) / (n + model.shrink_prior);
    const multiple = Math.min(model.multiple_cap, Math.max(model.multiple_floor, shrunk));
    table.push({ category: key, comparables: n, median_multiple: round4(med), multiple_used: round4(multiple) });
    used.set(key, multiple);
    counts.set(key, n);
  }
  return { overall: round4(overall), table, byCategory: used, counts };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiple: number,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = Math.min(model.growth_mult_cap, Math.max(model.growth_mult_floor, 1 + (growthPct / 100) * model.growth_weight));
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + model.maturity_range * (1 - Math.exp(-Math.max(ageForModel, 0) / model.maturity_halflife_days));
  const chainMult = 1 + Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_max_steps) * model.chain_step;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * chainMult));
  return { implied, growthPct, growthMult, maturityMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. The
 *  calibration is computed once by the caller (buildRadar) and shared, so
 *  the snapshot is calibrated a single time per run. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  calibration: ReturnType<typeof calibrateMultiples> | null = null,
): BoardRow[] {
  const cal = calibration ?? calibrateMultiples(snapshot, model);
  const multipleFor = (p: SnapshotProtocol): { multiple: number; comparables: number } => {
    const key = p.category ?? 'Unknown';
    const m = cal.byCategory.get(key);
    if (m !== undefined) return { multiple: m, comparables: cal.counts.get(key) ?? 0 };
    return { multiple: cal.overall, comparables: 0 };
  };
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const { multiple, comparables } = multipleFor(p);
    const v = impliedValue(p, snapshot.as_of, multiple, model);
    return { p, multiple, comparables, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: round4(s.multiple),
      comparables: s.comparables,
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A second chain when the protocol runs on more than one, else the first. */
function secondChainOf(p: SnapshotProtocol): string {
  return p.chains.length > 1 ? p.chains[1]! : chainOf(p);
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** A gas estimate for one transaction on a chain: Ethereum costs more than the rest. */
function gasFor(chain: string): string {
  return chain === 'Ethereum' ? '$8-15' : '$1-4';
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * The category's two core actions, in the words a farmer can follow. Each
 * returns [main action, second action]; both name the protocol, the chain
 * and the capital, so the plan is the protocol's own, not a slogan.
 */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string, chain2: string): [string, string] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return [
      `Supply $${capital} of USDC to ${name} on ${chain} and leave the deposit earning.`,
      `Borrow $20 of USDC against the deposit on ${name}, then repay it the same week so the account shows both sides of the market.`,
    ];
  }
  if (c.includes('dex')) {
    return [
      `Provide $${capital} of liquidity to ${name}'s largest pool on ${chain} and keep the position in range.`,
      `Swap $25 between the pool's two assets on ${name} once, using the same wallet, so the address shows trading as well as liquidity.`,
    ];
  }
  if (c.includes('yield aggregator') || c.includes('yield')) {
    return [
      `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and hold the vault shares.`,
      `Stake the vault receipt on ${name} if it offers a staking page, and claim any yield it accrues instead of leaving it idle.`,
    ];
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return [
      `Bridge $${capital} of USDC to ${chain} through ${name} and keep the bridged funds in the destination app for a week.`,
      `Bridge $25 back through ${name} on a different day, so the wallet shows a round trip rather than a single one-way transfer.`,
    ];
  }
  if (c.includes('staking') || c.includes('restak')) {
    return [
      `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`,
      `Use the receipt as collateral or in a vault on ${chain} once, so the stake is visibly productive instead of sitting idle.`,
    ];
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return [
      `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position of about $20 notional.`,
      `Close the position after a few days and open a second one in the opposite direction, keeping the margin account funded throughout.`,
    ];
  }
  if (c.includes('prediction')) {
    return [
      `Fund $${capital} on ${name} and place one market position of about $20 on an outcome that settles within a month.`,
      `Place a second $10 position on a different market on ${name} the following week, so the account shows repeat activity.`,
    ];
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) {
    return [
      `Deposit $${capital} of USDC into a curated vault run through ${name} on ${chain} and hold the vault shares.`,
      `Deposit $25 more into a second vault on ${name} the following week, so the wallet shows two vaults rather than one deposit.`,
    ];
  }
  if (c.includes('stable')) {
    return [
      `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the farming wallet.`,
      `Swap $25 of the stable asset for USDC on ${chain} and back again once, so the wallet shows the asset in use.`,
    ];
  }
  if (c.includes('rwa')) {
    return [
      `Mint $${capital} of the protocol's yield-bearing asset on ${chain} through ${name} and hold it.`,
      `Move $25 of the asset into a second wallet or a vault on ${chain} once, so the holding shows an on-chain transfer.`,
    ];
  }
  if (c.includes('insurance')) {
    return [
      `Buy $${capital} of cover from ${name} on ${chain} for a 30-day period and keep the policy active.`,
      `File no claim; instead renew or extend the cover once before it lapses, so the account shows a paying customer.`,
    ];
  }
  if (c.includes('basis')) {
    return [
      `Deposit $${capital} of USDC as collateral on ${name} on ${chain} and open the basis position it offers.`,
      `Top the collateral up by $25 after the first week and leave the position open through the next funding cycle.`,
    ];
  }
  if (c.includes('payment') || c.includes('card')) {
    return [
      `Load $${capital} onto ${name} on ${chain} and make one real payment of about $10 with it.`,
      `Make a second payment of about $10 in the following week, so the account shows repeat spending rather than one load.`,
    ];
  }
  if (c.includes('launchpad')) {
    return [
      `Stake $${capital} of the launchpad's required asset on ${name} on ${chain} and register for the next sale.`,
      `Vote or complete the sale's checklist on ${name} once, so the account shows participation beyond the stake.`,
    ];
  }
  if (c.includes('chain')) {
    return [
      `Bridge $${capital} of USDC onto ${name}'s chain (${chain}) and use it in one app there.`,
      `Run one transaction a week on ${name}'s chain for a month, so the address shows sustained chain activity.`,
    ];
  }
  return [
    `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
    `Use a second feature of ${name} once, such as a swap, a vote or a claim on ${chain2}, with about $25.`,
  ];
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const chain2 = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const [mainAction, secondAction] = actionsFor(p, capital, chain, chain2);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm with ${p.name}, and keep its seed phrase offline on paper.`,
      cost: `under $3 of gas for the first transaction on ${chain}`,
      time: '5 minutes',
    },
    {
      text: mainAction,
      cost: `$${capital} of capital and about ${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction,
      cost: `about $25 of capital and about ${gas} of gas`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week on ${p.name}, such as a deposit, a swap, a borrow or a vote, and never let a week pass with no activity.`,
      cost: `about ${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot window.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page from the link it publishes and claim only there; then write the wallet, the dates and every transaction in a farm log.`,
      cost: 'no fee to check, and never pay to claim',
      time: '15 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl_ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_multiple: row.model.base_multiple,
    comparables: row.model.comparables,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const cal = calibrateMultiples(snapshot, model);
  const board = buildBoard(snapshot, model, cal);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    overall_median_multiple: cal.overall,
    calibration: cal.table,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
