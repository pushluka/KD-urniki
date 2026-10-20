import { test } from "node:test";
import assert from "node:assert/strict";
import { database, ids, asUser } from "./helpers/database.mjs";
import { assignmentTimes } from "../lib/staffing.ts";
test("migration preserves legacy assignments, admin classification and individual hours", async () => {
  const db = await database();
  try {
    const a = (await db.query("select * from assignments")).rows[0];
    assert.equal(a.user_id, ids.other);
    assert.equal(
      new Date(a.arrives_at).toISOString(),
      "2026-11-12T18:00:00.000Z",
    );
    assert.equal(
      (await db.query("select accounting_code from events")).rows[0]
        .accounting_code,
      null,
    );
    await asUser(db, ids.admin);
    await db.exec("update events set accounting_code='111'");
    assert.equal(
      (await db.query("select accounting_code from events")).rows[0]
        .accounting_code,
      "111",
    );
    await assert.rejects(db.exec("update events set accounting_code='112'"));
    await assert.rejects(db.exec("update events set accounting_code=null"));
    await assert.rejects(
      db.exec(
        "insert into events(title,starts_at,ends_at,location) values ('Manjkajoča postavka',now(),now()+interval '1 hour','Kulturni dom')",
      ),
    );
    await db.query(
      "insert into assignments(event_id,user_id,arrives_at,finishes_at) values ($1,$2,'2026-11-12 16:00Z','2026-11-12 22:00Z')",
      [ids.event, ids.tech],
    );
    await db.query(
      "insert into assignments(event_id,user_id,arrives_at,finishes_at) values ($1,$2,'2026-11-12 17:30Z','2026-11-12 21:15Z')",
      [ids.event, ids.hostess],
    );
    await db.query(
      "update assignments set arrives_at='2026-11-12 15:30Z' where user_id=$1",
      [ids.tech],
    );
    const rows = (
      await db.query(
        "select user_id,arrives_at,finishes_at from assignments order by user_id",
      )
    ).rows;
    assert.equal(rows.length, 3);
    assert.notEqual(String(rows[0].arrives_at), String(rows[1].arrives_at));
    await assert.rejects(
      db.query(
        "update assignments set finishes_at=arrives_at where user_id=$1",
        [ids.tech],
      ),
    );
    await assert.rejects(
      db.query("update assignments set arrives_at=null where user_id=$1", [
        ids.tech,
      ]),
    );
    await asUser(db, ids.hostess);
    assert.equal(
      (await db.query("select accounting_code from events")).rows[0]
        .accounting_code,
      "111",
    );
    assert.equal((await db.query("select * from assignments")).rows.length, 3);
    await db.exec("update events set accounting_code='110'");
    assert.equal(
      (await db.query("select accounting_code from events")).rows[0]
        .accounting_code,
      "111",
    );
  } finally {
    await db.close();
  }
});
test("RLS: technicians manage only themselves; hostesses cannot assign; PDF access follows assignment", async () => {
  const db = await database();
  try {
    await db.query(
      "insert into storage.objects(bucket_id,name) values ('technical-documents',$1)",
      [ids.event + "/rider.pdf"],
    );
    await asUser(db, ids.tech);
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      0,
    );
    await db.query(
      "insert into assignments(event_id,user_id,arrives_at,finishes_at) values ($1,$2,'2026-11-12 16:00Z','2026-11-12 22:00Z')",
      [ids.event, ids.tech],
    );
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      1,
    );
    await assert.rejects(
      db.query(
        "insert into assignments(event_id,user_id,arrives_at,finishes_at) values ($1,$2,'2026-11-12 17:00Z','2026-11-12 23:00Z')",
        [ids.event, ids.hostess],
      ),
    );
    await assert.rejects(
      db.query("update assignments set user_id=$1 where user_id=$2", [
        ids.hostess,
        ids.tech,
      ]),
    );
    await assert.rejects(
      db.query("update assignments set event_id=event_id where user_id=$1", [
        ids.tech,
      ]),
    );
    assert.equal(
      (
        await db.query(
          "update assignments set arrives_at='2026-11-12 16:30Z' where user_id=$1 returning *",
          [ids.other],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query("delete from assignments where user_id=$1 returning *", [
          ids.other,
        ])
      ).rows.length,
      0,
    );
    await db.query(
      "update assignments set arrives_at='2026-11-12 15:30Z' where user_id=$1",
      [ids.tech],
    );
    assert.equal(
      new Date(
        (
          await db.query(
            "select arrives_at from assignments where user_id=$1",
            [ids.tech],
          )
        ).rows[0].arrives_at,
      ).toISOString(),
      "2026-11-12T15:30:00.000Z",
    );
    await db.query("delete from assignments where user_id=$1", [ids.tech]);
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      0,
    );
    await asUser(db, ids.hostess);
    await assert.rejects(
      db.query(
        "insert into assignments(event_id,user_id,arrives_at,finishes_at) values ($1,$2,'2026-11-12 17:00Z','2026-11-12 23:00Z')",
        [ids.event, ids.hostess],
      ),
    );
    assert.equal(
      (await db.query("delete from assignments returning *")).rows.length,
      0,
    );
    await asUser(db, ids.unprofiled);
    assert.equal((await db.query("select * from assignments")).rows.length, 0);
  } finally {
    await db.close();
  }
});
test("external collaborators require admin, valid name/role/times and cascade on event deletion", async () => {
  const db = await database();
  try {
    await asUser(db, ids.admin);
    await db.query(
      "insert into external_assignments(event_id,full_name,role,arrives_at,finishes_at) values ($1,'Zunanji Tehnik','tehnik','2026-11-12 16:00Z','2026-11-13 01:00Z')",
      [ids.event],
    );
    for (const [name, role, finish] of [
      [" ", "tehnik", "2026-11-12 22:00Z"],
      ["Test", "administrator", "2026-11-12 22:00Z"],
      ["Test", "hostesa", "2026-11-12 15:00Z"],
    ])
      await assert.rejects(
        db.query(
          "insert into external_assignments(event_id,full_name,role,arrives_at,finishes_at) values ($1,$2,$3,'2026-11-12 16:00Z',$4)",
          [ids.event, name, role, finish],
        ),
      );
    await asUser(db, ids.tech);
    assert.equal(
      (await db.query("select * from external_assignments")).rows.length,
      1,
    );
    await assert.rejects(
      db.query(
        "insert into external_assignments(event_id,full_name,role,arrives_at,finishes_at) values ($1,'Nedovoljeno','tehnik','2026-11-12 16:00Z','2026-11-12 22:00Z')",
        [ids.event],
      ),
    );
    assert.equal(
      (await db.query("delete from external_assignments returning *")).rows
        .length,
      0,
    );
    await asUser(db, ids.admin);
    await db.exec("delete from events");
    assert.equal(
      (await db.query("select * from external_assignments")).rows.length,
      0,
    );
    assert.equal((await db.query("select * from assignments")).rows.length, 0);
    await db.exec("reset role; set role anon");
    await assert.rejects(db.exec("select * from external_assignments"));
  } finally {
    await db.close();
  }
});
test("individual times validate order and allow work outside the event, including overnight", () => {
  const form = new FormData();
  form.set("arrives_at", "2026-11-12T16:00");
  form.set("finishes_at", "2026-11-13T01:00");
  assert.ok(assignmentTimes(form).finishes_at.endsWith("Z"));
  form.set("finishes_at", "2026-11-12T15:59");
  assert.throws(() => assignmentTimes(form));
  form.set("arrives_at", "invalid");
  assert.throws(() => assignmentTimes(form));
});
