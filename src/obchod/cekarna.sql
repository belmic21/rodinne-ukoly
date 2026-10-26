-- ═══════════════════════════════════════════════════════════════
-- FÁZE 1a — ČEKÁRNA A TŘÍDICÍ VLNA
--
-- CO TENHLE SKRIPT DĚLÁ
--   Zakládá tabulku „čekárna" pro importované kontakty a přidává
--   lidem sloupec oblast (osobní / pracovní).
--
-- CO MAŽE
--   NIC. Jde pustit i dvakrát za sebou.
--
-- ───────────────────────────────────────────────────────────────
-- PROČ ČEKÁRNA
--
--   Michal: „napadá tě jiný způsob, jak pracovat s kontakty, než
--   že je nahraji do tabulky a tu postupně promažu? celá databáze
--   obsahuje rodinu atd."
--
--   Import osmi set kontaktů z telefonu rovnou mezi lidi má dvě
--   vady. Pár hodin ručního mazání — a hlavně nevratnost: co
--   smažeš, je pryč, a za rok zjistíš, že ten člověk byl
--   zajímavý.
--
--   Čekárna je mezikrok. Import spadne sem, ne mezi lidi. Pak
--   jedeš vlnu — jeden kontakt, jedna klávesa — a do obchodní
--   databáze se dostane jen to, co tam patří. Nic se nemaže,
--   v čekárně se dá kdykoli hledat.
--
-- ───────────────────────────────────────────────────────────────
-- ČTYŘI STAVY
--
--   ceka      — čeká na rozhodnutí, tohle vlna ukazuje
--   zarazeno  — stal se z něj člověk v obchodní databázi
--   osobni    — stal se z něj člověk, ale osobní (rodina, lékař)
--   odlozeno  — „zatím ne"; nemaže se, jen nepřekáží
--
--   Zařazený i osobní odkazují přes person_id na vzniklého
--   člověka. Díky tomu jde vzít zpátky i rozhodnutí, které jsi
--   udělal omylem — vlna má Backspace.
--
-- ───────────────────────────────────────────────────────────────
-- PŘED SPUŠTĚNÍM
--   Pusť ruční zálohu: GitHub → rodinne-ukoly-zalohy → Actions
--   → Záloha databáze → Run workflow.
--
-- KDE TO PUSTIT
--   Supabase → SQL Editor → nový dotaz → vložit celé → Run.
--
-- Datum: 26. 10. 2026, 7:00
-- ═══════════════════════════════════════════════════════════════


-- ══ 1. OSOBNÍ NEBO PRACOVNÍ U ČLOVĚKA ══════════════════════════
-- Stejná dvojice jako u úkolů (tasks.oblast), schválně i stejně
-- pojmenovaná. Přepínač v hlavičce pak může filtrovat obojí.

alter table public.map_people
  add column if not exists oblast text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'map_people_oblast_check'
       and conrelid = 'public.map_people'::regclass
  ) then
    alter table public.map_people
      add constraint map_people_oblast_check
      check (oblast is null or oblast in ('osobni', 'prace'));
  end if;
end $$;

comment on column public.map_people.oblast is
  'osobni = rodina, lékař, soused; prace = obchodní kontakt. '
  'Prázdno znamená „nezařazeno" — vidět v obou režimech.';

create index if not exists map_people_oblast
  on public.map_people (owner, oblast);


-- ══ 2. ČEKÁRNA ═════════════════════════════════════════════════

create table if not exists public.map_cekarna (
  id             uuid primary key default gen_random_uuid(),
  owner          text not null,
  name           text not null,
  contact        text,
  firma          text,
  /* Odkud to přišlo. Při druhém importu z jiného telefonu je
     dobré vědět, který soubor to přinesl. */
  zdroj          text,
  davka          uuid not null default gen_random_uuid(),
  stav           text not null default 'ceka'
                 check (stav in ('ceka', 'zarazeno', 'osobni', 'odlozeno')),
  /* Kdo z toho vznikl. Drží se i po zařazení — bez toho by
     nešlo vzít rozhodnutí zpět. */
  person_id      uuid references public.map_people(id) on delete set null,
  zpracovano_at  timestamptz,
  created_at     timestamptz not null default now()
);

comment on table public.map_cekarna is
  'Importované kontakty před zařazením. Vlna je probírá po jednom. '
  'Nic se odtud nemaže — co nechceš, dostane stav odlozeno.';
comment on column public.map_cekarna.stav is
  'ceka = na řadě, zarazeno = je z něj obchodní člověk, '
  'osobni = je z něj osobní člověk, odlozeno = zatím ne.';
comment on column public.map_cekarna.person_id is
  'Člověk, který z kontaktu vznikl. Podle něj se rozhodnutí vrací zpět.';

-- Vlna se ptá pořád na totéž: dej mi další čekající.
create index if not exists map_cekarna_fronta
  on public.map_cekarna (owner, stav, created_at);
