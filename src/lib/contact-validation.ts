export function validateContact(v: { name: string; email: string; audience: string }) {
  if (!v.name.trim()) return { ok: false, field: 'name' as const };
  if (!/.+@.+\..+/.test(v.email)) return { ok: false, field: 'email' as const };
  if (!v.audience) return { ok: false, field: 'audience' as const };
  return { ok: true as const };
}
