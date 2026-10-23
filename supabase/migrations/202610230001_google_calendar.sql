begin;
-- Tokens and OAuth codes are encrypted by the server before reaching these tables.
create table public.google_calendar_connections (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 generation uuid not null default gen_random_uuid(),
 status text not null default 'disconnected' check(status in ('disconnected','awaiting_calendar','connected','reauthorize')),
 refresh_cipher text, access_cipher text, expires_at timestamptz,
 calendar_id text, calendar_name text,
 provision_marker uuid not null default gen_random_uuid(),provision_started_at timestamptz,
 lease_token uuid, lease_until timestamptz,
 last_error text, last_synced_at timestamptz,
 check(status not in ('awaiting_calendar','connected') or refresh_cipher is not null)
);
create table public.google_calendar_oauth (
 state_hash text primary key, user_id uuid not null references public.profiles(id) on delete cascade,
 cookie_hash text not null, verifier_cipher text not null, code_cipher text,
 generation uuid not null, credential_nonce text,
 expires_at timestamptz not null default now()+interval '10 minutes'
);
create table public.google_calendar_mappings (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 calendar_id text not null, event_id uuid not null,
 google_event_id text not null default 'kd'||replace(gen_random_uuid()::text,'-',''),
 marker uuid not null default gen_random_uuid(),
 remote_seen boolean not null default false, deleted boolean not null default false,
 unique(user_id,calendar_id,event_id)
);
create table public.google_calendar_jobs (
 user_id uuid not null references public.profiles(id) on delete cascade,
 event_id uuid not null,
 revision bigint not null default 1,
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 done boolean not null default false,
 lease_token uuid, lease_until timestamptz,
 primary key(user_id,event_id)
);
create index google_calendar_pending on public.google_calendar_jobs(next_attempt_at) where not done;
create index google_oauth_expiry on public.google_calendar_oauth(expires_at);
alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_oauth enable row level security;
alter table public.google_calendar_mappings enable row level security;
alter table public.google_calendar_jobs enable row level security;
revoke all on public.google_calendar_connections,public.google_calendar_oauth,public.google_calendar_mappings,public.google_calendar_jobs from public,anon,authenticated;
grant all on public.google_calendar_connections,public.google_calendar_oauth,public.google_calendar_mappings,public.google_calendar_jobs to service_role;

