import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverApi } from "./clients";
import { createGoogleApi } from "./google";
export function googleServer() {
  const api = serverApi(),
    url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!api || !url || !key) return null;
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return createGoogleApi({
    admin,
    authorize: api.authorizePush,
    origin: new URL(process.env.APP_URL!).origin,
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    encryptionKey: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,
    cronSecret: process.env.CRON_SECRET,
  });
}
