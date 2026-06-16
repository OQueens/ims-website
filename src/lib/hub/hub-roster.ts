// The 6-person management roster for Weekly Sync attribution. Email is the
// authoritative key (matched against the authenticated hub session email).
// ⚠️ CONFIRM: the *@confirm keys are PLACEHOLDERS — replace with the real work
// emails when provided (KEYS MUST BE LOWERCASE; rosterEntry lowercases input
// before lookup). Names/initials/colours are final. Unknown emails degrade
// gracefully — the board never crashes and authorship is never fabricated.
export interface RosterEntry { name: string; initials: string; color: string; }

const SEED: Record<string, RosterEntry> = {
  'zach@confirm':    { name: 'Zach',    initials: 'Z', color: '#C44569' },
  'donovan@confirm': { name: 'Donovan', initials: 'D', color: '#59BFE7' },
  'chad@confirm':    { name: 'Chad',    initials: 'C', color: '#E8C465' },
  'matt@confirm':    { name: 'Matt',    initials: 'M', color: '#7FB069' },
  'brent@confirm':   { name: 'Brent',   initials: 'B', color: '#B388EB' },
  'jon@confirm':     { name: 'Jon',     initials: 'J', color: '#F08A5D' },
};
const FALLBACK_COLORS = ['#C44569', '#59BFE7', '#E8C465', '#7FB069', '#B388EB', '#F08A5D'];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function rosterEntry(email: string): RosterEntry {
  const key = (email || '').trim().toLowerCase();
  if (!key) return { name: 'Unknown', initials: '?', color: '#8A8A8A' };
  if (SEED[key]) return SEED[key];
  const local = key.split('@')[0] || key;
  return { name: local, initials: (local[0] || '?').toUpperCase(), color: FALLBACK_COLORS[hash(key) % FALLBACK_COLORS.length] };
}

export function rosterPickerList(): { email: string; name: string }[] {
  return Object.entries(SEED).map(([email, e]) => ({ email, name: e.name }));
}