create function public.google_staff(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=p_user and is_active and not must_change_password and role in ('tehnik','hostesa'))
$$;
create function public.google_connection(p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select to_jsonb(c) from public.google_calendar_connections c where c.user_id=p_user
$$;
create function public.google_oauth_begin(p_user uuid,p_state text,p_cookie text,p_verifier text) returns void
language plpgsql security definer set search_path='' as $$
declare c public.google_calendar_connections%rowtype;
begin
 if not public.google_staff(p_user) then raise exception 'Staff required' using errcode='42501'; end if;
 insert into public.google_calendar_connections(user_id) values(p_user) on conflict do nothing;
 select * into c from public.google_calendar_connections where user_id=p_user for update;
 if c.status in ('connected','awaiting_calendar') then raise exception 'Disconnect first' using errcode='23514'; end if;
 update public.google_calendar_connections set generation=gen_random_uuid() where user_id=p_user returning generation into c.generation;
 delete from public.google_calendar_oauth where user_id=p_user or expires_at<now();
 insert into public.google_calendar_oauth(state_hash,user_id,cookie_hash,verifier_cipher,generation,credential_nonce)
 values(p_state,p_user,p_cookie,p_verifier,c.generation,(select required_nonce from public.staff_password_state where user_id=p_user));
end;
$$;
create function public.google_oauth_callback(p_state text,p_cookie text,p_code text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update public.google_calendar_oauth set code_cipher=p_code
 where state_hash=p_state and cookie_hash=p_cookie and expires_at>now() and code_cipher is null;
 return found;
end;
$$;
create function public.google_oauth_take(p_user uuid,p_state text,p_cookie text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare flow public.google_calendar_oauth%rowtype;
begin
 if not public.google_staff(p_user) then raise exception 'Staff required' using errcode='42501'; end if;
 delete from public.google_calendar_oauth o where o.state_hash=p_state and o.user_id=p_user
 and o.cookie_hash=p_cookie and o.expires_at>now() and o.code_cipher is not null
 and o.generation=(select generation from public.google_calendar_connections where user_id=p_user)
 and o.credential_nonce is not distinct from (select required_nonce from public.staff_password_state where user_id=p_user)
 returning * into flow;
 if not found then return null; end if;
 return to_jsonb(flow);
end;
$$;
create function public.google_store_tokens(p_user uuid,p_generation uuid,p_refresh text,p_access text,p_expiry timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not public.google_staff(p_user) then raise exception 'Staff required' using errcode='42501'; end if;
 update public.google_calendar_connections set generation=gen_random_uuid(),status='awaiting_calendar',
 refresh_cipher=p_refresh,access_cipher=p_access,expires_at=p_expiry,
 lease_token=null,lease_until=null,last_error=null
 where user_id=p_user and generation=p_generation and status<>'connected' returning generation into result;
 return result;
end;
$$;
create function public.google_disconnect(p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old jsonb;
begin
 select to_jsonb(c) into old from public.google_calendar_connections c where user_id=p_user for update;
 update public.google_calendar_connections set status='disconnected',generation=gen_random_uuid(),refresh_cipher=null,
 access_cipher=null,expires_at=null,lease_token=null,lease_until=null,last_error=null where user_id=p_user;
 delete from public.google_calendar_oauth where user_id=p_user;
 delete from public.google_calendar_jobs where user_id=p_user;
 return old;
end;
$$;
create function public.google_enqueue(p_user uuid,p_event uuid) returns void
language sql security definer set search_path='' as $$
 insert into public.google_calendar_jobs(user_id,event_id)
 select p_user,p_event where exists(select 1 from public.google_calendar_connections where user_id=p_user and status='connected')
 on conflict(user_id,event_id) do update set revision=public.google_calendar_jobs.revision+1,attempts=0,next_attempt_at=now(),done=false
$$;
create function public.google_assignment_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then perform public.google_enqueue(new.user_id,new.event_id);
 elsif tg_op='DELETE' then perform public.google_enqueue(old.user_id,old.event_id);
 elsif new.user_id is distinct from old.user_id or new.event_id is distinct from old.event_id then
  perform public.google_enqueue(old.user_id,old.event_id);perform public.google_enqueue(new.user_id,new.event_id);
 elsif new.arrives_at is distinct from old.arrives_at or new.finishes_at is distinct from old.finishes_at then
  perform public.google_enqueue(new.user_id,new.event_id);
 end if;
 return null;
end;
$$;
create trigger google_assignment_sync after insert or update or delete on public.assignments for each row execute function public.google_assignment_changed();
create function public.google_event_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare person record;
begin
 if new.title is distinct from old.title or new.location is distinct from old.location or new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then
  for person in select user_id from public.assignments where event_id=new.id loop perform public.google_enqueue(person.user_id,new.id);end loop;
 end if;
 return new;
end;
$$;
create trigger google_event_sync after update of title,location,starts_at,ends_at on public.events for each row execute function public.google_event_changed();
create function public.google_revoke_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 perform public.google_disconnect(new.id);return new;
end;
$$;
create trigger google_revoke_profile after update of is_active,must_change_password,role on public.profiles
 for each row when(not new.is_active or new.must_change_password or new.role not in ('tehnik','hostesa')) execute function public.google_revoke_profile();

create function public.google_acquire(p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.google_calendar_connections%rowtype;
begin
 if not public.google_staff(p_user) then return null; end if;
 update public.google_calendar_connections set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
 where user_id=p_user and status in ('connected','awaiting_calendar') and (lease_until is null or lease_until<now()) returning * into c;
 return to_jsonb(c);
end;
$$;
create function public.google_release(p_user uuid,p_lease uuid) returns void
language sql security definer set search_path='' as $$
 update public.google_calendar_connections set lease_token=null,lease_until=null where user_id=p_user and lease_token=p_lease
$$;
create function public.google_lease_valid(p_user uuid,p_generation uuid,p_lease uuid,p_event uuid default null,p_revision bigint default null) returns boolean
language sql stable security definer set search_path='' as $$
 select public.google_staff(p_user) and exists(select 1 from public.google_calendar_connections c where c.user_id=p_user and c.generation=p_generation
 and c.lease_token=p_lease and c.lease_until>now() and c.status in ('connected','awaiting_calendar'))
 and (p_event is null or exists(select 1 from public.google_calendar_jobs j where j.user_id=p_user and j.event_id=p_event and j.revision=p_revision))
$$;
create function public.google_refresh(p_user uuid,p_generation uuid,p_lease uuid,p_access text,p_refresh text,p_expiry timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update public.google_calendar_connections set access_cipher=p_access,refresh_cipher=coalesce(p_refresh,refresh_cipher),expires_at=p_expiry
 where user_id=p_user and generation=p_generation and lease_token=p_lease and status in ('connected','awaiting_calendar');return found;
end;
$$;
create function public.google_resync(p_user uuid,p_generation uuid,p_lease uuid,p_calendar text,p_name text) returns boolean
language plpgsql security definer set search_path='' as $$
declare row record;
begin
 if not public.google_lease_valid(p_user,p_generation,p_lease) then return false;end if;
 update public.google_calendar_connections set calendar_id=p_calendar,calendar_name=p_name,status='connected',last_error=null,provision_started_at=null where user_id=p_user;
 for row in select event_id from public.assignments where user_id=p_user union select event_id from public.google_calendar_mappings where user_id=p_user and calendar_id=p_calendar loop
  perform public.google_enqueue(p_user,row.event_id);
 end loop;
 return true;
end;
$$;
create function public.google_begin_provision(p_user uuid,p_generation uuid,p_lease uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not public.google_lease_valid(p_user,p_generation,p_lease) then return false;end if;
 update public.google_calendar_connections set provision_started_at=now(),last_error='provision_unknown'
 where user_id=p_user and provision_started_at is null;
 return found;
end;
$$;
create function public.google_claim() returns jsonb
language plpgsql security definer set search_path='' as $$
declare c record;j public.google_calendar_jobs%rowtype;result jsonb:='[]'::jsonb;lease uuid;
begin
 delete from public.google_calendar_oauth where expires_at<now();
 for c in select co.user_id,co.generation from public.google_calendar_connections co where co.status='connected' and public.google_staff(co.user_id)
 and (co.lease_until is null or co.lease_until<now()) and exists(select 1 from public.google_calendar_jobs where user_id=co.user_id and not done and attempts<15 and next_attempt_at<=now() and (lease_until is null or lease_until<now()))
 limit 3 for update skip locked loop
  select * into j from public.google_calendar_jobs where user_id=c.user_id and not done and attempts<15 and next_attempt_at<=now() and (lease_until is null or lease_until<now()) order by next_attempt_at,event_id limit 1 for update skip locked;
  if not found then continue;end if;
  lease:=gen_random_uuid();
  update public.google_calendar_connections set lease_token=lease,lease_until=now()+interval '2 minutes' where user_id=c.user_id;
  update public.google_calendar_jobs set lease_token=lease,lease_until=now()+interval '2 minutes',attempts=attempts+1 where user_id=j.user_id and event_id=j.event_id;
  result:=result||jsonb_build_array(jsonb_build_object('user_id',c.user_id,'generation',c.generation,'event_id',j.event_id,'revision',j.revision,'lease_token',lease));
 end loop;
 return result;
end;
$$;
create function public.google_prepare(p_user uuid,p_generation uuid,p_lease uuid,p_event uuid,p_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.google_calendar_connections%rowtype;m public.google_calendar_mappings%rowtype;desired jsonb;
begin
 if not public.google_lease_valid(p_user,p_generation,p_lease,p_event,p_revision) then return null;end if;
 select * into c from public.google_calendar_connections where user_id=p_user;
 select jsonb_build_object('title',e.title,'location',e.location,'starts_at',e.starts_at,'ends_at',e.ends_at,'arrives_at',a.arrives_at,'finishes_at',a.finishes_at)
 into desired from public.assignments a join public.events e on e.id=a.event_id where a.user_id=p_user and a.event_id=p_event;
 if desired is not null then
  insert into public.google_calendar_mappings(user_id,calendar_id,event_id) values(p_user,c.calendar_id,p_event) on conflict do nothing;
  update public.google_calendar_mappings set google_event_id='kd'||replace(gen_random_uuid()::text,'-',''),marker=gen_random_uuid(),deleted=false,remote_seen=false where user_id=p_user and calendar_id=c.calendar_id and event_id=p_event and deleted;
 end if;
 select * into m from public.google_calendar_mappings where user_id=p_user and calendar_id=c.calendar_id and event_id=p_event;
 return jsonb_build_object('connection',to_jsonb(c),'mapping',to_jsonb(m),'desired',desired);
end;
$$;
create function public.google_mapping_result(p_user uuid,p_generation uuid,p_lease uuid,p_id uuid,p_deleted boolean,p_rotate boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.google_lease_valid(p_user,p_generation,p_lease) then return null;end if;
 update public.google_calendar_mappings set deleted=p_deleted,remote_seen=not p_rotate,
 google_event_id=case when p_rotate then 'kd'||replace(gen_random_uuid()::text,'-','') else google_event_id end,
 marker=case when p_rotate then gen_random_uuid() else marker end
 where id=p_id and user_id=p_user returning to_jsonb(google_calendar_mappings) into result;
 return result;
end;
$$;
create function public.google_finish(p_user uuid,p_event uuid,p_lease uuid,p_revision bigint,p_result text) returns void
language plpgsql security definer set search_path='' as $$
begin
 update public.google_calendar_jobs set lease_token=null,lease_until=null,
 done=case when revision=p_revision then p_result='ok' else false end,
 attempts=case when revision<>p_revision then 0 else attempts end,
 next_attempt_at=case when revision<>p_revision or p_result='ok' then now() else now()+make_interval(secs=>least(3600,30*(2^least(attempts,7))::integer)) end
 where user_id=p_user and event_id=p_event and lease_token=p_lease;
 update public.google_calendar_connections set lease_token=null,lease_until=null,
 last_synced_at=case when p_result='ok' then now() else last_synced_at end,last_error=case when p_result='ok' then null else p_result end
 where user_id=p_user and lease_token=p_lease;
end;
$$;
create function public.google_pause(p_user uuid,p_generation uuid,p_lease uuid,p_status text,p_error text) returns void
language sql security definer set search_path='' as $$
 update public.google_calendar_connections set status=p_status,last_error=p_error,
 refresh_cipher=case when p_status='reauthorize' then null else refresh_cipher end,
 access_cipher=case when p_status='reauthorize' then null else access_cipher end
 where user_id=p_user and generation=p_generation and lease_token=p_lease
$$;
-- No browser roles can read tokens, queue work or call privileged functions.
do $$declare r record;begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'google_%' loop
  execute 'revoke all on function '||r.signature||' from public,anon,authenticated';
  execute 'grant execute on function '||r.signature||' to service_role';
 end loop;
end$$;
commit;
