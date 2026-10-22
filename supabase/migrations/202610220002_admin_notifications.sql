begin;
create table public.admin_notifications (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 event_id uuid not null,
 event_title text not null,
 kind text not null check(kind in ('assigned','changed','removed')),
 title text not null, body text not null,
 created_at timestamptz not null default now(), read_at timestamptz
);
create index admin_notifications_recent on public.admin_notifications(user_id,created_at desc,id desc);
create index admin_notifications_expiry on public.admin_notifications(created_at);
alter table public.admin_notifications enable row level security;
revoke all on public.admin_notifications from public,anon,authenticated;
grant select on public.admin_notifications to authenticated;
grant update(read_at) on public.admin_notifications to authenticated;
grant all on public.admin_notifications to service_role;
create policy own_admin_notifications on public.admin_notifications for select to authenticated
 using(user_id=(select auth.uid()) and public.current_role()='administrator' and created_at>=now()-interval '14 days');
create policy own_admin_notification_read on public.admin_notifications for update to authenticated
 using(user_id=(select auth.uid()) and public.current_role()='administrator' and created_at>=now()-interval '14 days')
 with check(user_id=(select auth.uid()) and public.current_role()='administrator');

-- A history entry is independent of subscription count; delivery still uses one outbox.
alter table public.push_deliveries add column notification_id uuid references public.admin_notifications(id) on delete cascade;
create unique index admin_notification_device_once on public.push_deliveries(notification_id,subscription_id) where notification_id is not null;

create function public.cleanup_admin_notifications() returns integer
language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
 delete from public.admin_notifications where created_at<now()-interval '14 days';
 get diagnostics removed=row_count;
 return removed;
end;
$$;

alter policy own_push_summary on public.push_subscriptions
 using(user_id=(select auth.uid()) and public.current_role() in ('administrator','tehnik','hostesa'));
drop trigger revoke_account_push on public.profiles;
create trigger revoke_account_push after update of is_active,must_change_password,role on public.profiles
 for each row when (not new.is_active or new.must_change_password)
 execute function public.revoke_account_push();
create or replace function public.register_push(p_user uuid,p_hash text,p_endpoint text,p_p256dh text,p_auth text,p_vapid text)
returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
 -- Serialize device registration for a user to enforce the device limit.
 perform 1 from public.profiles where id=p_user and is_active and not must_change_password and role in ('administrator','tehnik','hostesa') for update;
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

create function public.record_admin_assignment_notification(p_user uuid,p_event uuid,p_kind text) returns void
language plpgsql security definer set search_path='' as $$
declare recipient record; notification uuid; person text; event_name text; heading text; content text;
begin
 select full_name into person from public.profiles where id=p_user;
 select title into event_name from public.events where id=p_event;
 event_name:=coalesce(event_name,'Odstranjen dogodek');
 heading:=case p_kind when 'assigned' then 'Nova razporeditev' when 'changed' then 'Spremenjene ure' else 'Odstranitev z dogodka' end;
 content:=coalesce(person,'Sodelavec')||case p_kind when 'assigned' then ' je razporejen na dogodek.' when 'changed' then ' ima spremenjen prihod ali zaključek.' else ' je odstranjen z dogodka.' end;
 for recipient in select id from public.profiles where is_active and role='administrator' and not must_change_password loop
  insert into public.admin_notifications(user_id,event_id,event_title,kind,title,body)
  values(recipient.id,p_event,event_name,p_kind,heading,content) returning id into notification;
  insert into public.push_deliveries(user_id,subscription_id,event_id,kind,notification_id)
  select recipient.id,s.id,p_event,p_kind,notification from public.push_subscriptions s
  left join public.staff_password_state st on st.user_id=s.user_id
  where s.user_id=recipient.id and not coalesce(st.reset_pending,false)
   and s.credential_nonce is not distinct from st.required_nonce
  on conflict do nothing;
 end loop;
end;
$$;
create function public.queue_admin_assignment_notification() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- Only authenticated app users with existing assignment permissions generate history.
 if public.current_role() is null then return null; end if;
 if tg_op='INSERT' then perform public.record_admin_assignment_notification(new.user_id,new.event_id,'assigned');
 elsif tg_op='DELETE' then perform public.record_admin_assignment_notification(old.user_id,old.event_id,'removed');
 elsif new.user_id is distinct from old.user_id or new.event_id is distinct from old.event_id then
  perform public.record_admin_assignment_notification(old.user_id,old.event_id,'removed');
  perform public.record_admin_assignment_notification(new.user_id,new.event_id,'assigned');
 elsif new.arrives_at is distinct from old.arrives_at or new.finishes_at is distinct from old.finishes_at then
  perform public.record_admin_assignment_notification(new.user_id,new.event_id,'changed');
 end if;
 return null;
end;
$$;
create trigger admin_assignment_history after insert or update or delete on public.assignments
 for each row execute function public.queue_admin_assignment_notification();
create or replace function public.claim_push(p_vapid text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.cleanup_admin_notifications();
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
  and p.role in ('administrator','tehnik','hostesa')
  order by d.created_at limit 10 for update of d skip locked
 ), claimed as (
  update public.push_deliveries d set attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
  from picked where d.id=picked.id returning d.*
 ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'user_id',c.user_id,'event_id',c.event_id,'kind',c.kind,
 'notification_id',c.notification_id,'lease_token',c.lease_token,'subscription_id',s.id,'endpoint',s.endpoint,'p256dh',s.p256dh,'auth',s.auth)),'[]'::jsonb)
 into result from claimed c join public.push_subscriptions s on s.id=c.subscription_id;
 return result;
end;
$$;

create function public.list_admin_notifications(p_user uuid,p_offset integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.profiles where id=p_user and is_active and role='administrator' and not must_change_password) then
  raise exception 'Administrator required' using errcode='42501'; end if;
 if p_offset<0 or p_offset>1000000 then raise exception 'Invalid offset'; end if;
 perform public.cleanup_admin_notifications();
 select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc,n.id desc),'[]'::jsonb),
 'next_offset',case when (select count(*) from public.admin_notifications where user_id=p_user)>p_offset+50 then p_offset+50 else null end)
 into result from (select * from public.admin_notifications where user_id=p_user order by created_at desc,id desc limit 50 offset p_offset) n;
 return result;
end;
$$;
create function public.set_admin_notification_read(p_user uuid,p_id uuid,p_read boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=p_user and is_active and role='administrator' and not must_change_password) then
  raise exception 'Administrator required' using errcode='42501'; end if;
 update public.admin_notifications set read_at=case when p_read then coalesce(read_at,now()) else null end
 where id=p_id and user_id=p_user and created_at>=now()-interval '14 days';
 return found;
end;
$$;
revoke all on function public.cleanup_admin_notifications(),public.record_admin_assignment_notification(uuid,uuid,text),
 public.queue_admin_assignment_notification(),public.list_admin_notifications(uuid,integer),public.set_admin_notification_read(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.cleanup_admin_notifications(),public.list_admin_notifications(uuid,integer),public.set_admin_notification_read(uuid,uuid,boolean) to service_role;
commit;
