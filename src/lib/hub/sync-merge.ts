// Pure helpers for poll/response adoption in the Weekly Sync client. Extracted
// so the comparable key (which gates whether a poll adopts) and the caret-
// preserving merge can be unit-tested independently of the DOM IIFE.
import type { ColumnData } from './sync-data';

// A stable string of a column's MEANINGFUL content — includes attribution
// (by/editedBy/editedAt) so an attribution-only change still triggers adoption.
// Empty untitled sections are dropped so cosmetic churn is ignored.
export function comparableCol(cd: ColumnData): string {
  return JSON.stringify(
    cd.sections
      .filter((s) => s.focuses.length > 0 || s.title.trim() !== '')
      .map((s) => ({
        t: s.title,
        f: s.focuses.map((x) => x.id + ':' + x.html + ':' + (x.by || '') + ':' + (x.editedBy || '') + ':' + (x.editedAt || 0)),
      })),
  );
}

// Adopt `incoming`, but if `caretFocusId` is the focus the user is actively
// typing in, keep `current`'s (the local MODEL's) copy of that one focus rather
// than overwriting it with the server's, so a concurrent same-focus edit can't
// stomp the model slot mid-typing. NOTE: this protects the MODEL only — the
// on-screen contenteditable holds keystrokes not yet committed to the model, so
// the client (adopt() in hub-client.ts) additionally snapshots + restores the
// live DOM + caret around the re-render. Everything else adopts.
export function mergeAdopt(current: ColumnData, incoming: ColumnData, caretFocusId: string | null): ColumnData {
  if (!caretFocusId) return incoming;
  const live = current.sections.flatMap((s) => s.focuses).find((f) => f.id === caretFocusId);
  if (!live) return incoming;
  return {
    v: 3,
    sections: incoming.sections.map((s) => ({
      ...s,
      focuses: s.focuses.map((f) => (f.id === caretFocusId ? live : f)),
    })),
  };
}
