-- PayUp database setup. Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to run more than once.

-- One row per bill. "data" holds the bill exactly as the app keeps it:
-- { receiptTotal, people: [{ id, name }], items: [{ id, name, price, people, custom, shares }] }
create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bills_data_size check (pg_column_size(data) < 50000)
);

create index if not exists bills_owner_updated_idx on public.bills (owner, updated_at desc);

-- Only the phone that made a bill can see, change or delete it.
alter table public.bills enable row level security;

drop policy if exists "Owners manage their bills" on public.bills;
create policy "Owners manage their bills" on public.bills
  for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

revoke all on public.bills from anon;
grant select, insert, update, delete on public.bills to authenticated;

-- Friends open a bill from its link. This returns that one bill only,
-- so nobody can list or browse other people's bills.
create or replace function public.get_shared_bill(bill_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('data', b.data, 'updated_at', b.updated_at)
  from public.bills b
  where b.id = bill_id
$$;

revoke all on function public.get_shared_bill(uuid) from public;
grant execute on function public.get_shared_bill(uuid) to anon, authenticated;
