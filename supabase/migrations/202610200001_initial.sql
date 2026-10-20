begin;
create type public.app_role as enum ('administrator', 'hostesa', 'tehnik');
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null check (length(full_name) between 1 and 120),
 role public.app_role not null default 'hostesa'
);
create table public.events (
 id uuid primary key default gen_random_uuid(),
 title text not null check(length(title) between 1 and 160),
 starts_at timestamptz not null,
 ends_at timestamptz not null check(ends_at > starts_at),
 location text not null check(location in ('Kulturni dom','Družbeni dom','Druga lokacija')),
 notes text not null default '',
 hostesses_needed integer not null default 0 check(hostesses_needed between 0 and 100),
 technicians_needed integer not null default 0 check(technicians_needed between 0 and 100)
);
create table public.assignments (
 event_id uuid references public.events(id) on delete cascade,
 user_id uuid references public.profiles(id) on delete cascade,
 primary key(event_id,user_id)
);
create index events_starts_at_idx on public.events(starts_at);
create index assignments_user_id_idx on public.assignments(user_id);
-- Role lookup bypasses recursive profile policies; no user-supplied role or identity.
create function public.current_role() returns public.app_role language sql stable security definer set search_path = '' as $$
 select role from public.profiles where id = (select auth.uid())
$$;
revoke all on function public.current_role() from public, anon;
grant execute on function public.current_role() to authenticated;
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.assignments enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (public.current_role() is not null);
-- No client profile writes: only trusted SQL/admin provisioning can assign roles.
create policy events_read on public.events for select to authenticated using (public.current_role() is not null);
create policy events_admin on public.events for all to authenticated using (public.current_role()='administrator') with check (public.current_role()='administrator');
create policy assignments_read on public.assignments for select to authenticated using (public.current_role() is not null);
create policy assignments_admin on public.assignments for all to authenticated using (public.current_role()='administrator') with check (public.current_role()='administrator');
revoke all on public.profiles, public.events, public.assignments from anon, authenticated;
grant select on public.profiles to authenticated;
grant select,insert,update,delete on public.events,public.assignments to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('technical-documents','technical-documents',false,20971520,array['application/pdf']);
create function public.can_read_technical_document(object_name text) returns boolean language sql stable security definer set search_path = '' as $$
 select exists (
  select 1 from public.events e where e.id::text=split_part(object_name,'/',1)
  and (public.current_role()='administrator' or (public.current_role()='tehnik' and exists (
   select 1 from public.assignments a where a.event_id=e.id and a.user_id=(select auth.uid())
  )))
 )
$$;
revoke all on function public.can_read_technical_document(text) from public, anon;
grant execute on function public.can_read_technical_document(text) to authenticated;
create policy technical_read on storage.objects for select to authenticated using (bucket_id='technical-documents' and public.can_read_technical_document(name));
create policy technical_upload on storage.objects for insert to authenticated with check (
 bucket_id='technical-documents' and public.current_role()='administrator'
 and exists(select 1 from public.events e where e.id::text=split_part(name,'/',1))
 and lower(storage.extension(name))='pdf'
);
create policy technical_delete on storage.objects for delete to authenticated using (bucket_id='technical-documents' and public.current_role()='administrator');
commit;
