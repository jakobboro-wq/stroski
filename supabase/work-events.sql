-- Stroški: samodejno beleženje ur s telefona (MacroDroid ob prihodu/odhodu iz službe).
-- Telefon pokliče log_work_event s skrivnim ključem; aplikacija dogodke prevzame, zašifrira in tu izbriše.

create table public.work_tokens (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.work_tokens enable row level security;
create policy "own token" on public.work_tokens for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table public.work_events (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('in', 'out')),
  at timestamptz not null default now()
);
alter table public.work_events enable row level security;
create policy "own events read" on public.work_events for select to authenticated using ((select auth.uid()) = user_id);
create policy "own events delete" on public.work_events for delete to authenticated using ((select auth.uid()) = user_id);

-- Edini način vpisa dogodka: z veljavnim ključem (v bazi je shranjen le njegov SHA-256 odtis).
create function public.log_work_event(p_token text, p_kind text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid;
begin
  if p_kind not in ('in', 'out') then raise exception 'kind must be in or out'; end if;
  select user_id into uid from work_tokens where token_hash = encode(digest(p_token, 'sha256'), 'hex');
  if uid is null then raise exception 'invalid token'; end if;
  insert into work_events (user_id, kind) values (uid, p_kind);
  return 'ok';
end $$;

revoke all on function public.log_work_event(text, text) from public;
grant execute on function public.log_work_event(text, text) to anon, authenticated;
