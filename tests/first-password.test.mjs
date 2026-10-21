import { test } from "node:test";
import assert from "node:assert/strict";
import { serverFixture, claims, token } from "./helpers/server-fixture.mjs";
import { ids, asUser } from "./helpers/database.mjs";
const origin = "https://kd-urniki.vercel.app";
function req(path, access, data) {
  return new Request(origin + path, {
    method: data ? "POST" : "GET",
    headers: {
      ...(access ? { Authorization: "Bearer " + access } : {}),
      ...(data ? { Origin: origin, "Content-Type": "application/json" } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}
async function created(f, role = "tehnik") {
  const response = await f.api.create(
    req("/api/staff", token(ids.admin), {
      first_name: "Nova",
      last_name: "Oseba",
      username: "nova.oseba",
      role,
      password: "initial-password-123",
    }),
  );
  assert.equal(response.status, 201, await response.clone().text());
  const responseLogin = await f.api.login(
    req("/api/auth/login", null, {
      identity: "nova.oseba",
      password: "initial-password-123",
    }),
  );
  assert.equal(responseLogin.status, 200, await responseLogin.clone().text());
  const session = await responseLogin.json();
  assert.equal(session.must_change_password, true);
  return session;
}
async function finish(
  f,
  session,
  password = "new-personal-password-123",
  confirmation = password,
) {
  return f.api.changeInitialPassword(
    req("/api/auth/change-initial-password", session.access_token, {
      password,
      confirmation,
    }),
  );
}
for (const role of ["tehnik", "hostesa"])
  test(`${role}: limited first login, atomic completion, fresh session and no bypass on relogin`, async () => {
    const f = await serverFixture();
    try {
      const session = await created(f, role),
        c = claims(session.access_token);
      await f.db.exec("reset role");
      await f.db.query(
        "insert into storage.objects(bucket_id,name) values ('technical-documents',$1)",
        [ids.event + "/private.pdf"],
      );
      await asUser(f.db, c.sub, c);
      for (const table of [
        "profiles",
        "events",
        "assignments",
        "external_assignments",
        "storage.objects",
      ])
        assert.equal(
          (await f.db.query("select * from " + table)).rows.length,
          0,
        );
      await assert.rejects(f.db.exec("select * from staff_password_state"));
      await assert.rejects(
        f.db.exec("update profiles set must_change_password=false"),
      );
      await assert.rejects(
        f.db.query("select begin_staff_password_change($1,$2,$3)", [
          c.sub,
          c.app_metadata.staff_password_nonce,
          c.session_id,
        ]),
      );
      assert.equal(
        (await f.api.list(req("/api/staff", session.access_token))).status,
        403,
      );
      assert.deepEqual(
        await (
          await f.api.passwordStatus(
            req("/api/auth/password-status", session.access_token),
          )
        ).json(),
        { must_change_password: true },
      );
      const changed = await finish(f, session);
      assert.equal(changed.status, 200, await changed.clone().text());
      const fresh = await changed.json(),
        newClaims = claims(fresh.access_token);
      await asUser(f.db, c.sub, newClaims);
      assert.equal((await f.db.query("select * from events")).rows.length, 1);
      assert.equal(
        (
          await f.api.passwordStatus(
            req("/api/auth/password-status", session.access_token),
          )
        ).status,
        401,
      );
      // Even a refreshed old session with the latest metadata cannot cross the session age boundary.
      const refreshed = token(c.sub, newClaims.app_metadata, c.session_id);
      assert.equal(
        (
          await f.api.passwordStatus(
            req("/api/auth/password-status", refreshed),
          )
        ).status,
        401,
      );
      await asUser(f.db, c.sub, claims(refreshed));
      assert.equal((await f.db.query("select * from events")).rows.length, 0);
      assert.equal(
        (
          await f.api.login(
            req("/api/auth/login", null, {
              identity: "nova.oseba",
              password: "initial-password-123",
            }),
          )
        ).status,
        401,
      );
      const login = await f.api.login(
        req("/api/auth/login", null, {
          identity: "nova.oseba",
          password: "new-personal-password-123",
        }),
      );
      assert.equal(login.status, 200);
      assert.equal((await login.json()).must_change_password, false);
    } finally {
      await f.close();
    }
  });
test("same initial password, mismatch, weak password, forged metadata and direct Auth writes cannot clear the flag", async () => {
  const f = await serverFixture();
  try {
    const s = await created(f),
      c = claims(s.access_token);
    for (const [p, confirm] of [
      ["initial-password-123", "initial-password-123"],
      ["short", "short"],
      ["new-password-123", "mismatch-password"],
    ])
      assert.equal((await finish(f, s, p, confirm)).status, 400);
    const bypass = await f.admin.auth.admin.updateUserById(c.sub, {
      password: "bypass-password-123",
    });
    assert.ok(bypass.error);
    const client = f.client();
    await client.auth.setSession(s);
    const direct = await client.auth.updateUser({
      password: "direct-password-123",
    });
    assert.ok(direct.error);
    await client.auth.updateUser({
      data: {
        must_change_password: false,
        staff_password_nonce: "forged",
        role: "administrator",
      },
    });
    assert.deepEqual(
      await (
        await f.api.passwordStatus(
          req("/api/auth/password-status", s.access_token),
        )
      ).json(),
      { must_change_password: true },
    );
    await f.db.exec("reset role");
    assert.equal(
      (
        await f.db.query(
          "select must_change_password from profiles where id=$1",
          [c.sub],
        )
      ).rows[0].must_change_password,
      true,
    );
    assert.equal(f.passwords.get(c.sub), "initial-password-123");
  } finally {
    await f.close();
  }
});
test("temporary admin reset forces change again and blocks sessions issued before reset", async () => {
  const f = await serverFixture();
  try {
    const s = await created(f),
      changed = await finish(f, s);
    assert.equal(changed.status, 200);
    const fresh = await changed.json(),
      id = claims(fresh.access_token).sub;
    const reset = await f.api.reset(
      req("/api/staff/" + id + "/password", token(ids.admin), {
        mode: "password",
        password: "new-temporary-password",
        confirmation: "new-temporary-password",
      }),
      id,
    );
    assert.equal(reset.status, 200, await reset.clone().text());
    assert.equal(
      (
        await f.api.passwordStatus(
          req("/api/auth/password-status", fresh.access_token),
        )
      ).status,
      401,
    );
    assert.equal(
      (await finish(f, fresh, "another-personal-password")).status,
      401,
    );
    const login = await f.api.login(
      req("/api/auth/login", null, {
        identity: "nova.oseba",
        password: "new-temporary-password",
      }),
    );
    assert.equal(login.status, 200);
    const next = await login.json();
    assert.equal(next.must_change_password, true);
    assert.equal((await finish(f, next, "new-temporary-password")).status, 400);
    assert.equal(
      (await finish(f, next, "final-personal-password")).status,
      200,
    );
  } finally {
    await f.close();
  }
});
test("Auth password failure and SQL failure roll back unlocking; retry is safe", async () => {
  const f = await serverFixture();
  try {
    const s = await created(f),
      id = claims(s.access_token).sub;
    f.faults.password = true;
    assert.equal((await finish(f, s)).status, 502);
    f.faults.password = false;
    await f.db.exec(
      `reset role;create function public.fail_unlock() returns trigger language plpgsql as $$begin raise exception 'Injected unlock failure';end$$;create trigger fail_unlock before update on profiles for each row when(old.must_change_password and not new.must_change_password) execute function public.fail_unlock();`,
    );
    assert.equal((await finish(f, s)).status, 502);
    await f.db.exec("reset role");
    assert.equal(
      (
        await f.db.query(
          "select must_change_password from profiles where id=$1",
          [id],
        )
      ).rows[0].must_change_password,
      true,
    );
    assert.equal(f.passwords.get(id), "initial-password-123");
    await f.db.exec(
      "drop trigger fail_unlock on profiles;drop function public.fail_unlock()",
    );
    assert.equal((await finish(f, s)).status, 200);
  } finally {
    await f.close();
  }
});
test("concurrent reset invalidates a completion permit and no old write can unlock the user", async () => {
  const f = await serverFixture();
  try {
    const s = await created(f),
      c = claims(s.access_token);
    const permit = await f.admin.rpc("begin_staff_password_change", {
      p_id: c.sub,
      p_nonce: c.app_metadata.staff_password_nonce,
      p_session: c.session_id,
    });
    assert.equal(permit.error, null);
    const reset = await f.admin.rpc("begin_staff_password_reset", {
      p_id: c.sub,
    });
    assert.equal(reset.error, null);
    const oldWrite = await f.admin.auth.admin.updateUserById(c.sub, {
      password: "outdated-request-password",
      app_metadata: { staff_password_nonce: permit.data },
    });
    assert.ok(oldWrite.error);
    await f.db.exec("reset role");
    assert.equal(
      (
        await f.db.query(
          "select must_change_password from profiles where id=$1",
          [c.sub],
        )
      ).rows[0].must_change_password,
      true,
    );
    const resetWrite = await f.admin.auth.admin.updateUserById(c.sub, {
      password: "new-temporary-password",
      app_metadata: { staff_password_nonce: reset.data },
    });
    assert.equal(resetWrite.error, null);
    assert.equal(
      (
        await f.api.passwordStatus(
          req("/api/auth/password-status", s.access_token),
        )
      ).status,
      401,
    );
  } finally {
    await f.close();
  }
});
test("legacy accounts and administrator recovery remain unflagged and unchanged", async () => {
  const f = await serverFixture();
  try {
    await f.db.exec("reset role");
    assert.equal(
      (await f.db.query("select * from profiles where must_change_password"))
        .rows.length,
      0,
    );
    for (const role of ["admin", "tech", "hostess"]) {
      const response = await f.api.login(
        req("/api/auth/login", null, {
          identity: role + "@example.test",
          password: "test-password",
        }),
      );
      assert.equal(response.status, 200);
      assert.equal((await response.json()).must_change_password, false);
    }
    const result = await f.admin.auth.admin.updateUserById(ids.admin, {
      password: "changed-admin-password",
    });
    assert.equal(result.error, null);
    await f.db.exec("reset role");
    assert.equal(
      (
        await f.db.query(
          "select role,must_change_password from profiles where id=$1",
          [ids.admin],
        )
      ).rows[0].must_change_password,
      false,
    );
    await assert.rejects(
      f.db.query("update profiles set must_change_password=true where id=$1", [
        ids.admin,
      ]),
    );
  } finally {
    await f.close();
  }
});
