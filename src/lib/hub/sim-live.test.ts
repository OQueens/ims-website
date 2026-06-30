import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SpecialtyRate } from '../rate-engine/specialties';

// Live RTDB snapshot, swapped per test. The hoisted firebase/database mock returns
// `snap.market` for ANY path, so loadMarketBuckets reads our fixture (a v2
// `market-rates-v2` tree) instead of the network. The legacy `market-rates` overlay
// (loadMarketRates) is RETIRED — initLiveMarket reads ONLY the v2 posterior tree.
const snap = vi.hoisted(() => ({ market: {} as Record<string, unknown> }));
vi.mock('firebase/database', () => ({
  ref: vi.fn(),
  get: vi.fn(() =>
    Promise.resolve({
      exists: () => Object.keys(snap.market).length > 0,
      val: () => snap.market,
    }),
  ),
}));
// Stub the hub Firebase client so initLiveMarket() doesn't initializeApp() in the
// test (ref/get are mocked, so the actual db handle is irrelevant).
vi.mock('./hub-firebase', () => ({
  HUB_FIREBASE_CONFIG: {},
  getHubFirebaseDb: () => ({}),
}));

import { get } from 'firebase/database';
import { initLiveMarket, __resetSimLive } from './sim-live';
import { quoteFromControls, type SimControls } from './sim-adapter';
import { SPECIALTIES } from '../rate-engine/specialties';
import { __resetEngineRuntime } from '../rate-engine/runtime';

// A v2 `market-rates-v2` tree:
//   - anesthesiology: a MARKET-TYPED (advertised_clinician_pay) posterior,
//     corroborated (n=5, 2 families) at $420 → ANCHORS the quote.
//   - radiology: a well-corroborated but INDIRECT (scraped_article_estimate)
//     posterior at $260 → must NOT anchor (priors-only); radiology stays curated.
//   - crna: absent → stays on its curated band.
const mktBucket = (rateType: string, mean: number) => ({
  __meta__: { lastUpdated: Date.now(), primaryRateType: rateType, coverageTier: 'primary' },
  national: {
    buckets: {
      [rateType]: {
        weighted_mean: mean, weighted_variance: 100, median: mean,
        confidence: 'multi_source', n_distinct: 5, n_raw: 8,
        source_families: ['serpapi', 'exa'], family_capped: false, lastUpdated: Date.now(),
      },
    },
  },
});
const liveV2 = () => ({
  anesthesiology: mktBucket('advertised_clinician_pay', 420),
  radiology: mktBucket('scraped_article_estimate', 260),
});

const controls = (specialtyKey: string): SimControls => ({
  specialtyKey, region: 'National', stateCode: null,
  shift: 'day', urgency: 'Standard', weeks: 12, marginPct: 22,
});

const RESTORE = ['anesthesiology', 'radiology', 'crna'];
let origs: Record<string, SpecialtyRate> = {};
beforeEach(() => {
  origs = {};
  for (const k of RESTORE) origs[k] = { ...SPECIALTIES[k] };
  snap.market = {};
  __resetSimLive();
  __resetEngineRuntime();
  vi.mocked(get).mockClear();
});
afterEach(() => {
  // The overlay mutates the SPECIALTIES singleton in place — restore so tests don't
  // leak overlays into each other (or the rest of the suite).
  for (const k of RESTORE) {
    Object.assign(SPECIALTIES[k], origs[k]);
    if (!('provenance' in origs[k])) delete (SPECIALTIES[k] as unknown as Record<string, unknown>).provenance;
  }
});

describe('initLiveMarket — wires the hub sim to the v2 posterior anchor (trust ladder)', () => {
  it('anchors the quote on a corroborated MARKET-TYPED posterior', async () => {
    snap.market = liveV2();
    const before = quoteFromControls(controls('anesthesiology'));
    expect(before.specMax).toBe(400); // static curated band

    await initLiveMarket();

    const after = quoteFromControls(controls('anesthesiology'));
    expect(SPECIALTIES.anesthesiology.p70).toBe(420);          // anchored to the posterior
    expect(after.specMax).toBe(420);                            // band widened to contain it
    expect(SPECIALTIES.anesthesiology.provenance).toBe('live');
    expect(after.payRate).toBeGreaterThan(before.payRate);     // 420 > static 370
  });

  it('does NOT anchor on an INDIRECT (scraped article) posterior — stays on the curated band', async () => {
    snap.market = liveV2();
    const before = quoteFromControls(controls('radiology'));
    expect(before.specMax).toBe(330); // static curated band, p70 287

    await initLiveMarket();

    const after = quoteFromControls(controls('radiology'));
    // The scraped $260 posterior must NOT have anchored radiology — the quote is
    // unchanged from its curated baseline (priors-only; RESEARCH §6).
    expect(after.payRate).toBe(before.payRate);
    expect(SPECIALTIES.radiology.p70).toBe(287);
    expect(SPECIALTIES.radiology.provenance).not.toBe('live');
  });

  it('leaves a specialty with no v2 posterior on its curated band (CRNA)', async () => {
    snap.market = liveV2();
    await initLiveMarket();

    const crna = quoteFromControls(controls('crna'));
    expect(crna.specMin).toBe(190);
    expect(crna.specMax).toBe(250); // curated band
  });

  it('is single-flight — re-quotes do not re-read the RTDB', async () => {
    snap.market = liveV2();
    await initLiveMarket();
    await initLiveMarket();
    // initLiveMarket now reads ONE RTDB path (market-rates-v2 via loadMarketBuckets);
    // the legacy market-rates overlay is retired. 1 = single-flight held (a
    // non-memoised second init would make it 2).
    expect(vi.mocked(get)).toHaveBeenCalledTimes(1);
  });
});
