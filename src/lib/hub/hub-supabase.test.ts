import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the supabase factory so we can assert HOW the client is constructed
// without a real network client.
const createClient = vi.hoisted(() => vi.fn(() => ({ __client: true })));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

import { getHubSupabase } from './hub-supabase';

beforeEach(() => createClient.mockClear());

describe('getHubSupabase', () => {
  it('returns null (and never constructs a client) when SUPABASE_URL is missing', () => {
    expect(getHubSupabase({ SUPABASE_SERVICE_ROLE_KEY: 'k' })).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns null when the service-role key is missing', () => {
    expect(getHubSupabase({ SUPABASE_URL: 'https://x.supabase.co' })).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns null when env is entirely empty', () => {
    expect(getHubSupabase({})).toBeNull();
  });

  it('constructs a service-role client with no session persistence when both are present', () => {
    const client = getHubSupabase({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' });
    expect(client).not.toBeNull();
    expect(createClient).toHaveBeenCalledWith('https://x.supabase.co', 'svc', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });
});
