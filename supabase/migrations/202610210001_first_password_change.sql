begin;
-- Existing accounts, including administrators, are intentionally not forced to reset.
alter table public.profiles add column must_change_password boolean not null default false;
alter table public.profiles add constraint administrators_keep_password_access
 check (role <> 'administrator' or not must_change_password);

-- No plaintext password or password hash is copied here. Nonces bind signed JWTs
-- to the current credential epoch and make old temporary-password sessions unusable.
create table public.staff_password_state (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 required_nonce text,
 version bigint not null default 0,
 completion_nonce uuid,
 completion_version bigint,
 expires_at timestamptz,
 reset_pending boolean not null default false,
 reset_nonce uuid,
 session_after timestamptz,
 last_write_tx bigint
);
alter table public.staff_password_state enable row level security;
revoke all on public.staff_password_state from public,anon,authenticated;
grant select on public.staff_password_state to service_role;

create function public.staff_access_state(p_id uuid,p_nonce text,p_session text) returns text
language sql stable security definer set search_path='' as $$
 select coalesce((select case
  when not p.is_active then 'inactive'
  when p.role='administrator' then 'ready'
  when s.session_after is not null and not exists(select 1 from auth.sessions a where a.user_id=p_id and a.id::text=p_session and a.created_at>=s.session_after) then 'stale'
  when s.reset_pending or (s.required_nonce is not null and s.required_nonce is distinct from p_nonce) then 'stale'
  when p.must_change_password then 'pending' else 'ready' end
 from public.profiles p left join public.staff_password_state s on s.user_id=p.id where p.id=p_id),'inactive')
$$;

create or replace function public.current_role() returns public.app_role
language sql stable security definer set search_path='' as $$
 select p.role from public.profiles p where p.id=(select auth.uid()) and
 public.staff_access_state(p.id,(select auth.jwt())->'app_metadata'->>'staff_password_nonce',(select auth.jwt())->>'session_id')='ready'
$$;

create or replace function public.create_staff_profile(p_id uuid,p_username text,p_first_name text,p_last_name text,p_role public.app_role)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_role not in ('tehnik','hostesa') then raise exception 'Invalid staff role' using errcode='23514'; end if;
 insert into public.profiles(id,full_name,role,must_change_password)
 values(p_id,btrim(p_first_name)||' '||btrim(p_last_name),p_role,true);
 insert into public.staff_accounts values(p_id,p_username,p_first_name,p_last_name);
 insert into public.staff_password_state(user_id,required_nonce)
 select p_id,raw_app_meta_data->>'staff_password_nonce' from auth.users where id=p_id;
end;
$$;

create function public.begin_staff_password_reset(p_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare nonce uuid := gen_random_uuid();
begin
 if not exists(select 1 from public.profiles where id=p_id and is_active and role in ('tehnik','hostesa')) then
  raise exception 'Active staff profile required' using errcode='42501';
 end if;
 insert into public.staff_password_state(user_id) values(p_id) on conflict do nothing;
 update public.staff_password_state set reset_pending=true,reset_nonce=nonce,version=version+1,
 completion_nonce=null,completion_version=null,expires_at=null,session_after=clock_timestamp() where user_id=p_id;
 update public.profiles set must_change_password=true where id=p_id;
 return nonce;
end;
$$;

create function public.begin_staff_password_change(p_id uuid,p_nonce text,p_session text) returns uuid
language plpgsql security definer set search_path='' as $$
declare nonce uuid := gen_random_uuid();
begin
 update public.staff_password_state s set completion_nonce=nonce,completion_version=s.version,expires_at=now()+interval '5 minutes'
 where s.user_id=p_id and not s.reset_pending and public.staff_access_state(p_id,p_nonce,p_session)='pending'
 and (s.required_nonce is null or s.required_nonce is not distinct from p_nonce)
 and exists(select 1 from public.profiles p where p.id=p_id and p.is_active and p.must_change_password and p.role in ('tehnik','hostesa'));
 if not found then raise exception 'Password change session expired' using errcode='42501'; end if;
 return nonce;
end;
$$;

-- Runs in the SAME transaction as Supabase Auth's password write. An Auth password
-- update alone cannot clear the flag: the server must have issued a fresh permit.
create function public.finish_staff_password_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare s public.staff_password_state%rowtype; u auth.users%rowtype; next_nonce text;
begin
 select * into s from public.staff_password_state where user_id=new.id for update;
 if not found then return new; end if; -- untouched legacy accounts and administrators
 if s.last_write_tx=txid_current() then return new; end if;
 -- Auth writes the password before metadata in separate UPDATE statements.
 -- Read the final row at commit, then process this transaction only once.
 select * into u from auth.users where id=new.id;
 if s.reset_pending and s.reset_nonce::text=u.raw_app_meta_data->>'staff_password_nonce' then
  update public.profiles set must_change_password=true where id=new.id and role in ('tehnik','hostesa');
  update public.staff_password_state set required_nonce=s.reset_nonce::text,reset_pending=false,reset_nonce=null,
   version=version+1,last_write_tx=txid_current(),completion_nonce=null,completion_version=null,expires_at=null,session_after=clock_timestamp() where user_id=new.id;
 elsif u.encrypted_password is distinct from old.encrypted_password then
  next_nonce := s.required_nonce;
  if not s.reset_pending and s.completion_nonce is not null and s.completion_version=s.version
   and s.expires_at>now() and s.completion_nonce::text=u.raw_app_meta_data->>'staff_password_nonce' then
   update public.profiles set must_change_password=false where id=new.id and is_active
    and must_change_password and role in ('tehnik','hostesa');
   if found then next_nonce := s.completion_nonce::text; end if;
  end if;
  if exists(select 1 from public.profiles where id=new.id and must_change_password) then
   raise exception 'Use the verified mandatory password-change flow' using errcode='23514';
  end if;
  update public.staff_password_state set required_nonce=next_nonce,version=version+1,last_write_tx=txid_current(),
   completion_nonce=null,completion_version=null,expires_at=null,
   session_after=case when next_nonce is distinct from s.required_nonce then clock_timestamp() else s.session_after end where user_id=new.id;
 end if;
 return new;
end;
$$;
create constraint trigger kd_staff_password_write after update on auth.users
 deferrable initially deferred for each row execute function public.finish_staff_password_write();

revoke all on function public.staff_access_state(uuid,text,text), public.begin_staff_password_reset(uuid),
 public.begin_staff_password_change(uuid,text,text),public.finish_staff_password_write() from public,anon,authenticated;
grant execute on function public.staff_access_state(uuid,text,text),public.begin_staff_password_reset(uuid),
 public.begin_staff_password_change(uuid,text,text) to service_role;
commit;
