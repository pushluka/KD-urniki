// Browser tests only: a local Auth/REST adapter backed by real PostgreSQL RLS.
// No test accounts or fixtures are bundled into the application.
import { database, asUser, ids } from "../helpers/database.mjs";
const fields = {
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
  profiles: ["id", "full_name", "role"],
  assignments: ["event_id", "user_id", "arrives_at", "finishes_at"],
  external_assignments: [
    "id",
    "event_id",
    "full_name",
    "role",
    "arrives_at",
    "finishes_at",
  ],
};
export async function backend(page) {
  const db = await database();
  let queue = Promise.resolve();
  await page.route("https://e2e.supabase.test/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204 });
    if (url.pathname.startsWith("/auth/")) {
      if (url.pathname.endsWith("/token")) {
        const role = request.postDataJSON().email.split("@")[0];
        const id = ids[role];
        if (!id)
          return route.fulfill({ status: 400, json: { msg: "Invalid login" } });
        return route.fulfill({
          json: {
            access_token: `test-${id}`,
            token_type: "bearer",
            expires_in: 3600,
            expires_at: 4102444800,
            refresh_token: "test-refresh",
            user: {
              id,
              aud: "authenticated",
              role: "authenticated",
              email: `${role}@example.test`,
            },
          },
        });
      }
      return route.fulfill({ status: 204 });
    }
    const run = async () => {
      try {
        const table = url.pathname.split("/").at(-1),
          columns = fields[table];
        if (!columns) throw new Error("Unsupported test REST resource");
        const token = request
          .headers()
          .authorization?.replace("Bearer test-", "");
        if (!Object.values(ids).includes(token))
          return route.fulfill({
            status: 401,
            json: { message: "Unauthenticated" },
          });
        await asUser(db, token);
        const params = [],
          where = [];
        for (const [column, value] of url.searchParams) {
          if (["select", "order", "on_conflict"].includes(column)) continue;
          if (!columns.includes(column) || !value.startsWith("eq."))
            throw new Error("Unsupported test filter");
          params.push(value.slice(3));
          where.push(`"${column}"=$${params.length}`);
        }
        const filter = where.length ? " where " + where.join(" and ") : "";
        if (request.method() === "GET") {
          const result = await db.query(
            `select * from public."${table}"${filter}${table === "events" ? " order by starts_at" : ""}`,
            params,
          );
          return route.fulfill({ json: result.rows });
        }
        if (request.method() === "DELETE")
          await db.query(`delete from public."${table}"${filter}`, params);
        else if (request.method() === "PATCH") {
          const body = request.postDataJSON(),
            set = [];
          for (const [column, value] of Object.entries(body)) {
            if (!columns.includes(column)) throw new Error("Unknown column");
            params.push(value);
            set.push(`"${column}"=$${params.length}`);
          }
          await db.query(
            `update public."${table}" set ${set.join(",")}${filter}`,
            params,
          );
        } else if (request.method() === "POST") {
          const body = request.postDataJSON(),
            keys = Object.keys(body);
          if (!keys.every((k) => columns.includes(k)))
            throw new Error("Unknown column");
          const values = keys.map((k) => body[k]);
          const merge =
            table === "events" && body.id
              ? ` on conflict(id) do update set ${keys
                  .filter((k) => k !== "id")
                  .map((k) => `"${k}"=excluded."${k}"`)
                  .join(",")}`
              : "";
          await db.query(
            `insert into public."${table}" (${keys.map((k) => `"${k}"`).join(",")}) values (${values.map((_, i) => "$" + (i + 1)).join(",")})${merge}`,
            values,
          );
        } else throw new Error("Unsupported test REST method");
        return route.fulfill({ status: 204 });
      } catch (error) {
        return route.fulfill({
          status: error.code === "42501" ? 403 : 400,
          json: { message: error.message, code: error.code ?? "TEST_ADAPTER" },
        });
      }
    };
    const task = queue.then(run);
    queue = task.catch(() => {});
    await task;
  });
  return {
    db,
    close: async () => {
      await queue;
      await db.close();
    },
  };
}
