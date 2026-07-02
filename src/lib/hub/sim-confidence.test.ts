// The displayed confidence must be HONEST about the dollar figure, not just about
// whether we identified the specialty/geography. scoreConfidence (engine) is pure
// identification confidence (specialty + state → High). But the number is only as
// trustworthy as the underlying RESEARCH for that specialty (spec.confidence:
// high/medium/low). So the simulator shows the WEAKER of the two — e.g. CRNA is
// well-identified but its rate band is only 'medium'-researched, so a PA CRNA quote
// is Medium confidence, not High. This stops "High confidence" from implying a
// precision the static estimate doesn't have.
import { describe, it, expect } from 'vitest';
import { defaultControls, quoteFromControls } from './sim-adapter';

const conf = (specialtyKey: string, region: string, stateCode: string | null = null) =>
  quoteFromControls({ ...defaultControls(), specialtyKey, region, stateCode }).confidence;

describe('confidence honesty — weaker of identification vs data-tier', () => {
  it('CRNA + PA → Medium (data tier medium caps it), NOT High', () => {
    expect(conf('crna', 'Northeast', 'PA')).toBe('Medium');
  });

  it('anesthesiology + a state → Medium (curated bands are no longer high; data tier caps it)', () => {
    // After the honesty downgrade (5d6ce34) NO curated band is 'high' — the public
    // locum market exposes only ~1-2 posted-requisition families per band, short of
    // the >=3 the 'high' tier requires. So even a well-identified anesthesiology quote
    // caps at Medium; static 'High' is retired — only a corroborated LIVE market
    // posterior (the Move #1 overlay) earns 'high' now.
    expect(conf('anesthesiology', 'South', 'TX')).toBe('Medium');
  });

  it('CRNA National (no geo) → Medium', () => {
    expect(conf('crna', 'National', null)).toBe('Medium');
  });

  it('a low-data specialty (nephrology) even with geo → Low', () => {
    expect(conf('nephrology', 'South', 'TX')).toBe('Low');
  });

  it('exposes a human reason for the level', () => {
    const q = quoteFromControls({ ...defaultControls(), specialtyKey: 'crna', region: 'Northeast', stateCode: 'PA' });
    expect(typeof q.confidenceReason).toBe('string');
    expect(q.confidenceReason.length).toBeGreaterThan(0);
  });
});
