// Test-only Auth emulator. Production passwords are held exclusively by Supabase Auth.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { createApi } from "../../lib/server/api.ts";
import { database, asUser, ids } from "./database.mjs";
const columns = {
  push_subscriptions: [
    "id",
    "user_id",
    "endpoint_hash",
    "endpoint",
    "p256dh",
    "auth",
    "vapid_key",
    "credential_nonce",
    "created_at",
  ],
  push_deliveries: [
    "id",
    "user_id",
    "subscription_id",
    "event_id",
    "kind",
    "created_at",
    "attempts",
    "next_attempt_at",
    "lease_token",
    "lease_until",
    "sent_at",
    "dead_at",
  ],
  staff_password_state: [
    "user_id",
    "required_nonce",
    "version",
    "completion_nonce",
    "completion_version",
    "expires_at",
    "reset_pending",
    "reset_nonce",
    "session_after",
  ],
  profiles: ["id", "full_name", "role", "is_active", "must_change_password"],
  events: [
    "id",
    "title",
    "starts_at",
    "ends_at",
    "location",
    "notes",
    "hostesses_needed",
    "technicians_needed",
    "accounting_code",
  ],
  assignments: ["event_id", "user_id", "arrives_at", "finishes_at"],
  external_assignments: [
    "id",
    "event_id",
    "full_name",
    "role",
    "arrives_at",
    "finishes_at",
  ],
  staff_accounts: ["user_id", "username", "first_name", "last_name"],
  auth_attempts: ["bucket", "window_started", "attempts"],
};
const rpcArgs = {
  google_begin_provision: ["p_user", "p_generation", "p_lease"],
  google_connection: ["p_user"],
  google_oauth_begin: ["p_user", "p_state", "p_cookie", "p_verifier"],
  google_oauth_callback: ["p_state", "p_cookie", "p_code"],
  google_oauth_take: ["p_user", "p_state", "p_cookie"],
  google_store_tokens: [
    "p_user",
    "p_generation",
    "p_refresh",
    "p_access",
    "p_expiry",
  ],
  google_disconnect: ["p_user"],
  google_acquire: ["p_user"],
  google_release: ["p_user", "p_lease"],
  google_lease_valid: [
    "p_user",
    "p_generation",
    "p_lease",
    "p_event",
    "p_revision",
  ],
  google_refresh: [
    "p_user",
    "p_generation",
    "p_lease",
    "p_access",
    "p_refresh",
    "p_expiry",
  ],
  google_resync: ["p_user", "p_generation", "p_lease", "p_calendar", "p_name"],
  google_claim: [],
  google_prepare: [
    "p_user",
    "p_generation",
    "p_lease",
    "p_event",
    "p_revision",
  ],
  google_mapping_result: [
    "p_user",
    "p_generation",
    "p_lease",
    "p_id",
    "p_deleted",
    "p_rotate",
  ],
  google_finish: ["p_user", "p_event", "p_lease", "p_revision", "p_result"],
  google_pause: ["p_user", "p_generation", "p_lease", "p_status", "p_error"],

  cleanup_admin_notifications: [],
  list_admin_notifications: ["p_user", "p_offset"],
  set_admin_notification_read: ["p_user", "p_id", "p_read"],
  register_push: [
    "p_user",
    "p_hash",
    "p_endpoint",
    "p_p256dh",
    "p_auth",
    "p_vapid",
  ],
  claim_push: ["p_vapid"],
  finish_push: ["p_id", "p_lease", "p_status"],
  staff_access_state: ["p_id", "p_nonce", "p_session"],
  begin_staff_password_change: ["p_id", "p_nonce", "p_session"],
  begin_staff_password_reset: ["p_id"],
  create_staff_profile: [
    "p_id",
    "p_username",
    "p_first_name",
    "p_last_name",
    "p_role",
  ],
  update_staff_profile: [
    "p_id",
    "p_username",
    "p_first_name",
    "p_last_name",
    "p_role",
  ],
  set_staff_active: ["p_id", "p_active"],
  take_login_attempt: ["p_bucket", "p_limit", "p_seconds"],
};
export function token(id, metadata = {}, sessionId) {
  return (
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ) +
    "." +
    Buffer.from(
      JSON.stringify({
        sub: id,
        app_metadata: metadata,
        session_id: sessionId,
        exp: 4102444800,
        aud: "authenticated",
        role: "authenticated",
      }),
    ).toString("base64url") +
    ".dGVzdC1vbmx5LXNpZ25hdHVyZQ"
  );
}
export const claims = (jwt) => {
  try {
    return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url"));
  } catch {
    return {};
  }
};
const subject = (jwt) => {
  try {
    return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url")).sub;
  } catch {
    return null;
  }
};
export async function serverFixture({
  appOrigin = "https://kd-urniki.vercel.app",
} = {}) {
  const db = await database(),
    users = new Map(),
    passwords = new Map(),
    faults = {},
    calls = [];
  for (const [role, id] of Object.entries(ids)) {
    if (["event", "unprofiled"].includes(role)) continue;
    users.set(id, {
      id,
      email: `${role}@example.test`,
      role: "authenticated",
      aud: "authenticated",
      app_metadata: {},
    });
    passwords.set(id, "test-password");
  }
  let queue = Promise.resolve();
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: {
        "Content-Type": "application/json",
        "X-Supabase-Api-Version": "2024-01-01",
      },
    });
  const fetchMock = async (input, init) => {
    const req = new Request(input, init),
      url = new URL(req.url),
      body =
        req.method === "GET" || req.method === "DELETE"
          ? {}
          : JSON.parse((await req.text()) || "{}");
    const bearer = req.headers.get("authorization")?.replace(/^Bearer /, "");
    const service = req.headers.get("apikey") === "server-test-service";
    calls.push({ method: req.method, path: url.pathname });
    const run = async () => {
      try {
        if (url.pathname.startsWith("/auth/")) {
          if (url.pathname.endsWith("/token")) {
            const user = [...users.values()].find(
              (u) => u.email === body.email,
            );
            if (
              !user ||
              user.banned ||
              passwords.get(user.id) !== body.password
            )
              return json(
                {
                  msg: "Invalid login credentials",
                  code: "invalid_credentials",
                },
                400,
              );
            await db.exec("reset role");
            const sessionId = randomUUID();
            await db.query(
              "insert into auth.sessions(id,user_id) values ($1,$2)",
              [sessionId, user.id],
            );
            return json({
              access_token: token(user.id, user.app_metadata, sessionId),
              refresh_token: `refresh-${user.id}`,
              expires_in: 3600,
              expires_at: 4102444800,
              token_type: "bearer",
              user,
            });
          }
          if (url.pathname.endsWith("/user")) {
            const user = users.get(subject(bearer || ""));
            if (user && !user.banned && req.method === "PUT") {
              if (body.password) {
                await db.exec("reset role");
                await db.query(
                  "update auth.users set encrypted_password=$2 where id=$1",
                  [user.id, "test-hash-" + randomUUID()],
                );
                passwords.set(user.id, body.password);
              }
              if (body.data)
                user.user_metadata = { ...user.user_metadata, ...body.data };
            }
            return user && !user.banned
              ? json(user)
              : json({ msg: "Invalid JWT" }, 401);
          }
          if (
            url.pathname.endsWith("/recover") ||
            url.pathname.endsWith("/logout")
          )
            return json({});
          if (!service) return json({ msg: "Forbidden" }, 403);
          if (
            url.pathname === "/auth/v1/admin/users" &&
            req.method === "POST"
          ) {
            if ([...users.values()].some((u) => u.email === body.email))
              return json({ msg: "Email already registered" }, 422);
            const id = randomUUID(),
              user = {
                id,
                email: body.email,
                role: "authenticated",
                aud: "authenticated",
                app_metadata: body.app_metadata ?? {},
              };
            await db.exec("reset role");
            await db.query(
              "insert into auth.users(id,raw_app_meta_data) values ($1,$2)",
              [id, JSON.stringify(user.app_metadata)],
            );
            users.set(id, user);
            passwords.set(id, body.password);
            return json(user);
          }
          const id = url.pathname.split("/").at(-1),
            user = users.get(id);
          if (!user) return json({ msg: "Not found" }, 404);
          if (req.method === "DELETE") {
            if (faults.cleanup) return json({ msg: "Cleanup failed" }, 500);
            await db.exec("reset role");
            await db.query("delete from auth.users where id=$1", [id]);
            users.delete(id);
            passwords.delete(id);
            return json(user);
          }
          if (req.method === "PUT") {
            if (body.ban_duration) {
              if (faults.ban) return json({ msg: "Auth unavailable" }, 500);
              user.banned = body.ban_duration !== "none";
            }
            if (body.password || body.app_metadata) {
              if (faults.password)
                return json({ msg: "Password update unavailable" }, 400);
              await db.exec("reset role");
              const metadata = { ...user.app_metadata, ...body.app_metadata };
              // Match GoTrue AdminUserUpdate: password first, metadata second,
              // with deferred database constraints checked at the same commit.
              await db.transaction(async (tx) => {
                if (body.password)
                  await tx.query(
                    "update auth.users set encrypted_password=$2 where id=$1",
                    [id, "test-hash-" + randomUUID()],
                  );
                if (body.app_metadata)
                  await tx.query(
                    "update auth.users set raw_app_meta_data=$2 where id=$1",
                    [id, JSON.stringify(metadata)],
                  );
              });
              user.app_metadata = metadata;
              if (body.password) passwords.set(id, body.password);
            }
            return json(user);
          }
          return json(user);
        }
        const id = subject(bearer || "");
        if (service) await db.exec("reset role; set role service_role");
        else if (id && users.has(id)) await asUser(db, id, claims(bearer));
        else await db.exec("reset role; set role anon");
        if (url.pathname.includes("/rpc/")) {
          const name = url.pathname.split("/").at(-1),
            args = rpcArgs[name];
          if (!args) throw new Error("Unsupported test RPC");
          if (faults.rpc === name)
            return json({ message: "Test failure", code: "23505" }, 409);
          const result = await db.query(
            `select public."${name}"(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
            args.map((a) => body[a]),
          );
          return json(result.rows[0].result);
        }
        const table = url.pathname.split("/").at(-1),
          allowed = columns[table];
        if (!allowed) throw new Error("Unknown test resource");
        const params = [],
          where = [];
        for (const [col, value] of url.searchParams) {
          if (["select", "order", "on_conflict"].includes(col)) continue;
          if (!allowed.includes(col)) throw new Error("Unknown filter");
          const [operator, ...tail] = value.split(".");
          if (!["eq", "neq"].includes(operator))
            throw new Error("Unknown operator");
          params.push(tail.join("."));
          where.push(
            `"${col}" ${operator === "eq" ? "=" : "<>"} $${params.length}`,
          );
        }
        const filter = where.length ? " where " + where.join(" and ") : "";
        if (req.method === "GET") {
          const order = url.searchParams.get("order")?.split(".")[0];
          if (order && !allowed.includes(order))
            throw new Error("Unknown order");
          const result = await db.query(
            `select * from public."${table}"${filter}${order ? ' order by "' + order + '"' : ""}`,
            params,
          );
          if (req.headers.get("accept")?.includes("vnd.pgrst.object"))
            return result.rows.length === 1
              ? json(result.rows[0])
              : json({ code: "PGRST116", message: "Not one row" }, 406);
          return json(result.rows);
        }
        if (req.method === "DELETE")
          await db.query(`delete from public."${table}"${filter}`, params);
        else if (req.method === "PATCH") {
          const set = [];
          for (const [col, value] of Object.entries(body)) {
            if (!allowed.includes(col)) throw new Error("Unknown column");
            params.push(value);
            set.push(`"${col}"=$${params.length}`);
          }
          await db.query(
            `update public."${table}" set ${set.join(",")}${filter}`,
            params,
          );
        } else if (req.method === "POST") {
          const keys = Object.keys(body);
          if (!keys.every((k) => allowed.includes(k)))
            throw new Error("Unknown column");
          const merge =
            table === "events" && body.id
              ? ` on conflict(id) do update set ${keys
                  .filter((k) => k !== "id")
                  .map((k) => `"${k}"=excluded."${k}"`)
                  .join(",")}`
              : "";
          await db.query(
            `insert into public."${table}" (${keys.map((k) => `"${k}"`).join(",")}) values (${keys.map((_, i) => "$" + (i + 1)).join(",")})${merge}`,
            keys.map((k) => body[k]),
          );
        }
        return new Response(null, { status: 204 });
      } catch (e) {
        return json(
          { message: e.message, code: e.code ?? "TEST_ADAPTER" },
          e.code === "42501" ? 403 : 400,
        );
      }
    };
    const task = queue.then(run);
    queue = task.catch(() => {});
    return task;
  };
  function client(key) {
    return createClient("https://e2e.supabase.test", key, {
      global: { fetch: fetchMock },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  const admin = client("server-test-service"),
    auth = client("test-public-key");
  const api = createApi({
    admin,
    auth,
    rateSecret: "test-only-hmac",
    appOrigin,
    minimumLoginMs: 0,
  });
  return {
    db,
    users,
    passwords,
    faults,
    calls,
    api,
    admin,
    auth,
    fetch: fetchMock,
    client: () => client("test-public-key"),
    close: async () => {
      await queue;
      await db.close();
    },
  };
}
