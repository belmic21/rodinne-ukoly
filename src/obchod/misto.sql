-- ═══════════════════════════════════════════════════════════════
-- KDE KDO SEDÍ A ČÍM JE
--
-- CO TENHLE SKRIPT DĚLÁ
--   Dává lidem stejnou adresu, jakou mají zakázky: kraj, okres,
--   město a kód města z číselníku. K tomu firmu a pozici.
--
-- CO MAŽE
--   NIC. Jde pustit i dvakrát za sebou.
--
-- ───────────────────────────────────────────────────────────────
-- PROČ ZNOVU, KDYŽ UŽ JEDEN TAKOVÝ SKRIPT BYL
--
--   Byl, jmenoval se lide_misto_261015_1930.sql a NEBYL NASAZEN.
--   Ten tenhle nahrazuje — pouštěj jen tenhle, starý zahoď.
--
--   Michal: „přidal jsem nový kontakt ve tvaru Zdeněk Mudra,
--   Karlovy Vary a chtěl jsem, aby to bylo město. U kontaktů
--   potřebuji mít napárován alespoň okres, kraj nebo město
--   z našeho katalogu."
--
--   Starý skript uměl jen obec_kod — jednu obec, nebo nic. Jenže
--   u člověka často víš jen „někde na Karlovarsku", a ten by
--   zůstal bez místa úplně. Navíc to byla druhá slovní zásoba:
--   zakázka má kraj/okres/mesto/mesto_kod, člověk měl obec_kod.
--   Dvě jména pro jednu věc jsou začátek toho, že si čísla
--   přestanou odpovídat.
--
--   Tenhle skript dává lidem přesně ta samá čtyři pole. Vyplnit
--   se dá kterákoli úroveň:
--     · vybereš město   → doplní se okres i kraj
--     · vybereš okres   → doplní se kraj, město zůstane prázdné
--     · vybereš kraj    → vyplní se jen kraj
--   Pro „Jedu do…" stačí okres; kraj sám o sobě řekne aspoň to,
--   že ten člověk je někde po cestě.
--
-- ───────────────────────────────────────────────────────────────
-- CO TENHLE SKRIPT NEDĚLÁ
--
--   Nedoplňuje nikomu místo. Odvozovat ho ze zakázek, na kterých
--   ten člověk visí, by u poloviny lidí lhalo — investor z Brna
--   může řešit pozemek v Chebu. Doplní se ručně, v aplikaci.
--
-- ───────────────────────────────────────────────────────────────
-- PŘED SPUŠTĚNÍM
--   Pusť ruční zálohu: GitHub → rodinne-ukoly-zalohy → Actions
--   → Záloha databáze → Run workflow.
--
-- KDE TO PUSTIT
--   Supabase → SQL Editor → nový dotaz → vložit celé → Run.
--
-- Datum: 17. 10. 2026, 8:00
-- ═══════════════════════════════════════════════════════════════


-- ══ 1. MÍSTO U ČLOVĚKA ═════════════════════════════════════════
-- Stejná čtyři pole jako u zakázky (deal_projects), schválně
-- i stejně pojmenovaná.

alter table public.map_people
  add column if not exists kraj      text,
  add column if not exists okres     text,
  add column if not exists mesto     text,
  add column if not exists mesto_kod text;

comment on column public.map_people.kraj is
  'Kód kraje z číselníku. Nejhrubší úroveň — vyplněný je vždycky, '
  'když je vyplněný okres nebo město.';
comment on column public.map_people.okres is
  'Kód okresu z číselníku. Tohle je úroveň, na které počítá „Jedu do…".';
comment on column public.map_people.mesto is
  'Název města. Prázdno znamená „vím jen okres nebo kraj", ne „nikde".';
comment on column public.map_people.mesto_kod is
  'Kód obce podle ČSÚ. Klíč do číselníku obcí.';

-- Hledání „kdo je na Karlovarsku" jde přes kraj, „kdo je cestou"
-- přes okres. Obojí vždycky v rámci jednoho vlastníka.
create index if not exists map_people_kraj  on public.map_people (owner, kraj);
create index if not exists map_people_okres on public.map_people (owner, okres);


