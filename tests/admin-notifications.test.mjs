import { test } from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { serverFixture, token } from "./helpers/server-fixture.mjs";
import { asUser, ids } from "./helpers/database.mjs";
import { createPushApi } from "../lib/server/push.ts";
const origin = "https://kd-urniki.vercel.app",
  vapid = "admin-test-vapid",
  other = "00000000-0000-0000-0000-000000000006";
function req(
  path,
  user = ids.admin,
  data,
  method = data ? "POST" : "GET",
  headers = {},
) {
  return new Request(origin + path, {
    method,
    headers: {
      Origin: origin,
      Authorization: "Bearer " + token(user),
      "Content-Type": "application/json",
      ...headers,
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
}
async function setup() {
  const f = await serverFixture(),
    sent = [];
  const push = createPushApi({
    admin: f.admin,
    authorize: f.api.authorizePush,
    origin,
    publicKey: vapid,
    cronSecret: "cron-test",
    send: async (job, payload) =>
      sent.push({ job, payload: JSON.parse(payload) }),
  });
  return { ...f, push, sent };
}
async function subscribe(f, user, n) {
  const key = createECDH("prime256v1");
  key.generateKeys();
  const sub = {
    endpoint: `https://fcm.googleapis.com/fcm/send/admin-test-${n}`,
    keys: {
      p256dh: key.getPublicKey().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    },
  };
  const result = await f.push.subscribe(
    req("/api/push/subscription", user, sub),
  );
  assert.equal(result.status, 200, await result.clone().text());
  return sub;
}
async function secondAdmin(f) {
  await f.db.exec("reset role");
  await f.db.query("insert into auth.users(id) values($1)", [other]);
  await f.db.query(
    "insert into profiles(id,full_name,role) values($1,'Drugi Admin','administrator')",
    [other],
  );
  f.users.set(other, {
    ...f.users.get(ids.admin),
    id: other,
    email: "other-admin@example.test",
  });
}
async function assign(f, actor = ids.admin, user = ids.tech) {
  await asUser(f.db, actor);
  await f.db.query(
    "insert into assignments(event_id,user_id,arrives_at,finishes_at) select id,$2,starts_at,ends_at from events where id=$1",
    [ids.event, user],
  );
}
async function dispatch(f) {
  const result = await f.push.dispatch(
    req("/api/push/dispatch", ids.admin, {}),
  );
  assert.equal(result.status, 200, await result.clone().text());
}

test("one admin history record per change, one push per subscribed device, staff delivery unchanged", async () => {
  const f = await setup();
  try {
    await secondAdmin(f);
    await subscribe(f, ids.admin, 1);
    await subscribe(f, ids.admin, 2);
    await subscribe(f, ids.tech, 3);
    await assign(f);
    await f.db.exec("reset role");
    let history = (await f.db.query("select * from admin_notifications")).rows;
    assert.equal(history.length, 2);
    assert.equal(history.filter((n) => n.user_id === ids.admin).length, 1);
    assert.equal(history.filter((n) => n.user_id === other).length, 1);
    assert.equal(history[0].title, "Nova razporeditev");
    assert.equal(history[0].event_title, "Preizkusni koncert");
    await dispatch(f);
    assert.equal(f.sent.length, 3);
    const adminPush = f.sent.filter((m) => m.job.user_id === ids.admin),
      staff = f.sent.find((m) => m.job.user_id === ids.tech);
    assert.equal(adminPush.length, 2);
    assert.equal(
      adminPush[0].payload.notificationId,
      adminPush[1].payload.notificationId,
    );
    assert.equal(adminPush[0].payload.eventId, ids.event);
    assert.equal(adminPush[0].payload.recipientId, ids.admin);
    assert.equal(JSON.stringify(adminPush[0].payload).includes("Tine"), false);
    assert.equal(
      JSON.stringify(adminPush[0].payload).includes("Preizkusni koncert"),
      false,
    );
    assert.equal(
      staff.payload.body,
      "Dodeljeni ste dogodku. Odprite aplikacijo za podrobnosti.",
    );
    assert.equal(staff.payload.notificationId, staff.job.id);
    await dispatch(f);
    assert.equal(f.sent.length, 3);
    await asUser(f.db, ids.admin);
    await f.db.query(
      "update assignments set arrives_at=arrives_at where user_id=$1",
      [ids.tech],
    );
    await f.db.query("update events set notes='No notification' where id=$1", [
      ids.event,
    ]);
    await f.db.exec("reset role");
    assert.equal(
      (await f.db.query("select * from admin_notifications")).rows.length,
      2,
    );
    await asUser(f.db, ids.admin);
    await f.db.query(
      "update assignments set arrives_at=arrives_at-interval '1 hour' where user_id=$1",
      [ids.tech],
    );
    await f.db.query("delete from assignments where user_id=$1", [ids.tech]);
    await dispatch(f);
    assert.equal(f.sent.length, 9);
    await f.db.exec("reset role");
    assert.equal(
      (await f.db.query("select * from admin_notifications")).rows.length,
      6,
    );
    // Ordinary updates to the admin profile must no longer delete their subscription.
    await f.admin.rpc("set_staff_active", { p_id: ids.tech, p_active: false });
    await f.db.exec(
      "reset role;update profiles set is_active=true where role='administrator'",
    );
    assert.equal(
      (
        await f.db.query("select * from push_subscriptions where user_id=$1", [
          ids.admin,
        ])
      ).rows.length,
      2,
    );
  } finally {
    await f.close();
  }
});

test("technician self changes create admin history but no new staff pushes; rollback creates neither", async () => {
  const f = await setup();
  try {
    await subscribe(f, ids.admin, 1);
    await subscribe(f, ids.tech, 2);
    await assign(f, ids.tech);
    await dispatch(f);
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].job.user_id, ids.admin);
    await asUser(f.db, ids.tech);
    await f.db.query(
      "update assignments set finishes_at=finishes_at+interval '1 hour' where user_id=$1",
      [ids.tech],
    );
    await f.db.query("delete from assignments where user_id=$1", [ids.tech]);
    await dispatch(f);
    assert.equal(f.sent.length, 3);
    await asUser(f.db, ids.tech);
    await f.db.exec("begin");
    await f.db.query(
      "insert into assignments(event_id,user_id,arrives_at,finishes_at) select id,$2,starts_at,ends_at from events where id=$1",
      [ids.event, ids.tech],
    );
    await f.db.exec("rollback;reset role");
    assert.equal(
      (await f.db.query("select * from admin_notifications")).rows.length,
      3,
    );
  } finally {
    await f.close();
  }
});

test("history API and RLS isolate administrators; read state persists and content cannot be forged", async () => {
  const f = await setup();
  try {
    await secondAdmin(f);
    await assign(f);
    const result = await f.push.history(req("/api/push/history"));
    assert.equal(result.status, 200);
    const { items } = await result.json();
    assert.equal(items.length, 1);
    const id = items[0].id;
    assert.equal(
      (await f.push.history(req("/api/push/history", ids.tech))).status,
      403,
    );
    assert.equal(
      (await f.push.history(new Request(origin + "/api/push/history"))).status,
      401,
    );
    assert.equal(
      (
        await f.push.markRead(
          req("/api/push/history", other, { id, read: true }, "PATCH"),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await f.push.markRead(
          req("/api/push/history", ids.admin, { id, read: true }, "PATCH", {
            Origin: "https://evil.test",
          }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.push.markRead(
          req("/api/push/history", ids.admin, { id, read: true }, "PATCH"),
        )
      ).status,
      200,
    );
    let notice = (await (await f.push.history(req("/api/push/history"))).json())
      .items[0];
    assert.ok(notice.read_at);
    await f.push.markRead(
      req("/api/push/history", ids.admin, { id, read: false }, "PATCH"),
    );
    notice = (await (await f.push.history(req("/api/push/history"))).json())
      .items[0];
    assert.equal(notice.read_at, null);
    await asUser(f.db, ids.admin);
    assert.equal(
      (await f.db.query("select * from admin_notifications")).rows.length,
      1,
    );
    await assert.rejects(
      f.db.exec("update admin_notifications set body='Forged'"),
    );
    await assert.rejects(f.db.exec("delete from admin_notifications"));
    await assert.rejects(
      f.db.query("select list_admin_notifications($1,0)", [ids.admin]),
    );
    await asUser(f.db, ids.tech);
    assert.equal(
      (await f.db.query("select * from admin_notifications")).rows.length,
      0,
    );
    assert.equal(
      (
        await f.db.query(
          "update admin_notifications set read_at=now() returning id",
        )
      ).rows.length,
      0,
    );
    await f.db.exec("reset role;set role anon");
    await assert.rejects(f.db.exec("select * from admin_notifications"));
  } finally {
    await f.close();
  }
});

test("dispatch physically deletes history older than 14 days, with no pending jobs and even without VAPID", async () => {
  const f = await setup();
  try {
    await assign(f);
    await f.db.exec(
      "reset role;update admin_notifications set created_at=now()-interval '14 days 1 second'",
    );
    assert.equal(
      (
        await f.db.query(
          "select count(*)::int as count from admin_notifications",
        )
      ).rows[0].count,
      1,
    );
    await dispatch(f);
    await f.db.exec("reset role");
    assert.equal(
      (
        await f.db.query(
          "select count(*)::int as count from admin_notifications",
        )
      ).rows[0].count,
      0,
    );
    await f.db.query(
      "insert into admin_notifications(user_id,event_id,event_title,kind,title,body,created_at) values($1,$2,'Old','assigned','Old','Old',now()-interval '15 days'),($1,$2,'Keep','assigned','Keep','Keep',now()-interval '13 days')",
      [ids.admin, ids.event],
    );
    const noKey = createPushApi({
      admin: f.admin,
      authorize: f.api.authorizePush,
      origin,
      send: async () => {
        throw new Error("Must not send");
      },
    });
    assert.equal(
      (await noKey.dispatch(req("/api/push/dispatch", ids.admin, {}))).status,
      503,
    );
    await f.db.exec("reset role");
    const rows = (await f.db.query("select title from admin_notifications"))
      .rows;
    assert.deepEqual(rows, [{ title: "Keep" }]);
  } finally {
    await f.close();
  }
});

test("history is newest first, paginated, and survives loss of subscriptions/delivery logs", async () => {
  const f = await setup();
  try {
    await f.db.exec("reset role");
    await f.db.query(
      "insert into admin_notifications(user_id,event_id,event_title,kind,title,body,created_at) select $1,$2,'Event','changed','Record '||n,'Body',now()-interval '1 minute'*n from generate_series(1,55) n",
      [ids.admin, ids.event],
    );
    const page1 = await (await f.push.history(req("/api/push/history"))).json();
    assert.equal(page1.items.length, 50);
    assert.equal(page1.items[0].title, "Record 1");
    assert.equal(page1.items[49].title, "Record 50");
    assert.equal(page1.next_offset, 50);
    const page2 = await (
      await f.push.history(req("/api/push/history?offset=50"))
    ).json();
    assert.equal(page2.items.length, 5);
    assert.equal(page2.items[0].title, "Record 51");
    assert.equal(page2.next_offset, null);
    await f.db.exec(
      "reset role;delete from push_subscriptions;delete from push_deliveries",
    );
    assert.equal(
      (await (await f.push.history(req("/api/push/history"))).json()).items
        .length,
      50,
    );
  } finally {
    await f.close();
  }
});
