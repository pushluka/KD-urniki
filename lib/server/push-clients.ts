import "server-only";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { createHash } from "node:crypto";
import { createPushApi } from "./push";
import { serverApi } from "./clients";
export function pushServer() {
  const api = serverApi(),
    url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!api || !url || !secret) return null;
  const publicKey = process.env.VAPID_PUBLIC_KEY,
    privateKey = process.env.VAPID_PRIVATE_KEY,
    subject = process.env.VAPID_SUBJECT;
  const configured = !!(publicKey && privateKey && subject);
  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return createPushApi({
    admin,
    authorize: api.authorizePush,
    origin: process.env.APP_URL!,
    publicKey: configured ? publicKey : undefined,
    cronSecret: process.env.CRON_SECRET,
    send: async (job, payload) => {
      if (!configured) throw new Error("Push unavailable");
      await webpush.sendNotification(
        {
          endpoint: job.endpoint,
          keys: { p256dh: job.p256dh, auth: job.auth },
        },
        payload,
        {
          vapidDetails: {
            subject: subject!,
            publicKey: publicKey!,
            privateKey: privateKey!,
          },
          TTL: 3600,
          urgency: "normal",
          timeout: 8000,
          topic: createHash("sha256")
            .update(job.id)
            .digest("base64url")
            .slice(0, 32),
        },
      );
    },
  });
}
