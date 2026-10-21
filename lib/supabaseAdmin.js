import { createClient } from '@supabase/supabase-js';

// One client per server instance, reused across requests. Supabase pools the
// actual database connections behind its HTTP API, so reusing this client
// (and its keep-alive HTTP connections) is all the pooling the app needs.
let client = null;
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 1 } },
    });
  }
  return client;
}
