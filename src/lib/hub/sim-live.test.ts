import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SpecialtyRate } from '../rate-engine/specialties';

// Live RTDB `rate-simulator/market-rates` snapshot, swapped per test. Mirrors the
// gate-2 market test's firebase/database mock (ref/get hoisted) so loadMarketRates
// reads our fixture instead of the network.
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

// The 2026-06-26 live RTDB snapshot: anesthesiology has a FRESH 3-family overlay
// (→ overlaid), crna is the single-source $298 "poison" (→ suppressed, 1 < 2
// families AND it's the curated-band displacement Fix A guards against).
const liveMarket = () => ({
  anesthesiology: {
    min: 240, max: 450, p70: 387,
    sources: ['serpapi_google', 'tavily_research', 'exa_semantic'],
    valueType: 'market', lastUpdated: Date.now(),
  },
  crna: {
    min: 190, max: 345, p70: 298.5,
    sources: ['tavily_research'],
    valueType: 'market', lastUpdated: Date.now(),
  },
});

const controls = (specialtyKey: string): SimControls => ({
  specialtyKey, region: 'National', stateCode: null,
  shift: 'day', urgency: 'Standard', weeks: 12, marginPct: 22,
});

let origAnes: SpecialtyRate;
let origCrna: SpecialtyRate;
beforeEach(() => {
  origAnes = { ...SPECIALTIES.anesthesiology };
  origCrna = { ...SPECIALTIES.crna };
  snap.market = {};
  __resetSimLive();
  __resetEngineRuntime();
  vi.mocked(get).mockClear();
});
afterEach(() => {
  // loadMarketRates mutates the SPECIALTIES singleton in place — restore it so
  // tests don't leak overlays into each other (or the rest of the suite).
  Object.assign(SPECIALTIES.anesthesiology, origAnes);
  if (!('provenance' in origAnes)) delete (SPECIALTIES.anesthesiology as unknown as Record<string, unknown>).provenance;
  Object.assign(SPECIALTIES.crna, origCrna);
  if (!('provenance' in origCrna)) delete (SPECIALTIES.crna as unknown as Record<string, unknown>).provenance;
});

describe('initLiveMarket — wires the hub sim to the live RTDB market overlay', () => {
  it('overlays a fresh multi-source specialty so the hub quote reflects live data', async () => {
    snap.market = liveMarket();
    const before = quoteFromControls(controls('anesthesiology'));
    expect(before.specMax).toBe(400); // static curated band

    await initLiveMarket();

    const after = quoteFromControls(controls('anesthesiology'));
    expect(after.specMin).toBe(240); // live overlay applied
    expect(after.specMax).toBe(450);
    expect(after.payRate).toBeGreaterThan(before.payRate); // p70 387 > static 370
  });

  it('leaves a single-source specialty on its curated band (CRNA $298 stays suppressed)', async () => {
    snap.market = liveMarket();
    await initLiveMarket();

    const crna = quoteFromControls(controls('crna'));
    expect(crna.specMin).toBe(190);
    expect(crna.specMax).toBe(250); // curated band, NOT the 345 single-source overlay
  });

  it('is single-flight — re-quotes do not re-read the RTDB', async () => {
    snap.market = liveMarket();
    await initLiveMarket();
    await initLiveMarket();
    expect(vi.mocked(get)).toHaveBeenCalledTimes(1);
  });
});
