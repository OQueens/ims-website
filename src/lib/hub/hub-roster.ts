// Identity derivation for hub attribution (Weekly Sync + Recruitment pipeline).
// Email is the authoritative key (the authenticated hub session email). Name,
// initials, and colour are DERIVED from the email — no hardcoded roster required.
// SEED is an OPTIONAL real-name override map (empty by default); add an entry only
// to override the derived name for a specific address (KEYS MUST BE LOWERCASE —
// rosterEntry lowercases input before lookup). Unknown/empty emails degrade
// gracefully: the board never crashes and authorship is never fabricated.
export interface RosterEntry { name: string; initials: string; color: string; }

// Optional overrides only. Empty by default — real users get a derived identity.
const SEED: Record<string, RosterEntry> = {};
const FALLBACK_COLORS = ['#C44569', '#59BFE7', '#E8C465', '#7FB069', '#B388EB', '#F08A5D'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Derive a display identity from an email: split the local-part on . _ - and
// Title-Case each word ("zach.young@…" ⇒ "Zach Young", initials "ZY"). A SEED
// entry (if present) overrides the derived name. Colour is a deterministic hash.
export function rosterEntry(email: string): RosterEntry {
  const key = (email || '').trim().toLowerCase();
  if (!key) return { name: 'Unknown', initials: '?', color: '#8A8A8A' };
  if (SEED[key]) return SEED[key];
  const local = key.split('@')[0] || key;
  const parts = local.split(/[._-]+/).filter(Boolean);
  const name = parts.length ? parts.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : local;
  const initials = (parts.length ? parts.map((w) => w[0]).join('').slice(0, 2) : (local[0] || '?')).toUpperCase();
  return { name, initials, color: FALLBACK_COLORS[hash(key) % FALLBACK_COLORS.length] };
}
