import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("RLS: roles, schedules and private documents", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
 create schema auth; create schema storage;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth,storage to authenticated,anon;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant select,insert,delete on storage.objects to authenticated;
 create function storage.extension(name text) returns text language sql as $$ select reverse(split_part(reverse(name),'.',1)) $$;`);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202610200001_initial.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const admin = "00000000-0000-0000-0000-000000000001",
      tech = "00000000-0000-0000-0000-000000000002",
      hostess = "00000000-0000-0000-0000-000000000003",
      other = "00000000-0000-0000-0000-000000000004",
      event = "10000000-0000-0000-0000-000000000001";
    for (const [id, role] of [
      [admin, "administrator"],
      [tech, "tehnik"],
      [hostess, "hostesa"],
      [other, "tehnik"],
    ]) {
      await db.query("insert into auth.users values ($1)", [id]);
      await db.query("insert into public.profiles values ($1,$2,$3)", [
        id,
        role,
        role,
      ]);
    }
    async function as(id) {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        id,
      ]);
      await db.exec("set role authenticated");
    }
    await as(admin);
    await db.query(
      "insert into events(id,title,starts_at,ends_at,location) values ($1,'Koncert','2026-11-01 18:00Z','2026-11-01 20:00Z','Kulturni dom')",
      [event],
    );
    await db.query("insert into assignments values ($1,$2)", [event, tech]);
    await db.query(
      "insert into storage.objects(bucket_id,name) values ('technical-documents',$1)",
      [event + "/rider.pdf"],
    );
    await as(tech);
    assert.equal((await db.query("select * from events")).rows.length, 1);
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      1,
    );
    await assert.rejects(
      db.exec(
        "insert into events(title,starts_at,ends_at,location) values ('Nedovoljeno',now(),now()+interval '1 hour','Kulturni dom')",
      ),
    );
    await assert.rejects(
      db.query("insert into assignments values ($1,$2)", [event, hostess]),
    );
    await assert.rejects(db.exec("update profiles set role='administrator'"));
    await as(hostess);
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      0,
    );
    await as(other);
    assert.equal(
      (await db.query("select * from storage.objects")).rows.length,
      0,
    );
    await as(admin);
    await assert.rejects(
      db.query(
        "insert into events(title,starts_at,ends_at,location) values ('Napačen čas',now(),now()-interval '1 hour','Kulturni dom')",
      ),
    );
    await db.exec("delete from events");
    assert.equal((await db.query("select * from assignments")).rows.length, 0);
    await db.exec("reset role; set role anon");
    await assert.rejects(db.exec("select * from events"));
  } finally {
    await db.close();
  }
});
