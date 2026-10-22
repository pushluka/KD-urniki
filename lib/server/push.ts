import { createHash, timingSafeEqual, ECDH } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, body, endpoint, json, sameOrigin } from "./api.ts";
export type PushJob = {
  id: string;
  user_id: string;
  event_id: string;
  kind: "assigned" | "changed" | "removed";
  lease_token: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};
export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.port &&
      !u.username &&
      !u.password &&
      !u.hash &&
      [
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
      ].includes(u.hostname)
    );
  } catch {
    return false;
  }
}
function validKey(value: unknown, length: number) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value))
    return false;
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== length || decoded.toString("base64url") !== value)
    return false;
  if (length === 65) {
    try {
      ECDH.convertKey(decoded, "prime256v1");
    } catch {
      return false;
    }
  }
  return true;
}
function checked(result: { error: unknown }) {
  if (result.error)
    throw new ApiError(
      503,
      "Obvestil trenutno ni mogoče upravljati. Poskusite znova.",
    );
}
export function pushPayload(job: PushJob) {
  return JSON.stringify({
    title: "KD Urniki",
    body: {
      assigned: "Dodeljeni ste dogodku. Odprite aplikacijo za podrobnosti.",
      changed:
        "Vaše ure na dogodku so spremenjene. Odprite aplikacijo za podrobnosti.",
      removed:
        "Z dogodka ste bili odstranjeni. Odprite aplikacijo za podrobnosti.",
    }[job.kind],
    eventId: job.event_id,
    recipientId: job.user_id,
    notificationId: job.id,
  });
}
export function createPushApi({
  admin,
  authorize,
  origin,
  publicKey,
  cronSecret,
  send,
}: {
  admin: SupabaseClient;
  authorize: (
    req: Request,
    write?: boolean,
  ) => Promise<{ id: string; role: string }>;
  origin: string;
  publicKey?: string;
  cronSecret?: string;
  send: (job: PushJob, payload: string) => Promise<void>;
}) {
  async function staff(req: Request, write = false) {
    const user = await authorize(req, write);
    if (!["tehnik", "hostesa"].includes(user.role))
      throw new ApiError(
        403,
        "Nastavitve obvestil so na voljo tehnikom in hostesam.",
      );
    return user;
  }
  async function dispatch() {
    if (!publicKey)
      throw new ApiError(503, "Potisna obvestila niso nastavljena.");
    const claimed = await admin.rpc("claim_push", { p_vapid: publicKey });
    checked(claimed);
    const jobs = claimed.data as PushJob[];
    await Promise.all(
      jobs.map(async (job) => {
        let status = 204;
        try {
          if (!validPushEndpoint(job.endpoint)) status = 400;
          else await send(job, pushPayload(job));
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          status = typeof code === "number" ? code : 503;
        }
        const done = await admin.rpc("finish_push", {
          p_id: job.id,
          p_lease: job.lease_token,
          p_status: status,
        });
        // A failed acknowledgement leaves the lease for a later retry. Never log subscription keys/payloads.
        if (done.error) return;
      }),
    );
    return json({ processed: jobs.length });
  }
  return {
    status: (req: Request) =>
      endpoint(async () => {
        const user = await staff(req);
        const rows = await admin
          .from("push_subscriptions")
          .select("endpoint_hash")
          .eq("user_id", user.id)
          .eq("vapid_key", publicKey ?? "");
        checked(rows);
        return json({
          public_key: publicKey ?? null,
          endpoint_hashes: rows.data?.map((r) => r.endpoint_hash) ?? [],
        });
      }),
    subscribe: (req: Request) =>
      endpoint(async () => {
        const user = await staff(req, true);
        if (!publicKey)
          throw new ApiError(503, "Potisna obvestila niso nastavljena.");
        const data = await body(req),
          keys = data.keys as Record<string, unknown> | undefined;
        if (
          !validPushEndpoint(data.endpoint) ||
          !keys ||
          !validKey(keys.p256dh, 65) ||
          !validKey(keys.auth, 16)
        )
          throw new ApiError(
            400,
            "Naročnina ni veljavna oziroma ponudnik obvestil ni podprt.",
          );
        const rate = await admin.rpc("take_login_attempt", {
          p_bucket: createHash("sha256")
            .update("push:" + user.id)
            .digest("hex"),
          p_limit: 20,
          p_seconds: 60,
        });
        checked(rate);
        if (!rate.data)
          throw new ApiError(429, "Preveč poskusov. Poskusite čez minuto.");
        const result = await admin.rpc("register_push", {
          p_user: user.id,
          p_hash: createHash("sha256").update(data.endpoint).digest("hex"),
          p_endpoint: data.endpoint,
          p_p256dh: keys.p256dh,
          p_auth: keys.auth,
          p_vapid: publicKey,
        });
        checked(result);
        return json({ enabled: true });
      }),
    unsubscribe: (req: Request) =>
      endpoint(async () => {
        const user = await staff(req, true),
          data = await body(req);
        if (!validPushEndpoint(data.endpoint))
          throw new ApiError(400, "Neveljavna naročnina.");
        const result = await admin
          .from("push_subscriptions")
          .delete()
          .eq("user_id", user.id)
          .eq(
            "endpoint_hash",
            createHash("sha256").update(data.endpoint).digest("hex"),
          );
        checked(result);
        return json({ enabled: false });
      }),
    dispatch: (req: Request) =>
      endpoint(async () => {
        if (req.method === "GET") {
          const supplied = req.headers.get("authorization") ?? "",
            expected = "Bearer " + cronSecret;
          if (
            !cronSecret ||
            Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
            !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
          )
            throw new ApiError(401, "Dostop ni dovoljen.");
        } else {
          sameOrigin(req, origin);
          const user = await authorize(req, true);
          if (user.role !== "administrator")
            throw new ApiError(403, "Dostop je dovoljen samo administratorju.");
        }
        return dispatch();
      }),
  };
}
