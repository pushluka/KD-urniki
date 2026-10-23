import { randomBytes, createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, body, endpoint, json, sameOrigin } from "./api.ts";
import {
  GOOGLE_SCOPES,
  tokenVault,
  digest,
  cronMatches,
  calendarEvent,
  ownsGoogleEvent,
  type WorkEvent,
  type GoogleMapping,
} from "./google-core.ts";
const COOKIE = "kd_google_oauth";
const TOKEN = "https://oauth2.googleapis.com/token",
  API = "https://www.googleapis.com/calendar/v3";
type Connection = {
  user_id: string;
  generation: string;
  status: string;
  refresh_cipher: string | null;
  access_cipher: string | null;
  expires_at: string | null;
  calendar_id: string | null;
  provision_marker: string;
  provision_started_at: string | null;
  calendar_name: string | null;
  lease_token: string;
  last_error: string | null;
  last_synced_at: string | null;
};
type Job = {
  user_id: string;
  event_id: string;
  generation: string;
  lease_token: string;
  revision: number;
};
class GoogleFailure extends Error {
  reason: string;
  status: number;
  constructor(reason: string, status = 0) {
    super("Google request failed");
    this.reason = reason;
    this.status = status;
  }
}
function cookie(req: Request) {
  return (
    req.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(COOKIE + "="))
      ?.slice(COOKIE.length + 1) ?? ""
  );
}
export function createGoogleApi({
  admin,
  authorize,
  origin,
  clientId,
  clientSecret,
  encryptionKey,
  cronSecret,
  fetcher = fetch,
}: {
  admin: SupabaseClient;
  authorize: (
    req: Request,
    write?: boolean,
  ) => Promise<{ id: string; role: string }>;
  origin: string;
  clientId?: string;
  clientSecret?: string;
  encryptionKey?: string;
  cronSecret?: string;
  fetcher?: typeof fetch;
}) {
  const configured = !!(clientId && clientSecret && encryptionKey),
    redirectUri = origin + "/api/google/callback";
  const vault = configured ? tokenVault(encryptionKey!) : null;
  const aad = (user: string, kind: string) => `kd-google:${user}:${kind}`;
  async function rpc(name: string, args: Record<string, unknown> = {}) {
    const result = await admin.rpc(name, args);
    if (result.error)
      throw new ApiError(
        503,
        "Google Koledarja trenutno ni mogoče upravljati. Poskusite znova.",
      );
    return result.data;
  }
  async function staff(req: Request, write = false) {
    const u = await authorize(req, write);
    if (!["tehnik", "hostesa"].includes(u.role))
      throw new ApiError(
        403,
        "Google Koledar je namenjen tehnikom in hostesam.",
      );
    return u;
  }
  function configuration() {
    if (!configured)
      throw new ApiError(
        503,
        "Google Koledar še ni nastavljen. Obvestite administratorja.",
      );
  }
  async function tokenRequest(params: Record<string, string>) {
    let response: Response;
    try {
      response = await fetcher(TOKEN, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          ...params,
          client_id: clientId!,
          client_secret: clientSecret!,
        }),
      });
    } catch {
      throw new GoogleFailure("temporary");
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (result.error === "invalid_grant")
        throw new GoogleFailure("reauthorize", 401);
      throw new GoogleFailure("temporary", response.status);
    }
    if (
      typeof result.access_token !== "string" ||
      result.token_type?.toLowerCase() !== "bearer" ||
      !Number.isFinite(result.expires_in) ||
      result.expires_in <= 0
    )
      throw new GoogleFailure("temporary");
    return result as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope?: string;
    };
  }
  async function revoke(cipher: string | null, user: string) {
    if (!cipher || !vault) return;
    try {
      await fetcher("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(6000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: vault.open(cipher, aad(user, "refresh")),
        }),
      });
    } catch {
      /* Stop locally regardless of Google's availability; never log tokens. */
    }
  }
  const leaseArgs = (c: Connection, job?: Job) => ({
    p_user: c.user_id,
    p_generation: c.generation,
    p_lease: c.lease_token,
    p_event: job?.event_id ?? null,
    p_revision: job?.revision ?? null,
  });
  async function valid(c: Connection, job?: Job) {
    if (!(await rpc("google_lease_valid", leaseArgs(c, job))))
      throw new GoogleFailure("stale");
  }
  async function refresh(c: Connection) {
    await valid(c);
    if (!c.refresh_cipher) throw new GoogleFailure("reauthorize", 401);
    const tokens = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: vault!.open(c.refresh_cipher, aad(c.user_id, "refresh")),
    });
    const access = vault!.seal(tokens.access_token, aad(c.user_id, "access")),
      refresh = tokens.refresh_token
        ? vault!.seal(tokens.refresh_token, aad(c.user_id, "refresh"))
        : null,
      expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    if (
      !(await rpc("google_refresh", {
        p_user: c.user_id,
        p_generation: c.generation,
        p_lease: c.lease_token,
        p_access: access,
        p_refresh: refresh,
        p_expiry: expiry,
      }))
    )
      throw new GoogleFailure("stale");
    c.access_cipher = access;
    c.expires_at = expiry;
    if (refresh) c.refresh_cipher = refresh;
  }
  async function google(
    c: Connection,
    path: string,
    method = "GET",
    payload?: unknown,
    job?: Job,
    etag?: string,
  ): Promise<{ status: number; data: Record<string, any> }> {
    await valid(c, job);
    if (
      !c.access_cipher ||
      !c.expires_at ||
      new Date(c.expires_at).getTime() < Date.now() + 60000
    )
      await refresh(c);
    for (let attempt = 0; attempt < 2; attempt++) {
      await valid(c, job);
      let response: Response;
      try {
        response = await fetcher(API + path, {
          method,
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(6000),
          headers: {
            Authorization:
              "Bearer " +
              vault!.open(c.access_cipher!, aad(c.user_id, "access")),
            ...(payload ? { "Content-Type": "application/json" } : {}),
            ...(etag ? { "If-Match": etag } : {}),
          },
          ...(payload ? { body: JSON.stringify(payload) } : {}),
        });
      } catch {
        throw new GoogleFailure("temporary");
      }
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        if (attempt === 0) {
          await refresh(c);
          continue;
        }
        throw new GoogleFailure("reauthorize", 401);
      }
      if (response.status === 429 || response.status >= 500)
        throw new GoogleFailure("temporary", response.status);
      if (response.status === 403) {
        const reasons = (data.error?.errors ?? []).map(
          (r: { reason?: string }) => r.reason,
        );
        if (reasons.some((r: string) => /rateLimit|quota/i.test(r)))
          throw new GoogleFailure("temporary", 403);
        throw new GoogleFailure("permission_denied", 403);
      }
      return { status: response.status, data };
    }
    throw new GoogleFailure("reauthorize", 401);
  }
  async function acquire(user: string) {
    const c = (await rpc("google_acquire", {
      p_user: user,
    })) as Connection | null;
    if (!c?.user_id)
      throw new ApiError(
        409,
        "Povezava je zasedena ali ni pripravljena. Poskusite znova.",
      );
    return c;
  }
  async function pause(c: Connection, error: unknown) {
    const reason = error instanceof GoogleFailure ? error.reason : "temporary";
    if (
      ["reauthorize", "permission_denied", "calendar_missing"].includes(reason)
    )
      await rpc("google_pause", {
        p_user: c.user_id,
        p_generation: c.generation,
        p_lease: c.lease_token,
        p_status:
          reason === "reauthorize" ? "reauthorize" : "awaiting_calendar",
        p_error: reason,
      });
  }
  async function withConnection(
    user: string,
    action: (c: Connection) => Promise<Response>,
  ) {
    const c = await acquire(user);
    try {
      return await action(c);
    } catch (e) {
      await pause(c, e);
      if (e instanceof ApiError) throw e;
      throw new ApiError(
        503,
        "Povezava z Googlom ni uspela. Preverite stanje povezave in poskusite znova.",
      );
    } finally {
      await rpc("google_release", { p_user: user, p_lease: c.lease_token });
    }
  }
  async function mapResult(
    c: Connection,
    map: GoogleMapping,
    deleted: boolean,
    rotate = false,
  ) {
    return (await rpc("google_mapping_result", {
      p_user: c.user_id,
      p_generation: c.generation,
      p_lease: c.lease_token,
      p_id: map.id,
      p_deleted: deleted,
      p_rotate: rotate,
    })) as GoogleMapping | null;
  }
  async function process(job: Job) {
    let c: Connection | undefined;
    let result = "ok";
    try {
      const snapshot = await rpc("google_prepare", {
        p_user: job.user_id,
        p_generation: job.generation,
        p_lease: job.lease_token,
        p_event: job.event_id,
        p_revision: job.revision,
      });
      if (!snapshot?.connection) throw new GoogleFailure("stale");
      c = snapshot.connection;
      let map = snapshot.mapping as GoogleMapping | null;
      const desired = snapshot.desired as WorkEvent | null;
      if (!map?.id) return;
      const base = `/calendars/${encodeURIComponent(c!.calendar_id!)}/events`,
        path = () => base + "/" + encodeURIComponent(map!.google_event_id);
      let remote = await google(c!, path(), "GET", undefined, job);
      if (
        remote.status === 410 ||
        remote.data.status === "cancelled" ||
        (remote.status === 404 && map.remote_seen)
      ) {
        if (!desired) {
          await mapResult(c!, map, true);
          return;
        }
        map = await mapResult(c!, map, false, true);
        if (!map) throw new GoogleFailure("stale");
        remote = { status: 404, data: {} };
      }
      if (remote.status === 200) {
        if (!ownsGoogleEvent(remote.data, map))
          throw new GoogleFailure("event_conflict");
        if (!desired) {
          const deleted = await google(
            c!,
            path() + "?sendUpdates=none",
            "DELETE",
            undefined,
            job,
            remote.data.etag,
          );
          if (![200, 204, 404, 410].includes(deleted.status))
            throw new GoogleFailure(
              deleted.status === 412 ? "temporary" : "event_conflict",
              deleted.status,
            );
          await mapResult(c!, map, true);
          return;
        }
      } else if (remote.status !== 404)
        throw new GoogleFailure("temporary", remote.status);
      if (!desired) {
        await mapResult(c!, map, true);
        return;
      }
      const payload = calendarEvent(desired, map);
      if (remote.status === 404) {
        const inserted = await google(
          c!,
          base + "?sendUpdates=none",
          "POST",
          { ...payload, id: map.google_event_id },
          job,
        );
        if (inserted.status === 409) {
          remote = await google(c!, path(), "GET", undefined, job);
          if (remote.status !== 200) throw new GoogleFailure("temporary");
          if (!ownsGoogleEvent(remote.data, map))
            throw new GoogleFailure("event_conflict");
        } else if (inserted.status === 404)
          throw new GoogleFailure("calendar_missing", 404);
        else if (![200, 201].includes(inserted.status))
          throw new GoogleFailure("temporary", inserted.status);
        else {
          await mapResult(c!, map, false);
          return;
        }
      }
      const updated = await google(
        c!,
        path() + "?sendUpdates=none",
        "PATCH",
        payload,
        job,
        remote.data.etag,
      );
      if (![200, 201].includes(updated.status))
        throw new GoogleFailure("temporary", updated.status);
      await mapResult(c!, map, false);
    } catch (e) {
      result = e instanceof GoogleFailure ? e.reason : "temporary";
      if (c) await pause(c, e);
    } finally {
      await rpc("google_finish", {
        p_user: job.user_id,
        p_event: job.event_id,
        p_lease: job.lease_token,
        p_revision: job.revision,
        p_result: result,
      });
    }
  }
  return {
    status: (req: Request) =>
      endpoint(async () => {
        const u = await staff(req),
          c = (await rpc("google_connection", {
            p_user: u.id,
          })) as Connection | null;
        return json({
          configured,
          status: c?.status ?? "disconnected",
          calendar_name: c?.calendar_name ?? null,
          calendar_id: c?.calendar_id ?? null,
          last_error: c?.last_error ?? null,
          needs_restore: !!c?.provision_started_at,
          last_synced_at: c?.last_synced_at ?? null,
        });
      }),
    start: (req: Request) =>
      endpoint(async () => {
        configuration();
        const u = await staff(req, true);
        const state = randomBytes(32).toString("base64url"),
          bind = randomBytes(32).toString("base64url"),
          verifier = randomBytes(32).toString("base64url");
        await rpc("google_oauth_begin", {
          p_user: u.id,
          p_state: digest(state),
          p_cookie: digest(bind),
          p_verifier: vault!.seal(verifier, aad(digest(state), "pkce")),
        });
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        url.search = new URLSearchParams({
          client_id: clientId!,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: GOOGLE_SCOPES.join(" "),
          state,
          code_challenge: createHash("sha256")
            .update(verifier)
            .digest("base64url"),
          code_challenge_method: "S256",
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "false",
        }).toString();
        const response = json({ url: url.href });
        response.headers.set(
          "Set-Cookie",
          `${COOKIE}=${bind}; HttpOnly; SameSite=Lax; Path=/api/google; Max-Age=600${origin.startsWith("https:") ? "; Secure" : ""}`,
        );
        return response;
      }),
    callback: (req: Request) =>
      endpoint(async () => {
        configuration();
        const q = new URL(req.url).searchParams,
          state = q.get("state") ?? "",
          code = q.get("code") ?? "";
        if (
          !/^[A-Za-z0-9_-]{43}$/.test(state) ||
          !cookie(req) ||
          !code ||
          code.length > 4096
        )
          return Response.redirect(
            origin + "/nastavitve?google=cancelled",
            303,
          );
        const ok = await rpc("google_oauth_callback", {
          p_state: digest(state),
          p_cookie: digest(cookie(req)),
          p_code: vault!.seal(code, aad(digest(state), "code")),
        });
        const response = new Response(null, {
          status: 303,
          headers: {
            Location: ok
              ? origin + "/nastavitve/google?ticket=" + state
              : origin + "/nastavitve?google=expired",
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        });
        return response;
      }),
    finish: (req: Request) =>
      endpoint(async () => {
        configuration();
        const u = await staff(req, true),
          data = await body(req),
          ticket = data.ticket;
        if (
          typeof ticket !== "string" ||
          !/^[A-Za-z0-9_-]{43}$/.test(ticket) ||
          !cookie(req)
        )
          throw new ApiError(400, "Povezava je potekla. Začnite znova.");
        const flow = await rpc("google_oauth_take", {
          p_user: u.id,
          p_state: digest(ticket),
          p_cookie: digest(cookie(req)),
        });
        if (!flow?.code_cipher)
          throw new ApiError(
            400,
            "Povezava je potekla ali pripada drugemu računu.",
          );
        let tokens;
        try {
          tokens = await tokenRequest({
            grant_type: "authorization_code",
            code: vault!.open(flow.code_cipher, aad(digest(ticket), "code")),
            code_verifier: vault!.open(
              flow.verifier_cipher,
              aad(digest(ticket), "pkce"),
            ),
            redirect_uri: redirectUri,
          });
        } catch {
          throw new ApiError(400, "Google povezava ni uspela. Začnite znova.");
        }
        if (
          !tokens.refresh_token ||
          !GOOGLE_SCOPES.every((scope) =>
            tokens.scope?.split(" ").includes(scope),
          )
        ) {
          await revoke(
            vault!.seal(
              tokens.refresh_token ?? tokens.access_token,
              aad(u.id, "refresh"),
            ),
            u.id,
          );
          throw new ApiError(
            400,
            "Potrebno dovoljenje ni potrjeno ali ni trajnega dovoljenja. Povežite znova.",
          );
        }
        const refresh = vault!.seal(tokens.refresh_token, aad(u.id, "refresh"));
        const saved = await rpc("google_store_tokens", {
          p_user: u.id,
          p_generation: flow.generation,
          p_refresh: refresh,
          p_access: vault!.seal(tokens.access_token, aad(u.id, "access")),
          p_expiry: new Date(
            Date.now() + tokens.expires_in * 1000,
          ).toISOString(),
        });
        if (!saved) {
          await revoke(refresh, u.id);
          throw new ApiError(
            409,
            "Povezava se je medtem spremenila. Začnite znova.",
          );
        }
        const response = json({ connected: true });
        response.headers.set(
          "Set-Cookie",
          `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/google; Max-Age=0${origin.startsWith("https:") ? "; Secure" : ""}`,
        );
        return response;
      }),
    select: (req: Request) =>
      endpoint(async () => {
        configuration();
        const u = await staff(req, true),
          data = await body(req);
        if (
          data.calendar_id !== undefined &&
          (typeof data.calendar_id !== "string" ||
            data.calendar_id.length > 1024 ||
            !data.calendar_id)
        )
          throw new ApiError(400, "Neveljavni ID koledarja.");
        return withConnection(u.id, async (c) => {
          let target =
            typeof data.calendar_id === "string"
              ? data.calendar_id
              : c.calendar_id;
          let metadata: Record<string, any> | null = null;
          if (target) {
            const response = await google(
              c,
              "/calendars/" + encodeURIComponent(target),
            );
            if (response.status === 200) {
              if (
                !String(response.data.description ?? "").includes(
                  "kd-calendar:" + c.provision_marker,
                )
              )
                throw new ApiError(400, "To ni namenski koledar te povezave.");
              const ownership = await google(
                c,
                "/users/me/calendarList/" + encodeURIComponent(target),
              );
              if (
                ownership.status !== 200 ||
                ownership.data.accessRole !== "owner"
              )
                throw new ApiError(400, "Koledar mora biti v vaši lasti.");
              metadata = response.data;
            } else if (data.calendar_id)
              throw new ApiError(
                400,
                "Namenskega koledarja ni mogoče potrditi.",
              );
            else if (response.status !== 404 && response.status !== 410)
              throw new GoogleFailure("temporary", response.status);
          }
          if (!metadata) {
            if (data.create !== true)
              throw new ApiError(
                400,
                "Potrdite ustvarjanje namenskega koledarja.",
              );
            if (
              !(await rpc("google_begin_provision", {
                p_user: u.id,
                p_generation: c.generation,
                p_lease: c.lease_token,
              }))
            )
              throw new ApiError(
                409,
                "Prejšnje ustvarjanje ni potrjeno. V Googlu preverite namenski koledar in obnovite povezavo z njegovim ID.",
              );
            const created = await google(c, "/calendars", "POST", {
              summary: "KD Urniki – Moje delo",
              timeZone: "Europe/Ljubljana",
              description:
                "Moje dodelitve KD Urniki. kd-calendar:" + c.provision_marker,
            });
            if (created.status !== 200 && created.status !== 201)
              throw new GoogleFailure("temporary", created.status);
            metadata = created.data;
            target = metadata.id;
            if (typeof target !== "string" || !target)
              throw new GoogleFailure("temporary");
          }
          const ok = await rpc("google_resync", {
            p_user: u.id,
            p_generation: c.generation,
            p_lease: c.lease_token,
            p_calendar: target,
            p_name: String(metadata.summary ?? "KD Urniki – Moje delo").slice(
              0,
              500,
            ),
          });
          if (!ok) throw new ApiError(409, "Povezava se je spremenila.");
          return json({ selected: true });
        });
      }),
    disconnect: (req: Request) =>
      endpoint(async () => {
        const u = await staff(req, true),
          old = await rpc("google_disconnect", { p_user: u.id });
        await revoke(old?.refresh_cipher ?? null, u.id);
        return json({ disconnected: true });
      }),
    dispatch: (req: Request) =>
      endpoint(async () => {
        if (req.method === "GET") {
          if (!cronMatches(req, cronSecret))
            throw new ApiError(401, "Dostop ni dovoljen.");
        } else {
          sameOrigin(req, origin);
          const u = await authorize(req, true);
          if (u.role !== "administrator")
            throw new ApiError(403, "Dostop je dovoljen samo administratorju.");
        }
        configuration();
        const jobs = (await rpc("google_claim")) as Job[];
        await Promise.all(jobs.map(process));
        return json({ processed: jobs.length });
      }),
  };
}
