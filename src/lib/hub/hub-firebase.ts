// Read-only Firebase RTDB client for the hub Rate Simulator's Phase-2 live market
// overlay. Mirrors ias-dashboard/src/config/firebase.ts EXACTLY (same project,
// same databaseURL) so the engine reads the SAME backend the dashboard does — see
// hub-firebase.test.ts (no-silent-fork guard) and the runtime.ts D-39 contract
// ("both hosts MUST point at the SAME backends … forking … silently breaks the
// D-39 rate-type precedence").
//
// Every value here is the Firebase WEB config — public and client-safe (it's
// already committed in the dashboard repo). The engine only ever READS the RTDB
// (loadMarketRates / loadMarketBuckets via get()), and the `rate-simulator/*`
// path is public-read, so no auth token is needed or shipped.
//
// NOTE: the RTDB lives on firebaseio.com, NOT firebasedatabase.app (that host does
// not resolve for this project — live-verified 2026-06-26).
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getDatabase, forceWebSockets, type Database } from 'firebase/database';

export const HUB_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBgvsIXBCeoiFdv-G5BFpE8ZXgC22ye4HM',
  authDomain: 'weekly-sync-451e2.firebaseapp.com',
  databaseURL: 'https://weekly-sync-451e2-default-rtdb.firebaseio.com',
  projectId: 'weekly-sync-451e2',
  storageBucket: 'weekly-sync-451e2.firebasestorage.app',
  messagingSenderId: '245382048088',
  appId: '1:245382048088:web:7d1beef1b207d5168c5d2d',
} as const;

let _db: Database | null = null;

/** Lazily initialise (once) the hub's read-only RTDB handle. Lazy on purpose: so
 *  merely importing this module never calls initializeApp() — only the client sim
 *  path that actually quotes does — keeping firebase out of the SSR/build
 *  evaluation path. Reuses an existing default app if one is already initialised. */
export function getHubFirebaseDb(): Database {
  if (_db) return _db;
  const app: FirebaseApp = getApps().length ? getApp() : initializeApp(HUB_FIREBASE_CONFIG);
  // Force the WebSocket transport BEFORE the first read. The RTDB SDK otherwise
  // falls back to long-polling (`/.lp`), which works by injecting <script> tags —
  // governed by CSP `script-src`, not `connect-src`. Under the hub's strict CSP
  // (script-src 'self' only) those long-poll scripts are blocked, the read never
  // completes, and the overlay silently no-ops (browser-verified 2026-06-26).
  // WebSocket-only needs only `connect-src wss://…firebaseio.com` (already allowed)
  // and keeps script-src tight. Must run before any database operation.
  forceWebSockets();
  _db = getDatabase(app);
  return _db;
}