-- Hledání v čekárně podle jména.
create index if not exists map_cekarna_jmeno
  on public.map_cekarna (owner, name);


-- ══ 3. KDO TO VIDÍ ═════════════════════════════════════════════
-- Jen vlastník. Čekárna je syrový obsah tvého telefonu — rodina,
-- lékaři, čísla na servis. Tohle nepatří nikomu jinému, ani
-- spolupracovníkovi u sdílené zakázky.
--
-- Čtyři samostatná pravidla, stejně jako má map_people. Jedno
-- pravidlo pro ALL by fungovalo taky, ale nechávám to v souladu
-- se sousední tabulkou, ať se to čte stejně.

alter table public.map_cekarna enable row level security;

drop policy if exists map_cekarna_select on public.map_cekarna;
create policy map_cekarna_select on public.map_cekarna
  for select using (owner = public.me());

drop policy if exists map_cekarna_insert on public.map_cekarna;
create policy map_cekarna_insert on public.map_cekarna
  for insert with check (owner = public.me());

drop policy if exists map_cekarna_update on public.map_cekarna;
create policy map_cekarna_update on public.map_cekarna
  for update using (owner = public.me()) with check (owner = public.me());

drop policy if exists map_cekarna_delete on public.map_cekarna;
create policy map_cekarna_delete on public.map_cekarna
  for delete using (owner = public.me());

grant select, insert, update, delete on public.map_cekarna to authenticated;


-- ══ 4. KOLIK ČEKÁ ══════════════════════════════════════════════
-- Pro odznáček u tlačítka. Jedno číslo místo stahování celé
-- čekárny do prohlížeče.

create or replace function public.cekarna_pocty()
returns table (ceka int, zarazeno int, osobni int, odlozeno int)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*) filter (where stav = 'ceka')::int,
    count(*) filter (where stav = 'zarazeno')::int,
    count(*) filter (where stav = 'osobni')::int,
    count(*) filter (where stav = 'odlozeno')::int
  from public.map_cekarna
  where owner = public.me()
$$;

comment on function public.cekarna_pocty is
  'Kolik kontaktů v čekárně čeká a kolik je rozhodnutých. security invoker.';

grant execute on function public.cekarna_pocty() to authenticated;


-- ══ 5. HROMADNÉ PŘIDÁNÍ ROLE ═══════════════════════════════════
--
-- Michal: „mohu například vyfiltrovat všechny kontakty se jménem
-- ENYX, což je označení klubu, abych jim přiřadil stejný znak?"
--
-- Role se PŘIDÁVÁ, nepřepisuje. Kdo už nějakou má, o ni nepřijde —
-- prostředník z klubu ENYX zůstane prostředníkem a přibude mu
-- členství.
--
-- Proč funkce a ne dvacet tři zápisů z aplikace: přidání do pole
-- jde v SQL jedním tahem a nemůže se zaseknout v půlce. A hlavně
-- se tím nedá sáhnout na cizí řádky — where owner = me() je
-- uvnitř, ne v aplikaci.

create or replace function public.lide_pridej_roli(p_ids uuid[], p_role text)
returns int
language sql
volatile
security invoker
set search_path = public
as $$
  with zmena as (
    update public.map_people
       set role_tagy = (
             select array_agg(distinct x)
               from unnest(role_tagy || array[p_role]) as t(x)
           ),
           updated_at = now()
     where id = any(p_ids)
       and owner = public.me()
       and not (role_tagy @> array[p_role])
    returning 1
  )
  select count(*)::int from zmena
$$;

comment on function public.lide_pridej_roli is
  'Přidá roli skupině lidí. Nepřepisuje — kdo ji už má, zůstává beze '
  'změny a do počtu se nezapočítá. security invoker.';

grant execute on function public.lide_pridej_roli(uuid[], text) to authenticated;


-- ══ 5. KONTROLA ════════════════════════════════════════════════

-- a) Tabulka, pravidla, funkce a sloupec. Čekáš: 1, 4, 1, 1, 1.
select
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name='map_cekarna')     as "tabulka čekárny",
  (select count(*) from pg_policies
    where schemaname='public' and tablename='map_cekarna')         as "pravidla",
  (select count(*) from pg_proc where proname='cekarna_pocty')     as "funkce počtů",
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='map_people'
      and column_name='oblast')                                    as "sloupec oblast",
  (select count(*) from pg_proc where proname='lide_pridej_roli')  as "funkce hromadné role";

-- b) Kolik lidí už je zařazených. Po prvním spuštění samé nuly —
--    zařazuje se ve vlně, skript nikomu nic nehádá.
select
  count(*) filter (where oblast = 'prace')  as "pracovních",
  count(*) filter (where oblast = 'osobni') as "osobních",
  count(*) filter (where oblast is null)    as "nezařazených",
  count(*)                                   as "lidí celkem"
from public.map_people;

-- c) Čekárna. Po prvním spuštění prázdná.
select count(*) as "v čekárně" from public.map_cekarna;
