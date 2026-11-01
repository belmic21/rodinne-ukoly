-- ═══════════════════════════════════════════════════════════════
-- HLÁŠKY BEZ STROPU
--
-- CO TENHLE SKRIPT DĚLÁ
--   Zakládá tabulku story_quotes, kam se hlášky přestěhují.
--   Den jich od teď může mít kolik chce.
--
-- CO MAŽE
--   NIC. Sloupce quote a quote_person v daily_stories zůstávají
--   nedotčené jako záloha. Až řekneš, že je všechno v pořádku,
--   smažeme je zvlášť. Jde pustit i dvakrát — podruhé nepřidá nic.
--
-- ───────────────────────────────────────────────────────────────
-- PROČ
--
--   Michal 31. 10.: „denní omezení na 1 hlášku je hloupé
--   a zbytečné, některý den je 5 hlášek a pak nemám měsíc žádnou."
--
--   Strop nebyl nastavení, ale tvar dat: hláška byla dvojice
--   sloupců na dni a den je jeden řádek. Jedna hláška na den z
--   toho plynula sama.
--
--   Z toho, co psal, ale plyne ještě něco: hláška není vlastnost
--   dne. Je to vlastní věc, která má datum — jako fotka. Proto
--   vlastní tabulka a ne pole v dni.
--
-- ───────────────────────────────────────────────────────────────
-- DATUM JE ZATÍM POVINNÉ
--
--   Ptal jsem se, jestli má jít uložit hláška bez data (někdo si
--   větu vybaví po letech a den nezná). Bez odpovědi volím
--   povinné: povolit prázdné datum později je jednořádková změna,
--   obráceně by se muselo hádat, kam ty hlášky patří.
--
-- ───────────────────────────────────────────────────────────────
-- POŘADÍ
--   1. Pusť tenhle skript.
--   2. Pak nasaď aplikaci (verze 261101_1600 a vyšší).
--
--   Takhle to jde bezpečně: stará aplikace o nové tabulce neví
--   a běží dál ze starých sloupců, které zůstávají.
--
-- KDE TO PUSTIT
--   Supabase → SQL Editor → nový dotaz → vložit celé → Run.
--
-- Datum: 1. 11. 2026
-- ═══════════════════════════════════════════════════════════════


-- ══ 1. CO JE TEĎ ═══════════════════════════════════════════════
-- Jen se dívá. Číslo ve sloupci „hlášek" je to, co se přestěhuje.

select count(*) filter (where quote is not null) as "hlášek",
       count(*)                                   as "dnů celkem",
       count(distinct quote_person) filter (where quote_person is not null) as "osob"
  from public.daily_stories;

-- Jak je dnes chráněná tabulka dnů. Nová tabulka to bude mít
-- stejně — kdyby se to lišilo, pošli mi tenhle výpis.
select policyname as "pravidlo", cmd as "na co", roles as "pro koho"
  from pg_policies
 where schemaname = 'public' and tablename = 'daily_stories'
 order by policyname;

select relrowsecurity as "RLS zapnuté u daily_stories"
  from pg_class where oid = 'public.daily_stories'::regclass;


-- ══ 2. TABULKA ═════════════════════════════════════════════════

