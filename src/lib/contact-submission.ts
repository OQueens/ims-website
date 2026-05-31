import { validateContact } from './contact-validation';
import type { Audience } from './resend-server';

const AUDIENCES: readonly Audience[] = ['facility', 'clinician', 'other'];

const CAPS = { name: 120, email: 254, role: 160, message: 4000 } as const;

export interface ContactData {
  name: string;
  email: string;
  audience: Audience;
  role: string;
  message: string;
  turnstileToken: string;
}

export type ParseOutcome =
  | { kind: 'ok'; data: ContactData }
  | { kind: 'honeypot' }
  | { kind: 'invalid'; field: 'name' | 'email' | 'audience' | 'token' | 'message' };

/** Raw string fields pulled off the request body (FormData → strings). */
export interface ContactFields {
  name?: string;
  email?: string;
  audience?: string;
  role?: string;
  message?: string;
  turnstileToken?: string;
  /** Honeypot — must be empty for a human submission. */
  company?: string;
}

export function parseContactForm(f: ContactFields): ParseOutcome {
  const name = (f.name ?? '').trim();
  const email = (f.email ?? '').trim();
  const audience = (f.audience ?? '').trim();
  const role = (f.role ?? '').trim();
  const message = (f.message ?? '').trim();
  const turnstileToken = (f.turnstileToken ?? '').trim();
  const company = (f.company ?? '').trim();

  // Honeypot first: a filled hidden field = bot. Drop silently (the route
  // turns this into a success-shaped response so the bot does not retry).
  if (company) return { kind: 'honeypot' };

  // Shared predicate (single source of truth with the client island).
  const v = validateContact({ name, email, audience });
  if (!v.ok) return { kind: 'invalid', field: v.field };

  if (!AUDIENCES.includes(audience as Audience)) return { kind: 'invalid', field: 'audience' };
  if (!turnstileToken) return { kind: 'invalid', field: 'token' };

  if (name.length > CAPS.name) return { kind: 'invalid', field: 'name' };
  if (email.length > CAPS.email) return { kind: 'invalid', field: 'email' };
  if (message.length > CAPS.message) return { kind: 'invalid', field: 'message' };
  // role is optional and length-capped silently (truncate rather than reject).
  const safeRole = role.slice(0, CAPS.role);

  return {
    kind: 'ok',
    data: { name, email, audience: audience as Audience, role: safeRole, message, turnstileToken },
  };
}

/** Content negotiation: the JS fetch path sets Accept: application/json. */
export function wantsJson(accept: string | null): boolean {
  return !!accept && accept.includes('application/json');
}
