import { test } from "node:test";
import assert from "node:assert/strict";
import { createECDH, createHash, randomBytes } from "node:crypto";
import { serverFixture, token } from "./helpers/server-fixture.mjs";
import { asUser, ids } from "./helpers/database.mjs";
import {
  createPushApi,
  validPushEndpoint,
  pushPayload,
} from "../lib/server/push.ts";
const origin = "https://kd-urniki.vercel.app",
  publicKey = "public-test-vapid";
function req(path, user, data, method = data ? "POST" : "GET", extra = {}) {
  return new Request(origin + path, {
    method,
    headers: {
      Authorization: "Bearer " + token(user),
      Origin: origin,
      "Content-Type": "application/json",
      ...extra,
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}
function subscription(n = 1) {
  const e = createECDH("prime256v1");
  e.generateKeys();
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
    keys: {
      p256dh: e.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
}
async function setup() {
  const f = await serverFixture(),
    sent = [];
  let failure = null;
  const api = createPushApi({
    admin: f.admin,
    authorize: f.api.authorizePush,
    origin,
    publicKey,
    cronSecret: "test-cron-secret",
    send: async (job, payload) => {
      if (failure) throw failure;
      sent.push({ job, payload: JSON.parse(payload) });
    },
  });
  return {
    ...f,
    push: api,
    sent,
    fail: (status) => {
      failure = status ? { statusCode: status } : null;
    },
  };
}
async function register(f, user = ids.tech, n = 1) {
  const sub = subscription(n);
  const r = await f.push.subscribe(req("/api/push/subscription", user, sub));
  assert.equal(r.status, 200, await r.clone().text());
  return sub;
}
async function assign(f, user = ids.tech) {
  await asUser(f.db, ids.admin);
  await f.db.query(
    "insert into assignments(event_id,user_id,arrives_at,finishes_at) select id,$2,starts_at,ends_at from events where id=$1",
    [ids.event, user],
  );
}
async function dispatch(f) {
  return f.push.dispatch(
    new Request(origin + "/api/push/dispatch", {
      headers: { Authorization: "Bearer test-cron-secret" },
    }),
  );
}

test("push authentication, opt-in, SSRF/key validation and device ownership are enforced", async () => {
  const f = await setup();
  try {
    assert.equal(
      (await f.push.status(new Request(origin + "/api/push/subscription")))
        .status,
      401,
    );
    assert.equal(
      (
        await f.push.subscribe(
          req("/api/push/subscription", ids.unprofiled, subscription()),
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await f.push.subscribe(
          req("/api/push/subscription", ids.tech, subscription(), "POST", {
            Origin: "https://evil.test",
          }),
        )
      ).status,
      403,
    );
    for (const endpoint of [
      "http://127.0.0.1/push",
      "https://fcm.googleapis.com.evil.test/x",
      "https://user@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "https://169.254.169.254/x",
    ]) {
      assert.equal(validPushEndpoint(endpoint), false);
      assert.equal(
        (
          await f.push.subscribe(
            req("/api/push/subscription", ids.tech, {
              ...subscription(),
              endpoint,
            }),
          )
        ).status,
        400,
      );
    }
    assert.equal(
      (
        await f.push.subscribe(
          req("/api/push/subscription", ids.tech, {
            ...subscription(),
            keys: { p256dh: "bad", auth: "bad" },
          }),
        )
      ).status,
      400,
    );
    const sub = await register(f);
    assert.equal(
      (await f.push.subscribe(req("/api/push/subscription", ids.hostess, sub)))
        .status,
      503,
    );
    assert.equal(
      (
        await f.push.unsubscribe(
          req(
            "/api/push/subscription",
            ids.hostess,
            { endpoint: sub.endpoint },
            "DELETE",
          ),
        )
      ).status,
      200,
    );
    const status = await (
      await f.push.status(req("/api/push/subscription", ids.tech))
    ).json();
    assert.equal(status.endpoint_hashes.length, 1);
    assert.equal(JSON.stringify(status).includes(sub.keys.auth), false);
    await asUser(f.db, ids.tech);
    assert.equal(
      (await f.db.query("select endpoint_hash from push_subscriptions")).rows
        .length,
      1,
    );
    await assert.rejects(
      f.db.query("select endpoint,auth from push_subscriptions"),
    );
    await assert.rejects(f.db.query("select * from push_deliveries"));
    await assert.rejects(
      f.db.query("select public.claim_push($1)", [publicKey]),
    );
    await assert.rejects(f.db.exec("delete from push_subscriptions"));
    await asUser(f.db, ids.hostess);
    assert.equal(
      (await f.db.query("select endpoint_hash from push_subscriptions")).rows
        .length,
      0,
    );
    await f.push.unsubscribe(
      req(
        "/api/push/subscription",
        ids.tech,
        { endpoint: sub.endpoint },
        "DELETE",
      ),
    );
    assert.equal(
      (
        await (
          await f.push.status(req("/api/push/subscription", ids.tech))
        ).json()
      ).endpoint_hashes.length,
      0,
    );
  } finally {
    await f.close();
  }
});
test("only administrator assignment changes enqueue once per affected device; no-op, self edits and event changes do not", async () => {
  const f = await setup();
  try {
    await register(f, ids.tech, 1);
    await register(f, ids.tech, 2);
    await register(f, ids.hostess, 3);
    await assign(f);
    await f.db.exec("reset role");
    let jobs = (await f.db.query("select * from push_deliveries")).rows;
    assert.equal(jobs.length, 2);
    assert.ok(
      jobs.every((j) => j.user_id === ids.tech && j.kind === "assigned"),
    );
    await asUser(f.db, ids.admin);
    await f.db.query(
      "update assignments set arrives_at=arrives_at where user_id=$1",
      [ids.tech],
    );
    await f.db.query("update events set notes='Unrelated' where id=$1", [
      ids.event,
    ]);
    await asUser(f.db, ids.tech);
    await f.db.query(
      "update assignments set arrives_at=arrives_at-interval '1 hour' where user_id=$1",
      [ids.tech],
    );
    await f.db.exec("reset role");
    assert.equal(
      (await f.db.query("select * from push_deliveries")).rows.length,
      2,
    );
    await asUser(f.db, ids.admin);
    await f.db.query(
      "update assignments set finishes_at=finishes_at+interval '1 hour' where user_id=$1",
      [ids.tech],
    );
    await f.db.query("delete from assignments where user_id=$1", [ids.tech]);
    await f.db.exec("reset role");
    jobs = (await f.db.query("select * from push_deliveries")).rows;
    assert.equal(jobs.length, 6);
    assert.deepEqual(
      jobs.map((j) => j.kind).sort(),
      [
        "assigned",
        "assigned",
        "changed",
        "changed",
        "removed",
        "removed",
      ].sort(),
    );
    assert.equal((await dispatch(f)).status, 200);
    assert.equal(f.sent.length, 6);
    for (const m of f.sent) {
      assert.equal(m.payload.title, "KD Urniki");
      assert.equal(m.payload.recipientId, ids.tech);
      assert.equal(m.payload.eventId, ids.event);
      assert.equal(
        JSON.stringify(m.payload).includes("Preizkusni koncert"),
        false,
      );
    }
    await dispatch(f);
    assert.equal(f.sent.length, 6);
  } finally {
    await f.close();
  }
});
test("leases, retry, invalid subscriptions and failed delivery never undo committed staffing", async () => {
  const f = await setup();
  try {
    await register(f);
    await assign(f);
    const first = await f.admin.rpc("claim_push", { p_vapid: publicKey }),
      second = await f.admin.rpc("claim_push", { p_vapid: publicKey });
    assert.equal(first.data.length, 1);
    assert.equal(second.data.length, 0);
    await f.db.exec(
      "reset role;update push_deliveries set lease_until=now()-interval '1 minute'",
    );
    f.fail(503);
    assert.equal((await dispatch(f)).status, 200);
    await f.db.exec("reset role");
    assert.equal(
      (
        await f.db.query("select * from assignments where user_id=$1", [
          ids.tech,
        ])
      ).rows.length,
      1,
    );
    let row = (await f.db.query("select * from push_deliveries")).rows[0];
    assert.equal(row.sent_at, null);
    assert.ok(row.next_attempt_at > new Date());
    await f.admin.rpc("finish_push", {
      p_id: row.id,
      p_lease: first.data[0].lease_token,
      p_status: 204,
    });
    await f.db.exec("reset role");
    assert.equal(
      (await f.db.query("select sent_at from push_deliveries")).rows[0].sent_at,
      null,
    );
    f.fail(null);
    await f.db.exec("update push_deliveries set next_attempt_at=now()");
    await dispatch(f);
    assert.equal(f.sent.length, 1);
    await asUser(f.db, ids.admin);
    await f.db.query("delete from assignments where user_id=$1", [ids.tech]);
    f.fail(410);
    await dispatch(f);
    await f.db.exec("reset role");
    assert.equal(
      (await f.db.query("select * from push_subscriptions")).rows.length,
      0,
    );
    assert.equal(
      (await f.push.dispatch(req("/api/push/dispatch", ids.tech, {}, "POST")))
        .status,
      403,
    );
    assert.equal(
      (await f.push.dispatch(new Request(origin + "/api/push/dispatch")))
        .status,
      401,
    );
  } finally {
    await f.close();
  }
});
test("inactive and password-reset accounts cannot manage subscriptions or receive pending jobs", async () => {
  const f = await setup();
  try {
    await register(f);
    await assign(f);
    await f.admin.rpc("begin_staff_password_reset", { p_id: ids.tech });
    assert.notEqual(
      (await f.push.status(req("/api/push/subscription", ids.tech))).status,
      200,
    );
    await dispatch(f);
    assert.equal(f.sent.length, 0);
    await f.db.exec("reset role");
    assert.equal(
      (await f.db.query("select * from push_subscriptions")).rows.length,
      0,
    );
  } finally {
    await f.close();
  }
});

test("registration enforces a device cap and rolled-back staffing never leaves queued notifications", async () => {
  const f = await setup();
  try {
    for (let i = 1; i <= 10; i++) await register(f, ids.tech, i);
    assert.equal(
      (
        await f.push.subscribe(
          req("/api/push/subscription", ids.tech, subscription(11)),
        )
      ).status,
      503,
    );
    await asUser(f.db, ids.admin);
    await f.db.exec("begin");
    await f.db.query(
      "insert into assignments(event_id,user_id,arrives_at,finishes_at) select id,$2,starts_at,ends_at from events where id=$1",
      [ids.event, ids.tech],
    );
    await f.db.exec("rollback;reset role");
    assert.equal(
      (await f.db.query("select * from push_deliveries")).rows.length,
      0,
    );
    await f.admin.rpc("set_staff_active", { p_id: ids.tech, p_active: false });
    await f.db.exec("reset role");
    assert.equal(
      (await f.db.query("select * from push_subscriptions")).rows.length,
      0,
    );
  } finally {
    await f.close();
  }
});
