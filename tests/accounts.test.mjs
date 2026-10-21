import { test } from "node:test";
import assert from "node:assert/strict";
import { serverFixture, token } from "./helpers/server-fixture.mjs";
import { ids, asUser } from "./helpers/database.mjs";
const origin = "https://kd-urniki.vercel.app";
export function request(
  path,
  role = "admin",
  data,
  method = data ? "POST" : "GET",
) {
  return new Request(origin + path, {
    method,
    headers: {
      ...(role
        ? { Authorization: `Bearer ${token(ids[role] ?? role)}` }
        : { ...{} }),
      ...(data ? { "Content-Type": "application/json", Origin: origin } : {}),
      "x-vercel-forwarded-for": "192.0.2.10",
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}
const person = {
  first_name: "Nov",
  last_name: "Tehnik",
  username: "nov.tehnik",
  role: "tehnik",
  password: "safe-initial-password",
};
test("only verified active administrator can list/create/edit/deactivate/reset accounts", async () => {
  const f = await serverFixture();
  try {
    f.users.get(ids.tech).user_metadata = { role: "administrator" };
    for (const role of [null, "tech", "hostess", "unprofiled"]) {
      assert.equal(
        (await f.api.list(request("/api/staff", role))).status,
        role === null || role === "unprofiled" ? 401 : 403,
      );
      for (const [handler, path] of [
        ["create", ""],
        ["update", ""],
        ["active", "/active"],
        ["reset", "/password"],
      ]) {
        const req = request("/api/staff/" + ids.tech + path, role, {
          ...person,
          is_active: false,
          mode: "password",
          confirmation: person.password,
        });
        const response =
          handler === "create"
            ? await f.api.create(req)
            : await f.api[handler](req, ids.tech);
        assert.ok([401, 403].includes(response.status));
      }
    }
    const forged = new Request(origin + "/api/staff", {
      headers: { Authorization: "Bearer forged-jwt" },
    });
    assert.equal((await f.api.list(forged)).status, 401);
    assert.equal(
      f.calls.some(
        (c) => c.path === "/auth/v1/admin/users" && c.method === "POST",
      ),
      false,
    );
    await f.db.exec("reset role");
    await f.db.query("update profiles set is_active=false where id=$1", [
      ids.admin,
    ]);
    assert.equal((await f.api.list(request("/api/staff"))).status, 403);
  } finally {
    await f.close();
  }
});
test("safe account creation, unique normalized usernames, password login and legacy admin email", async () => {
  const f = await serverFixture();
  try {
    const response = await f.api.create(
      request("/api/staff", "admin", {
        ...person,
        username: "Nov.Tehnik",
        recovery_email: "private@example.test",
      }),
    );
    assert.equal(response.status, 201, await response.clone().text());
    assert.equal((await response.text()).includes(person.password), false);
    const list = await (await f.api.list(request("/api/staff"))).json();
    const row = list.staff.find((p) => p.username === "nov.tehnik");
    assert.ok(row);
    assert.equal(row.full_name, "Nov Tehnik");
    assert.equal(JSON.stringify(list).includes("private@example.test"), false);
    assert.equal(
      (await f.api.create(request("/api/staff", "admin", person))).status,
      409,
    );
    assert.equal(
      (
        await f.api.create(
          request("/api/staff", "admin", {
            ...person,
            username: "other.name",
            recovery_email: "private@example.test",
          }),
        )
      ).status,
      409,
    );
    const login = await f.api.login(
      request("/api/auth/login", null, {
        identity: "NOV.TEHNIK",
        password: person.password,
      }),
    );
    assert.equal(login.status, 200, await login.clone().text());
    assert.ok((await login.json()).access_token);
    assert.equal(login.headers.get("cache-control"), "no-store");
    assert.equal(
      (
        await f.api.login(
          request("/api/auth/login", null, {
            identity: "admin@example.test",
            password: "test-password",
          }),
        )
      ).status,
      200,
    );
    const bad = await f.api.login(
        request("/api/auth/login", null, {
          identity: "nov.tehnik",
          password: "wrong-password",
        }),
      ),
      unknown = await f.api.login(
        request("/api/auth/login", null, {
          identity: "unknown",
          password: "wrong-password",
        }),
      );
    assert.equal(bad.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(await bad.json(), await unknown.json());
    await asUser(f.db, ids.tech);
    await assert.rejects(f.db.exec("select * from staff_accounts"));
    await assert.rejects(f.db.exec("select * from auth_attempts"));
    const columns = (
      await f.db.query(
        "select column_name from information_schema.columns where table_schema='public' and table_name in ('profiles','staff_accounts')",
      )
    ).rows.map((r) => r.column_name);
    assert.equal(
      columns.some(
        (c) =>
          (c.includes("password") && c !== "must_change_password") ||
          c === "email",
      ),
      false,
    );
  } finally {
    await f.close();
  }
});
test("legacy staff edit reuses Auth identity; role escalation and administrator changes are forbidden", async () => {
  const f = await serverFixture();
  try {
    const before = f.users.size;
    const res = await f.api.update(
      request(
        "/api/staff/" + ids.tech,
        "admin",
        {
          ...person,
          username: "tine",
          first_name: "Tine",
          last_name: "Tehnik",
        },
        "PATCH",
      ),
      ids.tech,
    );
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(f.users.size, before);
    assert.equal(
      (
        await f.api.update(
          request(
            "/api/staff/" + ids.tech,
            "admin",
            { ...person, role: "administrator" },
            "PATCH",
          ),
          ids.tech,
        )
      ).status,
      400,
    );
    for (const action of ["update", "active", "reset"])
      assert.equal(
        (
          await f.api[action](
            request("/api/staff/" + ids.admin, "admin", {
              ...person,
              is_active: false,
              mode: "password",
              confirmation: person.password,
            }),
            ids.admin,
          )
        ).status,
        404,
      );
    assert.equal(
      (
        await f.api.login(
          request("/api/auth/login", null, {
            identity: "tine",
            password: "test-password",
          }),
        )
      ).status,
      200,
    );
    await asUser(f.db, ids.tech);
    await assert.rejects(
      f.db.exec("update profiles set role='administrator',is_active=true"),
    );
    for (const sql of [
      "select create_staff_profile(gen_random_uuid(),'hacker','A','B','administrator')",
      `select set_staff_active('${ids.tech}',true)`,
      `select update_staff_profile('${ids.tech}','hacker','A','B','administrator')`,
    ])
      await assert.rejects(f.db.exec(sql));
  } finally {
    await f.close();
  }
});
test("deactivation blocks RLS even if Auth ban fails; history and administrator remain intact", async () => {
  const f = await serverFixture();
  try {
    await f.db.query(
      "insert into storage.objects(bucket_id,name) values ('technical-documents',$1)",
      [ids.event + "/rider.pdf"],
    );
    f.faults.ban = true;
    const result = await f.api.active(
      request("/api/staff/" + ids.other + "/active", "admin", {
        is_active: false,
      }),
      ids.other,
    );
    assert.equal(result.status, 502);
    await asUser(f.db, ids.other);
    for (const table of [
      "profiles",
      "events",
      "assignments",
      "external_assignments",
      "storage.objects",
    ])
      assert.equal((await f.db.query("select * from " + table)).rows.length, 0);
    assert.equal(
      (await f.db.query("select public.current_role() as role")).rows[0].role,
      null,
    );
    await assert.rejects(
      f.db.query(
        "insert into assignments(event_id,user_id,arrives_at,finishes_at) values ($1,$2,now(),now()+interval '1 hour')",
        [ids.event, ids.other],
      ),
    );
    await f.db.exec("reset role");
    assert.equal(
      (await f.db.query("select * from assignments")).rows.length,
      1,
    );
    assert.equal(
      (
        await f.db.query("select role,is_active from profiles where id=$1", [
          ids.admin,
        ])
      ).rows[0].role,
      "administrator",
    );
    assert.equal(
      (
        await f.api.login(
          request("/api/auth/login", null, {
            identity: "other@example.test",
            password: "test-password",
          }),
        )
      ).status,
      401,
    );
    f.faults.ban = false;
    assert.equal(
      (
        await f.api.active(
          request("/api/staff/" + ids.other + "/active", "admin", {
            is_active: true,
          }),
          ids.other,
        )
      ).status,
      200,
    );
    await asUser(f.db, ids.other);
    assert.equal(
      (await f.db.query("select * from assignments")).rows.length,
      1,
    );
  } finally {
    await f.close();
  }
});
test("failed provisioning rolls back and removes only newly created Auth user", async () => {
  const f = await serverFixture();
  try {
    const before = f.users.size;
    f.faults.rpc = "create_staff_profile";
    assert.equal(
      (await f.api.create(request("/api/staff", "admin", person))).status,
      409,
    );
    assert.equal(f.users.size, before);
    assert.ok(f.users.has(ids.admin));
    assert.equal(
      f.calls.some(
        (c) =>
          c.method === "DELETE" && c.path.startsWith("/auth/v1/admin/users/"),
      ),
      true,
    );
  } finally {
    await f.close();
  }
});
test("password reset uses Auth, does not expose secrets, and supports recovery email", async () => {
  const f = await serverFixture();
  try {
    assert.equal(
      (
        await f.api.reset(
          request("/api/staff/" + ids.tech + "/password", "admin", {
            mode: "password",
            password: "new-password-123",
            confirmation: "new-password-123",
          }),
          ids.tech,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.api.login(
          request("/api/auth/login", null, {
            identity: "tech@example.test",
            password: "new-password-123",
          }),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.api.login(
          request("/api/auth/login", null, {
            identity: "tech@example.test",
            password: "test-password",
          }),
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await f.api.reset(
          request("/api/staff/" + ids.tech + "/password", "admin", {
            mode: "email",
          }),
          ids.tech,
        )
      ).status,
      200,
    );
    assert.ok(f.calls.some((c) => c.path === "/auth/v1/recover"));
    assert.equal(
      (
        await f.api.reset(
          request("/api/staff/" + ids.tech + "/password", "admin", {
            mode: "password",
            password: "new-password-123",
            confirmation: "mismatch-password",
          }),
          ids.tech,
        )
      ).status,
      400,
    );
  } finally {
    await f.close();
  }
});
test("durable rate limiting, CSRF and input checks do not disclose identities", async () => {
  const f = await serverFixture();
  try {
    const cross = new Request(origin + "/api/staff", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token(ids.admin)}`,
      },
      body: JSON.stringify(person),
    });
    assert.equal((await f.api.create(cross)).status, 403);
    for (let i = 0; i < 10; i++)
      assert.equal(
        (
          await f.api.login(
            request("/api/auth/login", null, {
              identity: "does-not-exist",
              password: "wrong-password",
            }),
          )
        ).status,
        401,
      );
    assert.equal(
      (
        await f.api.login(
          request("/api/auth/login", null, {
            identity: "does-not-exist",
            password: "wrong-password",
          }),
        )
      ).status,
      429,
    );
    await f.db.exec("reset role");
    const buckets = (await f.db.query("select bucket from auth_attempts")).rows;
    assert.ok(buckets.every((r) => /^[a-f0-9]{64}$/.test(r.bucket)));
    await f.db.exec(
      "update auth_attempts set window_started=now()-interval '16 minutes'",
    );
    assert.equal(
      (
        await f.api.login(
          request("/api/auth/login", null, {
            identity: "does-not-exist",
            password: "wrong-password",
          }),
        )
      ).status,
      401,
    );
    await asUser(f.db, ids.tech);
    await assert.rejects(
      f.db.query("select take_login_attempt($1,100,900)", ["a".repeat(64)]),
    );
  } finally {
    await f.close();
  }
});

test("database provisioning is atomic on duplicate username and forbids administrator role", async () => {
  const f = await serverFixture();
  try {
    assert.equal(
      (await f.api.create(request("/api/staff", "admin", person))).status,
      201,
    );
    const id = "20000000-0000-0000-0000-000000000001";
    await f.db.exec("reset role");
    await f.db.query("insert into auth.users values ($1)", [id]);
    const collision = await f.admin.rpc("create_staff_profile", {
      p_id: id,
      p_username: person.username,
      p_first_name: "Drug",
      p_last_name: "Sodelavec",
      p_role: "hostesa",
    });
    assert.equal(collision.error.code, "23505");
    await f.db.exec("reset role");
    assert.equal(
      (await f.db.query("select * from profiles where id=$1", [id])).rows
        .length,
      0,
    );
    const escalation = await f.admin.rpc("create_staff_profile", {
      p_id: id,
      p_username: "forbidden.admin",
      p_first_name: "Drug",
      p_last_name: "Sodelavec",
      p_role: "administrator",
    });
    assert.equal(escalation.error.code, "23514");
  } finally {
    await f.close();
  }
});

test("configured public origin works even when Next uses an internal request URL", async () => {
  const f = await serverFixture();
  try {
    const req = new Request("http://0.0.0.0:3000/api/staff", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal((await f.api.create(req)).status, 401);
    const hostile = new Request("http://0.0.0.0:3000/api/staff", {
      method: "POST",
      headers: {
        Origin: "https://untrusted.example",
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal((await f.api.create(hostile)).status, 403);
  } finally {
    await f.close();
  }
});
