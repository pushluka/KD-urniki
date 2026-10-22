begin;
create table public.push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 endpoint_hash text not null unique check(endpoint_hash ~ '^[a-f0-9]{64}$'),
 endpoint text not null unique check(length(endpoint) <= 2048),
 p256dh text not null, auth text not null, vapid_key text not null,
 credential_nonce text,
 created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public,anon,authenticated;
grant select(id,user_id,endpoint_hash,created_at) on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
create policy own_push_summary on public.push_subscriptions for select to authenticated
 using(user_id=(select auth.uid()) and public.current_role() in ('tehnik','hostesa'));

-- Revoke delivery immediately when an account is deactivated or forced to reset.
create function public.revoke_account_push() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 delete from public.push_subscriptions where user_id=new.id;
 return new;
end;
$$;
create trigger revoke_account_push after update of is_active,must_change_password,role on public.profiles
 for each row when (not new.is_active or new.must_change_password or new.role not in ('tehnik','hostesa'))
 execute function public.revoke_account_push();
revoke all on function public.revoke_account_push() from public,anon,authenticated;

create table public.push_deliveries (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
 event_id uuid not null, kind text not null check(kind in ('assigned','changed','removed')),
 created_at timestamptz not null default now(),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 lease_token uuid, lease_until timestamptz,
 sent_at timestamptz, dead_at timestamptz
);
create index push_pending on public.push_deliveries(next_attempt_at) where sent_at is null and dead_at is null;
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from public,anon,authenticated;
grant all on public.push_deliveries to service_role;

create function public.register_push(p_user uuid,p_hash text,p_endpoint text,p_p256dh text,p_auth text,p_vapid text)
returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
 -- Serialize device registration for a user to enforce the device limit.
 perform 1 from public.profiles where id=p_user and is_active and not must_change_password and role in ('tehnik','hostesa') for update;
 if not found then raise exception 'Active staff required' using errcode='42501'; end if;
 select user_id into owner_id from public.push_subscriptions where endpoint_hash=p_hash;
 if owner_id is not null and owner_id<>p_user then raise exception 'Subscription already owned' using errcode='42501'; end if;
 if owner_id is null and (select count(*) from public.push_subscriptions where user_id=p_user)>=10 then
  raise exception 'Device limit reached' using errcode='23514';
 end if;
 insert into public.push_subscriptions(user_id,endpoint_hash,endpoint,p256dh,auth,vapid_key,credential_nonce)
 values(p_user,p_hash,p_endpoint,p_p256dh,p_auth,p_vapid,(select required_nonce from public.staff_password_state where user_id=p_user))
 on conflict(endpoint_hash) do update set p256dh=excluded.p256dh,auth=excluded.auth,vapid_key=excluded.vapid_key,credential_nonce=excluded.credential_nonce
 where public.push_subscriptions.user_id=p_user;
 if not found then raise exception 'Subscription already owned' using errcode='42501'; end if;
end;
$$;
create function public.enqueue_push(p_user uuid,p_event uuid,p_kind text) returns void
language sql security definer set search_path='' as $$
 insert into public.push_deliveries(user_id,subscription_id,event_id,kind)
 select p_user,s.id,p_event,p_kind from public.push_subscriptions s
 join public.profiles p on p.id=s.user_id left join public.staff_password_state st on st.user_id=p.id
 where p.id=p_user and p.is_active and not p.must_change_password and p.role in ('tehnik','hostesa')
 and not coalesce(st.reset_pending,false) and s.credential_nonce is not distinct from st.required_nonce
$$;
create function public.queue_assignment_push() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if public.current_role() is distinct from 'administrator'::public.app_role then return null; end if;
 if tg_op='INSERT' then perform public.enqueue_push(new.user_id,new.event_id,'assigned');
 elsif tg_op='DELETE' then perform public.enqueue_push(old.user_id,old.event_id,'removed');
 elsif new.user_id is distinct from old.user_id or new.event_id is distinct from old.event_id then
  perform public.enqueue_push(old.user_id,old.event_id,'removed');
  perform public.enqueue_push(new.user_id,new.event_id,'assigned');
 elsif new.arrives_at is distinct from old.arrives_at or new.finishes_at is distinct from old.finishes_at then
  perform public.enqueue_push(new.user_id,new.event_id,'changed');
 end if;
 return null;
end;
$$;
create trigger assignment_web_push after insert or update or delete on public.assignments
 for each row execute function public.queue_assignment_push();

-- Row leases prevent parallel dispatchers sending the same job concurrently.
create function public.claim_push(p_vapid text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 delete from public.push_subscriptions s using public.profiles p
 where s.user_id=p.id and (not p.is_active or p.must_change_password or s.vapid_key<>p_vapid
 or s.credential_nonce is distinct from (select required_nonce from public.staff_password_state where user_id=p.id));
 delete from public.push_deliveries where created_at<now()-interval '7 days';
 update public.push_deliveries set dead_at=now() where sent_at is null and dead_at is null
 and (attempts>=8 or created_at<now()-interval '24 hours');
 with picked as (
  select d.id from public.push_deliveries d join public.push_subscriptions s on s.id=d.subscription_id
  join public.profiles p on p.id=d.user_id
  where d.sent_at is null and d.dead_at is null and d.next_attempt_at<=now()
  and (d.lease_until is null or d.lease_until<now()) and p.is_active and not p.must_change_password
  and p.role in ('tehnik','hostesa')
  order by d.created_at limit 10 for update of d skip locked
 ), claimed as (
  update public.push_deliveries d set attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
  from picked where d.id=picked.id returning d.*
 ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'user_id',c.user_id,'event_id',c.event_id,'kind',c.kind,
 'lease_token',c.lease_token,'subscription_id',s.id,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth)),'[]'::jsonb)
 into result from claimed c join public.push_subscriptions s on s.id=c.subscription_id;
 return result;
end;
$$;
create function public.finish_push(p_id uuid,p_lease uuid,p_status integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_status in (404,410) then
  delete from public.push_subscriptions s using public.push_deliveries d
  where d.subscription_id=s.id and d.id=p_id and d.lease_token=p_lease;
 else
  update public.push_deliveries set
   sent_at=case when p_status between 200 and 299 then now() else null end,
   dead_at=case when p_status in (400,401,403,413) then now() else null end,
   next_attempt_at=now()+make_interval(secs=>least(3600,30*(2^least(attempts,7))::integer)),
   lease_until=null,lease_token=null
  where id=p_id and lease_token=p_lease and sent_at is null;
 end if;
end;
$$;
revoke all on function public.register_push(uuid,text,text,text,text,text),public.enqueue_push(uuid,uuid,text),
 public.queue_assignment_push(),public.claim_push(text),public.finish_push(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.register_push(uuid,text,text,text,text,text),public.claim_push(text),public.finish_push(uuid,uuid,integer) to service_role;
commit;
