import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { ids, asUser } from "./helpers/database.mjs";
import {
  googleFixture,
  googleReq,
  calendarId,
} from "./helpers/google-fixture.mjs";
import {
  GOOGLE_SCOPES,
  tokenVault,
  calendarEvent,
} from "../lib/server/google-core.ts";

test("vault encrypts tokens with user/purpose binding and detects tampering", () => {
  const vault = tokenVault(randomBytes(32).toString("base64")),
    sealed = vault.seal("PRIVATE-TOKEN", "user-a:refresh");
  assert.equal(sealed.includes("PRIVATE-TOKEN"), false);
  assert.equal(vault.open(sealed, "user-a:refresh"), "PRIVATE-TOKEN");
  assert.throws(() => vault.open(sealed, "user-b:refresh"));
  const parts = sealed.split(".");
  const damaged = Buffer.from(parts[3], "base64url");
  damaged[0] ^= 1;
  parts[3] = damaged.toString("base64url");
  assert.throws(() => vault.open(parts.join("."), "user-a:refresh"));
  assert.throws(() => tokenVault("invalid"));
});
test("personal hours and Europe/Ljubljana preserve DST and winter/summer instants", () => {
  const map = {
    id: "map",
    marker: "marker",
    google_event_id: "id",
    remote_seen: false,
    deleted: false,
  };
  for (const [start, end, local] of [
    ["2026-01-15T16:00:00Z", "2026-01-15T18:00:00Z", "17:00"],
    ["2026-07-15T16:00:00Z", "2026-07-15T18:00:00Z", "18:00"],
    ["2026-03-29T00:30:00Z", "2026-03-29T01:30:00Z", "01:30"],
    ["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z", "02:30"],
  ]) {
    const item = calendarEvent(
      {
        title: "Moje delo",
        location: "Kulturni dom",
        starts_at: "2026-01-15T20:00Z",
        ends_at: "2026-01-15T22:00Z",
        arrives_at: start,
        finishes_at: end,
      },
      map,
    );
    assert.equal(item.start.dateTime, start.replace("Z", ".000Z"));
    assert.equal(item.end.dateTime, end.replace("Z", ".000Z"));
    assert.equal(item.start.timeZone, "Europe/Ljubljana");
    assert.equal(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Ljubljana",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(item.start.dateTime)),
      local,
    );
  }
});
test("OAuth requires ready staff, origin, PKCE and browser/user-bound one-time state; no tokens reach status", async () => {
  const f = await googleFixture();
  try {
    assert.equal(
      (await f.google.start(googleReq("/api/google/start", ids.admin, {})))
        .status,
      403,
    );
    assert.equal(
      (
        await f.google.start(
          googleReq("/api/google/start", ids.tech, {}, "POST", "", {
            Origin: "https://evil.test",
          }),
        )
      ).status,
      403,
    );
    const started = await f.google.start(
      googleReq("/api/google/start", ids.tech, {}),
    );
    const url = new URL((await started.json()).url),
      cookie = started.headers.get("set-cookie").split(";")[0],
      ticket = url.searchParams.get("state");
    assert.equal(url.origin, "https://accounts.google.com");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.deepEqual(url.searchParams.get("scope").split(" "), GOOGLE_SCOPES);
    assert.ok(started.headers.get("set-cookie").includes("HttpOnly"));
    await f.google.callback(
      googleReq(
        `/api/google/callback?state=${ticket}&code=test-code`,
        ids.tech,
        undefined,
        "GET",
        "kd_google_oauth=wrong",
      ),
    );
    assert.equal(
      (
        await f.google.finish(
          googleReq("/api/google/finish", ids.tech, { ticket }, "POST", cookie),
        )
      ).status,
      400,
    );
    await f.google.callback(
      googleReq(
        `/api/google/callback?state=${ticket}&code=test-code`,
        ids.tech,
        undefined,
        "GET",
        cookie,
      ),
    );
    assert.equal(
      (
        await f.google.finish(
          googleReq(
            "/api/google/finish",
            ids.hostess,
            { ticket },
            "POST",
            cookie,
          ),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.google.finish(
          googleReq("/api/google/finish", ids.tech, { ticket }, "POST", cookie),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await f.google.finish(
          googleReq("/api/google/finish", ids.tech, { ticket }, "POST", cookie),
        )
      ).status,
      400,
    );
    const status = await (
      await f.google.status(googleReq("/api/google/status"))
    ).text();
    assert.equal(status.includes("test-google-refresh"), false);
    assert.equal(status.includes("cipher"), false);
    await f.db.exec("reset role");
    const c = (await f.db.query("select * from google_calendar_connections"))
      .rows[0];
    assert.ok(c.refresh_cipher.startsWith("v1."));
    assert.equal(c.refresh_cipher.includes("test-google-refresh"), false);
    for (const table of [
      "google_calendar_connections",
      "google_calendar_oauth",
      "google_calendar_jobs",
      "google_calendar_mappings",
    ]) {
      await asUser(f.db, ids.tech);
      await assert.rejects(f.db.exec("select * from " + table));
    }
  } finally {
    await f.close();
  }
});
test("unconnected users have no sync; initial sync and updates affect only own assigned work and one Google record", async () => {
  const f = await googleFixture();
  try {
    await f.assign();
    await f.db.exec("reset role");
    assert.equal(
      (await f.db.query("select * from google_calendar_jobs")).rows.length,
      0,
    );
    await f.connect();
    await f.dispatch();
    assert.equal(f.remote.size, 1);
    let [key, item] = [...f.remote][0];
    assert.equal(item.summary, "Preizkusni koncert");
    assert.equal(item.start.dateTime, "2026-11-12T16:00:00.000Z");
    assert.equal(item.end.dateTime, "2026-11-12T23:00:00.000Z");
    await f.dispatch();
    assert.equal(f.remote.size, 1);
    await asUser(f.db, ids.admin);
    await f.db.query(
      "update assignments set arrives_at='2026-11-12 15:00Z' where user_id=$1",
      [ids.tech],
    );
    await f.db.query(
      "update events set title='Nov naslov',location='Druga lokacija',starts_at='2026-11-12 19:00Z' where id=$1",
      [ids.event],
    );
    await f.dispatch();
    assert.equal(f.remote.size, 1);
    assert.equal(f.remote.get(key).summary, "Nov naslov");
    assert.equal(f.remote.get(key).location, "Druga lokacija");
    assert.equal(f.remote.get(key).start.dateTime, "2026-11-12T15:00:00.000Z");
    // An unrelated personal event in Google must survive removal of the work assignment.
    f.remote.set(calendarId + "/personal", {
      id: "personal",
      summary: "Zasebno",
      etag: '"p"',
    });
    await asUser(f.db, ids.admin);
    await f.db.query("delete from assignments where user_id=$1", [ids.tech]);
    await f.dispatch();
    assert.equal(f.remote.has(key), false);
    assert.equal(f.remote.get(calendarId + "/personal").summary, "Zasebno");
  } finally {
    await f.close();
  }
});
test("lost insert acknowledgement retries idempotently; foreign markers are never overwritten or deleted", async () => {
  const f = await googleFixture();
  try {
    await f.connect();
    await f.assign();
    f.flags.afterInsert = true;
    await f.dispatch();
    assert.equal(f.remote.size, 1);
    await f.due();
    await f.dispatch();
    assert.equal(f.remote.size, 1);
    assert.equal(
      f.calls.filter((c) => c.method === "POST" && c.path.includes("/events"))
        .length,
      1,
    );
    const [key, item] = [...f.remote][0];
    f.remote.set(key, {
      ...item,
      summary: "Do not touch",
      extendedProperties: {
        private: { kdMapping: "foreign", kdMarker: "foreign" },
      },
    });
    await asUser(f.db, ids.admin);
    await f.db.query("delete from assignments where user_id=$1", [ids.tech]);
    await f.dispatch();
    assert.equal(f.remote.get(key).summary, "Do not touch");
    const status = await (
      await f.google.status(googleReq("/api/google/status"))
    ).json();
    assert.equal(status.last_error, "event_conflict");
  } finally {
    await f.close();
  }
});
test("disconnect stops background sync, leaves Google entries, reconnect reconciles current assignments without duplicates", async () => {
  const f = await googleFixture();
  try {
    await f.connect();
    await f.assign();
    await f.dispatch();
    const key = [...f.remote.keys()][0];
    assert.equal(
      (
        await f.google.disconnect(
          googleReq("/api/google/disconnect", ids.tech, {}),
        )
      ).status,
      200,
    );
    assert.equal(f.remote.has(key), true);
    await asUser(f.db, ids.admin);
    await f.db.query("delete from assignments where user_id=$1", [ids.tech]);
    await f.dispatch();
    assert.equal(f.remote.has(key), true);
    await f.connect();
    await f.dispatch();
    assert.equal(f.remote.has(key), false);
    await f.assign();
    await f.dispatch();
    assert.equal(f.remote.size, 1);
    assert.notEqual([...f.remote.keys()][0], key);
  } finally {
    await f.close();
  }
});
test("expired access tokens refresh server-side; revoked grants stop jobs and require explicit reconnection", async () => {
  const f = await googleFixture();
  try {
    await f.connect();
    await f.assign();
    await f.db.exec(
      "reset role;update google_calendar_connections set expires_at=now()-interval '1 hour'",
    );
    await f.dispatch();
    assert.equal(f.remote.size, 1);
    f.flags.revoked = true;
    await asUser(f.db, ids.admin);
    await f.db.query(
      "update assignments set finishes_at=finishes_at+interval '1 hour' where user_id=$1",
      [ids.tech],
    );
    await f.db.exec(
      "reset role;update google_calendar_connections set expires_at=now()-interval '1 hour'",
    );
    await f.dispatch();
    const status = await (
      await f.google.status(googleReq("/api/google/status"))
    ).json();
    assert.equal(status.status, "reauthorize");
    await f.db.exec("reset role");
    assert.equal(
      (
        await f.db.query(
          "select refresh_cipher from google_calendar_connections",
        )
      ).rows[0].refresh_cipher,
      null,
    );
    const before = f.calls.length;
    await f.dispatch();
    assert.equal(f.calls.length, before);
  } finally {
    await f.close();
  }
});

test("ambiguous calendar creation never repeats a non-idempotent insert; recovery verifies the dedicated calendar", async () => {
  const f = await googleFixture();
  try {
    await f.oauth();
    f.flags.calendarAfterCreate = true;
    assert.equal(
      (
        await f.google.select(
          googleReq("/api/google/select", ids.tech, { create: true }),
        )
      ).status,
      503,
    );
    assert.equal(
      (await (await f.google.status(googleReq("/api/google/status"))).json())
        .needs_restore,
      true,
    );
    assert.equal(
      (
        await f.google.select(
          googleReq("/api/google/select", ids.tech, { create: true }),
        )
      ).status,
      409,
    );
    assert.equal(
      f.calls.filter(
        (c) => c.method === "POST" && c.path === "/calendar/v3/calendars",
      ).length,
      1,
    );
    assert.equal(
      (
        await f.google.select(
          googleReq("/api/google/select", ids.tech, {
            calendar_id: "unrelated",
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.google.select(
          googleReq("/api/google/select", ids.tech, {
            calendar_id: calendarId,
          }),
        )
      ).status,
      200,
    );
    await f.assign();
    await f.dispatch();
    assert.equal(f.remote.size, 1);
    assert.equal(
      f.calls.some((c) => c.path === "/calendar/v3/users/me/calendarList"),
      false,
    );
  } finally {
    await f.close();
  }
});
test("leases and revisions preserve edits made during dispatch and exclude overlapping workers", async () => {
  const f = await googleFixture();
  try {
    await f.connect();
    await f.assign();
    const claimed = (await f.admin.rpc("google_claim", {})).data;
    assert.equal(claimed.length, 1);
    assert.equal((await f.admin.rpc("google_claim", {})).data.length, 0);
    const j = claimed[0];
    await asUser(f.db, ids.admin);
    await f.db.query(
      "update assignments set arrives_at=arrives_at-interval '1 hour' where user_id=$1",
      [ids.tech],
    );
    const prepared = await f.admin.rpc("google_prepare", {
      p_user: j.user_id,
      p_generation: j.generation,
      p_lease: j.lease_token,
      p_event: j.event_id,
      p_revision: j.revision,
    });
    assert.equal(prepared.data, null);
    await f.admin.rpc("google_finish", {
      p_user: j.user_id,
      p_event: j.event_id,
      p_lease: j.lease_token,
      p_revision: j.revision,
      p_result: "stale",
    });
    await f.dispatch();
    assert.equal(
      [...f.remote.values()][0].start.dateTime,
      "2026-11-12T15:00:00.000Z",
    );
  } finally {
    await f.close();
  }
});

test("hostess sync is limited to her assignments; browser RPC access and deactivated profiles cannot retain a connection", async () => {
  const f = await googleFixture();
  try {
    await f.assign(ids.tech);
    await f.assign(ids.hostess, "2026-11-12 17:00Z", "2026-11-12 22:00Z");
    await f.connect(ids.hostess);
    await f.dispatch();
    assert.equal(f.remote.size, 1);
    assert.equal(
      [...f.remote.values()][0].start.dateTime,
      "2026-11-12T17:00:00.000Z",
    );
    await asUser(f.db, ids.hostess);
    await assert.rejects(
      f.db.query("select google_disconnect($1)", [ids.tech]),
    );
    await assert.rejects(
      f.db.query("select google_connection($1)", [ids.tech]),
    );
    await assert.rejects(f.db.exec("select google_claim()"));
    await f.db.exec("reset role;set role anon");
    await assert.rejects(
      f.db.query("select google_connection($1)", [ids.hostess]),
    );
    await f.db.exec("reset role");
    await f.db.query("update profiles set is_active=false where id=$1", [
      ids.hostess,
    ]);
    const c = (
      await f.db.query(
        "select * from google_calendar_connections where user_id=$1",
        [ids.hostess],
      )
    ).rows[0];
    assert.equal(c.status, "disconnected");
    assert.equal(c.refresh_cipher, null);
    const before = f.calls.length;
    await f.dispatch();
    assert.equal(f.calls.length, before);
    assert.equal(
      (await f.google.status(googleReq("/api/google/status", ids.hostess)))
        .status,
      403,
    );
    assert.equal(
      (
        await f.db.query("select role,is_active from profiles where id=$1", [
          ids.admin,
        ])
      ).rows[0].role,
      "administrator",
    );
  } finally {
    await f.close();
  }
});
test("quota backoff and event deletion reconcile via the durable queue without an open client", async () => {
  const f = await googleFixture();
  try {
    await f.connect();
    await f.assign();
    f.flags.quota = true;
    await f.dispatch();
    assert.equal(f.remote.size, 0);
    await f.db.exec("reset role");
    const j = (
      await f.db.query(
        "select attempts,next_attempt_at>now() as deferred,done from google_calendar_jobs",
      )
    ).rows[0];
    assert.equal(j.attempts, 1);
    assert.equal(j.deferred, true);
    assert.equal(j.done, false);
    const before = f.calls.length;
    await f.dispatch();
    assert.equal(f.calls.length, before);
    f.flags.quota = false;
    await f.due();
    await f.dispatch();
    assert.equal(f.remote.size, 1);
    await asUser(f.db, ids.admin);
    await f.db.query("delete from events where id=$1", [ids.event]);
    await f.dispatch();
    assert.equal(f.remote.size, 0);
  } finally {
    await f.close();
  }
});
