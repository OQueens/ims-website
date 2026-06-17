// Hub seed — STARTER content for the user-owned, editable surfaces only.
// Every METRIC in the hub is real (Overview + Analytics read ims_jobs +
// ls_events; the simulator uses the curated rate engine). What remains here is
// editable starter text the user replaces, not fabricated metrics:
//   • PRIORITIES — ships EMPTY (honest no-fake-data); the Overview renders an
//     empty state until a real, persisted, user-editable feature replaces it.
// (The Weekly Sync board no longer has a seed — a brand-new week starts BLANK;
//  see src/lib/hub/sync-data.ts. The simulator's fake PDF "auto-fill" was removed
//  — it never parsed the file — and returns with REAL parsing when the rate
//  calculator is ported.) Gated behind hub auth. No fabricated numbers.

export interface BarRow { name: string; val: number; fill: string; max?: number; label?: string; }
export interface Priority { txt: string; tag: 'high' | 'med' | 'low'; done: boolean; }

// Honest empty state — NO fabricated example priorities presented as real work
// (CLAUDE.md no-fake-data). The Overview shows "No priorities set this week" and
// hides the "{n} open" chip while this is empty. A real persisted, user-editable
// priorities feature (built on the Weekly Sync atomic write engine) is planned.
export const PRIORITIES: Priority[] = [];
