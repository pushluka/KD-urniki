import { randomBytes } from "node:crypto";
import { serverFixture, token } from "./server-fixture.mjs";
import { ids, asUser } from "./database.mjs";
import { createGoogleApi } from "../../lib/server/google.ts";
import { GOOGLE_SCOPES } from "../../lib/server/google-core.ts";
export const googleOrigin = "https://kd-urniki.vercel.app",
  calendarId = "work@group.calendar.google.com";
export function googleReq(
  path,
  user = ids.tech,
  data,
  method = data ? "POST" : "GET",
  cookie = "",
  headers = {},
) {
  return new Request(googleOrigin + path, {
    method,
    headers: {
      Authorization: "Bearer " + token(user),
      Origin: googleOrigin,
      "Content-Type": "application/json",
      Cookie: cookie,
      ...headers,
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}
export async function googleFixture(appOrigin = googleOrigin, suppliedFixture) {
  const f = suppliedFixture ?? (await serverFixture({ appOrigin })),
    remote = new Map(),
    calls = [],
    flags = {
      afterInsert: false,
      revoked: false,
      quota: false,
      calendarAfterCreate: false,
    };
  let revision = 0;
  let appCalendar = null;
  const encryptionKey = randomBytes(32).toString("base64");
  const fetcher = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url),
      method = init.method ?? "GET";
    const payload =
      typeof init.body === "string" &&
      init.headers?.["Content-Type"] === "application/json"
        ? JSON.parse(init.body)
        : null;
    calls.push({
      path: url.pathname,
      method,
      payload,
      cache: init.cache,
      redirect: init.redirect,
    });
    const res = (data, status = 200) => Response.json(data, { status });
    if (url.hostname === "oauth2.googleapis.com") {
      if (url.pathname === "/revoke") return res({});
      const grant = new URLSearchParams(init.body);
      if (flags.revoked) return res({ error: "invalid_grant" }, 400);
      return res({
        access_token: "test-google-access",
        refresh_token:
          grant.get("grant_type") === "authorization_code"
            ? "test-google-refresh"
            : undefined,
        token_type: "Bearer",
        expires_in: 3600,
        scope: GOOGLE_SCOPES.join(" "),
      });
    }
    if (url.hostname !== "www.googleapis.com")
      throw new Error("Unexpected host");
    if (flags.quota)
      return res({ error: { errors: [{ reason: "rateLimitExceeded" }] } }, 403);
    if (url.pathname === "/calendar/v3/calendars" && method === "POST") {
      appCalendar = { ...payload, id: calendarId };
      if (flags.calendarAfterCreate) {
        flags.calendarAfterCreate = false;
        throw new TypeError("Calendar response lost");
      }
      return res(appCalendar);
    }
    if (
      url.pathname ===
      "/calendar/v3/calendars/" + encodeURIComponent(calendarId)
    )
      return appCalendar ? res(appCalendar) : res({}, 404);
    if (url.pathname.startsWith("/calendar/v3/users/me/calendarList/")) {
      const id = decodeURIComponent(url.pathname.split("/").at(-1));
      return id === calendarId
        ? res({ id, summary: "Moje delo", accessRole: "owner" })
        : res({ id, summary: "Tuji", accessRole: "writer" });
    }
    const match = url.pathname.match(
      /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/,
    );
    if (!match) return res({}, 404);
    const cal = decodeURIComponent(match[1]);
    if (cal !== calendarId) return res({}, 404);
    const id = match[2] ? decodeURIComponent(match[2]) : payload?.id,
      key = cal + "/" + id,
      current = remote.get(key);
    if (method === "GET") return current ? res(current) : res({}, 404);
    if (method === "POST") {
      if (current) return res({}, 409);
      const item = {
        ...payload,
        status: "confirmed",
        etag: '"' + ++revision + '"',
      };
      remote.set(key, item);
      if (flags.afterInsert) {
        flags.afterInsert = false;
        throw new TypeError("Simulated response loss");
      }
      return res(item, 201);
    }
    if (!current) return res({}, 404);
    const etag = init.headers?.["If-Match"];
    if (etag && etag !== current.etag) return res({}, 412);
    if (method === "PATCH") {
      const item = { ...current, ...payload, etag: '"' + ++revision + '"' };
      remote.set(key, item);
      return res(item);
    }
    if (method === "DELETE") {
      remote.delete(key);
      return new Response(null, { status: 204 });
    }
    return res({}, 400);
  };
  const google = createGoogleApi({
    admin: f.admin,
    authorize: f.api.authorizePush,
    origin: appOrigin,
    clientId: "test-google-client",
    clientSecret: "test-google-client-secret",
    encryptionKey,
    cronSecret: "test-calendar-cron",
    fetcher,
  });
  function localReq(
    path,
    user = ids.tech,
    data,
    method = data ? "POST" : "GET",
    cookie = "",
  ) {
    return new Request(appOrigin + path, {
      method,
      headers: {
        Authorization: "Bearer " + token(user),
        Origin: appOrigin,
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  }
  async function oauth(user = ids.tech) {
    const started = await google.start(localReq("/api/google/start", user, {}));
    if (started.status !== 200) throw new Error(await started.text());
    const auth = new URL((await started.json()).url),
      cookie = started.headers.get("set-cookie").split(";")[0],
      ticket = auth.searchParams.get("state");
    const returned = await google.callback(
      localReq(
        `/api/google/callback?code=test-code&state=${ticket}`,
        user,
        undefined,
        "GET",
        cookie,
      ),
    );
    if (returned.status !== 303) throw new Error(await returned.text());
    const finish = await google.finish(
      localReq("/api/google/finish", user, { ticket }, "POST", cookie),
    );
    if (finish.status !== 200) throw new Error(await finish.text());
    return { auth, cookie, ticket };
  }
  async function connect(user = ids.tech) {
    await oauth(user);
    const selected = await google.select(
      localReq("/api/google/select", user, { create: true }),
    );
    if (selected.status !== 200) throw new Error(await selected.text());
  }
  async function assign(
    user = ids.tech,
    arrives = "2026-11-12 16:00Z",
    finishes = "2026-11-12 23:00Z",
  ) {
    await asUser(f.db, ids.admin);
    await f.db.query(
      "insert into assignments(event_id,user_id,arrives_at,finishes_at) values($1,$2,$3,$4)",
      [ids.event, user, arrives, finishes],
    );
  }
  async function dispatch() {
    return google.dispatch(
      new Request(appOrigin + "/api/push/dispatch", {
        headers: { Authorization: "Bearer test-calendar-cron" },
      }),
    );
  }
  async function due() {
    await f.db.exec(
      "reset role;update google_calendar_jobs set next_attempt_at=now(),lease_until=null;update google_calendar_connections set lease_until=null",
    );
  }
  return {
    ...f,
    google,
    encryptionKey,
    remote,
    calls,
    flags,
    oauth,
    connect,
    assign,
    dispatch,
    due,
  };
}
