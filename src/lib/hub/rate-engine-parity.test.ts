// ⭐ THE PARITY GATE: proves the canonical LIVE engine still reproduces the FROZEN
// golden-master corpus (the behavioral contract / math truth). The corpus was
// generated from the engine's frozen baseline; this recomputes every case through
// the live copy and asserts deep equality. If this fails, engine BEHAVIOR changed;
// STOP and investigate the diff (do NOT re-vendor from the dead twin), never weaken it.
//
// Only imports the Phase-1 barrel (../rate-engine/index), whose closure excludes
// marketRates.ts — so this needs neither firebase nor any backend.
//
// Scope (no silent caps): this gate covers the PURE Phase-1 surface —
// calculateRate / calculateCallRate / parser / fuzzy / codec, across every
// specialty, multiplier branch, and state. The async live paths
// (evaluateBlsSanityCheck → CRNA cell envelope, marketRates overlays,
// cellAggregation) are Phase 2 and get their own parity coverage when wired.
//
// Comparator is toEqual, NOT toStrictEqual, BY DESIGN: the golden master is
// JSON, and JSON.stringify drops `undefined`-valued keys (e.g. optional
// CalculatedRate.marketMaxApplied) and normalizes -0 → 0. toStrictEqual would
// flag those round-trip artifacts as diffs; toEqual is the correct comparator
// for a live engine object vs a parsed-JSON expectation.
import { describe, it, expect } from 'vitest';
import gm from '../rate-engine/__tests__/goldenMaster.json';
import {
  calculateRate, calculateCallRate, parseFreetextInput,
  fuzzyMatchSpecialty, fuzzyMatchState, firebaseSafeKey, firebaseUnsafeKey,
} from '../rate-engine/index';
import type { RateFactors } from '../rate-engine/index';

type Case = { id: string; kind: string; input: unknown; output: unknown };

function recompute(c: Case): unknown {
  switch (c.kind) {
    case 'hourly': return calculateRate(c.input as RateFactors);
    case 'call': return calculateCallRate(c.input as RateFactors);
    case 'parse': return parseFreetextInput(c.input as string);
    case 'fuzzy-spec': return fuzzyMatchSpecialty(c.input as string);
    case 'fuzzy-state': return fuzzyMatchState(c.input as string);
    case 'codec': {
      const enc = firebaseSafeKey(c.input as string);
      return { enc, dec: firebaseUnsafeKey(enc) };
    }
    default: throw new Error(`unknown case kind: ${c.kind}`);
  }
}

describe('hub vendored engine is byte-identical to the canonical golden master', () => {
  const corpus = (gm as { cases: Case[] }).cases;

  it('corpus loaded and pinned to the exact golden-master count (drift tripwire)', () => {
    // Exact pin, not a floor: a legit corpus regen moves count + cases.length
    // together, so this catches a truncated/duplicated/silently-shrunk corpus.
    // Bump BOTH the number here and the JSON when the golden master is regenerated.
    expect((gm as { count: number }).count).toBe(207);
    expect(corpus.length).toBe(207);
    expect(corpus.length).toBe((gm as { count: number }).count);
  });

  for (const c of corpus) {
    it(c.id, () => {
      expect(recompute(c)).toEqual(c.output);
    });
  }
});