-- ══ 2. FIRMA A POZICE ══════════════════════════════════════════
-- Michal: „u kontaktu je pro mě zásadní kdo je, kde a jakou má
-- pozici." Dosud se firma psala do pole „Kontakt" vedle telefonu
-- a mailu, takže se podle ní nedalo hledat.

alter table public.map_people
  add column if not exists firma text;

comment on column public.map_people.firma is
  'Firma a pozice jednou větou — „majitel stavební firmy", '
  '„jednatel, Rezidence Vrchlabí". Volný text, ale vlastní pole, '
  'aby se dal prohledávat.';


-- ══ 3. LIDÉ I S MÍSTEM A POSLEDNÍM DOTYKEM ═════════════════════
-- Jeden dotaz pro obrazovku „Jedu do…". Vzdálenosti se počítají
-- až v aplikaci: těžiště okresů jsou v mapě, ne v databázi, a
-- tahat je sem podruhé by znamenalo dvě verze téhož čísla.

drop function if exists public.lide_s_mistem();

create function public.lide_s_mistem()
returns table (
  person_id      uuid,
  name           text,
  contact        text,
  firma          text,
  mesto          text,
  mesto_kod      text,
  okres          text,
  kraj           text,
  met_at         text,
  posledni_dotyk timestamptz,
  osloveni       int,
  ma_kartu       boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id, p.name, p.contact, p.firma,
    p.mesto, p.mesto_kod, p.okres, p.kraj, p.met_at,
    /* Poslední dotyk: kdy se s tím člověkem naposled něco dělo.
       Založení se nepočítá — zapsat si někoho není kontakt. */
    greatest(
      (select max(a.created_at) from public.deal_approaches a
        where a.person_id = p.id and a.owner = p.owner),
      (select max(f.created_at) from public.map_facts f
        where f.person_id = p.id and f.owner = p.owner),
      (select max(t.created_at) from public.deal_terminy t
        where t.person_id = p.id and t.owner = p.owner)
    ),
    (select count(*)::int from public.deal_approaches a
      where a.person_id = p.id and a.owner = p.owner),
    exists (select 1 from public.deal_cards c
             where c.person_id = p.id and c.owner = p.owner and c.aktivni)
  from public.map_people p
  where p.owner = public.me()
$$;

comment on function public.lide_s_mistem() is
  'Lidé přihlášeného uživatele i s místem a tím, kdy se s nimi '
  'naposled něco dělo. Podklad pro „Jedu do…". security invoker.';

grant execute on function public.lide_s_mistem() to authenticated;


-- ══ 4. KOLIK LIDÍ MÁ MÍSTO ═════════════════════════════════════
-- Pro pruh „Doplnit místo" na úvodní obrazovce. Jedno číslo
-- místo stahování všech lidí do prohlížeče.

create or replace function public.lide_bez_mista()
returns int
language sql
stable
security invoker
set search_path = public
as $$
  select count(*)::int
  from public.map_people
  where owner = public.me() and kraj is null
$$;

comment on function public.lide_bez_mista() is
  'Kolik lidí nemá ani kraj. Ti vypadávají z „Jedu do…". security invoker.';

grant execute on function public.lide_bez_mista() to authenticated;


-- ══ 5. KONTROLA ════════════════════════════════════════════════

-- a) Sloupce i funkce stojí. Čekáš: 4, 1, 1, 1.
select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='map_people'
      and column_name in ('kraj','okres','mesto','mesto_kod'))  as "sloupce místa",
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='map_people'
      and column_name='firma')                                  as "sloupec firma",
  (select count(*) from pg_proc where proname='lide_s_mistem')  as "funkce lide_s_mistem",
  (select count(*) from pg_proc where proname='lide_bez_mista') as "funkce lide_bez_mista";

-- b) Kolik lidí už místo má. Po prvním spuštění nula — doplňuje
--    se v aplikaci, skript nikomu nic nehádá.
select count(*) filter (where kraj  is not null) as "má aspoň kraj",
       count(*) filter (where okres is not null) as "má okres",
       count(*) filter (where mesto is not null) as "má město",
       count(*)                                   as "celkem lidí"
from public.map_people;

-- c) Zkouška naživo. V SQL editoru vrátí 0 řádků — me() tam
--    nikoho přihlášeného nevidí. Skutečná čísla uvidíš v aplikaci.
select count(*) as "lidí z funkce" from public.lide_s_mistem();