create table if not exists public.story_quotes (
  id          uuid primary key default gen_random_uuid(),
  user_name   text not null,
  /* Den, kdy to padlo. Povinné — viz poznámka nahoře. */
  date        date not null,
  text        text not null,
  /* Kdo to řekl. Nepovinné: některé věty si člověk pamatuje,
     ale kdo je pronesl, už ne. */
  person      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.story_quotes is
  'Hlášky. Den jich může mít libovolně — dřív byly dvojicí sloupců '
  'na daily_stories, a tím jedna na den.';
comment on column public.story_quotes.person is
  'Kdo to řekl. Prázdné je v pořádku.';

-- Prohlížeč hlášek je řadí od nejnovějších a filtruje podle osoby.
create index if not exists story_quotes_datum
  on public.story_quotes (user_name, date desc);
create index if not exists story_quotes_osoba
  on public.story_quotes (user_name, person);


-- ══ 3. KDO TO VIDÍ ═════════════════════════════════════════════
-- Stejně jako dny: aplikace si filtruje podle user_name sama.
-- Zpřísnit tohle má smysl jen u obou tabulek najednou, a to je
-- jiné rozhodnutí než zrušit strop na hlášky.

alter table public.story_quotes enable row level security;

drop policy if exists story_quotes_cteni on public.story_quotes;
create policy story_quotes_cteni on public.story_quotes
  for select to authenticated using (true);

drop policy if exists story_quotes_zapis on public.story_quotes;
create policy story_quotes_zapis on public.story_quotes
  for insert to authenticated with check (true);

drop policy if exists story_quotes_uprava on public.story_quotes;
create policy story_quotes_uprava on public.story_quotes
  for update to authenticated using (true) with check (true);

drop policy if exists story_quotes_mazani on public.story_quotes;
create policy story_quotes_mazani on public.story_quotes
  for delete to authenticated using (true);

grant select, insert, update, delete on public.story_quotes to authenticated;


-- ══ 4. PŘESTĚHOVAT, CO UŽ MÁŠ ══════════════════════════════════
-- Podruhé nepřidá nic: hlášku poznáme podle trojice uživatel +
-- den + text. Staré sloupce zůstávají, nic se z nich nemaže.

insert into public.story_quotes (user_name, date, text, person, created_at)
select d.user_name, d.date, d.quote, nullif(trim(coalesce(d.quote_person, '')), ''),
       coalesce(d.created_at, now())
  from public.daily_stories d
 where d.quote is not null
   and trim(d.quote) <> ''
   and not exists (
     select 1 from public.story_quotes q
      where q.user_name = d.user_name and q.date = d.date and q.text = d.quote
   );


-- ══ 5. OSOBY A PŘEJMENOVÁNÍ ════════════════════════════════════
-- Dvě funkce, které aplikace potřebuje. Čtou jen svoje.

create or replace function public.story_quote_people2(p_user_name text)
returns table (person text, cnt bigint)
language sql
stable
set search_path = public
as $$
  select q.person, count(*)
    from public.story_quotes q
   where q.user_name = p_user_name
     and q.person is not null and q.person <> ''
   group by q.person
   order by count(*) desc, q.person
$$;

comment on function public.story_quote_people2 is
  'Kdo má kolik hlášek. Dvojka v názvu, protože původní verze '
  'čte ze starých sloupců a ta zůstává, dokud se nesmažou.';

grant execute on function public.story_quote_people2(text) to authenticated;

-- Přejmenovat nebo sloučit autora napříč všemi hláškami.
create or replace function public.story_quotes_rename_person(
  p_user_name text, p_from text, p_to text
)
returns int
language sql
volatile
set search_path = public
as $$
  with zmena as (
    update public.story_quotes
       set person = nullif(trim(p_to), ''), updated_at = now()
     where user_name = p_user_name and person = p_from
    returning 1
  )
  select count(*)::int from zmena
$$;

grant execute on function public.story_quotes_rename_person(text, text, text) to authenticated;


-- ══ 6. KONTROLA ════════════════════════════════════════════════

-- a) Přestěhovalo se všechno? Obě čísla musí sedět.
select
  (select count(*) from public.daily_stories
    where quote is not null and trim(quote) <> '')   as "bylo ve dnech",
  (select count(*) from public.story_quotes)          as "je v nové tabulce";

-- b) Tabulka, pravidla, funkce. Čekáš 1, 4, 1, 1.
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='story_quotes')      as "tabulka",
  (select count(*) from pg_policies
    where schemaname='public' and tablename='story_quotes')          as "pravidla",
  (select count(*) from pg_proc where proname='story_quote_people2') as "funkce osob",
  (select count(*) from pg_proc
    where proname='story_quotes_rename_person')                      as "funkce přejmenování";

-- c) Namátkou pět nejnovějších, ať je vidět, že se přenesl text
--    i autor.
select date as "den", person as "kdo", left(text, 60) as "hláška"
  from public.story_quotes
 order by date desc, created_at desc
 limit 5;

-- Sedí-li obě čísla v (a), nasaď aplikaci. Staré sloupce quote
-- a quote_person nech zatím být — až si pár dní ověříš, že je
-- všechno v pořádku, smažeme je zvlášť.
