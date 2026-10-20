import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createApi, json } from "./api";
export function serverApi() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    secret = process.env.SUPABASE_SERVICE_ROLE_KEY,
    appUrl = process.env.APP_URL;
  if (!url || !key || !secret || !appUrl) return null;
  let origin: string;
  try {
    const u = new URL(appUrl);
    if (
      u.protocol !== "https:" &&
      !(
        u.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(u.hostname)
      )
    )
      return null;
    origin = u.origin;
  } catch {
    return null;
  }
  const options = {
    // Permission checks must never reuse a cached profile or Auth response.
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: "no-store" }),
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  };
  return createApi({
    admin: createClient(url, secret, options),
    auth: createClient(url, key, options),
    rateSecret: secret,
    appOrigin: origin,
  });
}
export const unavailable = () =>
  json(
    { error: "Strežniška prijava ni nastavljena. Obvestite skrbnika." },
    503,
  );
