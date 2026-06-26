import { describe, it, expect } from 'vitest';
import { HUB_FIREBASE_CONFIG } from './hub-firebase';

// The engine's market overlay (loadMarketRates / loadMarketBuckets) reads the
// SAME Firebase RTDB the rate fleet writes. If the hub points at a different
// databaseURL or project than the dashboard, it SILENTLY FORKS the backend —
// which breaks the D-39 rate-type precedence the runtime.ts seam guarantees
// ("both hosts MUST point at the SAME backends … forking … silently breaks the
// D-39 rate-type precedence"). This guard locks the hub config to the dashboard's
// (ias-dashboard/src/config/firebase.ts), live-verified 2026-06-26: the RTDB is
// on firebaseio.com — firebasedatabase.app does NOT resolve.
describe('hub Firebase config — no silent backend fork', () => {
  it('targets the weekly-sync-451e2 RTDB on firebaseio.com (NOT firebasedatabase.app)', () => {
    expect(HUB_FIREBASE_CONFIG.databaseURL).toBe(
      'https://weekly-sync-451e2-default-rtdb.firebaseio.com',
    );
    expect(HUB_FIREBASE_CONFIG.projectId).toBe('weekly-sync-451e2');
  });
});
