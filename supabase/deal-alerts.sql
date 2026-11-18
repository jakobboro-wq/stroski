-- Stroški / Nakupi: obvestila o akcijah na telefon (Web Push).
-- Aplikacija tu hrani izdelke z zvoncem (ime, iskalna imena, različica, velikost; brez cen in računov)
-- in naslove za obvestila na napravah. Vsak uporabnik vidi samo svoje vrstice.
-- Dnevni workflow (scraper/alerts.mjs) prebere vse prek push_jobs s skrivnim ključem,
-- primerja z današnjimi akcijami in pošlje obvestila. V bazi je samo SHA-256 odtis ključa.
--
-- Namestitev: Supabase → SQL Editor → prilepi celotno datoteko → Run. Ponovni zagon je varen.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.deal_alerts (
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  product_id text not null,
  product jsonb not null,
  sent jsonb not null default '{}'::jsonb, -- { ime v trgovini: cena }, da isto akcijo sporočimo enkrat
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id)
);
alter table public.deal_alerts enable row level security;
drop policy if exists "own alerts" on public.deal_alerts;
create policy "own alerts" on public.deal_alerts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  keys jsonb not null,
  app text not null default 'stroski', -- stroski ali nakupi: katera aplikacija se odpre ob kliku
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.secrets (name text primary key, hash text not null);
-- Odtis ključa PUSH_SECRET (skrivnost GitHub Actions). Ključ je naključen, zato odtis ne izda ničesar.
insert into private.secrets (name, hash) values ('push', 'c56175c12f127e571c34884a6cd3a6068d5401544f47ba4950ff39bf015305b7')
  on conflict (name) do update set hash = excluded.hash;

create or replace function private.push_ok(p_secret text) returns boolean
language sql security definer set search_path = private, extensions as $$
  select exists (select 1 from private.secrets where name = 'push' and hash = encode(digest(coalesce(p_secret, ''), 'sha256'), 'hex'));
$$;

-- Vse naročene izdelke in naprave za pošiljanje.
create or replace function public.push_jobs(p_secret text) returns jsonb
language plpgsql security definer set search_path = public, private, extensions as $$
begin
  if not private.push_ok(p_secret) then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'alerts', coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'product_id', product_id, 'product', product, 'sent', sent)) from deal_alerts), '[]'::jsonb),
    'subs', coalesce((select jsonb_agg(jsonb_build_object('user_id', user_id, 'endpoint', endpoint, 'keys', keys, 'app', app)) from push_subscriptions), '[]'::jsonb));
end $$;

-- Po pošiljanju: zapiše sporočene akcije in odstrani naprave, ki obvestil ne sprejemajo več.
-- p_sent: [{ user_id, product_id, sent }], p_gone: [endpoint]
create or replace function public.push_done(p_secret text, p_sent jsonb, p_gone text[]) returns void
language plpgsql security definer set search_path = public, private, extensions as $$
begin
  if not private.push_ok(p_secret) then raise exception 'forbidden'; end if;
  update deal_alerts a set sent = x.sent
    from jsonb_to_recordset(coalesce(p_sent, '[]'::jsonb)) as x(user_id uuid, product_id text, sent jsonb)
    where a.user_id = x.user_id and a.product_id = x.product_id;
  delete from push_subscriptions where endpoint = any(coalesce(p_gone, '{}'));
end $$;

revoke all on function private.push_ok(text) from public, anon, authenticated;
revoke all on function public.push_jobs(text) from public;
revoke all on function public.push_done(text, jsonb, text[]) from public;
grant execute on function public.push_jobs(text) to anon;
grant execute on function public.push_done(text, jsonb, text[]) to anon;
