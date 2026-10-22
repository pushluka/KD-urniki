import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
export const ids = {
  admin: "00000000-0000-0000-0000-000000000001",
  tech: "00000000-0000-0000-0000-000000000002",
  hostess: "00000000-0000-0000-0000-000000000003",
  other: "00000000-0000-0000-0000-000000000004",
  unprofiled: "00000000-0000-0000-0000-000000000005",
  event: "10000000-0000-0000-0000-000000000001",
};
export async function migrate(db, name) {
  await db.exec(
    await readFile(
      new URL(`../../supabase/migrations/${name}`, import.meta.url),
      "utf8",
    ),
  );
}
export async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
 create schema auth; create schema storage;
 create table auth.users(id uuid primary key, encrypted_password text not null default 'legacy-hash', raw_app_meta_data jsonb not null default '{}');
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade,created_at timestamptz not null default clock_timestamp());
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth,storage to authenticated,anon;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant select,insert,delete on storage.objects to authenticated;
 create function storage.extension(name text) returns text language sql as $$ select reverse(split_part(reverse(name),'.',1)) $$;`);
  await migrate(db, "202610200001_initial.sql");
  for (const [id, name, role] of [
    [ids.admin, "Ana Administrator", "administrator"],
    [ids.tech, "Tine Tehnik", "tehnik"],
    [ids.hostess, "Hana Hostesa", "hostesa"],
    [ids.other, "Rok Tehnik", "tehnik"],
  ]) {
    await db.query("insert into auth.users values ($1)", [id]);
    await db.query("insert into profiles values ($1,$2,$3)", [id, name, role]);
  }
  await db.query("insert into auth.users values ($1)", [ids.unprofiled]);
  await db.query(
    "insert into events(id,title,starts_at,ends_at,location,hostesses_needed,technicians_needed) values ($1,'Preizkusni koncert','2026-11-12 18:00Z','2026-11-12 21:00Z','Kulturni dom',2,2)",
    [ids.event],
  );
  await db.query("insert into assignments values ($1,$2)", [
    ids.event,
    ids.other,
  ]);
  await migrate(db, "202610200002_event_staffing.sql");
  await db.exec(
    "create role service_role bypassrls; grant usage on schema public,auth,storage to service_role;",
  );
  await migrate(db, "202610200003_staff_accounts.sql");
  await db.exec(
    "grant all on all tables in schema public,auth,storage to service_role;",
  );
  await migrate(db, "202610210001_first_password_change.sql");
  await migrate(db, "202610220001_web_push.sql");
  await migrate(db, "202610220002_admin_notifications.sql");
  return db;
}
export async function asUser(db, id, claims = { sub: id, app_metadata: {} }) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify(claims),
  ]);
  await db.exec("set role authenticated");
}
