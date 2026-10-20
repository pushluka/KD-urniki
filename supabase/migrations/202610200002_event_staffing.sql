begin;

-- Historic events have no known accounting classification; do not invent one.
alter table public.events add column accounting_code text
  constraint events_accounting_code_check check (accounting_code in ('110', '111'));

create function public.require_accounting_code() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.accounting_code is null and
     (TG_OP = 'INSERT' or old.accounting_code is not null) then
    raise exception 'Izberite računovodsko postavko 110 ali 111.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger events_require_accounting_code before insert or update on public.events
for each row execute function public.require_accounting_code();

alter table public.assignments add column arrives_at timestamptz;
alter table public.assignments add column finishes_at timestamptz;
-- Preserve existing assignments. Initial hours match the event until individually edited.
update public.assignments a set arrives_at=e.starts_at, finishes_at=e.ends_at
from public.events e where e.id=a.event_id;
alter table public.assignments alter column arrives_at set not null;
alter table public.assignments alter column finishes_at set not null;
alter table public.assignments add constraint assignments_time_order
  check (finishes_at > arrives_at);

-- Technical staff can manage only their own assignment; hostesses remain admin-managed.
create policy assignments_technician_insert on public.assignments for insert to authenticated
with check (public.current_role()='tehnik' and user_id=(select auth.uid()));
create policy assignments_technician_update on public.assignments for update to authenticated
using (public.current_role()='tehnik' and user_id=(select auth.uid()))
with check (public.current_role()='tehnik' and user_id=(select auth.uid()));
create policy assignments_technician_delete on public.assignments for delete to authenticated
using (public.current_role()='tehnik' and user_id=(select auth.uid()));
-- Identity/event keys cannot be changed through an UPDATE, including malicious REST calls.
revoke update on public.assignments from authenticated;
grant update (arrives_at, finishes_at) on public.assignments to authenticated;

create table public.external_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  full_name text not null check (length(btrim(full_name)) between 1 and 120),
  role public.app_role not null check (role in ('hostesa','tehnik')),
  arrives_at timestamptz not null,
  finishes_at timestamptz not null check (finishes_at > arrives_at)
);
create index external_assignments_event_id_idx on public.external_assignments(event_id);
alter table public.external_assignments enable row level security;
revoke all on public.external_assignments from anon, authenticated;
grant select,insert,update,delete on public.external_assignments to authenticated;
create policy external_assignments_read on public.external_assignments for select to authenticated
using (public.current_role() is not null);
create policy external_assignments_admin on public.external_assignments for all to authenticated
using (public.current_role()='administrator') with check (public.current_role()='administrator');

-- No storage policy changes: only real assigned technician accounts can read private PDFs.
commit;
