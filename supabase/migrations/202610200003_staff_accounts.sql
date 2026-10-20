begin;
-- Existing profiles, administrator IDs, events and assignments are preserved.
alter table public.profiles add column is_active boolean not null default true;
grant select on public.profiles to service_role;
create or replace function public.current_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
 select role from public.profiles where id=(select auth.uid()) and is_active
$$;

-- This table is NOT a public username directory. Only the server service role can read it.
create table public.staff_accounts (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 username text not null unique check (username ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
 first_name text not null check(length(btrim(first_name)) between 1 and 60),
 last_name text not null check(length(btrim(last_name)) between 1 and 60)
);
alter table public.staff_accounts enable row level security;
revoke all on public.staff_accounts from public, anon, authenticated;
grant select,insert,update,delete on public.staff_accounts to service_role;

-- Both writes are atomic. Never upsert a profile into an existing Auth identity.
create function public.create_staff_profile(p_id uuid,p_username text,p_first_name text,p_last_name text,p_role public.app_role)
returns void language plpgsql security definer set search_path = '' as $$
begin
 if p_role not in ('tehnik','hostesa') then raise exception 'Invalid staff role' using errcode='23514'; end if;
 insert into public.profiles(id,full_name,role) values(p_id,btrim(p_first_name)||' '||btrim(p_last_name),p_role);
 insert into public.staff_accounts values(p_id,p_username,p_first_name,p_last_name);
end;
$$;
create function public.update_staff_profile(p_id uuid,p_username text,p_first_name text,p_last_name text,p_role public.app_role)
returns void language plpgsql security definer set search_path = '' as $$
declare old_role public.app_role;
begin
 select role into old_role from public.profiles where id=p_id for update;
 if old_role is null or old_role='administrator' or p_role not in ('tehnik','hostesa') then
  raise exception 'Staff profile required' using errcode='42501';
 end if;
 update public.profiles set full_name=btrim(p_first_name)||' '||btrim(p_last_name),role=p_role where id=p_id;
 insert into public.staff_accounts values(p_id,p_username,p_first_name,p_last_name)
 on conflict(user_id) do update set username=excluded.username,first_name=excluded.first_name,last_name=excluded.last_name;
end;
$$;
create function public.set_staff_active(p_id uuid,p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
 update public.profiles set is_active=p_active where id=p_id and role in ('tehnik','hostesa');
 if not found then raise exception 'Staff profile required' using errcode='42501'; end if;
end;
$$;
revoke all on function public.create_staff_profile(uuid,text,text,text,public.app_role),
 public.update_staff_profile(uuid,text,text,text,public.app_role),public.set_staff_active(uuid,boolean)
 from public,anon,authenticated;
grant execute on function public.create_staff_profile(uuid,text,text,text,public.app_role),
 public.update_staff_profile(uuid,text,text,text,public.app_role),public.set_staff_active(uuid,boolean) to service_role;

-- Shared, atomic rate limiting across Vercel instances. Stores only HMAC digests.
create table public.auth_attempts (
 bucket text primary key check(bucket ~ '^[a-f0-9]{64}$'),
 window_started timestamptz not null,
 attempts integer not null
);
create index auth_attempts_window_idx on public.auth_attempts(window_started);
alter table public.auth_attempts enable row level security;
revoke all on public.auth_attempts from public,anon,authenticated;
create function public.take_login_attempt(p_bucket text,p_limit integer,p_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
 if p_limit not between 1 and 100 or p_seconds not between 60 and 86400 then raise exception 'Invalid rate limit'; end if;
 delete from public.auth_attempts where window_started < now()-interval '1 day';
 insert into public.auth_attempts as a values(p_bucket,now(),1)
 on conflict(bucket) do update set
 attempts=case when a.window_started <= now()-make_interval(secs=>p_seconds) then 1 else least(a.attempts+1,p_limit+1) end,
 window_started=case when a.window_started <= now()-make_interval(secs=>p_seconds) then now() else a.window_started end
 returning attempts into n;
 return n<=p_limit;
end;
$$;
revoke all on function public.take_login_attempt(text,integer,integer) from public,anon,authenticated;
grant execute on function public.take_login_attempt(text,integer,integer) to service_role;
-- Inactive people keep their historical assignments, but cannot be newly assigned.
create function public.require_active_assignee() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from public.profiles where id=new.user_id and is_active and role in ('tehnik','hostesa')) then
  raise exception 'Active staff profile required' using errcode='23514';
 end if;
 return new;
end;
$$;
revoke all on function public.require_active_assignee() from public,anon,authenticated;
create trigger assignments_require_active_assignee before insert or update of user_id on public.assignments
for each row execute function public.require_active_assignee();
commit;
