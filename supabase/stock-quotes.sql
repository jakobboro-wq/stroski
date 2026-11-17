-- Stroški: cene delnic in skladov (Yahoo Finance) za prijavljene uporabnike.
-- Brskalnik do Yahooja ne more neposredno (ni CORS), zato kliče to funkcijo v bazi.
-- Oznake delnic (npr. AAPL, VWCE.DE) gredo samo v zahtevo; v bazi se ne shranjujejo.
--
-- Namestitev: Supabase → SQL Editor → prilepi celotno datoteko → Run. Ponovni zagon je varen.

create extension if not exists http with schema extensions;

-- Dnevne zaključne cene za največ 25 oznak.
-- Vrne [{ symbol, currency, price, time, name, t: [unix sekunde], c: [cene] }] ali { symbol, error } za neuspele.
create or replace function public.stock_chart(p_symbols text[], p_range text default '1y')
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  s text;
  res extensions.http_response;
  r jsonb;
  out jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_range not in ('5d', '1mo', '6mo', '1y', '2y', '5y') then raise exception 'bad range'; end if;
  if coalesce(array_length(p_symbols, 1), 0) > 25 then raise exception 'too many symbols'; end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '10');
  foreach s in array coalesce(p_symbols, '{}') loop
    -- samo znaki, ki se pojavijo v oznakah (brez možnosti, da bi spremenili naslov)
    if s !~ '^[A-Za-z0-9.^=-]{1,20}$' then
      out := out || jsonb_build_array(jsonb_build_object('symbol', s, 'error', 'bad symbol'));
      continue;
    end if;
    begin
      select * into res from extensions.http((
        'GET',
        'https://query1.finance.yahoo.com/v8/finance/chart/' || s || '?range=' || p_range || '&interval=1d',
        array[extensions.http_header('User-Agent', 'Mozilla/5.0')],
        null, null)::extensions.http_request);
      if res.status = 200 then
        r := res.content::jsonb -> 'chart' -> 'result' -> 0;
        out := out || jsonb_build_array(jsonb_build_object(
          'symbol', s,
          'currency', r -> 'meta' -> 'currency',
          'price', r -> 'meta' -> 'regularMarketPrice',
          'time', r -> 'meta' -> 'regularMarketTime',
          'name', coalesce(r -> 'meta' -> 'longName', r -> 'meta' -> 'shortName'),
          't', r -> 'timestamp',
          'c', r -> 'indicators' -> 'quote' -> 0 -> 'close'));
      else
        out := out || jsonb_build_array(jsonb_build_object('symbol', s, 'error', res.status));
      end if;
    exception when others then
      out := out || jsonb_build_array(jsonb_build_object('symbol', s, 'error', sqlerrm));
    end;
  end loop;
  return out;
end $$;

-- Iskanje oznake po imenu (npr. »vanguard all-world« → VWCE.DE).
create or replace function public.stock_search(p_query text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare res extensions.http_response;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if length(coalesce(p_query, '')) not between 1 and 60 then return '[]'::jsonb; end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '10');
  select * into res from extensions.http((
    'GET',
    'https://query1.finance.yahoo.com/v1/finance/search?quotesCount=8&newsCount=0&q=' || extensions.urlencode(p_query),
    array[extensions.http_header('User-Agent', 'Mozilla/5.0')],
    null, null)::extensions.http_request);
  if res.status <> 200 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('symbol', q ->> 'symbol', 'name', coalesce(q ->> 'longname', q ->> 'shortname'), 'exchange', q ->> 'exchDisp', 'type', q ->> 'typeDisp'))
    from jsonb_array_elements(res.content::jsonb -> 'quotes') q
    where q ? 'symbol'), '[]'::jsonb);
end $$;

revoke all on function public.stock_chart(text[], text) from public, anon;
revoke all on function public.stock_search(text) from public, anon;
grant execute on function public.stock_chart(text[], text) to authenticated;
grant execute on function public.stock_search(text) to authenticated;
